import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import {
  AudioWaveform,
  Blend,
  Camera,
  Check,
  Copy,
  Expand,
  Layers3,
  Minus,
  Minimize2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  Undo2,
  Zap,
} from 'lucide-react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  getReferenceRayScale,
  REFERENCE_CAMERA_DISTANCE,
  remapDepth,
} from './depthProjection'
import { INK_HISTORY_COUNT, InkPostProcess } from './inkPostProcess'
import {
  getKineticWaveState,
  getLayerWaveWeight,
} from './kineticMotion'
import {
  createAmbientMotionFrame,
  updateAmbientMotionFrame,
} from './ambientMotion'
import {
  createSceneChoreographyFrame,
  getChoreographyLayerWaveWeight,
  updateSceneChoreographyFrame,
} from './sceneChoreography'
import {
  getLaplaceStickerFrames,
  getLaplaceSwimmerProfile,
  LAPLACE_SWIMMER_COUNT,
  LAPLACE_WORLD_X_WRAP,
  type LaplaceStickerFrame,
} from './laplaceMotion'
import { SpectralPostProcess } from './spectralPostProcess'
import {
  PARALLAX_TUNING_EVENT,
  publishParallaxTuning,
} from './parallax-tuning'
import './parallax-scene.css'

type TuningSettings = {
  orbitX: number
  orbitY: number
  depthScale: number
  overscan: number
  damping: number
  inkEnabled: boolean
  inkStrength: number
  inkPitch: number
  inkRegistration: number
  inkTrail: number
  inkTrailWidth: number
  inkTrailLifetime: number
  motionEnabled: boolean
  motionStrength: number
  motionElasticity: number
  motionChromatic: number
  ambientIntensity: number
  ambientCamera: number
  ambientLayers: number
  sceneRhythm: number
  laplaceIntensity: number
  laplaceSpeed: number
  laplaceTailFrequency: number
  ambientSpectralRestraint: number
  spectralEnabled: boolean
  spectralIntensity: number
  spectralAberration: number
  spectralShafts: number
  spectralMist: number
  spectralGrain: number
  spectralGrainSize: number
  spectralGrainFlow: number
  spectralGlitch: number
  figure1Z: number
  figure2Z: number
  figure3Z: number
  figure4Z: number
  figure5Z: number
}

type NumericTuningKey = Exclude<
  keyof TuningSettings,
  'inkEnabled' | 'motionEnabled' | 'spectralEnabled'
>
type FigureTuningKey = Extract<keyof TuningSettings, `figure${number}Z`>
type DepthOffsets = Pick<TuningSettings, FigureTuningKey>

