import { AuthRequiredError } from './source-client.mjs'
import { mergeSingleSourceCollection } from './sync-merge.mjs'
import {
  SYNC_SOURCE_DOMAINS,
  aggregateDomainProvenance,
  domainHasData,
  domainRecordCount,
  normalizeDomainProvenanceMap,
  resultFieldForDomain,
  sourceDomainOutcome,
} from './domain-provenance.mjs'
import { JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES } from './jwglxt-extra.mjs'

export function failureCode(error) {
  if (error instanceof AuthRequiredError) return 'auth_required'
  if (typeof error?.code === 'string' || typeof error?.code === 'number') return String(error.code)
  return 'source_sync_failed'
}

function sourceHasRetainedData(state, domain, source) {
  const field = resultFieldForDomain(domain)
  if (['courses', 'notices'].includes(domain) && field && Array.isArray(state?.[field])) {
    const records = state[field]
    if (records.some((item) => item?.source === source)) return true
    if (records.some((item) => item?.source)) return false
    const prior = state?.sync?.domains?.[domain]?.outcomes?.[source]
    return Boolean(prior?.capturedAt && records.length)
  }
  return domainHasData(state, domain)
}

function sourceRetainsTermData(state, domain, source, successfulTermIds) {
  const field = resultFieldForDomain(domain)
  if (!field || !Array.isArray(state?.[field])) return false
  const replacedTerms = new Set(Array.isArray(successfulTermIds) ? successfulTermIds : [])
  return state[field].some((item) => {
    if (['courses', 'notices'].includes(domain) && item?.source && item.source !== source) return false
    return !replacedTerms.has(item?.termId)
  })
}

export function receivedRecordCount(domain, field, result) {
  if (!field || !result || !Object.hasOwn(result, field)) return null
  return domainRecordCount({ [field]: result[field] }, domain)
}

export function fallbackSourceOutcomes(source, result, current, { runId, attemptedAt, completedAt, error = null, domains: requestedDomains = null } = {}) {
  const explicit = result?.domainOutcomes && typeof result.domainOutcomes === 'object' ? result.domainOutcomes : {}
  const domains = requestedDomains || SYNC_SOURCE_DOMAINS[source] || []
  return Object.fromEntries(domains.map((domain) => {
    if (explicit[domain]) {
      const didAttempt = explicit[domain].attempted !== false && explicit[domain].status !== 'not-attempted'
      const didSucceed = didAttempt && explicit[domain].succeeded === true
      const field = resultFieldForDomain(domain)
      const previousRecordCount = domainRecordCount(current, domain)
      const latestRecordCount = receivedRecordCount(domain, field, result)
      const unconfirmedEmpty = didSucceed
        && field
        && Array.isArray(result?.[field])
        && result[field].length === 0
        && sourceHasRetainedData(current, domain, source)
        && explicit[domain].emptyConfirmed !== true
      const retainedPrevious = didSucceed && explicit[domain].completeness !== 'complete'
        && Array.isArray(explicit[domain].successfulTermIds) && explicit[domain].successfulTermIds.length
        ? sourceRetainsTermData(current, domain, source, explicit[domain].successfulTermIds)
        : (unconfirmedEmpty || !didSucceed || explicit[domain].completeness !== 'complete') && sourceHasRetainedData(current, domain, source)
      return [domain, sourceDomainOutcome({
        ...explicit[domain],
        source,
        runId,
        completeness: unconfirmedEmpty ? 'partial' : explicit[domain].completeness,
        errorCode: unconfirmedEmpty ? explicit[domain].errorCode || 'unconfirmed_empty_result' : explicit[domain].errorCode,
        attemptedAt: didAttempt ? explicit[domain].attemptedAt || attemptedAt : null,
        completedAt: didAttempt ? explicit[domain].completedAt || completedAt : null,
        sourceSucceededAt: explicit[domain].sourceSucceededAt || (explicit[domain].succeeded ? completedAt : null),
        retainedPrevious: explicit[domain].retainedPrevious === true || retainedPrevious,
        previousRecordCount: explicit[domain].previousRecordCount ?? previousRecordCount,
        receivedRecordCount: explicit[domain].receivedRecordCount ?? latestRecordCount,
      })]
    }
    const field = resultFieldForDomain(domain)
    const provided = field && result && Object.hasOwn(result, field) && result[field] !== undefined
    const sourceFailed = Boolean(error) || result?.source?.connected === false
    const hasErrors = Array.isArray(result?.errors) && result.errors.length > 0
    const attempted = sourceFailed || provided
    const succeeded = provided && !sourceFailed
    return [domain, sourceDomainOutcome({
      source,
      runId,
      attempted,
      succeeded,
      attemptedAt: attempted ? attemptedAt : null,
      completedAt: attempted ? completedAt : null,
      status: sourceFailed ? (error instanceof AuthRequiredError ? 'auth-required' : 'failed') : succeeded ? 'succeeded' : 'not-attempted',
      capturedAt: succeeded ? (result?.capturedAt || result?.source?.checkedAt || completedAt) : null,
      sourceSucceededAt: succeeded ? completedAt : null,
      emptyConfirmed: succeeded && !domainHasData({ ...current, [field]: result[field] }, domain),
      retainedPrevious: (!succeeded || hasErrors) && sourceHasRetainedData(current, domain, source),
      completeness: succeeded && !hasErrors ? 'complete' : succeeded ? 'partial' : 'unknown',
      parserVersion: result?.parserVersion || null,
      errorCode: sourceFailed ? failureCode(error || new Error('source unavailable')) : succeeded && hasErrors ? 'partial_source_errors' : null,
      previousRecordCount: domainRecordCount(current, domain),
      receivedRecordCount: receivedRecordCount(domain, field, result),
    })]
  }))
}

