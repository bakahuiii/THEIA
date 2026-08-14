export const MAX_IPC_ARGUMENT_BYTES = 1024 * 1024
export const RETRIABLE_SYNC_DOMAIN_IDS = Object.freeze([
  'profile', 'terms', 'schedule', 'exams', 'grades', 'selected-courses',
  'academic-progress', 'jwglxt-courses', 'jwglxt-notices', 'theol-courses',
  'assignments', 'theol-notices', 'mailbox', 'academic-calendar', 'fitness',
  'school-schedule',
])
const MAX_IPC_DEPTH = 12
const MAX_IPC_ARRAY_ITEMS = 5_000
const MAX_IPC_OBJECT_KEYS = 512
const MAX_IPC_STRING_LENGTH = 200_000
const ADVISOR_READABLE_DOMAINS = Object.freeze([
  'assignments', 'exams', 'grades', 'academic-progress', 'courses', 'schedule',
  'selected-courses', 'course-selection', 'profile', 'notices', 'mailbox', 'fitness',
])

function fail(channel, message) {
  throw new Error(`IPC ${channel}: ${message}`)
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function walkValue(channel, value, depth = 0) {
  if (depth > MAX_IPC_DEPTH) fail(channel, 'argument nesting is too deep')
  if (value === null || value === undefined || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(channel, 'numbers must be finite')
    return
  }
  if (typeof value === 'string') {
    if (value.length > MAX_IPC_STRING_LENGTH) fail(channel, 'a string argument is too long')
    return
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_IPC_ARRAY_ITEMS) fail(channel, 'an array argument has too many items')
    for (const item of value) walkValue(channel, item, depth + 1)
    return
  }
  if (!plainObject(value)) fail(channel, 'arguments must contain only plain structured data')
  const entries = Object.entries(value)
  if (entries.length > MAX_IPC_OBJECT_KEYS) fail(channel, 'an object argument has too many fields')
  for (const [key, child] of entries) {
    if (key.length > 200) fail(channel, 'an object field name is too long')
    walkValue(channel, child, depth + 1)
  }
}

function serializedBytes(channel, args) {
  let encoded
  try {
    encoded = JSON.stringify(args)
  } catch {
    fail(channel, 'arguments are not serializable')
  }
  return Buffer.byteLength(encoded || '', 'utf8')
}

function argCount(channel, args, minimum, maximum = minimum) {
  if (args.length < minimum || args.length > maximum) {
    fail(channel, `expected ${minimum === maximum ? minimum : `${minimum}-${maximum}`} arguments`)
  }
}

function stringValue(channel, value, label, maximum = 512, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === '')) return
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    fail(channel, `${label} must be a non-empty string no longer than ${maximum} characters`)
  }
}

function numberValue(channel, value, label, { optional = false } = {}) {
  if (optional && (value === undefined || value === null)) return
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(channel, `${label} must be a finite number`)
}

function objectValue(channel, value, label, { optional = false, nullable = false } = {}) {
  if (optional && value === undefined) return
  if (nullable && value === null) return
  if (!plainObject(value)) fail(channel, `${label} must be an object`)
}

function allowedFields(channel, value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(channel, `unknown field ${key}`)
  }
}

function noArgs(channel, args) {
  argCount(channel, args, 0)
}

function idArg(channel, args) {
  argCount(channel, args, 1)
  stringValue(channel, args[0], 'id', 512)
}

function objectArg(channel, args, { optional = false, nullable = false } = {}) {
  argCount(channel, args, optional ? 0 : 1, 1)
  objectValue(channel, args[0], 'argument', { optional, nullable })
}

