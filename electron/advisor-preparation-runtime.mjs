import { randomUUID } from 'node:crypto'
import {
  advisorPermissionCapabilities,
  advisorToolNamesForPermission,
  createAdvisorLazyWorkspace,
  normalizeAdvisorCacheProfile,
  normalizeAdvisorPermissionMode,
} from '../core/advisor/index.mjs'
import { canonicalJson } from '../core/advisor/canonical.mjs'
import { modelServiceIdentity } from '../core/model-url-policy.mjs'
import { advisorOverviewFromVersionedSnapshot } from './advisor-overview-service.mjs'
import {
  fallbackModelForAdvisor,
  modelForAdvisorIntent,
} from './ai/provider.mjs'
import {
  MAX_THREAD_SUMMARIES,
  advisorAcademicContext,
  advisorDataInventory,
  advisorPromptCacheKey,
  advisorTimeContext,
  boundedText,
  compactThreadHint,
  deepClone,
  hash,
  nowMilliseconds,
  normalizeAdvisorIntent,
  record,
  summaryExpiry,
} from './advisor-runtime-helpers.mjs'

const PREPARED_TTL_MS = 5 * 60 * 1000

export async function prepareAdvisorRequest({
  request,
  threads,
  ensureDataReady,
  store,
  snapshotCache,
  modelService,
  agentOperations,
  clock,
  diagnostic,
  preparedSchema,
  RuntimeError,
}) {
  const input = record(request)
  const thread = threads.get(boundedText(input.threadId, 128))
  if (!thread) throw new RuntimeError('thread-not-found', '顾问线程不存在或已删除。')
  if (thread.activeRequestId) throw new RuntimeError('thread-busy', '该顾问线程正在生成回答。')
  const question = boundedText(input.question, 4_000)
  if (!question) throw new RuntimeError('question-required', '请输入要咨询的问题。')
  const intent = normalizeAdvisorIntent(input.intent)
  // Wait for the provider barrier before taking the immutable revision used by
  // the agent. The agent must never mix a sync update into one turn.
  await ensureDataReady()
  const versionedSnapshot = store.snapshotWithRevision({ clone: false })
  const state = versionedSnapshot.state ?? versionedSnapshot.snapshot
  const cacheProfile = normalizeAdvisorCacheProfile(state.profile)
  const promptCacheKey = advisorPromptCacheKey(cacheProfile)
  const settings = deepClone(state.settings || {})
  const permissionMode = normalizeAdvisorPermissionMode(settings.advisorConfig?.permissionMode)
  const toolNames = advisorToolNamesForPermission(permissionMode)
  const modelId = modelForAdvisorIntent(settings)
  const fallbackModelId = fallbackModelForAdvisor(settings, modelId)
  if (!modelId) throw new RuntimeError('provider-not-configured', '请先在设置中配置顾问模型。')
  let serviceIdentity
  try {
    serviceIdentity = modelServiceIdentity(settings.modelBaseUrl)
  } catch {
    throw new RuntimeError('provider-not-configured', '模型服务地址无效，请重新配置。')
  }
  if (typeof modelService?.status === 'function') {
    const status = await modelService.status(settings)
    if (status?.apiKeySaved !== true) {
      throw new RuntimeError('provider-not-configured', '请先在设置中完成模型服务和 API Key 配置。')
    }
  }
  const preparedAt = clock()
  const requestId = randomUUID()
  const cacheHit = snapshotCache?.revision === versionedSnapshot.revision
  const nextSnapshotCache = cacheHit
    ? snapshotCache
    : {
        revision: versionedSnapshot.revision,
        overview: advisorOverviewFromVersionedSnapshot(versionedSnapshot, { clock: () => preparedAt }),
      }
  const overview = nextSnapshotCache.overview
  diagnostic('advisor.snapshot_context', {
    snapshotRevision: versionedSnapshot.revision,
    overviewCache: cacheHit ? 'hit' : 'miss',
  })
  let workspace
  try {
    workspace = createAdvisorLazyWorkspace({
      overview,
      state,
      snapshotRevision: versionedSnapshot.revision,
    })
  } catch (error) {
    throw new RuntimeError('workspace-unavailable', '本地校园数据工作区未能安全初始化。', { cause: error })
  }
  const inventory = workspace.inventory
  const recordCounts = Object.fromEntries(Object.entries(inventory).map(([domain, details]) => [
    domain,
    Math.max(0, Number(details.records || 0)) + Math.max(0, Number(details.localFacts || 0)),
  ]))
  const pruneExpiredSummaries = (value) => {
    if (!Array.isArray(value?.summaries)) return
    const preparedNow = nowMilliseconds(preparedAt)
    value.summaries = value.summaries.filter((summary) => {
      if (summary?.schema !== 'theia-advisor-thread-summary/v1') return false
      const expiresAt = summaryExpiry(summary)
      return expiresAt !== null && expiresAt > preparedNow
    }).slice(-MAX_THREAD_SUMMARIES)
  }
  pruneExpiredSummaries(thread)
  const threadHint = compactThreadHint(thread, versionedSnapshot, preparedAt)
  const timeContext = advisorTimeContext(preparedAt)
  const sessionContext = {
    schema: 'theia-advisor-agent-session/v1',
    question: boundedText(question, 1_200),
    intent,
    focusDomains: [],
    ...timeContext,
    dataInventory: advisorDataInventory(inventory),
    academicContext: advisorAcademicContext(state),
    snapshotRevision: versionedSnapshot.revision,
    permissionMode,
    availableTools: toolNames,
    ...(permissionMode === 'full-access' && typeof agentOperations?.outputDirectory === 'string'
      ? { agentOutputDirectory: agentOperations.outputDirectory }
      : {}),
    ...(threadHint ? { threadHint } : {}),
  }
  const contextDigest = hash(canonicalJson(sessionContext))
  const disclosure = {
    schema: 'theia-advisor-disclosure/v1',
    providerProfileId: 'default',
    serviceIdentity,
    modelId,
    intent,
    scopes: Object.keys(inventory).sort(),
    capabilities: advisorPermissionCapabilities(permissionMode),
    recordCounts,
    containsMailBody: false,
    containsProfileIdentity: false,
    containsFitness: false,
    containsAttachmentText: false,
    containsLocalPath: permissionMode === 'full-access',
    estimatedInputUnits: Math.ceil(Buffer.byteLength(canonicalJson(sessionContext), 'utf8') / 4),
    snapshotRevision: versionedSnapshot.revision,
    contextDigest,
  }
  const item = {
    requestId,
    threadId: thread.id,
    question,
    intent,
    preparedAt,
    expiresAt: new Date(nowMilliseconds(preparedAt) + PREPARED_TTL_MS).toISOString(),
    versionedSnapshot,
    settings,
    modelId,
    fallbackModelId,
    serviceIdentity,
    workspace,
    permissionMode,
    toolNames,
    sessionContext,
    cacheProfile,
    promptCacheKey,
    agent: true,
    disclosure,
  }
  return {
    requestId,
    threadId: thread.id,
    item,
    snapshotCache: nextSnapshotCache,
    response: deepClone({
      schema: preparedSchema,
      requestId,
      threadId: thread.id,
      expiresAt: item.expiresAt,
      disclosure: item.disclosure,
      agent: item.agent,
    }),
  }
}
