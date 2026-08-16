import { Bot, CircleDot, Plus, Trash2, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { bridge, isDesktop } from "../../bridge";
import type { AdvisorThread } from "../../types";
import { AdvisorComposer } from "./AdvisorComposer";
import { AdvisorMessage } from "./AdvisorMessage";

type ToolStep = {
  name: string;
  status: "running" | "done" | "error";
  summary?: {
    itemCount?: number;
    matchCount?: number;
    claimCount?: number;
    riskCount?: number;
    requirementCount?: number;
    domain?: string;
    query?: string;
    hasMessage?: boolean;
    truncated?: boolean;
  };
  error?: string;
};

const TOOL_NAME_ZH: Record<string, string> = {
  get_data_health: "检查数据健康",
  search_campus_records: "查询校园记录",
  search_local_facts: "搜索本地事实",
  list_deadlines: "查找截止日期",
  inspect_academic_progress: "分析学业进度",
  inspect_course_analysis: "分析课程建议",
  read_message: "读取邮件正文",
};

function advisorErrorText(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : String(error || "")
  // Electron prefixes rejected IPC calls with the channel and error class. Strip
  // that transport noise before matching so older runtime messages remain safe.
  const message = rawMessage
    .replace(/^Error invoking remote method '[^']+':\s*/iu, "")
    .replace(/^AdvisorRuntimeError:\s*/iu, "")
    .trim()
  if (/provider-not-configured|请先在设置中完成/iu.test(message)) {
    return "尚未配置顾问模型服务，请在设置中完成地址、模型和 API Key。"
  }
  if (/timeout|超时/iu.test(message)) return "模型服务响应超时，本地顾问结果仍然可用。"
  return message || "顾问请求失败，请稍后重试。"
}

function optimisticMessage(text: string): AdvisorThread["messages"][number] {
  return {
    id: `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: "user",
    at: new Date().toISOString(),
    text,
  };
}

export function AdvisorWorkbench() {
  const [threads, setThreads] = useState<AdvisorThread[]>([]);
  const [threadId, setThreadId] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendingRequestId, setSendingRequestId] = useState("");
  const [runStatus, setRunStatus] = useState<"idle" | "preparing" | "reading" | "streaming" | "stopping">("idle");
  const [streamProgress, setStreamProgress] = useState({ requestId: "", characters: 0, chunks: 0 });
  const [streamText, setStreamText] = useState({ requestId: "", text: "" });
  const [toolSteps, setToolSteps] = useState<ToolStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const activeRequestRef = useRef("");
  const activeThreadRef = useRef("");
  const conversationRef = useRef<HTMLOListElement | null>(null);
  const stickToBottomRef = useRef(true);

  const current = useMemo(
    () => threads.find((thread) => thread.id === threadId) || threads[0] || null,
    [threadId, threads],
  );
  const showLiveStream = busy
    && streamText.requestId === activeRequestRef.current
    && Boolean(streamText.text.trimStart());

  useEffect(() => {
    stickToBottomRef.current = true;
    const conversation = conversationRef.current;
    if (conversation) conversation.scrollTop = conversation.scrollHeight;
  }, [threadId]);

  useEffect(() => {
    const conversation = conversationRef.current;
    if (!conversation || !stickToBottomRef.current) return;
    conversation.scrollTop = conversation.scrollHeight;
  }, [current?.messages.length, streamText.text]);

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
    if (!isDesktop) return;
    return bridge.onAdvisorStream((event) => {
      if (event.threadId !== activeThreadRef.current) return;
      if (activeRequestRef.current && event.requestId !== activeRequestRef.current) return;
      if (!activeRequestRef.current) activeRequestRef.current = event.requestId;

      // Handle text delta
      if (typeof event.delta === "string" && event.delta) {
        setRunStatus("streaming");
        setStreamProgress((currentProgress) => ({
          requestId: event.requestId,
          characters: currentProgress.requestId === event.requestId
            ? currentProgress.characters + event.delta.length
            : event.delta.length,
          chunks: currentProgress.requestId === event.requestId ? currentProgress.chunks + 1 : 1,
        }));
        setStreamText((currentText) => ({
          requestId: event.requestId,
          text: currentText.requestId === event.requestId ? currentText.text + event.delta : event.delta,
        }));
      }

      // Handle tool events
      if (event.tool) {
        if (event.tool.type === "start") {
          setRunStatus("reading");
          setToolSteps((current) => [
            ...current,
            {
              name: event.tool.name,
              status: "running",
            },
          ]);
        } else if (event.tool.type === "result") {
          setToolSteps((current) =>
            current.map((step, i) =>
              i === current.length - 1 && step.name === event.tool.name
                ? { ...step, status: "done", summary: event.tool.summary }
                : step
            )
          );
        } else if (event.tool.type === "error") {
          setToolSteps((current) =>
            current.map((step, i) =>
              i === current.length - 1 && step.name === event.tool.name
                ? { ...step, status: "error", error: event.tool.error }
                : step
            )
          );
        }
      }
    });
  }, []);

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

  const send = async () => {
    if (!current || !question.trim()) return;
    const targetThread = current;
    const submittedQuestion = question.trim();
    setBusy(true);
    setError(null);
    setRunStatus("streaming");
    setStreamProgress({ requestId: "", characters: 0, chunks: 0 });
    setStreamText({ requestId: "", text: "" });
    setToolSteps([]);
    activeThreadRef.current = targetThread.id;
    // The runtime persists this turn before calling the model, but the IPC
    // promise resolves only after generation. Render it immediately so the
    // user's message leaves the composer as soon as Send is pressed.
    const pendingMessage = optimisticMessage(submittedQuestion);
    setThreads((currentThreads) => currentThreads.map((thread) => thread.id === targetThread.id
      ? {
        ...thread,
        title: thread.title === "新顾问对话" ? submittedQuestion.slice(0, 40) : thread.title,
        updatedAt: pendingMessage.at,
        messages: [...thread.messages, pendingMessage],
      }
      : thread));
    try {
      const result = await bridge.sendAdvisorRequest({
        threadId: targetThread.id,
        question: submittedQuestion,
      });
      if (!activeRequestRef.current) activeRequestRef.current = result.requestId;
      setSendingRequestId(result.requestId);
      await refresh(result.threadId);
      setStreamText({ requestId: "", text: "" });
      setToolSteps([]);
      setQuestion((value) => value.trim() === submittedQuestion ? "" : value);
    } catch (caught) {
      if (!/cancelled|已取消/iu.test(caught instanceof Error ? caught.message : String(caught || ""))) {
        setError(advisorErrorText(caught));
      }
      await refresh(targetThread.id).catch(() => undefined);
    } finally {
      activeRequestRef.current = "";
      activeThreadRef.current = "";
      setSendingRequestId("");
      setRunStatus("idle");
      setBusy(false);
    }
  };

  const cancel = async () => {
    const requestId = activeRequestRef.current || sendingRequestId || current?.activeRequestId;
    const threadId = activeThreadRef.current || current?.id;
    if (!requestId && !threadId) return;
    setRunStatus("stopping");
    try {
      await bridge.cancelAdvisorRequest({ requestId: requestId || undefined, threadId: threadId || undefined });
    } catch (caught) {
      setRunStatus("reading");
      setError(advisorErrorText(caught));
    }
  };

  return (
    <section className="advisor-model-panel advisor-agent-workbench grid min-w-0 gap-4" aria-labelledby="advisor-model-title">
      <header className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-3">
          <span className="advisor-agent-mark" aria-hidden="true"><Bot className="size-4" /></span>
          <span className="grid min-w-0 gap-0.5">
            <strong id="advisor-model-title" className="text-sm text-[var(--ink)]">THEIA Agent</strong>
            <span className="truncate text-[11px] text-[var(--muted-foreground)]">消息直接发送给模型</span>
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="advisor-agent-status" title="所有已保存的本地校园数据可由 Agent 按问题读取">
            <CircleDot className="size-3" aria-hidden="true" /> 本地工具就绪
          </span>
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

      <div className="advisor-chat-stage min-h-0 min-w-0">
        {current?.messages.length || showLiveStream ? (
          <ol
            ref={conversationRef}
            className="advisor-agent-conversation grid min-h-0 min-w-0 gap-4 overflow-y-auto pr-1"
            aria-live="polite"
            aria-label="THEIA Agent 对话"
            onScroll={(event) => {
              const element = event.currentTarget;
              const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
              stickToBottomRef.current = distance < 48;
            }}
          >
          {current.messages.map((message) => (
              <AdvisorMessage key={message.id} message={message} />
          ))}
          {toolSteps.length > 0 && (
            <li className="advisor-tool-steps flex min-w-0 gap-2">
              <Bot className="mt-1 size-4 shrink-0 text-[var(--muted-foreground)]" aria-hidden="true" />
              <div className="min-w-0 flex-1 space-y-1.5">
                {toolSteps.map((step, i) => (
                  <div
                    key={i}
                    className="flex min-w-0 items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--canvas)] px-3 py-2"
                  >
                    {step.status === "running" && (
                      <Loader2 className="size-3.5 shrink-0 animate-spin text-[var(--teal)]" aria-hidden="true" />
                    )}
                    {step.status === "done" && (
                      <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                    )}
                    {step.status === "error" && (
                      <XCircle className="size-3.5 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
                    )}
                    <span className="min-w-0 flex-1 text-xs text-[var(--ink)]">
                      {TOOL_NAME_ZH[step.name] || step.name}
                      {step.summary && (
                        <span className="ml-2 text-[var(--muted-foreground)]">
                          {step.summary.domain && `${step.summary.domain} · `}
                          {step.summary.itemCount !== undefined && `${step.summary.itemCount} 项`}
                          {step.summary.matchCount !== undefined && `${step.summary.matchCount} 匹配`}
                          {step.summary.claimCount !== undefined && `${step.summary.claimCount} 声明`}
                          {step.summary.riskCount !== undefined && `${step.summary.riskCount} 风险`}
                          {step.summary.requirementCount !== undefined && `${step.summary.requirementCount} 要求`}
                          {step.summary.hasMessage && `邮件正文`}
                          {step.summary.truncated && ` · 已截断`}
                        </span>
                      )}
                      {step.error && (
                        <span className="ml-2 text-red-600 dark:text-red-400">
                          {step.error}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </li>
          )}
          {showLiveStream && (
            <li className="advisor-agent-message flex min-w-0 gap-2" aria-live="polite">
              <Bot className="mt-1 size-4 shrink-0 text-[var(--teal)]" aria-hidden="true" />
              <div className="advisor-agent-answer min-w-0 flex-1 border-l border-[var(--line-strong)] pl-3">
                <p className="whitespace-pre-wrap break-words text-sm leading-6 text-[var(--ink)] [overflow-wrap:anywhere]">{streamText.text}</p>
              </div>
            </li>
          )}
        </ol>
        ) : (
          <div className="advisor-agent-empty" role="status">
            <span className="advisor-agent-empty-mark" aria-hidden="true"><Bot className="size-5" /></span>
            <span>
              <strong>从一个问题开始</strong>
              <small>THEIA 会自行检索当前问题需要的本地校园数据。</small>
            </span>
          </div>
        )}

        {error && <p className="advisor-agent-error break-words text-xs [overflow-wrap:anywhere]" role="alert">{error}</p>}

        <AdvisorComposer
          question={question}
          disabled={!isDesktop || !current}
          active={busy}
          canCancel={Boolean(activeRequestRef.current || sendingRequestId || activeThreadRef.current || current?.activeRequestId)}
          status={runStatus}
          streamedCharacterCount={streamProgress.characters}
          streamedChunkCount={streamProgress.chunks}
          onQuestionChange={setQuestion}
          onSubmit={() => void send()}
          onCancel={() => void cancel()}
        />
      </div>
    </section>
  );
}
