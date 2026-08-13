import { canonicalDigest, normalizeText, requireInstant } from './canonical.mjs'
import { canonicalDomainId } from '../domain-provenance.mjs'

export const ADVISOR_DATA_QUALITY_SCHEMA = 'theia-advisor-data-quality/v1'
export const ADVISOR_OVERVIEW_SCHEMA = 'theia-advisor-overview/v1'
export const ADVISOR_RULES_VERSION = 'theia-advisor-rules/v1'
export const ADVISOR_SCORE_FORMULA_VERSION = 'theia-advisor-agenda-score/v1'
export const ADVISOR_EVIDENCE_SCHEMA = 'theia-advisor-evidence/v1'

export const AVAILABILITY_VALUES = Object.freeze(['available', 'empty-confirmed', 'absent', 'unknown'])
export const FRESHNESS_VALUES = Object.freeze(['fresh', 'stale', 'unknown'])
export const COMPLETENESS_VALUES = Object.freeze(['complete', 'partial', 'unknown'])
export const ATTEMPT_STATUS_VALUES = Object.freeze(['never', 'not-attempted', 'succeeded', 'failed', 'auth-required'])

export { canonicalDomainId }

export function normalizeVersionedSnapshot(input) {
  if (!input || typeof input !== 'object') throw new TypeError('versionedSnapshot must be an object')
  const snapshot = input.state ?? input.snapshot
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new TypeError('versionedSnapshot.snapshot must be an object')
  }
  const revision = normalizeText(input.revision, { trim: true })
  if (!revision) throw new TypeError('versionedSnapshot.revision must be a non-empty string')
  const digests = input.domainDigests && typeof input.domainDigests === 'object' && !Array.isArray(input.domainDigests)
    ? input.domainDigests
    : {}
  const domainDigests = {}
  for (const [key, value] of Object.entries(digests)) {
    const domain = canonicalDomainId(key)
    const digest = normalizeText(value, { trim: true }).toLowerCase()
    if (domain && /^[a-f0-9]{64}$/.test(digest)) domainDigests[domain] = digest
  }
  const committedAt = input.committedAt ?? input.updatedAt ?? null
  return { snapshot, revision, domainDigests, committedAt }
}

export function normalizeAdvisorOptions(options = {}) {
  const now = requireInstant(options.now, 'options.now').iso
  const timeZone = normalizeText(options.timeZone || 'Asia/Shanghai', { trim: true })
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(now))
  } catch {
    throw new TypeError('options.timeZone must be a valid IANA time zone')
  }
  const rulesVersion = normalizeText(options.rulesVersion || ADVISOR_RULES_VERSION, { trim: true })
  if (!rulesVersion) throw new TypeError('options.rulesVersion must be a non-empty string')
  return { now, timeZone, rulesVersion }
}

export function domainDigestOf(versionedSnapshot, domain, payload) {
  const normalized = normalizeVersionedSnapshot(versionedSnapshot)
  return normalized.domainDigests[canonicalDomainId(domain)] || canonicalDigest(payload)
}
