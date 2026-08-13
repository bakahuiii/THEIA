import { createHash, randomUUID } from 'node:crypto'
import { load } from 'cheerio'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { domainHasData, sourceDomainOutcome, withDomainProvenance } from './domain-provenance.mjs'

const IMAP_HOST = 'imap.qiye.163.com'
const IMAP_PORT = 993
const MAILBOX = 'INBOX'
const MAX_MESSAGES = 500
const RICH_MAIL_VERSION = 4
const IMAP_MAIL_PARSER_VERSION = 'imap-mail/v1'

function clean(value, limit = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit) || null
}

function messageId(uid) {
  return `mail:imap:${createHash('sha256').update(String(uid)).digest('hex').slice(0, 32)}`
}

function addressLabel(addresses) {
  const item = Array.isArray(addresses) ? addresses[0] : null
  if (!item) return '校园邮箱'
  return clean(item.name || item.address, 240) || '校园邮箱'
}

function addressValue(addresses) {
  const item = Array.isArray(addresses) ? addresses[0] : null
  return clean(item?.address, 320)
}

function safeError(error) {
  const message = clean(error?.responseText || error?.message || error, 240) || 'IMAP 收信失败'
  if (/auth|login|password|credential|authentication/i.test(message)) {
    return 'IMAP 登录失败。请在邮箱旧版的设置中启用客户端收信，并使用邮箱密码或客户端授权密码。'
  }
  return message
}

function isAuthenticationError(error) {
  const details = [error?.code, error?.responseStatus, error?.responseText, error?.message, error]
    .map((value) => String(value || ''))
    .join(' ')
  return error?.authenticationFailed === true || /auth|login|password|credential|authentication|\u8ba4\u8bc1|\u767b\u5f55|\u5bc6\u7801|\u6388\u6743/i.test(details)
}

