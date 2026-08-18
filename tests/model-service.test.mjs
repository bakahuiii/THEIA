import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { CampusStore } from '../core/store.mjs'
import { CourseWorkService } from '../core/course-work.mjs'
import { ModelService } from '../electron/model-service.mjs'
import {
  createPinnedModelDispatcher,
  isPublicModelAddress,
  prepareModelEndpoint,
} from '../electron/model-network-policy.mjs'
import { ModelVault } from '../electron/model-vault.mjs'
import { recoverModelConfigTransaction, saveModelConfigTransaction } from '../electron/model-config-transaction.mjs'
import { ModelProbeTickets } from '../electron/model-probe-tickets.mjs'
import { modelServiceOrigin, normalizeModelServiceBaseUrl } from '../core/model-url-policy.mjs'
import { normalizeState } from '../core/schema.mjs'

function response(content) {
  return { ok: true, status: 200, text: async () => JSON.stringify({ output_text: content }) }
}

function failedResponse(status, message = 'Endpoint unavailable') {
  return { ok: false, status, text: async () => JSON.stringify({ error: { message } }) }
}

function byteResponse(chunks, { contentLength = null, ok = true, status = 200 } = {}) {
  const values = chunks.map((chunk) => typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk)
  let index = 0
  let cancelled = false
  return {
    ok,
    status,
    headers: new Headers(contentLength === null ? {} : { 'Content-Length': String(contentLength) }),
    body: {
      getReader() {
        return {
          async read() {
            if (cancelled || index >= values.length) return { done: true, value: undefined }
            return { done: false, value: values[index++] }
          },
          async cancel() { cancelled = true },
          releaseLock() {},
        }
      },
      async cancel() { cancelled = true },
    },
    get cancelled() { return cancelled },
  }
}

function fakeVault() {
  return {
    async status() { return { saved: true, encryptionAvailable: true } },
    async readApiKey() { return 'test-key' },
  }
}

const PUBLIC_DNS_RECORDS = Object.freeze([
  Object.freeze({ address: '93.184.216.34', family: 4 }),
  Object.freeze({ address: '2606:4700:4700::1111', family: 6 }),
])

async function publicResolver() {
  return PUBLIC_DNS_RECORDS
}

function fakeDispatcherFactory({ hostname, addresses, lookup }) {
  return {
    hostname,
    addresses,
    lookup,
    closed: false,
    async close() { this.closed = true },
  }
}

function modelNetwork(overrides = {}) {
  return { resolver: publicResolver, dispatcherFactory: fakeDispatcherFactory, ...overrides }
}

async function listenLoopback(handler) {
  const server = createServer(handler)
  const sockets = new Set()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Loopback test server did not expose a TCP address')
  return {
    server,
    port: address.port,
    async close() {
      for (const socket of sockets) socket.destroy()
      if (server.listening) await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()))
    },
  }
}

function trackedDispatcherFactory(records) {
  return ({ hostname, addresses, lookup }) => {
    const record = { hostname, addresses, lookupCalls: 0 }
    const trackedLookup = (...args) => {
      record.lookupCalls += 1
      return lookup(...args)
    }
    const dispatcher = createPinnedModelDispatcher({ lookup: trackedLookup })
    record.dispatcher = dispatcher
    records.push(record)
    return dispatcher
  }
}

function fakeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, 'utf8'),
    decryptString: (value) => Buffer.from(value).toString('utf8'),
  }
}

function modelConfigJournal(previousSettings, previousVault) {
  const payload = {
    schema: 'theia-model-config-transaction/v1',
    createdAt: '2026-08-13T00:00:00.000Z',
    previousSettings,
    previousVault,
  }
  return JSON.stringify({
    ...payload,
    digest: createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex'),
  }) + '\n'
}

async function setup(kind) {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-model-'))
  const store = new CampusStore(root)
  await store.load()
  await store.update((state) => ({
    ...state,
    assignments: [{
      id: `model-${kind}-001`, title: 'Model task', courseName: 'Test course', kind,
      dueAt: new Date(Date.now() + 86_400_000).toISOString(), status: 'pending', source: 'theol',
      courseId: 'model-course',
      courseSourceUrl: 'https://course.buct.edu.cn/meol/homepage/course/course_index.jsp?courseId=model-course',
      sourceUrl: kind === 'online-test'
        ? 'https://course.buct.edu.cn/meol/common/question/test/student/stu_qtest_navigate.jsp?testId=7002'
        : 'https://course.buct.edu.cn/meol/common/hw/student/hwtask.view.jsp?hwtid=7001',
    }],
  }))
  const client = {
    async page(url) {
      const question = kind === 'online-test'
        ? '<div class="question"><p>1. Choose water</p><label><input type="radio" name="q1" value="A">A. H2O</label><label><input type="radio" name="q1" value="B">B. CO2</label></div>'
        : ''
      return { url, text: `<h1>Model task</h1><p>Answer from supplied information.</p>${question}` }
    },
    async binary() { return { buffer: Buffer.from('attachment') } },
  }
  const courseWork = new CourseWorkService({ root, store, client })
  await courseWork.prepare(`model-${kind}-001`)
  return { root, store, courseWork }
}

test('model service saves a local markdown assignment draft without exposing its API key', async () => {
  const context = await setup('assignment')
  try {
    const service = new ModelService({ ...modelNetwork(), vault: fakeVault(), courseWork: context.courseWork, fetchFn: async (url, request) => {
      assert.equal(url, 'https://model.example/v1/responses')
      assert.equal(request.headers.Authorization, 'Bearer test-key')
      return response('# Draft\n\nA complete local answer.')
    } })
    const result = await service.process('model-assignment-001', { modelBaseUrl: 'https://model.example', modelName: 'test-model' })
    const workspace = result.workspace
    assert.match(await readFile(workspace.modelAnswerPath, 'utf8'), /complete local answer/)
    const manifest = JSON.parse(await readFile(resolve(context.root, 'data', 'manifest.json'), 'utf8'))
    const fragments = await Promise.all(Object.values(manifest.fragments).map(async (reference) =>
      readFile(resolve(context.root, 'data', reference.path), 'utf8'),
    ))
    assert.doesNotMatch(fragments.join('\n'), /test-key/)
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

test('model service validates and writes complete online-test answers locally', async () => {
  const context = await setup('online-test')
  try {
    const service = new ModelService({ ...modelNetwork(), vault: fakeVault(), courseWork: context.courseWork, fetchFn: async () => response('{"answers":[{"question":1,"answer":"A"}]}') })
    const result = await service.process('model-online-test-001', { modelBaseUrl: 'https://model.example/v1', modelName: 'test-model' })
    assert.deepEqual(JSON.parse(await readFile(result.workspace.answerKeyPath, 'utf8')).answers, [{ question: 1, answer: 'A' }])
    assert.equal(result.workspace.state, 'model-ready')
  } finally {
    await rm(context.root, { recursive: true, force: true })
  }
})

test('model service discovers OpenAI-compatible models and selects a useful default', async () => {
  const service = new ModelService({ ...modelNetwork(), vault: fakeVault(), courseWork: {}, fetchFn: async (url, request) => {
    assert.equal(url, 'https://model.example/v1/models')
    assert.equal(request.headers.Authorization, 'Bearer test-key')
    return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: 'text-utility' }, { id: 'gpt-4.1-mini' }, { id: 'text-utility' }] }) }
  } })
  const discovered = await service.discover({ baseUrl: 'https://model.example', apiKey: 'test-key' })
  assert.deepEqual(discovered.models, ['gpt-4.1-mini', 'text-utility'])
  assert.equal(discovered.selectedModel, 'gpt-4.1-mini')
})

