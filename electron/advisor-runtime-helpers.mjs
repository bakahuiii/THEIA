import { createHash } from 'node:crypto'
import { canonicalJson } from '../core/advisor/canonical.mjs'
import { normalizeProviderUsage } from './ai/provider.mjs'

export const ADVISOR_THREAD_SCHEMA = 'theia-advisor-thread/v1'
export const ADVISOR_THREAD_SUMMARY_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const MAX_THREADS = 20
export const MAX_THREAD_MESSAGES = 40
export const MAX_THREAD_SUMMARIES = 6
export const MAX_THREAD_HINT_ENTRIES = 6
export const MAX_THREAD_HINT_BYTES = 6_000
export const AGENT_INPUT_BYTES_DEFAULT = 200_000

const ADVISOR_INTENT_VALUES = new Set(['daily', 'risk', 'course', 'assignment', 'notice', 'mail', 'general'])

export function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export function boundedText(value, maximum) {
  return String(value ?? '').normalize('NFC').trim().slice(0, maximum)
}

export function normalizeAdvisorIntent(requested) {
  const explicit = boundedText(requested, 40).toLocaleLowerCase()
  return ADVISOR_INTENT_VALUES.has(explicit) ? explicit : 'general'
}

export function hash(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex')
}

export function advisorPromptCacheKey(cacheProfile) {
  // A stable one-way account digest isolates cache buckets without placing a
  // raw account identifier in an HTTP request field.
  const accountIdentity = cacheProfile?.studentId || canonicalJson(cacheProfile || { account: 'unbound' })
  return `theia-advisor-agent-v1-${hash(accountIdentity).slice(0, 24)}`
}

export function deepClone(value) {
  return structuredClone(value)
}

export function nowMilliseconds(value) {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new TypeError('Advisor clock returned an invalid instant')
  return parsed
}

export function advisorTimeContext(value) {
  const instant = new Date(nowMilliseconds(value))
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const values = Object.fromEntries(parts
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]))
  return {
    timeZone: 'Asia/Shanghai',
    currentDate: `${values.year}-${values.month}-${values.day}`,
    currentTime: `${values.hour}:${values.minute}:${values.second}`,
    currentInstant: instant.toISOString(),
  }
}

export function boundedCount(value) {
  const number = Math.trunc(Number(value))
  return Number.isFinite(number) ? Math.max(0, Math.min(1_000_000, number)) : 0
}

export function uniqueTermIds(values, maximum = 12) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => boundedText(value, 80))
    .filter(Boolean))].slice(0, maximum)
}

export function advisorDataInventory(inventory) {
  return Object.entries(inventory || {}).map(([domain, item]) => ({
    domain,
    label: boundedText(item?.label, 100),
    records: boundedCount(item?.records),
    localFacts: boundedCount(item?.localFacts),
    availability: boundedText(item?.availability, 40),
    freshness: boundedText(item?.freshness, 40),
    completeness: boundedText(item?.completeness, 40),
  }))
}

export function advisorAcademicContext(state) {
  const terms = Array.isArray(state?.terms) ? state.terms : []
  const schoolScheduleRecords = Object.values(state?.dataCatalog?.collections?.schoolSchedule?.records || {})
  const schoolScheduleTermIds = uniqueTermIds(schoolScheduleRecords.map((record) => record?.scope?.termId))
  const knownTermIds = terms.map((term) => term?.id)
  return {
    terms: terms.slice(0, 12).map((term) => ({
      id: boundedText(term?.id, 80),
      label: boundedText(term?.label, 160),
      year: Number.isFinite(Number(term?.year)) ? Number(term.year) : null,
      term: boundedText(term?.term, 40),
    })).filter((term) => term.id || term.label),
    latestKnownTermId: boundedText(terms[0]?.id, 80) || null,
    planningTermCandidates: uniqueTermIds([...schoolScheduleTermIds, ...knownTermIds], 12),
    selectedCourseTermIds: uniqueTermIds((Array.isArray(state?.selectedCourses) ? state.selectedCourses : []).map((item) => item?.termId)),
    personalScheduleTermIds: uniqueTermIds((Array.isArray(state?.schedule) ? state.schedule : []).map((item) => item?.termId)),
    schoolScheduleTermIds,
    academicProgressAvailable: Boolean(state?.academicProgress),
  }
}

export function agentInputBytesBudget(budget) {
  const configured = Number(budget?.agentMaxInputBytes)
  const ceiling = Number.isSafeInteger(configured) && configured > 0 ? configured : AGENT_INPUT_BYTES_DEFAULT
  return Math.min(Number(budget?.maxInputBytes) || ceiling, ceiling)
}

export function mergeObservedUsage(target, value) {
  const usage = normalizeProviderUsage(value)
  if (!usage) return
  target.inputTokens += usage.inputTokens || 0
  target.outputTokens += usage.outputTokens || 0
  if (usage.cachedInputTokens !== null) target.cachedInputTokens = (target.cachedInputTokens || 0) + usage.cachedInputTokens
  if (usage.cacheWriteInputTokens !== null) target.cacheWriteInputTokens = (target.cacheWriteInputTokens || 0) + usage.cacheWriteInputTokens
  const rank = { unknown: 0, miss: 1, write: 2, hit: 3 }
  if ((rank[usage.cacheStatus] || 0) > (rank[target.cacheStatus] || 0)) target.cacheStatus = usage.cacheStatus
}

