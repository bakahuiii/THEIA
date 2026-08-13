import test from 'node:test'
import assert from 'node:assert/strict'
import { WebmailService } from '../core/webmail-service.mjs'

function minimalStore() {
  let state = { settings: { mail: { enabled: false, pollIntervalMinutes: 5 } }, emails: [], sync: { sources: {} } }
  return {
    snapshot: () => state,
    update: async (fn) => { state = fn(state); return state },
  }
}

test('mail window blocks untrusted navigation and never fills credentials outside trusted HTTPS hosts', async () => {
  const handlers = new Map()
  let currentUrl = 'https://mail.buct.edu.cn/'
  let executions = 0
  let popupHandler
  const window = {
    isDestroyed: () => false,
    once: () => {},
    on: () => {},
    show: () => {},
    webContents: {
      getURL: () => currentUrl,
      on: (event, handler) => handlers.set(event, handler),
      setWindowOpenHandler: (handler) => { popupHandler = handler },
      executeJavaScript: async () => { executions += 1; return {} },
      session: { cookies: { flushStore: async () => {} }, flushStorageData: async () => {} },
    },
  }
  const service = new WebmailService({
    store: minimalStore(),
    vault: { readCredentials: async () => ({ username: 'student', password: 'secret' }) },
    createWindow: async () => window,
  })
  await service.ensureWindow(false)

  for (const url of [
    'http://mail.buct.edu.cn/login',
    'https://mail.buct.edu.cn.evil.example/login',
    'https://student:secret@mail.buct.edu.cn/login',
    'https://example.com/login',
    'javascript:alert(1)',
    'data:text/html,login',
    'file:///C:/Users/Student/private.html',
  ]) {
    let prevented = false
    handlers.get('will-navigate')?.({ preventDefault: () => { prevented = true } }, url)
    assert.equal(prevented, true, url)
    currentUrl = url
    await assert.rejects(
      service.fillCredentials(window, { username: 'student', password: 'secret' }),
      /trusted HTTPS webmail hosts/,
    )
  }
  let allowedPrevented = false
  handlers.get('will-redirect')?.({ preventDefault: () => { allowedPrevented = true } }, 'https://mailh.qiye.163.com/js6/main.jsp')
  assert.equal(allowedPrevented, false)
  assert.deepEqual(popupHandler?.({ url: 'https://mail.qiye.163.com/app/' }), { action: 'deny' })
  assert.equal(executions, 0)
})

test('manual mailbox refresh uses the persisted enterprise-mail session without saved credentials', async () => {
  let state = {
    settings: { mail: { enabled: false, pollIntervalMinutes: 5 } },
    emails: [],
    sync: { sources: {} },
  }
  let loads = 0
  const diagnostics = []
  const window = {
    isDestroyed: () => false,
    once: () => {},
    on: () => {},
    loadURL: async () => { loads += 1 },
    webContents: {
      getURL: () => 'https://mailh.qiye.163.com/js6/main.jsp',
      on: () => {},
      executeJavaScript: async (script) => {
        assert.match(script, /const pageText/)
        return {
          loginForm: false,
          authenticated: true,
          candidates: 2,
          messages: [
            { marker: 'manual-session-unread', subject: 'New campus notice', snippet: 'Unread mail from browser session', receivedText: '2026-08-11 09:00', unread: true },
            { marker: 'manual-session-read', subject: 'Earlier campus notice', snippet: 'Read mail from browser session', receivedText: '2026-08-10 09:00', unread: false },
          ],
        }
      },
      session: { cookies: { flushStore: async () => {} } },
    },
  }
  const store = {
    snapshot: () => state,
    update: async (fn) => {
      state = fn(state)
      return state
    },
  }
  const service = new WebmailService({
    store,
    vault: { readCredentials: async () => null },
    createWindow: async () => window,
    onDiagnostic: (event, fields) => diagnostics.push({ event, fields }),
  })

  const result = await service.poll({ notify: false, force: true })

  assert.equal(loads, 0)
  assert.equal(result.connected, true)
  assert.equal(state.emails.length, 2)
  assert.equal(state.emails[0].subject, 'New campus notice')
  assert.equal(state.emails[0].unread, true)
  assert.equal(state.emails[1].subject, 'Earlier campus notice')
  assert.equal(state.emails[1].unread, false)
  assert.equal(state.sync.sources.mail.connected, true)
  assert.equal(state.sync.domains.mailbox.status, 'succeeded')
  assert.equal(state.sync.domains.mailbox.completeness, 'partial')
  assert.equal(state.sync.domains.mailbox.emptyConfirmed, false)
  assert.deepEqual(diagnostics.find((entry) => entry.event === 'mail.browser_page_ready')?.fields, {
    force: true,
    credentialsAvailable: false,
  })
  assert.deepEqual(diagnostics.find((entry) => entry.event === 'mail.browser_poll_finished')?.fields, {
    count: 2,
    scope: 'all-inbox',
    preserved: false,
    candidates: 2,
  })
})

