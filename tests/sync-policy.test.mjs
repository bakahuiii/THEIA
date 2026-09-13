import test from 'node:test'
import assert from 'node:assert/strict'
import { AUTO_SYNC_STALE_AFTER_MS, lastSyncAt, shouldRefreshStaleSync } from '../core/sync-policy.mjs'

const NOW = Date.parse('2026-09-13T12:00:00.000Z')

test('automatic startup refresh treats missing or invalid sync timestamps as stale', () => {
  assert.equal(lastSyncAt({}), null)
  assert.equal(shouldRefreshStaleSync({}, NOW), true)
  assert.equal(shouldRefreshStaleSync({ lastRunAt: 'not-a-date' }, NOW), true)
})

test('automatic startup refresh begins at exactly one day old', () => {
  const recent = new Date(NOW - AUTO_SYNC_STALE_AFTER_MS + 1).toISOString()
  const stale = new Date(NOW - AUTO_SYNC_STALE_AFTER_MS).toISOString()

  assert.equal(shouldRefreshStaleSync({ lastRunAt: recent }, NOW), false)
  assert.equal(shouldRefreshStaleSync({ lastRunAt: stale }, NOW), true)
})

test('automatic startup refresh uses the last successful sync timestamp', () => {
  const lastRunAt = new Date(NOW - 5 * AUTO_SYNC_STALE_AFTER_MS).toISOString()
  const lastSuccessAt = new Date(NOW - AUTO_SYNC_STALE_AFTER_MS + 1).toISOString()

  assert.equal(lastSyncAt({ lastRunAt, lastSuccessAt }), Date.parse(lastSuccessAt))
  assert.equal(shouldRefreshStaleSync({ lastRunAt, lastSuccessAt }, NOW), false)
  assert.equal(shouldRefreshStaleSync({ lastRunAt, lastSuccessAt: null }, NOW), true)
})
