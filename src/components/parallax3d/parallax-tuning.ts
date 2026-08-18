export type ParallaxTuning = {
  orbitX: number;
  orbitY: number;
  depthScale: number;
  overscan: number;
  damping: number;
  inkEnabled: boolean;
  inkStrength: number;
  inkPitch: number;
  inkRegistration: number;
  inkTrail: number;
  inkTrailWidth: number;
  inkTrailLifetime: number;
  motionEnabled: boolean;
  motionStrength: number;
  motionElasticity: number;
  motionChromatic: number;
  ambientIntensity: number;
  ambientCamera: number;
  ambientLayers: number;
  sceneRhythm: number;
  laplaceIntensity: number;
  laplaceSpeed: number;
  laplaceTailFrequency: number;
  ambientSpectralRestraint: number;
  spectralEnabled: boolean;
  spectralIntensity: number;
  spectralAberration: number;
  spectralShafts: number;
  spectralMist: number;
  spectralGrain: number;
  spectralGrainSize: number;
  spectralGrainFlow: number;
  spectralGlitch: number;
  figure1Z: number;
  figure2Z: number;
  figure3Z: number;
  figure4Z: number;
  figure5Z: number;
};

export type ParallaxNumericKey = Exclude<
  keyof ParallaxTuning,
  "inkEnabled" | "motionEnabled" | "spectralEnabled"
>;

export type ParallaxSliderDefinition = {
  key: ParallaxNumericKey;
  label: string;
  min: number;
  max: number;
  step: number;
  digits: number;
  hint?: string;
};

export type ParallaxTuningGroup = {
  id: "camera" | "depth" | "ink" | "motion" | "spectral";
  label: string;
  detail: string;
  sliders: readonly ParallaxSliderDefinition[];
  toggles?: readonly {
    key: "inkEnabled" | "motionEnabled" | "spectralEnabled";
    label: string;
    detail: string;
  }[];
};

export const PARALLAX_TUNING_STORAGE_KEY =
  "parallax-glb-camera-tuning-v1:motion-lab";
export const PARALLAX_TUNING_SCHEMA_VERSION = 14;
export const PARALLAX_TUNING_EVENT = "theia:parallax-tuning-change";

export const DEFAULT_PARALLAX_TUNING: ParallaxTuning = {
  orbitX: 0.43,
  orbitY: 0.34,
  depthScale: 1.4,
  overscan: 0,
  damping: 9,
  inkEnabled: true,
  inkStrength: 1,
  inkPitch: 5.8,
  inkRegistration: 1.25,
  inkTrail: 1.5,
  inkTrailWidth: 1,
  inkTrailLifetime: 1,
  motionEnabled: true,
  motionStrength: 1,
  motionElasticity: 0.72,
  motionChromatic: 0.55,
  ambientIntensity: 1,
  ambientCamera: 1,
  ambientLayers: 1.02,
  sceneRhythm: 1,
  laplaceIntensity: 0.9,
  laplaceSpeed: 0.61,
  laplaceTailFrequency: 0.64,
  ambientSpectralRestraint: 0.11,
  spectralEnabled: true,
  spectralIntensity: 0.82,
  spectralAberration: 0.85,
  spectralShafts: 0.24,
  spectralMist: 0.72,
  spectralGrain: 0.43,
  spectralGrainSize: 1.5,
  spectralGrainFlow: 0.4,
  spectralGlitch: 0.09,
  figure1Z: 0,
  figure2Z: 0,
  figure3Z: 0,
  figure4Z: 0,
  figure5Z: 0,
};

