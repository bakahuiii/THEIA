import { academicTermCandidate, parseAcademicTerm } from '../util.mjs'
import {
  JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES,
  normalizeJwglxtExtraDomain,
} from '../jwglxt-extra.mjs'
import { parseJwQueryForm } from '../parsers/jwglxt.mjs'
import { domainHasData, sourceDomainOutcome } from '../domain-provenance.mjs'

export const PARSER_VERSION = 'jwglxt-adapter/1'
export const EXTRA_QUERY_CONCURRENCY = 4
export const EXTRA_QUERY_LIMIT = 32
export const EXTRA_DETAIL_LIMIT = 32
// The selected-term KccjGrid is the complete score-detail table. Per-course
// XmcjList requests are only a fallback for deployments that leave that grid
// empty; keep that fallback bounded but large enough to cover a normal term.
export const EXTRA_GRADE_DETAIL_LIMIT = 64
const SYNC_DOMAINS = new Set(['profile', 'terms', 'courses', 'schedule', 'grades', 'exams', 'selected-courses', 'academic-progress', 'notices', ...JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES, 'academic-extras'])
export const BROWSER_SCHEDULE_ENDPOINT = 'kbcx/xskbcx_cxXsgrkb.html'

export function selectedDomains(options = {}) {
  if (options.domains === undefined) return null
  if (!Array.isArray(options.domains) || !options.domains.length) throw new TypeError('JWGLXT sync domains must be a non-empty array')
  const domains = new Set(options.domains)
  if (domains.has('academic-extras')) {
    domains.delete('academic-extras')
    JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES.forEach((domain) => domains.add(domain))
  }
  const invalid = [...domains].find((domain) => !SYNC_DOMAINS.has(domain))
  if (invalid) throw new TypeError(`Unsupported JWGLXT sync domain: ${invalid}`)
  return domains
}

export function successfulDomain(value, domain, capturedAt, {
  completeness = 'complete',
  errorCode = null,
  successfulTermIds = [],
  failedTermIds = [],
} = {}) {
  const state = JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES.includes(domain) ? { academicExtras: { domains: { [domain]: value } } }
    : domain === 'selected-courses' ? { selectedCourses: value }
    : domain === 'academic-progress' ? { academicProgress: value }
      : { [domain]: value }
  return sourceDomainOutcome({
    source: 'jwglxt',
    attempted: true,
    succeeded: true,
    status: 'succeeded',
    capturedAt,
    emptyConfirmed: !domainHasData(state, domain),
    completeness,
    parserVersion: PARSER_VERSION,
    errorCode,
    successfulTermIds,
    failedTermIds,
  })
}

export function failedDomain(errorCode = 'domain_read_failed', { failedTermIds = [] } = {}) {
  return sourceDomainOutcome({
    source: 'jwglxt',
    attempted: true,
    succeeded: false,
    status: 'failed',
    retainedPrevious: false,
    completeness: 'unknown',
    parserVersion: PARSER_VERSION,
    errorCode,
    failedTermIds,
  })
}

export function requirementTreeHasCourses(progress) {
  const stack = Array.isArray(progress?.roots) ? [...progress.roots] : []
  while (stack.length) {
    const node = stack.pop()
    if (Array.isArray(node?.courses) && node.courses.length) return true
    if (Array.isArray(node?.children)) stack.push(...node.children)
  }
  return false
}
const UNIFIED_AUTH = 'https://experimental-auth-endpoint.buct.edu.cn/'

export function unifiedLoginUrl() {
  const url = new URL(UNIFIED_AUTH)
  url.searchParams.set('timestamp', String(Date.now()))
  url.searchParams.set('service', 'https://jwglxt.buct.edu.cn/sso/jziotlogin')
  return url.toString()
}

export function queryModel(pageSize = 500) {
  return {
    _search: 'false',
    nd: String(Date.now()),
    'queryModel.showCount': String(pageSize),
    'queryModel.currentPage': '1',
    'queryModel.sortName': '',
    'queryModel.sortOrder': 'asc',
    time: '0',
  }
}

export function fallbackTerm() {
  const candidate = academicTermCandidate()
  return parseAcademicTerm(candidate.year, candidate.term, candidate.label)
}

