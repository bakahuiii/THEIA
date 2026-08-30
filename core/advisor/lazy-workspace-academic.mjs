import { canonicalDigest } from './canonical.mjs'

/**
 * Academic tool output is kept separate from the general lazy workspace so
 * requirement matching can evolve without expanding the session/permission
 * coordinator.
 */
export function createAcademicWorkspaceProjection({
  compactObject,
  controlled,
  finite,
  matches,
  maxToolResults,
  text,
}) {
  function opaqueAcademicId(revision, value) {
    return value ? `academic:${canonicalDigest({ revision, value }).slice(0, 20)}` : null
  }

  function projectAcademicLedger(node, revision, depth = 0) {
    if (!node || depth > 4) return null
    return compactObject({
      id: opaqueAcademicId(revision, node.id),
      title: text(node.title, 320),
      relation: node.relation,
      treatment: node.treatment,
      required: finite(node.required),
      earned: finite(node.earned),
      remaining: finite(node.remaining),
      confidence: controlled(node.confidence, 'unknown'),
      status: controlled(node.status, 'unknown'),
      allocations: Array.isArray(node.allocations) ? node.allocations.slice(0, 24).map((allocation) => compactObject({
        requirementCourseId: opaqueAcademicId(revision, allocation.requirementCourseId),
        courseCode: text(allocation.courseCode, 120),
        title: text(allocation.title, 320),
        requiredCredits: finite(allocation.requiredCredits),
        studyStatus: text(allocation.studyStatus, 80),
        score: text(allocation.score, 80),
        recommendedYear: text(allocation.recommendedYear, 40),
        recommendedTerm: text(allocation.recommendedTerm, 40),
        courseKey: opaqueAcademicId(revision, allocation.courseKey),
        basis: controlled(allocation.basis, 'unknown'),
        status: controlled(allocation.status, 'unknown'),
        credits: finite(allocation.credits),
        treatment: controlled(allocation.treatment, 'unknown'),
      })) : [],
      children: Array.isArray(node.children)
        ? node.children.slice(0, 16).map((child) => projectAcademicLedger(child, revision, depth + 1)).filter(Boolean)
        : [],
      alternatives: Array.isArray(node.alternatives)
        ? node.alternatives.slice(0, 16).map((child) => projectAcademicLedger(child, revision, depth + 1)).filter(Boolean)
        : [],
    })
  }

  function projectAcademicAnalysis(analysis, revision, maximum = maxToolResults) {
    return {
      schema: analysis.schema,
      evaluatedAt: analysis.evaluatedAt,
      gpa: analysis.gpa,
      coverage: analysis.coverage,
      creditLedger: {
        earnedCredits: analysis.creditLedger.earnedCredits,
        earnedCourses: analysis.creditLedger.earnedCourses,
        attemptedCourses: analysis.creditLedger.attemptedCourses,
        unknownAttempts: analysis.creditLedger.unknownAttempts,
        unknownCredits: analysis.creditLedger.unknownCredits,
      },
      courses: analysis.courses.slice(0, Math.min(24, Math.max(maximum, 6))).map((course) => ({
        courseKey: opaqueAcademicId(revision, course.courseKey),
        courseCode: course.courseCode,
        courseName: course.courseName,
        attemptCount: course.attemptCount,
        isRetake: course.isRetake,
        status: course.status,
        earnedCredits: course.earnedCredits,
        representativeAttemptId: opaqueAcademicId(revision, course.representativeAttemptId),
        gpaAttemptId: opaqueAcademicId(revision, course.gpaAttemptId),
        creditAttemptId: opaqueAcademicId(revision, course.creditAttemptId),
      })),
      requirementRoots: analysis.creditLedger.requirementRoots.slice(0, 12)
        .map((node) => projectAcademicLedger(node, revision)).filter(Boolean),
    }
  }

  function normalizedCourseCode(value) {
    const normalized = String(value ?? '').normalize('NFC').trim()
    return normalized ? normalized.replace(/\s+/gu, '').toLocaleUpperCase() : ''
  }

  function normalizedCourseTitle(value) {
    return String(value ?? '').normalize('NFC').trim().replace(/\s+/gu, '').toLocaleLowerCase()
  }

  function termRank(value) {
    const match = String(value || '').match(/^(\d{4})-(\d+)$/u)
    return match ? Number(match[1]) * 100 + Number(match[2]) : Number.NEGATIVE_INFINITY
  }

  function courseRequirementKind(allocation, path) {
    const pathText = path.join(' ')
    const optional = /选修|任选|素质拓展|通识/u.test(pathText)
    const studyStatus = String(allocation.studyStatus || '')
    if (allocation.status === 'not-earned' || /未通过|不及格|挂科|缺考/u.test(studyStatus)) return 'must-retake'
    if (allocation.status === 'earned') return 'already-earned'
    if (optional) return 'optional-unfinished'
    if (/未修/u.test(studyStatus) || allocation.status === 'unknown') return 'required-unfinished'
    return 'unknown'
  }

  function flattenAcademicRequirements(nodes, path = [], output = []) {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      if (!node || typeof node !== 'object') continue
      const nextPath = [...path, text(node.title, 320) || '未命名要求']
      output.push({ node, path: nextPath })
      flattenAcademicRequirements(node.children, nextPath, output)
    }
    return output
  }

  function projectRequirementGap(allocation, path, revision) {
    const kind = courseRequirementKind(allocation, path)
    return compactObject({
      kind,
      category: text(path[1] || path[0], 160),
      path: path.slice(0, 5).map((item) => text(item, 160)).filter(Boolean),
      courseCode: text(allocation.courseCode, 120),
      title: text(allocation.title, 320),
      credits: finite(allocation.requiredCredits ?? allocation.credits),
      studyStatus: text(allocation.studyStatus, 80),
      score: text(allocation.score, 80),
      recommendedYear: text(allocation.recommendedYear, 40),
      recommendedTerm: text(allocation.recommendedTerm, 40),
      basis: controlled(allocation.basis, 'unknown'),
      courseKey: opaqueAcademicId(revision, allocation.courseKey),
    })
  }

  function scheduleKind(item, requirementsByCode, requirementsByTitle, hasRequirements) {
    const code = normalizedCourseCode(item?.courseCode || item?.code)
    const title = normalizedCourseTitle(item?.title || item?.courseName)
    const requirement = (code && requirementsByCode.get(code)) || (title && requirementsByTitle.get(title)) || null
    if (requirement) {
      return {
        kind: requirement.kind,
        requirement: compactObject({
          category: requirement.category,
          title: requirement.title,
          courseCode: requirement.courseCode,
          credits: requirement.credits,
          studyStatus: requirement.studyStatus,
        }),
      }
    }
    const elective = /选修|任选|素质|拓展|通识/u.test(`${item?.nature || ''} ${item?.category || ''} ${item?.affiliation || ''}`)
    return { kind: hasRequirements ? (elective ? 'optional' : 'unknown') : 'unknown', requirement: null }
  }

  function projectSchoolScheduleItem(item, classification) {
    return compactObject({
      kind: classification.kind,
      courseCode: text(item?.courseCode || item?.code, 120),
      title: text(item?.title || item?.courseName, 320),
      classId: text(item?.classId, 160),
      className: text(item?.className, 320),
      credits: finite(item?.credits),
      nature: text(item?.nature, 160),
      category: text(item?.category, 160),
      affiliation: text(item?.affiliation, 160),
      teacher: text(item?.teacher, 240),
      time: text(item?.time, 320),
      location: text(item?.location, 240),
      requirement: classification.requirement,
    })
  }

  function buildCourseAnalysis({ analysis, state, revision, queryText, maximum, requestedTermId }) {
    const flattened = flattenAcademicRequirements(analysis.requirements.roots)
    const categories = flattened
      .filter(({ path }) => path.length === 2)
      .map(({ node }) => compactObject({
        title: text(node.title, 240),
        category: text(node.title, 240),
        required: finite(node.required),
        earned: finite(node.earned),
        remaining: finite(node.remaining),
        confidence: controlled(node.confidence, 'unknown'),
        status: controlled(node.status, 'unknown'),
        priority: /选修|任选/u.test(node.title || '') ? 'optional' : 'required',
      }))
      .filter((item) => item.remaining > 0 || matches(item, queryText))
      .sort((left, right) => (left.priority === 'required' ? -1 : 1) - (right.priority === 'required' ? -1 : 1)
        || Number(right.remaining || 0) - Number(left.remaining || 0))

    const gaps = []
    for (const { node, path } of flattened) {
      for (const allocation of Array.isArray(node.allocations) ? node.allocations : []) {
        if (allocation.status === 'earned') continue
        const gap = projectRequirementGap(allocation, path, revision)
        if (!gap.title && !gap.courseCode) continue
        if (matches(gap, queryText)) gaps.push(gap)
      }
    }
    const kindOrder = { 'must-retake': 0, 'required-unfinished': 1, 'optional-unfinished': 2, unknown: 3 }
    gaps.sort((left, right) => (kindOrder[left.kind] ?? 9) - (kindOrder[right.kind] ?? 9)
      || String(left.recommendedYear || '').localeCompare(String(right.recommendedYear || ''))
      || String(left.title || '').localeCompare(String(right.title || '')))

    const failedCourses = analysis.courses
      .filter((course) => course.status === 'failed')
      .map((course) => compactObject({
        courseCode: text(course.courseCode, 120),
        title: text(course.courseName, 320),
        credits: finite(course.attempts?.find((attempt) => attempt.credits != null)?.credits),
        attemptCount: course.attemptCount,
        isRetake: course.isRetake,
        attempts: (Array.isArray(course.attempts) ? course.attempts : []).slice(-4).map((attempt) => compactObject({
          termId: text(attempt.termId, 80), score: text(attempt.score, 80), outcome: controlled(attempt.outcome, 'unknown'),
        })),
      }))
      .filter((course) => matches(course, queryText))
      .slice(0, maximum)

    const requirementByCode = new Map()
    const requirementByTitle = new Map()
    for (const gap of gaps) {
      const map = gap.courseCode ? requirementByCode : requirementByTitle
      const key = gap.courseCode ? normalizedCourseCode(gap.courseCode) : normalizedCourseTitle(gap.title)
      if (key && !map.has(key)) map.set(key, gap)
    }
    const scheduleRecords = Object.values(state.dataCatalog?.collections?.schoolSchedule?.records || {})
    const usableRecords = scheduleRecords.filter((record) => Array.isArray(record?.items))
    const availableTerms = [...new Set(usableRecords.map((record) => String(record?.scope?.termId || '').trim()).filter(Boolean))]
    const termId = String(requestedTermId || '').trim() || [...availableTerms].sort((left, right) => termRank(right) - termRank(left))[0] || null
    const scheduleRecord = usableRecords.find((record) => String(record?.scope?.termId || '').trim() === termId)
    const scheduleItems = Array.isArray(scheduleRecord?.items) ? scheduleRecord.items : []
    const candidates = scheduleItems
      .map((item) => ({ item, classification: scheduleKind(item, requirementByCode, requirementByTitle, flattened.length > 0) }))
      .filter(({ item }) => !queryText || matches(item, queryText))
      .sort((left, right) => (kindOrder[left.classification.kind] ?? 4) - (kindOrder[right.classification.kind] ?? 4)
        || String(left.item?.courseCode || '').localeCompare(String(right.item?.courseCode || ''))
        || String(left.item?.classId || '').localeCompare(String(right.item?.classId || '')))
    const uniqueCourses = []
    const seenCourseKeys = new Set()
    for (const candidate of candidates) {
      const key = normalizedCourseCode(candidate.item?.courseCode || candidate.item?.code)
        || normalizedCourseTitle(candidate.item?.title || candidate.item?.courseName)
      if (!key || seenCourseKeys.has(key)) continue
      seenCourseKeys.add(key)
      uniqueCourses.push(candidate)
    }
    const projectedCandidates = uniqueCourses.slice(0, maximum)
      .map(({ item, classification }) => projectSchoolScheduleItem(item, classification))

    return {
      schema: 'theia-course-analysis/v1',
      query: queryText || null,
      requirementSummary: {
        source: analysis.requirements.source,
        root: analysis.requirements.roots[0]
          ? compactObject({
            title: text(analysis.requirements.roots[0].title, 240),
            required: finite(analysis.requirements.roots[0].required),
            earned: finite(analysis.requirements.roots[0].earned),
            remaining: finite(analysis.requirements.roots[0].remaining),
            confidence: controlled(analysis.requirements.roots[0].confidence, 'unknown'),
          })
          : null,
        categories: categories.slice(0, Math.max(maximum, 8)),
      },
      gaps: gaps.slice(0, maximum),
      failedCourses,
      schoolSchedule: {
        termId,
        availableTerms: availableTerms.slice(0, 12),
        recordAvailable: Boolean(scheduleRecord),
        totalClasses: scheduleItems.length,
        candidates: projectedCandidates,
      },
    }
  }

  return Object.freeze({ buildCourseAnalysis, projectAcademicAnalysis })
}
