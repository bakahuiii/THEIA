import {
  executeAdvisorReadOnlyTool,
  ADVISOR_AGENT_TOOL_NAMES,
  ADVISOR_READ_ONLY_TOOL_NAMES,
  advisorToolNamesForPermission,
  normalizeAdvisorToolArgs,
} from './read-only-tools.mjs'
import { isAdvisorFullAccess, normalizeAdvisorPermissionMode } from './agent-permissions.mjs'
import {
  ADVISOR_RESPONSE_LENGTHS,
  ADVISOR_PROMPT_CACHE_KEY,
  ADVISOR_READ_ONLY_AGENT_BUDGET,
  text,
  byteLength,
  estimateTokens,
  resolveAdvisorOutputTokens,
  providerTokenUsage,
  mergeCacheStatus,
  boundedHistoryText,
  summarizeToolResult,
  parseAdvisorAgentTurn,
  agentSystemMessage,
  compactBaseMessages,
  continuationMessages,
  createAdvisorPromptCachePrefix,
  ReadOnlyAgentError,
  MAX_LEDGER_ENTRIES,
} from './read-only-agent-helpers.mjs'
import {
  compactLedgerEntry,
  observationMessage,
  repeatedToolCorrectionMessage,
  invalidToolCorrectionMessage,
  toolCallSignature,
  budgetDetails,
} from './read-only-agent-serialization.mjs'
import { createAgentStreamGate } from './read-only-agent-stream.mjs'

export { ADVISOR_TOOL_CALL_SCHEMA, ADVISOR_RESPONSE_LENGTHS, ADVISOR_PROMPT_CACHE_KEY, ADVISOR_PROMPT_CACHE_MIN_TOKENS, ADVISOR_READ_ONLY_AGENT_BUDGET, resolveAdvisorOutputTokens, ReadOnlyAgentError, parseAdvisorAgentTurn, ADVISOR_STATIC_SYSTEM_PROMPT, estimateAdvisorPromptTokens, normalizeAdvisorCacheProfile, createAdvisorPromptCachePrefix } from './read-only-agent-helpers.mjs'

