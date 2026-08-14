import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ADVISOR_ANSWER_SCHEMA,
  ADVISOR_PREPARED_SCHEMA,
  AdvisorRuntime,
  AdvisorRuntimeError,
} from '../electron/advisor-runtime.mjs'
import { versionedState } from './fixtures/advisor-fixtures.mjs'

const MODEL_NARRATIVE_SCHEMA = 'theia-advisor-model-narrative/v1'
const MODEL_BASE_URL = 'https://models.example.test/v1'
const MODEL_ID = 'advisor-test-model'

function validNarrative(overrides = {}) {
  return JSON.stringify({
    schema: MODEL_NARRATIVE_SCHEMA,
    blocks: [],
    recommendations: [],
    uncertainties: [],
    questionsForUser: [],
    suggestedActionIds: [],
    ...overrides,
  })
}

function monotonicClock(start = '2026-08-14T04:00:00.000Z') {
  let now = Date.parse(start)
  return () => new Date(now += 1_000).toISOString()
}

function baseVersioned(overrides = {}) {
  return versionedState({
    settings: {
      modelBaseUrl: MODEL_BASE_URL,
      modelName: MODEL_ID,
    },
    ...overrides,
  })
}

function mutableStore(initial) {
  let current = initial
  return {
    snapshotWithRevision() {
      return current
    },
    replace(next) {
      current = next
    },
  }
}

function providerResult(text, request) {
  return {
    text,
    inputBytes: Buffer.byteLength(JSON.stringify(request.messages), 'utf8'),
    outputBytes: Buffer.byteLength(text, 'utf8'),
  }
}

function createHarness({
  versioned = baseVersioned(),
  store = mutableStore(versioned),
  handlers = [validNarrative()],
  clock = monotonicClock(),
  budget,
  strictOutput,
  onDiagnostic,
  modelService,
  providerFactory,
} = {}) {
  const requests = []
  let callIndex = 0
  const provider = {
    async generate(request, options = {}) {
      requests.push(structuredClone(request))
      const handler = handlers[Math.min(callIndex, handlers.length - 1)]
      callIndex += 1
      if (typeof handler === 'function') return handler(request, options)
      return providerResult(handler, request)
    },
  }
  const runtime = new AdvisorRuntime({
    store,
    clock,
    budget,
    strictOutput,
    onDiagnostic,
    modelService,
    providerFactory: providerFactory || (() => provider),
  })
  return { runtime, store, requests }
}

async function prepare(runtime, threadId, overrides = {}) {
  return runtime.prepare({
    threadId,
    question: '今天应该先处理什么？',
    intent: 'daily',
    ...overrides,
  })
}

function errorCode(code) {
  return (error) => error instanceof AdvisorRuntimeError && error.code === code
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function rejectWhenAborted(signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new Error('aborted'))
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

test('prepare and send produce one verified answer from the frozen snapshot', async () => {
  const { runtime, requests } = createHarness()
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id)

  assert.equal(prepared.schema, ADVISOR_PREPARED_SCHEMA)
  assert.equal(prepared.threadId, thread.id)
  assert.deepEqual(prepared.consentChallenge.requiredScopes, [])

  const answer = await runtime.send({ requestId: prepared.requestId, approved: true })

  assert.equal(answer.schema, ADVISOR_ANSWER_SCHEMA)
  assert.equal(answer.requestId, prepared.requestId)
  assert.equal(answer.snapshotRevision, 'fixture-revision-1')
  assert.deepEqual(answer.narrative, JSON.parse(validNarrative()))
  assert.equal(answer.model.serviceIdentity, MODEL_BASE_URL)
  assert.equal(answer.model.modelId, MODEL_ID)
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0].messages.map((message) => message.role), ['system', 'user'])
  assert.deepEqual(runtime.listThreads()[0].messages.map((message) => message.role), ['user', 'assistant'])
})

