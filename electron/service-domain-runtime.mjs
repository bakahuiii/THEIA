import { Notification } from 'electron'
import { randomUUID } from 'node:crypto'
import { AcademicApiFirstAdapter } from '../core/academic-api-adapter.mjs'
import { AcademicApiClient } from '../core/academic-api-client.mjs'
import { JwglxtAdapter } from '../core/adapters/jwglxt.mjs'
import { TheolAdapter } from '../core/adapters/theol.mjs'
import { SyncService } from '../core/sync-service.mjs'
import { CourseWorkService } from '../core/course-work.mjs'
import { CourseSelectionService } from '../core/course-selection.mjs'
import { updateSchoolScheduleCatalog } from '../core/catalog-provenance.mjs'
import { ModelVault } from './model-vault.mjs'
import { ModelService } from './model-service.mjs'
import { recoverModelConfigTransaction } from './model-config-transaction.mjs'
import { AdvisorRuntime, ADVISOR_BUDGET_PRESETS } from './advisor-runtime.mjs'
import { AdvisorStore } from './advisor-store.mjs'
import { executeAdvisorNetworkRequest } from './advisor-network.mjs'
import { WebmailService } from '../core/webmail-service.mjs'
import { ImapMailService } from '../core/imap-mail-service.mjs'
import { createSyncOrchestrator } from './sync-orchestrator.mjs'
import { updateSettingsTransaction } from '../core/settings-transaction.mjs'

