import test from 'node:test'
import assert from 'node:assert/strict'
import { OpenAICompatibleProvider } from '../electron/ai/openai-compatible.mjs'
import {
  assertProviderGenerateRequest,
  modelForAdvisorIntent,
  providerCapabilities,
  safeProviderError,
} from '../electron/ai/provider.mjs'

test('advisor model routing uses explicit roles and preserves the legacy model as fallback', () => {
  const settings = {
    modelName: 'legacy',
    modelRouting: {
      advisorFastModel: 'fast',
      advisorDeepModel: 'deep',
      courseworkModel: 'coursework',
      fallbackModel: 'fallback',
    },
  }
  assert.equal(modelForAdvisorIntent(settings, 'daily'), 'fast')
  assert.equal(modelForAdvisorIntent(settings, 'notice'), 'fast')
  assert.equal(modelForAdvisorIntent(settings, 'risk'), 'deep')
  assert.equal(modelForAdvisorIntent(settings, 'mail'), 'deep')
  assert.equal(modelForAdvisorIntent(settings, 'assignment'), 'coursework')
  assert.equal(modelForAdvisorIntent({ modelName: 'legacy' }, 'general'), 'legacy')
})

test('provider capabilities do not infer unsupported protocol features from model names', () => {
  assert.deepEqual(providerCapabilities({ modelModels: ['z', 'a', 'a'] }), {
    schema: 'theia-advisor-provider-capabilities/v1',
    streaming: false,
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
  }
  const result = await provider.generate(request)
  assert.equal(observed.settings.modelName, 'advisor-model')
  assert.equal(observed.options.maxTokens, 2000)
  assert.equal(observed.options.maxResponseBytes, 1_000_000)
  assert.equal(result.usage, null)
  assert.ok(result.inputBytes > 0)
  assert.ok(result.outputBytes > 0)
})

test('provider request and errors fail closed with safe messages', () => {
  assert.throws(() => assertProviderGenerateRequest({
    model: 'm', messages: [{ role: 'tool', content: 'x' }], maxTokens: 10,
  }), /role is invalid/)
  assert.equal(safeProviderError(new Error('Model service returned HTTP 429')).code, 'rate-limited')
  assert.equal(safeProviderError(new Error('secret provider body')).message, '模型服务未能完成本次顾问请求。')
})
