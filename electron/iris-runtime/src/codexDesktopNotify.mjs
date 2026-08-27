/**
 * Watches top-level Codex desktop threads. The desktop app updates its local
 * state database but does not invoke the CLI notify hook for these turns.
 * Iris only reads the database and the bounded tail of each rollout.
 */

import { open } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { claimNotification, notificationEventKey, resolveWorkspaceName } from './codexNotify.mjs'

const defaultPollIntervalMs = 2_000
const maximumTailBytes = 1_024 * 1_024
const sessionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const irisDesktopTurns = new Set()

function validId(value) {
  const id = typeof value === 'string' ? value.trim() : ''
  return sessionPattern.test(id) ? id : ''
}

function normalizeLocalPath(value) {
  const text = String(value ?? '').trim().replace(/^\\\\\?\\/, '')
  return text ? resolve(text).replace(/[\\/]+$/, '').toLowerCase() : ''
}

function isWithin(root, target) {
  const relativePath = relative(root, target)
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${'\\'}`) && !isAbsolute(relativePath))
}

function resolveDesktopDatabase(codexHome = process.env.IRIS_CODEX_HOME || process.env.CODEX_HOME) {
  const configured = String(process.env.IRIS_CODEX_DESKTOP_STATE ?? '').trim()
  return configured || (codexHome ? join(codexHome, 'state_5.sqlite') : '')
}

async function readTail(filePath, maximumBytes = maximumTailBytes) {
  let file
  try {
    file = await open(filePath, 'r')
    const { size } = await file.stat()
    const length = Math.min(size, maximumBytes)
    const buffer = Buffer.alloc(length)
    await file.read(buffer, 0, length, Math.max(0, size - length))
    return buffer.toString('utf8')
  } catch {
    return ''
  } finally {
    await file?.close().catch(() => {})
  }
}

/** Extracts the newest desktop task completion from a rollout tail. */
export function parseDesktopTaskCompletion(jsonl) {
  for (const line of String(jsonl ?? '').split(/\r?\n/).reverse()) {
    try {
      const record = JSON.parse(line)
      const payload = record?.payload
      if (record?.type !== 'event_msg' || payload?.type !== 'task_complete') continue
      const turnId = String(payload.turn_id ?? '').trim().slice(0, 200)
      const finalText = String(payload.last_agent_message ?? '').trim()
      const errorMessage = typeof payload.error === 'string'
        ? payload.error.trim()
        : String(payload.error?.message ?? '').trim()
      if (!turnId || (!finalText && !errorMessage)) continue
      return {
        turnId,
        finalText,
        ...(errorMessage ? { errorMessage: errorMessage.slice(0, 3_000) } : {}),
        completedAt: String(payload.completed_at ?? '').trim(),
      }
    } catch { /* A rollout can end with a partial JSONL line. */ }
  }
  return null
}

function desktopTurnKey(sessionId, turnId) {
  return `${validId(sessionId)}:${String(turnId ?? '').trim().slice(0, 200)}`
}

/** Marks a desktop turn started through Iris so the background watcher does not duplicate it. */
export function registerIrisDesktopTurn(sessionId, turnId) {
  const key = desktopTurnKey(sessionId, turnId)
  if (!key.startsWith(':') && !key.endsWith(':')) irisDesktopTurns.add(key)
}

function isIrisDesktopTurn(sessionId, turnId) {
  return irisDesktopTurns.has(desktopTurnKey(sessionId, turnId))
}

/** Claims one desktop completion across the long-running Iris and --dispatch processes. */
export async function claimDesktopCompletion(completion) {
  const sessionId = validId(completion?.sessionId)
  const claimText = String(completion?.finalText ?? completion?.errorMessage ?? '').trim()
  if (!sessionId || !claimText) return false
  return claimNotification(notificationEventKey({
    turnId: completion?.turnId,
    sessionId,
    finalText: claimText,
  }))
}

function readDesktopThreads(databasePath, codexHome) {
  const db = new DatabaseSync(databasePath, { readOnly: true })
  try {
    return db.prepare(`
      SELECT id, rollout_path, title, cwd, updated_at_ms
      FROM threads
      WHERE source = 'vscode'
        AND (thread_source IS NULL OR thread_source = 'user')
        AND COALESCE(agent_path, '') = ''
        AND archived = 0
      ORDER BY updated_at_ms DESC
      LIMIT 100
    `).all().flatMap((row) => {
      const id = validId(row.id)
      const rolloutPath = String(row.rollout_path ?? '').trim().replace(/^\\\\\?\\/, '')
      const root = normalizeLocalPath(codexHome)
      const target = normalizeLocalPath(rolloutPath)
      if (!id || !rolloutPath || !root || !target || !isWithin(root, target)) return []
      return [{
        id,
        rolloutPath,
        title: String(row.title ?? '').trim().slice(0, 200),
        cwd: String(row.cwd ?? '').trim(),
        updatedAtMs: Number(row.updated_at_ms) || 0,
      }]
    })
  } finally {
    db.close()
  }
}

/** Reads one desktop rollout completion for the IPC transport. */
export async function readDesktopTurnCompletion(sessionId, { codexHome = process.env.IRIS_CODEX_HOME || process.env.CODEX_HOME, databasePath = resolveDesktopDatabase(codexHome) } = {}) {
  const id = validId(sessionId)
  if (!id || !databasePath) return null
  try {
    const row = readDesktopThreads(databasePath, codexHome).find((item) => item.id === id)
    if (!row) return null
    const completion = parseDesktopTaskCompletion(await readTail(row.rolloutPath))
    return completion ? { sessionId: id, ...completion } : null
  } catch {
    return null
  }
}

async function readDesktopCompletions(rows, workspaceMapValue) {
  const completions = []
  for (const row of rows) {
    const completion = parseDesktopTaskCompletion(await readTail(row.rolloutPath))
    if (!completion) continue
    completions.push({
      sessionId: row.id,
      title: row.title,
      workspaceName: resolveWorkspaceName(row.cwd, workspaceMapValue),
      ...completion,
    })
  }
  return completions
}

/** Starts a read-only desktop completion watcher. */
export function createCodexDesktopWatcher({
  codexHome = process.env.IRIS_CODEX_HOME || process.env.CODEX_HOME,
  databasePath = resolveDesktopDatabase(codexHome),
  workspaceMapValue = process.env.IRIS_CODEX_WORKSPACE_MAP,
  pollIntervalMs = defaultPollIntervalMs,
  onComplete,
  logger = () => {},
} = {}) {
  const seen = new Set()
  const threadUpdates = new Map()
  let initialized = false
  let closed = false
  let polling = false
  let timer
  let lastError = ''
  let lastErrorAt = 0

  async function poll() {
    if (closed || polling || !databasePath || typeof onComplete !== 'function') return
    polling = true
    try {
      const rows = readDesktopThreads(databasePath, codexHome)
      const changedRows = []
      for (const row of rows) {
        const previous = threadUpdates.get(row.id)
        threadUpdates.set(row.id, row.updatedAtMs)
        if (initialized && previous !== row.updatedAtMs) changedRows.push(row)
      }
      // Read the current completion once at startup so a metadata-only update
      // cannot replay an old answer as a new desktop turn.
      const completions = await readDesktopCompletions(initialized ? changedRows : rows, workspaceMapValue)
      for (const completion of completions) {
        const key = `${completion.sessionId}:${completion.turnId}`
        if (seen.has(key)) continue
        seen.add(key)
        if (isIrisDesktopTurn(completion.sessionId, completion.turnId)) continue
        if (!initialized) continue
        try {
          await onComplete(completion)
        } catch (error) {
          logger('warn', `Codex desktop completion delivery failed: ${String(error?.message ?? error).slice(0, 300)}`)
        }
      }
      initialized = true
      lastError = ''
    } catch (error) {
      const message = String(error?.message ?? error).slice(0, 300)
      const now = Date.now()
      if (message !== lastError || now - lastErrorAt > 60_000) {
        logger('warn', `Codex desktop watcher unavailable: ${message}`)
        lastError = message
        lastErrorAt = now
      }
    } finally {
      polling = false
    }
  }

  void poll()
  timer = setInterval(() => { void poll() }, Math.max(500, Number(pollIntervalMs) || defaultPollIntervalMs))
  timer.unref?.()

  return {
    close() {
      closed = true
      clearInterval(timer)
    },
    poll,
  }
}

export async function dispatchDesktopCompletion(completion, { dispatch, workspaceMapValue } = {}) {
  const sessionId = validId(completion?.sessionId)
  const finalText = String(completion?.finalText ?? '').trim()
  const errorMessage = String(completion?.errorMessage ?? '').trim()
  const claimText = finalText || errorMessage
  if (!sessionId || !claimText || typeof dispatch !== 'function') return false
  if (!(await claimDesktopCompletion({ ...completion, sessionId, finalText, errorMessage }))) return false
  await dispatch({
    sessionId,
    title: String(completion?.title ?? '').trim(),
    workspaceName: String(completion?.workspaceName ?? '').trim() || resolveWorkspaceName(completion?.cwd, workspaceMapValue),
    message: finalText || errorMessage,
    ...(errorMessage ? { errorMessage } : {}),
  })
  return true
}
