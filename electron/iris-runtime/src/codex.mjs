/**
 * Direct local Codex bridge. QQ never reaches a web gateway: Iris invokes the
 * installed Codex CLI with an argument vector and returns only its final text.
 */

import { existsSync } from 'node:fs'
import { open, readFile, readdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import process from 'node:process'

const maxInstructionLength = 8_000
const transcriptReadChunkBytes = 256 * 1_024

function cleanText(value, maximum = 3_000) {
  const text = String(value ?? '').trim().replace(/\r\n/g, '\n')
  return text.length > maximum ? `${text.slice(0, Math.max(1, maximum - 1))}...` : text
}

function tailText(value, maximum = 1_200) {
  const text = String(value ?? '').trim().replace(/\r\n/g, '\n')
  return text.length > maximum ? `...${text.slice(-(maximum - 3))}` : text
}

function progressStage(event) {
  const itemType = event?.item?.type
  if (event?.type === 'turn.started') return '正在准备任务'
  if (itemType === 'command_execution') return '正在执行本机操作'
  if (itemType === 'agent_message') return '正在整理结果'
  if (itemType === 'reasoning') return '正在分析'
  if (event?.type === 'turn.completed') return '正在完成收尾'
  return ''
}

function displayLabel(value, fallback, maximum = 80) {
  const normalized = String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
  const text = normalized || fallback
  return text.length > maximum ? `${text.slice(0, Math.max(1, maximum - 1))}…` : text
}

function workspaceName(workspace) {
  const segments = String(workspace ?? '').replace(/[\\/]+$/g, '').split(/[\\/]/).filter(Boolean)
  return segments.at(-1) || 'Workspace'
}

function sessionId(value) {
  const id = typeof value === 'string' ? value.trim() : ''
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : ''
}

function taskName(value) {
  const title = String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!title || /^(?:已选会话|selected conversation|未命名会话|codex)$/i.test(title)) return ''
  return title.length > 120 ? `${title.slice(0, 119)}…` : title
}

function timestamp(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  const milliseconds = Date.parse(text)
  return text && Number.isFinite(milliseconds) ? { text, milliseconds } : null
}

function visibleTranscriptMessage(record) {
  const payload = record?.payload
  return payload?.type === 'message' && (payload.role === 'user' || payload.role === 'assistant')
}

function transcriptMessageText(payload) {
  if (typeof payload?.content === 'string') return payload.content
  if (!Array.isArray(payload?.content)) return ''
  return payload.content
    .map((item) => typeof item?.text === 'string' ? item.text : '')
    .filter(Boolean)
    .join(' ')
}

function transcriptTaskName(payload) {
  const candidate = taskName(transcriptMessageText(payload))
  return /^(?:#\s*AGENTS\.md instructions|<(?:app-context|environment_context|skills_instructions|permissions instructions|plugins_instructions)>)/i.test(candidate)
    ? ''
    : candidate
}

async function findCodexTranscripts(sessionsRoot, ids = null) {
  const pending = Array.isArray(ids) ? new Set(ids) : null
  const found = new Map()
  const queue = [sessionsRoot]
  while (queue.length && (!pending || pending.size)) {
    const directory = queue.pop()
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        queue.push(path)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
      const id = sessionId(entry.name.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0])
      if (!id || (pending && !pending.has(id))) continue
      found.set(id, path)
      pending?.delete(id)
    }
  }
  return found
}

