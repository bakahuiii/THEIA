import { academicTermCandidate, compactError, parseAcademicTerm } from '../util.mjs'
import { AuthRequiredError } from '../source-client.mjs'
import { categoryLabelOf, preferredCourseCategory } from '../course-category.mjs'
import { isStandardCourseCode, parseJwAcademicProgress, parseJwExams, parseJwGrades, parseJwHomepage, parseJwNotices, parseJwQueryForm, parseJwSchedule, parseJwSelectedCourses } from '../parsers/jwglxt.mjs'
import { domainHasData, sourceDomainOutcome } from '../domain-provenance.mjs'
import { academicPlanNodes, readAcademicProgressDetails } from '../academic-api-client.mjs'
import { degreePlanDetailsToProgress, mergeAcademicProgressDetails } from '../academic-progress.mjs'

const BASE = 'https://jwglxt.buct.edu.cn/jwglxt/'
const HOME = new URL('xtgl/index_initMenu.html', BASE).toString()
const ACADEMIC_PROGRESS = new URL('xsxy/xsxyqk_cxXsxyqkIndex.html?gnmkdm=N105515&layout=default', BASE).toString()
const PARSER_VERSION = 'jwglxt-adapter/1'
const SYNC_DOMAINS = new Set(['profile', 'terms', 'courses', 'schedule', 'grades', 'exams', 'selected-courses', 'academic-progress', 'notices'])

function selectedDomains(options = {}) {
  if (options.domains === undefined) return null
  if (!Array.isArray(options.domains) || !options.domains.length) throw new TypeError('JWGLXT sync domains must be a non-empty array')
  const domains = new Set(options.domains)
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
  const state = domain === 'selected-courses' ? { selectedCourses: value }
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
    successfulTermIds: fetchLog.filter((item) => !item.error).map((item) => item.termId),
    failedTermIds: fetchLog.filter((item) => item.error).map((item) => item.termId),
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

function findRecordArray(value, depth = 0, seen = new Set()) {
  if (Array.isArray(value)) return { found: true, value }
  if (!value || typeof value !== 'object' || depth > 5 || seen.has(value)) return { found: false, value: [] }
  seen.add(value)
  for (const [key, nestedValue] of Object.entries(value)) {
    if (!PAYLOAD_ARRAY_KEYS.has(String(key).toLowerCase())) continue
    if (Array.isArray(nestedValue)) return { found: true, value: nestedValue }
    const nested = findRecordArray(nestedValue, depth + 1, seen)
    if (nested.found) return nested
  }
  return { found: false, value: [] }
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
  constructor(client, { onProgress, academicProgressSource = 'browser' } = {}) {
    this.client = client
    this.onProgress = onProgress || null
    this.academicProgressSource = academicProgressSource === 'api' ? 'api' : 'browser'
    this.academicProgressDiagnostics = null
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
    const needsTermContext = wants('terms') || needsSchedule || needsExams || needsSelectedCourses
    const capturedAt = new Date().toISOString()
    const errors = []
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
    const term = discoveredTerm || fallbackTerm()

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
        try {
          const url = new URL('kbcx/xskbcx_cxXsgrkb.html', BASE).toString()
          const body = await this.client.form(url, {
            ...(scheduleForm?.values || {}),
            xnm: String(t.year),
            xqm: t.term,
            kzlx: 'ck',
          }, { source: `Schedule ${t.label}`, referer: scheduleIndex?.url || scheduleIndexUrl })
          assertValidQueryPayload(body, 'schedule')
          const parsed = parseJwSchedule(body, { term: t, sourceUrl: scheduleIndex?.url || scheduleIndexUrl, capturedAt })
          fetchLog.push({ termId: t.id, count: parsed.length })
          allSchedule.push(...parsed)
          this.onProgress?.({ stage: 'schedule', status: 'term-done', label: `课表 ${t.label} 已读取 ${parsed.length} 条（${index + 1}/${relevantTerms.length}）` })
        } catch (error) {
          fetchLog.push({ termId: t.id, count: 0, error: compactError(error) })
          taskErrors.push(compactError(error))
          this.onProgress?.({ stage: 'schedule', status: 'term-error', label: `课表 ${t.label} 获取失败（${index + 1}/${relevantTerms.length}）` , error: compactError(error) })
        }
      }
      this.onProgress?.({ stage: 'schedule', status: 'done', label: `课表读取完成，共 ${allSchedule.length} 条` })
      return { value: fetchLog.some((item) => !item.error) ? allSchedule : undefined, fetchLog, errors: taskErrors }
    })() : Promise.resolve({ value: undefined, fetchLog: [], errors: [] })

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

    const [scheduleResult, examsResult, gradesResult, academicProgressResult] = await Promise.all([
      scheduleTask,
      examsTask,
      gradesTask,
      academicProgressTask,
    ])
    const schedule = scheduleResult.value
    const scheduleFetchLog = scheduleResult.fetchLog
    const exams = examsResult.value
    const examsFetchLog = examsResult.fetchLog
    const grades = gradesResult.value
    const gradesFetchLog = gradesResult.fetchLog || []
    const academicProgress = academicProgressResult.value
    errors.push(...scheduleResult.errors, ...examsResult.errors, ...gradesResult.errors, ...academicProgressResult.errors)

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
          completeness: scheduleFetchLog.some((item) => item.error) ? 'partial' : 'complete',
          errorCode: scheduleFetchLog.some((item) => item.error) ? 'partial_schedule_read' : null,
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