test('model service normalizes an OpenAI-compatible service root to Responses', async () => {
  const service = new ModelService({ ...modelNetwork(), vault: fakeVault(), courseWork: {}, fetchFn: async (url, request) => {
    assert.equal(url, 'https://model.example/v1/responses')
    assert.deepEqual(JSON.parse(request.body), {
      model: 'test-model',
      input: [
        { role: 'system', content: [{ type: 'input_text', text: 'system instruction' }] },
        { role: 'user', content: [{ type: 'input_text', text: 'question' }] },
      ],
      max_output_tokens: 321,
      stream: false,
    })
    return { ok: true, status: 200, text: async () => JSON.stringify({ output_text: 'Responses answer' }) }
  } })

  assert.equal(await service.request(
    { modelBaseUrl: 'https://model.example', modelName: 'test-model' },
    [{ role: 'system', content: 'system instruction' }, { role: 'user', content: 'question' }],
    { temperature: 0.3, maxTokens: 321 },
  ), 'Responses answer')
})

test('model service sends the standard Responses cache key without relay-specific fields', async () => {
  const service = new ModelService({ ...modelNetwork(), vault: fakeVault(), courseWork: {}, fetchFn: async (url, request) => {
    assert.equal(url, 'https://model.example/v1/responses')
    const body = JSON.parse(request.body)
    assert.deepEqual(body.input, [
       { role: 'system', content: [{ type: 'input_text', text: 'stable cached prefix', prompt_cache_breakpoint: { mode: 'explicit' } }] },
       { role: 'system', content: [{ type: 'input_text', text: 'request-specific style' }] },
       { role: 'user', content: [{ type: 'input_text', text: 'the user question' }] },
     ])
    assert.equal(body.prompt_cache_key, 'theia-advisor-agent-v1-abc123')
    assert.deepEqual(body.prompt_cache_options, { mode: 'explicit' })
    assert.equal(Object.hasOwn(body, 'instructions'), false)
    return response('Responses answer')
  } })

  assert.equal(await service.request(
    { modelBaseUrl: 'https://model.example/v1', modelName: 'gpt-5.6-test' },
    [
      { role: 'system', content: 'stable cached prefix' },
      { role: 'system', content: 'request-specific style' },
      { role: 'user', content: 'the user question' },
    ],
    { promptCacheKey: 'theia-advisor-agent-v1-abc123' },
  ), 'Responses answer')
})

test('model service keeps the standard cache key for compatible model aliases', async () => {
  const service = new ModelService({ ...modelNetwork(), vault: fakeVault(), courseWork: {}, fetchFn: async (_url, request) => {
    const body = JSON.parse(request.body)
     assert.equal(body.prompt_cache_key, 'theia-advisor-agent-v1-abc123')
    assert.equal(Object.hasOwn(body, 'prompt_cache_options'), false)
    assert.equal(Object.hasOwn(body.input[0].content[0], 'prompt_cache_breakpoint'), false)
    return response('Responses answer')
  } })

  assert.equal(await service.request(
    { modelBaseUrl: 'https://model.example/v1', modelName: 'gpt-5.5' },
    [{ role: 'system', content: 'system instruction' }, { role: 'user', content: 'question' }],
    { promptCacheKey: 'theia-advisor-agent-v1-abc123' },
  ), 'Responses answer')
})

test('model service keeps the standard cache key when explicit breakpoints are unsupported', async () => {
  const requests = []
  const service = new ModelService({ ...modelNetwork(), vault: fakeVault(), courseWork: {}, fetchFn: async (_url, request) => {
    const body = JSON.parse(request.body)
    requests.push(body)
    if (requests.length === 1) return failedResponse(400, 'prompt_cache_breakpoint is not supported on this model')
    assert.equal(body.prompt_cache_key, 'theia-advisor-agent-v1-abc123')
    assert.equal(Object.hasOwn(body, 'prompt_cache_options'), false)
    assert.equal(Object.hasOwn(body.input[0].content[0], 'prompt_cache_breakpoint'), false)
    return response('Responses answer')
  } })

  assert.equal(await service.request(
    { modelBaseUrl: 'https://model.example/v1', modelName: 'gpt-5.6-relay' },
    [{ role: 'system', content: 'stable prefix' }, { role: 'user', content: 'question' }],
    { promptCacheKey: 'theia-advisor-agent-v1-abc123' },
  ), 'Responses answer')
  assert.equal(requests.length, 2)
  assert.equal(Object.hasOwn(requests[0], 'prompt_cache_options'), true)
  assert.equal(Object.hasOwn(requests[0].input[0].content[0], 'prompt_cache_breakpoint'), true)
})

test('model service retries without prompt caching when a compatible server rejects the cache extension', async () => {
  const requests = []
  const service = new ModelService({ ...modelNetwork(), vault: fakeVault(), courseWork: {}, fetchFn: async (_url, request) => {
    const body = JSON.parse(request.body)
    requests.push(body)
    if (requests.length === 1) return failedResponse(400, 'prompt_cache_key is not supported on this model')
    return response('Responses answer')
  } })

  assert.equal(await service.request(
    { modelBaseUrl: 'https://model.example/v1', modelName: 'gpt-5.6-compatible' },
    [{ role: 'system', content: 'stable prefix' }, { role: 'user', content: 'question' }],
    { promptCacheKey: 'theia-advisor-agent-v1-abc123' },
  ), 'Responses answer')
  assert.equal(Object.hasOwn(requests[0], 'prompt_cache_key'), true)
  assert.equal(Object.hasOwn(requests[1], 'prompt_cache_key'), false)

  await service.request(
    { modelBaseUrl: 'https://model.example/v1', modelName: 'gpt-5.6-compatible' },
    [{ role: 'system', content: 'stable prefix' }, { role: 'user', content: 'second question' }],
    { promptCacheKey: 'theia-advisor-agent-v1-abc123' },
  )
  assert.equal(requests.length, 3)
  assert.equal(Object.hasOwn(requests[2], 'prompt_cache_key'), false)
})

test('streaming model requests retry cache-extension rejection without duplicating deltas', async () => {
  const requests = []
  const deltas = []
  const service = new ModelService({ ...modelNetwork(), vault: fakeVault(), courseWork: {}, fetchFn: async (_url, request) => {
    const body = JSON.parse(request.body)
    requests.push(body)
    if (requests.length === 1) return byteResponse([JSON.stringify({ error: { message: 'prompt_cache_key is unsupported' } })], { ok: false, status: 400 })
    return byteResponse(['data: {"type":"response.output_text.delta","delta":"ok"}\n', 'data: [DONE]\n'])
  } })

  assert.equal(await service.requestStream(
    { modelBaseUrl: 'https://model.example/v1', modelName: 'gpt-5.6-compatible' },
    [{ role: 'system', content: 'stable prefix' }, { role: 'user', content: 'question' }],
    { promptCacheKey: 'theia-advisor-agent-v1-abc123', onDelta: (delta) => deltas.push(delta) },
  ), 'ok')
  assert.deepEqual(deltas, ['ok'])
  assert.equal(Object.hasOwn(requests[0], 'prompt_cache_key'), true)
  assert.equal(Object.hasOwn(requests[1], 'prompt_cache_key'), false)
})

