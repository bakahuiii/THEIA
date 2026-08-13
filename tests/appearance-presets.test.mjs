import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const variants = [
  ['buct-lake', 'buctLakePreset'],
  ['buct-lake-spring', 'buctLakeSpringPreset'],
  ['buct-lake-summer', 'buctLakeSummerPreset'],
  ['buct-lake-autumn', 'buctLakeAutumnPreset'],
  ['buct-lake-winter', 'buctLakeWinterPreset'],
]

test('built-in lake background names come from their preset details', async () => {
  const source = await readFile(new URL('../src/hooks/usePersonalization.ts', import.meta.url), 'utf8')

  for (const [id, variable] of variants) {
    const preset = JSON.parse(await readFile(new URL(`../src/assets/appearance-presets/${id}.json`, import.meta.url), 'utf8'))
    assert.equal(typeof preset.detail, 'string')
    assert.ok(preset.detail.trim(), `${id} needs a visible detail`)
    assert.match(source, new RegExp(`name:\\s*${variable}\\.detail`), id)
  }

  const autumn = JSON.parse(await readFile(new URL('../src/assets/appearance-presets/buct-lake-autumn.json', import.meta.url), 'utf8'))
  assert.equal(autumn.detail, '窥日畏衔山')
  assert.doesNotMatch(source, /北化镜湖(?:春|夏|秋|冬)?/)
})
