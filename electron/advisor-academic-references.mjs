import { parseInstant, shortDigest } from '../core/advisor/canonical.mjs'

export const ACADEMIC_REFERENCE_SCHEMA = 'theia-advisor-academic-ref/v1'

const INTERNAL = new WeakMap()
const REFERENCE_PATTERN = /^ar1:(requirement|course|entity):[a-f0-9]{20}$/
const PUBLIC_AVAILABILITY = new Set(['available', 'empty-confirmed', 'absent', 'unknown'])
const PUBLIC_FRESHNESS = new Set(['fresh', 'stale', 'unknown'])
const PUBLIC_COMPLETENESS = new Set(['complete', 'partial', 'unknown'])
const PUBLIC_ATTEMPT_STATUS = new Set(['never', 'not-attempted', 'succeeded', 'failed', 'auth-required'])
const PUBLIC_REQUIREMENT_STRUCTURE = new Set(['roots', 'categories', 'none'])
const PUBLIC_REQUIREMENT_SOURCE_KIND = new Set(['official-tree', 'inferred-tree', 'categories-fallback', 'none', 'unknown-tree'])
const PUBLIC_REQUIREMENT_SOURCE_MAP = new Map([
  ['api-tree-detail', 'api-tree-detail'],
  ['api-dom-tree', 'api-dom-tree'],
  ['api-embedded-tree', 'api-embedded-tree'],
  ['api-inferred-tree', 'api-inferred-tree'],
  ['browser-tree-detail', 'browser-tree-detail'],
  ['browser-dom-tree', 'browser-dom-tree'],
  ['browser-embedded-tree', 'browser-embedded-tree'],
  ['browser-inferred-tree', 'browser-inferred-tree'],
  ['jwglxt-tree-detail', 'browser-tree-detail'],
  ['jwglxt-dom-tree', 'browser-dom-tree'],
  ['jwglxt-embedded-tree', 'browser-embedded-tree'],
  ['jwglxt-inferred-tree', 'browser-inferred-tree'],
])
const PUBLIC_DOMAINS = new Set([
  'profile', 'terms', 'courses', 'academic', 'schedule', 'grades', 'exams',
  'selected-courses', 'academic-progress', 'assignments', 'workspaces',
  'coursework', 'notices', 'mailbox', 'fitness', 'school-schedule',
  'academic-calendar', 'local-data-catalog',
])
const PUBLIC_EVIDENCE_DOMAINS = new Set([...PUBLIC_DOMAINS, 'request-input'])
const PUBLIC_SOURCE_MAP = new Map([
  ['jwglxt', 'jwglxt'],
  ['academic-api', 'jwglxt'],
  ['jwglxt-school-schedule', 'jwglxt'],
  ['theol', 'theol'],
  ['tygl', 'tygl'],
  ['imap', 'imap'],
  ['webmail', 'webmail'],
  ['academic-calendar', 'academic-calendar'],
  ['official-academic-calendar', 'academic-calendar'],
  ['local-course-work', 'local'],
  ['local-computed', 'local'],
  ['local-config', 'local-config'],
  ['local-scenario', 'local-scenario'],
  ['request-input', 'request-input'],
  ['fixture', 'fixture'],
  ['local', 'local'],
])
const PUBLIC_WARNING_PATTERN = /^(?:provenance-missing|content-digest-derived|captured-at-invalid|captured-at-missing|captured-at-in-future|retained-previous-empty):[a-z][a-z0-9-]{0,63}$|^snapshot-time-missing-or-invalid$/

export class AcademicReferenceError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AcademicReferenceError'
    this.code = code
  }
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function list(value) {
  return Array.isArray(value) ? value : []
}

function text(value) {
  return String(value ?? '').normalize('NFC').trim()
}

function publicEnum(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback
}

function publicInstant(value) {
  return parseInstant(value)?.iso || null
}

function publicSources(value) {
  return [...new Set(list(value)
    .map((source) => PUBLIC_SOURCE_MAP.get(text(source)))
    .filter(Boolean))].sort()
}

function publicSource(value) {
  return PUBLIC_SOURCE_MAP.get(text(value)) || null
}

