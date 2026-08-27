/** Pure command router. It receives narrow local clients rather than data files. */

import { DEFAULT_COMMAND_MESSAGES, renderCommandHelp, renderCommandMessage } from './settings.mjs'
import { classifyCodexFailure } from './codex.mjs'
import { THEIA_READABLE_DOMAINS } from './theia.mjs'

const replyLimit = 3_800

function compact(value, maximum = 260) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ')
  return text.length > maximum ? `${text.slice(0, Math.max(1, maximum - 1))}...` : text
}

function formatTime(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '未标注'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai',
  }).format(new Date(value))
}

function formatClock(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '时间未标注'
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai',
  }).format(new Date(value))
}

function safeReply(lines) {
  return lines.join('\n').slice(0, replyLimit)
}

function commandError(error) {
  const message = String(error?.message ?? '')
  if (message.includes('fetch failed') || message.includes('ECONNREFUSED')) return 'HYPERION 本机服务未响应。请先启动 HYPERION 桌面版。'
  if (message.includes('尚未初始化')) return 'HYPERION 尚未初始化。请先启动一次 HYPERION 桌面版。'
  return '操作未完成。请检查 HYPERION 是否仍在运行后重试。'
}

function theiaError(error) {
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

function codexError(error) {
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

function hermesError(error) {
  const message = String(error?.message ?? '')
  if (/already has a running/i.test(message)) return 'Iris 已有一项正在执行的 Hermes 指令。请等待完成后再发送。'
  if (/instruction is empty/i.test(message)) return '请在「hermes」后写下要执行的任务。'
  if (/exceeds/i.test(message)) return '这条 Hermes 指令过长。请拆成更明确的几条消息。'
  if (/timed out/i.test(message)) return 'Hermes 本次任务超时。请确认 Hermes Agent 正常后重试。'
  return 'Iris 无法启动本机 Hermes。请确认 Hermes Agent 已安装且可运行。'
}

function splitCommand(input) {
  const text = String(input ?? '').trim()
  const divider = text.search(/\s/)
  if (divider < 0) return { text, head: text, rest: '' }
  return { text, head: text.slice(0, divider), rest: text.slice(divider).trim() }
}

function isOneOf(value, aliases) {
  const normalized = String(value ?? '').toLowerCase()
  return aliases.includes(normalized)
}

function transportLabel(value) {
  if (value === 'desktop-ipc') return '桌面 IPC'
  if (value === 'cli') return 'Codex CLI'
  return '准备中'
}

function formatCodexStatus(status = {}, clock = () => Date.now()) {
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

function formatHermesStatus(status) {
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

  const theiaDomainLabels = Object.freeze({
    courses: '课程',
    schedule: '课表',
    grades: '成绩',
    exams: '考试',
    'selected-courses': '已选课程',
    assignments: '作业',
    notices: '通知',
    'academic-progress': '学业进度',
    'academic-extras': '教务资料',
  })

  function theiaSections(overview) {
    return [...(overview?.sections ?? []), ...(overview?.extraDomains ?? [])]
      .filter((section) => theiaDomainLabels[section?.domain])
  }

  function theiaSection(overview, domain) {
    return theiaSections(overview).find((section) => section.domain === domain) ?? null
  }

  function theiaQuality(section) {
    if (!section) return '状态未知'
    if (section.completeness === 'complete') return '完整'
    if (section.completeness === 'partial') return '部分'
    if (section.completeness === 'unknown') return '未知'
    return compact(section.statusLabel || section.status || '状态未知', 30)
  }

  function theiaSyncLines(overview, domain = null) {
    const sync = overview?.sync ?? {}
    const section = domain ? theiaSection(overview, domain) : null
    const lines = []
    if (sync.lastSuccessAt && Number.isFinite(Date.parse(sync.lastSuccessAt))) {
      lines.push(`最近成功同步：${formatTime(sync.lastSuccessAt)}`)
    } else {
      lines.push('注意：尚无成功同步记录，空结果不能解释为没有数据。')
    }
    if (sync.lastRunAt && Number.isFinite(Date.parse(sync.lastRunAt))
      && (!sync.lastSuccessAt || Date.parse(sync.lastRunAt) > Date.parse(sync.lastSuccessAt))) {
      lines.push('注意：最近一次同步尝试尚未形成新的成功水位。')
    }
    if (section) {
      lines.push(`${section.label || theiaDomainLabels[domain]}：${section.count ?? 0} 条 · ${theiaQuality(section)}${section.stale ? ' · 可能过期' : ''}`)
      if (section.status === 'not-read') lines.push('注意：该数据域尚未成功读取，空结果不能解释为没有数据。')
      if (section.status === 'auth-required') lines.push('注意：该数据域需要在 THEIA 中重新登录。')
      if (section.status === 'failed') lines.push('注意：该数据域最近读取失败，当前结果可能不完整。')
      if (section.retainedPrevious) lines.push('注意：本轮读取失败，当前显示沿用了上一次保留数据。')
      if (section.completeness === 'partial') lines.push('注意：该数据域只完成了部分读取。')
    } else if (sync.lastError) {
      lines.push('注意：最近同步存在未完成来源，当前显示可能不完整。')
    }
    return lines
  }

  function chinaDayBounds() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai',
    }).formatToParts(now()).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
    const start = Date.parse(`${parts.year}-${parts.month}-${parts.day}T00:00:00+08:00`)
    return { start, end: start + 24 * 60 * 60 * 1_000 }
  }

  function dated(value) {
    const timestamp = Date.parse(value ?? '')
    return Number.isFinite(timestamp) ? timestamp : null
  }

  function recordTitle(item) {
    const title = item?.title || item?.label || item?.name || '未命名记录'
    const course = item?.courseName
    return compact(course && title !== course ? `${course} · ${title}` : course || title, 130)
  }

  function courseTitle(item) {
    const title = item?.title || item?.label || item?.courseName || '未命名课程'
    const course = item?.courseName
    const name = course && title !== course ? `${course} · ${title}` : title
    return item?.courseCode ? `${compact(item.courseCode, 30)} · ${compact(name, 100)}` : compact(name, 130)
  }

  function displayNumber(value) {
    return value === null || value === undefined || value === '' ? '未提供' : compact(value, 40)
  }

  function chinaWeekday() {
    const { start } = chinaDayBounds()
    const day = new Date(start).getUTCDay()
    return day === 0 ? 7 : day
  }

  function scheduleWeekday(value) {
    const raw = String(value ?? '').trim().toLowerCase()
    const numeric = Number(raw)
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 7) return numeric
    const match = raw.match(/(?:星期|周|礼拜)?([一二三四五六日天])/u)
    if (!match) return null
    return { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }[match[1]] ?? null
  }

  async function theiaStatus() {
    const [overview, assignments, exams, progress, analysis, plan] = await Promise.all([
      theia.overview(),
      theia.assignments({ scope: 'current', limit: 100 }),
      theia.exams({ scope: 'current', limit: 100 }),
      theia.academicProgress(),
      theia.academicAnalysis(),
      theia.academicPlanDocument(),
    ])
    const sections = theiaSections(overview)
    const relevant = THEIA_READABLE_DOMAINS.map((domain) => theiaSection(overview, domain)).filter(Boolean)
    const pendingAssignments = (assignments?.items ?? []).filter((item) => !['submitted', 'completed'].includes(item?.status)).length
    const upcomingExams = (exams?.items ?? []).filter((item) => {
      const at = dated(item?.startAt || item?.examTime)
      return at === null || at >= chinaDayBounds().start
    }).length
    const progressItem = progress?.item
    const analysisItem = analysis?.item
    const planItem = plan?.item
    return safeReply([
      '【THEIA · 状态】',
      '本机只读接口：已连接',
      `当前学期：${overview.currentTerm?.label || '未标注'}`,
      `数据域：${relevant.map((section) => `${section.label || theiaDomainLabels[section.domain]} ${section.count ?? 0}`).join(' · ')}`,
      `质量：${relevant.map((section) => `${section.label || theiaDomainLabels[section.domain]} ${theiaQuality(section)}${section.stale ? '（旧）' : ''}${section.retainedPrevious ? '（沿用旧数据）' : ''}`).join(' · ')}`,
      `近期事项：待处理作业 ${pendingAssignments} · 后续考试 ${upcomingExams}`,
      ...(progressItem ? [`学业进度：${progressItem.gpa !== undefined ? `GPA ${displayNumber(progressItem.gpa)}` : 'GPA 未提供'}${progressItem.program ? ` · ${compact(progressItem.program, 100)}` : ''}`] : ['学业进度：暂无可确认数据']),
      ...(analysisItem ? [`学业分析：${analysisItem.gpa?.value !== undefined ? `GPA ${displayNumber(analysisItem.gpa.value)}` : 'GPA 未提供'}${analysisItem.creditLedger?.earnedCredits !== undefined ? ` · 已获学分 ${displayNumber(analysisItem.creditLedger.earnedCredits)}` : ''}`] : ['学业分析：暂无可确认数据']),
      ...(planItem ? [`培养计划：${compact(planItem.title || planItem.sourceFilename || '已读取元数据', 120)}${planItem.minimumGraduationCredits !== undefined ? ` · 毕业学分 ${displayNumber(planItem.minimumGraduationCredits)}` : ''}`] : ['培养计划：暂无可确认数据']),
      ...(sections.length > relevant.length ? [`其它可读域：${sections.filter((section) => !THEIA_READABLE_DOMAINS.includes(section.domain)).map((section) => `${section.label} ${section.count ?? 0}`).join(' · ')}`] : []),
      ...theiaSyncLines(overview),
    ])
  }

  async function theiaToday() {
    const [overview, schedule, assignments, exams] = await Promise.all([
      theia.overview(),
      theia.schedule({ scope: 'current', limit: 100 }),
      theia.assignments({ scope: 'current', limit: 100 }),
      theia.exams({ scope: 'current', limit: 100 }),
    ])
    const { start, end } = chinaDayBounds()
    const rows = []
    for (const item of schedule?.items ?? []) {
      const at = dated(item.startAt)
      const recurringToday = scheduleWeekday(item.weekday) === chinaWeekday()
      if ((at !== null && at >= start && at < end) || (at === null && recurringToday)) {
        const time = at === null ? compact(item.time || item.period || '时间待确认', 50) : formatClock(item.startAt)
        rows.push({ at: at ?? start + 86_400_000, text: `${time} · 课程 · ${courseTitle(item)}` })
      }
    }
    for (const item of exams?.items ?? []) {
      const value = item.startAt
      const at = dated(value)
      if (at !== null && at >= start && at < end) rows.push({ at, text: `${formatClock(value)} · 考试 · ${courseTitle(item)}` })
    }
    for (const item of assignments?.items ?? []) {
      const at = dated(item.dueAt)
      if (!['submitted', 'completed'].includes(item.status) && at !== null && at >= start && at < end) rows.push({ at, text: `${formatClock(item.dueAt)} · 截止 · ${recordTitle(item)}` })
    }
    rows.sort((left, right) => left.at - right.at)
    return safeReply([
      '【THEIA · 今天】',
      ...(rows.length ? rows.slice(0, 12).map((item) => `· ${item.text}`) : ['当前数据域没有可确认的今日日程；这不等于学校系统明确无安排。']),
      ...(rows.length > 12 ? [`另有 ${rows.length - 12} 项，请在 THEIA 桌面端查看。`] : []),
      ...theiaSyncLines(overview),
      ...['schedule', 'assignments', 'exams'].flatMap((domain) => theiaSyncLines(overview, domain).slice(1)),
      ...(rows.some((item) => item.text.includes('时间待确认')) ? ['注意：部分课表只有星期/节次，没有可换算的具体时刻。'] : []),
    ])
  }

  async function theiaTasks() {
    const [overview, response] = await Promise.all([theia.overview(), theia.assignments({ scope: 'current', limit: 100 })])
    const items = (response?.items ?? []).filter((item) => {
      return !['submitted', 'completed'].includes(item?.status)
    }).sort((left, right) => (dated(left.dueAt) ?? Infinity) - (dated(right.dueAt) ?? Infinity))
    return safeReply([
      '【THEIA · 待处理作业】',
      ...(items.length ? items.slice(0, 10).map((item, index) => {
        const status = item.status && item.status !== 'pending' ? ` · ${compact(item.statusLabel || item.status, 30)}` : ''
        return `${index + 1}. ${recordTitle(item)} · 截止 ${formatTime(item.dueAt)}${status}`
      }) : ['当前数据域未列出尚未完成的作业。']),
      ...(items.length > 10 ? [`另有 ${items.length - 10} 项，请在 THEIA 桌面端查看。`] : []),
      ...theiaSyncLines(overview, 'assignments'),
    ])
  }

  async function theiaExams() {
    const [overview, response] = await Promise.all([theia.overview(), theia.exams({ scope: 'current', limit: 100 })])
    const today = chinaDayBounds().start
    const items = (response?.items ?? []).filter((item) => {
      const at = dated(item.startAt || item.examTime)
      return at === null || at >= today
    }).sort((left, right) => (dated(left.startAt || left.examTime) ?? Infinity) - (dated(right.startAt || right.examTime) ?? Infinity))
    return safeReply([
      '【THEIA · 考试】',
      ...(items.length ? items.slice(0, 10).map((item, index) => {
        const time = dated(item.startAt || item.examTime) === null ? `时间待确认：${compact(item.examTime || '未提供', 80)}` : formatTime(item.startAt || item.examTime)
        return `${index + 1}. ${courseTitle(item)} · ${time}${item.status && item.status !== 'upcoming' ? ` · ${compact(item.statusLabel || item.status, 30)}` : ''}`
      }) : ['当前数据域未列出可确认的后续考试。']),
      ...(items.length > 10 ? [`另有 ${items.length - 10} 项，请在 THEIA 桌面端查看。`] : []),
      ...theiaSyncLines(overview, 'exams'),
    ])
  }

  async function theiaDomainOverview() {
    const overview = await theia.overview()
    return safeReply([
      '【THEIA · 数据域】',
      ...theiaSections(overview).map((section) => `${section.label || theiaDomainLabels[section.domain]}：${section.count ?? 0} 条 · ${theiaQuality(section)}${section.stale ? ' · 可能过期' : ''}${section.retainedPrevious ? ' · 沿用旧数据' : ''}`),
      ...theiaSyncLines(overview),
    ])
  }

  async function theiaCourses() {
    const [overview, response] = await Promise.all([theia.overview(), theia.courses({ scope: 'current', limit: 100 })])
    const items = response?.items ?? []
    return safeReply(['【THEIA · 课程】', ...(items.length ? items.slice(0, 12).map((item, index) => `${index + 1}. ${courseTitle(item)}${item.credits !== undefined ? ` · ${displayNumber(item.credits)} 学分` : ''}${item.teacher ? ` · ${compact(item.teacher, 50)}` : ''}`) : ['当前数据域没有可确认的课程记录。']), ...(items.length > 12 ? [`另有 ${items.length - 12} 项，请在 THEIA 桌面端查看。`] : []), ...theiaSyncLines(overview, 'courses')])
  }

  async function theiaGrades() {
    const [overview, response] = await Promise.all([theia.overview(), theia.grades({ scope: 'current', limit: 100 })])
    const items = response?.items ?? []
    return safeReply(['【THEIA · 成绩】', ...(items.length ? items.slice(0, 12).map((item, index) => `${index + 1}. ${courseTitle(item)} · 成绩 ${displayNumber(item.score)}${item.point !== undefined ? ` · 绩点 ${displayNumber(item.point)}` : ''}${item.statusLabel ? ` · ${compact(item.statusLabel, 30)}` : ''}`) : ['当前数据域没有可确认的成绩记录。']), ...(items.length > 12 ? [`另有 ${items.length - 12} 项，请在 THEIA 桌面端查看。`] : []), ...theiaSyncLines(overview, 'grades')])
  }

  async function theiaSelectedCourses() {
    const [overview, response] = await Promise.all([theia.overview(), theia.selectedCourses({ scope: 'current', limit: 100 })])
    const items = response?.items ?? []
    return safeReply(['【THEIA · 已选课程】', ...(items.length ? items.slice(0, 12).map((item, index) => `${index + 1}. ${courseTitle(item)}${item.credits !== undefined ? ` · ${displayNumber(item.credits)} 学分` : ''}${item.statusLabel ? ` · ${compact(item.statusLabel, 30)}` : ''}`) : ['当前数据域没有可确认的已选课程记录。']), ...(items.length > 12 ? [`另有 ${items.length - 12} 项，请在 THEIA 桌面端查看。`] : []), ...theiaSyncLines(overview, 'selected-courses')])
  }

  async function theiaNotices() {
    const [overview, response] = await Promise.all([theia.overview(), theia.notices({ scope: 'all', limit: 100 })])
    const items = response?.items ?? []
    return safeReply(['【THEIA · 通知】', ...(items.length ? items.slice(0, 10).map((item, index) => `${index + 1}. ${recordTitle(item)}${item.publishedAt ? ` · ${formatTime(item.publishedAt)}` : ''}${item.statusLabel ? ` · ${compact(item.statusLabel, 30)}` : ''}${item.summary ? `\n   ${compact(item.summary, 150)}` : ''}`) : ['当前数据域没有可确认的通知记录。']), ...(items.length > 10 ? [`另有 ${items.length - 10} 项，请在 THEIA 桌面端查看。`] : []), ...theiaSyncLines(overview, 'notices')])
  }

  async function theiaAcademicProgress() {
    const [overview, response] = await Promise.all([theia.overview(), theia.academicProgress()])
    const item = response?.item
    const counts = item?.courseCounts ?? {}
    const countParts = Object.entries(counts).flatMap(([key, value]) => {
      if (!value || typeof value !== 'object') return []
      const label = { planned: '计划', completed: '完成', passed: '通过', notTaken: '未修' }[key] || key
      const total = value.total ?? value.count
      return total === undefined ? [] : [`${label} ${total}`]
    })
    return safeReply(['【THEIA · 学业进度】', item ? `专业：${compact(item.program || '未标注', 150)}` : '当前没有可确认的学业进度记录。', item?.gpa !== undefined ? `GPA：${displayNumber(item.gpa)}` : '', countParts.length ? `课程统计：${countParts.join(' · ')}` : '', item?.roots?.length ? `培养要求树：${item.roots.length} 个一级节点` : '', ...theiaSyncLines(overview, 'academic-progress')].filter(Boolean))
  }

  async function theiaAcademicAnalysis() {
    const [overview, response] = await Promise.all([theia.overview(), theia.academicAnalysis()])
    const item = response?.item
    const ledger = item?.creditLedger ?? {}
    const courseCount = Array.isArray(item?.courses) ? item.courses.length : null
    return safeReply(['【THEIA · 学业分析】', item ? `GPA：${displayNumber(item.gpa?.value)} · 来源 ${compact(item.gpa?.source || '未知', 30)}` : '当前没有可确认的学业分析。', ledger.earnedCredits !== undefined ? `已获学分：${displayNumber(ledger.earnedCredits)}` : '', ledger.requiredCredits !== undefined ? `要求学分：${displayNumber(ledger.requiredCredits)}` : '', courseCount === null ? '' : `纳入分析课程：${courseCount}`, ...theiaSyncLines(overview, 'academic-progress')].filter(Boolean))
  }

  async function theiaAcademicPlan() {
    const [overview, response] = await Promise.all([theia.overview(), theia.academicPlanDocument()])
    const item = response?.item
    return safeReply(['【THEIA · 培养计划】', item ? `标题：${compact(item.title || item.sourceFilename || '当前培养计划', 180)}` : '当前没有可确认的培养计划文档。', item?.durationYears !== null && item?.durationYears !== undefined ? `学制：${displayNumber(item.durationYears)} 年` : '', item?.minimumGraduationCredits !== null && item?.minimumGraduationCredits !== undefined ? `最低毕业学分：${displayNumber(item.minimumGraduationCredits)}` : '', item?.pageCount ? `文档页数：${displayNumber(item.pageCount)}` : '', item ? 'Iris 只返回培养计划元数据，不转发 PDF、页面正文、本地路径或附件。' : '', ...theiaSyncLines(overview, 'academic-extras')].filter(Boolean))
  }

  let theiaAgentThreadId = ''

  async function theiaAgent(question) {
    const message = String(question ?? '').trim()
    if (!message) return '格式：theia agent <问题>，例如「theia agent 我今天有哪些需要优先处理的事？」'
    if (typeof theia.agent !== 'function') return '当前 THEIA 版本尚未提供 Agent 对话接口，请先更新 THEIA。'
    const result = await theia.agent(message, { threadId: theiaAgentThreadId || undefined })
    if (result?.threadId) theiaAgentThreadId = result.threadId
    const answer = String(result?.answer || '').trim()
    return safeReply(['【THEIA · Agent】', answer || 'Agent 没有返回可展示的回答。'])
  }

  // `theia classroom <节次>` — live query the free-classroom table for one
  // period (节次) and render a PNG grouped by building. The period argument is
  // required: "theia classroom 1" = 第一节课.
  async function theiaClassroom(rest = '') {
    if (typeof theia.classroomTableImage !== 'function') return '当前 THEIA 版本尚未提供空闲教室图片接口，请先更新 THEIA。'
    const periodArg = String(rest || '').trim().split(/\s+/)[0] || ''
    // Accept a single period ("1") or a range ("3-4", "3-5", "3-6").
    const rangeMatch = periodArg.match(/^(\d{1,2})\s*[-~至]\s*(\d{1,2})$/u)
    const singleMatch = periodArg.match(/^\d{1,2}$/u)
    if (!rangeMatch && !singleMatch) {
      return '格式：theia classroom <节次>，例如「theia classroom 1」或「theia classroom 3-5」查看第3到第5节的空闲教室。'
    }
    let periods
    if (rangeMatch) {
      const start = Number(rangeMatch[1])
      const end = Number(rangeMatch[2])
      if (start < 1 || end > 20 || start > end) return '节次范围无效，请使用 1-20 之间的升序范围，例如「theia classroom 3-5」。'
      periods = Array.from({ length: end - start + 1 }, (_item, index) => String(start + index)).join(',')
    } else {
      const n = Number(singleMatch[0])
      if (n < 1 || n > 20) return '节次无效，请使用 1-20 之间的数字。'
      periods = String(n)
    }
    const label = periods.includes(',') ? `第${periods.replace(/,/g, '-')}节` : `第${periods}节`
    const png = await theia.classroomTableImage({ periods })
    if (png && png.length) {
      return { type: 'image', mime: 'image/png', data: png.toString('base64'), fileName: 'free-classroom.png', text: `【THEIA · 空闲教室 · ${label}】` }
    }
    const overview = await theia.overview()
    const extra = Array.isArray(overview?.extraDomains)
      ? overview.extraDomains.find((item) => item.domain === 'free-classroom')
      : null
    if (extra) return safeReply(['【THEIA · 空闲教室】', `已缓存 ${extra.count} 条结果 · ${extra.label || '空闲教室'}`, `最近查询：${extra.capturedAt ? formatTime(extra.capturedAt) : '未标注'}`, '实时查询不可用，请在 THEIA 桌面端「工具 · 空闲教室」查看表格。', ...theiaSyncLines(overview, 'academic-extras')])
    return safeReply(['【THEIA · 空闲教室】', '当前没有已缓存的空闲教室记录。请先在 THEIA 桌面端「工具 · 空闲教室」查询一次。', ...theiaSyncLines(overview, 'academic-extras')])
  }

  // `theia motion` — render the latest venue status table as a PNG
  async function theiaMotion(rest) {
    const { head: project } = splitCommand(rest)
    if (!project) return '格式：theia motion <运动项目>，例如「theia motion 羽毛球 获取今天羽毛球的状态表」。'
    if (typeof theia.motionTableImage !== 'function') return '当前 THEIA 版本尚未提供运动场馆图片接口，请先更新 THEIA。'
    const png = await theia.motionTableImage(project)
    if (png && png.length) {
      return { type: 'image', mime: 'image/png', data: png.toString('base64'), fileName: 'motion-venue.png', text: `【THEIA · 运动 · ${compact(project, 80)}】最新场馆状态如下：` }
    }
    // Fall back to text when image rendering is unavailable.
    try {
      const result = await theia.motion(project)
      const statuses = Array.isArray(result?.statuses) ? result.statuses : []
      const venues = Array.isArray(result?.venues) ? result.venues : []
      const lines = [`【THEIA · 运动 · ${compact(result?.project || project, 80)}】`, '图片渲染不可用，以下为文字版：']
      if (!statuses.length) {
        lines.push('今天没有已缓存的状态表。请先在 THEIA 中刷新运动场馆数据后重试。')
        if (venues.length) lines.push(`可查询来源：${venues.slice(0, 6).map((venue) => `${venue.campusLabel || '未标注校区'} · ${venue.label || venue.activity}`).join('；')}`)
        return safeReply(lines)
      }
      for (const status of statuses.slice(0, 8)) {
        const query = status?.query || {}
        lines.push(`${query.campus?.label || '未标注校区'} · ${query.venue || result.project} · ${query.date || result.date}`)
        const tables = Array.isArray(status?.availability?.tables) ? status.availability.tables : []
        for (const table of tables) {
          for (const slot of Array.isArray(table?.slots) ? table.slots : []) {
            const courts = Array.isArray(slot?.courts) ? slot.courts : []
            const cells = courts.map((court) => `${court.court || '场地'} ${court.status || court.state || '未知'}`).join('、')
            lines.push(`  ${slot.time || '时间未标注'}：${cells || '暂无场地明细'}`)
          }
        }
        if (status.cachedAt) lines.push(`  数据时间：${formatTime(status.cachedAt)}${status.fromCache ? ' · 本机缓存' : ''}`)
      }
      if (statuses.length > 8) lines.push(`另有 ${statuses.length - 8} 张状态表，请在 THEIA 中查看。`)
      return safeReply(lines)
    } catch (error) {
      return theiaError(error)
    }
  }

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
