import { verifyModelNarrative } from '../core/advisor/index.mjs'
import {
  renderVerifiedNarrative,
  responseSummary,
} from './advisor-runtime-helpers.mjs'

export function answerFromModelText({
  rawText,
  prepared,
  usage,
  modelId = prepared.modelId,
  clock,
  answerSchema,
  RuntimeError,
}) {
  const completedAt = clock()
  const text = String(rawText)
  let displayText = text
  let narrative = null
  const catalog = prepared.workspace?.catalog?.()
  try {
    const parsed = JSON.parse(text.trim())
    if (parsed?.schema === 'theia-advisor-model-narrative/v1') {
      narrative = verifyModelNarrative(text, catalog, {
        truncation: { applied: false },
      })
      displayText = renderVerifiedNarrative(narrative) || text
    }
  } catch (error) {
    if (error?.name === 'AdvisorNarrativeError' || error?.code === 'citation_invalid' || error?.code === 'model_mismatch') {
      throw new RuntimeError('model-output-invalid', '模型回答没有绑定到当前本地证据，未保存本次回答。', {
        retryable: true,
        cause: error,
      })
    }
  }
  return {
    schema: answerSchema,
    requestId: prepared.requestId,
    threadId: prepared.threadId,
    intent: prepared.intent,
    snapshotRevision: prepared.versionedSnapshot.revision,
    rawText: text,
    displayText,
    ...(narrative ? {
      narrative: {
        schema: narrative.schema,
        catalogDigest: catalog.digest,
        blockCount: narrative.blocks.length,
        recommendationCount: narrative.recommendations.length,
      },
    } : {}),
    model: {
      serviceIdentity: prepared.serviceIdentity,
      modelId,
    },
    usage: {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      cacheWriteInputTokens: usage.cacheWriteInputTokens,
      cacheStatus: usage.cacheStatus,
      estimated: usage.estimated,
      inputBytes: usage.inputBytes,
      outputBytes: usage.outputBytes,
    },
    // Keep only revision/digest metadata for cross-revision navigation.
    threadSummary: responseSummary(rawText, prepared, completedAt),
  }
}
