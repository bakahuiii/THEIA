import { readFile } from 'node:fs/promises'
import { fetch as undiciFetch } from 'undici'
import { normalizeAnswerKey } from '../core/parsers/theol-work.mjs'
import { modelServiceIdentity, normalizeModelServiceBaseUrl } from '../core/model-url-policy.mjs'
import { prepareModelEndpoint } from './model-network-policy.mjs'

const MAX_CONTEXT_CHARS = 48_000
const MODEL_DISCOVERY_TIMEOUT_MS = 15_000
export const MAX_MODEL_REQUEST_BYTES = 2 * 1024 * 1024
export const MAX_MODEL_LIST_RESPONSE_BYTES = 2 * 1024 * 1024
export const MAX_MODEL_COMPLETION_RESPONSE_BYTES = 8 * 1024 * 1024

function contentLength(response) {
  const raw = response?.headers?.get?.('content-length')
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export async function readBoundedResponseText(response, maximumBytes, label = 'Model response') {
  const declared = contentLength(response)
  if (declared !== null && declared > maximumBytes) {
    response?.body?.cancel?.().catch?.(() => {})
    throw new Error(`${label} exceeds the ${maximumBytes}-byte limit`)
  }

  const reader = response?.body?.getReader?.()
  if (!reader) {
    const body = await response.text()
    if (Buffer.byteLength(body, 'utf8') > maximumBytes) throw new Error(`${label} exceeds the ${maximumBytes}-byte limit`)
    return body
  }

  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!(value instanceof Uint8Array)) throw new Error(`${label} returned an invalid byte stream`)
      total += value.byteLength
      if (total > maximumBytes) {
        await reader.cancel().catch(() => {})
        throw new Error(`${label} exceeds the ${maximumBytes}-byte limit`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock?.()
  }
  const combined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(combined)
}

function listedModels(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter((item) => item && item.length <= 300))]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 300)
}

export function preferredModel(models, requested = '') {
  const normalized = listedModels(models)
  const explicit = String(requested || '').trim()
  if (explicit) return explicit
  for (const candidate of ['gpt-5-mini', 'gpt-4.1-mini', 'gpt-4o-mini', 'deepseek-chat']) {
    if (normalized.includes(candidate)) return candidate
  }
  return normalized.find((model) => !/(embedding|audio|transcri|tts|image|moderation|realtime)/i.test(model)) || normalized[0] || ''
}

function textContent(content) {
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) return content.map((part) => typeof part?.text === 'string' ? part.text : '').join('').trim()
  return ''
}

function completionUrl(baseUrl) {
  const url = new URL(normalizeModelServiceBaseUrl(baseUrl))
  const pathname = url.pathname.replace(/\/+$/, '')
  if (!pathname.endsWith('/chat/completions')) {
    url.pathname = pathname.endsWith('/v1') ? `${pathname}/chat/completions` : `${pathname}/v1/chat/completions`
  }
  url.search = ''
  url.hash = ''
  return url.toString()
}

function modelsUrl(baseUrl) {
  const url = new URL(normalizeModelServiceBaseUrl(baseUrl))
  let pathname = url.pathname.replace(/\/+$/, '')
  if (pathname.endsWith('/chat/completions')) pathname = pathname.slice(0, -'/chat/completions'.length)
  if (!pathname.endsWith('/models')) pathname = pathname.endsWith('/v1') ? `${pathname}/models` : `${pathname}/v1/models`
  url.pathname = pathname
  url.search = ''
  url.hash = ''
  return url.toString()
}

function extractJson(text) {
  const trimmed = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try { return JSON.parse(trimmed.slice(start, end + 1)) } catch { /* The caller receives a clear format error below. */ }
    }
    throw new Error('The model did not return valid answer JSON')
  }
}

