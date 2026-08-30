import { fetch as undiciFetch } from 'undici'
import { isLiteralLoopbackModelService, modelServiceIdentity, normalizeModelServiceBaseUrl } from '../core/model-url-policy.mjs'
import { normalizeModelProvider } from '../core/model-provider-policy.mjs'
import { prepareModelEndpoint } from './model-network-policy.mjs'
import {
  MODEL_DISCOVERY_TIMEOUT_MS,
  DEFAULT_MODEL_REQUEST_TIMEOUT_MS,
  MAX_MODEL_REQUEST_TIMEOUT_MS,
  MAX_MODEL_REQUEST_BYTES,
  MAX_MODEL_LIST_RESPONSE_BYTES,
  MAX_MODEL_COMPLETION_RESPONSE_BYTES,
  normalizeModelRequestTimeout,
  modelRequestTimeoutLabel,
  completionResponseByteLimit,
  readBoundedResponseText,
  modelHttpError,
  readBoundedEventStream,
  readBoundedNdjson,
  preferredModel,
  responsesUrl,
  modelsUrl,
  responsesRequest,
  responsesText,
  responsesDelta,
  responseMetadata,
  listedModels,
  streamEventFailure,
  protocolUrl,
  protocolRequest,
  protocolText,
  protocolDelta,
  isPromptCacheUnsupportedResponse,
  isExplicitPromptCacheUnsupportedResponse,
  supportsExplicitPromptCaching,
} from './model-service-transport.mjs'
import { MODEL_COURSEWORK_METHODS } from './model-service-coursework.mjs'

export {
  DEFAULT_MODEL_REQUEST_TIMEOUT_MS,
  MAX_MODEL_REQUEST_TIMEOUT_MS,
  MAX_MODEL_REQUEST_BYTES,
  MAX_MODEL_LIST_RESPONSE_BYTES,
  MAX_MODEL_COMPLETION_RESPONSE_BYTES,
  readBoundedResponseText,
  readBoundedEventStream,
  readBoundedNdjson,
  preferredModel,
  protocolUrl,
  protocolRequest,
  protocolText,
  protocolDelta,
} from './model-service-transport.mjs'

export class ModelService {
  constructor({ vault, courseWork, fetchFn = undiciFetch, resolver, dispatcherFactory }) {
    this.vault = vault
    this.courseWork = courseWork
    this.fetchFn = fetchFn
    this.resolver = resolver
    this.dispatcherFactory = dispatcherFactory
    this.activeControllers = new Set()
    // Model names are not a reliable capability signal for OpenAI-compatible
    // services. Remember an explicit server rejection so later requests do
    // not pay for a predictable failed cache-enabled attempt.
    this.unsupportedPromptCacheModels = new Set()
    this.unsupportedExplicitPromptCacheModels = new Set()
  }

  promptCacheKeyFor(baseUrl, model, requestedKey) {
    if (!requestedKey) return undefined
    const identity = `${modelServiceIdentity(baseUrl)}\u0000${model}`
    return this.unsupportedPromptCacheModels.has(identity) ? undefined : requestedKey
  }

  disablePromptCache(baseUrl, model) {
    this.unsupportedPromptCacheModels.add(`${modelServiceIdentity(baseUrl)}\u0000${model}`)
  }

  explicitPromptCacheFor(baseUrl, model, requestedKey) {
    if (!requestedKey || !supportsExplicitPromptCaching(model)) return false
    return !this.unsupportedExplicitPromptCacheModels.has(`${modelServiceIdentity(baseUrl)}\u0000${model}`)
  }

  disableExplicitPromptCache(baseUrl, model) {
    this.unsupportedExplicitPromptCacheModels.add(`${modelServiceIdentity(baseUrl)}\u0000${model}`)
  }

  prepareEndpoint(url, signal) {
    return prepareModelEndpoint(url, {
      ...(this.resolver ? { resolver: this.resolver } : {}),
      ...(this.dispatcherFactory ? { dispatcherFactory: this.dispatcherFactory } : {}),
      signal,
    })
  }

  requestController(signal) {
    const controller = new AbortController()
    const cancel = () => controller.abort(signal?.reason)
    if (signal?.aborted) cancel()
    else signal?.addEventListener?.('abort', cancel, { once: true })
    this.activeControllers.add(controller)
    return {
      controller,
      release: () => {
        signal?.removeEventListener?.('abort', cancel)
        this.activeControllers.delete(controller)
      },
    }
  }

