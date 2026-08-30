/**
 * Campus walkability grid + A* pathfinding.
 *
 * The grid is generated at build time by scripts/build-campus-grid.mjs from
 * the campus map (background-color pixels = walkable ground). This module
 * decodes that grid and implements an A* search over it, entirely hand-rolled
 * (binary heap + Manhattan/octile heuristic) with no pathfinding dependency.
 */

export interface CampusGrid {
  schema: string;
  source: string;
  width: number;
  height: number;
  stepPx: number;
  sourceWidth: number;
  sourceHeight: number;
  contentBox: { left: number; top: number; right: number; bottom: number };
  walkable: string;
  /** Bitmask of building-coloured cells (warm hues). */
  building?: string;
}

export interface GridPoint {
  x: number; // grid column
  y: number; // grid row
}

/** Decode the base64 bitmask into a Uint8Array of 0/1 cells (row-major). */
export function decodeWalkable(grid: Pick<CampusGrid, "width" | "height" | "walkable">): Uint8Array {
  const { width, height, walkable } = grid;
  const out = new Uint8Array(width * height);
  const raw = atob(walkable);
  for (let i = 0; i < raw.length; i++) {
    const byte = raw.charCodeAt(i);
    for (let bit = 0; bit < 8; bit++) {
      const index = i * 8 + bit;
      if (index >= width * height) break;
      if (byte & (0x80 >> bit)) out[index] = 1;
    }
  }
  return out;
}

export function isWalkable(grid: { width: number; height: number }, cells: Uint8Array, p: GridPoint): boolean {
  if (p.x < 0 || p.y < 0 || p.x >= grid.width || p.y >= grid.height) return false;
  return cells[p.y * grid.width + p.x] === 1;
}

/**
 * Find the nearest walkable cell within a radius of `x`,`y` (grid coords).
 * Used to snap a user-marked building / current location to the road network.
 */
export function nearestWalkable(
  grid: { width: number; height: number },
  cells: Uint8Array,
  x: number,
  y: number,
  maxRadius = 24,
): GridPoint | null {
  if (isWalkable(grid, cells, { x, y })) return { x, y };
  for (let radius = 1; radius <= maxRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const p = { x: x + dx, y: y + dy };
        if (isWalkable(grid, cells, p)) return p;
      }
    }
  }
  return null;
}

/**
 * Label 4-connected components of the walkable cells. Returns an Int32Array
 * where each walkable cell holds its component id (obstacles are -1) plus the
 * id of the largest component.
 */
export function labelComponents(
  grid: { width: number; height: number },
  cells: Uint8Array,
): { components: Int32Array; largestId: number; sizes: number[] } {
  const { width, height } = grid;
  const components = new Int32Array(width * height).fill(-1);
  const sizes: number[] = [];
  let nextId = 0;
  for (let i = 0; i < width * height; i++) {
    if (!cells[i] || components[i] !== -1) continue;
    const stack = [i];
    components[i] = nextId;
    let size = 0;
    while (stack.length) {
      const c = stack.pop()!;
      size += 1;
      const x = c % width;
      const y = (c - x) / width;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const ni = ny * width + nx;
        if (cells[ni] && components[ni] === -1) {
          components[ni] = nextId;
          stack.push(ni);
        }
      }
    }
    sizes.push(size);
    nextId += 1;
  }
  let largestId = -1;
  let largestSize = 0;
  for (let id = 0; id < sizes.length; id++) {
    if (sizes[id] > largestSize) {
      largestSize = sizes[id];
      largestId = id;
    }
  }
  return { components, largestId, sizes };
}

/**
 * Find the nearest walkable cell that belongs to the largest connected
 * component. A building mark often sits on an isolated pocket of ground next
 * to the building; snapping to the main road network keeps navigation between
 * buildings possible. Falls back to the plain nearest cell when nothing in the
 * main component is found within the radius.
 */
