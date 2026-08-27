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

// ---- Persisted building marks ----------------------------------------------

const BUILDING_MARKS_KEY = "theia-campus-building-marks-v1";

export function readBuildingMarks(): BuildingMark[] {
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
