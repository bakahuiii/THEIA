import { canonicalDigest, compareCanonicalText } from './advisor/canonical.mjs'
import { JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES } from './jwglxt-extra.mjs'

export const DOMAIN_PROVENANCE_SCHEMA = 'theia-domain-provenance/v1'
export const DOMAIN_OUTCOME_SCHEMA = 'theia-domain-outcome/v1'

export const ADVISOR_DOMAIN_KEYS = Object.freeze([
  'profile',
  'terms',
  'courses',
  'academic',
  'schedule',
  'grades',
  'exams',
  'selected-courses',
  'academic-progress',
  'assignments',
  'workspaces',
  'coursework',
  'notices',
  'mailbox',
  'fitness',
  'school-schedule',
  'academic-calendar',
  'local-data-catalog',
  ...JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES,
])

export const SYNC_SOURCE_DOMAINS = Object.freeze({
  jwglxt: Object.freeze([
    'profile',
    'terms',
    'courses',
    'schedule',
    'grades',
    'exams',
    'selected-courses',
    'academic-progress',
    'notices',
    ...JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES,
  ]),
  theol: Object.freeze(['courses', 'assignments', 'notices']),
})

export const DERIVED_DOMAIN_DEPENDENCIES = Object.freeze({
  academic: Object.freeze(['terms', 'courses', 'selected-courses']),
  coursework: Object.freeze(['assignments', 'workspaces']),
  'local-data-catalog': Object.freeze(['fitness', 'school-schedule', 'academic-calendar']),
})

const DERIVED_PROVENANCE_VERSION = 'derived-provenance/v1'

const FIELD_BY_DOMAIN = Object.freeze({
  profile: 'profile',
  terms: 'terms',
  courses: 'courses',
  schedule: 'schedule',
  grades: 'grades',
  exams: 'exams',
  'selected-courses': 'selectedCourses',
  'academic-progress': 'academicProgress',
  assignments: 'assignments',
  workspaces: 'workspaces',
  notices: 'notices',
  mailbox: 'emails',
  ...Object.fromEntries(JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES.map((domain) => [domain, 'academicExtras'])),
})

const STATUS_VALUES = new Set(['never', 'not-attempted', 'succeeded', 'failed', 'auth-required'])
const COMPLETENESS_VALUES = new Set(['complete', 'partial', 'unknown'])

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function textOrNull(value, maxLength = 160) {
  if (typeof value !== 'string') return null
  const text = value.normalize('NFC').trim()
  return text ? text.slice(0, maxLength) : null
}

function instantOrNull(value) {
  const text = textOrNull(value, 64)
  return text && Number.isFinite(Date.parse(text)) ? text : null
}

function sourceNames(value) {
  const items = Array.isArray(value) ? value : value == null ? [] : [value]
  return [...new Set(items.map((item) => textOrNull(item, 80)).filter(Boolean))].sort(compareCanonicalText)
}

function errorCodeOrNull(value) {
  const text = textOrNull(value, 80)?.toLowerCase().replace(/[^a-z0-9._:-]+/g, '_') || null
  return text && text !== '_' ? text : null
}

function recordCountOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const count = Number(value)
  return Number.isSafeInteger(count) && count >= 0 ? count : null
}

export function canonicalDomainId(value) {
  const text = textOrNull(value, 100)
  if (!text) return null
  if (text === 'selectedCourses') return 'selected-courses'
  if (text === 'academicProgress') return 'academic-progress'
  if (text === 'schoolSchedule') return 'school-schedule'
  if (text === 'academicCalendar' || text === 'calendar') return 'academic-calendar'
  if (text === 'emails') return 'mailbox'
  if (text === 'dataCatalog' || text === 'data-catalog' || text === 'localDataCatalog') return 'local-data-catalog'
  if (text === 'academicExtras' || text === 'academic-extra' || text === 'academic-extras') return 'academic-extras'
  return text
}

