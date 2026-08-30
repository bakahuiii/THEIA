import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * Registers course-work actions that need a user-facing browser or local
 * workspace. Queue ownership stays in the main process; this module only
 * wires the IPC contract to the already initialized services.
 */
export function registerCourseWorkWorkflowIpc({
  ipcMain,
  dialog,
  shell,
  getMainWindow,
  courseWorkService,
  sessionClient,
  syncService,
  store,
  theolAttachmentStore,
  theolAttachmentMaxBytes,
  modelService,
  renderMarkdownToPdf,
  getAuthEpoch = () => 0,
  assertAuthEpoch,
  waitForSchoolProxy = async () => {},
  locateCourseResource,
  openSchedulePdf,
  openCourseWorkWindow,
  attachFileToSourceWindow,
  fillTestInSourceWindow,
  sendSnapshot = () => {},
  getDataRoot = () => '',
} = {}) {
  ipcMain.handle('theia:open-schedule-pdf', () => openSchedulePdf(getAuthEpoch()))

  ipcMain.handle('theia:prepare-course-work', async (_event, assignmentId) => {
    const epoch = getAuthEpoch()
    assertAuthEpoch(epoch)
    const result = await syncService.runTheolInteraction(() => {
      assertAuthEpoch(epoch)
      return courseWorkService.prepare(assignmentId)
    })
    assertAuthEpoch(epoch)
    sendSnapshot()
    return result.snapshot
  })

  ipcMain.handle('theia:open-course-work', async (_event, assignmentId) => {
    const workspace = courseWorkService.validatedWorkspace(assignmentId)
    const outcome = await shell.openPath(workspace.directory)
    if (outcome) throw new Error(outcome)
    return true
  })

  ipcMain.handle('theia:open-assignment-source', async (_event, assignmentId) => {
    const epoch = getAuthEpoch()
    assertAuthEpoch(epoch)
    const entry = courseWorkService.assignmentEntry(assignmentId, { requireCurrent: false })
    await waitForSchoolProxy()
    assertAuthEpoch(epoch)
    await openCourseWorkWindow(entry, epoch)
    return true
  })

  ipcMain.handle('theia:refresh-course-resources', async (_event, courseId) => {
    const epoch = getAuthEpoch()
    assertAuthEpoch(epoch)
    await waitForSchoolProxy()
    assertAuthEpoch(epoch)
    const snapshot = await syncService.retryCourseResources(courseId)
    assertAuthEpoch(epoch)
    sendSnapshot()
    return snapshot
  })

  ipcMain.handle('theia:download-course-resource', async (_event, courseId, resourceId) => {
    const epoch = getAuthEpoch()
    assertAuthEpoch(epoch)
    await waitForSchoolProxy()
    assertAuthEpoch(epoch)
    const { course, resource } = locateCourseResource(courseId, resourceId)
    let cached = await theolAttachmentStore?.find(resource)
    if (!cached) {
      if (!sessionClient || typeof sessionClient.binary !== 'function') throw new Error('THEOL 课程资源下载服务尚未就绪')
      const result = await sessionClient.binary(resource.url, {
        source: `THEOL 课程资源 ${course.title}`,
        maxBytes: theolAttachmentMaxBytes,
      })
      assertAuthEpoch(epoch)
      cached = await theolAttachmentStore.save(resource, result.buffer)
    }
    const capturedAt = new Date().toISOString()
    const snapshot = await store.update((state) => ({
      ...state,
      courses: state.courses.map((item) => {
        if (item?.source !== 'theol' || String(item.id || '') !== String(course.id)) return item
        return {
          ...item,
          courseResources: (Array.isArray(item.courseResources) ? item.courseResources : []).map((entry) => (
            String(entry?.id || '') === String(resource.id) || String(entry?.sourceKey || '') === String(resource.sourceKey)
              ? { ...entry, cachedAt: capturedAt, cachedBytes: cached.bytes, cachedFileName: cached.filename }
              : entry
          )),
        }
      }),
    }))
    sendSnapshot()
    const openError = await shell.openPath(cached.path)
    if (openError) throw new Error(`课程资源已保存，但打开失败：${openError}`)
    return { cached: true, bytes: cached.bytes, filename: cached.filename, opened: true, snapshot }
  })

  ipcMain.handle('theia:import-course-work-file', async (_event, assignmentId, kind) => {
    if (!['answer', 'answer-key'].includes(kind)) throw new Error('不支持的课程任务文件类型')
    const selected = await dialog.showOpenDialog(getMainWindow(), {
      title: kind === 'answer-key' ? '选择在线测试答案 JSON' : '选择待提交文件',
      properties: ['openFile'],
      filters: kind === 'answer-key'
        ? [{ name: 'JSON', extensions: ['json'] }]
        : [{ name: '作业文件', extensions: ['pdf', 'doc', 'docx', 'zip', 'rar', 'txt', 'md', 'ppt', 'pptx', 'xls', 'xlsx'] }, { name: '所有文件', extensions: ['*'] }],
    })
    if (selected.canceled || !selected.filePaths[0]) return { canceled: true, snapshot: store.snapshot() }
    const result = await courseWorkService.importFile(assignmentId, selected.filePaths[0], kind)
    sendSnapshot()
    return { canceled: false, ...result }
  })

  ipcMain.handle('theia:open-submission', async (_event, assignmentId) => {
    const epoch = getAuthEpoch()
    assertAuthEpoch(epoch)
    const entry = courseWorkService.assignmentEntry(assignmentId)
    const selected = await dialog.showOpenDialog(getMainWindow(), {
      title: '选择要提交到北化在线THEOL的文件',
      properties: ['openFile'],
      filters: [{ name: '作业文件', extensions: ['pdf', 'doc', 'docx', 'zip', 'rar', 'txt', 'md', 'ppt', 'pptx', 'xls', 'xlsx'] }, { name: '所有文件', extensions: ['*'] }],
    })
    if (selected.canceled || !selected.filePaths[0]) return { canceled: true, snapshot: store.snapshot(), attached: false }
    assertAuthEpoch(epoch)
    const imported = await courseWorkService.importFile(assignmentId, selected.filePaths[0], 'answer')
    assertAuthEpoch(epoch)
    sendSnapshot()
    const window = await openCourseWorkWindow(entry, epoch)
    assertAuthEpoch(epoch)
    const attached = await attachFileToSourceWindow(window, imported.path)
    assertAuthEpoch(epoch)
    return { canceled: false, snapshot: imported.snapshot, ...attached }
  })

  ipcMain.handle('theia:apply-test-answers', async (_event, assignmentId) => {
    const epoch = getAuthEpoch()
    assertAuthEpoch(epoch)
    const entry = courseWorkService.assignmentEntry(assignmentId)
    const { assignment } = entry
    if (assignment.kind !== 'online-test') throw new Error('该任务不是在线测试')
    const answerKey = await courseWorkService.answerKey(assignmentId)
    assertAuthEpoch(epoch)
    const window = await openCourseWorkWindow(entry, epoch)
    assertAuthEpoch(epoch)
    const result = await fillTestInSourceWindow(window, answerKey)
    assertAuthEpoch(epoch)
    const snapshot = await courseWorkService.recordTestFill(assignmentId, result)
    sendSnapshot()
    return { snapshot, ...result }
  })

  ipcMain.handle('theia:summarize-notices', async () => {
    const state = store.snapshot()
    return modelService.summarizeNotices(state.settings, {
      assignments: state.assignments,
      notices: state.notices,
      courses: state.courses,
      dataRoot: getDataRoot(),
    })
  })

  ipcMain.handle('theia:generate-notes', async (_event, assignmentId, options) => {
    const result = await modelService.generateNotes(assignmentId, store.snapshot().settings, options || {})
    sendSnapshot()
    return result.snapshot
  })

  ipcMain.handle('theia:generate-paper', async (_event, assignmentId, options) => {
    const result = await modelService.generatePaper(assignmentId, store.snapshot().settings, options || {})
    sendSnapshot()
    return result.snapshot
  })

  ipcMain.handle('theia:render-answer-pdf', async (_event, assignmentId) => {
    const workspace = courseWorkService.validatedWorkspace(assignmentId)
    if (!workspace?.modelAnswerPath) throw new Error('请先使用模型生成答案，再渲染 PDF')
    const markdown = await readFile(workspace.modelAnswerPath, 'utf8').catch(() => { throw new Error('答案文件无法读取，请重新生成') })
    const title = workspace.title || '课程作业答案'
    const pdfBuffer = await renderMarkdownToPdf(markdown, { title })
    const pdfPath = resolve(workspace.directory, 'model-answer.pdf')
    await writeFile(pdfPath, pdfBuffer)
    const snapshot = await store.update((state) => ({
      ...state,
      workspaces: state.workspaces.map((item) => item.assignmentId === assignmentId ? {
        ...item,
        modelAnswerPdfPath: pdfPath,
        updatedAt: new Date().toISOString(),
      } : item),
    }))
    sendSnapshot()
    return { snapshot, pdfPath }
  })

  ipcMain.handle('theia:open-answer-pdf', async (_event, assignmentId) => {
    const workspace = courseWorkService.validatedWorkspace(assignmentId)
    if (!workspace?.modelAnswerPdfPath) throw new Error('请先渲染 PDF 答案')
    const outcome = await shell.openPath(workspace.modelAnswerPdfPath)
    if (outcome) throw new Error(outcome)
    return true
  })

  ipcMain.handle('theia:render-md-file', async (_event, assignmentId, fileKey) => {
    // Renders any of: modelAnswerPath, notesPath, paperPath -> sibling PDF.
    const workspace = courseWorkService.validatedWorkspace(assignmentId)
    const allowed = ['modelAnswerPath', 'notesPath', 'paperPath']
    if (!allowed.includes(fileKey)) throw new Error('不支持的渲染目标')
    const mdPath = workspace?.[fileKey]
    if (!mdPath) throw new Error('请先生成该文件，再渲染 PDF')
    const markdown = await readFile(mdPath, 'utf8').catch(() => { throw new Error('文件无法读取，请重新生成') })
    const title = workspace.title || '文档'
    const pdfBuffer = await renderMarkdownToPdf(markdown, { title })
    const outputName = fileKey === 'modelAnswerPath' ? 'model-answer.pdf' : fileKey === 'notesPath' ? 'notes.pdf' : 'paper.pdf'
    const pdfPath = resolve(workspace.directory, outputName)
    await writeFile(pdfPath, pdfBuffer)
    const pdfKey = fileKey.replace(/Path$/, 'PdfPath')
    const snapshot = await store.update((state) => ({
      ...state,
      workspaces: state.workspaces.map((item) => item.assignmentId === assignmentId ? {
        ...item, [pdfKey]: pdfPath, updatedAt: new Date().toISOString(),
      } : item),
    }))
    sendSnapshot()
    return { snapshot, pdfPath }
  })
}