test('model service encodes prior assistant turns as Responses output text', async () => {
  const service = new ModelService({ ...modelNetwork(), vault: fakeVault(), courseWork: {}, fetchFn: async (url, request) => {
    assert.equal(url, 'https://model.example/v1/responses')
    const body = JSON.parse(request.body)
    assert.deepEqual(body.input, [
      { role: 'user', content: [{ type: 'input_text', text: 'question' }] },
      { role: 'assistant', content: [{ type: 'output_text', text: '{"schema":"theia-advisor-tool-call/v1"}' }] },
      { role: 'user', content: [{ type: 'input_text', text: '{"schema":"theia-advisor-tool-observation/v1"}' }] },
    ])
    assert.deepEqual(body.reasoning, { effort: 'high' })
    return { ok: true, status: 200, text: async () => JSON.stringify({ output_text: 'answer' }) }
  } })
  assert.equal(await service.request(
    { modelBaseUrl: 'https://model.example', modelName: 'test-model' },
    [
      { role: 'user', content: 'question' },
      { role: 'assistant', content: '{"schema":"theia-advisor-tool-call/v1"}' },
      { role: 'user', content: '{"schema":"theia-advisor-tool-observation/v1"}' },
    ],
    { reasoningEffort: 'high' },
  ), 'answer')
})

test('model service preserves extended Responses reasoning effort values', async () => {
  const efforts = []
  const service = new ModelService({ ...modelNetwork(), vault: fakeVault(), courseWork: {}, fetchFn: async (_url, request) => {
    const body = JSON.parse(request.body)
    efforts.push(body.reasoning?.effort)
    return { ok: true, status: 200, text: async () => JSON.stringify({ output_text: 'answer' }) }
  } })
  for (const effort of ['xhigh', 'max']) {
    await service.request(
      { modelBaseUrl: 'https://model.example/v1', modelName: 'test-model' },
      [{ role: 'user', content: 'question' }],
      { reasoningEffort: effort },
    )
  }
  assert.deepEqual(efforts, ['xhigh', 'max'])
})

test('model service does not fall back to Chat Completions when OpenAI Responses is unavailable', async () => {
  const requests = []
  const service = new ModelService({ ...modelNetwork(), vault: fakeVault(), courseWork: {}, fetchFn: async (url, request) => {
    requests.push({ url, body: JSON.parse(request.body) })
    return failedResponse(400, 'temperature is not supported for this model')
  } })

  await assert.rejects(service.request(
    { modelBaseUrl: 'https://model.example/v1/responses', modelName: 'test-model' },
    [{ role: 'user', content: 'question' }],
  ), /HTTP 400: temperature is not supported for this model/)
  assert.deepEqual(requests.map((request) => request.url), ['https://model.example/v1/responses'])
})

test('model service does not mask Responses authentication failures with Chat fallback', async () => {
  let requests = 0
  const service = new ModelService({ ...modelNetwork(), vault: fakeVault(), courseWork: {}, fetchFn: async () => {
    requests += 1
    return failedResponse(401, 'Invalid API key')
  } })

  await assert.rejects(service.request(
    { modelBaseUrl: 'https://model.example/v1/responses', modelName: 'test-model' },
    [{ role: 'user', content: 'question' }],
  ), /HTTP 401/)
  assert.equal(requests, 1)
})

test('model service streams OpenAI Responses deltas without a Chat fallback', async (t) => {
  await t.test('responses stream', async () => {
    const deltas = []
    const service = new ModelService({ ...modelNetwork(), vault: fakeVault(), courseWork: {}, fetchFn: async (url, request) => {
      assert.equal(url, 'https://model.example/v1/responses')
      assert.equal(JSON.parse(request.body).stream, true)
      return byteResponse([
        'data: {"type":"response.output_text.delta","delta":"hello "}\n\n',
        'data: {"type":"response.output_text.delta","delta":"world"}\n\n',
      ])
    } })
    assert.equal(await service.requestStream(
      { modelBaseUrl: 'https://model.example/v1/responses', modelName: 'test-model' },
      [{ role: 'user', content: 'question' }],
      { onDelta: (delta) => deltas.push(delta) },
    ), 'hello world')
    assert.deepEqual(deltas, ['hello ', 'world'])
  })

  await t.test('unavailable Responses stream fails without a fallback', async () => {
    const urls = []
    const service = new ModelService({ ...modelNetwork(), vault: fakeVault(), courseWork: {}, fetchFn: async (url) => {
      urls.push(url)
      return failedResponse(405)
    } })
    await assert.rejects(service.requestStream(
      { modelBaseUrl: 'https://model.example/v1/responses', modelName: 'test-model' },
      [{ role: 'user', content: 'question' }],
    ), /HTTP 405/)
    assert.deepEqual(urls, ['https://model.example/v1/responses'])
  })
})

test('model service preserves Responses completion usage and cached input metadata', async () => {
  const metadata = []
  const service = new ModelService({ ...modelNetwork(), vault: fakeVault(), courseWork: {}, fetchFn: async () => byteResponse([
    'data: {"type":"response.output_text.delta","delta":"ok"}\n\n',
    'data: {"type":"response.completed","response":{"id":"resp_cache_1","usage":{"input_tokens":1500,"input_tokens_details":{"cached_tokens":1024,"cache_write_tokens":400},"output_tokens":12}}}\n\n',
    'data: [DONE]\n\n',
  ]) })

  assert.equal(await service.requestStream(
    { modelBaseUrl: 'https://model.example/v1', modelName: 'gpt-5.6-luna' },
    [{ role: 'system', content: 'stable prefix' }, { role: 'user', content: 'question' }],
    { onMetadata: (value) => metadata.push(value) },
  ), 'ok')
  assert.deepEqual(metadata.at(-1), {
    requestId: 'resp_cache_1',
    usage: {
      inputTokens: 1500,
      outputTokens: 12,
      cachedInputTokens: 1024,
      cacheWriteInputTokens: 400,
      cacheStatus: 'hit',
    },
  })
})

test('model service fails closed on streamed Responses error and incomplete events', async (t) => {
  for (const terminal of [
    { type: 'error', payload: { type: 'error', error: { message: 'relay stream failed' } }, expected: /returned error/i },
    { type: 'incomplete', payload: { type: 'response.incomplete', response: { status_details: { reason: 'max_output_tokens' } } }, expected: /returned incomplete/i },
  ]) {
    await t.test(terminal.type, async () => {
      const deltas = []
      const service = new ModelService({ ...modelNetwork(), vault: fakeVault(), courseWork: {}, fetchFn: async () => byteResponse([
        'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
        `data: ${JSON.stringify(terminal.payload)}\n\n`,
      ]) })
      await assert.rejects(service.requestStream(
        { modelBaseUrl: 'https://model.example/v1', modelName: 'gpt-5.6-test' },
        [{ role: 'user', content: 'question' }],
        { onDelta: (delta) => deltas.push(delta) },
      ), terminal.expected)
      assert.deepEqual(deltas, ['partial'])
    })
  }
})

