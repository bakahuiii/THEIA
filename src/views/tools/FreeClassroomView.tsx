import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Building2, CalendarDays, Check, LoaderCircle, Search } from "lucide-react";
import { bridge } from "../../bridge";
import { filterOccupiedFreeClassrooms } from "../../../core/free-classroom-filter.mjs";
import { EmptyState, formatDate, type Term } from "../../ui/app-shared";
import { currentAcademicWeek, currentShanghaiDate, currentShanghaiWeekday } from "../../ui/calendar";
import type { AcademicExtraRecord, CampusState } from "../../types";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const WEEKS = Array.from({ length: 25 }, (_item, index) => index + 1);

function field(record: AcademicExtraRecord, names: string[]) {
  for (const name of names) {
    const direct = record[name];
    if (direct !== undefined && direct !== null && direct !== "") return String(direct);
    const entry = record.fields?.find((item) => String(item.name || "") === name || String(item.label || "") === name);
    if (entry?.value !== undefined && entry.value !== null && entry.value !== "") return String(entry.value);
  }
  return "--";
}

function parseShanghaiDate(value: string) {
  const date = new Date(`${value}T12:00:00+08:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function FreeClassroomView({ state, terms, onOpenSource }: { state: CampusState; terms: Term[]; onOpenSource: (url: string) => void }) {
  const calendar = state.dataCatalog.collections.academicCalendar.calendar;
  const today = currentShanghaiDate();
  const todayAcademicWeek = currentAcademicWeek(calendar, parseShanghaiDate(today) || new Date());
  const todayTermId = todayAcademicWeek?.termId && terms.some((term) => term.id === todayAcademicWeek.termId)
    ? todayAcademicWeek.termId
    : terms[0]?.id || "";
  const [termId, setTermId] = useState(todayTermId);
  const [date, setDate] = useState(today);
  const [week, setWeek] = useState(todayAcademicWeek?.week || 1);
  const [weekdays, setWeekdays] = useState<number[]>([currentShanghaiWeekday()]);
  const [periodInput, setPeriodInput] = useState("");
  const [campus, setCampus] = useState("");
  const [building, setBuilding] = useState("");
  const [classroomType, setClassroomType] = useState("");
  const [minSeats, setMinSeats] = useState("");
  const [maxSeats, setMaxSeats] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [querySnapshot, setQuerySnapshot] = useState<CampusState | null>(null);
  const [lastQueryKey, setLastQueryKey] = useState<string | null>(null);
  const initialQueryStarted = useRef(false);
  const automaticSelectionReady = useRef(Boolean(
    todayAcademicWeek?.termId && terms.some((term) => term.id === todayAcademicWeek.termId),
  ));

  const periods = useMemo(() => {
    const value = Number(periodInput);
    return Number.isInteger(value) && value >= 1 && value <= 32 ? [value] : [];
  }, [periodInput]);

  const queryKey = useMemo(() => JSON.stringify({
    termId,
    date,
    week,
    weekdays: [...weekdays],
    periods: [...periods],
    campus,
    building,
    classroomType,
    minSeats,
    maxSeats,
  }), [building, campus, classroomType, date, maxSeats, minSeats, periods, termId, week, weekdays]);
  const stateDomain = state.academicExtras?.domains?.["free-classroom"];
  // A persisted free-classroom domain belongs to an earlier query. Hide it
  // until the current controls have produced a matching result.
  const domain = lastQueryKey === queryKey
    ? querySnapshot?.academicExtras?.domains?.["free-classroom"]
    : null;
  const optionDomain = querySnapshot?.academicExtras?.domains?.["free-classroom"] || stateDomain;

  useEffect(() => {
    if (!terms.some((term) => term.id === termId)) setTermId(terms[0]?.id || "");
  }, [termId, terms]);

  const filteredResult = useMemo(() => filterOccupiedFreeClassrooms(
    domain?.records || [],
    querySnapshot?.schedule || state.schedule,
    { termId, weeks: [week], weekdays, periods },
  ), [domain, periods, querySnapshot?.schedule, state.schedule, termId, week, weekdays]);
  const records = filteredResult.records;
  const toggle = (values: number[], next: number) => values.includes(next) ? values.filter((value) => value !== next) : [...values, next].sort((left, right) => left - right);
  const chooseDate = (next: string) => {
    setDate(next);
    if (!next) return;
    const parsed = parseShanghaiDate(next);
    if (!parsed) return;
    setWeekdays([currentShanghaiWeekday(parsed)]);
    const derivedWeek = currentAcademicWeek(calendar, parsed);
    if (!derivedWeek) return;
    setWeek(derivedWeek.week);
    if (derivedWeek.termId && terms.some((term) => term.id === derivedWeek.termId)) setTermId(derivedWeek.termId);
  };

  const campusOptions = useMemo(() => optionDomain?.options?.xqh_id || [], [optionDomain]);
  const buildingOptions = useMemo(() => optionDomain?.options?.lh || [], [optionDomain]);
  const typeOptions = useMemo(() => optionDomain?.options?.cdlb_id || [], [optionDomain]);

  const query = useCallback(async () => {
    if (!termId || !weekdays.length || !periods.length) return;
    setLoading(true);
    setError(null);
    try {
      const snapshot = await bridge.queryFreeClassrooms({
        termId,
        date: date || undefined,
        weeks: [week],
        weekdays,
        periods,
        campus: campus || undefined,
        building: building || undefined,
        classroomType: classroomType || undefined,
        minSeats: minSeats ? Number(minSeats) : undefined,
        maxSeats: maxSeats ? Number(maxSeats) : undefined,
      });
      setQuerySnapshot(snapshot);
      setLastQueryKey(queryKey);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "空闲教室查询失败");
    } finally {
      setLoading(false);
    }
  }, [building, campus, classroomType, date, maxSeats, minSeats, periods, queryKey, termId, week, weekdays]);

  useEffect(() => {
    if (automaticSelectionReady.current || !calendar || !todayAcademicWeek) return;
    automaticSelectionReady.current = true;
    setDate(today);
    setWeek(todayAcademicWeek.week);
    setWeekdays([currentShanghaiWeekday()]);
    if (todayAcademicWeek.termId && terms.some((term) => term.id === todayAcademicWeek.termId)) setTermId(todayAcademicWeek.termId);
  }, [calendar, terms, today, todayAcademicWeek]);

  useEffect(() => {
    if (!termId || initialQueryStarted.current || !automaticSelectionReady.current) return;
    initialQueryStarted.current = true;
    void query();
  }, [query, termId]);

  return (
    <div className="free-classroom-view">
      <header className="free-classroom-header">
        <div><span className="free-classroom-kicker">JWGLXT · READ ONLY</span><h2>空闲教室</h2><p>先按当天周次和星期定位，再按输入的节次查询。</p></div>
        <div className="free-classroom-result-count"><strong>{records.length}</strong><span>个结果</span></div>
      </header>
      <section className="free-classroom-query" aria-label="空闲教室查询条件">
        <div className="free-classroom-form-grid">
          <label><span>学期</span><select value={termId} onChange={(event) => setTermId(event.target.value)}><option value="">请选择学期</option>{terms.map((term) => <option key={term.id} value={term.id}>{term.label}</option>)}</select></label>
          <label><span>日期</span><input type="date" value={date} onChange={(event) => chooseDate(event.target.value)} /></label>
          <label><span>周次</span><select value={week} onChange={(event) => setWeek(Number(event.target.value))}>{WEEKS.map((item) => <option key={item} value={item}>第 {item} 周</option>)}</select></label>
          <label><span>校区（可选）</span><select value={campus} onChange={(event) => setCampus(event.target.value)}><option value="">全部校区</option>{campusOptions.map((option) => <option key={option.value ?? option.label} value={option.value ?? ""}>{option.label ?? option.value}</option>)}</select></label>
          <label><span>教学楼（可选）</span><select value={building} onChange={(event) => setBuilding(event.target.value)}><option value="">全部教学楼</option>{buildingOptions.map((option) => <option key={option.value ?? option.label} value={option.value ?? ""}>{option.label ?? option.value}</option>)}</select></label>
          <label><span>教室类别（可选）</span><select value={classroomType} onChange={(event) => setClassroomType(event.target.value)}><option value="">全部类别</option>{typeOptions.map((option) => <option key={option.value ?? option.label} value={option.value ?? ""}>{option.label ?? option.value}</option>)}</select></label>
          <label><span>最少座位（可选）</span><input type="number" min="0" max="500" value={minSeats} onChange={(event) => setMinSeats(event.target.value)} /></label>
          <label><span>最多座位（可选）</span><input type="number" min="0" max="500" value={maxSeats} onChange={(event) => setMaxSeats(event.target.value)} /></label>
        </div>
        <fieldset className="free-classroom-choice-group"><legend>星期</legend><div className="free-classroom-choice-list">{WEEKDAYS.map((label, index) => { const value = index + 1; const checked = weekdays.includes(value); return <label className={checked ? "selected" : ""} key={value}><input type="checkbox" checked={checked} onChange={() => setWeekdays((current) => toggle(current, value))} /><span>{label}</span>{checked && <Check size={12} aria-hidden="true" />}</label>; })}</div></fieldset>
        <label className="free-classroom-period-input"><span>节次（输入 1-32）</span><input type="number" min="1" max="32" step="1" inputMode="numeric" value={periodInput} onChange={(event) => setPeriodInput(event.target.value)} /></label>
        <div className="free-classroom-query-actions"><small>今天已自动选中当前周次和星期；查询只使用你输入的这一节。</small><button type="button" className="primary-button" onClick={() => void query()} disabled={loading || !termId || !weekdays.length || !periods.length}>{loading ? <LoaderCircle size={15} className="spinning" /> : <Search size={15} />}{loading ? "查询中" : "查询空闲教室"}</button></div>
        {error && <p className="free-classroom-error" role="alert">{error}</p>}
      </section>
      <section className="free-classroom-results" aria-label="空闲教室结果">
        <div className="free-classroom-results-head"><div><strong>查询结果</strong><small>{domain?.capturedAt ? `最近查询 ${formatDate(domain.capturedAt)}` : "尚未查询"}{filteredResult.excludedCount ? ` · 已排除 ${filteredResult.excludedCount} 间课表占用教室` : ""}</small></div>{domain?.sourceUrl && <button type="button" className="academic-records-source" onClick={() => onOpenSource(domain.sourceUrl || "")}><Building2 size={13} />来源页面</button>}</div>
        {records.length ? <div className="free-classroom-table-wrap"><table className="free-classroom-table"><thead><tr><th>教室</th><th>校区</th><th>教学楼</th><th>类别</th><th>座位</th></tr></thead><tbody>{records.map((record) => <tr key={record.id}><td><strong>{field(record, ["classroom", "cdmc", "cdbh", "room"])}</strong></td><td>{field(record, ["campus", "xqmc", "xiaoqu"])}</td><td>{field(record, ["jxlmc", "building", "lh", "教学楼"])}</td><td>{field(record, ["classroomType", "cdlbmc", "cdlb_id"])}</td><td>{field(record, ["capacity", "zws", "qszws"])}</td></tr>)}</tbody></table></div> : <EmptyState icon={CalendarDays} title="请选择条件后查询" detail="教务系统只会在点击查询后返回与当前筛选对应的空闲教室。" />}
      </section>
    </div>
  );
}
