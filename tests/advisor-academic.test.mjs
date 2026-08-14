import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalJson } from '../core/advisor/canonical.mjs'
import { evaluateDataQuality } from '../core/advisor/data-quality.mjs'
import { EvidenceRegistry } from '../core/advisor/evidence-registry.mjs'
import { analyzeAcademicRequirements, evaluateAcademic } from '../core/advisor/academic-engine.mjs'
import { buildAgenda } from '../core/advisor/agenda-engine.mjs'
import { CURRENT_CAPTURE, FIXED_NOW, domainOutcome, versionedState } from './fixtures/advisor-fixtures.mjs'

const RULES_VERSION = 'theia-advisor-rules/v1'
const OPTIONS = Object.freeze({ now: FIXED_NOW, timeZone: 'Asia/Shanghai', rulesVersion: RULES_VERSION })

function requirement(id, {
  title = id,
  relation = 'and',
  required,
  earned,
  remaining,
  children = [],
  courses = [],
} = {}) {
  return { id, title, relation, required, earned, remaining, children, courses }
}

function academicVersioned(overrides = {}) {
  const academicProgress = overrides.academicProgress === undefined
    ? {
        gpa: 3.2,
        roots: [requirement('root', { required: 20, earned: 12, remaining: 8 })],
        categories: [],
        requirementSource: 'api-tree-detail',
        capturedAt: CURRENT_CAPTURE,
      }
    : overrides.academicProgress && typeof overrides.academicProgress === 'object'
      ? { requirementSource: 'api-tree-detail', ...overrides.academicProgress }
      : overrides.academicProgress
  return versionedState({
    profile: { gpa: 3.2 },
    grades: [],
    ...overrides,
    academicProgress,
  }, {
    profile: domainOutcome({ source: ['jwglxt'] }),
    grades: domainOutcome({ source: ['jwglxt'] }),
    'academic-progress': domainOutcome({ source: ['jwglxt'] }),
  })
}

function evaluate(versioned, extras = {}) {
  const dataQuality = evaluateDataQuality(versioned, OPTIONS)
  const evidenceRegistry = new EvidenceRegistry(versioned, { dataQuality, rulesVersion: RULES_VERSION })
  return evaluateAcademic(versioned, { ...OPTIONS, dataQuality, evidenceRegistry, ...extras })
}

function findClaim(result, predicate) {
  return result.claims.find((claim) => claim.predicate === predicate)
}

function assertClosed(result) {
  const evidenceIds = new Set(result.evidence.map((entry) => entry.id))
  const claimIds = new Set(result.claims.map((claim) => claim.id))
  assert.equal(evidenceIds.size, result.evidence.length)
  assert.equal(claimIds.size, result.claims.length)
  for (const claim of result.claims) {
    assert.equal(claim.evidenceRefs.length > 0, true, claim.id)
    assert.equal(claim.rulesVersion, result.rulesVersion)
    for (const id of claim.evidenceRefs) assert.equal(evidenceIds.has(id), true, id)
  }
  for (const risk of result.risks) {
    assert.equal(risk.rulesVersion, result.rulesVersion)
    for (const field of [
      'entityId', 'domain', 'dueAt', 'deadlineBand', 'actionable', 'suggestedAction',
      'actionKind', 'impactClass', 'delayCostClass', 'quality',
    ]) assert.notEqual(risk[field], undefined, `${risk.id}.${field}`)
    assert.deepEqual(Object.keys(risk.quality).sort(), [
      'availability', 'completeness', 'freshness', 'lastAttemptStatus',
    ])
    for (const id of risk.evidenceRefs) assert.equal(evidenceIds.has(id), true, id)
    for (const id of risk.claimIds) assert.equal(claimIds.has(id), true, id)
  }
  for (const evidence of result.evidence) {
    assert.equal(evidence.snapshotRevision, result.snapshotRevision)
    assert.equal(evidence.disclosedFields.length > 0, true, evidence.id)
  }
}