test('read-only agent mode can use only claims already in the frozen disclosed context', async () => {
  const { runtime, requests } = createHarness({
    handlers: [
      JSON.stringify({ schema: 'theia-advisor-tool-call/v1', tool: 'find_claims', args: { query: 'GPA' } }),
      validNarrative(),
    ],
  })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id, { agent: true })
  assert.equal(prepared.agent, true)
  const answer = await runtime.send({ requestId: prepared.requestId, approved: true })
  assert.equal(answer.schema, ADVISOR_ANSWER_SCHEMA)
  assert.equal(requests.length, 2)
  const observation = requests[1].messages.at(-1)
  assert.equal(observation.role, 'user')
  assert.match(observation.content, /theia-advisor-tool-observation\/v1/)
  assert.doesNotMatch(observation.content, /browser-session|credentials|filesystem/)
})

test('read-only agent falls back to a verified local narrative after repeated invalid finals', async () => {
  const invalid = JSON.stringify({
    schema: MODEL_NARRATIVE_SCHEMA,
    blocks: [{ claimIds: ['claim:forged'], referenceIds: [], explanation: 'invalid' }],
    recommendations: [], uncertainties: [], questionsForUser: [], suggestedActionIds: [],
  })
  const diagnostics = []
  const { runtime, requests } = createHarness({
    handlers: [invalid],
    onDiagnostic: (event, fields) => diagnostics.push({ event, fields }),
  })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id, { agent: true })
  const answer = await runtime.send({ requestId: prepared.requestId, approved: true })

  assert.equal(answer.schema, ADVISOR_ANSWER_SCHEMA)
  assert.equal(answer.narrative.schema, MODEL_NARRATIVE_SCHEMA)
  assert.equal(diagnostics.some((entry) => entry.event === 'advisor.agent_fallback'), true)
  assert.ok(requests.length > 1)
})

test('an explicit readable-domain selection expands a daily request only to the domains the user chose', async () => {
  const { runtime, requests } = createHarness()
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id, {
    readableDomains: ['grades', 'academic-progress', 'schedule'],
  })
  assert.deepEqual(prepared.disclosure.scopes, ['academic-progress', 'grades', 'schedule'])
  await runtime.send({ requestId: prepared.requestId, approved: true })
  const context = JSON.parse(requests[0].messages[1].content)
  assert.deepEqual(Object.keys(context.dataQuality.domains).sort(), ['academic-progress', 'grades', 'schedule'])
  assert.ok(context.localClaims.length > 0)
  assert.equal(context.localClaims.some((claim) => claim.displayText.includes('作业')), false)
})

test('an explicit readable-domain selection rejects an unknown domain before any model request', async () => {
  const { runtime, requests } = createHarness()
  const thread = runtime.createThread()
  await assert.rejects(prepare(runtime, thread.id, { readableDomains: ['filesystem'] }), /focus domain is not allowed/)
  assert.equal(requests.length, 0)
})

