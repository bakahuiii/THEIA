import test from 'node:test'
import assert from 'node:assert/strict'
import {
  advisorAcademicWhatIfFromStore,
  advisorCourseDecisionsFromStore,
  advisorOverviewFromStore,
} from '../electron/advisor-overview-service.mjs'
import { projectAdvisorEvidence } from '../electron/advisor-academic-references.mjs'
import { CURRENT_CAPTURE, domainOutcome, versionedState } from './fixtures/advisor-fixtures.mjs'

function storeOf(versioned) {
  return { snapshotWithRevision: () => versioned }
}

function requestFor(versioned, request) {
  return { snapshotRevision: versioned.revision, ...request }
}

const SERVICE_RAW_IDS = Object.freeze({
  node: 'RAW_SERVICE_NODE_POISON',
  course: 'RAW_SERVICE_COURSE_POISON',
  grade: 'RAW_SERVICE_GRADE_POISON',
  rule: 'RAW_SERVICE_RULE_POISON',
})
const PROVENANCE_POISON = Object.freeze({
  url: 'https://leak.invalid/provenance?token=SENTINEL_TOKEN&password=SENTINEL_PASSWORD',
  path: 'C:\\Users\\Sentinel\\AppData\\Local\\THEIA\\password.txt',
  sourceToken: 'token-SENTINEL-SOURCE-password',
  errorQuery: 'sync-failed?token=SENTINEL_QUERY_TOKEN&password=SENTINEL_QUERY_PASSWORD',
  runId: 'run-SENTINEL_RUN_TOKEN-password',
})

function academicServiceVersioned(revision = 'fixture-revision-1') {
  const versioned = versionedState({
    academicProgress: {
      program: 'Safe program',
      categories: [],
      roots: [{
        id: SERVICE_RAW_IDS.node,
        title: 'Core requirement',
        relation: 'and',
        required: 4,
        earned: 2,
        remaining: 2,
        courses: [{
          id: SERVICE_RAW_IDS.course,
          courseCode: 'SAFE100',
          title: 'Safe course',
        }],
        children: [],
      }],
    },
    grades: [{
      id: SERVICE_RAW_IDS.grade,
      courseCode: 'SAFE100',
      courseName: 'Safe course',
      credits: 2,
      score: '50',
      point: 0,
      requirementId: SERVICE_RAW_IDS.node,
    }],
    schedule: [],
    selectedCourses: [],
  }, {
    assignments: domainOutcome({ emptyConfirmed: true }),
    exams: domainOutcome({ emptyConfirmed: true }),
    grades: domainOutcome({ source: ['jwglxt'] }),
    'academic-progress': domainOutcome({ source: ['jwglxt'] }),
    schedule: domainOutcome({ emptyConfirmed: true }),
    'selected-courses': domainOutcome({ emptyConfirmed: true }),
  })
  return { ...versioned, revision }
}

function serviceUpgradeRule() {
  return {
    id: SERVICE_RAW_IDS.rule,
    rulesVersion: 'local-test-rule/v1',
    sourceKind: 'configuration',
    sourceLabel: 'Safe configured rule',
    thresholdCredits: 8,
    requirementIds: [SERVICE_RAW_IDS.node],
    source: PROVENANCE_POISON.url,
    parserVersion: PROVENANCE_POISON.path,
    errorCode: PROVENANCE_POISON.errorQuery,
    runId: PROVENANCE_POISON.runId,
  }
}

function serviceRequirementRef(overview) {
  return overview.academic.analysis.requirements.nodes.find((node) => node.title === 'Core requirement')?.id
}

function serviceCourseDecision(versioned) {
  return advisorCourseDecisionsFromStore(storeOf(versioned), requestFor(versioned, {
    candidates: [{ id: 'candidate-safe-100', title: 'Safe course', courseCode: 'SAFE100' }],
  }), { clock: () => CURRENT_CAPTURE })
}

