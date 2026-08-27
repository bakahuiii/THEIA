import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { open, readdir, readFile, stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import process from 'node:process'

const localSessionPattern = /^local_[0-9a-f-]+$/i
const cliSessionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function resolveClaudeDesktopHome(value = process.env.IRIS_CLAUDE_DESKTOP_HOME) {
  const configured = String(value ?? '').trim()
  return configured || join(process.env.LOCALAPPDATA ?? '', 'Claude-3p')
}

export function parseClaudeDesktopCompletion(line) {
  const match = String(line ?? '').match(/\[Stop hook\] Query completed for session (local_[0-9a-f-]+)/i)
  return match && localSessionPattern.test(match[1]) ? match[1] : ''
}

function visibleText(content) {
  const parts = Array.isArray(content) ? content : []
  return parts
    .filter((part) => part?.type === 'text')
    .map((part) => decodeText(part.text))
    .join('')
    .trim()
}

export function decodeText(value) {
  if (Buffer.isBuffer(value)) return value.toString('utf8')
  if (value?.type === 'Buffer' && Array.isArray(value.data)) return Buffer.from(value.data).toString('utf8')
  return typeof value === 'string' ? value : ''
}

function normalizeStringControls(source) {
  let quoted = false
  let escaped = false
  let normalized = ''
  for (const character of source) {
    if (quoted && (character === '\n' || character === '\r' || character === '\t')) {
      normalized += character === '\t' ? '\\t' : '\\n'
      continue
    }
    normalized += character
    if (escaped) escaped = false
    else if (character === '\\') escaped = true
    else if (character === '"') quoted = !quoted
  }
  return normalized
}

/** Parses Claude Desktop records even when its local writer left literal newlines in a JSON string. */
export function parseClaudeDesktopRecords(source) {
  const records = []
  const text = String(source ?? '')
  let start = -1
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (start < 0) {
      if (character === '{') {
        start = index
        depth = 1
        quoted = false
        escaped = false
      }
      continue
    }
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === '"') {
      quoted = !quoted
      continue
    }
    if (quoted) continue
    if (character === '{') depth += 1
    if (character !== '}') continue
    depth -= 1
    if (depth !== 0) continue
    try {
      records.push(JSON.parse(normalizeStringControls(text.slice(start, index + 1))))
    } catch { /* Keep scanning: a damaged record must not hide a later result. */ }
    start = -1
  }
  return records
}

/** Reads only final visible assistant text, never thoughts, tools, or subagents. */
export function extractClaudeDesktopFinalText(jsonl) {
  for (const item of parseClaudeDesktopRecords(jsonl).reverse()) {
    if (item?.isSidechain || item?.type !== 'assistant' || item?.message?.role !== 'assistant') continue
    const text = visibleText(item.message.content)
    if (text) return text
  }
  return ''
}

async function readTail(filePath, maximumBytes = 768 * 1024) {
  try {
    const handle = await open(filePath, 'r')
    try {
      const { size } = await handle.stat()
      const length = Math.min(size, maximumBytes)
      const buffer = Buffer.alloc(length)
      await handle.read(buffer, 0, length, Math.max(0, size - length))
      return buffer.toString('utf8')
    } finally {
      await handle.close()
    }
  } catch {
    return ''
  }
}

async function findDesktopSession(home, localSessionId) {
  const root = join(home, 'claude-code-sessions')
  try {
    const accounts = await readdir(root, { withFileTypes: true })
    for (const account of accounts.filter((entry) => entry.isDirectory())) {
      const sessions = await readdir(join(root, account.name), { withFileTypes: true })
      for (const session of sessions.filter((entry) => entry.isDirectory())) {
        const files = await readdir(join(root, account.name, session.name), { withFileTypes: true })
        for (const file of files.filter((entry) => entry.isFile() && entry.name.startsWith('local_') && entry.name.endsWith('.json'))) {
          try {
            const data = JSON.parse(await readFile(join(root, account.name, session.name, file.name), 'utf8'))
            if (data?.sessionId === localSessionId) return data
          } catch { /* A desktop session record may be mid-write. */ }
        }
      }
    }
  } catch { /* Claude Desktop may not be installed or signed in yet. */ }
  return null
}

export async function readClaudeDesktopSessions(desktopHome = resolveClaudeDesktopHome()) {
  const root = join(desktopHome, 'claude-code-sessions')
  const sessions = []
  try {
    const accounts = await readdir(root, { withFileTypes: true })
    for (const account of accounts.filter((entry) => entry.isDirectory())) {
      const accountRoot = join(root, account.name)
      const sessionDirectories = await readdir(accountRoot, { withFileTypes: true })
      for (const directory of sessionDirectories.filter((entry) => entry.isDirectory())) {
        const files = await readdir(join(accountRoot, directory.name), { withFileTypes: true })
        for (const file of files.filter((entry) => entry.isFile() && entry.name.startsWith('local_') && entry.name.endsWith('.json'))) {
          try {
            const item = JSON.parse(await readFile(join(accountRoot, directory.name, file.name), 'utf8'))
            if (!localSessionPattern.test(item?.sessionId)) continue
            sessions.push({
              localSessionId: item.sessionId,
              cliSessionId: cliSessionPattern.test(item.cliSessionId) ? item.cliSessionId : '',
              title: String(item.title ?? '').trim() || 'Claude Desktop',
              cwd: String(item.cwd ?? '').trim(),
              completedTurns: Number.isInteger(item.completedTurns) ? item.completedTurns : 0,
              lastActivityAt: Number(item.lastActivityAt) || 0,
              isArchived: item.isArchived === true,
            })
          } catch { /* Ignore records currently being written by Claude Desktop. */ }
        }
      }
    }
  } catch { /* Missing data means Claude Desktop is not ready or not installed. */ }
  return sessions.sort((left, right) => right.lastActivityAt - left.lastActivityAt)
}