function advisorAcademicScenario(channel, args) {
  argCount(channel, args, 1)
  objectValue(channel, args[0], 'academic scenario')
  allowedFields(channel, args[0], ['snapshotRevision', 'additionalRequiredCredits', 'alternativeSelections'])
  stringValue(channel, args[0].snapshotRevision, 'snapshotRevision', 128)
  if (args[0].additionalRequiredCredits !== undefined) {
    numberValue(channel, args[0].additionalRequiredCredits, 'additionalRequiredCredits')
    if (args[0].additionalRequiredCredits < 0 || args[0].additionalRequiredCredits > 500) {
      fail(channel, 'additionalRequiredCredits is outside the supported range')
    }
  }
  if (args[0].alternativeSelections !== undefined) {
    objectValue(channel, args[0].alternativeSelections, 'alternativeSelections')
    const entries = Object.entries(args[0].alternativeSelections)
    if (entries.length > 128) fail(channel, 'alternativeSelections has too many entries')
    for (const [nodeId, selectedId] of entries) {
      stringValue(channel, nodeId, 'alternative node id', 512)
      stringValue(channel, selectedId, 'selected alternative id', 512)
      if (!/^ar1:requirement:[a-f0-9]{20}$/.test(nodeId)
        || !/^ar1:requirement:[a-f0-9]{20}$/.test(selectedId)) {
        fail(channel, 'alternative selections require opaque requirement references')
      }
    }
  }
}

function advisorActionRequest(channel, args) {
  argCount(channel, args, 1)
  objectValue(channel, args[0], 'advisor action request')
  allowedFields(channel, args[0], ['snapshotRevision', 'actionId'])
  stringValue(channel, args[0].snapshotRevision, 'snapshotRevision', 128)
  stringValue(channel, args[0].actionId, 'actionId', 256)
}

function advisorIdList(channel, value, label, maximum) {
  if (value === undefined) return
  if (!Array.isArray(value) || value.length > maximum) fail(channel, `${label} has too many items`)
  for (const item of value) stringValue(channel, item, `${label} item`, 512)
}

function advisorPrepareRequest(channel, args) {
  argCount(channel, args, 1)
  objectValue(channel, args[0], 'advisor prepare request')
  allowedFields(channel, args[0], [
    'threadId', 'question', 'intent', 'selectedNoticeIds', 'selectedMailIds', 'includeMailBodyIds',
    'agent', 'readableDomains',
  ])
  stringValue(channel, args[0].threadId, 'threadId', 128)
  stringValue(channel, args[0].question, 'question', 4_000)
  if (!['daily', 'risk', 'course', 'notice', 'mail', 'general'].includes(args[0].intent)) {
    fail(channel, 'advisor intent is invalid')
  }
  advisorIdList(channel, args[0].selectedNoticeIds, 'selectedNoticeIds', 8)
  advisorIdList(channel, args[0].selectedMailIds, 'selectedMailIds', 4)
  advisorIdList(channel, args[0].includeMailBodyIds, 'includeMailBodyIds', 2)
  if (args[0].agent !== undefined && typeof args[0].agent !== 'boolean') fail(channel, 'agent must be boolean')
  if (args[0].readableDomains !== undefined) {
    if (!Array.isArray(args[0].readableDomains) || args[0].readableDomains.length > ADVISOR_READABLE_DOMAINS.length) {
      fail(channel, 'readableDomains has too many items')
    }
    for (const domain of args[0].readableDomains) {
      stringValue(channel, domain, 'readableDomains item', 64)
      if (!ADVISOR_READABLE_DOMAINS.includes(domain)) fail(channel, 'readableDomains item is invalid')
    }
  }
}

function advisorSendRequest(channel, args) {
  argCount(channel, args, 1)
  objectValue(channel, args[0], 'advisor send request')
  allowedFields(channel, args[0], ['requestId', 'approved', 'stream'])
  stringValue(channel, args[0].requestId, 'requestId', 128)
  if (typeof args[0].approved !== 'boolean') fail(channel, 'approved must be boolean')
  if (args[0].stream !== undefined && typeof args[0].stream !== 'boolean') fail(channel, 'stream must be boolean')
}

