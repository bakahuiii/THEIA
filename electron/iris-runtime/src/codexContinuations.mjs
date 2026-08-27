const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_CONTINUATIONS = 24
const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000

function clean(value, maximum) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

export function normalizeCodexTaskName(value) {
  const taskName = clean(value, 120).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ')
  return /^(?:已选会话|selected conversation|未命名会话|codex)$/i.test(taskName) ? '' : taskName
}

function validTimestamp(value, now) {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isFinite(parsed) && parsed >= now - RETENTION_MS && parsed <= now + 24 * 60 * 60 * 1_000
    ? new Date(parsed).toISOString()
    : ''
}

function normalizeOne(value, now = Date.now()) {
  const refIdx = clean(value?.refIdx, 256)
  const targetId = clean(value?.targetId, 256)
  const sessionId = clean(value?.sessionId, 64)
  const workspaceName = clean(value?.workspaceName, 64).toLowerCase()
  const taskName = normalizeCodexTaskName(value?.taskName)
  const completedAt = validTimestamp(value?.completedAt, now)
  if (!refIdx || !targetId || !SESSION_ID_PATTERN.test(sessionId) || !completedAt) return null
  const normalized = { refIdx, targetId, sessionId, completedAt }
  if (workspaceName) normalized.workspaceName = workspaceName
  if (taskName) normalized.taskName = taskName
  return normalized
}

/** Keeps recent QQ quote anchors without persisting any user message text. */
export function normalizeCodexContinuations(value, now = Date.now()) {
  const byKey = new Map()
  for (const entry of Array.isArray(value) ? value : []) {
    const normalized = normalizeOne(entry, now)
    if (!normalized) continue
    const key = `${normalized.targetId}\u0000${normalized.refIdx}`
    const existing = byKey.get(key)
    if (!existing || normalized.completedAt > existing.completedAt) byKey.set(key, normalized)
  }
  return [...byKey.values()]
    .sort((left, right) => left.completedAt.localeCompare(right.completedAt))
    .slice(-MAX_CONTINUATIONS)
}

export function rememberCodexContinuation(existing, value, now = Date.now()) {
  const normalized = normalizeOne({ ...value, completedAt: value?.completedAt ?? new Date(now).toISOString() }, now)
  if (!normalized) throw new Error('Codex continuation is incomplete')
  return normalizeCodexContinuations([
    ...(Array.isArray(existing) ? existing.filter((entry) => entry?.refIdx !== normalized.refIdx || entry?.targetId !== normalized.targetId) : []),
    normalized,
  ], now)
}

export function findCodexContinuation(entries, { refIdx, targetId } = {}, now = Date.now()) {
  const reference = clean(refIdx, 256)
  const target = clean(targetId, 256)
  if (!reference || !target) return null
  return normalizeCodexContinuations(entries, now)
    .find((entry) => entry.refIdx === reference && entry.targetId === target) ?? null
}

export function forgetCodexContinuations(entries, completedAtValues, now = Date.now()) {
  const timestamps = new Set((Array.isArray(completedAtValues) ? completedAtValues : [])
    .map((value) => validTimestamp(value, now))
    .filter(Boolean))
  if (!timestamps.size) return normalizeCodexContinuations(entries, now)
  return normalizeCodexContinuations(entries, now)
    .filter((entry) => !timestamps.has(entry.completedAt))
}
