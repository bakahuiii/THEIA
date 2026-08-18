import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ADVISOR_ANSWER_SCHEMA,
  ADVISOR_PREPARED_SCHEMA,
  AdvisorRuntime,
  AdvisorRuntimeError,
} from '../electron/advisor-runtime.mjs'
import { domainOutcome, versionedState } from './fixtures/advisor-fixtures.mjs'

const MODEL_BASE_URL = 'https://models.example.test/v1'
const MODEL_ID = 'advisor-test-model'

function validNarrative(overrides = {}) {
  return overrides.text || '这是模型原样返回的回答。'
}

function monotonicClock(start = '2026-08-14T04:00:00.000Z') {
  let now = Date.parse(start)
  return () => new Date(now += 1_000).toISOString()
}

function baseVersioned(overrides = {}, domainOutcomes = {}) {
  return versionedState({
    settings: { modelBaseUrl: MODEL_BASE_URL, modelName: MODEL_ID },
    ...overrides,
  }, domainOutcomes)
}

function mutableStore(initial) {
  let current = initial
  return {
    snapshotWithRevision() { return current },
    replace(next) { current = next },
  }
}

function providerResult(text, request, usage = null) {
  return {
    text,
    inputBytes: Buffer.byteLength(JSON.stringify(request.messages), 'utf8'),
    outputBytes: Buffer.byteLength(text, 'utf8'),
    ...(usage ? { usage } : {}),
  }
}

