import { app, BrowserWindow, Menu, dialog, ipcMain as electronIpcMain, Notification, protocol, safeStorage, session, shell } from 'electron'
import { appendFile, copyFile, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, extname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { writeAiExport } from '../core/ai-export.mjs'
import { CampusStore } from '../core/store.mjs'
import { AuthRequiredError, MAX_ATTACHMENT_RESPONSE_BYTES, SessionClient } from '../core/source-client.mjs'
import { JwglxtAdapter, JWGLXT_URLS } from '../core/adapters/jwglxt.mjs'
import { AcademicApiFirstAdapter } from '../core/academic-api-adapter.mjs'
import { AcademicApiClient } from '../core/academic-api-client.mjs'
import { TheolAdapter, THEOL_URLS } from '../core/adapters/theol.mjs'
import { TyglAdapter, upgradeTyglRedirectUrl } from '../core/adapters/tygl.mjs'
import { SyncService } from '../core/sync-service.mjs'
import { startLocalApi } from '../core/local-api.mjs'
import { AcademicCalendarAssetsService } from '../core/academic-calendar-assets.mjs'
import { probeAcademicCalendarOcrRuntime } from '../core/academic-calendar-ocr.mjs'
import { collectionCsv, toTheiaFeed, toIcs } from '../core/schema.mjs'
import { cachedFitnessResult, cachedSchoolScheduleResult, SCHOOL_SCHEDULE_PARSER_VERSION } from '../core/data-catalog.mjs'
import {
  failAcademicCalendarCatalog,
  failFitnessCatalog,
  failSchoolScheduleCatalog,
  loadAcademicCalendarCatalog,
  updateAcademicCalendarCatalog,
  updateFitnessCatalog,
  updateSchoolScheduleCatalog,
} from '../core/catalog-provenance.mjs'
import { defaultDataRoot, legacyDataRoot, migrateLegacyDataFiles, rebaseLegacyWorkspacePaths } from '../core/runtime-paths.mjs'
import { parseJwHomepage } from '../core/parsers/jwglxt.mjs'
import { JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES } from '../core/jwglxt-extra.mjs'
import { parseTheolHome } from '../core/parsers/theol.mjs'
import { CredentialVault } from './credential-vault.mjs'
import { AcademicApiVault } from './academic-api-vault.mjs'
import { MailVault } from './mail-vault.mjs'
import { WebmailService } from '../core/webmail-service.mjs'
import { ImapMailService } from '../core/imap-mail-service.mjs'
import { CourseWorkService } from '../core/course-work.mjs'
import { ModelVault } from './model-vault.mjs'
import { ModelService, preferredModel } from './model-service.mjs'
import { recoverModelConfigTransaction, saveModelConfigTransaction } from './model-config-transaction.mjs'
import { ModelProbeTickets } from './model-probe-tickets.mjs'
import { CourseSelectionService } from '../core/course-selection.mjs'
import { CourseSelectionJournal } from '../core/course-selection-journal.mjs'
import {
  isPermittedAppNavigation,
  isPermittedSourceDownloadUrl,
  permittedExternalUrl,
  permittedSourceUrl,
} from '../core/source-url-policy.mjs'
import { renderMarkdownToPdf } from './pdf-renderer.mjs'
import { updateSettingsTransaction } from '../core/settings-transaction.mjs'
import { normalizeModelServiceBaseUrl } from '../core/model-url-policy.mjs'
import { normalizeModelProvider } from '../core/model-provider-policy.mjs'
import { compactError, htmlLooksLikeLogin, sanitizeDiagnosticValue } from '../core/util.mjs'
import { createTrustedIpc } from './ipc-security.mjs'
import { mainRendererCsp } from './renderer-security.mjs'
import { CALENDAR_ASSET_PROTOCOL, academicPlanAssetBaseUrl, calendarAssetUrl, parseCalendarAssetUrl } from './calendar-asset-protocol.mjs'
import { advisorAcademicWhatIfFromStore, advisorCourseDecisionsFromStore, advisorOverviewFromStore } from './advisor-overview-service.mjs'
import { ADVISOR_ACTION_ERROR, advisorActionFailure, assertAdvisorSnapshotRevision, resolveAdvisorActionFromStore } from './advisor-action-service.mjs'
import { AdvisorRuntime } from './advisor-runtime.mjs'
import { AdvisorStore } from './advisor-store.mjs'
import { executeAdvisorNetworkRequest } from './advisor-network.mjs'
import { loadTrustedUpgradeRule } from './advisor-upgrade-rule.mjs'
import {
  registerAdvisorReadIpc,
  registerAppearanceIpc,
  registerCourseSelectionIpc,
  registerCourseWorkQueueIpc,
  registerMailboxIpc,
  registerModelRuntimeIpc,
  registerWindowIpc,
  registerUserDataIpc,
} from './ipc-registration.mjs'
import { createPriorityJobQueue } from './priority-job-queue.mjs'
import { BACKGROUND_PROTOCOL, createAppearanceService } from './appearance-service.mjs'
import { createAuthActorManager } from './auth-actor-manager.mjs'
import { CourseWorkQueue } from '../core/course-work-queue.mjs'
import { JwglxtAttachmentStore } from '../core/jwglxt-attachment-store.mjs'
import { academicPlanDocumentMatches, buildAcademicPlanDocument } from '../core/academic-plan-document.mjs'

const root = resolve(import.meta.dirname, '..')
const PARTITION = 'persist:theia'
const MAIL_PARTITION = 'persist:theia-mail'
const APP_ICON = resolve(import.meta.dirname, 'theia-icon.ico')
const smokeFile = process.env.THEIA_SMOKE_FILE ? resolve(process.env.THEIA_SMOKE_FILE) : null
const inspectionOutput = process.env.THEIA_INSPECT_OUTPUT ? resolve(process.env.THEIA_INSPECT_OUTPUT) : null
const liveCaptureOutput = process.env.THEIA_LIVE_CAPTURE_OUTPUT ? resolve(process.env.THEIA_LIVE_CAPTURE_OUTPUT) : null
const pageCaptureOutput = process.env.THEIA_CAPTURE_OUTPUT
  ? resolve(process.env.THEIA_CAPTURE_OUTPUT)
  : liveCaptureOutput
    ? resolve(liveCaptureOutput, 'browser-responses')
    : null
const theolMobileDiagnosticOutput = process.env.THEIA_EXPORT_THEOL_MOBILE_OUTPUT
  ? resolve(process.env.THEIA_EXPORT_THEOL_MOBILE_OUTPUT)
  : null
app.setName('THEIA')
app.setAppUserModelId('io.github.bakahuiii.theia')
app.setPath('userData', defaultDataRoot())
app.setPath('sessionData', resolve(app.getPath('userData'), 'session'))
const appearanceService = createAppearanceService({
  root: app.getPath('userData'),
  onDiagnostic: (event, fields) => writeDiagnostic(event, fields),
})
protocol.registerSchemesAsPrivileged([
  {
    scheme: BACKGROUND_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
  {
    scheme: CALENDAR_ASSET_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: false,
      corsEnabled: false,
    },
  },
])

function suppressNativeMenu(window) {
  window.setMenuBarVisibility(false)
  window.setAutoHideMenuBar(false)
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Alt') event.preventDefault()
  })
}

app.on('browser-window-created', (_event, window) => suppressNativeMenu(window))

