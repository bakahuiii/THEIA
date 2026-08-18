import { stableId } from './util.mjs'
import {
  computeEarnedCredits,
  computeGpa,
  gpaEligibilityReason,
  gradePoint,
  isPassedGrade,
} from './gpa.mjs'

export const ACADEMIC_ANALYSIS_SCHEMA = 'theia-academic-analysis/v1'
export const ACADEMIC_UNKNOWN = 'unknown'

const FAILED_MARK = /缺考|不合格|不及格|未通过|挂科|违纪|作弊|\b(?:U|F)\b/iu
const IN_PROGRESS_MARK = /在读|修读|已选|学习中|进行中/iu
const EXEMPTION_MARK = /免修|免考|免试/iu
const SUBSTITUTION_MARK = /替代|替换|抵扣|冲抵/iu
const OVERAGE_MARK = /超出|超额|多修/iu

function text(value, maximum = 240) {
  const normalized = String(value ?? '').normalize('NFC').trim()
  return normalized ? normalized.slice(0, maximum) : null
}

function positiveNumber(value) {
  const number = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, '').trim())
  return Number.isFinite(number) && number > 0 ? number : null
}

function finiteNumber(value) {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null
  const number = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, '').trim())
  return Number.isFinite(number) ? number : null
}

function normalizedCode(value) {
  const result = text(value, 120)
  return result ? result.replace(/\s+/g, '').toUpperCase() : null
}

function normalizedTitle(value) {
  const result = text(value, 240)
  return result ? result.replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN') : null
}

function termRank(value) {
  const match = String(value || '').match(/^(\d{4})-(\d+)$/)
  if (!match) return Number.NEGATIVE_INFINITY
  const year = Number(match[1])
  const term = Number(match[2])
  return Number.isFinite(year) && Number.isFinite(term) ? year * 100 + term : Number.NEGATIVE_INFINITY
}

function statusText(grade) {
  return [grade?.score, grade?.status, grade?.remark].filter((value) => value != null).map(String).join(' ')
}

function outcomeOf(grade) {
  const status = statusText(grade)
  if (isPassedGrade(grade)) return 'passed'
  if (FAILED_MARK.test(status)) return 'failed'
  if (IN_PROGRESS_MARK.test(status)) return 'in-progress'
  if (grade?.score == null && grade?.point == null) return 'unknown'
  const numeric = Number(grade?.score)
  if (Number.isFinite(numeric)) return numeric >= 60 ? 'passed' : 'failed'
  return 'unknown'
}

export function normalizeCourseKey(grade, index = 0) {
  const code = normalizedCode(grade?.courseCode || grade?.courseId || grade?.code)
  if (code) return `code:${code}`
  const id = text(grade?.id, 160)
  if (id) return `id:${id}`
  return `row:${index}`
}

export function normalizeGradeAttempt(grade, index = 0) {
  const courseKey = normalizeCourseKey(grade, index)
  const outcome = outcomeOf(grade)
  const credits = positiveNumber(grade?.credits)
  const point = gradePoint(grade)
  const eligibilityReason = gpaEligibilityReason(grade)
  const explicitGpaIncluded = typeof grade?.gpaIncluded === 'boolean' ? grade.gpaIncluded : null
  return {
    schema: 'theia-grade-attempt/v1',
    id: text(grade?.id, 160) || stableId('grade-attempt', courseKey, index),
    courseKey,
    courseCode: normalizedCode(grade?.courseCode || grade?.courseId || grade?.code),
    courseName: text(grade?.courseName || grade?.title, 240),
    termId: text(grade?.termId, 80),
    attemptIndex: index,
    outcome,
    score: grade?.score == null ? null : text(grade.score, 80),
    point: point == null ? null : point,
    credits,
    gpaIncluded: explicitGpaIncluded ?? (eligibilityReason === null),
    gpaEligibility: eligibilityReason,
    creditIncluded: outcome === 'passed' && credits != null ? true : outcome === 'failed' ? false : null,
    sourceUrl: text(grade?.sourceUrl, 500),
  }
}

