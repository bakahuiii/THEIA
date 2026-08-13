import { createHash } from 'node:crypto'
import { URL } from 'node:url'

export function normalizeText(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\r\f ]+/g, ' ')
    .replace(/\n+/g, ' ')
    .trim()
}

export function absoluteUrl(url, base) {
  if (!url) return null
  try {
    return new URL(String(url).trim(), base).toString()
  } catch {
    return null
  }
}

export function stableId(...parts) {
  const input = parts.map((part) => String(part ?? '')).join('|')
  return createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 24)
}

export function parseNumber(value) {
  const text = normalizeText(value).replace(/,/g, '')
  const match = text.match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : null
}

export function parseDateLike(value, now = new Date()) {
  const text = normalizeText(value)
  if (!text) return null
  const normalized = text
    .replace(/[年./]/g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '')
    .replace(/时/g, ':')
    .replace(/分/g, '')
    .replace(/\s+/g, ' ')
  const direct = new Date(normalized)
  if (!Number.isNaN(direct.getTime())) return direct.toISOString()
  const md = normalized.match(/^(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):?(\d{2})?)?$/)
  if (md) {
    const year = now.getFullYear()
    const candidate = new Date(year, Number(md[1]) - 1, Number(md[2]), Number(md[3] || 0), Number(md[4] || 0))
    return candidate.toISOString()
  }
  return null
}

export function academicTermCandidate(now = new Date()) {
  const month = now.getMonth() + 1
  if (month >= 8) return { year: now.getFullYear(), term: '3', label: `${now.getFullYear()}-${now.getFullYear() + 1} 第一学期` }
  if (month <= 2) return { year: now.getFullYear() - 1, term: '3', label: `${now.getFullYear() - 1}-${now.getFullYear()} 第一学期` }
  return { year: now.getFullYear() - 1, term: '12', label: `${now.getFullYear() - 1}-${now.getFullYear()} 第二学期` }
}

export function parseAcademicTerm(yearValue, termValue, labelValue) {
  const year = Number.parseInt(String(yearValue ?? ''), 10)
  const rawTerm = String(termValue ?? '').trim()
  // Zhengfang mixes the display number (1/2/3) and its internal term code
  // (3/12/16) across pages. Normalize at the boundary so a label such as
  // "2026-2027 1" does not become "2026-2027 1 第一学期" in every view.
  const term = ({ '1': '3', '2': '12', '3': '3', '12': '12', '16': '16' }[rawTerm] || rawTerm)
  if (!Number.isFinite(year) || !term) return null
  const termNames = { '3': '第一学期', '12': '第二学期', '16': '第三学期' }
  const termName = termNames[term]
  const displaySuffixes = { '3': ['1', '第一'], '12': ['2', '第二'], '16': ['3', '第三'] }
  // If the incoming label already contains a 学期 marker, keep it; otherwise append termName.
  // Some selectors use a bare display number as the final label token.
  let label = normalizeText(labelValue) || `${year}-${year + 1}`
  if (termName && !label.includes('学期')) {
    const suffix = displaySuffixes[term]?.find((value) => new RegExp(`\\s${value}$`).test(label))
    if (suffix) label = label.slice(0, -suffix.length).trim()
  }
  if (termName && !label.includes('学期')) label = `${label} ${termName}`
  else if (!termName && !label.includes('学期')) label = `${label} 学期 ${term}`
  return { id: `${year}-${term}`, year, term, label }
}

export function parseQueryFromOnclick(value) {
  const text = String(value ?? '')
  const match = text.match(/clickMenu\(['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]\)/i)
  return match ? { code: match[1], path: match[2], label: match[3] } : null
}

export function toQueryString(values) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values || {})) {
    if (value === undefined || value === null) continue
    params.set(key, String(value))
  }
  return params.toString()
}

export function htmlLooksLikeLogin(html, finalUrl = '') {
  const urlText = String(finalUrl).toLowerCase()
  const lower = String(html).toLowerCase()
  const hasPasswordField = /<input\b[^>]*type\s*=\s*["']?password\b/i.test(lower)
  const hasLoginMarker = /password|login|sso|cas|统一身份认证|请输入密码|密码登录/i.test(lower)
  return (urlText.includes('experimental-auth-endpoint') || urlText.includes('/login') || hasPasswordField) && hasLoginMarker
}

const SENSITIVE_DIAGNOSTIC_KEYS = [
  'password', 'passcode', 'apikey', 'authorization', 'cookie', 'session',
  'sessionid', 'jsessionid', 'token', 'secret', 'credential', 'privatekey',
  'accesskey', 'protocolpassword',
]

function sensitiveDiagnosticKey(value) {
  const key = String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase()
  return SENSITIVE_DIAGNOSTIC_KEYS.some((needle) => key === needle || key.includes(needle))
}

function sanitizedDiagnosticUrl(value) {
  try {
    const url = new URL(String(value))
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

export function sanitizeDiagnosticText(value, maxLength = 720) {
  const limit = Math.max(1, Math.min(10_000, Number(maxLength) || 720))
  return String(value ?? '')
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => sanitizedDiagnosticUrl(url))
    .replace(/(?<![a-z0-9+.-])[a-z]:[\\/][^\r\n"']+/gi, '[local-path]')
    .replace(/\\\\[^\s"']+/g, '[local-path]')
    .replace(/\/(?:Users|home|tmp|var|private)(?:\/[^\s"']*)?/g, '[local-path]')
    .replace(/\b(proxy-)?authorization\s*[:=]\s*(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, '$1authorization=[redacted]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, '$1 [redacted]')
    .replace(/\b(set-cookie|cookie)\s*[:=]\s*[^\r\n]+/gi, '$1=[redacted]')
    .replace(/\b(password|passcode|token|api[_-]?key|secret|session(?:id)?|jsessionid)\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[redacted]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
}

export function sanitizeDiagnosticValue(value, maxTextLength = 2_000) {
  const seen = new WeakSet()
  const sanitize = (current, depth) => {
    if (typeof current === 'string') return sanitizeDiagnosticText(current, maxTextLength)
    if (current instanceof Error) return compactError(current)
    if (current === null || ['number', 'boolean'].includes(typeof current)) return current
    if (typeof current !== 'object') return sanitizeDiagnosticText(String(current ?? ''), maxTextLength)
    if (depth >= 8 || seen.has(current)) return '[redacted-complex-value]'
    seen.add(current)
    if (Array.isArray(current)) return current.slice(0, 500).map((item) => sanitize(item, depth + 1))
    const clean = {}
    for (const [key, child] of Object.entries(current).slice(0, 500)) {
      clean[key] = sensitiveDiagnosticKey(key) ? '[redacted]' : sanitize(child, depth + 1)
    }
    return clean
  }
  return sanitize(value, 0)
}

export function compactError(error) {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error')
  return sanitizeDiagnosticText(message) || 'Unknown error'
}
