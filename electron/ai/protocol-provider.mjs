import { safeProviderError } from './provider.mjs'

function byteLength(value) {
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8')
}

export class ProtocolProvider {
  constructor({ modelService, settings, protocol }) {
    if (!modelService || typeof modelService.requestProtocol !== 'function') {
      throw new TypeError('Protocol provider requires ModelService.requestProtocol')
    }
    this.modelService = modelService
    this.settings = structuredClone(settings || {})
    this.protocol = protocol
  }

  async generate(request, { signal, onEvent } = {}) {
    const startedAt = Date.now()
    onEvent?.({ type: 'started', modelId: request.model })
    try {
      const text = await this.modelService.requestProtocol({ ...this.settings, modelName: request.model }, this.protocol, request.messages, {
        temperature: request.temperature ?? 0.1,
        maxTokens: request.maxTokens,
        maxResponseBytes: 1_000_000,
        signal,
      })
      const result = { text, requestId: null, usage: null, inputBytes: byteLength(request.messages), outputBytes: byteLength(text), durationMs: Date.now() - startedAt }
      onEvent?.({ type: 'completed', ...result })
      return result
    } catch (error) {
      throw safeProviderError(error)
    }
  }

  async generateStream(request, { signal, onEvent } = {}) {
    const startedAt = Date.now()
    let text = ''
    onEvent?.({ type: 'started', modelId: request.model })
    try {
      const completed = await this.modelService.requestProtocolStream({ ...this.settings, modelName: request.model }, this.protocol, request.messages, {
        temperature: request.temperature ?? 0.1,
        maxTokens: request.maxTokens,
        maxResponseBytes: 1_000_000,
        signal,
        onDelta: (delta) => { text += delta; onEvent?.({ type: 'delta', delta }) },
      })
      const result = { text: completed, requestId: null, usage: null, inputBytes: byteLength(request.messages), outputBytes: byteLength(completed), durationMs: Date.now() - startedAt }
      onEvent?.({ type: 'completed', ...result })
      return result
    } catch (error) {
      throw safeProviderError(error)
    }
  }
}
