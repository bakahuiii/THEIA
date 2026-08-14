import {
  AlertCircle,
  CalendarClock,
  GraduationCap,
  Clock3,
  ExternalLink,
  FileSearch,
  LogIn,
  RefreshCw,
  RotateCcw,
  X,
  type LucideIcon,
} from "lucide-react";
import type { AdvisorRisk, AdvisorUrgentItem } from "../../types";

export type AdvisorRiskListItem = AdvisorUrgentItem | AdvisorRisk;

type FixedAction = { label: string; icon: LucideIcon };

const FIXED_ACTIONS: Record<string, FixedAction> = {
  resync: { label: "重新同步", icon: RefreshCw },
  reauthenticate: { label: "前往登录", icon: LogIn },
  "open-source-detail": { label: "打开来源详情", icon: ExternalLink },
  "review-assignment": { label: "查看作业", icon: ExternalLink },
  "prepare-exam": { label: "查看考试", icon: CalendarClock },
  "review-academic-gap": { label: "查看学业缺口", icon: GraduationCap },
  "review-course-selection-window": { label: "查看选课沙盘", icon: CalendarClock },
};

const SEVERITY: Record<AdvisorRiskListItem["severity"], { label: string; classes: string }> = {
  urgent: {
    label: "紧急",
    classes:
      "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200",
  },
  attention: {
    label: "需关注",
    classes:
      "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100",
  },
  info: {
    label: "提示",
    classes:
      "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200",
  },
};

function isUrgentItem(item: AdvisorRiskListItem): item is AdvisorUrgentItem {
  return "score" in item && "reasons" in item;
}

function itemReasons(item: AdvisorRiskListItem) {
  return isUrgentItem(item) ? item.reasons : item.why;
}

function formatDueAt(value: string | null) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function safeErrorMessage(error: string) {
  if (/(?:https?:\/\/|file:\/\/|[a-z]:[\\/]|\\\\|\/(?:users|home|var|tmp|opt|work)(?:\/|\b))/i.test(error)) {
    return "本地数据读取失败，请重试。";
  }
  return error.slice(0, 500);
}

function qualityLabels(item: AdvisorRiskListItem) {
  const labels: string[] = [];
  if (item.quality.lastAttemptStatus === "failed") labels.push("读取失败");
  if (item.quality.lastAttemptStatus === "auth-required") labels.push("需要登录");
  if (item.quality.availability === "unknown") labels.push("可用性未知");
  if (item.quality.freshness === "stale") labels.push("数据已过期");
  if (item.quality.freshness === "unknown") labels.push("新鲜度未知");
  if (item.quality.completeness === "partial") labels.push("部分完整");
  if (item.quality.completeness === "unknown") labels.push("完整性未知");
  return labels;
}

export interface RiskListProps {
  items: ReadonlyArray<AdvisorRiskListItem>;
  loading?: boolean;
  error?: string | null;
  emptyState?: "confirmed" | "unconfirmed" | "hidden-all";
  maxItems?: number;
  startRank?: number;
  pendingActionId?: string | null;
  onRetry?: () => void;
  onAction?: (item: AdvisorRiskListItem) => void;
  onShowEvidence?: (evidenceRefs: string[], item: AdvisorRiskListItem) => void;
  onSnooze?: (item: AdvisorRiskListItem) => void;
  onDismiss?: (item: AdvisorRiskListItem) => void;
  className?: string;
}