async function handleCalendarAsset(request) {
  const asset = parseCalendarAssetUrl(request.url)
  if (!asset) return new Response('Not found', { status: 404 })
  try {
    let path = null
    if (asset.key === 'academicPlan') {
      const attachment = store?.snapshot()?.academicExtras?.domains?.['academic-plan']?.attachments
        ?.find((item) => item?.id === asset.attachmentId && String(item?.type || '').toLowerCase() === 'pdf')
      const cached = attachment ? await academicAttachmentStore?.find(attachment.id, 'pdf') : null
      path = cached?.path || null
    } else if (academicCalendarAssetsService) {
      path = academicCalendarAssetsService.pathFor(asset.key)
    }
    const contents = path ? await readFile(path) : null
    if (!contents) return new Response('Not found', { status: 404 })
    return new Response(contents, {
      headers: {
        'Content-Type': asset.mediaType,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}

function registerLocalProtocols() {
  protocol.handle(BACKGROUND_PROTOCOL, appearanceService.handleBackgroundAsset)
  protocol.handle(CALENDAR_ASSET_PROTOCOL, handleCalendarAsset)
}

let mainWindow
let mainEntryUrl
let viteServer
let localApi
let store
let syncService
let sessionClient
let academicSessionClient
let schoolSession
let schoolProxyReady = Promise.resolve()
let credentialVault
let academicApiVault
let mailVault
let mailService
let webmailService
let courseWorkService
let courseWorkQueue
let modelVault
let modelService
let advisorRuntime
let advisorThreadStore
let advisorUpgradeRule = null
let courseSelectionService
let courseSelectionJournal
let courseSelectionApiClient
let academicCalendarAssetsService
let academicAttachmentStore
let academicCalendarProbeTimer
// A calendar refresh may run while the renderer is starting. Keep the
// in-flight promise visible so consumers can wait for the first authoritative
// snapshot instead of querying the manifest half-way through a refresh.
let academicCalendarRefreshInFlight = null
let smokeCompleted = false
let requestedExitCode = 0
const modelProbeTickets = new ModelProbeTickets()

const AGENT_FILE_READ_LIMIT = 192 * 1024
const AGENT_FILE_WRITE_LIMIT = 16 * 1024 * 1024
const AGENT_DIRECTORY_ENTRY_LIMIT = 4_000
const AGENT_COMMAND_OUTPUT_LIMIT = 128 * 1024
const AGENT_WEB_RESPONSE_LIMIT = 192 * 1024

function agentPath(value) {
  const raw = String(value ?? '').trim()
  if (!raw || raw.length > 8_192) throw new TypeError('Agent path is invalid')
  return resolve(raw)
}

function agentEncoding(value) {
  if (value === undefined || value === 'utf8' || value === 'utf-8') return 'utf8'
  if (value === 'base64') return 'base64'
  throw new TypeError('Agent file encoding must be utf8 or base64')
}

function agentInteger(value, fallback, minimum, maximum) {
  if (value === undefined) return fallback
  const number = Math.trunc(Number(value))
  if (!Number.isFinite(number)) throw new TypeError('Agent numeric option is invalid')
  return Math.max(minimum, Math.min(maximum, number))
}

function agentWebUrl(value) {
  const raw = String(value ?? '').trim()
  if (!raw || raw.length > 8_192) throw new TypeError('Agent web URL is invalid')
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('Agent web tools require an HTTP(S) URL')
  return url
}

function appendAgentOutput(chunks, value, state) {
  if (!value || state.truncated) return
  const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
  const remaining = AGENT_COMMAND_OUTPUT_LIMIT - state.bytes
  if (remaining <= 0) {
    state.truncated = true
    return
  }
  if (chunk.length > remaining) {
    chunks.push(chunk.subarray(0, remaining))
    state.bytes += remaining
    state.truncated = true
    return
  }
  chunks.push(chunk)
  state.bytes += chunk.length
}

async function readAgentWebBody(response, responseType) {
  const chunks = []
  let size = 0
  let truncated = false
  const reader = response.body?.getReader?.()
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = Buffer.from(value)
        const remaining = AGENT_WEB_RESPONSE_LIMIT - size
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
  }
  const body = Buffer.concat(chunks)
  return {
    body: responseType === 'base64' ? body.toString('base64') : body.toString('utf8'),
    encoding: responseType === 'base64' ? 'base64' : 'utf8',
    bytes: size,
    truncated,
  }
}

async function readAgentFile({ path, encoding, offset, length } = {}) {
  const target = agentPath(path)
  const selectedEncoding = agentEncoding(encoding)
  const details = await stat(target)
  if (!details.isFile()) throw new TypeError('Agent read_file target is not a file')
  const start = agentInteger(offset, 0, 0, Math.max(0, details.size))
  const requested = agentInteger(length, AGENT_FILE_READ_LIMIT, 1, AGENT_FILE_READ_LIMIT)
  const bytes = Math.max(0, Math.min(requested, details.size - start))
  const handle = await open(target, 'r')
  try {
    const buffer = Buffer.alloc(bytes)
    const { bytesRead } = await handle.read(buffer, 0, bytes, start)
    const content = buffer.subarray(0, bytesRead).toString(selectedEncoding)
    return {
      path: target,
      encoding: selectedEncoding,
      content,
      bytesRead,
      size: details.size,
      truncated: start + bytesRead < details.size,
    }
  } finally {
    await handle.close()
  }
}

async function writeAgentFile({ path, content, encoding, createDirectories } = {}) {
  const target = agentPath(path)
  const selectedEncoding = agentEncoding(encoding)
  if (typeof content !== 'string') throw new TypeError('Agent write_file content must be text')
  const data = Buffer.from(content, selectedEncoding)
  if (data.length > AGENT_FILE_WRITE_LIMIT) throw new TypeError('Agent write_file content is too large')
  if (createDirectories === true) await mkdir(dirname(target), { recursive: true })
  await writeFile(target, data)
  return { path: target, bytesWritten: data.length, encoding: selectedEncoding }
}

async function listAgentDirectory({ path, recursive, maxEntries } = {}) {
  const target = agentPath(path)
  const limit = agentInteger(maxEntries, 500, 1, AGENT_DIRECTORY_ENTRY_LIMIT)
  const entries = []
  const pending = [{ path: target, relative: '' }]
  while (pending.length && entries.length < limit) {
    const current = pending.shift()
    const children = await readdir(current.path, { withFileTypes: true })
    for (const child of children) {
      if (entries.length >= limit) break
      const relative = current.relative ? `${current.relative}\\${child.name}` : child.name
      const fullPath = resolve(current.path, child.name)
      const type = child.isDirectory() ? 'directory' : child.isFile() ? 'file' : child.isSymbolicLink() ? 'symlink' : 'other'
      entries.push({ path: fullPath, relativePath: relative, type })
      if (recursive === true && child.isDirectory()) pending.push({ path: fullPath, relative })
    }
  }
  return { path: target, entries, truncated: pending.length > 0 || entries.length >= limit }
}

async function createAgentDirectory({ path, recursive } = {}) {
  const target = agentPath(path)
  await mkdir(target, { recursive: recursive !== false })
  return { path: target, created: true }
}

async function deleteAgentPath({ path, recursive } = {}) {
  const target = agentPath(path)
  await rm(target, { recursive: recursive === true, force: true })
  return { path: target, deleted: true, recursive: recursive === true }
}

function runAgentCommand({ command, cwd, timeoutMs, signal } = {}) {
  const script = String(command ?? '').trim()
  if (!script || script.length > 32_000) return Promise.reject(new TypeError('Agent command is invalid'))
  const workdir = cwd === undefined ? process.cwd() : agentPath(cwd)
  const timeout = agentInteger(timeoutMs, 300_000, 1_000, 3_600_000)
  const executable = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh'
  const args = process.platform === 'win32'
    ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]
    : ['-lc', script]
  return new Promise((resolveCommand, rejectCommand) => {
    let completed = false
    let timedOut = false
    const stdout = []
    const stderr = []
    const stdoutState = { bytes: 0, truncated: false }
    const stderrState = { bytes: 0, truncated: false }
    const child = spawn(executable, args, { cwd: workdir, windowsHide: true })
    const finish = (callback) => {
      if (completed) return
      completed = true
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      callback()
    }
    const onAbort = () => {
      try { child.kill() } catch { /* The child may already be gone. */ }
      finish(() => rejectCommand(signal?.reason || new Error('Agent command was cancelled')))
    }
    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill() } catch { /* The child may already be gone. */ }
    }, timeout)
    child.stdout?.on('data', (value) => appendAgentOutput(stdout, value, stdoutState))
    child.stderr?.on('data', (value) => appendAgentOutput(stderr, value, stderrState))
    child.once('error', (error) => finish(() => rejectCommand(error)))
    child.once('close', (exitCode, closeSignal) => finish(() => resolveCommand({
      command: script,
      cwd: workdir,
      exitCode,
      signal: closeSignal || null,
      timedOut,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
      outputTruncated: stdoutState.truncated || stderrState.truncated,
    })))
    if (signal?.aborted) onAbort()
    else signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

async function executeAgentWebRequest({ url, method, headers, body, responseType, signal } = {}) {
  const target = agentWebUrl(url)
  const normalizedMethod = String(method || 'GET').trim().toUpperCase()
  const requestHeaders = headers && typeof headers === 'object' && !Array.isArray(headers) ? headers : undefined
  const requestBody = body === undefined || body === null ? undefined : String(body)
  const response = await fetch(target, {
    method: normalizedMethod,
    headers: requestHeaders,
    ...(requestBody === undefined ? {} : { body: requestBody }),
    redirect: 'follow',
    signal,
  })
  const payload = await readAgentWebBody(response, responseType === 'base64' ? 'base64' : 'utf8')
  return {
    url: response.url || target.toString(),
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    headers: Object.fromEntries(response.headers.entries()),
    ...payload,
  }
}

async function openAgentWebpage({ url } = {}) {
  const target = agentWebUrl(url)
  await shell.openExternal(target.toString())
  return { opened: true, url: target.toString() }
}

const SYNC_DOMAIN_TARGETS = Object.freeze({
  profile: { source: 'jwglxt', domain: 'profile' },
  terms: { source: 'jwglxt', domain: 'terms' },
  schedule: { source: 'jwglxt', domain: 'schedule' },
  exams: { source: 'jwglxt', domain: 'exams' },
  grades: { source: 'jwglxt', domain: 'grades' },
  'selected-courses': { source: 'jwglxt', domain: 'selected-courses' },
  'academic-progress': { source: 'jwglxt', domain: 'academic-progress' },
  'jwglxt-courses': { source: 'jwglxt', domain: 'courses' },
  'jwglxt-notices': { source: 'jwglxt', domain: 'notices' },
  'theol-courses': { source: 'theol', domain: 'courses' },
  'theol-notices': { source: 'theol', domain: 'notices' },
  'academic-extras': { source: 'jwglxt', domain: 'academic-extras' },
  ...Object.fromEntries(JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES.map((domain) => [domain, { source: 'jwglxt', domain }])),
})

const SILENT_AUTH_SYNC_DOMAINS = Object.freeze({
  // A saved browser session is still a valid data source. Reusing its cookie
  // must not turn startup into a no-op: refresh the same primary domains as a
  // foreground run so existing local records are revalidated and replaced.
  jwglxt: Object.freeze([
    'profile', 'terms', 'courses', 'schedule', 'grades', 'exams',
    'selected-courses', 'academic-progress', 'notices',
  ]),
  theol: Object.freeze(['courses', 'notices']),
})

// A foreground refresh owns the data users use immediately. Slow, low-change
// pages are hydrated separately after the window is usable and never block
// this request.
const FOREGROUND_JWGLXT_SYNC_DOMAINS = Object.freeze([
  'profile', 'terms', 'courses', 'schedule', 'grades', 'exams',
  'selected-courses', 'academic-progress', 'notices',
])
// The plan preview is one bounded, nearly immutable artifact. Grade details
// expand into many year/term requests and remain an explicit user action; once
// read, they are retained in CampusStore just like every other domain.
const STATIC_ACADEMIC_PREFETCH_DOMAINS = Object.freeze(['academic-plan'])
const ACADEMIC_STATIC_PREFETCH_DELAY_MS = 3_000
let academicStaticPrefetchTimer = null
let academicStaticPrefetchInFlight = null

function syncForegroundCampusData() {
  const startedAt = Date.now()
  const run = (async () => {
    await writeDiagnostic('sync.foreground_started', {
      domains: FOREGROUND_JWGLXT_SYNC_DOMAINS,
      sources: ['jwglxt', 'theol'],
    })
    await Promise.all([
      syncService.syncNow({ sources: ['jwglxt'], domains: FOREGROUND_JWGLXT_SYNC_DOMAINS, foreground: true }),
      syncService.syncNow({ sources: ['theol'], domains: ['courses', 'notices'], foreground: true }),
    ])
    const snapshot = store.snapshot()
    // onChange normally sends the terminal snapshot. Sending once more here
    // makes the IPC request itself authoritative even if a renderer missed the
    // final progress notification during startup.
    sendSnapshot()
    await writeDiagnostic('sync.foreground_finished', {
      elapsedMs: Date.now() - startedAt,
      runId: snapshot.sync?.runId || null,
      lastCompletedAt: snapshot.sync?.lastCompletedAt || null,
      lastError: snapshot.sync?.lastError || null,
    })
    return snapshot
  })()
  return run.catch(async (error) => {
    await writeDiagnostic('sync.foreground_failed', {
      elapsedMs: Date.now() - startedAt,
      error: diagnosticError(error),
    })
    throw error
  })
}

async function syncAdvisorCampusData({ domains } = {}) {
  const requested = Array.isArray(domains) && domains.length ? [...new Set(domains)] : null
  if (!requested) {
    const snapshot = await syncForegroundCampusData()
    return {
      scope: 'foreground',
      refreshedDomains: [...FOREGROUND_JWGLXT_SYNC_DOMAINS, 'theol-courses', 'theol-notices'],
      updatedAt: snapshot.updatedAt || null,
      revision: store.snapshotWithRevision({ clone: false }).revision,
    }
  }
  const grouped = new Map()
  for (const domain of requested) {
    const target = SYNC_DOMAIN_TARGETS[domain]
    if (!target) throw new Error(`Agent cannot synchronize unsupported domain: ${domain}`)
    const entry = grouped.get(target.source) || []
    entry.push(target.domain)
    grouped.set(target.source, entry)
  }
  await Promise.all([...grouped.entries()].map(([source, sourceDomains]) => (
    syncService.syncNow({ sources: [source], domains: [...new Set(sourceDomains)], foreground: true })
  )))
  const snapshot = store.snapshot()
  sendSnapshot()
  return {
    scope: 'selected',
    refreshedDomains: requested,
    updatedAt: snapshot.updatedAt || null,
    revision: store.snapshotWithRevision({ clone: false }).revision,
  }
}

async function waitForSyncIdle(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (syncService?.hasActiveSync?.() && Date.now() < deadline) {
    const active = syncService.active
    if (active) {
      await Promise.race([
        Promise.resolve(active).catch(() => undefined),
        new Promise((resolveWait) => setTimeout(resolveWait, 500)),
      ])
    } else {
      await new Promise((resolveWait) => setTimeout(resolveWait, 250))
    }
  }
  return !syncService?.hasActiveSync?.()
}

async function prefetchAcademicStaticData({ reason = 'authenticated' } = {}) {
  if (!syncService || !academicAttachmentStore || explicitlyLoggedOut) return
  let apiReady = false
  if (store.snapshot().settings.academicApiEnabled && academicApiVault?.status) {
    apiReady = Boolean((await academicApiVault.status().catch(() => ({ saved: false }))).saved)
  }
  if (!verifiedSessions.jwglxt && !apiReady) return
  const initial = store.snapshot()
  const domains = initial.academicExtras?.domains || {}
  const plan = domains['academic-plan']
  // A captured plan without a verified local PDF is still incomplete. This
  // covers old snapshots that stored only the rendered page metadata and
  // prevents the UI from claiming the plan is locally available when the
  // attachment was never written or was later removed.
  const planAttachmentMissing = !Array.isArray(plan?.attachments)
    || !plan.attachments.some((attachment) => attachment?.id && attachment?.cached === true)
  const missing = []
  if (!plan?.capturedAt || planAttachmentMissing) missing.push('academic-plan')
  if (!missing.length) {
    void writeDiagnostic('sync.static_prefetch_skipped', { reason, cause: 'cache_healthy' })
    return
  }
  for (const domain of STATIC_ACADEMIC_PREFETCH_DOMAINS) {
    if (!missing.includes(domain) || explicitlyLoggedOut || (!verifiedSessions.jwglxt && !apiReady)) continue
    // Do not compete with an active foreground run. Wait for its commit so a
    // concurrent THEOL login does not permanently prevent static hydration.
    if (!(await waitForSyncIdle())) {
      void writeDiagnostic('sync.static_prefetch_deferred', { domain, reason: 'foreground_sync_active' })
      return
    }
    try {
      void writeDiagnostic('sync.static_prefetch_started', { domain, reason })
      await syncService.syncNow({ sources: ['jwglxt'], domains: [domain] })
      void writeDiagnostic('sync.static_prefetch_finished', { domain, reason })
    } catch (error) {
      void writeDiagnostic('sync.static_prefetch_failed', { domain, reason, error: diagnosticError(error) })
      return
    }
  }
}

function scheduleAcademicStaticPrefetch({ reason = 'authenticated' } = {}) {
  if (academicStaticPrefetchTimer || academicStaticPrefetchInFlight || explicitlyLoggedOut) return
  academicStaticPrefetchTimer = setTimeout(() => {
    academicStaticPrefetchTimer = null
    academicStaticPrefetchInFlight = prefetchAcademicStaticData({ reason })
      .catch((error) => writeDiagnostic('sync.static_prefetch_failed', { reason, error: diagnosticError(error) }))
      .finally(() => { academicStaticPrefetchInFlight = null })
  }, ACADEMIC_STATIC_PREFETCH_DELAY_MS)
}

const ipcMain = createTrustedIpc({
  ipcMain: electronIpcMain,
  getMainWindow: () => mainWindow,
  getEntryUrl: () => mainEntryUrl,
  onDenied: ({ channel, error }) => {
    void writeDiagnostic('ipc.denied', { channel, error })
  },
})
let shutdownPromise = null
let shutdownComplete = false
let syncPageWindow
const syncPageQueue = createPriorityJobQueue()
let fitnessPageWindow
const fitnessPageQueue = createPriorityJobQueue()
let pageCaptureIndex = 0
const pageCaptureLog = []
const preloadErrors = []
const verifiedSessions = { jwglxt: null, theol: null, tygl: null }
const academicAttachmentRepairs = new Map()

async function repairAcademicAttachment(attachment, { domain, expectedEpoch }) {
  if (!academicSessionClient || !academicAttachmentStore) throw new Error('教务附件服务尚未就绪')
  assertAuthEpoch(expectedEpoch)
  const sourceUrl = String(attachment?.sourceUrl || '').trim()
  if (!sourceUrl) throw new Error('官方培养计划缺少来源地址')
  const browserVerified = Boolean(await verifiedStatus('jwglxt'))
  let result = null
  let lastError = null
  const tryClient = async (client) => {
    if (!client || result) return
    try {
      result = await client.binary(sourceUrl, {
        source: '教务系统官方培养计划 PDF',
        maxBytes: MAX_ATTACHMENT_RESPONSE_BYTES,
      })
    } catch (error) {
      lastError = error
    }
    assertAuthEpoch(expectedEpoch)
  }
  // A verified browser session is the fastest path and avoids waiting for an
  // unrelated API login before showing an already-local user's document.
  if (browserVerified) await tryClient(academicSessionClient)
  if (!result && store.snapshot().settings.academicApiEnabled) {
    const credentials = academicApiVault?.readCredentials
      ? await academicApiVault.readCredentials().catch(() => null)
      : null
    if (credentials) {
      try {
        const apiClient = new AcademicApiClient(credentials)
        await apiClient.login()
        await tryClient(apiClient)
      } catch (error) {
        lastError = error
        void writeDiagnostic('jwglxt.attachment_api_login_failed', { error: diagnosticError(error) })
      }
    }
  }
  if (!result && !browserVerified) await tryClient(academicSessionClient)
  // A missing/expired browser session is the only case where authentication
  // is a useful retry. Keep it on the same foreground action: saved
  // credentials remain hidden, while a missing credential deliberately opens
  // the manual fallback window instead of sending the user to a login URL.
  if (!result && (lastError instanceof AuthRequiredError || Number(lastError?.code) === 1006)) {
    const browserAdapter = syncService?.jwglxt
    let browserStatus = { connected: false }
    try {
      if (typeof browserAdapter?.browserStatus === 'function') browserStatus = await browserAdapter.browserStatus()
      else if (typeof browserAdapter?.browserAdapter?.status === 'function') browserStatus = await browserAdapter.browserAdapter.status()
      else if (typeof browserAdapter?.status === 'function') browserStatus = await browserAdapter.status()
    } catch {
      browserStatus = { connected: false }
    }
    if (browserStatus?.connected) {
      await rememberVerifiedSession('jwglxt', browserStatus.url || sourceUrl, expectedEpoch)
    } else {
      const credentials = await credentialVault.status().catch(() => ({ saved: false }))
      const actors = await openLoginWindow({
        background: Boolean(credentials?.saved),
        sources: ['jwglxt'],
        expectedEpoch,
        requireBrowser: true,
        skipSync: true,
      })
      const actor = actors?.find?.((candidate) => candidate?.source === 'jwglxt')
      if (actor?.lifecycle) await actor.lifecycle
      assertAuthEpoch(expectedEpoch)
      if (!actor?.authenticated) throw lastError
    }
    try {
      result = await academicSessionClient.binary(sourceUrl, {
        source: '教务系统官方培养计划 PDF',
        maxBytes: MAX_ATTACHMENT_RESPONSE_BYTES,
      })
    } catch (error) {
      lastError = error
    }
  }
  if (!result) throw lastError || new Error('教务附件下载失败')
  assertAuthEpoch(expectedEpoch)
  const buffer = Buffer.isBuffer(result?.buffer) ? result.buffer : Buffer.from(result?.buffer || '')
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('教务系统返回的不是有效 PDF，未写入本地')
  }
  const saved = await academicAttachmentStore.save({ id: attachment.id, extension: 'pdf', buffer, exclusive: true })
  assertAuthEpoch(expectedEpoch)
  await store.update((state) => {
    const currentDomain = state.academicExtras?.domains?.[domain]
    if (!currentDomain) return state
    const attachments = (currentDomain.attachments || []).map((item) => item?.id === attachment.id
      ? {
        ...item,
        sourceUrl: result?.url || item.sourceUrl,
        type: 'pdf',
        cached: true,
        bytes: saved.bytes,
        sha256: saved.sha256 || null,
        filename: saved.filename || null,
      }
      : item)
    return {
      ...state,
      academicExtras: {
        ...state.academicExtras,
        domains: {
          ...state.academicExtras.domains,
          [domain]: { ...currentDomain, attachments },
        },
      },
    }
  })
  if (domain === 'academic-plan') await refreshAcademicPlanDocument()
  sendSnapshot()
  void writeDiagnostic('jwglxt.attachment_repaired', {
    domain,
    attachmentId: attachment.id,
    bytes: saved.bytes,
  })
  return saved
}

async function refreshAcademicPlanDocument() {
  if (!store || !academicAttachmentStore) return null
  const state = store.snapshot()
  const attachment = state.academicExtras?.domains?.['academic-plan']?.attachments
    ?.find((item) => item?.id && String(item?.type || '').toLowerCase() === 'pdf')
  const clear = async () => {
    if (!store.snapshot().academicPlanDocument) return null
    await store.update((current) => ({ ...current, academicPlanDocument: null }))
    return null
  }
  if (!attachment) return clear()
  const cached = await academicAttachmentStore.find(attachment.id, 'pdf')
  if (!cached) return clear()
  try {
    const document = await buildAcademicPlanDocument({ attachment, path: cached.path })
    if (academicPlanDocumentMatches(state.academicPlanDocument, {
      attachmentId: document.sourceAttachmentId,
      sha256: document.sourceSha256,
      bytes: document.sourceBytes,
    })) return state.academicPlanDocument
    await store.update((current) => {
      const currentAttachment = current.academicExtras?.domains?.['academic-plan']?.attachments
        ?.find((item) => item?.id === attachment.id && String(item?.type || '').toLowerCase() === 'pdf')
      if (!currentAttachment) return current
      return { ...current, academicPlanDocument: document }
    })
    void writeDiagnostic('jwglxt.academic_plan_document_refreshed', {
      attachmentId: document.sourceAttachmentId,
      bytes: document.sourceBytes,
      pages: document.pageCount,
      sha256: document.sourceSha256,
    })
    return document
  } catch (error) {
    await clear()
    void writeDiagnostic('jwglxt.academic_plan_document_failed', { error: diagnosticError(error) })
    return null
  }
}

async function normalizeAcademicPlanAttachmentCache() {
  if (!store || !academicAttachmentStore) return
  const domain = store.snapshot().academicExtras?.domains?.['academic-plan']
  const attachment = domain?.attachments?.find((item) => item?.id && String(item?.type || '').toLowerCase() === 'pdf')
  if (!attachment) {
    await academicAttachmentStore.prunePdfFiles()
    await refreshAcademicPlanDocument()
    return
  }
  const existing = await academicAttachmentStore.find(attachment.id, 'pdf')
  if (!existing && attachment.cached !== true) {
    await academicAttachmentStore.prunePdfFiles()
    await refreshAcademicPlanDocument()
    return
  }
  await academicAttachmentStore.keepOnly({ id: attachment.id, extension: 'pdf' })
  const cached = await academicAttachmentStore.find(attachment.id, 'pdf')
  if (cached) {
    if (attachment.cached === true && attachment.bytes === cached.bytes && attachment.filename === cached.filename) {
      await refreshAcademicPlanDocument()
      return
    }
    await store.update((state) => {
      const current = state.academicExtras?.domains?.['academic-plan']
      if (!current) return state
      return {
        ...state,
        academicExtras: {
          ...state.academicExtras,
          domains: {
            ...state.academicExtras.domains,
            'academic-plan': {
              ...current,
              attachments: (current.attachments || []).map((item) => item?.id === attachment.id
                ? { ...item, cached: true, bytes: cached.bytes, filename: cached.filename }
                : item),
            },
          },
        },
      }
    })
    await refreshAcademicPlanDocument()
    return
  }
  if (attachment.cached !== true) return
  await store.update((state) => {
    const current = state.academicExtras?.domains?.['academic-plan']
    if (!current) return state
    return {
      ...state,
      academicExtras: {
        ...state.academicExtras,
        domains: {
          ...state.academicExtras.domains,
          'academic-plan': {
            ...current,
            completeness: 'partial',
            attachments: (current.attachments || []).map((item) => item?.id === attachment.id
              ? { ...item, cached: false, bytes: null, sha256: null, filename: null }
              : item),
          },
        },
      },
    }
  })
  await refreshAcademicPlanDocument()
}

function refreshAcademicCalendarAssets({ force = false, trigger = 'scheduled' } = {}) {
  if (academicCalendarRefreshInFlight) return academicCalendarRefreshInFlight
  if (!force && academicCalendarAssetsService && !academicCalendarAssetsService.needsRefresh()) {
    void writeDiagnostic('academic_calendar.refresh_skipped', { trigger, reason: 'cache_healthy' })
    return Promise.resolve(academicCalendarAssetsService.snapshot())
  }
  const run = (async () => {
  const startedAt = Date.now()
  const attemptedAt = new Date(startedAt).toISOString()
  const runId = randomUUID()
  try {
    const manifest = await academicCalendarAssetsService.refresh({ force })
    const completedAt = new Date().toISOString()
    await store.update((state) => updateAcademicCalendarCatalog(state, { manifest, runId, attemptedAt, completedAt }))
    sendSnapshot()
    void writeDiagnostic('academic_calendar.refresh_finished', {
      trigger,
      force,
      elapsedMs: Date.now() - startedAt,
      schoolYear: manifest.calendar?.schoolYear || null,
      assets: Object.keys(manifest.assets || {}).length,
    })
    return manifest
  } catch (error) {
    const completedAt = new Date().toISOString()
    await store.update((state) => failAcademicCalendarCatalog(state, {
      runId,
      attemptedAt,
      completedAt,
      errorCode: 'academic_calendar_refresh_failed',
    }))
    sendSnapshot()
    throw error
  }
  })()
  academicCalendarRefreshInFlight = run
  return run.finally(() => {
    if (academicCalendarRefreshInFlight === run) academicCalendarRefreshInFlight = null
  })
}
const credentialAttempts = new Map()
const sourceWindows = new Set()
const pendingSourceOpens = []
let diagnosticWrite = Promise.resolve()
let feedWrite = Promise.resolve()
let explicitlyLoggedOut = false
let authEpoch = 0
const AUTH_SOURCES = ['jwglxt', 'theol', 'tygl']
let theolInteractiveActor = null
const authRecovery = Object.fromEntries(AUTH_SOURCES.map((source) => [source, {
  lastAt: 0,
  inFlight: false,
  failures: 0,
}]))
const statusChecks = { jwglxt: null, theol: null }
const forceSourceStatusChecks = new Set()
// CAS establishes a shared identity, but each campus application still needs
// its own authenticated page check. Keep that short verification window
// explicit so the renderer does not turn the hand-off between the two services
// into a misleading yellow "not logged in" state.
let unifiedAuthVerification = null
const UNIFIED_AUTH_VERIFY_WAIT_MS = 30_000
const UNIFIED_AUTH_VERIFY_RETRY_DELAY_MS = 350
const AUTH_RECOVERY_COOLDOWN_MS = 60_000
const AUTH_RECOVERY_MAX_ATTEMPTS = 3
// A saved-password background login should be invisible when healthy, but a
// broken/changed CAS page must hand control back to the user promptly.
const AUTH_BACKGROUND_TIMEOUT_MS = 20_000
// CAS invalidates or overwrites the shared browser session when two campus
// entry points authenticate at once. The actor manager serializes lifecycles
// globally while keeping source-specific browser behavior in this process.
const authActorManager = createAuthActorManager({
  sources: AUTH_SOURCES,
  getEpoch: () => authEpoch,
  isExplicitlyLoggedOut: () => explicitlyLoggedOut,
  run: (actor) => runAuthActor(actor),
  finish: (actor) => finishAuthActor(actor),
  onFailure: (error, actor) => {
    if (!actor.invalidated && actor.epoch === authEpoch) {
      void writeDiagnostic('auth.actor_failed', { source: actor.source, error: diagnosticError(error) })
    }
  },
  createActor: (source, options) => ({
    ...options,
    source,
    pollTimer: null,
    pollActive: false,
    timeoutTimer: null,
    credentialTimers: new Set(),
    lastPollError: null,
    resumeAssignments: null,
    sessionReused: false,
    userInitiated: Boolean(options.userInitiated),
    requireBrowser: Boolean(options.requireBrowser),
    skipSync: Boolean(options.skipSync),
  }),
})
const authActors = authActorManager.actors
const authPendingSources = authActorManager.pendingSources

function schoolScheduleArchiveTerms() {
  const snapshot = store?.snapshot()
  const admissionYear = Number.parseInt(String(snapshot?.profile?.studentId || '').slice(0, 4), 10)
  const firstYear = Number.isInteger(admissionYear) ? admissionYear : 2000
  return (snapshot?.terms || [])
    .filter((term) => Number(term?.year) >= firstYear)
    .sort((left, right) => Number(left.year) - Number(right.year) || String(left.term).localeCompare(String(right.term)))
}

async function scanSchoolScheduleArchive({ force = false } = {}) {
  const terms = schoolScheduleArchiveTerms()
  await writeDiagnostic('school_schedule.archive_started', { terms: terms.map((term) => term.id) })
  const outcomes = []
  for (const term of terms) {
    const cached = cachedSchoolScheduleResult(store.snapshot().dataCatalog, { termId: term.id })
    if (!force && cached?.complete && cached.parserVersion === SCHOOL_SCHEDULE_PARSER_VERSION) {
      outcomes.push({ termId: term.id, status: 'cached', count: cached.total })
      await writeDiagnostic('school_schedule.archive_skipped', { termId: term.id, count: cached.total })
      continue
    }
    const startedAt = Date.now()
    await writeDiagnostic('school_schedule.archive_term_started', { termId: term.id })
    try {
      const result = await schoolScheduleWithProvenance({ termId: term.id, forceRefresh: force })
      outcomes.push({ termId: term.id, status: result.complete ? 'complete' : 'incomplete', count: result.total })
      await writeDiagnostic('school_schedule.archive_term_finished', {
        termId: term.id,
        complete: result.complete === true,
        count: result.total,
        elapsedMs: Date.now() - startedAt,
      })
    } catch (error) {
      outcomes.push({ termId: term.id, status: 'failed' })
      await writeDiagnostic('school_schedule.archive_term_failed', { termId: term.id, error: diagnosticError(error), elapsedMs: Date.now() - startedAt })
    }
  }
  await writeDiagnostic('school_schedule.archive_finished', { outcomes })
  return outcomes
}

async function schoolScheduleWithProvenance(query = {}) {
  const attemptedAt = new Date().toISOString()
  const runId = randomUUID()
  try {
    return await courseSelectionService.schoolSchedule(query)
  } catch (error) {
    const completedAt = new Date().toISOString()
    await store.update((state) => failSchoolScheduleCatalog(state, {
      runId,
      attemptedAt,
      completedAt,
      status: isAuthenticationFailure(error) ? 'auth-required' : 'failed',
      errorCode: isAuthenticationFailure(error) ? 'school_schedule_auth_required' : 'school_schedule_read_failed',
    }))
    sendSnapshot()
    throw error
  }
}

function diagnosticUrl(rawUrl) {
  if (!rawUrl) return null
  try {
    const url = new URL(String(rawUrl))
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return '[invalid-url]'
  }
}

function diagnosticError(error) {
  return compactError(error).slice(0, 500)
}

function userFacingInstant(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return new Date().toISOString()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((result, part) => {
    result[part.type] = part.value
    return result
  }, {})
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+08:00`
}

function writeDiagnostic(event, fields = {}) {
  const safeFields = sanitizeDiagnosticValue(fields)
  const record = JSON.stringify({ at: userFacingInstant(), event, ...safeFields }) + '\n'
  const file = resolve(app.getPath('userData'), 'auth-diagnostics.ndjson')
  diagnosticWrite = diagnosticWrite
    .catch(() => {})
    .then(async () => {
      await mkdir(resolve(app.getPath('userData')), { recursive: true })
      await appendFile(file, record, 'utf8')
    })
  return diagnosticWrite
}

async function courseSelectionApiSession({ refresh = false } = {}) {
  if (!store?.snapshot().settings.academicApiEnabled) {
    throw new Error('请先在“数据与接口”中启用教务系统 API，再使用 API 抢课')
  }
  if (!refresh && courseSelectionApiClient) return courseSelectionApiClient
  const credentials = await academicApiVault?.readCredentials()
  if (!credentials) throw new Error('请先在“数据与接口”中保存教务系统 API 账号和密码')
  const client = new AcademicApiClient(credentials)
  const startedAt = Date.now()
  await client.login()
  courseSelectionApiClient = client
  void writeDiagnostic('course_selection.api_session_ready', { elapsedMs: Date.now() - startedAt })
  return client
}

function queueTheiaFeed(snapshot) {
  const destination = resolve(app.getPath('userData'), 'theia-feed.json')
  const content = `${JSON.stringify(toTheiaFeed(snapshot), null, 2)}\n`
  feedWrite = feedWrite
    .catch(() => {})
    .then(async () => {
      await mkdir(dirname(destination), { recursive: true })
      const temporary = `${destination}.${randomUUID()}.tmp`
      await writeFile(temporary, content, 'utf8')
      await rm(destination, { force: true })
      await rename(temporary, destination)
    })
  void feedWrite.catch((error) => writeDiagnostic('data.feed_write_failed', { error: diagnosticError(error) }))
  return feedWrite
}

async function recentActivityLog(limit = 80) {
  const file = resolve(app.getPath('userData'), 'auth-diagnostics.ndjson')
  const raw = await readFile(file, 'utf8').catch(() => '')
  return raw.split(/\r?\n/).filter(Boolean).slice(-Math.max(1, Math.min(300, Number(limit) || 80))).flatMap((line) => {
    try {
      const record = JSON.parse(line)
      if (!record?.at || !record?.event) return []
      return [{ at: String(record.at), event: String(record.event), raw: line }]
    } catch {
      return []
    }
  }).reverse()
}

async function finishSmoke(result) {
  if (!smokeFile || smokeCompleted) return
  smokeCompleted = true
  const report = {
    schema: 'theia-packaged-smoke/v1',
    ...result,
    preloadErrors,
    versions: process.versions,
    checkedAt: new Date().toISOString(),
  }
  await writeFile(smokeFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  requestedExitCode = result.ok ? 0 : 1
  app.quit()
}

function sourceWindowOptions({ title, width = 1200, height = 820, show = true, partition = PARTITION } = {}) {
  return {
    title,
    width,
    height,
    autoHideMenuBar: false,
    icon: APP_ICON,
    show,
    backgroundColor: '#f4f7f6',
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  }
}

async function createMailBrowserWindow({ show = false } = {}) {
  return new BrowserWindow(sourceWindowOptions({
    title: 'THEIA · 校园邮箱',
    width: 1180,
    height: 800,
    show,
    partition: MAIL_PARTITION,
  }))
}

function sendSnapshot() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('theia:snapshot', store.snapshot())
}

function sendCourseSelectionSnapshot() {
  if (!mainWindow || mainWindow.isDestroyed() || !courseSelectionService) return
  mainWindow.webContents.send('theia:course-selection', courseSelectionSnapshot())
}

function courseSelectionSnapshot() {
  const journal = courseSelectionJournal?.snapshot() || { targets: [], updatedAt: null }
  return {
    ...courseSelectionService.snapshot(),
    target: journal.target || null,
    targets: journal.targets || [],
    sentinel: journal.sentinel || { enabled: false, startAt: null, endAt: null, intervalMs: 3_000, concurrency: 2, completedTargetIds: [] },
    recordUpdatedAt: journal.updatedAt || null,
  }
}

async function armCourseSelectionSentinel() {
  const record = courseSelectionJournal?.snapshot()
  const sentinel = record?.sentinel
  if (!courseSelectionService || !sentinel?.enabled) return courseSelectionSnapshot()
  if (!sentinel.startAt || !sentinel.endAt || Date.now() >= new Date(sentinel.endAt).getTime()) {
    await courseSelectionJournal.setSentinel({ enabled: false })
    return courseSelectionSnapshot()
  }
  const complete = new Set(sentinel.completedTargetIds || [])
  const targets = (record.targets || []).filter((target) => target?.id && !complete.has(target.id))
  if (!targets.length) return courseSelectionSnapshot()
  courseSelectionService.start({
    targets,
    startAt: sentinel.startAt,
    endAt: sentinel.endAt,
    intervalMs: sentinel.intervalMs,
    maxAttempts: 1_000_000,
    concurrency: sentinel.concurrency,
    sentinel: true,
  })
  return courseSelectionSnapshot()
}

function sourceSessionUrl(source) {
  if (source === 'jwglxt') return JWGLXT_URLS.base
  if (source === 'tygl') return 'https://tygl.buct.edu.cn/'
  return THEOL_URLS.base
}

async function inspectAuthenticatedPages() {
  if (!inspectionOutput) return
  const targets = {
    theolPersonal: 'https://course.buct.edu.cn/meol/personal.do',
    theolWelcome: 'https://course.buct.edu.cn/meol/welcomepage/student/index.jsp',
    jwHome: 'https://jwglxt.buct.edu.cn/jwglxt/xtgl/index_initMenu.html',
    jwSchedule: 'https://jwglxt.buct.edu.cn/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default',
    jwGrades: 'https://jwglxt.buct.edu.cn/jwglxt/cjcx/cjcx_cxDgXscj.html?gnmkdm=N305005&layout=default',
    jwExams: 'https://jwglxt.buct.edu.cn/jwglxt/kwgl/kscx_cxXsksxxIndex.html?gnmkdm=N358105&layout=default',
  }
  await mkdir(inspectionOutput, { recursive: true })
  const browserSession = session.fromPartition(PARTITION)
  const result = {}
  for (const [name, url] of Object.entries(targets)) {
    try {
      const response = await browserSession.fetch(url, { credentials: 'include', redirect: 'follow' })
      const html = await response.text()
      await writeFile(resolve(inspectionOutput, `${name}.html`), html, 'utf8')
      result[name] = { status: response.status, url: response.url || url, bytes: Buffer.byteLength(html) }
    } catch (error) {
      result[name] = { error: diagnosticError(error) }
    }
  }
  try {
    const fitnessReady = await ensureFitnessSession({ background: true })
    const fitness = fitnessReady
      ? await loadFitnessPage()
      : await loadFitnessBrowserPage('https://tygl.buct.edu.cn/')
    await writeFile(resolve(inspectionOutput, 'tygl-fitness.html'), fitness.text, 'utf8')
    result.tyglFitness = { authenticated: fitnessReady, url: fitness.url, bytes: Buffer.byteLength(fitness.text) }
  } catch (error) {
    result.tyglFitness = { error: diagnosticError(error) }
  }
  await writeFile(resolve(inspectionOutput, 'meta.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
}

function redactDiagnosticSessionValues(value) {
  if (Array.isArray(value)) return value.map(redactDiagnosticSessionValues)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    /^(?:sessionid|session|token|ticket)$/iu.test(key) ? '[REDACTED]' : redactDiagnosticSessionValues(entry),
  ]))
}

async function exportTheolMobileDiagnostic() {
  if (!theolMobileDiagnosticOutput) return
  const browserSession = session.fromPartition(PARTITION)
  await browserSession.setProxy({ mode: 'direct' })
  const client = new SessionClient(browserSession)
  const endpoint = 'http://course.buct.edu.cn/mobile/stuUnDoTaskList.do'
  const cookieSummary = (cookies) => cookies.map((cookie) => ({
    name: cookie.name,
    domain: cookie.domain,
    path: cookie.path,
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly),
  }))
  const [httpCookies, httpsCookies] = await Promise.all([
    browserSession.cookies.get({ url: endpoint }),
    browserSession.cookies.get({ url: endpoint.replace(/^http:/, 'https:') }),
  ])
  const result = await client.request(endpoint, {}, {
    source: 'THEOL mobile pending tasks',
    allowLogin: true,
  })
  let payload
  try {
    payload = JSON.parse(result.text)
  } catch {
    payload = { responseText: result.text }
  }
  const output = {
    schema: 'theia-diagnostic/theol-mobile-pending-tasks/v1',
    capturedAt: new Date().toISOString(),
    endpoint,
    httpStatus: result.response.status,
    sessionCookies: {
      http: cookieSummary(httpCookies),
      https: cookieSummary(httpsCookies),
    },
    payload: redactDiagnosticSessionValues(payload),
  }
  await mkdir(dirname(theolMobileDiagnosticOutput), { recursive: true })
  await writeFile(theolMobileDiagnosticOutput, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  console.log(`[THEIA] THEOL mobile diagnostic written: ${theolMobileDiagnosticOutput}`)
}

async function rememberVerifiedSession(source, url, expectedEpoch) {
  const cookies = await schoolSession.cookies.get({ url: sourceSessionUrl(source) })
  assertAuthEpoch(expectedEpoch)
  const sessionCookie = cookies.find((cookie) => cookie.name === 'JSESSIONID')
  if (!sessionCookie?.value) return
  verifiedSessions[source] = {
    cookieValue: sessionCookie?.value || null,
    checkedAt: new Date().toISOString(),
    url,
  }
}

async function verifiedStatus(source) {
  const verified = verifiedSessions[source]
  if (!verified) return null
  if (verified.cookieValue) {
    const cookies = await schoolSession.cookies.get({ url: sourceSessionUrl(source) })
    const matches = cookies.some((cookie) => cookie.name === 'JSESSIONID' && cookie.value === verified.cookieValue)
    if (!matches) {
      verifiedSessions[source] = null
      return null
    }
  }
  return { connected: true, checkedAt: verified.checkedAt, url: verified.url }
}

function sourceStatus(source) {
  if (statusChecks[source]) return statusChecks[source]
  const cached = store?.snapshot()?.sync?.sources?.[source]
  if (!forceSourceStatusChecks.has(source)
    && source === 'theol'
    && (syncService.assignmentActive || syncService.assignmentTimer)
    && cached?.connected) {
    return Promise.resolve(cached)
  }
  const adapter = syncService[source]
  const epoch = authEpoch
  const check = schoolProxyReady
    .catch(() => undefined)
    .then(() => {
      assertAuthEpoch(epoch)
      return source === 'theol'
        ? syncService.runTheolExclusive(() => {
          assertAuthEpoch(epoch)
          return adapter.status()
        })
        : adapter.status()
    })
    .finally(() => {
      if (statusChecks[source] === check && authEpoch === epoch) statusChecks[source] = null
    })
  statusChecks[source] = check
  return check
}

function freshSourceStatus(source) {
  forceSourceStatusChecks.add(source)
  const check = sourceStatus(source)
  return check.finally(() => forceSourceStatusChecks.delete(source))
}

function cachedStatus(source) {
  const cached = store?.snapshot()?.sync?.sources?.[source]
  if (!cached || typeof cached.connected !== 'boolean') {
    return { connected: false, checkedAt: null, unchecked: true }
  }
  return {
    connected: cached.connected,
    checkedAt: cached.checkedAt || null,
    ...(cached.url ? { url: cached.url } : {}),
    ...(cached.authRequired ? { authRequired: true } : {}),
    cached: true,
  }
}

function loggedOutStatus() {
  const checkedAt = new Date().toISOString()
  return {
    jwglxt: { connected: false, checkedAt },
    theol: { connected: false, checkedAt },
  }
}

function campusAuthActorsPending() {
  return [...authPendingSources].some((source) => source === 'jwglxt' || source === 'theol')
}

function unifiedAuthVerificationPending(epoch = authEpoch) {
  return Boolean(unifiedAuthVerification
    && unifiedAuthVerification.epoch === epoch
    && !unifiedAuthVerification.settled)
}

function pendingAuthStatus(verified = null) {
  return {
    ...(verified || {}),
    connected: Boolean(verified?.connected),
    checkedAt: verified?.checkedAt || new Date().toISOString(),
    authPending: true,
  }
}

function waitForAuthVerificationDelay(delayMs) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs))
}

/**
 * Validate both campus applications after a CAS hand-off. The adapters still
 * perform the authoritative page/DOM checks; the cookie marker is only
 * refreshed after that validation succeeds.
 */
function requestUnifiedAuthVerification({ epoch = authEpoch, sync = false, reason = 'login' } = {}) {
  if (epoch !== authEpoch || explicitlyLoggedOut) return Promise.resolve(null)
  if (unifiedAuthVerification && unifiedAuthVerification.epoch === epoch) {
    unifiedAuthVerification.sync = unifiedAuthVerification.sync || sync
    return unifiedAuthVerification.promise
  }

  const state = { epoch, sync, reason, settled: false, promise: null }
  const run = (async () => {
    const deadline = Date.now() + UNIFIED_AUTH_VERIFY_WAIT_MS
    while (campusAuthActorsPending() && Date.now() < deadline) {
      await waitForAuthVerificationDelay(100)
      assertAuthEpoch(epoch)
    }

    let statuses = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      assertAuthEpoch(epoch)
      const [jwglxt, theol] = await Promise.all([
        freshSourceStatus('jwglxt'),
        freshSourceStatus('theol'),
      ])
      statuses = { jwglxt, theol }
      if ((jwglxt?.connected && theol?.connected) || attempt === 1) break
      await waitForAuthVerificationDelay(UNIFIED_AUTH_VERIFY_RETRY_DELAY_MS)
    }

    assertAuthEpoch(epoch)
    for (const source of ['jwglxt', 'theol']) {
      const status = statuses?.[source]
      if (status?.connected) {
        await rememberVerifiedSession(source, status.url || sourceSessionUrl(source), epoch)
      } else {
        // A fresh page check is authoritative. Do not let a stale cookie
        // marker make the next status broadcast look connected.
        verifiedSessions[source] = null
      }
    }
    const finalStatus = {
      jwglxt: { ...(statuses?.jwglxt || { connected: false }), authPending: false },
      theol: { ...(statuses?.theol || { connected: false }), authPending: false },
    }
    await broadcastAuthStatus({ statusOverride: finalStatus })
    if (state.sync && (finalStatus.jwglxt.connected || finalStatus.theol.connected)) {
      try {
        await syncForegroundCampusData()
      } catch (error) {
        void writeDiagnostic('sync.post_unified_auth_failed', {
          reason,
          error: diagnosticError(error),
        })
      }
    }
    return finalStatus
  })()

  state.promise = run
    .catch((error) => {
      if (epoch === authEpoch && !explicitlyLoggedOut) {
        void writeDiagnostic('auth.unified_verification_failed', {
          reason,
          error: diagnosticError(error),
        })
        void broadcastAuthStatus()
      }
      return null
    })
    .finally(() => {
      state.settled = true
      if (unifiedAuthVerification === state) unifiedAuthVerification = null
    })
  unifiedAuthVerification = state
  return state.promise
}

function assertAuthEpoch(epoch, { allowLoggedOut = false } = {}) {
  if (epoch !== authEpoch || (!allowLoggedOut && explicitlyLoggedOut)) {
    const error = new Error('学校平台操作已因显式退出取消')
    error.code = 'AUTH_EPOCH_CHANGED'
    throw error
  }
}

async function getStatus(options = {}) {
  if (smokeFile) {
    const checkedAt = new Date().toISOString()
    return {
      jwglxt: { connected: false, checkedAt, offlineSmoke: true },
      theol: { connected: false, checkedAt, offlineSmoke: true },
    }
  }
  if (explicitlyLoggedOut) return loggedOutStatus()
  const probeSources = Array.isArray(options?.sources)
    ? new Set(options.sources.filter((source) => ['jwglxt', 'theol'].includes(source)))
    : null
  const [verifiedJwglxt, verifiedTheol] = await Promise.all([
    verifiedStatus('jwglxt'),
    verifiedStatus('theol'),
  ])
  const unifiedPending = unifiedAuthVerificationPending()
  const [jwglxt, theol] = await Promise.all([
    verifiedJwglxt
      ? (unifiedPending ? pendingAuthStatus(verifiedJwglxt) : verifiedJwglxt)
      : (authPendingSources.has('jwglxt') || unifiedPending
        ? pendingAuthStatus()
      : probeSources && !probeSources.has('jwglxt') ? cachedStatus('jwglxt') : sourceStatus('jwglxt')),
    verifiedTheol
      ? (unifiedPending ? pendingAuthStatus(verifiedTheol) : verifiedTheol)
      : (authPendingSources.has('theol') || unifiedPending
        ? pendingAuthStatus()
      : probeSources && !probeSources.has('theol') ? cachedStatus('theol') : sourceStatus('theol')),
  ])
  if (explicitlyLoggedOut) return loggedOutStatus()
  return { jwglxt, theol }
}

async function broadcastAuthStatus(options) {
  const authStatus = options?.statusOverride || await getStatus(options).catch(() => ({ jwglxt: { connected: false }, theol: { connected: false } }))
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('theia:auth-status', authStatus)
  if (mainWindow && !mainWindow.isDestroyed()) {
    const labels = { jwglxt: '教务系统', theol: '北化在线THEOL', tygl: '健康云体测系统' }
    for (const source of authPendingSources) {
      mainWindow.webContents.send('theia:sync-progress', {
        stage: 'login',
        status: 'syncing',
        label: `正在登录 ${labels[source] || source}…`,
      })
    }
  }
  return authStatus
}

function sourceFromUrl(rawUrl) {
  const hostname = new URL(rawUrl).hostname
  if (hostname === 'jwglxt.buct.edu.cn') return 'jwglxt'
  if (hostname === 'course.buct.edu.cn') return 'theol'
  if (hostname === 'tygl.buct.edu.cn') return 'tygl'
  return null
}

function loginTargetDetails(source) {
  if (source === 'tygl') return { title: 'THEIA · 健康云统一认证', url: 'https://tygl.buct.edu.cn/' }
  return source === 'theol'
    ? { title: 'THEIA · 统一身份认证', url: THEOL_URLS.login }
    : { title: 'THEIA · 教务系统统一认证', url: JWGLXT_URLS.login }
}

function closeWindowAndWait(window) {
  if (!window || window.isDestroyed()) return Promise.resolve()
  return new Promise((resolveClose) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(forceTimer)
      resolveClose()
    }
    const forceTimer = setTimeout(() => {
      try { if (!window.isDestroyed()) window.destroy() } catch { /* closing during shutdown */ }
      finish()
    }, 2_000)
    window.once('closed', finish)
    try { window.close() } catch { finish() }
    if (window.isDestroyed()) finish()
  })
}

function isCurrentTheolInteractiveActor(actor) {
  return Boolean(
    actor
    && !actor.invalidated
    && actor.epoch === authEpoch
    && theolInteractiveActor === actor,
  )
}

function focusTheolInteractiveWindow(actor) {
  const window = actor.root && !actor.root.isDestroyed()
    ? actor.root
    : [...actor.windows].find((candidate) => !candidate.isDestroyed())
  if (!window) return null
  window.show()
  window.focus()
  return window
}

const THEOL_INTERACTION_COURSE_PATHS = new Set([
  '/meol/homepage/course/course_index.jsp',
  '/meol/jpk/course/layout/newpage/index.jsp',
])
const THEOL_INTERACTION_TASK_TYPES = Object.freeze({
  assignment: {
    path: '/meol/common/hw/student/hwtask.view.jsp',
    parameter: 'hwtid',
    evidence: 'homework',
  },
  'online-test': {
    path: '/meol/common/question/test/student/stu_qtest_navigate.jsp',
    parameter: 'testId',
    evidence: 'test',
  },
})

function normalizeTheolNavigationCheck(check) {
  if (!check || typeof check !== 'object') return null
  const type = check.type === 'course' ? 'course' : check.type === 'task' ? 'task' : null
  const courseId = String(check.courseId || '').trim()
  if (!type || !/^[a-zA-Z0-9_-]+$/.test(courseId)) {
    throw new Error('THEOL navigation identity is invalid')
  }
  if (type === 'course') return { type, courseId }
  const taskType = THEOL_INTERACTION_TASK_TYPES[check.kind]
  const uniqueTaskId = String(check.uniqueTaskId || '')
  const taskId = uniqueTaskId.slice(uniqueTaskId.indexOf(':') + 1)
  if (!taskType || uniqueTaskId !== `${check.kind}:${taskId}` || !/^\d+$/.test(taskId)) {
    throw new Error('THEOL task navigation identity is invalid')
  }
  return { type, courseId, kind: check.kind, uniqueTaskId, taskId }
}

function validateTheolNavigationUrl(rawUrl, check) {
  const finalUrl = new URL(permittedSourceUrl(rawUrl))
  if (finalUrl.hostname !== 'course.buct.edu.cn' || finalUrl.port) {
    throw new Error('THEOL navigation left the course platform')
  }
  if (check.type === 'course') {
    const courseIds = finalUrl.searchParams.getAll('courseId')
    if (!THEOL_INTERACTION_COURSE_PATHS.has(finalUrl.pathname.toLowerCase())
      || courseIds.length !== 1
      || courseIds[0] !== check.courseId) {
      throw new Error('THEOL returned a different course page')
    }
    return
  }
  const taskType = THEOL_INTERACTION_TASK_TYPES[check.kind]
  const taskIds = finalUrl.searchParams.getAll(taskType.parameter)
  if (finalUrl.pathname.toLowerCase() !== taskType.path
    || taskIds.length !== 1
    || taskIds[0] !== check.taskId) {
    throw new Error('THEOL returned a different task page')
  }
}

async function readTheolNavigationIdentity(window) {
  const combined = {
    courseFields: [], courseUrls: [],
    homeworkFields: [], homeworkUrls: [],
    testFields: [], testUrls: [],
  }
  const frames = window.webContents.mainFrame.framesInSubtree
  for (const frame of frames) {
    const identity = await frame.executeJavaScript(`(() => {
      const result = {
        courseFields: [], courseUrls: [],
        homeworkFields: [], homeworkUrls: [],
        testFields: [], testUrls: [],
      }
      const fieldBuckets = {
        courseid: result.courseFields,
        lid: result.courseFields,
        hwtid: result.homeworkFields,
        testid: result.testFields,
      }
      const urlBuckets = {
        courseid: result.courseUrls,
        lid: result.courseUrls,
        hwtid: result.homeworkUrls,
        testid: result.testUrls,
      }
      const add = (bucket, value) => {
        const normalized = String(value || '').trim()
        if (normalized && !bucket.includes(normalized)) bucket.push(normalized)
      }
      const inspectUrl = (rawValue) => {
        const value = String(rawValue || '').trim()
        if (!value || value === '###' || /^javascript:/i.test(value)) return
        try {
          const candidate = new URL(value, document.baseURI)
          for (const [name, parameterValue] of candidate.searchParams) {
            const bucket = urlBuckets[String(name).toLowerCase()]
            if (bucket) add(bucket, parameterValue)
          }
        } catch { /* non-URL attributes provide no identity evidence */ }
      }
      const selector = '[name], [href], [src], [action], [data-url], [data-href], [data-course-id], [data-lid], [data-hwtid], [data-test-id]'
      for (const element of document.querySelectorAll(selector)) {
        const name = String(element.getAttribute('name') || '').toLowerCase()
        const fieldBucket = fieldBuckets[name]
        if (fieldBucket) add(fieldBucket, element.value ?? element.getAttribute('value'))
        for (const [attribute, bucketName] of [
          ['data-course-id', 'courseFields'],
          ['data-lid', 'courseFields'],
          ['data-hwtid', 'homeworkFields'],
          ['data-test-id', 'testFields'],
        ]) {
          if (element.hasAttribute(attribute)) add(result[bucketName], element.getAttribute(attribute))
        }
        for (const attribute of ['href', 'src', 'action', 'data-url', 'data-href']) {
          if (element.hasAttribute(attribute)) inspectUrl(element.getAttribute(attribute))
        }
      }
      return result
    })()`).catch(() => null)
    if (!identity) continue
    for (const key of Object.keys(combined)) {
      for (const value of identity[key] || []) {
        if (!combined[key].includes(value)) combined[key].push(value)
      }
    }
  }
  return combined
}

async function validateTheolNavigationStep(window, check) {
  validateTheolNavigationUrl(window.webContents.getURL(), check)
  const identity = await readTheolNavigationIdentity(window)
  const courseEvidence = [...identity.courseFields, ...identity.courseUrls]
  if (check.type === 'course' && !courseEvidence.includes(check.courseId)) {
    throw new Error('THEOL page did not prove the expected course context')
  }
  if (identity.courseFields.some((courseId) => courseId !== check.courseId)) {
    throw new Error('THEOL page contains a different course context')
  }
  if (check.type === 'course') return
  const taskType = THEOL_INTERACTION_TASK_TYPES[check.kind]
  const taskFields = taskType.evidence === 'homework' ? identity.homeworkFields : identity.testFields
  const taskUrls = taskType.evidence === 'homework' ? identity.homeworkUrls : identity.testUrls
  if (![...taskFields, ...taskUrls].includes(check.taskId)
    || taskFields.some((taskId) => taskId !== check.taskId)) {
    throw new Error('THEOL page did not prove the expected task identity')
  }
}

async function runTheolInteractiveActor(actor) {
  actor.assertCurrentSnapshot?.()
  actor.resumeAssignments = syncService.pauseAssignmentScan()
  await syncService.waitForAssignmentScan()
  if (!isCurrentTheolInteractiveActor(actor)) return
  actor.assertCurrentSnapshot?.()

  await syncService.runTheolExclusive(async () => {
    if (!isCurrentTheolInteractiveActor(actor)) return
    actor.assertCurrentSnapshot?.()
    let window = null
    try {
      actor.assertCurrentSnapshot?.()
      window = new BrowserWindow(sourceWindowOptions({ title: actor.title, show: false }))
      actor.root = window
      guardSourceWindow(window, {
        source: 'theol',
        theolActor: actor,
        theolLease: true,
      })
      for (const [index, url] of actor.navigationUrls.entries()) {
        actor.assertCurrentSnapshot?.()
        await window.loadURL(url)
        actor.assertCurrentSnapshot?.()
        if (!isCurrentTheolInteractiveActor(actor) || window.isDestroyed()) {
          throw new Error('北化在线THEOL交互窗口已关闭')
        }
        const check = actor.navigationChecks[index]
        if (check) {
          await validateTheolNavigationStep(window, check)
          actor.assertCurrentSnapshot?.()
        }
      }
      actor.assertCurrentSnapshot?.()
      actor.validated = true
      actor.resolveOpened(window)
      await actor.closed
    } catch (error) {
      actor.rejectOpened(error)
      await Promise.all([...actor.windows].map((candidate) => closeWindowAndWait(candidate)))
      if (actor.windows.size) await actor.closed
      throw error
    }
  })
}

async function finishTheolInteractiveActor(actor) {
  if (theolInteractiveActor === actor) theolInteractiveActor = null
  actor.resumeAssignments?.({ schedule: false })
  actor.resumeAssignments = null
  if (actor.invalidated || actor.epoch !== authEpoch || explicitlyLoggedOut) return
  try {
    await syncService.syncNow({ sources: ['theol'] })
  } catch (error) {
    if (actor.epoch === authEpoch && !explicitlyLoggedOut) {
      void writeDiagnostic('sync.post_theol_interaction_failed', { error: diagnosticError(error) })
    }
  }
}

function createTheolInteractiveActor(url, title, {
  navigationUrls = [url],
  navigationChecks = [],
  interactionKey = url,
  assertCurrentSnapshot = null,
} = {}) {
  let resolveOpened
  let rejectOpened
  let resolveClosed
  const opened = new Promise((resolve, reject) => {
    resolveOpened = resolve
    rejectOpened = reject
  })
  // The IPC caller normally observes this promise immediately. Keep a handler
  // attached for the logout-before-open race as well.
  void opened.catch(() => undefined)
  const closed = new Promise((resolve) => { resolveClosed = resolve })
  const actor = {
    epoch: authEpoch,
    url,
    navigationUrls,
    navigationChecks,
    interactionKey,
    assertCurrentSnapshot: typeof assertCurrentSnapshot === 'function' ? assertCurrentSnapshot : null,
    title,
    root: null,
    windows: new Set(),
    validated: navigationChecks.length === 0,
    invalidated: false,
    resumeAssignments: null,
    opened,
    closed,
    resolveOpened,
    rejectOpened,
    resolveClosed,
    lifecycle: null,
  }
  theolInteractiveActor = actor
  actor.lifecycle = runTheolInteractiveActor(actor)
    .catch((error) => {
      actor.rejectOpened(error)
      if (!actor.invalidated && actor.epoch === authEpoch) {
        void writeDiagnostic('theol.interaction_failed', { url: diagnosticUrl(url), error: diagnosticError(error) })
      }
    })
    .finally(() => finishTheolInteractiveActor(actor))
  return actor
}

async function openTheolInteractiveWindow(rawUrl, title, options = {}) {
  const epoch = authEpoch
  assertAuthEpoch(epoch)
  const assertCurrentSnapshot = typeof options.assertCurrentSnapshot === 'function'
    ? options.assertCurrentSnapshot
    : null
  assertCurrentSnapshot?.()
  const url = permittedSourceUrl(rawUrl)
  const navigationUrls = (options.navigationUrls?.length ? options.navigationUrls : [url])
    .map((candidate) => permittedSourceUrl(candidate))
  if (navigationUrls.at(-1) !== url) throw new Error('北化在线THEOL交互导航的最终页面无效')
  const navigationChecks = Array.isArray(options.navigationChecks)
    ? options.navigationChecks.map(normalizeTheolNavigationCheck)
    : []
  if (navigationChecks.length && navigationChecks.length !== navigationUrls.length) {
    throw new Error('THEOL navigation checks do not match the requested steps')
  }
  const interactionKey = String(options.interactionKey || url)
  const current = theolInteractiveActor
  if (isCurrentTheolInteractiveActor(current)) {
    if (current.interactionKey !== interactionKey) {
      throw new Error('北化在线THEOL已有其他页面正在交互，请关闭当前窗口后再打开新页面')
    }
    await current.opened
    assertAuthEpoch(epoch)
    assertCurrentSnapshot?.()
    if (!isCurrentTheolInteractiveActor(current)) throw new Error('北化在线THEOL交互窗口已关闭，请重试')
    assertCurrentSnapshot?.()
    const reused = focusTheolInteractiveWindow(current)
    if (!reused) throw new Error('北化在线THEOL交互窗口已关闭，请重试')
    return reused
  }
  if (explicitlyLoggedOut) throw new Error('请先登录北化在线THEOL')
  assertCurrentSnapshot?.()
  const actor = createTheolInteractiveActor(url, title, {
    navigationUrls,
    navigationChecks,
    interactionKey,
    assertCurrentSnapshot,
  })
  const window = await actor.opened
  assertAuthEpoch(epoch)
  assertCurrentSnapshot?.()
  return focusTheolInteractiveWindow(actor) || window
}

function guardSourceWindow(window, {
  source = null,
  pauseAssignments = false,
  theolActor = null,
  theolLease = false,
  upgradeTyglRedirects = false,
} = {}) {
  sourceWindows.add(window)
  if (source) window.__theiaSource = source
  if (upgradeTyglRedirects) window.__theiaUpgradeTyglRedirects = true
  if (theolActor) {
    window.__theiaTheolInteractiveActor = theolActor
    theolActor.windows.add(window)
  }
  if (theolLease || theolActor) window.__theiaTheolLease = true
  if (pauseAssignments && source === 'theol' && !theolActor && !window.__theiaAssignmentResume) {
    window.__theiaAssignmentResume = syncService.pauseAssignmentScan()
  }
  window.on('closed', () => {
    sourceWindows.delete(window)
    const interactiveActor = window.__theiaTheolInteractiveActor
    window.__theiaTheolInteractiveActor = null
    if (interactiveActor) {
      interactiveActor.windows.delete(window)
      if (!interactiveActor.windows.size) interactiveActor.resolveClosed()
    }
    const resumeAssignments = window.__theiaAssignmentResume
    window.__theiaAssignmentResume = null
    resumeAssignments?.()
  })
  const preventUnsafeNavigation = (event, legacyUrl) => {
    if (event.isMainFrame === false) return
    const target = event.url || legacyUrl
    const upgradedTarget = window.__theiaUpgradeTyglRedirects
      ? upgradeTyglRedirectUrl(target)
      : null
    if (upgradedTarget) {
      event.preventDefault()
      window.__theiaPendingNavigationUpgrade = upgradedTarget
      void writeDiagnostic('fitness.navigation_upgraded', { url: diagnosticUrl(upgradedTarget) })
      return
    }
    try {
      permittedSourceUrl(target)
    } catch {
      event.preventDefault()
      void writeDiagnostic('source.navigation_blocked', { url: diagnosticUrl(target) })
      return
    }
    if (sourceFromUrl(target) === 'theol' && !window.__theiaTheolLease) {
      event.preventDefault()
      void openSourceWindow(target, { title: 'THEIA · 北化在线THEOL' }).catch((error) => {
        void writeDiagnostic('theol.interaction_rejected', { url: diagnosticUrl(target), error: diagnosticError(error) })
      })
    }
  }
  window.webContents.on('will-navigate', preventUnsafeNavigation)
  window.webContents.on('will-redirect', preventUnsafeNavigation)
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (window === syncPageWindow || window === fitnessPageWindow) {
      void writeDiagnostic('source.background_popup_blocked', { url: diagnosticUrl(url) })
      return { action: 'deny' }
    }
    if (window.__theiaTheolInteractiveActor?.invalidated) return { action: 'deny' }
    if (window.__theiaTheolInteractiveActor?.validated === false) return { action: 'deny' }
    try {
      const target = permittedSourceUrl(url)
      if (sourceFromUrl(target) === 'theol' && !window.__theiaTheolLease) {
        void openSourceWindow(target, { title: 'THEIA · 北化在线THEOL' }).catch((error) => {
          void writeDiagnostic('theol.interaction_rejected', { url: diagnosticUrl(target), error: diagnosticError(error) })
        })
        return { action: 'deny' }
      }
      return {
        action: 'allow',
        overrideBrowserWindowOptions: sourceWindowOptions({ title: 'THEIA · 学校原站' }),
      }
    } catch {
      void writeDiagnostic('source.popup_blocked', { url: diagnosticUrl(url) })
      return { action: 'deny' }
    }
  })
  window.webContents.on('did-create-window', (child) => {
    let childSource = window.__theiaSource || null
    try { childSource = sourceFromUrl(child.webContents.getURL()) || childSource } catch { /* inherit the guarded parent */ }
    const interactiveActor = window.__theiaTheolInteractiveActor || null
    guardSourceWindow(child, {
      source: childSource,
      pauseAssignments: childSource === 'theol' && !window.__theiaTheolLease,
      theolActor: interactiveActor,
      theolLease: Boolean(window.__theiaTheolLease),
      upgradeTyglRedirects: Boolean(window.__theiaUpgradeTyglRedirects),
    })
  })
  if (theolActor?.invalidated) void closeWindowAndWait(window)
  return window
}

async function loadSourceWindowUrl(window, target, { signal = null } = {}) {
  let navigationTarget = target
  for (let upgrades = 0; ; upgrades += 1) {
    window.__theiaPendingNavigationUpgrade = null
    try {
      await window.loadURL(navigationTarget)
      return
    } catch (error) {
      const upgradedTarget = window.__theiaPendingNavigationUpgrade
      window.__theiaPendingNavigationUpgrade = null
      if (signal?.aborted || !upgradedTarget || upgrades >= 3) throw error
      navigationTarget = upgradedTarget
    }
  }
}

async function createSourceWindow(rawUrl, title = '学校原站', { pauseAssignments = false, show = true } = {}) {
  const url = permittedSourceUrl(rawUrl)
  const source = sourceFromUrl(url)
  if (source === 'theol') return openTheolInteractiveWindow(url, title)
  const window = new BrowserWindow(sourceWindowOptions({ title, show }))
  guardSourceWindow(window, { source, pauseAssignments, upgradeTyglRedirects: source === 'tygl' })
  try {
    await loadSourceWindowUrl(window, url)
    return window
  } catch (error) {
    if (!window.isDestroyed()) window.close()
    throw error
  }
}

async function inspectLoadedSourcePage(window, source, fallbackUrl) {
  if (!window || window.isDestroyed()) return { authenticated: false, url: fallbackUrl, html: '' }
  const finalUrl = permittedSourceUrl(window.webContents.getURL() || fallbackUrl)
  const html = await window.webContents.executeJavaScript('document.documentElement?.outerHTML || ""')
  const loginUrl = /experimental-auth-endpoint|(?:^|\/)login(?:[._/?#]|$)|login_slogin/i.test(finalUrl)
  // Parsing the homepage is useful evidence for JWGLXT, but detail pages do
  // not contain the homepage menu/profile markers. Treat a non-login page on
  // the expected campus host as authenticated after the explicit login checks.
  const page = source === 'jwglxt' ? parseJwHomepage(html, finalUrl) : null
  const loginMarkup = source === 'jwglxt' && page?.loggedIn
    ? false
    : htmlLooksLikeLogin(html, finalUrl)
  const expectedHost = source === 'jwglxt'
    ? 'jwglxt.buct.edu.cn'
    : source === 'tygl'
      ? 'tygl.buct.edu.cn'
      : new URL(fallbackUrl).hostname
  const sameCampusHost = new URL(finalUrl).hostname === expectedHost
  return {
    authenticated: sameCampusHost && !loginUrl && !loginMarkup,
    url: finalUrl,
    html,
    parserLoggedIn: Boolean(page?.loggedIn),
  }
}

async function openAuthenticatedSourceWindow(rawUrl, title = '学校原站', { pauseAssignments = false, verified = false } = {}) {
  const url = permittedSourceUrl(rawUrl)
  const source = sourceFromUrl(url)
  if (!source || source === 'theol') return createSourceWindow(url, title, { pauseAssignments })
  if (verified) {
    // Authentication actors can resolve as soon as CAS has rendered an
    // authenticated frame, while the next navigation is still racing cookie
    // propagation. Keep the first user-visible page behind the same DOM proof
    // used by the normal path; otherwise the first click can show CAS even
    // though the actor just reported success.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const window = await createSourceWindow(url, title, { pauseAssignments, show: false })
      try {
        const state = await inspectLoadedSourcePage(window, source, url)
        if (state.authenticated) {
          window.show()
          window.focus()
          return window
        }
        await closeWindowAndWait(window)
      } catch (error) {
        await closeWindowAndWait(window)
        throw error
      }
      if (attempt < 2) await new Promise((resolveDelay) => setTimeout(resolveDelay, 250))
    }
    return null
  }
  const window = await createSourceWindow(url, title, { pauseAssignments, show: false })
  try {
    const state = await inspectLoadedSourcePage(window, source, url)
    if (!state.authenticated) {
      void writeDiagnostic('source.page_requires_auth', {
        source,
        requestedUrl: diagnosticUrl(url),
        finalUrl: diagnosticUrl(state.url),
        parserLoggedIn: state.parserLoggedIn,
      })
      await closeWindowAndWait(window)
      return null
    }
    window.show()
    window.focus()
    return window
  } catch (error) {
    await closeWindowAndWait(window)
    throw error
  }
}

async function waitForSchedulePdfButton(window, timeoutMs = 30_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (window.isDestroyed()) throw new Error('课表原站窗口已关闭')
    try {
      const state = await window.webContents.executeJavaScript(`(() => {
        const button = document.querySelector('#shcPDF')
        return { ready: Boolean(button), visible: Boolean(button && button.getClientRects().length), loggedIn: !/experimental-auth-endpoint|login/i.test(location.hostname + location.pathname) }
      })()`)
      if (state.ready && state.visible) return state
      if (!state.loggedIn) throw new Error('教务系统会话已失效，请重新认证')
    } catch (error) {
      if (String(error?.message || error).includes('会话已失效')) throw error
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 400))
  }
  throw new Error('课表页面加载超时，未找到“输出PDF”按钮')
}

async function waitForSchedulePdfPopup(window, timeoutMs = 15_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (window.isDestroyed()) return null
    const url = await window.webContents.executeJavaScript('window.__theiaSchedulePdfUrl || null').catch(() => null)
    if (url) return String(url)
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 300))
  }
  return null
}

async function openSchedulePdf(expectedEpoch = authEpoch) {
  const epoch = expectedEpoch
  assertAuthEpoch(epoch)
  let status = await verifiedStatus('jwglxt')
  assertAuthEpoch(epoch)
  if (!status) {
    status = await syncService.jwglxt.status()
    assertAuthEpoch(epoch)
  }
  if (!status.connected) {
    const credentials = await credentialVault.status().catch(() => ({ saved: false }))
    if (credentials?.saved) {
      await openLoginWindow({ background: true, sources: ['jwglxt'], expectedEpoch: epoch, requireBrowser: true, skipSync: true })
    } else await openLoginWindow({ sources: ['jwglxt'], expectedEpoch: epoch })
    assertAuthEpoch(epoch)
    throw new Error('教务系统会话未连接，请完成认证后重试')
  }
  if (!verifiedSessions.jwglxt) {
    await rememberVerifiedSession('jwglxt', status.url || JWGLXT_URLS.schedule, epoch)
    assertAuthEpoch(epoch)
  }
  assertAuthEpoch(epoch)
  const window = await openAuthenticatedSourceWindow(JWGLXT_URLS.schedule, 'THEIA · 教务系统课表')
  if (!window) {
    verifiedSessions.jwglxt = null
    const credentials = await credentialVault.status().catch(() => ({ saved: false }))
    if (credentials?.saved) {
      await openLoginWindow({ background: true, sources: ['jwglxt'], expectedEpoch: epoch, requireBrowser: true, skipSync: true })
    } else await openLoginWindow({ sources: ['jwglxt'], expectedEpoch: epoch })
    assertAuthEpoch(epoch)
    throw new Error('教务系统浏览器会话未连接，请完成认证后重试')
  }
  assertAuthEpoch(epoch)
  await writeDiagnostic('schedule.pdf_page_opened', { url: diagnosticUrl(window.webContents.getURL() || JWGLXT_URLS.schedule) })
  await waitForSchedulePdfButton(window)
  const outputDirectory = resolve(app.getPath('documents'), 'THEIA', '课表')
  await mkdir(outputDirectory, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '')
  const outputPath = resolve(outputDirectory, `THEIA-课表-${timestamp}.pdf`)
  let cancelDownload = () => {}
  const download = new Promise((resolveDownload, rejectDownload) => {
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      schoolSession.removeListener('will-download', onWillDownload)
      clearTimeout(timeout)
      callback(value)
    }
    const timeout = setTimeout(() => finish(rejectDownload, new Error('教务系统 PDF 下载超时')), 45_000)
    cancelDownload = () => finish(resolveDownload, null)
    const onWillDownload = (_event, item, webContents) => {
      if (webContents && webContents.id !== window.webContents.id) return
      const downloadUrl = item.getURL?.() || ''
      if (!isPermittedSourceDownloadUrl(downloadUrl)) {
        item.cancel()
        void writeDiagnostic('schedule.pdf_download_blocked', { url: diagnosticUrl(downloadUrl) })
        finish(rejectDownload, new Error('课表 PDF 下载地址不属于校园网'))
        return
      }
      const declaredBytes = item.getTotalBytes()
      if (declaredBytes > MAX_ATTACHMENT_RESPONSE_BYTES) {
        item.cancel()
        finish(rejectDownload, new Error('课表 PDF 超过 32 MB 限制'))
        return
      }
      try { item.setSavePath(outputPath) } catch (error) { finish(rejectDownload, error); return }
      void writeDiagnostic('schedule.pdf_download_started', { path: outputPath, url: diagnosticUrl(downloadUrl) })
      item.on('updated', () => {
        if (item.getReceivedBytes() <= MAX_ATTACHMENT_RESPONSE_BYTES) return
        item.cancel()
        finish(rejectDownload, new Error('课表 PDF 超过 32 MB 限制'))
      })
      item.once('done', (_doneEvent, state) => {
        if (state !== 'completed') return finish(rejectDownload, new Error(`教务系统 PDF 下载未完成：${state}`))
        finish(resolveDownload, { filePath: outputPath, bytes: item.getReceivedBytes() })
      })
    }
    schoolSession.on('will-download', onWillDownload)
  })
  try {
    await window.webContents.executeJavaScript(`(() => {
      window.__theiaSchedulePdfUrl = null
      window.open = (url) => { window.__theiaSchedulePdfUrl = String(url || ''); return null }
      const button = document.querySelector('#shcPDF')
      if (!button) throw new Error('未找到输出PDF按钮')
      button.click()
      return true
    })()`)
    const firstResult = await Promise.race([download, waitForSchedulePdfPopup(window)])
    const popupUrl = typeof firstResult === 'string' ? firstResult : null
    const result = popupUrl
      ? await (async () => {
        try {
          const pdfUrl = permittedSourceUrl(new URL(popupUrl, window.webContents.getURL() || JWGLXT_URLS.schedule).toString())
          const downloaded = await sessionClient.binary(pdfUrl, { source: '教务系统课表 PDF' })
          const bytes = downloaded.buffer
          if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('教务系统课表返回的不是有效 PDF')
          await writeFile(outputPath, bytes)
          return { filePath: outputPath, bytes: bytes.length, url: downloaded.url }
        } finally {
          cancelDownload()
        }
      })()
      : firstResult || await download
    const file = await open(result.filePath, 'r')
    try {
      const header = Buffer.alloc(5)
      const { bytesRead } = await file.read(header, 0, header.length, 0)
      if (bytesRead !== header.length || !header.equals(Buffer.from('%PDF-'))) {
        await rm(result.filePath, { force: true })
        throw new Error('教务系统课表返回的不是有效 PDF')
      }
    } finally {
      await file.close()
    }
    await writeDiagnostic('schedule.pdf_download_completed', { path: result.filePath, bytes: result.bytes })
    return { canceled: false, ...result }
  } catch (error) {
    await writeDiagnostic('schedule.pdf_download_failed', { error: diagnosticError(error), url: diagnosticUrl(window.webContents.getURL()) })
    throw error
  }
}

async function openCourseWorkWindow(entry, expectedEpoch = authEpoch, assertCurrentSnapshot = null) {
  const source = 'theol'
  const { assignment } = entry
  const epoch = expectedEpoch
  assertAuthEpoch(epoch)
  const assertSnapshot = typeof assertCurrentSnapshot === 'function' ? assertCurrentSnapshot : () => {}
  assertSnapshot()
  const resumeWhileOpening = syncService.pauseAssignmentScan()
  try {
    await syncService.waitForAssignmentScan()
    assertAuthEpoch(epoch)
    assertSnapshot()
    let status = await verifiedStatus(source)
    assertAuthEpoch(epoch)
    assertSnapshot()
    if (!status) {
      status = await syncService.runTheolExclusive(() => {
        assertAuthEpoch(epoch)
        assertSnapshot()
        return syncService.theol.status()
      })
      assertAuthEpoch(epoch)
      assertSnapshot()
    }
    if (!status.connected) {
      resumeWhileOpening({ schedule: false })
      assertAuthEpoch(epoch)
      assertSnapshot()
      await openLoginWindow({ sources: [source], expectedEpoch: epoch })
      assertAuthEpoch(epoch)
      assertSnapshot()
      throw new Error('北化在线THEOL会话已失效，请完成登录后重试')
    }
    if (!verifiedSessions[source]) {
      await rememberVerifiedSession(source, status.url || entry.courseSourceUrl, epoch)
      assertAuthEpoch(epoch)
      assertSnapshot()
    }
    assertAuthEpoch(epoch)
    assertSnapshot()
    const window = await openTheolInteractiveWindow(
      entry.assignmentSourceUrl,
      `${assignment.kind === 'online-test' ? '在线测试' : '课程作业'} · ${assignment.title}`,
      {
        navigationUrls: [entry.courseSourceUrl, entry.assignmentSourceUrl],
        navigationChecks: [
          { type: 'course', courseId: assignment.courseId },
          {
            type: 'task',
            courseId: assignment.courseId,
            kind: entry.kind,
            uniqueTaskId: entry.uniqueTaskId,
          },
        ],
        interactionKey: `task:${entry.uniqueTaskId}:${entry.courseSourceUrl}`,
        assertCurrentSnapshot: assertSnapshot,
      },
    )
    assertAuthEpoch(epoch)
    assertSnapshot()
    resumeWhileOpening({ schedule: false })
    return window
  } catch (error) {
    resumeWhileOpening({ schedule: false })
    throw error
  }
}

async function attachFileToSourceWindow(window, filePath) {
  const count = await window.webContents.executeJavaScript(`document.querySelectorAll('input[type="file"]').length`)
  if (!count) return { attached: false, message: '当前页面没有可识别的文件上传控件，请在内置浏览器中手动选择文件' }
  try {
    window.webContents.debugger.attach('1.3')
    const document = await window.webContents.debugger.sendCommand('DOM.getDocument', { depth: 1 })
    const node = await window.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: document.root.nodeId, selector: 'input[type="file"]' })
    if (!node.nodeId) return { attached: false, message: '未找到可用的文件上传控件，请在内置浏览器中手动选择文件' }
    await window.webContents.debugger.sendCommand('DOM.setFileInputFiles', { files: [filePath], nodeId: node.nodeId })
    return { attached: true, message: '文件已放入北化在线THEOL页面，请核对后自行点击提交' }
  } catch (error) {
    return { attached: false, message: `自动放入文件失败：${diagnosticError(error)}` }
  } finally {
    if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach()
  }
}

async function fillTestInSourceWindow(window, answerKey) {
  const payload = JSON.stringify(JSON.stringify(answerKey))
  return window.webContents.executeJavaScript(`(() => {
    const answerKey = JSON.parse(${payload})
    const visible = (node) => Boolean(node) && node.getClientRects().length > 0 && !node.disabled
    const controls = [...document.querySelectorAll('input[type="radio"], input[type="checkbox"], textarea, select')].filter(visible)
    const groups = []
    const byKey = new Map()
    for (const control of controls) {
      const type = String(control.type || control.tagName).toLowerCase()
      const name = control.name || ('field-' + groups.length)
      const key = ['radio', 'checkbox'].includes(type) ? type + ':' + name : 'field:' + name + ':' + groups.length
      if (!byKey.has(key)) {
        const group = { type, controls: [] }
        byKey.set(key, group)
        groups.push(group)
      }
      byKey.get(key).controls.push(control)
    }
    const labelFor = (control) => {
      const byId = control.id ? document.querySelector('label[for="' + CSS.escape(control.id) + '"]') : null
      return String(byId?.innerText || control.closest('label')?.innerText || control.parentElement?.innerText || '').replace(/\\s+/g, ' ').trim()
    }
    const matches = (control, wanted) => {
      const value = String(control.value || '')
      const label = labelFor(control)
      const target = String(wanted).trim()
      if (!target) return false
      return value === target || label === target || label.startsWith(target + '.') || label.startsWith(target + '、') || label.includes(target)
    }
    const applied = []
    const failed = []
    for (const entry of answerKey.answers) {
      const group = groups[Number(entry.question) - 1]
      if (!group) { failed.push({ question: entry.question, reason: '未找到题目控件' }); continue }
      const wanted = Array.isArray(entry.answer) ? entry.answer : [entry.answer]
      if (group.type === 'radio' || group.type === 'checkbox') {
        let matched = 0
        for (const control of group.controls) {
          const next = wanted.some((value) => matches(control, value))
          if (group.type === 'checkbox') control.checked = next
          else if (next) control.checked = true
          if (next) matched += 1
          control.dispatchEvent(new Event('input', { bubbles: true }))
          control.dispatchEvent(new Event('change', { bubbles: true }))
        }
        if (matched) applied.push(entry.question)
        else failed.push({ question: entry.question, reason: '答案与页面选项不匹配' })
      } else if (group.type === 'select-one' || group.type === 'select-multiple' || group.controls[0]?.tagName === 'SELECT') {
        const select = group.controls[0]
        let matched = false
        for (const option of select.options) {
          const next = wanted.some((value) => String(option.value) === String(value) || String(option.text).trim() === String(value).trim())
          if (next) { option.selected = true; matched = true }
        }
        select.dispatchEvent(new Event('change', { bubbles: true }))
        if (matched) applied.push(entry.question)
        else failed.push({ question: entry.question, reason: '答案与下拉选项不匹配' })
      } else {
        group.controls[0].value = wanted.join('\n')
        group.controls[0].dispatchEvent(new Event('input', { bubbles: true }))
        group.controls[0].dispatchEvent(new Event('change', { bubbles: true }))
        applied.push(entry.question)
      }
    }
    return { applied, failed, total: answerKey.answers.length }
  })()`)
}

async function captureRenderedPage(url, text) {
  if (!pageCaptureOutput) return
  const parsed = new URL(url)
  const label = `${String(++pageCaptureIndex).padStart(2, '0')}-${parsed.hostname}${parsed.pathname}`
    .replace(/[^a-zA-Z0-9.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  await mkdir(pageCaptureOutput, { recursive: true })
  const file = resolve(pageCaptureOutput, `${label || 'page'}.html`)
  await writeFile(file, text, 'utf8')
  pageCaptureLog.push({
    index: pageCaptureIndex,
    url: `${parsed.origin}${parsed.pathname}`,
    bytes: Buffer.byteLength(String(text || '')),
    file,
  })
}

const LIVE_CAPTURE_FIELDS = Object.freeze({
  profile: 'profile',
  terms: 'terms',
  courses: 'courses',
  schedule: 'schedule',
  grades: 'grades',
  exams: 'exams',
  'selected-courses': 'selectedCourses',
  'academic-progress': 'academicProgress',
  notices: 'notices',
  ...Object.fromEntries(JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES.map((domain) => [domain, 'academicExtras'])),
})

function liveCaptureCount(value) {
  if (Array.isArray(value)) return value.length
  if (!value || typeof value !== 'object') return 0
  if (Array.isArray(value.records)) return value.records.length
  if (Array.isArray(value.items)) return value.items.length
  if (Array.isArray(value.categories)) return value.categories.length
  if (Array.isArray(value.roots)) return value.roots.length
  return Object.keys(value).length
}

function liveCaptureFieldPaths(value, prefix = '', output = new Set(), depth = 0) {
  if (value === null || value === undefined || depth > 7) return output
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 100)) liveCaptureFieldPaths(item, `${prefix}[]`, output, depth + 1)
    return output
  }
  if (typeof value !== 'object') return output
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    output.add(path)
    liveCaptureFieldPaths(child, path, output, depth + 1)
  }
  return output
}

function liveCaptureDigest(value) {
  try {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex')
  } catch {
    return null
  }
}

function liveCaptureResultCounts(result) {
  const extras = result?.academicExtras?.domains || {}
  const academicProgress = result?.academicProgress
  return {
    profileFields: result?.profile && typeof result.profile === 'object' ? Object.keys(result.profile).length : 0,
    terms: Array.isArray(result?.terms) ? result.terms.length : 0,
    courses: Array.isArray(result?.courses) ? result.courses.length : 0,
    schedule: Array.isArray(result?.schedule) ? result.schedule.length : 0,
    grades: Array.isArray(result?.grades) ? result.grades.length : 0,
    exams: Array.isArray(result?.exams) ? result.exams.length : 0,
    selectedCourses: Array.isArray(result?.selectedCourses) ? result.selectedCourses.length : 0,
    notices: Array.isArray(result?.notices) ? result.notices.length : 0,
    academicProgressCategories: Array.isArray(academicProgress?.categories) ? academicProgress.categories.length : 0,
    academicProgressRoots: Array.isArray(academicProgress?.roots) ? academicProgress.roots.length : 0,
    academicExtras: Object.fromEntries(Object.entries(extras).map(([domain, value]) => [domain, {
      records: Array.isArray(value?.records) ? value.records.length : 0,
      attachments: Array.isArray(value?.attachments) ? value.attachments.length : 0,
      completeness: value?.completeness || 'unknown',
      queryStats: value?.queryStats || null,
    }])),
    domainOutcomes: result?.domainOutcomes || {},
    errors: Array.isArray(result?.errors) ? result.errors : [],
  }
}

function liveCaptureDomainSummary(result, domain) {
  const field = LIVE_CAPTURE_FIELDS[domain]
  const outcome = result?.domainOutcomes?.[domain] || null
  const value = field === 'academicExtras' ? result?.academicExtras?.domains?.[domain] : result?.[field]
  const fields = [...liveCaptureFieldPaths(value)].sort()
  return {
    outcome,
    count: liveCaptureCount(value),
    fields,
    digest: liveCaptureDigest(value),
    hasPayload: value !== undefined,
  }
}

function compareLiveCaptureResults(browser, api) {
  const domains = [...new Set([
    ...Object.keys(browser?.result?.domainOutcomes || {}),
    ...Object.keys(api?.result?.domainOutcomes || {}),
    ...Object.keys(LIVE_CAPTURE_FIELDS),
  ])].sort()
  const entries = Object.fromEntries(domains.map((domain) => {
    const browserSummary = liveCaptureDomainSummary(browser?.result, domain)
    const apiSummary = liveCaptureDomainSummary(api?.result, domain)
    const browserFields = new Set(browserSummary.fields)
    const apiFields = new Set(apiSummary.fields)
    return [domain, {
      browser: browserSummary,
      api: apiSummary,
      differences: {
        countDelta: browserSummary.count - apiSummary.count,
        browserOnlyFields: browserSummary.fields.filter((field) => !apiFields.has(field)),
        apiOnlyFields: apiSummary.fields.filter((field) => !browserFields.has(field)),
        digestEqual: Boolean(browserSummary.digest && apiSummary.digest && browserSummary.digest === apiSummary.digest),
      },
    }]
  }))
  return {
    schema: 'theia-live-capture-comparison/v2',
    capturedAt: new Date().toISOString(),
    domains: entries,
    totals: {
      browserErrors: browser?.result?.errors?.length || 0,
      apiErrors: api?.result?.errors?.length || 0,
      browserSucceeded: Object.values(browser?.result?.domainOutcomes || {}).filter((item) => item?.succeeded === true).length,
      apiSucceeded: Object.values(api?.result?.domainOutcomes || {}).filter((item) => item?.succeeded === true).length,
    },
  }
}

function createLiveCaptureAttachmentStore(root, label) {
  return {
    async find() { return null },
    async save({ id, extension = 'bin', buffer }) {
      const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '')
      const digest = createHash('sha256').update(bytes).digest('hex')
      const filename = `${String(id || 'attachment').replace(/[^a-zA-Z0-9._-]+/g, '_')}.${String(extension || 'bin').replace(/[^a-zA-Z0-9._-]+/g, '_')}`
      const directory = resolve(root, 'attachments', label)
      await mkdir(directory, { recursive: true })
      const file = resolve(directory, filename)
      await writeFile(file, bytes)
      return { id, bytes: bytes.length, sha256: digest, filename, path: file }
    },
  }
}

async function writeLiveCaptureJson(root, name, value) {
  await mkdir(root, { recursive: true })
  await writeFile(resolve(root, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function fetchRenderedPageInWindow(window, target) {
  const payload = JSON.stringify({ url: target })
  const result = await Promise.race([
    window.webContents.executeJavaScript(`(async ({ url }) => {
      const response = await fetch(url, { credentials: 'include' })
      return { url: response.url, status: response.status, text: await response.text() }
    })(${payload})`),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Rendered page fetch timed out')), 30_000)),
  ])
  if (Number(result?.status || 0) < 200 || Number(result?.status || 0) >= 300) {
    throw new Error(`Rendered page fetch failed (${result?.status || 0})`)
  }
  const text = String(result?.text || '')
  if (!text) throw new Error('Rendered page fetch returned an empty document')
  return { url: result?.url || target, text }
}

function raceRenderedOperation(operation, timeoutMs, message) {
  let timer
  return Promise.race([
    operation,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

async function loadWithBackgroundBrowser(url, {
  signal = null,
  currentWindow,
  setCurrentWindow,
  title,
  allowTheol = false,
  upgradeTyglRedirects = false,
} = {}) {
  const target = permittedSourceUrl(url)
  if (!allowTheol && sourceFromUrl(target) === 'theol') {
    throw new Error('The fitness browser cannot navigate to the course platform')
  }
  let window = currentWindow()
  if (!window || window.isDestroyed()) {
    window = new BrowserWindow(sourceWindowOptions({ title, width: 1, height: 1, show: false }))
    guardSourceWindow(window, { upgradeTyglRedirects })
    setCurrentWindow(window)
    window.on('closed', () => {
      if (currentWindow() === window) setCurrentWindow(null)
    })
  }
  if (upgradeTyglRedirects) window.__theiaUpgradeTyglRedirects = true
  let timeout
  let rejectAborted
  const cancelNavigation = () => {
    try { window?.webContents.stop() } catch { /* the window may already be closing */ }
    rejectAborted?.(new Error('Background page navigation aborted'))
  }
  if (signal?.aborted) throw new Error('Background page navigation aborted')
  const theolLease = sourceFromUrl(target) === 'theol'
  if (theolLease) window.__theiaTheolLease = true
  signal?.addEventListener?.('abort', cancelNavigation, { once: true })
  try {
    try {
      await Promise.race([
        loadSourceWindowUrl(window, target, { signal }),
        new Promise((_, reject) => { rejectAborted = reject }),
        new Promise((_, reject) => {
          timeout = setTimeout(() => {
            try { window.webContents.stop() } catch { /* the window may already be closing */ }
            reject(new Error('Background page navigation timed out'))
          }, 45_000)
        }),
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
    if (signal?.aborted) throw new Error('Background page navigation aborted')
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 600))
    if (signal?.aborted) throw new Error('Background page navigation aborted')
    const text = await window.webContents.executeJavaScript('document.documentElement?.outerHTML || ""')
    const finalUrl = permittedSourceUrl(window.webContents.getURL() || target)
    await captureRenderedPage(finalUrl, text)
    return { url: finalUrl, text }
  } catch (error) {
    // Some Zhengfang pages keep a subresource open indefinitely. The DOM
    // document itself is still available through the authenticated renderer,
    // so fetch the same page from that context before discarding the window.
    const canUseRenderedFetch = !signal?.aborted
      && !window.isDestroyed()
      && /timed out|ERR_(?:ABORTED|FAILED|CONNECTION_RESET)|failed to load/iu.test(diagnosticError(error))
    if (canUseRenderedFetch) {
      try {
        const fallback = await fetchRenderedPageInWindow(window, target)
        const finalUrl = permittedSourceUrl(fallback.url || target)
        await captureRenderedPage(finalUrl, fallback.text)
        void writeDiagnostic('source.rendered_fetch_fallback', {
          source: sourceFromUrl(target),
          url: diagnosticUrl(target),
          reason: diagnosticError(error),
        })
        return fallback
      } catch (fallbackError) {
        void writeDiagnostic('source.rendered_fetch_fallback_failed', {
          source: sourceFromUrl(target),
          url: diagnosticUrl(target),
          error: diagnosticError(fallbackError),
        })
      }
    }
    // A timed-out or failed navigation can leave a hidden BrowserWindow with
    // a broken renderer. Reusing it causes every later sync to fail in the
    // same way, so discard it and let the next request create a clean window.
    if (currentWindow() === window) setCurrentWindow(null)
    await closeWindowAndWait(window)
    void writeDiagnostic('source.background_window_reset', {
      source: sourceFromUrl(target),
      url: diagnosticUrl(target),
      error: diagnosticError(error),
    })
    throw error
  } finally {
    signal?.removeEventListener?.('abort', cancelNavigation)
    if (theolLease && !window.isDestroyed()) window.__theiaTheolLease = false
  }
}

function loadWithSchoolBrowser(url, options = {}) {
  return loadWithBackgroundBrowser(url, {
    ...options,
    currentWindow: () => syncPageWindow,
    setCurrentWindow: (window) => { syncPageWindow = window },
    title: 'THEIA background sync',
    allowTheol: true,
  })
}

function loadWithFitnessBrowser(url, options = {}) {
  return loadWithBackgroundBrowser(url, {
    ...options,
    currentWindow: () => fitnessPageWindow,
    setCurrentWindow: (window) => { fitnessPageWindow = window },
    title: 'THEIA fitness sync',
    upgradeTyglRedirects: true,
  })
}

function loadSchoolPage(url, options = {}) {
  const priority = typeof options === 'number' ? options : Number(options?.priority) || 0
  const signal = typeof options === 'object' ? options?.signal || null : null
  return syncPageQueue.enqueue(() => loadWithSchoolBrowser(url, { signal }), { priority })
}

function loadFitnessBrowserPage(url, options = {}) {
  const priority = typeof options === 'number' ? options : Number(options?.priority) || 0
  const signal = typeof options === 'object' ? options?.signal || null : null
  return fitnessPageQueue.enqueue(() => loadWithFitnessBrowser(url, { signal }), { priority })
}

async function loadFitnessPageWithSchoolBrowser({ year } = {}) {
  const home = await loadWithFitnessBrowser('https://tygl.buct.edu.cn/')
  const window = fitnessPageWindow
  if (!window || window.isDestroyed()) throw new Error('Fitness browser is unavailable')
  const clickResult = await window.webContents.executeJavaScript(`(() => {
    const text = (element) => String(element?.innerText || element?.textContent || '').replace(/\\s+/g, ' ').trim()
    // The health cloud exposes this as a nested anchor. Clicking its parent
    // changes no location, so prefer the actual link before generic controls.
    const candidates = [...document.querySelectorAll('a[href], button, [role="button"], [onclick], li, div')]
      .filter((element) => element.offsetParent !== null && /体质测试|体测成绩|体质健康/.test(text(element)))
      .sort((left, right) =>
        Number(right.tagName === 'A') - Number(left.tagName === 'A')
        || text(left).length - text(right).length,
      )
    const target = candidates[0]
    if (!target) return { clicked: null }
    const label = text(target)
    const href = target.tagName === 'A' ? target.getAttribute('href') : null
    if (href && !/^javascript:/i.test(href)) return { clicked: label, href }
    target.click()
    return { clicked: label, href: null }
  })()`).catch(() => ({ clicked: null }))

  if (clickResult.href) {
    await loadWithFitnessBrowser(new URL(clickResult.href, home.url).toString())
  } else {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 900))
  }
  const yearLinks = await window.webContents.executeJavaScript(`(() => {
    const rank = (value) => {
      const match = String(value || '').match(/(20\\d{2})(?:\\D+(\\d+))?/)
      return match ? Number(match[1]) * 100 + Number(match[2] || 0) : -1
    }
    return [...document.querySelectorAll('a[href]')]
      .map((anchor) => {
        const href = anchor.getAttribute('href') || ''
        const yearKey = new URL(href, location.href).searchParams.get('year')
        return { label: String(anchor.textContent || '').trim(), href, yearKey }
      })
      .filter((entry) => /20\\d{2}/.test(entry.label) && /title=stu_ht_score/.test(entry.href) && entry.yearKey)
      .sort((left, right) => rank(right.label) - rank(left.label))
      .slice(0, 12)
  })()`).catch(() => [])

  const availableYears = yearLinks.map(({ label, yearKey }) => ({ label, yearKey }))
  const requestedYear = /^20\d{2}-20\d{2}_\d+$/.test(String(year || '')) ? String(year) : null
  const candidateYears = requestedYear
    ? yearLinks.filter((entry) => entry.yearKey === requestedYear)
    : yearLinks
  let linkedYear = null
  let selectedYearKey = null
  for (const yearLink of candidateYears) {
    await loadWithFitnessBrowser(new URL(yearLink.href, window.webContents.getURL() || home.url).toString())
    const measurementCount = await window.webContents.executeJavaScript(`(() => {
      const numeric = (value) => /\\d/.test(String(value || '').replace(/20\\d{2}/g, ''))
      for (const row of document.querySelectorAll('tr')) {
        const cells = [...row.querySelectorAll(':scope > td')].map((cell) => String(cell.textContent || '').trim())
        for (const [label, result] of [[cells[0], cells[1]], [cells[4], cells[5]]]) {
          if (/肺活量|50\\s*米|坐立.*前屈|立定|引体|仰卧|1000\\s*米|800\\s*米/.test(label || '') && numeric(result)) return 1
        }
      }
      return 0
    })()`).catch(() => 0)
    linkedYear = yearLink.label || null
    selectedYearKey = yearLink.yearKey || null
    if (measurementCount) break
  }

  await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_100))
  const text = await window.webContents.executeJavaScript('document.documentElement?.outerHTML || ""')
  const url = window.webContents.getURL() || home.url
  await captureRenderedPage(url, text)
  await writeDiagnostic('fitness.page_interacted', {
    url: diagnosticUrl(url),
    clicked: clickResult.clicked || null,
    selectedYear: linkedYear || null,
    bytes: Buffer.byteLength(text),
  })
  return { url, text, availableYears, yearKey: selectedYearKey }
}

function loadFitnessPage(options) {
  return fitnessPageQueue.enqueue(() => loadFitnessPageWithSchoolBrowser(options), { priority: 2 })
}

const FITNESS_YEAR_KEY = /^20\d{2}-20\d{2}_\d+$/

function requestedFitnessYear(value) {
  const year = String(value || '')
  return FITNESS_YEAR_KEY.test(year) ? year : null
}

function isAuthenticationFailure(error) {
  return error instanceof AuthRequiredError
    || /auth|login|credential|认证|登录/i.test(`${error?.name || ''} ${error?.code || ''} ${error?.message || ''}`)
}

async function fetchFitnessScoreFromSchool(year, expectedEpoch = authEpoch) {
  assertAuthEpoch(expectedEpoch)
  const selectedYear = requestedFitnessYear(year) || undefined
  const request = async () => {
    assertAuthEpoch(expectedEpoch)
    const priorityClient = new SessionClient(schoolSession, {
      pageLoader: (url, options = {}) => loadFitnessBrowserPage(url, { ...options, priority: 1 }),
      formLoader: (url, values, options) => submitFitnessForm(url, values, options),
      onDiagnostic: (event, fields) => writeDiagnostic(event, {
        ...fields,
        ...(fields.url ? { url: diagnosticUrl(fields.url) } : {}),
      }),
    })
    const result = await new TyglAdapter(priorityClient, { fitnessPageLoader: loadFitnessPage }).fetchScore({ year: selectedYear })
    assertAuthEpoch(expectedEpoch)
    return result
  }
  try {
    return await request()
  } catch (error) {
    if (error?.name !== 'AuthRequiredError') throw error
    assertAuthEpoch(expectedEpoch)
    const ready = await ensureFitnessSession({ expectedEpoch })
    assertAuthEpoch(expectedEpoch)
    if (!ready) throw new Error('健康云统一身份认证未完成，请确认已保存统一认证账号后重试')
    return request()
  }
}

async function importFitnessArchive(requestedYear, expectedEpoch = authEpoch) {
  assertAuthEpoch(expectedEpoch)
  const attemptedAt = new Date().toISOString()
  const runId = randomUUID()
  let first
  try {
    first = await fetchFitnessScoreFromSchool(requestedYear, expectedEpoch)
    assertAuthEpoch(expectedEpoch)
  } catch (error) {
    const completedAt = new Date().toISOString()
    await store.update((state) => failFitnessCatalog(state, {
      runId,
      attemptedAt,
      completedAt,
      status: isAuthenticationFailure(error) ? 'auth-required' : 'failed',
      errorCode: isAuthenticationFailure(error) ? 'fitness_auth_required' : 'fitness_read_failed',
    }))
    sendSnapshot()
    throw error
  }
  const results = [first]
  const failures = []
  const seen = new Set([first.yearKey].filter(Boolean))

  // One school visit establishes the list. Hydrate each missing year now so all
  // later switching is local and does not wait on the health-cloud UI again.
  for (const entry of first.availableYears || []) {
    if (!requestedFitnessYear(entry.yearKey) || seen.has(entry.yearKey)) continue
    try {
      const result = await fetchFitnessScoreFromSchool(entry.yearKey, expectedEpoch)
      assertAuthEpoch(expectedEpoch)
      results.push(result)
      if (result.yearKey) seen.add(result.yearKey)
    } catch (error) {
      failures.push({
        yearKey: entry.yearKey,
        status: isAuthenticationFailure(error) ? 'auth-required' : 'failed',
        errorCode: isAuthenticationFailure(error) ? 'fitness_auth_required' : 'fitness_year_read_failed',
      })
      void writeDiagnostic('fitness.year_cache_failed', {
        yearKey: entry.yearKey,
        error: diagnosticError(error),
      })
    }
  }

  const capturedAt = new Date().toISOString()
  assertAuthEpoch(expectedEpoch)
  const snapshot = await store.update((state) => ({
    ...updateFitnessCatalog(state, {
      results,
      failures,
      runId,
      attemptedAt,
      completedAt: capturedAt,
      capturedAt,
    }),
  }))
  assertAuthEpoch(expectedEpoch)
  sendSnapshot()
  return cachedFitnessResult(snapshot.dataCatalog, requestedYear || first.yearKey) || first
}

function isFitnessLoginPage(page) {
  return /experimental-auth-endpoint|统一身份认证|normal\/login|cas\/login/i.test(`${page?.url || ''}\n${page?.text || ''}`)
}

async function fitnessSessionReady() {
  try {
    return !isFitnessLoginPage(await loadFitnessBrowserPage('https://tygl.buct.edu.cn/', 2))
  } catch {
    return false
  }
}

async function ensureFitnessSession({ background = false, expectedEpoch = authEpoch } = {}) {
  assertAuthEpoch(expectedEpoch)
  if (await fitnessSessionReady()) {
    assertAuthEpoch(expectedEpoch)
    return true
  }
  assertAuthEpoch(expectedEpoch)
  await openLoginWindow({ background, sources: ['tygl'], expectedEpoch })
  assertAuthEpoch(expectedEpoch)
  const deadline = Date.now() + 35_000
  while (Date.now() < deadline) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 900))
    assertAuthEpoch(expectedEpoch)
    if (await fitnessSessionReady()) {
      assertAuthEpoch(expectedEpoch)
      return true
    }
    assertAuthEpoch(expectedEpoch)
  }
  return false
}

async function submitWithSchoolBrowser(rawUrl, values, { referer } = {}) {
  const url = permittedSourceUrl(rawUrl)
  if (referer) await loadWithSchoolBrowser(permittedSourceUrl(referer))
  if (!syncPageWindow || syncPageWindow.isDestroyed()) throw new Error('Background school browser is unavailable')
  const window = syncPageWindow
  const payload = JSON.stringify({ url, values: values || {} })
  let result
  try {
    result = await raceRenderedOperation(window.webContents.executeJavaScript(`(async ({ url, values }) => {
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
    if (syncPageWindow === window) syncPageWindow = null
    await closeWindowAndWait(window)
    void writeDiagnostic('source.background_form_window_reset', {
      source: sourceFromUrl(url),
      url: diagnosticUrl(url),
      error: diagnosticError(error),
    })
    throw error
  }
  await captureRenderedPage(result.url || url, result.text || '')
  return result
}

async function submitWithFitnessBrowser(rawUrl, values, { referer } = {}) {
  const url = permittedSourceUrl(rawUrl)
  if (sourceFromUrl(url) === 'theol') throw new Error('The fitness browser cannot submit to the course platform')
  if (referer) await loadWithFitnessBrowser(permittedSourceUrl(referer))
  const window = fitnessPageWindow
  if (!window || window.isDestroyed()) throw new Error('Fitness browser is unavailable')
  const payload = JSON.stringify({ url, values: values || {} })
  const result = await window.webContents.executeJavaScript(`(async ({ url, values }) => {
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
  })(${payload})`)
  await captureRenderedPage(result.url || url, result.text || '')
  return result
}

function submitSchoolForm(url, values, options) {
  return syncPageQueue.enqueue(() => submitWithSchoolBrowser(url, values, options), { priority: 0 })
}

async function loadBinaryWithSchoolBrowser(rawUrl, { signal = null } = {}) {
  return syncPageQueue.enqueue(async () => {
    const url = permittedSourceUrl(rawUrl)
    if (signal?.aborted) throw new Error('Background binary navigation aborted')
    let window = syncPageWindow
    if (!window || window.isDestroyed()) {
      await loadWithSchoolBrowser(JWGLXT_URLS.home, { signal })
      window = syncPageWindow
    }
    if (!window || window.isDestroyed()) throw new Error('Background school browser is unavailable')
    const payload = JSON.stringify({ url })
    const result = await window.webContents.executeJavaScript(`(async ({ url }) => {
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
    })(${payload})`)
    return {
      url: result?.url || url,
      status: Number(result?.status || 0),
      headers: new Headers({ 'content-type': String(result?.contentType || '') }),
      text: String(result?.text || ''),
      buffer: Buffer.from(String(result?.base64 || ''), 'base64'),
    }
  }, { priority: 0 })
}

function submitFitnessForm(url, values, options = {}) {
  const priority = Number(options?.priority) || 0
  return fitnessPageQueue.enqueue(() => submitWithFitnessBrowser(url, values, options), { priority })
}

async function flushPendingSourceOpens(source, epoch = authEpoch) {
  const requests = pendingSourceOpens.filter((request) => request.source === source)
  for (let index = pendingSourceOpens.length - 1; index >= 0; index -= 1) {
    if (pendingSourceOpens[index].source === source) pendingSourceOpens.splice(index, 1)
  }
  for (const request of requests) {
    if (explicitlyLoggedOut || epoch !== authEpoch) return
    try {
      await createSourceWindow(request.url, request.title, { pauseAssignments: source === 'theol' })
    }
    catch (error) { console.error('[THEIA] source window failed', error) }
  }
}

async function openSourceWindow(rawUrl, { title = '学校原站', expectedEpoch = authEpoch } = {}) {
  const epoch = expectedEpoch
  assertAuthEpoch(epoch)
  const url = permittedSourceUrl(rawUrl)
  const source = sourceFromUrl(url)
  const resumeAssignments = source === 'theol' ? syncService.pauseAssignmentScan() : null
  if (source) {
    try {
      if (source === 'theol') {
        await syncService.waitForAssignmentScan()
        assertAuthEpoch(epoch)
      }
      let status
      if (source === 'tygl') {
        status = { connected: await fitnessSessionReady() }
        assertAuthEpoch(epoch)
      } else {
        status = await verifiedStatus(source)
        assertAuthEpoch(epoch)
        if (!status) {
          status = source === 'theol'
            ? await syncService.runTheolExclusive(() => {
              assertAuthEpoch(epoch)
              return syncService.theol.status()
            })
            : await syncService[source].status()
          assertAuthEpoch(epoch)
        }
      }
      // Once this exact browser session has been verified, open the requested
      // page directly. The previous path loaded a second hidden BrowserWindow
      // and inspected its DOM before showing it, so every click paid the full
      // navigation cost twice from the user's perspective. A changed or
      // unknown cookie still takes the guarded hidden probe below.
      if (source !== 'theol' && status?.connected && verifiedSessions[source]) {
        await createSourceWindow(url, title, { pauseAssignments: false })
        assertAuthEpoch(epoch)
        resumeAssignments?.({ schedule: false })
        return true
      }
      // A configured academic API authenticates its own cookie jar and cannot
      // prove that an Electron source window is authenticated. Probe the
      // actual page in the shared browser partition before showing it when no
      // browser session has been verified yet. This also recovers a healthy
      // browser session that was not remembered yet.
      if (source !== 'theol') {
        const opened = await openAuthenticatedSourceWindow(url, title, { pauseAssignments: false })
        assertAuthEpoch(epoch)
        if (opened) {
          if (!verifiedSessions[source]) {
            await rememberVerifiedSession(source, opened.webContents.getURL() || status.url || url, epoch)
            assertAuthEpoch(epoch)
          }
          resumeAssignments?.({ schedule: false })
          return true
        }
      }
      if (!status.connected || source !== 'theol') {
        const credentials = await credentialVault.status().catch(() => ({ saved: false }))
        const actors = await openLoginWindow({
          background: Boolean(credentials?.saved),
          sources: [source],
          expectedEpoch: epoch,
          requireBrowser: source === 'jwglxt',
          skipSync: true,
        })
        assertAuthEpoch(epoch)

        // A source-page request is a foreground user action. When a saved
        // password exists, keep the login actor hidden and wait for its full
        // lifecycle before opening the requested page. The old code returned
        // as soon as the hidden login window was created, which made the
        // caller race the redirect and left the user staring at a login page
        // even though authentication completed moments later.
        if (credentials?.saved) {
          const actor = actors?.find?.((candidate) => candidate?.source === source)
          if (actor?.lifecycle) await actor.lifecycle
          assertAuthEpoch(epoch)
          if (!actor?.authenticated) {
            resumeAssignments?.({ schedule: false })
            throw new Error(`${source === 'jwglxt' ? '教务系统' : '学校平台'}自动认证未完成，请在认证窗口中完成验证后重试`)
          }
          const opened = await openAuthenticatedSourceWindow(url, title, { pauseAssignments: false, verified: true })
          assertAuthEpoch(epoch)
          resumeAssignments?.({ schedule: false })
          if (!opened) {
            verifiedSessions[source] = null
            throw new Error(`${source === 'jwglxt' ? '教务系统' : '学校平台'}认证已完成，但来源页面仍要求登录，请刷新后重试`)
          }
          return true
        }

        resumeAssignments?.({ schedule: false })
        return true
      }
      if (!verifiedSessions[source]) {
        await rememberVerifiedSession(source, status.url || url, epoch)
        assertAuthEpoch(epoch)
      }
    } catch (error) {
      resumeAssignments?.({ schedule: false })
      throw error
    }
  }
  try {
    assertAuthEpoch(epoch)
    await createSourceWindow(url, title, { pauseAssignments: source === 'theol' })
    assertAuthEpoch(epoch)
    resumeAssignments?.({ schedule: false })
  } catch (error) {
    resumeAssignments?.({ schedule: false })
    throw error
  }
  return true
}

function isCurrentAuthActor(actor, window = actor?.window) {
  if (!window) return false
  return authActorManager.isCurrent(actor, window)
}

function clearAuthActorTimers(actor) {
  if (actor.pollTimer) clearInterval(actor.pollTimer)
  actor.pollTimer = null
  if (actor.timeoutTimer) clearTimeout(actor.timeoutTimer)
  actor.timeoutTimer = null
  for (const timer of actor.credentialTimers) clearTimeout(timer)
  actor.credentialTimers.clear()
}

function removePendingSourceOpens(source) {
  for (let index = pendingSourceOpens.length - 1; index >= 0; index -= 1) {
    if (pendingSourceOpens[index].source === source) pendingSourceOpens.splice(index, 1)
  }
}

async function autoFillSavedCredentials(actor) {
  const window = actor?.window
  if (!isCurrentAuthActor(actor, window)) return
  const { source, epoch } = actor
  const authFrames = window.webContents.mainFrame.framesInSubtree.filter((frame) => {
    try { return new URL(frame.url).hostname === 'experimental-auth-endpoint.buct.edu.cn' }
    catch { return false }
  })
  if (!authFrames.length) return

  const credentials = await credentialVault.readCredentials()
  if (!isCurrentAuthActor(actor, window) || actor.epoch !== epoch) return
  if (!credentials) return
  const attemptKey = `${source}:unified:${credentials.updatedAt || ''}`
  if (credentialAttempts.get(window.webContents.id) === attemptKey) return
  // Mark the attempt before executing in the page. Multiple frame-load events
  // can otherwise submit the same central-authentication form concurrently.
  credentialAttempts.set(window.webContents.id, attemptKey)

  const payload = JSON.stringify(JSON.stringify({ username: credentials.username, password: credentials.password }))
  const script = `(({ username, password }) => {
    const documents = [document]
    for (const frame of document.querySelectorAll('iframe')) {
      try { if (frame.contentDocument) documents.push(frame.contentDocument) } catch {}
    }
    const visible = (element) => {
      const view = element.ownerDocument.defaultView
      const style = view.getComputedStyle(element)
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0
    }
    const setValue = (element, value) => {
      const view = element.ownerDocument.defaultView
      const reactSetter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value')?.set
      if (reactSetter) reactSetter.call(element, value)
      else element.value = value
      element.dispatchEvent(new view.Event('focus', { bubbles: true }))
      element.dispatchEvent(new view.Event('input', { bubbles: true }))
      element.dispatchEvent(new view.Event('change', { bubbles: true }))
      element.dispatchEvent(new view.Event('blur', { bubbles: true }))
    }
    // Collect all visible inputs for diagnostics
    const allInputs = [...document.querySelectorAll('input:not([type="hidden"])')].map(el => ({
      type: el.type, name: el.name, id: el.id, visible: visible(el), value: el.value?.length
    }))
    for (const current of documents) {
      const usernameInput = [...current.querySelectorAll(
        'input[name="username"], input[name="un"], input[id="un"], input[name="yhm"], input[id="yhm"]'
      )].find(visible)
      const passwordInput = [...current.querySelectorAll('input[type="password"]')].find(visible)
      const submit = [...current.querySelectorAll(
        'button.btn-submit, button[type="submit"], input[type="submit"], a.btn-login, button.login-btn'
      )].find(visible)
      if (!usernameInput || !passwordInput) continue
      setValue(usernameInput, username)
      setValue(passwordInput, password)
      if (submit) {
        setTimeout(() => submit.click(), 150)
        return { submitted: true, usernameField: usernameInput.name||usernameInput.id, usernameFilled: usernameInput.value === username, inputs: allInputs }
      }
    }
    return { submitted: false, inputs: allInputs }
  })(JSON.parse(${payload}))`
  for (const frame of authFrames) {
    const result = await frame.executeJavaScript(script)
    if (!isCurrentAuthActor(actor, window) || actor.epoch !== epoch) return
    const visibleInputs = result?.inputs?.filter((input) => input.visible) || []
    if (result?.submitted || visibleInputs.length) {
      void writeDiagnostic('auth.credentials_fill_result', {
        source,
        submitted: result?.submitted,
        usernameField: result?.usernameField,
        usernameFilled: result?.usernameFilled,
        inputs: visibleInputs,
      })
    }
    if (result?.submitted) {
      void writeDiagnostic('auth.credentials_submitted', { source, frame: diagnosticUrl(frame.url) })
      return
    }
  }
  if (isCurrentAuthActor(actor, window)) credentialAttempts.delete(window.webContents.id)
}

function scheduleCredentialFill(actor) {
  // Try filling at 0, 300, 800, 1500, 2500ms to handle slow CAS page loads
  for (const delay of [0, 300, 800, 1_500, 2_500]) {
    const timer = setTimeout(() => {
      actor.credentialTimers.delete(timer)
      if (!isCurrentAuthActor(actor)) return
      void autoFillSavedCredentials(actor).catch((error) => {
        if (isCurrentAuthActor(actor)) {
          void writeDiagnostic('auth.credentials_fill_failed', { source: actor.source, error: diagnosticError(error) })
        }
      })
    }, delay)
    actor.credentialTimers.add(timer)
  }
}

async function pollAuthStatus(actor) {
  const window = actor?.window
  if (!isCurrentAuthActor(actor, window) || actor.pollActive) return
  const { source, epoch } = actor
  actor.pollActive = true
  try {
    const sourceHost = source === 'jwglxt'
      ? 'jwglxt.buct.edu.cn'
      : source === 'tygl'
        ? 'tygl.buct.edu.cn'
        : 'course.buct.edu.cn'
    const sourceFrames = [...(window.webContents.mainFrame.framesInSubtree || [])].filter((frame) => {
      if (!frame) return false
      try { return new URL(frame.url).hostname === sourceHost }
      catch { return false }
    })
    let authenticatedUrl = null
    for (const frame of sourceFrames) {
      let html
      try {
        html = await frame.executeJavaScript('document.documentElement ? document.documentElement.outerHTML : ""')
      } catch (error) {
        // A frame can disappear between framesInSubtree and evaluation while
        // CAS is redirecting. Ignore that frame and keep polling the others.
        if (isCurrentAuthActor(actor, window) && diagnosticError(error) !== actor.lastPollError) {
          actor.lastPollError = diagnosticError(error)
          void writeDiagnostic('auth.frame_poll_skipped', { source, error: actor.lastPollError })
        }
        continue
      }
      if (!isCurrentAuthActor(actor, window) || actor.epoch !== epoch) return
      if (!html) continue
      const loggedIn = source === 'jwglxt'
        ? parseJwHomepage(html, frame.url).loggedIn
        : source === 'theol'
          ? parseTheolHome(html, frame.url).loggedIn
          : !/统一身份认证|normal\/login|cas\/login/i.test(html)
      if (loggedIn) {
        authenticatedUrl = frame.url
        break
      }
    }
    if (authenticatedUrl) {
      await rememberVerifiedSession(source, authenticatedUrl, epoch)
      if (!isCurrentAuthActor(actor, window) || actor.epoch !== epoch) return
      actor.authenticated = true
      actor.lastPollError = null
      authPendingSources.delete(source)
      void writeDiagnostic('auth.source_authenticated', { source, url: diagnosticUrl(authenticatedUrl) })
      window.__theiaAuthComplete = true
      clearAuthActorTimers(actor)
      window.close()
    }
  } catch (error) {
    const message = diagnosticError(error)
    if (isCurrentAuthActor(actor, window) && message !== actor.lastPollError) {
      actor.lastPollError = message
      void writeDiagnostic('auth.poll_failed', { source, error: message })
    }
  }
  finally { actor.pollActive = false }
}

async function sourceAlreadyAuthenticated(actor) {
  if (actor.source === 'tygl') return { connected: await fitnessSessionReady() }
  if (actor.requireBrowser && actor.source === 'jwglxt') {
    const adapter = syncService.jwglxt
    if (typeof adapter.browserStatus === 'function') return adapter.browserStatus()
    if (typeof adapter.browserAdapter?.status === 'function') return adapter.browserAdapter.status()
  }
  const verified = await verifiedStatus(actor.source)
  if (verified) return verified
  return syncService[actor.source].status()
}

async function runAuthActor(actor) {
  if (actor.source === 'theol') {
    actor.resumeAssignments = syncService.pauseAssignmentScan()
    await syncService.waitForAssignmentScan()
    if (actor.invalidated || actor.epoch !== authEpoch) return
  }

  const runLifecycle = async () => {
    if (actor.invalidated || actor.epoch !== authEpoch || authActors.get(actor.source) !== actor) return
    const status = await sourceAlreadyAuthenticated(actor)
    if (actor.invalidated || actor.epoch !== authEpoch || authActors.get(actor.source) !== actor) return
    if (status.connected) {
      actor.sessionReused = true
      if (!verifiedSessions[actor.source] && actor.source !== 'tygl') {
        await rememberVerifiedSession(actor.source, status.url || loginTargetDetails(actor.source).url, actor.epoch)
        if (actor.invalidated || actor.epoch !== authEpoch || authActors.get(actor.source) !== actor) return
      }
      actor.authenticated = true
      actor.resolveOpened()
      return
    }

    const target = loginTargetDetails(actor.source)
    const window = new BrowserWindow(sourceWindowOptions({ title: target.title, width: 1100, height: 760, show: !actor.background }))
    actor.window = window
    guardSourceWindow(window, {
      source: actor.source,
      theolActor: actor.source === 'theol' ? actor : null,
      theolLease: actor.source === 'theol',
      upgradeTyglRedirects: actor.source === 'tygl',
    })
    const webContentsId = window.webContents.id
    window.on('closed', () => {
      clearAuthActorTimers(actor)
      credentialAttempts.delete(webContentsId)
      actor.resolveOpened()
      if (actor.source !== 'theol') actor.resolveClosed()
      void writeDiagnostic('auth.window_closed', { source: actor.source, completed: Boolean(window.__theiaAuthComplete) })
    })
    window.webContents.on('did-navigate', (_event, url, httpResponseCode, _httpStatusText, isMainFrame) => {
      if (!isCurrentAuthActor(actor, window)) return
      void writeDiagnostic('auth.navigated', {
        source: actor.source,
        url: diagnosticUrl(url),
        httpResponseCode,
        isMainFrame,
      })
      scheduleCredentialFill(actor)
      void pollAuthStatus(actor)
    })
    window.webContents.on('did-navigate-in-page', () => {
      if (!isCurrentAuthActor(actor, window)) return
      scheduleCredentialFill(actor)
      void pollAuthStatus(actor)
    })
    window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isCurrentAuthActor(actor, window)) return
      void writeDiagnostic('auth.navigation_failed', {
        source: actor.source,
        errorCode,
        error: diagnosticError(errorDescription),
        url: diagnosticUrl(validatedURL),
        isMainFrame,
      })
    })
    window.webContents.on('did-frame-finish-load', () => scheduleCredentialFill(actor))
    actor.pollTimer = setInterval(() => { void pollAuthStatus(actor) }, 800)
    void writeDiagnostic('auth.target_loading', { source: actor.source, url: diagnosticUrl(target.url) })
    void loadSourceWindowUrl(window, target.url).catch((error) => {
      if (error?.code === 'ERR_ABORTED' || !isCurrentAuthActor(actor, window)) return
      void writeDiagnostic('auth.target_load_failed', { source: actor.source, error: diagnosticError(error) })
      console.error('[THEIA] authentication page failed to load', error)
    })
    scheduleCredentialFill(actor)
    void pollAuthStatus(actor)
    actor.resolveOpened()
    if (actor.background) {
      // Saved credentials are an unattended path. Keep the authentication
      // window hidden while the form and redirects are healthy; only expose
      // it after the bounded automatic attempt expires so the user can finish
      // a CAPTCHA, changed form, or other provider-side fallback manually.
      actor.timeoutTimer = setTimeout(() => {
        actor.timeoutTimer = null
        if (!isCurrentAuthActor(actor, window)) return
        void writeDiagnostic('auth.background_fallback_shown', {
          source: actor.source,
          timeoutMs: AUTH_BACKGROUND_TIMEOUT_MS,
        })
        window.show()
        window.focus()
      }, AUTH_BACKGROUND_TIMEOUT_MS)
    }
    await actor.closed
  }

  // Holding this lease for the complete THEOL login window lifetime also
  // serializes requests caused by form submission and redirect navigation.
  if (actor.source === 'theol') await syncService.runTheolExclusive(runLifecycle)
  else await runLifecycle()
}

