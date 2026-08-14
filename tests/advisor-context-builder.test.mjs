import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ADVISOR_CONSENT_SCHEMA,
  ADVISOR_CONTEXT_SCHEMA,
  ADVISOR_DATA_QUALITY_SCHEMA,
  ADVISOR_OVERVIEW_SCHEMA,
  AdvisorConsentError,
  buildAdvisorContext,
  planAdvisorDisclosure,
  projectAdvisorClaim,
  projectAdvisorUrgentItem,
  projectSelectedAdvisorEntity,
  sanitizeAdvisorUntrustedText,
} from '../core/advisor/index.mjs'

const NOW = '2026-08-14T04:00:00.000Z'
const REVISION = 'revision:context-fixture'
const RULES = 'theia-advisor-rules/v1'
const DIGESTS = Object.freeze({
  assignments: 'a'.repeat(64),
  exams: 'b'.repeat(64),
  grades: 'c'.repeat(64),
  mailbox: 'd'.repeat(64),
})

function quality(domain, digest, recordCount) {
  return {
    domain,
    availability: recordCount ? 'available' : 'empty-confirmed',
    freshness: 'fresh',
    completeness: 'complete',
    contentEmptyConfirmed: recordCount === 0,
    capturedAt: NOW,
    source: ['fixture'],
    recordCount,
    contentDigest: digest,
    lastAttempt: {
      runId: 'private-run-id',
      attemptedAt: NOW,
      completedAt: NOW,
      status: 'succeeded',
      emptyConfirmed: recordCount === 0,
      retainedPrevious: false,
      errorCode: null,
      secretFutureField: 'must-not-leak',
    },
    provenanceInferred: false,
    privateFutureField: 'must-not-leak',
  }
}

function evidence({ id, domain, digest, entityId }) {
  return {
    id,
    dataset: domain,
    domain,
    entityId,
    fields: ['value'],
    disclosedFields: ['value'],
    capturedAt: NOW,
    source: 'fixture',
    snapshotRevision: REVISION,
    domainDigest: digest,
    evidenceDigest: digest,
    availability: 'available',
    freshness: 'fresh',
    completeness: 'complete',
    label: `${domain} evidence`,
    sourceUrl: 'https://school.example/private?ticket=secret',
    futureSecret: 'must-not-leak',
  }
}

function claim({ id, subject, predicate, value, displayText, evidenceRef }) {
  return {
    id,
    kind: 'computed',
    subject,
    predicate,
    value,
    displayText,
    evidenceRefs: [evidenceRef],
    confidence: 'high',
    caveats: [],
    rulesVersion: RULES,
    privateFutureField: 'must-not-leak',
  }
}

