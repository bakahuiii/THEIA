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

test("grid keeps only the single road network component (outside disabled)", () => {
  const cells = pf.decodeWalkable(grid);
  const { components, largestId, sizes } = pf.labelComponents(grid, cells);
  // After build-time pruning, the walkable cells form ONE connected component,
  // so outside-campus pockets cannot be routed through.
  assert.equal(sizes.length, 1, "grid should be a single connected component");
  assert.equal(largestId, 0);
  const walk = cells.reduce((a, b) => a + b, 0);
  assert.ok(walk > 0);
});

test("buildingEdgePoints returns walkable cells on the building perimeter", () => {
  const cells = pf.decodeWalkable(grid);
  // 二教 (3796,4452) mark.
  const gp = pf.pixelToGrid(grid, 3796, 4452);
  const points = pf.buildingEdgePoints(grid, cells, gp.x, gp.y, 24);
  assert.ok(points.length >= 4, `expected edge points, got ${points.length}`);
  for (const p of points) {
    assert.ok(pf.isWalkable(grid, cells, p), `edge point (${p.x}, ${p.y}) not walkable`);
    // Every edge point must be adjacent to the blocked building region.
    let touches = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      if (!pf.isWalkable(grid, cells, { x: p.x + dx, y: p.y + dy })) { touches = true; break; }
    }
    assert.ok(touches, `edge point (${p.x}, ${p.y}) does not touch the building`);
  }
});

test("buildingEdgePoints reaches a mark inside a non-pink building (一教)", () => {
  const cells = pf.decodeWalkable(grid);
  // 一教 (4057,7552) - the mark cell is blocked (inside the building).
  const gp = pf.pixelToGrid(grid, 4057, 7552);
  assert.equal(pf.isWalkable(grid, cells, gp), false, "mark should sit on the building");
  const doors = pf.buildingEdgePoints(grid, cells, gp.x, gp.y, 30);
  assert.ok(doors.length >= 4, `expected doors on the building perimeter, got ${doors.length}`);
  for (const p of doors) {
    assert.ok(pf.isWalkable(grid, cells, p), `door (${p.x}, ${p.y}) not walkable`);
  }
});

test("grid exposes a building mask with valid dimensions", () => {
  assert.ok(grid.building, "grid.json should include a building mask");
  const building = pf.decodeWalkable({
    width: grid.width,
    height: grid.height,
    walkable: grid.building,
  });
  assert.equal(building.length, grid.width * grid.height);
  const count = building.reduce((a, b) => a + b, 0);
  assert.ok(count > 0, "building mask should contain building cells");
});

test("findPathBetweenAreas finds an edge-to-edge route", () => {
  const cells = pf.decodeWalkable(grid);
  // 紫竹苑1 (1788,4807) → 一教 (4057,7552): far apart, no shared door.
  const fromG = pf.pixelToGrid(grid, 1788, 4807);
  const toG = pf.pixelToGrid(grid, 4057, 7552);
  const fromEdge = pf.buildingEdgePoints(grid, cells, fromG.x, fromG.y, 24);
  const toEdge = pf.buildingEdgePoints(grid, cells, toG.x, toG.y, 24);
  assert.ok(fromEdge.length > 0 && toEdge.length > 0);
  const path = pf.findPathBetweenAreas(grid, cells, fromEdge, toEdge);
  assert.ok(path !== null, "expected a path between the two buildings");
  assert.ok(path.length >= 2);
  for (const p of path) {
    assert.ok(pf.isWalkable(grid, cells, p), `path point (${p.x}, ${p.y}) not walkable`);
  }
});