function advisorCancelRequest(channel, args) {
  argCount(channel, args, 1)
  objectValue(channel, args[0], 'advisor cancel request')
  allowedFields(channel, args[0], ['requestId', 'threadId'])
  stringValue(channel, args[0].requestId, 'requestId', 128, { optional: true })
  stringValue(channel, args[0].threadId, 'threadId', 128, { optional: true })
  if (!args[0].requestId && !args[0].threadId) fail(channel, 'requestId or threadId is required')
}

const ADVISOR_CANDIDATE_FIELDS = Object.freeze([
  'id', 'courseId', 'courseCode', 'title', 'credits', 'category', 'categoryCode',
  'blockTitle', 'nature', 'termId', 'time', 'weekday', 'period', 'weeks', 'sessions',
  'requirementNodeId', 'requirementNodeIds', 'officialRequirementId',
  'officialRequirementIds', 'requirementCourseId', 'requirementCourseIds',
])
const ADVISOR_CANDIDATE_TEXT_FIELDS = Object.freeze([
  'courseId', 'courseCode', 'category', 'categoryCode', 'blockTitle', 'nature',
  'termId', 'requirementNodeId', 'officialRequirementId', 'requirementCourseId',
])
const ADVISOR_CANDIDATE_ID_ARRAY_FIELDS = Object.freeze([
  'requirementNodeIds', 'officialRequirementIds', 'requirementCourseIds',
])
const ADVISOR_SESSION_FIELDS = Object.freeze([
  'weekday', 'day', 'period', 'periods', 'weeks',
])
const MAX_ADVISOR_SESSION_ITEMS = 64
const MAX_ADVISOR_SESSION_VALUE_ITEMS = 64
const MAX_ADVISOR_ID_ARRAY_ITEMS = 128

function advisorScheduleAtom(channel, value, label) {
  if (typeof value === 'number') {
    numberValue(channel, value, label)
    return
  }
  stringValue(channel, value, label, 256)
}

function advisorScheduleValue(channel, value, label, { optional = false, scalarOnly = false } = {}) {
  if (optional && (value === undefined || value === null)) return
  if (!Array.isArray(value)) {
    advisorScheduleAtom(channel, value, label)
    return
  }
  if (scalarOnly) fail(channel, `${label} must be a finite number or short text`)
  if (value.length > MAX_ADVISOR_SESSION_VALUE_ITEMS) {
    fail(channel, `${label} has too many items`)
  }
  for (const item of value) advisorScheduleAtom(channel, item, `${label} item`)
}

function advisorIdArray(channel, value, label) {
  if (value === undefined || value === null) return
  if (!Array.isArray(value) || value.length > MAX_ADVISOR_ID_ARRAY_ITEMS) {
    fail(channel, `${label} must be an array with at most ${MAX_ADVISOR_ID_ARRAY_ITEMS} items`)
  }
  for (const item of value) stringValue(channel, item, `${label} item`, 512)
}

function advisorSessions(channel, value) {
  if (value === undefined || value === null) return
  if (!Array.isArray(value) || value.length > MAX_ADVISOR_SESSION_ITEMS) {
    fail(channel, `candidate sessions must be an array with at most ${MAX_ADVISOR_SESSION_ITEMS} items`)
  }
  for (const session of value) {
    objectValue(channel, session, 'candidate session')
    allowedFields(channel, session, ADVISOR_SESSION_FIELDS)
    advisorScheduleValue(channel, session.weekday, 'candidate session weekday', { optional: true, scalarOnly: true })
    advisorScheduleValue(channel, session.day, 'candidate session day', { optional: true, scalarOnly: true })
    advisorScheduleValue(channel, session.period, 'candidate session period', { optional: true })
    advisorScheduleValue(channel, session.periods, 'candidate session periods', { optional: true })
    advisorScheduleValue(channel, session.weeks, 'candidate session weeks', { optional: true })
  }
}

