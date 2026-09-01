import test from 'node:test'
import assert from 'node:assert/strict'
import { createAuthRuntime } from '../electron/auth-runtime.mjs'

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function createFinishRuntime({ authActors, authPendingSources, getUnifiedAuthVerification, requestUnifiedAuthVerification }) {
  return createAuthRuntime({
    authActorManager: {
      isCurrent: () => true,
      open: async () => [{ source: 'theol', authenticated: true, lifecycle: Promise.resolve() }],
    },
    authActors,
    authPendingSources,
    authRecovery: {
      jwglxt: { failures: 0, lastAt: 0 },
      theol: { failures: 0, lastAt: 0 },
    },
    authSources: ['jwglxt', 'theol'],
    silentAuthSyncDomains: {},
    credentialAttempts: new Map(),
    pendingSourceOpens: [],
    verifiedSessions: {},
    getAuthEpoch: () => 1,
    getSyncService: () => {},
    getSyncOrchestrator: () => ({
      scheduleAcademicStaticPrefetch: () => {},
      scheduleTheolCourseDetailsPrefetch: () => {},
    }),
    getUnifiedAuthVerification,
    requestUnifiedAuthVerification,
    broadcastAuthStatus: async () => {},
  })
}

function actor(source, authenticated) {
  return {
    source,
    epoch: 1,
    authenticated,
    userInitiated: true,
    invalidated: false,
    skipSync: true,
    credentialTimers: new Set(),
    resolveOpened: () => {},
    resumeAssignments: null,
  }
}

test('failed final campus actor waits for a unified verification started by a prior success', async () => {
  const authActors = new Map()
  const authPendingSources = new Set(['jwglxt', 'theol'])
  const verification = deferred()
  let verificationState = null
  let verificationRequests = 0
  const runtime = createFinishRuntime({
    authActors,
    authPendingSources,
    getUnifiedAuthVerification: () => verificationState,
    requestUnifiedAuthVerification: () => {
      verificationRequests += 1
      verificationState = { epoch: 1, settled: false, promise: verification.promise }
      return verification.promise
    },
  })
  const successfulActor = actor('jwglxt', true)
  const failedActor = actor('theol', false)
  authActors.set(successfulActor.source, successfulActor)
  authActors.set(failedActor.source, failedActor)

  await runtime.finishAuthActor(successfulActor)
  assert.equal(verificationRequests, 1)

  let finished = false
  const failedFinish = runtime.finishAuthActor(failedActor).then(() => { finished = true })
  await Promise.resolve()
  assert.equal(finished, false)

  verification.resolve({})
  await failedFinish
  assert.equal(finished, true)
})

test('a failed campus login does not start unified verification by itself', async () => {
  let verificationRequests = 0
  const runtime = createFinishRuntime({
    authActors: new Map([['jwglxt', actor('jwglxt', false)]]),
    authPendingSources: new Set(['jwglxt']),
    getUnifiedAuthVerification: () => null,
    requestUnifiedAuthVerification: () => {
      verificationRequests += 1
      return Promise.resolve(null)
    },
  })

  await runtime.finishAuthActor(actor('jwglxt', false))
  assert.equal(verificationRequests, 0)
})

test('THEOL read recovery clears a stale verification and waits for the login actor', async () => {
  const verifiedSessions = { theol: { cookieValue: 'stale' } }
  const statuses = [
    { connected: false, authRequired: true, url: 'https://course.buct.edu.cn/meol/personal.do' },
    { connected: true, url: 'https://course.buct.edu.cn/meol/personal.do' },
  ]
  const loginRequests = []
  const remembered = []
  const openedActor = { source: 'theol', authenticated: true, lifecycle: Promise.resolve() }
  const runtime = createAuthRuntime({
    authActorManager: {
      isCurrent: () => true,
      open: async (options) => {
        loginRequests.push(options)
        return [openedActor]
      },
    },
    authActors: new Map(),
    authPendingSources: new Set(),
    authRecovery: { jwglxt: {}, theol: {} },
    authSources: ['jwglxt', 'theol'],
    silentAuthSyncDomains: {},
    credentialAttempts: new Map(),
    pendingSourceOpens: [],
    verifiedSessions,
    getAuthEpoch: () => 1,
    getSyncService: () => ({}),
    getSyncOrchestrator: () => ({}),
    getCredentialVault: () => ({ status: async () => ({ saved: true }) }),
    getSchoolProxyReady: () => Promise.resolve(),
    freshSourceStatus: async () => statuses.shift(),
    rememberVerifiedSession: async (source, url, epoch) => remembered.push({ source, url, epoch }),
    loginTargetDetails: () => ({ url: 'https://course.buct.edu.cn/meol/homepage/common/sso_login.jsp' }),
    assertAuthEpoch: () => {},
    broadcastAuthStatus: async () => {},
    writeDiagnostic: () => {},
  })

  const result = await runtime.recoverTheolReadSession(1)
  assert.equal(result.connected, true)
  assert.equal(verifiedSessions.theol, null)
  assert.deepEqual(loginRequests, [{
    background: true,
    requestedSources: ['theol'],
    expectedEpoch: 1,
    userInitiated: false,
    requireBrowser: true,
    skipSync: true,
  }])
  assert.deepEqual(remembered, [{
    source: 'theol',
    url: 'https://course.buct.edu.cn/meol/personal.do',
    epoch: 1,
  }])
})
