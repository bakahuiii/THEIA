import * as cheerio from 'cheerio'
import { compactError } from '../util.mjs'
import { AuthRequiredError } from '../source-client.mjs'
import { parseTheolAssignments, parseTheolCourse, parseTheolHome } from '../parsers/theol.mjs'
import { sourceDomainOutcome } from '../domain-provenance.mjs'

const BASE = 'https://course.buct.edu.cn/meol/'
const PERSONAL = new URL('personal.do', BASE).toString()
const PARSER_VERSION = 'theol-adapter/1'
const COURSE_IDENTITY_PARAMETERS = new Set(['courseid', 'lid', 'cateid'])

class CourseContextMismatchError extends Error {
  constructor(message) {
    super(message)
    this.name = 'CourseContextMismatchError'
  }
}

function addUrlCourseIdentities(identities, rawUrl, baseUrl) {
  if (!rawUrl) return
  try {
    const url = new URL(rawUrl, baseUrl)
    for (const [name, value] of url.searchParams) {
      if (COURSE_IDENTITY_PARAMETERS.has(name.toLowerCase()) && value.trim()) identities.add(value.trim())
    }
  } catch {
    // Non-URL DOM attributes are not course identity evidence.
  }
}

function taskListCourseIdentityMatches(result, course) {
  const expected = String(course?.id || '').trim()
  if (!expected) return false

  let finalUrl
  try {
    finalUrl = new URL(result?.url || '')
  } catch {
    return false
  }

  const identities = new Set()
  addUrlCourseIdentities(identities, finalUrl.toString())
  const $ = cheerio.load(String(result?.text || ''))
  $('[name]').each((_index, node) => {
    const name = String($(node).attr('name') || '').trim().toLowerCase()
    const value = String($(node).attr('value') || '').trim()
    if (COURSE_IDENTITY_PARAMETERS.has(name) && value) identities.add(value)
  })
  $('[href], [action], [src]').each((_index, node) => {
    for (const attribute of ['href', 'action', 'src']) {
      addUrlCourseIdentities(identities, $(node).attr(attribute), finalUrl)
    }
  })
  $('script, [onclick]').each((_index, node) => {
    const source = `${$(node).html() || ''} ${$(node).attr('onclick') || ''}`
    const pattern = /["']?(?:courseId|lid|cateId)["']?\s*[:=]\s*["']?(\d+)/gi
    for (const match of source.matchAll(pattern)) identities.add(match[1])
  })

  return identities.size === 0 || [...identities].every((identity) => identity === expected)
}