export function domainPayload(state, domain) {
  const snapshot = objectOrEmpty(state)
  const normalizedDomain = canonicalDomainId(domain)
  if (JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES.includes(normalizedDomain)) {
    return snapshot.academicExtras?.domains?.[normalizedDomain] || null
  }
  switch (normalizedDomain) {
    case 'profile': return snapshot.profile ?? null
    case 'terms': return Array.isArray(snapshot.terms) ? snapshot.terms : []
    case 'courses': return Array.isArray(snapshot.courses) ? snapshot.courses : []
    case 'academic': return {
      terms: Array.isArray(snapshot.terms) ? snapshot.terms : [],
      courses: Array.isArray(snapshot.courses) ? snapshot.courses : [],
      selectedCourses: Array.isArray(snapshot.selectedCourses) ? snapshot.selectedCourses : [],
    }
    case 'schedule': return Array.isArray(snapshot.schedule) ? snapshot.schedule : []
    case 'grades': return Array.isArray(snapshot.grades) ? snapshot.grades : []
    case 'exams': return Array.isArray(snapshot.exams) ? snapshot.exams : []
    case 'selected-courses': return Array.isArray(snapshot.selectedCourses) ? snapshot.selectedCourses : []
    case 'academic-progress': return snapshot.academicProgress ?? null
    case 'assignments': return Array.isArray(snapshot.assignments) ? snapshot.assignments : []
    case 'workspaces': return Array.isArray(snapshot.workspaces) ? snapshot.workspaces : []
    case 'coursework': return {
      assignments: Array.isArray(snapshot.assignments) ? snapshot.assignments : [],
      workspaces: Array.isArray(snapshot.workspaces) ? snapshot.workspaces : [],
    }
    case 'notices': return Array.isArray(snapshot.notices) ? snapshot.notices : []
    case 'mailbox': return Array.isArray(snapshot.emails) ? snapshot.emails : []
    case 'fitness': return objectOrEmpty(snapshot.dataCatalog?.collections?.fitness)
    case 'school-schedule': return objectOrEmpty(snapshot.dataCatalog?.collections?.schoolSchedule)
    case 'academic-calendar': return objectOrEmpty(snapshot.dataCatalog?.collections?.academicCalendar)
    case 'local-data-catalog': return objectOrEmpty(snapshot.dataCatalog)
    default: return null
  }
}

export function domainPayloadExists(state, domain) {
  const snapshot = objectOrEmpty(state)
  const collections = objectOrEmpty(snapshot.dataCatalog?.collections)
  const normalizedDomain = canonicalDomainId(domain)
  if (JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES.includes(normalizedDomain)) {
    return Boolean(snapshot.academicExtras?.domains?.[normalizedDomain])
  }
  switch (normalizedDomain) {
    case 'profile': return Object.hasOwn(snapshot, 'profile')
    case 'terms': return Object.hasOwn(snapshot, 'terms')
    case 'courses': return Object.hasOwn(snapshot, 'courses')
    case 'academic': return ['terms', 'courses', 'selectedCourses'].some((field) => Object.hasOwn(snapshot, field))
    case 'schedule': return Object.hasOwn(snapshot, 'schedule')
    case 'grades': return Object.hasOwn(snapshot, 'grades')
    case 'exams': return Object.hasOwn(snapshot, 'exams')
    case 'selected-courses': return Object.hasOwn(snapshot, 'selectedCourses')
    case 'academic-progress': return Object.hasOwn(snapshot, 'academicProgress')
    case 'assignments': return Object.hasOwn(snapshot, 'assignments')
    case 'workspaces': return Object.hasOwn(snapshot, 'workspaces')
    case 'coursework': return ['assignments', 'workspaces'].some((field) => Object.hasOwn(snapshot, field))
    case 'notices': return Object.hasOwn(snapshot, 'notices')
    case 'mailbox': return Object.hasOwn(snapshot, 'emails')
    case 'fitness': return Object.hasOwn(collections, 'fitness')
    case 'school-schedule': return Object.hasOwn(collections, 'schoolSchedule')
    case 'academic-calendar': return Object.hasOwn(collections, 'academicCalendar')
    case 'local-data-catalog': return Object.hasOwn(snapshot, 'dataCatalog')
    default: return false
  }
}

export function domainRecordCount(state, domain) {
  const payload = domainPayload(state, domain)
  const normalizedDomain = canonicalDomainId(domain)
  if (JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES.includes(normalizedDomain)) {
    // A read-only JWGLXT page can legitimately contain only a downloadable
    // attachment (for example, the official cultivation-plan PDF). Treat
    // those attachments as captured content so provenance does not report a
    // successful PDF-only read as an empty domain.
    const records = Array.isArray(payload?.records) ? payload.records.length : 0
    const attachments = Array.isArray(payload?.attachments) ? payload.attachments.length : 0
    return records + attachments
  }
  switch (normalizedDomain) {
    case 'profile':
    case 'academic-progress': return payload ? 1 : 0
    case 'academic': return payload.terms.length + payload.courses.length + payload.selectedCourses.length
    case 'coursework': return payload.assignments.length + payload.workspaces.length
    case 'fitness':
    case 'school-schedule': return Object.keys(payload.records || {}).length
    case 'academic-calendar': return payload.calendar || payload.analysis ? 1 : 0
    case 'local-data-catalog': return Object.values(payload.collections || {}).filter(Boolean).length
    default: return Array.isArray(payload) ? payload.length : payload ? 1 : 0
  }
}

