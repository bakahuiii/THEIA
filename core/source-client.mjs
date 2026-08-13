import iconv from 'iconv-lite'
import { compactError, htmlLooksLikeLogin } from './util.mjs'
import { permittedSourceUrl } from './source-url-policy.mjs'

const MAX_TEXT_RESPONSE_BYTES = 16 * 1024 * 1024
export const MAX_ATTACHMENT_RESPONSE_BYTES = 32 * 1024 * 1024
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MAX_REDIRECTS = 5

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

function decodeResponse(buffer, contentType = '') {
  const charset = String(contentType).match(/charset\s*=\s*['"]?([^;"']+)/i)?.[1]?.toLowerCase()
  if (charset && !['utf-8', 'utf8'].includes(charset)) {
    try { return iconv.decode(buffer, charset) } catch { /* fallback below */ }
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(buffer)
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
  constructor(session, { requestSession = session, timeoutMs = 25_000, pageLoader = null, formLoader = null, onDiagnostic = null } = {}) {
    this.cookieSession = session
    this.requestSession = requestSession
    this.timeoutMs = timeoutMs
    this.pageLoader = pageLoader
    this.formLoader = formLoader
    this.onDiagnostic = typeof onDiagnostic === 'function' ? onDiagnostic : null
  }

  diagnostic(event, fields = {}) {
    try { void this.onDiagnostic?.(event, fields) } catch { /* diagnostics must never affect requests */ }
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
    const cookies = await this.cookieSession.cookies.get({ url: target })
    await this.mirrorCookies(cookies)
    if (cookies.length) headers.set('Cookie', cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '))
    const response = await this.requestSession.fetch(target, {
      ...init,
      headers,
      credentials: 'include',
      redirect: 'manual',
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

  async request(url, init = {}, { source = 'school', allowLogin = false, signal = null } = {}) {
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

  async text(url, init, options) {
    return (await this.request(url, init, options)).text
  }

  async binary(url, { source = 'school attachment', maxBytes = MAX_ATTACHMENT_RESPONSE_BYTES } = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const { response, url: finalUrl } = await this.fetchCampus(url, {}, { source, signal: controller.signal })
      const limit = Math.max(1, Math.min(MAX_ATTACHMENT_RESPONSE_BYTES, Number(maxBytes) || MAX_ATTACHMENT_RESPONSE_BYTES))
      const buffer = await limitedResponseBuffer(response, { maxBytes: limit, source, url: finalUrl })
      if (!response.ok) throw new SourceRequestError(`${source} 请求失败 (${response.status})`, { source, status: response.status, url: finalUrl })
      const contentType = response.headers.get('content-type') || ''
      if (/html|text\//i.test(contentType) && htmlLooksLikeLogin(decodeResponse(buffer, contentType), finalUrl)) throw new AuthRequiredError(source, finalUrl)
      return { buffer, url: finalUrl, headers: response.headers }
    } catch (error) {
      if (error?.name === 'AbortError') throw new SourceRequestError(`${source} 请求超时`, { source, url })
      if (error instanceof AuthRequiredError || error instanceof SourceRequestError) throw error
      throw new SourceRequestError(`${source} 下载失败: ${compactError(error)}`, { source, url, cause: error })
    } finally {
      clearTimeout(timer)
    }
  }

  async page(url, { source = 'school', allowLogin = false, signal = null } = {}) {
    if (!this.pageLoader) return this.request(url, {}, { source, allowLogin, signal })
    const startedAt = Date.now()
    this.diagnostic('source.page_started', { source, url: String(url) })
    try {
      const target = permittedSourceUrl(url)
      if (signal?.aborted) {
        throw new SourceRequestError(`${source} 请求已取消`, { source, url: target, code: 'ABORT_ERR' })
      }
      const result = await this.pageLoader(target, { source, signal })
      const text = String(result?.text || '')
      const finalUrl = permittedSourceUrl(result?.url || target)
      if (!allowLogin && htmlLooksLikeLogin(text, finalUrl)) throw new AuthRequiredError(source, finalUrl)
      this.diagnostic('source.page_finished', { source, url: finalUrl, bytes: Buffer.byteLength(text), elapsedMs: Date.now() - startedAt })
      return { response: null, text, url: finalUrl, headers: null }
    } catch (error) {
      this.diagnostic('source.page_failed', { source, url: String(url), error: compactError(error), elapsedMs: Date.now() - startedAt })
      if (error instanceof AuthRequiredError || error instanceof SourceRequestError) throw error
      throw new SourceRequestError(`${source} 页面加载失败: ${compactError(error)}`, { source, url, cause: error })
    }
  }

  async form(url, values, options = {}) {
    if (this.formLoader) {
      const source = options.source || 'school'
      const startedAt = Date.now()
      this.diagnostic('source.form_started', { source, url: String(url), referer: options.referer ? String(options.referer) : undefined })
      try {
        const target = permittedSourceUrl(url)
        const referer = permittedSourceUrl(options.referer || target)
        const result = await this.formLoader(target, values || {}, { referer, signal: options.signal || null, source })
        const text = String(result?.text || '')
        const finalUrl = permittedSourceUrl(result?.url || target)
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
