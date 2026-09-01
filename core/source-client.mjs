import iconv from 'iconv-lite'
import { compactError, htmlLooksLikeLogin, htmlLooksLikeRateLimit } from './util.mjs'
import { permittedSourceUrl } from './source-url-policy.mjs'

const MAX_TEXT_RESPONSE_BYTES = 16 * 1024 * 1024
export const MAX_ATTACHMENT_RESPONSE_BYTES = 32 * 1024 * 1024
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MAX_REDIRECTS = 5
const MAX_GET_RETRIES = 2

export class AuthRequiredError extends Error {
  constructor(source, url) {
    super(`${source} 需要重新完成统一身份认证`)
    this.name = 'AuthRequiredError'
    this.source = source
    this.url = url
  }
}

export class SourceRequestError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'SourceRequestError'
    Object.assign(this, details)
  }
}

export function isSourceRateLimited(error) {
  return error?.code === 'ERATELIMIT' || Number(error?.status) === 429
}

function normalizeEncoding(value) {
  const encoding = String(value || '').trim().toLowerCase().replaceAll('_', '-')
  if (!encoding) return null
  if (['utf8', 'utf-8', 'unicode-1-1-utf-8'].includes(encoding)) return 'utf-8'
  if (['gb2312', 'gb-2312', 'x-gbk', 'chinese'].includes(encoding)) return 'gbk'
  if (['utf16', 'utf-16', 'utf-16le'].includes(encoding)) return 'utf-16le'
  if (['utf-16be'].includes(encoding)) return 'utf-16be'
  return encoding
}

function declaredEncoding(contentType = '', probe = '') {
  const header = String(contentType).match(/charset\s*=\s*['"]?([^;"'\s]+)/i)?.[1]
  const meta = String(probe).match(/<meta\b[^>]*\bcharset\s*=\s*["']?([^\s"'>;]+)/i)?.[1]
    || String(probe).match(/<meta\b[^>]*\bcontent\s*=\s*["'][^"']*\bcharset\s*=\s*([^\s"';>]+)/i)?.[1]
  const headerEncoding = normalizeEncoding(header)
  const metaEncoding = normalizeEncoding(meta)
  // THEOL occasionally advertises UTF-8 while its legacy page declares GBK.
  // A non-UTF-8 HTML declaration is stronger evidence for the page body.
  if (metaEncoding && metaEncoding !== 'utf-8') return metaEncoding
  return headerEncoding || metaEncoding
}

export function detectSourceEncoding(buffer, contentType = '') {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '')
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le'
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be'
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8'
  return declaredEncoding(contentType, bytes.subarray(0, 16 * 1024).toString('latin1')) || 'utf-8'
}

export function decodeSourceBuffer(buffer, contentType = '') {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '')
  const encoding = detectSourceEncoding(bytes, contentType)
  if (encoding === 'utf-8' || encoding === 'utf-16le' || encoding === 'utf-16be') {
    try { return new TextDecoder(encoding, { fatal: false }).decode(bytes) } catch { /* use iconv below */ }
  }
  try { return iconv.decode(bytes, encoding) } catch { return new TextDecoder('utf-8', { fatal: false }).decode(bytes) }
}

function decodeResponse(buffer, contentType = '') {
  return decodeSourceBuffer(buffer, contentType)
}

function cookieUrl(cookie) {
  const host = String(cookie.domain || '').replace(/^\./, '')
  const path = String(cookie.path || '/').startsWith('/') ? String(cookie.path || '/') : '/'
  return `${cookie.secure ? 'https' : 'http'}://${host}${path}`
}

function copyableCookie(cookie) {
  const value = {
    url: cookieUrl(cookie),
    name: cookie.name,
    value: cookie.value,
    path: cookie.path || '/',
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly),
  }
  if (cookie.domain) value.domain = cookie.domain
  if (cookie.expirationDate) value.expirationDate = cookie.expirationDate
  if (cookie.sameSite && cookie.sameSite !== 'unspecified') value.sameSite = cookie.sameSite
  return value
}

function isHttpUrl(rawUrl) {
  try {
    return new URL(rawUrl).protocol === 'http:'
  } catch {
    return false
  }
}

