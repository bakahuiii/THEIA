import * as cheerio from 'cheerio'
import { randomUUID } from 'node:crypto'
import { AuthRequiredError } from './source-client.mjs'
import { cachedSchoolScheduleResult, SCHOOL_SCHEDULE_PARSER_VERSION } from './data-catalog.mjs'
import { compactError, normalizeText, parseAcademicTerm, parseNumber, stableId } from './util.mjs'
import { parseJwHomepage } from './parsers/jwglxt.mjs'

const BASE = 'https://jwglxt.buct.edu.cn/jwglxt/'
const INDEX_URL = new URL('xsxk/zzxkyzb_cxZzxkYzbIndex.html?gnmkdm=N253512&layout=default', BASE).toString()
const DISPLAY_URL = new URL('xsxk/zzxkyzb_cxZzxkYzbDisplay.html?gnmkdm=N253512', BASE).toString()
const COURSE_URL = new URL('xsxk/zzxkyzb_cxZzxkYzbPartDisplay.html?gnmkdm=N253512', BASE).toString()
const CLASS_URL = new URL('xsxk/zzxkyzb_cxJxbWithKchZzxkYzb.html?gnmkdm=N253512', BASE).toString()
const SELECT_URL = new URL('xsxk/zzxkyzb_xkBcZyZzxkYzb.html?gnmkdm=N253512', BASE).toString()
const SCHOOL_SCHEDULE_INDEX_URL = new URL('design/viewFunc_cxDesignFuncPageIndex.html?gnmkdm=N219933', BASE).toString()
const SCHOOL_SCHEDULE_URL = new URL('design/funcData_cxFuncDataList.html?func_widget_guid=5920CCA8B9E61FBAE0530100007F0493', BASE).toString()
const SCHOOL_SCHEDULE_FETCH_SIZE = 500
const SCHOOL_SCHEDULE_ITEM_LIMIT = 10_000

function selectionTerm(term) {
  const code = String(term?.term || '').trim()
  if (['3', '12', '16'].includes(code)) return code
  if (code === '1') return '3'
  if (code === '2') return '12'
  return code
}

function parseJson(body) {
  try { return JSON.parse(String(body || '')) } catch { return null }
}

function payloadItems(payload) {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  for (const key of ['items', 'rows', 'data', 'result', 'list', 'tmpList']) {
    if (Array.isArray(payload[key])) return payload[key]
  }
  for (const key of ['data', 'result', 'queryModel']) {
    const nested = payloadItems(payload[key])
    if (nested.length) return nested
  }
  return []
}

function reportedTotal(payload) {
  const candidates = [payload, payload?.data, payload?.result, payload?.queryModel, payload?.data?.queryModel]
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue
    for (const key of ['totalCount', 'total', 'recordsTotal', 'recordCount', 'totalResult']) {
      const value = Number(candidate[key])
      if (Number.isInteger(value) && value >= 0) return value
    }
  }
  return null
}

function meaningfulFields(input) {
  return Object.fromEntries(Object.entries(input || {}).filter(([, value]) => value !== undefined && value !== null && String(value) !== ''))
}

function caseInsensitiveFields(record) {
  const fields = new Map()
  for (const [key, value] of Object.entries(record && typeof record === 'object' ? record : {})) {
    const normalizedKey = key.toLocaleLowerCase()
    if (!fields.has(normalizedKey)) fields.set(normalizedKey, value)
  }
  return fields
}

function firstField(fields, ...names) {
  for (const name of names) {
    const value = fields.get(String(name).toLocaleLowerCase())
    if (value !== undefined && value !== null && value !== '') return value
  }
  return null
}

function combinedClassInfoOf(fields) {
  const explicit = firstField(fields, 'hbxx', 'combinedClassInfo', 'classComposition')
  const normalizedExplicit = normalizeText(explicit)
  if (normalizedExplicit) return normalizedExplicit
  // Zhengfang calls this field jxbzc (教学班组成). Week ranges use zcd.
  return normalizeText(firstField(fields, 'jxbzc', 'teachingClassComposition', 'classCompositionText'))
}