test('requirement corpus: nested AND nodes add while sibling OR alternatives never add together', () => {
  const cases = [
    {
      name: 'plain-and',
      roots: [requirement('root', { children: [
        requirement('a', { required: 4, earned: 1 }),
        requirement('b', { required: 6, earned: 2 }),
      ] })],
      expected: '7.0000',
    },
    {
      name: 'nested-and',
      roots: [requirement('root', { children: [
        requirement('section', { children: [
          requirement('a', { required: 4, earned: 3 }),
          requirement('b', { required: 6, earned: 1 }),
        ] }),
        requirement('c', { required: 5, earned: 5 }),
      ] })],
      expected: '6.0000',
    },
    {
      name: 'unselected-or-is-unknown',
      roots: [requirement('root', { children: [
        requirement('base', { required: 2, earned: 2 }),
        requirement('track-a', { relation: 'or', required: 10, earned: 5 }),
        requirement('track-b', { relation: 'or', required: 20, earned: 20 }),
      ] })],
      expected: null,
    },
    {
      name: 'selected-first-or',
      roots: [requirement('root', { children: [
        requirement('base', { required: 2, earned: 2 }),
        requirement('track-a', { relation: 'or', required: 10, earned: 5 }),
        requirement('track-b', { relation: 'or', required: 20, earned: 20 }),
      ] })],
      selections: { root: 'track-a' },
      expected: '5.0000',
    },
    {
      name: 'selected-second-or',
      roots: [requirement('root', { children: [
        requirement('base', { required: 2, earned: 2 }),
        requirement('track-a', { relation: 'or', required: 10, earned: 5 }),
        requirement('track-b', { relation: 'or', required: 20, earned: 20 }),
      ] })],
      selections: { root: 'track-b' },
      expected: '0.0000',
    },
    {
      name: 'official-parent-remaining-wins',
      roots: [requirement('root', { remaining: 3, children: [
        requirement('track-a', { relation: 'or', required: 10, earned: 0 }),
        requirement('track-b', { relation: 'or', required: 20, earned: 0 }),
      ] })],
      expected: '3.0000',
    },
  ]

  for (const item of cases) {
    const analysis = analyzeAcademicRequirements({ roots: item.roots }, { alternativeSelections: item.selections })
    assert.equal(analysis.summary.remaining, item.expected, item.name)
  }
})

test('requirement corpus: roots take precedence and categories fallback is always partial', () => {
  const rooted = analyzeAcademicRequirements({
    roots: [requirement('official', { required: 10, earned: 7 })],
    categories: [requirement('flat', { required: 99, earned: 0 })],
  })
  assert.equal(rooted.source, 'roots')
  assert.equal(rooted.nodes.some((node) => node.id === 'flat'), false)
  assert.equal(rooted.summary.remaining, '3.0000')

  const oneCategory = analyzeAcademicRequirements({ categories: [requirement('flat', { required: 12, earned: 5 })] })
  assert.equal(oneCategory.source, 'categories')
  assert.equal(oneCategory.completeness, 'partial')
  assert.equal(oneCategory.summary.remaining, '7.0000')
  assert.ok(oneCategory.issues.includes('categories-fallback-partial'))

  const overlappingCategories = analyzeAcademicRequirements({ categories: [
    requirement('flat-a', { required: 12, earned: 5 }),
    requirement('flat-b', { required: 8, earned: 8 }),
  ] })
  assert.equal(overlappingCategories.summary.remaining, null)
  assert.ok(overlappingCategories.issues.includes('categories-overlap-unknown'))
})

test('requirement source and remaining-only nodes preserve conservative completeness', () => {
  const official = analyzeAcademicRequirements({
    requirementSource: 'api-tree-detail',
    roots: [requirement('official', { required: 10, earned: 7, remaining: 3 })],
  })
  assert.equal(official.requirementSourceKind, 'official-tree')
  assert.equal(official.structuralCompleteness, 'complete')
  assert.equal(official.completeness, 'complete')

  const dom = analyzeAcademicRequirements({
    requirementSource: 'jwglxt-dom-tree',
    roots: [requirement('dom', { required: 10, earned: 7, remaining: 3 })],
  })
  assert.equal(dom.requirementSourceKind, 'official-tree')
  for (const source of ['browser-tree-detail', 'browser-embedded-tree']) {
    assert.equal(analyzeAcademicRequirements({
      requirementSource: source,
      roots: [requirement(source, { required: 10, earned: 7, remaining: 3 })],
    }).requirementSourceKind, 'official-tree')
  }

  const inferred = analyzeAcademicRequirements({
    requirementSource: 'api-inferred-tree',
    roots: [requirement('inferred', { required: 10, earned: 7, remaining: 3 })],
  })
  assert.equal(inferred.requirementSourceKind, 'inferred-tree')
  assert.equal(inferred.structuralCompleteness, 'complete')
  assert.equal(inferred.completeness, 'partial')
  assert.ok(inferred.caveats.some((item) => item.includes('本地推断')))

  const remainingOnly = analyzeAcademicRequirements({
    requirementSource: 'api-tree-detail',
    roots: [requirement('remaining-only', { remaining: 3 })],
  })
  assert.equal(remainingOnly.nodes[0].completeness, 'partial')
  assert.equal(remainingOnly.completeness, 'partial')
})

