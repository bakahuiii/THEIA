import { compactError, stableId } from '../util.mjs'
import {
  JWGLXT_EXTRA_DOMAINS,
  normalizeJwglxtExtraDomain,
  normalizeFormOptions,
  parseJwglxtExtraJson,
  parseJwglxtExtraPage,
} from '../jwglxt-extra.mjs'
import {
  assertValidQueryPayload,
  buildFreeClassroomQuery,
  buildWeeklyScheduleQuery,
  decorateExtraValue,
  EXTRA_DETAIL_LIMIT,
  EXTRA_GRADE_DETAIL_LIMIT,
  EXTRA_QUERY_CONCURRENCY,
  EXTRA_QUERY_LIMIT,
  extraPageForm,
  filterPlanRows,
  funcWidgetGuidFromPage,
  gradeTermLabel,
  inputValueById,
  mapWithConcurrency,
  mergeExtraDomainValues,
  pickValues,
  queryModel,
  readOnlyExtraQuery,
  safeTermValues,
  selectableGradeTerms,
  selectedPlanFilters,
} from './jwglxt-helpers.mjs'

const BASE = 'https://jwglxt.buct.edu.cn/jwglxt/'

export const JWGLXT_EXTRA_METHODS = {
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
  },

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
  },
}
