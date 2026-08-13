import { compareCanonicalText, parseInstant, shortDigest, uniqueSorted } from './canonical.mjs'
import { ADVISOR_SCORE_FORMULA_VERSION, normalizeAdvisorOptions } from './contracts.mjs'

export const AGENDA_SCORE_TABLE = Object.freeze({
  urgency: Object.freeze({ overdue: 40, '0-6h': 38, '6-24h': 34, '24-72h': 24, '3-7d': 14, 'over-7d': 4, unknown: 0 }),
  impact: Object.freeze({ exam: 30, 'deadline-assignment': 26, 'blocking-data-repair': 26, 'official-window': 22, 'academic-gap': 18, reminder: 8 }),
  delayCost: Object.freeze({ 'irrecoverable-window': 15, 'manual-recovery': 10, 'recoverable-refresh': 5, 'information-only': 0 }),
  confidence: Object.freeze({ 'fresh-complete-success': 15, 'fresh-partial': 11, 'stale-evidence': 8, 'failed-retained': 5, unknown: 0, 'verified-failure': 15 }),
})

const KIND_ORDER = Object.freeze({ exam: 0, assignment: 1, 'data-quality': 2, window: 3, 'academic-gap': 4, reminder: 5 })

function clampInteger(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Math.trunc(Number(value) || 0)))
}

function urgencyClass(dueAt, nowMilliseconds) {
  const parsed = parseInstant(dueAt)
  if (!parsed) return 'unknown'
  const delta = parsed.milliseconds - nowMilliseconds
  if (delta < 0) return 'overdue'
  if (delta < 6 * 60 * 60 * 1000) return '0-6h'
  if (delta < 24 * 60 * 60 * 1000) return '6-24h'
  if (delta < 72 * 60 * 60 * 1000) return '24-72h'
  if (delta < 7 * 24 * 60 * 60 * 1000) return '3-7d'
  return 'over-7d'
}

function confidenceClass(risk) {
  const quality = risk.quality || {}
  if (risk.kind === 'data-quality' && ['failed', 'auth-required'].includes(quality.lastAttemptStatus)) return 'verified-failure'
  if (quality.lastAttemptStatus === 'failed' && quality.availability === 'available') return 'failed-retained'
  if (quality.freshness === 'fresh' && quality.completeness === 'complete' && quality.lastAttemptStatus === 'succeeded') return 'fresh-complete-success'
  if (quality.freshness === 'fresh' && quality.completeness === 'partial') return 'fresh-partial'
  if (quality.freshness === 'stale' && quality.availability === 'available') return 'stale-evidence'
  return 'unknown'
}

function scoreRisk(risk, nowMilliseconds) {
  const urgencyKey = risk.deadlineBand === 'unknown' ? 'unknown' : urgencyClass(risk.dueAt, nowMilliseconds)
  const confidenceKey = confidenceClass(risk)
  const urgency = clampInteger(AGENDA_SCORE_TABLE.urgency[urgencyKey], 0, 40)
  const impact = clampInteger(AGENDA_SCORE_TABLE.impact[risk.impactClass] ?? AGENDA_SCORE_TABLE.impact.reminder, 0, 30)
  const delayCost = clampInteger(AGENDA_SCORE_TABLE.delayCost[risk.delayCostClass] ?? 0, 0, 15)
  const confidence = clampInteger(AGENDA_SCORE_TABLE.confidence[confidenceKey] ?? 0, 0, 15)
  return {
    urgency,
    impact,
    delayCost,
    confidence,
    total: urgency + impact + delayCost + confidence,
    formulaVersion: ADVISOR_SCORE_FORMULA_VERSION,
    components: { urgency: urgencyKey, impact: risk.impactClass, delayCost: risk.delayCostClass, confidence: confidenceKey },
  }
}

function actionId(risk, rulesVersion) {
  return `action1:${risk.actionKind}:${shortDigest({
    entityId: risk.entityId,
    actionKind: risk.actionKind,
    effectiveDeadline: risk.dueAt,
    rulesVersion,
  }, 20)}`
}

function mergeAction(previous, current) {
  if (!previous) return current
  const score = previous.score.total >= current.score.total ? previous.score : current.score
  return {
    ...previous,
    score,
    reasons: uniqueSorted([...previous.reasons, ...current.reasons]),
    evidenceRefs: uniqueSorted([...previous.evidenceRefs, ...current.evidenceRefs]),
    claimIds: uniqueSorted([...previous.claimIds, ...current.claimIds]),
  }
}

function compareActions(left, right) {
  if (left.score.total !== right.score.total) return right.score.total - left.score.total
  const leftTime = parseInstant(left.dueAt)?.milliseconds ?? Number.POSITIVE_INFINITY
  const rightTime = parseInstant(right.dueAt)?.milliseconds ?? Number.POSITIVE_INFINITY
  if (leftTime !== rightTime) return leftTime - rightTime
  const leftKind = KIND_ORDER[left.kind] ?? 99
  const rightKind = KIND_ORDER[right.kind] ?? 99
  if (leftKind !== rightKind) return leftKind - rightKind
  return compareCanonicalText(left.id, right.id)
}

export function buildAgenda(risks, options) {
  const normalizedOptions = normalizeAdvisorOptions(options)
  const nowMilliseconds = Date.parse(normalizedOptions.now)
  const deduplicated = new Map()
  for (const risk of Array.isArray(risks) ? risks : []) {
    if (!risk?.actionable || !risk.actionKind) continue
    const id = actionId(risk, normalizedOptions.rulesVersion)
    const score = scoreRisk(risk, nowMilliseconds)
    const item = Object.freeze({
      id,
      kind: risk.kind,
      entityId: risk.entityId,
      title: risk.title,
      dueAt: risk.dueAt || null,
      severity: risk.severity,
      score,
      reasons: uniqueSorted(risk.why || []),
      evidenceRefs: uniqueSorted(risk.evidenceRefs || []),
      claimIds: uniqueSorted(risk.claimIds || []),
      quality: { ...risk.quality },
      suggestedAction: risk.suggestedAction,
      actionKind: risk.actionKind,
      rulesVersion: normalizedOptions.rulesVersion,
    })
    deduplicated.set(id, mergeAction(deduplicated.get(id), item))
  }
  return [...deduplicated.values()].sort(compareActions)
}
