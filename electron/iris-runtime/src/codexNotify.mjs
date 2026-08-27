/**
 * Global Codex completion hook. It preserves the desktop notification and
 * forwards verified top-level Codex turns to Iris. It reads only session
 * metadata, plus final-text fallback when the official payload omits it.
 */

import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, open, readFile, readdir, rm, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { readCodexSessions } from './codex.mjs'

const sessionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const sourceDirectory = dirname(fileURLToPath(import.meta.url))
const irisDirectory = resolve(sourceDirectory, '..')

function validSessionId(value) {
  const id = typeof value === 'string' ? value.trim() : ''
  return sessionPattern.test(id) ? id : ''
}

function parseWorkspaceMap(value) {
  if (typeof value !== 'string') return {}
  const map = {}
  for (const entry of value.split(';').map((item) => item.trim()).filter(Boolean)) {
    const divider = entry.indexOf(':')
    if (divider < 1) continue
    const name = entry.slice(0, divider).trim().toLowerCase()
    const path = entry.slice(divider + 1).trim()
    if (name && path) map[name] = path
  }
  return map
}

function comparablePath(value) {
  return resolve(String(value ?? '').trim()).replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase()
}

/** Maps a verified local Codex cwd to the configured safe workspace name. */
export function resolveWorkspaceName(cwd, workspaceMapValue = process.env.IRIS_CODEX_WORKSPACE_MAP) {
  const target = comparablePath(cwd)
  if (!target) return ''
  for (const [name, path] of Object.entries(parseWorkspaceMap(workspaceMapValue))) {
    if (comparablePath(path) === target) return name
  }
  return ''
}

function visit(value, visitor, depth = 0) {
  if (depth > 5 || value == null) return ''
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = visit(item, visitor, depth + 1)
      if (found) return found
    }
    return ''
  }
  if (typeof value !== 'object') return ''
  for (const [key, item] of Object.entries(value)) {
    const found = visitor(key, item) || visit(item, visitor, depth + 1)
    if (found) return found
  }
  return ''
}

function collectPayloadFields(value, fields, depth = 0) {
  if (depth > 5 || value == null) return
  if (Array.isArray(value)) {
    for (const item of value) collectPayloadFields(item, fields, depth + 1)
    return
  }
  if (typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.replace(/[_-]/g, '').toLowerCase()
    if (!fields.sessionId && /^(thread|session|conversation|task)id$/.test(normalized)) fields.sessionId = validSessionId(item)
    if (!fields.turnId && normalized === 'turnid') fields.turnId = String(item ?? '').trim().slice(0, 200)
    if (!fields.finalText && normalized === 'lastassistantmessage') fields.finalText = visiblePayloadText(item)
    collectPayloadFields(item, fields, depth + 1)
  }
}

function visiblePayloadText(value) {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''
  if (typeof value.text === 'string') return value.text.trim()
  return messageText(value)
}

export function extractSessionId(argumentsList) {
  for (const argument of argumentsList) {
    try {
      const payload = JSON.parse(argument)
      const found = visit(payload, (key, value) => (
        /^(?:thread|session|conversation|task)[_-]?id$/i.test(key) ? validSessionId(value) : ''
      ))
      if (found) return found
    } catch { /* Static notify arguments are allowed alongside JSON payloads. */ }
  }
  return ''
}

/** Reads the official agent-turn-complete JSON payload passed to Codex notify. */
export function extractCompletionPayload(argumentsList) {
  const fields = { sessionId: '', turnId: '', finalText: '' }
  for (const argument of argumentsList) {
    try {
      collectPayloadFields(JSON.parse(argument), fields)
    } catch { /* Notify hooks may also include static arguments. */ }
  }
  return fields
}

export function notificationEventKey({ turnId, sessionId, finalText } = {}) {
  const stable = String(turnId ?? '').trim() || `${validSessionId(sessionId)}\n${String(finalText ?? '').trim()}`
  return createHash('sha256').update(stable || 'unknown-codex-completion').digest('hex')
}

export function shouldLaunchNativeNotifier(environment = process.env) {
  return environment.IRIS_NOTIFY_DRY_RUN !== '1' && environment.IRIS_NOTIFY_SKIP_NATIVE !== '1'
}

