import { normalizeText, parseDateLike, stableId } from '../util.mjs'

const BASE = 'https://course.buct.edu.cn/meol/'

function statusCode(value) {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function mobileTaskGroups(course) {
  return Object.entries(course || {})
    .filter(([key, value]) => /^reminderList/i.test(key) && Array.isArray(value))
    .flatMap(([, value]) => value)
}

function unavailableTask(item) {
  return item?.publishStatus === false || item?.publishStatus === 0 || item?.publishStatus === 'false'
}

function mobileTaskKind(item) {
  return Object.hasOwn(item || {}, 'expiredTime') || Object.hasOwn(item || {}, 'examType')
    ? 'online-test'
    : 'assignment'
}

function mobileTaskUrl(kind, id) {
  const path = kind === 'online-test'
    ? `common/question/test/student/stu_qtest_navigate.jsp?testId=${encodeURIComponent(id)}`
    : `common/hw/student/hwtask.view.jsp?hwtid=${encodeURIComponent(id)}`
  return new URL(path, BASE).toString()
}

function courseUrl(courseId) {
  return new URL(`homepage/course/course_index.jsp?courseId=${encodeURIComponent(courseId)}`, BASE).toString()
}

function knownCourse(courses, courseId) {
  return (courses || []).find((course) => String(course?.id || '').trim() === courseId) || null
}

// The endpoint has historically returned a sessionid alongside the payload.
// This parser intentionally accepts only task fields and never returns it.
export function parseTheolMobileTaskList(payload, { courses = [], capturedAt = new Date().toISOString() } = {}) {
  const status = statusCode(payload?.status)
  if (status === -2) return { authenticated: false, assignments: [] }
  if (status !== 1 || !Array.isArray(payload?.datas)) {
    throw new Error('THEOL mobile task endpoint returned an unsupported payload')
  }

  const assignments = []
  for (const courseItem of payload.datas) {
    const courseId = String(courseItem?.courseId ?? '').trim()
    if (!/^\d+$/.test(courseId)) continue
    const course = knownCourse(courses, courseId)
    // The mobile endpoint is a global pending-task feed. Never import a task
    // for a course that is not present in the current authenticated roster.
    if (!course) continue
    const courseName = normalizeText(courseItem?.courseName) || course?.title || null
    for (const task of mobileTaskGroups(courseItem)) {
      if (!task || typeof task !== 'object' || unavailableTask(task)) continue
      const taskId = String(task.id ?? '').trim()
      const title = normalizeText(task.title)
      if (!/^\d+$/.test(taskId) || !title) continue
      const kind = mobileTaskKind(task)
      assignments.push({
        id: stableId('theol-assignment', kind, taskId),
        kind,
        courseId,
        courseName,
        courseSourceUrl: course.sourceUrl || courseUrl(courseId),
        title,
        dueAt: parseDateLike(kind === 'online-test' ? task.expiredTime : task.deadline),
        status: 'pending',
        source: 'theol',
        sourceUrl: mobileTaskUrl(kind, taskId),
        capturedAt,
      })
    }
  }

  return {
    authenticated: true,
    assignments: [...new Map(assignments.map((item) => [item.id, item])).values()].slice(0, 500),
  }
}
