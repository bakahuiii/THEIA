import test from 'node:test'
import assert from 'node:assert/strict'
import { registerSyncIpc } from '../electron/sync-ipc.mjs'

function createHarness() {
  const handlers = new Map()
  const initialSnapshot = {
    terms: [{ id: '2025-2026-1', label: '2025-2026 第一学期' }],
  }
  const queriedSnapshot = {
    ...initialSnapshot,
    academicExtras: {
      domains: {
        'free-classroom': {
          capturedAt: '2026-09-02T01:00:00.000Z',
          records: [{ id: 'room-1', classroom: 'N2155' }],
        },
      },
    },
  }
  const syncRequests = []
  const diagnostics = []
  let publishedSnapshots = 0

  registerSyncIpc({
    ipcMain: {
      handle(channel, handler) {
        handlers.set(channel, handler)
      },
    },
    store: { snapshot: () => initialSnapshot },
    syncService: {
      async syncNow(request) {
        syncRequests.push(request)
        return queriedSnapshot
      },
    },
    sendSnapshot: () => { publishedSnapshots += 1 },
    waitForSchoolProxy: async () => {},
    getAuthEpoch: () => 1,
    assertAuthEpoch: () => {},
    writeDiagnostic: (event, fields) => { diagnostics.push({ event, fields }) },
  })

  return { handlers, initialSnapshot, queriedSnapshot, syncRequests, diagnostics, get publishedSnapshots() { return publishedSnapshots } }
}

test('free classroom IPC publishes the fresh scoped-query snapshot to the renderer', async () => {
  const harness = createHarness()
  const query = {
    termId: '2025-2026-1',
    weeks: [1],
    weekdays: [3],
    periods: [1, 2],
    campus: '东校区',
  }

  const result = await harness.handlers.get('theia:query-free-classrooms')(null, query)

  assert.equal(result, harness.queriedSnapshot)
  assert.equal(harness.publishedSnapshots, 1)
  assert.deepEqual(harness.syncRequests, [{
    sources: ['jwglxt'],
    domains: ['free-classroom'],
    freeClassroom: { ...query, term: harness.initialSnapshot.terms[0] },
    foreground: true,
  }])
  assert.deepEqual(harness.diagnostics, [{
    event: 'free_classroom.query_started',
    fields: {
      source: 'renderer-ipc',
      termId: query.termId,
      weeks: query.weeks,
      weekdays: query.weekdays,
      periods: query.periods,
      campus: query.campus,
      building: null,
      classroomType: null,
    },
  }, {
    event: 'free_classroom.query_finished',
    fields: {
      termId: query.termId,
      weeks: query.weeks,
      weekdays: query.weekdays,
      periods: query.periods,
      records: 1,
      capturedAt: '2026-09-02T01:00:00.000Z',
    },
  }])
})
