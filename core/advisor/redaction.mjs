import sanitizeHtml from 'sanitize-html'
import { normalizeText, parseInstant, uniqueSorted } from './canonical.mjs'

export const ADVISOR_ACTION_KINDS = Object.freeze([
  'open-view',
  'show-evidence',
  'propose-sync-source',
  'propose-prepare-workspace',
  'propose-save-course-target',
  'none',
])

export const SENSITIVE_ADVISOR_SCOPES = Object.freeze([
  'mail-body',
  'fitness',
  'identity',
  'attachment-text',
])

const STRING_LIMITS = Object.freeze({
  id: 240,
  label: 240,
  text: 4_000,
  body: 32_000,
  attachment: 64_000,
})

const ADVISOR_TEXT_POLICY_REDACTIONS = Object.freeze([
  { pattern: /\[([^\]\r\n]{0,240})\]\(\s*\/\/[^)\r\n]*\)/giu, replacement: '$1' },
  { pattern: /\b(?:https?|ftp|file):\/\/[^\s<>"']+/giu, replacement: '[link removed]' },
  { pattern: /\b(?:javascript|data|mailto):[^\s<>"']+/giu, replacement: '[link removed]' },
  { pattern: /\bwww\.[^\s<>"']+/giu, replacement: '[link removed]' },
  { pattern: /(?<![:/])\/\/[^\s<>"'\u0060\])}]+/giu, replacement: '[link removed]' },
  { pattern: /(?<![a-z0-9+.-])[a-z]:[\\/][^\r\n)\]}"']+/giu, replacement: '[path removed]' },
  { pattern: /\\\\[^\s)\]}"']+/gu, replacement: '[path removed]' },
  { pattern: /\/(?:Users|home|etc|var|private|mnt|tmp)\/[^\r\n\t )\]}"']*/gu, replacement: '[path removed]' },
  { pattern: /(?<![a-z0-9.])(?:\.{1,2}[\\/])+(?:[^\\/\s)\]}"']+[\\/]?)+/giu, replacement: '[path removed]' },
  { pattern: /\b(proxy-)?authorization\s*[:=]\s*(?:Bearer|Basic)\s+[a-z0-9._~+\/-]+=*/giu, replacement: '$1authorization=[secret removed]' },
  { pattern: /\b(Bearer|Basic)\s+[a-z0-9._~+\/-]+=*/giu, replacement: '$1 [secret removed]' },
  { pattern: /\bsk-(?:proj-)?[a-z0-9_-]{8,}/giu, replacement: '[secret removed]' },
  { pattern: /\b(set-cookie|cookie)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu, replacement: '$1=[secret removed]' },
  { pattern: /\b(password|passcode|token|api[ _-]?key|secret|session(?:id)?|jsessionid|access[ _-]?token)\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu, replacement: '$1=[secret removed]' },
])

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value
}

function requiredText(value, label, maxLength = STRING_LIMITS.id) {
  const output = normalizeText(value, { trim: true })
  if (!output || output.length > maxLength) throw new TypeError(`${label} must be a bounded non-empty string`)
  return output
}

function optionalText(value, maxLength = STRING_LIMITS.text) {
  if (value === null || value === undefined) return null
  return normalizeText(value, { trim: true }).slice(0, maxLength) || null
}

function controlledIdentifier(value, label, maxLength = STRING_LIMITS.id) {
  const output = requiredText(value, label, maxLength)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:._-]*$/.test(output)) {
    throw new TypeError(`${label} must be a controlled identifier`)
  }
  return output
}

function optionalControlledIdentifier(value, maxLength = 120) {
  const output = optionalText(value, maxLength)
  return output && /^[a-zA-Z0-9][a-zA-Z0-9:._-]*$/.test(output) ? output : null
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const output = Number(value)
  return Number.isFinite(output) ? output : null
}

function optionalInstant(value) {
  if (value === null || value === undefined || value === '') return null
  return parseInstant(value)?.iso || null
}

function optionalMimeType(value) {
  const output = normalizeText(value, { trim: true }).toLowerCase()
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(output) ? output.slice(0, 160) : null
}

