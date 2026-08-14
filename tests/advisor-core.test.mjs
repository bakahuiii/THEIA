import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EvidenceRegistry,
  canonicalJson,
  createAdvisorOverview,
  evaluateDataQuality,
  parseCampusInstant,
  serializeAdvisorOverview,
  assertAdvisorOverview,
} from '../core/advisor/index.mjs'
import {
  advisorRiskDeadlineBandLabel,
  advisorRiskDomainLabel,
  advisorRiskSeverityLabel,
} from '../core/advisor/risk-engine.mjs'
import { CURRENT_CAPTURE, FIXED_NOW, OLD_CAPTURE, domainOutcome, versionedState } from './fixtures/advisor-fixtures.mjs'

const OPTIONS = Object.freeze({ now: FIXED_NOW, timeZone: 'Asia/Shanghai' })

test('risk user-visible enum labels are deterministic Chinese with conservative fallbacks', () => {
  const domainCases = {
    profile: '个人信息', terms: '学期', courses: '课程', academic: '学业基础', schedule: '课表', grades: '成绩', exams: '考试',
    'selected-courses': '已选课程', 'academic-progress': '学业进度', assignments: '作业与测试', workspaces: '课程工作区', coursework: '课程任务',
    notices: '通知', mailbox: '校园邮箱', fitness: '体测', 'school-schedule': '全校课表', 'academic-calendar': '校历', 'local-data-catalog': '本地资料',
  }
  for (const [value, label] of Object.entries(domainCases)) assert.equal(advisorRiskDomainLabel(value), label, value)
  assert.deepEqual(['urgent', 'attention', 'info', 'unknown'].map(advisorRiskSeverityLabel), ['紧急', '需关注', '提示', '未知'])
  assert.deepEqual(['overdue', 'critical', 'soon', 'normal', 'unknown'].map(advisorRiskDeadlineBandLabel), ['已逾期', '24 小时内', '3 天内', '3 天以后', '时间未知'])
  assert.equal(advisorRiskDomainLabel('private-domain-token'), '未知数据域')
  assert.equal(advisorRiskSeverityLabel('private-severity-token'), '未知等级')
  assert.equal(advisorRiskDeadlineBandLabel('private-band-token'), '未知时间范围')
})

test('risk output keeps machine enums while user-visible text does not expose them', () => {
  const versioned = versionedState({
    assignments: [
      { id: 'late', title: '逾期任务', dueAt: '2026-08-12T23:00:00.000Z', status: 'pending', capturedAt: CURRENT_CAPTURE },
      { id: 'critical', title: '当日任务', dueAt: '2026-08-13T05:00:00.000Z', status: 'pending', capturedAt: CURRENT_CAPTURE },
      { id: 'soon', title: '近期任务', dueAt: '2026-08-15T00:00:00.000Z', status: 'pending', capturedAt: CURRENT_CAPTURE },
      { id: 'normal', title: '后续任务', dueAt: '2026-08-17T00:00:00.000Z', status: 'pending', capturedAt: CURRENT_CAPTURE },
    ],
  }, {
    assignments: domainOutcome({
      succeeded: false,
      status: 'failed',
      retainedPrevious: true,
      errorCode: 'source-timeout',
    }),
    exams: domainOutcome({ emptyConfirmed: true }),
    grades: domainOutcome({ emptyConfirmed: true }),
    'academic-progress': domainOutcome({ emptyConfirmed: true }),
  })
  const overview = createAdvisorOverview(versioned, OPTIONS)
  const qualityEvidence = overview.evidence.find((entry) => entry.dataset === 'sync-domain' && entry.domain === 'assignments')
  const qualityClaim = overview.claims.find((entry) => entry.predicate === 'data-quality-severity' && entry.subject === 'assignments')
  const qualityRisk = overview.risks.find((entry) => entry.kind === 'data-quality' && entry.domain === 'assignments')

  assert.equal(qualityRisk.severity, 'urgent')
  assert.equal(qualityEvidence.label, '作业与测试数据质量')
  assert.equal(qualityClaim.displayText, '作业与测试数据可信度：紧急')
  assert.equal(qualityRisk.title, '作业与测试数据暂不能作为完整实时依据')

  const deadlineRisks = overview.risks.filter((entry) => entry.kind === 'assignment')
  assert.deepEqual(new Set(deadlineRisks.map((entry) => entry.deadlineBand)), new Set(['unknown']))
  const visibleText = [
    qualityEvidence.label,
    qualityClaim.displayText,
    qualityRisk.title,
    ...qualityRisk.why,
    ...deadlineRisks.flatMap((entry) => [entry.title, ...entry.why]),
  ].join('\n')
  assert.doesNotMatch(visibleText, /\b(?:assignments|urgent|attention|info|overdue|critical|soon|normal|unknown)\b/i)
  for (const label of ['已逾期', '24 小时内', '3 天内', '3 天以后']) {
    if (label === '已逾期') continue
    assert.match(visibleText, new RegExp(label.replace(' ', '\\s')))
  }
})

