import { randomUUID } from 'node:crypto'
import { compactError } from './util.mjs'
import { cachedSchoolScheduleResult } from './data-catalog.mjs'
import {
  COURSE_SELECTION_MAX_SCAN_PAGES,
  COURSE_URL,
  SELECT_URL,
} from './course-selection-config.mjs'
import {
  formatServerResponseDetail,
  matchPublishedCandidate,
  portalNotOpenError,
  diagnosticPath,
  rawError,
  schoolScheduleBlocksForItem,
  schoolScheduleCourseRecord,
  schoolScheduleFallbackItems,
  wait,
} from './course-selection-helpers.mjs'

export const COURSE_SELECTION_JOB_METHODS = {
  start({ candidate = null, targets = [], startAt = null, endAt = null, intervalMs = 1_500, maxAttempts = 120, concurrency = 2, sentinel = false }) {
    const plannedTargets = candidate ? [] : targets.filter((target) => target?.title)
    if (!candidate && !plannedTargets.length) throw new Error('Add at least one course to the course-selection plan first')
    if (candidate && (!candidate.courseId || !candidate.operationId || !candidate.categoryCode)) throw new Error('The course-selection target is incomplete; refresh the catalog and choose a teaching class again')
    const requestedStart = startAt ? new Date(startAt).getTime() : Date.now()
    const shared = {
      startAt: new Date(Number.isFinite(requestedStart) ? Math.max(requestedStart, Date.now()) : Date.now()).toISOString(),
      endAt: endAt && Number.isFinite(new Date(endAt).getTime()) ? new Date(endAt).toISOString() : null,
      intervalMs: Math.max(1_000, Math.min(60_000, Number(intervalMs) || 1_500)),
      maxAttempts: Math.max(1, Math.min(1_000_000, Number(maxAttempts) || 120)),
      sentinel: Boolean(sentinel),
    }
    if (shared.endAt && new Date(shared.endAt).getTime() <= new Date(shared.startAt).getTime()) throw new Error('The sentinel end time must be after the start time')
    this.maxConcurrentRequests = Math.max(1, Math.min(3, Math.trunc(Number(concurrency) || 2)))
    const jobs = candidate ? [{ candidate, target: null }] : plannedTargets.map((target) => ({ candidate: null, target }))
    for (const definition of jobs) {
      const alreadyActive = [...this.activeJobs.values()].some((job) => job.target?.id && job.target.id === definition.target?.id && ['scheduled', 'running'].includes(job.status))
      if (alreadyActive) continue
      const job = { id: randomUUID(), ...definition, ...shared, status: 'scheduled', attempts: [], startedAt: null, completedAt: null, lastMessage: null, logs: [], timer: null, stopped: false }
      this.addLog(job, `TASK SCHEDULED | startAt=${job.startAt} | endAt=${job.endAt || 'none'} | intervalMs=${job.intervalMs} | maxAttempts=${job.maxAttempts} | concurrency=${this.maxConcurrentRequests}`)
      this.activeJobs.set(job.id, job)
      const delay = Math.max(0, new Date(job.startAt).getTime() - Date.now())
      job.timer = setTimeout(() => { void this.run(job) }, delay)
    }
    this.publish()
    return this.snapshot()
  },

  stop() {
    const jobs = [...this.activeJobs.values()].filter((job) => ['scheduled', 'running'].includes(job.status))
    if (!jobs.length) return this.snapshot()
    for (const job of jobs) {
      job.stopped = true
      if (job.timer) clearTimeout(job.timer)
      job.status = 'stopped'
      job.completedAt = new Date().toISOString()
      job.lastMessage = 'Stopped by user'
      this.addLog(job, job.lastMessage, 'stopped')
    }
    this.publish()
    return this.snapshot()
  },

  async run(job) {
    if (!this.activeJobs.has(job.id) || job.stopped) return
    job.status = 'running'
    job.startedAt = new Date().toISOString()
    this.addLog(job, `TASK RUNNING | transport=${this.courseSelectionClientFactory ? 'JWGLXT API' : 'browser session'}`)
    this.publish()
    for (let number = 1; number <= job.maxAttempts && !job.stopped; number += 1) {
      if (job.endAt && Date.now() >= new Date(job.endAt).getTime()) {
        job.status = 'expired'
        job.completedAt = new Date().toISOString()
        job.lastMessage = 'SENTINEL_WINDOW_EXPIRED'
        this.addLog(job, `SENTINEL_WINDOW_EXPIRED | endAt=${job.endAt}`, 'stopped')
        this.publish()
        return
      }
      const startedAt = new Date().toISOString()
      try {
        const outcome = await this.withRequestSlot(async () => {
          if (!job.candidate && job.target) {
            this.addLog(job, `TARGET ${job.target.courseCode || job.target.title} | discovering published selection blocks`)
            this.publish()
            job.candidate = await this.findCandidate(job.target, (detail) => this.addLog(job, detail))
            if (job.candidate) this.addLog(job, `CLASS FOUND | id=${job.candidate.classId || 'unknown'} | teacher=${job.candidate.teacher || '--'}`)
          }
          if (!job.candidate) throw new Error(`CLASS_NOT_FOUND | target=${job.target?.courseCode || job.target?.title || 'unknown'} | no matching teaching class returned by the published selection catalog`)
          return this.attempt(job.candidate)
        })
        job.attempts.push({ number, at: startedAt, success: outcome.success, message: outcome.message })
        job.lastMessage = outcome.message
        this.addLog(job, `POST ${diagnosticPath(SELECT_URL)} | attempt=${number} | ${outcome.raw || outcome.message}`, outcome.success ? 'success' : 'warning')
        this.publish()
        if (outcome.success) {
          job.status = 'selected'
          job.completedAt = new Date().toISOString()
          this.addLog(job, 'Course selected successfully', 'success')
          this.publish()
          await this.onSuccess()
          return
        }
      } catch (error) {
        job.lastMessage = compactError(error)
        job.attempts.push({ number, at: startedAt, success: false, message: job.lastMessage })
        this.addLog(job, `ATTEMPT ${number} FAILED | ${rawError(error)}`, 'error')
        if (job.lastMessage.includes('PORTAL_NOT_OPEN')) {
          job.lastMessage = `${job.lastMessage} | backoff=${Math.max(job.intervalMs, 30_000)}ms`
          this.addLog(job, `PORTAL_NOT_OPEN BACKOFF | next probe in ${Math.max(job.intervalMs, 30_000)}ms`, 'warning')
        }
        this.publish()
      }
      const retryDelay = job.lastMessage?.includes('PORTAL_NOT_OPEN')
        ? Math.max(job.intervalMs, 30_000)
        : job.intervalMs
      if (number < job.maxAttempts && !job.stopped) await wait(retryDelay)
    }
    if (!job.stopped) {
      job.status = 'exhausted'
      job.completedAt = new Date().toISOString()
      this.addLog(job, 'Maximum attempts reached', 'error')
      this.publish()
    }
  },

  async findCandidate(target, onTrace = () => {}) {
    const portal = await this.discover()
    const flags = Object.entries(portal.selectionFlags || {})
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => `${key}=${value ? '1' : '0'}`)
      .join(',')
    onTrace(`GET ${diagnosticPath(portal.sourceUrl)} | authenticated=true | blocks=${portal.blocks.length} | available=${portal.available} | selectionState=${portal.selectionState || 'unknown'}${flags ? ` | flags=${flags}` : ''}${portal.message ? ` | server=${portal.message}` : ''}`)
    if (!portal.available) throw portalNotOpenError(portal)
    let classesSeen = 0
    const candidates = []
    const seenCandidateIds = new Set()
    const addResult = (result, label) => {
      onTrace(`${label} | courses=${result.courseCount ?? 0} | classes=${result.candidates.length}${formatServerResponseDetail({ signal: result.responseSignal, message: result.message })}`)
      classesSeen += result.candidates.length
      for (const candidate of result.candidates) {
        if (seenCandidateIds.has(candidate.id)) continue
        seenCandidateIds.add(candidate.id)
        candidates.push(candidate)
      }
    }
    let scheduleFallbackAttempted = false
    const trySchoolScheduleFallback = async () => {
      if (scheduleFallbackAttempted) return null
      scheduleFallbackAttempted = true
      const scheduleScope = target?.termId || portal.term?.id
      const cachedSchedule = scheduleScope
        ? cachedSchoolScheduleResult(this.getState()?.dataCatalog, { termId: scheduleScope })
        : null
      const scheduleItems = cachedSchedule?.complete === true
        ? schoolScheduleFallbackItems(cachedSchedule.items, target)
        : []
      if (!scheduleItems.length) {
        onTrace(cachedSchedule?.complete === true
          ? `SCHOOL SCHEDULE CACHE | term=${scheduleScope} | matchingRows=0 | complete=true`
          : `SCHOOL SCHEDULE CACHE | term=${scheduleScope || 'unknown'} | matchingRows=0 | complete=false-or-missing`)
        return null
      }
      onTrace(`SCHOOL SCHEDULE CACHE | term=${scheduleScope} | matchingRows=${scheduleItems.length} | complete=true`)
      for (const item of scheduleItems) {
        const course = schoolScheduleCourseRecord(item)
        if (!course) {
          onTrace(`SCHOOL SCHEDULE SKIP | class=${item.classId || 'unknown'} | reason=missing-course-identity`)
          continue
        }
        for (const block of schoolScheduleBlocksForItem(item, portal)) {
          onTrace(`SCHOOL SCHEDULE CLASS LOOKUP | course=${course.kch || course.kch_id} | class=${item.classId || item.className || 'unspecified'} | block=${block.id} | category=${block.categoryCode}`)
          const result = await this.candidates(block.id, target, { page: 1, pageSize: 100, search: false, schoolScheduleItem: item })
          addResult(result, `SCHOOL SCHEDULE CLASS RESULT | block=${block.id} | course=${course.kch || course.kch_id}`)
          const fallbackMatched = matchPublishedCandidate(candidates, target)
          if (fallbackMatched) return fallbackMatched
        }
      }
      return null
    }
    if (target?.courseId) {
      const directMatch = await trySchoolScheduleFallback()
      if (directMatch) return directMatch
    }
    for (const block of portal.blocks) {
      onTrace(`POST ${diagnosticPath(COURSE_URL)} | block=${block.id} | category=${block.categoryCode} | target=${target.courseCode || target.title}`)
      const result = await this.candidates(block.id, target, { page: 1, pageSize: 100 })
      addResult(result, `CATALOG RESULT | block=${block.id} | search=target`)
      let matched = matchPublishedCandidate(candidates, target)
      if (matched) return matched
      matched = await trySchoolScheduleFallback()
      if (matched) return matched
      if (target?.courseCode || target?.title) {
        const seenPageSignatures = new Set()
        const seenCourseKeys = new Set()
        let scannedCourseCount = 0
        for (let page = 1; page <= COURSE_SELECTION_MAX_SCAN_PAGES; page += 1) {
          const pageResult = await this.candidates(block.id, target, { page, pageSize: 100, search: false })
          const signature = pageResult.courseKeys?.join('|') || `count:${pageResult.courseCount ?? 0}`
          if (seenPageSignatures.has(signature)) {
            onTrace(`CATALOG SCAN STOP | block=${block.id} | page=${page} | reason=repeated-page`)
            break
          }
          seenPageSignatures.add(signature)
          if (pageResult.courseKeys?.length) {
            for (const key of pageResult.courseKeys) seenCourseKeys.add(key)
            scannedCourseCount = seenCourseKeys.size
          } else {
            scannedCourseCount += pageResult.courseCount || 0
          }
          addResult(pageResult, `CATALOG SCAN | block=${block.id} | page=${page} | search=none`)
          matched = matchPublishedCandidate(candidates, target)
          if (matched) return matched
          if (!pageResult.courseCount) break
          if (pageResult.totalKnown && scannedCourseCount >= pageResult.total) break
        }
      }
    }
    const matched = matchPublishedCandidate(candidates, target)
    if (matched) return matched
    throw new Error(`CLASS_NOT_FOUND | target=${target.courseCode || target.title} | requestedClass=${target.classId || target.className || 'unspecified'} | blocks=${portal.blocks.length} | candidateClasses=${classesSeen}`)
  },
}
