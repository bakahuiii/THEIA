/**
 * Local Hermes CLI bridge. Runs 'hermes -z "<instruction>"' as a one-shot
 * subprocess and returns only the final text output to the QQ channel.
 * Supports session listing, selection, and resumption via --resume.
 */

import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import process from 'node:process'

const maxInstructionLength = 4_000
const defaultTimeoutMs = 180_000

// Strip ANSI escape sequences (colors, cursor, box-drawing via escape codes)
function stripAnsi(value) {
  return String(value ?? '')
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
}

// Remove Hermes CLI banner/session footer lines that are not the actual response.
const bannerPatterns = [
  /^Query:/,
  /^Initializing agent/,
  /^⚡ YOLO mode/,
  /^↻ Resumed session/,
  /^Resume this session with:/,
  /^hermes (--resume|-c) /,
  /^Session:\s+\S/,
  /^Title:\s+/,
  /^Duration:\s+/,
  /^Messages:\s+/,
  /^[─━═╭╰╮╯│┤├┬┴┼]+/,
  // Truncated banner fragment lines
  /messages\)$/,
  /auto-approved\.\s*\/yolo to turn$/,
  /^off\.$/,
  /^total messages\)$/,
]

function stripBanner(text) {
  return text
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      if (!t) return false
      return !bannerPatterns.some((p) => p.test(t))
    })
    .join('\n')
    .trim()
}

function tailText(value, maximum = 2_800) {
  const text = stripBanner(stripAnsi(String(value ?? ''))).replace(/\r\n/g, '\n')
  return text.length > maximum ? `...${text.slice(-(maximum - 3))}` : text
}

function cleanText(value, maximum = 3_000) {
  const text = stripBanner(stripAnsi(String(value ?? ''))).replace(/\r\n/g, '\n')
  return text.length > maximum ? `${text.slice(0, Math.max(1, maximum - 1))}...` : text
}

/**
 * Locate the hermes binary. Priority:
 *   1. IRIS_HERMES_ENTRY env var (absolute path to hermes or hermes.exe)
 *   2. Known venv path used on this machine
 *   3. Fall back to bare 'hermes' and let the OS PATH resolve it
 */
export function resolveHermesEntry(value = process.env.IRIS_HERMES_ENTRY) {
  const candidates = [
    value,
    join('H:', 'AI', 'hermes', 'hermes-agent', 'venv', 'Scripts', 'hermes.exe'),
    join('H:', 'AI', 'hermes', 'hermes-agent', 'venv', 'Scripts', 'hermes'),
    '/h/AI/hermes/hermes-agent/venv/Scripts/hermes',
    process.platform === 'win32' && process.env.APPDATA
      ? join(process.env.APPDATA, 'npm', 'hermes.cmd')
      : '',
  ].filter(Boolean)
  const found = candidates.find((c) => existsSync(c))
  return found ?? 'hermes'
}

export function createHermesRunner({
  entryPath = resolveHermesEntry(),
} = {}) {
  // Accepts an explicit args array (for session resumption) or builds default
  return (instruction, { timeoutMs = defaultTimeoutMs, args = null } = {}) => {
    const spawnArgs = args ?? ['chat', '-q', instruction, '--cli']
    const child = spawn(entryPath, spawnArgs, {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HERMES_IRIS_BRIDGE: '1' },
    })
    const promise = new Promise((resolve, reject) => {
      const output = []
      const errors = []
      child.stdout.on('data', (chunk) => output.push(chunk))
      child.stderr.on('data', (chunk) => errors.push(chunk))
      child.once('error', reject)
      let timer = null
      child.once('close', (code, signal) => {
        if (timer) clearTimeout(timer)
        const stdout = Buffer.concat(output).toString('utf8')
        const stderr = Buffer.concat(errors).toString('utf8')
        if (code === 0) resolve({ stdout, stderr })
        else reject(new Error(`Hermes exited (${code ?? signal ?? 'unknown'}): ${tailText(stderr) || 'no diagnostic'}`))
      })
      timer = setTimeout(() => {
        child.kill('SIGTERM')
        reject(new Error('Hermes response timed out.'))
      }, timeoutMs)
    })
    return { promise, abort: () => child.kill('SIGTERM') }
  }
}

// Session ID format: 20260808_201823_c9367f
const sessionIdPattern = /^[0-9]{8}_[0-9]{6}_[0-9a-f]{6}$/i

export function validHermesSessionId(value) {
  const id = typeof value === 'string' ? value.trim() : ''
  return sessionIdPattern.test(id) ? id : ''
}

/**
 * Reads recent Hermes sessions from `hermes sessions list`.
 * Returns [ { id, title, workspace, updatedAt } ] newest-first.
 */
