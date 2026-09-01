/**
 * Renderer IPC registration grouped by capability.
 *
 * The trusted IPC wrapper is created by the main process and passed in here.
 * Keeping registration separate makes the authority boundary explicit while
 * leaving service ownership and lifecycle state in `main.mjs`.
 */

import {
  projectUserDataDomainSummary,
  projectUserDataOverview,
  projectUserDataRecords,
  projectRendererSnapshot,
} from '../core/user-data-view.mjs'
import {
  THEIA_MCP_PROTOCOL_VERSION,
  THEIA_MCP_SCHEMA,
  THEIA_MCP_SERVER_NAME,
  THEIA_MCP_SERVER_VERSION,
  THEIA_MCP_TOOLS,
} from '../integration/theia-mcp.mjs'
import { THEIA_LOCAL_API_ENDPOINTS } from '../core/local-api-contract.mjs'
import { installTheiaMcpClients } from './mcp-client-setup.mjs'

export function registerMcpIntegrationIpc({ ipcMain, root, homeDirectory, writeDiagnostic = () => {} }) {
  ipcMain.handle('theia:install-mcp-clients', async () => {
    const result = await installTheiaMcpClients({
      homeDirectory,
      pluginPath: resolve(root, '..', 'theia-buct-advisor', 'scripts', 'lite-mcp.mjs'),
    })
    void writeDiagnostic('mcp.client_setup_finished', {
      pluginAvailable: result.pluginAvailable,
      clients: result.clients.map((client) => ({ client: client.client, status: client.status, changed: client.changed })),
    })
    return result
  })
}

export function registerUserDataIpc({ ipcMain, store }) {
  const committed = () => store.snapshotWithRevision
    ? store.snapshotWithRevision({ clone: false })
    : { state: store.snapshot(), revision: null }
  ipcMain.handle('theia:get-renderer-snapshot', () => projectRendererSnapshot(committed().state))
  ipcMain.handle('theia:get-user-data-overview', () => {
    const versioned = committed()
    return projectUserDataOverview(versioned.state, { snapshotRevision: versioned.revision || null })
  })
  ipcMain.handle('theia:get-user-data-domain-summary', (_event, domain) => {
    const versioned = committed()
    const summary = projectUserDataDomainSummary(versioned.state, domain)
    return summary ? { ...summary, snapshotRevision: versioned.revision || null } : null
  })
  ipcMain.handle('theia:get-user-data-records', (_event, domain, options) => {
    const versioned = committed()
    const records = projectUserDataRecords(versioned.state, domain, options || {})
    if (!records) throw new Error('资料域不存在')
    return { ...records, snapshotRevision: versioned.revision || null }
  })
}

export function registerAdvisorReadIpc({
  ipcMain,
  store,
  advisorRuntime,
  advisorOverviewFromStore,
  getUpgradeRule = () => null,
  advisorAcademicWhatIfFromStore,
  advisorCourseDecisionsFromStore,
}) {
  ipcMain.handle('theia:advisor:get-overview', () => advisorOverviewFromStore(store, { upgradeRule: getUpgradeRule() }))
  ipcMain.handle('theia:advisor:list-threads', () => advisorRuntime.listThreads())
  ipcMain.handle('theia:advisor:create-thread', () => advisorRuntime.createThread())
  ipcMain.handle('theia:advisor:prepare', (_event, request) => advisorRuntime.prepare(request))
  ipcMain.handle('theia:advisor:send', (_event, request) => advisorRuntime.send(request))
  ipcMain.handle('theia:advisor:cancel', (_event, request) => advisorRuntime.cancel(request))
  ipcMain.handle('theia:advisor:delete-thread', (_event, threadId) => advisorRuntime.deleteThread(threadId))
  ipcMain.handle('theia:advisor:academic-what-if', (_event, scenario) => advisorAcademicWhatIfFromStore(store, scenario))
  ipcMain.handle('theia:advisor:course-decisions', (_event, request) => advisorCourseDecisionsFromStore(store, request))
}