async function finishAuthActor(actor) {
  actor.resolveOpened()
  clearAuthActorTimers(actor)
  actor.resumeAssignments?.({ schedule: false })
  actor.resumeAssignments = null
  if (authActors.get(actor.source) === actor) authActors.delete(actor.source)
  authPendingSources.delete(actor.source)
  if (!actor.authenticated) removePendingSourceOpens(actor.source)
  if (actor.invalidated || actor.epoch !== authEpoch || explicitlyLoggedOut) return
  const isCampusSource = actor.source === 'jwglxt' || actor.source === 'theol'
  // A user-facing CAS login may finish one service before the other service's
  // redirect has completed. Defer its data refresh until both page checks have
  // settled so one shared identity produces one coherent snapshot.
  const unifiedVerification = actor.authenticated && actor.userInitiated && isCampusSource
    ? requestUnifiedAuthVerification({ epoch: actor.epoch, sync: true, reason: 'user-login' })
    : null
  await broadcastAuthStatus({ sources: [actor.source] })
  if (!actor.authenticated || actor.epoch !== authEpoch || explicitlyLoggedOut) return
  const recovery = authRecovery[actor.source]
  recovery.lastAt = Date.now()
  recovery.failures = 0
  if (actor.source === 'theol') syncService.enableAssignmentScan({ schedule: false })
  if (isCampusSource && !unifiedVerification) {
    // A saved cookie/session is still a valid source of fresh data. The old
    // sessionReused shortcut made startup silently skip every existing record,
    // leaving the renderer with stale data and domains stuck at "等待本轮
    // 获取". Source-page actors explicitly set skipSync and remain cheap.
    const shouldRefresh = !actor.skipSync
    if (!shouldRefresh) {
      void writeDiagnostic('sync.post_auth_skipped', {
        source: actor.source,
        reason: actor.skipSync ? 'source_open' : 'session_reused',
      })
    }
    if (shouldRefresh) {
      try {
        // The actor lifecycle (and therefore the THEOL lease) has completed
        // before source-scoped synchronization is queued here.
        const syncOptions = actor.userInitiated
          ? {
            sources: [actor.source],
            domains: actor.source === 'jwglxt' ? FOREGROUND_JWGLXT_SYNC_DOMAINS : ['courses', 'notices'],
            foreground: true,
          }
          : { sources: [actor.source], domains: SILENT_AUTH_SYNC_DOMAINS[actor.source] || [] }
        if (actor.userInitiated) {
          await syncForegroundCampusData()
        } else {
          await syncService.syncNow(syncOptions)
        }
      } catch (error) {
        if (actor.epoch === authEpoch && !explicitlyLoggedOut) {
          void writeDiagnostic('sync.post_auth_failed', { source: actor.source, error: diagnosticError(error) })
        }
      }
    }
  }
  if (unifiedVerification) await unifiedVerification
  if (actor.epoch === authEpoch && !explicitlyLoggedOut) {
    await flushPendingSourceOpens(actor.source, actor.epoch)
    if (actor.source === 'jwglxt') scheduleAcademicStaticPrefetch({ reason: actor.skipSync ? 'source_open' : 'authenticated' })
  }
}