test('advisor overview service never exposes raw academic node, course, grade, or rule IDs', () => {
  const versioned = academicServiceVersioned()
  const overview = advisorOverviewFromStore(storeOf(versioned), {
    clock: () => CURRENT_CAPTURE,
    upgradeRule: serviceUpgradeRule(),
  })
  const serialized = JSON.stringify(overview)

  for (const rawId of Object.values(SERVICE_RAW_IDS)) {
    assert.equal(serialized.includes(rawId), false, `raw academic ID leaked: ${rawId}`)
  }
  for (const poison of Object.values(PROVENANCE_POISON)) {
    assert.equal(serialized.includes(poison), false, `rule extension poison leaked: ${poison}`)
  }
  assert.match(serviceRequirementRef(overview), /^ar1:requirement:[a-f0-9]{20}$/)
  assert.match(overview.academic.analysis.upgrade.rule.id, /^ar1:entity:[a-f0-9]{20}$/)
  assert.equal(overview.academic.analysis.upgrade.rule.schema, 'theia-advisor-academic-rule/v1')
  assert.equal(overview.academic.analysis.upgrade.rule.sourceKind, 'configuration')
  assert.equal(overview.academic.analysis.upgrade.rule.sourceLabel, 'Safe configured rule')
  assert.match(overview.academic.analysis.failures[0].id, /^ar1:entity:[a-f0-9]{20}$/)
})

test('P3 requirement matches reuse the overview requirement reference for the same snapshot revision', () => {
  const versioned = academicServiceVersioned()
  const overview = advisorOverviewFromStore(storeOf(versioned), { clock: () => CURRENT_CAPTURE })
  const result = serviceCourseDecision(versioned)
  const match = result.decisions[0].requirementMatches[0]

  assert.equal(result.snapshotRevision, overview.snapshotRevision)
  assert.equal(match.basis, 'course-code')
  assert.equal(match.nodeId, serviceRequirementRef(overview))
})

test('public academic references change when the snapshot revision changes', () => {
  const firstVersioned = academicServiceVersioned('fixture-revision-1')
  const nextVersioned = academicServiceVersioned('fixture-revision-2')
  const firstOverview = advisorOverviewFromStore(storeOf(firstVersioned), { clock: () => CURRENT_CAPTURE })
  const nextOverview = advisorOverviewFromStore(storeOf(nextVersioned), { clock: () => CURRENT_CAPTURE })
  const firstMatch = serviceCourseDecision(firstVersioned).decisions[0].requirementMatches[0]
  const nextMatch = serviceCourseDecision(nextVersioned).decisions[0].requirementMatches[0]

  assert.notEqual(serviceRequirementRef(firstOverview), serviceRequirementRef(nextOverview))
  assert.notEqual(firstMatch.nodeId, nextMatch.nodeId)
  assert.equal(firstMatch.nodeId, serviceRequirementRef(firstOverview))
  assert.equal(nextMatch.nodeId, serviceRequirementRef(nextOverview))
})

test('advisor public DTOs allowlist provenance without breaking safe data-quality signals', () => {
  const poisonedOutcome = domainOutcome({
    source: ['jwglxt', PROVENANCE_POISON.url, PROVENANCE_POISON.path, PROVENANCE_POISON.sourceToken],
    parserVersion: PROVENANCE_POISON.path,
    errorCode: PROVENANCE_POISON.errorQuery,
    runId: PROVENANCE_POISON.runId,
    succeeded: false,
    status: 'failed',
    retainedPrevious: true,
  })
  const versioned = versionedState({
    academicProgress: {
      source: PROVENANCE_POISON.sourceToken,
      requirementSource: PROVENANCE_POISON.url,
      categories: [],
      roots: [{
        id: 'safe-provenance-root', title: 'Safe requirement', relation: 'and',
        required: 4, earned: 2, remaining: 2, children: [],
      }],
    },
    grades: [], schedule: [], selectedCourses: [], assignments: [], exams: [],
  }, {
    'academic-progress': poisonedOutcome,
    grades: poisonedOutcome,
    schedule: poisonedOutcome,
    'selected-courses': poisonedOutcome,
    assignments: poisonedOutcome,
    exams: poisonedOutcome,
  })
  const overview = advisorOverviewFromStore(storeOf(versioned), { clock: () => CURRENT_CAPTURE })
  const whatIf = advisorAcademicWhatIfFromStore(storeOf(versioned), requestFor(versioned, {
    additionalRequiredCredits: 1,
  }), { clock: () => CURRENT_CAPTURE })
  const courseDecision = advisorCourseDecisionsFromStore(storeOf(versioned), requestFor(versioned, {
    candidates: [{ id: 'safe-provenance-candidate', title: 'Safe candidate', courseCode: 'SAFE100' }],
  }), { clock: () => CURRENT_CAPTURE })

  for (const result of [overview, whatIf, courseDecision]) {
    const serialized = JSON.stringify(result)
    for (const poison of Object.values(PROVENANCE_POISON)) {
      assert.equal(serialized.includes(poison), false, `provenance poison leaked: ${poison}`)
    }
  }

  const topLevel = overview.dataQuality.domains['academic-progress']
  const nested = overview.academic.analysis.requirements.dataQuality
  const scenarioNested = whatIf.analysis.requirements.dataQuality
  for (const quality of [topLevel, nested, scenarioNested]) {
    assert.deepEqual(quality.source, ['jwglxt'])
    assert.equal(quality.availability, 'available')
    assert.equal(quality.freshness, 'fresh')
    assert.equal(quality.completeness, 'complete')
    assert.equal(quality.capturedAt, CURRENT_CAPTURE)
    assert.equal(quality.sourceSucceededAt, CURRENT_CAPTURE)
    assert.equal(quality.lastAttempt.status, 'failed')
    assert.equal(quality.lastAttempt.retainedPrevious, true)
    assert.equal(quality.parserVersion, null)
    assert.equal(quality.lastAttempt.errorCode, null)
    assert.equal(quality.lastAttempt.runId, null)
  }
  assert.equal(overview.academic.analysis.requirements.source, 'roots')
  assert.equal(overview.academic.analysis.requirements.requirementSource, null)
  assert.equal(overview.academic.analysis.requirements.requirementSourceKind, 'unknown-tree')
  assert.equal(whatIf.analysis.requirements.source, 'roots')
  assert.equal(whatIf.analysis.requirements.requirementSource, null)
  assert.equal(whatIf.analysis.requirements.requirementSourceKind, 'unknown-tree')
  assert.equal(overview.evidence.every((entry) => entry.source === null || entry.source === 'jwglxt'), true)
  // Course decisions no longer carry evidence (credit-gap based recommendation).
})