export function pendingSourceOutcomes(source, runId, requestedDomains = null) {
  return Object.fromEntries((requestedDomains || SYNC_SOURCE_DOMAINS[source] || []).map((domain) => [domain, sourceDomainOutcome({
    source,
    runId,
    attempted: false,
    succeeded: false,
    status: 'not-attempted',
    completeness: 'unknown',
  })]))
}

export function sourceOutcome(outcomes, source, domain) {
  return outcomes?.[source]?.[domain] || null
}

const RESOURCE_ID_PARAMETERS = ['resid', 'fileid', 'fileId', 'folderid', 'columnid', 'columnId', 'groupid', 'groupId']
const VOLATILE_RESOURCE_PARAMETERS = new Set(['jsessionid', 'sessionid', 'session', 'sid', 'token', 'timestamp', '_', 't'])

export function courseResourceKey(item) {
  const sourceKey = String(item?.sourceKey || '').trim()
  if (sourceKey) return sourceKey
  try {
    const url = new URL(String(item?.url || ''))
    const identifiers = RESOURCE_ID_PARAMETERS
      .map((name) => [name.toLowerCase(), url.searchParams.get(name)])
      .filter(([, value]) => value)
      .map(([name, value]) => `${name}=${value}`)
    if (identifiers.length) return [String(item?.courseId || ''), String(item?.kind || 'file'), identifiers.join('&')].join(':')
    for (const name of [...url.searchParams.keys()]) {
      if (VOLATILE_RESOURCE_PARAMETERS.has(name.toLowerCase())) url.searchParams.delete(name)
    }
    url.search = [...url.searchParams.entries()]
      .sort(([leftName, leftValue], [rightName, rightValue]) => leftName.localeCompare(rightName) || leftValue.localeCompare(rightValue))
      .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join('&')
    return [String(item?.courseId || ''), String(item?.kind || 'file'), url.toString()].join(':')
  } catch {
    return String(item?.id || '').trim()
  }
}

export function mergeCourseResourceRecords(previous, fresh, { complete = false } = {}) {
  const previousItems = Array.isArray(previous) ? previous : []
  const freshItems = Array.isArray(fresh) ? fresh : []
  const merged = new Map()
  if (!complete) {
    for (const item of previousItems) {
      const key = courseResourceKey(item)
      if (key) merged.set(key, item)
    }
  }
  for (const item of freshItems) {
    const key = courseResourceKey(item)
    if (!key) continue
    merged.set(key, { ...(merged.get(key) || {}), ...item })
  }
  return [...merged.values()]
}

function mergeLocalArtifactRecord(previous, fresh) {
  const merged = { ...(previous || {}), ...(fresh || {}) }
  if (fresh?.localStatus === 'failed' && previous?.localPath) {
    merged.localPath = previous.localPath
    merged.localBytes = previous.localBytes
    merged.localSha256 = previous.localSha256
    merged.localCapturedAt = previous.localCapturedAt
    merged.localStatus = 'stale'
  }
  return merged
}

