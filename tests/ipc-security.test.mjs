import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  MAX_IPC_ARGUMENT_BYTES,
  THEIA_IPC_SCHEMAS,
  assertTrustedMainFrame,
  createTrustedIpc,
  isExactTrustedEntryUrl,
  validateIpcArguments,
} from '../electron/ipc-security.mjs'

function trustedFixture(url = 'http://127.0.0.1:5174/') {
  const frame = { processId: 7, routingId: 11, url }
  const webContents = { id: 41, mainFrame: frame, getURL: () => url }
  const mainWindow = { webContents, isDestroyed: () => false }
  return { event: { sender: webContents, senderFrame: frame }, mainWindow, entryUrl: url }
}

test('IPC sender must be the active main window, exact main frame, and trusted app URL', () => {
  const fixture = trustedFixture()
  assert.equal(assertTrustedMainFrame(fixture.event, fixture), fixture.mainWindow)
  assert.equal(isExactTrustedEntryUrl('http://127.0.0.1:5174/', fixture.entryUrl), true)
  assert.equal(isExactTrustedEntryUrl('http://127.0.0.1:5174/?boot=1#app', fixture.entryUrl), true)
  assert.equal(isExactTrustedEntryUrl('http://localhost:5174/?boot=1', fixture.entryUrl), true)
  assert.equal(isExactTrustedEntryUrl('http://[::1]:5174/#app', fixture.entryUrl), true)
  assert.equal(isExactTrustedEntryUrl('http://127.0.0.1:5174/tools', fixture.entryUrl), true)
  assert.equal(isExactTrustedEntryUrl('http://127.0.0.1:5175/', fixture.entryUrl), true)
  assert.equal(isExactTrustedEntryUrl('http://localhost:4173/', fixture.entryUrl), true)
  assert.equal(isExactTrustedEntryUrl('http://[::1]:5174/index.html?boot=1', fixture.entryUrl), true)
  assert.equal(isExactTrustedEntryUrl('https://[::1]:8443/', fixture.entryUrl), false)
  assert.equal(isExactTrustedEntryUrl('http://192.168.1.10:5174/', fixture.entryUrl), false)

  assert.throws(() => assertTrustedMainFrame(
    { ...fixture.event, sender: { ...fixture.event.sender, id: 42 } },
    fixture,
  ), /active THEIA renderer/)
  assert.throws(() => assertTrustedMainFrame(
    { ...fixture.event, senderFrame: { processId: 7, routingId: 12, url: fixture.entryUrl } },
    fixture,
  ), /main frame/)
  assert.doesNotThrow(() => assertTrustedMainFrame(
    { ...fixture.event, senderFrame: { ...fixture.event.senderFrame, url: 'http://127.0.0.1:5174/tools' } },
    fixture,
  ))
})

test('packaged file renderer accepts query/hash changes but never changes the app file', () => {
  const entryUrl = 'file:///H:/work/THEIA/dist/index.html'
  assert.equal(isExactTrustedEntryUrl('file:///H:/work/THEIA/dist/index.html?boot=1#app', entryUrl), true)
  assert.equal(isExactTrustedEntryUrl('file:///h:/work/THEIA/dist/index.html#app', entryUrl), true)
  assert.equal(isExactTrustedEntryUrl('file://localhost/H:/work/THEIA/dist/', entryUrl), true)
  assert.equal(isExactTrustedEntryUrl('file:///H:/work/THEIA/dist/%69ndex.html', entryUrl), true)
  assert.equal(isExactTrustedEntryUrl('file:///H:/work/THEIA/dist/other.html', entryUrl), false)
  assert.equal(isExactTrustedEntryUrl('http://127.0.0.1:5174/', entryUrl), false)
})

test('packaged startup accepts a transient blank main-frame URL in compatibility mode', () => {
  const entryUrl = 'file:///H:/work/THEIA/dist/index.html'
  const frame = { processId: 7, routingId: 11, url: 'about:blank' }
  const webContents = { id: 41, mainFrame: frame, getURL: () => 'about:blank' }
  const fixture = { event: { sender: webContents, senderFrame: frame }, mainWindow: { webContents, isDestroyed: () => false }, entryUrl }
  if (process.env.THEIA_STRICT_IPC === '1') {
    assert.throws(() => assertTrustedMainFrame(fixture.event, fixture), /sender URL is not trusted/)
  } else {
    assert.doesNotThrow(() => assertTrustedMainFrame(fixture.event, fixture))
  }
})

