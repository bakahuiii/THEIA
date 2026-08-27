/**
 * Iris is a private QQ C2C bridge for HYPERION, SELENE, and the local Codex task.
 * It never reads archive files, complete snapshots, or credentials from HYPERION.
 */

import process from 'node:process'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { QQBot } from '@tencent-connect/qqbot-nodejs'
import { createClaudeDesktopWatcher, inspectClaudeDesktop, readClaudeDesktopSessions } from './claudeDesktop.mjs'
import { createCommandRouter } from './commands.mjs'
import { createClaudeClient, resolveClaudeDesktopEntry } from './claudeCode.mjs'
import { classifyCodexFailure, createCodexClient } from './codex.mjs'
import { formatCodexHookCompletion, formatProviderCompletion } from './codexCompletion.mjs'
import { createCodexDesktopIpc } from './codexDesktopIpc.mjs'
import { claimDesktopCompletion, createCodexDesktopWatcher, dispatchDesktopCompletion } from './codexDesktopNotify.mjs'
import { createControlServer } from './controlServer.mjs'
import { createHermesClient } from './hermesRunner.mjs'
import { createHyperionClient } from './hyperion.mjs'
import { quotedMessageReference } from './qqReference.mjs'
import { createTheiaClient } from './theia.mjs'
import { loadCodexContinuation, loadIrisState, queueNotification, removePendingNotification, saveClaudeSession, saveCodexContinuation, saveCodexSession, saveHermesSession, saveTrustedTarget } from './state.mjs'
import { acquireIrisInstance } from './singleInstance.mjs'
import { loadIrisSettings } from './settings.mjs'
import { readFile } from 'node:fs/promises'

const irisDirectory = resolve(process.env.IRIS_HOME || dirname(dirname(fileURLToPath(import.meta.url))))
const irisLogDirectory = join(irisDirectory, 'logs')

function loadEnv() {
  const envPath = `${irisDirectory}\\.env`
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const divider = trimmed.indexOf('=')
    if (divider < 1) continue
    const key = trimmed.slice(0, divider).trim()
    const value = trimmed.slice(divider + 1).trim()
    if (key && !Object.hasOwn(process.env, key)) process.env[key] = value
  }
}

function env(...keys) {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
  return ''
}

function safeError(error) {
  const message = String(error?.message ?? '')
  if (/unauthorized|invalid.*secret|token/i.test(message)) return 'QQ Bot authentication failed. Check the local .env credentials.'
  return message.slice(0, 360) || 'Unknown error'
}

function validCodexSessionId(value) {
  const id = typeof value === 'string' ? value.trim() : ''
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : ''
}

function parseNotifyOptions(argumentsList) {
  const options = { sessionId: '', title: '', workspaceName: '', message: '' }
  const remaining = []
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index]
    if (argument === '--session') {
      options.sessionId = validCodexSessionId(argumentsList[index + 1])
      index += 1
    } else if (argument === '--title') {
      options.title = String(argumentsList[index + 1] ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)
      index += 1
    } else if (argument === '--workspace') {
      options.workspaceName = String(argumentsList[index + 1] ?? '').trim().toLowerCase().slice(0, 64)
      index += 1
    } else if (argument === '--message') {
      options.message = String(argumentsList[index + 1] ?? '').trim().slice(0, 3_200)
      index += 1
    } else {
      remaining.push(argument)
    }
  }
  if (!options.message) options.message = remaining.join(' ').trim().slice(0, 3_200)
  return options
}

function logger(level, message) {
  const output = `[Iris] ${String(message ?? '').replace(/\s+/g, ' ').slice(0, 500)}`
  try {
    mkdirSync(irisLogDirectory, { recursive: true })
    appendFileSync(join(irisLogDirectory, 'iris-runtime.log'), `${new Date().toISOString()} ${output}\n`, 'utf8')
  } catch { /* Logging must never interrupt a private QQ reply. */ }
  if (level === 'error') console.error(output)
  else if (level === 'warn') console.warn(output)
  else console.log(output)
}

loadEnv()

