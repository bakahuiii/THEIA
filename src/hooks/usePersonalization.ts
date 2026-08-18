import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { bridge, isDesktop } from "../bridge";
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
  sampleBackgroundPalette,
  normalizeBackgroundPalette,
  type BackgroundPalette,
} from "../lib/background-palette";
import { solarSeason } from "../lib/solar-season";

const STORAGE_KEY = "theia-personalization-v1";
const ANIMATED_DEFAULTS_MIGRATION_KEY = "theia-personalization-defaults-v1";
const ANIMATED_DEFAULTS_MIGRATION_VALUE = "parallax-3d";
const PERSONALIZATION_EVENT = "theia:personalization-change";

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

type LegacyPersonalization = Partial<Personalization> & {
  backgroundClarity?: number;
  chatBackground?: AppBackground;
  chatBackgroundUrl?: string;
  chatBackgroundName?: string;
};

const BUILT_IN_BACKGROUNDS: Record<
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

const defaults: Personalization = {
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

const GRADIENT_PALETTE_VARIABLES = Object.keys(
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

function normalizeCustomVisualPresets(value: unknown): SavedAppearancePreset[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.slice(0, 16).flatMap((item) => {
    const preset = normalizeCustomVisualPreset(item);
    if (!preset || ids.has(preset.id)) return [];
    ids.add(preset.id);
    return [preset];
  });
}

function normalize(value: unknown): Personalization {
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

function readPreferences() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    let preferences = normalize(saved);
    const migrationComplete =
      localStorage.getItem(ANIMATED_DEFAULTS_MIGRATION_KEY) ===
      ANIMATED_DEFAULTS_MIGRATION_VALUE;
    if (
      !migrationComplete &&
      saved &&
      typeof saved === "object" &&
      (saved as LegacyPersonalization).scene !== "parallax-3d"
    ) {
      // v0.5 introduces the animated scene as the default. Existing visual
      // settings remain intact, but the old implicit "none" scene must not
      // silently disable the new default after an upgrade.
      preferences = normalize({
        ...saved,
        scene: "parallax-3d",
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    }
    if (!migrationComplete) {
      localStorage.setItem(
        ANIMATED_DEFAULTS_MIGRATION_KEY,
        ANIMATED_DEFAULTS_MIGRATION_VALUE,
      );
    }
    if (
      saved &&
      typeof saved === "object" &&
      (saved as LegacyPersonalization).preset !== preferences.preset
    ) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    }
    return preferences;
  } catch {
    return defaults;
  }
}

function applyPreferences(value: Personalization) {
  const root = document.documentElement;
  const transparency = value.backgroundTransparency;
  const imageOpacity = value.backgroundImage.opacity / 100;
  // Keep the label literal: 0% transparency is opaque and 100% removes the
  // surface tint. Users can now reach both endpoints instead of a hidden cap.
  const workspaceOpacity = Math.round(100 - transparency);
  // Keep the user's transparency setting authoritative across the whole glass
  // stack. Readability comes from contrast, blur, borders, and shadows—not by
  // silently replacing the chosen visual treatment with opaque cards.
  const sidebarOpacity = Math.max(0, workspaceOpacity - 8);
  const topbarOpacity = Math.max(0, workspaceOpacity - 12);
  const surfaceOpacity = workspaceOpacity;
  const surfaceStrongOpacity = workspaceOpacity;
  const controlOpacity = workspaceOpacity;
  const textureOpacity = value.backgroundTexture.enabled
    ? value.backgroundTexture.opacity / 100
    : 0;
  const useGradientMap = value.background === "image" && value.gradientMap.enabled;
  // A saved duotone preference must not keep owning the chrome after its
  // source image is removed. Palette ownership follows the actual mapping
  // layer, so Classic/Midnight remain meaningful on a clean workspace.
  const useGradientPalette = useGradientMap && value.gradientMap.syncPalette;
  const paletteSource =
    value.gradientMap.syncPalette &&
    value.backgroundPalette &&
    value.backgroundPaletteSource === value.backgroundUrl
      ? value.backgroundPalette
      : value.gradientMap;
  const gradientPalette = deriveGradientPalette(
    paletteSource,
    root.classList.contains("dark") ? "dark" : "light",
  );
  root.dataset.themePreset = value.preset;
  root.dataset.scenePreset = value.scene;
  root.dataset.appBackground = value.background;
  root.dataset.gradientMap = useGradientMap ? "enabled" : "disabled";
  root.dataset.gradientPalette = useGradientPalette
    ? gradientPalette.mode
    : "disabled";
  root.dataset.backgroundMotion = value.backgroundMotion.enabled
    ? "enabled"
    : "disabled";
  root.style.setProperty(
    "--theia-background-zoom",
    String(value.backgroundMotion.scale / 100),
  );
  root.style.setProperty(
    "--theia-background-image-blur",
    `${value.backgroundBlur.toFixed(1)}px`,
  );
  root.style.setProperty(
    "--theia-background-glass-blur",
    // Glass blur must follow the image blur instead of running in reverse.
    // At 0px the source image remains optically sharp behind every surface;
    // even the maximum image blur only adds a restrained 8px glass treatment.
    `${Math.min(8, value.backgroundBlur * 0.125).toFixed(1)}px`,
  );
  root.style.setProperty(
    "--theia-background-workspace-opacity",
    `${workspaceOpacity}%`,
  );
  root.style.setProperty(
    "--theia-background-sidebar-opacity",
    `${sidebarOpacity}%`,
  );
  root.style.setProperty(
    "--theia-background-topbar-opacity",
    `${topbarOpacity}%`,
  );
  root.style.setProperty(
    "--theia-background-surface-opacity",
    `${surfaceOpacity}%`,
  );
  root.style.setProperty(
    "--theia-background-surface-strong-opacity",
    `${surfaceStrongOpacity}%`,
  );
  root.style.setProperty(
    "--theia-background-control-opacity",
    `${controlOpacity}%`,
  );
  root.style.setProperty(
    "--theia-background-image-opacity",
    imageOpacity.toFixed(3),
  );
  root.style.setProperty(
    "--theia-background-image-opacity-dark",
    imageOpacity.toFixed(3),
  );
  root.style.setProperty(
    "--theia-background-image-brightness",
    `${value.backgroundImage.brightness}%`,
  );
  root.style.setProperty(
    "--theia-background-image-contrast",
    `${value.backgroundImage.contrast}%`,
  );
  root.style.setProperty(
    "--theia-background-image-saturation",
    `${value.backgroundImage.saturation}%`,
  );
  root.style.setProperty(
    "--theia-classical-texture-opacity",
    textureOpacity.toFixed(3),
  );
  root.style.setProperty(
    "--theia-classical-texture-height",
    `${value.backgroundTexture.height}dvh`,
  );
  root.style.setProperty("--theia-gradient-shadow", value.gradientMap.shadow);
  root.style.setProperty("--theia-gradient-highlight", value.gradientMap.highlight);
  if (useGradientPalette) {
    Object.entries(gradientPalette.variables).forEach(([name, color]) => {
      root.style.setProperty(name, color);
    });
    root.style.setProperty("color", gradientPalette.variables["--foreground"]);
    root.style.setProperty(
      "background-color",
      gradientPalette.variables["--background"],
    );
  } else {
    GRADIENT_PALETTE_VARIABLES.forEach((name) => root.style.removeProperty(name));
    root.style.removeProperty("color");
    root.style.removeProperty("background-color");
  }
  if (value.background === "image" && value.backgroundUrl) {
    const imageReference = "url(" + JSON.stringify(value.backgroundUrl) + ")";
    root.style.setProperty(
      "--theia-app-background-image",
      imageReference,
    );
    // The texture is intentionally derived from the selected background, not a
    // separate bundled illustration. CSS supplies the subtle etched treatment.
    root.style.setProperty(
      "--theia-app-background-texture-image",
      imageReference,
    );
  } else {
    root.style.removeProperty("--theia-app-background-image");
    root.style.removeProperty("--theia-app-background-texture-image");
  }
}

function persist(value: Personalization) {
  try {
    const persistentValue = value.backgroundUrl?.startsWith("blob:")
      ? {
          ...value,
          background: "none" as const,
          backgroundUrl: undefined,
          backgroundName: undefined,
        }
      : value;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistentValue));
  } catch {
    // Personalization remains usable when persistent storage is unavailable.
  }
}