test('mail body consent uses the send-time server clock and discloses no HTML or attachment bytes', async () => {
  const mail = {
    id: 'mail-1',
    subject: '课程通知',
    from: 'teacher@example.edu',
    receivedAt: '2026-08-14T03:00:00.000Z',
    snippet: '请查看正文。',
    body: '<script>MAIL_HTML_SECRET()</script><p>明天 09:00 开会。 https://mail.example/private?ticket=MAIL_URL_SECRET C:\\private\\mail.txt</p>',
    bodyHtml: '<svg onload="MAIL_SVG_SECRET()"></svg>',
    attachments: [{
      index: 0,
      filename: 'notice.pdf',
      contentType: 'application/pdf',
      size: 42,
      content: 'ATTACHMENT_BINARY_SECRET',
      path: 'C:\\private\\notice.pdf',
      url: 'https://mail.example/attachment?token=ATTACHMENT_URL_SECRET',
    }],
  }
  const versioned = baseVersioned({ emails: [mail] })
  const { runtime, requests } = createHarness({ versioned })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id, {
    question: '概括这封邮件。',
    intent: 'mail',
    selectedMailIds: [mail.id],
    includeMailBodyIds: [mail.id],
    now: '1900-01-01T00:00:00.000Z',
  })

  assert.deepEqual(prepared.consentChallenge.requiredScopes, ['mail-body'])
  assert.equal(prepared.disclosure.containsMailBody, true)

  const answer = await runtime.send({
    requestId: prepared.requestId,
    approved: true,
    now: '2099-01-01T00:00:00.000Z',
  })

  assert.equal(answer.schema, ADVISOR_ANSWER_SCHEMA)
  const outbound = JSON.stringify(requests[0])
  assert.doesNotMatch(outbound, /MAIL_HTML_SECRET|MAIL_SVG_SECRET|MAIL_URL_SECRET/)
  assert.doesNotMatch(outbound, /ATTACHMENT_BINARY_SECRET|ATTACHMENT_URL_SECRET|C:\\\\private/)
  const context = JSON.parse(requests[0].messages[1].content)
  const metadata = context.domainData.find((entry) => entry.scope === 'mailbox').record
  const body = context.domainData.find((entry) => entry.scope === 'mail-body').record
  assert.deepEqual(metadata.attachments, [{
    contentType: 'application/pdf',
    filename: 'notice.pdf',
    index: 0,
    size: 42,
  }])
  assert.equal(Object.hasOwn(body, 'bodyHtml'), false)
  assert.equal(Object.hasOwn(body, 'content'), false)
  assert.equal(Object.hasOwn(body, 'path'), false)
  assert.equal(Object.hasOwn(body, 'url'), false)
  assert.doesNotMatch(body.body, /<script|<svg|https?:\/\/|C:\\/i)
})

test('prepare rejects a selected notice whose snapshot ID is ambiguous', async () => {
  const notice = { id: 'notice-duplicate', title: '通知', summary: '第一条' }
  const { runtime, requests } = createHarness({
    versioned: baseVersioned({ notices: [notice, { ...notice, summary: '第二条' }] }),
  })
  const thread = runtime.createThread()

  await assert.rejects(
    prepare(runtime, thread.id, {
      intent: 'notice',
      selectedNoticeIds: [notice.id],
    }),
    errorCode('invalid-selection'),
  )
  assert.equal(requests.length, 0)
})

test('prepare rejects a selected mail whose snapshot ID is ambiguous', async () => {
  const mail = { id: 'mail-duplicate', subject: '邮件', snippet: '第一封' }
  const { runtime, requests } = createHarness({
    versioned: baseVersioned({ emails: [mail, { ...mail, snippet: '第二封' }] }),
  })
  const thread = runtime.createThread()

  await assert.rejects(
    prepare(runtime, thread.id, {
      intent: 'mail',
      selectedMailIds: [mail.id],
    }),
    errorCode('invalid-selection'),
  )
  assert.equal(requests.length, 0)
})

test('send rejects a disclosure after the store revision changes', async () => {
  const versioned = baseVersioned()
  const store = mutableStore(versioned)
  const { runtime, requests } = createHarness({ versioned, store })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id)
  store.replace({ ...versioned, revision: 'fixture-revision-2' })

  await assert.rejects(
    runtime.send({ requestId: prepared.requestId, approved: true }),
    (error) => errorCode('stale-disclosure')(error) && error.retryable === true,
  )
  assert.equal(requests.length, 0)
  await assert.rejects(
    runtime.send({ requestId: prepared.requestId, approved: true }),
    errorCode('prepared-request-expired'),
  )
})

test('prepared state is private and approved disclosure cannot be mutated or redirected before send', async () => {
  const versioned = baseVersioned()
  const { runtime, requests } = createHarness({ versioned })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id)

  assert.equal(Object.hasOwn(runtime, 'prepared'), false)
  prepared.disclosure.serviceIdentity = 'https://evil.invalid/v1'
  prepared.disclosure.modelId = 'evil-model'
  prepared.disclosure.contextDigest = '0'.repeat(64)
  versioned.state.settings.modelBaseUrl = 'https://evil.invalid/v1'
  versioned.state.settings.modelName = 'evil-model'

  const answer = await runtime.send({ requestId: prepared.requestId, approved: true })
  const context = JSON.parse(requests[0].messages[1].content)
  assert.equal(requests[0].model, MODEL_ID)
  assert.equal(context.disclosure.serviceIdentity, MODEL_BASE_URL)
  assert.equal(context.disclosure.modelId, MODEL_ID)
  assert.equal(answer.model.serviceIdentity, MODEL_BASE_URL)
  assert.equal(answer.model.modelId, MODEL_ID)
})

