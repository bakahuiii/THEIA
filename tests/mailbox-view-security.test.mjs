import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('mail iframe CSP cannot load HTTP images and only trusts current sanitized HTML', async () => {
  const source = await readFile(new URL('../src/views/MailboxView.tsx', import.meta.url), 'utf8')
  assert.match(source, /default-src 'none'; img-src data:; style-src 'unsafe-inline'/)
  assert.doesNotMatch(source, /img-src[^;]*(?:https?:|\*)/i)
  assert.match(source, /currentHtml = Boolean\(mail\.bodyHtml && mail\.bodyHtmlVersion === 4\)/)
  assert.match(source, /setSelected\(currentHtml \? mail : \{ \.\.\.mail, bodyHtml: null \}\)/)
})
