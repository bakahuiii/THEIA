import * as THREE from 'three'
import {
  POINTER_MARGIN,
  RESUME_WARMUP_MS,
  TOUR_MANUAL_RELEASE_MS,
  type TuningSettings,
} from './parallax-scene-config'

type FigureMotionState = {
  pointer: THREE.Vector2
  velocity: THREE.Vector2
}

type PointerPosition = {
  x: number
  y: number
  inside: boolean
  bounds: DOMRect
}

export type ParallaxSceneInputOptions = {
  host: HTMLDivElement
  motionQuery: MediaQueryList
  getReduceMotion: () => boolean
  setReduceMotion: (value: boolean) => void
  getModelReady: () => boolean
  resetWarmup: () => void
  getCurrentTuning: () => TuningSettings
  getTourEnabled: () => boolean
  setTourManualUntil: (value: number) => void
  setTourWasManual: (value: boolean) => void
  setTourStepStartedAt: (value: number) => void
  tourFromPointer: THREE.Vector2
  figureMotionStates: FigureMotionState[]
  currentPointer: THREE.Vector2
  targetPointer: THREE.Vector2
  kineticPointer: THREE.Vector2
  inkPointer: THREE.Vector2
  getInkPointerActive: () => boolean
  getInkPressed: () => boolean
  getInkPressPointerId: () => number | null
  setInkPressPointerId: (value: number | null) => void
  setInkPointer: (
    x: number,
    y: number,
    active: boolean,
    pressed: boolean,
    bounds?: DOMRectReadOnly,
  ) => void
  setLastPointerActivityAt: (value: number) => void
  setLastSceneImpactAt: (value: number) => void
  triggerKineticWave: (origin: THREE.Vector2, strength?: number) => void
  clearInkMotion: () => void
  clearKineticMotion: () => void
  clearAmbientMotion: () => void
  extendWarmup: (durationMs: number) => void
  scheduleFrame: () => void
}