export function registerWindowIpc({ ipcMain, BrowserWindow, getMainWindow }) {
  ipcMain.handle('theia:window-minimize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender) || getMainWindow()
    window?.minimize()
  })
  ipcMain.handle('theia:window-maximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender) || getMainWindow()
    if (window?.isMaximized()) window.unmaximize()
    else window?.maximize()
  })
  ipcMain.handle('theia:window-close', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender) || getMainWindow()
    window?.close()
  })
  ipcMain.handle('theia:window-is-maximized', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender) || getMainWindow()
    return window?.isMaximized() ?? false
  })

  ipcMain.handle('theia:zoom:get', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const level = window && !window.isDestroyed() ? window.webContents.getZoomLevel() : 0
    return { level, percent: Math.round(Math.pow(1.2, level) * 100) }
  })
  ipcMain.on('theia:zoom:set-percent', (event, percent) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window || window.isDestroyed()) return
    const level = Math.log(Number(percent) / 100) / Math.log(1.2)
    window.webContents.setZoomLevel(Math.max(-3, Math.min(3, level)))
  })
  ipcMain.on('theia:appearance:mode', (_event, mode) => {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) window.webContents.send('theia:appearance:mode', mode)
  })
}

export function registerModelRuntimeIpc({
  ipcMain,
  modelService,
  modelVault,
  store,
  getLocalApi,
  calendarAssetUrl,
  academicPlanAssetBaseUrl,
  sendSnapshot,
}) {
  ipcMain.handle('theia:get-model-status', () => modelService.status(store.snapshot().settings))
  ipcMain.handle('theia:clear-model-api-key', async () => modelVault.clear())
  ipcMain.handle('theia:cancel-model-requests', () => ({ cancelled: modelService.cancelAll() }))
  ipcMain.handle('theia:get-api-status', () => {
    const localApi = getLocalApi()
    return {
      baseUrl: localApi.baseUrl,
      port: localApi.port,
      host: '127.0.0.1',
      apiEndpoints: THEIA_LOCAL_API_ENDPOINTS,
      mcp: {
        name: THEIA_MCP_SERVER_NAME,
        version: THEIA_MCP_SERVER_VERSION,
        protocolVersion: THEIA_MCP_PROTOCOL_VERSION,
        schema: THEIA_MCP_SCHEMA,
        tools: THEIA_MCP_TOOLS.map(({ name, title, description, annotations }) => ({
          name,
          title,
          description,
          readOnly: annotations?.readOnlyHint === true,
        })),
      },
      academicCalendarAssets: {
        calendar: calendarAssetUrl('calendar'),
        teachingSchedule: calendarAssetUrl('teachingSchedule'),
        weeklyCalendar: calendarAssetUrl('weeklyCalendar'),
      },
      academicPlanAssetBaseUrl: academicPlanAssetBaseUrl(),
    }
  })
  ipcMain.handle('theia:validate-model-connection', () => modelService.validate(store.snapshot().settings))
  ipcMain.handle('theia:process-course-work-with-model', async (_event, assignmentId) => {
    const result = await modelService.process(assignmentId, store.snapshot().settings)
    sendSnapshot()
    return result.snapshot
  })
}

export function registerGithubUpdateIpc({ ipcMain, updateRuntime }) {
  ipcMain.handle('theia:get-update-status', () => updateRuntime.getStatus())
  ipcMain.handle('theia:check-for-updates', async () => updateRuntime.checkForUpdates())
  ipcMain.handle('theia:install-update', async () => updateRuntime.installUpdate())
}