export function RiskList({
  items,
  loading = false,
  error = null,
  emptyState = "unconfirmed",
  maxItems = 7,
  startRank = 1,
  pendingActionId = null,
  onRetry,
  onAction,
  onShowEvidence,
  onSnooze,
  onDismiss,
  className = "",
}: RiskListProps) {
  const visibleItems = items.slice(0, Math.max(0, maxItems));

  return (
    <section
      className={`min-w-0 rounded-md border border-[var(--line)] bg-[var(--paper)] ${className}`}
      aria-labelledby="advisor-risk-list-title"
    >
      <header className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-3">
        <span>
          <h2 id="advisor-risk-list-title" className="text-sm font-semibold text-[var(--ink)]">
            今日行动
          </h2>
          <p className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">本地规则排序 · 最多 {maxItems} 项</p>
        </span>
        {!loading && !error && visibleItems.length > 0 && (
          <span className="rounded-sm border border-[var(--line)] px-2 py-1 text-[10px] font-semibold text-[var(--muted-foreground)]">
            {visibleItems.length} 项
          </span>
        )}
      </header>

      {loading ? (
        <div className="grid min-h-44 gap-3 p-4" role="status" aria-live="polite">
          {[0, 1, 2].map((index) => (
            <div key={index} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
              <span className="h-8 animate-pulse rounded-sm bg-[var(--line)]" />
              <span className="min-w-0">
                <span className="block h-4 w-3/4 animate-pulse rounded-sm bg-[var(--line)]" />
                <span className="mt-2 block h-3 w-full animate-pulse rounded-sm bg-[var(--line)]" />
              </span>
            </div>
          ))}
          <span className="sr-only">正在计算今日行动列表</span>
        </div>
      ) : error ? (
        <div className="flex min-w-0 flex-wrap items-start gap-3 p-4" role="alert">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-red-700" aria-hidden="true" />
          <span className="min-w-48 flex-1">
            <strong className="block text-sm text-[var(--ink)]">行动列表暂时无法计算</strong>
            <span className="mt-1 block break-words text-xs text-[var(--muted-foreground)] [overflow-wrap:anywhere]">
              {safeErrorMessage(error)}
            </span>
          </span>
          {onRetry && (
            <button
              type="button"
              className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--line-strong)] px-2.5 text-xs font-semibold text-[var(--ink)]"
              onClick={onRetry}
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              重试
            </button>
          )}
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="grid min-h-40 place-content-center justify-items-center p-5 text-center">
          <CalendarClock className="size-5 text-[var(--muted-foreground)]" aria-hidden="true" />
          <strong className="mt-2 text-sm text-[var(--ink)]">
            {emptyState === "hidden-all"
              ? "本次会话的行动已全部隐藏"
              : emptyState === "confirmed"
                ? "当前没有需要处理的行动"
                : "当前本地快照未能确认行动列表"}
          </strong>
          <span className="mt-1 max-w-md break-words text-xs text-[var(--muted-foreground)] [overflow-wrap:anywhere]">
            {emptyState === "hidden-all"
              ? "原始快照仍包含行动；它们因稍后提醒或暂时隐藏而未显示，这不表示当前没有风险。"
              : emptyState === "confirmed"
                ? "已检查当前可用且完整的数据。"
                : "未知、部分或读取失败的来源不能解释为没有事项。"}
          </span>
        </div>
      ) : (
        <ol className="min-w-0 divide-y divide-[var(--line)]">
          {visibleItems.map((item, index) => {
            const severity = SEVERITY[item.severity];
            const reasons = itemReasons(item);
            const quality = qualityLabels(item);
            const fixedAction = FIXED_ACTIONS[item.actionKind];
            const ActionIcon = fixedAction?.icon;
            const pending = pendingActionId === item.id;

            return (
              <li
                key={item.id}
                className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] gap-3 px-4 py-3 sm:grid-cols-[2rem_minmax(0,1fr)_auto]"
              >
                <span
                  className="grid size-8 shrink-0 place-items-center rounded-md border border-[var(--line)] bg-[var(--canvas)] text-xs font-bold tabular-nums text-[var(--muted-foreground)]"
                  aria-label={`第 ${startRank + index} 项`}
                >
                  {startRank + index}
                </span>

                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-start gap-2">
                    <h3 className="min-w-0 flex-1 break-words text-sm font-semibold leading-5 text-[var(--ink)] [overflow-wrap:anywhere]">
                      {item.title}
                    </h3>
                    <span className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px] font-bold ${severity.classes}`}>
                      {severity.label}
                    </span>
                  </div>
                  <div className="mt-1.5 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--muted-foreground)]">
                    <span className="inline-flex items-center gap-1">
                      <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />
                      {formatDueAt(item.dueAt)}
                    </span>
                    {isUrgentItem(item) && <span className="tabular-nums">排序分 {item.score.total}</span>}
                  </div>
                  {reasons.length > 0 && (
                    <p className="mt-2 line-clamp-2 break-words text-xs leading-5 text-[var(--muted-foreground)] [overflow-wrap:anywhere]">
                      {reasons.join("；")}
                    </p>
                  )}
                  {quality.length > 0 && (
                    <div className="mt-2 flex min-w-0 flex-wrap gap-1" aria-label="数据质量提示">
                      {quality.map((label) => (
                        <span
                          key={label}
                          className="rounded-sm border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="col-start-2 flex min-w-0 flex-wrap items-center gap-1.5 sm:col-start-3 sm:row-start-1 sm:max-w-48 sm:justify-end">
                  {fixedAction && onAction && ActionIcon && (
                    <button
                      type="button"
                      className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-[var(--line-strong)] px-2 text-[11px] font-semibold text-[var(--ink)] hover:bg-[var(--canvas)] disabled:cursor-wait disabled:opacity-60"
                      disabled={pending}
                      onClick={() => onAction(item)}
                    >
                      <ActionIcon className={`size-3.5 ${pending ? "animate-spin" : ""}`} aria-hidden="true" />
                      {pending ? "处理中" : fixedAction.label}
                    </button>
                  )}
                  {onShowEvidence && item.evidenceRefs.length > 0 && (
                    <button
                      type="button"
                      className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-[11px] text-[var(--muted-foreground)] hover:bg-[var(--canvas)] hover:text-[var(--ink)]"
                      onClick={() => onShowEvidence(item.evidenceRefs, item)}
                    >
                      <FileSearch className="size-3.5" aria-hidden="true" />
                      证据
                    </button>
                  )}
                  {onSnooze && (
                    <button
                      type="button"
                      className="grid size-8 place-items-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--canvas)] hover:text-[var(--ink)]"
                      onClick={() => onSnooze(item)}
                      title="稍后提醒"
                      aria-label={`稍后提醒：${item.title}`}
                    >
                      <Clock3 className="size-3.5" aria-hidden="true" />
                    </button>
                  )}
                  {onDismiss && item.severity !== "urgent" && (
                    <button
                      type="button"
                      className="grid size-8 place-items-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--canvas)] hover:text-[var(--ink)]"
                      onClick={() => onDismiss(item)}
                      title="暂时隐藏"
                      aria-label={`暂时隐藏：${item.title}`}
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
