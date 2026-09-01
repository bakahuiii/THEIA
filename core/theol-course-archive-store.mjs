import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, relative, resolve, sep } from 'node:path'
import * as cheerio from 'cheerio'
import { decodeSourceBuffer } from './source-client.mjs'
import { normalizeText } from './util.mjs'

export const THEOL_ARCHIVE_PAGE_MAX_BYTES = 16 * 1024 * 1024
export const THEOL_ARCHIVE_ATTACHMENT_MAX_BYTES = 32 * 1024 * 1024

const SAFE_EXTENSION = /^[A-Za-z0-9]{1,12}$/u
const SAFE_NAME = /[^A-Za-z0-9._-]+/gu
const ARCHIVE_LAYOUT_STYLE = `
<style id="theia-archive-layout">
  :root { color-scheme: light; }
  html { min-width: 0; background: #eef2f1; }
  body {
    box-sizing: border-box;
    min-width: 0;
    margin: 0;
    color: #1f2a27;
    background: #fff;
    font-family: "Microsoft YaHei", "Noto Sans SC", Arial, sans-serif;
    line-height: 1.7;
    overflow-x: auto;
  }
  body *, body *::before, body *::after { box-sizing: border-box; }
  .wrap { width: min(100%, 1180px); min-height: 100vh; margin: 0 auto; background: #fff; }
  .wrap .title { padding: 24px clamp(20px, 4vw, 56px) 14px; border-bottom: 1px solid #e3e9e6; }
  .wrap .title h1 { margin: 0; color: #1f2a27; font-size: clamp(18px, 2vw, 26px); line-height: 1.35; }
  .wrap .neck { display: none; }
  .wrap .text { width: 100%; }
  .wrap .text .content {
    width: 100%;
    max-width: none;
    padding: clamp(20px, 4vw, 56px);
    overflow-x: auto;
  }
  .wrap .content > iframe, .wrap .content > frame {
    display: block;
    width: 100% !important;
    height: calc(100vh - 120px) !important;
    min-height: 640px;
    margin: 0;
    border: 1px solid #dfe6e3;
    background: #fff;
  }
  body > #body { width: 100%; max-width: 1180px; margin: 0 auto; padding: clamp(20px, 4vw, 56px); overflow-x: auto; }
  body.content { padding: 0; }
  body.content > #body { max-width: none; padding: clamp(20px, 4vw, 56px); }
  table { width: max-content; min-width: 100%; max-width: none; }
  img { max-width: 100%; height: auto; }
  pre { max-width: 100%; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
  @media (max-width: 640px) {
    .wrap .content > iframe, .wrap .content > frame { height: calc(100vh - 88px) !important; min-height: 520px; }
  }
</style>`

function inside(root, target) {
  const offset = relative(root, target)
  return Boolean(offset) && offset !== '..' && !offset.startsWith(`..${sep}`) && !resolve(offset).startsWith(`..${sep}`)
}

function safeName(value, fallback) {
  const cleaned = String(value || '').trim().replace(SAFE_NAME, '_').replace(/^\.+/u, '')
  return (cleaned || fallback).slice(0, 100)
}

function safeExtension(value, fallback = 'bin') {
  const extension = String(value || '').replace(/^\./u, '').toLowerCase()
  return SAFE_EXTENSION.test(extension) ? extension : fallback
}