/** Atomically claims a hook delivery across processes. Stale claims self-heal. */
export async function claimNotification(key, {
  locksDirectory = join(irisDirectory, '.iris-notification-locks'),
  staleAfterMs = 7 * 24 * 60 * 60 * 1_000,
} = {}) {
  await mkdir(locksDirectory, { recursive: true })
  const lockPath = join(locksDirectory, String(key).replace(/[^a-z0-9_-]/gi, '').slice(0, 128))
  try {
    await mkdir(lockPath, { recursive: false })
    return true
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    try {
      const existing = await stat(lockPath)
      if (Date.now() - existing.mtimeMs > staleAfterMs) {
        await rm(lockPath, { recursive: true, force: true })
        await mkdir(lockPath, { recursive: false })
        return true
      }
    } catch { /* A competing hook owns or refreshed the claim. */ }
    return false
  }
}

async function readIrisCodexHome() {
  const configured = process.env.IRIS_CODEX_HOME || process.env.CODEX_HOME
  if (configured) return configured
  try {
    const text = await readFile(join(irisDirectory, '.env'), 'utf8')
    const line = text.split(/\r?\n/).find((item) => item.startsWith('IRIS_CODEX_HOME='))
    return line ? line.slice('IRIS_CODEX_HOME='.length).trim() : ''
  } catch {
    return ''
  }
}

async function readWorkspaceMapValue() {
  if (process.env.IRIS_CODEX_WORKSPACE_MAP) return process.env.IRIS_CODEX_WORKSPACE_MAP
  try {
    const text = await readFile(join(irisDirectory, '.env'), 'utf8')
    const line = text.split(/\r?\n/).find((item) => item.startsWith('IRIS_CODEX_WORKSPACE_MAP='))
    return line ? line.slice('IRIS_CODEX_WORKSPACE_MAP='.length).trim() : ''
  } catch {
    return ''
  }
}

export async function readNotificationSessions(codexHome) {
  if (!codexHome) return []
  return readCodexSessions(join(codexHome, 'session_index.jsonl'), { codexHome })
}

export function selectNotificationSession(sessions, requestedId = '') {
  const requested = validSessionId(requestedId)
  if (!requested) return null
  return sessions.find((session) => session.id === requested) ?? null
}

export function isUserVisibleSessionMetadata(metadata, requestedId = '') {
  const id = validSessionId(metadata?.id)
  const requested = validSessionId(requestedId)
  if (!id || !requested || id !== requested) return false
  if (metadata?.thread_source === 'subagent' || metadata?.parent_thread_id) return false
  if (metadata?.source && typeof metadata.source === 'object' && metadata.source.subagent) return false
  if (metadata?.agent_path && metadata.agent_path !== '/root') return false
  return true
}

async function findSessionTranscript(codexHome, sessionId) {
  if (!codexHome || !sessionId) return ''
  const sessionsRoot = join(codexHome, 'sessions')
  try {
    const years = await readdir(sessionsRoot, { withFileTypes: true })
    for (const year of years.filter((entry) => entry.isDirectory()).sort((left, right) => right.name.localeCompare(left.name))) {
      const yearPath = join(sessionsRoot, year.name)
      const months = await readdir(yearPath, { withFileTypes: true })
      for (const month of months.filter((entry) => entry.isDirectory()).sort((left, right) => right.name.localeCompare(left.name))) {
        const monthPath = join(yearPath, month.name)
        const days = await readdir(monthPath, { withFileTypes: true })
        for (const day of days.filter((entry) => entry.isDirectory()).sort((left, right) => right.name.localeCompare(left.name))) {
          const directory = join(monthPath, day.name)
          const hit = (await readdir(directory, { withFileTypes: true })).find((entry) => (
            entry.isFile() && entry.name.endsWith('.jsonl') && entry.name.includes(sessionId)
          ))
          if (hit) return join(directory, hit.name)
        }
      }
    }
  } catch { /* A missing transcript must not block the completion notification. */ }
  return ''
}

