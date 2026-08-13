export type BackgroundPalette = {
  shadow: string;
  highlight: string;
};

type Rgb = { red: number; green: number; blue: number };

type Hsl = { hue: number; saturation: number; lightness: number };

type ColorBucket = {
  weight: number;
  red: number;
  green: number;
  blue: number;
  hue: number;
  saturation: number;
  lightness: number;
};

const HUE_BUCKETS = 24;
const LIGHTNESS_BUCKETS = 4;
const SATURATION_BUCKETS = 3;
const DEFAULT_BACKGROUND_PALETTE: BackgroundPalette = {
  shadow: "#2869a8",
  highlight: "#f2f8ff",
};

/**
 * Finds two usable chromatic anchors from a small RGBA image. The image is
 * intentionally sampled after downscaling; a background palette should follow
 * the photograph's large colour fields, not a single sharp highlight.
 */
export function extractBackgroundPalette(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): BackgroundPalette {
  if (!width || !height || pixels.length < 4) {
    return DEFAULT_BACKGROUND_PALETTE;
  }

  const buckets = new Map<number, ColorBucket>();
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / 4_800)));

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const offset = (y * width + x) * 4;
      if (pixels[offset + 3] < 192) continue;
      const color = {
        red: pixels[offset],
        green: pixels[offset + 1],
        blue: pixels[offset + 2],
      };
      const hsl = rgbToHsl(color);
      // Neutral cloud, concrete and clipped highlights should not decide the
      // app identity. They remain represented by the neutral surface palette.
      if (hsl.saturation < 0.1 || hsl.lightness < 0.08 || hsl.lightness > 0.92) {
        continue;
      }
      const hueBucket = Math.floor(hsl.hue / (360 / HUE_BUCKETS));
      const saturationBucket = Math.min(
        SATURATION_BUCKETS - 1,
        Math.floor(hsl.saturation * SATURATION_BUCKETS),
      );
      const lightnessBucket = Math.min(
        LIGHTNESS_BUCKETS - 1,
        Math.floor(hsl.lightness * LIGHTNESS_BUCKETS),
      );
      const key =
        hueBucket * SATURATION_BUCKETS * LIGHTNESS_BUCKETS +
        saturationBucket * LIGHTNESS_BUCKETS +
        lightnessBucket;
      const middleTone = 1 - Math.abs(hsl.lightness - 0.5) * 0.55;
      const weight = (0.25 + hsl.saturation * 0.75) * middleTone;
      const bucket = buckets.get(key) ?? {
        weight: 0,
        red: 0,
        green: 0,
        blue: 0,
        hue: 0,
        saturation: 0,
        lightness: 0,
      };
      bucket.weight += weight;
      bucket.red += color.red * weight;
      bucket.green += color.green * weight;
      bucket.blue += color.blue * weight;
      bucket.hue += hsl.hue * weight;
      bucket.saturation += hsl.saturation * weight;
      bucket.lightness += hsl.lightness * weight;
      buckets.set(key, bucket);
    }
  }

  const ranked = [...buckets.values()].sort((left, right) => right.weight - left.weight);
  const primary = ranked[0];
  if (!primary) return DEFAULT_BACKGROUND_PALETTE;

  const primaryColor = averageBucket(primary);
  const primaryHsl = rgbToHsl(primaryColor);
  const support = ranked.find((candidate) => {
    const average = averageBucket(candidate);
    const hsl = rgbToHsl(average);
    return circularHueDistance(hsl.hue, primaryHsl.hue) >= 24 ||
      Math.abs(hsl.lightness - primaryHsl.lightness) >= 0.18;
  });
  const supportColor = support ? averageBucket(support) : primaryColor;

  return {
    shadow: toHex(primaryColor),
    highlight: toHex(supportColor),
  };
}

export async function sampleBackgroundPalette(
  url: string,
): Promise<BackgroundPalette> {
  const image = new Image();
  image.decoding = "async";
  image.crossOrigin = "anonymous";
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  const longestSide = 112;
  const scale = Math.min(
    1,
    longestSide / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height),
  );
  canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
  canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return DEFAULT_BACKGROUND_PALETTE;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return extractBackgroundPalette(
    context.getImageData(0, 0, canvas.width, canvas.height).data,
    canvas.width,
    canvas.height,
  );
}

export function normalizeBackgroundPalette(value: unknown): BackgroundPalette | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<BackgroundPalette>;
  if (typeof candidate.shadow !== "string" || typeof candidate.highlight !== "string") {
    return null;
  }
  return {
    shadow: normalizeColor(candidate.shadow, DEFAULT_BACKGROUND_PALETTE.shadow),
    highlight: normalizeColor(candidate.highlight, DEFAULT_BACKGROUND_PALETTE.highlight),
  };
}

function averageBucket(bucket: ColorBucket): Rgb {
  return {
    red: Math.round(bucket.red / bucket.weight),
    green: Math.round(bucket.green / bucket.weight),
    blue: Math.round(bucket.blue / bucket.weight),
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
  if (delta === 0) return { hue: 211, saturation: 0, lightness };
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  const hue = maximum === red
    ? ((green - blue) / delta) % 6
    : maximum === green
      ? (blue - red) / delta + 2
      : (red - green) / delta + 4;
  return { hue: (hue * 60 + 360) % 360, saturation, lightness };
}

function circularHueDistance(first: number, second: number) {
  const distance = Math.abs(first - second) % 360;
  return Math.min(distance, 360 - distance);
}

function toHex(color: Rgb) {
  return "#" + [color.red, color.green, color.blue]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeColor(value: string, fallback: string) {
  const normalized = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : fallback;
}
