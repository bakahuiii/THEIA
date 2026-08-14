import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AcademicReferenceError,
  createAcademicReferenceCatalog,
  projectAcademicResult,
  projectAdvisorOverview,
  projectRequirementMatches,
  resolveAlternativeSelections,
} from '../electron/advisor-academic-references.mjs'

const REVISION = 'snapshot-revision-poison-safe'
const RULES = 'rules/v1'

function fixture() {
  const academicProgress = {
    roots: [{
      id: 'RAW_NODE_ROOT_POISON', title: 'Root', relation: 'and',
      courses: [{ id: 'RAW_COURSE_POISON', title: 'Course' }],
      children: [
        { id: 'RAW_BRANCH_A_POISON', title: 'A', relation: 'or', children: [] },
        { id: 'RAW_BRANCH_B_POISON', title: 'B', relation: 'or', children: [] },
      ],
    }],
  }
  const node = (id, path, parentId, relation = 'and') => ({
    id, path, parentId, title: `安全节点 ${path.join('.')}`, relation, structuralCompleteness: 'complete', completeness: 'complete',
    caveats: [], inputFields: ['remaining'], credits: {
      required: '4.0000', earned: '2.0000', remaining: '2.0000', remainingSource: 'official',
      contributingNodeIds: ['RAW_BRANCH_A_POISON'], evidenceRefs: ['ev'], claimIds: {},
    },
    alternatives: [], selectedAlternativeId: null, selectionStatus: 'not-applicable',
    issues: [`remaining-unknown:${id}`], courses: [], children: [], evidenceRefs: ['ev'],
  })
  const a = node('RAW_BRANCH_A_POISON', [0, 0], 'RAW_NODE_ROOT_POISON', 'or')
  const b = node('RAW_BRANCH_B_POISON', [0, 1], 'RAW_NODE_ROOT_POISON', 'or')
  const root = node('RAW_NODE_ROOT_POISON', [0], null)
  root.children = [a, b]
  root.courses = [{ id: 'RAW_COURSE_POISON' }]
  root.alternatives = [
    { id: a.id, title: 'A', remaining: '2.0000', completeness: 'complete' },
    { id: b.id, title: 'B', remaining: '1.0000', completeness: 'complete' },
  ]
  const academic = {
    schema: 'theia-advisor-academic/v1', snapshotRevision: REVISION, evaluatedAt: '2026-08-14T00:00:00.000Z',
    timeZone: 'Asia/Shanghai', rulesVersion: RULES,
    analysis: {
      requirements: {
        source: 'roots', structuralCompleteness: 'complete', completeness: 'complete', confirmed: true,
        requirementSource: 'api-tree-detail', requirementSourceKind: 'official-tree', dataQuality: null,
        caveats: [], program: 'Program', summary: {
          required: '4.0000', earned: '2.0000', remaining: '2.0000', remainingSource: 'children',
          contributingNodeIds: ['RAW_BRANCH_A_POISON'], evidenceRefs: ['ev'], claimId: null,
        }, alternativeSelections: { RAW_NODE_ROOT_POISON: 'RAW_BRANCH_A_POISON' },
        issues: ['invalid-alternative-selection:RAW_NODE_ROOT_POISON'], roots: [root], nodes: [root, a, b],
      },
      gpa: { selected: null, sources: {}, localBoundary: { exclusions: {} }, issues: [] },
      upgrade: {
        status: 'known', rule: { schema: 'rule/v1', id: 'RAW_RULE_POISON', rulesVersion: RULES, sourceKind: 'configuration', sourceLabel: 'Rule', thresholdCredits: '8.0000', requirementIds: ['RAW_BRANCH_A_POISON'], earnedCredits: null },
        threshold: '8.0000', earned: '2.0000', distance: '6.0000', evidenceRefs: [], claimIds: [], issues: [],
      },
      failures: [{ id: 'RAW_FAILURE_POISON', courseCode: 'X', title: 'Failed', relationStatus: 'known', matchBasis: 'explicit-requirement-id', requirementIds: ['RAW_BRANCH_A_POISON'], candidateRequirementIds: ['RAW_BRANCH_B_POISON'], recordedCredits: '2.0000', evidenceRefs: ['ev'], claimIds: [], caveats: [] }],
      scenario: { scenario: true, status: 'known', additionalRequiredCredits: '1.0000', alternativeSelections: { RAW_NODE_ROOT_POISON: 'RAW_BRANCH_A_POISON' }, baseRemaining: '2.0000', remaining: '1.0000', evidenceRefs: ['ev'], claimId: null, issues: [] },
    },
    claims: [{ id: 'claim', subject: 'academic-requirement:digest-safe', predicate: 'x', evidenceRefs: ['ev'] }],
    risks: [{
      id: 'risk-academic', kind: 'failed-course-known-requirement', domain: 'grades',
      entityId: 'RAW_GRADE_POISON', evidenceRefs: ['ev'], claimIds: ['claim'],
    }],
    evidence: [{ id: 'ev', dataset: 'academic-requirement', entityId: 'RAW_NODE_ROOT_POISON' }],
  }
  return { academicProgress, academic }
}

