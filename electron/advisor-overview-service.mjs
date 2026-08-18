import {
  COURSE_DECISION_CANDIDATE_FIELDS,
  COURSE_DECISION_RULES_VERSION,
  createAdvisorOverview,
  createCourseDecisions,
  evaluateAcademic,
  evaluateDataQuality,
  EvidenceRegistry,
} from '../core/advisor/index.mjs'
import { canonicalDigest, compareCanonicalText, shortDigest } from '../core/advisor/canonical.mjs'
import {
  AcademicReferenceError,
  createAcademicReferenceCatalog,
  projectAdvisorEvidence,
  projectAcademicResult,
  projectAdvisorOverview,
  resolveAlternativeSelections,
} from './advisor-academic-references.mjs'

export const ADVISOR_TIME_ZONE = 'Asia/Shanghai'
const COURSE_DECISION_INPUT_EVIDENCE_SCHEMA = 'theia-advisor-request-input-evidence/v1'
const QUALITY_KEYS = Object.freeze({
  academicProgress: 'academic-progress',
  schedule: 'schedule',
  grades: 'grades',
  selectedCourses: 'selected-courses',
})
const QUALITY_LABELS = Object.freeze({
  'academic-progress': '培养方案数据质量',
  schedule: '课表数据质量',
  grades: '成绩数据质量',
  'selected-courses': '已选课程数据质量',
})
const COMPLETENESS_RANK = Object.freeze({ unknown: 0, partial: 1, complete: 2 })
const MAX_CANDIDATE_TEXT_LENGTH = 2_000
const MAX_CANDIDATE_ID_LENGTH = 512
const MAX_CANDIDATE_SESSION_ITEMS = 64
const MAX_CANDIDATE_VALUE_ITEMS = 64
const MAX_CANDIDATE_ID_ITEMS = 128
const MAX_CANDIDATE_SESSION_TEXT_LENGTH = 256
const CANDIDATE_SESSION_FIELDS = Object.freeze([
  'weekday', 'day', 'period', 'periods', 'weeks',
])

export function advisorOverviewFromStore(store, {
  clock = () => new Date().toISOString(),
  upgradeRule = null,
} = {}) {
  if (!store || typeof store.snapshotWithRevision !== 'function') {
    throw new TypeError('Advisor overview requires a versioned CampusStore snapshot')
  }
  if (typeof clock !== 'function') throw new TypeError('Advisor overview clock must be a function')

  return advisorOverviewFromVersionedSnapshot(store.snapshotWithRevision({ clone: false }), { clock, upgradeRule })
}

export function advisorOverviewFromVersionedSnapshot(versionedSnapshot, {
  clock = () => new Date().toISOString(),
  upgradeRule = null,
} = {}) {
  if (!versionedSnapshot || typeof versionedSnapshot !== 'object') {
    throw new TypeError('Advisor overview requires a versioned snapshot')
  }
  if (typeof clock !== 'function') throw new TypeError('Advisor overview clock must be a function')
  const now = clock()
  const overview = createAdvisorOverview(versionedSnapshot, {
    now,
    timeZone: ADVISOR_TIME_ZONE,
    upgradeRule,
  })
  const state = versionedSnapshot.state ?? versionedSnapshot.snapshot
  const catalog = createAcademicReferenceCatalog({
    academicProgress: state.academicProgress,
    snapshotRevision: versionedSnapshot.revision,
    rulesVersion: overview.rulesVersion,
  })
  return projectAdvisorOverview(overview, catalog)
}

function advisorContext(versionedSnapshot, { clock = () => new Date().toISOString() } = {}) {
  if (typeof clock !== 'function') throw new TypeError('Advisor computation clock must be a function')
  const options = { now: clock(), timeZone: ADVISOR_TIME_ZONE }
  const dataQuality = evaluateDataQuality(versionedSnapshot, options)
  const evidenceRegistry = new EvidenceRegistry(versionedSnapshot, {
    dataQuality,
    rulesVersion: dataQuality.rulesVersion,
  })
  return { versionedSnapshot, options, dataQuality, evidenceRegistry }
}

function frozenSnapshot(store) {
  if (!store || typeof store.snapshotWithRevision !== 'function') {
    throw new TypeError('Advisor computation requires a versioned CampusStore snapshot')
  }
  return store.snapshotWithRevision({ clone: false })
}

