import test from 'node:test'
import assert from 'node:assert/strict'
import { computeEarnedCredits, computeGpa, computeGpaTrend, formatGpa, gpaEligibilityReason, gradePoint, isGpaEligible, isPassedGrade, scoreToPoint } from '../core/gpa.mjs'

test('score conversion follows BUCT boundaries', () => {
  assert.equal(scoreToPoint(95), 4.33)
  assert.equal(scoreToPoint(90), 4)
  assert.equal(scoreToPoint(85), 3.67)
  assert.equal(scoreToPoint(82), 3.33)
  assert.equal(scoreToPoint(78), 3)
  assert.equal(scoreToPoint(61), 1.33)
  assert.equal(scoreToPoint(60), 1)
  assert.equal(scoreToPoint(59), 0)
  assert.equal(scoreToPoint('P'), null)
})

test('GPA excludes non-numeric and excluded course categories but counts zero points', () => {
  const grades = [
    { credits: 3, score: 90 },
    { credits: 1, score: 59 },
    { credits: 2, score: 'P' },
    { credits: 2, score: 100, nature: '体育' },
    { credits: 2, score: 100, category: '素质教育课程' },
  ]
  assert.equal(isGpaEligible(grades[0]), true)
  assert.equal(isGpaEligible(grades[2]), false)
  assert.deepEqual(computeGpa(grades), { gpa: 3, credits: 4, included: 2 })
  assert.deepEqual(computeGpa([{ credits: 2, score: '缺考', remark: '缺考' }]), { gpa: 0, credits: 2, included: 1 })
})

test('explicit failed marks remain zero-point GPA denominator credits', () => {
  const grades = [
    { courseCode: 'PASS100', credits: 3, score: 90, point: 4 },
    { courseCode: 'FAIL-U', credits: 2, score: 'U', point: 3.5 },
    { courseCode: 'FAIL-TEXT', credits: 1, score: '不合格', point: 3.5 },
  ]
  assert.equal(isGpaEligible(grades[1]), true)
  assert.equal(isGpaEligible(grades[2]), true)
  assert.equal(gradePoint(grades[1]), 0)
  assert.equal(gradePoint(grades[2]), 0)
  assert.deepEqual(computeGpa(grades), { gpa: 2, credits: 6, included: 3 })
})

test('missing or non-numeric point values never override a usable score with zero', () => {
  for (const point of [null, undefined, '', '   ', false, [], {}]) {
    assert.equal(gradePoint({ score: 90, point }), 4)
    assert.deepEqual(computeGpa([{ courseCode: 'MAT100', credits: 3, score: 90, point }]), {
      gpa: 4,
      credits: 3,
      included: 1,
    })
  }
  assert.equal(gradePoint({ score: '合格', point: null }), null)
  assert.equal(isPassedGrade({ score: '合格', point: null }), true)
})

test('explicit source remarks exclude a row while independent failures remain denominator credits', () => {
  const excluded = { courseCode: 'OLD100', credits: 1, score: '不合格', point: 0, remark: '不统计2025' }
  const failed = { courseCode: 'FAIL100', credits: 2, score: '不合格', point: 0 }
  assert.equal(gpaEligibilityReason(excluded), 'explicitly-excluded')
  assert.equal(isGpaEligible(excluded), false)
  assert.equal(isGpaEligible(failed), true)
  assert.deepEqual(computeGpa([excluded, failed]), { gpa: 0, credits: 2, included: 1 })
})

test('a qualitative pass suppresses an older failed attempt regardless of row order', () => {
  const failed = { courseCode: 'RETAKE100', termId: '2024-3', credits: 1, score: '不合格', point: 0 }
  const passed = { courseCode: 'RETAKE100', termId: '2025-3', credits: 1, score: '合格', point: null }
  for (const grades of [[failed, passed], [passed, failed]]) {
    assert.deepEqual(computeGpa(grades), { gpa: null, credits: 0, included: 0 })
  }
})

test('a numeric retake remains the GPA representative over failed and qualitative attempts', () => {
  const grades = [
    { courseCode: 'RETAKE100', termId: '2024-3', credits: 1, score: '不合格', point: 0 },
    { courseCode: 'RETAKE100', termId: '2024-12', credits: 1, score: '合格', point: null },
    { courseCode: 'RETAKE100', termId: '2025-3', credits: 1, score: 75, point: 2.67 },
  ]
  assert.deepEqual(computeGpa(grades), { gpa: 2.67, credits: 1, included: 1 })
})

