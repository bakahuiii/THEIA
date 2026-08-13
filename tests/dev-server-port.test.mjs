import assert from 'node:assert/strict'
import { createServer as createNetServer } from 'node:net'
import test from 'node:test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, loadConfigFromFile } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const configFile = resolve(root, 'vite.config.ts')

function listen(server, port = 0) {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolveListen()
    })
  })
}

function close(server) {
  return new Promise((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose())
  })
}

test('development server changes port when the preferred port is occupied', async () => {
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, configFile)
  assert.equal(loaded?.config.server?.strictPort, false)

  const occupied = createNetServer()
  await listen(occupied)
  const preferredPort = occupied.address().port
  const vite = await createServer({
    root,
    configFile,
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: preferredPort },
  })

  try {
    await vite.listen()
    const url = vite.resolvedUrls?.local?.[0]
    assert.ok(url)
    assert.notEqual(Number(new URL(url).port), preferredPort)
    assert.equal((await fetch(url)).status, 200)
  } finally {
    await vite.close()
    await close(occupied)
  }
})