function createHarness({ versioned = baseVersioned(), store = mutableStore(versioned), handlers = [validNarrative()], budget, onDiagnostic, onStream, agentOperations } = {}) {
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
    async generateStream(request, options = {}) {
      return provider.generate(request, options)
    },
  }
  const runtime = new AdvisorRuntime({
    store,
    clock: monotonicClock(),
    budget,
    onDiagnostic,
    onStream,
    agentOperations,
    providerFactory: () => provider,
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

function observation(request) {
  const parsed = JSON.parse(request.messages.at(-1).content)
  if (!parsed.result) throw new Error(`Expected a tool observation, received ${parsed.schema || 'unknown'}`)
  return parsed.result
}

function errorCode(code) {
  return (error) => error instanceof AdvisorRuntimeError && error.code === code
}

test('the initial model context is a compact question, not a campus data dump or local route', async () => {
  const { runtime, requests } = createHarness({
    versioned: baseVersioned({
      grades: [{ id: 'grade-1', courseName: '高级材料化学', courseCode: 'MAT100', score: '91', credits: 3, point: 4 }],
      schedule: [{ id: 'schedule-1', title: '材料物理', room: '实验楼 A', weekday: 1, period: '1-2节' }],
      terms: [{ id: '2026-3', year: 2026, term: '3', label: '2026-2027 第一学期' }],
      dataCatalog: { collections: { schoolSchedule: { records: {
        '2026-3': { scope: { termId: '2026-3' }, items: [] },
      } } } },
    }),
  })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id, { question: '我的成绩和课表怎么样？', intent: 'risk' })

  assert.equal(prepared.schema, ADVISOR_PREPARED_SCHEMA)
  assert.equal(prepared.agent, true)
  const answer = await runtime.send({ requestId: prepared.requestId, approved: true })
  const initial = requests[0].messages
  const sessionMessage = initial.at(-1)
  const session = JSON.parse(sessionMessage.content)

  assert.equal(answer.schema, ADVISOR_ANSWER_SCHEMA)
  assert.equal(requests[0].timeoutMs, 300_000)
  assert.deepEqual(initial.map((message) => message.role), ['system', 'system', 'user'])
  assert.equal(session.schema, 'theia-advisor-agent-session/v1')
  assert.equal(session.timeZone, 'Asia/Shanghai')
  assert.equal(session.currentDate, '2026-08-14')
  assert.match(session.currentTime, /^12:00:\d{2}$/u)
  assert.match(session.currentInstant, /^2026-08-14T04:00:\d{2}\.\d{3}Z$/u)
  assert.ok(Array.isArray(session.dataInventory))
  assert.ok(session.dataInventory.some((item) => item.domain === 'grades'))
  assert.ok(Array.isArray(session.academicContext.terms))
  assert.equal(session.academicContext.latestKnownTermId, '2026-3')
  assert.deepEqual(session.academicContext.schoolScheduleTermIds, ['2026-3'])
  assert.deepEqual(session.focusDomains, [])
  assert.equal(session.intent, 'risk')
  assert.doesNotMatch(sessionMessage.content, /高级材料化学|材料物理|实验楼 A|MAT100/)
  assert.doesNotMatch(initial.at(-1).content, /theia-advisor-tool-observation/u)
  assert.deepEqual(runtime.listThreads()[0].messages.map((message) => message.role), ['user', 'assistant'])
})

test('a direct advisor send creates its request internally and reaches the model in one call', async () => {
  const { runtime, requests } = createHarness({ handlers: ['直接回答。'] })
  const thread = runtime.createThread()
  const answer = await runtime.send({ threadId: thread.id, question: '你好' })

  assert.equal(answer.rawText, '直接回答。')
  assert.equal(requests.length, 1)
  assert.match(requests[0].messages.at(-1).content, /你好/u)
})

test('advisor snapshots wait for provider refresh readiness before the model sees data', async () => {
  let ready = false
  const requests = []
  const runtime = new AdvisorRuntime({
    store: mutableStore(baseVersioned()),
    clock: monotonicClock(),
    ensureDataReady: async () => { await Promise.resolve(); ready = true },
    providerFactory: () => ({
      async generateStream(request) {
        requests.push(request)
        assert.equal(ready, true)
        return providerResult('就绪后回答。', request)
      },
    }),
  })
  const thread = runtime.createThread()
  await runtime.send({ threadId: thread.id, question: '校历准备好了吗？' })
  assert.equal(requests.length, 1)
})

test('advisor settings reach every model turn so reasoning and style are user-controlled', async () => {
  const { runtime, requests } = createHarness({
    versioned: baseVersioned({
      settings: {
        modelBaseUrl: MODEL_BASE_URL,
        modelName: MODEL_ID,
        advisorConfig: {
          reasoningEffort: 'high',
          responseStyle: 'detailed',
          responseLength: 'detailed',
          temperature: 0.7,
        },
      },
    }),
  })
  const thread = runtime.createThread()
  await runtime.send({ threadId: thread.id, question: '给我一个学习安排。' })

  assert.equal(requests[0].reasoningEffort, 'high')
  assert.equal(requests[0].temperature, 0.7)
  assert.ok(requests[0].maxTokens > 256)
  assert.ok(requests[0].maxTokens <= 900)
  assert.match(requests[0].messages[1].content, /风格详细/u)
})

test('an explicit full-access setting projects typed operations into the Agent runtime', async () => {
  const updates = []
  const toolCall = JSON.stringify({
    schema: 'theia-advisor-tool-call/v1',
    tool: 'update_theia_settings',
    args: { settings: { openOriginalInApp: false } },
  })
  const { runtime, requests } = createHarness({
    versioned: baseVersioned({
      settings: {
        modelBaseUrl: MODEL_BASE_URL,
        modelName: MODEL_ID,
        advisorConfig: { permissionMode: 'full-access' },
      },
    }),
    handlers: [toolCall, '已关闭原站内嵌打开。'],
    agentOperations: {
      async updateSettings({ settings }) {
        updates.push(settings)
        return { updated: true }
      },
    },
  })
  const thread = runtime.createThread()
  await runtime.send({ threadId: thread.id, question: '关闭原站内嵌打开。' })

  const session = JSON.parse(requests[0].messages.at(-1).content)
  assert.equal(session.permissionMode, 'full-access')
  assert.ok(session.availableTools.includes('update_theia_settings'))
  assert.match(requests[0].messages[1].content, /完全访问/u)
  assert.deepEqual(updates, [{ openOriginalInApp: false }])
})

test('full-access Ultra uses the same declared operations as the standard Agent path', async () => {
  const syncs = []
  const toolCall = JSON.stringify({
    schema: 'theia-advisor-tool-call/v1',
    tool: 'sync_campus_data',
    args: { domains: ['grades'] },
  })
  const { runtime } = createHarness({
    versioned: baseVersioned({
      settings: {
        modelBaseUrl: MODEL_BASE_URL,
        modelName: MODEL_ID,
        advisorConfig: { budgetLevel: 'ultra', permissionMode: 'full-access' },
      },
    }),
    handlers: [
      (request) => {
        const last = request.messages.at(-1)?.content || ''
        if (last.includes('任务分解器')) return providerResult(JSON.stringify([
          { id: 'sync', description: '同步成绩资料', tools: ['sync_campus_data'], dependencies: [] },
        ]), request)
        if (last.includes('结果汇总器')) return providerResult('Ultra 已完成同步。', request)
        if (last.includes('sync_campus_data') && !last.includes('theia-advisor-tool-observation')) return providerResult(toolCall, request)
        return providerResult('同步操作已返回结果。', request)
      },
    ],
    agentOperations: {
      async syncCampusData({ domains }) {
        syncs.push(domains)
        return { synced: true }
      },
    },
  })
  const thread = runtime.createThread()
  const answer = await runtime.send({ threadId: thread.id, question: '综合分析我的成绩和课程？下一步怎么规划？' })

  assert.equal(answer.rawText, 'Ultra 已完成同步。')
  assert.equal(runtime.listThreads()[0].messages.at(-1).response.metadata.mode, 'ultra')
  assert.deepEqual(syncs, [['grades']])
})

test('a short question carries compact local orientation and an explicit route', async () => {
  const { runtime, requests } = createHarness({ handlers: [validNarrative()] })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id, { question: '你好', intent: 'general' })
  await runtime.send({ requestId: prepared.requestId })

  const session = JSON.parse(requests[0].messages.at(-1).content)
  assert.deepEqual(session.focusDomains, [])
  assert.equal(session.intent, 'general')
  assert.ok(Array.isArray(session.dataInventory))
  assert.ok(session.academicContext)
  assert.equal(Object.hasOwn(session, 'toolContract'), false)
  assert.ok(Buffer.byteLength(requests[0].messages.at(-1).content, 'utf8') < 8_000)
  assert.ok(Buffer.byteLength(JSON.stringify(requests[0].messages), 'utf8') < 24_000)
})

