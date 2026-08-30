import { randomUUID } from 'node:crypto'
import {
  createAdvisorFullAccessTools,
  ReadOnlyAgentError,
  runReadOnlyAdvisorAgent,
} from '../core/advisor/index.mjs'
import { modelServiceIdentity } from '../core/model-url-policy.mjs'
import { createAdvisorProvider } from './ai/provider-factory.mjs'
import {
  AdvisorProviderError,
  fallbackModelForAdvisor,
  modelForAdvisorIntent,
  normalizeProviderUsage,
  safeProviderError,
} from './ai/provider.mjs'
import { shouldUseUltraMode } from './ultra-mode/adapter.mjs'
import { answerFromModelText as buildAdvisorAnswer } from './advisor-answer-runtime.mjs'
import { prepareAdvisorRequest } from './advisor-preparation-runtime.mjs'
import { runAdvisorUltraMode } from './advisor-ultra-runtime.mjs'
import {
  ADVISOR_THREAD_SCHEMA,
  ADVISOR_THREAD_SUMMARY_TTL_MS,
  MAX_THREADS,
  MAX_THREAD_MESSAGES,
  MAX_THREAD_SUMMARIES,
  agentInputBytesBudget,
  boundedText,
  deepClone,
  hash,
  mergeObservedUsage,
  nowMilliseconds,
  providerMessageBytes,
  providerMessages,
  publicThread,
  record,
  summaryExpiry,
} from './advisor-runtime-helpers.mjs'

export { ADVISOR_THREAD_SCHEMA, ADVISOR_THREAD_SUMMARY_TTL_MS }
export const ADVISOR_PREPARED_SCHEMA = 'theia-advisor-prepared-request/v1'
export const ADVISOR_ANSWER_SCHEMA = 'theia-advisor-answer/v1'
export const ADVISOR_BUDGET_PRESETS = Object.freeze({
  high: {
    deadlineMs: 300_000,       // 5min
    maxModelCalls: 20,
    maxInputBytes: 200_000,
    maxInputTokens: 50_000,
    maxOutputBytes: 512_000,
    maxOutputTokens: 8_000,
    modelRequestTimeoutMs: 300_000,
    maxClaims: 32,
    maxRecommendations: 8,
    maxSteps: 15,
  },
  xhigh: {
    deadlineMs: 600_000,       // 10min
    maxModelCalls: 50,
    maxInputBytes: 400_000,
    maxInputTokens: 100_000,
    maxOutputBytes: 1_024_000,
    maxOutputTokens: 16_000,
    modelRequestTimeoutMs: 600_000,
    maxClaims: 64,
    maxRecommendations: 16,
    maxSteps: 30,
  },
  max: {
    deadlineMs: 1_800_000,     // 30min
    maxModelCalls: 100,
    maxInputBytes: 800_000,
    maxInputTokens: 200_000,
    maxOutputBytes: 2_048_000,
    maxOutputTokens: 32_000,
    modelRequestTimeoutMs: 1_800_000,
    maxClaims: 128,
    maxRecommendations: 32,
    maxSteps: 50,
  },
  ultra: {
    deadlineMs: 3_600_000,     // 60min
    maxModelCalls: 200,
    maxInputBytes: 1_600_000,
    maxInputTokens: 400_000,
    maxOutputBytes: 4_096_000,
    maxOutputTokens: 64_000,
    modelRequestTimeoutMs: 3_600_000,
    maxClaims: 256,
    maxRecommendations: 64,
    maxSteps: 100,
  },
})

// Legacy budget (deprecated, use ADVISOR_BUDGET_PRESETS.high)
export const ADVISOR_RUN_BUDGET = ADVISOR_BUDGET_PRESETS.high

const READ_ONLY_AGENT_MAX_STEPS_LEGACY = 15

export class AdvisorRuntimeError extends Error {
  constructor(code, message, { retryable = false, cause } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'AdvisorRuntimeError'
    this.code = code
    this.retryable = retryable
  }
}

export class AdvisorRuntime {
  #prepared
  #snapshotCache

