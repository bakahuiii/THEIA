import { createHash } from 'node:crypto'
import { lstat, readdir } from 'node:fs/promises'
import { extname, relative, resolve, sep } from 'node:path'

import { extractAttachmentText } from '../core/attachment-reader.mjs'
import { sanitizeUntrustedText } from '../core/advisor/notice-mail-context.mjs'

export const LOCAL_DOCUMENTS_SCHEMA = 'theia-local-documents/v1'

export const LOCAL_DOCUMENT_LIMITS = Object.freeze({
  maxDocuments: 200,
  maxDepth: 4,
  maxInputBytes: 32 * 1024 * 1024,
  defaultMaxChars: 32_000,
  maxChars: 48_000,
})

const SUPPORTED_EXTENSIONS = new Set([
  '.pdf', '.md', '.markdown', '.html', '.htm', '.txt', '.json', '.csv', '.xml',
  '.docx', '.dotx', '.pptx', '.potx', '.xlsx', '.xltx',
])

class LocalDocumentsError extends Error {
  constructor(message, code = 'LOCAL_DOCUMENTS_ERROR') {
    super(message)
    this.name = 'LocalDocumentsError'
    this.code = code
  }
}

function isPathInside(root, target) {
  const offset = relative(root, target)
  return Boolean(offset) && !offset.startsWith(`..${sep}`) && offset !== '..' && !/^[A-Za-z]:/u.test(offset)
}

function normalizedRoot(value) {
  const root = resolve(String(value || ''))
  if (!root || root === '.') throw new LocalDocumentsError('Local document root is invalid', 'ROOT_UNAVAILABLE')
  return root
}

export function defaultLocalDocumentsRoot({ sourceRoot = import.meta.dirname } = {}) {
  return resolve(sourceRoot, '..', 'local-docs')
}

function safeName(value, maximum = 240) {
  const text = sanitizeUntrustedText(String(value || ''), { maxChars: maximum }).text
  return text.replaceAll('\\', '/')
}

function documentId(relativeName) {
  const digest = createHash('sha256').update(String(relativeName), 'utf8').digest('hex').slice(0, 32)
  return `doc1:${digest}`
}

function extension(name) {
  return extname(String(name || '')).toLowerCase()
}

function formatForExtension(ext) {
  return ext === '.markdown' ? 'md' : ext.replace(/^\./u, '') || 'unknown'
}

async function ensureRealDirectory(root) {
  let metadata
  try {
    metadata = await lstat(root)
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return false
    throw new LocalDocumentsError('Local document directory is unavailable', 'ROOT_UNAVAILABLE')
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new LocalDocumentsError('Local document directory is not a real directory', 'ROOT_UNAVAILABLE')
  }
  return true
}

async function walk(root, current, depth, output, limit) {
  if (depth > LOCAL_DOCUMENT_LIMITS.maxDepth || output.length >= limit) return
  let entries
  try {
    entries = await readdir(current, { withFileTypes: true })
  } catch {
    return
  }
  entries.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
  for (const entry of entries) {
    if (output.length >= limit) break
    // Hidden files are implementation/configuration details, not user docs.
    if (entry.name.startsWith('.')) continue
    const target = resolve(current, entry.name)
    if (!isPathInside(root, target)) continue
    let metadata
    try { metadata = await lstat(target) } catch { continue }
    if (metadata.isSymbolicLink()) continue
    if (metadata.isDirectory()) {
      await walk(root, target, depth + 1, output, limit)
      continue
    }
    if (!metadata.isFile()) continue
    const relativeName = relative(root, target).split(sep).join('/')
    if (!relativeName || relativeName.split('/').some((part) => !part || part === '.' || part === '..')) continue
    const ext = extension(relativeName)
    output.push({
      relativeName,
      target,
      metadata,
      id: documentId(relativeName),
      name: safeName(relativeName),
      format: formatForExtension(ext),
      supported: SUPPORTED_EXTENSIONS.has(ext),
    })
  }
}

async function listEntries(root, limit = LOCAL_DOCUMENT_LIMITS.maxDocuments) {
  const entries = []
  await walk(root, root, 0, entries, limit)
  return entries
}

async function verifyFilePath(root, target) {
  const resolvedRoot = normalizedRoot(root)
  const resolvedTarget = resolve(target)
  if (!isPathInside(resolvedRoot, resolvedTarget)) return null
  let rootMetadata
  try { rootMetadata = await lstat(resolvedRoot) } catch { return null }
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) return null
  const segments = relative(resolvedRoot, resolvedTarget).split(sep).filter(Boolean)
  let cursor = resolvedRoot
  for (const segment of segments) {
    cursor = resolve(cursor, segment)
    let metadata
    try { metadata = await lstat(cursor) } catch { return null }
    if (metadata.isSymbolicLink()) return null
    if (cursor === resolvedTarget) return metadata.isFile() ? metadata : null
    if (!metadata.isDirectory()) return null
  }
  return null
}