function catalogFor(progress) {
  return createAcademicReferenceCatalog({ academicProgress: progress, snapshotRevision: REVISION, rulesVersion: RULES })
}

test('catalog creates stable revision-bound opaque requirement and course references', () => {
  const { academicProgress } = fixture()
  const first = catalogFor(academicProgress)
  const second = catalogFor(academicProgress)
  assert.match(first.requirementRef('RAW_NODE_ROOT_POISON', [0]), /^ar1:requirement:[a-f0-9]{20}$/)
  assert.match(first.courseRef('RAW_COURSE_POISON', [0], 0), /^ar1:course:[a-f0-9]{20}$/)
  assert.equal(first.requirementRef('RAW_BRANCH_A_POISON', [0, 0]), second.requirementRef('RAW_BRANCH_A_POISON', [0, 0]))
  const changed = createAcademicReferenceCatalog({ academicProgress, snapshotRevision: 'new-revision', rulesVersion: RULES })
  assert.notEqual(first.requirementRef('RAW_NODE_ROOT_POISON', [0]), changed.requirementRef('RAW_NODE_ROOT_POISON', [0]))
})

test('what-if selection resolution accepts only a current direct OR parent-child pair', () => {
  const { academicProgress } = fixture()
  const catalog = catalogFor(academicProgress)
  const parent = catalog.requirementRef('RAW_NODE_ROOT_POISON', [0])
  const child = catalog.requirementRef('RAW_BRANCH_A_POISON', [0, 0])
  assert.deepEqual(resolveAlternativeSelections(catalog, { [parent]: child }), {
    RAW_NODE_ROOT_POISON: 'RAW_BRANCH_A_POISON',
  })
  assert.throws(() => resolveAlternativeSelections(catalog, { [parent]: 'ar1:requirement:00000000000000000000' }), (error) => error instanceof AcademicReferenceError && error.code === 'invalid-reference')
  const leaf = catalog.requirementRef('RAW_BRANCH_B_POISON', [0, 1])
  assert.throws(() => resolveAlternativeSelections(catalog, { [child]: leaf }), (error) => error.code === 'invalid-alternative-pair')
})

test('duplicate raw interactive IDs are path-addressable but fail closed without an unambiguous mapping', () => {
  const academicProgress = { roots: [
    { id: 'DUPLICATE_RAW_POISON', relation: 'and', children: [] },
    { id: 'DUPLICATE_RAW_POISON', relation: 'and', children: [] },
  ] }
  const catalog = catalogFor(academicProgress)
  assert.notEqual(catalog.requirementRef('DUPLICATE_RAW_POISON', [0]), catalog.requirementRef('DUPLICATE_RAW_POISON', [1]))
  assert.throws(() => catalog.requirementRef('DUPLICATE_RAW_POISON'), (error) => error.code === 'ambiguous-reference')
})

