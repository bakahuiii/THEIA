import * as cheerio from 'cheerio'
import { compactError, normalizeText, parseNumber, stableId } from './util.mjs'

const SELECTION_STAGE_FIELDS = ['iskxk', 'isinxksj', 'isInylsj', 'xksjxskz']
const SELECTION_CLOSED_PATTERN = /(?:\u4e0d\u5c5e\u4e8e\u9009\u8bfe\u9636\u6bb5|\u5f53\u524d\u65f6\u95f4\u4e0d\u53ef\u9009\u8bfe|\u65f6\u95f4\u4e0d\u53ef\u9009\u8bfe|\u9009\u8bfe\u5df2\u7ed3\u675f|\u9009\u8bfe\u672a\u5f00\u59cb|\u9009\u8bfe\u9636\u6bb5(?:\u672a\u5f00\u59cb|\u5df2\u7ed3\u675f|\u5df2\u5173\u95ed|\u5173\u95ed)|\u4e0d\u53ef\u9009\u8bfe)/u

export function selectionTerm(term) {
  const code = String(term?.term || '').trim()
  if (['3', '12', '16'].includes(code)) return code
  if (code === '1') return '3'
  if (code === '2') return '12'
  return code
}

export function parseJson(body) {
  try { return JSON.parse(String(body || '')) } catch { return null }
}

