import { canonicalDomainId } from './domain-provenance.mjs'
import { JWGLXT_EXTRA_DOMAINS, JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES } from './jwglxt-extra.mjs'

export const USER_DATA_VIEW_SCHEMA = 'theia-user-data-view/v1'

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 50
const HIDDEN_KEYS = new Set([
  'raw', 'rawHtml', 'rawJson', 'body', 'content', 'sourceUrl', 'routeCode',
  'parserVersion', 'requestParameters', 'studentInternalId', 'courseInternalId',
  'classInternalId', 'kkbmId', 'departmentId', 'majorId', 'planId', 'planCourseId',
  'fields', 'observations', 'evidenceRefs', 'source', '_domain', '_recordKind', '_projectionIndex',
  'attachments',
])

const DOMAIN_DEFINITIONS = Object.freeze({
  terms: { label: '学期', field: 'terms', scope: 'all' },
  courses: { label: '课程', field: 'courses', scope: 'current' },
  schedule: { label: '课表', field: 'schedule', scope: 'current' },
  grades: { label: '成绩', field: 'grades', scope: 'current' },
  exams: { label: '考试', field: 'exams', scope: 'current' },
  'selected-courses': { label: '已选课程', field: 'selectedCourses', scope: 'current' },
  assignments: { label: '作业与测试', field: 'assignments', scope: 'current' },
  notices: { label: '通知', field: 'notices', scope: 'all' },
  emails: { label: '校园邮箱', field: 'emails', scope: 'all' },
  'academic-progress': { label: '学业进度', field: 'academicProgress', scope: 'current' },
  'academic-extras': { label: '教务资料', field: 'academicExtras', scope: 'selected' },
  ...Object.fromEntries(JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES.map((domain) => [domain, {
    label: JWGLXT_EXTRA_DOMAINS[domain]?.label || domain,
    field: 'academicExtras',
    scope: 'all',
  }])),
})

const CORE_FIELDS = Object.freeze({
  terms: ['id', 'label', 'year', 'term'],
  courses: ['id', 'code', 'title', 'teacher', 'credits', 'termId', 'className', 'category', 'nature'],
  schedule: ['id', 'termId', 'courseId', 'courseCode', 'title', 'teacher', 'weekday', 'period', 'weeks', 'time', 'room', 'location', 'campus', 'className'],
  grades: ['id', 'termId', 'courseId', 'courseCode', 'courseName', 'credits', 'score', 'point', 'status', 'remark', 'teacher'],
  exams: ['id', 'termId', 'courseId', 'courseCode', 'courseName', 'examType', 'startAt', 'examTime', 'location', 'campus', 'seat', 'status'],
  'selected-courses': ['id', 'termId', 'courseId', 'courseCode', 'title', 'teacher', 'credits', 'location', 'time', 'status'],
  assignments: ['id', 'courseId', 'courseName', 'title', 'kind', 'dueAt', 'status', 'score'],
  notices: ['id', 'title', 'summary', 'publishedAt', 'status'],
  emails: ['id', 'subject', 'from', 'receivedAt', 'date', 'read', 'snippet'],
  'academic-progress': ['id', 'program', 'gpa', 'courseCounts'],
})

const STATUS_LABELS = Object.freeze({
  available: '可查看', pending: '待完成', overdue: '已逾期', submitted: '已完成',
  recorded: '已有成绩', ungraded: '待出成绩', upcoming: '即将开始', past: '已结束',
  read: '已读', unread: '未读', cached: '已保存', confirmed: '已确认',
  succeeded: '已读取', partial: '部分读取', failed: '读取失败', 'auth-required': '需要重新登录',
  'not-read': '未读取', 'confirmed-empty': '已确认无记录', unknown: '状态未知',
})

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function list(value) {
  return Array.isArray(value) ? value : []
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/gu, ' ').trim()
  return normalized || fallback
}

function hiddenKey(value) {
  const key = String(value || '').trim()
  return HIDDEN_KEYS.has(key) || HIDDEN_KEYS.has(key.toLowerCase())
}

function userDomainId(value) {
  const normalized = canonicalDomainId(value)
  return normalized === 'mailbox' ? 'emails' : normalized
}

function instant(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
}

