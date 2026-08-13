const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:'])

function parsedUrl(rawUrl) {
  const url = new URL(String(rawUrl || ''))
  if (url.username || url.password) throw new Error('URL credentials are not allowed')
  return url
}

export function isPermittedSourceUrl(rawUrl) {
  try {
    const url = parsedUrl(rawUrl)
    if (url.protocol !== 'https:') return false
    return url.hostname === 'buct.edu.cn' || url.hostname.endsWith('.buct.edu.cn')
  } catch {
    return false
  }
}

export function permittedSourceUrl(rawUrl) {
  if (!isPermittedSourceUrl(rawUrl)) {
    throw new Error('只允许打开 HTTPS 北京化工大学校园网链接（*.buct.edu.cn）')
  }
  return parsedUrl(rawUrl).toString()
}

export function permittedAcademicApiUrl(rawUrl) {
  const url = permittedSourceUrl(rawUrl)
  if (new URL(url).hostname !== 'jwglxt.buct.edu.cn') {
    throw new Error('教务 API 只允许访问 jwglxt.buct.edu.cn')
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
  if (!isPermittedExternalUrl(rawUrl)) throw new Error('只允许使用系统浏览器打开 HTTP(S) 链接')
  return parsedUrl(rawUrl).toString()
}

export function isPermittedAppNavigation(rawUrl, entryUrl) {
  try {
    const target = parsedUrl(rawUrl)
    const entry = parsedUrl(entryUrl)
    if (target.protocol !== entry.protocol || target.origin !== entry.origin) return false
    return entry.protocol !== 'file:' || target.pathname === entry.pathname
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
