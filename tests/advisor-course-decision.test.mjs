import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  COURSE_DECISION_PROPOSAL_KINDS,
  COURSE_DECISION_SCORE_FORMULA_VERSION,
  createCourseDecisions,
} from '../core/advisor/course-decision-engine.mjs'

const REQUIREMENT = Object.freeze({
  id: 'requirement:professional-elective',
  title: '专业选修',
  required: 8,
  remaining: 8,
  relation: 'and',
  courses: [
    { id: 'plan:mat-101', courseCode: 'MAT101', title: '材料导论', credits: 2, studyStatus: '未修', category: '专业选修' },
    { id: 'plan:mat-201', courseCode: 'MAT201', title: '高分子物理', credits: 3, studyStatus: '未修', category: '专业选修' },
  ],
  children: [],
})

const ACADEMIC_PROGRESS = Object.freeze({
  categories: [],
  roots: [REQUIREMENT],
})

function candidate(overrides = {}) {
  return {
    id: 'candidate:mat-101:a',
    courseId: 'MAT101',
    courseCode: 'MAT101',
    operationId: 'class-a',
    title: '材料导论',
    credits: 2,
    categoryCode: 'ZX',
    blockId: 'professional-elective',
    blockTitle: '专业选修',
    termId: '2026-3',
    time: '星期一第1-2节 1-16周',
    sourceUrl: 'https://jwglxt.buct.edu.cn/private?token=secret',
    ...overrides,
  }
}

function schedule(overrides = {}) {
  return {
    id: 'schedule:existing',
    courseId: 'EXISTING',
    title: '已有课程',
    termId: '2026-3',
    weekday: 2,
    period: '3-4',
    weeks: '1-16周',
    ...overrides,
  }
}

function completeInput(overrides = {}) {
  return {
    candidates: [candidate()],
    academicProgress: ACADEMIC_PROGRESS,
    schedule: [schedule()],
    grades: [],
    selectedCourses: [],
    schoolScheduleComplete: true,
    completeness: {
      academicProgress: 'complete',
      schedule: 'complete',
      grades: 'complete',
      selectedCourses: 'complete',
    },
    ...overrides,
  }
}

function one(input = completeInput(), options) {
  return createCourseDecisions(input, options).decisions[0]
}

test('requirement matching preserves official-link, course-code, category, name-match, and unknown confidence', () => {
  const cases = [
    {
      value: candidate({ id: 'official', requirementNodeId: REQUIREMENT.id, courseCode: 'OTHER', courseId: 'OTHER', title: '其他课程', blockTitle: '其他' }),
      basis: 'official-link',
      confidence: 'high',
    },
    { value: candidate({ id: 'code', title: '名称可变化' }), basis: 'course-code', confidence: 'high' },
    { value: candidate({ id: 'category', courseCode: 'OTHER', courseId: 'OTHER', title: '其他课程' }), basis: 'category', confidence: 'medium' },
    { value: candidate({ id: 'name', courseCode: 'OTHER', courseId: 'OTHER', blockTitle: '其他', categoryCode: 'OTHER' }), basis: 'name-match', confidence: 'low' },
    { value: candidate({ id: 'unknown', courseCode: 'OTHER', courseId: 'OTHER', title: '完全未知', blockTitle: '其他', categoryCode: 'OTHER' }), basis: 'unknown', confidence: 'low' },
  ]
  const result = createCourseDecisions(completeInput({ candidates: cases.map((entry) => entry.value) }))
  const byId = new Map(result.decisions.map((decision) => [decision.candidateId, decision]))
  for (const entry of cases) {
    assert.equal(byId.get(entry.value.id).requirementMatches[0].basis, entry.basis)
    assert.equal(byId.get(entry.value.id).requirementMatches[0].confidence, entry.confidence)
  }
})

