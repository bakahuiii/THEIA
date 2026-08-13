export type GradientMapColors = {
  shadow: string;
  highlight: string;
};

export type GradientMapStops = {
  shadowPosition: number;
  highlightPosition: number;
};

export type GradientPalette = {
  mode: "light" | "dark";
  variables: Record<string, string>;
};

type Rgb = {
  red: number;
  green: number;
  blue: number;
};

type Hsl = {
  hue: number;
  saturation: number;
  lightness: number;
};

const BLACK: Rgb = { red: 10, green: 15, blue: 22 };
const WHITE: Rgb = { red: 248, green: 251, blue: 255 };
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const DEFAULT_HUE = 211;
const NEUTRAL_HUE = 218;

export const DEFAULT_GRADIENT_MAP_COLORS: GradientMapColors = {
  shadow: "#2869a8",
  highlight: "#f2f8ff",
};

export const DEFAULT_GRADIENT_MAP_STOPS: GradientMapStops = {
  shadowPosition: 0,
  highlightPosition: 100,
};

export function normalizeGradientColor(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return HEX_COLOR.test(normalized) ? normalized.toLowerCase() : fallback;
}

export function normalizeGradientStops(
  shadowPosition: unknown,
  highlightPosition: unknown,
): GradientMapStops {
  const shadow = clampNumber(
    shadowPosition,
    0,
    96,
    DEFAULT_GRADIENT_MAP_STOPS.shadowPosition,
  );
  const highlight = Math.max(
    shadow + 4,
    clampNumber(
      highlightPosition,
      4,
      100,
      DEFAULT_GRADIENT_MAP_STOPS.highlightPosition,
    ),
  );
  return {
    shadowPosition: shadow,
    highlightPosition: Math.min(100, highlight),
  };
}

export function gradientMapTableValues(
  map: GradientMapColors & Partial<GradientMapStops>,
  steps = 33,
) {
  const shadow = parseHex(map.shadow);
  const highlight = parseHex(map.highlight);
  const positions = normalizeGradientStops(
    map.shadowPosition,
    map.highlightPosition,
  );
  const count = Math.max(3, Math.round(steps));
  const shadowStop = positions.shadowPosition / 100;
  const highlightStop = positions.highlightPosition / 100;
  const values = Array.from({ length: count }, (_, index) => {
    const source = index / (count - 1);
    const amount = clamp(
      (source - shadowStop) / Math.max(0.01, highlightStop - shadowStop),
      0,
      1,
    );
    return mix(shadow, highlight, amount);
  });
  const channelValues = (channel: keyof Rgb) =>
    values.map((value) => (value[channel] / 255).toFixed(4)).join(" ");

  return {
    red: channelValues("red"),
    green: channelValues("green"),
    blue: channelValues("blue"),
  };
}

export function deriveGradientPalette(
  colors: GradientMapColors,
  mode: "light" | "dark" = inferMode(colors),
): GradientPalette {
  const shadow = parseHex(colors.shadow);
  const highlight = parseHex(colors.highlight);
  const mood = deriveMood(shadow, highlight);

  return mode === "light"
    ? deriveLightPalette(mood)
    : deriveDarkPalette(mood);
}

function inferMode(colors: GradientMapColors) {
  const shadow = relativeLuminance(parseHex(colors.shadow));
  const highlight = relativeLuminance(parseHex(colors.highlight));
  return shadow < 0.18 && highlight < 0.78 ? "dark" : "light";
}

function deriveMood(shadow: Rgb, highlight: Rgb) {
  const samples = [rgbToHsl(shadow), rgbToHsl(highlight)];
  // Endpoint colors describe the illustration, not the chrome. Ignore almost
  // neutral endpoints when finding an accent hue, then keep that hue out of
  // cards and workspace surfaces below.
  const weights = samples.map((sample) => Math.max(0, sample.saturation - 0.04));
  const totalWeight = weights[0] + weights[1];
  const horizontal = samples.reduce(
    (total, sample, index) =>
      total + Math.cos((sample.hue * Math.PI) / 180) * weights[index],
    0,
  );
  const vertical = samples.reduce(
    (total, sample, index) =>
      total + Math.sin((sample.hue * Math.PI) / 180) * weights[index],
    0,
  );
  const hue =
    totalWeight < 0.001 || Math.abs(horizontal) + Math.abs(vertical) < 0.001
      ? DEFAULT_HUE
      : (Math.atan2(vertical, horizontal) * 180) / Math.PI + 360;
  const averageSaturation = samples.reduce(
    (total, sample, index) => total + sample.saturation * weights[index],
    0,
  ) / Math.max(0.001, totalWeight);
  const tonalRange = Math.abs(
    relativeLuminance(shadow) - relativeLuminance(highlight),
  );

  return {
    hue: hue % 360,
    accentSaturation: clamp(
      0.26 + averageSaturation * 0.22 + tonalRange * 0.08,
      0.32,
      0.48,
    ),
  };
}