export function createParallaxSceneInput({
  host,
  motionQuery,
  getReduceMotion,
  setReduceMotion,
  getModelReady,
  resetWarmup,
  getCurrentTuning,
  getTourEnabled,
  setTourManualUntil,
  setTourWasManual,
  setTourStepStartedAt,
  tourFromPointer,
  figureMotionStates,
  currentPointer,
  targetPointer,
  kineticPointer,
  inkPointer,
  getInkPointerActive,
  getInkPressed,
  getInkPressPointerId,
  setInkPressPointerId,
  setInkPointer,
  setLastPointerActivityAt,
  setLastSceneImpactAt,
  triggerKineticWave,
  clearInkMotion,
  clearKineticMotion,
  clearAmbientMotion,
  extendWarmup,
  scheduleFrame,
}: ParallaxSceneInputOptions) {
  const pointerPosition = (event: PointerEvent): PointerPosition | null => {
    const bounds = host.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return null
    return {
      x: THREE.MathUtils.clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      y: THREE.MathUtils.clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
      inside: event.clientX >= bounds.left && event.clientX <= bounds.right
        && event.clientY >= bounds.top && event.clientY <= bounds.bottom,
      bounds,
    }
  }

  const isInterfaceTarget = (target: EventTarget | null) => target instanceof Element
    && Boolean(target.closest(
      '[data-scene-ui], button, a, input, textarea, select, [role="button"], [contenteditable="true"]',
    ))

  const recenter = () => {
    if (getTourEnabled()) {
      setTourManualUntil(0)
      setTourWasManual(true)
    } else {
      targetPointer.set(0, 0)
    }
    setInkPressPointerId(null)
    setInkPointer(inkPointer.x, inkPointer.y, false, false)
    scheduleFrame()
  }

  const onPointerMove = (event: PointerEvent) => {
    if (getReduceMotion() || !event.isPrimary) return
    const pressPointerId = getInkPressPointerId()
    if (pressPointerId === event.pointerId && (event.buttons & 1) === 0) {
      setInkPressPointerId(null)
    }
    if (isInterfaceTarget(event.target)) {
      setInkPressPointerId(null)
      if (getInkPointerActive() || getInkPressed()) {
        setInkPointer(inkPointer.x, inkPointer.y, false, false)
      }
      return
    }
    if (getTourEnabled()) {
      setTourManualUntil(performance.now() + TOUR_MANUAL_RELEASE_MS)
      setTourWasManual(true)
    }
    const pointer = pointerPosition(event)
    if (!pointer) return
    setLastPointerActivityAt(performance.now())
    kineticPointer.set(pointer.x, pointer.y)
    targetPointer.set(
      THREE.MathUtils.clamp(pointer.x * 2 - 1, -1 + POINTER_MARGIN, 1 - POINTER_MARGIN),
      THREE.MathUtils.clamp(1 - pointer.y * 2, -1 + POINTER_MARGIN, 1 - POINTER_MARGIN),
    )
    if (getCurrentTuning().inkEnabled) {
      setInkPointer(
        pointer.x,
        pointer.y,
        true,
        getInkPressPointerId() === event.pointerId && (event.buttons & 1) !== 0,
        pointer.bounds,
      )
    } else {
      inkPointer.set(pointer.x, pointer.y)
      scheduleFrame()
    }
  }

  const onPointerDown = (event: PointerEvent) => {
    if (!getModelReady() || getReduceMotion() || !event.isPrimary || event.button !== 0 || isInterfaceTarget(event.target)) return
    const pointer = pointerPosition(event)
    if (!pointer) return
    const now = performance.now()
    setLastPointerActivityAt(now)
    setLastSceneImpactAt(now)
    kineticPointer.set(pointer.x, pointer.y)
    triggerKineticWave(kineticPointer, 1)
    if (!getCurrentTuning().inkEnabled) return
    setInkPressPointerId(event.pointerId)
    setInkPointer(pointer.x, pointer.y, true, true, pointer.bounds)
  }

  const onPointerUp = (event: PointerEvent) => {
    if (!event.isPrimary) return
    const ownsPress = getInkPressPointerId() === event.pointerId
    if (ownsPress) setInkPressPointerId(null)
    if (!ownsPress && !(event.button === 0 && getInkPressed())) return
    const pointer = pointerPosition(event)
    if (!pointer || !pointer.inside || isInterfaceTarget(event.target) || getReduceMotion()) {
      setInkPointer(inkPointer.x, inkPointer.y, false, false)
      return
    }
    setInkPointer(
      pointer.x,
      pointer.y,
      getCurrentTuning().inkEnabled && event.pointerType === 'mouse',
      false,
      pointer.bounds,
    )
  }

  const onPointerCancel = (event: PointerEvent) => {
    if (!event.isPrimary) return
    const pressPointerId = getInkPressPointerId()
    if (pressPointerId !== null && pressPointerId !== event.pointerId) return
    setInkPressPointerId(null)
    setInkPointer(inkPointer.x, inkPointer.y, false, false)
  }

  const onWindowBlur = () => {
    targetPointer.set(0, 0)
    clearInkMotion()
    clearKineticMotion()
    clearAmbientMotion()
    scheduleFrame()
  }

  const onMotionPreferenceChange = (event: MediaQueryListEvent) => {
    setReduceMotion(event.matches)
    if (event.matches) {
      resetWarmup()
      targetPointer.set(0, 0)
      currentPointer.set(0, 0)
      clearInkMotion()
      clearKineticMotion()
      clearAmbientMotion()
    } else {
      figureMotionStates.forEach((state) => {
        state.pointer.copy(currentPointer)
        state.velocity.set(0, 0)
      })
      if (getTourEnabled()) {
        setTourStepStartedAt(performance.now())
        tourFromPointer.copy(currentPointer)
      }
      extendWarmup(RESUME_WARMUP_MS)
    }
    if (event.matches) scheduleFrame()
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') extendWarmup(RESUME_WARMUP_MS)
    else {
      clearInkMotion()
      clearKineticMotion()
      clearAmbientMotion()
    }
  }

  const attach = () => {
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerdown', onPointerDown, { passive: true })
    window.addEventListener('pointerleave', recenter)
    window.addEventListener('pointerup', onPointerUp, { passive: true })
    window.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('blur', onWindowBlur)
    document.addEventListener('visibilitychange', onVisibilityChange)
    motionQuery.addEventListener('change', onMotionPreferenceChange)
  }

  const detach = () => {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('pointerleave', recenter)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerCancel)
    window.removeEventListener('blur', onWindowBlur)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    motionQuery.removeEventListener('change', onMotionPreferenceChange)
  }

  return {
    attach,
    detach,
    recenter,
  }
}
