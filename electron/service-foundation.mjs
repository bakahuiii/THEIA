import { session } from 'electron'
import { randomUUID } from 'node:crypto'
import { CampusStore } from '../core/store.mjs'
import { SessionClient } from '../core/source-client.mjs'
import { MotionVenueAdapter } from '../core/adapters/motion.mjs'
import { AcademicCalendarAssetsService } from '../core/academic-calendar-assets.mjs'
import { loadAcademicCalendarCatalog } from '../core/catalog-provenance.mjs'
import { defaultDataRoot } from '../core/runtime-paths.mjs'
import { CredentialVault } from './credential-vault.mjs'
import { AcademicApiVault } from './academic-api-vault.mjs'
import { MailVault } from './mail-vault.mjs'
import { CourseSelectionJournal } from '../core/course-selection-journal.mjs'
import { JwglxtAttachmentStore } from '../core/jwglxt-attachment-store.mjs'
import { TheolAttachmentStore } from '../core/theol-attachment-store.mjs'
import { loadTrustedUpgradeRule } from './advisor-upgrade-rule.mjs'
import { createAcademicCalendarRuntime } from './academic-calendar-runtime.mjs'
import { createFitnessRuntime } from './fitness-runtime.mjs'
import { createLiveCaptureRunner } from './live-capture-runner.mjs'

const CHROME_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'

function browserDiagnostic(onDiagnostic, diagnosticUrl) {
  return (event, fields) => onDiagnostic(event, {
    ...fields,
    ...(fields.url ? { url: diagnosticUrl(fields.url) } : {}),
    ...(fields.referer ? { referer: diagnosticUrl(fields.referer) } : {}),
  })
}

function installSchoolHeaders(schoolSession) {
  schoolSession.setUserAgent(CHROME_USER_AGENT)
  schoolSession.webRequest.onBeforeSendHeaders({ urls: ['*://*.buct.edu.cn/*', '*://buct.edu.cn/*'] }, (details, callback) => {
    const headers = { ...details.requestHeaders }
    headers['User-Agent'] = CHROME_USER_AGENT
    headers['Accept'] = headers['Accept'] || 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
    headers['Accept-Language'] = 'zh-CN,zh;q=0.9,en;q=0.8'
    headers['Sec-CH-UA'] = '"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"'
    headers['Sec-CH-UA-Mobile'] = '?0'
    headers['Sec-CH-UA-Platform'] = '"Windows"'
    // Keep the official CAS X-Requested-With header, but remove Electron-only
    // headers that trigger server-side bot detection.
    delete headers['X-Electron-Version']
    callback({ requestHeaders: headers })
  })
}

