import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { mergeSyncResult, normalizeState, normalizeSyncPayload, recoverInterruptedSyncState } from '../core/schema.mjs'
import { CampusStore } from '../core/store.mjs'
import { SyncService } from '../core/sync-service.mjs'
import { aggregateDomainProvenance, sourceDomainOutcome } from '../core/domain-provenance.mjs'

test('legacy sync timestamps migrate only a completed successful run to lastSuccessAt', () => {
  const completedAt = '2026-08-12T01:00:00.000Z'
  const successful = normalizeState({ sync: { lastCompletedAt: completedAt, lastError: null } })
  assert.equal(successful.sync.lastRunAt, completedAt)
  assert.equal(successful.sync.lastSuccessAt, completedAt)

  const failed = normalizeState({ sync: { lastCompletedAt: completedAt, lastError: 'failed' } })
  assert.equal(failed.sync.lastRunAt, completedAt)
  assert.equal(failed.sync.lastSuccessAt, null)
  assert.deepEqual(successful.sync.domains, {})
  assert.deepEqual(failed.sync.domains, {})
})

test('a restarted process clears an interrupted sync marker without discarding its result', () => {
  const completedAt = '2026-08-12T01:00:00.000Z'
  const recovered = recoverInterruptedSyncState(normalizeState({
    courses: [{ id: 'course-1', title: '课程' }],
    sync: {
      lastStartedAt: '2026-08-12T02:00:00.000Z',
      lastCompletedAt: completedAt,
      lastRunAt: completedAt,
      lastSuccessAt: completedAt,
    },
  }))

  assert.equal(recovered.repaired, true)
  assert.equal(recovered.state.sync.lastStartedAt, completedAt)
  assert.equal(recovered.state.courses[0].id, 'course-1')
})

test('a restarted process removes a start-only marker when no completed run exists', () => {
  const recovered = recoverInterruptedSyncState(normalizeState({
    sync: { lastStartedAt: '2026-08-12T02:00:00.000Z' },
  }))

  assert.equal(recovered.repaired, true)
  assert.equal(recovered.state.sync.lastStartedAt, null)
})

test('adapter payloads use the same canonical state boundary before fallback merges', () => {
  const payload = normalizeSyncPayload({
    schedule: [null, { id: 'schedule-1', title: '高等数学', termId: '2026-3' }],
    grades: ['invalid', { id: 'grade-1', courseName: '高等数学', score: 90 }],
    academicExtras: {
      domains: {
        'academic-plan': {
          records: [{ id: 'legacy-row' }],
          attachments: [
            { id: 'old-pdf', type: 'pdf', sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/old.pdf' },
            { id: 'current-pdf', type: 'pdf', sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/current.pdf', cached: true },
          ],
        },
        'academic-warning': { records: [{ id: 'warning' }] },
        thesis: { records: [{ id: 'thesis' }] },
      },
    },
    domainOutcomes: {
      'academic-plan': { succeeded: true },
      'academic-warning': { succeeded: true },
      thesis: { succeeded: true },
    },
  })
  assert.deepEqual(payload.grades.map((item) => item.id), ['grade-1'])
  assert.match(payload.schedule[0].color, /^#/u)
  assert.deepEqual(payload.academicExtras.domains['academic-plan'].records, [])
  assert.deepEqual(payload.academicExtras.domains['academic-plan'].attachments.map((item) => item.id), ['current-pdf'])
  assert.deepEqual(Object.keys(payload.academicExtras.domains), ['academic-plan'])
  assert.deepEqual(Object.keys(payload.domainOutcomes), ['academic-plan'])
})

test('legacy snapshots never infer domain freshness or completeness from global timestamps', () => {
  const state = normalizeState({
    updatedAt: '2026-08-12T03:00:00.000Z',
    grades: [{ id: 'grade-1', score: '90' }],
    sync: { lastSuccessAt: '2026-08-12T02:59:00.000Z' },
  })
  assert.deepEqual(state.sync.domains, {})
})

test('explicit null lastSuccessAt survives error clearing at the start of a later run', () => {
  const state = normalizeState({
    sync: {
      lastCompletedAt: '2026-08-12T01:00:00.000Z',
      lastRunAt: '2026-08-12T01:00:00.000Z',
      lastSuccessAt: null,
      lastError: 'previous failure',
    },
  })
  const started = normalizeState({
    ...state,
    sync: { ...state.sync, lastStartedAt: '2026-08-12T02:00:00.000Z', lastError: null },
  })
  assert.equal(started.sync.lastSuccessAt, null)
})

test('completed partial failure advances the run timestamp without advancing data freshness', () => {
  const previousSuccessAt = '2026-08-12T01:00:00.000Z'
  const next = mergeSyncResult(normalizeState({
    sync: {
      lastCompletedAt: previousSuccessAt,
      lastRunAt: previousSuccessAt,
      lastSuccessAt: previousSuccessAt,
    },
  }), {
    completed: true,
    completedAt: '2026-08-12T02:00:00.000Z',
    errors: ['one source failed'],
  })
  assert.equal(next.sync.lastCompletedAt, '2026-08-12T02:00:00.000Z')
  assert.equal(next.sync.lastRunAt, '2026-08-12T02:00:00.000Z')
  assert.equal(next.sync.lastSuccessAt, previousSuccessAt)
})

test('completed successful run advances both run and freshness timestamps', () => {
  const next = mergeSyncResult(normalizeState({}), {
    completed: true,
    completedAt: '2026-08-12T02:00:00.000Z',
    errors: [],
  })
  assert.equal(next.sync.lastRunAt, '2026-08-12T02:00:00.000Z')
  assert.equal(next.sync.lastSuccessAt, '2026-08-12T02:00:00.000Z')
})

test('a successful partial domain remains quality evidence without failing the sync run', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-domain-partial-success-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    const service = new SyncService({
      store,
      jwglxt: {
        async sync() {
          return {
            academicProgress: { gpa: 3.1, categories: [] },
            domainOutcomes: {
              'academic-progress': sourceDomainOutcome({
                source: 'jwglxt',
                attempted: true,
                succeeded: true,
                status: 'succeeded',
                capturedAt: '2026-08-13T01:00:00.000Z',
                completeness: 'partial',
                errorCode: 'summary_only',
              }),
            },
            errors: [],
            source: { connected: true },
          }
        },
      },
      theol: {},
    })

    const state = await service.syncNow({ sources: ['jwglxt'] })
    assert.equal(state.sync.lastError, null)
    assert.equal(state.sync.lastSuccessAt, state.sync.lastCompletedAt)
    assert.equal(state.sync.domains['academic-progress'].status, 'succeeded')
    assert.equal(state.sync.domains['academic-progress'].completeness, 'partial')
    assert.equal(state.sync.domains['academic-progress'].outcomes.jwglxt.errorCode, 'summary_only')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a failed domain still fails the sync when an adapter omits its top-level error', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-domain-failed-outcome-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    const service = new SyncService({
      store,
      jwglxt: {
        async sync() {
          return {
            grades: undefined,
            domainOutcomes: {
              grades: sourceDomainOutcome({
                source: 'jwglxt',
                attempted: true,
                succeeded: false,
                status: 'failed',
                completeness: 'unknown',
                errorCode: 'grades_read_failed',
              }),
            },
            errors: [],
            source: { connected: true },
          }
        },
      },
      theol: {},
    })

    const state = await service.syncNow({ sources: ['jwglxt'] })
    assert.match(state.sync.lastError, /grades\(grades_read_failed\)/)
    assert.equal(state.sync.lastSuccessAt, null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a real adapter error still fails a run that also has successful partial evidence', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-domain-partial-with-error-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    const service = new SyncService({
      store,
      jwglxt: {
        async sync() {
          return {
            academicProgress: { gpa: 3.1, categories: [] },
            domainOutcomes: {
              'academic-progress': sourceDomainOutcome({
                source: 'jwglxt',
                attempted: true,
                succeeded: true,
                status: 'succeeded',
                capturedAt: '2026-08-13T01:00:00.000Z',
                completeness: 'partial',
                errorCode: 'summary_only',
              }),
            },
            errors: ['term read failed'],
            source: { connected: true },
          }
        },
      },
      theol: {},
    })

    const state = await service.syncNow({ sources: ['jwglxt'] })
    assert.equal(state.sync.lastError, 'term read failed')
    assert.equal(state.sync.lastSuccessAt, null)
    assert.equal(state.sync.domains['academic-progress'].completeness, 'partial')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('sync persists per-domain success, confirmed-empty, and retained-previous outcomes', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-domain-outcomes-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    await store.update((state) => ({
      ...state,
      grades: [{ id: 'old-grade', score: '80' }],
    }))
    const service = new SyncService({
      store,
      jwglxt: {
        async sync() {
          return {
            profile: { studentId: 'test' },
            terms: [],
            courses: [],
            schedule: [],
            grades: undefined,
            exams: [],
            selectedCourses: [],
            academicProgress: null,
            notices: [],
            domainOutcomes: {
              schedule: {
                attempted: true,
                succeeded: true,
                status: 'succeeded',
                emptyConfirmed: true,
                completeness: 'complete',
              },
              grades: {
                attempted: true,
                succeeded: false,
                status: 'failed',
                retainedPrevious: true,
                errorCode: 'grades_unavailable',
              },
            },
            errors: ['grades unavailable'],
            source: { connected: true, checkedAt: '2026-08-12T02:00:00.000Z' },
          }
        },
        async status() { return { connected: true } },
      },
      theol: {
        async sync() { throw new Error('platform unavailable') },
        async status() { return { connected: false } },
      },
    })
    const state = await service.syncNow()
    assert.equal(state.sync.domains.schedule.succeeded, true)
    assert.equal(state.sync.domains.schedule.emptyConfirmed, true)
    assert.equal(state.sync.domains.schedule.completeness, 'complete')
    assert.equal(state.sync.domains.grades.succeeded, false)
    assert.equal(state.sync.domains.grades.retainedPrevious, true)
    assert.equal(state.grades[0].id, 'old-grade')
    assert.equal(state.sync.domains.assignments.status, 'failed')
    assert.equal(state.sync.domains.assignments.emptyConfirmed, false)
    assert.ok(state.sync.domains.notices.outcomes.jwglxt)
    assert.ok(state.sync.domains.notices.outcomes.theol)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a successful source does not claim domains that it did not attempt', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-domain-not-attempted-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    const service = new SyncService({
      store,
      jwglxt: {
        async sync() {
          return {
            schedule: [],
            errors: [],
            source: { connected: true, checkedAt: '2026-08-12T02:00:00.000Z' },
          }
        },
        async status() { return { connected: true } },
      },
      theol: {
        async sync() {
          return {
            assignments: [],
            errors: [],
            source: { connected: true, checkedAt: '2026-08-12T02:00:00.000Z' },
          }
        },
        async status() { return { connected: true } },
      },
    })

    const state = await service.syncNow()
    assert.equal(state.sync.domains.schedule.status, 'succeeded')
    assert.equal(state.sync.domains.schedule.emptyConfirmed, true)
    assert.equal(state.sync.domains.grades.status, 'not-attempted')
    assert.equal(state.sync.domains.grades.attempted, false)
    assert.equal(state.sync.domains.grades.attemptedAt, null)
    assert.equal(state.sync.domains.assignments.status, 'succeeded')
    assert.equal(state.sync.domains.courses.status, 'not-attempted')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an intermediate source commit keeps shared domains incomplete until every source has an outcome', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-domain-intermediate-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    const snapshots = []
    const service = new SyncService({
      store,
      jwglxt: {
        async sync() {
          return {
            courses: [{ id: 'jw-course', source: 'jwglxt' }],
            notices: [{ id: 'jw-notice', source: 'jwglxt' }],
            errors: [],
            source: { connected: true, checkedAt: '2026-08-12T02:00:00.000Z' },
          }
        },
        async status() { return { connected: true } },
      },
      theol: {
        async sync() {
          return {
            courses: [{ id: 'theol-course', source: 'theol' }],
            assignments: [],
            notices: [],
            errors: [],
            source: { connected: true, checkedAt: '2026-08-12T02:01:00.000Z' },
          }
        },
        async status() { return { connected: true } },
      },
      onChange: (snapshot) => snapshots.push(snapshot),
    })

    await service.syncNow()
    const intermediate = snapshots[1]
    assert.equal(intermediate.sync.domains.courses.completeness, 'partial')
    assert.equal(intermediate.sync.domains.notices.completeness, 'partial')
    assert.equal(intermediate.sync.domains.courses.emptyConfirmed, false)
    assert.equal(intermediate.sync.domains.courses.outcomes.theol.status, 'not-attempted')
    assert.equal(intermediate.sync.domains.courses.outcomes.theol.attempted, false)
    const final = snapshots.at(-1)
    assert.equal(final.sync.domains.courses.completeness, 'complete')
    assert.equal(final.sync.domains.notices.completeness, 'complete')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a failed source does not claim another source\'s shared-domain records as retained', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-domain-source-retention-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    await store.update((state) => ({
      ...state,
      courses: [{ id: 'jw-only', source: 'jwglxt' }],
      notices: [{ id: 'jw-notice', source: 'jwglxt' }],
    }))
    const service = new SyncService({
      store,
      jwglxt: {
        async sync() {
          return {
            courses: [{ id: 'jw-only', source: 'jwglxt' }],
            notices: [{ id: 'jw-notice', source: 'jwglxt' }],
            errors: [],
            source: { connected: true },
          }
        },
        async status() { return { connected: true } },
      },
      theol: {
        async sync() { throw new Error('theol unavailable') },
        async status() { return { connected: false } },
      },
    })

    const state = await service.syncNow()
    assert.equal(state.sync.domains.courses.outcomes.theol.retainedPrevious, false)
    assert.equal(state.sync.domains.notices.outcomes.theol.retainedPrevious, false)
    assert.equal(state.sync.domains.courses.retainedPrevious, false)
    assert.equal(state.sync.domains.courses.completeness, 'partial')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('partial source results cannot confirm an empty domain', () => {
  const state = normalizeState({
    sync: {
      domains: {
        assignments: {
          attempted: true,
          succeeded: true,
          status: 'succeeded',
          emptyConfirmed: true,
          completeness: 'partial',
        },
      },
    },
  })
  assert.equal(state.sync.domains.assignments.emptyConfirmed, false)
  assert.equal(state.sync.domains.assignments.completeness, 'partial')
})

