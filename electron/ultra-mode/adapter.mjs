import { UltraOrchestrator } from './orchestrator.mjs'

/** Connects the bounded Ultra orchestrator to AdvisorRuntime. */
export class UltraAdapter {
  constructor({ runtime, prepared, tools, toolNames, permissionMode, temperature, reasoningEffort, fallbackModel, onStream }) {
    this.runtime = runtime
    this.prepared = {
      ...prepared,
      toolNames,
      permissionMode,
      temperature,
      reasoningEffort,
      fallbackModel,
    }
    this.tools = tools || null
    this.onStream = onStream
    this.orchestrator = null
    this.cachedStatistics = null
  }

  async execute({ threadId, requestId, question, budget, signal }) {
    const workspace = await this.createWorkspace()
    if (!this.runtime?.provider) throw new Error('Ultra provider is not initialized')
    this.orchestrator = new UltraOrchestrator({
      runtime: this.runtime,
      mainThreadId: threadId,
      requestId,
      budget,
      workspace,
      signal,
      model: this.prepared.model,
      fallbackModel: this.prepared.fallbackModel,
      promptCacheKey: this.prepared.promptCacheKey,
      cacheProfile: this.prepared.cacheProfile,
      toolNames: this.prepared.toolNames,
      permissionMode: this.prepared.permissionMode,
      temperature: this.prepared.temperature,
      reasoningEffort: this.prepared.reasoningEffort,
      onStream: (event) => this.forwardStream(event),
    })
    try {
      return await this.orchestrator.execute(question)
    } finally {
      this.captureStatistics()
      this.cleanup()
    }
  }

  async createWorkspace() {
    if (this.prepared.workspace && typeof this.prepared.workspace === 'object') {
      return Object.freeze({
        ...this.prepared.workspace,
        tools: this.tools || this.prepared.workspace.tools,
      })
    }
    const { createAdvisorLazyWorkspace } = await import('../../core/advisor/index.mjs')
    const { advisorOverviewFromVersionedSnapshot } = await import('../advisor-overview-service.mjs')
    const versionedSnapshot = this.prepared.versionedSnapshot
    const overview = advisorOverviewFromVersionedSnapshot(versionedSnapshot)
    return createAdvisorLazyWorkspace({
      overview,
      state: versionedSnapshot.state ?? versionedSnapshot.snapshot,
      snapshotRevision: versionedSnapshot.revision,
    })
  }

  forwardStream(event) {
    const transformed = this.transformStreamEvent(event)
    if (transformed) this.onStream?.(transformed)
  }

  transformStreamEvent(event) {
    const base = { threadId: event.threadId, requestId: event.requestId }
    switch (event.type) {
      case 'ultra_start': return { ...base, delta: '【Ultra 模式启动】正在分解任务...\n\n' }
      case 'tasks_decomposed': return { ...base, delta: `已分解为 ${event.tasks.length} 个子任务：\n${event.tasks.map((task, index) => `${index + 1}. ${task}`).join('\n')}\n\n` }
      case 'parallel_start': return { ...base, delta: `开始并行执行 ${event.count} 个子任务...\n\n` }
      case 'sequential_start': return { ...base, delta: `开始执行依赖任务（${event.count} 个）...\n\n` }
      case 'sub_agent_start': return { ...base, tool: { type: 'start', name: `sub_agent_${event.taskId}`, summary: { description: event.description } } }
      case 'sub_agent_complete': return { ...base, tool: { type: event.success ? 'result' : 'error', name: `sub_agent_${event.taskId}`, summary: event.success ? { status: 'complete' } : undefined, error: event.error } }
      case 'sub_agent_tool_start': return { ...base, tool: { type: 'start', name: `sub_agent_${event.taskId}:${event.tool}`, args: event.args, step: event.step } }
      case 'sub_agent_tool_result': return { ...base, tool: { type: 'result', name: `sub_agent_${event.taskId}:${event.tool}`, summary: event.summary, step: event.step } }
      case 'sub_agent_tool_error': return { ...base, tool: { type: 'error', name: `sub_agent_${event.taskId}:${event.tool}`, error: event.error } }
      case 'model_started': return { ...base, model: { type: 'start', phase: event.phase, taskId: event.taskId, modelId: event.modelId } }
      case 'model_completed': return { ...base, model: { type: 'completed', phase: event.phase, taskId: event.taskId, usage: event.usage } }
      case 'model_failover': return { ...base, model: { type: 'failover', phase: event.phase, taskId: event.taskId, modelId: event.modelId, fromModelId: event.fromModelId } }
      case 'delta': return { ...base, delta: event.delta }
      case 'synthesis_start': return { ...base, delta: '\n\n【汇总结果】\n\n' }
      case 'ultra_complete': return { ...base, delta: `\n\n---\n【Ultra 执行完成】\n- 子智能体数: ${event.subAgentCount}\n- Token 使用: ${event.tokenUsage.total}\n` }
      case 'ultra_error': return { ...base, delta: `\n\n【Ultra 执行失败】${event.error}\n` }
      default: return null
    }
  }

  captureStatistics() {
    if (!this.orchestrator) return
    this.cachedStatistics = structuredClone({
      modelId: this.orchestrator.lastModelId,
      tokenUsage: this.orchestrator.tokenUsage,
      subAgents: this.orchestrator.subAgents,
      results: Array.from(this.orchestrator.results.entries()).map(([taskId, result]) => ({
        taskId,
        success: !result.error,
        error: result.error,
        skipped: result.skipped === true,
        tokenUsed: result.tokenUsed || 0,
      })),
    })
  }

  cleanup() {
    this.orchestrator = null
  }

  getStatistics() {
    return this.cachedStatistics ? structuredClone(this.cachedStatistics) : null
  }
}

export function shouldUseUltraMode({ budgetLevel }) {
  // Ultra is an explicit user/configuration choice. The host never infers
  // task complexity from question text; the selected model handles planning.
  return budgetLevel === 'ultra'
}