async function openLoginWindow({ background = false, sources, expectedEpoch = authEpoch, userInitiated = false, requireBrowser = false, skipSync = false } = {}) {
  assertAuthEpoch(expectedEpoch, { allowLoggedOut: userInitiated })
  if (userInitiated) {
    syncService.enable()
    explicitlyLoggedOut = false
    await courseWorkQueue?.setEnabled(true)
  }
  const requestedSources = Array.isArray(sources) && sources.length
    ? [...new Set(sources.filter((source) => AUTH_SOURCES.includes(source)))]
    : ['theol', 'jwglxt']
  void writeDiagnostic('auth.open_requested', { background, sources: requestedSources })
  const actors = await authActorManager.open({
    background,
    requestedSources,
    expectedEpoch,
    userInitiated,
    skipSync: skipSync || (!userInitiated && !background
      && requestedSources.length === 1 && requestedSources[0] === 'jwglxt'),
    // The JWGLXT API and the rendered browser use separate cookie jars. Any
    // JWGLXT login actor must therefore establish the browser session too.
    requireBrowser: requireBrowser
      || (requestedSources.includes('jwglxt') && (requestedSources.length === 1 || background)),
  })
  assertAuthEpoch(expectedEpoch)
  // Publish the intermediate state immediately. The renderer can then show a
  // neutral CAS-verification indicator while either campus redirect is still
  // open instead of retaining an old warning from the previous probe.
  void broadcastAuthStatus()
  return actors
}

