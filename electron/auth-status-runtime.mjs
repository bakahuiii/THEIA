const UNIFIED_AUTH_VERIFY_WAIT_MS = 30_000
const UNIFIED_AUTH_VERIFY_RETRY_DELAY_MS = 350

export function createAuthStatusRuntime({
  smokeFile,
  verifiedSessions,
  statusChecks,
  forceSourceStatusChecks,
  authPendingSources,
  getStore,
  getSyncService,
  getSyncOrchestrator,
  getSchoolSession,
  getSchoolProxyReady,
  getAuthEpoch,
  isExplicitlyLoggedOut,
  getMainWindow,
  getSourceSessionUrl,
  assertAuthEpoch,
  writeDiagnostic,
  diagnosticError,
  getUnifiedAuthVerification,
  setUnifiedAuthVerification,
} = {}) {
  async function rememberVerifiedSession(source, url, expectedEpoch) {
    const cookies = await getSchoolSession().cookies.get({ url: getSourceSessionUrl(source) })
    assertAuthEpoch(expectedEpoch)
    const sessionCookie = cookies.find((cookie) => cookie.name === 'JSESSIONID')
    if (!sessionCookie?.value) return
    verifiedSessions[source] = {
      cookieValue: sessionCookie.value,
      checkedAt: new Date().toISOString(),
      url,
    }
  }

  async function verifiedStatus(source) {
    const verified = verifiedSessions[source]
    if (!verified) return null
    if (verified.cookieValue) {
      const cookies = await getSchoolSession().cookies.get({ url: getSourceSessionUrl(source) })
      const matches = cookies.some((cookie) => cookie.name === 'JSESSIONID' && cookie.value === verified.cookieValue)
      if (!matches) {
        verifiedSessions[source] = null
        return null
      }
    }
    return { connected: true, checkedAt: verified.checkedAt, url: verified.url }
  }

  function sourceStatus(source) {
    if (statusChecks[source]) return statusChecks[source]
    const cached = getStore()?.snapshot()?.sync?.sources?.[source]
    const syncService = getSyncService()
    if (!forceSourceStatusChecks.has(source)
      && source === 'theol'
      && (syncService.assignmentActive || syncService.assignmentTimer)
      && cached?.connected) {
      return Promise.resolve(cached)
    }
    const adapter = syncService[source]
    const epoch = getAuthEpoch()
    const check = getSchoolProxyReady()
      .catch(() => undefined)
      .then(() => {
        assertAuthEpoch(epoch)
        return source === 'theol'
          ? syncService.runTheolExclusive(() => {
            assertAuthEpoch(epoch)
            return adapter.status()
          })
          : adapter.status()
      })
      .finally(() => {
        if (statusChecks[source] === check && getAuthEpoch() === epoch) statusChecks[source] = null
      })
    statusChecks[source] = check
    return check
  }

  function invalidateSourceStatus(source) {
    statusChecks[source] = null
  }

  function freshSourceStatus(source) {
    forceSourceStatusChecks.add(source)
    const check = sourceStatus(source)
    return check.finally(() => forceSourceStatusChecks.delete(source))
  }

  function cachedStatus(source) {
    const cached = getStore()?.snapshot()?.sync?.sources?.[source]
    if (!cached || typeof cached.connected !== 'boolean') {
      return { connected: false, checkedAt: null, unchecked: true }
    }
    return {
      connected: cached.connected,
      checkedAt: cached.checkedAt || null,
      ...(cached.url ? { url: cached.url } : {}),
      ...(cached.authRequired ? { authRequired: true } : {}),
      cached: true,
    }
  }

  function loggedOutStatus() {
    const checkedAt = new Date().toISOString()
    return {
      jwglxt: { connected: false, checkedAt },
      theol: { connected: false, checkedAt },
    }
  }

  function campusAuthActorsPending() {
    return [...authPendingSources].some((source) => source === 'jwglxt' || source === 'theol')
  }

  function unifiedAuthVerificationPending(epoch = getAuthEpoch()) {
    const verification = getUnifiedAuthVerification()
    return Boolean(verification
      && verification.epoch === epoch
      && !verification.settled)
  }

  function pendingAuthStatus(verified = null) {
    return {
      ...(verified || {}),
      connected: Boolean(verified?.connected),
      checkedAt: verified?.checkedAt || new Date().toISOString(),
      authPending: true,
    }
  }

  function waitForAuthVerificationDelay(delayMs) {
    return new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs))
  }

  function requestUnifiedAuthVerification({ epoch = getAuthEpoch(), sync = false, reason = 'login' } = {}) {
    if (epoch !== getAuthEpoch() || isExplicitlyLoggedOut()) return Promise.resolve(null)
    const existing = getUnifiedAuthVerification()
    if (existing && existing.epoch === epoch) {
      existing.sync = existing.sync || sync
      return existing.promise
    }

    const state = { epoch, sync, reason, settled: false, promise: null }
    const run = (async () => {
      const deadline = Date.now() + UNIFIED_AUTH_VERIFY_WAIT_MS
      while (campusAuthActorsPending() && Date.now() < deadline) {
        await waitForAuthVerificationDelay(100)
        assertAuthEpoch(epoch)
      }

      let statuses = null
      for (let attempt = 0; attempt < 2; attempt += 1) {
        assertAuthEpoch(epoch)
        const [jwglxt, theol] = await Promise.all([
          freshSourceStatus('jwglxt'),
          freshSourceStatus('theol'),
        ])
        statuses = { jwglxt, theol }
        if ((jwglxt?.connected && theol?.connected) || attempt === 1) break
        await waitForAuthVerificationDelay(UNIFIED_AUTH_VERIFY_RETRY_DELAY_MS)
      }

      assertAuthEpoch(epoch)
      for (const source of ['jwglxt', 'theol']) {
        const status = statuses?.[source]
        if (status?.connected) {
          await rememberVerifiedSession(source, status.url || getSourceSessionUrl(source), epoch)
        } else {
          verifiedSessions[source] = null
        }
      }
      const finalStatus = {
        jwglxt: { ...(statuses?.jwglxt || { connected: false }), authPending: false },
        theol: { ...(statuses?.theol || { connected: false }), authPending: false },
      }
      await broadcastAuthStatus({ statusOverride: finalStatus })
      if (state.sync && (finalStatus.jwglxt.connected || finalStatus.theol.connected)) {
        try {
          await getSyncOrchestrator().syncForegroundCampusData()
        } catch (error) {
          void writeDiagnostic('sync.post_unified_auth_failed', { reason, error: diagnosticError(error) })
        }
      }
      return finalStatus
    })()

    state.promise = run
      .catch((error) => {
        if (epoch === getAuthEpoch() && !isExplicitlyLoggedOut()) {
          void writeDiagnostic('auth.unified_verification_failed', { reason, error: diagnosticError(error) })
          void broadcastAuthStatus()
        }
        return null
      })
      .finally(() => {
        state.settled = true
        if (getUnifiedAuthVerification() === state) setUnifiedAuthVerification(null)
      })
    setUnifiedAuthVerification(state)
    return state.promise
  }

  async function getStatus(options = {}) {
    if (smokeFile) {
      const checkedAt = new Date().toISOString()
      return {
        jwglxt: { connected: false, checkedAt, offlineSmoke: true },
        theol: { connected: false, checkedAt, offlineSmoke: true },
      }
    }
    if (isExplicitlyLoggedOut()) return loggedOutStatus()
    const probeSources = Array.isArray(options?.sources)
      ? new Set(options.sources.filter((source) => ['jwglxt', 'theol'].includes(source)))
      : null
    const [verifiedJwglxt, verifiedTheol] = await Promise.all([
      verifiedStatus('jwglxt'),
      verifiedStatus('theol'),
    ])
    const unifiedPending = unifiedAuthVerificationPending()
    const [jwglxt, theol] = await Promise.all([
      verifiedJwglxt
        ? (unifiedPending ? pendingAuthStatus(verifiedJwglxt) : verifiedJwglxt)
        : (authPendingSources.has('jwglxt') || unifiedPending
          ? pendingAuthStatus()
          : probeSources && !probeSources.has('jwglxt') ? cachedStatus('jwglxt') : sourceStatus('jwglxt')),
      verifiedTheol
        ? (unifiedPending ? pendingAuthStatus(verifiedTheol) : verifiedTheol)
        : (authPendingSources.has('theol') || unifiedPending
          ? pendingAuthStatus()
          : probeSources && !probeSources.has('theol') ? cachedStatus('theol') : sourceStatus('theol')),
    ])
    if (isExplicitlyLoggedOut()) return loggedOutStatus()
    return { jwglxt, theol }
  }

  async function broadcastAuthStatus(options) {
    const authStatus = options?.statusOverride || await getStatus(options).catch(() => ({ jwglxt: { connected: false }, theol: { connected: false } }))
    const window = getMainWindow()
    if (window && !window.isDestroyed()) window.webContents.send('theia:auth-status', authStatus)
    if (window && !window.isDestroyed()) {
      const labels = { jwglxt: '教务系统', theol: '北化在线THEOL', tygl: '健康云体测系统' }
      for (const source of authPendingSources) {
        window.webContents.send('theia:sync-progress', {
          stage: 'login',
          status: 'syncing',
          label: `正在登录 ${labels[source] || source}…`,
        })
      }
    }
    return authStatus
  }

  return {
    rememberVerifiedSession,
    verifiedStatus,
    sourceStatus,
    freshSourceStatus,
    invalidateSourceStatus,
    cachedStatus,
    loggedOutStatus,
    requestUnifiedAuthVerification,
    getStatus,
    broadcastAuthStatus,
  }
}
