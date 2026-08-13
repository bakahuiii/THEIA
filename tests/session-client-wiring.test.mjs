import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const mainSource = await readFile(new URL('../electron/main.mjs', import.meta.url), 'utf8')

function sourceBetween(start, end) {
  const startIndex = mainSource.indexOf(start)
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`)
  const endIndex = mainSource.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`)
  return mainSource.slice(startIndex, endIndex)
}

test('JWGLXT bypasses the rendered THEOL page queue while sharing its browser cookies', () => {
  assert.match(
    mainSource,
    /academicSessionClient = new SessionClient\(schoolSession, \{\s*onDiagnostic:/s,
  )
  assert.doesNotMatch(
    mainSource.match(/academicSessionClient = new SessionClient\(schoolSession, \{([\s\S]*?)\n  \}\)/)?.[1] || '',
    /pageLoader|formLoader/,
  )
  assert.match(mainSource, /browserAdapter: new JwglxtAdapter\(academicSessionClient\)/)
  assert.match(mainSource, /theol: new TheolAdapter\(sessionClient\)/)
  assert.match(
    mainSource,
    /sessionClient = new SessionClient\(schoolSession, \{\s*pageLoader: smokeFile \? null : loadSchoolPage,\s*formLoader: smokeFile \? null : submitSchoolForm,/s,
  )
  const sourceStatus = sourceBetween('function sourceStatus(source) {', '\n\nfunction cachedStatus(source) {')
  assert.match(sourceStatus, /const epoch = authEpoch/)
  assert.match(
    sourceStatus,
    /assertAuthEpoch\(epoch\)\s*return source === 'theol'\s*\? syncService\.runTheolExclusive\(\(\) => \{\s*assertAuthEpoch\(epoch\)\s*return adapter\.status\(\)\s*\}\)\s*: adapter\.status\(\)/s,
  )
})

test('authentication uses source-scoped single-flight actors instead of a shared login queue', () => {
  assert.match(mainSource, /const authActors = new Map\(\)/)
  assert.match(mainSource, /const current = authActors\.get\(source\)[\s\S]*?return current[\s\S]*?return createAuthActor\(source, \{ background \}\)/)
  assert.match(mainSource, /const actors = requestedSources\.map\(\(source\) => \{[\s\S]*?await Promise\.all\(actors\.map\(\(actor\) => actor\.opened\)\)/)
  assert.doesNotMatch(mainSource, /\blet loginWindow\b|\blet loginTarget\b|\blet loginQueue\b|\blet authPoll\b/)
})

test('THEOL login owns its exclusive lease for the complete actor lifecycle', () => {
  const actorLifecycle = mainSource.match(/async function runAuthActor\(actor\) \{[\s\S]*?\n\}/)?.[0] || ''
  const createActor = mainSource.match(/function createAuthActor\(source,[\s\S]*?\nasync function openLoginWindow/)?.[0] || ''
  assert.match(actorLifecycle, /actor\.resumeAssignments = syncService\.pauseAssignmentScan\(\)\s*await syncService\.waitForAssignmentScan\(\)/s)
  assert.match(actorLifecycle, /if \(actor\.source === 'theol'\) await syncService\.runTheolExclusive\(runLifecycle\)\s*else await runLifecycle\(\)/s)
  assert.match(actorLifecycle, /await actor\.closed/)
  assert.doesNotMatch(actorLifecycle, /syncNow/)
  assert.match(mainSource, /createSourceWindow\(request\.url, request\.title, \{ pauseAssignments: source === 'theol' \}\)/)
  assert.match(actorLifecycle, /guardSourceWindow\(window, \{\s*source: actor\.source,\s*theolActor: actor\.source === 'theol' \? actor : null,\s*theolLease: actor\.source === 'theol',\s*\}\)/s)
  assert.match(actorLifecycle, /if \(actor\.source !== 'theol'\) actor\.resolveClosed\(\)/)
  assert.match(createActor, /windows: new Set\(\)/)
})

test('manual THEOL windows share one exclusive interactive actor for the full window tree', () => {
  const actorLifecycle = mainSource.match(/async function runTheolInteractiveActor\(actor\) \{[\s\S]*?\n\}/)?.[0] || ''
  const guardWindow = mainSource.match(/function guardSourceWindow\(window,[\s\S]*?\nasync function createSourceWindow/)?.[0] || ''
  assert.match(mainSource, /let theolInteractiveActor = null/)
  assert.match(actorLifecycle, /actor\.resumeAssignments = syncService\.pauseAssignmentScan\(\)\s*await syncService\.waitForAssignmentScan\(\)/s)
  assert.match(actorLifecycle, /await syncService\.runTheolExclusive\(async \(\) => \{[\s\S]*?await actor\.closed/s)
  assert.match(actorLifecycle, /theolActor: actor[\s\S]*?theolLease: true/s)
  assert.match(actorLifecycle, /if \(actor\.windows\.size\) await actor\.closed/)
  assert.match(guardWindow, /theolActor\.windows\.add\(window\)/)
  assert.match(guardWindow, /interactiveActor\.windows\.delete\(window\)\s*if \(!interactiveActor\.windows\.size\) interactiveActor\.resolveClosed\(\)/s)
  assert.match(guardWindow, /theolActor: interactiveActor[\s\S]*?theolLease: Boolean\(window\.__theiaTheolLease\)/s)
  assert.match(guardWindow, /if \(window === syncPageWindow \|\| window === fitnessPageWindow\) \{[\s\S]*?return \{ action: 'deny' \}/s)
  assert.match(guardWindow, /if \(window\.__theiaTheolInteractiveActor\?\.invalidated\) return \{ action: 'deny' \}/)
  assert.match(guardWindow, /if \(theolActor\?\.invalidated\) void closeWindowAndWait\(window\)/)
  assert.match(mainSource, /if \(source === 'theol'\) return openTheolInteractiveWindow\(url, title\)/)
})

test('manual THEOL actor reuses only an identical target and synchronizes once after release', () => {
  const openInteraction = sourceBetween('async function openTheolInteractiveWindow(', '\n\nfunction guardSourceWindow(')
  const finishInteraction = mainSource.match(/async function finishTheolInteractiveActor\(actor\) \{[\s\S]*?\n\}/)?.[0] || ''
  assert.match(openInteraction, /if \(current\.interactionKey !== interactionKey\) \{\s*throw new Error\(/s)
  assert.match(openInteraction, /await current\.opened[\s\S]*?assertAuthEpoch\(epoch\)[\s\S]*?const reused = focusTheolInteractiveWindow\(current\)/)
  assert.match(finishInteraction, /if \(theolInteractiveActor === actor\) theolInteractiveActor = null/)
  assert.match(finishInteraction, /actor\.resumeAssignments\?\.\(\{ schedule: false \}\)/)
  assert.match(finishInteraction, /if \(actor\.invalidated \|\| actor\.epoch !== authEpoch \|\| explicitlyLoggedOut\) return/)
  assert.match(finishInteraction, /await syncService\.syncNow\(\{ sources: \['theol'\] \}\)/)
})

test('course-work navigation proves every final URL and DOM identity before the hidden window opens', () => {
  const actorLifecycle = sourceBetween('async function runTheolInteractiveActor(', '\n\nasync function finishTheolInteractiveActor(')
  const urlValidation = sourceBetween('function validateTheolNavigationUrl(', '\n\nasync function readTheolNavigationIdentity(')
  const domValidation = sourceBetween('async function readTheolNavigationIdentity(', '\n\nasync function runTheolInteractiveActor(')
  const courseWork = sourceBetween('async function openCourseWorkWindow(', '\n\nasync function attachFileToSourceWindow(')

  assert.match(actorLifecycle, /new BrowserWindow\(sourceWindowOptions\(\{ title: actor\.title, show: false \}\)\)/)
  assert.match(actorLifecycle, /for \(const \[index, url\] of actor\.navigationUrls\.entries\(\)\)[\s\S]*?await window\.loadURL\(url\)[\s\S]*?await validateTheolNavigationStep\(window, check\)[\s\S]*?actor\.validated = true\s*actor\.resolveOpened\(window\)/s)
  assert.match(actorLifecycle, /catch \(error\)[\s\S]*?actor\.rejectOpened\(error\)[\s\S]*?Promise\.all\(\[\.\.\.actor\.windows\]\.map/s)
  assert.match(mainSource, /if \(window\.__theiaTheolInteractiveActor\?\.validated === false\) return \{ action: 'deny' \}/)
  assert.match(urlValidation, /THEOL_INTERACTION_COURSE_PATHS\.has\(finalUrl\.pathname\.toLowerCase\(\)\)[\s\S]*?courseIds\[0\] !== check\.courseId/s)
  assert.match(urlValidation, /finalUrl\.pathname\.toLowerCase\(\) !== taskType\.path[\s\S]*?taskIds\[0\] !== check\.taskId/s)
  assert.match(domValidation, /courseEvidence\.includes\(check\.courseId\)[\s\S]*?identity\.courseFields\.some/s)
  assert.match(domValidation, /taskFields[\s\S]*?taskUrls[\s\S]*?includes\(check\.taskId\)/s)
  assert.match(courseWork, /navigationChecks: \[[\s\S]*?type: 'course',[\s\S]*?courseId: assignment\.courseId[\s\S]*?type: 'task',[\s\S]*?kind: entry\.kind,[\s\S]*?uniqueTaskId: entry\.uniqueTaskId/s)
})

test('successful authentication releases its actor before source-scoped synchronization', () => {
  const finishActor = mainSource.match(/async function finishAuthActor\(actor\) \{[\s\S]*?\n\}/)?.[0] || ''
  assert.match(finishActor, /if \(authActors\.get\(actor\.source\) === actor\) authActors\.delete\(actor\.source\)/)
  assert.match(finishActor, /if \(actor\.source === 'theol'\) syncService\.enableAssignmentScan\(\{ schedule: false \}\)/)
  assert.match(finishActor, /await syncService\.syncNow\(\{ sources: \[actor\.source\] \}\)/)
  assert.match(finishActor, /await flushPendingSourceOpens\(actor\.source, actor\.epoch\)/)
  assert.match(mainSource, /async function flushPendingSourceOpens\(source, epoch = authEpoch\)[\s\S]*?request\.source === source[\s\S]*?if \(explicitlyLoggedOut \|\| epoch !== authEpoch\) return/)
})

test('authentication continuations are bound to their actor window and epoch', () => {
  const pollActor = mainSource.match(/async function pollAuthStatus\(actor\) \{[\s\S]*?\n\}/)?.[0] || ''
  assert.match(mainSource, /function isCurrentAuthActor\(actor, window = actor\?\.window\)[\s\S]*?actor\.epoch === authEpoch[\s\S]*?authActors\.get\(actor\.source\) === actor[\s\S]*?actor\.window === window/s)
  assert.match(mainSource, /await credentialVault\.readCredentials\(\)\s*if \(!isCurrentAuthActor\(actor, window\) \|\| actor\.epoch !== epoch\) return/s)
  assert.match(mainSource, /await frame\.executeJavaScript\(script\)\s*if \(!isCurrentAuthActor\(actor, window\) \|\| actor\.epoch !== epoch\) return/s)
  assert.match(mainSource, /await rememberVerifiedSession\(source, authenticatedUrl, epoch\)\s*if \(!isCurrentAuthActor\(actor, window\) \|\| actor\.epoch !== epoch\) return/s)
  assert.doesNotMatch(pollActor, /verifiedSessions\[source\]\s*=/)
})

test('authentication recovery remains scoped to each requesting platform', () => {
  const schedulePdf = sourceBetween('async function openSchedulePdf(', '\n\nasync function openCourseWorkWindow(')
  assert.match(schedulePdf, /openLoginWindow\(\{ sources: \['jwglxt'\], expectedEpoch: epoch \}\)/)
  assert.match(mainSource, /const authRecovery = Object\.fromEntries\(AUTH_SOURCES\.map\(\(source\) => \[source,/)
  assert.match(mainSource, /const eligibleSources = recoverySources\.filter\(\(source\) => \{[\s\S]*?const recovery = authRecovery\[source\]/)
  assert.match(mainSource, /openLoginWindow\(\{ background: true, sources: eligibleSources, expectedEpoch: epoch \}\)/)
})

test('verified session writes remain bound to the epoch that initiated each request', () => {
  const rememberSession = sourceBetween('async function rememberVerifiedSession(', '\n\nasync function verifiedStatus(')
  const schedulePdf = sourceBetween('async function openSchedulePdf(', '\n\nasync function openCourseWorkWindow(')
  const courseWork = sourceBetween('async function openCourseWorkWindow(', '\n\nasync function attachFileToSourceWindow(')
  const sourceWindow = sourceBetween('async function openSourceWindow(', '\n\nasync function autoFillSavedCredentials(')
  const pollActor = sourceBetween('async function pollAuthStatus(', '\n\nasync function sourceAlreadyAuthenticated(')
  const authActor = sourceBetween('async function runAuthActor(', '\n\nasync function finishAuthActor(')

  assert.match(
    rememberSession,
    /async function rememberVerifiedSession\(source, url, expectedEpoch\)[\s\S]*?const cookies = await schoolSession\.cookies\.get[\s\S]*?assertAuthEpoch\(expectedEpoch\)[\s\S]*?verifiedSessions\[source\] =/,
  )
  assert.match(schedulePdf, /rememberVerifiedSession\('jwglxt', status\.url \|\| JWGLXT_URLS\.schedule, epoch\)/)
  assert.match(courseWork, /rememberVerifiedSession\(source, status\.url \|\| entry\.courseSourceUrl, epoch\)/)
  assert.match(sourceWindow, /rememberVerifiedSession\(source, status\.url \|\| url, epoch\)/)
  assert.match(pollActor, /rememberVerifiedSession\(source, authenticatedUrl, epoch\)/)
  assert.match(authActor, /rememberVerifiedSession\(actor\.source, status\.url \|\| loginTargetDetails\(actor\.source\)\.url, actor\.epoch\)/)
})

test('explicit logout invalidates actors and closes browsers before clearing session storage', () => {
  const logoutHandler = mainSource.match(/ipcMain\.handle\('theia:logout',[\s\S]*?\n  ipcMain\.handle\('theia:sync-now'/)?.[0] || ''
  assert.match(logoutHandler, /explicitlyLoggedOut = true\s*syncService\.disable\(\)\s*authEpoch \+= 1/s)
  assert.match(logoutHandler, /statusChecks\.jwglxt = null\s*statusChecks\.theol = null/s)
  assert.match(logoutHandler, /const interactiveActor = theolInteractiveActor\s*theolInteractiveActor = null\s*if \(interactiveActor\) \{\s*interactiveActor\.invalidated = true/s)
  assert.match(logoutHandler, /interactiveActor\?\.resolveClosed\(\)[\s\S]*?interactiveActor\?\.lifecycle/s)
  assert.match(logoutHandler, /actor\.invalidated = true[\s\S]*?clearAuthActorTimers\(actor\)[\s\S]*?actor\.resolveOpened\(\)/)
  assert.match(logoutHandler, /await Promise\.all\(\[\.\.\.windows\]\.map\(\(window\) => closeWindowAndWait\(window\)\)\)[\s\S]*?await Promise\.allSettled\(\[[\s\S]*?\.\.\.actors\.map\(\(actor\) => actor\.lifecycle\),[\s\S]*?interactiveActor\?\.lifecycle,[\s\S]*?\]\.filter\(Boolean\)\)[\s\S]*?await syncService\.cancelAndWait\(\)[\s\S]*?await schoolSession\.clearStorageData/s)
  assert.match(logoutHandler, /syncPageJobQueue\.splice\(0\)[\s\S]*?fitnessPageJobQueue\.splice\(0\)/)
  assert.match(logoutHandler, /syncPageWindow,[\s\S]*?fitnessPageWindow,[\s\S]*?syncPageWindow = null\s*fitnessPageWindow = null/s)
  assert.match(logoutHandler, /const status = loggedOutStatus\(\)/)
  assert.doesNotMatch(logoutHandler, /getStatus\(\)/)
  assert.match(mainSource, /if \(explicitlyLoggedOut \|\| !recoverySources\.length\)/)
  assert.match(mainSource, /if \(!status\.saved \|\| explicitlyLoggedOut \|\| epoch !== authEpoch\) return/)
})

test('the THEOL background browser uses only a job-scoped navigation lease', () => {
  const backgroundBrowser = sourceBetween('async function loadWithBackgroundBrowser(', '\n\nfunction loadWithSchoolBrowser(')
  const schoolBrowser = sourceBetween('function loadWithSchoolBrowser(', '\n\nfunction loadWithFitnessBrowser(')
  assert.match(backgroundBrowser, /guardSourceWindow\(window\)/)
  assert.match(backgroundBrowser, /const theolLease = sourceFromUrl\(target\) === 'theol'/)
  assert.match(backgroundBrowser, /if \(theolLease\) window\.__theiaTheolLease = true/)
  assert.match(backgroundBrowser, /if \(theolLease && !window\.isDestroyed\(\)\) window\.__theiaTheolLease = false/)
  assert.doesNotMatch(backgroundBrowser, /actor\.source|theolActor/)
  assert.match(schoolBrowser, /currentWindow: \(\) => syncPageWindow/)
  assert.match(schoolBrowser, /allowTheol: true/)
})

test('fitness owns a separate hidden browser and serial executor from THEOL', () => {
  const fitnessBrowser = sourceBetween('function loadWithFitnessBrowser(', '\n\nfunction loadSchoolPage(')
  const fitnessQueue = sourceBetween('function loadFitnessBrowserPage(', '\n\nasync function loadFitnessPageWithSchoolBrowser(')
  const fitnessInteraction = sourceBetween('async function loadFitnessPageWithSchoolBrowser(', '\n\nfunction loadFitnessPage(')
  const fitnessPageLoader = sourceBetween('function loadFitnessPage(', '\n\nconst FITNESS_YEAR_KEY')
  const fitnessRequest = sourceBetween('async function fetchFitnessScoreFromSchool(', '\n\nasync function importFitnessArchive(')
  const fitnessSession = sourceBetween('async function fitnessSessionReady(', '\n\nasync function ensureFitnessSession(')
  const fitnessSubmit = sourceBetween('async function submitWithFitnessBrowser(', '\n\nfunction submitSchoolForm(')
  const fitnessSubmitQueue = sourceBetween('function submitFitnessForm(', '\n\nasync function flushPendingSourceOpens(')

  assert.match(mainSource, /let fitnessPageWindow\s*let fitnessPageJobRunning = false\s*const fitnessPageJobQueue = \[\]/s)
  assert.match(mainSource, /function drainFitnessPageQueue\(\)[\s\S]*?fitnessPageJobQueue\.sort[\s\S]*?drainFitnessPageQueue\(\)/)
  assert.match(fitnessBrowser, /currentWindow: \(\) => fitnessPageWindow/)
  assert.doesNotMatch(fitnessBrowser, /syncPageWindow|allowTheol: true/)
  assert.match(fitnessQueue, /fitnessPageJobQueue\.push\(\{ fn: \(\) => loadWithFitnessBrowser/)
  assert.doesNotMatch(fitnessQueue, /syncPageJobQueue|loadWithSchoolBrowser/)
  assert.match(fitnessInteraction, /const home = await loadWithFitnessBrowser\('https:\/\/tygl\.buct\.edu\.cn\/'\)/)
  assert.match(fitnessInteraction, /const window = fitnessPageWindow/)
  assert.doesNotMatch(fitnessInteraction, /syncPageWindow|loadWithSchoolBrowser/)
  assert.match(fitnessPageLoader, /fitnessPageJobQueue\.push[\s\S]*?loadFitnessPageWithSchoolBrowser[\s\S]*?drainFitnessPageQueue/)
  assert.match(fitnessRequest, /new SessionClient\(schoolSession, \{\s*pageLoader: \(url, options = \{\}\) => loadFitnessBrowserPage\([\s\S]*?formLoader: \(url, values, options\) => submitFitnessForm/s)
  assert.doesNotMatch(fitnessRequest, /loadSchoolPage|submitSchoolForm|syncPageWindow/)
  assert.match(fitnessSession, /loadFitnessBrowserPage\('https:\/\/tygl\.buct\.edu\.cn\/', 2\)/)
  assert.doesNotMatch(fitnessSession, /loadSchoolPage|syncPageWindow/)
  assert.match(fitnessSubmit, /if \(sourceFromUrl\(url\) === 'theol'\) throw/)
  assert.match(fitnessSubmit, /await loadWithFitnessBrowser[\s\S]*?const window = fitnessPageWindow/)
  assert.doesNotMatch(fitnessSubmit, /syncPageWindow|loadWithSchoolBrowser/)
  assert.match(fitnessSubmitQueue, /fitnessPageJobQueue\.push[\s\S]*?submitWithFitnessBrowser[\s\S]*?drainFitnessPageQueue/)
  assert.doesNotMatch(fitnessSubmitQueue, /syncPageJobQueue|submitWithSchoolBrowser/)
})

test('only an explicit user login re-enables sync after logout', () => {
  const openLogin = sourceBetween('async function openLoginWindow(', '\n\nasync function migrateFromLegacyDir(')
  const loginIpc = sourceBetween("ipcMain.handle('theia:login'", "\n  ipcMain.handle('theia:clear-academic-api-credentials'")
  assert.match(openLogin, /assertAuthEpoch\(expectedEpoch, \{ allowLoggedOut: userInitiated \}\)/)
  assert.match(openLogin, /if \(userInitiated\) \{\s*syncService\.enable\(\)\s*explicitlyLoggedOut = false\s*\}/s)
  assert.doesNotMatch(openLogin, /if \(!background\)/)
  assert.match(loginIpc, /const epoch = authEpoch[\s\S]*?await schoolProxyReady[\s\S]*?assertAuthEpoch\(epoch, \{ allowLoggedOut: true \}\)[\s\S]*?openLoginWindow\(\{ expectedEpoch: epoch, userInitiated: true \}\)/)
})

test('auth epoch guard rejects stale continuations even for an explicit login', () => {
  const guardSource = sourceBetween('function assertAuthEpoch(', '\n\nasync function getStatus(')
  const createGuard = new Function(`
    let authEpoch = 0
    let explicitlyLoggedOut = false
    ${guardSource}
    return {
      assertAuthEpoch,
      setEpoch(value) { authEpoch = value },
      setLoggedOut(value) { explicitlyLoggedOut = value },
    }
  `)
  const guard = createGuard()

  assert.doesNotThrow(() => guard.assertAuthEpoch(0))
  guard.setLoggedOut(true)
  assert.throws(() => guard.assertAuthEpoch(0), { code: 'AUTH_EPOCH_CHANGED' })
  assert.doesNotThrow(() => guard.assertAuthEpoch(0, { allowLoggedOut: true }))
  guard.setEpoch(1)
  assert.throws(() => guard.assertAuthEpoch(0, { allowLoggedOut: true }), { code: 'AUTH_EPOCH_CHANGED' })
})
