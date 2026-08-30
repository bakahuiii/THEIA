import { Notification } from 'electron'
import { CourseWorkQueue } from '../core/course-work-queue.mjs'

/**
 * Owns the persistent background course-work queue and its desktop
 * notifications. The main process supplies the service graph and auth epoch
 * checks, while queue lifecycle stays local to this capability.
 */
export async function startCourseWorkQueue({
  root,
  store,
  courseWorkService,
  syncService,
  modelService,
  getMainWindow,
  getAuthEpoch,
  assertAuthEpoch,
  writeDiagnostic,
  sendSnapshot,
}) {
  const notifiedJobs = new Set()
  let queueReady = false
  const queue = new CourseWorkQueue({
    root,
    concurrency: 1,
    onDiagnostic: (event, fields) => writeDiagnostic(event, fields),
    onChange: (queueSnapshot) => {
      const window = getMainWindow()
      if (window && !window.isDestroyed()) window.webContents.send('theia:course-work-queue', queueSnapshot)
      for (const job of queueSnapshot.jobs || []) {
        if (!job.completedAt || !['succeeded', 'failed', 'cancelled'].includes(job.status)) continue
        const notificationKey = `${job.id}:${job.status}:${job.updatedAt}`
        if (notifiedJobs.has(notificationKey)) continue
        notifiedJobs.add(notificationKey)
        if (!queueReady || !Notification.isSupported()) continue
        const title = job.status === 'succeeded' ? 'THEIA · 课程任务完成' : 'THEIA · 课程任务未完成'
        new Notification({
          title,
          body: `${job.assignmentId} · ${job.lastError || '本地结果已保存'}`.slice(0, 500),
          silent: false,
        }).show()
      }
    },
    processor: async ({ job, signal }) => {
      const epoch = getAuthEpoch()
      const assertCurrent = () => {
        if (signal.aborted) throw signal.reason || new Error('后台课程任务已取消')
        assertAuthEpoch(epoch)
      }
      assertCurrent()
      let result
      if (job.operation === 'prepare') {
        result = await syncService.runTheolInteraction(() => {
          assertCurrent()
          return courseWorkService.prepare(job.assignmentId)
        })
      } else if (job.operation === 'model') {
        result = await modelService.process(job.assignmentId, store.snapshot().settings)
      } else if (job.operation === 'notes') {
        result = await modelService.generateNotes(job.assignmentId, store.snapshot().settings, job.options)
      } else if (job.operation === 'paper') {
        result = await modelService.generatePaper(job.assignmentId, store.snapshot().settings, job.options)
      } else {
        const error = new Error('不支持的后台课程任务操作')
        error.retryable = false
        throw error
      }
      assertCurrent()
      sendSnapshot()
      return { status: job.operation, message: '本地结果已保存' }
    },
  })
  await queue.load()
  queueReady = true
  return queue
}