test('canonical JSON has stable UTF-8 key order, NFC text, and JSON omission rules', () => {
  const value = { z: [3, undefined, -0], a: 'e\u0301', ignored: undefined }
  assert.equal(canonicalJson(value), '{"a":"é","z":[3,null,0]}')
  assert.equal(canonicalJson(value), canonicalJson({ ignored: undefined, a: 'é', z: [3, undefined, 0] }))
  assert.throws(() => canonicalJson({ é: 1, ['e\u0301']: 2 }), /collide/)
  assert.throws(() => canonicalJson({ invalid: Number.NaN }), /finite/)
})

test('campus date parsing is explicit about Asia/Shanghai instead of host time zone', () => {
  assert.deepEqual(parseCampusInstant('2026-08-13 08:30', OPTIONS), {
    milliseconds: Date.parse('2026-08-13T00:30:00.000Z'),
    iso: '2026-08-13T00:30:00.000Z',
  })
  assert.equal(parseCampusInstant('not a date', OPTIONS), null)
})

test('legacy snapshots preserve available records but mark provenance, freshness, and completeness unknown', () => {
  const versioned = versionedState({
    updatedAt: FIXED_NOW,
    assignments: [{ id: 'legacy-1', title: 'Legacy task', dueAt: '2026-08-14T00:00:00.000Z' }],
    sync: { lastSuccessAt: FIXED_NOW, sources: {} },
  })
  versioned.domainDigests.assignments = 'a'.repeat(64)
  const quality = evaluateDataQuality(versioned, OPTIONS).domains.assignments
  assert.equal(quality.availability, 'available')
  assert.equal(quality.freshness, 'unknown')
  assert.equal(quality.completeness, 'unknown')
  assert.equal(quality.lastAttempt.status, 'never')
  assert.equal(quality.provenanceInferred, true)
  assert.equal(quality.capturedAt, null)
})

test('retained old data can be available, stale, complete, and have a failed latest attempt simultaneously', () => {
  const versioned = versionedState({
    assignments: [{ id: 'old-1', title: 'Retained task', capturedAt: OLD_CAPTURE }],
  }, {
    assignments: domainOutcome({
      attempted: true,
      succeeded: false,
      status: 'failed',
      capturedAt: OLD_CAPTURE,
      sourceSucceededAt: OLD_CAPTURE,
      retainedPrevious: true,
      errorCode: 'source-timeout',
    }),
  })
  const quality = evaluateDataQuality(versioned, OPTIONS).domains.assignments
  assert.equal(quality.availability, 'available')
  assert.equal(quality.freshness, 'stale')
  assert.equal(quality.completeness, 'complete')
  assert.equal(quality.sourceSucceededAt, OLD_CAPTURE)
  assert.deepEqual(quality.lastAttempt, {
    runId: 'run-1',
    attemptedAt: CURRENT_CAPTURE,
    completedAt: CURRENT_CAPTURE,
    status: 'failed',
    emptyConfirmed: false,
    retainedPrevious: true,
    errorCode: 'source-timeout',
  })
})

