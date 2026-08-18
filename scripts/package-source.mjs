import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

export const SOURCE_FILES = [
  '.gitignore',
  'AI_DIRECTION.md',
  'DEVELOPMENT.md',
  'LICENSE',
  'README.md',
  'SECURITY.md',
  'build/theia-icon.ico',
  'components.json',
  'eslint.config.js',
  'index.html',
  'package-lock.json',
  'package.json',
  'scripts/dev-processes.mjs',
  'scripts/dev-web.mjs',
  'scripts/dev.mjs',
  'scripts/package-source.mjs',
  'scripts/advisor-benchmark-corpus.mjs',
  'scripts/benchmark-advisor.mjs',
  'scripts/smoke-packaged.mjs',
  'scripts/strip-jpeg-metadata.mjs',
  'tsconfig.app.json',
  'tsconfig.json',
  'tsconfig.node.json',
  'vite.config.ts',
]

export const SOURCE_DIRECTORIES = [
  'cli',
  'core',
  'docs',
  'electron',
  'integration',
  'src',
  'tests',
]

const EXACT_EXCLUDES = new Set([
  'electron/extract-chrome-cookies.py',
  'electron/extract-wxwork-cookies.py',
  'scripts/crawl-jwglxt-api.py',
  'scripts/extract_manual.py',
  'scripts/extract_pdf.py',
  'scripts/read_pdf.mjs',
  'src/assets/DSC_8146-已增强-降噪.jpg',
  'src/assets/theia-changping-campus-map.metadata-clean.jpg',
  'src/styles.css.bak',
].map((path) => path.toLowerCase()))

const FORBIDDEN_SEGMENTS = new Set([
  '.cache',
  '.git',
  '.references',
  '__pycache__',
  'cache',
  'caches',
  'dist',
  'logs',
  'local-docs',
  'node_modules',
  'release-bin',
])

const FORBIDDEN_BASENAMES = new Set([
  'api-runtime.json',
  'auth-diagnostics.ndjson',
  'buct-data.json',
  'buct-data.json.bak',
  'cookies',
  'cookies-journal',
  'model-config-transaction.v1.json',
  'singletoncookie',
  'singletonlock',
  'singletonsocket',
  'theia-feed.json',
])

const FORBIDDEN_SUFFIXES = [
  '.bak',
  '.crt',
  '.db',
  '.db-shm',
  '.db-wal',
  '.dpapi.json',
  '.jsonl',
  '.key',
  '.lock',
  '.log',
  '.ndjson',
  '.p12',
  '.pem',
  '.pfx',
  '.pyc',
  '.sqlite',
  '.sqlite3',
  '.tmp',
  '.tsbuildinfo',
]

const STORED_EXTENSIONS = new Set([
  '.ico',
  '.jpeg',
  '.jpg',
  '.png',
  '.ttf',
  '.webp',
  '.zip',
])

const ZIP_DATE = new Date('1980-01-01T00:00:00.000Z')
export const PROJECT_ROOT = resolve(import.meta.dirname, '..')

function archivePath(projectRoot, absolutePath) {
  const path = relative(projectRoot, absolutePath).replaceAll('\\', '/')
  if (!path || path === '..' || path.startsWith('../') || path.includes('/../')) {
    throw new Error(`Source path escapes the project root: ${absolutePath}`)
  }
  return path
}

export function isForbiddenSourcePath(value) {
  const path = String(value || '').replaceAll('\\', '/').replace(/^\.\//, '')
  const lower = path.toLowerCase()
  const segments = lower.split('/')
  const basename = segments.at(-1) || ''
  return !path
    || path.startsWith('/')
    || /^[a-z]:/i.test(path)
    || segments.includes('.')
    || segments.includes('..')
    || EXACT_EXCLUDES.has(lower)
    || segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment))
    || FORBIDDEN_BASENAMES.has(basename)
    || FORBIDDEN_SUFFIXES.some((suffix) => basename.endsWith(suffix))
    || basename === '.env'
    || basename.startsWith('.env.')
    || /^extract-[^/]*-cookies\.py$/i.test(basename)
}

async function walk(projectRoot, directory, entries) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = resolve(directory, item.name)
    const path = archivePath(projectRoot, absolutePath)
    if (isForbiddenSourcePath(path)) continue
    if (item.isSymbolicLink()) throw new Error(`Source package refuses symbolic link: ${path}`)
    if (item.isDirectory()) await walk(projectRoot, absolutePath, entries)
    else if (item.isFile()) entries.push({ absolutePath, path, size: (await stat(absolutePath)).size })
  }
}

export async function collectSourceFiles(projectRoot = PROJECT_ROOT) {
  const entries = []
  for (const path of SOURCE_FILES) {
    const absolutePath = resolve(projectRoot, path)
    const info = await lstat(absolutePath)
    if (info.isSymbolicLink()) throw new Error(`Source package refuses symbolic link: ${path}`)
    if (!info.isFile()) throw new Error(`Required source file is missing: ${path}`)
    entries.push({ absolutePath, path, size: info.size })
  }
  for (const path of SOURCE_DIRECTORIES) {
    const absolutePath = resolve(projectRoot, path)
    const info = await lstat(absolutePath)
    if (info.isSymbolicLink()) throw new Error(`Source package refuses symbolic link: ${path}`)
    if (!info.isDirectory()) throw new Error(`Required source directory is missing: ${path}`)
    await walk(projectRoot, absolutePath, entries)
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path, 'en'))
}

