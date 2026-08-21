import { JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES } from './jwglxt-extra.mjs'

export const DATA_OUTPUT_SCHEMA = 'theia-data-output/v1'
export const DATA_DOMAIN_OUTPUT_SCHEMA = 'theia-data-domain-output/v1'

// This is the public, read-only boundary. Keep it independent from the
// internal state shape so adding a local implementation detail cannot silently
// expand the MCP/API surface.
export const PUBLIC_DATA_DOMAINS = Object.freeze([
  'profile', 'terms', 'courses', 'schedule', 'grades', 'exams',
  'selected-courses', 'assignments', 'workspaces', 'notices', 'mailbox',
  'academic-progress', 'academic-plan', 'academic-calendar', 'fitness',
  'school-schedule', 'venue-status', ...JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES,
])

const COLLECTION_FIELDS = Object.freeze({
  terms: 'terms',
  courses: 'courses',
  schedule: 'schedule',
  grades: 'grades',
  exams: 'exams',
  'selected-courses': 'selectedCourses',
  assignments: 'assignments',
  workspaces: 'workspaces',
  notices: 'notices',
  mailbox: 'emails',
})

const HIDDEN_KEYS = new Set([
  'raw', 'rawHtml', 'rawJson', 'bodyHtml', 'sourceUrl', 'routeCode',
  'requestParameters', 'absolutePath', 'filePath', 'localPath', 'root',
  'studentInternalId', 'courseInternalId', 'classInternalId', 'kkbmId',
  'departmentId', 'majorId', 'planId', 'planCourseId', 'observations',
  'evidenceRefs', 'settings', 'credentials', 'cookies', 'session', 'token',
  'password',
])

const SECRET_KEY = /(?:password|passwd|secret|cookie|authorization|accessToken|refreshToken|sessionId)$/iu
const MAX_STRING_LENGTH = 200_000
const MAX_ARRAY_ITEMS = 20_000
const MAX_OBJECT_KEYS = 256

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function text(value, maximum = 240) {
  const normalized = String(value ?? '').replace(/\s+/gu, ' ').trim()
  return normalized ? normalized.slice(0, maximum) : null
}

function instant(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
}

function clonePublic(value, depth = 0, seen = new Set()) {
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return value.slice(0, MAX_STRING_LENGTH)
  if (depth > 8 || seen.has(value)) return null
  seen.add(value)
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => clonePublic(item, depth + 1, seen))
  }
  const output = {}
  for (const [key, child] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
    if (HIDDEN_KEYS.has(key) || SECRET_KEY.test(key)) continue
    output[key] = clonePublic(child, depth + 1, seen)
  }
  return output
}

function currentData(state, domain) {
  if (Object.hasOwn(COLLECTION_FIELDS, domain)) return state?.[COLLECTION_FIELDS[domain]] || []
  if (domain === 'profile') return state?.profile || null
  if (domain === 'academic-progress') return state?.academicProgress || null
  if (domain === 'academic-plan') {
    return {
      document: state?.academicPlanDocument || null,
      attachments: state?.academicExtras?.domains?.['academic-plan']?.attachments || [],
    }
  }
  if (domain === 'academic-calendar') return state?.dataCatalog?.collections?.academicCalendar || null
  if (domain === 'fitness') return state?.dataCatalog?.collections?.fitness || null
  if (domain === 'school-schedule') return state?.dataCatalog?.collections?.schoolSchedule || null
  if (domain === 'venue-status') return state?.dataCatalog?.collections?.venueReservations || null
  if (JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES.includes(domain)) return state?.academicExtras?.domains?.[domain] || null
  return null
}

function hasData(data) {
  if (Array.isArray(data)) return data.length > 0
  if (!data || typeof data !== 'object') return Boolean(data)
  if (Array.isArray(data.records)) return data.records.length > 0 || (Array.isArray(data.attachments) && data.attachments.length > 0)
  if (data.document) return true
  return Object.keys(data).length > 0
}

