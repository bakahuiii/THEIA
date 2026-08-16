import { createHash, randomUUID } from 'node:crypto'
import {
  createAdvisorLazyWorkspace,
  normalizeAdvisorCacheProfile,
  ReadOnlyAgentError,
  runReadOnlyAdvisorAgent,
} from '../core/advisor/index.mjs'
import { canonicalJson } from '../core/advisor/canonical.mjs'
import { modelServiceIdentity } from '../core/model-url-policy.mjs'
import { advisorOverviewFromVersionedSnapshot } from './advisor-overview-service.mjs'
import { createAdvisorProvider } from './ai/provider-factory.mjs'
import {
  AdvisorProviderError,
  modelForAdvisorIntent,
  safeProviderError,
} from './ai/provider.mjs'

export const ADVISOR_THREAD_SCHEMA = 'theia-advisor-thread/v1'
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
    maxClaims: 256,
    maxRecommendations: 64,
    maxSteps: 100,
  },
})

// Legacy budget (deprecated, use ADVISOR_BUDGET_PRESETS.high)
export const ADVISOR_RUN_BUDGET = ADVISOR_BUDGET_PRESETS.high

const PREPARED_TTL_MS = 5 * 60 * 1000
const MAX_THREADS = 20
const MAX_THREAD_MESSAGES = 40
const MAX_THREAD_SUMMARIES = 6
const READ_ONLY_AGENT_MAX_STEPS_LEGACY = 15
const MAX_THREAD_HINT_ENTRIES = 2
const MAX_THREAD_HINT_BYTES = 1_200
const AGENT_INPUT_BYTES_DEFAULT = 200_000
export const ADVISOR_THREAD_SUMMARY_TTL_MS = 30 * 24 * 60 * 60 * 1000

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function boundedText(value, maximum) {
  return String(value ?? '').normalize('NFC').trim().slice(0, maximum)
}

function hash(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex')
}

function advisorPromptCacheKey(cacheProfile) {
  // A stable one-way account digest isolates cache buckets without placing a
  // raw account identifier in an HTTP request field.
  const accountIdentity = cacheProfile?.studentId || canonicalJson(cacheProfile || { account: 'unbound' })
  return `theia-advisor-agent-v1-${hash(accountIdentity).slice(0, 24)}`
}

function deepClone(value) {
  return structuredClone(value)
}

function nowMilliseconds(value) {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new TypeError('Advisor clock returned an invalid instant')
  return parsed
}

function agentInputBytesBudget(budget) {
  const configured = Number(budget?.agentMaxInputBytes)
  const ceiling = Number.isSafeInteger(configured) && configured > 0 ? configured : AGENT_INPUT_BYTES_DEFAULT
  return Math.min(Number(budget?.maxInputBytes) || ceiling, ceiling)
}

function responseSummary(rawText, prepared, at) {
  const expiresAt = new Date(nowMilliseconds(at) + ADVISOR_THREAD_SUMMARY_TTL_MS).toISOString()
  const domainDigests = prepared?.versionedSnapshot?.domainDigests && typeof prepared.versionedSnapshot.domainDigests === 'object'
    ? Object.fromEntries(Object.entries(prepared.versionedSnapshot.domainDigests)
      .filter(([domain, digest]) => typeof domain === 'string' && /^[a-f0-9]{64}$/u.test(String(digest)))
      .sort(([left], [right]) => left.localeCompare(right)))
    : {}
  return {
    schema: 'theia-advisor-thread-summary/v1',
    createdAt: at,
    expiresAt,
    snapshotRevision: prepared?.versionedSnapshot?.revision || null,
    domainDigests,
    responseDigest: hash(rawText),
    evidenceState: 'current',
  }
}

function summaryExpiry(summary) {
  const explicit = Date.parse(String(summary?.expiresAt || ''))
  if (Number.isFinite(explicit)) return explicit
  const created = Date.parse(String(summary?.createdAt || ''))
  return Number.isFinite(created) ? created + ADVISOR_THREAD_SUMMARY_TTL_MS : null
}

