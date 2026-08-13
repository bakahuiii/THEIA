import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createAiExportBundle, sanitizeForAiExport, writeAiExport } from '../core/ai-export.mjs'
import { normalizeState } from '../core/schema.mjs'

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

function fixtureState() {
  return normalizeState({
    appVersion: '0.4.0-test',
    updatedAt: '2026-08-12T03:00:00.000Z',
    profile: { name: 'Test Student', studentId: '2024TEST01', academicTrack: 'Materials' },
    terms: [{ id: '2024-3', year: 2024, term: '3', label: '2024-2025 First semester' }],
    courses: [{ id: 'course-1', code: 'MAT10001T', termId: '2024-3', title: 'Calculus', source: 'https://jwglxt.buct.edu.cn/jwglxt/source?token=do-not-export', sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/course?token=do-not-export' }],
    schedule: [{ id: 'schedule-1', termId: '2024-3', courseId: 'course-1', title: 'Calculus', weekday: 1, period: '1-2' }],
    grades: [{ id: 'grade-1', termId: '2024-3', courseName: 'Calculus', courseCode: 'MAT10001T', score: '94', credits: 4, point: 4, sourceUrl: 'https://jwglxt.buct.edu.cn/grade?cookie=do-not-export' }],
    selectedCourses: [{ id: 'selected-1', termId: '2024-3', title: 'Calculus', sourceUrl: 'https://jwglxt.buct.edu.cn/select?ticket=do-not-export' }],
    academicProgress: {
      gpa: 4,
      capturedAt: '2026-08-12T02:59:00.000Z',
      roots: [{ id: 'root', title: 'Degree plan', required: 100, relation: 'and', children: [{ id: 'alternative', title: 'Choose one', required: 2, relation: 'or', courses: [] }] }],
      categories: [],
      sourceUrl: 'https://jwglxt.buct.edu.cn/plan?code=do-not-export',
    },
    assignments: [{ id: 'assignment-1', title: 'Homework one', courseName: 'Calculus', dueAt: '2026-08-20T00:00:00.000Z', status: 'pending', sourceUrl: 'https://course.buct.edu.cn/task?token=do-not-export' }],
    workspaces: [{
      id: 'assignment-1', assignmentId: 'assignment-1', title: 'Homework one', kind: 'assignment', state: 'model-ready',
      directory: 'C:\\Users\\Test\\THEIA\\course-work\\assignment-1', manifestPath: 'C:\\Users\\Test\\THEIA\\course-work\\assignment-1\\manifest.json',
      modelAnswerPath: 'C:\\Users\\Test\\THEIA\\course-work\\assignment-1\\answer.md', sourceUrl: 'https://course.buct.edu.cn/task?code=do-not-export',
      lastError: 'token=do-not-export at C:\\Users\\Test\\THEIA\\course-work\\assignment-1',
    }],
    notices: [{ id: 'notice-1', title: 'Notice', summary: 'Read this', source: 'theol', sourceUrl: 'https://course.buct.edu.cn/notice?auth=do-not-export' }],
    emails: [{
      id: 'mail-1', uid: 42, subject: 'Mail title', from: 'Registrar', receivedAt: '2026-08-12T01:00:00.000Z',
      bodyHtml: '<p>Hello <strong>student</strong></p><img src="https://tracker.invalid/open">', remoteMarker: 'must-not-export',
      attachments: [{ index: 0, filename: 'notice.pdf', contentType: 'application/pdf', size: 1024 }], source: 'imap',
    }, {
      id: 'mail-2', subject: 'Secure link', from: 'Registrar', receivedAt: '2026-08-12T01:01:00.000Z',
      body: 'Open https://mail.example.invalid/message?ticket=do-not-export#read from C:\\Users\\Test\\mail.html', source: 'imap',
    }],
    dataCatalog: {
      updatedAt: '2026-08-12T02:00:00.000Z',
      collections: {
        fitness: { availableYears: [{ yearKey: '2025-2026_1', label: '2025' }], records: { '2025-2026_1': { source: 'tygl', capturedAt: '2026-08-12T01:00:00.000Z', normalized: { yearKey: '2025-2026_1', vitality: 100 } } } },
        schoolSchedule: { records: { '2024-3': { source: 'jwglxt', capturedAt: '2026-08-12T01:30:00.000Z', complete: true, items: [{ id: 'school-1', title: 'Calculus' }] } } },
        academicCalendar: { lastRefreshedAt: '2026-08-12T01:45:00.000Z', calendarError: 'read https://calendar.buct.edu.cn/a?token=do-not-export from C:\\Users\\Test\\calendar.pdf', calendar: { schoolYear: '2024-2025', semesters: [{ label: 'First', startDate: '2024-09-02', endDate: '2025-01-12', weeks: 19 }] } },
      },
    },
    sync: {
      lastStartedAt: '2026-08-12T02:58:00.000Z',
      lastCompletedAt: '2026-08-12T02:59:00.000Z',
      lastRunAt: '2026-08-12T02:59:00.000Z',
      lastSuccessAt: '2026-08-12T02:50:00.000Z',
      lastError: 'request https://jwglxt.buct.edu.cn/x?token=do-not-export failed',
      sources: { jwglxt: { connected: true, url: 'https://jwglxt.buct.edu.cn/x?token=do-not-export' } },
    },
    settings: { modelApiKey: 'do-not-export', mailPassword: 'do-not-export' },
  })
}

test('AI export bundle covers all advisor domains and removes credentials, paths, rich HTML, and URL query data', () => {
  const bundle = createAiExportBundle({
    state: fixtureState(),
    courseSelection: {
      updatedAt: '2026-08-12T02:00:00.000Z',
      targets: [{ id: 'target-1', title: 'Calculus', courseCode: 'MAT10001T', operationId: 'must-not-export', cookie: 'must-not-export' }],
      sentinel: { enabled: true, startAt: '2026-08-20T00:00:00.000Z', endAt: '2026-08-20T03:00:00.000Z', token: 'must-not-export' },
      history: [{ kind: 'job', status: 'failed', candidate: { title: 'Calculus', operationId: 'must-not-export' }, lastMessage: 'cookie=must-not-export' }],
    },
    generatedAt: '2026-08-12T03:01:02.000Z',
  })
  const names = [...bundle.files.keys()].sort()
  assert.equal(names.length, 19)
  // The expected domains are explicit, rather than relying on a brittle total.
  for (const name of ['manifest.json', 'AI_CONTEXT.md', 'DATA_DICTIONARY.md', 'profile.json', 'academic.json', 'schedule.json', 'grades.json', 'academic-progress.json', 'exams.json', 'coursework.json', 'notices.json', 'mailbox.json', 'fitness.json', 'school-schedule.json', 'calendar.json', 'course-selection.json', 'sync.json', 'local-data-catalog.json', 'provenance.json']) assert.ok(bundle.files.has(name), name)

  const allContent = [...bundle.files.values()].join('\n')
  for (const forbidden of ['do-not-export', 'C:\\Users\\Test', 'remoteMarker', '"uid"', 'bodyHtml', 'operationId', '"cookie"']) {
    assert.equal(allContent.includes(forbidden), false, `${forbidden}: ${[...bundle.files.entries()].filter(([, content]) => content.includes(forbidden)).map(([name]) => name).join(', ')}`)
  }
  const mailbox = JSON.parse(bundle.files.get('mailbox.json'))
  assert.equal(mailbox.data[0].body, 'Hello student')
  assert.equal(mailbox.data[1].body.includes('do-not-export'), false)
  assert.equal(mailbox.data[1].body.includes('https://mail.example.invalid/message'), true)
  assert.equal(mailbox.data[1].body.includes('local-path'), true)
  assert.equal(mailbox.data[0].attachments[0].filename, 'notice.pdf')
  const workspace = JSON.parse(bundle.files.get('coursework.json')).data.workspaces[0]
  assert.equal(workspace.hasModelAnswer, true)
  assert.equal('directory' in workspace, false)
  assert.equal(workspace.lastError.includes('local-path'), true)
  const calendar = JSON.parse(bundle.files.get('calendar.json'))
  assert.equal(calendar.data.calendarError.includes('do-not-export'), false)
  assert.equal(calendar.data.calendarError.includes('local-path'), true)
  const academic = JSON.parse(bundle.files.get('academic.json'))
  assert.deepEqual(academic.data.courses[0].source, 'https://jwglxt.buct.edu.cn/jwglxt/source')
  assert.equal(academic.sources.includes('https://jwglxt.buct.edu.cn/jwglxt/source'), true)
  assert.equal(academic.sources.some((source) => source.includes('?')), false)
  const synchronization = JSON.parse(bundle.files.get('sync.json'))
  assert.equal(synchronization.updatedAt, '2026-08-12T02:59:00.000Z')
  assert.equal(synchronization.data.lastRunAt, '2026-08-12T02:59:00.000Z')
  assert.equal(synchronization.data.lastSuccessAt, '2026-08-12T02:50:00.000Z')
  assert.match(bundle.files.get('provenance.json'), /lastSuccessAt/)
  assert.equal(bundle.manifest.schema, 'theia-ai-export-manifest/v1')
  assert.equal(bundle.manifest.exportSchema, 'theia-ai-context/v1')
})

test('AI export manifest hashes exactly the non-manifest files and writes a collision-safe directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theia-ai-export-'))
  try {
    const result = await writeAiExport({ state: fixtureState(), destinationRoot: root, generatedAt: '2026-08-12T03:01:02.000Z' })
    const manifest = JSON.parse(await readFile(resolve(result.directory, 'manifest.json'), 'utf8'))
    assert.equal(manifest.files.length, 18)
    for (const file of manifest.files) {
      const content = await readFile(resolve(result.directory, file.path), 'utf8')
      assert.equal(digest(content), file.sha256, file.path)
    }
    const second = await writeAiExport({ state: fixtureState(), destinationRoot: root, generatedAt: '2026-08-12T03:01:02.000Z' })
    assert.notEqual(second.directory, result.directory)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('sanitizer handles sensitive camelCase keys and normalizes URL-valued provenance', () => {
  const clean = sanitizeForAiExport({
    apiKey: 'x',
    protocolPassword: 'y',
    sessionId: 'z',
    source: 'https://example.invalid/provenance?anything=private#fragment',
    sources: ['imap', 'https://example.invalid/secondary?ticket=private'],
    normal: { sourceUrl: 'https://example.invalid/a?anything=private#fragment' },
  })
  assert.deepEqual(clean, {
    source: 'https://example.invalid/provenance',
    sources: ['imap', 'https://example.invalid/secondary'],
    normal: { sourceUrl: 'https://example.invalid/a' },
  })
})

test('AI export never treats object metadata fields as record counts and redacts source-like sensitive text', () => {
  const bundle = createAiExportBundle({
    state: fixtureState(),
    generatedAt: '2026-08-12T03:01:02.000Z',
  })
  const manifest = JSON.parse(bundle.files.get('manifest.json'))
  assert.equal(manifest.availability.profile.records, 1)
  assert.equal(manifest.availability.academic.records, 3)
  assert.equal(manifest.availability.academicProgress.records, 1)
  assert.equal(manifest.availability.calendar.records, 1)

  const clean = sanitizeForAiExport({
    source: 'https://example.invalid/provenance?token=private',
    sourceLabel: 'mirror token=private at C:\\Users\\Student\\THEIA',
    sourceScheme: 'file:///C:/Users/Student/secret.txt',
    lastError: 'Authorization: Bearer abc.def-ghi and sessionId=private',
    secondaryError: 'Authorization=Basic cHJpdmF0ZQ==',
  })
  assert.equal(clean.source, 'https://example.invalid/provenance')
  assert.equal(clean.sourceLabel.includes('private'), false)
  assert.equal(clean.sourceLabel.includes('C:\\Users\\Student'), false)
  assert.equal(clean.sourceScheme, null)
  assert.equal(clean.lastError.includes('abc.def-ghi'), false)
  assert.equal(clean.lastError.includes('private'), false)
  assert.equal(clean.secondaryError.includes('cHJpdmF0ZQ'), false)

  const empty = JSON.parse(createAiExportBundle({ state: {}, generatedAt: '2026-08-12T03:01:02.000Z' }).files.get('manifest.json'))
  assert.equal(empty.availability.academic.records, 0)
  assert.equal(empty.availability.academic.state, 'partial')
  assert.equal(empty.availability.coursework.records, 0)
  assert.equal(empty.availability.courseSelection.records, 0)
})

test('AI export does not use global state updatedAt as domain freshness', () => {
  const state = fixtureState()
  state.academicProgress.capturedAt = null
  state.sync.domains = {}
  const bundle = createAiExportBundle({ state, generatedAt: '2026-08-12T03:01:02.000Z' })
  for (const name of ['profile.json', 'academic.json', 'schedule.json', 'grades.json', 'academic-progress.json', 'exams.json', 'coursework.json', 'notices.json', 'mailbox.json']) {
    assert.notEqual(JSON.parse(bundle.files.get(name)).updatedAt, state.updatedAt, name)
  }
  assert.equal(JSON.parse(bundle.files.get('profile.json')).updatedAt, null)
})

test('AI export never promotes record timestamps to a dataset watermark', () => {
  const state = fixtureState()
  state.sync.domains = {}
  state.assignments[0].capturedAt = '2026-08-12T02:58:00.000Z'
  state.notices[0].publishedAt = '2026-08-12T02:59:00.000Z'
  state.emails[0].receivedAt = '2026-08-12T03:00:00.000Z'
  state.dataCatalog.collections.fitness.lastRefreshedAt = '2026-08-12T03:00:00.000Z'
  state.dataCatalog.collections.academicCalendar.lastRefreshedAt = '2026-08-12T03:00:00.000Z'

  const bundle = createAiExportBundle({ state, generatedAt: '2026-08-12T03:01:02.000Z' })
  for (const name of ['coursework.json', 'notices.json', 'mailbox.json', 'fitness.json', 'calendar.json']) {
    assert.equal(JSON.parse(bundle.files.get(name)).updatedAt, null, name)
  }
})

test('AI export catalog domains require provenance before claiming available or empty', () => {
  for (const state of [fixtureState(), normalizeState({ dataCatalog: { collections: {} } })]) {
    state.sync.domains = {}
    const bundle = createAiExportBundle({ state, generatedAt: '2026-08-12T03:01:02.000Z' })
    for (const name of ['fitness.json', 'school-schedule.json', 'calendar.json', 'local-data-catalog.json']) {
      const dataset = JSON.parse(bundle.files.get(name))
      assert.equal(dataset.completeness, 'partial', name)
      assert.equal(dataset.updatedAt, null, name)
    }
    for (const key of ['fitness', 'schoolSchedule', 'calendar']) {
      assert.equal(bundle.manifest.availability[key].state, 'partial', key)
    }
  }
})

test('AI export catalog domains use complete, partial, and retained-empty provenance conservatively', () => {
  const state = fixtureState()
  state.sync.domains = {
    fitness: { completeness: 'complete', contentEmptyConfirmed: false, capturedAt: '2026-08-12T01:00:00.000Z' },
    'school-schedule': { completeness: 'partial', contentEmptyConfirmed: false, capturedAt: '2026-08-12T01:30:00.000Z' },
    'academic-calendar': { completeness: 'complete', contentEmptyConfirmed: false, capturedAt: '2026-08-12T01:45:00.000Z' },
    'local-data-catalog': { completeness: 'partial', contentEmptyConfirmed: false, capturedAt: '2026-08-12T01:00:00.000Z' },
  }
  let bundle = createAiExportBundle({ state, generatedAt: '2026-08-12T03:01:02.000Z' })
  assert.equal(JSON.parse(bundle.files.get('fitness.json')).completeness, 'available')
  assert.equal(JSON.parse(bundle.files.get('fitness.json')).updatedAt, '2026-08-12T01:00:00.000Z')
  assert.equal(JSON.parse(bundle.files.get('school-schedule.json')).completeness, 'partial')
  assert.equal(JSON.parse(bundle.files.get('calendar.json')).completeness, 'available')
  assert.equal(JSON.parse(bundle.files.get('local-data-catalog.json')).completeness, 'partial')
  assert.equal(JSON.parse(bundle.files.get('local-data-catalog.json')).updatedAt, '2026-08-12T01:00:00.000Z')

  state.dataCatalog.collections.fitness.records = {}
  state.sync.domains.fitness = {
    completeness: 'complete', contentEmptyConfirmed: true, emptyConfirmed: false,
    status: 'failed', capturedAt: '2026-08-10T01:00:00.000Z', sourceSucceededAt: '2026-08-10T01:00:00.000Z',
  }
  bundle = createAiExportBundle({ state, generatedAt: '2026-08-12T03:01:02.000Z' })
  const retainedEmpty = JSON.parse(bundle.files.get('fitness.json'))
  assert.equal(retainedEmpty.completeness, 'empty')
  assert.equal(retainedEmpty.updatedAt, '2026-08-10T01:00:00.000Z')
  assert.equal(bundle.manifest.availability.fitness.state, 'empty')

  state.dataCatalog.collections.fitness.records = { contradictory: { normalized: { vitality: 1 } } }
  bundle = createAiExportBundle({ state, generatedAt: '2026-08-12T03:01:02.000Z' })
  assert.equal(JSON.parse(bundle.files.get('fitness.json')).completeness, 'partial')
  assert.equal(bundle.manifest.availability.fitness.state, 'partial')
})

test('AI export sanitizes secrets, URLs, and local paths hidden in ordinary text fields', () => {
  const secret = 'AUDIT-SECRET-5b3f'
  const state = fixtureState()
  state.profile.name = `Student token=${secret}`
  state.assignments[0].title = `Open https://example.invalid/read?token=${secret}#x`
  state.assignments[0].description = `Bearer ${secret} at C:\\Users\\Audit\\private.txt`
  state.emails[0].subject = `Reset token=${secret}`
  state.emails[0].snippet = `Open https://example.invalid/read?ticket=${secret}#x`
  state.emails[0].attachments[0].filename = `token=${secret}.txt`

  const bundle = createAiExportBundle({ state, generatedAt: '2026-08-12T03:01:02.000Z' })
  const allContent = [...bundle.files.values()].join('\n')
  assert.equal(allContent.includes(secret), false)
  assert.equal(allContent.includes('C:\\Users\\Audit'), false)

  const profile = JSON.parse(bundle.files.get('profile.json')).data
  const coursework = JSON.parse(bundle.files.get('coursework.json')).data
  const mailbox = JSON.parse(bundle.files.get('mailbox.json')).data
  assert.equal(profile.name, 'Student token=[redacted]')
  assert.equal(coursework.assignments[0].title, 'Open https://example.invalid/read')
  assert.match(coursework.assignments[0].description, /Bearer \[redacted\]/)
  assert.match(coursework.assignments[0].description, /\[local-path\]/)
  assert.equal(mailbox[0].subject, 'Reset token=[redacted]')
  assert.equal(mailbox[0].snippet, 'Open https://example.invalid/read')
  assert.equal(mailbox[0].attachments[0].filename, 'token=[redacted]')
})