export function projectAdvisorEvidence(value) {
  const evidence = record(value)
  const rawId = text(evidence.id)
  const rawDataset = text(evidence.dataset)
  const rawDomain = text(evidence.domain)
  const rawEntityId = text(evidence.entityId)
  const rawRevision = text(evidence.snapshotRevision)
  const id = /^[a-zA-Z0-9._:-]{1,256}$/.test(rawId) ? rawId : null
  const dataset = /^[a-z0-9._-]{1,64}$/.test(rawDataset) ? rawDataset : 'unknown'
  const domain = PUBLIC_EVIDENCE_DOMAINS.has(rawDomain) ? rawDomain : 'unknown'
  const entityId = /^(?:entity:[a-f0-9]{16}|ar1:entity:[a-f0-9]{20})$/.test(rawEntityId) ? rawEntityId : null
  const snapshotRevision = /^[a-zA-Z0-9._:-]{1,128}$/.test(rawRevision) ? rawRevision : null
  const fields = [...new Set(list(evidence.fields).map(text).filter((field) => /^[a-zA-Z0-9._-]{1,80}$/.test(field)))].sort()
  const allowedFields = new Set(fields)
  const disclosedFields = [...new Set(list(evidence.disclosedFields).map(text)
    .filter((field) => allowedFields.has(field)))].sort()
  const projected = {
    id,
    dataset,
    domain,
    entityId,
    fields,
    capturedAt: publicInstant(evidence.capturedAt),
    source: publicSource(evidence.source),
    snapshotRevision,
    domainDigest: publicDigest(evidence.domainDigest),
    evidenceDigest: publicDigest(evidence.evidenceDigest),
    availability: publicEnum(evidence.availability, PUBLIC_AVAILABILITY, 'unknown'),
    freshness: publicEnum(evidence.freshness, PUBLIC_FRESHNESS, 'unknown'),
    completeness: publicEnum(evidence.completeness, PUBLIC_COMPLETENESS, 'unknown'),
    label: evidence.label === null || evidence.label === undefined ? null : text(evidence.label).slice(0, 160),
    disclosedFields,
  }
  if (evidence.origin === 'request-input') projected.origin = 'request-input'
  const requestDigest = publicDigest(evidence.requestDigest)
  if (requestDigest) projected.requestDigest = requestDigest
  return projected
}

function publicCount(value) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : 0
}

function publicDigest(value) {
  const normalized = text(value).toLowerCase()
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null
}

function publicRequirementSource(value) {
  return PUBLIC_REQUIREMENT_SOURCE_MAP.get(text(value)) || null
}

function projectPublicDomainQuality(value, domain = null) {
  if (!value) return null
  const quality = record(value)
  const lastAttempt = record(quality.lastAttempt)
  const projected = {
    availability: publicEnum(quality.availability, PUBLIC_AVAILABILITY, 'unknown'),
    freshness: publicEnum(quality.freshness, PUBLIC_FRESHNESS, 'unknown'),
    completeness: publicEnum(quality.completeness, PUBLIC_COMPLETENESS, 'unknown'),
    contentEmptyConfirmed: quality.contentEmptyConfirmed === true,
    capturedAt: publicInstant(quality.capturedAt),
    sourceSucceededAt: publicInstant(quality.sourceSucceededAt),
    source: publicSources(quality.source),
    parserVersion: null,
    recordCount: publicCount(quality.recordCount),
    contentDigest: publicDigest(quality.contentDigest),
    lastAttempt: {
      runId: null,
      attemptedAt: publicInstant(lastAttempt.attemptedAt),
      completedAt: publicInstant(lastAttempt.completedAt),
      status: publicEnum(lastAttempt.status, PUBLIC_ATTEMPT_STATUS, 'never'),
      emptyConfirmed: lastAttempt.emptyConfirmed === true,
      retainedPrevious: lastAttempt.retainedPrevious === true,
      errorCode: null,
    },
    provenanceInferred: quality.provenanceInferred === true,
  }
  if (PUBLIC_DOMAINS.has(domain)) projected.domain = domain
  return projected
}