test('source outcomes normalize contradictory attempt, success, and status fields', () => {
  assert.deepEqual(
    (({ attempted, succeeded, status }) => ({ attempted, succeeded, status }))(
      sourceDomainOutcome({ attempted: true, succeeded: false, status: 'succeeded' }),
    ),
    { attempted: true, succeeded: false, status: 'failed' },
  )
  assert.deepEqual(
    (({ attempted, succeeded, status }) => ({ attempted, succeeded, status }))(
      sourceDomainOutcome({ attempted: true, succeeded: true, status: 'failed' }),
    ),
    { attempted: true, succeeded: true, status: 'succeeded' },
  )
  assert.deepEqual(
    (({ attempted, succeeded, status }) => ({ attempted, succeeded, status }))(
      sourceDomainOutcome({ attempted: false, succeeded: true, status: 'auth-required' }),
    ),
    { attempted: false, succeeded: false, status: 'not-attempted' },
  )
  const notAttempted = sourceDomainOutcome({
    attempted: false,
    status: 'failed',
    attemptedAt: '2026-08-13T00:00:00.000Z',
    completedAt: '2026-08-13T00:00:01.000Z',
  })
  assert.equal(notAttempted.attemptedAt, null)
  assert.equal(notAttempted.completedAt, null)
})

test('a failed refresh preserves the retained dataset completeness independently from last-attempt status', () => {
  const capturedAt = '2026-08-10T00:00:00.000Z'
  const firstRun = aggregateDomainProvenance({}, {
    fixture: {
      assignments: sourceDomainOutcome({
        source: 'fixture',
        runId: 'run-success',
        attempted: true,
        succeeded: true,
        attemptedAt: capturedAt,
        completedAt: capturedAt,
        capturedAt,
        sourceSucceededAt: capturedAt,
        completeness: 'complete',
      }),
    },
  }, { runId: 'run-success' })
  const failedAt = '2026-08-13T00:00:00.000Z'
  const failedRun = aggregateDomainProvenance(firstRun, {
    fixture: {
      assignments: sourceDomainOutcome({
        source: 'fixture',
        runId: 'run-failed',
        attempted: true,
        succeeded: false,
        attemptedAt: failedAt,
        completedAt: failedAt,
        retainedPrevious: true,
        errorCode: 'source_timeout',
      }),
    },
  }, { runId: 'run-failed' })

  assert.equal(failedRun.assignments.status, 'failed')
  assert.equal(failedRun.assignments.retainedPrevious, true)
  assert.equal(failedRun.assignments.completeness, 'complete')
  assert.equal(failedRun.assignments.capturedAt, capturedAt)
  assert.equal(failedRun.assignments.sourceSucceededAt, capturedAt)
})

test('a confirmed-empty content conclusion survives a failed refresh without rewriting the last attempt', () => {
  const capturedAt = '2026-08-10T00:00:00.000Z'
  const firstRun = aggregateDomainProvenance({}, {
    fixture: {
      assignments: sourceDomainOutcome({
        source: 'fixture', runId: 'run-success', attempted: true, succeeded: true,
        attemptedAt: capturedAt, completedAt: capturedAt, capturedAt, sourceSucceededAt: capturedAt,
        emptyConfirmed: true, completeness: 'complete',
      }),
    },
  }, { runId: 'run-success' })
  const failedAt = '2026-08-13T00:00:00.000Z'
  const failedRun = aggregateDomainProvenance(firstRun, {
    fixture: {
      assignments: sourceDomainOutcome({
        source: 'fixture', runId: 'run-failed', attempted: true, succeeded: false,
        attemptedAt: failedAt, completedAt: failedAt, retainedPrevious: false,
        errorCode: 'source_timeout',
      }),
    },
  }, { runId: 'run-failed' })

  assert.equal(failedRun.assignments.status, 'failed')
  assert.equal(failedRun.assignments.emptyConfirmed, false)
  assert.equal(failedRun.assignments.contentEmptyConfirmed, true)
  assert.equal(failedRun.assignments.retainedPrevious, false)
  assert.equal(failedRun.assignments.completeness, 'complete')
  assert.equal(failedRun.assignments.capturedAt, capturedAt)
})

test('derived domain provenance takes the weakest dependency and oldest complete watermark', () => {
  const domains = aggregateDomainProvenance({}, {
    fixture: {
      terms: sourceDomainOutcome({ source: 'fixture', runId: 'run-derived', attempted: true, succeeded: true, capturedAt: '2026-08-12T03:00:00.000Z', completeness: 'complete' }),
      courses: sourceDomainOutcome({ source: 'fixture', runId: 'run-derived', attempted: true, succeeded: true, capturedAt: '2026-08-12T02:00:00.000Z', completeness: 'partial' }),
      'selected-courses': sourceDomainOutcome({ source: 'fixture', runId: 'run-derived', attempted: true, succeeded: true, capturedAt: '2026-08-12T01:00:00.000Z', completeness: 'complete' }),
    },
  }, { runId: 'run-derived' })

  assert.equal(domains.academic.completeness, 'partial')
  assert.equal(domains.academic.capturedAt, '2026-08-12T01:00:00.000Z')
  assert.deepEqual(domains.academic.derivedFrom, ['terms', 'courses', 'selected-courses'])

  const missingAssignment = aggregateDomainProvenance(domains, {
    fixture: {
      workspaces: sourceDomainOutcome({ source: 'fixture', runId: 'run-workspace', attempted: true, succeeded: true, capturedAt: '2026-08-12T04:00:00.000Z', completeness: 'complete' }),
    },
  }, { runId: 'run-workspace' })
  assert.equal(missingAssignment.coursework.completeness, 'unknown')
  assert.equal(missingAssignment.coursework.capturedAt, null)
})

test('multi-source watermarks use the oldest necessary source and become unknown when one source has no capture', () => {
  const first = aggregateDomainProvenance({}, {
    jwglxt: {
      courses: sourceDomainOutcome({ source: 'jwglxt', runId: 'shared-run', attempted: true, succeeded: true, capturedAt: '2026-08-12T03:00:00.000Z', sourceSucceededAt: '2026-08-12T03:00:00.000Z', completeness: 'complete' }),
    },
    theol: {
      courses: sourceDomainOutcome({ source: 'theol', runId: 'shared-run', attempted: true, succeeded: true, capturedAt: '2026-08-12T01:00:00.000Z', sourceSucceededAt: '2026-08-12T01:00:00.000Z', completeness: 'complete' }),
    },
  }, { runId: 'shared-run' })
  assert.equal(first.courses.capturedAt, '2026-08-12T01:00:00.000Z')
  assert.equal(first.courses.sourceSucceededAt, '2026-08-12T01:00:00.000Z')

  const pending = aggregateDomainProvenance({}, {
    jwglxt: {
      courses: sourceDomainOutcome({ source: 'jwglxt', runId: 'pending-run', attempted: true, succeeded: true, capturedAt: '2026-08-12T03:00:00.000Z', completeness: 'complete' }),
    },
    theol: {
      courses: sourceDomainOutcome({ source: 'theol', runId: 'pending-run', attempted: false, succeeded: false, status: 'not-attempted' }),
    },
  }, { runId: 'pending-run' })
  assert.equal(pending.courses.capturedAt, null)
  assert.equal(pending.courses.completeness, 'partial')
})

