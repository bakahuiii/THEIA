import { existsSync, readdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { basename, join, resolve } from 'node:path'
import process from 'node:process'
import { parseWorkspaceMap } from './codex.mjs'

const sessionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function compact(value, maximum = 3_600) {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, maximum)
}

export function validClaudeSessionId(value) {
  const id = String(value ?? '').trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : ''
}

/** Resolves a native Claude Code executable without invoking a shell. */
export function resolveClaudeEntry(value = process.env.IRIS_CLAUDE_ENTRY) {
  const configured = String(value ?? '').trim()
  if (configured) return configured
  const appData = process.env.APPDATA ?? ''
  const candidates = [
    appData ? join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe') : '',
    appData ? join(appData, 'npm', 'claude.cmd') : '',
  ].filter(Boolean)
  return candidates.find((candidate) => existsSync(candidate)) ?? 'claude'
}

/** Uses the Claude Desktop-bundled Code runtime when available. */
export function resolveClaudeDesktopEntry(value = process.env.IRIS_CLAUDE_DESKTOP_HOME) {
  const home = String(value ?? '').trim() || join(process.env.LOCALAPPDATA ?? '', 'Claude-3p')
  const root = join(home, 'claude-code')
  try {
    const versions = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true }))
    const candidate = versions.map((entry) => join(root, entry.name, process.platform === 'win32' ? 'claude.exe' : 'claude')).find((item) => existsSync(item))
    if (candidate) return candidate
  } catch { /* Fall back to the installed Claude command. */ }
  return resolveClaudeEntry()
}

export function parseClaudeResult(stdout) {
  const source = compact(stdout, 24_000)
  if (!source) return { text: '', sessionId: '' }
  try {
    const payload = JSON.parse(source)
    return {
      text: compact(payload?.result ?? payload?.message?.content ?? payload?.text ?? source),
      sessionId: validClaudeSessionId(payload?.session_id ?? payload?.sessionId),
    }
  } catch {
    return { text: source, sessionId: '' }
  }
}

export function createClaudeRunner({
  entryPath = null,
  timeoutMs = 20 * 60_000,
  spawnProcess = spawn,
} = {}) {
  return ({ instruction, sessionId = '', workspace = process.cwd(), permissionMode = process.env.IRIS_CLAUDE_PERMISSION_MODE || 'acceptEdits' }) => {
    const entry = entryPath || resolveClaudeEntry()
    const args = ['-p', String(instruction), '--output-format', 'json', '--permission-mode', permissionMode]
    const resumed = validClaudeSessionId(sessionId)
    if (resumed) args.push('--resume', resumed)
    const child = spawnProcess(entry, args, { cwd: workspace, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => { stdout += chunk })
    child.stderr?.on('data', (chunk) => { stderr += chunk })
    let settled = false
    const promise = new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        if (!settled) child.kill('SIGTERM')
        rejectPromise(new Error('Claude Code response timed out.'))
      }, timeoutMs)
      child.once('error', (error) => { clearTimeout(timer); rejectPromise(error) })
      child.once('close', (code, signal) => {
        settled = true
        clearTimeout(timer)
        if (code === 0) resolvePromise({ stdout, stderr })
        else rejectPromise(new Error(`Claude Code exited (${code ?? signal ?? 'unknown'}): ${compact(stderr || stdout, 600) || 'no diagnostic'}`))
      })
    })
    return { promise, abort: () => child.kill('SIGTERM') }
  }
}

export function createClaudeClient({
  runner,
  entryPath,
  loadSelectedSession = async () => '',
  saveSelectedSession = async () => {},
  configuredSessionId = process.env.IRIS_CLAUDE_SESSION_ID,
  workspace = process.env.IRIS_CLAUDE_WORKSPACE || process.env.IRIS_CODEX_WORKSPACE || process.cwd(),
  workspaceMap = process.env.IRIS_CLAUDE_WORKSPACE_MAP || process.env.IRIS_CODEX_WORKSPACE_MAP,
  onError = () => {},
  now = () => Date.now(),
} = {}) {
  const execute = runner ?? createClaudeRunner({ entryPath })
  const activeJobs = new Map()
  const configured = validClaudeSessionId(configuredSessionId)
  const workspaces = parseWorkspaceMap(workspaceMap)

  function workspaceFor(name = '') {
    const selected = String(name).trim().toLowerCase()
    const path = selected ? workspaces[selected] : workspace
    const resolved = resolve(path)
    if (!existsSync(resolved)) throw new Error('Configured Claude Code workspace is unavailable.')
    return { path: resolved, label: basename(resolved) || 'Workspace' }
  }

  async function selectedSession(explicit = '') {
    const requested = validClaudeSessionId(explicit)
    return requested || validClaudeSessionId(await loadSelectedSession()) || configured
  }

  return {
    workspaceNames: () => ({ ...workspaces }),
    async status() {
      return { selectedSessionId: await selectedSession(), activeJobs: [...activeJobs.values()].map(({ id, startedAt, workspaceLabel }) => ({ id, startedAt, workspaceLabel })) }
    },
    async run(instruction, { sessionId = '', workspaceName = '', onComplete } = {}) {
      const message = compact(instruction, 12_000)
      if (!message) throw new Error('Claude Code instruction is empty.')
      if (activeJobs.size) throw new Error('Claude Code already has a running task.')
      const selectedWorkspace = workspaceFor(workspaceName)
      const resumedSessionId = await selectedSession(sessionId)
      const id = `claude-${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      const invocation = execute({ instruction: message, sessionId: resumedSessionId, workspace: selectedWorkspace.path })
      const job = { id, startedAt: new Date(now()).toISOString(), workspaceLabel: selectedWorkspace.label, sessionId: resumedSessionId, abort: invocation.abort }
      activeJobs.set(id, job)
      job.completion = invocation.promise
        .then(async ({ stdout }) => {
          const parsed = parseClaudeResult(stdout)
          const nextSessionId = parsed.sessionId || resumedSessionId
          if (nextSessionId) await saveSelectedSession(nextSessionId)
          return { id, ok: true, text: parsed.text || 'Claude Code completed without visible final text.', session: nextSessionId ? { id: nextSessionId, name: selectedWorkspace.label } : null, workspaceLabel: selectedWorkspace.label }
        })
        .catch((error) => {
          const diagnostic = compact(error?.message, 700) || 'Claude Code failed without a diagnostic.'
          onError({ id, diagnostic })
          return { id, ok: false, text: `Claude Code task did not complete: ${diagnostic}`, session: resumedSessionId ? { id: resumedSessionId, name: selectedWorkspace.label } : null, workspaceLabel: selectedWorkspace.label }
        })
        .finally(() => activeJobs.delete(id))
      if (typeof onComplete === 'function') job.completion.then((result) => Promise.resolve(onComplete(result)).catch(() => {}))
      return job
    },
    abort() {
      const active = activeJobs.values().next().value
      if (!active) return false
      active.abort?.()
      return true
    },
  }
}