test('an explicitly routed advisor model does not require the legacy default model field', async () => {
  const versioned = baseVersioned({
    settings: {
      modelBaseUrl: MODEL_BASE_URL,
      modelName: '',
      modelRouting: { advisorFastModel: MODEL_ID },
    },
  })
  let providerSettings = null
  const { runtime } = createHarness({
    versioned,
    modelService: {
      async status() {
        return { configured: false, apiKeySaved: true }
      },
    },
    providerFactory: (settings) => {
      providerSettings = settings
      return { async generate(request) { return providerResult(validNarrative(), request) } }
    },
  })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id)

  assert.equal(prepared.disclosure.modelId, MODEL_ID)
  await runtime.send({ requestId: prepared.requestId, approved: true })
  assert.equal(providerSettings.modelName, '')
  assert.equal(providerSettings.modelRouting.advisorFastModel, MODEL_ID)
})

test('a provider construction failure releases the thread and runtime slot', async () => {
  const { runtime } = createHarness({
    providerFactory: () => { throw new Error('provider construction failed') },
  })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id)

  await assert.rejects(runtime.send({ requestId: prepared.requestId, approved: true }), errorCode('provider-failed'))
  assert.equal(runtime.listThreads()[0].activeRequestId, null)
  const retry = await prepare(runtime, thread.id)
  assert.equal(retry.threadId, thread.id)
})

test('a forged citation gets exactly one constrained repair attempt', async () => {
  const forged = validNarrative({
    blocks: [{ claimIds: ['claim:forged'], explanation: '这是伪造的引用。' }],
  })
  const { runtime, requests } = createHarness({ handlers: [forged, validNarrative()] })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id)

  const answer = await runtime.send({ requestId: prepared.requestId, approved: true })

  assert.equal(answer.schema, ADVISOR_ANSWER_SCHEMA)
  assert.equal(requests.length, 2)
  const repair = JSON.parse(requests[1].messages[1].content)
  assert.equal(repair.schema, 'theia-advisor-format-repair/v1')
  assert.equal(repair.validationError, 'citation_invalid')
  assert.equal(repair.allowedClaimIds.length > 0, true)
  assert.equal(repair.allowedClaimIds.includes('claim:forged'), false)
  assert.match(repair.invalidOutput, /claim:forged/)
})

test('two invalid model outputs fall back to a locally verified advisor answer', async () => {
  const diagnostics = []
  const { runtime, requests } = createHarness({
    handlers: ['not-json', '{"still":"invalid"}'],
    strictOutput: false,
    onDiagnostic: (event, fields) => diagnostics.push({ event, fields }),
  })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id)

  const answer = await runtime.send({ requestId: prepared.requestId, approved: true })
  assert.equal(answer.schema, ADVISOR_ANSWER_SCHEMA)
  assert.equal(requests.length, 2)
  assert.equal(runtime.listThreads()[0].activeRequestId, null)
  assert.deepEqual(runtime.listThreads()[0].messages.map((message) => message.role), ['user', 'assistant'])
  assert.equal(diagnostics.some((entry) => entry.event === 'advisor.local_fallback'), true)
})

test('strict advisor output mode still fails closed after an invalid repair', async () => {
  const { runtime, requests } = createHarness({
    handlers: ['not-json', '{"still":"invalid"}'],
    strictOutput: true,
  })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id)

  await assert.rejects(runtime.send({ requestId: prepared.requestId, approved: true }), errorCode('model-output-invalid'))
  assert.equal(requests.length, 2)
  assert.deepEqual(runtime.listThreads()[0].messages.map((message) => message.role), ['user'])
})