function safeReadError(code = 'read-failed') {
  return { code, message: '本机文档暂时无法读取。' }
}

export function createLocalDocumentsReader({
  rootDir = process.env.THEIA_LOCAL_DOCS || defaultLocalDocumentsRoot(),
  maxDocuments = LOCAL_DOCUMENT_LIMITS.maxDocuments,
} = {}) {
  const root = normalizedRoot(rootDir)
  const boundedDocuments = Math.max(1, Math.min(LOCAL_DOCUMENT_LIMITS.maxDocuments, Math.trunc(Number(maxDocuments)) || LOCAL_DOCUMENT_LIMITS.maxDocuments))

  async function list() {
    const available = await ensureRealDirectory(root)
    if (!available) {
      return {
        schema: LOCAL_DOCUMENTS_SCHEMA,
        available: false,
        trust: 'untrusted',
        documents: [],
        omitted: 0,
      }
    }
    const entries = await listEntries(root, boundedDocuments + 1)
    const omitted = Math.max(0, entries.length - boundedDocuments)
    const documents = entries.slice(0, boundedDocuments).map((entry) => ({
      documentId: entry.id,
      name: entry.name,
      format: entry.format,
      supported: entry.supported,
      bytes: Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Number(entry.metadata.size) || 0)),
      modifiedAt: Number.isFinite(entry.metadata.mtimeMs) ? new Date(entry.metadata.mtimeMs).toISOString() : null,
    }))
    return {
      schema: LOCAL_DOCUMENTS_SCHEMA,
      available: true,
      trust: 'untrusted',
      documents,
      omitted,
    }
  }

  async function read({ documentId: requestedId, maxChars = LOCAL_DOCUMENT_LIMITS.defaultMaxChars } = {}) {
    const id = String(requestedId || '').trim()
    if (!/^doc1:[a-f0-9]{32}$/u.test(id)) throw new LocalDocumentsError('documentId is invalid', 'INVALID_ARGUMENT')
    const requestedChars = Number(maxChars)
    if (!Number.isInteger(requestedChars) || requestedChars < 1 || requestedChars > LOCAL_DOCUMENT_LIMITS.maxChars) {
      throw new LocalDocumentsError('maxChars is out of range', 'INVALID_ARGUMENT')
    }
    const available = await ensureRealDirectory(root)
    if (!available) throw new LocalDocumentsError('Local document directory is unavailable', 'ROOT_UNAVAILABLE')
    const entries = await listEntries(root, boundedDocuments)
    const entry = entries.find((candidate) => candidate.id === id)
    if (!entry) throw new LocalDocumentsError('Local document is not available', 'DOCUMENT_UNAVAILABLE')
    if (!entry.supported) {
      return {
        schema: LOCAL_DOCUMENTS_SCHEMA,
        documentId: entry.id,
        name: entry.name,
        format: entry.format,
        trust: 'untrusted',
        content: null,
        truncated: false,
        error: safeReadError('unsupported-format'),
      }
    }
    const metadata = await verifyFilePath(root, entry.target)
    if (!metadata) throw new LocalDocumentsError('Local document is unavailable', 'DOCUMENT_UNAVAILABLE')
    if (metadata.size > LOCAL_DOCUMENT_LIMITS.maxInputBytes) {
      return {
        schema: LOCAL_DOCUMENTS_SCHEMA,
        documentId: entry.id,
        name: entry.name,
        format: entry.format,
        trust: 'untrusted',
        content: null,
        truncated: false,
        error: safeReadError('too-large'),
      }
    }
    const extraction = await extractAttachmentText(entry.target)
    if (!extraction.text) {
      return {
        schema: LOCAL_DOCUMENTS_SCHEMA,
        documentId: entry.id,
        name: entry.name,
        format: entry.format,
        trust: 'untrusted',
        content: null,
        truncated: false,
        error: safeReadError(extraction.error ? 'read-failed' : 'empty'),
      }
    }
    const sanitized = sanitizeUntrustedText(extraction.text, {
      html: entry.format === 'html' || entry.format === 'htm',
      maxChars: requestedChars,
    })
    return {
      schema: LOCAL_DOCUMENTS_SCHEMA,
      documentId: entry.id,
      name: entry.name,
      format: entry.format,
      trust: 'untrusted',
      content: sanitized.text || null,
      inputChars: sanitized.inputChars,
      truncated: sanitized.truncated || sanitized.text.length < String(extraction.text).length,
      error: null,
    }
  }

  return Object.freeze({
    root: root,
    list,
    read,
  })
}

export { LocalDocumentsError }