function assertExpectedRevision(versionedSnapshot, expectedRevision) {
  if (typeof expectedRevision !== 'string' || !expectedRevision.trim()
    || versionedSnapshot.revision !== expectedRevision.trim()) {
    throw new AcademicReferenceError('stale-snapshot', '顾问数据已更新，请使用当前快照重新计算。')
  }
}

export function advisorAcademicWhatIfFromStore(store, request, { clock = () => new Date().toISOString() } = {}) {
  const versionedSnapshot = frozenSnapshot(store)
  assertExpectedRevision(versionedSnapshot, request?.snapshotRevision)
  const context = advisorContext(versionedSnapshot, { clock })
  const state = versionedSnapshot.state ?? versionedSnapshot.snapshot
  const catalog = createAcademicReferenceCatalog({
    academicProgress: state.academicProgress,
    snapshotRevision: versionedSnapshot.revision,
    rulesVersion: context.dataQuality.rulesVersion,
  })
  const scenario = {
    ...(request?.additionalRequiredCredits === undefined
      ? {}
      : { additionalRequiredCredits: request.additionalRequiredCredits }),
    alternativeSelections: resolveAlternativeSelections(catalog, request?.alternativeSelections),
  }
  const result = evaluateAcademic(context.versionedSnapshot, {
    ...context.options,
    dataQuality: context.dataQuality,
    evidenceRegistry: context.evidenceRegistry,
    scenario,
  })
  return projectAcademicResult(result, catalog)
}

function plainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function projectedText(value, maximum) {
  return typeof value === 'string' ? value.slice(0, maximum) : null
}

function projectedScheduleAtom(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string' || !value.trim()) return undefined
  return value.slice(0, MAX_CANDIDATE_SESSION_TEXT_LENGTH)
}

function projectedScheduleValue(value) {
  if (!Array.isArray(value)) return projectedScheduleAtom(value)
  return value
    .map(projectedScheduleAtom)
    .filter((item) => item !== undefined)
    .slice(0, MAX_CANDIDATE_VALUE_ITEMS)
}

function projectedSessions(value) {
  if (!Array.isArray(value)) return null
  return value
    .slice(0, MAX_CANDIDATE_SESSION_ITEMS)
    .map((session) => {
      if (!plainRecord(session)) return null
      const projected = {}
      for (const field of CANDIDATE_SESSION_FIELDS) {
        if (!Object.hasOwn(session, field)) continue
        const fieldValue = projectedScheduleValue(session[field])
        if (fieldValue !== undefined) projected[field] = fieldValue
      }
      return Object.keys(projected).length ? projected : null
    })
    .filter(Boolean)
}

function projectedIdList(value) {
  if (!Array.isArray(value)) return null
  return value
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.slice(0, MAX_CANDIDATE_ID_LENGTH))
    .slice(0, MAX_CANDIDATE_ID_ITEMS)
}

function candidateRecord(candidate) {
  const source = plainRecord(candidate) ? candidate : {}
  return {
    id: projectedText(source.id, MAX_CANDIDATE_ID_LENGTH),
    courseId: projectedText(source.courseId, MAX_CANDIDATE_ID_LENGTH),
    courseCode: projectedText(source.courseCode, MAX_CANDIDATE_ID_LENGTH),
    title: projectedText(source.title, MAX_CANDIDATE_TEXT_LENGTH),
    credits: typeof source.credits === 'number' && Number.isFinite(source.credits)
      ? source.credits
      : null,
    category: projectedText(source.category, MAX_CANDIDATE_TEXT_LENGTH),
    categoryCode: projectedText(source.categoryCode, MAX_CANDIDATE_ID_LENGTH),
    blockTitle: projectedText(source.blockTitle, MAX_CANDIDATE_TEXT_LENGTH),
    nature: projectedText(source.nature, MAX_CANDIDATE_TEXT_LENGTH),
    termId: projectedText(source.termId, MAX_CANDIDATE_ID_LENGTH),
    time: projectedText(source.time, MAX_CANDIDATE_TEXT_LENGTH),
    weekday: projectedScheduleValue(source.weekday) ?? null,
    period: projectedScheduleValue(source.period) ?? null,
    weeks: projectedScheduleValue(source.weeks) ?? null,
    sessions: projectedSessions(source.sessions),
    requirementNodeId: projectedText(source.requirementNodeId, MAX_CANDIDATE_ID_LENGTH),
    requirementNodeIds: projectedIdList(source.requirementNodeIds),
    officialRequirementId: projectedText(source.officialRequirementId, MAX_CANDIDATE_ID_LENGTH),
    officialRequirementIds: projectedIdList(source.officialRequirementIds),
    requirementCourseId: projectedText(source.requirementCourseId, MAX_CANDIDATE_ID_LENGTH),
    requirementCourseIds: projectedIdList(source.requirementCourseIds),
  }
}

