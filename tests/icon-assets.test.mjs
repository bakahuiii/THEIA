import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const projectRoot = new URL('../', import.meta.url)

async function readAsset(path) {
  return readFile(new URL(path, projectRoot))
}

function icoSizes(buffer) {
  assert.equal(buffer.readUInt16LE(0), 0, 'ICO reserved field')
  assert.equal(buffer.readUInt16LE(2), 1, 'ICO type field')
  const count = buffer.readUInt16LE(4)
  return Array.from({ length: count }, (_, index) => {
    const offset = 6 + index * 16
    const width = buffer[offset] || 256
    const height = buffer[offset + 1] || 256
    return `${width}x${height}`
  })
}

test('all THEIA icon entry points use the same multi-resolution asset', async () => {
  const [rendererPng, buildPng, buildIco, electronIco] = await Promise.all([
    readAsset('src/assets/theia-mark.png'),
    readAsset('build/theia-icon.png'),
    readAsset('build/theia-icon.ico'),
    readAsset('electron/theia-icon.ico'),
  ])

  assert.deepEqual(rendererPng, buildPng)
  assert.deepEqual(buildIco, electronIco)
  assert.deepEqual(icoSizes(buildIco), [
    '16x16',
    '20x20',
    '24x24',
    '32x32',
    '40x40',
    '48x48',
    '64x64',
    '96x96',
    '128x128',
    '256x256',
  ])
})
