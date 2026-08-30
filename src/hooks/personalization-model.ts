import duotoneBackgroundUrl from "../assets/theia-duotone-source.webp";
import buctLakeBackgroundUrl from "../assets/theia-buct-lake-reflection.webp";
import buctLakeSpringBackgroundUrl from "../assets/theia-buct-lake-spring.webp";
import buctLakeSummerBackgroundUrl from "../assets/theia-buct-lake-summer.webp";
import buctLakeAutumnBackgroundUrl from "../assets/theia-buct-lake-autumn.webp";
import buctLakeWinterBackgroundUrl from "../assets/theia-buct-lake-winter.webp";
import buctLakePreset from "../assets/appearance-presets/buct-lake.json";
import buctLakeSpringPreset from "../assets/appearance-presets/buct-lake-spring.json";
import buctLakeSummerPreset from "../assets/appearance-presets/buct-lake-summer.json";
import buctLakeAutumnPreset from "../assets/appearance-presets/buct-lake-autumn.json";
import buctLakeWinterPreset from "../assets/appearance-presets/buct-lake-winter.json";
import {
  DEFAULT_GRADIENT_MAP_COLORS,
  deriveGradientPalette,
  normalizeGradientColor,
  normalizeGradientStops,
  type GradientMapColors,
  type GradientMapStops,
} from "../lib/gradient-map";
import {
  normalizeBackgroundPalette,
  type BackgroundPalette,
} from "../lib/background-palette";

export type ThemePreset =
  | "classic"
  | "midnight";
export type AppBackground = "none" | "image";
export type ScenePresetId = "none" | "parallax-3d";
export type BuiltInBackground =
  | "aurelia"
  | "duotone"
  | "classical"
  | "buct-lake"
  | "buct-lake-spring"
  | "buct-lake-summer"
  | "buct-lake-autumn"
  | "buct-lake-winter";

export type BackgroundMotion = {
  enabled: boolean;
  intensity: number;
  scale: number;
};

export type BackgroundTexture = {
  enabled: boolean;
  opacity: number;
  height: number;
};

export type BackgroundImageTreatment = {
  opacity: number;
  brightness: number;
  contrast: number;
  saturation: number;
};

export type GradientMap = GradientMapColors & GradientMapStops & {
  enabled: boolean;
  syncPalette: boolean;
};

export type AppearanceVisualSettings = {
  backgroundBlur: number;
  backgroundTransparency: number;
  backgroundImage: BackgroundImageTreatment;
  backgroundTexture: BackgroundTexture;
  backgroundMotion: BackgroundMotion;
  gradientMap: GradientMap;
  backgroundPalette?: BackgroundPalette;
  backgroundPaletteSource?: string;
};

export type AppearanceVisualPreset = AppearanceVisualSettings & {
  scene?: ScenePresetId;
  basePreset?: ThemePreset;
  background?: AppBackground;
  backgroundBuiltin?: BuiltInBackground;
  backgroundUrl?: string;
  backgroundName?: string;
};

export type SavedAppearancePreset = AppearanceVisualPreset & {
  id: string;
  label: string;
  basePreset: ThemePreset;
};

export type Personalization = AppearanceVisualSettings & {
  scene: ScenePresetId;
  preset: ThemePreset;
  background: AppBackground;
  backgroundBuiltin?: BuiltInBackground;
  backgroundUrl?: string;
  backgroundName?: string;
  customVisualPresets: SavedAppearancePreset[];
};

export type LegacyPersonalization = Partial<Personalization> & {
  backgroundClarity?: number;
  chatBackground?: AppBackground;
  chatBackgroundUrl?: string;
  chatBackgroundName?: string;
};

export const BUILT_IN_BACKGROUNDS: Record<
  BuiltInBackground,
  { url: string; name: string }
