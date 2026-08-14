import { AlertTriangle, Bot, FileSearch, Lightbulb, UserRound } from "lucide-react";
import type { AdvisorAnswer, AdvisorEvidence, AdvisorThreadMessage } from "../../types";

function evidenceFor(answer: AdvisorAnswer, claimIds: string[]) {
  const ids = new Set(claimIds);
  return answer.claims.filter((claim) => ids.has(claim.id)).flatMap((claim) => claim.evidenceRefs);
}

export function AdvisorMessage({
  message,
  evidence,
  onEvidence,
}: {
  message: AdvisorThreadMessage;
  evidence: AdvisorEvidence[];
  onEvidence: (title: string, evidence: AdvisorEvidence[]) => void;
}) {
  if (message.role === "user") {
    return (
      <li className="flex min-w-0 justify-end gap-2">
        <div className="max-w-[min(46rem,88%)] min-w-0 rounded-md bg-[var(--teal)] px-3 py-2 text-sm leading-6 text-white">
          <span className="break-words [overflow-wrap:anywhere]">{message.text}</span>
        </div>
        <UserRound className="mt-2 size-4 shrink-0 text-[var(--muted-foreground)]" aria-hidden="true" />
      </li>
    );
  }

  const answer = message.response;
  const evidenceById = new Map([...evidence, ...(answer.evidence || [])].map((entry) => [entry.id, entry]));
  return (
    <li className="flex min-w-0 gap-2">
      <Bot className="mt-1 size-4 shrink-0 text-[var(--teal)]" aria-hidden="true" />
      <div className="grid min-w-0 flex-1 gap-3 border-l border-[var(--line-strong)] pl-3">
        {answer.stale && (
          <p className="flex items-start gap-2 text-xs text-amber-800 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            该回答对应旧快照 {answer.snapshotRevision.slice(0, 18)}。
          </p>
        )}
        {answer.narrative.blocks.map((block, index) => {
          const claims = answer.claims.filter((claim) => block.claimIds.includes(claim.id));
          const refs = evidenceFor(answer, block.claimIds);
          const untrusted = block.referenceIds.length > 0;
          return (
            <div key={`${block.claimIds.join(":")}-${block.referenceIds.join(":")}-${index}`} className="grid min-w-0 gap-1.5">
              {claims.map((claim) => (
                <strong key={claim.id} className="break-words text-sm text-[var(--ink)] [overflow-wrap:anywhere]">
                  {claim.displayText}
                </strong>
              ))}
              {untrusted && (
                <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                  所选通知或邮件内容，未作为校务事实核验
                </span>
              )}
              <p className="break-words text-sm leading-6 text-[var(--muted-foreground)] [overflow-wrap:anywhere]">
                {block.explanation}
              </p>
              {refs.length > 0 && (
                <button
                  type="button"
                  className="inline-flex min-h-7 w-fit items-center gap-1.5 text-[11px] font-semibold text-[var(--teal)]"
                  onClick={() => onEvidence("顾问回答证据", refs.map((id) => evidenceById.get(id)).filter((item): item is AdvisorEvidence => Boolean(item)))}
                >
                  <FileSearch className="size-3.5" aria-hidden="true" />
                  查看证据
                </button>
              )}
            </div>
          );
        })}

        {answer.recommendations.length > 0 && (
          <div className="grid gap-2 border-t border-[var(--line)] pt-3">
            {answer.recommendations.map((item) => {
              const untrusted = Boolean(item.basedOnReferenceIds?.length);
              return (
                <div key={item.id} className="grid min-w-0 gap-1">
                  {untrusted && (
                    <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                      建议基于所选通知或邮件内容，未作为校务事实核验
                    </span>
                  )}
                  <p className="flex min-w-0 items-start gap-2 text-sm leading-6 text-[var(--ink)]">
                    <Lightbulb className="mt-1 size-4 shrink-0 text-amber-600" aria-hidden="true" />
                    <span className="min-w-0 break-words [overflow-wrap:anywhere]">{item.text}</span>
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {(answer.uncertainties.length > 0 || answer.questionsForUser.length > 0) && (
          <div className="grid gap-1 text-xs leading-5 text-[var(--muted-foreground)]">
            {answer.uncertainties.map((item) => <p key={`u-${item}`} className="break-words [overflow-wrap:anywhere]">未确定：{item}</p>)}
            {answer.questionsForUser.map((item) => <p key={`q-${item}`} className="break-words [overflow-wrap:anywhere]">需要确认：{item}</p>)}
          </div>
        )}

        <span className="text-[10px] text-[var(--muted-foreground)]">
          {answer.model?.modelId || "本地降级"} · 输入 {answer.usage.inputBytes} B · 输出 {answer.usage.outputBytes} B
        </span>
      </div>
    </li>
  );
}