test('public evidence projection rejects extension-field passthrough and preserves its fixed renderer contract', () => {
  const projected = projectAdvisorEvidence({
    id: 'ev1:fixture:0123456789abcdef:0123456789ab',
    dataset: 'fixture',
    domain: 'grades',
    entityId: 'entity:0123456789abcdef',
    fields: ['score', 'courseName'],
    capturedAt: CURRENT_CAPTURE,
    source: 'jwglxt',
    snapshotRevision: 'fixture-revision-1',
    domainDigest: 'a'.repeat(64),
    evidenceDigest: 'b'.repeat(64),
    availability: 'available',
    freshness: 'fresh',
    completeness: 'complete',
    label: 'Safe evidence',
    disclosedFields: ['score'],
    parserVersion: PROVENANCE_POISON.path,
    errorCode: PROVENANCE_POISON.errorQuery,
    runId: PROVENANCE_POISON.runId,
    sourceUrl: PROVENANCE_POISON.url,
    arbitraryExtension: PROVENANCE_POISON.sourceToken,
  })

  assert.deepEqual(Object.keys(projected).sort(), [
    'availability', 'capturedAt', 'completeness', 'dataset', 'disclosedFields',
    'domain', 'domainDigest', 'entityId', 'evidenceDigest', 'fields', 'freshness',
    'id', 'label', 'snapshotRevision', 'source',
  ].sort())
  for (const poison of Object.values(PROVENANCE_POISON)) {
    assert.equal(JSON.stringify(projected).includes(poison), false)
  }
  assert.equal(projected.source, 'jwglxt')
  assert.deepEqual(projected.fields, ['courseName', 'score'])
  assert.deepEqual(projected.disclosedFields, ['score'])
})

test('academic what-if uses one frozen revision and never writes the store', () => {
  let reads = 0
  const versioned = versionedState({
    academicProgress: {
      categories: [],
      roots: [{ id: 'root', title: '培养方案', required: 10, earned: 6, remaining: 4, relation: 'and', children: [] }],
    },
  }, {
    'academic-progress': domainOutcome(),
    grades: domainOutcome({ emptyConfirmed: true }),
  })
  const store = { snapshotWithRevision() { reads += 1; return versioned } }
  const result = advisorAcademicWhatIfFromStore(store, requestFor(versioned, { additionalRequiredCredits: 2 }), {
    clock: () => CURRENT_CAPTURE,
  })
  assert.equal(reads, 1)
  assert.equal(result.snapshotRevision, versioned.revision)
  assert.equal(result.analysis.scenario.scenario, true)
  assert.equal(result.analysis.scenario.remaining, '2.0000')
  assert.equal(versioned.state.academicProgress.roots[0].remaining, 4)
})

