import {
  AlertTriangle,
  Bot,
  Check,
  CircleDot,
  LayoutDashboard,
  Loader2,
  MessageSquare,
  PanelLeft,
  PanelLeftClose,
  Plus,
  Settings2,
  Trash2,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { bridge, isDesktop } from "../../bridge";
import type { AdvisorThread, CampusState, ModelStatus } from "../../types";
import { formatDateTime } from "../../ui/app-shared";
import { AdvisorComposer } from "./AdvisorComposer.v2";
import { AdvisorMarkdown } from "./AdvisorMarkdown";
import { AdvisorMessage } from "./AdvisorMessage.v2";

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

type AdvisorRunStatus = "idle" | "preparing" | "reading" | "streaming" | "stopping";
type StreamGateMode = "undecided" | "text" | "tool";

const TOOL_NAME_ZH: Record<string, string> = {
  get_data_health: "检查数据健康",
  search_campus_records: "查询校园记录",
  search_local_facts: "搜索本地事实",
  list_deadlines: "查找截止日期",
  inspect_academic_progress: "分析学业进度",
  inspect_course_analysis: "分析课程建议",
  read_message: "读取邮件正文",
  sync_campus_data: "同步校园数据",
  network_request: "请求网络资源",
  open_campus_source: "打开校园页面",
  update_theia_settings: "更新 THEIA 设置",
  control_course_selection: "控制选课任务",
  read_file: "读取文件",
  write_file: "写入文件",
  list_directory: "列出目录",
  create_directory: "创建目录",
  delete_path: "删除路径",
  run_command: "执行命令",
  web_request: "请求网页",
  open_webpage: "打开网页",
};

function advisorErrorText(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : String(error || "");
  const message = rawMessage
    .replace(/^Error invoking remote method '[^']+':\s*/iu, "")
    .replace(/^AdvisorRuntimeError:\s*/iu, "")
    .trim();
  if (/provider-not-configured|请先在设置中完成/iu.test(message)) {
    return "请在模型设置中完成服务地址和模型 ID；需要密钥的服务还要保存 API Key。";
  }
  if (/timeout|超时/iu.test(message)) return "模型服务响应超时；下方学业概览仍可查看，请稍后重试。";
  return message || "顾问请求失败，请稍后重试。";
}

function optimisticMessage(text: string): AdvisorThread["messages"][number] {
  return {
    id: `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: "user",
    at: new Date().toISOString(),
    text,
  };
}

function formatTime(isoString: string) {
  const date = new Date(isoString);
  const diffMinutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMinutes < 1) return "刚刚";
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} 小时前`;
  return formatDateTime(isoString, false);
}

function threadTitle(thread: AdvisorThread) {
  return thread.title === "新顾问对话" ? "新顾问任务" : thread.title;
}

function toolSummary(step: ToolStep) {
  if (!step.summary) return "";
  const values = [
    step.summary.domain,
    step.summary.itemCount !== undefined ? `${step.summary.itemCount} 项` : null,
    step.summary.matchCount !== undefined ? `${step.summary.matchCount} 匹配` : null,
    step.summary.claimCount !== undefined ? `${step.summary.claimCount} 声明` : null,
    step.summary.riskCount !== undefined ? `${step.summary.riskCount} 风险` : null,
    step.summary.requirementCount !== undefined ? `${step.summary.requirementCount} 要求` : null,
    step.summary.hasMessage ? "邮件正文" : null,
    step.summary.truncated ? "已截断" : null,
  ].filter(Boolean);
  return values.join(" · ");
}

function isAdvisorToolCall(value: string) {
  const candidate = String(value || "")
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "")
  try {
    const parsed = JSON.parse(candidate);
    return parsed
      && typeof parsed === "object"
      && !Array.isArray(parsed)
      && parsed.schema === "theia-advisor-tool-call/v1";
  } catch {
    return false;
  }
}

function visibleStreamDelta(value: string, gate: { mode: StreamGateMode; buffered: string }) {
  if (gate.mode === "text") return value;
  if (gate.mode === "tool") return "";

  gate.buffered += value;
  const trimmed = gate.buffered.trimStart();
  if (!trimmed) return "";
  const protocolCandidate = trimmed.replace(/^```(?:json)?\s*/iu, "");
  if (!protocolCandidate.startsWith("{") || gate.buffered.length > 32_000) {
    gate.mode = "text";
    const visible = gate.buffered;
    gate.buffered = "";
    return visible;
  }

  try {
    JSON.parse(protocolCandidate.replace(/\s*```$/u, ""));
  } catch {
    return "";
  }
  const visible = gate.buffered;
  gate.buffered = "";
  gate.mode = isAdvisorToolCall(visible) ? "tool" : "text";
  return gate.mode === "tool" ? "" : visible;
}

