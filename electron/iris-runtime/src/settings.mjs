import process from 'node:process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const irisDirectory = resolve(process.env.IRIS_HOME || resolve(dirname(fileURLToPath(import.meta.url)), '..'))
const settingsPath = resolve(irisDirectory, '.iris-settings.json')
const envPath = resolve(irisDirectory, '.env')

export const COMMAND_DEFINITIONS = [
  { id: 'help', name: '帮助', triggers: '帮助 / help / h', usage: '帮助', description: '查看当前可用的全部指令。', group: 'root' },
  { id: 'theia', name: 'THEIA', triggers: 'theia / th / 校园', usage: 'theia <二级指令>', description: '只读查看 THEIA 校园数据、同步状态和近期事项。', group: 'root' },
  { id: 'hyperion', name: 'HYPERION', triggers: 'hyperion / hy / hp', usage: 'hyperion <二级指令>', description: '访问日记、状态、任务、人物和数据概览。', group: 'root' },
  { id: 'selene', name: 'SELENE', triggers: 'selene / se', usage: 'selene', description: '查看独立的 SELENE 设备使用时间线摘要。', group: 'root' },
  { id: 'theia-status', name: 'THEIA 状态', triggers: 'theia status', usage: 'theia status', description: '查看桌面端、本机 API、同步、数据域和学业概况。', group: 'theia' },
  { id: 'theia-today', name: 'THEIA 今日', triggers: 'theia today', usage: 'theia today', description: '查看今天的课程、考试和作业截止事项。', group: 'theia' },
  { id: 'theia-agent', name: 'THEIA Agent', triggers: 'theia agent', usage: 'theia agent <问题>', description: '直接续接当前页面的 THEIA Agent 对话。', group: 'theia' },
  { id: 'theia-motion', name: 'THEIA 运动场馆', triggers: 'theia motion', usage: 'theia motion <项目>', description: '查看指定运动项目今天的场馆状态表。', group: 'theia' },
  { id: 'theia-classroom', name: 'THEIA 空闲教室', triggers: 'theia classroom', usage: 'theia classroom', description: '按教学楼列出缓存的空闲教室（THEIA 桌面端需先查询一次）。', group: 'theia' },
  { id: 'hyperion-diary', name: 'HYPERION 日记', triggers: 'hyperion diary', usage: 'hyperion diary <内容>', description: '把一段文字写进带时间的日记。', group: 'hyperion' },
  { id: 'hyperion-status', name: 'HYPERION 每日状态', triggers: 'hyperion status', usage: 'hyperion status <心情和记录>', description: '记录心情、睡眠、用药、饮酒或重点。', group: 'hyperion' },
  { id: 'hyperion-task', name: 'HYPERION 待办任务', triggers: 'hyperion task', usage: 'hyperion task', description: '查看当前待完成任务。', group: 'hyperion' },
  { id: 'hyperion-done', name: 'HYPERION 完成任务', triggers: 'hyperion done', usage: 'hyperion done <序号或标题>', description: '标记一项待办任务完成。', group: 'hyperion' },
  { id: 'hyperion-people', name: 'HYPERION 人物', triggers: 'hyperion people', usage: 'hyperion people [名称]', description: '查看人物摘要，或按名称查询一个人。', group: 'hyperion' },
  { id: 'hyperion-channels', name: 'HYPERION AI 通道', triggers: 'hyperion channels', usage: 'hyperion channels', description: '查看 AI 通道当前占用情况。', group: 'hyperion' },
  { id: 'hyperion-summary', name: 'HYPERION 数据概览', triggers: 'hyperion summary', usage: 'hyperion summary', description: '查看 HYPERION 数据概览。', group: 'hyperion' },
  { id: 'codex-task', name: 'Codex 任务', triggers: 'codex / cx', usage: 'codex <要做的事>', description: '把任务交给当前 Codex 会话。', group: 'codex', taskReply: 'codexQueued' },
  { id: 'codex-workspace', name: 'Codex / Iris 指定工作区', triggers: 'iris / i / codex <项目名>', usage: 'iris [项目名] <要做的事>', description: '把任务交给当前或指定工作区的 Codex，例如 iris hyperion 修复问题。', group: 'codex', taskReply: 'irisQueued', aliasable: false },
  { id: 'codex-status', name: 'Codex 会话状态', triggers: 'codex status / codex st', usage: 'codex status', description: '查看 Codex 会话和运行进度。', group: 'codex' },
  { id: 'codex-use', name: 'Codex 切换会话', triggers: 'codex use / codex u', usage: 'codex use <会话序号>', description: '切换当前 Codex 会话。', group: 'codex' },
  { id: 'codex-stop', name: 'Codex 停止任务', triggers: 'codex stop / codex x', usage: 'codex stop', description: '请求停止 Iris 发起的 Codex 任务。', group: 'codex' },
  { id: 'hermes-task', name: 'Hermes 任务', triggers: 'hermes / hm', usage: 'hermes <要做的事>', description: '把任务交给当前 Hermes 会话。', group: 'hermes', taskReply: 'hermesQueued' },
  { id: 'hermes-status', name: 'Hermes 会话状态', triggers: 'hermes status / hermes st', usage: 'hermes status', description: '查看 Hermes 会话和运行进度。', group: 'hermes' },
  { id: 'hermes-use', name: 'Hermes 切换会话', triggers: 'hermes use / hermes u', usage: 'hermes use <会话序号>', description: '切换当前 Hermes 会话。', group: 'hermes' },
  { id: 'hermes-stop', name: 'Hermes 停止任务', triggers: 'hermes stop / hermes x', usage: 'hermes stop', description: '请求停止 Iris 发起的 Hermes 任务。', group: 'hermes' },
  { id: 'claude-task', name: 'Claude Code 任务', triggers: 'claude / cc', usage: 'claude <要做的事>', description: '把任务发到当前 Claude Desktop 会话。', group: 'claude', taskReply: 'claudeQueued' },
  { id: 'claude-status', name: 'Claude Code 状态', triggers: 'claude status', usage: 'claude status', description: '查看 Claude Code 当前运行状态。', group: 'claude' },
  { id: 'claude-stop', name: 'Claude Code 停止任务', triggers: 'claude stop', usage: 'claude stop', description: '请求停止 Iris 发起的 Claude Code 任务。', group: 'claude' },
]

