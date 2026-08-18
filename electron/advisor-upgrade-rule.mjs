import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { canonicalDigest, canonicalJson, parseInstant } from '../core/advisor/canonical.mjs'

export const ADVISOR_UPGRADE_RULE_CONFIG_SCHEMA = 'theia-advisor-upgrade-rule-config/v1'
export const ADVISOR_UPGRADE_RULE_CONFIG_VERSION = 1
export const ADVISOR_UPGRADE_RULE_CONFIG_PATH = Object.freeze(['advisor', 'upgrade-rule.v1.json'])
const MAX_CONFIG_BYTES = 64 * 1024

function text(value, maximum = 256) {
  return typeof value === 'string' ? value.normalize('NFC').trim().slice(0, maximum) : ''
}

function controlled(value, maximum = 160) {
  const normalized = text(value, maximum)
  return normalized && /^[\p{L}\p{N}][\p{L}\p{N} ._:/#()\-]{0,159}$/u.test(normalized)
    ? normalized
    : null
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function nonNegativeNumber(value) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function normalizedPayload(input) {
  const source = object(input?.source)
  const rule = object(input?.rule)
  if (input?.schema !== ADVISOR_UPGRADE_RULE_CONFIG_SCHEMA) throw new Error('schema-mismatch')
  if (input?.version !== ADVISOR_UPGRADE_RULE_CONFIG_VERSION) throw new Error('version-mismatch')
  if (!source || !rule) throw new Error('source-or-rule-missing')

  const sourceKind = text(source.kind, 32).toLowerCase()
  if (!['official', 'configuration'].includes(sourceKind)) throw new Error('source-kind-invalid')
  const sourceLabel = controlled(source.label)
  const sourceRef = controlled(source.reference, 160)
  if (!sourceLabel || !sourceRef) throw new Error('source-metadata-invalid')
  const publishedAt = text(source.publishedAt, 64)
  if (publishedAt && !parseInstant(publishedAt)) throw new Error('source-date-invalid')

  const id = controlled(rule.id, 128)
  const rulesVersion = controlled(rule.rulesVersion || rule.version, 128)
  const thresholdCredits = nonNegativeNumber(rule.thresholdCredits)
  const requirementIds = Array.isArray(rule.requirementIds)
    ? [...new Set(rule.requirementIds.map((value) => controlled(value, 256)).filter(Boolean))].sort()
    : []
  if (!id || !rulesVersion || thresholdCredits === null || !requirementIds.length) throw new Error('rule-fields-invalid')
  if (sourceKind === 'official' && !publishedAt) throw new Error('official-source-date-missing')

  return {
    schema: ADVISOR_UPGRADE_RULE_CONFIG_SCHEMA,
    version: ADVISOR_UPGRADE_RULE_CONFIG_VERSION,
    source: {
      kind: sourceKind,
      label: sourceLabel,
      reference: sourceRef,
      ...(publishedAt ? { publishedAt: parseInstant(publishedAt).iso } : {}),
    },
    rule: {
      id,
      rulesVersion,
      sourceKind,
      sourceLabel,
      thresholdCredits,
      requirementIds,
    },
  }
}

export function trustedUpgradeRuleDigest(config) {
  return canonicalDigest(config)
}

export function validateTrustedUpgradeRuleConfig(input) {
  const payload = normalizedPayload(input)
  const providedDigest = text(input?.digest, 128).toLowerCase()
  if (!/^[a-f0-9]{64}$/u.test(providedDigest)) throw new Error('digest-invalid')
  const expectedDigest = trustedUpgradeRuleDigest(payload)
  if (providedDigest !== expectedDigest) throw new Error('digest-mismatch')
  return Object.freeze({
    ...payload.rule,
    configSchema: payload.schema,
    configVersion: payload.version,
    sourceReference: payload.source.reference,
    sourcePublishedAt: payload.source.publishedAt || null,
    configDigest: expectedDigest,
  })
}

export async function loadTrustedUpgradeRule({ root, onDiagnostic = () => {} } = {}) {
  if (typeof root !== 'string' || !root.trim()) throw new TypeError('Upgrade rule root is required')
  const file = resolve(root, ...ADVISOR_UPGRADE_RULE_CONFIG_PATH)
  let raw
  try {
    raw = await readFile(file)
  } catch (error) {
    if (error?.code !== 'ENOENT') onDiagnostic('advisor.upgrade_rule_load_failed', { reason: 'read-failed' })
    return null
  }
  if (raw.length > MAX_CONFIG_BYTES) {
    onDiagnostic('advisor.upgrade_rule_rejected', { reason: 'file-too-large' })
    return null
  }
  try {
    const parsed = JSON.parse(raw.toString('utf8'))
    const rule = validateTrustedUpgradeRuleConfig(parsed)
    onDiagnostic('advisor.upgrade_rule_loaded', {
      version: rule.configVersion,
      sourceKind: rule.sourceKind,
      digest: rule.configDigest.slice(0, 16),
    })
    return rule
  } catch (error) {
    onDiagnostic('advisor.upgrade_rule_rejected', {
      reason: error instanceof Error ? error.message.slice(0, 80) : 'invalid-config',
    })
    return null
  }
}

export function serializeTrustedUpgradeRuleConfig(config) {
  const payload = normalizedPayload(config)
  return `${canonicalJson({ ...payload, digest: trustedUpgradeRuleDigest(payload) })}\n`
}