> = {
  aurelia: {
    url: duotoneBackgroundUrl,
    name: "Aurelia · 墨金拓印",
  },
  duotone: {
    url: duotoneBackgroundUrl,
    name: "Θεία · 蓝白拓印",
  },
  classical: {
    url: duotoneBackgroundUrl,
    name: "THEIA classical etching",
  },
  "buct-lake": {
    url: buctLakeBackgroundUrl,
    name: buctLakePreset.detail,
  },
  "buct-lake-spring": {
    url: buctLakeSpringBackgroundUrl,
    name: buctLakeSpringPreset.detail,
  },
  "buct-lake-summer": {
    url: buctLakeSummerBackgroundUrl,
    name: buctLakeSummerPreset.detail,
  },
  "buct-lake-autumn": {
    url: buctLakeAutumnBackgroundUrl,
    name: buctLakeAutumnPreset.detail,
  },
  "buct-lake-winter": {
    url: buctLakeWinterBackgroundUrl,
    name: buctLakeWinterPreset.detail,
  },
};

export const defaults: Personalization = {
  scene: "parallax-3d",
  preset: "midnight",
  background: "none",
  backgroundBlur: 1,
  backgroundTransparency: 26,
  backgroundImage: {
    opacity: 68,
    brightness: 84,
    contrast: 144,
    saturation: 96,
  },
  backgroundTexture: {
    enabled: true,
    opacity: 1,
    height: 165,
  },
  backgroundMotion: {
    enabled: true,
    intensity: 6,
    scale: 106,
  },
  gradientMap: {
    enabled: true,
    syncPalette: true,
    shadow: "#080d1b",
    highlight: "#244a9a",
    shadowPosition: 14,
    highlightPosition: 85,
  },
  customVisualPresets: [],
};

export const GRADIENT_PALETTE_VARIABLES = Object.keys(
  deriveGradientPalette(DEFAULT_GRADIENT_MAP_COLORS).variables,
);

function clamp(value: unknown, minimum: number, maximum: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(minimum, Math.min(maximum, number))
    : fallback;
}

function isBuiltInBackground(value: unknown): value is BuiltInBackground {
  return value === "aurelia" || value === "duotone" || value === "classical" || value === "buct-lake" || value === "buct-lake-spring" || value === "buct-lake-summer" || value === "buct-lake-autumn" || value === "buct-lake-winter";
}

