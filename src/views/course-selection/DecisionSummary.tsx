import type { AdvisorCourseDecision } from "../../types";
import { confidenceLabels, duplicateStatusLabels, matchBasisLabels, scheduleStatusLabels } from "./selection-helpers";

export function DecisionSummary({ decision }: { decision: AdvisorCourseDecision }) {
  const match = decision.requirementMatches[0];
  const excluded = decision.score === null;
  const completeness = decision.completeness;
  return (
    <div className="min-w-64 max-w-80 whitespace-normal py-1">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="inline-flex min-h-5 items-center rounded-sm bg-[var(--teal-soft)] px-1.5 text-[10px] font-bold text-[var(--teal)]">
          {excluded ? "不参与排名" : `#${decision.rank} · ${decision.score} 分`}
        </span>
        <span className="inline-flex min-h-5 items-center rounded-sm border border-[var(--line)] px-1.5 text-[10px] font-semibold text-[var(--muted-foreground)]">
          {match ? confidenceLabels[match.confidence] : "置信度未知"}
        </span>
        <span
          className={`inline-flex min-h-5 items-center rounded-sm border px-1.5 text-[10px] font-semibold ${
            decision.scheduleStatus === "conflict"
              ? "border-red-300 bg-red-50 text-red-800"
              : decision.scheduleStatus === "clear"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-zinc-300 bg-zinc-100 text-zinc-700"
          }`}
        >
          {scheduleStatusLabels[decision.scheduleStatus]}
        </span>
        <span className="inline-flex min-h-5 items-center rounded-sm border border-[var(--line)] px-1.5 text-[10px] font-semibold text-[var(--muted-foreground)]">
          {duplicateStatusLabels[decision.duplicateStatus] || "重复状态未知"}
        </span>
        {completeness !== "complete" && (
          <span className="inline-flex min-h-5 items-center rounded-sm border border-fuchsia-200 bg-fuchsia-50 px-1.5 text-[10px] font-semibold text-fuchsia-900">
            {completeness === "partial" ? "数据部分完整" : "完整性未知"}
          </span>
        )}
      </div>
      <p className="mt-1.5 break-words text-[10px] leading-4 text-[var(--muted-foreground)] [overflow-wrap:anywhere]">
        {match ? `${matchBasisLabels[match.basis] || match.basis}：${match.label}` : "培养方案匹配未知"}
      </p>
      {decision.scheduleConflicts.length > 0 && (
        <p className="mt-1 break-words text-[10px] leading-4 text-red-700 [overflow-wrap:anywhere]">
          {decision.scheduleConflicts.map((conflict) => conflict.reason).join("；")}
        </p>
      )}
      <details className="mt-1 text-[10px] text-[var(--muted-foreground)]" onClick={(event) => event.stopPropagation()}>
        <summary className="cursor-pointer select-none font-semibold text-[var(--teal)]">查看排名理由</summary>
        <ul className="mt-1.5 grid min-w-0 gap-1 border-l border-[var(--line)] pl-2.5">
          {decision.reasons.map((reason, index) => (
            <li key={`${decision.id}:reason:${index}`} className="break-words leading-4 [overflow-wrap:anywhere]">{reason}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
