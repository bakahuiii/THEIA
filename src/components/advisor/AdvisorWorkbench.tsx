import { Bot, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { bridge, isDesktop } from "../../bridge";
import type {
  AdvisorEvidence,
  AdvisorIntent,
  AdvisorPreparedRequest,
  AdvisorThread,
  EmailMessage,
  Notice,
} from "../../types";
import { AdvisorComposer } from "./AdvisorComposer";
import { DisclosureDialog } from "./DisclosureDialog";
import { AdvisorMessage } from "./AdvisorMessage";

function advisorErrorText(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : String(error || "")
  // Electron prefixes rejected IPC calls with the channel and error class. Strip
  // that transport noise before matching so older runtime messages remain safe.
  const message = rawMessage
    .replace(/^Error invoking remote method '[^']+':\s*/iu, "")
    .replace(/^AdvisorRuntimeError:\s*/iu, "")
    .trim()
  if (/Read-only Agent output (?:validation failed|did not pass evidence and format verification)|evidence_verification_failed|model-output-invalid/iu.test(message)) {
    return "模型回答未通过顾问证据校验。THEIA 已保留本地分析，请关闭只读 Agent 或重新发送。"
  }
  if (/provider-not-configured|请先在设置中完成/iu.test(message)) {
    return "尚未配置顾问模型服务，请在设置中完成地址、模型和 API Key。"
  }
  if (/timeout|超时/iu.test(message)) return "模型服务响应超时，本地顾问结果仍然可用。"
  return message || "顾问请求失败，请稍后重试。"
}

export function AdvisorWorkbench({
  notices,
  emails,
  evidence,
  onEvidence,
}: {
  notices: Notice[];
  emails: EmailMessage[];
  evidence: AdvisorEvidence[];
  onEvidence: (title: string, entries: AdvisorEvidence[]) => void;
}) {
  const [threads, setThreads] = useState<AdvisorThread[]>([]);
  const [threadId, setThreadId] = useState("");
  const [question, setQuestion] = useState("");
  const [intent, setIntent] = useState<AdvisorIntent>("daily");
  const [selectedNoticeId, setSelectedNoticeId] = useState("");
  const [selectedMailId, setSelectedMailId] = useState("");
  const [includeMailBody, setIncludeMailBody] = useState(false);
  const [prepared, setPrepared] = useState<AdvisorPreparedRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [sendingRequestId, setSendingRequestId] = useState("");
  const [streaming, setStreaming] = useState(true);
  const [agent, setAgent] = useState(false);
  const [readableDomains, setReadableDomains] = useState<string[]>([]);
  const [streamText, setStreamText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const current = useMemo(
    () => threads.find((thread) => thread.id === threadId) || threads[0] || null,
    [threadId, threads],
  );

  const refresh = async (preferredId?: string) => {
    const next = await bridge.listAdvisorThreads();
    setThreads(next);
    const target = preferredId && next.some((thread) => thread.id === preferredId)
      ? preferredId
      : next[0]?.id || "";
    setThreadId(target);
    return next;
  };

  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;
    void bridge.listAdvisorThreads().then(async (existing) => {
      const next = existing.length ? existing : [await bridge.createAdvisorThread()];
      if (cancelled) return;
      setThreads(next);
      setThreadId(next[0]?.id || "");
    }).catch((caught) => {
      if (!cancelled) setError(advisorErrorText(caught));
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!isDesktop) return undefined;
    return bridge.onAdvisorStream((event) => {
      if (event.requestId !== sendingRequestId) return;
      setStreamText((currentText) => `${currentText}${event.delta}`.slice(0, 1_000_000));
    });
  }, [sendingRequestId]);

  const createThread = async () => {
    try {
      const thread = await bridge.createAdvisorThread();
      await refresh(thread.id);
      setError(null);
    } catch (caught) {
      setError(advisorErrorText(caught));
    }
  };

  const deleteThread = async () => {
    if (!current) return;
    try {
      await bridge.deleteAdvisorThread(current.id);
      const next = await refresh();
      if (!next.length) {
        const created = await bridge.createAdvisorThread();
        await refresh(created.id);
      }
    } catch (caught) {
      setError(advisorErrorText(caught));
    }
  };

  const changeIntent = (nextIntent: AdvisorIntent) => {
    setIntent(nextIntent);
    if (nextIntent !== "notice") setSelectedNoticeId("");
    if (nextIntent !== "mail") {
      setSelectedMailId("");
      setIncludeMailBody(false);
    }
  };

  const prepare = async () => {
    if (!current || !question.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await bridge.prepareAdvisorRequest({
        threadId: current.id,
        question: question.trim(),
        intent,
        ...(intent === "notice" && selectedNoticeId ? { selectedNoticeIds: [selectedNoticeId] } : {}),
        ...(intent === "mail" && selectedMailId ? { selectedMailIds: [selectedMailId] } : {}),
        ...(intent === "mail" && selectedMailId && includeMailBody ? { includeMailBodyIds: [selectedMailId] } : {}),
        ...(agent ? { agent: true } : {}),
        ...(readableDomains.length ? { readableDomains } : {}),
      });
      setPrepared(result);
    } catch (caught) {
      setError(advisorErrorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!prepared) return;
    const currentRequest = prepared;
    setBusy(true);
    setSendingRequestId(currentRequest.requestId);
    setStreamText("");
    setPrepared(null);
    setError(null);
    try {
      await bridge.sendAdvisorRequest({ requestId: currentRequest.requestId, approved: true, stream: streaming });
      await refresh(currentRequest.threadId);
      setQuestion("");
    } catch (caught) {
      setError(advisorErrorText(caught));
      await refresh(currentRequest.threadId).catch(() => undefined);
    } finally {
      setSendingRequestId("");
      setBusy(false);
    }
  };

  const cancel = async () => {
    const requestId = sendingRequestId || current?.activeRequestId;
    if (!requestId) return;
    await bridge.cancelAdvisorRequest({ requestId });
    await refresh(current.id).catch(() => undefined);
  };

  return (
    <section className="advisor-model-panel grid min-w-0 gap-4" aria-labelledby="advisor-model-title">
      <header className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <Bot className="size-4 shrink-0 text-[var(--teal)]" aria-hidden="true" />
          <strong id="advisor-model-title" className="text-sm text-[var(--ink)]">问 THEIA</strong>
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <select
            value={current?.id || ""}
            onChange={(event) => setThreadId(event.target.value)}
            className="h-8 min-w-0 max-w-52 rounded-md border border-[var(--line)] bg-[var(--paper)] px-2 text-[11px] text-[var(--ink)]"
            disabled={!isDesktop || busy}
            aria-label="顾问线程"
          >
            {threads.map((thread) => <option key={thread.id} value={thread.id}>{thread.title}</option>)}
          </select>
          <button type="button" className="grid size-8 place-items-center rounded-md border border-[var(--line)] text-[var(--ink)]" onClick={() => void createThread()} disabled={!isDesktop || busy} title="新建顾问线程">
            <Plus className="size-4" aria-hidden="true" />
          </button>
          <button type="button" className="grid size-8 place-items-center rounded-md border border-[var(--line)] text-red-700 disabled:opacity-40 dark:text-red-300" onClick={() => void deleteThread()} disabled={!current || busy} title="删除当前线程">
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        </span>
      </header>

      {current?.messages.length ? (
        <ol className="grid max-h-[34rem] min-w-0 gap-4 overflow-y-auto pr-1" aria-live="polite">
        {current.messages.map((message) => (
            <AdvisorMessage key={message.id} message={message} evidence={evidence} onEvidence={onEvidence} />
        ))}
        {streamText && (
          <li className="flex min-w-0 gap-2" aria-label="正在生成的未验证预览">
            <Bot className="mt-1 size-4 shrink-0 text-[var(--teal)]" aria-hidden="true" />
            <p className="min-w-0 break-words border-l border-dashed border-[var(--line-strong)] pl-3 text-sm leading-6 text-[var(--muted-foreground)] [overflow-wrap:anywhere]">{streamText}</p>
          </li>
        )}
      </ol>
      ) : streamText ? (
        <ol className="grid max-h-[34rem] min-w-0 gap-4 overflow-y-auto pr-1" aria-live="polite">
          <li className="flex min-w-0 gap-2" aria-label="正在生成的未验证预览">
            <Bot className="mt-1 size-4 shrink-0 text-[var(--teal)]" aria-hidden="true" />
            <p className="min-w-0 break-words border-l border-dashed border-[var(--line-strong)] pl-3 text-sm leading-6 text-[var(--muted-foreground)] [overflow-wrap:anywhere]">{streamText}</p>
          </li>
        </ol>
      ) : null}

      <AdvisorComposer
        question={question}
        intent={intent}
        notices={notices}
        emails={emails}
        selectedNoticeId={selectedNoticeId}
        selectedMailId={selectedMailId}
        includeMailBody={includeMailBody}
        disabled={!isDesktop || busy || !current}
        active={Boolean(sendingRequestId || current?.activeRequestId)}
        streaming={streaming}
        agent={agent}
        readableDomains={readableDomains}
        onQuestionChange={setQuestion}
        onIntentChange={changeIntent}
        onNoticeChange={setSelectedNoticeId}
        onMailChange={setSelectedMailId}
        onIncludeMailBodyChange={setIncludeMailBody}
        onStreamingChange={setStreaming}
        onAgentChange={(enabled) => {
          setAgent(enabled);
          if (enabled) setStreaming(false);
        }}
        onReadableDomainsChange={setReadableDomains}
        onSubmit={() => void prepare()}
        onCancel={() => void cancel()}
      />

      {error && <p className="break-words text-xs text-red-700 dark:text-red-300 [overflow-wrap:anywhere]" role="alert">{error}</p>}

      <DisclosureDialog
        prepared={prepared}
        sending={busy}
        onCancel={() => setPrepared(null)}
        onApprove={() => void send()}
      />
    </section>
  );
}
