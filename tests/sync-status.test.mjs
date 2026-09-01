import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createSyncFailureObserver,
  describeSyncFreshness,
  sanitizeSyncFailure,
  syncStartedDuringRenderer,
} from '../src/hooks/sync-status.mjs'

test('stale persisted sync runs do not appear active in a new renderer', () => {
  const rendererStartedAt = Date.parse('2026-09-01T04:00:00.000Z')
  assert.equal(syncStartedDuringRenderer({ lastStartedAt: '2026-09-01T03:59:58.000Z' }, rendererStartedAt), true)
  assert.equal(syncStartedDuringRenderer({ lastStartedAt: '2026-09-01T03:55:35.000Z' }, rendererStartedAt), false)
  assert.equal(syncStartedDuringRenderer({ lastStartedAt: '2026-09-01T03:55:35.000Z' }, rendererStartedAt, 300_000), true)
})

test('sync failure observer ignores startup history and reports each failed run once', () => {
  const reports = []
  const observer = createSyncFailureObserver({ report: (error, meta) => reports.push({ error, meta }) })
  observer.initialize({
    sync: {
      lastRunAt: '2026-08-12T01:00:00.000Z',
      lastError: 'historical failure',
      runId: 'old-run',
    },
  })
  assert.equal(reports.length, 0)

  const failed = {
    sync: {
      lastRunAt: '2026-08-12T02:00:00.000Z',
      lastError: 'new failure',
      runId: 'new-run',
    },
  }
  observer.observe(failed)
  observer.observe(failed)
  assert.equal(reports.length, 1)
  assert.equal(reports[0].error, 'new failure')
})

test('sync failure observer clears an open failure after a later successful run', () => {
  const reports = []
  const recoveries = []
  const observer = createSyncFailureObserver({
    report: (error) => reports.push(error),
    recover: (value) => recoveries.push(value),
  })
  observer.initialize({ sync: {} })
  observer.observe({
    sync: {
      lastRunAt: '2026-08-12T02:00:00.000Z',
      lastError: 'failed',
      runId: 'failed-run',
    },
  })
  observer.observe({
    sync: {
      lastRunAt: '2026-08-12T03:00:00.000Z',
      lastSuccessAt: '2026-08-12T03:00:00.000Z',
      lastError: null,
      runId: 'successful-run',
    },
  })
  assert.deepEqual(reports, ['failed'])
  assert.deepEqual(recoveries, [{ lastSuccessAt: '2026-08-12T03:00:00.000Z' }])
})

test('sync failure observer shares deduplication between a thrown error and a snapshot', () => {
  const reports = []
  const observer = createSyncFailureObserver({ report: (error, meta) => reports.push({ error, meta }) })
  observer.initialize({ sync: {} })

  observer.reportThrown('request failed')
  observer.observe({
    sync: { lastRunAt: '2026-08-12T02:00:00.000Z', lastError: 'request failed', runId: 'run-1' },
  })
  assert.equal(reports.length, 1)

  observer.reportThrown('different failure')
  assert.equal(reports.length, 2)
})

test('sync failure observer permits the same error again after success clears the active signature', () => {
  const reports = []
  const observer = createSyncFailureObserver({ report: (error) => reports.push(error) })
  observer.initialize({ sync: {} })
  observer.observe({
    sync: { lastRunAt: '2026-08-12T02:00:00.000Z', lastError: 'same failure', runId: 'run-1' },
  })
  observer.observe({
    sync: { lastRunAt: '2026-08-12T03:00:00.000Z', lastSuccessAt: '2026-08-12T03:00:00.000Z', lastError: null, runId: 'run-2' },
  })
  observer.observe({
    sync: { lastRunAt: '2026-08-12T04:00:00.000Z', lastError: 'same failure', runId: 'run-3' },
  })
  assert.deepEqual(reports, ['same failure', 'same failure'])
})

test('sync failure observer reports the same error once in each distinct run', () => {
  const reports = []
  const observer = createSyncFailureObserver({ report: (error) => reports.push(error) })
  observer.initialize({ sync: {} })
  observer.observe({
    sync: { lastRunAt: '2026-08-12T02:00:00.000Z', lastError: 'same failure', runId: 'run-1' },
  })
  observer.observe({
    sync: { lastRunAt: '2026-08-12T03:00:00.000Z', lastError: 'same failure', runId: 'run-2' },
  })
  assert.deepEqual(reports, ['same failure', 'same failure'])
})

test('sync failure observer scopes thrown-error deduplication to each explicit attempt', () => {
  const reports = []
  const observer = createSyncFailureObserver({ report: (error) => reports.push(error) })
  observer.initialize({
    sync: {
      runId: 'last-persisted-run',
      lastRunAt: '2026-08-12T02:00:00.000Z',
      lastError: null,
    },
  })

  observer.beginAttempt()
  observer.reportThrown('store write failed')
  observer.reportThrown('store write failed')

  // A persistence failure can prevent a new snapshot and runId from arriving.
  // The next user attempt must still get one report for the same error.
  observer.beginAttempt()
  observer.reportThrown('store write failed')
  observer.reportThrown('store write failed')

  assert.deepEqual(reports, ['store write failed', 'store write failed'])
})

test('sync status distinguishes a failed refresh from its last successful data', () => {
  const status = describeSyncFreshness({
    lastRunAt: '2026-08-12T03:00:00.000Z',
    lastSuccessAt: '2026-08-12T02:00:00.000Z',
    lastError: 'failed',
  }, { formatTime: (value) => value })
  assert.equal(status.kind, 'failed')
  assert.match(status.detail, /2026-08-12T02:00:00.000Z/)
})

test('runtime sync failure takes precedence over a previously successful snapshot', () => {
  const status = describeSyncFreshness({
    lastRunAt: '2026-08-12T02:00:00.000Z',
    lastSuccessAt: '2026-08-12T02:00:00.000Z',
    lastError: null,
  }, {
    runtimeError: 'store write failed',
    now: new Date('2026-08-12T02:05:00.000Z').getTime(),
    formatTime: (value) => value,
  })

  assert.equal(status.kind, 'failed')
  assert.equal(status.label, '更新失败')
  assert.match(status.detail, /2026-08-12T02:00:00.000Z/)
})

test('explicit current time advances a successful refresh beyond just updated', () => {
  const lastSuccessAt = '2026-08-12T02:00:00.000Z'
  const sync = { lastSuccessAt, lastError: null }
  const recent = describeSyncFreshness(sync, {
    now: new Date('2026-08-12T02:00:30.000Z').getTime(),
    formatTime: () => '30 秒前',
  })
  const older = describeSyncFreshness(sync, {
    now: new Date('2026-08-12T02:02:00.000Z').getTime(),
    formatTime: () => '2 分钟前',
  })

  assert.equal(recent.kind, 'ready')
  assert.equal(recent.label, '刚更新')
  assert.equal(older.kind, 'ready')
  assert.equal(older.label, '更新于 2 分钟前')
})

test('sync failure text removes credentials, URL queries, and local paths', () => {
  const safe = sanitizeSyncFailure('request https://user:pass@example.test/data?token=secret failed at C:\\Users\\Student\\private.json Cookie: JSESSIONID=secret')
  assert.equal(safe.includes('secret'), false)
  assert.equal(safe.includes('Student'), false)
  assert.equal(safe.includes('?token='), false)
  assert.match(safe, /\[local-path\]|\[redacted\]/)
})
