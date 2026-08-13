import {
  BookOpen,
  CalendarRange,
  GraduationCap,
  MapPin,
  UserRound,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  EmptyState,
  matchTerm,
  sourceLabel,
  TermSelector,
  type Term,
} from "../ui/app-shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CampusState, Course } from "../types";

function normalizeCourseValue(value?: string | null) {
  return String(value || "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function termRank(termId: string) {
  const [year = "0", term = ""] = termId.split("-");
  const sequence: Record<string, number> = { "3": 1, "12": 2, "16": 3 };
  return Number(year) * 10 + (sequence[term] || 0);
}

function relatedTerms(course: Course, state: CampusState, terms: Term[]) {
  const courseCodes = [course.id, course.code]
    .map(normalizeCourseValue)
    .filter(Boolean);
  const courseTitle = normalizeCourseValue(course.title);
  const matchesCourse = (item: {
    courseId?: string | null;
    courseCode?: string | null;
    code?: string | null;
    title?: string | null;
    courseName?: string | null;
  }) => {
    const itemCodes = [item.courseId, item.courseCode, item.code]
      .map(normalizeCourseValue)
      .filter(Boolean);
    return (
      itemCodes.some((code) => courseCodes.includes(code)) ||
      (!!courseTitle &&
        [item.title, item.courseName]
          .map(normalizeCourseValue)
          .some((title) => title === courseTitle))
    );
  };
  const ids = new Set<string>([
    ...(course.termIds || []),
    ...(course.termId ? [course.termId] : []),
    ...state.selectedCourses
      .filter(matchesCourse)
      .map((item) => item.termId)
      .filter((item): item is string => Boolean(item)),
    ...state.schedule
      .filter(matchesCourse)
      .map((item) => item.termId)
      .filter((item): item is string => Boolean(item)),
    ...state.grades
      .filter(matchesCourse)
      .map((item) => item.termId)
      .filter((item): item is string => Boolean(item)),
  ]);

  // THEOL only exposes the active course roster. Its term is the active
  // teaching term that has already been discovered from JWGLXT.
  if (!ids.size && course.source === "theol" && terms[0]?.id)
    ids.add(terms[0].id);

  return [...ids].sort((left, right) => termRank(right) - termRank(left));
}

export function CoursesView({
  courses,
  state,
  query,
  terms,
}: {
  courses: Course[];
  state: CampusState;
  query: string;
  terms: Term[];
}) {
  const [termId, setTermId] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("__all__");
  const theolCourses = useMemo(
    () => courses.filter((course) => course.source === "theol"),
    [courses],
  );
  const termLabels = useMemo(
    () => new Map(terms.map((term) => [term.id, term.label])),
    [terms],
  );
  const categories = useMemo(
    () => [...new Set(
      theolCourses
        .map((course) => String(course.category || "").trim())
        .filter(Boolean),
    )].sort((left, right) => left.localeCompare(right, "zh-CN")),
    [theolCourses],
  );
  const values = useMemo(
    () => theolCourses
      .map((course) => ({ course, termIds: relatedTerms(course, state, terms) }))
      .filter(({ course, termIds }) => {
        const matchesQuery = `${course.title} ${course.code || ""} ${course.teacher || ""}`
          .toLowerCase()
          .includes(query.toLowerCase());
        return (
          matchesQuery &&
          (categoryFilter === "__all__" ||
            String(course.category || "").trim() === categoryFilter) &&
          (!termId || termIds.some((courseTerm) => matchTerm(courseTerm, termId)))
        );
      }),
    [theolCourses, state, terms, query, categoryFilter, termId],
  );
  return (
    <div className="data-page">
      <div className="view-toolbar">
        <TermSelector terms={terms} value={termId} onChange={setTermId} />
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="course-category-select" size="sm">
            <SelectValue placeholder="课程类别" />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="__all__">全部类别</SelectItem>
            {categories.map((category) => (
              <SelectItem key={category} value={category}>
                {category}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {values.length ? (
        <div className="course-grid">
          {values.map(({ course, termIds }) => {
            const primaryTerm = termIds[0];
            const termText = primaryTerm
              ? termLabels.get(primaryTerm) || primaryTerm
              : "学期待同步";
            return (
            <article className="course-card" key={course.id}>
              <div className={`course-accent ${course.source}`} />
              <div className="course-card-head">
                <span>{course.code || "课程"}</span>
                <span className="source-tag">{sourceLabel(course.source)}</span>
              </div>
              <h3>{course.title}</h3>
              <p>
                <UserRound size={15} /> {course.teacher || "教师信息待同步"}
              </p>
              {course.credits != null && (
                <p>
                  <GraduationCap size={15} /> {course.credits} 学分
                  {course.category ? ` · ${course.category}` : ""}
                </p>
              )}
              {course.location && (
                <p>
                  <MapPin size={15} /> {course.location}
                </p>
              )}
              <footer className="course-origin">
                <CalendarRange size={14} />
                <span>来自 {termText}</span>
                {termIds.length > 1 && <small>等 {termIds.length} 个学期</small>}
              </footer>
            </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={BookOpen}
          title={query ? "没有匹配课程" : "暂无课程"}
          detail={
            query
              ? "尝试其他课程名、代码或教师"
              : "连接北化在线THEOL并同步后即可查看"
          }
        />
      )}
    </div>
  );
}