function courseIdentityMatches(result, course) {
  const expected = String(course?.id || '').trim()
  if (!expected) return false
  try {
    const finalUrl = new URL(result?.url || '')
    const finalCourseId = finalUrl.searchParams.get('courseId')
    if (finalCourseId && finalCourseId !== expected) return false
  } catch {
    return false
  }
  const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:courseId|lid)\\s*(?:[=:]|["']?\\s+value=["'])\\s*["']?${escaped}(?:["'&\\s<]|$)`, 'i')
    .test(String(result?.text || ''))
}

function isCurrentTask(item, now = Date.now()) {
  if (!item?.dueAt) return true
  const dueAt = Date.parse(item.dueAt)
  return !Number.isFinite(dueAt) || dueAt > now
}

function taskListLinks(links) {
  const direct = links.filter((item) => /(?:hwtask|question_test_student_list)/i.test(item.url))
  if (direct.length) return direct
  return links.filter((item) => /(?:课程作业|在线测试|作业|测试|hwtask|test|quiz|exam)/i.test(`${item.title} ${item.url}`)).slice(0, 2)
}

function notAttemptedAssignments() {
  return sourceDomainOutcome({
    source: 'theol',
    attempted: false,
    succeeded: false,
    status: 'not-attempted',
    completeness: 'unknown',
    parserVersion: PARSER_VERSION,
  })
}

export class TheolAdapter {
  constructor(client) {
    this.client = client
  }

  async status() {
    const checkedAt = new Date().toISOString()
    try {
      const result = await this.client.page(PERSONAL, { source: '北化在线THEOL' })
      const parsed = parseTheolHome(result.text, result.url)
      if (!parsed.loggedIn) throw new AuthRequiredError('北化在线THEOL', result.url)
      return { connected: true, checkedAt, url: result.url }
    } catch (error) {
      return { connected: false, checkedAt, authRequired: error instanceof AuthRequiredError, error: compactError(error) }
    }
  }

  async sync(options = {}) {
    const requested = options.domains === undefined ? null : new Set(options.domains)
    if (requested && (!requested.size || [...requested].some((domain) => !['courses', 'notices'].includes(domain)))) {
      throw new TypeError('THEOL sync domains must contain only courses or notices')
    }
    const wants = (domain) => requested === null || requested.has(domain)
    const capturedAt = new Date().toISOString()
    const errors = []
    let homeResult = await this.client.page(PERSONAL, { source: '北化在线THEOL' })
    let home = parseTheolHome(homeResult.text, homeResult.url)
    if (!home.loggedIn) throw new AuthRequiredError('北化在线THEOL', homeResult.url)
    if (!home.courses.length) {
      try {
        homeResult = await this.client.page(new URL('welcomepage/student/index.jsp', BASE), { source: '北化在线THEOL' })
        home = parseTheolHome(homeResult.text, homeResult.url)
      } catch (error) {
        errors.push(compactError(error))
      }
    }

    const courses = [...new Map(home.courses.map((item) => [item.id, item])).values()]
    const notices = [...new Map(home.notices.map((item) => [item.id, item])).values()]
    const outcome = (value, errorCode = null) => sourceDomainOutcome({
      source: 'theol',
      attempted: true,
      succeeded: true,
      status: 'succeeded',
      capturedAt,
      emptyConfirmed: value.length === 0,
      completeness: errors.length ? 'partial' : 'complete',
      parserVersion: PARSER_VERSION,
      errorCode,
    })
    return {
      ...(wants('courses') ? { courses } : {}),
      ...(wants('notices') ? { notices } : {}),
      capturedAt,
      parserVersion: PARSER_VERSION,
      domainOutcomes: {
        ...(wants('courses') ? { courses: outcome(courses, errors.length ? 'partial_course_scan' : null) } : {}),
        ...(requested === null ? { assignments: notAttemptedAssignments() } : {}),
        ...(wants('notices') ? { notices: outcome(notices, errors.length ? 'partial_notice_scan' : null) } : {}),
      },
      errors,
      source: { connected: true, checkedAt: capturedAt, url: homeResult.url, errors },
    }
  }

  async syncAssignments(courses, { shouldContinue = () => true, signal = null } = {}) {
    const capturedAt = new Date().toISOString()
    const errors = []
    const assignments = []
    const successfulCourseIds = []
    const failedCourseIds = []
    const listedCourses = Array.isArray(courses) ? courses.filter((item) => item?.source === 'theol').slice(0, 60) : []

    for (const listedCourse of listedCourses) {
      if (!shouldContinue()) return { aborted: true, capturedAt, errors }
      try {
        let courseComplete = true
        const courseResult = await this.client.page(listedCourse.sourceUrl, { source: `Course task ${listedCourse.title}`, signal })
        if (!shouldContinue()) return { aborted: true, capturedAt, errors }
        if (!courseIdentityMatches(courseResult, listedCourse)) {
          throw new Error('THEOL returned a different course context')
        }
        const course = parseTheolCourse(courseResult.text, { course: listedCourse, sourceUrl: courseResult.url, capturedAt })
        const courseAssignments = []
        for (const taskLink of taskListLinks(course.assignmentLinks || [])) {
          if (!shouldContinue()) return { aborted: true, capturedAt, errors }
          try {
            const taskResult = await this.client.page(taskLink.url, { source: `Task list ${listedCourse.title}`, signal })
            if (!taskListCourseIdentityMatches(taskResult, listedCourse)) {
              throw new CourseContextMismatchError('THEOL returned a different course task context')
            }
            courseAssignments.push(...parseTheolAssignments(taskResult.text, { course, sourceUrl: taskResult.url, capturedAt }))
          } catch (error) {
            if (!shouldContinue() || signal?.aborted) return { aborted: true, capturedAt, errors }
            if (error instanceof AuthRequiredError) throw error
            if (error instanceof CourseContextMismatchError) throw error
            courseComplete = false
            errors.push(`${listedCourse.title}: ${compactError(error)}`)
          }
        }
        assignments.push(...courseAssignments)
        if (courseComplete) successfulCourseIds.push(String(listedCourse.id))
        else failedCourseIds.push(String(listedCourse.id))
      } catch (error) {
        if (!shouldContinue() || signal?.aborted) return { aborted: true, capturedAt, errors }
        if (error instanceof AuthRequiredError) throw error
        failedCourseIds.push(String(listedCourse.id))
        errors.push(`${listedCourse.title}: ${compactError(error)}`)
      }
    }

    const now = Date.now()
    const currentAssignments = [...new Map(assignments.map((item) => [item.id, item])).values()]
      .filter((item) => isCurrentTask(item, now))
    return {
      assignments: currentAssignments,
      successfulCourseIds: [...new Set(successfulCourseIds)],
      failedCourseIds: [...new Set(failedCourseIds)],
      capturedAt,
      parserVersion: PARSER_VERSION,
      domainOutcomes: {
        assignments: sourceDomainOutcome({
          source: 'theol',
          attempted: true,
          succeeded: true,
          status: 'succeeded',
          capturedAt,
          emptyConfirmed: currentAssignments.length === 0,
          completeness: errors.length ? 'partial' : 'complete',
          parserVersion: PARSER_VERSION,
          errorCode: errors.length ? 'partial_assignment_scan' : null,
        }),
      },
      errors,
      source: { connected: true, checkedAt: capturedAt, errors },
    }
  }
}

export const THEOL_URLS = {
  base: BASE,
  login: new URL('homepage/common/sso_login.jsp', BASE).toString(),
  home: PERSONAL,
  personal: PERSONAL,
}