test('model discovery derives the model list endpoint from an OpenAI Responses URL', async () => {
  const service = new ModelService({ ...modelNetwork(), vault: fakeVault(), courseWork: {}, fetchFn: async (url) => {
    assert.equal(url, 'https://model.example/v1/models')
    return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: 'response-model' }] }) }
  } })
  assert.deepEqual(await service.discover({ baseUrl: 'https://model.example/v1/responses', apiKey: 'test-key' }), {
    models: ['response-model'],
    selectedModel: 'response-model',
  })
})

test('model service maps Anthropic, Gemini, and Ollama requests to their explicit protocols', async (t) => {
  const cases = [
    {
      provider: 'anthropic-messages', baseUrl: 'https://api.example/v1', model: 'claude-test',
      expectedUrl: 'https://api.example/v1/messages', response: { content: [{ type: 'text', text: 'anthropic answer' }] },
      verify(request) {
        assert.equal(request.headers['x-api-key'], 'test-key')
        assert.equal(request.headers['anthropic-version'], '2023-06-01')
        const body = JSON.parse(request.body)
        assert.equal(body.model, 'claude-test')
        assert.equal(body.system, 'system')
        assert.deepEqual(body.messages, [{ role: 'user', content: 'question' }])
      },
    },
    {
      provider: 'gemini-generate-content', baseUrl: 'https://api.example/v1beta', model: 'gemini-test',
      expectedUrl: 'https://api.example/v1beta/models/gemini-test:generateContent', response: { candidates: [{ content: { parts: [{ text: 'gemini answer' }] } }] },
      verify(request) {
        assert.equal(request.headers['x-goog-api-key'], 'test-key')
        const body = JSON.parse(request.body)
        assert.deepEqual(body.systemInstruction, { parts: [{ text: 'system' }] })
        assert.deepEqual(body.contents, [{ role: 'user', parts: [{ text: 'question' }] }])
      },
    },
    {
      provider: 'ollama-chat', baseUrl: 'http://127.0.0.1:11434/api', model: 'qwen-test',
      expectedUrl: 'http://127.0.0.1:11434/api/chat', response: { message: { content: 'ollama answer' } },
      vault: { async status() { return { saved: false, bound: false } }, async readApiKey() { return '' } },
      verify(request) {
        assert.equal(request.headers.Authorization, undefined)
        const body = JSON.parse(request.body)
        assert.equal(body.model, 'qwen-test')
        assert.equal(body.stream, false)
      },
    },
  ]
  for (const item of cases) {
    await t.test(item.provider, async () => {
      const service = new ModelService({
        ...modelNetwork(), vault: item.vault || fakeVault(), courseWork: {},
        fetchFn: async (url, request) => {
          assert.equal(url, item.expectedUrl)
          item.verify(request)
          return { ok: true, status: 200, text: async () => JSON.stringify(item.response) }
        },
      })
      const content = await service.request({ modelProvider: item.provider, modelBaseUrl: item.baseUrl, modelName: item.model }, [
        { role: 'system', content: 'system' }, { role: 'user', content: 'question' },
      ])
      assert.match(content, /answer/)
    })
  }
})

test('model service decodes Anthropic and Gemini SSE plus Ollama NDJSON streams', async (t) => {
  const cases = [
    {
      provider: 'anthropic-messages', baseUrl: 'https://api.example', model: 'claude-test',
      chunks: ['data: {"type":"content_block_delta","delta":{"text":"hello "}}\n\n', 'data: {"type":"content_block_delta","delta":{"text":"world"}}\n\n'],
    },
    {
      provider: 'gemini-generate-content', baseUrl: 'https://api.example', model: 'gemini-test',
      chunks: ['data: {"candidates":[{"content":{"parts":[{"text":"hello "}]}}]}\n\n', 'data: {"candidates":[{"content":{"parts":[{"text":"world"}]}}]}\n\n'],
    },
    {
      provider: 'ollama-chat', baseUrl: 'http://localhost:11434', model: 'qwen-test',
      vault: { async status() { return { saved: false, bound: false } }, async readApiKey() { return '' } },
      network: { resolver: async () => [{ address: '127.0.0.1', family: 4 }], dispatcherFactory: fakeDispatcherFactory },
      chunks: ['{"message":{"content":"hello "}}\n', '{"message":{"content":"world"},"done":true}\n'],
    },
  ]
  for (const item of cases) {
    await t.test(item.provider, async () => {
      const deltas = []
      const service = new ModelService({
        ...(item.network || modelNetwork()), vault: item.vault || fakeVault(), courseWork: {},
        fetchFn: async () => byteResponse(item.chunks),
      })
      assert.equal(await service.requestStream({ modelProvider: item.provider, modelBaseUrl: item.baseUrl, modelName: item.model }, [
        { role: 'user', content: 'question' },
      ], { onDelta: (delta) => deltas.push(delta) }), 'hello world')
      assert.deepEqual(deltas, ['hello ', 'world'])
    })
  }
})

test('protocol streaming keeps its pinned dispatcher open until the body is consumed', async (t) => {
  const cases = [
    {
      provider: 'anthropic-messages',
      baseUrl: 'https://api.example',
      model: 'claude-test',
      chunks: [
        'data: {"type":"content_block_delta","delta":{"text":"hello "}}\n\n',
        'data: {"type":"content_block_delta","delta":{"text":"world"}}\n\n',
      ],
    },
    {
      provider: 'ollama-chat',
      baseUrl: 'http://localhost:11434',
      model: 'qwen-test',
      vault: { async status() { return { saved: false, bound: false } }, async readApiKey() { return '' } },
      network: { resolver: async () => [{ address: '127.0.0.1', family: 4 }], dispatcherFactory: fakeDispatcherFactory },
      chunks: [
        '{"message":{"content":"hello "}}\n',
        '{"message":{"content":"world"},"done":true}\n',
      ],
    },
  ]
  for (const item of cases) {
    await t.test(item.provider, async () => {
      let dispatcher
      const values = item.chunks.map((chunk) => new TextEncoder().encode(chunk))
      let index = 0
      const service = new ModelService({
        ...(item.network || modelNetwork()),
        vault: item.vault || fakeVault(),
        courseWork: {},
        dispatcherFactory: (options) => {
          dispatcher = fakeDispatcherFactory(options)
          return dispatcher
        },
        fetchFn: async () => ({
          ok: true,
          status: 200,
          body: {
            getReader() {
              return {
                async read() {
                  if (index >= values.length) return { done: true, value: undefined }
                  const value = values[index]
                  index += 1
                  if (index === values.length) assert.equal(dispatcher.closed, false)
                  return { done: false, value }
                },
                releaseLock() {},
              }
            },
          },
        }),
      })
      assert.equal(await service.requestStream({ modelProvider: item.provider, modelBaseUrl: item.baseUrl, modelName: item.model }, [
        { role: 'user', content: 'question' },
      ]), 'hello world')
      assert.equal(dispatcher.closed, true)
    })
  }
})

