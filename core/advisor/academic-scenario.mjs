import { canonicalDigest, shortDigest, uniqueSorted } from './canonical.mjs'
import { analyzeAcademicRequirements, normalizedSelections } from './academic-requirements.mjs'
import {
  finiteNonNegative,
  fixed,
  localClaim,
  minimumConfidence,
  objectValue,
  qualityConfidence,
  registerEvidence,
  subtractKnown,
} from './academic-utils.mjs'

export function evaluateScenario(rawScenario, state, baseRequirements, { registry, quality, rulesVersion, claims }) {
  if (rawScenario === null || rawScenario === undefined) return null
  const scenario = objectValue(rawScenario)
  const selections = normalizedSelections(scenario.alternativeSelections)
  const additional = fixed(finiteNonNegative(scenario.additionalRequiredCredits))
  const hasAdditional = additional !== null
  const hasSelections = Object.keys(selections).length > 0
  const specification = {
    additionalRequiredCredits: hasAdditional ? additional : null,
    alternativeSelections: selections,
  }
  const evidence = registerEvidence(registry, {
    dataset: 'academic-scenario', domain: 'academic-progress', entityId: `scenario:${shortDigest(specification, 16)}`,
    fields: ['additionalRequiredCredits', 'alternativeSelections'], capturedAt: null, source: 'local-scenario',
    label: '当前请求的纯算术学业情景', evidenceDigest: canonicalDigest(specification),
  })
  if (!hasAdditional && !hasSelections) {
    return { scenario: true, status: 'unknown', ...specification, baseRemaining: null, remaining: null, evidenceRefs: [evidence.id], claimId: null, issues: ['scenario-has-no-supported-operation'] }
  }
  const scenarioRequirements = analyzeAcademicRequirements(state.academicProgress, { alternativeSelections: selections, dataQuality: quality })
  const baseRemaining = scenarioRequirements.summary.remaining
  const contributingRefs = uniqueSorted(scenarioRequirements.summary.contributingNodeIds.flatMap((id) => baseRequirements.byId.get(id)?.credits.evidenceRefs || []))
  const remaining = baseRemaining === null ? null : hasAdditional
    ? subtractKnown(baseRemaining, additional, { floorAtZero: true })
    : baseRemaining
  const issues = uniqueSorted([
    ...scenarioRequirements.issues.filter((issue) => issue.startsWith('invalid-alternative-selection:')),
    remaining === null ? 'scenario-base-remaining-unknown' : null,
  ])
  const invalidSelection = issues.some((issue) => issue.startsWith('invalid-alternative-selection:'))
  if (invalidSelection || remaining === null || !contributingRefs.length) {
    return {
      scenario: true, status: 'unknown', ...specification, baseRemaining, remaining: null,
      evidenceRefs: uniqueSorted([evidence.id, ...contributingRefs]), claimId: null, issues,
    }
  }
  const evidenceRefs = uniqueSorted([evidence.id, ...contributingRefs])
  const claim = localClaim(registry, {
    subject: `academic-scenario:${shortDigest(specification, 16)}`, predicate: 'scenario-remaining-credits',
    value: { type: 'number', value: remaining, unit: 'credit' }, displayText: `该纯算术情景下尚缺 ${remaining} 学分`,
    evidenceRefs, confidence: minimumConfidence(qualityConfidence(quality), baseRequirements.completeness === 'complete' ? 'high' : 'medium'),
    caveats: ['情景不写回校园数据，也不保证学校最终认可或未来成绩', ...scenarioRequirements.caveats], fields: ['baseRemaining', 'additionalRequiredCredits', 'alternativeSelections'], rulesVersion, scenario: true,
  })
  claims.push(claim)
  return {
    scenario: true, status: 'known', ...specification, baseRemaining, remaining,
    evidenceRefs, claimId: claim.id, issues,
  }
}
