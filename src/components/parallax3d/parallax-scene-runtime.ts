import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { getReferenceRayScale, REFERENCE_CAMERA_DISTANCE, remapDepth } from './depthProjection'
import { INK_HISTORY_COUNT, InkPostProcess } from './inkPostProcess'
import { getKineticWaveState, getLayerWaveWeight } from './kineticMotion'
import { createAmbientMotionFrame, updateAmbientMotionFrame } from './ambientMotion'
import { createSceneChoreographyFrame, getChoreographyLayerWaveWeight, updateSceneChoreographyFrame } from './sceneChoreography'
import { SpectralPostProcess } from './spectralPostProcess'
import { createLaplaceStickerRuntime } from './laplace-sticker-runtime'
import { configureSceneMaterial, disposeScene } from './parallax-scene-materials'
import { createParallaxSceneInput } from './parallax-scene-input'
import {
  BACKGROUND_NAME,
  DEFAULT_FIGURE_DEPTHS,
  DEFAULT_TUNING,
  DEPTH_NODE_NAMES,
  FIGURE_KEYS,
  FIGURE_NAMES,
  INTERACTION_WARMUP_MS,
  INK_CLICK_TRANSITION_MS,
  INK_HISTORY_LIFETIME_MS,
  INK_MODE_TRANSITION_MS,
  INK_VELOCITY_EPSILON,
  KINETIC_LAYER_LIFT,
  KINETIC_LAYER_SCALE,
  KINETIC_LAYER_SHIFT,
  KINETIC_VELOCITY_EPSILON,
  KINETIC_WAVE_MS,
  LAYER_RENDER_ORDER,
  MAX_RENDER_PIXELS,
  MAX_RENDER_PIXEL_RATIO,
  MIN_RENDER_PIXEL_RATIO,
  MODEL_NAME,
  MODEL_URL,
  POSITION_EPSILON,
  REFERENCE_ASPECT,
  REFERENCE_FOV,
  STARTUP_WARMUP_MS,
  STATIC_OVERLAY_NAMES,
  TOUR_LAYER_LIFT,
  TOUR_LAYER_SCALE,
  TOUR_POINTER_TARGETS,
  TOUR_SCORE,
  TOUR_STEP_MS,
  TOUR_TRANSITION_MS,
  getDepthCrossings,
  isFlatDepth,
  loadStoredTuning,
  type SceneStatus,
  type TourCue,
  type TuningSettings,
} from './parallax-scene-config'

export type RuntimeControls = {
  apply: (next: TuningSettings) => void
  setTour: (enabled: boolean, figureIndex?: number) => void
}

export type ParallaxSceneRuntimeOptions = {
  host: HTMLDivElement
  canvas: HTMLCanvasElement
  tuningStorageKey: string
  runtimeControlsRef: { current: RuntimeControls | null }
  copyResetTimerRef: { current: number | null }
  setSceneStatus: (status: SceneStatus) => void
  setFigureBaseDepths: (depths: readonly number[]) => void
  setTourActiveIndex: (index: number) => void
  setTourStepEpoch: (update: (epoch: number) => number) => void
}

type DepthRuntimeNode = {
  node: THREE.Mesh
  baseZ: number
  positionAttribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute
  baseWorldPositions: Float32Array
  baseWorldToLocal: THREE.Matrix4
}

type FigureRuntimeTransform = {
  node: THREE.Mesh
  position: THREE.Vector3
  rotation: THREE.Euler
  scale: THREE.Vector3
}

type FigureMotionState = {
  pointer: THREE.Vector2
  velocity: THREE.Vector2
}

type InkPointSample = {
  x: number
  y: number
  time: number
  speed: number
}

type InkTransition = {
  start: number
  duration: number
  origin: THREE.Vector2
}

type KineticWave = {
  start: number
  duration: number
  origin: THREE.Vector2
  strength: number
}

