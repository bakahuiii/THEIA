/**
 * Read-only client for THEIA's current loopback user-data API.
 *
 * Iris intentionally consumes the bounded user-data projections instead of
 * THEIA's complete snapshot, profile, mail bodies, local paths, or assets.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

const DATA_SCHEMA = 'theia-campus-data/v1'
const CATALOG_SCHEMA = 'theia-local-data/v1'
const USER_DATA_SCHEMA = 'theia-user-data-view/v1'
const ANALYSIS_SCHEMA = 'theia-academic-analysis-response/v1'
const AGENT_SCHEMA = 'theia-agent-chat/v1'
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost'])

export const THEIA_READABLE_DOMAINS = Object.freeze([
  'courses',
  'schedule',
  'grades',
  'exams',
  'selected-courses',
  'assignments',
  'notices',
  'academic-progress',
  'academic-extras',
])

const READABLE_DOMAIN_SET = new Set(THEIA_READABLE_DOMAINS)
const DOMAIN_ALIASES = new Map([['selectedcourses', 'selected-courses'], ['selectedCourses', 'selected-courses']])
const RECORD_OPTION_KEYS = new Set(['q', 'termId', 'status', 'scope', 'limit', 'cursor', 'recordType'])

export class TheiaClientError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'TheiaClientError'
    this.code = code
  }
}

function clientError(code, message) {
  return new TheiaClientError(code, message)
}

function runningProcess(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function loopbackUrl(value) {
  let url
  try {
    url = new URL(String(value ?? '').trim())
  } catch {
    throw clientError('THEIA_INVALID_CONFIG', 'THEIA API configuration is invalid.')
  }
  if (
    url.protocol !== 'http:'
    || !LOOPBACK_HOSTS.has(url.hostname)
    || url.username
    || url.password
    || (url.pathname !== '/' && url.pathname !== '')
    || url.search
    || url.hash
  ) {
    throw clientError('THEIA_INVALID_CONFIG', 'THEIA API must use a loopback HTTP address.')
  }
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1'
  return url.toString().replace(/\/$/, '')
}

function validRuntime(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const host = typeof value.host === 'string' ? value.host.trim().toLowerCase() : ''
  const { port, pid } = value
  if (!LOOPBACK_HOSTS.has(host)) return null
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) return null
  if (!Number.isSafeInteger(pid) || pid < 1) return null
  return { host, port, pid }
}

function object(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function dataEnvelope(value) {
  return object(value) && value.schema === DATA_SCHEMA
}

function userDataEnvelope(value) {
  return object(value) && value.schema === USER_DATA_SCHEMA
}

function normalizedDomain(value) {
  const raw = String(value ?? '').trim()
  const alias = DOMAIN_ALIASES.get(raw) || DOMAIN_ALIASES.get(raw.toLowerCase()) || raw.toLowerCase()
  if (!READABLE_DOMAIN_SET.has(alias)) throw clientError('THEIA_INVALID_DOMAIN', 'Requested THEIA data domain is unavailable.')
  return alias
}

function boundedLimit(value) {
  const limit = Number(value)
  return Number.isInteger(limit) ? Math.max(1, Math.min(100, limit)) : 50
}

function queryFor(options = {}) {
  const parameters = new URLSearchParams()
  for (const [key, value] of Object.entries(options)) {
    if (!RECORD_OPTION_KEYS.has(key) || value === null || value === undefined || value === '') continue
    if (key === 'limit') {
      parameters.set(key, String(boundedLimit(value)))
      continue
    }
    if (key === 'scope' && !['current', 'all'].includes(String(value))) continue
    parameters.set(key, String(value).slice(0, 300))
  }
  const encoded = parameters.toString()
  return encoded ? `?${encoded}` : ''
}

const validators = {
  health(value) {
    return dataEnvelope(value) && value.ok === true && object(value.counts)
  },
  sync(value) {
    return dataEnvelope(value) && object(value.item)
  },
  overview(value) {
    return userDataEnvelope(value)
      && value.view === 'overview'
      && Array.isArray(value.sections)
      && Array.isArray(value.extraDomains)
      && object(value.sync)
  },
  domainSummary(value, domain) {
    return userDataEnvelope(value)
      && value.domain === domain
      && typeof value.label === 'string'
      && nonnegativeInteger(value.count)
      && Array.isArray(value.scopes)
      && typeof value.status === 'string'
      && typeof value.completeness === 'string'
  },
  records(value, domain) {
    return userDataEnvelope(value)
      && value.domain === domain
      && typeof value.label === 'string'
      && nonnegativeInteger(value.total)
      && Array.isArray(value.items)
      && value.items.every(object)
      && typeof value.hasMore === 'boolean'
      && (value.nextCursor === null || typeof value.nextCursor === 'string')
  },
  academicProgress(value) {
    return dataEnvelope(value) && typeof value.notModified === 'boolean' && (value.item === null || object(value.item))
  },
  academicAnalysis(value) {
    return object(value)
      && value.schema === ANALYSIS_SCHEMA
      && typeof value.notModified === 'boolean'
      && (value.item === null || object(value.item))
  },
  academicPlanDocument(value) {
    return object(value)
      && value.schema === 'theia-academic-plan-document-response/v1'
      && (value.item === null || object(value.item))
  },
  academicCalendar(value) {
    return object(value)
      && value.schema === 'theia-academic-calendar-assets/v1'
      && (value.calendar === null || object(value.calendar))
      && (value.calendarError === null || typeof value.calendarError === 'string')
  },
  venueCatalog(value) {
    return object(value)
      && value.schema === CATALOG_SCHEMA
      && object(value.item)
      && Array.isArray(value.item.venues)
      && value.item.venues.every(object)
  },
  venueStatuses(value) {
    return object(value)
      && value.schema === CATALOG_SCHEMA
      && Array.isArray(value.item)
      && value.item.every(object)
  },
  agent(value) {
    return object(value)
      && value.schema === AGENT_SCHEMA
      && typeof value.threadId === 'string'
      && value.threadId.length > 0
      && typeof value.answer === 'string'
  },
}

function timeoutValue(value) {
  const timeout = Number(value)
  return Number.isFinite(timeout) && timeout > 0 ? timeout : 5_000
}

function chinaDateParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const dateParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  const weekdayLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', weekday: 'short',
  }).format(date)
  const weekday = { Sun: 7, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[weekdayLabel] || null
  return { date: `${dateParts.year}-${dateParts.month}-${dateParts.day}`, weekday }
}

function academicWeekFromCalendar(calendar, value = new Date()) {
  const current = chinaDateParts(value)
  const semesters = Array.isArray(calendar?.semesters) ? calendar.semesters : []
  if (!current || !semesters.length) return null
  const semesterIndex = semesters.findIndex((item) => (
    /^20\d{2}-\d{2}-\d{2}$/u.test(String(item?.startDate || ''))
    && /^20\d{2}-\d{2}-\d{2}$/u.test(String(item?.endDate || ''))
    && item.startDate <= current.date
    && current.date <= item.endDate
  ))
  if (semesterIndex < 0) return null
  const semester = semesters[semesterIndex]
  const start = Date.parse(`${semester.startDate}T00:00:00Z`)
  const today = Date.parse(`${current.date}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(today) || today < start) return null
  const calculatedWeek = Math.floor((today - start) / 604_800_000) + 1
  const declaredWeeks = Number(semester.weeks)
  const week = Number.isInteger(declaredWeeks) && declaredWeeks > 0
    ? Math.min(declaredWeeks, calculatedWeek)
    : calculatedWeek
  const schoolYear = String(calendar.schoolYear || '')
  const year = Number.parseInt(schoolYear.slice(0, 4), 10)
  const termCode = ['3', '12', '16'][semesterIndex] || ''
  return {
    date: current.date,
    weekday: current.weekday,
    week,
    of: Number.isInteger(declaredWeeks) && declaredWeeks > 0 ? declaredWeeks : null,
    termId: Number.isFinite(year) && termCode ? `${year}-${termCode}` : null,
    semesterIndex: semesterIndex + 1,
    semesterLabel: String(semester.label || '').trim() || null,
  }
}

export function createTheiaClient({
  baseUrl,
  dataRoot,
  appData,
  env = process.env,
  timeoutMs = 5_000,
  fetchImpl = globalThis.fetch,
  readFileImpl = readFile,
  isProcessRunning = runningProcess,
} = {}) {
  const requestTimeout = timeoutValue(timeoutMs)
  let cachedToken = ''

  async function discoverBaseUrl() {
    // Resolve settings per request so control-panel changes apply immediately.
    const configuredUrl = String(baseUrl ?? env.THEIA_API ?? '').trim()
    const configuredRoot = String(dataRoot ?? env.THEIA_DATA_ROOT ?? '').trim()
    const configuredAppData = String(appData ?? env.APPDATA ?? '').trim()
    const root = configuredRoot || (configuredAppData ? resolve(configuredAppData, 'THEIA') : '')

    // The loopback API authenticates every read with the per-instance token
    // persisted in api-runtime.json next to the runtime metadata. Load it on
    // every discovery so a THEIA restart (new token) is picked up; cache it so
    // requests can attach the Authorization header.
    if (root) {
      try {
        const runtime = JSON.parse(await readFileImpl(resolve(root, 'api-runtime.json'), 'utf8'))
        if (typeof runtime.token === 'string' && runtime.token.length > 0) cachedToken = runtime.token
      } catch {
        // No runtime metadata — configured-url mode may still work if the
        // server does not require the token; leave cachedToken unchanged.
      }
    }

    if (configuredUrl) return loopbackUrl(configuredUrl)

    if (!root) throw clientError('THEIA_INVALID_CONFIG', 'THEIA data location is not configured.')

    let runtime
    try {
      runtime = JSON.parse(await readFileImpl(resolve(root, 'api-runtime.json'), 'utf8'))
    } catch (error) {
      if (error?.code === 'ENOENT') throw clientError('THEIA_NOT_RUNNING', 'THEIA is not running.')
      throw clientError('THEIA_INVALID_CONFIG', 'THEIA runtime metadata is invalid.')
    }

    const normalized = validRuntime(runtime)
    if (!normalized) throw clientError('THEIA_INVALID_CONFIG', 'THEIA runtime metadata is invalid.')
    try {
      if (!await isProcessRunning(normalized.pid)) throw clientError('THEIA_NOT_RUNNING', 'THEIA is not running.')
    } catch (error) {
      if (error instanceof TheiaClientError) throw error
      throw clientError('THEIA_NOT_RUNNING', 'THEIA is not running.')
    }
    // Re-read the token in case the file changed between the initial read and
    // this full discovery.
    if (typeof runtime.token === 'string' && runtime.token.length > 0) cachedToken = runtime.token
    return loopbackUrl(`http://${normalized.host}:${normalized.port}`)
  }

  async function request(path, validate, { method = 'GET', body = undefined, timeoutMs: operationTimeout = requestTimeout, binary = false, notFoundAsNull = false } = {}) {
    const endpoint = await discoverBaseUrl()
    const controller = new AbortController()
    let timedOut = false
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true
        controller.abort()
        reject(clientError('THEIA_TIMEOUT', 'THEIA did not respond in time.'))
      }, timeoutValue(operationTimeout))
    })

    const operation = (async () => {
      const headers = { accept: 'application/json' }
      if (body !== undefined) headers['content-type'] = 'application/json'
      if (cachedToken) headers.Authorization = `Bearer ${cachedToken}`
      const response = await fetchImpl(new URL(path, `${endpoint}/`), {
        method,
        headers,
        cache: 'no-store',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      })
      if (notFoundAsNull && response.status === 404) return null
      if (!response?.ok) {
        let failure = null
        try { failure = await response.json() } catch { /* preserve generic transport error */ }
        const code = String(failure?.error || '')
        if (code === 'thread-busy' || code === 'runtime-busy') throw clientError('THEIA_AGENT_BUSY', 'THEIA Agent is busy.')
        if (code === 'agent_unavailable' || code === 'agent_thread_unavailable') throw clientError('THEIA_AGENT_UNAVAILABLE', 'THEIA Agent is unavailable.')
        throw clientError('THEIA_NOT_RUNNING', 'THEIA API is unavailable.')
      }
      if (binary) return Buffer.from(await response.arrayBuffer())
      let payload
      try {
        payload = await response.json()
      } catch (error) {
        if (error?.name === 'AbortError') throw error
        throw clientError('THEIA_SCHEMA_MISMATCH', 'THEIA returned an incompatible response.')
      }
      if (!validate(payload)) throw clientError('THEIA_SCHEMA_MISMATCH', 'THEIA returned an incompatible response.')
      return payload
    })()

    try {
      return await Promise.race([operation, timeout])
    } catch (error) {
      if (error instanceof TheiaClientError) throw error
      if (timedOut || error?.name === 'AbortError') throw clientError('THEIA_TIMEOUT', 'THEIA did not respond in time.')
      throw clientError('THEIA_NOT_RUNNING', 'THEIA is not running.')
    } finally {
      clearTimeout(timer)
    }
  }

  function records(domain, options = {}) {
    const normalized = normalizedDomain(domain)
    return request(`/v1/records/${encodeURIComponent(normalized)}${queryFor({ limit: 50, ...options })}`, (value) => validators.records(value, normalized))
  }

  function domainSummary(domain) {
    const normalized = normalizedDomain(domain)
    return request(`/v1/domain-summary/${encodeURIComponent(normalized)}`, (value) => validators.domainSummary(value, normalized))
  }

  /**
   * Fetch a rendered PNG table image for a THEIA academic-extra domain
   * (for example free-classroom). Returns a Buffer of the PNG, or null when
   * the domain has no cached records to render.
   */
  async function tableImage(domain, options = {}) {
    const raw = String(domain ?? '').trim()
    if (!raw || raw.length > 80 || !/^[a-zA-Z0-9_-]+$/u.test(raw)) {
      throw clientError('THEIA_INVALID_DOMAIN', 'Requested THEIA data domain is unavailable.')
    }
    const params = new URLSearchParams({ domain: raw })
    const title = String(options.title || '').trim().slice(0, 200)
    if (title) params.set('title', title)
    const limit = Number(options.limit)
    if (Number.isInteger(limit) && limit >= 1 && limit <= 200) params.set('limit', String(limit))
    const buffer = await request(`/v1/table-image?${params.toString()}`, () => true, {
      timeoutMs: Math.max(requestTimeout, 30_000),
      binary: true,
      notFoundAsNull: true,
    })
    return buffer?.length ? buffer : null
  }

  /**
   * Fetch a rendered PNG status-table image for motion venues.
   */
  async function motionTableImage(activity, { date = chinaDate(), title = '' } = {}) {
    const params = new URLSearchParams()
    const requested = String(activity ?? '').trim().slice(0, 120)
    if (requested) params.set('activity', requested)
    if (date) params.set('date', String(date).slice(0, 32))
    const heading = String(title || '').trim().slice(0, 200) || (requested ? `${requested}状态表` : '场馆状态表')
    params.set('title', heading)
    const buffer = await request(`/v1/motion-table-image?${params.toString()}`, () => true, {
      timeoutMs: Math.max(requestTimeout, 60_000),
      binary: true,
      notFoundAsNull: true,
    })
    return buffer?.length ? buffer : null
  }

  /**
   * Fetch a rendered PNG free-classroom image for one period (节次).
   * `periods` is required ("1", "3", "4"). Missing weekday/week values are
   * resolved from the China date and the official THEIA academic calendar.
   */
  async function classroomTableImage({ campus = '', periods = '', weekdays = '', weeks = '', termId = '', now = new Date() } = {}) {
    const params = new URLSearchParams()
    const periodsText = String(periods || '').trim().slice(0, 60)
    if (!periodsText) throw clientError('THEIA_CLASSROOM_PERIOD_REQUIRED', '请指定节次。')
    params.set('periods', periodsText)
    const current = !weeks ? await currentClassroomScope(now) : null
    const resolvedWeekdays = String(weekdays || '').trim() || String(current?.weekday || '')
    const resolvedWeeks = String(weeks || '').trim() || String(current?.week || '')
    if (!resolvedWeekdays || !resolvedWeeks) {
      throw clientError('THEIA_CLASSROOM_SCOPE_UNAVAILABLE', '无法根据中国时区当前日期和 THEIA 校历确定教学周与星期。请先更新校历后重试。')
    }
    params.set('weekdays', resolvedWeekdays.slice(0, 60))
    params.set('weeks', resolvedWeeks.slice(0, 60))
    const termIdText = String(termId || '').trim().slice(0, 64)
    if (termIdText || current?.termId) params.set('termId', termIdText || current.termId)
    const campusText = String(campus || '').trim().slice(0, 80)
    if (campusText) params.set('campus', campusText)
    params.set('title', `第${periodsText}节 · 空闲教室`)
    const buffer = await request(`/v1/free-classroom-image?${params.toString()}`, () => true, {
      timeoutMs: Math.max(requestTimeout, 90_000),
      binary: true,
      notFoundAsNull: true,
    })
    return buffer?.length ? buffer : null
  }

  function academicCalendar() {
    return request('/v1/academic-calendar', validators.academicCalendar)
  }

  async function currentClassroomScope(value = new Date()) {
    const response = await academicCalendar()
    const current = academicWeekFromCalendar(response.calendar, value)
    return current ? { ...current, weekdays: current.weekday } : null
  }

  function chinaDate() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date()).filter((part) => part.type !== 'literal')
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    return `${values.year}-${values.month}-${values.day}`
  }

  function venueCatalog() {
    return request('/v1/venue-catalog', validators.venueCatalog)
  }

  function venueStatuses({ activity, date } = {}) {
    const params = new URLSearchParams()
    if (activity) params.set('activity', String(activity).trim().slice(0, 120))
    if (date) params.set('date', String(date).trim().slice(0, 32))
    const query = params.toString()
    return request(`/v1/venue-statuses${query ? `?${query}` : ''}`, validators.venueStatuses)
  }

  async function motion(project, { date = chinaDate() } = {}) {
    const requested = String(project ?? '').trim().slice(0, 120)
    if (!requested) throw clientError('THEIA_MOTION_PROJECT_REQUIRED', '运动项目不能为空。')
    const catalogResponse = await venueCatalog()
    const venues = (catalogResponse.item.venues || []).filter((venue) => {
      const haystack = `${venue.activity || ''} ${venue.label || ''}`.toLocaleLowerCase()
      return haystack.includes(requested.toLocaleLowerCase())
    }).slice(0, 100)
    // Motion venue availability is short-lived; the THEIA endpoint always
    // reads it live from the campus source, never from a local cache.
    const statusesResponse = await venueStatuses({ activity: requested, date })
    return {
      project: requested,
      date,
      venues,
      statuses: statusesResponse.item,
      summary: statusesResponse.summary || null,
      updatedAt: statusesResponse.updatedAt || catalogResponse.updatedAt || null,
    }
  }

  function agent(message, { threadId } = {}) {
    const question = String(message ?? '').trim().slice(0, 4_000)
    if (!question) throw clientError('THEIA_AGENT_QUESTION_REQUIRED', 'Agent 问题不能为空。')
    const body = { message: question }
    if (threadId) body.threadId = String(threadId).trim().slice(0, 128)
    return request('/v1/agent/chat', validators.agent, {
      method: 'POST',
      body,
      timeoutMs: Math.max(requestTimeout, 95_000),
    })
  }

  return {
    health: () => request('/v1/health', validators.health),
    sync: () => request('/v1/sync', validators.sync),
    overview: () => request('/v1/overview', validators.overview),
    domainSummary,
    records,
    tableImage,
    schedule: (options) => records('schedule', options),
    assignments: (options) => records('assignments', options),
    exams: (options) => records('exams', options),
    courses: (options) => records('courses', options),
    grades: (options) => records('grades', options),
    selectedCourses: (options) => records('selected-courses', options),
    notices: (options) => records('notices', options),
    academicProgress: () => request('/v1/academic-progress', validators.academicProgress),
    academicAnalysis: () => request('/v1/academic-analysis', validators.academicAnalysis),
    academicPlanDocument: () => request('/v1/academic-plan-document', validators.academicPlanDocument),
    academicCalendar,
    currentClassroomScope,
    venueCatalog,
    venueStatuses,
    motionTableImage,
    classroomTableImage,
    motion,
    agent,
    readableDomains: () => [...THEIA_READABLE_DOMAINS],
  }
}
