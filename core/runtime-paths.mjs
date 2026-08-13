import { homedir } from 'node:os'
import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, readdir } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

export const LEGACY_DATA_FILES = Object.freeze([
  'data',
  'session',
  'course-work',
  'course-selection',
  'academic-calendar',
  'appearance',
  'summaries',
  'buct-data.json',
  'buct-data.json.bak',
  'credentials.v1.dpapi.json',
  'academic-api-credentials.v1.dpapi.json',
  'mail-credentials.v1.dpapi.json',
  'model-api-key.v1.dpapi.json',
  'model-config-transaction.v1.json',
  'theia-feed.json',
  'auth-diagnostics.ndjson',
])

const TRANSIENT_NAMES = new Set([
  '.write.lock',
  'LOCK',
  'SingletonCookie',
  'SingletonLock',
  'SingletonSocket',
  'DevToolsActivePort',
])
const CACHE_DIRECTORIES = new Set([
  'Cache',
  'Code Cache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'GPUCache',
  'GrShaderCache',
  'GraphiteDawnCache',
  'ShaderCache',
])
const WORKSPACE_PATH_FIELDS = Object.freeze([
  'directory',
  'manifestPath',
  'taskPath',
  'answerKeyPath',
  'submissionPath',
  'notesPath',
  'notesPdfPath',
  'paperPath',
  'paperPdfPath',
  'modelAnswerPath',
  'modelAnswerPdfPath',
])
const LEGACY_PATH_MAPPINGS = Object.freeze([
  {
    name: 'session/Partitions/buct -> session/Partitions/theia',
    source: ['session', 'Partitions', 'buct'],
    destination: ['session', 'Partitions', 'theia'],
  },
])
const MODEL_TRANSACTION_COHORT = new Set([
  'data',
  'buct-data.json',
  'buct-data.json.bak',
  'model-api-key.v1.dpapi.json',
  'model-config-transaction.v1.json',
])

function emptyCopyResult() {
  return { filesCopied: 0, directoriesCreated: 0, issues: [] }
}

function issueResult(kind, path, error = null) {
  return {
    ...emptyCopyResult(),
    issues: [{
      kind,
      path,
      ...(error?.code ? { code: error.code } : {}),
      ...(error?.message ? { message: String(error.message).slice(0, 300) } : {}),
    }],
  }
}

function mergeCopyResult(target, copied) {
  target.filesCopied += copied.filesCopied
  target.directoriesCreated += copied.directoriesCreated
  target.issues.push(...copied.issues)
  return target
}

function samePath(left, right) {
  return relative(resolve(left), resolve(right)) === ''
}

function pathInside(root, path) {
  const offset = relative(root, path)
  return Boolean(offset) && !isAbsolute(offset) && offset !== '..' && !offset.startsWith(`..${sep}`)
}

async function pathMetadataWithoutLinks(root, path) {
  const resolvedRoot = resolve(root)
  const resolvedPath = resolve(path)
  if (!pathInside(resolvedRoot, resolvedPath)) return null
  try {
    const rootMetadata = await lstat(resolvedRoot)
    if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) return null
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null
    throw error
  }
  const segments = relative(resolvedRoot, resolvedPath).split(sep).filter(Boolean)
  let cursor = resolvedRoot
  for (const segment of segments) {
    cursor = resolve(cursor, segment)
    let metadata
    try {
      metadata = await lstat(cursor)
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null
      throw error
    }
    if (metadata.isSymbolicLink()) return null
    if (cursor === resolvedPath) return metadata
    if (!metadata.isDirectory()) return null
  }
  return null
}

function sameEntryType(left, right) {
  return (left.isFile() && right.isFile()) || (left.isDirectory() && right.isDirectory())
}

function shouldSkipLegacyEntry(name, directory = false, scope = null) {
  const normalizedName = String(name)
  if (normalizedName.toLowerCase().endsWith('.tmp')) return true
  if (scope === 'data' && normalizedName === '.write.lock') return true
  return scope === 'session' && (
    TRANSIENT_NAMES.has(normalizedName)
    || (directory && CACHE_DIRECTORIES.has(normalizedName))
  )
}

