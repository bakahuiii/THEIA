import {
  BookOpen,
  CalendarRange,
  Download,
  ExternalLink,
  FileText,
  Info,
  GraduationCap,
  LoaderCircle,
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
import type { CampusState, Course, CourseResource } from "../types";

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
  onRefreshResources,
  onDownloadResource,
  onOpenSource,
}: {
  courses: Course[];
  state: CampusState;
  query: string;
  terms: Term[];
  onRefreshResources: (courseId: string) => Promise<unknown>;
  onDownloadResource: (courseId: string, resourceId: string) => Promise<unknown>;
  onOpenSource: (url: string) => Promise<unknown>;
}) {
  const [termId, setTermId] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("__all__");
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<CourseMaterialSelection | null>(null);
  const [refreshingCourseId, setRefreshingCourseId] = useState<string | null>(null);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [downloadingResourceId, setDownloadingResourceId] = useState<string | null>(null);
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
  const selectedLinks = selectedCourse?.resourceLinks || [];
  const selectedResources = selectedCourse?.courseResources || [];
  const previewLinks = selectedCourse?.teachingMaterials?.length
    ? selectedCourse.teachingMaterials
    : selectedLinks.filter((item) => /大纲|日历|简介|基本信息|课程介绍|教学/i.test(item.title));
  const otherLinks = selectedLinks.filter((link) => !previewLinks.some((item) => item.url === link.url && item.title === link.title));
  const courseInfoEntries = selectedCourse?.courseInfo
    ? Object.entries(selectedCourse.courseInfo).filter(([, value]) => value !== null && value !== undefined && String(value).trim())
    : [];
  const courseInfoDetails = courseInfoEntries.map(([key, value]) => ({
    label: courseInfoFieldLabel(key),
    value: String(value),
  }));
  const refreshResources = async (course: Course) => {
    setRefreshingCourseId(course.id);
    setResourceError(null);
    try {
      await onRefreshResources(course.id);
    } catch (error) {
      setResourceError(error instanceof Error ? error.message : "课程资源获取失败");
    } finally {
      setRefreshingCourseId(null);
    }
  };
  const downloadResource = async (course: Course, resource: CourseResource) => {
    setDownloadingResourceId(resource.id);
    setResourceError(null);
    try {
      await onDownloadResource(course.id, resource.id);
    } catch (error) {
      setResourceError(error instanceof Error ? error.message : "课程资源下载失败");
    } finally {
      setDownloadingResourceId(null);
    }
  };
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
                        url: selectedCourse.sourceUrl || selectedLinks[0]?.url || null,
                        sourceLabel: selectedCourse.sourceUrl
                          ? "课程主页 · 基本信息"
                          : "课程基本资料 · 内置查看",
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
                {selectedCourse.sourceUrl && <button type="button" className="icon-button" title="打开课程主页" aria-label="打开课程主页" onClick={() => void onOpenSource(selectedCourse.sourceUrl!)}><ExternalLink size={15} /></button>}
              </div>
             {previewLinks.length ? (
               <div className="course-link-list">
                 {previewLinks.map((link) => {
                   const material = "id" in link
                     ? link as {
                       id: string;
                       contentPreview?: string | null;
                       fetchedAt?: string | null;
                       fetchStatus?: string | null;
                       fetchError?: string | null;
                     }
                     : null;
                   const hasPreview = Boolean(material?.contentPreview);
                   return <div className="course-link-item" key={link.title + ":" + link.url}>
                     <FileText size={15} />
                     <button type="button" className="course-material-preview" onClick={() => {
                       setSelectedMaterial({
                         kind: "teaching-material",
                         title: link.title,
                         url: link.url,
                         sourceLabel: material?.fetchedAt
                           ? "课程资料 · " + (material.fetchStatus === "succeeded" ? "已抓取" : "抓取失败")
                           : "课程资料 · 内置查看",
                         preview: material?.contentPreview || null,
                         details: [
                           material?.fetchStatus ? { label: "抓取状态", value: material.fetchStatus } : null,
                           material?.fetchedAt ? { label: "抓取时间", value: material.fetchedAt } : null,
                           material?.fetchError ? { label: "抓取错误", value: material.fetchError } : null,
                         ].filter((item): item is { label: string; value: string } => Boolean(item)),
                       })
                     }}><span>{link.title}</span><small>{hasPreview ? "预览" : "详情"}</small></button>
                     <button type="button" className="icon-button" title="打开学校原站" aria-label="打开学校原站" onClick={() => void onOpenSource(link.url)}><ExternalLink size={13} /></button>
                   </div>;
                 })}
               </div>
             ) : <p className="course-detail-empty">暂未发现教学大纲、教学日历等入口。</p>}
             {otherLinks.length > 0 && <div className="course-link-list course-link-list-secondary">{otherLinks.slice(0, 12).map((link) => <div className="course-link-item" key={link.title + ":" + link.url}><FileText size={15} /><button type="button" className="course-material-preview" onClick={() => setSelectedMaterial({ kind: "link", title: link.title, url: link.url, sourceLabel: "课程入口 · 内置查看", preview: null })}><span>{link.title}</span><small>查看</small></button><button type="button" className="icon-button" title="打开学校原站" aria-label="打开学校原站" onClick={() => void onOpenSource(link.url)}><ExternalLink size={14} /></button></div>)}</div>}
            </section>
            <section className="course-detail-section">
              <div className="course-detail-section-head">
                <h4>课程资源</h4>
                <button type="button" className="link-button" disabled={refreshingCourseId === selectedCourse.id} onClick={() => void refreshResources(selectedCourse)}>
                  {refreshingCourseId === selectedCourse.id ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />}
                  {refreshingCourseId === selectedCourse.id ? "获取中" : "抓取课程资源"}
                </button>
              </div>
              {resourceError && <p className="course-detail-error">{resourceError}</p>}
              {selectedResources.length ? (
                <div className="course-resource-list">
                  {selectedResources.map((resource: CourseResource) => <div className="course-resource-item" key={resource.id}>
                    <FileText size={14} />
                    <button type="button" className="course-resource-link" onClick={() => setSelectedMaterial({
                      kind: "resource",
                      title: resource.title,
                      url: resource.url,
                      sourceLabel: resource.kind === "folder" ? "课程资源 · 文件夹" : "课程资源 · 文件",
                      preview: null,
                      details: [
                        { label: "资源类型", value: resource.kind || "file" },
                        resource.fileName ? { label: "文件名", value: resource.fileName } : null,
                        resource.cachedAt ? { label: "缓存时间", value: resource.cachedAt } : null,
                        resource.cachedFileName ? { label: "缓存文件", value: resource.cachedFileName } : null,
                        resource.cachedBytes != null ? { label: "缓存大小", value: String(resource.cachedBytes) + " bytes" } : null,
                      ].filter((item): item is { label: string; value: string } => Boolean(item)),
                    })}><span>{resource.title}</span></button>
                    <button type="button" className="icon-button" title="打开学校原站" aria-label="打开学校原站" onClick={() => void onOpenSource(resource.url)}><ExternalLink size={13} /></button>
                    {resource.kind !== "folder" && <button type="button" className="icon-button course-resource-download" title={resource.cachedAt ? "打开已下载文件" : "下载课程资源"} aria-label={resource.cachedAt ? "打开已下载文件" : "下载课程资源"} disabled={downloadingResourceId === resource.id} onClick={() => void downloadResource(selectedCourse, resource)}>
                      {downloadingResourceId === resource.id ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />}
                    </button>}
                  </div>)}
                </div>
              ) : <p className="course-detail-empty">尚未抓取课程资源。资源较多时，点击上方按钮手动获取。</p>}
            </section>
          </DialogContent>
        )}
      </Dialog>
      <CourseMaterialDialog
        selection={selectedMaterial}
        onOpenChange={(open) => {
          if (!open) setSelectedMaterial(null);
        }}
        onOpenSource={onOpenSource}
      />
    </div>
  );
}
