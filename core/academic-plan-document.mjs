import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { pdfTextLoadOptions } from './pdf-text-loader.mjs'

export const ACADEMIC_PLAN_DOCUMENT_SCHEMA = 'theia-academic-plan-document/v1'
export const ACADEMIC_PLAN_DOCUMENT_PARSER_VERSION = '2026-08-18.1'

const MAX_PAGES = 128
const MAX_PAGE_TEXT_LENGTH = 200_000
const MAX_TOTAL_TEXT_LENGTH = 2_000_000
const SAFE_ATTACHMENT_ID = /^[A-Za-z0-9_-]{1,80}$/u
const SHA256 = /^[a-f0-9]{64}$/u

function cleanText(value) {
  return String(value ?? '').replace(/\r/g, '').replace(/\u00a0/g, ' ').trim()
}

function optionalText(value, maximum = 600) {
  const text = cleanText(value).replace(/[ \t]+/g, ' ')
  return text && text.length <= maximum ? text : null
}

function nonnegativeNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function timestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function titleFrom(pages) {
  for (const page of pages) {
    for (const line of page.text.split('\n')) {
      const title = optionalText(line, 240)
      if (!title || /^\d+\s*(?:of|\/)\s*\d+$/iu.test(title)) continue
      if (/培养方案|培养计划|教学执行计划|执行计划/u.test(title)) return title
    }
  }
  return null
}

function numberFrom(pages, expression) {
  const text = pages.map((page) => page.text).join('\n')
  const match = text.match(expression)
  return match ? nonnegativeNumber(match[1]) : null
}

function normalizePages(value, pageCount) {
  if (!Array.isArray(value) || !value.length || value.length > MAX_PAGES) return null
  let totalLength = 0
  const seen = new Set()
  const pages = []
  for (const [index, item] of value.entries()) {
    const number = Number(item?.number ?? item?.num ?? index + 1)
    const text = cleanText(item?.text)
    if (!Number.isInteger(number) || number < 1 || number > MAX_PAGES || seen.has(number)) return null
    if (!text || text.length > MAX_PAGE_TEXT_LENGTH) return null
    seen.add(number)
    totalLength += text.length
    if (totalLength > MAX_TOTAL_TEXT_LENGTH) return null
    pages.push({ number, text })
  }
  pages.sort((left, right) => left.number - right.number)
  if (pageCount !== pages.length || pages.at(-1)?.number !== pageCount) return null
  return pages
}

/**
 * Validate the parsed document independently from the academic-plan table.
 * The plan domain deliberately remains PDF-metadata-only, so a malformed
 * extracted document cannot erase or contaminate its read-only attachment.
 */
export function normalizeAcademicPlanDocument(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : null
  if (!source || source.schema !== ACADEMIC_PLAN_DOCUMENT_SCHEMA) return null
  const sourceAttachmentId = String(source.sourceAttachmentId || '').trim()
  const sourceSha256 = String(source.sourceSha256 || '').trim().toLowerCase()
  const sourceBytes = nonnegativeNumber(source.sourceBytes)
  const pageCount = Number(source.pageCount)
  if (!SAFE_ATTACHMENT_ID.test(sourceAttachmentId) || !SHA256.test(sourceSha256) || sourceBytes === null
    || !Number.isInteger(pageCount) || pageCount < 1 || pageCount > MAX_PAGES) return null
  const pages = normalizePages(source.pages, pageCount)
  if (!pages) return null
  const parsedAt = timestamp(source.parsedAt)
  if (!parsedAt) return null
  const textDigest = String(source.textDigest || '').trim().toLowerCase()
  const computedTextDigest = sha256(pages.map((page) => `${page.number}\n${page.text}`).join('\n\f\n'))
  if (!SHA256.test(textDigest) || textDigest !== computedTextDigest) return null
  const durationYears = source.durationYears === null || source.durationYears === undefined
    ? null
    : nonnegativeNumber(source.durationYears)
  const minimumGraduationCredits = source.minimumGraduationCredits === null || source.minimumGraduationCredits === undefined
    ? null
    : nonnegativeNumber(source.minimumGraduationCredits)
  if ((source.durationYears !== null && source.durationYears !== undefined && durationYears === null)
    || (source.minimumGraduationCredits !== null && source.minimumGraduationCredits !== undefined && minimumGraduationCredits === null)) return null
  return {
    schema: ACADEMIC_PLAN_DOCUMENT_SCHEMA,
    parserVersion: optionalText(source.parserVersion, 120) || ACADEMIC_PLAN_DOCUMENT_PARSER_VERSION,
    sourceAttachmentId,
    sourceSha256,
    sourceBytes,
    sourceFilename: optionalText(source.sourceFilename, 240),
    pageCount,
    pages,
    title: optionalText(source.title, 240),
    durationYears,
    minimumGraduationCredits,
    textDigest,
    parsedAt,
  }
}

