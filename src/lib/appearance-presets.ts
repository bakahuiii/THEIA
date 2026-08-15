import officialPresetList from "../assets/appearance-presets/official-presets.json";
import copperDawn from "../assets/appearance-presets/copper-dawn.json";
import deepCurrent from "../assets/appearance-presets/deep-current.json";
import coolSilver from "../assets/appearance-presets/cool-silver.json";
import buctLake from "../assets/appearance-presets/buct-lake.json";
import buctLakeSpring from "../assets/appearance-presets/buct-lake-spring.json";
import buctLakeSummer from "../assets/appearance-presets/buct-lake-summer.json";
import buctLakeAutumn from "../assets/appearance-presets/buct-lake-autumn.json";
import buctLakeWinter from "../assets/appearance-presets/buct-lake-winter.json";
import type {
  AppearanceVisualPreset,
  Personalization,
  ThemePreset,
} from "../hooks/usePersonalization";

export type VisualPreset = AppearanceVisualPreset & {
  id: string;
  label: string;
  detail: string;
  basePreset?: ThemePreset;
};

export type VisualPresetGroup = {
  label: string;
  detail: string;
  presets: VisualPreset[];
  custom?: boolean;
};

export type SeasonalVisualPreset = VisualPreset & {
  seasonalVariants: Record<"spring" | "summer" | "autumn" | "winter", VisualPreset>;
};

type VisualPresetFile = Omit<VisualPreset, "id">;

// The manifest is the source of truth: every listed ID resolves to the JSON
// file with the same name, so filenames, IDs, and UI entries stay aligned.
const OFFICIAL_PRESET_FILES: Record<string, VisualPresetFile> = {
  "copper-dawn": copperDawn as VisualPresetFile,
  "deep-current": deepCurrent as VisualPresetFile,
  "cool-silver": coolSilver as VisualPresetFile,
  "buct-lake": buctLake as VisualPresetFile,
  "buct-lake-spring": buctLakeSpring as VisualPresetFile,
  "buct-lake-summer": buctLakeSummer as VisualPresetFile,
  "buct-lake-autumn": buctLakeAutumn as VisualPresetFile,
  "buct-lake-winter": buctLakeWinter as VisualPresetFile,
};

const OFFICIAL_PRESETS = officialPresetList.presets.flatMap((id) => {
  const preset = OFFICIAL_PRESET_FILES[id];
  return preset ? [{ id, ...preset }] : [];
});

// Dynamic scenes share the same preset picker as static appearances, but
// carry an explicit scene id so the renderer can be mounted lazily. Reusing a
// tested static palette keeps the card metadata complete without changing the
// existing background presets.
const DEEP_CURRENT = OFFICIAL_PRESETS.find((preset) => preset.id === "deep-current");
export const PARALLAX_3D_PRESET: VisualPreset | null = DEEP_CURRENT
  ? {
      ...DEEP_CURRENT,
      id: "parallax-3d",
      label: "3D 墨景",
      detail: "景深、墨水与拉普拉斯动态场景",
      scene: "parallax-3d",
      background: "none",
      backgroundBuiltin: undefined,
      backgroundUrl: undefined,
      backgroundName: undefined,
    }
  : null;

const LAKE_PRESETS = OFFICIAL_PRESETS.filter((preset) =>
  preset.id.startsWith("buct-lake"),
);
const LAKE_BASE = LAKE_PRESETS.find((preset) => preset.id === "buct-lake");
const seasonalPreset = (id: string) =>
  LAKE_PRESETS.find((preset) => preset.id === id);
const LAKE_SPRING = seasonalPreset("buct-lake-spring");
const LAKE_SUMMER = seasonalPreset("buct-lake-summer");
const LAKE_AUTUMN = seasonalPreset("buct-lake-autumn");
const LAKE_WINTER = seasonalPreset("buct-lake-winter");

export const BUCT_LAKE_PRESET: SeasonalVisualPreset | null =
  LAKE_BASE &&
  LAKE_SPRING &&
  LAKE_SUMMER &&
  LAKE_AUTUMN &&
  LAKE_WINTER
    ? {
        ...LAKE_BASE,
        label: "北化风情",
        detail: "循时而换的镜湖光影",
        seasonalVariants: {
          spring: LAKE_SPRING,
          summer: LAKE_SUMMER,
          autumn: LAKE_AUTUMN,
          winter: LAKE_WINTER,
        },
      }
    : null;

export const VISUAL_PRESET_GROUPS: VisualPresetGroup[] = [
  {
    label: "动态场景",
    detail: "由 WebGL 驱动的沉浸式外观",
    presets: PARALLAX_3D_PRESET ? [PARALLAX_3D_PRESET] : [],
  },
  {
    label: "古典",
    detail: "以双色映射构成的金属色调",
    presets: OFFICIAL_PRESETS.filter((preset) => !preset.id.startsWith("buct-lake")),
  },
  {
    label: "北化风情",
    detail: "取自校园镜湖的四时光影",
    presets: BUCT_LAKE_PRESET ? [BUCT_LAKE_PRESET] : [],
  },
];

export const VISUAL_PRESETS = VISUAL_PRESET_GROUPS.flatMap(
  (group) => group.presets,
);

export function matchesVisualPreset(
  preset: VisualPreset,
  preferences: Personalization,
) {
  const { gradientMap, backgroundImage, backgroundTexture, backgroundMotion } =
    preferences;
  return (
    preferences.scene === (preset.scene ?? "none") &&
    (!preset.basePreset || preferences.preset === preset.basePreset) &&
    (!preset.backgroundBuiltin ||
      (preferences.background === "image" &&
        preferences.backgroundBuiltin === preset.backgroundBuiltin)) &&
    (typeof preset.background === "undefined" ||
      (preferences.background === preset.background &&
        preferences.backgroundBuiltin === preset.backgroundBuiltin &&
        preferences.backgroundUrl === preset.backgroundUrl)) &&
    gradientMap.enabled === preset.gradientMap.enabled &&
    gradientMap.syncPalette === preset.gradientMap.syncPalette &&
    gradientMap.shadow === preset.gradientMap.shadow &&
    gradientMap.highlight === preset.gradientMap.highlight &&
    gradientMap.shadowPosition === preset.gradientMap.shadowPosition &&
    gradientMap.highlightPosition === preset.gradientMap.highlightPosition &&
    preferences.backgroundBlur === preset.backgroundBlur &&
    preferences.backgroundTransparency === preset.backgroundTransparency &&
    backgroundImage.opacity === preset.backgroundImage.opacity &&
    backgroundImage.brightness === preset.backgroundImage.brightness &&
    backgroundImage.contrast === preset.backgroundImage.contrast &&
    backgroundImage.saturation === preset.backgroundImage.saturation &&
    backgroundTexture.enabled === preset.backgroundTexture.enabled &&
    backgroundTexture.opacity === preset.backgroundTexture.opacity &&
    backgroundTexture.height === preset.backgroundTexture.height &&
    backgroundMotion.enabled === preset.backgroundMotion.enabled &&
    backgroundMotion.intensity === preset.backgroundMotion.intensity &&
    backgroundMotion.scale === preset.backgroundMotion.scale
  );
}