function projectPublicDataQuality(value) {
  const quality = record(value)
  const domains = Object.fromEntries(Object.entries(record(quality.domains))
    .filter(([domain]) => PUBLIC_DOMAINS.has(domain))
    .map(([domain, domainQuality]) => [domain, projectPublicDomainQuality(domainQuality, domain)]))
  return {
    schema: 'theia-advisor-data-quality/v1',
    snapshotRevision: text(quality.snapshotRevision),
    snapshotAt: publicInstant(quality.snapshotAt),
    evaluatedAt: publicInstant(quality.evaluatedAt),
    timeZone: quality.timeZone === 'Asia/Shanghai' ? 'Asia/Shanghai' : 'Asia/Shanghai',
    rulesVersion: /^[a-zA-Z0-9._/-]{1,128}$/.test(text(quality.rulesVersion)) ? text(quality.rulesVersion) : null,
    domains,
    warnings: [...new Set(list(quality.warnings).map(text).filter((warning) => PUBLIC_WARNING_PATTERN.test(warning)))].sort(),
  }
}

function numericPath(value, label = 'requirement path') {
  if (!Array.isArray(value) || value.some((item) => !Number.isSafeInteger(item) || item < 0)) {
    throw new AcademicReferenceError('invalid-reference', `${label} must contain only non-negative integers`)
  }
  return [...value]
}

function pathKey(path) {
  return numericPath(path).join('.')
}

function requirementRawId(node, path) {
  return text(node?.id) || `generated:${shortDigest({ path, title: text(node?.title) }, 16)}`
}

function refFor(metadata, descriptor) {
  const kind = descriptor.kind
  if (!['requirement', 'course', 'entity'].includes(kind)) {
    throw new AcademicReferenceError('reference-catalog-invalid', 'Academic reference kind is invalid')
  }
  return `ar1:${kind}:${shortDigest({
    schema: ACADEMIC_REFERENCE_SCHEMA,
    snapshotRevision: metadata.snapshotRevision,
    rulesVersion: metadata.rulesVersion,
    kind,
    path: descriptor.path,
    rawId: descriptor.rawId,
    ...(descriptor.index === undefined ? {} : { index: descriptor.index }),
    ...(descriptor.scope === undefined ? {} : { scope: descriptor.scope }),
  }, 20)}`
}

function addEntry(state, entry) {
  const previous = state.byOpaque.get(entry.opaque)
  if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) {
    throw new AcademicReferenceError('reference-catalog-invalid', 'Academic reference collision')
  }
  state.byOpaque.set(entry.opaque, Object.freeze(entry))
}

function publicMethods(catalog) {
  const state = INTERNAL.get(catalog)
  return {
    requirementRef(rawId, path = undefined) {
      const normalizedRawId = text(rawId)
      if (path !== undefined) {
        const entry = state.requirementByPath.get(pathKey(path))
        if (!entry || entry.rawId !== normalizedRawId) {
          throw new AcademicReferenceError('invalid-reference', 'Requirement reference is not in the current catalog')
        }
        return entry.opaque
      }
      const entries = state.requirementByRaw.get(normalizedRawId) || []
      if (entries.length !== 1) {
        throw new AcademicReferenceError(entries.length ? 'ambiguous-reference' : 'invalid-reference', 'Requirement reference is not unique')
      }
      return entries[0].opaque
    },
    courseRef(rawId, nodePath, index) {
      const key = `${pathKey(nodePath)}:${index}`
      const entry = state.courseByLocation.get(key)
      if (!entry || entry.rawId !== text(rawId)) {
        throw new AcademicReferenceError('invalid-reference', 'Course reference is not in the current catalog')
      }
      return entry.opaque
    },
    genericRef(rawId, scope = 'academic') {
      const normalizedRawId = text(rawId)
      if (!normalizedRawId) return null
      return refFor(state.metadata, { kind: 'entity', path: [], rawId: normalizedRawId, scope: text(scope) || 'academic' })
    },
  }
}