export async function initializeDomainServices({
  dataRoot,
  documentsRoot,
  safeStorage,
  store,
  sessionClient,
  academicSessionClient,
  credentialVault,
  academicApiVault,
  academicAttachmentStore,
  mailVault,
  courseSelectionJournal,
  academicCalendarRuntime,
  startupClock,
  logStartupStep,
  getMainWindow,
  setAdvisorRuntime = () => {},
  getAuthEpoch,
  getExplicitlyLoggedOut,
  authActors,
  authRecovery,
  verifiedSessions,
  openLoginWindow,
  openSourceWindow,
  getSchoolProxyReady,
  assertAuthEpoch,
  sendSnapshot,
  sendCourseSelectionSnapshot,
  courseSelectionSnapshot,
  restartLocalApi,
  createMailBrowserWindow,
  agentTools = {},
  writeDiagnostic,
  diagnosticError,
  networkRequest = executeAdvisorNetworkRequest,
  getAdvisorOutputDirectory = () => `${documentsRoot}\\THEIA Agent`,
} = {}) {
  let currentStartupClock = startupClock
  let advisorRuntime
  let mailService
  let webmailService
  let syncService
  let syncOrchestrator
  let courseSelectionService

  const courseWorkService = new CourseWorkService({ root: dataRoot, store, client: sessionClient })
  const modelVault = new ModelVault(dataRoot, safeStorage)
  try {
    const recovery = await recoverModelConfigTransaction({ store, vault: modelVault })
    if (recovery.recovered) void writeDiagnostic('model.configuration_recovered', {})
  } catch (error) {
    // Keep a mismatched configuration journal intact for later diagnosis.
    void writeDiagnostic('model.configuration_recovery_failed', { error: diagnosticError(error) })
  }
  const modelService = new ModelService({ vault: modelVault, courseWork: courseWorkService })
  const advisorThreadStore = new AdvisorStore({
    root: dataRoot,
    storage: safeStorage,
    onDiagnostic: writeDiagnostic,
  })
  const persistedAdvisorThreads = await advisorThreadStore.load()
  currentStartupClock = logStartupStep('advisor_threads_loaded', currentStartupClock)

  const rebuildAdvisorRuntime = async () => {
    const advisorBudgetLevel = store.state.settings.advisorConfig?.budgetLevel || 'high'
    const advisorBudget = ADVISOR_BUDGET_PRESETS[advisorBudgetLevel] || ADVISOR_BUDGET_PRESETS.high
    const currentThreads = Array.from(advisorRuntime?.threads.values() || [])
    advisorRuntime = new AdvisorRuntime({
      store,
      modelService,
      ensureDataReady: async () => {
        await academicCalendarRuntime?.refreshInFlight?.catch(() => undefined)
      },
      onDiagnostic: writeDiagnostic,
      threadStore: advisorThreadStore,
      initialThreads: currentThreads.length ? currentThreads : persistedAdvisorThreads,
      onStream: (event) => {
        const window = getMainWindow()
        if (window && !window.isDestroyed()) window.webContents.send('theia:advisor:stream', event)
      },
      budget: advisorBudget,
      agentOperations: {
        outputDirectory: getAdvisorOutputDirectory(),
        syncCampusData: (request) => syncOrchestrator.syncAdvisorCampusData(request),
        networkRequest,
        openCampusSource: async ({ url }) => {
          const epoch = getAuthEpoch()
          assertAuthEpoch(epoch)
          await getSchoolProxyReady().catch(() => undefined)
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
        ...agentTools,
      },
    })
    setAdvisorRuntime(advisorRuntime)
  }

  const applyTheiaSettings = async (next) => {
    const allowed = next && typeof next === 'object' ? next : {}
    const previousAdvisorBudgetLevel = store.snapshot().settings.advisorConfig?.budgetLevel
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
  currentStartupClock = logStartupStep('advisor_runtime_built', currentStartupClock)

  webmailService = new WebmailService({
    store,
    vault: mailVault,
    createWindow: createMailBrowserWindow,
    onChange: sendSnapshot,
    onDiagnostic: writeDiagnostic,
    // IMAP is authoritative for automated mail refreshes; the web window is manual.
    pollOnNavigation: false,
  })
  mailService = new ImapMailService({
    store,
    vault: mailVault,
    onChange: sendSnapshot,
    onDiagnostic: writeDiagnostic,
    openWebmail: () => webmailService.open(),
    onNewMail: (mail) => {
      const window = getMainWindow()
      if (window && !window.isDestroyed()) window.webContents.send('theia:new-mail', mail)
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
      onDiagnostic: writeDiagnostic,
      adapterFactory: (client) => new JwglxtAdapter(client, {
        academicProgressSource: 'api',
        attachmentStore: academicAttachmentStore,
        scheduleEndpoints: ['kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151', 'kbcx/xskbcx_cxXsgrkb.html'],
      }),
    }),
    theol: new TheolAdapter(sessionClient),
    onProgress: (progress) => {
      const window = getMainWindow()
      if (window && !window.isDestroyed()) window.webContents.send('theia:sync-progress', progress)
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
      const recoverySources = [...new Set(sources)].filter((source) => ['jwglxt', 'theol'].includes(source))
      for (const source of recoverySources) verifiedSessions[source] = null
      void writeDiagnostic('sync.auth_required', { sources: recoverySources })
      const explicitlyLoggedOut = getExplicitlyLoggedOut()
      if (explicitlyLoggedOut || !recoverySources.length) {
        void writeDiagnostic('sync.auth_recovery_stopped', {
          sources: recoverySources,
          reason: explicitlyLoggedOut ? 'explicit_logout' : 'no_supported_sources',
        })
        return
      }
      const epoch = getAuthEpoch()
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
        if (elapsed >= 0 && elapsed < 60_000) {
          void writeDiagnostic('sync.auth_recovery_deferred', { sources: [source], retryAfterMs: 60_000 - elapsed })
          return false
        }
        if (recovery.failures >= 3) {
          void writeDiagnostic('sync.auth_recovery_stopped', { sources: [source], attempts: recovery.failures })
          return false
        }
        recovery.inFlight = true
        recovery.lastAt = Date.now()
        recovery.failures += 1
        return true
      })
      if (!eligibleSources.length) return
      void (async () => {
        try {
          const status = await credentialVault.status()
          if (!status.saved || getExplicitlyLoggedOut() || epoch !== getAuthEpoch()) return
          await openLoginWindow({ background: true, sources: eligibleSources, expectedEpoch: epoch })
          await Promise.all(eligibleSources.map((source) => authActors.get(source)?.lifecycle || Promise.resolve()))
        } catch (error) {
          await writeDiagnostic('auth.recovery_failed', { sources: eligibleSources, error: diagnosticError(error) })
        } finally {
          for (const source of eligibleSources) authRecovery[source].inFlight = false
        }
      })()
    },
  })
  syncOrchestrator = createSyncOrchestrator({
    store,
    syncService,
    academicApiVault,
    academicAttachmentStore,
    verifiedSessions,
    isExplicitlyLoggedOut: getExplicitlyLoggedOut,
    writeDiagnostic,
    diagnosticError,
    sendSnapshot,
  })
  courseSelectionService = new CourseSelectionService({
    client: academicSessionClient,
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
      await syncOrchestrator.syncForegroundCampusData()
      syncOrchestrator.scheduleAcademicStaticPrefetch({ reason: 'course_selection' })
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
    onDiagnostic: writeDiagnostic,
  })
  syncService.configureAutoSync(store.state.settings.autoSync, store.state.settings.syncIntervalMinutes)
  mailService.configure(store.state.settings.mail)

  return {
    startupClock: currentStartupClock,
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
  }
}
