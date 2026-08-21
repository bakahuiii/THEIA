import { app, BrowserWindow, safeStorage, session } from 'electron'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { AcademicApiClient } from '../core/academic-api-client.mjs'
import { AcademicApiVault } from '../electron/academic-api-vault.mjs'
import { JwglxtAdapter } from '../core/adapters/jwglxt.mjs'
import { SessionClient } from '../core/source-client.mjs'
import { defaultDataRoot } from '../core/runtime-paths.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const CAPTURE_ROOT = resolve(
  ROOT,
  process.env.THEIA_RENDERED_CRAWL_OUTPUT || `.crawl-rendered-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`,
)
const PAGE_ROOT = resolve(CAPTURE_ROOT, 'browser-responses')
const ATTACHMENT_ROOT = resolve(CAPTURE_ROOT, 'attachments')
const PARTITION = 'persist:theia'
const BASE = 'https://jwglxt.buct.edu.cn/jwglxt/'
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
const CRAWL_DOMAINS = String(process.env.THEIA_RENDERED_CRAWL_DOMAINS || '')
  .split(',')
  .map((domain) => domain.trim())
  .filter(Boolean)

const requestLog = []
let requestIndex = 0
let renderWindow = null
let renderQueue = Promise.resolve()

function raceOperation(operation, timeoutMs, message) {
  let timer
  return Promise.race([
    operation,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs) }),
  ]).finally(() => { if (timer) clearTimeout(timer) })
}

async function resetRenderWindow(window, event, error) {
  if (renderWindow === window) renderWindow = null
  try { if (window && !window.isDestroyed()) window.destroy() } catch { /* renderer may already be gone */ }
  diagnostics(event, { error: String(error?.message || error || '').slice(0, 300) })
}

function safeLabel(value) {
  return String(value || 'response').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 160) || 'response'
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function captureResponse(kind, url, text, meta = {}) {
  const parsed = new URL(url)
  const label = `${String(++requestIndex).padStart(4, '0')}-${kind}-${safeLabel(parsed.hostname)}-${safeLabel(parsed.pathname)}`
  const path = resolve(PAGE_ROOT, `${label}.txt`)
  await mkdir(PAGE_ROOT, { recursive: true })
  await writeFile(path, String(text || ''), 'utf8')
  requestLog.push({
    index: requestIndex,
    kind,
    url: `${parsed.origin}${parsed.pathname}`,
    status: Number(meta.status || 200),
    bytes: Buffer.byteLength(String(text || '')),
    file: path,
    ...(meta.referer ? { referer: `${new URL(meta.referer).origin}${new URL(meta.referer).pathname}` } : {}),
  })
  return path
}

function captureBinaryResponse(kind, url, buffer, meta = {}) {
  const parsed = new URL(url)
  requestLog.push({
    index: ++requestIndex,
    kind,
    url: `${parsed.origin}${parsed.pathname}`,
    status: Number(meta.status || 200),
    bytes: Buffer.isBuffer(buffer) ? buffer.length : Buffer.byteLength(Buffer.from(buffer || '')),
    contentType: String(meta.contentType || ''),
    ...(meta.referer ? { referer: `${new URL(meta.referer).origin}${new URL(meta.referer).pathname}` } : {}),
  })
}

function enqueueRendered(task) {
  const next = renderQueue.then(task, task)
  renderQueue = next.catch(() => undefined)
  return next
}