test('a confirmed empty collection is distinct from an empty collection with unknown meaning', () => {
  const versioned = versionedState({}, {
    assignments: domainOutcome({ emptyConfirmed: true }),
    exams: domainOutcome({ emptyConfirmed: false }),
  })
  const domains = evaluateDataQuality(versioned, OPTIONS).domains
  assert.equal(domains.assignments.availability, 'empty-confirmed')
  assert.equal(domains.exams.availability, 'unknown')
})

test('confirmed-empty content and a failed latest attempt remain orthogonal in data quality', () => {
  const versioned = versionedState({}, {
    assignments: domainOutcome({
      succeeded: false,
      status: 'failed',
      emptyConfirmed: false,
      contentEmptyConfirmed: true,
      capturedAt: OLD_CAPTURE,
      sourceSucceededAt: OLD_CAPTURE,
      completeness: 'complete',
      errorCode: 'source-timeout',
    }),
  })
  const quality = evaluateDataQuality(versioned, OPTIONS).domains.assignments
  assert.equal(quality.availability, 'empty-confirmed')
  assert.equal(quality.contentEmptyConfirmed, true)
  assert.equal(quality.lastAttempt.status, 'failed')
  assert.equal(quality.lastAttempt.emptyConfirmed, false)
  assert.equal(quality.completeness, 'complete')
})

test('legacy dated records are review prompts, never asserted as current deadline or countdown facts', () => {
  const versioned = versionedState({
    assignments: [{ id: 'legacy-task', title: 'Legacy task', dueAt: '2026-08-13T05:00:00.000Z', status: 'pending' }],
    exams: [{ id: 'legacy-exam', courseName: 'Legacy exam', startAt: '2026-08-14T01:00:00.000Z' }],
    sync: { runId: null, lastStartedAt: null, lastCompletedAt: null, domains: {} },
  })
  const overview = createAdvisorOverview(versioned, OPTIONS)
  const assignment = overview.risks.find((risk) => risk.kind === 'assignment')
  const exam = overview.risks.find((risk) => risk.kind === 'exam')

  assert.equal(assignment.severity, 'attention')
  assert.equal(exam.severity, 'attention')
  assert.match(assignment.title, /未经当前同步确认/)
  assert.match(exam.title, /未经当前同步确认/)
  assert.equal(assignment.actionKind, 'open-source-detail')
  assert.equal(exam.actionKind, 'open-source-detail')
  assert.equal(assignment.deadlineBand, 'unknown')
  assert.equal(exam.deadlineBand, 'unknown')
  assert.equal(assignment.why.some((item) => item.includes('当前有效性未知')), true)
  assert.equal(exam.why.some((item) => item.includes('当前有效性未知')), true)
  assert.equal(assignment.why.filter((item) => item.includes('分段')).every((item) => item.includes('按记录计算')), true)
  assert.equal(exam.why.filter((item) => item.includes('分段')).every((item) => item.includes('按记录计算')), true)
  const assignmentAction = overview.urgentItems.find((item) => item.kind === 'assignment')
  const examAction = overview.urgentItems.find((item) => item.kind === 'exam')
  for (const action of [assignmentAction, examAction]) {
    assert.equal(action.score.urgency, 0)
    assert.equal(action.score.components.urgency, 'unknown')
  }
  for (const claim of overview.claims.filter((item) => ['due-at', 'minutes-remaining', 'start-at', 'minutes-until-start'].includes(item.predicate))) {
    assert.equal(claim.confidence, 'unknown')
    assert.equal(claim.caveats.some((item) => item.includes('当前有效性未知')), true)
    assert.match(claim.displayText, /记录|当前有效性未知/)
  }
})

