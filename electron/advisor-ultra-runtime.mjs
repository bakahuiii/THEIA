import { randomUUID } from 'node:crypto'
import { createAdvisorFullAccessTools } from '../core/advisor/index.mjs'
import { deepClone, nowMilliseconds } from './advisor-runtime-helpers.mjs'
import { safeProviderError } from './ai/provider.mjs'
import { UltraAdapter } from './ultra-mode/adapter.mjs'

/** Runs the multi-agent advisor path while the runtime owns request state. */
export async function runAdvisorUltraMode(runtime, {
  requestId,
  prepared,
  thread,
  controller,
  deadline,
  active,
}, { budgetPresets, maxThreadSummaries, RuntimeError }) {
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
  let adapter = null
  let stats = null
  try {
    const provider = runtime.providerFactory(prepared.settings)

    adapter = new UltraAdapter({
      runtime: {
        provider,
        baseUrl: prepared.settings.modelBaseUrl,
        modelName: prepared.modelId,
      },
      prepared: {
        cacheProfile: prepared.cacheProfile,
        promptCacheKey: prepared.promptCacheKey,
        versionedSnapshot: prepared.versionedSnapshot,
        workspace: prepared.workspace,
        model: prepared.modelId,
        fallbackModel: prepared.fallbackModelId,
        temperature: prepared.settings.advisorConfig?.temperature,
        reasoningEffort: prepared.settings.advisorConfig?.reasoningEffort,
      },
      tools: createAdvisorFullAccessTools({
        tools: prepared.workspace.tools,
        snapshotRevision: prepared.versionedSnapshot.revision,
        operations: runtime.agentOperations,
        signal: controller.signal,
        permissionMode: prepared.permissionMode,
      }),
      toolNames: prepared.toolNames,
      permissionMode: prepared.permissionMode,
      temperature: prepared.settings.advisorConfig?.temperature,
      reasoningEffort: prepared.settings.advisorConfig?.reasoningEffort,
      onStream: (event) => {
        runtime.emitStream({
          ...event,
          requestId,
          threadId: prepared.threadId,
          snapshotRevision: prepared.versionedSnapshot.revision,
        })
      },
    })

    const budget = budgetPresets[prepared.settings.advisorConfig?.budgetLevel || 'ultra']
    const rawText = await adapter.execute({
      threadId: prepared.threadId,
      requestId,
      question: prepared.question,
      budget,
      signal: controller.signal,
    })

    stats = adapter.getStatistics()
    const ultraUsage = stats?.tokenUsage || {}
    usage.inputTokens = Number.isFinite(Number(ultraUsage.inputTokens)) ? Number(ultraUsage.inputTokens) : 0
    usage.outputTokens = Number.isFinite(Number(ultraUsage.outputTokens)) ? Number(ultraUsage.outputTokens) : (ultraUsage.total || 0)
    usage.cachedInputTokens = ultraUsage.cachedInputTokens ?? null
    usage.cacheWriteInputTokens = ultraUsage.cacheWriteInputTokens ?? null
    usage.cacheStatus = ultraUsage.cacheStatus || 'unknown'
    usage.estimated = ultraUsage.estimated === true
    usage.inputBytes = stats?.inputBytes || 0
    usage.outputBytes = stats?.outputBytes || Buffer.byteLength(rawText, 'utf8')

    const response = runtime.answerFromModelText({
      rawText,
      prepared,
      usage,
      modelId: stats?.modelId || prepared.modelId,
    })
    const completedAt = runtime.clock()
    thread.messages.push({
      id: randomUUID(),
      role: 'assistant',
      at: completedAt,
      response: {
        ...response,
        metadata: { mode: 'ultra', statistics: stats },
      },
    })
    thread.summaries = [
      ...(Array.isArray(thread.summaries) ? thread.summaries : []),
      response.threadSummary,
    ].filter(Boolean).slice(-maxThreadSummaries)
    thread.updatedAt = completedAt
    runtime.trimThread(thread)
    runtime.persistThreads()

    runtime.diagnostic('advisor.ultra_completed', {
      requestId,
      intent: prepared.intent,
      snapshotRevision: prepared.versionedSnapshot.revision,
      subAgentCount: stats?.subAgents?.length || 0,
      tokenUsage: stats?.tokenUsage || {},
      durationMs: Date.now() - nowMilliseconds(active.startedAt),
      status: 'completed',
    })

    return deepClone(response)
  } catch (error) {
    stats = stats || adapter?.getStatistics?.()
    const failedUsage = stats?.tokenUsage || {}
    usage.inputTokens = failedUsage.inputTokens ?? usage.inputTokens
    usage.outputTokens = failedUsage.outputTokens ?? usage.outputTokens
    usage.cachedInputTokens = failedUsage.cachedInputTokens ?? usage.cachedInputTokens
    usage.cacheWriteInputTokens = failedUsage.cacheWriteInputTokens ?? usage.cacheWriteInputTokens
    usage.cacheStatus = failedUsage.cacheStatus || usage.cacheStatus
    usage.estimated ||= failedUsage.estimated === true
    const timedOut = active.timedOut
    const cancelled = !timedOut && (controller.signal.aborted || error?.code === 'cancelled')
    const safe = timedOut
      ? new RuntimeError('timeout', 'Ultra 模式超时，请稍后重试。', { retryable: true })
      : cancelled
      ? new RuntimeError('cancelled', 'Ultra 模式已取消。')
      : (() => {
          const providerError = safeProviderError(error)
          return new RuntimeError(
            providerError.code === 'provider-failed' ? 'ultra-failed' : providerError.code,
            providerError.code === 'provider-failed' ? 'Ultra 模式执行失败，请稍后重试。' : providerError.message,
            { retryable: true, cause: providerError },
          )
        })()

    runtime.diagnostic('advisor.ultra_failed', {
      requestId,
      intent: prepared.intent,
      snapshotRevision: prepared.versionedSnapshot.revision,
      status: safe.code,
      error: safe.message,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      cacheWriteInputTokens: usage.cacheWriteInputTokens,
      cacheStatus: usage.cacheStatus,
    })

    throw safe
  } finally {
    clearTimeout(deadline)
    runtime.active.delete(requestId)
    if (thread.activeRequestId === requestId) thread.activeRequestId = null
  }
}
