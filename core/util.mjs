// This module is imported by both Electron and the renderer. Keep it free of
// Node-only imports so the browser bundle can reuse the same normalization and
// identifier rules as the main process.

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]

function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value)
  const bitLength = bytes.length * 8
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(paddedLength - 4, bitLength >>> 0)
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000))

  let h0 = 0x6a09e667
  let h1 = 0xbb67ae85
  let h2 = 0x3c6ef372
  let h3 = 0xa54ff53a
  let h4 = 0x510e527f
  let h5 = 0x9b05688c
  let h6 = 0x1f83d9ab
  let h7 = 0x5be0cd19
  const schedule = new Uint32Array(64)
  const rotateRight = (word, bits) => (word >>> bits) | (word << (32 - bits))

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      schedule[index] = view.getUint32(offset + index * 4)
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(schedule[index - 15], 7) ^ rotateRight(schedule[index - 15], 18) ^ (schedule[index - 15] >>> 3)
      const s1 = rotateRight(schedule[index - 2], 17) ^ rotateRight(schedule[index - 2], 19) ^ (schedule[index - 2] >>> 10)
      schedule[index] = (schedule[index - 16] + s0 + schedule[index - 7] + s1) >>> 0
    }

    let a = h0; let b = h1; let c = h2; let d = h3
    let e = h4; let f = h5; let g = h6; let h = h7
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const choose = (e & f) ^ (~e & g)
      const temp1 = (h + s1 + choose + SHA256_K[index] + schedule[index]) >>> 0
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (s0 + majority) >>> 0
      h = g; g = f; f = e; e = (d + temp1) >>> 0
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0
    h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('')
}

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
  return sha256Hex(input).slice(0, 24)
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
  const hasExpiredSessionMarker = /没有权限访问本页面|登录时间超时|登录已超时|会话已过期|会话超时/u.test(lower)
    || (/请重新登录/u.test(lower) && /权限|超时|过期/u.test(lower))
  return hasExpiredSessionMarker
    || ((urlText.includes('experimental-auth-endpoint') || urlText.includes('/login') || hasPasswordField) && hasLoginMarker)
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