export function createAcademicReferenceCatalog({ academicProgress, snapshotRevision, rulesVersion }) {
  const metadata = {
    snapshotRevision: text(snapshotRevision),
    rulesVersion: text(rulesVersion),
  }
  if (!metadata.snapshotRevision || !metadata.rulesVersion) {
    throw new AcademicReferenceError('reference-catalog-invalid', 'Academic reference catalog requires revision and rules version')
  }
  const progress = record(academicProgress)
  const roots = list(progress.roots).length ? list(progress.roots) : list(progress.categories)
  const state = {
    metadata,
    byOpaque: new Map(),
    requirementByPath: new Map(),
    requirementByRaw: new Map(),
    courseByLocation: new Map(),
    alternativeChildren: new Map(),
  }

  function visit(nodeValue, path, parent = null) {
    const node = record(nodeValue)
    const rawId = requirementRawId(node, path)
    const opaque = refFor(metadata, { kind: 'requirement', path, rawId })
    const relation = text(node.relation).toLowerCase() === 'or' ? 'or' : 'and'
    const entry = {
      kind: 'requirement', opaque, rawId, path: [...path], parentOpaque: parent?.opaque || null, relation,
    }
    addEntry(state, entry)
    const key = pathKey(path)
    if (state.requirementByPath.has(key)) {
      throw new AcademicReferenceError('reference-catalog-invalid', 'Duplicate academic requirement path')
    }
    state.requirementByPath.set(key, entry)
    const sameRaw = state.requirementByRaw.get(rawId) || []
    sameRaw.push(entry)
    state.requirementByRaw.set(rawId, sameRaw)

    list(node.courses).forEach((courseValue, index) => {
      const course = record(courseValue)
      const courseRawId = text(course.id) || `course:${shortDigest({ node: rawId, index, code: text(course.courseCode), title: text(course.title) }, 16)}`
      const courseOpaque = refFor(metadata, { kind: 'course', path, rawId: courseRawId, index })
      const courseEntry = { kind: 'course', opaque: courseOpaque, rawId: courseRawId, path: [...path], index, parentOpaque: opaque }
      addEntry(state, courseEntry)
      state.courseByLocation.set(`${key}:${index}`, courseEntry)
    })

    const children = list(node.children).map((child, index) => visit(child, [...path, index], entry))
    const alternatives = children.filter((child) => child.relation === 'or')
    if (alternatives.length > 1) state.alternativeChildren.set(opaque, new Set(alternatives.map((child) => child.opaque)))
    return entry
  }

  roots.forEach((node, index) => visit(node, [index]))
  const catalog = {
    schema: ACADEMIC_REFERENCE_SCHEMA,
    snapshotRevision: metadata.snapshotRevision,
    rulesVersion: metadata.rulesVersion,
  }
  INTERNAL.set(catalog, state)
  Object.assign(catalog, publicMethods(catalog))
  return Object.freeze(catalog)
}

function catalogState(catalog) {
  const state = INTERNAL.get(catalog)
  if (!state) throw new AcademicReferenceError('reference-catalog-invalid', 'Academic reference catalog is invalid')
  return state
}

export function resolveAlternativeSelections(catalog, selections) {
  const state = catalogState(catalog)
  const source = record(selections)
  const resolved = {}
  for (const [parentOpaque, childValue] of Object.entries(source)) {
    const childOpaque = text(childValue)
    if (!REFERENCE_PATTERN.test(parentOpaque) || !REFERENCE_PATTERN.test(childOpaque)) {
      throw new AcademicReferenceError('invalid-reference', 'Academic alternative reference is invalid')
    }
    const parent = state.byOpaque.get(parentOpaque)
    const child = state.byOpaque.get(childOpaque)
    if (!parent || !child || parent.kind !== 'requirement' || child.kind !== 'requirement') {
      throw new AcademicReferenceError('invalid-reference', 'Academic alternative reference is not current')
    }
    const allowed = state.alternativeChildren.get(parentOpaque)
    if (!allowed?.has(childOpaque) || child.parentOpaque !== parentOpaque || child.relation !== 'or') {
      throw new AcademicReferenceError('invalid-alternative-pair', 'Academic alternative pair is not allowed')
    }
    if ((state.requirementByRaw.get(parent.rawId) || []).length !== 1
      || (state.requirementByRaw.get(child.rawId) || []).length !== 1) {
      throw new AcademicReferenceError('ambiguous-reference', 'Academic alternative reference is ambiguous')
    }
    if (Object.hasOwn(resolved, parent.rawId)) {
      throw new AcademicReferenceError('ambiguous-reference', 'Academic alternative parent is duplicated')
    }
    resolved[parent.rawId] = child.rawId
  }
  return Object.freeze(resolved)
}