function persistCustomVisualPresets(presets: SavedAppearancePreset[]) {
  if (!isDesktop || !bridge.saveAppearancePresets) return;
  void bridge.saveAppearancePresets(presets).catch(() => {
    // localStorage remains the safe fallback if the desktop write is unavailable.
  });
}

function resetBackgroundOffset() {
  const root = document.documentElement;
  root.style.setProperty("--theia-background-offset-x", "0px");
  root.style.setProperty("--theia-background-offset-y", "0px");
}

export type PersonalizationApi = {
  preferences: Personalization;
  setPreset: (preset: ThemePreset) => void;
  setScenePreset: (scene: ScenePresetId) => void;
  setAppBackground: (
    background: AppBackground,
    selection?: { url?: string; name?: string },
  ) => void;
  setBackgroundBlur: (backgroundBlur: number) => void;
  setBackgroundTransparency: (backgroundTransparency: number) => void;
  setBackgroundImage: (partial: Partial<BackgroundImageTreatment>) => void;
  setBackgroundTexture: (partial: Partial<BackgroundTexture>) => void;
  setBackgroundMotion: (partial: Partial<BackgroundMotion>) => void;
  setGradientMap: (partial: Partial<GradientMap>) => void;
  applyVisualSettings: (settings: AppearanceVisualPreset) => void;
  applySeasonalVisualSettings: (
    initial: AppearanceVisualPreset,
    seasonal: Record<"spring" | "summer" | "autumn" | "winter", AppearanceVisualPreset>,
  ) => void;
  saveCustomVisualPreset: (label: string) => SavedAppearancePreset | null;
  deleteCustomVisualPreset: (id: string) => void;
};