export const COMMAND_ALIAS_RULES = {
  help: { scope: 'root', builtIns: ['帮助', 'help', 'h', '?'] },
  theia: { scope: 'root', builtIns: ['theia', 'th', '校园'] },
  hyperion: { scope: 'root', builtIns: ['hyperion', 'hy', 'hp'] },
  selene: { scope: 'root', builtIns: ['selene', 'se'] },
  'theia-status': { scope: 'theia', builtIns: ['状态', 'status', 's'] },
  'theia-today': { scope: 'theia', builtIns: ['今天', '今日', 'today', 'now'] },
  'theia-agent': { scope: 'theia', builtIns: ['agent', '顾问', '问问', 'a'] },
  'theia-motion': { scope: 'theia', builtIns: ['motion', '运动', '场馆', 'm'] },
  'theia-classroom': { scope: 'theia', builtIns: ['classroom', '教室', '空闲', 'room', 'c'] },
  'hyperion-diary': { scope: 'hyperion', builtIns: ['日记', 'diary', 'journal', 'd', 'j'] },
  'hyperion-status': { scope: 'hyperion', builtIns: ['状态', 'status', 'checkin', 's'] },
  'hyperion-task': { scope: 'hyperion', builtIns: ['任务', 'task', 'tasks', 't'] },
  'hyperion-done': { scope: 'hyperion', builtIns: ['完成', 'done', 'complete', 'finish', 'c'] },
  'hyperion-people': { scope: 'hyperion', builtIns: ['人物', 'people', 'person', 'p'] },
  'hyperion-channels': { scope: 'hyperion', builtIns: ['通道', 'channel', 'channels', 'ai', 'a'] },
  'hyperion-summary': { scope: 'hyperion', builtIns: ['概览', 'summary', 'overview', 'info', 'o'] },
  'codex-task': { scope: 'root', builtIns: ['codex', 'cx'] },
  'codex-status': { scope: 'codex', builtIns: ['status', 'sessions', 'session', 's', 'ss', 'st', 'list', 'ls'] },
  'codex-use': { scope: 'codex', builtIns: ['use', 'select', 'u', '切换'] },
  'codex-stop': { scope: 'codex', builtIns: ['stop', 'cancel', 'abort', 'x', '停止', '终止'] },
  'hermes-task': { scope: 'root', builtIns: ['hermes', 'hm'] },
  'hermes-status': { scope: 'hermes', builtIns: ['status', 'sessions', 'session', 's', 'ss', 'st', 'list', 'ls'] },
  'hermes-use': { scope: 'hermes', builtIns: ['use', 'select', 'u', '切换'] },
  'hermes-stop': { scope: 'hermes', builtIns: ['stop', 'cancel', 'abort', 'x', '停止', '终止'] },
  'claude-task': { scope: 'root', builtIns: ['claude', 'cc'] },
  'claude-status': { scope: 'claude', builtIns: ['status', 's', 'st'] },
  'claude-stop': { scope: 'claude', builtIns: ['stop', 'cancel', 'abort', 'x', '停止', '终止'] },
}

