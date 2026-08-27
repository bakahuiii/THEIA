/**
 * Client for the local Codex desktop IPC router.
 *
 * Desktop-owned threads must be written by their renderer owner. Calling the
 * CLI with `resume` would compete for the same writer lock, so this transport
 * forwards the turn through Codex's named-pipe IPC protocol instead.
 */

import net from 'node:net'
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { readDesktopTurnCompletion, registerIrisDesktopTurn } from './codexDesktopNotify.mjs'

const defaultPipePath = process.platform === 'win32' ? '\\\\.\\pipe\\codex-ipc' : ''
const defaultHostId = 'local'
const defaultRequestTimeoutMs = 10_000
const defaultCompletionTimeoutMs = 620_000
const defaultPollIntervalMs = 1_000
const initializingClientId = 'initializing-client'

const ipcVersions = {
  'thread-owner-discovery': 1,
  'thread-follower-start-turn': 1,
  'thread-follower-steer-turn': 1,
  'thread-follower-interrupt-turn': 4,
  'thread-follower-submit-user-input': 1,
}

const sessionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function validSessionId(value) {
  const id = typeof value === 'string' ? value.trim() : ''
  return sessionPattern.test(id) ? id : ''
}

function errorWithCode(code, message, cause) {
  const error = new Error(message)
  error.code = code
  if (cause) error.cause = cause
  return error
}

function normalizeIpcError(error, fallbackCode = 'CODEX_DESKTOP_IPC_UNAVAILABLE') {
  if (error?.code?.startsWith?.('CODEX_DESKTOP_')) return error
  const message = String(error?.message ?? error ?? 'Codex desktop IPC is unavailable.')
  if (/request-timeout|timeout/i.test(message)) return errorWithCode('CODEX_DESKTOP_IPC_TIMEOUT', 'Codex desktop IPC request timed out.', error)
  if (/client-disconnected|server-closed|not-connected|closed|pipe|socket/i.test(message)) return errorWithCode(fallbackCode, 'Codex desktop IPC disconnected.', error)
  return errorWithCode(fallbackCode, message, error)
}

/** Encodes one Codex IPC JSON frame. */
export function encodeIpcFrame(value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  const frame = Buffer.allocUnsafe(4 + body.length)
  frame.writeUInt32LE(body.length, 0)
  body.copy(frame, 4)
  return frame
}

/** Decodes complete frames from a buffer, retaining a partial trailing frame. */
export function decodeIpcFrames(buffer) {
  let remaining = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? '')
  const messages = []
  while (remaining.length >= 4) {
    const size = remaining.readUInt32LE(0)
    if (size === 0 || size > 256 * 1024 * 1024) throw errorWithCode('CODEX_DESKTOP_IPC_PROTOCOL', `Invalid Codex IPC frame length: ${size}.`)
    if (remaining.length < size + 4) break
    messages.push(JSON.parse(remaining.subarray(4, size + 4).toString('utf8')))
    remaining = remaining.subarray(size + 4)
  }
  return { messages, remainder: remaining }
}

function textInput(message) {
  return [{ type: 'text', text: String(message ?? ''), text_elements: [] }]
}

function responseError(response, method) {
  if (response?.resultType !== 'error') return null
  const remote = String(response.error ?? 'Codex desktop IPC request failed.')
  const code = remote === 'request-timeout'
    ? 'CODEX_DESKTOP_IPC_TIMEOUT'
    : remote === 'client-disconnected'
      ? 'CODEX_DESKTOP_OWNER_DISCONNECTED'
      : 'CODEX_DESKTOP_REQUEST_FAILED'
  return errorWithCode(code, `Codex desktop ${method} failed: ${remote}.`)
}