test('cancel aborts an active provider request and reports cancellation', async () => {
  const started = deferred()
  const { runtime } = createHarness({
    handlers: [(_request, { signal }) => {
      started.resolve()
      return rejectWhenAborted(signal)
    }],
  })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id)
  const sending = runtime.send({ requestId: prepared.requestId, approved: true })
  await started.promise

  assert.deepEqual(runtime.cancel({ requestId: prepared.requestId }), {
    cancelled: true,
    requestId: prepared.requestId,
  })
  await assert.rejects(sending, errorCode('cancelled'))
  assert.equal(runtime.listThreads()[0].activeRequestId, null)
})

test('cancel fails closed even when a provider ignores AbortSignal and returns later', async () => {
  const started = deferred()
  const completed = deferred()
  const { runtime } = createHarness({
    handlers: [(request) => {
      started.resolve()
      return completed.promise.then((text) => providerResult(text, request))
    }],
  })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id)
  const sending = runtime.send({ requestId: prepared.requestId, approved: true })
  await started.promise

  assert.equal(runtime.cancel({ requestId: prepared.requestId }).cancelled, true)
  completed.resolve(validNarrative())

  await assert.rejects(sending, errorCode('cancelled'))
  assert.deepEqual(runtime.listThreads()[0].messages.map((message) => message.role), ['user'])
  assert.equal(runtime.listThreads()[0].activeRequestId, null)
})

test('cancel releases a request even when a provider ignores AbortSignal forever', async () => {
  const started = deferred()
  const { runtime } = createHarness({
    handlers: [() => {
      started.resolve()
      return new Promise(() => {})
    }],
  })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id)
  const sending = runtime.send({ requestId: prepared.requestId, approved: true })
  await started.promise

  assert.equal(runtime.cancel({ requestId: prepared.requestId }).cancelled, true)
  await assert.rejects(sending, errorCode('cancelled'))
  assert.equal(runtime.listThreads()[0].activeRequestId, null)
})

test('deadline abort reports a retryable timeout rather than user cancellation', async () => {
  const { runtime } = createHarness({
    budget: { deadlineMs: 20 },
    handlers: [(_request, { signal }) => rejectWhenAborted(signal)],
  })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id)

  await assert.rejects(
    runtime.send({ requestId: prepared.requestId, approved: true }),
    (error) => errorCode('timeout')(error) && error.retryable === true,
  )
  assert.equal(runtime.listThreads()[0].activeRequestId, null)
})

test('deadline releases a request even when a provider never settles', async () => {
  const { runtime } = createHarness({
    budget: { deadlineMs: 20 },
    handlers: [() => new Promise(() => {})],
  })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id)

  await assert.rejects(
    runtime.send({ requestId: prepared.requestId, approved: true }),
    (error) => errorCode('timeout')(error) && error.retryable === true,
  )
  assert.equal(runtime.listThreads()[0].activeRequestId, null)
})

test('one thread and the runtime enforce their concurrency limits; cancelAll aborts every active run', async () => {
  const allStarted = deferred()
  let starts = 0
  const handler = (_request, { signal }) => {
    starts += 1
    if (starts === 2) allStarted.resolve()
    return rejectWhenAborted(signal)
  }
  const { runtime, requests } = createHarness({ handlers: [handler] })
  const threads = [runtime.createThread(), runtime.createThread(), runtime.createThread()]
  const prepared = await Promise.all(threads.map((thread) => prepare(runtime, thread.id)))
  const first = runtime.send({ requestId: prepared[0].requestId, approved: true })
  const second = runtime.send({ requestId: prepared[1].requestId, approved: true })
  await allStarted.promise

  await assert.rejects(prepare(runtime, threads[0].id), errorCode('thread-busy'))
  await assert.rejects(
    runtime.send({ requestId: prepared[2].requestId, approved: true }),
    (error) => errorCode('runtime-busy')(error) && error.retryable === true,
  )
  assert.equal(requests.length, 2)
  assert.equal(runtime.cancelAll(), 2)
  await Promise.all([
    assert.rejects(first, errorCode('cancelled')),
    assert.rejects(second, errorCode('cancelled')),
  ])
  await assert.rejects(
    runtime.send({ requestId: prepared[2].requestId, approved: true }),
    errorCode('prepared-request-expired'),
  )
  assert.equal(runtime.listThreads().every((thread) => thread.activeRequestId === null), true)
})