type RuntimeControls = {
  apply: (next: TuningSettings) => void
  setTour: (enabled: boolean, figureIndex?: number) => void
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

type LaplaceStickerRig = {
  facing: THREE.Group
  art: THREE.Group
  tailOne: THREE.Group
  tailTwo: THREE.Group
  worldPosition: THREE.Vector3
  hasWorldPosition: boolean
  worldDepth: number
  swimYaw: number
  tailPhaseSign: number
  body: THREE.Mesh
  tailOneMesh: THREE.Mesh
  tailTwoMesh: THREE.Mesh
  bodyMaterial: THREE.MeshBasicMaterial
  tailOneMaterial: THREE.MeshBasicMaterial
  tailTwoMaterial: THREE.MeshBasicMaterial
}

type SliderDefinition<TKey extends NumericTuningKey = NumericTuningKey> = {
  key: TKey
  label: string
  min: number
  max: number
  step: number
  digits: number
}

type SceneStatus = 'loading' | 'ready' | 'error'
type EditorTab = 'camera' | 'depth' | 'ink' | 'motion' | 'spectral'

type DepthPreset = {
  id: 'flat' | 'original' | 'strong'
  label: string
  depthScale: number
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

type TourCue = {
  figureIndex: number
  duration: number
  transition: number
  pulse: number
}

const MODEL_URL = new URL('./assets/anniversary_scene_editable.glb', import.meta.url).href
const MODEL_NAME = 'anniversary_scene_editable.glb'
const BACKGROUND_NAME = 'Background_Poster'
const REFERENCE_ASPECT = 1.7765440666204024
const REFERENCE_FOV = 45
const POINTER_MARGIN = 0.025
const POSITION_EPSILON = 0.0001
const STARTUP_WARMUP_MS = 3000
const RESUME_WARMUP_MS = 1000
const INTERACTION_WARMUP_MS = 250
const INK_HISTORY_LIFETIME_MS = 980
const INK_MODE_TRANSITION_MS = 920
const INK_CLICK_TRANSITION_MS = 680
const INK_VELOCITY_EPSILON = 0.5
const KINETIC_WAVE_MS = 1320
const KINETIC_VELOCITY_EPSILON = 2
const KINETIC_LAYER_SHIFT = 0.026
const KINETIC_LAYER_LIFT = 0.038
const KINETIC_LAYER_SCALE = 0.014
const MIN_RENDER_PIXEL_RATIO = 1.5
const MAX_RENDER_PIXEL_RATIO = 2
const MAX_RENDER_PIXELS = 8_294_400
const TUNING_STORAGE_KEY = 'parallax-glb-camera-tuning-v1'
const TUNING_SCHEMA_VERSION = 14
const DEPTH_ORDER_EPSILON = 0.002
const TOUR_STEP_MS = 2200
const TOUR_TRANSITION_MS = 760
const TOUR_MANUAL_RELEASE_MS = 1250
const TOUR_LAYER_LIFT = 0.052
const TOUR_LAYER_SCALE = 0.018
const FIGURE_NAMES = [
  'Figure_01_Near',
  'Figure_02_Mid_Near',
  'Figure_03_Middle',
  'Figure_04_Mid_Far',
  'Figure_05_Far',
] as const
const STATIC_OVERLAY_NAMES = [
  'Background_Lettering',
  'Speech_Bubble',
  'Whale',
] as const
const LAPLACE_STICKER_TEXTURES = {
  body: new URL('./assets/laplace-body.png', import.meta.url).href,
  tailOne: new URL('./assets/laplace-tail-1.png', import.meta.url).href,
  tailTwo: new URL('./assets/laplace-tail-2.png', import.meta.url).href,
} as const
const LAPLACE_BODY_ASPECT = 408 / 266
const LAPLACE_TAIL_ONE_ASPECT = 210 / 118
const LAPLACE_TAIL_TWO_ASPECT = 283 / 168
const DEPTH_NODE_NAMES = [
  BACKGROUND_NAME,
  ...STATIC_OVERLAY_NAMES,
  ...FIGURE_NAMES,
] as const
const FIGURE_KEYS = [
  'figure1Z',
  'figure2Z',
  'figure3Z',
  'figure4Z',
  'figure5Z',
] as const satisfies readonly FigureTuningKey[]
const DEFAULT_FIGURE_DEPTHS = [
  0.641702,
  0.382034,
  0.181011,
  0.026857,
  -0.084187,
] as const
const DEPTH_LAYER_COLORS = [
  '#ff6b66',
  '#ffd452',
  '#55d6be',
  '#72a5ff',
  '#b5b7c2',
] as const
const TOUR_POINTER_TARGETS = [
  [-0.72, 0.34],
  [-0.18, 0.08],
  [0.34, -0.16],
  [0.64, -0.28],
  [0.82, -0.38],
] as const
const TOUR_SCORE: readonly TourCue[] = [
  { figureIndex: 0, duration: 2100, transition: 820, pulse: 1 },
  { figureIndex: 1, duration: 1840, transition: 680, pulse: 0.76 },
  { figureIndex: 2, duration: 2460, transition: 940, pulse: 1.08 },
  { figureIndex: 3, duration: 1780, transition: 660, pulse: 0.72 },
  { figureIndex: 4, duration: 2260, transition: 860, pulse: 1.02 },
  { figureIndex: 3, duration: 1700, transition: 620, pulse: 0.68 },
  { figureIndex: 2, duration: 2200, transition: 820, pulse: 0.92 },
  { figureIndex: 1, duration: 1760, transition: 640, pulse: 0.7 },
] as const
const LAYER_RENDER_ORDER: Readonly<Record<string, number>> = {
  [BACKGROUND_NAME]: 0,
  Background_Lettering: 2,
  Speech_Bubble: 3,
  Whale: 4,
  Figure_05_Far: 10,
  Figure_04_Mid_Far: 20,
  Figure_03_Middle: 30,
  Figure_02_Mid_Near: 40,
  Figure_01_Near: 50,
}

const DEFAULT_TUNING: TuningSettings = {
  orbitX: 0.43,
  orbitY: 0.34,
  depthScale: 1.4,
  overscan: 0,
  damping: 9,
  inkEnabled: true,
  inkStrength: 1,
  inkPitch: 5.8,
  inkRegistration: 1.25,
  inkTrail: 1.5,
  inkTrailWidth: 1,
  inkTrailLifetime: 1,
  motionEnabled: true,
  motionStrength: 1,
  motionElasticity: 0.72,
  motionChromatic: 0.55,
  ambientIntensity: 1,
  ambientCamera: 1,
  ambientLayers: 1.02,
  sceneRhythm: 1,
  laplaceIntensity: 0.9,
  laplaceSpeed: 0.61,
  laplaceTailFrequency: 0.64,
  ambientSpectralRestraint: 0.11,
  spectralEnabled: true,
  spectralIntensity: 0.82,
  spectralAberration: 0.85,
  spectralShafts: 0.24,
  spectralMist: 0.72,
  spectralGrain: 0.43,
  spectralGrainSize: 1.5,
  spectralGrainFlow: 0.4,
  spectralGlitch: 0.09,
  figure1Z: 0,
  figure2Z: 0,
  figure3Z: 0,
  figure4Z: 0,
  figure5Z: 0,
}

const CAMERA_SLIDERS: SliderDefinition[] = [
  { key: 'orbitX', label: '横向视角', min: 0, max: 0.65, step: 0.01, digits: 2 },
  { key: 'orbitY', label: '纵向视角', min: 0, max: 0.5, step: 0.01, digits: 2 },
  { key: 'overscan', label: '边缘余量', min: 0, max: 0.18, step: 0.005, digits: 3 },
  { key: 'damping', label: '跟随速度', min: 2, max: 20, step: 0.5, digits: 1 },
]

const DEPTH_SCALE_SLIDER: SliderDefinition = {
  key: 'depthScale',
  label: '整体景深',
  min: 0,
  max: 1.8,
  step: 0.01,
  digits: 2,
}

const FIGURE_SLIDERS: SliderDefinition<FigureTuningKey>[] = [
  { key: 'figure1Z', label: 'F1 左侧最近', min: -0.9, max: 0.9, step: 0.01, digits: 2 },
  { key: 'figure2Z', label: 'F2 左中', min: -0.9, max: 0.9, step: 0.01, digits: 2 },
  { key: 'figure3Z', label: 'F3 中间', min: -0.9, max: 0.9, step: 0.01, digits: 2 },
  { key: 'figure4Z', label: 'F4 右中', min: -0.9, max: 0.9, step: 0.01, digits: 2 },
  { key: 'figure5Z', label: 'F5 右侧最远', min: -0.9, max: 0.9, step: 0.01, digits: 2 },
]

const INK_SLIDERS: SliderDefinition[] = [
  { key: 'inkStrength', label: '显影强度', min: 0, max: 1, step: 0.01, digits: 2 },
  { key: 'inkPitch', label: '网点尺寸', min: 3.8, max: 9, step: 0.1, digits: 1 },
  { key: 'inkRegistration', label: '套色偏移', min: 0, max: 3, step: 0.05, digits: 2 },
  { key: 'inkTrail', label: '尾迹强度', min: 0, max: 2.5, step: 0.05, digits: 2 },
  { key: 'inkTrailWidth', label: '尾迹宽度', min: 0.4, max: 1.8, step: 0.01, digits: 2 },
  { key: 'inkTrailLifetime', label: '尾迹存留', min: 0.35, max: 1.6, step: 0.01, digits: 2 },
]

const MOTION_SLIDERS: SliderDefinition[] = [
  { key: 'motionStrength', label: '动势', min: 0, max: 1.5, step: 0.01, digits: 2 },
  { key: 'motionElasticity', label: '层间弹性', min: 0, max: 1, step: 0.01, digits: 2 },
  { key: 'motionChromatic', label: '光谱色散', min: 0, max: 2, step: 0.05, digits: 2 },
]

const AMBIENT_MOTION_SLIDERS: SliderDefinition[] = [
  { key: 'ambientIntensity', label: '环境幅度', min: 0, max: 1.5, step: 0.01, digits: 2 },
  { key: 'ambientCamera', label: '镜头漂移', min: 0, max: 1.5, step: 0.01, digits: 2 },
  { key: 'ambientLayers', label: '图层呼吸', min: 0, max: 1.5, step: 0.01, digits: 2 },
  { key: 'sceneRhythm', label: '场景节奏', min: 0, max: 1.5, step: 0.01, digits: 2 },
  { key: 'laplaceIntensity', label: '贴纸浮游', min: 0, max: 1.5, step: 0.01, digits: 2 },
  { key: 'laplaceSpeed', label: '贴纸游速', min: 0.25, max: 2.25, step: 0.01, digits: 2 },
  { key: 'laplaceTailFrequency', label: '摆尾频率', min: 0.25, max: 2.5, step: 0.01, digits: 2 },
  { key: 'ambientSpectralRestraint', label: '光场协同', min: 0, max: 1, step: 0.01, digits: 2 },
]

const SPECTRAL_SLIDERS: SliderDefinition[] = [
  { key: 'spectralIntensity', label: '光场强度', min: 0, max: 1.5, step: 0.01, digits: 2 },
  { key: 'spectralAberration', label: '棱镜色散', min: 0, max: 5, step: 0.05, digits: 2 },
  { key: 'spectralShafts', label: '体积光束', min: 0, max: 1.5, step: 0.01, digits: 2 },
  { key: 'spectralMist', label: '流动雾场', min: 0, max: 1.5, step: 0.01, digits: 2 },
  { key: 'spectralGrain', label: '胶片颗粒', min: 0, max: 1, step: 0.01, digits: 2 },
  { key: 'spectralGrainSize', label: '颗粒尺寸', min: 0.5, max: 4, step: 0.1, digits: 1 },
  { key: 'spectralGrainFlow', label: '颗粒流速', min: 0, max: 1.5, step: 0.01, digits: 2 },
  { key: 'spectralGlitch', label: '扫描扰动', min: 0, max: 1, step: 0.01, digits: 2 },
]

const DEPTH_PRESETS: readonly DepthPreset[] = [
  { id: 'flat', label: '平面', depthScale: 0 },
  { id: 'original', label: '原始', depthScale: 1 },
  { id: 'strong', label: '强化', depthScale: 1.35 },
]

const ALL_SLIDERS = [
  ...CAMERA_SLIDERS,
  DEPTH_SCALE_SLIDER,
  ...FIGURE_SLIDERS,
  ...INK_SLIDERS,
  ...MOTION_SLIDERS,
  ...AMBIENT_MOTION_SLIDERS,
  ...SPECTRAL_SLIDERS,
]

type StoredTuning = Partial<TuningSettings> & {
  version?: unknown
}

function saveStoredTuning(
  tuning: TuningSettings,
  storageKey = TUNING_STORAGE_KEY,
) {
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify({ ...tuning, version: TUNING_SCHEMA_VERSION }),
    )
    if (storageKey.endsWith(':motion-lab')) {
      publishParallaxTuning(tuning, 'scene', storageKey)
    }
  } catch {
    // The editor remains usable when storage is disabled or full.
  }
}