function recordCount(data) {
  if (Array.isArray(data)) return data.length
  if (!data || typeof data !== 'object') return data ? 1 : 0
  if (Array.isArray(data.records)) return data.records.length + (Array.isArray(data.attachments) ? data.attachments.length : 0)
  if (data.document) return 1
  return Object.keys(data).length ? 1 : 0
}

function outcomeFor(state, domain) {
  if (domain === 'academic-plan') return state?.sync?.domains?.['academic-plan'] || null
  if (domain === 'academic-calendar' || domain === 'fitness' || domain === 'school-schedule' || domain === 'venue-status') {
    return state?.sync?.domains?.['local-data-catalog'] || null
  }
  return state?.sync?.domains?.[domain] || null
}

function capturedAtFor(data, outcome) {
  return instant(outcome?.capturedAt)
    || instant(data?.capturedAt)
    || instant(data?.lastRefreshedAt)
    || (Array.isArray(data) ? data.map((item) => item?.capturedAt || item?.updatedAt).filter(instant).sort().at(-1) : null)
    || null
}

function completenessFor(data, outcome) {
  if (['complete', 'partial', 'unknown'].includes(outcome?.completeness)) return outcome.completeness
  if (data?.completeness && ['complete', 'partial', 'unknown'].includes(data.completeness)) return data.completeness
  return hasData(data) ? 'unknown' : 'unknown'
}

function statusFor(data, outcome) {
  if (outcome?.status === 'auth-required') return 'auth-required'
  if (outcome?.status === 'failed') return 'failed'
  if (outcome?.status === 'succeeded') return 'succeeded'
  return hasData(data) ? 'available' : 'not-attempted'
}

function labelFor(domain) {
  const labels = {
    profile: '个人资料', terms: '学期', courses: '课程', schedule: '课表', grades: '成绩',
    exams: '考试', 'selected-courses': '已选课程', assignments: '作业与测试', workspaces: '教学空间',
    notices: '通知', mailbox: '校园邮箱', 'academic-progress': '学业进度', 'academic-plan': '培养计划',
    'academic-calendar': '校历', fitness: '体测', 'school-schedule': '全校开课', 'venue-status': '场馆状态',
  }
  return labels[domain] || domain
}

export function projectTheiaDataDomain(state, domain, { snapshotRevision = null, now = new Date().toISOString() } = {}) {
  const normalizedDomain = String(domain || '').trim()
  if (!PUBLIC_DATA_DOMAINS.includes(normalizedDomain)) return null
  const data = currentData(state, normalizedDomain)
  const outcome = outcomeFor(state, normalizedDomain)
  const capturedAt = capturedAtFor(data, outcome)
  return {
    schema: DATA_DOMAIN_OUTPUT_SCHEMA,
    domain: normalizedDomain,
    label: labelFor(normalizedDomain),
    snapshotRevision: text(snapshotRevision, 256),
    generatedAt: instant(now) || new Date().toISOString(),
    capturedAt,
    status: statusFor(data, outcome),
    completeness: completenessFor(data, outcome),
    retainedPrevious: outcome?.retainedPrevious === true,
    emptyConfirmed: outcome?.emptyConfirmed === true,
    stale: !capturedAt,
    recordCount: recordCount(data),
    errorCode: text(outcome?.errorCode, 160),
    data: clonePublic(data),
  }
}

export function toTheiaDataOutput(state, { snapshotRevision = null, domains = null, now = new Date().toISOString() } = {}) {
  const requested = Array.isArray(domains) && domains.length ? domains : PUBLIC_DATA_DOMAINS
  const selected = [...new Set(requested.map((domain) => String(domain || '').trim()))]
    .filter((domain) => PUBLIC_DATA_DOMAINS.includes(domain))
  const projected = Object.fromEntries(selected.map((domain) => [
    domain,
    projectTheiaDataDomain(state, domain, { snapshotRevision, now }),
  ]))
  return {
    schema: DATA_OUTPUT_SCHEMA,
    generatedAt: instant(now) || new Date().toISOString(),
    snapshotRevision: text(snapshotRevision, 256),
    domains: projected,
  }
}
