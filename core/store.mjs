import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { emptyDataCatalog } from './data-catalog.mjs'
import { emptyState, normalizeState } from './schema.mjs'
import { computeDomainDigests } from './domain-provenance.mjs'

export const SHARDED_STORE_SCHEMA = 'theia-sharded-store/v1'
export const STORE_FRAGMENT_SCHEMA = 'theia-state-fragment/v1'

const MANIFEST_NAME = 'manifest.json'
const MANIFEST_BACKUP_NAME = 'manifest.json.bak'
const STORE_LOCK_NAME = '.write.lock'
const STORE_LOCK_TIMEOUT_MS = 30_000
const STORE_LOCK_STALE_MS = 10 * 60_000
const DYNAMIC_FRAGMENT_PREFIXES = Object.freeze(['catalog/school-schedule/'])

function json(value) {
  return JSON.stringify(value, null, 2) + '\n'
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function safeSegment(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'unknown'
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))
}

function pathInside(root, path) {
  const offset = relative(root, path)
  return Boolean(offset) && !isAbsolute(offset) && offset !== '..' && !offset.startsWith(`..${sep}`)
}

function sameValue(left, right) {
  return digest(left) === digest(right)
}

function isDynamicFragmentKey(key) {
  return DYNAMIC_FRAGMENT_PREFIXES.some((prefix) => String(key || '').startsWith(prefix))
}

function removedDynamicFragments(manifest) {
  return new Set((Array.isArray(manifest?.removedFragments) ? manifest.removedFragments : [])
    .filter((key) => isDynamicFragmentKey(key) && !Object.hasOwn(manifest.fragments || {}, key)))
}

function mergeConcurrentReplacement(base, next, latest) {
  const merged = { ...latest }
  for (const [key, value] of Object.entries(next)) {
    if (!sameValue(base?.[key], value)) merged[key] = value
  }
  return normalizeState(merged)
}

export class CampusStoreRecoveryError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'CampusStoreRecoveryError'
    Object.assign(this, details)
  }
}

