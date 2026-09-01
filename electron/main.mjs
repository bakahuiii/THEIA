import { app, BrowserWindow, Menu, dialog, ipcMain as electronIpcMain, protocol, safeStorage, session, shell } from 'electron'
import { appendFile, copyFile, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, extname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AuthRequiredError, SessionClient } from '../core/source-client.mjs'
import { JWGLXT_URLS } from '../core/adapters/jwglxt.mjs'
import { THEOL_URLS } from '../core/adapters/theol.mjs'
import { upgradeTyglRedirectUrl } from '../core/adapters/tygl.mjs'
import { probeAcademicCalendarOcrRuntime } from '../core/academic-calendar-ocr.mjs'
import { toTheiaFeed } from '../core/schema.mjs'
import {
  cacheMotionVenueCatalog,
  cacheMotionVenueStatus,
  cachedMotionVenueCatalog,
  cachedSchoolScheduleResult,
  SCHOOL_SCHEDULE_PARSER_VERSION,
} from '../core/data-catalog.mjs'
import { failSchoolScheduleCatalog } from '../core/catalog-provenance.mjs'
import { defaultDataRoot, legacyDataRoot, migrateLegacyDataFiles, rebaseLegacyWorkspacePaths } from '../core/runtime-paths.mjs'
import { parseTheolHome } from '../core/parsers/theol.mjs'
import { ModelProbeTickets } from './model-probe-tickets.mjs'
import {
  isPermittedAppNavigation,
  isPermittedSourceUrl,
  permittedExternalUrl,
  permittedSourceUrl,
} from '../core/source-url-policy.mjs'
import { renderMarkdownToPdf } from './pdf-renderer.mjs'
import { renderHtmlToPng } from './table-renderer.mjs'
import { compactError, sanitizeDiagnosticValue } from '../core/util.mjs'
import { createTrustedIpc } from './ipc-security.mjs'
import { mainRendererCsp } from './renderer-security.mjs'
import { CALENDAR_ASSET_PROTOCOL, academicPlanAssetBaseUrl, calendarAssetUrl, parseCalendarAssetUrl } from './calendar-asset-protocol.mjs'
import { advisorAcademicWhatIfFromStore, advisorCourseDecisionsFromStore, advisorOverviewFromStore } from './advisor-overview-service.mjs'
import { createPriorityJobQueue } from './priority-job-queue.mjs'
import { BACKGROUND_PROTOCOL, createAppearanceService } from './appearance-service.mjs'
import { createAuthActorManager } from './auth-actor-manager.mjs'
import { createAuthRuntime } from './auth-runtime.mjs'
import { createAgentTools } from './agent-tools.mjs'
import { isAuthenticationFailure } from './fitness-runtime.mjs'
import { createSourcePageRuntime } from './source-page-runtime.mjs'
import { createTheolInteractionRuntime } from './theol-interaction-runtime.mjs'
import { createWindowRuntime } from './window-runtime.mjs'
import { createSourceActionsRuntime } from './source-actions-runtime.mjs'
import { initializeServiceFoundation } from './service-foundation.mjs'
import { initializeDomainServices } from './service-domain-runtime.mjs'
import { initializeServiceIntegration } from './service-integration-runtime.mjs'
import { createAuthStatusRuntime } from './auth-status-runtime.mjs'
import { startLocalApi } from '../core/local-api.mjs'

const root = resolve(import.meta.dirname, '..')
const PARTITION = 'persist:theia'
const MAIL_PARTITION = 'persist:theia-mail'
const APP_ICON = resolve(import.meta.dirname, 'theia-icon.ico')
const agentTools = createAgentTools({
  openExternal: (url) => shell.openExternal(url),
})
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
let splashWindow
let mainEntryUrl
let viteServer
let localApi
let store
let syncService
let syncOrchestrator
let motionVenueAdapter
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
let rebuildAdvisorRuntime
let applyTheiaSettings
let advisorThreadStore
let advisorUpgradeRule = null
let courseSelectionService
let courseSelectionJournal
let academicCalendarAssetsService
let academicCalendarRuntime
let academicAttachmentStore
let theolAttachmentStore
let theolCourseArchiveStore
let irisCompanion
let irisControlWindow
let academicCalendarProbeTimer
// A calendar refresh may run while the renderer is starting. Keep the
// in-flight promise visible so consumers can wait for the first authoritative
// snapshot instead of querying the manifest half-way through a refresh.
let smokeCompleted = false
let requestedExitCode = 0
const modelProbeTickets = new ModelProbeTickets()

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
let fitnessRuntime
let liveCaptureRunner
const pageCaptureLog = []
const preloadErrors = []
const verifiedSessions = { jwglxt: null, theol: null, tygl: null }
const academicAttachmentRepairs = new Map()

