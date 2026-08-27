import { CalendarDays, Download, MapPin, Navigation, UserRound, X } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { matchTerm, TermSelector, type Term } from "../ui/app-shared";
import {
  currentAcademicVacation,
  currentAcademicWeek,
  currentShanghaiWeekday,
  occursInWeek,
} from "../ui/calendar";
import type { AcademicCalendar, ScheduleItem } from "../types";
import { buildingDefByKey, resolveRoomToBuilding } from "../map/campus-buildings";

type SchedulePopover = {
  items: ScheduleItem[];
  label: string;
  x: number;
  y: number;
};

// Ordered by hue distance rather than semantic category. A timetable normally
// has fewer than 16 distinct courses, so neighbouring assignments never look
// like two shades of the same colour.
const COURSE_ACCENTS = [
  "#1296b6", "#d4674e", "#725dc4", "#409d6a",
  "#bd8526", "#396eb8", "#bc4f83", "#547f3d",
  "#9a5eae", "#b56630", "#217b82", "#c04755",
  "#5573a4", "#808a2f", "#9a633d", "#4f7393",
  "#9c436f", "#327f56", "#856036", "#5254a2",
  "#a74832", "#277f9e", "#765b79", "#597341",
];

const POPOVER_WIDTH = 352;
const POPOVER_MARGIN = 14;
const DAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const DEFAULT_PERIOD_COUNT = 12;
const MAX_PERIOD_COUNT = 16;

type ScheduleSlot = {
  weekday: number;
  start: number;
  end: number;
  period: string;
  items: ScheduleItem[];
};

type PopoverDragState = {
  pointerId: number;
  offsetX: number;
  offsetY: number;
};

function firstScheduledTermId(items: ScheduleItem[], terms: Term[]) {
  const knownTerms = new Set(
    items
      .map((item) => item.termId)
      .filter((termId): termId is string => Boolean(termId)),
  );
  return terms.find((term) => knownTerms.has(term.id))?.id || terms[0]?.id || "";
}

function parsePeriodRange(period?: string | null) {
  const values = (String(period || "").match(/\d+/g) || [])
    .map(Number)
    .filter((value) => Number.isFinite(value));
  const start = values[0];
  const end = values[1] ?? start;
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 1 ||
    start > MAX_PERIOD_COUNT
  ) {
    return null;
  }
  return {
    start,
    end: Math.min(MAX_PERIOD_COUNT, Math.max(start, end)),
  };
}

function periodLabel(period: number) {
  const numerals = [
    "零",
    "一",
    "二",
    "三",
    "四",
    "五",
    "六",
    "七",
    "八",
    "九",
    "十",
    "十一",
    "十二",
    "十三",
    "十四",
    "十五",
    "十六",
  ];
  return `第${numerals[period] || period}节`;
}

function clampPopoverPosition(x: number, y: number, height = 420) {
  const viewportWidth = window.innerWidth;
  const availableWidth = Math.max(0, viewportWidth - POPOVER_MARGIN * 2);
  const width = Math.min(POPOVER_WIDTH, availableWidth);
  const maxLeft = Math.max(POPOVER_MARGIN, viewportWidth - width - POPOVER_MARGIN);
  const maxTop = Math.max(
    POPOVER_MARGIN,
    window.innerHeight - Math.min(height, window.innerHeight - POPOVER_MARGIN * 2) - POPOVER_MARGIN,
  );
  return {
    x: Math.max(POPOVER_MARGIN, Math.min(x, maxLeft)),
    y: Math.max(POPOVER_MARGIN, Math.min(y, maxTop)),
  };
}

