import type { SyncRetryDomain } from "../types";

export type AcademicExtraDefinition = {
  id: Extract<SyncRetryDomain,
    | "academic-plan"
    | "graduation-audit"
    | "grade-details"
    | "exam-extra"
    | "free-classroom"
  >;
  label: string;
  group: "学业与培养" | "教室与课表" | "档案与事务";
  description: string;
};

// Keep the product order stable even when a source adds a new route or a
// user's snapshot was captured in a different order.
export const ACADEMIC_EXTRA_DEFINITIONS: readonly AcademicExtraDefinition[] = [
  {
    id: "academic-plan",
    label: "培养执行计划",
    group: "学业与培养",
    description: "培养方案、专业方向与教学执行计划",
  },
  {
    id: "graduation-audit",
    label: "毕业审核",
    group: "学业与培养",
    description: "毕业资格、学位资格与审核结论",
  },
  {
    id: "grade-details",
    label: "成绩明细",
    group: "学业与培养",
    description: "平时、期中、期末及成绩组成",
  },
  {
    id: "exam-extra",
    label: "考试附加信息",
    group: "学业与培养",
    description: "考试相关的补充安排和报名信息",
  },
  {
    id: "free-classroom",
    label: "空闲教室",
    group: "教室与课表",
    description: "日期、校区、教室与空闲节次",
  },
] as const;

export const ACADEMIC_EXTRA_DEFINITION_MAP = new Map(
  ACADEMIC_EXTRA_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export function academicExtraLabel(domain: string) {
  return ACADEMIC_EXTRA_DEFINITION_MAP.get(domain as AcademicExtraDefinition["id"])?.label || domain;
}
