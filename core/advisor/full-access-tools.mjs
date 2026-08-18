import { ADVISOR_TOOL_RESULT_SCHEMA } from './read-only-tools.mjs'
import { isAdvisorFullAccess } from './agent-permissions.mjs'

const SYNC_DOMAINS_LIMIT = 32

function text(value, maximum = 240) {
  const normalized = String(value ?? '').normalize('NFC').trim()
  if (!normalized || normalized.length > maximum) throw new TypeError('Agent full-access tool input is invalid')
  return normalized
}

function result(name, snapshotRevision, data) {
  return Object.freeze({ schema: ADVISOR_TOOL_RESULT_SCHEMA, name, snapshotRevision, data: Object.freeze(data) })
}

function compactValue(value, depth = 0) {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') return value.length <= 256_000 ? value : `${value.slice(0, 256_000)}...`
  if (Array.isArray(value)) return value.slice(0, 32).map((item) => compactValue(item, depth + 1))
  if (!value || typeof value !== 'object' || depth >= 3) return null
  return Object.fromEntries(Object.entries(value).slice(0, 32).map(([key, item]) => [key.slice(0, 120), compactValue(item, depth + 1)]))
}

function syncDomains(value) {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > SYNC_DOMAINS_LIMIT) throw new TypeError('Agent sync domains are invalid')
  return [...new Set(value.map((entry) => text(entry, 80)))]
}

function settingsPatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Agent settings patch is invalid')
  const output = {}
  if (typeof value.autoSync === 'boolean') output.autoSync = value.autoSync
  if (typeof value.openOriginalInApp === 'boolean') output.openOriginalInApp = value.openOriginalInApp
  if (typeof value.academicApiEnabled === 'boolean') output.academicApiEnabled = value.academicApiEnabled
  if (['api', 'unified'].includes(value.academicAuthMode)) output.academicAuthMode = value.academicAuthMode
  if (value.mail !== undefined) {
    if (!value.mail || typeof value.mail !== 'object' || Array.isArray(value.mail)) throw new TypeError('Agent mail settings are invalid')
    const mail = {}
    if (typeof value.mail.enabled === 'boolean') mail.enabled = value.mail.enabled
    if (Number.isFinite(value.mail.pollIntervalMinutes)) mail.pollIntervalMinutes = Math.max(1, Math.min(60, Math.trunc(value.mail.pollIntervalMinutes)))
    if (Object.keys(mail).length) output.mail = mail
  }
  if (value.advisorConfig !== undefined) {
    if (!value.advisorConfig || typeof value.advisorConfig !== 'object' || Array.isArray(value.advisorConfig)) {
      throw new TypeError('Agent advisor settings are invalid')
    }
    const advisorConfig = {}
    if (['high', 'xhigh', 'max', 'ultra'].includes(value.advisorConfig.budgetLevel)) advisorConfig.budgetLevel = value.advisorConfig.budgetLevel
    if (['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(value.advisorConfig.reasoningEffort)) advisorConfig.reasoningEffort = value.advisorConfig.reasoningEffort
    if (['direct', 'balanced', 'detailed'].includes(value.advisorConfig.responseStyle)) advisorConfig.responseStyle = value.advisorConfig.responseStyle
    if (['adaptive', 'short', 'standard', 'detailed'].includes(value.advisorConfig.responseLength)) advisorConfig.responseLength = value.advisorConfig.responseLength
    if (Number.isFinite(value.advisorConfig.temperature)) advisorConfig.temperature = Math.max(0, Math.min(2, value.advisorConfig.temperature))
    if (Object.keys(advisorConfig).length) output.advisorConfig = advisorConfig
  }
  if (!Object.keys(output).length) throw new TypeError('Agent settings patch contains no writable setting')
  return Object.freeze(output)
}

function operation(operations, name) {
  const callback = operations?.[name]
  if (typeof callback !== 'function') throw new TypeError(`Agent full-access operation is unavailable: ${name}`)
  return callback
}

/**
 * Adds explicit, typed full-access operations to an immutable local-read
 * workspace. The host supplies each operation; the model never receives a
 * filesystem handle, credential, Cookie, Electron object, or raw IPC bridge.
 */
export function createAdvisorFullAccessTools({ tools, snapshotRevision, operations, signal, permissionMode = 'full-access' } = {}) {
  if (!tools || typeof tools !== 'object') throw new TypeError('Agent full-access tools require a local workspace')
  const revision = text(snapshotRevision, 128)
  const controlled = {
    async sync_campus_data(args = {}) {
      const outcome = await operation(operations, 'syncCampusData')({ domains: syncDomains(args.domains), signal })
      return result('sync_campus_data', revision, { operation: 'sync-campus-data', outcome: compactValue(outcome) })
    },
    async network_request(args = {}) {
      const outcome = await operation(operations, 'networkRequest')({
        url: args.url,
        method: args.method,
        headers: args.headers,
        body: args.body,
        signal,
      })
      return result('network_request', revision, { operation: 'network-request', outcome: compactValue(outcome) })
    },
    async open_campus_source(args = {}) {
      const outcome = await operation(operations, 'openCampusSource')({ url: text(args.url, 4_096), signal })
      return result('open_campus_source', revision, { operation: 'open-campus-source', outcome: compactValue(outcome) })
    },
    async update_theia_settings(args = {}) {
      const outcome = await operation(operations, 'updateSettings')({ settings: settingsPatch(args.settings), signal })
      return result('update_theia_settings', revision, { operation: 'update-theia-settings', outcome: compactValue(outcome) })
    },
    async control_course_selection(args = {}) {
      const action = text(args.action, 80)
      if (!['start-saved-targets', 'stop'].includes(action)) throw new TypeError('Agent course-selection action is not allowed')
      const outcome = await operation(operations, 'controlCourseSelection')({ action, signal })
      return result('control_course_selection', revision, { operation: 'control-course-selection', outcome: compactValue(outcome) })
    },
  }
  if (!isAdvisorFullAccess(permissionMode)) return Object.freeze({ ...tools, ...controlled })
  return Object.freeze({
    ...tools,
    ...controlled,
    async read_file(args = {}) {
      const outcome = await operation(operations, 'readFile')({
        path: text(args.path, 8_192),
        encoding: args.encoding,
        offset: args.offset,
        length: args.length,
        signal,
      })
      return result('read_file', revision, { operation: 'read-file', outcome: compactValue(outcome) })
    },
    async write_file(args = {}) {
      const outcome = await operation(operations, 'writeFile')({
        path: text(args.path, 8_192),
        content: args.content,
        encoding: args.encoding,
        createDirectories: args.createDirectories,
        signal,
      })
      return result('write_file', revision, { operation: 'write-file', outcome: compactValue(outcome) })
    },
    async list_directory(args = {}) {
      const outcome = await operation(operations, 'listDirectory')({
        path: text(args.path, 8_192),
        recursive: args.recursive,
        maxEntries: args.maxEntries,
        signal,
      })
      return result('list_directory', revision, { operation: 'list-directory', outcome: compactValue(outcome) })
    },
    async create_directory(args = {}) {
      const outcome = await operation(operations, 'createDirectory')({
        path: text(args.path, 8_192),
        recursive: args.recursive,
        signal,
      })
      return result('create_directory', revision, { operation: 'create-directory', outcome: compactValue(outcome) })
    },
    async delete_path(args = {}) {
      const outcome = await operation(operations, 'deletePath')({
        path: text(args.path, 8_192),
        recursive: args.recursive,
        signal,
      })
      return result('delete_path', revision, { operation: 'delete-path', outcome: compactValue(outcome) })
    },
    async run_command(args = {}) {
      const outcome = await operation(operations, 'runCommand')({
        command: text(args.command, 32_000),
        cwd: args.cwd === undefined ? undefined : text(args.cwd, 8_192),
        timeoutMs: args.timeoutMs,
        signal,
      })
      return result('run_command', revision, { operation: 'run-command', outcome: compactValue(outcome) })
    },
    async web_request(args = {}) {
      const outcome = await operation(operations, 'webRequest')({
        url: text(args.url, 8_192),
        method: args.method,
        headers: args.headers,
        body: args.body,
        responseType: args.responseType,
        signal,
      })
      return result('web_request', revision, { operation: 'web-request', outcome: compactValue(outcome) })
    },
    async open_webpage(args = {}) {
      const outcome = await operation(operations, 'openWebpage')({ url: text(args.url, 8_192), signal })
      return result('open_webpage', revision, { operation: 'open-webpage', outcome: compactValue(outcome) })
    },
  })
}