test('fresh timestamps do not override unknown completeness for deadline assertions', () => {
  const versioned = versionedState({
    assignments: [{ id: 'partial-task', title: 'Partial task', dueAt: '2026-08-13T05:00:00.000Z', status: 'pending', capturedAt: CURRENT_CAPTURE }],
  }, {
    assignments: domainOutcome({ completeness: 'unknown' }),
    exams: domainOutcome({ emptyConfirmed: true }),
    grades: domainOutcome({ emptyConfirmed: true }),
    'academic-progress': domainOutcome({ emptyConfirmed: true }),
  })
  const overview = createAdvisorOverview(versioned, OPTIONS)
  const risk = overview.risks.find((item) => item.kind === 'assignment')
  const claim = overview.claims.find((item) => item.predicate === 'minutes-remaining')
  assert.equal(risk.severity, 'attention')
  assert.equal(risk.deadlineBand, 'unknown')
  assert.match(risk.title, /未经当前同步确认/)
  assert.equal(risk.why.some((item) => item.includes('完整性未知')), true)
  assert.equal(claim.caveats.some((item) => item.includes('完整性未知')), true)
})

test('overview assertion rejects mismatched evaluation context metadata', () => {
  const overview = createAdvisorOverview(versionedState({}, {
    assignments: domainOutcome({ emptyConfirmed: true }),
    exams: domainOutcome({ emptyConfirmed: true }),
  }), OPTIONS)
  for (const [field, value] of [
    ['snapshotRevision', 'other-revision'],
    ['evaluatedAt', '2030-01-01T00:00:00.000Z'],
    ['timeZone', 'UTC'],
    ['rulesVersion', 'other-rules'],
  ]) {
    assert.throws(() => assertAdvisorOverview({
      ...overview,
      dataQuality: { ...overview.dataQuality, [field]: value },
    }), /mismatch/)
  }
  assert.throws(() => assertAdvisorOverview({ ...overview, evaluatedAt: 'not-an-instant' }), /evaluatedAt/)
  assert.throws(() => assertAdvisorOverview({ ...overview, timeZone: 'not-a-zone' }), /time zone/)
  const [evidence] = overview.evidence
  assert.ok(evidence)
  assert.throws(() => assertAdvisorOverview({
    ...overview,
    evidence: [{ ...evidence, evidenceDigest: null }, ...overview.evidence.slice(1)],
  }), /evidence digest is invalid/)
  assert.throws(() => assertAdvisorOverview({
    ...overview,
    evidence: [{ ...evidence, domainDigest: 'f'.repeat(64) }, ...overview.evidence.slice(1)],
  }), /domain content digest mismatch/)
  assert.throws(() => assertAdvisorOverview({
    ...overview,
    dataQuality: {
      ...overview.dataQuality,
      domains: {
        ...overview.dataQuality.domains,
        [evidence.domain]: { ...overview.dataQuality.domains[evidence.domain], contentDigest: null },
      },
    },
  }), /data quality domain is invalid/)
  for (const collection of ['claims', 'risks', 'urgentItems']) {
    assert.ok(overview[collection].length, collection)
    assert.throws(() => assertAdvisorOverview({
      ...overview,
      [collection]: overview[collection].map((item, index) => index ? item : { ...item, rulesVersion: 'other-rules' }),
    }), /rules version mismatch/)
  }
})