async function sha256(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex').toUpperCase()
}

function sha256Buffer(value) {
  return createHash('sha256').update(value).digest('hex').toUpperCase()
}

export async function verifySourceArchive(path) {
  const zip = await JSZip.loadAsync(await readFile(path), { checkCRC32: true })
  const entries = Object.values(zip.files)
  for (const entry of entries) {
    if (entry.dir) throw new Error(`Source archive must not contain directory entries: ${entry.name}`)
    if (entry.unsafeOriginalName !== entry.name
      || entry.name.includes('\\')
      || entry.name.startsWith('/')
      || entry.name.includes('\0')
      || entry.name.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
      throw new Error(`Source archive contains an unsafe entry path: ${entry.unsafeOriginalName || entry.name}`)
    }
  }
  const roots = new Set(entries.map((entry) => entry.name.split('/')[0]).filter(Boolean))
  if (roots.size !== 1) throw new Error('Source archive must contain exactly one root directory')
  const rootName = [...roots][0]
  const manifestEntry = zip.file(`${rootName}/SOURCE-MANIFEST.json`)
  if (!manifestEntry) throw new Error('Source archive manifest is missing')
  const manifest = JSON.parse(await manifestEntry.async('string'))
  if (manifest.schema !== 'theia-source-package/v1' || manifest.rootDirectory !== rootName) {
    throw new Error('Source archive manifest identity is invalid')
  }
  if (!Array.isArray(manifest.files) || manifest.fileCount !== manifest.files.length) {
    throw new Error('Source archive manifest count is invalid')
  }

  const actualNames = new Set(entries.map((entry) => entry.name))
  if (actualNames.size !== manifest.fileCount + 1) throw new Error('Source archive contains unlisted files')
  let totalBytes = 0
  for (const file of manifest.files) {
    if (typeof file?.path !== 'string' || isForbiddenSourcePath(file.path)) {
      throw new Error(`Source archive contains a forbidden path: ${file?.path}`)
    }
    const name = `${rootName}/${file.path}`
    const entry = zip.file(name)
    if (!entry) throw new Error(`Source archive file is missing: ${file.path}`)
    const content = await entry.async('nodebuffer')
    if (content.length !== file.bytes || sha256Buffer(content) !== file.sha256) {
      throw new Error(`Source archive file does not match its manifest: ${file.path}`)
    }
    actualNames.delete(name)
    totalBytes += content.length
  }
  actualNames.delete(`${rootName}/SOURCE-MANIFEST.json`)
  if (actualNames.size !== 0 || totalBytes !== manifest.totalBytes) {
    throw new Error('Source archive totals do not match its manifest')
  }
  return { rootName, sourceFiles: manifest.fileCount, sourceBytes: totalBytes, version: manifest.version }
}

async function replaceFile(source, destination) {
  const backup = `${destination}.previous`
  await rm(backup, { force: true })
  let hadDestination = false
  try {
    await rename(destination, backup)
    hadDestination = true
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  try {
    await rename(source, destination)
    if (hadDestination) await rm(backup, { force: true })
  } catch (error) {
    if (hadDestination) await rename(backup, destination).catch(() => {})
    throw error
  }
}

export async function packageSource({ projectRoot = PROJECT_ROOT, outputDirectory = resolve(projectRoot, 'release-bin') } = {}) {
  const packageJson = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8'))
  const version = String(packageJson.version || '').trim()
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Invalid package version: ${version}`)

  const entries = await collectSourceFiles(projectRoot)
  const files = []
  for (const entry of entries) files.push({ path: entry.path, bytes: entry.size, sha256: await sha256(entry.absolutePath) })

  const rootName = `THEIA-${version}-source`
  const manifest = {
    schema: 'theia-source-package/v1',
    name: packageJson.name,
    version,
    rootDirectory: rootName,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files,
  }

  const zip = new JSZip()
  for (const entry of entries) {
    zip.file(`${rootName}/${entry.path}`, createReadStream(entry.absolutePath), {
      binary: true,
      compression: STORED_EXTENSIONS.has(extname(entry.path).toLowerCase()) ? 'STORE' : 'DEFLATE',
      createFolders: false,
      date: ZIP_DATE,
    })
  }
  zip.file(`${rootName}/SOURCE-MANIFEST.json`, `${JSON.stringify(manifest, null, 2)}\n`, {
    compression: 'DEFLATE',
    createFolders: false,
    date: ZIP_DATE,
  })

  await mkdir(outputDirectory, { recursive: true })
  const outputPath = resolve(outputDirectory, `${rootName}.zip`)
  const temporaryPath = `${outputPath}.tmp-${process.pid}`
  await rm(temporaryPath, { force: true })
  try {
    await pipeline(
      zip.generateNodeStream({ streamFiles: true, compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'DOS' }),
      createWriteStream(temporaryPath, { flags: 'wx' }),
    )
    await verifySourceArchive(temporaryPath)
    await replaceFile(temporaryPath, outputPath)
  } catch (error) {
    await rm(temporaryPath, { force: true })
    throw error
  }

  const outputInfo = await stat(outputPath)
  const verification = await verifySourceArchive(outputPath)
  return {
    schema: manifest.schema,
    path: outputPath,
    bytes: outputInfo.size,
    sha256: await sha256(outputPath),
    sourceFiles: verification.sourceFiles,
    sourceBytes: verification.sourceBytes,
    verified: true,
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  packageSource()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error?.stack || error}\n`)
      process.exitCode = 1
    })
}
