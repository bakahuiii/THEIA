import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  GitCompareArrows,
  ListOrdered,
  Search,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useMemo } from "react";
import type {
  AdvisorCourseDecision,
  CourseSelectionCandidate,
  CourseSelectionCatalogPage,
  CourseSelectionPortal,
} from "../../types";
import { DecisionSummary } from "./DecisionSummary";
import { paginationPages } from "./selection-helpers";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function CandidateCatalog({
  portal,
  blockId,
  candidates,
  candidateCatalogPage,
  candidateId,
  candidateKeyword,
  advisorDecisions,
  advisorDecisionsCurrent,
  advisorDecisionLoading,
  advisorDecisionError,
  loading,
  activeJob,
  onBlockChange,
  onCandidateKeywordChange,
  onRetryAdvisor,
  onSelectCandidate,
  onLoadCandidatePage,
}: {
  portal: CourseSelectionPortal | null;
  blockId: string;
  candidates: CourseSelectionCandidate[];
  candidateCatalogPage: CourseSelectionCatalogPage;
  candidateId: string;
  candidateKeyword: string;
  advisorDecisions: AdvisorCourseDecision[];
  advisorDecisionsCurrent: boolean;
  advisorDecisionLoading: boolean;
  advisorDecisionError: boolean;
  loading: boolean;
  activeJob: boolean;
  onBlockChange: (value: string) => void;
  onCandidateKeywordChange: (value: string) => void;
  onRetryAdvisor: () => void;
  onSelectCandidate: (candidate: CourseSelectionCandidate) => void;
  onLoadCandidatePage: (page?: number, pageSize?: number) => void;
}) {
  const advisorDecisionByCandidate = useMemo(
    () => new Map(
      (advisorDecisionsCurrent ? advisorDecisions : []).map((decision) => [decision.candidateId, decision]),
    ),
    [advisorDecisions, advisorDecisionsCurrent],
  );
  const rankedCandidates = useMemo(
    () => candidates
      .map((candidate, index) => ({
        candidate,
        index,
        rank: advisorDecisionByCandidate.get(candidate.id)?.rank,
      }))
      .sort(
        (left, right) =>
          (left.rank ?? Number.POSITIVE_INFINITY) - (right.rank ?? Number.POSITIVE_INFINITY)
          || left.index - right.index,
      )
      .map(({ candidate }) => candidate),
    [advisorDecisionByCandidate, candidates],
  );
  const visibleCandidates = useMemo(() => {
    const keyword = candidateKeyword.trim().toLocaleLowerCase();
    if (!keyword) return rankedCandidates;
    return rankedCandidates.filter((candidate) =>
      [candidate.title, candidate.courseCode, candidate.teacher]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase().includes(keyword)),
    );
  }, [candidateKeyword, rankedCandidates]);
  const candidateTotal = Math.max(candidates.length, candidateCatalogPage.total);
  const candidatePages = Math.max(1, Math.ceil(candidateTotal / candidateCatalogPage.pageSize));

  return (
    <section className="selection-catalog">
      <div className="selection-controls">
        <label>
          <span>课程类别 / 选课模块</span>
          <Select value={blockId} onValueChange={onBlockChange}>
            <SelectTrigger className="selection-module-select" disabled={loading || activeJob}>
              <SelectValue placeholder="选择课程类别" />
            </SelectTrigger>
            <SelectContent position="popper">
              {portal?.blocks.map((block) => (
                <SelectItem key={block.id} value={block.id}>{block.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <button
          className="primary-button"
          onClick={() => onLoadCandidatePage(1)}
          disabled={loading || activeJob || !blockId}
        >
          <Search size={16} /> 读取教学班
        </button>
      </div>
      {candidates.length ? (
        <div className="selection-catalog-results">
          <div className="selection-catalog-toolbar">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span>{candidateTotal} 门课程 · 第 {candidateCatalogPage.page} / {candidatePages} 页</span>
              {advisorDecisionLoading ? (
                <span className="inline-flex items-center gap-1 text-[var(--teal)]" role="status">
                  <RefreshCw size={12} className="spinning" /> 正在计算本页排名
                </span>
              ) : advisorDecisionError ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[var(--red)]"
                  onClick={onRetryAdvisor}
                >
                  <RefreshCw size={12} /> 排名不可用，重试
                </button>
              ) : advisorDecisionsCurrent ? (
                <span className="inline-flex items-center gap-1 text-[var(--teal)]">
                  <ShieldCheck size={12} /> 本页只读排名
                </span>
              ) : null}
            </span>
            <label className="selection-catalog-filter">
              <Search size={14} />
              <input
                value={candidateKeyword}
                placeholder="筛选本页课程或教师"
                onChange={(event) => onCandidateKeywordChange(event.target.value)}
              />
            </label>
          </div>
          <div className="data-table-wrap selection-candidate-table-wrap">
            <table className="data-table selection-table">
              <thead>
                <tr>
                  <th />
                  <th>课程 / 教学班</th>
                  <th>教师</th>
                  <th>时间地点</th>
                  <th>余量</th>
                  <th>学分</th>
                  <th>本地顾问排名</th>
                </tr>
              </thead>
              <tbody>
                {visibleCandidates.map((candidate) => (
                  <tr
                    key={candidate.id}
                    className={candidate.id === candidateId ? "selected" : ""}
                    onClick={() => onSelectCandidate(candidate)}
                  >
                    <td>
                      <input
                        aria-label={`选择 ${candidate.title}`}
                        type="radio"
                        name="course-selection-candidate"
                        checked={candidate.id === candidateId}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() => onSelectCandidate(candidate)}
                        disabled={activeJob}
                      />
                    </td>
                    <td>
                      <strong>{candidate.title}</strong>
                      <small>{[candidate.courseCode, candidate.className, candidate.classId || candidate.operationId].filter(Boolean).join(" · ")}</small>
                    </td>
                    <td>{candidate.teacher || "--"}</td>
                    <td><span>{candidate.time || "--"}</span><small>{candidate.location || "--"}</small></td>
                    <td>
                      {candidate.remainingSeats === null || candidate.remainingSeats === undefined
                        ? "--"
                        : <span className={candidate.remainingSeats > 0 ? "seat-open" : "seat-full"}>{candidate.remainingSeats} / {candidate.capacity ?? "--"}</span>}
                    </td>
                    <td>{candidate.credits ?? "--"}</td>
                    <td>
                      {advisorDecisionByCandidate.has(candidate.id) ? (
                        <DecisionSummary decision={advisorDecisionByCandidate.get(candidate.id)!} />
                      ) : advisorDecisionLoading ? (
                        <span className="inline-flex items-center gap-1 text-[10px] text-[var(--muted-foreground)]">
                          <ListOrdered size={13} /> 计算中
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] text-[var(--muted-foreground)]">
                          <GitCompareArrows size={13} /> 按原顺序显示
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {!visibleCandidates.length && (
                  <tr className="selection-filter-empty"><td colSpan={7}>本页没有符合筛选条件的教学班</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {candidatePages > 1 && (
            <div className="selection-catalog-pagination" aria-label="抢课候选分页">
              <div className="school-schedule-page-size">
                <span>每页</span>
                <Select value={String(candidateCatalogPage.pageSize)} onValueChange={(value) => onLoadCandidatePage(1, Number(value))}>
                  <SelectTrigger disabled={loading || activeJob}><SelectValue /></SelectTrigger>
                  <SelectContent position="popper">
                    {[24, 48, 96].map((pageSize) => <SelectItem key={pageSize} value={String(pageSize)}>{pageSize} 条</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="school-schedule-page-buttons">
                <button className="icon-button" aria-label="上一页" data-tooltip="上一页" disabled={loading || activeJob || candidateCatalogPage.page <= 1} onClick={() => onLoadCandidatePage(candidateCatalogPage.page - 1)}><ChevronLeft size={16} /></button>
                {paginationPages(candidateCatalogPage.page, candidatePages).map((page, index, pages) => (
                  <span className="school-schedule-page-group" key={page}>
                    {index > 0 && page - pages[index - 1] > 1 && <i>…</i>}
                    <button className={page === candidateCatalogPage.page ? "active" : ""} aria-current={page === candidateCatalogPage.page ? "page" : undefined} disabled={loading || activeJob} onClick={() => onLoadCandidatePage(page)}>{page}</button>
                  </span>
                ))}
                <button className="icon-button" aria-label="下一页" data-tooltip="下一页" disabled={loading || activeJob || candidateCatalogPage.page >= candidatePages} onClick={() => onLoadCandidatePage(candidateCatalogPage.page + 1)}><ChevronRight size={16} /></button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="selection-catalog-empty">
          <BookOpen size={18} />
          <span>选择模块后读取可选教学班</span>
        </div>
      )}
    </section>
  );
}
