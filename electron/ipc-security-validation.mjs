import { JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES } from '../core/jwglxt-extra.mjs'
import { ADVISOR_IPC_SCHEMAS } from './ipc-advisor-validation.mjs'
import {
  MAX_IPC_ARGUMENT_BYTES,
  allowedFields,
  argCount,
  fail,
  idArg,
  noArgs,
  numberValue,
  objectArg,
  objectValue,
  serializedBytes,
  stringValue,
  walkValue,
} from './ipc-validation-primitives.mjs'

export { MAX_IPC_ARGUMENT_BYTES }

export const RETRIABLE_SYNC_DOMAIN_IDS = Object.freeze([
  'profile', 'terms', 'schedule', 'exams', 'grades', 'selected-courses',
  'academic-progress', 'jwglxt-courses', 'jwglxt-notices', 'theol-courses', 'theol-course-details',
  'assignments', 'theol-notices', 'mailbox', 'academic-calendar', 'fitness',
  'school-schedule',
  'academic-extras',
  ...JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES,
])
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
    ? ['baseUrl', 'model', 'apiKey', 'probeId', 'allowManualModel', 'modelRouting', 'advisorConfig', 'provider']
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
    if (args[0].advisorConfig !== undefined) {
      objectValue(channel, args[0].advisorConfig, 'advisorConfig')
      allowedFields(channel, args[0].advisorConfig, ['budgetLevel', 'permissionMode', 'reasoningEffort', 'responseStyle', 'responseLength', 'temperature'])
      if (args[0].advisorConfig.budgetLevel !== undefined
        && !['high', 'xhigh', 'max', 'ultra'].includes(args[0].advisorConfig.budgetLevel)) fail(channel, 'advisorConfig.budgetLevel is invalid')
      if (args[0].advisorConfig.permissionMode !== undefined
        && !['read-only', 'full-access'].includes(args[0].advisorConfig.permissionMode)) fail(channel, 'advisorConfig.permissionMode is invalid')
      if (args[0].advisorConfig.reasoningEffort !== undefined
        && !['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(args[0].advisorConfig.reasoningEffort)) fail(channel, 'advisorConfig.reasoningEffort is invalid')
      if (args[0].advisorConfig.responseStyle !== undefined
        && !['direct', 'balanced', 'detailed'].includes(args[0].advisorConfig.responseStyle)) fail(channel, 'advisorConfig.responseStyle is invalid')
      if (args[0].advisorConfig.responseLength !== undefined
        && !['adaptive', 'short', 'standard', 'detailed'].includes(args[0].advisorConfig.responseLength)) fail(channel, 'advisorConfig.responseLength is invalid')
      if (args[0].advisorConfig.temperature !== undefined) numberValue(channel, args[0].advisorConfig.temperature, 'advisorConfig.temperature')
    }
  }
}