test('Chinese natural-language questions do not change the configured model route', async () => {
  const { runtime, requests } = createHarness({
    versioned: baseVersioned({
      settings: {
        modelBaseUrl: MODEL_BASE_URL,
        modelName: MODEL_ID,
        modelRouting: { courseworkModel: 'coursework-model' },
      },
    }),
    handlers: ['可以结合你的本地课程资料继续安排。'],
  })
  const thread = runtime.createThread()
  await runtime.send({ threadId: thread.id, question: '下学期有哪些课值得优先选，怎么安排比较合适？' })

  const session = JSON.parse(requests[0].messages.at(-1).content)
  assert.equal(session.intent, 'general')
  assert.deepEqual(session.focusDomains, [])
  assert.equal(requests[0].model, MODEL_ID)
})

test('a retryable primary provider failure fails over once before any visible output or tool call', async () => {
  const streamEvents = []
  const { runtime, requests } = createHarness({
    versioned: baseVersioned({ settings: { modelBaseUrl: MODEL_BASE_URL, modelName: MODEL_ID, modelRouting: { fallbackModel: 'fallback-model' } } }),
    onStream: (event) => streamEvents.push(event),
    handlers: [
      () => { throw new Error('Model request timed out after 90 seconds') },
      (request, { onEvent } = {}) => {
        onEvent?.({ type: 'started', modelId: request.model })
        return providerResult('fallback 已完成回答。', request)
      },
    ],
  })
  const thread = runtime.createThread()
  const answer = await runtime.send({ threadId: thread.id, question: '你好' })

  assert.deepEqual(requests.map((request) => request.model), [MODEL_ID, 'fallback-model'])
  assert.equal(answer.rawText, 'fallback 已完成回答。')
  assert.equal(answer.model.modelId, 'fallback-model')
  assert.deepEqual(streamEvents.filter((event) => event.model?.type === 'failover').map((event) => event.model), [
    { type: 'failover', modelId: 'fallback-model', fromModelId: MODEL_ID },
  ])
})

test('a non-retryable primary provider failure never invokes fallback', async () => {
  const streamEvents = []
  const { runtime, requests } = createHarness({
    versioned: baseVersioned({ settings: { modelBaseUrl: MODEL_BASE_URL, modelName: MODEL_ID, modelRouting: { fallbackModel: 'fallback-model' } } }),
    onStream: (event) => streamEvents.push(event),
    handlers: [
      () => { throw new Error('HTTP 400: invalid request') },
      'fallback must not run',
    ],
  })
  const thread = runtime.createThread()

  await assert.rejects(
    runtime.send({ threadId: thread.id, question: '你好' }),
    (error) => error instanceof AdvisorRuntimeError && error.code === 'provider-failed',
  )
  assert.deepEqual(requests.map((request) => request.model), [MODEL_ID])
  assert.equal(streamEvents.some((event) => event.model?.type === 'failover'), false)
})

test('a provider failure after visible streaming output is not duplicated through fallback', async () => {
  const streamEvents = []
  const visiblePrefix = '已经开始输出。'.repeat(40)
  const { runtime, requests } = createHarness({
    versioned: baseVersioned({ settings: { modelBaseUrl: MODEL_BASE_URL, modelName: MODEL_ID, modelRouting: { fallbackModel: 'fallback-model' } } }),
    onStream: (event) => streamEvents.push(event),
    handlers: [
      (_request, { onEvent } = {}) => {
        onEvent?.({ type: 'delta', delta: visiblePrefix })
        throw new Error('Model request timed out after 90 seconds')
      },
      'fallback must not duplicate visible output',
    ],
  })
  const thread = runtime.createThread()

  await assert.rejects(runtime.send({ threadId: thread.id, question: '你好' }), errorCode('timeout'))
  assert.deepEqual(requests.map((request) => request.model), [MODEL_ID])
  assert.match(streamEvents.filter((event) => event.delta).map((event) => event.delta).join(''), /已经开始输出/u)
  assert.equal(streamEvents.some((event) => event.model?.type === 'failover'), false)
})

