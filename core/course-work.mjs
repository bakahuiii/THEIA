import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import * as cheerio from 'cheerio'
import { answerTemplate, normalizeAnswerKey, parseTheolWorkPage } from './parsers/theol-work.mjs'
import { attachmentTextSection, extractAttachmentText } from './attachment-reader.mjs'
import { MAX_ATTACHMENT_RESPONSE_BYTES } from './source-client.mjs'
import { sourceDomainOutcome, withDomainProvenance } from './domain-provenance.mjs'

const WORK_SCHEMA = 'theia-course-work/v1'
const ANSWER_KEY_FILE = 'answers.json'
const MAX_ATTACHMENTS = 20
const MAX_TOTAL_ATTACHMENT_BYTES = 128 * 1024 * 1024
const THEOL_HOST = 'course.buct.edu.cn'
const COURSE_ENTRY_PATHS = new Set([
  '/meol/homepage/course/course_index.jsp',
  '/meol/jpk/course/layout/newpage/index.jsp',
])
const ASSIGNMENT_ENTRY_TYPES = Object.freeze([
  {
    path: '/meol/common/hw/student/hwtask.view.jsp',
    parameter: 'hwtid',
    kind: 'assignment',
  },
  {
    path: '/meol/common/question/test/student/stu_qtest_navigate.jsp',
    parameter: 'testId',
    kind: 'online-test',
  },
])
const FIXED_WORKSPACE_FILES = Object.freeze({
  manifestPath: 'manifest.json',
  taskPath: 'task.md',
  answerKeyPath: ANSWER_KEY_FILE,
  modelAnswerPath: 'model-answer.md',
  modelAnswerPdfPath: 'model-answer.pdf',
  notesPath: 'notes.md',
  notesPdfPath: 'notes.pdf',
  paperPath: 'paper.md',
  paperPdfPath: 'paper.pdf',
})
const WORKSPACE_PATH_FIELDS = [...Object.keys(FIXED_WORKSPACE_FILES), 'submissionPath']

function withWorkspaceProvenance(state, capturedAt = new Date().toISOString()) {
  const runId = randomUUID()
  const common = {
    source: 'local-course-work',
    runId,
    attempted: true,
    succeeded: true,
    attemptedAt: capturedAt,
    completedAt: capturedAt,
    capturedAt,
    sourceSucceededAt: capturedAt,
    parserVersion: WORK_SCHEMA,
  }
  return withDomainProvenance(state, {
    'local-course-work': {
      workspaces: sourceDomainOutcome({ ...common, completeness: 'complete' }),
      coursework: sourceDomainOutcome({ ...common, completeness: 'partial' }),
    },
  }, { runId })
}

