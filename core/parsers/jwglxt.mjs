import * as cheerio from 'cheerio'
import { absoluteUrl, normalizeText, parseAcademicTerm, parseDateLike, parseNumber, parseQueryFromOnclick, stableId } from '../util.mjs'

const PAYLOAD_ARRAY_KEYS = new Set([
  'items', 'rows', 'data', 'result', 'list', 'aadata', 'records', 'recordlist',
  'datalist', 'gradelist', 'courselist', 'courses', 'kblist', 'sjklist', 'jxhjkclist',
])

function findPayloadArray(payload, depth = 0, seen = new Set()) {
  if (Array.isArray(payload)) return { found: true, value: payload }
  if (!payload || typeof payload !== 'object' || depth > 5 || seen.has(payload)) return { found: false, value: [] }
  seen.add(payload)
  const entries = Object.entries(payload)
  for (const [key, value] of entries) {
    if (!PAYLOAD_ARRAY_KEYS.has(String(key).toLowerCase())) continue
    if (Array.isArray(value)) return { found: true, value }
    const nested = findPayloadArray(value, depth + 1, seen)
    if (nested.found) return nested
  }
  return { found: false, value: [] }
}

function payloadItems(payload) {
  const parsed = typeof payload === 'string' ? parseMaybeJson(payload) : payload
  return findPayloadArray(parsed).value
}

function recordsFromBody(body) {
  const json = parseMaybeJson(body)
  const records = payloadItems(json)
  return records.length ? records : tableRecords(body)
}

function parseMaybeJson(body) {
  if (typeof body !== 'string') return body
  const text = body.trim()
  if (!(text.startsWith('{') || text.startsWith('['))) return null
  try {
    const parsed = JSON.parse(text)
    // A few Zhengfang deployments JSON-encode the response body one extra
    // time. Decode that harmless wrapper before looking for record arrays.
    return typeof parsed === 'string' ? parseMaybeJson(parsed) : parsed
  } catch { return null }
}

function selectedOption($, selectors) {
  for (const selector of selectors) {
    const item = $(selector).find('option:selected').first()
    if (item.length) return { value: item.attr('value') || '', label: normalizeText(item.text()) }
  }
  return null
}

function selectedField($, selectors) {
  const selected = selectedOption($, selectors)
  if (selected) return selected
  for (const selector of selectors) {
    const field = $(selector).first()
    if (!field.length) continue
    const value = field.val?.() ?? field.attr('value')
    if (value !== undefined && value !== null && String(value).trim()) {
      return { value: String(value), label: '' }
    }
  }
  return null
}

function options($, selectors) {
  for (const selector of selectors) {
    const values = $(selector).find('option').toArray().map((node) => ({ value: node.attribs?.value || '', label: normalizeText($(node).text()) })).filter((item) => item.value || item.label)
    if (values.length) return values
  }
  return []
}

export function parseJwHomepage(html, baseUrl) {
  const $ = cheerio.load(html)
  const pageUrl = new URL(baseUrl || 'https://jwglxt.buct.edu.cn/jwglxt/')
  const rawProfileName = normalizeText($('#yhm, #userName, .user-name, .media-heading, .glyphicon-user').first().parent().text())
  const profileName = /^(用户名|用户登录|登录)$/u.test(rawProfileName) ? null : rawProfileName || null
  const studentId = normalizeText($('#xh, #studentId, #sessionUserKey, [name="xh"], [name="sessionUserKey"]').first().val?.() || '') || null
  const menus = []
  $('a,button').each((_index, node) => {
    const parsed = parseQueryFromOnclick($(node).attr('onclick'))
    const href = absoluteUrl($(node).attr('href'), baseUrl)
    const label = normalizeText($(node).text())
    if (parsed || (href && /jwglxt|cjcx|kbcx|kwgl/.test(href))) {
      const item = parsed || { code: null, path: href, label }
      if (item.label && !menus.some((existing) => existing.path === item.path && existing.label === item.label)) menus.push({ ...item, path: absoluteUrl(item.path, baseUrl) || item.path })
    }
  })
  const schoolYear = selectedField($, ['#xnm', 'select[name="xnm"]', 'select[name="xnmValue"]', 'input[name="xnm"]'])
  const semester = selectedField($, ['#xqm', 'select[name="xqm"]', 'select[name="xqmValue"]', 'input[name="xqm"]'])
  const term = parseAcademicTerm(schoolYear?.value, semester?.value, `${schoolYear?.label || ''} ${semester?.label || ''}`)
  const notices = []
  $('a').each((_index, node) => {
    const href = absoluteUrl($(node).attr('href'), baseUrl)
    const title = normalizeText($(node).text())
    if (!href || !title || title.length < 3) return
    const parentText = normalizeText($(node).parent().text())
    if (/通知|公告|消息|文件|教务/.test(parentText + title)) {
      notices.push({ id: stableId('jw-notice', href, title), title, source: 'jwglxt', sourceUrl: href, publishedAt: parseDateLike(parentText) })
    }
  })
  const isUnifiedAuthPage = pageUrl.hostname === 'experimental-auth-endpoint.buct.edu.cn'
  const isLoginPage = /\/xtgl\/login_slogin\.html$/i.test(pageUrl.pathname) || ($('#dl, #yhm, #mm').length >= 2 && $('form[action*="login_slogin"]').length > 0)
  const hasAcademicNavigation = menus.some((item) => /(?:kbcx|cjcx|kwgl|xtgl\/index)/i.test(item.path || ''))
  return {
    loggedIn: !isUnifiedAuthPage && !isLoginPage && Boolean(profileName || studentId || term || hasAcademicNavigation),
    profile: profileName || studentId ? { name: profileName, studentId } : null,
    menus,
    term,
    terms: [
      ...options($, ['#xnm', 'select[name="xnm"]']).map((item) => parseAcademicTerm(item.value, semester?.value, item.label)).filter(Boolean),
    ],
    notices: notices.slice(0, 80),
  }
}