test('the lazy Agent always streams and ignores a caller stream:false request', async () => {
  const versioned = baseVersioned()
  const streamEvents = []
  let streamCalls = 0
  let regularCalls = 0
  const runtime = new AdvisorRuntime({
    store: mutableStore(versioned),
    clock: monotonicClock(),
    onStream: (event) => streamEvents.push(event),
    providerFactory: () => ({
      async generate() {
        regularCalls += 1
        throw new Error('non-streaming path must not run')
      },
      async generateStream(request, { onEvent } = {}) {
        streamCalls += 1
        onEvent?.({ type: 'delta', delta: '{' })
        return providerResult(validNarrative(), request)
      },
    }),
  })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id)
  await runtime.send({ requestId: prepared.requestId, stream: false })

  assert.equal(streamCalls, 1)
  assert.equal(regularCalls, 0)
  assert.equal(streamEvents[0]?.delta, validNarrative())
})

test('advisor streaming preserves whitespace-only provider deltas', async () => {
  const streamEvents = []
  const runtime = new AdvisorRuntime({
    store: mutableStore(baseVersioned()),
    clock: monotonicClock(),
    onStream: (event) => streamEvents.push(event),
    providerFactory: () => ({
      async generateStream(_request, { onEvent } = {}) {
        for (const delta of ['hello', ' ', 'world', '\n']) onEvent?.({ type: 'delta', delta })
        return providerResult('hello world\n', _request)
      },
    }),
  })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id)
  await runtime.send({ requestId: prepared.requestId })
  assert.deepEqual(streamEvents.map((event) => event.delta), ['hello world\n'])
})

test('advisor runtime executes a prose-prefixed tool call without streaming its protocol', async () => {
  const streamEvents = []
  const toolReply = `我先查当前快照。${JSON.stringify({
    schema: 'theia-advisor-tool-call/v1',
    tool: 'search_campus_records',
    args: { topic: 'selected-courses', limit: 100 },
  })}稍后整理。`
  const { runtime, requests } = createHarness({
    onStream: (event) => streamEvents.push(event),
    handlers: [
      (request, { onEvent } = {}) => {
        for (const delta of [toolReply.slice(0, 8), toolReply.slice(8, 39), toolReply.slice(39)]) onEvent?.({ type: 'delta', delta })
        return providerResult(toolReply, request)
      },
      (request, { onEvent } = {}) => {
        const answer = '当前快照没有下学期已选课程记录。'
        onEvent?.({ type: 'delta', delta: answer })
        return providerResult(answer, request)
      },
    ],
  })
  const thread = runtime.createThread()
  const answer = await runtime.send({ threadId: thread.id, question: '我下学期有什么课？' })

  assert.equal(answer.rawText, '当前快照没有下学期已选课程记录。')
  assert.equal(requests.length, 2)
  assert.deepEqual(streamEvents.filter((event) => event.delta).map((event) => event.delta), ['当前快照没有下学期已选课程记录。'])
  assert.deepEqual(streamEvents.filter((event) => event.tool).map((event) => event.tool?.type), ['start', 'result'])
  assert.deepEqual(streamEvents.find((event) => event.tool?.type === 'start')?.tool?.args, { domain: 'selected-courses', limit: 100 })
  assert.doesNotMatch(JSON.stringify(streamEvents), /theia-advisor-tool-call|我先查当前快照/u)
})

test('advisor streaming forwards tool-only events without exposing protocol JSON as a delta', () => {
  const streamEvents = []
  const { runtime } = createHarness({ onStream: (event) => streamEvents.push(event) })
  runtime.emitStream({
    requestId: 'request-1',
    threadId: 'thread-1',
    snapshotRevision: 'revision-1',
    tool: {
      type: 'start',
      name: 'search_campus_records',
      args: { type: 'selected-courses', query: '下学期', limit: 100 },
    },
  })

  assert.equal(streamEvents.length, 1)
  assert.equal(streamEvents[0].delta, undefined)
  assert.deepEqual(streamEvents[0].tool, {
    type: 'start',
    name: 'search_campus_records',
    args: { type: 'selected-courses', query: '下学期', limit: 100 },
  })
})

