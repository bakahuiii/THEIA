import { Buffer } from 'node:buffer'
import { canonicalDigest, canonicalJson, compareCanonicalText, normalizeText, parseInstant } from './canonical.mjs'
import {
  ADVISOR_MODEL_NARRATIVE_SCHEMA,
  ADVISOR_REQUEST_CATALOG_SCHEMA,
  ADVISOR_UNTRUSTED_REFERENCE_SCHEMA,
} from './contracts.mjs'
import {
  advisorTextHasPolicyViolation,
  projectAdvisorAction,
  projectAdvisorClaim,
  projectAdvisorEvidence,
} from './redaction.mjs'

const DEFAULT_LIMITS = Object.freeze({
  maxOutputBytes: 1_000_000,
  maxBlocks: 32,
  maxRecommendations: 8,
  maxReferencesPerItem: 32,
  maxUncertainties: 16,
  maxQuestions: 8,
  maxSuggestedActions: 8,
  maxTextLength: 8_000,
})

const TOP_LEVEL_KEYS = Object.freeze([
  'schema',
  'blocks',
  'recommendations',
  'uncertainties',
  'questionsForUser',
  'suggestedActionIds',
])
const BLOCK_KEYS = Object.freeze(['claimIds', 'explanation'])
const BLOCK_REFERENCE_KEYS = Object.freeze(['claimIds', 'referenceIds', 'explanation'])
const RECOMMENDATION_KEYS = Object.freeze(['text', 'basedOnClaimIds'])
const RECOMMENDATION_REFERENCE_KEYS = Object.freeze(['text', 'basedOnClaimIds', 'basedOnReferenceIds'])
const CATALOG_KEYS = Object.freeze([
  'schema',
  'snapshotRevision',
  'evaluatedAt',
  'rulesVersion',
  'claims',
  'evidence',
  'actions',
  'untrustedReferences',
  'digest',
])

const ACTIVE_HTML_MARKUP = /(?:<!--[\s\S]*?-->|<!doctype\b[^>]*>|<\/?[a-z][a-z0-9:-]*(?:\s[^<>]*?)?\s*\/?>)/iu
const PROTOCOL_RELATIVE_MARKDOWN_LINK = /!?\[[^\]\r\n]*\]\(\s*\/\/[^)\s]+(?:\s+["'][^)]*["'])?\s*\)/iu
const C0_C1_CONTROL = /[\u0000-\u001f\u007f-\u009f]/u
const BIDI_OR_INVISIBLE_CONTROL = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufeff\uffa0]/u
const UNSUPPORTED_FINAL_DECISION = /(?:(?:你|您|本人|学生|该生)?\s*(?:(?:已|已经|将|必将|会|确定|确认|认定|肯定|一定|必然|必定|绝对|铁定)\s*)?(?:被\s*)?(?:学校|学院|校方)?\s*(?:开除(?:了)?|劝退|退学|处分)|(?:学校|学院|校方)\s*(?:已|已经|将|决定|确认|认定|要求)\s*.{0,12}(?:开除|劝退|退学|处分|毕业资格|录取|学位授予)|(?:学校|学院|校方).{0,12}(?:取消|撤销).{0,8}(?:学位|毕业资格|录取)|(?:预计|预测|可能|大概率|很可能|有望|将|会|不会|无法|不能|不可能|肯定|确定|一定|必然|必定|绝对|铁定).{0,16}(?:毕业|拿到学位|获得学位|被录取|录取结果)|(?:毕业|录取|学位).{0,6}(?:没问题|稳了|确定无疑)|(?:录取(?:通知|资格|结果)?|学位|毕业资格).{0,6}(?:已|已经)?(?:被)?(?:作废|取消|撤销|无效|拒绝)|(?:已|已经|确定|确认)?\s*(?:具备|不具备|失去|获得|取消)\s*(?:毕业资格|录取资格|学位授予资格)|(?:录取|学位|毕业资格)\s*(?:无法|不能)\s*(?:获得|保留))/iu
const UNTRUSTED_REFERENCE_SCOPES = new Set(['notices', 'mailbox', 'mail-body', 'attachment-text'])
const UNTRUSTED_UNCERTAINTY_ALLOWLIST = new Set([
  '所选内容来自未验证来源，需人工核验。',
  '请求上下文已截断，回答可能不完整。',
])

export const ADVISOR_NARRATIVE_UNCERTAINTIES = Object.freeze({
  untrusted: '所选内容来自未验证来源，需人工核验。',
  truncated: '请求上下文已截断，回答可能不完整。',
})

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdvisorNarrativeError('schema_invalid', `${label} must be an object`)
  }
  return value
}