function advisorCourseDecisions(channel, args) {
  argCount(channel, args, 1)
  objectValue(channel, args[0], 'course decision request')
  allowedFields(channel, args[0], ['snapshotRevision', 'candidates', 'schoolScheduleComplete', 'completeness'])
  stringValue(channel, args[0].snapshotRevision, 'snapshotRevision', 128)
  if (!Array.isArray(args[0].candidates) || args[0].candidates.length > 500) {
    fail(channel, 'candidates must be an array with at most 500 items')
  }
  for (const candidate of args[0].candidates) {
    objectValue(channel, candidate, 'course candidate')
    allowedFields(channel, candidate, ADVISOR_CANDIDATE_FIELDS)
    stringValue(channel, candidate.id, 'candidate id', 512)
    stringValue(channel, candidate.title, 'candidate title', 2_000)
    if (candidate.credits !== undefined && candidate.credits !== null) numberValue(channel, candidate.credits, 'candidate credits')
    for (const field of ADVISOR_CANDIDATE_TEXT_FIELDS) {
      stringValue(channel, candidate[field], `candidate ${field}`, 512, { optional: true })
    }
    stringValue(channel, candidate.time, 'candidate time', 2_000, { optional: true })
    advisorScheduleValue(channel, candidate.weekday, 'candidate weekday', { optional: true, scalarOnly: true })
    advisorScheduleValue(channel, candidate.period, 'candidate period', { optional: true })
    advisorScheduleValue(channel, candidate.weeks, 'candidate weeks', { optional: true })
    advisorSessions(channel, candidate.sessions)
    for (const field of ADVISOR_CANDIDATE_ID_ARRAY_FIELDS) {
      advisorIdArray(channel, candidate[field], `candidate ${field}`)
    }
  }
  if (args[0].schoolScheduleComplete !== undefined && typeof args[0].schoolScheduleComplete !== 'boolean') {
    fail(channel, 'schoolScheduleComplete must be boolean')
  }
  if (args[0].completeness !== undefined) {
    objectValue(channel, args[0].completeness, 'completeness')
    allowedFields(channel, args[0].completeness, ['academicProgress', 'schedule', 'grades', 'selectedCourses'])
    for (const value of Object.values(args[0].completeness)) {
      if (!['complete', 'partial', 'unknown'].includes(value)) fail(channel, 'completeness value is invalid')
    }
  }
}

function credentials(channel, args, { mail = false } = {}) {
  argCount(channel, args, 1)
  objectValue(channel, args[0], 'credentials')
  const allowed = mail ? ['username', 'password', 'protocolPassword'] : ['username', 'password']
  allowedFields(channel, args[0], allowed)
  stringValue(channel, args[0].username, 'username', 320)
  stringValue(channel, args[0].password, 'password', 2_048)
  if (mail) stringValue(channel, args[0].protocolPassword, 'protocolPassword', 2_048, { optional: true })
}

function modelConfig(channel, args, { saving = false } = {}) {
  argCount(channel, args, 1)
  objectValue(channel, args[0], 'model configuration')
  const fields = saving
    ? ['baseUrl', 'model', 'apiKey', 'probeId', 'allowManualModel', 'modelRouting', 'provider']
    : ['baseUrl', 'apiKey', 'provider']
  allowedFields(channel, args[0], fields)
  stringValue(channel, args[0].baseUrl, 'baseUrl', 1_000)
  stringValue(channel, args[0].apiKey, 'apiKey', 2_048, { optional: true })
  if (args[0].provider !== undefined && !['openai-compatible', 'anthropic-messages', 'gemini-generate-content', 'ollama-chat'].includes(args[0].provider)) {
    fail(channel, 'model provider is invalid')
  }
  if (saving) {
    stringValue(channel, args[0].model, 'model', 300)
    stringValue(channel, args[0].probeId, 'probeId', 100, { optional: true })
    if (args[0].allowManualModel !== undefined && typeof args[0].allowManualModel !== 'boolean') {
      fail(channel, 'allowManualModel must be boolean')
    }
    if (args[0].modelRouting !== undefined) {
      objectValue(channel, args[0].modelRouting, 'modelRouting')
      allowedFields(channel, args[0].modelRouting, [
        'advisorFastModel', 'advisorDeepModel', 'courseworkModel', 'fallbackModel',
      ])
      for (const [key, value] of Object.entries(args[0].modelRouting)) {
        if (value !== null) stringValue(channel, value, `modelRouting.${key}`, 300, { optional: true })
      }
    }
  }
}

