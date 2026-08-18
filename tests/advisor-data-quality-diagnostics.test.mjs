import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeState } from '../core/schema.mjs'
import { computeDomainDigests, sourceDomainOutcome, withDomainProvenance } from '../core/domain-provenance.mjs'
import { evaluateDataQuality } from '../core/advisor/data-quality.mjs'

test('domain outcomes keep omitted record counts unknown instead of turning null into zero', () => {
  const outcome = sourceDomainOutcome({ source: 'jwglxt', attempted: false, status: 'not-attempted' })
  assert.equal(outcome.receivedRecordCount, null)
  assert.equal(outcome.previousRecordCount, null)
})

test('data-quality diagnostics preserve source-level retained and partial-result facts', () => {
  const base = normalizeState({
    schedule: [{ id: 'retained-schedule', title: '保留课表', weekday: 1, period: '1-2' }],
    sync: { domains: {} },
  })
  const state = withDomainProvenance(base, {
    jwglxt: {
      schedule: sourceDomainOutcome({
        source: 'jwglxt',
        runId: 'diagnostic-run',
        attempted: true,
        succeeded: true,
        status: 'succeeded',
        attemptedAt: '2026-08-15T01:00:00.000Z',
        completedAt: '2026-08-15T01:01:00.000Z',
        capturedAt: '2026-08-15T01:01:00.000Z',
        completeness: 'partial',
        retainedPrevious: true,
        errorCode: 'schedule_payload_unpositioned',
        previousRecordCount: 1,
        receivedRecordCount: 0,
        successfulTermIds: ['2025-2026-1'],
        failedTermIds: ['2025-2026-2'],
      }),
    },
  }, { runId: 'diagnostic-run' })
  const result = evaluateDataQuality({
    snapshot: state,
    revision: 'diagnostic-revision',
    committedAt: '2026-08-15T01:01:00.000Z',
    domainDigests: computeDomainDigests(state),
  }, { now: '2026-08-15T01:02:00.000Z', timeZone: 'Asia/Shanghai' })

  const schedule = result.domains.schedule
  assert.equal(schedule.lastAttempt.retainedPrevious, true)
  assert.equal(schedule.sourceAttempts.length, 1)
  assert.deepEqual(schedule.sourceAttempts[0], {
    source: ['jwglxt'],
    attemptedAt: '2026-08-15T01:00:00.000Z',
    completedAt: '2026-08-15T01:01:00.000Z',
    capturedAt: '2026-08-15T01:01:00.000Z',
    sourceSucceededAt: null,
    status: 'succeeded',
    completeness: 'partial',
    retainedPrevious: true,
    errorCode: 'schedule_payload_unpositioned',
    parserVersion: null,
    receivedRecordCount: 0,
    previousRecordCount: 1,
    successfulTermIds: ['2025-2026-1'],
    failedTermIds: ['2025-2026-2'],
  })
})