async function readSessionMetadata(filePath) {
  if (!filePath) return null
  let input
  try {
    input = createReadStream(filePath, { encoding: 'utf8' })
    const lines = createInterface({ input, crlfDelay: Infinity })
    for await (const line of lines) {
      if (!line.trim()) continue
      const record = JSON.parse(line)
      return record?.type === 'session_meta' ? record.payload ?? null : null
    }
  } catch { /* Missing or malformed metadata must fail closed. */ }
  finally {
    input?.destroy()
  }
  return null
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

function messageText(payload) {
  const parts = Array.isArray(payload?.content) ? payload.content : []
  return parts
    .filter((part) => part?.type === 'output_text' || part?.type === 'text')
    .map((part) => String(part.text ?? ''))
    .join('')
    .trim()
}

export function extractFinalAssistantText(jsonl) {
  let commentaryFallback = ''
  for (const line of String(jsonl ?? '').split(/\r?\n/).reverse()) {
    try {
      const payload = JSON.parse(line)?.payload
      if (payload?.type !== 'message' || payload?.role !== 'assistant') continue
      const text = messageText(payload)
      if (!text) continue
      if (payload.phase === 'commentary') {
        commentaryFallback ||= text
        continue
      }
      return text
    } catch { /* Partial JSONL tail fragments are expected. */ }
  }
  return commentaryFallback
}

async function findNativeNotifier() {
  const runtimeRoot = join(process.env.LOCALAPPDATA ?? '', 'OpenAI', 'Codex', 'runtimes', 'cua_node')
  try {
    const entries = await readdir(runtimeRoot, { withFileTypes: true })
    const candidates = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const candidate = join(runtimeRoot, entry.name, 'bin', 'node_modules', '@oai', 'sky', 'bin', 'windows', 'codex-computer-use.exe')
      if (!existsSync(candidate)) return null
      return { candidate, modifiedAt: (await stat(candidate)).mtimeMs }
    }))
    return candidates.filter(Boolean).sort((left, right) => right.modifiedAt - left.modifiedAt)[0]?.candidate ?? ''
  } catch {
    return ''
  }
}

function launchDetached(command, argumentsList) {
  if (!command || !existsSync(command)) return false
  try {
    const child = spawn(command, argumentsList, { detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
    return true
  } catch {
    return false
  }
}

async function main() {
  const argumentsList = process.argv.slice(2)
  if (shouldLaunchNativeNotifier()) launchDetached(await findNativeNotifier(), argumentsList)

  // Bridged jobs already get a richer result directly from Iris.
  if (process.env.IRIS_CODEX_BRIDGE === '1') return

  const payload = extractCompletionPayload(argumentsList)
  console.log(`[Iris] Codex hook received (${payload.turnId || payload.sessionId || 'unidentified'})`)
  // The official payload is complete at hook time. Only transcript fallback needs
  // a short delay for the JSONL write to become visible on disk.
  const codexHome = await readIrisCodexHome()
  const requestedSessionId = payload.sessionId || extractSessionId(argumentsList)
  if (!requestedSessionId) {
    console.log('[Iris] Codex completion skipped (missing session id)')
    return
  }
  let session = selectNotificationSession(await readNotificationSessions(codexHome), requestedSessionId)
  if (!session) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 700))
    session = selectNotificationSession(await readNotificationSessions(codexHome), requestedSessionId)
  }
  if (!session) {
    console.log('[Iris] Codex completion skipped (non-user task)')
    return
  }
  const transcript = await findSessionTranscript(codexHome, session.id)
  const metadata = await readSessionMetadata(transcript)
  if (!isUserVisibleSessionMetadata(metadata, session.id)) {
    console.log('[Iris] Codex completion skipped (subagent or unverifiable task)')
    return
  }
  const finalText = payload.finalText || (transcript ? extractFinalAssistantText(await readTail(transcript)) : '')
  const source = payload.finalText ? 'payload' : 'transcript fallback'
  if (!finalText) {
    console.log('[Iris] Codex completion skipped (missing final text)')
    return
  }
  console.log(`[Iris] Codex final text source: ${source}`)
  const workspaceMapValue = await readWorkspaceMapValue()
  // A resumed session keeps its original session_meta.cwd. The hook process
  // cwd identifies the workspace used by the current Codex turn.
  const workspaceName = resolveWorkspaceName(process.cwd(), workspaceMapValue)
    || resolveWorkspaceName(metadata?.cwd, workspaceMapValue)
  if (process.env.IRIS_NOTIFY_DRY_RUN === '1') {
    console.log(JSON.stringify({ sessionId: session.id, title: session.name, workspaceName, finalText, source }))
    return
  }
  const eventKey = notificationEventKey({ turnId: payload.turnId, sessionId: session?.id, finalText })
  if (!(await claimNotification(eventKey))) {
    console.log('[Iris] Codex completion duplicate skipped')
    return
  }
  console.log('[Iris] Codex completion dispatch launched')
  const dispatchArguments = [
    join(sourceDirectory, 'index.mjs'),
    '--notify',
    '--session', session?.id ?? '',
    '--title', session?.name ?? 'Codex',
    '--message', finalText,
  ]
  if (workspaceName) dispatchArguments.push('--workspace', workspaceName)
  launchDetached(process.execPath, dispatchArguments)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`[Iris] Codex hook failed (${error?.code ?? error?.name ?? 'unknown'})`)
    process.exitCode = 1
  })
}
