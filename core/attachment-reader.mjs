/**
 * Extracts readable text from downloaded course-work attachments.
 * Supports: PDF, DOCX, PPTX, XLSX, TXT, Markdown.
 * Returns plain text (or a best-effort extraction) so it can be
 * included in the task prompt given to the model.
 *
 * All extraction is done with pure-JS libraries — no external binaries required.
 */

import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { pdfTextLoadOptions } from './pdf-text-loader.mjs'

const MAX_CHARS = 32_000  // cap per attachment to avoid flooding the model context
const MAX_INPUT_BYTES = 32 * 1024 * 1024
const MAX_ZIP_XML_BYTES = 32 * 1024 * 1024
const MAX_ZIP_XML_FILES = 200

function truncate(text, max = MAX_CHARS) {
  const cleaned = String(text ?? '').replace(/\r\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim()
  if (cleaned.length <= max) return cleaned
  return `${cleaned.slice(0, max - 60)}\n\n…[内容超出 ${max} 字符限制，已截断]`
}

/** PDF — uses pdf-parse v2 (PDFParse class). */
async function extractPdf(buffer) {
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: buffer, ...pdfTextLoadOptions() })
  try {
    const result = await parser.getText()
    return truncate(result?.text ?? '')
  } finally {
    await parser.destroy().catch(() => undefined)
  }
}

/** DOCX / DOTX — uses mammoth, returns plain text from paragraphs. */
async function extractDocx(buffer) {
  const mammoth = await import('mammoth')
  const { value } = await mammoth.extractRawText({ buffer })
  return truncate(value)
}

/** PPTX / XLSX — both are ZIP files. Extract text from XML slides/sheets. */
async function extractZipXml(buffer, fileFilter) {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buffer)
  const texts = []
  const files = Object.keys(zip.files).filter(fileFilter).sort().slice(0, MAX_ZIP_XML_FILES)
  const declaredBytes = files.reduce((total, name) => total + Math.max(0, Number(zip.files[name]?._data?.uncompressedSize) || 0), 0)
  if (declaredBytes > MAX_ZIP_XML_BYTES) throw new Error('Office 压缩包展开内容超过 32 MB 限制')
  let expandedBytes = 0
  for (const name of files) {
    const xml = await zip.files[name].async('text')
    expandedBytes += Buffer.byteLength(xml)
    if (expandedBytes > MAX_ZIP_XML_BYTES) throw new Error('Office 压缩包展开内容超过 32 MB 限制')
    // Strip XML tags, collapse whitespace
    const text = xml
      .replace(/<[^>]+>/g, ' ')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
    if (text) texts.push(text)
  }
  return truncate(texts.join('\n\n'))
}

async function extractPptx(buffer) {
  return extractZipXml(buffer, (name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
}

async function extractXlsx(buffer) {
  return extractZipXml(buffer, (name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
}

/** Plain text / Markdown — read as-is. */
async function extractText(buffer) {
  // Try UTF-8 first; if it looks garbled, try GBK via iconv-lite
  let text = buffer.toString('utf8')
  const garbledRatio = (text.match(/\ufffd/g) || []).length / (text.length || 1)
  if (garbledRatio > 0.02) {
    try {
      const iconvLite = await import('iconv-lite')
      text = iconvLite.decode(buffer, 'gbk')
    } catch { /* keep utf8 */ }
  }
  return truncate(text)
}

/**
 * Returns { text, format, error } for a downloaded attachment file.
 * `text` is null if extraction failed or format is unsupported.
 */
export async function extractAttachmentText(filePath) {
  const ext = extname(String(filePath || '')).toLowerCase()
  let buffer
  try {
    const info = await stat(filePath)
    if (!info.isFile()) throw new Error('路径不是普通文件')
    if (info.size > MAX_INPUT_BYTES) throw new Error('文件超过 32 MB 文本提取限制')
    buffer = await readFile(filePath)
  } catch (error) {
    return { text: null, format: ext || 'unknown', error: `无法读取文件: ${error.message}` }
  }

  try {
    if (ext === '.pdf') {
      return { text: await extractPdf(buffer), format: 'pdf', error: null }
    }
    if (['.docx', '.dotx'].includes(ext)) {
      return { text: await extractDocx(buffer), format: 'docx', error: null }
    }
    if (['.pptx', '.potx'].includes(ext)) {
      return { text: await extractPptx(buffer), format: 'pptx', error: null }
    }
    if (['.xlsx', '.xltx'].includes(ext)) {
      return { text: await extractXlsx(buffer), format: 'xlsx', error: null }
    }
    if (['.txt', '.md', '.markdown', '.csv', '.json', '.xml', '.html', '.htm'].includes(ext)) {
      return { text: await extractText(buffer), format: ext.slice(1), error: null }
    }
    // .doc / .ppt / .xls (legacy binary Office) — not supported without native libs
    if (['.doc', '.ppt', '.xls'].includes(ext)) {
      return { text: null, format: ext.slice(1), error: '旧版 Office 格式（.doc/.ppt/.xls）需转换为 .docx/.pptx/.xlsx 后才能提取文本' }
    }
    return { text: null, format: ext.slice(1) || 'unknown', error: '不支持该文件格式的文本提取' }
  } catch (error) {
    return { text: null, format: ext.slice(1) || 'unknown', error: `提取失败: ${error.message}` }
  }
}

/**
 * Summarise extraction results for embedding in task.md / prompt.
 * Returns a markdown section string, or '' if nothing was extracted.
 */
export function attachmentTextSection(extractions) {
  const usable = extractions.filter((item) => item.text && item.text.trim())
  if (!usable.length) return ''
  const lines = ['', '## 附件内容（文本提取）', '']
  for (const item of usable) {
    lines.push(`### ${item.filename} (${item.format})`, '', item.text, '')
  }
  return lines.join('\n')
}
