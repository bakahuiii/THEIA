export type SceneChoreographyMode = 'ambient' | 'focus' | 'impact'
export type SceneChoreographyDirection = -1 | 1

export type SceneChoreographyFrame = {
  mode: SceneChoreographyMode
  ambientWeight: number
  ambientBeatProgress: number
  ambientBeatWeight: number
  ambientBeatDirection: SceneChoreographyDirection
  ambientBeatStrength: number
  focusWeight: number
  impactWeight: number
}

type AmbientBeatPhrase = {
  restMs: number
  durationMs: number
  direction: SceneChoreographyDirection
  strength: number
}

const FOCUS_RELEASE_MS = 1120
const AMBIENT_START_MS = 680
const AMBIENT_FULL_MS = 1880
const IMPACT_DURATION_MS = 1260

// A deterministic score avoids the mechanical feeling of an even loop without
// adding the visual noise and discontinuities of runtime randomness.
const AMBIENT_BEAT_SCORE: readonly AmbientBeatPhrase[] = [
  { restMs: 1120, durationMs: 2320, direction: 1, strength: 0.82 },
  { restMs: 920, durationMs: 1560, direction: -1, strength: 0.58 },
  { restMs: 1820, durationMs: 2860, direction: 1, strength: 1 },
  { restMs: 1240, durationMs: 1960, direction: -1, strength: 0.72 },
  { restMs: 2360, durationMs: 2460, direction: 1, strength: 0.88 },
  { restMs: 860, durationMs: 1680, direction: -1, strength: 0.64 },
  { restMs: 1700, durationMs: 3140, direction: -1, strength: 1.06 },
  { restMs: 1400, durationMs: 2100, direction: 1, strength: 0.76 },
  { restMs: 2580, durationMs: 1860, direction: -1, strength: 0.55 },
  { restMs: 1040, durationMs: 2760, direction: 1, strength: 0.94 },
] as const

const AMBIENT_BEAT_SCORE_DURATION_MS = AMBIENT_BEAT_SCORE.reduce(
  (duration, phrase) => duration + phrase.restMs + phrase.durationMs,
  0,
)

const clampUnit = (value: number) => Math.min(1, Math.max(0, value))

function smoothstep(edge0: number, edge1: number, value: number) {
  const normalized = clampUnit((value - edge0) / (edge1 - edge0))
  return normalized * normalized * (3 - 2 * normalized)
}

export function createSceneChoreographyFrame(): SceneChoreographyFrame {
  return {
    mode: 'ambient',
    ambientWeight: 1,
    ambientBeatProgress: 0,
    ambientBeatWeight: 0,
    ambientBeatDirection: 1,
    ambientBeatStrength: 0,
    focusWeight: 0,
    impactWeight: 0,
  }
}

function updateAmbientBeat(frame: SceneChoreographyFrame, time: number) {
  let scoreTime = time % AMBIENT_BEAT_SCORE_DURATION_MS
  frame.ambientBeatProgress = 0
  frame.ambientBeatWeight = 0
  frame.ambientBeatStrength = 0

  for (const phrase of AMBIENT_BEAT_SCORE) {
    if (scoreTime < phrase.restMs) {
      frame.ambientBeatDirection = phrase.direction
      return
    }

    scoreTime -= phrase.restMs
    if (scoreTime < phrase.durationMs) {
      const progress = scoreTime / phrase.durationMs
      frame.ambientBeatProgress = progress
      frame.ambientBeatWeight =
        Math.sin(Math.PI * progress) * frame.ambientWeight
      frame.ambientBeatDirection = phrase.direction
      frame.ambientBeatStrength = phrase.strength
      return
    }

    scoreTime -= phrase.durationMs
  }
}

export function updateSceneChoreographyFrame(
  frame: SceneChoreographyFrame,
  timeMs: number,
  lastPointerActivityMs: number,
  lastImpactMs: number,
) {
  const time = Math.max(0, timeMs)
  const pointerAge = Math.max(0, time - Math.max(0, lastPointerActivityMs))
  frame.focusWeight = 1 - smoothstep(180, FOCUS_RELEASE_MS, pointerAge)
  frame.ambientWeight = smoothstep(
    AMBIENT_START_MS,
    AMBIENT_FULL_MS,
    pointerAge,
  )
  updateAmbientBeat(frame, time)

  const impactAge = Number.isFinite(lastImpactMs)
    ? Math.max(0, time - lastImpactMs)
    : IMPACT_DURATION_MS
  const impactProgress = clampUnit(impactAge / IMPACT_DURATION_MS)
  frame.impactWeight =
    impactProgress < 1
      ? Math.sin(Math.PI * impactProgress) * (1 - impactProgress * 0.12)
      : 0
  frame.mode =
    frame.impactWeight > 0.001
      ? 'impact'
      : frame.focusWeight > 0.001
        ? 'focus'
        : 'ambient'
}

export function getChoreographyLayerWaveWeight(
  progress: number,
  layerIndex: number,
  layerCount: number,
  direction: SceneChoreographyDirection = 1,
) {
  if (layerCount <= 0 || layerIndex < 0 || layerIndex >= layerCount) return 0
  const normalizedIndex =
    layerCount === 1
      ? 0
      : direction === 1
        ? layerIndex / (layerCount - 1)
        : 1 - layerIndex / (layerCount - 1)
  const delay = normalizedIndex * 0.38
  const localProgress = (clampUnit(progress) - delay) / 0.52
  if (localProgress <= 0 || localProgress >= 1) return 0
  return Math.sin(Math.PI * localProgress) * (1 - localProgress * 0.16)
}