function timestampOf(value, fallback = null) {
  for (const candidate of [
    value?.capturedAt, value?.updatedAt, value?.publishedAt, value?.receivedAt,
    value?.date, value?.dueAt, value?.startAt, value?.examTime, fallback,
  ]) {
    const parsed = instant(candidate)
    if (parsed) return parsed
  }
  return null
}

function currentTerm(state) {
  const terms = list(state?.terms).filter((term) => term && typeof term === 'object')
  const explicit = terms.find((term) => term.current === true || term.isCurrent === true || term.active === true)
  if (explicit) return explicit
  return [...terms].sort((left, right) => {
    const yearDelta = (Number(right.year) || 0) - (Number(left.year) || 0)
    if (yearDelta) return yearDelta
    const termDelta = (Number(right.term) || 0) - (Number(left.term) || 0)
    if (termDelta) return termDelta
    return text(right.label || right.id).localeCompare(text(left.label || left.id), 'zh-CN')
  })[0] || null
}

function termLabel(state, termId) {
  if (!termId) return ''
  const term = list(state?.terms).find((item) => String(item?.id || '') === String(termId))
  return text(term?.label || termId)
}

function domainOutcome(state, domain) {
  const normalized = userDomainId(domain)
  if (normalized === 'academic-extras') return aggregateExtraOutcome(state)
  return state?.sync?.domains?.[normalized] || null
}

function extraDomain(state, domain) {
  return state?.academicExtras?.domains?.[domain] || null
}

function aggregateExtraOutcome(state) {
  const domains = objectOrEmpty(state?.academicExtras?.domains)
  const entries = Object.entries(domains)
    .map(([domain, value]) => ({ domain, value, outcome: state?.sync?.domains?.[domain] || null }))
    .filter(({ value, outcome }) => value || outcome)
  if (!entries.length) return null
  const capturedAt = entries
    .map(({ value, outcome }) => outcome?.capturedAt || value?.capturedAt)
    .filter((value) => instant(value))
    .sort()
    .at(-1) || null
  const statuses = entries.map(({ outcome }) => outcome?.status).filter(Boolean)
  const status = statuses.includes('auth-required') ? 'auth-required'
    : statuses.includes('failed') ? 'failed'
      : statuses.some((value) => value === 'succeeded') ? 'succeeded'
        : null
  const completeness = entries.some(({ value, outcome }) => (outcome?.completeness || value?.completeness) === 'unknown') ? 'unknown'
    : entries.some(({ value, outcome }) => (outcome?.completeness || value?.completeness) === 'partial') ? 'partial'
      : entries.some(({ value, outcome }) => (outcome?.completeness || value?.completeness) === 'complete') ? 'complete'
        : 'unknown'
  return {
    status,
    completeness,
    capturedAt,
    retainedPrevious: entries.some(({ outcome }) => outcome?.retainedPrevious === true),
    errorCode: entries.map(({ outcome }) => outcome?.errorCode).find(Boolean) || null,
    emptyConfirmed: entries.length > 0 && entries.every(({ outcome, value }) => outcome?.emptyConfirmed === true || (!value?.records?.length && !value?.attachments?.length)),
  }
}

function extraRecords(state, domain) {
  const source = extraDomain(state, domain)
  if (!source) return []
  const records = list(source.records).map((record) => ({ ...record, _domain: domain, _recordKind: 'record' }))
  const attachments = list(source.attachments).map((attachment, index) => ({
    ...attachment,
    id: text(attachment?.id, `${domain}:attachment:${index + 1}`),
    title: text(attachment?.label || attachment?.filename, `附件 ${index + 1}`),
    _domain: domain,
    _recordKind: 'attachment',
  }))
  return [...records, ...attachments]
}

function domainLabel(state, domain) {
  const normalized = userDomainId(domain)
  if (normalized === 'academic-extras') return '教务资料'
  return text(extraDomain(state, normalized)?.label || DOMAIN_DEFINITIONS[normalized]?.label, normalized || '资料')
}