function advisorAvailability(modelStatus: ModelStatus) {
  if (!isDesktop) {
    return {
      title: "Agent 需要桌面客户端",
      detail: "当前是浏览器预览，只展示界面；请打开 THEIA 桌面客户端使用 Agent。",
    };
  }
  if (modelStatus.configured) return null;
  if (modelStatus.requiresApiKeyReentry) {
    return {
      title: "需要重新保存 API Key",
      detail: "当前 Windows 账户无法读取已保存的 API Key。请打开模型设置，重新输入并保存后再使用 Agent。",
    };
  }
  if (!modelStatus.baseUrl.trim()) {
    return {
      title: "还没有连接模型服务",
      detail: "请在模型设置中填写服务地址和模型 ID；需要密钥的服务还要保存 API Key。",
    };
  }
  if (!modelStatus.model.trim()) {
    return {
      title: "还没有选择模型",
      detail: "服务地址已经填写，但还缺少模型 ID。请打开模型设置，输入模型 ID 后保存。",
    };
  }
  if (!modelStatus.apiKeySaved && modelStatus.provider === "ollama-chat") {
    return {
      title: "Ollama 还没有可用密钥",
      detail: "当前 Ollama 地址不是本机免密服务，请在模型设置中保存 API Key，或改用本机 Ollama 地址。",
    };
  }
  if (!modelStatus.apiKeySaved) {
    return {
      title: "还没有保存 API Key",
      detail: "模型信息已经填写，但 Agent 还无法连接服务。请打开模型设置，输入并保存 API Key。",
    };
  }
  return {
    title: "模型服务暂不可用",
    detail: "请打开模型设置检查服务地址、模型 ID 和 API Key，然后再试一次。",
  };
}