  constructor({
    store,
    modelService,
    providerFactory,
    clock = () => new Date().toISOString(),
    onDiagnostic = () => {},
    onStream = () => {},
    ensureDataReady = async () => {},
    threadStore = null,
    initialThreads = [],
    budget = ADVISOR_RUN_BUDGET,
    agentOperations = {},
  }) {
    if (!store || typeof store.snapshotWithRevision !== 'function') throw new TypeError('AdvisorRuntime requires CampusStore')
    if (!modelService && !providerFactory) throw new TypeError('AdvisorRuntime requires a provider')
    this.store = store
    this.modelService = modelService
    this.providerFactory = providerFactory || ((settings) => createAdvisorProvider({ modelService, settings }))
    this.clock = clock
    this.onDiagnostic = onDiagnostic
    this.onStream = onStream
    if (typeof ensureDataReady !== 'function') throw new TypeError('AdvisorRuntime ensureDataReady must be a function')
    this.ensureDataReady = ensureDataReady
    this.threadStore = threadStore
    this.budget = { ...ADVISOR_RUN_BUDGET, ...budget }
    this.agentOperations = agentOperations && typeof agentOperations === 'object' ? agentOperations : {}
    this.threads = new Map((Array.isArray(initialThreads) ? initialThreads : [])
      .filter((thread) => thread && typeof thread.id === 'string' && Array.isArray(thread.messages))
      .slice(0, MAX_THREADS)
      .map((thread) => [thread.id, deepClone({ ...thread, activeRequestId: null })]))
    this.active = new Map()
    this.#prepared = new Map()
    this.#snapshotCache = null
    for (const thread of this.threads.values()) this.pruneExpiredSummaries(thread)
  }

