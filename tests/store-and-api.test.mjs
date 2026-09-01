import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { CampusStore, CampusStoreRecoveryError } from '../core/store.mjs'
import { counts, normalizeState, toTheiaFeed, toIcs } from '../core/schema.mjs'
import { startLocalApi } from '../core/local-api.mjs'
import { cacheAcademicCalendarAssets, cacheFitnessResults, cacheSchoolScheduleResult } from '../core/data-catalog.mjs'
import { SyncService } from '../core/sync-service.mjs'
import { fetchTheiaFeed } from '../integration/theia-client.mjs'

function rawHttpRequest({ port, path = '/', method = 'GET', headers = {} }) {
  return new Promise((resolveRequest, rejectRequest) => {
    const request = httpRequest({ hostname: '127.0.0.1', port, path, method, headers }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolveRequest({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
    })
    request.on('error', rejectRequest)
    request.end()
  })
}

function authedFetch(api, url, init) {
  return fetch(url, { ...(init || {}), headers: { ...(init?.headers || {}), Authorization: `Bearer ${api.token}` } })
}

async function assertManifestReferences(root, manifest) {
  for (const [kind, reference] of Object.entries(manifest.fragments)) {
    const fragment = JSON.parse(await readFile(resolve(root, 'data', reference.path), 'utf8'))
    const valueDigest = createHash('sha256').update(JSON.stringify(fragment.value)).digest('hex')
    assert.equal(fragment.schema, 'theia-state-fragment/v1', kind)
    assert.equal(fragment.kind, kind)
    assert.equal(fragment.digest, valueDigest, kind)
    assert.equal(reference.digest, valueDigest, kind)
  }
}

test('store persists an atomic normalized snapshot and THEIA feed', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-store-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    await store.update((state) => ({ ...state, courses: [{ id: 'c1', title: '测试课程', source: 'theol' }] }))
    const reloaded = new CampusStore(root)
    const state = await reloaded.load()
    assert.equal(state.courses[0].title, '测试课程')
    assert.deepEqual(counts(state), { courses: 1, schedule: 0, exams: 0, grades: 0, selectedCourses: 0, assignments: 0, notices: 0, emails: 0, academicExtras: 0 })
    const feed = toTheiaFeed(state)
    assert.equal(feed.schema, 'theia-campus-feed/v1')
    assert.equal(feed.producer.name, 'THEIA')
    assert.equal(feed.events.length, 0)
    assert.match(toIcs(state), /BEGIN:VCALENDAR/)
    const manifest = JSON.parse(await readFile(resolve(root, 'data', 'manifest.json'), 'utf8'))
    assert.equal(manifest.schema, 'theia-sharded-store/v1')
    assert.ok(manifest.fragments['academic/courses'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('normalizing email state removes legacy or unsafe rich HTML before every data-flow projection', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-mail-flow-'))
  let api
  try {
    const store = new CampusStore(root)
    await store.load()
    await store.update((state) => ({
      ...state,
      emails: [
        {
          id: 'mail-legacy',
          subject: '旧缓存',
          body: '验证码 123456',
          bodyHtml: '<p>旧正文</p><img src="https://tracker.invalid/open">',
          bodyHtmlVersion: 3,
        },
        {
          id: 'mail-safe',
          subject: '安全正文',
          bodyHtml: '<p>保留的已净化正文</p>',
          bodyHtmlVersion: 4,
        },
        {
          id: 'mail-forged',
          subject: '伪造版本',
          bodyHtml: '<p>看似版本 4</p><img src="https://tracker.invalid/forged">',
          bodyHtmlVersion: 4,
        },
      ],
    }))
    const snapshot = store.snapshot()
    assert.equal(snapshot.emails[0].body, '验证码 123456')
    assert.equal(snapshot.emails[0].bodyHtml, null)
    assert.equal(snapshot.emails[0].bodyHtmlVersion, null)
    assert.equal(snapshot.emails[1].bodyHtml, '<p>保留的已净化正文</p>')
    assert.equal(snapshot.emails[1].bodyHtmlVersion, 4)
    assert.equal(snapshot.emails[2].bodyHtml, null)
    assert.equal(snapshot.emails[2].bodyHtmlVersion, null)

    const directFeed = JSON.stringify(toTheiaFeed(snapshot))
    assert.doesNotMatch(directFeed, /tracker\.invalid/)
    assert.match(directFeed, /保留的已净化正文/)

    api = await startLocalApi({ store, root, preferredPort: 19875 })
    const [collection, csv, fullSnapshot, feed] = await Promise.all([
      authedFetch(api, `${api.baseUrl}/v1/emails`).then((response) => response.json()),
      authedFetch(api, `${api.baseUrl}/v1/emails.csv`).then((response) => response.text()),
      authedFetch(api, `${api.baseUrl}/v1/snapshot`).then((response) => response.json()),
      authedFetch(api, `${api.baseUrl}/v1/feed`).then((response) => response.json()),
    ])
    for (const value of [collection, csv, fullSnapshot, feed]) assert.doesNotMatch(JSON.stringify(value), /tracker\.invalid/)
    assert.equal(collection.items[0].bodyHtml, null)
    assert.equal(fullSnapshot.emails[1].bodyHtmlVersion, 4)
    assert.equal(feed.localData.mail.messages[2].bodyHtml, null)
  } finally {
    await api?.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('academic data remains owned by JWGLXT when it temporarily fails', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-sync-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    await store.update((state) => ({
      ...state,
      courses: [
        { id: 'jw-old', title: '教务旧课程', source: 'jwglxt' },
        { id: 'theol-old', title: '平台旧课程', source: 'theol' },
      ],
      notices: [{ id: 'jw-notice', title: '教务通知', source: 'jwglxt' }],
    }))
    const service = new SyncService({
      store,
      jwglxt: { async sync() { throw new Error('temporary JW failure') }, async status() { return { connected: false } } },
      theol: { async sync() { return { courses: [{ id: 'theol-new', title: '平台新课程', source: 'theol' }], assignments: [], notices: [{ id: 'theol-notice', title: '平台通知', source: 'theol' }], errors: [], source: { connected: true } } }, async status() { return { connected: true } } },
    })
    const state = await service.syncNow()
    assert.deepEqual(state.courses.map((item) => item.id).sort(), ['jw-old', 'theol-new'])
    assert.deepEqual(state.notices.map((item) => item.id).sort(), ['jw-notice', 'theol-notice'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('sync errors are redacted before persistence and loopback API exposure', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-sync-redaction-'))
  const secret = 'sync-secret-value'
  const localPath = 'C:\\Users\\Student\\AppData\\Roaming\\THEIA\\private.json'
  let api
  try {
    const store = new CampusStore(root)
    await store.load()
    const injected = `request https://alice:${secret}@jwglxt.buct.edu.cn/query?token=${secret}#session failed; Authorization: Bearer ${secret}; file ${localPath}`
    const service = new SyncService({
      store,
      jwglxt: { async sync() { throw new Error(injected) }, async status() { return { connected: false } } },
      theol: {
        async sync() {
          return {
            assignments: [],
            errors: [`password=${secret} at ${localPath}`],
            source: { connected: false, error: `Cookie: JSESSIONID=${secret}` },
          }
        },
        async status() { return { connected: false } },
      },
    })
    await service.syncNow()

    const reloaded = new CampusStore(root)
    const persisted = await reloaded.load()
    const persistedText = JSON.stringify(persisted.sync)
    assert.equal(persistedText.includes(secret), false)
    assert.equal(persistedText.includes(localPath), false)
    assert.equal(persistedText.includes('?token='), false)
    assert.match(persisted.sync.lastError, /\[redacted\]|\[local-path\]/)
    assert.equal(persisted.sync.sources.jwglxt.error.includes(secret), false)
    assert.equal(persisted.sync.sources.theol.error.includes(secret), false)

    api = await startLocalApi({ store: reloaded, root, preferredPort: 19735, publishRuntime: false })
    const [syncResponse, snapshotResponse] = await Promise.all([
      authedFetch(api, `${api.baseUrl}/v1/sync`).then((response) => response.text()),
      authedFetch(api, `${api.baseUrl}/v1/snapshot`).then((response) => response.text()),
    ])
    for (const response of [syncResponse, snapshotResponse]) {
      assert.equal(response.includes(secret), false)
      assert.equal(response.includes(localPath), false)
      assert.equal(response.includes('?token='), false)
    }
  } finally {
    await api?.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('store migrates a legacy snapshot and updates only affected fragments', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-sharded-store-'))
  try {
    await writeFile(resolve(root, 'buct-data.json'), JSON.stringify({ courses: [{ id: 'legacy-course', title: 'Legacy course' }] }), 'utf8')
    const store = new CampusStore(root)
    await store.load()
    const first = JSON.parse(await readFile(resolve(root, 'data', 'manifest.json'), 'utf8'))
    await store.update((state) => ({ ...state, notices: [{ id: 'notice-1', title: 'Only this changes' }] }))
    const second = JSON.parse(await readFile(resolve(root, 'data', 'manifest.json'), 'utf8'))
    assert.equal(store.snapshot().courses[0].id, 'legacy-course')
    assert.equal(first.fragments['academic/courses'].digest, second.fragments['academic/courses'].digest)
    assert.notEqual(first.fragments['communication/notices'].digest, second.fragments['communication/notices'].digest)
    assert.ok(second.legacy.retainedForMigration)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('store restores a positioned legacy timetable when the active shard contains only course-list rows', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-schedule-repair-'))
  try {
    await writeFile(resolve(root, 'buct-data.json'), JSON.stringify({
      schedule: [{ id: 'positioned', termId: '2025-3', title: 'Positioned course', weekday: 1, period: '1-2', weeks: '1-16周' }],
    }), 'utf8')
    const seeded = new CampusStore(root)
    await seeded.load()
    await seeded.update((state) => ({
      ...state,
      schedule: [{ id: 'course-list-row', termId: '2025-3', title: 'Unpositioned row', weekday: null, period: null, weeks: null }],
    }))

    const recovered = new CampusStore(root)
    const state = await recovered.load()
    assert.deepEqual(state.schedule.map((item) => item.id), ['positioned'])
    assert.equal(recovered.storageSummary().recovery.source, 'legacy-positioned-schedule')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('versioned snapshots bind state, revision, commit time, and stable domain digests', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-versioned-snapshot-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    await store.update((state) => ({
      ...state,
      courses: [{ id: 'course-1', title: 'Evidence course' }],
    }))
    const before = store.snapshotWithRevision()
    assert.equal(before.state.courses[0].id, 'course-1')
    assert.match(before.revision, /^[0-9a-f-]{36}$/i)
    assert.ok(Number.isFinite(Date.parse(before.committedAt)))
    assert.match(before.domainDigests.courses, /^[a-f0-9]{64}$/)

    await store.update((state) => ({
      ...state,
      settings: { ...state.settings, autoSync: !state.settings.autoSync },
    }))
    const after = store.snapshotWithRevision()
    assert.notEqual(after.revision, before.revision)
    assert.equal(after.domainDigests.courses, before.domainDigests.courses)
    assert.equal(after.domainDigests.schedule, before.domainDigests.schedule)

    before.state.courses[0].title = 'mutated outside store'
    assert.equal(store.snapshot().courses[0].title, 'Evidence course')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('versioned snapshots reject an uncommitted cold store instead of inventing a revision', () => {
  const store = new CampusStore(resolve(tmpdir(), 'theia-unloaded-versioned-snapshot'))
  assert.throws(() => store.snapshotWithRevision(), /must be loaded/i)
})

test('store opens a pre-academic-extras manifest and supplies the new empty fragment', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-optional-extras-fragment-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    const manifestPath = resolve(root, 'data', 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    delete manifest.fragments['academic/extras']
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

    const reloaded = new CampusStore(root)
    const state = await reloaded.load()
    assert.deepEqual(state.academicExtras.domains, {})
    assert.equal(reloaded.snapshotWithRevision().state.academicExtras.schema, 'theia-jwglxt-extras/v1')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('store falls back to the previous manifest when the newest manifest is damaged', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-manifest-recovery-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    await store.update((state) => ({ ...state, courses: [{ id: 'course-1', title: 'Recovered course' }] }))
    await store.update((state) => ({ ...state, notices: [{ id: 'notice-1', title: 'Newest snapshot' }] }))
    await writeFile(resolve(root, 'data', 'manifest.json'), '{broken', 'utf8')
    const recovered = new CampusStore(root)
    const state = await recovered.load()
    assert.equal(state.courses[0].id, 'course-1')
    assert.deepEqual(state.notices, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('store republishes a missing primary manifest with a new revision without rotating the backup', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-missing-manifest-recovery-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    await store.update((state) => ({ ...state, courses: [{ id: 'course-1', title: 'Backup course' }] }))
    await store.update((state) => ({ ...state, notices: [{ id: 'notice-1', title: 'Primary-only notice' }] }))
    const manifestPath = resolve(root, 'data', 'manifest.json')
    const backupPath = resolve(root, 'data', 'manifest.json.bak')
    const backupBefore = await readFile(backupPath)
    const backupManifest = JSON.parse(backupBefore.toString('utf8'))
    await rm(manifestPath)

    const recovered = new CampusStore(root)
    const state = await recovered.load()
    const repairedManifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    assert.equal(state.courses[0].id, 'course-1')
    assert.deepEqual(state.notices, [])
    assert.equal(recovered.storageSummary().recovery.source, 'backup')
    assert.notEqual(repairedManifest.revision, backupManifest.revision)
    assert.equal(recovered.snapshotWithRevision().revision, repairedManifest.revision)
    assert.deepEqual(await readFile(backupPath), backupBefore)
    await assertManifestReferences(root, repairedManifest)
    await assertManifestReferences(root, backupManifest)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('overlapping updates on one store preserve both changes', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-store-concurrent-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    let releaseFirst
    let markFirstStarted
    const firstStarted = new Promise((resolveStarted) => { markFirstStarted = resolveStarted })
    const firstGate = new Promise((resolveGate) => { releaseFirst = resolveGate })
    const first = store.update(async (state) => {
      markFirstStarted()
      await firstGate
      state.courses = [{ id: 'course-1', title: 'Concurrent course' }]
    })
    await firstStarted
    const second = store.update((state) => {
      state.notices = [{ id: 'notice-1', title: 'Concurrent notice' }]
    })
    releaseFirst()
    await Promise.all([first, second])
    assert.equal(store.snapshot().courses[0].id, 'course-1')
    assert.equal(store.snapshot().notices[0].id, 'notice-1')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('updates from separate store instances reload the latest committed state', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-store-multiprocess-'))
  try {
    const firstStore = new CampusStore(root)
    const secondStore = new CampusStore(root)
    await Promise.all([firstStore.load(), secondStore.load()])
    let releaseFirst
    let markFirstStarted
    const firstStarted = new Promise((resolveStarted) => { markFirstStarted = resolveStarted })
    const firstGate = new Promise((resolveGate) => { releaseFirst = resolveGate })
    const first = firstStore.update(async (state) => {
      markFirstStarted()
      await firstGate
      state.grades = [{ id: 'grade-1', title: 'Concurrent grade' }]
    })
    await firstStarted
    const second = secondStore.update((state) => {
      state.exams = [{ id: 'exam-1', title: 'Concurrent exam' }]
    })
    releaseFirst()
    await Promise.all([first, second])
    const reloaded = new CampusStore(root)
    const state = await reloaded.load()
    assert.equal(state.grades[0].id, 'grade-1')
    assert.equal(state.exams[0].id, 'exam-1')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('store recovers one damaged newest fragment without discarding other newest fragments', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-fragment-recovery-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    await store.update((state) => ({ ...state, courses: [{ id: 'course-1', title: 'Retained newest course' }] }))
    await store.update((state) => ({ ...state, notices: [{ id: 'notice-1', title: 'Damaged newest notice' }] }))
    const manifestPath = resolve(root, 'data', 'manifest.json')
    const backupPath = resolve(root, 'data', 'manifest.json.bak')
    const damagedManifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    const backupBefore = await readFile(backupPath)
    const backupManifest = JSON.parse(backupBefore.toString('utf8'))
    await writeFile(resolve(root, 'data', damagedManifest.fragments['communication/notices'].path), '{damaged', 'utf8')

    const recovered = new CampusStore(root)
    const state = await recovered.load()
    const versioned = recovered.snapshotWithRevision()
    const repairedManifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    assert.equal(state.courses[0].id, 'course-1')
    assert.deepEqual(state.notices, [])
    assert.deepEqual(recovered.storageSummary().recovery.fallbackFragments, ['communication/notices'])
    assert.notEqual(repairedManifest.revision, damagedManifest.revision)
    assert.notEqual(repairedManifest.revision, backupManifest.revision)
    assert.equal(versioned.revision, repairedManifest.revision)
    assert.equal(versioned.committedAt, repairedManifest.updatedAt)
    assert.deepEqual(versioned.state, state)
    assert.equal(repairedManifest.fragments['academic/courses'].digest, damagedManifest.fragments['academic/courses'].digest)
    assert.equal(repairedManifest.fragments['communication/notices'].digest, backupManifest.fragments['communication/notices'].digest)
    assert.deepEqual(await readFile(backupPath), backupBefore)
    await assertManifestReferences(root, repairedManifest)
    await assertManifestReferences(root, backupManifest)

    const reloaded = new CampusStore(root)
    const reloadedState = await reloaded.load()
    assert.equal(reloaded.snapshotWithRevision().revision, repairedManifest.revision)
    assert.deepEqual(reloadedState, versioned.state)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('store recovers missing and damaged dynamic school-schedule fragments from the backup manifest', async () => {
  const scenarios = ['missing-reference', 'damaged-object']
  for (const scenario of scenarios) {
    const root = await mkdtemp(resolve(tmpdir(), `theia-dynamic-fragment-${scenario}-`))
    try {
      const store = new CampusStore(root)
      await store.load()
      await store.update((state) => ({
        ...state,
        dataCatalog: cacheSchoolScheduleResult(state.dataCatalog, {
          scope: { termId: '2026-3' },
          complete: true,
          total: 1,
          items: [{ id: 'old-row', title: 'Backup schedule row' }],
          capturedAt: '2026-08-12T01:00:00.000Z',
        }),
      }))
      await store.update((state) => ({
        ...state,
        dataCatalog: cacheSchoolScheduleResult(state.dataCatalog, {
          scope: { termId: '2026-3' },
          complete: true,
          total: 1,
          items: [{ id: 'new-row', title: 'Newest schedule row' }],
          capturedAt: '2026-08-12T02:00:00.000Z',
        }),
        notices: [{ id: 'newest-notice', title: 'Retain newest unrelated state' }],
      }))

      const manifestPath = resolve(root, 'data', 'manifest.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      const backup = JSON.parse(await readFile(resolve(root, 'data', 'manifest.json.bak'), 'utf8'))
      const key = Object.keys(manifest.fragments).find((item) => item.startsWith('catalog/school-schedule/'))
      assert.ok(key)
      assert.notEqual(manifest.fragments[key].digest, backup.fragments[key].digest)
      if (scenario === 'missing-reference') {
        delete manifest.fragments[key]
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
      } else {
        await writeFile(resolve(root, 'data', manifest.fragments[key].path), '{damaged', 'utf8')
      }

      const recovered = new CampusStore(root)
      const state = await recovered.load()
      const records = Object.values(state.dataCatalog.collections.schoolSchedule.records)
      assert.equal(records[0].items[0].title, 'Backup schedule row', scenario)
      assert.equal(state.notices[0].id, 'newest-notice', scenario)
      assert.deepEqual(recovered.storageSummary().recovery.fallbackFragments, [key], scenario)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
})

test('store does not revive a deliberately removed dynamic school-schedule fragment', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-dynamic-fragment-removal-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    await store.update((state) => ({
      ...state,
      dataCatalog: cacheSchoolScheduleResult(state.dataCatalog, {
        scope: { termId: '2026-3' },
        complete: true,
        total: 1,
        items: [{ id: 'removed-row', title: 'Deliberately removed row' }],
      }),
    }))
    await store.update((state) => ({
      ...state,
      dataCatalog: {
        ...state.dataCatalog,
        collections: {
          ...state.dataCatalog.collections,
          schoolSchedule: { ...state.dataCatalog.collections.schoolSchedule, records: {} },
        },
      },
    }))

    const manifest = JSON.parse(await readFile(resolve(root, 'data', 'manifest.json'), 'utf8'))
    assert.equal(manifest.removedFragments.length, 1)
    assert.match(manifest.removedFragments[0], /^catalog\/school-schedule\//)
    const reloaded = new CampusStore(root)
    const state = await reloaded.load()
    assert.deepEqual(state.dataCatalog.collections.schoolSchedule.records, {})
    assert.equal(reloaded.storageSummary().recovery, null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an incomplete newest manifest falls back instead of filling missing state with defaults', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-incomplete-manifest-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    await store.update((state) => ({ ...state, grades: [{ id: 'grade-1', title: 'Retained grade' }] }))
    await store.update((state) => ({ ...state, notices: [{ id: 'notice-1', title: 'Newest notice' }] }))
    const manifestPath = resolve(root, 'data', 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    delete manifest.fragments['academic/grades']
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

    const recovered = new CampusStore(root)
    const state = await recovered.load()
    assert.equal(state.grades[0].id, 'grade-1')
    assert.deepEqual(state.notices, [])
    assert.equal(recovered.storageSummary().recovery.source, 'backup')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('unrecoverable shared fragment leaves both manifests byte-for-byte unchanged', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-unrecoverable-fragment-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    await store.update((state) => ({ ...state, courses: [{ id: 'course-1', title: 'Existing course' }] }))
    const manifestPath = resolve(root, 'data', 'manifest.json')
    const backupPath = resolve(root, 'data', 'manifest.json.bak')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    const backup = JSON.parse(await readFile(backupPath, 'utf8'))
    assert.equal(manifest.fragments['state/profile'].path, backup.fragments['state/profile'].path)
    await writeFile(resolve(root, 'data', manifest.fragments['state/profile'].path), '{damaged', 'utf8')
    const manifestBefore = await readFile(manifestPath)
    const backupBefore = await readFile(backupPath)

    const damaged = new CampusStore(root)
    await assert.rejects(
      damaged.load(),
      (error) => error instanceof CampusStoreRecoveryError && error.missingFragments.includes('state/profile'),
    )
    assert.deepEqual(await readFile(manifestPath), manifestBefore)
    assert.deepEqual(await readFile(backupPath), backupBefore)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('API GPA summary does not erase a previously captured degree-plan tree', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-progress-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    await store.update((state) => ({
      ...state,
      academicProgress: {
        gpa: 2.5,
        categories: [{ id: 'foundation', title: '公共基础必修', required: 60, earned: 30 }],
        roots: [{ id: 'foundation', title: '公共基础必修', required: 60, earned: 30 }],
      },
    }))
    const service = new SyncService({
      store,
      jwglxt: {
        async sync() {
          return {
            academicProgress: { gpa: 2.75, courseCounts: { planned: { total: 160, passed: 31, failed: 4, notTaken: 125, studying: 0 }, outsidePlan: { passed: 0, failed: 0 } }, categories: [] },
            courses: [], grades: [], selectedCourses: [], schedule: [], exams: [], notices: [], errors: [], source: { connected: true },
          }
        },
        async status() { return { connected: true } },
      },
      theol: { async sync() { return { assignments: [], errors: [], source: { connected: true } } }, async status() { return { connected: true } } },
    })
    const state = await service.syncNow()
    assert.equal(state.academicProgress.gpa, 2.75)
    assert.equal(state.academicProgress.roots[0].id, 'foundation')
    assert.equal(state.academicProgress.categories[0].id, 'foundation')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('schedule accent colors are stable per course within a term', () => {
  const state = normalizeState({
    schedule: [
      { id: 'a-1', termId: '2025-3', courseId: 'CHE14000G', title: 'Chemistry', weekday: 1, period: '1-2' },
      { id: 'a-2', termId: '2025-3', courseId: 'CHE14000G', title: 'Chemistry', weekday: 3, period: '3-4' },
      { id: 'b-1', termId: '2025-3', courseId: 'MAT14000G', title: 'Mathematics', weekday: 2, period: '1-2' },
      { id: 'c-1', termId: '2024-3', courseId: 'CHE14000G', title: 'Chemistry', weekday: 1, period: '1-2' },
    ],
  })
  const [first, repeated, differentCourse] = state.schedule
  assert.ok(first.color)
  assert.equal(first.color, repeated.color)
  assert.notEqual(first.color, differentCourse.color)
  assert.equal(normalizeState(state).schedule[0].color, first.color)
})

test('academic sync commits the schedule before a slow course-platform scan completes', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-partial-sync-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    let releaseTheol
    const theolGate = new Promise((resolveGate) => { releaseTheol = resolveGate })
    let observeAcademicCommit
    const academicCommitted = new Promise((resolveCommit) => { observeAcademicCommit = resolveCommit })
    const service = new SyncService({
      store,
      jwglxt: {
        async sync() {
          return {
            courses: [{ id: 'jw-course', title: '同步课表课程', source: 'jwglxt' }],
            schedule: [{ id: 'schedule-1', title: '同步课表课程', termId: '2026-3', source: 'jwglxt' }],
            grades: [], selectedCourses: [], exams: [], notices: [], errors: [], source: { connected: true },
          }
        },
        async status() { return { connected: true } },
      },
      theol: {
        async sync() { await theolGate; return { assignments: [], errors: [], source: { connected: true } } },
        async status() { return { connected: true } },
      },
      onChange: (state) => { if (state.schedule.some((item) => item.id === 'schedule-1')) observeAcademicCommit() },
    })

    const pending = service.syncNow()
    await academicCommitted
    assert.equal(store.snapshot().schedule[0].title, '同步课表课程')
    releaseTheol()
    await pending
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('loopback API exposes read-only collections and THEIA feed', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-api-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    await store.update((state) => ({
      ...state,
      notices: [{ id: 'n1', title: '公告', source: 'jwglxt' }],
      emails: [{ id: 'mail-1', subject: '校园邮箱测试', from: '教务处', receivedAt: '2026-08-11T01:00:00.000Z', source: 'imap' }],
      selectedCourses: [{ id: 'sc1', title: '已选课程', source: 'jwglxt' }],
      academicProgress: { gpa: 3.2, categories: [] },
      academicExtras: {
        ...state.academicExtras,
        domains: {
          ...state.academicExtras.domains,
          'academic-plan': {
            label: '培养方案与教学执行计划',
            routeCodes: ['N153540'],
            sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/jxzxjhgl/jxzxjhck_cxJxzxjhckIndex.html',
            capturedAt: '2026-08-11T01:00:00.000Z',
            completeness: 'complete',
            queryStats: { attempted: 1, succeeded: 1, failed: 0, capped: false },
            records: [{
              id: 'extra-1', title: '高等数学 A', courseCode: 'MAT13904T',
              fields: [{ name: 'courseCode', label: '课程代码', value: 'MAT13904T' }],
              source: 'jwglxt', sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/design/viewFunc.html',
              routeCode: 'N219933', capturedAt: '2026-08-11T01:00:00.000Z',
            }],
            attachments: [], filters: [], messages: [],
          },
        },
      },
      dataCatalog: cacheFitnessResults(state.dataCatalog, {
        yearKey: '2025-2026_1',
        vitality: 4684,
        availableYears: [{ yearKey: '2025-2026_1', label: '2025（1）' }],
      }, '2026-08-11T01:00:00.000Z'),
    }))
    await store.update((state) => ({
      ...state,
      dataCatalog: cacheSchoolScheduleResult(state.dataCatalog, {
        scope: { termId: '2026-3', keyword: '高等数学' },
        total: 1,
        items: [{ classId: 'JXB-01', courseCode: 'MAT13904T', title: '高等数学 A', className: '高分子 01', combinedClassInfo: '高材 2401、高材 2402', teacher: '李老师', time: '星期一第1-2节' }],
      }, '2026-08-11T01:00:00.000Z'),
    }))
    const api = await startLocalApi({ store, root, preferredPort: 19675 })
    try {
      const health = await authedFetch(api, `${api.baseUrl}/v1/health`).then((response) => response.json())
      // Origin: null (any file:// page) is no longer authorized, even with a valid token.
      const packagedOrigin = await rawHttpRequest({
        port: api.port,
        path: '/v1/health',
        headers: { Host: `127.0.0.1:${api.port}`, Origin: 'null', Authorization: `Bearer ${api.token}` },
      })
      assert.equal(packagedOrigin.status, 403)
      assert.deepEqual(JSON.parse(packagedOrigin.body), { error: 'origin_not_allowed' })
      const packagedPreflight = await rawHttpRequest({
        port: api.port,
        path: '/v1/health',
        method: 'OPTIONS',
        headers: { Host: `127.0.0.1:${api.port}`, Origin: 'null' },
      })
      assert.equal(packagedPreflight.status, 403)
      // A hostile cross-site Origin on a real request is rejected before touching data.
      const foreignOrigin = await rawHttpRequest({
        port: api.port,
        path: '/v1/health',
        headers: { Host: `127.0.0.1:${api.port}`, Origin: 'http://attacker.example', Authorization: `Bearer ${api.token}` },
      })
      assert.equal(foreignOrigin.status, 403)
      assert.deepEqual(JSON.parse(foreignOrigin.body), { error: 'origin_not_allowed' })
      // A local dev-server origin is allowed and echoes the origin back (with token).
      const localOrigin = await rawHttpRequest({
        port: api.port,
        path: '/v1/health',
        headers: { Host: `127.0.0.1:${api.port}`, Origin: 'http://127.0.0.1:5174', Authorization: `Bearer ${api.token}` },
      })
      assert.equal(localOrigin.status, 200)
      assert.match(localOrigin.body, /"ok":true/)
      const rebound = await rawHttpRequest({
        port: api.port,
        path: '/v1/snapshot',
        headers: { Host: `attacker.example:${api.port}`, Origin: `http://attacker.example:${api.port}` },
      })
      assert.equal(rebound.status, 421)
      assert.deepEqual(JSON.parse(rebound.body), { error: 'host_not_allowed' })
      const reboundPreflight = await rawHttpRequest({
        port: api.port,
        path: '/v1/snapshot',
        method: 'OPTIONS',
        headers: { Host: `attacker.example:${api.port}`, Origin: `http://attacker.example:${api.port}` },
      })
      assert.equal(reboundPreflight.status, 421)
      const dataManifest = await authedFetch(api, `${api.baseUrl}/v1/data-manifest`).then((response) => response.json())
      const notices = await authedFetch(api, `${api.baseUrl}/v1/notices`).then((response) => response.json())
      const profile = await authedFetch(api, `${api.baseUrl}/v1/profile`).then((response) => response.json())
      const sync = await authedFetch(api, `${api.baseUrl}/v1/sync`).then((response) => response.json())
      const collections = await authedFetch(api, `${api.baseUrl}/v1/collections`).then((response) => response.json())
      const noticesCsv = await authedFetch(api, `${api.baseUrl}/v1/notices.csv`).then((response) => response.text())
      const emails = await authedFetch(api, `${api.baseUrl}/v1/emails`).then((response) => response.json())
      const workspaces = await authedFetch(api, `${api.baseUrl}/v1/workspaces`).then((response) => response.json())
      const selectedCourses = await authedFetch(api, `${api.baseUrl}/v1/selected-courses`).then((response) => response.json())
      const academicProgress = await authedFetch(api, `${api.baseUrl}/v1/academic-progress`).then((response) => response.json())
      const academicAnalysis = await authedFetch(api, `${api.baseUrl}/v1/academic-analysis`).then((response) => response.json())
      const feed = await authedFetch(api, `${api.baseUrl}/v1/feed`).then((response) => response.json())
      const fitness = await authedFetch(api, `${api.baseUrl}/v1/fitness?year=2025-2026_1`).then((response) => response.json())
      const schoolSchedule = await authedFetch(api, `${api.baseUrl}/v1/school-schedule?termId=2026-3&keyword=${encodeURIComponent('高等数学')}`).then((response) => response.json())
      const academicExtras = await authedFetch(api, `${api.baseUrl}/v1/academic-extras/academic-plan?q=${encodeURIComponent('高等数学')}&limit=1`).then((response) => response.json())
      const ignoredAcademicExtra = await authedFetch(api, `${api.baseUrl}/v1/academic-extras/academic-warning`)
      const removedAcademicExtra = await authedFetch(api, `${api.baseUrl}/v1/academic-extras/jwglxt-school-schedule`)
      const missingAcademicExtra = await authedFetch(api, `${api.baseUrl}/v1/academic-extras/not-a-domain`)
      const clientFeed = await fetchTheiaFeed({ baseUrl: api.baseUrl, token: api.token })
      assert.equal(health.ok, true)
      assert.equal(dataManifest.schema, 'theia-sharded-store/v1')
      assert.ok(dataManifest.fragments.includes('academic/grades'))
      assert.equal(profile.item, null)
      assert.ok(sync.item)
      assert.ok(collections.collections.some((collection) => collection.name === 'emails'))
      assert.equal(notices.items.length, 1)
      assert.equal(notices.total, 1)
      assert.match(noticesCsv, /title/)
      assert.equal(emails.items[0].subject, '校园邮箱测试')
      assert.deepEqual(workspaces.items, [])
      assert.equal(selectedCourses.items[0].title, '已选课程')
      assert.equal(academicProgress.item.gpa, 3.2)
      assert.equal(academicAnalysis.schema, 'theia-academic-analysis-response/v1')
      assert.equal(academicAnalysis.item.schema, 'theia-academic-analysis/v1')
      assert.equal(academicAnalysis.item.gpa.value, 3.2)
      assert.equal(feed.academic.selectedCourses.length, 1)
      assert.equal(feed.schema, 'theia-campus-feed/v1')
      assert.equal(feed.localData.collections.fitness.records['2025-2026_1'].normalized.vitality, 4684)
      assert.equal(fitness.item.vitality, 4684)
      assert.equal(fitness.summary.cachedYears[0], '2025-2026_1')
      assert.equal(schoolSchedule.item.items[0].courseCode, 'MAT13904T')
      assert.equal(schoolSchedule.item.items[0].classId, 'JXB-01')
      assert.equal(schoolSchedule.item.items[0].className, '高分子 01')
      assert.equal(schoolSchedule.item.items[0].combinedClassInfo, '高材 2401、高材 2402')
      assert.equal(academicExtras.schema, 'theia-jwglxt-extra-table/v1')
      assert.equal(academicExtras.total, 0)
      assert.equal(ignoredAcademicExtra.status, 404)
      assert.equal(removedAcademicExtra.status, 404)
      assert.equal(missingAcademicExtra.status, 404)
      assert.equal(clientFeed.schema, 'theia-campus-feed/v1')
      const write = await authedFetch(api, `${api.baseUrl}/v1/snapshot`, { method: 'POST' })
      assert.equal(write.status, 405)
    } finally {
      await api.close()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('loopback API streams locally cached academic-calendar assets', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-calendar-api-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    const assetsRoot = resolve(root, 'academic-calendar', 'assets')
    await mkdir(assetsRoot, { recursive: true })
    await writeFile(resolve(assetsRoot, 'calendar_current.jpg'), Buffer.alloc(1200, 4))
    await writeFile(resolve(assetsRoot, 'teaching_schedule_current.pdf'), Buffer.from('%PDF-1.7'))
    const manifest = {
      schema: 'theia-academic-calendar-assets/v1', updatedAt: '2026-08-12T00:00:00.000Z', assets: {
        calendar: { filename: 'calendar_current.jpg', fetchedAt: '2026-08-12T00:00:00.000Z', nextRefreshAfter: '2026-09-01T00:00:00.000Z', bytes: 1200 },
        teachingSchedule: { filename: 'teaching_schedule_current.pdf', fetchedAt: '2026-08-12T00:00:00.000Z', nextRefreshAfter: '2026-09-01T00:00:00.000Z', bytes: 8 },
      },
    }
    await store.update((state) => ({ ...state, dataCatalog: cacheAcademicCalendarAssets(state.dataCatalog, manifest) }))
    const calendarService = { snapshot: () => ({ ...manifest, root }), pathFor: (key) => key === 'calendar' ? resolve(assetsRoot, 'calendar_current.jpg') : key === 'teachingSchedule' ? resolve(assetsRoot, 'teaching_schedule_current.pdf') : null }
    const api = await startLocalApi({ store, root, preferredPort: 19725, academicCalendarAssetsService: calendarService })
    try {
      const metadata = await authedFetch(api, `${api.baseUrl}/v1/academic-calendar`).then((response) => response.json())
      const image = await authedFetch(api, `${api.baseUrl}/v1/academic-calendar/calendar`)
      const pdf = await authedFetch(api, `${api.baseUrl}/v1/academic-calendar/teaching-schedule`)
      assert.equal(metadata.assets.calendar.filename, 'calendar_current.jpg')
      assert.equal(image.headers.get('content-type'), 'image/jpeg')
      assert.equal((await image.arrayBuffer()).byteLength, 1200)
      assert.equal(pdf.headers.get('content-type'), 'application/pdf')
      assert.equal((await pdf.arrayBuffer()).byteLength, 8)
    } finally {
      await api.close()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('normalizing an older snapshot reports the current application version', () => {
  assert.equal(normalizeState({ appVersion: '0.1.0' }).appVersion, '0.7.1')
})
