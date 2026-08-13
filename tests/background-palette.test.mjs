import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { transformWithEsbuild } from 'vite'

async function loadBackgroundPalette() {
  const source = await readFile(new URL('../src/lib/background-palette.ts', import.meta.url), 'utf8')
  const transformed = await transformWithEsbuild(source, 'background-palette.ts', {
    format: 'esm',
    loader: 'ts',
    target: 'es2022',
  })
  return import(`data:text/javascript;base64,${Buffer.from(transformed.code).toString('base64')}`)
}

const palette = await loadBackgroundPalette()

function solidPixels(colors) {
  const pixels = []
  for (const [red, green, blue, count] of colors) {
    for (let index = 0; index < count; index += 1) pixels.push(red, green, blue, 255)
  }
  return new Uint8ClampedArray(pixels)
}

test('background palette favors the photograph chroma over neutral pixels', () => {
  const pixels = solidPixels([
    [27, 99, 115, 220],
    [186, 133, 56, 80],
    [214, 216, 218, 900],
  ])
  const result = palette.extractBackgroundPalette(pixels, 1200, 1)
  assert.match(result.shadow, /^#[0-9a-f]{6}$/)
  assert.match(result.highlight, /^#[0-9a-f]{6}$/)
  assert.notEqual(result.shadow, '#2869a8')
  assert.notEqual(result.highlight, '#f2f8ff')
})

test('background palette has a valid default for transparent image data', () => {
  const result = palette.extractBackgroundPalette(new Uint8ClampedArray([0, 0, 0, 0]), 1, 1)
  assert.deepEqual(result, { shadow: '#2869a8', highlight: '#f2f8ff' })
})