async function readTranscriptSummary(filePath) {
  let file
  try {
    file = await open(filePath, 'r')
    const { size } = await file.stat()
    let position = size
    let partialLine = ''
    let lastMessage = null
    let title = ''
    while (position > 0 && (!lastMessage || !title)) {
      const length = Math.min(transcriptReadChunkBytes, position)
      position -= length
      const buffer = Buffer.allocUnsafe(length)
      await file.read(buffer, 0, length, position)
      const lines = `${buffer.toString('utf8')}${partialLine}`.split(/\r?\n/)
      partialLine = lines.shift() ?? ''
      for (const line of lines.reverse()) {
        try {
          const record = JSON.parse(line)
          if (!visibleTranscriptMessage(record)) continue
          lastMessage ||= timestamp(record.timestamp)
          if (record.payload.role === 'user') title ||= transcriptTaskName(record.payload)
          if (lastMessage && title) break
        } catch { /* A partially written JSONL line is not a complete message. */ }
      }
    }
    if ((!lastMessage || !title) && partialLine) {
      try {
        const record = JSON.parse(partialLine)
        if (visibleTranscriptMessage(record)) {
          lastMessage ||= timestamp(record.timestamp)
          if (record.payload.role === 'user') title ||= transcriptTaskName(record.payload)
        }
      } catch { /* A partial first JSONL line is not a complete message. */ }
    }
    return { lastMessage, title }
  } catch {
    return { lastMessage: null, title: '' }
  } finally {
    await file?.close()
  }
}

async function readTranscriptSummaries(indexPath, codexHome = '') {
  const sessionsRoot = join(codexHome || dirname(indexPath), 'sessions')
  const paths = await findCodexTranscripts(sessionsRoot)
  const pairs = await Promise.all([...paths.entries()].map(async ([id, path]) => [id, await readTranscriptSummary(path)]))
  return new Map(pairs)
}

function httpStatus(value) {
  const text = String(value ?? '')
  const explicit = text.match(/\b(?:http(?:\s+(?:status|error|response|code))?|status(?:\s+code)?|error(?:\s+code)?)\s*[:=]?\s*([45]\d{2})\b/i)
  const generic = text.match(/\b(400|401|403|404|408|409|413|422|429|5\d{2})\b/)
  const code = Number(explicit?.[1] ?? generic?.[1])
  return Number.isInteger(code) ? code : 0
}

function isCodexSessionBusyError(error) {
  const message = String(error?.message ?? '')
  return error?.code === 'CODEX_SESSION_BUSY'
    || /thread-store conflict|already has an active writer|session(?: is)? locked|active writer/i.test(message)
}

/** Maps local CLI failures to a concise QQ-safe interruption message. */
export function classifyCodexFailure(error) {
  const message = String(error?.message ?? '')
  if (isCodexSessionBusyError(error)) {
    return {
      code: 'SESSION_BUSY',
      status: '中断 · 会话被占用',
      text: 'Codex 会话已中断：当前会话正在被另一个 Codex 客户端使用。请稍后重试，或发送「codex use <序号>」选择其他会话。',
      diagnostic: 'Codex session has an active writer',
    }
  }
  if (error?.code === 'CODEX_DESKTOP_OWNER_DISCONNECTED') {
    return {
      code: 'DESKTOP_OWNER_DISCONNECTED',
      status: '中断 · 桌面端已断开',
      text: 'Codex 会话已中断：桌面 Codex 已断开，Iris 没有改写会话或新建替代会话。请重新打开桌面 Codex 后重试。',
      diagnostic: 'Codex desktop owner disconnected',
    }
  }
  if (error?.code === 'CODEX_DESKTOP_IPC_TIMEOUT') {
    return {
      code: 'DESKTOP_IPC_TIMEOUT',
      status: '中断 · 桌面端响应超时',
      text: 'Codex 会话已中断：桌面 Codex IPC 响应超时。Iris 没有改写会话或新建替代会话，请稍后重试。',
      diagnostic: 'Codex desktop IPC timed out',
    }
  }
  if (error?.code === 'CODEX_DESKTOP_IPC_UNAVAILABLE' || error?.code === 'CODEX_DESKTOP_IPC_PROTOCOL' || (error?.code === 'CODEX_DESKTOP_REQUEST_FAILED' && !httpStatus(message))) {
    return {
      code: 'DESKTOP_IPC_FAILED',
      status: '中断 · 桌面端转发失败',
      text: 'Codex 会话已中断：桌面 Codex 未能接收这条指令。Iris 没有改写会话或新建替代会话，请确认桌面 Codex 正在运行后重试。',
      diagnostic: 'Codex desktop IPC forwarding failed',
    }
  }
  const code = Number(error?.codexHttpStatus) || httpStatus(message)
  if (code) {
    const reason = {
      400: '请求无法被 Codex 接受',
      401: '登录状态或凭据已失效',
      403: '访问被拒绝',
      404: '请求的服务或模型不可用',
      408: '请求超时',
      409: '请求发生冲突',
      413: '请求内容过大',
      422: '请求内容无法处理',
      429: '请求过于频繁或配额受限',
    }[code] ?? (code >= 500 ? 'Codex 服务暂时异常' : '请求未完成')
    const recovery = code === 401 || code === 403
      ? '请检查此设备上的 Codex 登录状态和帐号权限后重试。'
      : code === 429
        ? '请稍后重试。'
        : '请稍后重试。'
    return {
      code: `HTTP_${code}`,
      status: `中断 · HTTP ${code}`,
      text: `Codex 会话已中断：HTTP ${code}（${reason}）。${recovery}`,
      diagnostic: `HTTP ${code}`,
    }
  }
  if (error?.code === 'CODEX_STOPPED' || /(?:\bcancel(?:led|ed)?\b|\babort(?:ed)?\b|\bsigterm\b)/i.test(message)) {
    return {
      code: 'STOPPED',
      status: '已停止',
      text: 'Codex 会话已停止：Iris 已终止这项指令。可直接回复该消息或发送新的 Codex 指令继续。',
      diagnostic: 'stopped by Iris',
    }
  }
  if (error?.code === 'CODEX_TIMEOUT' || /timed out/i.test(message)) {
    return {
      code: 'TIMEOUT',
      status: '中断 · 响应超时',
      text: 'Codex 会话已中断：本机等待响应超时，Iris 已请求停止该指令。请确认 Codex 可用后重试。',
      diagnostic: 'response timed out',
    }
  }
  return {
    code: 'PROCESS_ERROR',
    status: '中断 · 本机进程异常',
    text: 'Codex 会话已中断：本机进程异常退出。请查看 Iris 本机控制台后重试。',
    diagnostic: 'Codex process exited unexpectedly',
  }
}