function mergeTheolCourseRecord(previous, fresh) {
  if (!previous) return fresh
  const merged = mergeLocalArtifactRecord(previous, fresh)
  // A successful page can still omit optional sections when THEOL changes its
  // markup. Keep the last non-empty section until a richer page replaces it.
  for (const field of ['description', 'courseInfo', 'resourceLinks', 'teachingMaterials', 'assignmentLinks']) {
    const oldValue = previous[field]
    const newValue = fresh[field]
    const newIsEmpty = newValue === null || newValue === undefined
      || (Array.isArray(newValue) && newValue.length === 0)
      || (typeof newValue === 'string' && !newValue.trim())
    const oldIsUseful = (Array.isArray(oldValue) && oldValue.length > 0)
      || (oldValue && typeof oldValue === 'object' && !Array.isArray(oldValue) && Object.keys(oldValue).length > 0)
      || (typeof oldValue === 'string' && oldValue.trim())
    if (newIsEmpty && oldIsUseful) merged[field] = oldValue
  }
  // Course details and the personal roster are not authoritative for the
  // manually crawled resource tree. Preserve that tree and its scan metadata
  // even when an older parser supplies an empty courseResources field.
  if (Array.isArray(previous.courseResources)) merged.courseResources = previous.courseResources
  if (previous.courseResourcesCapturedAt && !fresh.courseResourcesCapturedAt) {
    merged.courseResourcesCapturedAt = previous.courseResourcesCapturedAt
  }
  if (previous.courseResourcesScan && !fresh.courseResourcesScan) {
    merged.courseResourcesScan = previous.courseResourcesScan
  }
  return merged
}

export function mergeTheolCourses(previous, fresh, { retainUnmatched = false } = {}) {
  const previousById = new Map((Array.isArray(previous) ? previous : [])
    .filter((item) => item?.id)
    .map((item) => [String(item.id), item]))
  const incoming = Array.isArray(fresh) ? fresh : []
  const merged = incoming.filter((item) => item?.id).map((item) => mergeTheolCourseRecord(previousById.get(String(item.id)), item))
  if (!retainUnmatched) return merged
  const incomingIds = new Set(incoming.filter((item) => item?.id).map((item) => String(item.id)))
  return [...merged, ...(Array.isArray(previous) ? previous.filter((item) => item?.id && !incomingIds.has(String(item.id))) : [])]
}

function uniqueTheolTaskKey(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ''))
    if (url.protocol !== 'https:' || url.hostname !== 'course.buct.edu.cn' || url.port || url.username || url.password) return null
    const entry = [
      { path: '/meol/common/hw/student/hwtask.view.jsp', parameter: 'hwtid', kind: 'assignment' },
      { path: '/meol/common/question/test/student/stu_qtest_navigate.jsp', parameter: 'testId', kind: 'online-test' },
    ].find((candidate) => candidate.path === url.pathname.toLowerCase())
    if (!entry) return null
    const identifiers = url.searchParams.getAll(entry.parameter).map((value) => value.trim()).filter(Boolean)
    return identifiers.length === 1 && /^\d+$/.test(identifiers[0])
      ? `${entry.kind}:${identifiers[0]}`
      : null
  } catch {
    return null
  }
}

export function retainableAssignments(assignments) {
  return assignments.filter((item) => {
    if (item?.source !== 'theol' || !item.sourceUrl) return true
    try {
      const url = new URL(String(item.sourceUrl))
      if (url.hostname !== 'course.buct.edu.cn') return false
    } catch {
      return false
    }
    return Boolean(uniqueTheolTaskKey(item.sourceUrl))
  })
}

export function retainedAssignmentsAfterScan(current, fresh, successfulCourseIds = [], { excludeFreshIds = false } = {}) {
  const freshIds = new Set((fresh || []).map((item) => item?.id).filter(Boolean))
  const freshKeys = new Set((fresh || []).map((item) => uniqueTheolTaskKey(item?.sourceUrl)).filter(Boolean))
  const replacedCourses = new Set(successfulCourseIds.map((courseId) => String(courseId || '').trim()).filter(Boolean))
  return retainableAssignments(current).filter((item) => {
    if (item?.courseId && replacedCourses.has(String(item.courseId).trim())) return false
    if (freshIds.has(item?.id)) return !excludeFreshIds
    const key = uniqueTheolTaskKey(item?.sourceUrl)
    return !key || !freshKeys.has(key)
  })
}

export function mergeAssignmentScan(current, fresh, outcome, successfulCourseIds = []) {
  const retained = retainedAssignmentsAfterScan(current, fresh, successfulCourseIds)
  return mergeSingleSourceCollection(retained, fresh, outcome)
}