async function ensureRenderWindow() {
  if (renderWindow && !renderWindow.isDestroyed()) return renderWindow
  renderWindow = new BrowserWindow({
    show: false,
    width: 1200,
    height: 820,
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  renderWindow.on('closed', () => { renderWindow = null })
  return renderWindow
}

async function loadRendered(rawUrl) {
  const url = String(rawUrl)
  const window = await ensureRenderWindow()
  try {
    await raceOperation(window.loadURL(url), 45_000, 'Rendered page navigation timed out')
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 650))
    const finalUrl = window.webContents.getURL() || url
    const text = await raceOperation(
      window.webContents.executeJavaScript('document.documentElement?.outerHTML || ""'),
      30_000,
      'Rendered page DOM read timed out',
    )
    await captureResponse('page', finalUrl, text)
    return { url: finalUrl, status: 200, text }
  } catch (error) {
    // Some Zhengfang pages leave a subresource pending. Use the authenticated
    // renderer's own fetch before discarding the window.
    if (!window.isDestroyed() && /timed out|failed to load|ERR_/iu.test(String(error?.message || error))) {
      try {
        const fallback = await raceOperation(window.webContents.executeJavaScript(`(async ({ url }) => {
          const response = await fetch(url, { credentials: 'include' })
          return { url: response.url, status: response.status, text: await response.text() }
        })(${JSON.stringify({ url })})`), 30_000, 'Rendered page fetch fallback timed out')
        if (Number(fallback?.status || 0) >= 200 && Number(fallback?.status || 0) < 300 && fallback.text) {
          await captureResponse('page-fetch', fallback.url || url, fallback.text)
          diagnostics('rendered_fetch_fallback', { bytes: Buffer.byteLength(String(fallback.text || '')) })
          return fallback
        }
      } catch (fallbackError) {
        diagnostics('rendered_fetch_fallback_failed', { error: String(fallbackError?.message || fallbackError).slice(0, 300) })
      }
    }
    await resetRenderWindow(window, 'render_window_reset', error)
    throw error
  }
}

async function submitRendered(rawUrl, values, options = {}) {
  const url = String(rawUrl)
  const window = await ensureRenderWindow()
  if (options.referer) await loadRendered(options.referer)
  const payload = JSON.stringify({ url, values: values || {} })
  let result
  try {
    result = await raceOperation(window.webContents.executeJavaScript(`(async ({ url, values }) => {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: new URLSearchParams(values).toString(),
      })
      return { url: response.url, status: response.status, text: await response.text() }
    })(${payload})`), 45_000, 'Rendered form request timed out')
  } catch (error) {
    await resetRenderWindow(window, 'render_form_window_reset', error)
    throw error
  }
  await captureResponse('form', result.url || url, result.text || '', {
    status: result.status,
    referer: options.referer,
  })
  return result
}

async function loadBinaryRendered(rawUrl) {
  const url = String(rawUrl)
  const window = await ensureRenderWindow()
  const payload = JSON.stringify({ url })
  try {
    const result = await raceOperation(window.webContents.executeJavaScript(`(async ({ url }) => {
      const response = await fetch(url, { credentials: 'include' })
      const buffer = new Uint8Array(await response.arrayBuffer())
      let binary = ''
      const chunkSize = 0x8000
      for (let index = 0; index < buffer.length; index += chunkSize) {
        binary += String.fromCharCode(...buffer.subarray(index, Math.min(index + chunkSize, buffer.length)))
      }
      const contentType = response.headers.get('content-type') || ''
      const text = /html|text\\//i.test(contentType) && buffer.length <= 1024 * 1024
        ? new TextDecoder().decode(buffer)
        : ''
      return { url: response.url, status: response.status, contentType, base64: btoa(binary), text }
    })(${payload})`), 45_000, 'Rendered binary request timed out')
    const buffer = Buffer.from(String(result?.base64 || ''), 'base64')
    captureBinaryResponse('binary', result?.url || url, buffer, {
      status: result?.status,
      contentType: result?.contentType,
    })
    return {
      url: result?.url || url,
      status: Number(result?.status || 0),
      headers: new Headers({ 'content-type': String(result?.contentType || '') }),
      text: String(result?.text || ''),
      buffer,
    }
  } catch (error) {
    await resetRenderWindow(window, 'render_binary_window_reset', error)
    throw error
  }
}

function attachmentStore(label = 'browser') {
  return {
    async find() { return null },
    async save({ id, extension = 'bin', buffer }) {
      const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '')
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const filename = `${safeLabel(id)}.${safeLabel(extension)}`
      const path = resolve(ATTACHMENT_ROOT, label, filename)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, bytes)
      return { id, bytes: bytes.length, sha256, filename: basename(path), path }
    },
  }
}