test('the runtime rejects a non-streaming provider without falling back to generate', async () => {
  let regularCalls = 0
  const runtime = new AdvisorRuntime({
    store: mutableStore(baseVersioned()),
    clock: monotonicClock(),
    providerFactory: () => ({
      async generate() {
        regularCalls += 1
        return providerResult(validNarrative(), { messages: [] })
      },
    }),
  })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id)

  await assert.rejects(
    runtime.send({ requestId: prepared.requestId }),
    (error) => error instanceof AdvisorRuntimeError
      && error.code === 'agent-streaming-unavailable'
      && error.retryable === true,
  )
  assert.equal(regularCalls, 0)
})

test('the agent can lazily retrieve an otherwise undisclosed record before returning raw text', async () => {
  const { runtime, requests } = createHarness({
    versioned: baseVersioned({
      grades: [{ id: 'grade-1', courseName: '高级材料化学', courseCode: 'MAT100', score: '91', credits: 3, point: 4 }],
    }),
    handlers: [
      JSON.stringify({ schema: 'theia-advisor-tool-call/v1', tool: 'search_campus_records', args: { domain: 'grades', query: '材料', limit: 1 } }),
      (request) => {
        const claim = observation(request).data.claims[0]
        assert.ok(claim.id)
        return providerResult('高级材料化学的本地成绩已读取。', request)
      },
    ],
  })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id, { question: '高级材料化学考得怎么样？', intent: 'risk' })
  const answer = await runtime.send({ requestId: prepared.requestId, approved: true })

  assert.equal(requests.length, 2)
  assert.match(requests[1].messages.at(-1).content, /高级材料化学/)
  assert.equal(answer.rawText, '高级材料化学的本地成绩已读取。')
})

test('data-health lookups remain available to the model before it returns raw text', async () => {
  const { runtime, requests } = createHarness({
    versioned: baseVersioned({
      grades: [{ id: 'grade-1', courseName: '高级材料化学', score: '91' }],
    }, { grades: domainOutcome() }),
    handlers: [
      JSON.stringify({ schema: 'theia-advisor-tool-call/v1', tool: 'get_data_health', args: { domains: ['grades'] } }),
      (request) => {
        const claim = observation(request).data.claims[0]
        assert.ok(claim.id)
        return providerResult('成绩数据当前可直接使用。', request)
      },
    ],
  })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id, { question: '成绩数据健康吗？', intent: 'general' })
  const answer = await runtime.send({ requestId: prepared.requestId })

  assert.equal(answer.rawText, '成绩数据当前可直接使用。')
})

test('the runtime does not rewrite a model uncertainty after a local lookup', async () => {
  const { runtime } = createHarness({
    versioned: baseVersioned({
      grades: [{ id: 'grade-1', courseName: '高级材料化学', courseCode: 'MAT100', score: '91', credits: 3, point: 4 }],
    }, { grades: domainOutcome() }),
    handlers: [
      JSON.stringify({ schema: 'theia-advisor-tool-call/v1', tool: 'search_campus_records', args: { domain: 'grades', limit: 1 } }),
      (request) => {
        const claim = observation(request).data.claims[0]
        assert.ok(claim.id)
        return providerResult('本地数据可能不完整，请以学校为准。', request)
      },
    ],
  })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id, { question: '看一下成绩。', intent: 'risk' })
  const answer = await runtime.send({ requestId: prepared.requestId })

  assert.equal(answer.rawText, '本地数据可能不完整，请以学校为准。')
})

test('lazy notice reads keep the bounded summary and date in the model observation', async () => {
  const { runtime, requests } = createHarness({
    versioned: baseVersioned({
      notices: [{
        id: 'notice-1',
        title: '材料学院重要通知',
        summary: '请在本周五前完成材料学院登记，逾期需要人工核验。',
        publishedAt: '2026-08-14T03:00:00.000Z',
        source: 'school',
      }],
    }),
    handlers: [
      JSON.stringify({ schema: 'theia-advisor-tool-call/v1', tool: 'search_campus_records', args: { domain: 'notices', query: '材料', limit: 1 } }),
      (request) => providerResult(validNarrative({
        blocks: [{ claimIds: [], referenceIds: [observation(request).data.items[0].referenceId], explanation: '已读取通知。' }],
        uncertainties: [],
      }), request),
    ],
  })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id, { question: '材料学院通知说了什么？', intent: 'notice' })
  await runtime.send({ requestId: prepared.requestId })

  assert.match(requests[1].messages.at(-1).content, /材料学院重要通知/u)
  assert.match(requests[1].messages.at(-1).content, /本周五前完成材料学院登记/u)
  assert.match(requests[1].messages.at(-1).content, /2026-08-14T03:00:00\.000Z/u)
})

