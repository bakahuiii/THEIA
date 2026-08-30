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
    authActorManager: { isCurrent: () => true },
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
