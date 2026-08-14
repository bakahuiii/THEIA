import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Database,
  LogIn,
  RefreshCw,
} from "lucide-react";
import type {
  AdvisorDomainQuality,
  AdvisorOverview,
} from "../../types";
import { advisorDomainLabel } from "../../hooks/advisor-presentation.mjs";

const SOURCE_LABELS: Record<string, string> = {
  jwglxt: "教务系统",
  theol: "北化在线THEOL",
};

type QualitySignal = {
  key: string;
  label: string;
  tone: "good" | "empty" | "stale" | "partial" | "unknown" | "failed";
};

const SIGNAL_CLASSES: Record<QualitySignal["tone"], string> = {
  good:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
  empty:
    "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200",
  stale:
    "border-cyan-300 bg-cyan-50 text-cyan-900 dark:border-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-100",
  partial:
    "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-900 dark:border-fuchsia-800 dark:bg-fuchsia-950/40 dark:text-fuchsia-100",
  unknown:
    "border-zinc-300 bg-zinc-100 text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100",
  failed:
    "border-slate-500 bg-slate-100 text-slate-950 dark:border-slate-400 dark:bg-slate-800 dark:text-white",
};

function sourceLabel(sources: string[]) {
  const labels = sources
    .map((source) => SOURCE_LABELS[source])
    .filter((label): label is string => Boolean(label));
  return labels.length ? [...new Set(labels)].join(" / ") : "本地数据";
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "尚无可验证快照时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "快照时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function qualitySignals(quality: AdvisorDomainQuality): QualitySignal[] {
  const signals: QualitySignal[] = [];
  const attempt = quality.lastAttempt.status;

  if (attempt === "failed") {
    signals.push({ key: "failed", label: "最近读取失败", tone: "failed" });
  } else if (attempt === "auth-required") {
    signals.push({ key: "auth", label: "需要重新登录", tone: "failed" });
  } else if (attempt === "never" || attempt === "not-attempted") {
    signals.push({ key: "not-attempted", label: "尚未读取", tone: "unknown" });
  }

  if (quality.availability === "unknown") {
    signals.push({ key: "availability-unknown", label: "可用性未知", tone: "unknown" });
  } else if (quality.availability === "empty-confirmed") {
    signals.push({ key: "empty-confirmed", label: "已确认无记录", tone: "empty" });
  } else if (quality.availability === "absent") {
    signals.push({ key: "absent", label: "本地无记录", tone: "unknown" });
  }

  if (quality.freshness === "stale") {
    signals.push({ key: "stale", label: "数据已过期", tone: "stale" });
  } else if (quality.freshness === "unknown") {
    signals.push({ key: "freshness-unknown", label: "新鲜度未知", tone: "unknown" });
  }

  if (quality.completeness === "partial") {
    signals.push({ key: "partial", label: "数据部分完整", tone: "partial" });
  } else if (quality.completeness === "unknown") {
    signals.push({ key: "completeness-unknown", label: "完整性未知", tone: "unknown" });
  }

  if (!signals.length) {
    signals.push({ key: "verified", label: "新鲜且完整", tone: "good" });
  }
  return signals;
}

function DomainQualityItem({
  quality,
  onSelect,
}: {
  quality: AdvisorDomainQuality;
  onSelect?: (quality: AdvisorDomainQuality) => void;
}) {
  const signals = qualitySignals(quality);
  const hasFailure = signals.some((signal) => signal.tone === "failed");
  const Icon = hasFailure
    ? quality.lastAttempt.status === "auth-required"
      ? LogIn
      : AlertCircle
    : signals.length === 1 && signals[0].tone === "good"
      ? CheckCircle2
      : Database;
  const content = (
    <>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block break-words text-xs font-semibold text-[var(--ink)] [overflow-wrap:anywhere]">
          {advisorDomainLabel(quality.domain)}
        </span>
        <span className="mt-0.5 block break-words text-[10px] text-[var(--muted-foreground)] [overflow-wrap:anywhere]">
          {sourceLabel(quality.source)} · {quality.recordCount} 条记录
        </span>
        <span className="mt-2 flex min-w-0 flex-wrap gap-1.5">
          {signals.map((signal) => (
            <span
              key={signal.key}
              data-quality-state={signal.key}
              className={`inline-flex min-h-5 items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold whitespace-normal ${SIGNAL_CLASSES[signal.tone]}`}
            >
              {signal.label}
            </span>
          ))}
        </span>
      </span>
    </>
  );

  if (onSelect) {
    return (
      <button
        type="button"
        className="flex min-w-0 items-start gap-2 rounded-md border border-[var(--line)] bg-[var(--paper)] p-2.5 text-left transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--teal)]"
        onClick={() => onSelect(quality)}
        aria-label={`查看${advisorDomainLabel(quality.domain)}数据质量`}
      >
        {content}
      </button>
    );
  }

  return (
    <div className="flex min-w-0 items-start gap-2 rounded-md border border-[var(--line)] bg-[var(--paper)] p-2.5">
      {content}
    </div>
  );
}

export interface DataQualityBarProps {
  dataQuality: AdvisorOverview["dataQuality"] | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onSelectDomain?: (quality: AdvisorDomainQuality) => void;
  className?: string;
}

export function DataQualityBar({
  dataQuality,
  loading = false,
  error = null,
  onRetry,
  onSelectDomain,
  className = "",
}: DataQualityBarProps) {
  const domains = Object.values(dataQuality?.domains || {}).sort((left, right) =>
    advisorDomainLabel(left.domain).localeCompare(advisorDomainLabel(right.domain), "zh-CN"),
  );
  const verifiedCount = domains.filter(
    (domain) =>
      domain.lastAttempt.status === "succeeded" &&
      domain.freshness === "fresh" &&
      domain.completeness === "complete" &&
      domain.availability !== "unknown" &&
      domain.availability !== "absent",
  ).length;

  return (
    <section
      className={`min-w-0 rounded-md border border-[var(--line)] bg-[var(--paper)] p-3 ${className}`}
      aria-labelledby="advisor-data-quality-title"
    >
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <span className="min-w-0">
          <span
            id="advisor-data-quality-title"
            className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]"
          >
            <Database className="size-4 shrink-0" aria-hidden="true" />
            数据质量
          </span>
          <span className="mt-1 flex min-w-0 items-center gap-1.5 break-words text-[11px] text-[var(--muted-foreground)] [overflow-wrap:anywhere]">
            <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />
            {formatTimestamp(dataQuality?.snapshotAt)}
          </span>
        </span>
        {!loading && !error && domains.length > 0 && (
          <span className="rounded-sm border border-[var(--line)] px-2 py-1 text-[11px] font-medium text-[var(--muted-foreground)]">
            {verifiedCount}/{domains.length} 项已验证
          </span>
        )}
      </header>

      {loading ? (
        <div
          className="mt-3 grid min-h-20 place-items-center rounded-md border border-dashed border-[var(--line-strong)] text-xs text-[var(--muted-foreground)]"
          role="status"
          aria-live="polite"
        >
          <RefreshCw className="mb-1 size-4 animate-spin" aria-hidden="true" />
          正在检查本地数据质量
        </div>
      ) : error ? (
        <div
          className="mt-3 flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-slate-400 bg-slate-100 p-2.5 text-xs text-slate-900 dark:border-slate-500 dark:bg-slate-800 dark:text-white"
          role="alert"
        >
          <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-48 flex-1 break-words [overflow-wrap:anywhere]">
            数据质量暂时无法读取。当前本地快照未能确认。
          </span>
          {onRetry && (
            <button
              type="button"
              className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md border border-current px-2.5 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
              onClick={onRetry}
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              重试
            </button>
          )}
        </div>
      ) : domains.length === 0 ? (
        <div className="mt-3 rounded-md border border-dashed border-[var(--line-strong)] p-3 text-xs text-[var(--muted-foreground)]">
          当前本地快照未能确认数据质量，不能把空集合解释为没有记录。
        </div>
      ) : (
        <ul className="mt-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {domains.map((domain) => (
            <li key={domain.domain} className="min-w-0">
              <DomainQualityItem quality={domain} onSelect={onSelectDomain} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