  cancelAll(reason = new Error('Model requests were cancelled')) {
    const cancelled = this.activeControllers.size
    for (const controller of this.activeControllers) controller.abort(reason)
    this.activeControllers.clear()
    return cancelled
  }

  async status(settings) {
    const vault = await this.vault.status()
    let baseUrl = ''
    let serviceIdentity = null
    try {
      baseUrl = normalizeModelServiceBaseUrl(settings?.modelBaseUrl)
      serviceIdentity = modelServiceIdentity(baseUrl)
    } catch { /* An invalid legacy URL is treated as unconfigured. */ }
    const model = String(settings?.modelName || '').trim()
    const provider = normalizeModelProvider(settings?.modelProvider)
    const keylessOllama = normalizeModelProvider(settings?.modelProvider) === 'ollama-chat'
      && isLiteralLoopbackModelService(baseUrl)
    const apiKeySaved = keylessOllama || Boolean(vault.saved && vault.bound && vault.serviceIdentity === serviceIdentity)
    return {
      configured: Boolean(baseUrl && model && apiKeySaved),
      baseUrl,
      provider,
      model,
      apiKeySaved,
      keylessOllama,
      encryptionAvailable: vault.encryptionAvailable,
      updatedAt: vault.updatedAt,
      error: vault.error,
      requiresApiKeyReentry: Boolean(vault.saved && !apiKeySaved),
      models: listedModels(settings?.modelModels),
      modelRouting: {
        advisorFastModel: String(settings?.modelRouting?.advisorFastModel || '').trim() || null,
        advisorDeepModel: String(settings?.modelRouting?.advisorDeepModel || '').trim() || null,
        courseworkModel: String(settings?.modelRouting?.courseworkModel || '').trim() || null,
        fallbackModel: String(settings?.modelRouting?.fallbackModel || '').trim() || null,
      },
      advisorConfig: settings?.advisorConfig && typeof settings.advisorConfig === 'object'
        ? structuredClone(settings.advisorConfig)
        : null,
    }
  }

  async request(settings, messages, {
    temperature = 0.2,
    maxTokens = 3_500,
    reasoningEffort,
    promptCacheKey,
    maxResponseBytes,
    timeoutMs,
    signal,
    onMetadata,
  } = {}) {
    if (normalizeModelProvider(settings?.modelProvider) !== 'openai-compatible') {
      return this.requestProtocol(settings, normalizeModelProvider(settings?.modelProvider), messages, {
        temperature, maxTokens, maxResponseBytes, timeoutMs, signal, onMetadata,
      })
    }
    const baseUrl = normalizeModelServiceBaseUrl(settings?.modelBaseUrl)
    const model = String(settings?.modelName || '').trim()
    if (!baseUrl || !model) throw new Error('Configure the model service URL and model name first')
    const apiKey = await this.vault.readApiKey(baseUrl)
    if (!apiKey) throw new Error('Save a model API key before processing a task')

    const { controller, release } = this.requestController(signal)
    const requestTimeout = normalizeModelRequestTimeout(timeoutMs)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, requestTimeout)
    try {
      const requestJson = async (targetUrl, requestBody, extractText) => {
        if (Buffer.byteLength(requestBody, 'utf8') > MAX_MODEL_REQUEST_BYTES) throw new Error(`Model request exceeds the ${MAX_MODEL_REQUEST_BYTES}-byte limit`)
        const endpoint = await this.prepareEndpoint(targetUrl, controller.signal)
        try {
          const response = await this.fetchFn(targetUrl, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
            body: requestBody,
            redirect: 'error',
            signal: controller.signal,
            dispatcher: endpoint.dispatcher,
          })
          const body = await readBoundedResponseText(
            response,
            completionResponseByteLimit(maxResponseBytes),
            'Model completion response',
          )
          return { response, body, extractText }
        } finally {
          await endpoint.close({ force: controller.signal.aborted }).catch(() => {})
        }
      }

