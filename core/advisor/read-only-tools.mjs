import { ADVISOR_LAZY_TOOL_NAMES, createAdvisorLazyWorkspace } from './lazy-workspace.mjs'
import {
  ADVISOR_CONTROLLED_TOOL_NAMES,
  ADVISOR_FULL_ACCESS_TOOL_NAMES,
  isAdvisorFullAccess,
} from './agent-permissions.mjs'

export const ADVISOR_TOOL_RESULT_SCHEMA = 'theia-advisor-tool-result/v1'
export const ADVISOR_READ_ONLY_TOOL_NAMES = Object.freeze([
  ...new Set([
    ...ADVISOR_LAZY_TOOL_NAMES,
    // Kept for old saved test transcripts. New runtime requests use the
    // searchable lazy workspace rather than a pre-disclosed claim array.
    'find_claims',
    // "read-only" keeps the original controlled Agent operations. Full
    // access is reserved for the additional general filesystem, process,
    // and web tools below.
    ...ADVISOR_CONTROLLED_TOOL_NAMES,
  ]),
])

export const ADVISOR_AGENT_TOOL_NAMES = Object.freeze([
  ...ADVISOR_READ_ONLY_TOOL_NAMES,
  ...ADVISOR_FULL_ACCESS_TOOL_NAMES,
])

export function advisorToolNamesForPermission(permissionMode = 'read-only') {
  return isAdvisorFullAccess(permissionMode)
    ? ADVISOR_AGENT_TOOL_NAMES
    : ADVISOR_READ_ONLY_TOOL_NAMES
}

export { createAdvisorLazyWorkspace }

// Providers may add planning metadata or harmless extra arguments. Forward
// only documented fields so those additions cannot create a new capability.
const TOOL_ARGUMENT_FIELDS = Object.freeze({
  get_data_health: Object.freeze(['domains']),
  search_campus_records: Object.freeze(['domain', 'query', 'limit', 'offset']),
  search_local_facts: Object.freeze(['domain', 'query', 'limit']),
  list_deadlines: Object.freeze([]),
  inspect_academic_progress: Object.freeze(['query', 'limit']),
  inspect_course_analysis: Object.freeze(['query', 'limit', 'termId']),
  read_message: Object.freeze(['recordId']),
  find_claims: Object.freeze(['query']),
  sync_campus_data: Object.freeze(['domains']),
  network_request: Object.freeze(['url', 'method', 'headers', 'body']),
  open_campus_source: Object.freeze(['url']),
  update_theia_settings: Object.freeze(['settings']),
  control_course_selection: Object.freeze(['action']),
  read_file: Object.freeze(['path', 'encoding', 'offset', 'length']),
  write_file: Object.freeze(['path', 'content', 'encoding', 'createDirectories']),
  list_directory: Object.freeze(['path', 'recursive', 'maxEntries']),
  create_directory: Object.freeze(['path', 'recursive']),
  delete_path: Object.freeze(['path', 'recursive']),
  run_command: Object.freeze(['command', 'cwd', 'timeoutMs']),
  web_request: Object.freeze(['url', 'method', 'headers', 'body', 'responseType']),
  open_webpage: Object.freeze(['url']),
})

const RECORD_DOMAIN_ALIAS_FIELDS = Object.freeze(['topic', 'type', 'category', 'scope'])

function boundedText(value, maximum = 240) {
  return String(value ?? '').normalize('NFC').trim().slice(0, maximum)
}

function normalizedRecordDomain(value) {
  return boundedText(value, 80).toLocaleLowerCase().replace(/[\s_]+/gu, '-')
}

function safeArray(value, maximum) {
  return Array.isArray(value) ? value.slice(0, maximum) : []
}

function result(name, snapshotRevision, data) {
  // The legacy projected-tool path also constructs bounded data objects. Do
  // not deep-clone them with canonical JSON; the model transport serializes
  // once at the outer boundary and no raw state reference is exposed here.
  return Object.freeze({ schema: ADVISOR_TOOL_RESULT_SCHEMA, name, snapshotRevision, data })
}