async function writeAtomic(path, value, { backup = false } = {}) {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${randomUUID()}.tmp`
  await writeFile(temp, json(value), 'utf8')
  if (backup && existsSync(path)) await copyFile(path, `${path}.bak`)
  await rm(path, { force: true })
  await rename(temp, path)
}

function catalogWithoutSchoolSchedule(catalog) {
  const source = catalog && typeof catalog === 'object' ? catalog : emptyDataCatalog()
  return {
    ...source,
    collections: {
      ...(source.collections || {}),
      schoolSchedule: {
        ...(source.collections?.schoolSchedule || {}),
        records: {},
      },
    },
  }
}

function stateFragments(state) {
  const fragments = new Map([
    ['state/meta', { appVersion: state.appVersion, createdAt: state.createdAt, updatedAt: state.updatedAt }],
    ['state/profile', state.profile],
    ['state/settings', state.settings],
    ['state/sync', state.sync],
    ['academic/terms', state.terms],
    ['academic/courses', state.courses],
    ['academic/schedule', state.schedule],
    ['academic/exams', state.exams],
    ['academic/grades', state.grades],
    ['academic/selected-courses', state.selectedCourses],
    ['academic/progress', state.academicProgress],
    ['coursework/assignments', state.assignments],
    ['coursework/workspaces', state.workspaces],
    ['communication/notices', state.notices],
    ['communication/emails', state.emails],
    ['catalog/index', catalogWithoutSchoolSchedule(state.dataCatalog)],
  ])

  const records = state.dataCatalog?.collections?.schoolSchedule?.records || {}
  for (const [key, record] of Object.entries(records)) {
    const termId = safeSegment(record?.scope?.termId || key)
    fragments.set(`catalog/school-schedule/${termId}`, { key, record })
  }
  return fragments
}

const REQUIRED_FRAGMENT_KEYS = Object.freeze([...stateFragments(emptyState()).keys()])

function mergeFragments(values) {
  const state = emptyState()
  const value = (key, fallback) => values.get(key) ?? fallback
  Object.assign(state, value('state/meta', {}))
  state.profile = value('state/profile', null)
  state.settings = value('state/settings', state.settings)
  state.sync = value('state/sync', state.sync)
  state.terms = value('academic/terms', [])
  state.courses = value('academic/courses', [])
  state.schedule = value('academic/schedule', [])
  state.exams = value('academic/exams', [])
  state.grades = value('academic/grades', [])
  state.selectedCourses = value('academic/selected-courses', [])
  state.academicProgress = value('academic/progress', null)
  state.assignments = value('coursework/assignments', [])
  state.workspaces = value('coursework/workspaces', [])
  state.notices = value('communication/notices', [])
  state.emails = value('communication/emails', [])
  state.dataCatalog = value('catalog/index', emptyDataCatalog())
  const records = {}
  for (const [key, fragment] of values) {
    if (!key.startsWith('catalog/school-schedule/')) continue
    if (!fragment?.key || !fragment?.record) continue
    records[fragment.key] = fragment.record
  }
  state.dataCatalog = {
    ...state.dataCatalog,
    collections: {
      ...(state.dataCatalog?.collections || {}),
      schoolSchedule: {
        ...(state.dataCatalog?.collections?.schoolSchedule || {}),
        records,
      },
    },
  }
  return normalizeState(state)
}

export class CampusStore {
  constructor(root) {
    this.root = resolve(root)
    this.file = resolve(this.root, 'buct-data.json')
    this.backup = resolve(this.root, 'buct-data.json.bak')
    this.dataRoot = resolve(this.root, 'data')
    this.manifest = resolve(this.dataRoot, MANIFEST_NAME)
    this.manifestBackup = resolve(this.dataRoot, MANIFEST_BACKUP_NAME)
    this.writeLock = resolve(this.dataRoot, STORE_LOCK_NAME)
    this.state = emptyState()
    this.activeManifest = null
    this.committedView = null
    this.recovery = null
    this.operationQueue = Promise.resolve()
    this.loadPromise = null
    this.listeners = new Set()
    this.loaded = false
  }

  subscribe(listener) {
    if (typeof listener !== 'function') return () => {}
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async load() {
    if (this.loaded) return this.state
    if (this.loadPromise) return this.loadPromise
    this.loadPromise = this.loadFromDisk().finally(() => { this.loadPromise = null })
    return this.loadPromise
  }

  async loadFromDisk() {
    await mkdir(this.root, { recursive: true })
    const sharded = await this.loadSharded()
    if (sharded && !this.recovery) return this.finishLoad(sharded)

    if (sharded) {
      return this.withWriteLock(async () => {
        // Re-read under the lock: another process may already have repaired or
        // advanced the manifest after the optimistic read above.
        const latest = await this.loadSharded()
        if (!latest) {
          throw new CampusStoreRecoveryError('THEIA data manifests disappeared during recovery; the existing fragments were left untouched')
        }
        return this.finishLoad(await this.repairRecoveredSnapshot(latest))
      })
    }

    return this.withWriteLock(async () => {
      // Another process may have initialized the store while this instance was
      // waiting for the lock. Prefer that committed state over a stale legacy
      // snapshot or a second empty initialization.
      const concurrent = await this.loadSharded()
      if (concurrent) {
        return this.finishLoad(await this.repairRecoveredSnapshot(concurrent))
      }

      let legacy = null
      for (const path of [this.file, this.backup]) {
        if (!existsSync(path)) continue
        try {
          legacy = await readJson(path)
          break
        } catch {
          // A legacy snapshot is only a migration source. Try its backup before
          // creating a clean store.
        }
      }
      const initial = normalizeState(legacy)
      await this.persistSharded(initial)
      return this.finishLoad(initial)
    })
  }

  finishLoad(state) {
    this.state = normalizeState(state)
    this.refreshCommittedView()
    this.loaded = true
    return this.state
  }

  async loadSharded() {
    const candidates = []
    const manifestErrors = []
    let foundManifest = false
    for (const [label, path] of [['primary', this.manifest], ['backup', this.manifestBackup]]) {
      if (!existsSync(path)) continue
      foundManifest = true
      try {
        const manifest = await readJson(path)
        const fragments = manifest?.fragments
        const missingRequired = fragments && typeof fragments === 'object'
          ? REQUIRED_FRAGMENT_KEYS.filter((key) => !Object.hasOwn(fragments, key))
          : REQUIRED_FRAGMENT_KEYS
        if (manifest?.schema !== SHARDED_STORE_SCHEMA || !fragments || typeof fragments !== 'object' || missingRequired.length) {
          throw new Error('invalid manifest shape')
        }
        candidates.push({ label, path, manifest })
      } catch (error) {
        manifestErrors.push({ label, error: error instanceof Error ? error.message : String(error) })
      }
    }
    if (!foundManifest) return null
    if (!candidates.length) {
      throw new CampusStoreRecoveryError('THEIA data manifests are damaged; the existing store was left untouched', {
        manifestErrors,
        missingFragments: [],
      })
    }

    // Recover a new manifest fragment-by-fragment. This preserves every valid
    // newest fragment while allowing a damaged newest object to fall back only
    // to the exact object referenced by the previous committed manifest.
    const preferred = candidates[0]
    const values = new Map()
    const references = {}
    const fallbackFragments = []
    const missingFragments = []
    const fragmentErrors = []
    const removedFragments = removedDynamicFragments(preferred.manifest)
    const fragmentKeys = new Set(Object.keys(preferred.manifest.fragments))
    for (const candidate of candidates.slice(1)) {
      for (const key of Object.keys(candidate.manifest.fragments)) {
        if (isDynamicFragmentKey(key) && !removedFragments.has(key)) fragmentKeys.add(key)
      }
    }
    for (const key of fragmentKeys) {
      let restored
      let found = false
      const seen = new Set()
      for (const candidate of candidates) {
        const reference = candidate.manifest.fragments[key]
        const identity = `${reference?.path || ''}\u0000${reference?.digest || ''}`
        if (!reference || seen.has(identity)) continue
        seen.add(identity)
        try {
          restored = await this.readFragment(key, reference)
          found = true
          references[key] = reference
          if (candidate !== preferred) fallbackFragments.push(key)
          break
        } catch (error) {
          fragmentErrors.push({ key, manifest: candidate.label, error: error instanceof Error ? error.message : String(error) })
        }
      }
      if (!found) missingFragments.push(key)
      else values.set(key, restored)
    }
    if (missingFragments.length) {
      throw new CampusStoreRecoveryError(`THEIA data fragments cannot be recovered: ${missingFragments.join(', ')}`, {
        manifestErrors,
        fragmentErrors,
        missingFragments,
        recoverableFragments: [...values.keys()],
      })
    }

    this.recovery = preferred.label !== 'primary' || fallbackFragments.length
      ? { source: preferred.label, manifestErrors, fallbackFragments: [...new Set(fallbackFragments)] }
      : null
    this.activeManifest = {
      ...preferred.manifest,
      fragments: references,
      ...(this.recovery ? { recovery: this.recovery } : {}),
    }
    return mergeFragments(values)
  }

  async readFragment(key, reference) {
    const relativePath = String(reference?.path || '')
    if (!relativePath || typeof reference?.digest !== 'string') throw new Error(`invalid reference for ${key}`)
    const target = resolve(this.dataRoot, relativePath)
    if (!pathInside(this.dataRoot, target)) throw new Error(`invalid path for ${key}`)
    const fragment = await readJson(target)
    const valueDigest = digest(fragment?.value)
    if (fragment?.schema !== STORE_FRAGMENT_SCHEMA || fragment?.kind !== key || valueDigest !== reference.digest || fragment?.digest !== valueDigest) {
      throw new Error(`integrity check failed for ${key}`)
    }
    return fragment.value
  }

  snapshot() {
    return structuredClone(this.state)
  }

  snapshotWithRevision() {
    if (!this.loaded || !this.activeManifest || !this.committedView) {
      throw new Error('CampusStore must be loaded before reading a versioned snapshot')
    }
    return structuredClone(this.committedView)
  }

  refreshCommittedView() {
    this.committedView = {
      state: this.state,
      revision: this.activeManifest?.revision || null,
      committedAt: this.activeManifest?.updatedAt || null,
      domainDigests: computeDomainDigests(this.state),
    }
  }

  storageSummary() {
    return {
      schema: SHARDED_STORE_SCHEMA,
      manifest: this.manifest,
      updatedAt: this.activeManifest?.updatedAt || null,
      revision: this.activeManifest?.revision || null,
      fragments: Object.keys(this.activeManifest?.fragments || {}).sort(),
      legacySnapshot: existsSync(this.file) ? this.file : null,
      recovery: this.recovery,
    }
  }

  async save() {
    return this.enqueueOperation(async () => {
      await this.loadIfNeeded()
      const snapshot = this.snapshot()
      await this.withWriteLock(async () => this.commitSnapshot(snapshot))
      return this.snapshot()
    })
  }

  async persistSharded(state, { preserveManifestBackup = false, recovery = null } = {}) {
    const fragments = stateFragments(state)
    const references = {}
    for (const [kind, value] of fragments) {
      const valueDigest = digest(value)
      const path = `objects/${kind}/${valueDigest}.json`
      const destination = resolve(this.dataRoot, path)
      if (!existsSync(destination)) {
        await writeAtomic(destination, {
          schema: STORE_FRAGMENT_SCHEMA,
          kind,
          digest: valueDigest,
          writtenAt: new Date().toISOString(),
          value,
        })
      }
      references[kind] = { path, digest: valueDigest }
    }
    const removedFragments = Object.keys(this.activeManifest?.fragments || {})
      .filter((key) => isDynamicFragmentKey(key) && !Object.hasOwn(references, key))
    const manifest = {
      schema: SHARDED_STORE_SCHEMA,
      revision: randomUUID(),
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      fragments: references,
      ...(removedFragments.length ? { removedFragments } : {}),
      legacy: existsSync(this.file) ? { path: 'buct-data.json', retainedForMigration: true } : null,
      ...(recovery ? { recovery: { ...recovery, repairedAt: state.updatedAt } } : {}),
    }
    await writeAtomic(this.manifest, manifest, { backup: !preserveManifestBackup })
    this.activeManifest = manifest
  }

  async repairRecoveredSnapshot(state) {
    if (!this.recovery) return state
    const recovery = structuredClone(this.recovery)
    const repaired = normalizeState(state)
    repaired.updatedAt = new Date().toISOString()
    // The current primary may be corrupt or may reference the corrupt object.
    // Do not rotate it over the last known recoverable backup while publishing
    // a fresh manifest whose references all match the recovered state.
    await this.persistSharded(repaired, { preserveManifestBackup: true, recovery })
    this.recovery = recovery
    return repaired
  }

  async update(mutator) {
    return this.enqueueOperation(async () => {
      await this.loadIfNeeded()
      return this.withWriteLock(async () => {
        const loaded = await this.loadSharded()
        const current = loaded ? await this.repairRecoveredSnapshot(loaded) : this.snapshot()
        const working = structuredClone(current)
        const result = await mutator(working)
        const next = normalizeState(result && result !== working ? result : working)
        next.updatedAt = new Date().toISOString()
        await this.commitSnapshot(next)
        return this.snapshot()
      })
    })
  }

  async replace(nextState) {
    return this.enqueueOperation(async () => {
      await this.loadIfNeeded()
      const base = this.snapshot()
      const expectedRevision = this.activeManifest?.revision || null
      return this.withWriteLock(async () => {
        const loaded = await this.loadSharded()
        const latest = loaded ? await this.repairRecoveredSnapshot(loaded) : base
        const diskRevision = this.activeManifest?.revision || null
        const requested = normalizeState(nextState)
        const next = expectedRevision && diskRevision && expectedRevision !== diskRevision
          ? mergeConcurrentReplacement(base, requested, latest)
          : requested
        next.updatedAt = new Date().toISOString()
        await this.commitSnapshot(next)
        return this.snapshot()
      })
    })
  }

  enqueueOperation(operation) {
    const pending = this.operationQueue.catch(() => {}).then(operation)
    this.operationQueue = pending
    return pending
  }

  async commitSnapshot(snapshot) {
    await this.persistSharded(snapshot)
    this.state = normalizeState(snapshot)
    this.refreshCommittedView()
    for (const listener of this.listeners) {
      Promise.resolve(listener(structuredClone(this.state))).catch(() => {})
    }
  }

  async withWriteLock(operation) {
    await mkdir(this.dataRoot, { recursive: true })
    const token = randomUUID()
    const startedAt = Date.now()
    while (true) {
      try {
        const handle = await open(this.writeLock, 'wx', 0o600)
        try {
          await handle.writeFile(`${JSON.stringify({ token, pid: process.pid, createdAt: new Date().toISOString() })}\n`, 'utf8')
        } finally {
          await handle.close()
        }
        break
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
        let stale = false
        try {
          const metadata = JSON.parse(await readFile(this.writeLock, 'utf8'))
          const age = Date.now() - (await stat(this.writeLock)).mtimeMs
          let ownerAlive = true
          if (Number.isInteger(metadata?.pid) && metadata.pid > 0) {
            try { process.kill(metadata.pid, 0) } catch (ownerError) { ownerAlive = ownerError?.code !== 'ESRCH' }
          }
          stale = !ownerAlive || age > STORE_LOCK_STALE_MS
        } catch {
          try { stale = Date.now() - (await stat(this.writeLock)).mtimeMs > STORE_LOCK_STALE_MS } catch { stale = true }
        }
        if (stale) {
          await rm(this.writeLock, { force: true })
          continue
        }
        if (Date.now() - startedAt >= STORE_LOCK_TIMEOUT_MS) throw new Error('Timed out waiting for the THEIA data-store write lock')
        await wait(40)
      }
    }
    try {
      return await operation()
    } finally {
      try {
        const metadata = JSON.parse(await readFile(this.writeLock, 'utf8'))
        if (metadata?.token === token) await rm(this.writeLock, { force: true })
      } catch { /* A stale-lock recovery may already have removed it. */ }
    }
  }

  async loadIfNeeded() {
    if (!this.loaded) await this.load()
  }
}