function optionalFilename(value) {
  const leaf = normalizeText(value).split(/[\\/]/u).at(-1) || ''
  return optionalDisplayText(leaf, STRING_LIMITS.label)
}

function stringList(value, { maxItems = 64, maxLength = STRING_LIMITS.text } = {}) {
  if (!Array.isArray(value)) return []
  return uniqueSorted(value.slice(0, maxItems).map((item) => optionalText(item, maxLength)).filter(Boolean))
}

function controlledIdentifierList(value, { maxItems = 16, maxLength = 64 } = {}) {
  if (!Array.isArray(value)) return []
  return uniqueSorted(value.slice(0, maxItems)
    .map((item) => optionalControlledIdentifier(item, maxLength))
    .filter(Boolean))
}

function cleanUntrustedText(value, maxLength) {
  const source = normalizeText(value)
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ' ')
  const plain = sanitizeHtml(source, {
    allowedTags: [],
    allowedAttributes: {},
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed', 'svg'],
  })
  let redacted = plain
  for (const rule of ADVISOR_TEXT_POLICY_REDACTIONS) redacted = redacted.replace(rule.pattern, rule.replacement)
  return redacted
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength)
}

export function advisorTextHasPolicyViolation(value) {
  const source = normalizeText(value)
  return ADVISOR_TEXT_POLICY_REDACTIONS.some(({ pattern }) => {
    pattern.lastIndex = 0
    return pattern.test(source)
  })
}

function requiredDisplayText(value, label, maxLength = STRING_LIMITS.text) {
  const output = cleanUntrustedText(value, maxLength)
  if (!output) throw new TypeError(`${label} must be a bounded non-empty string`)
  return output
}

function optionalDisplayText(value, maxLength = STRING_LIMITS.text) {
  if (value === null || value === undefined) return null
  return cleanUntrustedText(value, maxLength) || null
}

function displayTextList(value, { maxItems = 64, maxLength = STRING_LIMITS.text } = {}) {
  if (!Array.isArray(value)) return []
  return uniqueSorted(value.slice(0, maxItems)
    .map((item) => optionalDisplayText(item, maxLength))
    .filter(Boolean))
}

export function sanitizeAdvisorUntrustedText(value, { maxLength = STRING_LIMITS.body } = {}) {
  const bounded = Math.max(0, Math.min(STRING_LIMITS.attachment, Math.trunc(Number(maxLength) || 0)))
  return cleanUntrustedText(value, bounded)
}

function projectClaimValue(value) {
  const input = record(value, 'Advisor claim value')
  const type = requiredText(input.type, 'Advisor claim value type', 32)
  if (type === 'boolean') {
    if (typeof input.value !== 'boolean') throw new TypeError('Advisor boolean claim value is invalid')
    return { type, value: input.value }
  }
  if (type === 'severity') {
    const severity = controlledIdentifier(input.value, 'Advisor severity', 32)
    if (!['urgent', 'attention', 'info', 'unknown'].includes(severity)) {
      throw new TypeError('Advisor severity claim value is invalid')
    }
    return { type, value: severity }
  }
  if (type === 'instant') {
    const instant = optionalInstant(input.value)
    if (!instant) throw new TypeError('Advisor instant claim value is invalid')
    const timeZone = requiredText(input.timeZone, 'Advisor instant time zone', 80)
    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(instant))
    } catch {
      throw new TypeError('Advisor instant claim time zone is invalid')
    }
    return {
      type,
      value: instant,
      timeZone,
    }
  }
  if (type === 'duration') {
    const normalized = normalizeText(input.value, { trim: true })
    if (!/^-?\d+(?:\.\d+)?$/.test(normalized) || !Number.isFinite(Number(normalized)) || input.unit !== 'minute') {
      throw new TypeError('Advisor duration claim value is invalid')
    }
    return {
      type,
      value: normalized,
      unit: 'minute',
    }
  }
  if (type === 'number') {
    const normalized = finiteNumber(input.value)
    const unit = controlledIdentifier(input.unit, 'Advisor number claim unit', 32)
    if (normalized === null || !['credit', 'gpa'].includes(unit)) throw new TypeError('Advisor number claim value is invalid')
    return { type, value: normalized, unit }
  }
  throw new TypeError(`Unsupported advisor claim value type: ${type}`)
}

