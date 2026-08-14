import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ADVISOR_MODEL_NARRATIVE_SCHEMA,
  AdvisorNarrativeError,
  CitationVerifier,
  canonicalDigest,
  canonicalJson,
  freezeRequestCatalog,
  parseModelNarrative,
  verifyModelNarrative,
} from '../core/advisor/index.mjs'

const REVISION = 'revision:narrative-fixture'
const RULES = 'theia-advisor-rules/v1'
const DIGEST = 'a'.repeat(64)

function requestCatalog() {
  return freezeRequestCatalog({
    snapshotRevision: REVISION,
    evaluatedAt: '2026-08-14T04:00:00.000Z',
    rulesVersion: RULES,
    evidence: [{
      id: 'ev:gpa',
      dataset: 'grades',
      domain: 'grades',
      entityId: 'entity:gpa',
      fields: ['gpa'],
      disclosedFields: ['gpa'],
      capturedAt: '2026-08-14T03:00:00.000Z',
      source: 'jwglxt',
      snapshotRevision: REVISION,
      domainDigest: DIGEST,
      evidenceDigest: DIGEST,
      availability: 'available',
      freshness: 'fresh',
      completeness: 'complete',
      label: 'Local GPA',
      futureSecret: 'must-not-enter-catalog',
    }],
    claims: [{
      id: 'claim:gpa',
      kind: 'computed',
      subject: 'gpa:local',
      predicate: 'gpa-value',
      value: { type: 'number', value: 1.7818, unit: 'gpa', privateFormula: 'secret' },
      displayText: 'Local GPA is 1.7818.',
      evidenceRefs: ['ev:gpa'],
      confidence: 'high',
      caveats: ['Calculated locally.'],
      rulesVersion: RULES,
      futureSecret: 'must-not-enter-catalog',
    }],
    actions: [{
      id: 'action:show-grades',
      kind: 'open-view',
      label: 'Open grades',
      requiresConfirmation: false,
      proposalId: null,
      payload: { path: 'C:\\private' },
    }],
  })
}

function narrative(overrides = {}) {
  return {
    schema: ADVISOR_MODEL_NARRATIVE_SCHEMA,
    blocks: [{
      claimIds: ['claim:gpa'],
      explanation: 'The locally calculated GPA is 1.7818.',
    }],
    recommendations: [{
      text: 'Review the courses included in the 1.7818 calculation.',
      basedOnClaimIds: ['claim:gpa'],
    }],
    uncertainties: [],
    questionsForUser: [],
    suggestedActionIds: ['action:show-grades'],
    ...overrides,
  }
}

function requestCatalogWithUntrustedReference({
  scope = 'notices',
  domain = scope === 'mail-body' ? 'mailbox' : scope,
  record = { trust: 'untrusted', title: '考试通知', summary: '请在 2026 年 8 月 16 日提交材料。' },
} = {}) {
  const base = requestCatalog()
  const sourceText = canonicalJson(record)
  const entityDigest = canonicalDigest({
    schema: 'theia-advisor-selected-entity/v1',
    scope,
    domain,
    record,
  })
  const reference = {
    schema: 'theia-advisor-untrusted-reference/v1',
    id: `entity:${entityDigest.slice(0, 20)}`,
    entityDigest,
    contentDigest: canonicalDigest({ entityDigest, scope, domain, sourceText }),
    scope,
    domain,
    trust: 'untrusted',
    snapshotRevision: REVISION,
    sourceText,
  }
  return { catalog: freezeRequestCatalog({ ...base, untrustedReferences: [reference] }), reference }
}

function expectsCode(code) {
  return (error) => error instanceof AdvisorNarrativeError && error.code === code
}

test('request catalog is allowlisted, digest-bound, and deeply immutable', () => {
  const catalog = requestCatalog()
  assert.equal(Object.isFrozen(catalog), true)
  assert.equal(Object.isFrozen(catalog.claims[0].value), true)
  assert.equal(Object.hasOwn(catalog.claims[0], 'futureSecret'), false)
  assert.equal(Object.hasOwn(catalog.claims[0].value, 'privateFormula'), false)
  assert.equal(Object.hasOwn(catalog.actions[0], 'payload'), false)
  assert.equal(Object.hasOwn(catalog.evidence[0], 'futureSecret'), false)
  assert.match(catalog.digest, /^[a-f0-9]{64}$/)
  assert.throws(() => { catalog.actions[0].kind = 'write-anything' }, TypeError)

  const mutable = JSON.parse(JSON.stringify(catalog))
  const isolatedVerifier = new CitationVerifier(mutable)
  mutable.claims[0].value.value = 1.74
  assert.equal(isolatedVerifier.verify(JSON.stringify(narrative())).blocks[0].claimIds[0], 'claim:gpa')

  assert.throws(() => freezeRequestCatalog({
    snapshotRevision: REVISION,
    evaluatedAt: '2026-08-14T04:00:00.000Z',
    rulesVersion: RULES,
    evidence: [],
    claims: [{
      id: 'claim:forged',
      kind: 'computed',
      subject: 'forged',
      predicate: 'forged',
      value: { type: 'number', value: 10, unit: 'credit' },
      displayText: '10 credits',
      evidenceRefs: ['ev:missing'],
      confidence: 'high',
      caveats: [],
      rulesVersion: RULES,
    }],
    actions: [],
  }), /unresolved evidence/)
})