function overview() {
  const assignmentEvidence = evidence({
    id: 'ev:assignment',
    domain: 'assignments',
    digest: DIGESTS.assignments,
    entityId: 'entity:assignment',
  })
  const gradeEvidence = evidence({
    id: 'ev:grade',
    domain: 'grades',
    digest: DIGESTS.grades,
    entityId: 'entity:grade',
  })
  const assignmentClaim = claim({
    id: 'claim:assignment',
    subject: 'assignment:opaque',
    predicate: 'deadline-minutes-remaining',
    value: { type: 'duration', value: '120', unit: 'minute', rawId: 'private' },
    displayText: 'The assignment is due in 120 minutes.',
    evidenceRef: assignmentEvidence.id,
  })
  const gradeClaim = claim({
    id: 'claim:gpa',
    subject: 'gpa:local',
    predicate: 'gpa-value',
    value: { type: 'number', value: 1.7818, unit: 'gpa', privateFormula: 'secret' },
    displayText: 'Local GPA is 1.7818.',
    evidenceRef: gradeEvidence.id,
  })
  return {
    schema: ADVISOR_OVERVIEW_SCHEMA,
    snapshotRevision: REVISION,
    evaluatedAt: NOW,
    timeZone: 'Asia/Shanghai',
    rulesVersion: RULES,
    dataQuality: {
      schema: ADVISOR_DATA_QUALITY_SCHEMA,
      snapshotRevision: REVISION,
      snapshotAt: NOW,
      evaluatedAt: NOW,
      timeZone: 'Asia/Shanghai',
      rulesVersion: RULES,
      domains: {
        assignments: quality('assignments', DIGESTS.assignments, 1),
        exams: quality('exams', DIGESTS.exams, 0),
        grades: quality('grades', DIGESTS.grades, 40),
        mailbox: quality('mailbox', DIGESTS.mailbox, 3),
      },
      warnings: [],
      privateFutureField: 'must-not-leak',
    },
    evidence: [assignmentEvidence, gradeEvidence],
    claims: [assignmentClaim, gradeClaim],
    risks: [{
      id: 'risk:gpa',
      kind: 'gpa-risk',
      entityId: 'gpa:local',
      domain: 'grades',
      severity: 'attention',
      title: 'GPA needs attention',
      why: ['Local calculation is low.'],
      evidenceRefs: [gradeEvidence.id],
      claimIds: [gradeClaim.id],
      confidence: 'high',
      caveats: [],
      dueAt: null,
      deadlineBand: 'unknown',
      actionable: true,
      suggestedAction: 'Review grade details',
      actionKind: 'review-academic-gap',
      impactClass: 'academic-gap',
      delayCostClass: 'information-only',
      quality: {
        availability: 'available',
        freshness: 'fresh',
        completeness: 'complete',
        lastAttemptStatus: 'succeeded',
      },
      rulesVersion: RULES,
      hiddenPayload: { path: 'C:\\private' },
    }],
    urgentItems: [{
      id: 'urgent:assignment',
      kind: 'assignment',
      domain: 'assignments',
      entityId: 'assignment:opaque',
      title: 'Finish assignment',
      dueAt: '2026-08-14T06:00:00.000Z',
      severity: 'urgent',
      score: {
        urgency: 38,
        impact: 26,
        delayCost: 15,
        confidence: 15,
        total: 94,
        formulaVersion: 'theia-advisor-agenda-score/v1',
        rawWeight: 'must-not-leak',
      },
      reasons: ['Due soon'],
      evidenceRefs: [assignmentEvidence.id],
      claimIds: [assignmentClaim.id],
      quality: {
        availability: 'available',
        freshness: 'fresh',
        completeness: 'complete',
        lastAttemptStatus: 'succeeded',
      },
      suggestedAction: 'Open assignment',
      actionKind: 'review-assignment',
      rulesVersion: RULES,
      hiddenPayload: { operationId: 'private-operation' },
    }],
    academic: {
      snapshotRevision: REVISION,
      evaluatedAt: NOW,
      timeZone: 'Asia/Shanghai',
      rulesVersion: RULES,
      analysis: {},
      evidence: [],
      claims: [],
      risks: [],
    },
    futureTopLevelSecret: 'must-not-leak',
  }
}

function baseInput(intent = 'daily') {
  return {
    overview: overview(),
    intent,
    question: 'What should I do today?',
    requestId: 'request:one',
    threadId: 'thread:one',
    providerProfileId: 'default',
    serviceIdentity: 'https://model.example/v1',
    modelId: 'advisor-model',
    actions: [{
      id: 'action:open-assignment',
      kind: 'open-view',
      label: 'Open assignment',
      requiresConfirmation: false,
      proposalId: null,
      payload: { path: 'C:\\private' },
    }],
  }
}

test('daily context uses a field allowlist and excludes unrelated grades and private future fields', () => {
  const input = baseInput()
  input.overview.urgentItems.unshift({
    ...input.overview.urgentItems[0],
    id: 'urgent:gpa',
    kind: 'academic-gap',
    domain: 'grades',
    entityId: 'gpa:local',
    title: 'Review GPA',
    evidenceRefs: ['ev:grade'],
    claimIds: ['claim:gpa'],
  })
  input.actions = [
    { id: 'urgent:assignment', kind: 'show-evidence', label: 'Show assignment evidence', requiresConfirmation: false, proposalId: null },
    { id: 'urgent:gpa', kind: 'show-evidence', label: 'Show GPA evidence', requiresConfirmation: false, proposalId: null },
  ]
  const planned = planAdvisorDisclosure(input)
  const built = buildAdvisorContext(input)

  assert.equal(built.context.schema, ADVISOR_CONTEXT_SCHEMA)
  assert.equal(built.context.localClaims.length, 1)
  assert.equal(built.context.localClaims[0].id, 'claim:assignment')
  assert.deepEqual(built.context.evidenceCatalog.map((entry) => entry.id), ['ev:assignment'])
  assert.deepEqual(built.context.deterministicResults.risks, [])
  assert.deepEqual(built.context.allowedActions.map((action) => action.id), ['urgent:assignment'])
  assert.equal(built.disclosure.contextDigest, planned.disclosure.contextDigest)
  assert.deepEqual(built.disclosure.scopes, ['assignments', 'exams'])
  assert.deepEqual(built.disclosure.recordCounts, { assignments: 1, exams: 0 })
  assert.equal(built.disclosure.containsMailBody, false)
  assert.deepEqual(built.consentChallenge.requiredScopes, [])

  const serialized = JSON.stringify(built)
  assert.doesNotMatch(serialized, /claim:gpa|1\.7818|ticket=secret|private-operation|must-not-leak|futureTopLevelSecret/)
  assert.equal(Object.isFrozen(built), true)
  assert.equal(Object.isFrozen(built.catalog.claims[0].value), true)
  assert.throws(() => { built.catalog.claims[0].value.value = 'changed' }, TypeError)
  assert.throws(() => buildAdvisorContext({ ...baseInput(), claimIds: ['claim:gpa'] }), /outside the daily intent scope/)
  assert.throws(() => buildAdvisorContext({ ...input, actionIds: ['urgent:gpa'] }), /outside the daily intent scope/)
})