function representativeAttempt(attempts, { forGpa = false } = {}) {
  const candidates = attempts.filter((attempt) => {
    if (forGpa && !attempt.gpaIncluded) return false
    if (forGpa && attempt.point == null) return false
    return attempt.outcome === 'passed' || (forGpa && attempt.outcome === 'failed')
  })
  return [...candidates].sort((left, right) => (
    (Number(right.point ?? -1) - Number(left.point ?? -1))
    || (termRank(right.termId) - termRank(left.termId))
    || (right.attemptIndex - left.attemptIndex)
  ))[0] || null
}

export function groupGradeAttempts(grades = []) {
  const groups = new Map()
  for (const [index, grade] of (Array.isArray(grades) ? grades : []).entries()) {
    if (!grade || typeof grade !== 'object') continue
    const attempt = normalizeGradeAttempt(grade, index)
    const existing = groups.get(attempt.courseKey)
    if (existing) {
      existing.attempts.push(attempt)
      continue
    }
    groups.set(attempt.courseKey, {
      schema: 'theia-course-analysis/v1',
      courseKey: attempt.courseKey,
      courseCode: attempt.courseCode,
      courseName: attempt.courseName,
      attempts: [attempt],
    })
  }
  return [...groups.values()].map((course) => {
    const attempts = [...course.attempts].sort((left, right) => left.attemptIndex - right.attemptIndex)
    const passed = attempts.filter((attempt) => attempt.outcome === 'passed')
    const gpaAttempt = representativeAttempt(attempts, { forGpa: true })
    const creditAttempt = [...passed].sort((left, right) => (
      Number(right.credits ?? 0) - Number(left.credits ?? 0)
      || termRank(right.termId) - termRank(left.termId)
      || right.attemptIndex - left.attemptIndex
    ))[0] || null
    const latest = [...attempts].sort((left, right) => (
      termRank(right.termId) - termRank(left.termId) || right.attemptIndex - left.attemptIndex
    ))[0] || null
    return {
      ...course,
      attempts,
      attemptCount: attempts.length,
      isRetake: attempts.length > 1,
      status: creditAttempt?.outcome || latest?.outcome || ACADEMIC_UNKNOWN,
      representativeAttemptId: (creditAttempt || latest)?.id || null,
      gpaAttemptId: gpaAttempt?.id || null,
      creditAttemptId: creditAttempt?.id || null,
      earnedCredits: creditAttempt?.credits ?? null,
    }
  })
}

function treatmentOf(node) {
  const explicit = text(node?.creditTreatment, 40)
  if (['normal', 'substitution', 'exemption', 'overage', ACADEMIC_UNKNOWN].includes(explicit)) return explicit
  const descriptor = [node?.title, node?.status].filter(Boolean).join(' ')
  if (EXEMPTION_MARK.test(descriptor)) return 'exemption'
  if (SUBSTITUTION_MARK.test(descriptor)) return 'substitution'
  if (OVERAGE_MARK.test(descriptor)) return 'overage'
  return 'normal'
}

function requirementCourses(node) {
  return Array.isArray(node?.courses) ? node.courses.filter((course) => course && typeof course === 'object') : []
}

function buildRequirementIndex(progress) {
  const roots = Array.isArray(progress?.roots) && progress.roots.length
    ? progress.roots
    : Array.isArray(progress?.categories) ? progress.categories : []
  const flat = []
  const rootIds = []
  const walk = (nodes, parentId = null) => {
    const result = []
    for (const node of Array.isArray(nodes) ? nodes : []) {
      if (!node || typeof node !== 'object') continue
      const id = text(node.id, 180) || stableId('requirement', node.title || flat.length)
      const normalized = {
        id,
        parentId: text(node.parentId, 180) || parentId,
        title: text(node.title, 240) || '未命名要求',
        relation: node.relation === 'or' ? 'or' : node.relation === 'and' ? 'and' : null,
        required: finiteNumber(node.required),
        officialEarned: finiteNumber(node.earned),
        officialRemaining: finiteNumber(node.remaining),
        status: text(node.status, 120),
        treatment: treatmentOf(node),
        courses: requirementCourses(node).map((course, index) => ({
          id: text(course.id, 180) || stableId('requirement-course', id, index),
          courseCode: normalizedCode(course.courseCode || course.code),
          title: text(course.title || course.courseName, 240) || '未命名课程',
          titleKey: normalizedTitle(course.title || course.courseName),
          credits: positiveNumber(course.credits),
          studyStatus: text(course.studyStatus || course.status, 80),
          score: course.score == null ? null : text(course.score, 80),
          recommendedYear: text(course.recommendedYear || course.academicYear, 40),
          recommendedTerm: text(course.recommendedTerm || course.term, 40),
        })),
        children: [],
      }
      flat.push(normalized)
      result.push(normalized)
      const children = walk(node.children, id)
      normalized.children = children
    }
    return result
  }
  const normalizedRoots = walk(roots)
  for (const root of normalizedRoots) rootIds.push(root.id)
  return { roots: normalizedRoots, nodes: flat, rootIds }
}

