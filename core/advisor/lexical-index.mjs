import { canonicalDigest, canonicalJson, compareCanonicalText, normalizeText, parseInstant } from './canonical.mjs'
import { sanitizeUntrustedText } from './notice-mail-context.mjs'

export const LEXICAL_INDEX_SCHEMA = 'theia-advisor-lexical-index/v1'
export const LEXICAL_DOCUMENT_SCHEMA = 'theia-advisor-lexical-document/v1'

export const LEXICAL_PRIVACY_SCOPES = Object.freeze([
  'public-academic',
  'private-academic',
  'mail-metadata',
  'mail-body',
  'coursework',
  'attachment-text',
])

export const LEXICAL_SENSITIVE_SCOPES = Object.freeze(['mail-body', 'attachment-text'])
export const LEXICAL_DEFAULT_SEARCH_SCOPES = Object.freeze([
  'public-academic',
  'private-academic',
  'mail-metadata',
  'coursework',
])

export const LEXICAL_INDEX_LIMITS = Object.freeze({
  maxDocuments: 20_000,
  maxFragmentChars: 24_000,
  maxTermsPerDocument: 4_096,
  maxQueryChars: 512,
  maxQueryTerms: 96,
  maxResults: 20,
  maxResultChars: 8_000,
  maxExcerptChars: 800,
})

const PRIVACY_SCOPE_SET = new Set(LEXICAL_PRIVACY_SCOPES)
const SENSITIVE_SCOPE_SET = new Set(LEXICAL_SENSITIVE_SCOPES)
const CONTROLLED_IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:@-]*$/u
const HTML_MARKUP = /<\/?(?:[a-z][a-z0-9:-]*)(?:\s[^>]*)?>/iu
const BINARY_CTORS = new Set(['ArrayBuffer', 'SharedArrayBuffer', 'Buffer', 'Blob', 'File'])
const FORBIDDEN_FIELD_NAMES = new Set([
  'bodyhtml', 'html', 'path', 'filepath', 'url', 'sourceurl', 'href', 'cookie',
  'cookies', 'token', 'apikey', 'password', 'secret', 'buffer', 'binary', 'blob',
  'bytes', 'content', 'data', 'headers', 'raw',
])

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
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.trunc(number)))
}

function normalizeLimits(overrides = {}) {
  const source = overrides && typeof overrides === 'object' ? overrides : {}
  const bounded = (key, maximum) => boundedInteger(source[key], LEXICAL_INDEX_LIMITS[key], 1, maximum)
  return Object.freeze({
    maxDocuments: bounded('maxDocuments', 1_000_000),
    maxFragmentChars: bounded('maxFragmentChars', 10_000_000),
    maxTermsPerDocument: bounded('maxTermsPerDocument', 100_000),
    maxQueryChars: bounded('maxQueryChars', 100_000),
    maxQueryTerms: bounded('maxQueryTerms', 10_000),
    maxResults: bounded('maxResults', 10_000),
    maxResultChars: bounded('maxResultChars', 10_000_000),
    maxExcerptChars: bounded('maxExcerptChars', 1_000_000),
  })
}

function controlledIdentifier(value, label, maximum = 256) {
  const text = normalizeText(value, { trim: true })
  if (!text || charLength(text) > maximum || !CONTROLLED_IDENTIFIER.test(text)) {
    throw new TypeError(`${label} must be a controlled identifier`)
  }
  return text
}

function canonicalDataset(value) {
  return controlledIdentifier(value, 'dataset', 80).toLowerCase()
}

function canonicalPrivacyScope(value) {
  const scope = normalizeText(value, { trim: true }).toLowerCase()
  if (!PRIVACY_SCOPE_SET.has(scope)) throw new TypeError(`Unsupported lexical privacy scope: ${scope || '(empty)'}`)
  return scope
}

