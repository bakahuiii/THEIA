import { cachedFitnessResult } from '../core/data-catalog.mjs'
import { JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES } from '../core/jwglxt-extra.mjs'
import { requestedFitnessYear } from './fitness-runtime.mjs'
import {
  ADVISOR_ACTION_ERROR,
  advisorActionFailure,
  assertAdvisorSnapshotRevision,
  resolveAdvisorActionFromStore,
} from './advisor-action-service.mjs'
import {
  registerAdvisorReadIpc,
  registerAppearanceIpc,
  registerCourseSelectionIpc,
  registerCourseWorkQueueIpc,
  registerMailboxIpc,
  registerMotionVenueIpc,
  registerGithubUpdateIpc,
  registerModelRuntimeIpc,
  registerWindowIpc,
  registerUserDataIpc,
} from './ipc-registration.mjs'
import { registerCourseWorkWorkflowIpc } from './course-work-ipc.mjs'
import { registerAuthIpc } from './auth-ipc.mjs'
import { registerIrisIpc } from './iris-ipc.mjs'
import { registerModelConfigIpc } from './model-config-ipc.mjs'
import { registerDataExportIpc } from './data-export-ipc.mjs'
import { registerSyncIpc } from './sync-ipc.mjs'

/**
 * Registers the IPC surface that is assembled only after all runtime services
 * are ready. Service construction stays in main.mjs; channel ownership lives
 * here so the main process does not become a second application router.
 */
