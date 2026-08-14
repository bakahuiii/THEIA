import test from 'node:test'
import assert from 'node:assert/strict'

import {
  LEXICAL_DEFAULT_SEARCH_SCOPES,
  LEXICAL_PRIVACY_SCOPES,
  LexicalIndex,
  createLexicalIndex,
  normalizeLexicalTerms,
} from '../core/advisor/lexical-index.mjs'

function fragment(overrides = {}) {
  return {
    documentId: 'notice:1',
    dataset: 'notices',
    entityId: 'entity:1',
    sourceDigest: '1'.repeat(64),
    capturedAt: '2026-08-14T01:00:00.000Z',
    privacyScope: 'public-academic',
    text: '高等数学期末考试安排',
    ...overrides,
  }
}

test('lexical index exposes the six fixed scopes and excludes sensitive scopes by default', () => {
  assert.deepEqual(LEXICAL_PRIVACY_SCOPES, [
    'public-academic', 'private-academic', 'mail-metadata', 'mail-body', 'coursework', 'attachment-text',
  ])
  assert.deepEqual(LEXICAL_DEFAULT_SEARCH_SCOPES, [
    'public-academic', 'private-academic', 'mail-metadata', 'coursework',
  ])

  const index = createLexicalIndex()
  index.upsert(fragment())
  index.upsert(fragment({
    documentId: 'mail-meta:1',
    dataset: 'mailbox',
    entityId: 'mail:1',
    sourceDigest: '2'.repeat(64),
    privacyScope: 'mail-metadata',
    text: '期末考试邮件提醒',
  }))
  index.upsert(fragment({
    documentId: 'mail-body:1',
    dataset: 'mailbox',
    entityId: 'a'.repeat(64),
    entityDigest: 'a'.repeat(64),
    sourceDigest: '3'.repeat(64),
    privacyScope: 'mail-body',
    text: '期末考试正文秘密',
    authorized: true,
  }))
  index.upsert(fragment({
    documentId: 'attachment:1',
    dataset: 'attachments',
    entityId: 'b'.repeat(64),
    entityDigest: 'b'.repeat(64),
    sourceDigest: '4'.repeat(64),
    privacyScope: 'attachment-text',
    text: '期末考试附件秘密',
    authorized: true,
  }))

  const defaults = index.search('期末考试')
  assert.deepEqual(defaults.results.map((item) => item.documentId), ['mail-meta:1', 'notice:1'])
  assert.equal(defaults.results.some((item) => item.privacyScope === 'mail-body'), false)
  assert.equal(defaults.results.some((item) => item.privacyScope === 'attachment-text'), false)
  assert.equal(index.get('mail-body:1'), null)
  assert.equal(index.list().some((item) => item.documentId === 'mail-body:1'), false)

  const bodyOnly = index.search('正文秘密', { privacyScopes: ['mail-body'] })
  assert.deepEqual(bodyOnly.results.map((item) => item.documentId), ['mail-body:1'])
  assert.equal(index.get('mail-body:1', { privacyScopes: ['mail-body'] }).privacyScope, 'mail-body')
})

test('sensitive documents fail closed without explicit, correctly scoped authorization', () => {
  const index = new LexicalIndex()
  const body = fragment({
    documentId: 'mail-body:1',
    dataset: 'mailbox',
    entityId: 'a'.repeat(64),
    entityDigest: 'a'.repeat(64),
    sourceDigest: '3'.repeat(64),
    privacyScope: 'mail-body',
    text: '授权正文',
  })
  assert.throws(() => index.upsert(body), /explicit authorization/)
  assert.throws(() => index.upsert({ ...body, authorization: { granted: true, scope: 'attachment-text' } }), /scope mismatch/)
  assert.throws(() => index.upsert({
    ...body,
    authorization: { granted: true, scope: 'mail-body', entityDigest: 'f'.repeat(64) },
  }), /digest mismatch/)
  assert.equal(index.size, 0)

  const accepted = index.upsert({
    ...body,
    authorization: { granted: true, scope: 'mail-body', entityDigest: 'a'.repeat(64) },
  })
  assert.equal(accepted.status, 'added')
})