function resolveCodexEntry(value = process.env.IRIS_CODEX_ENTRY) {
  const candidates = [
    value,
    process.platform === 'win32' && process.env.APPDATA
      ? join(process.env.APPDATA, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
      : '',
    '/usr/local/lib/node_modules/@openai/codex/bin/codex.js',
  ].filter(Boolean)
  return candidates.find((candidate) => existsSync(candidate)) ?? ''
}

export function resolveCodexSessionIndex({
  indexPath = process.env.IRIS_CODEX_SESSION_INDEX,
  codexHome = process.env.IRIS_CODEX_HOME || process.env.CODEX_HOME,
  home = process.env.USERPROFILE || process.env.HOME || '',
} = {}) {
  if (indexPath) return indexPath
  return join(codexHome || join(home, '.codex'), 'session_index.jsonl')
}

function parseIndexLine(line, sequence) {
  try {
    const item = JSON.parse(line)
    const id = sessionId(item?.id)
    if (!id) return null
    const updated = timestamp(item?.updated_at)
    return {
      id,
      name: cleanText(item.thread_name || '未命名会话', 120),
      updatedAt: updated?.text ?? null,
      updatedAtMs: updated?.milliseconds ?? Number.NEGATIVE_INFINITY,
      sequence,
    }
  } catch {
    return null
  }
}

export async function readCodexSessions(indexPath = resolveCodexSessionIndex(), { codexHome = '' } = {}) {
  try {
    const lines = (await readFile(indexPath, 'utf8')).split(/\r?\n/).filter(Boolean)
    const latestById = new Map()
    for (const [sequence, line] of lines.entries()) {
      const item = parseIndexLine(line, sequence)
      if (!item) continue
      const current = latestById.get(item.id)
      if (!current || item.updatedAtMs > current.updatedAtMs || (item.updatedAtMs === current.updatedAtMs && item.sequence > current.sequence)) latestById.set(item.id, item)
    }
    const transcriptSummaries = await readTranscriptSummaries(indexPath, codexHome)
    for (const id of transcriptSummaries.keys()) {
      if (!latestById.has(id)) {
        latestById.set(id, { id, name: '未命名会话', updatedAt: null, updatedAtMs: Number.NEGATIVE_INFINITY, sequence: -1 })
      }
    }
    return [...latestById.values()]
      .map((item) => {
        const transcript = transcriptSummaries.get(item.id)
        const lastMessage = transcript?.lastMessage
        return {
          ...item,
          name: taskName(item.name) || transcript?.title || '当前 Codex 会话',
          updatedAt: lastMessage?.text ?? item.updatedAt,
          sortAt: lastMessage?.milliseconds ?? item.updatedAtMs,
        }
      })
      .sort((left, right) => right.sortAt - left.sortAt || right.sequence - left.sequence || left.id.localeCompare(right.id))
      .slice(0, 20)
      .map(({ updatedAtMs, sequence, sortAt, ...session }) => session)
  } catch {
    return []
  }
}

function parseJsonlText(stdout) {
  for (const line of String(stdout ?? '').split(/\r?\n/).reverse()) {
    try {
      const event = JSON.parse(line)
      const text = event?.item?.type === 'agent_message'
        ? event.item.text
        : event?.message?.content ?? event?.text ?? event?.result?.text
      if (typeof text === 'string' && text.trim()) return cleanText(text)
    } catch { /* Only JSONL event lines are relevant. */ }
  }
  return ''
}

function sessionIdFromEvent(value, depth = 0) {
  if (depth > 5 || value == null) return ''
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = sessionIdFromEvent(item, depth + 1)
      if (found) return found
    }
    return ''
  }
  if (typeof value !== 'object') return ''
  for (const [key, item] of Object.entries(value)) {
    if (/^(?:thread|session|conversation)[_-]?id$/i.test(key)) {
      const found = sessionId(item)
      if (found) return found
    }
    const found = sessionIdFromEvent(item, depth + 1)
    if (found) return found
  }
  return ''
}