test('user-visible reasons localize match basis and confidence without changing contract enums', () => {
  const decision = one()
  assert.equal(decision.requirementMatches[0].basis, 'course-code')
  assert.equal(decision.requirementMatches[0].confidence, 'high')
  assert.equal(decision.reasons.includes('培养方案匹配依据为课程号匹配，置信度为高。'), true)
  assert.equal(decision.reasons.some((reason) => /course-code|\bhigh\b/.test(reason)), false)
})

for (const [index, mutation] of [
  (input) => { input.schoolScheduleComplete = false },
  (input) => { delete input.schoolScheduleComplete },
  (input) => { input.completeness.schedule = 'partial' },
  (input) => { input.completeness.schedule = 'unknown' },
  (input) => { delete input.schedule },
].entries()) {
  test(`incomplete schedule case ${index + 1} stays unknown and receives no clear-schedule score`, () => {
    const input = structuredClone(completeInput({ schedule: [] }))
    mutation(input)
    const decision = one(input)
    assert.equal(decision.scheduleStatus, 'unknown')
    assert.equal(decision.scoreBreakdown.scheduleConflict, 0)
    assert.equal(decision.reasons.some((reason) => /不能声称.*没有时间冲突|周次\/节次不足/.test(reason)), true)
  })
}

for (const [index, fixture] of [
  { candidateTime: '星期一第1-2节 1-16周', existing: { weekday: 1, period: '2-3', weeks: '1-16周' } },
  { candidateTime: '周二 3-4 1-8周', existing: { weekday: 2, period: '3-4', weeks: '5-12周' } },
  { candidateTime: 'Mon 5-6 1-16周', existing: { weekday: 1, period: '6-7', weeks: '2-4周' } },
  { candidateTime: '星期五第9节 2,4,6周', existing: { weekday: 5, period: '9', weeks: '4周' } },
  { candidateTime: '星期三第7-8节 1-16周', existing: { weekday: 3, period: '8', weeks: '16周' } },
].entries()) {
  test(`confirmed schedule conflict case ${index + 1} reports an existing course`, () => {
    const decision = one(completeInput({
      candidates: [candidate({ id: `conflict:${index}`, time: fixture.candidateTime })],
      schedule: [schedule({ id: `existing:${index}`, ...fixture.existing })],
    }))
    assert.equal(decision.scheduleStatus, 'conflict')
    assert.equal(decision.scheduleConflicts.length, 1)
    assert.match(decision.scheduleConflicts[0].existingId, /^record-ref:schedule:[a-f0-9]{20}$/)
    assert.notEqual(decision.scheduleConflicts[0].existingId, `existing:${index}`)
    assert.equal(decision.scoreBreakdown.scheduleConflict, 0)
  })
}

test('unknown weeks never become a confirmed conflict or a clear schedule', () => {
  const decision = one(completeInput({
    candidates: [candidate({ time: '星期一第1-2节' })],
    schedule: [schedule({ weekday: 1, period: '1-2', weeks: '1-16周' })],
  }))
  assert.equal(decision.scheduleStatus, 'unknown')
  assert.deepEqual(decision.scheduleConflicts, [])
  assert.equal(decision.scoreBreakdown.scheduleConflict, 0)
})

for (const [index, changes] of [
  { grades: [{ id: 'grade:passed', courseCode: 'MAT101', courseName: '材料导论', score: '88', point: 3.8 }] },
  { grades: [{ id: 'grade:text-pass', courseCode: 'MAT101', courseName: '材料导论', score: '优秀' }] },
  { selectedCourses: [{ id: 'selected:mat', courseCode: 'MAT101', title: '材料导论' }] },
  { schedule: [schedule({ id: 'schedule:same', courseId: 'MAT101', title: '材料导论' })] },
  { academicProgress: { categories: [], roots: [{ ...REQUIREMENT, courses: [{ ...REQUIREMENT.courses[0], studyStatus: '已修' }] }] } },
].entries()) {
  test(`duplicate or completed course case ${index + 1} is excluded from ordinary ranking`, () => {
    const decision = one(completeInput(changes))
    assert.equal(['already-completed', 'currently-selected'].includes(decision.duplicateStatus), true)
    assert.equal(decision.score, null)
    assert.equal(decision.duplicateMatches.length > 0, true)
  })
}