function updateSettings(channel, args) {
  argCount(channel, args, 1)
  objectValue(channel, args[0], 'settings')
  allowedFields(channel, args[0], [
    'apiPort', 'syncIntervalMinutes', 'autoSync', 'openOriginalInApp',
    'academicAuthMode', 'academicApiEnabled', 'mail',
  ])
  for (const key of ['apiPort', 'syncIntervalMinutes']) {
    if (args[0][key] !== undefined) numberValue(channel, args[0][key], key)
  }
  for (const key of ['autoSync', 'openOriginalInApp', 'academicApiEnabled']) {
    if (args[0][key] !== undefined && typeof args[0][key] !== 'boolean') fail(channel, `${key} must be boolean`)
  }
  if (args[0].academicAuthMode !== undefined && !['api', 'unified'].includes(args[0].academicAuthMode)) {
    fail(channel, 'academicAuthMode is invalid')
  }
  if (args[0].mail !== undefined) {
    objectValue(channel, args[0].mail, 'mail settings')
    allowedFields(channel, args[0].mail, ['enabled', 'pollIntervalMinutes'])
    if (args[0].mail.enabled !== undefined && typeof args[0].mail.enabled !== 'boolean') fail(channel, 'mail.enabled must be boolean')
    if (args[0].mail.pollIntervalMinutes !== undefined) numberValue(channel, args[0].mail.pollIntervalMinutes, 'mail.pollIntervalMinutes')
  }
}

const NO_ARGUMENT_CHANNELS = [
  'theia:get-snapshot', 'theia:get-activity-log', 'theia:get-auth-status',
  'theia:get-credential-status', 'theia:get-academic-api-credential-status',
  'theia:get-mail-credential-status', 'theia:clear-credentials',
  'theia:clear-academic-api-credentials', 'theia:clear-mail-credentials',
  'theia:login', 'theia:logout', 'theia:sync-now', 'theia:refresh-mailbox',
  'theia:open-mailbox', 'theia:get-course-selection',
  'theia:discover-course-selection', 'theia:sync-school-schedule-archive',
  'theia:get-academic-calendar-assets', 'theia:window-minimize',
  'theia:window-maximize', 'theia:window-close', 'theia:window-is-maximized',
  'theia:zoom:get', 'theia:select-app-background',
  'theia:appearance-presets:get', 'theia:open-schedule-pdf',
  'theia:get-model-status', 'theia:clear-model-api-key', 'theia:get-api-status',
  'theia:validate-model-connection', 'theia:summarize-notices',
  'theia:stop-course-selection', 'theia:cancel-model-requests',
  'theia:advisor:get-overview', 'theia:open-data-directory',
  'theia:advisor:list-threads', 'theia:advisor:create-thread',
]

export const THEIA_IPC_SCHEMAS = new Map(NO_ARGUMENT_CHANNELS.map((channel) => [channel, noArgs]))
THEIA_IPC_SCHEMAS.set('theia:advisor:academic-what-if', advisorAcademicScenario)
THEIA_IPC_SCHEMAS.set('theia:advisor:course-decisions', advisorCourseDecisions)
THEIA_IPC_SCHEMAS.set('theia:advisor:execute-action', advisorActionRequest)
THEIA_IPC_SCHEMAS.set('theia:advisor:prepare', advisorPrepareRequest)
THEIA_IPC_SCHEMAS.set('theia:advisor:send', advisorSendRequest)
THEIA_IPC_SCHEMAS.set('theia:advisor:cancel', advisorCancelRequest)
THEIA_IPC_SCHEMAS.set('theia:advisor:delete-thread', idArg)

