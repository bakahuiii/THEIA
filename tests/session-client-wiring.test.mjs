import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const mainSource = await readFile(new URL('../electron/main.mjs', import.meta.url), 'utf8')
const foundationSource = await readFile(new URL('../electron/service-foundation.mjs', import.meta.url), 'utf8')
const domainSource = await readFile(new URL('../electron/service-domain-runtime.mjs', import.meta.url), 'utf8')
const integrationSource = await readFile(new URL('../electron/service-integration-runtime.mjs', import.meta.url), 'utf8')
const runtimeIpcSource = await readFile(new URL('../electron/runtime-ipc.mjs', import.meta.url), 'utf8')
const sourceActionsRuntimeSource = await readFile(new URL('../electron/source-actions-runtime.mjs', import.meta.url), 'utf8')
const authManagerSource = await readFile(new URL('../electron/auth-actor-manager.mjs', import.meta.url), 'utf8')
const authRuntimeSource = await readFile(new URL('../electron/auth-runtime.mjs', import.meta.url), 'utf8')
const authStatusSource = await readFile(new URL('../electron/auth-status-runtime.mjs', import.meta.url), 'utf8')
const authIpcSource = await readFile(new URL('../electron/auth-ipc.mjs', import.meta.url), 'utf8')
const fitnessRuntimeSource = await readFile(new URL('../electron/fitness-runtime.mjs', import.meta.url), 'utf8')
const sourcePageRuntimeSource = await readFile(new URL('../electron/source-page-runtime.mjs', import.meta.url), 'utf8')
const theolInteractionRuntimeSource = await readFile(new URL('../electron/theol-interaction-runtime.mjs', import.meta.url), 'utf8')
const windowRuntimeSource = await readFile(new URL('../electron/window-runtime.mjs', import.meta.url), 'utf8')
const syncIpcSource = await readFile(new URL('../electron/sync-ipc.mjs', import.meta.url), 'utf8')

function sourceBetween(start, end, source = mainSource) {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`)
  const endIndex = source.indexOf(end, startIndex + start.length)
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`)
  return source.slice(startIndex, endIndex)
}

