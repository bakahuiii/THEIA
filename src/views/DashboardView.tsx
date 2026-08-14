import { useMemo } from "react";
import {
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Map as MapIcon,
  MapPin,
  Sparkles,
} from "lucide-react";
import { AssignmentRow } from "../components/AssignmentRow";
import {
  EmptyState,
  formatDate,
  isExpiredAssignment,
  parseExamTime,
  relativeTime,
  sourceLabel,
  type ViewId,
} from "../ui/app-shared";
import { currentAcademicWeek, occursInWeek } from "../ui/calendar";
import type { AdvisorUrgentItem, CampusState, ScheduleItem } from "../types";

function DashboardAdvisorTop({
  item,
  loading,
  error,
  onNavigate,
}: {
  item: AdvisorUrgentItem | null;
  loading: boolean;
  error: string | null;
  onNavigate: (view: ViewId) => void;
}) {
  return (
    <section className="dashboard-advisor-top span-full" aria-label="首要行动">
      <span className="dashboard-advisor-icon"><Sparkles size={17} /></span>
      <span className="dashboard-advisor-copy">
        <small>本地顾问 · Top 1</small>
        <strong>
          {loading && !item
            ? "正在计算首要行动"
            : error && !item
              ? "首要行动暂时无法计算"
              : item?.title || "当前没有已确认的首要行动"}
        </strong>
        <span>
          {item?.reasons[0]
            || (error ? "请进入工作台检查数据质量。" : "未知或不完整数据不会被解释为没有事项。")}
        </span>
      </span>
      {item && <em data-severity={item.severity}>{item.severity === "urgent" ? "紧急" : item.severity === "attention" ? "需关注" : "提示"}</em>}
      <button type="button" onClick={() => onNavigate("advisor")}>
        打开顾问 <ChevronRight size={15} />
      </button>
    </section>
  );
}

function QuickActions({ onNavigate }: { onNavigate: (view: ViewId) => void }) {
  const actions: Array<{
    id: ViewId;
    label: string;
    detail: string;
    icon: typeof CalendarDays;
  }> = [
    {
      id: "schedule",
      label: "本周课表",
      detail: "按周次查看课程",
      icon: CalendarDays,
    },
    {
      id: "exams",
      label: "考试安排",
      detail: "时间、地点与座号",
      icon: ClipboardCheck,
    },
    {
      id: "grades",
      label: "成绩与 GPA",
      detail: "查看趋势与记录",
      icon: BarChart3,
    },
    { id: "map", label: "校园地图", detail: "定位教学楼与教室", icon: MapIcon },
  ];
  return (
    <section className="quick-actions span-full" aria-label="快速访问">
      {actions.map(({ id, label, detail, icon: Icon }) => (
        <button key={id} onClick={() => onNavigate(id)}>
          <span className="quick-action-icon">
            <Icon size={17} />
          </span>
          <span>
            <strong>{label}</strong>
            <small>{detail}</small>
          </span>
          <ChevronRight size={15} />
        </button>
      ))}
    </section>
  );
}

function ScheduleRow({ item }: { item: ScheduleItem }) {
  return (
    <div className="timeline-row">
      <div className="period-pill">
        {item.period ? `${item.period} 节` : "待定"}
      </div>
      <div>
        <strong>{item.title}</strong>
        <span>
          {[item.teacher, item.room].filter(Boolean).join(" · ") ||
            "课程信息待补充"}
        </span>
      </div>
      <small>{item.weeks || "周次待定"}</small>
    </div>
  );
}

