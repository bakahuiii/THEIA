import { AuthRequiredError } from './source-client.mjs'
import { normalizeText, parseAcademicTerm } from './util.mjs'
import { parseJwHomepage } from './parsers/jwglxt.mjs'
import {
  selectionTerm,
  parseJson,
  classComponentOperationIds,
  safeServerMessage,
  serverResponseDetail,
  payloadItems,
  reportedTotal,
  caseInsensitiveFields,
  firstField,
  readFormFields,
  selectionStage,
  portalNotOpenError,
  selectionControlId,
  selectionCategoryCode,
  valueOrEmpty,
  protocolForm,
  protocolState,
  normalizeSelectionContext,
  addConditionalCatalogFields,
  addCatalogSearchFields,
  diagnosticRequestValues,
  parseBlocks,
  normalizeCandidate,
  courseMatchesTarget,
  schoolScheduleCourseRecord,
  responseOutcome,
  diagnosticPath,
} from './course-selection-helpers.mjs'
import { cachedSchoolScheduleResult } from './data-catalog.mjs'
import { schoolSchedule } from './course-selection-school-schedule.mjs'
import { COURSE_SELECTION_JOB_METHODS } from './course-selection-job-runtime.mjs'
import {
  BASE,
  INDEX_URL,
  DISPLAY_URL,
  COURSE_URL,
  CLASS_URL,
  CLASS_COMPONENT_URL,
  SELECT_URL,
  SCHOOL_SCHEDULE_INDEX_URL,
  CATALOG_CONTEXT_FIELDS,
  CLASS_CONTEXT_FIELDS,
  SELECTION_STAGE_FIELDS,
  JOB_LOG_LIMIT,
} from './course-selection-config.mjs'


export class CourseSelectionService {
  constructor({ client, courseSelectionClientFactory = null, getState, onChange = () => {}, onSuccess = async () => {}, onSchoolSchedule = async () => {}, academicClientFactory = null, onDiagnostic = () => {} }) {
    this.client = client
    this.courseSelectionClientFactory = courseSelectionClientFactory
    this.getState = getState
    this.onChange = onChange
    this.onSuccess = onSuccess
    this.onSchoolSchedule = onSchoolSchedule
    this.academicClientFactory = academicClientFactory
    this.onDiagnostic = onDiagnostic
    this.activeJobs = new Map()
    this.maxConcurrentRequests = 2
    this.concurrentRequests = 0
    this.requestWaiters = []
  }

  snapshot() {
    const jobs = [...this.activeJobs.values()].map((job) => ({
      id: job.id,
      candidate: job.candidate || null,
      target: job.target || null,
      startAt: job.startAt,
      endAt: job.endAt || null,
      intervalMs: job.intervalMs,
      maxAttempts: job.maxAttempts,
      status: job.status,
      attempts: job.attempts.map((attempt) => ({ ...attempt })),
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      lastMessage: job.lastMessage,
      logs: job.logs.map((entry) => ({ ...entry })),
    }))
    if (!jobs.length) return { active: null, jobs: [], updatedAt: new Date().toISOString() }
    return {
      active: jobs.find((job) => ['scheduled', 'running'].includes(job.status)) || jobs.at(-1),
      jobs,
      updatedAt: new Date().toISOString(),
    }
  }

  publish() {
    this.onChange(this.snapshot())
  }

  addLog(job, message, level = 'info') {
    const entry = { at: new Date().toISOString(), level, message: safeServerMessage(message, 480) || 'No diagnostic message' }
    job.logs.push(entry)
    if (job.logs.length > JOB_LOG_LIMIT) job.logs.splice(0, job.logs.length - JOB_LOG_LIMIT)
    try {
      this.onDiagnostic('course_selection.job_log', {
        jobId: job.id,
        status: job.status,
        level: entry.level,
        message: entry.message,
      })
    } catch { /* Diagnostics must not interrupt a course-selection task. */ }
  }

