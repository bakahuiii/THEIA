/**
 * Build the campus walkability grid from the campus map.
 *
 * The campus map is a stylized drawing: the canvas background
 * (~ RGB 232,243,240, a light blue-green) is the walkable ground surface
 * (roads / plazas), while buildings, trees and decorations are any darker or
 * saturated color. A cell is walkable when its sampled pixels are close to the
 * background color (or are pure white, e.g. brighter ground areas).
 *
 * Output: src/assets/campus/grid.json
 *   {
 *     schema, source, width, height, stepPx,
 *     sourceWidth, sourceHeight,
 *     contentBox: { left, top, right, bottom },   // map content region
 *     walkable: "<base64 bitmask>"
 *   }
 *
 * Run: node scripts/build-campus-grid.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decode } from "jpeg-js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAP = resolve(root, "src/assets/theia-changping-campus-map.jpg");
const OUT = resolve(root, "src/assets/campus/grid.json");

// Grid dimensions. ~23 map px per cell.
const GRID_COLS = 300;
const GRID_ROWS = 440;

// Background (ground) color measured from the map corners.
const BG = { r: 232, g: 243, b: 240 };
const BG_DIST = 22; // cells within this RGB distance of the background are ground
const WHITE_MIN = 242; // brighter-than-background ground areas count too

function closeToBackground(r, g, b) {
  return (
    Math.hypot(r - BG.r, g - BG.g, b - BG.b) < BG_DIST ||
    (r > WHITE_MIN && g > WHITE_MIN && b > WHITE_MIN)
  );
}

function findContentBox(width, height, data) {
  // Scan from each edge for the first pixel that differs from the canvas color.
  const diff = (x, y) => {
    const i = (y * width + x) * 4;
    return (
      Math.abs(data[i] - BG.r) +
        Math.abs(data[i + 1] - BG.g) +
        Math.abs(data[i + 2] - BG.b) >
      18
    );
  };
  let left = 0, top = 0, right = width - 1, bottom = height - 1;
  outer: for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x += 5) if (diff(x, y)) { top = y; break outer; }
  }
  outer: for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x += 5) if (diff(x, y)) { bottom = y; break outer; }
  }
  outer: for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y += 5) if (diff(x, y)) { left = x; break outer; }
  }
  outer: for (let x = width - 1; x >= 0; x--) {
    for (let y = 0; y < height; y += 5) if (diff(x, y)) { right = x; break outer; }
  }
  return { left, top, right, bottom };
}

function build() {
  const buffer = readFileSync(MAP);
  const img = decode(buffer, {
    useTArray: true,
    formatAsRGBA: true,
    maxResolutionInMP: 100,
    maxMemoryUsageInMB: 2000,
  });
  const { width, height, data } = img;
  const contentBox = findContentBox(width, height, data);
  const stepX = width / GRID_COLS;
  const stepY = height / GRID_ROWS;

  const bits = new Uint8Array(GRID_COLS * GRID_ROWS);
  for (let gy = 0; gy < GRID_ROWS; gy++) {
    for (let gx = 0; gx < GRID_COLS; gx++) {
      const px = Math.round((gx + 0.5) * stepX);
      const py = Math.round((gy + 0.5) * stepY);
      const outside =
        px < contentBox.left ||
        px > contentBox.right ||
        py < contentBox.top ||
        py > contentBox.bottom;
      if (outside) {
        bits[gy * GRID_COLS + gx] = 0;
        continue;
      }
      const i = (py * width + px) * 4;
      bits[gy * GRID_COLS + gx] = closeToBackground(data[i], data[i + 1], data[i + 2]) ? 1 : 0;
    }
  }

  // 4-neighbor connectivity sanity: report the largest connected component so
  // we can eyeball whether the road network is usable.
  const seen = new Uint8Array(GRID_COLS * GRID_ROWS);
  let largest = 0;
  for (let i = 0; i < GRID_COLS * GRID_ROWS; i++) {
    if (!bits[i] || seen[i]) continue;
    let size = 0;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const c = stack.pop();
      size += 1;
      const x = c % GRID_COLS;
      const y = (c - x) / GRID_COLS;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= GRID_COLS || ny >= GRID_ROWS) continue;
        const ni = ny * GRID_COLS + nx;
        if (bits[ni] && !seen[ni]) {
          seen[ni] = 1;
          stack.push(ni);
        }
      }
    }
    if (size > largest) largest = size;
  }

  const byteLength = Math.ceil((GRID_COLS * GRID_ROWS) / 8);
  const packed = Buffer.alloc(byteLength);
  for (let i = 0; i < GRID_COLS * GRID_ROWS; i++) {
    if (!bits[i]) continue;
    packed[i >> 3] |= 0x80 >> (i & 7);
  }

  const grid = {
    schema: "theia-campus-grid/v1",
    source: "theia-changping-campus-map.jpg",
    width: GRID_COLS,
    height: GRID_ROWS,
    stepPx: Math.round((stepX + stepY) / 2),
    sourceWidth: width,
    sourceHeight: height,
    contentBox,
    walkable: packed.toString("base64"),
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(grid)}\n`, "utf8");
  const walk = bits.reduce((a, b) => a + b, 0);
  console.log(
    `grid written: ${GRID_COLS}x${GRID_ROWS} step=${grid.stepPx}px ` +
      `walkable=${(100 * walk) / bits.length}% largestComponent=${(100 * largest) / walk}% of walkable`,
  );
}

build();