function issueCode(value) {
  return text(value).split(':', 1)[0]
}

function issueList(values) {
  return [...new Set(list(values).map(issueCode).filter(Boolean))].sort()
}

function projectCredits(creditsValue) {
  const credits = record(creditsValue)
  return {
    required: credits.required ?? null,
    earned: credits.earned ?? null,
    remaining: credits.remaining ?? null,
    remainingSource: text(credits.remainingSource) || 'unknown',
    evidenceRefs: list(credits.evidenceRefs).map(text).filter(Boolean),
    claimIds: { ...record(credits.claimIds) },
  }
}

function projectRequirementNode(nodeValue, catalog, expectedPath) {
  const node = record(nodeValue)
  const state = catalogState(catalog)
  const path = Array.isArray(node.path) ? numericPath(node.path) : numericPath(expectedPath)
  const entry = state.requirementByPath.get(pathKey(path))
  if (!entry || entry.rawId !== text(node.id)) {
    throw new AcademicReferenceError('invalid-reference', 'Academic result does not match the reference catalog')
  }
  const children = list(node.children).map((child, index) => projectRequirementNode(child, catalog, [...path, index]))
  return {
    id: entry.opaque,
    title: text(node.title),
    parentId: entry.parentOpaque,
    relation: node.relation === 'or' ? 'or' : 'and',
    structuralCompleteness: node.structuralCompleteness,
    completeness: node.completeness,
    caveats: list(node.caveats).map(text),
    credits: projectCredits(node.credits),
    alternatives: list(node.alternatives).map((alternativeValue) => {
      const alternative = record(alternativeValue)
      return {
        id: catalog.requirementRef(alternative.id),
        title: text(alternative.title),
        remaining: alternative.remaining ?? null,
        completeness: alternative.completeness,
      }
    }),
    selectionStatus: text(node.selectionStatus) || 'not-applicable',
    selectedAlternativeId: node.selectedAlternativeId ? catalog.requirementRef(node.selectedAlternativeId) : null,
    issues: issueList(node.issues),
    children,
    evidenceRefs: list(node.evidenceRefs).map(text).filter(Boolean),
  }
}

function projectRequirementSummary(summaryValue) {
  const summary = record(summaryValue)
  return {
    required: summary.required ?? null,
    earned: summary.earned ?? null,
    remaining: summary.remaining ?? null,
    remainingSource: text(summary.remainingSource) || 'unknown',
    evidenceRefs: list(summary.evidenceRefs).map(text).filter(Boolean),
    claimId: summary.claimId ?? null,
  }
}

function projectRequirements(requirementsValue, catalog) {
  const requirements = record(requirementsValue)
  const roots = list(requirements.roots).map((node, index) => projectRequirementNode(node, catalog, [index]))
  const nodes = roots.flatMap(function flatten(node) { return [node, ...node.children.flatMap(flatten)] })
  return {
    source: publicEnum(requirements.source, PUBLIC_REQUIREMENT_STRUCTURE, 'none'),
    structuralCompleteness: publicEnum(requirements.structuralCompleteness, PUBLIC_COMPLETENESS, 'unknown'),
    completeness: publicEnum(requirements.completeness, PUBLIC_COMPLETENESS, 'unknown'),
    confirmed: requirements.confirmed === true,
    requirementSource: publicRequirementSource(requirements.requirementSource),
    requirementSourceKind: publicEnum(requirements.requirementSourceKind, PUBLIC_REQUIREMENT_SOURCE_KIND, 'unknown-tree'),
    dataQuality: projectPublicDomainQuality(requirements.dataQuality),
    caveats: list(requirements.caveats).map(text),
    program: requirements.program ?? null,
    summary: projectRequirementSummary(requirements.summary),
    issues: issueList(requirements.issues),
    roots,
    nodes,
  }
}