  async withRequestSlot(work) {
    if (this.concurrentRequests >= this.maxConcurrentRequests) await new Promise((resolve) => this.requestWaiters.push(resolve))
    this.concurrentRequests += 1
    try { return await work() } finally {
      this.concurrentRequests -= 1
      this.requestWaiters.shift()?.()
    }
  }

  currentTerm() {
    const state = this.getState()
    const term = state.terms?.[0]
    if (!term?.year || !term?.term) throw new Error('Sync the academic system before opening course selection')
    return term
  }

  async courseSelectionClient(options = {}) {
    return this.courseSelectionClientFactory
      ? this.courseSelectionClientFactory(options)
      : this.client
  }

  async discover() {
    let client = await this.courseSelectionClient()
    let page
    try {
      page = await client.page(INDEX_URL, { source: 'Course selection API' })
    } catch (error) {
      // API credentials create an isolated in-memory session. Re-login only
      // before a read operation; never replay a selection POST automatically.
      if (!this.courseSelectionClientFactory || error?.code !== 1006) throw error
      client = await this.courseSelectionClient({ refresh: true })
      page = await client.page(INDEX_URL, { source: 'Course selection API' })
    }
    const homepage = parseJwHomepage(page.text, page.url)
    if (!homepage.loggedIn) throw new AuthRequiredError('Course selection', page.url)
    const blocks = parseBlocks(page.text)
    const context = normalizeSelectionContext(readFormFields(page.text))
    const stage = selectionStage(page.text, context, blocks.length)
    // Course selection often opens for the next term before the schedule page
    // changes its active term. Prefer the selection portal's own term fields.
    const term = parseAcademicTerm(context.xkxnm || context.xnm, context.xkxqm || context.xqm, '') || this.currentTerm()
    this.onDiagnostic('course_selection.portal_response', {
      blocks: blocks.length,
      selectionState: stage.state,
      selectionOpen: stage.selectionOpen,
      selectionFlags: stage.flags,
      message: stage.message,
    })
    return {
      sourceUrl: page.url,
      term,
      blocks,
      available: stage.selectionOpen,
      selectionOpen: stage.selectionOpen,
      selectionState: stage.state,
      selectionFlags: stage.flags,
      message: stage.message,
      context,
    }
  }

