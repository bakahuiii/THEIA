import { IrisCompanion } from './iris-companion.mjs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { startCourseWorkQueue } from './course-work-queue-runtime.mjs'
import { createLocalApiHandlers } from './local-api-handlers.mjs'
import { registerRuntimeIpc } from './runtime-ipc.mjs'
import { configureCosUpdateProvider, createGithubUpdateRuntime } from './github-update-runtime.mjs'
import updater from 'electron-updater'
import { THEOL_ATTACHMENT_MAX_BYTES } from '../core/theol-attachment-store.mjs'
import { startLocalApi } from '../core/local-api.mjs'

const { autoUpdater } = updater

async function loadSkippedUpdateVersion(root) {
  try {
    const raw = JSON.parse(await readFile(resolve(root, 'update-preferences.json'), 'utf8'))
    return typeof raw?.skippedVersion === 'string' && raw.skippedVersion.trim()
      ? raw.skippedVersion.trim()
      : null
  } catch {
    return null
  }
}

export async function initializeServiceIntegration({
  app,
  dataRoot,
  runtimeRoot,
  safeStorage,
  smokeFile,
  startupClock,
  logStartupStep,
  store,
  motionVenueAdapter,
  schoolProxyReady,
  academicCalendarAssetsService,
  academicCalendarRuntime,
  schoolSession,
  courseWorkService,
  syncService,
  modelService,
  modelVault,
  advisorRuntime,
  getAdvisorRuntime = () => advisorRuntime,
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
  cachedMotionVenueCatalog,
  cacheMotionVenueCatalog,
  cacheMotionVenueStatus,
  getAdvisorUpgradeRule,
  rebuildAdvisorRuntime,
  applyTheiaSettings,
  authRecovery,
  schoolScheduleWithProvenance,
  cachedSchoolScheduleResult,
  scanSchoolScheduleArchive,
  armCourseSelectionSentinel,
  sendCourseSelectionSnapshot,
  courseSelectionSnapshot,
  recoverCourseSelectionReadSession,
  recoverTheolReadSession,
  academicAttachmentRepairs,
  openSourceWindow,
  openIrisControlPanel,
  modelProbeTickets,
  recentActivityLog,
  getStatus,
  getLocalApi = () => localApi,
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
  getSyncPageWindow,
  setSyncPageWindow,
  getFitnessPageWindow,
  setFitnessPageWindow,
  loggedOutStatus,
  setExplicitlyLoggedOut,
  incrementAuthEpoch,
  setUnifiedAuthVerification,
  ipcMain,
  BrowserWindow,
  dialog,
  shell,
  calendarAssetUrl,
  academicPlanAssetBaseUrl,
  sendSnapshot,
  clearCredentialAttempts,
  getAuthEpoch,
  assertAuthEpoch,
  waitForSchoolProxy,
  renderMarkdownToPdf,
  locateTheolCourseResource,
  openSchedulePdf,
  openCourseWorkWindow,
  attachFileToSourceWindow,
  fillTestInSourceWindow,
  getDataRoot,
  getDocumentsDirectory,
  getDownloadsDirectory,
  getVersion,
  writeFile,
  resolvePath,
  writeDiagnostic,
  diagnosticError,
  renderTableImage,
  copyFile,
  mkdir,
  basename,
  extname,
  getMainWindow,
  restartLocalApi,
  setLocalApi = () => {},
  setCourseWorkQueue = () => {},
  setIrisCompanion = () => {},
  setAcademicCalendarProbeTimer = () => {},
} = {}) {
  let currentStartupClock = startupClock
  const courseWorkQueue = await startCourseWorkQueue({
    root: dataRoot,
    store,
    courseWorkService,
    syncService,
    modelService,
    getMainWindow,
    getAuthEpoch,
    assertAuthEpoch,
    recoverTheolReadSession,
    writeDiagnostic,
    sendSnapshot,
  })
  setCourseWorkQueue(courseWorkQueue)
  currentStartupClock = logStartupStep('course_work_queue_loaded', currentStartupClock)

  const localApiHandlers = createLocalApiHandlers({
    store,
    syncService,
    motionVenueAdapter,
    getAuthEpoch,
    waitForSchoolProxy,
    assertAuthEpoch,
    sendSnapshot,
    writeDiagnostic,
    diagnosticError,
  })
  const localApi = await startLocalApi({
    store,
    root: dataRoot,
    preferredPort: store.state.settings.apiPort,
    academicCalendarAssetsService,
    getAdvisorRuntime,
    syncCampusData: (request) => syncOrchestrator?.syncAdvisorCampusData(request),
    renderTableImage,
    ...localApiHandlers,
  })
  setLocalApi(localApi)
  currentStartupClock = logStartupStep('local_api_started', currentStartupClock)
  if (localApi.port !== store.state.settings.apiPort) {
    await store.update((state) => ({ ...state, settings: { ...state.settings, apiPort: localApi.port } }))
  }
  if (!smokeFile) {
    const timer = setInterval(() => {
      void academicCalendarRuntime.refreshAcademicCalendarAssets({ trigger: 'timer' })
        .catch((error) => writeDiagnostic('academic_calendar.refresh_failed', { error: diagnosticError(error) }))
    }, 6 * 60 * 60 * 1000)
    timer.unref?.()
    setAcademicCalendarProbeTimer(timer)
  }
  if (!smokeFile && process.env.THEIA_FULL_SCHOOL_SCHEDULE_SCAN === '1') {
    void scanSchoolScheduleArchive().catch((error) => writeDiagnostic('school_schedule.archive_failed', { error: diagnosticError(error) }))
  }

  const irisCompanion = new IrisCompanion({
    root: dataRoot,
    runtimeRoot,
    storage: safeStorage,
  })
  setIrisCompanion(irisCompanion)
  void irisCompanion.start().catch((error) => writeDiagnostic('iris.start_failed', { error: diagnosticError(error) }))

  const updateEnabled = app.isPackaged && process.env.THEIA_DISABLE_AUTO_UPDATE !== '1'
  if (updateEnabled) configureCosUpdateProvider(autoUpdater)
  let skippedUpdateVersion = updateEnabled ? await loadSkippedUpdateVersion(dataRoot) : null
  const updateRuntime = createGithubUpdateRuntime({
    autoUpdater,
    currentVersion: getVersion(),
    enabled: updateEnabled,
    platform: process.platform,
    getSkippedVersion: () => skippedUpdateVersion,
    setSkippedVersion: async (version) => {
      skippedUpdateVersion = String(version || '').trim() || null
      await writeFile(
        resolve(dataRoot, 'update-preferences.json'),
        `${JSON.stringify({ skippedVersion: skippedUpdateVersion })}\n`,
        'utf8',
      )
    },
    sendStatus: (status) => {
      const window = getMainWindow()
      if (!window || window.isDestroyed()) return
      window.webContents.send('theia:update-status', status)
    },
  })
  if (updateEnabled && !smokeFile) {
    void updateRuntime.checkForUpdates().catch((error) => writeDiagnostic('update.check_failed', { error: diagnosticError(error) }))
  }

  registerRuntimeIpc({
    ipcMain,
    BrowserWindow,
    dialog,
    shell,
    store,
    getMainWindow,
    updateRuntime,
    modelService,
    modelVault,
    getLocalApi,
    calendarAssetUrl,
    academicPlanAssetBaseUrl,
    sendSnapshot,
    credentialVault,
    academicApiVault,
    mailVault,
    clearCredentialAttempts,
    authRecovery,
    getAuthEpoch,
    assertAuthEpoch,
    waitForSchoolProxy,
    getStatus,
    openLoginWindow,
    irisCompanion,
    recentActivityLog,
    openIrisControlPanel,
    modelProbeTickets,
    rebuildAdvisorRuntime,
    motionVenueAdapter,
    cachedMotionVenueCatalog,
    cacheMotionVenueCatalog,
    cacheMotionVenueStatus,
    courseWorkQueue,
    courseWorkService,
    sessionClient,
    syncService,
    theolAttachmentStore,
    theolCourseArchiveStore,
    theolAttachmentMaxBytes: THEOL_ATTACHMENT_MAX_BYTES,
    renderMarkdownToPdf,
    locateTheolCourseResource,
    openSchedulePdf,
    openCourseWorkWindow,
    attachFileToSourceWindow,
    fillTestInSourceWindow,
    getDataRoot,
    getDocumentsDirectory,
    getDownloadsDirectory,
    getVersion,
    writeFile,
    resolvePath,
    syncOrchestrator,
    mailService,
    academicCalendarRuntime,
    fitnessRuntime,
    scanSchoolScheduleArchive,
    advisorRuntime,
    advisorOverviewFromStore,
    getUpgradeRule: getAdvisorUpgradeRule,
    advisorAcademicWhatIfFromStore,
    advisorCourseDecisionsFromStore,
    applyTheiaSettings,
    courseSelectionService,
    courseSelectionJournal,
    cachedSchoolScheduleResult,
    schoolScheduleWithProvenance,
    armCourseSelectionSentinel,
    sendCourseSelectionSnapshot,
    courseSelectionSnapshot,
    recoverCourseSelectionReadSession,
    recoverTheolReadSession,
    academicCalendarAssetsService,
    academicAttachmentStore,
    academicAttachmentRepairs,
    openSourceWindow,
    writeDiagnostic,
    diagnosticError,
    appearanceService,
    copyFile,
    mkdir,
    basename,
    extname,
    authActors,
    authPendingSources,
    statusChecks,
    forceSourceStatusChecks,
    credentialAttempts,
    pendingSourceOpens,
    sourceWindows,
    verifiedSessions,
    theolInteractionRuntime,
    clearAuthActorTimers,
    closeWindowAndWait,
    syncPageQueue,
    fitnessPageQueue,
    getSyncPageWindow,
    setSyncPageWindow,
    getFitnessPageWindow,
    setFitnessPageWindow,
    schoolSession,
    loggedOutStatus,
    setExplicitlyLoggedOut,
    incrementAuthEpoch,
    setUnifiedAuthVerification,
  })
  return { startupClock: currentStartupClock, courseWorkQueue, localApi, irisCompanion }
}