function weakerCompleteness(left, right) {
  const normalizedLeft = Object.hasOwn(COMPLETENESS_RANK, left) ? left : 'unknown'
  const normalizedRight = Object.hasOwn(COMPLETENESS_RANK, right) ? right : 'unknown'
  return COMPLETENESS_RANK[normalizedLeft] <= COMPLETENESS_RANK[normalizedRight]
    ? normalizedLeft
    : normalizedRight
}

function effectiveCompleteness(quality) {
  if (!quality || quality.provenanceInferred === true) return 'unknown'
  if (!['available', 'empty-confirmed'].includes(quality.availability)) return 'unknown'
  if (!Object.hasOwn(COMPLETENESS_RANK, quality.completeness)) return 'unknown'
  if (quality.freshness === 'unknown') return 'unknown'

  const status = quality.lastAttempt?.status || 'never'
  const retainedPrevious = quality.lastAttempt?.retainedPrevious === true
  if (['failed', 'auth-required'].includes(status)) {
    return retainedPrevious && quality.availability === 'available'
      ? weakerCompleteness(quality.completeness, 'partial')
      : 'unknown'
  }
  if (status !== 'succeeded') return 'unknown'

  let result = quality.completeness
  if (quality.freshness === 'stale') result = weakerCompleteness(result, 'partial')
  if (retainedPrevious) result = weakerCompleteness(result, 'partial')
  return result
}

function currentRecordsUsable(quality, effective) {
  return Boolean(quality)
    && quality.provenanceInferred !== true
    && ['available', 'empty-confirmed'].includes(quality.availability)
    && quality.freshness === 'fresh'
    && quality.lastAttempt?.status === 'succeeded'
    && quality.lastAttempt?.retainedPrevious !== true
    && effective !== 'unknown'
}

function candidateInputEvidence(candidates, snapshotRevision) {
  const orderedCandidates = [...candidates]
    .sort((left, right) => compareCanonicalText(left.id, right.id))
  const requestDigest = canonicalDigest({
    schema: COURSE_DECISION_INPUT_EVIDENCE_SCHEMA,
    candidates: orderedCandidates,
  })
  const entries = orderedCandidates.map((candidate) => {
    const evidenceDigest = canonicalDigest({
      schema: COURSE_DECISION_INPUT_EVIDENCE_SCHEMA,
      candidate,
    })
    const identity = {
      schema: COURSE_DECISION_INPUT_EVIDENCE_SCHEMA,
      snapshotRevision,
      requestDigest,
      evidenceDigest,
      fields: COURSE_DECISION_CANDIDATE_FIELDS,
    }
    return Object.freeze({
      id: `iev1:course-selection-candidates:${shortDigest(identity, 16)}:${shortDigest(COURSE_DECISION_CANDIDATE_FIELDS, 12)}`,
      origin: 'request-input',
      dataset: 'course-selection-candidates',
      domain: 'request-input',
      entityId: `entity:${shortDigest({ candidateId: candidate.id }, 16)}`,
      fields: [...COURSE_DECISION_CANDIDATE_FIELDS],
      capturedAt: null,
      source: 'request-input',
      snapshotRevision,
      domainDigest: requestDigest,
      evidenceDigest,
      requestDigest,
      availability: 'available',
      freshness: 'unknown',
      completeness: 'partial',
      label: '本次请求中的候选课程（非 CampusStore 数据）',
      disclosedFields: [...COURSE_DECISION_CANDIDATE_FIELDS],
    })
  })
  return {
    byCandidateId: new Map(orderedCandidates.map((candidate, index) => [candidate.id, entries[index]])),
    entries,
  }
}

