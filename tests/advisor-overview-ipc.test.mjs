import test from 'node:test'
import assert from 'node:assert/strict'
import { advisorOverviewFromStore, ADVISOR_TIME_ZONE } from '../electron/advisor-overview-service.mjs'
import { FIXED_NOW, CURRENT_CAPTURE, domainOutcome, versionedState } from './fixtures/advisor-fixtures.mjs'

test('advisor IPC service takes one atomic snapshot and one time sample in Asia/Shanghai', () => {
  const versioned = versionedState({
    assignments: [{
      id: 'task-1',
      title: 'Task',
      dueAt: '2026-08-13T05:00:00.000Z',
      status: 'pending',
      capturedAt: CURRENT_CAPTURE,
      source: 'theol',
    }],
  }, {
    assignments: domainOutcome({ source: ['theol'] }),
    exams: domainOutcome({ emptyConfirmed: true }),
    grades: domainOutcome({ emptyConfirmed: true }),
    'academic-progress': domainOutcome({ emptyConfirmed: true }),
  })
  let snapshots = 0
  let clocks = 0
  const overview = advisorOverviewFromStore({
    snapshotWithRevision() {
      snapshots += 1
      return versioned
    },
  }, {
    clock() {
      clocks += 1
      return FIXED_NOW
    },
  })

  assert.equal(snapshots, 1)
  assert.equal(clocks, 1)
  assert.equal(overview.snapshotRevision, versioned.revision)
  assert.equal(overview.dataQuality.snapshotRevision, versioned.revision)
  assert.equal(overview.evaluatedAt, FIXED_NOW)
  assert.equal(overview.timeZone, ADVISOR_TIME_ZONE)
  assert.equal(overview.dataQuality.timeZone, ADVISOR_TIME_ZONE)
})

