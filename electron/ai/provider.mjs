const MODEL_ID_PATTERN = /^[^\u0000-\u001f\u007f]{1,300}$/

export const ADVISOR_PROVIDER_CAPABILITIES_SCHEMA = 'theia-advisor-provider-capabilities/v1'

function text(value) {
  return String(value ?? '').normalize('NFC').trim()
}

export function normalizeProviderModelId(value) {
  const normalized = text(value)
  return MODEL_ID_PATTERN.test(normalized) ? normalized : null
}

export function modelForAdvisorIntent(settings, intent) {
  const routing = settings?.modelRouting && typeof settings.modelRouting === 'object'
    ? settings.modelRouting
    : {}
  const fallback = normalizeProviderModelId(routing.fallbackModel)
    || normalizeProviderModelId(settings?.modelName)
  const fast = normalizeProviderModelId(routing.advisorFastModel) || fallback
  const deep = normalizeProviderModelId(routing.advisorDeepModel) || fast || fallback
  const coursework = normalizeProviderModelId(routing.courseworkModel) || fallback
  if (intent === 'assignment') return coursework
  if (['risk', 'mail', 'general'].includes(intent)) return deep
  return fast
}

export function providerCapabilities(settings) {
  const models = [...new Set((Array.isArray(settings?.modelModels) ? settings.modelModels : [])
    .map(normalizeProviderModelId)
    .filter(Boolean))].sort()
  return Object.freeze({
    schema: ADVISOR_PROVIDER_CAPABILITIES_SCHEMA,
    streaming: false,
    jsonSchema: false,
    usage: false,
    tools: false,
    models,
  })
}

export function assertProviderGenerateRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Provider request must be an object')
  }
  const allowed = new Set(['model', 'messages', 'responseSchema', 'temperature', 'maxTokens'])
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