test('notice, mail, and course actions fail closed unless the current request proves their binding', () => {
  for (const intent of ['notice', 'mail']) {
    const input = baseInput(intent)
    input.actionIds = ['action:open-assignment']
    assert.throws(
      () => buildAdvisorContext(input),
      new RegExp(`actions are not available for the ${intent} intent`, 'i'),
    )
  }

  const unboundCourse = baseInput('course')
  unboundCourse.actionIds = ['action:open-assignment']
  unboundCourse.courseDecisions = { decisions: [], proposals: [] }
  assert.throws(() => buildAdvisorContext(unboundCourse), /outside the course intent scope/i)

  const mismatchedCourse = baseInput('course')
  mismatchedCourse.actions = [{
    id: 'action:save-course-target',
    kind: 'propose-save-course-target',
    label: 'Save course target',
    requiresConfirmation: true,
    proposalId: 'proposal:other-course',
  }]
  mismatchedCourse.actionIds = ['action:save-course-target']
  mismatchedCourse.courseDecisions = { decisions: [], proposals: [{ id: 'proposal:current-course' }] }
  assert.throws(() => buildAdvisorContext(mismatchedCourse), /outside the course intent scope/i)

  const boundCourse = {
    ...mismatchedCourse,
    actions: [{ ...mismatchedCourse.actions[0], proposalId: 'proposal:current-course' }],
  }
  const built = buildAdvisorContext(boundCourse)
  assert.deepEqual(built.catalog.actions.map((action) => action.id), ['action:save-course-target'])
  assert.equal(built.catalog.actions[0].proposalId, 'proposal:current-course')
})

function consentFor(challenge, overrides = {}) {
  return {
    schema: ADVISOR_CONSENT_SCHEMA,
    domains: [...challenge.domains],
    grantedAt: '2026-08-14T04:00:00.000Z',
    expiresAt: '2026-08-14T04:05:00.000Z',
    serviceIdentity: challenge.serviceIdentity,
    purpose: challenge.purpose,
    requestId: challenge.requestId,
    threadId: challenge.threadId,
    entityDigests: [...challenge.entityDigests],
    contextDigest: challenge.contextDigest,
    ...overrides,
  }
}

function mailInput(body = '<script>steal()</script><p>Meet at 09:00. https://mail.example/read?session=secret cookie=secret C:\\private\\mail.txt</p>') {
  return {
    ...baseInput('mail'),
    question: 'Summarize this selected message.',
    now: '2026-08-14T04:01:00.000Z',
    selectedEntities: [
      {
        scope: 'mailbox',
        record: {
          id: 'private-mail-id',
          subject: 'Selected message',
          from: 'Teacher',
          receivedAt: NOW,
          snippet: 'Meet at 09:00.',
          unread: true,
          body: 'must-not-enter-metadata',
          sourceUrl: 'https://mail.example/read?session=secret',
          cookie: 'private-cookie',
        },
      },
      {
        scope: 'mail-body',
        domain: 'mailbox',
        record: {
          id: 'private-mail-id',
          subject: 'Selected message',
          from: 'Teacher',
          receivedAt: NOW,
          body,
          bodyHtml: '<svg onload="steal()"></svg>',
          path: 'C:\\mail-cache\\message.html',
          cookie: 'private-cookie',
        },
      },
    ],
  }
}