export function parseJwQueryForm(html, baseUrl, selector = 'form') {
  const $ = cheerio.load(html)
  const form = $(selector).first()
  if (!form.length) return { action: baseUrl, values: {}, term: null }

  const values = {}
  const labels = {}
  form.find('input[name], select[name], textarea[name]').each((_index, node) => {
    const field = $(node)
    const name = field.attr('name')
    if (!name || field.is(':disabled')) return
    const type = String(field.attr('type') || '').toLowerCase()
    if ((type === 'checkbox' || type === 'radio') && !field.is(':checked')) return
    if (field.is('select')) {
      const option = field.find('option:selected').first()
      values[name] = option.attr('value') ?? ''
      labels[name] = normalizeText(option.text())
      return
    }
    values[name] = field.val?.() ?? field.attr('value') ?? ''
  })

  const year = values.xnm ?? values.cx_xnm
  const semester = values.xqm ?? values.cx_xqm
  const yearLabel = labels.xnm ?? labels.cx_xnm ?? ''
  const semesterLabel = labels.xqm ?? labels.cx_xqm ?? ''
  return {
    action: absoluteUrl(form.attr('action'), baseUrl) || baseUrl,
    values,
    term: parseAcademicTerm(year, semester, `${yearLabel} ${semesterLabel}`),
  }
}

function numberFromText(value) {
  const match = String(value ?? '').match(/(?:^|[^0-9])([0-4](?:\.\d{1,3})?)(?:$|[^0-9])/)
  return match ? Number(match[1]) : null
}

export function parseJwAcademicStatus(html, baseUrl) {
  const json = parseMaybeJson(html)
  if (json && typeof json === 'object') {
    const record = payloadItems(json)[0] || json
    const gpa = numberFromText(value(record, 'gpa', 'GPA', 'pjxjf', 'xjf', 'averagePoint'))
    if (gpa !== null) return { gpa, sourceUrl: baseUrl }
  }

  const $ = cheerio.load(html)
  // The official GPA is rendered directly after this link without a stable ID.
  const officialGpa = numberFromText($('a[name="showGpa"]').first().next().text())
  if (officialGpa !== null) return { gpa: officialGpa, sourceUrl: baseUrl }

  let gpa = null
  $('[id], [name], [class]').each((_index, node) => {
    if (gpa !== null) return
    const element = $(node)
    const descriptor = [element.attr('id'), element.attr('name'), element.attr('class')].filter(Boolean).join(' ')
    if (!/(?:gpa|xjf|jidian|绩点)/i.test(descriptor)) return
    gpa = numberFromText(element.val?.() ?? element.text())
  })
  if (gpa === null) {
    const text = normalizeText($.text())
    const parenthesizedGpa = text.match(/GPA\s*[）：)]*\s*([0-4](?:\.\d{1,3})?)/i)
    gpa = parenthesizedGpa ? Number(parenthesizedGpa[1]) : null
  }
  if (gpa === null) {
    const text = normalizeText($.text())
    const match = text.match(/(?:GPA|平均学分绩点|平均绩点|总平均绩点|学分绩点)\s*[:：]?\s*([0-4](?:\.\d{1,3})?)/i)
    gpa = match ? Number(match[1]) : null
  }
  return { gpa, sourceUrl: baseUrl }
}

