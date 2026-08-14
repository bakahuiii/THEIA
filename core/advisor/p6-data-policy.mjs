import { createHash } from 'node:crypto'

export const AI_DATA_ACCESS_POLICY_SCHEMA = 'theia-ai-data-access-policy/v1'
export const AI_DATA_ACCESS_AUDIT_SCHEMA = 'theia-ai-data-access-audit/v1'

// These are disclosure categories, not filesystem, IPC, URL, or browser permissions.
export const AI_DISCLOSURE_SCOPES = Object.freeze([
  'assignments', 'exams', 'grades', 'academic-progress', 'courses',
  'schedule', 'selected-courses', 'notices', 'mailbox', 'mail-body',
  'fitness', 'identity',
])

export const AGENT_TOOL_SCOPES = Object.freeze([
  'data-quality', 'claims', 'deadlines', 'academic-progress', 'course-analysis',
  'notices', 'mail-metadata',
])

export const FORBIDDEN_AGENT_CAPABILITIES = Object.freeze([
  'filesystem', 'arbitrary-url', 'network', 'browser-session', 'credentials',
  'sync', 'login', 'course-selection-execution', 'answer-fill', 'mail-send',
  'upload', 'submit', 'shell', 'ipc-proxy',
])

function text(value, maximum = 240) {
  const normalized = String(value ?? '').normalize('NFC').trim()
  return normalized && normalized.length <= maximum ? normalized : null
}

function uniqueAllowed(values, allowed, maximum) {
  if (!Array.isArray(values) || values.length > maximum) return []
  const output = []
  for (const item of values) {
    const normalized = text(item, 80)
    if (normalized && allowed.includes(normalized) && !output.includes(normalized)) output.push(normalized)
  }
  return output.sort()
}

export function normalizeAiDataAccessPolicy(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return Object.freeze({
    schema: AI_DATA_ACCESS_POLICY_SCHEMA,
    serviceIdentity: text(source.serviceIdentity, 1_024),
    allowedScopes: uniqueAllowed(source.allowedScopes, AI_DISCLOSURE_SCOPES, AI_DISCLOSURE_SCOPES.length),
    allowedToolScopes: uniqueAllowed(source.allowedToolScopes, AGENT_TOOL_SCOPES, AGENT_TOOL_SCOPES.length),
    allowThreadSummary: source.allowThreadSummary === true,
    allowStreaming: source.allowStreaming === true,
    updatedAt: text(source.updatedAt, 64),
  })
}

export function createAiDataAccessAudit({ policy, serviceIdentity, requestedScopes = [], requestedToolScopes = [], threadSummary = false, streaming = false, snapshotRevision }) {
  const normalized = normalizeAiDataAccessPolicy(policy)
  const identity = text(serviceIdentity, 1_024)
  if (!identity || normalized.serviceIdentity !== identity) throw new TypeError('AI data policy is not bound to this model service')
  const scopes = uniqueAllowed(requestedScopes, AI_DISCLOSURE_SCOPES, AI_DISCLOSURE_SCOPES.length)
  const toolScopes = uniqueAllowed(requestedToolScopes, AGENT_TOOL_SCOPES, AGENT_TOOL_SCOPES.length)
  if (scopes.some((scope) => !normalized.allowedScopes.includes(scope))) throw new TypeError('Requested AI data scope is not allowed by the user policy')
  if (toolScopes.some((scope) => !normalized.allowedToolScopes.includes(scope))) throw new TypeError('Requested AI tool is not allowed by the user policy')
  if (threadSummary && !normalized.allowThreadSummary) throw new TypeError('Thread-summary disclosure is not allowed by the user policy')
  if (streaming && !normalized.allowStreaming) throw new TypeError('Streaming is not allowed by the user policy')
  const revision = text(snapshotRevision, 128)
  if (!revision) throw new TypeError('AI access audit requires a snapshot revision')
  const record = {
    schema: AI_DATA_ACCESS_AUDIT_SCHEMA,
    serviceIdentity: identity,
    snapshotRevision: revision,
    scopes,
    toolScopes,
    threadSummary: Boolean(threadSummary),
    streaming: Boolean(streaming),
    forbiddenCapabilities: [...FORBIDDEN_AGENT_CAPABILITIES],
  }
  return Object.freeze({ ...record, digest: createHash('sha256').update(JSON.stringify(record), 'utf8').digest('hex') })
}
