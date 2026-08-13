const NON_GPA_MARKS = new Set(['P', 'PASS', '合格', 'U', '不合格'])
const LETTER_POINTS = new Map([
  ['A+', 4.33], ['A', 4], ['A-', 3.67], ['B+', 3.33], ['B', 3], ['B-', 2.67],
  ['C+', 2.33], ['C', 2], ['C-', 1.67], ['D+', 1.33], ['D', 1], ['F', 0],
])
const FAILED_GRADE = /缺考|不合格|不及格|未通过|挂科|违纪|作弊/i
const PASSED_GRADE = /合格|通过|及格|优秀|良好|中等|已修|完成/i

export function scoreToPoint(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number' && !Number.isFinite(value)) return null
  const text = String(value).trim().toUpperCase()
  if (!text || NON_GPA_MARKS.has(text)) return null
  if (LETTER_POINTS.has(text)) return LETTER_POINTS.get(text)
  const score = Number.parseFloat(text)
  if (!Number.isFinite(score)) return null
  if (score >= 95) return 4.33
  if (score >= 90) return 4
  if (score >= 85) return 3.67
  if (score >= 82) return 3.33
  if (score >= 78) return 3
  if (score >= 75) return 2.67
  if (score >= 72) return 2.33
  if (score >= 68) return 2
  if (score >= 64) return 1.67
  if (score >= 61) return 1.33
  if (score >= 60) return 1
  return 0
}

export function isGpaEligible(grade) {
  const credits = Number(grade?.credits)
  if (!Number.isFinite(credits) || credits <= 0) return false
  if (grade?.gpaIncluded === false) return false
  const text = [grade?.category, grade?.nature, grade?.courseCategory, grade?.courseName].filter(Boolean).join(' ')
  if (/(素质教育|体育|二级计分|二级评分|两级计分)/i.test(text)) return false
  if (NON_GPA_MARKS.has(String(grade?.score ?? '').trim().toUpperCase())) return false
  return gradePoint(grade) !== null
}

export function gradePoint(grade) {
  const statusText = [grade?.remark, grade?.status, grade?.score].filter(Boolean).join(' ')
  if (FAILED_GRADE.test(statusText)) return 0
  const point = Number(grade?.point)
  if (Number.isFinite(point) && point >= 0 && point <= 4.33) return point
  return scoreToPoint(grade?.score)
}

function normalizedIdentity(value) {
  return String(value ?? '').replace(/\s+/g, '').trim().toUpperCase()
}

function gradeIdentity(grade, index) {
  const code = normalizedIdentity(grade?.courseCode || grade?.courseId || grade?.code)
  if (code) return `code:${code}`
  const id = normalizedIdentity(grade?.id)
  if (id) return `id:${id}`
  const name = normalizedIdentity(grade?.courseName || grade?.title)
  return name ? `name:${name}:${index}` : `row:${index}`
}

const TERM_ORDER = new Map([['3', 0], ['12', 1], ['16', 2]])

function termRank(termId) {
  const [year = '', term = ''] = String(termId || '').split('-')
  const numericYear = Number(year)
  return (Number.isFinite(numericYear) ? numericYear : 0) * 10 + (TERM_ORDER.get(term) ?? 9)
}

function bestGpaAttempts(grades) {
  const selected = new Map()
  for (const [index, grade] of (grades || []).entries()) {
    if (!isGpaEligible(grade)) continue
    const point = gradePoint(grade)
    if (point === null) continue
    const key = gradeIdentity(grade, index)
    const current = selected.get(key)
    if (!current
      || point > current.point
      || (point === current.point && termRank(grade?.termId) >= termRank(current.grade?.termId))) {
      selected.set(key, { grade, point })
    }
  }
  return [...selected.values()]
}

export function isPassedGrade(grade) {
  const score = String(grade?.score ?? '').trim()
  const normalized = score.toUpperCase()
  const statusText = [score, grade?.remark, grade?.status].filter(Boolean).join(' ')
  if (FAILED_GRADE.test(statusText) || normalized === 'U' || normalized === 'F') return false
  if (normalized === 'P' || normalized === 'PASS' || PASSED_GRADE.test(statusText)) return true
  if (/^(?:A[+-]?|B[+-]?|C[+-]?|D[+]?)$/.test(normalized)) return true
  if (score) {
    const numeric = Number(score)
    if (Number.isFinite(numeric)) return numeric >= 60
  }
  const point = Number(grade?.point)
  return Number.isFinite(point) && point > 0
}

export function computeEarnedCredits(grades) {
  const earned = new Map()
  for (const [index, grade] of (grades || []).entries()) {
    if (!isPassedGrade(grade)) continue
    const credits = Number(grade?.credits)
    if (!Number.isFinite(credits) || credits <= 0) continue
    const key = gradeIdentity(grade, index)
    earned.set(key, Math.max(earned.get(key) || 0, credits))
  }
  return {
    credits: [...earned.values()].reduce((sum, credits) => sum + credits, 0),
    courses: earned.size,
  }
}

export function computeGpa(grades) {
  let weighted = 0; let credits = 0; let included = 0
  for (const { grade, point } of bestGpaAttempts(grades)) {
    const credit = Number(grade?.credits)
    weighted += point * credit; credits += credit; included += 1
  }
  return { gpa: credits ? weighted / credits : null, credits, included }
}

export function formatGpa(value) {
  if (value === null || value === undefined || String(value).trim() === '') return '--'
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value))
  if (!Number.isFinite(parsed)) return String(value)
  const normalized = Number(parsed.toFixed(12))
  return (Math.trunc(normalized * 10_000) / 10_000).toFixed(4)
}

export function computeGpaTrend(grades, terms = []) {
  const labels = new Map(terms.map((term) => [term.id, term.label]))
  const grouped = new Map()
  for (const grade of grades || []) {
    const termId = grade?.termId
    if (!termId || !isGpaEligible(grade)) continue
    if (!grouped.has(termId)) grouped.set(termId, [])
    grouped.get(termId).push(grade)
  }
  const semesters = [...grouped.entries()].map(([id, values]) => ({ id, label: labels.get(id) || id, ...computeGpa(values) })).sort((a, b) => {
    const [ay, at] = a.id.split('-'); const [by, bt] = b.id.split('-')
    return Number(ay) - Number(by) || (TERM_ORDER.get(at) ?? 99) - (TERM_ORDER.get(bt) ?? 99)
  })
  const cumulativeValues = []
  const semestersWithCumulative = semesters.map((semester) => {
    cumulativeValues.push(...(grouped.get(semester.id) || []))
    const cumulative = computeGpa(cumulativeValues)
    return {
      ...semester,
      cumulativeGpa: cumulative.gpa,
      cumulativeCredits: cumulative.credits,
      cumulativeIncluded: cumulative.included,
    }
  })
  const yearGroups = new Map()
  for (const semester of semestersWithCumulative) {
    const year = semester.id.split('-')[0]
    if (!yearGroups.has(year)) yearGroups.set(year, [])
    yearGroups.get(year).push(...grouped.get(semester.id))
  }
  const academicYears = [...yearGroups.entries()].map(([year, values]) => ({ id: year, label: `${year}-${Number(year) + 1}`, ...computeGpa(values) }))
  return { semesters: semestersWithCumulative, academicYears }
}