function samePath(left, right) {
  const normalizedLeft = resolve(String(left || ''))
  const normalizedRight = resolve(String(right || ''))
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

function validSubmissionPath(value, directory) {
  if (!value) return false
  const filename = basename(String(value))
  return filename.startsWith('submission-') && samePath(value, resolve(directory, filename))
}

function safePreviousWorkspace(previous, directory) {
  if (!previous) return {}
  const safe = { ...previous }
  for (const field of WORKSPACE_PATH_FIELDS) delete safe[field]
  for (const [field, filename] of Object.entries(FIXED_WORKSPACE_FILES)) {
    if (previous[field] && samePath(previous[field], resolve(directory, filename))) safe[field] = resolve(directory, filename)
  }
  if (validSubmissionPath(previous.submissionPath, directory)) safe.submissionPath = resolve(previous.submissionPath)
  return safe
}

function safeName(value, fallback = 'attachment') {
  const normalized = String(value || fallback).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim()
  return (normalized || fallback).slice(0, 120)
}

function safeDirectoryId(value) {
  const id = String(value || '')
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw new Error('无效的课程任务标识')
  return id
}

function filenameForAttachment(attachment, index) {
  try {
    const parsed = new URL(attachment.url)
    const named = parsed.searchParams.get('filename') || parsed.searchParams.get('fileName') || basename(parsed.pathname)
    const rawExtension = extname(named) || extname(parsed.pathname)
    const extension = /^\.[a-zA-Z0-9]{1,10}$/.test(rawExtension) ? rawExtension : ''
    const base = safeName(named.replace(/\.[^.]+$/, ''), `attachment-${index + 1}`)
    return `${base}${extension}`
  } catch {
    return `${safeName(attachment.title, `attachment-${index + 1}`)}.bin`
  }
}

function uniqueAttachmentName(filename, usedNames) {
  const extension = extname(filename)
  const stem = filename.slice(0, filename.length - extension.length)
  let candidate = filename
  let suffix = 2
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${stem}-${suffix}${extension}`
    suffix += 1
  }
  usedNames.add(candidate.toLowerCase())
  return candidate
}

function currentAssignment(assignment) {
  if (!assignment || assignment.status === 'submitted') return false
  if (!assignment.dueAt) return true
  const dueAt = Date.parse(assignment.dueAt)
  return !Number.isFinite(dueAt) || dueAt > Date.now()
}

function theolUrl(rawUrl, label) {
  let url
  try { url = new URL(String(rawUrl || '')) } catch { throw new Error(`${label}无效`) }
  if (
    url.protocol !== 'https:'
    || url.hostname !== THEOL_HOST
    || url.port
    || url.username
    || url.password
  ) {
    throw new Error(`${label}不是安全的北化在线THEOL地址`)
  }
  return url
}

function courseEntryUrl(rawUrl, expectedCourseId) {
  const url = theolUrl(rawUrl, '北化在线THEOL课程入口')
  if (!COURSE_ENTRY_PATHS.has(url.pathname.toLowerCase())) {
    throw new Error('北化在线THEOL课程入口不是受支持的课程页面')
  }
  const identifiers = url.searchParams.getAll('courseId').map((value) => value.trim())
  if (identifiers.length !== 1 || !/^[a-zA-Z0-9_-]+$/.test(identifiers[0])) {
    throw new Error('北化在线THEOL课程入口缺少唯一课程标识')
  }
  if (!expectedCourseId || identifiers[0] !== String(expectedCourseId).trim()) {
    throw new Error('北化在线THEOL课程入口与任务课程不一致')
  }
  return url.toString()
}

function assignmentEntryUrl(rawUrl, expectedKind) {
  const url = theolUrl(rawUrl, '北化在线THEOL任务入口')
  const type = ASSIGNMENT_ENTRY_TYPES.find((candidate) => candidate.path === url.pathname.toLowerCase())
  if (!type) throw new Error('北化在线THEOL任务入口不是唯一任务详情页')
  const identifiers = url.searchParams.getAll(type.parameter).map((value) => value.trim())
  if (identifiers.length !== 1 || !/^\d+$/.test(identifiers[0])) {
    throw new Error('北化在线THEOL任务入口缺少唯一任务标识')
  }
  if (expectedKind && expectedKind !== type.kind) {
    throw new Error('北化在线THEOL任务类型与详情入口不一致')
  }
  return {
    url: url.toString(),
    kind: type.kind,
    uniqueTaskId: `${type.kind}:${identifiers[0]}`,
  }
}

function pageCourseIdentities(result) {
  const identities = new Set()
  let pageUrl
  try {
    pageUrl = theolUrl(result?.url, '北化在线THEOL返回页面')
  } catch (error) {
    throw new Error(`北化在线THEOL返回了无效页面: ${error instanceof Error ? error.message : String(error)}`)
  }
  for (const parameter of ['courseId', 'lid', 'cateId']) {
    for (const value of pageUrl.searchParams.getAll(parameter)) {
      if (value.trim()) identities.add(value.trim())
    }
  }

  const $ = cheerio.load(String(result?.text || ''))
  $('[name]').each((_index, node) => {
    const name = String($(node).attr('name') || '').trim().toLowerCase()
    const value = String($(node).attr('value') || '').trim()
    if (['courseid', 'lid', 'cateid'].includes(name) && value) identities.add(value)
  })
  $('script, [onclick]').each((_index, node) => {
    const source = `${$(node).html() || ''} ${$(node).attr('onclick') || ''}`
    const pattern = /["']?(?:courseId|lid|cateId)["']?\s*[:=]\s*["']?([a-zA-Z0-9_-]+)/gi
    for (const match of source.matchAll(pattern)) identities.add(match[1])
  })
  return { pageUrl, identities }
}

function assertCourseContext(result, expectedCourseId, { requireEvidence = false } = {}) {
  const expected = String(expectedCourseId || '').trim()
  const { identities } = pageCourseIdentities(result)
  if (requireEvidence && identities.size === 0) {
    throw new Error('北化在线THEOL返回页面无法确认任务所属课程')
  }
  if ([...identities].some((identity) => identity !== expected)) {
    throw new Error('北化在线THEOL返回了其他课程的页面，已停止处理')
  }
}

function assertAssignmentPage(result, entry) {
  const detail = assignmentEntryUrl(result?.url, entry.kind)
  if (detail.uniqueTaskId !== entry.uniqueTaskId) {
    throw new Error('北化在线THEOL返回了其他任务的详情页，已停止处理')
  }
  assertCourseContext(result, entry.assignment.courseId)
}

function taskMarkdown({ assignment, parsed, attachments, preparedAt }) {
  const lines = [
    `# ${assignment.title}`,
    '',
    `- 课程：${assignment.courseName || '未关联课程'}`,
    `- 类型：${assignment.kind === 'online-test' ? '在线测试' : '作业'}`,
    `- 截止：${assignment.dueAt || '未提供'}`,
    `- 准备时间：${preparedAt}`,
    '',
    '## 题目内容',
    '',
    parsed.instructions || '北化在线THEOL未返回可解析的文字内容，请在内置浏览器中查看原题。',
  ]
  if (attachments.length) {
    lines.push('', '## 已下载附件', '')
    for (const attachment of attachments) lines.push(`- [${attachment.title}](${encodeURI(attachment.file)})`)
  }
  if (parsed.questions.length) {
    lines.push('', '## 测试题目', '')
    for (const question of parsed.questions) {
      lines.push(`### ${question.index}. ${question.prompt}`, '')
      for (const choice of question.choices) lines.push(`- ${choice.label}`)
      lines.push('')
    }
  }
  lines.push('', '## 处理约定', '', '在此目录中保存作业结果；在线测试请按 answers.template.json 的格式生成答案 JSON。提交前请在 THEIA 内置浏览器中核对。', '')
  return lines.join('\n')
}