  listThreads() {
    let pruned = false
    for (const thread of this.threads.values()) {
      const changed = this.pruneExpiredSummaries(thread)
      pruned = changed || pruned
    }
    if (pruned) void this.persistThreads()
    return [...this.threads.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(publicThread)
  }

  createThread() {
    if (this.threads.size >= MAX_THREADS) throw new AdvisorRuntimeError('thread-limit', `最多保留 ${MAX_THREADS} 个内存顾问线程。`)
    const now = this.clock()
    nowMilliseconds(now)
    const thread = {
      id: randomUUID(),
      title: '新顾问对话',
      createdAt: now,
      updatedAt: now,
      activeRequestId: null,
      messages: [],
    }
    this.threads.set(thread.id, thread)
    this.persistThreads()
    return publicThread(thread)
  }

  deleteThread(threadId) {
    const id = boundedText(threadId, 128)
    const thread = this.threads.get(id)
    if (!thread) return { deleted: false, threadId: id }
    if (thread.activeRequestId) this.cancel({ requestId: thread.activeRequestId })
    for (const [requestId, item] of this.#prepared) {
      if (item.threadId === id) this.#prepared.delete(requestId)
    }
    this.threads.delete(id)
    this.persistThreads()
    return { deleted: true, threadId: id }
  }

  async prepare(request) {
    this.cleanupPrepared()
    const result = await prepareAdvisorRequest({
      request,
      threads: this.threads,
      ensureDataReady: this.ensureDataReady,
      store: this.store,
      snapshotCache: this.#snapshotCache,
      modelService: this.modelService,
      agentOperations: this.agentOperations,
      clock: this.clock,
      diagnostic: this.diagnostic.bind(this),
      preparedSchema: ADVISOR_PREPARED_SCHEMA,
      RuntimeError: AdvisorRuntimeError,
    })
    this.#snapshotCache = result.snapshotCache
    for (const [existingId, existing] of this.#prepared) {
      if (existing.threadId === result.threadId) this.#prepared.delete(existingId)
    }
    this.#prepared.set(result.requestId, result.item)
    return result.response
  }

  async send(request) {
    this.cleanupPrepared()
    const input = record(request)
    let requestId = boundedText(input.requestId, 128)
    if (!requestId) {
      const threadId = boundedText(input.threadId, 128)
      const question = boundedText(input.question, 4_000)
      if (!threadId || !question) throw new AdvisorRuntimeError('question-required', '请输入要咨询的问题。')
      const preparedRequest = await this.prepare({ threadId, question })
      requestId = preparedRequest.requestId
    }
    const prepared = this.#prepared.get(requestId)
    if (!prepared) throw new AdvisorRuntimeError('prepared-request-expired', '本地 Agent 请求已过期，请重新发送问题。')
    const thread = this.threads.get(prepared.threadId)
    if (!thread) throw new AdvisorRuntimeError('thread-not-found', '顾问线程不存在或已删除。')
    if (thread.activeRequestId) throw new AdvisorRuntimeError('thread-busy', '该顾问线程正在生成回答。')
    if (this.active.size >= 2) throw new AdvisorRuntimeError('runtime-busy', '已有两个顾问请求正在运行，请稍后重试。', { retryable: true })
    if (this.store.snapshotWithRevision({ clone: false }).revision !== prepared.versionedSnapshot.revision) {
      this.#prepared.delete(requestId)
      throw new AdvisorRuntimeError('stale-disclosure', '校园数据已更新，请重新发送问题。', { retryable: true })
    }
    let configuredServiceIdentity = null
    try {
      configuredServiceIdentity = modelServiceIdentity(prepared.settings.modelBaseUrl)
    } catch {
      // The binding check below fails closed with one user-safe error.
    }
    const configuredModelId = modelForAdvisorIntent(prepared.settings)
    const configuredFallbackModelId = fallbackModelForAdvisor(prepared.settings, configuredModelId)
    if (configuredServiceIdentity !== prepared.serviceIdentity
      || configuredModelId !== prepared.modelId
      || configuredFallbackModelId !== prepared.fallbackModelId) {
      this.#prepared.delete(requestId)
      throw new AdvisorRuntimeError(
        'stale-disclosure',
        '模型配置已发生变化，请重新发送问题。',
        { retryable: true },
      )
    }
    const initialMessages = providerMessages(prepared.sessionContext)
    if (providerMessageBytes(initialMessages) > this.budget.maxInputBytes) {
      throw new AdvisorRuntimeError('context-too-large', '本次顾问上下文超过安全预算。')
    }
    this.#prepared.delete(requestId)
    const controller = new AbortController()
    const active = {
      requestId,
      threadId: thread.id,
      controller,
      startedAt: this.clock(),
      timedOut: false,
    }
    const deadline = setTimeout(() => {
      active.timedOut = true
      controller.abort(new Error('advisor deadline exceeded'))
    }, this.budget.deadlineMs)
    this.active.set(requestId, active)
    thread.activeRequestId = requestId
    thread.updatedAt = active.startedAt
    if (thread.title === '新顾问对话') thread.title = prepared.question.slice(0, 40)
    thread.messages.push({ id: randomUUID(), role: 'user', at: active.startedAt, text: prepared.question })
    this.trimThread(thread)

    // === Ultra 模式判断 ===
    const budgetLevel = prepared.settings.advisorConfig?.budgetLevel || 'high'
    if (shouldUseUltraMode({
      question: prepared.question,
      budgetLevel,
      threadMessages: thread.messages,
    })) {
      return runAdvisorUltraMode(this, {
        requestId,
        prepared,
        thread,
        controller,
        deadline,
        active,
      }, {
        budgetPresets: ADVISOR_BUDGET_PRESETS,
        maxThreadSummaries: MAX_THREAD_SUMMARIES,
        RuntimeError: AdvisorRuntimeError,
      })
    }

    // === 标准单线程模式 ===
    let modelCalls = 0
    let agentToolCalls = 0
    let usage = {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: null,
      cacheWriteInputTokens: null,
      cacheStatus: 'unknown',
      estimated: false,
      inputBytes: 0,
      outputBytes: 0,
    }
    let provider = null
    const observedUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: null,
      cacheWriteInputTokens: null,
      cacheStatus: 'unknown',
    }
    const assertRunActive = () => {
      if (controller.signal.aborted) {
        throw new AdvisorRuntimeError('cancelled', '顾问请求已取消。')
      }
    }
    try {
      provider = this.providerFactory(prepared.settings)
      const agentTools = createAdvisorFullAccessTools({
        tools: prepared.workspace.tools,
        snapshotRevision: prepared.versionedSnapshot.revision,
        operations: this.agentOperations,
        signal: controller.signal,
        permissionMode: prepared.permissionMode,
      })
      let rawText
      let usedModelId = prepared.modelId
      let visibleOutputStarted = false
      let toolSideEffectObserved = false
      const advisorConfig = prepared.settings.advisorConfig && typeof prepared.settings.advisorConfig === 'object'
        ? prepared.settings.advisorConfig
        : {}
      const mergeAgentUsage = (agent) => {
        modelCalls += agent.modelCalls
        agentToolCalls += agent.calls.length
        usage.inputBytes += agent.inputBytes
        usage.outputBytes += agent.outputBytes
        usage.inputTokens += agent.inputTokens
        usage.outputTokens += agent.outputTokens
        usage.cachedInputTokens = agent.cachedInputTokens === null
          ? usage.cachedInputTokens
          : (usage.cachedInputTokens || 0) + agent.cachedInputTokens
        usage.cacheWriteInputTokens = agent.cacheWriteInputTokens === null
          ? usage.cacheWriteInputTokens
          : (usage.cacheWriteInputTokens || 0) + agent.cacheWriteInputTokens
        if (agent.cacheStatus === 'hit'
          || (agent.cacheStatus === 'write' && usage.cacheStatus !== 'hit')
          || (agent.cacheStatus === 'miss' && usage.cacheStatus === 'unknown')) {
          usage.cacheStatus = agent.cacheStatus
        }
        usage.estimated ||= agent.tokenEstimate
      }
      const mergeAgentFailureUsage = (error) => {
        if (!(error instanceof ReadOnlyAgentError)) return
        modelCalls = Math.max(modelCalls, error.details?.modelCalls || 0)
        usage.inputBytes += error.details?.inputBytes || 0
        usage.outputBytes += error.details?.outputBytes || 0
        usage.inputTokens += error.details?.inputTokens || 0
        usage.outputTokens += error.details?.outputTokens || 0
        usage.inputTokens = Math.max(usage.inputTokens, observedUsage.inputTokens)
        usage.outputTokens = Math.max(usage.outputTokens, observedUsage.outputTokens)
        if (usage.cachedInputTokens === null) usage.cachedInputTokens = observedUsage.cachedInputTokens
        if (usage.cacheWriteInputTokens === null) usage.cacheWriteInputTokens = observedUsage.cacheWriteInputTokens
        if (usage.cacheStatus === 'unknown') usage.cacheStatus = observedUsage.cacheStatus
        usage.estimated ||= error.details?.tokenEstimate === true
      }
      const emitAgentEvent = (event) => {
        if (event?.type === 'completed') mergeObservedUsage(observedUsage, event.usage)
        if (event?.type === 'delta') {
          if (String(event.delta || '')) visibleOutputStarted = true
          this.emitStream({
            requestId,
            threadId: prepared.threadId,
            snapshotRevision: prepared.versionedSnapshot.revision,
            delta: event.delta,
          })
        } else if (event?.type === 'started') {
          this.emitStream({
            requestId,
            threadId: prepared.threadId,
            snapshotRevision: prepared.versionedSnapshot.revision,
            model: { type: 'start', modelId: event.modelId },
          })
        } else if (event?.type === 'completed') {
          this.emitStream({
            requestId,
            threadId: prepared.threadId,
            snapshotRevision: prepared.versionedSnapshot.revision,
            model: { type: 'completed', modelId: event.modelId, usage: event.usage },
          })
        } else if (event?.type === 'tool-start') {
          toolSideEffectObserved = true
          this.emitStream({
            requestId,
            threadId: prepared.threadId,
            snapshotRevision: prepared.versionedSnapshot.revision,
            tool: {
              type: 'start',
              name: event.tool,
              step: event.step,
              args: event.args,
            },
          })
        } else if (event?.type === 'tool-result') {
          this.emitStream({
            requestId,
            threadId: prepared.threadId,
            snapshotRevision: prepared.versionedSnapshot.revision,
            tool: {
              type: 'result',
              name: event.tool,
              step: event.step,
              summary: event.resultSummary,
            },
          })
        } else if (event?.type === 'tool-error') {
          this.emitStream({
            requestId,
            threadId: prepared.threadId,
            snapshotRevision: prepared.versionedSnapshot.revision,
            tool: {
              type: 'error',
              name: event.tool,
              error: event.error,
            },
          })
        }
      }
      const runAgent = async (modelId, attemptedModelCalls = 0) => {
        const agent = await runReadOnlyAdvisorAgent({
          provider,
          model: modelId,
          messages: initialMessages,
          tools: agentTools,
          signal: controller.signal,
          temperature: advisorConfig.temperature,
          reasoningEffort: advisorConfig.reasoningEffort,
          responseStyle: advisorConfig.responseStyle,
          responseLength: advisorConfig.responseLength,
          cacheProfile: prepared.cacheProfile,
          promptCacheKey: prepared.promptCacheKey,
          permissionMode: prepared.permissionMode,
          toolNames: prepared.toolNames,
          onEvent: emitAgentEvent,
          onProviderEvent: (event) => {
            // The stream gate may still be buffering a partial protocol turn
            // when the transport fails. Treat any provider delta as visible
            // work so failover cannot duplicate a partially emitted answer.
            if (event?.type === 'delta' && String(event.delta || '')) visibleOutputStarted = true
          },
          budget: {
            maxSteps: Math.max(0, Math.min(
              this.budget.maxSteps || READ_ONLY_AGENT_MAX_STEPS_LEGACY,
              this.budget.maxModelCalls - attemptedModelCalls - 1,
            )),
            maxInputBytes: agentInputBytesBudget(this.budget),
            maxInputTokens: this.budget.maxInputTokens,
            maxOutputBytes: this.budget.maxOutputBytes,
            maxOutputTokens: this.budget.maxOutputTokens,
            modelRequestTimeoutMs: this.budget.modelRequestTimeoutMs,
          },
        })
        mergeAgentUsage(agent)
        return agent
      }
      const asRuntimeAgentError = (error) => {
        if (error instanceof AdvisorProviderError || error instanceof AdvisorRuntimeError || controller.signal.aborted) return error
        if (!(error instanceof ReadOnlyAgentError)) {
          const providerError = safeProviderError(error)
          return new AdvisorRuntimeError(providerError.code, providerError.message, {
            retryable: providerError.retryable,
            cause: providerError,
          })
        }
        mergeAgentFailureUsage(error)
        this.diagnostic('advisor.agent_failed', {
          requestId,
          snapshotRevision: prepared.versionedSnapshot.revision,
          reason: error.code,
          detail: String(error.message || '').slice(0, 500),
          modelCalls,
          status: 'failed',
        })
        return new AdvisorRuntimeError(
          error.code,
          '模型本轮未能完成工具调用，请重试。',
          { retryable: true, cause: error },
        )
      }
      try {
        const agent = await runAgent(usedModelId)
        rawText = agent.text
      } catch (error) {
        const providerError = error instanceof ReadOnlyAgentError || error instanceof AdvisorRuntimeError
          ? null
          : safeProviderError(error)
        const canFailover = Boolean(
          providerError?.retryable
          && prepared.fallbackModelId
          && this.budget.maxModelCalls >= modelCalls + 2
          && !visibleOutputStarted
          && !toolSideEffectObserved,
        )
        if (!canFailover) throw asRuntimeAgentError(error)
        modelCalls += 1
        const primaryModelId = usedModelId
        usedModelId = prepared.fallbackModelId
        this.emitStream({
          requestId,
          threadId: prepared.threadId,
          snapshotRevision: prepared.versionedSnapshot.revision,
          model: { type: 'failover', modelId: usedModelId, fromModelId: primaryModelId },
        })
        this.diagnostic('advisor.provider_failover', {
          requestId,
          snapshotRevision: prepared.versionedSnapshot.revision,
          fromModelId: primaryModelId,
          toModelId: usedModelId,
          reason: providerError.code,
        })
        try {
          const agent = await runAgent(usedModelId, modelCalls)
          rawText = agent.text
        } catch (fallbackError) {
          throw asRuntimeAgentError(fallbackError)
        }
      }
      if (!rawText) {
        this.diagnostic('advisor.empty_output', {
          requestId,
          snapshotRevision: prepared.versionedSnapshot.revision,
          status: 'failed',
        })
        throw new AdvisorRuntimeError('model-output-empty', '模型未返回可展示的回答，未生成替代回答。请重试。', { retryable: true })
      }
      assertRunActive()
      const response = this.answerFromModelText({
        rawText,
        prepared,
        usage,
        modelId: usedModelId,
      })
      const completedAt = this.clock()
      thread.messages.push({ id: randomUUID(), role: 'assistant', at: completedAt, response })
      thread.summaries = [
        ...(Array.isArray(thread.summaries) ? thread.summaries : []),
        response.threadSummary,
      ].filter(Boolean).slice(-MAX_THREAD_SUMMARIES)
      thread.updatedAt = completedAt
      this.trimThread(thread)
      this.persistThreads()
      this.diagnostic('advisor.run_completed', {
        requestId,
        intent: prepared.intent,
        snapshotRevision: prepared.versionedSnapshot.revision,
        serviceIdentityHash: hash(prepared.serviceIdentity).slice(0, 16),
        modelId: usedModelId,
        permissionMode: prepared.permissionMode,
        scopes: prepared.disclosure.scopes,
        recordCounts: prepared.disclosure.recordCounts,
        modelCalls,
        agentToolCalls,
        inputBytes: usage.inputBytes,
        outputBytes: usage.outputBytes,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        cacheWriteInputTokens: usage.cacheWriteInputTokens,
        cacheStatus: usage.cacheStatus,
        durationMs: Date.now() - nowMilliseconds(active.startedAt),
        status: 'completed',
      })
      return deepClone(response)
    } catch (error) {
      const timedOut = active.timedOut
      const cancelled = !timedOut && (controller.signal.aborted || error?.code === 'cancelled')
      const safe = timedOut
        ? new AdvisorRuntimeError('timeout', '模型服务响应超时，请稍后重试。', { retryable: true })
        : cancelled
        ? new AdvisorRuntimeError('cancelled', '顾问请求已取消。')
        : error instanceof AdvisorRuntimeError
          ? error
          : (() => {
              const providerError = safeProviderError(error)
              return new AdvisorRuntimeError(providerError.code, providerError.message, {
                retryable: providerError.retryable,
                cause: providerError,
              })
            })()
      this.diagnostic('advisor.run_failed', {
        requestId,
        intent: prepared.intent,
        snapshotRevision: prepared.versionedSnapshot.revision,
        serviceIdentityHash: hash(prepared.serviceIdentity).slice(0, 16),
        modelId: prepared.modelId,
        permissionMode: prepared.permissionMode,
        modelCalls,
        inputBytes: usage.inputBytes,
        outputBytes: usage.outputBytes,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        cacheWriteInputTokens: usage.cacheWriteInputTokens,
        cacheStatus: usage.cacheStatus,
        status: safe.code,
      })
      throw safe
    } finally {
      clearTimeout(deadline)
      this.active.delete(requestId)
      if (thread.activeRequestId === requestId) thread.activeRequestId = null
    }
  }

