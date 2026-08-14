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
import type { AdvisorUrgentItem } from "../../types";

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

const SEVERITY: Record<AdvisorUrgentItem["severity"], { label: string; classes: string }> = {
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

function qualityLabels(item: AdvisorUrgentItem) {
  const labels: string[] = [];
  if (item.quality.lastAttemptStatus === "failed") labels.push("最近读取失败");
  if (item.quality.lastAttemptStatus === "auth-required") labels.push("需要重新登录");
  if (item.quality.availability === "unknown") labels.push("可用性未知");
  if (item.quality.freshness === "stale") labels.push("数据已过期");
  if (item.quality.freshness === "unknown") labels.push("新鲜度未知");
  if (item.quality.completeness === "partial") labels.push("数据部分完整");
  if (item.quality.completeness === "unknown") labels.push("完整性未知");
  return labels;
}

export interface TopActionProps {
  item: AdvisorUrgentItem | null;
  loading?: boolean;
  error?: string | null;
  emptyState?: "confirmed" | "unconfirmed" | "hidden-all";
  actionPending?: boolean;
  onRetry?: () => void;
  onAction?: (item: AdvisorUrgentItem) => void;
  onShowEvidence?: (evidenceRefs: string[], item: AdvisorUrgentItem) => void;
  onSnooze?: (item: AdvisorUrgentItem) => void;
  onDismiss?: (item: AdvisorUrgentItem) => void;
  className?: string;
}

export function TopAction({
  item,
  loading = false,
  error = null,
  emptyState = "unconfirmed",
  actionPending = false,
  onRetry,
  onAction,
  onShowEvidence,
  onSnooze,
  onDismiss,
  className = "",
}: TopActionProps) {
  if (loading) {
    return (
      <section
        className={`min-h-52 rounded-md border border-[var(--line)] bg-[var(--paper)] p-4 ${className}`}
        aria-label="首要行动"
      >
        <div className="h-3 w-24 animate-pulse rounded-sm bg-[var(--line)]" />
        <div className="mt-5 h-5 w-3/4 animate-pulse rounded-sm bg-[var(--line)]" />
        <div className="mt-3 h-3 w-full animate-pulse rounded-sm bg-[var(--line)]" />
        <span className="sr-only" role="status">正在计算首要行动</span>
      </section>
    );
  }

  if (error) {
    return (
      <section
        className={`min-w-0 rounded-md border border-red-200 bg-[var(--paper)] p-4 ${className}`}
        aria-label="首要行动"
      >
        <div className="flex min-w-0 items-start gap-3" role="alert">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-red-700" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <strong className="block text-sm text-[var(--ink)]">首要行动暂时无法计算</strong>
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
      </section>
    );
  }

  if (!item) {
    const confirmed = emptyState === "confirmed";
    const hiddenAll = emptyState === "hidden-all";
    return (
      <section
        className={`grid min-h-40 place-content-center justify-items-center rounded-md border border-dashed border-[var(--line-strong)] bg-[var(--paper)] p-5 text-center ${className}`}
        aria-label="首要行动"
      >
        <CalendarClock className="size-5 text-[var(--muted-foreground)]" aria-hidden="true" />
        <strong className="mt-2 text-sm text-[var(--ink)]">
          {hiddenAll
            ? "本次会话的行动已全部隐藏"
            : confirmed
              ? "当前没有需要优先处理的行动"
              : "当前本地快照未能确认今日行动"}
        </strong>
        <span className="mt-1 max-w-md break-words text-xs text-[var(--muted-foreground)] [overflow-wrap:anywhere]">
          {hiddenAll
            ? "原始快照仍包含行动；它们因稍后提醒或暂时隐藏而未显示，这不表示当前没有风险。"
            : confirmed
              ? "已检查当前可用且完整的数据。"
              : "请先检查数据质量；未知、部分或失败的来源不能解释为没有事项。"}
        </span>
      </section>
    );
  }

  const severity = SEVERITY[item.severity];
  const fixedAction = FIXED_ACTIONS[item.actionKind];
  const ActionIcon = fixedAction?.icon;
  const quality = qualityLabels(item);

  return (
    <section
      className={`min-w-0 rounded-md border border-[var(--line)] bg-[var(--paper)] p-4 shadow-sm ${className}`}
      aria-labelledby={`top-action-${item.id}`}
    >
      <header className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-[var(--muted-foreground)]">首要行动 · Top 1</span>
        <span className={`rounded-sm border px-2 py-0.5 text-[10px] font-bold ${severity.classes}`}>
          {severity.label}
        </span>
      </header>

      <div className="mt-3 min-w-0">
        <h2
          id={`top-action-${item.id}`}
          className="break-words text-lg font-semibold leading-7 text-[var(--ink)] [overflow-wrap:anywhere]"
        >
          {item.title}
        </h2>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted-foreground)]">
          <span className="inline-flex items-center gap-1.5">
            <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />
            {formatDueAt(item.dueAt)}
          </span>
          <span className="font-variant-numeric tabular-nums">排序分 {item.score.total}</span>
        </div>
      </div>

      <div className="mt-4 min-w-0 border-t border-[var(--line)] pt-3">
        <strong className="text-xs font-semibold text-[var(--ink)]">为什么排第一</strong>
        {item.reasons.length ? (
          <ul className="mt-2 grid min-w-0 gap-1.5">
            {item.reasons.map((reason, index) => (
              <li
                key={`${item.id}-reason-${index}`}
                className="flex min-w-0 items-start gap-2 break-words text-xs leading-5 text-[var(--muted-foreground)] [overflow-wrap:anywhere]"
              >
                <span className="mt-2 size-1 shrink-0 rounded-full bg-[var(--teal)]" aria-hidden="true" />
                <span className="min-w-0">{reason}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">排序理由尚未生成。</p>
        )}
        <p className="mt-2 break-words text-[10px] text-[var(--subtle)] [overflow-wrap:anywhere]">
          紧迫 {item.score.urgency} · 影响 {item.score.impact} · 延误 {item.score.delayCost} · 证据 {item.score.confidence}
        </p>
      </div>

      {quality.length > 0 && (
        <div className="mt-3 flex min-w-0 flex-wrap gap-1.5" aria-label="数据质量提示">
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

      <footer className="mt-4 flex min-w-0 flex-wrap items-center gap-2 border-t border-[var(--line)] pt-3">
        {fixedAction && onAction && ActionIcon && (
          <button
            type="button"
            className="inline-flex min-h-9 items-center gap-2 rounded-md bg-[var(--teal)] px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
            disabled={actionPending}
            onClick={() => onAction(item)}
          >
            <ActionIcon className={`size-4 ${actionPending ? "animate-spin" : ""}`} aria-hidden="true" />
            {actionPending ? "正在处理" : fixedAction.label}
          </button>
        )}
        {onShowEvidence && item.evidenceRefs.length > 0 && (
          <button
            type="button"
            className="inline-flex min-h-9 items-center gap-2 rounded-md border border-[var(--line-strong)] px-3 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--canvas)]"
            onClick={() => onShowEvidence(item.evidenceRefs, item)}
          >
            <FileSearch className="size-4" aria-hidden="true" />
            查看证据
          </button>
        )}
        <span className="flex min-w-0 flex-wrap gap-1 sm:ml-auto">
          {onSnooze && (
            <button
              type="button"
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs text-[var(--muted-foreground)] hover:bg-[var(--canvas)] hover:text-[var(--ink)]"
              onClick={() => onSnooze(item)}
            >
              <Clock3 className="size-3.5" aria-hidden="true" />
              稍后提醒
            </button>
          )}
          {onDismiss && item.severity !== "urgent" && (
            <button
              type="button"
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs text-[var(--muted-foreground)] hover:bg-[var(--canvas)] hover:text-[var(--ink)]"
              onClick={() => onDismiss(item)}
            >
              <X className="size-3.5" aria-hidden="true" />
              暂时隐藏
            </button>
          )}
        </span>
      </footer>
    </section>
  );
}