function mergedLimits(value = {}) {
  const output = { ...DEFAULT_LIMITS }
  for (const key of Object.keys(DEFAULT_LIMITS)) {
    const candidate = Math.trunc(Number(value?.[key]))
    if (Number.isFinite(candidate) && candidate > 0) output[key] = Math.min(DEFAULT_LIMITS[key], candidate)
  }
  return output
}

function assertExactKeys(value, keys, label) {
  const expected = [...keys].sort(compareCanonicalText)
  const actual = Object.keys(record(value, label)).sort(compareCanonicalText)
  if (expected.length !== actual.length || expected.some((key, index) => key !== actual[index])) {
    throw new AdvisorNarrativeError('schema_invalid', `${label} contains missing or unknown fields`)
  }
}

function assertOneExactKeySet(value, keySets, label) {
  const actual = Object.keys(record(value, label)).sort(compareCanonicalText)
  const matched = keySets.some((keys) => {
    const expected = [...keys].sort(compareCanonicalText)
    return expected.length === actual.length && expected.every((key, index) => key === actual[index])
  })
  if (!matched) throw new AdvisorNarrativeError('schema_invalid', `${label} contains missing or unknown fields`)
}

function controlledIdentifier(value, label, maximum = 240) {
  const output = normalizeText(value, { trim: true })
  if (!output || output.length > maximum || !/^[a-zA-Z0-9][a-zA-Z0-9:._-]*$/u.test(output)) {
    throw new TypeError(`${label} must be a controlled identifier`)
  }
  return output
}

function projectUntrustedReference(value, snapshotRevision) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Untrusted reference must be an object')
  const schema = normalizeText(value.schema, { trim: true })
  const id = controlledIdentifier(value.id, 'Untrusted reference id')
  const entityDigest = normalizeText(value.entityDigest, { trim: true }).toLowerCase()
  const contentDigest = normalizeText(value.contentDigest, { trim: true }).toLowerCase()
  const scope = controlledIdentifier(value.scope, 'Untrusted reference scope', 64)
  const domain = controlledIdentifier(value.domain, 'Untrusted reference domain', 64)
  const sourceText = typeof value.sourceText === 'string' ? value.sourceText : ''
  if (schema !== ADVISOR_UNTRUSTED_REFERENCE_SCHEMA || value.trust !== 'untrusted') {
    throw new TypeError('Untrusted reference trust contract is invalid')
  }
  if (!UNTRUSTED_REFERENCE_SCOPES.has(scope) || (scope === 'mail-body' && domain !== 'mailbox')) {
    throw new TypeError('Untrusted reference scope is invalid')
  }
  if ((scope === 'notices' && domain !== 'notices') || (scope === 'mailbox' && domain !== 'mailbox')) {
    throw new TypeError('Untrusted reference domain binding is invalid')
  }
  let sourceRecord
  try {
    sourceRecord = JSON.parse(sourceText)
  } catch {
    throw new TypeError('Untrusted reference source text must be canonical JSON')
  }
  if (!sourceRecord || typeof sourceRecord !== 'object' || Array.isArray(sourceRecord)
    || canonicalJson(sourceRecord) !== sourceText) {
    throw new TypeError('Untrusted reference source text must be canonical JSON')
  }
  const expectedEntityDigest = canonicalDigest({
    schema: 'theia-advisor-selected-entity/v1',
    scope,
    domain,
    record: sourceRecord,
  })
  if (!/^[a-f0-9]{64}$/u.test(entityDigest) || id !== `entity:${entityDigest.slice(0, 20)}`) {
    throw new TypeError('Untrusted reference entity binding is invalid')
  }
  if (entityDigest !== expectedEntityDigest) throw new TypeError('Untrusted reference entity digest mismatch')
  if (!sourceText || Buffer.byteLength(sourceText, 'utf8') > 64_000) {
    throw new TypeError('Untrusted reference source text is invalid')
  }
  const expectedContentDigest = canonicalDigest({ entityDigest, scope, domain, sourceText })
  if (contentDigest !== expectedContentDigest) throw new TypeError('Untrusted reference content digest mismatch')
  const referenceRevision = normalizeText(value.snapshotRevision, { trim: true })
  if (referenceRevision !== snapshotRevision) throw new TypeError('Untrusted reference revision mismatch')
  return {
    schema: ADVISOR_UNTRUSTED_REFERENCE_SCHEMA,
    id,
    entityDigest,
    contentDigest,
    scope,
    domain,
    trust: 'untrusted',
    snapshotRevision,
    sourceText,
  }
}

