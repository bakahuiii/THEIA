import {
  COURSE_DECISION_RULES_VERSION,
  createAdvisorOverview,
  createCourseDecisions,
  evaluateAcademic,
  evaluateDataQuality,
  EvidenceRegistry,
} from '../core/advisor/index.mjs'
import {
  AcademicReferenceError,
  createAcademicReferenceCatalog,
  projectAcademicResult,
  projectAdvisorOverview,
  resolveAlternativeSelections,
} from './advisor-academic-references.mjs'

export const ADVISOR_TIME_ZONE = 'Asia/Shanghai'
const QUALITY_KEYS = Object.freeze({
  academicProgress: 'academic-progress',
  schedule: 'schedule',
  grades: 'grades',
  selectedCourses: 'selected-courses',
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
    requirementRefFactory: ({ rawId, path }) => academicCatalog.requirementRef(rawId, path),
  })
  return Object.freeze({
    ...result,
    snapshotRevision: versioned.revision,
  })
}
