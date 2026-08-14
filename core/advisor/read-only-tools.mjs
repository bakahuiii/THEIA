import { canonicalJson } from './canonical.mjs'

export const ADVISOR_TOOL_RESULT_SCHEMA = 'theia-advisor-tool-result/v1'
export const ADVISOR_READ_ONLY_TOOL_NAMES = Object.freeze([
  'get_data_health', 'find_claims', 'list_deadlines', 'inspect_academic_progress', 'inspect_course_analysis',
])

function boundedText(value, maximum = 240) {
  return String(value ?? '').normalize('NFC').trim().slice(0, maximum)
}

function safeArray(value, maximum) {
  return Array.isArray(value) ? value.slice(0, maximum) : []
}

function result(name, snapshotRevision, data) {
  return Object.freeze({ schema: ADVISOR_TOOL_RESULT_SCHEMA, name, snapshotRevision, data: JSON.parse(canonicalJson(data)) })
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

export function executeAdvisorReadOnlyTool(tools, name, args = {}) {
  const toolName = boundedText(name, 80)
  if (!ADVISOR_READ_ONLY_TOOL_NAMES.includes(toolName) || typeof tools?.[toolName] !== 'function') {
    throw new TypeError('Advisor tool is not allowed')
  }
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length > 4) {
    throw new TypeError('Advisor tool arguments are invalid')
  }
  return tools[toolName](args)
}