const PROVIDER_IDS = Object.freeze(['theia', 'hyperion', 'selene', 'codex', 'hermes', 'claude'])
const DEFAULT_VISIBLE_PROVIDERS = Object.freeze(['theia'])

function normalizeProviderList(value, fallback = DEFAULT_VISIBLE_PROVIDERS) {
  const source = Array.isArray(value) ? value : fallback
  const result = []
  for (const item of source) {
    const id = String(item ?? '').trim().toLowerCase()
    if (!PROVIDER_IDS.includes(id) || result.includes(id)) continue
    result.push(id)
  }
  return result.length ? result : [...fallback]
}

function providerForDefinition(definition) {
  if (definition.id === 'help') return null
  if (definition.group === 'theia' || definition.id === 'theia') return 'theia'
  if (definition.group === 'hyperion' || definition.id === 'hyperion') return 'hyperion'
  if (definition.group === 'codex' || definition.id.startsWith('codex-')) return 'codex'
  if (definition.group === 'hermes' || definition.id.startsWith('hermes-')) return 'hermes'
  if (definition.group === 'claude' || definition.id.startsWith('claude-')) return 'claude'
  if (definition.id === 'selene') return 'selene'
  return null
}

export const DEFAULT_COMPLETION_TEMPLATE = '【Iris · {{provider}} {{status}}｜{{title}}】\n{{message}}\n\n{{continuation}}'
export const DEFAULT_COMMAND_MESSAGES = {
  help: [
    '【Iris】',
    '帮助/help/h/?  显示命令',
    'theia/th/校园  THEIA 校园工具',
    'theia status/状态/s  查看完整校园状态',
    'theia today/今天/今日/now  查看今日事项',
    'theia agent/顾问/问问/a  与当前 THEIA Agent 对话',
    'theia motion/运动/场馆/m  查询今日运动项目状态表',
    'theia classroom/教室/空闲/c  按教学楼列出空闲教室',
    '其他本机 provider 已预埋，需在高级设置中显式启用后显示。',
  ].join('\n'),
  codexQueued: 'Iris 已将指令交给 Codex，任务「{{task}}」{{sessionState}}。完成后会在此私聊返回结果。发送「codex status」可查看状态。',
  irisQueued: 'Iris 已将指令交给 Codex（{{workspace}}），任务「{{task}}」{{sessionState}}。完成后会在此私聊返回结果。',
  hermesQueued: 'Iris 已将任务交给 Hermes，任务「{{task}}」{{sessionState}}。完成后会在此私聊返回结果。发送「hermes status」可查看。',
  claudeQueued: 'Iris 已将任务交给 Claude Code，任务「{{task}}」{{sessionState}}。完成后会在此私聊返回结果。发送「claude status」可查看。',
}

function text(value, fallback = '', maximum = 3_800) {
  const result = String(value ?? '').replace(/\r\n?/g, '\n').trim()
  return (result || fallback).slice(0, maximum)
}

function validPort(value) {
  const port = Number(value)
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : 38640
}

function commandMessages(value) {
  return Object.fromEntries(Object.entries(DEFAULT_COMMAND_MESSAGES).map(([key, fallback]) => [key, text(value?.[key], fallback)]))
}

function commandAliases(value) {
  return Object.fromEntries(COMMAND_DEFINITIONS.map((definition) => {
    const source = Array.isArray(value?.[definition.id]) ? value[definition.id] : String(value?.[definition.id] ?? '').split(/[\n,;，；]+/)
    const aliases = []
    for (const item of source) {
      const alias = String(item ?? '').trim().toLowerCase()
      if (!/^[\p{L}\p{N}_-]{1,40}$/u.test(alias) || aliases.includes(alias)) continue
      aliases.push(alias)
      if (aliases.length === 12) break
    }
    return [definition.id, aliases]
  }))
}

