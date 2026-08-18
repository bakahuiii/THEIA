import type {
  CampusState,
  UserDataDomainScope,
  UserDataDomainSummary,
  UserDataOverview,
  UserDataRecord,
  UserDataRecordsOptions,
  UserDataRecordsPage,
} from "./types";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const HIDDEN_KEYS = new Set([
  "raw", "rawHtml", "rawJson", "body", "content", "sourceUrl", "routeCode",
  "parserVersion", "requestParameters", "studentInternalId", "courseInternalId",
  "classInternalId", "kkbmId", "departmentId", "majorId", "planId", "planCourseId",
  "fields", "observations", "evidenceRefs", "source", "attachments",
]);

const DOMAIN_DEFINITIONS: Record<string, { label: string; field: keyof CampusState | "academicExtras" }> = {
  terms: { label: "学期", field: "terms" },
  courses: { label: "课程", field: "courses" },
  schedule: { label: "课表", field: "schedule" },
  grades: { label: "成绩", field: "grades" },
  exams: { label: "考试", field: "exams" },
  "selected-courses": { label: "已选课程", field: "selectedCourses" },
  assignments: { label: "作业与测试", field: "assignments" },
  notices: { label: "通知", field: "notices" },
  emails: { label: "校园邮箱", field: "emails" },
  "academic-progress": { label: "学业进度", field: "academicProgress" },
  "academic-extras": { label: "教务资料", field: "academicExtras" },
};

function text(value: unknown, fallback = "") {
  const result = String(value ?? "").replace(/\s+/gu, " ").trim();
  return result || fallback;
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

function currentTerm(state: CampusState) {
  const terms = list(state.terms);
  return terms.find((term) => term.current === true || term.isCurrent === true)
    || [...terms].sort((left, right) => {
      const year = (Number(right.year) || 0) - (Number(left.year) || 0);
      return year || (Number(right.term) || 0) - (Number(left.term) || 0);
    })[0]
    || null;
}

function domainRecords(state: CampusState, domain: string): Record<string, unknown>[] {
  if (domain === "academic-progress") return state.academicProgress ? [state.academicProgress as unknown as Record<string, unknown>] : [];
  if (domain === "academic-extras") {
    return Object.entries(state.academicExtras?.domains || {}).flatMap(([id, value]) => [
      ...list(value.records).map((record) => ({ ...record, _domain: id })),
      ...list(value.attachments).map((attachment, index) => ({
        ...attachment,
        id: text(attachment.id, `${id}:attachment:${index + 1}`),
        title: text(attachment.label || attachment.filename, `附件 ${index + 1}`),
        _domain: id,
        _recordKind: "attachment",
      })),
    ]);
  }
  if (domain === "academic-plan" || domain.includes("-")) {
    const extra = state.academicExtras?.domains?.[domain];
    if (extra) return [
      ...list(extra.records).map((record) => ({ ...record, _domain: domain })),
      ...list(extra.attachments).map((attachment, index) => ({
        ...attachment,
        id: text(attachment.id, `${domain}:attachment:${index + 1}`),
        title: text(attachment.label || attachment.filename, `附件 ${index + 1}`),
        _domain: domain,
        _recordKind: "attachment",
      })),
    ];
  }
  const definition = DOMAIN_DEFINITIONS[domain];
  if (!definition) return [];
  const value = state[definition.field];
  return Array.isArray(value) ? value as Record<string, unknown>[] : value ? [value as Record<string, unknown>] : [];
}

function safeValue(value: unknown): unknown {
  if (value === null || value === undefined || value === "") return null;
  if (["string", "number", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.slice(0, 32).map(safeValue);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !HIDDEN_KEYS.has(key))
      .slice(0, 32)
      .map(([key, child]) => [key, safeValue(child)]));
  }
  return String(value);
}

function attributes(record: Record<string, unknown>) {
  if (Array.isArray(record.fields)) {
    return record.fields.map((field) => {
      const item = field as Record<string, unknown>;
      return { key: text(item.name), label: text(item.label || item.name), value: safeValue(item.value) };
    }).filter((item) => item.key && item.value !== null && !HIDDEN_KEYS.has(item.key)).slice(0, 32);
  }
  return Object.entries(record)
    .filter(([key, value]) => !HIDDEN_KEYS.has(key) && value !== null && value !== undefined && value !== "")
    .slice(0, 32)
    .map(([key, value]) => ({ key, label: key, value: safeValue(value) }));
}

