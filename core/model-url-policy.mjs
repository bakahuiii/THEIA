const LOOPBACK_HTTP_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

function literalHostname(raw) {
  const match = raw.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i)
  if (!match || match[1].includes('@')) return null
  const authority = match[1]
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']')
    if (end < 0 || !/^:\d*$/.test(authority.slice(end + 1)) && authority.slice(end + 1) !== '') return null
    return authority.slice(1, end).toLowerCase()
  }
  return authority.replace(/:\d*$/, '').toLowerCase()
}

export function normalizeModelServiceBaseUrl(value) {
  const raw = String(value || '').trim()
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Enter a valid model service URL')
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Model service URL must use HTTP or HTTPS')
  }
  if (url.username || url.password) {
    throw new Error('Model service URL must not contain credentials')
  }
  if (url.search || url.hash || raw.includes('?') || raw.includes('#')) {
    throw new Error('Model service URL must not contain a query or fragment')
  }
  const normalizedHostname = url.hostname.toLowerCase()
  const canonicalLoopbackHostname = normalizedHostname === '[::1]' ? '::1' : normalizedHostname
  if (LOOPBACK_HTTP_HOSTS.has(normalizedHostname) && literalHostname(raw) !== canonicalLoopbackHostname) {
    throw new Error('Loopback model service URLs must use literal localhost, 127.0.0.1, or [::1]')
  }
  if (url.protocol === 'http:' && !LOOPBACK_HTTP_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('Model service URL must use HTTPS unless it is a loopback address')
  }

  url.pathname = url.pathname.replace(/\/+$/, '') || '/'
  return url.pathname === '/' ? url.origin : url.toString()
}

export function modelServiceOrigin(value) {
  return new URL(normalizeModelServiceBaseUrl(value)).origin
}

export function modelServiceIdentity(value) {
  return normalizeModelServiceBaseUrl(value)
}
