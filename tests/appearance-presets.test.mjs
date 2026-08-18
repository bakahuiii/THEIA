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

test('appearance transparency remains authoritative for every glass layer', async () => {
  const source = await readFile(new URL('../src/hooks/usePersonalization.ts', import.meta.url), 'utf8')
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

  assert.match(source, /const surfaceOpacity = workspaceOpacity/)
  assert.match(source, /const surfaceStrongOpacity = workspaceOpacity/)
  assert.match(source, /const controlOpacity = workspaceOpacity/)
  assert.doesNotMatch(source, /Math\.max\(88, workspaceOpacity\)/)
  assert.doesNotMatch(source, /Math\.max\(94, workspaceOpacity\)/)
  assert.doesNotMatch(source, /Math\.max\(92, workspaceOpacity\)/)
  assert.match(styles, /--theia-background-workspace-opacity:\s*58%/)
  assert.match(styles, /--theia-background-surface-opacity:\s*58%/)
  assert.match(styles, /--theia-background-control-opacity:\s*58%/)
})

test('non-advisor surfaces share one contract while the advisor stays isolated', async () => {
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

  assert.match(styles, /\.app-shell:not\(\.view-advisor\)\s*\{\s*--theia-global-surface/)
  assert.match(styles, /\.academic-records-sidebar,\s*\.academic-records-panel/)
  assert.match(styles, /\.settings-modal-nav\s*\{\s*background:\s*var\(--sidebar\)/)
  assert.match(styles, /html\[data-app-background="image"\] \.settings-dialog-main/)
  assert.match(styles, /\.app-shell:not\(\.view-advisor\) \.course-slot\s*\{\s*border-left-color:\s*var\(--course-accent\)/)
  assert.doesNotMatch(styles, /\.app-shell:not\(\.view-advisor\)[^{]*\.advisor-workbench-v2/)
})

test('new installs use the approved animated scene defaults and keep chrome text unselectable', async () => {
  const personalization = await readFile(new URL('../src/hooks/usePersonalization.ts', import.meta.url), 'utf8')
  const tuning = await readFile(new URL('../src/components/parallax3d/parallax-tuning.ts', import.meta.url), 'utf8')
  const scene = await readFile(new URL('../src/components/parallax3d/ParallaxScene.tsx', import.meta.url), 'utf8')
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
  const advisorStyles = await readFile(new URL('../src/components/advisor/AdvisorWorkbench.v2.css', import.meta.url), 'utf8')

  assert.match(personalization, /const defaults: Personalization = \{[\s\S]*scene: "parallax-3d"[\s\S]*background: "none"/)
  assert.match(personalization, /ANIMATED_DEFAULTS_MIGRATION_KEY/)
  assert.match(personalization, /saved as LegacyPersonalization\)\.scene !== "parallax-3d"/)
  assert.match(personalization, /preferences = normalize\(\{[\s\S]*scene: "parallax-3d"/)
  assert.match(tuning, /orbitX: 0\.43[\s\S]*orbitY: 0\.34[\s\S]*depthScale: 1\.4/)
  assert.match(tuning, /laplaceSpeed: 0\.61[\s\S]*laplaceTailFrequency: 0\.64/)
  assert.match(scene, /const DEFAULT_TUNING:[\s\S]*spectralAberration: 0\.85[\s\S]*spectralGlitch: 0\.09/)
  assert.match(styles, /html \{[^}]*user-select: none/)
  assert.match(styles, /input, textarea, \[contenteditable="true"\] \{ user-select: text/)
  assert.match(advisorStyles, /\.advisor-v2-conversation \{[\s\S]*user-select: text/)
})

test('private animated preset uses its artwork and keeps tuning controls hidden', async () => {
  const presets = await readFile(new URL('../src/lib/appearance-presets.ts', import.meta.url), 'utf8')
  const settings = await readFile(new URL('../src/views/settings/AppearanceSettings.tsx', import.meta.url), 'utf8')
  const menu = await readFile(new URL('../src/components/ThemeMenu.tsx', import.meta.url), 'utf8')
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
  const image = await readFile(new URL('../src/assets/bakahui-private-goods.jpg', import.meta.url))

  assert.match(presets, /label: "bakahui的私货"/)
  assert.match(presets, /detail: "不可解"/)
  assert.match(presets, /bakahui-private-goods\.jpg/)
  assert.ok(image.length > 100_000)
  assert.match(settings, /<section\s+hidden\s+className=\{`appearance-parallax-tuning/)
  assert.match(settings, /has-preview-image/)
  assert.match(menu, /appearance-menu-preset-swatch\$\{preset\.previewImage \? " has-preview-image"/)
  assert.match(styles, /\.appearance-visual-preset-swatch\.has-preview-image/)
  assert.match(styles, /\.appearance-menu-preset-swatch\.has-preview-image/)
  assert.match(styles, /\.appearance-parallax-tuning\[hidden\] \{ display: none !important; \}/)
})