function projectRule(ruleValue, catalog) {
  if (!ruleValue) return null
  const rule = record(ruleValue)
  const sourceKind = rule.sourceKind === 'official' ? 'official' : 'configuration'
  return {
    schema: 'theia-advisor-academic-rule/v1',
    id: catalog.genericRef(rule.id, 'academic-rule'),
    rulesVersion: /^[a-zA-Z0-9._/-]{1,128}$/.test(text(rule.rulesVersion)) ? text(rule.rulesVersion) : null,
    sourceKind,
    sourceLabel: text(rule.sourceLabel),
    thresholdCredits: rule.thresholdCredits,
    requirementIds: list(rule.requirementIds).map((id) => catalog.requirementRef(id)),
    earnedCredits: rule.earnedCredits ?? null,
  }
}

function projectUpgrade(upgradeValue, catalog) {
  const upgrade = record(upgradeValue)
  return {
    status: upgrade.status,
    rule: projectRule(upgrade.rule, catalog),
    threshold: upgrade.threshold ?? null,
    earned: upgrade.earned ?? null,
    distance: upgrade.distance ?? null,
    ...(Object.hasOwn(upgrade, 'remaining') ? { remaining: upgrade.remaining ?? null } : {}),
    ...(Object.hasOwn(upgrade, 'arithmeticAtOrAbove') ? { arithmeticAtOrAbove: upgrade.arithmeticAtOrAbove === true } : {}),
    evidenceRefs: list(upgrade.evidenceRefs).map(text).filter(Boolean),
    claimIds: list(upgrade.claimIds).map(text).filter(Boolean),
    issues: issueList(upgrade.issues),
  }
}

function projectFailure(failureValue, catalog) {
  const failure = record(failureValue)
  return {
    id: catalog.genericRef(failure.id, 'academic-failure'),
    courseCode: failure.courseCode ?? null,
    title: failure.title ?? null,
    relationStatus: failure.relationStatus,
    matchBasis: failure.matchBasis,
    requirementIds: list(failure.requirementIds).map((id) => catalog.requirementRef(id)),
    candidateRequirementIds: list(failure.candidateRequirementIds).map((id) => catalog.requirementRef(id)),
    recordedCredits: failure.recordedCredits ?? null,
    evidenceRefs: list(failure.evidenceRefs).map(text).filter(Boolean),
    claimIds: list(failure.claimIds).map(text).filter(Boolean),
    caveats: list(failure.caveats).map(text),
  }
}

function projectScenario(scenarioValue, catalog) {
  if (!scenarioValue) return null
  const scenario = record(scenarioValue)
  const alternativeSelections = Object.fromEntries(Object.entries(record(scenario.alternativeSelections)).map(([parent, child]) => [
    catalog.requirementRef(parent), catalog.requirementRef(child),
  ]))
  return {
    scenario: true,
    status: scenario.status,
    additionalRequiredCredits: scenario.additionalRequiredCredits ?? null,
    alternativeSelections,
    baseRemaining: scenario.baseRemaining ?? null,
    remaining: scenario.remaining ?? null,
    evidenceRefs: list(scenario.evidenceRefs).map(text).filter(Boolean),
    claimId: scenario.claimId ?? null,
    issues: issueList(scenario.issues),
  }
}

function projectClaim(value) {
  const source = record(value)
  const claimValue = record(source.value)
  const normalizedValue = typeof claimValue.value === 'boolean'
    ? claimValue.value
    : text(claimValue.value).slice(0, 2_000)
  return {
    id: text(source.id).slice(0, 256),
    kind: text(source.kind).slice(0, 64),
    subject: text(source.subject).slice(0, 256),
    predicate: text(source.predicate).slice(0, 128),
    value: {
      type: text(claimValue.type).slice(0, 64),
      value: normalizedValue,
      ...(claimValue.unit ? { unit: text(claimValue.unit).slice(0, 64) } : {}),
      ...(claimValue.timeZone ? { timeZone: text(claimValue.timeZone).slice(0, 80) } : {}),
    },
    displayText: text(source.displayText).slice(0, 2_000),
    evidenceRefs: list(source.evidenceRefs).map(text).filter(Boolean).slice(0, 64),
    confidence: ['high', 'medium', 'low', 'unknown'].includes(source.confidence) ? source.confidence : 'unknown',
    caveats: list(source.caveats).map((item) => text(item).slice(0, 1_000)).filter(Boolean).slice(0, 32),
    rulesVersion: text(source.rulesVersion).slice(0, 128),
  }
}