function resultCounts(result) {
  const extras = result?.academicExtras?.domains || {}
  const extraCounts = Object.fromEntries(Object.entries(extras).map(([domain, value]) => [domain, {
    records: Array.isArray(value?.records) ? value.records.length : 0,
    attachments: Array.isArray(value?.attachments) ? value.attachments.length : 0,
    completeness: value?.completeness || 'unknown',
    queryStats: value?.queryStats || null,
  }]))
  return {
    profileFields: result?.profile && typeof result.profile === 'object' ? Object.keys(result.profile).length : 0,
    terms: Array.isArray(result?.terms) ? result.terms.length : 0,
    courses: Array.isArray(result?.courses) ? result.courses.length : 0,
    schedule: Array.isArray(result?.schedule) ? result.schedule.length : 0,
    grades: Array.isArray(result?.grades) ? result.grades.length : 0,
    exams: Array.isArray(result?.exams) ? result.exams.length : 0,
    selectedCourses: Array.isArray(result?.selectedCourses) ? result.selectedCourses.length : 0,
    notices: Array.isArray(result?.notices) ? result.notices.length : 0,
    academicProgressCategories: Array.isArray(result?.academicProgress?.categories) ? result.academicProgress.categories.length : 0,
    academicProgressRoots: Array.isArray(result?.academicProgress?.roots) ? result.academicProgress.roots.length : 0,
    academicExtras: extraCounts,
    domainOutcomes: result?.domainOutcomes || {},
    errors: Array.isArray(result?.errors) ? result.errors : [],
  }
}

function diagnostics(event, fields = {}) {
  const safe = { ...fields }
  delete safe.url
  delete safe.referer
  if (safe.error) safe.error = String(safe.error).slice(0, 300)
  process.stdout.write(`[crawl] ${event} ${JSON.stringify(safe)}\n`)
}

async function runBrowserCapture(browserSession) {
  browserSession.setUserAgent(CHROME_UA)
  const client = new SessionClient(browserSession, {
    timeoutMs: 45_000,
    pageLoader: (url, options = {}) => enqueueRendered(() => loadRendered(url, options)),
    formLoader: (url, values, options = {}) => enqueueRendered(() => submitRendered(url, values, options)),
    binaryLoader: (url) => enqueueRendered(() => loadBinaryRendered(url)),
    onDiagnostic: diagnostics,
  })
  const adapter = new JwglxtAdapter(client, {
    attachmentStore: attachmentStore('browser'),
    onDiagnostic: diagnostics,
  })
  const startedAt = new Date().toISOString()
  const startedMs = Date.now()
  const status = await adapter.status()
  const result = await adapter.sync(CRAWL_DOMAINS.length
    ? { domains: CRAWL_DOMAINS }
    : { includeAcademicExtras: true })
  const completedAt = new Date().toISOString()
  return {
    mode: 'authenticated-browser-session-rendered',
    startedAt,
    completedAt,
    elapsedMs: Date.now() - startedMs,
    status: { connected: status.connected, authRequired: Boolean(status.authRequired), error: status.error || null },
    counts: resultCounts(result),
    result,
  }
}

async function seedBrowserSessionFromApi(browserSession, client) {
  const cookies = client?.cookies instanceof Map ? [...client.cookies.entries()] : []
  const existing = await browserSession.cookies.get({ url: BASE }).catch(() => [])
  const sessionNames = new Set(cookies.map(([name]) => String(name)))
  for (const cookie of existing) {
    if (!sessionNames.has(String(cookie.name))) continue
    const host = String(cookie.domain || 'jwglxt.buct.edu.cn').replace(/^\./u, '')
    const path = String(cookie.path || '/').startsWith('/') ? String(cookie.path || '/') : '/'
    await browserSession.cookies.remove(`https://${host}${path}`, cookie.name).catch(() => undefined)
  }
  for (const [name, value] of cookies) {
    if (!name || value === undefined || value === null) continue
    await browserSession.cookies.set({
      url: BASE,
      name: String(name),
      value: String(value),
      secure: true,
    })
  }
  const visible = await browserSession.cookies.get({ url: BASE }).catch(() => [])
  diagnostics('browser_session_seeded_from_api', {
    cookieCount: cookies.length,
    cookieNames: cookies.map(([name]) => String(name)).sort(),
    visibleCookieNames: visible.map((cookie) => `${String(cookie.name)}@${String(cookie.path || '/')}`).sort(),
  })
}

async function runApiCapture(credentials, { afterCapture = null } = {}) {
  const client = new AcademicApiClient({ ...credentials, onDiagnostic: diagnostics })
  const adapter = new JwglxtAdapter(client, {
    academicProgressSource: 'api',
    scheduleEndpoints: ['kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151', 'kbcx/xskbcx_cxXsgrkb.html'],
    attachmentStore: attachmentStore('api'),
    onDiagnostic: diagnostics,
  })
  const startedAt = new Date().toISOString()
  const startedMs = Date.now()
  await client.login()
  const result = await adapter.sync({ includeAcademicExtras: true })
  await afterCapture?.(client)
  const completedAt = new Date().toISOString()
  return {
    mode: 'direct-api-client',
    startedAt,
    completedAt,
    elapsedMs: Date.now() - startedMs,
    counts: resultCounts(result),
    result,
  }
}

