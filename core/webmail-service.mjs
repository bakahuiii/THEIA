import { createHash, randomUUID } from 'node:crypto'
import { domainHasData, sourceDomainOutcome, withDomainProvenance } from './domain-provenance.mjs'
import { sanitizeDiagnosticText } from './util.mjs'

const WEBMAIL_URL = 'https://mail.buct.edu.cn/'
const WEBMAIL_HOSTS = new Set(['mail.buct.edu.cn', 'mailh.qiye.163.com', 'mail.qiye.163.com'])
const LOGIN_BUTTON = /(?:\u767b\u5f55|login|submit)/i
const ACCOUNT_FIELD = /(?:user|account|email|name|uid|\u8d26\u53f7|\u90ae\u7bb1)/i
const MAILBOX_SIGNAL = /(?:\u6536\u4ef6\u7bb1|\u5199\u4fe1|\u9000\u51fa|\u90ae\u4ef6\u5217\u8868|\u53d1\u4ef6\u7bb1)/
const MAIL_LIST_SIGNAL = /(?:\u90ae\u4ef6|\u6536\u4ef6\u7bb1|\u53d1\u4ef6\u4eba|\u4e3b\u9898)/
const WEBMAIL_PARSER_VERSION = 'webmail-dom/v1'
const TEXT = {
  mailReadFailed: '\u90ae\u7bb1\u9875\u9762\u8bfb\u53d6\u5931\u8d25',
  loginRequired: '\u8bf7\u5728\u5185\u7f6e\u90ae\u7bb1\u7a97\u53e3\u5b8c\u6210\u767b\u5f55',
  noSubject: '(\u65e0\u4e3b\u9898)',
  campusMail: '\u6821\u56ed\u90ae\u7bb1',
}

function clean(value, limit = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit) || null
}