function projectQualitySummary(value) {
  const source = record(value)
  return {
    availability: publicEnum(source.availability, PUBLIC_AVAILABILITY, 'unknown'),
    freshness: publicEnum(source.freshness, PUBLIC_FRESHNESS, 'unknown'),
    completeness: publicEnum(source.completeness, PUBLIC_COMPLETENESS, 'unknown'),
    lastAttemptStatus: publicEnum(source.lastAttemptStatus, PUBLIC_ATTEMPT_STATUS, 'never'),
  }
}

function projectRisk(value, entityId = null) {
  const source = record(value)
  return {
    id: text(source.id).slice(0, 256),
    kind: text(source.kind).slice(0, 64),
    entityId: entityId || text(source.entityId).slice(0, 256),
    domain: PUBLIC_DOMAINS.has(source.domain) ? source.domain : 'unknown',
    severity: ['urgent', 'attention', 'info'].includes(source.severity) ? source.severity : 'info',
    title: text(source.title).slice(0, 2_000),
    why: list(source.why).map((item) => text(item).slice(0, 1_000)).filter(Boolean).slice(0, 32),
    evidenceRefs: list(source.evidenceRefs).map(text).filter(Boolean).slice(0, 64),
    claimIds: list(source.claimIds).map(text).filter(Boolean).slice(0, 64),
    dueAt: publicInstant(source.dueAt),
    deadlineBand: text(source.deadlineBand).slice(0, 64),
    actionable: source.actionable === true,
    suggestedAction: text(source.suggestedAction).slice(0, 1_000),
    actionKind: text(source.actionKind).slice(0, 64),
    impactClass: text(source.impactClass).slice(0, 64),
    delayCostClass: text(source.delayCostClass).slice(0, 64),
    quality: projectQualitySummary(source.quality),
    rulesVersion: text(source.rulesVersion).slice(0, 128),
  }
}

