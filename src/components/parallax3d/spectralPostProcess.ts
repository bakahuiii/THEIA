import * as THREE from 'three'

export type SpectralPostProcessSettings = {
  intensity: number
  aberration: number
  shafts: number
  mist: number
  grain: number
  grainSize: number
  grainFlow: number
  glitch: number
}

export type SpectralPostProcessFrame = {
  time: number
  pointer: THREE.Vector2
  velocity: THREE.Vector2
  energy: number
  ambientDrift: number
  motionRestraint: number
  reducedMotion: boolean
}

const vertexShader = /* glsl */ `
precision highp float;

in vec3 position;
out vec2 vUv;

void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position, 1.0);
}
`

const fragmentShader = /* glsl */ `
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSource;
uniform vec2 uViewport;
uniform vec2 uPointer;
uniform vec2 uVelocity;
uniform float uTime;
uniform float uEnergy;
uniform float uIntensity;
uniform float uAberration;
uniform float uShafts;
uniform float uMist;
uniform float uGrain;
uniform float uGrainSize;
uniform float uGrainFlow;
uniform float uGlitch;
uniform float uAmbientDrift;
uniform float uMotionRestraint;
uniform float uReducedMotion;

const float PI = 3.14159265359;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    value += noise(p) * amplitude;
    p = p * 2.03 + vec2(17.2, 9.1);
    amplitude *= 0.5;
  }
  return value;
}

vec3 samplePrism(vec2 uv, vec2 direction, float amount) {
  vec2 offset = direction * amount / uViewport;
  float red = texture(uSource, uv + offset * 1.7).r;
  float green = texture(uSource, uv).g;
  float blue = texture(uSource, uv - offset * 1.35).b;
  return vec3(red, green, blue);
}

float luma(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec2 aspect = vec2(uViewport.x / max(uViewport.y, 1.0), 1.0);
  vec2 centered = (vUv - 0.5) * aspect;
  vec2 pointer = (uPointer - 0.5) * aspect;
  float radius = length(centered);
  float pointerRadius = length(centered - pointer);
  vec2 velocity = uVelocity / max(uViewport, vec2(1.0));
  vec2 flow = normalize(velocity + vec2(0.0001, 0.00007));
  float speed = clamp(length(velocity) * 12.0, 0.0, 1.0);
  float ambientRestraint = clamp(uAmbientDrift * uMotionRestraint, 0.0, 1.0);

  float t = uTime * (0.45 + uEnergy * 0.9);
  vec2 warp = vec2(
    fbm(centered * 2.4 + vec2(t * 0.08, -t * 0.04)),
    fbm(centered * 2.2 + vec2(-t * 0.05, t * 0.07))
  ) - 0.5;
  warp *= (0.25 + uEnergy * 0.8) * uMist * (1.0 - uReducedMotion)
    * mix(1.0, 0.56, ambientRestraint);

  vec2 warpedUv = clamp(vUv + warp * 0.012, 0.001, 0.999);
  vec2 radial = normalize(centered + vec2(0.00001));
  vec2 prismDirection = radial * (0.25 + radius * 1.8) + flow * speed * 0.65;
  float prismAmount = uAberration * uIntensity * (0.25 + radius * radius * 1.7)
    * mix(1.0, 0.54, ambientRestraint);
  vec3 base = samplePrism(warpedUv, prismDirection, prismAmount * (1.0 + uEnergy * 0.9));

  float edgeX = luma(texture(uSource, warpedUv + vec2(1.0 / uViewport.x, 0.0)).rgb)
    - luma(texture(uSource, warpedUv - vec2(1.0 / uViewport.x, 0.0)).rgb);
  float edgeY = luma(texture(uSource, warpedUv + vec2(0.0, 1.0 / uViewport.y)).rgb)
    - luma(texture(uSource, warpedUv - vec2(0.0, 1.0 / uViewport.y)).rgb);
  float edge = smoothstep(0.035, 0.34, length(vec2(edgeX, edgeY)));
  vec3 spectralEdge = vec3(0.99, 0.17, 0.43) * edge * (0.16 + uEnergy * 0.5);
  spectralEdge += vec3(0.02, 0.62, 0.98) * edge * (0.12 + radius * 0.24);

  vec2 light = vec2(-0.42, -0.28) + pointer * 0.22;
  vec2 toLight = light - centered;
  float shaft = 0.0;
  vec2 rayUv = warpedUv;
  for (int i = 0; i < 12; i++) {
    float fi = float(i) / 11.0;
    rayUv = clamp(rayUv + toLight / uViewport * (0.85 + fi * 0.45), 0.002, 0.998);
    vec3 raySample = texture(uSource, rayUv).rgb;
    float beam = smoothstep(0.56, 0.98, luma(raySample));
    shaft += beam * (1.0 - fi * 0.72);
  }
  shaft = shaft / 12.0 * smoothstep(1.15, 0.03, length(toLight)) * uShafts
    * mix(1.0, 0.7, ambientRestraint);
  vec3 shaftColor = mix(vec3(1.0, 0.24, 0.2), vec3(0.12, 0.76, 1.0), 0.5 + 0.5 * sin(t * 0.7));

  float halo = exp(-pointerRadius * (2.8 + uEnergy * 2.0)) * (0.12 + uEnergy * 0.26);
  float grainFrame = floor(uTime * uGrainFlow * 18.0);
  vec2 grainCell = floor(vUv * uViewport / max(uGrainSize, 0.25));
  float grain = hash12(grainCell + vec2(grainFrame * 17.0, grainFrame * 31.0)) - 0.5;
  float scan = 0.985 + 0.015 * sin(vUv.y * uViewport.y * PI);
  float glitchBand = smoothstep(0.985, 1.0, sin(vUv.y * 37.0 + t * 4.0) * 0.5 + 0.5);
  float glitch = glitchBand * hash12(vec2(floor(vUv.y * 48.0), floor(t * 5.0)))
    * uGlitch * speed * mix(1.0, 0.28, ambientRestraint);
  vec2 glitchUv = warpedUv + vec2((glitch - 0.5) * 0.018, 0.0);
  vec3 glitchColor = texture(uSource, clamp(glitchUv, 0.001, 0.999)).rgb;
  base = mix(base, glitchColor, glitch * 0.7);

  vec3 color = base;
  color += spectralEdge * uIntensity;
  color += shaftColor * shaft * (0.25 + uIntensity * 0.42);
  color += vec3(0.9, 0.25, 0.18) * halo * uIntensity;
  color += grain * uGrain * (0.12 + uEnergy * 0.28);
  color *= scan;
  float vignette = smoothstep(1.34, 0.28, radius);
  color *= mix(0.78, 1.0, vignette);
  color = max(color, vec3(0.0));
  outColor = vec4(color, 1.0);
}
`