test('missing-field corpus never silently turns unknown credits into zero', () => {
  const cases = [
    requirement('missing-all'),
    requirement('missing-earned', { required: 4 }),
    requirement('missing-required', { earned: 2 }),
    requirement('missing-child-earned', { children: [requirement('child', { required: 4 })] }),
    requirement('invalid-values', { required: 'bad', earned: -1, remaining: Number.NaN }),
  ]
  for (const [index, root] of cases.entries()) {
    const analysis = analyzeAcademicRequirements({ roots: [root] })
    assert.equal(analysis.summary.remaining, null, `case ${index}`)
    assert.notEqual(analysis.completeness, 'complete', `case ${index}`)
  }
})

test('GPA corpus: source precedence and discrepancy remain deterministic', () => {
  const cases = [
    { progress: 3.2, profile: 3.2, selected: 'academicProgress', discrepancy: 'absent' },
    { progress: 3.2, profile: 3.1, selected: 'academicProgress', discrepancy: 'present', difference: '0.1000' },
    { progress: null, profile: 3.1, selected: 'profile', discrepancy: 'unknown' },
    { progress: 3.2, profile: null, selected: 'academicProgress', discrepancy: 'unknown' },
    { progress: 'bad', profile: 3.1, selected: 'profile', discrepancy: 'unknown' },
  ]
  for (const [index, item] of cases.entries()) {
    const result = evaluate(academicVersioned({
      academicProgress: { gpa: item.progress, roots: [requirement('root', { required: 4, earned: 4 })] },
      profile: { gpa: item.profile },
    }))
    assert.equal(result.analysis.gpa.selectedSource, item.selected, `case ${index}`)
    assert.equal(result.analysis.gpa.discrepancy.state, item.discrepancy, `case ${index}`)
    if (item.difference) assert.equal(result.analysis.gpa.discrepancy.difference, item.difference)
    assertClosed(result)
  }
})

test('school GPA accepts the 4.33 boundary and rejects values above the school scale', () => {
  const boundary = evaluate(academicVersioned({
    academicProgress: { gpa: 4.33, roots: [requirement('root', { required: 4, earned: 4 })] },
    profile: { gpa: 3.2 },
  }))
  assert.equal(boundary.analysis.gpa.selectedSource, 'academicProgress')
  assert.equal(boundary.analysis.gpa.sources.academicProgress.value, '4.3300')
  assert.equal(boundary.analysis.gpa.issues.includes('academic-progress-gpa-invalid'), false)
  assertClosed(boundary)

  for (const invalidGpa of [4.3301, 4.5, 5]) {
    const profileFallback = evaluate(academicVersioned({
      academicProgress: { gpa: invalidGpa, roots: [requirement('root', { required: 4, earned: 4 })] },
      profile: { gpa: 3.2 },
    }))
    assert.equal(profileFallback.analysis.gpa.selectedSource, 'profile', String(invalidGpa))
    assert.equal(profileFallback.analysis.gpa.sources.academicProgress, undefined, String(invalidGpa))
    assert.equal(profileFallback.analysis.gpa.sources.profile.value, '3.2000', String(invalidGpa))
    assert.equal(profileFallback.analysis.gpa.issues.includes('academic-progress-gpa-invalid'), true, String(invalidGpa))
    assertClosed(profileFallback)
  }

  const localFallback = evaluate(academicVersioned({
    academicProgress: { gpa: 5, roots: [requirement('root', { required: 4, earned: 4 })] },
    profile: { gpa: 4.3301 },
    grades: [{ id: 'local', courseCode: 'LOCAL100', credits: 3, score: 90 }],
  }))
  assert.equal(localFallback.analysis.gpa.selectedSource, 'local')
  assert.equal(localFallback.analysis.gpa.sources.academicProgress, undefined)
  assert.equal(localFallback.analysis.gpa.sources.profile, undefined)
  assert.equal(localFallback.analysis.gpa.sources.local.value, '4.0000')
  assert.equal(localFallback.analysis.gpa.issues.includes('academic-progress-gpa-invalid'), true)
  assert.equal(localFallback.analysis.gpa.issues.includes('profile-gpa-invalid'), true)
  assertClosed(localFallback)
})