  answerFromModelText({ rawText, prepared, usage, modelId = prepared.modelId }) {
    return buildAdvisorAnswer({
      rawText,
      prepared,
      usage,
      modelId,
      clock: this.clock,
      answerSchema: ADVISOR_ANSWER_SCHEMA,
      RuntimeError: AdvisorRuntimeError,
    })
  }

  cancel(request) {
    const input = typeof request === 'string' ? { requestId: request } : record(request)
    let requestId = boundedText(input.requestId, 128)
    if (!requestId && input.threadId) {
      requestId = this.threads.get(boundedText(input.threadId, 128))?.activeRequestId || ''
    }
    const active = this.active.get(requestId)
    if (!active) return { cancelled: false, requestId: requestId || null }
    active.controller.abort(new Error('cancelled by user'))
    return { cancelled: true, requestId }
  }

  cancelAll() {
    const count = this.active.size
    for (const active of this.active.values()) active.controller.abort(new Error('application shutdown'))
    this.#prepared.clear()
    return count
  }

  persistThreads() {
    if (!this.threadStore || typeof this.threadStore.persist !== 'function') return Promise.resolve(false)
    return this.threadStore.persist([...this.threads.values()])
      .then(() => true)
      .catch((error) => {
        this.diagnostic('advisor.store_persist_failed', { error: error instanceof Error ? error.message : String(error) })
        return false
      })
  }

