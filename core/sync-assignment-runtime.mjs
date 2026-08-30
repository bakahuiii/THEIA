import { randomUUID } from 'node:crypto'
import { AuthRequiredError } from './source-client.mjs'
import { compactError, sanitizeDiagnosticValue } from './util.mjs'
import { aggregateDomainProvenance, domainHasData, sourceDomainOutcome } from './domain-provenance.mjs'
import { SyncCancelledError, SyncDisabledError } from './sync-errors.mjs'
import {
  fallbackSourceOutcomes,
  failureCode,
  mergeAssignmentScan,
  mergeCourseResourceRecords,
  retainableAssignments,
  retainedAssignmentsAfterScan,
} from './sync-helpers.mjs'

export function cancelAssignmentScan() {
    this.assignmentGeneration += 1
    this.assignmentAbortController?.abort()
    if (this.assignmentTimer) clearTimeout(this.assignmentTimer)
    this.assignmentTimer = null
    this.assignmentRequestedRunId = null
  }

export function disableAssignmentScan() {
    this.assignmentDisabled = true
    this.cancelAssignmentScan()
  }

export function enableAssignmentScan({ schedule = true } = {}) {
    this.assignmentDisabled = false
    if (schedule) this.scheduleAssignmentScan(this.store.snapshot().sync.runId)
  }

export function pauseAssignmentScan() {
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

export async function runTheolInteraction(operation) {
    const resume = this.pauseAssignmentScan()
    try {
      return await this.runTheolExclusive(operation)
    } finally {
      resume()
    }
  }

export async function waitForAssignmentScan() {
    while (this.assignmentActive) {
      const pending = this.assignmentActive
      await pending.catch(() => undefined)
      if (this.assignmentActive === pending) break
    }
  }

export async function retryAssignments() {
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

export async function retryCourseResources(courseId) {
    if (this.syncDisabled) throw new SyncDisabledError()
    const id = String(courseId || '').trim()
    const current = this.store.snapshot()
    const course = current.courses.find((item) => item?.source === 'theol' && String(item.id || '') === id)
    if (!course) throw new Error('请先获取有效的北化在线THEOL课程')
    if (typeof this.theol.syncCourseResources !== 'function') throw new Error('当前THEOL适配器不支持课程资源获取')

    const runId = randomUUID()
    const attemptedAt = new Date().toISOString()
    this.onProgress({ stage: 'course-resources', status: 'syncing', scope: 'domain' })
    let result
    let error = null
    try {
      result = await this.runTheolInteraction(() => this.theol.syncCourseResources(course))
    } catch (caught) {
      error = caught
    }
    const completedAt = new Date().toISOString()
    const scanComplete = (result?.scan?.complete === true
      && !result?.scan?.truncated
      && !result?.scan?.resourceLimitReached
      && !result?.scan?.failedFolders?.length
      && !result?.errors?.length)
      || (!result?.scan && !result?.errors?.length && Array.isArray(result?.resources) && result.resources.length > 0)
    const partialScan = !scanComplete
    const outcome = sourceDomainOutcome({
      source: 'theol',
      runId,
      attempted: true,
      succeeded: !error,
      status: error ? (error instanceof AuthRequiredError ? 'auth-required' : 'failed') : 'succeeded',
      attemptedAt,
      completedAt,
      capturedAt: !error ? result?.capturedAt || completedAt : null,
      sourceSucceededAt: !error ? completedAt : null,
      completeness: error ? 'unknown' : (scanComplete ? 'complete' : 'partial'),
      emptyConfirmed: !error && scanComplete && Array.isArray(result?.resources) && result.resources.length === 0,
      retainedPrevious: Boolean(course.courseResources?.length && (partialScan || error)),
      previousRecordCount: Array.isArray(course.courseResources) ? course.courseResources.length : 0,
      receivedRecordCount: Array.isArray(result?.resources) ? result.resources.length : null,
      errorCode: error
        ? failureCode(error)
        : result?.errors?.length
          ? 'partial_resource_scan'
        : partialScan && course.courseResources?.length
          ? (Array.isArray(result?.resources) && result.resources.length === 0 ? 'unconfirmed_empty_result' : 'partial_resource_scan')
          : null,
      parserVersion: result?.parserVersion || null,
    })
    let snapshot
    if (error) {
      snapshot = await this.trackSyncWrite(this.store.update((state) => ({
        ...state,
        sync: {
          ...state.sync,
          domains: aggregateDomainProvenance(state.sync.domains, { theol: { 'course-resources': outcome } }, { runId }),
        },
      })))
    } else {
      snapshot = await this.trackSyncWrite(this.store.update((state) => {
        const existing = state.courses.find((item) => item?.source === 'theol' && String(item.id || '') === id)
        if (!existing) return state
        const resources = mergeCourseResourceRecords(existing.courseResources, result?.resources, { complete: scanComplete })
        return {
          ...state,
          courses: state.courses.map((item) => item === existing ? {
            ...item,
            courseResources: resources,
            courseResourcesCapturedAt: result?.capturedAt || completedAt,
            courseResourcesScan: result?.scan || {
              complete: scanComplete,
              capturedAt: result?.capturedAt || completedAt,
            },
          } : item),
          sync: {
            ...state.sync,
            domains: aggregateDomainProvenance(state.sync.domains, { theol: { 'course-resources': outcome } }, { runId }),
          },
        }
      }))
    }
    this.onChange(snapshot)
    this.onProgress({
      stage: 'course-resources',
      status: error ? 'error' : 'done',
      ...(error ? { error: compactError(error) } : {}),
      ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
      scope: 'domain',
    })
    if (error instanceof AuthRequiredError) this.onAuthRequired(['theol'])
    if (error) throw error
    return snapshot
  }

export function scheduleAssignmentScan(runId) {
    if (!runId || typeof this.theol.syncAssignments !== 'function') return
    if (this.assignmentDisabled) return
    this.assignmentRequestedRunId = runId
    this.flushAssignmentScan()
  }

export function flushAssignmentScan() {
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

export async function runAssignmentScan(runId, generation, { scoped = false } = {}) {
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