const appId = env('QQBOT_APP_ID', 'QQ_APPID')
const appSecret = env('QQBOT_APP_SECRET', 'QQ_SECRET')
const configuredOwner = env('QQBOT_OWNER_OPENID', 'OWNER_OPENID', 'OWNER_QQ')
const mode = process.argv[2] ?? ''
const notificationOnly = mode === '--notify'
const auxiliaryMode = mode === '--notify' || mode === '--dispatch'
const instance = auxiliaryMode
  ? null
  : await acquireIrisInstance({ lockPath: join(irisDirectory, '.iris-instance') })

if (!auxiliaryMode && !instance?.acquired) {
  logger('warn', `another Iris instance is already active${instance?.holderPid ? ` (pid ${instance.holderPid})` : ''}; exiting duplicate process`)
} else if (!appId || !appSecret) {
  console.error('[Iris] QQBOT_APP_ID and QQBOT_APP_SECRET must be configured in the local .env file.')
  await instance?.release()
  process.exitCode = 1
} else {
  const bot = new QQBot({
    appId,
    appSecret,
    logger: {
      info: (message) => logger('info', message),
      warn: (message) => logger('warn', message),
      error: (message) => logger('error', message),
    },
  })
  const api = createHyperionClient()
  const theia = createTheiaClient()
  const codexDesktopIpc = createCodexDesktopIpc()
  const codex = createCodexClient({
    desktop: codexDesktopIpc,
    loadSelectedSession: async () => (await loadIrisState()).codexSessionId,
    saveSelectedSession: saveCodexSession,
    onError: ({ id, sessionId, diagnostic }) => {
      logger('error', `Codex ${id || 'launch'} failure${sessionId ? ` (${sessionId.slice(0, 8)}...)` : ''}: ${safeError(new Error(diagnostic))}`)
    },
    onProgress: ({ id, sessionId, stage }) => {
      logger('info', `Codex ${id} ${stage}${sessionId ? ` (${sessionId.slice(0, 8)}...)` : ''}`)
    },
  })
  const hermesClient = createHermesClient({
    loadSelectedSession: async () => (await loadIrisState()).hermesSessionId,
    saveSelectedSession: saveHermesSession,
    onError: ({ diagnostic }) => {
      logger('error', `Hermes failure: ${safeError(new Error(diagnostic))}`)
    },
  })
  const claudeDesktopHome = process.env.IRIS_CLAUDE_DESKTOP_HOME || join(process.env.LOCALAPPDATA ?? '', 'Claude-3p')
  const claudeDesktopSessions = await readClaudeDesktopSessions(claudeDesktopHome)
  const currentClaudeDesktopSession = claudeDesktopSessions[0] ?? null
  const claudeClient = createClaudeClient({
    entryPath: resolveClaudeDesktopEntry(claudeDesktopHome),
    loadSelectedSession: async () => {
      const state = await loadIrisState()
      if (state.claudeSessionId) return state.claudeSessionId
      return currentClaudeDesktopSession?.cliSessionId ?? ''
    },
    saveSelectedSession: saveClaudeSession,
    workspace: currentClaudeDesktopSession?.cwd || process.env.IRIS_CLAUDE_WORKSPACE || process.env.IRIS_CODEX_WORKSPACE || process.cwd(),
    onError: ({ diagnostic }) => logger('error', `Claude Code failure: ${safeError(new Error(diagnostic))}`),
  })
  const dispatch = createCommandRouter(api, { theia, codex, hermes: hermesClient, claude: claudeClient, settings: loadIrisSettings })

  function completionMessage(provider, result, options = {}) {
    return formatProviderCompletion({
      provider,
      status: result.status || (result.ok ? '已完成' : '未完成'),
      title: options.taskName || result.taskName || result.session?.name || result.session?.title || provider,
      workspace: options.workspaceLabel ?? result.workspaceLabel ?? result.session?.workspace,
      text: result.text,
      sessionId: result.ok ? result.session?.id : '',
      continuation: options.continuation,
      // Codex's final answer is user-visible source material. Preserve code,
      // underscores, and literal Markdown instead of rewriting the answer.
      preserveText: provider === 'Codex',
      template: loadIrisSettings().completionTemplate,
    })
  }

  function readableTaskName(value) {
    const title = String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
    return /^(?:已选会话|selected conversation|未命名会话|codex)$/i.test(title) ? '' : title
  }

  function continuationForResult(result, { taskName = '' } = {}) {
    // A failed turn did not produce a safe continuation point. In particular,
    // an occupied session must never create a quote anchor that retries the
    // same locked conversation on the user's next reply.
    if (!result?.ok) return null
    const sessionId = validCodexSessionId(result.session?.id)
    if (!sessionId) return null
    const title = readableTaskName(taskName) || readableTaskName(result.taskName) || readableTaskName(result.session?.name) || readableTaskName(result.session?.title)
    return {
      sessionId,
      ...(result.workspaceName ? { workspaceName: result.workspaceName } : {}),
      ...(title ? { taskName: title } : {}),
    }
  }

  async function deliverCodexCompletion(target, result, { taskName = '' } = {}) {
    if (result?.transport === 'desktop-ipc' && result?.turnId && result?.session?.id) {
      const claimed = await claimDesktopCompletion({
        sessionId: result.session.id,
        turnId: result.turnId,
        finalText: result.text,
      })
      // The background desktop watcher may have claimed this completion in
      // another Iris process and will deliver it with the same anchor logic.
      if (!claimed) return ''
    }
    const continuation = continuationForResult(result, { taskName })
    const title = continuation?.taskName || ''
    // A QQ inbound reply target may contain msgId. That reply window expires
    // while Codex runs, so completions must use the durable C2C target.
    const deliveryTarget = target?.scope && target?.targetId
      ? { scope: target.scope, targetId: target.targetId }
      : target
    const sent = await bot.sendText(deliveryTarget, completionMessage('Codex', result, { taskName: title }))
    const refIdx = typeof sent?.ext_info?.ref_idx === 'string' ? sent.ext_info.ref_idx : ''
    if (target.scope === 'c2c' && refIdx && continuation) {
      await saveCodexContinuation({
        refIdx,
        targetId: target.targetId,
        ...continuation,
      })
    }
    return refIdx
  }

  async function queueCodexCompletion(result, options = {}) {
    const continuation = continuationForResult(result, options)
    await queueNotification(completionMessage('Codex', result, { taskName: continuation?.taskName }), { codexContinuation: continuation })
  }

  async function deliverOrQueueCodexCompletion(target, result, options = {}, source = 'Codex') {
    try {
      await deliverCodexCompletion(target, result, options)
      logger('info', `${source} ${result.id} completion delivered (${result.ok ? 'ok' : 'failed'})`)
      return 'delivered'
    } catch (deliveryError) {
      try {
        await queueCodexCompletion(result, options)
        logger('warn', `${source} ${result.id} completion delivery failed; queued for the next trusted C2C message: ${safeError(deliveryError)}`)
        return 'queued'
      } catch (queueError) {
        logger('error', `${source} ${result.id} completion delivery and queueing failed: ${safeError(queueError)}`)
        return 'failed'
      }
    }
  }

  async function deliverClaudeCompletion(target, result) {
    await bot.sendText(target, completionMessage('Claude Desktop', result, { continuation: result.continuation }))
  }

  async function continuationTaskName(continuation) {
    if (continuation.taskName) return continuation.taskName
    try {
      const status = await codex.status()
      const session = status.sessions?.find((item) => item.id === continuation.sessionId)
      const title = readableTaskName(session?.name)
      if (title) return title
    } catch { /* A missing session title must not block a valid continuation. */ }
    return '当前 Codex 会话'
  }

  async function continueQuotedCodexConversation(msg, continuation) {
    const instruction = msg.content.trim()
    if (!instruction) return '请将下一步要执行的 Codex 指令写在回复中。'
    try {
      const taskName = await continuationTaskName(continuation)
      await codex.submit(instruction, {
        sessionId: continuation.sessionId,
        workspaceName: continuation.workspaceName,
        onComplete: async (result) => {
          await deliverOrQueueCodexCompletion(msg.replyTarget, result, { taskName }, 'Codex continuation')
        },
      })
      return `Iris 已续接「${taskName}」这条 Codex 对话，任务正在运行，完成后会继续发送到这里。`
    } catch (error) {
      return `Iris 无法续接这条引用对应的 Codex 对话：${safeError(error)}`
    }
  }

  async function notifyCompletionFromHook() {
    const options = parseNotifyOptions(process.argv.slice(3))
    await deliverCodexHookCompletion(options)
  }

  async function deliverCodexHookCompletion(options = {}) {
    const state = await loadIrisState()
    const failure = options.errorMessage
      ? classifyCodexFailure(new Error(String(options.errorMessage)))
      : null
    // Only wrap in Codex format when this is a real Codex hook (has session,
    // title, or a classified failure). A plain --notify "text" is delivered
    // as-is without a Codex header.
    const isCodexHook = Boolean(options.sessionId || options.title || failure)
    const hookMessage = failure
      ? completionMessage('Codex', {
          ok: false,
          status: failure.status,
          text: failure.text,
          taskName: options.title,
        }, { taskName: options.title, workspaceLabel: options.workspaceName })
      : isCodexHook
        ? formatCodexHookCompletion({ title: options.title, workspace: options.workspaceName, text: options.message }, loadIrisSettings().completionTemplate)
      : options.message.trim()
    const message = hookMessage || 'Iris、本机 Codex、HYPERION 与 SELENE 已完成本地连接。发送「帮助」或「help」开始使用。'
    if (!state.replyTarget) {
      await queueNotification(message, {
        codexContinuation: isCodexHook && options.sessionId && !failure
          ? { sessionId: options.sessionId, workspaceName: options.workspaceName, taskName: options.title }
          : null,
      })
      logger('info', 'completion notification queued until the first trusted C2C message arrives')
      return
    }
    try {
      const sent = await bot.sendText(state.replyTarget, message.slice(0, 3_800))
      const refIdx = typeof sent?.ext_info?.ref_idx === 'string' ? sent.ext_info.ref_idx : ''
      if (refIdx && options.sessionId && !failure) {
        await saveCodexContinuation({ refIdx, targetId: state.replyTarget.targetId, sessionId: options.sessionId, workspaceName: options.workspaceName, taskName: options.title })
      }
      logger('info', 'completion notification sent')
    } catch (deliveryError) {
      await queueNotification(message, {
        codexContinuation: isCodexHook && options.sessionId && !failure
          ? { sessionId: options.sessionId, workspaceName: options.workspaceName, taskName: options.title }
          : null,
      })
      logger('warn', `completion notification delivery failed; queued for the next trusted C2C message: ${safeError(deliveryError)}`)
    }
  }

  async function startCodexDesktopWatcher() {
    codexDesktopWatcher?.close()
    codexDesktopWatcher = createCodexDesktopWatcher({
      codexHome: process.env.IRIS_CODEX_HOME || process.env.CODEX_HOME,
      workspaceMapValue: process.env.IRIS_CODEX_WORKSPACE_MAP,
      logger,
      onComplete: async (completion) => {
        await dispatchDesktopCompletion(completion, {
          workspaceMapValue: process.env.IRIS_CODEX_WORKSPACE_MAP,
          dispatch: async (options) => {
            await deliverCodexHookCompletion(options)
            logger('info', `Codex desktop completion delivered (${options.sessionId.slice(0, 8)}...)`)
          },
        })
      },
    })
  }

  /**
   * --dispatch mode: Hermes (or any local script) submits a Codex instruction
   * and receives the result as a QQ message, without needing Iris in chat mode.
   *
   * Usage:
   *   node src/index.mjs --dispatch [--workspace <name>] <instruction>
   *   node src/index.mjs --dispatch --workspace buct "修复课表解析"
   */
  async function dispatchToCodex() {
    const args = process.argv.slice(3)
    let workspaceName = ''
    const remaining = []
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === '--workspace' || args[i] === '-w') {
        workspaceName = String(args[i + 1] ?? '').trim().toLowerCase()
        i += 1
      } else {
        remaining.push(args[i])
      }
    }
    const instruction = remaining.join(' ').trim()
    if (!instruction) {
      logger('error', '--dispatch requires an instruction after the workspace flag')
      process.exitCode = 1
      return
    }
    logger('info', `--dispatch: workspace="${workspaceName || 'default'}" instruction="${instruction.slice(0, 80)}${instruction.length > 80 ? '…' : ''}"`)
    try {
      const job = await codex.submit(instruction, {
        workspaceName,
        onComplete: async (result) => {
          const current = await loadIrisState()
          if (!current.replyTarget) {
            await queueCodexCompletion(result)
            logger('info', '--dispatch: Codex result queued (no reply target yet)')
            return
          }
          await deliverOrQueueCodexCompletion(current.replyTarget, result, {}, '--dispatch')
        },
      })
      // Block until the Codex job finishes, then exit cleanly.
      await job.completion
    } catch (error) {
      logger('error', `--dispatch: Codex submission failed: ${safeError(error)}`)
      const current = await loadIrisState()
      if (current.replyTarget) {
        try {
          await bot.sendText(current.replyTarget, `【Iris · 委托失败】\n${safeError(error)}`.slice(0, 1_000))
        } catch { /* best-effort */ }
      }
      process.exitCode = 1
    } finally {
      // Auxiliary dispatch mode never starts the QQ gateway. Close the
      // desktop IPC socket explicitly so the one-shot process can exit.
      codexDesktopIpc.close()
    }
  }

  async function deliverPendingNotifications(target) {
    const state = await loadIrisState()
    for (const notification of state.pendingNotifications) {
      try {
        const sent = await bot.sendText(target, notification.text)
        const refIdx = typeof sent?.ext_info?.ref_idx === 'string' ? sent.ext_info.ref_idx : ''
        if (target.scope === 'c2c' && refIdx && notification.codexContinuation) {
          await saveCodexContinuation({
            refIdx,
            targetId: target.targetId,
            ...notification.codexContinuation,
          })
        }
        await removePendingNotification(notification.id)
        logger('info', 'queued completion notification sent')
      } catch (error) {
        logger('warn', `queued notification remains pending: ${safeError(error)}`)
        break
      }
    }
  }

  async function tailLogs() {
    try {
      const lines = (await readFile(join(irisLogDirectory, 'iris-runtime.log'), 'utf8')).split(/\r?\n/).filter(Boolean)
      return lines.slice(-120)
    } catch {
      return []
    }
  }

  async function inspectTheia() {
    if (loadIrisSettings().providers.theia !== true) return { enabled: false, connected: false, code: 'THEIA_DISABLED' }
    try {
      const overview = await theia.overview()
      const domains = [...(overview.sections ?? []), ...(overview.extraDomains ?? [])]
        .filter((section) => section && typeof section.domain === 'string')
        .map((section) => ({
          domain: section.domain,
          label: section.label ?? section.domain,
          count: Number.isSafeInteger(section.count) ? section.count : 0,
          status: section.status ?? 'unknown',
          completeness: section.completeness ?? 'unknown',
          stale: section.stale === true,
          retainedPrevious: section.retainedPrevious === true,
          capturedAt: section.capturedAt ?? null,
        }))
      const sync = overview.sync ?? {}
      const degraded = domains.some((section) => section.status === 'failed' || section.status === 'auth-required' || section.completeness === 'partial' || section.stale || section.retainedPrevious)
      return {
        connected: true,
        currentTerm: overview.currentTerm ?? null,
        domains,
        lastRunAt: sync.lastRunAt ?? null,
        lastSuccessAt: sync.lastSuccessAt ?? null,
        lastCompletedAt: sync.lastSuccessAt ?? null,
        enabled: true,
        degraded: Boolean(sync.lastError) || degraded,
      }
    } catch (error) {
      return { enabled: true, connected: false, code: error?.code ?? 'THEIA_NOT_RUNNING' }
    }
  }

  let qqConnected = false
  let controlServer = null
  let claudeDesktopWatcher = null
  let codexDesktopWatcher = null

  async function sendTestNotification() {
    const state = await loadIrisState()
    if (!state.replyTarget) throw new Error('尚未绑定 QQ owner，请先向 Iris 发送一条私聊。')
    await bot.sendText(state.replyTarget, '【Iris · 测试通知】\n这是来自本机控制台的测试消息。')
  }

  async function startClaudeDesktopWatcher() {
    claudeDesktopWatcher?.close()
    const settings = loadIrisSettings()
    if (settings.providers.claudeDesktop === false) {
      claudeDesktopWatcher = null
      return
    }
    claudeDesktopWatcher = createClaudeDesktopWatcher({
      desktopHome: process.env.IRIS_CLAUDE_DESKTOP_HOME,
      logger,
      onError: (error) => logger('warn', `Claude Desktop watcher: ${safeError(error)}`),
      onComplete: async (result) => {
        try {
          const state = await loadIrisState()
          if (!state.replyTarget) {
            await queueNotification(completionMessage('Claude Desktop', result, { continuation: result.continuation }))
            logger('info', 'Claude Desktop result queued (no reply target yet)')
            return
          }
          await deliverClaudeCompletion(state.replyTarget, result)
          logger('info', `Claude Desktop ${result.id} completion delivered`)
        } catch (error) {
          logger('warn', `Claude Desktop ${result.id} completion delivery failed: ${safeError(error)}`)
        }
      },
    })
  }

  if (process.argv[2] === '--notify') {
    await notifyCompletionFromHook().catch((error) => {
      logger('error', `completion notification failed: ${safeError(error)}`)
      process.exitCode = 1
    })
  } else if (process.argv[2] === '--dispatch') {
    await dispatchToCodex().catch((error) => {
      logger('error', `dispatch failed: ${safeError(error)}`)
      process.exitCode = 1
    })
  } else {
    controlServer = await createControlServer({
      port: loadIrisSettings().guiPort,
      status: async () => {
        const state = await loadIrisState()
        const [codexStatus, hermesStatus, claudeDesktop, theiaStatus] = await Promise.all([
          codex.status({ includeSessions: false }).catch(() => ({ activeJobs: [], available: false })),
          hermesClient.status().catch(() => ({ activeJobs: [], available: false })),
          inspectClaudeDesktop({ desktopHome: process.env.IRIS_CLAUDE_DESKTOP_HOME, watcher: claudeDesktopWatcher }).catch(() => ({ available: false })),
          inspectTheia(),
        ])
        return {
          pid: process.pid,
          connected: qqConnected,
          providers: loadIrisSettings().providers,
          theia: theiaStatus,
          activeJobs: {
            codex: codexStatus.activeJobs ?? [],
            hermes: hermesStatus.activeJobs ?? [],
          },
          claudeDesktop: {
            ...claudeDesktop,
            enabled: loadIrisSettings().providers.claudeDesktop,
          },
          replyTargetBound: Boolean(state.replyTarget),
        }
      },
      tailLogs,
      sendTest: sendTestNotification,
      onSettingsSaved: async (saved) => {
        for (const [key, value] of Object.entries(saved.env ?? {})) process.env[key] = value
        await startClaudeDesktopWatcher()
      },
      logger,
    }).catch((error) => {
      logger('warn', `control GUI unavailable: ${safeError(error)}`)
      return null
    })
    await startClaudeDesktopWatcher()
    await startCodexDesktopWatcher()
    bot.on('ready', () => {
      qqConnected = true
      logger('info', `connected (app ${appId.slice(0, 4)}...)`)
      logger('info', `HYPERION API ${process.env.HYPERION_API ?? 'http://127.0.0.1:8787'}`)
      if (!configuredOwner) logger('warn', 'no owner OpenID configured; the first C2C sender will be bound locally')
    })
    bot.on('resumed', () => { qqConnected = true; logger('info', 'gateway session resumed') })
    bot.on('error', (error) => logger('error', `gateway error: ${safeError(error)}`))

    bot.on('message', async (_ctx, msg) => {
      if (msg.kind !== 'c2c' || !msg.senderId || !msg.replyTarget) return
      const state = await loadIrisState()
      const expectedOwner = configuredOwner || state.ownerOpenid
      if (expectedOwner && msg.senderId !== expectedOwner) {
        logger('warn', `ignored message from an untrusted sender (${msg.senderId.slice(0, 8)}...)`)
        return
      }
      if (!expectedOwner) logger('warn', `bound first C2C sender (${msg.senderId.slice(0, 8)}...) as the local owner`)
      await saveTrustedTarget({ ownerOpenid: msg.senderId, replyTarget: msg.replyTarget })
      await deliverPendingNotifications(msg.replyTarget)

      logger('info', `received ${msg.content.trim().length} characters from owner`)
      const refIdx = quotedMessageReference(msg)
      const continuation = refIdx
        ? await loadCodexContinuation({ refIdx, targetId: msg.senderId })
        : null
      if (continuation) {
        const reply = await continueQuotedCodexConversation(msg, continuation)
        await bot.sendText(msg.replyTarget, reply)
        logger('info', `continued quoted Codex session (${continuation.sessionId.slice(0, 8)}...)`)
        return
      }
      if (refIdx.startsWith('REFIDX_')) {
        await bot.sendText(msg.replyTarget, '这条 Codex 完成消息的续接锚点已过期或不可用。请发送「codex sessions」选择会话，或直接发送「codex <指令>」继续。')
        logger('warn', `Codex continuation reference not found (${refIdx.slice(0, 16)}...)`)
        return
      }
      const reply = await dispatch(msg.content, {
        onCodexComplete: async (result) => {
          await deliverOrQueueCodexCompletion(msg.replyTarget, result, {}, 'Codex job')
        },
        onHermesComplete: async (result) => {
          try {
            await bot.sendText(msg.replyTarget, completionMessage('Hermes', result))
            logger('info', `Hermes job ${result.id} completion delivered (${result.ok ? 'ok' : 'failed'})`)
          } catch (error) {
            logger('warn', `Hermes job ${result.id} completion delivery failed: ${safeError(error)}`)
          }
        },
        onClaudeComplete: async (result) => {
          try {
            await deliverClaudeCompletion(msg.replyTarget, result)
            logger('info', `Claude Desktop job ${result.id} completion delivered (${result.ok ? 'ok' : 'failed'})`)
          } catch (error) {
            logger('warn', `Claude Desktop job ${result.id} completion delivery failed: ${safeError(error)}`)
          }
        },
      })
      if (!reply) return
      if (typeof reply === 'object' && !Array.isArray(reply) && reply.type === 'image') {
        try {
          const data = reply.data
          if (!data || typeof data !== 'string') throw new Error('image data missing')
          const buffer = Buffer.from(data, 'base64')
          if (!buffer.length) throw new Error('image data empty')
          const fileName = String(reply.fileName || 'image.png').replace(/[^a-zA-Z0-9_.-]/g, '_')
          await bot.sendImage(msg.replyTarget, { buffer, fileName })
          if (reply.text) await bot.sendText(msg.replyTarget, reply.text)
          logger('info', `sent image reply (${buffer.length} bytes)${reply.text ? ` + text (${reply.text.length} chars)` : ''}`)
        } catch (imageError) {
          const fallback = String(reply.text || '图片发送失败，请稍后重试。').trim()
          await bot.sendText(msg.replyTarget, fallback).catch(() => undefined)
          logger('warn', `image reply failed: ${String(imageError?.message || imageError).slice(0, 200)}`)
        }
      } else {
        const text = typeof reply === 'string' ? reply : String(reply ?? '')
        if (text) await bot.sendText(msg.replyTarget, text)
        logger('info', `sent ${text.length} character reply`)
      }
    })

    // The SDK can unref its socket before bot.start() resolves. Keep the
    // private bridge resident throughout both connection and ready states.
    const eventLoopKeepAlive = setInterval(() => {}, 60_000)
    // Heartbeat the single-instance lock so a second Iris process never
    // reclaims a lock held by a live instance, while a stale lock (whose
    // owner.json was never refreshed, e.g. after a crash or PID reuse) can
    // still be reclaimed after the grace period.
    const lockHeartbeat = instance?.touch
      ? setInterval(() => { void instance.touch().catch(() => undefined) }, 30_000)
      : null
    const stop = () => {
      logger('info', 'stopping')
      clearInterval(eventLoopKeepAlive)
      if (lockHeartbeat) clearInterval(lockHeartbeat)
      qqConnected = false
      claudeDesktopWatcher?.close()
      codexDesktopWatcher?.close()
      codexDesktopIpc.close()
      void controlServer?.close()
      bot.stop()
      void instance?.release()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    await bot.start()
      .catch((error) => {
        clearInterval(eventLoopKeepAlive)
        void instance?.release()
        logger('error', `startup failed: ${safeError(error)}`)
        process.exitCode = 1
      })
  }
}
