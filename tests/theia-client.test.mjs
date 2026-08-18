import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { discoverTheiaApi } from '../integration/theia-client.mjs'

test('THEIA API discovery rejects stale or malformed runtime metadata', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'theia-client-runtime-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'api-runtime.json'), JSON.stringify({
    host: '127.0.0.1', port: 8765, pid: 999_999_999, startedAt: new Date().toISOString(),
  }))
  await assert.rejects(discoverTheiaApi({ dataRoot: root }), /runtime is not running/u)

  await writeFile(join(root, 'api-runtime.json'), JSON.stringify({
    host: '127.0.0.1', port: 8765, pid: process.pid, startedAt: 'invalid',
  }))
  await assert.rejects(discoverTheiaApi({ dataRoot: root }), /metadata is invalid/u)
})