function idFor(marker, index) {
  return `mail:${createHash('sha256').update(`${marker}\u0000${index}`).digest('hex').slice(0, 32)}`
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function isWebmailUrl(value) {
  try {
    const url = new URL(String(value || ''))
    return url.protocol === 'https:'
      && WEBMAIL_HOSTS.has(url.hostname)
      && !url.username
      && !url.password
      && (!url.port || url.port === '443')
  } catch {
    return false
  }
}

function isMailboxAppUrl(value) {
  try {
    const url = new URL(String(value || ''))
    return isWebmailUrl(url) && /\/(?:js6|webmail|app)(?:\/|$)/i.test(url.pathname) && !/login|auth/i.test(url.pathname)
  } catch {
    return false
  }
}

export class WebmailService {
  constructor({ store, vault, createWindow, onChange = () => {}, onNewMail = () => {}, onDiagnostic = () => {}, pollOnNavigation = true }) {
    this.store = store
    this.vault = vault
    this.createWindow = createWindow
    this.onChange = onChange
    this.onNewMail = onNewMail
    this.onDiagnostic = onDiagnostic
    this.pollOnNavigation = pollOnNavigation
    this.window = null
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

  async ensureWindow(show = false) {
    if (!this.window || this.window.isDestroyed()) {
      this.window = await this.createWindow({ show })
      let navigationTimer = null
      const scheduleSessionRead = (url) => {
        if (!this.pollOnNavigation) return
        if (!isWebmailUrl(url)) return
        if (navigationTimer) clearTimeout(navigationTimer)
        navigationTimer = setTimeout(() => {
          navigationTimer = null
          this.onDiagnostic('mail.browser_navigation_detected')
          void this.poll({ notify: true, force: true }).catch(() => {})
        }, 800)
      }
      const preventUnsafeNavigation = (event, url) => {
        if (isWebmailUrl(url)) return
        event?.preventDefault?.()
        this.onDiagnostic('mail.browser_navigation_blocked', { url: sanitizeDiagnosticText(url, 500) })
      }
      this.window.webContents.on('will-navigate', preventUnsafeNavigation)
      this.window.webContents.on('will-redirect', preventUnsafeNavigation)
      this.window.webContents.setWindowOpenHandler?.(({ url }) => {
        this.onDiagnostic('mail.browser_popup_blocked', { url: sanitizeDiagnosticText(url, 500) })
        return { action: 'deny' }
      })
      this.window.webContents.on('did-navigate', (_event, url, _status, _statusText, isMainFrame) => {
        if (isMainFrame) scheduleSessionRead(url)
      })
      this.window.webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
        if (isMainFrame) scheduleSessionRead(url)
      })
      this.window.once('close', () => {
        if (navigationTimer) clearTimeout(navigationTimer)
        const browserSession = this.window?.webContents?.session
        void browserSession?.cookies?.flushStore?.().catch(() => {})
        void browserSession?.flushStorageData?.().catch(() => {})
      })
      this.window.on('closed', () => { this.window = null })
    }
    if (show) this.window.show()
    return this.window
  }

  async open() {
    const window = await this.ensureWindow(true)
    if (!isWebmailUrl(window.webContents.getURL())) await window.loadURL(WEBMAIL_URL)
    this.onDiagnostic('mail.browser_window_opened')
    return true
  }

  async fillCredentials(window, credentials) {
    if (!isWebmailUrl(window?.webContents?.getURL?.())) {
      throw new Error('Refusing to fill mail credentials outside the trusted HTTPS webmail hosts')
    }
    const payload = JSON.stringify(JSON.stringify(credentials))
    return window.webContents.executeJavaScript(`(() => {
      const credentials = JSON.parse(${payload})
      const visible = (node) => node && node.getClientRects().length > 0 && !node.disabled
      const password = [...document.querySelectorAll('input[type="password"]')].find(visible)
      if (!password) {
        const toggle = document.querySelector('#qrcode-toggle, .qrcode-toggle, [data-login-mode="password"]')
        if (toggle && visible(toggle)) {
          toggle.click()
          return { mode: 'qr', switchedToPassword: true, submitted: false, accountFound: false, passwordFound: false, submitFound: false }
        }
        return { mode: 'unknown', switchedToPassword: false, submitted: false, accountFound: false, passwordFound: false, submitFound: false }
      }
      const inputs = [...document.querySelectorAll('input')].filter(visible)
      const account = inputs.find((node) => node !== password && ${ACCOUNT_FIELD}.test([node.name, node.id, node.placeholder].join(' ')))
        || inputs.find((node) => node !== password && /^(text|email)$/i.test(node.type || 'text'))
      if (!account) return { mode: 'password', switchedToPassword: false, submitted: false, accountFound: false, passwordFound: true, submitFound: false }
      const setValue = (node, value) => {
        const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
        descriptor?.set?.call(node, value)
        node.dispatchEvent(new Event('input', { bubbles: true }))
        node.dispatchEvent(new Event('change', { bubbles: true }))
      }
      setValue(account, credentials.username)
      setValue(password, credentials.password)
      const submit = [...document.querySelectorAll('button, input[type="submit"], a, [role="button"]')]
        .find((node) => visible(node) && ${LOGIN_BUTTON}.test([node.textContent, node.value, node.className, node.id].join(' ').replace(/\\s+/g, '')))
      if (!submit) return { mode: 'password', switchedToPassword: false, submitted: false, accountFound: true, passwordFound: true, submitFound: false }
      submit.click()
      return { mode: 'password', switchedToPassword: false, submitted: true, accountFound: true, passwordFound: true, submitFound: true }
    })()`)
  }

  async readInbox(window) {
    const script = `(() => {
      const visible = (node) => node && node.getClientRects().length > 0
      const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\\s+/g, ' ').trim()
      const pageText = text(document.body)
      const address = new URL(location.href)
      const loginShell = ['#loginform', '#login-mod-wrapper', '#qrcode-login-box', '#mobileform']
        .find((selector) => { const node = document.querySelector(selector); return node && visible(node) }) || null
      const loginRoute = address.hostname === 'mail.buct.edu.cn' || /\\/(?:login|auth)(?:\\/|$)|domainEntLogin/i.test(address.pathname)
      const loginForm = Boolean(loginShell) || [...document.querySelectorAll('input[type="password"]')].some(visible)
      if (loginForm || loginRoute) return { loginForm: true, authenticated: false, loginShell, loginRoute, candidates: 0, messages: [] }
      const selectors = [
        '[data-uid]', '[data-mid]', '[data-msgid]', '[mid]', '[role="row"]', 'tr',
        '#mailList > *', '[class*="mail-list"] > *', '[class*="maillist"] > *',
        '[class*="mail-item"]', '[class*="mailitem"]', '[class*="letter-item"]', '.letter',
      ]
      const seen = new Set()
      const messages = []
      let candidates = 0
      const firstText = (node, selectors) => {
        for (const selector of selectors) {
          const value = text(node.querySelector(selector))
          if (value) return value
        }
        return ''
      }
      const looksLikeDate = (value) => /(?:20\\d{2}[-/.]\\d{1,2}[-/.]\\d{1,2}|\\d{1,2}:\\d{2}|\u6628\u5929|\u524d\u5929|\u521a\u521a)/.test(value)
      for (const selector of selectors) for (const node of document.querySelectorAll(selector)) {
        if (!visible(node)) continue
        candidates += 1
        const line = text(node)
        if (!line || line.length < 4 || line.length > 2000) continue
        const marker = node.getAttribute('data-uid') || node.getAttribute('data-mid') || node.getAttribute('data-msgid') || node.getAttribute('mid') || line
        if (seen.has(marker)) continue
        const links = [...node.querySelectorAll('a')].filter(visible)
        const cells = [...node.querySelectorAll('td')].map(text).filter(Boolean)
        const title = firstText(node, ['[data-field="subject"]', '[class*="subject"]', '[class*="mail-title"]', '[class*="mailtitle"]', '[class*="title"]'])
          || text(links.find((link) => text(link).length >= 2) || node.querySelector('[title]'))
          || cells.find((value) => !looksLikeDate(value) && value.length >= 2 && value.length <= 300)
          || line.split(/\\s{2,}|\u8def/)[0]
        const date = line.match(/20\\d{2}[-/.]\\d{1,2}[-/.]\\d{1,2}(?:\\s+\\d{1,2}:\\d{2})?|\\d{1,2}:\\d{2}/)?.[0] || null
        if (!title || (!date && !${MAIL_LIST_SIGNAL}.test(pageText))) continue
        seen.add(marker)
        const sender = firstText(node, ['[data-field="from"]', '[class*="sender"]', '[class*="from"]', '[class*="mail-from"]', '[class*="mailfrom"]'])
          || cells.find((value) => value !== title && !looksLikeDate(value) && value.length >= 2 && value.length <= 160)
          || ''
        const preview = firstText(node, ['[data-field="preview"]', '[class*="preview"]', '[class*="snippet"]', '[class*="summary"]', '[class*="abstract"]'])
        messages.push({ marker, subject: title.slice(0, 500), from: sender.slice(0, 240), snippet: preview.slice(0, 500), receivedText: date, unread: /(?:\u672a\u8bfb|\\bunread\\b)/i.test(String(node.className) + ' ' + line) })
        if (messages.length >= 120) break
      }
      return { loginForm: false, authenticated: !loginShell && !loginRoute && ${MAILBOX_SIGNAL}.test(pageText), loginShell, loginRoute, candidates, messages, emptyMailbox: /(?:\u6682\u65e0\u90ae\u4ef6|\u65e0\u90ae\u4ef6|\u6ca1\u6709\u90ae\u4ef6|no\\s+messages)/i.test(pageText) }
    })()`
    const mainFrame = window.webContents.mainFrame
    const frames = mainFrame ? [mainFrame, ...(mainFrame.frames || [])] : [window.webContents]
    let best = null
    const frameSummaries = []
    for (const [frameIndex, frame] of frames.entries()) {
      try {
        const result = await frame.executeJavaScript(script)
        const candidate = {
          ...result,
          messages: Array.isArray(result?.messages) ? result.messages : [],
          candidates: Math.max(0, Number(result?.candidates) || 0),
          emptyMailbox: Boolean(result?.emptyMailbox),
          frameIndex,
        }
        frameSummaries.push({ frameIndex, authenticated: Boolean(candidate.authenticated), loginForm: Boolean(candidate.loginForm), candidates: candidate.candidates, messages: candidate.messages.length })
        const score = candidate.messages.length * 10_000 + candidate.candidates * 10 + (candidate.authenticated ? 1 : 0)
        const bestScore = best ? best.messages.length * 10_000 + best.candidates * 10 + (best.authenticated ? 1 : 0) : -1
        if (score > bestScore) best = candidate
      } catch {
        // Cross-origin and detached frames are expected during mailbox startup.
      }
    }
    return {
      ...(best || { loginForm: true, authenticated: false, candidates: 0, messages: [] }),
      framesScanned: frames.length,
      frameSummary: frameSummaries.map((entry) => `${entry.frameIndex}:${entry.authenticated ? 'a' : entry.loginForm ? 'l' : '-'}:${entry.candidates}/${entry.messages}`).join(','),
    }
  }

  async openInbox(window) {
    const script = `(() => {
      const visible = (node) => node && node.getClientRects().length > 0 && !node.disabled
      const normalize = (value) => String(value || '').replace(/\\s+/g, '')
      const isInbox = (value) => /^(?:\u6536\u4ef6\u7bb1|\u5168\u90e8\u90ae\u4ef6|\u6240\u6709\u90ae\u4ef6)(?:[（(]\\d+[）)])?$/.test(normalize(value))
      const nodes = [...document.querySelectorAll('a, button, [role="button"], [role="treeitem"], li, div, span')]
      const target = nodes.filter((node) => visible(node) && isInbox(node.textContent))
        .sort((left, right) => normalize(left.textContent).length - normalize(right.textContent).length)[0]
      if (!target) return { found: false, clicked: false }
      target.click()
      return { found: true, clicked: true, tag: target.tagName, id: target.id || null }
    })()`
    const mainFrame = window.webContents.mainFrame
    const frames = mainFrame ? [mainFrame, ...(mainFrame.frames || [])] : [window.webContents]
    for (const [frameIndex, frame] of frames.entries()) {
      try {
        const result = await frame.executeJavaScript(script)
        if (result?.clicked) return { ...result, frameIndex }
      } catch {
        // The portal can include detached and cross-origin frames before the inbox opens.
      }
    }
    return { found: false, clicked: false }
  }

  async openMessage(window, message) {
    const payload = JSON.stringify(JSON.stringify({ marker: message.remoteMarker || '', subject: message.subject || '' }))
    const script = `(() => {
      const target = JSON.parse(${payload})
      const visible = (node) => node && node.getClientRects().length > 0 && !node.disabled
      const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\\s+/g, ' ').trim()
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim()
      const nodes = [...document.querySelectorAll('[data-uid], [data-mid], [data-msgid], [mid], [role="row"], tr, [class*="mail-item"], [class*="mailitem"], [class*="letter-item"], .letter')]
      const node = nodes.find((candidate) => {
        if (!visible(candidate)) return false
        const marker = candidate.getAttribute('data-uid') || candidate.getAttribute('data-mid') || candidate.getAttribute('data-msgid') || candidate.getAttribute('mid') || ''
        return (target.marker && marker === target.marker) || (target.subject && normalize(text(candidate)).includes(normalize(target.subject)))
      })
      if (!node) return { found: false, clicked: false }
      const clickable = node.closest('tr, [role="row"], [class*="mail-item"], [class*="mailitem"], [class*="letter-item"], .letter') || node
      clickable.click()
      return { found: true, clicked: true, tag: clickable.tagName, id: clickable.id || null }
    })()`
    const mainFrame = window.webContents.mainFrame
    const frames = mainFrame ? [mainFrame, ...(mainFrame.frames || [])] : [window.webContents]
    for (const [frameIndex, frame] of frames.entries()) {
      try {
        const result = await frame.executeJavaScript(script)
        if (result?.clicked) return { ...result, frameIndex }
      } catch {
        // A mailbox can replace its list frame while a message is opening.
      }
    }
    return { found: false, clicked: false }
  }

  async readMessageBody(window) {
    const script = `(() => {
      const visible = (node) => node && node.getClientRects().length > 0
      const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\\r/g, '').replace(/\\n{3,}/g, '\\n\\n').trim()
      const selectors = ['#mailContent', '#mailcontent', '[id*="mailContent"]', '[id*="mailcontent"]', '[class*="mail-content"]', '[class*="mailcontent"]', '[class*="mail-body"]', '[class*="mailbody"]', '[class*="letter-content"]', '[class*="lettercontent"]', '[class*="message-content"]']
      const candidates = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]).filter(visible)
      const body = candidates.map(text).filter((value) => value.length >= 20).sort((left, right) => right.length - left.length)[0] || ''
      return { body: body.slice(0, 200000), candidates: candidates.length }
    })()`
    const mainFrame = window.webContents.mainFrame
    const frames = mainFrame ? [mainFrame, ...(mainFrame.frames || [])] : [window.webContents]
    let best = { body: '', candidates: 0, frameIndex: null }
    for (const [frameIndex, frame] of frames.entries()) {
      try {
        const result = await frame.executeJavaScript(script)
        if (String(result?.body || '').length > best.body.length) best = { body: String(result.body), candidates: Number(result.candidates) || 0, frameIndex }
      } catch {
        // Detached frames are normal while NetEase swaps the reading pane.
      }
    }
    return best
  }

  async readMessage(id) {
    const message = (this.store.snapshot().emails || []).find((item) => item.id === id)
    if (!message) throw new Error('\u627e\u4e0d\u5230\u5bf9\u5e94\u7684\u90ae\u4ef6')
    if (message.body) return message
    const window = await this.ensureWindow(false)
    let opened = await this.openMessage(window, message)
    if (!opened.clicked) {
      await this.openInbox(window)
      await wait(250)
      opened = await this.openMessage(window, message)
    }
    this.onDiagnostic('mail.browser_message_open_requested', { found: opened.found, clicked: opened.clicked, frameIndex: opened.frameIndex ?? null })
    if (!opened.clicked) throw new Error('\u90ae\u4ef6\u5217\u8868\u672a\u52a0\u8f7d\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5')
    let detail = { body: '', candidates: 0, frameIndex: null }
    for (const delay of [150, 400, 900]) {
      await wait(delay)
      detail = await this.readMessageBody(window)
      if (detail.body) break
    }
    this.onDiagnostic('mail.browser_message_body_read', { found: Boolean(detail.body), length: detail.body.length, frameIndex: detail.frameIndex, candidates: detail.candidates })
    if (!detail.body) throw new Error('\u90ae\u4ef6\u6b63\u6587\u5c1a\u672a\u52a0\u8f7d\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5')
    const now = new Date().toISOString()
    let updated = null
    const snapshot = await this.store.update((state) => ({
      ...state,
      emails: state.emails.map((item) => {
        if (item.id !== id) return item
        updated = { ...item, body: detail.body, capturedAt: now }
        return updated
      }),
    }))
    this.onChange(snapshot)
    return updated || message
  }

  async setSourceStatus(source, { runId = randomUUID(), attemptedAt = null, status = 'failed', errorCode = 'webmail_poll_failed' } = {}) {
    const snapshot = await this.store.update((state) => ({
      ...withDomainProvenance({
        ...state,
        sync: { ...state.sync, sources: { ...state.sync?.sources, mail: source } },
      }, {
        webmail: {
          mailbox: sourceDomainOutcome({
            source: 'webmail',
            runId,
            attempted: true,
            succeeded: false,
            attemptedAt: attemptedAt || source?.checkedAt,
            completedAt: source?.checkedAt,
            status,
            retainedPrevious: domainHasData(state, 'mailbox'),
            completeness: 'unknown',
            parserVersion: WEBMAIL_PARSER_VERSION,
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
        const message = clean(error?.message || error, 240) || TEXT.mailReadFailed
        await this.setSourceStatus({ connected: false, checkedAt: now, url: WEBMAIL_URL, error: message }, {
          runId,
          attemptedAt,
          errorCode: 'webmail_poll_failed',
        })
        this.onDiagnostic('mail.browser_poll_failed', { error: message })
        throw error
      })
      .finally(() => { this.active = null })
    return this.active
  }

  async #poll({ notify, force, runId, attemptedAt }) {
    const config = this.store.snapshot().settings.mail
    const credentials = await this.vault.readCredentials()
    if (!config?.enabled && !force) return { connected: false, skipped: true }

    const window = await this.ensureWindow(false)
    if (!isWebmailUrl(window.webContents.getURL())) await window.loadURL(WEBMAIL_URL)
    this.onDiagnostic('mail.browser_page_ready', { force, credentialsAvailable: Boolean(credentials) })

    let fill = null
    // A running mailbox already has a valid session. Re-submitting credentials
    // there can restart its shell and is the main source of needless latency.
    if (credentials && !isMailboxAppUrl(window.webContents.getURL())) {
      for (const delay of [0, 300, 800]) {
        if (delay) await wait(delay)
        fill = await this.fillCredentials(window, credentials)
        this.onDiagnostic('mail.browser_login_view', {
          attemptDelayMs: delay,
          mode: fill.mode,
          switchedToPassword: fill.switchedToPassword,
          accountFound: fill.accountFound,
          passwordFound: fill.passwordFound,
          submitFound: fill.submitFound,
          submitted: fill.submitted,
        })
        if (fill.submitted || !fill.switchedToPassword) break
      }
    }
    if (fill?.submitted) {
      this.onDiagnostic('mail.browser_credentials_submitted')
    }

    let result = null
    const readDelays = fill?.submitted ? [250, 750, 1_500] : [0]
    for (const delay of readDelays) {
      if (delay) await wait(delay)
      result = await this.readInbox(window)
      this.onDiagnostic('mail.browser_inbox_read', {
        attemptDelayMs: delay,
        loginForm: result.loginForm,
        authenticated: result.authenticated,
        loginRoute: result.loginRoute,
        loginShell: result.loginShell,
        candidates: result.candidates,
        frameIndex: result.frameIndex,
        framesScanned: result.framesScanned,
        frameSummary: result.frameSummary,
        count: result.messages.length,
      })
      if (result.messages.length > 0 || result.candidates > 0 || !fill?.submitted) break
    }
    if (result.authenticated && result.messages.length === 0 && result.candidates === 0) {
      const inbox = await this.openInbox(window)
      this.onDiagnostic('mail.browser_inbox_open_requested', inbox)
      if (inbox.clicked) {
        for (const delay of [350, 850, 1_600]) {
          await wait(delay)
          result = await this.readInbox(window)
          this.onDiagnostic('mail.browser_inbox_read', {
            attemptDelayMs: delay,
            inboxRequested: true,
            loginForm: result.loginForm,
            authenticated: result.authenticated,
            loginRoute: result.loginRoute,
            loginShell: result.loginShell,
            candidates: result.candidates,
            frameIndex: result.frameIndex,
            framesScanned: result.framesScanned,
            frameSummary: result.frameSummary,
            count: result.messages.length,
          })
          if (result.messages.length > 0 || result.candidates > 0) break
        }
      }
    }
    if (result.loginForm || !result.authenticated) {
      const now = new Date().toISOString()
      await this.setSourceStatus({ connected: false, checkedAt: now, url: WEBMAIL_URL, authRequired: true, error: TEXT.loginRequired }, {
        runId,
        attemptedAt,
        status: 'auth-required',
        errorCode: 'webmail_auth_required',
      })
      this.onDiagnostic('mail.browser_auth_required', { stage: fill?.mode || 'unknown' })
      return { connected: false, authRequired: true, message: TEXT.loginRequired }
    }

    await window.webContents.session.cookies.flushStore().catch(() => {})

    const previous = this.store.snapshot().emails || []
    const hasUnverifiedEmptyResult = result.messages.length === 0 && !result.emptyMailbox
    const now = new Date().toISOString()
    // An authenticated portal shell can render before its inbox frame. That is not
    // evidence of an empty mailbox, so never erase a successful local snapshot.
    if (hasUnverifiedEmptyResult) {
      const snapshot = await this.store.update((state) => ({
        ...withDomainProvenance({
          ...state,
          sync: {
            ...state.sync,
            sources: {
              ...state.sync?.sources,
              mail: {
                connected: previous.length > 0,
                checkedAt: now,
                url: WEBMAIL_URL,
                incomplete: true,
                error: '\u6536\u4ef6\u7bb1\u5217\u8868\u5c1a\u672a\u52a0\u8f7d\uff0c\u5df2\u4fdd\u7559\u4e0a\u6b21\u6210\u529f\u6536\u53d6\u7ed3\u679c',
              },
            },
          },
        }, {
          webmail: {
            mailbox: sourceDomainOutcome({
              source: 'webmail',
              runId,
              attempted: true,
              succeeded: true,
              attemptedAt,
              completedAt: now,
              retainedPrevious: previous.length > 0,
              completeness: 'partial',
              parserVersion: WEBMAIL_PARSER_VERSION,
              errorCode: 'webmail_list_incomplete',
            }),
          },
        }, { runId }),
      }))
      this.onChange(snapshot)
      this.onDiagnostic('mail.browser_poll_finished', {
        count: previous.length,
        scope: 'all-inbox',
        preserved: true,
        candidates: result.candidates,
      })
      return { connected: previous.length > 0, count: previous.length, incomplete: true, newMessages: [] }
    }

    const known = new Set(previous.map((item) => item.id))
    const previousById = new Map(previous.map((item) => [item.id, item]))
    const emails = result.messages.map((item, index) => ({
      ...(previousById.get(idFor(item.marker, index)) || {}),
      id: idFor(item.marker, index),
      subject: item.subject || TEXT.noSubject,
      from: item.from || TEXT.campusMail,
      receivedAt: item.receivedText || now,
      snippet: item.snippet,
      body: previousById.get(idFor(item.marker, index))?.body || null,
      unread: Boolean(item.unread),
      attachments: previousById.get(idFor(item.marker, index))?.attachments || [],
      source: 'webmail',
      remoteMarker: clean(item.marker, 2_000),
      capturedAt: now,
    }))
    const newMessages = emails.filter((item) => !known.has(item.id))
    const snapshot = await this.store.update((state) => ({
      ...withDomainProvenance({
        ...state,
        emails,
        sync: { ...state.sync, sources: { ...state.sync?.sources, mail: { connected: true, checkedAt: now, url: WEBMAIL_URL } } },
      }, {
        webmail: {
          mailbox: sourceDomainOutcome({
            source: 'webmail',
            runId,
            attempted: true,
            succeeded: true,
            attemptedAt,
            completedAt: now,
            capturedAt: now,
            sourceSucceededAt: now,
            emptyConfirmed: result.emptyMailbox === true && emails.length === 0,
            completeness: result.emptyMailbox === true && emails.length === 0 ? 'complete' : 'partial',
            parserVersion: WEBMAIL_PARSER_VERSION,
          }),
        },
      }, { runId }),
    }))
    this.onChange(snapshot)
    this.onDiagnostic('mail.browser_poll_finished', { count: emails.length, scope: 'all-inbox', preserved: false, candidates: result.candidates })
    if (notify && previous.length) newMessages.forEach((item) => this.onNewMail(item))
    return { connected: true, count: emails.length, newMessages: notify && previous.length ? newMessages : [] }
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = null
  }

  async stopAndWait() {
    const active = this.active
    this.stop()
    await Promise.allSettled(active ? [active] : [])
  }
}
