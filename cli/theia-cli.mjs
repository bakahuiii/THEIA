#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { CampusStore } from '../core/store.mjs'
import { writeAiExport } from '../core/ai-export.mjs'
import { collectionCsv, counts, toTheiaFeed, toIcs } from '../core/schema.mjs'
import { startLocalApi } from '../core/local-api.mjs'
import { defaultDataRoot } from '../core/runtime-paths.mjs'
import { CourseWorkService } from '../core/course-work.mjs'
import { CourseSelectionJournal } from '../core/course-selection-journal.mjs'

function parseArgs(argv) {
  const result = { _: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (!value.startsWith('--')) result._.push(value)
    else {
      const [key, inline] = value.slice(2).split('=', 2)
      if (inline !== undefined) result[key] = inline
      else if (argv[index + 1] && !argv[index + 1].startsWith('--')) result[key] = argv[++index]
      else result[key] = true
    }
  }
  return result
}

function help() {
  return `THEIA 本地数据命令行\n\n` +
    `用法:\n` +
    `  theia status [--json]\n` +
    `  theia export --format json|ndjson|theia|ics|csv [--collection grades] [--output FILE]\n` +
    `  theia export --format ai --output DIRECTORY\n` +
    `  theia work list|show <assignment-id>|import <assignment-id> --file FILE [--kind answer|answer-key]\n` +
    `  theia serve [--port 8765]\n` +
    `  theia api\n` +
    `  theia doctor\n\n` +
    `环境变量:\n  THEIA_DATA_ROOT  覆盖本地数据目录\n`
}

function sensitiveDiagnosticKey(value) {
  const key = String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase()
  return [
    'password', 'passcode', 'apikey', 'authorization', 'cookie', 'session',
    'sessionid', 'jsessionid', 'token', 'secret', 'credential', 'privatekey',
    'accesskey', 'protocolpassword',
  ].some((needle) => key === needle || key.includes(needle))
}

function sanitizedDiagnosticUrl(value) {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return '[redacted-url]'
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return '[redacted-url]'
  }
}

