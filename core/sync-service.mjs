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
  SYNC_SOURCE_DOMAINS,
  aggregateDomainProvenance,
  domainHasData,
  domainRecordCount,
  mergeDomainSourceOutcomes,
  normalizeDomainProvenanceMap,
  resultFieldForDomain,
  sourceDomainOutcome,
} from './domain-provenance.mjs'
import { JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES } from './jwglxt-extra.mjs'

function failureCode(error) {
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

function receivedRecordCount(domain, field, result) {
  if (!field || !result || !Object.hasOwn(result, field)) return null
  return domainRecordCount({ [field]: result[field] }, domain)
}

function fallbackSourceOutcomes(source, result, current, { runId, attemptedAt, completedAt, error = null, domains: requestedDomains = null } = {}) {
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

function pendingSourceOutcomes(source, runId, requestedDomains = null) {
  return Object.fromEntries((requestedDomains || SYNC_SOURCE_DOMAINS[source] || []).map((domain) => [domain, sourceDomainOutcome({
    source,
    runId,
    attempted: false,
    succeeded: false,
    status: 'not-attempted',
    completeness: 'unknown',
  })]))
}

function sourceOutcome(outcomes, source, domain) {
  return outcomes?.[source]?.[domain] || null
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

function retainableAssignments(assignments) {
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

function retainedAssignmentsAfterScan(current, fresh, successfulCourseIds = [], { excludeFreshIds = false } = {}) {
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

function mergeAssignmentScan(current, fresh, outcome, successfulCourseIds = []) {
  const retained = retainedAssignmentsAfterScan(current, fresh, successfulCourseIds)
  return mergeSingleSourceCollection(retained, fresh, outcome)
}

function outcomeFailureSummary(source, outcomes) {
  const failures = Object.entries(outcomes || {})
    .filter(([, outcome]) => outcome?.attempted
      && !outcome.succeeded
      && ['failed', 'auth-required'].includes(outcome.status))
    .map(([domain, outcome]) => `${domain}(${outcome.errorCode || outcome.status})`)
  return failures.length ? `${source} domains incomplete: ${failures.join(', ')}` : null
}

function hasRequirementDetails(progress) {
  if (!progress || typeof progress !== 'object') return false
  return (Array.isArray(progress.roots) && progress.roots.length > 0)
    || (Array.isArray(progress.categories) && progress.categories.length > 0)
}

function hasRequirementTree(progress) {
  return Array.isArray(progress?.roots) && progress.roots.length > 0
}

const SYNC_SOURCE_NAMES = Object.freeze(['jwglxt', 'theol'])
const SHARED_SYNC_DOMAINS = Object.freeze(
  SYNC_SOURCE_NAMES.flatMap((source) => SYNC_SOURCE_DOMAINS[source] || [])
    .filter((domain, index, domains) => domains.indexOf(domain) !== index),
)

function normalizeSyncSources(options = {}) {
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

function normalizeSourceDomains(source, requested) {
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

function normalizeSyncRequest(options = {}) {
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

function domainSelectionCovers(active, requested, source) {
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

function mergeDomainSelections(left, right) {
  if (left === null || right === null) return null
  return [...new Set([...(left || []), ...(right || [])])]
}

export class SyncDisabledError extends Error {
  constructor(message = 'Campus sync is disabled') {
    super(message)
    this.name = 'SyncDisabledError'
    this.code = 'sync_disabled'
  }
}

export class SyncCancelledError extends Error {
  constructor(message = 'Campus sync was cancelled') {
    super(message)
    this.name = 'SyncCancelledError'
    this.code = 'sync_cancelled'
  }
}

function aggregateRunDomains(previousDomains, sourceOutcomes, { runId, sourceNames }) {
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

export class SyncService {
  constructor({
    store,
    jwglxt,
    theol,
    onChange = () => {},
    onAuthRequired = () => {},
    onProgress = () => {},
    onBackgroundError = () => {},
  }) {
    this.store = store
    this.jwglxt = jwglxt
    this.theol = theol
    this.onChange = onChange
    this.onAuthRequired = onAuthRequired
    this.onProgress = onProgress
    this.onBackgroundError = onBackgroundError
    this.active = null
    this.activeRuns = new Set()
    this.activeBySource = new Map()
    this.sourceRunVersions = new Map(SYNC_SOURCE_NAMES.map((source) => [source, 0]))
    this.queuedSyncBySource = new Map()
    this.syncBatchOpen = false
    this.syncBatchRunId = null
    this.syncBatchGeneration = null
    this.syncBatchSourceErrors = new Map()
    this.syncBatchErrors = new Set()
    this.syncBatchStarting = null
    this.syncBatchFinishing = null
    this.syncBatchDomainScoped = false
    this.syncWrites = new Set()
    this.assignmentScanPending = false
    this.syncGeneration = 0
    this.syncDisabled = false
    this.theolQueue = Promise.resolve()
    this.assignmentActive = null
    this.assignmentTimer = null
    this.assignmentRequestedRunId = null
    this.assignmentAbortController = null
    this.assignmentGeneration = 0
    this.assignmentPauseCount = 0
    this.assignmentDisabled = false
    this.timer = null
    this.autoSyncInFlight = null
  }

  async status() {
    const generation = this.syncGeneration
    const cachedTheol = this.store.snapshot().sync.sources?.theol
    const theolStatus = (this.assignmentActive || this.assignmentTimer) && cachedTheol?.connected
      ? Promise.resolve(cachedTheol)
      : this.runTheolExclusive(() => {
          if (!this.isSyncGenerationCurrent(generation)) throw new SyncCancelledError()
          return this.theol.status()
        })
    const [jwglxt, theol] = await Promise.all([
      this.jwglxt.status(),
      theolStatus,
    ])
    return { jwglxt, theol }
  }

  async syncNow(options = {}) {
    const { sources, domainsBySource, freeClassroom } = normalizeSyncRequest(options)
    const foreground = options?.foreground === true
    if (this.syncDisabled) throw new SyncDisabledError()
    if (this.syncBatchFinishing) {
      await this.syncBatchFinishing
      return this.syncNow({
        sources,
        foreground,
        ...(sources.length === 1 && domainsBySource[sources[0]] !== null
          ? { domains: domainsBySource[sources[0]] }
          : {}),
        ...(freeClassroom ? { freeClassroom } : {}),
      })
    }
    const generation = this.syncGeneration
    const adapterOptionsBySource = freeClassroom ? { jwglxt: { freeClassroom } } : {}
    const idleSources = []
    const pending = []
    for (const source of sources) {
      const active = this.activeBySource.get(source)
      if (!active) {
        idleSources.push(source)
      } else if (
        active.generation === generation
        && active.pendingSources.has(source)
        && !freeClassroom
        && domainSelectionCovers(active.domainsBySource[source], domainsBySource[source], source)
      ) {
        pending.push(active.promise)
      } else {
        pending.push(this.queueSyncSource(source, generation, domainsBySource[source], foreground, adapterOptionsBySource[source] || {}))
      }
    }
    if (idleSources.length) {
      pending.push(this.startSync(
        idleSources,
        generation,
        Object.fromEntries(idleSources.map((source) => [source, domainsBySource[source]])),
        { foreground, adapterOptionsBySource },
      ))
    }
    const snapshots = await Promise.all(pending)
    return snapshots.length === 1 ? snapshots[0] : this.store.snapshot()
  }

  startSync(sources, generation, domainsBySource = {}, { foreground = false, adapterOptionsBySource = {} } = {}) {
    if (this.syncDisabled) return Promise.reject(new SyncDisabledError())
    if (generation !== this.syncGeneration) return Promise.reject(new SyncCancelledError())
    if (sources.some((source) => this.activeBySource.has(source))) {
      throw new Error('Cannot start overlapping sync runs for the same source')
    }
    const resumeAssignmentScan = this.assignmentScanPending
      || Boolean(this.assignmentRequestedRunId)
      || Boolean(this.assignmentActive)
    const domainScoped = !foreground && sources.some((source) => domainsBySource[source] !== null && domainsBySource[source] !== undefined)
    const batch = this.beginSyncBatch(generation, { domainScoped })
    this.cancelAssignmentScan()
    this.assignmentScanPending = resumeAssignmentScan
    const record = {
      generation,
      sources: new Set(sources),
      sourceVersions: new Map(),
      pendingSources: new Set(sources),
      domainsBySource: Object.fromEntries(sources.map((source) => [source, domainsBySource[source] ?? null])),
      adapterOptionsBySource: Object.fromEntries(sources.map((source) => [source, adapterOptionsBySource[source] || {}])),
      promise: null,
    }
    this.activeRuns.add(record)
    for (const source of sources) {
      const version = (this.sourceRunVersions.get(source) || 0) + 1
      this.sourceRunVersions.set(source, version)
      record.sourceVersions.set(source, version)
      this.syncBatchSourceErrors.set(source, { version, errors: new Set() })
      this.activeBySource.set(source, record)
    }
    const pending = this.run({
      sources,
      generation,
      runId: batch.runId,
      batchStarted: batch.started,
      domainsBySource: record.domainsBySource,
      adapterOptionsBySource: record.adapterOptionsBySource,
      scopedRun: domainScoped,
      onSourceSettled: (source) => {
        record.pendingSources.delete(source)
        if (this.activeBySource.get(source) === record) this.activeBySource.delete(source)
        this.flushQueuedSync()
      },
      onSourceError: (source, error) => {
        this.recordSyncBatchSourceError(source, record.sourceVersions.get(source), error, generation)
      },
      shouldCommitSource: (source) => this.sourceRunVersions.get(source) === record.sourceVersions.get(source),
    })
      .then((snapshot) => {
        if (
          this.isSyncGenerationCurrent(generation)
          && sources.includes('theol')
          && record.domainsBySource.theol === null
        ) {
          this.assignmentScanPending = true
        }
        return snapshot
      })
      .catch((error) => {
        if (!(error instanceof SyncCancelledError) && this.isSyncGenerationCurrent(generation)) {
          this.recordSyncBatchError(error, generation)
        }
        throw error
      })
      .finally(async () => {
        this.activeRuns.delete(record)
        for (const source of sources) {
          if (this.activeBySource.get(source) === record) this.activeBySource.delete(source)
        }
        this.refreshActive()
        this.flushQueuedSync()
        await this.finishSyncBatchIfIdle()
      })
      .then(() => this.store.snapshot())
    record.promise = pending
    this.refreshActive()
    return pending
  }

  beginSyncBatch(generation, { domainScoped = false } = {}) {
    if (this.syncBatchOpen) {
      if (this.syncBatchGeneration !== generation) throw new SyncCancelledError()
      if (!domainScoped && this.syncBatchDomainScoped) {
        this.syncBatchDomainScoped = false
        const runId = this.syncBatchRunId
        const startedAt = new Date().toISOString()
        this.syncBatchStarting = Promise.resolve(this.syncBatchStarting)
          .then(() => this.trackSyncWrite(this.store.update((state) => {
            if (!this.isSyncGenerationCurrent(generation) || this.syncBatchRunId !== runId) {
              throw new SyncCancelledError()
            }
            return {
              ...state,
              sync: { ...state.sync, lastStartedAt: startedAt, lastError: null, runId },
            }
          })))
          .then((snapshot) => {
            this.onChange(snapshot)
            return snapshot
          })
        this.onProgress({ stage: 'all', status: 'syncing', label: '正在更新校园数据' })
      }
      return { runId: this.syncBatchRunId, started: this.syncBatchStarting }
    }
    this.syncBatchOpen = true
    this.syncBatchRunId = randomUUID()
    this.syncBatchGeneration = generation
    this.syncBatchDomainScoped = domainScoped
    this.syncBatchSourceErrors.clear()
    this.syncBatchErrors.clear()
    const runId = this.syncBatchRunId
    const startedAt = new Date().toISOString()
    const startWrite = domainScoped
      ? Promise.resolve(this.store.snapshot())
      : this.trackSyncWrite(this.store.update((state) => {
          if (!this.isSyncGenerationCurrent(generation) || this.syncBatchRunId !== runId) {
            throw new SyncCancelledError()
          }
          return {
            ...state,
            sync: { ...state.sync, lastStartedAt: startedAt, lastError: null, runId },
          }
        }))
    this.syncBatchStarting = startWrite.then((snapshot) => {
      if (!this.isSyncGenerationCurrent(generation) || this.syncBatchRunId !== runId) {
        throw new SyncCancelledError()
      }
      if (!domainScoped) this.onChange(snapshot)
      return snapshot
    })
    this.onProgress({
      stage: 'all',
      status: 'syncing',
      label: domainScoped ? '正在单独获取数据' : '正在更新校园数据',
      ...(domainScoped ? { scope: 'domain' } : {}),
    })
    return { runId, started: this.syncBatchStarting }
  }

  recordSyncBatchError(error, generation = this.syncGeneration) {
    if (!this.isSyncGenerationCurrent(generation) || this.syncBatchGeneration !== generation) return
    const safe = compactError(error)
    if (safe) this.syncBatchErrors.add(safe)
  }

  recordSyncBatchSourceError(source, version, error, generation = this.syncGeneration) {
    if (!this.isSyncGenerationCurrent(generation) || this.syncBatchGeneration !== generation) return
    const record = this.syncBatchSourceErrors.get(source)
    if (!record || record.version !== version) return
    const safe = compactError(error)
    if (safe) record.errors.add(safe)
  }

  currentSyncBatchErrors() {
    return [...new Set([
      ...this.syncBatchErrors,
      ...[...this.syncBatchSourceErrors.values()].flatMap((record) => [...record.errors]),
    ])]
  }

  async finishSyncBatchIfIdle() {
    if (this.activeRuns.size || this.queuedSyncBySource.size || !this.syncBatchOpen) return
    if (this.syncBatchFinishing) return this.syncBatchFinishing
    const generation = this.syncBatchGeneration
    const runId = this.syncBatchRunId
    const errors = this.currentSyncBatchErrors()
    const domainScoped = this.syncBatchDomainScoped
    const finishing = (async () => {
      try {
        if (!this.isSyncGenerationCurrent(generation)) throw new SyncCancelledError()
        const snapshot = domainScoped
          ? this.store.snapshot()
          : await this.trackSyncWrite(this.store.update((current) => {
              if (!this.isSyncGenerationCurrent(generation) || this.syncBatchRunId !== runId) {
                throw new SyncCancelledError()
              }
              return mergeSyncResult(current, { runId, errors, completed: true })
            }))
        if (!this.isSyncGenerationCurrent(generation)) throw new SyncCancelledError()
        if (!domainScoped) this.onChange(snapshot)
        this.onProgress({
          stage: 'all',
          status: errors.length ? 'error' : 'done',
          ...(errors.length ? { error: errors.join('; ') } : {}),
          ...(domainScoped ? { scope: 'domain' } : {}),
        })
        if (this.assignmentScanPending && !this.syncDisabled) {
          this.assignmentScanPending = false
          this.scheduleAssignmentScan(runId)
        }
        return snapshot
      } catch (error) {
        if (!(error instanceof SyncCancelledError) && this.isSyncGenerationCurrent(generation)) {
          this.onProgress({ stage: 'all', status: 'error', error: compactError(error) })
        }
        throw error
      }
    })()
    this.syncBatchFinishing = finishing
    try {
      return await finishing
    } finally {
      if (this.syncBatchFinishing === finishing) {
        this.syncBatchOpen = false
        this.syncBatchRunId = null
        this.syncBatchGeneration = null
        this.syncBatchSourceErrors.clear()
        this.syncBatchErrors.clear()
        this.syncBatchStarting = null
        this.syncBatchFinishing = null
        this.syncBatchDomainScoped = false
        this.flushAssignmentScan()
      }
    }
  }

  queueSyncSource(source, generation, domains = null, foreground = false, adapterOptions = {}) {
    const existing = this.queuedSyncBySource.get(source)
    if (existing?.generation === generation) {
      existing.domains = mergeDomainSelections(existing.domains, domains)
      existing.foreground ||= foreground
      existing.adapterOptions = { ...(existing.adapterOptions || {}), ...adapterOptions }
      return existing.promise
    }
    if (existing) {
      this.queuedSyncBySource.delete(source)
      existing.reject(new SyncCancelledError())
    }
    let resolveRequest
    let rejectRequest
    const promise = new Promise((resolve, reject) => {
      resolveRequest = resolve
      rejectRequest = reject
    })
    this.queuedSyncBySource.set(source, {
      source,
      generation,
      domains,
      foreground,
      adapterOptions,
      promise,
      resolve: resolveRequest,
      reject: rejectRequest,
    })
    return promise
  }

  flushQueuedSync() {
    const ready = []
    for (const [source, request] of this.queuedSyncBySource) {
      if (this.activeBySource.has(source)) continue
      this.queuedSyncBySource.delete(source)
      if (this.syncDisabled) {
        request.reject(new SyncDisabledError())
      } else if (request.generation !== this.syncGeneration) {
        request.reject(new SyncCancelledError())
      } else {
        ready.push(request)
      }
    }
    if (!ready.length) return
    const generation = ready[0].generation
    const run = this.startSync(
      ready.map((request) => request.source),
      generation,
      Object.fromEntries(ready.map((request) => [request.source, request.domains])),
      { foreground: ready.some((request) => request.foreground), adapterOptionsBySource: Object.fromEntries(ready.map((request) => [request.source, request.adapterOptions || {}])) },
    )
    for (const request of ready) run.then(request.resolve, request.reject)
  }

  rejectQueuedSync(error) {
    const requests = [...this.queuedSyncBySource.values()]
    this.queuedSyncBySource.clear()
    for (const request of requests) request.reject(error)
  }

  refreshActive() {
    const promises = [...this.activeRuns].map((record) => record.promise).filter(Boolean)
    this.active = promises.length
      ? Promise.allSettled(promises).then(() => this.store.snapshot())
      : null
  }

  hasActiveSync() {
    return this.activeRuns.size > 0 || Boolean(this.syncBatchFinishing)
  }

  trackSyncWrite(promise) {
    const pending = Promise.resolve(promise)
    this.syncWrites.add(pending)
    void pending.finally(() => this.syncWrites.delete(pending)).catch(() => {})
    return pending
  }

  async waitForSyncWrites() {
    while (this.syncWrites.size) {
      await Promise.allSettled([...this.syncWrites])
    }
  }

  isSyncGenerationCurrent(generation) {
    return !this.syncDisabled && generation === this.syncGeneration
  }

  cancelSync() {
    this.syncGeneration += 1
    this.rejectQueuedSync(new SyncCancelledError())
    this.assignmentScanPending = false
    this.syncBatchOpen = false
    this.syncBatchRunId = null
    this.syncBatchGeneration = null
    this.syncBatchSourceErrors.clear()
    this.syncBatchErrors.clear()
    this.syncBatchStarting = null
    this.syncBatchDomainScoped = false
    this.cancelAssignmentScan()
  }

  disable() {
    this.syncDisabled = true
    this.cancelSync()
    this.disableAssignmentScan()
  }

  enable() {
    this.syncDisabled = false
  }

  async cancelAndWait() {
    const finishing = this.syncBatchFinishing
    this.cancelSync()
    const active = [...this.activeRuns].map((record) => record.promise)
    await Promise.all([
      Promise.allSettled(active),
      Promise.allSettled(finishing ? [finishing] : []),
      this.waitForAssignmentScan(),
      this.waitForSyncWrites(),
    ])
  }

  async disableAndWait() {
    const finishing = this.syncBatchFinishing
    this.disable()
    const active = [...this.activeRuns].map((record) => record.promise)
    await Promise.all([
      Promise.allSettled(active),
      Promise.allSettled(finishing ? [finishing] : []),
      this.waitForAssignmentScan(),
      this.waitForSyncWrites(),
    ])
  }

  async run({
    sources: requestedSources,
    domainsBySource = {},
    adapterOptionsBySource = {},
    scopedRun = false,
    generation = this.syncGeneration,
    runId = randomUUID(),
    batchStarted = null,
    onSourceSettled = () => {},
    onSourceError = () => {},
    shouldCommitSource = () => true,
  } = {}) {
    const sourceNames = normalizeSyncSources({ sources: requestedSources })
    if (!this.isSyncGenerationCurrent(generation)) throw new SyncCancelledError()
    if (batchStarted) {
      await batchStarted
    } else {
      const snapshot = await this.trackSyncWrite(this.store.update((state) => {
        if (!this.isSyncGenerationCurrent(generation)) throw new SyncCancelledError()
        return {
          ...state,
          sync: { ...state.sync, lastStartedAt: new Date().toISOString(), lastError: null, runId },
        }
      }))
      if (!this.isSyncGenerationCurrent(generation)) throw new SyncCancelledError()
      this.onChange(snapshot)
    }

    const results = {}
    const sources = {}
    const appendError = (error, source = null) => {
      const safe = compactError(error)
      if (safe && source) onSourceError(source, safe)
    }
    const adapterBySource = { jwglxt: this.jwglxt, theol: this.theol }
    const adapters = sourceNames.map((name) => [name, adapterBySource[name]])
    let domainOutcomes = Object.fromEntries(adapters.map(([name]) => [
      name,
      pendingSourceOutcomes(name, runId, domainsBySource[name] ?? null),
    ]))
    let latest = this.store.snapshot()

    const commit = async ({ settledSource = null } = {}) => {
      if (!this.isSyncGenerationCurrent(generation)) throw new SyncCancelledError()
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
      latest = await this.trackSyncWrite(this.store.update((current) => {
        if (!this.isSyncGenerationCurrent(generation)) throw new SyncCancelledError()
        const sourceItems = (source, domain, key) => {
          const previous = current[key].filter((item) => item.source === source)
          const fresh = commitResults[source]?.[key]
          return mergeSingleSourceCollection(previous, fresh, sourceOutcome(commitOutcomes, source, domain))
        }
        const combined = {
          ...(scopedRun ? {} : { runId }),
          profile: mergeObjectValue(current.profile, commitResults.jwglxt?.profile, sourceOutcome(commitOutcomes, 'jwglxt', 'profile')),
          terms: mergeSingleSourceCollection(current.terms, commitResults.jwglxt?.terms, sourceOutcome(commitOutcomes, 'jwglxt', 'terms')),
          courses: mergeById(
            sourceItems('jwglxt', 'courses', 'courses'),
            sourceItems('theol', 'courses', 'courses'),
            current.courses.filter((item) => item.source !== 'jwglxt' && item.source !== 'theol'),
          ),
          schedule: mergeScheduleCollection(current.schedule, commitResults.jwglxt?.schedule, sourceOutcome(commitOutcomes, 'jwglxt', 'schedule')),
          grades: mergeSingleSourceCollection(current.grades, commitResults.jwglxt?.grades, sourceOutcome(commitOutcomes, 'jwglxt', 'grades')),
          selectedCourses: mergeTermCollection(current.selectedCourses, commitResults.jwglxt?.selectedCourses, sourceOutcome(commitOutcomes, 'jwglxt', 'selected-courses')),
          academicProgress: (() => {
            const fresh = commitResults.jwglxt?.academicProgress
            const outcome = sourceOutcome(commitOutcomes, 'jwglxt', 'academic-progress')
            if (fresh === undefined || fresh === null) return current.academicProgress
            if (outcome && !outcome.succeeded) return current.academicProgress
            if (!current.academicProgress) return fresh
            // Preserve a previously captured official tree when an API summary
            // only refreshes GPA and course counts.
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
            return {
              ...(current.academicExtras || {}),
              ...fresh,
              domains,
            }
          })(),
          exams: mergeTermCollection(current.exams, commitResults.jwglxt?.exams, sourceOutcome(commitOutcomes, 'jwglxt', 'exams')),
          assignments: mergeSingleSourceCollection(current.assignments, commitResults.theol?.assignments, sourceOutcome(commitOutcomes, 'theol', 'assignments')),
          notices: mergeById(
            sourceItems('jwglxt', 'notices', 'notices'),
            sourceItems('theol', 'notices', 'notices'),
            current.notices.filter((item) => item.source !== 'jwglxt' && item.source !== 'theol'),
          ),
          sources: { ...current.sync.sources, ...commitSources },
          domains: aggregateRunDomains(current.sync.domains, commitOutcomes, { runId, sourceNames: commitSourceNames }),
        }
        const merged = mergeSyncResult(current, combined)
        merged.sync.lastError = current.sync.lastError
        return merged
      }))
      if (!this.isSyncGenerationCurrent(generation)) throw new SyncCancelledError()
      if (settledSource) onSourceSettled(settledSource)
      this.onChange(latest)
    }
    let commitQueue = Promise.resolve()
    const queueCommit = (settledSource) => {
      const pending = commitQueue.then(() => commit({ settledSource }))
      commitQueue = pending
      return pending
    }
    const syncSource = async (name, adapter) => {
      if (!this.isSyncGenerationCurrent(generation)) throw new SyncCancelledError()
      const attemptedAt = new Date().toISOString()
      let sourceError = null
      this.onProgress({ stage: name, status: 'syncing', ...(scopedRun ? { scope: 'domain' } : {}) })
      try {
        // Pass per-item progress through to the adapter if it supports it
        if (adapter.onProgress === null || adapter.onProgress?.theiaSyncService === this) {
          const relayProgress = (progress) => {
            if (this.isSyncGenerationCurrent(generation)) {
              this.onProgress({ ...progress, stage: name, ...(scopedRun ? { scope: 'domain' } : {}) })
            }
          }
          relayProgress.theiaSyncService = this
          adapter.onProgress = relayProgress
        }
        const execute = () => {
          if (!this.isSyncGenerationCurrent(generation)) throw new SyncCancelledError()
          const domains = domainsBySource[name] ?? null
          const adapterOptions = adapterOptionsBySource[name] || {}
          return adapter.sync({
            ...adapterOptions,
            ...(domains === null ? {} : { domains }),
          })
        }
        const rawResult = name === 'theol'
          ? await this.runTheolExclusive(execute)
          : await execute()
        results[name] = normalizeSyncPayload(rawResult)
        if (!this.isSyncGenerationCurrent(generation)) throw new SyncCancelledError()
        sources[name] = sanitizeDiagnosticValue(results[name].source)
        for (const error of results[name].errors || []) appendError(error, name)
        this.onProgress({ stage: name, status: 'done', ...(scopedRun ? { scope: 'domain' } : {}) })
      } catch (error) {
        if (error instanceof SyncCancelledError || !this.isSyncGenerationCurrent(generation)) {
          throw new SyncCancelledError()
        }
        sourceError = error
        sources[name] = {
          connected: false,
          checkedAt: new Date().toISOString(),
          authRequired: error instanceof AuthRequiredError,
          error: compactError(error),
        }
        appendError(error, name)
        this.onProgress({ stage: name, status: 'error', error: compactError(error), ...(scopedRun ? { scope: 'domain' } : {}) })
      }
      const completedAt = new Date().toISOString()
      domainOutcomes = mergeDomainSourceOutcomes(domainOutcomes, {
        [name]: fallbackSourceOutcomes(name, results[name], this.store.snapshot(), {
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

    // Both platforms start together. THEOL itself remains serialized through
    // runTheolExclusive, while independent academic-system requests may overlap.
    const sourceSettlements = await Promise.allSettled(adapters.map(([name, adapter]) => syncSource(name, adapter)))
    const failedSource = sourceSettlements.find((settlement) => settlement.status === 'rejected')
    if (failedSource) throw failedSource.reason
    await commitQueue
    if (!this.isSyncGenerationCurrent(generation)) throw new SyncCancelledError()
    const requiredSources = Object.entries(sources).filter(([, value]) => value.authRequired).map(([name]) => name)
    if (requiredSources.length) this.onAuthRequired(requiredSources)
    return latest
  }

  runTheolExclusive(operation) {
    const pending = this.theolQueue.catch(() => {}).then(operation)
    this.theolQueue = pending.catch(() => {})
    return pending
  }

  cancelAssignmentScan() {
    this.assignmentGeneration += 1
    this.assignmentAbortController?.abort()
    if (this.assignmentTimer) clearTimeout(this.assignmentTimer)
    this.assignmentTimer = null
    this.assignmentRequestedRunId = null
  }

  disableAssignmentScan() {
    this.assignmentDisabled = true
    this.cancelAssignmentScan()
  }

  enableAssignmentScan({ schedule = true } = {}) {
    this.assignmentDisabled = false
    if (schedule) this.scheduleAssignmentScan(this.store.snapshot().sync.runId)
  }

  pauseAssignmentScan() {
    this.assignmentPauseCount += 1
    this.cancelAssignmentScan()
    let resumed = false
    return ({ schedule = true } = {}) => {
      if (resumed) return
      resumed = true
      this.assignmentPauseCount = Math.max(0, this.assignmentPauseCount - 1)
      if (schedule && !this.assignmentDisabled && !this.assignmentPauseCount) {
        this.scheduleAssignmentScan(this.store.snapshot().sync.runId)
      }
    }
  }

  async runTheolInteraction(operation) {
    const resume = this.pauseAssignmentScan()
    try {
      return await this.runTheolExclusive(operation)
    } finally {
      resume()
    }
  }

  async waitForAssignmentScan() {
    while (this.assignmentActive) {
      const pending = this.assignmentActive
      await pending.catch(() => undefined)
      if (this.assignmentActive === pending) break
    }
  }

  async retryAssignments() {
    if (this.syncDisabled) throw new SyncDisabledError()
    if (!this.store.snapshot().courses.some((item) => item?.source === 'theol')) {
      throw new Error('请先获取北化在线THEOL课程，再重新获取作业与测试')
    }
    const resume = this.pauseAssignmentScan()
    try {
      await this.waitForAssignmentScan()
      const generation = this.assignmentGeneration
      const runId = randomUUID()
      this.onProgress({ stage: 'assignments', status: 'syncing', label: '正在单独获取作业与测试…', scope: 'domain' })
      const pending = this.runTheolExclusive(() => this.runAssignmentScan(runId, generation, { scoped: true }))
      this.assignmentActive = pending
      const snapshot = await pending
      if (!snapshot) throw new SyncCancelledError('Assignment retry was cancelled')
      const outcome = snapshot?.sync?.domains?.assignments?.outcomes?.theol
      this.onProgress({
        stage: 'assignments',
        status: outcome?.status === 'failed' || outcome?.status === 'auth-required' ? 'error' : 'done',
        ...(outcome?.errorCode ? { error: outcome.errorCode } : {}),
        scope: 'domain',
      })
      return snapshot || this.store.snapshot()
    } catch (error) {
      this.onProgress({ stage: 'assignments', status: 'error', error: compactError(error), scope: 'domain' })
      throw error
    } finally {
      this.assignmentActive = null
      this.assignmentAbortController = null
      resume({ schedule: false })
    }
  }

  scheduleAssignmentScan(runId) {
    if (!runId || typeof this.theol.syncAssignments !== 'function') return
    if (this.assignmentDisabled) return
    this.assignmentRequestedRunId = runId
    this.flushAssignmentScan()
  }

  flushAssignmentScan() {
    const runId = this.assignmentRequestedRunId
    if (!runId || this.assignmentDisabled || this.assignmentPauseCount || this.hasActiveSync() || this.assignmentActive || this.assignmentTimer) return
    const snapshot = this.store.snapshot()
    if (!snapshot.sync.sources?.theol?.connected || !snapshot.courses.some((item) => item?.source === 'theol')) {
      this.assignmentRequestedRunId = null
      return
    }
    const generation = this.assignmentGeneration
    this.assignmentTimer = setTimeout(() => {
      this.assignmentTimer = null
      if (
        generation !== this.assignmentGeneration
        || runId !== this.assignmentRequestedRunId
        || this.assignmentDisabled
        || this.assignmentPauseCount
        || this.hasActiveSync()
        || this.assignmentActive
      ) {
        this.flushAssignmentScan()
        return
      }
      this.assignmentRequestedRunId = null
      const pending = this.runTheolExclusive(() => this.runAssignmentScan(runId, generation))
      this.assignmentActive = pending
      pending.catch((error) => this.onBackgroundError(error)).finally(() => {
        if (this.assignmentActive === pending) {
          this.assignmentActive = null
          this.assignmentAbortController = null
        }
        this.flushAssignmentScan()
      })
    }, 0)
  }

  async runAssignmentScan(runId, generation, { scoped = false } = {}) {
    const controller = new AbortController()
    this.assignmentAbortController = controller
    const shouldContinue = () => generation === this.assignmentGeneration && !this.hasActiveSync() && !controller.signal.aborted
    if (!shouldContinue()) {
      if (this.assignmentAbortController === controller) this.assignmentAbortController = null
      return
    }
    const attemptedAt = new Date().toISOString()
    const courses = this.store.snapshot().courses.filter((item) => item?.source === 'theol')
    let result
    let error = null
    try {
      result = await this.theol.syncAssignments(courses, { shouldContinue, signal: controller.signal })
      if (result?.aborted || !shouldContinue()) return
    } catch (caught) {
      if (!shouldContinue()) return
      error = caught
    }
    const completedAt = new Date().toISOString()
    let committed = false
    const state = await this.trackSyncWrite(this.store.update((current) => {
      if (generation !== this.assignmentGeneration || (!scoped && current.sync.runId !== runId)) return current
      committed = true
      let assignmentOutcome = error
        ? sourceDomainOutcome({
            source: 'theol',
            runId,
            attempted: true,
            succeeded: false,
            status: error instanceof AuthRequiredError ? 'auth-required' : 'failed',
            attemptedAt,
            completedAt,
            retainedPrevious: domainHasData(current, 'assignments'),
            completeness: 'unknown',
            errorCode: failureCode(error),
          })
        : fallbackSourceOutcomes('theol', result, current, {
            runId,
            attemptedAt,
            completedAt,
          }).assignments
      const retainableCurrent = error ? current.assignments : retainableAssignments(current.assignments)
      if (!error && assignmentOutcome.succeeded && assignmentOutcome.completeness !== 'complete') {
        const retainedPrevious = retainedAssignmentsAfterScan(
          retainableCurrent,
          result.assignments,
          result.successfulCourseIds,
          { excludeFreshIds: true },
        ).length > 0
        assignmentOutcome = sourceDomainOutcome({
          ...assignmentOutcome,
          retainedPrevious,
        })
      }
      const assignments = error
        ? current.assignments
        : mergeAssignmentScan(retainableCurrent, result.assignments, assignmentOutcome, result.successfulCourseIds)
      const domains = aggregateDomainProvenance(current.sync.domains, {
        theol: { assignments: assignmentOutcome },
      }, { runId })
      const assignmentScan = sanitizeDiagnosticValue({
        checkedAt: completedAt,
        connected: !error,
        authRequired: error instanceof AuthRequiredError,
        completeness: assignmentOutcome.completeness,
        successfulCourseCount: Array.isArray(result?.successfulCourseIds) ? result.successfulCourseIds.length : null,
        failedCourseCount: Array.isArray(result?.failedCourseIds) ? result.failedCourseIds.length : null,
        mobileFallback: result?.source?.mobileFallback || null,
        error: error ? compactError(error) : result.errors?.length ? result.errors.join('; ') : null,
      })
      return {
        ...current,
        assignments,
        sync: {
          ...current.sync,
          domains,
          sources: {
            ...current.sync.sources,
            theol: { ...(current.sync.sources?.theol || {}), assignmentScan },
          },
        },
      }
    }))
    const stillCurrent = generation === this.assignmentGeneration
      && !controller.signal.aborted
      && (scoped || state.sync.runId === runId)
    if (committed && stillCurrent) this.onChange(state)
    if (committed && stillCurrent && error instanceof AuthRequiredError) this.onAuthRequired(['theol'])
    if (this.assignmentAbortController === controller) this.assignmentAbortController = null
    return state
  }

  configureAutoSync(enabled, intervalMinutes) {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.autoSyncInFlight = null
    if (!enabled) return
    const interval = Math.max(5, Math.min(24 * 60, Number(intervalMinutes) || 30)) * 60_000
    const run = () => {
      if (this.autoSyncInFlight) return
      const pending = Promise.allSettled([
        this.syncNow({ sources: ['jwglxt'], domains: ['schedule', 'exams', 'notices'] }),
        this.syncNow({ sources: ['theol'], domains: ['courses', 'notices'] }),
      ])
        .then((results) => {
          for (const result of results) {
            if (result.status === 'rejected') this.onBackgroundError(result.reason)
          }
        })
        .finally(() => {
          if (this.autoSyncInFlight === pending) this.autoSyncInFlight = null
        })
      this.autoSyncInFlight = pending
    }
    this.timer = setInterval(run, interval)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.autoSyncInFlight = null
    this.disable()
  }
}
