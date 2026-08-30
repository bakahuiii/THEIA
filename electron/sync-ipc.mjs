import { SYNC_DOMAIN_TARGETS } from './sync-orchestrator.mjs'

export function registerSyncIpc({
  ipcMain,
  syncOrchestrator,
  syncService,
  mailService,
  academicCalendarRuntime,
  fitnessRuntime,
  scanSchoolScheduleArchive,
  store,
  sendSnapshot = () => {},
  waitForSchoolProxy = async () => {},
  getAuthEpoch = () => 0,
  assertAuthEpoch,
} = {}) {
  ipcMain.handle('theia:sync-now', async () => {
    await waitForSchoolProxy()
    const snapshot = await syncOrchestrator.syncForegroundCampusData()
    syncOrchestrator.scheduleAcademicStaticPrefetch({ reason: 'manual_refresh' })
    return snapshot
  })

  ipcMain.handle('theia:sync-domain', async (_event, domainId) => {
    await waitForSchoolProxy()
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
      await academicCalendarRuntime.refreshAcademicCalendarAssets({ force: true, trigger: 'manual-domain-retry' })
      snapshot = store.snapshot()
    } else if (domainId === 'fitness') {
      const epoch = getAuthEpoch()
      assertAuthEpoch(epoch)
      await fitnessRuntime.importFitnessArchive(null, epoch)
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
    const epoch = getAuthEpoch()
    assertAuthEpoch(epoch)
    await waitForSchoolProxy()
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
}