test('follow-up sessions carry a bounded navigation hint instead of the prior transcript', async () => {
  const { runtime, requests } = createHarness({ handlers: [validNarrative()] })
  const thread = runtime.createThread()
  const first = await prepare(runtime, thread.id, { question: '我的成绩怎么样？', intent: 'risk' })
  await runtime.send({ requestId: first.requestId })
  const second = await prepare(runtime, thread.id, { question: '那再看看课表？', intent: 'course' })
  await runtime.send({ requestId: second.requestId })

  const session = JSON.parse(requests[1].messages.at(-1).content)
  assert.equal(session.schema, 'theia-advisor-agent-session/v1')
  assert.equal(session.threadHint.schema, 'theia-advisor-thread-hint/v1')
  assert.match(JSON.stringify(session.threadHint), /我的成绩怎么样？/u)
  assert.ok(Buffer.byteLength(JSON.stringify(session.threadHint), 'utf8') <= 4_000)
})

test('the local Agent uses the profile tool for 我是谁 even when the provider adds metadata', async () => {
  const { runtime, requests } = createHarness({
    versioned: baseVersioned({
      profile: {
        name: '测试同学', studentId: '2024000000', academicClass: '高材2407',
        academicTrack: '材料', major: '高分子材料与工程', grade: '2024级',
      },
    }),
    handlers: [
      `${JSON.stringify({
        schema: 'theia-advisor-tool-call/v1',
        tool: 'search_campus_records',
        args: { domain: 'profile', limit: 1, rationale: 'identity lookup' },
        reasoning: 'The user asks for their identity.',
      })}我先帮你读取本地学籍资料。`,
      (request) => {
        const claim = observation(request).data.claims[0]
        assert.ok(claim.id)
        return providerResult('你是测试同学，学号 2024000000。', request)
      },
    ],
  })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id, { question: '我是谁？' })
  const answer = await runtime.send({ requestId: prepared.requestId })

  assert.match(requests[0].messages[0].content, /THEIA 的通用 AI 助手/u)
  assert.match(requests[0].messages[0].content, /可以编写、解释、重构、调试代码/u)
  assert.match(requests[0].messages[0].content, /下学期有什么课/u)
  assert.match(requests[0].messages[0].content, /我是谁/u)
  assert.equal(requests.length, 2)
  assert.equal(answer.rawText, '你是测试同学，学号 2024000000。')
})

test('stable profile context receives an isolated hashed Responses cache key', async () => {
  const { runtime, requests } = createHarness({
    versioned: baseVersioned({
      profile: {
        name: '测试同学',
        studentId: '2024000000',
        department: '材料学院',
        major: '材料科学与工程',
        grade: '2024级',
        academicClass: '材料2401',
        campus: '东校区',
        gpa: 3.8,
      },
    }),
    handlers: ['我会结合你的本地校园资料继续协助。'],
  })
  const thread = runtime.createThread()
  const first = await prepare(runtime, thread.id, { question: '我是谁？' })
    assert.equal(first.disclosure.containsProfileIdentity, false)
  await runtime.send({ requestId: first.requestId })
  const second = await prepare(runtime, thread.id, { question: '我的专业是什么？' })
  await runtime.send({ requestId: second.requestId })

  const [firstRequest, secondRequest] = requests
  assert.doesNotMatch(firstRequest.messages[0].content, /测试同学|2024000000|材料科学与工程|3\.8/u)
  assert.match(firstRequest.promptCacheKey, /^theia-advisor-agent-v1-[a-f0-9]{24}$/u)
  assert.doesNotMatch(firstRequest.promptCacheKey, /2024000000/u)
  assert.equal(secondRequest.promptCacheKey, firstRequest.promptCacheKey)
})

test('invalid tool-call JSON fails instead of becoming the saved answer', async () => {
  const diagnostics = []
  const { runtime, requests } = createHarness({
    onDiagnostic: (event, fields) => diagnostics.push({ event, fields }),
    handlers: [JSON.stringify({
      schema: 'theia-advisor-tool-call/v1',
      tool: 'open_url',
      args: { url: 'https://example.test' },
    })],
  })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id, { question: '查一下。' })

  await assert.rejects(
    runtime.send({ requestId: prepared.requestId }),
    (error) => error instanceof AdvisorRuntimeError && error.code === 'agent-tool-invalid',
  )
  assert.equal(requests.length, 3)
  assert.equal(diagnostics.at(-1)?.event, 'advisor.run_failed')
})