export function registerAppearanceIpc({
  ipcMain,
  BrowserWindow,
  dialog,
  getMainWindow,
  appearanceService,
  copyFile,
  mkdir,
  basename,
  extname,
  writeDiagnostic = () => {},
}) {
  ipcMain.handle('theia:select-app-background', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender) || getMainWindow()
    const selected = await dialog.showOpenDialog(owner, {
      title: '选择 THEIA 客户端背景图片',
      properties: ['openFile'],
      filters: [
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    const filePath = selected.filePaths[0]
    if (selected.canceled || !filePath) return { canceled: true }
    const extension = extname(filePath).toLowerCase()
    if (!['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'].includes(extension)) {
      throw new Error('请选择 PNG、JPG、WebP、GIF 或 AVIF 图片')
    }
    await mkdir(appearanceService.backgroundDirectory, { recursive: true })
    const filename = `background-${Date.now()}${extension}`
    await copyFile(filePath, appearanceService.backgroundPath(filename))
    return {
      canceled: false,
      url: appearanceService.backgroundAssetUrl(filename),
      name: basename(filePath),
    }
  })
  ipcMain.handle('theia:appearance-presets:get', () => appearanceService.readPresets())
  ipcMain.handle('theia:appearance-presets:save', async (_event, presets) => {
    const record = await appearanceService.writePresets(presets)
    void writeDiagnostic('appearance.presets_saved', { count: record.presets.length })
    return { updatedAt: record.updatedAt, presets: record.presets }
  })
}

export function registerMailboxIpc({
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
  writeDiagnostic = () => {},
}) {
  ipcMain.handle('theia:save-mail-credentials', async (_event, credentials) => {
    const status = await mailVault.save(credentials || {})
    if (store.snapshot().settings.mail.enabled) await mailService.poll({ notify: false })
    return status
  })
  ipcMain.handle('theia:clear-mail-credentials', () => mailVault.clear())
  ipcMain.handle('theia:refresh-mailbox', async () => {
    await mailService.poll({ notify: false, force: true })
    sendSnapshot()
    return store.snapshot()
  })
  ipcMain.handle('theia:open-mailbox', () => mailService.open())
  ipcMain.handle('theia:read-mailbox-message', (_event, id, options) => mailService.readMessage(String(id || ''), options || {}))
  ipcMain.handle('theia:download-mailbox-attachment', async (_event, id, index) => {
    const attachment = await mailService.downloadAttachment(String(id || ''), Number(index))
    const filename = basename(String(attachment.filename || '附件'))
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/^\.+$/, '') || '附件'
    const chosen = await dialog.showSaveDialog({
      defaultPath: resolvePath(getDownloadsDirectory(), filename),
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    })
    if (chosen.canceled || !chosen.filePath) return { canceled: true }
    await writeFile(chosen.filePath, attachment.content)
    void writeDiagnostic('mail.imap_attachment_saved', { bytes: attachment.content.length })
    return { canceled: false, filePath: chosen.filePath, filename }
  })
}

export function registerCourseSelectionIpc({
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
  recoverCourseSelectionReadSession = null,
  writeDiagnostic = () => {},
}) {
  const readWithSessionRecovery = async (operation, action) => {
    try {
      return await operation()
    } catch (error) {
      const authRequired = error?.name === 'AuthRequiredError' || Number(error?.code) === 1006
      if (!authRequired || typeof recoverCourseSelectionReadSession !== 'function') throw error
      void writeDiagnostic('course_selection.read_auth_recovery_started', { action })
      await recoverCourseSelectionReadSession()
      try {
        const result = await operation()
        void writeDiagnostic('course_selection.read_auth_recovery_succeeded', { action })
        return result
      } catch (retryError) {
        void writeDiagnostic('course_selection.read_auth_recovery_retry_failed', {
          action,
          error: retryError?.name || 'Error',
        })
        throw retryError
      }
    }
  }
  ipcMain.handle('theia:get-course-selection', () => courseSelectionSnapshot())
  ipcMain.handle('theia:discover-course-selection', async () => {
    const portal = await readWithSessionRecovery(
      () => courseSelectionService.discover(),
      'discover',
    )
    return { ...portal, context: undefined }
  })
  ipcMain.handle('theia:get-course-selection-candidates', async (_event, blockId, target, options) => (
    readWithSessionRecovery(
      () => courseSelectionService.candidates(String(blockId || ''), target || null, options || {}),
      'candidates',
    )
  ))
  ipcMain.handle('theia:search-school-schedule', async (_event, query) => schoolScheduleWithProvenance(query || {}))
  ipcMain.handle('theia:sync-school-schedule-archive', () => scanSchoolScheduleArchive())
  ipcMain.handle('theia:get-cached-school-schedule', async (_event, scope) => (
    cachedSchoolScheduleResult(store.snapshot().dataCatalog, scope || null)
  ))
  ipcMain.handle('theia:save-course-selection-target', async (_event, target) => {
    const record = await courseSelectionJournal.addTarget(target || {})
    void writeDiagnostic('course_selection.target_saved', { targetCount: record.targets.length })
    if (record.sentinel?.enabled) await armCourseSelectionSentinel()
    sendCourseSelectionSnapshot()
    return courseSelectionSnapshot()
  })
  ipcMain.handle('theia:remove-course-selection-target', async (_event, id) => {
    const record = await courseSelectionJournal.removeTarget(String(id || ''))
    void writeDiagnostic('course_selection.target_removed', { targetCount: record.targets.length })
    sendCourseSelectionSnapshot()
    return courseSelectionSnapshot()
  })
  ipcMain.handle('theia:set-course-selection-sentinel', async (_event, config) => {
    const record = await courseSelectionJournal.setSentinel(config || { enabled: false })
    if (record.sentinel.enabled) await armCourseSelectionSentinel()
    else courseSelectionService.stop()
    void writeDiagnostic('course_selection.sentinel_changed', {
      enabled: record.sentinel.enabled,
      startAt: record.sentinel.startAt,
      endAt: record.sentinel.endAt,
      concurrency: record.sentinel.concurrency,
    })
    sendCourseSelectionSnapshot()
    return courseSelectionSnapshot()
  })
  ipcMain.handle('theia:start-course-selection', async (_event, options) => {
    courseSelectionService.start(options || {})
    const candidate = options?.candidate
    if (candidate) await courseSelectionJournal.addTarget({
      ...candidate,
      classId: candidate.classId || null,
      className: candidate.className || null,
      chosenAt: new Date().toISOString(),
    })
    void writeDiagnostic('course_selection.job_started', {
      targetCount: Array.isArray(options?.targets) ? options.targets.length : Number(Boolean(candidate)),
    })
    sendCourseSelectionSnapshot()
    return courseSelectionSnapshot()
  })
  ipcMain.handle('theia:stop-course-selection', () => {
    courseSelectionService.stop()
    return courseSelectionSnapshot()
  })
}