function clampTuningValue(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
) {
  return typeof value === 'number' && Number.isFinite(value)
    ? THREE.MathUtils.clamp(value, min, max)
    : fallback
}

function loadStoredTuning(storageKey = TUNING_STORAGE_KEY): TuningSettings {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(storageKey) ?? 'null',
    )
    if (typeof stored !== 'object' || stored === null) {
      return { ...DEFAULT_TUNING }
    }

    const values = stored as StoredTuning
    const storedVersion =
      typeof values.version === 'number' ? values.version : 1
    const result = { ...DEFAULT_TUNING }
    result.inkEnabled =
      storedVersion >= 2 && typeof values.inkEnabled === 'boolean'
        ? values.inkEnabled
        : DEFAULT_TUNING.inkEnabled
    result.motionEnabled =
      storedVersion >= 4 && typeof values.motionEnabled === 'boolean'
        ? values.motionEnabled
        : DEFAULT_TUNING.motionEnabled
    result.spectralEnabled =
      storedVersion >= 8 && typeof values.spectralEnabled === 'boolean'
        ? values.spectralEnabled
        : DEFAULT_TUNING.spectralEnabled
    for (const slider of ALL_SLIDERS) {
      if (storedVersion < 2 && INK_SLIDERS.includes(slider)) continue
      if (
        storedVersion < 7 &&
        (slider.key === 'inkTrail' ||
          slider.key === 'inkTrailWidth' ||
          slider.key === 'inkTrailLifetime')
      ) {
        continue
      }
      result[slider.key] = clampTuningValue(
        values[slider.key],
        DEFAULT_TUNING[slider.key],
        slider.min,
        slider.max,
      )
    }

    // v1/v2 scaled the offset with the scene root. v3 stores an independent
    // world-space offset so a flattened scene can still be edited layer by layer.
    if (storedVersion < 3) {
      for (const key of FIGURE_KEYS) result[key] *= result.depthScale
    }
    if (storedVersion !== TUNING_SCHEMA_VERSION) {
      saveStoredTuning(result, storageKey)
    }
    return result
  } catch {
    return { ...DEFAULT_TUNING }
  }
}

function getDepthOffsets(tuning: TuningSettings): DepthOffsets {
  return {
    figure1Z: tuning.figure1Z,
    figure2Z: tuning.figure2Z,
    figure3Z: tuning.figure3Z,
    figure4Z: tuning.figure4Z,
    figure5Z: tuning.figure5Z,
  }
}

function getEffectiveDepths(
  tuning: TuningSettings,
  baseDepths: readonly number[],
) {
  return FIGURE_KEYS.map(
    (key, index) => baseDepths[index] * tuning.depthScale + tuning[key],
  )
}

function getDepthCrossings(depths: readonly number[]) {
  return depths.flatMap((depth, index) =>
    index < depths.length - 1 && depth <= depths[index + 1] + DEPTH_ORDER_EPSILON
      ? [index]
      : [],
  )
}

function isFlatDepth(tuning: TuningSettings) {
  return (
    Math.abs(tuning.depthScale) < DEPTH_ORDER_EPSILON &&
    FIGURE_KEYS.every((key) => Math.abs(tuning[key]) < DEPTH_ORDER_EPSILON)
  )
}

function configureSceneMaterial(
  source: THREE.Material,
  renderer: THREE.WebGLRenderer,
  cutoutKind: 'opaque' | 'figure' | 'static',
  supportsAlphaToCoverage: boolean,
) {
  const isCutout = cutoutKind !== 'opaque'
  const isFigure = cutoutKind === 'figure'
  const material = source as THREE.MeshStandardMaterial
  const map = material.map ?? null
  if (map) {
    map.colorSpace = THREE.SRGBColorSpace
    map.wrapS = THREE.ClampToEdgeWrapping
    map.wrapT = THREE.ClampToEdgeWrapping
    map.magFilter = THREE.LinearFilter
    map.minFilter = THREE.LinearMipmapLinearFilter
    map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
    map.needsUpdate = true
  }

  const replacement = new THREE.MeshBasicMaterial({
    name: source.name,
    map,
    color: 0xffffff,
    alphaTest: isFigure
      ? 1 / 255
      : isCutout
        ? supportsAlphaToCoverage
          ? 0.5
          : 0.01
        : 0,
    transparent: isFigure || (isCutout && !supportsAlphaToCoverage),
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  })
  replacement.alphaToCoverage =
    !isFigure && isCutout && supportsAlphaToCoverage
  replacement.premultipliedAlpha = false
  replacement.forceSinglePass = true
  source.dispose()
  return replacement
}

function disposeScene(root: THREE.Object3D) {
  const textures = new Set<THREE.Texture>()
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material]
    for (const material of materials) {
      const map = (material as THREE.MeshBasicMaterial).map
      if (map) textures.add(map)
      material.dispose()
    }
  })
  textures.forEach((texture) => texture.dispose())
}

