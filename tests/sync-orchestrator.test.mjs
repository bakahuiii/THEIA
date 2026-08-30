import test from 'node:test'
import assert from 'node:assert/strict'
import { createSyncOrchestrator, FOREGROUND_JWGLXT_SYNC_DOMAINS, SYNC_DOMAIN_TARGETS } from '../electron/sync-orchestrator.mjs'

function createHarness(overrides = {}) {
  const calls = []
  const diagnostics = []
  const snapshots = {
    updatedAt: '2026-08-29T00:00:00.000Z',
    settings: { academicApiEnabled: false },
    academicExtras: { domains: {} },
    courses: [],
    sync: { runId: 'run-1', lastCompletedAt: '2026-08-29T00:00:00.000Z', lastError: null },
  }
  const store = {
    snapshot: () => snapshots,
    snapshotWithRevision: () => ({ snapshot: snapshots, revision: 7 }),
    ...overrides.store,
  }
  const syncService = {
    active: null,
    hasActiveSync: () => false,
    syncNow: async (request) => {
      calls.push(request)
      return snapshots
    },
    ...overrides.syncService,
  }
  const verifiedSessions = { jwglxt: null, theol: null, tygl: null, ...overrides.verifiedSessions }
  const orchestrator = createSyncOrchestrator({
    store,
    syncService,
    academicAttachmentStore: {},
    verifiedSessions,
    isExplicitlyLoggedOut: () => false,
    writeDiagnostic: async (event, fields) => diagnostics.push({ event, fields }),
    diagnosticError: (error) => error?.message || String(error),
    sendSnapshot: () => calls.push({ type: 'snapshot' }),
    ...overrides,
  })
  return { calls, diagnostics, orchestrator, snapshots }
}

test('sync domain targets retain the public aliases and foreground scope', () => {
  assert.deepEqual(SYNC_DOMAIN_TARGETS['jwglxt-courses'], { source: 'jwglxt', domain: 'courses' })
  assert.deepEqual(SYNC_DOMAIN_TARGETS['theol-course-details'], { source: 'theol', domain: 'course-details' })
  assert.deepEqual([...FOREGROUND_JWGLXT_SYNC_DOMAINS], [
    'profile', 'terms', 'courses', 'schedule', 'grades', 'exams',
    'selected-courses', 'academic-progress', 'notices',
  ])
})

test('foreground sync refreshes both sources and schedules are disposable', async () => {
  const harness = createHarness()
  const snapshot = await harness.orchestrator.syncForegroundCampusData()
  harness.orchestrator.shutdown()

  assert.equal(snapshot, harness.snapshots)
  assert.deepEqual(harness.calls.slice(0, 2), [
    { sources: ['jwglxt'], domains: [...FOREGROUND_JWGLXT_SYNC_DOMAINS], foreground: true },
    { sources: ['theol'], domains: ['courses', 'notices'], foreground: true },
  ])
  assert.deepEqual(harness.calls.at(-1), { type: 'snapshot' })
  assert.deepEqual(harness.diagnostics.map(({ event }) => event), [
    'sync.foreground_started',
    'sync.foreground_finished',
  ])
})

test('advisor sync groups selected aliases by source and rejects unknown domains', async () => {
  const harness = createHarness()
  const result = await harness.orchestrator.syncAdvisorCampusData({
    domains: ['jwglxt-courses', 'theol-courses', 'jwglxt-courses'],
  })

  assert.deepEqual(harness.calls, [
    { sources: ['jwglxt'], domains: ['courses'], foreground: true },
    { sources: ['theol'], domains: ['courses'], foreground: true },
    { type: 'snapshot' },
  ])
  assert.deepEqual(result, {
    scope: 'selected',
    refreshedDomains: ['jwglxt-courses', 'theol-courses'],
    updatedAt: harness.snapshots.updatedAt,
    revision: 7,
  })
  await assert.rejects(
    () => harness.orchestrator.syncAdvisorCampusData({ domains: ['missing-domain'] }),
    /Agent cannot synchronize unsupported domain: missing-domain/,
  )
})

test('academic-plan prefetch requires a verified source and missing local attachment', async () => {
  const harness = createHarness({ verifiedSessions: { jwglxt: { cookieValue: 'verified' } } })
  await harness.orchestrator.prefetchAcademicStaticData({ reason: 'test' })

  assert.deepEqual(harness.calls, [
    { sources: ['jwglxt'], domains: ['academic-plan'] },
  ])
  assert.deepEqual(harness.diagnostics.map(({ event }) => event), [
    'sync.static_prefetch_started',
    'sync.static_prefetch_finished',
  ])
})