function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function addArchiveLayoutStyle(html) {
  const value = String(html || '')
  if (/<style\b[^>]*\bid=["']theia-archive-layout["']/iu.test(value)) return value
  if (/<\/head>/iu.test(value)) return value.replace(/<\/head>/iu, `${ARCHIVE_LAYOUT_STYLE}\n</head>`)
  return `${ARCHIVE_LAYOUT_STYLE}\n${value}`
}

function normalizeHtmlForArchive(html) {
  let value = String(html || '')
  let replaced = false
  value = value.replace(/(<meta\b[^>]*\bcharset\s*=\s*["']?)([^"'\s>]+)(["']?[^>]*>)/giu, (_match, prefix, _charset, suffix) => {
    replaced = true
    return `${prefix}utf-8${suffix}`
  })
  value = value.replace(/(<meta\b[^>]*\bcontent\s*=\s*["'][^"']*\bcharset\s*=\s*)([^"'\s;>]+)([^"']*["'][^>]*>)/giu, (_match, prefix, _charset, suffix) => {
    replaced = true
    return `${prefix}utf-8${suffix}`
  })
  if (!replaced && !/<meta\b[^>]*\bcharset\s*=/iu.test(value)) {
    if (/<head\b[^>]*>/iu.test(value)) value = value.replace(/<head\b[^>]*>/iu, (head) => `${head}\n<meta charset="utf-8">`)
    else value = `<meta charset="utf-8">${value}`
  }
  return addArchiveLayoutStyle(value)
}

function decodeExistingHtml(buffer) {
  // Older THEIA builds wrote UTF-8 bytes while retaining THEOL's original
  // GBK declaration. Valid UTF-8 must win over that stale declaration.
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return decodeSourceBuffer(buffer, '')
  }
}

function ueditorFrameName(frameUrl) {
  try {
    const name = new URL(String(frameUrl || '')).searchParams.get('name')
    return name && /^[A-Za-z0-9_-]+$/u.test(name) ? name : null
  } catch {
    return null
  }
}

function decodeUeditorFieldValue(value) {
  const raw = String(value || '')
  if (!raw) return ''
  // The value is an HTML attribute in the parent page. Parsing it through a
  // textarea decodes entities without treating the content as markup yet.
  const $ = cheerio.load(`<textarea id="theia-ueditor-value">${raw}</textarea>`)
  return String($('#theia-ueditor-value').val() || raw)
}

function ueditorContentNodes($) {
  return $('input[id$="_content"], textarea[id$="_content"], [name$="_content"]')
}

function ueditorContentValue(parentHtml, frameNodeOrUrl, fallbackIndex = 0, explicitIdentity = null) {
  const $ = cheerio.load(String(parentHtml || ''))
  const frame = typeof frameNodeOrUrl === 'string' ? null : frameNodeOrUrl
  const frameUrl = typeof frameNodeOrUrl === 'string' ? frameNodeOrUrl : $(frame).attr('src')
  const name = ueditorFrameName(frameUrl)
  const identity = explicitIdentity
    || String(frame ? ($(frame).attr('id') || $(frame).attr('name') || '') : '')
      .match(/(?:_rtf_)?content([A-Za-z0-9_-]+)$/iu)?.[1]
    || name
  const nodes = ueditorContentNodes($)
  let node = null
  if (identity) {
    node = nodes.toArray().find((candidate) => {
      const id = String($(candidate).attr('id') || $(candidate).attr('name') || '')
      return id === `${identity}_content`
    }) || null
  }
  node ||= nodes.get(fallbackIndex) || null
  if (!node) return null
  const raw = $(node).attr('value') ?? $(node).val() ?? $(node).html()
  const value = decodeUeditorFieldValue(raw)
  return value && value.trim() !== '内容读取中...' ? value : null
}

function ueditorPlaceholder(html) {
  const $ = cheerio.load(String(html || ''))
  return /内容读取中\.\.\./u.test(String($('#body').first().html() || ''))
}

/**
 * THEOL's UEditor iframe reads `${name}_content` from its parent document.
 * A saved iframe has no parent, so replace the placeholder with the captured
 * parent value and remove runtime scripts that would otherwise touch it.
 */
export function materializeTheolUeditorFrame(frameHtml, parentHtml, frameUrl, {
  frameIdentity = null,
  fallbackIndex = 0,
} = {}) {
  const source = String(frameHtml || '')
  const content = ueditorContentValue(parentHtml, frameUrl, fallbackIndex, frameIdentity)
  if (!content || !ueditorPlaceholder(source)) return { html: source, content: null }
  const $ = cheerio.load(source, { decodeEntities: false })
  const body = $('#body').first()
  if (!body.length) return { html: source, content: null }
  body.html(content)
  $('script, noscript').remove()
  return { html: $.html(), content }
}

export function extractTheolVisibleText(html) {
  const $ = cheerio.load(String(html || ''))
  $('script, style, noscript, template, input, textarea, select, option').remove()
  const body = $('#body').first()
  const text = normalizeText(body.length ? body.text() : $('body').text())
  return text === '内容读取中...' ? '' : text
}

async function atomicWrite(target, buffer) {
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, buffer)
  try {
    await rename(temporary, target)
  } catch (error) {
    await rm(target, { force: true })
    await rename(temporary, target).catch(() => { throw error })
  }
}

export class TheolCourseArchiveStore {
  constructor(root) {
    this.root = resolve(root)
    this.archiveRoot = resolve(this.root, 'theol')
    this.courseRoot = resolve(this.archiveRoot, 'course-materials')
    this.assignmentRoot = resolve(this.archiveRoot, 'assignments')
  }

  directory(kind, parentId) {
    const root = kind === 'assignment' ? this.assignmentRoot : this.courseRoot
    const directory = resolve(root, safeName(parentId, 'unknown'))
    if (!inside(root, directory)) throw new TypeError('THEOL 本地归档目录越界')
    return directory
  }

  pagePath({ kind = 'course', parentId, id, title } = {}) {
    const directory = this.directory(kind, parentId)
    const filename = `${safeName(title, kind === 'assignment' ? 'task' : 'course')}-${safeName(id, 'item')}.html`
    const target = resolve(directory, filename)
    if (!inside(this.archiveRoot, target)) throw new TypeError('THEOL 本地归档路径越界')
    return target
  }

  attachmentPath({ kind = 'course', parentId, attachment, extension = '' } = {}) {
    const directory = this.directory(kind, parentId)
    const key = createHash('sha256')
      .update([parentId, attachment?.url, attachment?.title].map((value) => String(value || '')).join('\u0000'))
      .digest('hex')
      .slice(0, 16)
    const name = safeName(attachment?.title, 'attachment')
    const fromName = extname(name).replace(/^\./u, '')
    const suffix = safeExtension(extension || fromName)
    const target = resolve(directory, `${name}-${key}.${suffix}`)
    if (!inside(this.archiveRoot, target)) throw new TypeError('THEOL 本地附件路径越界')
    return target
  }

  async savePage({ kind = 'course', parentId, id, title, html } = {}) {
    const buffer = Buffer.from(normalizeHtmlForArchive(html), 'utf8')
    if (!buffer.length) throw new Error('THEOL 课程页面为空')
    if (buffer.length > THEOL_ARCHIVE_PAGE_MAX_BYTES) throw new Error('THEOL 课程页面超过 16 MB 限制')
    const target = this.pagePath({ kind, parentId, id, title })
    await mkdir(this.directory(kind, parentId), { recursive: true })
    await atomicWrite(target, buffer)
    return {
      localPath: target,
      localStatus: 'saved',
      localBytes: buffer.length,
      localSha256: digest(buffer),
      localCapturedAt: new Date().toISOString(),
    }
  }

  async saveAttachment({ kind = 'course', parentId, attachment, buffer, extension = '' } = {}) {
    const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '')
    if (!bytes.length) throw new Error('THEOL 课程附件为空')
    if (bytes.length > THEOL_ARCHIVE_ATTACHMENT_MAX_BYTES) throw new Error('THEOL 课程附件超过 32 MB 限制')
    const target = this.attachmentPath({ kind, parentId, attachment, extension })
    await mkdir(this.directory(kind, parentId), { recursive: true })
    await atomicWrite(target, bytes)
    return {
      localPath: target,
      localStatus: 'saved',
      localBytes: bytes.length,
      localSha256: digest(bytes),
      localFileName: basename(target),
      localCapturedAt: new Date().toISOString(),
    }
  }

  async repairLegacyArchives() {
    const result = { scanned: 0, repaired: 0, materialized: 0, unchanged: 0, failed: 0, errors: [] }
    for (const root of [this.courseRoot, this.assignmentRoot]) {
      await this.repairHtmlTree(root, result)
    }
    for (const root of [this.courseRoot, this.assignmentRoot]) {
      await this.repairUeditorTree(root, result)
    }
    return result
  }

  async repairHtmlTree(directory, result) {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') return
      result.failed += 1
      result.errors.push(`${directory}: ${String(error?.message || error).slice(0, 240)}`)
      return
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const target = resolve(directory, entry.name)
      if (entry.isDirectory()) {
        await this.repairHtmlTree(target, result)
        continue
      }
      if (!entry.isFile() || !/\.html?$/iu.test(entry.name)) continue
      result.scanned += 1
      try {
        const original = await readFile(target)
        const repaired = Buffer.from(normalizeHtmlForArchive(decodeExistingHtml(original)), 'utf8')
        if (Buffer.compare(original, repaired) === 0) {
          result.unchanged += 1
          continue
        }
        await atomicWrite(target, repaired)
        result.repaired += 1
      } catch (error) {
        result.failed += 1
        result.errors.push(`${target}: ${String(error?.message || error).slice(0, 240)}`)
      }
    }
  }

  async repairUeditorTree(directory, result, repairedFrames = new Set()) {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') return
      result.failed += 1
      result.errors.push(`${directory}: ${String(error?.message || error).slice(0, 240)}`)
      return
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const target = resolve(directory, entry.name)
      if (entry.isDirectory()) {
        await this.repairUeditorTree(target, result, repairedFrames)
        continue
      }
      if (!entry.isFile() || !/\.html?$/iu.test(entry.name)) continue
      try {
        const parentHtml = await readFile(target, 'utf8')
        const $ = cheerio.load(parentHtml)
        const frames = $('iframe[src], frame[src]').toArray()
        for (const [index, frame] of frames.entries()) {
          const rawSource = String($(frame).attr('src') || '').split(/[?#]/u, 1)[0]
          if (!rawSource || /^(?:https?:|data:|javascript:)/iu.test(rawSource) || !/\.html?$/iu.test(rawSource)) continue
          const frameTarget = resolve(directory, rawSource)
          if (!inside(this.archiveRoot, frameTarget) || repairedFrames.has(frameTarget)) continue
          let frameHtml
          try {
            frameHtml = await readFile(frameTarget, 'utf8')
          } catch {
            continue
          }
          const identity = String($(frame).attr('id') || $(frame).attr('name') || '')
            .match(/(?:_rtf_)?content([A-Za-z0-9_-]+)$/iu)?.[1] || null
          const materialized = materializeTheolUeditorFrame(frameHtml, parentHtml, '', {
            frameIdentity: identity,
            fallbackIndex: index,
          })
          if (!materialized.content) continue
          repairedFrames.add(frameTarget)
          const normalized = Buffer.from(normalizeHtmlForArchive(materialized.html), 'utf8')
          const original = Buffer.from(frameHtml, 'utf8')
          if (Buffer.compare(original, normalized) === 0) continue
          await atomicWrite(frameTarget, normalized)
          result.materialized += 1
        }
      } catch (error) {
        result.failed += 1
        result.errors.push(`${target}: ${String(error?.message || error).slice(0, 240)}`)
      }
    }
  }

  async validateLocalFile(localPath) {
    const target = resolve(String(localPath || ''))
    if (!inside(this.archiveRoot, target)) throw new Error('THEOL 本地文件路径无效')
    const actual = await realpath(target)
    if (!inside(this.archiveRoot, actual)) throw new Error('THEOL 本地文件路径越界')
    const info = await stat(actual)
    if (!info.isFile()) throw new Error('THEOL 本地路径不是文件')
    return actual
  }
}
