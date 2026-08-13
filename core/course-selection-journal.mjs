import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const FORMAT = 'theia-course-selection-records/v1'
const HISTORY_LIMIT = 160

function text(value, limit = 240) {
  const normalized = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return normalized ? normalized.slice(0, limit) : null
}

function timestamp(value) {
  const parsed = new Date(value || Date.now())
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString()
}

function optionalTimestamp(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
}

function safeTarget(target) {
  if (!target || typeof target !== 'object') return null
  const title = text(target.title)
  if (!title) return null
  return {
    id: text(target.id, 160),
    termId: text(target.termId, 48),
    classId: text(target.classId, 160),
    courseCode: text(target.courseCode, 96),
    title,
    className: text(target.className),
    teacher: text(target.teacher),
    time: text(target.time, 480),
    location: text(target.location),
    credits: Number.isFinite(Number(target.credits)) ? Number(target.credits) : null,
    chosenAt: timestamp(target.chosenAt),
  }
}

function safeJob(snapshot) {
  const job = snapshot?.active
  if (!job || typeof job !== 'object') return null
  const candidate = safeTarget({
    ...job.candidate,
    classId: job.candidate?.classId,
    className: job.candidate?.className,
    chosenAt: job.startAt || job.startedAt,
  })
  if (!candidate) return null
  const lastAttempt = Array.isArray(job.attempts) ? job.attempts.at(-1) : null
  return {
    kind: 'job',
    at: timestamp(job.completedAt || job.startedAt || job.startAt),
    jobId: text(job.id, 96),
    status: text(job.status, 48),
    candidate,
    attempts: Math.max(0, Math.min(300, Number(job.attempts?.length) || 0)),
    lastMessage: text(lastAttempt?.message || job.lastMessage, 480),
  }
}

function safeSentinel(value) {
  if (!value || typeof value !== 'object') return { enabled: false, startAt: null, endAt: null, intervalMs: 3_000, concurrency: 2, completedTargetIds: [] }
  const startAt = optionalTimestamp(value.startAt)
  const endAt = optionalTimestamp(value.endAt)
  const validWindow = Boolean(startAt && endAt && new Date(endAt).getTime() > new Date(startAt).getTime())
  return {
    enabled: Boolean(value.enabled) && validWindow,
    startAt: validWindow ? startAt : null,
    endAt: validWindow ? endAt : null,
    intervalMs: Math.max(1_000, Math.min(60_000, Number(value.intervalMs) || 3_000)),
    concurrency: Math.max(1, Math.min(3, Math.trunc(Number(value.concurrency) || 2))),
    completedTargetIds: [...new Set((Array.isArray(value.completedTargetIds) ? value.completedTargetIds : []).map((item) => text(item, 160)).filter(Boolean))].slice(-500),
  }
}

function emptyData() {
  return { schema: FORMAT, updatedAt: null, targets: [], sentinel: safeSentinel(null), history: [] }
}

export class CourseSelectionJournal {
  constructor(root) {
    this.file = resolve(root, 'course-selection', 'records.json')
    this.data = emptyData()
    this.writeQueue = Promise.resolve()
  }

  snapshot() {
    const result = structuredClone(this.data)
    result.target = result.targets.at(-1) || null
    return result
  }

  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8'))
      if (parsed?.schema !== FORMAT) return this.snapshot()
      const restoredTargets = Array.isArray(parsed.targets)
        ? parsed.targets.map(safeTarget).filter(Boolean)
        : [safeTarget(parsed.target)].filter(Boolean)
      this.data = {
        schema: FORMAT,
        updatedAt: parsed.updatedAt ? timestamp(parsed.updatedAt) : null,
        targets: restoredTargets,
        sentinel: safeSentinel(parsed.sentinel),
        history: Array.isArray(parsed.history)
          ? parsed.history.map((entry) => safeJob({ active: entry.kind === 'job' ? {
            id: entry.jobId,
            status: entry.status,
            candidate: entry.candidate,
            attempts: Array.from({ length: Math.min(300, Number(entry.attempts) || 0) }, () => ({})),
            lastMessage: entry.lastMessage,
            completedAt: entry.at,
          } : null })).filter(Boolean).slice(-HISTORY_LIMIT)
          : [],
      }
    } catch { /* A missing or malformed optional journal starts empty. */ }
    return this.snapshot()
  }

  async persist() {
    const content = `${JSON.stringify({ ...this.data, target: this.data.targets.at(-1) || null }, null, 2)}\n`
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.file), { recursive: true })
      const temporary = `${this.file}.${randomUUID()}.tmp`
      await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 })
      await rename(temporary, this.file)
    })
    return this.writeQueue
  }

  async setTarget(target) {
    this.data.targets = target ? [safeTarget(target)].filter(Boolean) : []
    this.data.updatedAt = new Date().toISOString()
    await this.persist()
    return this.snapshot()
  }

  async addTarget(target) {
    const next = safeTarget(target)
    if (!next) return this.snapshot()
    const id = next.id || `${next.termId || ''}:${next.courseCode || next.title}`
    const existing = this.data.targets.filter((item) => {
      const itemId = item.id || `${item.termId || ''}:${item.courseCode || item.title}`
      return itemId !== id
    })
    this.data.targets = [...existing, next]
    this.data.updatedAt = new Date().toISOString()
    await this.persist()
    return this.snapshot()
  }

  async removeTarget(targetOrId) {
    const id = typeof targetOrId === 'string' ? targetOrId : targetOrId?.id
    if (!id) return this.snapshot()
    this.data.targets = this.data.targets.filter((item) => item.id !== id)
    this.data.sentinel.completedTargetIds = this.data.sentinel.completedTargetIds.filter((item) => item !== id)
    this.data.updatedAt = new Date().toISOString()
    await this.persist()
    return this.snapshot()
  }

  async setSentinel(config) {
    this.data.sentinel = safeSentinel({ ...this.data.sentinel, ...config })
    this.data.updatedAt = new Date().toISOString()
    await this.persist()
    return this.snapshot()
  }

  async updateSentinel(snapshot) {
    if (!this.data.sentinel.enabled) return this.snapshot()
    const completed = new Set(this.data.sentinel.completedTargetIds)
    for (const job of snapshot?.jobs || []) {
      if (job?.status === 'selected' && job.target?.id) completed.add(job.target.id)
    }
    const next = [...completed]
    if (next.length === this.data.sentinel.completedTargetIds.length) return this.snapshot()
    this.data.sentinel.completedTargetIds = next.slice(-500)
    this.data.updatedAt = new Date().toISOString()
    await this.persist()
    return this.snapshot()
  }

  async recordJob(snapshot) {
    const entry = safeJob(snapshot)
    if (!entry) return this.snapshot()
    const current = this.data.history.at(-1)
    const unchanged = current?.jobId === entry.jobId
      && current?.status === entry.status
      && current?.attempts === entry.attempts
      && current?.lastMessage === entry.lastMessage
    if (unchanged) return this.snapshot()
    this.data.history = [...this.data.history.filter((item) => item.jobId !== entry.jobId), entry].slice(-HISTORY_LIMIT)
    this.data.updatedAt = new Date().toISOString()
    await this.persist()
    return this.snapshot()
  }
}