export async function readHermesSessions({
  entryPath = resolveHermesEntry(),
  limit = 20,
} = {}) {
  try {
    const child = spawn(entryPath, ['sessions', 'list', '--limit', String(limit)], {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const chunks = []
    child.stdout.on('data', (chunk) => chunks.push(chunk))
    await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
    })
    const lines = Buffer.concat(chunks).toString('utf8').split(/\r?\n/)
    const sessions = []
    for (const line of lines) {
      if (!line.trim() || /^[-─\s]*$/.test(line) || /^Title\s/.test(line)) continue
      // Columns are separated by 2+ spaces: Title  Workspace  Last Active  ID
      const parts = line.trim().split(/\s{2,}/)
      if (parts.length < 2) continue
      const id = validHermesSessionId(parts.at(-1))
      if (!id) continue
      const title = cleanText(parts[0] === '—' ? '' : parts[0], 120) || '未命名会话'
      const workspace = parts.length >= 3 ? cleanText(parts[1], 60) : ''
      const updatedAt = parts.length >= 4 ? parts[2] : (parts[1] || '')
      sessions.push({ id, title, workspace, updatedAt })
    }
    return sessions
  } catch {
    return []
  }
}

export function createHermesClient({
  runner = createHermesRunner(),
  listSessions = readHermesSessions,
  loadSelectedSession = async () => '',
  saveSelectedSession = async () => {},
  configuredSessionId = process.env.IRIS_HERMES_SESSION_ID,
  onError = () => {},
  now = () => Date.now(),
} = {}) {
  const activeJobs = new Map()
  const configured = validHermesSessionId(configuredSessionId)

  function reportFailure(error) {
    try { onError({ diagnostic: cleanText(error?.message, 600) || 'Hermes failed without a diagnostic.' }) } catch { /* advisory */ }
  }

  async function resolvedSession(sessions) {
    const available = sessions ?? await listSessions()
    const saved = validHermesSessionId(await loadSelectedSession())
    const preferred = saved || configured
    if (preferred) {
      const found = available.find((item) => item.id === preferred)
      if (found) return found
      if (!saved && configured) return { id: configured, title: '已固定会话', workspace: '', updatedAt: null }
    }
    return null
  }

  async function status() {
    const sessions = await listSessions()
    const selected = await resolvedSession(sessions)
    return {
      sessions,
      selected,
      activeJobs: [...activeJobs.values()].map((job) => ({
        id: job.id,
        sessionId: job.sessionId,
        startedAt: job.startedAt,
      })),
    }
  }

  async function select(index) {
    const sessions = await listSessions()
    const found = sessions[Number(index) - 1]
    if (!found) throw new Error('Hermes session not found.')
    await saveSelectedSession(found.id)
    return found
  }

  async function run(instruction, options = {}) {
    const { onComplete } = options
    const message = String(instruction ?? '').trim()
    if (!message) throw new Error('Hermes instruction is empty.')
    if (message.length > maxInstructionLength) throw new Error(`Hermes instruction exceeds ${maxInstructionLength} characters.`)
    if (activeJobs.size) throw new Error('Iris already has a running Hermes instruction.')

    const sessions = await listSessions()
    const requestedId = validHermesSessionId(options.sessionId)
    const selected = requestedId
      ? sessions.find((item) => item.id === requestedId) ?? { id: requestedId, title: '指定会话', workspace: '', updatedAt: null }
      : await resolvedSession(sessions)

    // Resume existing session or start a new one
    const spawnArgs = selected
      ? ['chat', '-q', message, '--cli', '--resume', selected.id]
      : ['chat', '-q', message, '--cli']

    const id = `hermes-${now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const job = { id, sessionId: selected?.id ?? '', startedAt: new Date(now()).toISOString(), abort: null }

    let invocation
    try {
      invocation = runner(message, { args: spawnArgs })
    } catch (error) {
      reportFailure(error)
      throw error
    }

    job.abort = invocation.abort
    activeJobs.set(id, job)

    job.completion = invocation.promise
      .then(async ({ stdout }) => {
        const text = cleanText(stdout) || 'Hermes 已完成本次处理，但没有可显示的文本结果。'
        const after = await listSessions()
        const resolved = selected ?? after[0] ?? null
        if (resolved?.id) await saveSelectedSession(resolved.id)
        return { ok: true, id, session: resolved, text }
      })
      .catch((error) => {
        reportFailure(error)
        return { ok: false, id, session: selected, text: `Hermes 本机任务未完成：${cleanText(error?.message, 300)}` }
      })
      .finally(() => { activeJobs.delete(id) })

    if (typeof onComplete === 'function') {
      job.completion.then((result) => Promise.resolve(onComplete(result)).catch(() => {}))
    }

    return job
  }

  function abort() {
    const job = [...activeJobs.values()].at(-1)
    if (!job) return false
    job.abort?.()
    return true
  }

  return { run, abort, status, select }
}
