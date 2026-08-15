import * as THREE from 'three'

export const INK_HISTORY_COUNT = 10

export type InkPostProcessSettings = {
  strength: number
  pitch: number
  registration: number
  trail: number
  trailWidth: number
}

export type InkPostProcessFrame = {
  pointer: THREE.Vector2
  velocity: THREE.Vector2
  history: readonly THREE.Vector4[]
  speed: number
  pointerActive: boolean
  pressed: boolean
  reducedMotion: boolean
  modeProgress: number
  modeActive: boolean
  clickProgress: number
  clickActive: boolean
  transitionOrigin: THREE.Vector2
}

const vertexShader = /* glsl */ `
precision highp float;

in vec3 position;
out vec2 vScreenUv;

void main() {
  vScreenUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position, 1.0);
}
`

// Ported from parallax-background-lab/src/experience/shaders.ts, Ink mode.
const fragmentShader = /* glsl */ `
precision highp float;

in vec2 vScreenUv;
out vec4 outColor;

uniform sampler2D uSource;
uniform vec2 uViewport;
uniform vec2 uPointer;
uniform vec2 uVelocity;
uniform vec4 uHistory[10];
uniform vec4 uMotion;
uniform vec4 uTransition;
uniform vec2 uTransitionOrigin;
uniform vec3 uAccent;
uniform float uDpr;
uniform float uStrength;
uniform float uPitch;
uniform float uRegistration;
uniform float uTrail;
uniform float uTrailWidth;

const float PI = 3.141592653589793;

float saturate(float value) {
  return clamp(value, 0.0, 1.0);
}

float luma(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

float hash11(float value) {
  return fract(sin(value * 127.1 + 311.7) * 43758.5453123);
}

mat2 rotate2d(float angle) {
  float sine = sin(angle);
  float cosine = cos(angle);
  return mat2(cosine, -sine, sine, cosine);
}

vec3 sourceAt(vec2 screenUv) {
  vec2 halfTexel = 0.5 / max(uViewport, vec2(1.0));
  vec2 sourceUv = vec2(screenUv.x, 1.0 - screenUv.y);
  return texture(
    uSource,
    clamp(sourceUv, halfTexel, 1.0 - halfTexel)
  ).rgb;
}

float circularField(vec2 screenUv, vec2 center, float speed, float scale) {
  float aspect = uViewport.x / max(uViewport.y, 1.0);
  vec2 offset = (screenUv - center) * vec2(aspect, 1.0);
  float radius = mix(0.078, 0.106, speed) * scale;
  float distanceToCenter = length(offset);
  return 1.0 - smoothstep(radius * 0.38, radius, distanceToCenter);
}

float taperedStrokeField(
  vec2 screenUv,
  vec2 start,
  vec2 end,
  float startRadius,
  float endRadius
) {
  float aspect = uViewport.x / max(uViewport.y, 1.0);
  vec2 point = screenUv * vec2(aspect, 1.0);
  vec2 segmentStart = start * vec2(aspect, 1.0);
  vec2 segment = end * vec2(aspect, 1.0) - segmentStart;
  float segmentLengthSq = max(dot(segment, segment), 0.000001);
  float segmentProgress = clamp(
    dot(point - segmentStart, segment) / segmentLengthSq,
    0.0,
    1.0
  );
  float radius = mix(startRadius, endRadius, segmentProgress);
  float distanceToStroke = length(point - segmentStart - segment * segmentProgress);
  return 1.0 - smoothstep(
    radius * 0.36,
    radius,
    distanceToStroke
  );
}

float printSweep(vec2 screenUv, vec2 origin, float progress) {
  float aspect = uViewport.x / max(uViewport.y, 1.0);
  vec2 point = rotate2d(-0.16)
    * ((screenUv - origin) * vec2(aspect, 1.0));
  float row = floor((point.y + 1.5) * 29.0);
  float rowOffset = (hash11(row) - 0.5) * 0.17;
  float paperBuckling = sin(point.y * 41.0 + rowOffset * 17.0) * 0.012;
  float metric = abs(point.x + rowOffset + paperBuckling)
    + abs(point.y) * 0.23;
  float reach = mix(-0.11, 2.25, progress);
  float body = 1.0 - smoothstep(
    reach - 0.025,
    reach + 0.025,
    metric
  );
  float leadingEdge = 1.0 - smoothstep(
    0.018,
    0.072,
    abs(metric - reach)
  );
  vec2 rosetteUv = rotate2d(0.78) * (point * 58.0);
  float rosette = 0.5
    + 0.5 * sin(rosetteUv.x) * sin(rosetteUv.y);
  return saturate(
    body
      + leadingEdge * smoothstep(0.42, 0.78, rosette) * 0.7
  );
}

float edgeStrength(vec2 screenUv, vec2 cssSourcePixel) {
  float left = luma(sourceAt(
    screenUv - vec2(cssSourcePixel.x, 0.0)
  ));
  float right = luma(sourceAt(
    screenUv + vec2(cssSourcePixel.x, 0.0)
  ));
  float top = luma(sourceAt(
    screenUv - vec2(0.0, cssSourcePixel.y)
  ));
  float bottom = luma(sourceAt(
    screenUv + vec2(0.0, cssSourcePixel.y)
  ));
  return smoothstep(
    0.045,
    0.235,
    length(vec2(right - left, bottom - top))
  );
}

float screenDot(float coverage, vec2 cssPixel, float angle, float pitch) {
  vec2 cell = fract((rotate2d(angle) * cssPixel) / pitch) - 0.5;
  float distanceToCenter = length(cell);
  float radius = 0.485 * sqrt(saturate(coverage));
  float antialias = max(fwidth(distanceToCenter) * 0.8, 0.008);
  return 1.0 - smoothstep(
    radius - antialias,
    radius + antialias,
    distanceToCenter
  );
}

vec3 inkLook(vec3 base, vec2 cssPixel, vec2 registration, float edge) {
  vec3 cmy = 1.0 - base;
  float blackCoverage = min(cmy.r, min(cmy.g, cmy.b));
  vec3 colorCoverage = (cmy - blackCoverage)
    / max(1.0 - blackCoverage, 0.001);

  float cyanDot = screenDot(
    colorCoverage.r,
    cssPixel + registration,
    0.261799,
    uPitch
  );
  float magentaDot = screenDot(
    colorCoverage.g,
    cssPixel - registration * 0.72,
    1.308997,
    uPitch
  );
  float yellowDot = screenDot(
    colorCoverage.b,
    cssPixel + vec2(registration.y, -registration.x) * 0.45,
    0.0,
    uPitch
  );
  float blackDot = screenDot(
    blackCoverage,
    cssPixel,
    0.785398,
    uPitch * 0.922414
  );

  vec3 result = vec3(0.972, 0.966, 0.944);
  result *= mix(
    vec3(1.0),
    vec3(0.10, 0.78, 0.84),
    cyanDot * 0.82
  );
  result *= mix(
    vec3(1.0),
    vec3(0.96, 0.18, 0.39),
    magentaDot * 0.80
  );
  result *= mix(
    vec3(1.0),
    vec3(1.0, 0.79, 0.13),
    yellowDot * 0.76
  );
  result *= mix(
    vec3(1.0),
    vec3(0.035, 0.038, 0.043),
    blackDot * 0.94
  );
  return mix(
    result,
    mix(vec3(0.025), uAccent * 0.32, 0.24),
    edge * 0.9
  );
}

void main() {
  vec2 screenUv = vec2(vScreenUv.x, 1.0 - vScreenUv.y);
  vec2 cssSourcePixel = uDpr / max(uViewport, vec2(1.0));
  vec2 cssPixel = screenUv * (uViewport / max(uDpr, 0.01));
  vec3 base = sourceAt(screenUv);
  float speed = uMotion.w > 0.5 ? 0.0 : uMotion.x;
  float pointerField = circularField(
    screenUv,
    uPointer,
    speed,
    1.0
  ) * uMotion.y;
  float trailField = 0.0;
  vec2 previousTrailPoint = uPointer;
  float previousTrailStrength = 1.0;
  float previousTrailSpeed = speed;

  for (int index = 0; index < 10; index += 1) {
    vec4 echo = uHistory[index];
    float echoStrength = echo.z * (1.0 - float(index) * 0.035);
    float startRadius = mix(0.036, 0.124, previousTrailStrength)
      * mix(0.9, 1.12, previousTrailSpeed)
      * uTrailWidth;
    float endRadius = mix(0.005, 0.068, echoStrength)
      * mix(0.92, 1.08, echo.w)
      * uTrailWidth;
    float stroke = taperedStrokeField(
      screenUv,
      previousTrailPoint,
      echo.xy,
      startRadius,
      endRadius
    );
    float opacity = mix(0.16, 0.98, echoStrength)
      * (1.0 - float(index) * 0.045);
    trailField = max(trailField, stroke * opacity);
    previousTrailPoint = echo.xy;
    previousTrailStrength = echoStrength;
    previousTrailSpeed = echo.w;
  }

  if (uMotion.w > 0.5) {
    trailField = 0.0;
  }

  float localField = max(
    pointerField,
    trailField * (0.55 + uTrail * 0.68)
  );
  float modeEnvelope = sin(PI * saturate(uTransition.x))
    * uTransition.y;
  float clickEnvelope = sin(PI * saturate(uTransition.z))
    * uTransition.w;
  float modePrint = printSweep(
    screenUv,
    uTransitionOrigin,
    uTransition.x
  ) * modeEnvelope;
  float clickPrint = printSweep(
    screenUv,
    uTransitionOrigin,
    uTransition.z
  ) * clickEnvelope * 0.82;
  float printField = max(modePrint, clickPrint);

  if (uMotion.w > 0.5) {
    printField = max(modeEnvelope, clickEnvelope) * 0.16;
  }

  vec2 registration = length(uVelocity) > 1.0
    ? normalize(uVelocity) * speed * uRegistration
    : vec2(0.0);
  float edge = edgeStrength(screenUv, cssSourcePixel * 1.3);
  vec3 processed = inkLook(base, cssPixel, registration, edge);
  float paperGrain = hash11(
    floor(cssPixel.x) + floor(cssPixel.y) * 173.0
  ) - 0.5;
  processed += paperGrain * 0.018;
  float reveal = max(localField, printField);
  float inkAlpha = saturate(reveal * 0.94 * uStrength);
  if (inkAlpha < 0.001) {
    outColor = vec4(0.0);
    return;
  }
  outColor = vec4(clamp(processed, 0.0, 1.0) * inkAlpha, inkAlpha);
}
`

