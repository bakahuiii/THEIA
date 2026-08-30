import { compactError } from '../util.mjs'
import { AuthRequiredError } from '../source-client.mjs'
import { categoryLabelOf, preferredCourseCategory } from '../course-category.mjs'
import {
  describeJwSchedulePayload,
  isRenderableScheduleItem,
  isStandardCourseCode,
  parseJwExams,
  parseJwGrades,
  parseJwHomepage,
  parseJwNotices,
  parseJwQueryForm,
  parseJwSchedule,
  parseJwSelectedCourses,
  parseJwStudentIdentity,
} from '../parsers/jwglxt.mjs'
import {
  JWGLXT_EXTRA_DOMAINS,
  JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES,
  JWGLXT_EXTRA_PARSER_VERSION,
} from '../jwglxt-extra.mjs'
import {
  BROWSER_SCHEDULE_ENDPOINT,
  EXTRA_DETAIL_LIMIT,
  EXTRA_GRADE_DETAIL_LIMIT,
  EXTRA_QUERY_CONCURRENCY,
  EXTRA_QUERY_LIMIT,
  PARSER_VERSION,
  assertValidQueryPayload,
  failedDomain,
  fallbackTerm,
  fetchCoverage,
  mapWithConcurrency,
  mergeExtraDomainValues,
  newestFirstTermIds,
  queryModel,
  scheduleRequestValues,
  scheduleTerms,
  selectedCourseTerm,
  selectedDomains,
  successfulDomain,
  uniqueTerms,
} from './jwglxt-helpers.mjs'

const BASE = 'https://jwglxt.buct.edu.cn/jwglxt/'
const HOME = new URL('xtgl/index_initMenu.html', BASE).toString()

export const JWGLXT_SYNC_METHODS = {
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
  },
}