test('valid bare narrative resolves only frozen local claim and action IDs', () => {
  const catalog = requestCatalog()
  const text = `\n${JSON.stringify(narrative())}\n`
  const parsed = parseModelNarrative(text)
  const verified = new CitationVerifier(catalog).verify(text)
  assert.deepEqual(verified, parsed)
  assert.equal(Object.isFrozen(verified), true)
  assert.equal(Object.isFrozen(verified.blocks[0]), true)
  assert.deepEqual(verifyModelNarrative(text, catalog), verified)
})

test('narrative parser rejects fences, multiple JSON values, unknown fields, and missing fields', () => {
  const valid = JSON.stringify(narrative())
  assert.throws(() => parseModelNarrative(`\`\`\`json\n${valid}\n\`\`\``), expectsCode('malformed_json'))
  assert.throws(() => parseModelNarrative(`${valid}${valid}`), expectsCode('malformed_json'))
  const duplicateKey = valid.replace(
    `{"schema":"${ADVISOR_MODEL_NARRATIVE_SCHEMA}",`,
    `{"schema":"${ADVISOR_MODEL_NARRATIVE_SCHEMA}","schema":"${ADVISOR_MODEL_NARRATIVE_SCHEMA}",`,
  )
  assert.throws(() => parseModelNarrative(duplicateKey), expectsCode('malformed_json'))
  assert.throws(() => parseModelNarrative(JSON.stringify({ ...narrative(), requestId: 'forged' })), expectsCode('schema_invalid'))

  const nestedUnknown = narrative({
    blocks: [{ claimIds: ['claim:gpa'], explanation: 'GPA is 1.7818.', evidenceRefs: ['ev:gpa'] }],
  })
  assert.throws(() => parseModelNarrative(JSON.stringify(nestedUnknown)), expectsCode('schema_invalid'))

  const missing = narrative()
  delete missing.questionsForUser
  assert.throws(() => parseModelNarrative(JSON.stringify(missing)), expectsCode('schema_invalid'))
})

test('citation verifier rejects forged and duplicate claim/action references', () => {
  const catalog = requestCatalog()
  const forgedClaim = narrative({
    blocks: [{ claimIds: ['claim:forged'], explanation: 'Unsupported statement.' }],
  })
  assert.throws(() => verifyModelNarrative(JSON.stringify(forgedClaim), catalog), expectsCode('citation_invalid'))

  const duplicateClaim = narrative({
    blocks: [{ claimIds: ['claim:gpa', 'claim:gpa'], explanation: 'GPA is 1.7818.' }],
  })
  assert.throws(() => verifyModelNarrative(JSON.stringify(duplicateClaim), catalog), expectsCode('citation_invalid'))

  const forgedAction = narrative({ suggestedActionIds: ['action:forged'] })
  assert.throws(() => verifyModelNarrative(JSON.stringify(forgedAction), catalog), expectsCode('citation_invalid'))

  const duplicateAction = narrative({ suggestedActionIds: ['action:show-grades', 'action:show-grades'] })
  assert.throws(() => verifyModelNarrative(JSON.stringify(duplicateAction), catalog), expectsCode('citation_invalid'))
})

