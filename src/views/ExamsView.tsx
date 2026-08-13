import { CalendarDays, ClipboardCheck } from "lucide-react";
import { useState } from "react";
import {
  EmptyState,
  formatDate,
  matchTerm,
  parseExamTime,
  remarkTone,
  TermSelector,
  type Term,
} from "../ui/app-shared";
import type { CampusState } from "../types";

export function ExamsView({
  state,
  terms,
}: {
  state: CampusState;
  terms: Term[];
}) {
  const [termFilter, setTermFilter] = useState("");
  const [visibility, setVisibility] = useState<"all" | "upcoming">("all");
  const now = Date.now();
  const filtered = state.exams
    .filter((exam) => matchTerm(exam.termId, termFilter))
    .filter((exam) => {
      if (visibility === "all") return true;
      return parseExamTime(exam.startAt, exam.examTime) > now;
    })
    .slice()
    .sort((left, right) => {
      const leftTime = parseExamTime(left.startAt, left.examTime);
      const rightTime = parseExamTime(right.startAt, right.examTime);
      if (leftTime <= 0 && rightTime <= 0) return 0;
      if (leftTime <= 0) return 1;
      if (rightTime <= 0) return -1;
      const leftExpired = leftTime < now;
      const rightExpired = rightTime < now;
      if (leftExpired !== rightExpired) return leftExpired ? 1 : -1;
      return leftExpired ? rightTime - leftTime : leftTime - rightTime;
    });

  return (
    <div className="data-page">
      <div className="view-toolbar exam-toolbar">
        <TermSelector
          terms={terms}
          value={termFilter}
          onChange={setTermFilter}
        />
        <div
          className="segmented exam-visibility-toggle"
          role="group"
          aria-label="考试显示范围"
        >
          <button
            className={visibility === "all" ? "active" : ""}
            onClick={() => setVisibility("all")}
            aria-pressed={visibility === "all"}
          >
            全部安排
          </button>
          <button
            className={visibility === "upcoming" ? "active" : ""}
            onClick={() => setVisibility("upcoming")}
            aria-pressed={visibility === "upcoming"}
          >
            仅未来考试
          </button>
        </div>
      </div>
      {filtered.length ? (
        <div className="list-stack">
          {filtered.map((exam) => {
            const timestamp = parseExamTime(exam.startAt, exam.examTime);
            const expired = timestamp > 0 && timestamp < now;
            return (
              <article
                className={`exam-row${expired ? " expired" : ""}`}
                key={exam.id}
              >
                <div className="exam-date">
                  <CalendarDays size={20} />
                  <strong>{exam.examTime || formatDate(exam.startAt)}</strong>
                  <span>{exam.examType || "考试"}</span>
                  {expired && <span className="expired-tag">已过期</span>}
                </div>
                <div className="exam-main">
                  <h3>{exam.courseName}</h3>
                  <p>{exam.mode || "方式待公布"}</p>
                </div>
                <div className="exam-location">
                  <strong>{exam.location || "地点待公布"}</strong>
                  <span>
                    {[exam.campus, exam.seat ? `座号 ${exam.seat}` : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                {exam.remark && (
                  <span className={`remark-badge ${remarkTone(exam.remark)}`}>
                    {exam.remark}
                  </span>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={ClipboardCheck}
          title="暂无考试安排"
          detail={
            visibility === "upcoming"
              ? "当前筛选范围内没有未来考试"
              : termFilter
                ? "该学期没有考试记录"
                : "连接教务系统并同步后即可查看"
          }
        />
      )}
    </div>
  );
}
