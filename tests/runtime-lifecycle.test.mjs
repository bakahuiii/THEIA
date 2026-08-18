import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { startLocalApi } from '../core/local-api.mjs'
import { CourseWorkService } from '../core/course-work.mjs'
import { migrateLegacyDataFiles, rebaseLegacyWorkspacePaths, runtimeDataRoots } from '../core/runtime-paths.mjs'
import { emptyState } from '../core/schema.mjs'
import { updateSettingsTransaction } from '../core/settings-transaction.mjs'
import { CampusStore } from '../core/store.mjs'

test('custom data roots are isolated from the real APPDATA legacy directory', () => {
  const roots = runtimeDataRoots({
    env: { THEIA_DATA_ROOT: 'H:\\isolated-theia', APPDATA: 'C:\\real-profile' },
    home: 'C:\\unused-home',
  })
  assert.equal(roots.current, resolve('H:\\isolated-theia'))
  assert.equal(roots.legacy, null)

  const defaults = runtimeDataRoots({ env: { APPDATA: 'C:\\profile' }, home: 'C:\\unused-home' })
  assert.equal(defaults.current, resolve('C:\\profile', 'THEIA'))
  assert.equal(defaults.legacy, resolve('C:\\profile', 'BUCT'))
})

test('legacy profile migration completes before Electron initializes its session', async () => {
  const mainSource = await readFile(resolve(import.meta.dirname, '..', 'electron', 'main.mjs'), 'utf8')
  assert.match(mainSource, /migrateFromLegacyDir\(\)\.then\(\(\) => app\.whenReady\(\)\)/)
  assert.doesNotMatch(mainSource, /Promise\.all\(\[app\.whenReady\(\), migrateFromLegacyDir\(\)\]\)/)
})