test('overview closes and recursively validates every nested academic evidence and claim reference', () => {
  const overview = createAdvisorOverview(versionedState({
    academicProgress: {
      gpa: 3.2,
      roots: [{
        id: 'required',
        title: 'Required credits',
        relation: 'and',
        required: 30,
        earned: 20,
        remaining: 10,
        children: [],
        courses: [{ courseCode: 'MAT100', title: 'Mathematics', credits: 4 }],
      }],
      categories: [],
      capturedAt: CURRENT_CAPTURE,
    },
    profile: { gpa: 3.1 },
    grades: [{ id: 'failed-math', courseCode: 'MAT100', courseName: 'Mathematics', credits: 4, score: 55 }],
  }, {
    assignments: domainOutcome({ emptyConfirmed: true }),
    exams: domainOutcome({ emptyConfirmed: true }),
    profile: domainOutcome({ source: ['jwglxt'] }),
    grades: domainOutcome({ source: ['jwglxt'] }),
    'academic-progress': domainOutcome({ source: ['jwglxt'] }),
  }), {
    ...OPTIONS,
    upgradeRule: {
      id: 'versioned-upgrade-line',
      rulesVersion: 'local-config/2026-08-14/v1',
      sourceLabel: 'Versioned local configuration',
      thresholdCredits: 24,
      requirementIds: ['required'],
    },
  })

  const evidenceIds = new Set(overview.academic.evidence.map((entry) => entry.id))
  const analysis = overview.academic.analysis
  for (const id of [
    ...analysis.requirements.roots[0].evidenceRefs,
    ...analysis.requirements.roots[0].credits.evidenceRefs,
    ...analysis.gpa.selected.evidenceRefs,
    ...analysis.upgrade.evidenceRefs,
    ...analysis.failures[0].evidenceRefs,
  ]) assert.equal(evidenceIds.has(id), true, `unclosed nested evidence ${id}`)

  const cases = [
    ['requirement evidenceRefs', (copy) => { copy.academic.analysis.requirements.roots[0].evidenceRefs = ['missing-evidence'] }],
    ['GPA claimId', (copy) => { copy.academic.analysis.gpa.selected.claimId = 'missing-claim' }],
    ['upgrade evidenceRefs', (copy) => { copy.academic.analysis.upgrade.evidenceRefs = ['missing-evidence'] }],
    ['failure claimIds', (copy) => { copy.academic.analysis.failures[0].claimIds = ['missing-claim'] }],
    ['null claimIds member', (copy) => { copy.academic.analysis.upgrade.claimIds = [null] }],
    ['requirement claimIds map', (copy) => { copy.academic.analysis.requirements.roots[0].credits.claimIds.earned = 'missing-claim' }],
    ['scenario evidenceRefs', (copy) => {
      copy.academic.analysis.scenario = {
        scenario: true,
        status: 'unknown',
        additionalRequiredCredits: null,
        alternativeSelections: {},
        baseRemaining: null,
        remaining: null,
        evidenceRefs: ['missing-evidence'],
        claimId: null,
        issues: [],
      }
    }],
    ['scenario claimId', (copy) => {
      copy.academic.analysis.scenario = {
        scenario: true,
        status: 'unknown',
        additionalRequiredCredits: null,
        alternativeSelections: {},
        baseRemaining: null,
        remaining: null,
        evidenceRefs: [],
        claimId: 'missing-claim',
        issues: [],
      }
    }],
  ]
  for (const [label, mutate] of cases) {
    const copy = structuredClone(overview)
    mutate(copy)
    assert.throws(() => assertAdvisorOverview(copy), /invalid reference/, label)
  }
})

test('academic evidence includes structural requirement evidence even when no top-level claim or risk uses it', () => {
  const overview = createAdvisorOverview(versionedState({
    academicProgress: {
      roots: [{ id: 'structural-only', title: 'Structural only', relation: 'and', children: [] }],
      categories: [],
    },
  }, {
    assignments: domainOutcome({ emptyConfirmed: true }),
    exams: domainOutcome({ emptyConfirmed: true }),
    grades: domainOutcome({ emptyConfirmed: true }),
    'academic-progress': domainOutcome(),
  }), OPTIONS)
  const nestedId = overview.academic.analysis.requirements.roots[0].evidenceRefs[0]

  assert.equal(overview.academic.evidence.some((entry) => entry.id === nestedId), true)
  assert.equal(overview.evidence.some((entry) => entry.id === nestedId), true)
  assertAdvisorOverview(overview)
})

