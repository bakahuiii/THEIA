import { compareCanonicalText, uniqueSorted } from './canonical.mjs'
import { normalizeAdvisorOptions, normalizeVersionedSnapshot } from './contracts.mjs'
import { decorateRequirements } from './academic-evidence.mjs'
import { evaluateFailures } from './academic-failures.mjs'
import { evaluateGpa } from './academic-gpa.mjs'
import { analyzeAcademicRequirements } from './academic-requirements.mjs'
import { evaluateScenario } from './academic-scenario.mjs'
import { ADVISOR_ACADEMIC_RULE_SCHEMA, evaluateUpgrade } from './academic-upgrade.mjs'
import { academicRisk, minimumConfidence, qualityConfidence, signedUnits } from './academic-utils.mjs'

export const ADVISOR_ACADEMIC_SCHEMA = 'theia-advisor-academic/v1'
export { ADVISOR_ACADEMIC_RULE_SCHEMA }
export { analyzeAcademicRequirements }

export function evaluateAcademic(versionedSnapshot, {
  dataQuality,
  evidenceRegistry,
  upgradeRule = null,
  scenario = null,
  ...options
} = {}) {
  if (!dataQuality || !evidenceRegistry) throw new TypeError('dataQuality and evidenceRegistry are required')
  const versioned = normalizeVersionedSnapshot(versionedSnapshot)
  const normalizedOptions = normalizeAdvisorOptions(options)
  if (dataQuality.snapshotRevision !== versioned.revision) throw new TypeError('dataQuality snapshot revision mismatch')
  if (dataQuality.rulesVersion !== normalizedOptions.rulesVersion) throw new TypeError('dataQuality rules version mismatch')
  if (evidenceRegistry.snapshotRevision !== versioned.revision) throw new TypeError('evidenceRegistry snapshot revision mismatch')
  if (evidenceRegistry.rulesVersion !== normalizedOptions.rulesVersion) throw new TypeError('evidenceRegistry rules version mismatch')

  const state = versioned.snapshot
  const claims = []
  const risks = []
  const progressQuality = dataQuality.domains?.['academic-progress']
  const rawRequirements = analyzeAcademicRequirements(state.academicProgress, { dataQuality: progressQuality })
  const requirements = decorateRequirements(rawRequirements, {
    registry: evidenceRegistry,
    quality: progressQuality,
    rulesVersion: normalizedOptions.rulesVersion,
    claims,
  })
  if (requirements.confirmed && requirements.summary.remaining !== null && signedUnits(requirements.summary.remaining) > 0 && requirements.summary.claimId) {
    risks.push(academicRisk({
      kind: 'academic-plan-gap', entityId: 'academic-plan', severity: 'attention', title: '培养方案仍有可计算的学分缺口',
      why: [`当前可计算缺口为 ${requirements.summary.remaining} 学分`], evidenceRefs: requirements.summary.evidenceRefs,
      claimIds: [requirements.summary.claimId], confidence: minimumConfidence(qualityConfidence(dataQuality.domains?.['academic-progress']), requirements.completeness === 'complete' ? 'high' : 'medium'),
      caveats: requirements.source === 'categories' ? ['仅有扁平 categories，不能将多个类别直接累加'] : [],
      domain: 'academic-progress', quality: progressQuality, actionable: true,
      suggestedAction: '查看培养方案缺口并确认下一步修读安排', actionKind: 'review-academic-gap', rulesVersion: normalizedOptions.rulesVersion,
    }))
  }

  const gpa = evaluateGpa(state, {
    registry: evidenceRegistry, dataQuality, rulesVersion: normalizedOptions.rulesVersion, claims, risks,
  })
  const upgrade = evaluateUpgrade(upgradeRule, requirements, {
    registry: evidenceRegistry, quality: progressQuality, rulesVersion: normalizedOptions.rulesVersion, claims, risks,
  })
  const failures = evaluateFailures(state, requirements, {
    registry: evidenceRegistry, quality: dataQuality.domains?.grades, rulesVersion: normalizedOptions.rulesVersion, claims, risks,
  })
  const scenarioResult = evaluateScenario(scenario, state, requirements, {
    registry: evidenceRegistry, quality: progressQuality, rulesVersion: normalizedOptions.rulesVersion, claims,
  })
  const sortedClaims = claims.sort((left, right) => compareCanonicalText(left.id, right.id))
  const sortedRisks = risks.sort((left, right) => compareCanonicalText(left.id, right.id))
  const referencedEvidence = uniqueSorted([
    ...sortedClaims.flatMap((claim) => claim.evidenceRefs),
    ...sortedRisks.flatMap((risk) => risk.evidenceRefs),
    ...(scenarioResult?.evidenceRefs || []),
  ])
  const publicRequirements = { ...requirements, byId: undefined }
  delete publicRequirements.byId
  return {
    schema: ADVISOR_ACADEMIC_SCHEMA,
    snapshotRevision: versioned.revision,
    evaluatedAt: normalizedOptions.now,
    timeZone: normalizedOptions.timeZone,
    rulesVersion: normalizedOptions.rulesVersion,
    analysis: {
      requirements: publicRequirements,
      gpa,
      upgrade,
      failures,
      scenario: scenarioResult,
    },
    claims: sortedClaims,
    risks: sortedRisks,
    evidence: referencedEvidence.map((id) => evidenceRegistry.get(id)),
  }
}