export function findCommandAliasConflicts(value) {
  const aliases = commandAliases(value)
  const owners = new Map()
  const conflicts = []
  const claim = (scope, alias, id, kind) => {
    const key = `${scope}:${alias}`
    const owner = owners.get(key)
    if (!owner) {
      owners.set(key, { id, kind })
      return
    }
    conflicts.push({ alias, id, ownerId: owner.id, kind: owner.kind === 'builtIn' && owner.id === id ? 'builtIn' : 'conflict' })
  }
  for (const [id, rule] of Object.entries(COMMAND_ALIAS_RULES)) {
    for (const alias of rule.builtIns.map((item) => item.toLowerCase())) claim(rule.scope, alias, id, 'builtIn')
  }
  for (const [id, values] of Object.entries(aliases)) {
    const rule = COMMAND_ALIAS_RULES[id]
    if (!rule) continue
    for (const alias of values) claim(rule.scope, alias, id, 'custom')
  }
  return conflicts
}

function commandHelp(value) {
  const migratedId = {
    'hyperion-diary': 'diary', 'hyperion-status': 'status', 'hyperion-task': 'task', 'hyperion-done': 'done',
    'hyperion-people': 'people', 'hyperion-channels': 'channels', 'hyperion-summary': 'summary',
    'codex-task': 'codex', 'codex-workspace': 'iris', 'hermes-task': 'hermes', 'claude-task': 'claude',
  }
  const entries = Object.fromEntries(COMMAND_DEFINITIONS.map((definition) => {
    const item = value?.entries?.[definition.id] ?? value?.entries?.[migratedId[definition.id]]
    return [definition.id, {
      enabled: item?.enabled !== false,
      usage: text(item?.usage, definition.usage, 180),
      description: text(item?.description, definition.description, 500),
      note: text(item?.note, '', 500),
    }]
  }))
  return {
    intro: text(value?.intro, '【Iris】', 500),
    footer: text(value?.footer, '', 500),
    entries,
  }
}

export function normalizeIrisSettings(value) {
  const visibleProviders = normalizeProviderList(value?.visibleProviders)
  return {
    completionTemplate: text(value?.completionTemplate, DEFAULT_COMPLETION_TEMPLATE),
    providers: {
      theia: value?.providers?.theia !== false,
      hyperion: value?.providers?.hyperion !== false,
      selene: value?.providers?.selene !== false,
      codex: value?.providers?.codex !== false,
      hermes: value?.providers?.hermes !== false,
      claudeDesktop: value?.providers?.claudeDesktop !== false && value?.providers?.claude !== false,
    },
    visibleProviders,
    enabledProviders: normalizeProviderList(value?.enabledProviders, visibleProviders),
    commandMessages: commandMessages(value?.commandMessages),
    commandAliases: commandAliases(value?.commandAliases),
    commandHelp: value?.commandHelp ? commandHelp(value.commandHelp) : null,
    guiPort: validPort(value?.guiPort),
  }
}

export function loadIrisSettings() {
  try {
    return normalizeIrisSettings(JSON.parse(readFileSync(settingsPath, 'utf8')))
  } catch {
    return normalizeIrisSettings(null)
  }
}

export function saveIrisSettings(update) {
  const current = loadIrisSettings()
  const next = normalizeIrisSettings({ ...current, ...update, providers: { ...current.providers, ...update?.providers } })
  const conflicts = findCommandAliasConflicts(next.commandAliases)
  if (conflicts.length) {
    const conflict = conflicts[0]
    const current = COMMAND_DEFINITIONS.find((item) => item.id === conflict.id)?.name ?? conflict.id
    const owner = COMMAND_DEFINITIONS.find((item) => item.id === conflict.ownerId)?.name ?? conflict.ownerId
    const reason = conflict.kind === 'builtIn' ? '已经是这条命令的内置缩写' : `已被“${owner}”使用`
    const error = new Error(`缩写“${conflict.alias}”${reason}，不能再用于“${current}”。`)
    error.code = 'INVALID_COMMAND_ALIASES'
    throw error
  }
  writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  return next
}

function parseEnv(content) {
  const entries = new Map()
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)=(.*)$/)
    if (match) entries.set(match[1], match[2])
  }
  return entries
}

const editableEnvKeys = new Set([
  'THEIA_API',
  'THEIA_DATA_ROOT',
  'IRIS_CODEX_HOME',
  'IRIS_CODEX_ENTRY',
  'IRIS_CODEX_WORKSPACE',
  'IRIS_CODEX_WORKSPACE_MAP',
  'IRIS_CODEX_DESKTOP_STATE',
  'IRIS_CODEX_IPC_PIPE',
  'IRIS_CODEX_DESKTOP_HOST_ID',
  'IRIS_CODEX_DESKTOP_PERMISSIONS',
  'IRIS_CODEX_DESKTOP_APPROVAL_POLICY',
  'IRIS_CLAUDE_DESKTOP_HOME',
  'IRIS_CLAUDE_WORKSPACE',
])