export const PARALLAX_TUNING_GROUPS: readonly ParallaxTuningGroup[] = [
  {
    id: "camera",
    label: "相机",
    detail: "视角、边缘余量与跟随惯性",
    sliders: [
      { key: "orbitX", label: "横向视角", min: 0, max: 0.65, step: 0.01, digits: 2, hint: "左右视差幅度" },
      { key: "orbitY", label: "纵向视角", min: 0, max: 0.5, step: 0.01, digits: 2, hint: "上下视差幅度" },
      { key: "overscan", label: "边缘余量", min: 0, max: 0.18, step: 0.005, digits: 3, hint: "避免视角移动时露出画布边缘" },
      { key: "damping", label: "跟随速度", min: 2, max: 20, step: 0.5, digits: 1, hint: "数值越高越紧跟指针" },
    ],
  },
  {
    id: "depth",
    label: "景深",
    detail: "整体纵深与五个人物层级",
    sliders: [
      { key: "depthScale", label: "整体景深", min: 0, max: 1.8, step: 0.01, digits: 2, hint: "人物层之间的纵深距离" },
      { key: "figure1Z", label: "F1 左侧最近", min: -0.9, max: 0.9, step: 0.01, digits: 2 },
      { key: "figure2Z", label: "F2 左中", min: -0.9, max: 0.9, step: 0.01, digits: 2 },
      { key: "figure3Z", label: "F3 中间", min: -0.9, max: 0.9, step: 0.01, digits: 2 },
      { key: "figure4Z", label: "F4 右中", min: -0.9, max: 0.9, step: 0.01, digits: 2 },
      { key: "figure5Z", label: "F5 右侧最远", min: -0.9, max: 0.9, step: 0.01, digits: 2 },
    ],
  },
  {
    id: "ink",
    label: "墨水",
    detail: "点阵显影与指针尾迹",
    toggles: [
      { key: "inkEnabled", label: "墨水显影", detail: "启用原始点阵扩散与套色" },
    ],
    sliders: [
      { key: "inkStrength", label: "显影强度", min: 0, max: 1, step: 0.01, digits: 2 },
      { key: "inkPitch", label: "网点尺寸", min: 3.8, max: 9, step: 0.1, digits: 1 },
      { key: "inkRegistration", label: "套色偏移", min: 0, max: 3, step: 0.05, digits: 2 },
      { key: "inkTrail", label: "尾迹强度", min: 0, max: 2.5, step: 0.05, digits: 2 },
      { key: "inkTrailWidth", label: "尾迹宽度", min: 0.4, max: 1.8, step: 0.01, digits: 2 },
      { key: "inkTrailLifetime", label: "尾迹存留", min: 0.35, max: 1.6, step: 0.01, digits: 2 },
    ],
  },
  {
    id: "motion",
    label: "动势",
    detail: "呼吸、漂移与拉普拉斯游动",
    toggles: [
      { key: "motionEnabled", label: "层间动势", detail: "启用人物与图层的柔性漂移" },
    ],
    sliders: [
      { key: "motionStrength", label: "动势", min: 0, max: 1.5, step: 0.01, digits: 2 },
      { key: "motionElasticity", label: "层间弹性", min: 0, max: 1, step: 0.01, digits: 2 },
      { key: "motionChromatic", label: "光谱色散", min: 0, max: 2, step: 0.05, digits: 2 },
      { key: "ambientIntensity", label: "环境幅度", min: 0, max: 1.5, step: 0.01, digits: 2 },
      { key: "ambientCamera", label: "镜头漂移", min: 0, max: 1.5, step: 0.01, digits: 2 },
      { key: "ambientLayers", label: "图层呼吸", min: 0, max: 1.5, step: 0.01, digits: 2 },
      { key: "sceneRhythm", label: "场景节奏", min: 0, max: 1.5, step: 0.01, digits: 2 },
      { key: "laplaceIntensity", label: "贴纸浮游", min: 0, max: 1.5, step: 0.01, digits: 2 },
      { key: "laplaceSpeed", label: "贴纸游速", min: 0.25, max: 2.25, step: 0.01, digits: 2 },
      { key: "laplaceTailFrequency", label: "摆尾频率", min: 0.25, max: 2.5, step: 0.01, digits: 2 },
      { key: "ambientSpectralRestraint", label: "光场协同", min: 0, max: 1, step: 0.01, digits: 2 },
    ],
  },
  {
    id: "spectral",
    label: "光场",
    detail: "棱镜、雾场、光束与胶片颗粒",
    toggles: [
      { key: "spectralEnabled", label: "光场后期", detail: "启用光束、雾场与胶片质感" },
    ],
    sliders: [
      { key: "spectralIntensity", label: "光场强度", min: 0, max: 1.5, step: 0.01, digits: 2 },
      { key: "spectralAberration", label: "棱镜色散", min: 0, max: 5, step: 0.05, digits: 2 },
      { key: "spectralShafts", label: "体积光束", min: 0, max: 1.5, step: 0.01, digits: 2 },
      { key: "spectralMist", label: "流动雾场", min: 0, max: 1.5, step: 0.01, digits: 2 },
      { key: "spectralGrain", label: "胶片颗粒", min: 0, max: 1, step: 0.01, digits: 2 },
      { key: "spectralGrainSize", label: "颗粒尺寸", min: 0.5, max: 4, step: 0.1, digits: 1 },
      { key: "spectralGrainFlow", label: "颗粒流速", min: 0, max: 1.5, step: 0.01, digits: 2 },
      { key: "spectralGlitch", label: "扫描扰动", min: 0, max: 1, step: 0.01, digits: 2 },
    ],
  },
] as const;

const PARALLAX_ALL_SLIDERS = PARALLAX_TUNING_GROUPS.flatMap((group) => group.sliders);

function clamp(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

export function readParallaxTuning(
  storageKey = PARALLAX_TUNING_STORAGE_KEY,
): ParallaxTuning {
  const fallback = { ...DEFAULT_PARALLAX_TUNING };
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null") as Partial<ParallaxTuning> | null;
    if (!stored || typeof stored !== "object") return fallback;
    const result = { ...fallback };
    result.inkEnabled = typeof stored.inkEnabled === "boolean" ? stored.inkEnabled : fallback.inkEnabled;
    result.motionEnabled = typeof stored.motionEnabled === "boolean" ? stored.motionEnabled : fallback.motionEnabled;
    result.spectralEnabled = typeof stored.spectralEnabled === "boolean" ? stored.spectralEnabled : fallback.spectralEnabled;
    for (const slider of PARALLAX_ALL_SLIDERS) {
      result[slider.key] = clamp(stored[slider.key], fallback[slider.key], slider.min, slider.max) as never;
    }
    return result;
  } catch {
    return fallback;
  }
}

export function publishParallaxTuning(
  tuning: ParallaxTuning,
  source: "scene" | "settings" = "settings",
  storageKey = PARALLAX_TUNING_STORAGE_KEY,
) {
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify({ ...tuning, version: PARALLAX_TUNING_SCHEMA_VERSION }),
    );
  } catch {
    // The live editor remains usable when storage is unavailable.
  }
  window.dispatchEvent(
    new CustomEvent(PARALLAX_TUNING_EVENT, { detail: { tuning, source } }),
  );
}
