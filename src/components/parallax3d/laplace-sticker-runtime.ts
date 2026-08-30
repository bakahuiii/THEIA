import * as THREE from 'three'
import {
  getLaplaceStickerFrames,
  getLaplaceSwimmerProfile,
  LAPLACE_SWIMMER_COUNT,
  LAPLACE_WORLD_X_WRAP,
  type LaplaceStickerFrame,
} from './laplaceMotion'
import {
  LAPLACE_BODY_ASPECT,
  LAPLACE_STICKER_TEXTURES,
  LAPLACE_TAIL_ONE_ASPECT,
  LAPLACE_TAIL_TWO_ASPECT,
  type TuningSettings,
} from './parallax-scene-config'

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

export type LaplaceStickerRuntimeOptions = {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  host: HTMLDivElement
  getTuning: () => TuningSettings
  isDisposed: () => boolean
  scheduleFrame: () => void
}

export function createLaplaceStickerRuntime({
  scene,
  camera,
  renderer,
  host,
  getTuning,
  isDisposed,
  scheduleFrame,
}: LaplaceStickerRuntimeOptions) {
  let school: THREE.Group | null = null
  const rigs: LaplaceStickerRig[] = []
  const materials: THREE.MeshBasicMaterial[] = []
  const geometries: THREE.BufferGeometry[] = []
  const textures: THREE.Texture[] = []
  let lastMotionAt = 0

  const dispose = () => {
    if (school) scene.remove(school)
    school = null
    rigs.length = 0
    lastMotionAt = 0
    materials.forEach((material) => material.dispose())
    materials.length = 0
    geometries.forEach((geometry) => geometry.dispose())
    geometries.length = 0
    textures.forEach((texture) => texture.dispose())
    textures.length = 0
  }

  const hide = () => {
    if (school) school.visible = false
  }

  const createMaterial = (texture: THREE.Texture) => {
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.004,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    materials.push(material)
    return material
  }

  const createRig = (
    index: number,
    bodyTexture: THREE.Texture,
    tailOneTexture: THREE.Texture,
    tailTwoTexture: THREE.Texture,
  ): LaplaceStickerRig => {
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
    geometries.push(bodyGeometry, tailOneGeometry, tailTwoGeometry)

    const bodyMaterial = createMaterial(bodyTexture)
    const tailOneMaterial = createMaterial(tailOneTexture)
    const tailTwoMaterial = createMaterial(tailTwoTexture)
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
    const tailOne = new THREE.Group()
    const tailTwo = new THREE.Group()
    const tailOneMesh = new THREE.Mesh(tailOneGeometry, tailOneMaterial)
    const tailTwoMesh = new THREE.Mesh(tailTwoGeometry, tailTwoMaterial)

    // Keep the source layers slightly separated so the construction reads as a
    // physical stack without changing the original silhouette.
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

  const updateRig = (
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

  const load = async () => {
    try {
      const textureLoader = new THREE.TextureLoader()
      const [bodyTexture, tailOneTexture, tailTwoTexture] = await Promise.all(
        Object.values(LAPLACE_STICKER_TEXTURES).map((url) =>
          textureLoader.loadAsync(url),
        ),
      )
      if (isDisposed()) {
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
        textures.push(texture)
      }

      school = new THREE.Group()
      school.name = 'LaplaceStickerSchool'
      for (let index = 0; index < LAPLACE_SWIMMER_COUNT; index += 1) {
        const rig = createRig(index, bodyTexture, tailOneTexture, tailTwoTexture)
        rigs.push(rig)
        school.add(rig.facing)
      }
      ;[...rigs]
        .sort((left, right) => left.worldDepth - right.worldDepth)
        .forEach((rig, index) => {
          const renderOrder = 6 + index * 6
          rig.tailTwoMesh.renderOrder = renderOrder
          rig.tailOneMesh.renderOrder = renderOrder + 1
          rig.body.renderOrder = renderOrder + 2
        })
      scene.add(school)
      host.dataset.laplaceStickers = 'ready'
      scheduleFrame()
    } catch (error) {
      console.warn('Unable to load Laplace sticker layers:', error)
    }
  }

  const update = (time: number) => {
    if (!school || !rigs.length) return false
    const tuning = getTuning()
    const intensity = THREE.MathUtils.clamp(tuning.laplaceIntensity, 0, 1.5)
    if (intensity <= 0.001) {
      school.visible = false
      lastMotionAt = time
      return false
    }

    const deltaSeconds = lastMotionAt
      ? Math.min(0.06, Math.max(0, time - lastMotionAt) / 1000)
      : 0
    lastMotionAt = time
    const frames = getLaplaceStickerFrames(time, intensity, {
      speedMultiplier: tuning.laplaceSpeed,
      tailFrequency: tuning.laplaceTailFrequency,
    })
    school.visible = true
    frames.forEach((frame, index) => {
      const rig = rigs[index]
      if (rig) updateRig(rig, frame, deltaSeconds)
    })
    return true
  }

  return { dispose, hide, load, update }
}