function sanitizeDiagnosticText(value) {
  return String(value ?? '')
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => sanitizedDiagnosticUrl(url))
    .replace(/(?<![a-z0-9+.-])[a-z]:[\\/][^\r\n"']+/gi, '[local-path]')
    .replace(/\\\\[^\s"']+/g, '[local-path]')
    .replace(/\/(?:Users|home|tmp|var|private)(?:\/[^\s"']*)?/g, '[local-path]')
    .replace(/\bauthorization\s*[:=]\s*(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, 'authorization=[redacted]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, '$1 [redacted]')
    .replace(/\b(password|passcode|token|cookie|authorization|api[_-]?key|secret|session(?:id)?|jsessionid)\s*[=:]\s*[^\s,;]+/gi, '$1=[redacted]')
}

function sanitizeDiagnosticValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeDiagnosticValue)
  if (!value || typeof value !== 'object') return typeof value === 'string' ? sanitizeDiagnosticText(value) : value
  const clean = {}
  for (const [key, child] of Object.entries(value)) {
    if (sensitiveDiagnosticKey(key)) continue
    clean[key] = sanitizeDiagnosticValue(child)
  }
  return clean
}

function ndjson(state) {
  const lines = []
  for (const collection of ['terms', 'courses', 'schedule', 'exams', 'grades', 'assignments', 'workspaces', 'notices']) {
    for (const item of state[collection]) lines.push(JSON.stringify({ schema: state.schema, collection, item }))
  }
  return lines.join('\n') + (lines.length ? '\n' : '')
}

async function output(value, path) {
  if (!path || path === '-') return process.stdout.write(value)
  const destination = resolve(path)
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, value, 'utf8')
  process.stdout.write(`${destination}\n`)
}

async function loadRuntime() {
  const root = defaultDataRoot()
  const store = new CampusStore(root)
  await store.load()
  return {
    root,
    store,
    state: store.snapshot(),
    courseWork: new CourseWorkService({ root, store }),
  }
}

const args = parseArgs(process.argv.slice(2))
const command = args._[0] || 'help'
const helpRequested = command === 'help' || command === '--help' || args.help
const runtime = helpRequested ? null : await loadRuntime()
const { root, store, state, courseWork } = runtime || {}

if (helpRequested) {
  process.stdout.write(help())
} else if (command === 'status') {
  const status = { dataRoot: root, storage: store.storageSummary(), schema: state.schema, updatedAt: state.updatedAt, lastSync: state.sync.lastCompletedAt, counts: counts(state), sources: sanitizeDiagnosticValue(state.sync.sources) }
  process.stdout.write(args.json ? `${JSON.stringify(status)}\n` : `${JSON.stringify(status, null, 2)}\n`)
} else if (command === 'export') {
  const format = String(args.format || 'json').toLowerCase()
  if (format === 'ai') {
    if (!args.output || args.output === '-') throw new Error('AI data export requires a parent directory: theia export --format ai --output DIRECTORY')
    const journal = new CourseSelectionJournal(root)
    await journal.load()
    const result = await writeAiExport({
      destinationRoot: args.output,
      state,
      courseSelection: journal.snapshot(),
      appVersion: state.appVersion,
    })
    process.stdout.write(`${JSON.stringify({ ok: true, schema: result.manifest.exportSchema, directory: result.directory, files: result.files, exportedAt: result.manifest.exportedAt }, null, 2)}\n`)
  } else {
  let value
  if (format === 'json') value = JSON.stringify(state, null, 2) + '\n'
  else if (format === 'ndjson') value = ndjson(state)
  else if (format === 'theia') value = JSON.stringify(toTheiaFeed(state), null, 2) + '\n'
  else if (format === 'ics') value = toIcs(state)
  else if (format === 'csv') value = collectionCsv(state, String(args.collection || 'grades'))
  else throw new Error(`不支持的导出格式: ${format}`)
  await output(value, args.output)
  }
} else if (command === 'work') {
  const subcommand = args._[1] || 'list'
  if (subcommand === 'list') {
    const byAssignment = new Map(state.workspaces.map((item) => [item.assignmentId, item]))
    const tasks = state.assignments.map((assignment) => ({
      id: assignment.id,
      title: assignment.title,
      courseName: assignment.courseName || null,
      kind: assignment.kind || 'assignment',
      dueAt: assignment.dueAt || null,
      status: assignment.status,
      work: byAssignment.get(assignment.id) || null,
    }))
    process.stdout.write(`${JSON.stringify({ schema: 'theia-course-work-list/v1', generatedAt: new Date().toISOString(), tasks }, null, 2)}\n`)
  } else if (subcommand === 'show') {
    const assignmentId = args._[2]
    const workspace = state.workspaces.find((item) => item.assignmentId === assignmentId)
    if (!workspace) throw new Error('未找到工作包，请先在桌面客户端中准备该任务')
    let manifest = null
    try { manifest = JSON.parse(await readFile(workspace.manifestPath, 'utf8')) } catch { /* Metadata remains useful if an external editor removed the manifest. */ }
    process.stdout.write(`${JSON.stringify({ workspace, manifest }, null, 2)}\n`)
  } else if (subcommand === 'import') {
    const assignmentId = args._[2]
    const file = args.file
    const kind = String(args.kind || 'answer')
    if (!assignmentId || !file) throw new Error('用法: theia work import <assignment-id> --file FILE [--kind answer|answer-key]')
    if (!['answer', 'answer-key'].includes(kind)) throw new Error('kind 仅支持 answer 或 answer-key')
    const result = await courseWork.importFile(assignmentId, file, kind)
    process.stdout.write(`${JSON.stringify({ ok: true, assignmentId, kind, path: result.path, updatedAt: result.snapshot.updatedAt }, null, 2)}\n`)
  } else throw new Error(`未知 work 子命令: ${subcommand}`)
} else if (command === 'serve') {
  const api = await startLocalApi({ store, root, preferredPort: Number(args.port) || state.settings.apiPort })
  process.stdout.write(`${api.baseUrl}\n`)
  const stop = async () => { await api.close(); process.exit(0) }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
} else if (command === 'api') {
  try {
    const runtime = JSON.parse(await readFile(resolve(root, 'api-runtime.json'), 'utf8'))
    process.stdout.write(`${JSON.stringify(runtime, null, 2)}\n`)
  } catch {
    process.stdout.write(JSON.stringify({ running: false, dataRoot: root }, null, 2) + '\n')
  }
} else if (command === 'doctor') {
  const problems = []
  if (state.schema !== 'theia-campus-data/v1') problems.push(`未知数据协议: ${state.schema}`)
  if (!state.sync.lastCompletedAt) problems.push('尚未完成首次同步')
  for (const [source, status] of Object.entries(state.sync.sources || {})) {
    if (!status?.connected) problems.push(`${sanitizeDiagnosticText(source)}: ${sanitizeDiagnosticText(status?.error || '未连接')}`)
  }
  process.stdout.write(JSON.stringify({ ok: problems.length === 0, dataRoot: root, problems, counts: counts(state) }, null, 2) + '\n')
  if (problems.length) process.exitCode = 1
} else {
  process.stderr.write(`未知命令: ${command}\n\n${help()}`)
  process.exitCode = 2
}