function deriveLightPalette(mood: {
  hue: number;
  accentSaturation: number;
}): GradientPalette {
  // App surfaces stay nearly achromatic. A gold and black map therefore gives
  // a graphite workspace with gold accents, not a page full of yellow cards.
  const background = hslToRgb(NEUTRAL_HUE, 0.018, 0.965);
  const card = hslToRgb(NEUTRAL_HUE, 0.008, 0.995);
  const popover = hslToRgb(NEUTRAL_HUE, 0.012, 0.998);
  const foreground = ensureContrast(
    hslToRgb(NEUTRAL_HUE, 0.07, 0.16),
    card,
    7,
    BLACK,
  );
  const primary = ensureContrast(
    hslToRgb(mood.hue, mood.accentSaturation, 0.35),
    background,
    4.5,
    BLACK,
  );
  const secondary = hslToRgb(NEUTRAL_HUE, 0.02, 0.93);
  const mutedForeground = ensureContrast(
    hslToRgb(NEUTRAL_HUE, 0.055, 0.43),
    card,
    4.5,
    BLACK,
  );
  const border = hslToRgb(NEUTRAL_HUE, 0.035, 0.82);
  const sidebar = hslToRgb(NEUTRAL_HUE, 0.07, 0.15);
  const sidebarForeground = ensureContrast(
    hslToRgb(NEUTRAL_HUE, 0.035, 0.92),
    sidebar,
    7,
    WHITE,
  );
  const sidebarPrimary = ensureContrast(
    hslToRgb(mood.hue, Math.min(0.54, mood.accentSaturation + 0.05), 0.73),
    sidebar,
    4.5,
    WHITE,
  );

  return {
    mode: "light",
    variables: buildVariables({
      background,
      card,
      popover,
      foreground,
      primary,
      secondary,
      mutedForeground,
      border,
      sidebar,
      sidebarForeground,
      sidebarPrimary,
      destructive: { red: 184, green: 57, blue: 75 },
      success: { red: 24, green: 119, blue: 96 },
      warning: { red: 157, green: 102, blue: 28 },
      info: { red: 37, green: 100, blue: 143 },
      dark: false,
    }),
  };
}

function deriveDarkPalette(mood: {
  hue: number;
  accentSaturation: number;
}): GradientPalette {
  const background = hslToRgb(NEUTRAL_HUE, 0.025, 0.085);
  const card = hslToRgb(NEUTRAL_HUE, 0.02, 0.135);
  const popover = hslToRgb(NEUTRAL_HUE, 0.025, 0.18);
  const foreground = ensureContrast(
    hslToRgb(NEUTRAL_HUE, 0.025, 0.94),
    card,
    7,
    WHITE,
  );
  const primary = ensureContrast(
    hslToRgb(mood.hue, mood.accentSaturation, 0.7),
    background,
    4.5,
    WHITE,
  );
  const secondary = hslToRgb(NEUTRAL_HUE, 0.025, 0.2);
  const mutedForeground = ensureContrast(
    hslToRgb(NEUTRAL_HUE, 0.035, 0.64),
    card,
    4.5,
    WHITE,
  );
  const border = hslToRgb(NEUTRAL_HUE, 0.035, 0.28);
  const sidebar = hslToRgb(NEUTRAL_HUE, 0.03, 0.055);
  const sidebarForeground = ensureContrast(
    hslToRgb(NEUTRAL_HUE, 0.025, 0.93),
    sidebar,
    7,
    WHITE,
  );
  const sidebarPrimary = ensureContrast(
    hslToRgb(mood.hue, Math.min(0.54, mood.accentSaturation + 0.05), 0.73),
    sidebar,
    4.5,
    WHITE,
  );

  return {
    mode: "dark",
    variables: buildVariables({
      background,
      card,
      popover,
      foreground,
      primary,
      secondary,
      mutedForeground,
      border,
      sidebar,
      sidebarForeground,
      sidebarPrimary,
      destructive: { red: 235, green: 110, blue: 128 },
      success: { red: 101, green: 205, blue: 171 },
      warning: { red: 227, green: 175, blue: 91 },
      info: { red: 117, green: 185, blue: 236 },
      dark: true,
    }),
  };
}