test('JWGLXT uses the rendered school page queue while sharing its browser cookies', () => {
  assert.match(
    foundationSource,
    /(?:const )?academicSessionClient = new SessionClient\(schoolSession, \{\s*pageLoader: smokeFile \? null : loadSchoolPage,\s*formLoader: smokeFile \? null : submitSchoolForm,\s*(?:binaryLoader: smokeFile \? null : loadBinaryWithSchoolBrowser,\s*)?onDiagnostic:/s,
  )
  assert.match(domainSource, /browserAdapter: new JwglxtAdapter\(academicSessionClient, \{\s*attachmentStore: academicAttachmentStore/s)
  assert.match(domainSource, /theol: new TheolAdapter\(sessionClient\)/)
  assert.match(
    foundationSource,
    /(?:const )?sessionClient = new SessionClient\(schoolSession, \{\s*pageLoader: smokeFile \? null : loadSchoolPage,\s*formLoader: smokeFile \? null : submitSchoolForm,/s,
  )
  assert.match(mainSource, /getSessionClient: \(\) => sessionClient,\s*getAcademicSessionClient: \(\) => academicSessionClient,/s)
  const sourceStatus = sourceBetween('  function sourceStatus(source) {', '\n\n  function freshSourceStatus(source) {', authStatusSource)
  assert.match(sourceStatus, /const epoch = getAuthEpoch\(\)/)
  assert.match(
    sourceStatus,
    /assertAuthEpoch\(epoch\)\s*return source === 'theol'\s*\? syncService\.runTheolExclusive\(\(\) => \{\s*assertAuthEpoch\(epoch\)\s*return adapter\.status\(\)\s*\}\)\s*: adapter\.status\(\)/s,
  )
})

test('MOTION venue IPC is wired into the main-process lifecycle', () => {
  assert.match(foundationSource, /import \{ MotionVenueAdapter \} from '\.\.\/core\/adapters\/motion\.mjs'/)
  assert.match(foundationSource, /const motionVenueAdapter = new MotionVenueAdapter\(\)/)
  assert.match(
    runtimeIpcSource,
    /registerMotionVenueIpc\(\{[\s\S]*?adapter: motionVenueAdapter,[\s\S]*?cachedMotionVenueCatalog,[\s\S]*?cacheMotionVenueCatalog,[\s\S]*?cacheMotionVenueStatus,/,
  )
})

test('authentication uses source-scoped single-flight actors instead of a shared login queue', () => {
  assert.match(mainSource, /const authActorManager = createAuthActorManager\(/)
  assert.match(mainSource, /const authActors = authActorManager\.actors/)
  assert.match(authManagerSource, /return create\(source, \{ background, userInitiated \}\)/)
  assert.match(authRuntimeSource, /await authActorManager\.open\([\s\S]*?requestedSources/s)
  assert.match(authManagerSource, /const actors = new Map\(\)/)
  assert.match(authManagerSource, /if \(current && !current\.invalidated[\s\S]*?return current/s)
  assert.match(authManagerSource, /await Promise\.all\(actorList\.map\(\(actor\) => actor\.opened\)\)/)
  assert.doesNotMatch(mainSource, /\blet loginWindow\b|\blet loginTarget\b|\blet loginQueue\b|\blet authPoll\b/)
})

test('authentication runtime imports the parsers used by its polling loop', () => {
  assert.match(authRuntimeSource, /import \{ parseJwHomepage \} from '\.\.\/core\/parsers\/jwglxt\.mjs'/)
  assert.match(authRuntimeSource, /import \{ parseTheolHome \} from '\.\.\/core\/parsers\/theol\.mjs'/)
  assert.match(authRuntimeSource, /parseJwHomepage\(html, frame\.url\)/)
  assert.match(authRuntimeSource, /parseTheolHome\(html, frame\.url\)/)
})

test('THEOL login owns its exclusive lease for the complete actor lifecycle', () => {
  const actorLifecycle = sourceBetween('async function runAuthActor(', '\n\n  async function finishAuthActor(', authRuntimeSource)
  const createActor = authManagerSource
  assert.match(actorLifecycle, /actor\.resumeAssignments = syncService\.pauseAssignmentScan\(\)\s*await syncService\.waitForAssignmentScan\(\)/s)
  assert.match(actorLifecycle, /if \(actor\.source === 'theol'\) await syncService\.runTheolExclusive\(runLifecycle\)\s*else await runLifecycle\(\)/s)
  assert.match(actorLifecycle, /await actor\.closed/)
  assert.doesNotMatch(actorLifecycle, /syncNow/)
  assert.match(authRuntimeSource, /createSourceWindow\(request\.url, request\.title, \{ pauseAssignments: source === 'theol' \}\)/)
  assert.match(actorLifecycle, /guardSourceWindow\(window, \{\s*source: actor\.source,\s*theolActor: actor\.source === 'theol' \? actor : null,\s*theolLease: actor\.source === 'theol',\s*upgradeTyglRedirects: actor\.source === 'tygl',\s*\}\)/s)
  assert.match(actorLifecycle, /if \(actor\.source !== 'theol'\) actor\.resolveClosed\(\)/)
  assert.match(createActor, /windows: new Set\(\)/)
})

test('manual THEOL windows share one exclusive interactive actor for the full window tree', () => {
  const actorLifecycle = theolInteractionRuntimeSource.match(/async function runActor\(actor\) \{[\s\S]*?\n  \}/)?.[0] || ''
  const guardWindow = sourceBetween('function guardSourceWindow(', '\n\nconst theolInteractionRuntime', mainSource)
  assert.match(theolInteractionRuntimeSource, /let currentActor = null/)
  assert.match(actorLifecycle, /const syncService = getSyncService\(\)\s*actor\.resumeAssignments = syncService\.pauseAssignmentScan\(\)\s*await syncService\.waitForAssignmentScan\(\)/s)
  assert.match(actorLifecycle, /await syncService\.runTheolExclusive\(async \(\) => \{[\s\S]*?await actor\.closed/s)
  assert.match(actorLifecycle, /theolActor: actor[\s\S]*?theolLease: true/s)
  assert.match(actorLifecycle, /if \(actor\.windows\.size\) await actor\.closed/)
  assert.match(guardWindow, /theolActor\.windows\.add\(window\)/)
  assert.match(guardWindow, /interactiveActor\.windows\.delete\(window\)\s*if \(!interactiveActor\.windows\.size\) interactiveActor\.resolveClosed\(\)/s)
  assert.match(guardWindow, /theolActor: interactiveActor[\s\S]*?theolLease: Boolean\(window\.__theiaTheolLease\)/s)
  assert.match(guardWindow, /if \(window === syncPageWindow \|\| window === fitnessPageWindow\) \{[\s\S]*?return \{ action: 'deny' \}/s)
  assert.match(guardWindow, /if \(window\.__theiaTheolInteractiveActor\?\.invalidated\) return \{ action: 'deny' \}/)
  assert.match(guardWindow, /if \(theolActor\?\.invalidated\) void closeWindowAndWait\(window\)/)
  assert.match(sourceActionsRuntimeSource, /if \(source === 'theol'\) return openTheolInteractiveWindow\(url, title\)/)
})

test('campus source windows and campus popups stay headless and close on shutdown', () => {
  const sourceOptions = sourceBetween('function sourceWindowOptions(', '\n\nasync function createMailBrowserWindow(', mainSource)
  const guardWindow = sourceBetween('function guardSourceWindow(', '\n\nconst theolInteractionRuntime', mainSource)
  const shutdown = sourceBetween('async function shutdownServices()', '\n\nprocess.on(', mainSource)

  assert.match(sourceOptions, /show: false/)
  assert.match(guardWindow, /source\.popup_blocked[\s\S]*?reason: 'campus_source_windows_disabled'/)
  assert.doesNotMatch(guardWindow, /action: 'allow'/)
  assert.match(windowRuntimeSource, /isPermittedSourceUrl\(url\)[\s\S]*?renderer\.campus_popup_blocked[\s\S]*?action: 'deny'/s)
  assert.doesNotMatch(authRuntimeSource, /window\.show\(\)|window\.focus\(\)/)
  assert.doesNotMatch(authManagerSource, /current\.window\.show|current\.window\.focus/)
  assert.doesNotMatch(sourceActionsRuntimeSource, /window\.show\(\)|window\.focus\(\)/)
  assert.doesNotMatch(theolInteractionRuntimeSource, /window\.show\(\)|window\.focus\(\)/)
  assert.match(authRuntimeSource, /auth\.window_timeout_closed[\s\S]*?closeWindowAndWait\(window\)/s)
  assert.match(mainSource, /async function closeAllSourceWindows\([\s\S]*?sourceWindows/s)
  assert.match(shutdown, /theolInteractionRuntime\.invalidateCurrent\('THEIA 正在退出'\)[\s\S]*?closeLiveCaptureActors\('THEIA 正在退出'\)[\s\S]*?closeAllSourceWindows\(\)/s)
  assert.match(windowRuntimeSource, /window\.on\('closed',[\s\S]*?onMainWindowClosed\(\)/s)
  assert.match(mainSource, /onMainWindowClosed: \(\) => \{ if \(process\.platform !== 'darwin'\) app\.quit\(\) \}/)
  assert.match(shutdown, /await Promise\.allSettled\(\[[\s\S]*?syncService\?\.stopAndWait\?\.\(\)[\s\S]*?mailService\?\.stopAndWait\?\.\(\)[\s\S]*?webmailService\?\.stopAndWait\?\.\(\)/s)
})

test('single-instance failure cannot continue into normal startup', () => {
  assert.match(mainSource, /if \(!lock\) \{[\s\S]*?app\.quit\(\)\s*\}\)\s*\} else \{\s*console\.log\('\[THEIA\] Single instance lock acquired/s)
})

test('manual THEOL actor reuses only an identical target and synchronizes once after release', () => {
  const openInteraction = sourceBetween('async function open(', '\n\n  function invalidateCurrent', theolInteractionRuntimeSource)
  const finishInteraction = sourceBetween('async function finishActor(', '\n\n  function createActor', theolInteractionRuntimeSource)
  assert.match(openInteraction, /if \(current\.interactionKey !== interactionKey\) \{\s*throw new Error\(/s)
  assert.match(openInteraction, /await current\.opened[\s\S]*?assertAuthEpoch\(epoch\)[\s\S]*?const reused = focusWindow\(current\)/)
  assert.match(finishInteraction, /if \(currentActor === actor\) currentActor = null/)
  assert.match(finishInteraction, /actor\.resumeAssignments\?\.\(\{ schedule: false \}\)/)
  assert.match(finishInteraction, /if \(actor\.invalidated \|\| actor\.epoch !== getAuthEpoch\(\) \|\| isExplicitlyLoggedOut\(\)\) return/)
  assert.match(finishInteraction, /await getSyncService\(\)\.syncNow\(\{ sources: \['theol'\] \}\)/)
})

test('course-work navigation proves every final URL and DOM identity before the hidden window opens', () => {
  const actorLifecycle = sourceBetween('async function runActor(', '\n\n  async function finishActor(', theolInteractionRuntimeSource)
  const urlValidation = sourceBetween('function validateNavigationUrl(', '\n\n  async function readNavigationIdentity(', theolInteractionRuntimeSource)
  const domValidation = sourceBetween('async function validateNavigationStep(', '\n\n  async function runActor(', theolInteractionRuntimeSource)
  const courseWork = sourceBetween('async function openCourseWorkWindow(', '\n\nasync function attachFileToSourceWindow(', sourceActionsRuntimeSource)

  assert.match(actorLifecycle, /new BrowserWindow\(sourceWindowOptions\(\{ title: actor\.title, show: false \}\)\)/)
  assert.match(actorLifecycle, /for \(const \[index, url\] of actor\.navigationUrls\.entries\(\)\)[\s\S]*?await window\.loadURL\(url\)[\s\S]*?await validateNavigationStep\(window, check\)[\s\S]*?actor\.validated = true\s*actor\.resolveOpened\(window\)/s)
  assert.match(actorLifecycle, /catch \(error\)[\s\S]*?actor\.rejectOpened\(error\)[\s\S]*?Promise\.all\(\[\.\.\.actor\.windows\]\.map/s)
  assert.match(mainSource, /if \(window\.__theiaTheolInteractiveActor\?\.validated === false\) return \{ action: 'deny' \}/)
  assert.match(urlValidation, /THEOL_INTERACTION_COURSE_PATHS\.has\(finalUrl\.pathname\.toLowerCase\(\)\)[\s\S]*?courseIds\[0\] !== check\.courseId/s)
  assert.match(urlValidation, /finalUrl\.pathname\.toLowerCase\(\) !== taskType\.path[\s\S]*?taskIds\[0\] !== check\.taskId/s)
  assert.match(domValidation, /courseEvidence\.includes\(check\.courseId\)[\s\S]*?identity\.courseFields\.some/s)
  assert.match(domValidation, /taskFields[\s\S]*?taskUrls[\s\S]*?includes\(check\.taskId\)/s)
  assert.match(courseWork, /navigationChecks: \[[\s\S]*?type: 'course',[\s\S]*?courseId: assignment\.courseId[\s\S]*?type: 'task',[\s\S]*?kind: entry\.kind,[\s\S]*?uniqueTaskId: entry\.uniqueTaskId/s)
})

test('successful authentication releases its actor before source-scoped synchronization', () => {
  const finishActor = sourceBetween('async function finishAuthActor(', '\n\n  async function openLoginWindow(', authRuntimeSource)
  assert.match(finishActor, /if \(authActors\.get\(actor\.source\) === actor\) authActors\.delete\(actor\.source\)/)
  assert.match(finishActor, /if \(actor\.source === 'theol'\) syncService\.enableAssignmentScan\(\{ schedule: false \}\)/)
  assert.match(finishActor, /const syncOptions = actor\.userInitiated[\s\S]*?await syncService\.syncNow\(syncOptions\)/s)
  assert.match(finishActor, /await flushPendingSourceOpens\(actor\.source, actor\.epoch\)/)
  assert.match(authRuntimeSource, /async function flushPendingSourceOpens\(source, epoch = getAuthEpoch\(\)\)[\s\S]*?request\.source === source[\s\S]*?if \(isExplicitlyLoggedOut\(\) \|\| epoch !== getAuthEpoch\(\)\) return/)
})

test('authentication continuations are bound to their actor window and epoch', () => {
  const credentialFill = sourceBetween('async function autoFillSavedCredentials(', '\n\n  function scheduleCredentialFill(', authRuntimeSource)
  const pollActor = sourceBetween('async function pollAuthStatus(', '\n\n  async function sourceAlreadyAuthenticated(', authRuntimeSource)
  assert.match(authRuntimeSource, /function isCurrentAuthActor\(actor, window = actor\?\.window\)[\s\S]*?authActorManager\.isCurrent\(actor, window\)/s)
  assert.match(credentialFill, /isTrustedBuctAuthHostname\(new URL\(frame\.url\)\.hostname\)/)
  assert.match(authRuntimeSource, /hostname === 'buct\.edu\.cn' \|\| hostname\.endsWith\('\.buct\.edu\.cn'\)/)
  assert.match(credentialFill, /input\.autocomplete/)
  assert.match(credentialFill, /passwordInput\.form\.requestSubmit\(\)/)
  assert.match(authManagerSource, /actor\.epoch === getEpoch\(\)[\s\S]*?actors\.get\(actor\.source\) === actor[\s\S]*?actor\.window === window/s)
  assert.match(authRuntimeSource, /await getCredentialVault\(\)\.readCredentials\(\)\s*if \(!isCurrentAuthActor\(actor, window\) \|\| actor\.epoch !== epoch\) return/s)
  assert.match(authRuntimeSource, /await frame\.executeJavaScript\(script\)\s*if \(!isCurrentAuthActor\(actor, window\) \|\| actor\.epoch !== epoch\) return/s)
  assert.match(authRuntimeSource, /await rememberVerifiedSession\(source, authenticatedUrl, epoch\)\s*if \(!isCurrentAuthActor\(actor, window\) \|\| actor\.epoch !== epoch\) return/s)
  assert.doesNotMatch(pollActor, /verifiedSessions\[source\]\s*=/)
})

test('authentication recovery remains scoped to each requesting platform', () => {
  const schedulePdf = sourceBetween('async function openSchedulePdf(', '\n\nasync function openCourseWorkWindow(', sourceActionsRuntimeSource)
  assert.match(schedulePdf, /openLoginWindow\(\{ sources: \['jwglxt'\], expectedEpoch: epoch \}\)/)
  assert.match(mainSource, /const authRecovery = Object\.fromEntries\(AUTH_SOURCES\.map\(\(source\) => \[source,/)
  assert.match(domainSource, /const eligibleSources = recoverySources\.filter\(\(source\) => \{[\s\S]*?const recovery = authRecovery\[source\]/)
  assert.match(domainSource, /openLoginWindow\(\{ background: true, sources: eligibleSources, expectedEpoch: epoch \}\)/)
})

test('verified session writes remain bound to the epoch that initiated each request', () => {
  const rememberSession = sourceBetween('  async function rememberVerifiedSession(', '\n\n  async function verifiedStatus(', authStatusSource)
  const schedulePdf = sourceBetween('async function openSchedulePdf(', '\n\nasync function openCourseWorkWindow(', sourceActionsRuntimeSource)
  const courseWork = sourceBetween('async function openCourseWorkWindow(', '\n\nasync function attachFileToSourceWindow(', sourceActionsRuntimeSource)
  const sourceWindow = sourceBetween('async function openSourceWindow(', '\n\n  return {', sourceActionsRuntimeSource)
  const pollActor = sourceBetween('async function pollAuthStatus(', '\n\n  async function sourceAlreadyAuthenticated(', authRuntimeSource)
  const authActor = sourceBetween('async function runAuthActor(', '\n\n  async function finishAuthActor(', authRuntimeSource)

  assert.match(
    rememberSession,
    /async function rememberVerifiedSession\(source, url, expectedEpoch\)[\s\S]*?const cookies = await getSchoolSession\(\)\.cookies\.get[\s\S]*?assertAuthEpoch\(expectedEpoch\)[\s\S]*?verifiedSessions\[source\] =/,
  )
  assert.match(schedulePdf, /rememberVerifiedSession\('jwglxt', status\.url \|\| JWGLXT_URLS\.schedule, epoch\)/)
  assert.match(courseWork, /rememberVerifiedSession\(source, status\.url \|\| entry\.courseSourceUrl, epoch\)/)
  assert.match(sourceWindow, /rememberVerifiedSession\(source, status\.url \|\| url, epoch\)/)
  assert.match(pollActor, /rememberVerifiedSession\(source, authenticatedUrl, epoch\)/)
  assert.match(authActor, /rememberVerifiedSession\(actor\.source, status\.url \|\| loginTargetDetails\(actor\.source\)\.url, actor\.epoch\)/)
})

test('source-page opens wait for saved-password authentication before showing the requested page', () => {
  const sourceWindow = sourceBetween('async function openSourceWindow(', '\n\n  return {', sourceActionsRuntimeSource)
  assert.match(sourceWindow, /const actors = await openLoginWindow\(/)
  assert.match(sourceWindow, /if \(credentials\?\.saved\) \{[\s\S]*?if \(actor\?\.lifecycle\) await actor\.lifecycle[\s\S]*?if \(!actor\?\.authenticated\)/s)
  assert.match(sourceWindow, /const opened = await openAuthenticatedSourceWindow\(url, title/)
  assert.doesNotMatch(sourceWindow, /pendingSourceOpens\.push\(\{ source, url, title \}\)[\s\S]*?credentials\?\.saved/s)
  assert.match(authRuntimeSource, /const actors = await authActorManager\.open\([\s\S]*?return actors/s)
})

test('source-page opens reuse a verified browser session without a hidden probe', () => {
  const sourceWindow = sourceBetween('async function openSourceWindow(', '\n\n  return {', sourceActionsRuntimeSource)
  assert.match(sourceWindow, /source !== 'theol' && status\?\.connected && verifiedSessions\[source\][\s\S]*?await createSourceWindow\(url, title, \{ pauseAssignments: false \}\)/s)
})

test('source-page authentication re-probes the first page after actor completion', () => {
  const sourceWindow = sourceBetween('async function openAuthenticatedSourceWindow(', '\n\nasync function waitForSchedulePdfContext(', sourceActionsRuntimeSource)
  assert.match(sourceWindow, /if \(verified\) \{[\s\S]*?show: false[\s\S]*?inspectLoadedSourcePage/s)
  assert.match(sourceWindow, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/)
  assert.match(sourceWindow, /setTimeout\(resolveDelay, 250\)/)
})

test('reused startup sessions refresh the primary academic domains', () => {
  const finishActor = sourceBetween('async function finishAuthActor(', '\n\n  async function openLoginWindow(', authRuntimeSource)
  assert.match(finishActor, /const shouldRefresh = !actor\.skipSync/)
  assert.match(mainSource, /'selected-courses', 'academic-progress', 'notices'/)
})

test('one CAS login verifies both campus applications before the user sync', () => {
  const verification = sourceBetween('  function requestUnifiedAuthVerification(', '\n\n  async function getStatus(', authStatusSource)
  const finishActor = sourceBetween('async function finishAuthActor(', '\n\n  async function openLoginWindow(', authRuntimeSource)
  assert.match(verification, /freshSourceStatus\('jwglxt'\)[\s\S]*?freshSourceStatus\('theol'\)/s)
  assert.match(verification, /rememberVerifiedSession\(source, status\.url \|\| getSourceSessionUrl\(source\), epoch\)/)
  assert.match(verification, /await getSyncOrchestrator\(\)\.syncForegroundCampusData\(\)/)
  assert.match(finishActor, /const unifiedVerification = actor\.authenticated && actor\.userInitiated && isCampusSource/)
  assert.match(finishActor, /: actor\.userInitiated && isCampusSource\s*\?\s*getUnifiedVerificationPromise\(actor\.epoch\)/)
  assert.match(finishActor, /if \(!actor\.authenticated[\s\S]*?await unifiedVerification[\s\S]*?return/s)
  assert.match(finishActor, /if \(isCampusSource && !unifiedVerification\)/)
  assert.match(finishActor, /if \(unifiedVerification && !hasPendingCampusActor\) await unifiedVerification/)
  assert.match(authStatusSource, /authPending: true/)
})

test('explicit logout invalidates actors and closes browsers before clearing session storage', () => {
  const logoutHandler = runtimeIpcSource.match(/ipcMain\.handle\('theia:logout',[\s\S]*?\n  registerCourseSelectionIpc/)?.[0] || ''
  assert.match(logoutHandler, /setExplicitlyLoggedOut\(true\)\s*syncService\.disable\(\)\s*await courseWorkQueue\?\.setEnabled\(false\)\s*incrementAuthEpoch\(\)/s)
  assert.match(logoutHandler, /statusChecks\.jwglxt = null\s*statusChecks\.theol = null/s)
  assert.match(logoutHandler, /const interactiveActor = theolInteractionRuntime\.invalidateCurrent\(\)/)
  assert.match(logoutHandler, /interactiveActor\?\.resolveClosed\(\)[\s\S]*?interactiveActor\?\.lifecycle/s)
  assert.match(logoutHandler, /actor\.invalidated = true[\s\S]*?clearAuthActorTimers\(actor\)[\s\S]*?actor\.resolveOpened\(\)/)
  assert.match(logoutHandler, /await Promise\.all\(\[\.\.\.windows\]\.map\(\(window\) => closeWindowAndWait\(window\)\)\)[\s\S]*?await Promise\.allSettled\(\[[\s\S]*?\.\.\.actors\.map\(\(actor\) => actor\.lifecycle\),[\s\S]*?interactiveActor\?\.lifecycle,[\s\S]*?\]\.filter\(Boolean\)\)[\s\S]*?await syncService\.cancelAndWait\(\)[\s\S]*?await schoolSession\.clearStorageData/s)
  assert.match(logoutHandler, /syncPageQueue\.cancelPending\([\s\S]*?fitnessPageQueue\.cancelPending\(/)
  assert.match(logoutHandler, /getSyncPageWindow\(\),[\s\S]*?getFitnessPageWindow\(\),[\s\S]*?setSyncPageWindow\(null\)\s*setFitnessPageWindow\(null\)/s)
  assert.match(logoutHandler, /const status = loggedOutStatus\(\)/)
  assert.doesNotMatch(logoutHandler, /getStatus\(\)/)
  assert.match(domainSource, /if \(explicitlyLoggedOut \|\| !recoverySources\.length\)/)
  assert.match(domainSource, /if \(!status\.saved \|\| getExplicitlyLoggedOut\(\) \|\| epoch !== getAuthEpoch\(\)\) return/)
})

test('manual sync IPC stays in a dedicated source-scoped module', () => {
  assert.match(runtimeIpcSource, /registerSyncIpc\(\{[\s\S]*?waitForSchoolProxy,/s)
  assert.match(integrationSource, /registerRuntimeIpc\(\{[\s\S]*?waitForSchoolProxy,/s)
  assert.match(syncIpcSource, /ipcMain\.handle\('theia:sync-now'/)
  assert.match(syncIpcSource, /syncOrchestrator\.syncForegroundCampusData\(\)/)
  assert.match(syncIpcSource, /ipcMain\.handle\('theia:sync-domain'/)
  assert.match(syncIpcSource, /SYNC_DOMAIN_TARGETS\[domainId\]/)
  assert.match(syncIpcSource, /mailService\.poll\([\s\S]*?sendSnapshot\(\)/s)
  assert.match(syncIpcSource, /ipcMain\.handle\('theia:query-free-classrooms'/)
  assert.match(syncIpcSource, /domains: \['free-classroom'\]/)
})

test('the THEOL background browser uses only a job-scoped navigation lease', () => {
  const backgroundBrowser = sourceBetween('  async function loadWithBackgroundBrowser(', '\n\n  function loadWithSchoolBrowser(', sourcePageRuntimeSource)
  const schoolBrowser = sourceBetween('  function loadWithSchoolBrowser(', '\n\n  function loadWithFitnessBrowser(', sourcePageRuntimeSource)
  assert.match(backgroundBrowser, /guardSourceWindow\(window, \{ upgradeTyglRedirects \}\)/)
  assert.match(backgroundBrowser, /const theolLease = sourceFromUrl\(target\) === 'theol'/)
  assert.match(backgroundBrowser, /if \(theolLease\) window\.__theiaTheolLease = true/)
  assert.match(backgroundBrowser, /if \(theolLease && !window\.isDestroyed\(\)\) window\.__theiaTheolLease = false/)
  assert.doesNotMatch(backgroundBrowser, /actor\.source|theolActor/)
  assert.match(schoolBrowser, /currentWindow: getSyncPageWindow/)
  assert.match(schoolBrowser, /allowTheol: true/)
})

test('fitness owns a separate hidden browser and serial executor from THEOL', () => {
  const fitnessBrowser = sourceBetween('  function loadWithFitnessBrowser(', '\n\n  function loadSchoolPage(', sourcePageRuntimeSource)
  const fitnessQueue = sourceBetween('  function loadFitnessBrowserPage(', '\n\n  async function loadFitnessPageWithSchoolBrowser(', sourcePageRuntimeSource)
  const fitnessInteraction = sourceBetween('  async function loadFitnessPageWithSchoolBrowser(', '\n\n  function loadFitnessPage(', sourcePageRuntimeSource)
  const fitnessPageLoader = sourceBetween('  function loadFitnessPage(', '\n\n  async function submitWithSchoolBrowser(', sourcePageRuntimeSource)
  const fitnessRequest = sourceBetween('async function fetchFitnessScoreFromSchool(', '\n\n  async function importFitnessArchive(', fitnessRuntimeSource)
  const fitnessSession = sourceBetween('async function fitnessSessionReady(', '\n\n  async function ensureFitnessSession(', fitnessRuntimeSource)
  const fitnessSubmit = sourceBetween('  async function submitWithFitnessBrowser(', '\n\n  function submitSchoolForm(', sourcePageRuntimeSource)
  const fitnessSubmitQueue = sourceBetween('  function submitFitnessForm(', '\n\n  return {', sourcePageRuntimeSource)

  assert.match(mainSource, /let fitnessPageWindow[\s\S]*?const fitnessPageQueue = createPriorityJobQueue\(\)/)
  assert.match(fitnessBrowser, /currentWindow: getFitnessPageWindow/)
  assert.match(fitnessBrowser, /upgradeTyglRedirects: true/)
  assert.doesNotMatch(fitnessBrowser, /syncPageWindow|allowTheol: true/)
  assert.match(fitnessQueue, /fitnessPageQueue\.enqueue\(\(\) => loadWithFitnessBrowser/)
  assert.doesNotMatch(fitnessQueue, /syncPageQueue|loadWithSchoolBrowser/)
  assert.match(fitnessInteraction, /const home = await loadWithFitnessBrowser\('https:\/\/tygl\.buct\.edu\.cn\/'\)/)
  assert.match(fitnessInteraction, /const window = getFitnessPageWindow\(\)/)
  assert.doesNotMatch(fitnessInteraction, /syncPageWindow|loadWithSchoolBrowser/)
  assert.match(fitnessPageLoader, /fitnessPageQueue\.enqueue\(\(\) => loadFitnessPageWithSchoolBrowser/)
  assert.match(fitnessRequest, /new SessionClient\(schoolSession, \{\s*pageLoader: \(url, options = \{\}\) => loadFitnessBrowserPage\([\s\S]*?formLoader: \(url, values, options\) => submitFitnessForm/s)
  assert.doesNotMatch(fitnessRequest, /loadSchoolPage|submitSchoolForm|syncPageWindow/)
  assert.match(fitnessSession, /loadFitnessBrowserPage\('https:\/\/tygl\.buct\.edu\.cn\/', 2\)/)
  assert.doesNotMatch(fitnessSession, /loadSchoolPage|syncPageWindow/)
  assert.match(fitnessSubmit, /if \(sourceFromUrl\(url\) === 'theol'\) throw/)
  assert.match(fitnessSubmit, /await loadWithFitnessBrowser[\s\S]*?const window = getFitnessPageWindow\(\)/)
  assert.doesNotMatch(fitnessSubmit, /syncPageWindow|loadWithSchoolBrowser/)
  assert.match(fitnessSubmitQueue, /fitnessPageQueue\.enqueue\(\(\) => submitWithFitnessBrowser/)
  assert.doesNotMatch(fitnessSubmitQueue, /syncPageJobQueue|submitWithSchoolBrowser/)
})

test('course selection uses the authenticated JWGLXT browser session', () => {
  const courseSelection = sourceBetween('courseSelectionService = new CourseSelectionService({', '\n  syncService.configureAutoSync', domainSource)
  assert.match(courseSelection, /client: academicSessionClient/)
  assert.doesNotMatch(courseSelection, /courseSelectionClientFactory/)
})

test('course-selection reads restore the JWGLXT browser session before one retry', () => {
  const recovery = sourceBetween('async function freshJwglxtBrowserStatus(', '\n\n  async function closeLiveCaptureActors(', authRuntimeSource)
  assert.match(recovery, /adapter\?\.browserStatus/)
  assert.match(recovery, /openLoginWindow\(\{[\s\S]*?sources: \['jwglxt'\],[\s\S]*?requireBrowser: true,[\s\S]*?skipSync: true,/)
  assert.match(recovery, /if \(actor\?\.lifecycle\) await actor\.lifecycle/)
  assert.match(recovery, /status = await freshJwglxtBrowserStatus\(epoch\)/)
  assert.match(recovery, /throw new AuthRequiredError\('Course selection'/)
  assert.match(runtimeIpcSource, /registerCourseSelectionIpc\(\{[\s\S]*?recoverCourseSelectionReadSession,[\s\S]*?writeDiagnostic,/)
})

test('startup authentication prioritizes JWGLXT before the serial THEOL actor', () => {
  const openLogin = sourceBetween('async function openLoginWindow(', '\n\n  async function freshJwglxtBrowserStatus(', authRuntimeSource)
  assert.match(openLogin, /: \['jwglxt', 'theol'\]/)
  assert.match(mainSource, /async function autoLoginOnStartup\(\)[\s\S]*?openLoginWindow\(\{ background: true, requireBrowser: true \}\)/s)
})

test('authenticated-page inspection initializes the runtime before probing pages', () => {
  const inspection = sourceBetween('} else if (inspectionOutput) {', '\n} else {')
  assert.match(inspection, /migrateFromLegacyDir\(\)\.then\(\(\) => app\.whenReady\(\)\)/)
  assert.match(inspection, /registerLocalProtocols\(\)[\s\S]*?await startServices\(\)[\s\S]*?await autoLoginOnStartup\(\)[\s\S]*?await inspectAuthenticatedPages\(\)/s)
})

test('fitness upgrades only the blocked TYGL HTTP callback before retrying navigation', () => {
  const guardWindow = sourceBetween('function guardSourceWindow(', '\n\nconst theolInteractionRuntime', mainSource)
  const navigation = sourceBetween('async function loadSourceWindowUrl(', '\n\nasync function createSourceWindow(', sourceActionsRuntimeSource)
  const backgroundBrowser = sourceBetween('  async function loadWithBackgroundBrowser(', '\n\n  function loadWithSchoolBrowser(', sourcePageRuntimeSource)
  const authActor = sourceBetween('async function runAuthActor(', '\n\n  async function finishAuthActor(', authRuntimeSource)

  assert.match(guardWindow, /upgradeTyglRedirectUrl\(target\)[\s\S]*?event\.preventDefault\(\)[\s\S]*?__theiaPendingNavigationUpgrade = upgradedTarget/s)
  assert.match(navigation, /await window\.loadURL\(navigationTarget\)[\s\S]*?__theiaPendingNavigationUpgrade[\s\S]*?upgrades >= 3/s)
  assert.match(backgroundBrowser, /loadSourceWindowUrl\(window, target, \{ signal \}\)/)
  assert.match(authActor, /upgradeTyglRedirects: actor\.source === 'tygl'[\s\S]*?loadSourceWindowUrl\(window, target\.url\)/s)
})

test('only an explicit user login re-enables sync after logout', () => {
  const openLogin = sourceBetween('async function openLoginWindow(', '\n\n  async function freshJwglxtBrowserStatus(', authRuntimeSource)
  const loginIpc = sourceBetween("ipcMain.handle('theia:login'", "\n  ipcMain.handle('theia:clear-academic-api-credentials'", authIpcSource)
  assert.match(openLogin, /assertAuthEpoch\(expectedEpoch, \{ allowLoggedOut: userInitiated \}\)/)
  assert.match(openLogin, /if \(userInitiated\) \{\s*syncService\.enable\(\)\s*setExplicitlyLoggedOut\(false\)\s*await getCourseWorkQueue\(\)\?\.setEnabled\(true\)\s*\}/s)
  assert.doesNotMatch(openLogin, /if \(!background\)/)
  assert.match(loginIpc, /const epoch = getAuthEpoch\(\)[\s\S]*?await waitForSchoolProxy\(\)[\s\S]*?assertAuthEpoch\(epoch, \{ allowLoggedOut: true \}\)[\s\S]*?const actors = await openLoginWindow\(\{ expectedEpoch: epoch, userInitiated: true \}\)[\s\S]*?await Promise\.allSettled\(\(actors \|\| \[\]\)\.map\(\(actor\) => actor\?\.lifecycle \|\| Promise\.resolve\(\)\)\)/)
})

test('auth epoch guard rejects stale continuations even for an explicit login', () => {
  const guardSource = sourceBetween('function assertAuthEpoch(', '\n\nfunction sourceFromUrl(')
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
