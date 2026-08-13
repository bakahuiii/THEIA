import test from 'node:test'
import assert from 'node:assert/strict'
import { createLatestApiStatusLoader } from '../src/hooks/runtime-api-status.mjs'

test('snapshot API refresh cannot be overwritten by an older startup result', async () => {
  const pending = []
  const applied = []
  const loadApiStatus = createLatestApiStatusLoader({
    load: () => new Promise((resolve) => pending.push(resolve)),
    apply: ({ baseUrl }) => applied.push(baseUrl),
  })

  const startup = loadApiStatus()
  const snapshotRefresh = loadApiStatus()
  pending[1]({ baseUrl: 'http://127.0.0.1:8766', host: '127.0.0.1', port: 8766 })
  await snapshotRefresh
  pending[0]({ baseUrl: 'http://127.0.0.1:8765', host: '127.0.0.1', port: 8765 })
  await startup

  assert.deepEqual(applied, ['http://127.0.0.1:8766'])
})

test('each completed API status refresh applies when it is still current', async () => {
  const applied = []
  let port = 8765
  const loadApiStatus = createLatestApiStatusLoader({
    load: async () => ({
      baseUrl: `http://127.0.0.1:${port}`,
      host: '127.0.0.1',
      port,
    }),
    apply: ({ baseUrl }) => applied.push(baseUrl),
  })

  await loadApiStatus()
  port = 8766
  await loadApiStatus()

  assert.deepEqual(applied, [
    'http://127.0.0.1:8765',
    'http://127.0.0.1:8766',
  ])
})
