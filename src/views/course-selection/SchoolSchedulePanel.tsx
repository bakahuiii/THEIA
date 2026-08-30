import {
  ArrowDownUp,
  BookOpen,
  CircleAlert,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, type Term } from "../../ui/app-shared";
import type { SchoolScheduleItem, SchoolScheduleQuery, SchoolScheduleResult } from "../../types";
import {
  SCHOOL_SCHEDULE_OVERSCAN,
  SCHOOL_SCHEDULE_ROW_HEIGHT,
  schoolScheduleColumns,
  schoolScheduleSortValue,
  schoolScheduleUpdatedAt,
  schoolTermLabel,
  schoolTermParts,
  type SchoolScheduleSort,
  type SchoolScheduleSortKey,
} from "./selection-helpers";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function SchoolSchedulePanel({
  schoolSchedule,
  schoolScheduleLoading,
  schoolScheduleError,
  schoolScheduleRefreshFailed,
  terms,
  preferredTermId,
  schoolTarget,
  onSearchSchoolSchedule,
  onDismissSchoolScheduleError,
  onSaveSchoolTarget,
}: {
  schoolSchedule: SchoolScheduleResult | null;
  schoolScheduleLoading: boolean;
  schoolScheduleError: string | null;
  schoolScheduleRefreshFailed: boolean;
  terms: Term[];
  preferredTermId: string | null;
  schoolTarget: SchoolScheduleItem | null;
  onSearchSchoolSchedule: (query: SchoolScheduleQuery) => void;
  onDismissSchoolScheduleError: () => void;
  onSaveSchoolTarget: (target: SchoolScheduleItem) => void;
}) {
  const [schoolYear, setSchoolYear] = useState("");
  const [schoolTerm, setSchoolTerm] = useState("");
  const [schoolKeyword, setSchoolKeyword] = useState("");
  const [schoolDepartment, setSchoolDepartment] = useState("");
  const [schoolCategory, setSchoolCategory] = useState("");
  const [schoolNature, setSchoolNature] = useState("");
  const [schoolAffiliation, setSchoolAffiliation] = useState("");
  const [schoolScheduleSort, setSchoolScheduleSort] = useState<SchoolScheduleSort | null>(null);
  const schoolScheduleTableRef = useRef<HTMLDivElement>(null);
  const [schoolScheduleViewport, setSchoolScheduleViewport] = useState({
    scrollTop: 0,
    height: 560,
  });
  const schoolYears = useMemo(
    () => [...new Set(terms.map((term) => schoolTermParts(term.id).year).filter((year) => /^20\d{2}$/.test(year)))]
      .sort((left, right) => right.localeCompare(left)),
    [terms],
  );
  const schoolTerms = useMemo(
    () => terms.filter((term) => schoolTermParts(term.id).year === schoolYear)
      .sort((left, right) => Number(schoolTermParts(left.id).term) - Number(schoolTermParts(right.id).term)),
    [schoolYear, terms],
  );
  const schoolTermId = useMemo(
    () => schoolTerms.find((term) => schoolTermParts(term.id).term === schoolTerm)?.id || "",
    [schoolTerm, schoolTerms],
  );
  useEffect(() => {
    const preferred = schoolTermParts(preferredTermId || terms[0]?.id || "");
    setSchoolYear((current) => schoolYears.includes(current) ? current : preferred.year);
  }, [preferredTermId, schoolYears, terms]);
  useEffect(() => {
    setSchoolTerm((current) =>
      schoolTerms.some((term) => schoolTermParts(term.id).term === current)
        ? current
        : schoolTermParts(schoolTerms[0]?.id || "").term,
    );
  }, [schoolTerms]);
  const schoolFilterOptions = useMemo(() => {
    const values = (key: "department" | "category" | "nature" | "affiliation") =>
      [...new Set((schoolSchedule?.items || []).map((item) => String(item[key] || "").trim()).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right, "zh-CN"));
    return {
      departments: values("department"),
      categories: values("category"),
      natures: values("nature"),
      affiliations: values("affiliation"),
    };
  }, [schoolSchedule]);
  const visibleSchoolItems = useMemo(() => {
    const query = schoolKeyword.trim().toLocaleLowerCase();
    return (schoolSchedule?.items || []).filter((item) => {
      const searchText = [item.title, item.courseCode, item.className, item.combinedClassInfo].filter(Boolean).join(" ").toLocaleLowerCase();
      return (!query || searchText.includes(query))
        && (!schoolDepartment || item.department === schoolDepartment)
        && (!schoolCategory || item.category === schoolCategory)
        && (!schoolNature || item.nature === schoolNature)
        && (!schoolAffiliation || item.affiliation === schoolAffiliation);
    });
  }, [schoolAffiliation, schoolCategory, schoolDepartment, schoolKeyword, schoolNature, schoolSchedule]);
  const sortedSchoolItems = useMemo(() => {
    if (!schoolScheduleSort) return visibleSchoolItems;
    return [...visibleSchoolItems].sort((left, right) => {
      const leftValue = schoolScheduleSortValue(left, schoolScheduleSort.key);
      const rightValue = schoolScheduleSortValue(right, schoolScheduleSort.key);
      const compared = typeof leftValue === "number" && typeof rightValue === "number"
        ? leftValue - rightValue
        : String(leftValue).localeCompare(String(rightValue), "zh-CN", { numeric: true, sensitivity: "base" });
      return schoolScheduleSort.direction === "asc" ? compared : -compared;
    });
  }, [schoolScheduleSort, visibleSchoolItems]);
  const schoolScheduleRange = useMemo(() => {
    const visibleRows = Math.ceil(schoolScheduleViewport.height / SCHOOL_SCHEDULE_ROW_HEIGHT);
    const start = Math.max(0, Math.floor(schoolScheduleViewport.scrollTop / SCHOOL_SCHEDULE_ROW_HEIGHT) - SCHOOL_SCHEDULE_OVERSCAN);
    const end = Math.min(sortedSchoolItems.length, start + visibleRows + SCHOOL_SCHEDULE_OVERSCAN * 2);
    return { start, end };
  }, [schoolScheduleViewport, sortedSchoolItems.length]);
  const virtualSchoolItems = useMemo(
    () => sortedSchoolItems.slice(schoolScheduleRange.start, schoolScheduleRange.end),
    [schoolScheduleRange, sortedSchoolItems],
  );
  const updateSchoolScheduleViewport = useCallback(() => {
    const element = schoolScheduleTableRef.current;
    if (!element) return;
    setSchoolScheduleViewport((current) => {
      const next = { scrollTop: element.scrollTop, height: element.clientHeight };
      return current.scrollTop === next.scrollTop && current.height === next.height ? current : next;
    });
  }, []);
  useEffect(() => {
    const element = schoolScheduleTableRef.current;
    if (!element) return;
    const resizeObserver = new ResizeObserver(updateSchoolScheduleViewport);
    resizeObserver.observe(element);
    updateSchoolScheduleViewport();
    return () => resizeObserver.disconnect();
  }, [sortedSchoolItems.length, updateSchoolScheduleViewport]);
  useEffect(() => {
    const element = schoolScheduleTableRef.current;
    if (!element) return;
    element.scrollTop = 0;
    updateSchoolScheduleViewport();
  }, [schoolAffiliation, schoolCategory, schoolDepartment, schoolKeyword, schoolNature, schoolSchedule, schoolScheduleSort, updateSchoolScheduleViewport]);
  const toggleSchoolScheduleSort = (key: SchoolScheduleSortKey) => {
    setSchoolScheduleSort((current) =>
      current?.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  };
  const runSchoolSearch = () => {
    onSearchSchoolSchedule({
      termId: schoolTermId,
      forceRefresh: true,
    });
  };
  const displayedSchoolTerm = terms.find((term) => term.id === schoolSchedule?.scope.termId)?.label
    || schoolSchedule?.scope.termId
    || null;
  const schoolScheduleFreshness = schoolScheduleLoading && schoolSchedule
    ? "正在从教务更新，当前显示上次数据"
    : schoolScheduleRefreshFailed
      ? "更新失败，正在显示上次数据"
      : schoolSchedule?.fromCache === false
        ? `刚从教务更新${schoolSchedule.capturedAt ? ` · ${schoolScheduleUpdatedAt(schoolSchedule.capturedAt)}` : ""}`
        : schoolSchedule
          ? `本地数据，更新于 ${schoolScheduleUpdatedAt(schoolSchedule.capturedAt)}`
          : null;

  return (
<section className="school-schedule-search">
  <div className="section-heading">
    <div>
      <span className="eyebrow">全校课表</span>
      <h2>先查课，再定位教学班</h2>
    </div>
    {schoolSchedule && <div className="school-schedule-heading-meta">
      <span>{visibleSchoolItems.length} / {schoolSchedule.total} 个教学班</span>
      {schoolScheduleFreshness && <small className={schoolScheduleLoading ? "syncing" : schoolScheduleRefreshFailed ? "failed" : schoolSchedule.fromCache === false ? "fresh" : "cached"}>
        {displayedSchoolTerm ? `${displayedSchoolTerm} · ` : ""}{schoolScheduleFreshness}
      </small>}
    </div>}
  </div>
  <div className="school-schedule-controls">
    <label>
      <span>学年</span>
      <Select value={schoolYear} onValueChange={setSchoolYear}>
        <SelectTrigger disabled={schoolScheduleLoading}>
          <SelectValue placeholder="选择学年" />
        </SelectTrigger>
        <SelectContent position="popper">
          {schoolYears.map((year) => <SelectItem key={year} value={year}>{year}-{Number(year) + 1}</SelectItem>)}
        </SelectContent>
      </Select>
    </label>
    <label>
      <span>学期</span>
      <Select value={schoolTerm} onValueChange={setSchoolTerm}>
        <SelectTrigger disabled={schoolScheduleLoading || !schoolTerms.length}>
          <SelectValue placeholder="选择学期" />
        </SelectTrigger>
        <SelectContent position="popper">
          {schoolTerms.map((term) => {
            const value = schoolTermParts(term.id).term;
            return <SelectItem key={term.id} value={value}>{schoolTermLabel(value)}</SelectItem>;
          })}
        </SelectContent>
      </Select>
    </label>
    <label>
      <span>课程、教学班或合班信息</span>
      <input value={schoolKeyword} placeholder="例如：高等数学 / MAT13904T / 高材 2401" onChange={(event) => setSchoolKeyword(event.target.value)} />
    </label>
    <label>
      <span>开课部门</span>
      <Select value={schoolDepartment || "all"} onValueChange={(value) => setSchoolDepartment(value === "all" ? "" : value)}>
        <SelectTrigger disabled={schoolScheduleLoading}><SelectValue placeholder="全部部门" /></SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value="all">全部部门</SelectItem>
          {schoolFilterOptions.departments.map((department) => <SelectItem key={department} value={department}>{department}</SelectItem>)}
        </SelectContent>
      </Select>
    </label>
    <label>
      <span>课程类型</span>
      <Select
        value={schoolCategory || "all"}
        onValueChange={(value) => setSchoolCategory(value === "all" ? "" : value)}
      >
        <SelectTrigger disabled={schoolScheduleLoading}>
          <SelectValue placeholder="全部类型" />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value="all">全部类型</SelectItem>
          {schoolFilterOptions.categories.map((category) => (
            <SelectItem key={category} value={category}>{category}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
    <label>
      <span>课程性质</span>
      <Select value={schoolNature || "all"} onValueChange={(value) => setSchoolNature(value === "all" ? "" : value)}>
        <SelectTrigger disabled={schoolScheduleLoading}><SelectValue placeholder="全部性质" /></SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value="all">全部性质</SelectItem>
          {schoolFilterOptions.natures.map((nature) => <SelectItem key={nature} value={nature}>{nature}</SelectItem>)}
        </SelectContent>
      </Select>
    </label>
    <label>
      <span>课程归属</span>
      <Select value={schoolAffiliation || "all"} onValueChange={(value) => setSchoolAffiliation(value === "all" ? "" : value)}>
        <SelectTrigger disabled={schoolScheduleLoading}><SelectValue placeholder="全部归属" /></SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value="all">全部归属</SelectItem>
          {schoolFilterOptions.affiliations.map((affiliation) => <SelectItem key={affiliation} value={affiliation}>{affiliation}</SelectItem>)}
        </SelectContent>
      </Select>
    </label>
    <button
      className="secondary-button school-schedule-load-button"
      disabled={!schoolTermId || schoolScheduleLoading}
      onClick={runSchoolSearch}
    >
      <RefreshCw size={16} className={schoolScheduleLoading ? "spinning" : ""} /> {schoolSchedule ? "更新本学期课表" : "读取本学期课表"}
    </button>
  </div>
  {sortedSchoolItems.length ? (
    <div className="school-schedule-results">
      <div
        className="data-table-wrap school-schedule-table-wrap"
        ref={schoolScheduleTableRef}
        onScroll={updateSchoolScheduleViewport}
      >
        <table className="data-table school-schedule-table">
          <thead>
            <tr>
              {schoolScheduleColumns.map((column) => {
                const activeSort = schoolScheduleSort?.key === column.key;
                return (
                  <th
                    key={column.key}
                    aria-sort={
                      activeSort
                        ? schoolScheduleSort.direction === "asc" ? "ascending" : "descending"
                        : "none"
                    }
                  >
                    <button
                      className={`school-schedule-sort ${activeSort ? "active" : ""}`}
                      onClick={() => toggleSchoolScheduleSort(column.key)}
                    >
                      <span>{column.label}</span>
                      {activeSort ? (
                        schoolScheduleSort.direction === "asc" ? <ChevronUp size={13} /> : <ChevronDown size={13} />
                      ) : (
                        <ArrowDownUp size={12} />
                      )}
                    </button>
                  </th>
                );
              })}
              <th className="school-schedule-action-header">操作</th>
            </tr>
          </thead>
          <tbody>
            {schoolScheduleRange.start > 0 && (
              <tr className="school-schedule-virtual-spacer" aria-hidden="true">
                <td colSpan={schoolScheduleColumns.length + 1} style={{ height: schoolScheduleRange.start * SCHOOL_SCHEDULE_ROW_HEIGHT }} />
              </tr>
            )}
            {virtualSchoolItems.map((item) => (
              <tr key={item.id} className={schoolTarget?.id === item.id ? "selected" : ""}>
                <td className="school-schedule-course-cell">
                  <strong>{item.title}</strong>
                  <small>{item.courseCode || "--"}</small>
                </td>
                <td className="school-schedule-clamped-cell" title={item.className || undefined}><span>{item.className || "--"}</span></td>
                <td className="school-schedule-clamped-cell" title={item.combinedClassInfo || undefined}><span>{item.combinedClassInfo || "--"}</span></td>
                <td>{item.department || "--"}</td>
                <td>{item.teacher || "--"}</td>
                <td>{item.credits ?? "--"}</td>
                <td>{item.category || "--"}</td>
                <td>{item.nature || "--"}</td>
                <td>{item.affiliation || "--"}</td>
                <td>{item.time || "--"}</td>
                <td>{item.location || "--"}</td>
                <td>{item.status || "--"}</td>
                <td>
                  <button className="link-button" onClick={() => onSaveSchoolTarget(item)}>
                    {schoolTarget?.id === item.id ? "已作为目标" : "设为目标"}
                  </button>
                </td>
              </tr>
            ))}
            {schoolScheduleRange.end < sortedSchoolItems.length && (
              <tr className="school-schedule-virtual-spacer" aria-hidden="true">
                <td colSpan={schoolScheduleColumns.length + 1} style={{ height: (sortedSchoolItems.length - schoolScheduleRange.end) * SCHOOL_SCHEDULE_ROW_HEIGHT }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  ) : schoolSchedule ? (
    <EmptyState icon={BookOpen} title="没有匹配的教学班" detail="可更换课程关键字、教师、课程类型或学期后重新查询" />
  ) : null}
  <Dialog open={Boolean(schoolScheduleError)} onOpenChange={(open) => { if (!open) onDismissSchoolScheduleError(); }}>
    {schoolScheduleError && <DialogContent className="school-schedule-error-dialog" overlayClassName="sync-error-dialog-overlay" showCloseButton={false}>
      <DialogHeader className="school-schedule-error-heading">
        <CircleAlert size={20} />
        <div>
          <DialogTitle>课表更新失败</DialogTitle>
          <DialogDescription>
            {schoolSchedule ? "上次读取的课表仍然可以查看。" : "暂时没有可显示的课表。"}
          </DialogDescription>
        </div>
      </DialogHeader>
      <p className="school-schedule-error-detail">{schoolScheduleError}</p>
      <DialogFooter>
        <button type="button" className="secondary-button" onClick={onDismissSchoolScheduleError}>
          {schoolSchedule ? "继续使用上次数据" : "关闭"}
        </button>
        <button type="button" className="primary-button" onClick={() => { onDismissSchoolScheduleError(); runSchoolSearch(); }}>
          <RefreshCw size={15} /> 再次更新
        </button>
      </DialogFooter>
    </DialogContent>}
  </Dialog>
</section>
  );
}
