import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { transformWithEsbuild } from 'vite'

async function loadSolarSeason() {
  const source = await readFile(new URL('../src/lib/solar-season.ts', import.meta.url), 'utf8')
  const transformed = await transformWithEsbuild(source, 'solar-season.ts', {
    format: 'esm', loader: 'ts', target: 'es2022',
  })
  return import(`data:text/javascript;base64,${Buffer.from(transformed.code).toString('base64')}`)
}

const solar = await loadSolarSeason()
const chinaDate = (date) => new Date(`${date}T12:00:00+08:00`)

test('seasonal background changes on the four Li solar terms', () => {
  assert.equal(solar.solarSeason(chinaDate('2026-02-03')), 'winter')
  assert.equal(solar.solarSeason(chinaDate('2026-02-04')), 'spring')
  assert.equal(solar.solarSeason(chinaDate('2026-05-04')), 'spring')
  assert.equal(solar.solarSeason(chinaDate('2026-05-05')), 'summer')
  assert.equal(solar.solarSeason(chinaDate('2026-08-06')), 'summer')
  assert.equal(solar.solarSeason(chinaDate('2026-08-07')), 'autumn')
  assert.equal(solar.solarSeason(chinaDate('2026-11-06')), 'autumn')
  assert.equal(solar.solarSeason(chinaDate('2026-11-07')), 'winter')
})

test('2026 solar-term boundaries match the campus-calendar seasons', () => {
  assert.deepEqual(solar.currentYearBoundaries(2026), {
    spring: 204, summer: 505, autumn: 807, winter: 1107,
  })
})
