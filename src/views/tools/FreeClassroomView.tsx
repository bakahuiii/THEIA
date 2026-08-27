import { useEffect, useMemo, useState } from "react";
import { Building2, CalendarDays, Check, LoaderCircle, Search } from "lucide-react";
import { bridge } from "../../bridge";
import { EmptyState, formatDate, type Term } from "../../ui/app-shared";
import type { AcademicExtraRecord, CampusState } from "../../types";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];
const PERIODS = Array.from({ length: 12 }, (_item, index) => index + 1);
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

function todayWeekday() {
  const day = new Date().getDay();
  return day === 0 ? 7 : day;
}

function weekForDate(state: CampusState, termId: string, date: string) {
  const code = String(termId).split("-")[1];
  const semesterIndex = code === "12" ? 1 : code === "16" ? 2 : 0;
  const semester = state.dataCatalog.collections.academicCalendar.calendar?.semesters?.[semesterIndex];
  if (!semester?.startDate) return null;
  const start = new Date(`${semester.startDate}T12:00:00`);
  const target = new Date(`${date}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(target.getTime())) return null;
  const days = Math.floor((target.getTime() - start.getTime()) / 86_400_000);
  return Math.max(1, Math.min(25, Math.floor(days / 7) + 1));
}

export function FreeClassroomView({ state, terms, onOpenSource }: { state: CampusState; terms: Term[]; onOpenSource: (url: string) => void }) {
  const domain = state.academicExtras?.domains?.["free-classroom"];
  const [termId, setTermId] = useState(terms[0]?.id || "");
  const [date, setDate] = useState("");
  const [week, setWeek] = useState(1);
  const [weekdays, setWeekdays] = useState<number[]>([todayWeekday()]);
  const [periods, setPeriods] = useState<number[]>([1, 2]);
  const [campus, setCampus] = useState("");
  const [building, setBuilding] = useState("");
  const [classroomType, setClassroomType] = useState("");
  const [minSeats, setMinSeats] = useState("");
  const [maxSeats, setMaxSeats] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!terms.some((term) => term.id === termId)) setTermId(terms[0]?.id || "");
  }, [termId, terms]);

  const records = useMemo(() => domain?.records || [], [domain]);
  const toggle = (values: number[], next: number) => values.includes(next) ? values.filter((value) => value !== next) : [...values, next].sort((left, right) => left - right);
  const chooseDate = (next: string) => {
    setDate(next);
    if (!next) return;
    const parsed = new Date(`${next}T12:00:00`);
    if (!Number.isNaN(parsed.getTime())) {
      const weekday = parsed.getDay() === 0 ? 7 : parsed.getDay();
      setWeekdays([weekday]);
      const derivedWeek = weekForDate(state, termId, next);
      if (derivedWeek) setWeek(derivedWeek);
    }
  };

  const campusOptions = useMemo(() => domain?.options?.xqh_id || [], [domain]);
  const buildingOptions = useMemo(() => domain?.options?.lh || [], [domain]);
  const typeOptions = useMemo(() => domain?.options?.cdlb_id || [], [domain]);

  const query = async () => {
    if (!termId || !weekdays.length || !periods.length) return;
    setLoading(true);
    setError(null);
    try {
      await bridge.queryFreeClassrooms({
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "空闲教室查询失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="free-classroom-view">
      <header className="free-classroom-header">
        <div><span className="free-classroom-kicker">JWGLXT · READ ONLY</span><h2>空闲教室</h2><p>按教务系统的周次、星期和节次查询，不再使用页面默认条件。</p></div>
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
        <fieldset className="free-classroom-choice-group"><legend>节次</legend><div className="free-classroom-choice-list period-list">{PERIODS.map((value) => { const checked = periods.includes(value); return <label className={checked ? "selected" : ""} key={value}><input type="checkbox" checked={checked} onChange={() => setPeriods((current) => toggle(current, value))} /><span>{value}</span>{checked && <Check size={12} aria-hidden="true" />}</label>; })}</div></fieldset>
        <div className="free-classroom-query-actions"><small>选择日期后会自动勾选对应星期；也可以直接多选星期和节次。</small><button type="button" className="primary-button" onClick={() => void query()} disabled={loading || !termId || !weekdays.length || !periods.length}>{loading ? <LoaderCircle size={15} className="spinning" /> : <Search size={15} />}{loading ? "查询中" : "查询空闲教室"}</button></div>
        {error && <p className="free-classroom-error" role="alert">{error}</p>}
      </section>
      <section className="free-classroom-results" aria-label="空闲教室结果">
        <div className="free-classroom-results-head"><div><strong>查询结果</strong><small>{domain?.capturedAt ? `最近查询 ${formatDate(domain.capturedAt)}` : "尚未查询"}</small></div>{domain?.sourceUrl && <button type="button" className="academic-records-source" onClick={() => onOpenSource(domain.sourceUrl || "")}><Building2 size={13} />来源页面</button>}</div>
        {records.length ? <div className="free-classroom-table-wrap"><table className="free-classroom-table"><thead><tr><th>教室</th><th>校区</th><th>教学楼</th><th>类别</th><th>座位</th></tr></thead><tbody>{records.map((record) => <tr key={record.id}><td><strong>{field(record, ["classroom", "cdmc", "cdbh", "room"])}</strong></td><td>{field(record, ["campus", "xqmc", "xiaoqu"])}</td><td>{field(record, ["jxlmc", "building", "lh", "教学楼"])}</td><td>{field(record, ["classroomType", "cdlbmc", "cdlb_id"])}</td><td>{field(record, ["capacity", "zws", "qszws"])}</td></tr>)}</tbody></table></div> : <EmptyState icon={CalendarDays} title="请选择条件后查询" detail="教务系统只会在点击查询后返回与当前筛选对应的空闲教室。" />}
      </section>
    </div>
  );
}