async function closeLiveCaptureActors(reason = 'live capture finished') {
  const actors = authActorManager.invalidateAll({ reason, pendingSourceOpens })
  await Promise.allSettled(actors.flatMap((actor) => [
    actor.window,
    ...(actor.windows ? [...actor.windows] : []),
  ].filter((window) => window && !window.isDestroyed()).map((window) => closeWindowAndWait(window))))
  await Promise.allSettled(actors.map((actor) => actor.lifecycle))
}

async function waitForLiveCaptureAuthentication(actors, timeoutMs = 120_000) {
  const lifecycle = Promise.all((actors || []).map((actor) => actor.lifecycle || Promise.resolve()))
  let timer
  try {
    await Promise.race([
      lifecycle,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`教务浏览器认证超时（${timeoutMs} ms）`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
  const status = await verifiedStatus('jwglxt')
  if (!status?.connected) throw new AuthRequiredError('Academic system', status?.url || JWGLXT_URLS.home)
  return status
}

async function runLiveCapture() {
  if (!liveCaptureOutput) throw new Error('live capture output is not configured')
  const output = liveCaptureOutput
  await mkdir(output, { recursive: true })
  const startedAt = new Date().toISOString()
  const runStartedMs = Date.now()
  const diagnostics = { browser: [], api: [] }
  const diagnosticFor = (channel) => (event, fields = {}) => {
    const safe = { event, ...fields }
    if (safe.error) safe.error = diagnosticError(safe.error)
    if (safe.url) safe.url = diagnosticUrl(safe.url)
    if (safe.referer) safe.referer = diagnosticUrl(safe.referer)
    diagnostics[channel].push(safe)
    void writeDiagnostic(`live_capture.${channel}.${event}`, safe)
  }

  await schoolProxyReady.catch(() => undefined)
  const authStartedMs = Date.now()
  let authStatus = null
  let authError = null
  let apiBootstrapClient = null
  try {
    const actors = await openLoginWindow({
      background: true,
      sources: ['jwglxt'],
      expectedEpoch: authEpoch,
      requireBrowser: true,
      skipSync: true,
    })
    authStatus = await waitForLiveCaptureAuthentication(actors, 25_000)
  } catch (error) {
    authError = diagnosticError(error)
    // The real CAS page may require an interactive anti-bot slider. Do not
    // synthesize or bypass that challenge. For this isolated capture command,
    // use the already-authorized direct API account only to seed a temporary
    // browser cookie jar, then continue through rendered page/fetch requests.
    await closeLiveCaptureActors('live capture auth fallback')
    try {
      const credentialStatus = await academicApiVault.status()
      if (!credentialStatus.saved || credentialStatus.error) throw error
      const credentials = await academicApiVault.readCredentials()
      apiBootstrapClient = new AcademicApiClient({ ...credentials, onDiagnostic: diagnosticFor('api') })
      await apiBootstrapClient.login()
      const apiCookieNames = [...apiBootstrapClient.cookies.keys()]
      const browserCookieUrl = 'https://jwglxt.buct.edu.cn/jwglxt/'
      const existingBrowserCookies = await schoolSession.cookies.get({ url: browserCookieUrl })
      for (const cookie of existingBrowserCookies) {
        if (cookie.name === 'JSESSIONID' || apiCookieNames.includes(cookie.name)) {
          await schoolSession.cookies.remove(browserCookieUrl, cookie.name).catch(() => undefined)
        }
      }
      for (const [name, value] of apiBootstrapClient.cookies.entries()) {
        await schoolSession.cookies.set({
          url: browserCookieUrl,
          name,
          value,
          path: '/',
          secure: true,
          httpOnly: true,
        })
      }
      void writeDiagnostic('live_capture.api_cookie_bridge', {
        names: apiCookieNames,
        browserCookiesAfterSet: (await schoolSession.cookies.get({ url: browserCookieUrl })).map((cookie) => cookie.name),
      })
      const browserStatus = await new JwglxtAdapter(academicSessionClient, {
        onDiagnostic: diagnosticFor('browser'),
      }).status()
      if (!browserStatus.connected) {
        void writeDiagnostic('live_capture.api_cookie_bridge_failed', {
          status: { connected: browserStatus.connected, error: browserStatus.error || null, url: browserStatus.url || null },
        })
        throw new Error(browserStatus.error || 'API 会话未能在页面上下文中建立')
      }
      authStatus = {
        ...browserStatus,
        mode: 'direct-api-cookie-bridge-for-rendered-capture',
        fallbackFrom: authError,
      }
      authError = null
    } catch (fallbackError) {
      authError = diagnosticError(fallbackError)
      await writeLiveCaptureJson(output, 'auth-error.json', {
        error: authError,
        fallbackFrom: diagnosticError(error),
        elapsedMs: Date.now() - authStartedMs,
        status: await verifiedStatus('jwglxt').catch(() => null),
      })
      throw fallbackError
    }
  }

  const browserAttachmentStore = createLiveCaptureAttachmentStore(output, 'browser')
  const apiAttachmentStore = createLiveCaptureAttachmentStore(output, 'api')
  let browserCapture = null
  let apiCapture = null
  let apiError = null
  try {
    const browserAdapter = new JwglxtAdapter(academicSessionClient, {
      attachmentStore: browserAttachmentStore,
      onDiagnostic: diagnosticFor('browser'),
    })
    const browserStartedAt = new Date().toISOString()
    const browserStartedMs = Date.now()
    const browserResult = await browserAdapter.sync({ includeAcademicExtras: true })
    browserCapture = {
      mode: 'authenticated-browser-session-rendered',
      startedAt: browserStartedAt,
      completedAt: new Date().toISOString(),
      elapsedMs: Date.now() - browserStartedMs,
      auth: authStatus,
      counts: liveCaptureResultCounts(browserResult),
      result: browserResult,
    }
    await writeLiveCaptureJson(output, 'browser-result.json', browserCapture)
  } catch (error) {
    const message = diagnosticError(error)
    await writeLiveCaptureJson(output, 'browser-error.json', { error: message })
    throw error
  }

  try {
    const credentialStatus = await academicApiVault.status()
    if (!credentialStatus.saved || credentialStatus.error) {
      apiError = credentialStatus.error || 'saved API credentials are unavailable'
    } else {
      const credentials = await academicApiVault.readCredentials()
      const apiClient = apiBootstrapClient || new AcademicApiClient({ ...credentials, onDiagnostic: diagnosticFor('api') })
      const apiAdapter = new JwglxtAdapter(apiClient, {
        academicProgressSource: 'api',
        attachmentStore: apiAttachmentStore,
        scheduleEndpoints: ['kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151', 'kbcx/xskbcx_cxXsgrkb.html'],
        onDiagnostic: diagnosticFor('api'),
      })
      const apiStartedAt = new Date().toISOString()
      const apiStartedMs = Date.now()
      if (!apiBootstrapClient) await apiClient.login()
      const apiResult = await apiAdapter.sync({ includeAcademicExtras: true })
      apiCapture = {
        mode: 'direct-api-client',
        startedAt: apiStartedAt,
        completedAt: new Date().toISOString(),
        elapsedMs: Date.now() - apiStartedMs,
        counts: liveCaptureResultCounts(apiResult),
        result: apiResult,
      }
      await writeLiveCaptureJson(output, 'api-result.json', apiCapture)
    }
  } catch (error) {
    apiError = diagnosticError(error)
    await writeLiveCaptureJson(output, 'api-error.json', { error: apiError })
  }

  const comparison = compareLiveCaptureResults(browserCapture, apiCapture)
  await writeLiveCaptureJson(output, 'comparison.json', comparison)
  await writeLiveCaptureJson(output, 'browser-request-log.json', pageCaptureLog)
  await writeLiveCaptureJson(output, 'diagnostics.json', diagnostics)
  await writeLiveCaptureJson(output, 'run-meta.json', {
    schema: 'theia-live-capture/v2',
    startedAt,
    completedAt: new Date().toISOString(),
    elapsedMs: Date.now() - runStartedMs,
    output,
    browser: {
      mode: browserCapture?.mode || null,
      elapsedMs: browserCapture?.elapsedMs || null,
      requestCount: pageCaptureLog.length,
      error: browserCapture ? null : authError,
    },
    api: {
      mode: apiCapture?.mode || null,
      elapsedMs: apiCapture?.elapsedMs || null,
      error: apiError,
    },
    auth: {
      verified: Boolean(authStatus?.connected),
      elapsedMs: Date.now() - authStartedMs,
    },
  })
  return { output, browser: browserCapture?.counts || null, api: apiCapture?.counts || null, apiError }
}

async function migrateFromLegacyDir() {
  // A custom data root is an isolation boundary for smoke tests and managed
  // installs, so legacy APPDATA is consulted only on the default path.
  try {
    const migrated = await migrateLegacyDataFiles({
      currentRoot: app.getPath('userData'),
      legacyRoot: legacyDataRoot(),
    })
    for (const entry of migrated) {
      if (entry.filesCopied || entry.directoriesCreated) {
        console.log(`[THEIA] Migrated ${entry.name} from legacy BUCT directory (${entry.filesCopied} files)`)
      }
      for (const issue of entry.issues) {
        console.warn(`[THEIA] Legacy migration skipped ${issue.path} (${issue.kind}${issue.code ? `, ${issue.code}` : ''})`)
      }
    }
  } catch (error) {
    // A locked or inaccessible legacy profile must not make the new client
    // unusable. The warning keeps an incomplete migration visible and retryable.
    console.warn('[THEIA] Legacy BUCT migration was incomplete; startup will continue', error)
  }
}

async function restartLocalApi(preferredPort) {
  const previous = localApi
  if (previous?.port === preferredPort) return previous
  const restart = () => startLocalApi({
      store,
      root: app.getPath('userData'),
      preferredPort,
      academicCalendarAssetsService,
      publishRuntime: false,
    })
  let next
  try {
    next = await restart()
    await next.publishRuntime()
    localApi = next
    if (previous && previous !== next) await previous.close()
  } catch (error) {
    await next?.close().catch(() => undefined)
    localApi = previous
    await previous?.publishRuntime().catch(() => undefined)
    throw error
  }
  return next
}

async function startServices() {
  store = new CampusStore(app.getPath('userData'))
  const storeStartedAt = Date.now()
  await store.load()
  try {
    const workspaceMigration = await rebaseLegacyWorkspacePaths(store.snapshot(), {
      currentRoot: app.getPath('userData'),
      legacyRoot: legacyDataRoot(),
    })
    if (workspaceMigration.changed) {
      await store.replace(workspaceMigration.state)
      console.log(`[THEIA] Rebased ${workspaceMigration.pathsRebased} legacy course-work paths`)
    }
  } catch (error) {
    console.warn('[THEIA] Legacy course-work paths could not be rebased; startup will continue', error)
  }
  store.subscribe((snapshot) => queueTheiaFeed(snapshot))
  void queueTheiaFeed(store.snapshot())
  void writeDiagnostic('data.store_loaded', {
    elapsedMs: Date.now() - storeStartedAt,
    updatedAt: store.state.updatedAt,
    counts: { schedule: store.state.schedule.length, grades: store.state.grades.length, assignments: store.state.assignments.length },
  })
  credentialVault = new CredentialVault(app.getPath('userData'), safeStorage)
  academicApiVault = new AcademicApiVault(app.getPath('userData'), safeStorage)
  academicAttachmentStore = new JwglxtAttachmentStore(app.getPath('userData'))
  await normalizeAcademicPlanAttachmentCache().catch((error) => writeDiagnostic('jwglxt.attachment_migration_failed', { error: diagnosticError(error) }))
  mailVault = new MailVault(app.getPath('userData'), safeStorage)
  courseSelectionJournal = new CourseSelectionJournal(app.getPath('userData'))
  await courseSelectionJournal.load()
  academicCalendarAssetsService = new AcademicCalendarAssetsService({
    root: app.getPath('userData'),
    onDiagnostic: (event, fields) => writeDiagnostic(event, fields),
    profileProvider: () => store?.snapshot()?.profile || null,
    coursesProvider: () => store?.snapshot()?.courses || [],
    academicTrackProvider: () => store?.snapshot()?.profile?.academicTrack || null,
  })
  const calendarManifest = await academicCalendarAssetsService.load()
  await store.update((state) => loadAcademicCalendarCatalog(state, { manifest: calendarManifest, runId: randomUUID() }))
  // Complete one authoritative refresh before exposing the advisor runtime.
  // Previously this was fire-and-forget at the end of startup, so an early
  // question could build a workspace from the old/empty calendar manifest.
  // A failed refresh is intentionally non-fatal: the catalog layer retains
  // the last successful calendar and records the failed attempt.
  if (!smokeFile) {
    await refreshAcademicCalendarAssets({ trigger: 'startup' })
      .catch((error) => writeDiagnostic('academic_calendar.refresh_failed', { error: diagnosticError(error) }))
  }
  advisorUpgradeRule = await loadTrustedUpgradeRule({
    root: app.getPath('userData'),
    onDiagnostic: (event, fields) => writeDiagnostic(event, fields),
  })
  schoolSession = session.fromPartition(PARTITION)
  // School endpoints stay off the system proxy by default. This avoids routing
  // campus traffic through a local Clash-style port (for example 127.0.0.1:7897)
  // unless a future, explicit proxy preference opts into it.
  const proxyStartedAt = Date.now()
  schoolProxyReady = schoolSession.setProxy({ mode: 'direct' })
    .then(() => {
      void writeDiagnostic('network.proxy_ready', { elapsedMs: Date.now() - proxyStartedAt, mode: 'direct' })
    })
    .catch((error) => {
      void writeDiagnostic('network.proxy_error', { elapsedMs: Date.now() - proxyStartedAt, error: diagnosticError(error) })
    })
  // Intercept all requests from the school session and replace headers with standard Chrome values.
  // Some school servers (jwglxt / MEOL) return 503 when they detect Electron in User-Agent or
  // when non-browser headers (like Sec-CH-UA with Electron) are present.
  const chromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
  schoolSession.setUserAgent(chromeUA)
  schoolSession.webRequest.onBeforeSendHeaders({ urls: ['*://*.buct.edu.cn/*', '*://buct.edu.cn/*'] }, (details, callback) => {
    const headers = { ...details.requestHeaders }
    headers['User-Agent'] = chromeUA
    headers['Accept'] = headers['Accept'] || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
    headers['Accept-Language'] = 'zh-CN,zh;q=0.9,en;q=0.8'
    headers['Sec-CH-UA'] = '"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"'
    headers['Sec-CH-UA-Mobile'] = '?0'
    headers['Sec-CH-UA-Platform'] = '"Windows"'
    // Remove Electron-specific headers that may trigger server-side bot detection
    delete headers['X-Electron-Version']
    delete headers['X-Requested-With']
    callback({ requestHeaders: headers })
  })
  // THEOL keeps a single rendered browser because its course/task links depend
  // on mutable course context. Other school tools also retain this browser path.
  sessionClient = new SessionClient(schoolSession, {
    pageLoader: smokeFile ? null : loadSchoolPage,
    formLoader: smokeFile ? null : submitSchoolForm,
    onDiagnostic: (event, fields) => writeDiagnostic(event, {
      ...fields,
      ...(fields.url ? { url: diagnosticUrl(fields.url) } : {}),
      ...(fields.referer ? { referer: diagnosticUrl(fields.referer) } : {}),
    }),
  })
  // JWGLXT is also a rendered-browser source. Reuse the exact browser cookies
  // and execute its page/form requests in the hidden school BrowserWindow so
  // the page-simulation path is exercised instead of silently falling back to
  // a plain session fetch. The shared queue keeps JWGLXT and THEOL navigation
  // from racing the single mutable school window.
  academicSessionClient = new SessionClient(schoolSession, {
    pageLoader: smokeFile ? null : loadSchoolPage,
    formLoader: smokeFile ? null : submitSchoolForm,
    binaryLoader: smokeFile ? null : loadBinaryWithSchoolBrowser,
    onDiagnostic: (event, fields) => writeDiagnostic(event, {
      ...fields,
      ...(fields.url ? { url: diagnosticUrl(fields.url) } : {}),
      ...(fields.referer ? { referer: diagnosticUrl(fields.referer) } : {}),
    }),
  })
  courseWorkService = new CourseWorkService({ root: app.getPath('userData'), store, client: sessionClient })
  modelVault = new ModelVault(app.getPath('userData'), safeStorage)
  try {
    const recovery = await recoverModelConfigTransaction({ store, vault: modelVault })
    if (recovery.recovered) void writeDiagnostic('model.configuration_recovered', {})
  } catch (error) {
    // Exact service-identity binding keeps a mismatched key unusable. Preserve
    // a damaged journal for diagnosis instead of guessing which side to trust.
    void writeDiagnostic('model.configuration_recovery_failed', { error: diagnosticError(error) })
  }
  modelService = new ModelService({ vault: modelVault, courseWork: courseWorkService })
  advisorThreadStore = new AdvisorStore({
    root: app.getPath('userData'),
    storage: safeStorage,
    onDiagnostic: (event, fields) => writeDiagnostic(event, fields),
  })
  const persistedAdvisorThreads = await advisorThreadStore.load()

  // Rebuild runtime when budgetLevel changes
  const rebuildAdvisorRuntime = async () => {
    const advisorBudgetLevel = store.state.settings.advisorConfig?.budgetLevel || 'high'
    const { ADVISOR_BUDGET_PRESETS } = await import('./advisor-runtime.mjs')
    const advisorBudget = ADVISOR_BUDGET_PRESETS[advisorBudgetLevel] || ADVISOR_BUDGET_PRESETS.high
    const currentThreads = Array.from(advisorRuntime?.threads.values() || [])
    advisorRuntime = new AdvisorRuntime({
      store,
      modelService,
      ensureDataReady: async () => {
        await academicCalendarRefreshInFlight?.catch(() => undefined)
      },
      onDiagnostic: (event, fields) => writeDiagnostic(event, fields),
      threadStore: advisorThreadStore,
      initialThreads: currentThreads.length ? currentThreads : persistedAdvisorThreads,
      onStream: (event) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('theia:advisor:stream', event)
      },
      budget: advisorBudget,
      agentOperations: {
        outputDirectory: resolve(app.getPath('documents'), 'THEIA Agent'),
        syncCampusData: (request) => syncAdvisorCampusData(request),
        networkRequest: (request) => executeAdvisorNetworkRequest(request),
        openCampusSource: async ({ url }) => {
          const epoch = authEpoch
          assertAuthEpoch(epoch)
          await schoolProxyReady.catch(() => undefined)
          assertAuthEpoch(epoch)
          const opened = await openSourceWindow(url, { title: 'THEIA Agent · 校园来源', expectedEpoch: epoch })
          return { opened, host: new URL(url).hostname }
        },
        updateSettings: async ({ settings }) => applyTheiaSettings(settings),
        controlCourseSelection: async ({ action }) => {
          if (action === 'stop') {
            courseSelectionService.stop()
          } else {
            const targets = courseSelectionJournal?.snapshot()?.targets || []
            if (!targets.length) throw new Error('没有已保存的选课目标，无法启动选课任务')
            courseSelectionService.start({ targets })
          }
          sendCourseSelectionSnapshot()
          const snapshot = courseSelectionSnapshot()
          return { action, active: Boolean(snapshot.active), targetCount: snapshot.targets.length }
        },
        readFile: (request) => readAgentFile(request),
        writeFile: (request) => writeAgentFile(request),
        listDirectory: (request) => listAgentDirectory(request),
        createDirectory: (request) => createAgentDirectory(request),
        deletePath: (request) => deleteAgentPath(request),
        runCommand: (request) => runAgentCommand(request),
        webRequest: (request) => executeAgentWebRequest(request),
        openWebpage: (request) => openAgentWebpage(request),
      },
    })
  }

  const applyTheiaSettings = async (next) => {
    const allowed = next && typeof next === 'object' ? next : {}
    const previousAdvisorBudgetLevel = store.snapshot().settings.advisorConfig?.budgetLevel
    if (typeof allowed.academicApiEnabled === 'boolean') courseSelectionApiClient = null
    const snapshot = await updateSettingsTransaction({
      store,
      next: allowed,
      restartLocalApi,
      configureAutoSync: (enabled, interval) => syncService.configureAutoSync(enabled, interval),
      configureMail: (config) => mailService.configure(config),
      publishSnapshot: sendSnapshot,
    })
    if (allowed.advisorConfig?.budgetLevel && allowed.advisorConfig.budgetLevel !== previousAdvisorBudgetLevel) {
      await rebuildAdvisorRuntime()
    }
    return snapshot
  }

  await rebuildAdvisorRuntime()
  webmailService = new WebmailService({
    store,
    vault: mailVault,
    createWindow: createMailBrowserWindow,
    onChange: sendSnapshot,
    onDiagnostic: (event, fields) => writeDiagnostic(event, fields),
    // IMAP is the automated source. The web window stays manual so a partial
    // page render can never replace the complete IMAP inbox snapshot.
    pollOnNavigation: false,
  })
  mailService = new ImapMailService({
    store,
    vault: mailVault,
    onChange: sendSnapshot,
    onDiagnostic: (event, fields) => writeDiagnostic(event, fields),
    openWebmail: () => webmailService.open(),
    onNewMail: (mail) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('theia:new-mail', mail)
      if (Notification.isSupported()) {
        new Notification({
          title: 'THEIA · 校园邮箱',
          body: `${mail.from || '新邮件'}\n${mail.subject || '(无主题)'}`.slice(0, 500),
          silent: false,
        }).show()
      }
    },
  })
  syncService = new SyncService({
    store,
    jwglxt: new AcademicApiFirstAdapter({
      browserAdapter: new JwglxtAdapter(academicSessionClient, { attachmentStore: academicAttachmentStore }),
      credentialVault: academicApiVault,
      isEnabled: () => store.snapshot().settings.academicApiEnabled,
      onDiagnostic: (event, fields) => writeDiagnostic(event, fields),
      adapterFactory: (client) => new JwglxtAdapter(client, {
        academicProgressSource: 'api',
        attachmentStore: academicAttachmentStore,
        scheduleEndpoints: ['kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151', 'kbcx/xskbcx_cxXsgrkb.html'],
      }),
    }),
    theol: new TheolAdapter(sessionClient),
    onProgress: (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('theia:sync-progress', progress)
    },
    onBackgroundError: (error) => {
      void writeDiagnostic('sync.theol_assignments_background_failed', { error: diagnosticError(error) })
    },
    onChange: (snapshot) => {
      sendSnapshot()
      void writeDiagnostic('sync.updated', {
        runId: snapshot.sync?.runId || null,
        lastRunAt: snapshot.sync?.lastRunAt || snapshot.sync?.lastCompletedAt || null,
        lastSuccessAt: snapshot.sync?.lastSuccessAt || null,
        error: snapshot.sync?.lastError || null,
        jwglxt: snapshot.sync?.sources?.jwglxt?.error || null,
        theol: snapshot.sync?.sources?.theol?.error || null,
        counts: {
          courses: snapshot.courses.length,
          schedule: snapshot.schedule.length,
          exams: snapshot.exams.length,
          grades: snapshot.grades.length,
          selectedCourses: snapshot.selectedCourses.length,
          academicProgressCategories: snapshot.academicProgress?.categories?.length || 0,
          assignments: snapshot.assignments.length,
          notices: snapshot.notices.length,
        },
      })
    },
    onAuthRequired: (sources) => {
      const recoverySources = [...new Set(sources)]
        .filter((source) => ['jwglxt', 'theol'].includes(source))
      for (const source of recoverySources) verifiedSessions[source] = null
      void writeDiagnostic('sync.auth_required', { sources: recoverySources })
      if (explicitlyLoggedOut || !recoverySources.length) {
        void writeDiagnostic('sync.auth_recovery_stopped', {
          sources: recoverySources,
          reason: explicitlyLoggedOut ? 'explicit_logout' : 'no_supported_sources',
        })
        return
      }
      const epoch = authEpoch
      const eligibleSources = recoverySources.filter((source) => {
        const actor = authActors.get(source)
        if (actor && !actor.invalidated && actor.epoch === epoch) {
          void writeDiagnostic('sync.auth_recovery_already_running', { sources: [source] })
          return false
        }
        const recovery = authRecovery[source]
        const elapsed = Date.now() - recovery.lastAt
        if (recovery.inFlight) {
          void writeDiagnostic('sync.auth_recovery_already_running', { sources: [source] })
          return false
        }
        if (elapsed >= 0 && elapsed < AUTH_RECOVERY_COOLDOWN_MS) {
          void writeDiagnostic('sync.auth_recovery_deferred', { sources: [source], retryAfterMs: AUTH_RECOVERY_COOLDOWN_MS - elapsed })
          return false
        }
        if (recovery.failures >= AUTH_RECOVERY_MAX_ATTEMPTS) {
          void writeDiagnostic('sync.auth_recovery_stopped', { sources: [source], attempts: recovery.failures })
          return false
        }
        recovery.inFlight = true
        recovery.lastAt = Date.now()
        recovery.failures += 1
        return true
      })
      if (!eligibleSources.length) return
      void credentialVault.status().then((status) => {
        if (!status.saved || explicitlyLoggedOut || epoch !== authEpoch) return
        return openLoginWindow({ background: true, sources: eligibleSources, expectedEpoch: epoch })
          .then(async () => {
            // openLoginWindow resolves when the windows are ready. Keep the
            // recovery single-flight occupied until every actor actually
            // closes, otherwise each failed sync opens another CAS window.
            await Promise.all(eligibleSources.map((source) => authActors.get(source)?.lifecycle || Promise.resolve()))
          })
          .catch((error) => writeDiagnostic('auth.recovery_failed', { sources: eligibleSources, error: diagnosticError(error) }))
      }).finally(() => {
        for (const source of eligibleSources) authRecovery[source].inFlight = false
      })
    },
  })
  courseSelectionService = new CourseSelectionService({
    client: sessionClient,
    courseSelectionClientFactory: courseSelectionApiSession,
    academicClientFactory: async () => {
      const credentials = await academicApiVault.readCredentials()
      return credentials ? new AcademicApiClient(credentials) : null
    },
    getState: () => store.snapshot(),
    onChange: (snapshot) => {
      void courseSelectionJournal.recordJob(snapshot)
        .catch((error) => writeDiagnostic('course_selection.journal_write_failed', { error: diagnosticError(error) }))
      void courseSelectionJournal.updateSentinel(snapshot)
        .then(() => sendCourseSelectionSnapshot())
        .catch((error) => writeDiagnostic('course_selection.sentinel_write_failed', { error: diagnosticError(error) }))
      sendCourseSelectionSnapshot()
    },
    onSuccess: async () => {
      await syncForegroundCampusData()
      scheduleAcademicStaticPrefetch({ reason: 'course_selection' })
    },
    onSchoolSchedule: async (result) => {
      const completedAt = new Date().toISOString()
      await store.update((state) => updateSchoolScheduleCatalog(state, {
        result,
        runId: randomUUID(),
        attemptedAt: result?.capturedAt || completedAt,
        completedAt,
      }))
      sendSnapshot()
    },
  })
  void armCourseSelectionSentinel().catch((error) => writeDiagnostic('course_selection.sentinel_resume_failed', { error: diagnosticError(error) }))
  syncService.configureAutoSync(store.state.settings.autoSync, store.state.settings.syncIntervalMinutes)
  mailService.configure(store.state.settings.mail)
  const notifiedQueueJobs = new Set()
  let courseWorkQueueReady = false
  courseWorkQueue = new CourseWorkQueue({
    root: app.getPath('userData'),
    concurrency: 1,
    onDiagnostic: (event, fields) => writeDiagnostic(event, fields),
    onChange: (queueSnapshot) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('theia:course-work-queue', queueSnapshot)
      for (const job of queueSnapshot.jobs || []) {
        if (!job.completedAt || !['succeeded', 'failed', 'cancelled'].includes(job.status)) continue
        const notificationKey = `${job.id}:${job.status}:${job.updatedAt}`
        if (notifiedQueueJobs.has(notificationKey)) continue
        notifiedQueueJobs.add(notificationKey)
        if (courseWorkQueueReady && Notification.isSupported()) {
          const title = job.status === 'succeeded' ? 'THEIA · 课程任务完成' : 'THEIA · 课程任务未完成'
          new Notification({
            title,
            body: `${job.assignmentId} · ${job.lastError || '本地结果已保存'}`.slice(0, 500),
            silent: false,
          }).show()
        }
      }
    },
    processor: async ({ job, signal }) => {
      const epoch = authEpoch
      const assertCurrent = () => {
        if (signal.aborted) throw signal.reason || new Error('后台课程任务已取消')
        assertAuthEpoch(epoch)
      }
      assertCurrent()
      let result
      if (job.operation === 'prepare') {
        result = await syncService.runTheolInteraction(() => {
          assertCurrent()
          return courseWorkService.prepare(job.assignmentId)
        })
      } else if (job.operation === 'model') {
        result = await modelService.process(job.assignmentId, store.snapshot().settings)
      } else if (job.operation === 'notes') {
        result = await modelService.generateNotes(job.assignmentId, store.snapshot().settings, job.options)
      } else if (job.operation === 'paper') {
        result = await modelService.generatePaper(job.assignmentId, store.snapshot().settings, job.options)
      } else {
        const error = new Error('不支持的后台课程任务操作')
        error.retryable = false
        throw error
      }
      assertCurrent()
      sendSnapshot()
      return { status: job.operation, message: '本地结果已保存' }
    },
  })
  await courseWorkQueue.load()
  courseWorkQueueReady = true
  localApi = await startLocalApi({ store, root: app.getPath('userData'), preferredPort: store.state.settings.apiPort, academicCalendarAssetsService })
  if (localApi.port !== store.state.settings.apiPort) {
    await store.update((state) => ({ ...state, settings: { ...state.settings, apiPort: localApi.port } }))
  }
  if (!smokeFile) {
    academicCalendarProbeTimer = setInterval(() => {
      void refreshAcademicCalendarAssets({ trigger: 'timer' })
        .catch((error) => writeDiagnostic('academic_calendar.refresh_failed', { error: diagnosticError(error) }))
    }, 6 * 60 * 60 * 1000)
    academicCalendarProbeTimer.unref?.()
  }
  if (!smokeFile && process.env.THEIA_FULL_SCHOOL_SCHEDULE_SCAN === '1') {
    void scanSchoolScheduleArchive().catch((error) => writeDiagnostic('school_schedule.archive_failed', { error: diagnosticError(error) }))
  }

  registerModelRuntimeIpc({
    ipcMain,
    modelService,
    modelVault,
    store,
    getLocalApi: () => localApi,
    calendarAssetUrl,
    academicPlanAssetBaseUrl,
    sendSnapshot,
  })
  registerUserDataIpc({ ipcMain, store })
  registerCourseWorkQueueIpc({ ipcMain, queue: courseWorkQueue })

  ipcMain.handle('theia:get-snapshot', () => {
    const snapshotStartedAt = Date.now()
    const snapshot = store.snapshot()
    void writeDiagnostic('data.snapshot_loaded', {
      elapsedMs: Date.now() - snapshotStartedAt,
      updatedAt: snapshot.updatedAt,
      counts: { schedule: snapshot.schedule.length, grades: snapshot.grades.length, assignments: snapshot.assignments.length },
    })
    return snapshot
  })
  registerAdvisorReadIpc({
    ipcMain,
    store,
    advisorRuntime,
    advisorOverviewFromStore,
    getUpgradeRule: () => advisorUpgradeRule,
    advisorAcademicWhatIfFromStore,
    advisorCourseDecisionsFromStore,
  })
  ipcMain.handle('theia:advisor:execute-action', async (_event, request) => {
    const resolution = resolveAdvisorActionFromStore(store, request)
    if (!resolution.ok) return resolution
    const epoch = authEpoch
    const assertCurrentSnapshot = () => assertAdvisorSnapshotRevision(store, resolution.snapshotRevision)
    try {
      assertAuthEpoch(epoch)
      assertCurrentSnapshot()
      const entry = courseWorkService.assignmentEntry(resolution.target.assignmentId, { requireCurrent: false })
      await schoolProxyReady.catch(() => undefined)
      assertAuthEpoch(epoch)
      assertCurrentSnapshot()
      await openCourseWorkWindow(entry, epoch, assertCurrentSnapshot)
      assertAuthEpoch(epoch)
      assertCurrentSnapshot()
      return { ok: true, snapshotRevision: resolution.snapshotRevision, actionId: resolution.actionId }
    } catch (error) {
      const code = error?.code === ADVISOR_ACTION_ERROR.STALE_SNAPSHOT
        ? ADVISOR_ACTION_ERROR.STALE_SNAPSHOT
        : ADVISOR_ACTION_ERROR.EXECUTION_FAILED
      void writeDiagnostic('advisor.action_failed', {
        actionId: resolution.actionId,
        code,
        error: diagnosticError(error),
      })
      return advisorActionFailure(code, resolution.actionId)
    }
  })
  ipcMain.handle('theia:get-activity-log', () => recentActivityLog())
  ipcMain.handle('theia:get-auth-status', () => getStatus())
  ipcMain.handle('theia:get-credential-status', () => credentialVault.status())
  ipcMain.handle('theia:get-academic-api-credential-status', async () => ({ ...(await academicApiVault.status()), enabled: store.snapshot().settings.academicApiEnabled }))
  ipcMain.handle('theia:get-mail-credential-status', () => mailVault.status())
  ipcMain.handle('theia:read-saved-secret', async (_event, kind) => {
    if (kind === 'unified-password') return (await credentialVault.readCredentials())?.password || null
    if (kind === 'academic-api-password') return (await academicApiVault.readCredentials())?.password || null
    const credentials = await mailVault.readCredentials()
    if (kind === 'mail-password') return credentials?.password || null
    if (kind === 'mail-protocol-password') return credentials?.protocolPassword || null
    return null
  })
  ipcMain.handle('theia:save-credentials', (_event, credentials) => credentialVault.save(credentials || {}))
  ipcMain.handle('theia:save-academic-api-credentials', async (_event, credentials) => {
    courseSelectionApiClient = null
    return { ...(await academicApiVault.save(credentials || {})), enabled: store.snapshot().settings.academicApiEnabled }
  })
  ipcMain.handle('theia:clear-credentials', async () => {
    credentialAttempts.clear()
    return credentialVault.clear()
  })
  ipcMain.handle('theia:login', async () => {
    const epoch = authEpoch
    for (const recovery of Object.values(authRecovery)) {
      recovery.failures = 0
      recovery.lastAt = 0
      recovery.inFlight = false
    }
    await schoolProxyReady.catch(() => undefined)
    assertAuthEpoch(epoch, { allowLoggedOut: true })
    return openLoginWindow({ expectedEpoch: epoch, userInitiated: true })
  })
  ipcMain.handle('theia:clear-academic-api-credentials', async () => {
    courseSelectionApiClient = null
    return { ...(await academicApiVault.clear()), enabled: store.snapshot().settings.academicApiEnabled }
  })
  registerMailboxIpc({
    ipcMain,
    mailVault,
    mailService,
    store,
    dialog,
    getDownloadsDirectory: () => app.getPath('downloads'),
    writeFile,
    resolvePath: resolve,
    basename,
    sendSnapshot,
    writeDiagnostic,
  })
  ipcMain.handle('theia:logout', async () => {
    explicitlyLoggedOut = true
    syncService.disable()
    await courseWorkQueue?.setEnabled(false)
    authEpoch += 1
    statusChecks.jwglxt = null
    statusChecks.theol = null
    forceSourceStatusChecks.clear()
    unifiedAuthVerification = null
    const interactiveActor = theolInteractiveActor
    theolInteractiveActor = null
    if (interactiveActor) {
      interactiveActor.invalidated = true
      interactiveActor.rejectOpened(new Error('显式退出已取消北化在线THEOL交互'))
      if (!interactiveActor.windows.size) interactiveActor.resolveClosed()
    }
    const actors = [...authActors.values()]
    authActors.clear()
    for (const actor of actors) {
      actor.invalidated = true
      clearAuthActorTimers(actor)
      actor.resolveOpened()
      if ((!actor.window || actor.window.isDestroyed()) && !actor.windows.size) actor.resolveClosed()
    }
    authPendingSources.clear()
    credentialAttempts.clear()
    pendingSourceOpens.splice(0)
    syncPageQueue.cancelPending(new Error('Explicit logout cancelled the queued school request'))
    fitnessPageQueue.cancelPending(new Error('Explicit logout cancelled the queued fitness request'))
    const windows = new Set([
      ...actors.map((actor) => actor.window).filter(Boolean),
      ...(interactiveActor ? [...interactiveActor.windows] : []),
      ...sourceWindows,
      syncPageWindow,
      fitnessPageWindow,
    ])
    await Promise.all([...windows].map((window) => closeWindowAndWait(window)))
    interactiveActor?.resolveClosed()
    for (const actor of actors) actor.resolveClosed()
    syncPageWindow = null
    fitnessPageWindow = null
    await Promise.allSettled([
      ...actors.map((actor) => actor.lifecycle),
      interactiveActor?.lifecycle,
    ].filter(Boolean))
    await syncService.cancelAndWait()
    await syncService.runTheolExclusive(() => undefined)
    await schoolSession.clearStorageData({ storages: ['cookies', 'localstorage', 'serviceworkers', 'cachestorage'] })
    verifiedSessions.jwglxt = null
    verifiedSessions.theol = null
    verifiedSessions.tygl = null
    const status = loggedOutStatus()
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('theia:auth-status', status)
    return status
  })
  ipcMain.handle('theia:sync-now', async () => {
    await schoolProxyReady.catch(() => undefined)
    const snapshot = await syncForegroundCampusData()
    scheduleAcademicStaticPrefetch({ reason: 'manual_refresh' })
    return snapshot
  })
  ipcMain.handle('theia:sync-domain', async (_event, domainId) => {
    await schoolProxyReady.catch(() => undefined)
    const target = SYNC_DOMAIN_TARGETS[domainId]
    let snapshot
    if (target) {
      snapshot = await syncService.syncNow({ sources: [target.source], domains: [target.domain] })
    } else if (domainId === 'assignments') {
      snapshot = await syncService.retryAssignments()
    } else if (domainId === 'mailbox') {
      await mailService.poll({ notify: false, force: true })
      snapshot = store.snapshot()
      sendSnapshot()
    } else if (domainId === 'academic-calendar') {
      await refreshAcademicCalendarAssets({ force: true, trigger: 'manual-domain-retry' })
      snapshot = store.snapshot()
    } else if (domainId === 'fitness') {
      const epoch = authEpoch
      assertAuthEpoch(epoch)
      await importFitnessArchive(null, epoch)
      snapshot = store.snapshot()
    } else if (domainId === 'school-schedule') {
      await scanSchoolScheduleArchive({ force: true })
      snapshot = store.snapshot()
    } else {
      throw new Error('Unsupported sync domain')
    }
    return snapshot
  })
  ipcMain.handle('theia:query-free-classrooms', async (_event, query) => {
    const epoch = authEpoch
    assertAuthEpoch(epoch)
    await schoolProxyReady.catch(() => undefined)
    assertAuthEpoch(epoch)
    const term = store.snapshot().terms.find((item) => item?.id === query?.termId)
    if (!term) throw new Error('请选择有效的教务学期')
    const snapshot = await syncService.syncNow({
      sources: ['jwglxt'],
      domains: ['free-classroom'],
      freeClassroom: { ...query, term },
      foreground: true,
    })
    assertAuthEpoch(epoch)
    return snapshot
  })
  registerCourseSelectionIpc({
    ipcMain,
    courseSelectionService,
    courseSelectionJournal,
    store,
    cachedSchoolScheduleResult,
    schoolScheduleWithProvenance,
    scanSchoolScheduleArchive,
    armCourseSelectionSentinel,
    sendCourseSelectionSnapshot,
    courseSelectionSnapshot,
    writeDiagnostic,
  })
  ipcMain.handle('theia:get-academic-calendar-assets', () => academicCalendarAssetsService.snapshot())
  ipcMain.handle('theia:refresh-academic-calendar-assets', async (_event, options) => {
    return refreshAcademicCalendarAssets({ force: Boolean(options?.force), trigger: 'manual' })
  })
  ipcMain.handle('theia:open-source', async (_event, url) => {
    const epoch = authEpoch
    assertAuthEpoch(epoch)
    await schoolProxyReady.catch(() => undefined)
    assertAuthEpoch(epoch)
    return openSourceWindow(url, { expectedEpoch: epoch })
  })
  ipcMain.handle('theia:open-academic-attachment', async (_event, domain, attachmentId) => {
    const epoch = authEpoch
    assertAuthEpoch(epoch)
    if (!JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES.includes(domain)) throw new Error('Unsupported academic attachment domain')
    const attachment = store.snapshot().academicExtras?.domains?.[domain]?.attachments
      ?.find((item) => item?.id === attachmentId)
    if (!attachment) return { cached: false }
    let cached = await academicAttachmentStore?.find(attachment.id, 'pdf')
    // Older snapshots may contain attachment metadata created before the
    // local-file path existed. Repair that one artifact on demand instead of
    // sending the user straight to a slow/login-gated source page.
    if (!cached && attachment.sourceUrl) {
      const repairKey = `${domain}:${attachment.id}`
      let repair = academicAttachmentRepairs.get(repairKey)
      if (!repair) {
        // Opening a PDF is a foreground, single-artifact action. It must not
        // queue behind a full JWGLXT refresh or refetch unrelated extension
        // pages before the requested file can be shown.
        repair = repairAcademicAttachment(attachment, { domain, expectedEpoch: epoch })
        academicAttachmentRepairs.set(repairKey, repair)
      }
      try {
        await repair
        assertAuthEpoch(epoch)
        cached = await academicAttachmentStore?.find(attachment.id, 'pdf')
      } catch (error) {
        void writeDiagnostic('jwglxt.attachment_repair_failed', {
          domain,
          attachmentId,
          error: diagnosticError(error),
        })
      } finally {
        if (academicAttachmentRepairs.get(repairKey) === repair) academicAttachmentRepairs.delete(repairKey)
      }
    }
    if (!cached) {
      void writeDiagnostic('jwglxt.attachment_cache_miss', { domain, attachmentId })
      return { cached: false }
    }
    const openError = await shell.openPath(cached.path)
    if (openError) {
      void writeDiagnostic('jwglxt.attachment_open_failed', { domain, attachmentId, error: String(openError).slice(0, 500) })
      return { cached: false }
    }
    void writeDiagnostic('jwglxt.attachment_opened', { domain, attachmentId, bytes: cached.bytes })
    return { cached: true }
  })
  ipcMain.handle('theia:open-assignment-source', async (_event, assignmentId) => {
    const epoch = authEpoch
    assertAuthEpoch(epoch)
    const entry = courseWorkService.assignmentEntry(assignmentId, { requireCurrent: false })
    await schoolProxyReady.catch(() => undefined)
    assertAuthEpoch(epoch)
    await openCourseWorkWindow(entry, epoch)
    return true
  })
  ipcMain.handle('theia:get-fitness-score', async (_event, requestedYear, options) => {
    const selectedYear = requestedFitnessYear(requestedYear)
    const forceRefresh = options?.refresh === true
    const cached = !forceRefresh && cachedFitnessResult(store.snapshot().dataCatalog, selectedYear)
    if (cached) {
      void writeDiagnostic('fitness.cache_hit', { yearKey: cached.yearKey, cachedAt: cached.cachedAt })
      return cached
    }
    const epoch = authEpoch
    assertAuthEpoch(epoch)
    await schoolProxyReady.catch(() => undefined)
    assertAuthEpoch(epoch)
    return importFitnessArchive(selectedYear, epoch)
  })
  registerWindowIpc({ ipcMain, BrowserWindow, getMainWindow: () => mainWindow })

  registerAppearanceIpc({
    ipcMain,
    BrowserWindow,
    dialog,
    getMainWindow: () => mainWindow,
    appearanceService,
    copyFile,
    mkdir,
    basename,
    extname,
    writeDiagnostic,
  })
  ipcMain.handle('theia:open-schedule-pdf', () => openSchedulePdf(authEpoch))
  ipcMain.handle('theia:prepare-course-work', async (_event, assignmentId) => {
    const epoch = authEpoch
    assertAuthEpoch(epoch)
    const result = await syncService.runTheolInteraction(() => {
      assertAuthEpoch(epoch)
      return courseWorkService.prepare(assignmentId)
    })
    assertAuthEpoch(epoch)
    sendSnapshot()
    return result.snapshot
  })
  ipcMain.handle('theia:open-course-work', async (_event, assignmentId) => {
    const workspace = courseWorkService.validatedWorkspace(assignmentId)
    const outcome = await shell.openPath(workspace.directory)
    if (outcome) throw new Error(outcome)
    return true
  })
  ipcMain.handle('theia:import-course-work-file', async (_event, assignmentId, kind) => {
    if (!['answer', 'answer-key'].includes(kind)) throw new Error('不支持的课程任务文件类型')
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: kind === 'answer-key' ? '选择在线测试答案 JSON' : '选择待提交文件',
      properties: ['openFile'],
      filters: kind === 'answer-key'
        ? [{ name: 'JSON', extensions: ['json'] }]
        : [{ name: '作业文件', extensions: ['pdf', 'doc', 'docx', 'zip', 'rar', 'txt', 'md', 'ppt', 'pptx', 'xls', 'xlsx'] }, { name: '所有文件', extensions: ['*'] }],
    })
    if (selected.canceled || !selected.filePaths[0]) return { canceled: true, snapshot: store.snapshot() }
    const result = await courseWorkService.importFile(assignmentId, selected.filePaths[0], kind)
    sendSnapshot()
    return { canceled: false, ...result }
  })
  ipcMain.handle('theia:open-submission', async (_event, assignmentId) => {
    const epoch = authEpoch
    assertAuthEpoch(epoch)
    const entry = courseWorkService.assignmentEntry(assignmentId)
    const selected = await dialog.showOpenDialog(mainWindow, {
      title: '选择要提交到北化在线THEOL的文件',
      properties: ['openFile'],
      filters: [{ name: '作业文件', extensions: ['pdf', 'doc', 'docx', 'zip', 'rar', 'txt', 'md', 'ppt', 'pptx', 'xls', 'xlsx'] }, { name: '所有文件', extensions: ['*'] }],
    })
    if (selected.canceled || !selected.filePaths[0]) return { canceled: true, snapshot: store.snapshot(), attached: false }
    assertAuthEpoch(epoch)
    const imported = await courseWorkService.importFile(assignmentId, selected.filePaths[0], 'answer')
    assertAuthEpoch(epoch)
    sendSnapshot()
    const window = await openCourseWorkWindow(entry, epoch)
    assertAuthEpoch(epoch)
    const attached = await attachFileToSourceWindow(window, imported.path)
    assertAuthEpoch(epoch)
    return { canceled: false, snapshot: imported.snapshot, ...attached }
  })
  ipcMain.handle('theia:apply-test-answers', async (_event, assignmentId) => {
    const epoch = authEpoch
    assertAuthEpoch(epoch)
    const entry = courseWorkService.assignmentEntry(assignmentId)
    const { assignment } = entry
    if (assignment.kind !== 'online-test') throw new Error('该任务不是在线测试')
    const answerKey = await courseWorkService.answerKey(assignmentId)
    assertAuthEpoch(epoch)
    const window = await openCourseWorkWindow(entry, epoch)
    assertAuthEpoch(epoch)
    const result = await fillTestInSourceWindow(window, answerKey)
    assertAuthEpoch(epoch)
    const snapshot = await courseWorkService.recordTestFill(assignmentId, result)
    sendSnapshot()
    return { snapshot, ...result }
  })
  ipcMain.handle('theia:discover-models', async (_event, config) => {
    const next = config && typeof config === 'object' ? config : {}
    const baseUrl = normalizeModelServiceBaseUrl(next.baseUrl)
    const apiKey = typeof next.apiKey === 'string' ? next.apiKey.trim() : ''
    if (!baseUrl) throw new Error('Enter a model service URL before detecting models')
    const provider = normalizeModelProvider(next.provider)
    try {
      if (provider !== 'openai-compatible') {
        throw new Error('This provider does not expose a portable model-list contract. Enter the exact model ID manually after testing the connection.')
      }
      const result = await modelService.discover({ baseUrl, apiKey })
      return { ...result, probeId: modelProbeTickets.issue({ baseUrl, apiKey, provider, models: result.models, succeeded: true }) }
    } catch (error) {
      const warning = error instanceof Error ? error.message : String(error)
      return {
        models: [],
        selectedModel: null,
        probeId: modelProbeTickets.issue({ baseUrl, apiKey, provider, models: [], succeeded: false }),
        warning: warning.slice(0, 1_000),
      }
    }
  })
  ipcMain.handle('theia:save-model-config', async (_event, config) => {
    const next = config && typeof config === 'object' ? config : {}
    const previousAdvisorBudgetLevel = store.snapshot().settings.advisorConfig?.budgetLevel
    const baseUrl = normalizeModelServiceBaseUrl(next.baseUrl)
    const requestedModel = String(next.model || '').trim()
    const provider = normalizeModelProvider(next.provider)
    if (baseUrl.length > 1_000 || requestedModel.length > 300) throw new Error('Model service configuration is too long')
    const explicitApiKey = typeof next.apiKey === 'string' ? next.apiKey.trim() : ''
    const probeId = String(next.probeId || '').trim()
    let models
    if (probeId) {
      models = modelProbeTickets.consume({
        probeId,
        baseUrl,
        apiKey: explicitApiKey,
        modelName: requestedModel,
        allowManualModel: next.allowManualModel,
        provider,
      })
    } else {
      // A settings-only edit must not force the user to probe the same
      // service again. Reuse is allowed only when the service identity and
      // selected model are unchanged, no new key is supplied, and the
      // existing binding can still be read. Any service change still fails
      // closed and requires a fresh probe ticket.
      const currentSettings = store.snapshot().settings || {}
      const currentBaseUrl = normalizeModelServiceBaseUrl(currentSettings.modelBaseUrl)
      const sameService = currentBaseUrl === baseUrl
        && normalizeModelProvider(currentSettings.modelProvider) === provider
        && String(currentSettings.modelName || '').trim() === requestedModel
      if (!sameService || explicitApiKey) {
        throw new Error('修改了模型地址、协议、模型或 API Key，请先检测连接再保存')
      }
      if (provider !== 'ollama-chat') await modelVault.readApiKey(baseUrl)
      models = Array.isArray(currentSettings.modelModels) ? [...currentSettings.modelModels] : []
      if (!models.includes(requestedModel)) models.push(requestedModel)
    }
    const modelName = preferredModel(models, requestedModel)
    if (!modelName) throw new Error('No selectable model was detected. Enter a model ID manually.')
    await saveModelConfigTransaction({
      store,
      vault: modelVault,
      baseUrl,
      modelName,
      models,
      modelRouting: next.modelRouting,
      advisorConfig: { ...(store.snapshot().settings.advisorConfig || {}), ...(next.advisorConfig || {}) },
      modelProvider: provider,
      allowKeyless: provider === 'ollama-chat' && !explicitApiKey,
      apiKey: explicitApiKey,
      publishSnapshot: sendSnapshot,
    })
    // Rebuild advisor runtime if budgetLevel changed
    if (next.advisorConfig?.budgetLevel && next.advisorConfig.budgetLevel !== previousAdvisorBudgetLevel) {
      await rebuildAdvisorRuntime()
    }
    return modelService.status(store.snapshot().settings)
  })
  ipcMain.handle('theia:render-answer-pdf', async (_event, assignmentId) => {
    const workspace = courseWorkService.validatedWorkspace(assignmentId)
    if (!workspace?.modelAnswerPath) throw new Error('请先使用模型生成答案，再渲染 PDF')
    const markdown = await readFile(workspace.modelAnswerPath, 'utf8').catch(() => { throw new Error('答案文件无法读取，请重新生成') })
    const title = workspace.title || '课程作业答案'
    const pdfBuffer = await renderMarkdownToPdf(markdown, { title })
    const pdfPath = resolve(workspace.directory, 'model-answer.pdf')
    await writeFile(pdfPath, pdfBuffer)
    const snapshot = await store.update((state) => ({
      ...state,
      workspaces: state.workspaces.map((item) => item.assignmentId === assignmentId ? {
        ...item,
        modelAnswerPdfPath: pdfPath,
        updatedAt: new Date().toISOString(),
      } : item),
    }))
    sendSnapshot()
    return { snapshot, pdfPath }
  })
  ipcMain.handle('theia:open-answer-pdf', async (_event, assignmentId) => {
    const workspace = courseWorkService.validatedWorkspace(assignmentId)
    if (!workspace?.modelAnswerPdfPath) throw new Error('请先渲染 PDF 答案')
    const outcome = await shell.openPath(workspace.modelAnswerPdfPath)
    if (outcome) throw new Error(outcome)
    return true
  })
  ipcMain.handle('theia:summarize-notices', async () => {
    const state = store.snapshot()
    const result = await modelService.summarizeNotices(state.settings, {
      assignments: state.assignments,
      notices: state.notices,
      courses: state.courses,
      dataRoot: app.getPath('userData'),
    })
    return result
  })
  ipcMain.handle('theia:generate-notes', async (_event, assignmentId, options) => {
    const result = await modelService.generateNotes(assignmentId, store.snapshot().settings, options || {})
    sendSnapshot()
    return result.snapshot
  })
  ipcMain.handle('theia:generate-paper', async (_event, assignmentId, options) => {
    const result = await modelService.generatePaper(assignmentId, store.snapshot().settings, options || {})
    sendSnapshot()
    return result.snapshot
  })
  ipcMain.handle('theia:render-md-file', async (_event, assignmentId, fileKey) => {
    // Renders any of: modelAnswerPath, notesPath, paperPath → sibling PDF
    const workspace = courseWorkService.validatedWorkspace(assignmentId)
    const allowed = ['modelAnswerPath', 'notesPath', 'paperPath']
    if (!allowed.includes(fileKey)) throw new Error('不支持的渲染目标')
    const mdPath = workspace?.[fileKey]
    if (!mdPath) throw new Error('请先生成该文件，再渲染 PDF')
    const markdown = await readFile(mdPath, 'utf8').catch(() => { throw new Error('文件无法读取，请重新生成') })
    const title = workspace.title || '文档'
    const pdfBuffer = await renderMarkdownToPdf(markdown, { title })
    const outputName = fileKey === 'modelAnswerPath' ? 'model-answer.pdf' : fileKey === 'notesPath' ? 'notes.pdf' : 'paper.pdf'
    const pdfPath = resolve(workspace.directory, outputName)
    await writeFile(pdfPath, pdfBuffer)
    const pdfKey = fileKey.replace(/Path$/, 'PdfPath')
    const snapshot = await store.update((state) => ({
      ...state,
      workspaces: state.workspaces.map((item) => item.assignmentId === assignmentId ? {
        ...item, [pdfKey]: pdfPath, updatedAt: new Date().toISOString(),
      } : item),
    }))
    sendSnapshot()
    return { snapshot, pdfPath }
  })
  ipcMain.handle('theia:update-settings', async (_event, next) => {
    return applyTheiaSettings(next)
  })
  ipcMain.handle('theia:export-data', async (_event, { format = 'json', collection = 'grades' } = {}) => {
    const snapshot = store.snapshot()
    if (format === 'ai') {
      const chosen = await dialog.showOpenDialog(mainWindow, {
        title: '选择 AI 数据包导出位置',
        defaultPath: app.getPath('documents'),
        properties: ['openDirectory', 'createDirectory'],
      })
      if (chosen.canceled || !chosen.filePaths[0]) return { canceled: true }
      const courseSelection = courseSelectionJournal?.snapshot() || null
      const result = await writeAiExport({
        destinationRoot: chosen.filePaths[0],
        state: snapshot,
        courseSelection,
        appVersion: app.getVersion(),
      })
      void writeDiagnostic('data.ai_export_written', {
        files: result.files,
        exportedAt: result.manifest.exportedAt,
      })
      return { canceled: false, filePath: result.directory, files: result.files }
    }
    const content = format === 'theia'
      ? JSON.stringify(toTheiaFeed(snapshot), null, 2) + '\n'
      : format === 'ics'
        ? toIcs(snapshot)
        : format === 'csv'
          ? collectionCsv(snapshot, collection)
          : JSON.stringify(snapshot, null, 2) + '\n'
    const extension = format === 'ics' ? 'ics' : format === 'csv' ? 'csv' : 'json'
    const chosen = await dialog.showSaveDialog(mainWindow, { defaultPath: resolve(app.getPath('documents'), `theia-export.${extension}`), filters: [{ name: extension.toUpperCase(), extensions: [extension] }] })
    if (chosen.canceled || !chosen.filePath) return { canceled: true }
    await writeFile(chosen.filePath, content, 'utf8')
    return { canceled: false, filePath: chosen.filePath }
  })
  ipcMain.handle('theia:open-data-directory', async () => {
    const directory = app.getPath('userData')
    await mkdir(directory, { recursive: true })
    const outcome = await shell.openPath(directory)
    if (outcome) throw new Error(outcome)
    return { opened: true, path: directory }
  })
}

