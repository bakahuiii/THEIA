import { compareCanonicalText, shortDigest, uniqueSorted } from './canonical.mjs'
import {
  addKnown,
  arrayValue,
  objectValue,
  finiteNonNegative,
  fixed,
  subtractKnown,
  text,
  weakerCompleteness,
} from './academic-utils.mjs'

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

export function normalizedSelections(value) {
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

export function flattenRequirements(nodes) {
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
