import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/views/CampusMapView.tsx', import.meta.url), 'utf8')

test('campus map handles wheel zoom with one non-passive native listener', () => {
  assert.match(source, /addEventListener\("wheel", zoomWithWheel, \{ passive: false \}\)/)
  assert.match(source, /const zoomWithWheel = \(event: WheelEvent\) => \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*zoomByRef\.current/s)
  assert.doesNotMatch(source, /onWheel(?:Capture)?=/)
})