export function domainHasData(state, domain) {
  return domainRecordCount(state, domain) > 0
}

export function computeDomainDigests(state) {
  return Object.fromEntries(ADVISOR_DOMAIN_KEYS.map((domain) => [domain, canonicalDigest(domainPayload(state, domain))]))
}

export function sourceDomainOutcome({
  source,
  runId = null,
  attempted = true,
  succeeded = false,
  attemptedAt = null,
  completedAt = null,
  status = null,
  capturedAt = null,
  sourceSucceededAt = null,
  emptyConfirmed = false,
  contentEmptyConfirmed,
  retainedPrevious = false,
  completeness = 'unknown',
  parserVersion = null,
  errorCode = null,
  receivedRecordCount = null,
  previousRecordCount = null,
  successfulTermIds = [],
  failedTermIds = [],
} = {}) {
  const didAttempt = attempted === true
  const didSucceed = didAttempt && succeeded === true
  const normalizedCompleteness = COMPLETENESS_VALUES.has(completeness) ? completeness : 'unknown'
  const requestedStatus = STATUS_VALUES.has(status) ? status : null
  const normalizedStatus = !didAttempt
    ? 'not-attempted'
    : didSucceed
      ? 'succeeded'
      : requestedStatus === 'auth-required' ? 'auth-required' : 'failed'
  const lastAttemptEmptyConfirmed = didSucceed && normalizedCompleteness === 'complete' && emptyConfirmed === true
  const successfulTerms = didAttempt ? sourceNames(successfulTermIds) : []
  const failedTerms = didAttempt
    ? sourceNames(failedTermIds).filter((termId) => !successfulTerms.includes(termId))
    : []
  return {
    schema: DOMAIN_OUTCOME_SCHEMA,
    runId: textOrNull(runId, 100),
    source: sourceNames(source),
    attempted: didAttempt,
    succeeded: didSucceed,
    attemptedAt: didAttempt ? instantOrNull(attemptedAt) : null,
    completedAt: didAttempt ? instantOrNull(completedAt) : null,
    status: normalizedStatus,
    capturedAt: instantOrNull(capturedAt),
    sourceSucceededAt: instantOrNull(sourceSucceededAt),
    emptyConfirmed: lastAttemptEmptyConfirmed,
    contentEmptyConfirmed: contentEmptyConfirmed === true || lastAttemptEmptyConfirmed,
    retainedPrevious: retainedPrevious === true,
    completeness: normalizedCompleteness,
    parserVersion: textOrNull(parserVersion, 120),
    errorCode: errorCodeOrNull(errorCode),
    receivedRecordCount: recordCountOrNull(receivedRecordCount),
    previousRecordCount: recordCountOrNull(previousRecordCount),
    successfulTermIds: successfulTerms,
    failedTermIds: failedTerms,
  }
}

export function normalizeSourceDomainOutcome(value, defaults = {}) {
  const raw = objectOrEmpty(value)
  return sourceDomainOutcome({
    ...defaults,
    ...raw,
    source: raw.source ?? defaults.source,
    status: raw.status ?? defaults.status,
  })
}

function preserveCapturedEvidence(previous, next) {
  if (next.succeeded) return next
  return {
    ...next,
    capturedAt: next.capturedAt || previous?.capturedAt || null,
    sourceSucceededAt: next.sourceSucceededAt || previous?.sourceSucceededAt || null,
    parserVersion: next.parserVersion || previous?.parserVersion || null,
    contentEmptyConfirmed: next.contentEmptyConfirmed || previous?.contentEmptyConfirmed || previous?.emptyConfirmed || false,
  }
}

function latestInstant(items, field, fallback = null) {
  return items.map((item) => item?.[field]).filter((value) => value && Number.isFinite(Date.parse(value)))
    .reduce((latest, value) => !latest || Date.parse(value) > Date.parse(latest) ? value : latest, fallback)
}

