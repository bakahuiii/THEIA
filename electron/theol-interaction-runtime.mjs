import { permittedSourceUrl } from '../core/source-url-policy.mjs'

const THEOL_INTERACTION_COURSE_PATHS = new Set([
  '/meol/homepage/course/course_index.jsp',
  '/meol/jpk/course/layout/newpage/index.jsp',
])
const THEOL_INTERACTION_TASK_TYPES = Object.freeze({
  assignment: {
    path: '/meol/common/hw/student/hwtask.view.jsp',
    parameter: 'hwtid',
    evidence: 'homework',
  },
  'online-test': {
    path: '/meol/common/question/test/student/stu_qtest_navigate.jsp',
    parameter: 'testId',
    evidence: 'test',
  },
})

/**
 * Owns the single mutable THEOL interaction window tree. Main-process wiring
 * supplies navigation guards and sync services; this module owns actor
 * identity, navigation evidence, reuse, and lifecycle cleanup.
 */
export function createTheolInteractionRuntime({
  BrowserWindow,
  sourceWindowOptions,
  guardSourceWindow,
  closeWindowAndWait,
  getSyncService,
  getAuthEpoch,
  isExplicitlyLoggedOut = () => false,
  assertAuthEpoch,
  writeDiagnostic = () => {},
  diagnosticUrl = (value) => String(value || ''),
  diagnosticError = (error) => String(error?.message || error || 'unknown error'),
} = {}) {
  if (typeof getSyncService !== 'function') throw new TypeError('THEOL interaction runtime requires getSyncService')
  if (typeof getAuthEpoch !== 'function') throw new TypeError('THEOL interaction runtime requires getAuthEpoch')
  if (typeof assertAuthEpoch !== 'function') throw new TypeError('THEOL interaction runtime requires assertAuthEpoch')
  if (typeof guardSourceWindow !== 'function') throw new TypeError('THEOL interaction runtime requires guardSourceWindow')

  let currentActor = null

  function isCurrentActor(actor) {
    return Boolean(
      actor
      && !actor.invalidated
      && actor.epoch === getAuthEpoch()
      && currentActor === actor,
    )
  }

  function focusWindow(actor) {
    const window = actor.root && !actor.root.isDestroyed()
      ? actor.root
      : [...actor.windows].find((candidate) => !candidate.isDestroyed())
    if (!window) return null
    return window
  }

  function normalizeNavigationCheck(check) {
    if (!check || typeof check !== 'object') return null
    const type = check.type === 'course' ? 'course' : check.type === 'task' ? 'task' : null
    const courseId = String(check.courseId || '').trim()
    if (!type || !/^[a-zA-Z0-9_-]+$/.test(courseId)) {
      throw new Error('THEOL navigation identity is invalid')
    }
    if (type === 'course') return { type, courseId }
    const taskType = THEOL_INTERACTION_TASK_TYPES[check.kind]
    const uniqueTaskId = String(check.uniqueTaskId || '')
    const taskId = uniqueTaskId.slice(uniqueTaskId.indexOf(':') + 1)
    if (!taskType || uniqueTaskId !== `${check.kind}:${taskId}` || !/^\d+$/.test(taskId)) {
      throw new Error('THEOL task navigation identity is invalid')
    }
    return { type, courseId, kind: check.kind, uniqueTaskId, taskId }
  }

  function validateNavigationUrl(rawUrl, check) {
    const finalUrl = new URL(permittedSourceUrl(rawUrl))
    if (finalUrl.hostname !== 'course.buct.edu.cn' || finalUrl.port) {
      throw new Error('THEOL navigation left the course platform')
    }
    if (check.type === 'course') {
      const courseIds = finalUrl.searchParams.getAll('courseId')
      if (!THEOL_INTERACTION_COURSE_PATHS.has(finalUrl.pathname.toLowerCase())
        || courseIds.length !== 1
        || courseIds[0] !== check.courseId) {
        throw new Error('THEOL returned a different course page')
      }
      return
    }
    const taskType = THEOL_INTERACTION_TASK_TYPES[check.kind]
    const taskIds = finalUrl.searchParams.getAll(taskType.parameter)
    if (finalUrl.pathname.toLowerCase() !== taskType.path
      || taskIds.length !== 1
      || taskIds[0] !== check.taskId) {
      throw new Error('THEOL returned a different task page')
    }
  }

  async function readNavigationIdentity(window) {
    const combined = {
      courseFields: [], courseUrls: [],
      homeworkFields: [], homeworkUrls: [],
      testFields: [], testUrls: [],
    }
    const frames = window.webContents.mainFrame.framesInSubtree
    for (const frame of frames) {
      const identity = await frame.executeJavaScript(`(() => {
        const result = {
          courseFields: [], courseUrls: [],
          homeworkFields: [], homeworkUrls: [],
          testFields: [], testUrls: [],
        }
        const fieldBuckets = {
          courseid: result.courseFields,
          lid: result.courseFields,
          hwtid: result.homeworkFields,
          testid: result.testFields,
        }
        const urlBuckets = {
          courseid: result.courseUrls,
          lid: result.courseUrls,
          hwtid: result.homeworkUrls,
          testid: result.testUrls,
        }
        const add = (bucket, value) => {
          const normalized = String(value || '').trim()
          if (normalized && !bucket.includes(normalized)) bucket.push(normalized)
        }
        const inspectUrl = (rawValue) => {
          const value = String(rawValue || '').trim()
          if (!value || value === '###' || /^javascript:/i.test(value)) return
          try {
            const candidate = new URL(value, document.baseURI)
            for (const [name, parameterValue] of candidate.searchParams) {
              const bucket = urlBuckets[String(name).toLowerCase()]
              if (bucket) add(bucket, parameterValue)
            }
          } catch { /* non-URL attributes provide no identity evidence */ }
        }
        const selector = '[name], [href], [src], [action], [data-url], [data-href], [data-course-id], [data-lid], [data-hwtid], [data-test-id]'
        for (const element of document.querySelectorAll(selector)) {
          const name = String(element.getAttribute('name') || '').toLowerCase()
          const fieldBucket = fieldBuckets[name]
          if (fieldBucket) add(fieldBucket, element.value ?? element.getAttribute('value'))
          for (const [attribute, bucketName] of [
            ['data-course-id', 'courseFields'],
            ['data-lid', 'courseFields'],
            ['data-hwtid', 'homeworkFields'],
            ['data-test-id', 'testFields'],
          ]) {
            if (element.hasAttribute(attribute)) add(result[bucketName], element.getAttribute(attribute))
          }
          for (const attribute of ['href', 'src', 'action', 'data-url', 'data-href']) {
            if (element.hasAttribute(attribute)) inspectUrl(element.getAttribute(attribute))
          }
        }
        return result
      })()`).catch(() => null)
      if (!identity) continue
      for (const key of Object.keys(combined)) {
        for (const value of identity[key] || []) {
          if (!combined[key].includes(value)) combined[key].push(value)
        }
      }
    }
    return combined
  }

  async function validateNavigationStep(window, check) {
    validateNavigationUrl(window.webContents.getURL(), check)
    const identity = await readNavigationIdentity(window)
    const courseEvidence = [...identity.courseFields, ...identity.courseUrls]
    if (check.type === 'course' && !courseEvidence.includes(check.courseId)) {
      throw new Error('THEOL page did not prove the expected course context')
    }
    if (identity.courseFields.some((courseId) => courseId !== check.courseId)) {
      throw new Error('THEOL page contains a different course context')
    }
    if (check.type === 'course') return
    const taskType = THEOL_INTERACTION_TASK_TYPES[check.kind]
    const taskFields = taskType.evidence === 'homework' ? identity.homeworkFields : identity.testFields
    const taskUrls = taskType.evidence === 'homework' ? identity.homeworkUrls : identity.testUrls
    if (![...taskFields, ...taskUrls].includes(check.taskId)
      || taskFields.some((taskId) => taskId !== check.taskId)) {
      throw new Error('THEOL page did not prove the expected task identity')
    }
  }

  async function runActor(actor) {
    actor.assertCurrentSnapshot?.()
    const syncService = getSyncService()
    actor.resumeAssignments = syncService.pauseAssignmentScan()
    await syncService.waitForAssignmentScan()
    if (!isCurrentActor(actor)) return
    actor.assertCurrentSnapshot?.()

    await syncService.runTheolExclusive(async () => {
      if (!isCurrentActor(actor)) return
      actor.assertCurrentSnapshot?.()
      let window = null
      try {
        actor.assertCurrentSnapshot?.()
        window = new BrowserWindow(sourceWindowOptions({ title: actor.title, show: false }))
        actor.root = window
        guardSourceWindow(window, {
          source: 'theol',
          theolActor: actor,
          theolLease: true,
        })
        for (const [index, url] of actor.navigationUrls.entries()) {
          actor.assertCurrentSnapshot?.()
          await window.loadURL(url)
          actor.assertCurrentSnapshot?.()
          if (!isCurrentActor(actor) || window.isDestroyed()) {
            throw new Error('北化在线THEOL交互窗口已关闭')
          }
          const check = actor.navigationChecks[index]
          if (check) {
            await validateNavigationStep(window, check)
            actor.assertCurrentSnapshot?.()
          }
        }
        actor.assertCurrentSnapshot?.()
        actor.validated = true
        actor.resolveOpened(window)
        await actor.closed
      } catch (error) {
        actor.rejectOpened(error)
        await Promise.all([...actor.windows].map((candidate) => closeWindowAndWait(candidate)))
        if (actor.windows.size) await actor.closed
        throw error
      }
    })
  }

  async function finishActor(actor) {
    if (currentActor === actor) currentActor = null
    actor.resumeAssignments?.({ schedule: false })
    actor.resumeAssignments = null
    if (actor.invalidated || actor.epoch !== getAuthEpoch() || isExplicitlyLoggedOut()) return
    try {
      await getSyncService().syncNow({ sources: ['theol'] })
    } catch (error) {
      if (actor.epoch === getAuthEpoch() && !isExplicitlyLoggedOut()) {
        void writeDiagnostic('sync.post_theol_interaction_failed', { error: diagnosticError(error) })
      }
    }
  }

  function createActor(url, title, {
    navigationUrls = [url],
    navigationChecks = [],
    interactionKey = url,
    assertCurrentSnapshot = null,
  } = {}) {
    let resolveOpened
    let rejectOpened
    let resolveClosed
    const opened = new Promise((resolve, reject) => {
      resolveOpened = resolve
      rejectOpened = reject
    })
    // The IPC caller normally observes this promise immediately. Keep a
    // handler attached for the logout-before-open race as well.
    void opened.catch(() => undefined)
    const closed = new Promise((resolve) => { resolveClosed = resolve })
    const actor = {
      epoch: getAuthEpoch(),
      url,
      navigationUrls,
      navigationChecks,
      interactionKey,
      assertCurrentSnapshot: typeof assertCurrentSnapshot === 'function' ? assertCurrentSnapshot : null,
      title,
      root: null,
      windows: new Set(),
      validated: navigationChecks.length === 0,
      invalidated: false,
      resumeAssignments: null,
      opened,
      closed,
      resolveOpened,
      rejectOpened,
      resolveClosed,
      lifecycle: null,
    }
    currentActor = actor
    actor.lifecycle = runActor(actor)
      .catch((error) => {
        actor.rejectOpened(error)
        if (!actor.invalidated && actor.epoch === getAuthEpoch()) {
          void writeDiagnostic('theol.interaction_failed', { url: diagnosticUrl(url), error: diagnosticError(error) })
        }
      })
      .finally(() => finishActor(actor))
    return actor
  }

  async function open(rawUrl, title, options = {}) {
    const epoch = getAuthEpoch()
    assertAuthEpoch(epoch)
    const assertCurrentSnapshot = typeof options.assertCurrentSnapshot === 'function'
      ? options.assertCurrentSnapshot
      : null
    assertCurrentSnapshot?.()
    const url = permittedSourceUrl(rawUrl)
    const navigationUrls = (options.navigationUrls?.length ? options.navigationUrls : [url])
      .map((candidate) => permittedSourceUrl(candidate))
    if (navigationUrls.at(-1) !== url) throw new Error('北化在线THEOL交互导航的最终页面无效')
    const navigationChecks = Array.isArray(options.navigationChecks)
      ? options.navigationChecks.map(normalizeNavigationCheck)
      : []
    if (navigationChecks.length && navigationChecks.length !== navigationUrls.length) {
      throw new Error('THEOL navigation checks do not match the requested steps')
    }
    const interactionKey = String(options.interactionKey || url)
    const current = currentActor
    if (isCurrentActor(current)) {
      if (current.interactionKey !== interactionKey) {
        throw new Error('北化在线THEOL已有其他页面正在交互，请关闭当前窗口后再打开新页面')
      }
      await current.opened
      assertAuthEpoch(epoch)
      assertCurrentSnapshot?.()
      if (!isCurrentActor(current)) throw new Error('北化在线THEOL交互窗口已关闭，请重试')
      assertCurrentSnapshot?.()
      const reused = focusWindow(current)
      if (!reused) throw new Error('北化在线THEOL交互窗口已关闭，请重试')
      return reused
    }
    if (isExplicitlyLoggedOut()) throw new Error('请先登录北化在线THEOL')
    assertCurrentSnapshot?.()
    const actor = createActor(url, title, {
      navigationUrls,
      navigationChecks,
      interactionKey,
      assertCurrentSnapshot,
    })
    const window = await actor.opened
    assertAuthEpoch(epoch)
    assertCurrentSnapshot?.()
    return focusWindow(actor) || window
  }

  function invalidateCurrent(reason = '显式退出已取消北化在线THEOL交互') {
    const actor = currentActor
    currentActor = null
    if (!actor) return null
    actor.invalidated = true
    actor.rejectOpened(new Error(reason))
    if (!actor.windows.size) actor.resolveClosed()
    return actor
  }

  return Object.freeze({
    open,
    current: () => currentActor,
    invalidateCurrent,
  })
}
