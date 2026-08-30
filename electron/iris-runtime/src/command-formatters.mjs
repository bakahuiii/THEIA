import { DEFAULT_COMMAND_MESSAGES, renderCommandHelp, renderCommandMessage } from './settings.mjs'
import { classifyCodexFailure } from './codex.mjs'

export const replyLimit = 3_800

export function compact(value, maximum = 260) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ')
  return text.length > maximum ? `${text.slice(0, Math.max(1, maximum - 1))}...` : text
}

export function formatTime(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '未标注'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai',
  }).format(new Date(value))
}

export function formatClock(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '时间未标注'
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai',
  }).format(new Date(value))
}

export function safeReply(lines) {
  return lines.join('\n').slice(0, replyLimit)
}

export function commandError(error) {
  const message = String(error?.message ?? '')
  if (message.includes('fetch failed') || message.includes('ECONNREFUSED')) return 'HYPERION 本机服务未响应。请先启动 HYPERION 桌面版。'
  if (message.includes('尚未初始化')) return 'HYPERION 尚未初始化。请先启动一次 HYPERION 桌面版。'
  return '操作未完成。请检查 HYPERION 是否仍在运行后重试。'
}

export function theiaError(error) {
  if (error?.code === 'THEIA_NOT_RUNNING') return 'THEIA 桌面端或本机数据接口未运行。请先启动 THEIA 桌面版。'
  if (error?.code === 'THEIA_TIMEOUT') return 'THEIA 本机数据接口响应超时。请确认桌面端仍在运行后重试。'
  if (error?.code === 'THEIA_INVALID_CONFIG') return 'THEIA 本机接口配置无效。请在 Iris 控制台检查数据目录或 loopback 地址。'
  if (error?.code === 'THEIA_SCHEMA_MISMATCH') return 'THEIA 返回了 Iris 无法识别的数据版本。请更新两个项目后重试。'
  if (error?.code === 'THEIA_MOTION_PROJECT_REQUIRED') return '请在「theia motion」后写下运动项目，例如「theia motion 羽毛球」。'
  if (error?.code === 'THEIA_AGENT_QUESTION_REQUIRED') return '请在「theia agent」后写下要咨询的问题。'
  if (error?.code === 'THEIA_AGENT_BUSY') return '当前 THEIA Agent 正在生成回答，请稍后重试。'
  if (error?.code === 'THEIA_AGENT_UNAVAILABLE') return 'THEIA Agent 当前不可用，请先在 THEIA 中配置模型后重试。'
  return 'THEIA 本机数据接口未响应。请确认桌面端仍在运行后重试。'
}

export function codexError(error) {
  const message = String(error?.message ?? '')
  const failure = classifyCodexFailure(error)
  if (failure.code !== 'PROCESS_ERROR') return failure.text
  if (/already has a running/i.test(message)) return 'Iris 已有一项正在执行的 Codex 指令。发送「codex status」查看，或发送「codex stop」停止等待。'
  if (/instruction is empty/i.test(message)) return '请在「codex」或「iris」后写下要推进的事项。'
  if (/exceeds/i.test(message)) return '这条 Codex 指令过长。请拆成更明确的几条消息。'
  if (/workspace is unavailable/i.test(message)) return 'Iris 配置的 Codex 工作区已不存在。请更新本机 IRIS_CODEX_WORKSPACE 后重试。'
  if (/CLI was not found/i.test(message)) return 'Iris 未找到本机 Codex CLI。请检查 IRIS_CODEX_ENTRY 或重新安装 Codex 后重试。'
  if (/No direct Codex session/i.test(message)) return '没有可用的 Codex 对话。请先在本机打开一个 Codex 任务。'
  return 'Iris 无法连接本机 Codex。请确认 Codex CLI 已登录且仍可运行。'
}

export function hermesError(error) {
  const message = String(error?.message ?? '')
  if (/already has a running/i.test(message)) return 'Iris 已有一项正在执行的 Hermes 指令。请等待完成后再发送。'
  if (/instruction is empty/i.test(message)) return '请在「hermes」后写下要执行的任务。'
  if (/exceeds/i.test(message)) return '这条 Hermes 指令过长。请拆成更明确的几条消息。'
  if (/timed out/i.test(message)) return 'Hermes 本次任务超时。请确认 Hermes Agent 正常后重试。'
  return 'Iris 无法启动本机 Hermes。请确认 Hermes Agent 已安装且可运行。'
}

export function splitCommand(input) {
  const text = String(input ?? '').trim()
  const divider = text.search(/\s/)
  if (divider < 0) return { text, head: text, rest: '' }
  return { text, head: text.slice(0, divider), rest: text.slice(divider).trim() }
}

export function isOneOf(value, aliases) {
  const normalized = String(value ?? '').toLowerCase()
  return aliases.includes(normalized)
}

export function transportLabel(value) {
  if (value === 'desktop-ipc') return '桌面 IPC'
  if (value === 'cli') return 'Codex CLI'
  return '准备中'
}

