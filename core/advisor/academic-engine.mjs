import { gpaEligibilityReason } from '../gpa.mjs'
import { buildAcademicAnalysis } from '../academic-model.mjs'
import { canonicalDigest, compareCanonicalText, normalizeText, shortDigest, uniqueSorted } from './canonical.mjs'
import { normalizeAdvisorOptions, normalizeVersionedSnapshot } from './contracts.mjs'

export const ADVISOR_ACADEMIC_SCHEMA = 'theia-advisor-academic/v1'
export const ADVISOR_ACADEMIC_RULE_SCHEMA = 'theia-advisor-academic-rule/v1'

const LOCAL_CLAIM_SCHEMA = 'theia-advisor-local-claim/v1'
const CREDIT_SCALE = 10_000
const GPA_SCALE = 10_000
const CONFIDENCE_RANK = new Map([['unknown', 0], ['low', 1], ['medium', 2], ['high', 3]])
const COMPLETENESS_RANK = new Map([['unknown', 0], ['partial', 1], ['complete', 2]])
const EXPLICIT_FAILURE = /缺考|不合格|不及格|未通过|挂科|违纪|作弊|未修读通过/i

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function arrayValue(value) {
  return Array.isArray(value) ? value : []
}

function text(value) {
  return normalizeText(value, { trim: true })
}

function finiteNonNegative(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function optionalFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function signedUnits(value, scale = CREDIT_SCALE) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number * scale) : null
}

function formatUnits(units, scale = CREDIT_SCALE) {
  if (!Number.isSafeInteger(units)) return null
  const sign = units < 0 ? '-' : ''
  const absolute = Math.abs(units)
  const whole = Math.trunc(absolute / scale)
  const fraction = String(absolute % scale).padStart(String(scale).length - 1, '0')
  return `${sign}${whole}.${fraction}`
}

function fixed(value, scale = CREDIT_SCALE) {
  const units = signedUnits(value, scale)
  return units === null ? null : formatUnits(units, scale)
}

function addKnown(values, scale = CREDIT_SCALE) {
  const units = values.map((value) => signedUnits(value, scale))
  return units.some((value) => value === null) ? null : formatUnits(units.reduce((sum, value) => sum + value, 0), scale)
}

function subtractKnown(left, right, { floorAtZero = false, scale = CREDIT_SCALE } = {}) {
  const leftUnits = signedUnits(left, scale)
  const rightUnits = signedUnits(right, scale)
  if (leftUnits === null || rightUnits === null) return null
  return formatUnits(floorAtZero ? Math.max(0, leftUnits - rightUnits) : leftUnits - rightUnits, scale)
}

function minimumConfidence(...values) {
  const normalized = values.flat().filter((value) => CONFIDENCE_RANK.has(value))
  if (!normalized.length) return 'unknown'
  return normalized.sort((left, right) => CONFIDENCE_RANK.get(left) - CONFIDENCE_RANK.get(right))[0]
}

function qualityConfidence(quality) {
  if (!quality || quality.provenanceInferred) return 'unknown'
  if (['failed', 'auth-required'].includes(quality.lastAttempt?.status)) {
    return quality.lastAttempt?.retainedPrevious && quality.availability === 'available' ? 'low' : 'unknown'
  }
  if (quality.freshness === 'fresh' && quality.completeness === 'complete') return 'high'
  if (quality.freshness === 'fresh' || quality.availability === 'available') return 'medium'
  return 'unknown'
}

function qualitySummary(quality) {
  return {
    availability: quality?.availability || 'unknown',
    freshness: quality?.freshness || 'unknown',
    completeness: quality?.completeness || 'unknown',
    lastAttemptStatus: quality?.lastAttempt?.status || 'never',
  }
}

function weakerCompleteness(...values) {
  const normalized = values.flat().filter((value) => COMPLETENESS_RANK.has(value))
  if (!normalized.length) return 'unknown'
  return normalized.sort((left, right) => COMPLETENESS_RANK.get(left) - COMPLETENESS_RANK.get(right))[0]
}