async function createMainWindow() {
  const window = new BrowserWindow({
    title: 'THEIA',
    width: 1480,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    frame: false,
    autoHideMenuBar: true,
    icon: APP_ICON,
    show: !smokeFile,
    backgroundColor: '#131920',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: resolve(import.meta.dirname, 'preload.cjs'),
    },
  })
  mainWindow = window
  mainEntryUrl = app.isPackaged
    ? pathToFileURL(resolve(root, 'dist/index.html')).toString()
    : viteServer.resolvedUrls?.local?.[0] || 'http://127.0.0.1:5174/'
  const rendererSession = window.webContents.session
  const mainWebContentsId = window.webContents.id
  rendererSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...(details.responseHeaders || {}) }
    const requestUrl = String(details.url || '')
    if (details.webContentsId === mainWebContentsId && isPermittedAppNavigation(requestUrl, mainEntryUrl)) {
      for (const name of Object.keys(responseHeaders)) {
        if (name.toLowerCase() === 'content-security-policy') delete responseHeaders[name]
      }
      responseHeaders['Content-Security-Policy'] = [mainRendererCsp(!app.isPackaged)]
    }
    callback({ responseHeaders })
  })
  const preventUnsafeMainNavigation = (event, legacyUrl) => {
    if (event.isMainFrame === false) return
    const target = event.url || legacyUrl
    if (isPermittedAppNavigation(target, mainEntryUrl)) return
    event.preventDefault()
    void writeDiagnostic('renderer.navigation_blocked', { url: diagnosticUrl(target) })
  }
  window.webContents.on('will-navigate', preventUnsafeMainNavigation)
  window.webContents.on('will-redirect', preventUnsafeMainNavigation)
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = permittedExternalUrl(url)
      void shell.openExternal(target).catch((error) => {
        void writeDiagnostic('renderer.external_open_failed', { url: diagnosticUrl(target), error: diagnosticError(error) })
      })
    } catch {
      void writeDiagnostic('renderer.popup_blocked', { url: diagnosticUrl(url) })
    }
    return { action: 'deny' }
  })
  window.on('closed', () => {
    if (mainWindow !== window) return
    mainWindow = null
    if (syncPageWindow && !syncPageWindow.isDestroyed()) syncPageWindow.close()
    if (fitnessPageWindow && !fitnessPageWindow.isDestroyed()) fitnessPageWindow.close()
  })
  window.on('focus', () => { void broadcastAuthStatus() })
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    const detail = { preloadPath, message: error?.stack || error?.message || String(error) }
    preloadErrors.push(detail)
    console.error('[THEIA] preload failed', detail)
  })
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level < 2) return
    void writeDiagnostic('renderer.console', {
      level,
      message: String(message || '').slice(0, 2_000),
      line: Number(line) || null,
      source: String(sourceId || '').slice(0, 500),
    })
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    void writeDiagnostic('renderer.process_gone', {
      reason: details?.reason || 'unknown',
      exitCode: Number.isFinite(details?.exitCode) ? details.exitCode : null,
    })
  })
  window.webContents.once('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    void finishSmoke({ ok: false, stage: 'load', errorCode, errorDescription, validatedURL })
  })
  window.webContents.once('did-finish-load', async () => {
    if (!smokeFile) return
    try {
      const bridge = await window.webContents.executeJavaScript(`(() => {
        const api = window.theia || window.buct
        const requiredMethods = [
          'getSnapshot', 'getAdvisorOverview', 'getAuthStatus', 'login', 'logout', 'syncNow', 'retrySyncDomain',
          'getAdvisorAcademicWhatIf', 'getAdvisorCourseDecisions', 'executeAdvisorAction',
          'listAdvisorThreads', 'createAdvisorThread', 'prepareAdvisorRequest', 'sendAdvisorRequest',
          'cancelAdvisorRequest', 'deleteAdvisorThread', 'onAdvisorStream',
          'getCourseSelection', 'discoverCourseSelection', 'getCourseSelectionCandidates', 'getCachedSchoolSchedule',
          'saveCourseSelectionTarget', 'removeCourseSelectionTarget', 'setCourseSelectionSentinel', 'startCourseSelection', 'stopCourseSelection',
          'openSource', 'openAcademicAttachment', 'openSchedulePdf', 'exportData', 'getApiStatus', 'updateSettings',
          'getCredentialStatus', 'saveCredentials', 'clearCredentials',
          'getAcademicApiCredentialStatus', 'saveAcademicApiCredentials', 'clearAcademicApiCredentials',
          'getMailCredentialStatus', 'saveMailCredentials', 'clearMailCredentials', 'refreshMailbox',
          'openMailbox', 'readMailboxMessage', 'downloadMailboxAttachment',
          'prepareCourseWork', 'openCourseWork', 'importCourseWorkFile',
          'openSubmission', 'applyTestAnswers', 'getModelStatus', 'saveModelConfig',
          'clearModelApiKey', 'validateModelConnection', 'discoverModels', 'processCourseWorkWithModel',
          'chooseAppBackground', 'onSnapshot', 'onAuthStatus'
        ]
        return {
          type: typeof api,
          methods: requiredMethods.filter((method) => typeof api?.[method] === 'function'),
          requiredMethods,
        }
      })()`)
      const calls = await window.webContents.executeJavaScript(`Promise.all([
        (window.theia || window.buct).getSnapshot(),
        (window.theia || window.buct).getAdvisorOverview(),
        (async () => {
          const api = window.theia || window.buct
          const thread = await api.createAdvisorThread()
          const threads = await api.listAdvisorThreads()
          return { id: thread.id, listed: threads.some((item) => item.id === thread.id) }
        })(),
        (window.theia || window.buct).getAuthStatus(),
        (window.theia || window.buct).getApiStatus(),
        (window.theia || window.buct).getCredentialStatus(),
        (window.theia || window.buct).getAcademicApiCredentialStatus(),
        (window.theia || window.buct).getModelStatus(),
        (window.theia || window.buct).getCourseSelection()
      ]).then(([snapshot, advisorOverview, advisorThread, authStatus, apiStatus, credentialStatus, academicApiCredentialStatus, modelStatus, courseSelection]) => ({
        snapshotSchema: snapshot.schema,
        advisorOverview: {
          schema: advisorOverview.schema,
          snapshotRevision: advisorOverview.snapshotRevision,
          dataQualityRevision: advisorOverview.dataQuality?.snapshotRevision,
        },
        advisorThread,
        collections: ['courses', 'schedule', 'exams', 'grades', 'selectedCourses', 'assignments', 'workspaces', 'notices']
          .filter((name) => Array.isArray(snapshot[name])),
        hasAcademicProgress: snapshot.academicProgress === null || typeof snapshot.academicProgress === 'object',
        authSources: Object.keys(authStatus).sort(),
        apiStatus,
        credentialStatus,
        academicApiCredentialStatus,
        modelStatus,
        courseSelection,
      }))`)
      const smokePdf = await renderMarkdownToPdf('# Packaged smoke\n\n**ok**')
      const pdfBytes = smokePdf.length
      const pdfHeader = smokePdf.subarray(0, 4).toString('ascii')
      const ocrRuntimeOk = await probeAcademicCalendarOcrRuntime()
      const ok = bridge.type === 'object'
        && bridge.methods.length === bridge.requiredMethods.length
        && calls.snapshotSchema === 'theia-campus-data/v1'
        && calls.collections.length === 8
        && calls.hasAcademicProgress
        && calls.advisorOverview.schema === 'theia-advisor-overview/v1'
        && typeof calls.advisorOverview.snapshotRevision === 'string'
        && calls.advisorOverview.snapshotRevision.length > 0
        && calls.advisorOverview.dataQualityRevision === calls.advisorOverview.snapshotRevision
        && typeof calls.advisorThread.id === 'string'
        && calls.advisorThread.id.length > 0
        && calls.advisorThread.listed === true
        && calls.authSources.includes('jwglxt')
        && calls.authSources.includes('theol')
        && calls.apiStatus.host === '127.0.0.1'
        && typeof calls.credentialStatus.saved === 'boolean'
        && typeof calls.academicApiCredentialStatus.saved === 'boolean'
        && calls.academicApiCredentialStatus.enabled === false
        && typeof calls.modelStatus.configured === 'boolean'
        && (calls.courseSelection.active === null || typeof calls.courseSelection.active === 'object')
        && pdfHeader === '%PDF'
        && pdfBytes > 1_000
        && ocrRuntimeOk
        && preloadErrors.length === 0
      await finishSmoke({ ok, stage: 'renderer', bridge, calls, pdfBytes, ocrRuntimeOk })
    } catch (error) {
      await finishSmoke({ ok: false, stage: 'renderer', error: error?.stack || error?.message || String(error) })
    }
  })
  await window.loadURL(mainEntryUrl)
}