test('an authenticated mailbox shell without rendered rows preserves previously fetched mail', async () => {
  let state = {
    settings: { mail: { enabled: true, pollIntervalMinutes: 5 } },
    emails: [{ id: 'mail:existing', subject: 'Previously fetched', unread: false }],
    sync: { sources: {} },
  }
  const diagnostics = []
  const window = {
    isDestroyed: () => false,
    once: () => {},
    on: () => {},
    loadURL: async () => {},
    webContents: {
      getURL: () => 'https://mailh.qiye.163.com/js6/main.jsp',
      on: () => {},
      executeJavaScript: async (script) => {
        assert.match(script, /const pageText/)
        return { loginForm: false, authenticated: true, candidates: 0, messages: [] }
      },
      session: { cookies: { flushStore: async () => {} } },
    },
  }
  const store = {
    snapshot: () => state,
    update: async (fn) => {
      state = fn(state)
      return state
    },
  }
  const service = new WebmailService({
    store,
    vault: { readCredentials: async () => null },
    createWindow: async () => window,
    onDiagnostic: (event, fields) => diagnostics.push({ event, fields }),
  })

  const result = await service.poll({ notify: false })

  assert.equal(result.incomplete, true)
  assert.equal(state.emails.length, 1)
  assert.equal(state.emails[0].subject, 'Previously fetched')
  assert.equal(state.sync.sources.mail.incomplete, true)
  assert.equal(state.sync.domains.mailbox.status, 'succeeded')
  assert.equal(state.sync.domains.mailbox.completeness, 'partial')
  assert.equal(state.sync.domains.mailbox.retainedPrevious, true)
  assert.equal(state.sync.domains.mailbox.emptyConfirmed, false)
  assert.equal(diagnostics.find((entry) => entry.event === 'mail.browser_poll_finished')?.fields.preserved, true)
})

test('only an explicit authenticated empty-mailbox signal confirms an empty mailbox', async () => {
  let state = {
    settings: { mail: { enabled: true, pollIntervalMinutes: 5 } },
    emails: [],
    sync: { sources: {}, domains: {} },
  }
  const window = {
    isDestroyed: () => false,
    once: () => {},
    on: () => {},
    loadURL: async () => {},
    webContents: {
      getURL: () => 'https://mailh.qiye.163.com/js6/main.jsp',
      on: () => {},
      executeJavaScript: async () => ({
        loginForm: false,
        authenticated: true,
        candidates: 1,
        messages: [],
        emptyMailbox: true,
      }),
      session: { cookies: { flushStore: async () => {} } },
    },
  }
  const store = {
    snapshot: () => state,
    update: async (fn) => { state = fn(state); return state },
  }
  const service = new WebmailService({
    store,
    vault: { readCredentials: async () => null },
    createWindow: async () => window,
  })

  const result = await service.poll({ notify: false })

  assert.equal(result.connected, true)
  assert.deepEqual(state.emails, [])
  assert.equal(state.sync.domains.mailbox.status, 'succeeded')
  assert.equal(state.sync.domains.mailbox.completeness, 'complete')
  assert.equal(state.sync.domains.mailbox.emptyConfirmed, true)
})

test('mail content is fetched on demand and cached without re-reading the inbox', async () => {
  let state = {
    settings: { mail: { enabled: true, pollIntervalMinutes: 5 } },
    emails: [{ id: 'mail:detail', subject: 'Campus notice', remoteMarker: 'message-42', body: null }],
    sync: { sources: {} },
  }
  const window = {
    isDestroyed: () => false,
    once: () => {},
    on: () => {},
    webContents: {
      getURL: () => 'https://mailh.qiye.163.com/js6/main.jsp',
      on: () => {},
      mainFrame: {
        frames: [],
        executeJavaScript: async (script) => {
          if (script.includes('const target = JSON.parse')) return { found: true, clicked: true }
          if (script.includes("const selectors = ['#mailContent'")) return { body: 'Structured mail body', candidates: 1 }
          throw new Error(`Unexpected script: ${script.slice(0, 80)}`)
        },
      },
    },
  }
  const store = {
    snapshot: () => state,
    update: async (fn) => {
      state = fn(state)
      return state
    },
  }
  const service = new WebmailService({
    store,
    vault: { readCredentials: async () => null },
    createWindow: async () => window,
  })

  const result = await service.readMessage('mail:detail')

  assert.equal(result.body, 'Structured mail body')
  assert.equal(state.emails[0].body, 'Structured mail body')
})