test('data quality uses the canonical domain catalog for aggregate and local datasets', () => {
  const versioned = versionedState({
    terms: [{ id: '2026-3' }],
    assignments: [{ id: 'assignment-1' }],
    emails: [{ id: 'mail-1' }],
    dataCatalog: {
      collections: {
        fitness: { records: { '2025': { score: 80 } } },
        schoolSchedule: { records: {} },
        academicCalendar: { calendar: { schoolYear: '2026-2027' } },
      },
    },
  }, {
    academic: domainOutcome(),
    coursework: domainOutcome(),
    emails: domainOutcome(),
    fitness: domainOutcome(),
    calendar: domainOutcome(),
    'data-catalog': domainOutcome(),
  })
  const domains = evaluateDataQuality(versioned, OPTIONS).domains

  assert.equal(domains.academic.recordCount, 1)
  assert.equal(domains.coursework.recordCount, 1)
  assert.equal(domains.mailbox.recordCount, 1)
  assert.equal(domains.fitness.recordCount, 1)
  assert.equal(domains['academic-calendar'].recordCount, 1)
  assert.equal(domains['local-data-catalog'].recordCount, 3)
  for (const domain of ['academic', 'coursework', 'mailbox', 'fitness', 'academic-calendar', 'local-data-catalog']) {
    assert.equal(domains[domain].availability, 'available', domain)
    assert.equal(domains[domain].provenanceInferred, false, domain)
    assert.match(domains[domain].contentDigest, /^[a-f0-9]{64}$/)
  }
  assert.equal(Object.hasOwn(domains, 'emails'), false)
  assert.equal(Object.hasOwn(domains, 'data-catalog'), false)
})

test('derived local-data catalog failures do not duplicate child-domain repair actions', () => {
  const failedOutcome = domainOutcome({
    succeeded: false,
    status: 'failed',
    retainedPrevious: true,
    errorCode: 'fitness_read_failed',
    completeness: 'partial',
  })
  const overview = createAdvisorOverview(versionedState({
    dataCatalog: {
      collections: {
        fitness: { records: { '2025-2026_1': { score: 80 } } },
        schoolSchedule: { records: {} },
        academicCalendar: {},
      },
    },
  }, {
    fitness: failedOutcome,
    'local-data-catalog': failedOutcome,
  }), OPTIONS)

  assert.equal(overview.dataQuality.domains['local-data-catalog'].lastAttempt.status, 'failed')
  assert.equal(overview.risks.some((entry) => entry.kind === 'data-quality' && entry.domain === 'fitness'), true)
  assert.equal(overview.risks.some((entry) => entry.kind === 'data-quality' && entry.domain === 'local-data-catalog'), false)
})

test('evidence IDs are stable, opaque, digest-bound, and enforce revision and disclosure checks', () => {
  const versioned = versionedState({ assignments: [{ id: 'student-123-secret', title: 'Task' }] }, {
    assignments: domainOutcome(),
  })
  const dataQuality = evaluateDataQuality(versioned, OPTIONS)
  const create = (input = versioned) => new EvidenceRegistry(input, { dataQuality, rulesVersion: 'theia-advisor-rules/v1' })
  const fields = ['title', 'dueAt']
  const firstRegistry = create()
  const first = firstRegistry.register({ dataset: 'assignments', entityId: 'student-123-secret', fields, domain: 'assignments' })
  const second = create().register({ dataset: 'assignments', entityId: 'student-123-secret', fields: [...fields].reverse(), domain: 'assignments' })
  assert.equal(first.id, second.id)
  assert.match(first.domainDigest, /^[a-f0-9]{64}$/)
  assert.match(first.evidenceDigest, /^[a-f0-9]{64}$/)
  assert.doesNotMatch(first.id, /student|secret|123/)
  assert.deepEqual(firstRegistry.validateReference(first.id, { requireDisclosure: false }), { valid: true, reason: null })
  assert.deepEqual(firstRegistry.validateReference(first.id), { valid: false, reason: 'reference-not-disclosed' })
  firstRegistry.disclose(first.id, ['title'])
  assert.deepEqual(firstRegistry.validateReference(first.id, { fields: ['title'] }), { valid: true, reason: null })
  assert.deepEqual(firstRegistry.validateReference(first.id, { snapshotRevision: 'other', fields: ['title'] }), { valid: false, reason: 'revision-mismatch' })

  const changed = { ...versioned, domainDigests: { ...versioned.domainDigests, assignments: 'f'.repeat(64) } }
  const changedQuality = evaluateDataQuality(changed, OPTIONS)
  const changedRegistry = new EvidenceRegistry(changed, { dataQuality: changedQuality, rulesVersion: 'theia-advisor-rules/v1' })
  const changedEvidence = changedRegistry.register({ dataset: 'assignments', entityId: 'student-123-secret', fields, domain: 'assignments' })
  assert.notEqual(first.id, changedEvidence.id)
})