export function registerRuntimeIpc({
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
  theolAttachmentMaxBytes,
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
  getUpgradeRule,
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
  requestedFitnessYearOverride = requestedFitnessYear,
  cachedFitnessResultOverride = cachedFitnessResult,
  writeDiagnostic,
  diagnosticError,
  jwglxtActiveExtraDomainNames = JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES,
  copyFile,
  mkdir,
  basename,
  extname,
  appearanceService,
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
}) {
  registerModelRuntimeIpc({
    ipcMain,
    modelService,
    modelVault,
    store,
    getLocalApi,
    calendarAssetUrl,
    academicPlanAssetBaseUrl,
    sendSnapshot,
  })
  registerGithubUpdateIpc({ ipcMain, updateRuntime })
  registerUserDataIpc({ ipcMain, store })
  registerAuthIpc({
    ipcMain,
    store,
    credentialVault,
    academicApiVault,
    mailVault,
    clearCredentialAttempts,
    authRecovery,
    getAuthEpoch,
    assertAuthEpoch,
    recoverTheolReadSession,
    waitForSchoolProxy,
    getStatus,
    openLoginWindow,
  })
  registerIrisIpc({ ipcMain, irisCompanion, recentActivityLog, openIrisControlPanel })
  registerModelConfigIpc({
    ipcMain,
    modelService,
    modelVault,
    modelProbeTickets,
    store,
    sendSnapshot,
    rebuildAdvisorRuntime,
  })
  registerMotionVenueIpc({
    ipcMain,
    adapter: motionVenueAdapter,
    store,
    cachedMotionVenueCatalog,
    cacheMotionVenueCatalog,
    cacheMotionVenueStatus,
    sendSnapshot,
    writeDiagnostic,
  })
  registerCourseWorkQueueIpc({ ipcMain, queue: courseWorkQueue })
  registerCourseWorkWorkflowIpc({
    ipcMain,
    dialog,
    shell,
    getMainWindow,
    courseWorkService,
    sessionClient,
    syncService,
    store,
    theolAttachmentStore,
    theolCourseArchiveStore,
    theolAttachmentMaxBytes,
    modelService,
    renderMarkdownToPdf,
    getAuthEpoch,
    assertAuthEpoch,
    waitForSchoolProxy,
    locateCourseResource: locateTheolCourseResource,
    openSchedulePdf,
    openCourseWorkWindow,
    attachFileToSourceWindow,
    fillTestInSourceWindow,
    getDataRoot,
    sendSnapshot,
  })
  registerDataExportIpc({
    ipcMain,
    dialog,
    shell,
    getMainWindow,
    getDocumentsDirectory,
    getDataRoot,
    store,
    getCourseSelection: () => courseSelectionJournal?.snapshot() || null,
    getVersion,
    writeDiagnostic,
  })
  registerSyncIpc({
    ipcMain,
    syncOrchestrator,
    syncService,
    mailService,
    academicCalendarRuntime,
    fitnessRuntime,
    scanSchoolScheduleArchive,
    store,
    sendSnapshot,
    waitForSchoolProxy,
    getAuthEpoch,
    assertAuthEpoch,
  })

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
    getUpgradeRule,
    advisorAcademicWhatIfFromStore,
    advisorCourseDecisionsFromStore,
  })
  ipcMain.handle('theia:advisor:execute-action', async (_event, request) => {
    const resolution = resolveAdvisorActionFromStore(store, request)
    if (!resolution.ok) return resolution
    const epoch = getAuthEpoch()
    const assertCurrentSnapshot = () => assertAdvisorSnapshotRevision(store, resolution.snapshotRevision)
    try {
      assertAuthEpoch(epoch)
      assertCurrentSnapshot()
      const entry = courseWorkService.assignmentEntry(resolution.target.assignmentId, { requireCurrent: false })
      await waitForSchoolProxy()
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
  registerMailboxIpc({
    ipcMain,
    mailVault,
    mailService,
    store,
    dialog,
    getDownloadsDirectory,
    writeFile,
    resolvePath,
    basename,
    sendSnapshot,
    writeDiagnostic,
  })
  ipcMain.handle('theia:logout', async () => {
    setExplicitlyLoggedOut(true)
    syncService.disable()
    await courseWorkQueue?.setEnabled(false)
    incrementAuthEpoch()
    statusChecks.jwglxt = null
    statusChecks.theol = null
    forceSourceStatusChecks.clear()
    setUnifiedAuthVerification(null)
    const interactiveActor = theolInteractionRuntime.invalidateCurrent()
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
      getSyncPageWindow(),
      getFitnessPageWindow(),
    ])
    await Promise.all([...windows].map((window) => closeWindowAndWait(window)))
    interactiveActor?.resolveClosed()
    for (const actor of actors) actor.resolveClosed()
    setSyncPageWindow(null)
    setFitnessPageWindow(null)
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
    const window = getMainWindow()
    if (window && !window.isDestroyed()) window.webContents.send('theia:auth-status', status)
    return status
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
    recoverCourseSelectionReadSession,
    writeDiagnostic,
  })
  ipcMain.handle('theia:get-academic-calendar-assets', () => academicCalendarAssetsService.snapshot())
  ipcMain.handle('theia:refresh-academic-calendar-assets', async (_event, options) => (
    academicCalendarRuntime.refreshAcademicCalendarAssets({ force: Boolean(options?.force), trigger: 'manual' })
  ))
  ipcMain.handle('theia:open-source', async (_event, url) => {
    const epoch = getAuthEpoch()
    assertAuthEpoch(epoch)
    await waitForSchoolProxy()
    assertAuthEpoch(epoch)
    return openSourceWindow(url, { expectedEpoch: epoch })
  })
  ipcMain.handle('theia:open-academic-attachment', async (_event, domain, attachmentId) => {
    const epoch = getAuthEpoch()
    assertAuthEpoch(epoch)
    if (!jwglxtActiveDomainNames.includes(domain)) throw new Error('Unsupported academic attachment domain')
    const attachment = store.snapshot().academicExtras?.domains?.[domain]?.attachments
      ?.find((item) => item?.id === attachmentId)
    if (!attachment) return { cached: false }
    let cached = await academicAttachmentStore?.find(attachment.id, 'pdf')
    if (!cached && attachment.sourceUrl) {
      const repairKey = `${domain}:${attachment.id}`
      let repair = academicAttachmentRepairs.get(repairKey)
      if (!repair) {
        repair = academicCalendarRuntime.repairAcademicAttachment(attachment, { domain, expectedEpoch: epoch })
        academicAttachmentRepairs.set(repairKey, repair)
      }
      try {
        await repair
        assertAuthEpoch(epoch)
        cached = await academicAttachmentStore?.find(attachment.id, 'pdf')
      } catch (error) {
        void writeDiagnostic('jwglxt.attachment_repair_failed', { domain, attachmentId, error: diagnosticError(error) })
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
  ipcMain.handle('theia:get-fitness-score', async (_event, requestedYear, options) => {
    const selectedYear = requestedFitnessYearOverride(requestedYear)
    const forceRefresh = options?.refresh === true
    const cached = !forceRefresh && cachedFitnessResultOverride(store.snapshot().dataCatalog, selectedYear)
    if (cached) {
      void writeDiagnostic('fitness.cache_hit', { yearKey: cached.yearKey, cachedAt: cached.cachedAt })
      return cached
    }
    const epoch = getAuthEpoch()
    assertAuthEpoch(epoch)
    await waitForSchoolProxy()
    assertAuthEpoch(epoch)
    return fitnessRuntime.importFitnessArchive(selectedYear, epoch)
  })
  registerWindowIpc({ ipcMain, BrowserWindow, getMainWindow })
  registerAppearanceIpc({
    ipcMain,
    BrowserWindow,
    dialog,
    getMainWindow,
    appearanceService,
    copyFile,
    mkdir,
    basename,
    extname,
    writeDiagnostic,
  })
  ipcMain.handle('theia:update-settings', async (_event, next) => applyTheiaSettings(next))
}
