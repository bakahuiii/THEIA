import { Buffer } from 'node:buffer'
import {
  canonicalDigest,
  canonicalJson,
  compareCanonicalText,
  normalizeText,
  parseInstant,
  uniqueSorted,
} from './canonical.mjs'
import {
  ADVISOR_CONSENT_CHALLENGE_SCHEMA,
  ADVISOR_CONSENT_SCHEMA,
  ADVISOR_CONTEXT_SCHEMA,
  ADVISOR_DISCLOSURE_SCHEMA,
  ADVISOR_INTENTS,
  ADVISOR_OVERVIEW_SCHEMA,
  ADVISOR_UNTRUSTED_REFERENCE_SCHEMA,
} from './contracts.mjs'
import { freezeRequestCatalog } from './citation-verifier.mjs'
import {
  SENSITIVE_ADVISOR_SCOPES,
  projectAdvisorAction,
  projectAdvisorClaim,
  projectAdvisorEvidence,
  projectAdvisorRisk,
  projectAdvisorUrgentItem,
  projectCourseDecision,
  projectDataQualityDomain,
  projectSelectedAdvisorEntity,
  sanitizeAdvisorUntrustedText,
} from './redaction.mjs'
import { assertAdvisorOverview } from './overview.mjs'

const DEFAULT_LIMITS = Object.freeze({
  maxUrgentItems: 7,
  maxRisks: 16,
  maxClaims: 32,
  maxCourseDecisions: 12,
  maxSelectedEntities: 12,
  maxActions: 8,
  maxQuestionLength: 8_000,
  maxInputBytes: 256_000,
})

const INTENT_DOMAINS = Object.freeze({
  daily: Object.freeze(['assignments', 'exams']),
  risk: Object.freeze(['academic-progress', 'grades', 'profile']),
  course: Object.freeze(['academic-progress', 'courses', 'grades', 'schedule', 'selected-courses', 'course-selection']),
  notice: Object.freeze(['notices']),
  mail: Object.freeze(['mailbox']),
  general: Object.freeze([]),
})

const INTENT_SELECTED_SCOPES = Object.freeze({
  daily: Object.freeze([]),
  risk: Object.freeze(['identity']),
  course: Object.freeze([]),
  notice: Object.freeze(['notices']),
  mail: Object.freeze(['mailbox', 'mail-body', 'attachment-text']),
  general: Object.freeze(['notices', 'mailbox', 'mail-body', 'fitness', 'identity', 'attachment-text']),
})

const INTENT_ACTION_KINDS = Object.freeze({
  daily: Object.freeze(['open-view', 'show-evidence', 'propose-sync-source', 'propose-prepare-workspace', 'none']),
  risk: Object.freeze(['open-view', 'show-evidence', 'propose-sync-source', 'none']),
  course: Object.freeze(['open-view', 'show-evidence', 'propose-save-course-target', 'none']),
  notice: Object.freeze(['open-view', 'show-evidence', 'none']),
  mail: Object.freeze(['open-view', 'show-evidence', 'none']),
  general: Object.freeze(['open-view', 'show-evidence', 'propose-sync-source', 'none']),
})

const GENERAL_FOCUS_DOMAINS = new Set([
  'assignments',
  'exams',
  'grades',
  'academic-progress',
  'courses',
  'schedule',
  'selected-courses',
  'course-selection',
  'profile',
  'notices',
  'mailbox',
  'fitness',
])