function requirementSourceKind(source, requirementSource) {
  if (source === 'categories') return 'categories-fallback'
  if (source === 'none') return 'none'
  const normalized = text(requirementSource).toLowerCase()
  if (normalized.endsWith('inferred-tree')) return 'inferred-tree'
  if (normalized.endsWith('-tree-detail') || normalized.endsWith('-dom-tree') || normalized.endsWith('-embedded-tree')) return 'official-tree'
  return 'unknown-tree'
}

function requirementQuality(quality) {
  if (!quality) return null
  return {
    availability: quality.availability || 'unknown',
    freshness: quality.freshness || 'unknown',
    completeness: quality.completeness || 'unknown',
    capturedAt: quality.capturedAt || null,
    sourceSucceededAt: quality.sourceSucceededAt || null,
    source: arrayValue(quality.source).map(text).filter(Boolean),
    parserVersion: quality.parserVersion || null,
    provenanceInferred: quality.provenanceInferred === true,
    lastAttempt: {
      runId: quality.lastAttempt?.runId || null,
      status: quality.lastAttempt?.status || 'never',
      emptyConfirmed: quality.lastAttempt?.emptyConfirmed === true,
      retainedPrevious: quality.lastAttempt?.retainedPrevious === true,
      errorCode: quality.lastAttempt?.errorCode || null,
      attemptedAt: quality.lastAttempt?.attemptedAt || null,
      completedAt: quality.lastAttempt?.completedAt || null,
    },
  }
}

function requirementQualityAssessment(structuralCompleteness, sourceKind, quality) {
  const sourceCompleteness = ['inferred-tree', 'categories-fallback', 'unknown-tree'].includes(sourceKind)
    ? weakerCompleteness(structuralCompleteness, 'partial')
    : structuralCompleteness
  if (!quality) {
    return {
      completeness: sourceCompleteness,
      confirmed: false,
      caveats: uniqueSorted([
        sourceKind === 'inferred-tree' ? '培养方案层级由本地推断，不能视为官方完整树结构' : null,
        sourceKind === 'categories-fallback' ? '仅有扁平培养方案列表，不能确认类别重叠或完整层级' : null,
        sourceKind === 'unknown-tree' ? '培养方案树来源未标明，不能视为已核验的官方结构' : null,
      ]),
    }
  }

  const attemptStatus = quality.lastAttempt?.status || 'never'
  const retainedPrevious = quality.lastAttempt?.retainedPrevious === true
  let qualityCompleteness = quality.completeness || 'unknown'
  if (quality.availability !== 'available') qualityCompleteness = 'unknown'
  if (quality.freshness === 'stale') qualityCompleteness = weakerCompleteness(qualityCompleteness, 'partial')
  else if (quality.freshness !== 'fresh') qualityCompleteness = 'unknown'
  if (['failed', 'auth-required'].includes(attemptStatus)) {
    qualityCompleteness = retainedPrevious && quality.availability === 'available'
      ? weakerCompleteness(qualityCompleteness, 'partial')
      : 'unknown'
  } else if (attemptStatus !== 'succeeded') {
    qualityCompleteness = 'unknown'
  }
  if (retainedPrevious) qualityCompleteness = weakerCompleteness(qualityCompleteness, 'partial')

  const completeness = weakerCompleteness(sourceCompleteness, qualityCompleteness)
  const caveats = uniqueSorted([
    sourceKind === 'inferred-tree' ? '培养方案层级由本地推断，不能视为官方完整树结构' : null,
    sourceKind === 'categories-fallback' ? '仅有扁平培养方案列表，不能确认类别重叠或完整层级' : null,
    sourceKind === 'unknown-tree' ? '培养方案树来源未标明，不能视为已核验的官方结构' : null,
    quality.completeness === 'partial' ? '学业进度数据仅部分获取，当前数字只表示已获取记录的算术结果' : null,
    quality.completeness === 'unknown' ? '学业进度数据完整性未知，当前数字不能视为完整结论' : null,
    quality.freshness === 'stale' ? '学业进度数据已过期，当前数字来自旧快照' : null,
    quality.freshness === 'unknown' ? '无法确认学业进度数据是否仍然有效' : null,
    retainedPrevious ? '当前显示的是上次成功保留的数据' : null,
    attemptStatus === 'failed' ? '最近一次学业进度刷新失败' : null,
    attemptStatus === 'auth-required' ? '最近一次学业进度刷新需要重新登录' : null,
    structuralCompleteness === 'partial' ? '培养方案结构或学分字段不完整' : null,
    structuralCompleteness === 'unknown' ? '培养方案结构不足以计算完整学分结果' : null,
  ])
  return {
    completeness,
    confirmed: completeness === 'complete'
      && sourceKind === 'official-tree'
      && quality.availability === 'available'
      && quality.freshness === 'fresh'
      && quality.completeness === 'complete'
      && attemptStatus === 'succeeded'
      && !retainedPrevious,
    caveats,
  }
}

