import {
  DEFAULT_PARALLAX_TUNING,
  PARALLAX_TUNING_EVENT,
  PARALLAX_TUNING_GROUPS,
  PARALLAX_TUNING_SCHEMA_VERSION,
  PARALLAX_TUNING_STORAGE_KEY,
  publishParallaxTuning,
} from './parallax-tuning'
import type {
  ParallaxNumericKey,
  ParallaxSliderDefinition,
  ParallaxTuning,
} from './parallax-tuning'

export type TuningSettings = ParallaxTuning
export type NumericTuningKey = ParallaxNumericKey
export type FigureTuningKey = Extract<keyof TuningSettings, `figure${number}Z`>
export type DepthOffsets = Pick<TuningSettings, FigureTuningKey>
export type SliderDefinition<TKey extends NumericTuningKey = NumericTuningKey> =
  Omit<ParallaxSliderDefinition, 'key'> & { key: TKey }

export type SceneStatus = 'loading' | 'ready' | 'error'
export type EditorTab = 'camera' | 'depth' | 'ink' | 'motion' | 'spectral'

export type DepthPreset = {
  id: 'flat' | 'original' | 'strong'
  label: string
  depthScale: number
}

export const MODEL_URL = new URL(
  './assets/anniversary_scene_editable.glb',
  import.meta.url,
).href
export const MODEL_NAME = 'anniversary_scene_editable.glb'
export const BACKGROUND_NAME = 'Background_Poster'
export const REFERENCE_ASPECT = 1.7765440666204024
export const REFERENCE_FOV = 45
export const POINTER_MARGIN = 0.025
export const POSITION_EPSILON = 0.0001
export const STARTUP_WARMUP_MS = 3000
export const RESUME_WARMUP_MS = 1000
export const INTERACTION_WARMUP_MS = 250
export const INK_HISTORY_LIFETIME_MS = 980
export const INK_MODE_TRANSITION_MS = 920
export const INK_CLICK_TRANSITION_MS = 680
export const INK_VELOCITY_EPSILON = 0.5
export const KINETIC_WAVE_MS = 1320
export const KINETIC_VELOCITY_EPSILON = 2
export const KINETIC_LAYER_SHIFT = 0.026
export const KINETIC_LAYER_LIFT = 0.038
export const KINETIC_LAYER_SCALE = 0.014
export const MIN_RENDER_PIXEL_RATIO = 1.5
export const MAX_RENDER_PIXEL_RATIO = 2
export const MAX_RENDER_PIXELS = 8_294_400
export const TUNING_STORAGE_KEY = PARALLAX_TUNING_STORAGE_KEY
export const TUNING_SCHEMA_VERSION = PARALLAX_TUNING_SCHEMA_VERSION
export const DEPTH_ORDER_EPSILON = 0.002
export const TOUR_STEP_MS = 2200
export const TOUR_TRANSITION_MS = 760
export const TOUR_MANUAL_RELEASE_MS = 1250
export const TOUR_LAYER_LIFT = 0.052
export const TOUR_LAYER_SCALE = 0.018

export const FIGURE_NAMES = [
  'Figure_01_Near',
  'Figure_02_Mid_Near',
  'Figure_03_Middle',
  'Figure_04_Mid_Far',
  'Figure_05_Far',
] as const

export const STATIC_OVERLAY_NAMES = [
  'Background_Lettering',
  'Speech_Bubble',
  'Whale',
] as const

export const LAPLACE_STICKER_TEXTURES = {
  body: new URL('./assets/laplace-body.png', import.meta.url).href,
  tailOne: new URL('./assets/laplace-tail-1.png', import.meta.url).href,
  tailTwo: new URL('./assets/laplace-tail-2.png', import.meta.url).href,
} as const

export const LAPLACE_BODY_ASPECT = 408 / 266
export const LAPLACE_TAIL_ONE_ASPECT = 210 / 118
export const LAPLACE_TAIL_TWO_ASPECT = 283 / 168
export const DEPTH_NODE_NAMES = [
  BACKGROUND_NAME,
  ...STATIC_OVERLAY_NAMES,
  ...FIGURE_NAMES,
] as const
export const FIGURE_KEYS = [
  'figure1Z',
  'figure2Z',
  'figure3Z',
  'figure4Z',
  'figure5Z',
] as const satisfies readonly FigureTuningKey[]
export const DEFAULT_FIGURE_DEPTHS = [
  0.641702,
  0.382034,
  0.181011,
  0.026857,
  -0.084187,
] as const
export const DEPTH_LAYER_COLORS = [
  '#ff6b66',
  '#ffd452',
  '#55d6be',
  '#72a5ff',
  '#b5b7c2',
] as const
export const TOUR_POINTER_TARGETS = [
  [-0.72, 0.34],
  [-0.18, 0.08],
  [0.34, -0.16],
  [0.64, -0.28],
  [0.82, -0.38],
] as const

