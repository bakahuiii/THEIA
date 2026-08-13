import {
  ACADEMIC_CALENDAR_ASSETS_PARSER_VERSION,
  FITNESS_PARSER_VERSION,
  SCHOOL_SCHEDULE_PARSER_VERSION,
  cacheAcademicCalendarAssets,
  cacheFitnessResults,
  cacheSchoolScheduleResult,
  normalizeFitnessResult,
} from './data-catalog.mjs'
import { canonicalDigest } from './advisor/canonical.mjs'
import { domainHasData, domainPayload, sourceDomainOutcome, withDomainProvenance } from './domain-provenance.mjs'

const FITNESS_YEAR = /^20\d{2}-20\d{2}_\d+$/
const CALENDAR_ASSET_KEYS = ['calendar', 'teachingSchedule', 'weeklyCalendar']

function instant(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
}

function stateWithCatalog(state, dataCatalog) {
  return { ...state, dataCatalog }
}

function applyOutcomes(state, sourceOutcomes, runId) {
  return withDomainProvenance(state, sourceOutcomes, { runId })
}

function failureOutcome(state, domain, {
  source,
  runId,
  attemptedAt,
  completedAt,
  status = 'failed',
  errorCode,
  parserVersion,
}) {
  const previous = state?.sync?.domains?.[domain]
  return applyOutcomes(state, {
    [source]: {
      [domain]: sourceDomainOutcome({
        source,
        runId,
        attemptedAt,
        completedAt,
        status,
        attempted: true,
        succeeded: false,
        capturedAt: previous?.capturedAt,
        sourceSucceededAt: previous?.sourceSucceededAt,
        contentEmptyConfirmed: state?.sync?.domains?.[domain]?.contentEmptyConfirmed === true
          || state?.sync?.domains?.[domain]?.emptyConfirmed === true,
        retainedPrevious: domainHasData(state, domain),
        completeness: 'unknown',
        parserVersion,
        errorCode,
      }),
    },
  }, runId)
}

function calendarCompleteness(manifest) {
  const hasEveryAsset = CALENDAR_ASSET_KEYS.every((key) => manifest?.assets?.[key])
  const hasStructuredContent = Boolean(manifest?.calendar && manifest?.analysis)
  const hasParserError = Boolean(manifest?.calendarError || manifest?.analysisError)
  return instant(manifest?.updatedAt) && hasEveryAsset && hasStructuredContent && !hasParserError ? 'complete' : 'partial'
}

export function loadAcademicCalendarCatalog(state, { manifest, runId }) {
  const hasLocalManifest = Boolean(
    instant(manifest?.updatedAt)
    || manifest?.calendar
    || manifest?.analysis
    || Object.keys(manifest?.assets || {}).length,
  )
  const next = hasLocalManifest
    ? stateWithCatalog(state, cacheAcademicCalendarAssets(state.dataCatalog, manifest))
    : state
  const previous = state?.sync?.domains?.['academic-calendar']
  const contentChanged = canonicalDigest(domainPayload(state, 'academic-calendar'))
    !== canonicalDigest(domainPayload(next, 'academic-calendar'))
  if (previous && !contentChanged) return next
  const domains = { ...next?.sync?.domains }
  delete domains['academic-calendar']
  const withoutStaleEvidence = {
    ...next,
    sync: { ...next.sync, domains },
  }
  return applyOutcomes(withoutStaleEvidence, {
    'academic-calendar': {
      'academic-calendar': sourceDomainOutcome({
        source: 'academic-calendar',
        runId,
        attempted: false,
        status: 'not-attempted',
        retainedPrevious: false,
        completeness: 'unknown',
        parserVersion: ACADEMIC_CALENDAR_ASSETS_PARSER_VERSION,
      }),
    },
  }, runId)
}

export function updateAcademicCalendarCatalog(state, {
  manifest,
  runId,
  attemptedAt,
  completedAt,
}) {
  const next = stateWithCatalog(state, cacheAcademicCalendarAssets(state.dataCatalog, manifest))
  const capturedAt = instant(manifest?.updatedAt)
  return applyOutcomes(next, {
    'academic-calendar': {
      'academic-calendar': sourceDomainOutcome({
        source: 'academic-calendar',
        runId,
        attemptedAt,
        completedAt,
        status: 'succeeded',
        attempted: true,
        succeeded: true,
        capturedAt,
        sourceSucceededAt: capturedAt || completedAt,
        emptyConfirmed: false,
        retainedPrevious: false,
        completeness: calendarCompleteness(manifest),
        parserVersion: ACADEMIC_CALENDAR_ASSETS_PARSER_VERSION,
        errorCode: manifest?.calendarError
          ? 'academic_calendar_parse_failed'
          : manifest?.analysisError ? 'academic_calendar_analysis_failed' : null,
      }),
    },
  }, runId)
}

export function failAcademicCalendarCatalog(state, options) {
  return failureOutcome(state, 'academic-calendar', {
    ...options,
    source: 'academic-calendar',
    parserVersion: ACADEMIC_CALENDAR_ASSETS_PARSER_VERSION,
  })
}