function boundedText(value, label, maxLength, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') throw new AdvisorNarrativeError('schema_invalid', `${label} must be a string`)
  const text = normalizeText(value, { trim: true })
  if ((!allowEmpty && !text) || text.length > maxLength) {
    throw new AdvisorNarrativeError('limit_exceeded', `${label} is empty or too long`)
  }
  if (C0_C1_CONTROL.test(text) || BIDI_OR_INVISIBLE_CONTROL.test(text)) {
    throw new AdvisorNarrativeError('policy_denied', `${label} contains invisible or directional control characters`)
  }
  if (advisorTextHasPolicyViolation(text)) {
    throw new AdvisorNarrativeError('policy_denied', `${label} contains a URL, path, or credential-like value`)
  }
  if (ACTIVE_HTML_MARKUP.test(text)) {
    throw new AdvisorNarrativeError('policy_denied', `${label} contains HTML markup`)
  }
  if (PROTOCOL_RELATIVE_MARKDOWN_LINK.test(text)) {
    throw new AdvisorNarrativeError('policy_denied', `${label} contains a protocol-relative Markdown link`)
  }
  if (UNSUPPORTED_FINAL_DECISION.test(text)) {
    throw new AdvisorNarrativeError('model_mismatch', `${label} asserts an unsupported institutional final decision`)
  }
  return text
}

function boundedStringArray(value, label, { maxItems, maxTextLength, allowEmpty = true }) {
  if (!Array.isArray(value)) throw new AdvisorNarrativeError('schema_invalid', `${label} must be an array`)
  if (value.length > maxItems || (!allowEmpty && value.length === 0)) {
    throw new AdvisorNarrativeError('limit_exceeded', `${label} has an invalid item count`)
  }
  return value.map((item, index) => boundedText(item, `${label}[${index}]`, maxTextLength))
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) {
    throw new AdvisorNarrativeError('citation_invalid', `${label} contains duplicate references`)
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function assertNoDuplicateJsonKeys(text) {
  const stack = []
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '{') {
      stack.push({ type: 'object', keys: new Set() })
      continue
    }
    if (character === '[') {
      stack.push({ type: 'array' })
      continue
    }
    if (character === '}' || character === ']') {
      stack.pop()
      continue
    }
    if (character !== '"') continue
    const start = index
    let escaped = false
    for (index += 1; index < text.length; index += 1) {
      const current = text[index]
      if (escaped) {
        escaped = false
        continue
      }
      if (current === '\\') {
        escaped = true
        continue
      }
      if (current === '"') break
    }
    let cursor = index + 1
    while (/\s/u.test(text[cursor] || '')) cursor += 1
    const frame = stack.at(-1)
    if (text[cursor] !== ':' || frame?.type !== 'object') continue
    let key
    try {
      key = JSON.parse(text.slice(start, index + 1))
    } catch {
      continue
    }
    if (frame.keys.has(key)) throw new AdvisorNarrativeError('malformed_json', 'Model narrative contains duplicate JSON keys')
    frame.keys.add(key)
  }
}

