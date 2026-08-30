import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/views/CampusMapView.tsx', import.meta.url), 'utf8')

test('campus map handles wheel zoom with one non-passive native listener', () => {
  assert.match(source, /addEventListener\("wheel", zoomWithWheel, \{ passive: false \}\)/)
  assert.match(source, /const zoomWithWheel = \(event: WheelEvent\) => \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*zoomByRef\.current/s)
  assert.doesNotMatch(source, /onWheel(?:Capture)?=/)
})

test('campus map exposes indoor buildings and manual floor switching', () => {
  assert.match(source, /查看第一教学楼/)
  assert.match(source, /查看第二教学楼/)
  assert.match(source, /楼层切换/)
  assert.match(source, /Windows 端关闭/)
})

test('campus map has no navigation or marking UI', () => {
  assert.doesNotMatch(source, /setNavTo|markingCandidate|map-nav|宿舍|findPathBetweenAreas|buildingEdgePoints/)
})