test('normalization supports Chinese term recall with deterministic normalized terms', () => {
  const terms = normalizeLexicalTerms('高等数学期末考试 高等数学期末考试')
  assert.equal(terms.includes('考试'), true)
  assert.equal(terms.includes('高等数学期末考试'), true)
  assert.deepEqual(terms, [...terms].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))))

  const index = new LexicalIndex()
  index.upsert(fragment())
  assert.deepEqual(index.search('考试').results.map((item) => item.documentId), ['notice:1'])
})

test('HTML, executable URLs, local paths, and secret assignments are never indexed', () => {
  const index = new LexicalIndex()
  const added = index.upsert(fragment({
    text: '<p>公开考试</p><script>HTML_SCRIPT_SECRET</script> https://evil.invalid/x '
      + 'C:\\Users\\Student\\secret.txt token=TOKEN_SECRET '
      + '[查看](//markdown-relative.example/MARKDOWN_PRIVATE_ROUTE?token=MARKDOWN_LINK_SECRET) '
      + '//bare-relative.example/BARE_PRIVATE_ROUTE?secret=BARE_LINK_SECRET',
  }))
  assert.equal(added.document.text.includes('公开考试'), true)
  assert.equal(added.document.text.includes('查看'), true)
  for (const forbidden of [
    'HTML_SCRIPT_SECRET', 'evil.invalid', 'Student', 'secret.txt', 'TOKEN_SECRET', '<p>', '<script>',
    'markdown-relative.example', 'MARKDOWN_PRIVATE_ROUTE', 'MARKDOWN_LINK_SECRET',
    'bare-relative.example', 'BARE_PRIVATE_ROUTE', 'BARE_LINK_SECRET',
  ]) {
    assert.equal(added.document.text.includes(forbidden), false, forbidden)
    assert.equal(index.search(forbidden).results.length, 0, forbidden)
  }
  assert.equal(added.document.textSanitized, true)

  assert.throws(() => index.upsert(fragment({ documentId: 'bad-html', bodyHtml: '<p>secret</p>' })), /forbidden field/)
  assert.throws(() => index.upsert(fragment({ documentId: 'bad-path', path: 'C:\\private' })), /forbidden field/)
  assert.throws(() => index.upsert(fragment({ documentId: 'bad-url', sourceUrl: 'https://evil.invalid' })), /forbidden field/)
  assert.throws(() => index.upsert(fragment({ documentId: 'bad-buffer', payload: Buffer.from('secret') })), /binary/)
})

test('source-digest upsert replaces postings incrementally and identical fragments are no-ops', () => {
  const index = new LexicalIndex()
  assert.equal(index.upsert(fragment()).status, 'added')
  assert.equal(index.upsert(fragment()).status, 'unchanged')
  assert.deepEqual(index.search('考试').results.map((item) => item.documentId), ['notice:1'])

  const replaced = index.upsert(fragment({
    sourceDigest: '9'.repeat(64),
    text: '高等数学补课安排',
  }))
  assert.equal(replaced.status, 'replaced')
  assert.deepEqual(index.search('考试').results, [])
  assert.deepEqual(index.search('补课').results.map((item) => item.documentId), ['notice:1'])
  assert.equal(index.stats().documents, 1)

  assert.throws(() => index.upsert(fragment({
    sourceDigest: '8'.repeat(64),
    privacyScope: 'private-academic',
    text: '不得原地改变 scope',
  })), /identity fields are immutable/)
  assert.equal(index.get('notice:1').privacyScope, 'public-academic')
})

