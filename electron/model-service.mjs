import { readFile } from 'node:fs/promises'
import { fetch as undiciFetch } from 'undici'
import { normalizeAnswerKey } from '../core/parsers/theol-work.mjs'
import { isLiteralLoopbackModelService, modelServiceIdentity, normalizeModelServiceBaseUrl } from '../core/model-url-policy.mjs'
import { normalizeModelProvider } from '../core/model-provider-policy.mjs'
import { normalizeProviderUsage } from './ai/provider.mjs'
import { prepareModelEndpoint } from './model-network-policy.mjs'

const MAX_CONTEXT_CHARS = 48_000
const MODEL_DISCOVERY_TIMEOUT_MS = 15_000
export const DEFAULT_MODEL_REQUEST_TIMEOUT_MS = 5 * 60 * 1000
export const MAX_MODEL_REQUEST_TIMEOUT_MS = 60 * 60 * 1000
export const MAX_MODEL_REQUEST_BYTES = 2 * 1024 * 1024
export const MAX_MODEL_LIST_RESPONSE_BYTES = 2 * 1024 * 1024
export const MAX_MODEL_COMPLETION_RESPONSE_BYTES = 8 * 1024 * 1024

function normalizeModelRequestTimeout(value) {
  if (value === undefined) return DEFAULT_MODEL_REQUEST_TIMEOUT_MS
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Model request timeout is invalid')
  return Math.min(value, MAX_MODEL_REQUEST_TIMEOUT_MS)
}

function modelRequestTimeoutLabel(value) {
  return value % 1000 === 0 ? `${value / 1000} seconds` : `${value} milliseconds`
}

function completionResponseByteLimit(value) {
  if (value === undefined) return MAX_MODEL_COMPLETION_RESPONSE_BYTES
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Model completion response byte limit is invalid')
  return Math.min(value, MAX_MODEL_COMPLETION_RESPONSE_BYTES)
}

function contentLength(response) {
  const raw = response?.headers?.get?.('content-length')
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export async function readBoundedResponseText(response, maximumBytes, label = 'Model response') {
  const declared = contentLength(response)
  if (declared !== null && declared > maximumBytes) {
    response?.body?.cancel?.().catch?.(() => {})
    throw new Error(`${label} exceeds the ${maximumBytes}-byte limit`)
  }

  const reader = response?.body?.getReader?.()
  if (!reader) {
    const body = await response.text()
    if (Buffer.byteLength(body, 'utf8') > maximumBytes) throw new Error(`${label} exceeds the ${maximumBytes}-byte limit`)
    return body
  }

  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!(value instanceof Uint8Array)) throw new Error(`${label} returned an invalid byte stream`)
      total += value.byteLength
      if (total > maximumBytes) {
        await reader.cancel().catch(() => {})
        throw new Error(`${label} exceeds the ${maximumBytes}-byte limit`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock?.()
  }
  const combined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(combined)
}

function boundedHttpErrorDetail(body) {
  const raw = String(body || '').trim()
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw)
    const error = parsed?.error && typeof parsed.error === 'object' ? parsed.error : parsed
    const message = [error?.message, error?.code, error?.type]
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim())
      .join(' — ')
    if (message) return message.slice(0, 600)
  } catch { /* Keep a bounded plain-text provider error below. */ }
  return raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').slice(0, 600)
}

function modelHttpError(status, body, label = 'Model service') {
  const detail = boundedHttpErrorDetail(body)
  return new Error(`${label} returned HTTP ${status}${detail ? `: ${detail}` : ''}`)
}

function streamEvents(chunk, pending) {
  const lines = `${pending}${chunk}`.split(/\r?\n/)
  const remainder = lines.pop() || ''
  const events = []
  for (const line of lines) {
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (data) events.push(data)
  }
  return { events, remainder }
}

function responseMetadata(payload) {
  const usage = normalizeProviderUsage(payload)
  const requestId = typeof payload?.response?.id === 'string'
    ? payload.response.id
    : typeof payload?.id === 'string' ? payload.id : null
  return usage || requestId ? { usage, requestId } : null
}

function streamEventFailure(payload) {
  const type = String(payload?.type || '').toLowerCase()
  const status = String(payload?.response?.status || payload?.status || '').toLowerCase()
  if (!['error', 'response.failed', 'response.incomplete'].includes(type)
    && !['failed', 'incomplete'].includes(status)
    && !(payload?.error && !payload?.delta)) return null
  const detail = boundedHttpErrorDetail(payload?.error || payload?.response?.status_details || payload)
  const label = type === 'response.incomplete' || status === 'incomplete' ? 'incomplete' : type === 'response.failed' || status === 'failed' ? 'failed' : 'error'
  return new Error(`Model stream returned ${label}${detail ? `: ${detail}` : ''}`)
}