function rawRecords(state, domain) {
  const normalized = userDomainId(domain)
  if (!DOMAIN_DEFINITIONS[normalized]) return null
  if (normalized === 'academic-progress') {
    return state?.academicProgress ? [state.academicProgress] : []
  }
  if (normalized === 'academic-extras') {
    return Object.entries(objectOrEmpty(state?.academicExtras?.domains)).flatMap(([domainId]) =>
      extraRecords(state, domainId).map((record) => ({ ...record, _domain: domainId })))
  }
  if (JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES.includes(normalized)) return extraRecords(state, normalized)
  return list(state?.[DOMAIN_DEFINITIONS[normalized].field])
}

function recordLabel(record, domain) {
  return text(record?.title || record?.courseName || record?.name || record?.subject || record?.label || record?.filename || record?.kcmc
    || record?.courseCode || (domain === 'academic-progress' ? '学业进度' : '未命名记录'), '未命名记录')
}

function recordScopeLabel(state, record, domain) {
  if (record?._domain) return domainLabel(state, record._domain)
  const term = termLabel(state, record?.termId || record?.academicTermId)
  const course = text(record?.courseName || record?.title)
  if (domain === 'schedule' || domain === 'grades' || domain === 'exams') return term || '未标注学期'
  if (domain === 'assignments') return course || term || '未标注课程'
  return term || course || ''
}

function statusOf(record, domain, now = Date.now()) {
  const explicit = text(record?.status || record?.state)
  if (record?._recordKind === 'attachment') return record?.cached === true ? 'cached' : 'available'
  if (domain === 'assignments') {
    const dueAt = Date.parse(String(record?.dueAt || ''))
    if (/submitted|完成|已交|已提交/iu.test(explicit)) return 'submitted'
    if (Number.isFinite(dueAt) && dueAt < now) return 'overdue'
    return explicit || 'pending'
  }
  if (explicit) return explicit
  if (domain === 'exams') {
    const examAt = Date.parse(String(record?.startAt || record?.examTime || ''))
    return Number.isFinite(examAt) && examAt >= now ? 'upcoming' : 'past'
  }
  if (domain === 'grades') return record?.score === null || record?.score === undefined || record?.score === '' ? 'ungraded' : 'recorded'
  if (domain === 'notices') return record?.read === true ? 'read' : 'unread'
  return 'available'
}

function completenessOf(state, domain, record = null) {
  const normalized = userDomainId(domain)
  const source = normalized === 'academic-extras'
    ? extraDomain(state, record?._domain)
    : JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES.includes(normalized) ? extraDomain(state, normalized) : null
  return text(record?.completeness || source?.completeness || domainOutcome(state, normalized)?.completeness, 'unknown')
}

function safeValue(value, depth = 0) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (depth > 2) return text(JSON.stringify(value), '未提供').slice(0, 800)
  if (Array.isArray(value)) return value.slice(0, 32).map((item) => safeValue(item, depth + 1))
  try {
    const sanitized = Object.fromEntries(Object.entries(value)
      .filter(([key]) => !hiddenKey(key))
      .map(([key, item]) => [key, safeValue(item, depth + 1)]))
    return text(JSON.stringify(sanitized), '未提供').slice(0, 2_000)
  } catch {
    return '未提供'
  }
}

function fieldEntries(record) {
  if (Array.isArray(record?.fields)) {
    return record.fields.map((field) => ({
      key: text(field?.name),
      label: text(field?.label || field?.name),
      value: safeValue(field?.value),
    })).filter((field) => field.key && field.value !== null && !hiddenKey(field.key)).slice(0, 32)
  }
  return Object.entries(record || {}).map(([key, value]) => ({
    key,
    label: key,
    value: safeValue(value),
  })).filter((field) => field.value !== null && !hiddenKey(field.key)).slice(0, 32)
}