test('quality evidence changes when sync outcome changes even if business content does not', () => {
  const successful = versionedState({
    assignments: [{ id: 'same-content', title: 'Retained task' }],
  }, {
    assignments: domainOutcome({ completeness: 'partial', errorCode: 'partial-source' }),
  })
  const failed = versionedState({
    assignments: [{ id: 'same-content', title: 'Retained task' }],
  }, {
    assignments: domainOutcome({
      succeeded: false,
      status: 'failed',
      retainedPrevious: true,
      sourceSucceededAt: OLD_CAPTURE,
      errorCode: 'source-timeout',
    }),
  })
  assert.equal(successful.domainDigests.assignments, failed.domainDigests.assignments)

  const successfulOverview = createAdvisorOverview(successful, OPTIONS)
  const failedOverview = createAdvisorOverview(failed, OPTIONS)
  const successfulEvidence = successfulOverview.evidence.find((item) => item.dataset === 'sync-domain' && item.domain === 'assignments')
  const failedEvidence = failedOverview.evidence.find((item) => item.dataset === 'sync-domain' && item.domain === 'assignments')
  const successfulClaim = successfulOverview.claims.find((item) => item.subject === 'assignments' && item.predicate === 'data-quality-severity')
  const failedClaim = failedOverview.claims.find((item) => item.subject === 'assignments' && item.predicate === 'data-quality-severity')

  assert.notEqual(successfulEvidence.id, failedEvidence.id)
  assert.equal(successfulEvidence.domainDigest, successful.domainDigests.assignments)
  assert.equal(failedEvidence.domainDigest, failed.domainDigests.assignments)
  assert.equal(successfulEvidence.domainDigest, failedEvidence.domainDigest)
  assert.notEqual(successfulEvidence.evidenceDigest, failedEvidence.evidenceDigest)
  assert.notEqual(successfulClaim.id, failedClaim.id)
})

test('computed claim identity is stable across evaluation time while its value changes', () => {
  const versioned = versionedState({
    assignments: [{
      id: 'countdown',
      title: 'Countdown task',
      dueAt: '2026-08-13T05:00:00.000Z',
      status: 'pending',
      capturedAt: CURRENT_CAPTURE,
      source: 'theol',
    }],
  }, {
    assignments: domainOutcome({ source: ['theol'] }),
    exams: domainOutcome({ emptyConfirmed: true }),
    grades: domainOutcome({ emptyConfirmed: true }),
    'academic-progress': domainOutcome({ emptyConfirmed: true }),
  })
  const first = createAdvisorOverview(versioned, OPTIONS)
  const second = createAdvisorOverview(versioned, { ...OPTIONS, now: '2026-08-13T01:00:00.000Z' })
  const firstCountdown = first.claims.find((item) => item.predicate === 'minutes-remaining')
  const secondCountdown = second.claims.find((item) => item.predicate === 'minutes-remaining')

  assert.notEqual(firstCountdown.value.value, secondCountdown.value.value)
  assert.equal(firstCountdown.id, secondCountdown.id)
  assert.notEqual(first.evaluatedAt, second.evaluatedAt)
  for (const evidence of first.evidence) {
    assert.ok(evidence.disclosedFields.length > 0, evidence.id)
    assert.equal(evidence.disclosedFields.every((field) => evidence.fields.includes(field)), true)
  }
})

