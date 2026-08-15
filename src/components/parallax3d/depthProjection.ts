export const REFERENCE_CAMERA_DISTANCE = 4

const MIN_REFERENCE_RAY_DISTANCE = 1e-6

export function remapDepth(
  sourceZ: number,
  depthScale: number,
  depthOffset = 0,
) {
  return sourceZ * depthScale + depthOffset
}

export function getReferenceRayScale(
  sourceZ: number,
  targetZ: number,
  cameraDistance = REFERENCE_CAMERA_DISTANCE,
) {
  const sourceDistance = cameraDistance - sourceZ
  if (Math.abs(sourceDistance) < MIN_REFERENCE_RAY_DISTANCE) {
    throw new RangeError('A depth vertex cannot lie on the reference camera plane.')
  }
  return (cameraDistance - targetZ) / sourceDistance
}