export async function readBoundedEventStream(response, maximumBytes, {
  extractDelta,
  onDelta = () => {},
  onMetadata = () => {},
} = {}) {
  if (typeof extractDelta !== 'function') throw new TypeError('Model event-stream parser is required')
  const declared = contentLength(response)
  if (declared !== null && declared > maximumBytes) {
    response?.body?.cancel?.().catch?.(() => {})
    throw new Error(`Model stream exceeds the ${maximumBytes}-byte limit`)
  }
  const reader = response?.body?.getReader?.()
  if (!reader) throw new Error('Model stream did not return a readable byte stream')
  const decoder = new TextDecoder()
  let bytes = 0
  let pending = ''
  let text = ''
  let completed = false
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!(value instanceof Uint8Array)) throw new Error('Model stream returned an invalid byte stream')
      bytes += value.byteLength
      if (bytes > maximumBytes) {
        await reader.cancel().catch(() => {})
        throw new Error(`Model stream exceeds the ${maximumBytes}-byte limit`)
      }
      const parsed = streamEvents(decoder.decode(value, { stream: true }), pending)
      pending = parsed.remainder
      for (const event of parsed.events) {
        if (event === '[DONE]') continue
        let payload
        try { payload = JSON.parse(event) } catch { throw new Error('Model stream returned invalid JSON') }
        const metadata = responseMetadata(payload)
        if (metadata) onMetadata(metadata)
        const failure = streamEventFailure(payload)
        if (failure) throw failure
        const delta = streamDeltaContent(extractDelta(payload))
        if (!delta) continue
        text += delta
        onDelta(delta)
      }
    }
    const tail = streamEvents(`${decoder.decode()}\n`, pending)
    for (const event of tail.events) {
      if (event === '[DONE]') continue
      let payload
      try { payload = JSON.parse(event) } catch { throw new Error('Model stream returned invalid JSON') }
      const metadata = responseMetadata(payload)
      if (metadata) onMetadata(metadata)
      const failure = streamEventFailure(payload)
      if (failure) throw failure
      const delta = streamDeltaContent(extractDelta(payload))
      if (delta) { text += delta; onDelta(delta) }
    }
    completed = true
  } finally {
    if (!completed) await reader.cancel().catch(() => {})
    reader.releaseLock?.()
  }
  if (!text) throw new Error('Model stream returned no answer content')
  return text
}

export async function readBoundedNdjson(response, maximumBytes, {
  extractDelta,
  onDelta = () => {},
  onMetadata = () => {},
} = {}) {
  if (typeof extractDelta !== 'function') throw new TypeError('Model NDJSON parser is required')
  const declared = contentLength(response)
  if (declared !== null && declared > maximumBytes) {
    response?.body?.cancel?.().catch?.(() => {})
    throw new Error(`Model stream exceeds the ${maximumBytes}-byte limit`)
  }
  const reader = response?.body?.getReader?.()
  if (!reader) throw new Error('Model stream did not return a readable byte stream')
  const decoder = new TextDecoder()
  let bytes = 0
  let pending = ''
  let text = ''
  let completed = false
  const consume = (line) => {
    if (!line.trim()) return
    let payload
    try { payload = JSON.parse(line) } catch { throw new Error('Model stream returned invalid JSON') }
    const metadata = responseMetadata(payload)
    if (metadata) onMetadata(metadata)
    const failure = streamEventFailure(payload)
    if (failure) throw failure
    const delta = streamDeltaContent(extractDelta(payload))
    if (delta) { text += delta; onDelta(delta) }
  }
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!(value instanceof Uint8Array)) throw new Error('Model stream returned an invalid byte stream')
      bytes += value.byteLength
      if (bytes > maximumBytes) { await reader.cancel().catch(() => {}); throw new Error(`Model stream exceeds the ${maximumBytes}-byte limit`) }
      const lines = `${pending}${decoder.decode(value, { stream: true })}`.split(/\r?\n/)
      pending = lines.pop() || ''
      for (const line of lines) consume(line)
    }
    consume(`${pending}${decoder.decode()}`)
    completed = true
  } finally {
    if (!completed) await reader.cancel().catch(() => {})
    reader.releaseLock?.()
  }
  if (!text) throw new Error('Model stream returned no answer content')
  return text
}

function listedModels(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter((item) => item && item.length <= 300))]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 300)
}

export function preferredModel(models, requested = '') {
  const normalized = listedModels(models)
  const explicit = String(requested || '').trim()
  if (explicit) return explicit
  for (const candidate of ['gpt-5-mini', 'gpt-4.1-mini', 'gpt-4o-mini', 'deepseek-chat']) {
    if (normalized.includes(candidate)) return candidate
  }
  return normalized.find((model) => !/(embedding|audio|transcri|tts|image|moderation|realtime)/i.test(model)) || normalized[0] || ''
}

function textContent(content) {
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) return content.map((part) => typeof part?.text === 'string' ? part.text : '').join('').trim()
  return ''
}

function streamDeltaContent(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((part) => typeof part?.text === 'string' ? part.text : '').join('')
  return ''
}

function responsesUrl(baseUrl) {
  const url = new URL(normalizeModelServiceBaseUrl(baseUrl))
  const pathname = url.pathname.replace(/\/+$/, '')
  url.pathname = pathname.endsWith('/responses')
    ? pathname
    : pathname.endsWith('/v1')
      ? `${pathname}/responses`
      : `${pathname}/v1/responses`
  url.search = ''
  url.hash = ''
  return url.toString()
}

function modelsUrl(baseUrl) {
  const url = new URL(normalizeModelServiceBaseUrl(baseUrl))
  let pathname = url.pathname.replace(/\/+$/, '')
  if (pathname.endsWith('/responses')) pathname = pathname.slice(0, -'/responses'.length)
  if (!pathname.endsWith('/models')) pathname = pathname.endsWith('/v1') ? `${pathname}/models` : `${pathname}/v1/models`
  url.pathname = pathname
  url.search = ''
  url.hash = ''
  return url.toString()
}

function isPromptCacheUnsupportedResponse(status, body) {
  if (![400, 422].includes(Number(status))) return false
  const message = String(body || '').toLowerCase()
  if (!/prompt[ _-]?cache/.test(message)) return false
  return /(not supported|unsupported|does not support|unknown|unrecognized|unrecognised|invalid|not permitted|extra inputs?)/.test(message)
}

function isExplicitPromptCacheUnsupportedResponse(body) {
  const message = String(body || '').toLowerCase()
  return /prompt[ _-]?cache[ _-]?(breakpoint|options)|cache breakpoint|explicit prompt cache/.test(message)
}