function readHiddenFields(html) {
  const $ = cheerio.load(html)
  const values = {}
  $('input[type="hidden"][name]').each((_index, node) => {
    const field = $(node)
    const name = field.attr('name')
    if (name) values[name] = field.attr('value') || ''
  })
  return values
}

function parseBlocks(html) {
  const $ = cheerio.load(html)
  const seen = new Set()
  const blocks = []
  $('a[role="tab"], a[onclick*="xkkz_id"]').each((_index, node) => {
    const element = $(node)
    const args = [...String(element.attr('onclick') || '').matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1].trim())
    const [categoryCode, controlId] = args
    if (!categoryCode || !controlId || seen.has(controlId)) return
    seen.add(controlId)
    blocks.push({
      id: controlId,
      categoryCode,
      title: normalizeText(element.text()) || categoryCode,
    })
  })
  return blocks
}

function parseTeacher(value) {
  const text = normalizeText(value)
  const match = text.match(/\/([^/]+)\//)
  return match ? normalizeText(match[1]) : text || null
}

function normalizeCandidate(record, { block, term, sourceUrl }) {
  const courseId = normalizeText(record.kch_id || record.kch || record.courseId)
  const classId = normalizeText(record.jxb_id || record.classId)
  const className = normalizeText(record.jxbmc || record.className)
  const operationId = normalizeText(record.do_jxb_id || record.jxb_ids || classId)
  const title = normalizeText(record.kcmc || record.courseName || record.title)
  if (!courseId || !operationId || !title) return null
  const capacity = parseNumber(record.jxbrl ?? record.jxbrs ?? record.capacity)
  const enrolled = parseNumber(record.yxzrs ?? record.selected_number ?? record.enrolled)
  return {
    id: stableId('course-selection-candidate', term?.id, block.id, courseId, operationId),
    courseId,
    classId: classId || null,
    className: className || null,
    operationId,
    title,
    courseCode: normalizeText(record.kch || record.courseCode) || courseId,
    teacher: parseTeacher(record.jsxx || record.jsxm || record.teacher),
    credits: parseNumber(record.xf ?? record.credits),
    location: normalizeText(record.jxdd || record.cdmc || record.location) || null,
    time: normalizeText(record.sksj || record.time) || null,
    capacity,
    enrolled,
    remainingSeats: Number.isFinite(capacity) && Number.isFinite(enrolled) ? Math.max(0, capacity - enrolled) : null,
    categoryCode: block.categoryCode,
    blockId: block.id,
    blockTitle: block.title,
    termId: term?.id || null,
    sourceUrl,
  }
}

function normalizeSchoolSchedule(record, { term, sourceUrl }) {
  const fields = caseInsensitiveFields(record)
  const title = normalizeText(firstField(fields, 'kcmc', 'courseName', 'title'))
  const courseCode = normalizeText(firstField(fields, 'kch', 'courseCode'))
  const classId = normalizeText(firstField(fields, 'jxb_id', 'jxbId', 'teachingClassId'))
  const className = normalizeText(firstField(fields, 'jxbmc', 'className'))
  const combinedClassInfo = combinedClassInfoOf(fields)
  const teacher = firstField(fields, 'rkjs', 'js', 'teacher')
  const time = firstField(fields, 'sksj', 'time')
  if (!title) return null
  return {
    id: classId
      ? stableId('school-schedule', term.id, classId, combinedClassInfo)
      : stableId('school-schedule', term.id, courseCode || title, className, combinedClassInfo, teacher, time),
    termId: term.id,
    classId: classId || null,
    courseCode: courseCode || null,
    title,
    className: className || null,
    combinedClassInfo: combinedClassInfo || null,
    teacher: normalizeText(teacher) || null,
    time: normalizeText(time) || null,
    location: normalizeText(firstField(fields, 'jxdd', 'location')) || null,
    credits: parseNumber(firstField(fields, 'xf', 'credits')),
    nature: normalizeText(firstField(fields, 'kcxz', 'kcxzmc', 'nature')) || null,
    category: normalizeText(firstField(fields, 'kclb', 'kclbmc', 'category')) || null,
    department: normalizeText(firstField(fields, 'kkxy', 'kkbmmc', 'department')) || null,
    status: normalizeText(firstField(fields, 'kkzt', 'status')) || null,
    affiliation: normalizeText(firstField(fields, 'kcgs', 'kcgsmc', 'courseAffiliation', 'affiliation')) || null,
    sourceUrl,
  }
}

function equalTargetText(left, right) {
  const normalizedLeft = normalizeText(left).toLocaleLowerCase()
  const normalizedRight = normalizeText(right).toLocaleLowerCase()
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight)
}