  async flush() {
    await this.persistThreads()
    await this.threadStore?.flush?.()
  }

  emitStream(event) {
    try {
      const delta = String(event?.delta ?? '').normalize('NFC').slice(0, 8_192)
      const sourceTool = event?.tool && typeof event.tool === 'object' && !Array.isArray(event.tool)
        ? event.tool
        : null
      const toolType = ['start', 'result', 'error'].includes(sourceTool?.type) ? sourceTool.type : null
      const toolName = boundedText(sourceTool?.name, 128)
      const tool = toolType && toolName
        ? {
            type: toolType,
            name: toolName,
            ...(Number.isSafeInteger(sourceTool.step) ? { step: sourceTool.step } : {}),
            ...(sourceTool.args !== undefined ? { args: sourceTool.args } : {}),
            ...(sourceTool.summary !== undefined ? { summary: sourceTool.summary } : {}),
            ...(sourceTool.error ? { error: boundedText(sourceTool.error, 600) } : {}),
          }
        : null
      const sourceModel = event?.model && typeof event.model === 'object' && !Array.isArray(event.model)
        ? event.model
        : null
      const modelType = ['start', 'completed', 'failover'].includes(sourceModel?.type) ? sourceModel.type : null
      const modelId = boundedText(sourceModel?.modelId, 300)
      const model = modelType && modelId
        ? {
            type: modelType,
            modelId,
            ...(boundedText(sourceModel?.fromModelId, 300) ? { fromModelId: boundedText(sourceModel.fromModelId, 300) } : {}),
            ...(sourceModel?.usage ? { usage: normalizeProviderUsage(sourceModel.usage) } : {}),
          }
        : null
      // A tool or model state transition is a valid stream event even when it
      // has no text delta. Whitespace-only deltas remain valid because they
      // preserve token joins.
      if (!delta && !tool && !model) return
      this.onStream({
        schema: 'theia-advisor-stream-event/v1',
        requestId: boundedText(event.requestId, 128),
        threadId: boundedText(event.threadId, 128),
        snapshotRevision: boundedText(event.snapshotRevision, 128),
        ...(delta ? { delta } : {}),
        ...(tool ? { tool } : {}),
        ...(model ? { model } : {}),
      })
    } catch { /* Preview delivery cannot alter the saved model response. */ }
  }

