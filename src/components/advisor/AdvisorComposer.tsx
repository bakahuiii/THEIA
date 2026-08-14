import {
  Bell,
  BookOpenCheck,
  GraduationCap,
  Mail,
  MessageSquareText,
  Send,
  ShieldAlert,
  Square,
} from "lucide-react";
import type { AdvisorIntent, EmailMessage, Notice } from "../../types";

const INTENTS: Array<{ id: AdvisorIntent; label: string; Icon: typeof Bell }> = [
  { id: "daily", label: "今日", Icon: BookOpenCheck },
  { id: "risk", label: "学业", Icon: ShieldAlert },
  { id: "course", label: "选课", Icon: GraduationCap },
  { id: "notice", label: "通知", Icon: Bell },
  { id: "mail", label: "邮件", Icon: Mail },
  { id: "general", label: "综合", Icon: MessageSquareText },
];

const READABLE_DOMAINS = [
  ["assignments", "作业"], ["exams", "考试"], ["grades", "成绩"], ["academic-progress", "学业进度"],
  ["courses", "课程"], ["schedule", "课表"], ["selected-courses", "已选课程"], ["course-selection", "选课分析"],
  ["notices", "通知"], ["mailbox", "邮箱"], ["fitness", "体测"],
] as const;

export function AdvisorComposer({
  question,
  intent,
  notices,
  emails,
  selectedNoticeId,
  selectedMailId,
  includeMailBody,
  streaming,
  agent,
  readableDomains,
  disabled,
  active,
  onQuestionChange,
  onIntentChange,
  onNoticeChange,
  onMailChange,
  onIncludeMailBodyChange,
  onStreamingChange,
  onAgentChange,
  onReadableDomainsChange,
  onSubmit,
  onCancel,
}: {
  question: string;
  intent: AdvisorIntent;
  notices: Notice[];
  emails: EmailMessage[];
  selectedNoticeId: string;
  selectedMailId: string;
  includeMailBody: boolean;
  streaming: boolean;
  agent: boolean;
  readableDomains: string[];
  disabled: boolean;
  active: boolean;
  onQuestionChange: (value: string) => void;
  onIntentChange: (value: AdvisorIntent) => void;
  onNoticeChange: (value: string) => void;
  onMailChange: (value: string) => void;
  onIncludeMailBodyChange: (value: boolean) => void;
  onStreamingChange: (value: boolean) => void;
  onAgentChange: (value: boolean) => void;
  onReadableDomainsChange: (value: string[]) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex min-w-0 flex-wrap gap-1" role="group" aria-label="顾问问题类型">
        {INTENTS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className={`inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-semibold ${intent === id ? "border-[var(--teal)] bg-[var(--teal)] text-white" : "border-[var(--line)] bg-[var(--paper)] text-[var(--ink)] hover:border-[var(--line-strong)]"}`}
            aria-pressed={intent === id}
            onClick={() => onIntentChange(id)}
            disabled={disabled}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {(intent === "notice" || intent === "mail") && (
        <div className="grid min-w-0 gap-3 md:grid-cols-2">
          {intent === "notice" && (
            <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-[var(--ink)]">
              所选通知
              <select
                className="h-10 min-w-0 rounded-md border border-[var(--line-strong)] bg-[var(--canvas)] px-3 text-xs font-normal outline-none focus:border-[var(--teal)]"
                value={selectedNoticeId}
                onChange={(event) => onNoticeChange(event.target.value)}
                disabled={disabled}
              >
                <option value="">不附加通知</option>
                {notices.slice(0, 100).map((notice) => (
                  <option key={notice.id} value={notice.id}>{notice.title}</option>
                ))}
              </select>
            </label>
          )}
          {intent === "mail" && (
            <>
              <label className="grid min-w-0 gap-1.5 text-xs font-semibold text-[var(--ink)]">
                所选邮件
                <select
                  className="h-10 min-w-0 rounded-md border border-[var(--line-strong)] bg-[var(--canvas)] px-3 text-xs font-normal outline-none focus:border-[var(--teal)]"
                  value={selectedMailId}
                  onChange={(event) => {
                    onMailChange(event.target.value);
                    if (!event.target.value) onIncludeMailBodyChange(false);
                  }}
                  disabled={disabled}
                >
                  <option value="">不附加邮件</option>
                  {emails.slice(0, 100).map((email) => (
                    <option key={email.id} value={email.id}>{email.subject || "（无主题）"} · {email.from}</option>
                  ))}
                </select>
              </label>
              <label className="flex min-h-10 items-center gap-2 self-end text-xs font-semibold text-[var(--ink)]">
                <input
                  type="checkbox"
                  checked={includeMailBody}
                  onChange={(event) => onIncludeMailBodyChange(event.target.checked)}
                  disabled={disabled || !selectedMailId}
                  className="size-4 accent-[var(--teal)]"
                />
                包含正文（仅本次授权）
              </label>
            </>
          )}
        </div>
      )}

      <details className="min-w-0 rounded-md border border-[var(--line)] bg-[var(--paper)] px-3 py-2">
        <summary className="cursor-pointer text-xs font-semibold text-[var(--ink)]">本次可读取数据{readableDomains.length ? `：已选 ${readableDomains.length} 项` : "：按问题类型自动选择"}</summary>
        <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-3">
          {READABLE_DOMAINS.map(([id, label]) => (
            <label key={id} className="flex min-h-7 min-w-0 items-center gap-2 text-xs text-[var(--ink)]">
              <input
                type="checkbox"
                checked={readableDomains.includes(id)}
                onChange={(event) => onReadableDomainsChange(event.target.checked
                  ? [...readableDomains, id]
                  : readableDomains.filter((domain) => domain !== id))}
                disabled={disabled}
                className="size-3.5 shrink-0 accent-[var(--teal)]"
              />
              {label}
            </label>
          ))}
        </div>
      </details>

      <div className="grid min-w-0 gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
        <textarea
          value={question}
          onChange={(event) => onQuestionChange(event.target.value.slice(0, 4_000))}
          rows={3}
          className="min-h-24 min-w-0 resize-y rounded-md border border-[var(--line-strong)] bg-[var(--canvas)] px-3 py-2 text-sm leading-6 text-[var(--ink)] outline-none placeholder:text-[var(--muted-foreground)] focus:border-[var(--teal)] focus:ring-2 focus:ring-[var(--teal)]/20"
          placeholder="问 THEIA"
          disabled={disabled}
        />
        <div className="grid gap-2 self-end">
          <label className="flex min-h-7 items-center gap-2 text-[11px] font-semibold text-[var(--muted-foreground)]">
            <input
              type="checkbox"
              checked={streaming}
              onChange={(event) => onStreamingChange(event.target.checked)}
              disabled={disabled || active || agent}
              className="size-3.5 accent-[var(--teal)]"
            />
            实时预览
          </label>
          <label className="flex min-h-7 items-center gap-2 text-[11px] font-semibold text-[var(--muted-foreground)]">
            <input
              type="checkbox"
              checked={agent}
              onChange={(event) => onAgentChange(event.target.checked)}
              disabled={disabled || active}
              className="size-3.5 accent-[var(--teal)]"
            />
            只读工具 Agent
          </label>
        {active ? (
          <button
            type="button"
            className="inline-flex min-h-10 items-center justify-center gap-2 self-end rounded-md border border-red-300 px-4 text-xs font-semibold text-red-700 dark:border-red-800 dark:text-red-200"
            onClick={onCancel}
          >
            <Square className="size-3.5 fill-current" aria-hidden="true" />
            取消生成
          </button>
        ) : (
          <button
            type="button"
            className="inline-flex min-h-10 items-center justify-center gap-2 self-end rounded-md bg-[var(--teal)] px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onSubmit}
            disabled={disabled || !question.trim()}
          >
            <Send className="size-4" aria-hidden="true" />
            检查并发送
          </button>
        )}
        </div>
      </div>
    </div>
  );
}