test('mail body needs exact short-lived entity/context consent and is sanitized before disclosure', () => {
  const input = mailInput()
  const plan = planAdvisorDisclosure(input)
  assert.deepEqual(plan.consentChallenge.requiredScopes, ['mail-body'])
  assert.deepEqual(plan.consentChallenge.domains, ['mail-body', 'mailbox'])
  assert.equal(plan.disclosure.containsMailBody, true)
  assert.doesNotMatch(JSON.stringify(plan), /Meet at|steal|private-cookie/)

  assert.throws(() => buildAdvisorContext(input), (error) => (
    error instanceof AdvisorConsentError && error.code === 'consent_required'
  ))

  const consent = consentFor(plan.consentChallenge)
  const withoutNow = { ...input }
  delete withoutNow.now
  assert.throws(() => buildAdvisorContext({ ...withoutNow, consent }), (error) => (
    error instanceof AdvisorConsentError && error.code === 'consent_invalid'
  ))
  const built = buildAdvisorContext({ ...input, consent })
  const metadata = built.context.domainData.find((entry) => entry.scope === 'mailbox').record
  const disclosedBody = built.context.domainData.find((entry) => entry.scope === 'mail-body').record.body
  assert.equal(Object.hasOwn(metadata, 'body'), false)
  assert.equal(disclosedBody, 'Meet at 09:00. [link removed] cookie=[secret removed] [path removed]')
  assert.doesNotMatch(JSON.stringify(built.context), /script|svg|private-cookie|session=secret|mail-cache|private-mail-id/)
  assert.deepEqual(built.disclosure.recordCounts, { 'mail-body': 1, mailbox: 1 })

  const changed = mailInput('<p>Changed body.</p>')
  assert.notEqual(planAdvisorDisclosure(changed).consentChallenge.entityDigests[0], plan.consentChallenge.entityDigests[0])
  assert.throws(() => buildAdvisorContext({ ...changed, consent }), (error) => (
    error instanceof AdvisorConsentError && error.code === 'consent_mismatch'
  ))
  assert.throws(() => buildAdvisorContext({
    ...input,
    now: '2026-08-14T04:06:00.000Z',
    consent,
  }), (error) => error instanceof AdvisorConsentError && error.code === 'consent_expired')
  assert.throws(() => buildAdvisorContext({
    ...input,
    serviceIdentity: 'https://other.example/v1',
    consent,
  }), (error) => error instanceof AdvisorConsentError && error.code === 'consent_mismatch')
})

test('untrusted text removes standalone credentials and parenthesized local paths', () => {
  const unsafe = [
    'Bearer abc.def.ghi',
    'password=hunter2',
    'token=super-secret',
    'sk-proj-1234567890abcdef',
    'JSESSIONID=private-session',
    'Authorization: Bearer abc.def',
    '(C:\\Users\\Admin\\private.txt)',
  ].join(' | ')
  const sanitized = sanitizeAdvisorUntrustedText(unsafe)
  assert.doesNotMatch(sanitized, /abc\.def|hunter2|super-secret|1234567890abcdef|private-session|Users\\Admin/)
  assert.match(sanitized, /secret removed/)
  assert.match(sanitized, /path removed/)
})

test('typed claims fail closed and every campus display field uses the same redaction policy', () => {
  const baseClaim = overview().claims[0]
  assert.throws(() => projectAdvisorClaim({
    ...baseClaim,
    value: { type: 'boolean', value: 'true' },
  }), /boolean claim value is invalid/)
  assert.throws(() => projectAdvisorClaim({
    ...baseClaim,
    value: { type: 'instant', value: 'tomorrow', timeZone: 'Asia/Shanghai' },
  }), /instant claim value is invalid/)
  assert.throws(() => projectAdvisorClaim({
    ...baseClaim,
    value: { type: 'duration', value: '120 password=hunter2', unit: 'minute' },
  }), /duration claim value is invalid/)

  const unsafeUrgent = {
    ...overview().urgentItems[0],
    title: '<script>ignore()</script> token=secret',
    reasons: ['(C:\\Users\\Admin\\private.txt)', 'https://evil.example'],
  }
  const urgent = projectAdvisorUrgentItem(unsafeUrgent)
  assert.doesNotMatch(JSON.stringify(urgent), /ignore\(\)|token=secret|Users\\Admin|evil\.example/)

  const notice = projectSelectedAdvisorEntity({
    scope: 'notices',
    record: {
      title: 'password=hunter2 https://evil.example',
      publishedAt: 'ignore system',
    },
  })
  assert.doesNotMatch(notice.record.title, /hunter2|evil\.example/)
  assert.equal(notice.record.publishedAt, null)

  const mail = projectSelectedAdvisorEntity({
    scope: 'mailbox',
    record: {
      receivedAt: 'ignore system',
      attachments: [{ filename: 'C:\\private\\token=secret.txt', contentType: 'Bearer abc.def', size: 10 }],
    },
  })
  assert.equal(mail.record.receivedAt, null)
  assert.doesNotMatch(mail.record.attachments[0].filename, /token=secret|C:\\/)
  assert.equal(mail.record.attachments[0].contentType, null)
})