// These tools only read an already-projected overview. They cannot see a file path,
// credential, raw campus page, browser session, URL, or an IPC handle.
export function createAdvisorReadOnlyTools(overview) {
  const revision = boundedText(overview?.snapshotRevision, 128)
  if (!revision) throw new TypeError('Read-only advisor tools require a projected overview')
  const claims = safeArray(overview?.claims, 64)
  const urgentItems = safeArray(overview?.urgentItems, 32)
  const risks = safeArray(overview?.risks, 32)
  return Object.freeze({
    get_data_health() {
      return result('get_data_health', revision, { dataQuality: overview.dataQuality })
    },
    find_claims(args = {}) {
      const query = boundedText(args.query, 160).toLocaleLowerCase()
      const matches = claims.filter((claim) => !query || boundedText(claim.displayText, 2_000).toLocaleLowerCase().includes(query))
        .slice(0, 12)
        .map((claim) => ({ id: claim.id, displayText: claim.displayText, evidenceRefs: safeArray(claim.evidenceRefs, 12) }))
      return result('find_claims', revision, { matches })
    },
    list_deadlines() {
      return result('list_deadlines', revision, { items: urgentItems.filter((item) => item.domain === 'assignments' || item.domain === 'exams') })
    },
    inspect_academic_progress() {
      return result('inspect_academic_progress', revision, {
        claims: claims.filter((claim) => safeArray(claim.evidenceRefs, 1).length > 0).slice(0, 24),
        risks: risks.filter((risk) => risk.domain === 'academic-progress' || risk.domain === 'grades').slice(0, 12),
      })
    },
    inspect_course_analysis() {
      return result('inspect_course_analysis', revision, {
        risks: risks.filter((risk) => ['courses', 'schedule', 'selected-courses'].includes(risk.domain)).slice(0, 12),
      })
    },
  })
}

export function normalizeAdvisorToolArgs(name, args = {}, { toolNames = ADVISOR_READ_ONLY_TOOL_NAMES } = {}) {
  const toolName = boundedText(name, 80)
  const allowed = TOOL_ARGUMENT_FIELDS[toolName]
  const permittedTools = Array.isArray(toolNames) ? toolNames : ADVISOR_READ_ONLY_TOOL_NAMES
  if (!permittedTools.includes(toolName) || !allowed) {
    throw new TypeError('Advisor tool is not allowed')
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new TypeError('Advisor tool arguments are invalid')
  }
  const normalized = Object.fromEntries(allowed
    .filter((key) => Object.hasOwn(args, key))
    .map((key) => [key, structuredClone(args[key])]))
  // OpenAI-compatible relays commonly label a record domain as topic, type,
  // category, or scope. These are aliases only; the lazy workspace still
  // validates the normalized value against its fixed domain allowlist.
  if (toolName === 'search_campus_records' && !Object.hasOwn(normalized, 'domain')) {
    const alias = RECORD_DOMAIN_ALIAS_FIELDS.find((key) => Object.hasOwn(args, key))
    if (alias) normalized.domain = normalizedRecordDomain(args[alias])
  } else if (toolName === 'search_campus_records' && Object.hasOwn(normalized, 'domain')) {
    normalized.domain = normalizedRecordDomain(normalized.domain)
  }
  return normalized
}

export function executeAdvisorReadOnlyTool(tools, name, args = {}, { toolNames = ADVISOR_READ_ONLY_TOOL_NAMES } = {}) {
  const toolName = boundedText(name, 80)
  const permittedTools = Array.isArray(toolNames) ? toolNames : ADVISOR_READ_ONLY_TOOL_NAMES
  if (!permittedTools.includes(toolName) || typeof tools?.[toolName] !== 'function') {
    throw new TypeError('Advisor tool is not allowed')
  }
  return tools[toolName](normalizeAdvisorToolArgs(toolName, args, { toolNames: permittedTools }))
}