  async candidates(blockId, target = null, options = {}) {
    const portal = await this.discover()
    const client = await this.courseSelectionClient()
    if (!portal.available || portal.selectionOpen === false) {
      throw portalNotOpenError(portal)
    }
    const block = portal.blocks.find((item) => item.id === blockId)
    if (!block) throw new Error('The selected course block is no longer available')
    const requestedPage = Math.max(1, Math.min(5_000, Math.trunc(Number(options.page) || 1)))
    const requestedPageSize = Math.max(12, Math.min(100, Math.trunc(Number(options.pageSize) || 24)))
    // Zhengfang names these fields as pages, but the rendered page script
    // sends an inclusive 1-based row range: 1..step, step+1..step*2, ... .
    // Sending the UI page number as kspage makes every response overlap the
    // previous range and silently drops one row per request.
    const requestedStartRow = ((requestedPage - 1) * requestedPageSize) + 1
    const requestedEndRow = requestedPage * requestedPageSize

    const display = await client.form(DISPLAY_URL, {
      xkkz_id: block.id,
      kklxdm: block.categoryCode,
      xszxzt: portal.context.xszxzt || '1',
      njdm_id: block.gradeId || portal.context.njdm_id || '',
      zyh_id: block.majorId || portal.context.zyh_id || '',
      kspage: '0',
      jspage: '0',
    }, { source: 'Course selection block', referer: portal.sourceUrl })
    const context = normalizeSelectionContext({
      ...portal.context,
      ...readFormFields(display),
      // The page script selects these values from the clicked tab. A nested
      // display fragment must not replace them with its initial/default tab.
      xkkz_id: selectionControlId(block.id, portal.context),
      kklxdm: selectionCategoryCode(block.categoryCode, portal.context),
      njdm_id: block.gradeId || portal.context.njdm_id || '',
      zyh_id: block.majorId || portal.context.zyh_id || '',
      xkkz_xh: block.controlSequence || portal.context.xkkz_xh || '',
    })
    const term = portal.term
    const controlId = selectionControlId(block.id, context)
    const categoryCode = selectionCategoryCode(block.categoryCode, context)
    const query = addConditionalCatalogFields(protocolForm({
      ...context,
      xkkz_id: controlId,
      kklxdm: categoryCode,
      xkxnm: String(term.year),
      xkxqm: selectionTerm(term),
      kspage: String(requestedStartRow),
      jspage: String(requestedEndRow),
    }, CATALOG_CONTEXT_FIELDS), context)
    const searchApplied = options.search !== false && Boolean(normalizeText(target?.courseCode || target?.title))
    if (searchApplied) addCatalogSearchFields(query, target)
    this.onDiagnostic('course_selection.request', {
      endpoint: 'display',
      blockId: block.id,
      values: diagnosticRequestValues({
        xkkz_id: block.id,
        kklxdm: block.categoryCode,
        xszxzt: portal.context.xszxzt || '1',
        njdm_id: block.gradeId || portal.context.njdm_id || '',
        zyh_id: block.majorId || portal.context.zyh_id || '',
        kspage: '0',
        jspage: '0',
      }, ['xkkz_id', 'kklxdm', 'xszxzt', 'njdm_id', 'zyh_id', 'kspage', 'jspage']),
    })
    this.onDiagnostic('course_selection.catalog_context', {
      blockId: block.id,
      categoryCode,
      displayFields: protocolState(context, ['xkkz_id', 'kklxdm', 'njdm_id', 'zyh_id', 'xkkz_xh', 'xklc', 'xkly']),
      catalogFields: protocolState(query, [...CATALOG_CONTEXT_FIELDS, 'filterKey', 'filter_list[0]']),
      values: diagnosticRequestValues(context, ['jg_id', 'jg_id_1', 'xqh_id', 'njdm_id_1', 'zyh_id_1', 'njdm_id', 'zyh_id', 'xkkz_id', 'xkkz_xh', 'xkxnm', 'xkxqm', 'kklxdm']),
    })
    // A complete school-wide row carries an opaque kch_id that is not always
    // published by the selection catalog. Use it directly for the class
    // lookup, while still resolving the submit operation id from that lookup.
    const fallbackSource = options.schoolScheduleItem
      || (target?.courseId ? target : null)
    const fallbackCourse = schoolScheduleCourseRecord(fallbackSource)
    let courseBody = ''
    let coursePayload = null
    let catalogDetail = {}
    let courses = []
    let reportedCourseTotal = null
    let totalKnown = false
    let total = 0
    if (fallbackCourse) {
      // A school-wide row is deliberately not treated as a submit candidate:
      // it has a display-only jxb_id. Use it only as the kch/kch_id input for
      // the current selection context's class endpoint below.
      courses = [fallbackCourse]
      total = 1
      totalKnown = true
    } else {
      this.onDiagnostic('course_selection.request', {
        endpoint: 'catalog',
        blockId: block.id,
        values: diagnosticRequestValues(query, [...CATALOG_CONTEXT_FIELDS, 'jxbzb', 'zh', 'filterKey', 'filter_list[0]']),
      })
      courseBody = await client.form(COURSE_URL, query, { source: 'Course selection catalog', referer: portal.sourceUrl })
      coursePayload = parseJson(courseBody)
      catalogDetail = serverResponseDetail(coursePayload)
      courses = payloadItems(coursePayload)
      reportedCourseTotal = reportedTotal(coursePayload)
      totalKnown = reportedCourseTotal !== null && reportedCourseTotal >= courses.length
      total = totalKnown ? reportedCourseTotal : courses.length
    }
    this.onDiagnostic('course_selection.catalog_response', {
      blockId: block.id,
      categoryCode,
      bytes: Buffer.byteLength(String(courseBody || '')),
      itemCount: courses.length,
      total: Number.isFinite(total) ? total : null,
      totalKnown,
      signal: catalogDetail.signal,
      message: catalogDetail.message,
      bodyKind: fallbackCourse ? 'school-schedule-fallback' : coursePayload === null ? 'unparsed' : Array.isArray(coursePayload) ? 'array' : typeof coursePayload,
      searchApplied: fallbackCourse ? false : searchApplied,
      fallback: Boolean(fallbackCourse),
    })
    const candidates = []
    const targetCourses = courses.filter((course) => courseMatchesTarget(course, target))
    const coursesToInspect = fallbackCourse
      ? courses
      : (target?.courseCode || target?.title) ? targetCourses : courses
    for (const course of coursesToInspect) {
      const courseFields = caseInsensitiveFields(course)
      const courseId = normalizeText(firstField(courseFields, 'kch_id', 'kch', 'courseId'))
      if (!courseId) continue
      const classQuery = protocolForm({
        ...query,
        kch_id: courseId,
        cxbj: firstField(courseFields, 'cxbj') ?? context.cxbj,
        fxbj: firstField(courseFields, 'fxbj') ?? context.fxbj,
      }, CLASS_CONTEXT_FIELDS)
      // `filter_list[0]` is required by Zhengfang's class lookup even when
      // the course came from the school-wide schedule rather than the catalog.
      const visibleCourseCode = normalizeText(firstField(courseFields, 'kch', 'courseCode'))
        || normalizeText(target?.courseCode)
      if (visibleCourseCode) classQuery['filter_list[0]'] = visibleCourseCode
      this.onDiagnostic('course_selection.request', {
        endpoint: 'classes',
        blockId: block.id,
        courseId,
        values: diagnosticRequestValues(classQuery, [...CLASS_CONTEXT_FIELDS, 'filter_list[0]']),
      })
      const classBody = await client.form(CLASS_URL, classQuery, { source: 'Course selection classes', referer: portal.sourceUrl })
      const classPayload = parseJson(classBody)
      const classes = payloadItems(classPayload)
      this.onDiagnostic('course_selection.classes_response', {
        blockId: block.id,
        courseId,
        bytes: Buffer.byteLength(String(classBody || '')),
        itemCount: classes.length,
        signal: serverResponseDetail(classPayload).signal,
        message: serverResponseDetail(classPayload).message,
        bodyKind: classPayload === null ? 'unparsed' : Array.isArray(classPayload) ? 'array' : typeof classPayload,
      })
      const courseClassId = normalizeText(firstField(courseFields, 'jxb_id', 'classId'))
      const courseOperationId = normalizeText(firstField(courseFields, 'do_jxb_id', 'jxb_ids', 'operationId'))
      const rows = classes.length ? classes : (courseClassId && courseOperationId ? [course] : [])
      for (const row of rows) {
        const candidate = normalizeCandidate({ ...course, ...row }, {
          block: { ...block, categoryCode },
          term,
          sourceUrl: portal.sourceUrl,
          context,
        })
        if (candidate) candidates.push(candidate)
      }
    }
    return {
      portal: { ...portal, context: undefined },
      block,
      page: requestedPage,
      pageSize: requestedPageSize,
      total: Number.isFinite(total) ? Math.max(courses.length, total) : courses.length,
      totalKnown,
      courseCount: courses.length,
      matchedCourseCount: (target?.courseCode || target?.title) ? targetCourses.length : courses.length,
      courseKeys: courses
        .map((course) => firstField(caseInsensitiveFields(course), 'kch_id', 'kch', 'courseId'))
        .map((value) => normalizeText(value))
        .filter(Boolean),
      candidates,
      message: catalogDetail.message,
      responseSignal: catalogDetail.signal,
    }
  }