export function advisorCourseDecisionsFromStore(store, request, {
  clock = () => new Date().toISOString(),
} = {}) {
  if (!store || typeof store.snapshotWithRevision !== 'function') {
    throw new TypeError('Advisor computation requires a versioned CampusStore snapshot')
  }
  if (typeof clock !== 'function') throw new TypeError('Advisor course decision clock must be a function')
  const versioned = store.snapshotWithRevision({ clone: false })
  assertExpectedRevision(versioned, request?.snapshotRevision)
  const state = versioned.state ?? versioned.snapshot
  const candidates = Array.isArray(request?.candidates) ? request.candidates.map(candidateRecord) : []
  const dataQuality = evaluateDataQuality(versioned, {
    now: clock(),
    timeZone: ADVISOR_TIME_ZONE,
  })
  const evidenceRegistry = new EvidenceRegistry(versioned, {
    dataQuality,
    rulesVersion: COURSE_DECISION_RULES_VERSION,
  })
  const academicCatalog = createAcademicReferenceCatalog({
    academicProgress: state.academicProgress,
    snapshotRevision: versioned.revision,
    rulesVersion: dataQuality.rulesVersion,
  })
  const requestedCompleteness = request?.completeness && typeof request.completeness === 'object'
    ? request.completeness
    : {}
  const authoritativeCompleteness = Object.fromEntries(Object.entries(QUALITY_KEYS).map(([key, domain]) => {
    const storeValue = effectiveCompleteness(dataQuality.domains?.[domain])
    const requestedValue = requestedCompleteness[key]
    if (!Object.hasOwn(COMPLETENESS_RANK, requestedValue)) return [key, storeValue]
    return [key, weakerCompleteness(storeValue, requestedValue)]
  }))
  const inputEvidence = candidateInputEvidence(candidates, versioned.revision)
  const evidenceRefFactory = (specification) => {
    if (!specification) return []
    if (specification.dataset === 'course-selection-candidates') {
      return inputEvidence.byCandidateId.get(specification.entityId)?.id || []
    }
    if (!Object.values(QUALITY_KEYS).includes(specification.domain)) return []
    const quality = dataQuality.domains?.[specification.domain]
    const qualityEvidence = specification.dataset === 'sync-domain'
    const evidence = evidenceRegistry.register({
      ...specification,
      ...(qualityEvidence ? {
        capturedAt: quality?.capturedAt || null,
        source: quality?.source?.[0] || null,
        label: QUALITY_LABELS[specification.domain] || '校园数据质量',
        evidenceDigest: canonicalDigest({
          domain: quality?.domain || specification.domain,
          availability: quality?.availability || 'unknown',
          freshness: quality?.freshness || 'unknown',
          completeness: quality?.completeness || 'unknown',
          capturedAt: quality?.capturedAt || null,
          sourceSucceededAt: quality?.sourceSucceededAt || null,
          source: quality?.source || [],
          parserVersion: quality?.parserVersion || null,
          recordCount: quality?.recordCount || 0,
          contentEmptyConfirmed: quality?.contentEmptyConfirmed === true,
          contentDigest: quality?.contentDigest || null,
          lastAttempt: quality?.lastAttempt || null,
          provenanceInferred: quality?.provenanceInferred !== false,
        }),
      } : {}),
    })
    evidenceRegistry.disclose(evidence.id, specification.fields)
    return evidence.id
  }
  const result = createCourseDecisions({
    candidates,
    academicProgress: state.academicProgress,
    schedule: state.schedule,
    grades: state.grades,
    selectedCourses: state.selectedCourses,
    schoolScheduleComplete: authoritativeCompleteness.schedule === 'complete'
      && request?.schoolScheduleComplete !== false,
    completeness: authoritativeCompleteness,
    currentRecords: {
      schedule: currentRecordsUsable(
        dataQuality.domains?.schedule,
        authoritativeCompleteness.schedule,
      ),
      selectedCourses: currentRecordsUsable(
        dataQuality.domains?.['selected-courses'],
        authoritativeCompleteness.selectedCourses,
      ),
    },
  }, {
    rulesVersion: COURSE_DECISION_RULES_VERSION,
    evidenceRefFactory,
    requirementRefFactory: ({ rawId, path }) => academicCatalog.requirementRef(rawId, path),
  })
  const referencedEvidence = new Set(result.decisions.flatMap((decision) => decision.evidenceRefs))
  const evidence = [
    ...evidenceRegistry.list(),
    ...inputEvidence.entries,
  ]
    .filter((entry) => referencedEvidence.has(entry.id))
    .sort((left, right) => compareCanonicalText(left.id, right.id))
    .map(projectAdvisorEvidence)
  return Object.freeze({
    ...result,
    snapshotRevision: versioned.revision,
    evidence,
  })
}