function matchCourse(requirementCourse, coursesByCode, coursesByTitle) {
  if (requirementCourse.courseCode && coursesByCode.has(requirementCourse.courseCode)) {
    return { course: coursesByCode.get(requirementCourse.courseCode), basis: 'course-code' }
  }
  const matches = requirementCourse.titleKey ? coursesByTitle.get(requirementCourse.titleKey) || [] : []
  if (matches.length === 1) return { course: matches[0], basis: 'unique-title' }
  return { course: null, basis: matches.length > 1 ? ACADEMIC_UNKNOWN : 'unmatched' }
}

function nodeLedger(node, allocationsByNode, childLedgers) {
  const allocations = allocationsByNode.get(node.id) || []
  const earnedAllocations = allocations.filter((allocation) => allocation.status === 'earned')
  const unknownAllocation = allocations.some((allocation) => allocation.status === ACADEMIC_UNKNOWN)
    || earnedAllocations.some((allocation) => allocation.credits == null)
  const alternativeChildren = childLedgers.filter((child) => child.relation === 'or')
  const mandatoryChildren = childLedgers.filter((child) => child.relation !== 'or')
  const components = alternativeChildren.length > 1
    ? mandatoryChildren
    : [...mandatoryChildren, ...(alternativeChildren.length === 1 ? alternativeChildren : [])]
  const unresolvedAlternatives = alternativeChildren.length > 1
  const sumKnown = (values) => values.length && values.every((value) => value != null)
    ? values.reduce((total, value) => total + value, 0)
    : null
  const childRequired = unresolvedAlternatives ? null : sumKnown(components.map((child) => child.required))
  const childEarned = unresolvedAlternatives ? null : sumKnown(components.map((child) => child.earned))
  const ownEarned = allocations.length && (earnedAllocations.length > 0 || !unknownAllocation)
    ? earnedAllocations.reduce((total, allocation) => total + (allocation.credits || 0), 0)
    : null
  const officialEarned = node.officialEarned
  const required = node.required ?? childRequired
  const derivedEarned = ownEarned != null && childEarned != null
    ? ownEarned + childEarned
    : ownEarned ?? childEarned
  const earned = officialEarned ?? (unresolvedAlternatives ? null : derivedEarned)
  const remaining = node.officialRemaining ?? (required != null && earned != null ? Math.max(0, required - earned) : null)
  const confidence = officialEarned != null && node.required != null
    ? 'official'
    : unknownAllocation || unresolvedAlternatives || childLedgers.some((child) => child.confidence === ACADEMIC_UNKNOWN)
      ? ACADEMIC_UNKNOWN
      : earned != null ? 'derived' : ACADEMIC_UNKNOWN
  const status = remaining == null
    ? ACADEMIC_UNKNOWN
    : remaining <= 0 ? 'complete' : 'incomplete'
  const alternatives = [...alternativeChildren]
    .sort((left, right) => Number(left.remaining ?? Infinity) - Number(right.remaining ?? Infinity))
  return {
    id: node.id,
    parentId: node.parentId,
    title: node.title,
    relation: node.relation,
    treatment: node.treatment,
    required,
    earned,
    remaining,
    confidence,
    status,
    allocations,
    alternatives,
    children: childLedgers,
  }
}