export function projectAdvisorClaim(value) {
  const input = record(value, 'Advisor claim')
  const evidenceRefs = stringList(input.evidenceRefs, { maxItems: 64, maxLength: STRING_LIMITS.id })
  if (!evidenceRefs.length) throw new TypeError('Advisor claim must have evidence')
  return {
    id: controlledIdentifier(input.id, 'Advisor claim id'),
    kind: requiredText(input.kind, 'Advisor claim kind', 32),
    subject: controlledIdentifier(input.subject, 'Advisor claim subject'),
    predicate: controlledIdentifier(input.predicate, 'Advisor claim predicate', 120),
    value: projectClaimValue(input.value),
    displayText: requiredDisplayText(input.displayText, 'Advisor claim display text'),
    evidenceRefs,
    confidence: (() => {
      const confidence = controlledIdentifier(input.confidence, 'Advisor claim confidence', 32)
      if (!['high', 'medium', 'low', 'unknown'].includes(confidence)) throw new TypeError('Advisor claim confidence is invalid')
      return confidence
    })(),
    caveats: displayTextList(input.caveats, { maxItems: 32 }),
    rulesVersion: requiredText(input.rulesVersion, 'Advisor claim rules version', 120),
  }
}

export function projectAdvisorEvidence(value) {
  const input = record(value, 'Advisor evidence')
  const fields = stringList(input.fields, { maxItems: 64, maxLength: 80 })
  const disclosedFields = stringList(input.disclosedFields, { maxItems: 64, maxLength: 80 })
  if (!fields.length || !disclosedFields.length || disclosedFields.some((field) => !fields.includes(field))) {
    throw new TypeError('Advisor evidence fields are invalid')
  }
  return {
    id: controlledIdentifier(input.id, 'Advisor evidence id'),
    dataset: controlledIdentifier(input.dataset, 'Advisor evidence dataset', 64),
    domain: controlledIdentifier(input.domain, 'Advisor evidence domain', 64),
    entityId: controlledIdentifier(input.entityId, 'Advisor evidence entity id'),
    fields,
    disclosedFields,
    capturedAt: optionalInstant(input.capturedAt),
    source: optionalControlledIdentifier(input.source, 64),
    snapshotRevision: requiredText(input.snapshotRevision, 'Advisor evidence snapshot revision'),
    domainDigest: requiredText(input.domainDigest, 'Advisor evidence domain digest', 64),
    evidenceDigest: requiredText(input.evidenceDigest, 'Advisor evidence digest', 64),
    availability: requiredText(input.availability, 'Advisor evidence availability', 32),
    freshness: requiredText(input.freshness, 'Advisor evidence freshness', 32),
    completeness: requiredText(input.completeness, 'Advisor evidence completeness', 32),
    label: optionalDisplayText(input.label, STRING_LIMITS.label),
  }
}

function projectQualitySummary(value) {
  const input = record(value || {}, 'Advisor quality summary')
  return {
    availability: requiredText(input.availability || 'unknown', 'Advisor quality availability', 32),
    freshness: requiredText(input.freshness || 'unknown', 'Advisor quality freshness', 32),
    completeness: requiredText(input.completeness || 'unknown', 'Advisor quality completeness', 32),
    lastAttemptStatus: requiredText(input.lastAttemptStatus || 'never', 'Advisor quality attempt status', 32),
  }
}