async function copyMissingTree(source, destination, { excludedSources = [], scope = null } = {}) {
  if (excludedSources.some((excluded) => samePath(excluded, source))) return emptyCopyResult()
  let metadata
  try {
    metadata = await lstat(source)
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyCopyResult()
    return issueResult('source-stat-failed', source, error)
  }
  if (metadata.isSymbolicLink()) return issueResult('source-link-skipped', source)
  if (metadata.isFile()) {
    let destinationMetadata
    try {
      destinationMetadata = await lstat(destination)
    } catch (error) {
      if (error?.code !== 'ENOENT') return issueResult('destination-stat-failed', destination, error)
    }
    if (destinationMetadata) {
      return destinationMetadata.isFile() && !destinationMetadata.isSymbolicLink()
        ? emptyCopyResult()
        : issueResult('destination-type-conflict', destination)
    }
    try {
      await copyFile(source, destination, constants.COPYFILE_EXCL)
      return { filesCopied: 1, directoriesCreated: 0, issues: [] }
    } catch (error) {
      if (error?.code === 'EEXIST') {
        try {
          destinationMetadata = await lstat(destination)
          return destinationMetadata.isFile() && !destinationMetadata.isSymbolicLink()
            ? emptyCopyResult()
            : issueResult('destination-type-conflict', destination)
        } catch (statError) {
          return issueResult('destination-stat-failed', destination, statError)
        }
      }
      return issueResult('copy-failed', source, error)
    }
  }
  if (!metadata.isDirectory()) return issueResult('source-type-skipped', source)

  let directoriesCreated = 0
  let destinationMetadata
  try {
    destinationMetadata = await lstat(destination)
  } catch (error) {
    if (error?.code !== 'ENOENT') return issueResult('destination-stat-failed', destination, error)
  }
  if (destinationMetadata) {
    if (destinationMetadata.isSymbolicLink() || !destinationMetadata.isDirectory()) {
      return issueResult('destination-type-conflict', destination)
    }
  } else {
    try {
      await mkdir(destination)
      directoriesCreated = 1
    } catch (error) {
      if (error?.code !== 'EEXIST') return issueResult('destination-create-failed', destination, error)
      try {
        destinationMetadata = await lstat(destination)
      } catch (statError) {
        return issueResult('destination-stat-failed', destination, statError)
      }
      if (destinationMetadata.isSymbolicLink() || !destinationMetadata.isDirectory()) {
        return issueResult('destination-type-conflict', destination)
      }
    }
  }
  let entries
  try {
    entries = await readdir(source, { withFileTypes: true })
  } catch (error) {
    const result = issueResult('source-read-failed', source, error)
    result.directoriesCreated = directoriesCreated
    return result
  }
  const result = { filesCopied: 0, directoriesCreated, issues: [] }
  for (const entry of entries) {
    if (shouldSkipLegacyEntry(entry.name, entry.isDirectory(), scope)) continue
    const copied = await copyMissingTree(resolve(source, entry.name), resolve(destination, entry.name), { excludedSources, scope })
    mergeCopyResult(result, copied)
  }
  return result
}

export function runtimeDataRoots({ env = process.env, home = homedir() } = {}) {
  if (env.THEIA_DATA_ROOT) {
    return { current: resolve(env.THEIA_DATA_ROOT), legacy: null }
  }
  if (env.APPDATA) {
    const current = resolve(env.APPDATA, 'THEIA')
    const legacy = resolve(env.APPDATA, 'BUCT')
    return {
      current,
      legacy,
    }
  }
  return { current: resolve(home, '.theia'), legacy: null }
}

export function defaultDataRoot(options) {
  return runtimeDataRoots(options).current
}

export function legacyDataRoot(options) {
  return runtimeDataRoots(options).legacy
}

