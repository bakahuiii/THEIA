export const MAX_IPC_ARGUMENT_BYTES = 1024 * 1024

const MAX_IPC_DEPTH = 12
const MAX_IPC_ARRAY_ITEMS = 5_000
const MAX_IPC_OBJECT_KEYS = 512
const MAX_IPC_STRING_LENGTH = 200_000

export function fail(channel, message) {
  throw new Error(`IPC ${channel}: ${message}`)
}

export function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function walkValue(channel, value, depth = 0) {
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

export function serializedBytes(channel, args) {
  let encoded
  try {
    encoded = JSON.stringify(args)
  } catch {
    fail(channel, 'arguments are not serializable')
  }
  return Buffer.byteLength(encoded || '', 'utf8')
}

export function argCount(channel, args, minimum, maximum = minimum) {
  if (args.length < minimum || args.length > maximum) {
    fail(channel, `expected ${minimum === maximum ? minimum : `${minimum}-${maximum}`} arguments`)
  }
}

export function stringValue(channel, value, label, maximum = 512, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === '')) return
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    fail(channel, `${label} must be a non-empty string no longer than ${maximum} characters`)
  }
}

export function numberValue(channel, value, label, { optional = false } = {}) {
  if (optional && (value === undefined || value === null)) return
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(channel, `${label} must be a finite number`)
}

export function objectValue(channel, value, label, { optional = false, nullable = false } = {}) {
  if (optional && value === undefined) return
  if (nullable && value === null) return
  if (!plainObject(value)) fail(channel, `${label} must be an object`)
}

export function allowedFields(channel, value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(channel, `unknown field ${key}`)
  }
}

export function noArgs(channel, args) {
  argCount(channel, args, 0)
}

export function idArg(channel, args) {
  argCount(channel, args, 1)
  stringValue(channel, args[0], 'id', 512)
}

export function objectArg(channel, args, { optional = false, nullable = false } = {}) {
  argCount(channel, args, optional ? 0 : 1, 1)
  objectValue(channel, args[0], 'argument', { optional, nullable })
}
