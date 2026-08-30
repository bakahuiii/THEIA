/** Pure command router. It receives narrow local clients rather than data files. */

import {
  compact,
  commandError,
  codexError,
  formatCodexStatus,
  formatHermesStatus,
  formatTime,
  hermesError,
  help,
  isOneOf,
  parseCheckIn,
  safeReply,
  splitCommand,
  theiaError,
} from './command-formatters.mjs'
import { DEFAULT_COMMAND_MESSAGES, renderCommandHelp, renderCommandMessage } from './settings.mjs'
import { createTheiaCommands } from './commands-theia.mjs'

export { help, parseCheckIn } from './command-formatters.mjs'

export function createCommandRouter(api, { theia, codex, hermes, claude, settings = () => ({ providers: { codex: true, claudeDesktop: true } }), now = () => new Date() } = {}) {
  function providerEnabled(id) {
    const current = settings()
    return id === 'claude' ? current.providers?.claudeDesktop !== false : current.providers?.[id] !== false
  }

  function providerDisabled(id, label) {
    return `${label} 当前未启用。请在本机高级设置中显式启用后再使用。`
  }

  function isCommand(value, id, builtIns) {
    return isOneOf(value, [...builtIns, ...(settings().commandAliases?.[id] ?? [])])
  }
  function commandMessage(name, variables) {
    const configured = settings().commandMessages?.[name] ?? DEFAULT_COMMAND_MESSAGES[name]
    return renderCommandMessage(configured, variables)
  }
  async function journal(content) {
    if (!content) return '请在「日记」或「diary」后写下想记录的内容。'
    await api.journal(content)
    return `已记录 · ${formatTime(new Date().toISOString())}`
  }

  async function checkIn(content) {
    const fields = parseCheckIn(content)
    if (!fields) return '格式：状态 <心情1-5> [睡眠小时] [药:是/否/减] [酒:无/少/多] [| 一句话]'
    const result = await api.checkIn(fields)
    const item = result?.item ?? fields
    const labels = []
    if (item.mood) labels.push(`心情 ${item.mood}/5`)
    if (item.sleepHours !== undefined) labels.push(`睡眠 ${item.sleepHours}h`)
    if (item.medication && item.medication !== 'unknown') labels.push(`药物 ${{ yes: '已服', no: '未服', reduced: '减量' }[item.medication]}`)
    if (item.alcohol && item.alcohol !== 'unknown') labels.push(`酒精 ${{ none: '无', low: '少', high: '多' }[item.alcohol]}`)
    return `状态已记录${labels.length ? `：${labels.join(' · ')}` : ''}`
  }

  async function quests() {
    const result = await api.quests()
    const items = Array.isArray(result?.items) ? result.items : []
    if (!items.length) return '当前没有待完成任务。'
    return safeReply(['【待完成任务】', ...items.map((item, index) => {
      const time = item.dueAt ? ` · 截止 ${formatTime(item.dueAt)}` : item.startAt ? ` · 时间 ${formatTime(item.startAt)}` : ''
      return `${index + 1}. ${compact(item.title, 120)}${time}`
    }), '回复「完成 序号」或「done 序号」可标记完成。'])
  }

  async function complete(query) {
    if (!query) return '请提供任务序号或标题，例如「完成 1」或「done 1」。'
    const result = await api.quests()
    const items = Array.isArray(result?.items) ? result.items : []
    const numeric = Number(query)
    const match = Number.isInteger(numeric) && numeric > 0
      ? items[numeric - 1]
      : items.find((item) => item.title === query) ?? items.find((item) => item.title.includes(query))
    if (!match) return `没有找到「${compact(query, 80)}」。先发送「任务」查看序号。`
    const completion = await api.completeQuest(match.id)
    return `已完成：${compact(completion?.title ?? match.title, 200)}`
  }

  async function people(query) {
    const result = await api.people(query)
    const items = Array.isArray(result?.items) ? result.items : []
    if (!items.length) return query ? `没有找到「${compact(query, 80)}」。` : '还没有人物记录。'
    if (query) {
      const item = items[0]
      return safeReply([
        `【${compact(item.name, 120)}】`,
        item.lastObservedAt ? `最近证据：${formatTime(item.lastObservedAt)}` : '',
        item.portrait ? compact(item.portrait, 1_300) : '暂未生成人物刻画。',
        `已核验条目：${item.factCount ?? 0} 条事实 · ${item.preferenceCount ?? 0} 条偏好`,
      ].filter(Boolean))
    }
    return safeReply(['【人物】', ...items.slice(0, 20).map((item) => `· ${compact(item.name, 80)}${item.lastObservedAt ? ` · ${formatTime(item.lastObservedAt).slice(0, 10)}` : ''}`), items.length > 20 ? `共 ${items.length} 人；可发送「人物 名称」查看。` : ''])
  }

  async function selene() {
    const result = await api.selene()
    const mix = Object.entries(result?.platformMix ?? {}).map(([platform, count]) => `${platform} ${count}`).join(' · ')
    const latest = Array.isArray(result?.latestEvents) ? result.latestEvents : []
    return safeReply([
      '【SELENE 时间线】',
      `事件：${Number(result?.eventCount) || 0} 条${mix ? ` · ${mix}` : ''}`,
      result?.latestCapturedAt ? `最近采集：${formatTime(result.latestCapturedAt)}` : '尚未导入 SELENE 快照。',
      ...latest.map((item) => `· ${formatTime(item.startAt)} · ${compact(item.title || item.kind, 100)}`),
    ])
  }

  async function ai() {
    const result = await api.ai()
    const scheduler = result?.scheduler ?? {}
    const channels = Array.isArray(result?.channels) ? result.channels : []
    return safeReply([
      '【AI 通道】',
      `运行中 ${scheduler.activeRequests ?? 0}/${scheduler.effectiveMaxConcurrency ?? 0} · 队列 ${scheduler.queueDepth ?? 0} · 可用 ${scheduler.availableCapacity ?? 0}`,
      ...channels.slice(0, 20).map((item) => `· ${compact(item.name, 80)} ${item.status ?? 'unknown'} ${item.activeRequests ?? 0}/${item.maxConcurrency ?? 1}`),
    ])
  }

  async function summary() {
    const result = await api.summary()
    return safeReply([
      '【HYPERION 概览】',
      `待完成任务：${result?.activeQuestCount ?? 0} · 已完成：${result?.completedQuestCount ?? 0}`,
      `人物：${result?.peopleCount ?? 0} · 状态快照：${result?.journalCheckInCount ?? 0}`,
      `归档：${Number(result?.archiveRecordCount ?? 0).toLocaleString()} 条消息 · ${Number(result?.archiveConversationCount ?? 0).toLocaleString()} 个会话`,
      result?.archiveUpdatedAt ? `归档更新：${formatTime(result.archiveUpdatedAt)}` : '',
    ].filter(Boolean))
  }

  const {
    theiaStatus,
    theiaToday,
    theiaAgent,
    theiaClassroom,
    theiaMotion,
  } = createTheiaCommands({ theia, now })

  function scopedHelp(group, title, fallback) {
    const current = settings()
    return current.commandHelp ? renderCommandHelp(current.commandHelp, { group, intro: title, aliases: current.commandAliases, visibleProviders: current.visibleProviders }) : fallback
  }

  async function hyperionCommand(rest) {
    if (!providerEnabled('hyperion')) return providerDisabled('hyperion', 'HYPERION')
    const { head, rest: body } = splitCommand(rest)
    if (!head || isCommand(head, 'help', ['help', 'h', '帮助', '?'])) {
      return scopedHelp('hyperion', '【HYPERION】', 'HYPERION：diary、status、task、done、people、selene、channels、summary。')
    }
    if (isCommand(head, 'hyperion-diary', ['日记', 'diary', 'journal', 'd', 'j'])) return await journal(body)
    if (isCommand(head, 'hyperion-status', ['状态', 'status', 'checkin', 's'])) return await checkIn(body)
    if (isCommand(head, 'hyperion-task', ['任务', 'task', 'tasks', 't'])) return await quests()
    if (isCommand(head, 'hyperion-done', ['完成', 'done', 'complete', 'finish', 'c'])) return await complete(body)
    if (isCommand(head, 'hyperion-people', ['人物', 'people', 'person', 'p'])) return await people(body)
    if (isOneOf(head, ['selene', 'se'])) return 'SELENE 已独立为一级指令。请直接发送「selene」。'
    if (isCommand(head, 'hyperion-channels', ['通道', 'channel', 'channels', 'ai', 'a'])) return await ai()
    if (isCommand(head, 'hyperion-summary', ['概览', 'summary', 'overview', 'info', 'o'])) return await summary()
    return scopedHelp('hyperion', '【HYPERION】', 'HYPERION：diary、status、task、done、people、selene、channels、summary。')
  }

  async function theiaCommand(rest) {
    if (!providerEnabled('theia')) return providerDisabled('theia', 'THEIA')
    if (!theia) return 'Iris 的 THEIA 只读桥尚未启用。请检查本机配置。'
    const { head, rest: body } = splitCommand(rest)
    if (!head || isCommand(head, 'theia-status', ['状态', 'status', 's'])) return await theiaStatus()
    if (isCommand(head, 'theia-today', ['今天', '今日', 'today', 'now'])) return await theiaToday()
    if (isCommand(head, 'theia-agent', ['agent', '顾问', '问问', 'a'])) return await theiaAgent(body)
    if (isCommand(head, 'theia-motion', ['motion', '运动', '场馆', 'm'])) return await theiaMotion(body)
    if (isCommand(head, 'theia-classroom', ['classroom', '教室', '空闲', 'room', 'c'])) return await theiaClassroom(body)
    if (isCommand(head, 'help', ['help', 'h', '帮助', '?'])) return scopedHelp('theia', '【THEIA · 只读】', 'THEIA：status、today、agent、classroom、motion。')
    return scopedHelp('theia', '【THEIA · 只读】', 'THEIA：status、today、agent、classroom、motion。')
  }

  async function codexCommand(rest, hooks) {
    if (!providerEnabled('codex')) return providerDisabled('codex', 'Codex')
    if (!codex) return 'Iris 的 Codex 桥尚未启用。请确认本机已安装并登录 Codex CLI。'
    const { head, rest: body } = splitCommand(rest)
    if (!head || isCommand(head, 'codex-status', ['status', 'sessions', 'session', 's', 'ss', 'st', 'list', 'ls'])) return formatCodexStatus(await codex.status(), now)
    if (isCommand(head, 'codex-use', ['use', 'select', 'u', '切换'])) {
      if (!/^\d+$/.test(body)) return '格式：codex use <会话序号>。先发送「codex sessions」查看。'
      const session = await codex.select(Number(body))
      const index = Number.isInteger(session?.index) ? session.index : Number(body)
      return `Iris 已切换到 Codex 会话 #${index} · ${compact(session.name, 100)}${session.updatedAt ? ` · ${formatTime(session.updatedAt)}` : ''}\n后续「codex <指令>」会续接这条会话。`
    }
    if (isCommand(head, 'codex-stop', ['stop', 'cancel', 'abort', 'x', '停止', '终止'])) return codex.abort() ? 'Iris 已请求停止当前 Codex 指令。' : '当前没有由 Iris 启动的 Codex 指令。'
    if (isCommand(head, 'help', ['help', 'h', '帮助'])) return scopedHelp('codex', '【Codex】', 'Codex：status/ss 查看状态；use/u <序号> 切换；stop/x 停止；其余文本直接发送给当前会话。')
    if (Object.keys(codex.workspaceNames?.() ?? {}).includes(head.toLowerCase())) return await irisCommand(rest, hooks)
    const instruction = rest.trim()
    const job = await codex.submit(instruction, {
      onComplete: async (result) => hooks?.onCodexComplete?.(result),
    })
    return commandMessage('codexQueued', { task: compact(instruction, 240), sessionState: job.sessionId ? '（续接当前会话）' : '（新建会话）' })
  }

  /**
   * iris <项目名> <指令> — routes to a named workspace from IRIS_CODEX_WORKSPACE_MAP.
   * Falls back to the default workspace when the first word is not a known project name.
   */
  async function irisCommand(rest, hooks) {
    if (!providerEnabled('codex')) return providerDisabled('codex', 'Codex')
    if (!codex) return 'Iris 的 Codex 桥尚未启用。请确认本机已安装并登录 Codex CLI。'
    const { head, rest: body } = splitCommand(rest)
    if (!head) return '请在「iris」后写下项目名称和要推进的事项，例如：iris buct 修复课表解析。'

    // iris is also the short Codex entry point. Reserve its management words
    // so a request such as "iris status" cannot become a task named status.
    if (isCommand(head, 'codex-status', ['status', 'sessions', 'session', 's', 'ss', 'st', 'list', 'ls'])
      || isCommand(head, 'codex-use', ['use', 'select', 'u', '切换'])
      || isCommand(head, 'codex-stop', ['stop', 'cancel', 'abort', 'x', '停止', '终止'])
      || isCommand(head, 'help', ['help', 'h', '帮助'])) {
      return await codexCommand(rest, hooks)
    }

    const knownNames = Object.keys(codex.workspaceNames?.() ?? {})
    const isProjectName = knownNames.includes(head.toLowerCase())

    let workspaceName = ''
    let instruction = rest.trim()
    if (isProjectName) {
      workspaceName = head.toLowerCase()
      instruction = body.trim()
      if (!instruction) return `请在项目名「${head}」后写下要推进的事项。`
    }

    const job = await codex.submit(instruction, {
      workspaceName,
      onComplete: async (result) => hooks?.onCodexComplete?.(result),
    })
    const label = job.workspaceLabel || (isProjectName ? head : '当前工作区')
    return commandMessage('irisQueued', { task: compact(instruction, 240), workspace: label, sessionState: job.sessionId ? '（续接当前会话）' : '（新建会话）' })
  }

  /**
   * hermes [status|sessions|use <n>|stop] <指令>
   * - 无子命令：执行一次性任务（自动续接已选会话）
   * - status/sessions：列出会话和运行状态
   * - use <n>：切换会话
   * - stop：中止正在运行的任务
   */
  async function hermesCommand(rest, hooks) {
    if (!providerEnabled('hermes')) return providerDisabled('hermes', 'Hermes')
    if (!hermes) return 'Iris 的 Hermes 桥尚未启用。请确认本机已安装 Hermes Agent。'
    const { head, rest: body } = splitCommand(rest)

    if (!head || isCommand(head, 'hermes-status', ['status', 'sessions', 'session', 's', 'ss', 'st', 'list', 'ls'])) {
      return formatHermesStatus(await hermes.status())
    }
    if (isCommand(head, 'hermes-use', ['use', 'select', 'u', '切换'])) {
      if (!/^\d+$/.test(body)) return '格式：hermes use <会话序号>。先发送「hermes sessions」查看。'
      const session = await hermes.select(Number(body))
      return `Iris 已切换到 Hermes 会话 · ${compact(session.title, 100)}`
    }
    if (isCommand(head, 'hermes-stop', ['stop', 'cancel', 'abort', 'x', '停止', '终止'])) {
      return hermes.abort() ? 'Iris 已请求停止当前 Hermes 任务。' : '当前没有由 Iris 启动的 Hermes 任务。'
    }
    if (isCommand(head, 'help', ['help', 'h', '帮助'])) return scopedHelp('hermes', '【Hermes】', 'Hermes：sessions/ss 列出会话；use/u <序号> 切换；stop/x 停止任务；其余文本发送给当前会话执行。')

    // Everything else is a task instruction
    const instruction = rest.trim()
    if (!instruction) return '请在「hermes」后写下要执行的任务。'
    const job = await hermes.run(instruction, {
      onComplete: async (result) => {
        try { await hooks?.onHermesComplete?.(result) } catch { /* advisory */ }
      },
    })
    return commandMessage('hermesQueued', { task: compact(instruction, 240), sessionState: job.sessionId ? '（续接当前会话）' : '（新建会话）' })
  }

  async function claudeCommand(rest, hooks) {
    if (!providerEnabled('claude')) return providerDisabled('claude', 'Claude Desktop')
    if (!claude) return 'Claude Desktop 由 Iris 自动监控；请在本机控制台开启或关闭完成通知。'
    const { head, rest: body } = splitCommand(rest)
    if (!head || isCommand(head, 'claude-status', ['status', 's', 'st'])) {
      const status = await claude.status()
      const active = status.activeJobs.length ? `运行中 ${status.activeJobs.length} 项` : '当前没有运行中的任务'
      return `【Iris · Claude Code】\n当前会话：${status.selectedSessionId ? '已选定' : '新建会话'}\n${active}\n\n发送「claude <指令>」执行；发送「claude stop」停止当前任务。`
    }
    if (isCommand(head, 'claude-stop', ['stop', 'cancel', 'abort', 'x', '停止', '终止'])) return claude.abort() ? 'Iris 已请求停止当前 Claude Code 任务。' : '当前没有由 Iris 启动的 Claude Code 任务。'
    if (isCommand(head, 'help', ['help', 'h', '帮助'])) return scopedHelp('claude', '【Claude Code】', 'Claude Code：status 查看状态；stop 停止任务；其余文本发送给当前会话执行。')
    const job = await claude.run(rest.trim(), { onComplete: async (result) => hooks?.onClaudeComplete?.(result) })
    return commandMessage('claudeQueued', { task: compact(rest.trim(), 240), sessionState: job.sessionId ? '（续接当前会话）' : '（新建会话）' })
  }

  return async function dispatch(input, hooks = {}) {
    const { text, head, rest } = splitCommand(input)
    if (!text) return null
    try {
      if (isCommand(head, 'help', ['帮助', 'help', 'h', '?'])) {
        const current = settings()
        return current.commandHelp ? renderCommandHelp(current.commandHelp, { aliases: current.commandAliases, visibleProviders: current.visibleProviders }) : help(current.commandMessages?.help)
      }
      if (isCommand(head, 'theia', ['theia', 'th', '校园'])) {
        try { return await theiaCommand(rest) } catch (error) { return theiaError(error) }
      }
      if (isCommand(head, 'hyperion', ['hyperion', 'hy', 'hp'])) return await hyperionCommand(rest)
      if (isOneOf(head, ['日记', 'diary', 'journal', 'd', 'j', '状态', 'status', 'checkin', 's', '任务', 'task', 'tasks', 't', '完成', 'done', 'complete', 'finish', 'c', '人物', 'people', 'person', 'p', '通道', 'channel', 'channels', 'ai', 'a', '概览', 'summary', 'overview', 'info', 'o'])) {
        return providerEnabled('hyperion')
          ? 'HYPERION 指令已归入二级菜单。请发送「hyperion help」查看，例如「hyperion diary <内容>」。'
          : providerDisabled('hyperion', 'HYPERION')
      }
      if (isCommand(head, 'selene', ['selene', 'se'])) {
        if (!providerEnabled('selene')) return providerDisabled('selene', 'SELENE')
        return await selene()
      }
      if (isCommand(head, 'codex-task', ['codex', 'cx'])) {
        try { return await codexCommand(rest, hooks) } catch (error) { return codexError(error) }
      }
      if (isOneOf(head, ['iris', 'i'])) {
        try { return await irisCommand(rest, hooks) } catch (error) { return codexError(error) }
      }
      if (isCommand(head, 'hermes-task', ['hermes', 'hm'])) {
        try { return await hermesCommand(rest, hooks) } catch (error) { return hermesError(error) }
      }
      if (isCommand(head, 'claude-task', ['claude', 'cc'])) {
        try { return await claudeCommand(rest, hooks) } catch (error) { return `Claude Code 无法启动：${String(error?.message ?? '未知错误').slice(0, 300)}` }
      }
      return '未识别的指令「' + compact(head, 80) + '」。发送「帮助」查看可用指令；要交给 Codex 请发送「codex <任务>」。'
    } catch (error) {
      return commandError(error)
    }
  }
}