function parseJsonlSessionId(stdout) {
  for (const line of String(stdout ?? '').split(/\r?\n/).reverse()) {
    try {
      const found = sessionIdFromEvent(JSON.parse(line))
      if (found) return found
    } catch { /* Only complete JSONL event lines can identify a session. */ }
  }
  return ''
}

export function createCodexRunner({
  entryPath = resolveCodexEntry(),
  nodePath = process.execPath,
  codexHome = process.env.IRIS_CODEX_HOME || process.env.CODEX_HOME,
} = {}) {
  return (args, { timeoutMs = 620_000, onEvent = () => {} } = {}) => {
    if (!entryPath) throw new Error('Codex CLI was not found. Set IRIS_CODEX_ENTRY to its bin/codex.js path.')
    const child = spawn(nodePath, [entryPath, ...args], {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Global Codex notifications use the same lifecycle hook. Iris has its
      // own richer completion path, so mark bridged jobs to prevent duplicates.
      env: { ...process.env, ...(codexHome ? { CODEX_HOME: codexHome } : {}), IRIS_CODEX_BRIDGE: '1' },
    })
    let timer = null
    let terminationTimer = null
    let stopRequested = false
    let timedOut = false
    const promise = new Promise((resolve, reject) => {
      const output = []
      const errors = []
      let pendingJsonl = ''
      let settled = false
      const settle = (method, value) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        if (terminationTimer) clearTimeout(terminationTimer)
        method(value)
      }
      child.stdout.on('data', (chunk) => {
        output.push(chunk)
        pendingJsonl += chunk.toString('utf8')
        const lines = pendingJsonl.split(/\r?\n/)
        pendingJsonl = lines.pop() ?? ''
        for (const line of lines) {
          try {
            const event = JSON.parse(line)
            const stage = progressStage(event)
            if (stage) onEvent({ stage, type: event.type, itemType: event?.item?.type })
          } catch { /* Codex JSONL may be interleaved with non-event diagnostics. */ }
        }
      })
      child.stderr.on('data', (chunk) => errors.push(chunk))
      child.once('error', (error) => settle(reject, error))
      child.once('close', (code, signal) => {
        const stdout = Buffer.concat(output).toString('utf8')
        const stderr = Buffer.concat(errors).toString('utf8')
        if (timedOut) {
          const error = new Error('Codex response timed out.')
          error.code = 'CODEX_TIMEOUT'
          settle(reject, error)
        } else if (stopRequested) {
          const error = new Error('Codex task was stopped by Iris.')
          error.code = 'CODEX_STOPPED'
          settle(reject, error)
        } else if (code === 0) {
          settle(resolve, { stdout, stderr, code, signal })
        } else {
          const diagnostic = [stderr, stdout].filter(Boolean).join('\n')
          const error = new Error(`Codex exited (${code ?? signal ?? 'unknown'}): ${tailText(diagnostic) || 'no diagnostic'}`)
          error.codexHttpStatus = httpStatus(diagnostic)
          error.codexSessionId = parseJsonlSessionId(stdout)
          if (isCodexSessionBusyError(error)) error.code = 'CODEX_SESSION_BUSY'
          settle(reject, error)
        }
      })
      timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
        terminationTimer = setTimeout(() => {
          const error = new Error('Codex response timed out.')
          error.code = 'CODEX_TIMEOUT'
          settle(reject, error)
        }, 5_000)
      }, timeoutMs)
    })
    return {
      promise,
      abort: () => {
        stopRequested = true
        return child.kill('SIGTERM')
      },
    }
  }
}

