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
const CLASS_URL = new URL('xsxk/zzxkyzbjk_cxJxbWithKchZzxkYzb.html?gnmkdm=N253512', BASE).toString()
const CLASS_COMPONENT_URL = new URL('xsxk/zzxkyzb_xkZyZzxkYzbZjxb.html?gnmkdm=N253512', BASE).toString()
// The `jk_` variant is the endpoint used by Zhengfang's saveCourse() flow.
// The similarly named endpoint without that prefix is not the submit route.
const SELECT_URL = new URL('xsxk/zzxkyzbjk_xkBcZyZzxkYzb.html?gnmkdm=N253512', BASE).toString()
const SCHOOL_SCHEDULE_INDEX_URL = new URL('design/viewFunc_cxDesignFuncPageIndex.html?gnmkdm=N219933', BASE).toString()
const SCHOOL_SCHEDULE_URL = new URL('design/funcData_cxFuncDataList.html?func_widget_guid=5920CCA8B9E61FBAE0530100007F0493', BASE).toString()
const SCHOOL_SCHEDULE_FETCH_SIZE = 500
const SCHOOL_SCHEDULE_ITEM_LIMIT = 10_000
// A target lookup may need to fall back to the unfiltered catalog when a
// Zhengfang deployment ignores its search fields. Keep that fallback bounded
// so a malformed total cannot turn one lookup into an unbounded crawl.
const COURSE_SELECTION_MAX_SCAN_PAGES = 50
const JOB_LOG_LIMIT = 80
const SELECTION_STAGE_FIELDS = ['iskxk', 'isinxksj', 'isInylsj', 'xksjxskz']
const SELECTION_CLOSED_PATTERN = /(?:\u4e0d\u5c5e\u4e8e\u9009\u8bfe\u9636\u6bb5|\u5f53\u524d\u65f6\u95f4\u4e0d\u53ef\u9009\u8bfe|\u65f6\u95f4\u4e0d\u53ef\u9009\u8bfe|\u9009\u8bfe\u5df2\u7ed3\u675f|\u9009\u8bfe\u672a\u5f00\u59cb|\u9009\u8bfe\u9636\u6bb5(?:\u672a\u5f00\u59cb|\u5df2\u7ed3\u675f|\u5df2\u5173\u95ed|\u5173\u95ed)|\u4e0d\u53ef\u9009\u8bfe)/u

// Zhengfang's catalog endpoint validates the page context, not just the
// selected course block. Keep this list aligned with zzxkYzb.js.
const CATALOG_CONTEXT_FIELDS = [
  'rwlx', 'xklc', 'xkly', 'bklx_id', 'sfkkjyxdxnxq', 'kzkcgs',
  'xqh_id', 'jg_id', 'njdm_id_1', 'zyh_id_1', 'gnjkxdnj',
  'zyh_id', 'zyfx_id', 'njdm_id', 'bh_id', 'bjgkczxbbjwcx',
  'xbm', 'xslbdm', 'mzm', 'xz', 'ccdm', 'xsbj', 'sfkknj',
  'sfkkzy', 'kzybkxy', 'sfznkx', 'zdkxms', 'sfkxq', 'bhbcyxkjxb',
  'sfkcfx', 'kkbk', 'kkbkdj', 'bklbkcj', 'sfkgbcx', 'sfrxtgkcxd',
  'xkkz_xh', 'tykczgxdcs', 'xkxnm', 'xkxqm', 'kklxdm', 'bbhzxjxb',
  'zxgbxkkg', 'xkkz_id', 'rlkz', 'xkzgbj', 'kspage', 'jspage',
]

const CLASS_CONTEXT_FIELDS = [
  'rwlx', 'xklc', 'xkly', 'bklx_id', 'sfkkjyxdxnxq', 'kzkcgs',
  'xqh_id', 'jg_id', 'zyh_id', 'zyfx_id', 'txbsfrl',
  'njdm_id', 'bh_id', 'xbm', 'xslbdm', 'mzm', 'xz', 'ccdm', 'xsbj',
  'sfkknj', 'gnjkxdnj', 'sfkkzy', 'kzybkxy', 'sfznkx', 'zdkxms',
  'sfkxq', 'bhbcyxkjxb', 'sfkcfx', 'bbhzxjxb', 'kkbk', 'kkbkdj',
  'bklbkcj', 'xkxnm', 'xkxqm', 'xkxskcgskg', 'rlkz', 'cdrlkz',
  'cxcykclxxskg', 'rlzlkz', 'kklxdm', 'kch_id', 'jxbzcxskg',
  'zxgbxkkg', 'xkkz_id', 'cxbj', 'fxbj',
]

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

