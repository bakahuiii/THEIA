import { readFile } from 'node:fs/promises'
import { normalizeModelServiceBaseUrl } from '../core/model-url-policy.mjs'
import { normalizeProviderUsage } from './ai/provider.mjs'

export const MAX_CONTEXT_CHARS = 48_000
const MODEL_DISCOVERY_TIMEOUT_MS = 15_000

export const DEFAULT_MODEL_REQUEST_TIMEOUT_MS = 5 * 60 * 1000
export const MAX_MODEL_REQUEST_TIMEOUT_MS = 60 * 60 * 1000
export const MAX_MODEL_REQUEST_BYTES = 2 * 1024 * 1024
export const MAX_MODEL_LIST_RESPONSE_BYTES = 2 * 1024 * 1024
export const MAX_MODEL_COMPLETION_RESPONSE_BYTES = 8 * 1024 * 1024

export function normalizeModelRequestTimeout(value) {
  if (value === undefined) return DEFAULT_MODEL_REQUEST_TIMEOUT_MS
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Model request timeout is invalid')
  return Math.min(value, MAX_MODEL_REQUEST_TIMEOUT_MS)
}

export function modelRequestTimeoutLabel(value) {
  return value % 1000 === 0 ? `${value / 1000} seconds` : `${value} milliseconds`
}

export function completionResponseByteLimit(value) {
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

export function modelHttpError(status, body, label = 'Model service') {
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

export function responseMetadata(payload) {
  const usage = normalizeProviderUsage(payload)
  const requestId = typeof payload?.response?.id === 'string'
    ? payload.response.id
    : typeof payload?.id === 'string' ? payload.id : null
  return usage || requestId ? { usage, requestId } : null
}

export function streamEventFailure(payload) {
  const type = String(payload?.type || '').toLowerCase()
  const status = String(payload?.response?.status || payload?.status || '').toLowerCase()
  if (!['error', 'response.failed', 'response.incomplete'].includes(type)
    && !['failed', 'incomplete'].includes(status)
    && !(payload?.error && !payload?.delta)) return null
  const detail = boundedHttpErrorDetail(payload?.error || payload?.response?.status_details || payload)
  const label = type === 'response.incomplete' || status === 'incomplete' ? 'incomplete' : type === 'response.failed' || status === 'failed' ? 'failed' : 'error'
  return new Error(`Model stream returned ${label}${detail ? `: ${detail}` : ''}`)
}

function streamDeltaContent(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((part) => typeof part?.text === 'string' ? part.text : '').join('')
  return ''
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

export function listedModels(value) {
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

export function extractJson(text) {
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

export function contextualTask(manifest) {
  const page = manifest?.page || {}
  const attachmentSections = []
  for (const item of (manifest?.attachmentExtractions || [])) {
    if (!item.extracted) continue
    attachmentSections.push({ filename: item.filename, format: item.format })
  }
  return JSON.stringify({
    assignment: manifest?.assignment || {},
    instructions: page.instructions || '',
    questions: Array.isArray(page.questions) ? page.questions : [],
    attachmentFiles: attachmentSections,
  }, null, 2).slice(0, MAX_CONTEXT_CHARS)
}

export async function attachmentContext(workspace) {
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

export {
  MODEL_DISCOVERY_TIMEOUT_MS,
  responsesUrl,
  modelsUrl,
  responsesRequest,
  responsesText,
  responsesDelta,
  isPromptCacheUnsupportedResponse,
  isExplicitPromptCacheUnsupportedResponse,
  supportsExplicitPromptCaching,
}
