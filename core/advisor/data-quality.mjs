import { canonicalDigest, compareCanonicalText, parseInstant, uniqueSorted } from './canonical.mjs'
import {
  ADVISOR_DOMAIN_KEYS,
  canonicalDomainId,
  domainPayload,
  domainPayloadExists,
  domainRecordCount,
} from '../domain-provenance.mjs'
import {
  ADVISOR_DATA_QUALITY_SCHEMA,
  ATTEMPT_STATUS_VALUES,
  COMPLETENESS_VALUES,
  normalizeAdvisorOptions,
  normalizeVersionedSnapshot,
} from './contracts.mjs'

export const DOMAIN_FRESHNESS_POLICY = Object.freeze({
  assignments: 6 * 60 * 60 * 1000,
  exams: 24 * 60 * 60 * 1000,
  grades: 72 * 60 * 60 * 1000,
  'academic-progress': 7 * 24 * 60 * 60 * 1000,
  schedule: 24 * 60 * 60 * 1000,
  'selected-courses': 24 * 60 * 60 * 1000,
  notices: 12 * 60 * 60 * 1000,
  courses: 24 * 60 * 60 * 1000,
  terms: 7 * 24 * 60 * 60 * 1000,
  profile: 7 * 24 * 60 * 60 * 1000,
  academic: 24 * 60 * 60 * 1000,
  workspaces: 24 * 60 * 60 * 1000,
  coursework: 6 * 60 * 60 * 1000,
  mailbox: 30 * 60 * 1000,
  fitness: 30 * 24 * 60 * 60 * 1000,
  'school-schedule': 24 * 60 * 60 * 1000,
  'academic-calendar': 7 * 24 * 60 * 60 * 1000,
  'local-data-catalog': 24 * 60 * 60 * 1000,
  'academic-plan': 7 * 24 * 60 * 60 * 1000,
  'graduation-audit': 7 * 24 * 60 * 60 * 1000,
  'grade-details': 72 * 60 * 60 * 1000,
  'exam-extra': 24 * 60 * 60 * 1000,
  'free-classroom': 6 * 60 * 60 * 1000,
  default: 24 * 60 * 60 * 1000,
})

function normalizeOutcome(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return {
    attempted: raw.attempted === true,
    succeeded: raw.succeeded === true,
    emptyConfirmed: raw.emptyConfirmed === true,
    contentEmptyConfirmed: raw.contentEmptyConfirmed === true || raw.emptyConfirmed === true,
    retainedPrevious: raw.retainedPrevious === true,
    capturedAt: typeof raw.capturedAt === 'string' ? raw.capturedAt : null,
    sourceSucceededAt: typeof raw.sourceSucceededAt === 'string' ? raw.sourceSucceededAt : null,
    attemptedAt: typeof raw.attemptedAt === 'string' ? raw.attemptedAt : null,
    completedAt: typeof raw.completedAt === 'string' ? raw.completedAt : null,
    status: typeof raw.status === 'string' ? raw.status : null,
    errorCode: typeof raw.errorCode === 'string' && raw.errorCode.trim() ? raw.errorCode.trim() : null,
    completeness: COMPLETENESS_VALUES.includes(raw.completeness) ? raw.completeness : 'unknown',
    parserVersion: typeof raw.parserVersion === 'string' && raw.parserVersion.trim() ? raw.parserVersion.trim() : null,
    receivedRecordCount: Number.isSafeInteger(Number(raw.receivedRecordCount)) && Number(raw.receivedRecordCount) >= 0
      ? Number(raw.receivedRecordCount)
      : null,
    previousRecordCount: Number.isSafeInteger(Number(raw.previousRecordCount)) && Number(raw.previousRecordCount) >= 0
      ? Number(raw.previousRecordCount)
      : null,
    successfulTermIds: Array.isArray(raw.successfulTermIds)
      ? uniqueSorted(raw.successfulTermIds.map(String)).slice(0, 64)
      : [],
    failedTermIds: Array.isArray(raw.failedTermIds)
      ? uniqueSorted(raw.failedTermIds.map(String)).slice(0, 64)
      : [],
    source: Array.isArray(raw.source)
      ? uniqueSorted(raw.source.map(String))
      : (typeof raw.source === 'string' && raw.source.trim() ? [raw.source.trim().normalize('NFC')] : []),
    runId: typeof raw.runId === 'string' && raw.runId.trim() ? raw.runId.trim() : null,
  }
}

