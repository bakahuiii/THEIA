import test from 'node:test'
import assert from 'node:assert/strict'
import { UltraOrchestrator } from '../electron/ultra-mode/orchestrator.mjs'
import { shouldUseUltraMode } from '../electron/ultra-mode/adapter.mjs'

function orchestratorOptions(overrides = {}) {
  return {
    runtime: { provider: { async generateStream() { return { text: 'answer' } } } },
    mainThreadId: 'thread-1',
    requestId: 'request-1',
    model: 'advisor-model',
    promptCacheKey: 'theia-advisor-agent-v1-fixture',
    budget: { maxSteps: 12, maxOutputTokens: 2_000, maxInputTokens: 5_000 },
    workspace: { tools: { search_campus_records: () => ({ data: { items: [] } }) } },
    onStream: () => {},
    ...overrides,
  }
}

test('Ultra activation is explicit and never inferred from question text', () => {
  assert.equal(shouldUseUltraMode({ budgetLevel: 'high', question: '请全面分析并比较我的成绩和课程规划。' }), false)
  assert.equal(shouldUseUltraMode({ budgetLevel: 'ultra', question: '你好' }), true)
})

test('Ultra retries a transport failure once with fallback before any provider delta', async () => {
  const requests = []
  const events = []
  let calls = 0
  const provider = {
    async generateStream(request) {
      requests.push(request)
      calls += 1
      if (calls === 1) throw new Error('Model request timed out after 90 seconds')
      return { text: 'fallback answer' }
    },
  }
  const orchestrator = new UltraOrchestrator(orchestratorOptions({
    runtime: { provider },
    fallbackModel: 'fallback-model',
    onStream: (event) => events.push(event),
  }))

  const response = await orchestrator.callModel({
    messages: [{ role: 'user', content: 'test' }],
    maxTokens: 256,
    temperature: 1,
    phase: 'test',
  })

  assert.equal(response.text, 'fallback answer')
  assert.deepEqual(requests.map((request) => request.model), ['advisor-model', 'fallback-model'])
  assert.deepEqual(events.filter((event) => event.type === 'model_failover').map((event) => ({
    type: event.type, phase: event.phase, fromModelId: event.fromModelId, modelId: event.modelId, reason: event.reason,
  })), [{
    type: 'model_failover', phase: 'test', fromModelId: 'advisor-model', modelId: 'fallback-model', reason: 'timeout',
  }])
})

test('Ultra validates task graph ids, dependencies, and tools before execution', () => {
  const orchestrator = new UltraOrchestrator(orchestratorOptions())
  assert.throws(() => orchestrator.parseTasksFromResponse({ text: JSON.stringify([
    { id: 'a', description: 'a', tools: ['search_campus_records'], dependencies: ['b'] },
    { id: 'b', description: 'b', tools: ['search_campus_records'], dependencies: ['a'] },
  ]) }), /cycle/i)
  assert.throws(() => orchestrator.parseTasksFromResponse({ text: JSON.stringify([
    { id: 'a', description: 'a', tools: ['open_url'], dependencies: [] },
  ]) }), /unavailable tool/i)
  assert.throws(() => orchestrator.parseTasksFromResponse({ text: JSON.stringify([
    { id: 'a', description: 'a', tools: [], dependencies: [] },
    { id: 'a', description: 'duplicate', tools: [], dependencies: [] },
  ]) }), /duplicated/i)
})

test('Ultra decomposition prompt preserves ordered profile and file dependencies', async () => {
  const requests = []
  const orchestrator = new UltraOrchestrator(orchestratorOptions({
    runtime: {
      provider: {
        async generateStream(request) {
          requests.push(request)
          return {
            text: JSON.stringify([
              { id: 'profile', description: '读取个人资料', tools: ['search_campus_records'], dependencies: [] },
              { id: 'write', description: '写入网页文件', tools: ['write_file'], dependencies: ['profile'] },
            ]),
          }
        },
      },
    },
  }))

  await orchestrator.decompose('帮我写一个包含我的个人信息的个人博客网页')
  const prompt = requests[0].messages[0].content
  assert.match(prompt, /必须先安排.*profile/u)
  assert.match(prompt, /包含 write_file.*依赖/u)
  assert.match(prompt, /不能只描述.*实际操作/u)
})