export function academicPlanDocumentMatches(document, source) {
  const normalized = normalizeAcademicPlanDocument(document)
  return Boolean(normalized
    && normalized.sourceAttachmentId === String(source?.attachmentId || '').trim()
    && normalized.sourceSha256 === String(source?.sha256 || '').trim().toLowerCase()
    && normalized.sourceBytes === Number(source?.bytes))
}

export async function buildAcademicPlanDocument({ attachment, path, parsedAt = new Date().toISOString(), extractor = null } = {}) {
  const sourceAttachmentId = String(attachment?.id || '').trim()
  if (!SAFE_ATTACHMENT_ID.test(sourceAttachmentId)) throw new TypeError('培养计划附件标识无效')
  const buffer = await readFile(path)
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('培养计划附件不是有效 PDF')
  const sourceSha256 = sha256(buffer)
  const expectedSha256 = String(attachment?.sha256 || '').trim().toLowerCase()
  if (expectedSha256 && (!SHA256.test(expectedSha256) || expectedSha256 !== sourceSha256)) {
    throw new Error('培养计划附件校验和与缓存文件不一致')
  }
  const expectedBytes = attachment?.bytes === null || attachment?.bytes === undefined ? null : Number(attachment.bytes)
  if (expectedBytes !== null && (!Number.isSafeInteger(expectedBytes) || expectedBytes !== buffer.length)) {
    throw new Error('培养计划附件大小与缓存文件不一致')
  }

  const readText = extractor || (async (pdfBytes) => {
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: pdfBytes, ...pdfTextLoadOptions() })
    try {
      return await parser.getText()
    } finally {
      await parser.destroy().catch(() => undefined)
    }
  })
  const extracted = await readText(buffer)
  const pageCount = Number(extracted?.total || extracted?.pages?.length)
  const pages = Array.isArray(extracted?.pages)
    ? extracted.pages.map((page, index) => ({ number: Number(page?.num) || index + 1, text: page?.text }))
    : []
  const draft = {
    schema: ACADEMIC_PLAN_DOCUMENT_SCHEMA,
    parserVersion: ACADEMIC_PLAN_DOCUMENT_PARSER_VERSION,
    sourceAttachmentId,
    sourceSha256,
    sourceBytes: buffer.length,
    sourceFilename: attachment?.filename || null,
    pageCount,
    pages,
    title: titleFrom(pages),
    durationYears: numberFrom(pages, /学制\s*[：:]?\s*(\d+(?:\.\d+)?)\s*年?/u),
    minimumGraduationCredits: numberFrom(pages, /最低\s*毕业\s*学分\s*[：:]?\s*(\d+(?:\.\d+)?)/u),
    textDigest: sha256(pages.map((page) => `${Number(page?.num) || page?.number || 0}\n${cleanText(page?.text)}`).join('\n\f\n')),
    parsedAt,
  }
  const document = normalizeAcademicPlanDocument(draft)
  if (!document) throw new Error('培养计划 PDF 未提取到完整文字层')
  return document
}
