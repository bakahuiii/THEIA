import { renderCompletionTemplate } from './settings.mjs'

function label(value, fallback) {
  const text = displayText(value).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim() || fallback
  return text.length > 80 ? `${text.slice(0, 79)}…` : text
}

function conversationLabel(value, provider) {
  const text = displayText(value).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (/^(?:已选会话|selected conversation|未命名会话|codex)$/i.test(text)) return `当前 ${label(provider, 'Iris')} 会话`
  return label(text, `当前 ${label(provider, 'Iris')} 会话`)
}

export function displayText(value) {
  if (Buffer.isBuffer(value)) return value.toString('utf8')
  if (value?.type === 'Buffer' && Array.isArray(value.data)) return Buffer.from(value.data).toString('utf8')
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (parsed?.type === 'Buffer' && Array.isArray(parsed.data)) return Buffer.from(parsed.data).toString('utf8')
    } catch { /* Plain assistant text is not required to be JSON. */ }
    return value
  }
  return ''
}

/** Converts model Markdown into readable QQ text while retaining its content. */
export function stripMarkdown(value) {
  return displayText(value)
    .replace(/```(?:[\w+-]+)?\s*\n?/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '· ')
    .replace(/^\s*\d+[.)]\s+/gm, (match) => match.replace(/\d+[.)]/, '·'))
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1')
    .replace(/(?<!_)_([^_\n]+)_(?!_)/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function formatProviderCompletion({ provider, status, title, workspace, text, sessionId, continuation: continuationText, template, preserveText = false } = {}) {
  const name = label(provider, 'Iris')
  const state = label(status, '已完成')
  const conversation = conversationLabel(title, name)
  const workspaceLabel = label(workspace, '')
  const target = [conversation, workspaceLabel].filter(Boolean).join(' / ')
  const continuation = String(continuationText ?? '').trim() || (sessionId
    ? '直接回复此消息，即可将下一条指令续接到同一会话。'
    : '可发送新的 Iris 指令继续。')
  const message = preserveText ? displayText(text).trim() : stripMarkdown(text)
  return renderCompletionTemplate(template, {
    provider: name,
    status: state,
    title: target || conversation,
    message: message.slice(0, 3_200) || '本轮未返回可显示的最终文本。',
    continuation,
  })
}

/** Builds a global-hook completion notification while retaining the conversation anchor. */
export function formatCodexHookCompletion({ title, workspace, text } = {}, template) {
  return formatProviderCompletion({
    provider: 'Codex',
    status: '已完成',
    title,
    workspace,
    text,
    preserveText: true,
    continuation: '直接回复此消息，即可将下一条指令续接到同一 Codex 对话。',
    template,
  })
}

/** Builds the private QQ message sent after a local Codex turn finishes. */
export function formatCodexCompletion(result, template) {
  return formatProviderCompletion({
    provider: 'Codex',
    status: result?.status || (result?.ok ? '已完成' : '未完成'),
    title: result?.session?.name,
    workspace: result?.workspaceLabel,
    text: result?.text,
    sessionId: result?.ok ? result?.session?.id : '',
    preserveText: true,
    template,
  })
}