function supportsExplicitPromptCaching(model) {
  const match = /^gpt-(\d+)(?:\.(\d+))?/i.exec(String(model || '').trim())
  if (!match) return false
  const major = Number(match[1])
  const minor = Number(match[2] || 0)
  return major > 5 || (major === 5 && minor >= 6)
}

function responsesRequest(model, messages, maxTokens, streaming, reasoningEffort, promptCacheKey, explicitCaching = supportsExplicitPromptCaching(model)) {
  const normalized = Array.isArray(messages) ? messages : []
  const useExplicitCaching = Boolean(promptCacheKey)
    && explicitCaching
    && normalized.some((message) => message?.role === 'system')
  let breakpointSet = false
  const input = normalized.map((message) => {
    const role = message?.role === 'assistant' ? 'assistant' : message?.role === 'system' ? 'system' : 'user'
    const content = {
      type: role === 'assistant' ? 'output_text' : 'input_text',
      text: String(message?.content || ''),
    }
    if (useExplicitCaching && !breakpointSet && role === 'system') {
      content.prompt_cache_breakpoint = { mode: 'explicit' }
      breakpointSet = true
    }
    return { role, content: [content] }
  })
  return {
    model,
    input,
    max_output_tokens: maxTokens,
    ...(reasoningEffort && reasoningEffort !== 'none' ? { reasoning: { effort: reasoningEffort } } : {}),
    ...(promptCacheKey ? { prompt_cache_key: promptCacheKey } : {}),
    ...(useExplicitCaching ? { prompt_cache_options: { mode: 'explicit' } } : {}),
    stream: streaming,
  }
}

function responsesText(payload) {
  const direct = textContent(payload?.output_text)
  if (direct) return direct
  const content = (Array.isArray(payload?.output) ? payload.output : [])
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
  return textContent(content)
}

function responsesDelta(payload) {
  if (payload?.type && payload.type !== 'response.output_text.delta') return ''
  return typeof payload?.delta === 'string' ? payload.delta : ''
}

function protocolPath(pathname, suffix, { aliases = [] } = {}) {
  const base = pathname.replace(/\/+$/, '') || ''
  if (aliases.some((alias) => base.endsWith(alias))) return base
  return `${base}/${suffix}`.replace(/^\/\/+/, '/')
}

export function protocolUrl(protocol, baseUrl, model, streaming = false) {
  const url = new URL(normalizeModelServiceBaseUrl(baseUrl))
  const pathname = url.pathname.replace(/\/+$/, '')
  if (protocol === 'anthropic-messages') {
    url.pathname = pathname.endsWith('/v1/messages')
      ? pathname
      : pathname.endsWith('/v1')
        ? `${pathname}/messages`
        : protocolPath(pathname, 'v1/messages')
  } else if (protocol === 'gemini-generate-content') {
    const prefix = protocolPath(pathname, 'v1beta', { aliases: ['/v1beta'] })
    url.pathname = `${prefix}/models/${encodeURIComponent(model)}:${streaming ? 'streamGenerateContent' : 'generateContent'}`
    if (streaming) url.search = 'alt=sse'
  } else if (protocol === 'ollama-chat') {
    url.pathname = pathname.endsWith('/api/chat')
      ? pathname
      : pathname.endsWith('/api')
        ? `${pathname}/chat`
        : protocolPath(pathname, 'api/chat')
  } else {
    throw new Error('Unsupported model provider protocol')
  }
  url.hash = ''
  return url.toString()
}

function providerMessages(messages, protocol) {
  const normalized = Array.isArray(messages) ? messages : []
  const system = normalized.filter((message) => message?.role === 'system').map((message) => String(message.content || '')).filter(Boolean)
  const turnMessages = normalized.filter((message) => message?.role !== 'system')
  if (protocol === 'anthropic-messages') {
    return {
      system: system.join('\n\n') || undefined,
      messages: turnMessages.map((message) => ({ role: message.role === 'assistant' ? 'assistant' : 'user', content: String(message.content || '') })),
    }
  }
  if (protocol === 'gemini-generate-content') {
    return {
      ...(system.length ? { systemInstruction: { parts: [{ text: system.join('\n\n') }] } } : {}),
      contents: turnMessages.map((message) => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(message.content || '') }] })),
    }
  }
  return { messages: normalized.map((message) => ({ role: message.role, content: String(message.content || '') })) }
}

export function protocolRequest(protocol, apiKey, model, messages, temperature, maxTokens, streaming) {
  const projected = providerMessages(messages, protocol)
  if (protocol === 'anthropic-messages') {
    return {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: { model, max_tokens: maxTokens, temperature, stream: streaming, ...projected },
    }
  }
  if (protocol === 'gemini-generate-content') {
    return {
      headers: { 'x-goog-api-key': apiKey },
      body: { ...projected, generationConfig: { temperature, maxOutputTokens: maxTokens } },
    }
  }
  if (protocol === 'ollama-chat') {
    return {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      body: { model, stream: streaming, options: { temperature, num_predict: maxTokens }, ...projected },
    }
  }
  throw new Error('Unsupported model provider protocol')
}

export function protocolText(protocol, payload) {
  if (protocol === 'anthropic-messages') return textContent(payload?.content)
  if (protocol === 'gemini-generate-content') return textContent(payload?.candidates?.[0]?.content?.parts)
  if (protocol === 'ollama-chat') return textContent(payload?.message?.content)
  return ''
}

export function protocolDelta(protocol, payload) {
  if (protocol === 'anthropic-messages') return payload?.delta?.text || payload?.content_block?.text || ''
  if (protocol === 'gemini-generate-content') return payload?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('') || ''
  if (protocol === 'ollama-chat') return payload?.message?.content || ''
  return ''
}