function normalizeCatalogDescriptor(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Request catalog must be an object')
  const snapshotRevision = normalizeText(input.snapshotRevision, { trim: true })
  const evaluatedAt = parseInstant(input.evaluatedAt)?.iso || null
  const rulesVersion = normalizeText(input.rulesVersion, { trim: true })
  if (!snapshotRevision || !evaluatedAt || !rulesVersion) {
    throw new TypeError('Request catalog identity is invalid')
  }
  const claims = (Array.isArray(input.claims) ? input.claims : []).map(projectAdvisorClaim)
    .sort((left, right) => compareCanonicalText(left.id, right.id))
  const evidence = (Array.isArray(input.evidence) ? input.evidence : []).map(projectAdvisorEvidence)
    .sort((left, right) => compareCanonicalText(left.id, right.id))
  const actions = (Array.isArray(input.actions) ? input.actions : []).map(projectAdvisorAction)
    .sort((left, right) => compareCanonicalText(left.id, right.id))
  const untrustedReferences = (Array.isArray(input.untrustedReferences) ? input.untrustedReferences : [])
    .map((entry) => projectUntrustedReference(entry, snapshotRevision))
    .sort((left, right) => compareCanonicalText(left.id, right.id))
  for (const [label, items] of [
    ['claim', claims],
    ['evidence', evidence],
    ['action', actions],
    ['untrusted reference', untrustedReferences],
  ]) {
    const ids = items.map((item) => item.id)
    if (new Set(ids).size !== ids.length) throw new TypeError(`Request catalog ${label} IDs must be unique`)
  }
  const evidenceIds = new Set(evidence.map((entry) => entry.id))
  for (const entry of evidence) {
    if (entry.snapshotRevision !== snapshotRevision) throw new TypeError(`Evidence ${entry.id} revision mismatch`)
    if (!/^[a-f0-9]{64}$/.test(entry.domainDigest) || !/^[a-f0-9]{64}$/.test(entry.evidenceDigest)) {
      throw new TypeError(`Evidence ${entry.id} digest is invalid`)
    }
  }
  for (const claim of claims) {
    if (!['fact', 'computed'].includes(claim.kind)) throw new TypeError(`Claim ${claim.id} is not a local fact/computed claim`)
    if (claim.rulesVersion !== rulesVersion) throw new TypeError(`Claim ${claim.id} rules version mismatch`)
    if (!claim.evidenceRefs.length || claim.evidenceRefs.some((id) => !evidenceIds.has(id))) {
      throw new TypeError(`Claim ${claim.id} contains unresolved evidence`)
    }
  }
  return {
    schema: ADVISOR_REQUEST_CATALOG_SCHEMA,
    snapshotRevision,
    evaluatedAt,
    rulesVersion,
    claims,
    evidence,
    actions,
    untrustedReferences,
  }
}

export function freezeRequestCatalog(input) {
  const descriptor = normalizeCatalogDescriptor(input)
  return deepFreeze({ ...descriptor, digest: canonicalDigest(descriptor) })
}

export function assertRequestCatalog(value) {
  assertExactKeys(value, CATALOG_KEYS, 'Request catalog')
  if (value.schema !== ADVISOR_REQUEST_CATALOG_SCHEMA) throw new TypeError('Request catalog schema is invalid')
  const normalized = freezeRequestCatalog(value)
  if (normalized.digest !== value.digest) throw new TypeError('Request catalog digest mismatch')
  return normalized
}

export class AdvisorNarrativeError extends Error {
  constructor(code, message, details = null) {
    super(message)
    this.name = 'AdvisorNarrativeError'
    this.code = code
    this.details = details
  }
}

