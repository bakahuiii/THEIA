import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('school-wide schedule exposes teaching-class and combined-class columns', async () => {
  const source = await readFile(new URL('../src/views/CourseSelectionView.tsx', import.meta.url), 'utf8')
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

  assert.match(source, /key: "className", label: "教学班名称"/)
  assert.match(source, /key: "combinedClassInfo", label: "合班信息"/)
  assert.match(source, /item\.className, item\.combinedClassInfo/)
  assert.match(source, /title=\{item\.combinedClassInfo \|\| undefined\}/)
  assert.match(styles, /\.school-schedule-clamped-cell > span/)
  assert.match(styles, /-webkit-line-clamp: 2/)
})

test('school-wide schedule refresh keeps cached data visible and reports failures in-page', async () => {
  const view = await readFile(new URL('../src/views/CourseSelectionView.tsx', import.meta.url), 'utf8')
  const appHook = await readFile(new URL('../src/hooks/useTheiaApp.ts', import.meta.url), 'utf8')
  const types = await readFile(new URL('../src/types.ts', import.meta.url), 'utf8')

  assert.match(types, /forceRefresh\?: boolean/)
  assert.match(types, /fromCache\?: boolean/)
  assert.match(view, /forceRefresh: true/)
  assert.match(view, /本地数据，更新于/)
  assert.match(view, /更新失败，正在显示上次数据/)
  assert.match(view, /<Dialog open=\{Boolean\(schoolScheduleError\)\}/)
  assert.match(appHook, /const text = sanitizeSyncFailure\(error\)[\s\S]*setSchoolScheduleError\(text\)/)
  assert.doesNotMatch(appHook, /catch \(error\) \{\s*setSchoolSchedule\(null\)/)
})

test('school-wide schedule failure dialog owns an overlay above ordinary dialogs', async () => {
  const view = await readFile(new URL('../src/views/CourseSelectionView.tsx', import.meta.url), 'utf8')
  const dialog = await readFile(new URL('../src/components/ui/dialog.tsx', import.meta.url), 'utf8')
  const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

  assert.match(view, /className="school-schedule-error-dialog" overlayClassName="sync-error-dialog-overlay"/)
  assert.match(dialog, /overlayClassName\?: string/)
  assert.match(dialog, /<DialogOverlay className=\{overlayClassName\} \/>/)

  const ordinaryOverlayRule = styles.match(/\[data-slot="dialog-overlay"\]\s*\{[^}]*\}/)?.[0]
  const errorOverlayRule = styles.match(/\.sync-error-dialog-overlay\s*\{[^}]*\}/)?.[0]
  const errorDialogRule = styles.match(/\.sync-error-dialog,\s*\.school-schedule-error-dialog\s*\{[^}]*\}/)?.[0]
  assert.ok(ordinaryOverlayRule, 'ordinary dialog overlay must declare its layer')
  assert.ok(errorOverlayRule, 'sync error overlay must declare its own layer')
  assert.ok(errorDialogRule, 'school schedule error dialog must declare its layer')

  const zIndex = (rule) => Number(rule.match(/z-index:\s*(\d+)/)?.[1])
  const ordinaryOverlayZ = zIndex(ordinaryOverlayRule)
  const errorOverlayZ = zIndex(errorOverlayRule)
  const errorDialogZ = zIndex(errorDialogRule)
  assert.ok(Number.isFinite(ordinaryOverlayZ))
  assert.ok(Number.isFinite(errorOverlayZ))
  assert.ok(Number.isFinite(errorDialogZ))
  assert.ok(ordinaryOverlayZ < errorOverlayZ, 'error overlay must cover an already-open ordinary dialog')
  assert.ok(errorOverlayZ < errorDialogZ, 'error dialog must remain above its overlay')
})