test('overview closes every evidence and claim reference without exposing URLs or raw entity IDs', () => {
  const versioned = versionedState({
    assignments: [{
      id: 'raw-private-assignment-id',
      title: 'Lab report',
      courseName: 'Chemistry',
      dueAt: '2026-08-13T05:00:00.000Z',
      status: 'pending',
      capturedAt: CURRENT_CAPTURE,
      source: 'theol',
      sourceUrl: 'https://course.example/task?token=private',
    }],
    exams: [{
      id: 'raw-private-exam-id',
      courseName: 'Calculus',
      startAt: '2026-08-14T01:00:00.000Z',
      examTime: '2026-08-14 09:00',
      capturedAt: CURRENT_CAPTURE,
      source: 'jwglxt',
      sourceUrl: 'https://academic.example/exam?student=private',
    }],
  }, {
    assignments: domainOutcome({ source: ['theol'] }),
    exams: domainOutcome({ source: ['jwglxt'] }),
    grades: domainOutcome({ emptyConfirmed: true }),
    'academic-progress': domainOutcome({ emptyConfirmed: true }),
  })
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => { throw new Error('overview attempted network I/O') }
  let overview
  try {
    overview = createAdvisorOverview(versioned, OPTIONS)
  } finally {
    globalThis.fetch = originalFetch
  }

  const evidenceIds = new Set(overview.evidence.map((item) => item.id))
  const claimIds = new Set(overview.claims.map((item) => item.id))
  for (const item of [...overview.risks, ...overview.urgentItems, ...overview.claims]) {
    for (const id of item.evidenceRefs || []) assert.equal(evidenceIds.has(id), true, `unresolved evidence ${id}`)
  }
  for (const item of [...overview.risks, ...overview.urgentItems]) {
    for (const id of item.claimIds || []) assert.equal(claimIds.has(id), true, `unresolved claim ${id}`)
  }
  const serialized = serializeAdvisorOverview(overview)
  assert.doesNotMatch(serialized, /sourceUrl|token=private|student=private|raw-private/)
  assert.equal(serialized, serializeAdvisorOverview(createAdvisorOverview(versioned, OPTIONS)))
})

test('deadline agenda is deterministic, skips submitted work and past exams, and uses fixed score components', () => {
  const versioned = versionedState({
    assignments: [
      { id: 'pending', title: 'Pending task', dueAt: '2026-08-13T05:00:00.000Z', status: 'pending', capturedAt: CURRENT_CAPTURE, source: 'theol' },
      { id: 'done', title: 'Submitted task', dueAt: '2026-08-13T01:00:00.000Z', status: 'submitted', capturedAt: CURRENT_CAPTURE, source: 'theol' },
    ],
    exams: [
      { id: 'future', courseName: 'Future exam', startAt: '2026-08-14T01:00:00.000Z', capturedAt: CURRENT_CAPTURE, source: 'jwglxt' },
      { id: 'past', courseName: 'Past exam', startAt: '2026-08-12T01:00:00.000Z', capturedAt: CURRENT_CAPTURE, source: 'jwglxt' },
    ],
  }, {
    assignments: domainOutcome({ source: ['theol'] }),
    exams: domainOutcome({ source: ['jwglxt'] }),
    grades: domainOutcome({ emptyConfirmed: true }),
    'academic-progress': domainOutcome({ emptyConfirmed: true }),
  })
  const overview = createAdvisorOverview(versioned, OPTIONS)
  assert.equal(overview.risks.some((risk) => risk.title.includes('Submitted task')), false)
  assert.equal(overview.risks.some((risk) => risk.title.includes('Past exam')), false)
  const pending = overview.urgentItems.find((item) => item.title.includes('Pending task'))
  assert.deepEqual(pending.score, {
    urgency: 38,
    impact: 26,
    delayCost: 15,
    confidence: 15,
    total: 94,
    formulaVersion: 'theia-advisor-agenda-score/v1',
    components: {
      urgency: '0-6h',
      impact: 'deadline-assignment',
      delayCost: 'irrecoverable-window',
      confidence: 'fresh-complete-success',
    },
  })
  assert.equal(overview.urgentItems[0].id, pending.id)
})
