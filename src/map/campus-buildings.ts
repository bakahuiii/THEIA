/**
 * Campus building catalogue and room-name → building resolution.
 *
 * Schedule rooms look like "一教A-301", "一教B阶-103", "二教D-302",
 * "实验楼F-308", "第十一微机室-实验楼A315", or special values such as
 * "未排地点" / "网络课程". Each rule maps a room string to a building key.
 *
 * Building map coordinates (source-pixel x/y on the campus map) are marked by
 * the user in the Campus Map "标注模式" and persisted to localStorage, so the
 * catalogue only stores the rules + human names here.
 */

export interface BuildingDef {
  key: string;
  /** Short display label, e.g. "一教A". */
  label: string;
  /** Longer name for tooltips. */
  name: string;
  /** Regex the room string is tested against (in priority order). */
  match: RegExp;
  /** Which indoor floor plan to open (used by CampusMapView when available). */
  buildingId?: "first" | "second";
  /** Optional default source-pixel position when the user has not marked it. */
  defaultPosition?: { x: number; y: number };
}

export interface BuildingMark {
  key: string;
  x: number;
  y: number;
  markedAt: string;
  /** Custom user-entered label; when present it overrides the def label. */
  name?: string;
}

export const BUILDING_DEFS: BuildingDef[] = [
  {
    key: "firstA",
    label: "一教A",
    name: "第一教学楼 A 座",
    match: /一教\s*A(?:座|栋|楼)?/i,
    buildingId: "first",
  },
  {
    key: "firstB",
    label: "一教B",
    name: "第一教学楼 B 座",
    match: /一教\s*B(?:座|栋|楼)?/i,
    buildingId: "first",
  },
  {
    key: "firstC",
    label: "一教C",
    name: "第一教学楼 C 座",
    match: /一教\s*C(?:座|栋|楼)?/i,
    buildingId: "first",
  },
  {
    key: "first",
    label: "一教",
    name: "第一教学楼",
    match: /一教(?!\s*[A-Za-z])/i,
    buildingId: "first",
  },
  {
    key: "secondA",
    label: "二教A",
    name: "第二教学楼 A 座",
    match: /二教\s*A(?:座|栋|楼)?/i,
    buildingId: "second",
  },
  {
    key: "secondB",
    label: "二教B",
    name: "第二教学楼 B 座",
    match: /二教\s*B(?:座|栋|楼)?/i,
    buildingId: "second",
  },
  {
    key: "secondC",
    label: "二教C",
    name: "第二教学楼 C 座",
    match: /二教\s*C(?:座|栋|楼)?/i,
    buildingId: "second",
  },
  {
    key: "secondD",
    label: "二教D",
    name: "第二教学楼 D 座",
    match: /二教\s*D(?:座|栋|楼)?/i,
    buildingId: "second",
  },
  {
    key: "second",
    label: "二教",
    name: "第二教学楼",
    match: /二教(?!\s*[A-Za-z])/i,
    buildingId: "second",
  },
  {
    key: "labA",
    label: "实验楼A",
    name: "实验楼 A 座",
    match: /实验楼\s*A/i,
  },
  {
    key: "labB",
    label: "实验楼B",
    name: "实验楼 B 座",
    match: /实验楼\s*B/i,
  },
  {
    key: "labF",
    label: "实验楼F",
    name: "实验楼 F 座",
    match: /实验楼\s*F/i,
  },
  {
    key: "lab",
    label: "实验楼",
    name: "实验楼",
    match: /实验楼/i,
  },
  {
    key: "gym",
    label: "体育馆",
    name: "体育馆",
    match: /体育馆/i,
  },
  {
    key: "library",
    label: "图书馆",
    name: "图书馆",
    match: /图书/,
  },
  {
    key: "canteen",
    label: "食堂",
    name: "食堂",
    match: /食堂|餐厅/,
  },
];

/** Special room values that carry no building. */
const NO_BUILDING_PATTERNS = [/未排地点/, /网络课程/, /^$/, /无/];

/**
 * Resolve a schedule room string to a building key, or null when it has no
 * physical location on campus.
 */
export function resolveRoomToBuilding(room: string | null | undefined): string | null {
  const text = String(room ?? "").replace(/\s+/g, "");
  if (!text) return null;
  for (const pattern of NO_BUILDING_PATTERNS) {
    if (pattern.test(text)) return null;
  }
  // Match building rules against the whole room string. Rules are ordered
  // specific-first ("一教A" before "一教"), and room numbers like "301" never
  // match any rule, so no segmenting is needed.
  for (const def of BUILDING_DEFS) {
    if (def.match.test(text)) return def.key;
  }
  return null;
}

export function buildingDefByKey(key: string | null | undefined): BuildingDef | undefined {
  return BUILDING_DEFS.find((def) => def.key === key);
}

/**
 * Normalize a schedule-derived building key to a mark key that exists in
 * DEFAULT_BUILDING_MARKS. "一教A-301" resolves to firstA but the map only has
 * one "first" mark, so firstA → first. Likewise secondC/secondD → second and
 * labA/labB/labF → their dedicated marks when present.
 */
