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
    ? ['baseUrl', 'model', 'apiKey', 'probeId', 'allowManualModel']
    : ['baseUrl', 'apiKey']
  allowedFields(channel, args[0], fields)
  stringValue(channel, args[0].baseUrl, 'baseUrl', 1_000)
  stringValue(channel, args[0].apiKey, 'apiKey', 2_048, { optional: true })
  if (saving) {
    stringValue(channel, args[0].model, 'model', 300)
    stringValue(channel, args[0].probeId, 'probeId', 100, { optional: true })
    if (args[0].allowManualModel !== undefined && typeof args[0].allowManualModel !== 'boolean') {
      fail(channel, 'allowManualModel must be boolean')
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
]

export const THEIA_IPC_SCHEMAS = new Map(NO_ARGUMENT_CHANNELS.map((channel) => [channel, noArgs]))

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

export function isExactTrustedEntryUrl(rawUrl, entryUrl) {
  try {
    return new URL(String(rawUrl || '')).href === new URL(String(entryUrl || '')).href
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
  if (!isExactTrustedEntryUrl(senderUrl, entryUrl)) throw new Error('IPC sender URL is not trusted')
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