test('sync service emits one final error event when persistence aborts a run', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-sync-fatal-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    const originalUpdate = store.update.bind(store)
    let updateCalls = 0
    store.update = async (...args) => {
      updateCalls += 1
      if (updateCalls === 2) throw new Error('write C:\\Users\\Student\\private.json token=secret-value failed')
      return originalUpdate(...args)
    }
    const progress = []
    const service = new SyncService({
      store,
      jwglxt: {
        async sync() { return { courses: [], schedule: [], grades: [], selectedCourses: [], exams: [], notices: [], errors: [], source: { connected: true } } },
        async status() { return { connected: true } },
      },
      theol: {
        async sync() { return { assignments: [], errors: [], source: { connected: true } } },
        async status() { return { connected: true } },
      },
      onProgress: (event) => progress.push(event),
    })

    await assert.rejects(service.syncNow(), /private\.json/)
    const finalEvents = progress.filter((event) => event.stage === 'all' && event.status !== 'syncing')
    assert.deepEqual(progress[0], {
      stage: 'all',
      status: 'syncing',
      label: '正在更新校园数据',
    })
    assert.equal(finalEvents.length, 1)
    assert.equal(finalEvents[0].status, 'error')
    assert.equal(finalEvents[0].error.includes('secret-value'), false)
    assert.equal(finalEvents[0].error.includes('C:\\Users\\Student'), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a failed batch final commit rejects once and emits one sanitized final error', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-sync-final-commit-fatal-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    const originalUpdate = store.update.bind(store)
    let updateCalls = 0
    store.update = async (...args) => {
      updateCalls += 1
      if (updateCalls === 3) throw new Error('write C:\\Users\\Student\\final.json token=final-secret failed')
      return originalUpdate(...args)
    }
    const progress = []
    const backgroundErrors = []
    const unhandled = []
    const onUnhandled = (error) => unhandled.push(error)
    process.on('unhandledRejection', onUnhandled)
    try {
      const service = new SyncService({
        store,
        jwglxt: {
          async sync() {
            return { schedule: [], errors: [], source: { connected: true } }
          },
        },
        theol: {},
        onProgress: (event) => progress.push(event),
        onBackgroundError: (error) => backgroundErrors.push(error),
      })

      await assert.rejects(service.syncNow({ sources: ['jwglxt'] }), /final\.json/)
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 0))
      const finalEvents = progress.filter((event) => event.stage === 'all' && event.status !== 'syncing')
      assert.equal(finalEvents.length, 1)
      assert.equal(finalEvents[0].status, 'error')
      assert.equal(finalEvents[0].error.includes('final-secret'), false)
      assert.equal(finalEvents[0].error.includes('C:\\Users\\Student'), false)
      assert.deepEqual(backgroundErrors, [])
      assert.deepEqual(unhandled, [])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a filtered sync only calls the requested platform and preserves omitted source evidence', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-sync-filtered-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    const oldRunId = 'previous-two-platform-run'
    const theolOutcome = sourceDomainOutcome({
      source: 'theol',
      runId: oldRunId,
      attempted: true,
      succeeded: true,
      status: 'succeeded',
      attemptedAt: '2026-08-12T01:00:00.000Z',
      completedAt: '2026-08-12T01:01:00.000Z',
      capturedAt: '2026-08-12T01:00:30.000Z',
      sourceSucceededAt: '2026-08-12T01:01:00.000Z',
      emptyConfirmed: false,
      completeness: 'complete',
      parserVersion: 'theol-adapter/1',
    })
    await store.update((state) => ({
      ...state,
      courses: [{ id: 'old-theol-course', title: 'Old THEOL course', source: 'theol' }],
      notices: [{ id: 'old-theol-notice', title: 'Old THEOL notice', source: 'theol' }],
      sync: {
        ...state.sync,
        runId: oldRunId,
        sources: { ...state.sync.sources, theol: { connected: true, checkedAt: '2026-08-12T01:01:00.000Z' } },
        domains: aggregateDomainProvenance(state.sync.domains, {
          theol: { courses: theolOutcome, notices: theolOutcome },
        }, { runId: oldRunId }),
      },
    }))
    const previousTheolSource = store.snapshot().sync.sources.theol
    const previousCourseOutcome = store.snapshot().sync.domains.courses.outcomes.theol
    const previousNoticeOutcome = store.snapshot().sync.domains.notices.outcomes.theol
    let jwglxtCalls = 0
    let theolCalls = 0
    const service = new SyncService({
      store,
      jwglxt: {
        async sync() {
          jwglxtCalls += 1
          return {
            courses: [{ id: 'new-jw-course', title: 'New academic course', source: 'jwglxt' }],
            notices: [],
            errors: [],
            source: { connected: true, checkedAt: '2026-08-13T01:00:00.000Z' },
          }
        },
      },
      theol: {
        async sync() {
          theolCalls += 1
          throw new Error('THEOL must not run')
        },
      },
    })

    const state = await service.syncNow({ sources: ['jwglxt'] })
    assert.equal(jwglxtCalls, 1)
    assert.equal(theolCalls, 0)
    assert.deepEqual(state.sync.sources.theol, previousTheolSource)
    assert.deepEqual(state.sync.domains.courses.outcomes.theol, previousCourseOutcome)
    assert.deepEqual(state.sync.domains.notices.outcomes.theol, previousNoticeOutcome)
    assert.ok(state.courses.some((item) => item.id === 'old-theol-course'))
    assert.ok(state.courses.some((item) => item.id === 'new-jw-course'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a domain retry requests only that domain and preserves unrelated data and provenance', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-sync-domain-retry-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    const oldRunId = 'completed-full-sync'
    const oldCompletedAt = '2026-08-13T01:00:00.000Z'
    const oldOutcome = (domain) => sourceDomainOutcome({
      source: 'jwglxt', runId: oldRunId, attempted: true, succeeded: true,
      status: 'succeeded', attemptedAt: oldCompletedAt, completedAt: oldCompletedAt,
      capturedAt: oldCompletedAt, sourceSucceededAt: oldCompletedAt,
      emptyConfirmed: false, completeness: 'complete', parserVersion: 'jwglxt-adapter/1',
      domain,
    })
    await store.update((state) => ({
      ...state,
      schedule: [{ id: 'old-schedule', source: 'jwglxt' }],
      exams: [{ id: 'old-exam', source: 'jwglxt' }],
      grades: [{ id: 'old-grade', source: 'jwglxt' }],
      academicProgress: { gpa: 1.5, roots: [{ id: 'old-root', children: [], courses: [] }] },
      sync: {
        ...state.sync,
        runId: oldRunId,
        lastStartedAt: oldCompletedAt,
        lastCompletedAt: oldCompletedAt,
        lastRunAt: oldCompletedAt,
        lastSuccessAt: oldCompletedAt,
        lastError: 'earlier unrelated warning',
        domains: aggregateDomainProvenance(state.sync.domains, {
          jwglxt: {
            schedule: oldOutcome('schedule'),
            exams: oldOutcome('exams'),
            grades: oldOutcome('grades'),
            'academic-progress': oldOutcome('academic-progress'),
          },
        }, { runId: oldRunId }),
      },
    }))
    const before = structuredClone(store.snapshot())
    let receivedOptions = null
    let theolCalls = 0
    const service = new SyncService({
      store,
      jwglxt: {
        async sync(options) {
          receivedOptions = options
          return {
            academicProgress: { gpa: 1.78, roots: [{ id: 'new-root', children: [], courses: [{ id: 'course' }] }] },
            domainOutcomes: {
              'academic-progress': sourceDomainOutcome({
                source: 'jwglxt', attempted: true, succeeded: true, status: 'succeeded',
                capturedAt: '2026-08-14T01:00:00.000Z', completeness: 'complete', parserVersion: 'jwglxt-adapter/1',
              }),
            },
            source: { connected: true, checkedAt: '2026-08-14T01:00:00.000Z' },
            errors: [],
          }
        },
      },
      theol: { async sync() { theolCalls += 1; throw new Error('THEOL must not run') } },
    })

    const after = await service.syncNow({ sources: ['jwglxt'], domains: ['academic-progress'] })
    assert.deepEqual(receivedOptions, { domains: ['academic-progress'] })
    assert.equal(theolCalls, 0)
    assert.deepEqual(after.schedule, before.schedule)
    assert.deepEqual(after.exams, before.exams)
    assert.deepEqual(after.grades, before.grades)
    assert.deepEqual(after.sync.domains.schedule, before.sync.domains.schedule)
    assert.deepEqual(after.sync.domains.exams, before.sync.domains.exams)
    assert.deepEqual(after.sync.domains.grades, before.sync.domains.grades)
    assert.equal(after.sync.runId, before.sync.runId)
    assert.equal(after.sync.lastCompletedAt, before.sync.lastCompletedAt)
    assert.equal(after.sync.lastSuccessAt, before.sync.lastSuccessAt)
    assert.equal(after.sync.lastError, before.sync.lastError)
    assert.equal(after.academicProgress.gpa, 1.78)
    assert.notEqual(after.sync.domains['academic-progress'].outcomes.jwglxt.runId, oldRunId)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a scoped free-classroom query reaches the adapter without widening its domain request', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-sync-free-classroom-query-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    let receivedOptions = null
    const service = new SyncService({
      store,
      jwglxt: {
        async sync(options) {
          receivedOptions = options
          return { errors: [], source: { connected: true } }
        },
      },
      theol: { async sync() { throw new Error('THEOL must not run') } },
    })
    await service.syncNow({
      sources: ['jwglxt'],
      domains: ['free-classroom'],
      foreground: true,
      freeClassroom: { term: { id: '2026-3', year: 2026, term: '3' }, weeks: [2], weekdays: [4], periods: [5] },
    })
    assert.deepEqual(receivedOptions, {
      domains: ['free-classroom'],
      freeClassroom: { term: { id: '2026-3', year: 2026, term: '3' }, weeks: [2], weekdays: [4], periods: [5] },
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('sync persists a completed domain before the source adapter settles', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-sync-domain-stream-'))
  let releaseSource
  try {
    const store = new CampusStore(root)
    await store.load()
    const sourceGate = new Promise((resolveGate) => { releaseSource = resolveGate })
    let observePublished
    const published = new Promise((resolvePublished) => { observePublished = resolvePublished })
    const service = new SyncService({
      store,
      jwglxt: {
        async sync() {
          await this.onDomainResult({
            domain: 'schedule',
            result: {
              schedule: [{ id: 'early-schedule', source: 'jwglxt', weekday: 1, period: '1-2' }],
              source: { connected: true },
              errors: [],
            },
            outcome: sourceDomainOutcome({
              source: 'jwglxt', attempted: true, succeeded: true, status: 'succeeded',
              capturedAt: new Date().toISOString(), completeness: 'complete', parserVersion: 'test',
            }),
          })
          observePublished()
          await sourceGate
          return {
            schedule: [{ id: 'early-schedule', source: 'jwglxt', weekday: 1, period: '1-2' }],
            source: { connected: true },
            errors: [],
          }
        },
      },
      theol: {},
    })
    const pending = service.syncNow({ sources: ['jwglxt'], domains: ['schedule'] })
    await published
    assert.equal(store.snapshot().schedule.some((item) => item.id === 'early-schedule'), true)
    releaseSource()
    await pending
  } finally {
    releaseSource?.()
    await rm(root, { recursive: true, force: true })
  }
})

test('independent filtered platform syncs start concurrently instead of sharing a global queue', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-sync-independent-sources-'))
  let releaseAcademic = () => {}
  let releaseTheol = () => {}
  try {
    const store = new CampusStore(root)
    await store.load()
    let observeAcademicStart
    const academicStarted = new Promise((resolveStarted) => { observeAcademicStart = resolveStarted })
    const academicGate = new Promise((resolveGate) => { releaseAcademic = resolveGate })
    let observeTheolStart
    const theolStarted = new Promise((resolveStarted) => { observeTheolStart = resolveStarted })
    const theolGate = new Promise((resolveGate) => { releaseTheol = resolveGate })
    let jwglxtCalls = 0
    let theolCalls = 0
    const service = new SyncService({
      store,
      jwglxt: {
        async sync() {
          jwglxtCalls += 1
          observeAcademicStart()
          await academicGate
          return { schedule: [], errors: [], source: { connected: true } }
        },
      },
      theol: {
        async sync() {
          theolCalls += 1
          observeTheolStart()
          await theolGate
          return { courses: [], notices: [], errors: [], source: { connected: true } }
        },
      },
    })

    const academic = service.syncNow({ sources: ['jwglxt'] })
    await academicStarted
    const concurrentTheol = service.syncNow({ sources: ['theol'] })
    await theolStarted
    assert.equal(theolCalls, 1)
    releaseAcademic()
    await academic
    assert.equal(theolCalls, 1, 'THEOL remains active after academic sync finishes')
    releaseTheol()
    await concurrentTheol

    assert.equal(jwglxtCalls, 1)
    assert.equal(theolCalls, 1)
  } finally {
    releaseAcademic()
    releaseTheol()
    await rm(root, { recursive: true, force: true })
  }
})

test('one logical batch completes once after independent platforms settle and retains source failure', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-sync-batch-final-'))
  let releaseTheol = () => {}
  try {
    const store = new CampusStore(root)
    await store.load()
    const previousSuccessAt = '2026-08-12T01:00:00.000Z'
    await store.update((state) => ({
      ...state,
      sync: {
        ...state.sync,
        lastCompletedAt: previousSuccessAt,
        lastRunAt: previousSuccessAt,
        lastSuccessAt: previousSuccessAt,
      },
    }))
    const theolGate = new Promise((resolveGate) => { releaseTheol = resolveGate })
    const completedSnapshots = []
    const service = new SyncService({
      store,
      jwglxt: {
        async sync() {
          return { schedule: [], errors: [], source: { connected: true } }
        },
      },
      theol: {
        async sync() {
          await theolGate
          throw new Error('THEOL batch failure')
        },
      },
      onChange: (state) => {
        if (state.sync.lastCompletedAt !== previousSuccessAt) completedSnapshots.push(state)
      },
    })

    const academic = service.syncNow({ sources: ['jwglxt'] })
    const theol = service.syncNow({ sources: ['theol'] })
    const academicSnapshot = await academic
    const batchRunId = academicSnapshot.sync.runId
    assert.equal(academicSnapshot.sync.lastCompletedAt, previousSuccessAt)
    assert.equal(store.snapshot().sync.lastCompletedAt, previousSuccessAt)

    releaseTheol()
    const finalSnapshot = await theol
    assert.equal(completedSnapshots.length, 1)
    assert.equal(finalSnapshot.sync.runId, batchRunId)
    assert.equal(finalSnapshot.sync.lastCompletedAt, completedSnapshots[0].sync.lastCompletedAt)
    assert.equal(finalSnapshot.sync.lastSuccessAt, previousSuccessAt)
    assert.match(finalSnapshot.sync.lastError, /THEOL batch failure/)
    assert.equal(finalSnapshot.sync.domains.schedule.outcomes.jwglxt.runId, batchRunId)
    assert.equal(finalSnapshot.sync.domains.courses.outcomes.theol.runId, batchRunId)
  } finally {
    releaseTheol()
    await rm(root, { recursive: true, force: true })
  }
})

test('a successful source retry replaces its earlier batch error before the batch completes', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-sync-batch-retry-'))
  let releaseTheol = () => {}
  try {
    const store = new CampusStore(root)
    await store.load()
    const theolGate = new Promise((resolveGate) => { releaseTheol = resolveGate })
    let academicCalls = 0
    let observeFirstAcademicCommit
    const firstAcademicCommitted = new Promise((resolveCommit) => { observeFirstAcademicCommit = resolveCommit })
    const service = new SyncService({
      store,
      jwglxt: {
        async sync() {
          academicCalls += 1
          if (academicCalls === 1) throw new Error('obsolete academic failure')
          return {
            schedule: [{ id: 'retry-schedule', source: 'jwglxt', weekday: 1, period: '1-2' }],
            errors: [],
            source: { connected: true },
          }
        },
      },
      theol: {
        async sync() {
          await theolGate
          return { courses: [], notices: [], errors: [], source: { connected: true } }
        },
      },
      onChange: (state) => {
        if (state.sync.sources?.jwglxt && academicCalls === 1) observeFirstAcademicCommit()
      },
    })

    const full = service.syncNow()
    await Promise.race([
      firstAcademicCommitted,
      new Promise((_, reject) => setTimeout(() => reject(new Error('first academic commit timed out')), 1_000)),
    ])
    const retry = service.syncNow({ sources: ['jwglxt'] })
    const retrySnapshot = await retry
    assert.equal(academicCalls, 2)
    assert.equal(retrySnapshot.sync.lastCompletedAt, null)

    releaseTheol()
    const finalSnapshot = await full
    assert.equal(finalSnapshot.sync.lastError, null)
    assert.ok(finalSnapshot.schedule.some((item) => item.id === 'retry-schedule'))
    assert.equal(finalSnapshot.sync.domains.schedule.outcomes.jwglxt.runId, finalSnapshot.sync.runId)
  } finally {
    releaseTheol()
    await rm(root, { recursive: true, force: true })
  }
})

test('a default sync joins an active source and starts the other platform immediately', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-sync-mixed-entry-'))
  let releaseAcademic = () => {}
  let releaseTheol = () => {}
  try {
    const store = new CampusStore(root)
    await store.load()
    let observeAcademicStart
    const academicStarted = new Promise((resolveStarted) => { observeAcademicStart = resolveStarted })
    const academicGate = new Promise((resolveGate) => { releaseAcademic = resolveGate })
    let observeTheolStart
    const theolStarted = new Promise((resolveStarted) => { observeTheolStart = resolveStarted })
    const theolGate = new Promise((resolveGate) => { releaseTheol = resolveGate })
    let jwglxtCalls = 0
    let theolCalls = 0
    const service = new SyncService({
      store,
      jwglxt: {
        async sync() {
          jwglxtCalls += 1
          observeAcademicStart()
          await academicGate
          return { schedule: [], errors: [], source: { connected: true } }
        },
      },
      theol: {
        async sync() {
          theolCalls += 1
          observeTheolStart()
          await theolGate
          return { courses: [], notices: [], errors: [], source: { connected: true } }
        },
      },
    })

    const academic = service.syncNow({ sources: ['jwglxt'] })
    await academicStarted
    const full = service.syncNow()
    await theolStarted
    assert.equal(jwglxtCalls, 1, 'the default sync duplicated an already active academic run')
    assert.equal(theolCalls, 1)

    releaseAcademic()
    releaseTheol()
    await Promise.all([academic, full])
  } finally {
    releaseAcademic()
    releaseTheol()
    await rm(root, { recursive: true, force: true })
  }
})