function sourceAttempts(rawOutcome) {
  const nested = rawOutcome?.outcomes && typeof rawOutcome.outcomes === 'object' && !Array.isArray(rawOutcome.outcomes)
    ? Object.values(rawOutcome.outcomes)
    : []
  // Older locally saved provenance records have an empty outcomes map and put
  // their latest result directly on the domain. Keep that result explainable.
  const rawAttempts = nested.length ? nested : rawOutcome ? [rawOutcome] : []
  return rawAttempts.map(normalizeOutcome).filter(Boolean).map((outcome) => ({
    source: outcome.source,
    attemptedAt: outcome.attemptedAt,
    completedAt: outcome.completedAt,
    capturedAt: outcome.capturedAt,
    sourceSucceededAt: outcome.sourceSucceededAt,
    status: attemptStatus(outcome),
    completeness: outcome.completeness,
    retainedPrevious: outcome.retainedPrevious,
    errorCode: outcome.errorCode,
    parserVersion: outcome.parserVersion,
    receivedRecordCount: outcome.receivedRecordCount,
    previousRecordCount: outcome.previousRecordCount,
    successfulTermIds: outcome.successfulTermIds,
    failedTermIds: outcome.failedTermIds,
  })).sort((left, right) => compareCanonicalText(left.source.join(','), right.source.join(',')))
}

function attemptStatus(outcome) {
  if (!outcome) return 'never'
  if (ATTEMPT_STATUS_VALUES.includes(outcome.status)) return outcome.status
  if (!outcome.attempted) return 'not-attempted'
  if (outcome.succeeded) return 'succeeded'
  if (/auth|login|credential/i.test(outcome.errorCode || '')) return 'auth-required'
  return 'failed'
}

function availabilityOf({ exists, recordCount, outcome }) {
  if (recordCount > 0) return 'available'
  if (outcome?.contentEmptyConfirmed) return 'empty-confirmed'
  if (!exists) return 'absent'
  return 'unknown'
}

function domainCompleteness(domain, payload, outcome) {
  if (!outcome) return 'unknown'
  let completeness = outcome.completeness
  if (domain === 'academic-progress') {
    const hasRoots = Array.isArray(payload?.roots) && payload.roots.length > 0
    if (!hasRoots && completeness === 'complete') completeness = 'partial'
  }
  if (domain === 'school-schedule') {
    const records = payload?.records && typeof payload.records === 'object' ? Object.values(payload.records) : []
    if (records.some((record) => record?.normalized?.complete !== true && record?.complete !== true) && completeness === 'complete') {
      completeness = 'partial'
    }
  }
  return completeness
}

function freshnessOf({ capturedAt, nowMilliseconds, domain, hasProvenance }) {
  if (!hasProvenance) return { freshness: 'unknown', captured: null, warning: null }
  const captured = parseInstant(capturedAt)
  if (!captured) return { freshness: 'unknown', captured: null, warning: capturedAt ? 'captured-at-invalid' : 'captured-at-missing' }
  const age = nowMilliseconds - captured.milliseconds
  if (age < -5 * 60 * 1000) return { freshness: 'unknown', captured, warning: 'captured-at-in-future' }
  const threshold = DOMAIN_FRESHNESS_POLICY[domain] ?? DOMAIN_FRESHNESS_POLICY.default
  return { freshness: age <= threshold ? 'fresh' : 'stale', captured, warning: null }
}

function matchingRunTime(sync, outcome, key) {
  const direct = parseInstant(outcome?.[key])
  if (direct) return direct.iso
  if (!outcome?.runId || outcome.runId !== sync?.runId) return null
  const legacyKey = key === 'attemptedAt' ? 'lastStartedAt' : key === 'completedAt' ? 'lastCompletedAt' : key
  const parsed = parseInstant(sync?.[legacyKey])
  return parsed?.iso || null
}