export function responseSummary(rawText, prepared, at) {
  const expiresAt = new Date(nowMilliseconds(at) + ADVISOR_THREAD_SUMMARY_TTL_MS).toISOString()
  const domainDigests = prepared?.versionedSnapshot?.domainDigests && typeof prepared.versionedSnapshot.domainDigests === 'object'
    ? Object.fromEntries(Object.entries(prepared.versionedSnapshot.domainDigests)
      .filter(([domain, digest]) => typeof domain === 'string' && /^[a-f0-9]{64}$/u.test(String(digest)))
      .sort(([left], [right]) => left.localeCompare(right)))
    : {}
  return {
    schema: 'theia-advisor-thread-summary/v1',
    createdAt: at,
    expiresAt,
    snapshotRevision: prepared?.versionedSnapshot?.revision || null,
    domainDigests,
    responseDigest: hash(rawText),
    evidenceState: 'current',
  }
}

export function renderVerifiedNarrative(narrative) {
  const parts = [
    ...(narrative.blocks || []).map((block) => block.explanation),
    ...(narrative.recommendations || []).map((item) => `建议：${item.text}`),
    ...(narrative.uncertainties || []).map((item) => `说明：${item}`),
    ...(narrative.questionsForUser || []),
  ].filter(Boolean)
  return parts.join('\n\n')
}

export function summaryExpiry(summary) {
  const explicit = Date.parse(String(summary?.expiresAt || ''))
  if (Number.isFinite(explicit)) return explicit
  const created = Date.parse(String(summary?.createdAt || ''))
  return Number.isFinite(created) ? created + ADVISOR_THREAD_SUMMARY_TTL_MS : null
}

export function compactThreadHint(thread, snapshot, now) {
  const entries = []
  for (const message of Array.isArray(thread?.messages) ? thread.messages : []) {
    if (!message || typeof message !== 'object') continue
    if (message.role === 'user' && message.text) {
      entries.push({ role: 'user', text: boundedText(message.text, 1_000) })
      continue
    }
    const assistantText = message.role === 'assistant'
      ? message.response?.displayText || message.response?.rawText || message.text
      : ''
    if (assistantText) entries.push({ role: 'assistant', text: boundedText(assistantText, 1_200) })
  }
  const selected = entries.slice(-MAX_THREAD_HINT_ENTRIES)
  const currentRevision = snapshot?.revision || null
  const currentDigests = snapshot?.domainDigests && typeof snapshot.domainDigests === 'object' ? snapshot.domainDigests : {}
  const nowValue = nowMilliseconds(now)
  const summaries = (Array.isArray(thread?.summaries) ? thread.summaries : [])
    .filter((summary) => summary?.schema === 'theia-advisor-thread-summary/v1')
    .filter((summary) => {
      const expiresAt = summaryExpiry(summary)
      return expiresAt !== null && expiresAt > nowValue
    })
    .slice(-MAX_THREAD_SUMMARIES)
    .map((summary) => {
      const changedDomains = Object.keys(summary.domainDigests || {})
        .filter((domain) => currentDigests[domain] && currentDigests[domain] !== summary.domainDigests[domain])
        .sort()
      return {
        snapshotRevision: boundedText(summary.snapshotRevision, 128),
        responseDigest: boundedText(summary.responseDigest, 64),
        expiresAt: new Date(summaryExpiry(summary)).toISOString(),
        evidenceState: summary.snapshotRevision === currentRevision && !changedDomains.length ? 'current' : 'historical',
        ...(changedDomains.length ? { changedDomains: changedDomains.slice(0, 16) } : {}),
      }
    })
  if (!selected.length && !summaries.length) return null
  const hint = {
    schema: 'theia-advisor-thread-hint/v1',
    entries: selected,
    ...(summaries.length ? { summaries } : {}),
    instruction: '这是对话导航提示，不是当前事实；历史摘要只用于识别 revision 变化，所有事实必须重新从当前本地快照工具读取并引用。',
  }
  if (Buffer.byteLength(canonicalJson(hint), 'utf8') <= MAX_THREAD_HINT_BYTES) return hint
  return {
    schema: hint.schema,
    entries: selected.slice(-2).map((entry) => ({
      role: entry.role,
      text: boundedText(entry.text, 720),
    })),
    ...(summaries.length ? { summaries: summaries.slice(-3) } : {}),
    instruction: hint.instruction,
  }
}

export function providerMessages(context) {
  return [{ role: 'user', content: canonicalJson(context) }]
}

export function providerMessageBytes(messages) {
  return Buffer.byteLength(canonicalJson(messages), 'utf8')
}

export function publicThread(thread) {
  return deepClone({
    schema: ADVISOR_THREAD_SCHEMA,
    id: thread.id,
    title: thread.title,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    activeRequestId: thread.activeRequestId,
    summaries: thread.summaries,
    messages: thread.messages,
  })
}