function isElectronSession(value) {
  // Electron's `session.fetch` cancels a manual redirect unless a native
  // ClientRequest follows it synchronously. The Session fetch API has no
  // redirect event hook, so use its follow mode for real Electron sessions;
  // test doubles and other fetch implementations retain the explicit manual
  // redirect path below.
  return value?.constructor?.name === 'Session' && typeof value?.fetch === 'function'
}

function cookieIdentity(cookie) {
  return [cookie?.name, cookie?.domain || '', cookie?.path || '/'].join('\u0000')
}

async function requestCookies(cookieSession, target) {
  const cookies = await cookieSession.cookies.get({ url: target })
  if (!isHttpUrl(target)) return cookies

  // Electron correctly excludes Secure cookies for HTTP URLs. THEIA's campus
  // request policy intentionally permits official legacy HTTP endpoints, so
  // resolve the matching HTTPS jar as well and send the same host/path cookie
  // set explicitly. This never broadens the strict *.buct.edu.cn URL policy.
  // The campus HTTP endpoints (e.g. THEOL mobile pending-task fallback) rely
  // on the shared secure session cookie to stay authenticated; removing it
  // here would break those official read-only fallbacks.
  const httpsTarget = new URL(target)
  httpsTarget.protocol = 'https:'
  const httpsCookies = await cookieSession.cookies.get({ url: httpsTarget.toString() })
  return [...new Map([...cookies, ...httpsCookies].map((cookie) => [cookieIdentity(cookie), cookie])).values()]
}

async function limitedResponseBuffer(response, { maxBytes, source, url }) {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new SourceRequestError(`${source} 响应超过 ${Math.ceil(maxBytes / 1024 / 1024)} MB 限制`, {
      source, url, bytes: declared, maxBytes,
    })
  }
  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > maxBytes) {
      throw new SourceRequestError(`${source} 响应超过 ${Math.ceil(maxBytes / 1024 / 1024)} MB 限制`, {
        source, url, bytes: buffer.length, maxBytes,
      })
    }
    return buffer
  }

  const chunks = []
  const reader = response.body.getReader()
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = Buffer.from(value)
      total += chunk.length
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new SourceRequestError(`${source} 响应超过 ${Math.ceil(maxBytes / 1024 / 1024)} MB 限制`, {
          source, url, bytes: total, maxBytes,
        })
      }
      chunks.push(chunk)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, total)
}

export class SessionClient {
  constructor(session, { requestSession = session, timeoutMs = 25_000, pageLoader = null, formLoader = null, binaryLoader = null, onDiagnostic = null, redirectMode = null, minRequestIntervalMs = 0 } = {}) {
    this.cookieSession = session
    this.requestSession = requestSession
    this.timeoutMs = timeoutMs
    this.pageLoader = pageLoader
    this.formLoader = formLoader
    this.binaryLoader = typeof binaryLoader === 'function' ? binaryLoader : null
    this.onDiagnostic = typeof onDiagnostic === 'function' ? onDiagnostic : null
    this.redirectMode = ['follow', 'manual', 'error'].includes(redirectMode) ? redirectMode : null
    this.minRequestIntervalMs = Math.max(0, Number(minRequestIntervalMs) || 0)
    this.nextRequestAt = 0
    this.requestGate = Promise.resolve()
  }

  diagnostic(event, fields = {}) {
    try { void this.onDiagnostic?.(event, fields) } catch { /* diagnostics must never affect requests */ }
  }