function turnIdFromResult(result) {
  const candidate = result?.turn?.id
    ?? result?.result?.turn?.id
    ?? result?.result?.result?.turn?.id
    ?? result?.turnId
    ?? result?.id
  const value = String(candidate ?? '').trim()
  return value.length > 0 && value.length <= 200 ? value : ''
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function stopError() {
  return errorWithCode('CODEX_STOPPED', 'Codex desktop task was stopped by Iris.')
}

/**
 * Creates a lazy, reconnecting desktop transport. It does not open the named
 * pipe until Iris has a selected session to submit to.
 */
export function createCodexDesktopIpc({
  pipePath = process.env.IRIS_CODEX_IPC_PIPE || defaultPipePath,
  hostId = process.env.IRIS_CODEX_DESKTOP_HOST_ID || defaultHostId,
  clientType = 'iris',
  requestTimeoutMs = defaultRequestTimeoutMs,
  completionTimeoutMs = defaultCompletionTimeoutMs,
  pollIntervalMs = defaultPollIntervalMs,
  codexHome = process.env.IRIS_CODEX_HOME || process.env.CODEX_HOME,
  databasePath,
  socketFactory = (path) => net.createConnection(path),
  readCompletion = readDesktopTurnCompletion,
  registerTurn = registerIrisDesktopTurn,
} = {}) {
  let socket = null
  let clientId = ''
  let connectPromise = null
  let frameBuffer = Buffer.alloc(0)
  const pending = new Map()

  function rejectPending(error) {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    pending.clear()
  }

  function resetSocket(error) {
    const normalized = normalizeIpcError(error)
    rejectPending(normalized)
    socket = null
    clientId = ''
    frameBuffer = Buffer.alloc(0)
  }

  function attachSocket(candidate) {
    candidate.on('data', (chunk) => {
      try {
        frameBuffer = Buffer.concat([frameBuffer, chunk])
        const decoded = decodeIpcFrames(frameBuffer)
        frameBuffer = decoded.remainder
        for (const response of decoded.messages) {
          const entry = pending.get(response.requestId)
          if (!entry) continue
          pending.delete(response.requestId)
          clearTimeout(entry.timer)
          entry.resolve(response)
        }
      } catch (error) {
        resetSocket(error)
        candidate.destroy?.()
      }
    })
    candidate.once('error', (error) => resetSocket(error))
    candidate.once('close', () => resetSocket(errorWithCode('CODEX_DESKTOP_IPC_UNAVAILABLE', 'Codex desktop IPC connection closed.')))
    candidate.once('end', () => resetSocket(errorWithCode('CODEX_DESKTOP_IPC_UNAVAILABLE', 'Codex desktop IPC connection ended.')))
  }

  function requestOnSocket(method, params, { targetClientId = '', timeoutMs = requestTimeoutMs } = {}) {
    if (!socket?.writable) return Promise.reject(errorWithCode('CODEX_DESKTOP_IPC_UNAVAILABLE', 'Codex desktop IPC is not connected.'))
    const requestId = randomUUID()
    const request = {
      type: 'request',
      requestId,
      sourceClientId: clientId || initializingClientId,
      version: ipcVersions[method] ?? 0,
      method,
      params,
      ...(targetClientId ? { targetClientId } : {}),
      timeoutMs,
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        reject(errorWithCode('CODEX_DESKTOP_IPC_TIMEOUT', `Codex desktop ${method} request timed out.`))
      }, timeoutMs)
      pending.set(requestId, { resolve, reject, timer })
      try {
        socket.write(encodeIpcFrame(request))
      } catch (error) {
        clearTimeout(timer)
        pending.delete(requestId)
        reject(normalizeIpcError(error))
      }
    })
  }

  async function connect() {
    if (!pipePath) throw errorWithCode('CODEX_DESKTOP_IPC_UNAVAILABLE', 'Codex desktop IPC pipe is not configured.')
    if (clientId && socket?.writable) return clientId
    if (connectPromise) return connectPromise
    connectPromise = (async () => {
      let candidate
      try {
        candidate = socketFactory(pipePath)
        socket = candidate
        attachSocket(candidate)
        await new Promise((resolve, reject) => {
          const onConnect = () => { cleanup(); resolve() }
          const onError = (error) => { cleanup(); reject(error) }
          const cleanup = () => {
            candidate.off?.('connect', onConnect)
            candidate.off?.('error', onError)
          }
          candidate.once('connect', onConnect)
          candidate.once('error', onError)
        })
        const response = await requestOnSocket('initialize', { clientType }, { timeoutMs: requestTimeoutMs })
        const failure = responseError(response, 'initialize')
        if (failure) throw failure
        const initialized = String(response?.result?.clientId ?? '').trim()
        if (!initialized) throw errorWithCode('CODEX_DESKTOP_IPC_PROTOCOL', 'Codex desktop IPC did not return a client id.')
        clientId = initialized
        return clientId
      } catch (error) {
        resetSocket(error)
        candidate?.destroy?.()
        throw normalizeIpcError(error)
      } finally {
        connectPromise = null
      }
    })()
    return connectPromise
  }

  async function request(method, params, options = {}) {
    await connect()
    const response = await requestOnSocket(method, params, options)
    const failure = responseError(response, method)
    if (failure) throw failure
    return response
  }

  async function findOwner(sessionId) {
    const conversationId = validSessionId(sessionId)
    if (!conversationId) return null
    try {
      const response = await request('thread-owner-discovery', { hostId, conversationId })
      return String(response?.handledByClientId ?? '').trim() || null
    } catch (error) {
      if (/no-client-found/i.test(String(error?.message ?? ''))) return null
      throw error
    }
  }

  async function waitForCompletion(sessionId, turnId, timeoutMs) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      let completion = null
      try {
        completion = await readCompletion(sessionId, { codexHome, databasePath })
      } catch { /* SQLite may be briefly unavailable while the desktop app commits a turn. */ }
      if (completion?.turnId === turnId) {
        const finalText = String(completion.finalText ?? '').trim()
        const errorMessage = String(completion.errorMessage ?? '').trim()
        if (finalText) {
          return {
            stdout: '',
            stderr: '',
            code: 0,
            desktop: true,
            turnId,
            text: finalText,
          }
        }
        if (errorMessage) throw errorWithCode('CODEX_DESKTOP_TURN_FAILED', errorMessage)
      }
      await delay(Math.min(Math.max(100, Number(pollIntervalMs) || defaultPollIntervalMs), Math.max(100, deadline - Date.now())))
    }
    throw errorWithCode('CODEX_TIMEOUT', 'Codex desktop response timed out.')
  }

  async function startTurn({ sessionId, message, permissions = process.env.IRIS_CODEX_DESKTOP_PERMISSIONS || ':workspace', approvalPolicy = process.env.IRIS_CODEX_DESKTOP_APPROVAL_POLICY || 'never', cwd = null, timeoutMs = completionTimeoutMs } = {}) {
    const threadId = validSessionId(sessionId)
    if (!threadId) return null
    const ownerId = await findOwner(threadId)
    if (!ownerId) return null
    const turnStartParams = {
      threadId,
      clientUserMessageId: randomUUID(),
      input: textInput(message),
      cwd,
      approvalPolicy,
      permissions,
      runtimeWorkspaceRoots: [],
      model: null,
      effort: null,
      serviceTier: null,
      summary: null,
      personality: null,
      outputSchema: null,
      collaborationMode: null,
    }
    const params = {
      conversationId: threadId,
      turnStartParams,
      localTurnMetadata: null,
      mcpAppModelContextAttachments: null,
    }
    const response = await request('thread-follower-start-turn', params, { targetClientId: ownerId, timeoutMs: requestTimeoutMs })
    const turnId = turnIdFromResult(response?.result)
    if (!turnId) throw errorWithCode('CODEX_DESKTOP_IPC_PROTOCOL', 'Codex desktop did not return the started turn id.')
    registerTurn(threadId, turnId)
    let stopped = false
    let rejectStopped
    const stoppedPromise = new Promise((resolve, reject) => { rejectStopped = reject })
    const promise = Promise.race([
      waitForCompletion(threadId, turnId, timeoutMs),
      stoppedPromise,
    ]).catch((error) => {
      if (stopped) throw stopError()
      throw error
    })
    return {
      promise,
      turnId,
      transport: 'desktop-ipc',
      abort: () => {
        if (stopped) return false
        stopped = true
        rejectStopped(stopError())
        void request('thread-follower-interrupt-turn', { conversationId: threadId, mode: 'user-stop', expectedTurnId: turnId }, { targetClientId: ownerId }).catch(() => {})
        return true
      },
    }
  }

  function close() {
    const previous = socket
    resetSocket(errorWithCode('CODEX_DESKTOP_IPC_UNAVAILABLE', 'Codex desktop IPC closed by Iris.'))
    previous?.destroy?.()
    socket = null
  }

  return { connect, findOwner, startTurn, close }
}

export { defaultPipePath }
