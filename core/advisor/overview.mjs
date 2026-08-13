import { canonicalJson, compareCanonicalText, requireInstant } from './canonical.mjs'
import { buildAgenda } from './agenda-engine.mjs'
import { normalizeAdvisorOptions, normalizeVersionedSnapshot, ADVISOR_OVERVIEW_SCHEMA } from './contracts.mjs'
import { evaluateDataQuality } from './data-quality.mjs'
import { EvidenceRegistry } from './evidence-registry.mjs'
import { evaluateRisks } from './risk-engine.mjs'

function assertReferenceSet(ids, validIds, label) {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !validIds.has(id))) {
    throw new TypeError(`${label} contains an invalid reference`)
  }
}

export function assertAdvisorOverview(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Advisor overview must be an object')
  if (value.schema !== ADVISOR_OVERVIEW_SCHEMA) throw new TypeError('Advisor overview schema is invalid')
  if (typeof value.snapshotRevision !== 'string' || !value.snapshotRevision) throw new TypeError('Advisor overview revision is invalid')
  requireInstant(value.evaluatedAt, 'Advisor overview evaluatedAt')
  if (typeof value.timeZone !== 'string' || !value.timeZone) throw new TypeError('Advisor overview time zone is invalid')
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value.timeZone }).format(new Date(value.evaluatedAt))
  } catch {
    throw new TypeError('Advisor overview time zone is invalid')
  }
  if (typeof value.rulesVersion !== 'string' || !value.rulesVersion) throw new TypeError('Advisor overview rules version is invalid')
  if (!value.dataQuality) throw new TypeError('Advisor overview data quality is missing')
  for (const [key, outer] of [
    ['snapshotRevision', value.snapshotRevision],
    ['evaluatedAt', value.evaluatedAt],
    ['timeZone', value.timeZone],
    ['rulesVersion', value.rulesVersion],
  ]) {
    if (value.dataQuality[key] !== outer) throw new TypeError(`Advisor overview data quality ${key} mismatch`)
  }
  for (const key of ['risks', 'urgentItems', 'evidence', 'claims']) {
    if (!Array.isArray(value[key])) throw new TypeError(`Advisor overview ${key} must be an array`)
  }
  const evidenceIds = new Set(value.evidence.map((item) => item?.id))
  const claimIds = new Set(value.claims.map((item) => item?.id))
  if (evidenceIds.has(undefined) || evidenceIds.size !== value.evidence.length) throw new TypeError('Advisor evidence IDs must be unique')
  if (claimIds.has(undefined) || claimIds.size !== value.claims.length) throw new TypeError('Advisor claim IDs must be unique')
  for (const evidence of value.evidence) {
    if (evidence.snapshotRevision !== value.snapshotRevision) throw new TypeError('Advisor evidence revision mismatch')
    if (!Array.isArray(evidence.fields) || !evidence.fields.length || !Array.isArray(evidence.disclosedFields)) {
      throw new TypeError(`Advisor evidence ${evidence.id} fields are invalid`)
    }
    const fields = new Set(evidence.fields)
    if (!evidence.disclosedFields.length || evidence.disclosedFields.some((field) => !fields.has(field))) {
      throw new TypeError(`Advisor evidence ${evidence.id} has no valid disclosure`)
    }
    if (!/^[a-f0-9]{64}$/.test(evidence.domainDigest || '')) {
      throw new TypeError(`Advisor evidence ${evidence.id} digest is invalid`)
    }
    if (!/^[a-f0-9]{64}$/.test(evidence.evidenceDigest || '')) {
      throw new TypeError(`Advisor evidence ${evidence.id} evidence digest is invalid`)
    }
    const domainQuality = value.dataQuality.domains?.[evidence.domain]
    if (!domainQuality || !/^[a-f0-9]{64}$/.test(domainQuality.contentDigest || '')) {
      throw new TypeError(`Advisor evidence ${evidence.id} data quality domain is invalid`)
    }
    if (evidence.domainDigest !== domainQuality.contentDigest) {
      throw new TypeError(`Advisor evidence ${evidence.id} domain content digest mismatch`)
    }
  }
  for (const claim of value.claims) {
    if (claim.rulesVersion !== value.rulesVersion) throw new TypeError(`Claim ${claim.id} rules version mismatch`)
    assertReferenceSet(claim.evidenceRefs, evidenceIds, `Claim ${claim.id}`)
  }
  for (const risk of value.risks) {
    if (risk.rulesVersion !== value.rulesVersion) throw new TypeError(`Risk ${risk.id} rules version mismatch`)
    assertReferenceSet(risk.evidenceRefs, evidenceIds, `Risk ${risk.id}`)
    assertReferenceSet(risk.claimIds, claimIds, `Risk ${risk.id}`)
  }
  for (const item of value.urgentItems) {
    if (item.rulesVersion !== value.rulesVersion) throw new TypeError(`Agenda item ${item.id} rules version mismatch`)
    assertReferenceSet(item.evidenceRefs, evidenceIds, `Agenda item ${item.id}`)
    assertReferenceSet(item.claimIds, claimIds, `Agenda item ${item.id}`)
    const score = item.score
    if (!score || score.total !== score.urgency + score.impact + score.delayCost + score.confidence) {
      throw new TypeError(`Agenda item ${item.id} has an invalid score`)
    }
  }
  return value
}

export function createAdvisorOverview(versionedSnapshot, options) {
  const versioned = normalizeVersionedSnapshot(versionedSnapshot)
  const normalizedOptions = normalizeAdvisorOptions(options)
  const dataQuality = evaluateDataQuality(versionedSnapshot, normalizedOptions)
  const evidenceRegistry = new EvidenceRegistry(versionedSnapshot, {
    dataQuality,
    rulesVersion: normalizedOptions.rulesVersion,
  })
  const { risks, claims } = evaluateRisks(versionedSnapshot, {
    ...normalizedOptions,
    dataQuality,
    evidenceRegistry,
  })
  const urgentItems = buildAgenda(risks, normalizedOptions)
  const overview = {
    schema: ADVISOR_OVERVIEW_SCHEMA,
    snapshotRevision: versioned.revision,
    evaluatedAt: normalizedOptions.now,
    timeZone: normalizedOptions.timeZone,
    rulesVersion: normalizedOptions.rulesVersion,
    dataQuality,
    risks,
    urgentItems,
    evidence: evidenceRegistry.list(),
    claims,
  }
  assertAdvisorOverview(overview)
  return overview
}

export function serializeAdvisorOverview(overview) {
  assertAdvisorOverview(overview)
  return `${canonicalJson(overview)}\n`
}

export function compareAdvisorIds(left, right) {
  return compareCanonicalText(left?.id, right?.id)
}
