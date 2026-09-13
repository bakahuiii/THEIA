export const AUTO_SYNC_STALE_AFTER_MS = 24 * 60 * 60 * 1000

export function lastSyncAt(sync) {
  // A failed completed run is not evidence that the retained data is fresh.
  // Prefer the explicit success timestamp whenever the current schema has it;
  // only older snapshots without that field fall back to their run time.
  const values = sync && Object.prototype.hasOwnProperty.call(sync, 'lastSuccessAt')
    ? [sync.lastSuccessAt]
    : [sync?.lastRunAt, sync?.lastCompletedAt]
  for (const value of values) {
    const timestamp = Date.parse(typeof value === 'string' ? value : '')
    if (Number.isFinite(timestamp)) return timestamp
  }
  return null
}

export function shouldRefreshStaleSync(sync, now = Date.now(), staleAfterMs = AUTO_SYNC_STALE_AFTER_MS) {
  const current = Number(now)
  const threshold = Number(staleAfterMs)
  if (!Number.isFinite(current) || !Number.isFinite(threshold) || threshold < 0) return false
  const previous = lastSyncAt(sync)
  return previous === null || current - previous >= threshold
}