const CONSENT_KEYS = Object.freeze([
  'schema',
  'domains',
  'grantedAt',
  'expiresAt',
  'serviceIdentity',
  'purpose',
  'requestId',
  'threadId',
  'entityDigests',
  'contextDigest',
])

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`)
  return value
}

function text(value, label, maxLength = 240) {
  const output = normalizeText(value, { trim: true })
  if (!output || output.length > maxLength) throw new TypeError(`${label} must be a bounded non-empty string`)
  return output
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(record(value, label)).sort(compareCanonicalText)
  const keys = [...expected].sort(compareCanonicalText)
  if (actual.length !== keys.length || keys.some((key, index) => key !== actual[index])) {
    throw new TypeError(`${label} contains missing or unknown fields`)
  }
}

function stringSet(value, label, { maximum = 128 } = {}) {
  if (!Array.isArray(value) || value.length > maximum) throw new TypeError(`${label} must be a bounded array`)
  const normalized = value.map((item, index) => text(item, `${label}[${index}]`, 240))
  if (new Set(normalized).size !== normalized.length) throw new TypeError(`${label} must not contain duplicates`)
  return normalized.sort(compareCanonicalText)
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function limitsFrom(value) {
  const output = { ...DEFAULT_LIMITS }
  for (const key of Object.keys(DEFAULT_LIMITS)) {
    const candidate = Math.trunc(Number(value?.[key]))
    if (Number.isFinite(candidate) && candidate > 0) output[key] = Math.min(DEFAULT_LIMITS[key], candidate)
  }
  return output
}

function uniqueById(values, label) {
  const output = new Map()
  for (const value of values) {
    if (output.has(value.id)) throw new TypeError(`${label} IDs must be unique`)
    output.set(value.id, value)
  }
  return output
}

function evidenceDomains(claim, evidenceById) {
  const domains = []
  for (const id of claim.evidenceRefs || []) {
    const evidence = evidenceById.get(id)
    if (!evidence) throw new TypeError(`Claim ${claim.id} contains unresolved evidence`)
    domains.push(evidence.domain)
  }
  return uniqueSorted(domains)
}

function referencesFor(value) {
  return {
    claims: Array.isArray(value?.claimIds) ? value.claimIds : [],
    evidence: Array.isArray(value?.evidenceRefs) ? value.evidenceRefs : [],
  }
}

function addReferencedItem({ item, itemOutput, claimIds, evidenceIds, maximumClaims }) {
  const refs = referencesFor(item)
  const newClaims = refs.claims.filter((id) => !claimIds.has(id))
  if (claimIds.size + newClaims.length > maximumClaims) return false
  itemOutput.push(item)
  for (const id of refs.claims) claimIds.add(id)
  for (const id of refs.evidence) evidenceIds.add(id)
  return true
}

function selectedFocusDomains(input, intent) {
  const values = stringSet(Array.isArray(input.focusDomains) ? input.focusDomains : [], 'focusDomains', { maximum: 11 })
  for (const domain of values) {
    if (!GENERAL_FOCUS_DOMAINS.has(domain)) throw new TypeError(`Advisor focus domain is not allowed: ${domain}`)
  }
  if (values.length) return new Set(values)
  return new Set(INTENT_DOMAINS[intent])
}

function projectSelectedEntities(input, intent, limits) {
  const raw = Array.isArray(input.selectedEntities) ? input.selectedEntities : []
  const allowed = new Set(INTENT_SELECTED_SCOPES[intent])
  const selected = []
  let omitted = 0
  for (const entry of raw) {
    if (selected.length >= limits.maxSelectedEntities) {
      omitted += 1
      continue
    }
    const projected = projectSelectedAdvisorEntity(entry)
    if (!allowed.has(projected.scope)) {
      throw new TypeError(`Selected scope ${projected.scope} is not allowed for advisor intent ${intent}`)
    }
    const descriptor = {
      schema: 'theia-advisor-selected-entity/v1',
      scope: projected.scope,
      domain: projected.domain,
      record: projected.record,
    }
    const entityDigest = canonicalDigest(descriptor)
    selected.push({
      entityRef: `entity:${entityDigest.slice(0, 20)}`,
      entityDigest,
      scope: projected.scope,
      domain: projected.domain,
      record: projected.record,
    })
  }
  const digests = selected.map((entry) => entry.entityDigest)
  if (new Set(digests).size !== digests.length) throw new TypeError('Selected advisor entities must be unique')
  return { selected, omitted }
}

function selectedEntityReferences(selectedEntities, snapshotRevision) {
  const referableScopes = new Set(['notices', 'mailbox', 'mail-body', 'attachment-text'])
  return selectedEntities
    .filter((entry) => referableScopes.has(entry.scope))
    .map((entry) => {
      const sourceText = canonicalJson(entry.record)
      return {
        schema: ADVISOR_UNTRUSTED_REFERENCE_SCHEMA,
        id: entry.entityRef,
        entityDigest: entry.entityDigest,
        contentDigest: canonicalDigest({
          entityDigest: entry.entityDigest,
          scope: entry.scope,
          domain: entry.domain,
          sourceText,
        }),
        scope: entry.scope,
        domain: entry.domain,
        trust: 'untrusted',
        snapshotRevision,
        sourceText,
      }
    })
}

function publicUntrustedReference(reference) {
  return {
    schema: reference.schema,
    id: reference.id,
    entityDigest: reference.entityDigest,
    contentDigest: reference.contentDigest,
    scope: reference.scope,
    domain: reference.domain,
    trust: reference.trust,
    snapshotRevision: reference.snapshotRevision,
  }
}

function projectedDataQuality(overview, domains) {
  const input = record(overview.dataQuality, 'Advisor overview data quality')
  const projected = {}
  for (const domain of [...domains].sort(compareCanonicalText)) {
    if (!input.domains?.[domain]) continue
    projected[domain] = projectDataQualityDomain(input.domains[domain])
  }
  return {
    schema: text(input.schema, 'Advisor data quality schema', 120),
    snapshotRevision: text(input.snapshotRevision, 'Advisor data quality revision'),
    evaluatedAt: text(input.evaluatedAt, 'Advisor data quality evaluatedAt', 64),
    timeZone: text(input.timeZone, 'Advisor data quality timeZone', 80),
    rulesVersion: text(input.rulesVersion, 'Advisor data quality rules version', 120),
    domains: projected,
  }
}

function countDisclosedRecords({ evidence, selectedEntities, deterministicResults }) {
  const records = new Map()
  const add = (scope, key) => {
    if (!scope || !key) return
    if (!records.has(scope)) records.set(scope, new Set())
    records.get(scope).add(key)
  }
  for (const entry of evidence) add(entry.domain, entry.entityId)
  for (const entry of selectedEntities) {
    add(entry.scope, entry.entityDigest)
  }
  for (const entry of deterministicResults.courseDecisions) add('course-selection', entry.candidateId)
  return Object.fromEntries([...records.entries()]
    .sort(([left], [right]) => compareCanonicalText(left, right))
    .map(([scope, entries]) => [scope, entries.size]))
}

function consentChallenge({ input, intent, disclosure, selectedEntities }) {
  const sensitive = selectedEntities.filter((entry) => SENSITIVE_ADVISOR_SCOPES.includes(entry.scope))
  const requiredScopes = uniqueSorted(sensitive.map((entry) => entry.scope))
  const domains = uniqueSorted(sensitive.flatMap((entry) => [entry.domain, entry.scope]))
  const purpose = normalizeText(input.purpose, { trim: true }) || `advisor:${intent}`
  return {
    schema: ADVISOR_CONSENT_CHALLENGE_SCHEMA,
    requestId: text(input.requestId, 'Advisor requestId'),
    threadId: input.threadId === null || input.threadId === undefined ? null : text(input.threadId, 'Advisor threadId'),
    serviceIdentity: text(input.serviceIdentity, 'Advisor service identity', 1_024),
    purpose: text(purpose, 'Advisor purpose', 240),
    intent,
    domains,
    entityDigests: sensitive.map((entry) => entry.entityDigest).sort(compareCanonicalText),
    contextDigest: disclosure.contextDigest,
    requiredScopes,
  }
}

function draftAdvisorContext(inputValue) {
  const input = record(inputValue, 'Advisor context input')
  const overview = record(input.overview, 'Advisor overview')
  if (overview.schema !== ADVISOR_OVERVIEW_SCHEMA) throw new TypeError('Advisor overview schema is invalid')
  assertAdvisorOverview(overview)
  const intent = text(input.intent, 'Advisor intent', 32)
  if (!ADVISOR_INTENTS.includes(intent)) throw new TypeError(`Unsupported advisor intent: ${intent}`)
  const limits = limitsFrom(input.limits)
  const snapshotRevision = text(overview.snapshotRevision, 'Advisor overview revision')
  const evaluatedAt = parseInstant(overview.evaluatedAt)?.iso || null
  if (!evaluatedAt) throw new TypeError('Advisor overview evaluatedAt is invalid')
  const rulesVersion = text(overview.rulesVersion, 'Advisor overview rules version', 120)
  const question = sanitizeAdvisorUntrustedText(input.question, { maxLength: limits.maxQuestionLength })
  if (!question) throw new TypeError('Advisor question must be non-empty')
  const providerProfileId = text(input.providerProfileId, 'Advisor provider profile id', 240)
  const serviceIdentity = text(input.serviceIdentity, 'Advisor service identity', 1_024)
  const modelId = text(input.modelId, 'Advisor model id', 240)

  const overviewEvidence = (Array.isArray(overview.evidence) ? overview.evidence : []).map(projectAdvisorEvidence)
  const courseEvidence = Array.isArray(input.courseDecisions?.evidence)
    ? input.courseDecisions.evidence.map(projectAdvisorEvidence)
    : []
  const evidenceById = uniqueById([...overviewEvidence, ...courseEvidence], 'Advisor evidence')
  const overviewClaims = (Array.isArray(overview.claims) ? overview.claims : []).map(projectAdvisorClaim)
  const claimsById = uniqueById(overviewClaims, 'Advisor claim')
  const requestedClaimIds = stringSet(Array.isArray(input.claimIds) ? input.claimIds : [], 'claimIds')
  for (const id of requestedClaimIds) {
    if (!claimsById.has(id)) throw new TypeError(`Unknown requested advisor claim: ${id}`)
  }

  const focusDomains = selectedFocusDomains(input, intent)
  const hasExplicitFocus = Array.isArray(input.focusDomains) && input.focusDomains.length > 0
  for (const id of requestedClaimIds) {
    const domains = evidenceDomains(claimsById.get(id), evidenceById)
    if (!domains.length || domains.some((domain) => !focusDomains.has(domain))) {
      throw new TypeError(`Requested advisor claim is outside the ${intent} intent scope: ${id}`)
    }
  }
  const claimIds = new Set()
  const evidenceIds = new Set()
  const urgentItems = []
  const risks = []
  let omittedRecords = 0

  if (intent === 'daily') {
    const candidates = (Array.isArray(overview.urgentItems) ? overview.urgentItems : [])
      .map(projectAdvisorUrgentItem)
      .filter((item) => focusDomains.has(item.domain))
    for (const item of candidates) {
      if (urgentItems.length >= limits.maxUrgentItems) {
        omittedRecords += 1
        continue
      }
      if (!addReferencedItem({ item, itemOutput: urgentItems, claimIds, evidenceIds, maximumClaims: limits.maxClaims })) {
        omittedRecords += 1
      }
    }
  }

  if (intent === 'risk' || intent === 'general' || hasExplicitFocus) {
    const candidates = (Array.isArray(overview.risks) ? overview.risks : [])
      .map(projectAdvisorRisk)
      .filter((item) => focusDomains.has(item.domain))
    for (const item of candidates) {
      if (risks.length >= limits.maxRisks) {
        omittedRecords += 1
        continue
      }
      if (!addReferencedItem({ item, itemOutput: risks, claimIds, evidenceIds, maximumClaims: limits.maxClaims })) {
        omittedRecords += 1
      }
    }
  }

  for (const id of requestedClaimIds) claimIds.add(id)
  const domainClaims = hasExplicitFocus || ['risk', 'course', 'general'].includes(intent)
    ? overviewClaims.filter((claim) => {
        const domains = evidenceDomains(claim, evidenceById)
        return domains.length > 0 && domains.every((domain) => focusDomains.has(domain))
      })
    : []
  for (const claim of domainClaims) {
    if (claimIds.has(claim.id)) continue
    if (claimIds.size >= limits.maxClaims) {
      omittedRecords += 1
      continue
    }
    claimIds.add(claim.id)
  }
  if (claimIds.size > limits.maxClaims) throw new TypeError('Explicit advisor claim selection exceeds the claim budget')

  const rawCourseDecisions = intent === 'course' && Array.isArray(input.courseDecisions?.decisions)
    ? input.courseDecisions.decisions
    : []
  const courseDecisions = rawCourseDecisions.slice(0, limits.maxCourseDecisions).map(projectCourseDecision)
  omittedRecords += Math.max(0, rawCourseDecisions.length - courseDecisions.length)
  for (const decision of courseDecisions) {
    for (const id of decision.evidenceRefs) evidenceIds.add(id)
  }

  for (const id of claimIds) {
    const claim = claimsById.get(id)
    if (!claim) throw new TypeError(`Advisor request contains an unresolved claim: ${id}`)
    for (const evidenceId of claim.evidenceRefs) evidenceIds.add(evidenceId)
  }
  for (const evidenceId of evidenceIds) {
    if (!evidenceById.has(evidenceId)) throw new TypeError(`Advisor request contains unresolved evidence: ${evidenceId}`)
  }

  const selectedResult = projectSelectedEntities(input, intent, limits)
  omittedRecords += selectedResult.omitted
  const selectedEntities = selectedResult.selected
  const untrustedReferences = selectedEntityReferences(selectedEntities, snapshotRevision)
  const scopes = new Set([...focusDomains])
  for (const id of evidenceIds) scopes.add(evidenceById.get(id).domain)
  for (const entity of selectedEntities) {
    scopes.add(entity.domain)
    scopes.add(entity.scope)
  }

  const rawActions = Array.isArray(input.actions) ? input.actions : []
  if (rawActions.length > 64) throw new TypeError('Advisor action input exceeds the hard item limit')
  const inputActions = rawActions.map(projectAdvisorAction)
  const allowedActionKinds = new Set(INTENT_ACTION_KINDS[intent])
  for (const action of inputActions) {
    if (!allowedActionKinds.has(action.kind)) {
      throw new TypeError(`Advisor action ${action.kind} is not allowed for intent ${intent}`)
    }
  }
  const actionsById = uniqueById(inputActions, 'Advisor action')
  const requestedActionIds = stringSet(Array.isArray(input.actionIds) ? input.actionIds : [], 'actionIds')
  const contextualItemIds = new Set([...urgentItems, ...risks].map((item) => item.id))
  const courseProposalIds = new Set((Array.isArray(input.courseDecisions?.proposals) ? input.courseDecisions.proposals : [])
    .map((proposal) => normalizeText(proposal?.id, { trim: true }))
    .filter((id) => /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,239}$/.test(id)))
  for (const id of requestedActionIds) {
    if (!actionsById.has(id)) throw new TypeError(`Unknown requested advisor action: ${id}`)
    if (['daily', 'risk', 'general'].includes(intent) && !contextualItemIds.has(id)) {
      throw new TypeError(`Requested advisor action is outside the ${intent} intent scope: ${id}`)
    }
    if (['notice', 'mail'].includes(intent)) {
      throw new TypeError(`Advisor actions are not available for the ${intent} intent in v1`)
    }
    if (intent === 'course') {
      const action = actionsById.get(id)
      if (!action.proposalId || !courseProposalIds.has(action.proposalId)) {
        throw new TypeError(`Requested advisor action is outside the course intent scope: ${id}`)
      }
    }
  }
  const automaticActionIds = inputActions.filter((action) => contextualItemIds.has(action.id)).map((action) => action.id)
  const selectedActions = (requestedActionIds.length ? requestedActionIds : automaticActionIds)
    .map((id) => actionsById.get(id))
    .slice(0, limits.maxActions)
  omittedRecords += Math.max(0, (requestedActionIds.length || automaticActionIds.length) - selectedActions.length)

  const selectedClaims = [...claimIds].map((id) => claimsById.get(id)).sort((left, right) => compareCanonicalText(left.id, right.id))
  const selectedEvidence = [...evidenceIds].map((id) => evidenceById.get(id)).sort((left, right) => compareCanonicalText(left.id, right.id))
  const catalog = freezeRequestCatalog({
    snapshotRevision,
    evaluatedAt,
    rulesVersion,
    claims: selectedClaims,
    evidence: selectedEvidence,
    actions: selectedActions,
    untrustedReferences,
  })
  const deterministicResults = {
    urgentItems,
    risks,
    courseDecisions,
  }
  const dataQuality = projectedDataQuality(overview, scopes)
  const truncation = {
    applied: omittedRecords > 0,
    omittedDomains: [],
    omittedRecords,
  }
  const contextPayload = {
    schema: ADVISOR_CONTEXT_SCHEMA,
    intent,
    snapshotRevision,
    question,
    dataQuality,
    deterministicResults,
    localClaims: catalog.claims,
    allowedActions: catalog.actions,
    evidenceCatalog: catalog.evidence,
    untrustedReferences: catalog.untrustedReferences.map(publicUntrustedReference),
    untrustedSources: selectedEntities.map(({ entityRef, entityDigest, scope, domain }) => ({
      entityRef,
      entityDigest,
      scope,
      domain,
    })),
    domainData: selectedEntities,
    truncation,
  }
  if (Buffer.byteLength(JSON.stringify(contextPayload), 'utf8') > limits.maxInputBytes) {
    throw new TypeError('Advisor context exceeds the input byte budget')
  }
  const contextDigest = canonicalDigest(contextPayload)
  const recordCounts = countDisclosedRecords({
    evidence: catalog.evidence,
    selectedEntities,
    deterministicResults,
  })
  for (const scope of scopes) {
    if (!Object.hasOwn(recordCounts, scope)) recordCounts[scope] = 0
  }
  const orderedRecordCounts = Object.fromEntries(Object.entries(recordCounts)
    .sort(([left], [right]) => compareCanonicalText(left, right)))
  const disclosure = {
    schema: ADVISOR_DISCLOSURE_SCHEMA,
    providerProfileId,
    serviceIdentity,
    modelId,
    intent,
    scopes: [...scopes].sort(compareCanonicalText),
    recordCounts: orderedRecordCounts,
    containsMailBody: selectedEntities.some((entry) => entry.scope === 'mail-body'),
    containsProfileIdentity: selectedEntities.some((entry) => entry.scope === 'identity'),
    containsFitness: selectedEntities.some((entry) => entry.scope === 'fitness'),
    containsAttachmentText: selectedEntities.some((entry) => entry.scope === 'attachment-text'),
    estimatedInputUnits: Math.ceil(Buffer.byteLength(JSON.stringify(contextPayload), 'utf8') / 4),
    snapshotRevision,
    contextDigest,
  }
  const challenge = consentChallenge({ input: { ...input, serviceIdentity }, intent, disclosure, selectedEntities })
  return {
    context: { ...contextPayload, disclosure },
    disclosure,
    catalog,
    consentChallenge: challenge,
  }
}

export class AdvisorConsentError extends Error {
  constructor(code, message, details = null) {
    super(message)
    this.name = 'AdvisorConsentError'
    this.code = code
    this.details = details
  }
}

function sameSortedValues(left, right) {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

export function assertAdvisorConsent(value, challenge, { now } = {}) {
  const expected = record(challenge, 'Advisor consent challenge')
  if (!expected.requiredScopes?.length) return null
  if (!value) throw new AdvisorConsentError('consent_required', 'Sensitive advisor context requires consent', expected)
  try {
    exactKeys(value, CONSENT_KEYS, 'Advisor consent')
  } catch (error) {
    throw new AdvisorConsentError('consent_invalid', error.message)
  }
  if (value.schema !== ADVISOR_CONSENT_SCHEMA) throw new AdvisorConsentError('consent_invalid', 'Advisor consent schema is invalid')
  if (typeof value.grantedAt !== 'string' || typeof value.expiresAt !== 'string') {
    throw new AdvisorConsentError('consent_invalid', 'Advisor consent times must be explicit date-time strings')
  }
  const grantedAt = parseInstant(value.grantedAt)
  const expiresAt = parseInstant(value.expiresAt)
  const checkedAt = parseInstant(now)
  if (!grantedAt || !expiresAt || !checkedAt) throw new AdvisorConsentError('consent_invalid', 'Advisor consent times are invalid')
  if (expiresAt.milliseconds <= grantedAt.milliseconds
    || expiresAt.milliseconds - grantedAt.milliseconds > 15 * 60 * 1000) {
    throw new AdvisorConsentError('consent_invalid', 'Advisor consent lifetime is invalid')
  }
  if (checkedAt.milliseconds < grantedAt.milliseconds || checkedAt.milliseconds >= expiresAt.milliseconds) {
    throw new AdvisorConsentError('consent_expired', 'Advisor consent is not active')
  }
  const pairs = [
    ['serviceIdentity', expected.serviceIdentity],
    ['purpose', expected.purpose],
    ['requestId', expected.requestId],
    ['threadId', expected.threadId],
    ['contextDigest', expected.contextDigest],
  ]
  for (const [key, expectedValue] of pairs) {
    if (value[key] !== expectedValue) throw new AdvisorConsentError('consent_mismatch', `Advisor consent ${key} mismatch`)
  }
  let domains
  let entityDigests
  try {
    domains = stringSet(value.domains, 'Advisor consent domains')
    entityDigests = stringSet(value.entityDigests, 'Advisor consent entity digests')
  } catch (error) {
    throw new AdvisorConsentError('consent_invalid', error.message)
  }
  if (!sameSortedValues(domains, [...expected.domains].sort(compareCanonicalText))) {
    throw new AdvisorConsentError('consent_mismatch', 'Advisor consent domain scope mismatch')
  }
  if (!sameSortedValues(entityDigests, [...expected.entityDigests].sort(compareCanonicalText))) {
    throw new AdvisorConsentError('consent_mismatch', 'Advisor consent entity digest mismatch')
  }
  return value
}

export function planAdvisorDisclosure(input) {
  const draft = draftAdvisorContext(input)
  return deepFreeze({ disclosure: draft.disclosure, consentChallenge: draft.consentChallenge })
}

export function buildAdvisorContext(input) {
  const draft = draftAdvisorContext(input)
  assertAdvisorConsent(input.consent, draft.consentChallenge, { now: input.now })
  return deepFreeze(draft)
}