  schoolSchedule(...args) { return schoolSchedule.apply(this, args) }

  async resolveSubmitOperationIds(candidate, { client, context, block, portal, term }) {
    const compositionCount = Number(candidate?.jxbzls)
    if (!Number.isFinite(compositionCount) || compositionCount <= 1) return valueOrEmpty(candidate?.operationId)
    const savedSelection = candidate?.selectionContext && typeof candidate.selectionContext === 'object'
      ? candidate.selectionContext
      : {}
    const field = (name, fallback = '') => {
      const saved = savedSelection[name]
      if (saved !== undefined && saved !== null && String(saved) !== '') return String(saved)
      return valueOrEmpty(context?.[name] ?? fallback)
    }
    const payload = {
      jxb_id: valueOrEmpty(candidate.classId),
      do_jxb_id: valueOrEmpty(candidate.operationId),
      jxbzls: valueOrEmpty(candidate.jxbzls),
      rwlx: field('rwlx'),
      zcongbj: field('zcongbj', '0'),
      syqz: field('syqz', '100'),
      rlkz: field('rlkz'),
      fxbj: field('fxbj'),
      cxbj: field('cxbj'),
      rlzlkz: field('rlzlkz'),
      cdrlkz: field('cdrlkz'),
      xkxnm: String(term?.year || portal?.term?.year || ''),
      xkxqm: selectionTerm(term || portal?.term),
      xkly: field('xkly'),
      kklxdm: field('kklxdm', block?.categoryCode),
      njdm_id: valueOrEmpty(block?.gradeId || context?.njdm_id),
      zyh_id: valueOrEmpty(block?.majorId || context?.zyh_id),
      zyfx_id: field('zyfx_id'),
      bh_id: field('bh_id'),
      xh_id: field('xh_id'),
    }
    this.onDiagnostic('course_selection.request', {
      endpoint: 'class-components',
      values: diagnosticRequestValues(payload, Object.keys(payload)),
    })
    const body = await client.form(CLASS_COMPONENT_URL, payload, {
      source: 'Course selection linked classes',
      referer: portal?.sourceUrl,
    })
    const ids = classComponentOperationIds(body)
    this.onDiagnostic('course_selection.class_components_response', {
      endpoint: diagnosticPath(CLASS_COMPONENT_URL),
      classId: candidate.classId || null,
      jxbzls: candidate.jxbzls || null,
      bytes: Buffer.byteLength(String(body || '')),
      operationCount: ids.length,
      bodyKind: parseJson(body) === null ? 'html-or-unparsed' : 'json',
    })
    if (!ids.length) {
      const error = new Error(`CLASS_COMPONENTS_NOT_FOUND | class=${candidate.classId || 'unknown'} | expected=${candidate.jxbzls}`)
      error.code = 'CLASS_COMPONENTS_NOT_FOUND'
      throw error
    }
    return ids.join(',')
  }

