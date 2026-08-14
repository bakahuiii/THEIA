import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildNoticeMailContext,
  createLexicalIndex,
  mailBodyEntityDigest,
  searchLexicalIndex,
} from '../core/advisor/index.mjs'
import { AdvisorRuntime, AdvisorRuntimeError } from '../electron/advisor-runtime.mjs'
import { versionedState } from './fixtures/advisor-fixtures.mjs'

const MODEL_BASE_URL = 'https://models.example.test/v1'
const MODEL_ID = 'advisor-p5-test-model'

function validNarrative() {
  return JSON.stringify({
    schema: 'theia-advisor-model-narrative/v1',
    blocks: [],
    recommendations: [],
    uncertainties: [],
    questionsForUser: [],
    suggestedActionIds: [],
  })
}

function monotonicClock(start = '2026-08-14T05:00:00.000Z') {
  let now = Date.parse(start)
  return () => new Date(now += 1_000).toISOString()
}

function configuredState(overrides = {}) {
  return versionedState({
    settings: {
      modelBaseUrl: MODEL_BASE_URL,
      modelName: MODEL_ID,
    },
    ...overrides,
  })
}

function harness(versioned = configuredState(), store = null, responder = null) {
  const requests = []
  const lexicalIndex = createLexicalIndex()
  const provider = {
    async generate(request) {
      requests.push(structuredClone(request))
      const text = responder ? responder(request) : validNarrative()
      return {
        text,
        inputBytes: Buffer.byteLength(JSON.stringify(request.messages), 'utf8'),
        outputBytes: Buffer.byteLength(text, 'utf8'),
      }
    },
  }
  const runtime = new AdvisorRuntime({
    store: store || { snapshotWithRevision: () => versioned },
    clock: monotonicClock(),
    providerFactory: () => provider,
    lexicalIndex,
  })
  return { runtime, requests, lexicalIndex }
}

function mutableStore(initial) {
  let current = initial
  return {
    snapshotWithRevision: () => current,
    replace(next) {
      current = next
    },
  }
}

async function prepare(runtime, overrides = {}) {
  const thread = runtime.createThread()
  const prepared = await runtime.prepare({
    threadId: thread.id,
    question: '请分析本次明确选择的数据。',
    intent: 'general',
    ...overrides,
  })
  return { thread, prepared }
}

function outboundContext(requests) {
  assert.equal(requests.length, 1)
  return JSON.parse(requests[0].messages[1].content)
}

function hasCode(code) {
  return (error) => error instanceof AdvisorRuntimeError && error.code === code
}

test('public advisor entrypoint exposes P5 context and in-memory lexical APIs', () => {
  const context = buildNoticeMailContext({})
  assert.equal(context.schema, 'theia-advisor-notice-mail-context/v1')

  const index = createLexicalIndex()
  assert.equal(index.stats().documents, 0)
  assert.deepEqual(searchLexicalIndex(index, 'anything').results, [])
})

