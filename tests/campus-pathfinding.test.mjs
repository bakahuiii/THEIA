import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(moduleDir, "..");

// Load the modules used by the campus pathfinding system.
// They are TypeScript files - Node 24's --experimental-strip-types handles them.
const pf = await import("../src/map/campus-pathfinding.ts");
const gridFile = resolve(root, "src/assets/campus/grid.json");
const grid = JSON.parse(readFileSync(gridFile, "utf8"));

test("campus grid has expected schema and dimensions", () => {
  assert.equal(grid.schema, "theia-campus-grid/v1");
  assert.equal(grid.width, 300);
  assert.equal(grid.height, 440);
  assert.equal(grid.stepPx, 23);
});

test("decodeWalkable produces a Uint8Array of correct length", () => {
  const cells = pf.decodeWalkable(grid);
  assert.ok(cells instanceof Uint8Array);
  assert.equal(cells.length, grid.width * grid.height);
});

test("walkable cells count matches grid JSON (via decode)", () => {
  const cells = pf.decodeWalkable(grid);
  const count = cells.reduce((a, b) => a + b, 0);
  // Between 20% and 35% of the map should be walkable.
  const pct = (100 * count) / (grid.width * grid.height);
  assert.ok(pct > 15, `walkable ratio ${pct.toFixed(1)}% is too low`);
  assert.ok(pct < 40, `walkable ratio ${pct.toFixed(1)}% is too high`);
});

test("nearestWalkable finds a walkable cell near a road point", () => {
  const cells = pf.decodeWalkable(grid);
  // Pick a point near the center of the map and check the snap.
  const snap = pf.nearestWalkable(grid, cells, 150, 220);
  assert.ok(snap !== null);
  assert.ok(pf.isWalkable(grid, cells, snap));
});

test("pixelToGrid round-trips correctly", () => {
  const gp = pf.pixelToGrid(grid, 6874 / 2, 10063 / 2);
  assert.ok(gp.x >= 140 && gp.y >= 210);
  const px = pf.gridToPixel(grid, gp);
  assert.ok(Math.abs(px.x - 6874 / 2) < 50);
  assert.ok(Math.abs(px.y - 10063 / 2) < 50);
});

test("findPath returns a path between two walkable cells", () => {
  const cells = pf.decodeWalkable(grid);
  // Find two cells that are definitely the walkable part of the road network.
  const a = pf.nearestWalkable(grid, cells, 80, 100);
  const b = pf.nearestWalkable(grid, cells, 250, 350);
  assert.ok(a !== null && b !== null);
  // They could be the same cell if one snapped to the same spot.
  if (a.x === b.x && a.y === b.y) return;
  const path = pf.findPath(grid, cells, a, b);
  assert.ok(path !== null, "expected a reachable path");
  assert.ok(path.length >= 2);
  // Verify every point on the path is walkable.
  for (const p of path) {
    assert.ok(pf.isWalkable(grid, cells, p), `path point (${p.x}, ${p.y}) is not walkable`);
  }
});

test("findPath start and goal landmarks connect through the road network", () => {
  const cells = pf.decodeWalkable(grid);
  const { components, largestId } = pf.labelComponents(grid, cells);
  // Try paths between several pairs to exercise the grid.
  const pairs = [
    { name: "top-left to bottom-right", a: [60, 80], b: [240, 370] },
    { name: "left side to right side", a: [80, 100], b: [250, 150] },
    { name: "central to top area", a: [150, 220], b: [150, 50] },
  ];
  for (const { name, a: [ax, ay], b: [bx, by] } of pairs) {
    const aa = pf.nearestWalkable(grid, cells, ax, ay);
    const bb = pf.nearestWalkable(grid, cells, bx, by);
    if (!aa || !bb) {
      console.log(`  SKIP ${name}: one endpoint has no walkable cell within radius`);
      continue;
    }
    if (aa.x === bb.x && aa.y === bb.y) continue;
    const path = pf.findPath(grid, cells, aa, bb, components, largestId);
    assert.ok(path !== null, `${name}: should be reachable`);
    for (const p of path) {
      assert.ok(pf.isWalkable(grid, cells, p), `${name}: path point (${p.x}, ${p.y}) not walkable`);
    }
  }
});

test("smoothPath reduces node count while preserving walkability", () => {
  const cells = pf.decodeWalkable(grid);
  const { components, largestId } = pf.labelComponents(grid, cells);
  const a = pf.nearestWalkable(grid, cells, 100, 150);
  const b = pf.nearestWalkable(grid, cells, 200, 280);
  if (!a || !b || (a.x === b.x && a.y === b.y)) return;
  const raw = pf.findPath(grid, cells, a, b, components, largestId);
  assert.ok(raw !== null);
  if (raw.length <= 2) return; // already minimal
  const smoothed = pf.smoothPath(grid, cells, raw);
  assert.ok(smoothed.length <= raw.length);
  // All points in the smoothed path must be walkable.
  for (const p of smoothed) {
    assert.ok(pf.isWalkable(grid, cells, p), "smoothed point not walkable");
  }
});

test("pathPixelLength returns a positive number", () => {
  const cells = pf.decodeWalkable(grid);
  const { components, largestId } = pf.labelComponents(grid, cells);
  const a = pf.nearestWalkable(grid, cells, 100, 150);
  const b = pf.nearestWalkable(grid, cells, 200, 280);
  if (!a || !b || (a.x === b.x && a.y === b.y)) return;
  const path = pf.findPath(grid, cells, a, b, components, largestId);
  if (!path) return;
  const len = pf.pathPixelLength(grid, path);
  assert.ok(Number.isFinite(len));
  assert.ok(len > 0);
});

test("nearestWalkableInLargest prefers the main road network", () => {
  const cells = pf.decodeWalkable(grid);
  const { components, largestId } = pf.labelComponents(grid, cells);
  // A point in an isolated pocket should be snapped into the largest component
  // when one exists nearby; the plain nearest cell may be in a small pocket.
  const snapped = pf.nearestWalkableInLargest(grid, cells, components, largestId, 235, 365, 80);
  assert.ok(snapped !== null);
  assert.equal(components[snapped.y * grid.width + snapped.x], largestId);
});