      const targetUrl = responsesUrl(baseUrl)
      const effectivePromptCacheKey = this.promptCacheKeyFor(baseUrl, model, promptCacheKey)
      const explicitPromptCache = this.explicitPromptCacheFor(baseUrl, model, effectivePromptCacheKey)
      let result = await requestJson(
        targetUrl,
        JSON.stringify(responsesRequest(model, messages, maxTokens, false, reasoningEffort, effectivePromptCacheKey, explicitPromptCache)),
        responsesText,
      )
      if (!result.response.ok && effectivePromptCacheKey
        && isPromptCacheUnsupportedResponse(result.response.status, result.body)
        && !controller.signal.aborted) {
        if (explicitPromptCache && isExplicitPromptCacheUnsupportedResponse(result.body)) {
          this.disableExplicitPromptCache(baseUrl, model)
          result = await requestJson(
            targetUrl,
            JSON.stringify(responsesRequest(model, messages, maxTokens, false, reasoningEffort, effectivePromptCacheKey, false)),
            responsesText,
          )
        }
        if (!result.response.ok) {
          this.disablePromptCache(baseUrl, model)
          result = await requestJson(
            targetUrl,
            JSON.stringify(responsesRequest(model, messages, maxTokens, false, reasoningEffort, undefined, false)),
            responsesText,
          )
        }
      }
      if (!result.response.ok) throw modelHttpError(result.response.status, result.body)
      let payload
      try { payload = JSON.parse(result.body) } catch { throw new Error('Model service returned invalid JSON') }
      const metadata = responseMetadata(payload)
      if (metadata) onMetadata?.(metadata)
      const failure = streamEventFailure(payload)
      if (failure) throw failure
      const content = result.extractText(payload)
      if (!content) throw new Error('Model service returned no answer content')
      return content
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') {
        if (timedOut) throw new Error(`Model request timed out after ${modelRequestTimeoutLabel(requestTimeout)}`)
        throw new Error('Model request was cancelled')
      }
      throw error
    } finally {
      clearTimeout(timer)
      release()
    }
  }

  async requestStream(settings, messages, {
    temperature = 0.2,
    maxTokens = 3_500,
    reasoningEffort,
    promptCacheKey,
    maxResponseBytes,
    timeoutMs,
    signal,
    onDelta,
    onMetadata,
  } = {}) {
    if (normalizeModelProvider(settings?.modelProvider) !== 'openai-compatible') {
      return this.requestProtocolStream(settings, normalizeModelProvider(settings?.modelProvider), messages, {
        temperature, maxTokens, maxResponseBytes, timeoutMs, signal, onDelta, onMetadata,
      })
    }
    const baseUrl = normalizeModelServiceBaseUrl(settings?.modelBaseUrl)
    const model = String(settings?.modelName || '').trim()
    if (!baseUrl || !model) throw new Error('Configure the model service URL and model name first')
    const apiKey = await this.vault.readApiKey(baseUrl)
    if (!apiKey) throw new Error('Save a model API key before processing a task')
    const { controller, release } = this.requestController(signal)
    const requestTimeout = normalizeModelRequestTimeout(timeoutMs)
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, requestTimeout)
    try {
      const requestSse = async (targetUrl, requestBody, extractDelta) => {
        if (Buffer.byteLength(requestBody, 'utf8') > MAX_MODEL_REQUEST_BYTES) throw new Error(`Model request exceeds the ${MAX_MODEL_REQUEST_BYTES}-byte limit`)
        const endpoint = await this.prepareEndpoint(targetUrl, controller.signal)
        try {
          const response = await this.fetchFn(targetUrl, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
            body: requestBody,
            redirect: 'error', signal: controller.signal, dispatcher: endpoint.dispatcher,
          })
          if (!response.ok) {
            const body = await readBoundedResponseText(response, completionResponseByteLimit(maxResponseBytes), 'Model stream error response')
            return { response, body }
          }
          return {
            response,
            content: await readBoundedEventStream(
              response,
              completionResponseByteLimit(maxResponseBytes),
              { extractDelta, onDelta, onMetadata },
            ),
          }
        } finally {
          await endpoint.close({ force: controller.signal.aborted }).catch(() => {})
        }
      }

      const targetUrl = responsesUrl(baseUrl)
      const effectivePromptCacheKey = this.promptCacheKeyFor(baseUrl, model, promptCacheKey)
      const explicitPromptCache = this.explicitPromptCacheFor(baseUrl, model, effectivePromptCacheKey)
      let result = await requestSse(
        targetUrl,
        JSON.stringify(responsesRequest(model, messages, maxTokens, true, reasoningEffort, effectivePromptCacheKey, explicitPromptCache)),
        responsesDelta,
      )
      if (!result.response.ok && effectivePromptCacheKey
        && isPromptCacheUnsupportedResponse(result.response.status, result.body)
        && !controller.signal.aborted) {
        if (explicitPromptCache && isExplicitPromptCacheUnsupportedResponse(result.body)) {
          this.disableExplicitPromptCache(baseUrl, model)
          result = await requestSse(
            targetUrl,
            JSON.stringify(responsesRequest(model, messages, maxTokens, true, reasoningEffort, effectivePromptCacheKey, false)),
            responsesDelta,
          )
        }
        if (!result.response.ok) {
          this.disablePromptCache(baseUrl, model)
          result = await requestSse(
            targetUrl,
            JSON.stringify(responsesRequest(model, messages, maxTokens, true, reasoningEffort, undefined, false)),
            responsesDelta,
          )
        }
      }
      if (!result.response.ok) throw modelHttpError(result.response.status, result.body)
      return result.content
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') {
        if (timedOut) throw new Error(`Model request timed out after ${modelRequestTimeoutLabel(requestTimeout)}`)
        throw new Error('Model request was cancelled')
      }
      throw error
    } finally {
      clearTimeout(timer)
      release()
    }
  }

  async requestProtocol(settings, protocol, messages, {
    temperature = 0.2,
    maxTokens = 3_500,
    maxResponseBytes,
    timeoutMs,
    signal,
    onMetadata,
  } = {}) {
    const provider = normalizeModelProvider(protocol)
    if (provider === 'openai-compatible') return this.request({ ...settings, modelProvider: provider }, messages, { temperature, maxTokens, maxResponseBytes, timeoutMs, signal, onMetadata })
    const baseUrl = normalizeModelServiceBaseUrl(settings?.modelBaseUrl)
    const model = String(settings?.modelName || '').trim()
    if (!baseUrl || !model) throw new Error('Configure the model service URL and model name first')
    const apiKey = await this.protocolApiKey(provider, baseUrl)
    const spec = protocolRequest(provider, apiKey, model, messages, temperature, maxTokens, false)
    const requestBody = JSON.stringify(spec.body)
    if (Buffer.byteLength(requestBody, 'utf8') > MAX_MODEL_REQUEST_BYTES) throw new Error(`Model request exceeds the ${MAX_MODEL_REQUEST_BYTES}-byte limit`)
    const { controller, release } = this.requestController(signal)
    const requestTimeout = normalizeModelRequestTimeout(timeoutMs)
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, requestTimeout)
    try {
      const targetUrl = protocolUrl(provider, baseUrl, model)
      const endpoint = await this.prepareEndpoint(targetUrl, controller.signal)
      try {
        const response = await this.fetchFn(targetUrl, {
          method: 'POST',
          headers: { ...spec.headers, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: requestBody, redirect: 'error', signal: controller.signal, dispatcher: endpoint.dispatcher,
        })
        const body = await readBoundedResponseText(response, completionResponseByteLimit(maxResponseBytes), 'Model completion response')
        if (!response.ok) throw new Error(`Model service returned HTTP ${response.status}`)
        let payload
        try { payload = JSON.parse(body) } catch { throw new Error('Model service returned invalid JSON') }
        const metadata = responseMetadata(payload)
        if (metadata) onMetadata?.(metadata)
        const content = protocolText(provider, payload)
        if (!content) throw new Error('Model service returned no answer content')
        return content
      } finally {
        await endpoint.close({ force: controller.signal.aborted }).catch(() => {})
      }
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') {
        if (timedOut) throw new Error(`Model request timed out after ${modelRequestTimeoutLabel(requestTimeout)}`)
        throw new Error('Model request was cancelled')
      }
      throw error
    } finally {
      clearTimeout(timer)
      release()
    }
  }

  async requestProtocolStream(settings, protocol, messages, {
    temperature = 0.2,
    maxTokens = 3_500,
    maxResponseBytes,
    timeoutMs,
    signal,
    onDelta,
    onMetadata,
  } = {}) {
    const provider = normalizeModelProvider(protocol)
    if (provider === 'openai-compatible') return this.requestStream({ ...settings, modelProvider: provider }, messages, { temperature, maxTokens, maxResponseBytes, timeoutMs, signal, onDelta, onMetadata })
    const baseUrl = normalizeModelServiceBaseUrl(settings?.modelBaseUrl)
    const model = String(settings?.modelName || '').trim()
    if (!baseUrl || !model) throw new Error('Configure the model service URL and model name first')
    const apiKey = await this.protocolApiKey(provider, baseUrl)
    const spec = protocolRequest(provider, apiKey, model, messages, temperature, maxTokens, true)
    const requestBody = JSON.stringify(spec.body)
    if (Buffer.byteLength(requestBody, 'utf8') > MAX_MODEL_REQUEST_BYTES) throw new Error(`Model request exceeds the ${MAX_MODEL_REQUEST_BYTES}-byte limit`)
    const { controller, release } = this.requestController(signal)
    const requestTimeout = normalizeModelRequestTimeout(timeoutMs)
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, requestTimeout)
    try {
      const targetUrl = protocolUrl(provider, baseUrl, model, true)
      const endpoint = await this.prepareEndpoint(targetUrl, controller.signal)
      try {
        const response = await this.fetchFn(targetUrl, {
          method: 'POST',
          headers: { ...spec.headers, 'Content-Type': 'application/json', Accept: provider === 'ollama-chat' ? 'application/x-ndjson' : 'text/event-stream' },
          body: requestBody, redirect: 'error', signal: controller.signal, dispatcher: endpoint.dispatcher,
        })
        if (!response.ok) {
          await readBoundedResponseText(response, completionResponseByteLimit(maxResponseBytes), 'Model stream error response')
          throw new Error(`Model service returned HTTP ${response.status}`)
        }
        const options = { extractDelta: (payload) => protocolDelta(provider, payload), onDelta, onMetadata }
        // Await the body reader before leaving this scope. Returning the
        // promise directly would run the finally block first and close the
        // pinned dispatcher while an SSE/NDJSON stream is still consuming it.
        return provider === 'ollama-chat'
          ? await readBoundedNdjson(response, completionResponseByteLimit(maxResponseBytes), options)
          : await readBoundedEventStream(response, completionResponseByteLimit(maxResponseBytes), options)
      } finally {
        await endpoint.close({ force: controller.signal.aborted }).catch(() => {})
      }
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') {
        if (timedOut) throw new Error(`Model request timed out after ${modelRequestTimeoutLabel(requestTimeout)}`)
        throw new Error('Model request was cancelled')
      }
      throw error
    } finally {
      clearTimeout(timer)
      release()
    }
  }

  async protocolApiKey(provider, baseUrl) {
    const apiKey = await this.vault.readApiKey(baseUrl)
    if (apiKey) return apiKey
    if (provider === 'ollama-chat' && isLiteralLoopbackModelService(baseUrl)) return ''
    throw new Error('Save a model API key before processing a task')
  }

  async validate(settings) {
    const content = await this.request(settings, [
      { role: 'system', content: 'Reply with exactly THEIA_OK.' },
      { role: 'user', content: 'Check the configured connection.' },
    ], { temperature: 0, maxTokens: 16 })
    if (!content.includes('THEIA_OK')) throw new Error('The model service responded, but did not complete the connection check')
    return { ok: true }
  }

  async discover({ baseUrl, apiKey, signal } = {}) {
    const normalizedBaseUrl = normalizeModelServiceBaseUrl(baseUrl)
    const key = String(apiKey || '').trim() || await this.vault.readApiKey(normalizedBaseUrl)
    if (!key) throw new Error('Enter or save a model API key before detecting models')
    const active = this.requestController(signal)
    const { controller } = active
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, MODEL_DISCOVERY_TIMEOUT_MS)
    try {
      const targetUrl = modelsUrl(normalizedBaseUrl)
      const endpoint = await this.prepareEndpoint(targetUrl, controller.signal)
      try {
        const response = await this.fetchFn(targetUrl, {
          headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
          redirect: 'error',
          signal: controller.signal,
          dispatcher: endpoint.dispatcher,
        })
        const body = await readBoundedResponseText(response, MAX_MODEL_LIST_RESPONSE_BYTES, 'Model list response')
        if (!response.ok) throw new Error(`Model list request returned HTTP ${response.status}`)
        let payload
        try { payload = JSON.parse(body) } catch { throw new Error('Model list endpoint returned invalid JSON') }
        const records = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : []
        const models = listedModels(records.map((item) => typeof item === 'string' ? item : item?.id ?? item?.name))
        if (!models.length) throw new Error('The model list endpoint returned no selectable models')
        return { models, selectedModel: preferredModel(models) || null }
      } finally {
        await endpoint.close({ force: controller.signal.aborted }).catch(() => {})
      }
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') {
        if (timedOut) throw new Error('Model detection timed out after 15 seconds')
        throw new Error('Model detection was cancelled')
      }
      throw error
    } finally {
      clearTimeout(timer)
      active.release()
    }
  }

}

Object.assign(ModelService.prototype, MODEL_COURSEWORK_METHODS)