export type TourCue = {
  figureIndex: number
  duration: number
  transition: number
  pulse: number
}

export const TOUR_SCORE: readonly TourCue[] = [
  { figureIndex: 0, duration: 2100, transition: 820, pulse: 1 },
  { figureIndex: 1, duration: 1840, transition: 680, pulse: 0.76 },
  { figureIndex: 2, duration: 2460, transition: 940, pulse: 1.08 },
  { figureIndex: 3, duration: 1780, transition: 660, pulse: 0.72 },
  { figureIndex: 4, duration: 2260, transition: 860, pulse: 1.02 },
  { figureIndex: 3, duration: 1700, transition: 620, pulse: 0.68 },
  { figureIndex: 2, duration: 2200, transition: 820, pulse: 0.92 },
  { figureIndex: 1, duration: 1760, transition: 640, pulse: 0.7 },
] as const

export const LAYER_RENDER_ORDER: Readonly<Record<string, number>> = {
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

export const DEFAULT_TUNING: TuningSettings = DEFAULT_PARALLAX_TUNING

function slidersFor(id: 'camera' | 'depth' | 'ink' | 'motion' | 'spectral') {
  const group = PARALLAX_TUNING_GROUPS.find((entry) => entry.id === id)
  return [...(group?.sliders ?? [])] as SliderDefinition[]
}

export const CAMERA_SLIDERS = slidersFor('camera')
const DEPTH_SLIDERS = slidersFor('depth')
export const DEPTH_SCALE_SLIDER = DEPTH_SLIDERS[0] as SliderDefinition
export const FIGURE_SLIDERS = DEPTH_SLIDERS.slice(
  1,
) as SliderDefinition<FigureTuningKey>[]
export const INK_SLIDERS = slidersFor('ink')
const MOTION_SLIDERS_ALL = slidersFor('motion')
export const MOTION_SLIDERS = MOTION_SLIDERS_ALL.slice(0, 3)
export const AMBIENT_MOTION_SLIDERS = MOTION_SLIDERS_ALL.slice(3)
export const SPECTRAL_SLIDERS = slidersFor('spectral')
export const DEPTH_PRESETS: readonly DepthPreset[] = [
  { id: 'flat', label: '平面', depthScale: 0 },
  { id: 'original', label: '原始', depthScale: 1 },
  { id: 'strong', label: '强化', depthScale: 1.35 },
]
export const ALL_SLIDERS = [
  ...CAMERA_SLIDERS,
  DEPTH_SCALE_SLIDER,
  ...FIGURE_SLIDERS,
  ...INK_SLIDERS,
  ...MOTION_SLIDERS,
  ...AMBIENT_MOTION_SLIDERS,
  ...SPECTRAL_SLIDERS,
]

type StoredTuning = Partial<TuningSettings> & { version?: unknown }

export function saveStoredTuning(
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
    ? Math.max(min, Math.min(max, value))
    : fallback
}

export function loadStoredTuning(storageKey = TUNING_STORAGE_KEY): TuningSettings {
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
      ) as never
    }

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

export function getDepthOffsets(tuning: TuningSettings): DepthOffsets {
  return {
    figure1Z: tuning.figure1Z,
    figure2Z: tuning.figure2Z,
    figure3Z: tuning.figure3Z,
    figure4Z: tuning.figure4Z,
    figure5Z: tuning.figure5Z,
  }
}

export function getEffectiveDepths(
  tuning: TuningSettings,
  baseDepths: readonly number[],
) {
  return FIGURE_KEYS.map(
    (key, index) => baseDepths[index] * tuning.depthScale + tuning[key],
  )
}

export function getDepthCrossings(depths: readonly number[]) {
  return depths.flatMap((depth, index) =>
    index < depths.length - 1 && depth <= depths[index + 1] + DEPTH_ORDER_EPSILON
      ? [index]
      : [],
  )
}

export function isFlatDepth(tuning: TuningSettings) {
  return (
    Math.abs(tuning.depthScale) < DEPTH_ORDER_EPSILON &&
    FIGURE_KEYS.every((key) => Math.abs(tuning[key]) < DEPTH_ORDER_EPSILON)
  )
}

export { PARALLAX_TUNING_EVENT }
