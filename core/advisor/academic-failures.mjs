import { compareCanonicalText, shortDigest, uniqueSorted } from './canonical.mjs'
import {
  academicRisk,
  arrayValue,
  EXPLICIT_FAILURE,
  finiteNonNegative,
  fixed,
  localClaim,
  qualityConfidence,
  registerEvidence,
  text,
} from './academic-utils.mjs'

function normalizedCourseCode(value) {
  return text(value).replace(/\s+/g, '').toUpperCase()
}

function normalizedCourseTitle(value) {
  return text(value).replace(/\s+/g, '').toUpperCase()
}

function optionalFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function gradeIsExplicitFailure(grade) {
  const descriptor = [grade?.score, grade?.remark, grade?.status, grade?.studyStatus].filter(Boolean).join(' ')
  if (EXPLICIT_FAILURE.test(descriptor)) return true
  const score = text(grade?.score).toUpperCase()
  if (score === 'F' || score === 'U') return true
  if (score) {
    const numeric = Number(score)
    if (Number.isFinite(numeric)) return numeric < 60
  }
  const point = optionalFiniteNumber(grade?.point)
  return Number.isFinite(point) && point === 0 && Boolean(descriptor)
}

export function evaluateFailures(state, requirements, { registry, quality, rulesVersion, claims, risks }) {
  const nodes = requirements.nodes
  const byCode = new Map()
  const byTitle = new Map()
  for (const node of nodes) {
    for (const course of node.courses) {
      if (course.courseCode) {
        const values = byCode.get(course.courseCode) || []
        values.push(node)
        byCode.set(course.courseCode, values)
      }
      const titleKey = normalizedCourseTitle(course.title)
      if (titleKey) {
        const values = byTitle.get(titleKey) || []
        values.push(node)
        byTitle.set(titleKey, values)
      }
    }
  }
  const results = []
  for (const [index, grade] of arrayValue(state.grades).entries()) {
    if (!gradeIsExplicitFailure(grade)) continue
    const rawEntityId = text(grade?.id) || `${normalizedCourseCode(grade?.courseCode || grade?.courseId)}:${text(grade?.termId)}:${index}`
    const publicEntityId = `failed-grade:${shortDigest(rawEntityId, 16)}`
    const gradeEvidence = registerEvidence(registry, {
      dataset: 'grade', domain: 'grades', entityId: rawEntityId, fields: ['courseCode', 'courseId', 'courseName', 'title', 'credits', 'score', 'point', 'remark', 'status', 'requirementId'],
      capturedAt: quality?.capturedAt || null, source: quality?.source?.[0] || 'jwglxt', label: text(grade?.courseName || grade?.title) || '不及格成绩记录',
    })
    const explicitRequirementId = text(grade?.requirementId)
    const code = normalizedCourseCode(grade?.courseCode || grade?.courseId || grade?.code)
    const titleKey = normalizedCourseTitle(grade?.courseName || grade?.title)
    let matches = explicitRequirementId && requirements.byId.has(explicitRequirementId) ? [requirements.byId.get(explicitRequirementId)] : []
    let matchBasis = matches.length ? 'explicit-requirement-id' : null
    if (!matches.length && code && byCode.has(code)) {
      matches = byCode.get(code)
      matchBasis = 'course-code'
    }
    const nameCandidates = !matches.length && titleKey ? (byTitle.get(titleKey) || []) : []
    const relationStatus = matches.length ? 'known' : 'unknown'
    if (!matchBasis) matchBasis = nameCandidates.length ? 'course-name' : 'none'
    const requirementRefs = matches.flatMap((node) => node.evidenceRefs)
    const evidenceRefs = uniqueSorted([gradeEvidence.id, ...requirementRefs, ...nameCandidates.flatMap((node) => node.evidenceRefs)])
    const recordedCredits = fixed(finiteNonNegative(grade?.credits))
    let creditClaimId = null
    if (recordedCredits !== null) {
      const claim = localClaim(registry, {
        kind: 'fact', subject: publicEntityId, predicate: 'failed-course-recorded-credits',
        value: { type: 'number', value: recordedCredits, unit: 'credit' }, displayText: `该不及格记录的课程学分为 ${recordedCredits}`,
        evidenceRefs: [gradeEvidence.id], confidence: qualityConfidence(quality),
        caveats: relationStatus === 'known' ? [] : ['课程学分已知，但其对具体培养方案节点的影响尚不能确认'], fields: ['credits'], rulesVersion,
      })
      claims.push(claim)
      creditClaimId = claim.id
    }
    const result = {
      id: `failure:${shortDigest({ entityId: rawEntityId, rulesVersion }, 16)}`,
      courseCode: code || null,
      title: text(grade?.courseName || grade?.title) || null,
      relationStatus,
      matchBasis,
      requirementIds: matches.map((node) => node.id).sort(compareCanonicalText),
      candidateRequirementIds: nameCandidates.map((node) => node.id).sort(compareCanonicalText),
      recordedCredits,
      evidenceRefs,
      claimIds: creditClaimId ? [creditClaimId] : [],
      caveats: relationStatus === 'known' ? [] : [matchBasis === 'course-name'
        ? '课程名称相同只能作为候选关联，不能视为官方培养方案关系'
        : '当前记录没有课程号或显式培养方案节点关联'],
    }
    results.push(result)
    risks.push(academicRisk({
      kind: relationStatus === 'known' ? 'failed-course-known-requirement' : 'failed-course-relation-unknown',
      entityId: publicEntityId, severity: relationStatus === 'known' ? 'attention' : 'info',
      title: relationStatus === 'known' ? '不及格记录与培养方案节点存在明确关联' : '不及格记录的培养方案影响尚不能确认',
      why: relationStatus === 'known' ? [`通过${matchBasis === 'course-code' ? '课程号' : '显式节点 ID'}关联到培养方案`] : ['未找到可作为确定事实的课程号或显式节点关联'],
      evidenceRefs, claimIds: result.claimIds, confidence: relationStatus === 'known' ? qualityConfidence(quality) : 'unknown', caveats: result.caveats,
      domain: 'grades', quality, actionable: false,
      suggestedAction: '打开成绩来源详情并核对不及格记录与培养方案关系', actionKind: 'open-source-detail', rulesVersion,
    }))
  }
  return results.sort((left, right) => compareCanonicalText(left.id, right.id))
}