test('explicit academic and overview DTO projection removes every poison entity and internal field', () => {
  const { academicProgress, academic } = fixture()
  const catalog = catalogFor(academicProgress)
  const projected = projectAcademicResult(academic, catalog)
  const json = JSON.stringify(projected)
  for (const poison of ['RAW_NODE_ROOT_POISON', 'RAW_BRANCH_A_POISON', 'RAW_BRANCH_B_POISON', 'RAW_COURSE_POISON', 'RAW_RULE_POISON', 'RAW_FAILURE_POISON', 'RAW_GRADE_POISON']) {
    assert.doesNotMatch(json, new RegExp(poison))
  }
  assert.doesNotMatch(json, /contributingNodeIds|inputFields|"path"|"courses"|"alternativeSelections":\{"RAW/)
  assert.match(projected.analysis.requirements.roots[0].id, /^ar1:requirement:/)
  assert.match(projected.analysis.upgrade.rule.id, /^ar1:entity:/)
  assert.match(projected.risks[0].entityId, /^ar1:entity:/)
  assert.match(projected.evidence[0].entityId, /^ar1:entity:/)

  const overview = projectAdvisorOverview({
    snapshotRevision: REVISION, rulesVersion: RULES, academic,
    risks: [{ id: 'risk-academic', kind: 'failed-course-known-requirement', domain: 'grades', entityId: 'RAW_GRADE_POISON', evidenceRefs: ['ev'], claimIds: ['claim'] }],
    urgentItems: [{ id: 'action-academic', kind: 'failed-course-known-requirement', domain: 'grades', entityId: 'RAW_GRADE_POISON', evidenceRefs: ['ev'], claimIds: ['claim'] }],
    evidence: [{ id: 'ev', dataset: 'academic-requirement', entityId: 'RAW_NODE_ROOT_POISON' }],
    claims: academic.claims,
  }, catalog)
  assert.doesNotMatch(JSON.stringify(overview), /RAW_(?:NODE|BRANCH|COURSE|RULE|FAILURE|GRADE)/)
  assert.equal(overview.risks[0].entityId, projected.risks[0].entityId)
  assert.equal(overview.urgentItems[0].entityId, projected.risks[0].entityId)

  const collision = projectAdvisorOverview({
    snapshotRevision: REVISION, rulesVersion: RULES,
    academic: {
      ...academic,
      risks: [{ ...academic.risks[0], domain: 'grades', evidenceRefs: ['ev'], claimIds: ['claim'] }],
    },
    risks: [], evidence: [], claims: [],
    urgentItems: [
      { id: 'action-academic', kind: 'failed-course-known-requirement', domain: 'grades', entityId: 'RAW_GRADE_POISON', evidenceRefs: ['ev'], claimIds: ['claim'] },
      { id: 'action-assignment', kind: 'assignment', domain: 'assignments', entityId: 'RAW_GRADE_POISON', evidenceRefs: ['ev'], claimIds: ['claim'] },
    ],
  }, catalog)
  assert.match(collision.urgentItems[0].entityId, /^ar1:entity:/)
  assert.notEqual(collision.urgentItems[0].entityId, 'RAW_GRADE_POISON')
  assert.equal(collision.urgentItems[1].entityId, 'RAW_GRADE_POISON')
})

test('course-decision requirement matches use numeric paths and never guess unknown references', () => {
  const { academicProgress } = fixture()
  const catalog = catalogFor(academicProgress)
  const projected = projectRequirementMatches([
    { nodeId: 'RAW_BRANCH_A_POISON', nodePath: [0, 0], label: 'A', basis: 'official-link', confidence: 'high' },
    { nodeId: null, nodePath: null, label: 'Unknown', basis: 'unknown', confidence: 'low' },
  ], catalog)
  assert.match(projected[0].nodeId, /^ar1:requirement:[a-f0-9]{20}$/)
  assert.equal(projected[1].nodeId, null)
  assert.equal(Object.hasOwn(projected[0], 'nodePath'), false)
  assert.throws(() => projectRequirementMatches([{ nodeId: 'RAW_BRANCH_A_POISON', nodePath: [0, 'raw'] }], catalog), (error) => error.code === 'invalid-reference')
})