function buildVariables(input: {
  background: Rgb;
  card: Rgb;
  popover: Rgb;
  foreground: Rgb;
  primary: Rgb;
  secondary: Rgb;
  mutedForeground: Rgb;
  border: Rgb;
  sidebar: Rgb;
  sidebarForeground: Rgb;
  sidebarPrimary: Rgb;
  destructive: Rgb;
  success: Rgb;
  warning: Rgb;
  info: Rgb;
  dark: boolean;
}) {
  const accent = mix(input.background, input.primary, input.dark ? 0.14 : 0.08);
  const accentForeground = ensureContrast(
    input.primary,
    accent,
    4.5,
    input.dark ? WHITE : BLACK,
  );
  const inputBorder = mix(input.border, input.primary, 0.08);
  const primaryForeground = bestTextColor(input.primary);
  const secondaryForeground = ensureContrast(
    mix(input.foreground, input.secondary, 0.15),
    input.secondary,
    4.5,
    input.dark ? WHITE : BLACK,
  );
  const destructiveForeground = bestTextColor(input.destructive);
  const successSoft = mix(input.background, input.success, input.dark ? 0.21 : 0.11);
  const warningSoft = mix(input.background, input.warning, input.dark ? 0.2 : 0.12);
  const infoSoft = mix(input.background, input.info, input.dark ? 0.2 : 0.11);

  return {
    "--background": toHex(input.background),
    "--foreground": toHex(input.foreground),
    "--card": toHex(input.card),
    "--card-foreground": toHex(input.foreground),
    "--popover": toHex(input.popover),
    "--popover-foreground": toHex(input.foreground),
    "--primary": toHex(input.primary),
    "--primary-foreground": toHex(primaryForeground),
    "--secondary": toHex(input.secondary),
    "--secondary-foreground": toHex(secondaryForeground),
    "--muted": toHex(input.secondary),
    "--muted-foreground": toHex(input.mutedForeground),
    "--accent": toHex(accent),
    "--accent-foreground": toHex(accentForeground),
    "--destructive": toHex(input.destructive),
    "--destructive-foreground": toHex(destructiveForeground),
    "--border": toHex(input.border),
    "--input": toHex(inputBorder),
    "--ring": toHex(input.primary),
    "--success": toHex(input.success),
    "--success-soft": toHex(successSoft),
    "--warning": toHex(input.warning),
    "--warning-soft": toHex(warningSoft),
    "--info": toHex(input.info),
    "--info-soft": toHex(infoSoft),
    "--sidebar": toHex(input.sidebar),
    "--sidebar-foreground": toHex(input.sidebarForeground),
    "--sidebar-primary": toHex(input.sidebarPrimary),
    "--sidebar-primary-foreground": toHex(bestTextColor(input.sidebarPrimary)),
    "--sidebar-accent": toHex(mix(input.sidebar, input.sidebarPrimary, 0.1)),
    "--sidebar-accent-foreground": toHex(input.sidebarForeground),
    "--sidebar-border": toCssRgba(mix(input.sidebar, input.sidebarForeground, 0.14), 0.28),
    "--sidebar-ring": toHex(input.sidebarPrimary),
    "--red-dark": toHex(mix(input.destructive, BLACK, input.dark ? 0.2 : 0.12)),
    "--amber": toHex(input.warning),
  };
}

function parseHex(color: string): Rgb {
  const normalized = normalizeGradientColor(color, "#000000");
  return {
    red: Number.parseInt(normalized.slice(1, 3), 16),
    green: Number.parseInt(normalized.slice(3, 5), 16),
    blue: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function rgbToHsl(color: Rgb): Hsl {
  const red = color.red / 255;
  const green = color.green / 255;
  const blue = color.blue / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;

  if (delta === 0) return { hue: DEFAULT_HUE, saturation: 0, lightness };

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (maximum === red) hue = ((green - blue) / delta) % 6;
  else if (maximum === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;

  return {
    hue: (hue * 60 + 360) % 360,
    saturation,
    lightness,
  };
}

function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const segment = hue / 60;
  const match = chroma * (1 - Math.abs((segment % 2) - 1));
  const [red, green, blue] =
    segment < 1 ? [chroma, match, 0]
    : segment < 2 ? [match, chroma, 0]
    : segment < 3 ? [0, chroma, match]
    : segment < 4 ? [0, match, chroma]
    : segment < 5 ? [match, 0, chroma]
    : [chroma, 0, match];
  const offset = lightness - chroma / 2;
  return {
    red: Math.round((red + offset) * 255),
    green: Math.round((green + offset) * 255),
    blue: Math.round((blue + offset) * 255),
  };
}

function mix(first: Rgb, second: Rgb, amount: number): Rgb {
  const ratio = clamp(amount, 0, 1);
  return {
    red: Math.round(first.red + (second.red - first.red) * ratio),
    green: Math.round(first.green + (second.green - first.green) * ratio),
    blue: Math.round(first.blue + (second.blue - first.blue) * ratio),
  };
}

function toHex(color: Rgb) {
  return "#" + [color.red, color.green, color.blue]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("");
}

function toCssRgba(color: Rgb, alpha: number) {
  return `rgb(${color.red} ${color.green} ${color.blue} / ${alpha})`;
}

function relativeLuminance(color: Rgb) {
  const linear = [color.red, color.green, color.blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrastRatio(first: Rgb, second: Rgb) {
  const light = Math.max(relativeLuminance(first), relativeLuminance(second));
  const dark = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (light + 0.05) / (dark + 0.05);
}

function bestTextColor(background: Rgb) {
  return contrastRatio(BLACK, background) >= contrastRatio(WHITE, background)
    ? BLACK
    : WHITE;
}

function ensureContrast(
  color: Rgb,
  background: Rgb,
  target: number,
  toward: Rgb,
) {
  let candidate = color;
  for (let index = 0; index < 12; index += 1) {
    if (contrastRatio(candidate, background) >= target) return candidate;
    candidate = mix(candidate, toward, 0.2);
  }
  return bestTextColor(background);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function clampNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, minimum, maximum) : fallback;
}