function progressCourseCounts(text) {
  const match = normalizeText(text).match(/\u8ba1\u5212\u603b\u8bfe\u7a0b\s*(\d+)\s*\u95e8\s*\u901a\u8fc7\s*(\d+)\s*\u95e8.*?\u672a\u901a\u8fc7\s*(\d+)\s*\u95e8.*?\u672a\u4fee\s*(\d+)\s*\u95e8.*?\u5728\u8bfb\s*(\d+)\s*\u95e8.*?\u8ba1\u5212\u5916.*?\u901a\u8fc7\s*(\d+)\s*\u95e8.*?\u672a\u901a\u8fc7\s*(\d+)\s*\u95e8/)
  if (!match) return null
  return {
    planned: {
      total: Number(match[1]),
      passed: Number(match[2]),
      failed: Number(match[3]),
      notTaken: Number(match[4]),
      studying: Number(match[5]),
    },
    outsidePlan: {
      passed: Number(match[6]),
      failed: Number(match[7]),
    },
  }
}

function progressRequirementCourses($, item, requirementId) {
  const rows = item.children('.more_con').find('tbody tr').toArray()
  return rows.map((row, index) => {
    const cells = $(row).children('td').toArray().map((cell) => normalizeText($(cell).text()))
    const courseCode = normalizeText(cells[3])
    const title = normalizeText(cells[5])
    if (!title) return null
    const point = parseNumber(cells[11])
    const credits = parseNumber(cells[8])
    return {
      id: stableId('academic-requirement-course', requirementId, courseCode || title, index),
      studyStatus: normalizeText($(row).find('[title]').first().attr('title') || '') || null,
      academicYear: cells[1] || null,
      term: cells[2] || null,
      // Internal hexadecimal ids are deliberately not shown as course codes.
      courseCode: isStandardCourseCode(courseCode) ? courseCode : null,
      title,
      hours: cells[6] || null,
      nature: cells[7] || null,
      credits: Number.isFinite(credits) ? credits : null,
      category: cells[9] || null,
      bestScore: cells[10] || null,
      point: Number.isFinite(point) ? point : null,
      score: cells[12] || null,
      makeupScore: cells[13] || null,
      retakeScore: cells[14] || null,
      recommendedYear: cells[15] || null,
      recommendedTerm: cells[16] || null,
    }
  }).filter(Boolean)
}