for (const channel of [
  'theia:remove-course-selection-target', 'theia:prepare-course-work',
  'theia:open-course-work', 'theia:open-assignment-source', 'theia:open-submission', 'theia:apply-test-answers',
  'theia:process-course-work-with-model', 'theia:render-answer-pdf',
  'theia:open-answer-pdf',
]) THEIA_IPC_SCHEMAS.set(channel, idArg)

THEIA_IPC_SCHEMAS.set('theia:save-credentials', (channel, args) => credentials(channel, args))
THEIA_IPC_SCHEMAS.set('theia:save-academic-api-credentials', (channel, args) => credentials(channel, args))
THEIA_IPC_SCHEMAS.set('theia:save-mail-credentials', (channel, args) => credentials(channel, args, { mail: true }))
THEIA_IPC_SCHEMAS.set('theia:read-saved-secret', (channel, args) => {
  argCount(channel, args, 1)
  if (!['unified-password', 'academic-api-password', 'mail-password', 'mail-protocol-password'].includes(args[0])) {
    fail(channel, 'saved secret kind is invalid')
  }
})
THEIA_IPC_SCHEMAS.set('theia:read-mailbox-message', (channel, args) => {
  argCount(channel, args, 1, 2)
  stringValue(channel, args[0], 'message id', 512)
  objectValue(channel, args[1], 'options', { optional: true })
})
THEIA_IPC_SCHEMAS.set('theia:download-mailbox-attachment', (channel, args) => {
  argCount(channel, args, 2)
  stringValue(channel, args[0], 'message id', 512)
  numberValue(channel, args[1], 'attachment index')
})
THEIA_IPC_SCHEMAS.set('theia:get-course-selection-candidates', (channel, args) => {
  argCount(channel, args, 1, 3)
  stringValue(channel, args[0], 'block id', 512)
  objectValue(channel, args[1], 'target', { optional: true, nullable: true })
  objectValue(channel, args[2], 'options', { optional: true })
})
for (const channel of [
  'theia:search-school-schedule', 'theia:set-course-selection-sentinel',
  'theia:start-course-selection',
]) THEIA_IPC_SCHEMAS.set(channel, objectArg)
THEIA_IPC_SCHEMAS.set('theia:appearance-presets:save', (channel, args) => {
  argCount(channel, args, 1)
  if (!Array.isArray(args[0]) || args[0].length > 16) fail(channel, 'appearance presets must be an array with at most 16 items')
})
THEIA_IPC_SCHEMAS.set('theia:get-cached-school-schedule', (channel, args) => objectArg(channel, args, { optional: true, nullable: true }))
THEIA_IPC_SCHEMAS.set('theia:save-course-selection-target', (channel, args) => objectArg(channel, args, { nullable: true }))
THEIA_IPC_SCHEMAS.set('theia:refresh-academic-calendar-assets', (channel, args) => objectArg(channel, args, { optional: true }))
THEIA_IPC_SCHEMAS.set('theia:open-source', (channel, args) => {
  argCount(channel, args, 1)
  stringValue(channel, args[0], 'URL', 2_048)
})
THEIA_IPC_SCHEMAS.set('theia:get-fitness-score', (channel, args) => {
  argCount(channel, args, 0, 2)
  stringValue(channel, args[0], 'year', 100, { optional: true })
  objectValue(channel, args[1], 'options', { optional: true })
})
THEIA_IPC_SCHEMAS.set('theia:sync-domain', (channel, args) => {
  argCount(channel, args, 1)
  stringValue(channel, args[0], 'sync domain', 64)
  if (!RETRIABLE_SYNC_DOMAIN_IDS.includes(args[0])) fail(channel, 'sync domain is invalid')
})
THEIA_IPC_SCHEMAS.set('theia:zoom:set-percent', (channel, args) => {
  argCount(channel, args, 1)
  numberValue(channel, args[0], 'zoom percent')
})
THEIA_IPC_SCHEMAS.set('theia:appearance:mode', (channel, args) => {
  argCount(channel, args, 1)
  if (!['light', 'dark', 'system'].includes(args[0])) fail(channel, 'appearance mode is invalid')
})
THEIA_IPC_SCHEMAS.set('theia:import-course-work-file', (channel, args) => {
  argCount(channel, args, 2)
  stringValue(channel, args[0], 'assignment id', 512)
  if (!['answer', 'answer-key'].includes(args[1])) fail(channel, 'course-work file kind is invalid')
})
THEIA_IPC_SCHEMAS.set('theia:discover-models', (channel, args) => modelConfig(channel, args))
THEIA_IPC_SCHEMAS.set('theia:save-model-config', (channel, args) => modelConfig(channel, args, { saving: true }))
for (const channel of ['theia:generate-notes', 'theia:generate-paper']) {
  THEIA_IPC_SCHEMAS.set(channel, (name, args) => {
    argCount(name, args, 1, 2)
    stringValue(name, args[0], 'assignment id', 512)
    objectValue(name, args[1], 'options', { optional: true })
  })
}
THEIA_IPC_SCHEMAS.set('theia:render-md-file', (channel, args) => {
  argCount(channel, args, 2)
  stringValue(channel, args[0], 'assignment id', 512)
  if (!['modelAnswerPath', 'notesPath', 'paperPath'].includes(args[1])) fail(channel, 'render target is invalid')
})
THEIA_IPC_SCHEMAS.set('theia:update-settings', updateSettings)
THEIA_IPC_SCHEMAS.set('theia:export-data', (channel, args) => {
  argCount(channel, args, 0, 1)
  if (args[0] === undefined) return
  objectValue(channel, args[0], 'export request')
  allowedFields(channel, args[0], ['format', 'collection'])
  if (args[0].format !== undefined && !['json', 'theia', 'ics', 'csv', 'ai'].includes(args[0].format)) fail(channel, 'export format is invalid')
  stringValue(channel, args[0].collection, 'collection', 100, { optional: true })
})

