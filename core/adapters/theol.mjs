import * as cheerio from 'cheerio'
import { compactError, normalizeText } from '../util.mjs'
import { AuthRequiredError } from '../source-client.mjs'
import { parseTheolAssignments, parseTheolCourse, parseTheolCourseResources, parseTheolHome } from '../parsers/theol.mjs'
import { parseTheolMobileTaskList } from '../parsers/theol-mobile.mjs'
import { sourceDomainOutcome } from '../domain-provenance.mjs'

const BASE = 'https://course.buct.edu.cn/meol/'
const PERSONAL = new URL('personal.do', BASE).toString()
const MOBILE_UNDONE_TASKS = 'http://course.buct.edu.cn/mobile/stuUnDoTaskList.do'
const PARSER_VERSION = 'theol-adapter/4'
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
  let finalHasExpected = false
  try {
    const finalUrl = new URL(result?.url || '')
    const finalIdentities = ['courseId', 'lid', 'cateid']
      .map((name) => finalUrl.searchParams.get(name))
      .filter(Boolean)
    if (finalIdentities.some((identity) => identity !== expected)) return false
    finalHasExpected = finalIdentities.includes(expected)
  } catch {
    return false
  }
  const escaped = expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const text = String(result?.text || '')
  const identities = new Set([...text.matchAll(/(?:courseId|lid|cateId)\s*(?:[=:]|["']?\s+value=["'])\s*["']?(\d+)/gi)].map((match) => match[1]))
  const $ = cheerio.load(text)
  $('[href], [action], [src]').each((_index, node) => {
    for (const attribute of ['href', 'action', 'src']) addUrlCourseIdentities(identities, $(node).attr(attribute), result?.url)
  })
  if ([...identities].some((identity) => identity !== expected)) return false
  return finalHasExpected || identities.has(expected)
    || new RegExp(`(?:courseId|lid|cateId)\\s*(?:[=:]|["']?\\s+value=["'])\\s*["']?${escaped}(?:["'&\\s<]|$)`, 'i').test(text)
}