function projectRecord(state, record, domain, now = Date.now()) {
  const normalized = userDomainId(domain)
  const item = record && typeof record === 'object' ? record : {}
  const outcome = domainOutcome(state, normalized)
  const fields = CORE_FIELDS[normalized] || []
  const projected = {}
  for (const key of fields) {
    if (item[key] === undefined || hiddenKey(key)) continue
    projected[key] = safeValue(item[key])
  }
  const capturedAt = timestampOf(item, outcome?.capturedAt)
  const result = {
    ...projected,
    id: text(item.id, `${normalized}:${recordLabel(item, normalized)}${Number.isInteger(item._projectionIndex) ? `:${item._projectionIndex}` : ''}`),
    label: recordLabel(item, normalized),
    scopeLabel: recordScopeLabel(state, item, normalized),
    status: statusOf(item, normalized, now),
    completeness: completenessOf(state, normalized, item),
    capturedAt,
    sourcePlatform: String(item.source || '').toLowerCase() === 'theol' ? 'THEOL'
      : ['imap', 'webmail'].includes(String(item.source || '').toLowerCase()) ? '校园邮箱' : 'JWGLXT',
  }
  if (item._recordKind !== 'attachment' && (!fields.length || normalized === 'academic-extras' || JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES.includes(normalized))) {
    result.attributes = fieldEntries(item)
    result.recordType = text(item.recordType, 'record')
    result.recordTypeLabel = text(item.recordTypeLabel, '记录')
  }
  if (item._domain) result.domain = item._domain
  if (item._recordKind) result.recordKind = item._recordKind
  if (item._recordKind === 'attachment') {
    result.attachment = {
      type: text(item.type, '文件'),
      filename: text(item.filename || item.label, result.label),
      bytes: Number.isFinite(Number(item.bytes)) ? Number(item.bytes) : null,
      sha256: text(item.sha256) || null,
      cached: item.cached === true,
    }
  }
  result.statusLabel = STATUS_LABELS[result.status] || result.status || '状态未知'
  return result
}

function queryText(record) {
  return Object.values(record).map((value) => typeof value === 'string' ? value : JSON.stringify(value)).join(' ').toLocaleLowerCase()
}

function matchesScope(state, record, domain, scope) {
  if (scope === 'all') return true
  if (scope === 'current') {
    const term = currentTerm(state)
    if (!term?.id || !record?.termId) return true
    return String(record.termId) === String(term.id)
  }
  return true
}

function sortRecords(state, records, domain, now = Date.now()) {
  const currentId = String(currentTerm(state)?.id || '')
  return [...records].sort((left, right) => {
    const leftKind = left?._recordKind === 'attachment' ? 1 : 0
    const rightKind = right?._recordKind === 'attachment' ? 1 : 0
    if (leftKind !== rightKind) return leftKind - rightKind
    const leftCurrent = currentId && String(left?.termId || '') === currentId ? 1 : 0
    const rightCurrent = currentId && String(right?.termId || '') === currentId ? 1 : 0
    if (leftCurrent !== rightCurrent) return rightCurrent - leftCurrent
    if (domain === 'assignments' || domain === 'exams') {
      const leftAt = Date.parse(String(left?.dueAt || left?.startAt || left?.examTime || ''))
      const rightAt = Date.parse(String(right?.dueAt || right?.startAt || right?.examTime || ''))
      if (Number.isFinite(leftAt) && Number.isFinite(rightAt) && leftAt !== rightAt) return leftAt - rightAt
    }
    const leftAt = Date.parse(String(timestampOf(left) || ''))
    const rightAt = Date.parse(String(timestampOf(right) || ''))
    if (Number.isFinite(leftAt) && Number.isFinite(rightAt) && leftAt !== rightAt) return rightAt - leftAt
    return recordLabel(left, domain).localeCompare(recordLabel(right, domain), 'zh-CN')
  })
}

function freshnessMs(domain) {
  if (domain === 'schedule' || domain === 'exams') return 24 * 60 * 60 * 1_000
  if (domain === 'assignments') return 6 * 60 * 60 * 1_000
  if (domain === 'notices') return 12 * 60 * 60 * 1_000
  return 7 * 24 * 60 * 60 * 1_000
}

function domainCapturedAt(state, domain) {
  const normalized = userDomainId(domain)
  if (normalized === 'academic-extras') {
    const captures = Object.values(objectOrEmpty(state?.academicExtras?.domains)).map((value) => Date.parse(String(value?.capturedAt || ''))).filter(Number.isFinite)
    const aggregateCapture = Date.parse(String(state?.academicExtras?.capturedAt || ''))
    if (Number.isFinite(aggregateCapture)) captures.push(aggregateCapture)
    return captures.length ? new Date(Math.max(...captures)).toISOString() : null
  }
  if (JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES.includes(normalized)) {
    const capturedAt = extraDomain(state, normalized)?.capturedAt
    if (instant(capturedAt)) return capturedAt
  }
  const outcome = domainOutcome(state, normalized)
  if (outcome?.capturedAt) return outcome.capturedAt
  const records = rawRecords(state, normalized) || []
  return records.map((record) => timestampOf(record)).filter(Boolean).sort().at(-1) || null
}