function extractJson(text) {
  const trimmed = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try { return JSON.parse(trimmed.slice(start, end + 1)) } catch { /* The caller receives a clear format error below. */ }
    }
    throw new Error('The model did not return valid answer JSON')
  }
}

function contextualTask(manifest) {
  const page = manifest?.page || {}
  // Include extracted attachment text so the model can read assignment PDFs/docs
  const attachmentSections = []
  for (const item of (manifest?.attachmentExtractions || [])) {
    if (!item.extracted) continue
    // Re-read text from task.md is not available here; instead store a reference
    // The full text is in task.md — we embed the summary in the context JSON.
    attachmentSections.push({ filename: item.filename, format: item.format })
  }
  return JSON.stringify({
    assignment: manifest?.assignment || {},
    instructions: page.instructions || '',
    questions: Array.isArray(page.questions) ? page.questions : [],
    attachmentFiles: attachmentSections,
  }, null, 2).slice(0, MAX_CONTEXT_CHARS)
}

/**
 * Reads extracted attachment text from task.md and includes it in the prompt.
 * Returns a string to append to the system/user message.
 */
async function attachmentContext(workspace) {
  if (!workspace?.taskPath) return ''
  try {
    const task = await readFile(workspace.taskPath, 'utf8')
    const start = task.indexOf('## 附件内容（文本提取）')
    if (start < 0) return ''
    const section = task.slice(start, start + 24_000)
    return `\n\n以下是作业附件中提取的文本内容，请仔细阅读后再解答：\n\n${section}`
  } catch {
    return ''
  }
}

export class ModelService {
  constructor({ vault, courseWork, fetchFn = undiciFetch, resolver, dispatcherFactory }) {
    this.vault = vault
    this.courseWork = courseWork
    this.fetchFn = fetchFn
    this.resolver = resolver
    this.dispatcherFactory = dispatcherFactory
    this.activeControllers = new Set()
    // Model names are not a reliable capability signal for OpenAI-compatible
    // services. Remember an explicit server rejection so later requests do
    // not pay for a predictable failed cache-enabled attempt.
    this.unsupportedPromptCacheModels = new Set()
    this.unsupportedExplicitPromptCacheModels = new Set()
  }

  promptCacheKeyFor(baseUrl, model, requestedKey) {
    if (!requestedKey) return undefined
    const identity = `${modelServiceIdentity(baseUrl)}\u0000${model}`
    return this.unsupportedPromptCacheModels.has(identity) ? undefined : requestedKey
  }

  disablePromptCache(baseUrl, model) {
    this.unsupportedPromptCacheModels.add(`${modelServiceIdentity(baseUrl)}\u0000${model}`)
  }

  explicitPromptCacheFor(baseUrl, model, requestedKey) {
    if (!requestedKey || !supportsExplicitPromptCaching(model)) return false
    return !this.unsupportedExplicitPromptCacheModels.has(`${modelServiceIdentity(baseUrl)}\u0000${model}`)
  }

  disableExplicitPromptCache(baseUrl, model) {
    this.unsupportedExplicitPromptCacheModels.add(`${modelServiceIdentity(baseUrl)}\u0000${model}`)
  }

  prepareEndpoint(url, signal) {
    return prepareModelEndpoint(url, {
      ...(this.resolver ? { resolver: this.resolver } : {}),
      ...(this.dispatcherFactory ? { dispatcherFactory: this.dispatcherFactory } : {}),
      signal,
    })
  }

  requestController(signal) {
    const controller = new AbortController()
    const cancel = () => controller.abort(signal?.reason)
    if (signal?.aborted) cancel()
    else signal?.addEventListener?.('abort', cancel, { once: true })
    this.activeControllers.add(controller)
    return {
      controller,
      release: () => {
        signal?.removeEventListener?.('abort', cancel)
        this.activeControllers.delete(controller)
      },
    }
  }

  cancelAll(reason = new Error('Model requests were cancelled')) {
    const cancelled = this.activeControllers.size
    for (const controller of this.activeControllers) controller.abort(reason)
    this.activeControllers.clear()
    return cancelled
  }

  async status(settings) {
    const vault = await this.vault.status()
    let baseUrl = ''
    let serviceIdentity = null
    try {
      baseUrl = normalizeModelServiceBaseUrl(settings?.modelBaseUrl)
      serviceIdentity = modelServiceIdentity(baseUrl)
    } catch { /* An invalid legacy URL is treated as unconfigured. */ }
    const model = String(settings?.modelName || '').trim()
    const provider = normalizeModelProvider(settings?.modelProvider)
    const keylessOllama = normalizeModelProvider(settings?.modelProvider) === 'ollama-chat'
      && isLiteralLoopbackModelService(baseUrl)
    const apiKeySaved = keylessOllama || Boolean(vault.saved && vault.bound && vault.serviceIdentity === serviceIdentity)
    return {
      configured: Boolean(baseUrl && model && apiKeySaved),
      baseUrl,
      provider,
      model,
      apiKeySaved,
      keylessOllama,
      encryptionAvailable: vault.encryptionAvailable,
      updatedAt: vault.updatedAt,
      error: vault.error,
      requiresApiKeyReentry: Boolean(vault.saved && !apiKeySaved),
      models: listedModels(settings?.modelModels),
      modelRouting: {
        advisorFastModel: String(settings?.modelRouting?.advisorFastModel || '').trim() || null,
        advisorDeepModel: String(settings?.modelRouting?.advisorDeepModel || '').trim() || null,
        courseworkModel: String(settings?.modelRouting?.courseworkModel || '').trim() || null,
        fallbackModel: String(settings?.modelRouting?.fallbackModel || '').trim() || null,
      },
      advisorConfig: settings?.advisorConfig && typeof settings.advisorConfig === 'object'
        ? structuredClone(settings.advisorConfig)
        : null,
    }
  }

