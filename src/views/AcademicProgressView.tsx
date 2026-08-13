import { BookOpen, ChevronRight, GraduationCap } from "lucide-react";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { computeGpa, formatGpa } from "../../core/gpa.mjs";
import {
  EmptyState,
  formatGradePoint,
  gpaTone,
  matchTerm,
  scoreTone,
  TermSelector,
  type Term,
} from "../ui/app-shared";
import type {
  AcademicProgress,
  AcademicRequirement,
  Grade,
  SelectedCourse,
} from "../types";

function requirementTone(requirement: AcademicRequirement) {
  const status = requirement.status || "";
  if (/未通过|未过|不及格|挂科|失败/.test(status)) return "attention";
  if (/未修/.test(status)) return "neutral";
  if (/超出|已满|完成/.test(status) || requirement.remaining === 0)
    return "complete";
  if (/未满|缺/.test(status) || (requirement.remaining || 0) > 0)
    return "pending";
  return "neutral";
}

function courseStatusTone(status?: string | null) {
  const text = String(status || "");
  if (/不及格|未通过|未过|挂科|失败/.test(text)) return "attention";
  if (/未修/.test(text)) return "neutral";
  if (/通过|完成|合格|免修|已修/.test(status || "")) return "complete";
  if (/在读|修读|已选/.test(status || "")) return "active";
  if (/不及格|未通过|未过|缺/.test(status || "")) return "attention";
  return "neutral";
}

function isFailedGrade(grade: Grade) {
  const score = String(grade.score || "").trim();
  if (/不及格|未通过|挂科|^U$|^F$/i.test(score)) return true;
  const numeric = Number(score);
  return Number.isFinite(numeric) && numeric < 60;
}

function gradeRequirementGroups(grades: Grade[]): AcademicRequirement[] {
  const grouped = new Map<string, Grade[]>();
  for (const grade of grades) {
    const group = String(grade.nature || grade.category || "其他课程").trim() || "其他课程";
    grouped.set(group, [...(grouped.get(group) || []), grade]);
  }
  return [...grouped.entries()].map(([title, entries]) => {
    const earned = entries.reduce((total, grade) => total + (isFailedGrade(grade) ? 0 : Number(grade.credits) || 0), 0);
    return {
      id: `grade-group:${title}`,
      title,
      required: earned,
      earned,
      remaining: 0,
      status: "已修课程归类",
      courses: entries.map((grade) => ({
        id: grade.id,
        studyStatus: isFailedGrade(grade) ? "未通过" : "已修",
        academicYear: grade.termId?.split("-").shift() || null,
        term: grade.termId?.split("-").slice(1).join("-") || null,
        courseCode: grade.courseCode || null,
        title: grade.courseName || "未命名课程",
        nature: grade.nature || null,
        credits: grade.credits ?? null,
        category: grade.category || null,
        bestScore: grade.score || null,
        point: grade.point ?? null,
        score: grade.score || null,
      })),
    };
  }).sort((left, right) => left.title.localeCompare(right.title, "zh-CN"));
}

