import test from 'node:test'
import assert from 'node:assert/strict'
import {
  registerAdvisorReadIpc,
  registerAppearanceIpc,
  registerCourseSelectionIpc,
  registerCourseWorkQueueIpc,
  registerMailboxIpc,
  registerModelRuntimeIpc,
  registerUserDataIpc,
  registerWindowIpc,
} from '../electron/ipc-registration.mjs'

function recorder() {
  const calls = []
  return {
    calls,
    ipcMain: {
      handle(channel, handler) { calls.push({ type: 'handle', channel, handler }) },
      on(channel, listener) { calls.push({ type: 'on', channel, listener }) },
    },
  }
}

test('capability IPC registration keeps the expected channel groups', () => {
  const advisor = recorder()
  registerAdvisorReadIpc({
    ipcMain: advisor.ipcMain,
    store: {},
    advisorRuntime: {},
    advisorOverviewFromStore: () => null,
    advisorAcademicWhatIfFromStore: () => null,
    advisorCourseDecisionsFromStore: () => null,
  })
  assert.deepEqual(advisor.calls.map((call) => call.channel), [
    'theia:advisor:get-overview',
    'theia:advisor:list-threads',
    'theia:advisor:create-thread',
    'theia:advisor:prepare',
    'theia:advisor:send',
    'theia:advisor:cancel',
    'theia:advisor:delete-thread',
    'theia:advisor:academic-what-if',
    'theia:advisor:course-decisions',
  ])

  const windows = recorder()
  registerWindowIpc({ ipcMain: windows.ipcMain, BrowserWindow: { fromWebContents: () => null }, getMainWindow: () => null })
  assert.deepEqual(windows.calls.map((call) => call.channel), [
    'theia:window-minimize',
    'theia:window-maximize',
    'theia:window-close',
    'theia:window-is-maximized',
    'theia:zoom:get',
    'theia:zoom:set-percent',
    'theia:appearance:mode',
  ])

  const model = recorder()
  registerModelRuntimeIpc({
    ipcMain: model.ipcMain,
    modelService: {},
    modelVault: {},
    store: { snapshot: () => ({ settings: {} }) },
    getLocalApi: () => ({ baseUrl: 'http://127.0.0.1:1', port: 1 }),
    calendarAssetUrl: (name) => `theia-calendar://${name}`,
    academicPlanAssetBaseUrl: () => 'theia-calendar://local/academic-plan/',
    sendSnapshot: () => {},
  })
  assert.deepEqual(model.calls.map((call) => call.channel), [
    'theia:get-model-status',
    'theia:clear-model-api-key',
    'theia:cancel-model-requests',
    'theia:get-api-status',
    'theia:validate-model-connection',
    'theia:process-course-work-with-model',
  ])

  const appearance = recorder()
  registerAppearanceIpc({
    ipcMain: appearance.ipcMain,
    BrowserWindow: { fromWebContents: () => null },
    dialog: {},
    getMainWindow: () => null,
    appearanceService: {},
    copyFile: async () => {},
    mkdir: async () => {},
    basename: (value) => value,
    extname: () => '.png',
  })
  assert.deepEqual(appearance.calls.map((call) => call.channel), [
    'theia:select-app-background',
    'theia:appearance-presets:get',
    'theia:appearance-presets:save',
  ])

  const mailbox = recorder()
  registerMailboxIpc({
    ipcMain: mailbox.ipcMain,
    mailVault: {},
    mailService: {},
    store: {},
    dialog: {},
    getDownloadsDirectory: () => 'C:/Downloads',
    writeFile: async () => {},
    resolvePath: (...parts) => parts.join('/'),
    basename: (value) => value,
    sendSnapshot: () => {},
  })
  assert.deepEqual(mailbox.calls.map((call) => call.channel), [
    'theia:save-mail-credentials',
    'theia:clear-mail-credentials',
    'theia:refresh-mailbox',
    'theia:open-mailbox',
    'theia:read-mailbox-message',
    'theia:download-mailbox-attachment',
  ])

  const selection = recorder()
  registerCourseSelectionIpc({
    ipcMain: selection.ipcMain,
    courseSelectionService: {},
    courseSelectionJournal: {},
    store: {},
    cachedSchoolScheduleResult: () => null,
    schoolScheduleWithProvenance: async () => null,
    scanSchoolScheduleArchive: async () => [],
    armCourseSelectionSentinel: async () => {},
    sendCourseSelectionSnapshot: () => {},
    courseSelectionSnapshot: () => null,
  })
  assert.deepEqual(selection.calls.map((call) => call.channel), [
    'theia:get-course-selection',
    'theia:discover-course-selection',
    'theia:get-course-selection-candidates',
    'theia:search-school-schedule',
    'theia:sync-school-schedule-archive',
    'theia:get-cached-school-schedule',
    'theia:save-course-selection-target',
    'theia:remove-course-selection-target',
    'theia:set-course-selection-sentinel',
    'theia:start-course-selection',
    'theia:stop-course-selection',
  ])

  const coursework = recorder()
  registerCourseWorkQueueIpc({ ipcMain: coursework.ipcMain, queue: {
    snapshot: () => ({ jobs: [] }),
    setEnabled: async () => ({ jobs: [] }),
    enqueue: async () => ({ job: null }),
    cancel: async () => ({ jobs: [] }),
  } })
  assert.deepEqual(coursework.calls.map((call) => call.channel), [
    'theia:get-course-work-queue',
    'theia:set-course-work-queue-enabled',
    'theia:enqueue-course-work',
    'theia:cancel-course-work-job',
  ])
})

test('user data IPC exposes only bounded projection reads', async () => {
  const recorderState = recorder()
  const state = {
    terms: [],
    academicExtras: { domains: {} },
    sync: { domains: {} },
    snapshotWithRevision: () => ({ state: { terms: [], academicExtras: { domains: {} }, sync: { domains: {} } }, revision: 'r1' }),
  }
  registerUserDataIpc({ ipcMain: recorderState.ipcMain, store: state })
  assert.deepEqual(recorderState.calls.map((call) => call.channel), [
    'theia:get-renderer-snapshot',
    'theia:get-user-data-overview',
    'theia:get-user-data-domain-summary',
    'theia:get-user-data-records',
  ])
  const overviewHandler = recorderState.calls[1].handler
  const pageHandler = recorderState.calls[3].handler
  assert.equal((await overviewHandler()).snapshotRevision, 'r1')
  assert.equal((await pageHandler({}, 'academic-extras', { limit: 1 })).snapshotRevision, 'r1')
})