export function projectAdvisorRisk(value) {
  const input = record(value, 'Advisor risk')
  return {
    id: controlledIdentifier(input.id, 'Advisor risk id'),
    kind: controlledIdentifier(input.kind, 'Advisor risk kind', 80),
    entityId: controlledIdentifier(input.entityId, 'Advisor risk entity id'),
    domain: optionalControlledIdentifier(input.domain, 64),
    severity: controlledIdentifier(input.severity, 'Advisor risk severity', 32),
    title: requiredDisplayText(input.title, 'Advisor risk title', STRING_LIMITS.label),
    why: displayTextList(input.why, { maxItems: 32 }),
    evidenceRefs: stringList(input.evidenceRefs, { maxItems: 64, maxLength: STRING_LIMITS.id }),
    claimIds: stringList(input.claimIds, { maxItems: 64, maxLength: STRING_LIMITS.id }),
    confidence: optionalControlledIdentifier(input.confidence, 32),
    caveats: displayTextList(input.caveats, { maxItems: 32 }),
    dueAt: optionalInstant(input.dueAt),
    deadlineBand: controlledIdentifier(input.deadlineBand || 'unknown', 'Advisor risk deadline band', 32),
    actionable: input.actionable === true,
    suggestedAction: optionalDisplayText(input.suggestedAction, STRING_LIMITS.label),
    actionKind: optionalControlledIdentifier(input.actionKind, 80),
    impactClass: optionalControlledIdentifier(input.impactClass, 80),
    delayCostClass: optionalControlledIdentifier(input.delayCostClass, 80),
    quality: projectQualitySummary(input.quality),
    rulesVersion: requiredText(input.rulesVersion, 'Advisor risk rules version', 120),
  }
}

export function projectAdvisorUrgentItem(value) {
  const input = record(value, 'Advisor urgent item')
  const score = record(input.score, 'Advisor urgent item score')
  return {
    id: controlledIdentifier(input.id, 'Advisor urgent item id'),
    kind: controlledIdentifier(input.kind, 'Advisor urgent item kind', 80),
    domain: optionalControlledIdentifier(input.domain, 64),
    entityId: controlledIdentifier(input.entityId, 'Advisor urgent item entity id'),
    title: requiredDisplayText(input.title, 'Advisor urgent item title', STRING_LIMITS.label),
    dueAt: optionalInstant(input.dueAt),
    severity: controlledIdentifier(input.severity, 'Advisor urgent item severity', 32),
    score: {
      urgency: finiteNumber(score.urgency),
      impact: finiteNumber(score.impact),
      delayCost: finiteNumber(score.delayCost),
      confidence: finiteNumber(score.confidence),
      total: finiteNumber(score.total),
      formulaVersion: requiredText(score.formulaVersion, 'Advisor score formula version', 120),
    },
    reasons: displayTextList(input.reasons, { maxItems: 32 }),
    evidenceRefs: stringList(input.evidenceRefs, { maxItems: 64, maxLength: STRING_LIMITS.id }),
    claimIds: stringList(input.claimIds, { maxItems: 64, maxLength: STRING_LIMITS.id }),
    quality: projectQualitySummary(input.quality),
    suggestedAction: optionalDisplayText(input.suggestedAction, STRING_LIMITS.label),
    actionKind: optionalControlledIdentifier(input.actionKind, 80),
    rulesVersion: requiredText(input.rulesVersion, 'Advisor urgent item rules version', 120),
  }
}

export function projectAdvisorAction(value) {
  const input = record(value, 'Advisor action')
  const kind = requiredText(input.kind, 'Advisor action kind', 64)
  if (!ADVISOR_ACTION_KINDS.includes(kind)) throw new TypeError(`Advisor action kind is not allowed: ${kind}`)
  if (kind.startsWith('propose-') && input.requiresConfirmation !== true) {
    throw new TypeError(`Advisor proposal action must require confirmation: ${kind}`)
  }
  return {
    id: controlledIdentifier(input.id, 'Advisor action id'),
    kind,
    label: requiredDisplayText(input.label, 'Advisor action label', STRING_LIMITS.label),
    requiresConfirmation: input.requiresConfirmation === true,
    proposalId: optionalControlledIdentifier(input.proposalId, STRING_LIMITS.id),
  }
}

function projectRequirementMatch(value) {
  const input = record(value, 'Course requirement match')
  return {
    nodeId: optionalText(input.nodeId, STRING_LIMITS.id),
    label: optionalDisplayText(input.label, STRING_LIMITS.label),
    basis: controlledIdentifier(input.basis, 'Course requirement match basis', 32),
    confidence: controlledIdentifier(input.confidence, 'Course requirement match confidence', 32),
  }
}

function projectRecordMatch(value, label) {
  const input = record(value, label)
  return {
    existingId: requiredText(input.existingId, `${label} existing id`),
    reason: optionalDisplayText(input.reason, STRING_LIMITS.text),
    basis: optionalControlledIdentifier(input.basis, 64),
  }
}

