import { gpaEligibilityReason } from '../gpa.mjs'
import { buildAcademicAnalysis } from '../academic-model.mjs'
import { uniqueSorted } from './canonical.mjs'
import {
  academicRisk,
  finiteNonNegative,
  fixed,
  formatUnits,
  localClaim,
  minimumConfidence,
  qualityConfidence,
  registerEvidence,
  signedUnits,
} from './academic-utils.mjs'

function validGpa(value) {
  const number = finiteNonNegative(value)
  return number !== null && number <= 4.33 ? fixed(number, 10_000) : null
}

function gpaBoundary(grades) {
  const exclusions = {
    'explicitly-excluded': 0,
    'policy-excluded': 0,
    'non-numeric-mark': 0,
    'missing-or-invalid-credits': 0,
    'missing-point-or-numeric-score': 0,
  }
  for (const grade of grades) {
    const reason = gpaEligibilityReason(grade)
    if (reason) exclusions[reason] += 1
  }
  const incomplete = exclusions['missing-or-invalid-credits'] + exclusions['missing-point-or-numeric-score']
  return { exclusions, incompleteRows: incomplete, completeness: incomplete ? 'partial' : 'complete' }
}

export function evaluateGpa(state, { registry, dataQuality, rulesVersion, claims, risks }) {
  const progressQuality = dataQuality.domains?.['academic-progress']
  const profileQuality = dataQuality.domains?.profile
  const gradesQuality = dataQuality.domains?.grades
  const sources = {}
  const academicValue = validGpa(state.academicProgress?.gpa)
  if (academicValue !== null) {
    const evidence = registerEvidence(registry, {
      dataset: 'academic-progress-gpa',
      domain: 'academic-progress',
      entityId: 'academic-progress-gpa',
      fields: ['gpa'],
      capturedAt: progressQuality?.capturedAt || state.academicProgress?.capturedAt || null,
      source: progressQuality?.source?.[0] || 'jwglxt',
      label: '学校学业进度 GPA',
    })
    const claim = localClaim(registry, {
      kind: 'fact', subject: 'academic-gpa', predicate: 'school-progress-gpa',
      value: { type: 'number', value: academicValue, unit: 'gpa' },
      displayText: `学校学业进度 GPA ${academicValue}`,
      evidenceRefs: [evidence.id], confidence: qualityConfidence(progressQuality), fields: ['gpa'], rulesVersion,
    })
    claims.push(claim)
    sources.academicProgress = { value: academicValue, evidenceRefs: [evidence.id], claimId: claim.id, confidence: claim.confidence }
  }
  const profileValue = validGpa(state.profile?.gpa)
  if (profileValue !== null) {
    const evidence = registerEvidence(registry, {
      dataset: 'profile-gpa', domain: 'profile', entityId: 'profile-gpa', fields: ['gpa'],
      capturedAt: profileQuality?.capturedAt || null, source: profileQuality?.source?.[0] || 'jwglxt', label: '学校档案 GPA',
    })
    const claim = localClaim(registry, {
      kind: 'fact', subject: 'academic-gpa', predicate: 'school-profile-gpa',
      value: { type: 'number', value: profileValue, unit: 'gpa' }, displayText: `学校档案 GPA ${profileValue}`,
      evidenceRefs: [evidence.id], confidence: qualityConfidence(profileQuality), fields: ['gpa'], rulesVersion,
    })
    claims.push(claim)
    sources.profile = { value: profileValue, evidenceRefs: [evidence.id], claimId: claim.id, confidence: claim.confidence }
  }

  const grades = Array.isArray(state.grades) ? state.grades : []
  const academicAnalysis = buildAcademicAnalysis({
    grades,
    courses: state.courses,
    progress: state.academicProgress,
  })
  const local = {
    gpa: academicAnalysis.gpa.computedValue,
    credits: academicAnalysis.gpa.credits,
    included: academicAnalysis.gpa.includedCourses,
  }
  const boundary = gpaBoundary(grades)
  const localValue = validGpa(local.gpa)
  let localEvidence = null
  if (grades.length) {
    localEvidence = registerEvidence(registry, {
      dataset: 'grades-gpa', domain: 'grades', entityId: 'local-gpa-calculation',
      fields: ['credits', 'point', 'score', 'gpaIncluded', 'category', 'nature', 'courseCategory', 'courseName', 'courseCode', 'courseId', 'id', 'termId', 'remark', 'status'],
      capturedAt: gradesQuality?.capturedAt || null, source: gradesQuality?.source?.[0] || 'jwglxt', label: '本地 GPA 计算输入',
    })
  }
  if (localValue !== null && localEvidence) {
    const claim = localClaim(registry, {
      subject: 'academic-gpa', predicate: 'local-gpa',
      value: { type: 'number', value: localValue, unit: 'gpa' }, displayText: `本地辅助 GPA ${localValue}`,
      evidenceRefs: [localEvidence.id], confidence: minimumConfidence(qualityConfidence(gradesQuality), boundary.completeness === 'complete' ? 'medium' : 'low'),
      caveats: ['本地 GPA 仅为当前固定计算规则的辅助值，不替代学校口径', ...(boundary.completeness === 'partial' ? ['部分成绩缺少 credits、point 或可解析数值成绩'] : [])],
      fields: ['computeGpa', 'eligibility-boundary'], rulesVersion,
    })
    claims.push(claim)
    sources.local = { value: localValue, evidenceRefs: [localEvidence.id], claimId: claim.id, confidence: claim.confidence }
  }

  let discrepancy = null
  if (academicValue !== null && profileValue !== null && academicValue !== profileValue) {
    const difference = formatUnits(Math.abs(signedUnits(academicValue, 10_000) - signedUnits(profileValue, 10_000)), 10_000)
    const evidenceRefs = uniqueSorted([...sources.academicProgress.evidenceRefs, ...sources.profile.evidenceRefs])
    const claim = localClaim(registry, {
      subject: 'academic-gpa', predicate: 'school-gpa-discrepancy',
      value: { type: 'number', value: difference, unit: 'gpa' }, displayText: `两个学校 GPA 来源相差 ${difference}`,
      evidenceRefs, confidence: minimumConfidence(sources.academicProgress.confidence, sources.profile.confidence),
      caveats: ['差异只表示两个学校页面当前记录不一致，不推断哪一个最终有效'], fields: ['academicProgress.gpa', 'profile.gpa'], rulesVersion,
    })
    claims.push(claim)
    discrepancy = { state: 'present', difference, evidenceRefs, claimId: claim.id }
    risks.push(academicRisk({
      kind: 'gpa-discrepancy', entityId: 'school-gpa', severity: 'attention', title: '学校 GPA 来源不一致',
      why: [`学业进度页与档案页记录相差 ${difference}`], evidenceRefs, claimIds: [sources.academicProgress.claimId, sources.profile.claimId, claim.id],
      confidence: claim.confidence, caveats: claim.caveats,
      domain: 'academic-progress', quality: progressQuality, actionable: false,
      suggestedAction: '打开学校来源详情并核对 GPA 记录', actionKind: 'open-source-detail', rulesVersion,
    }))
  } else if (academicValue !== null && profileValue !== null) {
    discrepancy = { state: 'absent', difference: '0.0000', evidenceRefs: uniqueSorted([...sources.academicProgress.evidenceRefs, ...sources.profile.evidenceRefs]), claimId: null }
  } else {
    discrepancy = { state: 'unknown', difference: null, evidenceRefs: [], claimId: null }
  }

  const selectedSource = sources.academicProgress ? 'academicProgress' : sources.profile ? 'profile' : sources.local ? 'local' : null
  return {
    selectedSource,
    selected: selectedSource ? sources[selectedSource] : null,
    sources,
    discrepancy,
    localBoundary: {
      value: localValue,
      includedCredits: fixed(local.credits),
      includedCourses: local.included,
      completeness: boundary.completeness,
      exclusions: boundary.exclusions,
      evidenceRefs: localEvidence ? [localEvidence.id] : [],
      claimId: sources.local?.claimId || null,
    },
    issues: uniqueSorted([
      state.academicProgress?.gpa != null && academicValue === null ? 'academic-progress-gpa-invalid' : null,
      state.profile?.gpa != null && profileValue === null ? 'profile-gpa-invalid' : null,
      boundary.completeness === 'partial' ? 'local-gpa-input-partial' : null,
    ]),
  }
}
