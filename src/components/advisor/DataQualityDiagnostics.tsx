import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Database,
  History,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import type { AdvisorDomainQuality, AdvisorEvidence, AdvisorSourceAttempt } from "../../types";
import { advisorDomainLabel } from "../../hooks/advisor-presentation.mjs";
import { formatAcademicTermId } from "../../ui/term-label";
import { formatDateTime } from "../../ui/app-shared";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";

const SOURCE_LABELS: Record<string, string> = {
  jwglxt: "教务系统",
  theol: "北化在线 THEOL",
  imap: "校园邮箱",
  local: "本地数据",
  fixture: "本地测试数据",
};

const ERROR_EXPLANATIONS: Record<string, string> = {
  auth_required: "最近一次读取要求重新登录，因此没有用本次响应替换已保存数据。",
  source_sync_failed: "最近一次同步没有获得可确认的来源响应，已保留之前的本地数据。",
  partial_source_errors: "来源返回了部分数据，同时报告了读取错误；THEIA 只合并可确认的部分。",
  partial_assignment_scan: "部分课程工作区未能完成扫描，作业列表可能仍含上一次保存的条目。",
  unconfirmed_empty_result: "本次返回为空，但来源没有明确确认“确无记录”；为避免误删，THEIA 保留了之前的数据。",
  schedule_payload_unpositioned: "来源给出了课程行，但没有有效的星期或节次定位；THEIA 保留了之前可排版的课表。",
  multiple_source_errors: "多个来源在本轮同步中返回了不同错误，当前数据由仍可确认的来源组成。",
  multiple_dependency_errors: "组成该汇总数据的多个子领域存在异常，请分别查看各子领域诊断。",
};

function sourceLabel(sources: string[] | null | undefined) {
  const labels = (Array.isArray(sources) ? sources : []).map((source) => SOURCE_LABELS[source] || source).filter(Boolean);
  return labels.length ? labels.join(" / ") : "来源未记录";
}

function lastAttemptOf(quality: AdvisorDomainQuality) {
  const lastAttempt = (quality as Partial<AdvisorDomainQuality>).lastAttempt;
  return lastAttempt && typeof lastAttempt === "object"
    ? lastAttempt
    : {
        runId: null,
        attemptedAt: null,
        completedAt: null,
        status: "never" as const,
        emptyConfirmed: false,
        retainedPrevious: false,
        errorCode: null,
      };
}

function sourceAttemptsOf(quality: AdvisorDomainQuality) {
  const sourceAttempts = (quality as Partial<AdvisorDomainQuality>).sourceAttempts;
  return Array.isArray(sourceAttempts) ? sourceAttempts : [];
}

function derivedFromOf(quality: AdvisorDomainQuality) {
  const derivedFrom = (quality as Partial<AdvisorDomainQuality>).derivedFrom;
  return Array.isArray(derivedFrom) ? derivedFrom : [];
}

function formatTimestamp(value: string | null) {
  return value ? formatDateTime(value, true) : "未记录";
}

function statusLabel(status: AdvisorSourceAttempt["status"]) {
  if (status === "succeeded") return "读取完成";
  if (status === "failed") return "读取失败";
  if (status === "auth-required") return "需要重新登录";
  if (status === "not-attempted") return "本轮未读取";
  return "尚未读取";
}

function completenessLabel(value: AdvisorSourceAttempt["completeness"]) {
  if (value === "complete") return "完整";
  if (value === "partial") return "部分结果";
  return "完整性未知";
}

function diagnosisReasons(quality: AdvisorDomainQuality) {
  const reasons: string[] = [];
  const lastAttempt = lastAttemptOf(quality);
  if (lastAttempt.status === "auth-required") reasons.push("最近一次读取需要重新登录。");
  else if (lastAttempt.status === "failed") reasons.push("最近一次读取失败。");
  if (lastAttempt.retainedPrevious) reasons.push("本轮没有完整替换旧数据，当前页面仍在使用已保存的先前数据。");
  if (quality.completeness === "partial") reasons.push("来源只确认了部分数据，未确认部分不会被当作空数据。");
  if (quality.completeness === "unknown") reasons.push("来源没有给出可验证的完整性结论。");
  if (quality.freshness === "stale") reasons.push("当前数据已超过该领域的自动新鲜度阈值。");
  if (quality.availability === "unknown") reasons.push("空结果没有被确认，因此不能解释为“没有记录”。");
  if (quality.provenanceInferred) reasons.push("该领域来自没有逐项同步证据的旧快照，时间与完整性都无法确认。");
  if (!reasons.length) reasons.push("当前已保存数据与最近读取状态没有发现可解释的异常。");
  return reasons;
}

