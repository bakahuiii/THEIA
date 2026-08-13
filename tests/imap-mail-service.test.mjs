import test from 'node:test'
import assert from 'node:assert/strict'
import { ImapMailService } from '../core/imap-mail-service.mjs'

test('IMAP sync reads all recent inbox metadata and fetches a body only on demand', async () => {
  let state = {
    settings: { mail: { enabled: true, pollIntervalMinutes: 5 } },
    emails: [],
    sync: { sources: {} },
  }
  let metadataFetches = 0
  let sourceFetches = 0
  let protocolPassword = null
  const createClient = (options) => {
    protocolPassword = options.auth.pass
    return {
    connect: async () => {},
    logout: async () => {},
    getMailboxLock: async () => ({ release: () => {} }),
    status: async () => ({ messages: 2 }),
    async *fetch() {
      metadataFetches += 1
      yield {
        uid: 31,
        envelope: { subject: 'Earlier mail', from: [{ name: '教务处', address: 'office@buct.edu.cn' }], date: new Date('2026-08-10T08:00:00Z') },
        internalDate: new Date('2026-08-10T08:00:00Z'),
        flags: new Set(['\\Seen']),
      }
      yield {
        uid: 32,
        envelope: { subject: 'New mail', from: [{ name: '课程平台', address: 'course@buct.edu.cn' }], date: new Date('2026-08-11T08:00:00Z') },
        internalDate: new Date('2026-08-11T08:00:00Z'),
        flags: new Set(),
      }
    },
    fetchOne: async () => {
      sourceFetches += 1
      return { source: [
        'From: course@buct.edu.cn',
        'Subject: New mail',
        'Content-Type: multipart/mixed; boundary="mail-boundary"',
        '',
        '--mail-boundary',
        'Content-Type: text/html; charset=utf-8',
        '',
        '<style>@import url("https://tracker.example/import.css"); .mail-card { color: #111; padding: 5px; position: fixed; background-image: url(https://tracker.example/background.png); border-image: image-set("https://tracker.example/dense.png" 2x); list-style-image: -webkit-image-set(url(//tracker.example/list.png) 1x); }</style><table class="mail-card" width="600" style="color: #111; padding: 5px; position: fixed; background: url(https://tracker.example/inline.png); border-image: image-set(\"https://tracker.example/inline-dense.png\" 2x)"><tr><td colspan="2">Structured <strong>mail</strong> body <a href="https://buct.edu.cn">with link</a> and https://github.com/example/project</td></tr></table><img src="https://example.test/pixel.png" alt="tracking pixel">',
        '--mail-boundary',
        'Content-Type: text/plain; name="notice.txt"',
        'Content-Disposition: attachment; filename="notice.txt"',
        'Content-Transfer-Encoding: base64',
        '',
        'YXR0YWNobWVudC1jb250ZW50',
        '--mail-boundary--',
      ].join('\r\n') }
    },
    }
  }
  const store = {
    snapshot: () => state,
    update: async (fn) => {
      state = fn(state)
      return state
    },
  }
  const service = new ImapMailService({
    store,
    vault: { readCredentials: async () => ({ username: 'student@buct.edu.cn', password: 'mail-password', protocolPassword: 'client-authorization-password' }) },
    createClient,
  })

  const result = await service.poll({ notify: false })

  assert.equal(result.count, 2)
  assert.equal(protocolPassword, 'client-authorization-password')
  assert.equal(metadataFetches, 1)
  assert.equal(sourceFetches, 0)
  assert.equal(state.emails[0].subject, 'New mail')
  assert.equal(state.emails[0].from, '课程平台')
  assert.equal(state.emails[0].unread, true)
  assert.equal(state.emails[1].unread, false)
  assert.equal(state.sync.domains.mailbox.status, 'succeeded')
  assert.equal(state.sync.domains.mailbox.completeness, 'complete')
  assert.equal(state.sync.domains.mailbox.emptyConfirmed, false)
  assert.equal(state.sync.domains.mailbox.outcomes.imap.parserVersion, 'imap-mail/v1')

  state.emails[0] = {
    ...state.emails[0],
    bodyHtml: '<img src="https://legacy-tracker.example/open.png">',
    bodyHtmlVersion: 3,
  }
  const detail = await service.readMessage(state.emails[0].id)
  assert.equal(sourceFetches, 1)
  assert.equal(detail.body, null)
  assert.match(detail.bodyHtml, /<strong>mail<\/strong>/)
  assert.match(detail.bodyHtml, /打开 github\.com/)
  assert.match(detail.bodyHtml, /width="600"/)
  assert.match(detail.bodyHtml, /class="mail-card"/)
  assert.match(detail.bodyHtml, /<style>[\s\S]*\.mail-card\s*\{[\s\S]*color: #111;[\s\S]*padding: 5px;[\s\S]*background-image: none;[\s\S]*border-image: none;[\s\S]*<\/style>/)
  assert.match(detail.bodyHtml, /color: #111/)
  assert.doesNotMatch(detail.bodyHtml, /position: fixed/)
  assert.doesNotMatch(detail.bodyHtml, /<img\b/i)
  assert.doesNotMatch(detail.bodyHtml, /(?:src\s*=|url\s*\()\s*["']?https?:/i)
  assert.doesNotMatch(detail.bodyHtml, /tracker\.example|example\.test/)
  assert.match(detail.bodyHtml, /<a href="https:\/\/buct\.edu\.cn"[^>]*>with link<\/a>/)
  assert.match(detail.bodyHtml, /打开 github\.com/)
  assert.equal(detail.bodyHtmlVersion, 4)
  assert.equal(detail.attachments[0].index, 0)
  assert.equal(detail.attachments[0].filename, 'notice.txt')

  const attachment = await service.downloadAttachment(state.emails[0].id, 0)
  assert.equal(sourceFetches, 2)
  assert.equal(attachment.filename, 'notice.txt')
  assert.equal(attachment.content.toString(), 'attachment-content')
})
