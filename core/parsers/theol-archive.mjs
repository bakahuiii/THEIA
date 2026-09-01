import * as cheerio from 'cheerio'
import { absoluteUrl, normalizeText } from '../util.mjs'

const DOCUMENT_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx',
  'txt', 'md', 'csv', 'rtf', 'odt', 'ods', 'odp',
])

const BLOCKED_EXTENSIONS = /\.(?:png|jpe?g|gif|webp|bmp|svg|avif|mp4|avi|mkv|webm|mov|mp3|wav|flac|m4a|aac)(?:$|[?#])/iu
const BLOCKED_TITLE = /图片|照片|视频|音频|录像|mp4|avi|mkv|webm|mov|mp3|wav|flac|m4a|aac/iu
const DOCUMENT_MIME = /^(?:application\/(?:pdf|msword|rtf|vnd\.(?:openxmlformats-officedocument|ms-|oasis\.opendocument)|octet-stream)|text\/(?:plain|markdown|csv)|text\/rtf)/iu
const BLOCKED_MIME = /^(?:image|video|audio)\//iu
const ATTACHMENT_HINT = /附件|下载|文件|课件|资料|document|download|attachment|resource|file/iu
const DOCUMENT_ENDPOINT_HINT = /(?:download|attachment|preview|file|resource)/iu

function extensionOf(rawValue) {
  const value = String(rawValue || '')
  const match = value.match(/\.([a-z0-9]{1,12})(?:$|[?#])/iu)
  return match?.[1]?.toLowerCase() || ''
}

function urlFileName(url) {
  try {
    const parsed = new URL(url)
    return parsed.searchParams.get('filename')
      || parsed.searchParams.get('fileName')
      || parsed.searchParams.get('name')
      || parsed.pathname.split('/').pop()
      || ''
  } catch {
    return ''
  }
}

function dispositionFileName(value) {
  const source = String(value || '')
  const encoded = source.match(/filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;]+)/iu)?.[1]
  if (encoded) {
    try { return decodeURIComponent(encoded.trim().replace(/^['"]|['"]$/gu, '')) } catch { return encoded.trim() }
  }
  return source.match(/filename\s*=\s*["']?([^;"']+)/iu)?.[1]?.trim() || ''
}

function extensionFromContentType(contentType) {
  const type = String(contentType || '').split(';', 1)[0].trim().toLowerCase()
  return {
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/rtf': 'rtf',
    'text/plain': 'txt',
    'text/markdown': 'md',
    'text/csv': 'csv',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.oasis.opendocument.text': 'odt',
    'application/vnd.oasis.opendocument.spreadsheet': 'ods',
    'application/vnd.oasis.opendocument.presentation': 'odp',
  }[type] || ''
}

export function isBlockedTheolMedia({ title = '', url = '', contentType = '' } = {}) {
  return BLOCKED_EXTENSIONS.test(String(url))
    || BLOCKED_EXTENSIONS.test(String(title))
    || BLOCKED_TITLE.test(`${title} ${url}`)
    || BLOCKED_MIME.test(String(contentType))
}

export function isAllowedTheolAttachmentLink({ title = '', url = '' } = {}) {
  if (!url || isBlockedTheolMedia({ title, url })) return false
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return false
  const extension = extensionOf(urlFileName(url)) || extensionOf(title) || extensionOf(url)
  if (DOCUMENT_EXTENSIONS.has(extension) || ATTACHMENT_HINT.test(`${title} ${url}`)) return true
  return DOCUMENT_ENDPOINT_HINT.test(parsed.pathname)
    && (parsed.searchParams.has('resid') || parsed.searchParams.has('fileid') || parsed.searchParams.has('fileId') || /download|attachment/iu.test(parsed.pathname))
}

export function isTheolDocumentLink({ title = '', url = '' } = {}) {
  if (!url || isBlockedTheolMedia({ title, url })) return false
  const extension = extensionOf(urlFileName(url)) || extensionOf(title) || extensionOf(url)
  if (DOCUMENT_EXTENSIONS.has(extension)) return true
  try {
    const parsed = new URL(url)
    return DOCUMENT_ENDPOINT_HINT.test(parsed.pathname)
      && (parsed.searchParams.has('filename') || parsed.searchParams.has('fileName')
        || parsed.searchParams.has('resid') || parsed.searchParams.has('fileid') || parsed.searchParams.has('fileId')
        || /download|attachment/iu.test(parsed.pathname)
        || ATTACHMENT_HINT.test(title))
  } catch {
    return false
  }
}

export function isAllowedTheolAttachmentContent({ title = '', url = '', contentType = '' } = {}) {
  if (isBlockedTheolMedia({ title, url, contentType })) return false
  const normalizedType = String(contentType || '').split(';', 1)[0].trim()
  if (!normalizedType || /^application\/octet-stream$/iu.test(normalizedType)) return true
  if (/text\/html|application\/xhtml\+xml/iu.test(normalizedType)) return false
  return DOCUMENT_MIME.test(normalizedType) || /^text\//iu.test(normalizedType)
}

function decodeEmbeddedHtml(value) {
  const raw = String(value || '')
  if (!raw) return ''
  const $ = cheerio.load(`<textarea id="theol-embedded-content">${raw}</textarea>`)
  return String($('#theol-embedded-content').val() || raw)
}

export function parseTheolAttachmentLinks(html, { baseUrl } = {}) {
  const links = []
  const scanned = new Set()
  const scan = (source, depth = 0) => {
    const normalizedSource = String(source || '')
    if (!normalizedSource || scanned.has(normalizedSource) || depth > 2) return
    scanned.add(normalizedSource)
    const $ = cheerio.load(normalizedSource)
    const add = (node, rawUrl) => {
      const url = absoluteUrl(rawUrl, baseUrl)
      const title = normalizeText($(node).attr('title') || $(node).text() || $(node).attr('aria-label') || url)
      if (!url || !title || !isAllowedTheolAttachmentLink({ title, url })) return
      links.push({ title: title.slice(0, 300), url })
    }
    $('a[href]').each((_index, node) => add(node, $(node).attr('href')))
    $('[data-href], [data-url], iframe[src], frame[src]').each((_index, node) => {
      add(node, $(node).attr('data-href') || $(node).attr('data-url') || $(node).attr('src'))
    })
    $('[onclick]').each((_index, node) => {
      const source = String($(node).attr('onclick') || '')
      for (const match of source.matchAll(/(?:window\.open|location(?:\.href)?\s*=|MM_goToURL\([^,]+,)[^"']*["']([^"']+)["']/giu)) {
        add(node, match[1])
      }
    })
    if (depth >= 2) return
    $('input[id$="_content"], textarea[id$="_content"], [name$="_content"]').each((_index, node) => {
      const raw = $(node).attr('value') ?? $(node).val() ?? $(node).html() ?? ''
      const embedded = decodeEmbeddedHtml(raw)
      if (embedded && embedded !== normalizedSource) scan(embedded, depth + 1)
    })
  }

  scan(html)
  return [...new Map(links.map((item) => [item.url, item])).values()].slice(0, 50)
}

export function rewriteTheolAttachmentLinks(html, replacements = {}, { baseUrl = '' } = {}) {
  const $ = cheerio.load(String(html || ''), { decodeEntities: false })
  $('a[href], iframe[src], frame[src]').each((_index, node) => {
    for (const attribute of ['href', 'src']) {
      const current = $(node).attr(attribute)
      if (!current) continue
      const absolute = absoluteUrl(current, baseUrl)
      const replacement = replacements[current] || (absolute ? replacements[absolute] : null)
      if (replacement) $(node).attr(attribute, replacement)
    }
  })
  return $.html()
}

export function documentExtension({ title = '', url = '', contentType = '', contentDisposition = '' } = {}) {
  const extension = extensionOf(dispositionFileName(contentDisposition))
    || extensionOf(urlFileName(url))
    || extensionOf(title)
    || extensionOf(url)
    || extensionFromContentType(contentType)
  return DOCUMENT_EXTENSIONS.has(extension) ? extension : 'bin'
}