test('a second turn never retransmits raw local history', async () => {
  const { runtime, requests } = createHarness({ handlers: [validNarrative()] })
  const thread = runtime.createThread()
  const first = await prepare(runtime, thread.id, {
    question: '查看 https://history.invalid/private?token=HISTORY_URL_SECRET api key=HISTORY_KEY_SECRET C:\\Users\\Alice\\grades.txt',
  })
  await runtime.send({ requestId: first.requestId, approved: true })
  const second = await prepare(runtime, thread.id, { question: '下一步是什么？' })
  await runtime.send({ requestId: second.requestId, approved: true })

  assert.equal(requests.length, 2)
  assert.deepEqual(requests[1].messages.map((message) => message.role), ['system', 'user'])
  const secondOutbound = JSON.stringify(requests[1])
  assert.doesNotMatch(secondOutbound, /history\.invalid|HISTORY_URL_SECRET|HISTORY_KEY_SECRET|Users\\\\Alice/)
})

test('the input byte budget covers every message actually sent to the provider', async () => {
  const baseline = createHarness()
  const baselineThread = baseline.runtime.createThread()
  const baselinePrepared = await prepare(baseline.runtime, baselineThread.id)
  await baseline.runtime.send({ requestId: baselinePrepared.requestId, approved: true })
  const messages = baseline.requests[0].messages
  const contextBytes = Buffer.byteLength(messages[1].content, 'utf8')
  const totalMessageBytes = Buffer.byteLength(JSON.stringify(messages), 'utf8')
  assert.ok(totalMessageBytes > contextBytes)

  const limitBetweenContextAndMessages = contextBytes + Math.floor((totalMessageBytes - contextBytes) / 2)
  const constrained = createHarness({ budget: { maxInputBytes: limitBetweenContextAndMessages } })
  const constrainedThread = constrained.runtime.createThread()
  const constrainedPrepared = await prepare(constrained.runtime, constrainedThread.id)

  await assert.rejects(
    constrained.runtime.send({ requestId: constrainedPrepared.requestId, approved: true }),
    errorCode('context-too-large'),
  )
  assert.equal(constrained.requests.length, 0)
})

test('the run input budget is cumulative and can block a repair before it leaves the device', async () => {
  const forged = validNarrative({
    blocks: [{ claimIds: ['claim:forged'], explanation: '这是伪造的引用。' }],
  })
  const baseline = createHarness({ handlers: [forged, validNarrative()] })
  const baselineThread = baseline.runtime.createThread()
  const baselinePrepared = await prepare(baseline.runtime, baselineThread.id)
  await baseline.runtime.send({ requestId: baselinePrepared.requestId, approved: true })
  assert.equal(baseline.requests.length, 2)
  const firstBytes = Buffer.byteLength(JSON.stringify(baseline.requests[0].messages), 'utf8')
  const repairBytes = Buffer.byteLength(JSON.stringify(baseline.requests[1].messages), 'utf8')

  const constrained = createHarness({
    handlers: [forged, validNarrative()],
    budget: { maxInputBytes: firstBytes + Math.floor(repairBytes / 2) },
  })
  const constrainedThread = constrained.runtime.createThread()
  const constrainedPrepared = await prepare(constrained.runtime, constrainedThread.id)

  await assert.rejects(
    constrained.runtime.send({ requestId: constrainedPrepared.requestId, approved: true }),
    errorCode('run-budget-exhausted'),
  )
  assert.equal(constrained.requests.length, 1)
})