test('GPA values and display text keep the four-decimal contract', () => {
  const result = evaluate(academicVersioned({
    academicProgress: { gpa: 3.2, roots: [requirement('root', { required: 4, earned: 4 })] },
    profile: { gpa: 3.1 },
    grades: [{ id: 'numeric', courseCode: 'NUM100', credits: 3, score: 90 }],
  }))
  const gpaClaims = result.claims.filter((claim) => claim.value?.unit === 'gpa')
  assert.equal(gpaClaims.length, 4)
  for (const claim of gpaClaims) {
    assert.match(claim.value.value, /^\d+\.\d{4}$/)
    assert.match(claim.displayText, /\d+\.\d{4}$/)
  }
  assert.equal(result.analysis.gpa.sources.academicProgress.value, '3.2000')
  assert.equal(result.analysis.gpa.sources.profile.value, '3.1000')
  assert.equal(result.analysis.gpa.sources.local.value, '4.0000')
  assert.equal(result.analysis.gpa.discrepancy.difference, '0.1000')
  assertClosed(result)
})

test('local GPA boundary corpus excludes text marks and missing fields without inventing values', () => {
  const versioned = academicVersioned({
    academicProgress: { gpa: null, roots: [requirement('root', { required: 4, earned: 4 })] },
    profile: { gpa: null },
    grades: [
      { id: 'numeric', courseCode: 'NUM100', credits: 3, score: 90 },
      { id: 'failed', courseCode: 'FAIL100', credits: 1, score: 59 },
      { id: 'pass-mark', courseCode: 'PASS100', credits: 2, score: '合格' },
      { id: 'excluded', courseCode: 'EX100', credits: 2, score: 100, gpaIncluded: false },
      { id: 'missing-credit', courseCode: 'MISS100', score: 80 },
      { id: 'missing-point', courseCode: 'TEXT100', credits: 2, score: '缓考' },
    ],
  })
  const result = evaluate(versioned)
  const boundary = result.analysis.gpa.localBoundary
  assert.equal(result.analysis.gpa.selectedSource, 'local')
  assert.equal(result.analysis.gpa.sources.local.value, '3.0000')
  assert.equal(boundary.includedCredits, '4.0000')
  assert.equal(boundary.includedCourses, 2)
  assert.equal(boundary.completeness, 'partial')
  assert.equal(boundary.exclusions['non-numeric-mark'], 1)
  assert.equal(boundary.exclusions['explicitly-excluded'], 1)
  assert.equal(boundary.exclusions['missing-or-invalid-credits'], 1)
  assert.equal(boundary.exclusions['missing-point-or-numeric-score'], 1)
  assert.match(findClaim(result, 'local-gpa').caveats.join(' '), /不替代学校口径/)
  assertClosed(result)
})

test('local advisor GPA keeps explicit failed marks in the zero-point denominator', () => {
  const result = evaluate(academicVersioned({
    academicProgress: { gpa: null, roots: [requirement('root', { required: 6, earned: 3 })] },
    profile: null,
    grades: [
      { id: 'numeric', courseCode: 'NUM100', credits: 3, score: 90, point: 4 },
      { id: 'failed-u', courseCode: 'FAILU100', credits: 2, score: 'U', point: 3.5 },
      { id: 'failed-text', courseCode: 'FAILTEXT100', credits: 1, score: '不合格', point: 3.5 },
    ],
  }))
  assert.equal(result.analysis.gpa.sources.local.value, '2.0000')
  assert.equal(result.analysis.gpa.localBoundary.includedCredits, '6.0000')
  assert.equal(result.analysis.gpa.localBoundary.includedCourses, 3)
  assert.equal(result.analysis.gpa.localBoundary.exclusions['non-numeric-mark'], 0)
  assertClosed(result)
})