export function validateIpcArguments(channel, args) {
  if (!Array.isArray(args)) fail(channel, 'argument list is invalid')
  const schema = THEIA_IPC_SCHEMAS.get(channel)
  if (!schema) fail(channel, 'channel has no registered input schema')
  for (const value of args) walkValue(channel, value)
  if (serializedBytes(channel, args) > MAX_IPC_ARGUMENT_BYTES) fail(channel, 'arguments exceed the byte limit')
  schema(channel, args)
  return args
}

function normalizedPath(url) {
  const path = url.pathname || '/'
  return path.length > 1 ? path.replace(/\/+$/, '') || '/' : path
}

function sameFilePath(left, right) {
  const normalize = (url) => {
    let path = normalizedPath(url)
    try { path = decodeURIComponent(path) } catch { /* URL pathname remains usable */ }
    path = path.replace(/\\/g, '/').toLowerCase()
    return path.endsWith('/index.html') ? path.slice(0, -'/index.html'.length) || '/' : path
  }
  return normalize(left) === normalize(right)
}

function isLocalFileHost(hostname) {
  const host = String(hostname || '').toLowerCase()
  return host === '' || host === 'localhost'
}

function isLoopbackHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

/**
 * Validate the renderer's application URL without requiring byte-for-byte URL
 * equality. Electron may append a hash/query during normal startup and Vite
 * may expose the same local server as localhost or 127.0.0.1. The identity
 * and main-frame checks remain strict; only harmless URL presentation changes
 * are accepted here.
 */
