import {
  BookOpen,
  CalendarDays,
  Crosshair,
  Play,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bridge } from "../bridge";
import { formatClock, formatDate, localDateTimeInstant, localDateTimeValue, parseLocalDateTime, type Term } from "../ui/app-shared";
import type {
  AdvisorCourseDecision,
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
import { CandidateCatalog } from "./course-selection/CandidateCatalog";
import { SchoolSchedulePanel } from "./course-selection/SchoolSchedulePanel";
import {
  advisorCandidateRecord,
  type SelectionOptions,
} from "./course-selection/selection-helpers";

export function CourseSelectionView({
  portal,
  candidates,
  candidateCatalogPage,
  advisorSnapshotRevision,
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
  advisorSnapshotRevision: string | null;
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
    target: SchoolScheduleItem | null,
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
  const [endAt, setEndAt] = useState(() => localDateTimeValue(new Date(Date.now() + 2 * 60 * 60 * 1000)));
  const [intervalMs, setIntervalMs] = useState(1500);
  const [maxAttempts, setMaxAttempts] = useState(120);
  const [concurrency, setConcurrency] = useState(2);
  const [candidateKeyword, setCandidateKeyword] = useState("");
  const [advisorDecisions, setAdvisorDecisions] = useState<AdvisorCourseDecision[]>([]);
  const [advisorDecisionInputKey, setAdvisorDecisionInputKey] = useState("");
  const [advisorDecisionRevision, setAdvisorDecisionRevision] = useState("");
  const [advisorDecisionLoading, setAdvisorDecisionLoading] = useState(false);
  const [advisorDecisionError, setAdvisorDecisionError] = useState(false);
  const [advisorDecisionRetry, setAdvisorDecisionRetry] = useState(0);
  const advisorDecisionRequest = useRef(0);
  const persistedSchoolTargets = useMemo<SchoolScheduleItem[]>(() => (snapshot.targets || [snapshot.target].filter(Boolean))
    .filter((target): target is CourseSelectionTarget => Boolean(target?.title))
    .map((target) => ({
      id: target.id || `course-selection-target:${target.termId || "unknown"}:${target.courseCode || target.title}`,
      termId: target.termId || "", classId: target.classId || null,
      courseId: target.courseId || target.courseCode || null,
      categoryCode: target.categoryCode || null,
      jxbzls: target.jxbzls || null,
      selectionContext: target.selectionContext || null,
      courseCode: target.courseCode || null, title: target.title,
      className: target.className || null, teacher: target.teacher || null, time: target.time || null,
      location: target.location || null, credits: target.credits ?? null,
    })), [snapshot.target, snapshot.targets]);
  const [schoolTarget, setSchoolTarget] = useState<SchoolScheduleItem | null>(null);
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
  const taskLogs = useMemo(() => {
    const jobs = snapshot.jobs || [];
    const currentJobIds = new Set(jobs.map((job) => job.id));
    const live = jobs.flatMap((job) => (job.logs || []).map((entry, index) => ({
      ...entry,
      id: `${job.id}:${entry.at}:${index}`,
      course: job.candidate?.title || job.target?.title || "抢课任务",
    })));
    const persisted = (snapshot.history || [])
      .filter((entry) => !entry.jobId || !currentJobIds.has(entry.jobId))
      .flatMap((entry) => entry.logs.map((log, index) => ({
        ...log,
        id: `${entry.jobId || entry.at}:${log.at}:${index}`,
        course: entry.candidate?.title || "抢课任务",
      })));
    return [...live, ...persisted].sort((left, right) => right.at.localeCompare(left.at));
  }, [snapshot.history, snapshot.jobs]);
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
      courseId: candidate.courseId || null,
      categoryCode: candidate.categoryCode || null,
      jxbzls: candidate.jxbzls || null,
      selectionContext: candidate.selectionContext || null,
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
    const start = parseLocalDateTime(nextStart);
    const end = parseLocalDateTime(nextEnd);
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
  const advisorCandidateInput = useMemo(
    () => candidates.map(advisorCandidateRecord),
    [candidates],
  );
  const advisorCandidateInputKey = useMemo(
    () => JSON.stringify(advisorCandidateInput),
    [advisorCandidateInput],
  );
  const advisorDecisionsCurrent =
    Boolean(advisorSnapshotRevision && advisorDecisionInputKey) &&
    advisorDecisionInputKey === advisorCandidateInputKey &&
    advisorDecisionRevision === advisorSnapshotRevision;
  const loadCandidatePage = (
    page = 1,
    pageSize = candidateCatalogPage.pageSize,
  ) => {
    if (!blockId) return;
    onLoadCandidates(
      blockId,
      schoolTarget,
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
    const requestId = ++advisorDecisionRequest.current;
    setAdvisorDecisions([]);
    setAdvisorDecisionInputKey("");
    setAdvisorDecisionRevision("");
    if (!candidates.length || !advisorSnapshotRevision) {
      setAdvisorDecisionLoading(false);
      setAdvisorDecisionError(false);
      return;
    }

    setAdvisorDecisionLoading(true);
    setAdvisorDecisionError(false);
    void (async () => {
      try {
        const result = await bridge.getAdvisorCourseDecisions({
          snapshotRevision: advisorSnapshotRevision,
          candidates: advisorCandidateInput,
        });
        if (advisorDecisionRequest.current !== requestId) return;
        if (result.snapshotRevision !== advisorSnapshotRevision) {
          setAdvisorDecisionError(true);
          return;
        }
        setAdvisorDecisions(result.decisions);
        setAdvisorDecisionInputKey(advisorCandidateInputKey);
        setAdvisorDecisionRevision(advisorSnapshotRevision);
      } catch {
        if (advisorDecisionRequest.current !== requestId) return;
        setAdvisorDecisions([]);
        setAdvisorDecisionInputKey("");
        setAdvisorDecisionRevision("");
        setAdvisorDecisionError(true);
      } finally {
        if (advisorDecisionRequest.current === requestId) {
          setAdvisorDecisionLoading(false);
        }
      }
    })();
  }, [advisorCandidateInput, advisorCandidateInputKey, advisorDecisionRetry, advisorSnapshotRevision, candidates.length]);
  useEffect(() => {
    if (!schoolTarget || !candidates.length) return;
    const matched = candidates.find((candidate) =>
      (schoolTarget.courseCode && candidate.courseCode === schoolTarget.courseCode) ||
      candidate.title === schoolTarget.title,
    );
    if (matched) setCandidateId(matched.id);
  }, [candidates, schoolTarget]);
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
              onClick={() => onStart({ targets: persistedSchoolTargets, startAt: localDateTimeInstant(startAt), endAt: localDateTimeInstant(endAt), intervalMs, maxAttempts, concurrency })}
              disabled={!persistedSchoolTargets.length || loading || activeJob}
            >
              <Play size={16} /> {activeJob ? "抢课任务执行中" : `开始抢课（${persistedSchoolTargets.length}）`}
            </button>
            <button
              className={`secondary-button selection-sentinel-button ${sentinel.enabled ? "active" : ""}`}
              onClick={() => onSetSentinel(sentinel.enabled ? { enabled: false } : {
                enabled: true,
                startAt: localDateTimeInstant(startAt),
                endAt: localDateTimeInstant(endAt),
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
            <div className="selection-live-log-head"><span>抢课日志</span><small>{taskLogs.length ? `${taskLogs.length} 条` : "等待任务启动"}</small></div>
            <div className="selection-live-log-list">
              {taskLogs.length ? taskLogs.map((entry) => <div key={entry.id} className={`selection-live-log-entry ${entry.level}`}><time>{formatClock(entry.at, true)}</time><div><strong>{entry.course}</strong><span>{entry.message}</span></div></div>) : <div className="selection-live-log-empty">开始任务后，这里会显示实际 API 调用结果，并在重启后保留最近任务记录。</div>}
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
            <CandidateCatalog
              portal={portal}
              blockId={blockId}
              candidates={candidates}
              candidateCatalogPage={candidateCatalogPage}
              candidateId={candidateId}
              candidateKeyword={candidateKeyword}
              advisorDecisions={advisorDecisions}
              advisorDecisionsCurrent={advisorDecisionsCurrent}
              advisorDecisionLoading={advisorDecisionLoading}
              advisorDecisionError={advisorDecisionError}
              loading={loading}
              activeJob={activeJob}
              onBlockChange={setBlockId}
              onCandidateKeywordChange={setCandidateKeyword}
              onRetryAdvisor={() => setAdvisorDecisionRetry((value) => value + 1)}
              onSelectCandidate={selectCandidate}
              onLoadCandidatePage={loadCandidatePage}
            />
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
                    onClick={() => onStart({ targets: persistedSchoolTargets, startAt: localDateTimeInstant(startAt), endAt: localDateTimeInstant(endAt), intervalMs, maxAttempts, concurrency })}
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
      <SchoolSchedulePanel
        schoolSchedule={schoolSchedule}
        schoolScheduleLoading={schoolScheduleLoading}
        schoolScheduleError={schoolScheduleError}
        schoolScheduleRefreshFailed={schoolScheduleRefreshFailed}
        terms={terms}
        preferredTermId={portal?.term.id || null}
        schoolTarget={schoolTarget}
        onSearchSchoolSchedule={onSearchSchoolSchedule}
        onDismissSchoolScheduleError={onDismissSchoolScheduleError}
        onSaveSchoolTarget={saveSchoolTarget}
      />
    </div>
  );
}
