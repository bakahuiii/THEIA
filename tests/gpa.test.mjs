import test from 'node:test'
import assert from 'node:assert/strict'
import { computeEarnedCredits, computeGpa, computeGpaTrend, formatGpa, isGpaEligible, isPassedGrade, scoreToPoint } from '../core/gpa.mjs'

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