export function parseModelNarrative(text, options = {}) {
  const limits = mergedLimits(options.limits)
  if (typeof text !== 'string') throw new AdvisorNarrativeError('malformed_json', 'Model narrative must be a string')
  if (Buffer.byteLength(text, 'utf8') > limits.maxOutputBytes) {
    throw new AdvisorNarrativeError('limit_exceeded', 'Model narrative exceeds the output byte limit')
  }
  const trimmed = text.trim()
  if (!trimmed || /^```/u.test(trimmed) || /```$/u.test(trimmed)) {
    throw new AdvisorNarrativeError('malformed_json', 'Model narrative must be one bare JSON object')
  }
  assertNoDuplicateJsonKeys(trimmed)
  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new AdvisorNarrativeError('malformed_json', 'Model narrative is not one complete JSON object')
  }
  assertExactKeys(parsed, TOP_LEVEL_KEYS, 'Model narrative')
  if (parsed.schema !== ADVISOR_MODEL_NARRATIVE_SCHEMA) {
    throw new AdvisorNarrativeError('schema_invalid', 'Model narrative schema is invalid')
  }
  if (!Array.isArray(parsed.blocks) || parsed.blocks.length > limits.maxBlocks) {
    throw new AdvisorNarrativeError('limit_exceeded', 'Model narrative blocks are invalid')
  }
  const blocks = parsed.blocks.map((blockValue, index) => {
    const label = `Model narrative block ${index}`
    assertOneExactKeySet(blockValue, [BLOCK_KEYS, BLOCK_REFERENCE_KEYS], label)
    const claimIds = boundedStringArray(blockValue.claimIds, `${label}.claimIds`, {
      maxItems: limits.maxReferencesPerItem,
      maxTextLength: 240,
    })
    const referenceIds = boundedStringArray(blockValue.referenceIds ?? [], `${label}.referenceIds`, {
      maxItems: limits.maxReferencesPerItem,
      maxTextLength: 240,
    })
    assertUnique(claimIds, `${label}.claimIds`)
    assertUnique(referenceIds, `${label}.referenceIds`)
    if (claimIds.length + referenceIds.length === 0) {
      throw new AdvisorNarrativeError('citation_invalid', `${label} must cite a local claim or untrusted reference`)
    }
    if (claimIds.length && referenceIds.length) {
      throw new AdvisorNarrativeError('citation_invalid', `${label} cannot mix local claims with untrusted references`)
    }
    if (referenceIds.length > 1) {
      throw new AdvisorNarrativeError('citation_invalid', `${label} must bind to exactly one untrusted entity`)
    }
    return {
      claimIds,
      referenceIds,
      explanation: boundedText(blockValue.explanation, `${label}.explanation`, limits.maxTextLength),
    }
  })
  const blockSignatures = blocks.map((block) => (
    `${[...block.claimIds].sort(compareCanonicalText).join('\u0000')}\u0001${[...block.referenceIds].sort(compareCanonicalText).join('\u0000')}`
  ))
  if (new Set(blockSignatures).size !== blockSignatures.length) {
    throw new AdvisorNarrativeError('citation_invalid', 'Model narrative contains duplicate claim blocks')
  }
  if (!Array.isArray(parsed.recommendations) || parsed.recommendations.length > limits.maxRecommendations) {
    throw new AdvisorNarrativeError('limit_exceeded', 'Model narrative recommendations are invalid')
  }
  const recommendations = parsed.recommendations.map((recommendationValue, index) => {
    const label = `Model narrative recommendation ${index}`
    assertOneExactKeySet(recommendationValue, [RECOMMENDATION_KEYS, RECOMMENDATION_REFERENCE_KEYS], label)
    const basedOnClaimIds = boundedStringArray(recommendationValue.basedOnClaimIds, `${label}.basedOnClaimIds`, {
      maxItems: limits.maxReferencesPerItem,
      maxTextLength: 240,
    })
    const basedOnReferenceIds = boundedStringArray(
      recommendationValue.basedOnReferenceIds ?? [],
      `${label}.basedOnReferenceIds`,
      { maxItems: limits.maxReferencesPerItem, maxTextLength: 240 },
    )
    if (basedOnClaimIds.length + basedOnReferenceIds.length === 0) {
      throw new AdvisorNarrativeError('citation_invalid', `${label} must cite a local claim or untrusted reference`)
    }
    if (basedOnClaimIds.length && basedOnReferenceIds.length) {
      throw new AdvisorNarrativeError('citation_invalid', `${label} cannot mix local claims with untrusted references`)
    }
    if (basedOnReferenceIds.length > 1) {
      throw new AdvisorNarrativeError('citation_invalid', `${label} must bind to exactly one untrusted entity`)
    }
    assertUnique(basedOnClaimIds, `${label}.basedOnClaimIds`)
    assertUnique(basedOnReferenceIds, `${label}.basedOnReferenceIds`)
    return {
      text: boundedText(recommendationValue.text, `${label}.text`, limits.maxTextLength),
      basedOnClaimIds,
      basedOnReferenceIds,
    }
  })
  const recommendationSignatures = recommendations.map((item) => (
    `${item.text}\u0000${[...item.basedOnClaimIds].sort(compareCanonicalText).join('\u0000')}\u0001${[...item.basedOnReferenceIds].sort(compareCanonicalText).join('\u0000')}`
  ))
  if (new Set(recommendationSignatures).size !== recommendationSignatures.length) {
    throw new AdvisorNarrativeError('citation_invalid', 'Model narrative contains duplicate recommendations')
  }
  const uncertainties = boundedStringArray(parsed.uncertainties, 'Model narrative uncertainties', {
    maxItems: limits.maxUncertainties,
    maxTextLength: limits.maxTextLength,
  })
  const questionsForUser = boundedStringArray(parsed.questionsForUser, 'Model narrative questionsForUser', {
    maxItems: limits.maxQuestions,
    maxTextLength: limits.maxTextLength,
  })
  if ([...uncertainties, ...questionsForUser].some((item) => numericTokens(item).length > 0)) {
    throw new AdvisorNarrativeError('citation_invalid', 'Uncertainties and questions cannot carry uncited numeric claims')
  }
  const suggestedActionIds = boundedStringArray(parsed.suggestedActionIds, 'Model narrative suggestedActionIds', {
    maxItems: limits.maxSuggestedActions,
    maxTextLength: 240,
  })
  assertUnique(suggestedActionIds, 'Model narrative suggestedActionIds')
  return deepFreeze({
    schema: ADVISOR_MODEL_NARRATIVE_SCHEMA,
    blocks,
    recommendations,
    uncertainties,
    questionsForUser,
    suggestedActionIds,
  })
}