test('academic what-if rejects stale and forged opaque selections before evaluation', () => {
  const versioned = versionedState({
    academicProgress: {
      categories: [],
      roots: [{
        id: 'root', title: '培养方案', relation: 'and', children: [
          { id: 'branch-a', title: '方向 A', relation: 'or', required: 4, earned: 1, remaining: 3, children: [] },
          { id: 'branch-b', title: '方向 B', relation: 'or', required: 4, earned: 2, remaining: 2, children: [] },
        ],
      }],
    },
  }, {
    'academic-progress': domainOutcome(),
    grades: domainOutcome({ emptyConfirmed: true }),
  })
  assert.throws(() => advisorAcademicWhatIfFromStore(storeOf(versioned), {
    snapshotRevision: 'stale-revision',
    additionalRequiredCredits: 1,
  }), (error) => error?.code === 'stale-snapshot')
  assert.throws(() => advisorAcademicWhatIfFromStore(storeOf(versioned), {
    snapshotRevision: versioned.revision,
    alternativeSelections: {
      'ar1:requirement:00000000000000000000': 'ar1:requirement:11111111111111111111',
    },
  }), (error) => error?.code === 'invalid-reference')
})

test('course decisions reject a missing or stale expected snapshot revision', () => {
  const versioned = versionedState()
  assert.throws(() => advisorCourseDecisionsFromStore(storeOf(versioned), { candidates: [] }), (error) => error?.code === 'stale-snapshot')
  assert.throws(() => advisorCourseDecisionsFromStore(storeOf(versioned), {
    snapshotRevision: 'stale-revision',
    candidates: [],
  }), (error) => error?.code === 'stale-snapshot')
})