for (let index = 0; index < 5; index += 1) {
  test(`low-confidence name match case ${index + 1} never upgrades to medium or high`, () => {
    const title = `名称匹配课程 ${index + 1}`
    const academicProgress = {
      categories: [],
      roots: [{
        id: `requirement:name:${index}`,
        title: '其他培养节点',
        required: 2,
        children: [],
        courses: [{ id: `plan:name:${index}`, courseCode: null, title, studyStatus: '未修' }],
      }],
    }
    const decision = one(completeInput({
      candidates: [candidate({ id: `name:${index}`, courseCode: `UNLISTED-${index}`, courseId: `UNLISTED-${index}`, title, blockTitle: '其他', categoryCode: 'OTHER' })],
      academicProgress,
    }))
    assert.equal(decision.requirementMatches[0].basis, 'name-match')
    assert.equal(decision.requirementMatches[0].confidence, 'low')
    assert.equal(decision.scoreBreakdown.requirementMatch, 12)
  })
}

test('historical summary counts attempts and averages only numeric points', () => {
  const decision = one(completeInput({
    grades: [
      { id: 'grade:one', courseCode: 'MAT101', courseName: '材料导论', score: '55', point: 1.5 },
      { id: 'grade:two', courseCode: 'MAT101', courseName: '材料导论', score: '缺考', point: null },
      { id: 'grade:three', courseCode: 'MAT101', courseName: '材料导论', score: '58', point: 2.25 },
      { id: 'grade:other', courseCode: 'OTHER', courseName: '其他课程', score: '90', point: 4 },
    ],
  }))
  assert.deepEqual(decision.historicalSummary, {
    attempts: 3,
    numericCount: 2,
    meanPoint: 1.88,
    note: '发现 3 次历史成绩记录，其中 2 次含数值绩点，平均绩点 1.88。',
  })
  assert.equal(decision.duplicateStatus, 'previous-attempt')
})

for (const score of ['不合格', '缺考']) {
  test(`${score} remains a previous attempt even when a contradictory positive point is present`, () => {
    const decision = one(completeInput({
      grades: [{
        id: `grade:failed:${score}`,
        courseCode: 'MAT101',
        courseName: '材料导论',
        score,
        point: 3.5,
      }],
    }))
    assert.equal(decision.duplicateStatus, 'previous-attempt')
    assert.notEqual(decision.score, null)
    assert.equal(decision.reasons.includes('该课程存在历史修读记录，尚未确认已通过。'), true)
  })
}

test('stable score and ordering are independent of candidate input order', () => {
  const candidates = [
    candidate({ id: 'candidate:z', courseCode: 'OTHER-Z', courseId: 'OTHER-Z', title: '未知 Z', blockTitle: '其他', categoryCode: 'OTHER' }),
    candidate({ id: 'candidate:a', credits: 5 }),
    candidate({ id: 'candidate:b', courseCode: 'MAT201', courseId: 'MAT201', title: '高分子物理', credits: 3 }),
  ]
  const input = completeInput({ candidates })
  const first = createCourseDecisions(input)
  const second = createCourseDecisions({ ...input, candidates: [...candidates].reverse() })
  assert.deepEqual(first, second)
  assert.deepEqual(first.decisions.map((decision) => decision.candidateId), [
    'candidate:a',
    'candidate:b',
    'candidate:z',
  ])
  assert.equal(first.decisions[0].scoreBreakdown.formulaVersion, COURSE_DECISION_SCORE_FORMULA_VERSION)
})