  async request(settings, messages, {
    temperature = 0.2,
    maxTokens = 3_500,
    reasoningEffort,
    promptCacheKey,
    maxResponseBytes,
    timeoutMs,
    signal,
    onMetadata,
  } = {}) {
    if (normalizeModelProvider(settings?.modelProvider) !== 'openai-compatible') {
      return this.requestProtocol(settings, normalizeModelProvider(settings?.modelProvider), messages, {
        temperature, maxTokens, maxResponseBytes, timeoutMs, signal, onMetadata,
      })
    }
    const baseUrl = normalizeModelServiceBaseUrl(settings?.modelBaseUrl)
    const model = String(settings?.modelName || '').trim()
    if (!baseUrl || !model) throw new Error('Configure the model service URL and model name first')
    const apiKey = await this.vault.readApiKey(baseUrl)
    if (!apiKey) throw new Error('Save a model API key before processing a task')

    const { controller, release } = this.requestController(signal)
    const requestTimeout = normalizeModelRequestTimeout(timeoutMs)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, requestTimeout)
    try {
      const requestJson = async (targetUrl, requestBody, extractText) => {
        if (Buffer.byteLength(requestBody, 'utf8') > MAX_MODEL_REQUEST_BYTES) throw new Error(`Model request exceeds the ${MAX_MODEL_REQUEST_BYTES}-byte limit`)
        const endpoint = await this.prepareEndpoint(targetUrl, controller.signal)
        try {
          const response = await this.fetchFn(targetUrl, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
            body: requestBody,
            redirect: 'error',
            signal: controller.signal,
            dispatcher: endpoint.dispatcher,
          })
          const body = await readBoundedResponseText(
            response,
            completionResponseByteLimit(maxResponseBytes),
            'Model completion response',
          )
          return { response, body, extractText }
        } finally {
          await endpoint.close({ force: controller.signal.aborted }).catch(() => {})
        }
      }