function fitnessYearKeys(results) {
  const declared = new Set()
  for (const result of results) {
    for (const entry of Array.isArray(result?.availableYears) ? result.availableYears : []) {
      if (FITNESS_YEAR.test(String(entry?.yearKey || ''))) declared.add(String(entry.yearKey))
    }
  }
  for (const result of results) {
    if (FITNESS_YEAR.test(String(result?.yearKey || ''))) declared.add(String(result.yearKey))
  }
  return [...declared].sort()
}

function fitnessEmpty(result) {
  const normalized = normalizeFitnessResult(result)
  return ['vitality', 'run50', 'flex', 'jump', 'strength', 'endureSecs']
    .every((field) => normalized[field] === null)
}

export function updateFitnessCatalog(state, {
  results = [],
  failures = [],
  runId,
  attemptedAt,
  completedAt,
  capturedAt = completedAt,
}) {
  const validResults = (Array.isArray(results) ? results : []).filter((result) => FITNESS_YEAR.test(String(result?.yearKey || '')))
  const resultByYear = new Map(validResults.map((result) => [String(result.yearKey), result]))
  const failureByYear = new Map((Array.isArray(failures) ? failures : [])
    .filter((item) => FITNESS_YEAR.test(String(item?.yearKey || '')))
    .map((item) => [String(item.yearKey), item]))
  const declaredYears = fitnessYearKeys(validResults)
  for (const yearKey of failureByYear.keys()) if (!declaredYears.includes(yearKey)) declaredYears.push(yearKey)
  const completeRefresh = declaredYears.length > 0
    && declaredYears.every((yearKey) => resultByYear.has(yearKey))
    && failureByYear.size === 0
  const next = validResults.length
    ? stateWithCatalog(state, cacheFitnessResults(state.dataCatalog, validResults, capturedAt, {
      markRefreshed: completeRefresh,
    }))
    : state

  const outcomes = {}
  for (const yearKey of declaredYears.sort()) {
    const result = resultByYear.get(yearKey)
    const failure = failureByYear.get(yearKey)
    const sourceKey = `fitness:${yearKey}`
    outcomes[sourceKey] = {
      fitness: sourceDomainOutcome(result ? {
        source: 'tygl', runId, attemptedAt, completedAt, status: 'succeeded', attempted: true, succeeded: true,
        capturedAt, sourceSucceededAt: completedAt, emptyConfirmed: fitnessEmpty(result), completeness: 'complete',
        parserVersion: FITNESS_PARSER_VERSION,
      } : {
        source: 'tygl', runId, attemptedAt, completedAt, status: failure?.status || 'failed', attempted: true,
        succeeded: false, retainedPrevious: Boolean(state?.dataCatalog?.collections?.fitness?.records?.[yearKey]),
        completeness: 'unknown', parserVersion: FITNESS_PARSER_VERSION,
        errorCode: failure?.errorCode || 'fitness_year_read_failed',
      }),
    }
  }
  if (!Object.keys(outcomes).length) {
    outcomes.fitness = {
      fitness: sourceDomainOutcome({
        source: 'tygl', runId, attemptedAt, completedAt, status: 'failed', attempted: true, succeeded: false,
        retainedPrevious: domainHasData(state, 'fitness'), completeness: 'unknown', parserVersion: FITNESS_PARSER_VERSION,
        errorCode: 'fitness_years_not_discovered',
      }),
    }
  }
  return applyOutcomes(next, outcomes, runId)
}

export function failFitnessCatalog(state, options) {
  return failureOutcome(state, 'fitness', {
    ...options,
    source: 'fitness',
    parserVersion: FITNESS_PARSER_VERSION,
  })
}

export function updateSchoolScheduleCatalog(state, {
  result,
  runId,
  attemptedAt,
  completedAt,
}) {
  const next = stateWithCatalog(state, cacheSchoolScheduleResult(state.dataCatalog, result, result?.capturedAt || completedAt))
  const complete = result?.complete === true
  const items = Array.isArray(result?.items) ? result.items : []
  const emptyConfirmed = complete && items.length === 0 && Number(result?.total || 0) === 0
  return applyOutcomes(next, {
    'school-schedule': {
      'school-schedule': sourceDomainOutcome({
        source: 'jwglxt-school-schedule', runId, attemptedAt, completedAt, status: 'succeeded', attempted: true,
        succeeded: true, capturedAt: result?.capturedAt || completedAt, sourceSucceededAt: completedAt,
        emptyConfirmed, completeness: complete ? 'complete' : 'partial', parserVersion: SCHOOL_SCHEDULE_PARSER_VERSION,
        errorCode: complete ? null : 'school_schedule_incomplete',
      }),
    },
  }, runId)
}

export function failSchoolScheduleCatalog(state, options) {
  return failureOutcome(state, 'school-schedule', {
    ...options,
    source: 'school-schedule',
    parserVersion: SCHOOL_SCHEDULE_PARSER_VERSION,
  })
}