test('a default JWGLXT run does not satisfy a queued low-frequency extension read', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-sync-extension-priority-'))
  let releaseFull = () => {}
  try {
    const store = new CampusStore(root)
    await store.load()
    const fullGate = new Promise((resolveGate) => { releaseFull = resolveGate })
    let observeFullStart
    const fullStarted = new Promise((resolveStarted) => { observeFullStart = resolveStarted })
    const calls = []
    const service = new SyncService({
      store,
      jwglxt: {
        async sync(options = {}) {
          calls.push(options.domains || null)
          observeFullStart()
          if (calls.length === 1) await fullGate
          return { errors: [], source: { connected: true } }
        },
      },
      theol: {},
    })

    const full = service.syncNow({ sources: ['jwglxt'] })
    await fullStarted
    const extension = service.syncNow({ sources: ['jwglxt'], domains: ['academic-plan'] })
    assert.deepEqual(calls, [null])

    releaseFull()
    await Promise.all([full, extension])
    assert.deepEqual(calls, [null, ['academic-plan']])
  } finally {
    releaseFull()
    await rm(root, { recursive: true, force: true })
  }
})

test('status can overlap academic sync but remains serialized behind THEOL sync', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-sync-status-concurrency-'))
  let releaseSyncs = () => {}
  try {
    const store = new CampusStore(root)
    await store.load()
    let observeBothSyncs
    const bothSyncsStarted = new Promise((resolveStarted) => { observeBothSyncs = resolveStarted })
    const syncGate = new Promise((resolveGate) => { releaseSyncs = resolveGate })
    let syncStarts = 0
    let activeAcademic = 0
    let maxActiveAcademic = 0
    let activeTheol = 0
    let maxActiveTheol = 0
    let academicStatusCalls = 0
    let theolStatusCalls = 0
    const markSyncStarted = () => {
      syncStarts += 1
      if (syncStarts === 2) observeBothSyncs()
    }
    const service = new SyncService({
      store,
      jwglxt: {
        async sync() {
          activeAcademic += 1
          maxActiveAcademic = Math.max(maxActiveAcademic, activeAcademic)
          markSyncStarted()
          await syncGate
          activeAcademic -= 1
          return { schedule: [], errors: [], source: { connected: true } }
        },
        async status() {
          academicStatusCalls += 1
          activeAcademic += 1
          maxActiveAcademic = Math.max(maxActiveAcademic, activeAcademic)
          activeAcademic -= 1
          return { connected: true }
        },
      },
      theol: {
        async sync() {
          activeTheol += 1
          maxActiveTheol = Math.max(maxActiveTheol, activeTheol)
          markSyncStarted()
          await syncGate
          activeTheol -= 1
          return { courses: [], notices: [], errors: [], source: { connected: true } }
        },
        async status() {
          theolStatusCalls += 1
          activeTheol += 1
          maxActiveTheol = Math.max(maxActiveTheol, activeTheol)
          activeTheol -= 1
          return { connected: true }
        },
      },
    })

    const sync = service.syncNow()
    await bothSyncsStarted
    const status = service.status()
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20))
    assert.equal(academicStatusCalls, 1, 'academic status was serialized behind academic sync')
    assert.equal(theolStatusCalls, 0, 'THEOL status overlapped THEOL sync')
    assert.equal(maxActiveAcademic, 2)
    assert.equal(maxActiveTheol, 1)

    releaseSyncs()
    await Promise.all([sync, status])
    assert.equal(theolStatusCalls, 1)
    assert.equal(maxActiveTheol, 1)
  } finally {
    releaseSyncs()
    await rm(root, { recursive: true, force: true })
  }
})