export function resolveMarkKey(key: string | null | undefined): string | null {
  if (!key) return null;
  if (key === "first" || key === "second" || key === "library" || key === "gym") return key;
  if (key.startsWith("first")) return "first";
  if (key.startsWith("second")) return "second";
  if (key.startsWith("lab")) return key; // labA / labB / labF / labH are distinct
  return key;
}

// ---- Fixed building marks ---------------------------------------------------
//
// Campus landmarks marked on the map by the user during the initial marking
// pass. Coordinates are source-image pixels on the campus map. These are
// built-in so navigation works out of the box; the marking UI was removed
// after this data was collected.

export const DEFAULT_BUILDING_MARKS: BuildingMark[] = [
  // 紫竹苑 / 樱花苑 dormitory clusters
  { key: "custom-紫竹苑1", x: 1788, y: 4807, name: "紫竹苑1", markedAt: "" },
  { key: "custom-紫竹苑2", x: 2197, y: 4804, name: "紫竹苑2", markedAt: "" },
  { key: "custom-紫竹苑3", x: 1795, y: 4279, name: "紫竹苑3", markedAt: "" },
  { key: "custom-紫竹苑4", x: 2219, y: 4031, name: "紫竹苑4", markedAt: "" },
  { key: "custom-樱花苑1", x: 1757, y: 6347, name: "樱花苑1", markedAt: "" },
  { key: "custom-樱花苑2", x: 1823, y: 6893, name: "樱花苑2", markedAt: "" },
  { key: "custom-樱花苑3", x: 2083, y: 5839, name: "樱花苑3", markedAt: "" },
  { key: "custom-樱花苑4", x: 2207, y: 6336, name: "樱花苑4", markedAt: "" },
  { key: "custom-樱花苑5", x: 2278, y: 6907, name: "樱花苑5", markedAt: "" },
  { key: "custom-樱花苑6", x: 2682, y: 5812, name: "樱花苑6", markedAt: "" },
  { key: "custom-樱花苑7", x: 2845, y: 6414, name: "樱花苑7", markedAt: "" },
  // Dining and services
  { key: "custom-紫竹食堂", x: 2194, y: 5233, name: "紫竹食堂", markedAt: "" },
  { key: "custom-玉兰餐厅", x: 2775, y: 4142, name: "玉兰餐厅", markedAt: "" },
  { key: "custom-后勤服务楼", x: 1799, y: 5836, name: "后勤服务楼", markedAt: "" },
  { key: "custom-大学生活动中心", x: 2897, y: 4675, name: "大学生活动中心", markedAt: "" },
  { key: "custom-校史博物馆", x: 2867, y: 5160, name: "校史博物馆", markedAt: "" },
  // Academic buildings
  // Note: first/一教, labA/实验楼A, labH/实验楼H are in the user's
  // localStorage as custom- keys; DEFAULT entries for them would cause
  // duplicate markers and are therefore omitted.
  { key: "second", x: 3796, y: 4452, name: "第二教学楼", markedAt: "" },
  { key: "library", x: 4242, y: 5035, markedAt: "" },
  { key: "custom-文理楼", x: 5101, y: 5437, name: "文理楼", markedAt: "" },
  { key: "gym", x: 3348, y: 8395, name: "体育馆", markedAt: "" },
];

export function readBuildingMarks(): BuildingMark[] {
  // Defaults first, then any user re-marks stored in localStorage override the
  // same key (so corrected coordinates win after a marking pass).
  const stored = readStoredMarks();
  if (!stored.length) return DEFAULT_BUILDING_MARKS;
  const byKey = new Map(DEFAULT_BUILDING_MARKS.map((m) => [m.key, m]));
  for (const mark of stored) byKey.set(mark.key, mark);
  return [...byKey.values()];
}

const BUILDING_MARKS_KEY = "theia-campus-building-marks-v1";

function readStoredMarks(): BuildingMark[] {
  try {
    const raw = localStorage.getItem(BUILDING_MARKS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is BuildingMark =>
          Boolean(item && typeof item === "object" && typeof (item as BuildingMark).key === "string" &&
            Number.isFinite((item as BuildingMark).x) && Number.isFinite((item as BuildingMark).y)),
      )
      .map((item) => ({
        key: item.key,
        x: Math.round(item.x),
        y: Math.round(item.y),
        markedAt: String(item.markedAt || ""),
        ...(typeof (item as BuildingMark).name === "string" && (item as BuildingMark).name
          ? { name: (item as BuildingMark).name }
          : {}),
      }));
  } catch {
    return [];
  }
}

export function writeBuildingMarks(marks: BuildingMark[]): void {
  try {
    localStorage.setItem(BUILDING_MARKS_KEY, JSON.stringify(marks));
  } catch {
    // Marks are best-effort local preferences.
  }
}

// ---- Home (default start) mark ---------------------------------------------

const HOME_MARK_KEY = "theia-campus-home-mark-v1";

export function readHomeMark(): string | null {
  try {
    return localStorage.getItem(HOME_MARK_KEY);
  } catch {
    return null;
  }
}

export function saveHomeMark(key: string | null): void {
  try {
    if (key) localStorage.setItem(HOME_MARK_KEY, key);
    else localStorage.removeItem(HOME_MARK_KEY);
  } catch {
    // best-effort
  }
}
