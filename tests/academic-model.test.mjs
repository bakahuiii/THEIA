import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ACADEMIC_UNKNOWN,
  buildAcademicAnalysis,
  groupGradeAttempts,
  normalizeGradeAttempt,
} from '../core/academic-model.mjs'
import { stableId } from '../core/util.mjs'

test('stable ids retain the existing SHA-256 contract in the renderer-safe utility', () => {
  assert.equal(stableId('abc'), 'ba7816bf8f01cfea414140de')
  assert.equal(stableId('课程', '化学'), '3708689e1e59f7ed1bae59b1')
})

test('grade attempts preserve retakes while selecting one course representative', () => {
  const grades = [
    { id: 'first', courseCode: ' mat 100 ', courseName: '数学', termId: '2024-3', credits: 4, score: 55, point: 0 },
    { id: 'second', courseCode: 'MAT100', courseName: '数学', termId: '2024-12', credits: 4, score: 75, point: 2.67 },
  ]
  const attempts = grades.map(normalizeGradeAttempt)
  assert.equal(attempts[0].courseKey, 'code:MAT100')
  assert.equal(attempts[0].outcome, 'failed')
  assert.equal(attempts[1].creditIncluded, true)

  const [course] = groupGradeAttempts(grades)
  assert.equal(course.isRetake, true)
  assert.equal(course.attemptCount, 2)
  assert.equal(course.creditAttemptId, 'second')
  assert.equal(course.gpaAttemptId, 'second')
  assert.equal(course.earnedCredits, 4)
})

test('missing identity does not merge same-titled courses', () => {
  const courses = groupGradeAttempts([
    { id: 'class-a', courseName: '大学英语', termId: '2024-3', credits: 2, score: 80 },
    { id: 'class-b', courseName: '大学英语', termId: '2024-12', credits: 2, score: 90 },
  ])
  assert.equal(courses.length, 2)
  assert.deepEqual(courses.map((course) => course.courseKey), ['id:class-a', 'id:class-b'])
})

test('and requirements allocate earned credits and preserve unknown rows', () => {
  const analysis = buildAcademicAnalysis({
    grades: [
      { id: 'math-grade', courseCode: 'MAT100', courseName: '数学', credits: 3, score: 90, point: 4 },
      { id: 'unknown-grade', courseCode: 'UNK100', courseName: '未知课程', credits: 2, score: null, point: null },
    ],
    progress: {
      roots: [{
        id: 'core',
        title: '专业必修',
        required: 5,
        relation: 'and',
        courses: [
          { id: 'req-math', courseCode: 'MAT100', title: '数学', credits: 3 },
          { id: 'req-unknown', courseCode: 'UNK100', title: '未知课程', credits: 2 },
        ],
      }],
    },
  })
  const [root] = analysis.creditLedger.requirementRoots
  assert.equal(root.required, 5)
  assert.equal(root.earned, 3)
  assert.equal(root.remaining, 2)
  assert.equal(root.status, 'incomplete')
  assert.equal(root.allocations[0].status, 'earned')
  assert.equal(root.allocations[1].status, ACADEMIC_UNKNOWN)
  assert.equal(analysis.creditLedger.unknownAttempts, 1)
  assert.equal(analysis.creditLedger.unknownCredits, 2)
})

test('or requirements remain alternatives instead of summing branches', () => {
  const analysis = buildAcademicAnalysis({
    grades: [{ id: 'lang', courseCode: 'LANG100', courseName: '外语', credits: 2, score: 90, point: 4 }],
    progress: {
      roots: [{
        id: 'elective', title: '方向要求', relation: 'and',
        children: [
          { id: 'a', title: '方向 A', relation: 'or', required: 2, courses: [{ id: 'a-lang', courseCode: 'LANG100', title: '外语', credits: 2 }] },
          { id: 'b', title: '方向 B', relation: 'or', required: 4, courses: [{ id: 'b-other', courseCode: 'OTHER100', title: '其他', credits: 4 }] },
        ],
      }],
    },
  })
  const [root] = analysis.requirements.roots
  assert.equal(root.relation, 'and')
  assert.equal(root.required, null)
  assert.equal(root.alternatives.length, 2)
  assert.equal(root.alternatives[0].id, 'a')
  assert.equal(root.alternatives[0].earned, 2)
  assert.equal(root.alternatives[1].earned, null)
})

test('official GPA is retained separately from derived GPA', () => {
  const analysis = buildAcademicAnalysis({
    grades: [{ courseCode: 'MAT100', credits: 3, score: 90, point: 4 }],
    progress: { gpa: 3.62, categories: [] },
  })
  assert.equal(analysis.gpa.value, 3.62)
  assert.equal(analysis.gpa.officialValue, 3.62)
  assert.equal(analysis.gpa.computedValue, 4)
  assert.equal(analysis.gpa.source, 'official')
})