function statusOf(record: Record<string, unknown>, domain: string, now: number) {
  const explicit = text(record.status || record.state);
  if (record._recordKind === "attachment") return record.cached === true ? "cached" : "available";
  if (domain === "assignments") {
    if (/submitted|完成|已交|已提交/iu.test(explicit)) return "submitted";
    const dueAt = Date.parse(text(record.dueAt));
    return Number.isFinite(dueAt) && dueAt < now ? "overdue" : explicit || "pending";
  }
  if (domain === "grades") return record.score === null || record.score === undefined || record.score === "" ? "ungraded" : "recorded";
  if (domain === "notices") return record.read === true ? "read" : "unread";
  if (domain === "exams") {
    const when = Date.parse(text(record.startAt || record.examTime));
    return Number.isFinite(when) && when >= now ? "upcoming" : "past";
  }
  return explicit || "available";
}

function statusLabel(status: string) {
  return ({
    available: "可查看", pending: "待完成", overdue: "已逾期", submitted: "已完成",
    recorded: "已有成绩", ungraded: "待出成绩", upcoming: "即将开始", past: "已结束",
    read: "已读", unread: "未读", cached: "已保存",
  } as Record<string, string>)[status] || status || "状态未知";
}

function projectRecord(record: Record<string, unknown>, domain: string, now: number): UserDataRecord {
  const label = text(record.title || record.courseName || record.name || record.subject || record.label || record.filename, "未命名记录");
  const projected: UserDataRecord = {
    id: text(record.id, `${domain}:${label}`),
    label,
    scopeLabel: text(record._domain || record.termId || record.courseName),
    status: statusOf(record, domain, now),
    statusLabel: statusLabel(statusOf(record, domain, now)),
    completeness: "unknown",
    capturedAt: text(record.capturedAt || record.updatedAt || record.publishedAt || record.receivedAt) || null,
    sourcePlatform: text(record.source).toLowerCase() === "theol" ? "THEOL" : "JWGLXT",
  };
  if (record._recordKind === "attachment") {
    projected.recordKind = "attachment";
    projected.attachment = {
      type: text(record.type, "文件"),
      filename: text(record.filename || record.label, label),
      bytes: Number.isFinite(Number(record.bytes)) ? Number(record.bytes) : null,
      sha256: text(record.sha256) || null,
      cached: record.cached === true,
    };
  } else {
    projected.recordKind = "record";
    projected.recordType = text(record.recordType, "record");
    projected.recordTypeLabel = text(record.recordTypeLabel, "记录");
    projected.attributes = attributes(record);
  }
  return projected;
}

function summary(state: CampusState, domain: string, now: number): UserDataDomainSummary | null {
  if (!DOMAIN_DEFINITIONS[domain] && !state.academicExtras?.domains?.[domain]) return null;
  const records = domainRecords(state, domain);
  const extra = state.academicExtras?.domains?.[domain];
  const outcome = state.sync.domains?.[domain];
  const capturedAt = text(extra?.capturedAt || outcome?.capturedAt) || null;
  const status = outcome?.status === "auth-required" ? "auth-required"
    : outcome?.status === "failed" ? "failed"
      : records.length ? "available" : outcome?.emptyConfirmed ? "confirmed-empty" : "not-read";
  const scopes = new Map<string, UserDataDomainScope>();
  for (const record of records) {
    const id = text(record._domain || record.termId || "未分类");
    const entry = scopes.get(id) || { id, label: id, count: 0 };
    entry.count += 1;
    scopes.set(id, entry);
  }
  return {
    schema: "theia-user-data-view/v1",
    domain,
    label: extra?.label || DOMAIN_DEFINITIONS[domain]?.label || domain,
    count: records.length,
    scopes: [...scopes.values()].slice(0, 40),
    completeness: extra?.completeness || outcome?.completeness || (records.length ? "complete" : "unknown"),
    status,
    statusLabel: statusLabel(status),
    capturedAt,
    stale: !capturedAt || now - Date.parse(capturedAt) > 7 * 24 * 60 * 60 * 1_000,
    primaryAction: status === "not-read" || status === "failed" ? "refresh" : "open",
    retainedPrevious: outcome?.retainedPrevious === true,
    errorCode: outcome?.errorCode || null,
  };
}