export function outcomeFailureSummary(source, outcomes) {
  const failures = Object.entries(outcomes || {})
    .filter(([, outcome]) => outcome?.attempted
      && !outcome.succeeded
      && ['failed', 'auth-required'].includes(outcome.status))
    .map(([domain, outcome]) => `${domain}(${outcome.errorCode || outcome.status})`)
  return failures.length ? `${source} domains incomplete: ${failures.join(', ')}` : null
}

export function hasRequirementDetails(progress) {
  if (!progress || typeof progress !== 'object') return false
  return (Array.isArray(progress.roots) && progress.roots.length > 0)
    || (Array.isArray(progress.categories) && progress.categories.length > 0)
}

export function hasRequirementTree(progress) {
  return Array.isArray(progress?.roots) && progress.roots.length > 0
}

export const SYNC_SOURCE_NAMES = Object.freeze(['jwglxt', 'theol'])
const SHARED_SYNC_DOMAINS = Object.freeze(
  SYNC_SOURCE_NAMES.flatMap((source) => SYNC_SOURCE_DOMAINS[source] || [])
    .filter((domain, index, domains) => domains.indexOf(domain) !== index),
)

export function normalizeSyncSources(options = {}) {
  const requested = Array.isArray(options) ? options : options?.sources
  if (requested === undefined) return [...SYNC_SOURCE_NAMES]
  if (!Array.isArray(requested) || requested.length === 0) {
    throw new TypeError('sync sources must be a non-empty array')
  }
  const sources = [...new Set(requested)]
  const invalid = sources.find((source) => !SYNC_SOURCE_NAMES.includes(source))
  if (invalid) throw new TypeError(`unsupported sync source: ${invalid}`)
  return sources
}

export function normalizeSourceDomains(source, requested) {
  if (requested === undefined || requested === null) return null
  if (!Array.isArray(requested) || requested.length === 0) {
    throw new TypeError('sync domains must be a non-empty array')
  }
  const allowed = SYNC_SOURCE_DOMAINS[source] || []
  const domains = [...new Set(requested)]
  if (source === 'jwglxt' && domains.includes('academic-extras')) {
    domains.splice(domains.indexOf('academic-extras'), 1)
    for (const domain of JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES) {
      if (!domains.includes(domain)) domains.push(domain)
    }
  }
  const invalid = domains.find((domain) => !allowed.includes(domain))
  if (invalid) throw new TypeError(`unsupported ${source} sync domain: ${invalid}`)
  return domains
}

export function normalizeSyncRequest(options = {}) {
  const sources = normalizeSyncSources(options)
  const requestedDomains = Array.isArray(options) ? undefined : options?.domains
  if (requestedDomains !== undefined && sources.length !== 1) {
    throw new TypeError('domain-scoped sync requires exactly one source')
  }
  const domainsBySource = Object.fromEntries(sources.map((source) => [
    source,
    normalizeSourceDomains(source, requestedDomains),
  ]))
  const freeClassroom = !Array.isArray(options) && options?.freeClassroom && typeof options.freeClassroom === 'object'
    ? options.freeClassroom
    : null
  return { sources, domainsBySource, freeClassroom }
}

export function domainSelectionCovers(active, requested, source) {
  // A default JWGLXT run intentionally excludes low-frequency extension
  // pages. Do not let a user-triggered extension read attach to that run and
  // then report a false cache miss after the unrelated fast path completes.
  if (active === null) {
    if (source === 'jwglxt' && requested?.some((domain) => JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES.includes(domain))) return false
    return true
  }
  if (requested === null) return false
  return requested.every((domain) => active.includes(domain))
}

export function mergeDomainSelections(left, right) {
  if (left === null || right === null) return null
  return [...new Set([...(left || []), ...(right || [])])]
}

export function aggregateRunDomains(previousDomains, sourceOutcomes, { runId, sourceNames }) {
  const domains = aggregateDomainProvenance(previousDomains, sourceOutcomes, { runId })
  if (sourceNames.length === SYNC_SOURCE_NAMES.length) return domains

  const selected = new Set(sourceNames)
  const crossRun = aggregateDomainProvenance(previousDomains, sourceOutcomes)
  for (const domain of SHARED_SYNC_DOMAINS) {
    const previousOutcomes = previousDomains?.[domain]?.outcomes || {}
    const hasOmittedEvidence = Object.keys(previousOutcomes).some((source) => !selected.has(source))
    if (hasOmittedEvidence && crossRun[domain]) domains[domain] = crossRun[domain]
  }
  return normalizeDomainProvenanceMap(domains)
}