function RecordMetric({ label, value }: { label: string; value: number | null }) {
  return (
    <span className="grid min-w-0 gap-0.5 rounded-md border border-[var(--line)] bg-[var(--canvas)] px-3 py-2">
      <span className="text-[10px] font-semibold text-[var(--muted-foreground)]">{label}</span>
      <strong className="text-sm tabular-nums text-[var(--ink)]">{value === null ? "未确认" : `${value} 条`}</strong>
    </span>
  );
}

function SourceAttemptCard({ attempt }: { attempt: AdvisorSourceAttempt }) {
  const hasIssue = attempt.status === "failed" || attempt.status === "auth-required" || attempt.completeness !== "complete" || attempt.retainedPrevious;
  const successfulTermIds = Array.isArray(attempt.successfulTermIds) ? attempt.successfulTermIds : [];
  const failedTermIds = Array.isArray(attempt.failedTermIds) ? attempt.failedTermIds : [];
  return (
    <li className="min-w-0 rounded-lg border border-[var(--line)] bg-[var(--canvas)] p-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <span className="min-w-0">
          <strong className="block break-words text-xs text-[var(--ink)] [overflow-wrap:anywhere]">{sourceLabel(attempt.source)}</strong>
          <span className="mt-1 block text-[10px] text-[var(--muted-foreground)]">
            {formatTimestamp(attempt.completedAt || attempt.attemptedAt)}
          </span>
        </span>
        <span className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold ${hasIssue ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"}`}>
          {statusLabel(attempt.status)} · {completenessLabel(attempt.completeness)}
        </span>
      </div>

      <div className="mt-3 grid min-w-0 grid-cols-2 gap-2">
        <RecordMetric label="同步前本地数据" value={attempt.previousRecordCount} />
        <RecordMetric label="本次可确认返回" value={attempt.receivedRecordCount} />
      </div>

      <div className="mt-3 grid min-w-0 gap-1.5 text-[11px] text-[var(--muted-foreground)]">
        {attempt.retainedPrevious && <span>已保留同步前数据，未以这次结果覆盖。</span>}
        {attempt.errorCode && (
          <span className="break-words [overflow-wrap:anywhere]">
            {ERROR_EXPLANATIONS[attempt.errorCode] || "来源返回了可定位的错误类别。"}
            <code className="ml-1 rounded border border-[var(--line)] bg-[var(--paper)] px-1 py-0.5 text-[10px] text-[var(--ink)]">{attempt.errorCode}</code>
          </span>
        )}
        {successfulTermIds.length > 0 && (
          <span className="break-words [overflow-wrap:anywhere]">已完成范围：{successfulTermIds.map(formatAcademicTermId).join("、")}</span>
        )}
        {failedTermIds.length > 0 && (
          <span className="break-words text-amber-800 dark:text-amber-200 [overflow-wrap:anywhere]">未完成范围：{failedTermIds.map(formatAcademicTermId).join("、")}</span>
        )}
        {attempt.parserVersion && <span>解析版本：{attempt.parserVersion}</span>}
      </div>
    </li>
  );
}

export function DataQualityDiagnostics({
  quality,
  open,
  onOpenChange,
  evidence,
  onShowEvidence,
  onRetry,
}: {
  quality: AdvisorDomainQuality | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  evidence: AdvisorEvidence[];
  onShowEvidence: () => void;
  onRetry: () => void;
}) {
  if (!quality) return null;
  const lastAttempt = lastAttemptOf(quality);
  const sourceAttempts = sourceAttemptsOf(quality);
  const derivedFrom = derivedFromOf(quality);
  const reasons = diagnosisReasons(quality);
  const isHealthy = reasons.length === 1 && reasons[0].startsWith("当前已保存");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" showCloseButton={false} overlayClassName="advisor-diagnostic-overlay" className="advisor-diagnostic-sheet w-[min(100vw,40rem)] max-w-full gap-0 overflow-hidden border-[var(--line)] bg-[var(--paper)] p-0 text-[var(--ink)] sm:max-w-[40rem]">
        <SheetHeader className="min-w-0 border-b border-[var(--line)] p-5 pr-14">
          <SheetTitle className="flex min-w-0 items-center gap-2 break-words text-base font-semibold [overflow-wrap:anywhere]">
            {isHealthy ? <CheckCircle2 className="size-4 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden="true" /> : <AlertCircle className="size-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />}
            数据诊断 · {advisorDomainLabel(quality.domain)}
          </SheetTitle>
          <SheetDescription className="mt-1 text-xs text-[var(--muted-foreground)]">
            这里展示当前保留内容与最近一次来源读取结果，便于判断是否需要重新同步。
          </SheetDescription>
        </SheetHeader>
        <SheetClose asChild>
          <button type="button" className="absolute right-3 top-3 grid size-9 place-items-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--canvas)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--teal)]" aria-label="关闭数据诊断" title="关闭">
            <X className="size-4" aria-hidden="true" />
          </button>
        </SheetClose>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-5">
          <section className="advisor-diagnostic-reasons rounded-lg border border-[var(--line)] bg-[var(--canvas)] p-4" aria-label="异常说明">
            <span className="flex items-center gap-2 text-xs font-semibold text-[var(--ink)]"><ShieldCheck className="size-4" aria-hidden="true" />为什么会出现这个状态</span>
            <ul className="mt-3 grid gap-2">
              {reasons.map((reason) => <li key={reason} className="flex gap-2 text-xs leading-5 text-[var(--muted-foreground)]"><span className="mt-2 size-1 shrink-0 rounded-full bg-[var(--teal)]" aria-hidden="true" />{reason}</li>)}
            </ul>
          </section>

          <section className="mt-4" aria-label="当前保留数据">
            <span className="flex items-center gap-2 text-xs font-semibold text-[var(--ink)]"><Database className="size-4" aria-hidden="true" />当前正在使用的本地数据</span>
            <div className="mt-2 grid min-w-0 grid-cols-2 gap-2">
              <RecordMetric label="当前保留记录" value={quality.recordCount} />
              <span className="grid min-w-0 gap-0.5 rounded-md border border-[var(--line)] bg-[var(--canvas)] px-3 py-2">
                <span className="text-[10px] font-semibold text-[var(--muted-foreground)]">最后可信数据时间</span>
                <strong className="truncate text-[11px] text-[var(--ink)]" title={formatTimestamp(quality.capturedAt)}>{formatTimestamp(quality.capturedAt)}</strong>
              </span>
            </div>
            <p className="mt-2 break-words text-[11px] leading-5 text-[var(--muted-foreground)] [overflow-wrap:anywhere]">来源：{sourceLabel(quality.source)}{lastAttempt.retainedPrevious ? "。这些数据来自较早的可确认快照，尚未被本轮结果完整替换。" : "。"}</p>
          </section>

          <section className="mt-5" aria-label="最近来源读取">
            <span className="flex items-center gap-2 text-xs font-semibold text-[var(--ink)]"><History className="size-4" aria-hidden="true" />最近一次来源读取</span>
            {sourceAttempts.length ? (
              <ol className="mt-2 grid min-w-0 gap-2">
                {sourceAttempts.map((attempt, index) => <SourceAttemptCard key={`${sourceLabel(attempt.source)}-${attempt.completedAt || index}`} attempt={attempt} />)}
              </ol>
            ) : (
              <p className="mt-2 rounded-md border border-dashed border-[var(--line-strong)] p-3 text-xs text-[var(--muted-foreground)]">该旧快照没有逐来源读取记录，无法比较本轮与之前的来源结果。</p>
            )}
          </section>

          {derivedFrom.length > 0 && <p className="mt-4 break-words text-[11px] text-[var(--muted-foreground)] [overflow-wrap:anywhere]">该领域由以下数据汇总：{derivedFrom.map(advisorDomainLabel).join("、")}</p>}

          <div className="mt-5 flex min-w-0 flex-wrap gap-2 border-t border-[var(--line)] pt-4">
            <button type="button" className="inline-flex min-h-9 items-center gap-2 rounded-md bg-[var(--teal)] px-3 text-xs font-semibold text-white hover:opacity-90" onClick={onRetry}>
              <RefreshCw className="size-3.5" aria-hidden="true" />重新同步
            </button>
            <button type="button" className="inline-flex min-h-9 items-center gap-2 rounded-md border border-[var(--line-strong)] px-3 text-xs font-semibold text-[var(--ink)]" onClick={onShowEvidence}>
              <Clock3 className="size-3.5" aria-hidden="true" />查看 {evidence.length} 条证据
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
