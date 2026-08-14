import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import {
  createAdvisorReadOnlyTools,
  createAiDataAccessAudit,
  executeAdvisorReadOnlyTool,
} from '../core/advisor/index.mjs'
import { AdvisorStore } from '../electron/advisor-store.mjs'
import { AdvisorRuntime } from '../electron/advisor-runtime.mjs'
import { readBoundedSse } from '../electron/model-service.mjs'
import { versionedState } from './fixtures/advisor-fixtures.mjs'

function fakeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, 'utf8'),
    decryptString: (value) => Buffer.from(value).toString('utf8'),
  }
}

function stream(chunks) {
  let offset = 0
  return {
    headers: new Headers(),
    body: {
      getReader() {
        return {
          async read() {
            if (offset >= chunks.length) return { done: true }
            return { done: false, value: new TextEncoder().encode(chunks[offset++]) }
          },
          releaseLock() {},
          async cancel() {},
        }
      },
    },
  }
}

test('P6 policy binds all optional disclosure and tools to the exact model service', () => {
  const policy = {
    serviceIdentity: 'https://model.example/v1',
    allowedScopes: ['grades', 'academic-progress'],
    allowedToolScopes: ['claims', 'academic-progress'],
    allowThreadSummary: true,
    allowStreaming: true,
  }
  const audit = createAiDataAccessAudit({
    policy,
    serviceIdentity: 'https://model.example/v1',
    requestedScopes: ['grades'],
    requestedToolScopes: ['claims'],
    threadSummary: true,
    streaming: true,
    snapshotRevision: 'revision-p6-001',
  })
  assert.equal(audit.schema, 'theia-ai-data-access-audit/v1')
  assert.deepEqual(audit.forbiddenCapabilities, [
    'filesystem', 'arbitrary-url', 'network', 'browser-session', 'credentials',
    'sync', 'login', 'course-selection-execution', 'answer-fill', 'mail-send',
    'upload', 'submit', 'shell', 'ipc-proxy',
  ])
  assert.throws(() => createAiDataAccessAudit({
    policy, serviceIdentity: 'https://other.example/v1', requestedScopes: [], snapshotRevision: 'revision-p6-001',
  }), /not bound/)
  assert.throws(() => createAiDataAccessAudit({
    policy, serviceIdentity: policy.serviceIdentity, requestedScopes: ['mail-body'], snapshotRevision: 'revision-p6-001',
  }), /not allowed/)
})

test('P6 read-only tools consume only the projected overview and have no ambient capability', () => {
  const tools = createAdvisorReadOnlyTools({
    snapshotRevision: 'revision-p6-002',
    dataQuality: { schema: 'quality', domains: {} },
    claims: [{ id: 'claim-1', displayText: 'GPA is locally computed', evidenceRefs: ['evidence-1'] }],
    urgentItems: [{ id: 'deadline-1', domain: 'assignments', title: 'Submit work' }],
    risks: [{ id: 'risk-1', domain: 'academic-progress', title: 'Need review' }],
  })
  const claims = executeAdvisorReadOnlyTool(tools, 'find_claims', { query: 'GPA' })
  assert.equal(claims.snapshotRevision, 'revision-p6-002')
  assert.deepEqual(claims.data.matches.map((entry) => entry.id), ['claim-1'])
  assert.equal(Object.hasOwn(tools, 'filesystem'), false)
  assert.equal(Object.hasOwn(tools, 'sync'), false)
  assert.throws(() => executeAdvisorReadOnlyTool(tools, 'open_url', {}), /not allowed/)
})

test('P6 advisor store encrypts records independently and never writes plaintext messages', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-advisor-store-'))
  try {
    const store = new AdvisorStore({ root, storage: fakeStorage() })
    const threads = [{
      id: 'thread-p6-001', title: 'Private', createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z',
      activeRequestId: null, messages: [{ id: 'message-1', role: 'user', at: '2026-08-14T00:00:00.000Z', text: 'PRIVATE_THREAD_TEXT' }],
    }]
    await store.persist(threads)
    const raw = await readFile(resolve(root, 'advisor', 'threads.v1.dpapi.json'), 'utf8')
    assert.equal(raw.includes('PRIVATE_THREAD_TEXT'), false)
    assert.equal((await store.load())[0].messages[0].text, 'PRIVATE_THREAD_TEXT')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('P6 SSE reader enforces structured deltas and returns only accumulated content', async () => {
  const deltas = []
  const text = await readBoundedSse(stream([
    'data: {"choices":[{"delta":{"content":"hello "}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"world"}}]}\n\ndata: [DONE]\n\n',
  ]), 10_000, { onDelta: (value) => deltas.push(value) })
  assert.equal(text, 'hello world')
  assert.deepEqual(deltas, ['hello ', 'world'])
})

test('P6 streams preview deltas but persists only the final citation-verified answer', async () => {
  const events = []
  const value = versionedState({ settings: { modelBaseUrl: 'https://model.example/v1', modelName: 'model-p6' } })
  const runtime = new AdvisorRuntime({
    store: { snapshotWithRevision: () => value },
    modelService: { async status() { return { apiKeySaved: true } } },
    onStream: (event) => events.push(event),
    providerFactory: () => ({
      async generateStream(_request, { onEvent }) {
        onEvent({ type: 'delta', delta: '{"schema":"theia-' })
        onEvent({ type: 'delta', delta: 'advisor-model-narrative/v1","blocks":[],"recommendations":[],"uncertainties":[],"questionsForUser":[],"suggestedActionIds":[]}' })
        return { text: '{"schema":"theia-advisor-model-narrative/v1","blocks":[],"recommendations":[],"uncertainties":[],"questionsForUser":[],"suggestedActionIds":[]}', inputBytes: 1, outputBytes: 1 }
      },
    }),
  })
  const thread = runtime.createThread()
  const prepared = await runtime.prepare({ threadId: thread.id, question: 'hello', intent: 'general' })
  const answer = await runtime.send({ requestId: prepared.requestId, approved: true, stream: true })
  assert.equal(answer.schema, 'theia-advisor-answer/v1')
  assert.equal(events.length, 2)
  assert.equal(runtime.listThreads()[0].messages.length, 2)
})
