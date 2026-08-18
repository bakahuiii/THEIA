import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Database,
  ExternalLink,
  FileText,
  RefreshCw,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { bridge } from "../bridge";
import {
  ACADEMIC_EXTRA_DEFINITIONS,
  type AcademicExtraDefinition,
} from "../ui/academic-extra";
import { EmptyState, formatDate } from "../ui/app-shared";
import type {
  AcademicExtraDomain,
  AcademicExtraRecord,
  CampusState,
  SyncRetryDomain,
  UserDataOverview,
  UserDataRecord,
  UserDataRecordsPage,
} from "../types";

type AcademicExtraId = AcademicExtraDefinition["id"];

const HIDDEN_RECORD_KEYS = new Set([
  "id",
  "fields",
  "source",
  "sourceUrl",
  "routeCode",
  "capturedAt",
  "recordType",
  "recordTypeLabel",
]);
const HIDDEN_FIELD_KEYS = new Set([
  "studentInternalId",
  "courseInternalId",
  "classInternalId",
  "kkbmId",
  "departmentId",
  "majorId",
  "planId",
  "planCourseId",
]);
const RECORD_PAGE_SIZE = 50;

function recordFields(record: AcademicExtraRecord) {
  if (Array.isArray(record.fields) && record.fields.length) {
    return record.fields
      .filter((field) => field?.name && !HIDDEN_FIELD_KEYS.has(String(field.name)) && field.value !== null && field.value !== undefined && field.value !== "")
      .map((field) => ({
        key: String(field.name),
        label: String(field.label || field.name),
        value: field.value,
      }));
  }
  return Object.entries(record)
    .filter(([key, value]) => !HIDDEN_RECORD_KEYS.has(key) && !HIDDEN_FIELD_KEYS.has(key) && value !== null && value !== undefined && value !== "")
    .map(([key, value]) => ({ key, label: key, value: typeof value === "object" ? JSON.stringify(value) : value as string | number }));
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "--";
  if (Array.isArray(value)) return value.join("；");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function userRecordToAcademicRecord(record: UserDataRecord): AcademicExtraRecord {
  const fields = (record.attributes || [])
    .filter((field) => field?.key && field.value !== null && field.value !== undefined)
    .map((field) => ({
      name: field.key,
      label: field.label || field.key,
      value: displayValue(field.value),
    }));
  return {
    id: record.id,
    title: record.label,
    fields,
    recordType: record.recordType || record.recordKind || "record",
    recordTypeLabel: record.recordTypeLabel || (record.recordKind === "attachment" ? "附件" : "记录"),
    recordKind: record.recordKind,
    capturedAt: record.capturedAt,
    status: record.status,
    ...Object.fromEntries(fields.map((field) => [field.name, field.value])),
  };
}

function userAttachmentToAcademicAttachment(record: UserDataRecord) {
  return {
    id: record.id,
    label: record.attachment?.filename || record.label,
    type: record.attachment?.type || null,
    sourceUrl: null,
    cached: record.attachment?.cached,
    bytes: record.attachment?.bytes,
    sha256: record.attachment?.sha256,
    filename: record.attachment?.filename || record.label,
  };
}

function recordTypeKey(record: AcademicExtraRecord) {
  return String(record.recordType || "record");
}

function recordTypeLabel(record: AcademicExtraRecord) {
  return String(record.recordTypeLabel || "记录");
}

function domainStatus(domain: AcademicExtraDomain | undefined, state: CampusState, id: AcademicExtraId) {
  const provenance = state.sync.domains[id];
  const hasRecords = Boolean(domain?.records?.length);
  const hasAttachments = Boolean(domain?.attachments?.length);
  if (provenance?.status === "failed" || provenance?.status === "auth-required") return "failed";
  if (domain?.completeness === "partial" || provenance?.completeness === "partial") return "partial";
  if (domain?.capturedAt && (domain.completeness === "unknown" || provenance?.completeness === "unknown")) return "unknown";
  if (domain?.capturedAt && !hasRecords && !hasAttachments && (domain.completeness === "complete" || provenance?.emptyConfirmed)) return "empty";
  if (domain?.capturedAt || provenance?.status === "succeeded") return "ready";
  return "pending";
}

function statusLabel(status: ReturnType<typeof domainStatus>) {
  if (status === "ready") return "已读取";
  if (status === "empty") return "已确认空";
  if (status === "partial") return "部分读取";
  if (status === "unknown") return "状态未知";
  if (status === "failed") return "读取失败";
  return "未读取";
}

function StatusIcon({ status }: { status: ReturnType<typeof domainStatus> }) {
  if (status === "ready") return <CheckCircle2 size={14} aria-hidden="true" />;
  if (status === "empty") return <CheckCircle2 size={14} aria-hidden="true" />;
  if (status === "partial" || status === "failed" || status === "unknown") return <AlertTriangle size={14} aria-hidden="true" />;
  return <Clock3 size={14} aria-hidden="true" />;
}

function domainRecords(domain: AcademicExtraDomain | undefined, query: string, type: string) {
  const records = Array.isArray(domain?.records) ? domain.records : [];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const typed = type === "all" ? records : records.filter((record) => recordTypeKey(record) === type);
  if (!normalizedQuery) return typed;
  return typed.filter((record) => {
    const haystack = [record.title, ...recordFields(record).flatMap((field) => [field.label, field.value])]
      .map((value) => displayValue(value).toLocaleLowerCase())
      .join(" ");
    return haystack.includes(normalizedQuery);
  });
}

function columnsFor(records: AcademicExtraRecord[]) {
  const columns: Array<{ key: string; label: string }> = [];
  const seen = new Set<string>();
  for (const record of records) {
    for (const field of recordFields(record)) {
      if (seen.has(field.key)) continue;
      seen.add(field.key);
      columns.push({ key: field.key, label: field.label });
      if (columns.length >= 12) return columns;
    }
  }
  const priority = [
    "courseName", "courseCode", "academicYearLabel", "termLabel", "assessmentItem", "componentScore", "overallScore",
    "score", "credits", "department", "className", "teacher", "major", "grade", "status", "planCapacity", "courseCount",
  ];
  const rank = (key: string) => {
    const index = priority.indexOf(key);
    return index < 0 ? priority.length + columns.findIndex((column) => column.key === key) : index;
  };
  return columns.filter((column) => !HIDDEN_FIELD_KEYS.has(column.key)).sort((left, right) => rank(left.key) - rank(right.key)).slice(0, 12);
}

function valueFor(record: AcademicExtraRecord, key: string) {
  const field = recordFields(record).find((entry) => entry.key === key);
  return field?.value ?? record[key];
}

function isPdfAttachment(attachment: AcademicExtraDomain["attachments"][number]) {
  return /pdf/iu.test(String(attachment.type || "")) || /\.pdf(?:$|[?#])/iu.test(String(attachment.sourceUrl || ""));
}

function gradeRecordValue(record: AcademicExtraRecord, key: string) {
  const value = valueFor(record, key);
  return value === null || value === undefined || value === "" ? "" : displayValue(value);
}

type GradeDetailsGroup = {
  key: string;
  title: string;
  courseCode: string;
  summary: AcademicExtraRecord | null;
  components: AcademicExtraRecord[];
  academicYear: string;
  term: string;
};

function groupGradeRecords(records: AcademicExtraRecord[]): GradeDetailsGroup[] {
  const groups = new Map<string, GradeDetailsGroup>();
  for (const record of records) {
    const courseCode = gradeRecordValue(record, "courseCode");
    const courseName = gradeRecordValue(record, "courseName") || String(record.title || "未命名课程");
    const academicYear = gradeRecordValue(record, "academicYearLabel") || gradeRecordValue(record, "academicYear");
    const term = gradeRecordValue(record, "termLabel") || gradeRecordValue(record, "term");
    const identity = courseCode || courseName || gradeRecordValue(record, "classInternalId") || record.id;
    const key = [identity, academicYear, term].join("|");
    const current = groups.get(key) || {
      key,
      title: courseName,
      courseCode,
      summary: null,
      components: [],
      academicYear,
      term,
    };
    const recordType = recordTypeKey(record);
    const isComponent = recordType.includes("component")
      || valueFor(record, "componentScore") !== undefined
      || valueFor(record, "assessmentItem") !== undefined;
    if (isComponent) current.components.push(record);
    else if (!current.summary || recordType === "grade-course") current.summary = record;
    groups.set(key, current);
  }
  return Array.from(groups.values()).sort((left, right) => left.title.localeCompare(right.title, "zh-CN"));
}

function AcademicPlanContent({
  domain,
  status,
  onOpenAttachment,
}: {
  domain: AcademicExtraDomain | undefined;
  status: ReturnType<typeof domainStatus>;
  onOpenAttachment: (domain: string, attachmentId: string) => Promise<{ cached: boolean }>;
}) {
  const pdfs = (domain?.attachments || []).filter(isPdfAttachment);
  const [openingAttachmentId, setOpeningAttachmentId] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const openAttachment = async (attachment: AcademicExtraDomain["attachments"][number]) => {
    if (!attachment.id || openingAttachmentId) return;
    setOpeningAttachmentId(attachment.id);
    setAttachmentError(null);
    try {
      const result = await onOpenAttachment("academic-plan", attachment.id).catch(() => ({ cached: false }));
      if (result.cached) return;
      setAttachmentError("官方 PDF 尚未缓存成功，请稍后重试；来源页面需单独打开。");
    } finally {
      setOpeningAttachmentId(null);
    }
  };
  if (pdfs.length) {
    return (
      <section className="academic-plan-primary" aria-label="官方培养计划 PDF">
        <div className="academic-plan-primary-head">
          <span className="academic-plan-file-icon"><FileText size={21} aria-hidden="true" /></span>
          <div>
            <strong>官方培养计划</strong>
            <p>以教务系统原始 PDF 为准，避免把页面控件和不完整索引当成培养方案。</p>
          </div>
        </div>
        <div className="academic-plan-pdf-list">
          {pdfs.map((attachment) => (
            <button
              type="button"
              className="academic-plan-pdf"
              key={attachment.id || attachment.sourceUrl}
              onClick={() => void openAttachment(attachment)}
              disabled={openingAttachmentId === attachment.id}
              title="打开官方培养计划 PDF"
            >
              <FileText size={15} aria-hidden="true" />
              <span>{openingAttachmentId === attachment.id ? "正在打开官方培养计划…" : (attachment.label || "官方培养计划 PDF")}</span>
              <ExternalLink size={13} aria-hidden="true" />
            </button>
          ))}
        </div>
        <small className="academic-plan-captured">PDF 抓取时间：{domain?.capturedAt ? formatDate(domain.capturedAt) : "--"}</small>
        {attachmentError && <p className="academic-plan-attachment-error" role="status">{attachmentError}</p>}
      </section>
    );
  }
  if (!domain || status !== "ready") {
    return <EmptyState icon={FileText} title="尚未取得官方培养计划 PDF" detail="当前只有未确认完整的页面索引，因此不展示可能误导的结构化培养计划。请读取此域后重试。" />;
  }
  return <EmptyState icon={FileText} title="本次没有可打开的官方 PDF" detail="教务系统返回了完整结果，但没有附带可验证的 PDF；因此不把页面索引伪装成培养计划。" />;
}

function GradeDetailsContent({ groups }: { groups: GradeDetailsGroup[] }) {
  return (
    <div className="academic-grade-list" aria-label="按课程分组的成绩明细">
      {groups.map((group) => {
        const detailRecord = group.summary || group.components[0] || null;
        const summaryFields = detailRecord ? recordFields(detailRecord) : [];
        return (
          <details className="academic-grade-course" key={group.key}>
            <summary>
              <span className="academic-grade-course-title">
                <strong>{group.title}</strong>
                <small>{[group.courseCode, group.academicYear, group.term].filter(Boolean).join(" · ") || "课程成绩"}</small>
              </span>
              <span className="academic-grade-course-score">{detailRecord ? (gradeRecordValue(detailRecord, "overallScore") || "--") : "--"}</span>
            </summary>
            <div className="academic-grade-course-body">
              {summaryFields.length ? (
                <dl className="academic-records-detail academic-grade-summary">
                  {summaryFields.map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{displayValue(field.value)}</dd></div>)}
                </dl>
              ) : null}
              {group.components.length ? (
                <div className="academic-grade-components">
                  <h4>成绩组成</h4>
                  <div className="academic-grade-components-table-wrap">
                    <table className="academic-grade-components-table">
                      <thead><tr><th>组成</th><th>分项成绩</th><th>总评成绩</th><th>学年学期</th></tr></thead>
                      <tbody>
                        {group.components.map((record) => (
                          <tr key={record.id}>
                            <td>{gradeRecordValue(record, "assessmentItem") || record.title || "成绩分项"}</td>
                            <td>{gradeRecordValue(record, "componentScore") || "--"}</td>
                            <td>{gradeRecordValue(record, "overallScore") || "--"}</td>
                            <td>{[gradeRecordValue(record, "academicYearLabel"), gradeRecordValue(record, "termLabel")].filter(Boolean).join(" · ") || "--"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : <p className="academic-grade-no-components">教务系统未返回该课程的分项成绩。</p>}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function emptyStateCopy(domain: AcademicExtraDomain | undefined, status: ReturnType<typeof domainStatus>, query: string) {
  if (query) return { title: "没有匹配记录", detail: "请调整当前资料域的搜索条件。" };
  if (!domain) {
    return status === "failed"
      ? { title: "最近读取失败", detail: "本地没有可展示的旧记录；再次读取前不会把空白当作结果。" }
      : { title: "该资料域尚未读取", detail: "按需获取后，读取结果会带有捕获时间和完整性状态。" };
  }
  if (status === "empty") return { title: "已确认当前没有记录", detail: "教务系统明确返回空结果；这不等同于资料域从未读取。" };
  if (status === "partial") return { title: "没有可确认的完整记录", detail: "本次读取不完整，已有旧记录会继续保留；请不要把空白当作事实上的无记录。" };
  if (status === "unknown") return { title: "记录状态未知", detail: "本地有捕获时间，但完整性无法确认；请在需要时重新读取。" };
  return { title: "当前域没有记录", detail: "教务系统返回的可读记录会保留在本地。" };
}

export function AcademicRecordsView({
  state,
  overview,
  onRefreshDomain,
  refreshingDomain,
  onOpenSource,
  onOpenAttachment,
}: {
  state: CampusState;
  overview: UserDataOverview | null;
  onRefreshDomain: (domain: SyncRetryDomain) => void;
  refreshingDomain: SyncRetryDomain | null;
  onOpenSource: (url: string) => void;
  onOpenAttachment: (domain: string, attachmentId: string) => Promise<{ cached: boolean }>;
}) {
  const loadedDomains = state.academicExtras?.domains || {};
  const firstDomain = ACADEMIC_EXTRA_DEFINITIONS.find((definition) => loadedDomains[definition.id]?.capturedAt)
    ?.id || ACADEMIC_EXTRA_DEFINITIONS.find((definition) => loadedDomains[definition.id]?.records?.length)
      ?.id || ACADEMIC_EXTRA_DEFINITIONS[0].id;
  const [activeDomain, setActiveDomain] = useState<AcademicExtraId>(firstDomain);
  const [query, setQuery] = useState("");
  const [recordType, setRecordType] = useState("all");
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [recordPage, setRecordPage] = useState(0);
  const [remotePage, setRemotePage] = useState<UserDataRecordsPage | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(false);

  useEffect(() => {
    if (!ACADEMIC_EXTRA_DEFINITIONS.some((definition) => definition.id === activeDomain)) {
      setActiveDomain(firstDomain);
    }
  }, [activeDomain, firstDomain]);

  useEffect(() => {
    setQuery("");
    setRecordType("all");
    setSelectedRecordId(null);
    setRecordPage(0);
  }, [activeDomain]);

  const definition = ACADEMIC_EXTRA_DEFINITIONS.find((entry) => entry.id === activeDomain) || ACADEMIC_EXTRA_DEFINITIONS[0];
  const domain = loadedDomains[activeDomain];
  const isAcademicPlan = activeDomain === "academic-plan";
  const isGradeDetails = activeDomain === "grade-details";
  // The grade details view still needs its local grouping algorithm. Other
  // domains use the bounded, redacted page endpoint and never materialize the
  // complete historical table in React.
  const useRemoteRecords = Boolean(overview) && !isGradeDetails;
  useEffect(() => {
    if (!useRemoteRecords) {
      setRemotePage(null);
      setRemoteLoading(false);
      return;
    }
    let active = true;
    setRemoteLoading(true);
    void bridge.getUserDataRecords(activeDomain, {
      query,
      recordType: recordType === "all" ? undefined : recordType,
      scope: "all",
      limit: RECORD_PAGE_SIZE,
      cursor: String(recordPage * RECORD_PAGE_SIZE),
    }).then((page) => {
      if (active) setRemotePage(page);
    }).catch(() => {
      if (active) setRemotePage(null);
    }).finally(() => {
      if (active) setRemoteLoading(false);
    });
    return () => { active = false; };
  }, [activeDomain, overview, query, recordPage, recordType, useRemoteRecords]);
  const recordTypes = useMemo(() => {
    if (useRemoteRecords) return [{ key: "all", label: "全部记录", count: overview?.extraDomains.find((entry) => entry.domain === activeDomain)?.count || 0 }];
    const counts = new Map<string, { label: string; count: number }>();
    for (const record of domain?.records || []) {
      const key = recordTypeKey(record);
      const current = counts.get(key);
      counts.set(key, { label: recordTypeLabel(record), count: (current?.count || 0) + 1 });
    }
    return [{ key: "all", label: "全部记录", count: domain?.records?.length || 0 }, ...Array.from(counts.entries()).map(([key, value]: [string, { label: string; count: number }]) => ({ key, ...value }))];
  }, [activeDomain, domain, overview, useRemoteRecords]);
  useEffect(() => {
    if (recordType !== "all" && !recordTypes.some((entry) => entry.key === recordType)) setRecordType("all");
  }, [recordType, recordTypes]);
  const localRecords = useMemo(() => useRemoteRecords ? [] : domainRecords(domain, query, recordType), [domain, query, recordType, useRemoteRecords]);
  const remoteRecords = useMemo(() => (remotePage?.items || []).map(userRecordToAcademicRecord), [remotePage]);
  const records = useRemoteRecords ? remoteRecords : localRecords;
  const gradeRecords = useMemo(() => isGradeDetails ? domainRecords(domain, query, "all") : [], [domain, isGradeDetails, query]);
  const gradeGroups = useMemo(() => groupGradeRecords(gradeRecords), [gradeRecords]);
  const columns = useMemo(() => columnsFor(records), [records]);
  useEffect(() => {
    setRecordPage(0);
    setSelectedRecordId(null);
  }, [query, recordType]);
  const totalVisibleRecords = useRemoteRecords ? (remotePage?.total || 0) : records.length;
  const recordPageCount = Math.max(1, Math.ceil(totalVisibleRecords / RECORD_PAGE_SIZE));
  useEffect(() => {
    if (recordPage >= recordPageCount) setRecordPage(recordPageCount - 1);
  }, [recordPage, recordPageCount]);
  const visibleRecords = useRemoteRecords ? records : records.slice(recordPage * RECORD_PAGE_SIZE, (recordPage + 1) * RECORD_PAGE_SIZE);
  const selectedRecord = records.find((record) => record.id === selectedRecordId) || null;
  const totalRecords = overview
    ? overview.extraDomains.reduce((total, entry) => total + entry.count, 0)
    : Object.values(loadedDomains).reduce((total, entry) => total + (entry.records?.length || 0), 0);
  const loadedCount = overview
    ? overview.extraDomains.filter((entry) => entry.capturedAt || entry.count > 0).length
    : ACADEMIC_EXTRA_DEFINITIONS.filter((entry) => loadedDomains[entry.id]?.capturedAt).length;
  const status = domainStatus(domain, state, activeDomain);
  const refreshing = refreshingDomain === activeDomain;
  const emptyCopy = emptyStateCopy(domain, status, query);
  const remoteDomain = useMemo(() => {
    if (!useRemoteRecords || !domain) return domain;
    const attachments = (remotePage?.items || []).filter((item) => item.recordKind === "attachment").map(userAttachmentToAcademicAttachment);
    return attachments.length ? { ...domain, attachments } : domain;
  }, [domain, remotePage, useRemoteRecords]);

  return (
    <div className="academic-records-view">
      <header className="academic-records-header">
        <div>
          <span className="academic-records-kicker">JWGLXT · READ ONLY</span>
          <h2>教务资料</h2>
          <p>扩展教务页面按域保存为本地表，默认不拖慢核心同步；需要时单独读取。</p>
        </div>
        <div className="academic-records-summary" aria-label="教务资料汇总">
          <strong>{loadedCount}/{ACADEMIC_EXTRA_DEFINITIONS.length}</strong>
          <span>已读取域 · {totalRecords} 条记录</span>
        </div>
      </header>

      <div className="academic-records-layout">
        <aside className="academic-records-sidebar" aria-label="教务资料分域">
          {(["学业与培养", "教室与课表"] as const).map((group) => (
            <div className="academic-records-group" key={group}>
              <h3>{group}</h3>
              {ACADEMIC_EXTRA_DEFINITIONS.filter((entry) => entry.group === group).map((entry) => {
                const entryDomain = loadedDomains[entry.id];
                const entryStatus = domainStatus(entryDomain, state, entry.id);
                const count = overview?.extraDomains.find((item) => item.domain === entry.id)?.count
                  ?? entryDomain?.records?.length
                  ?? 0;
                return (
                  <button
                    type="button"
                    key={entry.id}
                    className={`academic-records-domain ${entry.id === activeDomain ? "active" : ""}`}
                    onClick={() => {
                      setActiveDomain(entry.id);
                      if (!entryDomain?.capturedAt && !refreshingDomain) onRefreshDomain(entry.id);
                    }}
                    aria-current={entry.id === activeDomain ? "page" : undefined}
                  >
                    <span className={`academic-records-domain-icon ${entryStatus}`}><StatusIcon status={entryStatus} /></span>
                    <span className="academic-records-domain-copy">
                      <strong>{entry.label}</strong>
                      <small>{count ? `${count} 条记录` : statusLabel(entryStatus)}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </aside>

        <section className="academic-records-panel" aria-labelledby="academic-records-panel-title">
          <div className="academic-records-panel-head">
            <div className="academic-records-panel-title">
              <Database size={18} aria-hidden="true" />
              <div>
                <h3 id="academic-records-panel-title">{definition.label}</h3>
                <p>{definition.description}</p>
              </div>
            </div>
            <button
              type="button"
              className="academic-records-refresh"
              onClick={() => onRefreshDomain(activeDomain)}
              disabled={refreshing}
              title="只读取当前教务资料域"
            >
              <RefreshCw size={15} aria-hidden="true" />
              {refreshing ? "读取中" : "读取此域"}
            </button>
          </div>

          <div className="academic-records-meta">
            <span className={`academic-records-status ${status}`}><StatusIcon status={status} />{statusLabel(status)}</span>
            <span>{domain?.capturedAt ? `最近读取 ${formatDate(domain.capturedAt)}` : "尚未读取"}</span>
            <span>{domain?.queryStats ? `查询 ${domain.queryStats.succeeded}/${domain.queryStats.attempted}` : "按需查询"}</span>
            {domain?.sourceUrl && (
              <button type="button" className="academic-records-source" onClick={() => onOpenSource(domain.sourceUrl || "")} title="打开教务来源页面">
                <ExternalLink size={13} aria-hidden="true" />来源页面
              </button>
            )}
          </div>

          {domain?.messages?.length ? (
            <div className="academic-records-message" role="status">{domain.messages.join(" · ")}</div>
          ) : null}

          {!isAcademicPlan && (
            <label className="academic-records-search">
              <Search size={15} aria-hidden="true" />
              <span className="sr-only">搜索当前资料域</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索当前资料域" />
              {query && <small>{(isGradeDetails ? gradeRecords : records).length} 条匹配</small>}
            </label>
          )}

          {!isAcademicPlan && !isGradeDetails && recordTypes.length > 1 && (
            <div className="academic-records-type-filter" aria-label="记录类型">
              {recordTypes.map((entry) => (
                <button
                  type="button"
                  key={entry.key}
                  className={recordType === entry.key ? "active" : ""}
                  onClick={() => { setRecordType(entry.key); setSelectedRecordId(null); }}
                  aria-pressed={recordType === entry.key}
                >
                  {entry.label}<small>{entry.count}</small>
                </button>
              ))}
            </div>
          )}

          {isAcademicPlan ? (
            <AcademicPlanContent
              domain={remoteDomain}
              status={status}
              onOpenAttachment={onOpenAttachment}
            />
          ) : isGradeDetails ? (
            gradeGroups.length ? <GradeDetailsContent groups={gradeGroups} /> : (
              <EmptyState icon={Database} title={emptyCopy.title} detail={emptyCopy.detail} />
            )
          ) : remoteLoading ? (
            <div className="academic-records-loading" role="status">正在整理当前资料页…</div>
          ) : records.length ? (
            <>
              <div className="academic-records-table-wrap">
                <table className="academic-records-table">
                  <thead>
                    <tr>
                      <th>记录</th>
                      {columns.map((column) => <th key={column.key}>{column.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRecords.map((record) => (
                      <tr key={record.id} className={selectedRecordId === record.id ? "selected" : ""}>
                        <td>
                          <button type="button" className="academic-records-record-link" onClick={() => setSelectedRecordId(record.id)}>
                            <strong>{record.title || "未命名记录"}</strong>
                            <small>{recordTypeLabel(record)}</small>
                          </button>
                        </td>
                        {columns.map((column) => <td key={column.key}>{displayValue(valueFor(record, column.key))}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalVisibleRecords > RECORD_PAGE_SIZE && (
                <nav className="academic-records-pagination" aria-label="教务资料分页">
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setRecordPage((page) => Math.max(0, page - 1))}
                    disabled={recordPage === 0}
                    aria-label="上一页"
                    title="上一页"
                  >
                    <ChevronLeft size={16} aria-hidden="true" />
                  </button>
                  <span>{recordPage * RECORD_PAGE_SIZE + 1}–{Math.min((recordPage + 1) * RECORD_PAGE_SIZE, totalVisibleRecords)} / {totalVisibleRecords}</span>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setRecordPage((page) => Math.min(recordPageCount - 1, page + 1))}
                    disabled={recordPage >= recordPageCount - 1}
                    aria-label="下一页"
                    title="下一页"
                  >
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </nav>
              )}
              {selectedRecord && (
                <div className="academic-records-detail" aria-live="polite">
                  <div className="academic-records-detail-head">
                    <strong>{selectedRecord.title || "记录详情"} · {recordTypeLabel(selectedRecord)}</strong>
                    <button type="button" className="academic-records-detail-close" onClick={() => setSelectedRecordId(null)}>收起</button>
                  </div>
                  <dl>
                    {recordFields(selectedRecord).map((field) => (
                      <div key={field.key}><dt>{field.label}</dt><dd>{displayValue(field.value)}</dd></div>
                    ))}
                  </dl>
                </div>
              )}
            </>
          ) : (
            <EmptyState
              icon={Database}
              title={emptyCopy.title}
              detail={emptyCopy.detail}
            />
          )}
        </section>
      </div>
    </div>
  );
}
