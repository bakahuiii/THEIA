import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { registerAuthIpc } from '../electron/auth-ipc.mjs'
import { registerCourseWorkWorkflowIpc } from '../electron/course-work-ipc.mjs'
import { registerDataExportIpc } from '../electron/data-export-ipc.mjs'
import { registerIrisIpc } from '../electron/iris-ipc.mjs'
import { registerModelConfigIpc } from '../electron/model-config-ipc.mjs'
import { TheolCourseArchiveStore } from '../core/theol-course-archive-store.mjs'

function fakeIpc() {
  const handlers = new Map()
  return {
    handlers,
    handle(channel, callback) {
      assert.equal(handlers.has(channel), false, `duplicate IPC handler: ${channel}`)
      handlers.set(channel, callback)
    },
  }
}

function registerCourseWorkForTest(overrides = {}) {
  const ipcMain = fakeIpc()
  const modelService = overrides.modelService || { summarizeNotices: async () => ({ ok: true }) }
  registerCourseWorkWorkflowIpc({
    ipcMain,
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    shell: overrides.shell || { openPath: async () => '' },
    getMainWindow: () => null,
    courseWorkService: {
      validatedWorkspace: () => ({ directory: 'C:\\course-work', title: 'Test' }),
      assignmentEntry: () => ({ assignment: { kind: 'online-test' } }),
      ...overrides.courseWorkService,
    },
    sessionClient: null,
    syncService: { runTheolInteraction: (operation) => operation(), retryCourseResources: async () => ({}) },
    store: overrides.store || {
      snapshot: () => ({ settings: { dataRoot: 'wrong-config-field' }, assignments: [], notices: [], courses: [] }),
      update: async (update) => update({ workspaces: [] }),
    },
    theolAttachmentStore: null,
    theolCourseArchiveStore: overrides.theolCourseArchiveStore || { validateLocalFile: async (path) => path },
    theolAttachmentMaxBytes: 32 * 1024 * 1024,
    modelService,
    renderMarkdownToPdf: async () => Buffer.from('%PDF-'),
    getAuthEpoch: () => 1,
    assertAuthEpoch: () => {},
    waitForSchoolProxy: async () => {},
    locateCourseResource: () => { throw new Error('not used') },
    openSchedulePdf: async () => true,
    openCourseWorkWindow: async () => ({}),
    attachFileToSourceWindow: async () => ({ attached: true }),
    fillTestInSourceWindow: async () => ({}),
    getDataRoot: () => 'expected-user-data-root',
    sendSnapshot: () => {},
  })
  return { ipcMain, modelService }
}

test('course-work IPC keeps its handlers in one duplicate-checked feature module', async () => {
  let request
  const { ipcMain } = registerCourseWorkForTest({
    modelService: {
      summarizeNotices: async (...args) => {
        request = args
        return { ok: true }
      },
    },
  })
  const expectedChannels = [
    'theia:open-schedule-pdf',
    'theia:prepare-course-work',
    'theia:open-course-work',
    'theia:open-assignment-source',
    'theia:open-course-material',
    'theia:refresh-course-resources',
    'theia:download-course-resource',
    'theia:import-course-work-file',
    'theia:open-submission',
    'theia:apply-test-answers',
    'theia:summarize-notices',
    'theia:generate-notes',
    'theia:generate-paper',
    'theia:render-answer-pdf',
    'theia:open-answer-pdf',
    'theia:render-md-file',
  ]
  assert.deepEqual([...ipcMain.handlers.keys()], expectedChannels)

  await ipcMain.handlers.get('theia:summarize-notices')()
  assert.equal(request[1].dataRoot, 'expected-user-data-root')
  assert.notEqual(request[1].dataRoot, 'wrong-config-field')
})