export async function inspectClaudeDesktop({ desktopHome = resolveClaudeDesktopHome(), watcher = null } = {}) {
  const sessions = await readClaudeDesktopSessions(desktopHome)
  let logExists = false
  let logSize = 0
  try {
    const details = await stat(join(desktopHome, 'logs', 'main.log'))
    logExists = true
    logSize = details.size
  } catch { /* The status response remains useful before first launch. */ }
  const latest = sessions[0] ?? null
  return {
    enabled: true,
    home: desktopHome,
    dataDirectoryExists: existsSync(desktopHome),
    logExists,
    logSize,
    sessions: sessions.slice(0, 12).map(({ localSessionId, cliSessionId, title, cwd, completedTurns, lastActivityAt, isArchived }) => ({ localSessionId, cliSessionId, title, workspace: basename(cwd) || '', completedTurns, lastActivityAt, isArchived })),
    currentSession: latest ? { localSessionId: latest.localSessionId, cliSessionId: latest.cliSessionId, title: latest.title, workspace: basename(latest.cwd) || '', completedTurns: latest.completedTurns, lastActivityAt: latest.lastActivityAt } : null,
    watcher: watcher?.status?.() ?? { running: false, lastCompletionAt: null, lastSessionId: null },
  }
}

async function findTranscript(claudeHome, sessionId) {
  if (!cliSessionPattern.test(sessionId) || !existsSync(claudeHome)) return ''
  try {
    const entries = await readdir(claudeHome, { recursive: true, withFileTypes: true })
    const expected = `${sessionId}.jsonl`
    const hit = entries.find((entry) => entry.isFile() && entry.name === expected)
    if (!hit) return ''
    return join(hit.parentPath ?? hit.path ?? claudeHome, hit.name)
  } catch {
    return ''
  }
}

export async function readClaudeDesktopCompletion(localSessionId, {
  desktopHome = resolveClaudeDesktopHome(),
  claudeHome = join(process.env.USERPROFILE ?? '', '.claude', 'projects'),
} = {}) {
  const session = await findDesktopSession(desktopHome, localSessionId)
  if (!session) return null
  const cliSessionId = cliSessionPattern.test(session.cliSessionId) ? session.cliSessionId : ''
  const transcript = await findTranscript(claudeHome, cliSessionId)
  const text = transcript ? extractClaudeDesktopFinalText(await readTail(transcript)) : ''
  const completedTurns = Number.isInteger(session.completedTurns) ? session.completedTurns : 0
  const title = String(session.title ?? '').trim() || 'Claude Desktop'
  const workspace = basename(String(session.cwd ?? '').trim()) || ''
  const fingerprint = createHash('sha256').update(`${localSessionId}\n${completedTurns}\n${text}`).digest('hex')
  return {
    id: `claude-desktop-${fingerprint.slice(0, 16)}`,
    ok: true,
    text: text || 'Claude Desktop 已完成本轮处理，但未找到可显示的最终文本。',
    session: cliSessionId ? { id: cliSessionId, name: title } : { id: '', name: title },
    workspaceLabel: workspace,
    continuation: '请在 Claude 桌面端继续该会话。',
    fingerprint,
  }
}

/** Polls the desktop-owned log. The log's Stop hook is emitted once a turn is complete. */
export function createClaudeDesktopWatcher({
  desktopHome = resolveClaudeDesktopHome(),
  intervalMs = 2_000,
  onComplete = async () => {},
  onError = () => {},
  logger = () => {},
} = {}) {
  const logPath = join(desktopHome, 'logs', 'main.log')
  const delivered = new Set()
  let lastCompletion = null
  let offset = null
  let stopped = false
  let scanning = false

  async function scan() {
    if (stopped || scanning) return
    scanning = true
    try {
      const details = await stat(logPath)
      if (offset === null) {
        offset = details.size
        return
      }
      if (details.size < offset) offset = 0
      if (details.size === offset) return
      const handle = await open(logPath, 'r')
      let text = ''
      try {
        const length = details.size - offset
        const buffer = Buffer.alloc(length)
        await handle.read(buffer, 0, length, offset)
        text = buffer.toString('utf8')
      } finally {
        await handle.close()
      }
      offset = details.size
      for (const line of text.split(/\r?\n/)) {
        const localSessionId = parseClaudeDesktopCompletion(line)
        if (!localSessionId) continue
        const result = await readClaudeDesktopCompletion(localSessionId, { desktopHome })
        if (!result || delivered.has(result.fingerprint)) continue
        delivered.add(result.fingerprint)
        if (delivered.size > 128) delivered.delete(delivered.values().next().value)
        logger('info', `Claude Desktop completion detected (${localSessionId.slice(0, 14)}...)`)
        lastCompletion = { at: new Date().toISOString(), sessionId: localSessionId, id: result.id, textLength: result.text.length }
        await onComplete(result)
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') onError(error)
    } finally {
      scanning = false
    }
  }

  void scan()
  const timer = setInterval(() => { void scan() }, intervalMs)
  return {
    close() { stopped = true; clearInterval(timer) },
    scan,
    status() {
      return { running: !stopped, lastCompletionAt: lastCompletion?.at ?? null, lastSessionId: lastCompletion?.sessionId ?? null, lastCompletionId: lastCompletion?.id ?? null, lastTextLength: lastCompletion?.textLength ?? 0 }
    },
  }
}
