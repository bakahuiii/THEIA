import { useEffect, useMemo, useRef, useState } from "react";
import { Database, RefreshCw, Search } from "lucide-react";
import { EmptyState, formatDate } from "../../ui/app-shared";
import type { AcademicExtraDomain, AcademicExtraRecord } from "../../types";

const HIDDEN_KEYS = new Set(["id", "fields", "source", "sourceUrl", "routeCode", "capturedAt", "recordType", "recordTypeLabel", "studentInternalId", "courseInternalId", "classInternalId"]);

function fields(record: AcademicExtraRecord) {
  if (Array.isArray(record.fields) && record.fields.length) {
    return record.fields.filter((field) => field?.name && !HIDDEN_KEYS.has(String(field.name)) && field.value !== "" && field.value !== null && field.value !== undefined).map((field) => ({ key: String(field.name), label: String(field.label || field.name), value: field.value }));
  }
  return Object.entries(record).filter(([key, value]) => !HIDDEN_KEYS.has(key) && value !== "" && value !== null && value !== undefined && typeof value !== "object").map(([key, value]) => ({ key, label: key, value: value as string | number }));
}

function value(record: AcademicExtraRecord, key: string) {
  const field = fields(record).find((entry) => entry.key === key);
  const raw = field?.value ?? record[key];
  if (raw === null || raw === undefined || raw === "") return "";
  return Array.isArray(raw) ? raw.join("；") : String(raw);
}

type GradeGroup = {
  key: string;
  title: string;
  courseCode: string;
  academicYear: string;
  term: string;
  summary: AcademicExtraRecord | null;
  components: AcademicExtraRecord[];
};

function groupsFor(records: AcademicExtraRecord[]) {
  const groups = new Map<string, GradeGroup>();
  for (const record of records) {
    const courseCode = value(record, "courseCode");
    const title = value(record, "courseName") || String(record.title || "未命名课程");
    const academicYear = value(record, "academicYearLabel") || value(record, "academicYear");
    const term = value(record, "termLabel") || value(record, "term");
    const key = [courseCode || title || record.id, academicYear, term].join("|");
    const group = groups.get(key) || { key, title, courseCode, academicYear, term, summary: null, components: [] };
    const type = String(record.recordType || "");
    if (type.includes("component") || record["componentScore"] !== undefined || record["assessmentItem"] !== undefined) group.components.push(record);
    else if (!group.summary || type === "grade-course") group.summary = record;
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => left.title.localeCompare(right.title, "zh-CN"));
}

function matches(record: AcademicExtraRecord, query: string) {
  if (!query.trim()) return true;
  return [record.title, ...fields(record).flatMap((field) => [field.label, field.value])].map((item) => String(item ?? "").toLocaleLowerCase()).join(" ").includes(query.trim().toLocaleLowerCase());
}

export function GradeDetailsPanel({ domain, refreshing, onRefresh }: { domain?: AcademicExtraDomain; refreshing: boolean; onRefresh: () => void }) {
  const [query, setQuery] = useState("");
  const requested = useRef(false);
  useEffect(() => {
    if (!domain?.capturedAt && !refreshing && !requested.current) {
      requested.current = true;
      onRefresh();
    }
  }, [domain?.capturedAt, onRefresh, refreshing]);
  const groups = useMemo(() => groupsFor((domain?.records || []).filter((record) => matches(record, query))), [domain?.records, query]);
  const status = domain?.completeness === "partial" ? "部分读取" : domain?.capturedAt ? "已读取" : "未读取";

  return (
    <section className="academic-records-panel academic-grade-details-panel" aria-labelledby="grade-details-title">
      <div className="academic-records-panel-head">
        <div className="academic-records-panel-title">
          <Database size={18} aria-hidden="true" />
          <div><h3 id="grade-details-title">成绩明细</h3><p>按课程展开平时、期中、期末等成绩组成，和成绩总表放在一起查看。</p></div>
        </div>
        <button type="button" className="academic-records-refresh" onClick={onRefresh} disabled={refreshing}><RefreshCw size={15} className={refreshing ? "spinning" : ""} aria-hidden="true" />{refreshing ? "读取中" : "重新读取"}</button>
      </div>
      <div className="academic-records-meta"><span className={`academic-records-status ${domain?.completeness === "partial" ? "partial" : domain?.capturedAt ? "ready" : "pending"}`}>{status}</span><span>{domain?.capturedAt ? `最近读取 ${formatDate(domain.capturedAt)}` : "按需读取"}</span><span>{domain?.records?.length || 0} 条分项记录</span></div>
      <label className="academic-records-search"><Search size={15} aria-hidden="true" /><span className="sr-only">搜索成绩明细</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索课程、学期或成绩组成" />{query && <small>{groups.length} 门课程</small>}</label>
      {groups.length ? (
        <div className="academic-grade-list">
          {groups.map((group) => {
            const detail = group.summary || group.components[0] || null;
            return <details className="academic-grade-course" key={group.key}>
              <summary><span className="academic-grade-course-title"><strong>{group.title}</strong><small>{[group.courseCode, group.academicYear, group.term].filter(Boolean).join(" · ") || "课程成绩"}</small></span><span className="academic-grade-course-score">{detail ? (value(detail, "overallScore") || value(detail, "score") || "--") : "--"}</span></summary>
              <div className="academic-grade-course-body">
                {detail && <dl className="academic-records-detail academic-grade-summary">{fields(detail).map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{String(field.value)}</dd></div>)}</dl>}
                {group.components.length ? <div className="academic-grade-components"><h4>成绩组成</h4><div className="academic-grade-components-table-wrap"><table className="academic-grade-components-table"><thead><tr><th>组成</th><th>分项成绩</th><th>总评成绩</th><th>学期</th></tr></thead><tbody>{group.components.map((record) => <tr key={record.id}><td>{value(record, "assessmentItem") || record.title || "成绩分项"}</td><td>{value(record, "componentScore") || "--"}</td><td>{value(record, "overallScore") || "--"}</td><td>{[value(record, "academicYearLabel"), value(record, "termLabel")].filter(Boolean).join(" · ") || "--"}</td></tr>)}</tbody></table></div></div> : <p className="academic-grade-no-components">教务系统未返回该课程的分项成绩。</p>}
              </div>
            </details>;
          })}
        </div>
      ) : <EmptyState icon={Database} title={domain?.capturedAt ? "没有匹配的成绩明细" : "尚未取得成绩明细"} detail="点击重新读取，或调整搜索条件。" />}
    </section>
  );
}