function compactThreadHint(thread, snapshot, now) {
  const entries = []
  for (const message of Array.isArray(thread?.messages) ? thread.messages : []) {
    if (!message || typeof message !== 'object') continue
    if (message.role === 'user' && message.text) {
      entries.push({ role: 'user', text: boundedText(message.text, 240) })
      continue
    }
  }
  const selected = entries.slice(-MAX_THREAD_HINT_ENTRIES)
  const currentRevision = snapshot?.revision || null
  const currentDigests = snapshot?.domainDigests && typeof snapshot.domainDigests === 'object' ? snapshot.domainDigests : {}
  const nowValue = nowMilliseconds(now)
  const summaries = (Array.isArray(thread?.summaries) ? thread.summaries : [])
    .filter((summary) => summary?.schema === 'theia-advisor-thread-summary/v1')
    .filter((summary) => {
      const expiresAt = summaryExpiry(summary)
      return expiresAt !== null && expiresAt > nowValue
    })
    .slice(-MAX_THREAD_SUMMARIES)
    .map((summary) => {
      const changedDomains = Object.keys(summary.domainDigests || {})
        .filter((domain) => currentDigests[domain] && currentDigests[domain] !== summary.domainDigests[domain])
        .sort()
      return {
        snapshotRevision: boundedText(summary.snapshotRevision, 128),
        responseDigest: boundedText(summary.responseDigest, 64),
        expiresAt: new Date(summaryExpiry(summary)).toISOString(),
        evidenceState: summary.snapshotRevision === currentRevision && !changedDomains.length ? 'current' : 'historical',
        ...(changedDomains.length ? { changedDomains: changedDomains.slice(0, 16) } : {}),
      }
    })
  if (!selected.length && !summaries.length) return null
  const hint = {
    schema: 'theia-advisor-thread-hint/v1',
    entries: selected,
    ...(summaries.length ? { summaries } : {}),
    instruction: '这是对话导航提示，不是当前事实；历史摘要只用于识别 revision 变化，所有事实必须重新从当前本地快照工具读取并引用。',
  }
  if (Buffer.byteLength(canonicalJson(hint), 'utf8') <= MAX_THREAD_HINT_BYTES) return hint
  return {
    schema: hint.schema,
    entries: selected.slice(-2).map((entry) => ({
      role: entry.role,
      text: boundedText(entry.text, 320),
    })),
    ...(summaries.length ? { summaries: summaries.slice(-3) } : {}),
    instruction: hint.instruction,
  }
}

function providerMessages(context) {
  return [{ role: 'user', content: canonicalJson(context) }]
}

function providerMessageBytes(messages) {
  return Buffer.byteLength(canonicalJson(messages), 'utf8')
}