  async attempt(candidate) {
    const portal = await this.discover()
    if (!portal.available || portal.selectionOpen === false) throw portalNotOpenError(portal)
    const client = await this.courseSelectionClient()
    const term = portal.term
    const block = portal.blocks.find((item) => item.id === candidate.blockId)
    const display = await client.form(DISPLAY_URL, {
      xkkz_id: candidate.blockId,
      kklxdm: candidate.categoryCode || block?.categoryCode || '',
      xszxzt: portal.context.xszxzt || '1',
      njdm_id: block?.gradeId || portal.context.njdm_id || '',
      zyh_id: block?.majorId || portal.context.zyh_id || '',
      kspage: '0',
      jspage: '0',
    }, { source: 'Course selection block', referer: portal.sourceUrl })
    const context = normalizeSelectionContext({
      ...portal.context,
      ...readFormFields(display),
      xkkz_id: selectionControlId(candidate.blockId, portal.context),
      kklxdm: selectionCategoryCode(candidate.categoryCode || block?.categoryCode, portal.context),
      njdm_id: block?.gradeId || portal.context.njdm_id || '',
      zyh_id: block?.majorId || portal.context.zyh_id || '',
      xkkz_xh: block?.controlSequence || portal.context.xkkz_xh || '',
    })
    const savedSelection = candidate?.selectionContext && typeof candidate.selectionContext === 'object'
      ? candidate.selectionContext
      : {}
    const selectionValue = (field, fallback = '') => {
      const saved = savedSelection[field]
      if (saved !== undefined && saved !== null && String(saved) !== '') return String(saved)
      return valueOrEmpty(context[field] ?? fallback)
    }
    const rlkz = selectionValue('rlkz')
    const cdrlkz = selectionValue('cdrlkz')
    const rlzlkz = selectionValue('rlzlkz')
    const submitOperationIds = await this.resolveSubmitOperationIds(candidate, {
      client,
      context,
      block,
      portal,
      term,
    })
    const payload = {
      // Keep this object in the same shape as Zhengfang's saveCourse() call.
      // Empty values are intentional: the official jQuery call sends
      // jcxx_id and optional rule fields even when they are blank.
      jxb_ids: submitOperationIds,
      kch_id: valueOrEmpty(candidate.courseId),
      kcmc: selectionValue('kcmc', candidate.title),
      rwlx: selectionValue('rwlx'),
      rlkz,
      cdrlkz,
      rlzlkz,
      sxbj: [rlkz, cdrlkz, rlzlkz].some((value) => value === '1') ? '1' : '0',
      xxkbj: selectionValue('xxkbj'),
      qz: selectionValue('qz', '0'),
      cxbj: selectionValue('cxbj', '0'),
      xkkz_id: selectionControlId(candidate.blockId, context),
      njdm_id: block?.gradeId || context.njdm_id || '',
      zyh_id: block?.majorId || context.zyh_id || '',
      kklxdm: selectionCategoryCode(candidate.categoryCode || block?.categoryCode, context),
      xklc: selectionValue('xklc'),
      xkxnm: String(term.year),
      xkxqm: selectionTerm(term),
      jcxx_id: selectionValue('jcxx_id'),
    }
    this.onDiagnostic('course_selection.request', {
      endpoint: 'select',
      values: diagnosticRequestValues(payload, [
        'jxb_ids', 'kch_id', 'kcmc', 'rwlx', 'rlkz', 'cdrlkz', 'rlzlkz',
        'sxbj', 'xxkbj', 'qz', 'cxbj', 'xkkz_id', 'njdm_id', 'zyh_id',
        'kklxdm', 'xklc', 'xkxnm', 'xkxqm', 'jcxx_id',
      ]),
    })
    const body = await client.form(SELECT_URL, payload, { source: 'Course selection submit', referer: portal.sourceUrl })
    const outcome = responseOutcome(body)
    const detail = serverResponseDetail(outcome.payload)
    this.onDiagnostic('course_selection.select_response', {
      endpoint: diagnosticPath(SELECT_URL),
      bytes: Buffer.byteLength(String(body || '')),
      success: outcome.success,
      signal: detail.signal,
      message: outcome.message,
    })
    return outcome
  }

}

Object.assign(CourseSelectionService.prototype, COURSE_SELECTION_JOB_METHODS)

export const COURSE_SELECTION_URLS = {
  index: INDEX_URL,
  display: DISPLAY_URL,
  catalog: COURSE_URL,
  classes: CLASS_URL,
  classComponents: CLASS_COMPONENT_URL,
  select: SELECT_URL,
  schoolSchedule: SCHOOL_SCHEDULE_INDEX_URL,
}