export function DashboardView({
  state,
  onNavigate,
  onOpenSource,
  advisorItem,
  advisorLoading,
  advisorError,
}: {
  state: CampusState;
  onNavigate: (view: ViewId) => void;
  onOpenSource: (assignmentId: string) => void;
  advisorItem: AdvisorUrgentItem | null;
  advisorLoading: boolean;
  advisorError: string | null;
}) {
  const academicCourseCount = useMemo(() => {
    const identities = new Set<string>();
    state.courses
      .filter((course) => course.source === "jwglxt")
      .forEach((course) => {
        const code = String(course.code || "").replace(/\s+/g, "").toUpperCase();
        const fallback = String(course.title || course.id).replace(/\s+/g, "").toUpperCase();
        identities.add(code ? `code:${code}` : `course:${fallback}`);
      });
    return identities.size;
  }, [state.courses]);
  const { today, pending, nextExam } = useMemo(() => {
    const weekday = new Date().getDay() || 7;
    const calendar = state.dataCatalog.collections.academicCalendar.calendar;
    const academicWeek = currentAcademicWeek(calendar);
    const calendarKnown = Boolean(calendar?.semesters.length);
    const today = state.schedule
      .filter((item) => {
        if (item.weekday !== weekday) return false;
        if (!calendarKnown) return true;
        return academicWeek !== null
          && (!item.termId || item.termId === academicWeek.termId)
          && occursInWeek(item.weeks, academicWeek.week);
      })
      .sort((left, right) =>
        String(left.period).localeCompare(String(right.period), "zh-CN", {
          numeric: true,
        }),
      );
    const pending = state.assignments
      .filter((item) => item.status !== "submitted" && !isExpiredAssignment(item))
      .sort(
        (left, right) =>
          (left.dueAt ? new Date(left.dueAt).getTime() : Infinity) -
          (right.dueAt ? new Date(right.dueAt).getTime() : Infinity),
      );
    const nextExam = [...state.exams]
      .sort(
        (left, right) =>
          parseExamTime(left.startAt, left.examTime) -
          parseExamTime(right.startAt, right.examTime),
      )
      .find((exam) => parseExamTime(exam.startAt, exam.examTime) > Date.now());
    return { today, pending, nextExam };
  }, [state.schedule, state.assignments, state.exams, state.dataCatalog]);

  return (
    <div className="dashboard-grid">
      <DashboardAdvisorTop
        item={advisorItem}
        loading={advisorLoading}
        error={advisorError}
        onNavigate={onNavigate}
      />
      <QuickActions onNavigate={onNavigate} />
      <section className="metric-strip span-full">
        <button onClick={() => onNavigate("courses")}>
          <BookOpen />
          <span>课程</span>
          <strong>{academicCourseCount}</strong>
        </button>
        <button onClick={() => onNavigate("assignments")}>
          <CheckCircle2 />
          <span>待完成</span>
          <strong>{pending.length}</strong>
        </button>
        <button onClick={() => onNavigate("exams")}>
          <ClipboardCheck />
          <span>考试</span>
          <strong>{state.exams.length}</strong>
        </button>
        <button onClick={() => onNavigate("grades")}>
          <BarChart3 />
          <span>成绩记录</span>
          <strong>{state.grades.length}</strong>
        </button>
      </section>
      <section className="panel panel-large dashboard-schedule-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">今天</span>
            <h2>课程安排</h2>
          </div>
          <button
            className="text-command"
            onClick={() => onNavigate("schedule")}
          >
            完整课表 <ChevronRight size={16} />
          </button>
        </div>
        {today.length ? (
          <div className="timeline-list">
            {today.map((item) => (
              <ScheduleRow key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={CalendarDays}
            title="今天没有课程"
            detail="当前课表中没有今天的课程安排"
          />
        )}
      </section>
      <section className="panel panel-large dashboard-assignments-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">截止时间</span>
            <h2>待办作业</h2>
          </div>
          <button
            className="text-command"
            onClick={() => onNavigate("assignments")}
          >
            全部任务 <ChevronRight size={16} />
          </button>
        </div>
        {pending.length ? (
          <div className="task-list">
            {pending.map((item) => (
              <AssignmentRow key={item.id} item={item} onOpenSource={onOpenSource} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={CheckCircle2}
            title="没有待办作业"
            detail="北化在线THEOL中未发现未提交任务"
          />
        )}
      </section>
      <section className="panel dashboard-exam-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">最近安排</span>
            <h2>下一场考试</h2>
          </div>
        </div>
        {nextExam ? (
          <div className="exam-focus">
            <div className="date-block">
              <strong>
                {
                  formatDate(
                    nextExam.startAt || nextExam.examTime,
                    false,
                  ).split("月")[0]
                }
              </strong>
              <span>
                {formatDate(
                  nextExam.startAt || nextExam.examTime,
                  false,
                ).includes("月")
                  ? formatDate(
                      nextExam.startAt || nextExam.examTime,
                      false,
                    ).split("月")[1]
                  : ""}
              </span>
            </div>
            <div>
              <h3>{nextExam.courseName}</h3>
              <p>
                <Clock3 size={15} />{" "}
                {formatDate(nextExam.startAt || nextExam.examTime)}
              </p>
              <p>
                <MapPin size={15} />{" "}
                {[nextExam.campus, nextExam.location]
                  .filter(Boolean)
                  .join(" · ") || "地点待公布"}
              </p>
              {nextExam.seat && (
                <span className="seat-badge">座号 {nextExam.seat}</span>
              )}
            </div>
          </div>
        ) : (
          <EmptyState
            icon={ClipboardCheck}
            title="暂无考试安排"
            detail="同步后将在这里显示最近考试"
          />
        )}
      </section>
      <section className="panel dashboard-notices-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">最新动态</span>
            <h2>通知</h2>
          </div>
          <button
            className="icon-button"
            data-tooltip="全部通知"
            aria-label="全部通知"
            onClick={() => onNavigate("notices")}
          >
            <ChevronRight size={18} />
          </button>
        </div>
        {state.notices.length ? (
          <div className="notice-compact">
            {state.notices.map((notice) => (
              <button
                type="button"
                key={notice.id}
                onClick={() => onNavigate("notices")}
                aria-label={`查看通知：${notice.title}`}
              >
                <span className={`source-pin ${notice.source}`} />
                <span>
                  <strong>{notice.title}</strong>
                  <small>
                    {sourceLabel(notice.source)} ·{" "}
                    {relativeTime(notice.publishedAt)}
                  </small>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Bell}
            title="暂无通知"
            detail="教务系统通知会在同步后显示在这里"
          />
        )}
      </section>
    </div>
  );
}