export function loadPublicEnv() {
  const entries = parseEnv(existsSync(envPath) ? readFileSync(envPath, 'utf8') : '')
  return Object.fromEntries([...editableEnvKeys].map((key) => [key, entries.get(key) ?? '']))
}

export function updateIrisEnv(update) {
  const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
  const entries = parseEnv(current)
  const values = {}
  for (const key of editableEnvKeys) {
    if (Object.hasOwn(update ?? {}, key)) values[key] = text(update[key], '', 2_000)
  }

  let output = current
  for (const [key, value] of Object.entries(values)) {
    const pattern = new RegExp(`^${key}=.*$`, 'm')
    output = pattern.test(output) ? output.replace(pattern, `${key}=${value}`) : `${output.replace(/\s*$/, '')}\n${key}=${value}\n`
    entries.set(key, value)
  }
  if (output !== current) writeFileSync(envPath, output, { encoding: 'utf8', mode: 0o600 })
  return Object.fromEntries([...editableEnvKeys].map((key) => [key, entries.get(key) ?? '']))
}

export function renderCompletionTemplate(template, variables) {
  const source = text(template, DEFAULT_COMPLETION_TEMPLATE)
  return source.replace(/{{\s*(provider|status|title|message|continuation)\s*}}/g, (_whole, key) => text(variables?.[key], '', 3_200)).trim().slice(0, 3_800)
}

export function renderCommandMessage(template, variables = {}) {
  const source = text(template, '', 3_800)
  return source.replace(/{{\s*(sessionState|workspace|task)\s*}}/g, (_whole, key) => text(variables[key], '', 240)).trim().slice(0, 3_800)
}

export function renderCommandHelp(value, { group = '', intro = '', aliases = {}, visibleProviders } = {}) {
  const help = commandHelp(value)
  const shortcuts = commandAliases(aliases)
  const allowedProviders = normalizeProviderList(visibleProviders ?? value?.visibleProviders)
  const lines = [intro || help.intro]
  const usageWithAliases = (definition, entry) => {
    const rule = COMMAND_ALIAS_RULES[definition.id]
    if (!rule) return entry.usage
    const tokens = String(entry.usage || definition.usage || '').trim().split(/\s+/).filter(Boolean)
    if (!tokens.length) return entry.usage
    const builtin = rule.builtIns.map((item) => String(item).toLowerCase())
    const custom = shortcuts[definition.id] || []
    const index = rule.scope === 'root' ? 0 : Math.min(1, tokens.length - 1)
    const primary = String(tokens[index] || '').toLowerCase()
    const aliasesForToken = [primary, ...builtin, ...custom]
      .map((item) => String(item).trim())
      .filter((item, position, all) => item && all.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === position)
    if (definition.id === 'theia' && tokens[0] === 'theia') {
      return `theia <二级指令> (${aliasesForToken.join('/')})${tokens.length > 2 ? ` ${tokens.slice(2).join(' ')}` : ''}`
    }
    tokens[index] = aliasesForToken.join('/')
    return tokens.join(' ')
  }
  for (const definition of COMMAND_DEFINITIONS) {
    if (group && definition.group !== group) continue
    const provider = providerForDefinition(definition)
    if (provider && !allowedProviders.includes(provider)) continue
    const entry = help.entries[definition.id]
    if (!entry.enabled) continue
    lines.push(`${usageWithAliases(definition, entry)}  ${[entry.description, entry.note].filter(Boolean).join(' ')}`)
  }
  if (help.footer) lines.push('', help.footer)
  return lines.join('\n').trim().slice(0, 3_800)
}

export function publicSettings() {
  const settings = loadIrisSettings()
  return {
    ...settings,
    commandHelp: settings.commandHelp ?? commandHelp(null),
    commandDefinitions: COMMAND_DEFINITIONS.filter((definition) => {
      const provider = providerForDefinition(definition)
      return !provider || settings.visibleProviders.includes(provider)
    }),
    commandAliasRules: COMMAND_ALIAS_RULES,
    commandMessageDefaults: DEFAULT_COMMAND_MESSAGES,
    env: loadPublicEnv(),
  }
}

export function updatePublicSettings(update) {
  const settings = saveIrisSettings(update)
  const env = updateIrisEnv(update?.env)
  return { ...settings, commandDefinitions: COMMAND_DEFINITIONS.filter((definition) => {
    const provider = providerForDefinition(definition)
    return !provider || settings.visibleProviders.includes(provider)
  }), commandAliasRules: COMMAND_ALIAS_RULES, commandMessageDefaults: DEFAULT_COMMAND_MESSAGES, env }
}