test('local advisor GPA shares explicit exclusion and qualitative-retake rules with the grades view', () => {
  const result = evaluate(academicVersioned({
    academicProgress: { gpa: null, roots: [requirement('root', { required: 6, earned: 3 })] },
    profile: null,
    grades: [
      { id: 'base', courseCode: 'BASE100', credits: 2, score: 90, point: 4 },
      { id: 'excluded', courseCode: 'EX100', credits: 1, score: '不合格', point: 0, remark: '不统计2025' },
      { id: 'old-failure', courseCode: 'RETAKE100', termId: '2024-3', credits: 1, score: '不合格', point: 0 },
      { id: 'qualitative-pass', courseCode: 'RETAKE100', termId: '2025-3', credits: 1, score: '合格', point: null },
    ],
  }))
  assert.equal(result.analysis.gpa.sources.local.value, '4.0000')
  assert.equal(result.analysis.gpa.localBoundary.includedCredits, '2.0000')
  assert.equal(result.analysis.gpa.localBoundary.includedCourses, 1)
  assert.equal(result.analysis.gpa.localBoundary.exclusions['explicitly-excluded'], 1)
  assert.equal(result.analysis.gpa.localBoundary.exclusions['non-numeric-mark'], 1)
  assertClosed(result)
})

test('text-grade corpus identifies explicit failures but never upgrades name-only matches to known relations', () => {
  const statuses = ['不合格', '缺考', 'F', 'U', '59']
  for (const [index, score] of statuses.entries()) {
    const versioned = academicVersioned({
      grades: [{ id: `grade-${index}`, courseName: '高等数学', credits: 4, score }],
      academicProgress: {
        gpa: null,
        roots: [requirement('math-node', {
          required: 4,
          earned: 0,
          courses: [{ title: '高等数学', credits: 4 }],
        })],
      },
      profile: null,
    })
    const result = evaluate(versioned)
    assert.equal(result.analysis.failures.length, 1, score)
    assert.equal(result.analysis.failures[0].relationStatus, 'unknown', score)
    assert.equal(result.analysis.failures[0].matchBasis, 'course-name', score)
    assert.deepEqual(result.analysis.failures[0].requirementIds, [], score)
    assert.deepEqual(result.analysis.failures[0].candidateRequirementIds, ['math-node'], score)
    assertClosed(result)
  }
})

test('academic advisor serialization never exposes a raw failed-grade record id', () => {
  const rawGradeId = 'PRIVATE-GRADE-RAW-ID-983274'
  const result = evaluate(academicVersioned({
    grades: [{ id: rawGradeId, courseCode: 'PRIVATE100', credits: 2, score: 'U' }],
    academicProgress: { gpa: null, roots: [requirement('root', { required: 2, earned: 0 })] },
    profile: null,
  }))

  assert.equal(result.analysis.failures.length, 1)
  const failedGradeRisk = result.risks.find((risk) => risk.kind.startsWith('failed-course-'))
  assert.ok(failedGradeRisk)
  assert.match(failedGradeRisk.entityId, /^failed-grade:[a-f0-9]{16}$/)
  assert.doesNotMatch(canonicalJson(result), new RegExp(rawGradeId))
  assertClosed(result)
})

test('missing point values do not turn passing or qualitative rows into failures', () => {
  const result = evaluate(academicVersioned({
    grades: [
      { id: 'numeric-pass', courseCode: 'NUM100', credits: 3, score: 90, point: null },
      { id: 'qualitative-pass', courseCode: 'PASS100', credits: 2, score: '合格', point: null },
      { id: 'neutral-status', courseCode: 'WAIT100', credits: 2, status: '已修', point: '' },
    ],
    academicProgress: {
      requirementSource: 'api-tree-detail',
      roots: [requirement('root', { required: 4, earned: 4 })],
    },
    profile: null,
  }))
  assert.deepEqual(result.analysis.failures, [])
  assert.equal(result.analysis.gpa.sources.local.value, '4.0000')
})

