import { BarChart3 } from "lucide-react";
import { useMemo, useState } from "react";
// The GPA rule module is shared with the Electron data core.
import { buildAcademicAnalysis } from "../../core/academic-model.mjs";
import { computeEarnedCredits, computeGpa, computeGpaTrend, formatGpa, isGpaEligible } from "../../core/gpa.mjs";
import {
  EmptyState,
  formatGradePoint,
  gpaTone,
  matchTerm,
  remarkTone,
  scoreTone,
  TermSelector,
  type Term,
} from "../ui/app-shared";
import type { AcademicExtraDomain, AcademicProgress, Grade } from "../types";
import { GradeDetailsPanel } from "./grades/GradeDetailsPanel";

type GpaTrendPoint = {
  id: string;
  label: string;
  gpa: number | null;
  credits: number;
  included: number;
  cumulativeGpa?: number | null;
  cumulativeCredits?: number;
};

function chartLabel(label: string) {
  return label.replace(/\s+/g, " ").trim();
}

function GpaTrendChart({ grades, terms }: { grades: Grade[]; terms: Term[] }) {
  const [metric, setMetric] = useState<"period" | "cumulative">("period");
  const [animationVersion, setAnimationVersion] = useState(0);
  const selectMetric = (next: "period" | "cumulative") => {
    if (next === metric) return;
    setMetric(next);
    setAnimationVersion((current) => current + 1);
  };
  const trend = useMemo(
    () =>
      computeGpaTrend(grades, terms) as {
        semesters: GpaTrendPoint[];
        academicYears: GpaTrendPoint[];
      },
    [grades, terms],
  );
  const points = trend.semesters;
  const plottedPoints = useMemo(() => points.map((point) => ({
    ...point,
    plottedGpa: metric === "cumulative" ? point.cumulativeGpa : point.gpa,
    plottedCredits: metric === "cumulative" ? point.cumulativeCredits : point.credits,
  })), [metric, points]);
  const width = Math.max(960, plottedPoints.length * 160);
  const height = 206;
  const pad = { left: 40, right: 18, top: 16, bottom: 22 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const x = (index: number) =>
    plottedPoints.length <= 1
      ? pad.left + innerWidth / 2
      : pad.left + (index / (plottedPoints.length - 1)) * innerWidth;
  const y = (value: number) =>
    pad.top +
    innerHeight -
    (Math.max(0, Math.min(4.33, value)) / 4.33) * innerHeight;
  const coords = plottedPoints.map((point, index) => ({
    ...point,
    x: x(index),
    y: y(point.plottedGpa || 0),
  }));
  const path = coords
    .map((point, index) => {
      if (index === 0) return `M ${point.x} ${point.y}`;
      const previous = coords[index - 1];
      const mid = (previous.x + point.x) / 2;
      return `C ${mid} ${previous.y}, ${mid} ${point.y}, ${point.x} ${point.y}`;
    })
    .join(" ");

  return (
    <section className="gpa-trend panel">
      <div className="panel-heading">
        <div className="gpa-heading-main">
          <h2>GPA</h2>
          <div className="segmented gpa-chart-controls" role="tablist" aria-label="GPA 口径">
            <button
              className={metric === "period" ? "active" : ""}
              onClick={() => selectMetric("period")}
              role="tab"
              aria-selected={metric === "period"}
            >
              阶段
            </button>
            <button
              className={metric === "cumulative" ? "active" : ""}
              onClick={() => selectMetric("cumulative")}
              role="tab"
              aria-selected={metric === "cumulative"}
            >
              累计
            </button>
          </div>
        </div>
      </div>
      {coords.length ? (
        <div className="gpa-chart-wrap">
          <svg
            key={`gpa-semester-${metric}-${animationVersion}`}
            className="gpa-chart"
            viewBox={`0 0 ${width} ${height}`}
            style={{ minWidth: width }}
            role="img"
            aria-label="GPA 趋势"
          >
            {[0, 1, 2, 3, 4.33].map((tick) => (
              <g key={tick}>
                <line
                  x1={pad.left}
                  x2={width - pad.right}
                  y1={y(tick)}
                  y2={y(tick)}
                  className="gpa-grid-line"
                />
                <text
                  x={pad.left - 9}
                  y={y(tick) + 4}
                  textAnchor="end"
                  className="gpa-axis-label"
                >
                  {tick.toFixed(tick === 4.33 ? 2 : 0)}
                </text>
              </g>
            ))}
            <path d={path} pathLength="1" className="gpa-line" />
            {coords.map((point) => (
              <g key={point.id}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r="5"
                  className={`gpa-point ${gpaTone(point.plottedGpa)}`}
                >
                  <title>{`${point.label}: ${formatGpa(point.plottedGpa)}（${(point.plottedCredits || 0).toFixed(1)} 学分）`}</title>
                </circle>
              </g>
            ))}
          </svg>
          <div
            className="gpa-timeline"
            style={{
              minWidth: width,
              gridTemplateColumns: `repeat(${Math.max(coords.length, 1)}, minmax(150px, 1fr))`,
            }}
          >
            {coords.map((point) => (
              <span key={point.id}>{chartLabel(point.label)}</span>
            ))}
          </div>
        </div>
      ) : (
        <EmptyState
          icon={BarChart3}
          title="暂无可计算 GPA 的成绩"
          detail="需要包含学分和数值成绩的课程记录"
        />
      )}
    </section>
  );
}

export function GradesView({
  grades,
  progress,
  gpa,
  terms,
  gradeDetails,
  gradeDetailsRefreshing,
  onRefreshGradeDetails,
}: {
  grades: Grade[];
  progress?: AcademicProgress | null;
  /** Legacy/profile fallback. School progress GPA always takes precedence. */
  gpa?: number | null;
  terms: Term[];
  gradeDetails?: AcademicExtraDomain;
  gradeDetailsRefreshing: boolean;
  onRefreshGradeDetails: () => void;
}) {
  const [termFilter, setTermFilter] = useState("");
  const progressForAnalysis = useMemo(() => {
    const officialGpa = progress?.gpa ?? gpa ?? null;
    if (progress) {
      return progress.gpa === officialGpa ? progress : { ...progress, gpa: officialGpa };
    }
    return officialGpa == null ? null : { gpa: officialGpa, categories: [] };
  }, [gpa, progress]);
  const academicAnalysis = useMemo(
    () => buildAcademicAnalysis({ grades, progress: progressForAnalysis }),
    [grades, progressForAnalysis],
  );
  const officialGpa = academicAnalysis.gpa.officialValue ?? null;
  const computedGpa = academicAnalysis.gpa.computedValue ?? null;
  const displayedGpa = officialGpa ?? computedGpa;
  const gpaSource = officialGpa != null
    ? "学校记录"
    : computedGpa != null
      ? "按成绩计算（学校记录暂缺）"
      : "暂无可用 GPA";
  const { filtered, earnedCredits, termGpa } = useMemo(() => {
    const filtered = grades.filter((grade) =>
      matchTerm((grade as Grade & { termId?: string }).termId, termFilter),
    );
    const calculated = computeGpa(filtered);
    const earnedCredits = computeEarnedCredits(filtered).credits;
    const termGpa = termFilter ? calculated.gpa : null;
    return { filtered, earnedCredits, termGpa };
  }, [grades, termFilter]);

  return (
    <div className="data-page">
      <div className="view-toolbar">
        <TermSelector
          terms={terms}
          value={termFilter}
          onChange={setTermFilter}
        />
      </div>
      <GpaTrendChart grades={grades} terms={terms} />
      <section className="grade-summary">
        <div>
          <span>总 GPA</span>
          <strong className={`gpa-value ${gpaTone(displayedGpa)}`}>
            {displayedGpa != null ? `${formatGpa(displayedGpa)}/4.33` : "--"}
          </strong>
          <small className="gpa-source-label">{gpaSource}</small>
        </div>
        {termGpa !== null && (
          <div>
            <span>本学期 GPA（按成绩）</span>
            <strong className={`gpa-value ${gpaTone(termGpa)}`}>
              {formatGpa(termGpa)}/4.33
            </strong>
          </div>
        )}
        <div>
          <span>成绩记录</span>
          <strong>{filtered.length}</strong>
        </div>
        <div>
          <span>已获得学分</span>
          <strong>{earnedCredits.toFixed(1)}</strong>
        </div>
      </section>
      {filtered.length ? (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>课程</th>
                <th>代码</th>
                <th>性质</th>
                <th>学分</th>
                <th>成绩</th>
                <th>绩点</th>
                <th>备注</th>
                <th>教师</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((grade) => {
                const rawRemark = grade.remark || grade.status || (!isGpaEligible(grade)
                  ? "不统计"
                  : null);
                const remark =
                  rawRemark && /不统计/.test(rawRemark) ? "不统计" : rawRemark;
                return (
                  <tr key={grade.id}>
                    <td>
                      <strong>{grade.courseName}</strong>
                    </td>
                    <td>{grade.courseCode || "--"}</td>
                    <td>{grade.nature || "--"}</td>
                    <td>{grade.credits ?? "--"}</td>
                    <td>
                      <span className={`score-badge ${scoreTone(grade.score)}`}>
                        {grade.score || "--"}
                      </span>
                    </td>
                    <td>{formatGradePoint(grade.point)}</td>
                    <td>
                      {remark ? (
                        <span className={`remark-text ${remarkTone(remark)}`}>
                          {remark}
                        </span>
                      ) : (
                        "--"
                      )}
                    </td>
                    <td>{grade.teacher || "--"}</td>
                    <td />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={BarChart3}
          title="暂无成绩记录"
          detail={
            termFilter ? "该学期暂无成绩" : "教务系统发布成绩后手动同步即可查看"
          }
        />
      )}
      <GradeDetailsPanel
        domain={gradeDetails}
        refreshing={gradeDetailsRefreshing}
        onRefresh={onRefreshGradeDetails}
      />
    </div>
  );
}