test('model service URL policy rejects embedded credentials and secret-bearing URLs', () => {
  assert.equal(normalizeModelServiceBaseUrl('https://model.example/v1/'), 'https://model.example/v1')
  assert.equal(normalizeModelServiceBaseUrl('http://127.0.0.1:11434/v1'), 'http://127.0.0.1:11434/v1')
  assert.equal(normalizeModelServiceBaseUrl('http://localhost:11434'), 'http://localhost:11434')
  assert.equal(normalizeModelServiceBaseUrl('http://[::1]:11434/v1'), 'http://[::1]:11434/v1')
  assert.equal(modelServiceOrigin('https://model.example/v1'), 'https://model.example')

  for (const value of [
    'https://alice:secret@model.example/v1',
    'https://model.example/v1?token=secret',
    'https://model.example/v1#secret',
    'http://model.example/v1',
    'http://localhost.example/v1',
    'https://2130706433/v1',
    'https://0x7f000001/v1',
    'https://127.1/v1',
    'https://0177.0.0.1/v1',
    'https://127.0.0.1./v1',
    'javascript:alert(1)',
  ]) {
    assert.throws(() => normalizeModelServiceBaseUrl(value))
  }

  assert.equal(normalizeState({ settings: { modelBaseUrl: 'https://model.example/v1?token=secret' } }).settings.modelBaseUrl, '')
  assert.equal(normalizeState({ settings: { modelBaseUrl: 'https://model.example/v1/' } }).settings.modelBaseUrl, 'https://model.example/v1')
  assert.equal(normalizeState({ settings: { modelProvider: 'ollama-chat' } }).settings.modelProvider, 'ollama-chat')
  assert.equal(normalizeState({ settings: { modelProvider: 'unknown-provider' } }).settings.modelProvider, 'openai-compatible')
})

test('model endpoint address policy allows only public unicast addresses outside explicit loopback', () => {
  for (const address of [
    '8.8.8.8',
    '1.1.1.1',
    '2001:4860:4860::8888',
    '2606:4700:4700::1111',
  ]) assert.equal(isPublicModelAddress(address), true, address)

  for (const address of [
    '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '168.63.129.16',
    '169.254.169.254', '172.16.0.1', '192.0.0.1', '192.0.2.1', '192.88.99.1',
    '192.31.196.1', '192.52.193.1', '192.168.1.1', '192.175.48.1', '198.18.0.1',
    '198.51.100.1', '203.0.113.1', '224.0.0.1',
    '240.0.0.1', '255.255.255.255', '::', '::1', '::ffff:127.0.0.1',
    '::ffff:169.254.169.254', '64:ff9b::7f00:1', 'fc00::1', 'fe80::1', 'ff02::1',
    '2001::1', '2001:1::1', '2001:2::1', '2001:3::1', '2001:4:112::1',
    '2001:10::1', '2001:20::1', '2001:db8::1', '2002::1', '2620:4f:8000::1',
    '3ffe::1', '3fff::1',
  ]) assert.equal(isPublicModelAddress(address), false, address)
})

test('model endpoint preparation accepts only literal explicit loopback for local access', async () => {
  for (const [url, expected] of [
    ['http://localhost:11434/v1/models', [{ address: '127.0.0.1', family: 4 }]],
    ['https://localhost:11434/v1/models', [{ address: '::1', family: 6 }]],
    ['http://127.0.0.1:11434/v1/models', [{ address: '127.0.0.1', family: 4 }]],
    ['http://[::1]:11434/v1/models', [{ address: '::1', family: 6 }]],
  ]) {
    const endpoint = await prepareModelEndpoint(url, {
      resolver: async () => expected,
      dispatcherFactory: fakeDispatcherFactory,
    })
    assert.deepEqual(endpoint.addresses, expected)
    await endpoint.close()
    assert.equal(endpoint.dispatcher.closed, true)
  }

  for (const [url, records] of [
    ['https://local-alias.example/v1', [{ address: '127.0.0.1', family: 4 }]],
    ['https://localhost/v1', [{ address: '93.184.216.34', family: 4 }]],
    ['https://10.0.0.1/v1', []],
    ['https://[::ffff:127.0.0.1]/v1', []],
    ['https://2130706433/v1', []],
    ['https://0x7f000001/v1', []],
    ['https://127.1/v1', []],
  ]) {
    let dispatcherCreations = 0
    await assert.rejects(prepareModelEndpoint(url, {
      resolver: async () => records,
      dispatcherFactory: () => { dispatcherCreations += 1; return {} },
    }), /blocked local or special-use address|explicit literal address/i)
    assert.equal(dispatcherCreations, 0)
  }
})

test('model service audits every DNS result and pins the approved set for fetch', async () => {
  let fetches = 0
  const rebinding = new ModelService({
    vault: fakeVault(),
    courseWork: {},
    resolver: async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ],
    dispatcherFactory: fakeDispatcherFactory,
    fetchFn: async () => { fetches += 1; return response('unexpected') },
  })
  await assert.rejects(rebinding.request(
    { modelBaseUrl: 'https://model.example/v1', modelName: 'test-model' },
    [{ role: 'user', content: 'hello' }],
  ), /blocked local or special-use address/i)
  assert.equal(fetches, 0)

  let dispatcher
  const service = new ModelService({
    ...modelNetwork(),
    vault: fakeVault(),
    courseWork: {},
    dispatcherFactory: (options) => {
      dispatcher = fakeDispatcherFactory(options)
      return dispatcher
    },
    fetchFn: async (url, request) => {
      assert.equal(url, 'https://model.example/v1/responses')
      assert.equal(request.redirect, 'error')
      assert.equal(request.dispatcher, dispatcher)
      assert.equal(dispatcher.hostname, 'model.example')
      assert.deepEqual(dispatcher.addresses, PUBLIC_DNS_RECORDS)
      assert.deepEqual(await new Promise((resolveLookup, rejectLookup) => dispatcher.lookup(
        'model.example', { all: true }, (error, addresses) => error ? rejectLookup(error) : resolveLookup(addresses),
      )), PUBLIC_DNS_RECORDS)
      await assert.rejects(new Promise((resolveLookup, rejectLookup) => dispatcher.lookup(
        'other.example', { all: true }, (error, addresses) => error ? rejectLookup(error) : resolveLookup(addresses),
      )), /unexpected host/i)
      return response('safe response')
    },
  })
  assert.equal(await service.request(
    { modelBaseUrl: 'https://model.example/v1', modelName: 'test-model' },
    [{ role: 'user', content: 'hello' }],
  ), 'safe response')
  assert.equal(dispatcher.closed, true)
})

test('real Undici dispatcher pins localhost to the approved loopback address and preserves Host', async () => {
  let observedHost = null
  let observedPath = null
  const listener = await listenLoopback((request, serverResponse) => {
    observedHost = request.headers.host
    observedPath = request.url
    serverResponse.writeHead(200, { 'Content-Type': 'application/json' })
    serverResponse.end(JSON.stringify({ output_text: 'PINNED_OK' }))
  })
  const dispatchers = []
  try {
    const service = new ModelService({
      vault: fakeVault(),
      courseWork: {},
      resolver: async (hostname, options) => {
        assert.equal(hostname, 'localhost')
        assert.deepEqual(options, { all: true, verbatim: true })
        return [{ address: '127.0.0.1', family: 4 }]
      },
      dispatcherFactory: trackedDispatcherFactory(dispatchers),
    })
    assert.equal(await service.request(
      { modelBaseUrl: `http://localhost:${listener.port}/v1`, modelName: 'test-model' },
      [{ role: 'user', content: 'hello' }],
    ), 'PINNED_OK')
    assert.equal(observedHost, `localhost:${listener.port}`)
    assert.equal(observedPath, '/v1/responses')
    assert.equal(dispatchers.length, 1)
    assert.equal(dispatchers[0].hostname, 'localhost')
    assert.ok(dispatchers[0].lookupCalls >= 1)
    assert.equal(dispatchers[0].dispatcher.closed, true)
    assert.equal(dispatchers[0].dispatcher.destroyed, true)
  } finally {
    await listener.close()
  }
})