test('runtime sends only explicitly selected P5 notice projection and inert local signals', async () => {
  const selected = {
    id: 'notice-selected',
    title: '<b>高等数学通知</b> [详情](//notice-title-relative.example/NOTICE_TITLE_ROUTE?token=NOTICE_TITLE_SECRET)',
    summary: '请于 2026年8月16日 14:30 提交材料。访问 https://evil.invalid/?token=NOTICE_URL_SECRET\u202e //notice-summary-relative.example/NOTICE_SUMMARY_ROUTE?secret=NOTICE_SUMMARY_SECRET',
    publishedAt: '2026-08-14T01:00:00.000Z',
    source: 'theol',
    sourceUrl: 'https://course.buct.edu.cn/private?token=SOURCE_URL_SECRET',
  }
  const hidden = {
    id: 'notice-hidden',
    title: 'UNSELECTED_NOTICE_SECRET',
    summary: 'UNSELECTED_NOTICE_BODY_SECRET',
    source: 'theol',
  }
  const { runtime, requests } = harness(configuredState({
    courses: [{ id: 'course-1', title: '高等数学' }],
    notices: [selected, hidden],
  }))
  const { prepared } = await prepare(runtime, {
    intent: 'notice',
    selectedNoticeIds: [selected.id],
  })
  assert.deepEqual(prepared.consentChallenge.requiredScopes, [])

  await runtime.send({ requestId: prepared.requestId, approved: true })
  const context = outboundContext(requests)
  assert.equal(context.domainData.length, 1)
  const notice = context.domainData[0]
  assert.equal(notice.scope, 'notices')
  assert.equal(notice.record.trust, 'untrusted')
  assert.equal(notice.record.signals.courses.some((signal) => signal.text === '高等数学'), true)
  assert.equal(notice.record.signals.times.some((signal) => signal.instant === '2026-08-16T06:30:00.000Z'), true)
  assert.equal(notice.record.signals.actions.every((signal) => signal.executable === false), true)
  assert.equal(Object.hasOwn(notice.record, 'suggestions'), false)
  assert.equal(Object.hasOwn(notice.record, 'allowedCapabilityClasses'), false)

  const outbound = JSON.stringify(requests[0])
  for (const forbidden of [
    'UNSELECTED_NOTICE_SECRET', 'UNSELECTED_NOTICE_BODY_SECRET', 'NOTICE_URL_SECRET',
    'SOURCE_URL_SECRET', 'evil.invalid', 'course.buct.edu.cn', '\u202e', 'sourceUrl',
    'notice-title-relative.example', 'NOTICE_TITLE_ROUTE', 'NOTICE_TITLE_SECRET',
    'notice-summary-relative.example', 'NOTICE_SUMMARY_ROUTE', 'NOTICE_SUMMARY_SECRET',
  ]) assert.equal(outbound.includes(forbidden), false, forbidden)
})

test('runtime accepts real notice and mail narratives only through their frozen low-trust references', async () => {
  const cases = [
    {
      scope: 'notices',
      state: { notices: [{ id: 'notice-citable', title: '考试通知', summary: '请人工核对考试安排。', source: 'theol' }] },
      request: { intent: 'notice', selectedNoticeIds: ['notice-citable'] },
    },
    {
      scope: 'mailbox',
      state: { emails: [{ id: 'mail-citable', subject: '课程邮件', from: 'Teacher', snippet: '请人工核对课程安排。', source: 'imap' }] },
      request: { intent: 'mail', selectedMailIds: ['mail-citable'] },
    },
  ]

  for (const fixture of cases) {
    const responder = (request) => {
      const context = JSON.parse(request.messages[1].content)
      const reference = context.untrustedReferences.find((entry) => entry.scope === fixture.scope)
      assert.ok(reference)
      return JSON.stringify({
        schema: 'theia-advisor-model-narrative/v1',
        blocks: [{
          claimIds: [],
          referenceIds: [reference.id],
          explanation: '所选内容包含一项需要人工核对的安排。',
        }],
        recommendations: [{
          text: '建议回到所选原文人工确认。',
          basedOnClaimIds: [],
          basedOnReferenceIds: [reference.id],
        }],
        uncertainties: ['所选内容来自未验证来源，需人工核验。'],
        questionsForUser: [],
        suggestedActionIds: [],
      })
    }
    const { runtime, requests } = harness(configuredState(fixture.state), null, responder)
    const { prepared } = await prepare(runtime, fixture.request)
    const answer = await runtime.send({ requestId: prepared.requestId, approved: true })
    const context = outboundContext(requests)
    const reference = context.untrustedReferences.find((entry) => entry.scope === fixture.scope)
    assert.equal(reference.trust, 'untrusted')
    assert.deepEqual(answer.narrative.blocks[0].referenceIds, [reference.id])
    assert.deepEqual(answer.untrustedReferences.map((entry) => entry.id), [reference.id])
    assert.equal(answer.untrustedReferences[0].trust, 'untrusted')
    assert.equal(Object.hasOwn(answer.untrustedReferences[0], 'sourceText'), false)
    assert.deepEqual(answer.claims, [])
    assert.deepEqual(answer.evidence, [])
  }
})

