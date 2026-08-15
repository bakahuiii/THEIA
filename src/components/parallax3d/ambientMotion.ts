export type AmbientTransform = {
  x: number
  y: number
  z: number
  scale: number
  rotation: number
}

export type AmbientMotionFrame = {
  cameraX: number
  cameraY: number
  cameraZoom: number
  cameraWeight: number
  figures: AmbientTransform[]
  lettering: AmbientTransform
  speechBubble: AmbientTransform
  whale: AmbientTransform
}

export type AmbientMotionOptions = {
  intensity: number
  cameraIntensity: number
  layerIntensity: number
}

const FIGURE_PHASES = [0.18, 1.64, 3.02, 4.48, 5.74]
const AUTO_CAMERA_DELAY_MS = 700
const AUTO_CAMERA_FADE_MS = 1500
const DEFAULT_OPTIONS: AmbientMotionOptions = {
  intensity: 1,
  cameraIntensity: 1,
  layerIntensity: 1,
}

const createTransform = (): AmbientTransform => ({
  x: 0,
  y: 0,
  z: 0,
  scale: 1,
  rotation: 0,
})

export function createAmbientMotionFrame(): AmbientMotionFrame {
  return {
    cameraX: 0,
    cameraY: 0,
    cameraZoom: 0,
    cameraWeight: 0,
    figures: FIGURE_PHASES.map(createTransform),
    lettering: createTransform(),
    speechBubble: createTransform(),
    whale: createTransform(),
  }
}

function smoothstep(edge0: number, edge1: number, value: number) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1
  const normalized = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return normalized * normalized * (3 - 2 * normalized)
}

export function updateAmbientMotionFrame(
  frame: AmbientMotionFrame,
  timeMs: number,
  lastPointerActivityMs: number,
  options: AmbientMotionOptions = DEFAULT_OPTIONS,
) {
  const time = Math.max(0, timeMs) / 1000
  const intensity = Math.min(1.5, Math.max(0, options.intensity))
  const cameraIntensity = Math.min(1.5, Math.max(0, options.cameraIntensity))
  const layerIntensity = Math.min(1.5, Math.max(0, options.layerIntensity))
  const inactiveFor = Math.max(
    0,
    timeMs - Math.max(0, lastPointerActivityMs) - AUTO_CAMERA_DELAY_MS,
  )
  const cameraWeight = smoothstep(0, AUTO_CAMERA_FADE_MS, inactiveFor)
  const cameraScale = intensity * cameraIntensity
  const layerScale = intensity * layerIntensity
  frame.cameraWeight = cameraWeight

  frame.cameraX =
    (Math.sin(time * 0.21) * 0.058 + Math.sin(time * 0.073 + 0.9) * 0.023) *
    cameraWeight *
    cameraScale
  frame.cameraY =
    (Math.cos(time * 0.18 + 0.4) * 0.038 + Math.sin(time * 0.11) * 0.019) *
    cameraWeight *
    cameraScale
  frame.cameraZoom =
    (0.006 + Math.sin(time * 0.27) * 0.002) * cameraWeight * cameraScale

  frame.figures.forEach((transform, index) => {
    const phase = FIGURE_PHASES[index]
    const depthWeight = 1 - index * 0.09
    transform.x = Math.sin(time * 0.43 + phase) * 0.014 * depthWeight * layerScale
    transform.y = Math.cos(time * 0.78 + phase) * 0.019 * depthWeight * layerScale
    transform.z = Math.sin(time * 0.62 + phase * 1.7) * 0.011 * depthWeight * layerScale
    transform.scale =
      1 + Math.sin(time * 1.06 + phase) * 0.010 * depthWeight * layerScale
    transform.rotation =
      Math.sin(time * 0.49 + phase) * 0.014 * depthWeight * layerScale
  })

  const lettering = frame.lettering
  lettering.x = Math.sin(time * 0.23 + 1.4) * 0.012 * layerScale
  lettering.y = Math.cos(time * 0.51 + 0.8) * 0.018 * layerScale
  lettering.z = Math.sin(time * 0.34 + 2.1) * 0.006 * layerScale
  lettering.scale = 1 + Math.sin(time * 0.72 + 0.5) * 0.009 * layerScale
  lettering.rotation = Math.sin(time * 0.31 + 1.9) * 0.010 * layerScale

  const speechBubble = frame.speechBubble
  speechBubble.x = Math.sin(time * 0.54 + 2.2) * 0.018 * layerScale
  speechBubble.y = Math.cos(time * 0.93 + 1.1) * 0.028 * layerScale
  speechBubble.z = Math.sin(time * 0.66 + 0.6) * 0.008 * layerScale
  speechBubble.scale = 1 + Math.sin(time * 1.18 + 0.4) * 0.012 * layerScale
  speechBubble.rotation = Math.sin(time * 0.68 + 0.8) * 0.032 * layerScale

  const whale = frame.whale
  whale.x = Math.sin(time * 0.31 + 0.2) * 0.040 * layerScale
  whale.y = Math.cos(time * 0.47 + 1.8) * 0.048 * layerScale
  whale.z = Math.sin(time * 0.38 + 2.4) * 0.012 * layerScale
  whale.scale = 1 + Math.sin(time * 0.64 + 1.2) * 0.016 * layerScale
  whale.rotation = Math.sin(time * 0.41 + 2.7) * 0.052 * layerScale
}