test('public record references hide raw entity ids and remain stable across source ordering', () => {
  const rawIds = [
    'private-plan-id',
    'private-grade-id',
    'private-selected-id',
    'private-schedule-b',
    'private-schedule-a',
  ]
  const input = completeInput({
    academicProgress: {
      categories: [],
      roots: [{
        ...REQUIREMENT,
        courses: [{
          ...REQUIREMENT.courses[0],
          id: rawIds[0],
          studyStatus: '已修',
        }],
      }],
    },
    grades: [{
      id: rawIds[1],
      courseCode: 'MAT101',
      courseName: '材料导论',
      score: '88',
      point: 3.8,
    }],
    selectedCourses: [{
      id: rawIds[2],
      courseCode: 'MAT101',
      title: '材料导论',
      termId: '2026-3',
    }],
    schedule: [
      schedule({ id: rawIds[3], courseId: 'MAT101', weekday: 1, period: '2-3' }),
      schedule({ id: rawIds[4], courseId: 'MAT101', weekday: 1, period: '1-2' }),
    ],
  })
  const first = one(input)
  const repeated = one(input)
  const reordered = one({
    ...input,
    schedule: [...input.schedule].reverse(),
    grades: [...input.grades].reverse(),
    selectedCourses: [...input.selectedCourses].reverse(),
  })

  assert.deepEqual(first.scheduleConflicts, repeated.scheduleConflicts)
  assert.deepEqual(first.duplicateMatches, repeated.duplicateMatches)
  assert.deepEqual(first.scheduleConflicts, reordered.scheduleConflicts)
  assert.deepEqual(first.duplicateMatches, reordered.duplicateMatches)
  assert.equal(first.scheduleConflicts.length, 2)
  assert.equal(first.scheduleConflicts.every(({ existingId }) => /^record-ref:schedule:[a-f0-9]{20}$/.test(existingId)), true)
  assert.deepEqual(new Set(first.duplicateMatches.map(({ existingId }) => existingId.split(':')[1])), new Set([
    'academic-progress',
    'grades',
    'selected-courses',
    'schedule',
  ]))
  for (const rawId of rawIds) assert.equal(JSON.stringify(first).includes(rawId), false)
})

test('public record references are bound to the course-decision rules version', () => {
  const input = completeInput({
    candidates: [candidate({ time: '星期二第3-4节 1-16周' })],
    schedule: [schedule({ id: 'private-schedule-id' })],
  })
  const first = one(input, { rulesVersion: 'rules:test-a' })
  const repeated = one(input, { rulesVersion: 'rules:test-a' })
  const changedRules = one(input, { rulesVersion: 'rules:test-b' })

  assert.equal(first.scheduleConflicts[0].existingId, repeated.scheduleConflicts[0].existingId)
  assert.notEqual(first.scheduleConflicts[0].existingId, changedRules.scheduleConflicts[0].existingId)
  assert.equal(JSON.stringify(first).includes('private-schedule-id'), false)
})

test('tie-break uses canonical candidate id and stable ids do not include evaluation time', () => {
  const candidates = [
    candidate({ id: 'candidate:b' }),
    candidate({ id: 'candidate:a' }),
  ]
  const result = createCourseDecisions(completeInput({ candidates }))
  assert.deepEqual(result.decisions.map((decision) => decision.candidateId), ['candidate:a', 'candidate:b'])
  const repeated = createCourseDecisions(completeInput({ candidates }))
  assert.deepEqual(result.decisions.map((decision) => decision.id), repeated.decisions.map((decision) => decision.id))
})

test('unknown-only evidence returns a null score instead of a fabricated zero-confidence rank', () => {
  const decision = one({ candidates: [candidate({ credits: null, time: null })] })
  assert.equal(decision.score, null)
  assert.equal(decision.completeness, 'unknown')
  assert.equal(decision.scheduleStatus, 'unknown')
  assert.equal(decision.duplicateStatus, 'unknown')
  assert.equal(decision.requirementMatches[0].basis, 'unknown')
})