test('selected mail defaults to metadata and attachment metadata without body or binary fields', async () => {
  const selected = {
    id: 'mail-selected',
    subject: '<b>课程提醒</b> [详情](//mail-subject-relative.example/MAIL_SUBJECT_ROUTE?token=MAIL_SUBJECT_SECRET)',
    from: 'Teacher //mail-from-relative.example/MAIL_FROM_ROUTE?secret=MAIL_FROM_SECRET',
    receivedAt: '2026-08-14T02:00:00.000Z',
    snippet: '请查看正文。//mail-snippet-relative.example/MAIL_SNIPPET_ROUTE?token=MAIL_SNIPPET_SECRET',
    body: 'MAIL_BODY_SECRET',
    bodyHtml: '<script>MAIL_HTML_SECRET</script>',
    source: 'imap',
    attachments: [{
      index: 2,
      filename: 'C:\\private\\notice.pdf',
      contentType: 'application/pdf',
      size: 2048,
      data: Buffer.from('ATTACHMENT_BINARY_SECRET'),
      content: 'ATTACHMENT_CONTENT_SECRET',
      path: 'C:\\private\\notice.pdf',
      url: 'https://evil.invalid/attachment?token=ATTACHMENT_URL_SECRET',
    }],
  }
  const hidden = {
    id: 'mail-hidden',
    subject: 'UNSELECTED_MAIL_SECRET',
    from: 'Hidden',
    receivedAt: '2026-08-14T01:00:00.000Z',
    body: 'UNSELECTED_MAIL_BODY_SECRET',
    source: 'imap',
  }
  const { runtime, requests, lexicalIndex } = harness(configuredState({ emails: [selected, hidden] }))
  const { prepared } = await prepare(runtime, {
    intent: 'mail',
    question: '课程提醒',
    selectedMailIds: [selected.id],
  })
  assert.equal(prepared.disclosure.containsMailBody, false)
  assert.deepEqual(prepared.consentChallenge.requiredScopes, [])
  const localCandidates = lexicalIndex.search('课程提醒', { privacyScopes: ['mail-metadata'] })
  assert.deepEqual(localCandidates.privacyScopes, ['mail-metadata'])
  assert.equal(localCandidates.results.length, 1)
  for (const forbidden of [
    'MAIL_BODY_SECRET', 'MAIL_HTML_SECRET', 'ATTACHMENT_BINARY_SECRET', 'ATTACHMENT_CONTENT_SECRET',
    'mail-subject-relative.example', 'MAIL_SUBJECT_ROUTE', 'MAIL_SUBJECT_SECRET',
    'mail-from-relative.example', 'MAIL_FROM_ROUTE', 'MAIL_FROM_SECRET',
    'mail-snippet-relative.example', 'MAIL_SNIPPET_ROUTE', 'MAIL_SNIPPET_SECRET',
  ]) {
    assert.equal(JSON.stringify(localCandidates).includes(forbidden), false, forbidden)
  }

  await runtime.send({ requestId: prepared.requestId, approved: true })
  const context = outboundContext(requests)
  assert.deepEqual(context.domainData.map((entry) => entry.scope), ['mailbox'])
  const mail = context.domainData[0].record
  assert.equal(Object.hasOwn(mail, 'body'), false)
  assert.deepEqual(mail.attachments, [{
    index: 2,
    filename: 'notice.pdf',
    contentType: 'application/pdf',
    size: 2048,
  }])
  assert.deepEqual(Object.keys(mail.attachments[0]).sort(), ['contentType', 'filename', 'index', 'size'])

  const outbound = JSON.stringify(requests[0])
  for (const forbidden of [
    'MAIL_BODY_SECRET', 'MAIL_HTML_SECRET', 'ATTACHMENT_BINARY_SECRET', 'ATTACHMENT_CONTENT_SECRET',
    'ATTACHMENT_URL_SECRET', 'UNSELECTED_MAIL_SECRET', 'UNSELECTED_MAIL_BODY_SECRET',
    'evil.invalid', 'C:\\\\private', 'bodyHtml',
    'mail-subject-relative.example', 'MAIL_SUBJECT_ROUTE', 'MAIL_SUBJECT_SECRET',
    'mail-from-relative.example', 'MAIL_FROM_ROUTE', 'MAIL_FROM_SECRET',
    'mail-snippet-relative.example', 'MAIL_SNIPPET_ROUTE', 'MAIL_SNIPPET_SECRET',
  ]) assert.equal(outbound.includes(forbidden), false, forbidden)
})