function publicThread(thread) {
  return deepClone({
    schema: ADVISOR_THREAD_SCHEMA,
    id: thread.id,
    title: thread.title,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    activeRequestId: thread.activeRequestId,
    summaries: thread.summaries,
    messages: thread.messages,
  })
}

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
    const input = record(request)
    const thread = this.threads.get(boundedText(input.threadId, 128))
    if (!thread) throw new AdvisorRuntimeError('thread-not-found', '顾问线程不存在或已删除。')
    if (thread.activeRequestId) throw new AdvisorRuntimeError('thread-busy', '该顾问线程正在生成回答。')
    const question = boundedText(input.question, 4_000)
    if (!question) throw new AdvisorRuntimeError('question-required', '请输入要咨询的问题。')
    const intent = 'general'
    // Data providers may be finishing a refresh in the background. Wait for
    // the provider barrier before taking the immutable revision used by the
    // Agent, without inspecting or routing on the user's words.
    await this.ensureDataReady()
    // CampusStore exposes the committed reference for this read-only path.
    // Revision checks still happen before send, so a sync cannot be mixed into
    // an Agent turn; cloning the whole academic state here only added latency.
    const versionedSnapshot = this.store.snapshotWithRevision({ clone: false })
    const state = versionedSnapshot.state ?? versionedSnapshot.snapshot
    const cacheProfile = normalizeAdvisorCacheProfile(state.profile)
    const promptCacheKey = advisorPromptCacheKey(cacheProfile)
    const settings = deepClone(state.settings || {})
    const modelId = modelForAdvisorIntent(settings, intent)
    if (!modelId) throw new AdvisorRuntimeError('provider-not-configured', '请先在设置中配置顾问模型。')
    let serviceIdentity
    try {
      serviceIdentity = modelServiceIdentity(settings.modelBaseUrl)
    } catch {
      throw new AdvisorRuntimeError('provider-not-configured', '模型服务地址无效，请重新配置。')
    }
    if (typeof this.modelService?.status === 'function') {
      const status = await this.modelService.status(settings)
      if (status?.apiKeySaved !== true) {
        throw new AdvisorRuntimeError('provider-not-configured', '请先在设置中完成模型服务和 API Key 配置。')
      }
    }
    const preparedAt = this.clock()
    const requestId = randomUUID()
    const cacheHit = this.#snapshotCache?.revision === versionedSnapshot.revision
    if (!cacheHit) {
      this.#snapshotCache = {
        revision: versionedSnapshot.revision,
        overview: advisorOverviewFromVersionedSnapshot(versionedSnapshot, { clock: () => preparedAt }),
      }
    }
    const overview = this.#snapshotCache.overview
    this.diagnostic('advisor.snapshot_context', {
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
      throw new AdvisorRuntimeError('workspace-unavailable', '本地校园数据工作区未能安全初始化。', { cause: error })
    }
    const inventory = workspace.inventory
    const recordCounts = Object.fromEntries(Object.entries(inventory).map(([domain, details]) => [
      domain,
      Math.max(0, Number(details.records || 0)) + Math.max(0, Number(details.localFacts || 0)),
    ]))
    this.pruneExpiredSummaries(thread, preparedAt)
    const threadHint = compactThreadHint(thread, versionedSnapshot, preparedAt)
    const sessionContext = {
      schema: 'theia-advisor-agent-session/v1',
      question: boundedText(question, 1_200),
      snapshotRevision: versionedSnapshot.revision,
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
      recordCounts,
      containsMailBody: false,
      containsProfileIdentity: Boolean(cacheProfile),
      containsFitness: false,
      containsAttachmentText: false,
      estimatedInputUnits: Math.ceil(Buffer.byteLength(canonicalJson(sessionContext), 'utf8') / 4),
      snapshotRevision: versionedSnapshot.revision,
      contextDigest,
    }
    const consentChallenge = {
      schema: 'theia-advisor-consent-challenge/v1',
      requestId,
      threadId: thread.id,
      serviceIdentity,
      purpose: 'advisor:lazy-read-only',
      intent,
      domains: [],
      entityDigests: [],
      contextDigest,
      requiredScopes: [],
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
      serviceIdentity,
      workspace,
      sessionContext,
      cacheProfile,
      promptCacheKey,
      agent: true,
      disclosure,
      consentChallenge,
    }
    for (const [existingId, existing] of this.#prepared) {
      if (existing.threadId === thread.id) this.#prepared.delete(existingId)
    }
    this.#prepared.set(requestId, item)
    return deepClone({
      schema: ADVISOR_PREPARED_SCHEMA,
      requestId,
      threadId: thread.id,
      expiresAt: item.expiresAt,
      disclosure: item.disclosure,
      consentChallenge: item.consentChallenge,
      agent: item.agent,
    })
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
    const configuredModelId = modelForAdvisorIntent(prepared.settings, prepared.intent)
    if (configuredServiceIdentity !== prepared.serviceIdentity || configuredModelId !== prepared.modelId) {
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
    let modelCalls = 0
    let agentToolCalls = 0
    let usage = { inputTokens: 0, outputTokens: 0, estimated: false, inputBytes: 0, outputBytes: 0 }
    let provider = null
    const assertRunActive = () => {
      if (controller.signal.aborted) {
        throw new AdvisorRuntimeError('cancelled', '顾问请求已取消。')
      }
    }
    try {
      provider = this.providerFactory(prepared.settings)
      let rawText
      try {
        const advisorConfig = prepared.settings.advisorConfig && typeof prepared.settings.advisorConfig === 'object'
          ? prepared.settings.advisorConfig
          : {}
        const agent = await runReadOnlyAdvisorAgent({
          provider,
          model: prepared.modelId,
          messages: initialMessages,
          tools: prepared.workspace.tools,
          signal: controller.signal,
          temperature: advisorConfig.temperature,
          reasoningEffort: advisorConfig.reasoningEffort,
          responseStyle: advisorConfig.responseStyle,
          responseLength: advisorConfig.responseLength,
          cacheProfile: prepared.cacheProfile,
          promptCacheKey: prepared.promptCacheKey,
          onEvent: (event) => {
            if (event?.type === 'delta') {
              this.emitStream({
                requestId,
                threadId: prepared.threadId,
                snapshotRevision: prepared.versionedSnapshot.revision,
                delta: event.delta,
              })
            } else if (event?.type === 'tool-start') {
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
          },
          budget: {
            maxSteps: Math.max(0, Math.min(this.budget.maxSteps || READ_ONLY_AGENT_MAX_STEPS_LEGACY, this.budget.maxModelCalls - 1)),
            maxInputBytes: agentInputBytesBudget(this.budget),
            maxInputTokens: this.budget.maxInputTokens,
            maxOutputBytes: this.budget.maxOutputBytes,
            // The agent derives a per-turn ceiling from responseLength and
            // the actual question/observations. This remains only the hard
            // safety ceiling for a single model turn.
            maxOutputTokens: this.budget.maxOutputTokens,
          },
        })
        modelCalls = agent.modelCalls
        agentToolCalls = agent.calls.length
        usage.inputBytes += agent.inputBytes
        usage.outputBytes += agent.outputBytes
        usage.inputTokens += agent.inputTokens
        usage.outputTokens += agent.outputTokens
        usage.estimated ||= agent.tokenEstimate
        rawText = agent.text
      } catch (error) {
        if (error instanceof AdvisorProviderError || error instanceof AdvisorRuntimeError || controller.signal.aborted) throw error
        if (!(error instanceof ReadOnlyAgentError)) {
          const providerError = safeProviderError(error)
          throw new AdvisorRuntimeError(providerError.code, providerError.message, {
            retryable: providerError.retryable,
            cause: providerError,
          })
        }
        modelCalls = error.details?.modelCalls || modelCalls
        usage.inputBytes += error.details?.inputBytes || 0
        usage.outputBytes += error.details?.outputBytes || 0
        usage.inputTokens += error.details?.inputTokens || 0
        usage.outputTokens += error.details?.outputTokens || 0
        usage.estimated ||= error.details?.tokenEstimate === true
        this.diagnostic('advisor.agent_failed', {
          requestId,
          snapshotRevision: prepared.versionedSnapshot.revision,
          reason: error.code,
          detail: String(error.message || '').slice(0, 500),
          modelCalls,
          status: 'failed',
        })
        throw new AdvisorRuntimeError(
          error.code,
          '模型本轮未能完成只读数据查询，请重试。',
          { retryable: true, cause: error },
        )
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
        modelId: prepared.modelId,
        scopes: prepared.disclosure.scopes,
        recordCounts: prepared.disclosure.recordCounts,
        modelCalls,
        agentToolCalls,
        inputBytes: usage.inputBytes,
        outputBytes: usage.outputBytes,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
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
        modelCalls,
        inputBytes: usage.inputBytes,
        outputBytes: usage.outputBytes,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        status: safe.code,
      })
      throw safe
    } finally {
      clearTimeout(deadline)
      this.active.delete(requestId)
      if (thread.activeRequestId === requestId) thread.activeRequestId = null
    }
  }

  answerFromModelText({ rawText, prepared, usage }) {
    const completedAt = this.clock()
    return {
      schema: ADVISOR_ANSWER_SCHEMA,
      requestId: prepared.requestId,
      threadId: prepared.threadId,
      intent: prepared.intent,
      snapshotRevision: prepared.versionedSnapshot.revision,
      rawText: String(rawText),
      model: {
        serviceIdentity: prepared.serviceIdentity,
        modelId: prepared.modelId,
      },
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        estimated: usage.estimated,
        inputBytes: usage.inputBytes,
        outputBytes: usage.outputBytes,
      },
      // Persist only revision/digest metadata for cross-revision navigation;
      // old model text and evidence are never sent back as current facts.
      threadSummary: responseSummary(rawText, prepared, completedAt),
    }
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
      // A provider may emit a space or newline as its own token. Dropping
      // whitespace-only deltas makes the live preview join adjacent words;
      // the stream is already bounded, so only an actually empty delta is
      // ignored here.
      if (!delta) return
      this.onStream({
        schema: 'theia-advisor-stream-event/v1',
        requestId: boundedText(event.requestId, 128),
        threadId: boundedText(event.threadId, 128),
        snapshotRevision: boundedText(event.snapshotRevision, 128),
        delta,
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
