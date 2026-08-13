import {
  BookOpen,
  ArrowDownUp,
  CalendarDays,
  CircleAlert,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Crosshair,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, formatDate, localDateTimeValue, type Term } from "../ui/app-shared";
import type {
  CourseSelectionCandidate,
  CourseSelectionCatalogPage,
  CourseSelectionPortal,
  CourseSelectionSnapshot,
  CourseSelectionTarget,
  CourseSelectionSentinel,
  AcademicCalendarPdfAnalysis,
  SchoolScheduleItem,
  SchoolScheduleQuery,
  SchoolScheduleResult,
} from "../types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type SelectionOptions = {
  candidate?: CourseSelectionCandidate | null;
  targets?: CourseSelectionTarget[];
  startAt: string | null;
  endAt?: string | null;
  intervalMs: number;
  maxAttempts: number;
  concurrency?: number;
};

const schoolScheduleColumns = [
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

type SchoolScheduleSortKey = (typeof schoolScheduleColumns)[number]["key"];
type SchoolScheduleSort = { key: SchoolScheduleSortKey; direction: "asc" | "desc" };

const SCHOOL_SCHEDULE_ROW_HEIGHT = 72;
const SCHOOL_SCHEDULE_OVERSCAN = 12;

function schoolScheduleSortValue(item: SchoolScheduleItem, key: SchoolScheduleSortKey) {
  if (key === "title") return [item.title, item.courseCode].filter(Boolean).join(" ");
  if (key === "credits") return item.credits ?? Number.NEGATIVE_INFINITY;
  return item[key] || "";
}

function schoolTermParts(id: string) {
  const [year = "", term = ""] = String(id || "").split("-");
  return { year, term };
}

function schoolTermLabel(term: string) {
  return ({ "3": "第一学期", "12": "第二学期", "16": "第三学期" } as Record<string, string>)[term] || `学期 ${term}`;
}

function schoolScheduleUpdatedAt(value?: string | null) {
  if (!value) return "更新时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "更新时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function paginationPages(current: number, total: number) {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  return [...new Set([1, current - 1, current, current + 1, total])]
    .filter((page) => page >= 1 && page <= total)
    .sort((left, right) => left - right);
}

export function CourseSelectionView({
  portal,
  candidates,
  candidateCatalogPage,
  snapshot,
  loading,
  schoolSchedule,
  schoolScheduleLoading,
  schoolScheduleError,
  schoolScheduleRefreshFailed,
  terms,
  academicCalendarAnalysis,
  onDiscover,
  onLoadCandidates,
  onSearchSchoolSchedule,
  onDismissSchoolScheduleError,
  onSaveSchoolTarget,
  onRemoveSchoolTarget,
  onSetSentinel,
  onStart,
  onStop,
}: {
  portal: CourseSelectionPortal | null;
  candidates: CourseSelectionCandidate[];
  candidateCatalogPage: CourseSelectionCatalogPage;
  snapshot: CourseSelectionSnapshot;
  loading: boolean;
  schoolSchedule: SchoolScheduleResult | null;
  schoolScheduleLoading: boolean;
  schoolScheduleError: string | null;
  schoolScheduleRefreshFailed: boolean;
  terms: Term[];
  academicCalendarAnalysis?: AcademicCalendarPdfAnalysis | null;
  onDiscover: () => void;
  onLoadCandidates: (
    blockId: string,
    target: Pick<SchoolScheduleItem, "courseCode" | "title"> | null,
    options?: Partial<CourseSelectionCatalogPage>,
  ) => void;
  onSearchSchoolSchedule: (query: SchoolScheduleQuery) => void;
  onDismissSchoolScheduleError: () => void;
  onSaveSchoolTarget: (target: SchoolScheduleItem | null) => void;
  onRemoveSchoolTarget: (id: string) => void;
  onSetSentinel: (config: Partial<CourseSelectionSentinel>) => void;
  onStart: (options: SelectionOptions) => void;
  onStop: () => void;
}) {
  const [blockId, setBlockId] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [startAt, setStartAt] = useState(() => localDateTimeValue());
  const [endAt, setEndAt] = useState(() => new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [intervalMs, setIntervalMs] = useState(1500);
  const [maxAttempts, setMaxAttempts] = useState(120);
  const [concurrency, setConcurrency] = useState(2);
  const [candidateKeyword, setCandidateKeyword] = useState("");
  const [schoolYear, setSchoolYear] = useState("");
  const [schoolTerm, setSchoolTerm] = useState("");
  const [schoolKeyword, setSchoolKeyword] = useState("");
  const [schoolDepartment, setSchoolDepartment] = useState("");
  const [schoolCategory, setSchoolCategory] = useState("");
  const [schoolNature, setSchoolNature] = useState("");
  const [schoolAffiliation, setSchoolAffiliation] = useState("");
  const [schoolScheduleSort, setSchoolScheduleSort] = useState<SchoolScheduleSort | null>(null);
  const persistedSchoolTargets = useMemo<SchoolScheduleItem[]>(() => (snapshot.targets || [snapshot.target].filter(Boolean))
    .filter((target): target is CourseSelectionTarget => Boolean(target?.title))
    .map((target) => ({
      id: target.id || `course-selection-target:${target.termId || "unknown"}:${target.courseCode || target.title}`,
      termId: target.termId || "", classId: target.classId || null, courseCode: target.courseCode || null, title: target.title,
      className: target.className || null, teacher: target.teacher || null, time: target.time || null,
      location: target.location || null, credits: target.credits ?? null,
    })), [snapshot.target, snapshot.targets]);
  const [schoolTarget, setSchoolTarget] = useState<SchoolScheduleItem | null>(null);
  const schoolScheduleTableRef = useRef<HTMLDivElement>(null);
  const [schoolScheduleViewport, setSchoolScheduleViewport] = useState({
    scrollTop: 0,
    height: 560,
  });
  const active = snapshot.active;
  const sentinel = snapshot.sentinel || { enabled: false, startAt: null, endAt: null, intervalMs: 3_000, concurrency: 2, completedTargetIds: [] };
  const activeJob = Boolean(
    active && ["scheduled", "running"].includes(active.status),
  );
  const selectionWindows = useMemo(() => {
    const weekly = academicCalendarAnalysis?.weeklyCalendar as { courseSelectionWindows?: Array<{
      id?: string;
      summary?: string;
      dateText?: string;
      startAt?: string;
      endAt?: string;
    }> } | null;
    return (weekly?.courseSelectionWindows || []).filter((window) => window.startAt && window.endAt);
  }, [academicCalendarAnalysis]);
  const automaticSelectionWindow = useMemo(() => {
    const now = Date.now();
    return selectionWindows.find((window) => new Date(window.endAt || 0).getTime() >= now)
      || selectionWindows.at(-1)
      || null;
  }, [selectionWindows]);
  const taskLogs = useMemo(() => (snapshot.jobs || []).flatMap((job) => (job.logs || []).map((entry, index) => ({
    ...entry,
    id: `${job.id}:${entry.at}:${index}`,
    course: job.candidate?.title || job.target?.title || "抢课任务",
  }))).sort((left, right) => right.at.localeCompare(left.at)), [snapshot.jobs]);
  const selected =
    candidates.find((candidate) => candidate.id === candidateId) || null;
  const saveSchoolTarget = (target: SchoolScheduleItem) => {
    setSchoolTarget(target);
    onSaveSchoolTarget(target);
  };
  const selectCandidate = (candidate: CourseSelectionCandidate) => {
    setCandidateId(candidate.id);
    saveSchoolTarget({
      id: candidate.id,
      termId: candidate.termId || "",
      classId: candidate.classId || null,
      courseCode: candidate.courseCode || null,
      title: candidate.title,
      className: candidate.className || null,
      teacher: candidate.teacher || null,
      time: candidate.time || null,
      location: candidate.location || null,
      credits: candidate.credits ?? null,
    });
  };
  useEffect(() => {
    setSchoolTarget((current) => current && persistedSchoolTargets.some((target) => target.id === current.id)
      ? current : persistedSchoolTargets.at(-1) || null);
  }, [persistedSchoolTargets]);
  useEffect(() => {
    if (!sentinel.startAt || !sentinel.endAt) return;
    setStartAt(localDateTimeValue(sentinel.startAt));
    setEndAt(localDateTimeValue(sentinel.endAt));
  }, [sentinel.endAt, sentinel.startAt]);
  const persistSelectionWindow = useCallback((nextStart = startAt, nextEnd = endAt) => {
    const start = new Date(nextStart || '').getTime();
    const end = new Date(nextEnd || '').getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    onSetSentinel({
      enabled: sentinel.enabled,
      startAt: new Date(start).toISOString(),
      endAt: new Date(end).toISOString(),
      intervalMs,
      concurrency,
    });
  }, [concurrency, endAt, intervalMs, onSetSentinel, sentinel.enabled, startAt]);
  const applyAutomaticSelectionWindow = () => {
    if (!automaticSelectionWindow?.startAt || !automaticSelectionWindow.endAt) return;
    setStartAt(automaticSelectionWindow.startAt);
    setEndAt(automaticSelectionWindow.endAt);
    persistSelectionWindow(automaticSelectionWindow.startAt, automaticSelectionWindow.endAt);
  };
  const visibleCandidates = candidates.filter((candidate) => {
    const keyword = candidateKeyword.trim().toLocaleLowerCase();
    if (!keyword) return true;
    return [candidate.title, candidate.courseCode, candidate.teacher]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase().includes(keyword));
  });
  const candidateTotal = Math.max(candidates.length, candidateCatalogPage.total);
  const candidatePages = Math.max(1, Math.ceil(candidateTotal / candidateCatalogPage.pageSize));
  const schoolYears = useMemo(
    () => [...new Set(terms.map((term) => schoolTermParts(term.id).year).filter((year) => /^20\d{2}$/.test(year)))]
      .sort((left, right) => right.localeCompare(left)),
    [terms],
  );
  const schoolTerms = useMemo(
    () => terms.filter((term) => schoolTermParts(term.id).year === schoolYear)
      .sort((left, right) => Number(schoolTermParts(left.id).term) - Number(schoolTermParts(right.id).term)),
    [schoolYear, terms],
  );
  const schoolTermId = useMemo(
    () => schoolTerms.find((term) => schoolTermParts(term.id).term === schoolTerm)?.id || "",
    [schoolTerm, schoolTerms],
  );
  const loadCandidatePage = (
    page = 1,
    pageSize = candidateCatalogPage.pageSize,
  ) => {
    if (!blockId) return;
    onLoadCandidates(
      blockId,
      null,
      { page, pageSize },
    );
  };

  useEffect(() => {
    if (!portal?.blocks.length) {
      setBlockId("");
      return;
    }
    setBlockId((current) =>
      portal.blocks.some((block) => block.id === current)
        ? current
        : portal.blocks[0].id,
    );
  }, [portal]);
  useEffect(() => setCandidateId(""), [blockId, candidates]);
  useEffect(() => setCandidateKeyword(""), [blockId]);
  useEffect(() => {
    const preferred = schoolTermParts(portal?.term.id || terms[0]?.id || "");
    setSchoolYear((current) => schoolYears.includes(current) ? current : preferred.year);
  }, [portal, schoolYears, terms]);
  useEffect(() => {
    setSchoolTerm((current) =>
      schoolTerms.some((term) => schoolTermParts(term.id).term === current)
        ? current
        : schoolTermParts(schoolTerms[0]?.id || "").term,
    );
  }, [schoolTerms]);
  useEffect(() => {
    if (!schoolTarget || !candidates.length) return;
    const matched = candidates.find((candidate) =>
      (schoolTarget.courseCode && candidate.courseCode === schoolTarget.courseCode) ||
      candidate.title === schoolTarget.title,
    );
    if (matched) setCandidateId(matched.id);
  }, [candidates, schoolTarget]);
  const schoolFilterOptions = useMemo(() => {
    const values = (key: "department" | "category" | "nature" | "affiliation") =>
      [...new Set((schoolSchedule?.items || []).map((item) => String(item[key] || "").trim()).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right, "zh-CN"));
    return {
      departments: values("department"),
      categories: values("category"),
      natures: values("nature"),
      affiliations: values("affiliation"),
    };
  }, [schoolSchedule]);
  const visibleSchoolItems = useMemo(() => {
    const query = schoolKeyword.trim().toLocaleLowerCase();
    return (schoolSchedule?.items || []).filter((item) => {
      const searchText = [item.title, item.courseCode, item.className, item.combinedClassInfo].filter(Boolean).join(" ").toLocaleLowerCase();
      return (!query || searchText.includes(query))
        && (!schoolDepartment || item.department === schoolDepartment)
        && (!schoolCategory || item.category === schoolCategory)
        && (!schoolNature || item.nature === schoolNature)
        && (!schoolAffiliation || item.affiliation === schoolAffiliation);
    });
  }, [schoolAffiliation, schoolCategory, schoolDepartment, schoolKeyword, schoolNature, schoolSchedule]);
  const sortedSchoolItems = useMemo(() => {
    if (!schoolScheduleSort) return visibleSchoolItems;
    return [...visibleSchoolItems].sort((left, right) => {
      const leftValue = schoolScheduleSortValue(left, schoolScheduleSort.key);
      const rightValue = schoolScheduleSortValue(right, schoolScheduleSort.key);
      const compared = typeof leftValue === "number" && typeof rightValue === "number"
        ? leftValue - rightValue
        : String(leftValue).localeCompare(String(rightValue), "zh-CN", { numeric: true, sensitivity: "base" });
      return schoolScheduleSort.direction === "asc" ? compared : -compared;
    });
  }, [schoolScheduleSort, visibleSchoolItems]);
  const schoolScheduleRange = useMemo(() => {
    const visibleRows = Math.ceil(schoolScheduleViewport.height / SCHOOL_SCHEDULE_ROW_HEIGHT);
    const start = Math.max(0, Math.floor(schoolScheduleViewport.scrollTop / SCHOOL_SCHEDULE_ROW_HEIGHT) - SCHOOL_SCHEDULE_OVERSCAN);
    const end = Math.min(sortedSchoolItems.length, start + visibleRows + SCHOOL_SCHEDULE_OVERSCAN * 2);
    return { start, end };
  }, [schoolScheduleViewport, sortedSchoolItems.length]);
  const virtualSchoolItems = useMemo(
    () => sortedSchoolItems.slice(schoolScheduleRange.start, schoolScheduleRange.end),
    [schoolScheduleRange, sortedSchoolItems],
  );
  const updateSchoolScheduleViewport = useCallback(() => {
    const element = schoolScheduleTableRef.current;
    if (!element) return;
    setSchoolScheduleViewport((current) => {
      const next = { scrollTop: element.scrollTop, height: element.clientHeight };
      return current.scrollTop === next.scrollTop && current.height === next.height ? current : next;
    });
  }, []);
  useEffect(() => {
    const element = schoolScheduleTableRef.current;
    if (!element) return;
    const resizeObserver = new ResizeObserver(updateSchoolScheduleViewport);
    resizeObserver.observe(element);
    updateSchoolScheduleViewport();
    return () => resizeObserver.disconnect();
  }, [sortedSchoolItems.length, updateSchoolScheduleViewport]);
  useEffect(() => {
    const element = schoolScheduleTableRef.current;
    if (!element) return;
    element.scrollTop = 0;
    updateSchoolScheduleViewport();
  }, [schoolAffiliation, schoolCategory, schoolDepartment, schoolKeyword, schoolNature, schoolSchedule, schoolScheduleSort, updateSchoolScheduleViewport]);
  const toggleSchoolScheduleSort = (key: SchoolScheduleSortKey) => {
    setSchoolScheduleSort((current) =>
      current?.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  };
  const runSchoolSearch = () => {
    onSearchSchoolSchedule({
      termId: schoolTermId,
      forceRefresh: true,
    });
  };
  const displayedSchoolTerm = terms.find((term) => term.id === schoolSchedule?.scope.termId)?.label
    || schoolSchedule?.scope.termId
    || null;
  const schoolScheduleFreshness = schoolScheduleLoading && schoolSchedule
    ? "正在从教务更新，当前显示上次数据"
    : schoolScheduleRefreshFailed
      ? "更新失败，正在显示上次数据"
      : schoolSchedule?.fromCache === false
        ? `刚从教务更新${schoolSchedule.capturedAt ? ` · ${schoolScheduleUpdatedAt(schoolSchedule.capturedAt)}` : ""}`
        : schoolSchedule
          ? `本地数据，更新于 ${schoolScheduleUpdatedAt(schoolSchedule.capturedAt)}`
          : null;

  return (
    <div className="selection-page">
      <section className="selection-command">
        <div className="selection-command-head">
          <div>
            <span className="eyebrow">抢课计划</span>
            <h2>{active?.candidate?.title || active?.target?.title || "提前锁定目标"}</h2>
          </div>
          <div className="selection-command-actions">
            {active && <span className={`selection-status ${active.status}`}>{active.status}</span>}
            <button className="secondary-button" onClick={onDiscover} disabled={loading || activeJob}>
              <RefreshCw size={16} className={loading ? "spinning" : ""} />
              {portal ? "刷新选课批次" : "读取选课批次"}
            </button>
            <button
              className="primary-button selection-queue-start"
              onClick={() => onStart({ targets: persistedSchoolTargets, startAt: startAt ? new Date(startAt).toISOString() : null, endAt: endAt ? new Date(endAt).toISOString() : null, intervalMs, maxAttempts, concurrency })}
              disabled={!persistedSchoolTargets.length || loading || activeJob}
            >
              <Play size={16} /> {activeJob ? "抢课任务执行中" : `开始抢课（${persistedSchoolTargets.length}）`}
            </button>
            <button
              className={`secondary-button selection-sentinel-button ${sentinel.enabled ? "active" : ""}`}
              onClick={() => onSetSentinel(sentinel.enabled ? { enabled: false } : {
                enabled: true,
                startAt: startAt ? new Date(startAt).toISOString() : null,
                endAt: endAt ? new Date(endAt).toISOString() : null,
                intervalMs,
                concurrency,
              })}
              disabled={loading || (!sentinel.enabled && !persistedSchoolTargets.length)}
            >
              <ShieldCheck size={16} /> {sentinel.enabled ? "关闭哨兵" : "开启哨兵"}
            </button>
          </div>
        </div>
        <div className="selection-plan-grid">
          <article className={`selection-plan-target ${persistedSchoolTargets.length ? "ready" : ""}`}>
            <div className="selection-plan-target-icon"><Crosshair size={19} /></div>
            <div>
              <span>当前目标</span>
              <strong>{active?.candidate?.title || active?.target?.title || schoolTarget?.title || "尚未设定课程"}</strong>
              <small>
                {active?.candidate
                  ? [active.candidate.teacher, active.candidate.time, active.candidate.location].filter(Boolean).join(" · ")
                  : active?.target
                    ? [active.target.courseCode, active.target.className, active.target.teacher].filter(Boolean).join(" · ")
                  : selected
                    ? [selected.teacher, selected.time, selected.location].filter(Boolean).join(" · ")
                    : schoolTarget
                      ? [schoolTarget.courseCode, schoolTarget.className, schoolTarget.teacher].filter(Boolean).join(" · ")
                      : "从下方全校课表选择课程，目标会保存到本地"}
              </small>
            </div>
            {schoolTarget && !activeJob && (
              <button className="icon-button" aria-label="从抢课计划移除当前目标" data-tooltip="移除目标" onClick={() => onRemoveSchoolTarget(schoolTarget.id)}>
                <X size={14} />
              </button>
            )}
          </article>
          <div className="selection-plan-status" aria-label="抢课准备状态">
            <span className={persistedSchoolTargets.length ? "ready" : ""}><i />目标</span>
            <span className={portal?.available ? "ready" : ""}><i />批次</span>
            <span className={selected ? "ready" : ""}><i />教学班</span>
            <span className={activeJob ? "ready" : ""}><i />执行</span>
          </div>
        </div>
        <div className="selection-plan-live">
          <div className="selection-plan-queue" aria-label="抢课目标队列">
            <div className="selection-plan-queue-head">
              <span>抢课目标</span><small>{persistedSchoolTargets.length ? `${persistedSchoolTargets.length} 门课程将独立执行` : "从下方全校课表逐门加入"}</small>
            </div>
            {persistedSchoolTargets.length ? (
              <div className="data-table-wrap selection-plan-queue-table-wrap">
                <table className="data-table selection-plan-queue-table">
                  <thead><tr><th>课程 / 教学班</th><th>教师</th><th>学分</th><th>时间</th><th>教室</th><th>状态</th><th className="school-schedule-action-header">操作</th></tr></thead>
                  <tbody>{persistedSchoolTargets.map((target) => {
                    const job = (snapshot.jobs || []).find((item) => item.target?.id === target.id || item.candidate?.id === target.id);
                    return <tr key={target.id} className={schoolTarget?.id === target.id ? "selected" : ""}>
                      <td className="school-schedule-course-cell"><strong>{target.title}</strong><small>{[target.courseCode, target.className].filter(Boolean).join(" · ") || "--"}</small></td>
                      <td>{target.teacher || "--"}</td><td>{target.credits ?? "--"}</td><td>{target.time || "--"}</td><td>{target.location || "--"}</td>
                      <td><span className={job?.status === "selected" ? "seat-open" : job?.status === "exhausted" ? "seat-full" : ""}>{job?.status || "待命"}</span></td>
                      <td><button className="link-button" disabled={activeJob} onClick={() => onRemoveSchoolTarget(target.id)}>移除</button></td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
            ) : <div className="selection-plan-empty"><Crosshair size={17} /><span>先从下方全校课表将课程逐门加入抢课目标。</span></div>}
          </div>
          <aside className="selection-live-log" aria-live="polite" aria-label="实时抢课日志">
            <div className="selection-live-log-head"><span>实时抢课日志</span><small>{taskLogs.length ? `${taskLogs.length} 条` : "等待任务启动"}</small></div>
            <div className="selection-live-log-list">
              {taskLogs.length ? taskLogs.map((entry) => <div key={entry.id} className={`selection-live-log-entry ${entry.level}`}><time>{new Date(entry.at).toLocaleTimeString("zh-CN", { hour12: false })}</time><div><strong>{entry.course}</strong><span>{entry.message}</span></div></div>) : <div className="selection-live-log-empty">开始任务后，这里会显示实际 API 调用结果。</div>}
            </div>
          </aside>
        </div>
        <div className="selection-plan-controls">
          <label><span>开始时间</span><input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} onBlur={() => persistSelectionWindow()} /></label>
          <label><span>结束时间</span><input type="datetime-local" value={endAt} onChange={(event) => setEndAt(event.target.value)} onBlur={() => persistSelectionWindow()} /></label>
          <button className="secondary-button selection-calendar-time-button" type="button" onClick={applyAutomaticSelectionWindow} disabled={!automaticSelectionWindow} title={automaticSelectionWindow?.summary || "校历中没有可识别的选课时间"}>
            <CalendarDays size={16} /> 自动获取选课时间
          </button>
          <label><span>重试间隔（毫秒）</span><input type="number" min="1000" max="60000" step="500" value={intervalMs} onChange={(event) => setIntervalMs(Number(event.target.value))} /></label>
          <label><span>最多尝试次数</span><input type="number" min="1" max="300" value={maxAttempts} onChange={(event) => setMaxAttempts(Number(event.target.value))} /></label>
          <label><span>并发任务</span><input type="number" min="1" max="3" step="1" value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value))} /></label>
          {activeJob && <button className="danger-button" onClick={onStop}><X size={16} /> 停止全部任务</button>}
        </div>
        {portal?.available ? (
          <div className="selection-workbench">
            <section className="selection-catalog">
              <div className="selection-controls">
                <label>
                  <span>课程类别 / 选课模块</span>
                  <Select value={blockId} onValueChange={setBlockId}>
                    <SelectTrigger className="selection-module-select" disabled={loading || activeJob}>
                      <SelectValue placeholder="选择课程类别" />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {portal.blocks.map((block) => (
                        <SelectItem key={block.id} value={block.id}>{block.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <button
                  className="primary-button"
                  onClick={() => loadCandidatePage(1)}
                  disabled={loading || activeJob || !blockId}
                >
                  <Search size={16} /> 读取教学班
                </button>
              </div>
              {candidates.length ? (
                <div className="selection-catalog-results">
                  <div className="selection-catalog-toolbar">
                    <span>{candidateTotal} 门课程 · 第 {candidateCatalogPage.page} / {candidatePages} 页</span>
                    <label className="selection-catalog-filter">
                      <Search size={14} />
                      <input
                        value={candidateKeyword}
                        placeholder="筛选本页课程或教师"
                        onChange={(event) => setCandidateKeyword(event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="data-table-wrap selection-candidate-table-wrap">
                    <table className="data-table selection-table">
                      <thead>
                        <tr>
                          <th />
                          <th>课程 / 教学班</th>
                          <th>教师</th>
                          <th>时间地点</th>
                          <th>余量</th>
                          <th>学分</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleCandidates.map((candidate) => (
                          <tr
                            key={candidate.id}
                            className={candidate.id === candidateId ? "selected" : ""}
                            onClick={() => selectCandidate(candidate)}
                          >
                            <td>
                              <input
                                aria-label={`选择 ${candidate.title}`}
                                type="radio"
                                name="course-selection-candidate"
                                checked={candidate.id === candidateId}
                                onClick={(event) => event.stopPropagation()}
                                onChange={() => selectCandidate(candidate)}
                                disabled={activeJob}
                              />
                            </td>
                            <td>
                              <strong>{candidate.title}</strong>
                              <small>{[candidate.courseCode, candidate.className, candidate.classId || candidate.operationId].filter(Boolean).join(" · ")}</small>
                            </td>
                            <td>{candidate.teacher || "--"}</td>
                            <td><span>{candidate.time || "--"}</span><small>{candidate.location || "--"}</small></td>
                            <td>
                              {candidate.remainingSeats === null || candidate.remainingSeats === undefined
                                ? "--"
                                : <span className={candidate.remainingSeats > 0 ? "seat-open" : "seat-full"}>{candidate.remainingSeats} / {candidate.capacity ?? "--"}</span>}
                            </td>
                            <td>{candidate.credits ?? "--"}</td>
                          </tr>
                        ))}
                        {!visibleCandidates.length && (
                          <tr className="selection-filter-empty"><td colSpan={6}>本页没有符合筛选条件的教学班</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {candidatePages > 1 && (
                    <div className="selection-catalog-pagination" aria-label="抢课候选分页">
                      <div className="school-schedule-page-size">
                        <span>每页</span>
                        <Select value={String(candidateCatalogPage.pageSize)} onValueChange={(value) => loadCandidatePage(1, Number(value))}>
                          <SelectTrigger disabled={loading || activeJob}><SelectValue /></SelectTrigger>
                          <SelectContent position="popper">
                            {[24, 48, 96].map((pageSize) => <SelectItem key={pageSize} value={String(pageSize)}>{pageSize} 条</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="school-schedule-page-buttons">
                        <button className="icon-button" aria-label="上一页" data-tooltip="上一页" disabled={loading || activeJob || candidateCatalogPage.page <= 1} onClick={() => loadCandidatePage(candidateCatalogPage.page - 1)}><ChevronLeft size={16} /></button>
                        {paginationPages(candidateCatalogPage.page, candidatePages).map((page, index, pages) => (
                          <span className="school-schedule-page-group" key={page}>
                            {index > 0 && page - pages[index - 1] > 1 && <i>…</i>}
                            <button className={page === candidateCatalogPage.page ? "active" : ""} aria-current={page === candidateCatalogPage.page ? "page" : undefined} disabled={loading || activeJob} onClick={() => loadCandidatePage(page)}>{page}</button>
                          </span>
                        ))}
                        <button className="icon-button" aria-label="下一页" data-tooltip="下一页" disabled={loading || activeJob || candidateCatalogPage.page >= candidatePages} onClick={() => loadCandidatePage(candidateCatalogPage.page + 1)}><ChevronRight size={16} /></button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="selection-catalog-empty">
                  <BookOpen size={18} />
                  <span>选择模块后读取可选教学班</span>
                </div>
              )}
            </section>
            <aside className="selection-runner">
              {active ? (
                <div className="selection-active">
                  <div><span>开始时间</span><strong>{formatDate(active.startAt)}</strong></div>
                  <div><span>已尝试</span><strong>{active.attempts.length} / {active.maxAttempts}</strong></div>
                  <div><span>最新结果</span><strong>{active.lastMessage || "等待执行"}</strong></div>
                  {activeJob && <button className="danger-button" onClick={onStop}><X size={16} /> 停止任务</button>}
                  <div className="selection-attempts">
                    {active.attempts.slice(-5).reverse().map((attempt) => (
                      <div key={attempt.number}><span>{attempt.number}</span><strong>{attempt.success ? "成功" : "未选中"}</strong><small>{attempt.message}</small></div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="selection-form">
                  <div className="selection-target">
                    <span>目标教学班</span>
                    <strong>{persistedSchoolTargets.length ? `已锁定 ${persistedSchoolTargets.length} 门课程` : "尚未选择"}</strong>
                    <small>{persistedSchoolTargets.length ? "开放后会为每门课程独立定位教学班并抢课" : "先从下方全校课表加入抢课目标"}</small>
                  </div>
                  <label>
                    <span>开始时间</span>
                    <input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} onBlur={() => persistSelectionWindow()} />
                  </label>
                  <div className="selection-number-grid">
                    <label><span>重试间隔（毫秒）</span><input type="number" min="1000" max="60000" step="500" value={intervalMs} onChange={(event) => setIntervalMs(Number(event.target.value))} /></label>
                    <label><span>最多尝试次数</span><input type="number" min="1" max="300" value={maxAttempts} onChange={(event) => setMaxAttempts(Number(event.target.value))} /></label>
                  </div>
                  <button
                    className="primary-button selection-start"
                    onClick={() => onStart({ targets: persistedSchoolTargets, startAt: startAt ? new Date(startAt).toISOString() : null, endAt: endAt ? new Date(endAt).toISOString() : null, intervalMs, maxAttempts, concurrency })}
                    disabled={!persistedSchoolTargets.length || loading}
                  >
                    <Play size={16} /> 开始抢课
                  </button>
                </div>
              )}
            </aside>
          </div>
        ) : (
          <div className="selection-plan-empty">
            <BookOpen size={17} />
            <span>{portal ? portal.message || "当前没有开放的选课批次" : "选课批次尚未开放；可先在下方全校课表锁定课程"}</span>
          </div>
        )}
      </section>
      <section className="school-schedule-search">
        <div className="section-heading">
          <div>
            <span className="eyebrow">全校课表</span>
            <h2>先查课，再定位教学班</h2>
          </div>
          {schoolSchedule && <div className="school-schedule-heading-meta">
            <span>{visibleSchoolItems.length} / {schoolSchedule.total} 个教学班</span>
            {schoolScheduleFreshness && <small className={schoolScheduleLoading ? "syncing" : schoolScheduleRefreshFailed ? "failed" : schoolSchedule.fromCache === false ? "fresh" : "cached"}>
              {displayedSchoolTerm ? `${displayedSchoolTerm} · ` : ""}{schoolScheduleFreshness}
            </small>}
          </div>}
        </div>
        <div className="school-schedule-controls">
          <label>
            <span>学年</span>
            <Select value={schoolYear} onValueChange={setSchoolYear}>
              <SelectTrigger disabled={schoolScheduleLoading}>
                <SelectValue placeholder="选择学年" />
              </SelectTrigger>
              <SelectContent position="popper">
                {schoolYears.map((year) => <SelectItem key={year} value={year}>{year}-{Number(year) + 1}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label>
            <span>学期</span>
            <Select value={schoolTerm} onValueChange={setSchoolTerm}>
              <SelectTrigger disabled={schoolScheduleLoading || !schoolTerms.length}>
                <SelectValue placeholder="选择学期" />
              </SelectTrigger>
              <SelectContent position="popper">
                {schoolTerms.map((term) => {
                  const value = schoolTermParts(term.id).term;
                  return <SelectItem key={term.id} value={value}>{schoolTermLabel(value)}</SelectItem>;
                })}
              </SelectContent>
            </Select>
          </label>
          <label>
            <span>课程、教学班或合班信息</span>
            <input value={schoolKeyword} placeholder="例如：高等数学 / MAT13904T / 高材 2401" onChange={(event) => setSchoolKeyword(event.target.value)} />
          </label>
          <label>
            <span>开课部门</span>
            <Select value={schoolDepartment || "all"} onValueChange={(value) => setSchoolDepartment(value === "all" ? "" : value)}>
              <SelectTrigger disabled={schoolScheduleLoading}><SelectValue placeholder="全部部门" /></SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="all">全部部门</SelectItem>
                {schoolFilterOptions.departments.map((department) => <SelectItem key={department} value={department}>{department}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label>
            <span>课程类型</span>
            <Select
              value={schoolCategory || "all"}
              onValueChange={(value) => setSchoolCategory(value === "all" ? "" : value)}
            >
              <SelectTrigger disabled={schoolScheduleLoading}>
                <SelectValue placeholder="全部类型" />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="all">全部类型</SelectItem>
                {schoolFilterOptions.categories.map((category) => (
                  <SelectItem key={category} value={category}>{category}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label>
            <span>课程性质</span>
            <Select value={schoolNature || "all"} onValueChange={(value) => setSchoolNature(value === "all" ? "" : value)}>
              <SelectTrigger disabled={schoolScheduleLoading}><SelectValue placeholder="全部性质" /></SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="all">全部性质</SelectItem>
                {schoolFilterOptions.natures.map((nature) => <SelectItem key={nature} value={nature}>{nature}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label>
            <span>课程归属</span>
            <Select value={schoolAffiliation || "all"} onValueChange={(value) => setSchoolAffiliation(value === "all" ? "" : value)}>
              <SelectTrigger disabled={schoolScheduleLoading}><SelectValue placeholder="全部归属" /></SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="all">全部归属</SelectItem>
                {schoolFilterOptions.affiliations.map((affiliation) => <SelectItem key={affiliation} value={affiliation}>{affiliation}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <button
            className="secondary-button school-schedule-load-button"
            disabled={!schoolTermId || schoolScheduleLoading}
            onClick={runSchoolSearch}
          >
            <RefreshCw size={16} className={schoolScheduleLoading ? "spinning" : ""} /> {schoolSchedule ? "更新本学期课表" : "读取本学期课表"}
          </button>
        </div>
        {sortedSchoolItems.length ? (
          <div className="school-schedule-results">
            <div
              className="data-table-wrap school-schedule-table-wrap"
              ref={schoolScheduleTableRef}
              onScroll={updateSchoolScheduleViewport}
            >
              <table className="data-table school-schedule-table">
                <thead>
                  <tr>
                    {schoolScheduleColumns.map((column) => {
                      const activeSort = schoolScheduleSort?.key === column.key;
                      return (
                        <th
                          key={column.key}
                          aria-sort={
                            activeSort
                              ? schoolScheduleSort.direction === "asc" ? "ascending" : "descending"
                              : "none"
                          }
                        >
                          <button
                            className={`school-schedule-sort ${activeSort ? "active" : ""}`}
                            onClick={() => toggleSchoolScheduleSort(column.key)}
                          >
                            <span>{column.label}</span>
                            {activeSort ? (
                              schoolScheduleSort.direction === "asc" ? <ChevronUp size={13} /> : <ChevronDown size={13} />
                            ) : (
                              <ArrowDownUp size={12} />
                            )}
                          </button>
                        </th>
                      );
                    })}
                    <th className="school-schedule-action-header">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {schoolScheduleRange.start > 0 && (
                    <tr className="school-schedule-virtual-spacer" aria-hidden="true">
                      <td colSpan={schoolScheduleColumns.length + 1} style={{ height: schoolScheduleRange.start * SCHOOL_SCHEDULE_ROW_HEIGHT }} />
                    </tr>
                  )}
                  {virtualSchoolItems.map((item) => (
                    <tr key={item.id} className={schoolTarget?.id === item.id ? "selected" : ""}>
                      <td className="school-schedule-course-cell">
                        <strong>{item.title}</strong>
                        <small>{item.courseCode || "--"}</small>
                      </td>
                      <td className="school-schedule-clamped-cell" title={item.className || undefined}><span>{item.className || "--"}</span></td>
                      <td className="school-schedule-clamped-cell" title={item.combinedClassInfo || undefined}><span>{item.combinedClassInfo || "--"}</span></td>
                      <td>{item.department || "--"}</td>
                      <td>{item.teacher || "--"}</td>
                      <td>{item.credits ?? "--"}</td>
                      <td>{item.category || "--"}</td>
                      <td>{item.nature || "--"}</td>
                      <td>{item.affiliation || "--"}</td>
                      <td>{item.time || "--"}</td>
                      <td>{item.location || "--"}</td>
                      <td>{item.status || "--"}</td>
                      <td>
                        <button className="link-button" onClick={() => saveSchoolTarget(item)}>
                          {schoolTarget?.id === item.id ? "已作为目标" : "设为目标"}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {schoolScheduleRange.end < sortedSchoolItems.length && (
                    <tr className="school-schedule-virtual-spacer" aria-hidden="true">
                      <td colSpan={schoolScheduleColumns.length + 1} style={{ height: (sortedSchoolItems.length - schoolScheduleRange.end) * SCHOOL_SCHEDULE_ROW_HEIGHT }} />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : schoolSchedule ? (
          <EmptyState icon={BookOpen} title="没有匹配的教学班" detail="可更换课程关键字、教师、课程类型或学期后重新查询" />
        ) : null}
      </section>
      <Dialog open={Boolean(schoolScheduleError)} onOpenChange={(open) => { if (!open) onDismissSchoolScheduleError(); }}>
        {schoolScheduleError && <DialogContent className="school-schedule-error-dialog" overlayClassName="sync-error-dialog-overlay" showCloseButton={false}>
          <DialogHeader className="school-schedule-error-heading">
            <CircleAlert size={20} />
            <div>
              <DialogTitle>课表更新失败</DialogTitle>
              <DialogDescription>
                {schoolSchedule ? "上次读取的课表仍然可以查看。" : "暂时没有可显示的课表。"}
              </DialogDescription>
            </div>
          </DialogHeader>
          <p className="school-schedule-error-detail">{schoolScheduleError}</p>
          <DialogFooter>
            <button type="button" className="secondary-button" onClick={onDismissSchoolScheduleError}>
              {schoolSchedule ? "继续使用上次数据" : "关闭"}
            </button>
            <button type="button" className="primary-button" onClick={() => { onDismissSchoolScheduleError(); runSchoolSearch(); }}>
              <RefreshCw size={15} /> 再次更新
            </button>
          </DialogFooter>
        </DialogContent>}
      </Dialog>
    </div>
  );
}