test('mail body uses P5 digest only as a local gate and final ContextBuilder consent remains authoritative', async () => {
  const mail = {
    id: 'mail-body-selected',
    subject: '正文授权测试',
    from: 'Teacher',
    receivedAt: '2026-08-14T03:00:00.000Z',
    snippet: '正文已缓存。',
    bodyHtml: '<script>BODY_SCRIPT_SECRET</script><p>明天 09:00 开会。https://evil.invalid/private?token=BODY_URL_SECRET\u0000 [正文链接](//mail-body-markdown.example/MAIL_BODY_MARKDOWN_ROUTE?token=MAIL_BODY_MARKDOWN_SECRET) //mail-body-relative.example/MAIL_BODY_ROUTE?secret=MAIL_BODY_LINK_SECRET</p>',
    source: 'imap',
    attachments: [{ filename: 'a.bin', size: 9, data: Buffer.from('BODY_ATTACHMENT_SECRET') }],
  }
  const localBodyDigest = mailBodyEntityDigest(mail)
  const { runtime, requests } = harness(configuredState({ emails: [mail] }))
  const { prepared } = await prepare(runtime, {
    intent: 'mail',
    selectedMailIds: [mail.id],
    includeMailBodyIds: [mail.id],
  })

  assert.deepEqual(prepared.consentChallenge.requiredScopes, ['mail-body'])
  assert.equal(prepared.consentChallenge.entityDigests.length, 1)
  assert.notEqual(prepared.consentChallenge.entityDigests[0], localBodyDigest)
  assert.equal(JSON.stringify(prepared).includes(localBodyDigest), false)
  assert.equal(Object.hasOwn(runtime, 'prepared'), false)

  await runtime.send({ requestId: prepared.requestId, approved: true })
  const context = outboundContext(requests)
  assert.equal(context.disclosure.contextDigest, prepared.disclosure.contextDigest)
  const body = context.domainData.find((entry) => entry.scope === 'mail-body')
  assert.equal(body.entityDigest, prepared.consentChallenge.entityDigests[0])
  assert.match(body.record.body, /明天 09:00 开会/)

  const outbound = JSON.stringify(requests[0])
  for (const forbidden of [
    localBodyDigest, 'BODY_SCRIPT_SECRET', 'BODY_URL_SECRET', 'BODY_ATTACHMENT_SECRET',
    'evil.invalid', '\u0000', 'bodyEntityDigest', 'entityDigest":"' + localBodyDigest,
    'mail-body-markdown.example', 'MAIL_BODY_MARKDOWN_ROUTE', 'MAIL_BODY_MARKDOWN_SECRET',
    'mail-body-relative.example', 'MAIL_BODY_ROUTE', 'MAIL_BODY_LINK_SECRET',
  ]) assert.equal(outbound.includes(forbidden), false, forbidden)
})

test('requesting an uncached mail body fails closed before any provider call', async () => {
  const mail = {
    id: 'mail-without-body',
    subject: '只有摘要',
    from: 'Teacher',
    receivedAt: '2026-08-14T03:00:00.000Z',
    snippet: '正文还没有保存到本机。',
    source: 'imap',
  }
  const { runtime, requests } = harness(configuredState({ emails: [mail] }))
  const thread = runtime.createThread()

  await assert.rejects(runtime.prepare({
    threadId: thread.id,
    question: '请概括正文。',
    intent: 'mail',
    selectedMailIds: [mail.id],
    includeMailBodyIds: [mail.id],
  }), (error) => hasCode('mail-body-unavailable')(error) && error.retryable === true)
  assert.equal(requests.length, 0)
})