export async function migrateLegacyDataFiles({
  currentRoot = defaultDataRoot(),
  legacyRoot = legacyDataRoot(),
  files = LEGACY_DATA_FILES,
} = {}) {
  if (!legacyRoot || resolve(legacyRoot) === resolve(currentRoot)) return []
  await mkdir(currentRoot, { recursive: true })
  const currentMetadata = await lstat(currentRoot)
  if (currentMetadata.isSymbolicLink() || !currentMetadata.isDirectory()) {
    throw new Error('THEIA data root must be a real directory before legacy data can be migrated')
  }
  let legacyMetadata
  try {
    legacyMetadata = await lstat(legacyRoot)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  if (legacyMetadata.isSymbolicLink() || !legacyMetadata.isDirectory()) {
    throw new Error('The legacy BUCT data root must be a real directory before it can be migrated')
  }
  const [legacyModelTransaction, ...currentModelTransactionCohort] = await Promise.all([
    pathMetadataWithoutLinks(legacyRoot, resolve(legacyRoot, 'model-config-transaction.v1.json')),
    'data/manifest.json',
    'data/manifest.json.bak',
    'buct-data.json',
    'buct-data.json.bak',
    'model-api-key.v1.dpapi.json',
    'model-config-transaction.v1.json',
  ].map((name) => typeof name === 'string'
    ? pathMetadataWithoutLinks(currentRoot, resolve(currentRoot, name))
    : name))
  const modelTransactionCohortConflict = Boolean(legacyModelTransaction)
    && currentModelTransactionCohort.some((metadata) => metadata !== null)
  const enabledMappings = LEGACY_PATH_MAPPINGS.filter(({ source }) => files.includes(source[0]))
  const excludedSources = enabledMappings.map(({ source }) => resolve(legacyRoot, ...source))
  const migrated = []
  for (const name of files) {
    const source = resolve(legacyRoot, name)
    const destination = resolve(currentRoot, name)
    if (!pathInside(legacyRoot, source) || !pathInside(currentRoot, destination)) continue
    const copied = modelTransactionCohortConflict && MODEL_TRANSACTION_COHORT.has(name)
      ? ((await pathMetadataWithoutLinks(legacyRoot, source))
          ? issueResult('transaction-cohort-conflict', source)
          : emptyCopyResult())
      : await copyMissingTree(source, destination, { excludedSources, scope: name })
    if (copied.filesCopied || copied.directoriesCreated || copied.issues.length) {
      migrated.push({ name, source, destination, ...copied })
    }
  }
  for (const mapping of enabledMappings) {
    const source = resolve(legacyRoot, ...mapping.source)
    const destination = resolve(currentRoot, ...mapping.destination)
    if (!pathInside(legacyRoot, source) || !pathInside(currentRoot, destination)) continue
    const copied = await copyMissingTree(source, destination, { scope: mapping.source[0] })
    if (copied.filesCopied || copied.directoriesCreated || copied.issues.length) {
      migrated.push({ name: mapping.name, source, destination, ...copied })
    }
  }
  return migrated
}

export async function rebaseLegacyWorkspacePaths(state, {
  currentRoot = defaultDataRoot(),
  legacyRoot = legacyDataRoot(),
} = {}) {
  if (!legacyRoot || resolve(legacyRoot) === resolve(currentRoot) || !Array.isArray(state?.workspaces)) {
    return { state, changed: false, pathsRebased: 0 }
  }
  const resolvedLegacyRoot = resolve(legacyRoot)
  const resolvedCurrentRoot = resolve(currentRoot)
  let pathsRebased = 0
  const workspaces = []
  for (const workspace of state.workspaces) {
    if (!workspace || typeof workspace !== 'object') {
      workspaces.push(workspace)
      continue
    }
    let next = workspace
    for (const field of WORKSPACE_PATH_FIELDS) {
      if (typeof workspace[field] !== 'string' || !workspace[field] || !isAbsolute(workspace[field])) continue
      const legacyPath = resolve(workspace[field])
      if (!pathInside(resolvedLegacyRoot, legacyPath)) continue
      const destination = resolve(resolvedCurrentRoot, relative(resolvedLegacyRoot, legacyPath))
      if (!pathInside(resolvedCurrentRoot, destination)) continue
      const [legacyMetadata, destinationMetadata] = await Promise.all([
        pathMetadataWithoutLinks(resolvedLegacyRoot, legacyPath),
        pathMetadataWithoutLinks(resolvedCurrentRoot, destination),
      ])
      if (!legacyMetadata || !destinationMetadata || !sameEntryType(legacyMetadata, destinationMetadata)) continue
      if (next === workspace) next = { ...workspace }
      next[field] = destination
      pathsRebased += 1
    }
    workspaces.push(next)
  }
  return pathsRebased
    ? { state: { ...state, workspaces }, changed: true, pathsRebased }
    : { state, changed: false, pathsRebased: 0 }
}