function createSourceTexture(width: number, height: number) {
  const texture = new THREE.DataTexture(
    new Uint8Array(width * height * 4),
    width,
    height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  )
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

export class SpectralPostProcess {
  private sourceTexture = createSourceTexture(1, 1)
  private readonly viewport = new THREE.Vector2(1, 1)
  private readonly pointer = new THREE.Vector2(0.5, 0.5)
  private readonly velocity = new THREE.Vector2()
  private readonly time = { value: 0 }
  private readonly energy = { value: 0 }
  private readonly intensity = { value: 0.82 }
  private readonly aberration = { value: 2.2 }
  private readonly shafts = { value: 0.72 }
  private readonly mist = { value: 0.72 }
  private readonly grain = { value: 0.34 }
  private readonly grainSize = { value: 1 }
  private readonly grainFlow = { value: 0.4 }
  private readonly glitch = { value: 0.25 }
  private readonly ambientDrift = { value: 0 }
  private readonly motionRestraint = { value: 0 }
  private readonly reducedMotion = { value: 0 }
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.Camera()
  private readonly geometry: THREE.BufferGeometry
  private readonly material: THREE.RawShaderMaterial

  constructor() {
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
    )
    this.material = new THREE.RawShaderMaterial({
      name: 'SpectralAtmosphereMaterial',
      glslVersion: THREE.GLSL3,
      vertexShader,
      fragmentShader,
      uniforms: {
        uSource: { value: this.sourceTexture },
        uViewport: { value: this.viewport },
        uPointer: { value: this.pointer },
        uVelocity: { value: this.velocity },
        uTime: this.time,
        uEnergy: this.energy,
        uIntensity: this.intensity,
        uAberration: this.aberration,
        uShafts: this.shafts,
        uMist: this.mist,
        uGrain: this.grain,
        uGrainSize: this.grainSize,
        uGrainFlow: this.grainFlow,
        uGlitch: this.glitch,
        uAmbientDrift: this.ambientDrift,
        uMotionRestraint: this.motionRestraint,
        uReducedMotion: this.reducedMotion,
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    const triangle = new THREE.Mesh(this.geometry, this.material)
    triangle.name = 'SpectralAtmosphereTriangle'
    triangle.frustumCulled = false
    this.scene.add(triangle)
  }

  setSettings(settings: SpectralPostProcessSettings) {
    this.intensity.value = settings.intensity
    this.aberration.value = settings.aberration
    this.shafts.value = settings.shafts
    this.mist.value = settings.mist
    this.grain.value = settings.grain
    this.grainSize.value = settings.grainSize
    this.grainFlow.value = settings.grainFlow
    this.glitch.value = settings.glitch
  }

  setFrame(frame: SpectralPostProcessFrame) {
    this.time.value = frame.time / 1000
    this.pointer.copy(frame.pointer)
    this.velocity.copy(frame.velocity)
    this.energy.value = THREE.MathUtils.clamp(frame.energy, 0, 1)
    this.ambientDrift.value = THREE.MathUtils.clamp(frame.ambientDrift, 0, 1)
    this.motionRestraint.value = THREE.MathUtils.clamp(
      frame.motionRestraint,
      0,
      1,
    )
    this.reducedMotion.value = frame.reducedMotion ? 1 : 0
  }

  resize(width: number, height: number) {
    const nextWidth = Math.max(1, Math.floor(width))
    const nextHeight = Math.max(1, Math.floor(height))
    this.viewport.set(nextWidth, nextHeight)
    if (
      this.sourceTexture.image.width === nextWidth &&
      this.sourceTexture.image.height === nextHeight
    ) {
      return
    }
    const previousTexture = this.sourceTexture
    this.sourceTexture = createSourceTexture(nextWidth, nextHeight)
    this.material.uniforms.uSource.value = this.sourceTexture
    previousTexture.dispose()
  }

  render(renderer: THREE.WebGLRenderer) {
    renderer.copyFramebufferToTexture(this.sourceTexture)
    const autoClear = renderer.autoClear
    renderer.autoClear = false
    renderer.render(this.scene, this.camera)
    renderer.autoClear = autoClear
  }

  dispose() {
    this.sourceTexture.dispose()
    this.geometry.dispose()
    this.material.dispose()
  }
}
