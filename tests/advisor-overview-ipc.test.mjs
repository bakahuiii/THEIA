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
  assert.equal(overview.academic.analysis.upgrade.status, 'not-configured')
})

test('advisor IPC service accepts only an explicit versioned upgrade rule and preserves the frozen snapshot revision', () => {
  const versioned = versionedState({
    academicProgress: {
      roots: [{
        id: 'required',
        title: 'Required credits',
        relation: 'and',
        required: 40,
        earned: 26,
        remaining: 14,
        children: [],
      }],
      categories: [],
    },
  }, {
    assignments: domainOutcome({ emptyConfirmed: true }),
    exams: domainOutcome({ emptyConfirmed: true }),
    grades: domainOutcome({ emptyConfirmed: true }),
    'academic-progress': domainOutcome({ source: ['jwglxt'] }),
  })
  const upgradeRule = Object.freeze({
    id: 'year-two-credit-line',
    rulesVersion: 'local-config/2026-08-14/v1',
    sourceKind: 'configuration',
    sourceLabel: 'Versioned local configuration',
    thresholdCredits: 30,
    requirementIds: Object.freeze(['required']),
  })
  Object.freeze(versioned.state.academicProgress.roots[0])
  Object.freeze(versioned.state.academicProgress.roots)
  Object.freeze(versioned.state.academicProgress.categories)
  Object.freeze(versioned.state.academicProgress)
  Object.freeze(versioned.state)
  Object.freeze(versioned.domainDigests)
  Object.freeze(versioned)
  let snapshots = 0
  const overview = advisorOverviewFromStore({
    snapshotWithRevision() {
      snapshots += 1
      return versioned
    },
  }, {
    clock: () => FIXED_NOW,
    upgradeRule,
  })

  assert.equal(snapshots, 1)
  assert.equal(overview.snapshotRevision, versioned.revision)
  assert.equal(overview.academic.snapshotRevision, versioned.revision)
  assert.equal(overview.academic.analysis.upgrade.status, 'known')
  assert.equal(overview.academic.analysis.upgrade.rule.rulesVersion, upgradeRule.rulesVersion)
  assert.equal(overview.academic.analysis.upgrade.rule.sourceLabel, upgradeRule.sourceLabel)
  assert.equal(overview.academic.analysis.upgrade.distance, '4.0000')
  assert.deepEqual(upgradeRule.requirementIds, ['required'])
})