function matchPublishedCandidate(candidates, target) {
  if (!candidates.length) return null
  const direct = candidates.find((candidate) => (
    (target.id && candidate.id === target.id)
    || (target.classId && (candidate.classId === target.classId || candidate.operationId === target.classId))
  ))
  if (direct) return direct

  // Before classId had its own field, direct candidate selections stored it in
  // className. Keep those local plans usable without confusing IDs with names.
  const legacy = target.className
    ? candidates.find((candidate) => candidate.classId === target.className || candidate.operationId === target.className)
    : null
  if (legacy) return legacy

  const byName = target.className
    ? candidates.filter((candidate) => equalTargetText(candidate.className, target.className))
    : []
  if (byName.length === 1) return byName[0]

  const metadataFields = ['teacher', 'time', 'location']
  const ranked = candidates
    .map((candidate) => {
      if (target.className && candidate.className && !equalTargetText(candidate.className, target.className)) return null
      const comparable = metadataFields.filter((field) => target[field] && candidate[field])
      if (!comparable.length || comparable.some((field) => !equalTargetText(candidate[field], target[field]))) return null
      return { candidate, score: comparable.length }
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score)
  if (ranked[0] && (!ranked[1] || ranked[0].score > ranked[1].score)) return ranked[0].candidate

  const courseOnly = !target.id && !target.classId && !target.className && !target.teacher && !target.time && !target.location
  return courseOnly && candidates.length === 1 ? candidates[0] : null
}

function courseMatchesTarget(course, target) {
  const code = normalizeText(target?.courseCode).toUpperCase()
  const title = normalizeText(target?.title)
  if (!code && !title) return true
  const candidateCode = normalizeText(course.kch_id || course.kch || course.courseId).toUpperCase()
  const candidateTitle = normalizeText(course.kcmc || course.courseName || course.title)
  return (code && candidateCode === code) || (title && candidateTitle === title)
}

function responseOutcome(body) {
  const payload = parseJson(body)
  const message = normalizeText(
    payload?.message || payload?.msg || payload?.data?.message || payload?.data?.msg || payload?.error || String(body || '').slice(0, 400),
  )
  const signal = String(payload?.flag ?? payload?.success ?? payload?.status ?? payload?.code ?? '').toLowerCase()
  const hasFailureMessage = /\u5931\u8d25|\u672a\u9009\u4e0a|\u5df2\u6ee1|\u51b2\u7a81|\u9519\u8bef/u.test(message)
  const hasFailureSignal = ['0', 'false', 'fail', 'failed', 'error', '-1', '500'].includes(signal)
  const hasSuccessMessage = /\u6210\u529f|\u5df2\u9009/u.test(message)
  return {
    success: !hasFailureSignal && !hasFailureMessage && (['1', 'true', 'success', '1000', '200'].includes(signal) || hasSuccessMessage),
    message: message || 'Selection endpoint returned no message',
    raw: normalizeText(String(body || '')).replace(/(JSESSIONID|token|cookie)\s*[=:]\s*[^\s,;"']+/gi, '$1=[redacted]').slice(0, 480),
    payload,
  }
}

function diagnosticPath(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ''))
    return `${url.origin}${url.pathname}`
  } catch { return String(rawUrl || '').slice(0, 240) || 'unknown' }
}

