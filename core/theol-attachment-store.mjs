import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, relative, resolve, sep } from 'node:path'

export const THEOL_ATTACHMENT_MAX_BYTES = 32 * 1024 * 1024

const SAFE_EXTENSION = /^[A-Za-z0-9]{1,12}$/u
const SAFE_FILENAME = /[^A-Za-z0-9._-]+/gu

function safeExtension(value = 'bin') {
  const extension = String(value || 'bin').replace(/^\./u, '').toLowerCase()
  return SAFE_EXTENSION.test(extension) ? extension : 'bin'
}

function safeFilename(value, fallback = 'theol-resource') {
  const name = String(value || '').trim().replace(SAFE_FILENAME, '_').replace(/^\.+/u, '')
  return (name || fallback).slice(0, 120)
}

function pathInside(root, target) {
  const offset = relative(root, target)
  return Boolean(offset) && !offset.startsWith(`..${sep}`) && offset !== '..' && !resolve(offset).startsWith(`..${sep}`)
}

function keyHash({ courseId, resourceId, sourceKey, url } = {}) {
  return createHash('sha256')
    .update([courseId, resourceId, sourceKey, url].map((value) => String(value || '').trim()).join('\u0000'))
    .digest('hex')
}

function extensionFromResource(resource) {
  const fileName = String(resource?.fileName || '').trim()
  const fromName = extname(fileName).replace(/^\./u, '').toLowerCase()
  if (SAFE_EXTENSION.test(fromName)) return fromName
  try {
    const fromUrl = extname(new URL(String(resource?.url || '')).pathname).replace(/^\./u, '').toLowerCase()
    if (SAFE_EXTENSION.test(fromUrl)) return fromUrl
  } catch {
    // Fall back to a generic binary artifact when the source URL is malformed.
  }
  return 'bin'
}

export class TheolAttachmentStore {
  constructor(root) {
    this.root = resolve(root)
    this.directory = resolve(this.root, 'theol', 'course-resources')
  }

  key(resource) {
    return keyHash(resource)
  }

  filePath(resource, extension = extensionFromResource(resource)) {
    const hash = this.key(resource)
    const target = resolve(this.directory, `${hash}.${safeExtension(extension)}`)
    if (!pathInside(this.directory, target)) throw new TypeError('THEOL 附件路径越界')
    return target
  }

  async find(resource) {
    const hash = this.key(resource)
    const directory = this.directory
    try {
      const entries = await readdir(directory, { withFileTypes: true })
      const marker = `-${hash.slice(0, 12)}.`
      for (const entry of entries) {
        if (!entry.isFile() || !(entry.name.startsWith(`${hash}.`) || entry.name.includes(marker))) continue
        const path = resolve(directory, entry.name)
        const info = await stat(path)
        if (info.size <= 0 || info.size > THEOL_ATTACHMENT_MAX_BYTES) continue
        return { path, bytes: info.size, filename: basename(path) }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    return null
  }

  async save(resource, buffer) {
    const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '')
    if (!bytes.length) throw new Error('THEOL 课程资源为空')
    if (bytes.length > THEOL_ATTACHMENT_MAX_BYTES) throw new Error('THEOL 课程资源超过 32 MB 限制')
    await mkdir(this.directory, { recursive: true })
    this.filePath(resource)
    const existing = await this.find(resource)
    if (existing?.bytes === bytes.length) {
      try {
        const current = await readFile(existing.path)
        if (createHash('sha256').update(current).digest('hex') === createHash('sha256').update(bytes).digest('hex')) {
          return { cached: true, bytes: existing.bytes, filename: existing.filename, path: existing.path }
        }
      } catch {
        // Re-write an artifact that disappeared between stat and read.
      }
    }
    const extension = `.${extensionFromResource(resource)}`
    const stem = safeFilename(resource?.fileName || resource?.title)
    const friendlyPath = resolve(this.directory, `${stem}-${this.key(resource).slice(0, 12)}${extension}`)
    if (!pathInside(this.directory, friendlyPath)) throw new TypeError('THEOL 附件路径越界')
    const temporary = `${friendlyPath}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temporary, bytes)
    try {
      await rename(temporary, friendlyPath)
    } catch (error) {
      await rm(friendlyPath, { force: true })
      await rename(temporary, friendlyPath).catch(() => { throw error })
    }
    return { cached: true, bytes: bytes.length, filename: basename(friendlyPath), path: friendlyPath }
  }
}
