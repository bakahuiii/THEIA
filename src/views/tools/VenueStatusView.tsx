import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  MapPin,
  RefreshCw,
  Search,
} from "lucide-react";
import { bridge } from "../../bridge";
import { EmptyState } from "../../ui/app-shared";
import type { LocalDataCatalog, MotionVenueStatus } from "../../types";

const STATE_LABELS: Record<string, string> = {
  available: "可预约",
  occupied: "已占用",
  closed: "闭馆",
  expired: "已过期",
  selected: "已选定",
  unknown: "未知",
};

const TIME_RANGE_LABEL = /^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/;

function stateLabel(value: string) {
  return STATE_LABELS[value] || value || "未知";
}

function capturedLabel(value?: string | null) {
  if (!value) return "尚未查询";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

function countStates(status: MotionVenueStatus | null) {
  const values = status?.availability?.summary?.byState;
  if (!values || typeof values !== "object") return [];
  return Object.entries(values).filter(([, count]) => Number(count) > 0);
}

export function VenueStatusView({ dataCatalog }: { dataCatalog: LocalDataCatalog }) {
  const catalog = dataCatalog.collections.venueReservations;
  const [campusId, setCampusId] = useState("");
  const [activity, setActivity] = useState("");
  const [venueId, setVenueId] = useState("");
  const [date, setDate] = useState("");
  const [venue, setVenue] = useState("");
  const [status, setStatus] = useState<MotionVenueStatus | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoRefreshAttempted = useRef(false);
  const restoredCachedStatus = useRef(false);
  const userChangedQuery = useRef(false);
  const cachedStatus = useMemo(
    () => Object.values(catalog.statuses)[0]?.result || null,
    [catalog.statuses],
  );

  const venues = useMemo(
    () => catalog.venues.filter((item) => (!campusId || item.campusId === campusId) && (!activity || item.activity === activity)),
    [activity, campusId, catalog.venues],
  );
  const activities = useMemo(
    () => [...new Set(catalog.venues.filter((item) => !campusId || item.campusId === campusId).map((item) => item.activity))].sort((left, right) => left.localeCompare(right, "zh-CN")),
    [campusId, catalog.venues],
  );
  const selectedVenue = venues.find((item) => item.id === venueId) || venues[0] || null;
  const activeDetailUrl = selectedVenue?.detailUrl || status?.query.detailUrl || "";
  const cachedDetailStatus = useMemo(
    () => Object.values(catalog.statuses)
      .map((record) => record.result)
      .find((result) => result.query.detailUrl === activeDetailUrl) || null,
    [activeDetailUrl, catalog.statuses],
  );
  const optionStatus = status?.query.detailUrl === activeDetailUrl ? status : cachedDetailStatus;
  const dateOptions = optionStatus?.query.availableDates || [];
  const venueOptions = optionStatus?.query.availableVenues || [];
  const counts = countStates(status);

  useEffect(() => {
    if (autoRefreshAttempted.current || catalog.venues.length || catalog.lastRefreshedAt) return;
    autoRefreshAttempted.current = true;
    let cancelled = false;
    setCatalogLoading(true);
    setError(null);
    void bridge.refreshMotionVenueCatalog()
      .then(() => undefined)
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "场馆目录读取失败"); })
      .finally(() => { if (!cancelled) setCatalogLoading(false); });
    return () => { cancelled = true; };
  }, [catalog.lastRefreshedAt, catalog.venues.length]);

  useEffect(() => {
    if (!catalog.venues.length) return;
    if (!catalog.campuses.some((item) => item.id === campusId)) setCampusId(catalog.campuses[0]?.id || catalog.venues[0]?.campusId || "");
  }, [campusId, catalog.campuses, catalog.venues]);

  useEffect(() => {
    if (status || !cachedStatus || restoredCachedStatus.current || userChangedQuery.current) return;
    restoredCachedStatus.current = true;
    const cachedVenue = catalog.venues.find((item) => (
      item.detailUrl === cachedStatus.query.detailUrl
      && (!cachedStatus.query.campus || item.campusId === cachedStatus.query.campus.id)
    ));
    if (cachedVenue) {
      setCampusId(cachedVenue.campusId);
      setActivity(cachedVenue.activity);
      setVenueId(cachedVenue.id);
    }
    setStatus(cachedStatus);
    setDate(cachedStatus.query.date);
    setVenue(cachedStatus.query.venue);
  }, [cachedStatus, catalog.venues, status]);

  useEffect(() => {
    if (!activities.includes(activity)) setActivity(activities[0] || "");
  }, [activities, activity]);

  useEffect(() => {
    if (!venues.some((item) => item.id === venueId)) setVenueId(venues[0]?.id || "");
  }, [venueId, venues]);

  const refreshCatalog = async () => {
    setCatalogLoading(true);
    setError(null);
    try {
      await bridge.refreshMotionVenueCatalog();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "场馆目录刷新失败");
    } finally {
      setCatalogLoading(false);
    }
  };

  const queryStatus = async () => {
    if (!activeDetailUrl) return;
    userChangedQuery.current = true;
    setStatusLoading(true);
    setError(null);
    try {
      const result = await bridge.queryMotionVenueStatus({
        detailUrl: activeDetailUrl,
        date: date || null,
        venue: venue || null,
      });
      setStatus(result);
      setDate(result.query.date);
      setVenue(result.query.venue);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "场馆状态查询失败");
    } finally {
      setStatusLoading(false);
    }
  };

  const queryReady = Boolean(activeDetailUrl);
  return (
    <div className="venue-status-view">
      <header className="venue-status-header">
        <div>
          <span className="venue-status-kicker">MOTION · PUBLIC GET</span>
          <h2>场馆状态</h2>
          <p>查看公开场馆的时间段、场地和实时状态。</p>
        </div>
        <div className="venue-status-header-side">
          <div className="venue-status-count"><strong>{catalog.venues.length}</strong><span>个场馆</span></div>
          <button type="button" className="icon-button" onClick={() => void refreshCatalog()} disabled={catalogLoading} title="刷新场馆目录" aria-label="刷新场馆目录">
            {catalogLoading ? <LoaderCircle size={15} className="spinning" /> : <RefreshCw size={15} />}
          </button>
        </div>
      </header>

      <section className="venue-status-query" aria-label="场馆状态查询条件">
        <div className="venue-status-query-grid">
          <label><span>校区</span><select value={campusId} onChange={(event) => { userChangedQuery.current = true; setCampusId(event.target.value); setStatus(null); setDate(""); setVenue(""); }} disabled={!catalog.campuses.length || catalogLoading}><option value="">请选择校区</option>{catalog.campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.label}</option>)}</select></label>
          <label><span>项目</span><select value={activity} onChange={(event) => { userChangedQuery.current = true; setActivity(event.target.value); setStatus(null); setDate(""); setVenue(""); }} disabled={!activities.length || catalogLoading}><option value="">请选择项目</option>{activities.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label><span>场馆</span><select value={selectedVenue?.id || ""} onChange={(event) => { userChangedQuery.current = true; setVenueId(event.target.value); setStatus(null); setDate(""); setVenue(""); }} disabled={!venues.length || catalogLoading}><option value="">请选择场馆</option>{venues.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label><span>日期</span><select value={date} onChange={(event) => { userChangedQuery.current = true; setDate(event.target.value); }} disabled={!dateOptions.length || statusLoading}><option value="">当前公开日期</option>{dateOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label><span>场馆组</span><select value={venue} onChange={(event) => { userChangedQuery.current = true; setVenue(event.target.value); }} disabled={!venueOptions.length || statusLoading}><option value="">当前公开场馆组</option>{venueOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        </div>
        <div className="venue-status-query-actions">
          <span><MapPin size={13} />{catalog.lastRefreshedAt ? `目录更新于 ${capturedLabel(catalog.lastRefreshedAt)}` : "请先刷新公开场馆目录"}</span>
          <button type="button" className="primary-button" onClick={() => void queryStatus()} disabled={!queryReady || statusLoading || catalogLoading}>
            {statusLoading ? <LoaderCircle size={15} className="spinning" /> : <Search size={15} />}
            {statusLoading ? "查询中" : optionStatus ? "查询状态" : "读取场馆"}
          </button>
        </div>
        {error && <p className="venue-status-error" role="alert"><AlertTriangle size={14} />{error}</p>}
      </section>

      {status ? (
        <section className="venue-status-results" aria-label="场馆状态结果">
          <div className="venue-status-results-head">
            <div><span className="venue-status-result-kicker">{status.query.campus?.label || "MOTION"} · {status.query.activity || "公开场馆"}</span><strong>{status.query.venue}</strong><small>{status.query.date} · 最近查询 {capturedLabel(status.capturedAt)}</small></div>
            <div className="venue-status-metrics">
              <span><Clock3 size={13} />{status.timing?.totalMs != null ? `${status.timing.totalMs} ms` : "--"}</span>
              <span><Activity size={13} />{Number(status.availability.summary?.courtStatusCells || 0)} 个状态</span>
            </div>
          </div>
          {counts.length > 0 && <div className="venue-status-legend">{counts.map(([state, count]) => <span className={`venue-state-chip ${state}`} key={state}><i />{stateLabel(state)} <b>{count}</b></span>)}</div>}
          <div className="venue-status-tables">
            {status.availability.tables.map((table) => {
              const courtCount = Math.max(0, ...table.slots.map((slot) => slot.courts.length));
              const columns = Array.from({ length: courtCount }, (_, index) => {
                const header = table.headers[index + 1];
                if (header && !TIME_RANGE_LABEL.test(header) && !Object.values(STATE_LABELS).includes(header)) return header;
                return table.slots.find((slot) => slot.courts[index])?.courts[index]?.court || `场地${index + 1}`;
              });
              return <div className="venue-status-table-wrap" key={table.index}><table className="venue-status-table"><thead><tr><th>时间</th>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{table.slots.map((slot) => <tr key={slot.time}><th>{slot.time}</th>{slot.courts.map((cell) => <td key={`${slot.time}-${cell.court}`}><span className={`venue-cell-state ${cell.state}`}>{cell.status}</span><small>{stateLabel(cell.state)}</small></td>)}</tr>)}</tbody></table></div>;
            })}
          </div>
          {!status.availability.tables.length && <EmptyState icon={CalendarDays} title="当前没有可显示的时间段" detail="页面已返回，但这个日期和场馆组暂时没有公开状态表。" />}
        </section>
      ) : (
        <section className="venue-status-empty"><EmptyState icon={CheckCircle2} title={catalog.venues.length ? "选择场馆后读取状态" : "正在准备场馆目录"} detail="查询只读取公开页面，不会提交预约表单。" /></section>
      )}
    </div>
  );
}
