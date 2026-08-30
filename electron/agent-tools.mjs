import { spawn } from 'node:child_process'
import { mkdir, open, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

export const AGENT_FILE_READ_LIMIT = 192 * 1024
export const AGENT_FILE_WRITE_LIMIT = 16 * 1024 * 1024
export const AGENT_DIRECTORY_ENTRY_LIMIT = 4_000
export const AGENT_COMMAND_OUTPUT_LIMIT = 128 * 1024
export const AGENT_WEB_RESPONSE_LIMIT = 192 * 1024

export function agentPath(value) {
  const raw = String(value ?? '').trim()
  if (!raw || raw.length > 8_192) throw new TypeError('Agent path is invalid')
  return resolve(raw)
}

export function agentEncoding(value) {
  if (value === undefined || value === 'utf8' || value === 'utf-8') return 'utf8'
  if (value === 'base64') return 'base64'
  throw new TypeError('Agent file encoding must be utf8 or base64')
}

export function agentInteger(value, fallback, minimum, maximum) {
  if (value === undefined) return fallback
  const number = Math.trunc(Number(value))
  if (!Number.isFinite(number)) throw new TypeError('Agent numeric option is invalid')
  return Math.max(minimum, Math.min(maximum, number))
}

export function agentWebUrl(value) {
  const raw = String(value ?? '').trim()
  if (!raw || raw.length > 8_192) throw new TypeError('Agent web URL is invalid')
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('Agent web tools require an HTTP(S) URL')
  return url
}

function appendAgentOutput(chunks, value, state) {
  if (!value || state.truncated) return
  const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
  const remaining = AGENT_COMMAND_OUTPUT_LIMIT - state.bytes
  if (remaining <= 0) {
    state.truncated = true
    return
  }
  if (chunk.length > remaining) {
    chunks.push(chunk.subarray(0, remaining))
    state.bytes += remaining
    state.truncated = true
    return
  }
  chunks.push(chunk)
  state.bytes += chunk.length
}

async function readAgentWebBody(response, responseType) {
  const chunks = []
  let size = 0
  let truncated = false
  const reader = response.body?.getReader?.()
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = Buffer.from(value)
        const remaining = AGENT_WEB_RESPONSE_LIMIT - size
        if (remaining <= 0) {
          truncated = true
          await reader.cancel()
          break
        }
        if (chunk.length > remaining) {
          chunks.push(chunk.subarray(0, remaining))
          size += remaining
          truncated = true
          await reader.cancel()
          break
        }
        chunks.push(chunk)
        size += chunk.length
      }
    } finally {
      reader.releaseLock()
    }
  }
  const body = Buffer.concat(chunks)
  return {
    body: responseType === 'base64' ? body.toString('base64') : body.toString('utf8'),
    encoding: responseType === 'base64' ? 'base64' : 'utf8',
    bytes: size,
    truncated,
  }
}

export async function readAgentFile({ path, encoding, offset, length } = {}) {
  const target = agentPath(path)
  const selectedEncoding = agentEncoding(encoding)
  const details = await stat(target)
  if (!details.isFile()) throw new TypeError('Agent read_file target is not a file')
  const start = agentInteger(offset, 0, 0, Math.max(0, details.size))
  const requested = agentInteger(length, AGENT_FILE_READ_LIMIT, 1, AGENT_FILE_READ_LIMIT)
  const bytes = Math.max(0, Math.min(requested, details.size - start))
  const handle = await open(target, 'r')
  try {
    const buffer = Buffer.alloc(bytes)
    const { bytesRead } = await handle.read(buffer, 0, bytes, start)
    const content = buffer.subarray(0, bytesRead).toString(selectedEncoding)
    return {
      path: target,
      encoding: selectedEncoding,
      content,
      bytesRead,
      size: details.size,
      truncated: start + bytesRead < details.size,
    }
  } finally {
    await handle.close()
  }
}

export async function writeAgentFile({ path, content, encoding, createDirectories } = {}) {
  const target = agentPath(path)
  const selectedEncoding = agentEncoding(encoding)
  if (typeof content !== 'string') throw new TypeError('Agent write_file content must be text')
  const data = Buffer.from(content, selectedEncoding)
  if (data.length > AGENT_FILE_WRITE_LIMIT) throw new TypeError('Agent write_file content is too large')
  if (createDirectories === true) await mkdir(dirname(target), { recursive: true })
  await writeFile(target, data)
  return { path: target, bytesWritten: data.length, encoding: selectedEncoding }
}

