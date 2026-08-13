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
  const resourceLinks = links.filter((item) => /资源|课件|资料|下载|播课|视频|文档/.test(item.title))
  const assignmentLinks = links.filter((item) => /作业|任务|测试|试卷|问卷|hwtask|exam|quiz/i.test(`${item.title} ${item.url}`))
  return {
    ...(course || {}),
    description: normalizeText($('.course-intro, .courseInfo, .course_introduce, [class*="intro"]').first().text()) || null,
    resourceLinks: resourceLinks.slice(0, 100),
    assignmentLinks: assignmentLinks.slice(0, 100),
    sourceUrl,
    capturedAt,
  }
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