test('a snapshot update does not replace raw model text', async () => {
  const versioned = baseVersioned()
  const store = mutableStore(versioned)
  const { runtime } = createHarness({
    store,
    versioned,
    handlers: [() => {
      store.replace({ ...versioned, revision: 'fixture-revision-2' })
      return providerResult('请说明你希望查询的校园信息。', { messages: [] })
    }],
  })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id)
  const answer = await runtime.send({ requestId: prepared.requestId })

  assert.equal(answer.rawText, '请说明你希望查询的校园信息。')
})

test('an unrelated domain update does not rewrite model text after a profile lookup', async () => {
  const versioned = baseVersioned({
    profile: { name: '测试同学', studentId: '2024000000', academicClass: '高材2407' },
  })
  const store = mutableStore(versioned)
  const { runtime } = createHarness({
    store,
    versioned,
    handlers: [
      JSON.stringify({ schema: 'theia-advisor-tool-call/v1', tool: 'search_campus_records', args: { domain: 'profile', limit: 1 } }),
      (request) => {
        const claim = observation(request).data.claims[0]
        store.replace({
          ...versioned,
          revision: 'fixture-revision-2',
          domainDigests: { ...versioned.domainDigests, notices: '0'.repeat(64) },
        })
        assert.ok(claim.id)
        return providerResult('已读取本地学籍档案。', request)
      },
    ],
  })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id, { question: '我是谁？' })
  const answer = await runtime.send({ requestId: prepared.requestId })

  assert.equal(answer.rawText, '已读取本地学籍档案。')
})

test('a cited domain update does not append a local stale notice to model text', async () => {
  const versioned = baseVersioned({
    profile: { name: '测试同学', studentId: '2024000000', academicClass: '高材2407' },
  })
  const store = mutableStore(versioned)
  const { runtime } = createHarness({
    store,
    versioned,
    handlers: [
      JSON.stringify({ schema: 'theia-advisor-tool-call/v1', tool: 'search_campus_records', args: { domain: 'profile', limit: 1 } }),
      (request) => {
        const claim = observation(request).data.claims[0]
        store.replace({
          ...versioned,
          revision: 'fixture-revision-2',
          domainDigests: { ...versioned.domainDigests, profile: 'f'.repeat(64) },
        })
        assert.ok(claim.id)
        return providerResult('已读取本地学籍档案。', request)
      },
    ],
  })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id, { question: '我是谁？' })
  const answer = await runtime.send({ requestId: prepared.requestId })

  assert.equal(answer.rawText, '已读取本地学籍档案。')
})

test('advisor answers report token usage even when a provider does not expose usage metadata', async () => {
  const { runtime } = createHarness()
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id)
  const answer = await runtime.send({ requestId: prepared.requestId })

  assert.ok(answer.usage.inputTokens > 0)
  assert.ok(answer.usage.outputTokens > 0)
  assert.equal(answer.usage.estimated, true)
})

test('advisor answers preserve provider-reported cache hits', async () => {
  const { runtime } = createHarness({
    handlers: [(request) => providerResult('已使用缓存上下文回答。', request, {
      input_tokens: 1_500,
      input_tokens_details: { cached_tokens: 1_024, cache_write_tokens: 400 },
      output_tokens: 18,
    })],
  })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id)
  const answer = await runtime.send({ requestId: prepared.requestId })

  assert.equal(answer.usage.inputTokens, 1_500)
  assert.equal(answer.usage.outputTokens, 18)
  assert.equal(answer.usage.cachedInputTokens, 1_024)
  assert.equal(answer.usage.cacheWriteInputTokens, 400)
  assert.equal(answer.usage.cacheStatus, 'hit')
  assert.equal(answer.usage.estimated, false)
})

test('a non-tool JSON response is returned verbatim after a local lookup', async () => {
  const { runtime, requests } = createHarness({
    versioned: baseVersioned({
      grades: [{ id: 'grade-1', courseName: '高级材料化学', score: '91' }],
    }),
    handlers: [
      JSON.stringify({ schema: 'theia-advisor-tool-call/v1', tool: 'search_campus_records', args: { domain: 'grades', limit: 1 } }),
      '{"claimed":"伪造引用"}',
    ],
  })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id, { question: '看一下成绩。', intent: 'risk' })
  const answer = await runtime.send({ requestId: prepared.requestId, approved: true })

  assert.equal(answer.rawText, '{"claimed":"伪造引用"}')
  assert.equal(requests.length, 2)
})

