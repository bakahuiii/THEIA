import { Bot, Clock3, Coins, UserRound, Zap } from "lucide-react";
import type { AdvisorAnswer, AdvisorThreadMessage } from "../../types";
import { formatClock } from "../../ui/app-shared";
import { AdvisorMarkdown } from "./AdvisorMarkdown";

function formatMessageTime(isoString: string) {
  return formatClock(isoString);
}

type CacheStatus = AdvisorAnswer["usage"]["cacheStatus"];

function finiteTokenCount(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeCacheStatus(value: unknown): CacheStatus {
  return value === "hit" || value === "miss" || value === "write" ? value : "unknown";
}

function cacheStatusLabel(status: CacheStatus) {
  if (status === "hit") return "缓存命中";
  if (status === "write") return "缓存写入";
  if (status === "miss") return "缓存未命中";
  return "";
}

function cacheUsageLabel(usage: AdvisorAnswer["usage"]) {
  const parts = [];
  const status = normalizeCacheStatus(usage.cacheStatus);
  const cachedInputTokens = finiteTokenCount(usage.cachedInputTokens);
  const cacheWriteInputTokens = finiteTokenCount(usage.cacheWriteInputTokens);
  if (status !== "unknown") parts.push(cacheStatusLabel(status));
  if (cachedInputTokens !== null) {
    parts.push(`读取 ${cachedInputTokens.toLocaleString()} tokens`);
  }
  if (cacheWriteInputTokens !== null) {
    parts.push(`写入 ${cacheWriteInputTokens.toLocaleString()} tokens`);
  }
  return parts.join(" · ");
}

function visibleAnswerText(value: string | undefined) {
  const raw = String(value || "");
  const candidate = raw.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  try {
    const parsed = JSON.parse(candidate);
    if (parsed?.schema === "theia-advisor-tool-call/v1") {
      return "本次请求正在读取本地信息，但没有生成可展示的回答，请重试。";
    }
  } catch {
    // Ordinary model prose is not JSON and should remain unchanged.
  }
  return raw;
}

export function AdvisorMessage({ message }: { message: AdvisorThreadMessage }) {
  if (message.role === "user") {
    return (
      <article className="advisor-v2-message is-user">
        <div className="advisor-v2-message-body is-user">
          <span className="advisor-v2-speaker">你</span>
          <p className="advisor-v2-message-text">{message.text}</p>
          <div className="advisor-v2-message-meta">
            <Clock3 className="size-3" aria-hidden="true" />
            <span>{formatMessageTime(message.at)}</span>
          </div>
        </div>
        <span className="advisor-v2-message-avatar is-user" aria-hidden="true"><UserRound className="size-4" /></span>
      </article>
    );
  }

  const answer = message.response;
  const usage = answer?.usage;
  const visibleText = visibleAnswerText(answer?.displayText || answer?.rawText);
  const inputTokens = finiteTokenCount(usage?.inputTokens);
  const outputTokens = finiteTokenCount(usage?.outputTokens);
  const cachedInputTokens = finiteTokenCount(usage?.cachedInputTokens);
  const cacheWriteInputTokens = finiteTokenCount(usage?.cacheWriteInputTokens);
  const cacheStatus = normalizeCacheStatus(usage?.cacheStatus);
  const hasCacheUsage = cacheStatus !== "unknown" || cachedInputTokens !== null || cacheWriteInputTokens !== null;
  const showTokenUsage = (inputTokens !== null && inputTokens > 0) || (outputTokens !== null && outputTokens > 0);
  return (
    <article className="advisor-v2-message is-assistant">
      <span className="advisor-v2-message-avatar is-assistant" aria-hidden="true"><Bot className="size-4" /></span>
      <div className="advisor-v2-message-body">
        <span className="advisor-v2-speaker">THEIA Agent</span>
        <AdvisorMarkdown source={visibleText} />
        <div className="advisor-v2-message-meta">
          <Clock3 className="size-3" aria-hidden="true" />
          <span>{formatMessageTime(message.at)}</span>
          {usage && showTokenUsage && (
            <>
              <span aria-hidden="true">·</span>
              <Coins className="size-3" aria-hidden="true" />
              <span>
                {inputTokens !== null && inputTokens > 0 ? `输入 ${inputTokens.toLocaleString()} · ` : ""}
                {outputTokens !== null ? `输出 ${outputTokens.toLocaleString()} tokens${usage.estimated ? " · 估算" : ""}` : ""}
              </span>
            </>
          )}
          {usage && hasCacheUsage && (
            <>
              <span aria-hidden="true">·</span>
              <Zap className="size-3" aria-hidden="true" />
              <span>{cacheUsageLabel(usage)}</span>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
