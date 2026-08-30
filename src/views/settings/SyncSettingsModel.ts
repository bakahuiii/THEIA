import type { CampusState, SyncRetryDomain } from "../../types";

export type SyncDataDefinition = {
  id: SyncRetryDomain;
  label: string;
  domain: string;
  source?: "jwglxt" | "theol";
  unit?: string;
  mainSync?: boolean;
  deferred?: boolean;
  count: (state: CampusState) => number;
};

export const SYNC_DATA_GROUPS: Array<{
  id: string;
  label: string;
  detail: string;
  items: SyncDataDefinition[];
}> = [
  {
    id: "jwglxt",
    label: "教务系统",
    detail: "课表、考试、成绩及学业数据",
    items: [
      { id: "profile", label: "个人信息", domain: "profile", source: "jwglxt", unit: "份", mainSync: true, count: (state) => Number(Boolean(state.profile)) },
      { id: "terms", label: "学期", domain: "terms", source: "jwglxt", unit: "个", mainSync: true, count: (state) => state.terms.length },
      { id: "schedule", label: "课表", domain: "schedule", source: "jwglxt", mainSync: true, count: (state) => state.schedule.length },
      { id: "exams", label: "考试", domain: "exams", source: "jwglxt", mainSync: true, count: (state) => state.exams.length },
      { id: "grades", label: "成绩", domain: "grades", source: "jwglxt", mainSync: true, count: (state) => state.grades.length },
      { id: "selected-courses", label: "已选课程", domain: "selected-courses", source: "jwglxt", unit: "门", mainSync: true, count: (state) => state.selectedCourses.length },
      { id: "academic-progress", label: "学业进度", domain: "academic-progress", source: "jwglxt", unit: "份", mainSync: true, count: (state) => Number(Boolean(state.academicProgress)) },
      { id: "jwglxt-courses", label: "教务课程信息", domain: "courses", source: "jwglxt", unit: "门", mainSync: true, count: (state) => state.courses.filter((course) => course.source === "jwglxt").length },
      { id: "jwglxt-notices", label: "教务通知", domain: "notices", source: "jwglxt", mainSync: true, count: (state) => state.notices.filter((notice) => notice.source === "jwglxt").length },
    ],
  },
  {
    id: "theol",
    label: "北化在线THEOL",
    detail: "北化在线THEOL严格串行读取",
    items: [
      { id: "theol-courses", label: "THEOL 课程", domain: "courses", source: "theol", unit: "门", mainSync: true, count: (state) => state.courses.filter((course) => course.source === "theol").length },
      { id: "theol-course-details", label: "THEOL 课程资料", domain: "course-details", source: "theol", unit: "门", mainSync: false, count: (state) => state.courses.filter((course) => course.source === "theol" && (course.courseInfo || course.teachingMaterials?.length || course.resourceLinks?.length)).length },
      { id: "assignments", label: "作业与测试", domain: "assignments", source: "theol", mainSync: true, deferred: true, count: (state) => state.assignments.length },
      { id: "theol-notices", label: "THEOL 通知", domain: "notices", source: "theol", mainSync: true, count: (state) => state.notices.filter((notice) => notice.source === "theol").length },
    ],
  },
  {
    id: "independent",
    label: "独立数据",
    detail: "按各自功能单独刷新",
    items: [
      { id: "mailbox", label: "校园邮箱", domain: "mailbox", unit: "封", count: (state) => state.emails.length },
      { id: "academic-calendar", label: "校历", domain: "academic-calendar", unit: "份", count: (state) => Number(Boolean(state.dataCatalog.collections.academicCalendar.calendar || state.dataCatalog.collections.academicCalendar.analysis)) },
      { id: "fitness", label: "体测成绩", domain: "fitness", unit: "个年度", count: (state) => Object.keys(state.dataCatalog.collections.fitness.records).length },
    ],
  },
];

export const SYNC_ERROR_LABELS: Record<string, string> = {
  auth_required: "需要重新登录",
  requirement_tree_missing: "培养方案树缺失",
  requirement_tree_inferred: "已恢复培养方案结构，层级来自页面顺序推断",
  partial_requirement_details: "培养方案节点明细仅部分获取成功",
  summary_only: "仅获取到汇总数据",
  partial_assignment_scan: "部分课程作业读取失败",
  partial_source_errors: "来源返回了部分错误",
  unconfirmed_empty_result: "空结果尚未确认",
  multiple_source_errors: "多个来源读取失败",
  multiple_dependency_errors: "多个依赖数据不完整",
};

type SyncDomainAggregate = CampusState["sync"]["domains"][string];
type SyncDomainOutcome = NonNullable<SyncDomainAggregate["outcomes"]>[string];
export type SyncDomainRecord = SyncDomainAggregate | SyncDomainOutcome;

export function syncRecord(
  state: CampusState,
  definition: SyncDataDefinition,
): SyncDomainRecord | undefined {
  const domain = state.sync.domains[definition.domain];
  return definition.source ? domain?.outcomes?.[definition.source] : domain;
}
