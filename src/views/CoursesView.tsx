import {
  BookOpen,
  CalendarRange,
  FileText,
  Info,
  GraduationCap,
  MapPin,
  RefreshCw,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../components/ui/dialog";
import {
  CourseMaterialDialog,
  type CourseMaterialSelection,
} from "./courses/CourseMaterialDialog";
import type { CampusState, Course } from "../types";

const COURSE_INFO_FIELD_LABELS = Object.freeze({
  department: "所属院系",
  enrolled: "选课人数",
  resourceCount: "课程资源数",
  videoCount: "视频资源数",
  noticeCount: "课程通知数",
  assignmentCount: "课程作业数",
});

function courseInfoFieldLabel(key: string) {
  return COURSE_INFO_FIELD_LABELS[key as keyof typeof COURSE_INFO_FIELD_LABELS] || key;
}

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
  onOpenMaterial,
  onRefreshMaterials,
  refreshingMaterials,
}: {
  courses: Course[];
  state: CampusState;
  query: string;
  terms: Term[];
  onOpenMaterial: (courseId: string, materialId: string) => Promise<unknown>;
  onRefreshMaterials: () => void;
  refreshingMaterials: boolean;
}) {
  const [termId, setTermId] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("__all__");
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<CourseMaterialSelection | null>(null);
  const [resourceError, setResourceError] = useState<string | null>(null);
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
  const selectedCourse = selectedCourseId
    ? theolCourses.find((course) => course.id === selectedCourseId) || null
    : null;
  const previewLinks = selectedCourse?.teachingMaterials || [];
  const courseInfoEntries = selectedCourse?.courseInfo
    ? Object.entries(selectedCourse.courseInfo).filter(([, value]) => value !== null && value !== undefined && String(value).trim())
    : [];
  const courseInfoDetails = courseInfoEntries.map(([key, value]) => ({
    label: courseInfoFieldLabel(key),
    value: String(value),
  }));
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
        <button
          type="button"
          className="primary-button course-material-sync-button"
          onClick={onRefreshMaterials}
          disabled={refreshingMaterials || !theolCourses.length}
          title="仅抓取课程介绍、教学大纲和教学日历"
        >
          <RefreshCw size={15} className={refreshingMaterials ? "spinning" : ""} />
          {refreshingMaterials ? "正在抓取课程资料" : "抓取课程资料"}
        </button>
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
              <div className="course-card-actions">
                <button type="button" className="link-button course-material-button" onClick={() => { setResourceError(null); setSelectedMaterial(null); setSelectedCourseId(course.id); }}>
                  <FileText size={14} /> 课程资料
                </button>
              </div>
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
      <Dialog
        open={Boolean(selectedCourse)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedCourseId(null);
            setResourceError(null);
            setSelectedMaterial(null);
          }
        }}
      >
        {selectedCourse && (
          <DialogContent className="course-detail-dialog">
            <div className="course-detail-heading">
              <div>
                <DialogTitle>{selectedCourse.title}</DialogTitle>
                <DialogDescription>
                  {selectedCourse.code || "THEOL 课程"} · {selectedCourse.teacher || "教师信息待同步"}
                </DialogDescription>
              </div>
              <span className="source-tag">北化在线THEOL</span>
            </div>
            {selectedCourse.description && <p className="course-detail-description">{selectedCourse.description}</p>}
            {courseInfoEntries.length > 0 && (
              <>
                <div className="course-detail-section-head">
                  <h4>课程基本信息</h4>
                  <button
                    type="button"
                    className="link-button course-info-button"
                    onClick={() => {
                      setSelectedMaterial({
                        kind: "course-info",
                        title: selectedCourse.title,
                        url: null,
                        courseId: selectedCourse.id,
                        materialId: selectedCourse.teachingMaterials?.find((item) => item.materialType === "introduction")?.id || null,
                        sourceLabel: "课程介绍 · 本地归档",
                        preview: selectedCourse.description || null,
                        details: courseInfoDetails,
                      })
                    }}
                  >
                    <Info size={14} /> 查看完整基本信息
                  </button>
                </div>
                <dl className="course-detail-facts">
                  {courseInfoDetails.map((item) => (
                    <div key={item.label}>
                      <dt>{item.label}</dt>
                      <dd>{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
            <section className="course-detail-section">
              <div className="course-detail-section-head">
                <h4>课程资料</h4>
              </div>
              {resourceError && <p className="course-detail-error">{resourceError}</p>}
              {previewLinks.length ? (
                <div className="course-link-list">
                  {previewLinks.map((material) => {
                    const saved = Boolean(material.localPath) && ["saved", "partial", "stale"].includes(material.localStatus || "")
                    const label = material.materialType === "syllabus" ? "教学大纲" : material.materialType === "calendar" ? "教学日历" : "课程介绍"
                    return <div className="course-link-item" key={material.id}>
                      <FileText size={15} />
                      <button type="button" className="course-material-preview" onClick={() => {
                        if (saved) {
                          void onOpenMaterial(selectedCourse.id, material.id)
                          return
                        }
                        setSelectedMaterial({
                          kind: "teaching-material",
                          title: material.title,
                          url: null,
                          courseId: selectedCourse.id,
                          materialId: material.id,
                          sourceLabel: `${label} · ${material.localError || "尚未成功归档"}`,
                          preview: material.contentPreview || null,
                          details: [
                            { label: "归档状态", value: material.localStatus || material.fetchStatus || "未抓取" },
                            material.localError || material.fetchError ? { label: "抓取错误", value: material.localError || material.fetchError || "" } : null,
                          ].filter((item): item is { label: string; value: string } => Boolean(item)),
                        })
                      }}><span>{label}</span><small>{saved ? (material.localStatus === "partial" ? "部分保存" : "打开本地") : "抓取失败"}</small></button>
                    </div>
                  })}
                </div>
              ) : <p className="course-detail-empty">尚未保存课程介绍、教学大纲或教学日历。</p>}
            </section>
          </DialogContent>
        )}
      </Dialog>
      <CourseMaterialDialog
        selection={selectedMaterial}
        onOpenChange={(open) => {
          if (!open) setSelectedMaterial(null);
        }}
        onOpenLocal={onOpenMaterial}
      />
    </div>
  );
}