function RequirementNode({
  requirement,
  depth = 0,
  isExpanded,
  onToggle,
}: {
  requirement: AcademicRequirement;
  depth?: number;
  isExpanded: (requirement: AcademicRequirement) => boolean;
  onToggle: (id: string, expanded: boolean) => void;
}) {
  const children = requirement.children || [];
  const courses = requirement.courses || [];
  const requiredChildren = children.filter((child) => child.relation !== "or");
  const alternativeChildren = children.filter(
    (child) => child.relation === "or",
  );
  const earned = requirement.earned ?? 0;
  const percentage =
    requirement.required > 0
      ? Math.min(100, Math.max(0, (earned / requirement.required) * 100))
      : 0;
  const tone = requirementTone(requirement);
  const status =
    requirement.status ||
    (tone === "complete"
      ? "已达到要求"
      : requirement.remaining != null
        ? `尚缺 ${requirement.remaining.toFixed(1)} 学分`
        : "等待教务数据");
  const expandable = children.length > 0 || courses.length > 0;
  const expanded = expandable && isExpanded(requirement);

  return (
    <div
      className={`requirement-node depth-${Math.min(depth, 3)} tone-${tone}`}
      style={{
        "--requirement-depth": depth,
        // Preserve fully opaque text while every nested surface reveals 20%
        // more of its parent. This makes the tree hierarchy readable without
        // dimming course names, state chips, or credit figures.
        "--requirement-surface-opacity": `${Math.pow(0.8, depth) * 100}%`,
      } as CSSProperties}
    >
      <div className="requirement-node-head">
        <div className="requirement-node-title">
          {expandable ? (
            <button
              className={`requirement-toggle ${expanded ? "expanded" : ""}`}
              data-tooltip={expanded ? "收起明细" : "展开明细"}
              aria-label={`${expanded ? "收起" : "展开"} ${requirement.title}`}
              aria-expanded={expanded}
              onClick={() => onToggle(requirement.id, expanded)}
            >
              <ChevronRight size={16} />
            </button>
          ) : (
            <i className="requirement-toggle-placeholder" />
          )}
          <i className={`requirement-state ${tone}`} />
          <div className="requirement-title-copy">
            <div className="requirement-title-line">
              <strong>{requirement.title}</strong>
              <span className={`requirement-status-tag ${tone}`}>{status}</span>
            </div>
            <div className="requirement-detail-tags">
              {courses.length > 0 && (
                <span className="requirement-detail-tag">
                  {courses.length} 门课程
                </span>
              )}
              {children.length > 0 && (
                <span className="requirement-detail-tag muted">
                  {children.length} 项子要求
                </span>
              )}
              {!courses.length && !children.length && (
                <span className="requirement-detail-tag muted">无课程明细</span>
              )}
            </div>
          </div>
        </div>
        <div className="requirement-credit">
          <strong>
            {requirement.earned == null ? "--" : earned.toFixed(1)}{" "}
            <small>/ {requirement.required.toFixed(1)}</small>
          </strong>
          <span>完成 {percentage.toFixed(0)}%</span>
        </div>
        <div
          className="requirement-meter"
          aria-label={`${requirement.title} 已完成 ${percentage.toFixed(0)}%`}
        >
          <i className={tone} style={{ width: `${percentage}%` }} />
        </div>
      </div>
      {expanded && children.length > 0 && (
        <div className="requirement-children">
          {requiredChildren.map((child) => (
            <RequirementNode
              key={child.id}
              requirement={child}
              depth={depth + 1}
              isExpanded={isExpanded}
              onToggle={onToggle}
            />
          ))}
          {alternativeChildren.length > 0 && (
            <div className="requirement-choice-branch">
              <div className="requirement-choice-heading">
                <span>可选分支</span>
                <small>满足其中一条路径即可</small>
              </div>
              <div className="requirement-choice-tree">
                {alternativeChildren.map((child) => (
                  <RequirementNode
                    key={child.id}
                    requirement={child}
                    depth={depth + 1}
                    isExpanded={isExpanded}
                    onToggle={onToggle}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {expanded && courses.length > 0 && (
        <div className="requirement-course-details">
          <div className="requirement-course-heading">
            <span>课程明细 · {courses.length} 门</span>
            <small>与教务“学生学业情况查询”一致</small>
          </div>
          <div className="requirement-course-table-wrap">
            <table className="requirement-course-table">
              <colgroup>
                <col className="requirement-col-status" />
                <col className="requirement-col-year" />
                <col className="requirement-col-term" />
                <col className="requirement-col-code" />
                <col className="requirement-col-title" />
                <col className="requirement-col-hours" />
                <col className="requirement-col-nature" />
                <col className="requirement-col-credits" />
                <col className="requirement-col-category" />
                <col className="requirement-col-score" />
                <col className="requirement-col-point" />
                <col className="requirement-col-score" />
                <col className="requirement-col-score" />
                <col className="requirement-col-score" />
              </colgroup>
              <thead>
                <tr>
                  <th>修读状态</th>
                  <th>成绩学年</th>
                  <th>学期</th>
                  <th>课程号</th>
                  <th>课程名称</th>
                  <th>学时</th>
                  <th>课程性质</th>
                  <th>学分</th>
                  <th>课程类别</th>
                  <th>最高成绩</th>
                  <th>绩点</th>
                  <th>成绩</th>
                  <th>补考</th>
                  <th>重修</th>
                </tr>
              </thead>
              <tbody>
                {courses.map((course) => (
                  <tr key={course.id}>
                    <td>
                      <span
                        className={`requirement-course-status ${courseStatusTone(course.studyStatus)}`}
                      >
                        {course.studyStatus || "待修"}
                      </span>
                    </td>
                    <td>{course.academicYear || "--"}</td>
                    <td>{course.term || "--"}</td>
                    <td>
                      <span className="requirement-course-code">
                        {course.courseCode || "--"}
                      </span>
                    </td>
                    <td>
                      <strong>{course.title}</strong>
                    </td>
                    <td>{course.hours || "--"}</td>
                    <td>
                      <span className="requirement-course-tag">
                        {course.nature || "--"}
                      </span>
                    </td>
                    <td>{course.credits ?? "--"}</td>
                    <td>
                      <span className="requirement-course-tag neutral">
                        {course.category || "--"}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`requirement-score-chip ${scoreTone(course.bestScore)}`}
                      >
                        {course.bestScore || "--"}
                      </span>
                    </td>
                    <td>{formatGradePoint(course.point)}</td>
                    <td>
                      <span
                        className={`requirement-score-chip ${scoreTone(course.score)}`}
                      >
                        {course.score || "--"}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`requirement-score-chip ${scoreTone(course.makeupScore)}`}
                      >
                        {course.makeupScore || "--"}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`requirement-score-chip ${scoreTone(course.retakeScore)}`}
                      >
                        {course.retakeScore || "--"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function AcademicProgressView({
  progress,
  grades,
  selectedCourses,
  terms,
}: {
  progress: AcademicProgress | null;
  grades: Grade[];
  selectedCourses: SelectedCourse[];
  terms: Term[];
}) {
  const [termFilter, setTermFilter] = useState(
    () => terms[0]?.id.split("-")[0] || "",
  );
  const [expandedRequirements, setExpandedRequirements] = useState<
    Record<string, boolean>
  >({});
  useEffect(() => {
    if (terms.length && !termFilter) setTermFilter(terms[0].id.split("-")[0]);
  }, [terms, termFilter]);
  const isRequirementExpanded = useCallback((
    requirement: AcademicRequirement,
  ) => {
    return expandedRequirements[requirement.id] === true;
  },
  [expandedRequirements]);
  const toggleRequirement = useCallback((id: string, expanded: boolean) =>
    setExpandedRequirements((currentState) => ({
      ...currentState,
      [id]: !expanded,
    })), []);

  if (!progress)
    return (
      <EmptyState
        icon={GraduationCap}
        title="暂无学业进度"
        detail="连接教务系统后同步即可读取培养方案数据"
      />
    );
  const counts = progress.courseCounts?.planned;
  const calculatedGpa = computeGpa(grades).gpa;
  const displayedGpa = calculatedGpa ?? progress.gpa ?? null;
  const officialRoots = Array.isArray(progress.roots) && progress.roots.length
    ? progress.roots
    : [];
  const usingGradeGroups = officialRoots.length === 0;
  const roots = usingGradeGroups ? gradeRequirementGroups(grades) : officialRoots;
  const current = [
    ...selectedCourses.filter((course) => matchTerm(course.termId, termFilter)),
  ].sort((left, right) => left.title.localeCompare(right.title, "zh-CN"));

  return (
    <div className="data-page">
      <section className="progress-summary">
        <div>
          <span>GPA</span>
          <strong className={`gpa-value ${gpaTone(displayedGpa)}`}>
            {displayedGpa != null
              ? `${formatGpa(displayedGpa)}/4.33`
              : "--"}
          </strong>
        </div>
        <div>
          <span>计划内已通过</span>
          <strong>{counts ? `${counts.passed}/${counts.total}` : "--"}</strong>
        </div>
        <div>
          <span>当前在读</span>
          <strong>{counts?.studying ?? "--"}</strong>
        </div>
        <div className={counts?.failed ? "progress-summary-alert" : ""}>
          <span>未通过</span>
          <strong>{counts?.failed ?? "--"}</strong>
        </div>
      </section>
      {roots.length > 0 && (
        <section className="progress-categories">
          <div className="section-heading">
            <div>
              <span className="eyebrow">{usingGradeGroups ? "成绩归类" : "培养方案"}</span>
              <h2>{usingGradeGroups ? "已修课程" : progress.program || "学分要求"}</h2>
            </div>
            <span>
              {usingGradeGroups
                ? "API 未提供培养方案明细，以下按已同步成绩归类"
                : progress.roots?.length
                ? `${roots.length} 个主类目 · 按培养方案层级展示`
                : `${roots.length} 个主类目`}
            </span>
          </div>
          <div className="requirement-map">
            {roots.map((root) => (
              <article key={root.id} className="requirement-root">
                <RequirementNode
                  requirement={root}
                  isExpanded={isRequirementExpanded}
                  onToggle={toggleRequirement}
                />
              </article>
            ))}
          </div>
        </section>
      )}
      <section className="selected-course-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">已选课程</span>
            <h2>按学期</h2>
          </div>
          <TermSelector
            terms={terms}
            value={termFilter}
            onChange={setTermFilter}
          />
        </div>
        {current.length ? (
          <div className="data-table-wrap">
            <table className="data-table selected-course-table">
              <thead>
                <tr>
                  <th>课程</th>
                  <th>学分</th>
                  <th>类别</th>
                  <th>教师</th>
                  <th>时间</th>
                  <th>地点</th>
                </tr>
              </thead>
              <tbody>
                {current.map((course) => (
                  <tr key={course.id}>
                    <td>
                      <strong>{course.title}</strong>
                      <small>{course.courseCode || "--"}</small>
                    </td>
                    <td>{course.credits ?? "--"}</td>
                    <td>{course.category || "--"}</td>
                    <td>{course.teacher || "--"}</td>
                    <td>{course.time || "--"}</td>
                    <td>{course.location || "--"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={BookOpen}
            title="暂无已选课程"
            detail="该学期的已选课程会在同步后显示"
          />
        )}
      </section>
    </div>
  );
}