const credentialAttempts = new Map()
const sourceWindows = new Set()
const pendingSourceOpens = []
let diagnosticWrite = Promise.resolve()
let feedWrite = Promise.resolve()
let explicitlyLoggedOut = false
let authEpoch = 0
const AUTH_SOURCES = ['jwglxt', 'theol', 'tygl']
let authRuntime
let sourceActionsRuntime
const loadSourceWindowUrl = (...args) => sourceActionsRuntime.loadSourceWindowUrl(...args)
const createSourceWindow = (...args) => sourceActionsRuntime.createSourceWindow(...args)
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
// CAS invalidates or overwrites the shared browser session when two campus
// entry points authenticate at once. The actor manager serializes lifecycles
// globally while keeping source-specific browser behavior in this process.
const authActorManager = createAuthActorManager({
  sources: AUTH_SOURCES,
  getEpoch: () => authEpoch,
  isExplicitlyLoggedOut: () => explicitlyLoggedOut,
  run: (actor) => authRuntime.runAuthActor(actor),
  finish: (actor) => authRuntime.finishAuthActor(actor),
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
    credentialSubmitCount: 0,
    authDebuggerPromise: null,
    authDebuggerAttached: false,
    authDebuggerRequests: new Map(),
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

const authStatusRuntime = createAuthStatusRuntime({
  smokeFile,
  verifiedSessions,
  statusChecks,
  forceSourceStatusChecks,
  authPendingSources,
  getStore: () => store,
  getSyncService: () => syncService,
  getSyncOrchestrator: () => syncOrchestrator,
  getSchoolSession: () => schoolSession,
  getSchoolProxyReady: () => schoolProxyReady,
  getAuthEpoch: () => authEpoch,
  isExplicitlyLoggedOut: () => explicitlyLoggedOut,
  getMainWindow: () => mainWindow,
  getSourceSessionUrl: sourceSessionUrl,
  assertAuthEpoch,
  writeDiagnostic,
  diagnosticError,
  getUnifiedAuthVerification: () => unifiedAuthVerification,
  setUnifiedAuthVerification: (value) => { unifiedAuthVerification = value },
})
const {
  rememberVerifiedSession,
  verifiedStatus,
  sourceStatus,
  freshSourceStatus,
  cachedStatus,
  loggedOutStatus,
  requestUnifiedAuthVerification,
  getStatus,
  broadcastAuthStatus,
} = authStatusRuntime

authRuntime = createAuthRuntime({
  BrowserWindow,
  authActorManager,
  authRecovery,
  authSources: AUTH_SOURCES,
  silentAuthSyncDomains: SILENT_AUTH_SYNC_DOMAINS,
  credentialAttempts,
  pendingSourceOpens,
  verifiedSessions,
  getAuthEpoch: () => authEpoch,
  isExplicitlyLoggedOut: () => explicitlyLoggedOut,
  setExplicitlyLoggedOut: (value) => { explicitlyLoggedOut = Boolean(value) },
  getSyncService: () => syncService,
  getSyncOrchestrator: () => syncOrchestrator,
  getFitnessRuntime: () => fitnessRuntime,
  getCredentialVault: () => credentialVault,
  getCourseWorkQueue: () => courseWorkQueue,
  getSchoolProxyReady: () => schoolProxyReady,
  verifiedStatus,
  freshSourceStatus,
  rememberVerifiedSession,
  loginTargetDetails,
  sourceWindowOptions,
  guardSourceWindow,
  loadSourceWindowUrl,
  createSourceWindow,
  closeWindowAndWait,
  assertAuthEpoch,
  getUnifiedAuthVerification: () => unifiedAuthVerification,
  requestUnifiedAuthVerification,
  broadcastAuthStatus,
  diagnosticUrl,
  diagnosticError,
  writeDiagnostic,
})
const openLoginWindow = (...args) => authRuntime.openLoginWindow(...args)
const freshJwglxtBrowserStatus = (...args) => authRuntime.freshJwglxtBrowserStatus(...args)
const recoverCourseSelectionReadSession = (...args) => authRuntime.recoverCourseSelectionReadSession(...args)
const closeLiveCaptureActors = (...args) => authRuntime.closeLiveCaptureActors(...args)
const waitForLiveCaptureAuthentication = (...args) => authRuntime.waitForLiveCaptureAuthentication(...args)
const clearAuthActorTimers = (actor) => authRuntime.clearAuthActorTimers(actor)

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

// Startup-phase timing helper. Each step returns a fresh start timestamp so
// callers can chain `step = logStartupStep('name', step)`. Durations land in
// the diagnostics stream for post-mortem analysis of the black-screen window.
function logStartupStep(name, startedAt) {
  const elapsedMs = Date.now() - (startedAt || Date.now())
  console.log(`[THEIA] startup ${name}: ${elapsedMs}ms`)
  void writeDiagnostic('startup.step', { name, elapsedMs })
  return Date.now()
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

function sourceWindowOptions({ title, width = 1200, height = 820, partition = PARTITION } = {}) {
  return {
    title,
    width,
    height,
    autoHideMenuBar: false,
    icon: APP_ICON,
    // Campus pages are automation-only. Never expose their BrowserWindows;
    // a delayed redirect must not surface after the main app starts closing.
    show: false,
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
    history: journal.history || [],
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
    const fitnessReady = await fitnessRuntime.ensureFitnessSession({ background: true })
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

function assertAuthEpoch(epoch, { allowLoggedOut = false } = {}) {
  if (epoch !== authEpoch || (!allowLoggedOut && explicitlyLoggedOut)) {
    const error = new Error('学校平台操作已因显式退出取消')
    error.code = 'AUTH_EPOCH_CHANGED'
    throw error
  }
}


function sourceFromUrl(rawUrl) {
  const hostname = new URL(rawUrl).hostname
  if (hostname === 'jwglxt.buct.edu.cn') return 'jwglxt'
  if (hostname === 'course.buct.edu.cn') return 'theol'
  if (hostname === 'tygl.buct.edu.cn') return 'tygl'
  return null
}

function locateTheolCourseResource(courseId, resourceId) {
  const id = String(courseId || '').trim()
  const resourceKey = String(resourceId || '').trim()
  if (!id || !resourceKey) throw new TypeError('THEOL 课程资源标识无效')
  const course = store?.snapshot()?.courses?.find((item) => item?.source === 'theol' && String(item.id || '') === id)
  if (!course) throw new Error('请先获取有效的北化在线THEOL课程')
  const resource = (Array.isArray(course.courseResources) ? course.courseResources : [])
    .find((item) => String(item?.id || '') === resourceKey || String(item?.sourceKey || '') === resourceKey)
  if (!resource || resource.kind === 'folder') throw new Error('找不到可下载的THEOL课程文件')
  const url = permittedSourceUrl(resource.url)
  if (sourceFromUrl(url) !== 'theol') throw new Error('THEOL 课程资源地址无效')
  return { course, resource: { ...resource, url } }
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

async function closeAllSourceWindows() {
  const windows = [...sourceWindows].filter((window) => window && !window.isDestroyed())
  await Promise.allSettled(windows.map((window) => closeWindowAndWait(window)))
}

function guardSourceWindow(window, {
  source = null,
  pauseAssignments = false,
  theolActor = null,
  theolLease = false,
  upgradeTyglRedirects = false,
} = {}) {
  sourceWindows.add(window)
  window.hide?.()
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
    void writeDiagnostic('source.popup_blocked', {
      source: window.__theiaSource || null,
      url: diagnosticUrl(url),
      reason: 'campus_source_windows_disabled',
    })
    return { action: 'deny' }
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

const theolInteractionRuntime = createTheolInteractionRuntime({
  BrowserWindow,
  sourceWindowOptions,
  guardSourceWindow,
  closeWindowAndWait,
  getSyncService: () => syncService,
  getAuthEpoch: () => authEpoch,
  isExplicitlyLoggedOut: () => explicitlyLoggedOut,
  assertAuthEpoch,
  writeDiagnostic,
  diagnosticUrl,
  diagnosticError,
})
const openTheolInteractiveWindow = (...args) => theolInteractionRuntime.open(...args)

sourceActionsRuntime = createSourceActionsRuntime({
  BrowserWindow,
  permittedSourceUrl,
  sourceFromUrl,
  sourceWindowOptions,
  guardSourceWindow,
  closeWindowAndWait,
  openTheolInteractiveWindow,
  getSyncService: () => syncService,
  getFitnessRuntime: () => fitnessRuntime,
  getCredentialVault: () => credentialVault,
  getSchoolSession: () => schoolSession,
  getSessionClient: () => sessionClient,
  getAcademicSessionClient: () => academicSessionClient,
  getAuthEpoch: () => authEpoch,
  openLoginWindow,
  verifiedStatus,
  verifiedSessions,
  rememberVerifiedSession,
  assertAuthEpoch,
  diagnosticUrl,
  diagnosticError,
  writeDiagnostic,
  getDocumentsDirectory: () => app.getPath('documents'),
})
const {
  openSchedulePdf,
  openCourseWorkWindow,
  attachFileToSourceWindow,
  fillTestInSourceWindow,
  openSourceWindow,
} = sourceActionsRuntime

const sourcePageRuntime = createSourcePageRuntime({
  BrowserWindow,
  sourceFromUrl,
  permittedSourceUrl,
  sourceWindowOptions,
  guardSourceWindow,
  loadSourceWindowUrl,
  closeWindowAndWait,
  syncPageQueue,
  fitnessPageQueue,
  getSyncPageWindow: () => syncPageWindow,
  setSyncPageWindow: (window) => { syncPageWindow = window },
  getFitnessPageWindow: () => fitnessPageWindow,
  setFitnessPageWindow: (window) => { fitnessPageWindow = window },
  pageCaptureOutput,
  pageCaptureLog,
  diagnosticUrl,
  diagnosticError,
  writeDiagnostic,
})
const {
  loadWithSchoolBrowser,
  loadWithFitnessBrowser,
  loadSchoolPage,
  loadFitnessBrowserPage,
  loadFitnessPage,
  submitSchoolForm,
  loadBinaryWithSchoolBrowser,
  submitFitnessForm,
} = sourcePageRuntime

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
      getAdvisorRuntime: () => advisorRuntime,
      syncCampusData: (request) => syncOrchestrator?.syncAdvisorCampusData(request),
      publishRuntime: false,
      renderTableImage: renderHtmlToPng,
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
  let startupClock = Date.now()
  const foundation = await initializeServiceFoundation({
    dataRoot: app.getPath('userData'),
    partition: PARTITION,
    safeStorage,
    smokeFile,
    liveCaptureOutput,
    pageCaptureLog,
    queueTheiaFeed,
    writeDiagnostic,
    diagnosticError,
    diagnosticUrl,
    logStartupStep,
    legacyRoot: legacyDataRoot(),
    rebaseLegacyWorkspacePaths: (state, options) => rebaseLegacyWorkspacePaths(state, options),
    loadSchoolPage,
    submitSchoolForm,
    loadBinaryWithSchoolBrowser,
    loadFitnessBrowserPage,
    loadFitnessPage,
    submitFitnessForm,
    verifiedStatus,
    rememberVerifiedSession,
    assertAuthEpoch,
    openLoginWindow,
    sendSnapshot,
    closeLiveCaptureActors,
    waitForLiveCaptureAuthentication,
    getSyncService: () => syncService,
    getAuthEpoch: () => authEpoch,
  })
  ;({
    store,
    motionVenueAdapter,
    schoolSession,
    schoolProxyReady,
    sessionClient,
    academicSessionClient,
    credentialVault,
    academicApiVault,
    academicAttachmentStore,
    theolAttachmentStore,
    theolCourseArchiveStore,
    mailVault,
    courseSelectionJournal,
    academicCalendarAssetsService,
    academicCalendarRuntime,
    fitnessRuntime,
    liveCaptureRunner,
    advisorUpgradeRule,
  } = foundation)
  startupClock = foundation.startupClock
  const domain = await initializeDomainServices({
    dataRoot: app.getPath('userData'),
    documentsRoot: app.getPath('documents'),
    safeStorage,
    store,
    sessionClient,
    academicSessionClient,
    credentialVault,
    academicApiVault,
    academicAttachmentStore,
    theolCourseArchiveStore,
    mailVault,
    courseSelectionJournal,
    academicCalendarRuntime,
    startupClock,
    logStartupStep,
    getMainWindow: () => mainWindow,
    setAdvisorRuntime: (value) => { advisorRuntime = value },
    getAuthEpoch: () => authEpoch,
    getExplicitlyLoggedOut: () => explicitlyLoggedOut,
    authActors,
    authRecovery,
    verifiedSessions,
    openLoginWindow,
    openSourceWindow,
    getSchoolProxyReady: () => schoolProxyReady,
    assertAuthEpoch,
    sendSnapshot,
    sendCourseSelectionSnapshot,
    courseSelectionSnapshot,
    restartLocalApi,
    createMailBrowserWindow,
    agentTools,
    writeDiagnostic,
    diagnosticError,
  })
  ;({
    courseWorkService,
    modelVault,
    modelService,
    advisorThreadStore,
    advisorRuntime,
    rebuildAdvisorRuntime,
    applyTheiaSettings,
    webmailService,
    mailService,
    syncService,
    syncOrchestrator,
    courseSelectionService,
  } = domain)
  startupClock = domain.startupClock
  void armCourseSelectionSentinel().catch((error) => writeDiagnostic('course_selection.sentinel_resume_failed', { error: diagnosticError(error) }))
  const integration = await initializeServiceIntegration({
    app,
    dataRoot: app.getPath('userData'),
    runtimeRoot: app.isPackaged
      ? resolve(process.resourcesPath, 'app.asar.unpacked', 'electron', 'iris-runtime')
      : resolve(import.meta.dirname, 'iris-runtime'),
    safeStorage,
    smokeFile,
    startupClock,
    logStartupStep,
    store,
    motionVenueAdapter,
    schoolProxyReady,
    schoolSession,
    academicCalendarAssetsService,
    academicCalendarRuntime,
    courseWorkService,
    syncService,
    modelService,
    modelVault,
    advisorRuntime,
    getAdvisorRuntime: () => advisorRuntime,
    credentialVault,
    academicApiVault,
    mailVault,
    sessionClient,
    theolAttachmentStore,
    theolCourseArchiveStore,
    syncOrchestrator,
    mailService,
    fitnessRuntime,
    courseSelectionService,
    courseSelectionJournal,
    academicAttachmentStore,
    advisorOverviewFromStore,
    advisorAcademicWhatIfFromStore,
    advisorCourseDecisionsFromStore,
    getAdvisorUpgradeRule: () => advisorUpgradeRule,
    rebuildAdvisorRuntime,
    applyTheiaSettings,
    authRecovery,
    cachedMotionVenueCatalog,
    cacheMotionVenueCatalog,
    cacheMotionVenueStatus,
    schoolScheduleWithProvenance,
    cachedSchoolScheduleResult,
    scanSchoolScheduleArchive,
    armCourseSelectionSentinel,
    sendCourseSelectionSnapshot,
    courseSelectionSnapshot,
    recoverCourseSelectionReadSession,
    academicAttachmentRepairs,
    openSourceWindow,
    openIrisControlPanel,
    modelProbeTickets,
    recentActivityLog,
    getStatus,
    getLocalApi: () => localApi,
    openLoginWindow,
    appearanceService,
    theolInteractionRuntime,
    authActors,
    authPendingSources,
    statusChecks,
    forceSourceStatusChecks,
    credentialAttempts,
    pendingSourceOpens,
    sourceWindows,
    verifiedSessions,
    closeWindowAndWait,
    clearAuthActorTimers,
    syncPageQueue,
    fitnessPageQueue,
    getSyncPageWindow: () => syncPageWindow,
    setSyncPageWindow: (window) => { syncPageWindow = window },
    getFitnessPageWindow: () => fitnessPageWindow,
    setFitnessPageWindow: (window) => { fitnessPageWindow = window },
    loggedOutStatus,
    setExplicitlyLoggedOut: (value) => { explicitlyLoggedOut = Boolean(value) },
    incrementAuthEpoch: () => { authEpoch += 1 },
    setUnifiedAuthVerification: (value) => { unifiedAuthVerification = value },
    ipcMain,
    BrowserWindow,
    dialog,
    shell,
    calendarAssetUrl,
    academicPlanAssetBaseUrl,
    sendSnapshot,
    clearCredentialAttempts: () => credentialAttempts.clear(),
    getAuthEpoch: () => authEpoch,
    assertAuthEpoch,
    waitForSchoolProxy: () => schoolProxyReady.catch(() => undefined),
    renderMarkdownToPdf,
    renderTableImage: renderHtmlToPng,
    locateTheolCourseResource,
    openSchedulePdf,
    openCourseWorkWindow,
    attachFileToSourceWindow,
    fillTestInSourceWindow,
    getDataRoot: () => app.getPath('userData'),
    getDocumentsDirectory: () => app.getPath('documents'),
    getDownloadsDirectory: () => app.getPath('downloads'),
    getVersion: () => app.getVersion(),
    writeFile,
    resolvePath: resolve,
    writeDiagnostic,
    diagnosticError,
    copyFile,
    mkdir,
    basename,
    extname,
    getMainWindow: () => mainWindow,
    restartLocalApi,
    setLocalApi: (value) => { localApi = value },
    setCourseWorkQueue: (value) => { courseWorkQueue = value },
    setIrisCompanion: (value) => { irisCompanion = value },
    setAcademicCalendarProbeTimer: (value) => { academicCalendarProbeTimer = value },
  })
  startupClock = integration.startupClock
  logStartupStep('services_ready_done', startupClock)
}

async function openIrisControlPanel() {
  if (irisControlWindow && !irisControlWindow.isDestroyed()) {
    irisControlWindow.show()
    irisControlWindow.focus()
    return { opened: true, url: irisControlWindow.webContents.getURL() || undefined }
  }
  const status = await irisCompanion?.status()
  if (!status?.running || !status.controlUrl) throw new Error('Iris 尚未运行，请先启动 companion')
  let target = new URL(status.controlUrl)
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1') throw new Error('Iris 控制面板地址无效')
  const deadline = Date.now() + 5_000
  let ready = false
  while (Date.now() < deadline) {
    try {
      const current = await irisCompanion.status()
      if (current.controlUrl) target = new URL(current.controlUrl)
      const response = await fetch(new URL('/api/status', target), { signal: AbortSignal.timeout(600), cache: 'no-store' })
      if (response.ok) { ready = true; break }
    } catch { /* companion control server may still be starting */ }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 120))
  }
  if (!ready) throw new Error('Iris 控制面板尚未就绪，请稍后重试')
  const window = new BrowserWindow({
    title: 'Iris 控制面板',
    width: 1120,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    icon: APP_ICON,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  irisControlWindow = window
  window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show() })
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== target.origin) event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.on('closed', () => { if (irisControlWindow === window) irisControlWindow = null })
  try {
    await window.loadURL(target.toString())
  } catch (error) {
    if (!window.isDestroyed()) window.close()
    throw error
  }
  return { opened: true, url: target.toString() }
}

const windowRuntime = createWindowRuntime({
  app,
  BrowserWindow,
  shell,
  root,
  APP_ICON,
  getMainWindow: () => mainWindow,
  setMainWindow: (window) => { mainWindow = window },
  getSplashWindow: () => splashWindow,
  setSplashWindow: (window) => { splashWindow = window },
  getMainEntryUrl: () => mainEntryUrl,
  setMainEntryUrl: (url) => { mainEntryUrl = url },
  getViteServer: () => viteServer,
  setViteServer: (server) => { viteServer = server },
  getSyncPageWindow: () => syncPageWindow,
  getFitnessPageWindow: () => fitnessPageWindow,
  onMainWindowClosed: () => { if (process.platform !== 'darwin') app.quit() },
  mainRendererCsp,
  isPermittedAppNavigation,
  isPermittedSourceUrl,
  permittedExternalUrl,
  writeDiagnostic,
  diagnosticUrl,
  diagnosticError,
  broadcastAuthStatus,
  renderMarkdownToPdf,
  probeAcademicCalendarOcrRuntime,
  finishSmoke,
  smokeFile,
  preloadErrors,
})
const createSplashWindow = (...args) => windowRuntime.createSplashWindow(...args)
const createMainWindow = (...args) => windowRuntime.createMainWindow(...args)

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
    syncOrchestrator?.shutdown()
    modelService?.cancelAll()
    advisorRuntime?.cancelAll()
    syncPageQueue.cancelPending(new Error('Application shutdown cancelled the queued school request'))
    fitnessPageQueue.cancelPending(new Error('Application shutdown cancelled the queued fitness request'))
    courseSelectionService?.stop()
    const interactiveActor = theolInteractionRuntime.invalidateCurrent('THEIA 正在退出')
    await closeLiveCaptureActors('THEIA 正在退出')
    await closeAllSourceWindows()
    await Promise.allSettled([interactiveActor?.lifecycle])
    await Promise.allSettled([
      syncService?.stopAndWait?.() ?? syncService?.stop?.(),
      mailService?.stopAndWait?.() ?? mailService?.stop?.(),
      webmailService?.stopAndWait?.() ?? webmailService?.stop?.(),
    ])
    if (irisControlWindow && !irisControlWindow.isDestroyed()) irisControlWindow.close()
    irisControlWindow = null
    await Promise.allSettled([
      advisorRuntime?.flush?.(),
      courseWorkQueue?.close({ cancelRunning: true }),
      feedWrite,
      diagnosticWrite,
      store?.drain(),
      localApi?.close(),
      irisCompanion?.shutdown(),
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
  migrateFromLegacyDir().then(() => app.whenReady()).then(async () => {
    Menu.setApplicationMenu(null)
    registerLocalProtocols()
    await startServices()
    await autoLoginOnStartup()
    await inspectAuthenticatedPages()
  }).then(() => app.quit()).catch((error) => {
    console.error('[THEIA] inspection failed', error)
    app.exit(1)
  })
} else {
  const lock = app.requestSingleInstanceLock()
  if (!lock) {
    console.error('[THEIA] Single instance lock failed - another instance is already running')
    app.whenReady().then(() => {
      dialog.showErrorBoxSync(
        'THEIA 已在运行',
        'THEIA 的另一个实例正在运行。\n\n' +
        '如果您确认没有打开其他 THEIA 窗口，可能是进程残留导致的。\n\n' +
        '解决方法：\n' +
        '1. 打开任务管理器（Ctrl+Shift+Esc）\n' +
        '2. 在"进程"选项卡中找到并结束所有 THEIA 进程\n' +
        '3. 重新启动 THEIA\n\n' +
        '或运行安装目录下的 fix-theia-startup.bat 自动修复。'
      )
      app.quit()
    })
  } else {
    console.log('[THEIA] Single instance lock acquired, starting application...')
    migrateFromLegacyDir().then(() => app.whenReady()).then(async () => {
      Menu.setApplicationMenu(null)
      registerLocalProtocols()
      let startupClock = Date.now()
      if (liveCaptureOutput) {
        try {
          const result = await startServices().then(() => liveCaptureRunner.run())
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
      // A branded splash covers the service startup window so the user never
      // stares at a black screen while the main window is still being prepared.
      if (!smokeFile) {
        try {
          splashWindow = await createSplashWindow()
          startupClock = logStartupStep('splash_created', startupClock)
        } catch (error) {
          console.warn('[THEIA] splash window could not be created; startup will continue', error)
        }
      }
      await Promise.all([startVite(), startServices()])
      startupClock = logStartupStep('services_ready', startupClock)
      await createMainWindow()
      startupClock = logStartupStep('main_window_loaded', startupClock)
      if (!smokeFile) void autoLoginOnStartup().catch((error) => console.error('[THEIA] automatic login failed', error))
      app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) void createMainWindow() })
    }).catch((error) => {
      console.error('[THEIA] startup failed', error)
      if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close()
      splashWindow = null
      app.whenReady().then(() => {
        dialog.showErrorBoxSync(
          'THEIA 启动失败',
          `启动时发生错误：\n\n${error.message || error}\n\n` +
          '请尝试：\n' +
          '1. 运行 fix-theia-startup.bat 清理残留文件\n' +
          '2. 检查 %APPDATA%\\THEIA 目录权限\n' +
          '3. 查看该目录下的日志文件获取详细信息'
        )
        app.quit()
      }).catch(() => app.quit())
    })
  }
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', (event) => {
  if (shutdownComplete) return
  event.preventDefault()
  void shutdownServices()
    .catch((error) => console.error('[THEIA] shutdown cleanup failed', error))
    .finally(() => app.exit(requestedExitCode))
})
