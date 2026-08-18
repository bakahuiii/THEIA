import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import {
  createAdvisorReadOnlyTools,
  createAiDataAccessAudit,
  executeAdvisorReadOnlyTool,
} from '../core/advisor/index.mjs'
import { AdvisorStore } from '../electron/advisor-store.mjs'
import { AdvisorRuntime } from '../electron/advisor-runtime.mjs'
import { readBoundedEventStream } from '../electron/model-service.mjs'
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
    const envelope = JSON.parse(raw)
    assert.equal(envelope.schema, 'theia-advisor-store/v2')
    assert.equal(envelope.protection, 'safeStorage-aes-256-gcm')
    assert.equal(envelope.records[0].aad, 'theia-advisor-store/v2:thread-p6-001')
    assert.match(envelope.records[0].nonce, /^[A-Za-z0-9+/]+=*$/)
    assert.match(envelope.records[0].authTag, /^[A-Za-z0-9+/]+=*$/)
    assert.equal((await store.load())[0].messages[0].text, 'PRIVATE_THREAD_TEXT')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('P6 advisor store rejects a record whose authenticated metadata was changed', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-advisor-store-tamper-'))
  try {
    const diagnostics = []
    const store = new AdvisorStore({ root, storage: fakeStorage(), onDiagnostic: (event) => diagnostics.push(event) })
    await store.persist([{
      id: 'thread-p6-tamper', title: 'Private', createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z',
      activeRequestId: null, messages: [],
    }])
    const path = resolve(root, 'advisor', 'threads.v1.dpapi.json')
    const envelope = JSON.parse(await readFile(path, 'utf8'))
    envelope.records[0].aad = 'theia-advisor-store/v2:other-thread'
    await writeFile(path, `${JSON.stringify(envelope)}\n`, 'utf8')
    assert.deepEqual(await store.load(), [])
    assert.ok(diagnostics.includes('advisor.store_record_unreadable'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('P6 advisor store migrates readable v1 records to the authenticated v2 envelope', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-advisor-store-migrate-'))
  try {
    const storage = fakeStorage()
    const thread = {
      id: 'thread-p6-legacy', title: 'Legacy', createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z',
      activeRequestId: null, messages: [],
    }
    const ciphertext = storage.encryptString(JSON.stringify(thread)).toString('base64')
    const ciphertextDigest = createHash('sha256').update(ciphertext, 'utf8').digest('hex')
    const path = resolve(root, 'advisor', 'threads.v1.dpapi.json')
    await mkdir(resolve(root, 'advisor'), { recursive: true })
    await writeFile(path, JSON.stringify({
      schema: 'theia-advisor-store/v1', records: [{ ciphertext, ciphertextDigest }],
    }), 'utf8')
    const store = new AdvisorStore({ root, storage })
    assert.deepEqual(await store.load(), [thread])
    const migrated = JSON.parse(await readFile(path, 'utf8'))
    assert.equal(migrated.schema, 'theia-advisor-store/v2')
    assert.equal(migrated.records.length, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('advisor store rotates its master key without losing readable threads', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-advisor-store-rotate-'))
  try {
    const store = new AdvisorStore({ root, storage: fakeStorage() })
    const thread = {
      id: 'thread-p6-rotate', title: 'Rotate', createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z',
      activeRequestId: null, messages: [{ id: 'm', role: 'user', at: '2026-08-14T00:00:00.000Z', text: 'ROTATION_TEXT' }],
    }
    await store.persist([thread])
    const before = JSON.parse(await readFile(resolve(root, 'advisor', 'threads.v1.dpapi.json'), 'utf8'))
    const result = await store.rotateKey({ reason: 'test' })
    const after = JSON.parse(await readFile(resolve(root, 'advisor', 'threads.v1.dpapi.json'), 'utf8'))
    assert.deepEqual(result, { rotated: true, records: 1 })
    assert.equal(after.keyVersion, 1)
    assert.notEqual(after.masterKeyCiphertext, before.masterKeyCiphertext)
    assert.deepEqual(await store.load(), [thread])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('P6 event-stream reader returns only accumulated Responses output deltas', async () => {
  const deltas = []
  const text = await readBoundedEventStream(stream([
    'data: {"type":"response.output_text.delta","delta":"hello "}\n\n',
    'data: {"type":"response.output_text.delta","delta":"world"}\n\ndata: [DONE]\n\n',
  ]), 10_000, {
    extractDelta: (payload) => payload?.type === 'response.output_text.delta' ? payload.delta : '',
    onDelta: (value) => deltas.push(value),
  })
  assert.equal(text, 'hello world')
  assert.deepEqual(deltas, ['hello ', 'world'])
})

test('P6 releases a plain model turn only after classification and persists that exact text', async () => {
  const events = []
  const value = versionedState({ settings: { modelBaseUrl: 'https://model.example/v1', modelName: 'model-p6' } })
  const runtime = new AdvisorRuntime({
    store: { snapshotWithRevision: () => value },
    modelService: { async status() { return { apiKeySaved: true } } },
    onStream: (event) => events.push(event),
    providerFactory: () => ({
      async generateStream(_request, { onEvent }) {
        onEvent({ type: 'delta', delta: '你好，' })
        onEvent({ type: 'delta', delta: '这是模型的原始回答。' })
        return { text: '你好，这是模型的原始回答。', inputBytes: 1, outputBytes: 1 }
      },
    }),
  })
  const thread = runtime.createThread()
  const prepared = await runtime.prepare({ threadId: thread.id, question: 'hello', intent: 'general' })
  const answer = await runtime.send({ requestId: prepared.requestId, approved: true, stream: true })
  assert.equal(answer.schema, 'theia-advisor-answer/v1')
  assert.equal(answer.rawText, '你好，这是模型的原始回答。')
  assert.deepEqual(events.map((event) => event.delta), ['你好，这是模型的原始回答。'])
  assert.equal(events.length, 1)
  assert.equal(runtime.listThreads()[0].messages.at(-1).response.rawText, '你好，这是模型的原始回答。')
})
