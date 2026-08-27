const state = { settings: null, commandId: 'help' }
const $ = (selector) => document.querySelector(selector)
const api = async (path, options = {}) => {
  const response = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error || '请求失败。')
  return body
}
const notify = (message, error = false) => { $('#save-state').textContent = message; $('#save-state').style.color = error ? '#b42318' : '#087760' }
const definition = () => state.settings.commandDefinitions.find((item) => item.id === state.commandId)
const entry = () => state.settings.commandHelp.entries[state.commandId]
const taskReplyKey = () => definition()?.taskReply
const aliasesFromInput = (value) => String(value ?? '').split(/[\n,;，；]+/).map((item) => item.trim()).filter(Boolean)
function aliasIssues() {
  const rules = state.settings.commandAliasRules || {}
  const aliases = state.settings.commandAliases || {}
  const names = Object.fromEntries(state.settings.commandDefinitions.map((item) => [item.id, item.name]))
  const owners = new Map()
  const issues = []
  const claim = (scope, alias, id, kind) => {
    const key = `${scope}:${alias}`
    const owner = owners.get(key)
    if (!owner) { owners.set(key, { id, kind }); return }
    if (owner.id === id && owner.kind === 'custom' && kind === 'custom') issues.push(`缩写“${alias}”重复填写。`)
    else if (owner.id === id && owner.kind === 'builtIn') issues.push(`缩写“${alias}”已经是“${names[id]}”的内置缩写。`)
    else issues.push(`缩写“${alias}”已被“${names[owner.id] || owner.id}”使用。`)
  }
  for (const [id, rule] of Object.entries(rules)) for (const alias of rule.builtIns || []) claim(rule.scope, String(alias).toLowerCase(), id, 'builtIn')
  for (const [id, values] of Object.entries(aliases)) {
    const rule = rules[id]
    if (!rule) continue
    for (const raw of values) {
      const alias = String(raw).trim().toLowerCase()
      if (!/^[\p{L}\p{N}_-]{1,40}$/u.test(alias)) { issues.push(`缩写“${raw}”只能包含文字、数字、下划线或连字符，且不能有空格。`); continue }
      claim(rule.scope, alias, id, 'custom')
    }
  }
  return [...new Set(issues)]
}
function updateAliasFeedback() {
  const issues = aliasIssues()
  const error = $('#command-alias-error')
  error.textContent = issues[0] || ''
  return issues
}
function preview() {
  const template = $('#completion-template').value
  $('#template-preview').textContent = template.replace(/{{\s*provider\s*}}/g, 'Codex').replace(/{{\s*status\s*}}/g, '已完成').replace(/{{\s*title\s*}}/g, '示例会话').replace(/{{\s*message\s*}}/g, '本轮最终答复正文。').replace(/{{\s*continuation\s*}}/g, '直接回复即可继续对应会话。')
}
function helpPreview() {
  const help = state.settings.commandHelp
  const lines = [help.intro]
  for (const item of state.settings.commandDefinitions) {
    const configured = help.entries[item.id]
    if (!configured.enabled) continue
    const aliases = state.settings.commandAliases[item.id] || []
    const shortcut = aliases.length ? `（自定义缩写：${aliases.join(' / ')}）` : ''
    lines.push(`${configured.usage}  ${[configured.description, configured.note, shortcut].filter(Boolean).join(' ')}`)
  }
  if (help.footer) lines.push('', help.footer)
  $('#help-preview').textContent = lines.join('\n')
}
function replyPreview() {
  const key = taskReplyKey()
  if (!key) return
  $('#command-reply-preview').textContent = state.settings.commandMessages[key]
    .replace(/{{\s*task\s*}}/g, '修复 QQ 完成通知')
    .replace(/{{\s*sessionState\s*}}/g, '（续接当前会话）')
    .replace(/{{\s*workspace\s*}}/g, '（HYPERION）')
}
function fillCommandPicker() {
  const select = $('#command-select')
  select.replaceChildren()
  const groups = { root: '基础指令', theia: 'THEIA 只读指令', hyperion: 'HYPERION 二级指令', codex: 'Codex 二级指令', hermes: 'Hermes 二级指令', claude: 'Claude Code 二级指令' }
  for (const [group, label] of Object.entries(groups)) {
    const definitions = state.settings.commandDefinitions.filter((item) => item.group === group)
    if (!definitions.length) continue
    const optgroup = document.createElement('optgroup')
    optgroup.label = label
    for (const item of definitions) {
      const option = document.createElement('option')
      option.value = item.id
      option.textContent = `${item.name} - ${item.triggers}`
      optgroup.append(option)
    }
    select.append(optgroup)
  }
}
function fillCommand() {
  const item = definition()
  const configured = entry()
  $('#command-select').value = item.id
  $('#command-name').textContent = item.name
  $('#command-triggers').textContent = item.triggers
  $('#command-input-hint').textContent = item.usage.includes('<') ? item.usage.slice(item.usage.indexOf('<')) : '不需要额外内容'
  $('#command-result').textContent = item.taskReply ? '提交任务并在完成后回传结果' : item.description
  $('#command-supported').textContent = `真实触发词：${item.triggers}。触发词由 Iris 路由固定维护，避免帮助写了但系统无法识别。`
  $('#command-enabled').checked = configured.enabled
  $('#command-usage').value = configured.usage
  $('#command-description').value = configured.description
  $('#command-note').value = configured.note
  const aliasable = item.aliasable !== false
  $('#command-aliases').value = (state.settings.commandAliases[item.id] || []).join(', ')
  $('#command-aliases').disabled = !aliasable
  $('#command-alias-help').textContent = aliasable
    ? '缩写只能是一个词。一级缩写放在前面，例如 hy diary；二级缩写放在所属命令后，例如 codex u 1。'
    : '这里必须填写项目名，不能设置缩写。'
  const task = Boolean(item.taskReply)
  $('#task-reply-panel').hidden = !task
  if (task) {
    $('#command-reply').value = state.settings.commandMessages[item.taskReply]
    $('#insert-workspace').hidden = item.taskReply !== 'irisQueued'
    replyPreview()
  }
  helpPreview()
  updateAliasFeedback()
}
function updateEntry() {
  const configured = entry()
  configured.enabled = $('#command-enabled').checked
  configured.usage = $('#command-usage').value.trim()
  configured.description = $('#command-description').value.trim()
  configured.note = $('#command-note').value.trim()
  if (definition().aliasable !== false) state.settings.commandAliases[state.commandId] = aliasesFromInput($('#command-aliases').value)
  helpPreview()
  updateAliasFeedback()
}
function resetCommand() {
  const item = definition()
  state.settings.commandHelp.entries[item.id] = { enabled: true, usage: item.usage, description: item.description, note: '' }
  state.settings.commandAliases[item.id] = []
  if (item.taskReply) state.settings.commandMessages[item.taskReply] = state.commandMessageDefaults[item.taskReply]
  fillCommand()
}
function fill(settings) {
  state.settings = settings
  state.settings.commandAliases ||= {}
  state.commandMessageDefaults = settings.commandMessageDefaults
  if (!settings.commandDefinitions.some((item) => item.id === state.commandId)) state.commandId = 'help'
  $('#completion-template').value = settings.completionTemplate
  $('#theia-api').value = settings.env.THEIA_API || ''
  $('#theia-data-root').value = settings.env.THEIA_DATA_ROOT || ''
  $('#codex-home').value = settings.env.IRIS_CODEX_HOME || ''
  $('#codex-workspace').value = settings.env.IRIS_CODEX_WORKSPACE || ''
  $('#codex-map').value = settings.env.IRIS_CODEX_WORKSPACE_MAP || ''
  $('#codex-desktop-state').value = settings.env.IRIS_CODEX_DESKTOP_STATE || ''
  $('#codex-ipc-pipe').value = settings.env.IRIS_CODEX_IPC_PIPE || ''
  $('#codex-desktop-host-id').value = settings.env.IRIS_CODEX_DESKTOP_HOST_ID || 'local'
  $('#codex-desktop-permissions').value = settings.env.IRIS_CODEX_DESKTOP_PERMISSIONS || ':workspace'
  $('#codex-desktop-approval-policy').value = settings.env.IRIS_CODEX_DESKTOP_APPROVAL_POLICY || 'never'
  $('#claude-desktop-home').value = settings.env.IRIS_CLAUDE_DESKTOP_HOME || ''
  $('#claude-workspace').value = settings.env.IRIS_CLAUDE_WORKSPACE || ''
  $('#codex-enabled').checked = settings.providers.codex
  $('#theia-enabled').checked = settings.providers.theia
  $('#claude-enabled').checked = settings.providers.claudeDesktop
  const visibleProviders = new Set(settings.visibleProviders || ['theia'])
  for (const provider of ['theia', 'hyperion', 'selene', 'codex', 'hermes', 'claude']) {
    const control = $(`#${provider}-visible`)
    if (control) control.checked = visibleProviders.has(provider)
  }
  $('#help-intro').value = settings.commandHelp.intro
  $('#help-footer').value = settings.commandHelp.footer
  fillCommandPicker()
  fillCommand()
  preview()
}
function fillClaudeStatus(status) {
  const claude = status.claudeDesktop || {}
  const watcher = claude.watcher || {}
  const current = claude.currentSession
  $('#claude-watch-dot').classList.toggle('online', Boolean(claude.enabled && watcher.running && claude.logExists))
  $('#claude-watch-status').textContent = claude.enabled ? (watcher.running ? '监控运行中' : '监控未运行') : '通知已关闭'
  $('#claude-watch-detail').textContent = claude.logExists ? `日志已连接 · ${claude.sessions?.length || 0} 个本地会话` : '尚未找到 Claude Desktop 日志'
  $('#claude-session-title').textContent = current?.title || '未发现会话'
  $('#claude-session-meta').textContent = current ? `${current.workspace || '未标记工作区'} · 已完成 ${current.completedTurns} 轮` : `数据目录：${claude.dataDirectoryExists ? '存在' : '不存在'}`
}
function fillTheiaStatus(status) {
  const theia = status.theia || {}
  $('#theia-dot').classList.toggle('online', Boolean(theia.connected))
  $('#theia-status').textContent = theia.enabled === false ? '校园数据查询已关闭' : theia.connected ? (theia.degraded ? '已连接，部分数据域异常' : '已连接') : 'THEIA 未运行'
  if (theia.connected) {
    const sync = theia.lastSuccessAt ? new Date(theia.lastSuccessAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '尚无成功同步'
    $('#theia-detail').textContent = `最近成功同步：${sync}${theia.degraded ? ' · 当前存在部分/过期数据' : ''}`
    $('#theia-domains').textContent = (theia.domains || []).map((domain) => `${domain.label} ${domain.count} · ${domain.completeness === 'complete' ? '完整' : domain.completeness === 'partial' ? '部分' : domain.status === 'not-read' ? '未读取' : domain.status || '未知'}${domain.stale ? ' · 旧' : ''}${domain.retainedPrevious ? ' · 保留旧值' : ''}`).join('\n')
  } else {
    const labels = { THEIA_DISABLED: '明确开启后 Iris 才会把校园摘要发送到 QQ', THEIA_NOT_RUNNING: '启动 THEIA 桌面版后会自动连接', THEIA_TIMEOUT: '本机接口响应超时', THEIA_INVALID_CONFIG: '请检查数据目录或固定 API 地址', THEIA_SCHEMA_MISMATCH: 'THEIA 与 Iris 的接口版本不兼容' }
    $('#theia-detail').textContent = labels[theia.code] || '暂时无法读取本机校园数据'
    $('#theia-domains').textContent = ''
  }
}
function fillHealth(status) {
  const codexJob = status.activeJobs?.codex?.[0]
  const codexDetail = !status.providers?.codex
    ? '已关闭'
    : codexJob
      ? [codexJob.taskName || '未命名任务', codexJob.stage || '正在运行', codexJob.workspaceLabel || '未标注工作区', codexJob.transport === 'desktop-ipc' ? '桌面 IPC' : codexJob.transport === 'cli' ? 'Codex CLI' : '准备中'].join(' · ')
      : '空闲 · 等待下一项任务'
  const items = [
    { name: 'Iris', ok: true, detail: `PID ${status.pid}` },
    { name: 'QQ', ok: status.connected, detail: status.connected ? '网关已连接' : '正在连接或已断开' },
    { name: 'THEIA', ok: status.theia?.connected, detail: status.theia?.enabled === false ? '校园数据查询已关闭' : status.theia?.connected ? (status.theia.degraded ? '可读，部分数据域异常' : '只读接口正常') : '桌面端/接口离线' },
    { name: 'Owner', ok: status.replyTargetBound, detail: status.replyTargetBound ? '私聊目标已绑定' : '等待首次可信私聊' },
    { name: 'Codex', ok: status.providers?.codex, detail: codexDetail },
    { name: 'Claude', ok: status.providers?.claudeDesktop && status.claudeDesktop?.watcher?.running, detail: status.providers?.claudeDesktop ? '完成监控状态见集成页' : '已关闭' },
  ]
  const grid = $('#health-grid')
  grid.replaceChildren(...items.map((item) => {
    const row = document.createElement('div')
    row.className = 'health-item'
    const dot = document.createElement('span')
    dot.className = `watch-dot${item.ok ? ' online' : ''}`
    const text = document.createElement('div')
    const strong = document.createElement('strong')
    strong.textContent = item.name
    const detail = document.createElement('span')
    detail.textContent = item.detail
    text.append(strong, detail)
    row.append(dot, text)
    return row
  }))
}
async function refresh() {
  const [settings, status, logs] = await Promise.all([api('/api/settings'), api('/api/status'), api('/api/logs')])
  fill(settings)
  fillClaudeStatus(status)
  fillTheiaStatus(status)
  fillHealth(status)
  $('#connection').textContent = status.connected ? `QQ 已连接 · PID ${status.pid}` : 'QQ 连接中'
  const codexJob = status.activeJobs?.codex?.[0]
  const codexState = codexJob ? '执行中：' + (codexJob.taskName || '未命名任务') : status.providers.codex ? '空闲' : '已关闭'
  $('#service-summary').textContent = `控制台只监听本机 · THEIA ${status.theia?.connected ? '已连接' : '离线'} · Codex ${codexState} · Claude Desktop ${status.providers.claudeDesktop ? '已启用' : '已关闭'}`
  $('#logs').textContent = logs.lines.join('\n') || '暂无日志。'
}
async function saveNotifications() { try { fill(await api('/api/settings', { method: 'PUT', body: JSON.stringify({ completionTemplate: $('#completion-template').value }) })); notify('通知模板已保存。') } catch (error) { notify(error.message, true) } }
async function saveProviders() { try { fill(await api('/api/settings', { method: 'PUT', body: JSON.stringify({ providers: { theia: $('#theia-enabled').checked, codex: $('#codex-enabled').checked, claudeDesktop: $('#claude-enabled').checked }, visibleProviders: ['theia', 'hyperion', 'selene', 'codex', 'hermes', 'claude'].filter((provider) => $(`#${provider}-visible`)?.checked), env: { THEIA_API: $('#theia-api').value, THEIA_DATA_ROOT: $('#theia-data-root').value, IRIS_CODEX_HOME: $('#codex-home').value, IRIS_CODEX_WORKSPACE: $('#codex-workspace').value, IRIS_CODEX_WORKSPACE_MAP: $('#codex-map').value, IRIS_CODEX_DESKTOP_STATE: $('#codex-desktop-state').value, IRIS_CODEX_IPC_PIPE: $('#codex-ipc-pipe').value, IRIS_CODEX_DESKTOP_HOST_ID: $('#codex-desktop-host-id').value, IRIS_CODEX_DESKTOP_PERMISSIONS: $('#codex-desktop-permissions').value, IRIS_CODEX_DESKTOP_APPROVAL_POLICY: $('#codex-desktop-approval-policy').value, IRIS_CLAUDE_DESKTOP_HOME: $('#claude-desktop-home').value, IRIS_CLAUDE_WORKSPACE: $('#claude-workspace').value } }) })); await refresh(); notify('集成设置已保存。') } catch (error) { notify(error.message, true) } }
async function saveCommands() {
  try {
    updateEntry()
    const aliasValidation = updateAliasFeedback()
    if (aliasValidation.length) throw new Error(aliasValidation[0])
    state.settings.commandHelp.intro = $('#help-intro').value.trim()
    state.settings.commandHelp.footer = $('#help-footer').value.trim()
    fill(await api('/api/settings', { method: 'PUT', body: JSON.stringify({ commandHelp: state.settings.commandHelp, commandMessages: state.settings.commandMessages, commandAliases: state.settings.commandAliases }) }))
    $('#command-save-state').textContent = '指令设置已保存，下一条 QQ 指令立即使用新内容。'
    $('#command-save-state').style.color = '#087760'
  } catch (error) { $('#command-save-state').textContent = error.message; $('#command-save-state').style.color = '#b42318' }
}
function insertReplyPart(token) {
  const input = $('#command-reply')
  const start = input.selectionStart
  const end = input.selectionEnd
  input.setRangeText(token, start, end, 'end')
  state.settings.commandMessages[taskReplyKey()] = input.value
  replyPreview()
  input.focus()
}
document.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('[data-tab],.tab').forEach((node) => node.classList.remove('active')); button.classList.add('active'); $(`#${button.dataset.tab}`).classList.add('active') }))
$('#completion-template').addEventListener('input', preview)
$('#save-notifications').addEventListener('click', saveNotifications)
$('#save-providers').addEventListener('click', saveProviders)
$('#save-commands').addEventListener('click', saveCommands)
$('#command-select').addEventListener('change', () => { updateEntry(); state.commandId = $('#command-select').value; fillCommand() })
for (const selector of ['#command-enabled', '#command-usage', '#command-description', '#command-note', '#command-aliases']) $(selector).addEventListener('input', updateEntry)
$('#command-reply').addEventListener('input', () => { state.settings.commandMessages[taskReplyKey()] = $('#command-reply').value; replyPreview() })
$('#help-intro').addEventListener('input', () => { state.settings.commandHelp.intro = $('#help-intro').value; helpPreview() })
$('#help-footer').addEventListener('input', () => { state.settings.commandHelp.footer = $('#help-footer').value; helpPreview() })
$('#reset-command').addEventListener('click', resetCommand)
document.querySelectorAll('[data-insert]').forEach((button) => button.addEventListener('click', () => insertReplyPart(button.dataset.insert)))
$('#refresh').addEventListener('click', refresh)
$('#refresh-logs').addEventListener('click', refresh)
$('#test-notification').addEventListener('click', async () => { try { await api('/api/test-notification', { method: 'POST' }); notify('测试通知已提交。') } catch (error) { notify(error.message, true) } })
refresh().catch((error) => { $('#connection').textContent = '无法连接'; notify(error.message, true) })
