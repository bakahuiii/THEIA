import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { BACKGROUND_PROTOCOL, createAppearanceService } from '../electron/appearance-service.mjs'

test('appearance service writes bounded presets and reads local background assets', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-appearance-service-'))
  try {
    const diagnostics = []
    const service = createAppearanceService({ root, onDiagnostic: (event) => diagnostics.push(event) })
    const record = await service.writePresets(Array.from({ length: 20 }, (_, index) => ({ id: index })))
    assert.equal(record.presets.length, 16)
    assert.equal((await service.readPresets()).presets.length, 16)
    await writeFile(resolve(service.backgroundDirectory, 'sample.png'), Buffer.from('PNG'))
    const response = await service.handleBackgroundAsset({ url: `${BACKGROUND_PROTOCOL}://local/sample.png` })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/png')
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), 'PNG')
    assert.deepEqual(diagnostics, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('appearance service rejects traversal and encoded separators', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-appearance-service-policy-'))
  try {
    const service = createAppearanceService({ root })
    assert.throws(() => service.backgroundPath('../secret.png'), /Invalid appearance background filename/)
    assert.equal((await service.handleBackgroundAsset({ url: `${BACKGROUND_PROTOCOL}://local/%2e%2e%2Fsecret.png` })).status, 404)
    assert.equal((await service.handleBackgroundAsset({ url: 'https://local/sample.png' })).status, 404)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('appearance service reports malformed preset files and keeps an empty fallback', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-appearance-service-invalid-'))
  try {
    const diagnostics = []
    const service = createAppearanceService({ root, onDiagnostic: (event) => diagnostics.push(event) })
    await mkdir(service.backgroundDirectory, { recursive: true })
    await writeFile(resolve(service.backgroundDirectory, 'presets.json'), '{not-json', 'utf8')
    assert.deepEqual(await service.readPresets(), { exists: false, updatedAt: null, presets: [] })
    assert.deepEqual(diagnostics, ['appearance.presets_read_failed'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
