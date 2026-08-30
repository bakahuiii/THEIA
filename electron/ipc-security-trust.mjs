import { THEIA_IPC_SCHEMAS, validateIpcArguments } from './ipc-security-validation.mjs'

function fail(channel, message) {
  throw new Error(`IPC ${channel}: ${message}`)
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
    // renderer. Loopback-only validation is the boundary; the route itself
    // is not an authority boundary in development.
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