function normalizeRelation(value) {
  return text(value).toLowerCase() === 'or' ? 'or' : 'and'
}

function requirementId(node, path) {
  const explicit = text(node?.id)
  return explicit || `generated:${shortDigest({ path, title: text(node?.title) }, 16)}`
}

function normalizedSelections(value) {
  const entries = Object.entries(objectValue(value))
    .map(([key, selected]) => [text(key), text(selected)])
    .filter(([key, selected]) => key && selected)
    .sort(([left], [right]) => compareCanonicalText(left, right))
  return Object.fromEntries(entries)
}

function sumComponents(components, field) {
  if (!components.length) return null
  return addKnown(components.map((component) => component.credits[field]))
}

function aggregateRequirementChildren(parentId, children, selections) {
  if (!children.length) {
    return {
      required: null,
      earned: null,
      remaining: null,
      source: 'unknown',
      contributingNodeIds: [],
      alternatives: [],
      selectionStatus: 'not-applicable',
      selectedAlternativeId: null,
      issues: [],
    }
  }

  const alternatives = children.filter((child) => child.relation === 'or')
  const mandatory = children.filter((child) => child.relation !== 'or')
  let selected = null
  let selectionStatus = 'not-applicable'
  const issues = []
  if (alternatives.length === 1) {
    selected = alternatives[0]
    selectionStatus = 'single-path'
  } else if (alternatives.length > 1) {
    const selectedId = selections[parentId]
    selected = alternatives.find((child) => child.id === selectedId) || null
    selectionStatus = selected ? 'selected' : selectedId ? 'invalid' : 'unselected'
    issues.push(selectionStatus === 'invalid' ? `invalid-alternative-selection:${parentId}` : selectionStatus === 'unselected' ? `alternative-unselected:${parentId}` : null)
  }
  const components = alternatives.length > 1
    ? (selected ? [...mandatory, selected] : [])
    : [...mandatory, ...(selected ? [selected] : [])]
  const canAggregate = components.length > 0 && (alternatives.length <= 1 || selected)
  return {
    required: canAggregate ? sumComponents(components, 'required') : null,
    earned: canAggregate ? sumComponents(components, 'earned') : null,
    remaining: canAggregate ? sumComponents(components, 'remaining') : null,
    source: canAggregate ? 'children' : 'unknown',
    contributingNodeIds: canAggregate ? components.flatMap((component) => component.credits.contributingNodeIds.length
      ? component.credits.contributingNodeIds
      : [component.id]) : [],
    alternatives: alternatives.map((child) => ({
      id: child.id,
      title: child.title,
      remaining: child.credits.remaining,
      completeness: child.completeness,
    })),
    selectionStatus,
    selectedAlternativeId: selected?.id || null,
    issues: uniqueSorted(issues),
  }
}

