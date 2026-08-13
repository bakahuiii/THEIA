import { createHash } from 'node:crypto'

function canonicalNumber(value) {
  if (!Number.isFinite(value)) throw new TypeError('Canonical JSON only accepts finite numbers')
  if (Object.is(value, -0)) return '0'
  return JSON.stringify(value)
}

function canonicalValue(value, stack) {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'))
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return canonicalNumber(value)
  if (typeof value === 'bigint') throw new TypeError('Canonical JSON does not support bigint')
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    throw new TypeError('Canonical JSON does not support undefined, functions, or symbols')
  }
  if (stack.has(value)) throw new TypeError('Canonical JSON does not support cyclic values')

  stack.add(value)
  let serialized
  if (Array.isArray(value)) {
    serialized = `[${value.map((item) => (
      item === undefined || typeof item === 'function' || typeof item === 'symbol'
        ? 'null'
        : canonicalValue(item, stack)
    )).join(',')}]`
  } else {
    const normalizedKeys = Object.keys(value)
      .filter((key) => value[key] !== undefined && typeof value[key] !== 'function' && typeof value[key] !== 'symbol')
      .map((key) => ({ raw: key, normalized: key.normalize('NFC') }))
      .sort((left, right) => compareCanonicalText(left.normalized, right.normalized))
    for (let index = 1; index < normalizedKeys.length; index += 1) {
      if (normalizedKeys[index - 1].normalized === normalizedKeys[index].normalized) {
        throw new TypeError('Canonical JSON object keys collide after Unicode normalization')
      }
    }
    const entries = normalizedKeys
      .map(({ raw, normalized }) => `${JSON.stringify(normalized)}:${canonicalValue(value[raw], stack)}`)
    serialized = `{${entries.join(',')}}`
  }
  stack.delete(value)
  return serialized
}

export function compareCanonicalText(left, right) {
  const a = Buffer.from(String(left ?? '').normalize('NFC'), 'utf8')
  const b = Buffer.from(String(right ?? '').normalize('NFC'), 'utf8')
  return Buffer.compare(a, b)
}

export function canonicalJson(value) {
  return canonicalValue(value, new Set())
}

export function canonicalDigest(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
}

export function shortDigest(value, length = 16) {
  const size = Math.max(8, Math.min(64, Math.trunc(Number(length) || 16)))
  return canonicalDigest(value).slice(0, size)
}

export function normalizeText(value, { trim = false } = {}) {
  const text = String(value ?? '').normalize('NFC')
  return trim ? text.trim() : text
}

export function uniqueSorted(values) {
  const iterable = values && typeof values[Symbol.iterator] === 'function' ? [...values] : []
  return [...new Set(iterable.filter((value) => value !== null && value !== undefined).map((value) => normalizeText(value)))]
    .sort(compareCanonicalText)
}

export function parseInstant(value) {
  if (value instanceof Date) {
    const milliseconds = value.getTime()
    return Number.isFinite(milliseconds) ? { milliseconds, iso: new Date(milliseconds).toISOString() } : null
  }
  if (typeof value !== 'string' && typeof value !== 'number') return null
  if (typeof value === 'string' && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim())) return null
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) ? { milliseconds, iso: new Date(milliseconds).toISOString() } : null
}

export function requireInstant(value, label = 'instant') {
  if (typeof value === 'string' && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim())) {
    throw new TypeError(`${label} must include an explicit UTC offset`)
  }
  const parsed = parseInstant(value)
  if (!parsed) throw new TypeError(`${label} must be a valid date-time`)
  return parsed
}

function localParts(milliseconds, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(milliseconds))
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]))
}

function localDateTimeToInstant(parts, timeZone) {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond)
  let candidate = target
  for (let index = 0; index < 3; index += 1) {
    const actual = localParts(candidate, timeZone)
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second, parts.millisecond)
    candidate += target - represented
  }
  const actual = localParts(candidate, timeZone)
  if (actual.year !== parts.year || actual.month !== parts.month || actual.day !== parts.day
    || actual.hour !== parts.hour || actual.minute !== parts.minute || actual.second !== parts.second) return null
  return { milliseconds: candidate, iso: new Date(candidate).toISOString() }
}

export function parseCampusInstant(value, { timeZone = 'Asia/Shanghai' } = {}) {
  if (value instanceof Date || typeof value === 'number') return parseInstant(value)
  if (typeof value !== 'string') return null
  const text = value.normalize('NFC').trim()
  if (!text) return null
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) return parseInstant(text)

  const match = text.match(/(\d{4})\s*(?:年|[-/.])\s*(\d{1,2})\s*(?:月|[-/.])\s*(\d{1,2})(?:\s*日)?(?:[^\d]+(\d{1,2})\s*[:：]\s*(\d{2})(?:\s*[:：]\s*(\d{2})(?:[.,](\d{1,3}))?)?)?/)
  if (!match) return null
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] || 0),
    minute: Number(match[5] || 0),
    second: Number(match[6] || 0),
    millisecond: Number(String(match[7] || '').padEnd(3, '0') || 0),
  }
  if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31
    || parts.hour > 23 || parts.minute > 59 || parts.second > 59) return null
  const calendarCheck = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
  if (calendarCheck.getUTCFullYear() !== parts.year || calendarCheck.getUTCMonth() + 1 !== parts.month
    || calendarCheck.getUTCDate() !== parts.day) return null
  try {
    return localDateTimeToInstant(parts, timeZone)
  } catch {
    return null
  }
}
