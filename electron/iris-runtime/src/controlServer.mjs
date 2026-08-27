import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { publicSettings, updatePublicSettings } from './settings.mjs'

const sourceDirectory = dirname(fileURLToPath(import.meta.url))
const guiDirectory = resolve(sourceDirectory, 'gui')
const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' }

function send(response, status, body, type = 'application/json; charset=utf-8') {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return response.end(body)
  response.end(typeof body === 'string' ? body : JSON.stringify(body))
}

async function readJson(request) {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (body.length > 64_000) throw new Error('Request body is too large.')
  }
  return body ? JSON.parse(body) : {}
}

async function serveAsset(response, name) {
  try {
    const body = await readFile(resolve(guiDirectory, name))
    send(response, 200, body, contentTypes[`.${name.split('.').at(-1)}`] ?? 'application/octet-stream')
  } catch {
    send(response, 404, { error: 'Not found.' })
  }
}

/** Starts the loopback-only settings surface. */
export async function createControlServer({ port, status, tailLogs, sendTest, onSettingsSaved, logger = () => {} } = {}) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    try {
      if (request.method === 'GET' && url.pathname === '/') return await serveAsset(response, 'index.html')
      if (request.method === 'GET' && url.pathname === '/app.js') return await serveAsset(response, 'app.js')
      if (request.method === 'GET' && url.pathname === '/styles.css') return await serveAsset(response, 'styles.css')
      if (request.method === 'GET' && url.pathname === '/api/status') return send(response, 200, await status?.())
      if (request.method === 'GET' && url.pathname === '/api/settings') return send(response, 200, publicSettings())
      if (request.method === 'GET' && url.pathname === '/api/logs') return send(response, 200, { lines: await tailLogs?.() ?? [] })
      if (request.method === 'PUT' && url.pathname === '/api/settings') {
        const saved = updatePublicSettings(await readJson(request))
        await onSettingsSaved?.(saved)
        return send(response, 200, saved)
      }
      if (request.method === 'POST' && url.pathname === '/api/test-notification') {
        await sendTest?.()
        return send(response, 202, { ok: true })
      }
      return send(response, 404, { error: 'Not found.' })
    } catch (error) {
      logger('warn', `control API ${request.method} ${url.pathname} failed: ${String(error?.message ?? error)}`)
      const message = error?.code === 'INVALID_COMMAND_ALIASES' ? error.message : 'The request could not be completed.'
      return send(response, 400, { error: message })
    }
  })
  await new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(port, '127.0.0.1', resolvePromise)
  })
  const actualPort = server.address()?.port ?? port
  logger('info', `control GUI listening at http://127.0.0.1:${actualPort}`)
  return { port: actualPort, async close() { await new Promise((resolvePromise) => server.close(resolvePromise)) } }
}