function rawError(error) {
  const name = String(error?.name || 'Error')
  const message = compactError(error)
  const fields = [
    error?.code != null ? `code=${error.code}` : null,
    error?.status != null ? `status=${error.status}` : null,
    error?.source ? `source=${error.source}` : null,
    error?.url ? `url=${diagnosticPath(error.url)}` : null,
  ].filter(Boolean)
  return `[${name}] ${message}${fields.length ? ` | ${fields.join(' | ')}` : ''}`.slice(0, 720)
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export class CourseSelectionService {
  constructor({ client, courseSelectionClientFactory = null, getState, onChange = () => {}, onSuccess = async () => {}, onSchoolSchedule = async () => {}, academicClientFactory = null }) {
    this.client = client
    this.courseSelectionClientFactory = courseSelectionClientFactory
    this.getState = getState
    this.onChange = onChange
    this.onSuccess = onSuccess
    this.onSchoolSchedule = onSchoolSchedule
    this.academicClientFactory = academicClientFactory
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
    job.logs.push({ at: new Date().toISOString(), level, message: String(message || '').slice(0, 480) })
    if (job.logs.length > 80) job.logs.splice(0, job.logs.length - 80)
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
    const context = readHiddenFields(page.text)
    // Course selection often opens for the next term before the schedule page
    // changes its active term. Prefer the selection portal's own term fields.
    const term = parseAcademicTerm(context.xkxnm || context.xnm, context.xkxqm || context.xqm, '') || this.currentTerm()
    return {
      sourceUrl: page.url,
      term,
      blocks,
      available: blocks.length > 0,
      message: blocks.length ? null : 'No active course-selection block is currently published',
      context,
    }
  }

  async candidates(blockId, target = null, options = {}) {
    const portal = await this.discover()
    const client = await this.courseSelectionClient()
    const block = portal.blocks.find((item) => item.id === blockId)
    if (!block) throw new Error('The selected course block is no longer available')
    const requestedPage = Math.max(1, Math.min(5_000, Math.trunc(Number(options.page) || 1)))
    const requestedPageSize = Math.max(12, Math.min(100, Math.trunc(Number(options.pageSize) || 24)))

    const display = await client.form(DISPLAY_URL, {
      xkkz_id: block.id,
      xszxzt: '1',
      kspage: '0',
    }, { source: 'Course selection block', referer: portal.sourceUrl })
    const context = { ...portal.context, ...readHiddenFields(display) }
    const term = portal.term
    const query = meaningfulFields({
      bklx_id: context.bklx_id,
      xqh_id: context.xqh_id,
      zyfx_id: context.zyfx_id,
      njdm_id: context.njdm_id,
      bh_id: context.bh_id,
      xbm: context.xbm,
      xslbdm: context.xslbdm,
      ccdm: context.ccdm,
      xsbj: context.xsbj,
      xkxnm: String(term.year),
      xkxqm: selectionTerm(term),
      kklxdm: block.categoryCode,
      kkbk: context.kkbk,
      rwlx: context.rwlx,
      kspage: String(requestedPage),
      jspage: String(requestedPageSize),
    })
    const coursePayload = parseJson(await client.form(COURSE_URL, query, { source: 'Course selection catalog', referer: portal.sourceUrl }))
    const courses = payloadItems(coursePayload)
    const total = Number(coursePayload?.totalCount ?? coursePayload?.total ?? coursePayload?.records ?? courses.length)
    const candidates = []
    const targetCourses = courses.filter((course) => courseMatchesTarget(course, target))
    const coursesToInspect = (target?.courseCode || target?.title) ? targetCourses : courses
    for (const course of coursesToInspect) {
      const courseId = normalizeText(course.kch_id || course.kch || course.courseId)
      if (!courseId) continue
      const classes = payloadItems(parseJson(await client.form(CLASS_URL, meaningfulFields({
        ...query,
        xkkz_id: block.id,
        zyh_id: context.zyh_id,
        kch_id: courseId,
      }), { source: 'Course selection classes', referer: portal.sourceUrl })))
      for (const row of (classes.length ? classes : [course])) {
        const candidate = normalizeCandidate({ ...course, ...row }, { block, term, sourceUrl: portal.sourceUrl })
        if (candidate) candidates.push(candidate)
      }
    }
    return {
      portal: { ...portal, context: undefined },
      block,
      page: requestedPage,
      pageSize: requestedPageSize,
      total: Number.isFinite(total) ? Math.max(courses.length, total) : courses.length,
      candidates,
    }
  }

  async schoolSchedule(query = {}) {
    const stateTerm = this.currentTerm()
    const requestedTerm = parseAcademicTerm(
      String(query.termId || '').split('-')[0],
      String(query.termId || '').split('-').slice(1).join('-'),
      '',
    ) || stateTerm
    const scope = {
      termId: requestedTerm.id,
      keyword: normalizeText(query.keyword) || null,
      teacher: normalizeText(query.teacher) || null,
      department: normalizeText(query.department) || null,
      category: normalizeText(query.category) || null,
      nature: normalizeText(query.nature) || null,
      format: normalizeText(query.format) || null,
      affiliation: normalizeText(query.affiliation) || null,
    }
    const forceRefresh = query.forceRefresh === true
    const cached = cachedSchoolScheduleResult(this.getState()?.dataCatalog, scope)
    if (!forceRefresh && cached?.complete && cached.parserVersion === SCHOOL_SCHEDULE_PARSER_VERSION) return cached
    const readSchedule = async (client) => {
      const sourcePage = await client.page(SCHOOL_SCHEDULE_INDEX_URL, { source: 'School-wide schedule' })
      const fetchPage = async (pageNumber) => parseJson(await client.form(SCHOOL_SCHEDULE_URL, meaningfulFields({
        xnm: String(requestedTerm.year),
        xqm: selectionTerm(requestedTerm),
        // This design endpoint uses Zhengfang's queryModel pagination. The
        // generic page/rows fields are ignored at BUCT and silently cap every
        // response at 10 rows, which made a 3,000-row term look complete.
        _search: 'false',
        nd: String(Date.now()),
        'queryModel.showCount': String(SCHOOL_SCHEDULE_FETCH_SIZE),
        'queryModel.currentPage': String(pageNumber),
        'queryModel.sortName': '',
        'queryModel.sortOrder': 'asc',
        time: '0',
      }), { source: 'School-wide schedule', referer: sourcePage.url }))
      return { sourcePage, fetchPage }
    }
    let response
    try {
      response = await readSchedule(await this.courseSelectionClient())
    } catch (error) {
      if (this.courseSelectionClientFactory && error?.code === 1006) {
        response = await readSchedule(await this.courseSelectionClient({ refresh: true }))
      } else {
        if (!(error instanceof AuthRequiredError) || typeof this.academicClientFactory !== 'function') throw error
        const apiClient = await this.academicClientFactory()
        if (!apiClient) throw error
        await apiClient.login()
        response = await readSchedule(apiClient)
      }
    }
    const { sourcePage, fetchPage } = response
    const firstPayload = await fetchPage(1)
    const firstEntries = payloadItems(firstPayload)
    let receivedCount = firstEntries.length
    const firstItems = firstEntries
      .map((entry) => normalizeSchoolSchedule(entry, { term: requestedTerm, sourceUrl: sourcePage.url }))
      .filter(Boolean)
    let normalizedCount = firstItems.length
    const totalFromServer = reportedTotal(firstPayload)
    const hasTrustedTotal = totalFromServer !== null && totalFromServer >= firstItems.length
    const expectedTotal = hasTrustedTotal ? totalFromServer : firstItems.length
    const byId = new Map(firstItems.map((item) => [item.id, item]))
    const pageCount = hasTrustedTotal
      ? Math.min(Math.ceil(SCHOOL_SCHEDULE_ITEM_LIMIT / SCHOOL_SCHEDULE_FETCH_SIZE), Math.max(1, Math.ceil(expectedTotal / SCHOOL_SCHEDULE_FETCH_SIZE)))
      : 1
    for (let pageNumber = 2; pageNumber <= pageCount && byId.size < SCHOOL_SCHEDULE_ITEM_LIMIT; pageNumber += 1) {
      const payload = await fetchPage(pageNumber)
      const pageEntries = payloadItems(payload)
      receivedCount += pageEntries.length
      const pageItems = pageEntries
        .map((entry) => normalizeSchoolSchedule(entry, { term: requestedTerm, sourceUrl: sourcePage.url }))
        .filter(Boolean)
      normalizedCount += pageItems.length
      let added = 0
      for (const item of pageItems) {
        if (byId.has(item.id)) continue
        byId.set(item.id, item)
        added += 1
      }
      if (!pageItems.length || !added) break
    }
    const items = [...byId.values()]
    const complete = hasTrustedTotal && receivedCount === normalizedCount && items.length >= expectedTotal
    const total = hasTrustedTotal ? expectedTotal : items.length
    if (!complete) {
      const reported = totalFromServer ?? 'unknown'
      const error = new Error(`SCHOOL_SCHEDULE_INCOMPLETE read=${receivedCount} normalized=${normalizedCount} reported=${reported}`)
      error.code = 'SCHOOL_SCHEDULE_INCOMPLETE'
      error.readCount = receivedCount
      error.normalizedCount = normalizedCount
      error.reportedTotal = totalFromServer
      throw error
    }
    const capturedAt = new Date().toISOString()
    const result = {
      // Persist the complete term once. User-entered criteria are applied from
      // that local collection by data-catalog on every later search.
      scope: { termId: scope.termId },
      page: 1,
      pageSize: items.length,
      total,
      items,
      complete,
      capturedAt,
      parserVersion: SCHOOL_SCHEDULE_PARSER_VERSION,
      fromCache: false,
      sourceUrl: sourcePage.url,
    }
    await this.onSchoolSchedule(result)
    const stored = cachedSchoolScheduleResult(this.getState()?.dataCatalog, scope)
    if (stored) return { ...stored, capturedAt, fromCache: false }
    return { ...result, scope, page: 1, pageSize: items.length }
  }

  async attempt(candidate) {
    const portal = await this.discover()
    const client = await this.courseSelectionClient()
    const term = portal.term
    const payload = meaningfulFields({
      jxb_ids: candidate.operationId,
      kch_id: candidate.courseId,
      qz: '0',
      xkxnm: String(term.year),
      xkxqm: selectionTerm(term),
      njdm_id: portal.context.njdm_id,
      zyh_id: portal.context.zyh_id,
      kklxdm: candidate.categoryCode,
      xkkz_id: candidate.blockId,
      rwlx: portal.context.rwlx,
      xklc: portal.context.xklc,
    })
    const body = await client.form(SELECT_URL, payload, { source: 'Course selection API', referer: portal.sourceUrl })
    return responseOutcome(body)
  }

  start({ candidate = null, targets = [], startAt = null, endAt = null, intervalMs = 1_500, maxAttempts = 120, concurrency = 2, sentinel = false }) {
    const plannedTargets = candidate ? [] : targets.filter((target) => target?.title)
    if (!candidate && !plannedTargets.length) throw new Error('Add at least one course to the course-selection plan first')
    if (candidate && (!candidate.courseId || !candidate.operationId || !candidate.categoryCode)) throw new Error('The course-selection target is incomplete; refresh the catalog and choose a teaching class again')
    const requestedStart = startAt ? new Date(startAt).getTime() : Date.now()
    const shared = {
      startAt: new Date(Number.isFinite(requestedStart) ? Math.max(requestedStart, Date.now()) : Date.now()).toISOString(),
      endAt: endAt && Number.isFinite(new Date(endAt).getTime()) ? new Date(endAt).toISOString() : null,
      intervalMs: Math.max(1_000, Math.min(60_000, Number(intervalMs) || 1_500)),
      maxAttempts: Math.max(1, Math.min(1_000_000, Number(maxAttempts) || 120)),
      sentinel: Boolean(sentinel),
    }
    if (shared.endAt && new Date(shared.endAt).getTime() <= new Date(shared.startAt).getTime()) throw new Error('The sentinel end time must be after the start time')
    this.maxConcurrentRequests = Math.max(1, Math.min(3, Math.trunc(Number(concurrency) || 2)))
    const jobs = candidate ? [{ candidate, target: null }] : plannedTargets.map((target) => ({ candidate: null, target }))
    for (const definition of jobs) {
      const alreadyActive = [...this.activeJobs.values()].some((job) => job.target?.id && job.target.id === definition.target?.id && ['scheduled', 'running'].includes(job.status))
      if (alreadyActive) continue
      const job = { id: randomUUID(), ...definition, ...shared, status: 'scheduled', attempts: [], startedAt: null, completedAt: null, lastMessage: null, logs: [], timer: null, stopped: false }
      this.addLog(job, `TASK SCHEDULED | startAt=${job.startAt} | endAt=${job.endAt || 'none'} | intervalMs=${job.intervalMs} | maxAttempts=${job.maxAttempts} | concurrency=${this.maxConcurrentRequests}`)
      this.activeJobs.set(job.id, job)
      const delay = Math.max(0, new Date(job.startAt).getTime() - Date.now())
      job.timer = setTimeout(() => { void this.run(job) }, delay)
    }
    this.publish()
    return this.snapshot()
  }

  stop() {
    const jobs = [...this.activeJobs.values()].filter((job) => ['scheduled', 'running'].includes(job.status))
    if (!jobs.length) return this.snapshot()
    for (const job of jobs) {
      job.stopped = true
      if (job.timer) clearTimeout(job.timer)
      job.status = 'stopped'
      job.completedAt = new Date().toISOString()
      job.lastMessage = 'Stopped by user'
      this.addLog(job, job.lastMessage, 'stopped')
    }
    this.publish()
    return this.snapshot()
  }

  async run(job) {
    if (!this.activeJobs.has(job.id) || job.stopped) return
    job.status = 'running'
    job.startedAt = new Date().toISOString()
    this.addLog(job, 'TASK RUNNING | transport=JWGLXT API')
    this.publish()
    for (let number = 1; number <= job.maxAttempts && !job.stopped; number += 1) {
      if (job.endAt && Date.now() >= new Date(job.endAt).getTime()) {
        job.status = 'expired'
        job.completedAt = new Date().toISOString()
        job.lastMessage = 'SENTINEL_WINDOW_EXPIRED'
        this.addLog(job, `SENTINEL_WINDOW_EXPIRED | endAt=${job.endAt}`, 'stopped')
        this.publish()
        return
      }
      const startedAt = new Date().toISOString()
      try {
        const outcome = await this.withRequestSlot(async () => {
          if (!job.candidate && job.target) {
            this.addLog(job, `TARGET ${job.target.courseCode || job.target.title} | discovering published selection blocks`)
            this.publish()
            job.candidate = await this.findCandidate(job.target, (detail) => this.addLog(job, detail))
            if (job.candidate) this.addLog(job, `CLASS FOUND | id=${job.candidate.classId || 'unknown'} | teacher=${job.candidate.teacher || '--'}`)
          }
          if (!job.candidate) throw new Error(`CLASS_NOT_FOUND | target=${job.target?.courseCode || job.target?.title || 'unknown'} | no matching teaching class returned by the published selection catalog`)
          return this.attempt(job.candidate)
        })
        job.attempts.push({ number, at: startedAt, success: outcome.success, message: outcome.message })
        job.lastMessage = outcome.message
        this.addLog(job, `POST ${diagnosticPath(SELECT_URL)} | attempt=${number} | ${outcome.raw || outcome.message}`, outcome.success ? 'success' : 'warning')
        this.publish()
        if (outcome.success) {
          job.status = 'selected'
          job.completedAt = new Date().toISOString()
          this.addLog(job, 'Course selected successfully', 'success')
          this.publish()
          await this.onSuccess()
          return
        }
      } catch (error) {
        job.lastMessage = compactError(error)
        job.attempts.push({ number, at: startedAt, success: false, message: job.lastMessage })
        this.addLog(job, `ATTEMPT ${number} FAILED | ${rawError(error)}`, 'error')
        if (job.lastMessage.includes('PORTAL_NOT_OPEN')) {
          job.lastMessage = `${job.lastMessage} | backoff=${Math.max(job.intervalMs, 30_000)}ms`
          this.addLog(job, `PORTAL_NOT_OPEN BACKOFF | next probe in ${Math.max(job.intervalMs, 30_000)}ms`, 'warning')
        }
        this.publish()
      }
      const retryDelay = job.lastMessage?.includes('PORTAL_NOT_OPEN')
        ? Math.max(job.intervalMs, 30_000)
        : job.intervalMs
      if (number < job.maxAttempts && !job.stopped) await wait(retryDelay)
    }
    if (!job.stopped) {
      job.status = 'exhausted'
      job.completedAt = new Date().toISOString()
      this.addLog(job, 'Maximum attempts reached', 'error')
      this.publish()
    }
  }

  async findCandidate(target, onTrace = () => {}) {
    const portal = await this.discover()
    onTrace(`GET ${diagnosticPath(portal.sourceUrl)} | authenticated=true | blocks=${portal.blocks.length} | available=${portal.available}${portal.message ? ` | server=${portal.message}` : ''}`)
    if (!portal.available) {
      throw new Error(`PORTAL_NOT_OPEN | endpoint=${diagnosticPath(portal.sourceUrl)} | authenticated=true | blocks=0 | server=${portal.message || 'no selection block returned'}`)
    }
    let classesSeen = 0
    const candidates = []
    for (const block of portal.blocks) {
      onTrace(`POST ${diagnosticPath(COURSE_URL)} | block=${block.id} | category=${block.categoryCode} | target=${target.courseCode || target.title}`)
      const result = await this.candidates(block.id, { courseCode: target.courseCode, title: target.title }, { page: 1, pageSize: 100 })
      onTrace(`CATALOG RESULT | block=${block.id} | courses=${result.total} | classes=${result.candidates.length}`)
      classesSeen += result.candidates.length
      candidates.push(...result.candidates)
    }
    const matched = matchPublishedCandidate(candidates, target)
    if (matched) return matched
    throw new Error(`CLASS_NOT_FOUND | target=${target.courseCode || target.title} | requestedClass=${target.classId || target.className || 'unspecified'} | blocks=${portal.blocks.length} | candidateClasses=${classesSeen}`)
  }
}

export const COURSE_SELECTION_URLS = {
  index: INDEX_URL,
  display: DISPLAY_URL,
  catalog: COURSE_URL,
  classes: CLASS_URL,
  select: SELECT_URL,
  schoolSchedule: SCHOOL_SCHEDULE_INDEX_URL,
}
