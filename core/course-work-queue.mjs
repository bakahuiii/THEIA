import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

export const COURSE_WORK_QUEUE_SCHEMA = 'theia-course-work-queue/v1'
const HISTORY_LIMIT = 120
const MAX_ATTEMPTS = 3

function text(value, limit = 240) {
  const normalized = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return normalized ? normalized.slice(0, limit) : null
}

function timestamp(value, clock = () => new Date().toISOString()) {
  const parsed = new Date(value || clock())
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : clock()
}

function safeOptions(value) {
  if (!value || typeof value !== 'object') return {}
  return {
    ...(text(value.title, 160) ? { title: text(value.title, 160) } : {}),
    ...(Number.isFinite(Number(value.wordCount)) ? { wordCount: Math.max(200, Math.min(20_000, Math.trunc(Number(value.wordCount)))) } : {}),
  }
}

function safeJob(value, clock) {
  if (!value || typeof value !== 'object') return null
  const assignmentId = text(value.assignmentId, 128)
  const operation = text(value.operation, 48)
  if (!assignmentId || !operation) return null
  const status = ['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(value.status) ? value.status : 'queued'
  const maxAttempts = Math.max(1, Math.min(MAX_ATTEMPTS, Number(value.maxAttempts) || 2))
  return {
    id: text(value.id, 96) || randomUUID(),
    dedupeKey: text(value.dedupeKey, 220) || `${operation}:${assignmentId}`,
    assignmentId,
    operation,
    options: safeOptions(value.options),
    status,
    attempts: Math.max(0, Math.min(maxAttempts, Math.trunc(Number(value.attempts) || 0))),
    maxAttempts,
    createdAt: timestamp(value.createdAt, clock),
    updatedAt: timestamp(value.updatedAt, clock),
    startedAt: value.startedAt ? timestamp(value.startedAt, clock) : null,
    completedAt: value.completedAt ? timestamp(value.completedAt, clock) : null,
    lastError: text(value.lastError, 500),
    result: value.result && typeof value.result === 'object'
      ? { status: text(value.result.status, 48), message: text(value.result.message, 240) }
      : null,
  }
}

function emptyData(clock) {
  return { schema: COURSE_WORK_QUEUE_SCHEMA, enabled: true, updatedAt: timestamp(null, clock), jobs: [] }
}

export class CourseWorkQueue {
  constructor({
    root,
    processor,
    clock = () => new Date().toISOString(),
    onChange = () => {},
    onDiagnostic = () => {},
    concurrency = 1,
    defaultMaxAttempts = 2,
  } = {}) {
    if (!root) throw new TypeError('CourseWorkQueue requires root')
    if (typeof processor !== 'function') throw new TypeError('CourseWorkQueue requires processor')
    this.file = resolve(root, 'course-work', 'queue.json')
    this.processor = processor
    this.clock = clock
    this.onChange = onChange
    this.onDiagnostic = onDiagnostic
    this.concurrency = Math.max(1, Math.min(3, Math.trunc(Number(concurrency) || 1)))
    this.defaultMaxAttempts = Math.max(1, Math.min(MAX_ATTEMPTS, Math.trunc(Number(defaultMaxAttempts) || 2)))
    this.data = emptyData(clock)
    this.writeQueue = Promise.resolve()
    this.running = new Map()
    this.draining = false
    this.closed = false
    this.idleWaiters = []
  }

  snapshot() {
    return structuredClone({
      schema: COURSE_WORK_QUEUE_SCHEMA,
      enabled: this.data.enabled,
      updatedAt: this.data.updatedAt,
      jobs: this.data.jobs,
    })
  }

  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8'))
      if (parsed?.schema === COURSE_WORK_QUEUE_SCHEMA) {
        const restored = Array.isArray(parsed.jobs) ? parsed.jobs.map((job) => safeJob(job, this.clock)).filter(Boolean) : []
        // A process cannot be assumed to have completed a running job after a
        // crash. Requeue it and preserve the attempt count for retry policy.
        for (const job of restored) {
          if (job.status === 'running') {
            job.status = 'queued'
            job.lastError = '上次运行在客户端退出时中断，已恢复排队'
            job.updatedAt = timestamp(null, this.clock)
          }
        }
        this.data = {
          schema: COURSE_WORK_QUEUE_SCHEMA,
          enabled: parsed.enabled !== false,
          updatedAt: timestamp(parsed.updatedAt, this.clock),
          jobs: restored.slice(-HISTORY_LIMIT),
        }
        if (restored.some((job) => job.status === 'queued')) await this.persist()
      }
    } catch {
      // An optional queue journal must never block startup. Invalid data is
      // left in place for diagnosis and replaced on the first state change.
      this.data = emptyData(this.clock)
    }
    this.emit()
    this.drain()
    return this.snapshot()
  }

  async persist() {
    const contents = `${JSON.stringify(this.data, null, 2)}\n`
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      await mkdir(dirname(this.file), { recursive: true })
      const temporary = `${this.file}.${randomUUID()}.tmp`
      await writeFile(temporary, contents, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, this.file)
    })
    return this.writeQueue
  }

  async enqueue({ assignmentId, operation = 'model', options = {}, dedupeKey, maxAttempts } = {}) {
    if (this.closed) throw new Error('课程作业后台队列已关闭')
    const safeAssignmentId = text(assignmentId, 128)
    const safeOperation = text(operation, 48)
    if (!safeAssignmentId || !safeOperation) throw new Error('课程任务和后台操作不能为空')
    const key = text(dedupeKey, 220) || `${safeOperation}:${safeAssignmentId}`
    const existing = this.data.jobs.find((job) => job.dedupeKey === key && ['queued', 'running'].includes(job.status))
    if (existing) return { deduplicated: true, job: structuredClone(existing), snapshot: this.snapshot() }
    const now = timestamp(null, this.clock)
    const job = safeJob({
      id: randomUUID(), dedupeKey: key, assignmentId: safeAssignmentId, operation: safeOperation,
      options, status: 'queued', attempts: 0, maxAttempts: maxAttempts || this.defaultMaxAttempts,
      createdAt: now, updatedAt: now,
    }, this.clock)
    this.data.jobs = [...this.data.jobs, job].slice(-HISTORY_LIMIT)
    this.touch()
    await this.persist()
    this.drain()
    return { deduplicated: false, job: structuredClone(job), snapshot: this.snapshot() }
  }

  async setEnabled(enabled) {
    this.data.enabled = Boolean(enabled)
    this.touch()
    await this.persist()
    if (this.data.enabled) this.drain()
    this.resolveIdleIfReady()
    return this.snapshot()
  }

  async cancel(jobId) {
    const job = this.data.jobs.find((item) => item.id === String(jobId || ''))
    if (!job || !['queued', 'running'].includes(job.status)) return this.snapshot()
    job.status = 'cancelled'
    job.completedAt = timestamp(null, this.clock)
    job.updatedAt = job.completedAt
    job.lastError = '用户取消'
    this.running.get(job.id)?.controller.abort(new Error('cancelled by user'))
    this.touch()
    await this.persist()
    this.resolveIdleIfReady()
    return this.snapshot()
  }

  async close({ cancelRunning = true } = {}) {
    this.closed = true
    if (cancelRunning) {
      for (const item of this.running.values()) item.controller.abort(new Error('application shutdown'))
    }
    await this.waitForIdle()
    await this.persist()
  }

  async waitForIdle() {
    if (!this.running.size && (this.closed || !this.data.enabled || !this.data.jobs.some((job) => job.status === 'queued'))) return
    await new Promise((resolveWait) => this.idleWaiters.push(resolveWait))
  }

  async drain() {
    if (this.draining || this.closed || !this.data.enabled) {
      this.resolveIdleIfReady()
      return
    }
    this.draining = true
    try {
      while (!this.closed && this.data.enabled && this.running.size < this.concurrency) {
        const job = this.data.jobs.find((candidate) => candidate.status === 'queued')
        if (!job) break
        void this.run(job)
      }
    } finally {
      this.draining = false
      this.resolveIdleIfReady()
    }
  }

  async run(job) {
    const controller = new AbortController()
    this.running.set(job.id, { controller })
    job.status = 'running'
    job.attempts += 1
    job.startedAt = timestamp(null, this.clock)
    job.updatedAt = job.startedAt
    this.touch()
    await this.persist()
    this.emit()
    try {
      const result = await this.processor({ job: structuredClone(job), signal: controller.signal })
      if (job.status === 'cancelled' || controller.signal.aborted) return
      job.status = 'succeeded'
      job.completedAt = timestamp(null, this.clock)
      job.updatedAt = job.completedAt
      job.lastError = null
      job.result = result && typeof result === 'object' ? {
        status: text(result.status, 48) || 'completed',
        message: text(result.message, 240),
      } : { status: 'completed', message: null }
      this.onDiagnostic('course_work.queue_succeeded', { jobId: job.id, assignmentId: job.assignmentId, operation: job.operation })
    } catch (error) {
      if (job.status === 'cancelled' || controller.signal.aborted) {
        job.status = 'cancelled'
      } else {
        job.lastError = text(error instanceof Error ? error.message : error, 500)
        job.status = job.attempts < job.maxAttempts && error?.retryable !== false ? 'queued' : 'failed'
        if (job.status === 'failed') job.completedAt = timestamp(null, this.clock)
        this.onDiagnostic('course_work.queue_failed', {
          jobId: job.id, assignmentId: job.assignmentId, operation: job.operation,
          attempt: job.attempts, status: job.status, error: job.lastError,
        })
      }
      job.updatedAt = timestamp(null, this.clock)
    } finally {
      this.running.delete(job.id)
      this.touch()
      await this.persist()
      this.emit()
      this.drain()
    }
  }

  touch() {
    this.data.updatedAt = timestamp(null, this.clock)
    this.data.jobs = this.data.jobs.slice(-HISTORY_LIMIT)
  }

  emit() {
    try { this.onChange(this.snapshot()) } catch { /* queue state cannot block work */ }
  }

  resolveIdleIfReady() {
    if (this.running.size || (!this.closed && this.data.enabled && this.data.jobs.some((job) => job.status === 'queued'))) return
    const waiters = this.idleWaiters.splice(0)
    for (const resolveWait of waiters) resolveWait()
  }
}