export function isExactTrustedEntryUrl(rawUrl, entryUrl) {
  try {
    const target = new URL(String(rawUrl || ''))
    const entry = new URL(String(entryUrl || ''))
    if (target.protocol !== entry.protocol) return false

    if (entry.protocol === 'file:') {
      return isLocalFileHost(target.hostname)
        && isLocalFileHost(entry.hostname)
        && sameFilePath(target, entry)
    }

    // Development renderers are local-only. Vite can move to another port
    // when an old dev process is still listening, and Electron may normalize
    // the loopback hostname between localhost, 127.0.0.1 and ::1. Keep the
    // renderer bound to the local THEIA root path, but do not make a stale
    // port or harmless origin alias reject a legitimate app frame.
    if (!['http:', 'https:'].includes(entry.protocol)) return false
    if (!isLoopbackHost(entry.hostname) || !isLoopbackHost(target.hostname)) return false
    // Client-side routes and Vite fallback paths remain inside the local
    // renderer. Loopback-only validation is the boundary; the route itself is
    // not an authority boundary in development.
    return true
  } catch {
    return false
  }
}

export function assertTrustedMainFrame(event, { mainWindow, entryUrl }) {
  if (!event || !mainWindow || mainWindow.isDestroyed?.()) throw new Error('IPC sender is not the active THEIA window')
  const expected = mainWindow.webContents
  const sender = event.sender
  if (!sender || sender !== expected || sender.id !== expected?.id) throw new Error('IPC sender is not the active THEIA renderer')
  const frame = event.senderFrame
  const mainFrame = expected?.mainFrame
  const sameFrame = frame && mainFrame && (
    frame === mainFrame
    || (frame.processId === mainFrame.processId && frame.routingId === mainFrame.routingId)
  )
  if (!sameFrame) throw new Error('IPC calls are accepted only from the THEIA main frame')
  const senderUrl = String(frame.url || sender.getURL?.() || '')
  const compatibilityMode = process.env.THEIA_STRICT_IPC !== '1'
  const blankStartupUrl = !senderUrl || senderUrl === 'about:blank'
  const compatibleFileRenderer = (() => {
    if (!compatibilityMode || !entryUrl || !senderUrl) return false
    try {
      const target = new URL(senderUrl)
      const entry = new URL(entryUrl)
      return target.protocol === 'file:'
        && entry.protocol === 'file:'
        && isLocalFileHost(target.hostname)
        && isLocalFileHost(entry.hostname)
        && sameFilePath(target, entry)
    } catch {
      return false
    }
  })()
  // Chromium may dispatch the first renderer IPC while a packaged file
  // document still reports about:blank. Sender and frame identity above stay
  // strict; this compatibility window only covers startup presentation.
  if (!isExactTrustedEntryUrl(senderUrl, entryUrl) && !(compatibilityMode && (blankStartupUrl || compatibleFileRenderer))) {
    throw new Error('IPC sender URL is not trusted')
  }
  return mainWindow
}

export function createTrustedIpc({ ipcMain, getMainWindow, getEntryUrl, onDenied = () => {} }) {
  const authorize = (channel, event, args) => {
    try {
      assertTrustedMainFrame(event, { mainWindow: getMainWindow(), entryUrl: getEntryUrl() })
      validateIpcArguments(channel, args)
    } catch (error) {
      onDenied({ channel, error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }
  return {
    handle(channel, handler) {
      if (!THEIA_IPC_SCHEMAS.has(channel)) fail(channel, 'channel has no registered input schema')
      ipcMain.handle(channel, (event, ...args) => {
        authorize(channel, event, args)
        return handler(event, ...args)
      })
    },
    on(channel, listener) {
      if (!THEIA_IPC_SCHEMAS.has(channel)) fail(channel, 'channel has no registered input schema')
      ipcMain.on(channel, (event, ...args) => {
        try {
          authorize(channel, event, args)
        } catch {
          return
        }
        listener(event, ...args)
      })
    },
  }
}