function contextualTask(manifest) {
  const page = manifest?.page || {}
  // Include extracted attachment text so the model can read assignment PDFs/docs
  const attachmentSections = []
  for (const item of (manifest?.attachmentExtractions || [])) {
    if (!item.extracted) continue
    // Re-read text from task.md is not available here; instead store a reference
    // The full text is in task.md — we embed the summary in the context JSON.
    attachmentSections.push({ filename: item.filename, format: item.format })
  }
  return JSON.stringify({
    assignment: manifest?.assignment || {},
    instructions: page.instructions || '',
    questions: Array.isArray(page.questions) ? page.questions : [],
    attachmentFiles: attachmentSections,
  }, null, 2).slice(0, MAX_CONTEXT_CHARS)
}

/**
 * Reads extracted attachment text from task.md and includes it in the prompt.
 * Returns a string to append to the system/user message.
 */
async function attachmentContext(workspace) {
  if (!workspace?.taskPath) return ''
  try {
    const task = await readFile(workspace.taskPath, 'utf8')
    const start = task.indexOf('## 附件内容（文本提取）')
    if (start < 0) return ''
    const section = task.slice(start, start + 24_000)
    return `\n\n以下是作业附件中提取的文本内容，请仔细阅读后再解答：\n\n${section}`
  } catch {
    return ''
  }
}

export class ModelService {
  constructor({ vault, courseWork, fetchFn = undiciFetch, resolver, dispatcherFactory }) {
    this.vault = vault
    this.courseWork = courseWork
    this.fetchFn = fetchFn
    this.resolver = resolver
    this.dispatcherFactory = dispatcherFactory
    this.activeControllers = new Set()
  }

  prepareEndpoint(url, signal) {
    return prepareModelEndpoint(url, {
      ...(this.resolver ? { resolver: this.resolver } : {}),
      ...(this.dispatcherFactory ? { dispatcherFactory: this.dispatcherFactory } : {}),
      signal,
    })
  }

  requestController(signal) {
    const controller = new AbortController()
    const cancel = () => controller.abort(signal?.reason)
    if (signal?.aborted) cancel()
    else signal?.addEventListener?.('abort', cancel, { once: true })
    this.activeControllers.add(controller)
    return {
      controller,
      release: () => {
        signal?.removeEventListener?.('abort', cancel)
        this.activeControllers.delete(controller)
      },
    }
  }

  cancelAll(reason = new Error('Model requests were cancelled')) {
    const cancelled = this.activeControllers.size
    for (const controller of this.activeControllers) controller.abort(reason)
    this.activeControllers.clear()
    return cancelled
  }

  async status(settings) {
    const vault = await this.vault.status()
    let baseUrl = ''
    let serviceIdentity = null
    try {
      baseUrl = normalizeModelServiceBaseUrl(settings?.modelBaseUrl)
      serviceIdentity = modelServiceIdentity(baseUrl)
    } catch { /* An invalid legacy URL is treated as unconfigured. */ }
    const model = String(settings?.modelName || '').trim()
    const apiKeySaved = Boolean(vault.saved && vault.bound && vault.serviceIdentity === serviceIdentity)
    return {
      configured: Boolean(baseUrl && model && apiKeySaved),
      baseUrl,
      model,
      apiKeySaved,
      encryptionAvailable: vault.encryptionAvailable,
      updatedAt: vault.updatedAt,
      error: vault.error,
      requiresApiKeyReentry: Boolean(vault.saved && !apiKeySaved),
      models: listedModels(settings?.modelModels),
    }
  }

