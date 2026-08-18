import { createHash } from 'node:crypto'
import { mkdir, open as openFile, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path'

export const JWGLXT_ATTACHMENT_MAX_BYTES = 32 * 1024 * 1024

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/u
const SAFE_EXTENSION = /^[A-Za-z0-9]{1,12}$/u
const CALENDAR_PDF_FILENAMES = new Set([
  'teaching_schedule_current.pdf',
  'weekly_calendar_current.pdf',
])

function safeId(value) {
  const id = String(value || '').trim()
  if (!SAFE_ID.test(id)) throw new TypeError('教务附件标识无效')
  return id
}

function safeExtension(value = 'bin') {
  const extension = String(value || 'bin').replace(/^\./u, '').toLowerCase()
  if (!SAFE_EXTENSION.test(extension)) throw new TypeError('教务附件扩展名无效')
  return extension
}

function pathInside(root, target) {
  const offset = relative(root, target)
  return Boolean(offset) && !isAbsolute(offset) && offset !== '..' && !offset.startsWith(`..${sep}`)
}

function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

export class JwglxtAttachmentStore {
  constructor(root) {
    this.root = resolve(root)
    // Cultivation plans are local academic documents, so they live with the
    // official calendar PDFs instead of creating a second document location.
    this.directory = resolve(this.root, 'academic-calendar', 'assets')
    this.legacyDirectory = resolve(this.root, 'data', 'attachments', 'jwglxt')
  }

  filePath(id, extension = 'pdf') {
    return this.filePathIn(this.directory, id, extension)
  }

  legacyFilePath(id, extension = 'pdf') {
    return this.filePathIn(this.legacyDirectory, id, extension)
  }

  filePathIn(directory, id, extension = 'pdf') {
    const target = resolve(directory, `${safeId(id)}.${safeExtension(extension)}`)
    if (!pathInside(directory, target)) throw new TypeError('教务附件路径越界')
    return target
  }

  async find(id, extension = 'pdf') {
    const normalizedExtension = safeExtension(extension)
    for (const path of [this.filePath(id, normalizedExtension), this.legacyFilePath(id, normalizedExtension)]) {
      try {
        const info = await stat(path)
        if (!info.isFile() || info.size <= 0 || info.size > JWGLXT_ATTACHMENT_MAX_BYTES) continue
        // A stale HTML/login response must never be treated as a cached PDF.
        // Probe only the header so opening an existing attachment stays cheap.
        if (normalizedExtension === 'pdf') {
          const handle = await openFile(path, 'r')
          try {
            const header = Buffer.alloc(5)
            const { bytesRead } = await handle.read(header, 0, header.length, 0)
            if (bytesRead !== header.length || header.toString('ascii') !== '%PDF-') continue
          } finally {
            await handle.close().catch(() => {})
          }
        }
        return { path, bytes: info.size, filename: basename(path) }
      } catch {
        // Try the old location so an upgrade can migrate a previously cached
        // plan without downloading it again.
      }
    }
    return null
  }

  async keepOnly({ id, extension = 'pdf' } = {}) {
    const safeAttachmentId = safeId(id)
    const normalizedExtension = safeExtension(extension)
    const keep = `${safeAttachmentId}.${normalizedExtension}`
    const current = this.filePath(safeAttachmentId, normalizedExtension)
    const legacy = this.legacyFilePath(safeAttachmentId, normalizedExtension)
    await mkdir(this.directory, { recursive: true })
    try {
      await stat(current)
    } catch {
      try {
        await rename(legacy, current)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    }
    await this.prunePdfFiles({ keep })
  }

  async prunePdfFiles({ keep = null } = {}) {
    const normalizedKeep = keep === null ? null : String(keep).toLowerCase()
    for (const directory of [this.directory, this.legacyDirectory]) {
      try {
        const entries = await readdir(directory, { withFileTypes: true })
        await Promise.all(entries
          .filter((entry) => {
            if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.pdf')) return false
            const name = entry.name.toLowerCase()
            // The legacy directory is only a migration source. Once the
            // unified asset exists, no cultivation-plan PDF may remain there.
            if (directory === this.legacyDirectory) return true
            if (directory === this.directory && CALENDAR_PDF_FILENAMES.has(name)) return false
            return name !== normalizedKeep
          })
          .map((entry) => rm(resolve(directory, entry.name), { force: true })))
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    }
  }

  async save({ id, extension = 'pdf', buffer, exclusive = false } = {}) {
    const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '')
    if (!bytes.length) throw new Error('教务附件为空')
    if (bytes.length > JWGLXT_ATTACHMENT_MAX_BYTES) throw new Error('教务附件超过 32 MB 限制')
    const path = this.filePath(id, extension)
    const existing = await this.find(id, extension)
    const sha256 = digest(bytes)
    if (existing?.bytes === bytes.length) {
      // A valid PDF header alone is not enough to prove that a previous write
      // contains the same artifact. Compare the digest only on the save path;
      // normal cache reads remain a cheap header probe.
      try {
        const currentSha256 = digest(await readFile(existing.path))
        if (currentSha256 === sha256) {
          if (exclusive) await this.keepOnly({ id, extension })
          return { cached: true, bytes: existing.bytes, sha256: currentSha256, filename: existing.filename }
        }
      } catch {
        // Re-write the artifact below when the existing file disappeared or
        // cannot be read.
      }
    }
    await mkdir(this.directory, { recursive: true })
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temporary, bytes)
    try {
      await rename(temporary, path)
    } catch (error) {
      await rm(path, { force: true })
      await rename(temporary, path).catch(() => { throw error })
    }
    if (exclusive) await this.keepOnly({ id, extension })
    return { cached: true, bytes: bytes.length, sha256, filename: basename(path) }
  }
}

export function attachmentExtensionFromUrl(url, fallback = 'pdf') {
  try {
    const extension = extname(new URL(String(url || '')).pathname).replace(/^\./u, '').toLowerCase()
    return SAFE_EXTENSION.test(extension) ? extension : fallback
  } catch {
    return fallback
  }
}
