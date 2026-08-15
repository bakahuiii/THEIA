export type LaplaceStickerFrame = {
  corridorIndex: number
  x: number
  y: number
  scale: number
  rotation: number
  velocityX: number
  velocityY: number
  tailOneRotation: number
  tailTwoRotation: number
  opacity: number
}

type LaplaceSwimmer = {
  corridorIndex: number
  x: number
  y: number
  phase: number
  scale: number
}

export type LaplaceMotionOptions = {
  speedMultiplier?: number
  tailFrequency?: number
}

export const LAPLACE_WORLD_SPAWN_MIN_Y = -0.62
export const LAPLACE_WORLD_X_WRAP = 3.7
export const LAPLACE_SWIMMER_COUNT = 5
export const LAPLACE_REFERENCE_FOV_DEGREES = 45
export const LAPLACE_REFERENCE_CAMERA_DISTANCE = 4

export type LaplaceSwimmerProfile = {
  worldDepth: number
  swimYaw: number
  tailPhaseSign: number
}

const PSEUDO_RANDOM_SEED = 0x5f3759df
const LAPLACE_LANE_VERTICAL_JITTER = 0.036
// Five alpha-owned subject lines in reference-image UV. The fifth remains at
// upper-body height to respect the established lower spawn boundary.
export const LAPLACE_FIGURE_INTERACTION_SCREEN_Y = [
  0.405,
  0.5,
  0.635,
  0.725,
  0.69,
] as const

function createPseudoRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

export const LAPLACE_WORLD_SWIM_SPEED = 0.34
// A wide, fixed world range makes camera orbit produce clearly different
// screen motion for each swimmer without letting a near fish cross the lens.
export const LAPLACE_WORLD_DEPTH_RANGE = { min: -0.9, max: 1.3 } as const
export const LAPLACE_SWIM_YAW_RANGE = {
  min: -Math.PI / 18,
  max: Math.PI / 18,
} as const

export function getRandomLaplaceWorldDepth(random = Math.random) {
  const normalized = Math.min(1, Math.max(0, random()))
  if (normalized === 0) return LAPLACE_WORLD_DEPTH_RANGE.min
  if (normalized === 1) return LAPLACE_WORLD_DEPTH_RANGE.max
  return (
    LAPLACE_WORLD_DEPTH_RANGE.min +
    normalized *
      (LAPLACE_WORLD_DEPTH_RANGE.max - LAPLACE_WORLD_DEPTH_RANGE.min)
  )
}

export function getRandomLaplaceSwimYaw(random = Math.random) {
  const normalized = Math.min(1, Math.max(0, random()))
  return (
    LAPLACE_SWIM_YAW_RANGE.min +
    normalized * (LAPLACE_SWIM_YAW_RANGE.max - LAPLACE_SWIM_YAW_RANGE.min)
  )
}

export function getLaplaceSwimmerProfile(index: number): LaplaceSwimmerProfile {
  const normalizedIndex =
    ((Math.trunc(index) % LAPLACE_SWIMMER_COUNT) + LAPLACE_SWIMMER_COUNT) %
    LAPLACE_SWIMMER_COUNT
  const random = createPseudoRandom(
    PSEUDO_RANDOM_SEED ^ ((normalizedIndex + 1) * 0x85ebca6b),
  )
  return {
    worldDepth: getRandomLaplaceWorldDepth(random),
    swimYaw: getRandomLaplaceSwimYaw(random),
    tailPhaseSign: random() < 0.5 ? -1 : 1,
  }
}

export function getLaplaceSwimLaneY(
  index: number,
  worldDepth: number,
  verticalJitter = 0,
) {
  const normalizedIndex =
    ((Math.trunc(index) % LAPLACE_SWIMMER_COUNT) + LAPLACE_SWIMMER_COUNT) %
    LAPLACE_SWIMMER_COUNT
  const targetNdcY =
    1 - LAPLACE_FIGURE_INTERACTION_SCREEN_Y[normalizedIndex] * 2
  const cameraDistance = Math.max(
    0.001,
    LAPLACE_REFERENCE_CAMERA_DISTANCE - worldDepth,
  )
  const verticalSpan =
    cameraDistance * Math.tan((LAPLACE_REFERENCE_FOV_DEGREES * Math.PI) / 360)

  return Math.max(
    LAPLACE_WORLD_SPAWN_MIN_Y,
    targetNdcY * verticalSpan + verticalJitter,
  )
}

const SCHOOL: readonly LaplaceSwimmer[] = Array.from(
  { length: LAPLACE_SWIMMER_COUNT },
  (_, corridorIndex) => {
    const random = createPseudoRandom(
      PSEUDO_RANDOM_SEED + corridorIndex * 0x9e3779b9,
    )
    const segmentWidth = (LAPLACE_WORLD_X_WRAP * 2) / LAPLACE_SWIMMER_COUNT
    const segmentProgress = 0.2 + random() * 0.6
    const profile = getLaplaceSwimmerProfile(corridorIndex)
    return {
      corridorIndex,
      x:
        -LAPLACE_WORLD_X_WRAP +
        (corridorIndex + segmentProgress) * segmentWidth,
      y: getLaplaceSwimLaneY(
        corridorIndex,
        profile.worldDepth,
        (random() - 0.5) * LAPLACE_LANE_VERTICAL_JITTER,
      ),
      phase: random(),
      scale: 0.4 + random() * 0.1,
    }
  },
)

export function getLaplaceStickerFrames(
  timeMs: number,
  intensity = 1,
  options: LaplaceMotionOptions = {},
): LaplaceStickerFrame[] {
  const time = Math.max(0, timeMs) / 1000
  const strength = Math.min(1.5, Math.max(0, intensity))
  const speedMultiplier = Math.min(2.25, Math.max(0.25, options.speedMultiplier ?? 1))
  const tailFrequency = Math.min(2.5, Math.max(0.25, options.tailFrequency ?? 1))

  const swimmers = SCHOOL.map((swimmer, index) => {
    const tailPhase =
      time * tailFrequency * (2.5 + index * 0.17) + swimmer.phase * Math.PI * 2

    return {
      corridorIndex: swimmer.corridorIndex,
      x: swimmer.x,
      y: swimmer.y,
      scale: swimmer.scale * (0.65 + strength * 0.35),
      rotation: 0,
      velocityX: LAPLACE_WORLD_SWIM_SPEED * speedMultiplier,
      velocityY: 0,
      tailOneRotation:
        Math.sin(tailPhase) * 0.19 + Math.sin(tailPhase * 0.47 + 0.8) * 0.06,
      tailTwoRotation:
        Math.sin(tailPhase + 0.58) * 0.26 +
        Math.sin(tailPhase * 0.47 + 1.4) * 0.07,
      opacity: (0.72 + index * 0.07) * Math.min(1, strength),
    }
  })

  return swimmers
}