test('course material and assignment IPC open only validated local archive files', async () => {
  const root = await mkdtemp(join(process.env.TEMP || process.cwd(), 'theia-theol-local-open-'))
  try {
    const archive = new TheolCourseArchiveStore(root)
    const material = await archive.savePage({ kind: 'course', parentId: '101', id: 'material-1', title: '课程介绍', html: '<h1>介绍</h1>' })
    const assignment = await archive.savePage({ kind: 'assignment', parentId: 'assignment-1', id: 'assignment-1', title: '作业', html: '<h1>作业</h1>' })
    const opened = []
    const { ipcMain } = registerCourseWorkForTest({
      shell: { openPath: async (path) => { opened.push(path); return '' } },
      store: { snapshot: () => ({ courses: [{ id: '101', source: 'theol', teachingMaterials: [{ id: 'material-1', title: '课程介绍', localPath: material.localPath }] }], assignments: [{ id: 'assignment-1', source: 'theol', title: '作业', localPath: assignment.localPath }] }) },
      theolCourseArchiveStore: archive,
    })
    await ipcMain.handlers.get('theia:open-course-material')(null, '101', 'material-1')
    await ipcMain.handlers.get('theia:open-assignment-source')(null, 'assignment-1')
    assert.deepEqual(opened, [material.localPath, assignment.localPath])

    const outside = join(root, 'outside.html')
    const tampered = registerCourseWorkForTest({
      store: { snapshot: () => ({ courses: [{ id: '101', source: 'theol', teachingMaterials: [{ id: 'material-1', title: '越界', localPath: outside }] }], assignments: [] }) },
      theolCourseArchiveStore: archive,
    })
    await assert.rejects(
      tampered.ipcMain.handlers.get('theia:open-course-material')(null, '101', 'material-1'),
      /路径无效|路径越界/u,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('data export IPC writes local JSON and opens bounded local directories', async () => {
  const root = await mkdtemp(join(process.env.TEMP || process.cwd(), 'theia-ipc-module-'))
  try {
    const outputPath = join(root, 'export.json')
    const opened = []
    const ipcMain = fakeIpc()
    registerDataExportIpc({
      ipcMain,
      dialog: {
        showSaveDialog: async () => ({ canceled: false, filePath: outputPath }),
        showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      },
      shell: { openPath: async (path) => { opened.push(path); return '' } },
      getMainWindow: () => null,
      getDocumentsDirectory: () => root,
      getDataRoot: () => join(root, 'data'),
      store: { snapshot: () => ({ schema: 'test', courses: [] }) },
      getVersion: () => '0.6.1',
    })

    const exported = await ipcMain.handlers.get('theia:export-data')(null, { format: 'json' })
    assert.equal(exported.canceled, false)
    assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), { schema: 'test', courses: [] })
    const openedResult = await ipcMain.handlers.get('theia:open-data-directory')()
    assert.equal(openedResult.path, join(root, 'data'))
    const scheduleDirectory = await ipcMain.handlers.get('theia:open-schedule-directory')()
    assert.equal(scheduleDirectory.path, join(root, 'THEIA', '课表'))
    await access(scheduleDirectory.path)
    assert.deepEqual(opened, [join(root, 'data'), scheduleDirectory.path])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('auth IPC keeps login recovery and credential access behind injected services', async () => {
  const ipcMain = fakeIpc()
  const recovery = { jwglxt: { failures: 2, lastAt: 10, inFlight: true } }
  const calls = []
  const credentialVault = {
    status: () => ({ saved: true }),
    readCredentials: async () => ({ password: 'unified-secret' }),
    save: async (value) => ({ saved: value }),
    clear: async () => ({ cleared: true }),
  }
  const academicApiVault = {
    status: async () => ({ saved: false }),
    readCredentials: async () => ({ password: 'academic-secret' }),
    save: async () => ({ saved: true }),
    clear: async () => ({ cleared: true }),
  }
  const mailVault = {
    status: () => ({ saved: true }),
    readCredentials: async () => ({ password: 'mail-secret', protocolPassword: 'protocol-secret' }),
  }
  let releaseLoginLifecycle
  const loginLifecycle = new Promise((resolve) => {
    releaseLoginLifecycle = resolve
  })
  registerAuthIpc({
    ipcMain,
    store: { snapshot: () => ({ settings: { academicApiEnabled: true } }) },
    credentialVault,
    academicApiVault,
    mailVault,
    clearCredentialAttempts: () => calls.push('clear-attempts'),
    authRecovery: recovery,
    getAuthEpoch: () => 7,
    assertAuthEpoch: (epoch, options) => calls.push(['assert', epoch, options]),
    waitForSchoolProxy: async () => calls.push('proxy-ready'),
    getStatus: () => ({ jwglxt: { connected: true } }),
    openLoginWindow: async (options) => { calls.push(['login', options]); return [{ opened: true, authenticated: true, lifecycle: loginLifecycle }] },
  })

  assert.equal((await ipcMain.handlers.get('theia:read-saved-secret')(null, 'mail-protocol-password')), 'protocol-secret')
  assert.deepEqual(await ipcMain.handlers.get('theia:get-academic-api-credential-status')(), { saved: false, enabled: true })
  await ipcMain.handlers.get('theia:clear-credentials')()
  const login = ipcMain.handlers.get('theia:login')()
  let resolved = false
  login.then(() => {
    resolved = true
  })
  await Promise.resolve()
  assert.equal(resolved, false)
  releaseLoginLifecycle()
  assert.equal(await login, undefined)
  assert.equal(resolved, true)
  assert.deepEqual(recovery.jwglxt, { failures: 0, lastAt: 0, inFlight: false })
  assert.deepEqual(calls, [
    'clear-attempts',
    'proxy-ready',
    ['assert', 7, { allowLoggedOut: true }],
    ['login', { expectedEpoch: 7, userInitiated: true }],
  ])
})

test('Iris IPC delegates state changes without owning companion lifecycle state', async () => {
  const ipcMain = fakeIpc()
  const calls = []
  const companion = {
    status: () => ({ running: false }),
    writeSettings: async () => ({ enabled: false }),
    start: async (...args) => calls.push(['start', ...args]),
    stop: async (...args) => calls.push(['stop', ...args]),
    saveCredentials: async (value) => ({ saved: value }),
    clearCredentials: async () => ({ cleared: true }),
    restart: async () => calls.push(['restart']),
  }
  registerIrisIpc({
    ipcMain,
    irisCompanion: companion,
    recentActivityLog: () => [{ event: 'test' }],
    openIrisControlPanel: async () => ({ opened: true }),
  })
  assert.deepEqual(await ipcMain.handlers.get('theia:get-activity-log')(), [{ event: 'test' }])
  await ipcMain.handlers.get('theia:save-iris-settings')(null, {})
  await ipcMain.handlers.get('theia:restart-iris')()
  assert.deepEqual(calls, [['stop', { disable: true }], ['restart']])
})

test('model configuration IPC keeps discovery bound to the normalized provider contract', async () => {
  const ipcMain = fakeIpc()
  let request
  let ticket
  registerModelConfigIpc({
    ipcMain,
    modelService: {
      discover: async (value) => {
        request = value
        return { models: ['model-a'], selectedModel: 'model-a' }
      },
      status: () => ({ configured: true }),
    },
    modelVault: {},
    modelProbeTickets: {
      issue: (value) => { ticket = value; return 'probe-1' },
      consume: () => [],
    },
    store: { snapshot: () => ({ settings: { advisorConfig: {} } }) },
    sendSnapshot: () => {},
  })
  const result = await ipcMain.handlers.get('theia:discover-models')(null, {
    baseUrl: 'https://model.example/v1/',
    apiKey: 'secret',
    provider: 'openai-compatible',
  })
  assert.deepEqual(request, { baseUrl: 'https://model.example/v1', apiKey: 'secret' })
  assert.equal(result.probeId, 'probe-1')
  assert.deepEqual(ticket, {
    baseUrl: 'https://model.example/v1',
    apiKey: 'secret',
    provider: 'openai-compatible',
    models: ['model-a'],
    succeeded: true,
  })
  assert.deepEqual([...ipcMain.handlers.keys()], ['theia:discover-models', 'theia:save-model-config'])
})
