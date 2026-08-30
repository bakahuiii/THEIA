import { normalizeAnswerKey } from '../core/parsers/theol-work.mjs'
import {
  MAX_CONTEXT_CHARS,
  attachmentContext,
  contextualTask,
  extractJson,
} from './model-service-transport.mjs'

/** Model-backed course-work operations stay separate from transport concerns. */
export const MODEL_COURSEWORK_METHODS = {
  async summarizeNotices(settings, { assignments = [], notices = [], courses = [], dataRoot }) {
    const { mkdir, writeFile } = await import('node:fs/promises')
    const { resolve } = await import('node:path')
    const now = new Date()
    const pending = assignments.filter((a) => a.status !== 'submitted')
    const context = JSON.stringify({
      generatedAt: now.toISOString(),
      pendingAssignments: pending.slice(0, 60).map((a) => ({
        course: a.courseName, title: a.title, dueAt: a.dueAt, kind: a.kind, status: a.status,
      })),
      recentNotices: notices.slice(0, 40).map((n) => ({
        source: n.source, title: n.title, summary: n.summary?.slice(0, 200), publishedAt: n.publishedAt,
      })),
      courses: courses.slice(0, 30).map((c) => c.title),
    }, null, 2).slice(0, MAX_CONTEXT_CHARS)

    const content = await this.request(settings, [
      { role: 'system', content: '你是一个细心的学习助手。根据提供的课程数据，生成简洁清晰的中文通知摘要。使用 Markdown 格式，包含紧急程度标识（🔴<1天 🟡<7天 🟢正常）。' },
      { role: 'user', content: `请根据以下课程数据生成通知摘要，按截止时间排序待交作业，并归纳最新通知要点：\n\n${context}` },
    ], { temperature: 0.3, maxTokens: 4_000 })

    const dir = resolve(dataRoot, 'summaries')
    await mkdir(dir, { recursive: true })
    const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filePath = resolve(dir, `summary-${ts}.md`)
    await writeFile(filePath, `${content.trim()}\n`, 'utf8')
    return { filePath, content }
  },

  async generateNotes(assignmentId, settings, { title = '' } = {}) {
    const { workspace, manifest } = await this.courseWork.readWorkspaceManifest(assignmentId)
    const { writeFile } = await import('node:fs/promises')
    const { resolve } = await import('node:path')
    const attachCtx = await attachmentContext(workspace)
    const subject = title || manifest?.assignment?.courseName || manifest?.assignment?.title || '课程内容'
    const instructions = manifest?.page?.instructions || ''

    const content = await this.request(settings, [
      { role: 'system', content: '你是一个专注的学习助手。根据提供的课程材料，提取核心知识点，生成结构清晰、重点突出的中文学习笔记。使用 Markdown 格式，包含标题层级、要点列表和关键概念解释。' },
      { role: 'user', content: `请根据以下课程材料为「${subject}」生成学习笔记：\n\n${instructions}${attachCtx}` },
    ], { temperature: 0.3, maxTokens: 5_000 })

    const notesPath = resolve(workspace.directory, 'notes.md')
    await writeFile(notesPath, `${content.trim()}\n`, 'utf8')
    const snapshot = await this.courseWork.store.update((state) => ({
      ...state,
      workspaces: state.workspaces.map((item) => item.assignmentId === assignmentId ? {
        ...item, notesPath, updatedAt: new Date().toISOString(),
      } : item),
    }))
    return { snapshot, notesPath, content }
  },

  async generatePaper(assignmentId, settings, { title = '', wordCount = 3000 } = {}) {
    const { workspace, manifest } = await this.courseWork.readWorkspaceManifest(assignmentId)
    const { writeFile } = await import('node:fs/promises')
    const { resolve } = await import('node:path')
    const attachCtx = await attachmentContext(workspace)
    const subject = title || manifest?.assignment?.title || '课程论文'
    const courseName = manifest?.assignment?.courseName || ''
    const instructions = manifest?.page?.instructions || ''

    const content = await this.request(settings, [
      { role: 'system', content: `你是一个严谨的学术写作助手。根据提供的作业要求，生成结构完整的中文论文草稿。论文应包含：标题、摘要（200字）、关键词、引言、主体各章节（每节500-800字）、结论、参考文献（如有）。目标字数约 ${wordCount} 字，使用学术语体，Markdown 格式输出。` },
      { role: 'user', content: `请为「${courseName}」课程撰写题为「${subject}」的论文草稿（约${wordCount}字）。\n\n作业要求：\n${instructions}${attachCtx}` },
    ], { temperature: 0.4, maxTokens: 6_000 })

    const paperPath = resolve(workspace.directory, 'paper.md')
    await writeFile(paperPath, `${content.trim()}\n`, 'utf8')
    const snapshot = await this.courseWork.store.update((state) => ({
      ...state,
      workspaces: state.workspaces.map((item) => item.assignmentId === assignmentId ? {
        ...item, paperPath, updatedAt: new Date().toISOString(),
      } : item),
    }))
    return { snapshot, paperPath, content }
  },

  async process(assignmentId, settings) {
    const { workspace, manifest } = await this.courseWork.readWorkspaceManifest(assignmentId)
    const isTest = manifest?.assignment?.kind === 'online-test'
    const context = contextualTask(manifest)
    const attachCtx = await attachmentContext(workspace)

    if (isTest) {
      const content = await this.request(settings, [
        { role: 'system', content: 'You are a careful study assistant. Answer only from the supplied task. Return strict JSON only, with no markdown or explanation.' },
        { role: 'user', content: `Solve this online test. Return exactly {"answers":[{"question":1,"answer":"A"}]}. Use each question number once. For multiple-choice answers, use the exact option value or visible option label. For text questions, provide the answer text. Do not include final submission instructions.\n\n${context}${attachCtx}` },
      ], { temperature: 0, maxTokens: 3_500 })
      const answerKey = normalizeAnswerKey(extractJson(content))
      const expected = new Set((manifest?.page?.questions || []).map((question) => Number(question.index)))
      if (!expected.size) throw new Error('The prepared test package does not contain parsed questions')
      const seen = new Set()
      for (const answer of answerKey.answers) {
        if (!expected.has(answer.question) || seen.has(answer.question)) throw new Error('The model returned an answer for an unknown or duplicate question')
        seen.add(answer.question)
      }
      if (seen.size !== expected.size) throw new Error(`The model returned ${seen.size}/${expected.size} answers; no partial test answer was saved`)
      return this.courseWork.saveModelResult(assignmentId, { answerKey, modelName: String(settings.modelName || '').trim() })
    }

    const content = await this.request(settings, [
      { role: 'system', content: 'You are a careful study assistant. Work only from the supplied task and clearly state missing information instead of inventing it. Produce a complete answer in Chinese Markdown. Do not claim that anything was submitted.' },
      { role: 'user', content: `Prepare a draft answer for this course assignment. Preserve any requested format, show necessary reasoning, and include citations only when supplied by the task.\n\n${context}${attachCtx}` },
    ], { temperature: 0.2, maxTokens: 4_000 })
    return this.courseWork.saveModelResult(assignmentId, { answerMarkdown: content, modelName: String(settings.modelName || '').trim() })
  },
}