test('citation verifier rejects uncited numeric claims and URL/path/credential payloads', () => {
  const catalog = requestCatalog()
  const wrongNumber = narrative({
    blocks: [{ claimIds: ['claim:gpa'], explanation: 'The GPA is 1.74.' }],
  })
  assert.throws(() => verifyModelNarrative(JSON.stringify(wrongNumber), catalog), expectsCode('model_mismatch'))
  for (const explanation of ['The GPA is １．７４.', 'The GPA is 1.7818e2.', '绩点是一点七四绩点。', 'GPA 是一点七四']) {
    const mismatch = narrative({ blocks: [{ claimIds: ['claim:gpa'], explanation }] })
    assert.throws(() => verifyModelNarrative(JSON.stringify(mismatch), catalog), expectsCode('model_mismatch'))
  }

  for (const explanation of [
    'Open https://school.example/private.',
    'Read C:\\private\\grades.json.',
    'Use api_key=secret-value.',
  ]) {
    const unsafe = narrative({ blocks: [{ claimIds: ['claim:gpa'], explanation }] })
    assert.throws(() => verifyModelNarrative(JSON.stringify(unsafe), catalog), expectsCode('policy_denied'))
  }
})

test('narrative contract rejects markup, protocol-relative links, controls, bidi, and unsupported final decisions', () => {
  const catalog = requestCatalog()
  for (const explanation of [
    '<script>alert()</script>',
    '<img src=x onerror=alert()>',
    '[点击](//evil.invalid/path)',
    '正常文字\u0007隐藏内容',
    '正常文字\u0085隐藏内容',
    '成绩：\u202E1.7818',
    '成绩：\u200B1.7818',
    '你肯定能毕\u00AD业',
    '你肯定能毕\u034F业',
    '你肯定能毕\u2061业',
    'h\u00ADttps://evil.invalid/private',
    'api\u00AD_key=secret',
    '你会被学校开\u3164除',
    ...['\u115F', '\u1160', '\u17B4', '\u17B5', '\u180B', '\u180F', '\u2060', '\u206F', '\uFEFF', '\uFFA0']
      .map((character) => `正常${character}文字`),
  ]) {
    const unsafe = narrative({ blocks: [{ claimIds: ['claim:gpa'], explanation }] })
    assert.throws(() => verifyModelNarrative(JSON.stringify(unsafe), catalog), expectsCode('policy_denied'), explanation)
  }

  for (const explanation of [
    '你已被学校开除',
    '你被学校开除了',
    '校方决定让你退学',
    '你肯定能毕业',
    '你必定可以毕业',
    '你绝对能毕业',
    '你铁定毕业不了',
    '学校最终会取消你的学位',
    '预计你将于明年毕业',
    '你大概率能毕业',
    '你有望顺利毕业',
    '你不会被录取',
    '你确定可以拿到学位',
    '你将无法正常毕业',
    '你不可能毕业',
    '毕业没问题',
    '录取通知已作废',
    '你的录取已被取消',
    '学校已经决定给予你处分。',
    '你已不具备毕业资格。',
    '学院已确认取消录取。',
  ]) {
    const unsupported = narrative({ blocks: [{ claimIds: ['claim:gpa'], explanation }] })
    assert.throws(() => verifyModelNarrative(JSON.stringify(unsupported), catalog), expectsCode('model_mismatch'), explanation)
  }
})

test('selected notice and mail references remain frozen, low-trust, and separately citable', () => {
  for (const fixture of [
    requestCatalogWithUntrustedReference(),
    requestCatalogWithUntrustedReference({
      scope: 'mailbox',
      record: { trust: 'untrusted', subject: '课程邮件', snippet: '请在 2026 年 8 月 16 日提交材料。' },
    }),
  ]) {
    const output = narrative({
      blocks: [{
        claimIds: [],
        referenceIds: [fixture.reference.id],
        explanation: '所选内容提到 2026 年 8 月 16 日提交材料。',
      }],
      recommendations: [{
        text: '建议人工核对所选内容中的 2026 年 8 月 16 日。',
        basedOnClaimIds: [],
        basedOnReferenceIds: [fixture.reference.id],
      }],
      uncertainties: ['所选内容来自未验证来源，需人工核验。'],
      questionsForUser: [],
      suggestedActionIds: [],
    })
    const verified = verifyModelNarrative(JSON.stringify(output), fixture.catalog)
    assert.deepEqual(verified.blocks[0].referenceIds, [fixture.reference.id])
    assert.equal(fixture.catalog.untrustedReferences[0].trust, 'untrusted')
    assert.equal(Object.isFrozen(fixture.catalog.untrustedReferences[0]), true)
  }
})