export function nearestWalkableInLargest(
  grid: { width: number; height: number },
  cells: Uint8Array,
  components: Int32Array,
  largestId: number,
  x: number,
  y: number,
  maxRadius = 60,
): GridPoint | null {
  const fallback = nearestWalkable(grid, cells, x, y, maxRadius);
  if (!fallback) return null;
  if (components[fallback.y * grid.width + fallback.x] === largestId) return fallback;
  for (let radius = 1; radius <= maxRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const p = { x: x + dx, y: y + dy };
        if (!isWalkable(grid, cells, p)) continue;
        if (components[p.y * grid.width + p.x] === largestId) return p;
      }
    }
  }
  return fallback;
}

/** Minimum binary heap used by A* (index 0 unused, classic binary heap). */
class MinHeap<T> {
  private heap: Array<{ key: number; value: T }> = [null as unknown as { key: number; value: T }];

  get size() {
    return this.heap.length - 1;
  }

  push(key: number, value: T) {
    const heap = this.heap;
    heap.push({ key, value });
    let i = heap.length - 1;
    while (i > 1) {
      const parent = i >> 1;
      if (heap[parent].key <= heap[i].key) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  }

  pop(): T | undefined {
    const heap = this.heap;
    if (heap.length <= 1) return undefined;
    const top = heap[1];
    const last = heap.pop()!;
    if (heap.length > 1) {
      heap[1] = last;
      let i = 1;
      const n = heap.length - 1;
      for (;;) {
        const left = i * 2;
        const right = left + 1;
        let smallest = i;
        if (left <= n && heap[left].key < heap[smallest].key) smallest = left;
        if (right <= n && heap[right].key < heap[smallest].key) smallest = right;
        if (smallest === i) break;
        [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
        i = smallest;
      }
    }
    return top.value;
  }
}

/** Octile distance heuristic (8-directional, diagonal = sqrt(2)). */
function heuristic(a: GridPoint, b: GridPoint): number {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
}

const DIRS8 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

function cardinalBlocked(grid: { width: number; height: number }, cells: Uint8Array, x: number, y: number): boolean {
  return !isWalkable(grid, cells, { x, y });
}

/**
 * A* over the walkability grid. Returns the path as grid points (inclusive of
 * start and goal), or null when unreachable within the grid.
 *
 * When `components` / `largestId` are supplied, both endpoints are snapped to
 * the largest connected component so buildings in isolated ground pockets can
 * still be reached from the main road network.
 */
export function findPath(
  grid: { width: number; height: number },
  cells: Uint8Array,
  start: GridPoint,
  goal: GridPoint,
  components?: Int32Array,
  largestId?: number,
): GridPoint[] | null {
  const startSnap = components && largestId !== undefined
    ? nearestWalkableInLargest(grid, cells, components, largestId, start.x, start.y) ?? start
    : nearestWalkable(grid, cells, start.x, start.y) ?? start;
  const goalSnap = components && largestId !== undefined
    ? nearestWalkableInLargest(grid, cells, components, largestId, goal.x, goal.y) ?? goal
    : nearestWalkable(grid, cells, goal.x, goal.y) ?? goal;
  if (!isWalkable(grid, cells, startSnap) || !isWalkable(grid, cells, goalSnap)) return null;
  if (startSnap.x === goalSnap.x && startSnap.y === goalSnap.y) return [startSnap];

  const { width } = grid;
  const total = width * grid.height;
  const gScore = new Float64Array(total).fill(Infinity);
  const cameFrom = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);

  const startIndex = startSnap.y * width + startSnap.x;
  const goalIndex = goalSnap.y * width + goalSnap.x;
  gScore[startIndex] = 0;
  const open = new MinHeap<number>();
  open.push(heuristic(startSnap, goalSnap), startIndex);

  while (open.size > 0) {
    const current = open.pop()!;
    if (current === goalIndex) {
      // Reconstruct path.
      const path: GridPoint[] = [];
      let node = current;
      while (node !== -1) {
        path.push({ x: node % width, y: Math.floor(node / width) });
        node = cameFrom[node];
      }
      path.reverse();
      return path;
    }
    if (closed[current]) continue;
    closed[current] = 1;

    const cx = current % width;
    const cy = Math.floor(current / width);
    for (const [dx, dy] of DIRS8) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= grid.height) continue;
      // Diagonal moves must not cut through a blocked corner.
      if (dx !== 0 && dy !== 0) {
        if (cardinalBlocked(grid, cells, cx + dx, cy) || cardinalBlocked(grid, cells, cx, cy + dy)) continue;
      }
      const neighbor = ny * width + nx;
      if (!cells[neighbor] || closed[neighbor]) continue;
      const stepCost = dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
      const tentative = gScore[current] + stepCost;
      if (tentative < gScore[neighbor]) {
        gScore[neighbor] = tentative;
        cameFrom[neighbor] = current;
        open.push(tentative + heuristic({ x: nx, y: ny }, goalSnap), neighbor);
      }
    }
  }
  return null;
}