export function selectedCourseTerm(term) {
  const code = String(term?.term || '').trim()
  if (['3', '12', '16'].includes(code)) return code
  if (code === '1') return '3'
  if (code === '2') return '12'
  return code
}

export function uniqueTerms(...groups) {
  return groups.flat().filter((item, index, values) => item && values.findIndex((candidate) => candidate?.id === item.id) === index)
}

export function pickValues(values, keys) {
  const source = values && typeof values === 'object' ? values : {}
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(source, key)).map((key) => [key, source[key] ?? '']))
}

export function inputValueById(html, id) {
  const wanted = String(id || '').trim()
  if (!wanted) return ''
  const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const tag = String(html || '').match(new RegExp(`<input\\b[^>]*\\bid\\s*=\\s*["']${escaped}["'][^>]*>`, 'iu'))?.[0]
  return tag?.match(/\bvalue\s*=\s*["']([^"']*)["']/iu)?.[1] || ''
}

export function funcWidgetGuidFromPage(html) {
  const source = String(html || '')
  const match = source.match(/\bdata-func_widget_guid\s*=\s*["']([A-Za-z0-9_-]{16,128})["']/iu)
  return match?.[1] || ''
}

export function extraPageForm(page, routeCode) {
  const selectors = {
    N2154: ['#ajaxForm'],
    N2155: ['#searchForm'],
    N305007: ['#searchForm'],
    N358163: [],
    N358187: ['#queryForm_3B3209749DE5A5A6E0630B1D470A76DB'],
    N532560: ['#cjckForm'],
    N153540: ['#jxzxjhxxwh_cxJxzxjhxxwhIndex', '#kcForm'],
  }[routeCode] ?? ['form']
  const values = {}
  const options = {}
  for (const selector of selectors) {
    const parsed = parseJwQueryForm(page.text, page.url, selector)
    Object.assign(values, parsed.values || {})
    Object.assign(options, parsed.options || {})
  }
  return { values, options }
}

// These menu pages use the same URL for the rendered form and its read-only
// grid query. Keep the allowlist explicit: several neighbouring pages expose
// POST actions that submit an application, confirm a choice, or upload a
// document, and a generic "submit every form" fallback would cross that
// boundary. The three entries below are classified as read-only queries in
// the lab inventory and accept only filter/pagination fields.
const READ_ONLY_EXTRA_QUERY_ROUTES = Object.freeze({
  N105505: Object.freeze({
    keys: ['xh_id', 'xxdm', 'xjyjcxtjsfkxz', 'sfxsck', 'jg_id', 'njdm_id', 'zyh_id'],
  }),
  N105508: Object.freeze({
    keys: ['xh_id', 'byhcsfsjkz', 'byshjgsfxszsjg', 'xxdm', 'bynd'],
  }),
  N219933: Object.freeze({
    keys: ['xnm', 'xqm', 'kkbm_id', 'kc', 'js', 'kclb', 'kcxz', 'kcgs'],
  }),
})

export function readOnlyExtraQuery(routeCode, pageForm) {
  const descriptor = READ_ONLY_EXTRA_QUERY_ROUTES[routeCode]
  if (!descriptor) return null
  return {
    ...pickValues(pageForm?.values, descriptor.keys),
    ...queryModel(500),
  }
}

export function safeTermValues(term, values = {}) {
  const selectedYear = values && typeof values === 'object' ? values.xnm ?? values.cx_xnm ?? '' : ''
  const selectedTerm = values && typeof values === 'object' ? values.xqm ?? values.cx_xqm ?? '' : ''
  return {
    // The rendered page is authoritative for a user-selected year/semester.
    // The discovered global term is only a fallback for pages without a
    // selector (otherwise grade-details silently queried the wrong term).
    xnm: String(selectedYear || term?.year || ''),
    xqm: String(selectedTerm || term?.term || ''),
  }
}

export function selectableGradeTerms(pageForm, fallbackTerms = [], fallbackTerm = null) {
  const selected = safeTermValues(fallbackTerm, pageForm?.values)
  const yearOptions = new Set((pageForm?.options?.xnm || []).map((option) => String(option?.value || '')).filter(Boolean))
  const termOptions = new Set((pageForm?.options?.xqm || []).map((option) => String(option?.value || '')).filter(Boolean))
  const candidates = [
    selected,
    ...(Array.isArray(fallbackTerms) ? fallbackTerms : []).map((term) => ({
      xnm: String(term?.year || ''),
      xqm: String(term?.term || ''),
    })),
  ]
  return candidates
    .filter((item) => item.xnm && item.xqm)
    .filter((item) => (!yearOptions.size || yearOptions.has(item.xnm)) && (!termOptions.size || termOptions.has(item.xqm)))
    .filter((item, index, values) => values.findIndex((candidate) => candidate.xnm === item.xnm && candidate.xqm === item.xqm) === index)
    .slice(0, 12)
}

export function gradeTermLabel({ xnm, xqm }) {
  const semester = ({ 3: '1', 12: '2', 16: '3' })[String(xqm)] || String(xqm)
  return `${xnm}-${Number(xnm) + 1} 学年第 ${semester} 学期`
}

const EXTRA_RECORD_TYPE_LABELS = Object.freeze({
  page: '页面状态',
  'plan-summary': '计划概要',
  'plan-course': '计划课程',
  'plan-requirement': '修读要求',
  'plan-preview': '培养计划预览',
  'plan-class': '计划班级',
  'plan-track': '专业方向',
  'grade-course': '成绩课程',
  'grade-component': '成绩分项',
  'grade-component-fallback': '成绩分项（课程明细）',
})

export function decorateExtraValue(value, domain, recordType) {
  if (!value || !recordType || !Array.isArray(value.records)) return value
  const label = EXTRA_RECORD_TYPE_LABELS[recordType] || recordType
  return normalizeJwglxtExtraDomain({
    ...value,
    records: value.records.map((record) => ({
      ...record,
      id: record.id ? `${record.id}:${recordType}` : record.id,
      recordType,
      recordTypeLabel: label,
    })),
  }, domain)
}

export function planRowMatches(row, filters) {
  if (!row || typeof row !== 'object') return false
  const valuesFor = (keys) => keys.map((key) => row[key])
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== '')
  const matches = (expected, keys, { required = false } = {}) => {
    if (!expected) return true
    const present = valuesFor(keys)
    if (!present.length) return !required
    return present.some((value) => String(value).trim() === expected)
  }
  const hasMajorIdentity = Boolean(filters.majorId || filters.majorName)
  if (hasMajorIdentity && !(
    matches(filters.majorId, ['majorId', 'majorCode', 'zyh', 'zyh_id'], { required: Boolean(filters.majorId) })
    && matches(filters.majorName, ['major', 'zymc'], { required: Boolean(filters.majorName) })
  )) return false
  return matches(filters.grade, ['grade', 'njdm', 'njmc'])
    && matches(filters.department, ['departmentId', 'jg_id', 'jgId'])
}

export function selectedPlanFilters(pageForm, profile = null) {
  const values = pageForm?.values || {}
  return {
    grade: String(values.njdm_id || values.nj_cx || profile?.grade || '').trim(),
    department: String(values.jg_id || '').trim(),
    majorId: String(values.zyh_id || values.zyh_id_cx || profile?.majorId || profile?.majorCode || '').trim(),
    majorName: String(profile?.major || profile?.majorName || '').trim(),
  }
}

export function filterPlanRows(rows, filters) {
  const source = Array.isArray(rows) ? rows : []
  if (!Object.values(filters).some(Boolean)) return source
  return source.filter((row) => planRowMatches(row, filters))
}

export function bitmask(values, maximum = 64) {
  const list = Array.isArray(values) ? values : String(values ?? '').split(',')
  return [...new Set(list.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 1 && value <= maximum))]
    .reduce((mask, value) => mask | (2 ** (value - 1)), 0)
}