  async request(settings, messages, { temperature = 0.2, maxTokens = 3_500, signal } = {}) {
    const baseUrl = normalizeModelServiceBaseUrl(settings?.modelBaseUrl)
    const model = String(settings?.modelName || '').trim()
    if (!baseUrl || !model) throw new Error('Configure the model service URL and model name first')
    const apiKey = await this.vault.readApiKey(baseUrl)
    if (!apiKey) throw new Error('Save a model API key before processing a task')

    const { controller, release } = this.requestController(signal)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, 90_000)
    try {
      const requestBody = JSON.stringify({ model, messages, temperature, max_tokens: maxTokens })
      if (Buffer.byteLength(requestBody, 'utf8') > MAX_MODEL_REQUEST_BYTES) throw new Error(`Model request exceeds the ${MAX_MODEL_REQUEST_BYTES}-byte limit`)
      const targetUrl = completionUrl(baseUrl)
      const endpoint = await this.prepareEndpoint(targetUrl, controller.signal)
      try {
        const response = await this.fetchFn(targetUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: requestBody,
          redirect: 'error',
          signal: controller.signal,
          dispatcher: endpoint.dispatcher,
        })
        const body = await readBoundedResponseText(response, MAX_MODEL_COMPLETION_RESPONSE_BYTES, 'Model completion response')
        if (!response.ok) throw new Error(`Model service returned HTTP ${response.status}`)
        let parsed
        try { parsed = JSON.parse(body) } catch { throw new Error('Model service returned invalid JSON') }
        const content = textContent(parsed?.choices?.[0]?.message?.content)
        if (!content) throw new Error('Model service returned no answer content')
        return content
      } finally {
        await endpoint.close({ force: controller.signal.aborted }).catch(() => {})
      }
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') {
        if (timedOut) throw new Error('Model request timed out after 90 seconds')
        throw new Error('Model request was cancelled')
      }
      throw error
    } finally {
      clearTimeout(timer)
      release()
    }
  }

  async validate(settings) {
    const content = await this.request(settings, [
      { role: 'system', content: 'Reply with exactly THEIA_OK.' },
      { role: 'user', content: 'Check the configured connection.' },
    ], { temperature: 0, maxTokens: 16 })
    if (!content.includes('THEIA_OK')) throw new Error('The model service responded, but did not complete the connection check')
    return { ok: true }
  }

  async discover({ baseUrl, apiKey, signal } = {}) {
    const normalizedBaseUrl = normalizeModelServiceBaseUrl(baseUrl)
    const key = String(apiKey || '').trim() || await this.vault.readApiKey(normalizedBaseUrl)
    if (!key) throw new Error('Enter or save a model API key before detecting models')
    const active = this.requestController(signal)
    const { controller } = active
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, MODEL_DISCOVERY_TIMEOUT_MS)
    try {
      const targetUrl = modelsUrl(normalizedBaseUrl)
      const endpoint = await this.prepareEndpoint(targetUrl, controller.signal)
      try {
        const response = await this.fetchFn(targetUrl, {
          headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
          redirect: 'error',
          signal: controller.signal,
          dispatcher: endpoint.dispatcher,
        })
        const body = await readBoundedResponseText(response, MAX_MODEL_LIST_RESPONSE_BYTES, 'Model list response')
        if (!response.ok) throw new Error(`Model list request returned HTTP ${response.status}`)
        let payload
        try { payload = JSON.parse(body) } catch { throw new Error('Model list endpoint returned invalid JSON') }
        const records = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : []
        const models = listedModels(records.map((item) => typeof item === 'string' ? item : item?.id ?? item?.name))
        if (!models.length) throw new Error('The model list endpoint returned no selectable models')
        return { models, selectedModel: preferredModel(models) || null }
      } finally {
        await endpoint.close({ force: controller.signal.aborted }).catch(() => {})
      }
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') {
        if (timedOut) throw new Error('Model detection timed out after 15 seconds')
        throw new Error('Model detection was cancelled')
      }
      throw error
    } finally {
      clearTimeout(timer)
      active.release()
    }
  }

  /**
   * 生成课程通知摘要：把当前 store 里的 assignments + notices 喂给模型，
   * 输出一份 Markdown 摘要，保存到 userData/summaries/<timestamp>.md
   */
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
  }

  /**
   * 为指定作业工作包生成笔记：读取附件文本 + 作业说明，
   * 输出结构化学习笔记 Markdown。
   */
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
  }

  /**
   * 为指定作业工作包生成论文草稿：读取要求（附件+说明）→ 输出论文 Markdown。
   * 包含摘要、各章节正文、结论。
   */
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
  }

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
  }
}
