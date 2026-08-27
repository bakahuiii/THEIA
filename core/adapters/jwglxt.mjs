import { academicTermCandidate, compactError, parseAcademicTerm, stableId } from '../util.mjs'
import { AuthRequiredError } from '../source-client.mjs'
import { categoryLabelOf, preferredCourseCategory } from '../course-category.mjs'
import { describeJwSchedulePayload, isRenderableScheduleItem, isStandardCourseCode, parseJwAcademicProgress, parseJwExams, parseJwGrades, parseJwHomepage, parseJwNotices, parseJwQueryForm, parseJwSchedule, parseJwSelectedCourses, parseJwStudentIdentity } from '../parsers/jwglxt.mjs'
import { domainHasData, sourceDomainOutcome } from '../domain-provenance.mjs'
import { academicPlanNodes, readAcademicProgressDetails } from '../academic-api-client.mjs'
import { degreePlanDetailsToProgress, mergeAcademicProgressDetails } from '../academic-progress.mjs'
import {
  JWGLXT_EXTRA_DOMAINS,
  JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES,
  JWGLXT_EXTRA_PARSER_VERSION,
  normalizeFormOptions,
  normalizeJwglxtExtraDomain,
  parseJwglxtExtraJson,
  parseJwglxtExtraPage,
} from '../jwglxt-extra.mjs'

const BASE = 'https://jwglxt.buct.edu.cn/jwglxt/'
const HOME = new URL('xtgl/index_initMenu.html', BASE).toString()
const ACADEMIC_PROGRESS = new URL('xsxy/xsxyqk_cxXsxyqkIndex.html?gnmkdm=N105515&layout=default', BASE).toString()
const PARSER_VERSION = 'jwglxt-adapter/1'
const EXTRA_QUERY_CONCURRENCY = 4
const EXTRA_QUERY_LIMIT = 32
const EXTRA_DETAIL_LIMIT = 32
// The selected-term KccjGrid is the complete score-detail table. Per-course
// XmcjList requests are only a fallback for deployments that leave that grid
// empty; keep that fallback bounded but large enough to cover a normal term.
const EXTRA_GRADE_DETAIL_LIMIT = 64
const SYNC_DOMAINS = new Set(['profile', 'terms', 'courses', 'schedule', 'grades', 'exams', 'selected-courses', 'academic-progress', 'notices', ...JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES, 'academic-extras'])
const BROWSER_SCHEDULE_ENDPOINT = 'kbcx/xskbcx_cxXsgrkb.html'