// The N2155 page computes these three values in the browser. Keeping the
// calculation here makes the query deterministic and avoids opening a second
// renderer just to click week/day/period cells.
export function buildFreeClassroomQuery({ term, formValues = {}, formOptions = {}, weeks, weekdays, periods } = {}) {
  const values = formValues && typeof formValues === 'object' ? formValues : {}
  const options = formOptions && typeof formOptions === 'object' ? formOptions : {}
  // Empty arrays mean "no explicit selection" — normalize to null so the
  // endpoint falls back to the page default instead of sending zcd=0 / jcd=0.
  const selectedWeeks = weeks === undefined || (Array.isArray(weeks) && !weeks.length) ? null : weeks
  const selectedWeekdays = weekdays === undefined || (Array.isArray(weekdays) && !weekdays.length) ? null : weekdays
  const selectedPeriods = periods === undefined || (Array.isArray(periods) && !periods.length) ? null : periods

  // Map display names to internal IDs using the page form options.
  function resolveOption(name, raw) {
    if (!raw || typeof raw !== 'string') return raw
    const list = Array.isArray(options[name]) ? options[name] : []
    const trimmed = String(raw).trim()
    // If the raw value is already an ID known to the options list, keep it.
    if (list.some((item) => item.value === trimmed)) return trimmed
    // Exact label match (whitespace-normalized) first; only fall back to a
    // whole-label substring match when the input is long enough to be safe
    // from accidental over-matching (e.g. "一" should not hit "第一教学楼").
    const normalized = trimmed.replace(/\s+/g, '')
    const exact = list.find((item) => String(item.label || '').replace(/\s+/g, '') === normalized)
    if (exact) return exact.value
    if (normalized.length >= 2) {
      const partial = list.find((item) => String(item.label || '').replace(/\s+/g, '').includes(normalized))
      if (partial) return partial.value
    }
    return trimmed
  }

  const result = {
    ...safeTermValues(term, values),
    xqh_id: resolveOption('xqh_id', values.xqh_id || ''),
    lh: resolveOption('lh', values.lh || ''),
    cdlb_id: resolveOption('cdlb_id', values.cdlb_id || ''),
    cdejlb_id: values.cdejlb_id || '',
    qszws: values.qszws || '',
    jszws: values.jszws || '',
    cdmc: values.cdmc || '',
    jyfs: values.jyfs || '0',
  }
  result.zcd = selectedWeeks === null ? (values.zcd ?? 0) : bitmask(selectedWeeks, 64)
  result.xqj = selectedWeekdays === null
    ? (values.xqj || '1,2,3,4,5,6,7')
    : [...new Set((Array.isArray(selectedWeekdays) ? selectedWeekdays : [selectedWeekdays]).map(Number).filter((value) => value >= 1 && value <= 7))].sort((a, b) => a - b).join(',')
  result.jcd = selectedPeriods === null ? (values.jcd ?? 0) : bitmask(selectedPeriods, 32)
  return result
}