function analyzeRequirementNode(rawNode, context, parentId, path, ancestors) {
  const node = objectValue(rawNode)
  const id = requirementId(node, path)
  const title = text(node.title) || '未命名培养方案节点'
  if (ancestors.has(node)) {
    return {
      id,
      title,
      parentId,
      relation: normalizeRelation(node.relation),
      path,
      completeness: 'unknown',
      issues: [`requirement-cycle:${id}`],
      inputFields: ['relation'],
      credits: { required: null, earned: null, remaining: null, remainingSource: 'unknown', contributingNodeIds: [] },
      alternatives: [],
      selectionStatus: 'not-applicable',
      selectedAlternativeId: null,
      courses: [],
      children: [],
    }
  }
  if (path.length > 64) {
    return {
      id,
      title,
      parentId,
      relation: normalizeRelation(node.relation),
      path,
      completeness: 'unknown',
      issues: [`requirement-depth-exceeded:${id}`],
      inputFields: ['relation'],
      credits: { required: null, earned: null, remaining: null, remainingSource: 'unknown', contributingNodeIds: [] },
      alternatives: [],
      selectionStatus: 'not-applicable',
      selectedAlternativeId: null,
      courses: [],
      children: [],
    }
  }

  const nextAncestors = new Set(ancestors)
  nextAncestors.add(node)
  const children = arrayValue(node.children).map((child, index) => analyzeRequirementNode(
    child,
    context,
    id,
    [...path, index],
    nextAncestors,
  ))
  const childRollup = aggregateRequirementChildren(id, children, context.alternativeSelections)
  const required = fixed(finiteNonNegative(node.required))
  const earned = fixed(finiteNonNegative(node.earned))
  const officialRemaining = fixed(finiteNonNegative(node.remaining))
  let remaining = officialRemaining
  let remainingSource = officialRemaining === null ? 'unknown' : 'official'
  let finalRequired = required
  let finalEarned = earned
  let contributingNodeIds = []
  const inputFields = ['relation']
  if (required !== null) inputFields.push('required')
  if (earned !== null) inputFields.push('earned')
  if (officialRemaining !== null) inputFields.push('remaining')
  if (children.length) inputFields.push('children')

  if (remaining === null && required !== null && earned !== null) {
    remaining = subtractKnown(required, earned, { floorAtZero: true })
    remainingSource = 'required-minus-earned'
  } else if (remaining === null && childRollup.remaining !== null) {
    remaining = childRollup.remaining
    remainingSource = 'children'
    finalRequired = finalRequired ?? childRollup.required
    finalEarned = finalEarned ?? childRollup.earned
    contributingNodeIds = childRollup.contributingNodeIds
  }
  if (children.length) {
    const usesChildRequired = finalRequired === null && childRollup.required !== null
    const usesChildEarned = finalEarned === null && childRollup.earned !== null
    finalRequired = finalRequired ?? childRollup.required
    finalEarned = finalEarned ?? childRollup.earned
    if (usesChildRequired || usesChildEarned) {
      contributingNodeIds = uniqueSorted([...contributingNodeIds, ...childRollup.contributingNodeIds])
    }
  }

  const issues = uniqueSorted([
    ...children.flatMap((child) => child.issues),
    ...childRollup.issues,
    remaining === null ? `remaining-unknown:${id}` : null,
  ])
  const childIncomplete = children.some((child) => child.completeness !== 'complete')
  const creditFieldsIncomplete = finalRequired === null || finalEarned === null
  const completeness = remaining === null
    ? (finalRequired !== null || finalEarned !== null || children.length ? 'partial' : 'unknown')
    : (creditFieldsIncomplete || childIncomplete || childRollup.selectionStatus === 'unselected' || childRollup.selectionStatus === 'invalid' ? 'partial' : 'complete')

  return {
    id,
    title,
    parentId,
    relation: normalizeRelation(node.relation),
    path,
    completeness,
    issues,
    inputFields: uniqueSorted(inputFields),
    credits: {
      required: finalRequired,
      earned: finalEarned,
      remaining,
      remainingSource,
      contributingNodeIds: uniqueSorted(contributingNodeIds),
    },
    alternatives: childRollup.alternatives,
    selectionStatus: childRollup.selectionStatus,
    selectedAlternativeId: childRollup.selectedAlternativeId,
    courses: arrayValue(node.courses).map((course, index) => ({
      id: text(course?.id) || `course:${shortDigest({ node: id, index, code: text(course?.courseCode), title: text(course?.title) }, 16)}`,
      courseCode: text(course?.courseCode || course?.courseId || course?.code).toUpperCase() || null,
      title: text(course?.title || course?.courseName) || null,
      credits: fixed(finiteNonNegative(course?.credits)),
      studyStatus: text(course?.studyStatus || course?.status) || null,
    })),
    children,
  }
}