function workspaceRecord({ assignment, directory, parsed, attachments, preparedAt, previous }) {
  const preserved = safePreviousWorkspace(previous, directory)
  return {
    ...preserved,
    id: assignment.id,
    assignmentId: assignment.id,
    courseName: assignment.courseName || null,
    title: assignment.title,
    kind: assignment.kind || 'assignment',
    dueAt: assignment.dueAt || null,
    sourceUrl: assignment.sourceUrl || null,
    state: previous?.state === 'answer-ready' ? 'answer-ready' : 'prepared',
    directory,
    manifestPath: resolve(directory, 'manifest.json'),
    taskPath: resolve(directory, 'task.md'),
    answerKeyPath: parsed.questions.length ? resolve(directory, ANSWER_KEY_FILE) : preserved.answerKeyPath || null,
    attachmentCount: attachments.filter((attachment) => attachment.downloaded).length,
    questionCount: parsed.questions.length,
    preparedAt,
    updatedAt: preparedAt,
    lastError: null,
  }
}

export class CourseWorkService {
  constructor({ root, store, client = null }) {
    this.root = resolve(root)
    this.store = store
    this.client = client
  }

  workspaceDirectory(assignmentId) {
    return resolve(this.root, 'course-work', safeDirectoryId(assignmentId))
  }