test('an incomplete passing row does not silently suppress a complete failed attempt', () => {
  const grades = [
    { courseCode: 'RETAKE100', termId: '2024-3', credits: 1, score: '不合格', point: 0 },
    { courseCode: 'RETAKE100', termId: '2025-3', credits: null, score: 90, point: 4 },
  ]
  assert.deepEqual(computeGpa(grades), { gpa: 0, credits: 1, included: 1 })
})

test('cumulative GPA removes an earlier failure after a later qualitative pass', () => {
  const trend = computeGpaTrend([
    { courseCode: 'RETAKE100', termId: '2024-3', credits: 1, score: '不合格', point: 0 },
    { courseCode: 'BASE100', termId: '2024-3', credits: 2, score: 90, point: 4 },
    { courseCode: 'RETAKE100', termId: '2025-3', credits: 1, score: '合格', point: null },
  ])
  assert.equal(trend.semesters[0].gpa, 8 / 3)
  assert.equal(trend.semesters[1].gpa, null)
  assert.equal(trend.semesters[1].cumulativeGpa, 4)
  assert.equal(trend.semesters[1].cumulativeCredits, 2)
})

test('trend groups semester data and weights academic years by credits', () => {
  const grades = [
    { termId: '2024-3', credits: 3, score: 90 },
    { termId: '2024-12', credits: 1, score: 60 },
    { termId: '2025-3', credits: 2, score: 100 },
  ]
  const trend = computeGpaTrend(grades, [{ id: '2024-3', label: '2024-2025 第一学期' }])
  assert.deepEqual(trend.semesters.map((item) => item.id), ['2024-3', '2024-12', '2025-3'])
  assert.equal(trend.academicYears[0].gpa, 3.25)
})

test('earned credits exclude failures and count a retaken course only once', () => {
  const grades = [
    { courseCode: 'MAT100', termId: '2024-3', credits: 4, score: 55, point: 0 },
    { courseCode: 'MAT100', termId: '2024-12', credits: 4, score: 75, point: 2.67 },
    { courseCode: 'PHY100', termId: '2024-12', credits: 3, score: '缺考', point: 0, remark: '缺考' },
    { courseCode: 'CHE100', termId: '2024-12', credits: 2, score: '不合格', point: 0 },
    { courseCode: 'PE100', termId: '2024-12', credits: 1, score: 'P', remark: '免体' },
  ]
  assert.equal(isPassedGrade(grades[0]), false)
  assert.equal(isPassedGrade(grades[1]), true)
  assert.equal(isPassedGrade(grades[2]), false)
  assert.deepEqual(computeEarnedCredits(grades), { credits: 5, courses: 2 })
})

test('GPA and cumulative trend use the best attempt once for repeated course codes', () => {
  const grades = [
    { courseCode: 'MAT100', termId: '2024-3', credits: 4, score: 55, point: 0 },
    { courseCode: 'CHE100', termId: '2024-3', credits: 2, score: 90, point: 4 },
    { courseCode: 'MAT100', termId: '2024-12', credits: 4, score: 75, point: 2.67 },
  ]
  assert.deepEqual(computeGpa(grades), { gpa: 3.1133333333333333, credits: 6, included: 2 })
  const trend = computeGpaTrend(grades)
  assert.equal(trend.semesters[0].gpa, 4 / 3)
  assert.equal(trend.semesters[1].cumulativeGpa, 3.1133333333333333)
  assert.equal(trend.semesters[1].cumulativeCredits, 6)
})

test('GPA display truncates reproducible calculations to four decimal places', () => {
  assert.equal(formatGpa(1.78188119), '1.7818')
  assert.equal(formatGpa(1.78), '1.7800')
  assert.equal(formatGpa(null), '--')
})

test('rows without an official course code are not guessed to be retakes by title', () => {
  const grades = [
    { id: 'class-a', courseName: 'College English', termId: '2024-3', credits: 2, score: 80 },
    { id: 'class-b', courseName: 'College English', termId: '2024-12', credits: 2, score: 90 },
  ]
  assert.deepEqual(computeEarnedCredits(grades), { credits: 4, courses: 2 })
  assert.equal(computeGpa(grades).included, 2)
})
