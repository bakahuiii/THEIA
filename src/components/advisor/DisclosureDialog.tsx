import { Database, LockKeyhole, Send, ShieldCheck } from "lucide-react";
import type { AdvisorPreparedRequest } from "../../types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

const SCOPE_LABELS: Record<string, string> = {
  assignments: "作业",
  exams: "考试",
  grades: "成绩汇总",
  "academic-progress": "学业进度",
  schedule: "课表",
  notices: "所选通知",
  mailbox: "所选邮件元数据",
  "mail-body": "所选邮件正文",
  fitness: "体测",
  identity: "身份信息",
  "attachment-text": "附件文本",
};

export function DisclosureDialog({
  prepared,
  sending,
  onCancel,
  onApprove,
}: {
  prepared: AdvisorPreparedRequest | null;
  sending: boolean;
  onCancel: () => void;
  onApprove: () => void;
}) {
  const plan = prepared?.disclosure;
  const sensitive = prepared?.consentChallenge.requiredScopes || [];
  return (
    <Dialog open={Boolean(prepared)} onOpenChange={(open) => { if (!open && !sending) onCancel(); }}>
      {prepared && plan && (
        <DialogContent className="max-h-[min(46rem,90vh)] max-w-2xl overflow-y-auto" showCloseButton={!sending}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-[var(--teal)]" aria-hidden="true" />
              发送前确认
            </DialogTitle>
            <DialogDescription>
              本次授权仅绑定当前服务、请求、线程和所选实体，过期后自动失效。
            </DialogDescription>
          </DialogHeader>

          <dl className="grid min-w-0 gap-3 border-y border-[var(--line)] py-4 text-xs sm:grid-cols-[8rem_minmax(0,1fr)]">
            <dt className="font-semibold text-[var(--muted-foreground)]">模型服务</dt>
            <dd className="min-w-0 break-all text-[var(--ink)]">{plan.serviceIdentity}</dd>
            <dt className="font-semibold text-[var(--muted-foreground)]">模型</dt>
            <dd className="min-w-0 break-all text-[var(--ink)]">{plan.modelId}</dd>
            <dt className="font-semibold text-[var(--muted-foreground)]">数据范围</dt>
            <dd className="flex min-w-0 flex-wrap gap-1.5">
              {plan.scopes.length ? plan.scopes.map((scope) => (
                <span key={scope} className="rounded-sm border border-[var(--line)] px-2 py-1 text-[var(--ink)]">
                  {SCOPE_LABELS[scope] || scope}
                </span>
              )) : <span className="text-[var(--muted-foreground)]">仅问题与本地结论</span>}
            </dd>
            <dt className="font-semibold text-[var(--muted-foreground)]">记录数</dt>
            <dd className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-[var(--ink)]">
              {Object.entries(plan.recordCounts).length ? Object.entries(plan.recordCounts).map(([scope, count]) => (
                <span key={scope}>{SCOPE_LABELS[scope] || scope} {count}</span>
              )) : <span>0</span>}
            </dd>
          </dl>

          {sensitive.length > 0 && (
            <div className="flex min-w-0 items-start gap-3 border-l-2 border-amber-500 bg-amber-50 p-3 text-xs text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
              <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                本次包含敏感范围：{sensitive.map((scope) => SCOPE_LABELS[scope] || scope).join("、")}。
              </span>
            </div>
          )}

          <div className="flex min-w-0 items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
            <Database className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">
              快照 {plan.snapshotRevision.slice(0, 18)} · 预计输入 {plan.estimatedInputUnits} 单位
            </span>
          </div>

          <DialogFooter>
            <button
              type="button"
              className="inline-flex min-h-9 items-center justify-center rounded-md border border-[var(--line-strong)] px-4 text-xs font-semibold text-[var(--ink)] disabled:opacity-50"
              onClick={onCancel}
              disabled={sending}
            >
              取消
            </button>
            <button
              type="button"
              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-[var(--teal)] px-4 text-xs font-semibold text-white disabled:cursor-wait disabled:opacity-60"
              onClick={onApprove}
              disabled={sending}
            >
              <Send className="size-4" aria-hidden="true" />
              {sending ? "正在生成" : "允许并发送"}
            </button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
