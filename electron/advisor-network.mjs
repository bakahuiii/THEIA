import { prepareModelEndpoint } from './model-network-policy.mjs'

const MAX_REQUEST_BODY_BYTES = 128 * 1024
const MAX_RESPONSE_BODY_BYTES = 256 * 1024
const MAX_REQUEST_HEADERS = 32
const FORBIDDEN_HEADERS = new Set([
  'connection', 'content-length', 'cookie', 'host', 'keep-alive',
  'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade',
])
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'])

function boundedText(value, maximum) {
  const normalized = String(value ?? '').normalize('NFC').trim()
  if (!normalized || normalized.length > maximum) throw new TypeError('Agent network request contains invalid text')
  return normalized
}

function safeRequestUrl(value) {
  const raw = boundedText(value, 4_096)
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new TypeError('Agent network requests require a public HTTPS URL without embedded credentials')
  }
  if (['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase())) {
    throw new TypeError('Agent network requests cannot target loopback services')
  }
  return url
}

function safeRequestHeaders(value) {
  if (value === undefined) return Object.freeze({})
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Agent network headers must be an object')
  const entries = Object.entries(value)
  if (entries.length > MAX_REQUEST_HEADERS) throw new TypeError('Agent network request has too many headers')
  const headers = {}
  for (const [rawName, rawValue] of entries) {
    const name = boundedText(rawName, 120).toLowerCase()
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/u.test(name) || FORBIDDEN_HEADERS.has(name) || name.startsWith('proxy-') || name.startsWith('sec-')) {
      throw new TypeError('Agent network request contains a restricted header')
    }
    headers[name] = boundedText(rawValue, 4_096)
  }
  return Object.freeze(headers)
}

function safeRequestBody(value) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new TypeError('Agent network request body must be text')
  if (Buffer.byteLength(value, 'utf8') > MAX_REQUEST_BODY_BYTES) throw new TypeError('Agent network request body is too large')
  return value
}

async function readBody(response, maximum) {
  if (!response.body) return { text: '', truncated: false }
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  let truncated = false
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      const remaining = maximum - size
      if (remaining <= 0) {
        truncated = true
        await reader.cancel()
        break
      }
      if (chunk.length > remaining) {
        chunks.push(chunk.subarray(0, remaining))
        size += remaining
        truncated = true
        await reader.cancel()
        break
      }
      chunks.push(chunk)
      size += chunk.length
    }
  } finally {
    reader.releaseLock()
  }
  return { text: Buffer.concat(chunks).toString('utf8'), truncated }
}

function visibleResponseHeaders(headers) {
  const result = {}
  for (const name of ['content-type', 'content-length', 'location']) {
    const value = headers?.get?.(name)
    if (value) result[name] = value.slice(0, 4_096)
  }
  return result
}

/**
 * Executes a user-authorized public HTTPS request without forwarding THEIA
 * credentials, browser cookies, proxy settings, or local-network access.
 */
export async function executeAdvisorNetworkRequest(input = {}, {
  fetchImpl = globalThis.fetch,
  endpointFactory = prepareModelEndpoint,
  signal,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Network fetch is unavailable')
  const url = safeRequestUrl(input.url)
  const method = String(input.method || 'GET').trim().toUpperCase()
  if (!ALLOWED_METHODS.has(method)) throw new TypeError('Agent network request method is not allowed')
  const headers = safeRequestHeaders(input.headers)
  const body = safeRequestBody(input.body)
  if ((method === 'GET' || method === 'HEAD') && body !== undefined) {
    throw new TypeError('Agent network GET and HEAD requests cannot include a body')
  }

  const endpoint = await endpointFactory(url.origin, { signal })
  try {
    const response = await fetchImpl(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
      redirect: 'manual',
      dispatcher: endpoint.dispatcher,
      signal,
    })
    const contentType = response.headers?.get?.('content-type') || ''
    const isText = /^(?:text\/|application\/(?:json|xml|javascript|xhtml\+xml))/iu.test(contentType)
    const bodyResult = method === 'HEAD' || !isText
      ? { text: '', truncated: false }
      : await readBody(response, MAX_RESPONSE_BODY_BYTES)
    return Object.freeze({
      url: String(response.url || url),
      status: Number(response.status),
      ok: response.ok === true,
      redirected: response.status >= 300 && response.status < 400,
      headers: visibleResponseHeaders(response.headers),
      ...(isText ? { body: bodyResult.text, truncated: bodyResult.truncated } : { binary: true }),
    })
  } finally {
    await endpoint.close?.().catch(() => undefined)
  }
}