test('P0 academic-progress quality downgrades requirements and suppresses confirmed gap Agenda actions', () => {
  const qualityCases = [
    {
      name: 'partial',
      outcome: domainOutcome({ completeness: 'partial' }),
      expected: 'partial',
      caveat: '部分获取',
    },
    {
      name: 'stale',
      outcome: domainOutcome({ capturedAt: '2026-08-01T00:00:00.000Z' }),
      expected: 'partial',
      caveat: '已过期',
    },
    {
      name: 'failed-retained',
      outcome: domainOutcome({
        succeeded: false,
        status: 'failed',
        retainedPrevious: true,
        errorCode: 'network-error',
      }),
      expected: 'partial',
      caveat: '刷新失败',
    },
  ]
  for (const item of qualityCases) {
    const versioned = versionedState({
      profile: null,
      grades: [],
      academicProgress: {
        requirementSource: 'api-tree-detail',
        roots: [requirement('root', { required: 20, earned: 12, remaining: 8 })],
      },
    }, {
      grades: domainOutcome({ source: ['jwglxt'] }),
      'academic-progress': item.outcome,
    })
    const result = evaluate(versioned, {
      upgradeRule: {
        id: 'quality-sensitive-line',
        rulesVersion: 'quality-sensitive/v1',
        thresholdCredits: 20,
        requirementIds: ['root'],
      },
    })
    const requirements = result.analysis.requirements
    assert.equal(requirements.structuralCompleteness, 'complete', item.name)
    assert.equal(requirements.completeness, item.expected, item.name)
    assert.equal(requirements.confirmed, false, item.name)
    assert.equal(requirements.dataQuality.lastAttempt.retainedPrevious, item.name === 'failed-retained', item.name)
    assert.ok(requirements.caveats.some((value) => value.includes(item.caveat)), item.name)
    assert.equal(findClaim(result, 'remaining-credits')?.value.value, '8.0000', item.name)
    assert.equal(result.risks.some((risk) => risk.kind === 'academic-plan-gap'), false, item.name)
    assert.equal(result.analysis.upgrade.status, 'known', item.name)
    assert.equal(result.risks.some((risk) => risk.kind === 'upgrade-credit-gap'), false, item.name)
    assert.equal(buildAgenda(result.risks, OPTIONS).some((entry) => entry.kind === 'academic-plan-gap'), false, item.name)
    assert.ok(findClaim(result, 'upgrade-credit-distance').caveats.some((value) => value.includes(item.caveat)), item.name)
  }
})

test('failed course impact is known only through course code or explicit requirement id', () => {
  const roots = [requirement('math-node', {
    required: 8,
    earned: 4,
    courses: [{ courseCode: 'MAT100', title: '高等数学', credits: 4 }],
  })]
  const result = evaluate(academicVersioned({
    grades: [
      { id: 'code-match', courseCode: 'MAT100', courseName: '高等数学', credits: 4, score: 55 },
      { id: 'explicit-match', courseCode: 'OTHER', requirementId: 'math-node', credits: 2, score: '不合格' },
      { id: 'unrelated', courseCode: 'NOPE', credits: 1, score: '缺考' },
    ],
    academicProgress: { gpa: null, roots },
    profile: null,
  }))
  const byCode = new Map(result.analysis.failures.map((item) => [item.courseCode, item]))
  assert.equal(byCode.get('MAT100').relationStatus, 'known')
  assert.equal(byCode.get('MAT100').matchBasis, 'course-code')
  assert.equal(byCode.get('OTHER').relationStatus, 'known')
  assert.equal(byCode.get('OTHER').matchBasis, 'explicit-requirement-id')
  assert.equal(byCode.get('NOPE').relationStatus, 'unknown')
  assertClosed(result)
})

test('versioned upgrade line exposes configuration source and only reports arithmetic distance', () => {
  const result = evaluate(academicVersioned({
    academicProgress: { gpa: 3.2, roots: [requirement('required', { required: 40, earned: 26 })] },
  }), {
    upgradeRule: {
      id: 'year-two-credit-line',
      rulesVersion: 'buct-config/2026-08-14/v1',
      sourceKind: 'configuration',
      thresholdCredits: 30,
      requirementIds: ['required'],
    },
  })
  assert.equal(result.analysis.upgrade.status, 'known')
  assert.equal(result.analysis.upgrade.rule.sourceLabel, '当前规则配置')
  assert.equal(result.analysis.upgrade.earned, '26.0000')
  assert.equal(result.analysis.upgrade.distance, '4.0000')
  assert.equal(result.analysis.upgrade.remaining, '4.0000')
  const threshold = findClaim(result, 'upgrade-credit-threshold')
  assert.match(threshold.displayText, /当前规则配置/)
  assert.match(findClaim(result, 'upgrade-credit-distance').caveats.join(' '), /不是升级、毕业或学籍结论/)
  assert.equal(JSON.stringify(result).includes('一定能升级'), false)
  assertClosed(result)
})

