import { normalizeText, shortDigest, uniqueSorted } from './canonical.mjs'

export const LOCAL_CLAIM_SCHEMA = 'theia-advisor-local-claim/v1'
export const CREDIT_SCALE = 10_000
export const GPA_SCALE = 10_000
export const CONFIDENCE_RANK = new Map([['unknown', 0], ['low', 1], ['medium', 2], ['high', 3]])
export const COMPLETENESS_RANK = new Map([['unknown', 0], ['partial', 1], ['complete', 2]])
export const EXPLICIT_FAILURE = /缺考|不合格|不及格|未通过|挂科|违纪|作弊|未修读通过/i

export function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export function arrayValue(value) {
  return Array.isArray(value) ? value : []
}

export function text(value) {
  return normalizeText(value, { trim: true })
}

export function finiteNonNegative(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

export function optionalFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function signedUnits(value, scale = CREDIT_SCALE) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number * scale) : null
}

export function formatUnits(units, scale = CREDIT_SCALE) {
  if (!Number.isSafeInteger(units)) return null
  const sign = units < 0 ? '-' : ''
  const absolute = Math.abs(units)
  const whole = Math.trunc(absolute / scale)
  const fraction = String(absolute % scale).padStart(String(scale).length - 1, '0')
  return `${sign}${whole}.${fraction}`
}

export function fixed(value, scale = CREDIT_SCALE) {
  const units = signedUnits(value, scale)
  return units === null ? null : formatUnits(units, scale)
}

export function addKnown(values, scale = CREDIT_SCALE) {
  const units = values.map((value) => signedUnits(value, scale))
  return units.some((value) => value === null) ? null : formatUnits(units.reduce((sum, value) => sum + value, 0), scale)
}

export function subtractKnown(left, right, { floorAtZero = false, scale = CREDIT_SCALE } = {}) {
  const leftUnits = signedUnits(left, scale)
  const rightUnits = signedUnits(right, scale)
  if (leftUnits === null || rightUnits === null) return null
  return formatUnits(floorAtZero ? Math.max(0, leftUnits - rightUnits) : leftUnits - rightUnits, scale)
}

export function minimumConfidence(...values) {
  const normalized = values.flat().filter((value) => CONFIDENCE_RANK.has(value))
  if (!normalized.length) return 'unknown'
  return normalized.sort((left, right) => CONFIDENCE_RANK.get(left) - CONFIDENCE_RANK.get(right))[0]
}

export function qualityConfidence(quality) {
  if (!quality || quality.provenanceInferred) return 'unknown'
  if (['failed', 'auth-required'].includes(quality.lastAttempt?.status)) {
    return quality.lastAttempt?.retainedPrevious && quality.availability === 'available' ? 'low' : 'unknown'
  }
  if (quality.freshness === 'fresh' && quality.completeness === 'complete') return 'high'
  if (quality.freshness === 'fresh' || quality.availability === 'available') return 'medium'
  return 'unknown'
}

export function qualitySummary(quality) {
  return {
    availability: quality?.availability || 'unknown',
    freshness: quality?.freshness || 'unknown',
    completeness: quality?.completeness || 'unknown',
    lastAttemptStatus: quality?.lastAttempt?.status || 'never',
  }
}

export function weakerCompleteness(...values) {
  const normalized = values.flat().filter((value) => COMPLETENESS_RANK.has(value))
  if (!normalized.length) return 'unknown'
  return normalized.sort((left, right) => COMPLETENESS_RANK.get(left) - COMPLETENESS_RANK.get(right))[0]
}

export function registerEvidence(registry, specification) {
  const entry = registry.register(specification)
  registry.disclose(entry.id, specification.fields)
  return registry.get(entry.id)
}

export function claimId({ kind, subject, predicate, evidence, fields, rulesVersion }) {
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

export function localClaim(registry, {
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

export function riskId(kind, entityId, rulesVersion) {
  return `risk:${kind}:${shortDigest({ kind, entityId: text(entityId), rulesVersion }, 16)}`
}

export function academicRisk({
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

export function requirementSubject(id) {
  return `academic-requirement:${shortDigest({ id: text(id) }, 16)}`
}