test('structured model narratives are rendered only after their evidence is verified', async () => {
  const { runtime, requests } = createHarness({
    versioned: baseVersioned({
      grades: [{ id: 'grade-1', courseName: '高级材料化学', courseCode: 'MAT100', score: '91' }],
    }),
    handlers: [
      JSON.stringify({ schema: 'theia-advisor-tool-call/v1', tool: 'search_campus_records', args: { domain: 'grades', limit: 1 } }),
      (request) => {
        const claim = observation(request).data.claims[0]
        return providerResult(JSON.stringify({
          schema: 'theia-advisor-model-narrative/v1',
          blocks: [{ claimIds: [claim.id], explanation: claim.displayText }],
          recommendations: [{ text: '把这门课纳入本学期的复习计划。', basedOnClaimIds: [claim.id] }],
          uncertainties: [],
          questionsForUser: [],
          suggestedActionIds: [],
        }), request)
      },
    ],
  })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id, { question: '看看高级材料化学的成绩。' })
  const answer = await runtime.send({ requestId: prepared.requestId })

  assert.equal(requests.length, 2)
  assert.equal(answer.narrative.schema, 'theia-advisor-model-narrative/v1')
  assert.equal(answer.narrative.blockCount, 1)
  assert.match(answer.displayText, /高级材料化学/u)
  assert.match(answer.displayText, /复习计划/u)
  assert.match(answer.rawText, /theia-advisor-model-narrative\/v1/u)
})

test('structured narratives with fabricated evidence are rejected before persistence', async () => {
  const diagnostics = []
  const { runtime } = createHarness({
    onDiagnostic: (event, fields) => diagnostics.push({ event, fields }),
    handlers: [JSON.stringify({
      schema: 'theia-advisor-model-narrative/v1',
      blocks: [{ claimIds: ['claim:invented'], explanation: '这条事实没有本地依据。' }],
      recommendations: [],
      uncertainties: [],
      questionsForUser: [],
      suggestedActionIds: [],
    })],
  })
  const thread = runtime.createThread()

  await assert.rejects(
    runtime.send({ threadId: thread.id, question: '我的成绩怎么样？' }),
    (error) => error instanceof AdvisorRuntimeError && error.code === 'model-output-invalid',
  )
  assert.equal(runtime.listThreads()[0].messages.length, 1)
  assert.equal(diagnostics.at(-1)?.event, 'advisor.run_failed')
})

test('mail metadata and body are retrieved only through separate lazy tools and remain sanitized', async () => {
  const mail = {
    id: 'mail-1', subject: '材料学院通知', from: 'teacher@example.edu', receivedAt: '2026-08-14T03:00:00.000Z',
    snippet: '请查看正文。',
    bodyHtml: '<script>MAIL_HTML_SECRET()</script><p>正文信息 https://mail.example/private?ticket=MAIL_URL_SECRET</p>',
    attachments: [{ index: 0, filename: 'notice.pdf', contentType: 'application/pdf', size: 42 }],
  }
  const { runtime, requests } = createHarness({
    versioned: baseVersioned({ emails: [mail] }),
    handlers: [
      JSON.stringify({ schema: 'theia-advisor-tool-call/v1', tool: 'search_campus_records', args: { domain: 'mailbox', query: '材料', limit: 1 } }),
      (request) => providerResult(JSON.stringify({
        schema: 'theia-advisor-tool-call/v1',
        tool: 'read_message',
        args: { recordId: observation(request).data.items[0].recordId },
      }), request),
      (request) => {
        const result = observation(request).data
        assert.ok(result.referenceId)
        return providerResult('已读取本地邮件正文。', request)
      },
    ],
  })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id, { question: '材料学院通知写了什么？', intent: 'mail' })
  const answer = await runtime.send({ requestId: prepared.requestId, approved: true })
  const outbound = JSON.stringify(requests)

  assert.equal(requests.length, 3)
  assert.equal(answer.rawText, '已读取本地邮件正文。')
  assert.doesNotMatch(requests[0].messages.at(-1).content, /"subject":"材料学院通知"|MAIL_HTML_SECRET|MAIL_URL_SECRET/)
  assert.doesNotMatch(outbound, /MAIL_HTML_SECRET|MAIL_URL_SECRET|mail\.example\/private/)
})

test('frozen workspaces reject a send when the local campus snapshot changes', async () => {
  const versioned = baseVersioned()
  const { runtime, store, requests } = createHarness({ versioned })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id)
  store.replace({ ...versioned, revision: 'fixture-revision-2' })

  await assert.rejects(
    runtime.send({ requestId: prepared.requestId, approved: true }),
    errorCode('stale-disclosure'),
  )
  assert.equal(requests.length, 0)
})

test('the compact session still observes the outbound input budget before it leaves the device', async () => {
  const { runtime, requests } = createHarness({ budget: { maxInputBytes: 1 } })
  const thread = runtime.createThread()
  const prepared = await prepare(runtime, thread.id)

  await assert.rejects(runtime.send({ requestId: prepared.requestId, approved: true }), errorCode('context-too-large'))
  assert.equal(requests.length, 0)
})
