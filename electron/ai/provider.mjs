const MODEL_ID_PATTERN = /^[^\u0000-\u001f\u007f]{1,300}$/
const PROMPT_CACHE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

export const ADVISOR_PROVIDER_CAPABILITIES_SCHEMA = 'theia-advisor-provider-capabilities/v1'

function text(value) {
  return String(value ?? '').normalize('NFC').trim()
}

function finiteTokenCount(value) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : null
}

function firstTokenCount(...values) {
  for (const value of values) {
    const count = finiteTokenCount(value)
    if (count !== null) return count
  }
  return null
}

function booleanValue(value) {
  return typeof value === 'boolean' ? value : null
}

/**
 * Normalize usage from Responses, Chat Completions, Anthropic-compatible
 * relays, and common relay aliases without retaining the raw provider body.
 */
export function normalizeProviderUsage(value) {
  const usage = value?.usage && typeof value.usage === 'object'
    ? value.usage
    : value?.response?.usage && typeof value.response.usage === 'object'
      ? value.response.usage
      : value && typeof value === 'object' ? value : {}
  const inputDetails = usage.input_tokens_details && typeof usage.input_tokens_details === 'object'
    ? usage.input_tokens_details
    : {}
  const promptDetails = usage.prompt_tokens_details && typeof usage.prompt_tokens_details === 'object'
    ? usage.prompt_tokens_details
    : {}
  const cachedInputTokens = firstTokenCount(
    inputDetails.cached_tokens,
    promptDetails.cached_tokens,
    usage.cached_tokens,
    usage.cachedTokens,
    usage.cached_input_tokens,
    usage.cachedInputTokens,
    usage.cache_read_input_tokens,
    usage.cacheReadInputTokens,
    usage.prompt_cache_hit_tokens,
    usage.promptCacheHitTokens,
  )
  const cacheWriteInputTokens = firstTokenCount(
    inputDetails.cache_write_tokens,
    inputDetails.cacheWriteTokens,
    inputDetails.cache_creation_input_tokens,
    usage.cache_creation_input_tokens,
    usage.cacheCreationInputTokens,
    usage.cache_write_input_tokens,
    usage.cacheWriteInputTokens,
    usage.cache_write_tokens,
    usage.cacheWriteTokens,
    usage.prompt_cache_write_tokens,
    usage.promptCacheWriteTokens,
  )
  const explicitHit = booleanValue(usage.cache_hit)
    ?? booleanValue(usage.cacheHit)
    ?? booleanValue(usage.prompt_cache_hit)
    ?? booleanValue(usage.promptCacheHit)
  const explicitStatus = text(
    usage.cache_status
      ?? usage.cacheStatus
      ?? usage.prompt_cache_status
      ?? usage.promptCacheStatus,
  ).toLowerCase()
  const cacheStatus = explicitHit !== null
    ? (explicitHit ? 'hit' : 'miss')
    : ['hit', 'miss', 'write', 'written'].includes(explicitStatus)
      ? explicitStatus === 'written' ? 'write' : explicitStatus
      : cachedInputTokens !== null
        ? cachedInputTokens > 0 ? 'hit' : 'miss'
        : cacheWriteInputTokens !== null
          ? 'write'
          : null
  const normalized = {
    inputTokens: firstTokenCount(usage.input_tokens, usage.inputTokens, usage.prompt_tokens, usage.promptTokenCount),
    outputTokens: firstTokenCount(usage.output_tokens, usage.outputTokens, usage.completion_tokens, usage.completionTokens, usage.candidatesTokenCount),
    cachedInputTokens,
    cacheWriteInputTokens,
    cacheStatus,
  }
  return Object.values(normalized).some((entry) => entry !== null && entry !== undefined)
    ? normalized
    : null
}

export function normalizeProviderModelId(value) {
  const normalized = text(value)
  return MODEL_ID_PATTERN.test(normalized) ? normalized : null
}

export function modelForAdvisorIntent(settings) {
  const routing = settings?.modelRouting && typeof settings.modelRouting === 'object'
    ? settings.modelRouting
    : {}
  return normalizeProviderModelId(settings?.modelName)
    || normalizeProviderModelId(routing.advisorDeepModel)
    || normalizeProviderModelId(routing.advisorFastModel)
    || normalizeProviderModelId(routing.courseworkModel)
    || normalizeProviderModelId(routing.fallbackModel)
    || null
}