export function projectBrowserUserDataOverview(state: CampusState, now = Date.now()): UserDataOverview {
  const domains = ["terms", "courses", "schedule", "grades", "exams", "selected-courses", "assignments", "notices", "emails", "academic-progress", "academic-extras"];
  const sections = domains.map((domain) => summary(state, domain, now)).filter((item): item is UserDataDomainSummary => Boolean(item));
  const extraDomains = Object.keys(state.academicExtras?.domains || {}).map((domain) => summary(state, domain, now)).filter((item): item is UserDataDomainSummary => Boolean(item));
  return {
    schema: "theia-user-data-view/v1",
    view: "overview",
    snapshotRevision: null,
    generatedAt: new Date(now).toISOString(),
    currentTerm: (() => {
      const term = currentTerm(state);
      return term ? { id: text(term.id), label: text(term.label || term.id) } : null;
    })(),
    attentionItems: [
      ...domainRecords(state, "assignments").filter((item) => ["pending", ""].includes(statusOf(item, "assignments", now))).slice(0, 6),
      ...domainRecords(state, "exams").filter((item) => statusOf(item, "exams", now) === "upcoming").slice(0, 4),
    ].map((item) => projectRecord(item, "assignments", now)),
    sections,
    extraDomains,
    sync: {
      lastRunAt: state.sync.lastRunAt,
      lastSuccessAt: state.sync.lastSuccessAt,
      lastError: text(state.sync.lastError).slice(0, 500) || null,
    },
  };
}

export function projectBrowserUserDataDomainSummary(state: CampusState, domain: string): UserDataDomainSummary | null {
  return summary(state, domain, Date.now());
}

export function projectBrowserUserDataRecords(state: CampusState, domain: string, options: UserDataRecordsOptions = {}): UserDataRecordsPage | null {
  if (!DOMAIN_DEFINITIONS[domain] && !state.academicExtras?.domains?.[domain]) return null;
  const now = Date.now();
  const query = text(options.query).toLocaleLowerCase();
  const recordType = text(options.recordType);
  const offset = Math.max(0, Number.parseInt(String(options.cursor || "0"), 10) || 0);
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(options.limit) || DEFAULT_LIMIT));
  const currentId = text(currentTerm(state)?.id);
  const items = domainRecords(state, domain)
    .filter((record) => options.scope === "all" || !currentId || !record.termId || String(record.termId) === currentId)
    .filter((record) => !options.termId || String(record.termId || "") === String(options.termId))
    .filter((record) => !options.status || statusOf(record, domain, now) === options.status)
    .filter((record) => !recordType || text(record.recordType, record._recordKind === "attachment" ? "attachment" : "record") === recordType)
    .map((record) => projectRecord(record, domain, now))
    .filter((record) => !query || JSON.stringify(record).toLocaleLowerCase().includes(query));
  const page = items.slice(offset, offset + limit);
  const next = offset + page.length;
  return {
    schema: "theia-user-data-view/v1",
    domain,
    label: summary(state, domain, now)?.label || domain,
    scope: options.scope || "current",
    total: items.length,
    items: page,
    nextCursor: next < items.length ? String(next) : null,
    hasMore: next < items.length,
  };
}

/**
 * Keep the browser renderer bounded in the same way as the desktop IPC
 * projection. Canonical storage and explicit records pages retain the full
 * collections; the ordinary app state only keeps metadata for large domains.
 */
export function projectBrowserRendererSnapshot(state: CampusState): CampusState {
  const academicExtras = state.academicExtras
    ? {
      ...state.academicExtras,
      domains: Object.fromEntries(Object.entries(state.academicExtras.domains || {}).map(([domain, value]) => {
        const records = Array.isArray(value.records) ? value.records : [];
        const recordCount = Number.isFinite(Number(value.recordCount))
          ? Number(value.recordCount)
          : records.length;
        return [domain, {
          ...value,
          recordCount,
          records: domain === "grade-details" ? records : [],
        }];
      })),
    }
    : state.academicExtras;
  const schoolSchedule = state.dataCatalog.collections.schoolSchedule;
  const dataCatalog = {
    ...state.dataCatalog,
    collections: {
      ...state.dataCatalog.collections,
      schoolSchedule: {
        ...schoolSchedule,
        recordCount: Number.isFinite(Number(schoolSchedule.recordCount))
          ? Number(schoolSchedule.recordCount)
          : Object.keys(schoolSchedule.records || {}).length,
        records: {},
      },
    },
  };
  const emails = state.emails.map((email) => ({
    ...email,
    body: null,
    bodyHtml: null,
    bodyHtmlVersion: null,
  }));
  return {
    ...state,
    academicExtras,
    dataCatalog,
    emails,
  };
}