async function startVite() {
  if (app.isPackaged) return
  const { createServer } = await import('vite')
  viteServer = await createServer({ root, configFile: resolve(root, 'vite.config.ts') })
  await viteServer.listen()
}

async function autoLoginOnStartup() {
  const credentialStatus = await credentialVault.status()
  if (credentialStatus.saved && !credentialStatus.error) {
    await schoolProxyReady.catch(() => undefined)
    // API credentials and the browser partition are independent. Require a
    // real browser check here so the first source-page click does not pay for
    // a second hidden authentication probe.
    await openLoginWindow({ background: true, requireBrowser: true })
  }
}

async function shutdownServices() {
  if (shutdownPromise) return shutdownPromise
  shutdownPromise = (async () => {
    if (academicCalendarProbeTimer) clearInterval(academicCalendarProbeTimer)
    if (academicStaticPrefetchTimer) clearTimeout(academicStaticPrefetchTimer)
    academicStaticPrefetchTimer = null
    modelService?.cancelAll()
    advisorRuntime?.cancelAll()
    syncPageQueue.cancelPending(new Error('Application shutdown cancelled the queued school request'))
    fitnessPageQueue.cancelPending(new Error('Application shutdown cancelled the queued fitness request'))
    courseSelectionService?.stop()
    syncService?.stop()
    mailService?.stop()
    webmailService?.stop()
    await Promise.allSettled([
      advisorRuntime?.flush?.(),
      courseWorkQueue?.close({ cancelRunning: true }),
      feedWrite,
      diagnosticWrite,
      localApi?.close(),
      viteServer?.close(),
    ])
    shutdownComplete = true
  })()
  return shutdownPromise
}