test('Course task waits for independently started platform syncs and remains THEOL-serial', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-independent-course-task-'))
  let releaseAcademic = () => {}
  let releaseTheol = () => {}
  let releaseAssignments = () => {}
  let service
  try {
    const store = new CampusStore(root)
    await store.load()
    let observeAcademicStart
    const academicStarted = new Promise((resolveStarted) => { observeAcademicStart = resolveStarted })
    const academicGate = new Promise((resolveGate) => { releaseAcademic = resolveGate })
    let observeTheolStart
    const theolStarted = new Promise((resolveStarted) => { observeTheolStart = resolveStarted })
    const theolGate = new Promise((resolveGate) => { releaseTheol = resolveGate })
    let observeAssignmentStart
    const assignmentStarted = new Promise((resolveStarted) => { observeAssignmentStart = resolveStarted })
    const assignmentGate = new Promise((resolveGate) => { releaseAssignments = resolveGate })
    let activeTheol = 0
    let maxActiveTheol = 0
    let assignmentsStarted = 0

    service = new SyncService({
      store,
      jwglxt: {
        async sync() {
          observeAcademicStart()
          await academicGate
          return { schedule: [], errors: [], source: { connected: true } }
        },
      },
      theol: {
        async sync() {
          activeTheol += 1
          maxActiveTheol = Math.max(maxActiveTheol, activeTheol)
          observeTheolStart()
          await theolGate
          activeTheol -= 1
          return {
            courses: [{ id: 'theol-course', title: 'THEOL course', source: 'theol' }],
            notices: [],
            errors: [],
            source: { connected: true },
          }
        },
        async syncAssignments() {
          activeTheol += 1
          maxActiveTheol = Math.max(maxActiveTheol, activeTheol)
          assignmentsStarted += 1
          observeAssignmentStart()
          await assignmentGate
          activeTheol -= 1
          return { assignments: [], errors: [], source: { connected: true } }
        },
      },
    })

    const academic = service.syncNow({ sources: ['jwglxt'] })
    const theol = service.syncNow({ sources: ['theol'] })
    await Promise.all([academicStarted, theolStarted])
    releaseTheol()
    await theol
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20))
    assert.equal(assignmentsStarted, 0, 'Course task started while academic sync was still active')

    releaseAcademic()
    await academic
    await assignmentStarted
    assert.equal(assignmentsStarted, 1)
    assert.equal(maxActiveTheol, 1)
    releaseAssignments()
    await service.waitForAssignmentScan()
  } finally {
    releaseAcademic()
    releaseTheol()
    releaseAssignments()
    service?.stop()
    await service?.waitForAssignmentScan().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

test('Course task starts after the batch final commit and keeps the batch run id', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-course-task-batch-run-'))
  let service
  try {
    const store = new CampusStore(root)
    await store.load()
    let completedRunId = null
    let assignmentRunId = null
    let observeAssignmentStart
    const assignmentStarted = new Promise((resolveStarted) => { observeAssignmentStart = resolveStarted })
    service = new SyncService({
      store,
      jwglxt: {
        async sync() {
          return { schedule: [], errors: [], source: { connected: true } }
        },
      },
      theol: {
        async sync() {
          return {
            courses: [{ id: 'theol-course', title: 'THEOL course', source: 'theol' }],
            notices: [],
            errors: [],
            source: { connected: true },
          }
        },
        async syncAssignments() {
          assignmentRunId = store.snapshot().sync.runId
          assert.equal(store.snapshot().sync.lastCompletedAt !== null, true)
          observeAssignmentStart()
          return { assignments: [], errors: [], source: { connected: true } }
        },
      },
      onChange: (state) => {
        if (state.sync.lastCompletedAt) completedRunId = state.sync.runId
      },
    })

    const finalSnapshot = await service.syncNow()
    await assignmentStarted
    await service.waitForAssignmentScan()
    assert.equal(finalSnapshot.sync.runId, completedRunId)
    assert.equal(assignmentRunId, completedRunId)
    assert.equal(store.snapshot().sync.domains.assignments.outcomes.theol.runId, completedRunId)
  } finally {
    service?.stop()
    await service?.waitForAssignmentScan().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

test('a source requested again after its active-run commit is queued for a fresh run', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-sync-queued-repeat-'))
  let releaseTheol = () => {}
  try {
    const store = new CampusStore(root)
    await store.load()
    let observeFirstAcademicCommit
    const firstAcademicCommitted = new Promise((resolveCommit) => { observeFirstAcademicCommit = resolveCommit })
    let firstAcademicCommitObserved = false
    const theolGate = new Promise((resolveGate) => { releaseTheol = resolveGate })
    let jwglxtCalls = 0
    let theolCalls = 0
    const service = new SyncService({
      store,
      jwglxt: {
        async sync() {
          jwglxtCalls += 1
          return {
            schedule: [{ id: `schedule-${jwglxtCalls}`, source: 'jwglxt', weekday: 1, period: '1-2' }],
            errors: [],
            source: { connected: true },
          }
        },
      },
      theol: {
        async sync() {
          theolCalls += 1
          await theolGate
          return { courses: [], notices: [], errors: [], source: { connected: true } }
        },
      },
      onChange: (state) => {
        if (!firstAcademicCommitObserved && state.schedule.some((item) => item.id === 'schedule-1')) {
          firstAcademicCommitObserved = true
          queueMicrotask(observeFirstAcademicCommit)
        }
      },
    })

    const fullRun = service.syncNow()
    await firstAcademicCommitted
    const repeatedAcademic = service.syncNow({ sources: ['jwglxt'] })
    const repeatDeadline = Date.now() + 500
    while (jwglxtCalls < 2 && Date.now() < repeatDeadline) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 5))
    }
    assert.equal(jwglxtCalls, 2, 'the repeated academic sync waited for the still-active THEOL source')
    await repeatedAcademic
    assert.deepEqual(store.snapshot().schedule.map((item) => item.id), ['schedule-2'])

    releaseTheol()
    await fullRun

    assert.equal(jwglxtCalls, 2)
    assert.equal(theolCalls, 1)
    assert.deepEqual(store.snapshot().schedule.map((item) => item.id), ['schedule-2'])
  } finally {
    releaseTheol()
    await rm(root, { recursive: true, force: true })
  }
})

test('disable invalidates an active run, blocks late commits and rejects new sync without network', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-sync-disable-'))
  let releaseSources = () => {}
  try {
    const store = new CampusStore(root)
    await store.load()
    const before = store.snapshot()
    let observeBothStarted
    const bothStarted = new Promise((resolveStarted) => { observeBothStarted = resolveStarted })
    const sourceGate = new Promise((resolveGate) => { releaseSources = resolveGate })
    let started = 0
    let networkCalls = 0
    let authCalls = 0
    let changes = 0
    const sourceResult = (id, source) => ({
      courses: [{ id, source }],
      notices: [],
      errors: [],
      source: { connected: true },
    })
    const waitForRelease = async () => {
      networkCalls += 1
      started += 1
      if (started === 2) observeBothStarted()
      await sourceGate
    }
    const service = new SyncService({
      store,
      jwglxt: {
        async sync() {
          await waitForRelease()
          return { ...sourceResult('late-jw', 'jwglxt'), schedule: [], grades: [], exams: [] }
        },
      },
      theol: {
        async sync() {
          await waitForRelease()
          return sourceResult('late-theol', 'theol')
        },
      },
      onAuthRequired: () => { authCalls += 1 },
      onChange: () => { changes += 1 },
    })

    const pending = service.syncNow()
    await bothStarted
    const stateAfterStart = store.snapshot()
    const stopping = service.stopAndWait()
    releaseSources()
    await stopping
    await assert.rejects(pending, { code: 'sync_cancelled' })
    assert.deepEqual(store.snapshot(), stateAfterStart)
    assert.equal(changes, 1, 'only the initial lastStartedAt snapshot may be published')
    assert.equal(authCalls, 0)
    assert.equal(service.assignmentRequestedRunId, null)

    await assert.rejects(service.syncNow(), { code: 'sync_disabled' })
    assert.equal(networkCalls, 2)

    service.enable()
    await service.syncNow({ sources: ['jwglxt'] })
    assert.equal(networkCalls, 3)
    assert.notDeepEqual(store.snapshot(), before)
  } finally {
    releaseSources()
    await rm(root, { recursive: true, force: true })
  }
})

test('disable cancels a THEOL sync queued behind an exclusive interaction before network starts', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-sync-disable-queued-theol-'))
  let releaseInteraction = () => {}
  try {
    const store = new CampusStore(root)
    await store.load()
    let observeInteractionStart
    const interactionStarted = new Promise((resolveStarted) => { observeInteractionStart = resolveStarted })
    const interactionGate = new Promise((resolveGate) => { releaseInteraction = resolveGate })
    let networkCalls = 0
    const service = new SyncService({
      store,
      jwglxt: {},
      theol: {
        async sync() {
          networkCalls += 1
          return { courses: [], notices: [], errors: [], source: { connected: true } }
        },
      },
    })

    const interaction = service.runTheolExclusive(async () => {
      observeInteractionStart()
      await interactionGate
    })
    await interactionStarted
    const pending = service.syncNow({ sources: ['theol'] })
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20))
    assert.equal(networkCalls, 0)

    const stopping = service.disableAndWait()
    releaseInteraction()
    await Promise.all([interaction, stopping])
    await assert.rejects(pending, { code: 'sync_cancelled' })
    assert.equal(networkCalls, 0)
  } finally {
    releaseInteraction()
    await rm(root, { recursive: true, force: true })
  }
})

