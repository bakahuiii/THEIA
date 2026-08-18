import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ADVISOR_THREAD_SUMMARY_TTL_MS,
  AdvisorRuntime,
} from '../electron/advisor-runtime.mjs'
import { versionedState } from './fixtures/advisor-fixtures.mjs'

const NOW = '2026-08-16T04:00:00.000Z'

test('advisor thread evidence summaries expire, persist only while live, and mark revision changes historical', async () => {
  const nowMs = Date.parse(NOW)
  const snapshot = versionedState({ settings: { modelBaseUrl: 'https://models.example.test/v1', modelName: 'test-model' } })
  const expiredAt = new Date(nowMs - 1_000).toISOString()
  const liveAt = new Date(nowMs + ADVISOR_THREAD_SUMMARY_TTL_MS - 1_000).toISOString()
  const thread = {
    id: 'thread-lifecycle',
    title: '生命周期',
    createdAt: NOW,
    updatedAt: NOW,
    messages: [],
    summaries: [
      {
        schema: 'theia-advisor-thread-summary/v1',
        createdAt: new Date(nowMs - ADVISOR_THREAD_SUMMARY_TTL_MS - 10_000).toISOString(),
        expiresAt: expiredAt,
        snapshotRevision: 'old-revision-expired',
        domainDigests: {},
        responseDigest: 'e'.repeat(64),
        evidenceState: 'current',
      },
      {
        schema: 'theia-advisor-thread-summary/v1',
        createdAt: NOW,
        expiresAt: liveAt,
        snapshotRevision: 'old-revision-live',
        domainDigests: {},
        responseDigest: 'l'.repeat(64),
        evidenceState: 'current',
      },
    ],
  }
  const requests = []
  const runtime = new AdvisorRuntime({
    store: { snapshotWithRevision: () => snapshot },
    clock: () => NOW,
    initialThreads: [thread],
    providerFactory: () => ({
      async generateStream(request) {
        requests.push(structuredClone(request))
        return { text: '生命周期已验证。' }
      },
    }),
  })

  assert.equal(runtime.listThreads()[0].summaries.length, 1)
  const prepared = await runtime.prepare({ threadId: thread.id, question: '继续查看。' })
  await runtime.send({ requestId: prepared.requestId })
  const session = JSON.parse(requests[0].messages.at(-1).content)
  assert.equal(session.threadHint.summaries.length, 1)
  assert.equal(session.threadHint.summaries[0].evidenceState, 'historical')
  assert.equal(session.threadHint.summaries[0].responseDigest, 'l'.repeat(64))
  assert.ok(Date.parse(runtime.listThreads()[0].summaries.at(-1).expiresAt) > nowMs)
})