function earliestCompleteInstant(items, field) {
  if (!items.length) return null
  const values = items.map((item) => item?.[field])
  if (values.some((value) => !value || !Number.isFinite(Date.parse(value)))) return null
  return values.reduce((earliest, value) => Date.parse(value) < Date.parse(earliest) ? value : earliest)
}

function weakestCompleteness(items) {
  if (items.some((item) => !item || item.completeness === 'unknown')) return 'unknown'
  if (items.some((item) => item.completeness === 'partial')) return 'partial'
  return items.every((item) => item.completeness === 'complete') ? 'complete' : 'unknown'
}

function derivedStatus(items) {
  const statuses = items.map((item) => item?.status || 'not-attempted')
  if (statuses.includes('auth-required')) return 'auth-required'
  if (statuses.includes('failed')) return 'failed'
  if (items.every((item) => item?.succeeded)) return 'succeeded'
  return 'not-attempted'
}

function deriveAggregateDomains(domains) {
  const result = { ...domains }
  for (const [domain, dependencies] of Object.entries(DERIVED_DOMAIN_DEPENDENCIES)) {
    const items = dependencies.map((dependency) => result[dependency] || null)
    if (!items.some(Boolean)) continue
    const present = items.filter(Boolean)
    const completeness = weakestCompleteness(items)
    const succeeded = items.every((item) => item?.succeeded === true)
    const runIds = [...new Set(items.map((item) => item?.runId).filter(Boolean))]
    const errorCodes = [...new Set(present.map((item) => item.errorCode).filter(Boolean))]
    const contentEmptyConfirmed = domain !== 'local-data-catalog'
      && items.every((item) => item?.contentEmptyConfirmed === true || item?.emptyConfirmed === true)
    result[domain] = {
      schema: DOMAIN_PROVENANCE_SCHEMA,
      runId: runIds.length === 1 && present.length === items.length ? runIds[0] : null,
      source: [...new Set(present.flatMap((item) => item.source || []))].sort(compareCanonicalText),
      attempted: present.some((item) => item.attempted),
      succeeded,
      attemptedAt: latestInstant(present.filter((item) => item.attempted), 'attemptedAt'),
      completedAt: latestInstant(present.filter((item) => item.attempted), 'completedAt'),
      status: derivedStatus(items),
      capturedAt: earliestCompleteInstant(items, 'capturedAt'),
      sourceSucceededAt: earliestCompleteInstant(items, 'sourceSucceededAt'),
      emptyConfirmed: succeeded && completeness === 'complete' && contentEmptyConfirmed,
      contentEmptyConfirmed,
      retainedPrevious: present.some((item) => item.retainedPrevious),
      completeness,
      parserVersion: DERIVED_PROVENANCE_VERSION,
      errorCode: errorCodes.length > 1 ? 'multiple_dependency_errors' : errorCodes[0] || null,
      outcomes: {},
      derivedFrom: [...dependencies],
    }
  }
  return result
}