export function AdvisorWorkbench({
  modelStatus,
  onOpenInsights,
  onOpenSettings,
}: {
  modelStatus: ModelStatus;
  onOpenInsights?: () => void;
  onOpenSettings?: () => void;
}) {
  const [threads, setThreads] = useState<AdvisorThread[]>([]);
  const [threadId, setThreadId] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendingRequestId, setSendingRequestId] = useState("");
  const [runStatus, setRunStatus] = useState<AdvisorRunStatus>("idle");
  const [streamProgress, setStreamProgress] = useState({ requestId: "", characters: 0, chunks: 0 });
  const [streamText, setStreamText] = useState({ requestId: "", text: "" });
  const [toolSteps, setToolSteps] = useState<ToolStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [budgetLevel, setBudgetLevel] = useState<CampusState["settings"]["advisorConfig"]["budgetLevel"]>("high");
  const [reasoningEffort, setReasoningEffort] = useState<CampusState["settings"]["advisorConfig"]["reasoningEffort"]>("medium");
  const [permissionMode, setPermissionMode] = useState<CampusState["settings"]["advisorConfig"]["permissionMode"]>("read-only");
  const [temperature, setTemperature] = useState(1);
  const [threadPanelOpen, setThreadPanelOpen] = useState(() => typeof window === "undefined" || window.innerWidth > 720);
  const [statusOpen, setStatusOpen] = useState(false);
  const activeRequestRef = useRef("");
  const activeThreadRef = useRef("");
  const streamGateRef = useRef<{ mode: StreamGateMode; buffered: string }>({ mode: "undecided", buffered: "" });
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const stickToBottomRef = useRef(true);

  const current = useMemo(
    () => threads.find((thread) => thread.id === threadId) || threads[0] || null,
    [threadId, threads],
  );
  const fullAccess = permissionMode === "full-access";
  const availability = advisorAvailability(modelStatus);
  const composerDisabled = Boolean(availability) || !current;
  const composerDisabledReason = availability?.detail || (!current ? "正在加载顾问任务" : undefined);
  const showLiveStream = busy
    && streamText.requestId === activeRequestRef.current
    && Boolean(streamText.text.trimStart());

  useEffect(() => {
    stickToBottomRef.current = true;
    if (conversationRef.current) conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
  }, [threadId]);

  useEffect(() => {
    const conversation = conversationRef.current;
    if (!conversation || !stickToBottomRef.current) return;
    conversation.scrollTop = conversation.scrollHeight;
  }, [current?.messages.length, streamText.text, toolSteps.length]);

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
      if (cancelled) return;
      if (!existing.length && !modelStatus.configured) {
        setThreads([]);
        setThreadId("");
        return;
      }
      const next = existing.length
        ? existing
        : [await bridge.createAdvisorThread()];
      if (cancelled) return;
      setThreads(next);
      setThreadId(next[0]?.id || "");
    }).catch((caught) => {
      if (!cancelled) setError(advisorErrorText(caught));
    });
    void bridge.getRendererSnapshot().then((state) => {
      if (cancelled) return;
      setBudgetLevel(state.settings.advisorConfig?.budgetLevel || "high");
      setReasoningEffort(state.settings.advisorConfig?.reasoningEffort || "medium");
      setPermissionMode(state.settings.advisorConfig?.permissionMode || "read-only");
      setTemperature(state.settings.advisorConfig?.temperature ?? 1);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [modelStatus.configured]);

  useEffect(() => {
    if (!isDesktop) return;
    return bridge.onAdvisorStream((event) => {
      if (event.threadId !== activeThreadRef.current) return;
      if (activeRequestRef.current && event.requestId !== activeRequestRef.current) return;
      if (!activeRequestRef.current) activeRequestRef.current = event.requestId;

      if (event.tool?.type === "start") {
        streamGateRef.current = { mode: "undecided", buffered: "" };
        setStreamProgress({ requestId: "", characters: 0, chunks: 0 });
        setStreamText({ requestId: "", text: "" });
      }

      const delta = typeof event.delta === "string" ? visibleStreamDelta(event.delta, streamGateRef.current) : "";
      if (delta) {
        setRunStatus("streaming");
        setStreamProgress((previous) => ({
          requestId: event.requestId,
          characters: previous.requestId === event.requestId
            ? previous.characters + delta.length
            : delta.length,
          chunks: previous.requestId === event.requestId ? previous.chunks + 1 : 1,
        }));
        setStreamText((previous) => ({
          requestId: event.requestId,
          text: previous.requestId === event.requestId ? previous.text + delta : delta,
        }));
      }

      if (event.tool) {
        const tool = event.tool;
        if (tool.type === "start") {
          setRunStatus("reading");
          setToolSteps((previous) => [...previous, { name: tool.name, status: "running" }]);
        } else if (tool.type === "result" || tool.type === "error") {
          setToolSteps((previous) => previous.map((step, index) =>
            index === previous.length - 1 && step.name === tool.name
              ? { ...step, status: tool.type === "result" ? "done" : "error", summary: tool.summary, error: tool.error }
              : step,
          ));
        }
      }
    });
  }, []);

  const createThread = async () => {
    if (!modelStatus.configured) return;
    try {
      const thread = await bridge.createAdvisorThread();
      await refresh(thread.id);
      setQuestion("");
      setError(null);
      composerRef.current?.focus();
    } catch (caught) {
      setError(advisorErrorText(caught));
    }
  };

  const deleteThread = async () => {
    if (!current || busy) return;
    try {
      const next = await bridge.deleteAdvisorThread(current.id).then(() => bridge.listAdvisorThreads());
      if (next.length) {
        setThreads(next);
        setThreadId(next[0].id);
      } else if (modelStatus.configured) {
        const created = await bridge.createAdvisorThread();
        await refresh(created.id);
      } else {
        setThreads([]);
        setThreadId("");
      }
      setError(null);
    } catch (caught) {
      setError(advisorErrorText(caught));
    }
  };

  const send = async () => {
    if (!current || !question.trim() || busy) return;
    if (availability) {
      setError(availability.detail);
      return;
    }
    const targetThread = current;
    const submittedQuestion = question.trim();
    const pendingMessage = optimisticMessage(submittedQuestion);
    setBusy(true);
    setError(null);
    setRunStatus("preparing");
    setStreamProgress({ requestId: "", characters: 0, chunks: 0 });
    setStreamText({ requestId: "", text: "" });
    setToolSteps([]);
    streamGateRef.current = { mode: "undecided", buffered: "" };
    activeThreadRef.current = targetThread.id;
    setThreads((previous) => previous.map((thread) => thread.id === targetThread.id
      ? {
        ...thread,
        title: thread.title === "新顾问对话" ? submittedQuestion.slice(0, 40) : thread.title,
        updatedAt: pendingMessage.at,
        messages: [...thread.messages, pendingMessage],
      }
      : thread));
    setQuestion("");
    try {
      const result = await bridge.sendAdvisorRequest({ threadId: targetThread.id, question: submittedQuestion });
      if (!result) {
        await refresh(targetThread.id);
        return;
      }
      if (!activeRequestRef.current) activeRequestRef.current = result.requestId;
      setSendingRequestId(result.requestId);
      await refresh(result.threadId);
      setStreamText({ requestId: "", text: "" });
      setToolSteps([]);
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
    const targetThreadId = activeThreadRef.current || current?.id;
    if (!requestId && !targetThreadId) return;
    setRunStatus("stopping");
    try {
      await bridge.cancelAdvisorRequest({ requestId: requestId || undefined, threadId: targetThreadId || undefined });
    } catch (caught) {
      setRunStatus("reading");
      setError(advisorErrorText(caught));
    }
  };

  const updateAdvisorConfig = async (key: "budgetLevel" | "permissionMode" | "reasoningEffort" | "temperature", value: string | number) => {
    try {
      const config = await bridge.getRendererSnapshot().then((state) => state.settings.advisorConfig);
      await bridge.updateSettings({ advisorConfig: { ...config, [key]: value } });
    } catch (caught) {
      setError(advisorErrorText(caught));
    }
  };

  return (
    <section
      className={`advisor-workbench-v2${threadPanelOpen ? "" : " advisor-v2-no-sidebar"}`}
      aria-labelledby="advisor-workbench-title"
    >
      {threadPanelOpen && (
        <aside className="advisor-v2-sidebar" aria-label="顾问任务历史">
          <div className="advisor-v2-sidebar-topline">
            <span className="advisor-v2-sidebar-label">顾问任务</span>
            <button
              type="button"
              className="advisor-v2-icon-button advisor-v2-sidebar-close"
              onClick={() => setThreadPanelOpen(false)}
              title="收起任务栏"
              aria-label="收起任务栏"
            >
              <PanelLeftClose className="size-4" aria-hidden="true" />
            </button>
          </div>
          <button
            type="button"
            className="advisor-v2-new-thread"
            onClick={() => void createThread()}
            disabled={!isDesktop || busy || !modelStatus.configured}
          >
            <Plus className="size-4" aria-hidden="true" />
            <span>新建任务</span>
            <span className="advisor-v2-new-thread-shortcut">N</span>
          </button>
          <div className="advisor-v2-thread-heading">
            <span>最近任务</span>
            <span className="advisor-v2-thread-heading-actions">
              <span>{threads.length}</span>
              <button
                type="button"
                className="advisor-v2-icon-button"
                onClick={() => void deleteThread()}
                disabled={!current || busy}
                title="删除当前任务"
                aria-label="删除当前任务"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </button>
            </span>
          </div>
          <nav className="advisor-v2-thread-list" aria-label="顾问任务列表">
            {threads.map((thread) => (
              <button
                type="button"
                key={thread.id}
                className={`advisor-v2-thread${thread.id === current?.id ? " is-active" : ""}`}
                onClick={() => { if (!busy) { setThreadId(thread.id); setQuestion(""); } }}
                disabled={busy}
                aria-current={thread.id === current?.id ? "page" : undefined}
              >
                <MessageSquare className="advisor-v2-thread-icon" aria-hidden="true" />
                <span className="advisor-v2-thread-copy">
                  <strong>{threadTitle(thread)}</strong>
                  <small>{thread.messages.length ? `${thread.messages.length} 条消息 · ` : "空任务 · "}{formatTime(thread.updatedAt)}</small>
                </span>
                {thread.id === current?.id && <Check className="advisor-v2-thread-check" aria-hidden="true" />}
              </button>
            ))}
            {!threads.length && <p className="advisor-v2-thread-empty">还没有顾问任务</p>}
          </nav>
          <div className="advisor-v2-sidebar-footer">
            <div className="advisor-v2-local-status">
              <CircleDot className="size-3.5" aria-hidden="true" />
              <span>{fullAccess ? "完全访问已启用" : "只读（受控）模式"}</span>
            </div>
            <small>{fullAccess ? "可读写文件、执行命令并调用网页工具" : "保留校园数据和既有受控 Agent 操作"}</small>
          </div>
        </aside>
      )}

      <main className="advisor-v2-main">
        <header className="advisor-v2-header">
          <div className="advisor-v2-header-title">
            <button
              type="button"
              className="advisor-v2-icon-button"
              onClick={() => setThreadPanelOpen((open) => !open)}
              title={threadPanelOpen ? "收起任务栏" : "打开任务栏"}
              aria-label={threadPanelOpen ? "收起任务栏" : "打开任务栏"}
            >
              {threadPanelOpen ? <PanelLeftClose className="size-4" aria-hidden="true" /> : <PanelLeft className="size-4" aria-hidden="true" />}
            </button>
            <span className="advisor-v2-agent-mark" aria-hidden="true"><Bot className="size-4" /></span>
            <span className="advisor-v2-header-copy">
              <strong id="advisor-workbench-title">THEIA Agent</strong>
              <small>{current ? threadTitle(current) : "学业顾问"}</small>
            </span>
          </div>
          <div className="advisor-v2-header-actions">
            <button
              type="button"
              className="advisor-v2-status-button"
              onClick={() => setStatusOpen((open) => !open)}
              aria-expanded={statusOpen}
              title="查看本地数据范围"
            >
              <CircleDot className="size-3" aria-hidden="true" />
              <span>{fullAccess ? "完全访问" : "只读（受控）"}</span>
            </button>
            <button
              type="button"
              className="advisor-v2-header-button"
              onClick={onOpenInsights}
              disabled={!onOpenInsights}
              title="打开学业概览"
              aria-label="学业概览"
            >
              <LayoutDashboard className="size-4" aria-hidden="true" />
              <span>学业概览</span>
            </button>
          </div>
          {statusOpen && (
            <div className="advisor-v2-status-popover" role="status">
              <strong>{fullAccess ? "完全访问已启用" : "只读（受控）模式"}</strong>
              <span>{fullAccess
                ? "Agent 可读写本地文件、执行命令、请求网页和打开链接；保存的密码、Cookie、API Key 和会话仍不会暴露。"
                : "顾问可使用当前受控校园操作，但不会获得通用文件系统、Shell 或任意网页访问。"}</span>
            </div>
          )}
        </header>

        {availability && (
          <div className="advisor-v2-model-gate" role="status">
            <div className="advisor-v2-model-gate-copy">
              <AlertTriangle className="size-4" aria-hidden="true" />
              <span>
                <strong>{availability.title}</strong>
                <small>{availability.detail}</small>
              </span>
            </div>
            {isDesktop && onOpenSettings && (
              <button
                type="button"
                className="advisor-v2-model-gate-action"
                onClick={onOpenSettings}
              >
                <Settings2 className="size-3.5" aria-hidden="true" />
                <span>打开模型设置</span>
              </button>
            )}
          </div>
        )}

        <div
          ref={conversationRef}
          className="advisor-v2-conversation"
          aria-live="polite"
          aria-label="THEIA Agent 对话"
          onScroll={(event) => {
            const element = event.currentTarget;
            stickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
          }}
        >
          {current?.messages.length || showLiveStream ? (
            <div className="advisor-v2-message-stack">
              {current?.messages.map((message) => <AdvisorMessage key={message.id} message={message} />)}
              {toolSteps.length > 0 && (
                <div className="advisor-v2-tool-section" aria-label="工具调用进度">
                  <div className="advisor-v2-tool-heading">
                    <Settings2 className="size-3.5" aria-hidden="true" />
                    <span>正在处理本地信息</span>
                  </div>
                  <div className="advisor-v2-tool-list">
                    {toolSteps.map((step, index) => (
                      <div key={`${step.name}-${index}`} className={`advisor-v2-tool-step is-${step.status}`}>
                        {step.status === "running" && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
                        {step.status === "done" && <Check className="size-3.5" aria-hidden="true" />}
                        {step.status === "error" && <XCircle className="size-3.5" aria-hidden="true" />}
                        <span>{TOOL_NAME_ZH[step.name] || step.name}</span>
                        {toolSummary(step) && <small>{toolSummary(step)}</small>}
                        {step.error && <small className="advisor-v2-tool-error">{step.error}</small>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {showLiveStream && (
                <div className="advisor-v2-live-answer" aria-label="正在生成回答">
                  <span className="advisor-v2-message-avatar is-assistant" aria-hidden="true"><Bot className="size-4" /></span>
                  <div className="advisor-v2-live-copy">
                    <span className="advisor-v2-speaker">THEIA Agent</span>
                    <AdvisorMarkdown source={streamText.text} live />
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  </div>
                </div>
              )}
            </div>
          ) : availability ? (
            <div className="advisor-v2-empty">
              <span className="advisor-v2-empty-mark is-warning" aria-hidden="true"><AlertTriangle className="size-6" /></span>
              <h2>{availability.title}</h2>
              <p>{availability.detail}</p>
            </div>
          ) : (
            <div className="advisor-v2-empty">
              <span className="advisor-v2-empty-mark" aria-hidden="true"><Bot className="size-6" /></span>
              <h2>从一个问题开始</h2>
              <p>THEIA 会根据你的问题检索本地校园数据，并把可核对的依据带回对话。</p>
              <div className="advisor-v2-suggestions" aria-label="常用问题">
                <button type="button" onClick={() => { setQuestion("结合我的培养方案，下一学期应该优先安排什么课程？"); composerRef.current?.focus(); }}>
                  <span>课程安排</span><span>下一学期怎么选课</span>
                </button>
                <button type="button" onClick={() => { setQuestion("有哪些临近截止的重要事项？"); composerRef.current?.focus(); }}>
                  <span>截止日期</span><span>近期需要处理什么</span>
                </button>
                <button type="button" onClick={() => { setQuestion("帮我核对当前 GPA 和培养方案学分缺口。"); composerRef.current?.focus(); }}>
                  <span>学业进度</span><span>核对 GPA 和学分</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="advisor-v2-error" role="alert">
            <XCircle className="size-4" aria-hidden="true" />
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} title="关闭错误" aria-label="关闭错误"><span aria-hidden="true">×</span></button>
          </div>
        )}

        <AdvisorComposer
          textareaRef={composerRef}
          question={question}
          disabled={composerDisabled}
          disabledReason={composerDisabledReason}
          active={busy}
          canCancel={Boolean(activeRequestRef.current || sendingRequestId || activeThreadRef.current || current?.activeRequestId)}
          status={runStatus}
          streamedCharacterCount={streamProgress.characters}
          streamedChunkCount={streamProgress.chunks}
          budgetLevel={budgetLevel}
          reasoningEffort={reasoningEffort}
          permissionMode={permissionMode}
          temperature={temperature}
          onQuestionChange={setQuestion}
          onSubmit={() => void send()}
          onCancel={() => void cancel()}
          onBudgetChange={(level) => { setBudgetLevel(level); void updateAdvisorConfig("budgetLevel", level); }}
          onReasoningChange={(effort) => { setReasoningEffort(effort); void updateAdvisorConfig("reasoningEffort", effort); }}
          onPermissionChange={(mode) => { setPermissionMode(mode); void updateAdvisorConfig("permissionMode", mode); }}
          onTemperatureChange={(value) => { setTemperature(value); void updateAdvisorConfig("temperature", value); }}
          onClear={() => setQuestion("")}
        />
      </main>
    </section>
  );
}