export function fallbackModelForAdvisor(settings, primaryModel) {
  const routing = settings?.modelRouting && typeof settings.modelRouting === 'object'
    ? settings.modelRouting
    : {}
  const fallback = normalizeProviderModelId(routing.fallbackModel)
  return fallback && fallback !== normalizeProviderModelId(primaryModel) ? fallback : null
}

export function providerCapabilities(settings) {
  const models = [...new Set((Array.isArray(settings?.modelModels) ? settings.modelModels : [])
    .map(normalizeProviderModelId)
    .filter(Boolean))].sort()
  return Object.freeze({
    schema: ADVISOR_PROVIDER_CAPABILITIES_SCHEMA,
    streaming: true,
    jsonSchema: false,
    usage: settings?.modelProvider === 'openai-compatible',
    tools: false,
    models,
  })
}

export function assertProviderGenerateRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Provider request must be an object')
  }
  const allowed = new Set(['model', 'messages', 'responseSchema', 'temperature', 'maxTokens', 'reasoningEffort', 'promptCacheKey', 'timeoutMs'])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`Provider request contains unknown field ${key}`)
  }
  if (!normalizeProviderModelId(value.model)) throw new TypeError('Provider request model is invalid')
  if (!Array.isArray(value.messages) || value.messages.length < 1 || value.messages.length > 32) {
    throw new TypeError('Provider request messages must contain 1 to 32 items')
  }
  let totalCharacters = 0
  for (const message of value.messages) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new TypeError('Provider message is invalid')
    if (!['system', 'user', 'assistant'].includes(message.role)) throw new TypeError('Provider message role is invalid')
    if (typeof message.content !== 'string' || message.content.length > 256_000) throw new TypeError('Provider message content is invalid')
    totalCharacters += message.content.length
  }
  if (totalCharacters > 256_000) throw new TypeError('Provider request context is too large')
  if (!Number.isSafeInteger(value.maxTokens) || value.maxTokens < 1 || value.maxTokens > 8_000) {
    throw new TypeError('Provider maxTokens is outside the supported range')
  }
  if (value.temperature !== undefined && (!Number.isFinite(value.temperature) || value.temperature < 0 || value.temperature > 2)) {
    throw new TypeError('Provider temperature is outside the supported range')
  }
  if (value.reasoningEffort !== undefined && !['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(value.reasoningEffort)) {
    throw new TypeError('Provider reasoning effort is invalid')
  }
  if (value.timeoutMs !== undefined && (!Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 1 || value.timeoutMs > 60 * 60 * 1000)) {
    throw new TypeError('Provider timeoutMs is invalid')
  }
  if (value.promptCacheKey !== undefined && (typeof value.promptCacheKey !== 'string' || !PROMPT_CACHE_KEY_PATTERN.test(value.promptCacheKey))) {
    throw new TypeError('Provider promptCacheKey is invalid')
  }
  return value
}

export class AdvisorProviderError extends Error {
  constructor(code, message, { retryable = false, cause } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'AdvisorProviderError'
    this.code = code
    this.retryable = retryable
  }
}

export function safeProviderError(error) {
  if (error instanceof AdvisorProviderError) return error
  const message = error instanceof Error ? error.message : String(error || '')
  if (/cancel/i.test(message)) return new AdvisorProviderError('cancelled', '顾问请求已取消。', { cause: error })
  if (/timed out|timeout/i.test(message)) return new AdvisorProviderError('timeout', '模型服务响应超时，请稍后重试。', { retryable: true, cause: error })
  const status = Number(message.match(/HTTP\s+(\d{3})/i)?.[1])
  if (status === 429) return new AdvisorProviderError('rate-limited', '模型服务当前请求过多，请稍后重试。', { retryable: true, cause: error })
  if (status >= 500) return new AdvisorProviderError('provider-unavailable', '模型服务暂时不可用，请稍后重试。', { retryable: true, cause: error })
  if (/configure|API key|model service URL|model name/i.test(message)) {
    return new AdvisorProviderError('provider-not-configured', '请先在设置中完成模型服务配置。', { cause: error })
  }
  return new AdvisorProviderError('provider-failed', '模型服务未能完成本次顾问请求。', { cause: error })
}