function updateSettings(channel, args) {
  argCount(channel, args, 1)
  objectValue(channel, args[0], 'settings')
  allowedFields(channel, args[0], [
    'apiPort', 'syncIntervalMinutes', 'autoSync', 'openOriginalInApp',
    'academicAuthMode', 'academicApiEnabled', 'mail', 'advisorConfig',
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
  if (args[0].advisorConfig !== undefined) {
    objectValue(channel, args[0].advisorConfig, 'advisorConfig')
    allowedFields(channel, args[0].advisorConfig, ['budgetLevel', 'permissionMode', 'reasoningEffort', 'responseStyle', 'responseLength', 'temperature'])
    if (args[0].advisorConfig.budgetLevel !== undefined
      && !['high', 'xhigh', 'max', 'ultra'].includes(args[0].advisorConfig.budgetLevel)) fail(channel, 'advisorConfig.budgetLevel is invalid')
    if (args[0].advisorConfig.permissionMode !== undefined
      && !['read-only', 'full-access'].includes(args[0].advisorConfig.permissionMode)) fail(channel, 'advisorConfig.permissionMode is invalid')
    if (args[0].advisorConfig.reasoningEffort !== undefined
      && !['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(args[0].advisorConfig.reasoningEffort)) fail(channel, 'advisorConfig.reasoningEffort is invalid')
    if (args[0].advisorConfig.responseStyle !== undefined
      && !['direct', 'balanced', 'detailed'].includes(args[0].advisorConfig.responseStyle)) fail(channel, 'advisorConfig.responseStyle is invalid')
    if (args[0].advisorConfig.responseLength !== undefined
      && !['adaptive', 'short', 'standard', 'detailed'].includes(args[0].advisorConfig.responseLength)) fail(channel, 'advisorConfig.responseLength is invalid')
    if (args[0].advisorConfig.temperature !== undefined) numberValue(channel, args[0].advisorConfig.temperature, 'advisorConfig.temperature')
  }
}

const NO_ARGUMENT_CHANNELS = [
  'theia:get-snapshot', 'theia:get-activity-log', 'theia:get-auth-status',
  'theia:get-renderer-snapshot',
  'theia:get-user-data-overview',
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
  'theia:install-mcp-clients',
  'theia:advisor:list-threads', 'theia:advisor:create-thread',
  'theia:get-course-work-queue',
  'theia:get-iris-status', 'theia:open-iris-control-panel', 'theia:clear-iris-credentials',
  'theia:start-iris', 'theia:stop-iris', 'theia:restart-iris',
  'theia:get-update-status', 'theia:check-for-updates', 'theia:install-update',
]

export const THEIA_IPC_SCHEMAS = new Map(NO_ARGUMENT_CHANNELS.map((channel) => [channel, noArgs]))
for (const [channel, schema] of ADVISOR_IPC_SCHEMAS) THEIA_IPC_SCHEMAS.set(channel, schema)

THEIA_IPC_SCHEMAS.set('theia:get-user-data-domain-summary', idArg)
THEIA_IPC_SCHEMAS.set('theia:get-user-data-records', (channel, args) => {
  argCount(channel, args, 1, 2)
  stringValue(channel, args[0], 'data domain', 100)
  objectValue(channel, args[1], 'data records options', { optional: true })
  if (!args[1]) return
  allowedFields(channel, args[1], ['query', 'termId', 'status', 'scope', 'limit', 'cursor', 'recordType'])
  stringValue(channel, args[1].query, 'data query', 2_000, { optional: true })
  stringValue(channel, args[1].termId, 'term id', 160, { optional: true })
  stringValue(channel, args[1].status, 'data status', 80, { optional: true })
  stringValue(channel, args[1].scope, 'data scope', 16, { optional: true })
  if (args[1].scope !== undefined && !['current', 'all'].includes(args[1].scope)) fail(channel, 'data scope is invalid')
  stringValue(channel, args[1].cursor, 'data cursor', 80, { optional: true })
  stringValue(channel, args[1].recordType, 'record type', 160, { optional: true })
  if (args[1].limit !== undefined) {
    numberValue(channel, args[1].limit, 'data limit')
    if (!Number.isInteger(args[1].limit) || args[1].limit < 1 || args[1].limit > 100) fail(channel, 'data limit is outside the supported range')
  }
})

for (const channel of [
  'theia:remove-course-selection-target', 'theia:prepare-course-work',
  'theia:open-course-work', 'theia:open-assignment-source', 'theia:open-submission', 'theia:apply-test-answers',
  'theia:process-course-work-with-model', 'theia:render-answer-pdf',
  'theia:open-answer-pdf',
]) THEIA_IPC_SCHEMAS.set(channel, idArg)
THEIA_IPC_SCHEMAS.set('theia:refresh-course-resources', idArg)
THEIA_IPC_SCHEMAS.set('theia:download-course-resource', (channel, args) => {
  argCount(channel, args, 2)
  stringValue(channel, args[0], 'course id', 160)
  stringValue(channel, args[1], 'resource id', 300)
})
THEIA_IPC_SCHEMAS.set('theia:cancel-course-work-job', idArg)
THEIA_IPC_SCHEMAS.set('theia:set-course-work-queue-enabled', (channel, args) => {
  argCount(channel, args, 1)
  if (typeof args[0] !== 'boolean') fail(channel, 'queue enabled must be a boolean')
})
THEIA_IPC_SCHEMAS.set('theia:enqueue-course-work', (channel, args) => {
  argCount(channel, args, 1)
  objectValue(channel, args[0], 'course-work queue request')
  allowedFields(channel, args[0], ['assignmentId', 'operation', 'options', 'dedupeKey', 'maxAttempts'])
  stringValue(channel, args[0].assignmentId, 'assignment id', 512)
  if (args[0].operation !== undefined) {
    stringValue(channel, args[0].operation, 'queue operation', 48)
    if (!['prepare', 'model', 'notes', 'paper'].includes(args[0].operation)) fail(channel, 'queue operation is invalid')
  }
  objectValue(channel, args[0].options, 'queue options', { optional: true })
  if (args[0].options) {
    allowedFields(channel, args[0].options, ['title', 'wordCount'])
    stringValue(channel, args[0].options.title, 'queue title', 160, { optional: true })
    if (args[0].options.wordCount !== undefined) numberValue(channel, args[0].options.wordCount, 'queue word count')
  }
  stringValue(channel, args[0].dedupeKey, 'dedupe key', 220, { optional: true })
  if (args[0].maxAttempts !== undefined) {
    numberValue(channel, args[0].maxAttempts, 'max attempts')
    if (args[0].maxAttempts < 1 || args[0].maxAttempts > 3) fail(channel, 'max attempts is outside the supported range')
  }
})

THEIA_IPC_SCHEMAS.set('theia:save-credentials', (channel, args) => credentials(channel, args))
THEIA_IPC_SCHEMAS.set('theia:save-academic-api-credentials', (channel, args) => credentials(channel, args))
THEIA_IPC_SCHEMAS.set('theia:save-mail-credentials', (channel, args) => credentials(channel, args, { mail: true }))
THEIA_IPC_SCHEMAS.set('theia:read-saved-secret', (channel, args) => {
  argCount(channel, args, 1)
  if (!['unified-password', 'academic-api-password', 'mail-password', 'mail-protocol-password'].includes(args[0])) {
    fail(channel, 'saved secret kind is invalid')
  }
})
THEIA_IPC_SCHEMAS.set('theia:save-iris-settings', (channel, args) => {
  argCount(channel, args, 1)
  objectValue(channel, args[0], 'Iris settings')
  allowedFields(channel, args[0], ['enabled', 'visibleProviders', 'providers'])
  if (args[0].enabled !== undefined && typeof args[0].enabled !== 'boolean') fail(channel, 'Iris enabled must be a boolean')
  if (args[0].visibleProviders !== undefined) {
    if (!Array.isArray(args[0].visibleProviders) || args[0].visibleProviders.length > 16) fail(channel, 'Iris visibleProviders is invalid')
    for (const provider of args[0].visibleProviders) stringValue(channel, provider, 'Iris provider', 32)
  }
  if (args[0].providers !== undefined) {
    objectValue(channel, args[0].providers, 'Iris providers')
    allowedFields(channel, args[0].providers, ['theia', 'hyperion', 'selene', 'codex', 'hermes', 'claude', 'claudeDesktop'])
    for (const value of Object.values(args[0].providers)) if (typeof value !== 'boolean') fail(channel, 'Iris provider flags must be booleans')
  }
})
THEIA_IPC_SCHEMAS.set('theia:save-iris-credentials', (channel, args) => {
  argCount(channel, args, 1)
  objectValue(channel, args[0], 'Iris credentials')
  allowedFields(channel, args[0], ['appId', 'appSecret', 'ownerOpenid'])
  stringValue(channel, args[0].appId, 'QQ App ID', 128)
  stringValue(channel, args[0].appSecret, 'QQ AppSecret', 512)
  stringValue(channel, args[0].ownerOpenid, 'QQ owner OpenID', 256, { optional: true })
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
THEIA_IPC_SCHEMAS.set('theia:get-motion-venue-catalog', (channel, args) => noArgs(channel, args))
THEIA_IPC_SCHEMAS.set('theia:refresh-motion-venue-catalog', (channel, args) => noArgs(channel, args))
THEIA_IPC_SCHEMAS.set('theia:query-motion-venue-status', (channel, args) => {
  argCount(channel, args, 1)
  objectValue(channel, args[0], 'MOTION venue query')
  allowedFields(channel, args[0], ['detailUrl', 'date', 'venue'])
  stringValue(channel, args[0].detailUrl, 'detailUrl', 2_048)
  stringValue(channel, args[0].date, 'date', 10, { optional: true })
  if (args[0].date !== undefined && args[0].date !== null && args[0].date !== '' && !/^\d{4}-\d{2}-\d{2}$/u.test(args[0].date)) {
    fail(channel, 'date must use YYYY-MM-DD')
  }
  stringValue(channel, args[0].venue, 'venue', 160, { optional: true })
})
THEIA_IPC_SCHEMAS.set('theia:save-course-selection-target', (channel, args) => objectArg(channel, args, { nullable: true }))
THEIA_IPC_SCHEMAS.set('theia:refresh-academic-calendar-assets', (channel, args) => objectArg(channel, args, { optional: true }))
THEIA_IPC_SCHEMAS.set('theia:open-source', (channel, args) => {
  argCount(channel, args, 1)
  stringValue(channel, args[0], 'URL', 2_048)
})
THEIA_IPC_SCHEMAS.set('theia:open-academic-attachment', (channel, args) => {
  argCount(channel, args, 2)
  stringValue(channel, args[0], 'academic domain', 80)
  stringValue(channel, args[1], 'attachment id', 100)
  if (!JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES.includes(args[0])) fail(channel, 'academic domain is invalid')
  if (!/^[A-Za-z0-9_-]{1,80}$/u.test(args[1])) fail(channel, 'attachment id is invalid')
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
THEIA_IPC_SCHEMAS.set('theia:query-free-classrooms', (channel, args) => {
  argCount(channel, args, 1)
  objectValue(channel, args[0], 'free classroom query')
  allowedFields(channel, args[0], ['termId', 'date', 'weeks', 'weekdays', 'periods', 'campus', 'building', 'classroomType', 'minSeats', 'maxSeats'])
  stringValue(channel, args[0].termId, 'termId', 64)
  stringValue(channel, args[0].date, 'date', 10, { optional: true })
  if (args[0].date !== undefined && args[0].date !== null && args[0].date !== '' && !/^\d{4}-\d{2}-\d{2}$/u.test(args[0].date)) fail(channel, 'date must use YYYY-MM-DD')
  for (const [key, maximum] of [['weeks', 64], ['weekdays', 7], ['periods', 32]]) {
    const values = args[0][key]
    if (!Array.isArray(values) || !values.length || values.length > maximum) fail(channel, `${key} must be a non-empty array`)
    for (const value of values) {
      if (!Number.isInteger(value) || value < 1 || value > maximum) fail(channel, `${key} contains an invalid value`)
    }
  }
  for (const [key, maximum] of [['campus', 80], ['building', 80], ['classroomType', 80]]) stringValue(channel, args[0][key], key, maximum, { optional: true })
  for (const key of ['minSeats', 'maxSeats']) {
    if (args[0][key] !== undefined && args[0][key] !== null) {
      numberValue(channel, args[0][key], key)
      if (!Number.isInteger(args[0][key]) || args[0][key] < 0 || args[0][key] > 500) fail(channel, `${key} is outside the supported range`)
    }
  }
  if (args[0].minSeats !== undefined && args[0].maxSeats !== undefined && args[0].minSeats > args[0].maxSeats) fail(channel, 'minSeats cannot exceed maxSeats')
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