  async waitForRequestSlot(signal = null) {
    if (!this.minRequestIntervalMs) return
    const queued = this.requestGate.catch(() => {}).then(async () => {
      const delayMs = Math.max(0, this.nextRequestAt - Date.now())
      if (delayMs > 0) {
        await new Promise((resolveDelay, rejectDelay) => {
          let settled = false
          const timer = setTimeout(() => {
            if (settled) return
            settled = true
            signal?.removeEventListener?.('abort', cancel)
            resolveDelay()
          }, delayMs)
          const cancel = () => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            signal?.removeEventListener?.('abort', cancel)
            rejectDelay(signal?.reason || new Error('Request aborted'))
          }
          if (signal?.aborted) cancel()
          else signal?.addEventListener?.('abort', cancel, { once: true })
        })
      }
      this.nextRequestAt = Date.now() + this.minRequestIntervalMs
    })
    this.requestGate = queued.catch(() => {})
    await queued
  }

  async mirrorCookies(cookies) {
    if (this.cookieSession === this.requestSession || !this.requestSession?.cookies?.set) return
    await Promise.all(cookies.map(async (cookie) => {
      try {
        await this.requestSession.cookies.set(copyableCookie(cookie))
      } catch {
        // The explicit request Cookie header below remains a fallback for unusual cookies.
      }
    }))
  }

  async fetchCampus(rawUrl, init, { source, signal, redirects = 0 }) {
    if (redirects > MAX_REDIRECTS) {
      throw new SourceRequestError(`${source} 重定向过多`, { source, url: String(rawUrl) })
    }
    let target
    try {
      target = permittedSourceUrl(rawUrl)
    } catch (error) {
      throw new SourceRequestError(`${source} 拒绝访问非校园网地址`, { source, url: String(rawUrl), cause: error })
    }
    const headers = new Headers(init.headers || {})
    headers.set('Accept-Language', 'zh-CN,zh;q=0.9,en;q=0.4')
    headers.delete('Cookie')
    const cookies = await requestCookies(this.cookieSession, target)
    await this.mirrorCookies(cookies)
    const nativeSession = isElectronSession(this.requestSession)
    const redirectMode = this.redirectMode || (nativeSession ? 'follow' : 'manual')
    // A native Electron session sends its own scoped cookies when credentials
    // are included. Avoid copying a Cookie header into a followed redirect,
    // where it could be presented to a different host. The explicit header is
    // still required for injected/test sessions and the manual redirect path.
    if (cookies.length && !(nativeSession && redirectMode === 'follow')) {
      headers.set('Cookie', cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '))
    }
    const response = await this.requestSession.fetch(target, {
      ...init,
      headers,
      credentials: 'include',
      redirect: redirectMode,
      signal,
    })
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location')
      if (!location) throw new SourceRequestError(`${source} 返回了无目标的重定向`, { source, status: response.status, url: target })
      const nextUrl = new URL(location, target).toString()
      try { permittedSourceUrl(nextUrl) } catch (error) {
        throw new SourceRequestError(`${source} 拒绝重定向到非校园网地址`, { source, status: response.status, url: nextUrl, cause: error })
      }
      try { await response.body?.cancel?.() } catch { /* ignore redirect body cleanup failures */ }
      const method = String(init.method || 'GET').toUpperCase()
      const switchToGet = response.status === 303 || ([301, 302].includes(response.status) && method === 'POST')
      const nextInit = { ...init }
      if (switchToGet) {
        nextInit.method = 'GET'
        delete nextInit.body
        const nextHeaders = new Headers(nextInit.headers || {})
        nextHeaders.delete('Content-Type')
        nextHeaders.delete('Content-Length')
        nextInit.headers = nextHeaders
      }
      return this.fetchCampus(nextUrl, nextInit, { source, signal, redirects: redirects + 1 })
    }
    const finalUrl = response.url || target
    try { permittedSourceUrl(finalUrl) } catch (error) {
      throw new SourceRequestError(`${source} 返回了非校园网地址`, { source, url: finalUrl, cause: error })
    }
    return { response, url: finalUrl }
  }

  async requestOnce(url, init = {}, { source = 'school', allowLogin = false, signal = null } = {}) {
    await this.waitForRequestSlot(signal)
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, this.timeoutMs)
    const cancel = () => controller.abort(signal?.reason)
    if (signal?.aborted) cancel()
    else signal?.addEventListener?.('abort', cancel, { once: true })
    const startedAt = Date.now()
    this.diagnostic('source.request_started', { source, method: init.method || 'GET', url: String(url) })
    try {
      const { response, url: finalUrl } = await this.fetchCampus(url, init, { source, signal: controller.signal })
      const buffer = await limitedResponseBuffer(response, {
        maxBytes: MAX_TEXT_RESPONSE_BYTES,
        source,
        url: finalUrl,
      })
      const text = decodeResponse(buffer, response.headers.get('content-type') || '')
      if (response.status === 429 || htmlLooksLikeRateLimit(text)) {
        throw new SourceRequestError(`${source} 访问过于频繁，请稍后再试`, {
          source, status: response.status, url: finalUrl, code: 'ERATELIMIT',
        })
      }
      if (!response.ok) {
        throw new SourceRequestError(`${source} 请求失败 (${response.status})`, { source, status: response.status, url: finalUrl })
      }
      if (!allowLogin && htmlLooksLikeLogin(text, finalUrl)) throw new AuthRequiredError(source, finalUrl)
      this.diagnostic('source.request_finished', { source, method: init.method || 'GET', url: finalUrl, status: response.status, bytes: buffer.length, elapsedMs: Date.now() - startedAt })
      return { response, text, url: finalUrl, headers: response.headers }
    } catch (error) {
      this.diagnostic('source.request_failed', { source, method: init.method || 'GET', url: String(url), error: compactError(error), elapsedMs: Date.now() - startedAt })
      if (error?.name === 'AbortError') {
        throw new SourceRequestError(`${source} ${timedOut ? '请求超时' : '请求已取消'}`, {
          source,
          url,
          code: timedOut ? 'ETIMEDOUT' : 'ABORT_ERR',
        })
      }
      if (error instanceof AuthRequiredError || error instanceof SourceRequestError) throw error
      throw new SourceRequestError(`${source} 网络请求失败: ${compactError(error)}`, { source, url, cause: error })
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', cancel)
    }
  }

  async request(url, init = {}, options = {}) {
    const method = String(init.method || 'GET').toUpperCase()
    const retryableMethod = method === 'GET' || method === 'HEAD'
    let attempt = 0
    while (true) {
      try {
        return await this.requestOnce(url, init, options)
      } catch (error) {
        const status = Number(error?.status)
        const transientStatus = [408, 425].includes(status) || status >= 500
        const errorText = compactError(error)
        // Electron's fetch can surface a cancelled redirect when the campus
        // CAS briefly replaces a session or the renderer closes a redirecting
        // response. This is still safe to retry for idempotent GET/HEAD, and
        // avoids turning a transient renderer/network race into a hard sync
        // failure. AuthRequiredError is handled above and is never retried.
        const transientRedirect = /redirect\s+was\s+cancelled|ERR_(?:ABORTED|CONNECTION_RESET)|failed\s+to\s+fetch|network\s+error/iu.test(errorText)
        const transientNetwork = error?.code === 'ETIMEDOUT'
          || transientRedirect
          || (!status && error?.cause && error?.name === 'SourceRequestError')
        if (!retryableMethod || options?.signal?.aborted || attempt >= MAX_GET_RETRIES || (!transientStatus && !transientNetwork)) throw error
        const delayMs = 250 * (attempt + 1) ** 2
        attempt += 1
        this.diagnostic('source.request_retry', {
          source: options?.source || 'school',
          method,
          url: String(url),
          attempt,
          delayMs,
          status: Number.isFinite(status) ? status : null,
          code: error?.code || null,
        })
        await new Promise((resolveDelay, rejectDelay) => {
          let settled = false
          const timer = setTimeout(() => {
            if (settled) return
            settled = true
            options.signal?.removeEventListener?.('abort', cancel)
            resolveDelay()
          }, delayMs)
          const cancel = () => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            options.signal?.removeEventListener?.('abort', cancel)
            rejectDelay(options.signal?.reason || new Error('Request aborted'))
          }
          if (options.signal?.aborted) cancel()
          else options.signal?.addEventListener?.('abort', cancel, { once: true })
        })
      }
    }
  }

  async text(url, init, options) {
    return (await this.request(url, init, options)).text
  }

  async binary(url, {
    source = 'school attachment',
    maxBytes = MAX_ATTACHMENT_RESPONSE_BYTES,
    method = 'GET',
    headers = {},
    body,
    referer = null,
    signal = null,
  } = {}) {
    const requestMethod = String(method || 'GET').toUpperCase()
    const requestReferer = referer ? permittedSourceUrl(referer) : null
    const requestHeaders = new Headers(headers || {})
    if (requestReferer) requestHeaders.set('Referer', requestReferer)
    const requestInit = { method: requestMethod, headers: requestHeaders }
    if (body !== undefined) requestInit.body = body
    if (this.binaryLoader && !isHttpUrl(url)) {
      await this.waitForRequestSlot(signal)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.timeoutMs)
      try {
        const target = permittedSourceUrl(url)
        const result = await this.binaryLoader(target, {
          source,
          signal: controller.signal,
          timeoutMs: this.timeoutMs,
          method: requestMethod,
          headers: Object.fromEntries(requestHeaders.entries()),
          body,
          referer: requestReferer,
        })
        const buffer = Buffer.isBuffer(result?.buffer) ? result.buffer : Buffer.from(result?.buffer || '')
        const limit = Math.max(1, Math.min(MAX_ATTACHMENT_RESPONSE_BYTES, Number(maxBytes) || MAX_ATTACHMENT_RESPONSE_BYTES))
        if (buffer.length > limit) {
          throw new SourceRequestError(`${source} 响应超过 ${Math.ceil(limit / 1024 / 1024)} MB 限制`, {
            source, url: target, bytes: buffer.length, maxBytes: limit,
          })
        }
        const finalUrl = permittedSourceUrl(result?.url || target)
        if (result?.status && (result.status < 200 || result.status >= 300)) {
          throw new SourceRequestError(`${source} 请求失败 (${result.status})`, { source, status: result.status, url: finalUrl })
        }
        if (result?.text && htmlLooksLikeLogin(result.text, finalUrl)) throw new AuthRequiredError(source, finalUrl)
        return { ...result, buffer, url: finalUrl }
      } catch (error) {
        if (error?.name === 'AbortError') throw new SourceRequestError(`${source} 请求超时`, { source, url, code: 'ETIMEDOUT' })
        if (error instanceof AuthRequiredError || error instanceof SourceRequestError) throw error
        throw new SourceRequestError(`${source} 下载失败: ${compactError(error)}`, { source, url, cause: error })
      } finally {
        clearTimeout(timer)
      }
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    const cancel = () => controller.abort(signal?.reason)
    if (signal?.aborted) cancel()
    else signal?.addEventListener?.('abort', cancel, { once: true })
    try {
      await this.waitForRequestSlot(signal)
      const { response, url: finalUrl } = await this.fetchCampus(url, requestInit, { source, signal: controller.signal })
      const limit = Math.max(1, Math.min(MAX_ATTACHMENT_RESPONSE_BYTES, Number(maxBytes) || MAX_ATTACHMENT_RESPONSE_BYTES))
      const buffer = await limitedResponseBuffer(response, { maxBytes: limit, source, url: finalUrl })
      const contentType = response.headers.get('content-type') || ''
      if (response.status === 429 || htmlLooksLikeRateLimit(decodeResponse(buffer, contentType))) {
        throw new SourceRequestError(`${source} 访问过于频繁，请稍后再试`, {
          source, status: response.status, url: finalUrl, code: 'ERATELIMIT',
        })
      }
      if (!response.ok) throw new SourceRequestError(`${source} 请求失败 (${response.status})`, { source, status: response.status, url: finalUrl })
      if (/html|text\//i.test(contentType) && htmlLooksLikeLogin(decodeResponse(buffer, contentType), finalUrl)) throw new AuthRequiredError(source, finalUrl)
      return { buffer, url: finalUrl, headers: response.headers }
    } catch (error) {
      if (error?.name === 'AbortError') throw new SourceRequestError(`${source} 请求超时`, { source, url })
      if (error instanceof AuthRequiredError || error instanceof SourceRequestError) throw error
      throw new SourceRequestError(`${source} 下载失败: ${compactError(error)}`, { source, url, cause: error })
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', cancel)
    }
  }

  async page(url, { source = 'school', allowLogin = false, signal = null } = {}) {
    // A rendered BrowserWindow follows normal Secure-cookie rules. The direct
    // client above is the controlled path for an official legacy HTTP page.
    if (!this.pageLoader || isHttpUrl(url)) return this.request(url, {}, { source, allowLogin, signal })
    const startedAt = Date.now()
    this.diagnostic('source.page_started', { source, url: String(url) })
    try {
      await this.waitForRequestSlot(signal)
      const target = permittedSourceUrl(url)
      if (signal?.aborted) {
        throw new SourceRequestError(`${source} 请求已取消`, { source, url: target, code: 'ABORT_ERR' })
      }
      const result = await this.pageLoader(target, { source, signal })
      const finalUrl = permittedSourceUrl(result?.url || target)
      const text = result?.base64
        ? decodeSourceBuffer(Buffer.from(String(result.base64), 'base64'), result.contentType || '')
        : String(result?.text || '')
      if (Number(result?.status) === 429 || htmlLooksLikeRateLimit(text)) {
        throw new SourceRequestError(`${source} 访问过于频繁，请稍后再试`, {
          source, status: Number(result?.status) || null, url: finalUrl, code: 'ERATELIMIT',
        })
      }
      if (!allowLogin && htmlLooksLikeLogin(text, finalUrl)) throw new AuthRequiredError(source, finalUrl)
      this.diagnostic('source.page_finished', { source, url: finalUrl, bytes: Buffer.byteLength(text), elapsedMs: Date.now() - startedAt })
      return {
        response: null,
        text,
        url: finalUrl,
        headers: result?.headers || (result?.contentType ? new Headers({ 'content-type': result.contentType }) : null),
      }
    } catch (error) {
      this.diagnostic('source.page_failed', { source, url: String(url), error: compactError(error), elapsedMs: Date.now() - startedAt })
      if (error instanceof AuthRequiredError || error instanceof SourceRequestError) throw error
      throw new SourceRequestError(`${source} 页面加载失败: ${compactError(error)}`, { source, url, cause: error })
    }
  }

  async form(url, values, options = {}) {
    if (this.formLoader && !isHttpUrl(url)) {
      const source = options.source || 'school'
      const startedAt = Date.now()
      this.diagnostic('source.form_started', { source, url: String(url), referer: options.referer ? String(options.referer) : undefined })
      try {
        await this.waitForRequestSlot(options.signal || null)
        const target = permittedSourceUrl(url)
        const referer = permittedSourceUrl(options.referer || target)
        const result = await this.formLoader(target, values || {}, { referer, signal: options.signal || null, source })
        const text = String(result?.text || '')
        const finalUrl = permittedSourceUrl(result?.url || target)
        if (Number(result?.status) === 429 || htmlLooksLikeRateLimit(text)) {
          throw new SourceRequestError(`${source} 访问过于频繁，请稍后再试`, {
            source, status: Number(result?.status) || null, url: finalUrl, code: 'ERATELIMIT',
          })
        }
        if (result?.status && (result.status < 200 || result.status >= 300)) {
          throw new SourceRequestError(`${source} request failed (${result.status})`, { source, status: result.status, url: finalUrl })
        }
        if (!options.allowLogin && htmlLooksLikeLogin(text, finalUrl)) throw new AuthRequiredError(source, finalUrl)
        this.diagnostic('source.form_finished', { source, url: finalUrl, status: result?.status || 200, bytes: Buffer.byteLength(text), elapsedMs: Date.now() - startedAt })
        return text
      } catch (error) {
        this.diagnostic('source.form_failed', { source, url: String(url), error: compactError(error), elapsedMs: Date.now() - startedAt })
        if (error instanceof AuthRequiredError || error instanceof SourceRequestError) throw error
        throw new SourceRequestError(`${source} form request failed: ${compactError(error)}`, { source, url, cause: error })
      }
    }
    return this.text(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: options.referer || url,
      },
      body: new URLSearchParams(values).toString(),
    }, options)
  }

  async json(url, init, options) {
    const result = await this.request(url, init, options)
    try {
      return JSON.parse(result.text)
    } catch {
      throw new SourceRequestError(`${options?.source || '学校系统'} 返回了无法解析的数据`, { source: options?.source, url: result.url, body: result.text.slice(0, 400) })
    }
  }
}