export function registerMotionVenueIpc({
  ipcMain,
  adapter,
  store,
  cachedMotionVenueCatalog,
  cacheMotionVenueCatalog,
  cacheMotionVenueStatus,
  sendSnapshot,
  writeDiagnostic = () => {},
}) {
  ipcMain.handle('theia:get-motion-venue-catalog', () => cachedMotionVenueCatalog(store.snapshot().dataCatalog))
  ipcMain.handle('theia:refresh-motion-venue-catalog', async () => {
    const result = await adapter.discover()
    const errors = Array.isArray(result?.errors) ? result.errors : []
    const successfulPages = Number(result?.counts?.successfulPages) || 0
    const venueCount = Array.isArray(result?.venues)
      ? result.venues.length
      : Number(result?.counts?.venues) || 0
    if (errors.length > 0 && successfulPages === 0 && venueCount === 0) {
      const detail = String(errors[0]?.message || '公开入口不可用').slice(0, 240)
      void writeDiagnostic('motion.venue_catalog_refresh_failed', {
        pages: Number(result?.counts?.pages) || 0,
        errors: errors.length,
        detail,
      })
      throw new Error(`MOTION 场馆目录刷新失败：${detail}`)
    }
    await store.update((state) => ({
      ...state,
      dataCatalog: cacheMotionVenueCatalog(state.dataCatalog, result, result.capturedAt),
    }))
    sendSnapshot()
    void writeDiagnostic('motion.venue_catalog_refreshed', {
      pages: result.counts?.pages || 0,
      venues: result.counts?.venues || 0,
      errors: result.errors?.length || 0,
    })
    return cachedMotionVenueCatalog(store.snapshot().dataCatalog)
  })
  ipcMain.handle('theia:query-motion-venue-status', async (_event, query) => {
    const result = await adapter.queryStatus(query || {})
    await store.update((state) => ({
      ...state,
      dataCatalog: cacheMotionVenueStatus(state.dataCatalog, result, result.capturedAt),
    }))
    sendSnapshot()
    void writeDiagnostic('motion.venue_status_queried', {
      date: result.query?.date || null,
      venue: result.query?.venue || null,
      requestedPageCount: result.safety?.requestedPageCount || 0,
      totalMs: result.timing?.totalMs || null,
    })
    return result
  })
}

export function registerCourseWorkQueueIpc({ ipcMain, queue }) {
  ipcMain.handle('theia:get-course-work-queue', () => queue.snapshot())
  ipcMain.handle('theia:set-course-work-queue-enabled', (_event, enabled) => queue.setEnabled(Boolean(enabled)))
  ipcMain.handle('theia:enqueue-course-work', (_event, request) => {
    const input = request && typeof request === 'object' ? request : {}
    return queue.enqueue({
      assignmentId: input.assignmentId,
      operation: input.operation,
      options: input.options,
      dedupeKey: input.dedupeKey,
      maxAttempts: input.maxAttempts,
    })
  })
  ipcMain.handle('theia:cancel-course-work-job', (_event, jobId) => queue.cancel(jobId))
}
