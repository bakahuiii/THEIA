import { AuthRequiredError } from './source-client.mjs'
import { cachedSchoolScheduleResult, SCHOOL_SCHEDULE_PARSER_VERSION } from './data-catalog.mjs'
import { normalizeText, parseAcademicTerm } from './util.mjs'
import {
  selectionTerm,
  parseJson,
  payloadItems,
  reportedTotal,
  meaningfulFields,
  normalizeSchoolSchedule,
} from './course-selection-helpers.mjs'

const SCHOOL_SCHEDULE_INDEX_URL = new URL(
  'design/viewFunc_cxDesignFuncPageIndex.html?gnmkdm=N219933',
  'https://jwglxt.buct.edu.cn/jwglxt/',
).toString()
const SCHOOL_SCHEDULE_URL = new URL(
  'design/funcData_cxFuncDataList.html?func_widget_guid=5920CCA8B9E61FBAE0530100007F0493',
  'https://jwglxt.buct.edu.cn/jwglxt/',
).toString()
const SCHOOL_SCHEDULE_FETCH_SIZE = 500
const SCHOOL_SCHEDULE_ITEM_LIMIT = 10_000

export async function schoolSchedule(query = {}) {
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