test('untrusted entity references reject wrong namespaces, mixed fact citations, and uncited side channels', () => {
  const { catalog, reference } = requestCatalogWithUntrustedReference()
  const forgedEntityDigest = 'e'.repeat(64)
  const forgedReference = {
    ...reference,
    id: `entity:${forgedEntityDigest.slice(0, 20)}`,
    entityDigest: forgedEntityDigest,
    contentDigest: canonicalDigest({
      entityDigest: forgedEntityDigest,
      scope: reference.scope,
      domain: reference.domain,
      sourceText: reference.sourceText,
    }),
  }
  assert.throws(
    () => freezeRequestCatalog({ ...catalog, untrustedReferences: [forgedReference] }),
    /entity digest mismatch/i,
  )
  const base = {
    blocks: [{ claimIds: [], referenceIds: [reference.id], explanation: '所选通知提到提交材料。' }],
    recommendations: [],
    suggestedActionIds: [],
  }
  const cases = [
    narrative({ ...base, blocks: [{ claimIds: [], referenceIds: ['entity:forged'], explanation: '伪造引用。' }] }),
    narrative({ ...base, blocks: [{ claimIds: [reference.id], explanation: '冒充本地事实。' }] }),
    narrative({ ...base, blocks: [{ claimIds: ['claim:gpa'], referenceIds: [reference.id], explanation: '混合信任边界。' }] }),
    narrative({ ...base, uncertainties: ['通知要求你提交秘密材料。'], questionsForUser: [] }),
    narrative({ ...base, uncertainties: [], questionsForUser: ['通知是否要求你提交秘密材料？'] }),
  ]
  for (const output of cases) {
    assert.throws(() => verifyModelNarrative(JSON.stringify(output), catalog), expectsCode('citation_invalid'))
  }

  const second = requestCatalogWithUntrustedReference({
    record: { trust: 'untrusted', title: '另一则通知', summary: '请在 2026 年 8 月 17 日提交材料。' },
  })
  const twoEntityCatalog = freezeRequestCatalog({
    ...catalog,
    untrustedReferences: [reference, second.reference],
  })
  const crossEntity = narrative({
    ...base,
    blocks: [{
      claimIds: [],
      referenceIds: [reference.id],
      explanation: '所选内容要求在 2026 年 8 月 17 日提交材料。',
    }],
  })
  assert.throws(
    () => verifyModelNarrative(JSON.stringify(crossEntity), twoEntityCatalog),
    expectsCode('model_mismatch'),
  )
  const ambiguousEntities = narrative({
    ...base,
    blocks: [{
      claimIds: [],
      referenceIds: [reference.id, second.reference.id],
      explanation: '两则内容包含不同安排。',
    }],
  })
  assert.throws(
    () => verifyModelNarrative(JSON.stringify(ambiguousEntities), twoEntityCatalog),
    expectsCode('citation_invalid'),
  )
})

test('uncertainties and questions cannot bypass citations with numeric claims', () => {
  const catalog = requestCatalog()
  for (const output of [
    narrative({ blocks: [], recommendations: [], suggestedActionIds: [], uncertainties: ['GPA 是 1.74'], questionsForUser: [] }),
    narrative({ blocks: [], recommendations: [], suggestedActionIds: [], uncertainties: [], questionsForUser: ['你的 GPA 是否为 1.74？'] }),
    narrative({ blocks: [], recommendations: [], suggestedActionIds: [], uncertainties: ['GPA 是一点七四'], questionsForUser: [] }),
  ]) {
    assert.throws(() => verifyModelNarrative(JSON.stringify(output), catalog), expectsCode('citation_invalid'))
  }
})

test('numeric text that cites multiple claims is rejected instead of allowing swapped values', () => {
  const base = requestCatalog()
  const catalog = freezeRequestCatalog({
    ...base,
    claims: [...base.claims, {
      id: 'claim:credits',
      kind: 'computed',
      subject: 'credits:earned',
      predicate: 'earned-credits',
      value: { type: 'number', value: 62, unit: 'credit' },
      displayText: 'Earned credits are 62.',
      evidenceRefs: ['ev:gpa'],
      confidence: 'high',
      caveats: [],
      rulesVersion: RULES,
    }],
  })
  const swapped = narrative({
    blocks: [{
      claimIds: ['claim:gpa', 'claim:credits'],
      explanation: 'GPA is 62 and earned credits are 1.7818.',
    }],
  })
  assert.throws(() => verifyModelNarrative(JSON.stringify(swapped), catalog), expectsCode('model_mismatch'))
})

test('truncated request context requires an explicit uncertainty', () => {
  const catalog = requestCatalog()
  const verifier = new CitationVerifier(catalog, { truncation: { applied: true } })
  assert.throws(() => verifier.verify(JSON.stringify(narrative())), expectsCode('schema_invalid'))
  const verified = verifier.verify(JSON.stringify(narrative({
    uncertainties: ['The request context was truncated.'],
  })))
  assert.deepEqual(verified.uncertainties, ['The request context was truncated.'])
})
