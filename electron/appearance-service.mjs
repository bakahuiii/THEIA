import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, extname, resolve } from 'node:path'

export const BACKGROUND_PROTOCOL = 'theia-background'
export const BACKGROUND_HOST = 'local'
export const APPEARANCE_PRESET_SCHEMA = 'theia-appearance-presets/v1'
const BACKGROUND_FILENAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u

function imageMediaType(filename) {
  switch (extname(filename).toLowerCase()) {
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    case '.avif': return 'image/avif'
    default: return 'application/octet-stream'
  }
}

function safeFilename(raw) {
  let filename
  try {
    filename = decodeURIComponent(String(raw || ''))
  } catch {
    return null
  }
  return BACKGROUND_FILENAME.test(filename) ? filename : null
}

export function createAppearanceService({ root, onDiagnostic = () => {} } = {}) {
  const userDataRoot = resolve(String(root || '.'))
  const backgroundDirectory = resolve(userDataRoot, 'appearance')
  const presetsPath = resolve(backgroundDirectory, 'presets.json')

  const backgroundAssetUrl = (filename) => `${BACKGROUND_PROTOCOL}://${BACKGROUND_HOST}/${encodeURIComponent(filename)}`
  const backgroundPath = (filename) => {
    const safe = safeFilename(filename)
    if (!safe) throw new Error('Invalid appearance background filename')
    return resolve(backgroundDirectory, safe)
  }

  const readPresets = async () => {
    try {
      const parsed = JSON.parse(await readFile(presetsPath, 'utf8'))
      return {
        exists: true,
        updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : null,
        presets: Array.isArray(parsed?.presets) ? parsed.presets : [],
      }
    } catch (error) {
      if (error?.code === 'ENOENT') return { exists: false, updatedAt: null, presets: [] }
      onDiagnostic('appearance.presets_read_failed', { error: error instanceof Error ? error.message : String(error) })
      return { exists: false, updatedAt: null, presets: [] }
    }
  }

  const writePresets = async (value) => {
    const presets = Array.isArray(value) ? value.slice(0, 16) : []
    const record = { schema: APPEARANCE_PRESET_SCHEMA, updatedAt: new Date().toISOString(), presets }
    await mkdir(dirname(presetsPath), { recursive: true })
    const temporary = `${presetsPath}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    await rm(presetsPath, { force: true })
    await rename(temporary, presetsPath)
    return record
  }

  const handleBackgroundAsset = async (request) => {
    try {
      const url = new URL(request.url)
      const filename = safeFilename(url.hostname === BACKGROUND_HOST ? url.pathname.replace(/^\/+/, '') : null)
      if (url.hostname !== BACKGROUND_HOST || !filename) return new Response('Not found', { status: 404 })
      const contents = await readFile(backgroundPath(filename))
      return new Response(contents, {
        headers: {
          'Content-Type': imageMediaType(filename),
          'Cache-Control': 'private, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  }

  return {
    backgroundDirectory,
    backgroundAssetUrl,
    backgroundPath,
    readPresets,
    writePresets,
    handleBackgroundAsset,
  }
}