  validatedWorkspace(assignmentId) {
    const id = safeDirectoryId(assignmentId)
    const workspace = this.store.snapshot().workspaces.find((item) => item.assignmentId === id)
    if (!workspace?.directory) throw new Error('请先准备该任务的工作包')
    const directory = this.workspaceDirectory(id)
    if (!samePath(workspace.directory, directory)) throw new Error('课程任务工作区路径无效')
    for (const [field, filename] of Object.entries(FIXED_WORKSPACE_FILES)) {
      if (workspace[field] && !samePath(workspace[field], resolve(directory, filename))) {
        throw new Error('课程任务工作区文件路径无效')
      }
    }
    if (workspace.submissionPath && !validSubmissionPath(workspace.submissionPath, directory)) {
      throw new Error('课程任务提交文件路径无效')
    }
    return { ...workspace, directory }
  }

  findAssignment(assignmentId, { requireCurrent = true } = {}) {
    const assignment = this.store.snapshot().assignments.find((item) => item.id === assignmentId)
    if (!assignment) throw new Error('未找到北化在线THEOL任务，请先同步')
    if (requireCurrent && !currentAssignment(assignment)) throw new Error('该任务已截止或已提交，不能创建自动处理任务')
    if (!assignment.sourceUrl) throw new Error('北化在线THEOL未提供该任务的入口链接')
    return assignment
  }

  assignmentEntry(assignmentId, { requireCurrent = true } = {}) {
    const assignment = this.findAssignment(assignmentId, { requireCurrent })
    if (assignment.source !== 'theol') throw new Error('该任务不是北化在线THEOL任务')
    const courseId = String(assignment.courseId || '').trim()
    if (!courseId) throw new Error('北化在线THEOL任务缺少课程标识')

    let courseSourceUrl
    if (assignment.courseSourceUrl) {
      courseSourceUrl = courseEntryUrl(assignment.courseSourceUrl, courseId)
    } else {
      const matches = this.store.snapshot().courses.filter((course) =>
        course?.source === 'theol' && String(course.id || '').trim() === courseId)
      if (matches.length !== 1) {
        throw new Error(matches.length
          ? '北化在线THEOL任务关联了多个课程入口'
          : '北化在线THEOL任务缺少课程入口')
      }
      courseSourceUrl = courseEntryUrl(matches[0].sourceUrl, courseId)
    }

    const detail = assignmentEntryUrl(assignment.sourceUrl, assignment.kind)
    return {
      assignment,
      courseSourceUrl,
      assignmentSourceUrl: detail.url,
      kind: detail.kind,
      uniqueTaskId: detail.uniqueTaskId,
    }
  }