function flattenRequirements(nodes) {
  return nodes.flatMap((node) => [node, ...flattenRequirements(node.children)])
}

export function analyzeAcademicRequirements(academicProgress, { alternativeSelections = {}, dataQuality = null } = {}) {
  const progress = objectValue(academicProgress)
  const roots = arrayValue(progress.roots)
  const categories = arrayValue(progress.categories)
  const source = roots.length ? 'roots' : categories.length ? 'categories' : 'none'
  const sourceNodes = roots.length ? roots : categories
  const selections = normalizedSelections(alternativeSelections)
  const analyzedRoots = sourceNodes.map((node, index) => analyzeRequirementNode(node, {
    alternativeSelections: selections,
  }, null, [index], new Set()))
  const summaryRollup = source === 'categories'
    ? {
        required: analyzedRoots.length === 1 ? analyzedRoots[0].credits.required : null,
        earned: analyzedRoots.length === 1 ? analyzedRoots[0].credits.earned : null,
        remaining: analyzedRoots.length === 1 ? analyzedRoots[0].credits.remaining : null,
        source: analyzedRoots.length === 1 ? analyzedRoots[0].credits.remainingSource : 'unknown',
        contributingNodeIds: analyzedRoots.length === 1 ? [analyzedRoots[0].id] : [],
        issues: analyzedRoots.length > 1 ? ['categories-overlap-unknown'] : [],
        alternatives: [],
        selectionStatus: 'not-applicable',
        selectedAlternativeId: null,
      }
    : aggregateRequirementChildren('$roots', analyzedRoots, selections)
  const nodes = flattenRequirements(analyzedRoots)
  const hasUsefulValues = nodes.some((node) => Object.values(node.credits).some((value) => typeof value === 'string'))
  const structuralCompleteness = source === 'categories'
    ? 'partial'
    : source === 'none'
      ? 'unknown'
      : summaryRollup.remaining !== null && nodes.every((node) => node.completeness === 'complete') ? 'complete' : hasUsefulValues ? 'partial' : 'unknown'
  const normalizedRequirementSource = text(progress.requirementSource) || null
  const sourceKind = requirementSourceKind(source, normalizedRequirementSource)
  const qualityAssessment = requirementQualityAssessment(structuralCompleteness, sourceKind, dataQuality)
  const invalidSelections = Object.entries(selections).flatMap(([parentId, selectedId]) => {
    const parent = parentId === '$roots' ? { alternatives: summaryRollup.alternatives } : nodes.find((node) => node.id === parentId)
    return parent?.alternatives.some((alternative) => alternative.id === selectedId)
      ? []
      : [`invalid-alternative-selection:${parentId}`]
  })
  return {
    source,
    structuralCompleteness,
    completeness: qualityAssessment.completeness,
    confirmed: qualityAssessment.confirmed,
    requirementSource: normalizedRequirementSource,
    requirementSourceKind: sourceKind,
    dataQuality: requirementQuality(dataQuality),
    caveats: qualityAssessment.caveats,
    program: text(progress.program) || null,
    summary: {
      required: summaryRollup.required,
      earned: summaryRollup.earned,
      remaining: summaryRollup.remaining,
      remainingSource: summaryRollup.source,
      contributingNodeIds: uniqueSorted(summaryRollup.contributingNodeIds),
    },
    alternativeSelections: selections,
    issues: uniqueSorted([
      ...(source === 'categories' ? ['categories-fallback-partial'] : []),
      ...(source === 'none' ? ['requirement-data-missing'] : []),
      ...(sourceKind === 'inferred-tree' ? ['requirement-tree-inferred'] : []),
      ...(sourceKind === 'unknown-tree' ? ['requirement-tree-source-unknown'] : []),
      ...invalidSelections,
      ...nodes.flatMap((node) => node.issues),
      ...summaryRollup.issues,
    ]),
    roots: analyzedRoots,
    nodes,
  }
}

function registerEvidence(registry, specification) {
  const entry = registry.register(specification)
  registry.disclose(entry.id, specification.fields)
  return registry.get(entry.id)
}