test('categories-only academic progress cannot be upgraded beyond partial by caller metadata', () => {
  const decision = one(completeInput({
    academicProgress: { categories: [REQUIREMENT] },
    completeness: {
      academicProgress: 'complete',
      schedule: 'complete',
      grades: 'complete',
      selectedCourses: 'complete',
    },
  }))
  assert.equal(decision.completeness, 'partial')
  assert.equal(decision.scoreBreakdown.dataQuality, 6)
})

test('only allowlisted non-executing proposals are returned and no source URL leaks', () => {
  const output = createCourseDecisions(completeInput())
  assert.deepEqual([...new Set(output.proposals.map((proposal) => proposal.kind))], COURSE_DECISION_PROPOSAL_KINDS)
  assert.equal(output.proposals.every((proposal) => Object.hasOwn(proposal, 'candidateId')), true)
  assert.equal(output.proposals.some((proposal) => Object.hasOwn(proposal, 'url') || Object.hasOwn(proposal, 'href')), false)
  assert.doesNotMatch(JSON.stringify(output), /sourceUrl|token=secret|xkBcZyZzxkYzb|operationId/)
})

test('ranking is pure local computation and never calls fetch', () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = () => {
    calls += 1
    throw new Error('course decisions attempted network I/O')
  }
  try {
    assert.doesNotThrow(() => createCourseDecisions(completeInput()))
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal(calls, 0)
})

test('optional evidence factory is ignored: course decisions carry no evidence refs', () => {
  const requests = []
  const decision = one(completeInput(), {
    evidenceRefFactory(request) {
      requests.push(request)
      return [
        { id: `evidence:${request.dataset}:${request.entityId}` },
        'https://must-not-leak.example/',
      ]
    },
  })
  assert.equal(requests.length, 0)
  assert.equal(Object.hasOwn(decision, 'evidenceRefs'), false)
})

test('matched requirement gap raises the recommendation score', () => {
  const base = one(completeInput())
  const gapNow = one(completeInput({
    academicProgress: {
      categories: [],
      roots: [{ ...REQUIREMENT, remaining: 8 }],
    },
  }))
  const gapFilled = one(completeInput({
    academicProgress: {
      categories: [],
      roots: [{ ...REQUIREMENT, remaining: 0 }],
    },
  }))
  assert.equal(gapNow.scoreBreakdown.requirementGap, 24)
  assert.equal(gapFilled.scoreBreakdown.requirementGap, 0)
  assert.equal(base.scoreBreakdown.requirementGap, 24)
  assert.ok(gapNow.score > gapFilled.score)
})

test('gap reason names the training-plan node and its remaining credits', () => {
  const decision = one(completeInput({
    academicProgress: {
      categories: [],
      roots: [{ ...REQUIREMENT, remaining: 8 }],
    },
  }))
  assert.equal(decision.reasons.some((reason) => /仍缺 8 学分/.test(reason)), true)
  const filled = one(completeInput({
    academicProgress: {
      categories: [],
      roots: [{ ...REQUIREMENT, remaining: 0 }],
    },
  }))
  assert.equal(filled.reasons.some((reason) => /学分缺口已补足/.test(reason)), true)
})

test('gap scoring reads credits from the nested credits object as well', () => {
  const decision = one(completeInput({
    academicProgress: {
      categories: [],
      roots: [{
        ...REQUIREMENT,
        required: null,
        earned: null,
        remaining: null,
        credits: { required: 8, earned: 2, remaining: 6 },
      }],
    },
  }))
  assert.equal(decision.scoreBreakdown.requirementGap, 18)
})

test('module source contains no course-selection POST endpoint or network primitive', async () => {
  const source = await readFile(new URL('../core/advisor/course-decision-engine.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\bfetch\s*\(|\.form\s*\(|\.page\s*\(|xkBcZyZzxkYzb|SELECT_URL/)
})

test('candidate ids are required and unique', () => {
  assert.throws(() => createCourseDecisions({ candidates: [{}] }), /non-empty id/)
  assert.throws(() => createCourseDecisions({ candidates: [candidate(), candidate()] }), /must be unique/)
})