export function formatCodexStatus(status = {}, clock = () => Date.now()) {
  const sessions = Array.isArray(status.sessions) ? status.sessions : []
  const activeJobs = Array.isArray(status.activeJobs) ? status.activeJobs : []
  const selectedIndex = status.selected ? sessions.findIndex((item) => item.id === status.selected.id) + 1 : 0
  const current = new Date(clock()).getTime()
  const now = Number.isFinite(current) ? current : Date.now()
  const activeDetails = activeJobs.map((job) => {
    const started = Date.parse(job.startedAt)
    const elapsedSeconds = Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1_000)) : 0
    const elapsed = elapsedSeconds >= 60
      ? [Math.floor(elapsedSeconds / 60), ' 分 ', elapsedSeconds % 60, ' 秒'].join('')
      : String(elapsedSeconds) + ' 秒'
    const task = compact(job.taskName || '未命名任务', 100)
    const workspace = compact(job.workspaceLabel || status.workspaceLabel || '未标注工作区', 60)
    return ['当前任务：', task, '\n进度：', job.stage || '正在运行', ' · ', workspace, ' · ', transportLabel(job.transport), ' · 已运行 ', elapsed].join('')
  })
  return safeReply([
    '【Iris · Codex】',
    status.selected ? `当前会话：${selectedIndex > 0 ? `#${selectedIndex}` : '已固定'} · ${compact(status.selected.name, 100)}` : '当前会话：新建会话',
    activeJobs.length ? 'Iris 运行中：' + activeJobs.length + ' 项' : '当前状态：空闲 · 可直接发送「codex <任务>」',
    ...activeDetails,
    ...(sessions.length ? sessions.slice(0, 20).map((item, index) => `${item.id === status.selected?.id ? '>' : '·'} ${index + 1}. ${compact(item.name, 100)}${item.updatedAt ? ` · ${formatTime(item.updatedAt)}` : ''}`) : ['暂无可选 Codex 会话']),
    '发送「codex use 1」切换会话；发送「codex <指令>」让 Codex 推进任务。',
  ])
}

export function formatHermesStatus(status) {
  const selectedIndex = status.selected
    ? status.sessions.findIndex((item) => item.id === status.selected.id) + 1
    : 0
  const now = Date.now()
  const active = status.activeJobs.map((job) => {
    const started = Date.parse(job.startedAt)
    const elapsedSeconds = Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1_000)) : 0
    const elapsed = elapsedSeconds >= 60 ? `${Math.floor(elapsedSeconds / 60)} 分 ${elapsedSeconds % 60} 秒` : `${elapsedSeconds} 秒`
    return `进行中：已运行 ${elapsed}`
  })
  return safeReply([
    '【Iris · Hermes】',
    status.selected
      ? `当前会话：${selectedIndex > 0 ? `#${selectedIndex}` : '已固定'} · ${compact(status.selected.title, 80)}${status.selected.workspace ? ` · ${compact(status.selected.workspace, 40)}` : ''}`
      : '当前会话：新建会话',
    `Iris 运行中：${status.activeJobs.length} 项`,
    ...active,
    ...status.sessions.slice(0, 6).map((item, index) => {
      const marker = item.id === status.selected?.id ? '>' : '·'
      const ws = item.workspace ? ` · ${compact(item.workspace, 30)}` : ''
      const time = item.updatedAt ? ` · ${item.updatedAt}` : ''
      return `${marker} ${index + 1}. ${compact(item.title, 80)}${ws}${time}`
    }),
    '发送「hermes use 1」切换；发送「hermes <指令>」续接当前会话；发送「hermes stop」停止。',
  ])
}

export function help(value = DEFAULT_COMMAND_MESSAGES.help) {
  return String(value ?? DEFAULT_COMMAND_MESSAGES.help).trim().slice(0, replyLimit)
}

export function renderHelp(config, variables) {
  return renderCommandHelp(config, variables)
}

export function commandMessage(config, variables) {
  return renderCommandMessage(config, variables)
}

export function parseCheckIn(text) {
  const raw = text.trim()
  if (!raw) return null
  const [fieldsPart, notePart] = raw.split(/\s*[|｜]\s*/, 2)
  const fields = {}
  const tokens = fieldsPart.split(/\s+/).filter(Boolean)
  for (const token of tokens) {
    if (fields.mood === undefined && /^[1-5]$/.test(token)) {
      fields.mood = Number(token)
      continue
    }
    const sleep = token.match(/^(?:睡眠|睡|sleep)[:：]?(\d+(?:\.\d+)?)$/i)
    if (sleep) {
      fields.sleepHours = Number(sleep[1])
      continue
    }
    if (fields.sleepHours === undefined && /^\d+(?:\.\d+)?$/.test(token)) {
      fields.sleepHours = Number(token)
      continue
    }
    const medication = token.match(/^(?:药|药物|med)[:：](是|否|减|未知|yes|no|reduced|unknown)$/i)
    if (medication) {
      fields.medication = { 是: 'yes', 否: 'no', 减: 'reduced', 未知: 'unknown', yes: 'yes', no: 'no', reduced: 'reduced', unknown: 'unknown' }[medication[1].toLowerCase()]
      continue
    }
    const alcohol = token.match(/^(?:酒|alcohol)[:：](无|少|多|未知|none|low|high|unknown)$/i)
    if (alcohol) {
      fields.alcohol = { 无: 'none', 少: 'low', 多: 'high', 未知: 'unknown', none: 'none', low: 'low', high: 'high', unknown: 'unknown' }[alcohol[1].toLowerCase()]
      continue
    }
    const focus = token.match(/^(?:做|重点|focus)[:：](.+)$/i)
    if (focus) fields.mainFocus = focus[1]
  }
  if (notePart?.trim()) fields.note = notePart.trim()
  return Object.keys(fields).length ? fields : null
}