export function evaluateDataQuality(versionedSnapshot, options) {
  const versioned = normalizeVersionedSnapshot(versionedSnapshot)
  const normalizedOptions = normalizeAdvisorOptions(options)
  const state = versioned.snapshot
  const rawDomains = state.sync?.domains && typeof state.sync.domains === 'object' && !Array.isArray(state.sync.domains)
    ? state.sync.domains
    : {}
  const domainNames = uniqueSorted(ADVISOR_DOMAIN_KEYS)
  const warnings = []
  const domains = {}
  const nowMilliseconds = Date.parse(normalizedOptions.now)

  for (const domain of domainNames) {
    const payload = {
      exists: domainPayloadExists(state, domain),
      value: domainPayload(state, domain),
    }
    const rawOutcome = rawDomains[domain]
      ?? Object.entries(rawDomains).find(([key]) => canonicalDomainId(key) === domain)?.[1]
    const outcome = normalizeOutcome(rawOutcome)
    const recordCount = domainRecordCount(state, domain)
    const digest = versioned.domainDigests[domain] || canonicalDigest(payload.value)
    const status = attemptStatus(outcome)
    const freshness = freshnessOf({
      capturedAt: outcome?.capturedAt,
      nowMilliseconds,
      domain,
      hasProvenance: Boolean(outcome),
    })
    if (!outcome) warnings.push(`provenance-missing:${domain}`)
    if (!versioned.domainDigests[domain]) warnings.push(`content-digest-derived:${domain}`)
    if (freshness.warning) warnings.push(`${freshness.warning}:${domain}`)
    if (outcome?.retainedPrevious && recordCount === 0) warnings.push(`retained-previous-empty:${domain}`)

    domains[domain] = {
      domain,
      availability: availabilityOf({ ...payload, recordCount, outcome }),
      freshness: freshness.freshness,
      completeness: domainCompleteness(domain, payload.value, outcome),
      contentEmptyConfirmed: outcome?.contentEmptyConfirmed === true,
      capturedAt: freshness.captured?.iso || null,
      sourceSucceededAt: parseInstant(outcome?.sourceSucceededAt)?.iso || (outcome?.succeeded ? freshness.captured?.iso || null : null),
      source: outcome?.source || [],
      parserVersion: outcome?.parserVersion || null,
      recordCount,
      contentDigest: digest,
      sourceAttempts: sourceAttempts(rawOutcome),
      derivedFrom: Array.isArray(rawOutcome?.derivedFrom)
        ? uniqueSorted(rawOutcome.derivedFrom.map(String)).slice(0, 32)
        : [],
      lastAttempt: {
        runId: outcome?.runId || null,
        attemptedAt: matchingRunTime(state.sync, outcome, 'attemptedAt'),
        completedAt: matchingRunTime(state.sync, outcome, 'completedAt'),
        status: ATTEMPT_STATUS_VALUES.includes(status) ? status : 'never',
        emptyConfirmed: outcome?.emptyConfirmed === true,
        retainedPrevious: outcome?.retainedPrevious === true,
        errorCode: outcome?.errorCode || null,
      },
      provenanceInferred: !outcome,
    }
  }

  const snapshotAt = parseInstant(versioned.committedAt)?.iso || null
  if (!snapshotAt) warnings.push('snapshot-time-missing-or-invalid')
  const orderedDomains = Object.fromEntries(Object.entries(domains).sort(([left], [right]) => compareCanonicalText(left, right)))
  return {
    schema: ADVISOR_DATA_QUALITY_SCHEMA,
    snapshotRevision: versioned.revision,
    snapshotAt,
    evaluatedAt: normalizedOptions.now,
    timeZone: normalizedOptions.timeZone,
    rulesVersion: normalizedOptions.rulesVersion,
    domains: orderedDomains,
    warnings: uniqueSorted(warnings),
  }
}
