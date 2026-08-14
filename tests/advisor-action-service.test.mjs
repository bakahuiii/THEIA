import test from 'node:test'
import assert from 'node:assert/strict'
import { createAdvisorOverview } from '../core/advisor/index.mjs'
import {
  ADVISOR_ACTION_ERROR,
  assertAdvisorSnapshotRevision,
  resolveAdvisorActionFromStore,
} from '../electron/advisor-action-service.mjs'
import { CURRENT_CAPTURE, FIXED_NOW, domainOutcome, versionedState } from './fixtures/advisor-fixtures.mjs'

function storeFor(versioned, onRead = () => {}) {
  return {
    snapshotWithRevision() {
      onRead()
      return structuredClone(versioned)
    },
  }
}

test('advisor snapshot assertion rechecks the live store and exposes a controlled stale code', () => {
  const current = versionedWithAssignment()
  const stale = { ...current, revision: 'newer-revision' }
  let reads = 0
  const store = {
    snapshotWithRevision() {
      reads += 1
      return reads === 1 ? current : stale
    },
  }

  assert.equal(assertAdvisorSnapshotRevision(store, current.revision).revision, current.revision)
  assert.throws(
    () => assertAdvisorSnapshotRevision(store, current.revision),
    (error) => error?.code === ADVISOR_ACTION_ERROR.STALE_SNAPSHOT,
  )
  assert.equal(reads, 2)
})

function assignmentFixture(overrides = {}) {
  return {
    id: 'raw-task-1',
    title: '待确认截止时间的作业',
    courseId: 'course-1',
    dueAt: null,
    status: 'pending',
    capturedAt: CURRENT_CAPTURE,
    source: 'theol',
    sourceUrl: 'https://course.buct.edu.cn/meol/hw/stu/hwtask.view.jsp?hwtid=1',
    courseSourceUrl: 'https://course.buct.edu.cn/meol/welcomepage/student/course_info.jsp?courseId=course-1',
    ...overrides,
  }
}

function versionedWithAssignment(assignment = assignmentFixture()) {
  return versionedState({ assignments: [assignment] }, {
    assignments: domainOutcome({ source: ['theol'] }),
    exams: domainOutcome({ emptyConfirmed: true, contentEmptyConfirmed: true }),
    grades: domainOutcome({ emptyConfirmed: true, contentEmptyConfirmed: true }),
    'academic-progress': domainOutcome({ emptyConfirmed: true, contentEmptyConfirmed: true }),
  })
}

function assignmentAction(versioned) {
  const overview = createAdvisorOverview(versioned, { now: FIXED_NOW, timeZone: 'Asia/Shanghai' })
  return overview.urgentItems.find((item) => (
    item.actionKind === 'open-source-detail' && item.domain === 'assignments'
  ))
}

test('advisor action resolution accepts a current opaque action and resolves the raw assignment privately', () => {
  const versioned = versionedWithAssignment()
  const action = assignmentAction(versioned)
  assert.ok(action)
  assert.notEqual(action.entityId, 'raw-task-1')

  let reads = 0
  const result = resolveAdvisorActionFromStore(storeFor(versioned, () => { reads += 1 }), {
    snapshotRevision: versioned.revision,
    actionId: action.id,
  }, { clock: () => FIXED_NOW })

  assert.equal(reads, 1)
  assert.deepEqual(result, {
    ok: true,
    snapshotRevision: versioned.revision,
    actionId: action.id,
    target: { kind: 'open-assignment-source', assignmentId: 'raw-task-1' },
  })
})

test('advisor action resolution fails closed for stale and forged actions', () => {
  const versioned = versionedWithAssignment()
  const action = assignmentAction(versioned)
  assert.ok(action)

  const stale = resolveAdvisorActionFromStore(storeFor(versioned), {
    snapshotRevision: 'older-revision',
    actionId: action.id,
  }, { clock: () => FIXED_NOW })
  assert.equal(stale.ok, false)
  assert.equal(stale.error.code, ADVISOR_ACTION_ERROR.STALE_SNAPSHOT)

  const forged = resolveAdvisorActionFromStore(storeFor(versioned), {
    snapshotRevision: versioned.revision,
    actionId: 'action1:open-source-detail:forged',
  }, { clock: () => FIXED_NOW })
  assert.equal(forged.ok, false)
  assert.equal(forged.error.code, ADVISOR_ACTION_ERROR.ACTION_NOT_FOUND)
})

test('advisor action resolution rejects valid actions outside the fixed allowlist', () => {
  const versioned = versionedWithAssignment(assignmentFixture({ dueAt: '2026-08-13T05:00:00.000Z' }))
  const overview = createAdvisorOverview(versioned, { now: FIXED_NOW, timeZone: 'Asia/Shanghai' })
  const action = overview.urgentItems.find((item) => item.actionKind !== 'open-source-detail')
  assert.ok(action)

  const result = resolveAdvisorActionFromStore(storeFor(versioned), {
    snapshotRevision: versioned.revision,
    actionId: action.id,
  }, { clock: () => FIXED_NOW })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, ADVISOR_ACTION_ERROR.ACTION_NOT_ALLOWED)
})

test('advisor action resolution wraps unexpected overview failures without leaking them across IPC', () => {
  const versioned = versionedWithAssignment()
  const result = resolveAdvisorActionFromStore(storeFor(versioned), {
    snapshotRevision: versioned.revision,
    actionId: 'action1:open-source-detail:opaque',
  }, {
    clock: () => FIXED_NOW,
    createOverview() {
      throw new Error('private resolver detail')
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.actionId, 'action1:open-source-detail:opaque')
  assert.equal(result.error.code, ADVISOR_ACTION_ERROR.RESOLUTION_FAILED)
  assert.equal(result.error.retryable, true)
  assert.doesNotMatch(result.error.message, /private resolver detail/)
})
