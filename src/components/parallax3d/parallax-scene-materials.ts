import * as THREE from 'three'

export function configureSceneMaterial(
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

export function disposeScene(root: THREE.Object3D) {
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