test('legacy migration merges durable files and directories without overwriting or deleting old data', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-runtime-paths-'))
  const currentRoot = resolve(root, 'THEIA')
  const legacyRoot = resolve(root, 'BUCT')
  try {
    await Promise.all([
      mkdir(currentRoot, { recursive: true }),
      mkdir(legacyRoot, { recursive: true }),
    ])
    await writeFile(resolve(currentRoot, 'buct-data.json'), 'current', 'utf8')
    await writeFile(resolve(legacyRoot, 'buct-data.json'), 'legacy', 'utf8')
    await writeFile(resolve(legacyRoot, 'theia-feed.json'), 'feed', 'utf8')
    await mkdir(resolve(legacyRoot, 'data', 'objects', 'academic'), { recursive: true })
    await mkdir(resolve(legacyRoot, 'session', 'Partitions', 'theia', 'Local Storage'), { recursive: true })
    await mkdir(resolve(legacyRoot, 'session', 'Partitions', 'buct', 'Session Storage'), { recursive: true })
    await mkdir(resolve(legacyRoot, 'session', 'Code Cache'), { recursive: true })
    await mkdir(resolve(legacyRoot, 'course-work', 'assignment-1'), { recursive: true })
    await mkdir(resolve(legacyRoot, 'course-selection'), { recursive: true })
    await mkdir(resolve(legacyRoot, 'summaries'), { recursive: true })
    await writeFile(resolve(legacyRoot, 'data', 'manifest.json'), 'legacy-manifest', 'utf8')
    await writeFile(resolve(legacyRoot, 'data', 'objects', 'academic', 'fragment.json'), 'fragment', 'utf8')
    await writeFile(resolve(legacyRoot, 'data', '.write.lock'), 'stale lock', 'utf8')
    await writeFile(resolve(legacyRoot, 'session', 'Partitions', 'theia', 'Cookies'), 'cookies', 'utf8')
    await writeFile(resolve(legacyRoot, 'session', 'Partitions', 'theia', 'Local Storage', 'state'), 'local state', 'utf8')
    await writeFile(resolve(legacyRoot, 'session', 'Partitions', 'buct', 'Session Storage', 'legacy-session'), 'legacy partition', 'utf8')
    await writeFile(resolve(legacyRoot, 'session', 'Partitions', 'theia', 'LOCK'), 'stale lock', 'utf8')
    await writeFile(resolve(legacyRoot, 'session', 'Code Cache', 'cache'), 'cache', 'utf8')
    await writeFile(resolve(legacyRoot, 'course-work', 'assignment-1', 'task.md'), 'legacy task', 'utf8')
    await writeFile(resolve(legacyRoot, 'course-work', 'assignment-1', 'LOCK'), 'durable assignment lock', 'utf8')
    await mkdir(resolve(legacyRoot, 'course-work', 'assignment-1', 'Cache'), { recursive: true })
    await writeFile(resolve(legacyRoot, 'course-work', 'assignment-1', 'Cache', 'notes.txt'), 'durable cached notes', 'utf8')
    await writeFile(resolve(legacyRoot, 'course-selection', 'records.json'), 'legacy selection', 'utf8')
    await writeFile(resolve(legacyRoot, 'summaries', 'summary-legacy.md'), '# Legacy summary', 'utf8')
    await writeFile(resolve(legacyRoot, 'academic-api-credentials.v1.dpapi.json'), 'encrypted api', 'utf8')
    await writeFile(resolve(legacyRoot, 'credentials.v1.dpapi.json'), 'encrypted school login', 'utf8')
    await writeFile(resolve(legacyRoot, 'mail-credentials.v1.dpapi.json'), 'encrypted mail', 'utf8')
    await writeFile(resolve(legacyRoot, 'model-api-key.v1.dpapi.json'), 'encrypted model key', 'utf8')
    await mkdir(resolve(currentRoot, 'course-work', 'assignment-1'), { recursive: true })
    await writeFile(resolve(currentRoot, 'course-work', 'assignment-1', 'task.md'), 'current task', 'utf8')

    const migrated = await migrateLegacyDataFiles({ currentRoot, legacyRoot })
    assert.ok(migrated.some((item) => item.name === 'data'))
    assert.ok(migrated.some((item) => item.name === 'session'))
    assert.ok(migrated.some((item) => item.name === 'session/Partitions/buct -> session/Partitions/theia'))
    assert.ok(migrated.some((item) => item.name === 'course-selection'))
    assert.ok(migrated.some((item) => item.name === 'summaries'))
    assert.ok(migrated.some((item) => item.name === 'academic-api-credentials.v1.dpapi.json'))
    assert.equal(await readFile(resolve(currentRoot, 'buct-data.json'), 'utf8'), 'current')
    assert.equal(await readFile(resolve(currentRoot, 'theia-feed.json'), 'utf8'), 'feed')
    assert.equal(await readFile(resolve(currentRoot, 'data', 'manifest.json'), 'utf8'), 'legacy-manifest')
    assert.equal(await readFile(resolve(currentRoot, 'data', 'objects', 'academic', 'fragment.json'), 'utf8'), 'fragment')
    assert.equal(await readFile(resolve(currentRoot, 'session', 'Partitions', 'theia', 'Cookies'), 'utf8'), 'cookies')
    assert.equal(await readFile(resolve(currentRoot, 'session', 'Partitions', 'theia', 'Local Storage', 'state'), 'utf8'), 'local state')
    assert.equal(await readFile(resolve(currentRoot, 'session', 'Partitions', 'theia', 'Session Storage', 'legacy-session'), 'utf8'), 'legacy partition')
    assert.equal(await readFile(resolve(currentRoot, 'course-work', 'assignment-1', 'task.md'), 'utf8'), 'current task')
    assert.equal(await readFile(resolve(currentRoot, 'course-work', 'assignment-1', 'LOCK'), 'utf8'), 'durable assignment lock')
    assert.equal(await readFile(resolve(currentRoot, 'course-work', 'assignment-1', 'Cache', 'notes.txt'), 'utf8'), 'durable cached notes')
    assert.equal(await readFile(resolve(currentRoot, 'course-selection', 'records.json'), 'utf8'), 'legacy selection')
    assert.equal(await readFile(resolve(currentRoot, 'summaries', 'summary-legacy.md'), 'utf8'), '# Legacy summary')
    assert.equal(await readFile(resolve(currentRoot, 'academic-api-credentials.v1.dpapi.json'), 'utf8'), 'encrypted api')
    assert.equal(await readFile(resolve(currentRoot, 'credentials.v1.dpapi.json'), 'utf8'), 'encrypted school login')
    assert.equal(await readFile(resolve(currentRoot, 'mail-credentials.v1.dpapi.json'), 'utf8'), 'encrypted mail')
    assert.equal(await readFile(resolve(currentRoot, 'model-api-key.v1.dpapi.json'), 'utf8'), 'encrypted model key')
    await assert.rejects(access(resolve(currentRoot, 'data', '.write.lock')), { code: 'ENOENT' })
    await assert.rejects(access(resolve(currentRoot, 'session', 'Partitions', 'theia', 'LOCK')), { code: 'ENOENT' })
    await assert.rejects(access(resolve(currentRoot, 'session', 'Code Cache', 'cache')), { code: 'ENOENT' })
    assert.equal(await readFile(resolve(legacyRoot, 'buct-data.json'), 'utf8'), 'legacy')
    assert.equal(await readFile(resolve(legacyRoot, 'course-work', 'assignment-1', 'task.md'), 'utf8'), 'legacy task')
    assert.equal(await readFile(resolve(legacyRoot, 'summaries', 'summary-legacy.md'), 'utf8'), '# Legacy summary')
    assert.deepEqual(await migrateLegacyDataFiles({ currentRoot, legacyRoot }), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('legacy migration reports target conflicts without overwriting them', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-runtime-conflict-'))
  const currentRoot = resolve(root, 'THEIA')
  const legacyRoot = resolve(root, 'BUCT')
  try {
    await mkdir(resolve(legacyRoot, 'appearance'), { recursive: true })
    await mkdir(currentRoot, { recursive: true })
    await writeFile(resolve(legacyRoot, 'appearance', 'presets.json'), 'legacy preset', 'utf8')
    await writeFile(resolve(currentRoot, 'appearance'), 'current file', 'utf8')

    const migrated = await migrateLegacyDataFiles({ currentRoot, legacyRoot, files: ['appearance'] })
    assert.equal(migrated.length, 1)
    assert.equal(migrated[0].issues[0].kind, 'destination-type-conflict')
    assert.equal(await readFile(resolve(currentRoot, 'appearance'), 'utf8'), 'current file')
    assert.equal(await readFile(resolve(legacyRoot, 'appearance', 'presets.json'), 'utf8'), 'legacy preset')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('legacy migration keeps a pending model transaction with its state and vault cohort', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-runtime-model-transaction-'))
  const currentRoot = resolve(root, 'THEIA')
  const legacyRoot = resolve(root, 'BUCT')
  try {
    await mkdir(legacyRoot, { recursive: true })
    await writeFile(resolve(legacyRoot, 'buct-data.json'), 'legacy state', 'utf8')
    await writeFile(resolve(legacyRoot, 'model-api-key.v1.dpapi.json'), 'legacy encrypted model key', 'utf8')
    await writeFile(resolve(legacyRoot, 'model-config-transaction.v1.json'), 'pending model recovery journal', 'utf8')

    const migrated = await migrateLegacyDataFiles({
      currentRoot,
      legacyRoot,
      files: ['buct-data.json', 'model-api-key.v1.dpapi.json', 'model-config-transaction.v1.json'],
    })

    assert.equal(await readFile(resolve(currentRoot, 'buct-data.json'), 'utf8'), 'legacy state')
    assert.equal(await readFile(resolve(currentRoot, 'model-api-key.v1.dpapi.json'), 'utf8'), 'legacy encrypted model key')
    assert.equal(await readFile(resolve(currentRoot, 'model-config-transaction.v1.json'), 'utf8'), 'pending model recovery journal')
    assert.ok(migrated.some((entry) => entry.name === 'model-config-transaction.v1.json' && entry.filesCopied === 1))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('legacy migration never applies a pending model transaction to an existing current cohort', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-runtime-model-transaction-conflict-'))
  const currentRoot = resolve(root, 'THEIA')
  const legacyRoot = resolve(root, 'BUCT')
  try {
    await Promise.all([mkdir(currentRoot, { recursive: true }), mkdir(legacyRoot, { recursive: true })])
    await writeFile(resolve(currentRoot, 'buct-data.json'), 'current state', 'utf8')
    await writeFile(resolve(legacyRoot, 'buct-data.json'), 'legacy state', 'utf8')
    await writeFile(resolve(legacyRoot, 'model-api-key.v1.dpapi.json'), 'legacy encrypted model key', 'utf8')
    await writeFile(resolve(legacyRoot, 'model-config-transaction.v1.json'), 'pending legacy recovery journal', 'utf8')

    const migrated = await migrateLegacyDataFiles({ currentRoot, legacyRoot })

    assert.equal(migrated.length, 3)
    assert.ok(migrated.every((entry) => entry.issues[0].kind === 'transaction-cohort-conflict'))
    await assert.rejects(access(resolve(currentRoot, 'model-config-transaction.v1.json')), { code: 'ENOENT' })
    await assert.rejects(access(resolve(currentRoot, 'model-api-key.v1.dpapi.json')), { code: 'ENOENT' })
    assert.equal(await readFile(resolve(currentRoot, 'buct-data.json'), 'utf8'), 'current state')
    assert.equal(await readFile(resolve(legacyRoot, 'buct-data.json'), 'utf8'), 'legacy state')
    assert.equal(await readFile(resolve(legacyRoot, 'model-api-key.v1.dpapi.json'), 'utf8'), 'legacy encrypted model key')
    assert.equal(await readFile(resolve(legacyRoot, 'model-config-transaction.v1.json'), 'utf8'), 'pending legacy recovery journal')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('legacy migration never follows directory links outside either data root', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-runtime-links-'))
  const currentRoot = resolve(root, 'THEIA')
  const legacyRoot = resolve(root, 'BUCT')
  const sourceOutside = resolve(root, 'source-outside')
  const destinationOutside = resolve(root, 'destination-outside')
  try {
    await Promise.all([
      mkdir(resolve(legacyRoot, 'appearance'), { recursive: true }),
      mkdir(currentRoot, { recursive: true }),
      mkdir(sourceOutside, { recursive: true }),
      mkdir(destinationOutside, { recursive: true }),
    ])
    await writeFile(resolve(sourceOutside, 'source-secret.txt'), 'source secret', 'utf8')
    try {
      await symlink(sourceOutside, resolve(legacyRoot, 'appearance', 'linked-source'), process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (error?.code === 'EPERM') {
        t.skip('creating filesystem links is not permitted on this host')
        return
      }
      throw error
    }

    const sourceLinkResult = await migrateLegacyDataFiles({ currentRoot, legacyRoot, files: ['appearance'] })
    assert.equal(sourceLinkResult[0].issues[0].kind, 'source-link-skipped')
    await assert.rejects(access(resolve(currentRoot, 'appearance', 'linked-source', 'source-secret.txt')), { code: 'ENOENT' })

    await rm(resolve(currentRoot, 'appearance'), { recursive: true, force: true })
    await symlink(destinationOutside, resolve(currentRoot, 'appearance'), process.platform === 'win32' ? 'junction' : 'dir')
    const destinationLinkResult = await migrateLegacyDataFiles({ currentRoot, legacyRoot, files: ['appearance'] })
    assert.equal(destinationLinkResult[0].issues[0].kind, 'destination-type-conflict')
    await assert.rejects(access(resolve(destinationOutside, 'source-secret.txt')), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('legacy migration refuses a linked source root', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-runtime-root-link-'))
  const currentRoot = resolve(root, 'THEIA')
  const sourceOutside = resolve(root, 'source-outside')
  const legacyRoot = resolve(root, 'BUCT')
  try {
    await Promise.all([mkdir(currentRoot, { recursive: true }), mkdir(sourceOutside, { recursive: true })])
    await writeFile(resolve(sourceOutside, 'buct-data.json'), 'outside legacy data', 'utf8')
    try {
      await symlink(sourceOutside, legacyRoot, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (error?.code === 'EPERM') {
        t.skip('creating filesystem links is not permitted on this host')
        return
      }
      throw error
    }
    await assert.rejects(
      migrateLegacyDataFiles({ currentRoot, legacyRoot }),
      /legacy BUCT data root must be a real directory/,
    )
    await assert.rejects(access(resolve(currentRoot, 'buct-data.json')), { code: 'ENOENT' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('legacy course-work paths are rebased only when the copied destination exists', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-workspace-rebase-'))
  const currentRoot = resolve(root, 'THEIA')
  const legacyRoot = resolve(root, 'BUCT')
  try {
    const legacyWorkspace = resolve(legacyRoot, 'course-work', 'assignment-1')
    const currentWorkspace = resolve(currentRoot, 'course-work', 'assignment-1')
    await Promise.all([
      mkdir(currentWorkspace, { recursive: true }),
      mkdir(legacyWorkspace, { recursive: true }),
    ])
    await Promise.all([
      writeFile(resolve(currentWorkspace, 'manifest.json'), '{}', 'utf8'),
      writeFile(resolve(currentWorkspace, 'task.md'), 'task', 'utf8'),
      writeFile(resolve(legacyWorkspace, 'manifest.json'), '{}', 'utf8'),
      writeFile(resolve(legacyWorkspace, 'task.md'), 'legacy task', 'utf8'),
    ])
    const untouchedExternal = resolve(root, 'external-answer.json')
    const state = {
      workspaces: [{
        assignmentId: 'assignment-1',
        directory: legacyWorkspace,
        manifestPath: resolve(legacyWorkspace, 'manifest.json'),
        taskPath: resolve(legacyWorkspace, 'task.md'),
        answerKeyPath: resolve(legacyWorkspace, 'missing.json'),
        submissionPath: untouchedExternal,
      }],
    }

    const result = await rebaseLegacyWorkspacePaths(state, { currentRoot, legacyRoot })
    assert.equal(result.changed, true)
    assert.equal(result.pathsRebased, 3)
    assert.equal(result.state.workspaces[0].directory, currentWorkspace)
    assert.equal(result.state.workspaces[0].manifestPath, resolve(currentWorkspace, 'manifest.json'))
    assert.equal(result.state.workspaces[0].taskPath, resolve(currentWorkspace, 'task.md'))
    assert.equal(result.state.workspaces[0].answerKeyPath, resolve(legacyWorkspace, 'missing.json'))
    assert.equal(result.state.workspaces[0].submissionPath, untouchedExternal)
    assert.equal(state.workspaces[0].directory, legacyWorkspace)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('legacy course-work paths are not rebased through links or type conflicts', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-workspace-rebase-conflict-'))
  const currentRoot = resolve(root, 'THEIA')
  const legacyRoot = resolve(root, 'BUCT')
  const outsideRoot = resolve(root, 'outside')
  try {
    const legacyWorkspace = resolve(legacyRoot, 'course-work', 'assignment-1')
    const currentWorkspace = resolve(currentRoot, 'course-work', 'assignment-1')
    await Promise.all([
      mkdir(legacyWorkspace, { recursive: true }),
      mkdir(resolve(currentRoot, 'course-work'), { recursive: true }),
      mkdir(outsideRoot, { recursive: true }),
    ])
    await writeFile(resolve(legacyWorkspace, 'manifest.json'), '{}', 'utf8')
    await writeFile(resolve(outsideRoot, 'manifest.json'), '{}', 'utf8')
    try {
      await symlink(outsideRoot, currentWorkspace, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (error) {
      if (error?.code === 'EPERM') {
        t.skip('creating filesystem links is not permitted on this host')
        return
      }
      throw error
    }
    const state = { workspaces: [{ directory: legacyWorkspace, manifestPath: resolve(legacyWorkspace, 'manifest.json') }] }

    const result = await rebaseLegacyWorkspacePaths(state, { currentRoot, legacyRoot })
    assert.equal(result.changed, false)
    assert.equal(result.state, state)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('migrated sharded store workspaces remain usable by the course-work service', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-workspace-e2e-'))
  const currentRoot = resolve(root, 'THEIA')
  const legacyRoot = resolve(root, 'BUCT')
  const assignmentId = 'assignment-1234'
  const legacyWorkspace = resolve(legacyRoot, 'course-work', assignmentId)
  try {
    await mkdir(legacyWorkspace, { recursive: true })
    await writeFile(resolve(legacyWorkspace, 'manifest.json'), `${JSON.stringify({
      schema: 'theia-course-work/v1',
      assignment: { id: assignmentId },
    })}\n`, 'utf8')
    await writeFile(resolve(legacyWorkspace, 'task.md'), 'legacy task', 'utf8')

    const legacyStore = new CampusStore(legacyRoot)
    await legacyStore.load()
    await legacyStore.replace({
      ...legacyStore.snapshot(),
      assignments: [{ id: assignmentId, title: 'Migrated task', sourceUrl: 'https://course.example/task' }],
      workspaces: [{
        id: assignmentId,
        assignmentId,
        directory: legacyWorkspace,
        manifestPath: resolve(legacyWorkspace, 'manifest.json'),
        taskPath: resolve(legacyWorkspace, 'task.md'),
      }],
    })

    await migrateLegacyDataFiles({ currentRoot, legacyRoot })
    const currentStore = new CampusStore(currentRoot)
    await currentStore.load()
    const rebased = await rebaseLegacyWorkspacePaths(currentStore.snapshot(), { currentRoot, legacyRoot })
    assert.equal(rebased.changed, true)
    await currentStore.replace(rebased.state)

    const service = new CourseWorkService({ root: currentRoot, store: currentStore })
    const result = await service.readWorkspaceManifest(assignmentId)
    assert.equal(result.workspace.directory, resolve(currentRoot, 'course-work', assignmentId))
    assert.equal(result.manifest.assignment.id, assignmentId)
    assert.equal(await readFile(result.workspace.taskPath, 'utf8'), 'legacy task')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('closing an old local API cannot remove newer runtime metadata', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-api-lifecycle-'))
  const store = {
    snapshot: () => emptyState(),
    storageSummary: () => ({ schema: 'theia-sharded-store/v1', fragments: [] }),
  }
  let first
  let second
  try {
    first = await startLocalApi({ store, root, preferredPort: 21875 })
    second = await startLocalApi({ store, root, preferredPort: 21895 })
    const runtimePath = resolve(root, 'api-runtime.json')
    assert.equal(JSON.parse(await readFile(runtimePath, 'utf8')).port, second.port)

    await first.close()
    await first.close()
    assert.equal(JSON.parse(await readFile(runtimePath, 'utf8')).port, second.port)

    await second.close()
    await assert.rejects(readFile(runtimePath, 'utf8'), { code: 'ENOENT' })
  } finally {
    await first?.close().catch(() => undefined)
    await second?.close().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

test('settings transaction rolls back the full batch when local API restart fails', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-settings-rollback-'))
  const store = new CampusStore(root)
  let api
  try {
    await store.load()
    api = await startLocalApi({ store, root, preferredPort: 23875 })
    await store.update((state) => ({ ...state, settings: { ...state.settings, apiPort: api.port } }))
    const previousSettings = structuredClone(store.snapshot().settings)
    const syncConfigurations = []
    const mailConfigurations = []
    const published = []

    await assert.rejects(updateSettingsTransaction({
      store,
      next: {
        apiPort: 23925,
        autoSync: true,
        syncIntervalMinutes: 11,
        mail: { enabled: true, pollIntervalMinutes: 17 },
      },
      restartLocalApi: async () => { throw new Error('injected API restart failure') },
      configureAutoSync: (enabled, interval) => syncConfigurations.push({ enabled, interval }),
      configureMail: (settings) => mailConfigurations.push(structuredClone(settings)),
      publishSnapshot: (snapshot) => published.push(structuredClone(snapshot)),
    }), /injected API restart failure/)

    assert.deepEqual(store.snapshot().settings, previousSettings)
    assert.deepEqual(syncConfigurations.at(-1), {
      enabled: previousSettings.autoSync,
      interval: previousSettings.syncIntervalMinutes,
    })
    assert.deepEqual(mailConfigurations.at(-1), previousSettings.mail)
    assert.deepEqual(published.at(-1).settings, previousSettings)
    assert.equal(JSON.parse(await readFile(resolve(root, 'api-runtime.json'), 'utf8')).port, api.port)
    assert.equal((await fetch(`${api.baseUrl}/v1/health`)).status, 200)
  } finally {
    await api?.close().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

test('settings transaction persists advisor configuration updates without dropping sibling fields', async () => {
  const state = emptyState()
  const store = {
    snapshot: () => state,
    async update(mutator) {
      const next = await mutator(state)
      Object.assign(state, next)
      return next
    },
  }

  const snapshot = await updateSettingsTransaction({
    store,
    next: { advisorConfig: { budgetLevel: 'xhigh', temperature: 1.7 } },
    publishSnapshot: () => undefined,
  })

  assert.deepEqual(snapshot.settings.advisorConfig, {
    budgetLevel: 'xhigh',
    permissionMode: 'read-only',
    reasoningEffort: 'medium',
    responseStyle: 'balanced',
    responseLength: 'adaptive',
    temperature: 1.7,
  })
})

test('settings transaction persists the actual fallback API port', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-settings-fallback-'))
  const store = new CampusStore(root)
  const occupied = await import('node:net').then(({ createServer }) => createServer())
  let api
  try {
    await store.load()
    await new Promise((resolveListen, rejectListen) => {
      occupied.once('error', rejectListen)
      occupied.listen(0, '127.0.0.1', resolveListen)
    })
    const preferredPort = occupied.address().port
    const published = []
    const snapshot = await updateSettingsTransaction({
      store,
      next: { apiPort: preferredPort },
      restartLocalApi: async (port) => {
        api = await startLocalApi({ store, root, preferredPort: port })
        return api
      },
      publishSnapshot: (value) => published.push(structuredClone(value)),
    })

    assert.notEqual(api.port, preferredPort)
    assert.equal(snapshot.settings.apiPort, api.port)
    assert.equal(store.snapshot().settings.apiPort, api.port)
    assert.equal(published.at(-1).settings.apiPort, api.port)
    assert.equal(JSON.parse(await readFile(resolve(root, 'api-runtime.json'), 'utf8')).port, api.port)
  } finally {
    await api?.close().catch(() => undefined)
    await new Promise((resolveClose) => occupied.close(() => resolveClose()))
    await rm(root, { recursive: true, force: true })
  }
})