function requirementTitle(value) {
  // Some N105515 releases assemble the embedded tree with JavaScript string
  // concatenation. Once decoded, its separator can survive as `\" + \"` in
  // the text node. It is syntax, never part of a degree requirement title.
  return normalizeText(value)
    .replace(/\\?["']\s*\+\s*\\?["']/g, ' ')
    .trim()
}

export function parseJwAcademicProgress(html, { sourceUrl, capturedAt = new Date().toISOString() } = {}) {
  const $ = cheerio.load(html)
  const categories = new Map()
  const treeEntries = []

  // JWGLXT puts the node id on the direct .title child, while the parent id and
  // the AND/OR edge are on its containing <li>. Reading only p.title1 loses
  // the degree-plan tree and turns alternative directions into fake deficits.
  $('li').each((_index, li) => {
    const item = $(li)
    const titleElement = item.children('.title[xfyqjd_id]').first()
    const element = titleElement.find('p.title1[yqzdxf]').first()
    const required = parseNumber(element.attr('yqzdxf'))
    if (!titleElement.length || !element.length || !Number.isFinite(required)) return
    const title = requirementTitle(element.clone().children('span, i, font').remove().end().text())
      .replace(/\u8981\u6c42\u5b66\u5206\s*[:\uff1a].*$/u, '')
      .trim()
    if (!title) return
    const earned = parseNumber(element.attr('yxxf'))
    const categoryId = titleElement.attr('xfyqjd_id') || element.attr('id') || stableId('academic-category', title, required)
    const rawRelation = item.attr('xfyqzjdgx')
    const entry = {
      id: String(categoryId),
      title,
      required,
      earned: Number.isFinite(earned) ? earned : null,
      remaining: Number.isFinite(earned) ? Math.max(0, required - earned) : null,
      status: normalizeText(titleElement.find('[id^="xfzt"]').attr('title') || '') || null,
      parentId: item.attr('fxfyqjd_id') || null,
      relation: rawRelation === '0' || item.attr('\u6216\u8005') !== undefined ? 'or' : 'and',
      children: [],
      courses: progressRequirementCourses($, item, String(categoryId)),
      sourceUrl,
    }
    categories.set(entry.id, entry)
    treeEntries.push(entry)
  })

  if (!treeEntries.length) {
    // Older or partial responses do not include the rendered tree. Keep the
    // previous flat parser so the desktop app remains useful with those pages.
    $('p.title1[yqzdxf]').each((_index, node) => {
      const element = $(node)
      const required = parseNumber(element.attr('yqzdxf'))
      if (!Number.isFinite(required)) return
      const title = requirementTitle(element.clone().children('span, i, font').remove().end().text())
        .replace(/\u8981\u6c42\u5b66\u5206\s*[:\uff1a].*$/u, '')
        .trim()
      if (!title) return
      const earned = parseNumber(element.attr('yxxf'))
      const categoryId = element.attr('id') || element.closest('[xfyqjd_id]').attr('xfyqjd_id') || stableId('academic-category', title, required)
      categories.set(categoryId, {
        id: String(categoryId),
        title,
        required,
        earned: Number.isFinite(earned) ? earned : null,
        remaining: Number.isFinite(earned) ? Math.max(0, required - earned) : null,
        status: normalizeText(element.siblings('[id^="xfzt"]').attr('title') || '') || null,
        sourceUrl,
        capturedAt,
      })
    })
  }

  const roots = []
  for (const entry of treeEntries) {
    const parent = entry.parentId ? categories.get(entry.parentId) : null
    if (parent) parent.children.push(entry)
    else roots.push(entry)
  }
  const programElement = $('.treeview > li').first().children('.title').find('p.title1').first()
  const program = requirementTitle(programElement.clone().children('span, i, font').remove().end().text())
    .replace(/\u8981\u6c42\u5b66\u5206\s*[:\uff1a].*$/u, '')
    .trim() || null

  const summaryText = normalizeText($('#alertBox').text())
  const status = parseJwAcademicStatus(html, sourceUrl)
  return {
    gpa: status.gpa,
    program,
    courseCounts: progressCourseCounts(summaryText),
    categories: [...categories.values()],
    ...(treeEntries.length ? { roots } : {}),
    sourceUrl,
    capturedAt,
  }
}

function value(item, ...keys) {
  for (const key of keys) {
    if (item?.[key] !== undefined && item?.[key] !== null && String(item[key]).trim() !== '') return item[key]
  }
  return null
}

function isInternalCourseId(value) {
  const text = normalizeText(value)
  return Boolean(text) && /^[0-9A-F]{16,}$/i.test(text)
}

// BUCT course codes are short alphanumeric identifiers such as ART14000G.
// Internal Zhengfang identifiers are long hexadecimal strings and must never
// be exposed as user-facing course codes.
export function isStandardCourseCode(value) {
  const text = normalizeText(value).toUpperCase()
  if (!text || text.length > 16 || isInternalCourseId(text)) return false
  return /^[A-Z]{2,6}[A-Z0-9]*\d[A-Z0-9]*[A-Z]$/.test(text)
}

function courseCodeFrom(record, keys) {
  const candidates = keys
    .map((key) => normalizeText(record?.[key]))
    .filter(Boolean)
  return candidates.find((candidate) => isStandardCourseCode(candidate))
    || candidates.find((candidate) => !isInternalCourseId(candidate))
    || null
}

function recordTerm(record, fallback) {
  return parseAcademicTerm(
    value(record, 'xnm', 'xn', 'year'),
    value(record, 'xqm', 'xq', 'semester'),
    `${value(record, 'xnmc', 'yearLabel') || ''} ${value(record, 'xqmmc', 'semesterLabel') || ''}`,
  ) || fallback
}

function rowValues($, row, headers) {
  const cells = $(row).find('td').toArray().map((node) => normalizeText($(node).text()))
  const result = {}
  headers.forEach((header, index) => { if (header && cells[index] !== undefined) result[header] = cells[index] })
  return result
}

function tableRecords(body) {
  const $ = cheerio.load(body)
  const output = []
  $('table').each((_tableIndex, table) => {
    const headers = $(table).find('thead th, tr:first-child th').toArray().map((node) => normalizeText($(node).text()))
    if (!headers.length) return
    $(table).find('tbody tr, tr').each((_rowIndex, row) => {
      const values = rowValues($, row, headers)
      if (Object.keys(values).length && Object.values(values).some(Boolean)) output.push(values)
    })
  })
  return output
}

export function parseJwSchedule(body, { term, sourceUrl, capturedAt = new Date().toISOString() } = {}) {
  const records = recordsFromBody(body)
  const items = []
  for (const record of records) {
    const itemTerm = recordTerm(record, term)
    const title = normalizeText(value(record, 'kcmc', '课程名称', 'courseName', 'title', '课程'))
    if (!title) continue
    const courseCode = courseCodeFrom(record, ['kch', 'courseCode', '课程代码', 'kch_id'])
    const weekday = parseNumber(value(record, 'xqj', '星期', 'weekday'))
    const period = normalizeText(value(record, 'jcs', '节次', 'period', 'classTime')) || null
    const weeks = normalizeText(value(record, 'zcd', '周次', 'weeks')) || null
    const room = normalizeText(value(record, 'cdmc', '教室', 'room', '地点')) || null
    const teacher = normalizeText(value(record, 'xm', 'jsxm', '教师', 'teacher')) || null
    items.push({
      id: stableId('schedule', itemTerm?.id, courseCode, title, weekday, period, weeks, room),
      termId: itemTerm?.id || null,
      courseId: courseCode,
      title,
      courseCode,
      teacher,
      room,
      weekday: Number.isFinite(weekday) ? weekday : null,
      period,
      weeks,
      startAt: parseDateLike(value(record, 'startAt', '开始时间')),
      endAt: parseDateLike(value(record, 'endAt', '结束时间')),
      source: 'jwglxt',
      sourceUrl,
      capturedAt,
    })
  }
  return items
}

export function parseJwGrades(body, { term, sourceUrl, capturedAt = new Date().toISOString() } = {}) {
  const records = recordsFromBody(body)
  return records.map((record) => {
    // The direct zfn_api envelope uses snake_case fields while the rendered
    // Zhengfang grid uses its original k*/c* names. Project the alternate
    // shape onto the canonical aliases used below before parsing it.
    record = {
      ...record,
      kch: record.kch ?? record.courseCode ?? record.course_id ?? record.courseId,
      kcmc: record.kcmc ?? record.courseName ?? record.title,
      cj: record.cj ?? record.score ?? record.grade,
      xf: record.xf ?? record.credits ?? record.credit,
      jd: record.jd ?? record.point ?? record.grade_point,
      kclbmc: record.kclbmc ?? record.courseCategory ?? record.category,
      kcxzmc: record.kcxzmc ?? record.nature,
      jsxm: record.jsxm ?? record.teacher,
      ksxz: record.ksxz ?? record.assessment ?? record.grade_nature,
      cjbs: record.cjbs ?? record.status ?? record.mark,
      bzxx: record.bzxx ?? record.remark ?? record.remarkText,
    }
    const itemTerm = recordTerm(record, term)
    const remark = normalizeText(value(record, 'bzxx', 'cjbz', 'bz', 'ksbz', 'remark', 'remarkText')) || null
    const courseCode = courseCodeFrom(record, ['kch', 'courseCode', '课程代码', 'kch_id'])
    const courseName = normalizeText(value(record, 'kcmc', '课程名称', 'courseName')) || '未命名课程'
    const score = normalizeText(value(record, 'cj', '成绩', 'score')) || null
    return {
      id: stableId('grade', itemTerm?.id, courseCode, courseName, value(record, 'jxb_id', 'classId'), score),
      termId: itemTerm?.id || null,
      courseId: courseCode,
      courseCode,
      courseName,
      category: normalizeText(value(record, 'kcgsmc', 'kclbmc', 'courseCategory', 'category')) || null,
      nature: normalizeText(value(record, 'kcxzmc', '课程性质', 'nature')) || null,
      credits: parseNumber(value(record, 'xf', '学分', 'credits')),
      score,
      remark,
      point: parseNumber(value(record, 'jd', '绩点', 'point')),
      teacher: normalizeText(value(record, 'jsxm', '教师', 'teacher')) || null,
      assessment: normalizeText(value(record, 'ksxz', '考核方式', 'assessment')) || null,
      status: normalizeText(value(record, 'cjbs', '成绩状态', 'status')) || null,
      source: 'jwglxt',
      sourceUrl,
      capturedAt,
    }
  }).filter((item) => item.courseName !== '未命名课程' || item.score)
}

export function parseJwExams(body, { term, sourceUrl, capturedAt = new Date().toISOString() } = {}) {
  const records = recordsFromBody(body)
  return records.map((record) => {
    const itemTerm = recordTerm(record, term)
    const remark = normalizeText(value(record, 'bzxx', 'bz', 'ksbz', 'remark', 'remarkText')) || null
    const courseCode = courseCodeFrom(record, ['kch', 'courseCode', '课程代码', 'kch_id'])
    const courseName = normalizeText(value(record, 'kcmc', '课程名称', 'courseName')) || '未命名考试'
    const examTime = normalizeText(value(record, 'kssj', '考试时间', 'examTime')) || null
    return {
      id: stableId('exam', itemTerm?.id, courseCode, courseName, examTime, value(record, 'cdmc', '考试地点', 'location')),
      termId: itemTerm?.id || null,
      courseId: courseCode,
      courseCode,
      courseName,
      examType: normalizeText(value(record, 'ksmc', '考试名称', 'examType')) || null,
      examTime,
      remark,
      startAt: parseDateLike(examTime),
      endAt: null,
      location: normalizeText(value(record, 'cdmc', '考试地点', 'location')) || null,
      campus: normalizeText(value(record, 'xqmc', '校区', 'campus')) || null,
      seat: normalizeText(value(record, 'zwh', '座号', 'seat')) || null,
      mode: normalizeText(value(record, 'ksfs', '考试方式', 'mode')) || null,
      source: 'jwglxt',
      sourceUrl,
      capturedAt,
    }
  }).filter((item) => item.courseName !== '未命名考试' || item.examTime)
}

export function parseJwSelectedCourses(body, { term, sourceUrl, capturedAt = new Date().toISOString() } = {}) {
  const records = recordsFromBody(body)
  return records.map((record) => {
    const itemTerm = recordTerm(record, term)
    const courseCode = courseCodeFrom(record, ['kch', 'courseCode', '课程代码', 'kch_id'])
    const classId = normalizeText(value(record, 'jxb_id', 'do_jxb_id', 'classId')) || null
    const title = normalizeText(value(record, 'kcmc', 'courseName', 'title', '课程名称'))
    if (!title) return null
    return {
      id: stableId('selected-course', itemTerm?.id, courseCode, classId, title),
      termId: itemTerm?.id || null,
      courseId: courseCode,
      courseCode,
      classId,
      title,
      teacher: normalizeText(value(record, 'jsxm', 'jsxx', 'teacher', '教师')) || null,
      credits: parseNumber(value(record, 'xf', 'credit', 'credits', '学分')),
      category: normalizeText(value(record, 'kclbmc', 'kklxmc', 'category', '课程类别')) || null,
      location: normalizeText(value(record, 'jxdd', 'cdmc', 'place', 'location', '上课地点')) || null,
      time: normalizeText(value(record, 'sksj', 'time', '上课时间')) || null,
      capacity: parseNumber(value(record, 'jxbrs', 'capacity')),
      enrolled: parseNumber(value(record, 'yxzrs', 'selected_number', 'enrolled')),
      waiting: normalizeText(value(record, 'sxbj', 'waiting')) || null,
      source: 'jwglxt',
      sourceUrl,
      capturedAt,
    }
  }).filter(Boolean)
}

export function parseJwNotices(body, { sourceUrl, capturedAt = new Date().toISOString() } = {}) {
  const records = recordsFromBody(body)
  return records.map((record) => {
    const title = normalizeText(value(record, 'bt', 'xxbt', 'title', 'name', '标题'))
    if (!title) return null
    const rawUrl = value(record, 'url', 'href', 'xxdz', 'link', 'sourceUrl')
    const noticeUrl = absoluteUrl(rawUrl, sourceUrl) || sourceUrl
    return {
      id: stableId('jw-notice', value(record, 'id', 'xxid', 'tzggid'), title, noticeUrl),
      title,
      summary: normalizeText(value(record, 'nr', 'xxnr', 'content', 'summary', '内容')) || null,
      publishedAt: parseDateLike(value(record, 'cjsj', 'fbsj', 'createTime', 'publishedAt', '发布时间')),
      source: 'jwglxt',
      sourceUrl: noticeUrl,
      capturedAt,
    }
  }).filter(Boolean)
}