function selectedDomains(options = {}) {
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

function successfulDomain(value, domain, capturedAt, {
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

function failedDomain(errorCode = 'domain_read_failed', { failedTermIds = [] } = {}) {
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

function requirementTreeHasCourses(progress) {
  const stack = Array.isArray(progress?.roots) ? [...progress.roots] : []
  while (stack.length) {
    const node = stack.pop()
    if (Array.isArray(node?.courses) && node.courses.length) return true
    if (Array.isArray(node?.children)) stack.push(...node.children)
  }
  return false
}
const UNIFIED_AUTH = 'https://experimental-auth-endpoint.buct.edu.cn/'

function unifiedLoginUrl() {
  const url = new URL(UNIFIED_AUTH)
  url.searchParams.set('timestamp', String(Date.now()))
  url.searchParams.set('service', 'https://jwglxt.buct.edu.cn/sso/jziotlogin')
  return url.toString()
}

function queryModel(pageSize = 500) {
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

function fallbackTerm() {
  const candidate = academicTermCandidate()
  return parseAcademicTerm(candidate.year, candidate.term, candidate.label)
}

function selectedCourseTerm(term) {
  const code = String(term?.term || '').trim()
  if (['3', '12', '16'].includes(code)) return code
  if (code === '1') return '3'
  if (code === '2') return '12'
  return code
}

function uniqueTerms(...groups) {
  return groups.flat().filter((item, index, values) => item && values.findIndex((candidate) => candidate?.id === item.id) === index)
}

function pickValues(values, keys) {
  const source = values && typeof values === 'object' ? values : {}
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(source, key)).map((key) => [key, source[key] ?? '']))
}

function inputValueById(html, id) {
  const wanted = String(id || '').trim()
  if (!wanted) return ''
  const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const tag = String(html || '').match(new RegExp(`<input\\b[^>]*\\bid\\s*=\\s*["']${escaped}["'][^>]*>`, 'iu'))?.[0]
  return tag?.match(/\bvalue\s*=\s*["']([^"']*)["']/iu)?.[1] || ''
}

function funcWidgetGuidFromPage(html) {
  const source = String(html || '')
  const match = source.match(/\bdata-func_widget_guid\s*=\s*["']([A-Za-z0-9_-]{16,128})["']/iu)
  return match?.[1] || ''
}

function extraPageForm(page, routeCode) {
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

function readOnlyExtraQuery(routeCode, pageForm) {
  const descriptor = READ_ONLY_EXTRA_QUERY_ROUTES[routeCode]
  if (!descriptor) return null
  return {
    ...pickValues(pageForm?.values, descriptor.keys),
    ...queryModel(500),
  }
}

function safeTermValues(term, values = {}) {
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

function selectableGradeTerms(pageForm, fallbackTerms = [], fallbackTerm = null) {
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

function gradeTermLabel({ xnm, xqm }) {
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

function decorateExtraValue(value, domain, recordType) {
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

function planRowMatches(row, filters) {
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

function selectedPlanFilters(pageForm, profile = null) {
  const values = pageForm?.values || {}
  return {
    grade: String(values.njdm_id || values.nj_cx || profile?.grade || '').trim(),
    department: String(values.jg_id || '').trim(),
    majorId: String(values.zyh_id || values.zyh_id_cx || profile?.majorId || profile?.majorCode || '').trim(),
    majorName: String(profile?.major || profile?.majorName || '').trim(),
  }
}

function filterPlanRows(rows, filters) {
  const source = Array.isArray(rows) ? rows : []
  if (!Object.values(filters).some(Boolean)) return source
  return source.filter((row) => planRowMatches(row, filters))
}

function bitmask(values, maximum = 64) {
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

async function mapWithConcurrency(items, maximum, worker) {
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

function mergeExtraDomainValues(left, right, domain) {
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

function termRank(termId) {
  const [year = '', code = ''] = String(termId || '').split('-')
  const sequence = { '3': 1, '12': 2, '16': 3 }
  return Number(year) * 10 + (sequence[code] || 0)
}

function newestFirstTermIds(...groups) {
  return [...new Set(groups.flat().filter(Boolean))].sort((left, right) => termRank(right) - termRank(left))
}

function fetchCoverage(fetchLog) {
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

function findRecordArray(value, depth = 0, seen = new Set()) {
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

function hasExplicitEmptyPayload(value) {
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

function hasRecordEnvelope(value) {
  return findRecordArray(value).found || hasExplicitEmptyPayload(value)
}

function hasRecognizedTable(body) {
  if (typeof body !== 'string' || !/<table\b/i.test(body)) return false
  if (/<tbody\b[^>]*>\s*<tr\b/i.test(body) && !/<input\b[^>]*type\s*=\s*["']?password/i.test(body)) return true
  return /<(?:th|td)\b[^>]*>[^<]*(?:课程|成绩|考试|学年|学期|Course|Grade|Exam)/iu.test(body)
    || /(?:没有符合条件记录|无数据显示|暂无数据|未查询到[^<]*记录)/u.test(body)
}

function assertValidQueryPayload(body, domain) {
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

function scheduleRequestValues(endpoint, term, scheduleForm) {
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

function scheduleTerms(activeTerm, discoveredTerms, profile) {
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

export class JwglxtAdapter {
  constructor(client, {
    onProgress,
    onDiagnostic,
    academicProgressSource = 'browser',
    scheduleEndpoints = [BROWSER_SCHEDULE_ENDPOINT],
    attachmentStore = null,
  } = {}) {
    this.client = client
    this.onProgress = onProgress || null
    this.onDiagnostic = onDiagnostic || client?.diagnostic?.bind(client) || (() => {})
    this.academicProgressSource = academicProgressSource === 'api' ? 'api' : 'browser'
    this.attachmentStore = attachmentStore && typeof attachmentStore.save === 'function' ? attachmentStore : null
    this.scheduleEndpoints = [...new Set((Array.isArray(scheduleEndpoints) ? scheduleEndpoints : [scheduleEndpoints])
      .filter((endpoint) => typeof endpoint === 'string' && endpoint.trim()))]
    if (!this.scheduleEndpoints.length) this.scheduleEndpoints = [BROWSER_SCHEDULE_ENDPOINT]
    this.academicProgressDiagnostics = null
    this.client.setDiagnostic?.(this.onDiagnostic)
  }

  async status() {
    const checkedAt = new Date().toISOString()
    try {
      const result = await this.client.page(HOME, { source: 'Academic system' })
      const parsed = parseJwHomepage(result.text, result.url)
      if (!parsed.loggedIn) throw new AuthRequiredError('Academic system', result.url)
      return { connected: true, checkedAt, url: result.url, profile: parsed.profile }
    } catch (error) {
      return { connected: false, checkedAt, authRequired: error instanceof AuthRequiredError, error: compactError(error) }
    }
  }

  // This page is the official source for the full degree-plan hierarchy,
  // including courses that are planned but not yet taken.
  async fetchAcademicProgress({ capturedAt = new Date().toISOString() } = {}) {
    this.onProgress?.({ stage: 'academic-progress', status: 'syncing', label: 'Reading degree requirements...' })
    const page = await this.client.page(ACADEMIC_PROGRESS, { source: 'Academic progress' })
    const direct = parseJwAcademicProgress(page.text, { sourceUrl: page.url, capturedAt })
    const recovered = Array.isArray(direct.roots) && direct.roots.length
      ? direct
      : academicPlanNodes(page.text, page.url).progress
    if (Array.isArray(recovered.roots) && recovered.roots.length && requirementTreeHasCourses(recovered)) {
      const progress = {
        ...recovered,
        capturedAt,
        requirementSource: recovered === direct
          ? `${this.academicProgressSource}-dom-tree`
          : `${this.academicProgressSource}-embedded-tree`,
      }
      this.academicProgressDiagnostics = {
        strategy: progress.requirementSource,
        categories: progress.categories?.length || 0,
        roots: progress.roots.length,
        detailRequests: 0,
        detailErrors: 0,
      }
      this.client.diagnostic?.('academic_progress.tree_loaded', this.academicProgressDiagnostics)
      return progress
    }

    this.onProgress?.({ stage: 'academic-progress', status: 'syncing', label: '正在补全培养方案节点…' })
    const details = await readAcademicProgressDetails(this.client, { page, concurrency: 4 })
    const detailed = degreePlanDetailsToProgress(recovered, details, {
      treeSource: `${this.academicProgressSource}-tree-detail`,
      inferredSource: `${this.academicProgressSource}-inferred-tree`,
      capturedAt,
    })
    const progress = detailed ? mergeAcademicProgressDetails(recovered, detailed) : recovered
    this.academicProgressDiagnostics = {
      strategy: progress?.requirementSource || 'summary-only',
      categories: progress?.categories?.length || 0,
      roots: progress?.roots?.length || 0,
      detailRequests: details.nodeCount || 0,
      detailLoaded: details.details.length,
      detailErrors: details.errors.length,
    }
    this.client.diagnostic?.('academic_progress.tree_fallback', this.academicProgressDiagnostics)
    return progress
  }

  async fetchExtraPayload({
    url,
    values = null,
    method = 'post',
    source,
    referer,
    domain,
    routeCode,
    capturedAt,
    recordType = 'page',
    includeCandidateRecords = false,
  }) {
    let body
    let sourceUrl = url
    let headers = null
    let binaryBody = null
    let requestUrl = null
    let cachedPreview = null
    const isPlanPreview = domain === 'academic-plan' && /jxzxjhxxwh_cxDyJxzxjhxx\.html/iu.test(String(url || ''))
    if (method === 'get') {
      const target = new URL(url, BASE)
      for (const [key, value] of Object.entries(values || {})) {
        if (value !== null && value !== undefined && value !== '') target.searchParams.set(key, String(value))
      }
      requestUrl = target.toString()
      if (isPlanPreview && this.attachmentStore?.find) {
        const attachmentId = stableId('jwglxt-attachment', requestUrl)
        cachedPreview = await this.attachmentStore.find(attachmentId, 'pdf').catch(() => null)
        if (cachedPreview) {
          sourceUrl = requestUrl
          headers = new Headers({ 'content-type': 'application/pdf' })
        }
      }
      // A PDF preview must travel through the binary client path. Going
      // through `page()` decodes its bytes as text and forces the user to
      // download it again when they click the UI later.
      if (cachedPreview) {
        body = ''
      } else if (isPlanPreview && typeof this.client.binary === 'function') {
        const result = await this.client.binary(requestUrl, { source })
        sourceUrl = result?.url || requestUrl
        headers = result?.headers || null
        binaryBody = Buffer.isBuffer(result?.buffer) ? result.buffer : Buffer.from(result?.buffer || '')
        body = ''
      } else {
        const result = await this.client.page(requestUrl, { source, signal: null })
        body = String(result?.text || '')
        sourceUrl = result?.url || requestUrl
        headers = result?.headers || null
      }
    } else {
      body = String(await this.client.form(url, values || {}, { source, referer: referer || url }))
    }
    // The teaching-execution-plan preview endpoint returns the official PDF
    // itself. Never feed its binary body through the HTML parser: store only
    // a bounded, authenticated provenance attachment and let the UI open the
    // original response in the source window.
    const contentType = String(headers?.get?.('content-type') || '')
    if (method === 'get' && (cachedPreview || /application\/pdf/iu.test(contentType) || /^%PDF-/u.test(body.trim()) || binaryBody?.subarray(0, 5).toString('ascii') === '%PDF-')) {
      const attachmentId = stableId('jwglxt-attachment', requestUrl || sourceUrl)
      let cached = cachedPreview
      if (this.attachmentStore?.find) cached = await this.attachmentStore.find(attachmentId, 'pdf').catch(() => null)
      if (!cached && binaryBody?.length) {
        cached = await this.attachmentStore.save({
          id: attachmentId,
          // This route is known to return the official cultivation-plan PDF,
          // even when Zhengfang uses an extensionless or .ashx URL.
          extension: 'pdf',
          buffer: binaryBody,
          exclusive: true,
        }).catch((error) => {
          this.onDiagnostic?.('jwglxt.attachment_cache_failed', { domain, routeCode, error: compactError(error) })
          return null
        })
      }
      if (cached && this.attachmentStore?.keepOnly) {
        await this.attachmentStore.keepOnly({ id: attachmentId, extension: 'pdf' }).catch((error) => {
          this.onDiagnostic?.('jwglxt.attachment_prune_failed', { domain, routeCode, error: compactError(error) })
        })
      }
      const attachment = {
        id: attachmentId,
        label: '官方培养计划 PDF',
        type: 'pdf',
        sourceUrl,
        ...(cached ? {
          cached: true,
          bytes: cached.bytes,
          sha256: cached.sha256 || null,
          filename: cached.filename || null,
        } : {}),
      }
      return decorateExtraValue(normalizeJwglxtExtraDomain({
        label: JWGLXT_EXTRA_DOMAINS[domain]?.label || domain,
        routeCodes: [routeCode],
        sourceUrl,
        capturedAt,
        completeness: 'complete',
        attachments: [attachment],
        records: [],
        queryStats: { attempted: 1, succeeded: 1, failed: 0 },
      }, domain), domain, recordType)
    }
    assertValidQueryPayload(body, domain)
    const trimmed = body.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      const parsed = parseJwglxtExtraJson(trimmed, { domain, routeCode, sourceUrl, capturedAt, includeCandidateRecords })
      const decorated = decorateExtraValue(parsed, domain, recordType)
      return includeCandidateRecords && Array.isArray(parsed.candidateRecords)
        ? { ...decorated, candidateRecords: parsed.candidateRecords }
        : decorated
    }
    return decorateExtraValue(
      parseJwglxtExtraPage(body, { domain, routeCode, sourceUrl, capturedAt }),
      domain,
      recordType,
    )
  }

  async fetchExtraRoute({ domain, route, page, term, terms = [], homepage, capturedAt, freeClassroomQuery = null }) {
    const pageForm = extraPageForm(page, route.code)
    // For jqGrid-backed N153540 the rendered page contains only the first
    // viewport row while the authoritative query returns the full result.
    // Start empty so that the query does not leave a duplicate/partial first
    // row beside the complete dataset. Other detail/status pages still use
    // their rendered fields as a useful fallback.
    let value = route.code === 'N153540'
      ? normalizeJwglxtExtraDomain({ label: JWGLXT_EXTRA_DOMAINS[domain]?.label, routeCodes: [route.code], sourceUrl: page.url, capturedAt, records: [], completeness: 'partial' }, domain)
      : parseJwglxtExtraPage(page.text, {
        domain,
        routeCode: route.code,
        sourceUrl: page.url,
        capturedAt,
      })
    value = decorateExtraValue(value, domain, 'page')
    const errors = []
    const stats = { attempted: 0, succeeded: 0, failed: 0, capped: false }
    const run = async ({ label, url, method = 'post', values = {}, detail = false, recordType = 'page', includeCandidateRecords = false }) => {
      stats.attempted += 1
      try {
        const parsed = await this.fetchExtraPayload({
          url,
          values,
          method,
          source: `JWGLXT ${label}`,
          referer: page.url,
          domain,
          routeCode: route.code,
          capturedAt,
          recordType,
          includeCandidateRecords,
        })
        // Query statistics belong to the adapter outcome, not every merged
        // fragment. Avoid counting the same request twice when normalizing.
        value = mergeExtraDomainValues(value, { ...parsed, queryStats: { attempted: 0, succeeded: 0, failed: 0 } }, domain)
        stats.succeeded += 1
        return parsed
      } catch (error) {
        stats.failed += 1
        errors.push(compactError(error))
        this.onDiagnostic?.('jwglxt.extra_query_failed', { domain, routeCode: route.code, detail, error: compactError(error) })
        return null
      }
    }

    const termValues = safeTermValues(term, pageForm.values)
    const routeCode = route.code
    if (routeCode === 'N105505' && typeof this.client.form === 'function') {
      // The page only renders the filters. The actual read-only warning list
      // is loaded by cxXjyj.js from the student-scoped endpoint below.
      const studentId = inputValueById(page.text, 'xh_id') || homepage?.profile?.studentId || ''
      const url = new URL('xjyj/xjyj_cxXjyjjdlb.html', BASE)
      if (studentId) url.searchParams.set('id', studentId)
      await run({
        label: '学业预警查询',
        url: url.toString(),
        values: pickValues(pageForm.values, ['jg_id', 'njdm_id', 'zyh_id']),
      })
    } else if (routeCode === 'N105508' && typeof this.client.form === 'function') {
      // cxByshjgHcIndex.js posts the selected graduation year and an explicit
      // query mode to the page's read-only result endpoint.
      await run({
        label: '毕业审核查询',
        url: new URL('bygl/bysh_cxByshjgHcIndex.html', BASE).toString(),
        values: { ...pickValues(pageForm.values, ['bynd']), doType: 'query' },
      })
    } else if (routeCode === 'N219933' && typeof this.client.form === 'function') {
      // The all-school schedule page is a generic function widget. Its GUID
      // is emitted by the page and can change across deployments, so prefer
      // the live data attribute and only retain the known lab value as a last
      // resort for old cached markup.
      const guid = funcWidgetGuidFromPage(page.text) || '5920CCA8B9E61FBAE0530100007F0493'
      const url = new URL('design/funcData_cxFuncDataList.html', BASE)
      url.searchParams.set('func_widget_guid', guid)
      await run({
        label: '全校课表查询',
        url: url.toString(),
        values: { ...pickValues(pageForm.values, ['xnm', 'xqm', 'kkbm_id', 'kc', 'js', 'kclb', 'kcxz', 'kcgs']), ...queryModel(500) },
      })
    } else {
      const safeQuery = readOnlyExtraQuery(routeCode, pageForm)
      if (safeQuery && typeof this.client.form === 'function') {
        // The remaining allowlisted pages use the rendered page URL for their
        // jqGrid query. This branch is deliberately separate from the three
        // script-verified endpoints above and from mutation-looking pages.
        await run({
          label: `${JWGLXT_EXTRA_DOMAINS[domain]?.label || domain}查询`,
          url: new URL(route.path, BASE).toString(),
          values: safeQuery,
        })
      } else if (routeCode === 'N2154') {
        await run({
          label: '按周课表',
          url: new URL('kbcx/xskbcxZccx_cxXskbcxIndex.html', BASE).toString(),
          values: buildWeeklyScheduleQuery({ term, formValues: pageForm.values, studentId: homepage?.profile?.studentId }),
        })
      } else if (routeCode === 'N2155') {
        const selected = freeClassroomQuery && typeof freeClassroomQuery === 'object' ? freeClassroomQuery : {}
        const classroomFormValues = {
          ...pageForm.values,
          ...(selected.campus !== undefined ? { xqh_id: selected.campus } : {}),
          ...(selected.building !== undefined ? { lh: selected.building } : {}),
          ...(selected.classroomType !== undefined ? { cdlb_id: selected.classroomType } : {}),
          ...(selected.minSeats !== undefined ? { qszws: String(selected.minSeats) } : {}),
          ...(selected.maxSeats !== undefined ? { jszws: String(selected.maxSeats) } : {}),
        }
        await run({
          label: '空闲教室',
          url: new URL('cdjy/cdjy_cxKxcdlb.html?doType=query', BASE).toString(),
          // The portal's jqGrid defaults to ten rows when these paging
          // fields are omitted. Ask for the complete bounded result in one
          // read; the normalized snapshot still applies its safety ceiling.
          values: {
            ...buildFreeClassroomQuery({
              term,
              formValues: classroomFormValues,
              formOptions: pageForm.options,
              weeks: selected.weeks,
              weekdays: selected.weekdays,
              periods: selected.periods,
            }),
            ...queryModel(5000),
          },
        })
        // Expose the campus/building/classroom-type choices to the renderer so
        // the free-classroom UI can render selectors that submit real IDs
        // instead of typed display names.
        value = mergeExtraDomainValues(value, {
          options: normalizeFormOptions(pageForm.options),
          records: [],
          attachments: [],
          filters: [],
          messages: [],
        }, domain)
      } else if (routeCode === 'N358163' || routeCode === 'N358187') {
        const guid = routeCode === 'N358163'
          ? '58944B9C2CD784DBE053839D04CA5AD7'
          : '3B3215BB00F7AC6BE0630B1D470A5305'
        await run({
          label: routeCode === 'N358163' ? '考试时间查询' : '补考准考证',
          method: 'get',
          url: new URL('design/funcData_cxFuncDataList.html', BASE).toString(),
          values: { func_widget_guid: guid, ...termValues, _search: 'false', rows: '500', page: '1', sidx: '', sord: 'asc' },
        })
      } else if (routeCode === 'N532560') {
      const mainUrl = new URL('xsbysjgl/cjck_cxCjckIndex.html?doType=query', BASE).toString()
      const main = await run({
        label: '毕设成绩',
        url: mainUrl,
        values: { ...pickValues(pageForm.values, ['xnm', 'xqm']), ...termValues, ...queryModel(500) },
      })
      const allRows = main?.records || value.records || []
      const rows = allRows.slice(0, EXTRA_DETAIL_LIMIT)
      if (allRows.length > EXTRA_DETAIL_LIMIT) stats.capped = true
      const jobs = rows.map((row) => ({
        label: '毕设成绩详情',
        method: 'get',
        url: new URL('xsbysjgl/cjck_ckCjckView.html', BASE).toString(),
        values: {
          ...termValues,
          xs_xh: row.studentId || row.xh || row.studentInternalId || homepage?.profile?.studentId || '',
          cjhczt: row.processingStatus || row.cjhczt || '',
        },
        detail: true,
      }))
      if (jobs.length > EXTRA_DETAIL_LIMIT) stats.capped = true
      await mapWithConcurrency(jobs.slice(0, EXTRA_DETAIL_LIMIT), EXTRA_QUERY_CONCURRENCY, run)
    } else if (routeCode === 'N532540') {
      // The process-materials page exposes a read-only term grid. It is a
      // normal query endpoint even though the surrounding menu entry also
      // contains upload/submit controls; those controls are never invoked.
      await run({
        label: '毕设过程资料',
        url: new URL('xbysjgl/xsgczl_cxXsgczlIndex.html', BASE).toString(),
        values: { ...termValues, ...queryModel(500) },
      })
    } else if (routeCode === 'N305007') {
      const query = queryModel(5000)
      const mainUrl = new URL('cjcx/cjcx_cxXsKcList.html', BASE).toString()
      const gradeTerms = selectableGradeTerms(pageForm, terms, term)
      for (const selected of gradeTerms) {
        const main = await run({
          label: `成绩明细课程（${gradeTermLabel(selected)}）`,
          url: mainUrl,
          values: { ...selected, ...query },
          recordType: 'grade-course',
        })
        const allRows = main?.records || []
        const rows = allRows.slice(0, EXTRA_GRADE_DETAIL_LIMIT)
        if (allRows.length > EXTRA_GRADE_DETAIL_LIMIT) stats.capped = true
        // KccjGrid is the complete component-score table for one selected
        // year/semester. Query every actual student term, not the portal's
        // current default alone, so an empty future term cannot hide history.
        const aggregate = await run({
          label: `成绩明细总表（${gradeTermLabel(selected)}）`,
          url: new URL('cjcx/cjcx_cxXsKccjList.html', BASE).toString(),
          values: { ...selected, ...query },
          recordType: 'grade-component',
        })
        // Older deployments sometimes leave KccjGrid empty. Only then use the
        // row-scoped endpoint, which prevents duplicate requests in the common
        // case while preserving a complete fallback for a normal term.
        if (!aggregate?.records?.length && rows.length) {
          const jobs = []
          for (const row of rows) {
            const identifiers = {
              xnm: row.academicYear || selected.xnm,
              xqm: row.term || selected.xqm,
              jxb_id: row.classInternalId || '',
            }
            if (identifiers.jxb_id) {
              jobs.push({
                label: '成绩明细分项',
                url: new URL('cjcx/cjcx_cxXsXmcjList.html', BASE).toString(),
                values: identifiers,
                detail: true,
                recordType: 'grade-component-fallback',
              })
            }
          }
          const allowedJobs = jobs.slice(0, Math.min(EXTRA_QUERY_LIMIT, EXTRA_GRADE_DETAIL_LIMIT))
          if (jobs.length > allowedJobs.length) stats.capped = true
          await mapWithConcurrency(allowedJobs, EXTRA_QUERY_CONCURRENCY, run)
        }
      }
      value = normalizeJwglxtExtraDomain({
        ...value,
        messages: [...(value.messages || []), `已按学年学期查询：${gradeTerms.map(gradeTermLabel).join('；')}`],
      }, domain)
    } else if (routeCode === 'N153540') {
      const mainUrl = new URL('jxzxjhgl/jxzxjhck_cxJxzxjhckIndex.html?doType=query', BASE).toString()
      const main = await run({
        label: '教学执行计划',
        url: mainUrl,
        values: {
          ...pickValues(pageForm.values, ['jg_id', 'njdm_id', 'dlbs', 'zyh_id', 'currentPage_cx']),
          njdm_id: pageForm.values.njdm_id || pageForm.values.nj_cx || '',
          dlbs: pageForm.values.dlbs || pageForm.values.dl || '',
          zyh_id: pageForm.values.zyh_id || pageForm.values.zyh_id_cx || '',
          ...queryModel(5000),
        },
        recordType: 'plan-summary',
        includeCandidateRecords: true,
      })
      const allRows = main?.candidateRecords || []
      const filters = selectedPlanFilters(pageForm, homepage?.profile)
      const hasMajorIdentity = Boolean(filters.majorId || filters.majorName)
      const filteredRows = hasMajorIdentity ? filterPlanRows(allRows, filters) : []
      const filterMessage = Object.values(filters).some(Boolean)
        ? `已按页面筛选计划：${[
          filters.grade && `年级 ${filters.grade}`,
          filters.department && `学院 ${filters.department}`,
          filters.majorId && `专业 ${filters.majorId}`,
          filters.majorName && `专业 ${filters.majorName}`,
        ].filter(Boolean).join('、')}`
        : '页面未提供当前专业标识，未保存任何培养计划 PDF'
      value = normalizeJwglxtExtraDomain({
        ...value,
        messages: [...(value.messages || []), filterMessage],
      }, domain)
      const allPlanIds = [...new Set(filteredRows.map((row) => row.planId || row.jxzxjhxxId).filter(Boolean))]
        .sort((left, right) => String(left).localeCompare(String(right), 'zh-CN'))
      // We only persist the verified current-major plan. Ambiguous or missing
      // identity is deliberately a partial result, never a guessed PDF.
      const planIds = hasMajorIdentity ? allPlanIds.slice(0, 1) : []
      if (allPlanIds.length > planIds.length) {
        value = normalizeJwglxtExtraDomain({
          ...value,
          messages: [...(value.messages || []), '当前专业匹配到多个培养计划，仅缓存一个稳定候选 PDF'],
        }, domain)
      }
      // The official preview is the authoritative, stable cultivation-plan
      // artifact. Do not fan out into course/requirement/class/track pages:
      // those fragments are slow, deployment-specific, and are not needed to
      // show the PDF the student actually asked for.
      const previewJobs = planIds.map((id) => ({
        label: '教学执行计划 PDF',
        method: 'get',
        url: new URL(`jxzxjhgl/jxzxjhxxwh_cxDyJxzxjhxx.html?jxzxjhxx_id=${encodeURIComponent(id)}&gnmkdm=N153540`, BASE).toString(),
        values: {},
        detail: true,
        recordType: 'plan-preview',
      }))
      const jobs = previewJobs.slice(0, EXTRA_DETAIL_LIMIT)
      if (previewJobs.length > jobs.length) stats.capped = true
      await mapWithConcurrency(jobs, Math.min(EXTRA_QUERY_CONCURRENCY, 2), run)
    }
    }

    value = normalizeJwglxtExtraDomain({
      ...value,
      label: JWGLXT_EXTRA_DOMAINS[domain]?.label || value.label,
      completeness: errors.length || stats.failed || stats.capped
        || (domain === 'academic-plan' && !value.attachments?.some((attachment) => attachment?.type === 'pdf'))
        ? 'partial'
        : value.completeness,
      queryStats: stats,
    }, domain)
    return { value, errors, stats }
  }

  async sync(options = {}) {
    const requested = selectedDomains(options)
    const wants = (domain) => requested === null || requested.has(domain)
    const wantsCourses = wants('courses')
    const needsSchedule = wants('schedule') || wantsCourses
    const needsExams = wants('exams') || wantsCourses
    const needsGrades = wants('grades') || wantsCourses
    const needsSelectedCourses = wants('selected-courses') || wantsCourses
    const needsAcademicProgress = wants('academic-progress')
    const needsNotices = wants('notices')
    // Extra menu pages are intentionally opt-in. They are read-only and
    // cached, but fetching ten HTML pages on every foreground sync makes the
    // fast path feel slow. A caller can request one domain or set the explicit
    // includeAcademicExtras flag for a full refresh.
    const extraDomains = options.includeAcademicExtras === true
      ? [...JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES]
      : requested === null ? [] : [...requested].filter((domain) => JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES.includes(domain))
    const needsExtras = extraDomains.length > 0
    const needsPlanIdentity = needsExtras && extraDomains.includes('academic-plan') && !needsSchedule
    const needsTermContext = wants('terms') || needsSchedule || needsExams || needsSelectedCourses || needsPlanIdentity
    const capturedAt = new Date().toISOString()
    const errors = []
    let scheduleIdentity = null
    let scheduleIdentityResolved = false
    let resolveScheduleIdentity
    const scheduleIdentityReady = new Promise((resolve) => { resolveScheduleIdentity = resolve })
    const publishScheduleIdentity = (identity) => {
      if (!identity || scheduleIdentity) return
      scheduleIdentity = identity
      if (!scheduleIdentityResolved) {
        scheduleIdentityResolved = true
        resolveScheduleIdentity(identity)
      }
    }
    const finishScheduleIdentity = () => {
      if (scheduleIdentityResolved) return
      scheduleIdentityResolved = true
      resolveScheduleIdentity(scheduleIdentity)
    }
    this.onProgress?.({ stage: 'jwglxt', status: 'syncing', label: '正在读取教务首页…' })

    // ── 首页（登录检测 + 当前学期 + 通知）────────────────────────────
    const homepageResult = await this.client.page(HOME, { source: 'Academic system' })
    const homepage = parseJwHomepage(homepageResult.text, homepageResult.url)
    if (!homepage.loggedIn) throw new AuthRequiredError('Academic system', homepageResult.url)

    // ── 课表索引（获取学期列表 + 表单隐藏字段）───────────────────────
    const scheduleIndexUrl = new URL('kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default', BASE).toString()
    let scheduleIndex = null
    if (needsTermContext) {
      try {
        scheduleIndex = await this.client.page(scheduleIndexUrl, { source: 'Schedule index' })
      } catch (error) {
        errors.push(compactError(error))
      }
    }
    const scheduleForm = scheduleIndex ? parseJwQueryForm(scheduleIndex.text, scheduleIndex.url, '#ajaxForm') : null
    const scheduleMeta = scheduleIndex ? parseJwHomepage(scheduleIndex.text, scheduleIndex.url) : null
    // The schedule page owns the active selection. The home page can still show
    // the previous teaching term while the schedule portal has already switched
    // to the next term, so prefer the schedule form here.
    const discoveredTerm = scheduleForm?.term || scheduleMeta?.term || homepage.term || null
    const requestedFreeClassroomTerm = options.freeClassroom?.term
    const term = requestedFreeClassroomTerm && typeof requestedFreeClassroomTerm === 'object'
      ? requestedFreeClassroomTerm
      : discoveredTerm || fallbackTerm()

    // 合并所有学期（主页 + 课表页，去重）
    const allTerms = uniqueTerms(term, homepage.terms || [], scheduleMeta?.terms || [])

    // Only query terms that the portal actually exposes and keep the active
    // term first. The Zhengfang selectors contain placeholder/future years;
    // sorting the raw list alone can push the real current term out of the cap.
    const relevantTerms = scheduleTerms(term, allTerms, homepage.profile)

    const scheduleTask = needsSchedule ? (async () => {
      const allSchedule = []
      const fetchLog = []
      const taskErrors = []
      for (const [index, t] of relevantTerms.entries()) {
        this.onProgress?.({ stage: 'schedule', status: 'syncing', label: `抓取课表 ${t.label}（${index + 1}/${relevantTerms.length}）…` })
        let parsed = null
        let positioned = []
        let unpositioned = null
        let lastError = null
        let endpointIndex = 0
        for (const endpoint of this.scheduleEndpoints) {
          endpointIndex += 1
          try {
            const url = new URL(endpoint, BASE).toString()
            const body = await this.client.form(url, scheduleRequestValues(endpoint, t, scheduleForm), {
              source: `Schedule ${t.label}`,
              referer: scheduleIndex?.url || scheduleIndexUrl,
            })
            assertValidQueryPayload(body, 'schedule')
            publishScheduleIdentity(parseJwStudentIdentity(body))
            const candidate = parseJwSchedule(body, { term: t, sourceUrl: url, capturedAt })
            const candidatePositioned = candidate.filter(isRenderableScheduleItem)
            if (candidate.length && !candidatePositioned.length) {
              unpositioned ||= candidate
              this.client.diagnostic?.('schedule.payload_unpositioned_shape', {
                termId: t.id,
                endpoint: endpointIndex,
                payload: describeJwSchedulePayload(body),
              })
              continue
            }
            // A second endpoint must not turn a non-empty, unpositioned
            // response into an authoritative empty timetable. That would erase
            // previously saved lessons even though neither response is safe.
            if (!candidate.length && unpositioned) continue
            parsed = candidate
            positioned = candidatePositioned
            // An empty timetable is a confirmed result. The alternate endpoint
            // is only needed when this one returned course rows without layout.
            if (!candidate.length || candidatePositioned.length) break
          } catch (error) {
            lastError = error
          }
        }
        if (!parsed && unpositioned) parsed = unpositioned
        if (parsed && (!parsed.length || positioned.length)) {
          fetchLog.push({ termId: t.id, count: parsed.length, endpoint: endpointIndex })
          allSchedule.push(...parsed)
          this.onProgress?.({ stage: 'schedule', status: 'term-done', label: `课表 ${t.label} 已读取 ${parsed.length} 条（${index + 1}/${relevantTerms.length}）` })
          continue
        }
        if (parsed?.length) {
          fetchLog.push({
            termId: t.id,
            count: 0,
            returnedCount: parsed.length,
            unpositioned: true,
            warning: 'schedule_payload_unpositioned',
            endpoint: endpointIndex,
            payload: describeJwSchedulePayload(unpositioned),
          })
          this.onProgress?.({
            stage: 'schedule',
            status: 'term-skipped',
            label: `课表 ${t.label} 未返回时间地点，已保留本地课表（${index + 1}/${relevantTerms.length}）`,
          })
          continue
        }
        const error = lastError || new Error('schedule_empty_response')
        fetchLog.push({ termId: t.id, count: 0, error: compactError(error), endpoint: endpointIndex })
        taskErrors.push(compactError(error))
        this.onProgress?.({ stage: 'schedule', status: 'term-error', label: `课表 ${t.label} 获取失败（${index + 1}/${relevantTerms.length}）` , error: compactError(error) })
      }
      this.onProgress?.({ stage: 'schedule', status: 'done', label: `课表读取完成，共 ${allSchedule.length} 条` })
      finishScheduleIdentity()
      return {
        value: fetchLog.some((item) => !item.error && !item.unpositioned) ? allSchedule : undefined,
        fetchLog,
        errors: taskErrors,
      }
    })() : Promise.resolve({ value: undefined, fetchLog: [], errors: [] })

    const studentIdentityTask = needsPlanIdentity ? (async () => {
      try {
        const url = new URL(BROWSER_SCHEDULE_ENDPOINT, BASE).toString()
        const body = await this.client.form(url, scheduleRequestValues(url, term, scheduleForm), {
          source: 'Current student identity',
          referer: scheduleIndex?.url || scheduleIndexUrl,
        })
        assertValidQueryPayload(body, 'schedule')
        publishScheduleIdentity(parseJwStudentIdentity(body))
      } catch (error) {
        this.onDiagnostic?.('jwglxt.student_identity_failed', { error: compactError(error) })
      } finally {
        finishScheduleIdentity()
      }
    })() : null
    if (!needsSchedule && !needsPlanIdentity) finishScheduleIdentity()

    const examsTask = needsExams ? (async () => {
      const examsIndexUrl = new URL('kwgl/kscx_cxXsksxxIndex.html?gnmkdm=N358105&layout=default', BASE).toString()
      const allExams = []
      const fetchLog = []
      const taskErrors = []
      this.onProgress?.({ stage: 'exams', status: 'syncing', label: `正在读取考试安排（${relevantTerms.length} 个学期）…` })
      try {
        const examsIndex = await this.client.page(examsIndexUrl, { source: 'Exams' })
        const examsForm = parseJwQueryForm(examsIndex.text, examsIndex.url, '#searchForm')
        const queryUrl = new URL('kwgl/kscx_cxXsksxxIndex.html?doType=query', BASE).toString()
        for (const t of relevantTerms) {
          try {
            const body = await this.client.form(queryUrl, {
              ...examsForm.values,
              xnm: String(t.year),
              xqm: t.term,
              ksmcdmb_id: examsForm.values.cx_ksmcdmb_id || '',
              kch: examsForm.values.cx_kch || '',
              kc: examsForm.values.kc_cx || '',
              ksrq: examsForm.values.cx_ksrq || '',
              ...queryModel(),
            }, { source: `Exams ${t.label}`, referer: examsIndex.url })
            assertValidQueryPayload(body, 'exams')
            const parsed = parseJwExams(body, { term: t, sourceUrl: examsIndex.url, capturedAt })
            fetchLog.push({ termId: t.id, count: parsed.length })
            allExams.push(...parsed)
          } catch (error) {
            fetchLog.push({ termId: t.id, count: 0, error: compactError(error) })
            taskErrors.push(compactError(error))
          }
        }
      } catch (error) {
        taskErrors.push(compactError(error))
      }
      return { value: fetchLog.some((item) => !item.error) ? allExams : undefined, fetchLog, errors: taskErrors }
    })() : Promise.resolve({ value: undefined, fetchLog: [], errors: [] })

    const gradesTask = needsGrades ? (async () => {
      let value
      const taskErrors = []
      const fetchLog = []
      this.onProgress?.({ stage: 'grades', status: 'syncing', label: '正在读取全部学期成绩…' })
      const gradesIndexUrl = new URL('cjcx/cjcx_cxDgXscj.html?gnmkdm=N305005&layout=default', BASE).toString()
      let gradesIndex = null
      let gradesForm = null
      let queryUrl = null
      const alternateQueryUrl = new URL('cjcx/cjcx_cxDgXscj.html?doType=query&gnmkdm=N305005', BASE).toString()
      let gradePageTerms = []
      try {
        gradesIndex = await this.client.page(gradesIndexUrl, { source: 'Grades' })
        gradesForm = parseJwQueryForm(gradesIndex.text, gradesIndex.url, '#searchForm')
        gradePageTerms = parseJwHomepage(gradesIndex.text, gradesIndex.url).terms || []
        queryUrl = new URL('cjcx/cjcx_cxXsgrcj.html?doType=query&gnmkdm=N305005', BASE).toString()
        const body = await this.client.form(queryUrl, {
          ...gradesForm.values,
          xnm: '',
          xqm: '',
          xxdm: gradesForm.values.sxxdm || '',
          kcbj: gradesForm.values.kcbjdm || '',
          sfzgcj: '',
           ...queryModel(100),
        }, { source: 'Grades all terms', referer: gradesIndex.url })
        assertValidQueryPayload(body, 'grades')
        value = parseJwGrades(body, { term, sourceUrl: gradesIndex.url, capturedAt })
        fetchLog.push({ termId: 'all', count: value.length })
      } catch (error) {
        // A subset of deployments rejects blank xnm/xqm for direct API
        // clients even though the browser form advertises “all terms”. Retry
        // concrete terms discovered from the authenticated schedule index.
        // Authentication failures must go through the source-level recovery
        // path; do not multiply six doomed requests against an expired jar.
        if (error instanceof AuthRequiredError || Number(error?.code) === 1006) {
          taskErrors.push(compactError(error))
          return { value, fetchLog, errors: taskErrors }
        }
        // Some deployments expose the personal grade grid only through the
        // DgXscj endpoint (the same endpoint used by zfn_api). Try its
        // all-term form before falling back to one request per term.
        if (gradesForm && alternateQueryUrl) {
          try {
            const body = await this.client.form(alternateQueryUrl, {
              ...gradesForm.values,
              xnm: '',
              xqm: '',
              xxdm: gradesForm.values.sxxdm || '',
              kcbj: gradesForm.values.kcbjdm || '',
              sfzgcj: '',
              ...queryModel(100),
            }, { source: 'Grades all terms (alternate)', referer: gradesIndex.url })
            assertValidQueryPayload(body, 'grades')
            value = parseJwGrades(body, { term, sourceUrl: gradesIndex.url, capturedAt })
            fetchLog.push({ termId: 'all', count: value.length })
            return { value, fetchLog, errors: taskErrors }
          } catch {
            // Concrete-term recovery below records the final actionable error.
          }
        }
        if (!gradesForm || !queryUrl) {
          taskErrors.push(compactError(error))
          return { value, fetchLog, errors: taskErrors }
        }
        const recovered = []
        const fallbackErrors = []
        const fallbackTerms = gradePageTerms.length
          ? uniqueTerms(term, gradePageTerms, homepage.terms || [])
          : uniqueTerms(term, relevantTerms, homepage.terms || [])
        for (const t of fallbackTerms) {
          let termError = null
          for (const candidateUrl of [queryUrl, alternateQueryUrl].filter(Boolean)) {
            try {
              const body = await this.client.form(candidateUrl, {
                ...gradesForm.values,
                xnm: String(t.year),
                xqm: t.term,
                xxdm: gradesForm.values.sxxdm || '',
                kcbj: gradesForm.values.kcbjdm || '',
                sfzgcj: '',
                ...queryModel(100),
              }, { source: `Grades ${t.label}`, referer: gradesIndex.url })
              assertValidQueryPayload(body, 'grades')
              const parsed = parseJwGrades(body, { term: t, sourceUrl: gradesIndex.url, capturedAt })
              fetchLog.push({ termId: t.id, count: parsed.length })
              recovered.push(...parsed)
              termError = null
              break
            } catch (errorForUrl) {
              termError = errorForUrl
            }
          }
          if (termError) {
            fetchLog.push({ termId: t.id, count: 0, error: compactError(termError) })
            fallbackErrors.push(termError)
          }
        }
        if (recovered.length || !fallbackErrors.length) value = recovered
        else taskErrors.push(compactError(error), compactError(fallbackErrors[0]))
      }
      return { value, fetchLog, errors: taskErrors }
    })() : Promise.resolve({ value: undefined, fetchLog: [], errors: [] })

    const academicProgressTask = needsAcademicProgress ? (async () => {
      let value = null
      const taskErrors = []
      this.onProgress?.({ stage: 'academic-progress', status: 'syncing', label: '正在读取 GPA 与学业进度…' })
      try {
        value = await this.fetchAcademicProgress({ capturedAt })
      } catch (error) {
        taskErrors.push(compactError(error))
      }
      return { value, errors: taskErrors }
    })() : Promise.resolve({ value: undefined, errors: [] })

    const academicExtrasTask = needsExtras ? (async () => {
      const values = {}
      const taskErrors = []
      const outcomes = {}
      const routeJobs = []
      for (const domain of extraDomains) {
        const descriptor = JWGLXT_EXTRA_DOMAINS[domain]
        for (const route of descriptor?.routes || []) {
          routeJobs.push({ domain, route, descriptor })
        }
      }
      // Keep the fast path responsive while still overlapping independent
      // pages. Results are written in input order after the bounded workers
      // finish, so IDs and multi-route provenance remain deterministic.
      const routeResults = await mapWithConcurrency(routeJobs, EXTRA_QUERY_CONCURRENCY, async ({ domain, route, descriptor }) => {
        const url = new URL(route.path, BASE).toString()
        try {
          this.onProgress?.({ stage: domain, status: 'syncing', label: `正在读取${descriptor.label}…` })
          const page = await this.client.page(url, { source: `JWGLXT ${descriptor.label}` })
          const planIdentity = domain === 'academic-plan' ? await scheduleIdentityReady : null
          const planHomepage = planIdentity
            ? { ...homepage, profile: { ...(homepage.profile || {}), ...planIdentity } }
            : homepage
          const fetched = await this.fetchExtraRoute({ domain, route, page, term, terms: relevantTerms, homepage: planHomepage, capturedAt, freeClassroomQuery: domain === 'free-classroom' ? options.freeClassroom : null })
          return { domain, route, ...fetched }
        } catch (error) {
          return { domain, route, error: compactError(error) }
        }
      })
      const failuresByDomain = new Map()
      const partialByDomain = new Map()
      for (const result of routeResults) {
        if (result.error) {
          taskErrors.push(result.error)
          failuresByDomain.set(result.domain, (failuresByDomain.get(result.domain) || 0) + 1)
          continue
        }
        const domain = result.domain
        values[domain] = mergeExtraDomainValues(values[domain], result.value, domain)
        if (result.errors?.length || result.stats?.failed || result.stats?.capped) {
          partialByDomain.set(domain, (partialByDomain.get(domain) || 0) + 1)
          taskErrors.push(...result.errors)
        }
      }
      for (const domain of extraDomains) {
        const value = values[domain]
        const failures = failuresByDomain.get(domain) || 0
        const partial = partialByDomain.get(domain) || 0
        if (value) {
          const incomplete = failures > 0 || partial > 0
          outcomes[domain] = successfulDomain(value, domain, capturedAt, {
            completeness: incomplete ? 'partial' : value.completeness,
            errorCode: failures ? 'partial_extra_domain_read' : partial ? 'partial_extra_query' : null,
          })
        } else {
          outcomes[domain] = failedDomain('extra_domain_read_failed')
        }
      }
      return { value: Object.keys(values).length ? { schema: 'theia-jwglxt-extras/v1', capturedAt, parserVersion: JWGLXT_EXTRA_PARSER_VERSION, domains: values } : undefined, outcomes, errors: [...new Set(taskErrors)] }
    })() : Promise.resolve({ value: undefined, outcomes: {}, errors: [] })

    const [scheduleResult, examsResult, gradesResult, academicProgressResult, academicExtrasResult] = await Promise.all([
      scheduleTask,
      examsTask,
      gradesTask,
      academicProgressTask,
      academicExtrasTask,
      studentIdentityTask,
    ])
    const schedule = scheduleResult.value
    const scheduleFetchLog = scheduleResult.fetchLog
    const exams = examsResult.value
    const examsFetchLog = examsResult.fetchLog
    const grades = gradesResult.value
    const gradesFetchLog = gradesResult.fetchLog || []
    const academicProgress = academicProgressResult.value
    const academicExtras = academicExtrasResult.value
    errors.push(...scheduleResult.errors, ...examsResult.errors, ...gradesResult.errors, ...academicProgressResult.errors, ...academicExtrasResult.errors)

    const selectedCoursesTask = needsSelectedCourses ? (async () => {
      const selectedCoursesUrl = new URL('xsxxxggl/xsxxwh_cxXsxkxx.html?gnmkdm=N100801', BASE).toString()
      const allSelectedCourses = []
      const fetchLog = []
      const taskErrors = []
      this.onProgress?.({ stage: 'selected-courses', status: 'syncing', label: `正在读取已选课程（${relevantTerms.length} 个学期）…` })
      for (const t of relevantTerms) {
        try {
          const body = await this.client.form(selectedCoursesUrl, {
            xnm: String(t.year),
            xqm: selectedCourseTerm(t),
            ...queryModel(5000),
            time: '1',
          }, { source: `Selected courses ${t.label}`, referer: selectedCoursesUrl })
          assertValidQueryPayload(body, 'selected_courses')
          const parsed = parseJwSelectedCourses(body, { term: t, sourceUrl: selectedCoursesUrl, capturedAt })
          fetchLog.push({ termId: t.id, count: parsed.length })
          allSelectedCourses.push(...parsed)
        } catch (error) {
          fetchLog.push({ termId: t.id, count: 0, error: compactError(error) })
          taskErrors.push(compactError(error))
        }
      }
      return { value: fetchLog.some((item) => !item.error) ? allSelectedCourses : undefined, fetchLog, errors: taskErrors }
    })() : Promise.resolve({ value: undefined, fetchLog: [], errors: [] })

    const noticesTask = needsNotices ? (async () => {
      let value
      const taskErrors = []
      this.onProgress?.({ stage: 'notices', status: 'syncing', label: '正在读取教务通知…' })
      const noticesUrl = new URL('xtgl/index_cxDbsy.html?doType=query', BASE).toString()
      try {
        const body = await this.client.form(noticesUrl, {
          sfyy: '0',
          flag: '1',
          ...queryModel(500),
          'queryModel.sortName': 'cjsj',
          'queryModel.sortOrder': 'desc',
        }, { source: 'Academic notices', referer: HOME })
        value = parseJwNotices(body, { sourceUrl: noticesUrl, capturedAt })
      } catch (error) {
        taskErrors.push(compactError(error))
      }
      return { value, errors: taskErrors }
    })() : Promise.resolve({ value: undefined, errors: [] })

    const [selectedCoursesResult, noticesResult] = await Promise.all([selectedCoursesTask, noticesTask])
    const selectedCourses = selectedCoursesResult.value
    const selectedCoursesFetchLog = selectedCoursesResult.fetchLog
    const notices = noticesResult.value
    errors.push(...selectedCoursesResult.errors, ...noticesResult.errors)

    // ── 课程列表（从各数据源归并）────────────────────────────────────
    // Deduplicate by the official course code. Internal Zhengfang IDs are
    // deliberately excluded, even when no matching standard-code record exists.
    const courseCandidates = [...(schedule || []), ...(grades || []), ...(exams || []), ...(selectedCourses || [])]
    const coursesByCode = new Map()
    for (const item of courseCandidates) {
      const code = String(item.courseCode || item.courseId || '').trim().toUpperCase()
      if (!isStandardCourseCode(code)) continue
      const existing = coursesByCode.get(code)
      const candidate = {
        id: code,
        code,
        termId: item.termId || null,
        termIds: item.termId ? [item.termId] : [],
        title: item.courseName || item.title,
        teacher: item.teacher || null,
        credits: item.credits ?? null,
        // Grade records carry the full requirement label (for example,
        // "公共基础必修"). The selected-course page often only says "专业".
        category: categoryLabelOf(item),
        location: item.location || item.room || null,
        classId: item.classId || null,
        source: 'jwglxt',
        sourceUrl: item.sourceUrl,
        capturedAt,
      }
      const termIds = newestFirstTermIds(existing?.termIds || [], existing?.termId, candidate.termIds)
      coursesByCode.set(code, existing ? {
        ...existing,
        ...Object.fromEntries(Object.entries(candidate)
          .filter(([key, value]) => key !== 'termId' && key !== 'termIds' && key !== 'category' && value !== null && value !== undefined && value !== '')),
        category: preferredCourseCategory(existing.category, candidate.category),
        termIds,
        termId: termIds[0] || existing.termId || candidate.termId || null,
      } : { ...candidate, termIds, termId: termIds[0] || candidate.termId })
    }
    const courses = [...coursesByCode.values()].filter((item) => item.title)

    const finalProfile = academicProgress?.gpa !== null && academicProgress?.gpa !== undefined
        ? { ...(homepage.profile || {}), gpa: academicProgress.gpa }
        : homepage.profile
    const finalNotices = notices === undefined ? (homepage.notices || []) : notices

    const domainOutcomes = {}
    if (wants('profile')) domainOutcomes.profile = successfulDomain(finalProfile, 'profile', capturedAt, {
      completeness: homepage.profile ? 'complete' : finalProfile ? 'partial' : 'complete',
      errorCode: !homepage.profile && finalProfile ? 'profile_identity_missing' : null,
    })
    if (wants('terms')) domainOutcomes.terms = successfulDomain(relevantTerms, 'terms', capturedAt, {
      completeness: discoveredTerm ? 'complete' : 'partial',
      errorCode: discoveredTerm ? null : 'term_inferred_locally',
    })
    if (wants('courses')) domainOutcomes.courses = successfulDomain(courses, 'courses', capturedAt, { completeness: errors.length ? 'partial' : 'complete' })
    if (wants('schedule')) domainOutcomes.schedule = schedule === undefined
      ? failedDomain('schedule_read_failed', fetchCoverage(scheduleFetchLog))
      : successfulDomain(schedule, 'schedule', capturedAt, {
          completeness: scheduleFetchLog.some((item) => item.error || item.unpositioned) ? 'partial' : 'complete',
          errorCode: scheduleFetchLog.some((item) => item.error || item.unpositioned) ? 'partial_schedule_read' : null,
          ...fetchCoverage(scheduleFetchLog),
        })
    if (wants('grades')) domainOutcomes.grades = grades === undefined
      ? failedDomain('grades_read_failed', fetchCoverage(gradesFetchLog))
      : successfulDomain(grades, 'grades', capturedAt, {
          completeness: gradesFetchLog.some((item) => item.error) ? 'partial' : 'complete',
          errorCode: gradesFetchLog.some((item) => item.error) ? 'partial_grades_read' : null,
          ...fetchCoverage(gradesFetchLog),
        })
    if (wants('exams')) domainOutcomes.exams = exams === undefined
      ? failedDomain('exams_read_failed', fetchCoverage(examsFetchLog))
      : successfulDomain(exams, 'exams', capturedAt, {
          completeness: examsFetchLog.some((item) => item.error) ? 'partial' : 'complete',
          errorCode: examsFetchLog.some((item) => item.error) ? 'partial_exams_read' : null,
          ...fetchCoverage(examsFetchLog),
        })
    if (wants('selected-courses')) domainOutcomes['selected-courses'] = selectedCourses === undefined
      ? failedDomain('selected_courses_read_failed', fetchCoverage(selectedCoursesFetchLog))
      : successfulDomain(selectedCourses, 'selected-courses', capturedAt, {
          completeness: selectedCoursesFetchLog.some((item) => item.error) ? 'partial' : 'complete',
          errorCode: selectedCoursesFetchLog.some((item) => item.error) ? 'partial_selected_courses_read' : null,
          ...fetchCoverage(selectedCoursesFetchLog),
        })
    if (wants('academic-progress')) domainOutcomes['academic-progress'] = academicProgress === null || academicProgress === undefined
      ? failedDomain('academic_progress_read_failed')
      : successfulDomain(academicProgress, 'academic-progress', capturedAt, {
          completeness: Array.isArray(academicProgress.roots) && academicProgress.roots.length
            && !String(academicProgress.requirementSource || '').endsWith('inferred-tree')
            && !(this.academicProgressDiagnostics?.detailErrors > 0) ? 'complete' : 'partial',
          errorCode: !Array.isArray(academicProgress.roots) || !academicProgress.roots.length
            ? 'requirement_tree_missing'
            : String(academicProgress.requirementSource || '').endsWith('inferred-tree')
              ? 'requirement_tree_inferred'
              : this.academicProgressDiagnostics?.detailErrors > 0
                ? 'partial_requirement_details'
              : null,
        })
    if (wants('notices')) domainOutcomes.notices = successfulDomain(finalNotices, 'notices', capturedAt, {
      completeness: notices === undefined ? 'partial' : 'complete',
      errorCode: notices === undefined ? 'notices_query_failed_homepage_fallback' : null,
    })
    if (needsExtras) {
      for (const domain of extraDomains) {
        domainOutcomes[domain] = academicExtrasResult.outcomes[domain] || failedDomain('extra_domain_read_failed')
      }
    }

    return {
      ...(wants('profile') ? { profile: finalProfile } : {}),
      ...(wants('terms') ? { terms: relevantTerms } : {}),
      ...(wants('courses') ? { courses } : {}),
      ...(wants('schedule') ? { schedule } : {}),
      ...(wants('grades') ? { grades } : {}),
      ...(wants('exams') ? { exams } : {}),
      ...(wants('selected-courses') ? { selectedCourses } : {}),
      ...(wants('academic-progress') ? { academicProgress } : {}),
      ...(wants('notices') ? { notices: finalNotices } : {}),
      ...(academicExtras ? { academicExtras } : {}),
      capturedAt,
      parserVersion: PARSER_VERSION,
      domainOutcomes,
      errors,
      source: {
        connected: true,
        checkedAt: capturedAt,
        url: homepageResult.url,
        errors,
        diagnostics: {
          scheduleFetch: scheduleFetchLog,
          academicProgress: this.academicProgressDiagnostics,
          academicExtras: needsExtras ? Object.fromEntries(extraDomains.map((domain) => [domain, {
            records: academicExtras?.domains?.[domain]?.records?.length || 0,
            routes: academicExtras?.domains?.[domain]?.routeCodes || [],
          }])) : null,
        },
      },
    }
  }
}

export const JWGLXT_URLS = {
  base: BASE,
  home: HOME,
  login: unifiedLoginUrl(),
  schedule: new URL('kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default', BASE).toString(),
  academicStatus: ACADEMIC_PROGRESS,
  selectedCourses: new URL('xsxxxggl/xsxxwh_cxXsxkxx.html?gnmkdm=N100801', BASE).toString(),
  notices: new URL('xtgl/index_cxDbsy.html?doType=query', BASE).toString(),
  grades: new URL('cjcx/cjcx_cxDgXscj.html?gnmkdm=N305005&layout=default', BASE).toString(),
  exams: new URL('kwgl/kscx_cxXsksxxIndex.html?gnmkdm=N358105&layout=default', BASE).toString(),
}