async function main() {
  app.setName('THEIA')
  app.setPath('userData', defaultDataRoot())
  app.setPath('sessionData', resolve(app.getPath('userData'), 'session'))
  await app.whenReady()
  await mkdir(CAPTURE_ROOT, { recursive: true })
  const browserSession = session.fromPartition(PARTITION)
  const vault = new AcademicApiVault(app.getPath('userData'), safeStorage)
  const credentialStatus = await vault.status()
  const credentials = credentialStatus.saved && !credentialStatus.error
    ? await vault.readCredentials()
    : null
  const meta = {
    schema: 'theia-live-crawl/v1',
    startedAt: new Date().toISOString(),
    output: CAPTURE_ROOT,
    dataRoot: app.getPath('userData'),
    browserPartition: PARTITION,
  }
  let browser = null
  let browserError = null
  let api = null
  let apiError = null

  try {
    browser = await runBrowserCapture(browserSession)
  } catch (error) {
    browserError = error
    // A previous direct API login can invalidate the shared browser cookie.
    // Re-authenticate through the saved API jar, seed only the hidden browser
    // session, and retry the exact rendered-page capture against live pages.
    if (error?.name !== 'AuthRequiredError' || !credentials) throw error
  }

  if (!browser && credentials) {
    try {
      api = await runApiCapture(credentials, {
        afterCapture: (client) => seedBrowserSessionFromApi(browserSession, client),
      })
      browser = await runBrowserCapture(browserSession)
    } catch (error) {
      apiError = String(error?.message || error)
      if (!browser) throw browserError || error
    }
  } else if (credentials) {
    try {
      api = await runApiCapture(credentials)
    } catch (error) {
      apiError = String(error?.message || error)
    }
  } else {
    apiError = credentialStatus.error || 'saved API credentials are unavailable'
  }

  if (!browser) throw browserError || new Error('rendered browser capture did not produce a result')
  await writeJson(resolve(CAPTURE_ROOT, 'browser-result.json'), browser)
  await writeJson(resolve(CAPTURE_ROOT, 'browser-request-log.json'), requestLog)
  if (api) await writeJson(resolve(CAPTURE_ROOT, 'api-result.json'), api)
  else await writeJson(resolve(CAPTURE_ROOT, 'api-error.json'), { error: apiError })

  await writeJson(resolve(CAPTURE_ROOT, 'comparison.json'), {
    schema: 'theia-live-crawl-comparison/v1',
    capturedAt: new Date().toISOString(),
    browser: { mode: browser.mode, startedAt: browser.startedAt, completedAt: browser.completedAt, elapsedMs: browser.elapsedMs, status: browser.status, counts: browser.counts },
    api: api ? { mode: api.mode, startedAt: api.startedAt, completedAt: api.completedAt, elapsedMs: api.elapsedMs, counts: api.counts } : { error: apiError },
    requestCount: requestLog.length,
  })
  await writeJson(resolve(CAPTURE_ROOT, 'run-meta.json'), {
    ...meta,
    completedAt: new Date().toISOString(),
    browser: { elapsedMs: browser.elapsedMs, requestCount: requestLog.length },
    api: api ? { elapsedMs: api.elapsedMs } : { error: apiError },
    credentialStatus: { saved: Boolean(credentialStatus.saved), encryptionAvailable: Boolean(credentialStatus.encryptionAvailable), error: credentialStatus.error || null },
  })
  if (renderWindow && !renderWindow.isDestroyed()) renderWindow.close()
  await app.quit()
  process.stdout.write(JSON.stringify({ output: CAPTURE_ROOT, browser: browser.counts, api: api?.counts || null, apiError }, null, 2))
}

main().catch(async (error) => {
  await writeJson(resolve(CAPTURE_ROOT, 'fatal-error.json'), { error: String(error?.stack || error) }).catch(() => undefined)
  process.stderr.write(`[crawl] fatal ${String(error?.stack || error)}\n`)
  app.exit(1)
})
