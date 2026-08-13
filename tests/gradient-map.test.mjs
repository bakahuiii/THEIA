import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { transformWithEsbuild } from 'vite'

async function loadGradientMap() {
  const source = await readFile(new URL('../src/lib/gradient-map.ts', import.meta.url), 'utf8')
  const transformed = await transformWithEsbuild(source, 'gradient-map.ts', {
    format: 'esm',
    loader: 'ts',
    target: 'es2022',
  })
  return import(
    `data:text/javascript;base64,${Buffer.from(transformed.code).toString('base64')}`
  )
}

const gradientMap = await loadGradientMap()

function hexChannels(value) {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ]
}

function luminance(value) {
  const [red, green, blue] = hexChannels(value).map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return red * 0.2126 + green * 0.7152 + blue * 0.0722
}

function contrast(first, second) {
  const light = Math.max(luminance(first), luminance(second))
  const dark = Math.min(luminance(first), luminance(second))
  return (light + 0.05) / (dark + 0.05)
}

function channelSpread(value) {
  const channels = hexChannels(value)
  return Math.max(...channels) - Math.min(...channels)
}

test('gold and black endpoints create neutral application surfaces', () => {
  const endpoints = { shadow: '#0b0c10', highlight: '#d7b34d' }
  const light = gradientMap.deriveGradientPalette(endpoints, 'light').variables
  const dark = gradientMap.deriveGradientPalette(endpoints, 'dark').variables

  for (const palette of [light, dark]) {
    assert.ok(channelSpread(palette['--background']) <= 3)
    assert.ok(channelSpread(palette['--card']) <= 3)
    assert.ok(contrast(palette['--foreground'], palette['--card']) >= 7)
    assert.ok(contrast(palette['--primary'], palette['--background']) >= 4.5)
    assert.notEqual(palette['--primary'], endpoints.shadow)
    assert.notEqual(palette['--primary'], endpoints.highlight)
    assert.notEqual(palette['--info'], palette['--primary'])
  }
})

test('gradient map endpoints can compress the mapped luminance range', () => {
  const stops = gradientMap.normalizeGradientStops(35, 75)
  assert.deepEqual(stops, { shadowPosition: 35, highlightPosition: 75 })

  const table = gradientMap.gradientMapTableValues({
    shadow: '#111111',
    highlight: '#eeeeee',
    ...stops,
  }, 5)
  const red = table.red.split(' ').map(Number)
  assert.equal(red[0], red[1])
  assert.ok(red[2] > red[1] && red[2] < red[3])
  assert.equal(red[3], red[4])
})