test('localhost DNS mixing loopback with public or mapped addresses is rejected before fetch', async () => {
  for (const records of [
    [{ address: '127.0.0.1', family: 4 }, { address: '93.184.216.34', family: 4 }],
    [{ address: '127.0.0.1', family: 4 }, { address: '::ffff:127.0.0.1', family: 6 }],
    [{ address: '127.0.0.1', family: 4 }, { address: '64:ff9b::7f00:1', family: 6 }],
  ]) {
    let fetches = 0
    let dispatchers = 0
    const service = new ModelService({
      vault: fakeVault(),
      courseWork: {},
      resolver: async () => records,
      dispatcherFactory: () => { dispatchers += 1; return {} },
      fetchFn: async () => { fetches += 1; return response('unexpected') },
    })
    await assert.rejects(service.request(
      { modelBaseUrl: 'http://localhost:11434/v1', modelName: 'test-model' },
      [{ role: 'user', content: 'hello' }],
    ), /blocked local or special-use address/i)
    assert.equal(dispatchers, 0)
    assert.equal(fetches, 0)
  }
})

test('model service closes the pinned dispatcher after HTTP failure and cancellation', async () => {
  const listener = await listenLoopback((request, serverResponse) => {
    if (request.url?.includes('/http-failure/')) {
      serverResponse.writeHead(503, { 'Content-Type': 'application/json' })
      serverResponse.end(JSON.stringify({ error: 'unavailable' }))
      return
    }
    request.once('aborted', () => {})
  })
  try {
    for (const scenario of ['http-failure', 'cancelled']) {
      const dispatchers = []
      const service = new ModelService({
        vault: fakeVault(),
        courseWork: {},
        resolver: async () => [{ address: '127.0.0.1', family: 4 }],
        dispatcherFactory: trackedDispatcherFactory(dispatchers),
      })
      const controller = new AbortController()
      const pending = service.request(
        { modelBaseUrl: `http://localhost:${listener.port}/${scenario}`, modelName: 'test-model' },
        [{ role: 'user', content: 'hello' }],
        { signal: controller.signal },
      )
      if (scenario === 'cancelled') setTimeout(() => controller.abort(), 20)
      await assert.rejects(pending, scenario === 'cancelled' ? /cancelled/i : /HTTP 503/i)
      assert.equal(dispatchers.length, 1)
      assert.equal(dispatchers[0].dispatcher.closed, scenario !== 'cancelled')
      assert.equal(dispatchers[0].dispatcher.destroyed, true)
    }
  } finally {
    await listener.close()
  }
})