export function ScheduleView({
  items,
  terms,
  calendar,
  onExportPdf,
  exportingPdf,
  onOpenMap,
}: {
  items: ScheduleItem[];
  terms: Term[];
  calendar?: AcademicCalendar | null;
  onExportPdf: () => void;
  exportingPdf: boolean;
  onOpenMap?: (buildingKey: string, room: string) => void;
}) {
  const days = DAY_LABELS;
  const [termFilter, setTermFilter] = useState(
    () => firstScheduledTermId(items, terms),
  );
  const [weekMode, setWeekMode] = useState<"week" | "all">("week");
  const [weekNum, setWeekNum] = useState(1);
  const [calendarKey, setCalendarKey] = useState<string | null>(null);
  const [todayNotice, setTodayNotice] = useState<string | null>(null);
  const [popover, setPopover] = useState<SchedulePopover | null>(null);
  const [draggingPopover, setDraggingPopover] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverDragRef = useRef<PopoverDragState | null>(null);

  useEffect(() => {
    if (terms.length && !termFilter) setTermFilter(firstScheduledTermId(items, terms));
  }, [items, terms, termFilter]);

  const currentWeek = useMemo(() => currentAcademicWeek(calendar), [calendar]);
  useEffect(() => {
    if (!currentWeek || calendarKey === currentWeek.key) return;
    setTermFilter(currentWeek.termId);
    setWeekNum(currentWeek.week);
    setWeekMode("week");
    setCalendarKey(currentWeek.key);
  }, [calendarKey, currentWeek]);
  useEffect(() => {
    if (!todayNotice) return;
    const timeout = window.setTimeout(() => setTodayNotice(null), 4_000);
    return () => window.clearTimeout(timeout);
  }, [todayNotice]);
  const todayWeekday = currentShanghaiWeekday();
  const isShowingToday = Boolean(
    currentWeek
      && weekMode === "week"
      && termFilter === currentWeek.termId
      && weekNum === currentWeek.week,
  );
  const showToday = () => {
    const vacation = currentAcademicVacation(calendar);
    if (vacation) {
      setTodayNotice(`${vacation.label}中，无今日课表`);
      return;
    }
    if (!currentWeek) {
      setTodayNotice("当前校历尚未提供今天所在学期");
      return;
    }
    setTermFilter(currentWeek.termId);
    setWeekMode("week");
    setWeekNum(currentWeek.week);
    setPopover(null);
  };

  useEffect(() => {
    if (!popover) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (popoverRef.current?.contains(event.target as Node)) return;
      setPopover(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPopover(null);
    };
    const closeOnViewportChange = () => setPopover(null);
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnViewportChange);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnViewportChange);
    };
  }, [popover]);

  // Older local snapshots did not persist termId for schedule entries. They
  // still belong to the currently loaded timetable and must remain visible.
  const { slots, unscheduledItems, periodCount, dayCourseCounts } = useMemo(() => {
    const filtered = items.filter(
      (item) => !item.termId || matchTerm(item.termId, termFilter),
    );
    const visible = filtered.filter((item) => {
      return weekMode === "all" || occursInWeek(item.weeks, weekNum);
    });

    const groupedSlots = new Map<string, ScheduleSlot>();
    const unscheduledItems: ScheduleItem[] = [];
    visible.forEach((item) => {
      const weekday = Number(item.weekday);
      const range = parsePeriodRange(item.period);
      if (!range || weekday < 1 || weekday > days.length) {
        unscheduledItems.push(item);
        return;
      }
      const key = `${weekday}-${range.start}-${range.end}`;
      const slot = groupedSlots.get(key);
      if (slot) {
        slot.items.push(item);
        return;
      }
      groupedSlots.set(key, {
        weekday,
        start: range.start,
        end: range.end,
        period: String(item.period || `${range.start}-${range.end}`),
        items: [item],
      });
    });
    const slots = [...groupedSlots.values()].sort(
      (left, right) =>
        left.start - right.start ||
        left.weekday - right.weekday ||
        left.end - right.end,
    );
    const periodCount = Math.max(
      DEFAULT_PERIOD_COUNT,
      ...slots.map((slot) => slot.end),
    );
    const dayCourseCounts = days.map(
      (_day, index) => slots.filter((slot) => slot.weekday === index + 1).length,
    );
    return { slots, unscheduledItems, periodCount, dayCourseCounts };
  }, [items, termFilter, weekMode, weekNum, days]);

  const openCourseDetails = (
    event: React.MouseEvent<HTMLButtonElement>,
    group: ScheduleItem[],
    day: string,
    period: string,
  ) => {
    const estimatedHeight = Math.min(388, 112 + group.length * 112);
    const { x, y } = clampPopoverPosition(
      event.clientX + 12,
      event.clientY + 12,
      estimatedHeight,
    );
    setPopover({
      items: group,
      label: day + " " + (period ? period + " 节" : "节次待定"),
      x,
      y,
    });
  };

  const startPopoverDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const rect = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    popoverDragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    setDraggingPopover(true);
  };

  const movePopoverDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = popoverDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const position = clampPopoverPosition(
      event.clientX - drag.offsetX,
      event.clientY - drag.offsetY,
    );
    setPopover((current) =>
      current ? { ...current, ...position } : current,
    );
  };

  const finishPopoverDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      event.currentTarget.hasPointerCapture(event.pointerId)
    )
      event.currentTarget.releasePointerCapture(event.pointerId);
    popoverDragRef.current = null;
    setDraggingPopover(false);
  };

  return (
    <div className="schedule-scroll">
      {todayNotice && createPortal(
        <div className="schedule-today-notice" role="status">
          <CalendarDays size={17} />
          <span>{todayNotice}</span>
          <button type="button" onClick={() => setTodayNotice(null)} aria-label="关闭提示"><X size={15} /></button>
        </div>,
        document.body,
      )}
      {popover &&
        createPortal(
        <div
          className={`schedule-popover${draggingPopover ? " is-dragging" : ""}`}
          ref={popoverRef}
          role="dialog"
          aria-modal="false"
          aria-label={popover.label + "课程详情"}
          style={{ left: popover.x, top: popover.y }}
        >
          <div
            className="schedule-popover-header"
            onPointerDown={startPopoverDrag}
            onPointerMove={movePopoverDrag}
            onPointerUp={finishPopoverDrag}
            onPointerCancel={finishPopoverDrag}
          >
            <div>
              <span>课程详情</span>
              <strong>{popover.label}</strong>
            </div>
            <button
              type="button"
              onClick={() => setPopover(null)}
              aria-label="关闭课程详情"
              autoFocus
            >
              <X size={16} />
            </button>
          </div>
          <div className="schedule-popover-list">
            {popover.items.map((item) => {
              const buildingKey = resolveRoomToBuilding(item.room);
              const buildingDef = buildingDefByKey(buildingKey);
              return (
                <article className="popover-course" key={item.id}>
                  <strong>{item.title}</strong>
                  <small>{item.weeks || "周次待定"}</small>
                  <div>
                    <span>
                      <UserRound size={14} />
                      {item.teacher || "教师待定"}
                    </span>
                    <span>
                      <MapPin size={14} />
                      {item.room || "教室待定"}
                    </span>
                  </div>
                  {buildingKey && onOpenMap && (
                    <button
                      type="button"
                      className="popover-course-nav"
                      onClick={() => onOpenMap(buildingKey, item.room || "")}
                      title={`在地图上定位${buildingDef?.name ?? buildingKey}`}
                    >
                      <Navigation size={13} />
                      去{buildingDef?.label ?? buildingKey}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </div>,
          document.body,
        )}

      <div className="schedule-toolbar">
        <div className="schedule-toolbar-main">
          <button
            type="button"
            className={`schedule-today-button${isShowingToday ? " active" : ""}`}
            onClick={showToday}
            title={currentWeek ? `${currentWeek.label}第 ${currentWeek.week} 周` : "查看今日课表"}
          >
            <CalendarDays size={16} />
            <span>今日课表</span>
          </button>
          <TermSelector
            terms={terms}
            value={termFilter}
            onChange={setTermFilter}
          />
          <div className="segmented" role="group" aria-label="课表范围">
            <button
              className={weekMode === "week" ? "active" : ""}
              onClick={() => setWeekMode("week")}
            >
              按周
            </button>
            <button
              className={weekMode === "all" ? "active" : ""}
              onClick={() => setWeekMode("all")}
            >
              全学期
            </button>
          </div>
          {weekMode === "week" && (
            <label className="week-picker">
              <span>第</span>
              <input
                type="number"
                min="1"
                max="30"
                value={weekNum}
                onChange={(event) => setWeekNum(Number(event.target.value))}
                aria-label="当前周次"
              />
              <span>周</span>
            </label>
          )}
        </div>
        <button
          className="secondary-button schedule-pdf-button"
          onClick={onExportPdf}
          disabled={exportingPdf}
          title="调用教务系统原生输出 PDF"
        >
          <Download
            size={17}
            className={exportingPdf ? "spinning" : undefined}
          />
          {exportingPdf ? "正在输出" : "输出 PDF"}
        </button>
      </div>

      <section
        className="schedule-board"
        style={{ "--schedule-period-count": periodCount } as CSSProperties}
        aria-label="按节次排列的课程表"
      >
        <div className="schedule-corner">节次</div>
        {days.map((day, index) => (
          <header
            className={`schedule-day-header${isShowingToday && index + 1 === todayWeekday ? " is-today" : ""}`}
            key={day}
            style={{ gridColumn: index + 2, gridRow: 1 }}
          >
            <strong>{day}</strong>
            <span>{dayCourseCounts[index]} 门课程</span>
          </header>
        ))}
        {Array.from({ length: periodCount }, (_value, index) => {
          const period = index + 1;
          return (
            <div
              className="schedule-period-label"
              key={`period-${period}`}
              style={{ gridColumn: 1, gridRow: period + 1 }}
            >
              {periodLabel(period)}
            </div>
          );
        })}
        {Array.from({ length: periodCount * days.length }, (_value, index) => {
          const period = Math.floor(index / days.length) + 1;
          const weekday = (index % days.length) + 1;
          return (
            <div
              aria-hidden="true"
              className="schedule-grid-cell"
              key={`cell-${weekday}-${period}`}
              style={{ gridColumn: weekday + 1, gridRow: period + 1 }}
            />
          );
        })}
        {slots.map((slot) => {
          const first = slot.items[0];
          const stacked = slot.items.length > 1;
          const isSinglePeriod = slot.end === slot.start;
          const isToday = isShowingToday && slot.weekday === todayWeekday;
          return (
            <button
              type="button"
              className={[
                "course-slot",
                stacked ? "stacked" : "",
                isSinglePeriod ? "single-period" : "",
                isToday ? "is-today" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={`${slot.weekday}-${slot.start}-${slot.end}`}
              style={{
                gridColumn: slot.weekday + 1,
                gridRow: `${slot.start + 1} / ${slot.end + 2}`,
                "--course-accent": first.color || COURSE_ACCENTS[0],
              } as CSSProperties}
              onClick={(event) =>
                openCourseDetails(
                  event,
                  slot.items,
                  days[slot.weekday - 1],
                  slot.period,
                )
              }
              aria-haspopup="dialog"
              aria-label={first.title + "，查看课程详情"}
            >
              <span>
                {slot.period ? slot.period + " 节" : "节次待定"}
                {stacked && (
                  <span className="stack-badge">{slot.items.length}</span>
                )}
              </span>
              <h3>
                {first.title}
                {stacked && <small> +{slot.items.length - 1}</small>}
              </h3>
              <p>
                <UserRound size={14} />
                {first.teacher || "教师待定"}
              </p>
              <p>
                <MapPin size={14} />
                {first.room || "教室待定"}
              </p>
              <small>{first.weeks || ""}</small>
            </button>
          );
        })}
      </section>
      {unscheduledItems.length > 0 && (
        <section className="schedule-unscheduled">
          <strong>节次待定</strong>
          <span>
            {unscheduledItems.map((item) => item.title).join(" · ")}
          </span>
        </section>
      )}
    </div>
  );
}