test('Ultra uses THEIA generateStream with the real request id and preserves usage', async () => {
  const requests = []
  const events = []
  const provider = {
    async generateStream(request, { signal, onEvent } = {}) {
      assert.notEqual(signal?.aborted, true)
      requests.push(request)
      onEvent?.({ type: 'started', modelId: request.model })
      const last = request.messages.at(-1)?.content || ''
      const text = last.includes('任务分解器')
        ? JSON.stringify([
          { id: 'task-1', description: '读取成绩', tools: ['search_campus_records'], dependencies: [] },
          { id: 'task-2', description: '汇总成绩', tools: [], dependencies: ['task-1'] },
        ])
        : last.includes('汇总器') ? '最终汇总答案' : '子任务已完成'
      const usage = {
        inputTokens: 100,
        outputTokens: 20,
        cachedInputTokens: 64,
        cacheWriteInputTokens: 32,
        cacheStatus: 'hit',
      }
      onEvent?.({ type: 'delta', delta: text })
      onEvent?.({ type: 'completed', modelId: request.model, usage })
      return { text, requestId: `provider-${requests.length}`, usage }
    },
  }
  const orchestrator = new UltraOrchestrator(orchestratorOptions({
    runtime: { provider },
    temperature: 1.6,
    reasoningEffort: 'high',
    onStream: (event) => events.push(event),
  }))
  const answer = await orchestrator.execute('请综合分析我的成绩')

  assert.equal(answer, '最终汇总答案')
  assert.equal(requests.length, 4)
  assert.ok(requests.every((request) => request.model === 'advisor-model'))
  assert.ok(requests.every((request) => request.temperature === 1.6))
  assert.ok(requests.every((request) => request.reasoningEffort === 'high'))
  assert.ok(requests.every((request) => request.promptCacheKey === 'theia-advisor-agent-v1-fixture'))
  assert.ok(requests.slice(1, 3).every((request) => request.messages.some((message) => message.role === 'user' && message.content.includes('子任务'))))
  assert.ok(events.some((event) => event.type === 'model_started'))
  assert.ok(events.some((event) => event.type === 'model_completed'))
  assert.ok(events.every((event) => !event.requestId || event.requestId === 'request-1'))
  assert.equal(orchestrator.tokenUsage.modelCalls, 4)
  assert.equal(orchestrator.tokenUsage.cacheStatus, 'hit')
  assert.equal(orchestrator.tokenUsage.cachedInputTokens, 256)
  assert.equal(orchestrator.tokenUsage.cacheWriteInputTokens, 128)
  assert.equal(orchestrator.tokenUsage.outputTokens, 80)
})

test('Ultra checks cancellation before starting a provider call', async () => {
  const controller = new AbortController()
  controller.abort()
  const provider = { async generateStream() { throw new Error('must not call provider') } }
  await assert.rejects(new UltraOrchestrator(orchestratorOptions({ runtime: { provider }, signal: controller.signal })).execute('复杂问题'), /cancelled/i)
})

test('Ultra keeps full-access typed tools instead of silently downgrading to read-only', async () => {
  const calls = []
  const provider = {
    async generateStream(request) {
      const last = request.messages.at(-1)?.content || ''
      if (last.includes('任务分解器')) {
        return {
          text: JSON.stringify([
            { id: 'sync', description: '同步成绩资料', tools: ['sync_campus_data'], dependencies: [] },
          ]),
          usage: { inputTokens: 10, outputTokens: 10 },
        }
      }
      if (last.includes('结果汇总器')) return { text: '已完成同步并汇总。', usage: { inputTokens: 10, outputTokens: 10 } }
      if (last.includes('sync_campus_data')) {
        const toolCall = JSON.stringify({
          schema: 'theia-advisor-tool-call/v1',
          tool: 'sync_campus_data',
          args: { domains: ['grades'] },
        })
        if (!last.includes('theia-advisor-tool-observation')) return { text: toolCall, usage: { inputTokens: 10, outputTokens: 10 } }
      }
      return { text: '同步操作已返回结果。', usage: { inputTokens: 10, outputTokens: 10 } }
    },
  }
  const orchestrator = new UltraOrchestrator(orchestratorOptions({
    runtime: { provider },
    permissionMode: 'full-access',
    toolNames: ['sync_campus_data'],
    workspace: {
      tools: {
        sync_campus_data(args) {
          calls.push(args)
          return { schema: 'theia-advisor-tool-result/v1', name: 'sync_campus_data', snapshotRevision: 'rev-1', data: { synced: true } }
        },
      },
    },
  }))

  assert.equal(await orchestrator.execute('请同步成绩资料并告诉我结果'), '已完成同步并汇总。')
  assert.deepEqual(calls, [{ domains: ['grades'] }])
})