function scopeSummaries(state, domain, records) {
  const scopes = new Map()
  for (const record of records) {
    const key = text(record?.termId || record?._domain || record?.courseId, '未分类')
    const current = scopes.get(key) || {
      id: key,
      label: record?._domain ? domainLabel(state, key) : termLabel(state, key) || key,
      count: 0,
    }
    current.count += 1
    scopes.set(key, current)
  }
  return [...scopes.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'zh-CN')).slice(0, 40)
}

export function normalizeUserDataDomain(value) {
  const normalized = userDomainId(value)
  return normalized && DOMAIN_DEFINITIONS[normalized] ? normalized : null
}

export function projectUserDataDomainSummary(state, domain, { now = Date.now() } = {}) {
  const normalized = normalizeUserDataDomain(domain)
  if (!normalized) return null
  const records = rawRecords(state, normalized) || []
  const capturedAt = domainCapturedAt(state, normalized)
  const outcome = domainOutcome(state, normalized)
  const timestamp = capturedAt ? Date.parse(capturedAt) : NaN
  const stale = !Number.isFinite(timestamp) || now - timestamp > freshnessMs(normalized)
  const completeness = text(
    normalized === 'academic-extras'
      ? outcome?.completeness
      : normalized && JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES.includes(normalized)
        ? extraDomain(state, normalized)?.completeness || outcome?.completeness
        : outcome?.completeness,
    records.length ? 'complete' : 'unknown',
  )
  const status = outcome?.status === 'auth-required' ? 'auth-required'
    : outcome?.status === 'failed' ? 'failed'
      : completeness === 'partial' ? 'partial'
        : records.length ? 'available' : outcome?.emptyConfirmed ? 'confirmed-empty' : 'not-read'
  return {
    schema: USER_DATA_VIEW_SCHEMA,
    domain: normalized,
    label: domainLabel(state, normalized),
    count: records.length,
    scopes: scopeSummaries(state, normalized, records),
    completeness,
    status,
    statusLabel: STATUS_LABELS[status] || status || '状态未知',
    capturedAt,
    stale,
    primaryAction: status === 'not-read' || status === 'failed' || stale ? 'refresh' : 'open',
    retainedPrevious: outcome?.retainedPrevious === true,
    errorCode: outcome?.errorCode || null,
  }
}

export function projectUserDataRecords(state, domain, {
  query = '',
  termId = null,
  status = null,
  scope = 'current',
  limit = DEFAULT_LIMIT,
  cursor = '0',
  recordType = null,
  now = Date.now(),
} = {}) {
  const normalized = normalizeUserDataDomain(domain)
  if (!normalized) return null
  const all = (rawRecords(state, normalized) || []).map((record, index) => (
    record && typeof record === 'object' ? { ...record, _projectionIndex: index } : record
  ))
  const normalizedQuery = text(query).toLocaleLowerCase()
  const offset = Math.max(0, Number.parseInt(String(cursor || '0'), 10) || 0)
  const boundedLimit = Math.max(1, Math.min(MAX_LIMIT, Number.parseInt(String(limit), 10) || DEFAULT_LIMIT))
  const filteredRecords = sortRecords(state, all.filter((record) => {
    if (!matchesScope(state, record, normalized, scope)) return false
    if (termId && String(record?.termId || '') !== String(termId)) return false
    if (status && statusOf(record, normalized, now) !== status) return false
    if (recordType && text(record?.recordType || (record?._recordKind === 'attachment' ? 'attachment' : 'record')) !== String(recordType)) return false
    return !normalizedQuery || queryText(projectRecord(state, record, normalized, now)).includes(normalizedQuery)
  }), normalized, now)
  const items = filteredRecords.slice(offset, offset + boundedLimit).map((record) => projectRecord(state, record, normalized, now))
  const nextOffset = offset + items.length
  return {
    schema: USER_DATA_VIEW_SCHEMA,
    domain: normalized,
    label: domainLabel(state, normalized),
    scope,
    total: filteredRecords.length,
    items,
    nextCursor: nextOffset < filteredRecords.length ? String(nextOffset) : null,
    hasMore: nextOffset < filteredRecords.length,
  }
}