test('academic risks expose the Agenda contract and only actionable gaps become actions', () => {
  const result = evaluate(academicVersioned({
    academicProgress: {
      gpa: 3.2,
      roots: [requirement('required', {
        required: 40,
        earned: 26,
        courses: [{ courseCode: 'MAT100', title: '高等数学', credits: 4 }],
      })],
    },
    profile: { gpa: 3.1 },
    grades: [{ id: 'failed-math', courseCode: 'MAT100', courseName: '高等数学', credits: 4, score: 55 }],
  }), {
    upgradeRule: {
      id: 'year-two-credit-line',
      rulesVersion: 'buct-config/2026-08-14/v1',
      thresholdCredits: 30,
      requirementIds: ['required'],
    },
  })
  const risksByKind = new Map(result.risks.map((risk) => [risk.kind, risk]))
  const actionableKinds = ['academic-plan-gap', 'upgrade-credit-gap']
  const informationalKinds = ['gpa-discrepancy', 'failed-course-known-requirement']

  for (const kind of actionableKinds) {
    const risk = risksByKind.get(kind)
    assert.equal(risk.domain, 'academic-progress')
    assert.equal(risk.actionable, true)
    assert.equal(risk.actionKind, 'review-academic-gap')
    assert.equal(risk.impactClass, 'academic-gap')
    assert.equal(risk.delayCostClass, 'information-only')
  }
  for (const kind of informationalKinds) {
    const risk = risksByKind.get(kind)
    assert.equal(risk.actionable, false)
    assert.equal(risk.actionKind, 'open-source-detail')
  }
  assert.equal(risksByKind.get('gpa-discrepancy').domain, 'academic-progress')
  assert.equal(risksByKind.get('failed-course-known-requirement').domain, 'grades')

  const agenda = buildAgenda(result.risks, OPTIONS)
  assert.deepEqual(agenda.map((item) => item.kind).sort(), actionableKinds.sort())
  assert.equal(agenda.every((item) => item.actionKind === 'review-academic-gap'), true)
  assert.equal(agenda.some((item) => informationalKinds.includes(item.kind)), false)
  assertClosed(result)
})

test('upgrade rule refuses ambiguous overlap and unknown earned credits', () => {
  const roots = [requirement('parent', {
    required: 10,
    earned: 5,
    children: [requirement('child', { required: 5, earned: 2 })],
  })]
  const overlap = evaluate(academicVersioned({ academicProgress: { roots }, profile: null }), {
    upgradeRule: { rulesVersion: 'config/v1', thresholdCredits: 8, requirementIds: ['parent', 'child'] },
  })
  assert.equal(overlap.analysis.upgrade.status, 'unknown')
  assert.ok(overlap.analysis.upgrade.issues.includes('upgrade-requirement-scope-overlaps'))

  const unknown = evaluate(academicVersioned({ academicProgress: { roots: [requirement('missing-earned', { required: 8 })] }, profile: null }), {
    upgradeRule: { rulesVersion: 'config/v1', thresholdCredits: 8, requirementIds: ['missing-earned'] },
  })
  assert.equal(unknown.analysis.upgrade.status, 'unknown')
  assert.ok(unknown.analysis.upgrade.issues.includes('upgrade-earned-credits-unknown'))
})

test('pure arithmetic what-if does not mutate CampusState and marks all scenario output', () => {
  const versioned = academicVersioned({
    academicProgress: {
      roots: [requirement('root', { children: [
        requirement('base', { required: 4, earned: 4 }),
        requirement('track-a', { relation: 'or', required: 10, earned: 6 }),
        requirement('track-b', { relation: 'or', required: 20, earned: 18 }),
      ] })],
    },
    profile: null,
  })
  const before = canonicalJson(versioned)
  const first = evaluate(versioned, {
    scenario: { additionalRequiredCredits: 1, alternativeSelections: { root: 'track-a' } },
  })
  const second = evaluate(versioned, {
    scenario: { additionalRequiredCredits: 1, alternativeSelections: { root: 'track-a' } },
  })
  assert.equal(first.analysis.scenario.scenario, true)
  assert.equal(first.analysis.scenario.status, 'known')
  assert.equal(first.analysis.scenario.baseRemaining, '4.0000')
  assert.equal(first.analysis.scenario.remaining, '3.0000')
  assert.equal(findClaim(first, 'scenario-remaining-credits').scenario, true)
  assert.equal(canonicalJson(versioned), before)
  assert.equal(canonicalJson(first), canonicalJson(second))
  assertClosed(first)
})