export function buildWeeklyScheduleQuery({ term, formValues = {}, studentId = '' } = {}) {
  const values = formValues && typeof formValues === 'object' ? formValues : {}
  const radio = String(values.radio1 || values.kblx || '1')
  return {
    ...safeTermValues(term, values),
    ...(radio === '1' ? { zs: values.zs || values.zc || '' } : {}),
    radio1: radio,
    kblx: String(values.kblx || radio),
    doType: 'app',
    xh: String(values.xh || studentId || ''),
  }
}

export async function mapWithConcurrency(items, maximum, worker) {
  const values = Array.isArray(items) ? items : []
  const results = new Array(values.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(Math.max(1, maximum), values.length) }, async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= values.length) return
      results[index] = await worker(values[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

export function mergeExtraDomainValues(left, right, domain) {
  const a = left || {}
  const b = right || {}
  const byId = new Map()
  for (const item of [...(a.records || []), ...(b.records || [])]) {
    if (!item?.id) continue
    byId.set(item.id, { ...(byId.get(item.id) || {}), ...item })
  }
  return normalizeJwglxtExtraDomain({
    ...a,
    ...b,
    // Query responses are often POST/JSON endpoints. Keep the rendered menu
    // page as the user-facing provenance link so opening "来源页面" does not
    // replay an endpoint GET and fall into the login flow.
    sourceUrl: a.sourceUrl || b.sourceUrl,
    routeCodes: [...new Set([...(a.routeCodes || []), ...(b.routeCodes || [])])],
    records: [...byId.values()],
    attachments: [...(a.attachments || []), ...(b.attachments || [])],
    filters: [...(a.filters || []), ...(b.filters || [])],
    options: { ...(a.options || {}), ...(b.options || {}) },
    messages: [...new Set([...(a.messages || []), ...(b.messages || [])])],
    queryStats: {
      attempted: Number(a.queryStats?.attempted || 0) + Number(b.queryStats?.attempted || 0),
      succeeded: Number(a.queryStats?.succeeded || 0) + Number(b.queryStats?.succeeded || 0),
      failed: Number(a.queryStats?.failed || 0) + Number(b.queryStats?.failed || 0),
      capped: Boolean(a.queryStats?.capped || b.queryStats?.capped),
    },
  }, domain)
}

export function termRank(termId) {
  const [year = '', code = ''] = String(termId || '').split('-')
  const sequence = { '3': 1, '12': 2, '16': 3 }
  return Number(year) * 10 + (sequence[code] || 0)
}

export function newestFirstTermIds(...groups) {
  return [...new Set(groups.flat().filter(Boolean))].sort((left, right) => termRank(right) - termRank(left))
}

export function fetchCoverage(fetchLog) {
  return {
    successfulTermIds: fetchLog.filter((item) => !item.error && !item.unpositioned).map((item) => item.termId),
    failedTermIds: fetchLog.filter((item) => item.error || item.unpositioned).map((item) => item.termId),
  }
}

const COMMON_PAYLOAD_KEYS = [
  'items', 'rows', 'data', 'result', 'list', 'aaData', 'records', 'recordList',
  'dataList', 'gradeList', 'courseList', 'courses',
]

const PAYLOAD_ARRAY_KEYS = new Set([
  ...COMMON_PAYLOAD_KEYS,
  'kbList', 'sjkList', 'jxhjkcList',
].map((key) => key.toLowerCase()))

const PAYLOAD_ARRAY_PRIORITY = [
  'kblist', 'items', 'rows', 'data', 'result', 'list', 'aadata', 'records',
  'recordlist', 'datalist', 'gradelist', 'courselist', 'sjklist', 'jxhjkclist',
]

export function findRecordArray(value, depth = 0, seen = new Set()) {
  if (Array.isArray(value)) return { found: true, value }
  if (!value || typeof value !== 'object' || depth > 5 || seen.has(value)) return { found: false, value: [] }
  seen.add(value)
  const entries = Object.entries(value).sort(([left], [right]) => {
    const leftRank = PAYLOAD_ARRAY_PRIORITY.indexOf(String(left).toLowerCase())
    const rightRank = PAYLOAD_ARRAY_PRIORITY.indexOf(String(right).toLowerCase())
    return (leftRank < 0 ? Number.MAX_SAFE_INTEGER : leftRank) - (rightRank < 0 ? Number.MAX_SAFE_INTEGER : rightRank)
  })
  let firstEmpty = null
  for (const [key, nestedValue] of entries) {
    if (!PAYLOAD_ARRAY_KEYS.has(String(key).toLowerCase())) continue
    if (Array.isArray(nestedValue)) {
      if (nestedValue.length) return { found: true, value: nestedValue }
      firstEmpty ||= { found: true, value: nestedValue }
      continue
    }
    const nested = findRecordArray(nestedValue, depth + 1, seen)
    if (nested.found && nested.value.length) return nested
    if (nested.found) firstEmpty ||= nested
  }
  return firstEmpty || { found: false, value: [] }
}

export function hasExplicitEmptyPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const code = value.code ?? value.statusCode ?? value.status
  const success = value.success ?? value.ok
  const totals = []
  const collectTotals = (node, depth = 0, seen = new Set()) => {
    if (!node || typeof node !== 'object' || depth > 4 || seen.has(node)) return
    seen.add(node)
    for (const [key, nested] of Object.entries(node)) {
      if (['totalresult', 'recordstotal', 'total', 'count'].includes(String(key).toLowerCase())) totals.push(nested)
      else if (nested && typeof nested === 'object') collectTotals(nested, depth + 1, seen)
    }
  }
  collectTotals(value)
  const total = totals[0] ?? value.totalResult ?? value.recordsTotal ?? value.total ?? value.count
  return (success === true || ['0', '1000', '1005', 'success'].includes(String(code ?? '').toLowerCase()))
    && (total === 0 || total === '0' || value.data === null || (value.data && typeof value.data === 'object' && !Object.keys(value.data).length))
}

export function hasRecordEnvelope(value) {
  return findRecordArray(value).found || hasExplicitEmptyPayload(value)
}

export function hasRecognizedTable(body) {
  if (typeof body !== 'string' || !/<table\b/i.test(body)) return false
  if (/<tbody\b[^>]*>\s*<tr\b/i.test(body) && !/<input\b[^>]*type\s*=\s*["']?password/i.test(body)) return true
  return /<(?:th|td)\b[^>]*>[^<]*(?:课程|成绩|考试|学年|学期|Course|Grade|Exam)/iu.test(body)
    || /(?:没有符合条件记录|无数据显示|暂无数据|未查询到[^<]*记录)/u.test(body)
}

export function assertValidQueryPayload(body, domain) {
  const text = typeof body === 'string' ? body.trim() : ''
  if (text.startsWith('{') || text.startsWith('[')) {
    let payload
    try {
      payload = JSON.parse(text)
      for (let depth = 0; typeof payload === 'string' && depth < 3; depth += 1) payload = JSON.parse(payload)
    } catch {
      throw new Error(`${domain}_invalid_json`)
    }
    const statusCode = Number(payload?.code ?? payload?.statusCode)
    const statusText = String(payload?.status ?? '').trim().toLowerCase()
    const successfulEnvelopeCode = [0, 1000, 1005].includes(statusCode)
    if (payload?.success === false || payload?.ok === false
      || String(payload?.success ?? '').toLowerCase() === 'false'
      || String(payload?.ok ?? '').toLowerCase() === 'false'
      || (Number.isFinite(statusCode) && statusCode >= 400 && !successfulEnvelopeCode)
      || ['error', 'failed', 'failure'].includes(statusText)
      || (typeof payload?.error === 'string' && payload.error.trim())) {
      throw new Error(`${domain}_error_payload`)
    }
    if (hasRecordEnvelope(payload)) return
    throw new Error(`${domain}_unexpected_payload`)
  }
  if (hasRecognizedTable(body)) return
  throw new Error(`${domain}_unexpected_payload`)
}

const TERM_CODES = ['3', '12', '16']

export function scheduleRequestValues(endpoint, term, scheduleForm) {
  const directApiEndpoint = /(?:^|\/)xskbcx_cxXsKb\.html(?:$|\?)/i.test(String(endpoint || ''))
  if (directApiEndpoint) {
    // The direct Zhengfang JSON endpoint is intentionally smaller than the
    // rendered browser form. Hidden form fields (especially kzlx=ck) can make
    // an otherwise valid xnm/xqm query return an empty kbList.
    return { xnm: String(term.year), xqm: String(term.term) }
  }
  return {
    ...(scheduleForm?.values || {}),
    xnm: String(term.year),
    xqm: term.term,
    kzlx: 'ck',
  }
}

export function scheduleTerms(activeTerm, discoveredTerms, profile) {
  const years = new Set()
  for (const item of discoveredTerms) {
    if (Number.isInteger(item?.year) && item.year >= 2000 && item.year <= activeTerm.year) years.add(item.year)
  }
  const studentIdYear = Number.parseInt(String(profile?.studentId || '').slice(0, 4), 10)
  const firstYear = Number.isInteger(studentIdYear) && studentIdYear >= 2000 && studentIdYear <= activeTerm.year
    ? studentIdYear
    : Math.min(...years, activeTerm.year)
  for (let year = activeTerm.year; year >= firstYear; year -= 1) years.add(year)
  const expanded = [...years]
    // Zhengfang keeps historical placeholder years in its selector. The degree
    // plan starts with the admission year encoded in the student id, so those
    // entries must not turn into hundreds of needless network requests.
    .filter((year) => year >= firstYear && year <= activeTerm.year)
    .sort((left, right) => right - left)
    .flatMap((year) => TERM_CODES.map((term) => parseAcademicTerm(year, term, '')))
  return uniqueTerms(activeTerm, ...expanded)
}