export async function initializeServiceFoundation({
  dataRoot = defaultDataRoot(),
  partition,
  safeStorage,
  smokeFile,
  liveCaptureOutput,
  pageCaptureLog,
  queueTheiaFeed,
  writeDiagnostic,
  diagnosticError,
  diagnosticUrl,
  logStartupStep,
  legacyRoot,
  rebaseLegacyWorkspacePaths,
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
  getSyncService,
  getCredentialVault,
  getAuthEpoch,
} = {}) {
  let startupClock = Date.now()
  const store = new CampusStore(dataRoot)
  const storeStartedAt = Date.now()
  await store.load()
  startupClock = logStartupStep('store_loaded', startupClock)
  const motionVenueAdapter = new MotionVenueAdapter()
  try {
    const workspaceMigration = await rebaseLegacyWorkspacePaths(store.snapshot(), {
      currentRoot: dataRoot,
      legacyRoot,
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

  const credentialVault = new CredentialVault(dataRoot, safeStorage)
  const academicApiVault = new AcademicApiVault(dataRoot, safeStorage)
  const academicAttachmentStore = new JwglxtAttachmentStore(dataRoot)
  const theolAttachmentStore = new TheolAttachmentStore(dataRoot)
  const mailVault = new MailVault(dataRoot, safeStorage)
  const courseSelectionJournal = new CourseSelectionJournal(dataRoot)
  await courseSelectionJournal.load()
  startupClock = logStartupStep('journal_loaded', startupClock)

  const academicCalendarAssetsService = new AcademicCalendarAssetsService({
    root: dataRoot,
    onDiagnostic: writeDiagnostic,
    profileProvider: () => store.snapshot()?.profile || null,
    coursesProvider: () => store.snapshot()?.courses || [],
    academicTrackProvider: () => store.snapshot()?.profile?.academicTrack || null,
  })
  const calendarManifest = await academicCalendarAssetsService.load()
  await store.update((state) => loadAcademicCalendarCatalog(state, { manifest: calendarManifest, runId: randomUUID() }))
  startupClock = logStartupStep('calendar_ready', startupClock)
  const advisorUpgradeRule = await loadTrustedUpgradeRule({
    root: dataRoot,
    onDiagnostic: writeDiagnostic,
  })

  const schoolSession = session.fromPartition(partition)
  const proxyStartedAt = Date.now()
  const schoolProxyReady = schoolSession.setProxy({ mode: 'direct' })
    .then(() => {
      void writeDiagnostic('network.proxy_ready', { elapsedMs: Date.now() - proxyStartedAt, mode: 'direct' })
    })
    .catch((error) => {
      void writeDiagnostic('network.proxy_error', { elapsedMs: Date.now() - proxyStartedAt, error: diagnosticError(error) })
    })
  installSchoolHeaders(schoolSession)
  const onClientDiagnostic = browserDiagnostic(writeDiagnostic, diagnosticUrl)
  const sessionClient = new SessionClient(schoolSession, {
    pageLoader: smokeFile ? null : loadSchoolPage,
    formLoader: smokeFile ? null : submitSchoolForm,
    onDiagnostic: onClientDiagnostic,
  })
  const academicSessionClient = new SessionClient(schoolSession, {
    pageLoader: smokeFile ? null : loadSchoolPage,
    formLoader: smokeFile ? null : submitSchoolForm,
    binaryLoader: smokeFile ? null : loadBinaryWithSchoolBrowser,
    onDiagnostic: onClientDiagnostic,
  })

  const academicCalendarRuntime = createAcademicCalendarRuntime({
    store,
    academicApiVault,
    academicAttachmentStore,
    academicCalendarAssetsService,
    getAcademicSessionClient: () => academicSessionClient,
    getSyncService,
    getCredentialVault: getCredentialVault || (() => credentialVault),
    verifiedStatus,
    rememberVerifiedSession,
    assertAuthEpoch,
    openLoginWindow,
    sendSnapshot,
    writeDiagnostic,
    diagnosticError,
  })
  const fitnessRuntime = createFitnessRuntime({
    store,
    schoolSession,
    loadFitnessBrowserPage,
    loadFitnessPage,
    submitFitnessForm,
    openLoginWindow,
    assertAuthEpoch,
    getAuthEpoch,
    sendSnapshot,
    writeDiagnostic,
    diagnosticUrl,
    diagnosticError,
  })
  const liveCaptureRunner = createLiveCaptureRunner({
    output: liveCaptureOutput,
    pageCaptureLog,
    schoolSession,
    academicApiVault,
    academicSessionClient,
    getSchoolProxyReady: () => schoolProxyReady,
    openLoginWindow,
    waitForAuthentication: waitForLiveCaptureAuthentication,
    closeAuthenticationActors: closeLiveCaptureActors,
    verifiedStatus,
    diagnosticUrl,
    diagnosticError,
    writeDiagnostic,
    getAuthEpoch,
  })

  void academicCalendarRuntime.normalizeAcademicPlanAttachmentCache()
    .catch((error) => writeDiagnostic('jwglxt.attachment_migration_failed', { error: diagnosticError(error) }))
  if (!smokeFile) {
    void academicCalendarRuntime.refreshAcademicCalendarAssets({ trigger: 'startup' })
      .catch((error) => writeDiagnostic('academic_calendar.refresh_failed', { error: diagnosticError(error) }))
  }

  return {
    startupClock,
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
    mailVault,
    courseSelectionJournal,
    academicCalendarAssetsService,
    academicCalendarRuntime,
    fitnessRuntime,
    liveCaptureRunner,
    advisorUpgradeRule,
  }
}