function containsBinary(value, seen = new Set()) {
  if (!value || typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return true
  if (BINARY_CTORS.has(value.constructor?.name)) return true
  if (Array.isArray(value)) return value.some((item) => containsBinary(item, seen))
  return Object.values(value).some((item) => containsBinary(item, seen))
}

function forbiddenFieldName(value) {
  const compact = String(value ?? '').replace(/[^a-z0-9]/giu, '').toLowerCase()
  return FORBIDDEN_FIELD_NAMES.has(compact)
    || compact.endsWith('filepath')
    || compact.endsWith('sourceurl')
    || compact.endsWith('cookie')
    || compact.endsWith('token')
}

function assertSafeFragmentShape(fragment) {
  if (!fragment || typeof fragment !== 'object' || Array.isArray(fragment)) {
    throw new TypeError('lexical fragment must be an object')
  }
  if (containsBinary(fragment)) throw new TypeError('lexical fragments cannot contain binary values')
  for (const key of Object.keys(fragment)) {
    if (['text', 'authorization', 'authorized', 'consent', 'entityDigest'].includes(key)) continue
    if (forbiddenFieldName(key)) throw new TypeError(`lexical fragment contains a forbidden field: ${key}`)
  }
  for (const container of [fragment.authorization, fragment.consent]) {
    if (!container || typeof container !== 'object') continue
    for (const key of Object.keys(container)) {
      if (forbiddenFieldName(key)) throw new TypeError(`lexical authorization contains a forbidden field: ${key}`)
    }
  }
}

function scrubPathsAndSecrets(value) {
  return String(value ?? '')
    .replace(/(^|[\s([{"'=])(?:[a-zA-Z]:\\|\\\\)[^\s<>"'\u0060]+/gu, '$1[本地路径已移除]')
    .replace(/(^|[\s([{"'=])\/(?:Users|home|etc|tmp|var|opt|private|mnt|Volumes)(?:\/[^\s<>"'\u0060]*)?/giu, '$1[本地路径已移除]')
    .replace(/\bbearer\s+[a-z0-9._~+/-]+=*/giu, '[敏感值已移除]')
    .replace(/\b(?:cookie|authorization|bearer|token|api[_ -]?key|password|secret)\s*[:=]\s*[^\s,;]+/giu, '[敏感值已移除]')
    .replace(/\s+/gu, ' ')
    .trim()
}

function safeFragmentText(value, maximum) {
  if (typeof value !== 'string') throw new TypeError('lexical fragment text must be a string')
  const sanitized = sanitizeUntrustedText(value, {
    html: HTML_MARKUP.test(value),
  })
  const scrubbed = scrubPathsAndSecrets(sanitized.text)
  const text = sliceChars(scrubbed, maximum)
  return Object.freeze({
    text,
    inputChars: sanitized.inputChars,
    outputChars: charLength(text),
    truncated: charLength(scrubbed) > charLength(text),
    sanitized: sanitized.sanitized || scrubbed !== sanitized.text,
  })
}

function appendTerm(terms, frequencies, value, maximum) {
  const term = normalizeText(value, { trim: true }).normalize('NFKC').toLocaleLowerCase('und')
  if (!term || charLength(term) > 64 || terms.length >= maximum) return
  frequencies.set(term, (frequencies.get(term) || 0) + 1)
  if (!terms.includes(term)) terms.push(term)
}

function lexicalTerms(value, maximum) {
  const text = normalizeText(value).normalize('NFKC').toLocaleLowerCase('und')
  const ordered = []
  const frequencies = new Map()
  const runs = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|[\p{L}\p{N}]+/gu) || []
  for (const run of runs) {
    const characters = codePoints(run)
    const cjk = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+$/u.test(run)
    if (!cjk) {
      appendTerm(ordered, frequencies, run, maximum)
      continue
    }
    if (characters.length <= 64) appendTerm(ordered, frequencies, run, maximum)
    if (characters.length === 1) {
      appendTerm(ordered, frequencies, characters[0], maximum)
      continue
    }
    for (const size of [2, 3]) {
      if (characters.length < size) continue
      for (let index = 0; index <= characters.length - size; index += 1) {
        appendTerm(ordered, frequencies, characters.slice(index, index + size).join(''), maximum)
        if (ordered.length >= maximum) break
      }
      if (ordered.length >= maximum) break
    }
  }
  const normalizedTerms = [...new Set(ordered)].sort(compareCanonicalText)
  const retained = new Set(normalizedTerms)
  return {
    normalizedTerms,
    frequencies: new Map([...frequencies].filter(([term]) => retained.has(term))),
  }
}

export function normalizeLexicalTerms(value, { maxTerms = LEXICAL_INDEX_LIMITS.maxTermsPerDocument } = {}) {
  const maximum = boundedInteger(maxTerms, LEXICAL_INDEX_LIMITS.maxTermsPerDocument, 1, 100_000)
  const text = scrubPathsAndSecrets(sanitizeUntrustedText(value, {
    html: HTML_MARKUP.test(String(value ?? '')),
    maxChars: LEXICAL_INDEX_LIMITS.maxFragmentChars,
  }).text)
  return Object.freeze(lexicalTerms(text, maximum).normalizedTerms)
}

function consentDigests(value, target = new Set()) {
  if (typeof value === 'string') {
    const digest = value.trim().toLowerCase()
    if (/^[a-f0-9]{64}$/.test(digest)) target.add(digest)
    return target
  }
  if (Array.isArray(value) || value instanceof Set) {
    for (const item of value) consentDigests(item, target)
    return target
  }
  if (!value || typeof value !== 'object') return target
  for (const key of ['entityDigest', 'digest', 'sourceDigest']) consentDigests(value[key], target)
  consentDigests(value.entityDigests, target)
  return target
}

function assertSensitiveAuthorization(fragment, privacyScope, sourceDigest) {
  if (!SENSITIVE_SCOPE_SET.has(privacyScope)) return
  const authorization = fragment.authorization || fragment.consent
  const explicitlyGranted = fragment.authorized === true
    || authorization?.authorized === true
    || authorization?.granted === true
    || authorization?.approved === true
  if (!explicitlyGranted) throw new TypeError(`${privacyScope} fragments require explicit authorization`)
  if (authorization?.scope && authorization.scope !== privacyScope) {
    throw new TypeError(`${privacyScope} authorization scope mismatch`)
  }
  const boundDigests = consentDigests(authorization)
  if (boundDigests.size > 0) {
    const entityDigest = normalizeText(fragment.entityDigest, { trim: true }).toLowerCase()
    if (!boundDigests.has(sourceDigest) && !boundDigests.has(entityDigest)) {
      throw new TypeError(`${privacyScope} authorization digest mismatch`)
    }
  }
}

function normalizeFragment(fragment, limits) {
  assertSafeFragmentShape(fragment)
  const documentId = controlledIdentifier(fragment.documentId, 'documentId', 256)
  const dataset = canonicalDataset(fragment.dataset)
  const entityId = controlledIdentifier(fragment.entityId, 'entityId', 256)
  const privacyScope = canonicalPrivacyScope(fragment.privacyScope)
  const safeText = safeFragmentText(fragment.text, limits.maxFragmentChars)
  const suppliedDigest = normalizeText(fragment.sourceDigest, { trim: true }).toLowerCase()
  const sourceDigest = suppliedDigest || canonicalDigest({ dataset, entityId, text: safeText.text })
  if (!/^[a-f0-9]{64}$/.test(sourceDigest)) throw new TypeError('sourceDigest must be a SHA-256 hex digest')
  assertSensitiveAuthorization(fragment, privacyScope, sourceDigest)
  const parsedCapturedAt = fragment.capturedAt === null || fragment.capturedAt === undefined || fragment.capturedAt === ''
    ? null
    : parseInstant(fragment.capturedAt)
  if (fragment.capturedAt && !parsedCapturedAt) throw new TypeError('capturedAt must include an explicit UTC offset')
  const terms = lexicalTerms(safeText.text, limits.maxTermsPerDocument)
  return Object.freeze({
    schema: LEXICAL_DOCUMENT_SCHEMA,
    documentId,
    dataset,
    entityId,
    sourceDigest,
    capturedAt: parsedCapturedAt?.iso || null,
    privacyScope,
    normalizedTerms: Object.freeze(terms.normalizedTerms),
    text: safeText.text,
    textTruncated: safeText.truncated,
    textSanitized: safeText.sanitized,
    frequencies: terms.frequencies,
  })
}

function publicDocument(document) {
  if (!document) return null
  return Object.freeze({
    schema: document.schema,
    documentId: document.documentId,
    dataset: document.dataset,
    entityId: document.entityId,
    sourceDigest: document.sourceDigest,
    capturedAt: document.capturedAt,
    privacyScope: document.privacyScope,
    normalizedTerms: Object.freeze([...document.normalizedTerms]),
    text: document.text,
    textTruncated: document.textTruncated,
    textSanitized: document.textSanitized,
  })
}

function normalizeSearchScopes(options = {}) {
  const requested = options.privacyScopes ?? options.scopes
  const values = requested === undefined
    ? LEXICAL_DEFAULT_SEARCH_SCOPES
    : (Array.isArray(requested) || requested instanceof Set ? [...requested] : [requested])
  return Object.freeze([...new Set(values.map(canonicalPrivacyScope))].sort(compareCanonicalText))
}

function searchOptions(options, limits) {
  return Object.freeze({
    privacyScopes: normalizeSearchScopes(options),
    maxResults: boundedInteger(options.maxResults, limits.maxResults, 1, limits.maxResults),
    maxResultChars: boundedInteger(options.maxResultChars ?? options.maxChars, limits.maxResultChars, 1, limits.maxResultChars),
    maxExcerptChars: boundedInteger(options.maxExcerptChars, limits.maxExcerptChars, 1, limits.maxExcerptChars),
  })
}

function excerptFor(document, queryTerms, maximum) {
  const lowered = document.text.normalize('NFKC').toLocaleLowerCase('und')
  let offset = Number.MAX_SAFE_INTEGER
  for (const term of queryTerms) {
    const index = lowered.indexOf(term)
    if (index >= 0) offset = Math.min(offset, charLength(lowered.slice(0, index)))
  }
  const characters = codePoints(document.text)
  const start = offset === Number.MAX_SAFE_INTEGER ? 0 : Math.max(0, offset - Math.floor(maximum / 4))
  const excerpt = characters.slice(start, start + maximum).join('')
  return Object.freeze({
    text: excerpt,
    truncated: start > 0 || start + charLength(excerpt) < characters.length,
    start,
  })
}

export class LexicalIndex {
  #limits
  #documents = new Map()
  #postings = new Map()

  constructor(options = {}) {
    this.#limits = normalizeLimits(options.limits || options)
  }

  get schema() {
    return LEXICAL_INDEX_SCHEMA
  }

  get size() {
    return this.#documents.size
  }

  #addPostings(document) {
    for (const term of document.normalizedTerms) {
      if (!this.#postings.has(term)) this.#postings.set(term, new Map())
      this.#postings.get(term).set(document.documentId, document.frequencies.get(term) || 1)
    }
  }

  #removePostings(document) {
    for (const term of document.normalizedTerms) {
      const posting = this.#postings.get(term)
      if (!posting) continue
      posting.delete(document.documentId)
      if (posting.size === 0) this.#postings.delete(term)
    }
  }

  #assertCapacity(documents, removals = []) {
    const additions = new Set(documents
      .map((document) => document.documentId)
      .filter((documentId) => !this.#documents.has(documentId)))
    if (this.#documents.size - removals.length + additions.size > this.#limits.maxDocuments) {
      throw new RangeError(`lexical index document limit exceeded (${this.#limits.maxDocuments})`)
    }
  }

  #assertIdentityCompatible(documents) {
    for (const document of documents) {
      const previous = this.#documents.get(document.documentId)
      if (!previous) continue
      if (previous.dataset !== document.dataset || previous.entityId !== document.entityId
        || previous.privacyScope !== document.privacyScope) {
        throw new TypeError(`lexical document identity fields are immutable: ${document.documentId}`)
      }
    }
  }

  #upsertNormalized(document) {
    const previous = this.#documents.get(document.documentId)
    this.#assertIdentityCompatible([document])
    const unchanged = previous && canonicalJson(publicDocument(previous)) === canonicalJson(publicDocument(document))
    if (unchanged) return Object.freeze({ status: 'unchanged', document: publicDocument(previous) })
    if (!previous && this.#documents.size >= this.#limits.maxDocuments) {
      throw new RangeError(`lexical index document limit exceeded (${this.#limits.maxDocuments})`)
    }
    if (previous) this.#removePostings(previous)
    this.#documents.set(document.documentId, document)
    this.#addPostings(document)
    return Object.freeze({ status: previous ? 'replaced' : 'added', document: publicDocument(document) })
  }

  upsert(fragment) {
    return this.#upsertNormalized(normalizeFragment(fragment, this.#limits))
  }

  upsertMany(fragments) {
    const values = Array.isArray(fragments) ? fragments : []
    const normalized = values.map((fragment) => normalizeFragment(fragment, this.#limits))
    const seen = new Set()
    for (const document of normalized) {
      if (seen.has(document.documentId)) throw new TypeError(`duplicate lexical documentId: ${document.documentId}`)
      seen.add(document.documentId)
    }
    this.#assertIdentityCompatible(normalized)
    this.#assertCapacity(normalized)
    return Object.freeze(normalized.map((document) => this.#upsertNormalized(document)))
  }

  replaceFragments(fragments, options = {}) {
    const values = Array.isArray(fragments) ? fragments : []
    const normalized = values.map((fragment) => normalizeFragment(fragment, this.#limits))
    const seen = new Set()
    for (const document of normalized) {
      if (seen.has(document.documentId)) throw new TypeError(`duplicate lexical documentId: ${document.documentId}`)
      seen.add(document.documentId)
    }
    let removalScope = null
    if (options.removeMissing === true) {
      const datasets = new Set(normalized.map((document) => document.dataset))
      const scopes = new Set(normalized.map((document) => document.privacyScope))
      const dataset = options.dataset ? canonicalDataset(options.dataset) : (datasets.size === 1 ? [...datasets][0] : null)
      const privacyScope = options.privacyScope ? canonicalPrivacyScope(options.privacyScope) : (scopes.size === 1 ? [...scopes][0] : null)
      if (!dataset || !privacyScope) throw new TypeError('removeMissing requires one explicit or unambiguous dataset and privacyScope')
      removalScope = { dataset, privacyScope }
      if (normalized.some((document) => document.dataset !== dataset || document.privacyScope !== privacyScope)) {
        throw new TypeError('replacement fragments must match the removal dataset and privacyScope')
      }
    }
    this.#assertIdentityCompatible(normalized)
    const removalIds = removalScope
      ? [...this.#documents.values()]
        .filter((document) => document.dataset === removalScope.dataset
          && document.privacyScope === removalScope.privacyScope
          && !seen.has(document.documentId))
        .map((document) => document.documentId)
      : []
    this.#assertCapacity(normalized, removalIds)
    let removed = 0
    if (removalScope) {
      for (const documentId of removalIds) if (this.remove(documentId)) removed += 1
    }
    const statuses = normalized.map((document) => this.#upsertNormalized(document).status)
    return Object.freeze({
      added: statuses.filter((status) => status === 'added').length,
      replaced: statuses.filter((status) => status === 'replaced').length,
      unchanged: statuses.filter((status) => status === 'unchanged').length,
      removed,
      size: this.size,
    })
  }

  remove(documentId) {
    const id = controlledIdentifier(documentId, 'documentId', 256)
    const document = this.#documents.get(id)
    if (!document) return false
    this.#removePostings(document)
    this.#documents.delete(id)
    return true
  }

  clear() {
    this.#documents.clear()
    this.#postings.clear()
  }

  get(documentId, options = {}) {
    const id = controlledIdentifier(documentId, 'documentId', 256)
    const document = this.#documents.get(id)
    if (!document) return null
    const allowed = new Set(normalizeSearchScopes(options))
    return allowed.has(document.privacyScope) ? publicDocument(document) : null
  }

  list(options = {}) {
    const allowed = new Set(normalizeSearchScopes(options))
    return Object.freeze([...this.#documents.values()]
      .filter((document) => allowed.has(document.privacyScope))
      .sort((left, right) => compareCanonicalText(left.documentId, right.documentId))
      .map(publicDocument))
  }

  search(query, options = {}) {
    const input = normalizeText(query)
    const queryText = sliceChars(scrubPathsAndSecrets(sanitizeUntrustedText(input, {
      html: HTML_MARKUP.test(input),
      maxChars: this.#limits.maxQueryChars,
    }).text), this.#limits.maxQueryChars)
    const terms = lexicalTerms(queryText, this.#limits.maxQueryTerms).normalizedTerms
    const normalizedOptions = searchOptions(options, this.#limits)
    const allowedScopes = new Set(normalizedOptions.privacyScopes)
    const scores = new Map()
    for (const term of terms) {
      for (const [documentId, frequency] of this.#postings.get(term) || []) {
        const document = this.#documents.get(documentId)
        if (!document || !allowedScopes.has(document.privacyScope)) continue
        const score = scores.get(documentId) || { matchedTerms: 0, occurrences: 0 }
        score.matchedTerms += 1
        score.occurrences += frequency
        scores.set(documentId, score)
      }
    }
    const ranked = [...scores.entries()].map(([documentId, score]) => ({
      document: this.#documents.get(documentId),
      score,
    })).sort((left, right) => {
      if (left.score.matchedTerms !== right.score.matchedTerms) return right.score.matchedTerms - left.score.matchedTerms
      if (left.score.occurrences !== right.score.occurrences) return right.score.occurrences - left.score.occurrences
      const leftTime = left.document.capturedAt ? Date.parse(left.document.capturedAt) : Number.NEGATIVE_INFINITY
      const rightTime = right.document.capturedAt ? Date.parse(right.document.capturedAt) : Number.NEGATIVE_INFINITY
      if (leftTime !== rightTime) return rightTime - leftTime
      return compareCanonicalText(left.document.documentId, right.document.documentId)
    })

    const results = []
    let emittedChars = 0
    let omittedForCharacters = 0
    for (const candidate of ranked) {
      if (results.length >= normalizedOptions.maxResults) break
      const remaining = normalizedOptions.maxResultChars - emittedChars
      if (remaining <= 0) {
        omittedForCharacters += 1
        continue
      }
      const excerpt = excerptFor(candidate.document, terms, Math.min(normalizedOptions.maxExcerptChars, remaining))
      emittedChars += charLength(excerpt.text)
      results.push(Object.freeze({
        documentId: candidate.document.documentId,
        dataset: candidate.document.dataset,
        entityId: candidate.document.entityId,
        sourceDigest: candidate.document.sourceDigest,
        capturedAt: candidate.document.capturedAt,
        privacyScope: candidate.document.privacyScope,
        matchedTerms: candidate.score.matchedTerms,
        occurrences: candidate.score.occurrences,
        excerpt,
      }))
    }
    const omittedForLimit = Math.max(0, ranked.length - results.length - omittedForCharacters)
    return Object.freeze({
      schema: LEXICAL_INDEX_SCHEMA,
      query: queryText,
      normalizedTerms: Object.freeze([...terms]),
      privacyScopes: normalizedOptions.privacyScopes,
      results: Object.freeze(results),
      truncation: Object.freeze({
        truncated: charLength(input) > charLength(queryText) || omittedForCharacters > 0 || omittedForLimit > 0
          || results.some((result) => result.excerpt.truncated),
        queryInputChars: charLength(input),
        queryOutputChars: charLength(queryText),
        maxResults: normalizedOptions.maxResults,
        maxResultChars: normalizedOptions.maxResultChars,
        emittedChars,
        omittedForLimit,
        omittedForCharacters,
      }),
    })
  }

  stats() {
    const byPrivacyScope = Object.fromEntries(LEXICAL_PRIVACY_SCOPES.map((scope) => [scope, 0]))
    for (const document of this.#documents.values()) byPrivacyScope[document.privacyScope] += 1
    return Object.freeze({
      schema: LEXICAL_INDEX_SCHEMA,
      documents: this.#documents.size,
      terms: this.#postings.size,
      byPrivacyScope: Object.freeze(byPrivacyScope),
    })
  }
}

export function createLexicalIndex(options = {}) {
  return new LexicalIndex(options)
}

export function replaceLexicalFragments(index, fragments, options = {}) {
  if (!(index instanceof LexicalIndex)) throw new TypeError('index must be a LexicalIndex')
  return index.replaceFragments(fragments, options)
}

export function searchLexicalIndex(index, query, options = {}) {
  if (!(index instanceof LexicalIndex)) throw new TypeError('index must be a LexicalIndex')
  return index.search(query, options)
}

export const PRIVACY_SCOPES = LEXICAL_PRIVACY_SCOPES
export const DEFAULT_SEARCH_SCOPES = LEXICAL_DEFAULT_SEARCH_SCOPES
