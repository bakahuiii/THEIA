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

test('campus map supports building marking mode', () => {
  assert.match(source, /标注建筑位置/)
  assert.match(source, /setMarkingMode/)
  assert.match(source, /readBuildingMarks/)
  assert.match(source, /writeBuildingMarks/)
  assert.match(source, /map-marker-selector/)
})

test('campus map renders building markers and route overlay', () => {
  assert.match(source, /map-building-marker/)
  assert.match(source, /map-route-overlay/)
  assert.match(source, /findPath/)
  assert.match(source, /smoothPath/)
  assert.match(source, /routeDistance/)
})

test('campus map listens for cross-view navigation requests', () => {
  assert.match(source, /listenCampusNavigation/)
  assert.match(source, /pendingNav/)
  assert.match(source, /setNavTo/)
})