export function projectCourseDecision(value) {
  const input = record(value, 'Course decision')
  const historical = record(input.historicalSummary || {}, 'Course decision historical summary')
  const breakdown = record(input.scoreBreakdown || {}, 'Course decision score breakdown')
  return {
    id: requiredText(input.id, 'Course decision id'),
    candidateId: requiredText(input.candidateId, 'Course decision candidate id'),
    rank: finiteNumber(input.rank),
    requirementMatches: (Array.isArray(input.requirementMatches) ? input.requirementMatches : []).slice(0, 32).map(projectRequirementMatch),
    scheduleStatus: requiredText(input.scheduleStatus || 'unknown', 'Course decision schedule status', 32),
    scheduleConflicts: (Array.isArray(input.scheduleConflicts) ? input.scheduleConflicts : []).slice(0, 32)
      .map((item) => projectRecordMatch(item, 'Course schedule conflict')),
    duplicateStatus: requiredText(input.duplicateStatus || 'unknown', 'Course decision duplicate status', 32),
    duplicateMatches: (Array.isArray(input.duplicateMatches) ? input.duplicateMatches : []).slice(0, 32)
      .map((item) => projectRecordMatch(item, 'Course duplicate match')),
    historicalSummary: {
      attempts: finiteNumber(historical.attempts),
      numericCount: finiteNumber(historical.numericCount),
      meanPoint: finiteNumber(historical.meanPoint),
      note: optionalDisplayText(historical.note, STRING_LIMITS.text),
    },
    completeness: requiredText(input.completeness || 'unknown', 'Course decision completeness', 32),
    score: finiteNumber(input.score),
    scoreBreakdown: {
      requirementMatch: finiteNumber(breakdown.requirementMatch),
      scheduleConflict: finiteNumber(breakdown.scheduleConflict),
      effectiveCredits: finiteNumber(breakdown.effectiveCredits),
      historyEvidence: finiteNumber(breakdown.historyEvidence),
      dataQuality: finiteNumber(breakdown.dataQuality),
      total: finiteNumber(breakdown.total),
      formulaVersion: optionalText(breakdown.formulaVersion, 120),
    },
    reasons: displayTextList(input.reasons, { maxItems: 32 }),
    evidenceRefs: stringList(input.evidenceRefs, { maxItems: 96, maxLength: STRING_LIMITS.id }),
    rulesVersion: requiredText(input.rulesVersion, 'Course decision rules version', 120),
  }
}

export function projectDataQualityDomain(value) {
  const input = record(value, 'Advisor data quality domain')
  const lastAttempt = record(input.lastAttempt || {}, 'Advisor data quality last attempt')
  const sourceAttempts = Array.isArray(input.sourceAttempts) ? input.sourceAttempts.slice(0, 8) : []
  return {
    domain: requiredText(input.domain, 'Advisor data quality domain id', 64),
    availability: requiredText(input.availability, 'Advisor data quality availability', 32),
    freshness: requiredText(input.freshness, 'Advisor data quality freshness', 32),
    completeness: requiredText(input.completeness, 'Advisor data quality completeness', 32),
    contentEmptyConfirmed: input.contentEmptyConfirmed === true,
    capturedAt: optionalInstant(input.capturedAt),
    source: controlledIdentifierList(input.source),
    recordCount: finiteNumber(input.recordCount) ?? 0,
    contentDigest: requiredText(input.contentDigest, 'Advisor data quality content digest', 64),
    sourceAttempts: sourceAttempts.map((entry) => {
      const attempt = record(entry, 'Advisor data quality source attempt')
      return {
        source: controlledIdentifierList(attempt.source),
        attemptedAt: optionalInstant(attempt.attemptedAt),
        completedAt: optionalInstant(attempt.completedAt),
        capturedAt: optionalInstant(attempt.capturedAt),
        sourceSucceededAt: optionalInstant(attempt.sourceSucceededAt),
        status: requiredText(attempt.status || 'never', 'Advisor source attempt status', 32),
        completeness: requiredText(attempt.completeness || 'unknown', 'Advisor source attempt completeness', 32),
        retainedPrevious: attempt.retainedPrevious === true,
        errorCode: optionalControlledIdentifier(attempt.errorCode, 120),
        parserVersion: optionalText(attempt.parserVersion, 120),
        receivedRecordCount: finiteNumber(attempt.receivedRecordCount),
        previousRecordCount: finiteNumber(attempt.previousRecordCount),
        successfulTermIds: controlledIdentifierList(attempt.successfulTermIds).slice(0, 64),
        failedTermIds: controlledIdentifierList(attempt.failedTermIds).slice(0, 64),
      }
    }),
    derivedFrom: controlledIdentifierList(input.derivedFrom).slice(0, 32),
    lastAttempt: {
      status: requiredText(lastAttempt.status || 'never', 'Advisor data quality attempt status', 32),
      emptyConfirmed: lastAttempt.emptyConfirmed === true,
      retainedPrevious: lastAttempt.retainedPrevious === true,
      errorCode: optionalControlledIdentifier(lastAttempt.errorCode, 120),
    },
    provenanceInferred: input.provenanceInferred === true,
  }
}

