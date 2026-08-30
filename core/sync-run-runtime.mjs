import { randomUUID } from 'node:crypto'
import { mergeSyncResult, normalizeSyncPayload } from './schema.mjs'
import { AuthRequiredError } from './source-client.mjs'
import { compactError, sanitizeDiagnosticValue } from './util.mjs'
import {
  mergeById,
  mergeAcademicExtraDomain,
  mergeObjectValue,
  mergeScheduleCollection,
  mergeSingleSourceCollection,
  mergeTermCollection,
} from './sync-merge.mjs'
import {
  aggregateDomainProvenance,
  mergeDomainSourceOutcomes,
} from './domain-provenance.mjs'
import { SyncCancelledError } from './sync-errors.mjs'
import {
  fallbackSourceOutcomes,
  hasRequirementDetails,
  hasRequirementTree,
  mergeTheolCourses,
  normalizeSyncSources,
  outcomeFailureSummary,
  pendingSourceOutcomes,
  sourceOutcome,
} from './sync-helpers.mjs'

export async function runSync(service, {
  sources: requestedSources,
  domainsBySource = {},
  adapterOptionsBySource = {},
  scopedRun = false,
  generation = service.syncGeneration,
  runId = randomUUID(),
  batchStarted = null,
  onSourceSettled = () => {},
  onSourceError = () => {},
  shouldCommitSource = () => true,
} = {}) {
  const sourceNames = normalizeSyncSources({ sources: requestedSources })
  if (!service.isSyncGenerationCurrent(generation)) throw new SyncCancelledError()
  if (batchStarted) {
    await batchStarted
  } else {
    const snapshot = await service.trackSyncWrite(service.store.update((state) => {
      if (!service.isSyncGenerationCurrent(generation)) throw new SyncCancelledError()
      return {
        ...state,
        sync: { ...state.sync, lastStartedAt: new Date().toISOString(), lastError: null, runId },
      }
    }))
    if (!service.isSyncGenerationCurrent(generation)) throw new SyncCancelledError()
    service.onChange(snapshot)
  }

  const results = {}
  const sources = {}
  const appendError = (error, source = null) => {
    const safe = compactError(error)
    if (safe && source) onSourceError(source, safe)
  }
  const adapterBySource = { jwglxt: service.jwglxt, theol: service.theol }
  const adapters = sourceNames.map((name) => [name, adapterBySource[name]])
  let domainOutcomes = Object.fromEntries(adapters.map(([name]) => [
    name,
    pendingSourceOutcomes(name, runId, domainsBySource[name] ?? null),
  ]))
  let latest = service.store.snapshot()

  const commit = async ({ settledSource = null } = {}) => {
    if (!service.isSyncGenerationCurrent(generation)) throw new SyncCancelledError()
    const commitSourceNames = sourceNames.filter((source) => shouldCommitSource(source))
    if (!commitSourceNames.length) return
    const commitResults = Object.fromEntries(commitSourceNames
      .filter((source) => results[source] !== undefined)
      .map((source) => [source, structuredClone(results[source])]))
    const commitSources = Object.fromEntries(commitSourceNames
      .filter((source) => sources[source] !== undefined)
      .map((source) => [source, structuredClone(sources[source])]))
    const commitOutcomes = Object.fromEntries(commitSourceNames
      .filter((source) => domainOutcomes[source] !== undefined)
      .map((source) => [source, structuredClone(domainOutcomes[source])]))
    latest = await service.trackSyncWrite(service.store.update((current) => {
      if (!service.isSyncGenerationCurrent(generation)) throw new SyncCancelledError()
      const sourceItems = (source, domain, key) => {
        const previous = current[key].filter((item) => item.source === source)
        const fresh = commitResults[source]?.[key]
        return mergeSingleSourceCollection(previous, fresh, sourceOutcome(commitOutcomes, source, domain))
      }
      const combined = {
        ...(scopedRun ? {} : { runId }),
        profile: mergeObjectValue(current.profile, commitResults.jwglxt?.profile, sourceOutcome(commitOutcomes, 'jwglxt', 'profile')),
        terms: mergeSingleSourceCollection(current.terms, commitResults.jwglxt?.terms, sourceOutcome(commitOutcomes, 'jwglxt', 'terms')),
        courses: (() => {
          const theolCourseOutcome = sourceOutcome(commitOutcomes, 'theol', 'courses')
          const theolDetailsOutcome = sourceOutcome(commitOutcomes, 'theol', 'course-details')
          const previousTheol = current.courses.filter((item) => item.source === 'theol')
          const freshTheol = commitResults.theol?.courses
          // A details-only run enriches known courses without replacing the roster.
          const theolCourses = theolCourseOutcome
            ? mergeTheolCourses(previousTheol, sourceItems('theol', 'courses', 'courses'))
            : theolDetailsOutcome && Array.isArray(freshTheol)
              ? mergeTheolCourses(previousTheol, freshTheol, { retainUnmatched: true })
              : previousTheol
          return mergeById(
            sourceItems('jwglxt', 'courses', 'courses'),
            theolCourses,
            current.courses.filter((item) => item.source !== 'jwglxt' && item.source !== 'theol'),
          )
        })(),
        schedule: mergeScheduleCollection(current.schedule, commitResults.jwglxt?.schedule, sourceOutcome(commitOutcomes, 'jwglxt', 'schedule')),
        grades: mergeSingleSourceCollection(current.grades, commitResults.jwglxt?.grades, sourceOutcome(commitOutcomes, 'jwglxt', 'grades')),
        selectedCourses: mergeTermCollection(current.selectedCourses, commitResults.jwglxt?.selectedCourses, sourceOutcome(commitOutcomes, 'jwglxt', 'selected-courses')),
        academicProgress: (() => {
          const fresh = commitResults.jwglxt?.academicProgress
          const outcome = sourceOutcome(commitOutcomes, 'jwglxt', 'academic-progress')
          if (fresh === undefined || fresh === null) return current.academicProgress
          if (outcome && !outcome.succeeded) return current.academicProgress
          if (!current.academicProgress) return fresh
          // Keep an official requirement tree when an API summary only refreshes GPA.
          if (outcome?.completeness === 'complete' && hasRequirementTree(fresh)) return fresh
          if (!hasRequirementDetails(current.academicProgress) && hasRequirementDetails(fresh)) return fresh
          return {
            ...current.academicProgress,
            gpa: fresh.gpa ?? current.academicProgress.gpa,
            courseCounts: fresh.courseCounts ?? current.academicProgress.courseCounts,
            capturedAt: fresh.capturedAt ?? current.academicProgress.capturedAt,
            sourceUrl: fresh.sourceUrl ?? current.academicProgress.sourceUrl,
          }
        })(),
        academicExtras: (() => {
          const fresh = commitResults.jwglxt?.academicExtras
          if (!fresh || typeof fresh !== 'object') return current.academicExtras
          const outcomeMap = commitOutcomes.jwglxt || {}
          const domains = { ...(current.academicExtras?.domains || {}) }
          for (const [domain, value] of Object.entries(fresh.domains || {})) {
            const outcome = outcomeMap[domain]
            if (!outcome || outcome.succeeded) {
              domains[domain] = mergeAcademicExtraDomain(domains[domain], value, outcome, domain)
            }
          }
          return { ...(current.academicExtras || {}), ...fresh, domains }
        })(),
        exams: mergeTermCollection(current.exams, commitResults.jwglxt?.exams, sourceOutcome(commitOutcomes, 'jwglxt', 'exams')),
        assignments: mergeSingleSourceCollection(current.assignments, commitResults.theol?.assignments, sourceOutcome(commitOutcomes, 'theol', 'assignments')),
        notices: mergeById(
          sourceItems('jwglxt', 'notices', 'notices'),
          sourceItems('theol', 'notices', 'notices'),
          current.notices.filter((item) => item.source !== 'jwglxt' && item.source !== 'theol'),
        ),
        sources: { ...current.sync.sources, ...commitSources },
        domains: aggregateDomainProvenance(current.sync.domains, commitOutcomes, { runId, sourceNames: commitSourceNames }),
      }
      const merged = mergeSyncResult(current, combined)
      merged.sync.lastError = current.sync.lastError
      return merged
    }))
    if (!service.isSyncGenerationCurrent(generation)) throw new SyncCancelledError()
    if (settledSource) onSourceSettled(settledSource)
    service.onChange(latest)
  }

  let commitQueue = Promise.resolve()
  const queueCommit = (settledSource) => {
    const pending = commitQueue.then(() => commit({ settledSource }))
    // A failed commit must not poison later independent source commits.
    commitQueue = pending.catch(() => undefined)
    return pending
  }
  const syncSource = async (name, adapter) => {
    if (!service.isSyncGenerationCurrent(generation)) throw new SyncCancelledError()
    const attemptedAt = new Date().toISOString()
    let sourceError = null
    service.onProgress({ stage: name, status: 'syncing', ...(scopedRun ? { scope: 'domain' } : {}) })
    try {
      if (adapter.onProgress === null || adapter.onProgress?.theiaSyncService === service) {
        const relayProgress = (progress) => {
          if (service.isSyncGenerationCurrent(generation)) {
            service.onProgress({ ...progress, stage: name, ...(scopedRun ? { scope: 'domain' } : {}) })
          }
        }
        relayProgress.theiaSyncService = service
        adapter.onProgress = relayProgress
      }
      const execute = () => {
        if (!service.isSyncGenerationCurrent(generation)) throw new SyncCancelledError()
        const domains = domainsBySource[name] ?? null
        const adapterOptions = adapterOptionsBySource[name] || {}
        return adapter.sync({ ...adapterOptions, ...(domains === null ? {} : { domains }) })
      }
      const rawResult = name === 'theol'
        ? await service.runTheolExclusive(execute)
        : await execute()
      results[name] = normalizeSyncPayload(rawResult)
      if (!service.isSyncGenerationCurrent(generation)) throw new SyncCancelledError()
      sources[name] = sanitizeDiagnosticValue(results[name].source)
      for (const error of results[name].errors || []) appendError(error, name)
      service.onProgress({ stage: name, status: 'done', ...(scopedRun ? { scope: 'domain' } : {}) })
    } catch (error) {
      if (error instanceof SyncCancelledError || !service.isSyncGenerationCurrent(generation)) throw new SyncCancelledError()
      sourceError = error
      sources[name] = {
        connected: false,
        checkedAt: new Date().toISOString(),
        authRequired: error instanceof AuthRequiredError,
        error: compactError(error),
      }
      appendError(error, name)
      service.onProgress({ stage: name, status: 'error', error: compactError(error), ...(scopedRun ? { scope: 'domain' } : {}) })
    }
    const completedAt = new Date().toISOString()
    domainOutcomes = mergeDomainSourceOutcomes(domainOutcomes, {
      [name]: fallbackSourceOutcomes(name, results[name], service.store.snapshot(), {
        runId,
        attemptedAt,
        completedAt,
        error: sourceError,
        domains: domainsBySource[name] ?? null,
      }),
    })
    const domainFailure = outcomeFailureSummary(name, domainOutcomes[name])
    if (domainFailure) appendError(domainFailure, name)
    await queueCommit(name)
  }

  const sourceSettlements = await Promise.allSettled(adapters.map(([name, adapter]) => syncSource(name, adapter)))
  const failedSource = sourceSettlements.find((settlement) => settlement.status === 'rejected')
  if (failedSource) throw failedSource.reason
  await commitQueue
  if (!service.isSyncGenerationCurrent(generation)) throw new SyncCancelledError()
  const requiredSources = Object.entries(sources).filter(([, value]) => value.authRequired).map(([name]) => name)
  if (requiredSources.length) service.onAuthRequired(requiredSources)
  return latest
}