function attentionItems(state, now) {
  const assignments = (rawRecords(state, 'assignments') || [])
    .filter((item) => statusOf(item, 'assignments', now) === 'overdue' || statusOf(item, 'assignments', now) === 'pending')
    .sort((left, right) => Date.parse(String(left?.dueAt || '')) - Date.parse(String(right?.dueAt || '')))
    .slice(0, 6)
    .map((item) => projectRecord(state, item, 'assignments', now))
  const exams = (rawRecords(state, 'exams') || [])
    .filter((item) => statusOf(item, 'exams', now) === 'upcoming')
    .sort((left, right) => Date.parse(String(left?.startAt || left?.examTime || '')) - Date.parse(String(right?.startAt || right?.examTime || '')))
    .slice(0, 4)
    .map((item) => projectRecord(state, item, 'exams', now))
  return [...assignments, ...exams].slice(0, 10)
}

export function projectUserDataOverview(state, { snapshotRevision = null, now = Date.now() } = {}) {
  const definitions = [
    'terms', 'courses', 'schedule', 'grades', 'exams', 'selected-courses',
    'assignments', 'notices', 'emails', 'academic-progress', 'academic-extras',
  ]
  const sections = definitions.map((domain) => projectUserDataDomainSummary(state, domain, { now })).filter(Boolean)
  const extraDomains = JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES
    .map((domain) => projectUserDataDomainSummary(state, domain, { now }))
    .filter(Boolean)
  return {
    schema: USER_DATA_VIEW_SCHEMA,
    view: 'overview',
    snapshotRevision,
    generatedAt: new Date(now).toISOString(),
    currentTerm: (() => {
      const term = currentTerm(state)
      return term ? { id: text(term.id), label: text(term.label || term.id) } : null
    })(),
    attentionItems: attentionItems(state, now),
    sections,
    extraDomains,
    sync: {
      lastRunAt: state?.sync?.lastRunAt || null,
      lastSuccessAt: state?.sync?.lastSuccessAt || null,
      lastError: text(state?.sync?.lastError).slice(0, 500) || null,
    },
  }
}

/**
 * Build the renderer's bounded state envelope. Canonical storage, exports and
 * the compatibility snapshot keep every record; the ordinary UI only needs
 * domain metadata and asks the records IPC for a page when it opens a domain.
 */
export function projectRendererSnapshot(state) {
  const source = state && typeof state === 'object' ? state : {}
  const academicExtras = source.academicExtras && typeof source.academicExtras === 'object'
    ? {
      ...source.academicExtras,
      domains: Object.fromEntries(Object.entries(objectOrEmpty(source.academicExtras.domains)).map(([domain, value]) => {
        const keepRecords = domain === 'grade-details' || domain === 'free-classroom'
        const records = list(value?.records)
        return [domain, {
          ...value,
          recordCount: Number.isFinite(Number(value?.recordCount)) ? Number(value.recordCount) : records.length,
          records: keepRecords ? records : [],
        }]
      })),
    }
    : source.academicExtras
  const schoolSchedule = source.dataCatalog?.collections?.schoolSchedule
  const dataCatalog = source.dataCatalog && typeof source.dataCatalog === 'object'
    ? {
      ...source.dataCatalog,
      collections: {
        ...source.dataCatalog.collections,
        schoolSchedule: schoolSchedule
          ? {
            ...schoolSchedule,
            recordCount: Number.isFinite(Number(schoolSchedule.recordCount))
              ? Number(schoolSchedule.recordCount)
              : Object.keys(objectOrEmpty(schoolSchedule.records)).length,
            records: {},
          }
          : schoolSchedule,
      },
    }
    : source.dataCatalog
  const emails = list(source.emails).map((email) => ({
    ...email,
    body: null,
    bodyHtml: null,
    bodyHtmlVersion: null,
  }))
  return {
    ...source,
    academicExtras,
    dataCatalog,
    emails,
  }
}