function attachmentMetadata(value) {
  const input = record(value, 'Mail attachment metadata')
  return {
    index: Number.isInteger(Number(input.index)) && Number(input.index) >= 0 ? Number(input.index) : null,
    filename: optionalFilename(input.filename),
    contentType: optionalMimeType(input.contentType),
    size: Math.max(0, finiteNumber(input.size) ?? 0),
  }
}

const NOTICE_TIME_SIGNAL_KINDS = new Set(['explicit-date-time', 'partial-date-time', 'time-only'])
const NOTICE_COURSE_SIGNAL_BASES = new Set(['known-course-exact', 'explicit-label'])
const NOTICE_ACTION_SIGNAL_KINDS = new Set([
  'submission-mentioned',
  'completion-mentioned',
  'registration-mentioned',
  'attendance-mentioned',
  'review-mentioned',
  'contact-mentioned',
  'download-mentioned',
])

function optionalTimeZone(value) {
  const output = optionalText(value, 80)
  if (!output) return null
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: output }).format(new Date(0))
    return output
  } catch {
    return null
  }
}

function projectedNoticeSignalList(value, projector) {
  if (!Array.isArray(value)) return []
  return value.slice(0, 12).map((item) => {
    try {
      return projector(record(item, 'Notice signal'))
    } catch {
      return null
    }
  }).filter(Boolean)
}

function projectNoticeSignals(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    times: projectedNoticeSignalList(input.times, (signal) => {
      const kind = optionalControlledIdentifier(signal.kind, 32)
      const text = optionalDisplayText(signal.text, STRING_LIMITS.label)
      if (!text || !NOTICE_TIME_SIGNAL_KINDS.has(kind)) return null
      return {
        text,
        kind,
        instant: optionalInstant(signal.instant),
        timeZone: optionalTimeZone(signal.timeZone),
        inference: 'none',
      }
    }),
    courses: projectedNoticeSignalList(input.courses, (signal) => {
      const basis = optionalControlledIdentifier(signal.basis, 32)
      const text = optionalDisplayText(signal.text, STRING_LIMITS.label)
      if (!text || !NOTICE_COURSE_SIGNAL_BASES.has(basis)) return null
      return { text, basis, inference: 'none' }
    }),
    actions: projectedNoticeSignalList(input.actions, (signal) => {
      const kind = optionalControlledIdentifier(signal.kind, 64)
      const text = optionalDisplayText(signal.text, STRING_LIMITS.label)
      if (!text || !NOTICE_ACTION_SIGNAL_KINDS.has(kind)) return null
      return { text, kind, inference: 'none', executable: false }
    }),
  }
}

