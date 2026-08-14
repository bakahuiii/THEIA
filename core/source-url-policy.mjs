const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:'])

function isLoopbackHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

function isLocalFileHost(hostname) {
  const host = String(hostname || '').toLowerCase()
  return host === '' || host === 'localhost'
}

function sameFileAppPath(left, right) {
  const normalize = (url) => {
    let path = url.pathname || '/'
    try { path = decodeURIComponent(path) } catch { /* URL pathname remains usable */ }
    path = path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() || '/'
    return path.endsWith('/index.html') ? path.slice(0, -'/index.html'.length) || '/' : path
  }
  return normalize(left) === normalize(right)
}

function parsedUrl(rawUrl) {
  const url = new URL(String(rawUrl || ''))
  if (url.username || url.password) throw new Error('URL credentials are not allowed')
  return url
}

export function isPermittedSourceUrl(rawUrl) {
  try {
    const url = parsedUrl(rawUrl)
    // BUCT still publishes legacy HTTP entry points and some campus networks
    // do not complete the HTTPS redirect reliably. Keep the host allowlist
    // strict, but accept both official HTTP and HTTPS during this rollout.
    if (!EXTERNAL_PROTOCOLS.has(url.protocol)) return false
    return url.hostname === 'buct.edu.cn' || url.hostname.endsWith('.buct.edu.cn')
  } catch {
    return false
  }
}

export function permittedSourceUrl(rawUrl) {
  if (!isPermittedSourceUrl(rawUrl)) {
    throw new Error('Only HTTPS or HTTP(S) campus links under *.buct.edu.cn are allowed')
  }
  return parsedUrl(rawUrl).toString()
}

export function permittedAcademicApiUrl(rawUrl) {
  const url = permittedSourceUrl(rawUrl)
  if (new URL(url).hostname !== 'jwglxt.buct.edu.cn') {
    throw new Error('Academic API access is restricted to jwglxt.buct.edu.cn')
  }
  return url
}

export function isPermittedExternalUrl(rawUrl) {
  try {
    return EXTERNAL_PROTOCOLS.has(parsedUrl(rawUrl).protocol)
  } catch {
    return false
  }
}

export function permittedExternalUrl(rawUrl) {
  if (!isPermittedExternalUrl(rawUrl)) throw new Error('Only HTTP(S) URLs can be opened in the system browser')
  return parsedUrl(rawUrl).toString()
}

export function isPermittedAppNavigation(rawUrl, entryUrl) {
  try {
    const target = parsedUrl(rawUrl)
    const entry = parsedUrl(entryUrl)
    if (entry.protocol === 'file:') {
      return target.protocol === 'file:'
        && isLocalFileHost(target.hostname)
        && isLocalFileHost(entry.hostname)
        && sameFileAppPath(target, entry)
    }
    // Development THEIA is served by a local Vite process. Keep navigation on
    // the configured renderer port while allowing harmless loopback hostname
    // aliases and client-side paths. IPC has its own recovery tolerance for a
    // stale dev port; navigation should not turn the local API into a page.
    return ['http:', 'https:'].includes(entry.protocol)
      && target.protocol === entry.protocol
      && isLoopbackHost(target.hostname)
      && isLoopbackHost(entry.hostname)
      && target.port === entry.port
  } catch {
    return false
  }
}

export function isPermittedSourceDownloadUrl(rawUrl) {
  if (isPermittedSourceUrl(rawUrl)) return true
  try {
    const url = parsedUrl(rawUrl)
    return url.protocol === 'blob:' && isPermittedSourceUrl(url.origin)
  } catch {
    return false
  }
}
