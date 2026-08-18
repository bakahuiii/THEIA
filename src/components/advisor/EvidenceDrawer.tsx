import {
  AlertCircle,
  Clock3,
  Database,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import type { AdvisorEvidence } from "../../types";
import { formatDateTime } from "../../ui/app-shared";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";

const FIELD_LABELS: Record<string, string> = {
  availability: "可用性",
  freshness: "新鲜度",
  completeness: "完整性",
  recordCount: "记录数量",
  contentEmptyConfirmed: "空集合确认",
  "lastAttempt.status": "最近读取状态",
  "lastAttempt.emptyConfirmed": "最近空集合确认",
  "lastAttempt.retainedPrevious": "是否保留旧数据",
  "lastAttempt.errorCode": "最近错误类别",
  title: "标题",
  courseName: "课程名称",
  courseCode: "课程号",
  dueAt: "截止时间",
  status: "状态",
  capturedAt: "捕获时间",
  examType: "考试类型",
  startAt: "开始时间",
  examTime: "考试时间",
  endAt: "结束时间",
  location: "地点",
  campus: "校区",
  credits: "学分",
  score: "成绩",
  point: "绩点",
  required: "要求值",
  earned: "已完成值",
  remaining: "剩余值",
};

const UNSAFE_FIELD_PATTERN =
  /(?:path|url|uri|token|cookie|secret|password|credential|session|operation|digest|revision|entity.?id)/i;

const SOURCE_LABELS: Record<string, string> = {
  jwglxt: "教务系统",
  theol: "北化在线THEOL",
  fixture: "本地测试数据",
  local: "本地规则",
  "local-config": "本地版本化规则",
  "local-scenario": "当前本地情景",
  "request-input": "当前选课请求",
};

function fieldLabel(field: string) {
  if (UNSAFE_FIELD_PATTERN.test(field)) return null;
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  return field
    .replaceAll(".", " · ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("-", " ");
}

function sourceLabel(source: string | null) {
  if (!source) return "来源未记录";
  return SOURCE_LABELS[source] || "校园数据";
}

function formatTimestamp(value: string | null) {
  return value ? formatDateTime(value, true) : "捕获时间未知";
}

function qualityLabels(evidence: AdvisorEvidence) {
  const labels: Array<{ key: string; text: string; classes: string }> = [];
  const cool =
    "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200";
  const stale =
    "border-cyan-300 bg-cyan-50 text-cyan-900 dark:border-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-100";
  const partial =
    "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-900 dark:border-fuchsia-800 dark:bg-fuchsia-950/40 dark:text-fuchsia-100";
  const unknown =
    "border-zinc-300 bg-zinc-100 text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100";
  const good =
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200";

  if (evidence.availability === "available") labels.push({ key: "available", text: "有数据", classes: good });
  if (evidence.availability === "empty-confirmed") labels.push({ key: "empty", text: "已确认无记录", classes: cool });
  if (evidence.availability === "absent") labels.push({ key: "absent", text: "本地无记录", classes: unknown });
  if (evidence.availability === "unknown") labels.push({ key: "availability-unknown", text: "可用性未知", classes: unknown });
  if (evidence.freshness === "fresh") labels.push({ key: "fresh", text: "数据新鲜", classes: good });
  if (evidence.freshness === "stale") labels.push({ key: "stale", text: "数据已过期", classes: stale });
  if (evidence.freshness === "unknown") labels.push({ key: "freshness-unknown", text: "新鲜度未知", classes: unknown });
  if (evidence.completeness === "complete") labels.push({ key: "complete", text: "数据完整", classes: good });
  if (evidence.completeness === "partial") labels.push({ key: "partial", text: "数据部分完整", classes: partial });
  if (evidence.completeness === "unknown") labels.push({ key: "completeness-unknown", text: "完整性未知", classes: unknown });
  return labels;
}

export interface EvidenceDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  evidence: ReadonlyArray<AdvisorEvidence>;
  title?: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

export function EvidenceDrawer({
  open,
  onOpenChange,
  evidence,
  title = "证据详情",
  loading = false,
  error = null,
  onRetry,
}: EvidenceDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-[min(100vw,34rem)] max-w-full gap-0 overflow-hidden border-[var(--line)] bg-[var(--paper)] p-0 text-[var(--ink)] sm:max-w-[34rem]"
      >
        <SheetHeader className="min-w-0 border-b border-[var(--line)] p-4 pr-14">
          <SheetTitle className="break-words text-base font-semibold [overflow-wrap:anywhere]">
            {title}
          </SheetTitle>
          <SheetDescription className="sr-only">
            查看字段、来源、捕获时间和数据质量
          </SheetDescription>
          <span className="text-[11px] text-[var(--muted-foreground)]">
            {loading ? "正在读取" : `${evidence.length} 条证据`}
          </span>
        </SheetHeader>
        <SheetClose asChild>
          <button
            type="button"
            className="absolute right-3 top-3 grid size-9 place-items-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--canvas)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--teal)]"
            aria-label="关闭证据详情"
            title="关闭"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </SheetClose>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-4">
          {loading ? (
            <div className="grid min-h-52 place-content-center justify-items-center gap-2 text-xs text-[var(--muted-foreground)]" role="status">
              <RefreshCw className="size-5 animate-spin" aria-hidden="true" />
              正在读取证据
            </div>
          ) : error ? (
            <div className="grid min-h-52 place-content-center justify-items-center gap-2 text-center" role="alert">
              <AlertCircle className="size-5 text-slate-700 dark:text-slate-200" aria-hidden="true" />
              <strong className="text-sm text-[var(--ink)]">证据暂时无法显示</strong>
              <span className="max-w-sm break-words text-xs text-[var(--muted-foreground)] [overflow-wrap:anywhere]">
                当前本地证据读取失败。
              </span>
              {onRetry && (
                <button
                  type="button"
                  className="mt-2 inline-flex min-h-8 items-center gap-1.5 rounded-md border border-[var(--line-strong)] px-2.5 text-xs font-semibold text-[var(--ink)]"
                  onClick={onRetry}
                >
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                  重试
                </button>
              )}
            </div>
          ) : evidence.length === 0 ? (
            <div className="grid min-h-52 place-content-center justify-items-center gap-2 text-center">
              <Database className="size-5 text-[var(--muted-foreground)]" aria-hidden="true" />
              <strong className="text-sm text-[var(--ink)]">没有可展示的证据</strong>
              <span className="max-w-sm text-xs text-[var(--muted-foreground)]">
                当前行动没有通过本地校验的证据引用。
              </span>
            </div>
          ) : (
            <ol className="grid min-w-0 gap-3">
              {evidence.map((entry, index) => {
                const fields = entry.disclosedFields
                  .map(fieldLabel)
                  .filter((field): field is string => Boolean(field));
                const quality = qualityLabels(entry);
                return (
                  <li
                    key={entry.id}
                    className="min-w-0 rounded-md border border-[var(--line)] bg-[var(--paper)] p-3"
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-[var(--canvas)] text-[10px] font-bold text-[var(--muted-foreground)]">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <strong className="block break-words text-sm text-[var(--ink)] [overflow-wrap:anywhere]">
                          {entry.label || "本地校园数据证据"}
                        </strong>
                        <span className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--muted-foreground)]">
                          <span className="inline-flex items-center gap-1">
                            <Database className="size-3.5 shrink-0" aria-hidden="true" />
                            来源：{sourceLabel(entry.source)}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />
                            {formatTimestamp(entry.capturedAt)}
                          </span>
                        </span>
                      </span>
                    </div>

                    <div className="mt-3 border-t border-[var(--line)] pt-3">
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--ink)]">
                        <ShieldCheck className="size-3.5" aria-hidden="true" />
                        已披露字段
                      </span>
                      {fields.length ? (
                        <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
                          {fields.map((field) => (
                            <span
                              key={field}
                              className="max-w-full break-words rounded-sm border border-[var(--line)] bg-[var(--canvas)] px-1.5 py-0.5 text-[10px] text-[var(--muted-foreground)] [overflow-wrap:anywhere]"
                            >
                              {field}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="mt-2 block text-[11px] text-[var(--muted-foreground)]">
                          无可安全展示的字段
                        </span>
                      )}
                    </div>

                    <div className="mt-3 flex min-w-0 flex-wrap gap-1.5" aria-label="证据质量">
                      {quality.map((item) => (
                        <span
                          key={item.key}
                          data-quality-state={item.key}
                          className={`rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold ${item.classes}`}
                        >
                          {item.text}
                        </span>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
