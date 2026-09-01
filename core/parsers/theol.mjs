import * as cheerio from 'cheerio'
import { absoluteUrl, normalizeText, parseDateLike, parseNumber, stableId } from '../util.mjs'

function linkText($, node) {
  return normalizeText($(node).text() || $(node).attr('title') || $(node).attr('aria-label'))
}

const COURSE_ID_PATTERN = /(?:courseId|courseid|course_id|lid)\s*[=:]\s*['"]?([A-Za-z0-9_-]+)/i
const GENERIC_COURSE_LINK_TEXT = /^(?:进入|进入课程|课程首页|详情|上移|下移|删除|编辑)$/u

function courseUrlCandidate(rawUrl, baseUrl) {
  const value = String(rawUrl || '').trim()
  if (!value || /^javascript:/i.test(value) || /^#+$/u.test(value)) return null
  return absoluteUrl(value, baseUrl)
}

function courseIdFromCandidate(rawValue, resolvedUrl) {
  try {
    const parsed = new URL(resolvedUrl || '')
    for (const name of ['courseId', 'courseid', 'course_id', 'lid']) {
      const value = parsed.searchParams.get(name)
      if (value) return value.trim()
    }
  } catch {
    // Fall back to the raw onclick/data attribute below.
  }
  return String(rawValue || '').match(COURSE_ID_PATTERN)?.[1] || null
}

function courseLinkFromOnclick(value) {
  return String(value || '').match(/["']([^"']*(?:courseId|courseid|course_id|lid)\s*[=:][^"']*)["']/i)?.[1] || null
}

function courseContainer($, node) {
  return $(node).closest('li, .course, .course-item, .lesson, .list-item, tr').first()
}

function courseTitle($, node, container) {
  const candidates = [
    $(node).attr('title'),
    container.find('.title a[title], .courseName, .lessonName, .title').first().attr('title'),
    $(node).text(),
    container.find('.title, .courseName, .lessonName').first().text(),
    container.find('[title]').toArray()
      .map((candidate) => $(candidate).attr('title'))
      .find((value) => value && !GENERIC_COURSE_LINK_TEXT.test(normalizeText(value))),
    linkText($, node),
  ]
  return candidates.map(normalizeText).find((value) => value && !GENERIC_COURSE_LINK_TEXT.test(value)) || ''
}

function canonicalTheolCourseUrl(id, baseUrl) {
  try {
    const origin = new URL(baseUrl).origin
    return absoluteUrl(`homepage/course/course_index.jsp?courseId=${encodeURIComponent(id)}`, `${origin}/meol/`)
  } catch {
    return absoluteUrl(`homepage/course/course_index.jsp?courseId=${encodeURIComponent(id)}`, baseUrl)
  }
}

export function parseTheolCourses(html, baseUrl) {
  const $ = cheerio.load(String(html || ''))
  const courses = []
  const nodes = $('a[href], a[onclick], [onclick], [data-url], [data-href], [data-src], [datasrc]')
  nodes.each((_index, node) => {
    const rawValues = [
      $(node).attr('href'),
      $(node).attr('data-url'),
      $(node).attr('data-href'),
      $(node).attr('data-src'),
      $(node).attr('datasrc'),
      courseLinkFromOnclick($(node).attr('onclick')),
    ].filter(Boolean)
    const source = `${rawValues.join(' ')} ${$(node).attr('onclick') || ''}`
    if (!/(?:course_index|enter_course|(?:^|[?&#])(?:courseId|courseid|course_id|lid)\s*[=:])/i.test(source)) return
    const resolvedUrl = rawValues.map((value) => courseUrlCandidate(value, baseUrl)).find(Boolean)
    const id = courseIdFromCandidate(source, resolvedUrl)
    if (!id || id === '0' || !resolvedUrl) return
    const container = courseContainer($, node)
    const title = courseTitle($, node, container)
    if (!title) return
    const parent = normalizeText(container.length ? container.text() : $(node).parent().text())
    const item = {
      id,
      code: normalizeText(container.find('.coursenum').first().attr('title') || parent.match(/课程编号\s*[:：]\s*([^\s|]+)/)?.[1]) || null,
      title,
      teacher: normalizeText(container.find('.realname span.realname').first().text()
        || container.find('.teacher, .teacherName, .realname').first().text()
        || parent.match(/(?:主讲)?教师\s*[:：]\s*([^\s|]+)/)?.[1]) || null,
      source: 'theol',
      sourceUrl: canonicalTheolCourseUrl(id, baseUrl),
    }
    const existing = courses.find((course) => course.id === id)
    if (!existing) courses.push(item)
    else {
      for (const key of ['title', 'code', 'teacher', 'sourceUrl']) if (!existing[key] && item[key]) existing[key] = item[key]
    }
  })
  return courses
}

export function parseTheolHome(html, baseUrl) {
  const $ = cheerio.load(html)
  const courses = parseTheolCourses(html, baseUrl)
  const notices = []
  $('a').each((_index, node) => {
    const href = absoluteUrl($(node).attr('href'), baseUrl)
    const title = linkText($, node)
    if (!href || !title || title.length < 3 || !/通知|公告|消息|提醒/.test(title + $(node).parent().text())) return
    const context = normalizeText($(node).parent().text())
    notices.push({
      id: stableId('theol-notice', href, title),
      title,
      summary: context.slice(0, 300),
      publishedAt: parseDateLike(context),
      source: 'theol',
      sourceUrl: href,
    })
  })
  const pageText = $.text()
  const hasUserSignal = /退出|个人中心|我的课程|登录时间[:：]|在线总时长|互动提醒/.test(pageText)
  const hasCredentialForm = $('input[type="password"], form[action*="loginCheck"]').length > 0 || /请输入密码|密码登录/.test(pageText)
  const isCourseList = /\/lesson\/blen\.student\.lesson\.list\.jsp$/i.test(new URL(baseUrl).pathname)
  return { courses, notices: notices.slice(0, 100), loggedIn: hasUserSignal || (courses.length > 0 && (!hasCredentialForm || isCourseList)) }
}

export function parseTheolCourse(html, { course, sourceUrl, capturedAt = new Date().toISOString() } = {}) {
  const $ = cheerio.load(html)
  const links = []
  const addLink = (node, rawHref) => {
    const href = absoluteUrl(rawHref, sourceUrl)
    const title = linkText($, node)
    if (!href || !title || title.length < 2) return
    if (!links.some((item) => item.url === href && item.title === title)) links.push({ title, url: href })
  }
  $('a[href]').each((_index, node) => addLink(node, $(node).attr('href')))
  // Newer THEOL course shells keep the real column URL in datasrc while the
  // clickable node is a <li> or <div>, so href-only parsing misses the three
  // course-material columns entirely.
  $('[datasrc]').each((_index, node) => addLink(node, $(node).attr('datasrc')))
  $('[onclick]').each((_index, node) => {
    const source = String($(node).attr('onclick') || '')
    for (const match of source.matchAll(/(?:window\.open|location(?:\.href)?\s*=|MM_goToURL\([^,]+,)[^"']*["']([^"']+)["']/giu)) {
      addLink(node, match[1])
    }
  })
  const resourceLinks = links.filter((item) => /基本信息|课程介绍|课程简介|简介|教学大纲|教学日历|大纲|日历/i.test(item.title))
  const materialType = (item) => /教学日历|日历|calendar/i.test(`${item.title} ${item.url}`)
    ? 'calendar'
    : /教学大纲|大纲|syllabus/i.test(`${item.title} ${item.url}`)
      ? 'syllabus'
      : /基本信息|课程介绍|课程简介|简介|introduction|intro/i.test(`${item.title} ${item.url}`)
        ? 'introduction'
        : null
  const teachingMaterialLinks = resourceLinks
    .map((item) => ({ ...item, materialType: materialType(item) }))
    .filter((item) => item.materialType)
  const assignmentLinks = links.filter((item) => /作业|任务|测试|试卷|问卷|hwtask|exam|quiz/i.test(`${item.title} ${item.url}`))
  const bodyText = normalizeText($.text())
  const courseInfo = {}
  const infoPatterns = [
    ['department', /课程所属院系[:：]\s*([^\s]+?学院|[^\s]+?系|[^\s]+?部)/],
    ['enrolled', /选课学生数[:：]\s*(\d+)/],
    ['resourceCount', /课程资源数[:：]\s*(\d+)/],
    ['videoCount', /课程视频资源数[:：]\s*(\d+)/],
    ['noticeCount', /课程通知数[:：]\s*(\d+)/],
    ['assignmentCount', /课程作业数[:：]\s*(\d+)/],
  ]
  for (const [key, pattern] of infoPatterns) {
    const match = bodyText.match(pattern)
    if (match) courseInfo[key] = /^\d+$/.test(match[1]) ? Number(match[1]) : match[1]
  }
  const teachingMaterials = teachingMaterialLinks.map((item) => ({
    id: stableId('theol-teaching-material', course?.id || '', item.url, item.title),
    courseId: String(course?.id || ''),
    title: item.title,
    url: item.url,
    materialType: item.materialType,
    kind: 'page',
    capturedAt,
  }))
  if (!teachingMaterials.some((item) => item.materialType === 'introduction') && sourceUrl) {
    teachingMaterials.unshift({
      id: stableId('theol-teaching-material', course?.id || '', sourceUrl, '课程介绍'),
      courseId: String(course?.id || ''),
      title: '课程介绍',
      url: sourceUrl,
      materialType: 'introduction',
      kind: 'page',
      capturedAt,
    })
  }
  const onePerType = new Map()
  for (const material of teachingMaterials) {
    if (!onePerType.has(material.materialType)) onePerType.set(material.materialType, material)
  }
  const selectedMaterials = [...onePerType.values()].slice(0, 3)
  return {
    ...(course || {}),
    description: normalizeText($('.course-intro, .courseInfo, .course_introduce, [class*="intro"]').first().text()) || null,
    courseInfo: Object.keys(courseInfo).length ? courseInfo : null,
    // Only the three local course-material categories are exposed to THEIA.
    // The old resource tree remains a separate legacy API and is not part of
    // the course-material view anymore.
    resourceLinks: selectedMaterials.map(({ title, url }) => ({ title, url })),
    teachingMaterials: selectedMaterials,
    assignmentLinks: assignmentLinks.slice(0, 100),
    sourceUrl,
    capturedAt,
  }
}

const VOLATILE_RESOURCE_PARAMETERS = new Set(['jsessionid', 'sessionid', 'session', 'sid', 'token', 'timestamp', '_', 't'])
const RESOURCE_ID_PARAMETERS = ['resid', 'fileid', 'fileId', 'folderid', 'columnid', 'columnId', 'groupid', 'groupId']

function safeDecodeURIComponent(value) {
  try { return decodeURIComponent(value) } catch { return value }
}

function canonicalResourceUrl(rawUrl, sourceUrl) {
  try {
    const url = new URL(rawUrl, sourceUrl)
    const entries = [...url.searchParams.entries()]
      .filter(([name]) => !VOLATILE_RESOURCE_PARAMETERS.has(name.toLowerCase()))
      .map(([name, value]) => [name.toLowerCase(), value])
      .sort(([leftName, leftValue], [rightName, rightValue]) => leftName.localeCompare(rightName) || leftValue.localeCompare(rightValue))
    url.search = new URLSearchParams(entries).toString()
    return url.toString()
  } catch {
    return null
  }
}

function resourceSourceKey(courseId, kind, parsed, canonicalUrl) {
  const identifiers = RESOURCE_ID_PARAMETERS
    .map((name) => [name.toLowerCase(), parsed.searchParams.get(name)])
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}=${value}`)
  return [String(courseId || ''), kind, identifiers.join('&') || canonicalUrl || parsed.pathname.toLowerCase()].join(':')
}

export function parseTheolCourseResources(html, { courseId, sourceUrl, capturedAt = new Date().toISOString() } = {}) {
  const $ = cheerio.load(html)
  const items = []
  const contextTitle = (node) => {
    const scope = $(node).closest('#dowload-preview, .wrap, body')
    const fileName = normalizeText(scope.find('h2').first().text()).match(/文件名\s*[:：]\s*(.+?)(?:\s*\(|$)/)?.[1]
    return fileName || normalizeText(scope.find('h1').first().text()) || normalizeText($(node).attr('title') || $(node).attr('aria-label'))
  }
  const add = (rawHref, rawTitle, kind = null, node = null) => {
    const url = absoluteUrl(rawHref, sourceUrl)
    let title = normalizeText(rawTitle) || contextTitle(node)
    if (!url || !title || title.length < 2 || /^javascript:/i.test(url) || /^###?$/.test(url)) return
    let parsed
    try { parsed = new URL(url) } catch { return }
    const isFolder = kind === 'folder' || (parsed.searchParams.has('folderid') && /(?:acttype=enter|listview\.jsp|courseResource\.jsp)/i.test(parsed.pathname + parsed.search))
      || (/resFolderViewList\.do/i.test(parsed.pathname) && parsed.searchParams.has('folderid') && !parsed.searchParams.has('resid') && !parsed.searchParams.has('fileid'))
    const isAttribute = /attribute_(?:file|folder)\.jsp/i.test(parsed.pathname) || /查看(?:目录)?属性/.test(title)
    const isFile = /(?:download(?:_preview)?\.jsp|preview\.jsp|onlinepreview\.jsp)/i.test(parsed.pathname)
      || parsed.searchParams.has('resid') || parsed.searchParams.has('fileid') || parsed.searchParams.has('fileId')
    if (isAttribute || (!isFolder && !isFile && kind !== 'file')) return
    const normalizedKind = isFolder ? 'folder' : 'file'
    const canonicalUrl = canonicalResourceUrl(url, sourceUrl)
    const sourceKey = resourceSourceKey(courseId, normalizedKind, parsed, canonicalUrl)
    const parentFolderId = (() => {
      try { return new URL(sourceUrl).searchParams.get('folderid') || null } catch { return null }
    })()
    const fileName = !isFolder
      ? (title.match(/文件名\s*[:：]\s*(.+?)(?:\s*\(|$)/)?.[1]
        || (/\.[a-z0-9]{1,8}$/i.test(title) ? title : null)
        || safeDecodeURIComponent(parsed.pathname.split('/').pop() || '').replace(/^download(?:_preview)?\.jsp$/i, '')
        || null)
      : null
    if (!title && fileName) title = fileName
    items.push({
      id: stableId('theol-course-resource', sourceKey),
      sourceKey,
      courseId: String(courseId || ''), title: title.slice(0, 300), url,
      kind: normalizedKind, fileName,
      ...(parentFolderId ? { parentFolderId } : {}),
      capturedAt,
    })
  }
  $('a[href]').each((_index, node) => add($(node).attr('href'), $(node).attr('title') || $(node).text(), null, node))
  // Buildless course columns expose the actual file only through an iframe;
  // keeping that preview URL lets the authenticated source window render it.
  $('iframe[src], frame[src]').each((_index, node) => {
    const src = $(node).attr('src')
    if (!src || !/(?:preview|download|resFolderViewList|listview)\./i.test(src)) return
    add(src, contextTitle(node), null, node)
  })
  $('[onclick]').each((_index, node) => {
    const source = String($(node).attr('onclick') || '')
    for (const match of source.matchAll(/(?:MM_goToURL\([^,]+,|window\.open\(|location(?:\.href)?\s*=)[^"']*["']([^"']+)["']/gi)) {
      add(match[1], $(node).attr('title') || $(node).text(), 'file', node)
    }
  })
  return [...new Map(items.map((item) => [item.id, item])).values()].slice(0, 500)
}

function assignmentLink(rawHref, sourceUrl) {
  const href = absoluteUrl(rawHref, sourceUrl)
  if (!href) return null
  const url = new URL(href)
  const match = [
    { path: /\/(?:hwtask\.view|hwtask_blended)\.jsp$/i, parameter: 'hwtid', kind: 'assignment' },
    { path: /\/stu_qtest_(?:navigate|result|more_result|over)\.jsp$/i, parameter: 'testId', kind: 'online-test' },
  ].find((candidate) => candidate.path.test(url.pathname))
  if (!match) return null
  const identifiers = url.searchParams.getAll(match.parameter).map((value) => value.trim()).filter(Boolean)
  if (identifiers.length !== 1 || !/^\d+$/.test(identifiers[0])) return null
  return { href, kind: match.kind, identifier: identifiers[0] }
}

function assignmentTitle($, node, link, kind) {
  if (kind === 'assignment') return linkText($, link) || normalizeText($(node).attr('title'))
  const firstCell = $(node).children('td').first()
  if (firstCell.length) {
    return normalizeText(firstCell.clone().find('a, button, img, input').remove().end().text())
      || normalizeText(firstCell.text())
  }
  return normalizeText($(node).clone().find('a, button, img, input').remove().end().text())
    || linkText($, link)
}

function assignmentDeadlineColumnIndex($, node) {
  const table = $(node).closest('table')
  if (!table.length) return -1
  const header = table.find('tr').toArray().find((row) => $(row).find('th').length > 0)
  if (!header) return -1
  return $(header).children('th, td').toArray().findIndex((cell) => /(?:截止|结束|完成期限|提交期限)/u.test(normalizeText($(cell).text())))
}

function assignmentDueText($, node, kind, text) {
  const cells = $(node).children('td')
  const deadlineColumn = assignmentDeadlineColumnIndex($, node)
  const fallbackColumn = kind === 'online-test' ? 2 : 1
  const structured = cells.eq(deadlineColumn >= 0 ? deadlineColumn : fallbackColumn).text()
  const datePattern = /([0-9]{4}[年./-][0-9]{1,2}[月./-][0-9]{1,2}(?:日)?(?:\s+[0-9]{1,2}:?[0-9]{2}(?::[0-9]{2})?)?)/
  return normalizeText(structured).match(datePattern)?.[1]
    || text.match(/(?:截止|结束|完成时间|提交时间)[:：]?\s*([0-9]{4}[年./-][0-9]{1,2}[月./-][0-9]{1,2}(?:日)?(?:\s+[0-9]{1,2}:?[0-9]{2}(?::[0-9]{2})?)?)/)?.[1]
    || ''
}

export function parseTheolAssignments(html, { course, sourceUrl, capturedAt = new Date().toISOString() } = {}) {
  const $ = cheerio.load(html)
  const items = []
  const seen = new Set()
  $('a[href]').each((_index, link) => {
    const task = assignmentLink($(link).attr('href'), sourceUrl)
    if (!task) return
    const row = $(link).closest('tr, li, .task, .homework, .hw-item, .list-item').first()
    const node = row.length ? row : $(link).parent()
    const text = normalizeText($(node).text())
    if (!text) return
    const itemKey = `${task.kind}:${task.identifier}`
    if (seen.has(itemKey)) return
    seen.add(itemKey)
    const title = assignmentTitle($, node, link, task.kind)
    if (!title) return
    const score = text.match(/(?:成绩|得分)[:：]?\s*([0-9]+(?:\.\d+)?)/)?.[1] || null
    const status = /已提交|已完成|已交/.test(text) ? 'submitted' : /未提交|未完成/.test(text) ? 'pending' : 'unknown'
    items.push({
      kind: task.kind,
      id: stableId('theol-assignment', task.kind, task.identifier),
      courseId: course?.id || null,
      courseName: course?.title || null,
      courseSourceUrl: course?.sourceUrl || null,
      title,
      dueAt: parseDateLike(assignmentDueText($, node, task.kind, text)),
      score: score ? parseNumber(score) : null,
      status,
      source: 'theol',
      sourceUrl: task.href,
      capturedAt,
    })
  })
  return [...new Map(items.map((item) => [item.id, item])).values()].slice(0, 200)
}