/**
 * Collect walkable cells on the building perimeter around a mark.
 *
 * The mark sits on the building (its grid cell is usually blocked). We flood
 * the connected blocked region from the nearest blocked cell (bounded by a
 * Manhattan radius) and return every walkable cell adjacent to that region.
 * Those are the "doors" — the whole building edge is walkable in/out, and the
 * multi-source A* picks whichever door gives the shortest route. This works for
 * any building colour, not just the pink/purple ones.
 */
export function buildingEdgePoints(
  grid: { width: number; height: number },
  cells: Uint8Array,
  x: number,
  y: number,
  radius = 24,
): GridPoint[] {
  const { width, height } = grid;
  const total = width * height;

  // Nearest blocked (building) cell from the mark.
  const seed = nearestBlocked(grid, cells, x, y, radius);
  if (!seed) {
    const fallback = nearestWalkable(grid, cells, x, y, radius);
    return fallback ? [fallback] : [];
  }

  const blocked = new Uint8Array(total);
  const queue: number[] = [seed.y * width + seed.x];
  blocked[seed.y * width + seed.x] = 1;
  const doorSet = new Set<number>();
  const doors: GridPoint[] = [];

  while (queue.length) {
    const idx = queue.pop()!;
    const cx = idx % width;
    const cy = (idx - cx) / width;
    for (const [dx, dy] of DIRS8) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = ny * width + nx;
      if (cells[ni]) {
        // Walkable neighbour = a door on the building perimeter.
        if (!doorSet.has(ni)) {
          doorSet.add(ni);
          doors.push({ x: nx, y: ny });
        }
        continue;
      }
      if (blocked[ni]) continue;
      // Stay within the bounded building footprint.
      if (Math.abs(nx - seed.x) + Math.abs(ny - seed.y) > radius) continue;
      blocked[ni] = 1;
      queue.push(ni);
    }
  }
  return doors;
}

/** Find the nearest blocked (building/obstacle) cell within a Manhattan radius. */
export function nearestBlocked(
  grid: { width: number; height: number },
  cells: Uint8Array,
  x: number,
  y: number,
  maxRadius = 24,
): GridPoint | null {
  if (!isWalkable(grid, cells, { x, y })) return { x, y };
  for (let r = 1; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (!isWalkable(grid, cells, { x: x + dx, y: y + dy })) {
          return { x: x + dx, y: y + dy };
        }
      }
    }
  }
  return null;
}

/**
 * Multi-source A* between two building edge areas. Every walkable cell in
 * `startPoints` is an equal-cost source; the search stops as soon as any cell
 * in `goalPoints` is reached, giving the shortest edge-to-edge route.
 */