      const targetUrl = responsesUrl(baseUrl)
      const effectivePromptCacheKey = this.promptCacheKeyFor(baseUrl, model, promptCacheKey)
      const explicitPromptCache = this.explicitPromptCacheFor(baseUrl, model, effectivePromptCacheKey)
      let result = await requestJson(
        targetUrl,
        JSON.stringify(responsesRequest(model, messages, maxTokens, false, reasoningEffort, effectivePromptCacheKey, explicitPromptCache)),
        responsesText,
      )
      if (!result.response.ok && effectivePromptCacheKey
        && isPromptCacheUnsupportedResponse(result.response.status, result.body)
        && !controller.signal.aborted) {
        if (explicitPromptCache && isExplicitPromptCacheUnsupportedResponse(result.body)) {
          this.disableExplicitPromptCache(baseUrl, model)
          result = await requestJson(
            targetUrl,
            JSON.stringify(responsesRequest(model, messages, maxTokens, false, reasoningEffort, effectivePromptCacheKey, false)),
            responsesText,
          )
        }
        if (!result.response.ok) {
          this.disablePromptCache(baseUrl, model)
          result = await requestJson(
            targetUrl,
            JSON.stringify(responsesRequest(model, messages, maxTokens, false, reasoningEffort, undefined, false)),
            responsesText,
          )
        }
      }
      if (!result.response.ok) throw modelHttpError(result.response.status, result.body)
      let payload
      try { payload = JSON.parse(result.body) } catch { throw new Error('Model service returned invalid JSON') }
      const metadata = responseMetadata(payload)
      if (metadata) onMetadata?.(metadata)
      const failure = streamEventFailure(payload)
      if (failure) throw failure
      const content = result.extractText(payload)
      if (!content) throw new Error('Model service returned no answer content')
      return content
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') {
        if (timedOut) throw new Error(`Model request timed out after ${modelRequestTimeoutLabel(requestTimeout)}`)
        throw new Error('Model request was cancelled')
      }
      throw error
    } finally {
      clearTimeout(timer)
      release()
    }
  }

  async requestStream(settings, messages, {
    temperature = 0.2,
    maxTokens = 3_500,
    reasoningEffort,
    promptCacheKey,
    maxResponseBytes,
    timeoutMs,
    signal,
    onDelta,
    onMetadata,
  } = {}) {
    if (normalizeModelProvider(settings?.modelProvider) !== 'openai-compatible') {
      return this.requestProtocolStream(settings, normalizeModelProvider(settings?.modelProvider), messages, {
        temperature, maxTokens, maxResponseBytes, timeoutMs, signal, onDelta, onMetadata,
      })
    }
    const baseUrl = normalizeModelServiceBaseUrl(settings?.modelBaseUrl)
    const model = String(settings?.modelName || '').trim()
    if (!baseUrl || !model) throw new Error('Configure the model service URL and model name first')
    const apiKey = await this.vault.readApiKey(baseUrl)
    if (!apiKey) throw new Error('Save a model API key before processing a task')
    const { controller, release } = this.requestController(signal)
    const requestTimeout = normalizeModelRequestTimeout(timeoutMs)
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, requestTimeout)
    try {
      const requestSse = async (targetUrl, requestBody, extractDelta) => {
        if (Buffer.byteLength(requestBody, 'utf8') > MAX_MODEL_REQUEST_BYTES) throw new Error(`Model request exceeds the ${MAX_MODEL_REQUEST_BYTES}-byte limit`)
        const endpoint = await this.prepareEndpoint(targetUrl, controller.signal)
        try {
          const response = await this.fetchFn(targetUrl, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
            body: requestBody,
            redirect: 'error', signal: controller.signal, dispatcher: endpoint.dispatcher,
          })
          if (!response.ok) {
            const body = await readBoundedResponseText(response, completionResponseByteLimit(maxResponseBytes), 'Model stream error response')
            return { response, body }
          }
          return {
            response,
            content: await readBoundedEventStream(
              response,
              completionResponseByteLimit(maxResponseBytes),
              { extractDelta, onDelta, onMetadata },
            ),
          }
        } finally {
          await endpoint.close({ force: controller.signal.aborted }).catch(() => {})
        }
      }

      const targetUrl = responsesUrl(baseUrl)
      const effectivePromptCacheKey = this.promptCacheKeyFor(baseUrl, model, promptCacheKey)
      const explicitPromptCache = this.explicitPromptCacheFor(baseUrl, model, effectivePromptCacheKey)
      let result = await requestSse(
        targetUrl,
        JSON.stringify(responsesRequest(model, messages, maxTokens, true, reasoningEffort, effectivePromptCacheKey, explicitPromptCache)),
        responsesDelta,
      )
      if (!result.response.ok && effectivePromptCacheKey
        && isPromptCacheUnsupportedResponse(result.response.status, result.body)
        && !controller.signal.aborted) {
        if (explicitPromptCache && isExplicitPromptCacheUnsupportedResponse(result.body)) {
          this.disableExplicitPromptCache(baseUrl, model)
          result = await requestSse(
            targetUrl,
            JSON.stringify(responsesRequest(model, messages, maxTokens, true, reasoningEffort, effectivePromptCacheKey, false)),
            responsesDelta,
          )
        }
        if (!result.response.ok) {
          this.disablePromptCache(baseUrl, model)
          result = await requestSse(
            targetUrl,
            JSON.stringify(responsesRequest(model, messages, maxTokens, true, reasoningEffort, undefined, false)),
            responsesDelta,
          )
        }
      }
      if (!result.response.ok) throw modelHttpError(result.response.status, result.body)
      return result.content
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') {
        if (timedOut) throw new Error(`Model request timed out after ${modelRequestTimeoutLabel(requestTimeout)}`)
        throw new Error('Model request was cancelled')
      }
      throw error
    } finally {
      clearTimeout(timer)
      release()
    }
  }

  async requestProtocol(settings, protocol, messages, {
    temperature = 0.2,
    maxTokens = 3_500,
    maxResponseBytes,
    timeoutMs,
    signal,
    onMetadata,
  } = {}) {
    const provider = normalizeModelProvider(protocol)
    if (provider === 'openai-compatible') return this.request({ ...settings, modelProvider: provider }, messages, { temperature, maxTokens, maxResponseBytes, timeoutMs, signal, onMetadata })
    const baseUrl = normalizeModelServiceBaseUrl(settings?.modelBaseUrl)
    const model = String(settings?.modelName || '').trim()
    if (!baseUrl || !model) throw new Error('Configure the model service URL and model name first')
    const apiKey = await this.protocolApiKey(provider, baseUrl)
    const spec = protocolRequest(provider, apiKey, model, messages, temperature, maxTokens, false)
    const requestBody = JSON.stringify(spec.body)
    if (Buffer.byteLength(requestBody, 'utf8') > MAX_MODEL_REQUEST_BYTES) throw new Error(`Model request exceeds the ${MAX_MODEL_REQUEST_BYTES}-byte limit`)
    const { controller, release } = this.requestController(signal)
    const requestTimeout = normalizeModelRequestTimeout(timeoutMs)
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, requestTimeout)
    try {
      const targetUrl = protocolUrl(provider, baseUrl, model)
      const endpoint = await this.prepareEndpoint(targetUrl, controller.signal)
      try {
        const response = await this.fetchFn(targetUrl, {
          method: 'POST',
          headers: { ...spec.headers, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: requestBody, redirect: 'error', signal: controller.signal, dispatcher: endpoint.dispatcher,
        })
        const body = await readBoundedResponseText(response, completionResponseByteLimit(maxResponseBytes), 'Model completion response')
        if (!response.ok) throw new Error(`Model service returned HTTP ${response.status}`)
        let payload
        try { payload = JSON.parse(body) } catch { throw new Error('Model service returned invalid JSON') }
        const metadata = responseMetadata(payload)
        if (metadata) onMetadata?.(metadata)
        const content = protocolText(provider, payload)
        if (!content) throw new Error('Model service returned no answer content')
        return content
      } finally {
        await endpoint.close({ force: controller.signal.aborted }).catch(() => {})
      }
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') {
        if (timedOut) throw new Error(`Model request timed out after ${modelRequestTimeoutLabel(requestTimeout)}`)
        throw new Error('Model request was cancelled')
      }
      throw error
    } finally {
      clearTimeout(timer)
      release()
    }
  }

  async requestProtocolStream(settings, protocol, messages, {
    temperature = 0.2,
    maxTokens = 3_500,
    maxResponseBytes,
    timeoutMs,
    signal,
    onDelta,
    onMetadata,
  } = {}) {
    const provider = normalizeModelProvider(protocol)
    if (provider === 'openai-compatible') return this.requestStream({ ...settings, modelProvider: provider }, messages, { temperature, maxTokens, maxResponseBytes, timeoutMs, signal, onDelta, onMetadata })
    const baseUrl = normalizeModelServiceBaseUrl(settings?.modelBaseUrl)
    const model = String(settings?.modelName || '').trim()
    if (!baseUrl || !model) throw new Error('Configure the model service URL and model name first')
    const apiKey = await this.protocolApiKey(provider, baseUrl)
    const spec = protocolRequest(provider, apiKey, model, messages, temperature, maxTokens, true)
    const requestBody = JSON.stringify(spec.body)
    if (Buffer.byteLength(requestBody, 'utf8') > MAX_MODEL_REQUEST_BYTES) throw new Error(`Model request exceeds the ${MAX_MODEL_REQUEST_BYTES}-byte limit`)
    const { controller, release } = this.requestController(signal)
    const requestTimeout = normalizeModelRequestTimeout(timeoutMs)
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, requestTimeout)
    try {
      const targetUrl = protocolUrl(provider, baseUrl, model, true)
      const endpoint = await this.prepareEndpoint(targetUrl, controller.signal)
      try {
        const response = await this.fetchFn(targetUrl, {
          method: 'POST',
          headers: { ...spec.headers, 'Content-Type': 'application/json', Accept: provider === 'ollama-chat' ? 'application/x-ndjson' : 'text/event-stream' },
          body: requestBody, redirect: 'error', signal: controller.signal, dispatcher: endpoint.dispatcher,
        })
        if (!response.ok) {
          await readBoundedResponseText(response, completionResponseByteLimit(maxResponseBytes), 'Model stream error response')
          throw new Error(`Model service returned HTTP ${response.status}`)
        }
        const options = { extractDelta: (payload) => protocolDelta(provider, payload), onDelta, onMetadata }
        // Await the body reader before leaving this scope. Returning the
        // promise directly would run the finally block first and close the
        // pinned dispatcher while an SSE/NDJSON stream is still consuming it.
        return provider === 'ollama-chat'
          ? await readBoundedNdjson(response, completionResponseByteLimit(maxResponseBytes), options)
          : await readBoundedEventStream(response, completionResponseByteLimit(maxResponseBytes), options)
      } finally {
        await endpoint.close({ force: controller.signal.aborted }).catch(() => {})
      }
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') {
        if (timedOut) throw new Error(`Model request timed out after ${modelRequestTimeoutLabel(requestTimeout)}`)
        throw new Error('Model request was cancelled')
      }
      throw error
    } finally {
      clearTimeout(timer)
      release()
    }
  }

  async protocolApiKey(provider, baseUrl) {
    const apiKey = await this.vault.readApiKey(baseUrl)
    if (apiKey) return apiKey
    if (provider === 'ollama-chat' && isLiteralLoopbackModelService(baseUrl)) return ''
    throw new Error('Save a model API key before processing a task')
  }

  async validate(settings) {
    const content = await this.request(settings, [
      { role: 'system', content: 'Reply with exactly THEIA_OK.' },
      { role: 'user', content: 'Check the configured connection.' },
    ], { temperature: 0, maxTokens: 16 })
    if (!content.includes('THEIA_OK')) throw new Error('The model service responded, but did not complete the connection check')
    return { ok: true }
  }

  async discover({ baseUrl, apiKey, signal } = {}) {
    const normalizedBaseUrl = normalizeModelServiceBaseUrl(baseUrl)
    const key = String(apiKey || '').trim() || await this.vault.readApiKey(normalizedBaseUrl)
    if (!key) throw new Error('Enter or save a model API key before detecting models')
    const active = this.requestController(signal)
    const { controller } = active
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, MODEL_DISCOVERY_TIMEOUT_MS)
    try {
      const targetUrl = modelsUrl(normalizedBaseUrl)
      const endpoint = await this.prepareEndpoint(targetUrl, controller.signal)
      try {
        const response = await this.fetchFn(targetUrl, {
          headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
          redirect: 'error',
          signal: controller.signal,
          dispatcher: endpoint.dispatcher,
        })
        const body = await readBoundedResponseText(response, MAX_MODEL_LIST_RESPONSE_BYTES, 'Model list response')
        if (!response.ok) throw new Error(`Model list request returned HTTP ${response.status}`)
        let payload
        try { payload = JSON.parse(body) } catch { throw new Error('Model list endpoint returned invalid JSON') }
        const records = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : []
        const models = listedModels(records.map((item) => typeof item === 'string' ? item : item?.id ?? item?.name))
        if (!models.length) throw new Error('The model list endpoint returned no selectable models')
        return { models, selectedModel: preferredModel(models) || null }
      } finally {
        await endpoint.close({ force: controller.signal.aborted }).catch(() => {})
      }
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') {
        if (timedOut) throw new Error('Model detection timed out after 15 seconds')
        throw new Error('Model detection was cancelled')
      }
      throw error
    } finally {
      clearTimeout(timer)
      active.release()
    }
  }

  /**
   * 生成课程通知摘要：把当前 store 里的 assignments + notices 喂给模型，
   * 输出一份 Markdown 摘要，保存到 userData/summaries/<timestamp>.md
   */
  async summarizeNotices(settings, { assignments = [], notices = [], courses = [], dataRoot }) {
    const { mkdir, writeFile } = await import('node:fs/promises')
    const { resolve } = await import('node:path')
    const now = new Date()
    const pending = assignments.filter((a) => a.status !== 'submitted')
    const context = JSON.stringify({
      generatedAt: now.toISOString(),
      pendingAssignments: pending.slice(0, 60).map((a) => ({
        course: a.courseName, title: a.title, dueAt: a.dueAt, kind: a.kind, status: a.status,
      })),
      recentNotices: notices.slice(0, 40).map((n) => ({
        source: n.source, title: n.title, summary: n.summary?.slice(0, 200), publishedAt: n.publishedAt,
      })),
      courses: courses.slice(0, 30).map((c) => c.title),
    }, null, 2).slice(0, MAX_CONTEXT_CHARS)

    const content = await this.request(settings, [
      { role: 'system', content: '你是一个细心的学习助手。根据提供的课程数据，生成简洁清晰的中文通知摘要。使用 Markdown 格式，包含紧急程度标识（🔴<1天 🟡<7天 🟢正常）。' },
      { role: 'user', content: `请根据以下课程数据生成通知摘要，按截止时间排序待交作业，并归纳最新通知要点：\n\n${context}` },
    ], { temperature: 0.3, maxTokens: 4_000 })

    const dir = resolve(dataRoot, 'summaries')
    await mkdir(dir, { recursive: true })
    const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filePath = resolve(dir, `summary-${ts}.md`)
    await writeFile(filePath, `${content.trim()}\n`, 'utf8')
    return { filePath, content }
  }

  /**
   * 为指定作业工作包生成笔记：读取附件文本 + 作业说明，
   * 输出结构化学习笔记 Markdown。
   */
  async generateNotes(assignmentId, settings, { title = '' } = {}) {
    const { workspace, manifest } = await this.courseWork.readWorkspaceManifest(assignmentId)
    const { writeFile } = await import('node:fs/promises')
    const { resolve } = await import('node:path')
    const attachCtx = await attachmentContext(workspace)
    const subject = title || manifest?.assignment?.courseName || manifest?.assignment?.title || '课程内容'
    const instructions = manifest?.page?.instructions || ''

    const content = await this.request(settings, [
      { role: 'system', content: '你是一个专注的学习助手。根据提供的课程材料，提取核心知识点，生成结构清晰、重点突出的中文学习笔记。使用 Markdown 格式，包含标题层级、要点列表和关键概念解释。' },
      { role: 'user', content: `请根据以下课程材料为「${subject}」生成学习笔记：\n\n${instructions}${attachCtx}` },
    ], { temperature: 0.3, maxTokens: 5_000 })

    const notesPath = resolve(workspace.directory, 'notes.md')
    await writeFile(notesPath, `${content.trim()}\n`, 'utf8')
    const snapshot = await this.courseWork.store.update((state) => ({
      ...state,
      workspaces: state.workspaces.map((item) => item.assignmentId === assignmentId ? {
        ...item, notesPath, updatedAt: new Date().toISOString(),
      } : item),
    }))
    return { snapshot, notesPath, content }
  }

  /**
   * 为指定作业工作包生成论文草稿：读取要求（附件+说明）→ 输出论文 Markdown。
   * 包含摘要、各章节正文、结论。
   */
  async generatePaper(assignmentId, settings, { title = '', wordCount = 3000 } = {}) {
    const { workspace, manifest } = await this.courseWork.readWorkspaceManifest(assignmentId)
    const { writeFile } = await import('node:fs/promises')
    const { resolve } = await import('node:path')
    const attachCtx = await attachmentContext(workspace)
    const subject = title || manifest?.assignment?.title || '课程论文'
    const courseName = manifest?.assignment?.courseName || ''
    const instructions = manifest?.page?.instructions || ''

    const content = await this.request(settings, [
      { role: 'system', content: `你是一个严谨的学术写作助手。根据提供的作业要求，生成结构完整的中文论文草稿。论文应包含：标题、摘要（200字）、关键词、引言、主体各章节（每节500-800字）、结论、参考文献（如有）。目标字数约 ${wordCount} 字，使用学术语体，Markdown 格式输出。` },
      { role: 'user', content: `请为「${courseName}」课程撰写题为「${subject}」的论文草稿（约${wordCount}字）。\n\n作业要求：\n${instructions}${attachCtx}` },
    ], { temperature: 0.4, maxTokens: 6_000 })

    const paperPath = resolve(workspace.directory, 'paper.md')
    await writeFile(paperPath, `${content.trim()}\n`, 'utf8')
    const snapshot = await this.courseWork.store.update((state) => ({
      ...state,
      workspaces: state.workspaces.map((item) => item.assignmentId === assignmentId ? {
        ...item, paperPath, updatedAt: new Date().toISOString(),
      } : item),
    }))
    return { snapshot, paperPath, content }
  }

  async process(assignmentId, settings) {
    const { workspace, manifest } = await this.courseWork.readWorkspaceManifest(assignmentId)
    const isTest = manifest?.assignment?.kind === 'online-test'
    const context = contextualTask(manifest)
    const attachCtx = await attachmentContext(workspace)

    if (isTest) {
      const content = await this.request(settings, [
        { role: 'system', content: 'You are a careful study assistant. Answer only from the supplied task. Return strict JSON only, with no markdown or explanation.' },
        { role: 'user', content: `Solve this online test. Return exactly {"answers":[{"question":1,"answer":"A"}]}. Use each question number once. For multiple-choice answers, use the exact option value or visible option label. For text questions, provide the answer text. Do not include final submission instructions.\n\n${context}${attachCtx}` },
      ], { temperature: 0, maxTokens: 3_500 })
      const answerKey = normalizeAnswerKey(extractJson(content))
      const expected = new Set((manifest?.page?.questions || []).map((question) => Number(question.index)))
      if (!expected.size) throw new Error('The prepared test package does not contain parsed questions')
      const seen = new Set()
      for (const answer of answerKey.answers) {
        if (!expected.has(answer.question) || seen.has(answer.question)) throw new Error('The model returned an answer for an unknown or duplicate question')
        seen.add(answer.question)
      }
      if (seen.size !== expected.size) throw new Error(`The model returned ${seen.size}/${expected.size} answers; no partial test answer was saved`)
      return this.courseWork.saveModelResult(assignmentId, { answerKey, modelName: String(settings.modelName || '').trim() })
    }

    const content = await this.request(settings, [
      { role: 'system', content: 'You are a careful study assistant. Work only from the supplied task and clearly state missing information instead of inventing it. Produce a complete answer in Chinese Markdown. Do not claim that anything was submitted.' },
      { role: 'user', content: `Prepare a draft answer for this course assignment. Preserve any requested format, show necessary reasoning, and include citations only when supplied by the task.\n\n${context}${attachCtx}` },
    ], { temperature: 0.2, maxTokens: 4_000 })
    return this.courseWork.saveModelResult(assignmentId, { answerMarkdown: content, modelName: String(settings.modelName || '').trim() })
  }
}