test('course decision service strips executable fields and cannot trigger network', () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => { throw new Error('course decision attempted network I/O') }
  try {
    const versioned = versionedState({
      academicProgress: { categories: [], roots: [] },
      schedule: [],
      grades: [],
      selectedCourses: [],
    })
    const result = advisorCourseDecisionsFromStore(storeOf(versioned), requestFor(versioned, {
      candidates: [{
        id: 'candidate-1', title: '课程', courseCode: 'ABC100',
        sourceUrl: 'https://example.com/select', operationId: 'submit-secret',
      }],
      schoolScheduleComplete: false,
    }), {
      clock: () => CURRENT_CAPTURE,
    })
    assert.equal(result.snapshotRevision, versioned.revision)
    assert.equal(result.decisions[0].scheduleStatus, 'unknown')
    assert.equal(result.decisions[0].reasons.length > 0, true)
    assert.equal(Object.hasOwn(result.decisions[0], 'evidenceRefs'), false)
    assert.equal(Object.hasOwn(result, 'evidence'), false)
    assert.equal(result.proposals.every((proposal) => ['save-target', 'view-details', 'open-confirmation'].includes(proposal.kind)), true)
    assert.doesNotMatch(JSON.stringify(result), /example\.com|submit-secret/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('course decision output stays revision-bound and identifies duplicates without evidence', () => {
  const versioned = versionedState({
    academicProgress: {
      categories: [],
      roots: [{
        id: 'requirement-1', title: '专业选修', children: [],
        courses: [{ id: 'planned-1', courseCode: 'ABC100', title: '课程', studyStatus: '未修' }],
      }],
    },
    schedule: [],
    grades: [],
    selectedCourses: [{ id: 'selected-1', courseCode: 'ABC100', title: '课程', termId: '2026-3' }],
  }, {
    'academic-progress': domainOutcome(),
    schedule: domainOutcome({ emptyConfirmed: true }),
    grades: domainOutcome({ emptyConfirmed: true }),
    'selected-courses': domainOutcome(),
  })
  const result = advisorCourseDecisionsFromStore(storeOf(versioned), requestFor(versioned, {
    candidates: [{ id: 'candidate-1', title: '课程', courseCode: 'ABC100' }],
    schoolScheduleComplete: true,
  }), {
    clock: () => CURRENT_CAPTURE,
  })
  const decision = result.decisions[0]

  assert.equal(result.snapshotRevision, versioned.revision)
  assert.equal(decision.duplicateStatus, 'currently-selected')
  assert.equal(decision.reasons.length > 0, true)
  assert.equal(Object.hasOwn(decision, 'evidenceRefs'), false)
  assert.equal(Object.hasOwn(result, 'evidence'), false)
  assert.equal(decision.duplicateMatches.some((match) => match.existingId.split(':')[1] === 'selected-courses'), true)
})

test('course decision service exposes only opaque schedule and duplicate record references', () => {
  const rawIds = [
    'raw-plan-course-id',
    'raw-grade-id',
    'raw-selected-course-id',
    'raw-schedule-id',
  ]
  const versioned = versionedState({
    academicProgress: {
      categories: [],
      roots: [{
        id: 'requirement-1',
        title: '专业选修',
        children: [],
        courses: [{
          id: rawIds[0],
          courseCode: 'ABC100',
          title: '候选课程',
          studyStatus: '已修',
        }],
      }],
    },
    schedule: [{
      id: rawIds[3],
      courseCode: 'ABC100',
      title: '候选课程',
      termId: '2026-3',
      weekday: 1,
      period: '1-2',
      weeks: '1-16周',
    }],
    grades: [{
      id: rawIds[1],
      courseCode: 'ABC100',
      courseName: '候选课程',
      score: '88',
      point: 3.8,
    }],
    selectedCourses: [{
      id: rawIds[2],
      courseCode: 'ABC100',
      title: '候选课程',
      termId: '2026-3',
    }],
  }, {
    'academic-progress': domainOutcome(),
    schedule: domainOutcome(),
    grades: domainOutcome(),
    'selected-courses': domainOutcome(),
  })
  const request = {
    snapshotRevision: versioned.revision,
    candidates: [{
      id: 'candidate-1',
      title: '候选课程',
      courseCode: 'ABC100',
      termId: '2026-3',
      weekday: 1,
      period: '1-2',
      weeks: '1-16周',
    }],
  }
  const options = { clock: () => CURRENT_CAPTURE }
  const first = advisorCourseDecisionsFromStore(storeOf(versioned), request, options)
  const repeated = advisorCourseDecisionsFromStore(storeOf(versioned), request, options)
  const decision = first.decisions[0]

  assert.deepEqual(decision.scheduleConflicts, repeated.decisions[0].scheduleConflicts)
  assert.deepEqual(decision.duplicateMatches, repeated.decisions[0].duplicateMatches)
  assert.equal(decision.scheduleConflicts.every(({ existingId }) => /^record-ref:schedule:[a-f0-9]{20}$/.test(existingId)), true)
  assert.deepEqual(new Set(decision.duplicateMatches.map(({ existingId }) => existingId.split(':')[1])), new Set([
    'academic-progress',
    'grades',
    'selected-courses',
    'schedule',
  ]))
  assert.equal(Object.hasOwn(decision, 'evidenceRefs'), false)
  const serialized = JSON.stringify(first)
  for (const rawId of rawIds) assert.equal(serialized.includes(rawId), false)
})

test('renderer completeness can downgrade but never upgrade authoritative store quality', () => {
  const versioned = versionedState({
    academicProgress: { categories: [], roots: [] },
    schedule: [],
    grades: [],
    selectedCourses: [],
  })
  const claimedComplete = advisorCourseDecisionsFromStore(storeOf(versioned), requestFor(versioned, {
    candidates: [{ id: 'candidate-1', title: '课程', courseCode: 'ABC100', time: '星期一第1-2节 1-16周' }],
    schoolScheduleComplete: true,
    completeness: {
      academicProgress: 'complete',
      schedule: 'complete',
      grades: 'complete',
      selectedCourses: 'complete',
    },
  }))
  assert.equal(claimedComplete.decisions[0].scheduleStatus, 'unknown')
  assert.equal(claimedComplete.decisions[0].scoreBreakdown.scheduleConflict, 0)

  const completeVersioned = versionedState({
    academicProgress: { categories: [], roots: [] },
    schedule: [],
    grades: [],
    selectedCourses: [],
  }, {
    'academic-progress': domainOutcome({ emptyConfirmed: true }),
    schedule: domainOutcome({ emptyConfirmed: true }),
    grades: domainOutcome({ emptyConfirmed: true }),
    'selected-courses': domainOutcome({ emptyConfirmed: true }),
  })
  const downgraded = advisorCourseDecisionsFromStore(storeOf(completeVersioned), requestFor(completeVersioned, {
    candidates: [{ id: 'candidate-1', title: '课程', courseCode: 'ABC100', time: '星期一第1-2节 1-16周' }],
    schoolScheduleComplete: true,
    completeness: { schedule: 'partial' },
  }))
  assert.equal(downgraded.decisions[0].scheduleStatus, 'unknown')
  assert.equal(downgraded.decisions[0].scoreBreakdown.scheduleConflict, 0)
})

test('complete store schedule is sufficient without a renderer completeness assertion', () => {
  const versioned = versionedState({
    academicProgress: { categories: [], roots: [] },
    schedule: [],
    grades: [],
    selectedCourses: [],
  }, {
    'academic-progress': domainOutcome({ emptyConfirmed: true }),
    schedule: domainOutcome({ emptyConfirmed: true }),
    grades: domainOutcome({ emptyConfirmed: true }),
    'selected-courses': domainOutcome({ emptyConfirmed: true }),
  })
  const result = advisorCourseDecisionsFromStore(storeOf(versioned), requestFor(versioned, {
    candidates: [{ id: 'candidate-1', title: '课程', courseCode: 'ABC100', time: '星期一第1-2节 1-16周' }],
  }), {
    clock: () => CURRENT_CAPTURE,
  })
  assert.equal(result.decisions[0].scheduleStatus, 'clear')
})

test('course decision quality is evaluated with the injected clock', () => {
  const versioned = versionedState({
    academicProgress: { categories: [], roots: [] },
    schedule: [],
    grades: [],
    selectedCourses: [],
  }, {
    'academic-progress': domainOutcome({ emptyConfirmed: true }),
    schedule: domainOutcome({ emptyConfirmed: true }),
    grades: domainOutcome({ emptyConfirmed: true }),
    'selected-courses': domainOutcome({ emptyConfirmed: true }),
  })
  const request = {
    snapshotRevision: versioned.revision,
    candidates: [{ id: 'candidate-1', title: '课程', courseCode: 'ABC100', time: '星期一第1-2节 1-16周' }],
  }
  const fresh = advisorCourseDecisionsFromStore(storeOf(versioned), request, {
    clock: () => CURRENT_CAPTURE,
  })
  const stale = advisorCourseDecisionsFromStore(storeOf(versioned), request, {
    clock: () => '2026-08-20T00:00:00.000Z',
  })

  assert.equal(fresh.decisions[0].scheduleStatus, 'clear')
  assert.equal(stale.decisions[0].scheduleStatus, 'unknown')
  assert.equal(stale.decisions[0].scoreBreakdown.scheduleConflict, 0)
})

for (const [label, scheduleOutcome] of [
  ['stale', domainOutcome({ capturedAt: '2026-08-10T00:00:00.000Z', sourceSucceededAt: '2026-08-10T00:00:00.000Z' })],
  ['failed retained', domainOutcome({
    succeeded: false,
    status: 'failed',
    retainedPrevious: true,
    capturedAt: CURRENT_CAPTURE,
    sourceSucceededAt: CURRENT_CAPTURE,
    errorCode: 'source-timeout',
  })],
  ['authentication required', domainOutcome({
    succeeded: false,
    status: 'auth-required',
    retainedPrevious: true,
    capturedAt: CURRENT_CAPTURE,
    sourceSucceededAt: CURRENT_CAPTURE,
    errorCode: 'login-required',
  })],
  ['not attempted', domainOutcome({ attempted: false, succeeded: false, status: 'not-attempted' })],
]) {
  test(`${label} schedule cannot prove that a candidate is conflict-free`, () => {
    const versioned = versionedState({
      academicProgress: { categories: [], roots: [] },
      schedule: [],
      grades: [],
      selectedCourses: [],
    }, {
      'academic-progress': domainOutcome({ emptyConfirmed: true }),
      schedule: scheduleOutcome,
      grades: domainOutcome({ emptyConfirmed: true }),
      'selected-courses': domainOutcome({ emptyConfirmed: true }),
    })
    const result = advisorCourseDecisionsFromStore(storeOf(versioned), requestFor(versioned, {
      candidates: [{ id: 'candidate-1', title: '课程', courseCode: 'ABC100', time: '星期一第1-2节 1-16周' }],
    }), {
      clock: () => CURRENT_CAPTURE,
    })

    assert.equal(result.decisions[0].scheduleStatus, 'unknown')
    assert.equal(result.decisions[0].scoreBreakdown.scheduleConflict, 0)
  })
}

test('stale or retained selected-course records cannot assert a current duplicate', () => {
  for (const selectedOutcome of [
    domainOutcome({ capturedAt: '2026-08-10T00:00:00.000Z', sourceSucceededAt: '2026-08-10T00:00:00.000Z' }),
    domainOutcome({
      succeeded: false,
      status: 'failed',
      retainedPrevious: true,
      capturedAt: CURRENT_CAPTURE,
      sourceSucceededAt: CURRENT_CAPTURE,
      errorCode: 'source-timeout',
    }),
  ]) {
    const versioned = versionedState({
      academicProgress: { categories: [], roots: [] },
      schedule: [],
      grades: [],
      selectedCourses: [{ id: 'selected-1', courseCode: 'ABC100', title: '课程' }],
    }, {
      'academic-progress': domainOutcome({ emptyConfirmed: true }),
      schedule: domainOutcome({ emptyConfirmed: true }),
      grades: domainOutcome({ emptyConfirmed: true }),
      'selected-courses': selectedOutcome,
    })
    const result = advisorCourseDecisionsFromStore(storeOf(versioned), requestFor(versioned, {
      candidates: [{ id: 'candidate-1', title: '课程', courseCode: 'ABC100', time: '星期一第1-2节 1-16周' }],
    }), {
      clock: () => CURRENT_CAPTURE,
    })

    assert.equal(result.decisions[0].duplicateStatus, 'unknown')
    assert.equal(result.decisions[0].duplicateMatches.some((entry) => entry.existingId === 'selected-1'), false)
  }
})

test('course decision is deterministic and ignores executable-only fields', () => {
  const versioned = versionedState({
    academicProgress: {
      categories: [],
      roots: [{
        id: 'requirement-1',
        title: '专业选修',
        relation: 'and',
        required: 8,
        earned: 0,
        remaining: 8,
        children: [],
        courses: [{ id: 'planned-1', courseCode: 'ABC100', title: '课程', studyStatus: '未修' }],
      }],
    },
  }, {
    'academic-progress': domainOutcome(),
    schedule: domainOutcome({ emptyConfirmed: true }),
    grades: domainOutcome({ emptyConfirmed: true }),
    'selected-courses': domainOutcome({ emptyConfirmed: true }),
  })
  const baseRequest = {
    snapshotRevision: versioned.revision,
    candidates: [{
      id: 'candidate-1',
      title: '课程',
      courseCode: 'ABC100',
      sessions: [{ weekday: 1, periods: [1, 2], weeks: [1, 2] }],
      requirementNodeIds: ['requirement-1'],
      sourceUrl: 'https://example.com/first',
      operationId: 'secret-one',
    }],
  }
  const options = { clock: () => CURRENT_CAPTURE }
  const first = advisorCourseDecisionsFromStore(storeOf(versioned), baseRequest, options)
  const executableOnlyChange = advisorCourseDecisionsFromStore(storeOf(versioned), {
    snapshotRevision: versioned.revision,
    candidates: [{
      ...baseRequest.candidates[0],
      sourceUrl: 'https://example.com/second',
      operationId: 'secret-two',
      sessions: [{
        ...baseRequest.candidates[0].sessions[0],
        sourceUrl: 'https://nested.example/secret',
        operationId: 'nested-operation-secret',
        token: 'nested-token-secret',
      }],
      requirementNodeIds: ['requirement-1', { token: 'array-token-secret' }],
    }],
  }, options)
  const safeFactChange = advisorCourseDecisionsFromStore(storeOf(versioned), {
    snapshotRevision: versioned.revision,
    candidates: [{ ...baseRequest.candidates[0], credits: 3 }],
  }, options)

  // Executable-only fields (sourceUrl, operationId, token) are stripped by the
  // candidateRecord projection and do not change the decision outcome.
  assert.deepEqual(first.decisions[0], executableOnlyChange.decisions[0])
  // A change in a meaningful candidate field (credits) does change the score.
  assert.notDeepEqual(first.decisions[0].scoreBreakdown, safeFactChange.decisions[0].scoreBreakdown)
  assert.doesNotMatch(JSON.stringify(first), /example\.com|secret-one/)
  assert.doesNotMatch(JSON.stringify(executableOnlyChange), /nested\.example|nested-operation-secret|nested-token-secret|array-token-secret/)
})