function sanitizeHtml(value) {
  const $ = load(String(value || ''), undefined, false)
  $('script, iframe, frame, object, embed, form, input, button, select, textarea, video, audio, source, link, meta, base, svg, math').remove()
  const safeStyleProperties = new Set([
    'background', 'background-color', 'border', 'border-collapse', 'border-color', 'border-radius', 'border-spacing', 'border-style', 'border-width',
    'color', 'display', 'float', 'font', 'font-family', 'font-size', 'font-style', 'font-weight', 'height', 'line-height', 'letter-spacing',
    'list-style', 'margin', 'max-height', 'max-width', 'min-height', 'min-width', 'padding', 'text-align', 'text-decoration', 'text-indent',
    'vertical-align', 'white-space', 'width', 'word-break', 'overflow-wrap',
  ])
  const cleanStyle = (raw) => String(raw || '').split(';').map((declaration) => {
    const separator = declaration.indexOf(':')
    if (separator < 1) return null
    const property = declaration.slice(0, separator).trim().toLowerCase()
    const styleValue = declaration.slice(separator + 1).trim()
    if (!safeStyleProperties.has(property) || !styleValue || /(?:(?:-webkit-)?image-set|cross-fade|url|expression)\s*\(|@import|(?:https?:)?\/\/|behavior\s*:|-moz-binding|position\s*:|z-index\s*:|animation\s*:|transition\s*:/i.test(styleValue)) return null
    return `${property}: ${styleValue}`
  }).filter(Boolean).join('; ')
  // Transactional mail commonly keeps its visual system in class rules. The
  // document runs in a CSP-locked sandbox, so retain a reduced stylesheet.
  const cleanStyleSheet = (raw) => String(raw || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@(?:import|namespace|font-face|page)[^;{]*(?:;|\{[^}]*\})/gi, '')
    .replace(/(?:behavior\s*:|-moz-binding\s*:|expression\s*\()[^;}]*[;}]?/gi, '')
    .replace(/(?:position\s*:\s*(?:fixed|sticky)|z-index\s*:\s*[^;}]+|animation\s*:[^;}]+|transition\s*:[^;}]+)[;]?/gi, '')
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, 'none')
    .replace(/(?:-webkit-)?image-set\s*\([^)]*\)|cross-fade\s*\([^)]*\)/gi, 'none')
    .replace(/(?:https?:)?\/\/[^\s"'();}]+/gi, 'none')
    .trim()
  $('style').each((_index, element) => {
    const stylesheet = cleanStyleSheet($(element).html())
    if (stylesheet) $(element).text(stylesheet)
    else $(element).remove()
  })
  const layoutAttributes = new Set(['align', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'colspan', 'height', 'rowspan', 'valign', 'width'])
  $('*').each((_index, element) => {
    const tag = String(element.tagName || '').toLowerCase()
    // Classes and ids are inert without JavaScript, but are necessary for
    // legitimate mail templates whose CSS is retained above.
    const allowed = new Set(['style', 'class', 'id'])
    if (tag === 'a') { allowed.add('href'); allowed.add('title') }
    if (tag === 'img') { ['src', 'alt', 'height', 'width'].forEach((attribute) => allowed.add(attribute)) }
    if (['table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'col', 'colgroup'].includes(tag)) {
      layoutAttributes.forEach((attribute) => allowed.add(attribute))
    }
    for (const attribute of Object.keys(element.attribs || {})) {
      const normalized = attribute.toLowerCase()
      if (!allowed.has(normalized)) {
        $(element).removeAttr(attribute)
        continue
      }
      if (normalized === 'style') {
        const style = cleanStyle($(element).attr(attribute))
        if (style) $(element).attr(attribute, style)
        else $(element).removeAttr(attribute)
      }
    }
    if (tag === 'img') {
      // Remote pixels disclose that a message was opened. Attachments remain
      // available through the explicit download flow instead of HTML loading.
      $(element).remove()
      return
    }
    if (tag !== 'a') return
    const href = String($(element).attr('href') || '').trim()
    if (!/^(?:https?:|mailto:)/i.test(href)) {
      $(element).removeAttr('href')
      return
    }
    $(element).attr('rel', 'noreferrer noopener')
    $(element).attr('target', '_blank')
  })
  const makeLinkLabel = (raw) => {
    try {
      const url = new URL(raw)
      if (url.protocol === 'mailto:') return '发送邮件'
      return `打开 ${url.hostname}`
    } catch {
      return '打开链接'
    }
  }
  const escapeHtml = (raw) => String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
  // Plain-text notices frequently include naked URLs. Turn them into compact
  // actions, so they no longer dominate the reading flow like raw text does.
  $('*').contents().each((_index, node) => {
    if (node.type !== 'text' || !node.data || !/https?:\/\//i.test(node.data)) return
    const parentTag = String(node.parent?.tagName || '').toLowerCase()
    if (['a', 'pre', 'code'].includes(parentTag)) return
    const linked = node.data.replace(/https?:\/\/[^\s<>'"`]+/gi, (raw) => {
      const href = raw.replace(/[),.;:!?]+$/, '')
      const suffix = raw.slice(href.length)
      return `<a href="${escapeHtml(href)}" rel="noreferrer noopener">${escapeHtml(makeLinkLabel(href))}</a>${escapeHtml(suffix)}`
    })
    if (linked !== node.data) $(node).replaceWith(linked)
  })
  $('a[href]').each((_index, element) => {
    const link = $(element)
    const href = String(link.attr('href') || '')
    const label = String(link.text() || '').trim()
    link.attr('rel', 'noreferrer noopener').attr('target', '_blank')
    if (!label || label === href || label === href.replace(/^mailto:/i, '')) link.text(makeLinkLabel(href))
  })
  return $.root().html()?.trim() || null
}

function attachmentMetadata(attachments) {
  return (attachments || []).map((item, index) => ({
    index,
    filename: clean(item.filename, 500) || '附件',
    contentType: clean(item.contentType, 200),
    size: Number(item.size) || 0,
  }))
}

export class ImapMailService {
  constructor({ store, vault, onChange = () => {}, onNewMail = () => {}, onDiagnostic = () => {}, openWebmail = async () => false, createClient = (options) => new ImapFlow(options) }) {
    this.store = store
    this.vault = vault
    this.onChange = onChange
    this.onNewMail = onNewMail
    this.onDiagnostic = onDiagnostic
    this.openWebmail = openWebmail
    this.createClient = createClient
    this.timer = null
    this.active = null
  }

  configure(config) {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (!config?.enabled) return
    const minutes = Math.max(1, Math.min(60, Number(config.pollIntervalMinutes) || 5))
    this.timer = setInterval(() => { void this.poll({ notify: true }).catch(() => {}) }, minutes * 60_000)
    void this.poll({ notify: false }).catch(() => {})
  }

  async withClient(credentials, action) {
    const password = credentials.protocolPassword || credentials.password
    if (!credentials?.username || !password) throw new Error('请先保存邮箱密码或客户端授权密码')
    const client = this.createClient({
      host: IMAP_HOST,
      port: IMAP_PORT,
      secure: true,
      auth: { user: credentials.username, pass: password },
      logger: false,
      disableAutoIdle: true,
      socketTimeout: 12_000,
      greetingTimeout: 12_000,
      authTimeout: 12_000,
    })
    const startedAt = Date.now()
    try {
      await client.connect()
      this.onDiagnostic('mail.imap_connected', { elapsedMs: Date.now() - startedAt, host: IMAP_HOST })
      return await action(client)
    } finally {
      await client.logout().catch(() => {})
    }
  }

  async setSourceStatus(source, { runId, attemptedAt, status = 'failed', errorCode = 'imap_poll_failed' } = {}) {
    const completedAt = source?.checkedAt || new Date().toISOString()
    const snapshot = await this.store.update((state) => ({
      ...withDomainProvenance({
        ...state,
        sync: { ...state.sync, sources: { ...state.sync?.sources, mail: source } },
      }, {
        imap: {
          mailbox: sourceDomainOutcome({
            source: 'imap',
            runId,
            attempted: true,
            succeeded: false,
            attemptedAt,
            completedAt,
            status,
            retainedPrevious: domainHasData(state, 'mailbox'),
            completeness: 'unknown',
            parserVersion: IMAP_MAIL_PARSER_VERSION,
            errorCode,
          }),
        },
      }, { runId }),
    }))
    this.onChange(snapshot)
    return snapshot
  }

  async poll({ notify = true, force = false } = {}) {
    if (this.active) return this.active
    const runId = randomUUID()
    const attemptedAt = new Date().toISOString()
    this.active = this.#poll({ notify, force, runId, attemptedAt })
      .catch(async (error) => {
        const now = new Date().toISOString()
        const message = safeError(error)
        const authRequired = isAuthenticationError(error)
        await this.setSourceStatus({ connected: false, checkedAt: now, protocol: 'imap', host: IMAP_HOST, authRequired, error: message }, {
          runId,
          attemptedAt,
          status: authRequired ? 'auth-required' : 'failed',
          errorCode: authRequired ? 'imap_auth_required' : 'imap_poll_failed',
        })
        this.onDiagnostic('mail.imap_failed', { error: message })
        throw error
      })
      .finally(() => { this.active = null })
    return this.active
  }

  async #poll({ notify, force, runId, attemptedAt }) {
    const config = this.store.snapshot().settings.mail
    if (!config?.enabled && !force) return { connected: false, skipped: true }
    const credentials = await this.vault.readCredentials()
    const startedAt = Date.now()
    const mailbox = await this.withClient(credentials, async (client) => {
      const lock = await client.getMailboxLock(MAILBOX)
      try {
        const status = await client.status(MAILBOX, { messages: true })
        const total = Number(status.messages) || 0
        if (!total) return { messages: [], total }
        const start = Math.max(1, total - MAX_MESSAGES + 1)
        const result = []
        for await (const item of client.fetch(`${start}:*`, {
          uid: true,
          envelope: true,
          flags: true,
          internalDate: true,
          bodyStructure: true,
        })) {
          if (!item.uid) continue
          const date = item.internalDate || item.envelope?.date || new Date()
          result.push({
            uid: Number(item.uid),
            subject: clean(item.envelope?.subject, 500) || '(无主题)',
            from: addressLabel(item.envelope?.from),
            fromAddress: addressValue(item.envelope?.from),
            receivedAt: new Date(date).toISOString(),
            unread: !item.flags?.has('\\Seen'),
            attachments: [],
          })
        }
        return {
          messages: result.sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt)),
          total,
        }
      } finally {
        lock.release()
      }
    })
    const messages = mailbox.messages
    const previous = this.store.snapshot().emails || []
    const previousById = new Map(previous.map((item) => [item.id, item]))
    const emails = messages.map((item) => {
      const id = messageId(item.uid)
      const prior = previousById.get(id)
      return {
        ...prior,
        ...item,
        id,
        body: prior?.body || null,
        bodyHtml: prior?.bodyHtml || null,
        bodyHtmlVersion: prior?.bodyHtmlVersion || null,
        attachments: prior?.attachments || item.attachments,
        source: 'imap',
        remoteMarker: `imap:${item.uid}`,
        capturedAt: new Date().toISOString(),
      }
    })
    const known = new Set(previous.map((item) => item.id))
    const newMessages = emails.filter((item) => !known.has(item.id))
    const now = new Date().toISOString()
    const complete = mailbox.total <= MAX_MESSAGES && emails.length === mailbox.total
    const snapshot = await this.store.update((state) => ({
      ...withDomainProvenance({
        ...state,
        emails,
        sync: { ...state.sync, sources: { ...state.sync?.sources, mail: { connected: true, checkedAt: now, protocol: 'imap', host: IMAP_HOST } } },
      }, {
        imap: {
          mailbox: sourceDomainOutcome({
            source: 'imap',
            runId,
            attempted: true,
            succeeded: true,
            attemptedAt,
            completedAt: now,
            capturedAt: now,
            sourceSucceededAt: now,
            emptyConfirmed: complete && emails.length === 0,
            completeness: complete ? 'complete' : 'partial',
            parserVersion: IMAP_MAIL_PARSER_VERSION,
            errorCode: complete ? null : 'imap_result_truncated_or_changed',
          }),
        },
      }, { runId }),
    }))
    this.onChange(snapshot)
    this.onDiagnostic('mail.imap_poll_finished', { count: emails.length, elapsedMs: Date.now() - startedAt, scope: 'all-inbox' })
    if (notify && previous.length) newMessages.forEach((item) => this.onNewMail(item))
    return { connected: true, count: emails.length, newMessages: notify && previous.length ? newMessages : [] }
  }

  async readMessage(id, { refresh = false } = {}) {
    const message = (this.store.snapshot().emails || []).find((item) => item.id === id)
    if (!message) throw new Error('找不到对应的邮件')
    // Older snapshots only have plain text. Refresh them once so existing
    // mail gets the rich, safely-rendered representation as well.
    if (message.bodyHtml && message.bodyHtmlVersion === RICH_MAIL_VERSION && !refresh) return message
    const uid = Number.parseInt(String(message.remoteMarker || '').replace(/^imap:/, ''), 10)
    if (!Number.isSafeInteger(uid) || uid <= 0) throw new Error('该邮件尚未通过 IMAP 同步，请刷新收件箱后重试')
    const credentials = await this.vault.readCredentials()
    const startedAt = Date.now()
    const parsed = await this.withClient(credentials, async (client) => {
      const lock = await client.getMailboxLock(MAILBOX)
      try {
        const result = await client.fetchOne(String(uid), { source: true }, { uid: true })
        if (!result?.source) throw new Error('未能读取邮件正文')
        return simpleParser(result.source)
      } finally {
        lock.release()
      }
    })
    const body = String(parsed.text || '').trim()
    const bodyHtml = sanitizeHtml(parsed.html || parsed.textAsHtml)
    if (!body && !bodyHtml) throw new Error('该邮件未提供可显示的正文')
    const attachments = attachmentMetadata(parsed.attachments)
    const now = new Date().toISOString()
    let updated = null
    const snapshot = await this.store.update((state) => ({
      ...state,
      emails: state.emails.map((item) => {
        if (item.id !== id) return item
        updated = {
          ...item,
          body: body.slice(0, 500_000) || null,
          bodyHtml: bodyHtml?.slice(0, 750_000) || null,
          bodyHtmlVersion: bodyHtml ? RICH_MAIL_VERSION : null,
          attachments,
          unread: false,
          capturedAt: now,
        }
        return updated
      }),
    }))
    this.onChange(snapshot)
    this.onDiagnostic('mail.imap_message_read', { elapsedMs: Date.now() - startedAt, attachmentCount: attachments.length, bodyLength: body.length, htmlLength: bodyHtml?.length || 0 })
    return updated || message
  }

  async downloadAttachment(id, index) {
    const message = (this.store.snapshot().emails || []).find((item) => item.id === id)
    if (!message) throw new Error('找不到对应的邮件')
    const uid = Number.parseInt(String(message.remoteMarker || '').replace(/^imap:/, ''), 10)
    if (!Number.isSafeInteger(uid) || uid <= 0) throw new Error('该邮件尚未通过 IMAP 同步，无法下载附件')
    const attachmentIndex = Number(index)
    if (!Number.isInteger(attachmentIndex) || attachmentIndex < 0) throw new Error('附件编号无效')
    const credentials = await this.vault.readCredentials()
    const startedAt = Date.now()
    const parsed = await this.withClient(credentials, async (client) => {
      const lock = await client.getMailboxLock(MAILBOX)
      try {
        const result = await client.fetchOne(String(uid), { source: true }, { uid: true })
        if (!result?.source) throw new Error('未能读取附件原始邮件')
        return simpleParser(result.source)
      } finally {
        lock.release()
      }
    })
    const attachment = parsed.attachments?.[attachmentIndex]
    if (!attachment?.content) throw new Error('找不到对应附件')
    this.onDiagnostic('mail.imap_attachment_read', {
      elapsedMs: Date.now() - startedAt,
      attachmentIndex,
      bytes: Number(attachment.size) || attachment.content.length || 0,
    })
    return {
      filename: clean(attachment.filename, 500) || '附件',
      contentType: clean(attachment.contentType, 200),
      content: attachment.content,
    }
  }

  async open() {
    return this.openWebmail()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