function numericTokens(value) {
  const normalized = normalizeText(value).normalize('NFKC')
  const arabic = (normalized.match(/[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[-+]?\d+)?/giu) || []).map((token) => {
    const number = Number(token)
    return Number.isFinite(number) ? String(number) : token
  })
  const chinese = normalized.match(/[零〇一二两三四五六七八九十百千万亿点]+(?=\s*(?:学分|绩点|分|门|次|天|小时|分钟|周|年|月|日|%))/gu) || []
  const contextualChinese = [...normalized.matchAll(/(?:\bGPA\b|绩点)\s*(?:是|为|=|:|：)?\s*([零〇一二两三四五六七八九十百千万亿点]+)/giu)]
    .map((match) => match[1])
  return [...arabic, ...chinese, ...contextualChinese]
}

function allowedNumbersForSources(claimIds, referenceIds, claimsById, referencesById) {
  const output = new Set()
  for (const id of claimIds) {
    const claim = claimsById.get(id)
    for (const token of numericTokens(claim?.displayText)) output.add(token)
    for (const token of numericTokens(JSON.stringify(claim?.value ?? null))) output.add(token)
  }
  for (const id of referenceIds) {
    for (const token of numericTokens(referencesById.get(id)?.sourceText)) output.add(token)
  }
  return output
}