function normalizeCustomVisualPreset(value: unknown): SavedAppearancePreset | null {
  if (!value || typeof value !== "object") return null;
  const saved = value as Partial<SavedAppearancePreset>;
  const id = typeof saved.id === "string" ? saved.id.trim().slice(0, 80) : "";
  const label =
    typeof saved.label === "string" ? saved.label.trim().slice(0, 36) : "";
  if (!id || !label) return null;
  const image = saved.backgroundImage || defaults.backgroundImage;
  const texture = saved.backgroundTexture || defaults.backgroundTexture;
  const motion = saved.backgroundMotion || defaults.backgroundMotion;
  const gradientMap = saved.gradientMap || defaults.gradientMap;
  const backgroundPalette = normalizeBackgroundPalette(saved.backgroundPalette);
  const backgroundBuiltin = isBuiltInBackground(saved.backgroundBuiltin)
    ? saved.backgroundBuiltin
    : undefined;
  const hasSavedBackground =
    saved.background === "none" ||
    saved.background === "image" ||
    Boolean(backgroundBuiltin) ||
    typeof saved.backgroundUrl === "string";
  const background = hasSavedBackground
    ? saved.background === "none"
      ? "none"
      : "image"
    : undefined;
  const backgroundUrl = backgroundBuiltin
    ? BUILT_IN_BACKGROUNDS[backgroundBuiltin].url
    : typeof saved.backgroundUrl === "string" && !saved.backgroundUrl.startsWith("blob:")
      ? saved.backgroundUrl
      : undefined;
  const backgroundName = backgroundBuiltin
      ? BUILT_IN_BACKGROUNDS[backgroundBuiltin].name
      : typeof saved.backgroundName === "string"
        ? saved.backgroundName.slice(0, 120)
        : undefined;
  const scene: ScenePresetId = saved.scene === "parallax-3d" ? "parallax-3d" : "none";
  return {
    id,
    label,
    scene,
    basePreset: saved.basePreset === "midnight" ? "midnight" : "classic",
    background,
    backgroundBuiltin,
    ...(typeof background !== "undefined"
      ? { background, backgroundBuiltin, backgroundUrl, backgroundName }
      : {}),
    backgroundBlur: clamp(
      saved.backgroundBlur,
      0,
      64,
      defaults.backgroundBlur,
    ),
    backgroundTransparency: clamp(
      saved.backgroundTransparency,
      0,
      100,
      defaults.backgroundTransparency,
    ),
    backgroundImage: {
      opacity: clamp(image.opacity, 0, 100, defaults.backgroundImage.opacity),
      brightness: clamp(
        image.brightness,
        20,
        220,
        defaults.backgroundImage.brightness,
      ),
      contrast: clamp(
        image.contrast,
        20,
        240,
        defaults.backgroundImage.contrast,
      ),
      saturation: clamp(
        image.saturation,
        0,
        260,
        defaults.backgroundImage.saturation,
      ),
    },
    backgroundTexture: {
      enabled:
        typeof texture.enabled === "boolean"
          ? texture.enabled
          : defaults.backgroundTexture.enabled,
      opacity: clamp(
        texture.opacity,
        0,
        30,
        defaults.backgroundTexture.opacity,
      ),
      height: clamp(
        texture.height,
        100,
        500,
        defaults.backgroundTexture.height,
      ),
    },
    backgroundMotion: {
      enabled:
        typeof motion.enabled === "boolean"
          ? motion.enabled
          : defaults.backgroundMotion.enabled,
      intensity: clamp(
        motion.intensity,
        0,
        120,
        defaults.backgroundMotion.intensity,
      ),
      scale: clamp(motion.scale, 100, 180, defaults.backgroundMotion.scale),
    },
    gradientMap: {
      enabled:
        typeof gradientMap.enabled === "boolean"
          ? gradientMap.enabled
          : defaults.gradientMap.enabled,
      syncPalette:
        typeof gradientMap.syncPalette === "boolean"
          ? gradientMap.syncPalette
          : defaults.gradientMap.syncPalette,
      shadow: normalizeGradientColor(
        gradientMap.shadow,
        defaults.gradientMap.shadow,
      ),
      highlight: normalizeGradientColor(
        gradientMap.highlight,
        defaults.gradientMap.highlight,
      ),
      ...normalizeGradientStops(
        gradientMap.shadowPosition,
        gradientMap.highlightPosition,
      ),
    },
    ...(backgroundPalette ? { backgroundPalette } : {}),
    ...(backgroundPalette && typeof saved.backgroundPaletteSource === "string"
      ? { backgroundPaletteSource: saved.backgroundPaletteSource }
      : {}),
  };
}

export function normalizeCustomVisualPresets(value: unknown): SavedAppearancePreset[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.slice(0, 16).flatMap((item) => {
    const preset = normalizeCustomVisualPreset(item);
    if (!preset || ids.has(preset.id)) return [];
    ids.add(preset.id);
    return [preset];
  });
}

