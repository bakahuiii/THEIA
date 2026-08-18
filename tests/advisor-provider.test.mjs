import test from 'node:test'
import assert from 'node:assert/strict'
import { OpenAICompatibleProvider } from '../electron/ai/openai-compatible.mjs'
import { MAX_MODEL_COMPLETION_RESPONSE_BYTES } from '../electron/model-service.mjs'
import {
  assertProviderGenerateRequest,
  fallbackModelForAdvisor,
  modelForAdvisorIntent,
  providerCapabilities,
  safeProviderError,
} from '../electron/ai/provider.mjs'

test('advisor model selection is configuration-driven and fallback is transport-only', () => {
  const settings = {
    modelName: 'legacy',
    modelRouting: {
      advisorFastModel: 'fast',
      advisorDeepModel: 'deep',
      courseworkModel: 'coursework',
      fallbackModel: 'fallback',
    },
  }
  assert.equal(modelForAdvisorIntent(settings), 'legacy')
  assert.equal(modelForAdvisorIntent({ modelRouting: { advisorDeepModel: 'deep' } }), 'deep')
  assert.equal(fallbackModelForAdvisor(settings, 'legacy'), 'fallback')
  assert.equal(fallbackModelForAdvisor(settings, 'fallback'), null)
  assert.equal(modelForAdvisorIntent({ modelName: 'legacy' }), 'legacy')
})

test('provider capabilities do not infer unsupported protocol features from model names', () => {
  assert.deepEqual(providerCapabilities({ modelModels: ['z', 'a', 'a'] }), {
    schema: 'theia-advisor-provider-capabilities/v1',
    streaming: true,
    jsonSchema: false,
    usage: false,
    tools: false,
    models: ['a', 'z'],
  })
})

test('OpenAI-compatible adapter delegates to the hardened ModelService and reports byte usage', async () => {
  let observed = null
  const provider = new OpenAICompatibleProvider({
    settings: { modelBaseUrl: 'https://model.example/v1', modelName: 'legacy' },
    modelService: {
      async request(settings, messages, options) {
        observed = { settings, messages, options }
        return '{"schema":"theia-advisor-model-narrative/v1","blocks":[],"recommendations":[],"uncertainties":[],"questionsForUser":[],"suggestedActionIds":[]}'
      },
    },
  })
  const request = {
    model: 'advisor-model',
    messages: [{ role: 'user', content: 'hello' }],
    maxTokens: 2000,
    temperature: 0,
    promptCacheKey: 'theia-advisor-agent-v1-fixture',
    timeoutMs: 600_000,
  }
  const result = await provider.generate(request)
  assert.equal(observed.settings.modelName, 'advisor-model')
  assert.equal(observed.options.maxTokens, 2000)
  assert.equal(observed.options.promptCacheKey, 'theia-advisor-agent-v1-fixture')
  assert.equal(observed.options.maxResponseBytes, MAX_MODEL_COMPLETION_RESPONSE_BYTES)
  assert.equal(observed.options.timeoutMs, 600_000)
  assert.equal(result.usage, null)
  assert.ok(result.inputBytes > 0)
  assert.ok(result.outputBytes > 0)
})

test('OpenAI-compatible streaming provider preserves provider usage and cache hits', async () => {
  let observed = null
  const provider = new OpenAICompatibleProvider({
    settings: { modelBaseUrl: 'https://model.example/v1', modelName: 'legacy' },
    modelService: {
      async request() { return 'unused' },
      async requestStream(_settings, _messages, options) {
        observed = options
        options.onMetadata?.({
          requestId: 'resp_cache_1',
          usage: {
            input_tokens: 1_500,
            input_tokens_details: { cached_tokens: 1_024 },
            output_tokens: 12,
          },
        })
        options.onDelta?.('answer')
        return 'answer'
      },
    },
  })

  const result = await provider.generateStream({
    model: 'advisor-model',
    messages: [{ role: 'user', content: 'hello' }],
    maxTokens: 200,
    promptCacheKey: 'theia-advisor-agent-v1-fixture',
    timeoutMs: 1_800_000,
  })
  assert.equal(result.text, 'answer')
  assert.equal(observed.maxResponseBytes, MAX_MODEL_COMPLETION_RESPONSE_BYTES)
  assert.equal(observed.timeoutMs, 1_800_000)
  assert.equal(result.requestId, 'resp_cache_1')
  assert.deepEqual(result.usage, {
    input_tokens: 1_500,
    input_tokens_details: { cached_tokens: 1_024 },
    output_tokens: 12,
  })
})

test('provider request and errors fail closed with safe messages', () => {
  assert.throws(() => assertProviderGenerateRequest({
    model: 'm', messages: [{ role: 'tool', content: 'x' }], maxTokens: 10,
  }), /role is invalid/)
  assert.throws(() => assertProviderGenerateRequest({
    model: 'm', messages: [{ role: 'user', content: 'x' }], maxTokens: 10, promptCacheKey: 'contains whitespace',
  }), /promptCacheKey is invalid/)
  assert.equal(safeProviderError(new Error('Model service returned HTTP 429')).code, 'rate-limited')
  assert.equal(safeProviderError(new Error('secret provider body')).message, '模型服务未能完成本次顾问请求。')
})
