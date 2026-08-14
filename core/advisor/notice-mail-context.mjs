import sanitizeHtml from 'sanitize-html'

import { canonicalDigest, compareCanonicalText, normalizeText, parseCampusInstant } from './canonical.mjs'

export const NOTICE_MAIL_CONTEXT_SCHEMA = 'theia-advisor-notice-mail-context/v1'
export const MAIL_BODY_ENTITY_SCHEMA = 'theia-advisor-mail-body-entity/v1'
export const NOTICE_MAIL_RULES_VERSION = 'theia-advisor-notice-mail-rules/v1'
export const UNTRUSTED_CAMPUS_TEXT = 'untrusted'

export const NOTICE_MAIL_CONTEXT_LIMITS = Object.freeze({
  maxNotices: 24,
  maxEmails: 24,
  maxAttachmentsPerEmail: 24,
  maxTitleChars: 320,
  maxSummaryChars: 4_000,
  maxSubjectChars: 320,
  maxFromChars: 320,
  maxSnippetChars: 1_200,
  maxBodyChars: 12_000,
  maxFilenameChars: 240,
  maxSignalChars: 240,
  maxSignalsPerEntity: 12,
  maxTotalChars: 24_000,
})

export const NOTICE_MAIL_DEFAULT_LIMITS = NOTICE_MAIL_CONTEXT_LIMITS
export const NOTICE_MAIL_PROPOSAL_KINDS = Object.freeze([
  'review-selected-notice',
  'review-selected-mail',
  'draft-reminder-proposal',
])

const ACTIVE_SCHEMES = String.raw`(?:https?|ftp|file|javascript|data|vbscript|mailto)`
const DANGEROUS_ELEMENTS = [
  'script', 'style', 'iframe', 'frame', 'svg', 'object', 'embed', 'noscript',
  'template', 'form', 'input', 'button',
]
const VOID_DANGEROUS_ELEMENTS = new Set(['embed', 'frame', 'input'])
const BLOCK_ELEMENTS = String.raw`(?:address|article|aside|blockquote|br|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)`
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu
const INVISIBLE_AND_BIDI_CHARACTERS = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufeff\uffa0]/gu

function codePoints(value) {
  return Array.from(String(value ?? ''))
}

function charLength(value) {
  return codePoints(value).length
}

function sliceChars(value, limit) {
  return codePoints(value).slice(0, Math.max(0, limit)).join('')
}

function boundedInteger(value, fallback, minimum, maximum) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.trunc(numeric)))
}

function normalizedLimits(overrides = {}) {
  const source = overrides && typeof overrides === 'object' ? overrides : {}
  const bounded = (key, maximum = 1_000_000) => boundedInteger(
    source[key],
    NOTICE_MAIL_CONTEXT_LIMITS[key],
    1,
    maximum,
  )
  return Object.freeze({
    maxNotices: bounded('maxNotices', 1_000),
    maxEmails: bounded('maxEmails', 1_000),
    maxAttachmentsPerEmail: bounded('maxAttachmentsPerEmail', 1_000),
    maxTitleChars: bounded('maxTitleChars'),
    maxSummaryChars: bounded('maxSummaryChars'),
    maxSubjectChars: bounded('maxSubjectChars'),
    maxFromChars: bounded('maxFromChars'),
    maxSnippetChars: bounded('maxSnippetChars'),
    maxBodyChars: bounded('maxBodyChars'),
    maxFilenameChars: bounded('maxFilenameChars'),
    maxSignalChars: bounded('maxSignalChars'),
    maxSignalsPerEntity: bounded('maxSignalsPerEntity', 100),
    maxTotalChars: bounded('maxTotalChars', 10_000_000),
  })
}

