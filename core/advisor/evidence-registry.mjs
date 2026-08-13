import { canonicalDigest, compareCanonicalText, normalizeText, parseInstant, shortDigest, uniqueSorted } from './canonical.mjs'
import { ADVISOR_EVIDENCE_SCHEMA, canonicalDomainId, normalizeVersionedSnapshot } from './contracts.mjs'

function safeDataset(value) {
  const text = normalizeText(value, { trim: true }).toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
  if (!text || text.length > 64) throw new TypeError('Evidence dataset must be a short controlled identifier')
  return text
}

function opaqueEntityId(value) {
  const text = normalizeText(value, { trim: true })
  return `entity:${shortDigest({ entityId: text }, 16)}`
}

function qualityFor(dataQuality, domain) {
  return dataQuality?.domains?.[canonicalDomainId(domain)] || {
    availability: 'unknown',
    freshness: 'unknown',
    completeness: 'unknown',
  }
}

export class EvidenceRegistry {
  constructor(versionedSnapshot, { dataQuality, rulesVersion }) {
    const normalized = normalizeVersionedSnapshot(versionedSnapshot)
    this.snapshotRevision = normalized.revision
    this.domainDigests = normalized.domainDigests
    this.dataQuality = dataQuality
    this.rulesVersion = rulesVersion
    this.entries = new Map()
    this.disclosed = new Map()
  }

  register({ dataset, domain = dataset, entityId = null, fields, capturedAt = null, source = null, label = null, evidenceDigest = null }) {
    const safeName = safeDataset(dataset)
    const domainId = canonicalDomainId(domain)
    const normalizedFields = uniqueSorted(fields || [])
    if (!normalizedFields.length || normalizedFields.some((field) => !/^[a-zA-Z0-9._-]{1,80}$/.test(field))) {
      throw new TypeError('Evidence fields must be non-empty controlled identifiers')
    }
    const rawEntity = entityId === null || entityId === undefined ? domainId : entityId
    const entity = opaqueEntityId(rawEntity)
    const quality = qualityFor(this.dataQuality, domainId)
    const snapshotDomainDigest = normalizeText(this.domainDigests[domainId], { trim: true }).toLowerCase()
    const qualityDomainDigest = normalizeText(quality.contentDigest, { trim: true }).toLowerCase()
    if (snapshotDomainDigest && qualityDomainDigest && snapshotDomainDigest !== qualityDomainDigest) {
      throw new TypeError(`Data quality content digest does not match versioned snapshot domain ${domainId}`)
    }
    const domainDigest = snapshotDomainDigest || qualityDomainDigest
    if (!/^[a-f0-9]{64}$/.test(domainDigest)) throw new TypeError(`Missing or invalid domain digest for evidence domain ${domainId}`)
    const evidenceDescriptor = {
      schema: ADVISOR_EVIDENCE_SCHEMA,
      dataset: safeName,
      domain: domainId,
      entityId: normalizeText(rawEntity),
      fields: normalizedFields,
    }
    const normalizedEvidenceDigest = normalizeText(evidenceDigest || canonicalDigest(evidenceDescriptor), { trim: true }).toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(normalizedEvidenceDigest)) throw new TypeError(`Missing or invalid evidence digest for ${safeName}`)
    const identity = {
      schema: ADVISOR_EVIDENCE_SCHEMA,
      rulesVersion: this.rulesVersion,
      domainDigest,
      evidenceDigest: normalizedEvidenceDigest,
      ...evidenceDescriptor,
    }
    const id = `ev1:${safeName}:${shortDigest(identity, 16)}:${shortDigest(normalizedFields, 12)}`
    const parsedCapturedAt = parseInstant(capturedAt)
    const sourceId = typeof source === 'string' && /^[a-zA-Z0-9._-]{1,64}$/.test(source) ? source : null
    const entry = Object.freeze({
      id,
      dataset: safeName,
      domain: domainId,
      entityId: entity,
      fields: normalizedFields,
      capturedAt: parsedCapturedAt?.iso || null,
      source: sourceId,
      snapshotRevision: this.snapshotRevision,
      domainDigest,
      evidenceDigest: normalizedEvidenceDigest,
      availability: quality.availability,
      freshness: quality.freshness,
      completeness: quality.completeness,
      label: label === null ? null : normalizeText(label, { trim: true }).slice(0, 160),
    })
    const previous = this.entries.get(id)
    if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) throw new Error(`Evidence ID collision: ${id}`)
    this.entries.set(id, entry)
    if (!this.disclosed.has(id)) this.disclosed.set(id, new Set())
    return entry
  }

  disclose(id, fields) {
    const entry = this.entries.get(id)
    if (!entry) throw new Error(`Unknown evidence reference: ${id}`)
    const allowed = new Set(entry.fields)
    const requested = uniqueSorted(fields || [])
    if (requested.some((field) => !allowed.has(field))) throw new Error(`Evidence disclosure contains an unregistered field: ${id}`)
    const disclosed = this.disclosed.get(id)
    for (const field of requested) disclosed.add(field)
    return this.get(id)
  }

  validateReference(id, { snapshotRevision = this.snapshotRevision, fields = [], requireDisclosure = true } = {}) {
    const entry = this.entries.get(id)
    if (!entry) return { valid: false, reason: 'unknown-reference' }
    if (entry.snapshotRevision !== snapshotRevision) return { valid: false, reason: 'revision-mismatch' }
    const registered = new Set(entry.fields)
    const disclosed = this.disclosed.get(id) || new Set()
    for (const field of uniqueSorted(fields || [])) {
      if (!registered.has(field)) return { valid: false, reason: 'field-not-registered' }
      if (requireDisclosure && !disclosed.has(field)) return { valid: false, reason: 'field-not-disclosed' }
    }
    if (requireDisclosure && !disclosed.size) return { valid: false, reason: 'reference-not-disclosed' }
    return { valid: true, reason: null }
  }

  validateReferences(ids, options = {}) {
    return uniqueSorted(ids || []).map((id) => ({ id, ...this.validateReference(id, options) }))
  }

  get(id) {
    const entry = this.entries.get(id)
    if (!entry) return null
    return { ...entry, fields: [...entry.fields], disclosedFields: uniqueSorted(this.disclosed.get(id) || []) }
  }

  list() {
    return [...this.entries.keys()].sort(compareCanonicalText).map((id) => this.get(id))
  }
}