export function aggregateDomainProvenance(previousDomains, sourceOutcomes, { runId = null } = {}) {
  const previous = normalizeDomainProvenanceMap(previousDomains)
  const sourceMap = objectOrEmpty(sourceOutcomes)
  const domains = new Set(Object.keys(previous))
  for (const outcomes of Object.values(sourceMap)) {
    for (const domain of Object.keys(objectOrEmpty(outcomes))) domains.add(canonicalDomainId(domain))
  }

  const result = { ...previous }
  for (const domain of [...domains].filter(Boolean).sort(compareCanonicalText)) {
    const old = previous[domain] || null
    const outcomes = { ...objectOrEmpty(old?.outcomes) }
    for (const [sourceKey, updates] of Object.entries(sourceMap)) {
      const rawUpdate = objectOrEmpty(updates)[domain]
      if (!rawUpdate) continue
      const prior = outcomes[sourceKey]
      const normalized = normalizeSourceDomainOutcome(rawUpdate, { source: sourceKey, runId })
      outcomes[sourceKey] = preserveCapturedEvidence(prior, normalized)
    }
    const current = Object.values(outcomes).filter((item) => !runId || item.runId === runId)
    if (!current.length) continue
    const attempted = current.filter((item) => item.attempted)
    const successes = attempted.filter((item) => item.succeeded)
    const failures = attempted.filter((item) => !item.succeeded)
    const source = [...new Set(current.flatMap((item) => item.source))].sort(compareCanonicalText)
    const allAttempted = current.every((item) => item.attempted)
    const allSucceeded = allAttempted && current.every((item) => item.succeeded)
    const anyPartial = current.some((item) => item.completeness === 'partial')
    const retainedOldContent = Boolean(old && current.some((item) => (
      !item.attempted || item.retainedPrevious || (!item.succeeded && item.contentEmptyConfirmed)
    )))
    const errorCodes = [...new Set(failures.map((item) => item.errorCode).filter(Boolean))]
    const status = failures.some((item) => item.status === 'auth-required')
      ? 'auth-required'
      : failures.length
        ? 'failed'
        : successes.length
          ? 'succeeded'
          : 'not-attempted'
    result[domain] = {
      schema: DOMAIN_PROVENANCE_SCHEMA,
      runId: textOrNull(runId, 100),
      source,
      attempted: attempted.length > 0,
      succeeded: successes.length > 0,
      attemptedAt: latestInstant(attempted, 'attemptedAt'),
      completedAt: latestInstant(attempted, 'completedAt'),
      status,
      capturedAt: earliestCompleteInstant(current, 'capturedAt'),
      sourceSucceededAt: earliestCompleteInstant(current, 'sourceSucceededAt'),
      emptyConfirmed: allSucceeded && current.every((item) => item.emptyConfirmed),
      contentEmptyConfirmed: current.length > 0 && current.every((item) => item.contentEmptyConfirmed),
      retainedPrevious: current.some((item) => item.retainedPrevious),
      completeness: allSucceeded && !anyPartial && current.every((item) => item.completeness === 'complete')
        ? 'complete'
        : retainedOldContent && !successes.length
          ? old.completeness
          : successes.length || old?.capturedAt || current.some((item) => item.retainedPrevious)
          ? 'partial'
          : 'unknown',
      parserVersion: successes.length && successes.every((item) => item.parserVersion === successes[0].parserVersion)
        ? successes[0].parserVersion
        : old?.parserVersion || null,
      errorCode: errorCodes.length > 1 ? 'multiple_source_errors' : errorCodes[0] || null,
      outcomes,
    }
  }
  return deriveAggregateDomains(result)
}

export function withDomainProvenance(state, sourceOutcomes, { runId } = {}) {
  const normalizedRunId = textOrNull(runId, 100)
  if (!normalizedRunId) throw new TypeError('A domain provenance update requires a runId')
  const snapshot = objectOrEmpty(state)
  const sync = objectOrEmpty(snapshot.sync)
  return {
    ...snapshot,
    sync: {
      ...sync,
      domains: aggregateDomainProvenance(sync.domains, sourceOutcomes, { runId: normalizedRunId }),
    },
  }
}

export function mergeDomainSourceOutcomes(previous, updates) {
  const result = {}
  for (const [source, outcomes] of Object.entries(objectOrEmpty(previous))) {
    result[source] = { ...objectOrEmpty(outcomes) }
  }
  for (const [source, outcomes] of Object.entries(objectOrEmpty(updates))) {
    result[source] = { ...objectOrEmpty(result[source]), ...objectOrEmpty(outcomes) }
  }
  return result
}

export function normalizeDomainProvenanceMap(value) {
  const result = {}
  for (const [rawDomain, rawRecord] of Object.entries(objectOrEmpty(value))) {
    const domain = canonicalDomainId(rawDomain)
    if (!domain) continue
    const raw = objectOrEmpty(rawRecord)
    const aggregate = normalizeSourceDomainOutcome(raw)
    const outcomes = {}
    for (const [source, outcome] of Object.entries(objectOrEmpty(raw.outcomes))) {
      const key = textOrNull(source, 80)
      if (key) outcomes[key] = normalizeSourceDomainOutcome(outcome, { source: key })
    }
    result[domain] = {
      ...aggregate,
      schema: DOMAIN_PROVENANCE_SCHEMA,
      outcomes,
      ...(Array.isArray(raw.derivedFrom)
        ? { derivedFrom: sourceNames(raw.derivedFrom.map(canonicalDomainId).filter(Boolean)) }
        : {}),
    }
  }
  return deriveAggregateDomains(result)
}

export function resultFieldForDomain(domain) {
  return FIELD_BY_DOMAIN[canonicalDomainId(domain)] || null
}
