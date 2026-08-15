export type KineticWaveState = {
  active: boolean
  progress: number
  envelope: number
}

function clampUnit(value: number) {
  return Math.min(1, Math.max(0, value))
}

export function getKineticWaveState(
  time: number,
  start: number,
  duration: number,
): KineticWaveState {
  if (!Number.isFinite(duration) || duration <= 0) {
    return { active: false, progress: 1, envelope: 0 }
  }

  const elapsed = time - start
  if (!Number.isFinite(elapsed) || elapsed < 0) {
    return { active: false, progress: 0, envelope: 0 }
  }

  const progress = clampUnit(elapsed / duration)
  const active = progress < 1
  const envelope = active
    ? Math.sin(Math.PI * progress) * (1 - progress * 0.12)
    : 0
  return { active, progress, envelope }
}

export function getLayerWaveWeight(
  progress: number,
  layerIndex: number,
  layerCount: number,
  elasticity: number,
) {
  if (layerCount <= 0 || layerIndex < 0 || layerIndex >= layerCount) return 0

  const normalizedIndex = layerCount === 1 ? 0 : layerIndex / (layerCount - 1)
  const delay = normalizedIndex * 0.28
  const span = 0.5 + clampUnit(elasticity) * 0.2
  const localProgress = (clampUnit(progress) - delay) / span
  if (localProgress <= 0 || localProgress >= 1) return 0

  const attack = Math.sin(Math.PI * localProgress)
  const decay = Math.exp(-localProgress * (1.05 - clampUnit(elasticity) * 0.45))
  return attack * decay
}