export function classComponentOperationIds(body) {
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

export function safeServerMessage(value, limit = 240) {
  return normalizeText(value)
    .replace(/(JSESSIONID|token|cookie|authorization|password|passwd|pwd|xkkz_xh|jxb_ids|jcxx_id)(?:["']?)\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;}"']+)/gi, '$1=[redacted]')
    .slice(0, limit)
}

export function serverResponseDetail(payload) {
  const message = safeServerMessage(
    payload?.message || payload?.msg || payload?.data?.message || payload?.data?.msg || payload?.error,
  ) || null
  const rawSignal = payload?.flag ?? payload?.success ?? payload?.status ?? payload?.code
  const signal = rawSignal === null || rawSignal === undefined || rawSignal === ''
    ? null
    : safeServerMessage(rawSignal, 64)
  return { message, signal }
}

export function formatServerResponseDetail(detail) {
  const parts = [
    detail?.signal ? `signal=${detail.signal}` : null,
    detail?.message ? `server=${detail.message}` : null,
  ].filter(Boolean)
  return parts.length ? ` | ${parts.join(' | ')}` : ''
}

export function payloadItems(payload) {
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

export function reportedTotal(payload) {
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

export function meaningfulFields(input) {
  return Object.fromEntries(Object.entries(input || {}).filter(([, value]) => value !== undefined && value !== null && String(value) !== ''))
}

export function caseInsensitiveFields(record) {
  const fields = new Map()
  for (const [key, value] of Object.entries(record && typeof record === 'object' ? record : {})) {
    const normalizedKey = key.toLocaleLowerCase()
    if (!fields.has(normalizedKey)) fields.set(normalizedKey, value)
  }
  return fields
}

export function firstField(fields, ...names) {
  for (const name of names) {
    const value = fields.get(String(name).toLocaleLowerCase())
    if (value !== undefined && value !== null && value !== '') return value
  }
  return null
}

export function combinedClassInfoOf(fields) {
  const explicit = firstField(fields, 'hbxx', 'combinedClassInfo', 'classComposition')
  const normalizedExplicit = normalizeText(explicit)
  if (normalizedExplicit) return normalizedExplicit
  // Zhengfang calls this field jxbzc (教学班组成). Week ranges use zcd.
  return normalizeText(firstField(fields, 'jxbzc', 'teachingClassComposition', 'classCompositionText'))
}

export function readFormFields(html) {
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

export function binaryFlag(value) {
  const normalized = normalizeText(value).toLocaleLowerCase()
  if (!normalized) return null
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false
  return null
}

export function selectionNotice(html) {
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

export function selectionStage(html, context, blockCount) {
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

export function portalNotOpenError(portal) {
  const error = new Error(`PORTAL_NOT_OPEN | endpoint=${diagnosticPath(portal?.sourceUrl)} | authenticated=true | blocks=${portal?.blocks?.length || 0} | selectionState=${portal?.selectionState || 'unknown'} | server=${portal?.message || 'course-selection stage is closed'}`)
  error.code = 'PORTAL_NOT_OPEN'
  return error
}

export function selectionControlId(blockId, context) {
  return normalizeText(blockId) || normalizeText(context?.xkkz_id)
}

export function selectionCategoryCode(categoryCode, context) {
  return normalizeText(categoryCode) || normalizeText(context?.kklxdm)
}

export function valueOrEmpty(value) {
  return value === undefined || value === null ? '' : String(value)
}

export function protocolForm(context, fields) {
  return Object.fromEntries(fields.map((field) => [field, valueOrEmpty(context[field])]))
}

export function protocolState(context, fields) {
  return Object.fromEntries(fields.map((field) => [field, Boolean(normalizeText(context[field]))]))
}

export function normalizeSelectionContext(fields) {
  const context = { ...(fields || {}) }
  // Zhengfang renders the college selector as `jg_id_1`, while its request
  // scripts submit that value under the protocol key `jg_id`.
  if (!normalizeText(context.jg_id) && normalizeText(context.jg_id_1)) {
    context.jg_id = context.jg_id_1
  }
  return context
}

export function addConditionalCatalogFields(query, context) {
  if (normalizeText(context.jxbzbkg) === '1') query.jxbzb = valueOrEmpty(context.jxbzb)
  if (normalizeText(context.jxbzhkg) === '1') query.zh = valueOrEmpty(context.zh)
  return query
}

export function addCatalogSearchFields(query, target) {
  const searchTerm = normalizeText(target?.courseCode || target?.title)
  if (!searchTerm) return query
  // Zhengfang's search box serializes its visible input into these fields;
  // sending `searchInput` alone is ignored by the catalog endpoint.
  query.filterKey = 'all'
  query['filter_list[0]'] = searchTerm
  return query
}

export function diagnosticRequestValues(values, fields) {
  const sensitiveFields = new Set(['jxb_ids', 'jcxx_id', 'xkkz_xh'])
  return Object.fromEntries(fields.map((field) => {
    const value = normalizeText(values?.[field])
    return [field, sensitiveFields.has(field) ? (value ? '[present]' : null) : value || null]
  }))
}

export function parseBlocks(html) {
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

export function parseTeacher(value) {
  const text = normalizeText(value)
  const match = text.match(/\/([^/]+)\//)
  return match ? normalizeText(match[1]) : text || null
}

export function normalizeCandidate(record, { block, term, sourceUrl, context = {} }) {
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

export function normalizeSchoolSchedule(record, { term, sourceUrl }) {
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

export function equalTargetText(left, right) {
  const normalizedLeft = normalizeText(left).toLocaleLowerCase()
  const normalizedRight = normalizeText(right).toLocaleLowerCase()
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight)
}

export function matchPublishedCandidate(candidates, target) {
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

export function courseMatchesTarget(course, target) {
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

export function schoolScheduleCategoryCode(item) {
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

export function schoolScheduleBlockScore(item, block) {
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

export function schoolScheduleBlocksForItem(item, portal) {
  return [...(portal?.blocks || [])]
    .sort((left, right) => schoolScheduleBlockScore(item, right) - schoolScheduleBlockScore(item, left))
}

export function schoolScheduleCourseRecord(item) {
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

export function schoolScheduleFallbackItems(items, target) {
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

export function responseOutcome(body) {
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

export function diagnosticPath(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ''))
    return `${url.origin}${url.pathname}`
  } catch { return String(rawUrl || '').slice(0, 240) || 'unknown' }
}

export function rawError(error) {
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

export function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