function createSourceTexture(width: number, height: number) {
  const texture = new THREE.FramebufferTexture(width, height)
  texture.name = 'LumenFieldInkSource'
  texture.colorSpace = THREE.NoColorSpace
  texture.flipY = false
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  return texture
}

export class InkPostProcess {
  private sourceTexture = createSourceTexture(1, 1)
  private readonly viewport = new THREE.Vector2(1, 1)
  private readonly pointer = new THREE.Vector2(0.5, 0.5)
  private readonly velocity = new THREE.Vector2()
  private readonly history = Array.from(
    { length: INK_HISTORY_COUNT },
    () => new THREE.Vector4(0.5, 0.5, 0, 0),
  )
  private readonly motion = new THREE.Vector4()
  private readonly transition = new THREE.Vector4(1, 0, 1, 0)
  private readonly transitionOrigin = new THREE.Vector2(0.5, 0.5)
  private readonly accent = new THREE.Vector3(1, 94 / 255, 83 / 255)
  private readonly dpr = { value: 1 }
  private readonly strength = { value: 1 }
  private readonly pitch = { value: 5.8 }
  private readonly registration = { value: 1.25 }
  private readonly trail = { value: 1.5 }
  private readonly trailWidth = { value: 1 }
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.Camera()
  private readonly geometry: THREE.BufferGeometry
  private readonly material: THREE.RawShaderMaterial

