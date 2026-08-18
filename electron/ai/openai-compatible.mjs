import {
  assertProviderGenerateRequest,
  providerCapabilities,
  safeProviderError,
} from './provider.mjs'
import { MAX_MODEL_COMPLETION_RESPONSE_BYTES } from '../model-service.mjs'

function byteLength(value) {
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8')
}

export class OpenAICompatibleProvider {
  constructor({ modelService, settings }) {
    if (!modelService || typeof modelService.request !== 'function') {
      throw new TypeError('OpenAI-compatible provider requires ModelService')
    }
    this.modelService = modelService
    this.settings = structuredClone(settings || {})
  }

  async capabilities() {
    return providerCapabilities(this.settings)
  }

  async listModels() {
    return (await this.capabilities()).models.map((id) => ({ id }))
  }

  async generate(request, { signal, onEvent } = {}) {
    assertProviderGenerateRequest(request)
    const startedAt = Date.now()
    let usage = null
    let requestId = null
    onEvent?.({ type: 'started', modelId: request.model })
    try {
      const text = await this.modelService.request({
        ...this.settings,
        modelName: request.model,
      }, request.messages, {
        temperature: request.temperature ?? 0.1,
        reasoningEffort: request.reasoningEffort,
        promptCacheKey: request.promptCacheKey,
        maxTokens: request.maxTokens,
        maxResponseBytes: MAX_MODEL_COMPLETION_RESPONSE_BYTES,
        timeoutMs: request.timeoutMs,
        signal,
        onMetadata: (metadata) => {
          usage = metadata?.usage || usage
          requestId = metadata?.requestId || requestId
        },
      })
      const result = {
        text,
        requestId,
        usage,
        inputBytes: byteLength(request.messages),
        outputBytes: byteLength(text),
        durationMs: Date.now() - startedAt,
      }
      onEvent?.({ type: 'completed', ...result })
      return result
    } catch (error) {
      throw safeProviderError(error)
    }
  }

  async generateStream(request, { signal, onEvent } = {}) {
    assertProviderGenerateRequest(request)
    if (typeof this.modelService.requestStream !== 'function') throw new Error('The configured model transport does not support streaming')
    const startedAt = Date.now()
    let text = ''
    let usage = null
    let requestId = null
    onEvent?.({ type: 'started', modelId: request.model })
    try {
      const complete = await this.modelService.requestStream({ ...this.settings, modelName: request.model }, request.messages, {
        temperature: request.temperature ?? 0.1,
        reasoningEffort: request.reasoningEffort,
        promptCacheKey: request.promptCacheKey,
        maxTokens: request.maxTokens,
        maxResponseBytes: MAX_MODEL_COMPLETION_RESPONSE_BYTES,
        timeoutMs: request.timeoutMs,
        signal,
        onMetadata: (metadata) => {
          usage = metadata?.usage || usage
          requestId = metadata?.requestId || requestId
        },
        onDelta: (delta) => {
          text += delta
          onEvent?.({ type: 'delta', delta })
        },
      })
      const result = {
        text: complete,
        requestId,
        usage,
        inputBytes: byteLength(request.messages),
        outputBytes: byteLength(complete),
        durationMs: Date.now() - startedAt,
      }
      onEvent?.({ type: 'completed', ...result })
      return result
    } catch (error) {
      throw safeProviderError(error)
    }
  }
}