export function findPathBetweenAreas(
  grid: { width: number; height: number },
  cells: Uint8Array,
  startPoints: GridPoint[],
  goalPoints: GridPoint[],
): GridPoint[] | null {
  const { width, height } = grid;
  const total = width * height;

  // Goal index set + heuristic anchor (centroid of the goal area).
  const goalSet = new Set<number>();
  let goalSumX = 0;
  let goalSumY = 0;
  for (const p of goalPoints) {
    if (!isWalkable(grid, cells, p)) continue;
    goalSet.add(p.y * width + p.x);
    goalSumX += p.x;
    goalSumY += p.y;
  }
  if (!goalSet.size) return null;
  const goalAnchor = {
    x: Math.round(goalSumX / goalSet.size),
    y: Math.round(goalSumY / goalSet.size),
  };

  const gScore = new Float64Array(total).fill(Infinity);
  const cameFrom = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const open = new MinHeap<number>();

  let startCount = 0;
  for (const p of startPoints) {
    if (!isWalkable(grid, cells, p)) continue;
    const idx = p.y * width + p.x;
    if (gScore[idx] === 0) continue;
    gScore[idx] = 0;
    cameFrom[idx] = -1;
    open.push(heuristic(p, goalAnchor), idx);
    startCount += 1;
  }
  if (!startCount) return null;

  while (open.size > 0) {
    const current = open.pop()!;
    if (goalSet.has(current)) {
      const path: GridPoint[] = [];
      let node = current;
      while (node !== -1) {
        path.push({ x: node % width, y: Math.floor(node / width) });
        node = cameFrom[node];
      }
      path.reverse();
      return path;
    }
    if (closed[current]) continue;
    closed[current] = 1;

    const cx = current % width;
    const cy = Math.floor(current / width);
    for (const [dx, dy] of DIRS8) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (dx !== 0 && dy !== 0) {
        if (cardinalBlocked(grid, cells, cx + dx, cy) || cardinalBlocked(grid, cells, cx, cy + dy)) continue;
      }
      const neighbor = ny * width + nx;
      if (!cells[neighbor] || closed[neighbor]) continue;
      const stepCost = dx !== 0 && dy !== 0 ? Math.SQRT2 : 1;
      const tentative = gScore[current] + stepCost;
      if (tentative < gScore[neighbor]) {
        gScore[neighbor] = tentative;
        cameFrom[neighbor] = current;
        open.push(tentative + heuristic({ x: nx, y: ny }, goalAnchor), neighbor);
      }
    }
  }
  return null;
}

/**
 * Smooth a path: remove collinear points and shortcut bends that stay inside
 * walkable cells (line-of-sight on the grid). Produces a straighter route.
 */
export function smoothPath(
  grid: { width: number; height: number },
  cells: Uint8Array,
  path: GridPoint[],
): GridPoint[] {
  if (path.length <= 2) return path;
  const result: GridPoint[] = [path[0]];
  let anchor = 0;
  for (let i = 1; i < path.length; i++) {
    const next = path[i];
    if (hasClearLine(grid, cells, path[anchor], next)) continue;
    result.push(path[i - 1]);
    anchor = i - 1;
  }
  result.push(path[path.length - 1]);
  // Collapse collinear runs.
  const collapsed: GridPoint[] = [];
  for (const p of result) {
    const prev = collapsed[collapsed.length - 1];
    const prev2 = collapsed[collapsed.length - 2];
    if (prev && prev2 && isCollinear(prev2, prev, p)) collapsed.pop();
    collapsed.push(p);
  }
  return collapsed;
}

function isCollinear(a: GridPoint, b: GridPoint, c: GridPoint): boolean {
  return (b.x - a.x) * (c.y - b.y) === (b.y - a.y) * (c.x - b.x);
}

function hasClearLine(
  grid: { width: number; height: number },
  cells: Uint8Array,
  a: GridPoint,
  b: GridPoint,
): boolean {
  // Bresenham; every sampled cell must be walkable.
  let x0 = a.x, y0 = a.y;
  const x1 = b.x, y1 = b.y;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    if (!isWalkable(grid, cells, { x: x0, y: y0 })) return false;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
  return true;
}

// ---- Coordinate helpers -----------------------------------------------------

/** Convert map pixel coordinates to grid cell coordinates. */
export function pixelToGrid(grid: CampusGrid, px: number, py: number): GridPoint {
  return {
    x: Math.round((px / grid.sourceWidth) * grid.width),
    y: Math.round((py / grid.sourceHeight) * grid.height),
  };
}

/** Convert grid cell coordinates to map pixel coordinates (cell center). */
export function gridToPixel(grid: CampusGrid, p: GridPoint): { x: number; y: number } {
  return {
    x: ((p.x + 0.5) / grid.width) * grid.sourceWidth,
    y: ((p.y + 0.5) / grid.height) * grid.sourceHeight,
  };
}

/** Estimate walking distance (map pixels) of a path by summing segment lengths. */
export function pathPixelLength(grid: CampusGrid, path: GridPoint[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = gridToPixel(grid, path[i - 1]);
    const b = gridToPixel(grid, path[i]);
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}