function frameTarget(html, sourceUrl, frameName = 'mainFrame') {
  const $ = cheerio.load(String(html || ''))
  const preferred = $(`frame[name="${frameName}"], iframe[name="${frameName}"]`).first()
  const frame = preferred.length
    ? preferred
    : $('frame[src*="resFolderViewList"], iframe[src*="resFolderViewList"]').first()
  const raw = frame.attr('src')
  if (!raw || /^javascript:/i.test(raw)) return null
  try { return new URL(raw, sourceUrl).toString() } catch { return null }
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

function materialIdentitySafe(result, course) {
  try {
    const url = new URL(result?.url || '')
    const identities = ['courseId', 'lid', 'cateid']
      .map((name) => url.searchParams.get(name))
      .filter(Boolean)
    return identities.length === 0 || identities.every((identity) => identity === String(course?.id || ''))
  } catch {
    return false
  }
}

async function prefetchTeachingMaterials(client, course, materials, signal) {
  const candidates = (Array.isArray(materials) ? materials : [])
    .filter((item) => item?.url && !/(?:download|preview|\.pdf(?:$|\?))/i.test(item.url))
    .slice(0, 4)
  const prefetched = []
  for (const material of candidates) {
    try {
      const result = await client.page(material.url, { source: `Course material ${course.title}`, signal })
      if (!materialIdentitySafe(result, course)) throw new Error('THEOL returned a different course material context')
      const text = normalizeText(cheerio.load(String(result.text || '')).text())
      prefetched.push({
        ...material,
        url: result.url || material.url,
        kind: 'page',
        contentPreview: text.slice(0, 1_200) || null,
        fetchedAt: new Date().toISOString(),
        fetchStatus: 'succeeded',
      })
    } catch (error) {
      if (error instanceof AuthRequiredError || signal?.aborted) throw error
      prefetched.push({
        ...material,
        fetchStatus: 'failed',
        fetchError: compactError(error).slice(0, 240),
      })
    }
  }
  const fetchedById = new Map(prefetched.map((item) => [item.id, item]))
  return (Array.isArray(materials) ? materials : []).map((item) => fetchedById.get(item.id) || item)
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
    if (requested && (!requested.size || [...requested].some((domain) => !['courses', 'notices', 'course-details'].includes(domain)))) {
      throw new TypeError('THEOL sync domains must contain only courses, notices, or course-details')
    }
    const wants = (domain) => requested === null || requested.has(domain)
    const wantsCourseDetails = requested?.has('course-details') === true
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
    let detailedCourses = courses
    let detailErrors = []
    if (wantsCourseDetails) {
      const detailResult = await this.syncCourseDetails(courses)
      const detailsById = new Map(detailResult.courses.map((item) => [String(item.id), item]))
      // Keep the authenticated personal roster authoritative. Detail pages
      // are an enrichment pass and a single failed page must not make that
      // selected course disappear from the canonical course collection.
      detailedCourses = courses.map((item) => ({ ...item, ...(detailsById.get(String(item.id)) || {}) }))
      detailErrors = detailResult.errors
      errors.push(...detailErrors)
    }
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
      ...(wants('courses') || wantsCourseDetails ? { courses: detailedCourses } : {}),
      ...(wants('notices') ? { notices } : {}),
      capturedAt,
      parserVersion: PARSER_VERSION,
      domainOutcomes: {
        ...(wants('courses') ? { courses: outcome(courses, errors.length ? 'partial_course_scan' : null) } : {}),
        ...(wantsCourseDetails ? { 'course-details': sourceDomainOutcome({
          source: 'theol', attempted: true, succeeded: true, status: 'succeeded', capturedAt,
          emptyConfirmed: detailedCourses.length === 0,
          completeness: detailErrors.length ? 'partial' : 'complete',
          parserVersion: PARSER_VERSION,
          errorCode: detailErrors.length ? 'partial_course_detail_scan' : null,
        }) } : {}),
        ...(requested === null ? { assignments: notAttemptedAssignments() } : {}),
        ...(wants('notices') ? { notices: outcome(notices, errors.length ? 'partial_notice_scan' : null) } : {}),
      },
      errors,
      source: { connected: true, checkedAt: capturedAt, url: homeResult.url, errors },
    }
  }

  async syncCourseDetails(courses, { shouldContinue = () => true, signal = null } = {}) {
    const capturedAt = new Date().toISOString()
    const errors = []
    const detailed = []
    const listedCourses = Array.isArray(courses) ? courses.filter((item) => item?.source === 'theol' && item.sourceUrl) : []
    for (const listedCourse of listedCourses) {
      if (!shouldContinue()) return { aborted: true, courses: detailed, capturedAt, errors }
      try {
        const result = await this.client.page(listedCourse.sourceUrl, { source: `Course details ${listedCourse.title}`, signal })
        if (!courseIdentityMatches(result, listedCourse)) throw new CourseContextMismatchError('THEOL returned a different course context')
        let parsed = parseTheolCourse(result.text, { course: listedCourse, sourceUrl: result.url, capturedAt })
        // Syllabus/calendar/basic-info pages are small, stable, and useful in
        // the course dialog. Prefetch only a few page-like links so the normal
        // background detail pass remains bounded and silent.
        parsed = {
          ...parsed,
          teachingMaterials: await prefetchTeachingMaterials(this.client, parsed, parsed.teachingMaterials, signal),
        }
        detailed.push(parsed)
      } catch (error) {
        if (!shouldContinue() || signal?.aborted) return { aborted: true, courses: detailed, capturedAt, errors }
        if (error instanceof AuthRequiredError) throw error
        errors.push(`${listedCourse.title}: ${compactError(error)}`)
      }
    }
    return { courses: detailed, capturedAt, parserVersion: PARSER_VERSION, errors }
  }

  async syncCourseResources(course, { signal = null } = {}) {
    if (!course?.id || course.source !== 'theol') throw new TypeError('THEOL course is required')
    const links = Array.isArray(course.resourceLinks) ? course.resourceLinks : []
    const resourceLink = links.find((item) => /(?:courseResource_stu|common\/script\/courseResource)\.jsp/i.test(item.url))
      || links.find((item) => /buildless\/colUrlStuView\.do/i.test(item.url))
      || { url: new URL(`homepage/course/courseResource_stu.jsp?folderid=0&lid=${encodeURIComponent(course.id)}`, BASE).toString(), title: '课程资源' }
    const entry = await this.client.page(resourceLink.url, { source: `Course resources ${course.title}`, signal })
    if (!courseIdentityMatches(entry, course)) {
      throw new CourseContextMismatchError('THEOL returned a different course resource context')
    }
    const capturedAt = new Date().toISOString()
    const resources = []
    const seen = new Set()
    const queued = new Set()
    const folders = []
    const visitedFolders = []
    const failedFolders = []
    let truncated = false
    let resourceLimitReached = false
    const addParsed = (items) => {
      for (const item of items) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        resources.push(item)
        if (item.kind === 'folder' && !queued.has(item.url)) {
          queued.add(item.url)
          folders.push(item.url)
        }
      }
    }
    const firstListUrl = frameTarget(entry.text, entry.url)
    if (firstListUrl) {
      const list = await this.client.page(firstListUrl, { source: `Course resources ${course.title}`, signal })
      if (!courseIdentityMatches(list, course)) throw new CourseContextMismatchError('THEOL returned a different course resource context')
      addParsed(parseTheolCourseResources(list.text, { courseId: course.id, sourceUrl: list.url, capturedAt }))
    } else {
      addParsed(parseTheolCourseResources(entry.text, { courseId: course.id, sourceUrl: entry.url, capturedAt }))
    }
    const errors = []
    for (let index = 0; index < folders.length && index < 200; index += 1) {
      if (signal?.aborted) throw signal.reason || new Error('课程资源获取已取消')
      const folderUrl = folders[index]
      try {
        visitedFolders.push(folderUrl)
        const folderResult = await this.client.page(folderUrl, { source: `Course resources ${course.title}`, signal })
        if (!courseIdentityMatches(folderResult, course)) throw new CourseContextMismatchError('THEOL returned a different course resource context')
        addParsed(parseTheolCourseResources(folderResult.text, { courseId: course.id, sourceUrl: folderResult.url, capturedAt }))
      } catch (error) {
        if (error instanceof AuthRequiredError || error instanceof CourseContextMismatchError) throw error
        failedFolders.push(folderUrl)
        errors.push(`${folderUrl}: ${compactError(error)}`)
      }
    }
    if (folders.length > 200) truncated = true
    if (resources.length > 2000) {
      truncated = true
      resourceLimitReached = true
    }
    return {
      courseId: String(course.id),
      resources: resources.slice(0, 2000),
      capturedAt,
      parserVersion: PARSER_VERSION,
      errors,
      scan: {
        rootUrl: entry.url,
        visitedFolders,
        failedFolders,
        truncated,
        resourceLimitReached,
        folderLimit: 200,
        resourceLimit: 2000,
        complete: !truncated && failedFolders.length === 0,
      },
    }
  }

  async syncAssignments(courses, { shouldContinue = () => true, signal = null } = {}) {
    const capturedAt = new Date().toISOString()
    const errors = []
    const assignments = []
    const successfulCourseIds = []
    const failedCourseIds = []
    const listedCourses = Array.isArray(courses) ? courses.filter((item) => item?.source === 'theol').slice(0, 60) : []
    let mobileFallback = { attempted: false, status: 'not-needed', added: 0 }
    let mobileFallbackIds = new Set()
    let primaryAssignmentIds = new Set()

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

    // The old official mobile endpoint is only a read-only fallback. It has a
    // global pending-task feed, so it can recover the entire course set when a
    // rendered course page changes shape or fails mid-scan.
    if ((errors.length > 0 || assignments.length === 0) && typeof this.client?.json === 'function') {
      try {
        const payload = await this.client.json(MOBILE_UNDONE_TASKS, {}, {
          source: 'THEOL mobile pending-task fallback', signal,
        })
        if (!shouldContinue()) return { aborted: true, capturedAt, errors }
        const mobile = parseTheolMobileTaskList(payload, { courses: listedCourses, capturedAt })
        if (mobile.authenticated) {
          primaryAssignmentIds = new Set(assignments.map((item) => item.id))
          mobileFallbackIds = new Set(mobile.assignments.map((item) => item.id))
          assignments.push(...mobile.assignments)
          for (const course of listedCourses) successfulCourseIds.push(String(course.id))
          mobileFallback = {
            attempted: true,
            status: 'used',
            added: 0,
          }
          // Remove the courses that mobile successfully covered from the
          // failed list so the outcome reflects the combined result, but
          // keep any remaining failures (courses the mobile fallback does
          // not know about) to avoid masking partial scan issues.
          const mobileCourseIds = new Set(mobile.assignments.map((item) => item.courseId).filter(Boolean))
          const remaining = failedCourseIds.filter((id) => !mobileCourseIds.has(id))
          failedCourseIds.splice(0, failedCourseIds.length, ...remaining)
          // Drop only the error lines for the courses mobile just covered.
          // Anything else stays so a partial scan is never reported as clean.
          const mobileCourseNames = new Set(mobile.assignments.map((item) => item.courseName).filter(Boolean))
          const remainingErrors = errors.filter((entry) => {
            const title = String(entry || '').split(':')[0].trim()
            return !mobileCourseNames.has(title)
          })
          errors.splice(0, errors.length, ...remainingErrors)
        } else {
          mobileFallback = { attempted: true, status: 'not-authenticated', added: 0 }
        }
      } catch (error) {
        if (!shouldContinue() || signal?.aborted) return { aborted: true, capturedAt, errors }
        mobileFallback = { attempted: true, status: 'failed', added: 0, error: compactError(error) }
      }
    }

    const now = Date.now()
    const currentAssignments = [...new Map(assignments.map((item) => [item.id, item])).values()]
      .filter((item) => isCurrentTask(item, now))
    if (mobileFallback.status === 'used') {
      mobileFallback.added = currentAssignments.filter((item) =>
        mobileFallbackIds.has(item.id) && !primaryAssignmentIds.has(item.id)).length
    }
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
      source: { connected: true, checkedAt: capturedAt, errors, mobileFallback },
    }
  }
}

export const THEOL_URLS = {
  base: BASE,
  login: new URL('homepage/common/sso_login.jsp', BASE).toString(),
  home: PERSONAL,
  personal: PERSONAL,
  mobileUndoneTasks: MOBILE_UNDONE_TASKS,
}
