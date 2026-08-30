import { canonicalDigest, shortDigest, uniqueSorted } from './canonical.mjs'
import {
  addKnown,
  academicRisk,
  arrayValue,
  finiteNonNegative,
  fixed,
  localClaim,
  minimumConfidence,
  qualityConfidence,
  registerEvidence,
  signedUnits,
  subtractKnown,
  text,
} from './academic-utils.mjs'

export const ADVISOR_ACADEMIC_RULE_SCHEMA = 'theia-advisor-academic-rule/v1'

function normalizeUpgradeRule(rawRule) {
  if (rawRule === null || rawRule === undefined) return null
  const rule = rawRule && typeof rawRule === 'object' && !Array.isArray(rawRule) ? rawRule : {}
  const thresholdCredits = fixed(finiteNonNegative(rule.thresholdCredits))
  const rulesVersion = text(rule.rulesVersion || rule.version)
  if (thresholdCredits === null) throw new TypeError('upgradeRule.thresholdCredits must be a non-negative number')
  if (!rulesVersion) throw new TypeError('upgradeRule.rulesVersion must be a non-empty string')
  const sourceKind = text(rule.sourceKind).toLowerCase() === 'official' ? 'official' : 'configuration'
  const sourceLabel = text(rule.sourceLabel) || (sourceKind === 'official' ? '' : '当前规则配置')
  if (sourceKind === 'official' && !sourceLabel) throw new TypeError('Official upgradeRule requires sourceLabel')
  return {
    schema: ADVISOR_ACADEMIC_RULE_SCHEMA,
    id: text(rule.id) || 'upgrade-line',
    rulesVersion,
    sourceKind,
    sourceLabel,
    thresholdCredits,
    requirementIds: uniqueSorted(arrayValue(rule.requirementIds).map(text).filter(Boolean)),
    earnedCredits: fixed(finiteNonNegative(rule.earnedCredits)),
  }
}

function overlappingRequirements(nodes) {
  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) {
      const a = nodes[left].path.join('.')
      const b = nodes[right].path.join('.')
      if (a.startsWith(`${b}.`) || b.startsWith(`${a}.`)) return true
    }
  }
  return false
}