export async function listAgentDirectory({ path, recursive, maxEntries } = {}) {
  const target = agentPath(path)
  const limit = agentInteger(maxEntries, 500, 1, AGENT_DIRECTORY_ENTRY_LIMIT)
  const entries = []
  const pending = [{ path: target, relative: '' }]
  while (pending.length && entries.length < limit) {
    const current = pending.shift()
    const children = await readdir(current.path, { withFileTypes: true })
    for (const child of children) {
      if (entries.length >= limit) break
      const relative = current.relative ? `${current.relative}\\${child.name}` : child.name
      const fullPath = resolve(current.path, child.name)
      const type = child.isDirectory() ? 'directory' : child.isFile() ? 'file' : child.isSymbolicLink() ? 'symlink' : 'other'
      entries.push({ path: fullPath, relativePath: relative, type })
      if (recursive === true && child.isDirectory()) pending.push({ path: fullPath, relative })
    }
  }
  return { path: target, entries, truncated: pending.length > 0 || entries.length >= limit }
}

export async function createAgentDirectory({ path, recursive } = {}) {
  const target = agentPath(path)
  await mkdir(target, { recursive: recursive !== false })
  return { path: target, created: true }
}

export async function deleteAgentPath({ path, recursive } = {}) {
  const target = agentPath(path)
  await rm(target, { recursive: recursive === true, force: true })
  return { path: target, deleted: true, recursive: recursive === true }
}

export function runAgentCommand({ command, cwd, timeoutMs, signal } = {}) {
  const script = String(command ?? '').trim()
  if (!script || script.length > 32_000) return Promise.reject(new TypeError('Agent command is invalid'))
  const workdir = cwd === undefined ? process.cwd() : agentPath(cwd)
  const timeout = agentInteger(timeoutMs, 300_000, 1_000, 3_600_000)
  const executable = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh'
  const args = process.platform === 'win32'
    ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]
    : ['-lc', script]
  return new Promise((resolveCommand, rejectCommand) => {
    let completed = false
    let timedOut = false
    const stdout = []
    const stderr = []
    const stdoutState = { bytes: 0, truncated: false }
    const stderrState = { bytes: 0, truncated: false }
    const child = spawn(executable, args, { cwd: workdir, windowsHide: true })
    const finish = (callback) => {
      if (completed) return
      completed = true
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      callback()
    }
    const onAbort = () => {
      try { child.kill() } catch { /* The child may already be gone. */ }
      finish(() => rejectCommand(signal?.reason || new Error('Agent command was cancelled')))
    }
    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill() } catch { /* The child may already be gone. */ }
    }, timeout)
    child.stdout?.on('data', (value) => appendAgentOutput(stdout, value, stdoutState))
    child.stderr?.on('data', (value) => appendAgentOutput(stderr, value, stderrState))
    child.once('error', (error) => finish(() => rejectCommand(error)))
    child.once('close', (exitCode, closeSignal) => finish(() => resolveCommand({
      command: script,
      cwd: workdir,
      exitCode,
      signal: closeSignal || null,
      timedOut,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
      outputTruncated: stdoutState.truncated || stderrState.truncated,
    })))
    if (signal?.aborted) onAbort()
    else signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

export async function executeAgentWebRequest({ url, method, headers, body, responseType, signal } = {}) {
  const target = agentWebUrl(url)
  const normalizedMethod = String(method || 'GET').trim().toUpperCase()
  const requestHeaders = headers && typeof headers === 'object' && !Array.isArray(headers) ? headers : undefined
  const requestBody = body === undefined || body === null ? undefined : String(body)
  const response = await fetch(target, {
    method: normalizedMethod,
    headers: requestHeaders,
    ...(requestBody === undefined ? {} : { body: requestBody }),
    redirect: 'follow',
    signal,
  })
  const payload = await readAgentWebBody(response, responseType === 'base64' ? 'base64' : 'utf8')
  return {
    url: response.url || target.toString(),
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    headers: Object.fromEntries(response.headers.entries()),
    ...payload,
  }
}

export async function openAgentWebpage({ url } = {}, { openExternal } = {}) {
  const target = agentWebUrl(url)
  if (typeof openExternal !== 'function') throw new TypeError('Agent webpage opener is unavailable')
  await openExternal(target.toString())
  return { opened: true, url: target.toString() }
}

export function createAgentTools({ openExternal } = {}) {
  return {
    readFile: (request) => readAgentFile(request),
    writeFile: (request) => writeAgentFile(request),
    listDirectory: (request) => listAgentDirectory(request),
    createDirectory: (request) => createAgentDirectory(request),
    deletePath: (request) => deleteAgentPath(request),
    runCommand: (request) => runAgentCommand(request),
    webRequest: (request) => executeAgentWebRequest(request),
    openWebpage: (request) => openAgentWebpage(request, { openExternal }),
  }
}
