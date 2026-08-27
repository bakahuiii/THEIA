import * as cheerio from 'cheerio'
import { absoluteUrl, normalizeText, parseDateLike, parseNumber, stableId } from '../util.mjs'

function linkText($, node) {
  return normalizeText($(node).text() || $(node).attr('title') || $(node).attr('aria-label'))
}

export function parseTheolHome(html, baseUrl) {
  const $ = cheerio.load(html)
  const courses = []
  $('a[href*="courseId="], a[onclick*="courseId="]').each((_index, node) => {
    const onclickUrl = $(node).attr('onclick')?.match(/window\.open\(\s*['"]([^'"]*courseId=[^'"]*)/i)?.[1]
    const href = absoluteUrl(onclickUrl || $(node).attr('href'), baseUrl)
    if (!href) return
    const courseId = new URL(href).searchParams.get('courseId')
    const container = $(node).closest('li')
    const title = normalizeText(container.find('.title a[title]').first().attr('title') || container.find('.title').first().text() || linkText($, node))
    if (!courseId || !title || courses.some((item) => item.id === courseId)) return
    const parent = normalizeText(container.length ? container.text() : $(node).parent().text())
    courses.push({
      id: courseId,
      code: normalizeText(container.find('.coursenum').first().attr('title') || parent.match(/课程编号[:：]\s*([^\s|]+)/)?.[1]) || null,
      title,
      teacher: normalizeText(container.find('.realname span.realname').first().text() || parent.match(/(?:主讲)?教师[:：]\s*([^\s|]+)/)?.[1]) || null,
      source: 'theol',
      sourceUrl: href,
    })
  })
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
  return { courses, notices: notices.slice(0, 100), loggedIn: hasUserSignal || (courses.length > 0 && !hasCredentialForm) }
}

export function parseTheolCourse(html, { course, sourceUrl, capturedAt = new Date().toISOString() } = {}) {
  const $ = cheerio.load(html)
  const links = []
  $('a[href]').each((_index, node) => {
    const href = absoluteUrl($(node).attr('href'), sourceUrl)
    const title = linkText($, node)
    if (!href || !title || title.length < 2) return
    if (!links.some((item) => item.url === href && item.title === title)) links.push({ title, url: href })
  })
  const resourceLinks = links.filter((item) => /资源|课件|资料|下载|播课|视频|文档|基本信息|课程介绍|课程简介|简介|教学大纲|教学日历|大纲|日历/.test(item.title))
  const teachingMaterialLinks = resourceLinks.filter((item) => /基本信息|课程介绍|课程简介|简介|教学大纲|教学日历|大纲|日历/.test(item.title))
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
    kind: 'page',
    capturedAt,
  }))
  return {
    ...(course || {}),
    description: normalizeText($('.course-intro, .courseInfo, .course_introduce, [class*="intro"]').first().text()) || null,
    courseInfo: Object.keys(courseInfo).length ? courseInfo : null,
    resourceLinks: resourceLinks.slice(0, 100),
    teachingMaterials: teachingMaterials.slice(0, 100),
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
    { path: /\/hwtask\.view\.jsp$/i, parameter: 'hwtid', kind: 'assignment' },
    { path: /\/stu_qtest_navigate\.jsp$/i, parameter: 'testId', kind: 'online-test' },
  ].find((candidate) => candidate.path.test(url.pathname))
  if (!match) return null
  const identifiers = url.searchParams.getAll(match.parameter).map((value) => value.trim()).filter(Boolean)
  if (identifiers.length !== 1 || !/^\d+$/.test(identifiers[0])) return null
  return { href, kind: match.kind, identifier: identifiers[0] }
}

function assignmentTitle($, node, link, kind) {
  if (kind === 'assignment') return linkText($, link)
  const firstCell = $(node).children('td').first()
  return normalizeText(firstCell.clone().find('a, button, img, input').remove().end().text())
    || normalizeText(firstCell.text())
}

function assignmentDueText($, node, kind, text) {
  const cells = $(node).children('td')
  const structured = kind === 'online-test' ? cells.eq(2).text() : cells.eq(1).text()
  const datePattern = /([0-9]{4}[年./-][0-9]{1,2}[月./-][0-9]{1,2}(?:日)?(?:\s+[0-9]{1,2}:?[0-9]{2}(?::[0-9]{2})?)?)/
  return normalizeText(structured).match(datePattern)?.[1]
    || text.match(/(?:截止|结束|完成时间|提交时间)[:：]?\s*([0-9]{4}[年./-][0-9]{1,2}[月./-][0-9]{1,2}(?:日)?(?:\s+[0-9]{1,2}:?[0-9]{2}(?::[0-9]{2})?)?)/)?.[1]
    || ''
}

export function parseTheolAssignments(html, { course, sourceUrl, capturedAt = new Date().toISOString() } = {}) {
  const $ = cheerio.load(html)
  const items = []
  $('tr, li, .task, .homework, .hw-item, .list-item').each((_index, node) => {
    const text = normalizeText($(node).text())
    if (!text) return
    let link = null
    let task = null
    $(node).find('a[href]').each((_linkIndex, candidate) => {
      if (task) return
      const parsed = assignmentLink($(candidate).attr('href'), sourceUrl)
      if (!parsed) return
      link = candidate
      task = parsed
    })
    if (!task || !link) return
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