/**
 * Parses IRIS_CODEX_WORKSPACE_MAP into a name→path map.
 * Format: "name1:C:\path\one;name2:C:\path\two"
 * Names are lowercased for case-insensitive lookup.
 * On Windows paths, the separator after the drive letter colon is safe because
 * we split on the FIRST colon only (name portion must not contain a colon).
 */
export function parseWorkspaceMap(value = process.env.IRIS_CODEX_WORKSPACE_MAP) {
  if (!value || typeof value !== 'string') return {}
  const map = {}
  for (const entry of value.split(';').map((s) => s.trim()).filter(Boolean)) {
    const colonIndex = entry.indexOf(':')
    if (colonIndex < 1) continue
    const name = entry.slice(0, colonIndex).trim().toLowerCase()
    const path = entry.slice(colonIndex + 1).trim()
    if (name && path) map[name] = path
  }
  return map
}

export function createCodexClient({
  runner = createCodexRunner(),
  listSessions = readCodexSessions,
  loadSelectedSession = async () => '',
  saveSelectedSession = async () => {},
  configuredSessionId = process.env.IRIS_CODEX_SESSION_ID,
  workspace = process.env.IRIS_CODEX_WORKSPACE || process.cwd(),
  workspaceLabel = process.env.IRIS_CODEX_WORKSPACE_LABEL,
  workspaceMap = parseWorkspaceMap(),
  desktop = null,
  onError = () => {},
  onProgress = () => {},
  now = () => Date.now(),
} = {}) {
  const activeJobs = new Map()
  const configured = sessionId(configuredSessionId)
  // This is the only workspace identifier that may be included in QQ messages.
  const visibleWorkspaceLabel = displayLabel(workspaceLabel, workspaceName(workspace))

  /**
   * Resolves a named workspace from the workspace map.
   * Returns { resolvedWorkspace, resolvedLabel, resolvedWorkspaceName } for the given target name,
   * or falls back to the default workspace when name is empty/unknown.
   */
  function resolveWorkspace(name) {
    const key = String(name ?? '').trim().toLowerCase()
    if (key && workspaceMap[key]) {
      return {
        resolvedWorkspace: workspaceMap[key],
        resolvedLabel: displayLabel(name, workspaceName(workspaceMap[key])),
        resolvedWorkspaceName: key,
      }
    }
    return { resolvedWorkspace: workspace, resolvedLabel: visibleWorkspaceLabel, resolvedWorkspaceName: '' }
  }

  function reportFailure(error, context = {}) {
    const failure = classifyCodexFailure(error)
    try {
      onError({ ...context, failure, diagnostic: failure.diagnostic })
    } catch { /* Local diagnostics must not change the job outcome. */ }
  }

  async function sessionsAfterRun(fallback) {
    try {
      return await listSessions()
    } catch {
      return fallback
    }
  }

  function resolveCompletedSession(before, after, selected, observedSessionId = '') {
    if (selected) return selected
    const observed = sessionId(observedSessionId)
    if (observed) return after.find((item) => item.id === observed) ?? { id: observed, name: '已选会话', updatedAt: null }
    const known = new Set(before.map((item) => item.id))
    const created = after.filter((item) => !known.has(item.id))
    return created.length === 1 ? created[0] : null
  }

  async function persistSelectedSession(session) {
    if (!session?.id) return
    try {
      await saveSelectedSession(session.id)
    } catch { /* A local selection write must not turn a completed task into a failure. */ }
  }

  async function selectedSession(sessions) {
    const available = sessions ?? await listSessions()
    const saved = sessionId(await loadSelectedSession())
    const preferred = saved || configured
    if (preferred) {
      const selected = available.find((item) => item.id === preferred)
      if (selected) return selected
      // A stored selection is local state, so a migration must not resurrect
      // an unavailable historical conversation. An explicit env selection is
      // intentional and remains available for manual recovery.
      if (!saved && configured) return { id: configured, name: '已选会话', updatedAt: null }
    }
    return null
  }

  async function status({ includeSessions = true } = {}) {
    const sessions = includeSessions ? await listSessions() : []
    const selected = includeSessions ? await selectedSession(sessions) : null
    return {
      sessions,
      selected,
      workspaceLabel: visibleWorkspaceLabel,
      activeJobs: [...activeJobs.values()].map((job) => ({
        id: job.id,
        sessionId: job.sessionId,
        taskName: job.taskName,
        workspaceLabel: job.workspaceLabel,
        workspaceName: job.workspaceName,
        transport: job.transport || '',
        startedAt: job.startedAt,
        lastEventAt: job.lastEventAt,
        stage: job.stage,
      })),
    }
  }

  async function select(index) {
    const sessions = await listSessions()
    const numericIndex = Number(index)
    const selected = sessions[numericIndex - 1]
    if (!selected) throw new Error('Requested Codex session was not found.')
    await saveSelectedSession(selected.id)
    return { ...selected, index: numericIndex }
  }

  async function submit(instruction, options = {}) {
    const { onComplete } = options
    const message = String(instruction ?? '').trim()
    if (!message) throw new Error('Codex instruction is empty.')
    if (message.length > maxInstructionLength) throw new Error(`Codex instruction exceeds ${maxInstructionLength} characters.`)
    // Support named workspace from the workspace map (e.g. "hyperion", "buct")
    const { resolvedWorkspace, resolvedLabel, resolvedWorkspaceName } = resolveWorkspace(options.workspaceName)
    if (!existsSync(resolvedWorkspace)) throw new Error('Configured Codex workspace is unavailable.')
    if (activeJobs.size) throw new Error('Iris already has a running Codex instruction.')

    const sessions = await listSessions()
    const requestedSessionId = sessionId(options.sessionId)
    const selected = requestedSessionId
      ? sessions.find((item) => item.id === requestedSessionId) ?? { id: requestedSessionId, name: 'Selected conversation', updatedAt: null }
      : await selectedSession(sessions)
    // The completion label describes this turn, not the older title of the
    // selected conversation. This also prevents a stale "selected session"
    // title from being shown for a new QQ instruction.
    const taskTitle = taskName(message) || taskName(selected?.name) || 'Codex 任务'
    // Iris already constrains writes to the configured workspace. Allow that
    // workspace to be non-Git (for example, a freshly migrated project).
    const baseArgs = ['-C', resolvedWorkspace, '-s', 'workspace-write', '-a', 'never', 'exec', '--skip-git-repo-check']
    const argsFor = (session) => session
      ? [...baseArgs, 'resume', session.id, '--json', message]
      : [...baseArgs, '--json', message]
    const id = `codex-${now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const job = {
      id,
      sessionId: selected?.id ?? '',
      workspaceLabel: resolvedLabel,
      workspaceName: resolvedWorkspaceName,
      taskName: taskTitle,
      startedAt: new Date(now()).toISOString(),
      lastEventAt: new Date(now()).toISOString(),
      stage: '正在启动 Codex',
      abort: null,
    }
    const onEvent = ({ stage }) => {
      if (!stage) return
      const observedAt = new Date(now()).toISOString()
      const changed = job.stage !== stage
      job.stage = stage
      job.lastEventAt = observedAt
      if (changed) {
        try { onProgress({ id, sessionId: job.sessionId, stage, observedAt }) } catch { /* Progress is advisory. */ }
      }
    }
    activeJobs.set(id, job)
    let invocation
    try {
      let desktopFailure = null
      if (desktop && selected?.id) {
        try {
          const forwarded = await desktop.startTurn({
            sessionId: selected.id,
            message,
            // A desktop thread owns its cwd and permission context. Passing
            // Iris's default workspace here can make the right thread answer
            // from the wrong project context.
            cwd: null,
          })
          if (forwarded) {
            invocation = forwarded
            job.transport = forwarded.transport || 'desktop-ipc'
            job.turnId = forwarded.turnId || ''
            job.stage = '正在等待桌面 Codex'
          }
        } catch (error) {
          // A desktop-owned thread must not fall through to CLI resume. That
          // would either hit the writer lock or silently lose its context.
          desktopFailure = error
        }
      }
      if (!invocation && desktopFailure) {
        invocation = { promise: Promise.reject(desktopFailure), abort: () => false }
      } else if (!invocation) {
        invocation = runner(argsFor(selected), { onEvent })
        job.transport = 'cli'
      }
    } catch (error) {
      activeJobs.delete(id)
      reportFailure(error, { sessionId: selected?.id ?? '' })
      throw error
    }
    job.abort = invocation.abort
    const responsePromise = (async () => {
      try {
        return { response: await invocation.promise, selected }
      } catch (error) {
        // A locked selected session cannot be replaced with a fresh session:
        // doing so silently drops the conversation context and can produce a
        // confident answer to the wrong task. Surface the lock to QQ instead.
        throw error
      }
    })()
    const completion = responsePromise
      .then(async ({ response, selected: completedSelection }) => {
        const text = response.text || parseJsonlText(response.stdout)
        const after = await sessionsAfterRun(sessions)
        const resolved = resolveCompletedSession(sessions, after, completedSelection, parseJsonlSessionId(response.stdout))
        await persistSelectedSession(resolved)
        job.sessionId = resolved?.id ?? job.sessionId
          return {
            ok: true,
            id,
            transport: job.transport,
            turnId: job.turnId,
            session: resolved,
          taskName: taskTitle,
          workspaceLabel: resolvedLabel,
          workspaceName: resolvedWorkspaceName,
          text: text || 'Codex 已完成本次处理，但没有可显示的文本结果。',
        }
      })
      .catch(async (error) => {
        reportFailure(error, { id, sessionId: selected?.id ?? '' })
        const after = await sessionsAfterRun(sessions)
        const resolved = resolveCompletedSession(sessions, after, selected, error?.codexSessionId)
        await persistSelectedSession(resolved)
        job.sessionId = resolved?.id ?? job.sessionId
        const failure = classifyCodexFailure(error)
        return {
          ok: false,
          id,
          session: resolved,
          taskName: taskTitle,
          workspaceLabel: resolvedLabel,
          workspaceName: resolvedWorkspaceName,
          status: failure.status,
          failure: failure.code,
          text: failure.text,
        }
      })
      .finally(async () => {
        activeJobs.delete(id)
      })
    job.completion = typeof onComplete === 'function'
      ? completion.then(async (result) => {
          try { await onComplete(result) } catch { /* Completion delivery must not change the Codex result. */ }
          return result
        })
      : completion
    return job
  }

  function abort() {
    const job = [...activeJobs.values()].at(-1)
    if (!job) return false
    if (job.abort?.() === false) return false
    job.stage = '正在停止 Codex'
    job.lastEventAt = new Date(now()).toISOString()
    try { onProgress({ id: job.id, sessionId: job.sessionId, stage: job.stage, observedAt: job.lastEventAt }) } catch { /* Progress is advisory. */ }
    return true
  }

  /** Exposes the workspace map keys so the command router can detect project names. */
  function workspaceNames() {
    return { ...workspaceMap }
  }

  return { status, select, submit, abort, workspaceNames }
}

export { parseJsonlSessionId, parseJsonlText }