test('what-if remains unknown when the requested alternative is invalid or arithmetic base is missing', () => {
  const invalidSelection = evaluate(academicVersioned({
    academicProgress: { roots: [requirement('root', { children: [
      requirement('track-a', { relation: 'or', required: 4, earned: 2 }),
      requirement('track-b', { relation: 'or', required: 4, earned: 3 }),
    ] })] },
    profile: null,
  }), { scenario: { alternativeSelections: { root: 'missing' } } })
  assert.equal(invalidSelection.analysis.scenario.status, 'unknown')
  assert.ok(invalidSelection.analysis.scenario.issues.includes('invalid-alternative-selection:root'))
  const invalidEvidenceIds = new Set(invalidSelection.evidence.map((entry) => entry.id))
  for (const reference of invalidSelection.analysis.scenario.evidenceRefs) {
    assert.equal(invalidEvidenceIds.has(reference), true, `unresolved scenario evidence ${reference}`)
  }

  const officialParentRemaining = evaluate(academicVersioned({
    academicProgress: {
      requirementSource: 'api-tree-detail',
      roots: [requirement('root', { remaining: 3, children: [
        requirement('track-a', { relation: 'or', required: 4, earned: 2 }),
        requirement('track-b', { relation: 'or', required: 4, earned: 3 }),
      ] })],
    },
    profile: null,
  }), { scenario: { alternativeSelections: { root: 'missing' } } })
  assert.equal(officialParentRemaining.analysis.scenario.status, 'unknown')
  assert.equal(officialParentRemaining.analysis.scenario.remaining, null)
  assert.ok(officialParentRemaining.analysis.scenario.issues.includes('invalid-alternative-selection:root'))

  const unknownParent = evaluate(academicVersioned({
    academicProgress: {
      requirementSource: 'api-tree-detail',
      roots: [requirement('root', { required: 4, earned: 2 })],
    },
    profile: null,
  }), { scenario: { alternativeSelections: { unknown: 'missing' } } })
  assert.equal(unknownParent.analysis.scenario.status, 'unknown')
  assert.equal(unknownParent.analysis.scenario.remaining, null)
  assert.ok(unknownParent.analysis.scenario.issues.includes('invalid-alternative-selection:unknown'))

  const missingBase = evaluate(academicVersioned({
    academicProgress: { roots: [requirement('root')] },
    profile: null,
  }), { scenario: { additionalRequiredCredits: 4 } })
  assert.equal(missingBase.analysis.scenario.status, 'unknown')
  assert.equal(findClaim(missingBase, 'scenario-remaining-credits'), undefined)
  const missingEvidenceIds = new Set(missingBase.evidence.map((entry) => entry.id))
  for (const reference of missingBase.analysis.scenario.evidenceRefs) {
    assert.equal(missingEvidenceIds.has(reference), true, `unresolved scenario evidence ${reference}`)
  }
})

test('academic engine rejects mismatched P0 contracts and remains independent of host clock', () => {
  const versioned = academicVersioned()
  const dataQuality = evaluateDataQuality(versioned, OPTIONS)
  const evidenceRegistry = new EvidenceRegistry(versioned, { dataQuality, rulesVersion: RULES_VERSION })
  assert.throws(() => evaluateAcademic(versioned, {
    ...OPTIONS,
    rulesVersion: 'other-rules',
    dataQuality,
    evidenceRegistry,
  }), /rules version mismatch/)

  const changedRevision = { ...versioned, revision: 'other-revision' }
  assert.throws(() => evaluateAcademic(changedRevision, {
    ...OPTIONS,
    dataQuality,
    evidenceRegistry,
  }), /snapshot revision mismatch/)
})
