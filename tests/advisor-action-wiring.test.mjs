import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [hookSource, preloadSource, mainSource] = await Promise.all([
  readFile(new URL('../src/hooks/useTheiaApp.ts', import.meta.url), 'utf8'),
  readFile(new URL('../electron/preload.cjs', import.meta.url), 'utf8'),
  readFile(new URL('../electron/main.mjs', import.meta.url), 'utf8'),
])

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`)
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`)
  return source.slice(start, end)
}

test('advisor assignment actions send only an opaque action bound to the rendered revision', () => {
  const actionHandler = sourceBetween(
    hookSource,
    'const executeAdvisorAction = async',
    'const exportSchedulePdf = async',
  )

  assert.match(actionHandler, /bridge\.executeAdvisorAction\(\{\s*snapshotRevision: advisorOverview\.snapshotRevision,\s*actionId: item\.id,\s*\}\)/)
  assert.doesNotMatch(actionHandler, /openAssignmentSource\s*\(\s*item\.entityId/)
  assert.doesNotMatch(actionHandler, /assignmentId\s*:|sourceUrl|\burl\s*:/)
})

test('preload forwards one advisor request object without expanding its authority', () => {
  assert.match(
    preloadSource,
    /executeAdvisorAction: \(request\) => ipcRenderer\.invoke\('theia:advisor:execute-action', request\)/,
  )
  assert.doesNotMatch(preloadSource, /executeAdvisorAction: \([^)]*(?:assignmentId|url)/)
})

test('main resolves the advisor action from the current store before opening a private target', () => {
  const handler = sourceBetween(
    mainSource,
    "ipcMain.handle('theia:advisor:execute-action'",
    "ipcMain.handle('theia:get-activity-log'",
  )

  assert.match(handler, /resolveAdvisorActionFromStore\(store, request\)/)
  assert.match(handler, /const assertCurrentSnapshot = \(\) => assertAdvisorSnapshotRevision\(store, resolution\.snapshotRevision\)/)
  assert.match(handler, /await schoolProxyReady\.catch\(\(\) => undefined\)\s*assertAuthEpoch\(epoch\)\s*assertCurrentSnapshot\(\)/)
  assert.match(handler, /openCourseWorkWindow\(entry, epoch, assertCurrentSnapshot\)/)
  assert.match(handler, /error\?\.code === ADVISOR_ACTION_ERROR\.STALE_SNAPSHOT[\s\S]*?advisorActionFailure\(code, resolution\.actionId\)/)
  assert.doesNotMatch(handler, /request\.(?:assignmentId|url)|request\[['"](?:assignmentId|url)['"]\]/)
})

test('advisor assignment navigation rechecks its snapshot after waits and before every THEOL navigation', () => {
  const openCourseWork = sourceBetween(
    mainSource,
    'async function openCourseWorkWindow(',
    'async function attachFileToSourceWindow(',
  )
  const actorLifecycle = sourceBetween(
    mainSource,
    'async function runTheolInteractiveActor(',
    'async function finishTheolInteractiveActor(',
  )

  assert.match(openCourseWork, /await syncService\.waitForAssignmentScan\(\)\s*assertAuthEpoch\(epoch\)\s*assertSnapshot\(\)/)
  assert.match(openCourseWork, /status = await verifiedStatus\(source\)\s*assertAuthEpoch\(epoch\)\s*assertSnapshot\(\)/)
  assert.match(openCourseWork, /await openLoginWindow\([\s\S]*?assertAuthEpoch\(epoch\)\s*assertSnapshot\(\)/)
  assert.match(openCourseWork, /await rememberVerifiedSession\([\s\S]*?assertAuthEpoch\(epoch\)\s*assertSnapshot\(\)/)
  assert.match(openCourseWork, /assertSnapshot\(\)\s*const window = await openTheolInteractiveWindow\(/)
  assert.match(openCourseWork, /assertCurrentSnapshot: assertSnapshot/)

  assert.match(actorLifecycle, /await syncService\.waitForAssignmentScan\(\)[\s\S]*?actor\.assertCurrentSnapshot\?\.\(\)/)
  assert.match(actorLifecycle, /for \(const \[index, url\] of actor\.navigationUrls\.entries\(\)\) \{\s*actor\.assertCurrentSnapshot\?\.\(\)\s*await window\.loadURL\(url\)\s*actor\.assertCurrentSnapshot\?\.\(\)/)
  assert.match(actorLifecycle, /await validateTheolNavigationStep\(window, check\)\s*actor\.assertCurrentSnapshot\?\.\(\)/)
})

test('advisor overview refresh accepts only the latest in-flight request', () => {
  const refresh = sourceBetween(
    hookSource,
    'const refreshAdvisorOverview = useCallback',
    'const refreshActivityLog = useCallback',
  )

  assert.match(refresh, /const requestSequence = \+\+advisorOverviewRequestSequence\.current/)
  assert.match(refresh, /requestSequence !== advisorOverviewRequestSequence\.current/)
  assert.match(refresh, /requestSequence === advisorOverviewRequestSequence\.current/)
  assert.match(refresh, /setAdvisorOverview\(null\)/)
})

test('renderer snapshots invalidate advisor actions and keep the hook free of an unused overview projection', () => {
  const apply = sourceBetween(
    hookSource,
    'const applyRendererSnapshot = useCallback',
    'const refreshAdvisorOverview = useCallback',
  )

  assert.match(apply, /advisorOverviewRequestSequence\.current \+= 1/)
  assert.match(apply, /setAdvisorOverview\(null\)/)
  assert.doesNotMatch(hookSource, /userDataOverview/)
  assert.doesNotMatch(hookSource, /refreshUserDataOverview/)
})