process.on('unhandledRejection', (reason) => {
  console.error('[THEIA] unhandled rejection:', reason)
})
process.on('uncaughtException', (error) => {
  console.error('[THEIA] uncaught exception:', error)
})

if (theolMobileDiagnosticOutput) {
  migrateFromLegacyDir().then(() => app.whenReady()).then(async () => {
    Menu.setApplicationMenu(null)
    registerLocalProtocols()
    await startServices()
    await autoLoginOnStartup()
    await exportTheolMobileDiagnostic()
  }).then(() => app.quit()).catch((error) => {
    console.error('[THEIA] THEOL mobile diagnostic failed', error)
    app.exit(1)
  })
} else if (inspectionOutput) {
  app.whenReady().then(inspectAuthenticatedPages).then(() => app.quit()).catch((error) => {
    console.error('[THEIA] inspection failed', error)
    app.exit(1)
  })
} else {
  const lock = app.requestSingleInstanceLock()
  if (!lock) app.quit()
  else migrateFromLegacyDir().then(() => app.whenReady()).then(async () => {
    Menu.setApplicationMenu(null)
    registerLocalProtocols()
    if (liveCaptureOutput) {
      try {
        const result = await startServices().then(() => runLiveCapture())
        console.log(`[THEIA] live capture written: ${JSON.stringify(result)}`)
      } catch (error) {
        console.error('[THEIA] live capture failed', error)
        requestedExitCode = 1
      } finally {
        await closeLiveCaptureActors('live capture finished')
        await shutdownServices()
        app.exit(requestedExitCode)
      }
      return
    }
    await Promise.all([startVite(), startServices()])
    await createMainWindow()
    if (!smokeFile) void autoLoginOnStartup().catch((error) => console.error('[THEIA] automatic login failed', error))
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) void createMainWindow() })
  }).catch((error) => {
    console.error('[THEIA] startup failed', error)
    app.quit()
  })
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', (event) => {
  if (shutdownComplete) return
  event.preventDefault()
  void shutdownServices()
    .catch((error) => console.error('[THEIA] shutdown cleanup failed', error))
    .finally(() => app.exit(requestedExitCode))
})
