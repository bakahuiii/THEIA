import { ChevronDown, LoaderCircle, Send, Settings2, Square, X } from "lucide-react";
import type { RefObject } from "react";
import type { CampusState } from "../../types";

type AdvisorRunStatus = "idle" | "preparing" | "reading" | "streaming" | "stopping";

function nonNegativeCount(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function statusText(status: AdvisorRunStatus, characters: unknown, chunks: unknown) {
  const characterCount = nonNegativeCount(characters);
  const chunkCount = nonNegativeCount(chunks);
  if (status === "preparing") return "正在连接模型";
  if (status === "stopping") return "正在停止生成";
  if (status === "reading") return "正在读取本地数据";
  if (characterCount > 0) return `实时生成中 · ${characterCount.toLocaleString()} 字符`;
  if (status === "streaming" || chunkCount > 0) return "实时生成中";
  return "按 Enter 发送，Shift + Enter 换行";
}

export function AdvisorComposer({
  textareaRef,
  question,
  disabled,
  disabledReason,
  active,
  canCancel,
  status,
  streamedCharacterCount,
  streamedChunkCount,
  budgetLevel,
  reasoningEffort,
  permissionMode,
  temperature,
  onQuestionChange,
  onSubmit,
  onCancel,
  onBudgetChange,
  onReasoningChange,
  onPermissionChange,
  onTemperatureChange,
  onClear,
}: {
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  question: string;
  disabled: boolean;
  disabledReason?: string;
  active: boolean;
  canCancel: boolean;
  status: AdvisorRunStatus;
  streamedCharacterCount: number;
  streamedChunkCount: number;
  budgetLevel: CampusState["settings"]["advisorConfig"]["budgetLevel"];
  reasoningEffort: CampusState["settings"]["advisorConfig"]["reasoningEffort"];
  permissionMode: CampusState["settings"]["advisorConfig"]["permissionMode"];
  temperature: number;
  onQuestionChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onBudgetChange: (level: CampusState["settings"]["advisorConfig"]["budgetLevel"]) => void;
  onReasoningChange: (effort: CampusState["settings"]["advisorConfig"]["reasoningEffort"]) => void;
  onPermissionChange: (mode: CampusState["settings"]["advisorConfig"]["permissionMode"]) => void;
  onTemperatureChange: (temperature: number) => void;
  onClear: () => void;
}) {
  return (
    <div className="advisor-v2-composer-wrap">
      <div className="advisor-v2-composer">
        <div className="advisor-v2-input-row">
          <textarea
            ref={textareaRef}
            value={question}
            onChange={(event) => onQuestionChange(event.target.value.slice(0, 4000))}
            rows={3}
            className="advisor-v2-textarea"
            placeholder="询问你的学业、课程或校园事项"
            disabled={disabled}
            aria-label="输入顾问问题"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && question.trim() && !disabled && !active) {
                event.preventDefault();
                onSubmit();
              }
            }}
          />
          {question && !active && (
            <button type="button" className="advisor-v2-clear" onClick={onClear} disabled={disabled} title="清空问题" aria-label="清空问题">
              <X className="size-4" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className={`advisor-v2-send${active ? " is-stop" : ""}`}
            onClick={active ? onCancel : onSubmit}
            disabled={active ? !canCancel || status === "stopping" : disabled || !question.trim()}
            title={active ? "停止生成" : "发送消息"}
            aria-label={active ? "停止生成" : "发送消息"}
          >
            {active ? <Square className="size-4" fill="currentColor" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
          </button>
        </div>
        <div className="advisor-v2-composer-toolbar">
          <span className={`advisor-v2-composer-status${active ? " is-active" : ""}${disabledReason ? " is-disabled" : ""}`} role={active || disabledReason ? "status" : undefined}>
            {active && <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />}
            <span>{disabledReason || statusText(status, streamedCharacterCount, streamedChunkCount)}</span>
          </span>
          <span className="advisor-v2-char-count">{question.length.toLocaleString()} / 4,000</span>
          <details className="advisor-v2-settings">
            <summary title="模型设置">
              <Settings2 className="size-3.5" aria-hidden="true" />
              <span>模型设置</span>
              <ChevronDown className="size-3.5" aria-hidden="true" />
            </summary>
            <div className="advisor-v2-settings-panel">
              <label>
                <span>推理档位</span>
                <select value={budgetLevel} onChange={(event) => onBudgetChange(event.target.value as typeof budgetLevel)} disabled={disabled || active}>
                  <option value="high">High · 快速</option>
                  <option value="xhigh">XHigh · 深度</option>
                  <option value="max">Max · 最大</option>
                  <option value="ultra">Ultra · 多智能体</option>
                </select>
              </label>
              <label>
                <span>推理力度</span>
                <select value={reasoningEffort} onChange={(event) => onReasoningChange(event.target.value as typeof reasoningEffort)} disabled={disabled || active}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
              <label>
                <span>Agent 权限</span>
                <select value={permissionMode} onChange={(event) => onPermissionChange(event.target.value as typeof permissionMode)} disabled={disabled || active}>
                  <option value="read-only">只读（受控）</option>
                  <option value="full-access">完全访问</option>
                </select>
              </label>
              <label className="advisor-v2-temperature">
                <span>温度 <strong>{temperature.toFixed(1)}</strong></span>
                <input type="range" min="0" max="2" step="0.1" value={temperature} onChange={(event) => onTemperatureChange(Number(event.target.value))} disabled={disabled || active} />
              </label>
            </div>
          </details>
        </div>
      </div>
      <p className="advisor-v2-composer-note">{permissionMode === "full-access"
        ? "完全访问已启用：Agent 可读写文件、执行命令并调用网页工具。"
        : "只读（受控）模式：保留校园资料与既有受控操作，不授予通用文件、命令或网页访问。"}</p>
    </div>
  );
}