const PersonalizationContext = createContext<PersonalizationApi | null>(null);

function usePersonalizationState(): PersonalizationApi {
  const [preferences, setPreferences] = useState<Personalization>(readPreferences);
  const [initialCustomVisualPresets] = useState(
    () => preferences.customVisualPresets,
  );
  const [appearanceRevision, setAppearanceRevision] = useState(0);
  const paletteRequest = useRef(0);
  const seasonalRequest = useRef(0);
  const pendingSeasonal = useRef<{
    request: number;
    variants: Record<"spring" | "summer" | "autumn" | "winter", AppearanceVisualPreset>;
  } | null>(null);
  const [initializationComplete, setInitializationComplete] = useState(false);
  const update = useCallback((partial: Partial<Personalization>) => {
    setPreferences((current) => {
      const next = normalize({ ...current, ...partial });
      persist(next);
      return next;
    });
  }, []);

  useEffect(() => {
    applyPreferences(preferences);
  }, [appearanceRevision, preferences]);

  useEffect(() => {
    if (
      preferences.background !== "image" ||
      !preferences.backgroundUrl ||
      preferences.backgroundPaletteSource === preferences.backgroundUrl
    ) {
      return;
    }
    const request = ++paletteRequest.current;
    void sampleBackgroundPalette(preferences.backgroundUrl)
      .then((backgroundPalette) => {
        if (request !== paletteRequest.current) return;
        setPreferences((current) => {
          if (current.backgroundUrl !== preferences.backgroundUrl) return current;
          const next = normalize({
            ...current,
            backgroundPalette,
            backgroundPaletteSource: preferences.backgroundUrl,
          });
          persist(next);
          return next;
        });
      })
      .catch(() => undefined);
  }, [preferences.background, preferences.backgroundPaletteSource, preferences.backgroundUrl]);

  const applySeasonalVariant = useCallback((pending: NonNullable<typeof pendingSeasonal.current>) => {
    const season = solarSeason();
    const settings = pending.variants[season];
    const builtinBackground = settings.backgroundBuiltin;
    update({
      scene: "none",
      ...(settings.basePreset ? { preset: settings.basePreset } : {}),
      ...(builtinBackground
        ? {
            background: "image" as const,
            backgroundBuiltin: builtinBackground,
            backgroundUrl: BUILT_IN_BACKGROUNDS[builtinBackground].url,
            backgroundName: BUILT_IN_BACKGROUNDS[builtinBackground].name,
          }
        : {}),
      backgroundBlur: settings.backgroundBlur,
      backgroundTransparency: settings.backgroundTransparency,
      backgroundImage: { ...settings.backgroundImage },
      backgroundTexture: { ...settings.backgroundTexture },
      backgroundMotion: { ...settings.backgroundMotion },
      gradientMap: { ...settings.gradientMap },
      backgroundPalette: undefined,
      backgroundPaletteSource: undefined,
    });
  }, [update]);

  useEffect(() => {
    const onInitializationComplete = () => {
      setInitializationComplete(true);
      const pending = pendingSeasonal.current;
      if (!pending) return;
      window.requestAnimationFrame(() => {
        if (pendingSeasonal.current?.request !== pending.request) return;
        pendingSeasonal.current = null;
        applySeasonalVariant(pending);
      });
    };
    window.addEventListener("theia:initialization-complete", onInitializationComplete);
    return () => window.removeEventListener("theia:initialization-complete", onInitializationComplete);
  }, [applySeasonalVariant]);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setAppearanceRevision((revision) => revision + 1);
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onChange = (event: Event) => {
      setPreferences(normalize((event as CustomEvent<unknown>).detail));
    };
    window.addEventListener(PERSONALIZATION_EVENT, onChange);
    return () => window.removeEventListener(PERSONALIZATION_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (!isDesktop || !bridge.getAppearancePresets) return;
    let disposed = false;
    void bridge.getAppearancePresets()
      .then((file) => {
        if (disposed) return;
        const presets = normalizeCustomVisualPresets(file.presets);
        if (!file.exists) {
          persistCustomVisualPresets(initialCustomVisualPresets);
          return;
        }
        setPreferences((current) => {
          const next = normalize({ ...current, customVisualPresets: presets });
          persist(next);
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [initialCustomVisualPresets]);

  useEffect(() => {
    const motion = preferences.backgroundMotion;
    if (preferences.background !== "image" || !motion.enabled) {
      resetBackgroundOffset();
      return;
    }
    let frame: number | null = null;
    let currentX = 0;
    let currentY = 0;
    let targetX = 0;
    let targetY = 0;
    const applyOffset = () => {
      currentX += (targetX - currentX) * 0.12;
      currentY += (targetY - currentY) * 0.12;
      const root = document.documentElement;
      root.style.setProperty("--theia-background-offset-x", `${currentX.toFixed(2)}px`);
      root.style.setProperty("--theia-background-offset-y", `${currentY.toFixed(2)}px`);
      if (Math.hypot(targetX - currentX, targetY - currentY) > 0.05) {
        frame = window.requestAnimationFrame(applyOffset);
      } else {
        frame = null;
      }
    };
    const schedule = () => {
      if (frame === null) frame = window.requestAnimationFrame(applyOffset);
    };
    const onPointerMove = (event: PointerEvent) => {
      const horizontal = event.clientX / Math.max(1, window.innerWidth) - 0.5;
      const vertical = event.clientY / Math.max(1, window.innerHeight) - 0.5;
      targetX = -horizontal * motion.intensity * 2;
      targetY = -vertical * motion.intensity * 2;
      schedule();
    };
    const onPointerLeave = () => {
      targetX = 0;
      targetY = 0;
      schedule();
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("blur", onPointerLeave);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("blur", onPointerLeave);
      if (frame !== null) window.cancelAnimationFrame(frame);
      resetBackgroundOffset();
    };
  }, [preferences.background, preferences.backgroundMotion]);

  const setPreset = useCallback(
    (preset: ThemePreset) => update({ preset }),
    [update],
  );
  const setAppBackground = useCallback(
    (
      background: AppBackground,
      selection?: { url?: string; name?: string },
    ) => {
      seasonalRequest.current += 1;
      pendingSeasonal.current = null;
      return update({
        scene: "none",
        background,
        backgroundBuiltin: undefined,
        backgroundUrl: background === "image" ? selection?.url : undefined,
        backgroundName: background === "image" ? selection?.name : undefined,
        backgroundPalette: undefined,
        backgroundPaletteSource: undefined,
      });
    },
    [update],
  );
  const setScenePreset = useCallback(
    (scene: ScenePresetId) => update({ scene }),
    [update],
  );
  const setBackgroundMotion = useCallback(
    (partial: Partial<BackgroundMotion>) =>
      update({
        backgroundMotion: { ...preferences.backgroundMotion, ...partial },
      }),
    [preferences.backgroundMotion, update],
  );
  const setBackgroundBlur = useCallback(
    (backgroundBlur: number) => update({ backgroundBlur }),
    [update],
  );
  const setBackgroundTransparency = useCallback(
    (backgroundTransparency: number) => update({ backgroundTransparency }),
    [update],
  );
  const setBackgroundImage = useCallback(
    (partial: Partial<BackgroundImageTreatment>) =>
      update({
        backgroundImage: { ...preferences.backgroundImage, ...partial },
      }),
    [preferences.backgroundImage, update],
  );
  const setBackgroundTexture = useCallback(
    (partial: Partial<BackgroundTexture>) =>
      update({
        backgroundTexture: { ...preferences.backgroundTexture, ...partial },
      }),
    [preferences.backgroundTexture, update],
  );
  const setGradientMap = useCallback(
    (partial: Partial<GradientMap>) =>
      update({
        gradientMap: { ...preferences.gradientMap, ...partial },
      }),
    [preferences.gradientMap, update],
  );
  const applyVisualSettings = useCallback(
    (settings: AppearanceVisualPreset) => {
      seasonalRequest.current += 1;
      pendingSeasonal.current = null;
      const builtinBackground = settings.backgroundBuiltin;
      const hasSavedBackground = typeof settings.background !== "undefined";
      return update({
        scene: settings.scene ?? "none",
        ...(settings.basePreset ? { preset: settings.basePreset } : {}),
        ...(builtinBackground
          ? {
              background: "image" as const,
              backgroundBuiltin: builtinBackground,
              backgroundUrl: BUILT_IN_BACKGROUNDS[builtinBackground].url,
              backgroundName: BUILT_IN_BACKGROUNDS[builtinBackground].name,
              backgroundPalette: settings.backgroundPalette,
              backgroundPaletteSource: settings.backgroundPaletteSource,
            }
          : hasSavedBackground
            ? {
                background: settings.background,
                backgroundBuiltin: undefined,
                backgroundUrl:
                  settings.background === "image" ? settings.backgroundUrl : undefined,
                backgroundName:
                  settings.background === "image" ? settings.backgroundName : undefined,
              }
            : {}),
        backgroundBlur: settings.backgroundBlur,
        backgroundTransparency: settings.backgroundTransparency,
        backgroundImage: { ...settings.backgroundImage },
        backgroundTexture: { ...settings.backgroundTexture },
        backgroundMotion: { ...settings.backgroundMotion },
        gradientMap: { ...settings.gradientMap },
        backgroundPalette: settings.backgroundPalette,
        backgroundPaletteSource: settings.backgroundPaletteSource,
      });
    },
    [update],
  );
  const applySeasonalVisualSettings = useCallback(
    (
      initial: AppearanceVisualPreset,
      seasonal: Record<"spring" | "summer" | "autumn" | "winter", AppearanceVisualPreset>,
    ) => {
      const request = ++seasonalRequest.current;
      const apply = (settings: AppearanceVisualPreset) => {
        const builtinBackground = settings.backgroundBuiltin;
        return {
          scene: "none" as const,
          ...(settings.basePreset ? { preset: settings.basePreset } : {}),
          ...(builtinBackground
            ? {
                background: "image" as const,
                backgroundBuiltin: builtinBackground,
                backgroundUrl: BUILT_IN_BACKGROUNDS[builtinBackground].url,
                backgroundName: BUILT_IN_BACKGROUNDS[builtinBackground].name,
              }
            : {}),
          backgroundBlur: settings.backgroundBlur,
          backgroundTransparency: settings.backgroundTransparency,
          backgroundImage: { ...settings.backgroundImage },
          backgroundTexture: { ...settings.backgroundTexture },
          backgroundMotion: { ...settings.backgroundMotion },
          gradientMap: { ...settings.gradientMap },
          backgroundPalette: undefined,
          backgroundPaletteSource: undefined,
        };
      };
      update(apply(initial));
      const pending = { request, variants: seasonal };
      pendingSeasonal.current = pending;
      if (initializationComplete) {
        window.requestAnimationFrame(() => {
          if (pendingSeasonal.current?.request !== request) return;
          pendingSeasonal.current = null;
          applySeasonalVariant(pending);
        });
      }
    },
    [applySeasonalVariant, initializationComplete, update],
  );
  const saveCustomVisualPreset = useCallback(
    (label: string) => {
      const normalizedLabel = label.trim().slice(0, 36);
      if (!normalizedLabel || preferences.customVisualPresets.length >= 16) {
        return null;
      }
      const preset: SavedAppearancePreset = {
        id: `custom-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
        label: normalizedLabel,
        scene: preferences.scene,
        basePreset: preferences.preset,
        background: preferences.background,
        backgroundBuiltin: preferences.backgroundBuiltin,
        backgroundUrl: preferences.backgroundUrl,
        backgroundName: preferences.backgroundName,
        backgroundBlur: preferences.backgroundBlur,
        backgroundTransparency: preferences.backgroundTransparency,
        backgroundImage: { ...preferences.backgroundImage },
        backgroundTexture: { ...preferences.backgroundTexture },
        backgroundMotion: { ...preferences.backgroundMotion },
        gradientMap: { ...preferences.gradientMap },
        backgroundPalette: preferences.backgroundPalette,
        backgroundPaletteSource: preferences.backgroundPaletteSource,
      };
      const customVisualPresets = [...preferences.customVisualPresets, preset];
      update({ customVisualPresets });
      persistCustomVisualPresets(customVisualPresets);
      return preset;
    },
    [preferences, update],
  );
  const deleteCustomVisualPreset = useCallback(
    (id: string) => {
      const customVisualPresets = preferences.customVisualPresets.filter(
        (preset) => preset.id !== id,
      );
      update({ customVisualPresets });
      persistCustomVisualPresets(customVisualPresets);
    },
    [preferences.customVisualPresets, update],
  );

  return {
    preferences,
    setPreset,
    setScenePreset,
    setAppBackground,
    setBackgroundBlur,
    setBackgroundTransparency,
    setBackgroundImage,
    setBackgroundTexture,
    setBackgroundMotion,
    setGradientMap,
    applyVisualSettings,
    applySeasonalVisualSettings,
    saveCustomVisualPreset,
    deleteCustomVisualPreset,
  };
}

export function PersonalizationProvider({ children }: { children: ReactNode }) {
  const value = usePersonalizationState();
  return createElement(PersonalizationContext.Provider, { value }, children);
}

export function usePersonalization() {
  const context = useContext(PersonalizationContext);
  if (!context) {
    throw new Error(
      "usePersonalization must be used inside PersonalizationProvider",
    );
  }
  return context;
}