test('v3 model vault succeeds only for the exact canonical service base path', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-model-vault-'))
  try {
    const vault = new ModelVault(root, fakeStorage())
    await vault.save('BOUND-SECRET', 'https://model.example/v1')

    assert.equal(await vault.readApiKey('https://model.example/v1/'), 'BOUND-SECRET')
    await assert.rejects(vault.readApiKey('https://model.example/other/path'), /different service address or base path/i)
    await assert.rejects(vault.readApiKey('https://other.example/v1'), /different service address or base path/i)
    assert.deepEqual(await vault.status(), {
      saved: true,
      bound: true,
      serviceIdentity: 'https://model.example/v1',
      origin: 'https://model.example',
      encryptionAvailable: true,
      updatedAt: (await vault.status()).updatedAt,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

for (const format of ['theia-model-key/v1', 'theia-model-key/v2']) {
  test(`${format} ciphertext is retained unchanged and requires key re-entry`, async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'theia-model-vault-legacy-'))
    const path = resolve(root, 'model-api-key.v1.dpapi.json')
    try {
      const legacy = JSON.stringify({
        format,
        updatedAt: '2026-08-12T00:00:00.000Z',
        ciphertext: Buffer.from('LEGACY-SECRET').toString('base64'),
      }) + '\n'
      await writeFile(path, legacy, 'utf8')
      const vault = new ModelVault(root, fakeStorage())

      assert.deepEqual(await vault.status(), {
        saved: true,
        bound: false,
        requiresReentry: true,
        legacyFormat: format,
        encryptionAvailable: true,
        updatedAt: '2026-08-12T00:00:00.000Z',
      })
      await assert.rejects(vault.readApiKey('https://model.example/v1'), /re-enter/i)
      assert.equal(await readFile(path, 'utf8'), legacy)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
}

test('clearing the model vault removes a valid pending recovery journal before the saved key', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-model-vault-clear-pending-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    const vault = new ModelVault(root, fakeStorage())
    await vault.save('OLD-SECRET', 'https://old.example/v1')
    const previousVault = await vault.snapshotFile()
    await writeFile(vault.transactionFile, modelConfigJournal({
      modelBaseUrl: 'https://old.example/v1',
      modelName: 'old-model',
      modelModels: ['old-model'],
    }, previousVault), 'utf8')

    await vault.clear()

    const restartedVault = new ModelVault(root, fakeStorage())
    assert.deepEqual(await recoverModelConfigTransaction({ store, vault: restartedVault }), {
      recovered: false,
      snapshot: null,
    })
    assert.equal((await restartedVault.status()).saved, false)
    assert.equal(await restartedVault.readApiKey('https://old.example/v1'), null)
    assert.equal(existsSync(restartedVault.transactionFile), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('clearing the model vault removes a damaged recovery journal so a new key can be saved', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-model-vault-clear-damaged-'))
  try {
    const vault = new ModelVault(root, fakeStorage())
    await vault.save('OLD-SECRET', 'https://old.example/v1')
    await writeFile(vault.transactionFile, '{ damaged journal\n', 'utf8')

    await vault.clear()
    await vault.save('NEW-SECRET', 'https://new.example/v1')

    assert.equal(await vault.readApiKey('https://new.example/v1'), 'NEW-SECRET')
    assert.equal(existsSync(vault.transactionFile), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('model discovery never sends a saved key across origins', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-model-origin-'))
  try {
    const vault = new ModelVault(root, fakeStorage())
    await vault.save('BOUND-SECRET', 'https://model.example/v1')
    let requests = 0
    const service = new ModelService({
      ...modelNetwork(),
      vault,
      courseWork: {},
      fetchFn: async (url, request) => {
        requests += 1
        assert.equal(url, 'https://other.example/v1/models')
        assert.equal(request.headers.Authorization, 'Bearer NEW-SECRET')
        assert.equal(request.redirect, 'error')
        return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: 'new-model' }] }) }
      },
    })

    await assert.rejects(service.discover({ baseUrl: 'https://other.example/v1' }), /different service address or base path/i)
    assert.equal(requests, 0)
    assert.deepEqual(await service.discover({ baseUrl: 'https://other.example/v1', apiKey: 'NEW-SECRET' }), {
      models: ['new-model'],
      selectedModel: 'new-model',
    })
    assert.equal(requests, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('model configuration transaction rolls back both settings and vault ciphertext', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-model-config-rollback-'))
  const settings = { modelBaseUrl: 'https://old.example/v1', modelName: 'old-model', modelModels: ['old-model'] }
  const published = []
  const store = {
    snapshot: () => ({ settings: { ...settings } }),
    async update(mutator) {
      const next = await mutator({ settings: { ...settings } })
      Object.assign(settings, next.settings)
      return next
    },
  }
  let vaultFile = 'OLD-CIPHERTEXT\n'
  const vault = {
    transactionFile: resolve(root, 'model-config-transaction.v1.json'),
    runConfigTransaction(operation) { return operation() },
    async snapshotFile() { return vaultFile },
    async save() { vaultFile = 'NEW-CIPHERTEXT\n' },
    async status() { return { saved: true, bound: true, serviceIdentity: 'https://new.example/v1' } },
    async restoreFile(snapshot) { vaultFile = snapshot },
  }

  try {
    let publishCalls = 0
    await assert.rejects(saveModelConfigTransaction({
      store,
      vault,
      baseUrl: 'https://new.example/v1',
      modelName: 'new-model',
      models: ['new-model'],
      apiKey: 'NEW-KEY',
      publishSnapshot: (snapshot) => {
        publishCalls += 1
        if (publishCalls === 1) throw new Error('snapshot publish failed')
        published.push(snapshot)
      },
    }), /snapshot publish failed/)
    assert.deepEqual(settings, {
      modelBaseUrl: 'https://old.example/v1',
      modelProvider: 'openai-compatible',
      modelName: 'old-model',
      modelModels: ['old-model'],
      modelRouting: {
        advisorFastModel: null,
        advisorDeepModel: null,
        courseworkModel: null,
        fallbackModel: null,
      },
      advisorConfig: {
        budgetLevel: 'high',
        permissionMode: 'read-only',
        reasoningEffort: 'medium',
        responseStyle: 'balanced',
        responseLength: 'adaptive',
        temperature: 1,
      },
    })
    assert.equal(vaultFile, 'OLD-CIPHERTEXT\n')
    assert.equal(published.length, 1)
    assert.deepEqual(published[0].settings, settings)
    await assert.rejects(readFile(vault.transactionFile, 'utf8'), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('concurrent model configuration saves serialize the full recovery and commit transaction', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-model-config-concurrent-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    await store.update((state) => ({
      ...state,
      settings: {
        ...state.settings,
        modelBaseUrl: 'https://old.example/v1',
        modelName: 'old-model',
        modelModels: ['old-model'],
      },
    }))
    const vault = new ModelVault(root, fakeStorage())
    await vault.save('OLD-KEY', 'https://old.example/v1')

    const snapshotsAtEntry = []
    const snapshotFile = vault.snapshotFile.bind(vault)
    vault.snapshotFile = async () => {
      snapshotsAtEntry.push(store.snapshot().settings.modelBaseUrl)
      return snapshotFile()
    }

    const save = vault.save.bind(vault)
    let releaseFirst
    let markFirstSaved
    let secondEntered = false
    const firstSaved = new Promise((resolveSaved) => { markFirstSaved = resolveSaved })
    const firstGate = new Promise((resolveGate) => { releaseFirst = resolveGate })
    vault.save = async (apiKey, baseUrl) => {
      if (apiKey === 'KEY-B') secondEntered = true
      const result = await save(apiKey, baseUrl)
      if (apiKey === 'KEY-A') {
        markFirstSaved()
        await firstGate
      }
      return result
    }

    const first = saveModelConfigTransaction({
      store,
      vault,
      baseUrl: 'https://a.example/v1',
      modelName: 'model-a',
      models: ['model-a'],
      apiKey: 'KEY-A',
    })
    await firstSaved
    const second = saveModelConfigTransaction({
      store,
      vault,
      baseUrl: 'https://b.example/v1',
      modelName: 'model-b',
      models: ['model-b'],
      apiKey: 'KEY-B',
    })

    await new Promise((resolveTurn) => setImmediate(resolveTurn))
    assert.equal(secondEntered, false)
    releaseFirst()
    await Promise.all([first, second])

    assert.deepEqual(snapshotsAtEntry, ['https://old.example/v1', 'https://a.example/v1'])
    assert.equal(store.snapshot().settings.modelBaseUrl, 'https://b.example/v1')
    assert.equal(store.snapshot().settings.modelName, 'model-b')
    assert.equal(await vault.readApiKey('https://b.example/v1'), 'KEY-B')
    await assert.rejects(vault.readApiKey('https://a.example/v1'), /different service address or base path/i)
    assert.equal(existsSync(vault.transactionFile), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('model configuration queue continues after a failed transaction', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-model-config-queue-recovery-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    const vault = new ModelVault(root, fakeStorage())
    const failed = saveModelConfigTransaction({
      store,
      vault,
      baseUrl: 'https://missing-key.example/v1',
      modelName: 'missing-key-model',
      models: ['missing-key-model'],
    })
    const next = saveModelConfigTransaction({
      store,
      vault,
      baseUrl: 'https://working.example/v1',
      modelName: 'working-model',
      models: ['working-model'],
      apiKey: 'WORKING-KEY',
    })

    await assert.rejects(failed, /enter a model API key/i)
    await next
    assert.equal(store.snapshot().settings.modelBaseUrl, 'https://working.example/v1')
    assert.equal(await vault.readApiKey('https://working.example/v1'), 'WORKING-KEY')
    assert.equal(existsSync(vault.transactionFile), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('model configuration journal restores both sides after a simulated process interruption', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-model-config-recovery-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    await store.update((state) => ({
      ...state,
      settings: {
        ...state.settings,
        modelBaseUrl: 'https://old.example/v1',
        modelName: 'old-model',
        modelModels: ['old-model'],
      },
    }))
    const vault = new ModelVault(root, fakeStorage())
    await vault.save('OLD-KEY', 'https://old.example/v1')

    const crash = spawn(process.execPath, [resolve('tests/fixtures/model-config-crash.mjs'), root], {
      cwd: resolve('.'),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const crashOutput = []
    crash.stdout.on('data', (chunk) => crashOutput.push(chunk))
    crash.stderr.on('data', (chunk) => crashOutput.push(chunk))
    const exitCode = await new Promise((resolveExit, reject) => {
      crash.once('error', reject)
      crash.once('exit', resolveExit)
    })
    assert.equal(exitCode, 73, Buffer.concat(crashOutput).toString('utf8'))
    assert.equal(existsSync(vault.transactionFile), true)
    assert.equal(await vault.readApiKey('https://new.example/v1').catch(() => null), null)
    assert.equal((await vault.status()).recoveryPending, true)

    const restartedStore = new CampusStore(root)
    await restartedStore.load()
    const restartedVault = new ModelVault(root, fakeStorage())
    const recovery = await recoverModelConfigTransaction({ store: restartedStore, vault: restartedVault })
    assert.equal(recovery.recovered, true)
    assert.deepEqual(
      {
        modelBaseUrl: restartedStore.snapshot().settings.modelBaseUrl,
        modelName: restartedStore.snapshot().settings.modelName,
        modelModels: restartedStore.snapshot().settings.modelModels,
      },
      { modelBaseUrl: 'https://old.example/v1', modelName: 'old-model', modelModels: ['old-model'] },
    )
    assert.equal(await restartedVault.readApiKey('https://old.example/v1'), 'OLD-KEY')
    await assert.rejects(restartedVault.readApiKey('https://new.example/v1'), /different service address or base path/i)
    assert.equal(existsSync(restartedVault.transactionFile), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('model configuration journal restores both sides after settings commit is interrupted', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-model-config-settings-recovery-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    await store.update((state) => ({
      ...state,
      settings: {
        ...state.settings,
        modelBaseUrl: 'https://old.example/v1',
        modelName: 'old-model',
        modelModels: ['old-model'],
      },
    }))
    const vault = new ModelVault(root, fakeStorage())
    await vault.save('OLD-KEY', 'https://old.example/v1')

    const crash = spawn(process.execPath, [resolve('tests/fixtures/model-config-crash.mjs'), root, 'after-settings'], {
      cwd: resolve('.'),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const crashOutput = []
    crash.stdout.on('data', (chunk) => crashOutput.push(chunk))
    crash.stderr.on('data', (chunk) => crashOutput.push(chunk))
    const exitCode = await new Promise((resolveExit, reject) => {
      crash.once('error', reject)
      crash.once('exit', resolveExit)
    })
    assert.equal(exitCode, 74, Buffer.concat(crashOutput).toString('utf8'))
    assert.equal(existsSync(vault.transactionFile), true)

    const interruptedStore = new CampusStore(root)
    await interruptedStore.load()
    assert.equal(interruptedStore.snapshot().settings.modelBaseUrl, 'https://new.example/v1')
    assert.equal((await vault.status()).recoveryPending, true)

    const restartedVault = new ModelVault(root, fakeStorage())
    const recovery = await recoverModelConfigTransaction({ store: interruptedStore, vault: restartedVault })
    assert.equal(recovery.recovered, true)
    assert.equal(interruptedStore.snapshot().settings.modelBaseUrl, 'https://old.example/v1')
    assert.equal(interruptedStore.snapshot().settings.modelName, 'old-model')
    assert.deepEqual(interruptedStore.snapshot().settings.modelModels, ['old-model'])
    assert.equal(await restartedVault.readApiKey('https://old.example/v1'), 'OLD-KEY')
    await assert.rejects(restartedVault.readApiKey('https://new.example/v1'), /different service address or base path/i)
    assert.equal(existsSync(restartedVault.transactionFile), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('model service rejects oversized Content-Length before reading the response body', async () => {
  const oversized = byteResponse([], { contentLength: 8 * 1024 * 1024 + 1 })
  const service = new ModelService({ ...modelNetwork(), vault: fakeVault(), courseWork: {}, fetchFn: async () => oversized })
  await assert.rejects(service.request(
    { modelBaseUrl: 'https://model.example/v1', modelName: 'test-model' },
    [{ role: 'user', content: 'hello' }],
  ), /exceeds the .*byte limit/i)
  assert.equal(oversized.cancelled, true)
})

test('model service applies a caller-specific completion response limit while streaming', async () => {
  const oversized = byteResponse([new Uint8Array(1_025)])
  const service = new ModelService({ ...modelNetwork(), vault: fakeVault(), courseWork: {}, fetchFn: async () => oversized })
  await assert.rejects(service.request(
    { modelBaseUrl: 'https://model.example/v1', modelName: 'test-model' },
    [{ role: 'user', content: 'hello' }],
    { maxResponseBytes: 1_024 },
  ), /exceeds the 1024-byte limit/i)
  assert.equal(oversized.cancelled, true)
})

test('model service honors a caller-provided request timeout', async () => {
  let aborted = false
  const service = new ModelService({ ...modelNetwork(), vault: fakeVault(), courseWork: {}, fetchFn: async (_url, request) => new Promise((_resolve, reject) => {
    request.signal.addEventListener('abort', () => {
      aborted = true
      const error = new Error('request aborted')
      error.name = 'AbortError'
      reject(error)
    }, { once: true })
  }) })
  await assert.rejects(service.request(
    { modelBaseUrl: 'https://model.example/v1', modelName: 'test-model' },
    [{ role: 'user', content: 'hello' }],
    { timeoutMs: 20 },
  ), /timed out after 20 milliseconds/i)
  assert.equal(aborted, true)
})

test('model discovery rejects a streamed response that grows beyond its byte limit', async () => {
  const chunk = new Uint8Array(1024 * 1024 + 1)
  const streamed = byteResponse([chunk, chunk])
  const service = new ModelService({ ...modelNetwork(), vault: fakeVault(), courseWork: {}, fetchFn: async () => streamed })
  await assert.rejects(service.discover({ baseUrl: 'https://model.example/v1', apiKey: 'test-key' }), /exceeds the .*byte limit/i)
  assert.equal(streamed.cancelled, true)
})

test('model probe tickets are successful, one-use, expiring, and bound to URL and key', () => {
  let now = 1_000
  let nextId = 0
  const tickets = new ModelProbeTickets({ now: () => now, createId: () => `probe-${++nextId}`, lifetimeMs: 100 })
  const issue = (overrides = {}) => tickets.issue({ baseUrl: 'https://model.example/v1', apiKey: 'key-one', models: ['model-a'], succeeded: true, ...overrides })

  const success = issue()
  assert.deepEqual(tickets.consume({ probeId: success, baseUrl: 'https://model.example/v1', apiKey: 'key-one', modelName: 'model-a' }), ['model-a'])
  assert.throws(() => tickets.consume({ probeId: success, baseUrl: 'https://model.example/v1', apiKey: 'key-one', modelName: 'model-a' }), /detect.*again/i)

  const changedUrl = issue()
  assert.throws(() => tickets.consume({ probeId: changedUrl, baseUrl: 'https://model.example/v2', apiKey: 'key-one', modelName: 'model-a' }), /address or API key changed/i)
  const changedKey = issue()
  assert.throws(() => tickets.consume({ probeId: changedKey, baseUrl: 'https://model.example/v1', apiKey: 'key-two', modelName: 'model-a' }), /address or API key changed/i)

  const expired = issue()
  now += 101
  assert.throws(() => tickets.consume({ probeId: expired, baseUrl: 'https://model.example/v1', apiKey: 'key-one', modelName: 'model-a' }), /detect.*again/i)

  const providerBound = issue({ provider: 'gemini-generate-content' })
  assert.throws(() => tickets.consume({
    probeId: providerBound, baseUrl: 'https://model.example/v1', apiKey: 'key-one', modelName: 'model-a', provider: 'anthropic-messages',
  }), /protocol.*changed/i)
})

test('failed probe tickets require explicit manual model fallback', () => {
  let id = 0
  const tickets = new ModelProbeTickets({ createId: () => `manual-${++id}` })
  const rejected = tickets.issue({ baseUrl: 'https://model.example/v1', apiKey: 'key', models: [], succeeded: false })
  assert.throws(() => tickets.consume({ probeId: rejected, baseUrl: 'https://model.example/v1', apiKey: 'key', modelName: 'manual-model' }), /manual model ID/i)
  const allowed = tickets.issue({ baseUrl: 'https://model.example/v1', apiKey: 'key', models: [], succeeded: false })
  assert.deepEqual(tickets.consume({ probeId: allowed, baseUrl: 'https://model.example/v1', apiKey: 'key', modelName: 'manual-model', allowManualModel: true }), [])
})