function buildRequirementLedger(index, courses) {
  const coursesByCode = new Map()
  const coursesByTitle = new Map()
  for (const course of courses) {
    if (course.courseCode) coursesByCode.set(course.courseCode, course)
    const key = normalizedTitle(course.courseName)
    if (key) coursesByTitle.set(key, [...(coursesByTitle.get(key) || []), course])
  }
  const allocationsByNode = new Map()
  for (const node of index.nodes) {
    const allocations = node.courses.map((requirementCourse) => {
      const match = matchCourse(requirementCourse, coursesByCode, coursesByTitle)
      const course = match.course
      const status = course?.status === 'passed'
        ? 'earned'
        : course?.status === 'failed' ? 'not-earned'
          : course ? ACADEMIC_UNKNOWN : ACADEMIC_UNKNOWN
      return {
        requirementCourseId: requirementCourse.id,
        courseCode: requirementCourse.courseCode,
        title: requirementCourse.title,
        requiredCredits: requirementCourse.credits,
        studyStatus: requirementCourse.studyStatus,
        score: requirementCourse.score,
        recommendedYear: requirementCourse.recommendedYear,
        recommendedTerm: requirementCourse.recommendedTerm,
        courseKey: course?.courseKey || null,
        basis: match.basis,
        status,
        credits: course?.earnedCredits ?? requirementCourse.credits ?? null,
        treatment: node.treatment,
      }
    })
    allocationsByNode.set(node.id, allocations)
  }
  const resolve = (node) => nodeLedger(node, allocationsByNode, node.children.map(resolve))
  return index.roots.map(resolve)
}

function enrichCourseAnalyses(analyses, courses) {
  const byCode = new Map()
  for (const course of Array.isArray(courses) ? courses : []) {
    const code = normalizedCode(course?.code || course?.courseCode)
    if (code && !byCode.has(code)) byCode.set(code, course)
  }
  return analyses.map((course) => {
    const source = course.courseCode ? byCode.get(course.courseCode) : null
    if (!source) return course
    return {
      ...course,
      courseName: course.courseName || text(source.title, 240),
    }
  })
}

/**
 * @param {{ grades?: object[], courses?: object[], progress?: object|null, evaluatedAt?: string|null }} [input]
 */
export function buildAcademicAnalysis({ grades = [], courses = [], progress = null, evaluatedAt = null } = {}) {
  const gradeAttempts = (Array.isArray(grades) ? grades : []).map(normalizeGradeAttempt)
  const courseAnalyses = enrichCourseAnalyses(groupGradeAttempts(grades), courses)
  const requirementIndex = buildRequirementIndex(progress)
  const requirementLedger = buildRequirementLedger(requirementIndex, courseAnalyses)
  const computedGpa = computeGpa(grades)
  const earned = computeEarnedCredits(grades)
  const officialGpa = finiteNumber(progress?.gpa)
  const unknownAttempts = gradeAttempts.filter((attempt) => attempt.outcome === ACADEMIC_UNKNOWN).length
  const unknownCredits = courseAnalyses
    .filter((course) => course.status === ACADEMIC_UNKNOWN)
    .reduce((sum, course) => {
      const maximumAttemptCredits = course.attempts.reduce((maximum, attempt) => (
        attempt.credits != null ? Math.max(maximum, attempt.credits) : maximum
      ), 0)
      return sum + maximumAttemptCredits
    }, 0)
  return {
    schema: ACADEMIC_ANALYSIS_SCHEMA,
    evaluatedAt: text(evaluatedAt, 80),
    gpa: {
      value: officialGpa ?? computedGpa.gpa,
      officialValue: officialGpa,
      computedValue: computedGpa.gpa,
      source: officialGpa != null ? 'official' : computedGpa.gpa != null ? 'computed' : ACADEMIC_UNKNOWN,
      credits: computedGpa.credits,
      includedCourses: computedGpa.included,
    },
    gradeAttempts,
    courses: courseAnalyses,
    requirements: {
      source: progress ? (Array.isArray(progress.roots) && progress.roots.length ? 'official-tree' : 'flat') : 'missing',
      roots: requirementLedger,
      nodeCount: requirementIndex.nodes.length,
    },
    creditLedger: {
      earnedCredits: earned.credits,
      earnedCourses: earned.courses,
      attemptedCourses: courseAnalyses.length,
      unknownAttempts,
      unknownCredits,
      requirementRoots: requirementLedger,
    },
    coverage: {
      grades: grades.length ? (unknownAttempts ? 'partial' : 'complete') : 'missing',
      requirements: requirementIndex.nodes.length ? 'complete' : progress ? 'partial' : 'missing',
    },
  }
}