function claimId({ kind, subject, predicate, evidence, fields, rulesVersion }) {
  return `claim1:${kind}:${shortDigest({
    schema: LOCAL_CLAIM_SCHEMA,
    kind,
    subject,
    predicate,
    domainDigests: uniqueSorted(evidence.map((entry) => entry.domainDigest)),
    evidenceDigests: uniqueSorted(evidence.map((entry) => entry.evidenceDigest)),
    fields: uniqueSorted(fields),
    rulesVersion,
  }, 20)}`
}

function localClaim(registry, {
  kind = 'computed',
  subject,
  predicate,
  value,
  displayText,
  evidenceRefs,
  confidence,
  caveats = [],
  fields,
  rulesVersion,
  scenario = false,
}) {
  const refs = uniqueSorted(evidenceRefs)
  if (!refs.length) throw new TypeError(`Academic claim ${predicate} requires evidence`)
  const evidence = refs.map((id) => registry.get(id))
  if (evidence.some((entry) => !entry)) throw new TypeError(`Academic claim ${predicate} has unresolved evidence`)
  const normalizedSubject = text(subject)
  return Object.freeze({
    id: claimId({ kind, subject: normalizedSubject, predicate, evidence, fields, rulesVersion }),
    kind,
    subject: normalizedSubject,
    predicate,
    value,
    displayText: text(displayText),
    evidenceRefs: refs,
    confidence,
    caveats: uniqueSorted(caveats),
    rulesVersion,
    ...(scenario ? { scenario: true } : {}),
  })
}

function riskId(kind, entityId, rulesVersion) {
  return `risk:${kind}:${shortDigest({ kind, entityId: text(entityId), rulesVersion }, 16)}`
}

function academicRisk({
  kind,
  entityId,
  domain,
  severity,
  title,
  why,
  evidenceRefs,
  claimIds,
  confidence,
  caveats = [],
  quality,
  actionable,
  suggestedAction,
  actionKind,
  rulesVersion,
}) {
  return Object.freeze({
    id: riskId(kind, entityId, rulesVersion),
    kind,
    entityId: text(entityId),
    domain,
    severity,
    title: text(title),
    why: uniqueSorted(why),
    evidenceRefs: uniqueSorted(evidenceRefs),
    claimIds: uniqueSorted(claimIds),
    confidence,
    caveats: uniqueSorted(caveats),
    dueAt: null,
    deadlineBand: 'unknown',
    actionable: actionable === true,
    suggestedAction: text(suggestedAction),
    actionKind: text(actionKind),
    impactClass: 'academic-gap',
    delayCostClass: 'information-only',
    quality: qualitySummary(quality),
    rulesVersion,
  })
}

function requirementSubject(id) {
  return `academic-requirement:${shortDigest({ id: text(id) }, 16)}`
}

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

function validGpa(value) {
  const number = finiteNonNegative(value)
  return number !== null && number <= 4.33 ? fixed(number, GPA_SCALE) : null
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

function evaluateGpa(state, { registry, dataQuality, rulesVersion, claims, risks }) {
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

  const grades = arrayValue(state.grades)
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
    const difference = formatUnits(Math.abs(signedUnits(academicValue, GPA_SCALE) - signedUnits(profileValue, GPA_SCALE)), GPA_SCALE)
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

function normalizeUpgradeRule(rawRule) {
  if (rawRule === null || rawRule === undefined) return null
  const rule = objectValue(rawRule)
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

function evaluateUpgrade(ruleInput, requirements, { registry, quality, rulesVersion, claims, risks }) {
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

function normalizedCourseCode(value) {
  return text(value).replace(/\s+/g, '').toUpperCase()
}

function normalizedCourseTitle(value) {
  return text(value).replace(/\s+/g, '').toUpperCase()
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

function evaluateFailures(state, requirements, { registry, quality, rulesVersion, claims, risks }) {
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

function evaluateScenario(rawScenario, state, baseRequirements, { registry, quality, rulesVersion, claims }) {
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
  const publicRequirements = {
    ...requirements,
    byId: undefined,
  }
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