function selectedEntityProjection(scope, input) {
  if (scope === 'notices') {
    return {
      trust: 'untrusted',
      title: optionalDisplayText(input.title, STRING_LIMITS.label),
      summary: sanitizeAdvisorUntrustedText(input.summary, { maxLength: 4_000 }),
      content: sanitizeAdvisorUntrustedText(input.content ?? input.body, { maxLength: 16_000 }),
      publishedAt: optionalInstant(input.publishedAt),
      courseName: optionalDisplayText(input.courseName, STRING_LIMITS.label),
      source: optionalControlledIdentifier(input.source, 64),
      capturedAt: optionalInstant(input.capturedAt),
      signals: projectNoticeSignals(input.signals),
      truncated: input.truncated === true,
    }
  }
  if (scope === 'mailbox') {
    return {
      trust: 'untrusted',
      subject: sanitizeAdvisorUntrustedText(input.subject, { maxLength: STRING_LIMITS.label }),
      from: sanitizeAdvisorUntrustedText(input.from, { maxLength: STRING_LIMITS.label }),
      receivedAt: optionalInstant(input.receivedAt),
      snippet: sanitizeAdvisorUntrustedText(input.snippet, { maxLength: 2_000 }),
      ...(typeof input.unread === 'boolean' ? { unread: input.unread } : {}),
      attachments: (Array.isArray(input.attachments) ? input.attachments : []).slice(0, 32).map(attachmentMetadata),
      source: optionalControlledIdentifier(input.source, 64),
      capturedAt: optionalInstant(input.capturedAt),
      truncated: input.truncated === true,
    }
  }
  if (scope === 'mail-body') {
    return {
      trust: 'untrusted',
      subject: sanitizeAdvisorUntrustedText(input.subject, { maxLength: STRING_LIMITS.label }),
      from: sanitizeAdvisorUntrustedText(input.from, { maxLength: STRING_LIMITS.label }),
      receivedAt: optionalInstant(input.receivedAt),
      body: sanitizeAdvisorUntrustedText(input.body ?? input.bodyHtml, { maxLength: STRING_LIMITS.body }),
      source: optionalControlledIdentifier(input.source, 64),
      capturedAt: optionalInstant(input.capturedAt),
      truncated: input.truncated === true,
    }
  }
  if (scope === 'fitness') {
    return {
      year: optionalDisplayText(input.year, 32),
      yearKey: optionalControlledIdentifier(input.yearKey, 64),
      vitality: finiteNumber(input.vitality),
      run50: finiteNumber(input.run50),
      flex: finiteNumber(input.flex),
      jump: finiteNumber(input.jump),
      strength: finiteNumber(input.strength),
      endureSecs: finiteNumber(input.endureSecs),
      gender: optionalControlledIdentifier(input.gender, 16),
      academicGrade: optionalDisplayText(input.academicGrade, 64),
      gradeGroup: optionalControlledIdentifier(input.gradeGroup, 16),
      heightCm: finiteNumber(input.heightCm),
      weightKg: finiteNumber(input.weightKg),
      totalScore: finiteNumber(input.totalScore ?? input.score),
      grade: optionalDisplayText(input.grade, 64),
      refreshState: optionalControlledIdentifier(input.refreshState, 32),
      capturedAt: optionalInstant(input.capturedAt),
    }
  }
  if (scope === 'identity') {
    return {
      name: optionalDisplayText(input.name, 120),
      studentId: optionalControlledIdentifier(input.studentId, 120),
      academicClass: optionalDisplayText(input.academicClass, 160),
      academicTrack: optionalDisplayText(input.academicTrack, 160),
      campus: optionalDisplayText(input.campus, 120),
    }
  }
  if (scope === 'attachment-text') {
    return {
      filename: optionalFilename(input.filename),
      contentType: optionalMimeType(input.contentType),
      size: Math.max(0, finiteNumber(input.size) ?? 0),
      text: sanitizeAdvisorUntrustedText(input.text, { maxLength: STRING_LIMITS.attachment }),
      capturedAt: optionalInstant(input.capturedAt),
    }
  }
  throw new TypeError(`Unsupported selected advisor entity scope: ${scope}`)
}

export function projectSelectedAdvisorEntity(value) {
  const input = record(value, 'Selected advisor entity')
  const scope = requiredText(input.scope || input.domain, 'Selected advisor entity scope', 64)
  const domain = requiredText(input.domain || (scope === 'mail-body' ? 'mailbox' : scope), 'Selected advisor entity domain', 64)
  const source = record(input.record ?? input.value, 'Selected advisor entity record')
  return {
    scope,
    domain,
    record: selectedEntityProjection(scope, source),
  }
}