function classComponentOperationIds(body) {
  const payload = parseJson(body)
  const rows = payloadItems(payload)
  const fromJson = rows
    .map((row) => firstField(caseInsensitiveFields(row), 'select_do_jxb', 'do_jxb_id', 'jxb_ids', 'operationId'))
    .map((value) => normalizeText(value))
    .filter(Boolean)
  if (fromJson.length) return [...new Set(fromJson)]
  const $ = cheerio.load(String(body || ''))
  const fromHtml = $('input[name="select_do_jxb"], input[name="do_jxb_id"], input[name="jxb_ids"]')
    .map((_index, node) => normalizeText($(node).attr('value') || $(node).val()))
    .get()
    .filter(Boolean)
  return [...new Set(fromHtml)]
}

function safeServerMessage(value, limit = 240) {
  return normalizeText(value)
    .replace(/(JSESSIONID|token|cookie|authorization|password|passwd|pwd|xkkz_xh|jxb_ids|jcxx_id)(?:["']?)\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;}"']+)/gi, '$1=[redacted]')
    .slice(0, limit)
}

function serverResponseDetail(payload) {
  const message = safeServerMessage(
    payload?.message || payload?.msg || payload?.data?.message || payload?.data?.msg || payload?.error,
  ) || null
  const rawSignal = payload?.flag ?? payload?.success ?? payload?.status ?? payload?.code
  const signal = rawSignal === null || rawSignal === undefined || rawSignal === ''
    ? null
    : safeServerMessage(rawSignal, 64)
  return { message, signal }
}

function formatServerResponseDetail(detail) {
  const parts = [
    detail?.signal ? `signal=${detail.signal}` : null,
    detail?.message ? `server=${detail.message}` : null,
  ].filter(Boolean)
  return parts.length ? ` | ${parts.join(' | ')}` : ''
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

function readFormFields(html) {
  const $ = cheerio.load(html)
  const values = {}
  $('input, select, textarea').each((_index, node) => {
    const field = $(node)
    const name = field.attr('name') || field.attr('id')
    if (!name) return
    const type = String(field.attr('type') || '').toLocaleLowerCase()
    if (['checkbox', 'radio'].includes(type) && !field.is(':checked')) return
    values[name] = String(field.attr('value') ?? field.val() ?? '')
  })
  // Some Zhengfang versions render the selector as an unnamed element and
  // assign its value in the page bootstrap script. Preserve those values so
  // API reads match the browser's `$(selector).val()` calls.
  for (const field of ['jg_id_1', 'njdm_id_1', 'zyh_id_1', 'xkkz_xh', 'xkkz_id', 'kklxdm']) {
    if (normalizeText(values[field])) continue
    const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const patterns = [
      new RegExp(`(?:#|\\$\\(\\s*['\"]#)${escaped}(?:['\"]\\s*\\))?[^;\\n]{0,80}?(?:\\.val\\(|value\\s*[:=])\\s*['\"]([^'\"]+)`, 'i'),
      new RegExp(`(?:first|default)[A-Z][A-Za-z]*${escaped.replace(/_/g, '[^A-Za-z0-9_]*_')}[^'\"]{0,40}['\"]([^'\"]+)`, 'i'),
    ]
    for (const pattern of patterns) {
      const match = String(html || '').match(pattern)
      if (normalizeText(match?.[1])) {
        values[field] = match[1]
        break
      }
    }
  }
  // The initial tab is bootstrapped from these aliases before the official
  // script writes the canonical fields. Preserve that fallback when a
  // fragment is captured before the bootstrap mutation is reflected in HTML.
  const aliases = {
    kklxdm: ['firstKklxdm'],
    xkkz_id: ['firstXkkzId'],
    njdm_id: ['firstNjdmId'],
    zyh_id: ['firstZyhId'],
    xkkz_xh: ['firstXkkzXh'],
  }
  for (const [field, candidates] of Object.entries(aliases)) {
    if (normalizeText(values[field])) continue
    const fallback = candidates.map((candidate) => values[candidate]).find((value) => normalizeText(value))
    if (fallback !== undefined) values[field] = fallback
  }
  return values
}

function binaryFlag(value) {
  const normalized = normalizeText(value).toLocaleLowerCase()
  if (!normalized) return null
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false
  return null
}

function selectionNotice(html) {
  const $ = cheerio.load(html)
  const candidates = $('.nodata, .alert, [role="alert"], .panel-body')
    .map((_index, node) => normalizeText($(node).text()))
    .get()
    .filter(Boolean)
  const matched = candidates.find((text) => SELECTION_CLOSED_PATTERN.test(text))
  if (matched) return safeServerMessage(matched)
  const visible = $('body').clone().find('script,style,noscript').remove().end().text()
  const visibleText = normalizeText(visible)
  const fallback = visibleText.match(/[^.!?\u3002\uff01\uff1f]{0,80}(?:\u4e0d\u5c5e\u4e8e\u9009\u8bfe\u9636\u6bb5|\u5f53\u524d\u65f6\u95f4\u4e0d\u53ef\u9009\u8bfe|\u65f6\u95f4\u4e0d\u53ef\u9009\u8bfe|\u9009\u8bfe\u5df2\u7ed3\u675f|\u9009\u8bfe\u672a\u5f00\u59cb|\u9009\u8bfe\u9636\u6bb5(?:\u672a\u5f00\u59cb|\u5df2\u7ed3\u675f|\u5df2\u5173\u95ed|\u5173\u95ed)|\u4e0d\u53ef\u9009\u8bfe)[^.!?\u3002\uff01\uff1f]{0,160}/u)
  return fallback ? safeServerMessage(fallback[0]) : null
}

function selectionStage(html, context, blockCount) {
  const flags = Object.fromEntries(SELECTION_STAGE_FIELDS.map((field) => [field, binaryFlag(context?.[field])]))
  const notice = selectionNotice(html)
  const gateClosed = flags.iskxk === false
  const windowClosed = [flags.isinxksj, flags.isInylsj, flags.xksjxskz].every((flag) => flag === false)
  const windowOpen = [flags.isinxksj, flags.isInylsj, flags.xksjxskz].some((flag) => flag === true)
  const textClosed = Boolean(notice && SELECTION_CLOSED_PATTERN.test(notice))
  const selectionOpen = !gateClosed && !windowClosed && !textClosed
  const hasExplicitGate = SELECTION_STAGE_FIELDS.some((field) => flags[field] !== null)
  const state = gateClosed || windowClosed || textClosed
    ? 'closed'
    : flags.iskxk === true || windowOpen || (!hasExplicitGate && blockCount > 0)
      ? 'open'
      : 'unknown'
  const available = state === 'open' && blockCount > 0
  return {
    state,
    selectionOpen: available,
    flags,
    message: available ? null : notice || (state === 'closed' ? 'Course-selection stage is closed' : 'No active course-selection block is currently published'),
  }
}

function portalNotOpenError(portal) {
  const error = new Error(`PORTAL_NOT_OPEN | endpoint=${diagnosticPath(portal?.sourceUrl)} | authenticated=true | blocks=${portal?.blocks?.length || 0} | selectionState=${portal?.selectionState || 'unknown'} | server=${portal?.message || 'course-selection stage is closed'}`)
  error.code = 'PORTAL_NOT_OPEN'
  return error
}

function selectionControlId(blockId, context) {
  return normalizeText(blockId) || normalizeText(context?.xkkz_id)
}

function selectionCategoryCode(categoryCode, context) {
  return normalizeText(categoryCode) || normalizeText(context?.kklxdm)
}

function valueOrEmpty(value) {
  return value === undefined || value === null ? '' : String(value)
}

function protocolForm(context, fields) {
  return Object.fromEntries(fields.map((field) => [field, valueOrEmpty(context[field])]))
}

function protocolState(context, fields) {
  return Object.fromEntries(fields.map((field) => [field, Boolean(normalizeText(context[field]))]))
}

function normalizeSelectionContext(fields) {
  const context = { ...(fields || {}) }
  // Zhengfang renders the college selector as `jg_id_1`, while its request
  // scripts submit that value under the protocol key `jg_id`.
  if (!normalizeText(context.jg_id) && normalizeText(context.jg_id_1)) {
    context.jg_id = context.jg_id_1
  }
  return context
}

function addConditionalCatalogFields(query, context) {
  if (normalizeText(context.jxbzbkg) === '1') query.jxbzb = valueOrEmpty(context.jxbzb)
  if (normalizeText(context.jxbzhkg) === '1') query.zh = valueOrEmpty(context.zh)
  return query
}

function addCatalogSearchFields(query, target) {
  const searchTerm = normalizeText(target?.courseCode || target?.title)
  if (!searchTerm) return query
  // Zhengfang's search box serializes its visible input into these fields;
  // sending `searchInput` alone is ignored by the catalog endpoint.
  query.filterKey = 'all'
  query['filter_list[0]'] = searchTerm
  return query
}

function diagnosticRequestValues(values, fields) {
  const sensitiveFields = new Set(['jxb_ids', 'jcxx_id', 'xkkz_xh'])
  return Object.fromEntries(fields.map((field) => {
    const value = normalizeText(values?.[field])
    return [field, sensitiveFields.has(field) ? (value ? '[present]' : null) : value || null]
  }))
}

function parseBlocks(html) {
  const $ = cheerio.load(html)
  const seen = new Set()
  const blocks = []
  $('a[role="tab"], a[onclick*="xkkz_id"]').each((_index, node) => {
    const element = $(node)
    const args = [...String(element.attr('onclick') || '').matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1].trim())
    const [categoryCode, controlId, gradeId, majorId, controlSequence] = args
    if (!categoryCode || !controlId || seen.has(controlId)) return
    seen.add(controlId)
    blocks.push({
      id: controlId,
      categoryCode,
      title: normalizeText(element.text()) || categoryCode,
      gradeId: normalizeText(gradeId) || null,
      majorId: normalizeText(majorId) || null,
      controlSequence: normalizeText(controlSequence) || null,
    })
  })
  return blocks
}

function parseTeacher(value) {
  const text = normalizeText(value)
  const match = text.match(/\/([^/]+)\//)
  return match ? normalizeText(match[1]) : text || null
}

function normalizeCandidate(record, { block, term, sourceUrl, context = {} }) {
  const fields = caseInsensitiveFields(record)
  const courseId = normalizeText(firstField(fields, 'kch_id', 'kch', 'courseId'))
  const classId = normalizeText(firstField(fields, 'jxb_id', 'classId'))
  const className = normalizeText(firstField(fields, 'jxbmc', 'className'))
  // `jxb_id` identifies the visible teaching-class row.  It is not the
  // operation token accepted by the submit endpoint; only accept an explicit
  // do_jxb_id/jxb_ids/operationId returned by the class endpoint.
  const operationId = normalizeText(firstField(fields, 'do_jxb_id', 'jxb_ids', 'operationId'))
  const title = normalizeText(firstField(fields, 'kcmc', 'courseName', 'title'))
  if (!courseId || !operationId || !title) return null
  const jxbzls = normalizeText(firstField(fields, 'jxbzls'))
  const capacity = parseNumber(firstField(fields, 'jxbrl', 'jxbrs', 'capacity'))
  const enrolled = parseNumber(firstField(fields, 'yxzrs', 'selected_number', 'enrolled'))
  const selectionFields = [
    'rwlx', 'rlkz', 'cdrlkz', 'rlzlkz', 'xxkbj', 'cxbj', 'qz', 'jcxx_id',
  ]
  const selectionRecord = fields
  const selectionContext = caseInsensitiveFields(context)
  const selection = Object.fromEntries(selectionFields.map((field) => {
    const value = firstField(selectionRecord, field)
    const fallback = value === null ? firstField(selectionContext, field) : value
    return [field, fallback === null ? null : String(fallback)]
  }))
  selection.kcmc = title
  return {
    id: stableId('course-selection-candidate', term?.id, block.id, courseId, operationId),
    courseId,
    classId: classId || null,
    className: className || null,
    jxbzls: jxbzls || null,
    operationId,
    title,
    courseCode: normalizeText(firstField(fields, 'kch', 'courseCode')) || courseId,
    teacher: parseTeacher(firstField(fields, 'jsxx', 'jsxm', 'teacher')),
    credits: parseNumber(firstField(fields, 'xf', 'credits')),
    location: normalizeText(firstField(fields, 'jxdd', 'cdmc', 'location')) || null,
    time: normalizeText(firstField(fields, 'sksj', 'time')) || null,
    capacity,
    enrolled,
    remainingSeats: Number.isFinite(capacity) && Number.isFinite(enrolled) ? Math.max(0, capacity - enrolled) : null,
    // Keep only the non-secret course flags needed to reproduce the official
    // submit request. The journal deliberately strips this internal context.
    selectionContext: selection,
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
  const courseId = normalizeText(firstField(fields, 'kch_id', 'courseId')) || courseCode
  const classId = normalizeText(firstField(fields, 'jxb_id', 'jxbId', 'teachingClassId'))
  const className = normalizeText(firstField(fields, 'jxbmc', 'className'))
  const operationId = normalizeText(firstField(fields, 'do_jxb_id', 'operationId', 'jxb_ids'))
  const categoryCode = normalizeText(firstField(fields, 'kklxdm', 'categoryCode'))
  const combinedClassInfo = combinedClassInfoOf(fields)
  const teacher = firstField(fields, 'rkjs', 'js', 'teacher')
  const time = firstField(fields, 'sksj', 'time')
  if (!title) return null
  const selectionFields = ['rwlx', 'rlkz', 'cdrlkz', 'rlzlkz', 'xxkbj', 'cxbj', 'qz', 'jcxx_id', 'xklc', 'xkly', 'kklxdm']
  const selectionContext = Object.fromEntries(selectionFields
    .map((field) => [field, firstField(fields, field)])
    .filter(([, value]) => value !== null && value !== undefined && String(value) !== '')
    .map(([field, value]) => [field, String(value)]))
  if (!selectionContext.kcmc) selectionContext.kcmc = title
  return {
    id: classId
      ? stableId('school-schedule', term.id, classId, combinedClassInfo)
      : stableId('school-schedule', term.id, courseCode || title, className, combinedClassInfo, teacher, time),
    termId: term.id,
    classId: classId || null,
    courseId: courseId || null,
    operationId: operationId || null,
    categoryCode: categoryCode || null,
    jxbzls: normalizeText(firstField(fields, 'jxbzls')) || null,
    selectionContext,
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
  const fields = caseInsensitiveFields(course)
  const candidateCodes = ['kch', 'kch_id', 'courseId', 'courseCode']
    .map((field) => firstField(fields, field))
    .map((value) => normalizeText(value).toUpperCase())
    .filter(Boolean)
  const candidateTitle = normalizeText(firstField(fields, 'kcmc', 'courseName', 'title'))
  return (code && candidateCodes.includes(code)) || (title && candidateTitle === title)
}

function schoolScheduleCategoryCode(item) {
  const explicit = normalizeText(item?.categoryCode)
  if (explicit) return explicit
  const text = [item?.category, item?.nature, item?.affiliation, item?.title]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(' ')
  if (/(?:体育|运动)/u.test(text)) return '06'
  if (/(?:网络|慕课|在线)/u.test(text)) return '11'
  if (/(?:素质教育|通识|公共基础)/u.test(text)) return '10'
  if (/(?:专业|主修|必修|选修)/u.test(text)) return '01'
  return null
}

function schoolScheduleBlockScore(item, block) {
  const preferredCode = schoolScheduleCategoryCode(item)
  if (preferredCode && preferredCode === normalizeText(block?.categoryCode)) return 100
  const blockText = normalizeText(block?.title)
  const itemText = [item?.category, item?.nature, item?.affiliation].map((value) => normalizeText(value)).filter(Boolean).join(' ')
  if (/(?:体育|运动)/u.test(itemText) && /体育/u.test(blockText)) return 80
  if (/(?:网络|慕课|在线)/u.test(itemText) && /网络/u.test(blockText)) return 80
  if (/(?:素质教育|通识|公共基础)/u.test(itemText) && /(?:素质|通识)/u.test(blockText)) return 80
  if (/(?:专业|主修|必修|选修)/u.test(itemText) && /(?:主修|专业)/u.test(blockText)) return 80
  return 0
}

function schoolScheduleBlocksForItem(item, portal) {
  return [...(portal?.blocks || [])]
    .sort((left, right) => schoolScheduleBlockScore(item, right) - schoolScheduleBlockScore(item, left))
}

function schoolScheduleCourseRecord(item) {
  if (!item || typeof item !== 'object') return null
  const fields = caseInsensitiveFields(item)
  const selectionContext = item.selectionContext && typeof item.selectionContext === 'object'
    ? caseInsensitiveFields(item.selectionContext)
    : new Map()
  const courseId = normalizeText(firstField(fields, 'courseId', 'kch_id', 'courseCode', 'kch'))
  const courseCode = normalizeText(firstField(fields, 'courseCode', 'kch')) || courseId
  const title = normalizeText(firstField(fields, 'title', 'courseName', 'kcmc'))
  if (!courseId || !courseCode || !title) return null
  const record = {
    kch_id: courseId,
    kch: courseCode,
    kcmc: title,
    xf: firstField(fields, 'credits', 'xf'),
    jxbzls: firstField(fields, 'jxbzls'),
  }
  // Preserve the small set of flags that can affect the class lookup. They
  // are read from the current display context first, with cached row values
  // only as a fallback.
  for (const field of ['rwlx', 'rlkz', 'cdrlkz', 'rlzlkz', 'xxkbj', 'cxbj', 'qz', 'jcxx_id', 'xklc', 'xkly', 'kklxdm']) {
    const value = firstField(selectionContext, field) ?? firstField(fields, field)
    if (value !== null && value !== undefined && String(value) !== '') record[field] = String(value)
  }
  return record
}

function schoolScheduleFallbackItems(items, target) {
  const matchingItems = (Array.isArray(items) ? items : []).filter((item) => courseMatchesTarget(item, target))
  if (target?.classId) {
    const exact = matchingItems.filter((item) => equalTargetText(item.classId, target.classId))
    if (exact.length) return exact
  }
  if (target?.className) {
    const exact = matchingItems.filter((item) => equalTargetText(item.className, target.className))
    if (exact.length) return exact
  }
  return matchingItems
}

function responseOutcome(body) {
  const payload = parseJson(body)
  const detail = serverResponseDetail(payload)
  const message = detail.message || safeServerMessage(String(body || '').slice(0, 400))
  const signal = String(detail.signal || '').toLowerCase()
  const hasFailureMessage = /\u5931\u8d25|\u672a\u9009\u4e0a|\u5df2\u6ee1|\u51b2\u7a81|\u9519\u8bef/u.test(message)
  const hasFailureSignal = ['0', 'false', 'fail', 'failed', 'error', '-1', '500'].includes(signal)
  const hasSuccessMessage = /\u6210\u529f|\u5df2\u9009/u.test(message)
  return {
    // Zhengfang treats flag 3 (free-credit limit reached) and flag 6
    // (already selected) as successful terminal states in saveCourse().
    success: !hasFailureSignal && !hasFailureMessage && (['1', '3', '6', 'true', 'success', '1000', '200'].includes(signal) || hasSuccessMessage),
    message: message || 'Selection endpoint returned no message',
    raw: normalizeText(String(body || '')).replace(/(JSESSIONID|token|cookie|xkkz_xh|jxb_ids|jcxx_id)(?:["']?)\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;}"']+)/gi, '$1=[redacted]').slice(0, 480),
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
    this.addLog(job, `TASK RUNNING | transport=${this.courseSelectionClientFactory ? 'JWGLXT API' : 'browser session'}`)
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
    const flags = Object.entries(portal.selectionFlags || {})
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => `${key}=${value ? '1' : '0'}`)
      .join(',')
    onTrace(`GET ${diagnosticPath(portal.sourceUrl)} | authenticated=true | blocks=${portal.blocks.length} | available=${portal.available} | selectionState=${portal.selectionState || 'unknown'}${flags ? ` | flags=${flags}` : ''}${portal.message ? ` | server=${portal.message}` : ''}`)
    if (!portal.available) {
      throw portalNotOpenError(portal)
    }
    let classesSeen = 0
    const candidates = []
    const seenCandidateIds = new Set()
    const addResult = (result, label) => {
      onTrace(`${label} | courses=${result.courseCount ?? 0} | classes=${result.candidates.length}${formatServerResponseDetail({ signal: result.responseSignal, message: result.message })}`)
      classesSeen += result.candidates.length
      for (const candidate of result.candidates) {
        if (seenCandidateIds.has(candidate.id)) continue
        seenCandidateIds.add(candidate.id)
        candidates.push(candidate)
      }
    }
    let scheduleFallbackAttempted = false
    const trySchoolScheduleFallback = async () => {
      if (scheduleFallbackAttempted) return null
      scheduleFallbackAttempted = true
      const scheduleScope = target?.termId || portal.term?.id
      const cachedSchedule = scheduleScope
        ? cachedSchoolScheduleResult(this.getState()?.dataCatalog, { termId: scheduleScope })
        : null
      const scheduleItems = cachedSchedule?.complete === true
        ? schoolScheduleFallbackItems(cachedSchedule.items, target)
        : []
      if (!scheduleItems.length) {
        onTrace(cachedSchedule?.complete === true
          ? `SCHOOL SCHEDULE CACHE | term=${scheduleScope} | matchingRows=0 | complete=true`
          : `SCHOOL SCHEDULE CACHE | term=${scheduleScope || 'unknown'} | matchingRows=0 | complete=false-or-missing`)
        return null
      }
      onTrace(`SCHOOL SCHEDULE CACHE | term=${scheduleScope} | matchingRows=${scheduleItems.length} | complete=true`)
      for (const item of scheduleItems) {
        const course = schoolScheduleCourseRecord(item)
        if (!course) {
          onTrace(`SCHOOL SCHEDULE SKIP | class=${item.classId || 'unknown'} | reason=missing-course-identity`)
          continue
        }
        for (const block of schoolScheduleBlocksForItem(item, portal)) {
          onTrace(`SCHOOL SCHEDULE CLASS LOOKUP | course=${course.kch || course.kch_id} | class=${item.classId || item.className || 'unspecified'} | block=${block.id} | category=${block.categoryCode}`)
          const result = await this.candidates(block.id, target, {
            page: 1,
            pageSize: 100,
            search: false,
            schoolScheduleItem: item,
          })
          addResult(result, `SCHOOL SCHEDULE CLASS RESULT | block=${block.id} | course=${course.kch || course.kch_id}`)
          const fallbackMatched = matchPublishedCandidate(candidates, target)
          if (fallbackMatched) return fallbackMatched
        }
      }
      return null
    }
    // Prefer an exact school-wide row when one is available. This avoids
    // dropping an opaque kch_id into a course-name search and makes hidden
    // rows resolvable even when the published catalog omits them.
    if (target?.courseId) {
      const directMatch = await trySchoolScheduleFallback()
      if (directMatch) return directMatch
    }
    for (const block of portal.blocks) {
      onTrace(`POST ${diagnosticPath(COURSE_URL)} | block=${block.id} | category=${block.categoryCode} | target=${target.courseCode || target.title}`)
      const result = await this.candidates(block.id, target, { page: 1, pageSize: 100 })
      addResult(result, `CATALOG RESULT | block=${block.id} | search=target`)
      let matched = matchPublishedCandidate(candidates, target)
      if (matched) return matched

      // A complete school-wide schedule can identify a hidden course without
      // scanning every catalog page. Try that bounded, exact lookup once before
      // falling back to the slower unfiltered scan.
      matched = await trySchoolScheduleFallback()
      if (matched) return matched

      // Some Zhengfang deployments silently ignore filterKey/filter_list.
      // Retry the block without search and scan a bounded number of pages;
      // candidates() still filters locally, so class details are requested
      // only for rows matching the requested course.
      if (target?.courseCode || target?.title) {
        const seenPageSignatures = new Set()
        const seenCourseKeys = new Set()
        let scannedCourseCount = 0
        for (let page = 1; page <= COURSE_SELECTION_MAX_SCAN_PAGES; page += 1) {
          const pageResult = await this.candidates(block.id, target, { page, pageSize: 100, search: false })
          const signature = pageResult.courseKeys?.join('|') || `count:${pageResult.courseCount ?? 0}`
          if (seenPageSignatures.has(signature)) {
            onTrace(`CATALOG SCAN STOP | block=${block.id} | page=${page} | reason=repeated-page`)
            break
          }
          seenPageSignatures.add(signature)
          if (pageResult.courseKeys?.length) {
            for (const key of pageResult.courseKeys) seenCourseKeys.add(key)
            scannedCourseCount = seenCourseKeys.size
          } else {
            scannedCourseCount += pageResult.courseCount || 0
          }
          addResult(pageResult, `CATALOG SCAN | block=${block.id} | page=${page} | search=none`)
          matched = matchPublishedCandidate(candidates, target)
          if (matched) return matched
          if (!pageResult.courseCount) break
          if (pageResult.totalKnown && scannedCourseCount >= pageResult.total) break
        }
      }
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
  classComponents: CLASS_COMPONENT_URL,
  select: SELECT_URL,
  schoolSchedule: SCHOOL_SCHEDULE_INDEX_URL,
}