export function evaluateUpgrade(ruleInput, requirements, { registry, quality, rulesVersion, claims, risks }) {
  const rule = normalizeUpgradeRule(ruleInput)
  if (!rule) return { status: 'not-configured', rule: null, threshold: null, earned: null, distance: null, evidenceRefs: [], claimIds: [], issues: ['upgrade-rule-not-configured'] }
  const ruleFields = ['thresholdCredits', 'rulesVersion', 'sourceKind', 'sourceLabel', 'requirementIds', 'earnedCredits']
  const ruleEvidence = registerEvidence(registry, {
    dataset: 'academic-rule', domain: 'academic-progress', entityId: rule.id, fields: ruleFields,
    capturedAt: null, source: 'local-config', label: rule.sourceLabel, evidenceDigest: canonicalDigest(rule),
  })
  const thresholdClaim = localClaim(registry, {
    kind: 'fact', subject: `academic-rule:${shortDigest(rule.id, 16)}`, predicate: 'upgrade-credit-threshold',
    value: { type: 'number', value: rule.thresholdCredits, unit: 'credit' }, displayText: `${rule.sourceLabel}门槛 ${rule.thresholdCredits} 学分`,
    evidenceRefs: [ruleEvidence.id], confidence: rule.sourceKind === 'official' ? 'high' : 'medium',
    caveats: rule.sourceKind === 'official' ? [] : ['这是版本化的当前规则配置，不代表已核验的最终校规'], fields: ['thresholdCredits', 'rulesVersion', 'sourceKind'], rulesVersion,
  })
  claims.push(thresholdClaim)

  const issues = []
  let earned = rule.earnedCredits
  let earnedRefs = rule.earnedCredits !== null ? [ruleEvidence.id] : []
  if (earned === null && rule.requirementIds.length) {
    const targets = rule.requirementIds.map((id) => requirements.byId.get(id)).filter(Boolean)
    if (targets.length !== rule.requirementIds.length) issues.push('upgrade-requirement-id-missing')
    else if (overlappingRequirements(targets)) issues.push('upgrade-requirement-scope-overlaps')
    else {
      earned = addKnown(targets.map((node) => node.credits.earned))
      earnedRefs = uniqueSorted(targets.flatMap((node) => node.credits.evidenceRefs))
      if (earned === null) issues.push('upgrade-earned-credits-unknown')
    }
  } else if (earned === null) {
    earned = requirements.summary.earned
    earnedRefs = requirements.summary.evidenceRefs
    if (earned === null) issues.push('upgrade-earned-credits-unknown')
  }
  if (issues.length || earned === null || !earnedRefs.length) {
    return {
      status: 'unknown', rule, threshold: rule.thresholdCredits, earned: null, distance: null,
      evidenceRefs: [ruleEvidence.id], claimIds: [thresholdClaim.id], issues: uniqueSorted(issues),
    }
  }

  const earnedFromRequirements = rule.earnedCredits === null
  const inputCaveats = earnedFromRequirements ? requirements.caveats : []
  const earnedClaim = localClaim(registry, {
    subject: `academic-rule:${shortDigest(rule.id, 16)}`, predicate: 'upgrade-counted-earned-credits',
    value: { type: 'number', value: earned, unit: 'credit' }, displayText: `该规则计入的已获学分 ${earned}`,
    evidenceRefs: earnedRefs, confidence: qualityConfidence(quality), caveats: uniqueSorted([
      ...(rule.sourceKind === 'official' ? [] : ['按当前规则配置的计入范围计算']),
      ...inputCaveats,
    ]),
    fields: ['earned', ...rule.requirementIds], rulesVersion,
  })
  const distance = subtractKnown(rule.thresholdCredits, earned)
  const remaining = subtractKnown(rule.thresholdCredits, earned, { floorAtZero: true })
  const distanceClaim = localClaim(registry, {
    subject: `academic-rule:${shortDigest(rule.id, 16)}`, predicate: 'upgrade-credit-distance',
    value: { type: 'number', value: distance, unit: 'credit' }, displayText: `距该规则门槛的算术差为 ${distance} 学分`,
    evidenceRefs: uniqueSorted([ruleEvidence.id, ...earnedRefs]), confidence: minimumConfidence(thresholdClaim.confidence, earnedClaim.confidence),
    caveats: ['这只是版本化规则下的算术差，不是升级、毕业或学籍结论', ...inputCaveats], fields: ['thresholdCredits', 'earned'], rulesVersion,
  })
  claims.push(earnedClaim, distanceClaim)
  if (signedUnits(remaining) > 0 && (!earnedFromRequirements || requirements.confirmed)) {
    risks.push(academicRisk({
      kind: 'upgrade-credit-gap', entityId: rule.id, severity: 'attention', title: '当前记录低于配置的学分门槛',
      why: [`按${rule.sourceLabel}仍有 ${remaining} 学分的算术缺口`], evidenceRefs: distanceClaim.evidenceRefs,
      claimIds: [thresholdClaim.id, earnedClaim.id, distanceClaim.id], confidence: distanceClaim.confidence,
      caveats: distanceClaim.caveats,
      domain: 'academic-progress', quality, actionable: true,
      suggestedAction: '查看学分门槛与当前计入范围', actionKind: 'review-academic-gap', rulesVersion,
    }))
  }
  return {
    status: 'known', rule, threshold: rule.thresholdCredits, earned, distance, remaining,
    arithmeticAtOrAbove: signedUnits(distance) <= 0,
    evidenceRefs: distanceClaim.evidenceRefs,
    claimIds: [thresholdClaim.id, earnedClaim.id, distanceClaim.id],
    issues: [],
  }
}
