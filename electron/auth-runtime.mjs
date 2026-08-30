import { AuthRequiredError } from '../core/source-client.mjs'
import { JWGLXT_URLS } from '../core/adapters/jwglxt.mjs'
import { parseJwHomepage } from '../core/parsers/jwglxt.mjs'
import { parseTheolHome } from '../core/parsers/theol.mjs'
import { installAuthDebuggerDiagnostics, installAuthNetworkDiagnostics } from './auth-network-diagnostics.mjs'

const AUTH_WINDOW_TIMEOUT_MS = 20_000
const AUTH_CREDENTIAL_RETRY_DELAYS_MS = Object.freeze([0, 300, 800, 1_500, 2_500, 4_000, 6_000, 9_000, 13_000])
const AUTH_CREDENTIAL_MAX_SUBMISSIONS = 1

/**
 * Owns the browser-facing authentication lifecycle. The main process supplies
 * the campus services and window guards; this module keeps CAS form filling,
 * polling, recovery, and actor cleanup out of the application wiring.
 */
export function createAuthRuntime({
  BrowserWindow,
  authActorManager,
  authActors = authActorManager?.actors,
  authPendingSources = authActorManager?.pendingSources,
  authRecovery,
  authSources,
  silentAuthSyncDomains,
  credentialAttempts,
  pendingSourceOpens,
  verifiedSessions,
  getAuthEpoch,
  isExplicitlyLoggedOut = () => false,
  setExplicitlyLoggedOut = () => {},
  getSyncService,
  getSyncOrchestrator,
  getFitnessRuntime,
  getCredentialVault,
  getCourseWorkQueue,
  getSchoolProxyReady,
  verifiedStatus,
  freshSourceStatus,
  rememberVerifiedSession,
  loginTargetDetails,
  sourceWindowOptions,
  guardSourceWindow,
  loadSourceWindowUrl,
  createSourceWindow,
  closeWindowAndWait,
  assertAuthEpoch,
  getUnifiedAuthVerification = () => null,
  requestUnifiedAuthVerification,
  broadcastAuthStatus,
  diagnosticUrl,
  diagnosticError,
  writeDiagnostic,
} = {}) {
  if (typeof getAuthEpoch !== 'function') throw new TypeError('auth runtime requires getAuthEpoch')
  if (typeof authActorManager?.isCurrent !== 'function') throw new TypeError('auth runtime requires an actor manager')

  function isTrustedBuctAuthHostname(value) {
    const hostname = String(value || '').trim().toLowerCase()
    return hostname === 'buct.edu.cn' || hostname.endsWith('.buct.edu.cn')
  }

  function isCurrentAuthActor(actor, window = actor?.window) {
    if (!window) return false
    return authActorManager.isCurrent(actor, window)
  }

  function installAuthDiagnostics(actor) {
    const dependencies = { isCurrentAuthActor, writeDiagnostic, diagnosticError }
    return Promise.all([
      installAuthDebuggerDiagnostics(actor, dependencies),
      installAuthNetworkDiagnostics(actor, dependencies),
    ])
  }

  function clearAuthActorTimers(actor) {
    if (actor.pollTimer) clearInterval(actor.pollTimer)
    actor.pollTimer = null
    if (actor.timeoutTimer) clearTimeout(actor.timeoutTimer)
    actor.timeoutTimer = null
    for (const timer of actor.credentialTimers) clearTimeout(timer)
    actor.credentialTimers.clear()
  }

  function removePendingSourceOpens(source) {
    for (let index = pendingSourceOpens.length - 1; index >= 0; index -= 1) {
      if (pendingSourceOpens[index].source === source) pendingSourceOpens.splice(index, 1)
    }
  }

  function getUnifiedVerificationPromise(epoch) {
    const verification = getUnifiedAuthVerification?.()
    if (!verification || verification.epoch !== epoch || verification.settled) return null
    return verification.promise && typeof verification.promise.then === 'function'
      ? verification.promise
      : null
  }

  async function autoFillSavedCredentials(actor) {
    const window = actor?.window
    if (!isCurrentAuthActor(actor, window)) return
    const { source, epoch } = actor
    const authFrames = window.webContents.mainFrame.framesInSubtree.filter((frame) => {
      try { return isTrustedBuctAuthHostname(new URL(frame.url).hostname) }
      catch { return false }
    })
    if (!authFrames.length) return

    const credentials = await getCredentialVault().readCredentials()
    if (!isCurrentAuthActor(actor, window) || actor.epoch !== epoch) return
    if (!credentials) return
    const attemptKey = `${source}:unified:${credentials.updatedAt || ''}`
    const attempt = credentialAttempts.get(window.webContents.id)
    if (attempt?.key === attemptKey) {
      if (attempt.inFlight || attempt.submittedAt) return
    }
    if (Number(actor.credentialSubmitCount || 0) >= AUTH_CREDENTIAL_MAX_SUBMISSIONS) return

    // Mark the probe while the renderer call is in flight. Frame-load events
    // arrive in parallel with the timers below, so this guard must be set before
    // executeJavaScript rather than after the result comes back.
    credentialAttempts.set(window.webContents.id, { key: attemptKey, inFlight: true, submittedAt: 0 })

    const payload = JSON.stringify(JSON.stringify({ username: credentials.username, password: credentials.password }))
    const script = `(({ username, password }) => {
      const owner = window.parent || window
      const flowKey = String(owner.flowKey || window.flowKey || '').trim()
      const publicKey = String(owner.publicKey || window.publicKey || '').trim()
      const captcha = String(owner.captcha || window.captcha || '').trim()
      const mfa = String(owner.mfa || window.mfa || '').trim()
      const state = {
        flowKeyReady: Boolean(flowKey),
        publicKeyReady: /^[A-Za-z0-9+/=]{40,}$/.test(publicKey),
        captcha: captcha || null,
        mfa: mfa || null,
      }
      if (!state.flowKeyReady || !state.publicKeyReady) {
        return { submitted: false, reason: 'authentication-material-pending', ...state, inputs: [] }
      }
      // CAPTCHA/MFA is intentionally left for the user. The central page can
      // expose the requirement only after the first password response, so this
      // also prevents the bounded retry from repeatedly submitting into it.
      if (state.captcha) return { submitted: false, reason: 'additional-verification-required', ...state, inputs: [] }
      const documents = [document]
      for (const frame of document.querySelectorAll('iframe')) {
        try { if (frame.contentDocument) documents.push(frame.contentDocument) } catch {}
      }
      const visible = (element) => {
        const view = element.ownerDocument.defaultView
        const style = view.getComputedStyle(element)
        return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0
      }
      const setValue = (element, value) => {
        const view = element.ownerDocument.defaultView
        const reactSetter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value')?.set
        if (reactSetter) reactSetter.call(element, value)
        else element.value = value
        element.dispatchEvent(new view.Event('focus', { bubbles: true }))
        element.dispatchEvent(new view.Event('input', { bubbles: true }))
        element.dispatchEvent(new view.Event('change', { bubbles: true }))
        element.dispatchEvent(new view.Event('blur', { bubbles: true }))
      }
      // Collect all visible inputs for diagnostics
      const allInputs = [...document.querySelectorAll('input:not([type="hidden"])')].map(el => ({
        type: el.type, name: el.name, id: el.id, visible: visible(el), value: el.value?.length
      }))
      for (const current of documents) {
        const visibleInputs = [...current.querySelectorAll('input:not([type="hidden"])')].filter(visible)
        const verificationInput = visibleInputs.find((input) => /captcha|验证码|校验码/i.test([input.name, input.id, input.placeholder].filter(Boolean).join(' ')))
        if (verificationInput && !String(verificationInput.value || '').trim()) {
          return { submitted: false, reason: 'additional-verification-required', verificationInputPresent: true, ...state, inputs: allInputs }
        }
        const usernameInput = visibleInputs.find((input) => {
          if (String(input.type || '').toLowerCase() === 'password') return false
          const identifiers = [input.name, input.id, input.autocomplete].filter(Boolean)
          return identifiers.some((value) => /^(?:username|un|yhm|account|user(?:name)?|login(?:name)?)$/i.test(String(value).trim()))
        }) || visibleInputs.find((input) => ['text', 'email', ''].includes(String(input.type || '').toLowerCase()))
        const passwordInput = visibleInputs.find((input) => (
          String(input.type || '').toLowerCase() === 'password'
          || /^(?:password|pwd|mm)$/i.test([input.name, input.id, input.autocomplete].filter(Boolean).join(' ').trim())
        ))
        const submit = [...current.querySelectorAll(
          'button.btn-submit, button[type="submit"], input[type="submit"], a.btn-login, button.login-btn, button[name="login"]'
        )].find(visible)
        if (!usernameInput || !passwordInput) continue
        setValue(usernameInput, username)
        setValue(passwordInput, password)
        if (submit) {
          setTimeout(() => submit.click(), 150)
          return { submitted: true, usernameField: usernameInput.name||usernameInput.id, usernameFilled: usernameInput.value === username, ...state, inputs: allInputs }
        }
        if (passwordInput.form) {
          setTimeout(() => passwordInput.form.requestSubmit(), 150)
          return { submitted: true, usernameField: usernameInput.name||usernameInput.id, usernameFilled: usernameInput.value === username, ...state, inputs: allInputs }
        }
      }
      return { submitted: false, reason: 'login-form-not-ready', ...state, inputs: allInputs }
    })(JSON.parse(${payload}))`
    for (const frame of authFrames) {
      const result = await frame.executeJavaScript(script)
      if (!isCurrentAuthActor(actor, window) || actor.epoch !== epoch) return
      const visibleInputs = result?.inputs?.filter((input) => input.visible) || []
      if (result?.submitted || visibleInputs.length || result?.reason) {
        void writeDiagnostic('auth.credentials_fill_result', {
          source,
          submitted: result?.submitted,
          reason: result?.reason || null,
          flowKeyReady: result?.flowKeyReady === true,
          publicKeyReady: result?.publicKeyReady === true,
          additionalVerification: result?.captcha || null,
          mfa: result?.mfa || null,
          verificationInputPresent: result?.verificationInputPresent === true,
          usernameField: result?.usernameField,
          usernameFilled: result?.usernameFilled,
          inputs: visibleInputs,
        })
      }
      if (result?.submitted) {
        actor.credentialSubmitCount = Number(actor.credentialSubmitCount || 0) + 1
        credentialAttempts.set(window.webContents.id, {
          key: attemptKey,
          inFlight: false,
          submittedAt: Date.now(),
        })
        void writeDiagnostic('auth.credentials_submitted', { source, frame: diagnosticUrl(frame.url) })
        return
      }
    }
    if (isCurrentAuthActor(actor, window)) credentialAttempts.delete(window.webContents.id)
  }

  function scheduleCredentialFill(actor) {
    // Try filling repeatedly while CAS loads the iframe, flow key, public key,
    // and optional verification metadata. The actor submission cap bounds the
    // number of password posts if the provider keeps returning the login form.
    for (const delay of AUTH_CREDENTIAL_RETRY_DELAYS_MS) {
      const timer = setTimeout(() => {
        actor.credentialTimers.delete(timer)
        if (!isCurrentAuthActor(actor)) return
        void autoFillSavedCredentials(actor).catch((error) => {
          if (isCurrentAuthActor(actor)) {
            void writeDiagnostic('auth.credentials_fill_failed', { source: actor.source, error: diagnosticError(error) })
          }
        })
      }, delay)
      actor.credentialTimers.add(timer)
    }
  }

  async function pollAuthStatus(actor) {
    const window = actor?.window
    if (!isCurrentAuthActor(actor, window) || actor.pollActive) return
    const { source, epoch } = actor
    actor.pollActive = true
    try {
      const sourceHost = source === 'jwglxt'
        ? 'jwglxt.buct.edu.cn'
        : source === 'tygl'
          ? 'tygl.buct.edu.cn'
          : 'course.buct.edu.cn'
      const sourceFrames = [...(window.webContents.mainFrame.framesInSubtree || [])].filter((frame) => {
        if (!frame) return false
        try { return new URL(frame.url).hostname === sourceHost }
        catch { return false }
      })
      let authenticatedUrl = null
      for (const frame of sourceFrames) {
        let html
        try {
          html = await frame.executeJavaScript('document.documentElement ? document.documentElement.outerHTML : ""')
        } catch (error) {
          // A frame can disappear between framesInSubtree and evaluation while
          // CAS is redirecting. Ignore that frame and keep polling the others.
          if (isCurrentAuthActor(actor, window) && diagnosticError(error) !== actor.lastPollError) {
            actor.lastPollError = diagnosticError(error)
            void writeDiagnostic('auth.frame_poll_skipped', { source, error: actor.lastPollError })
          }
          continue
        }
        if (!isCurrentAuthActor(actor, window) || actor.epoch !== epoch) return
        if (!html) continue
        const loggedIn = source === 'jwglxt'
          ? parseJwHomepage(html, frame.url).loggedIn
          : source === 'theol'
            ? parseTheolHome(html, frame.url).loggedIn
            : !/统一身份认证|normal\/login|cas\/login/i.test(html)
        if (loggedIn) {
          authenticatedUrl = frame.url
          break
        }
      }
      if (authenticatedUrl) {
        await rememberVerifiedSession(source, authenticatedUrl, epoch)
        if (!isCurrentAuthActor(actor, window) || actor.epoch !== epoch) return
        actor.authenticated = true
        actor.lastPollError = null
        authPendingSources.delete(source)
        void writeDiagnostic('auth.source_authenticated', { source, url: diagnosticUrl(authenticatedUrl) })
        window.__theiaAuthComplete = true
        clearAuthActorTimers(actor)
        window.close()
      }
    } catch (error) {
      const message = diagnosticError(error)
      if (isCurrentAuthActor(actor, window) && message !== actor.lastPollError) {
        actor.lastPollError = message
        void writeDiagnostic('auth.poll_failed', { source, error: message })
      }
    }
    finally { actor.pollActive = false }
  }

  async function sourceAlreadyAuthenticated(actor) {
    const syncService = getSyncService()
    if (actor.source === 'tygl') return { connected: await getFitnessRuntime().fitnessSessionReady() }
    if (actor.requireBrowser && actor.source === 'jwglxt') {
      const adapter = syncService.jwglxt
      if (typeof adapter.browserStatus === 'function') return adapter.browserStatus()
      if (typeof adapter.browserAdapter?.status === 'function') return adapter.browserAdapter.status()
    }
    const verified = await verifiedStatus(actor.source)
    if (verified) return verified
    return syncService[actor.source].status()
  }

  async function runAuthActor(actor) {
    const syncService = getSyncService()
    if (actor.source === 'theol') {
      actor.resumeAssignments = syncService.pauseAssignmentScan()
      await syncService.waitForAssignmentScan()
      if (actor.invalidated || actor.epoch !== getAuthEpoch()) return
    }

    const runLifecycle = async () => {
      if (actor.invalidated || actor.epoch !== getAuthEpoch() || authActors.get(actor.source) !== actor) return
      const status = await sourceAlreadyAuthenticated(actor)
      if (actor.invalidated || actor.epoch !== getAuthEpoch() || authActors.get(actor.source) !== actor) return
      if (status.connected) {
        actor.sessionReused = true
        if (!verifiedSessions[actor.source] && actor.source !== 'tygl') {
          await rememberVerifiedSession(actor.source, status.url || loginTargetDetails(actor.source).url, actor.epoch)
          if (actor.invalidated || actor.epoch !== getAuthEpoch() || authActors.get(actor.source) !== actor) return
        }
        actor.authenticated = true
        actor.resolveOpened()
        return
      }

      const target = loginTargetDetails(actor.source)
      const window = new BrowserWindow(sourceWindowOptions({ title: target.title, width: 1100, height: 760, show: false }))
      actor.window = window
      guardSourceWindow(window, {
        source: actor.source,
        theolActor: actor.source === 'theol' ? actor : null,
        theolLease: actor.source === 'theol',
        upgradeTyglRedirects: actor.source === 'tygl',
      })
      const webContentsId = window.webContents.id
      window.on('closed', () => {
        clearAuthActorTimers(actor)
        credentialAttempts.delete(webContentsId)
        actor.resolveOpened()
        if (actor.source !== 'theol') actor.resolveClosed()
        void writeDiagnostic('auth.window_closed', { source: actor.source, completed: Boolean(window.__theiaAuthComplete) })
      })
      window.webContents.on('did-navigate', (_event, url, httpResponseCode, _httpStatusText, isMainFrame) => {
        if (!isCurrentAuthActor(actor, window)) return
        void writeDiagnostic('auth.navigated', {
          source: actor.source,
          url: diagnosticUrl(url),
          httpResponseCode,
          isMainFrame,
        })
        void installAuthDiagnostics(actor)
        scheduleCredentialFill(actor)
        void pollAuthStatus(actor)
      })
      window.webContents.on('did-navigate-in-page', () => {
        if (!isCurrentAuthActor(actor, window)) return
        void installAuthDiagnostics(actor)
        scheduleCredentialFill(actor)
        void pollAuthStatus(actor)
      })
      window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isCurrentAuthActor(actor, window)) return
        void writeDiagnostic('auth.navigation_failed', {
          source: actor.source,
          errorCode,
          error: diagnosticError(errorDescription),
          url: diagnosticUrl(validatedURL),
          isMainFrame,
        })
      })
      window.webContents.on('did-frame-finish-load', () => {
        void installAuthDiagnostics(actor)
        scheduleCredentialFill(actor)
      })
      window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        const text = String(message || '')
        const prefix = '__THEIA_AUTH_RESPONSE__'
        if (!text.startsWith(prefix)) return
        try {
          const record = JSON.parse(text.slice(prefix.length))
          void writeDiagnostic('auth.endpoint_response', {
            source: actor.source,
            kind: record?.kind || null,
            url: record?.url || null,
            status: Number.isFinite(record?.status) ? record.status : null,
            code: record?.code ?? null,
            msg: typeof record?.msg === 'string' ? record.msg : null,
            level,
            line: Number(line) || null,
            frame: diagnosticUrl(sourceId),
          })
        } catch (error) {
          void writeDiagnostic('auth.endpoint_response_parse_failed', { source: actor.source, error: diagnosticError(error) })
        }
      })
      actor.pollTimer = setInterval(() => { void pollAuthStatus(actor) }, 800)
      void writeDiagnostic('auth.target_loading', { source: actor.source, url: diagnosticUrl(target.url) })
      void loadSourceWindowUrl(window, target.url).catch((error) => {
        if (error?.code === 'ERR_ABORTED' || !isCurrentAuthActor(actor, window)) return
        void writeDiagnostic('auth.target_load_failed', { source: actor.source, error: diagnosticError(error) })
        console.error('[THEIA] authentication page failed to load', error)
      })
      scheduleCredentialFill(actor)
      void pollAuthStatus(actor)
      actor.resolveOpened()
      // Campus authentication is fully headless. A failed or interactive
      // provider flow is closed after the bounded attempt instead of exposing
      // a login window or allowing it to outlive the main application.
      actor.timeoutTimer = setTimeout(() => {
        actor.timeoutTimer = null
        if (!isCurrentAuthActor(actor, window)) return
        void writeDiagnostic('auth.window_timeout_closed', {
          source: actor.source,
          background: Boolean(actor.background),
          timeoutMs: AUTH_WINDOW_TIMEOUT_MS,
        })
        void closeWindowAndWait(window).catch((error) => {
          if (isCurrentAuthActor(actor, window)) {
            void writeDiagnostic('auth.window_timeout_close_failed', {
              source: actor.source,
              error: diagnosticError(error),
            })
          }
        })
      }, AUTH_WINDOW_TIMEOUT_MS)
      await actor.closed
    }

    // Holding this lease for the complete THEOL login window lifetime also
    // serializes requests caused by form submission and redirect navigation.
    if (actor.source === 'theol') await syncService.runTheolExclusive(runLifecycle)
    else await runLifecycle()
  }

  async function finishAuthActor(actor) {
    const syncService = getSyncService()
    const syncOrchestrator = getSyncOrchestrator()
    actor.resolveOpened()
    clearAuthActorTimers(actor)
    actor.resumeAssignments?.({ schedule: false })
    actor.resumeAssignments = null
    if (authActors.get(actor.source) === actor) authActors.delete(actor.source)
    authPendingSources.delete(actor.source)
    if (!actor.authenticated) removePendingSourceOpens(actor.source)
    if (actor.invalidated || actor.epoch !== getAuthEpoch() || isExplicitlyLoggedOut()) return
    const isCampusSource = actor.source === 'jwglxt' || actor.source === 'theol'
    // A user-facing CAS login may finish one service before the other service's
    // redirect has completed. Start the shared verification immediately, but
    // only await it from the final pending campus actor. The actor manager
    // serializes lifecycles, so awaiting here from the first actor would keep
    // the second actor queued until the verification timeout expires.
    const unifiedVerification = actor.authenticated && actor.userInitiated && isCampusSource
      ? requestUnifiedAuthVerification({ epoch: actor.epoch, sync: true, reason: 'user-login' })
      : actor.userInitiated && isCampusSource
        ? getUnifiedVerificationPromise(actor.epoch)
        : null
    const hasPendingCampusActor = [...authPendingSources].some((source) => source === 'jwglxt' || source === 'theol')
    await broadcastAuthStatus({ sources: [actor.source] })
    if (!actor.authenticated || actor.epoch !== getAuthEpoch() || isExplicitlyLoggedOut()) {
      if (!actor.authenticated && actor.epoch === getAuthEpoch() && !isExplicitlyLoggedOut() && unifiedVerification && !hasPendingCampusActor) {
        await unifiedVerification
      }
      return
    }
    const recovery = authRecovery[actor.source]
    recovery.lastAt = Date.now()
    recovery.failures = 0
    if (actor.source === 'theol') syncService.enableAssignmentScan({ schedule: false })
    if (actor.source === 'theol') syncOrchestrator.scheduleTheolCourseDetailsPrefetch({ reason: actor.skipSync ? 'source_open' : 'authenticated' })
    if (isCampusSource && !unifiedVerification) {
      // A saved cookie/session is still a valid source of fresh data. The old
      // sessionReused shortcut made startup silently skip every existing record,
      // leaving the renderer with stale data and domains stuck at "等待本轮获取".
      // Source-page actors explicitly set skipSync and remain cheap.
      const shouldRefresh = !actor.skipSync
      if (!shouldRefresh) {
        void writeDiagnostic('sync.post_auth_skipped', {
          source: actor.source,
          reason: actor.skipSync ? 'source_open' : 'session_reused',
        })
      }
      if (shouldRefresh) {
        try {
          // The actor lifecycle (and therefore the THEOL lease) has completed
          // before source-scoped synchronization is queued here.
          const syncOptions = actor.userInitiated
            ? {
              sources: [actor.source],
              domains: actor.source === 'jwglxt' ? ['profile', 'terms', 'courses', 'schedule', 'grades', 'exams', 'selected-courses', 'academic-progress', 'notices'] : ['courses', 'notices'],
              foreground: true,
            }
            : { sources: [actor.source], domains: silentAuthSyncDomains[actor.source] || [] }
          if (actor.userInitiated) {
            await syncOrchestrator.syncForegroundCampusData()
          } else {
            await syncService.syncNow(syncOptions)
          }
        } catch (error) {
          if (actor.epoch === getAuthEpoch() && !isExplicitlyLoggedOut()) {
            void writeDiagnostic('sync.post_auth_failed', { source: actor.source, error: diagnosticError(error) })
          }
        }
      }
    }
    if (unifiedVerification && !hasPendingCampusActor) await unifiedVerification
    if (actor.epoch === getAuthEpoch() && !isExplicitlyLoggedOut()) {
      await flushPendingSourceOpens(actor.source, actor.epoch)
      if (actor.source === 'jwglxt') syncOrchestrator.scheduleAcademicStaticPrefetch({ reason: actor.skipSync ? 'source_open' : 'authenticated' })
    }
  }

  async function openLoginWindow({ background = false, sources, expectedEpoch = getAuthEpoch(), userInitiated = false, requireBrowser = false, skipSync = false } = {}) {
    assertAuthEpoch(expectedEpoch, { allowLoggedOut: userInitiated })
    const syncService = getSyncService()
    if (userInitiated) {
      syncService.enable()
      setExplicitlyLoggedOut(false)
      await getCourseWorkQueue()?.setEnabled(true)
    }
    const requestedSources = Array.isArray(sources) && sources.length
      ? [...new Set(sources.filter((source) => authSources.includes(source)))]
      // The shared actor queue is intentionally serial. Start with JWGLXT so a
      // slow THEOL redirect cannot block course selection and academic sync.
      : ['jwglxt', 'theol']
    void writeDiagnostic('auth.open_requested', { background, sources: requestedSources })
    const actors = await authActorManager.open({
      background,
      requestedSources,
      expectedEpoch,
      userInitiated,
      skipSync: skipSync || (!userInitiated && !background
        && requestedSources.length === 1 && requestedSources[0] === 'jwglxt'),
      // The JWGLXT API and the rendered browser use separate cookie jars. Any
      // JWGLXT login actor must therefore establish the browser session too.
      requireBrowser: requireBrowser
        || (requestedSources.includes('jwglxt') && (requestedSources.length === 1 || background)),
    })
    assertAuthEpoch(expectedEpoch)
    // Publish the intermediate state immediately. The renderer can then show a
    // neutral CAS-verification indicator while either campus redirect is still
    // open instead of retaining an old warning from the previous probe.
    void broadcastAuthStatus()
    return actors
  }

  async function freshJwglxtBrowserStatus(expectedEpoch = getAuthEpoch()) {
    assertAuthEpoch(expectedEpoch)
    const adapter = getSyncService()?.jwglxt
    const status = typeof adapter?.browserStatus === 'function'
      ? await adapter.browserStatus()
      : await freshSourceStatus('jwglxt')
    assertAuthEpoch(expectedEpoch)
    return status
  }

  async function recoverCourseSelectionReadSession(expectedEpoch = getAuthEpoch()) {
    const epoch = expectedEpoch
    assertAuthEpoch(epoch)
    await getSchoolProxyReady().catch(() => undefined)
    assertAuthEpoch(epoch)

    let status = await freshJwglxtBrowserStatus(epoch)
    if (status?.connected) {
      await rememberVerifiedSession('jwglxt', status.url || JWGLXT_URLS.home, epoch)
      return status
    }

    const credentials = await getCredentialVault().status().catch(() => ({ saved: false }))
    void writeDiagnostic('course_selection.read_browser_auth_started', {
      background: Boolean(credentials?.saved),
    })
    const actors = await openLoginWindow({
      background: Boolean(credentials?.saved),
      sources: ['jwglxt'],
      expectedEpoch: epoch,
      requireBrowser: true,
      skipSync: true,
    })
    const actor = actors?.find?.((candidate) => candidate?.source === 'jwglxt')
    if (actor?.lifecycle) await actor.lifecycle
    assertAuthEpoch(epoch)

    status = await freshJwglxtBrowserStatus(epoch)
    if (!status?.connected) {
      void writeDiagnostic('course_selection.read_browser_auth_failed', {
        actorAuthenticated: Boolean(actor?.authenticated),
      })
      throw new AuthRequiredError('Course selection', status?.url || JWGLXT_URLS.home)
    }
    await rememberVerifiedSession('jwglxt', status.url || JWGLXT_URLS.home, epoch)
    void writeDiagnostic('course_selection.read_browser_auth_succeeded', {})
    return status
  }

  async function flushPendingSourceOpens(source, epoch = getAuthEpoch()) {
    const requests = pendingSourceOpens.filter((request) => request.source === source)
    for (let index = pendingSourceOpens.length - 1; index >= 0; index -= 1) {
      if (pendingSourceOpens[index].source === source) pendingSourceOpens.splice(index, 1)
    }
    for (const request of requests) {
      if (isExplicitlyLoggedOut() || epoch !== getAuthEpoch()) return
      try {
        await createSourceWindow(request.url, request.title, { pauseAssignments: source === 'theol' })
      } catch (error) { console.error('[THEIA] source window failed', error) }
    }
  }

  async function closeLiveCaptureActors(reason = 'live capture finished') {
    const actors = authActorManager.invalidateAll({ reason, pendingSourceOpens })
    await Promise.allSettled(actors.flatMap((actor) => [
      actor.window,
      ...(actor.windows ? [...actor.windows] : []),
    ].filter((window) => window && !window.isDestroyed()).map((window) => closeWindowAndWait(window))))
    await Promise.allSettled(actors.map((actor) => actor.lifecycle))
  }

  async function waitForLiveCaptureAuthentication(actors, timeoutMs = 120_000) {
    const lifecycle = Promise.all((actors || []).map((actor) => actor.lifecycle || Promise.resolve()))
    let timer
    try {
      await Promise.race([
        lifecycle,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`教务浏览器认证超时（${timeoutMs} ms）`)), timeoutMs)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
    const status = await verifiedStatus('jwglxt')
    if (!status?.connected) throw new AuthRequiredError('Academic system', status?.url || JWGLXT_URLS.home)
    return status
  }

  return Object.freeze({
    clearAuthActorTimers,
    openLoginWindow,
    freshJwglxtBrowserStatus,
    recoverCourseSelectionReadSession,
    closeLiveCaptureActors,
    waitForLiveCaptureAuthentication,
    runAuthActor,
    finishAuthActor,
    flushPendingSourceOpens,
  })
}