test('batch fragment replacement can remove missing documents in one isolated dataset scope', () => {
  const index = new LexicalIndex()
  index.upsertMany([
    fragment({ documentId: 'notice:1', entityId: 'entity:1', sourceDigest: '1'.repeat(64) }),
    fragment({ documentId: 'notice:2', entityId: 'entity:2', sourceDigest: '2'.repeat(64), text: '大学物理考试' }),
    fragment({
      documentId: 'grade:1', dataset: 'grades', entityId: 'grade:1', sourceDigest: '3'.repeat(64),
      privacyScope: 'private-academic', text: '大学物理成绩',
    }),
  ])

  const result = index.replaceFragments([
    fragment({ documentId: 'notice:2', entityId: 'entity:2', sourceDigest: '4'.repeat(64), text: '大学物理补考' }),
  ], { removeMissing: true })
  assert.deepEqual(result, { added: 0, replaced: 1, unchanged: 0, removed: 1, size: 2 })
  assert.equal(index.get('notice:1'), null)
  assert.equal(index.get('notice:2').sourceDigest, '4'.repeat(64))
  assert.equal(index.get('grade:1').dataset, 'grades')

  assert.throws(() => index.replaceFragments([
    fragment({ documentId: 'grade:2', dataset: 'grades', entityId: 'grade:2', sourceDigest: '5'.repeat(64), privacyScope: 'private-academic' }),
  ], { removeMissing: true, dataset: 'notices', privacyScope: 'public-academic' }), /must match/)
  assert.equal(index.get('notice:2').sourceDigest, '4'.repeat(64))
})

test('search order is stable by relevance, recency, then canonical document id', () => {
  const index = new LexicalIndex()
  index.upsertMany([
    fragment({ documentId: 'notice:b', entityId: 'entity:b', sourceDigest: 'b'.repeat(64), capturedAt: '2026-08-13T00:00:00.000Z', text: '考试安排' }),
    fragment({ documentId: 'notice:a', entityId: 'entity:a', sourceDigest: 'a'.repeat(64), capturedAt: '2026-08-13T00:00:00.000Z', text: '考试安排' }),
    fragment({ documentId: 'notice:new', entityId: 'entity:new', sourceDigest: 'c'.repeat(64), capturedAt: '2026-08-14T00:00:00.000Z', text: '考试安排' }),
    fragment({ documentId: 'notice:strong', entityId: 'entity:strong', sourceDigest: 'd'.repeat(64), capturedAt: '2026-08-12T00:00:00.000Z', text: '考试考试安排' }),
  ])
  const first = index.search('考试')
  const second = index.search('考试')
  assert.deepEqual(first, second)
  assert.deepEqual(first.results.map((item) => item.documentId), [
    'notice:strong', 'notice:new', 'notice:a', 'notice:b',
  ])
})

test('document, query, result-count, and result-character limits are explicit', () => {
  const index = new LexicalIndex({
    maxFragmentChars: 12,
    maxQueryChars: 4,
    maxResults: 2,
    maxResultChars: 7,
    maxExcerptChars: 5,
  })
  const added = index.upsert(fragment({ text: `考试${'长'.repeat(30)}` }))
  assert.equal(added.document.textTruncated, true)
  assert.equal(Array.from(added.document.text).length, 12)
  index.upsert(fragment({ documentId: 'notice:2', entityId: 'entity:2', sourceDigest: '2'.repeat(64), text: '考试第二项' }))
  index.upsert(fragment({ documentId: 'notice:3', entityId: 'entity:3', sourceDigest: '3'.repeat(64), text: '考试第三项' }))

  const result = index.search('考试多余查询', { maxResults: 2, maxResultChars: 7, maxExcerptChars: 5 })
  assert.equal(result.query, '考试多余')
  assert.equal(result.results.length, 2)
  assert.equal(result.truncation.truncated, true)
  assert.equal(result.truncation.queryInputChars > result.truncation.queryOutputChars, true)
  assert.equal(result.truncation.emittedChars <= 7, true)
  assert.equal(result.truncation.omittedForLimit + result.truncation.omittedForCharacters > 0, true)
})

test('index rejects invalid scopes, paths in identifiers, malformed digests, and ambiguous timestamps', () => {
  const index = new LexicalIndex()
  assert.throws(() => index.upsert(fragment({ privacyScope: 'all-mail' })), /Unsupported lexical privacy scope/)
  assert.throws(() => index.upsert(fragment({ documentId: 'C:\\private\\index' })), /controlled identifier/)
  assert.throws(() => index.upsert(fragment({ sourceDigest: 'not-a-digest' })), /SHA-256/)
  assert.throws(() => index.upsert(fragment({ capturedAt: '2026-08-14 09:00' })), /explicit UTC offset/)
  assert.equal(index.size, 0)
})