  async prepare(assignmentId) {
    if (!this.client) throw new Error('北化在线THEOL会话仅在桌面客户端中可用')
    const entry = this.assignmentEntry(assignmentId)
    const assignment = { ...entry.assignment, kind: entry.kind }
    const directory = this.workspaceDirectory(assignment.id)
    const preparedAt = new Date().toISOString()
    await mkdir(directory, { recursive: true })

    const coursePage = await this.client.page(entry.courseSourceUrl, { source: `课程上下文 ${assignment.courseName || assignment.courseId}` })
    assertCourseContext(coursePage, assignment.courseId, { requireEvidence: true })
    const page = await this.client.page(entry.assignmentSourceUrl, { source: `课程任务 ${assignment.title}` })
    assertAssignmentPage(page, entry)
    const parsed = parseTheolWorkPage(page.text, {
      baseUrl: page.url,
      kind: assignment.kind,
      fallbackTitle: assignment.title,
    })
    const attachments = []
    const usedAttachmentNames = new Set()
    let downloadedBytes = 0
    for (const [index, attachment] of parsed.attachments.slice(0, MAX_ATTACHMENTS).entries()) {
      const file = uniqueAttachmentName(filenameForAttachment(attachment, index), usedAttachmentNames)
      try {
        const remainingBytes = MAX_TOTAL_ATTACHMENT_BYTES - downloadedBytes
        if (remainingBytes <= 0) throw new Error('工作包附件总量超过 128 MB 限制')
        const maxBytes = Math.min(MAX_ATTACHMENT_RESPONSE_BYTES, remainingBytes)
        const downloaded = await this.client.binary(attachment.url, { source: `下载附件 ${attachment.title}`, maxBytes })
        if (!Buffer.isBuffer(downloaded?.buffer) || downloaded.buffer.length > maxBytes) {
          throw new Error(`附件超过 ${Math.ceil(maxBytes / 1024 / 1024)} MB 限制`)
        }
        await writeFile(resolve(directory, file), downloaded.buffer)
        downloadedBytes += downloaded.buffer.length
        attachments.push({ ...attachment, file, downloaded: true, bytes: downloaded.buffer.length })
      } catch (error) {
        attachments.push({ ...attachment, file, downloaded: false, error: error instanceof Error ? error.message : String(error) })
      }
    }
    if (parsed.attachments.length > MAX_ATTACHMENTS) {
      attachments.push({
        title: '其余附件',
        url: null,
        file: null,
        downloaded: false,
        error: `单个工作包最多自动下载 ${MAX_ATTACHMENTS} 个附件`,
      })
    }

    // Extract text from downloaded attachments so the model can read them
    const attachmentExtractions = []
    for (const attachment of attachments) {
      if (!attachment.downloaded || !attachment.file) continue
      const result = await extractAttachmentText(resolve(directory, attachment.file))
      attachmentExtractions.push({ filename: attachment.file, ...result })
    }

    if (parsed.questions.length) await writeFile(resolve(directory, 'answers.template.json'), `${JSON.stringify(answerTemplate(parsed.questions), null, 2)}\n`, 'utf8')
    const attachmentTextMd = attachmentTextSection(attachmentExtractions)
    const manifest = {
      schema: WORK_SCHEMA,
      preparedAt,
      assignment: {
        id: assignment.id,
        title: assignment.title,
        courseName: assignment.courseName || null,
        kind: assignment.kind || 'assignment',
        dueAt: assignment.dueAt || null,
        courseSourceUrl: entry.courseSourceUrl,
        sourceUrl: entry.assignmentSourceUrl,
        uniqueTaskId: entry.uniqueTaskId,
      },
      page: { sourceUrl: page.url, title: parsed.title, instructions: parsed.instructions, questions: parsed.questions },
      attachments,
      attachmentExtractions: attachmentExtractions.map((item) => ({
        filename: item.filename,
        format: item.format,
        extracted: Boolean(item.text),
        error: item.error || null,
      })),
      output: {
        answerKeyTemplate: parsed.questions.length ? 'answers.template.json' : null,
        answerKey: parsed.questions.length ? ANSWER_KEY_FILE : null,
        submission: null,
      },
    }
    await Promise.all([
      writeFile(resolve(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
      writeFile(resolve(directory, 'task.md'), taskMarkdown({ assignment, parsed, attachments, preparedAt }) + attachmentTextMd, 'utf8'),
    ])

    const snapshot = await this.store.update((state) => {
      const previous = state.workspaces.find((item) => item.assignmentId === assignment.id)
      const workspace = workspaceRecord({ assignment, directory, parsed, attachments, preparedAt, previous })
      return withWorkspaceProvenance({
        ...state,
        workspaces: [...state.workspaces.filter((item) => item.assignmentId !== assignment.id), workspace],
      }, preparedAt)
    })
    return { snapshot, workspace: snapshot.workspaces.find((item) => item.assignmentId === assignment.id) }
  }

  async importFile(assignmentId, inputPath, kind = 'answer') {
    const assignment = this.findAssignment(assignmentId)
    const directory = this.workspaceDirectory(assignment.id)
    await mkdir(directory, { recursive: true })
    const source = resolve(inputPath)
    let destination
    if (kind === 'answer-key') {
      const answerKey = normalizeAnswerKey(JSON.parse(await readFile(source, 'utf8')))
      destination = resolve(directory, ANSWER_KEY_FILE)
      await writeFile(destination, `${JSON.stringify(answerKey, null, 2)}\n`, 'utf8')
    } else {
      destination = resolve(directory, `submission-${safeName(basename(source), 'answer')}`)
      await copyFile(source, destination)
    }
    const updatedAt = new Date().toISOString()
    const snapshot = await this.store.update((state) => withWorkspaceProvenance({
      ...state,
      workspaces: state.workspaces.map((item) => item.assignmentId === assignment.id ? {
        ...item,
        state: 'answer-ready',
        [kind === 'answer-key' ? 'answerKeyPath' : 'submissionPath']: destination,
        updatedAt,
        lastError: null,
      } : item),
    }, updatedAt))
    return { snapshot, path: destination }
  }

  async answerKey(assignmentId) {
    const workspace = this.validatedWorkspace(assignmentId)
    if (!workspace?.answerKeyPath) throw new Error('请先准备测试工作包并导入答案 JSON')
    return normalizeAnswerKey(JSON.parse(await readFile(workspace.answerKeyPath, 'utf8')))
  }

  async readWorkspaceManifest(assignmentId) {
    const assignment = this.findAssignment(assignmentId)
    const workspace = this.validatedWorkspace(assignment.id)
    if (!workspace.manifestPath) throw new Error('Prepare this task workspace before using the model')
    let manifest
    try { manifest = JSON.parse(await readFile(workspace.manifestPath, 'utf8')) } catch { throw new Error('The task manifest cannot be read. Prepare the workspace again.') }
    if (manifest?.schema !== WORK_SCHEMA || manifest?.assignment?.id !== assignment.id) throw new Error('The task manifest does not match this assignment')
    return { workspace, manifest }
  }

  async saveModelResult(assignmentId, { answerMarkdown, answerKey, modelName } = {}) {
    const { workspace } = await this.readWorkspaceManifest(assignmentId)
    const directory = resolve(workspace.directory)
    let modelAnswerPath = null
    let answerKeyPath = null
    if (typeof answerMarkdown === 'string' && answerMarkdown.trim()) {
      modelAnswerPath = resolve(directory, 'model-answer.md')
      await writeFile(modelAnswerPath, `${answerMarkdown.trim()}\n`, 'utf8')
    }
    if (answerKey) {
      const normalized = normalizeAnswerKey(answerKey)
      answerKeyPath = resolve(directory, ANSWER_KEY_FILE)
      await writeFile(answerKeyPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
    }
    if (!modelAnswerPath && !answerKeyPath) throw new Error('The model did not produce a usable result')
    const now = new Date().toISOString()
    const snapshot = await this.store.update((state) => withWorkspaceProvenance({
      ...state,
      workspaces: state.workspaces.map((item) => item.assignmentId === assignmentId ? {
        ...item,
        state: 'model-ready',
        ...(modelAnswerPath ? { modelAnswerPath } : {}),
        ...(answerKeyPath ? { answerKeyPath } : {}),
        modelName: modelName || null,
        modelProcessedAt: now,
        updatedAt: now,
        lastError: null,
      } : item),
    }, now))
    return { snapshot, workspace: snapshot.workspaces.find((item) => item.assignmentId === assignmentId) }
  }

  async recordTestFill(assignmentId, result) {
    const now = new Date().toISOString()
    return this.store.update((state) => withWorkspaceProvenance({
      ...state,
      workspaces: state.workspaces.map((item) => item.assignmentId === assignmentId ? {
        ...item,
        state: 'answer-ready',
        lastTestFill: { at: now, ...result },
        updatedAt: now,
      } : item),
    }, now))
  }
}