export function createParallaxSceneRuntime({
  host,
  canvas,
  tuningStorageKey,
  runtimeControlsRef,
  copyResetTimerRef,
  setSceneStatus,
  setFigureBaseDepths,
  setTourActiveIndex,
  setTourStepEpoch,
}: ParallaxSceneRuntimeOptions) {
    let disposed = false
    let frameId: number | null = null
    let scheduleFrame: () => void = () => {}
    let lastFrameTime = 0
    let warmupUntil = 0
    let hasReportedReady = false
    let reduceMotion = false
    let modelRoot: THREE.Group | null = null
    let currentTuning = loadStoredTuning(tuningStorageKey)
    let viewportWidth = 1
    let viewportHeight = 1

    const currentPointer = new THREE.Vector2()
    const targetPointer = new THREE.Vector2()
    const previousPointer = new THREE.Vector2()
    const kineticPointer = new THREE.Vector2(0.5, 0.5)
    const kineticVelocity = new THREE.Vector2()
    const kineticWaveOrigin = new THREE.Vector2(0.5, 0.5)
    const lookAtTarget = new THREE.Vector3(0, 0, 0.1)
    const depthNodes = new Map<string, DepthRuntimeNode>()
    const figureTransforms = new Map<string, FigureRuntimeTransform>()
    const staticOverlayTransforms = new Map<string, FigureRuntimeTransform>()
    const ambientMotionFrame = createAmbientMotionFrame()
    const sceneChoreographyFrame = createSceneChoreographyFrame()
    const ambientMotionOptions = {
      intensity: 1,
      cameraIntensity: 1,
      layerIntensity: 1,
    }
    const ambientCameraOffset = new THREE.Vector2()
    let lastPointerActivityAt = performance.now()
    let lastSceneImpactAt = Number.NEGATIVE_INFINITY
    const depthVertex = new THREE.Vector3()
    const tourFromPointer = new THREE.Vector2()
    const tourTargetPointer = new THREE.Vector2()
    const tourProjectedPosition = new THREE.Vector3()
    const tourLayerWeights = FIGURE_NAMES.map(() => 0)
    const figureMotionStates: FigureMotionState[] = FIGURE_NAMES.map(() => ({
      pointer: new THREE.Vector2(),
      velocity: new THREE.Vector2(),
    }))
    const inkPostProcess = new InkPostProcess()
    const spectralPostProcess = new SpectralPostProcess()
    const inkPointer = new THREE.Vector2(0.5, 0.5)
    const inkVelocity = new THREE.Vector2()
    const inkTransitionOrigin = new THREE.Vector2(0.5, 0.5)
    const inkHistoryUniforms = Array.from(
      { length: INK_HISTORY_COUNT },
      () => new THREE.Vector4(0.5, 0.5, 0, 0),
    )
    let inkPointerTime = 0
    let inkPointerActive = false
    let inkPressed = false
    let inkPressPointerId: number | null = null
    let inkHistory: InkPointSample[] = []
    let inkModeTransition: InkTransition | undefined
    let inkClickTransition: InkTransition | undefined
    let kineticWave: KineticWave | undefined
    let tourEnabled = false
    let tourActiveIndex = 0
    let tourSequenceCursor = 0
    let tourStepStartedAt = 0
    let tourStepDuration = TOUR_STEP_MS
    let tourTransitionDuration = TOUR_TRANSITION_MS
    let tourManualUntil = 0
    let tourWasManual = false

    let renderer: THREE.WebGLRenderer
    let gl: WebGLRenderingContext
    let supportsAlphaToCoverage = false
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      })
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.toneMapping = THREE.NoToneMapping
      renderer.setClearColor(0xffffff, 1)
      gl = renderer.getContext()
      supportsAlphaToCoverage =
        Boolean(gl.getContextAttributes()?.antialias) &&
        Number(gl.getParameter(gl.SAMPLES)) > 0
    } catch (error) {
      host.dataset.error = 'true'
      setSceneStatus('error')
      console.error('Unable to create the WebGL renderer:', error)
      return () => {
        delete host.dataset.error
      }
    }

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(
      REFERENCE_FOV,
      REFERENCE_ASPECT,
      0.1,
      100,
    )

    const updateCamera = () => {
      const cameraX = currentPointer.x + ambientCameraOffset.x
      const cameraY = currentPointer.y + ambientCameraOffset.y
      camera.position.set(
        cameraX * currentTuning.orbitX,
        cameraY * currentTuning.orbitY,
        REFERENCE_CAMERA_DISTANCE,
      )
      camera.lookAt(lookAtTarget)
      camera.zoom =
        1 +
        currentTuning.overscan *
          (0.4 + Math.max(Math.abs(cameraX), Math.abs(cameraY))) +
        ambientMotionFrame.cameraZoom *
          THREE.MathUtils.clamp(
            DEFAULT_TUNING.overscan > 0
              ? currentTuning.overscan / DEFAULT_TUNING.overscan
              : 0,
            0,
            1,
          )
      camera.updateProjectionMatrix()
    }

    const updateTourMarker = () => {
      if (!tourEnabled || !modelRoot) return
      const focusNode = depthNodes.get(FIGURE_NAMES[tourActiveIndex])?.node
      if (!focusNode) return
      focusNode.updateWorldMatrix(true, false)
      focusNode.getWorldPosition(tourProjectedPosition).project(camera)
      const x = THREE.MathUtils.clamp(
        (tourProjectedPosition.x * 0.5 + 0.5) * 100,
        10,
        90,
      )
      const y = THREE.MathUtils.clamp(
        (-tourProjectedPosition.y * 0.5 + 0.5) * 100,
        9,
        91,
      )
      host.style.setProperty('--tour-x', `${x.toFixed(2)}%`)
      host.style.setProperty('--tour-y', `${y.toFixed(2)}%`)
    }

    const render = (showOverlay: boolean) => {
      updateCamera()
      updateTourMarker()
      renderer.render(scene, camera)
      if (
        currentTuning.spectralEnabled &&
        currentTuning.spectralIntensity > 0.001
      ) {
        spectralPostProcess.render(renderer)
      }
      if (showOverlay) inkPostProcess.render(renderer)
      if (modelRoot && !hasReportedReady) {
        hasReportedReady = true
        host.dataset.ready = 'true'
        host.dataset.model = MODEL_NAME
        setSceneStatus('ready')
      }
    }

    const laplaceStickerRuntime = createLaplaceStickerRuntime({
      scene,
      camera,
      renderer,
      host,
      getTuning: () => currentTuning,
      isDisposed: () => disposed,
      scheduleFrame: () => scheduleFrame(),
    })

    const transitionProgress = (
      transition: InkTransition | undefined,
      time: number,
    ) =>
      transition
        ? THREE.MathUtils.clamp(
            (time - transition.start) / transition.duration,
            0,
            1,
          )
        : 1

    const clearInkMotion = (clearModeTransition = true) => {
      inkVelocity.set(0, 0)
      inkHistory = []
      inkClickTransition = undefined
      if (clearModeTransition) inkModeTransition = undefined
      inkPointerActive = false
      inkPressed = false
      inkPressPointerId = null
      inkPointerTime = 0
      inkHistoryUniforms.forEach((uniform) =>
        uniform.set(inkPointer.x, inkPointer.y, 0, 0),
      )
      host.dataset.inkActive = 'false'
      host.dataset.inkHistoryCount = '0'
      host.dataset.inkClickSweepActive = 'false'
      if (clearModeTransition) host.dataset.inkModeSweepActive = 'false'
    }

    const startInkModeTransition = (time = performance.now()) => {
      if (reduceMotion) return
      const origin = inkPointer.clone()
      inkModeTransition = {
        start: time,
        duration: INK_MODE_TRANSITION_MS,
        origin,
      }
      inkTransitionOrigin.copy(origin)
    }

    const setInkPointer = (
      x: number,
      y: number,
      active: boolean,
      pressed: boolean,
      bounds?: DOMRectReadOnly,
      time = performance.now(),
    ) => {
      const nextX = THREE.MathUtils.clamp(Number.isFinite(x) ? x : 0.5, 0, 1)
      const nextY = THREE.MathUtils.clamp(Number.isFinite(y) ? y : 0.5, 0, 1)
      const elapsed = inkPointerTime
        ? Math.max(8, time - inkPointerTime)
        : 16.667
      const pointerBounds = bounds ?? host.getBoundingClientRect()
      const rawVelocityX =
        ((nextX - inkPointer.x) * Math.max(pointerBounds.width, 1) * 1000) /
        elapsed
      const rawVelocityY =
        ((nextY - inkPointer.y) * Math.max(pointerBounds.height, 1) * 1000) /
        elapsed
      const velocityBlend = THREE.MathUtils.clamp(elapsed / 34, 0.24, 0.78)

      if (inkPointerTime && inkPointerActive) {
        const distance = Math.hypot(nextX - inkPointer.x, nextY - inkPointer.y)
        const latest = inkHistory[0]
        if (distance > 0.0012 || !latest || time - latest.time > 20) {
          inkHistory.unshift({
            x: inkPointer.x,
            y: inkPointer.y,
            time,
            speed: THREE.MathUtils.clamp(
              Math.hypot(rawVelocityX, rawVelocityY) / 1500,
              0,
              1,
            ),
          })
          inkHistory.length = Math.min(inkHistory.length, INK_HISTORY_COUNT)
        }
      }

      inkVelocity.x += (rawVelocityX - inkVelocity.x) * velocityBlend
      inkVelocity.y += (rawVelocityY - inkVelocity.y) * velocityBlend
      inkPointer.set(nextX, nextY)
      inkPointerTime = time
      inkPointerActive = active

      if (pressed && !inkPressed && !reduceMotion) {
        const origin = inkPointer.clone()
        inkClickTransition = {
          start: time,
          duration: INK_CLICK_TRANSITION_MS,
          origin,
        }
        inkTransitionOrigin.copy(origin)
      }
      inkPressed = pressed
      scheduleFrame()
    }

    const clearKineticMotion = () => {
      kineticWave = undefined
      kineticVelocity.set(0, 0)
      figureMotionStates.forEach((state) => {
        state.pointer.copy(currentPointer)
        state.velocity.set(0, 0)
      })
      host.dataset.motionActive = 'false'
      host.dataset.motionPulse = 'false'
    }

    const resetRuntimeTransform = (transform: FigureRuntimeTransform) => {
      transform.node.position.copy(transform.position)
      transform.node.rotation.copy(transform.rotation)
      transform.node.scale.copy(transform.scale)
    }

    const clearAmbientMotion = () => {
      ambientCameraOffset.set(0, 0)
      ambientMotionFrame.cameraZoom = 0
      ambientMotionFrame.cameraWeight = 0
      sceneChoreographyFrame.impactWeight = 0
      laplaceStickerRuntime.hide()
      figureTransforms.forEach(resetRuntimeTransform)
      staticOverlayTransforms.forEach(resetRuntimeTransform)
      if (modelRoot) modelRoot.updateMatrixWorld(true)
    }

    const triggerKineticWave = (
      origin: THREE.Vector2,
      strength = 1,
      time = performance.now(),
    ) => {
      if (!currentTuning.motionEnabled || reduceMotion) return
      kineticWave = {
        start: time,
        duration: KINETIC_WAVE_MS,
        origin: origin.clone(),
        strength: THREE.MathUtils.clamp(strength, 0.25, 1.4),
      }
      kineticWaveOrigin.copy(origin)
      host.dataset.motionPulse = 'true'
      scheduleFrame()
    }

    const activateTourStep = (
      figureIndex: number,
      time: number,
      fromPointer = targetPointer,
      cue?: TourCue,
    ) => {
      tourActiveIndex = THREE.MathUtils.clamp(
        Math.round(figureIndex),
        0,
        FIGURE_NAMES.length - 1,
      )
      tourFromPointer.copy(fromPointer)
      tourStepStartedAt = time
      tourStepDuration = cue?.duration ?? TOUR_STEP_MS
      tourTransitionDuration = cue?.transition ?? TOUR_TRANSITION_MS
      host.dataset.tourStep = String(tourActiveIndex + 1)
      host.style.setProperty('--tour-step-ms', `${tourStepDuration}ms`)
      setTourActiveIndex(tourActiveIndex)
      setTourStepEpoch((epoch) => epoch + 1)
      const [targetX, targetY] = TOUR_POINTER_TARGETS[tourActiveIndex]
      kineticWaveOrigin.set(targetX * 0.5 + 0.5, 0.5 - targetY * 0.5)
      triggerKineticWave(kineticWaveOrigin, cue?.pulse ?? 0.82, time)
    }

    const updateTour = (time: number, deltaSeconds: number) => {
      let needsAnimation = false
      if (tourEnabled) {
        const [targetX, targetY] = TOUR_POINTER_TARGETS[tourActiveIndex]
        tourTargetPointer.set(targetX, targetY)
        if (reduceMotion) {
          targetPointer.copy(tourTargetPointer)
          currentPointer.copy(tourTargetPointer)
        } else if (time >= tourManualUntil) {
          if (tourWasManual) {
            tourWasManual = false
            activateTourStep(tourActiveIndex, time, targetPointer)
          }
          let elapsed = time - tourStepStartedAt
          if (elapsed >= tourStepDuration) {
            tourSequenceCursor =
              (tourSequenceCursor + 1) % TOUR_SCORE.length
            const cue = TOUR_SCORE[tourSequenceCursor]
            activateTourStep(
              cue.figureIndex,
              time,
              targetPointer,
              cue,
            )
            elapsed = 0
            const [nextX, nextY] = TOUR_POINTER_TARGETS[tourActiveIndex]
            tourTargetPointer.set(nextX, nextY)
          }
          const progress = THREE.MathUtils.clamp(
            elapsed / tourTransitionDuration,
            0,
            1,
          )
          const eased = progress * progress * (3 - 2 * progress)
          targetPointer.lerpVectors(
            tourFromPointer,
            tourTargetPointer,
            eased,
          )
          needsAnimation = true
        } else {
          tourWasManual = true
          needsAnimation = true
        }
      }

      const weightBlend = 1 - Math.exp(-8 * deltaSeconds)
      FIGURE_NAMES.forEach((_, index) => {
        const targetWeight =
          tourEnabled && !reduceMotion && index === tourActiveIndex ? 1 : 0
        const previousWeight = tourLayerWeights[index]
        const nextWeight = reduceMotion
          ? targetWeight
          : THREE.MathUtils.lerp(previousWeight, targetWeight, weightBlend)
        tourLayerWeights[index] =
          Math.abs(nextWeight - targetWeight) < 0.0005
            ? targetWeight
            : nextWeight
        if (
          tourLayerWeights[index] > 0.0005 ||
          Math.abs(tourLayerWeights[index] - targetWeight) > 0.0005
        ) {
          needsAnimation = true
        }
      })
      return needsAnimation
    }

    const updateFigureMotion = (
      deltaSeconds: number,
      waveState: ReturnType<typeof getKineticWaveState>,
    ) => {
      const strength = currentTuning.motionStrength
      const enabled =
        currentTuning.motionEnabled && !reduceMotion && strength > 0.001
      const elasticity = currentTuning.motionElasticity
      const waveStrength = kineticWave?.strength ?? 0
      let motionEnergy = 0

      FIGURE_NAMES.forEach((name, index) => {
        const state = figureMotionStates[index]
        if (enabled) {
          const response = 16 - index * 1.65 - elasticity * 2.6
          const stiffness = response * response
          const damping = response * (1.28 - elasticity * 0.44)
          state.velocity.x +=
            (targetPointer.x - state.pointer.x) * stiffness * deltaSeconds
          state.velocity.y +=
            (targetPointer.y - state.pointer.y) * stiffness * deltaSeconds
          state.velocity.multiplyScalar(Math.exp(-damping * deltaSeconds))
          state.pointer.addScaledVector(state.velocity, deltaSeconds)
        } else {
          state.pointer.copy(currentPointer)
          state.velocity.set(0, 0)
        }

        const lagX = state.pointer.x - currentPointer.x
        const lagY = state.pointer.y - currentPointer.y
        const depthResponse = 1 - index * 0.13
        const layerPulse = enabled
          ? getLayerWaveWeight(
              waveState.progress,
              index,
              FIGURE_NAMES.length,
              elasticity,
            ) *
            waveState.envelope *
            waveStrength
          : 0
        const transform = figureTransforms.get(name)
        if (transform) {
          transform.node.position.copy(transform.position)
          transform.node.rotation.copy(transform.rotation)
          transform.node.position.x +=
            lagX * KINETIC_LAYER_SHIFT * strength * depthResponse
          transform.node.position.y +=
            lagY * KINETIC_LAYER_SHIFT * strength * depthResponse
          transform.node.position.z +=
            TOUR_LAYER_LIFT * tourLayerWeights[index] +
            KINETIC_LAYER_LIFT * strength * layerPulse
          transform.node.scale.copy(transform.scale).multiplyScalar(
            1 +
              TOUR_LAYER_SCALE * tourLayerWeights[index] +
              KINETIC_LAYER_SCALE * strength * layerPulse,
          )
        }
        motionEnergy +=
          state.velocity.lengthSq() +
          lagX * lagX +
          lagY * lagY +
          layerPulse * layerPulse
      })
      if (modelRoot) modelRoot.updateMatrixWorld(true)
      return enabled && motionEnergy > 0.000002
    }

    const updateAmbientMotion = (time: number) => {
      const enabled =
        currentTuning.motionEnabled &&
        !reduceMotion &&
        document.visibilityState === 'visible'
      if (!enabled) {
        laplaceStickerRuntime.hide()
        return false
      }

      ambientMotionOptions.intensity = currentTuning.ambientIntensity
      ambientMotionOptions.cameraIntensity = currentTuning.ambientCamera
      ambientMotionOptions.layerIntensity = currentTuning.ambientLayers
      const sceneRhythm = THREE.MathUtils.clamp(
        currentTuning.sceneRhythm,
        0,
        1.5,
      )
      const focusWeight = sceneChoreographyFrame.focusWeight * sceneRhythm
      const impactWeight = sceneChoreographyFrame.impactWeight * sceneRhythm
      const ambientBeatWeight =
        sceneChoreographyFrame.ambientBeatWeight *
        sceneChoreographyFrame.ambientBeatStrength *
        sceneRhythm
      const ambientBeatDirection = sceneChoreographyFrame.ambientBeatDirection
      updateAmbientMotionFrame(
        ambientMotionFrame,
        time,
        lastPointerActivityAt,
        ambientMotionOptions,
      )
      ambientCameraOffset.set(
        ambientMotionFrame.cameraX,
        ambientMotionFrame.cameraY,
      )
      ambientCameraOffset.addScaledVector(
        currentPointer,
        -impactWeight * 0.014,
      )

      FIGURE_NAMES.forEach((name, index) => {
        const transform = figureTransforms.get(name)
        const motion = ambientMotionFrame.figures[index]
        if (!transform || !motion) return
        transform.node.position.x += motion.x
        transform.node.position.y += motion.y
        transform.node.position.z += motion.z
        transform.node.rotation.z += motion.rotation
        transform.node.scale.multiplyScalar(motion.scale)
        const depthWeight = 1 - index * 0.12
        const layerBeat =
          getChoreographyLayerWaveWeight(
            sceneChoreographyFrame.ambientBeatProgress,
            index,
            FIGURE_NAMES.length,
            ambientBeatDirection,
          ) * ambientBeatWeight
        transform.node.position.x -=
          currentPointer.x * focusWeight * 0.004 * depthWeight
        transform.node.position.y -=
          currentPointer.y * focusWeight * 0.0025 * depthWeight
        transform.node.position.z += impactWeight * (0.012 + depthWeight * 0.005)
        transform.node.position.y += layerBeat * (0.036 + depthWeight * 0.018)
        transform.node.position.z += layerBeat * (0.020 + depthWeight * 0.014)
        transform.node.rotation.z += layerBeat * (0.015 + depthWeight * 0.009)
        transform.node.scale.multiplyScalar(
          1 +
            impactWeight * (0.004 + depthWeight * 0.005) +
            layerBeat * (0.014 + depthWeight * 0.012),
        )
      })

      const overlayMotion = [
        ['Background_Lettering', ambientMotionFrame.lettering],
        ['Speech_Bubble', ambientMotionFrame.speechBubble],
        ['Whale', ambientMotionFrame.whale],
      ] as const
      overlayMotion.forEach(([name, motion], index) => {
        const transform = staticOverlayTransforms.get(name)
        if (!transform) return
        const focusParallax = focusWeight * (0.0025 + index * 0.002)
        const impactLift = impactWeight * (0.008 + index * 0.006)
        const overlayBeat =
          getChoreographyLayerWaveWeight(
            sceneChoreographyFrame.ambientBeatProgress,
            index,
            overlayMotion.length,
            ambientBeatDirection,
          ) *
          ambientBeatWeight *
          (0.48 + index * 0.22)
        transform.node.position.set(
          transform.position.x +
            motion.x -
            currentPointer.x * focusParallax +
            (index === 2 ? overlayBeat * 0.052 : overlayBeat * 0.014),
          transform.position.y +
            motion.y -
            currentPointer.y * focusParallax * 0.55 +
            impactLift +
            overlayBeat * (index === 1 ? 0.052 : 0.022),
          transform.position.z + motion.z,
        )
        transform.node.rotation.copy(transform.rotation)
        transform.node.rotation.z +=
          motion.rotation +
          impactWeight * (index === 1 ? -0.018 : 0.006) +
          overlayBeat * (index === 1 ? -0.052 : 0.022)
        transform.node.scale.copy(transform.scale).multiplyScalar(
          motion.scale *
            (1 +
              impactWeight * (index === 2 ? 0.009 : 0.005) +
              overlayBeat * (index === 1 ? 0.026 : 0.014)),
        )
      })

      if (modelRoot) modelRoot.updateMatrixWorld(true)
      updateCamera()
      laplaceStickerRuntime.update(time)
      return true
    }

    const tick = (time: number) => {
      frameId = null
      if (disposed) return

      const deltaSeconds = lastFrameTime
        ? Math.min((time - lastFrameTime) / 1000, 0.05)
        : 1 / 60
      lastFrameTime = time
      const tourNeedsAnimation = updateTour(time, deltaSeconds)
      const blend = 1 - Math.exp(-currentTuning.damping * deltaSeconds)
      previousPointer.copy(currentPointer)
      currentPointer.lerp(targetPointer, blend)
      const remaining = currentPointer.distanceToSquared(targetPointer)
      if (remaining <= POSITION_EPSILON * POSITION_EPSILON) {
        currentPointer.copy(targetPointer)
      }
      const velocityBlend = 1 - Math.exp(-14 * deltaSeconds)
      const rawKineticVelocityX =
        ((currentPointer.x - previousPointer.x) * viewportWidth * 0.5) /
        deltaSeconds
      const rawKineticVelocityY =
        (-(currentPointer.y - previousPointer.y) * viewportHeight * 0.5) /
        deltaSeconds
      kineticVelocity.x +=
        (rawKineticVelocityX - kineticVelocity.x) * velocityBlend
      kineticVelocity.y +=
        (rawKineticVelocityY - kineticVelocity.y) * velocityBlend
      if (kineticVelocity.lengthSq() < KINETIC_VELOCITY_EPSILON ** 2) {
        kineticVelocity.set(0, 0)
      }
      kineticPointer.set(
        currentPointer.x * 0.5 + 0.5,
        0.5 - currentPointer.y * 0.5,
      )
      const waveState = kineticWave
        ? getKineticWaveState(time, kineticWave.start, kineticWave.duration)
        : { active: false, progress: 1, envelope: 0 }
      const motionNeedsAnimation = updateFigureMotion(deltaSeconds, waveState)
      updateSceneChoreographyFrame(
        sceneChoreographyFrame,
        time,
        lastPointerActivityAt,
        lastSceneImpactAt,
      )
      const ambientNeedsAnimation = updateAmbientMotion(time)
      const kineticSpeed = THREE.MathUtils.clamp(
        kineticVelocity.length() / 900,
        0,
        1,
      )

      const elapsedMs = deltaSeconds * 1000
      const velocityDecay = Math.exp(-elapsedMs / 105)
      inkVelocity.multiplyScalar(velocityDecay)
      if (inkVelocity.lengthSq() < INK_VELOCITY_EPSILON ** 2) {
        inkVelocity.set(0, 0)
      }
      const trailLifetime =
        INK_HISTORY_LIFETIME_MS * currentTuning.inkTrailLifetime
      inkHistory = inkHistory.filter(
        (sample) => time - sample.time < trailLifetime,
      )

      const modeProgress = transitionProgress(inkModeTransition, time)
      const clickProgress = transitionProgress(inkClickTransition, time)
      const modeActive = Boolean(inkModeTransition) && modeProgress < 1
      const clickActive = Boolean(inkClickTransition) && clickProgress < 1
      if (inkModeTransition && !modeActive) inkModeTransition = undefined
      if (inkClickTransition && !clickActive) inkClickTransition = undefined
      const activeTransition = inkClickTransition ?? inkModeTransition
      if (activeTransition) inkTransitionOrigin.copy(activeTransition.origin)

      inkHistoryUniforms.forEach((uniform, index) => {
        const sample = inkHistory[index]
        if (!sample || reduceMotion) {
          uniform.set(inkPointer.x, inkPointer.y, 0, 0)
          return
        }
        const age = THREE.MathUtils.clamp(
          (time - sample.time) / trailLifetime,
          0,
          1,
        )
        uniform.set(
          sample.x,
          sample.y,
          (1 - age) * (1 - index * 0.075) * 0.92,
          sample.speed,
        )
      })

      const speed = THREE.MathUtils.clamp(inkVelocity.length() / 1500, 0, 1)
      inkPostProcess.setFrame({
        pointer: inkPointer,
        velocity: inkVelocity,
        history: inkHistoryUniforms,
        speed,
        pointerActive: inkPointerActive,
        pressed: inkPressed,
        reducedMotion: reduceMotion,
        modeProgress,
        modeActive,
        clickProgress,
        clickActive,
        transitionOrigin: inkTransitionOrigin,
      })

      const inkEnabled =
        currentTuning.inkEnabled && currentTuning.inkStrength > 0.001
      const showInk =
        inkEnabled &&
        (inkPointerActive || inkHistory.length > 0 || modeActive || clickActive)
      const inkNeedsAnimation =
        inkEnabled &&
        (inkHistory.length > 0 ||
          modeActive ||
          clickActive ||
          (inkPointerActive && inkVelocity.lengthSq() > 0))
      const showKinetic =
        currentTuning.motionEnabled &&
        currentTuning.motionStrength > 0.001 &&
        !reduceMotion &&
        (waveState.active || kineticSpeed > 0.008)
      const showSpectral =
        currentTuning.spectralEnabled &&
        currentTuning.spectralIntensity > 0.001
      const kineticNeedsAnimation =
        currentTuning.motionEnabled &&
        currentTuning.motionStrength > 0.001 &&
        !reduceMotion &&
        (waveState.active ||
          kineticVelocity.lengthSq() > KINETIC_VELOCITY_EPSILON ** 2 ||
          motionNeedsAnimation)
      const spectralNeedsAnimation = showSpectral && !reduceMotion
      host.dataset.inkActive = showInk ? 'true' : 'false'
      host.dataset.inkHistoryCount = String(inkHistory.length)
      host.dataset.inkModeSweepActive = modeActive ? 'true' : 'false'
      host.dataset.inkClickSweepActive = clickActive ? 'true' : 'false'
      host.dataset.motionActive =
        showKinetic || motionNeedsAnimation || ambientNeedsAnimation
          ? 'true'
          : 'false'
      host.dataset.motionPulse = waveState.active ? 'true' : 'false'
      host.dataset.choreography =
        currentTuning.motionEnabled
          ? sceneChoreographyFrame.mode
          : 'off'
      host.dataset.choreographyImpact =
        sceneChoreographyFrame.impactWeight > 0.001 ? 'true' : 'false'
      host.dataset.choreographyBeat =
        sceneChoreographyFrame.ambientBeatWeight.toFixed(3)
      spectralPostProcess.setFrame({
        time,
        pointer: kineticPointer,
        velocity: kineticVelocity,
        energy: Math.max(
          kineticSpeed,
          waveState.envelope * (kineticWave?.strength ?? 0),
          speed * 0.7,
        ),
        ambientDrift: ambientMotionFrame.cameraWeight,
        motionRestraint: currentTuning.ambientSpectralRestraint,
        reducedMotion: reduceMotion,
      })
      render(showInk || showKinetic)
      if (kineticWave && !waveState.active) kineticWave = undefined
      if (
        remaining > POSITION_EPSILON * POSITION_EPSILON ||
        time < warmupUntil ||
        inkNeedsAnimation ||
        tourNeedsAnimation ||
        kineticNeedsAnimation ||
        ambientNeedsAnimation ||
        spectralNeedsAnimation
      ) {
        frameId = requestAnimationFrame(tick)
      } else {
        lastFrameTime = 0
        host.dataset.raf = 'idle'
      }
    }

    scheduleFrame = () => {
      if (frameId === null) {
        host.dataset.raf = 'active'
        frameId = requestAnimationFrame(tick)
      }
    }

    const extendWarmup = (durationMs: number) => {
      warmupUntil = Math.max(warmupUntil, performance.now() + durationMs)
      scheduleFrame()
    }

    const setTourRuntime = (enabled: boolean, figureIndex = tourActiveIndex) => {
      tourEnabled = enabled
      host.dataset.tour = enabled ? 'on' : 'off'
      tourManualUntil = 0
      tourWasManual = false
      if (enabled) {
        const sequenceIndex = TOUR_SCORE.findIndex(
          (cue) => cue.figureIndex === figureIndex,
        )
        tourSequenceCursor = sequenceIndex >= 0 ? sequenceIndex : 0
        activateTourStep(
          figureIndex,
          performance.now(),
          targetPointer,
          TOUR_SCORE[tourSequenceCursor],
        )
      } else {
        targetPointer.set(0, 0)
      }
      extendWarmup(900)
    }

    const applyRuntimeTuning = (next: TuningSettings) => {
      const previousTuning = currentTuning
      const inkWasEnabled = previousTuning.inkEnabled
      const motionWasEnabled = previousTuning.motionEnabled
      currentTuning = next
      inkPostProcess.setSettings({
        strength: next.inkEnabled ? next.inkStrength : 0,
        pitch: next.inkPitch,
        registration: next.inkRegistration,
        trail: next.inkTrail,
        trailWidth: next.inkTrailWidth,
      })
      host.dataset.ink = next.inkEnabled ? 'on' : 'off'
      host.dataset.inkStrength = (
        next.inkEnabled ? next.inkStrength : 0
      ).toFixed(2)
      if (!next.inkEnabled) {
        clearInkMotion()
      } else if (!inkWasEnabled) {
        startInkModeTransition()
      }
      host.dataset.motion = next.motionEnabled ? 'on' : 'off'
      host.dataset.motionStrength = (
        next.motionEnabled ? next.motionStrength : 0
      ).toFixed(2)
      host.dataset.motionChromatic = next.motionChromatic.toFixed(2)
      if (!next.motionEnabled) {
        clearKineticMotion()
        clearAmbientMotion()
      } else if (!motionWasEnabled) {
        triggerKineticWave(kineticPointer, 0.88)
      }
      spectralPostProcess.setSettings({
        intensity: next.spectralEnabled ? next.spectralIntensity : 0,
        aberration: next.spectralAberration,
        shafts: next.spectralShafts,
        mist: next.spectralMist,
        grain: next.spectralGrain,
        grainSize: next.spectralGrainSize,
        grainFlow: next.spectralGrainFlow,
        glitch: next.spectralGlitch,
      })
      host.dataset.spectral = next.spectralEnabled ? 'on' : 'off'
      host.dataset.spectralIntensity = (
        next.spectralEnabled ? next.spectralIntensity : 0
      ).toFixed(2)

      const depthChanged =
        host.dataset.depthScale === undefined ||
        previousTuning.depthScale !== next.depthScale ||
        FIGURE_KEYS.some((key) => previousTuning[key] !== next[key])
      if (!depthChanged) {
        extendWarmup(INTERACTION_WARMUP_MS)
        return
      }
      const applyDepth = (entry: DepthRuntimeNode, depthOffset = 0) => {
        const { baseWorldPositions, baseWorldToLocal, positionAttribute } = entry
        for (let index = 0; index < positionAttribute.count; index += 1) {
          const sourceIndex = index * 3
          const sourceX = baseWorldPositions[sourceIndex]
          const sourceY = baseWorldPositions[sourceIndex + 1]
          const sourceZ = baseWorldPositions[sourceIndex + 2]
          const targetZ = remapDepth(sourceZ, next.depthScale, depthOffset)
          const rayScale = getReferenceRayScale(sourceZ, targetZ)
          depthVertex
            .set(sourceX * rayScale, sourceY * rayScale, targetZ)
            .applyMatrix4(baseWorldToLocal)
          positionAttribute.setXYZ(
            index,
            depthVertex.x,
            depthVertex.y,
            depthVertex.z,
          )
        }
        positionAttribute.needsUpdate = true
      }

      const background = depthNodes.get(BACKGROUND_NAME)
      if (background) applyDepth(background)
      STATIC_OVERLAY_NAMES.forEach((name) => {
        const entry = depthNodes.get(name)
        if (!entry) return
        applyDepth(entry)
      })
      FIGURE_NAMES.forEach((name, index) => {
        const entry = depthNodes.get(name)
        if (!entry) return
        applyDepth(entry, next[FIGURE_KEYS[index]])
      })
      const depths = FIGURE_NAMES.map((name, index) => {
        const entry = depthNodes.get(name)
        return entry
          ? remapDepth(
              entry.baseZ,
              next.depthScale,
              next[FIGURE_KEYS[index]],
            )
          : Number.NaN
      })
      const flat = isFlatDepth(next)
      const crossings = flat ? [] : getDepthCrossings(depths)
      host.dataset.depthScale = next.depthScale.toFixed(2)
      host.dataset.depthOrder = flat
        ? 'flat'
        : crossings.length
          ? 'crossed'
          : 'valid'
      host.dataset.depthWorldZ = JSON.stringify(
        depths.map((depth) => Number(depth.toFixed(4))),
      )
      host.dataset.depthCrossings = crossings
        .map((index) => `${index + 1}-${index + 2}`)
        .join(',')
      extendWarmup(INTERACTION_WARMUP_MS)
    }
    runtimeControlsRef.current = {
      apply: applyRuntimeTuning,
      setTour: setTourRuntime,
    }

    const layoutScene = () => {
      const width = Math.max(1, host.clientWidth)
      const height = Math.max(1, host.clientHeight)
      viewportWidth = width
      viewportHeight = height
      const viewportAspect = width / height

      const renderPixelRatio = Math.min(
        Math.max(window.devicePixelRatio || 1, MIN_RENDER_PIXEL_RATIO),
        MAX_RENDER_PIXEL_RATIO,
        Math.sqrt(MAX_RENDER_PIXELS / (width * height)),
      )
      renderer.setPixelRatio(renderPixelRatio)
      renderer.setSize(width, height, false)
      const drawingBufferSize = renderer.getDrawingBufferSize(new THREE.Vector2())
      inkPostProcess.resize(
        drawingBufferSize.x,
        drawingBufferSize.y,
        renderPixelRatio,
      )
      spectralPostProcess.resize(drawingBufferSize.x, drawingBufferSize.y)
      host.dataset.pixelRatio = renderPixelRatio.toFixed(2)
      camera.aspect = viewportAspect
      camera.fov =
        viewportAspect > REFERENCE_ASPECT
          ? THREE.MathUtils.radToDeg(
              2 *
                Math.atan(
                  (Math.tan(THREE.MathUtils.degToRad(REFERENCE_FOV / 2)) *
                    REFERENCE_ASPECT) /
                    viewportAspect,
                ),
            )
          : REFERENCE_FOV
      camera.updateProjectionMatrix()
      extendWarmup(INTERACTION_WARMUP_MS)
    }

    const resizeObserver = new ResizeObserver(layoutScene)
    resizeObserver.observe(host)

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    reduceMotion = motionQuery.matches
    const inputRuntime = createParallaxSceneInput({
      host,
      motionQuery,
      getReduceMotion: () => reduceMotion,
      setReduceMotion: (value) => { reduceMotion = value },
      getModelReady: () => Boolean(modelRoot),
      resetWarmup: () => { warmupUntil = 0 },
      getCurrentTuning: () => currentTuning,
      getTourEnabled: () => tourEnabled,
      setTourManualUntil: (value) => { tourManualUntil = value },
      setTourWasManual: (value) => { tourWasManual = value },
      setTourStepStartedAt: (value) => { tourStepStartedAt = value },
      tourFromPointer,
      figureMotionStates,
      currentPointer,
      targetPointer,
      kineticPointer,
      inkPointer,
      getInkPointerActive: () => inkPointerActive,
      getInkPressed: () => inkPressed,
      getInkPressPointerId: () => inkPressPointerId,
      setInkPressPointerId: (value) => { inkPressPointerId = value },
      setInkPointer,
      setLastPointerActivityAt: (value) => { lastPointerActivityAt = value },
      setLastSceneImpactAt: (value) => { lastSceneImpactAt = value },
      triggerKineticWave,
      clearInkMotion,
      clearKineticMotion,
      clearAmbientMotion,
      extendWarmup,
      scheduleFrame: () => scheduleFrame(),
    })
    inputRuntime.attach()

    const loadScene = async () => {
      try {
        const gltf = await new GLTFLoader().loadAsync(MODEL_URL)
        if (disposed) {
          disposeScene(gltf.scene)
          return
        }

        modelRoot = gltf.scene
        modelRoot.name = 'AnniversaryScene'
        modelRoot.updateMatrixWorld(true)
        let meshCount = 0
        modelRoot.traverse((object) => {
          const mesh = object as THREE.Mesh
          if (!mesh.isMesh) return
          if (
            DEPTH_NODE_NAMES.includes(
              object.name as (typeof DEPTH_NODE_NAMES)[number],
            )
          ) {
            const positionAttribute = mesh.geometry.getAttribute('position')
            if (!positionAttribute || positionAttribute.itemSize < 3) {
              throw new Error(`Depth layer ${object.name} has no XYZ positions.`)
            }
            const baseWorldPositions = new Float32Array(
              positionAttribute.count * 3,
            )
            for (let index = 0; index < positionAttribute.count; index += 1) {
              depthVertex
                .set(
                  positionAttribute.getX(index),
                  positionAttribute.getY(index),
                  positionAttribute.getZ(index),
                )
                .applyMatrix4(mesh.matrixWorld)
              const targetIndex = index * 3
              baseWorldPositions[targetIndex] = depthVertex.x
              baseWorldPositions[targetIndex + 1] = depthVertex.y
              baseWorldPositions[targetIndex + 2] = depthVertex.z
            }
            mesh.getWorldPosition(depthVertex)
            depthNodes.set(object.name, {
              node: mesh,
              baseZ: depthVertex.z,
              positionAttribute,
              baseWorldPositions,
              baseWorldToLocal: mesh.matrixWorld.clone().invert(),
            })
          }
          meshCount += 1
          const isFigure = FIGURE_NAMES.includes(
            object.name as (typeof FIGURE_NAMES)[number],
          )
          if (isFigure) {
            figureTransforms.set(object.name, {
              node: mesh,
              position: mesh.position.clone(),
              rotation: mesh.rotation.clone(),
              scale: mesh.scale.clone(),
            })
          }
          const isStaticOverlay = STATIC_OVERLAY_NAMES.includes(
            object.name as (typeof STATIC_OVERLAY_NAMES)[number],
          )
          if (isStaticOverlay) {
            staticOverlayTransforms.set(object.name, {
              node: mesh,
              position: mesh.position.clone(),
              rotation: mesh.rotation.clone(),
              scale: mesh.scale.clone(),
            })
          }
          mesh.renderOrder = LAYER_RENDER_ORDER[object.name] ?? 0
          const sourceMaterials = Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material]
          const replacements = sourceMaterials.map((material) =>
            configureSceneMaterial(
              material,
              renderer,
              isFigure ? 'figure' : isStaticOverlay ? 'static' : 'opaque',
              supportsAlphaToCoverage,
            ),
          )
          mesh.material = Array.isArray(mesh.material)
            ? replacements
            : replacements[0]
          mesh.frustumCulled = false
        })

        const missingDepthNodes = DEPTH_NODE_NAMES.filter(
          (name) => !depthNodes.has(name),
        )
        if (missingDepthNodes.length) {
          throw new Error(
            `GLB scene is missing required layers: ${missingDepthNodes.join(', ')}`,
          )
        }

        const loadedFigureDepths = FIGURE_NAMES.map(
          (name, index) => depthNodes.get(name)?.baseZ ?? DEFAULT_FIGURE_DEPTHS[index],
        )
        setFigureBaseDepths(loadedFigureDepths)
        if (import.meta.env.DEV) {
          const drifted = loadedFigureDepths.some(
            (depth, index) => Math.abs(depth - DEFAULT_FIGURE_DEPTHS[index]) > 0.0001,
          )
          if (drifted) console.warn('GLB figure depths differ from editor fallbacks.')
        }

        scene.add(modelRoot)
        void laplaceStickerRuntime.load()
        host.dataset.layers = String(meshCount)
        host.dataset.inkPass = 'framebuffer-copy'
        host.dataset.edgeMode = supportsAlphaToCoverage ? 'msaa' : 'blend'
        host.dataset.samples = String(gl.getParameter(gl.SAMPLES))
        extendWarmup(reduceMotion ? INTERACTION_WARMUP_MS : STARTUP_WARMUP_MS)
        applyRuntimeTuning(currentTuning)
        layoutScene()
        kineticWaveOrigin.set(0.5, 0.5)
        triggerKineticWave(kineticWaveOrigin, 1.12)
      } catch (error) {
        if (disposed) return
        host.dataset.error = 'true'
        setSceneStatus('error')
        console.error('Unable to initialize the GLB scene:', error)
      }
    }

    void loadScene()
    layoutScene()

    return () => {
      disposed = true
      if (frameId !== null) cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      inputRuntime.detach()
      delete host.dataset.ready
      delete host.dataset.error
      delete host.dataset.model
      delete host.dataset.layers
      delete host.dataset.edgeMode
      delete host.dataset.samples
      delete host.dataset.pixelRatio
      delete host.dataset.ink
      delete host.dataset.inkStrength
      delete host.dataset.inkActive
      delete host.dataset.inkHistoryCount
      delete host.dataset.inkModeSweepActive
      delete host.dataset.inkClickSweepActive
      delete host.dataset.inkPass
      delete host.dataset.motion
      delete host.dataset.motionStrength
      delete host.dataset.motionChromatic
      delete host.dataset.motionActive
      delete host.dataset.motionPulse
      delete host.dataset.choreography
      delete host.dataset.choreographyImpact
      delete host.dataset.choreographyBeat
      delete host.dataset.laplaceStickers
      delete host.dataset.raf
      delete host.dataset.depthScale
      delete host.dataset.depthOrder
      delete host.dataset.depthWorldZ
      delete host.dataset.depthCrossings
      delete host.dataset.tour
      delete host.dataset.tourStep
      host.style.removeProperty('--tour-x')
      host.style.removeProperty('--tour-y')
      host.style.removeProperty('--tour-step-ms')
      runtimeControlsRef.current = null
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current)
        copyResetTimerRef.current = null
      }

      if (modelRoot) {
        scene.remove(modelRoot)
        disposeScene(modelRoot)
      }
      laplaceStickerRuntime.dispose()
      inkPostProcess.dispose()
      spectralPostProcess.dispose()
      renderer.dispose()
    }
}
