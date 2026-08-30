import { uniqueSorted } from './canonical.mjs'
import { flattenRequirements } from './academic-requirements.mjs'
import {
  localClaim,
  minimumConfidence,
  qualityConfidence,
  registerEvidence,
  requirementSubject,
  text,
  weakerCompleteness,
} from './academic-utils.mjs'

function decorateRequirements(requirements, { registry, quality, rulesVersion, claims }) {
  const decoratedById = new Map()
  const decorateNode = (node) => {
    const children = node.children.map(decorateNode)
    const fields = uniqueSorted([...node.inputFields, ...(node.courses.length ? ['courses'] : [])])
    const evidence = registerEvidence(registry, {
      dataset: 'academic-requirement',
      domain: 'academic-progress',
      entityId: node.id,
      fields: fields.length ? fields : ['relation'],
      capturedAt: quality?.capturedAt || null,
      source: quality?.source?.[0] || 'jwglxt',
      label: node.title,
    })
    const childById = new Map(children.map((child) => [child.id, child]))
    const contributingRefs = node.credits.contributingNodeIds.flatMap((id) => childById.get(id)?.credits.evidenceRefs || decoratedById.get(id)?.credits.evidenceRefs || [])
    const ownRefs = [evidence.id]
    const refsFor = (field) => {
      if (node.credits.remainingSource === 'children' || (node.credits[field] !== null && !node.inputFields.includes(field))) {
        return uniqueSorted([...ownRefs, ...contributingRefs])
      }
      return ownRefs
    }
    const structuralCompleteness = node.completeness
    const effectiveCompleteness = weakerCompleteness(structuralCompleteness, requirements.completeness)
    const nodeCaveats = uniqueSorted([
      ...requirements.caveats,
      structuralCompleteness === 'complete' ? null : '培养方案节点存在不完整或未选择的替代分支',
    ])
    const creditClaims = {}
    for (const [field, predicate, label] of [
      ['required', 'required-credits', '要求学分'],
      ['earned', 'earned-credits', '已获学分'],
      ['remaining', 'remaining-credits', '尚缺学分'],
    ]) {
      const value = node.credits[field]
      if (value === null) continue
      const evidenceRefs = refsFor(field)
      const claim = localClaim(registry, {
        subject: requirementSubject(node.id),
        predicate,
        value: { type: 'number', value, unit: 'credit' },
        displayText: `${node.title}${label} ${value}`,
        evidenceRefs,
        confidence: qualityConfidence(quality),
        caveats: nodeCaveats,
        fields: [field, node.credits.remainingSource],
        rulesVersion,
      })
      claims.push(claim)
      creditClaims[field] = claim.id
    }
    const decorated = {
      ...node,
      structuralCompleteness,
      completeness: effectiveCompleteness,
      caveats: nodeCaveats,
      credits: {
        ...node.credits,
        evidenceRefs: uniqueSorted([...ownRefs, ...contributingRefs]),
        claimIds: creditClaims,
      },
      evidenceRefs: [evidence.id],
      children,
    }
    decoratedById.set(node.id, decorated)
    return decorated
  }
  const roots = requirements.roots.map(decorateNode)
  const nodes = flattenRequirements(roots)
  const summaryRefs = uniqueSorted(requirements.summary.contributingNodeIds.flatMap((id) => decoratedById.get(id)?.credits.evidenceRefs || []))
  let summaryClaimId = null
  if (requirements.summary.remaining !== null && summaryRefs.length) {
    const claim = localClaim(registry, {
      subject: 'academic-plan',
      predicate: 'remaining-credits',
      value: { type: 'number', value: requirements.summary.remaining, unit: 'credit' },
      displayText: `当前培养方案算术缺口 ${requirements.summary.remaining} 学分`,
      evidenceRefs: summaryRefs,
      confidence: minimumConfidence(qualityConfidence(quality), requirements.completeness === 'complete' ? 'high' : 'medium'),
      caveats: requirements.caveats,
      fields: ['summary.remaining', requirements.summary.remainingSource],
      rulesVersion,
    })
    claims.push(claim)
    summaryClaimId = claim.id
  }
  return {
    ...requirements,
    summary: { ...requirements.summary, evidenceRefs: summaryRefs, claimId: summaryClaimId },
    roots,
    nodes,
    byId: decoratedById,
  }
}

export { decorateRequirements }