export async function runReadOnlyAdvisorAgent({
  provider,
  model,
  messages,
  tools,
  signal,
  onEvent,
  onProviderEvent,
  temperature = 1,
  reasoningEffort = 'medium',
  responseStyle = 'balanced',
  responseLength = 'adaptive',
  cacheProfile = null,
  promptCacheKey = ADVISOR_PROMPT_CACHE_KEY,
  budget = ADVISOR_READ_ONLY_AGENT_BUDGET,
  permissionMode = 'read-only',
  toolNames,
} = {}) {
  const generate = typeof provider?.generateStream === 'function'
    ? provider.generateStream.bind(provider)
    : null
  if (!generate) {
    throw new ReadOnlyAgentError(
      'agent-streaming-unavailable',
      'The configured provider does not support streaming responses',
    )
  }
  if (!tools || typeof tools !== 'object') throw new TypeError('Read-only agent requires projected tools')
  const safePermissionMode = normalizeAdvisorPermissionMode(permissionMode)
  const modeToolNames = advisorToolNamesForPermission(safePermissionMode)
  const requestedToolNames = Array.isArray(toolNames) ? toolNames : modeToolNames
  const permittedToolNames = Object.freeze([...new Set(requestedToolNames.filter((name) => (
    typeof name === 'string'
    && ADVISOR_AGENT_TOOL_NAMES.includes(name)
    && modeToolNames.includes(name)
    && typeof tools[name] === 'function'
  )))])
  const limits = { ...ADVISOR_READ_ONLY_AGENT_BUDGET, ...budget }
  if (!Number.isFinite(Number(limits.maxInputTokens)) || Number(limits.maxInputTokens) <= 0) {
    limits.maxInputTokens = ADVISOR_READ_ONLY_AGENT_BUDGET.maxInputTokens
  }
  const safeTemperature = Number.isFinite(Number(temperature)) ? Math.max(0, Math.min(2, Number(temperature))) : 1
  const safeReasoningEffort = ['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(reasoningEffort) ? reasoningEffort : 'medium'
  const safeResponseStyle = ['direct', 'balanced', 'detailed'].includes(responseStyle) ? responseStyle : 'balanced'
  const safeResponseLength = ADVISOR_RESPONSE_LENGTHS.includes(responseLength) ? responseLength : 'adaptive'
  const promptCachePrefix = createAdvisorPromptCachePrefix(cacheProfile)
  const cachePrefixTokenEstimate = estimateTokens([{ role: 'system', content: promptCachePrefix }])
  const baseTranscript = [
    { role: 'system', content: promptCachePrefix },
    { role: 'system', content: agentSystemMessage(safeResponseStyle, safePermissionMode, permittedToolNames) },
    ...compactBaseMessages(messages),
  ]
  const continuationBase = continuationMessages(baseTranscript, promptCachePrefix, safeResponseStyle, safePermissionMode, permittedToolNames)
  let transcript = [...baseTranscript]
  const calls = []
  const toolCalls = new Map()
  let invalidToolAttempts = 0
  const repeatedToolCalls = new Map()
  const toolResultsBySignature = new Map()
  const evidenceLedger = []
  let submittedInputBytes = 0
  let outputBytes = 0
  let submittedInputTokens = 0
  let budgetInputTokens = 0
  let outputTokens = 0
  let cachedInputTokens = null
  let cacheWriteInputTokens = null
  let cacheStatus = 'unknown'
  let tokenEstimate = false
  for (let step = 0; step <= limits.maxSteps; step += 1) {
    if (signal?.aborted) throw new Error('Agent request was cancelled')
    const inputBytes = byteLength(transcript)
    const estimatedInputTokens = estimateTokens(transcript)
    const estimatedDynamicInputTokens = Math.max(0, estimatedInputTokens - cachePrefixTokenEstimate)
    if (submittedInputBytes + inputBytes > limits.maxInputBytes
      || budgetInputTokens + estimatedDynamicInputTokens > limits.maxInputTokens) {
      throw new ReadOnlyAgentError('agent-budget-exhausted', 'Agent input budget exhausted', {
        details: budgetDetails({
          modelCalls: step,
          inputBytes: submittedInputBytes,
          outputBytes,
          inputTokens: submittedInputTokens,
          outputTokens,
          tokenEstimate,
          budgetInputTokens,
        }),
      })
    }
    submittedInputBytes += inputBytes
    budgetInputTokens += estimatedDynamicInputTokens
    const streamGate = createAgentStreamGate(onEvent, permittedToolNames)
    const result = await generate({
      model,
      messages: transcript,
      promptCacheKey,
      temperature: safeTemperature,
      reasoningEffort: safeReasoningEffort,
      ...(Number.isSafeInteger(limits.modelRequestTimeoutMs) && limits.modelRequestTimeoutMs > 0
        ? { timeoutMs: limits.modelRequestTimeoutMs }
        : {}),
      maxTokens: resolveAdvisorOutputTokens({
        responseLength: safeResponseLength,
        responseStyle: safeResponseStyle,
        reasoningEffort: safeReasoningEffort,
        transcript,
        hardMaximum: limits.maxOutputTokens,
      }),
    }, {
      signal,
      onEvent: (event) => {
        if (event?.type === 'delta') {
          onProviderEvent?.(event)
          streamGate.push(event.delta)
        }
        else onEvent?.(event)
      },
    })
    const responseText = String(result?.text || '')
    streamGate.finish(responseText)
    const tokenUsage = providerTokenUsage(result, transcript, responseText)
    submittedInputTokens += tokenUsage.inputTokens
    const providerDynamicInputTokens = Math.max(0, tokenUsage.inputTokens - cachePrefixTokenEstimate)
    budgetInputTokens += Math.max(0, providerDynamicInputTokens - estimatedDynamicInputTokens)
    outputTokens += tokenUsage.outputTokens
    if (tokenUsage.cachedInputTokens !== null) cachedInputTokens = (cachedInputTokens || 0) + tokenUsage.cachedInputTokens
    if (tokenUsage.cacheWriteInputTokens !== null) cacheWriteInputTokens = (cacheWriteInputTokens || 0) + tokenUsage.cacheWriteInputTokens
    cacheStatus = mergeCacheStatus(cacheStatus, tokenUsage.cacheStatus)
    tokenEstimate ||= tokenUsage.estimated
    outputBytes += Buffer.byteLength(responseText, 'utf8')
    if (budgetInputTokens > limits.maxInputTokens) {
      throw new ReadOnlyAgentError('agent-budget-exhausted', 'Agent input token budget exhausted', {
        details: budgetDetails({
          modelCalls: step + 1,
          inputBytes: submittedInputBytes,
          outputBytes,
          inputTokens: submittedInputTokens,
          outputTokens,
          tokenEstimate,
          budgetInputTokens,
        }),
      })
    }
    if (outputBytes > limits.maxOutputBytes) {
      throw new ReadOnlyAgentError('agent-budget-exhausted', 'Agent output budget exhausted', {
        details: budgetDetails({
          modelCalls: step + 1,
          inputBytes: submittedInputBytes,
          outputBytes,
          inputTokens: submittedInputTokens,
          outputTokens,
          tokenEstimate,
          budgetInputTokens,
        }),
      })
    }
    if (!responseText) {
      throw new ReadOnlyAgentError('agent-output-empty', 'The model returned no text', {
        details: budgetDetails({
          modelCalls: step + 1,
          inputBytes: submittedInputBytes,
          outputBytes,
          inputTokens: submittedInputTokens,
          outputTokens,
          tokenEstimate,
          budgetInputTokens,
        }),
      })
    }
    const turn = parseAdvisorAgentTurn(responseText, { toolNames: permittedToolNames })
    if (turn.kind === 'final') {
      return Object.freeze({
        text: turn.text,
        calls: Object.freeze(calls.map((item) => Object.freeze({ ...item }))),
        modelCalls: step + 1,
        inputBytes: submittedInputBytes,
        outputBytes,
        inputTokens: submittedInputTokens,
        outputTokens,
        cachedInputTokens,
        cacheWriteInputTokens,
        cacheStatus,
        tokenEstimate,
        budgetInputTokens,
      })
    }
    if (turn.kind === 'invalid-tool') {
      invalidToolAttempts += 1
      if (invalidToolAttempts > 2 || step >= limits.maxSteps) {
        throw new ReadOnlyAgentError('agent-tool-invalid', '模型连续返回无效工具协议，未生成可展示的回答。', {
          details: budgetDetails({
            modelCalls: step + 1,
            inputBytes: submittedInputBytes,
            outputBytes,
            inputTokens: submittedInputTokens,
            outputTokens,
            tokenEstimate,
            budgetInputTokens,
          }),
        })
      }
      transcript = [
        ...transcript,
        invalidToolCorrectionMessage(turn.error),
      ]
      continue
    }
    const signature = toolCallSignature(turn.tool, turn.args)
    const repeatCount = repeatedToolCalls.get(signature) || 0
    const previousResult = toolResultsBySignature.get(signature)
    if (previousResult) {
      if (repeatCount >= 1) {
        throw new ReadOnlyAgentError('agent-tool-loop', '模型重复请求了相同的本地查询，未生成可展示的回答。', {
          details: budgetDetails({
            modelCalls: step + 1,
            inputBytes: submittedInputBytes,
            outputBytes,
            inputTokens: submittedInputTokens,
            outputTokens,
            tokenEstimate,
            budgetInputTokens,
          }),
        })
      }
      repeatedToolCalls.set(signature, repeatCount + 1)
      transcript = [
        ...transcript,
        repeatedToolCorrectionMessage(turn.tool),
      ]
      continue
    }
    const count = (toolCalls.get(turn.tool) || 0) + 1
    if (count > limits.maxCallsPerTool) {
      // A repeated protocol turn is an internal model mistake, not a user
      // answer. Give the model one bounded correction opportunity instead of
      // leaking its tool JSON into the conversation. If the hard step budget
      // is already exhausted, fail closed rather than persisting protocol
      // data as assistant prose.
      if (step >= limits.maxSteps) {
        throw new ReadOnlyAgentError('agent-tool-loop', '模型重复请求了同一个本地查询，未生成可展示的回答。', {
          details: budgetDetails({
            modelCalls: step + 1,
            inputBytes: submittedInputBytes,
            outputBytes,
            inputTokens: submittedInputTokens,
            outputTokens,
            tokenEstimate,
            budgetInputTokens,
          }),
        })
      }
      transcript = [
        ...transcript,
        repeatedToolCorrectionMessage(turn.tool),
      ]
      continue
    }
    if (step >= limits.maxSteps) {
      throw new ReadOnlyAgentError('agent-tool-budget-exhausted', '模型请求了超出本轮预算的本地查询，未生成可展示的回答。', {
        details: budgetDetails({
          modelCalls: step + 1,
          inputBytes: submittedInputBytes,
          outputBytes,
          inputTokens: submittedInputTokens,
          outputTokens,
          tokenEstimate,
          budgetInputTokens,
        }),
      })
    }
    toolCalls.set(turn.tool, count)
    invalidToolAttempts = 0

    // Emit tool-start event
    onEvent?.({
      type: 'tool-start',
      tool: turn.tool,
      args: turn.args,
      step: step + 1,
    })

    let toolResult
    try {
      toolResult = await executeAdvisorReadOnlyTool(tools, turn.tool, turn.args, { toolNames: permittedToolNames })
    } catch (error) {
      // Emit tool-error event
      onEvent?.({
        type: 'tool-error',
        tool: turn.tool,
        error: String(error?.message || error || 'Tool execution failed'),
      })
      throw new ReadOnlyAgentError('agent-tool-failed', '本地工具调用未能完成。', {
        cause: error,
        details: budgetDetails({
          modelCalls: step + 1,
          inputBytes: submittedInputBytes,
          outputBytes,
          inputTokens: submittedInputTokens,
          outputTokens,
          tokenEstimate,
          budgetInputTokens,
        }),
      })
    }

    // Emit tool-result event with summary
    onEvent?.({
      type: 'tool-result',
      tool: turn.tool,
      step: step + 1,
      resultSummary: summarizeToolResult(toolResult),
    })

    calls.push(Object.freeze({ name: turn.tool, args: structuredClone(turn.args), resultDigest: toolResult.snapshotRevision }))
    toolResultsBySignature.set(signature, toolResult)
    evidenceLedger.push(compactLedgerEntry(turn.tool, toolResult))
    while (evidenceLedger.length > MAX_LEDGER_ENTRIES) evidenceLedger.shift()
    transcript = [
      ...continuationBase,
      { role: 'assistant', content: boundedHistoryText(responseText) },
      observationMessage({
        tool: turn.tool,
        toolResult,
        priorEvidence: evidenceLedger.slice(0, -1),
      }),
    ]
  }
  throw new ReadOnlyAgentError('agent-budget-exhausted', 'Agent tool-step budget exhausted', {
    details: budgetDetails({
      modelCalls: limits.maxSteps + 1,
      inputBytes: submittedInputBytes,
      outputBytes,
      inputTokens: submittedInputTokens,
      outputTokens,
      tokenEstimate,
      budgetInputTokens,
    }),
  })
}