export function normalize(value: unknown): Personalization {
  if (!value || typeof value !== "object") return defaults;
  const saved = value as LegacyPersonalization;
  const background = saved.background || saved.chatBackground;
  const selectedBackgroundUrl = saved.backgroundUrl || saved.chatBackgroundUrl;
  const selectedBackgroundName = saved.backgroundName || saved.chatBackgroundName;
  const savedBuiltin = isBuiltInBackground(saved.backgroundBuiltin)
    ? saved.backgroundBuiltin
    : undefined;
  const shouldUseBuiltIn =
    background !== "none" &&
    (savedBuiltin ||
      (typeof background === "undefined" &&
        typeof selectedBackgroundUrl !== "string"));
  const backgroundBuiltin = shouldUseBuiltIn
    ? savedBuiltin || defaults.backgroundBuiltin
    : undefined;
  const backgroundUrl = backgroundBuiltin
    ? BUILT_IN_BACKGROUNDS[backgroundBuiltin].url
    : selectedBackgroundUrl;
  const backgroundName = backgroundBuiltin
    ? BUILT_IN_BACKGROUNDS[backgroundBuiltin].name
    : selectedBackgroundName;
  const motion = saved.backgroundMotion || defaults.backgroundMotion;
  const image = saved.backgroundImage || defaults.backgroundImage;
  const texture = saved.backgroundTexture || defaults.backgroundTexture;
  const backgroundBlur =
    typeof saved.backgroundBlur !== "undefined"
      ? saved.backgroundBlur
      : typeof saved.backgroundClarity !== "undefined"
        ? (100 - clamp(saved.backgroundClarity, 0, 100, 100)) * 0.24
        : defaults.backgroundBlur;
  const gradientMap = saved.gradientMap || defaults.gradientMap;
  const backgroundPalette = normalizeBackgroundPalette(saved.backgroundPalette);
  return {
    scene: saved.scene === "parallax-3d" ? "parallax-3d" : "none",
    // Older builds persisted visual-background IDs as theme IDs. Their image
    // treatment remains intact, while the base chrome now falls back to Classic.
    preset: saved.preset === "midnight" ? "midnight" : "classic",
    background:
      background !== "none" && typeof backgroundUrl === "string"
        ? "image"
        : "none",
    backgroundBuiltin,
    backgroundUrl:
      typeof backgroundUrl === "string" ? backgroundUrl : undefined,
    backgroundName:
      typeof backgroundName === "string" ? backgroundName : undefined,
    backgroundBlur: clamp(
      backgroundBlur,
      0,
      64,
      defaults.backgroundBlur,
    ),
    backgroundTransparency: clamp(
      saved.backgroundTransparency,
      0,
      100,
      defaults.backgroundTransparency,
    ),
    backgroundImage: {
      opacity: clamp(image.opacity, 0, 100, defaults.backgroundImage.opacity),
      brightness: clamp(
        image.brightness,
        20,
        220,
        defaults.backgroundImage.brightness,
      ),
      contrast: clamp(
        image.contrast,
        20,
        240,
        defaults.backgroundImage.contrast,
      ),
      saturation: clamp(
        image.saturation,
        0,
        260,
        defaults.backgroundImage.saturation,
      ),
    },
    backgroundTexture: {
      enabled:
        typeof texture.enabled === "boolean"
          ? texture.enabled
          : defaults.backgroundTexture.enabled,
      opacity: clamp(
        texture.opacity,
        0,
        30,
        defaults.backgroundTexture.opacity,
      ),
      height: clamp(
        texture.height,
        100,
        500,
        defaults.backgroundTexture.height,
      ),
    },
    backgroundMotion: {
      enabled:
        typeof motion.enabled === "boolean"
          ? motion.enabled
          : defaults.backgroundMotion.enabled,
      intensity: clamp(
        motion.intensity,
        0,
        120,
        defaults.backgroundMotion.intensity,
      ),
      scale: clamp(motion.scale, 100, 180, defaults.backgroundMotion.scale),
    },
    gradientMap: {
      enabled:
        typeof gradientMap.enabled === "boolean"
          ? gradientMap.enabled
          : defaults.gradientMap.enabled,
      syncPalette:
        typeof gradientMap.syncPalette === "boolean"
          ? gradientMap.syncPalette
          : defaults.gradientMap.syncPalette,
      shadow: normalizeGradientColor(
        gradientMap.shadow,
        defaults.gradientMap.shadow,
      ),
      highlight: normalizeGradientColor(
        gradientMap.highlight,
        defaults.gradientMap.highlight,
      ),
      ...normalizeGradientStops(
        gradientMap.shadowPosition,
        gradientMap.highlightPosition,
      ),
    },
    ...(backgroundPalette ? { backgroundPalette } : {}),
    ...(backgroundPalette && typeof saved.backgroundPaletteSource === "string"
      ? { backgroundPaletteSource: saved.backgroundPaletteSource }
      : {}),
    customVisualPresets: normalizeCustomVisualPresets(
      saved.customVisualPresets,
    ),
  };
}
