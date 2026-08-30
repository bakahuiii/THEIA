import { formatDate } from "../../ui/app-shared";
import type { CourseSelectionCandidate, SchoolScheduleItem } from "../../types";

export type SelectionOptions = {
  candidate?: CourseSelectionCandidate | null;
  targets?: import("../../types").CourseSelectionTarget[];
  startAt: string | null;
  endAt?: string | null;
  intervalMs: number;
  maxAttempts: number;
  concurrency?: number;
};

export const schoolScheduleColumns = [
  { key: "title", label: "课程 / 课程号" },
  { key: "className", label: "教学班名称" },
  { key: "combinedClassInfo", label: "合班信息" },
  { key: "department", label: "开课院系" },
  { key: "teacher", label: "教师" },
  { key: "credits", label: "学分" },
  { key: "category", label: "课程类型" },
  { key: "nature", label: "课程性质" },
  { key: "affiliation", label: "课程归属" },
  { key: "time", label: "时间" },
  { key: "location", label: "教室" },
  { key: "status", label: "状态" },
] as const;

export type SchoolScheduleSortKey = (typeof schoolScheduleColumns)[number]["key"];
export type SchoolScheduleSort = { key: SchoolScheduleSortKey; direction: "asc" | "desc" };

export const SCHOOL_SCHEDULE_ROW_HEIGHT = 72;
export const SCHOOL_SCHEDULE_OVERSCAN = 12;

export function schoolScheduleSortValue(item: SchoolScheduleItem, key: SchoolScheduleSortKey) {
  if (key === "title") return [item.title, item.courseCode].filter(Boolean).join(" ");
  if (key === "credits") return item.credits ?? Number.NEGATIVE_INFINITY;
  return item[key] || "";
}

export function schoolTermParts(id: string) {
  const [year = "", term = ""] = String(id || "").split("-");
  return { year, term };
}

export function schoolTermLabel(term: string) {
  return ({ "3": "第一学期", "12": "第二学期", "16": "第三学期" } as Record<string, string>)[term] || `学期 ${term}`;
}

export function schoolScheduleUpdatedAt(value?: string | null) {
  return value ? formatDate(value) : "更新时间未知";
}

export function paginationPages(current: number, total: number) {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  return [...new Set([1, current - 1, current, current + 1, total])]
    .filter((page) => page >= 1 && page <= total)
    .sort((left, right) => left - right);
}

export const matchBasisLabels: Record<string, string> = {
  "official-link": "培养方案直接关联",
  "course-code": "课程号匹配",
  category: "课程类别匹配",
  "name-match": "课程名称匹配",
  unknown: "培养方案匹配未知",
};

export const confidenceLabels = {
  high: "高置信",
  medium: "中置信",
  low: "低置信",
} as const;

export const scheduleStatusLabels = {
  clear: "未发现冲突",
  conflict: "存在冲突",
  unknown: "冲突未知",
} as const;

export const duplicateStatusLabels: Record<string, string> = {
  "already-completed": "已修或已通过",
  "currently-selected": "已在当前课表",
  "previous-attempt": "存在历史修读",
  none: "未发现重复",
  unknown: "重复检查未知",
};

export function advisorCandidateRecord(candidate: CourseSelectionCandidate) {
  return {
    id: candidate.id,
    courseId: candidate.courseId,
    courseCode: candidate.courseCode ?? null,
    title: candidate.title,
    credits: candidate.credits ?? null,
    categoryCode: candidate.categoryCode,
    blockTitle: candidate.blockTitle ?? null,
    termId: candidate.termId ?? null,
    time: candidate.time ?? null,
  };
}