test('general intent uses local keyword routing and lexical recall never expands model disclosure', async () => {
  const hiddenMarker = 'LEXICAL_ONLY_NOTICE_SECRET'
  const index = createLexicalIndex()
  index.upsert({
    documentId: 'notice:lexical-only',
    dataset: 'notices',
    entityId: 'notice-lexical-only',
    sourceDigest: 'a'.repeat(64),
    capturedAt: '2026-08-14T01:00:00.000Z',
    privacyScope: 'public-academic',
    text: `GPA 体测 ${hiddenMarker}`,
  })
  assert.equal(index.search('GPA 体测').results.length, 1)

  const { runtime, requests, lexicalIndex } = harness(configuredState({
    notices: [{ id: 'notice-lexical-only', title: `GPA 体测 ${hiddenMarker}`, summary: hiddenMarker, source: 'theol' }],
  }))
  const first = await prepare(runtime, {
    intent: 'general',
    question: '我的 GPA 和体测怎么样？',
    focusDomains: ['mailbox', 'notices'],
  })
  assert.deepEqual(first.prepared.disclosure.scopes, ['fitness', 'grades'])
  assert.equal(Object.hasOwn(first.prepared, 'lexicalCandidates'), false)
  const localCandidates = lexicalIndex.search('GPA 体测', {
    privacyScopes: ['public-academic', 'mail-metadata'],
  })
  assert.deepEqual(localCandidates.privacyScopes, ['mail-metadata', 'public-academic'])
  assert.equal(localCandidates.results.some((result) => result.dataset === 'notices'), true)
  await runtime.send({ requestId: first.prepared.requestId, approved: true })
  assert.equal(JSON.stringify(requests[0]).includes(hiddenMarker), false)

  const second = await prepare(runtime, {
    intent: 'general',
    question: '帮我看看现在的情况。',
    focusDomains: ['mailbox', 'notices'],
  })
  assert.deepEqual(second.prepared.disclosure.scopes, ['assignments', 'exams'])
})

test('runtime lexical candidates update incrementally by sourceDigest without becoming disclosure input', async () => {
  const initial = configuredState({
    notices: [{
      id: 'notice-changing',
      title: '旧版补课安排',
      summary: 'ONLYOLDTOKEN',
      publishedAt: '2026-08-14T01:00:00.000Z',
      source: 'theol',
    }],
  })
  const store = mutableStore(initial)
  const { runtime, lexicalIndex } = harness(initial, store)
  await prepare(runtime, { intent: 'notice', question: '旧版补课安排' })
  const firstCandidates = lexicalIndex.search('旧版补课安排', { privacyScopes: ['public-academic'] })
  assert.equal(firstCandidates.results.length, 1)
  const firstDigest = firstCandidates.results[0].sourceDigest

  store.replace(configuredState({
    notices: [{
      id: 'notice-changing',
      title: '新版考试安排',
      summary: 'ONLYNEWTOKEN',
      publishedAt: '2026-08-14T02:00:00.000Z',
      source: 'theol',
    }],
  }))
  await prepare(runtime, { intent: 'notice', question: '新版考试安排' })
  const secondCandidates = lexicalIndex.search('新版考试安排', { privacyScopes: ['public-academic'] })
  assert.equal(secondCandidates.results.length, 1)
  assert.notEqual(secondCandidates.results[0].sourceDigest, firstDigest)

  const oldQuery = await prepare(runtime, { intent: 'notice', question: 'ONLYOLDTOKEN' })
  assert.equal(oldQuery.prepared.schema, 'theia-advisor-prepared-request/v1')
  assert.deepEqual(lexicalIndex.search('ONLYOLDTOKEN', { privacyScopes: ['public-academic'] }).results, [])
})
