import { randomUUID } from 'node:crypto'
import { mergeSyncResult } from './schema.mjs'
import { compactError } from './util.mjs'
import { SyncCancelledError, SyncDisabledError } from './sync-errors.mjs'
import { runSync } from './sync-run-runtime.mjs'

export { SyncCancelledError, SyncDisabledError } from './sync-errors.mjs'

import {
  domainSelectionCovers,
  mergeDomainSelections,
  normalizeSyncRequest,
  SYNC_SOURCE_NAMES,
} from './sync-helpers.mjs'
import {
  cancelAssignmentScan,
  disableAssignmentScan,
  enableAssignmentScan,
  pauseAssignmentScan,
  runTheolInteraction,
  waitForAssignmentScan,
  retryAssignments,
  retryCourseResources,
  scheduleAssignmentScan,
  flushAssignmentScan,
  runAssignmentScan,
} from './sync-assignment-runtime.mjs'

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
    const adapterOptionsBySource = freeClassroom ? {
      jwglxt: {
        freeClassroom,
        // The school endpoint is authoritative when it filters correctly;
        // this cached schedule is only a conservative backstop for deployments
        // that ignore zcd/xqj/jcd.
        freeClassroomSchedule: this.store.snapshot().schedule,
      },
    } : {}
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
    const theolDomains = domainsBySource.theol
    // Course refreshes are the source of truth for the assignment scan's
    // roster. Queue the scan after both full and course-scoped refreshes so a
    // normal foreground sync and silent session recovery cannot leave the
    // assignments page permanently stale.
    const refreshesTheolCourses = sources.includes('theol')
      && (theolDomains === null || (Array.isArray(theolDomains) && theolDomains.includes('courses')))
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
          && refreshesTheolCourses
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
          // Scoped runs intentionally keep the batch runId out of the global
          // sync state. Use the committed state runId for their follow-up so
          // the scan is accepted by runAssignmentScan's stale-result guard.
          this.scheduleAssignmentScan(domainScoped ? this.store.snapshot().sync.runId : runId)
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
    let run
    try {
      run = this.startSync(
        ready.map((request) => request.source),
        generation,
        Object.fromEntries(ready.map((request) => [request.source, request.domains])),
        { foreground: ready.some((request) => request.foreground), adapterOptionsBySource: Object.fromEntries(ready.map((request) => [request.source, request.adapterOptions || {}])) },
      )
    } catch (error) {
      // startSync can throw synchronously (e.g. an overlapping run claimed the
      // source in the same tick). The requests were already dequeued above, so
      // settle them here instead of leaving the callers waiting forever.
      for (const request of ready) request.reject(error)
      return
    }
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

  run(options = {}) {
    return runSync(this, options)
  }

  runTheolExclusive(operation) {
    const pending = this.theolQueue.catch(() => {}).then(operation)
    this.theolQueue = pending.catch(() => {})
    return pending
  }

  cancelAssignmentScan(...args) { return cancelAssignmentScan.apply(this, args) }

  disableAssignmentScan(...args) { return disableAssignmentScan.apply(this, args) }

  enableAssignmentScan(...args) { return enableAssignmentScan.apply(this, args) }

  pauseAssignmentScan(...args) { return pauseAssignmentScan.apply(this, args) }

  runTheolInteraction(...args) { return runTheolInteraction.apply(this, args) }

  waitForAssignmentScan(...args) { return waitForAssignmentScan.apply(this, args) }

  retryAssignments(...args) { return retryAssignments.apply(this, args) }

  retryCourseResources(...args) { return retryCourseResources.apply(this, args) }

  scheduleAssignmentScan(...args) { return scheduleAssignmentScan.apply(this, args) }

  flushAssignmentScan(...args) { return flushAssignmentScan.apply(this, args) }

  runAssignmentScan(...args) { return runAssignmentScan.apply(this, args) }

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

  async stopAndWait() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    const autoSyncInFlight = this.autoSyncInFlight
    this.autoSyncInFlight = null
    await Promise.allSettled([
      this.disableAndWait(),
      autoSyncInFlight,
    ].filter(Boolean))
  }
}
