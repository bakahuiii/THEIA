import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  MAX_IPC_ARGUMENT_BYTES,
  THEIA_IPC_SCHEMAS,
  assertTrustedMainFrame,
  createTrustedIpc,
  isExactTrustedEntryUrl,
  validateIpcArguments,
} from '../electron/ipc-security.mjs'

function trustedFixture(url = 'http://127.0.0.1:5174/') {
  const frame = { processId: 7, routingId: 11, url }
  const webContents = { id: 41, mainFrame: frame, getURL: () => url }
  const mainWindow = { webContents, isDestroyed: () => false }
  return { event: { sender: webContents, senderFrame: frame }, mainWindow, entryUrl: url }
}

test('IPC sender must be the active main window, exact main frame, and exact entry URL', () => {
  const fixture = trustedFixture()
  assert.equal(assertTrustedMainFrame(fixture.event, fixture), fixture.mainWindow)
  assert.equal(isExactTrustedEntryUrl('http://127.0.0.1:5174/', fixture.entryUrl), true)
  assert.equal(isExactTrustedEntryUrl('http://127.0.0.1:5174/tools', fixture.entryUrl), false)
  assert.equal(isExactTrustedEntryUrl('http://localhost:5174/', fixture.entryUrl), false)

  assert.throws(() => assertTrustedMainFrame(
    { ...fixture.event, sender: { ...fixture.event.sender, id: 42 } },
    fixture,
  ), /active THEIA renderer/)
  assert.throws(() => assertTrustedMainFrame(
    { ...fixture.event, senderFrame: { processId: 7, routingId: 12, url: fixture.entryUrl } },
    fixture,
  ), /main frame/)
  assert.throws(() => assertTrustedMainFrame(
    { ...fixture.event, senderFrame: { ...fixture.event.senderFrame, url: 'http://127.0.0.1:5174/tools' } },
    fixture,
  ), /URL is not trusted/)
})

test('trusted IPC rejects unregistered channels, invalid schemas, and oversized payloads before dispatch', async () => {
  const handlers = new Map()
  const denied = []
  const fixture = trustedFixture()
  const ipc = createTrustedIpc({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler),
      on: () => {},
    },
    getMainWindow: () => fixture.mainWindow,
    getEntryUrl: () => fixture.entryUrl,
    onDenied: (entry) => denied.push(entry),
  })
  assert.throws(() => ipc.handle('theia:unknown', () => true), /no registered input schema/)

  let called = false
  ipc.handle('theia:appearance-presets:save', () => { called = true })
  assert.throws(() => handlers.get('theia:appearance-presets:save')(
    fixture.event,
    Array.from({ length: 17 }, (_, index) => ({ id: String(index) })),
  ), /at most 16/)
  assert.equal(called, false)
  assert.equal(denied.at(-1).channel, 'theia:appearance-presets:save')

  assert.throws(() => validateIpcArguments('theia:save-model-config', [{
    baseUrl: 'https://model.example/v1',
    model: 'model-a',
    apiKey: 'key',
    probeId: 'probe',
    unexpected: true,
  }]), /unknown field unexpected/)
  assert.throws(() => validateIpcArguments('theia:open-source', ['x'.repeat(MAX_IPC_ARGUMENT_BYTES + 1)]), /too long|byte limit/)
  assert.doesNotThrow(() => validateIpcArguments('theia:open-assignment-source', ['assignment-123']))
  assert.throws(() => validateIpcArguments('theia:open-assignment-source', ['']), /non-empty string/)
  assert.doesNotThrow(() => validateIpcArguments('theia:open-data-directory', []))
  assert.throws(() => validateIpcArguments('theia:open-data-directory', ['C:\\']), /expected 0 arguments/)
  assert.doesNotThrow(() => validateIpcArguments('theia:read-saved-secret', ['unified-password']))
  assert.throws(() => validateIpcArguments('theia:read-saved-secret', ['C:\\secrets.json']), /kind is invalid/)
  assert.throws(() => validateIpcArguments('theia:read-saved-secret', []), /expected 1 arguments/)
  assert.doesNotThrow(() => validateIpcArguments('theia:sync-domain', ['academic-progress']))
  assert.throws(() => validateIpcArguments('theia:sync-domain', ['https://example.com/']), /sync domain is invalid/)
  assert.throws(() => validateIpcArguments('theia:sync-domain', ['C:\\secrets.json']), /sync domain is invalid/)
})

test('every registered theia IPC channel has a runtime schema', async () => {
  const source = await readFile(new URL('../electron/main.mjs', import.meta.url), 'utf8')
  const channels = [...source.matchAll(/ipcMain\.(?:handle|on)\(\s*['"](theia:[^'"]+)['"]/g)].map((match) => match[1])
  assert.ok(channels.length > 50)
  assert.deepEqual(channels.filter((channel) => !THEIA_IPC_SCHEMAS.has(channel)), [])
})