export default function App() {
  const tuningStorageKey = `${TUNING_STORAGE_KEY}:motion-lab`
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const runtimeControlsRef = useRef<RuntimeControls | null>(null)
  const copyResetTimerRef = useRef<number | null>(null)
  const [tuning, setTuning] = useState<TuningSettings>(() =>
    loadStoredTuning(tuningStorageKey),
  )
  const tuningRef = useRef(tuning)
  const [figureBaseDepths, setFigureBaseDepths] = useState<readonly number[]>(
    DEFAULT_FIGURE_DEPTHS,
  )
  const [panelOpen, setPanelOpen] = useState(false)
  const [presentationMode, setPresentationMode] = useState(false)
  const [activeTab, setActiveTab] = useState<EditorTab>('depth')
  const [copied, setCopied] = useState(false)
  const [sceneStatus, setSceneStatus] = useState<SceneStatus>('loading')
  const [depthUndo, setDepthUndo] = useState<DepthOffsets | null>(null)
  const [tourEnabled, setTourEnabled] = useState(false)
  const [tourActiveIndex, setTourActiveIndex] = useState(0)
  const [tourStepEpoch, setTourStepEpoch] = useState(0)

  const toggleTour = () => {
    const next = !tourEnabled
    setTourEnabled(next)
    runtimeControlsRef.current?.setTour(next, tourActiveIndex)
  }

  const focusTourFigure = (figureIndex: number) => {
    setTourActiveIndex(figureIndex)
    setTourEnabled(true)
    runtimeControlsRef.current?.setTour(true, figureIndex)
  }

  useEffect(() => {
    tuningRef.current = tuning
  }, [tuning])

  const commitTuning = (next: TuningSettings) => {
    tuningRef.current = next
    saveStoredTuning(next, tuningStorageKey)
    runtimeControlsRef.current?.apply(next)
    setTuning(next)
  }

  const updateTuning = (key: NumericTuningKey, value: number) => {
    if ((FIGURE_KEYS as readonly NumericTuningKey[]).includes(key)) {
      setDepthUndo(null)
    }
    commitTuning({ ...tuningRef.current, [key]: value })
  }

  const updateInkEnabled = (enabled: boolean) => {
    commitTuning({ ...tuningRef.current, inkEnabled: enabled })
  }

  const updateMotionEnabled = (enabled: boolean) => {
    commitTuning({ ...tuningRef.current, motionEnabled: enabled })
  }

  const updateSpectralEnabled = (enabled: boolean) => {
    commitTuning({ ...tuningRef.current, spectralEnabled: enabled })
  }

  const applyTuningPatch = (patch: Partial<TuningSettings>) => {
    commitTuning({ ...tuningRef.current, ...patch })
  }

  const resetDepthLayer = (key: FigureTuningKey) => {
    updateTuning(key, DEFAULT_TUNING[key])
  }

  const applyDepthPreset = (preset: DepthPreset) => {
    applyTuningPatch({ depthScale: preset.depthScale })
  }

  const resetDepthOffsets = () => {
    const currentOffsets = getDepthOffsets(tuning)
    if (FIGURE_KEYS.every((key) => Math.abs(currentOffsets[key]) < 0.0001)) return
    setDepthUndo(currentOffsets)
    applyTuningPatch({
      figure1Z: 0,
      figure2Z: 0,
      figure3Z: 0,
      figure4Z: 0,
      figure5Z: 0,
    })
  }

  const undoDepthReset = () => {
    if (!depthUndo) return
    applyTuningPatch(depthUndo)
    setDepthUndo(null)
  }

  const activeDepthPreset = DEPTH_PRESETS.find(
    (preset) => Math.abs(tuning.depthScale - preset.depthScale) < 0.005,
  )?.id

  const effectiveDepths = getEffectiveDepths(tuning, figureBaseDepths)
  const depthCrossings = isFlatDepth(tuning)
    ? []
    : getDepthCrossings(effectiveDepths)

  const resetTuning = () => {
    const next = { ...DEFAULT_TUNING }
    try {
      localStorage.removeItem(tuningStorageKey)
    } catch {
      // Reset still applies to the live editor when storage is unavailable.
    }
    setDepthUndo(null)
    tuningRef.current = next
    setTuning(next)
    runtimeControlsRef.current?.apply(next)
  }

  const copyTuning = async () => {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          { model: MODEL_NAME, version: TUNING_SCHEMA_VERSION, ...tuning },
          null,
          2,
        ),
      )
      setCopied(true)
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current)
      }
      copyResetTimerRef.current = window.setTimeout(() => {
        copyResetTimerRef.current = null
        setCopied(false)
      }, 1200)
    } catch {
      setCopied(false)
    }
  }

  useEffect(() => {
    if (!presentationMode) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setPresentationMode(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [presentationMode])

  useEffect(() => {
    const onExternalTuning = (event: Event) => {
      const detail = (event as CustomEvent<{
        tuning?: Partial<TuningSettings>
        source?: string
      }>).detail
      if (!detail?.tuning || detail.source === 'scene') return
      const next = { ...loadStoredTuning(tuningStorageKey), ...detail.tuning }
      tuningRef.current = next
      setTuning(next)
      runtimeControlsRef.current?.apply(next)
    }
    window.addEventListener(PARALLAX_TUNING_EVENT, onExternalTuning)
    return () => window.removeEventListener(PARALLAX_TUNING_EVENT, onExternalTuning)
  }, [tuningStorageKey])

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return
    let disposed = false
    let frameId: number | null = null
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
    let laplaceStickerSchool: THREE.Group | null = null
    const laplaceStickerRigs: LaplaceStickerRig[] = []
    const laplaceStickerMaterials: THREE.MeshBasicMaterial[] = []
    const laplaceStickerGeometries: THREE.BufferGeometry[] = []
    const laplaceStickerTextures: THREE.Texture[] = []
    let laplaceLastMotionAt = 0
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

    const disposeLaplaceStickerSchool = () => {
      if (laplaceStickerSchool) scene.remove(laplaceStickerSchool)
      laplaceStickerSchool = null
      laplaceStickerRigs.length = 0
      laplaceLastMotionAt = 0
      laplaceStickerMaterials.forEach((material) => material.dispose())
      laplaceStickerMaterials.length = 0
      laplaceStickerGeometries.forEach((geometry) => geometry.dispose())
      laplaceStickerGeometries.length = 0
      laplaceStickerTextures.forEach((texture) => texture.dispose())
      laplaceStickerTextures.length = 0
    }

    const createLaplaceStickerMaterial = (texture: THREE.Texture) => {
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.004,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      })
      laplaceStickerMaterials.push(material)
      return material
    }

    const createLaplaceStickerRig = (
      index: number,
      bodyTexture: THREE.Texture,
      tailOneTexture: THREE.Texture,
      tailTwoTexture: THREE.Texture,
    ) => {
      const profile = getLaplaceSwimmerProfile(index)
      const facing = new THREE.Group()
      const art = new THREE.Group()
      art.name = 'LaplaceStickerArt'
      facing.add(art)

      const bodyGeometry = new THREE.PlaneGeometry(1, 1 / LAPLACE_BODY_ASPECT)
      const tailOneWidth = 210 / 408
      const tailTwoWidth = 283 / 408
      const tailOneGeometry = new THREE.PlaneGeometry(
        tailOneWidth,
        tailOneWidth / LAPLACE_TAIL_ONE_ASPECT,
      )
      const tailTwoGeometry = new THREE.PlaneGeometry(
        tailTwoWidth,
        tailTwoWidth / LAPLACE_TAIL_TWO_ASPECT,
      )
      laplaceStickerGeometries.push(
        bodyGeometry,
        tailOneGeometry,
        tailTwoGeometry,
      )

      const bodyMaterial = createLaplaceStickerMaterial(bodyTexture)
      const tailOneMaterial = createLaplaceStickerMaterial(tailOneTexture)
      const tailTwoMaterial = createLaplaceStickerMaterial(tailTwoTexture)
      const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
      const tailOne = new THREE.Group()
      const tailTwo = new THREE.Group()
      const tailOneMesh = new THREE.Mesh(tailOneGeometry, tailOneMaterial)
      const tailTwoMesh = new THREE.Mesh(tailTwoGeometry, tailTwoMaterial)

      // The three source layers are offset in depth. The slight side view makes
      // that construction visible without breaking the original silhouette.
      body.position.set(0.18, -0.12, 0.024)
      tailOne.position.set(0.17, -0.1, -0.006)
      tailTwo.position.set(0.17, -0.1, -0.032)
      tailOneMesh.position.set(-0.254, -0.022, 0)
      tailTwoMesh.position.set(-0.291, -0.025, 0)
      tailOne.add(tailOneMesh)
      tailTwo.add(tailTwoMesh)
      art.add(tailTwo, tailOne, body)

      return {
        facing,
        art,
        tailOne,
        tailTwo,
        worldPosition: new THREE.Vector3(),
        hasWorldPosition: false,
        worldDepth: profile.worldDepth,
        swimYaw: profile.swimYaw,
        tailPhaseSign: profile.tailPhaseSign,
        body,
        tailOneMesh,
        tailTwoMesh,
        bodyMaterial,
        tailOneMaterial,
        tailTwoMaterial,
      }
    }

    const loadLaplaceStickerSchool = async () => {
      try {
        const textureLoader = new THREE.TextureLoader()
        const [bodyTexture, tailOneTexture, tailTwoTexture] = await Promise.all(
          Object.values(LAPLACE_STICKER_TEXTURES).map((url) =>
            textureLoader.loadAsync(url),
          ),
        )
        if (disposed) {
          bodyTexture.dispose()
          tailOneTexture.dispose()
          tailTwoTexture.dispose()
          return
        }

        for (const texture of [bodyTexture, tailOneTexture, tailTwoTexture]) {
          texture.colorSpace = THREE.SRGBColorSpace
          texture.minFilter = THREE.LinearMipmapLinearFilter
          texture.magFilter = THREE.LinearFilter
          texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy())
          texture.needsUpdate = true
          laplaceStickerTextures.push(texture)
        }

        laplaceStickerSchool = new THREE.Group()
        laplaceStickerSchool.name = 'LaplaceStickerSchool'
        for (let index = 0; index < LAPLACE_SWIMMER_COUNT; index += 1) {
          const rig = createLaplaceStickerRig(
            index,
            bodyTexture,
            tailOneTexture,
            tailTwoTexture,
          )
          laplaceStickerRigs.push(rig)
          laplaceStickerSchool?.add(rig.facing)
        }
        // Transparent sticker layers do not write depth, so explicitly draw
        // farther swimmers first while retaining the body/tail construction.
        ;[...laplaceStickerRigs]
          .sort((left, right) => left.worldDepth - right.worldDepth)
          .forEach((rig, index) => {
            const renderOrder = 6 + index * 6
            rig.tailTwoMesh.renderOrder = renderOrder
            rig.tailOneMesh.renderOrder = renderOrder + 1
            rig.body.renderOrder = renderOrder + 2
          })
        scene.add(laplaceStickerSchool)
        host.dataset.laplaceStickers = 'ready'
        scheduleFrame()
      } catch (error) {
        console.warn('Unable to load Laplace sticker layers:', error)
      }
    }

    const updateLaplaceStickerSchool = (time: number) => {
      if (!laplaceStickerSchool || !laplaceStickerRigs.length) return false
      const intensity = THREE.MathUtils.clamp(
        currentTuning.laplaceIntensity,
        0,
        1.5,
      )
      if (intensity <= 0.001) {
        laplaceStickerSchool.visible = false
        laplaceLastMotionAt = time
        return false
      }

      const deltaSeconds = laplaceLastMotionAt
        ? Math.min(0.06, Math.max(0, time - laplaceLastMotionAt) / 1000)
        : 0
      laplaceLastMotionAt = time
      const frames = getLaplaceStickerFrames(time, intensity, {
        speedMultiplier: currentTuning.laplaceSpeed,
        tailFrequency: currentTuning.laplaceTailFrequency,
      })
      laplaceStickerSchool.visible = true
      frames.forEach((frame, index) => {
        const rig = laplaceStickerRigs[index]
        if (!rig) return
        updateLaplaceStickerRig(rig, frame, deltaSeconds)
      })
      return true
    }

    const updateLaplaceStickerRig = (
      rig: LaplaceStickerRig,
      frame: LaplaceStickerFrame,
      deltaSeconds: number,
    ) => {
      rig.facing.visible = frame.opacity > 0.001
      if (!rig.facing.visible) return

      if (!rig.hasWorldPosition) {
        rig.worldPosition.set(frame.x, frame.y, rig.worldDepth)
        rig.hasWorldPosition = true
      } else {
        rig.worldPosition.x += frame.velocityX * deltaSeconds
        rig.worldPosition.y += frame.velocityY * deltaSeconds
        if (rig.worldPosition.x > LAPLACE_WORLD_X_WRAP) {
          rig.worldPosition.x = -LAPLACE_WORLD_X_WRAP
        }
      }
      rig.worldPosition.z = rig.worldDepth
      rig.facing.position.copy(rig.worldPosition)
      rig.facing.quaternion.copy(camera.quaternion)
      rig.facing.rotateY(rig.swimYaw)
      rig.art.scale.setScalar(frame.scale)
      rig.art.rotation.z = frame.rotation
      rig.tailOne.rotation.z = frame.tailOneRotation * rig.tailPhaseSign
      rig.tailTwo.rotation.z = frame.tailTwoRotation * rig.tailPhaseSign
      rig.bodyMaterial.opacity = frame.opacity
      rig.tailOneMaterial.opacity = frame.opacity * 0.94
      rig.tailTwoMaterial.opacity = frame.opacity * 0.9
    }

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
      if (laplaceStickerSchool) laplaceStickerSchool.visible = false
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
        if (laplaceStickerSchool) laplaceStickerSchool.visible = false
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
      updateLaplaceStickerSchool(time)
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

    const scheduleFrame = () => {
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

    const recenter = () => {
      if (tourEnabled) {
        tourManualUntil = 0
        tourWasManual = true
      } else {
        targetPointer.set(0, 0)
      }
      inkPressPointerId = null
      setInkPointer(
        inkPointer.x,
        inkPointer.y,
        false,
        false,
      )
      scheduleFrame()
    }

    const pointerPosition = (event: PointerEvent) => {
      const bounds = host.getBoundingClientRect()
      if (bounds.width <= 0 || bounds.height <= 0) return null
      return {
        x: THREE.MathUtils.clamp(
          (event.clientX - bounds.left) / bounds.width,
          0,
          1,
        ),
        y: THREE.MathUtils.clamp(
          (event.clientY - bounds.top) / bounds.height,
          0,
          1,
        ),
        inside:
          event.clientX >= bounds.left &&
          event.clientX <= bounds.right &&
          event.clientY >= bounds.top &&
          event.clientY <= bounds.bottom,
        bounds,
      }
    }

    const isInterfaceTarget = (target: EventTarget | null) =>
      target instanceof Element &&
      Boolean(
        target.closest(
          '[data-scene-ui], button, a, input, textarea, select, [role="button"], [contenteditable="true"]',
        ),
      )

    const onPointerMove = (event: PointerEvent) => {
      if (reduceMotion || !event.isPrimary) return
      if (
        inkPressPointerId === event.pointerId &&
        (event.buttons & 1) === 0
      ) {
        inkPressPointerId = null
      }
      if (isInterfaceTarget(event.target)) {
        inkPressPointerId = null
        if (inkPointerActive || inkPressed) {
          setInkPointer(inkPointer.x, inkPointer.y, false, false)
        }
        return
      }
      if (tourEnabled) {
        tourManualUntil = performance.now() + TOUR_MANUAL_RELEASE_MS
        tourWasManual = true
      }
      const pointer = pointerPosition(event)
      if (!pointer) return
      lastPointerActivityAt = performance.now()
      kineticPointer.set(pointer.x, pointer.y)
      targetPointer.set(
        THREE.MathUtils.clamp(
          pointer.x * 2 - 1,
          -1 + POINTER_MARGIN,
          1 - POINTER_MARGIN,
        ),
        THREE.MathUtils.clamp(
          1 - pointer.y * 2,
          -1 + POINTER_MARGIN,
          1 - POINTER_MARGIN,
        ),
      )
      if (currentTuning.inkEnabled) {
        setInkPointer(
          pointer.x,
          pointer.y,
          true,
          inkPressPointerId === event.pointerId && (event.buttons & 1) !== 0,
          pointer.bounds,
        )
      } else {
        inkPointer.set(pointer.x, pointer.y)
        scheduleFrame()
      }
    }

    const onPointerDown = (event: PointerEvent) => {
      if (
        !modelRoot ||
        reduceMotion ||
        !event.isPrimary ||
        event.button !== 0 ||
        isInterfaceTarget(event.target)
      ) {
        return
      }
      const pointer = pointerPosition(event)
      if (!pointer) return
      lastPointerActivityAt = performance.now()
      lastSceneImpactAt = performance.now()
      kineticPointer.set(pointer.x, pointer.y)
      triggerKineticWave(kineticPointer, 1)
      if (!currentTuning.inkEnabled) return
      inkPressPointerId = event.pointerId
      setInkPointer(pointer.x, pointer.y, true, true, pointer.bounds)
    }

    const onPointerUp = (event: PointerEvent) => {
      if (!event.isPrimary) return
      const ownsPress = inkPressPointerId === event.pointerId
      if (ownsPress) inkPressPointerId = null
      if (!ownsPress && !(event.button === 0 && inkPressed)) return
      const pointer = pointerPosition(event)
      if (
        !pointer ||
        !pointer.inside ||
        isInterfaceTarget(event.target) ||
        reduceMotion
      ) {
        setInkPointer(inkPointer.x, inkPointer.y, false, false)
        return
      }
      setInkPointer(
        pointer.x,
        pointer.y,
        currentTuning.inkEnabled && event.pointerType === 'mouse',
        false,
        pointer.bounds,
      )
    }

    const onPointerCancel = (event: PointerEvent) => {
      if (!event.isPrimary) return
      if (
        inkPressPointerId !== null &&
        inkPressPointerId !== event.pointerId
      ) {
        return
      }
      inkPressPointerId = null
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
      reduceMotion = event.matches
      if (reduceMotion) {
        warmupUntil = 0
        currentPointer.set(0, 0)
        targetPointer.set(0, 0)
        clearInkMotion()
        clearKineticMotion()
        clearAmbientMotion()
      } else {
        figureMotionStates.forEach((state) => {
          state.pointer.copy(currentPointer)
          state.velocity.set(0, 0)
        })
        if (tourEnabled) {
          tourStepStartedAt = performance.now()
          tourFromPointer.copy(currentPointer)
        }
        extendWarmup(RESUME_WARMUP_MS)
      }
      if (reduceMotion) scheduleFrame()
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        extendWarmup(RESUME_WARMUP_MS)
      } else {
        clearInkMotion()
        clearKineticMotion()
        clearAmbientMotion()
      }
    }

    // The embedded scene sits below THEIA's interactive chrome. Listen at the
    // window level so the camera and ink still follow the pointer without
    // stealing clicks from buttons, inputs, maps, or dialogs above it.
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerdown', onPointerDown, { passive: true })
    window.addEventListener('pointerleave', recenter)
    window.addEventListener('pointerup', onPointerUp, { passive: true })
    window.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('blur', onWindowBlur)
    document.addEventListener('visibilitychange', onVisibilityChange)
    motionQuery.addEventListener('change', onMotionPreferenceChange)

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
        void loadLaplaceStickerSchool()
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
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerleave', recenter)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      window.removeEventListener('blur', onWindowBlur)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      motionQuery.removeEventListener('change', onMotionPreferenceChange)
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
      disposeLaplaceStickerSchool()
      inkPostProcess.dispose()
      spectralPostProcess.dispose()
      renderer.dispose()
    }
  }, [tuningStorageKey])

  return (
    <div
      ref={hostRef}
      className={`scene${presentationMode ? ' scene--presentation' : ''}`}
      data-motion-profile="ambient"
    >
      <canvas ref={canvasRef} className="scene__canvas" aria-hidden="true" />
      {tourEnabled && sceneStatus === 'ready' && (
        <div
          className="tour-focus"
          style={
            {
              '--tour-color': DEPTH_LAYER_COLORS[tourActiveIndex],
            } as CSSProperties
          }
          aria-hidden="true"
        >
          <div className="tour-focus__lens" />
        </div>
      )}
      {presentationMode && (
        <button
          className="presentation-exit"
          type="button"
          aria-label="退出沉浸查看"
          title="退出沉浸查看"
          data-scene-ui
          onClick={() => setPresentationMode(false)}
        >
          <Minimize2 size={17} />
        </button>
      )}
      <div
        className={`tour-dock${tourEnabled ? ' is-active' : ''}`}
        style={
          {
            '--tour-color': DEPTH_LAYER_COLORS[tourActiveIndex],
          } as CSSProperties
        }
        role="toolbar"
        aria-label="五重奏景深巡游"
        data-scene-ui
      >
        <button
          className="tour-dock__toggle"
          type="button"
          aria-label={tourEnabled ? '暂停五重奏' : '开始五重奏'}
          title={tourEnabled ? '暂停五重奏' : '开始五重奏'}
          aria-pressed={tourEnabled}
          disabled={sceneStatus !== 'ready'}
          onClick={toggleTour}
        >
          {tourEnabled ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button
          className="tour-dock__motion"
          type="button"
          aria-label={tuning.motionEnabled ? '关闭景深共振' : '开启景深共振'}
          title={tuning.motionEnabled ? '关闭景深共振' : '开启景深共振'}
          aria-pressed={tuning.motionEnabled}
          disabled={sceneStatus !== 'ready'}
          onClick={() => updateMotionEnabled(!tuning.motionEnabled)}
        >
          <AudioWaveform size={16} />
        </button>
        <div className="tour-dock__steps" role="group" aria-label="选择人物焦点">
          {FIGURE_NAMES.map((name, index) => (
            <button
              key={name}
              className={
                tourEnabled && tourActiveIndex === index ? 'is-active' : ''
              }
              style={
                {
                  '--step-color': DEPTH_LAYER_COLORS[index],
                } as CSSProperties
              }
              type="button"
              aria-label={`聚焦人物 ${index + 1}`}
              title={`聚焦人物 ${index + 1}`}
              aria-pressed={tourEnabled && tourActiveIndex === index}
              disabled={sceneStatus !== 'ready'}
              onClick={() => focusTourFigure(index)}
            >
              {index + 1}
            </button>
          ))}
        </div>
        {tourEnabled && (
          <span
            key={`${tourActiveIndex}-${tourStepEpoch}`}
            className="tour-dock__progress"
          />
        )}
      </div>
      <aside
        className={`tuning-panel${panelOpen ? ' tuning-panel--open' : ''}`}
        aria-label="模型效果编辑器"
        data-scene-ui
      >
        <button
          className="tuning-panel__toggle"
          type="button"
          aria-label={panelOpen ? '收起参数' : '展开参数'}
          title={panelOpen ? '收起参数' : '展开参数'}
          onClick={() => setPanelOpen((open) => !open)}
        >
          <SlidersHorizontal size={18} />
        </button>

        {panelOpen && (
          <div className="tuning-panel__body">
            <div className="tuning-panel__header">
              <div className="tuning-panel__actions">
                <button
                  type="button"
                  title="沉浸查看"
                  aria-label="沉浸查看"
                  onClick={() => setPresentationMode(true)}
                >
                  <Expand size={16} />
                </button>
                <button
                  type="button"
                  title="复制参数"
                  aria-label="复制参数"
                  onClick={copyTuning}
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
                <button
                  type="button"
                  title="恢复默认"
                  aria-label="恢复默认"
                  onClick={resetTuning}
                >
                  <RotateCcw size={16} />
                </button>
              </div>
            </div>

            <div className="editor-tabs" role="tablist" aria-label="编辑器页面">
              <EditorTabButton
                id="camera"
                label="视角"
                icon={<Camera size={15} aria-hidden="true" />}
                activeTab={activeTab}
                onSelect={setActiveTab}
                onNavigate={setActiveTab}
              />
              <EditorTabButton
                id="depth"
                label="景深"
                icon={<Layers3 size={15} aria-hidden="true" />}
                activeTab={activeTab}
                onSelect={setActiveTab}
                onNavigate={setActiveTab}
              />
              <EditorTabButton
                id="ink"
                label="Ink"
                icon={<Blend size={15} aria-hidden="true" />}
                activeTab={activeTab}
                onSelect={setActiveTab}
                onNavigate={setActiveTab}
              />
              <EditorTabButton
                id="motion"
                label="动效"
                icon={<Zap size={15} aria-hidden="true" />}
                activeTab={activeTab}
                onSelect={setActiveTab}
                onNavigate={setActiveTab}
              />
              <EditorTabButton
                id="spectral"
                label="光场"
                icon={<Sparkles size={15} aria-hidden="true" />}
                activeTab={activeTab}
                onSelect={setActiveTab}
                onNavigate={setActiveTab}
              />
            </div>

            {activeTab === 'camera' && (
              <div
                id="editor-panel-camera"
                className="editor-page"
                role="tabpanel"
                aria-labelledby="editor-tab-camera"
              >
                <div className="tuning-panel__controls">
                  {CAMERA_SLIDERS.map((slider) => (
                    <ParameterSlider
                      key={slider.key}
                      definition={slider}
                      value={tuning[slider.key]}
                      onChange={(value) => updateTuning(slider.key, value)}
                    />
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'depth' && (
              <div
                id="editor-panel-depth"
                className="editor-page depth-editor"
                role="tabpanel"
                aria-labelledby="editor-tab-depth"
              >
                <div className="depth-editor__toolbar">
                  <div className="depth-editor__presets" role="group" aria-label="整体景深预设">
                    {DEPTH_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        className={activeDepthPreset === preset.id ? 'is-active' : ''}
                        type="button"
                        aria-pressed={activeDepthPreset === preset.id}
                        onClick={() => applyDepthPreset(preset)}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div className="depth-editor__offset-actions">
                    <button
                      type="button"
                      title="全部层偏移归零"
                      onClick={resetDepthOffsets}
                      disabled={FIGURE_KEYS.every(
                        (key) => Math.abs(tuning[key]) < 0.0001,
                      )}
                    >
                      <RotateCcw size={14} aria-hidden="true" />
                      <span>层归零</span>
                    </button>
                    {depthUndo && (
                      <button type="button" title="撤销层归零" onClick={undoDepthReset}>
                        <Undo2 size={14} aria-hidden="true" />
                        <span>撤销</span>
                      </button>
                    )}
                  </div>
                </div>

                <ParameterSlider
                  definition={DEPTH_SCALE_SLIDER}
                  value={tuning.depthScale}
                  onChange={(value) => updateTuning('depthScale', value)}
                />

                <DepthStackPreview
                  depths={effectiveDepths}
                  crossings={depthCrossings}
                />

                {depthCrossings.length > 0 && (
                  <div className="depth-warning" role="group" aria-label="层序冲突">
                    <TriangleAlert size={14} aria-hidden="true" />
                    <button type="button" onClick={resetDepthOffsets}>恢复层序</button>
                  </div>
                )}

                <div className="depth-editor__layers">
                  {FIGURE_SLIDERS.map((slider, index) => (
                    <DepthLayerControl
                      key={slider.key}
                      definition={slider}
                      index={index}
                      value={tuning[slider.key]}
                      effectiveDepth={effectiveDepths[index]}
                      onChange={(value) => updateTuning(slider.key, value)}
                      onReset={() => resetDepthLayer(slider.key)}
                    />
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'ink' && (
              <section
                id="editor-panel-ink"
                className="editor-page ink-controls"
                role="tabpanel"
                aria-labelledby="editor-tab-ink"
              >
                <div className="ink-controls__header">
                  <label className="ink-toggle" title="Ink">
                    <input
                      type="checkbox"
                      checked={tuning.inkEnabled}
                      aria-label="启用 Ink"
                      onChange={(event) =>
                        updateInkEnabled(event.currentTarget.checked)
                      }
                    />
                    <span className="ink-toggle__track" aria-hidden="true">
                      <span />
                    </span>
                  </label>
                </div>
                {tuning.inkEnabled && (
                  <div className="tuning-panel__controls ink-controls__sliders">
                    {INK_SLIDERS.map((slider) => (
                      <ParameterSlider
                        key={slider.key}
                        definition={slider}
                        value={tuning[slider.key]}
                        onChange={(value) => updateTuning(slider.key, value)}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}

            {activeTab === 'motion' && (
              <section
                id="editor-panel-motion"
                className="editor-page motion-controls"
                role="tabpanel"
                aria-labelledby="editor-tab-motion"
              >
                <div className="motion-controls__header">
                  <label className="motion-toggle" title="景深共振">
                    <input
                      type="checkbox"
                      checked={tuning.motionEnabled}
                      aria-label="启用景深共振"
                      onChange={(event) =>
                        updateMotionEnabled(event.currentTarget.checked)
                      }
                    />
                    <span className="motion-toggle__track" aria-hidden="true">
                      <span />
                    </span>
                  </label>
                </div>
                <div className="motion-score" aria-hidden="true">
                  {DEPTH_LAYER_COLORS.map((color, index) => (
                    <i
                      key={color}
                      style={
                        {
                          '--score-color': color,
                          '--score-index': index,
                        } as CSSProperties
                      }
                    />
                  ))}
                </div>
                {tuning.motionEnabled && (
                  <div className="tuning-panel__controls motion-controls__sliders">
                    {MOTION_SLIDERS.map((slider) => (
                      <ParameterSlider
                        key={slider.key}
                        definition={slider}
                        value={tuning[slider.key]}
                        onChange={(value) => updateTuning(slider.key, value)}
                      />
                    ))}
                    {AMBIENT_MOTION_SLIDERS.map((slider) => (
                      <ParameterSlider
                        key={slider.key}
                        definition={slider}
                        value={tuning[slider.key]}
                        onChange={(value) => updateTuning(slider.key, value)}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}

            {activeTab === 'spectral' && (
              <section
                id="editor-panel-spectral"
                className="editor-page motion-controls spectral-controls"
                role="tabpanel"
                aria-labelledby="editor-tab-spectral"
              >
                <div className="motion-controls__header">
                  <label className="motion-toggle" title="光谱大气场">
                    <input
                      type="checkbox"
                      checked={tuning.spectralEnabled}
                      aria-label="启用光谱大气场"
                      onChange={(event) =>
                        updateSpectralEnabled(event.currentTarget.checked)
                      }
                    />
                    <span className="motion-toggle__track" aria-hidden="true">
                      <span />
                    </span>
                  </label>
                </div>
                {tuning.spectralEnabled && (
                  <div className="tuning-panel__controls motion-controls__sliders">
                    {SPECTRAL_SLIDERS.map((slider) => (
                      <ParameterSlider
                        key={slider.key}
                        definition={slider}
                        value={tuning[slider.key]}
                        onChange={(value) => updateTuning(slider.key, value)}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </aside>
    </div>
  )
}

function EditorTabButton({
  id,
  label,
  icon,
  activeTab,
  onSelect,
  onNavigate,
}: {
  id: EditorTab
  label: string
  icon: ReactNode
  activeTab: EditorTab
  onSelect: (tab: EditorTab) => void
  onNavigate: (tab: EditorTab) => void
}) {
  const active = activeTab === id
  const tabs: readonly EditorTab[] = ['camera', 'depth', 'ink', 'motion', 'spectral']
  const navigate = (event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = tabs.indexOf(id)
    let nextIndex: number | null = null
    if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex + tabs.length - 1) % tabs.length
    }
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = tabs.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    const nextTab = tabs[nextIndex]
    onNavigate(nextTab)
    requestAnimationFrame(() =>
      document.getElementById(`editor-tab-${nextTab}`)?.focus(),
    )
  }
  return (
    <button
      id={`editor-tab-${id}`}
      className={active ? 'is-active' : ''}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={`editor-panel-${id}`}
      tabIndex={active ? 0 : -1}
      onClick={() => onSelect(id)}
      onKeyDown={navigate}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function DepthStackPreview({
  depths,
  crossings,
}: {
  depths: readonly number[]
  crossings: readonly number[]
}) {
  const min = -1.05
  const max = 2.15

  return (
    <div
      className={`depth-stack${crossings.length ? ' depth-stack--warning' : ''}`}
      role="img"
      aria-label={`人物层近远分布：${depths
        .map((depth, index) => `F${index + 1} ${depth.toFixed(2)}`)
        .join('，')}`}
    >
      <div className="depth-stack__axis" aria-hidden="true">
        <span>远</span>
        <i />
        <span>近</span>
      </div>
      <div className="depth-stack__track">
        {depths.map((depth, index) => (
          <span
            key={FIGURE_KEYS[index]}
            className="depth-stack__marker"
            style={{
              '--depth-position': `${THREE.MathUtils.mapLinear(
                THREE.MathUtils.clamp(depth, min, max),
                min,
                max,
                4,
                96,
              )}%`,
              '--depth-color': DEPTH_LAYER_COLORS[index],
            } as CSSProperties}
            title={`${FIGURE_SLIDERS[index].label}: ${depth.toFixed(2)}`}
          >
            {index + 1}
          </span>
        ))}
      </div>
    </div>
  )
}

function DepthLayerControl({
  definition,
  index,
  value,
  effectiveDepth,
  onChange,
  onReset,
}: {
  definition: SliderDefinition<FigureTuningKey>
  index: number
  value: number
  effectiveDepth: number
  onChange: (value: number) => void
  onReset: () => void
}) {
  const [numberDraft, setNumberDraft] = useState(value.toFixed(definition.digits))
  const editingNumberRef = useRef(false)
  const cancelNumberRef = useRef(false)

  useEffect(() => {
    if (!editingNumberRef.current) {
      setNumberDraft(value.toFixed(definition.digits))
    }
  }, [definition.digits, value])

  const commitNumberDraft = () => {
    if (cancelNumberRef.current) {
      cancelNumberRef.current = false
      editingNumberRef.current = false
      setNumberDraft(value.toFixed(definition.digits))
      return
    }
    editingNumberRef.current = false
    const parsed = Number(numberDraft)
    if (!Number.isFinite(parsed)) {
      setNumberDraft(value.toFixed(definition.digits))
      return
    }
    const next = THREE.MathUtils.clamp(parsed, definition.min, definition.max)
    setNumberDraft(next.toFixed(definition.digits))
    onChange(next)
  }

  const stepBy = (direction: -1 | 1) =>
    onChange(
      THREE.MathUtils.clamp(
        Number((value + definition.step * direction).toFixed(definition.digits)),
        definition.min,
        definition.max,
      ),
    )

  return (
    <div className="depth-layer">
      <div className="depth-layer__header">
        <span
          className="depth-layer__index"
          style={{ '--depth-color': DEPTH_LAYER_COLORS[index] } as CSSProperties}
          aria-hidden="true"
        >
          {index + 1}
        </span>
        <span className="depth-layer__name">{definition.label.replace(/^F\d\s*/, '')}</span>
        <span className="depth-layer__effective" title="最终 Z 深度">
          Z {effectiveDepth.toFixed(2)}
        </span>
        <button
          className="depth-layer__reset"
          type="button"
          title={`复位${definition.label}`}
          aria-label={`复位${definition.label}`}
          disabled={Math.abs(value) < 0.0001}
          onClick={onReset}
        >
          <RotateCcw size={13} />
        </button>
      </div>
      <div className="depth-layer__controls">
        <button
          type="button"
          title={`${definition.label}后移`}
          aria-label={`${definition.label}后移`}
          onClick={() => stepBy(-1)}
        >
          <Minus size={14} />
        </button>
        <input
          className="depth-layer__range"
          style={{ '--depth-color': DEPTH_LAYER_COLORS[index] } as CSSProperties}
          type="range"
          min={definition.min}
          max={definition.max}
          step={definition.step}
          value={value}
          aria-label={`${definition.label}偏移`}
          onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
        />
        <button
          type="button"
          title={`${definition.label}前移`}
          aria-label={`${definition.label}前移`}
          onClick={() => stepBy(1)}
        >
          <Plus size={14} />
        </button>
        <input
          className="depth-layer__number"
          type="text"
          inputMode="decimal"
          min={definition.min}
          max={definition.max}
          step={definition.step}
          value={numberDraft}
          aria-label={`${definition.label}精确偏移`}
          onChange={(event) => {
            editingNumberRef.current = true
            setNumberDraft(event.currentTarget.value)
          }}
          onBlur={commitNumberDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              cancelNumberRef.current = true
              event.currentTarget.blur()
            }
          }}
        />
      </div>
    </div>
  )
}

function ParameterSlider({
  definition,
  value,
  onChange,
}: {
  definition: SliderDefinition
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="parameter-slider">
      <span>{definition.label}</span>
      <input
        className="parameter-slider__number"
        type="number"
        min={definition.min}
        max={definition.max}
        step={definition.step}
        value={value.toFixed(definition.digits)}
        aria-label={`${definition.label}数值`}
        onChange={(event) => {
          if (!Number.isFinite(event.currentTarget.valueAsNumber)) return
          onChange(
            THREE.MathUtils.clamp(
              event.currentTarget.valueAsNumber,
              definition.min,
              definition.max,
            ),
          )
        }}
      />
      <input
        className="parameter-slider__range"
        type="range"
        min={definition.min}
        max={definition.max}
        step={definition.step}
        value={value}
        aria-label={`${definition.label}滑杆`}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
      />
    </label>
  )
}