test('platform fast sync overlaps academic sync and assignments start only after completion', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-background-assignments-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    await store.update((state) => ({
      ...state,
      assignments: [{ id: 'old-assignment', title: 'old', source: 'theol' }],
    }))

    let academicStarted = false
    let theolStarted = false
    let releaseSources
    const sourceGate = new Promise((resolveGate) => { releaseSources = resolveGate })
    let observeBothStarted
    const bothStarted = new Promise((resolveStarted) => { observeBothStarted = resolveStarted })
    const markStarted = () => {
      if (academicStarted && theolStarted) observeBothStarted()
    }
    let releaseAssignments
    const assignmentGate = new Promise((resolveGate) => { releaseAssignments = resolveGate })
    let observeAssignmentStart
    const assignmentStarted = new Promise((resolveStarted) => { observeAssignmentStart = resolveStarted })
    let observeAssignmentCommit
    const assignmentCommitted = new Promise((resolveCommit) => { observeAssignmentCommit = resolveCommit })
    let observeAssignmentDone
    const assignmentDone = new Promise((resolveDone) => { observeAssignmentDone = resolveDone })
    let activeTheol = 0
    let maxActiveTheol = 0
    const events = []

    const service = new SyncService({
      store,
      jwglxt: {
        async sync() {
          academicStarted = true
          events.push('academic-start')
          markStarted()
          await sourceGate
          return {
            schedule: [{ id: 'schedule-new', source: 'jwglxt' }],
            courses: [], grades: [], selectedCourses: [], exams: [], notices: [], errors: [],
            source: { connected: true },
          }
        },
        async status() { return { connected: true } },
      },
      theol: {
        async sync() {
          activeTheol += 1
          maxActiveTheol = Math.max(maxActiveTheol, activeTheol)
          theolStarted = true
          events.push('theol-home-start')
          markStarted()
          await sourceGate
          activeTheol -= 1
          return {
            courses: [{ id: 'theol-course', title: 'THEOL course', source: 'theol', sourceUrl: 'https://course.buct.edu.cn/meol/course?courseId=1' }],
            notices: [],
            domainOutcomes: {
              assignments: sourceDomainOutcome({ source: 'theol', attempted: false, status: 'not-attempted' }),
            },
            errors: [],
            source: { connected: true },
          }
        },
        async syncAssignments() {
          activeTheol += 1
          maxActiveTheol = Math.max(maxActiveTheol, activeTheol)
          events.push('assignments-start')
          observeAssignmentStart()
          await assignmentGate
          activeTheol -= 1
          return {
            assignments: [{ id: 'assignment-new', title: 'new', source: 'theol' }],
            errors: [],
            source: { connected: true },
          }
        },
        async status() { return { connected: true } },
      },
      onProgress: (event) => {
        if (event.stage === 'all' && ['done', 'error'].includes(event.status)) events.push('main-complete')
        if (event.stage === 'assignments' && event.status === 'syncing') events.push('assignments-syncing')
        if (event.stage === 'assignments' && event.status === 'done') {
          events.push('assignments-done')
          observeAssignmentDone()
        }
      },
      onChange: (state) => {
        if (state.assignments.some((item) => item.id === 'assignment-new')) observeAssignmentCommit()
      },
    })

    const pending = service.syncNow()
    await bothStarted
    assert.deepEqual(new Set(events.slice(0, 2)), new Set(['academic-start', 'theol-home-start']))
    releaseSources()
    const mainSnapshot = await pending
    assert.equal(mainSnapshot.assignments[0].id, 'old-assignment')
    assert.equal(mainSnapshot.sync.domains.assignments.outcomes.theol.status, 'not-attempted')

    await assignmentStarted
    assert.ok(events.indexOf('assignments-start') > events.indexOf('main-complete'))
    assert.equal(maxActiveTheol, 1)
    releaseAssignments()
    await assignmentCommitted
    await assignmentDone
    assert.ok(events.indexOf('assignments-syncing') > events.indexOf('main-complete'))
    assert.ok(events.indexOf('assignments-done') > events.indexOf('assignments-syncing'))
    assert.deepEqual(store.snapshot().assignments.map((item) => item.id), ['assignment-new'])
    assert.equal(store.snapshot().sync.domains.assignments.status, 'succeeded')
    assert.equal(store.snapshot().sync.lastCompletedAt, mainSnapshot.sync.lastCompletedAt)
    service.stop()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a THEOL course refresh schedules an assignment scan with the committed run id', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-course-refresh-assignments-'))
  let service
  try {
    const store = new CampusStore(root)
    await store.load()
    await store.update((state) => ({
      ...state,
      sync: { ...state.sync, runId: 'stable-run' },
    }))

    let assignmentStarted
    const assignmentStartedPromise = new Promise((resolveStarted) => { assignmentStarted = resolveStarted })
    service = new SyncService({
      store,
      jwglxt: {},
      theol: {
        async sync() {
          return {
            courses: [{
              id: 'theol-course',
              title: 'THEOL course',
              source: 'theol',
              sourceUrl: 'https://course.buct.edu.cn/meol/homepage/course/course_index.jsp?courseId=1',
            }],
            notices: [],
            errors: [],
            source: { connected: true },
          }
        },
        async syncAssignments() {
          assignmentStarted()
          return {
            assignments: [{ id: 'assignment-new', title: '当前作业', source: 'theol', courseId: 'theol-course' }],
            successfulCourseIds: ['theol-course'],
            failedCourseIds: [],
            errors: [],
            source: { connected: true },
          }
        },
      },
    })

    const mainSnapshot = await service.syncNow({
      sources: ['theol'],
      domains: ['courses'],
    })
    assert.deepEqual(mainSnapshot.assignments, [])
    await Promise.race([
      assignmentStartedPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('assignment scan did not start')), 1_000)),
    ])
    await service.waitForAssignmentScan()

    const finalSnapshot = store.snapshot()
    assert.deepEqual(finalSnapshot.assignments.map((item) => item.id), ['assignment-new'])
    assert.equal(finalSnapshot.sync.runId, 'stable-run')
    assert.equal(finalSnapshot.sync.domains.assignments.outcomes.theol.status, 'succeeded')
  } finally {
    service?.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('pausing an active assignment scan invalidates its late result', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-assignment-pause-'))
  let service
  let releaseScan = () => {}
  let activeScan
  try {
    const store = new CampusStore(root)
    await store.load()
    const runId = 'assignment-pause-run'
    await store.update((state) => ({
      ...state,
      courses: [{ id: 'theol-course', title: 'THEOL course', source: 'theol', sourceUrl: 'https://course.buct.edu.cn/meol/course?courseId=1' }],
      assignments: [{ id: 'assignment-current', title: 'current', source: 'theol' }],
      sync: {
        ...state.sync,
        runId,
        sources: { ...state.sync.sources, theol: { connected: true } },
      },
    }))
    const before = store.snapshot()
    let observeScanStart
    const scanStarted = new Promise((resolveStarted) => { observeScanStart = resolveStarted })
    const scanGate = new Promise((resolveGate) => { releaseScan = resolveGate })
    let changes = 0

    service = new SyncService({
      store,
      jwglxt: {},
      theol: {
        async syncAssignments() {
          observeScanStart()
          await scanGate
          return {
            assignments: [{ id: 'assignment-stale', title: 'stale', source: 'theol' }],
            errors: [],
            source: { connected: true },
          }
        },
      },
      onChange: () => { changes += 1 },
    })

    service.scheduleAssignmentScan(runId)
    await scanStarted
    activeScan = service.assignmentActive
    const resume = service.pauseAssignmentScan()
    releaseScan()
    await activeScan

    const after = store.snapshot()
    assert.deepEqual(after.assignments, before.assignments)
    assert.deepEqual(after.sync.domains, before.sync.domains)
    assert.deepEqual(after.sync.sources, before.sync.sources)
    assert.equal(changes, 0)
    resume()
  } finally {
    releaseScan()
    service?.stop()
    await activeScan?.catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

test('resuming while an invalidated assignment scan settles starts exactly one replacement scan', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-assignment-resume-'))
  let service
  let releaseFirst = () => {}
  let releaseSecond = () => {}
  let activeScan
  try {
    const store = new CampusStore(root)
    await store.load()
    const runId = 'assignment-resume-run'
    await store.update((state) => ({
      ...state,
      courses: [{ id: 'theol-course', title: 'THEOL course', source: 'theol', sourceUrl: 'https://course.buct.edu.cn/meol/course?courseId=1' }],
      assignments: [{ id: 'assignment-current', title: 'current', source: 'theol' }],
      sync: {
        ...state.sync,
        runId,
        sources: { ...state.sync.sources, theol: { connected: true } },
      },
    }))
    let observeFirstStart
    const firstStarted = new Promise((resolveStarted) => { observeFirstStart = resolveStarted })
    const firstGate = new Promise((resolveGate) => { releaseFirst = resolveGate })
    let observeSecondStart
    const secondStarted = new Promise((resolveStarted) => { observeSecondStart = resolveStarted })
    const secondGate = new Promise((resolveGate) => { releaseSecond = resolveGate })
    let scans = 0

    service = new SyncService({
      store,
      jwglxt: {},
      theol: {
        async syncAssignments() {
          scans += 1
          if (scans === 1) {
            observeFirstStart()
            await firstGate
            return {
              assignments: [{ id: 'assignment-stale', title: 'stale', source: 'theol' }],
              errors: [],
              source: { connected: true },
            }
          }
          observeSecondStart()
          await secondGate
          return {
            assignments: [{ id: 'assignment-fresh', title: 'fresh', source: 'theol' }],
            errors: [],
            source: { connected: true },
          }
        },
      },
    })

    service.scheduleAssignmentScan(runId)
    await firstStarted
    activeScan = service.assignmentActive
    const resume = service.pauseAssignmentScan()
    resume()

    // Let the zero-delay resume attempt run while the invalidated scan is still active.
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20))
    assert.equal(scans, 1)
    releaseFirst()
    await activeScan

    const deadline = Date.now() + 500
    while (scans < 2 && Date.now() < deadline) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 5))
    }
    assert.equal(scans, 2, 'the replacement scan was lost while the old scan was settling')
    await secondStarted
    activeScan = service.assignmentActive
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20))
    assert.equal(scans, 2)
    releaseSecond()
    await activeScan
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20))
    assert.equal(scans, 2)
    assert.deepEqual(store.snapshot().assignments.map((item) => item.id), ['assignment-fresh'])
  } finally {
    releaseFirst()
    releaseSecond()
    service?.stop()
    await activeScan?.catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

test('disabled assignment scans ignore old resumes until explicitly scheduled after enable', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-assignment-disable-'))
  let service
  let releaseFirst = () => {}
  let releaseSecond = () => {}
  let activeScan
  try {
    const store = new CampusStore(root)
    await store.load()
    const runId = 'assignment-disable-run'
    await store.update((state) => ({
      ...state,
      courses: [{ id: 'theol-course', title: 'THEOL course', source: 'theol', sourceUrl: 'https://course.buct.edu.cn/meol/course?courseId=1' }],
      assignments: [{ id: 'assignment-current', title: 'current', source: 'theol' }],
      sync: {
        ...state.sync,
        runId,
        sources: { ...state.sync.sources, theol: { connected: true } },
      },
    }))
    const before = store.snapshot()
    let observeFirstStart
    const firstStarted = new Promise((resolveStarted) => { observeFirstStart = resolveStarted })
    const firstGate = new Promise((resolveGate) => { releaseFirst = resolveGate })
    let observeSecondStart
    const secondStarted = new Promise((resolveStarted) => { observeSecondStart = resolveStarted })
    const secondGate = new Promise((resolveGate) => { releaseSecond = resolveGate })
    let scans = 0
    let changes = 0

    service = new SyncService({
      store,
      jwglxt: {},
      theol: {
        async syncAssignments() {
          scans += 1
          if (scans === 1) {
            observeFirstStart()
            await firstGate
            return {
              assignments: [{ id: 'assignment-stale', title: 'stale', source: 'theol' }],
              errors: [],
              source: { connected: true },
            }
          }
          observeSecondStart()
          await secondGate
          return {
            assignments: [{ id: 'assignment-fresh', title: 'fresh', source: 'theol' }],
            errors: [],
            source: { connected: true },
          }
        },
      },
      onChange: () => { changes += 1 },
    })

    service.scheduleAssignmentScan(runId)
    await firstStarted
    activeScan = service.assignmentActive
    const oldResume = service.pauseAssignmentScan()
    service.disableAssignmentScan()
    releaseFirst()
    await activeScan

    assert.deepEqual(store.snapshot().assignments, before.assignments)
    assert.deepEqual(store.snapshot().sync.domains, before.sync.domains)
    assert.equal(changes, 0)

    oldResume()
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20))
    assert.equal(scans, 1)

    service.enableAssignmentScan({ schedule: false })
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20))
    assert.equal(scans, 1)

    service.scheduleAssignmentScan(runId)
    const deadline = Date.now() + 500
    while (scans < 2 && Date.now() < deadline) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 5))
    }
    assert.equal(scans, 2)
    await secondStarted
    activeScan = service.assignmentActive
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20))
    assert.equal(scans, 2)
    releaseSecond()
    await activeScan
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20))
    assert.equal(scans, 2)
    assert.deepEqual(store.snapshot().assignments.map((item) => item.id), ['assignment-fresh'])
    assert.equal(changes, 1)
  } finally {
    releaseFirst()
    releaseSecond()
    service?.stop()
    await activeScan?.catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

test('partial assignment scans merge by id and retain assignments missing from the response', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-assignment-partial-'))
  let service
  let activeScan
  try {
    const store = new CampusStore(root)
    await store.load()
    const runId = 'assignment-partial-run'
    await store.update((state) => ({
      ...state,
      courses: [{ id: 'theol-course', title: 'THEOL course', source: 'theol', sourceUrl: 'https://course.buct.edu.cn/meol/course?courseId=1' }],
      assignments: [
        { id: 'assignment-shared', title: 'old title', courseName: 'Old course', source: 'theol' },
        { id: 'assignment-retained', title: 'retained', source: 'theol' },
        {
          id: 'assignment-old-list-link', title: '标题', source: 'theol',
          sourceUrl: 'https://course.buct.edu.cn/meol/common/hw/student/hwtask.jsp?s_order=title',
        },
        {
          id: 'assignment-legacy-task-id', title: 'legacy duplicate', source: 'theol',
          sourceUrl: 'https://course.buct.edu.cn/meol/common/hw/student/hwtask.view.jsp?hwtid=42',
        },
      ],
      sync: {
        ...state.sync,
        runId,
        sources: { ...state.sync.sources, theol: { connected: true } },
      },
    }))
    let observeScanStart
    const scanStarted = new Promise((resolveStarted) => { observeScanStart = resolveStarted })

    service = new SyncService({
      store,
      jwglxt: {},
      theol: {
        async syncAssignments() {
          observeScanStart()
          return {
            assignments: [
              { id: 'assignment-shared', title: 'updated title', source: 'theol' },
              {
                id: 'assignment-new', title: 'new', source: 'theol',
                sourceUrl: 'https://course.buct.edu.cn/meol/common/hw/student/hwtask.view.jsp?hwtid=42',
              },
            ],
            capturedAt: '2026-08-13T01:00:00.000Z',
            parserVersion: 'theol-adapter/1',
            domainOutcomes: {
              assignments: sourceDomainOutcome({
                source: 'theol',
                attempted: true,
                succeeded: true,
                status: 'succeeded',
                capturedAt: '2026-08-13T01:00:00.000Z',
                completeness: 'partial',
                parserVersion: 'theol-adapter/1',
                errorCode: 'partial_assignment_scan',
              }),
            },
            errors: ['one course could not be scanned'],
            source: { connected: true },
          }
        },
      },
    })

    service.scheduleAssignmentScan(runId)
    await scanStarted
    activeScan = service.assignmentActive
    await activeScan

    const state = store.snapshot()
    assert.deepEqual(state.assignments.map((item) => item.id), [
      'assignment-shared',
      'assignment-retained',
      'assignment-new',
    ])
    assert.deepEqual(state.assignments.find((item) => item.id === 'assignment-shared'), {
      id: 'assignment-shared',
      title: 'updated title',
      courseName: 'Old course',
      source: 'theol',
    })
    const provenance = state.sync.domains.assignments
    assert.equal(provenance.status, 'succeeded')
    assert.equal(provenance.completeness, 'partial')
    assert.equal(provenance.retainedPrevious, true)
    assert.equal(provenance.emptyConfirmed, false)
    assert.equal(provenance.outcomes.theol.completeness, 'partial')
    assert.equal(provenance.outcomes.theol.retainedPrevious, true)
    assert.equal(provenance.outcomes.theol.errorCode, 'partial_assignment_scan')
  } finally {
    service?.stop()
    await activeScan?.catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

test('partial assignment scans do not claim retained history when fresh results replace every retainable task', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-assignment-partial-replaced-'))
  let service
  let activeScan
  try {
    const store = new CampusStore(root)
    await store.load()
    const runId = 'assignment-partial-replaced-run'
    await store.update((state) => ({
      ...state,
      courses: [{ id: 'theol-course', title: 'THEOL course', source: 'theol', sourceUrl: 'https://course.buct.edu.cn/meol/course?courseId=1' }],
      assignments: [{
        id: 'assignment-shared', title: 'old title', source: 'theol',
        sourceUrl: 'https://course.buct.edu.cn/meol/common/hw/student/hwtask.view.jsp?hwtid=42',
      }],
      sync: {
        ...state.sync,
        runId,
        sources: { ...state.sync.sources, theol: { connected: true } },
      },
    }))

    service = new SyncService({
      store,
      jwglxt: {},
      theol: {
        async syncAssignments() {
          return {
            assignments: [{
              id: 'assignment-shared', title: 'fresh title', source: 'theol',
              sourceUrl: 'https://course.buct.edu.cn/meol/common/hw/student/hwtask.view.jsp?hwtid=42',
            }],
            capturedAt: '2026-08-13T01:30:00.000Z',
            parserVersion: 'theol-adapter/1',
            domainOutcomes: {
              assignments: sourceDomainOutcome({
                source: 'theol',
                attempted: true,
                succeeded: true,
                status: 'succeeded',
                capturedAt: '2026-08-13T01:30:00.000Z',
                completeness: 'partial',
                parserVersion: 'theol-adapter/1',
                errorCode: 'partial_assignment_scan',
              }),
            },
            errors: ['another course could not be scanned'],
            source: { connected: true },
          }
        },
      },
    })

    service.scheduleAssignmentScan(runId)
    const deadline = Date.now() + 500
    while (!service.assignmentActive && Date.now() < deadline) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 5))
    }
    assert.ok(service.assignmentActive)
    activeScan = service.assignmentActive
    await activeScan

    const state = store.snapshot()
    assert.deepEqual(state.assignments.map((item) => [item.id, item.title]), [
      ['assignment-shared', 'fresh title'],
    ])
    assert.equal(state.sync.domains.assignments.retainedPrevious, false)
    assert.equal(state.sync.domains.assignments.outcomes.theol.retainedPrevious, false)
  } finally {
    service?.stop()
    await activeScan?.catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

test('partial assignment scans replace history for successful courses and retain only failed courses', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-assignment-course-partial-'))
  let service
  let activeScan
  try {
    const store = new CampusStore(root)
    await store.load()
    const runId = 'assignment-course-partial-run'
    await store.update((state) => ({
      ...state,
      courses: [
        { id: 'course-success', title: 'Successful course', source: 'theol', sourceUrl: 'https://course.buct.edu.cn/meol/course?courseId=course-success' },
        { id: 'course-failed', title: 'Failed course', source: 'theol', sourceUrl: 'https://course.buct.edu.cn/meol/course?courseId=course-failed' },
      ],
      assignments: [
        {
          id: 'assignment-expired-success', courseId: 'course-success', title: 'replace me', source: 'theol',
          sourceUrl: 'https://course.buct.edu.cn/meol/common/hw/student/hwtask.view.jsp?hwtid=71',
        },
        {
          id: 'assignment-retained-failure', courseId: 'course-failed', title: 'retain me', source: 'theol',
          sourceUrl: 'https://course.buct.edu.cn/meol/common/hw/student/hwtask.view.jsp?hwtid=72',
        },
      ],
      sync: {
        ...state.sync,
        runId,
        sources: { ...state.sync.sources, theol: { connected: true } },
      },
    }))

    service = new SyncService({
      store,
      jwglxt: {},
      theol: {
        async syncAssignments() {
          return {
            assignments: [],
            successfulCourseIds: ['course-success'],
            failedCourseIds: ['course-failed'],
            capturedAt: '2026-08-13T01:45:00.000Z',
            parserVersion: 'theol-adapter/1',
            domainOutcomes: {
              assignments: sourceDomainOutcome({
                source: 'theol', attempted: true, succeeded: true, status: 'succeeded',
                capturedAt: '2026-08-13T01:45:00.000Z', completeness: 'partial',
                parserVersion: 'theol-adapter/1', errorCode: 'partial_assignment_scan',
              }),
            },
            errors: ['failed course could not be scanned'],
            source: { connected: true },
          }
        },
      },
    })

    service.scheduleAssignmentScan(runId)
    const deadline = Date.now() + 500
    while (!service.assignmentActive && Date.now() < deadline) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 5))
    }
    assert.ok(service.assignmentActive)
    activeScan = service.assignmentActive
    await activeScan

    const state = store.snapshot()
    assert.deepEqual(state.assignments.map((item) => item.id), ['assignment-retained-failure'])
    assert.equal(state.sync.domains.assignments.retainedPrevious, true)
    assert.equal(state.sync.domains.assignments.outcomes.theol.retainedPrevious, true)
    assert.equal(state.sync.sources.theol.assignmentScan.successfulCourseCount, 1)
    assert.equal(state.sync.sources.theol.assignmentScan.failedCourseCount, 1)
  } finally {
    service?.stop()
    await activeScan?.catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

test('only a complete confirmed-empty assignment scan clears previous assignments', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-assignment-empty-'))
  let service
  let activeScan
  try {
    const store = new CampusStore(root)
    await store.load()
    const runId = 'assignment-empty-run'
    await store.update((state) => ({
      ...state,
      courses: [{ id: 'theol-course', title: 'THEOL course', source: 'theol', sourceUrl: 'https://course.buct.edu.cn/meol/course?courseId=1' }],
      assignments: [{ id: 'assignment-old', title: 'old', source: 'theol' }],
      sync: {
        ...state.sync,
        runId,
        sources: { ...state.sync.sources, theol: { connected: true } },
      },
    }))
    let observeScanStart
    const scanStarted = new Promise((resolveStarted) => { observeScanStart = resolveStarted })

    service = new SyncService({
      store,
      jwglxt: {},
      theol: {
        async syncAssignments() {
          observeScanStart()
          return {
            assignments: [],
            capturedAt: '2026-08-13T02:00:00.000Z',
            parserVersion: 'theol-adapter/1',
            domainOutcomes: {
              assignments: sourceDomainOutcome({
                source: 'theol',
                attempted: true,
                succeeded: true,
                status: 'succeeded',
                capturedAt: '2026-08-13T02:00:00.000Z',
                emptyConfirmed: true,
                completeness: 'complete',
                parserVersion: 'theol-adapter/1',
              }),
            },
            errors: [],
            source: { connected: true },
          }
        },
      },
    })

    service.scheduleAssignmentScan(runId)
    await scanStarted
    activeScan = service.assignmentActive
    await activeScan

    const state = store.snapshot()
    assert.deepEqual(state.assignments, [])
    const provenance = state.sync.domains.assignments
    assert.equal(provenance.status, 'succeeded')
    assert.equal(provenance.completeness, 'complete')
    assert.equal(provenance.emptyConfirmed, true)
    assert.equal(provenance.contentEmptyConfirmed, true)
    assert.equal(provenance.retainedPrevious, false)
    assert.equal(provenance.outcomes.theol.completeness, 'complete')
    assert.equal(provenance.outcomes.theol.emptyConfirmed, true)
    assert.equal(provenance.outcomes.theol.retainedPrevious, false)
  } finally {
    service?.stop()
    await activeScan?.catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

test('a contradictory complete but unconfirmed empty assignment scan retains previous assignments', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-assignment-unconfirmed-empty-'))
  let service
  let activeScan
  try {
    const store = new CampusStore(root)
    await store.load()
    const runId = 'assignment-unconfirmed-empty-run'
    await store.update((state) => ({
      ...state,
      courses: [{ id: 'theol-course', title: 'THEOL course', source: 'theol', sourceUrl: 'https://course.buct.edu.cn/meol/course?courseId=1' }],
      assignments: [{ id: 'assignment-old', title: 'old', source: 'theol' }],
      sync: {
        ...state.sync,
        runId,
        sources: { ...state.sync.sources, theol: { connected: true } },
      },
    }))

    service = new SyncService({
      store,
      jwglxt: {},
      theol: {
        async syncAssignments() {
          return {
            assignments: [],
            capturedAt: '2026-08-13T03:00:00.000Z',
            parserVersion: 'future-adapter/1',
            domainOutcomes: {
              assignments: sourceDomainOutcome({
                source: 'theol',
                attempted: true,
                succeeded: true,
                status: 'succeeded',
                capturedAt: '2026-08-13T03:00:00.000Z',
                emptyConfirmed: false,
                completeness: 'complete',
                parserVersion: 'future-adapter/1',
              }),
            },
            errors: [],
            source: { connected: true },
          }
        },
      },
    })

    service.scheduleAssignmentScan(runId)
    const deadline = Date.now() + 500
    while (!service.assignmentActive && Date.now() < deadline) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 5))
    }
    assert.ok(service.assignmentActive)
    activeScan = service.assignmentActive
    await activeScan

    assert.deepEqual(store.snapshot().assignments.map((item) => item.id), ['assignment-old'])
    const outcome = store.snapshot().sync.domains.assignments.outcomes.theol
    assert.equal(outcome.emptyConfirmed, false)
    assert.equal(outcome.completeness, 'partial')
    assert.equal(outcome.retainedPrevious, true)
    assert.equal(outcome.errorCode, 'unconfirmed_empty_result')
  } finally {
    service?.stop()
    await activeScan?.catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

test('assignment retry reuses the THEOL scan without starting either platform sync', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-assignment-domain-retry-'))
  let service
  try {
    const store = new CampusStore(root)
    await store.load()
    await store.update((state) => ({
      ...state,
      courses: [{ id: 'course-1', title: 'THEOL course', source: 'theol', sourceUrl: 'https://course.buct.edu.cn/meol/course?courseId=1' }],
    }))
    let jwglxtSyncs = 0
    let theolSyncs = 0
    let assignmentScans = 0
    service = new SyncService({
      store,
      jwglxt: { async sync() { jwglxtSyncs += 1 } },
      theol: {
        async sync() { theolSyncs += 1 },
        async syncAssignments(courses) {
          assignmentScans += 1
          assert.deepEqual(courses.map((course) => course.id), ['course-1'])
          return {
            assignments: [{ id: 'assignment-1', title: 'Task', source: 'theol', courseId: 'course-1' }],
            successfulCourseIds: ['course-1'],
            failedCourseIds: [],
            domainOutcomes: {
              assignments: sourceDomainOutcome({
                source: 'theol', attempted: true, succeeded: true, status: 'succeeded',
                capturedAt: '2026-08-14T02:00:00.000Z', completeness: 'complete', parserVersion: 'theol-adapter/1',
              }),
            },
            errors: [],
            source: { connected: true },
          }
        },
      },
    })

    const state = await service.retryAssignments()
    assert.equal(jwglxtSyncs, 0)
    assert.equal(theolSyncs, 0)
    assert.equal(assignmentScans, 1)
    assert.deepEqual(state.assignments.map((item) => item.id), ['assignment-1'])
    assert.equal(state.sync.domains.assignments.outcomes.theol.status, 'succeeded')
  } finally {
    service?.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('assignment scans commit each course before the full scan settles', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-assignment-incremental-'))
  let service
  let releaseScan
  try {
    const store = new CampusStore(root)
    await store.load()
    await store.update((state) => ({
      ...state,
      courses: [
        { id: 'course-1', title: 'THEOL course', source: 'theol', sourceUrl: 'https://course.buct.edu.cn/meol/course?courseId=1' },
      ],
    }))
    const partialCommitted = new Promise((resolveCommit) => {
      const observeCommit = () => resolveCommit()
      releaseScan = null
      service = new SyncService({
        store,
        jwglxt: { async sync() {} },
        theol: {
          async sync() {},
          async syncAssignments(_courses, options) {
            await options.onCourseResult({
              courseId: 'course-1',
              assignments: [{ id: 'assignment-early', title: '先到的作业', source: 'theol', courseId: 'course-1' }],
              complete: true,
            })
            observeCommit()
            await new Promise((resolveGate) => { releaseScan = resolveGate })
            return {
              assignments: [{ id: 'assignment-early', title: '先到的作业', source: 'theol', courseId: 'course-1' }],
              successfulCourseIds: ['course-1'], failedCourseIds: [], errors: [], source: { connected: true },
            }
          },
        },
      })
    })

    const pending = service.retryAssignments()
    await partialCommitted
    assert.equal(store.snapshot().assignments.some((item) => item.id === 'assignment-early'), true)
    releaseScan()
    await pending
  } finally {
    service?.stop()
    releaseScan?.()
    await rm(root, { recursive: true, force: true })
  }
})

test('one failed source commit does not poison later source commits', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-commit-resilience-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    const originalUpdate = store.update.bind(store)
    let updateCalls = 0
    // Fail the first source commit (update #2: after the initial
    // lastStartedAt write) so only one source's commit rejects.
    store.update = async (fn) => {
      updateCalls += 1
      if (updateCalls === 2) throw new Error('injected storage failure')
      return originalUpdate(fn)
    }
    const service = new SyncService({
      store,
      jwglxt: {
        async sync() {
          return {
            courses: [{ id: 'jw-1', title: '教务课程', source: 'jwglxt' }],
            schedule: [], exams: [], grades: [], selectedCourses: [], notices: [],
            errors: [], source: { connected: true },
          }
        },
        async status() { return { connected: true } },
      },
      theol: {
        async sync() {
          return {
            assignments: [{
              id: 'th-1', title: '作业 1', courseName: 'THEOL 课程', status: 'pending',
              dueAt: '2026-09-01T00:00:00.000Z', capturedAt: new Date().toISOString(), source: 'theol',
            }],
            courses: [], notices: [], errors: [], source: { connected: true },
          }
        },
        async status() { return { connected: true } },
      },
    })
    await assert.rejects(service.syncNow(), /injected storage failure/u)
    // The second source's commit still ran even though the first failed:
    // a rejected commit must not poison the shared commit chain.
    const snapshot = store.snapshot()
    assert.equal(snapshot.assignments.some((item) => item.id === 'th-1'), true,
      'theol assignments must survive a jwglxt commit failure')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