function scoreNumber(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function projectUrgentItem(value, entityId = null) {
  const source = record(value)
  const score = record(source.score)
  const components = Object.fromEntries(Object.entries(record(score.components))
    .filter(([key, component]) => /^[a-zA-Z0-9._-]{1,64}$/.test(key) && typeof component === 'string')
    .slice(0, 32)
    .map(([key, component]) => [key, component.slice(0, 256)]))
  return {
    id: text(source.id).slice(0, 256),
    kind: text(source.kind).slice(0, 64),
    domain: PUBLIC_DOMAINS.has(source.domain) ? source.domain : null,
    entityId: entityId || text(source.entityId).slice(0, 256),
    title: text(source.title).slice(0, 2_000),
    dueAt: publicInstant(source.dueAt),
    severity: ['urgent', 'attention', 'info'].includes(source.severity) ? source.severity : 'info',
    score: {
      urgency: scoreNumber(score.urgency),
      impact: scoreNumber(score.impact),
      delayCost: scoreNumber(score.delayCost),
      confidence: scoreNumber(score.confidence),
      total: scoreNumber(score.total),
      formulaVersion: text(score.formulaVersion).slice(0, 128),
      components,
    },
    reasons: list(source.reasons).map((item) => text(item).slice(0, 1_000)).filter(Boolean).slice(0, 32),
    evidenceRefs: list(source.evidenceRefs).map(text).filter(Boolean).slice(0, 64),
    claimIds: list(source.claimIds).map(text).filter(Boolean).slice(0, 64),
    quality: projectQualitySummary(source.quality),
    suggestedAction: text(source.suggestedAction).slice(0, 1_000),
    actionKind: text(source.actionKind).slice(0, 64),
    rulesVersion: text(source.rulesVersion).slice(0, 128),
  }
}

function projectEvidence(value, catalog, scope) {
  const source = record(value)
  return projectAdvisorEvidence({
    ...source,
    entityId: catalog.genericRef(source.entityId, scope),
  })
}

function riskIdentity(value) {
  const source = record(value)
  return JSON.stringify({
    kind: text(source.kind),
    domain: text(source.domain),
    entityId: text(source.entityId),
    evidenceRefs: list(source.evidenceRefs).map(text).filter(Boolean).sort(),
    claimIds: list(source.claimIds).map(text).filter(Boolean).sort(),
  })
}

export function projectAcademicResult(resultValue, catalog) {
  const result = record(resultValue)
  const analysis = record(result.analysis)
  return {
    schema: result.schema,
    snapshotRevision: result.snapshotRevision,
    evaluatedAt: result.evaluatedAt,
    timeZone: result.timeZone,
    rulesVersion: result.rulesVersion,
    analysis: {
      requirements: projectRequirements(analysis.requirements, catalog),
      gpa: structuredClone(analysis.gpa),
      upgrade: projectUpgrade(analysis.upgrade, catalog),
      failures: list(analysis.failures).map((failure) => projectFailure(failure, catalog)),
      scenario: projectScenario(analysis.scenario, catalog),
    },
    claims: list(result.claims).map(projectClaim),
    risks: list(result.risks).map((risk) => projectRisk(
      risk,
      catalog.genericRef(risk?.entityId, `academic-risk:${text(risk?.kind)}`),
    )),
    evidence: list(result.evidence).map((evidence) => projectEvidence(evidence, catalog, `academic-evidence:${text(evidence?.dataset)}`)),
  }
}

export function projectAdvisorOverview(overviewValue, catalog) {
  const overview = record(overviewValue)
  const academic = projectAcademicResult(overview.academic, catalog)
  const academicRiskEntityByIdentity = new Map(list(overview.academic?.risks).map((risk, index) => [
    riskIdentity(risk), academic.risks[index]?.entityId,
  ]).filter(([, opaqueId]) => opaqueId))
  const academicEvidenceById = new Map(academic.evidence.map((evidence) => [evidence.id, evidence]))
  const academicClaimById = new Map(academic.claims.map((claim) => [claim.id, claim]))
  return {
    schema: overview.schema === 'theia-advisor-overview/v1' ? overview.schema : 'theia-advisor-overview/v1',
    snapshotRevision: text(overview.snapshotRevision).slice(0, 128),
    evaluatedAt: publicInstant(overview.evaluatedAt),
    timeZone: overview.timeZone === 'Asia/Shanghai' ? 'Asia/Shanghai' : 'Asia/Shanghai',
    rulesVersion: text(overview.rulesVersion).slice(0, 128),
    dataQuality: projectPublicDataQuality(overview.dataQuality),
    academic,
    evidence: list(overview.evidence).map((evidence) => academicEvidenceById.get(evidence?.id)
      || projectAdvisorEvidence(evidence)),
    claims: list(overview.claims).map((claim) => academicClaimById.get(claim?.id) || projectClaim(claim)),
    risks: list(overview.risks).map((risk) => academicRiskEntityByIdentity.has(riskIdentity(risk))
      ? projectRisk(risk, academicRiskEntityByIdentity.get(riskIdentity(risk)))
      : projectRisk(risk)),
    urgentItems: list(overview.urgentItems).map((item) => academicRiskEntityByIdentity.has(riskIdentity(item))
      ? projectUrgentItem(item, academicRiskEntityByIdentity.get(riskIdentity(item)))
      : projectUrgentItem(item)),
  }
}

export function projectRequirementMatches(matches, catalog) {
  return list(matches).map((matchValue) => {
    const match = record(matchValue)
    const rawId = text(match.nodeId)
    return {
      nodeId: rawId ? catalog.requirementRef(rawId, match.nodePath) : null,
      label: match.label,
      basis: match.basis,
      confidence: match.confidence,
    }
  })
}