  cleanupPrepared() {
    const now = nowMilliseconds(this.clock())
    for (const [requestId, item] of this.#prepared) {
      if (nowMilliseconds(item.expiresAt) <= now) this.#prepared.delete(requestId)
    }
  }

  trimThread(thread) {
    this.pruneExpiredSummaries(thread)
    if (thread.messages.length > MAX_THREAD_MESSAGES) {
      thread.messages.splice(0, thread.messages.length - MAX_THREAD_MESSAGES)
    }
    if (Array.isArray(thread.summaries) && thread.summaries.length > MAX_THREAD_SUMMARIES) {
      thread.summaries.splice(0, thread.summaries.length - MAX_THREAD_SUMMARIES)
    }
  }

  pruneExpiredSummaries(thread, now = this.clock()) {
    if (!Array.isArray(thread?.summaries)) return false
    let nowValue
    try {
      nowValue = nowMilliseconds(now)
    } catch {
      return false
    }
    const retained = thread.summaries.filter((summary) => {
      if (summary?.schema !== 'theia-advisor-thread-summary/v1') return false
      const expiresAt = summaryExpiry(summary)
      return expiresAt !== null && expiresAt > nowValue
    })
    const changed = retained.length !== thread.summaries.length
    if (changed) thread.summaries = retained.slice(-MAX_THREAD_SUMMARIES)
    return changed
  }

  diagnostic(event, fields) {
    try { this.onDiagnostic(event, fields) } catch { /* Diagnostics cannot change advisor behavior. */ }
  }
}