function verifyNumbers(text, claimIds, referenceIds, claimsById, referencesById, label) {
  const actual = numericTokens(text)
  if (actual.length && claimIds.length + referenceIds.length !== 1) {
    throw new AdvisorNarrativeError('model_mismatch', `${label} may restate numbers only when it cites exactly one source`)
  }
  const allowed = allowedNumbersForSources(claimIds, referenceIds, claimsById, referencesById)
  const unexpected = actual.filter((token) => !allowed.has(token))
  if (unexpected.length) {
    throw new AdvisorNarrativeError('model_mismatch', `${label} contains numeric literals not present in its cited claims`, {
      numericLiterals: [...new Set(unexpected)].slice(0, 8),
    })
  }
}

export class CitationVerifier {
  constructor(catalog, options = {}) {
    this.catalog = assertRequestCatalog(catalog)
    this.options = options
    this.claimsById = new Map(this.catalog.claims.map((claim) => [claim.id, claim]))
    this.actionsById = new Map(this.catalog.actions.map((action) => [action.id, action]))
    this.referencesById = new Map(this.catalog.untrustedReferences.map((reference) => [reference.id, reference]))
  }

  verify(text) {
    const narrative = parseModelNarrative(text, this.options)
    for (const [index, block] of narrative.blocks.entries()) {
      const unknown = block.claimIds.filter((id) => !this.claimsById.has(id))
      if (unknown.length) {
        throw new AdvisorNarrativeError('citation_invalid', `Model narrative block ${index} cites unknown claims`, { claimIds: unknown })
      }
      const unknownReferences = block.referenceIds.filter((id) => !this.referencesById.has(id))
      if (unknownReferences.length) {
        throw new AdvisorNarrativeError('citation_invalid', `Model narrative block ${index} cites unknown untrusted references`, { referenceIds: unknownReferences })
      }
      verifyNumbers(
        block.explanation,
        block.claimIds,
        block.referenceIds,
        this.claimsById,
        this.referencesById,
        `Model narrative block ${index}`,
      )
    }
    for (const [index, recommendation] of narrative.recommendations.entries()) {
      const unknown = recommendation.basedOnClaimIds.filter((id) => !this.claimsById.has(id))
      if (unknown.length) {
        throw new AdvisorNarrativeError('citation_invalid', `Model narrative recommendation ${index} cites unknown claims`, { claimIds: unknown })
      }
      const unknownReferences = recommendation.basedOnReferenceIds.filter((id) => !this.referencesById.has(id))
      if (unknownReferences.length) {
        throw new AdvisorNarrativeError('citation_invalid', `Model narrative recommendation ${index} cites unknown untrusted references`, { referenceIds: unknownReferences })
      }
      verifyNumbers(
        recommendation.text,
        recommendation.basedOnClaimIds,
        recommendation.basedOnReferenceIds,
        this.claimsById,
        this.referencesById,
        `Model narrative recommendation ${index}`,
      )
    }
    const unknownActions = narrative.suggestedActionIds.filter((id) => !this.actionsById.has(id))
    if (unknownActions.length) {
      throw new AdvisorNarrativeError('citation_invalid', 'Model narrative cites unknown actions', { actionIds: unknownActions })
    }
    if (this.catalog.untrustedReferences.length) {
      if (narrative.questionsForUser.length) {
        throw new AdvisorNarrativeError('citation_invalid', 'Questions cannot carry selected untrusted entity content')
      }
      const unsafeUncertainties = narrative.uncertainties.filter((item) => !UNTRUSTED_UNCERTAINTY_ALLOWLIST.has(item))
      if (unsafeUncertainties.length) {
        throw new AdvisorNarrativeError('citation_invalid', 'Uncertainties cannot carry selected untrusted entity content')
      }
    }
    if (this.options.truncation?.applied === true && narrative.uncertainties.length === 0) {
      throw new AdvisorNarrativeError('schema_invalid', 'A truncated context requires an explicit uncertainty')
    }
    return narrative
  }
}

export function verifyModelNarrative(text, catalog, options = {}) {
  return new CitationVerifier(catalog, options).verify(text)
}