  constructor() {
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [-1, -1, 0, 3, -1, 0, -1, 3, 0],
        3,
      ),
    )
    this.material = new THREE.RawShaderMaterial({
      name: 'LumenFieldInkMaterial',
      glslVersion: THREE.GLSL3,
      vertexShader,
      fragmentShader,
      uniforms: {
        uSource: { value: this.sourceTexture },
        uViewport: { value: this.viewport },
        uPointer: { value: this.pointer },
        uVelocity: { value: this.velocity },
        uHistory: { value: this.history },
        uMotion: { value: this.motion },
        uTransition: { value: this.transition },
        uTransitionOrigin: { value: this.transitionOrigin },
        uAccent: { value: this.accent },
        uDpr: this.dpr,
        uStrength: this.strength,
        uPitch: this.pitch,
        uRegistration: this.registration,
        uTrail: this.trail,
        uTrailWidth: this.trailWidth,
      },
      transparent: true,
      premultipliedAlpha: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    const triangle = new THREE.Mesh(this.geometry, this.material)
    triangle.name = 'LumenFieldInkTriangle'
    triangle.frustumCulled = false
    this.scene.add(triangle)
  }

  setSettings(settings: InkPostProcessSettings) {
    this.strength.value = settings.strength
    this.pitch.value = settings.pitch
    this.registration.value = settings.registration
    this.trail.value = settings.trail
    this.trailWidth.value = settings.trailWidth
  }

  setFrame(frame: InkPostProcessFrame) {
    this.pointer.copy(frame.pointer)
    this.velocity.copy(frame.velocity)
    this.history.forEach((uniform, index) => {
      const sample = frame.history[index]
      if (sample) uniform.copy(sample)
      else uniform.set(frame.pointer.x, frame.pointer.y, 0, 0)
    })
    this.motion.set(
      frame.speed,
      frame.pointerActive ? 1 : 0,
      frame.pressed ? 1 : 0,
      frame.reducedMotion ? 1 : 0,
    )
    this.transition.set(
      frame.modeProgress,
      frame.modeActive ? 1 : 0,
      frame.clickProgress,
      frame.clickActive ? 1 : 0,
    )
    this.transitionOrigin.copy(frame.transitionOrigin)
  }

  resize(width: number, height: number, dpr: number) {
    const nextWidth = Math.max(1, Math.floor(width))
    const nextHeight = Math.max(1, Math.floor(height))
    this.viewport.set(nextWidth, nextHeight)
    this.dpr.value = Math.max(0.01, dpr)

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