function stripDangerousElementBlocks(value) {
  let text = String(value ?? '')
  const pairedNames = DANGEROUS_ELEMENTS.filter((name) => !VOID_DANGEROUS_ELEMENTS.has(name))
  const paired = new RegExp(`<(${pairedNames.join('|')})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, 'giu')
  for (let pass = 0; pass < 8; pass += 1) {
    const next = text.replace(paired, ' ')
    if (next === text) break
    text = next
  }
  const dangling = new RegExp(`<(?:${pairedNames.join('|')})\\b[^>]*>[\\s\\S]*$`, 'giu')
  return text
    .replace(dangling, ' ')
    .replace(new RegExp(`<\\/?(?:${DANGEROUS_ELEMENTS.join('|')})\\b[^>]*>`, 'giu'), ' ')
}

function stripExecutableReferences(value) {
  return String(value ?? '')
    .replace(/\[([^\]\r\n]{0,240})\]\(\s*\/\/[^)\r\n]*\)/giu, '$1')
    .replace(new RegExp(`\\[([^\\]\\r\\n]{0,240})\\]\\(\\s*${ACTIVE_SCHEMES}:[^)\\r\\n]*\\)`, 'giu'), '$1')
    .replace(new RegExp(`\\b${ACTIVE_SCHEMES}:[^\\s<>"'\u0060\\])}]+`, 'giu'), '[链接已移除]')
    .replace(/\bwww\.[^\s<>"'\u0060\])}]+/giu, '[链接已移除]')
    .replace(/(?<![:/])\/\/[^\s<>"'\u0060\])}]+/giu, '[链接已移除]')
}

function normalizeVisibleWhitespace(value) {
  return String(value ?? '')
    .replace(/\r\n?/gu, '\n')
    .replace(/[\t\f\v ]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

function safePlainText(value, { html = false } = {}) {
  const raw = normalizeText(value)
  let text = raw
  if (html || /<\/?[a-z][^>]*>/iu.test(text)) {
    text = stripDangerousElementBlocks(text)
      .replace(new RegExp(`<\\/?${BLOCK_ELEMENTS}\\b[^>]*>`, 'giu'), '\n')
    text = sanitizeHtml(text, {
      allowedTags: [],
      allowedAttributes: {},
      nonTextTags: DANGEROUS_ELEMENTS,
      disallowedTagsMode: 'discard',
    })
  }
  text = text
    .replace(CONTROL_CHARACTERS, '')
    .replace(INVISIBLE_AND_BIDI_CHARACTERS, '')
  text = stripExecutableReferences(text)
  return normalizeVisibleWhitespace(text).normalize('NFC')
}

/**
 * Converts campus-originated text into inert plain text. The trust marker is
 * deliberately returned with the value so callers cannot mistake sanitizing
 * for trusting the source.
 */
export function sanitizeUntrustedText(value, { html = false, maxChars = Number.MAX_SAFE_INTEGER } = {}) {
  const input = normalizeText(value)
  const sanitized = safePlainText(input, { html })
  const limit = boundedInteger(maxChars, Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER)
  const text = sliceChars(sanitized, limit)
  return Object.freeze({
    text,
    trust: UNTRUSTED_CAMPUS_TEXT,
    inputChars: charLength(input),
    sanitizedChars: charLength(sanitized),
    outputChars: charLength(text),
    sanitized: sanitized !== input,
    truncated: charLength(sanitized) > charLength(text),
  })
}

export function htmlToSafeText(value, options = {}) {
  return sanitizeUntrustedText(value, { ...options, html: true }).text
}

export function sanitizeUntrustedCampusText(value, { format = 'plain', maxCharacters = Number.MAX_SAFE_INTEGER } = {}) {
  return sanitizeUntrustedText(value, { html: format === 'html', maxChars: maxCharacters })
}

function bodySource(message) {
  const plain = typeof message?.body === 'string' && message.body.length > 0
  if (plain) return { value: message.body, html: false, kind: 'plain' }
  if (typeof message?.bodyHtml === 'string' && message.bodyHtml.length > 0) {
    return { value: message.bodyHtml, html: true, kind: 'html' }
  }
  return { value: '', html: false, kind: 'none' }
}

/**
 * The digest binds consent to both the selected message identity and the exact
 * locally stored body. A body or identity change therefore invalidates an old
 * grant without disclosing either value.
 */
export function mailBodyEntityDigest(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new TypeError('message must be an object')
  }
  const body = bodySource(message)
  if (body.kind === 'none') return null
  const disclosedText = safePlainText(body.value, { html: body.html })
  return canonicalDigest({
    schema: MAIL_BODY_ENTITY_SCHEMA,
    messageId: normalizeText(message.id, { trim: true }),
    source: safeSource(message.source),
    receivedAt: safeTimestamp(message.receivedAt),
    text: disclosedText,
  })
}

function safeIdentifier(value) {
  const text = normalizeText(value, { trim: true })
  if (!text || text.length > 512) return null
  return text
}

function selectedEntities(allEntities, selectedIds, selectedEntitiesInput) {
  const selectedObjects = Array.isArray(selectedEntitiesInput)
    ? selectedEntitiesInput.filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    : []
  const ids = Array.isArray(selectedIds)
    ? [...new Set(selectedIds.map(safeIdentifier).filter(Boolean))]
    : []
  const source = selectedObjects.length
    ? selectedObjects
    : (Array.isArray(allEntities) ? allEntities : []).filter((item) => ids.includes(safeIdentifier(item?.id)))
  const unique = new Map()
  for (const item of source) {
    const key = safeIdentifier(item.id) || canonicalDigest(item)
    if (!unique.has(key)) unique.set(key, item)
  }
  const selected = [...unique.entries()]
    .sort(([left], [right]) => compareCanonicalText(left, right))
    .map(([, item]) => item)
  const foundIds = new Set(selected.map((item) => safeIdentifier(item.id)).filter(Boolean))
  return {
    selected,
    missingCount: selectedObjects.length ? 0 : ids.filter((id) => !foundIds.has(id)).length,
  }
}

class TextBudget {
  constructor(maxTotalChars) {
    this.maxTotalChars = maxTotalChars
    this.emittedChars = 0
    this.totalInputChars = 0
    this.totalSanitizedChars = 0
    this.fields = []
  }

  take(path, value, { html = false, maxChars }) {
    const sanitized = sanitizeUntrustedText(value, { html })
    this.totalInputChars += sanitized.inputChars
    this.totalSanitizedChars += sanitized.sanitizedChars
    const afterFieldLimit = sliceChars(sanitized.text, maxChars)
    const remaining = Math.max(0, this.maxTotalChars - this.emittedChars)
    const text = sliceChars(afterFieldLimit, remaining)
    const reasons = []
    if (sanitized.sanitizedChars > charLength(afterFieldLimit)) reasons.push('field-limit')
    if (charLength(afterFieldLimit) > charLength(text)) reasons.push('context-limit')
    this.emittedChars += charLength(text)
    if (reasons.length) {
      this.fields.push(Object.freeze({
        path,
        inputChars: sanitized.inputChars,
        sanitizedChars: sanitized.sanitizedChars,
        outputChars: charLength(text),
        reasons: Object.freeze(reasons),
      }))
    }
    return Object.freeze({ text, sanitized: sanitized.sanitized, truncated: reasons.length > 0 })
  }

  summary(extra = {}) {
    const omittedNotices = Math.max(0, Number(extra.omittedNotices) || 0)
    const omittedEmails = Math.max(0, Number(extra.omittedEmails) || 0)
    const omittedAttachments = Math.max(0, Number(extra.omittedAttachments) || 0)
    return Object.freeze({
      truncated: this.fields.length > 0 || omittedNotices > 0 || omittedEmails > 0 || omittedAttachments > 0,
      maxTotalChars: this.maxTotalChars,
      emittedChars: this.emittedChars,
      totalInputChars: this.totalInputChars,
      totalSanitizedChars: this.totalSanitizedChars,
      omittedNotices,
      omittedEmails,
      omittedAttachments,
      fields: Object.freeze([...this.fields]),
    })
  }
}

function explicitTimeSignals(text, { timeZone, maxSignals }) {
  const fullExpression = /\b\d{4}\s*(?:年|[-/.])\s*\d{1,2}\s*(?:月|[-/.])\s*\d{1,2}(?:\s*日)?(?:\s*(?:上午|下午|晚上|中午)?\s*\d{1,2}\s*(?:[:：点时])\s*\d{0,2}(?:\s*分)?)?/gu
  const partialExpression = /(?:^|[^\d])((?:\d{1,2}\s*月\s*\d{1,2}\s*日)(?:\s*(?:上午|下午|晚上|中午)?\s*\d{1,2}\s*(?:[:：点时])\s*\d{0,2}(?:\s*分)?)?)/gu
  const timeExpression = /(?:^|[^\d])((?:上午|下午|晚上|中午)?\s*\d{1,2}\s*(?:[:：点时])\s*\d{0,2}(?:\s*分)?)/gu
  const occupied = []
  const candidates = []
  const seen = new Set()
  const overlaps = (start, end) => occupied.some((range) => start < range.end && end > range.start)
  const add = ({ sourceText, kind, parsed = null, start, end }) => {
    if (!sourceText || seen.has(sourceText)) return
    seen.add(sourceText)
    occupied.push({ start, end })
    candidates.push({
      text: sourceText,
      kind,
      instant: parsed?.iso || null,
      timeZone,
      inference: 'none',
      start,
    })
  }

  for (const match of text.matchAll(fullExpression)) {
    const sourceText = normalizeVisibleWhitespace(match[0])
    const start = match.index
    const end = start + match[0].length
    occupied.push({ start, end })
    const parsed = parseCampusInstant(sourceText, { timeZone })
    if (parsed) {
      seen.add(sourceText)
      candidates.push({ text: sourceText, kind: 'explicit-date-time', instant: parsed.iso, timeZone, inference: 'none', start })
    }
  }
  for (const match of text.matchAll(partialExpression)) {
    const raw = match[1]
    const relative = match[0].indexOf(raw)
    const start = match.index + relative
    const end = start + raw.length
    if (overlaps(start, end)) continue
    const sourceText = normalizeVisibleWhitespace(raw)
    const dateParts = sourceText.match(/^(\d{1,2})\s*月\s*(\d{1,2})\s*日/u)
    if (!dateParts) continue
    const month = Number(dateParts[1])
    const day = Number(dateParts[2])
    const calendarCheck = new Date(Date.UTC(2000, month - 1, day))
    if (month < 1 || month > 12 || day < 1
      || calendarCheck.getUTCMonth() + 1 !== month || calendarCheck.getUTCDate() !== day) continue
    add({ sourceText, kind: 'partial-date-time', start, end })
  }
  for (const match of text.matchAll(timeExpression)) {
    const raw = match[1]
    const relative = match[0].indexOf(raw)
    const start = match.index + relative
    const end = start + raw.length
    if (overlaps(start, end)) continue
    add({ sourceText: normalizeVisibleWhitespace(raw), kind: 'time-only', start, end })
  }
  return candidates
    .sort((left, right) => left.start - right.start || compareCanonicalText(left.text, right.text))
    .slice(0, maxSignals)
    .map(({ start: _start, ...signal }) => Object.freeze(signal))
}

function knownCourseValues(knownCourses) {
  const values = []
  for (const course of Array.isArray(knownCourses) ? knownCourses : []) {
    if (typeof course === 'string') values.push(course)
    else if (course && typeof course === 'object') {
      for (const key of ['title', 'courseName', 'name', 'courseCode', 'code']) values.push(course[key])
    }
  }
  return [...new Set(values.map((value) => safePlainText(value)).filter((value) => value.length >= 2 && value.length <= 120))]
    .sort(compareCanonicalText)
}

function courseSignals(text, { knownCourses, maxSignals }) {
  const results = []
  const seen = new Set()
  const add = (value, basis) => {
    const clue = normalizeVisibleWhitespace(value)
    if (!clue || seen.has(clue)) return
    seen.add(clue)
    results.push(Object.freeze({ text: clue, basis, inference: 'none' }))
  }
  for (const value of knownCourseValues(knownCourses)) {
    if (text.includes(value)) add(value, 'known-course-exact')
    if (results.length >= maxSignals) return results
  }
  const labeled = [
    /(?:课程|科目|教学班)(?:名称)?\s*[:：]\s*([^\n，。；;]{1,80})/gu,
    /(?:课程|科目)[^《\n]{0,12}《([^》\n]{1,80})》/gu,
    /课程代码\s*[:：]\s*([A-Za-z0-9._-]{2,40})/giu,
  ]
  for (const expression of labeled) {
    for (const match of text.matchAll(expression)) {
      add(match[1], 'explicit-label')
      if (results.length >= maxSignals) return results
    }
  }
  return results
}

const ACTION_RULES = Object.freeze([
  ['submission-mentioned', /提交|递交|上交|交作业/iu],
  ['completion-mentioned', /完成|办理|填写|确认/iu],
  ['registration-mentioned', /报名|登记|选报|申请/iu],
  ['attendance-mentioned', /参加|到场|签到/iu],
  ['review-mentioned', /查看|阅读|核对|留意|关注/iu],
  ['contact-mentioned', /联系|咨询|回复/iu],
  ['download-mentioned', /下载|领取/iu],
])

function actionSignals(text, { maxSignals }) {
  const sentences = text.split(/(?<=[。！？!?；;\n])/u).map(normalizeVisibleWhitespace).filter(Boolean)
  const results = []
  const seen = new Set()
  for (const sentence of sentences) {
    for (const [kind, expression] of ACTION_RULES) {
      if (!expression.test(sentence)) continue
      const key = `${kind}\u0000${sentence}`
      if (seen.has(key)) continue
      seen.add(key)
      results.push(Object.freeze({
        text: sentence,
        kind,
        inference: 'none',
        executable: false,
      }))
      if (results.length >= maxSignals) return results
    }
  }
  return results
}

export function extractNoticeSignals(notice, { timeZone = 'Asia/Shanghai', knownCourses = [], maxSignals = NOTICE_MAIL_CONTEXT_LIMITS.maxSignalsPerEntity } = {}) {
  if (!notice || typeof notice !== 'object' || Array.isArray(notice)) throw new TypeError('notice must be an object')
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0))
  } catch {
    throw new TypeError('timeZone must be a valid IANA time zone')
  }
  const limit = boundedInteger(maxSignals, NOTICE_MAIL_CONTEXT_LIMITS.maxSignalsPerEntity, 1, 100)
  const title = safePlainText(notice.title)
  const summary = safePlainText(notice.summary)
  const text = [title, summary].filter(Boolean).join('\n')
  return Object.freeze({
    times: Object.freeze(explicitTimeSignals(text, { timeZone, maxSignals: limit })),
    courses: Object.freeze(courseSignals(text, { knownCourses, maxSignals: limit })),
    actions: Object.freeze(actionSignals(text, { maxSignals: limit })),
  })
}

function safeTimestamp(value) {
  const parsed = parseCampusInstant(value)
  return parsed?.iso || null
}

function safeSource(value) {
  const text = normalizeText(value, { trim: true }).toLowerCase()
  return /^[a-z0-9._-]{1,64}$/.test(text) ? text : null
}

function noticeEntityDigest(notice) {
  return canonicalDigest({
    kind: 'notice',
    id: normalizeText(notice?.id, { trim: true }),
    title: safePlainText(notice?.title),
    summary: safePlainText(notice?.summary),
    publishedAt: safeTimestamp(notice?.publishedAt),
    source: safeSource(notice?.source),
  })
}

function takeSignal(budget, path, signal, limits) {
  const value = budget.take(`${path}.text`, signal.text, { maxChars: limits.maxSignalChars })
  return Object.freeze({ ...signal, text: value.text, truncated: value.truncated })
}

function projectNotice(notice, index, budget, { limits, timeZone, knownCourses }) {
  const path = `notices[${index}]`
  const title = budget.take(`${path}.title`, notice.title, { maxChars: limits.maxTitleChars })
  const summary = budget.take(`${path}.summary`, notice.summary, { maxChars: limits.maxSummaryChars })
  const extracted = extractNoticeSignals({ title: title.text, summary: summary.text }, {
    timeZone,
    knownCourses,
    maxSignals: limits.maxSignalsPerEntity,
  })
  const signals = Object.freeze({
    times: Object.freeze(extracted.times.map((signal, signalIndex) => takeSignal(budget, `${path}.signals.times[${signalIndex}]`, signal, limits))),
    courses: Object.freeze(extracted.courses.map((signal, signalIndex) => takeSignal(budget, `${path}.signals.courses[${signalIndex}]`, signal, limits))),
    actions: Object.freeze(extracted.actions.map((signal, signalIndex) => takeSignal(budget, `${path}.signals.actions[${signalIndex}]`, signal, limits))),
  })
  return Object.freeze({
    entityDigest: noticeEntityDigest(notice),
    trust: UNTRUSTED_CAMPUS_TEXT,
    title: title.text,
    summary: summary.text,
    publishedAt: safeTimestamp(notice.publishedAt),
    source: safeSource(notice.source),
    signals,
    truncated: title.truncated || summary.truncated
      || [...signals.times, ...signals.courses, ...signals.actions].some((signal) => signal.truncated),
  })
}

function safeFilename(value, maxChars) {
  const leaf = normalizeText(value).split(/[\\/]/u).at(-1) || ''
  return sanitizeUntrustedText(leaf, { maxChars }).text
}

function safeContentType(value) {
  const text = normalizeText(value, { trim: true }).toLowerCase()
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(text) ? text.slice(0, 160) : null
}

export function projectAttachmentMetadata(attachments, { maxAttachments = NOTICE_MAIL_CONTEXT_LIMITS.maxAttachmentsPerEmail, maxFilenameChars = NOTICE_MAIL_CONTEXT_LIMITS.maxFilenameChars } = {}) {
  const limit = boundedInteger(maxAttachments, NOTICE_MAIL_CONTEXT_LIMITS.maxAttachmentsPerEmail, 0, 1_000)
  const filenameLimit = boundedInteger(maxFilenameChars, NOTICE_MAIL_CONTEXT_LIMITS.maxFilenameChars, 1, 10_000)
  return Object.freeze((Array.isArray(attachments) ? attachments : []).slice(0, limit).map((attachment, position) => {
    const index = Number.isInteger(attachment?.index) && attachment.index >= 0 ? attachment.index : position
    const numericSize = Number(attachment?.size)
    return Object.freeze({
      index,
      filename: safeFilename(attachment?.filename, filenameLimit) || null,
      contentType: safeContentType(attachment?.contentType),
      size: Number.isFinite(numericSize) && numericSize >= 0
        ? Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(numericSize))
        : 0,
    })
  }))
}

function addDigest(target, value) {
  const digest = normalizeText(value, { trim: true }).toLowerCase()
  if (/^[a-f0-9]{64}$/.test(digest)) target.add(digest)
}

function collectAuthorizedBodyDigests(value, target = new Set(), explicitGrant = false) {
  if (typeof value === 'string') {
    if (explicitGrant) addDigest(target, value)
    return target
  }
  if (Array.isArray(value) || value instanceof Set) {
    for (const item of value) collectAuthorizedBodyDigests(item, target, explicitGrant)
    return target
  }
  if (value instanceof Map) {
    for (const [digest, granted] of value.entries()) if (granted === true) addDigest(target, digest)
    return target
  }
  if (!value || typeof value !== 'object') return target

  const domains = Array.isArray(value.domains) ? value.domains : []
  const mailBodyScope = value.scope === 'mail-body' || value.privacyScope === 'mail-body' || domains.includes('mail-body')
  const granted = value.authorized === true || value.granted === true || value.approved === true
    || (value.schema === 'theia-advisor-consent/v1' && mailBodyScope && value.revoked !== true)
  if (granted && mailBodyScope) {
    addDigest(target, value.entityDigest)
    addDigest(target, value.digest)
    for (const digest of Array.isArray(value.entityDigests) ? value.entityDigests : []) addDigest(target, digest)
  }
  if (mailBodyScope) {
    for (const [digest, decision] of Object.entries(value.byEntityDigest || {})) {
      if (decision === true || decision?.authorized === true || decision?.granted === true) addDigest(target, digest)
    }
  }
  return target
}

function authorizedBodyDigests(options) {
  const digests = new Set()
  collectAuthorizedBodyDigests(options.authorizedBodyDigests, digests, true)
  collectAuthorizedBodyDigests(options.mailBodyAuthorizations, digests, false)
  collectAuthorizedBodyDigests(options.bodyConsents, digests, false)
  collectAuthorizedBodyDigests(options.consents, digests, false)
  return digests
}

function projectEmailMetadata(message, index, budget, options) {
  const { limits, includeAttachmentMetadata } = options
  const path = `emails[${index}]`
  const subject = budget.take(`${path}.subject`, message.subject, { maxChars: limits.maxSubjectChars })
  const from = budget.take(`${path}.from`, message.from, { maxChars: limits.maxFromChars })
  const snippet = budget.take(`${path}.snippet`, message.snippet, { maxChars: limits.maxSnippetChars })
  const bodyDigest = mailBodyEntityDigest(message)
  const body = bodySource(message)
  const rawAttachments = Array.isArray(message.attachments) ? message.attachments : []
  const attachments = includeAttachmentMetadata
    ? projectAttachmentMetadata(rawAttachments, {
      maxAttachments: limits.maxAttachmentsPerEmail,
      maxFilenameChars: limits.maxFilenameChars,
    }).map((attachment, attachmentIndex) => {
      const filename = budget.take(`${path}.attachments[${attachmentIndex}].filename`, attachment.filename, {
        maxChars: limits.maxFilenameChars,
      })
      return Object.freeze({ ...attachment, filename: filename.text || null })
    })
    : []
  return {
    metadata: {
      entityDigest: canonicalDigest({
        kind: 'mail-metadata',
        id: normalizeText(message.id, { trim: true }),
        subject: safePlainText(message.subject),
        from: safePlainText(message.from),
        receivedAt: safeTimestamp(message.receivedAt),
      }),
      bodyEntityDigest: bodyDigest,
      trust: UNTRUSTED_CAMPUS_TEXT,
      subject: subject.text,
      from: from.text,
      receivedAt: safeTimestamp(message.receivedAt),
      snippet: snippet.text,
      attachments: Object.freeze(attachments),
      truncated: subject.truncated || from.truncated || snippet.truncated,
    },
    body,
    path,
    omittedAttachments: includeAttachmentMetadata
      ? Math.max(0, rawAttachments.length - attachments.length)
      : 0,
  }
}

function projectEmailBody(projected, budget, { limits, bodyDigests }) {
  const { metadata, body, path } = projected
  const bodyDigest = metadata.bodyEntityDigest
  const bodyAuthorized = body.kind !== 'none' && typeof bodyDigest === 'string' && bodyDigests.has(bodyDigest)
  const bodyProjection = bodyAuthorized
    ? budget.take(`${path}.body`, body.value, { html: body.html, maxChars: limits.maxBodyChars })
    : Object.freeze({ text: null, sanitized: false, truncated: false })
  const omittedByBudget = bodyAuthorized && bodyProjection.truncated && !bodyProjection.text
  return Object.freeze({
    ...metadata,
    body: bodyProjection.text,
    bodyAuthorization: body.kind === 'none'
      ? 'no-body'
      : (bodyAuthorized ? (omittedByBudget ? 'omitted-by-budget' : 'included') : 'not-authorized'),
    truncated: metadata.truncated || bodyProjection.truncated,
  })
}

function safeSuggestions(notices, emails) {
  const suggestions = []
  for (const notice of notices) {
    if (notice.signals.actions.length > 0) {
      suggestions.push({
        id: `suggestion:${canonicalDigest({ entityDigest: notice.entityDigest, kind: 'review-notice' }).slice(0, 20)}`,
        kind: 'review-selected-notice',
        permission: 'read-only',
        sourceEntityDigest: notice.entityDigest,
        effect: 'none',
      })
    }
    if (notice.signals.times.length > 0) {
      suggestions.push({
        id: `suggestion:${canonicalDigest({ entityDigest: notice.entityDigest, kind: 'draft-reminder' }).slice(0, 20)}`,
        kind: 'draft-reminder-proposal',
        permission: 'proposal-only',
        sourceEntityDigest: notice.entityDigest,
        effect: 'none',
      })
    }
  }
  for (const email of emails) {
    suggestions.push({
      id: `suggestion:${canonicalDigest({ entityDigest: email.entityDigest, kind: 'review-mail' }).slice(0, 20)}`,
      kind: 'review-selected-mail',
      permission: 'read-only',
      sourceEntityDigest: email.entityDigest,
      effect: 'none',
    })
  }
  return Object.freeze(suggestions
    .sort((left, right) => compareCanonicalText(left.id, right.id))
    .map((suggestion) => Object.freeze(suggestion)))
}

/**
 * Builds the P5 model-facing context. An empty selection always produces an
 * empty context; the function never falls back to every notice or message.
 */
export function buildNoticeMailContext(input = {}, contextOptions = {}) {
  const options = {
    ...(input && typeof input === 'object' ? input : {}),
    ...(contextOptions && typeof contextOptions === 'object' ? contextOptions : {}),
    limits: {
      ...(input?.limits && typeof input.limits === 'object' ? input.limits : {}),
      ...(contextOptions?.limits && typeof contextOptions.limits === 'object' ? contextOptions.limits : {}),
    },
  }
  const limits = normalizedLimits(options.limits)
  const timeZone = normalizeText(options.timeZone || 'Asia/Shanghai', { trim: true })
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0))
  } catch {
    throw new TypeError('timeZone must be a valid IANA time zone')
  }
  const noticeSelection = selectedEntities(options.notices, options.selectedNoticeIds, options.selectedNotices)
  const emailSelection = selectedEntities(options.emails, options.selectedEmailIds, options.selectedEmails)
  const selectedNotices = noticeSelection.selected.slice(0, limits.maxNotices)
  const selectedEmails = emailSelection.selected.slice(0, limits.maxEmails)
  const budget = new TextBudget(limits.maxTotalChars)
  const notices = Object.freeze(selectedNotices.map((notice, index) => projectNotice(notice, index, budget, {
    limits,
    timeZone,
    knownCourses: options.knownCourses,
  })))
  const bodyDigests = authorizedBodyDigests(options)
  let omittedAttachments = 0
  const projectedEmailMetadata = selectedEmails.map((message, index) => {
    const projected = projectEmailMetadata(message, index, budget, {
      limits,
      includeAttachmentMetadata: options.includeAttachmentMetadata === true,
    })
    omittedAttachments += projected.omittedAttachments
    return projected
  })
  // Body text is budgeted only after every selected message has received its
  // metadata allocation. A long first body cannot erase later subjects.
  const emails = Object.freeze(projectedEmailMetadata.map((projected) => projectEmailBody(projected, budget, {
    limits,
    bodyDigests,
  })))
  const truncation = budget.summary({
    omittedNotices: Math.max(0, noticeSelection.selected.length - selectedNotices.length),
    omittedEmails: Math.max(0, emailSelection.selected.length - selectedEmails.length),
    omittedAttachments,
  })
  return Object.freeze({
    schema: NOTICE_MAIL_CONTEXT_SCHEMA,
    rulesVersion: NOTICE_MAIL_RULES_VERSION,
    trust: UNTRUSTED_CAMPUS_TEXT,
    allowedCapabilityClasses: Object.freeze(['read-only', 'proposal-only']),
    notices,
    emails,
    suggestions: safeSuggestions(notices, emails),
    selection: Object.freeze({
      noticeCount: notices.length,
      emailCount: emails.length,
      missingNoticeCount: noticeSelection.missingCount,
      missingEmailCount: emailSelection.missingCount,
    }),
    truncation,
  })
}

export function buildSelectedNoticeContext(options = {}) {
  return buildNoticeMailContext({ ...options, emails: [], selectedEmails: [], selectedEmailIds: [] })
}

export function buildSelectedMailContext(options = {}) {
  return buildNoticeMailContext({ ...options, notices: [], selectedNotices: [], selectedNoticeIds: [] })
}