test('trusted IPC rejects unregistered channels, invalid schemas, and oversized payloads before dispatch', async () => {
  const handlers = new Map()
  const denied = []
  const fixture = trustedFixture()
  const ipc = createTrustedIpc({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler),
      on: () => {},
    },
    getMainWindow: () => fixture.mainWindow,
    getEntryUrl: () => fixture.entryUrl,
    onDenied: (entry) => denied.push(entry),
  })
  assert.throws(() => ipc.handle('theia:unknown', () => true), /no registered input schema/)

  let called = false
  ipc.handle('theia:appearance-presets:save', () => { called = true })
  assert.throws(() => handlers.get('theia:appearance-presets:save')(
    fixture.event,
    Array.from({ length: 17 }, (_, index) => ({ id: String(index) })),
  ), /at most 16/)
  assert.equal(called, false)
  assert.equal(denied.at(-1).channel, 'theia:appearance-presets:save')

  assert.throws(() => validateIpcArguments('theia:save-model-config', [{
    baseUrl: 'https://model.example/v1',
    model: 'model-a',
    apiKey: 'key',
    probeId: 'probe',
    unexpected: true,
  }]), /unknown field unexpected/)
  assert.doesNotThrow(() => validateIpcArguments('theia:update-settings', [{
    advisorConfig: {
      budgetLevel: 'xhigh',
      permissionMode: 'full-access',
      reasoningEffort: 'high',
      temperature: 0.7,
    },
  }]))
  assert.throws(() => validateIpcArguments('theia:update-settings', [{
    advisorConfig: { budgetLevel: 'unsupported' },
  }]), /advisorConfig\.budgetLevel is invalid/)
  assert.throws(() => validateIpcArguments('theia:update-settings', [{
    advisorConfig: { permissionMode: 'unrestricted' },
  }]), /advisorConfig\.permissionMode is invalid/)
  assert.throws(() => validateIpcArguments('theia:update-settings', [{
    advisorConfig: { unexpected: true },
  }]), /unknown field unexpected/)
  assert.throws(() => validateIpcArguments('theia:open-source', ['x'.repeat(MAX_IPC_ARGUMENT_BYTES + 1)]), /too long|byte limit/)
  assert.doesNotThrow(() => validateIpcArguments('theia:open-assignment-source', ['assignment-123']))
  assert.throws(() => validateIpcArguments('theia:open-assignment-source', ['']), /non-empty string/)
  assert.doesNotThrow(() => validateIpcArguments('theia:get-course-work-queue', []))
  assert.doesNotThrow(() => validateIpcArguments('theia:get-user-data-overview', []))
  assert.doesNotThrow(() => validateIpcArguments('theia:get-user-data-domain-summary', ['academic-plan']))
  assert.doesNotThrow(() => validateIpcArguments('theia:get-user-data-records', ['academic-plan', {
    query: '培养', scope: 'all', limit: 50, cursor: '0', recordType: 'plan-row',
  }]))
  assert.throws(() => validateIpcArguments('theia:get-user-data-records', ['academic-plan', { limit: 101 }]), /outside the supported range/)
  assert.throws(() => validateIpcArguments('theia:get-user-data-records', ['academic-plan', { unexpected: true }]), /unknown field unexpected/)
  assert.doesNotThrow(() => validateIpcArguments('theia:set-course-work-queue-enabled', [true]))
  assert.throws(() => validateIpcArguments('theia:set-course-work-queue-enabled', ['true']), /boolean/)
  assert.doesNotThrow(() => validateIpcArguments('theia:enqueue-course-work', [{ assignmentId: 'assignment-1', operation: 'model', options: { wordCount: 800 } }]))
  assert.throws(() => validateIpcArguments('theia:enqueue-course-work', [{ assignmentId: 'assignment-1', operation: 'submit' }]), /operation is invalid/)
  assert.doesNotThrow(() => validateIpcArguments('theia:cancel-course-work-job', ['job-1']))
  assert.doesNotThrow(() => validateIpcArguments('theia:open-data-directory', []))
  assert.throws(() => validateIpcArguments('theia:open-data-directory', ['C:\\']), /expected 0 arguments/)
  assert.doesNotThrow(() => validateIpcArguments('theia:open-schedule-directory', []))
  assert.throws(() => validateIpcArguments('theia:open-schedule-directory', ['C:\\']), /expected 0 arguments/)
  assert.doesNotThrow(() => validateIpcArguments('theia:install-mcp-clients', []))
  assert.throws(() => validateIpcArguments('theia:install-mcp-clients', ['unexpected']), /expected 0 arguments/)
  assert.doesNotThrow(() => validateIpcArguments('theia:read-saved-secret', ['unified-password']))
  assert.throws(() => validateIpcArguments('theia:read-saved-secret', ['C:\\secrets.json']), /kind is invalid/)
  assert.throws(() => validateIpcArguments('theia:read-saved-secret', []), /expected 1 arguments/)
  assert.doesNotThrow(() => validateIpcArguments('theia:sync-domain', ['academic-progress']))
  assert.throws(() => validateIpcArguments('theia:sync-domain', ['https://example.com/']), /sync domain is invalid/)
  assert.throws(() => validateIpcArguments('theia:sync-domain', ['C:\\secrets.json']), /sync domain is invalid/)
  assert.doesNotThrow(() => validateIpcArguments('theia:query-free-classrooms', [{
    termId: '2026-3', date: '2026-09-01', weeks: [1], weekdays: [1, 3], periods: [1, 2], minSeats: 20, maxSeats: 80,
  }]))
  assert.throws(() => validateIpcArguments('theia:query-free-classrooms', [{
    termId: '2026-3', weeks: [], weekdays: [1], periods: [1],
  }]), /weeks must be a non-empty array/)
  assert.throws(() => validateIpcArguments('theia:query-free-classrooms', [{
    termId: '2026-3', weeks: [1], weekdays: [8], periods: [1],
  }]), /weekdays contains an invalid value/)
  assert.doesNotThrow(() => validateIpcArguments('theia:advisor:academic-what-if', [{
    snapshotRevision: 'revision-1',
    additionalRequiredCredits: 4,
    alternativeSelections: {
      'ar1:requirement:0123456789abcdef0123': 'ar1:requirement:abcdef0123456789abcd',
    },
  }]))
  assert.throws(() => validateIpcArguments('theia:advisor:academic-what-if', [{
    additionalRequiredCredits: 4,
  }]), /snapshotRevision/)
  assert.throws(() => validateIpcArguments('theia:advisor:academic-what-if', [{
    snapshotRevision: 'revision-1',
    alternativeSelections: { root: 'branch-a' },
  }]), /opaque requirement references/)
  assert.throws(() => validateIpcArguments('theia:advisor:academic-what-if', [{
    snapshotRevision: 'revision-1',
    additionalRequiredCredits: -1,
  }]), /outside the supported range/)
  assert.doesNotThrow(() => validateIpcArguments('theia:advisor:course-decisions', [{
    snapshotRevision: 'revision-1',
    candidates: [{
      id: 'candidate-1',
      title: '课程',
      credits: 2,
      sessions: [{ weekday: 1, day: '星期一', period: '1-2', periods: [1, 2], weeks: [1, '2-4周'] }],
      requirementNodeIds: ['node-1'],
      officialRequirementIds: ['official-1'],
      requirementCourseIds: ['course-1'],
    }],
    schoolScheduleComplete: false,
    completeness: { schedule: 'unknown' },
  }]))
  assert.throws(() => validateIpcArguments('theia:advisor:course-decisions', [{
    candidates: [],
  }]), /snapshotRevision/)
  assert.throws(() => validateIpcArguments('theia:advisor:course-decisions', [{
    snapshotRevision: 'revision-1',
    candidates: [{ id: 'candidate-1', title: '课程', sourceUrl: 'https://example.com' }],
  }]), /unknown field sourceUrl/)
  for (const dangerousField of ['sourceUrl', 'operationId', 'token']) {
    assert.throws(() => validateIpcArguments('theia:advisor:course-decisions', [{
      snapshotRevision: 'revision-1',
      candidates: [{
        id: 'candidate-1',
        title: '课程',
        sessions: [{ weekday: 1, periods: [1, 2], weeks: [1, 2], [dangerousField]: 'secret' }],
      }],
    }]), new RegExp(`unknown field ${dangerousField}`))
  }
  assert.throws(() => validateIpcArguments('theia:advisor:course-decisions', [{
    snapshotRevision: 'revision-1',
    candidates: [{ id: 'candidate-1', title: '课程', period: { value: 1 } }],
  }]), /candidate period/)
  assert.throws(() => validateIpcArguments('theia:advisor:course-decisions', [{
    snapshotRevision: 'revision-1',
    candidates: [{ id: 'candidate-1', title: '课程', sessions: [{ weekday: 1, weeks: [{ token: 'secret' }] }] }],
  }]), /candidate session weeks item/)
  assert.throws(() => validateIpcArguments('theia:advisor:course-decisions', [{
    snapshotRevision: 'revision-1',
    candidates: [{ id: 'candidate-1', title: '课程', requirementNodeIds: ['node-1', { token: 'secret' }] }],
  }]), /requirementNodeIds item/)
  assert.throws(() => validateIpcArguments('theia:advisor:course-decisions', [{
    snapshotRevision: 'revision-1',
    candidates: [{
      id: 'candidate-1',
      title: '课程',
      sessions: Array.from({ length: 65 }, () => ({ weekday: 1, period: 1 })),
    }],
  }]), /sessions must be an array with at most 64 items/)
  assert.throws(() => validateIpcArguments('theia:advisor:course-decisions', [{
    snapshotRevision: 'revision-1',
    candidates: [{
      id: 'candidate-1',
      title: '课程',
      requirementNodeIds: Array.from({ length: 129 }, (_, index) => `node-${index}`),
    }],
  }]), /requirementNodeIds must be an array with at most 128 items/)
  assert.doesNotThrow(() => validateIpcArguments('theia:advisor:execute-action', [{
    snapshotRevision: 'revision-1',
    actionId: 'action1:open-source-detail:opaque',
  }]))
  assert.throws(() => validateIpcArguments('theia:advisor:execute-action', [{
    snapshotRevision: 'revision-1',
    actionId: 'action1:open-source-detail:opaque',
    assignmentId: 'raw-assignment-id',
  }]), /unknown field assignmentId/)
  assert.throws(() => validateIpcArguments('theia:advisor:execute-action', [{
    snapshotRevision: 'revision-1',
    actionId: 'action1:open-source-detail:opaque',
    url: 'https://course.buct.edu.cn/meol/',
  }]), /unknown field url/)
  assert.doesNotThrow(() => validateIpcArguments('theia:advisor:prepare', [{
    threadId: 'thread-1',
    question: '请问一下',
  }]))
  for (const legacyField of ['agent', 'readableDomains', 'selectedNoticeIds', 'selectedMailIds', 'includeMailBodyIds']) {
    assert.throws(() => validateIpcArguments('theia:advisor:prepare', [{
      threadId: 'thread-1',
      question: '测试',
      [legacyField]: legacyField === 'agent' ? true : [],
    }]), new RegExp(`unknown field ${legacyField}`))
  }
  assert.doesNotThrow(() => validateIpcArguments('theia:advisor:send', [{ requestId: 'request-1' }]))
  assert.doesNotThrow(() => validateIpcArguments('theia:advisor:send', [{ threadId: 'thread-1', question: '我是谁' }]))
  assert.throws(() => validateIpcArguments('theia:advisor:send', [{ threadId: 'thread-1' }]), /requestId or threadId and question are required/)
  assert.throws(() => validateIpcArguments('theia:advisor:prepare', [{ threadId: 'thread-1', question: '测试', intent: 'general' }]), /unknown field intent/)
  assert.throws(() => validateIpcArguments('theia:advisor:send', [{ requestId: 'request-1', stream: false }]), /unknown field stream/)
  assert.throws(() => validateIpcArguments('theia:advisor:send', [{ requestId: 'request-1', approved: true }]), /unknown field approved/)
})

test('every registered theia IPC channel has a runtime schema', async () => {
  const source = (await Promise.all([
    readFile(new URL('../electron/main.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../electron/ipc-registration.mjs', import.meta.url), 'utf8'),
  ])).join('\n')
  const channels = [...source.matchAll(/ipcMain\.(?:handle|on)\(\s*['"](theia:[^'"]+)['"]/g)].map((match) => match[1])
  assert.ok(channels.length > 50)
  assert.deepEqual(channels.filter((channel) => !THEIA_IPC_SCHEMAS.has(channel)), [])
})
