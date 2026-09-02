import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { CampusStore } from '../core/store.mjs'
import { startLocalApi } from '../core/local-api.mjs'

function authedFetch(api, url, init) {
  return fetch(url, { ...(init || {}), headers: { ...(init?.headers || {}), Authorization: `Bearer ${api.token}` } })
}
import {
  projectUserDataDomainSummary,
  projectUserDataOverview,
  projectUserDataRecords,
  projectRendererSnapshot,
} from '../core/user-data-view.mjs'

function fixtureState() {
  return {
    terms: [{ id: '2026-3', label: '2026-2027 第一学期', year: 2026, term: '3', current: true }, { id: '2025-16', label: '2025-2026 第三学期', year: 2025, term: '16' }],
    courses: [{ id: 'course-1', code: 'MAT001', title: '高等数学', teacher: '教师', termId: '2026-3', credits: 4, sourceUrl: 'https://example.invalid/raw' }],
    grades: [
      { id: 'grade-1', termId: '2026-3', courseCode: 'MAT001', courseName: '高等数学', score: 91, credits: 4, raw: '<html>hidden</html>', studentInternalId: 'secret-internal' },
      { id: 'grade-2', termId: '2025-16', courseCode: 'PHY001', courseName: '大学物理', score: 88, credits: 3 },
    ],
    assignments: [{ id: 'task-1', courseId: 'course-1', courseName: '高等数学', title: '作业一', dueAt: '2026-08-18T10:00:00.000Z', status: 'pending', source: 'theol' }],
    exams: [{ id: 'exam-1', termId: '2026-3', courseName: '高等数学', examTime: '2026-08-19T10:00:00.000Z', location: '教室' }],
    academicExtras: { domains: { 'grade-details': { label: '成绩明细', capturedAt: '2026-08-17T00:00:00.000Z', completeness: 'complete', records: [{ id: 'detail-1', title: '高等数学', fields: [{ name: 'status', label: '状态', value: '正常' }, { name: 'studentInternalId', label: '内部 ID', value: 'hidden' }, { name: 'details', label: '详情', value: { rawHtml: 'hidden', visible: '保留' } }] }], attachments: [{ id: 'detail-pdf', label: '成绩明细附件.pdf', type: 'application/pdf', filename: '成绩明细附件.pdf', bytes: 4096, sha256: 'abc123', cached: true, sourceUrl: 'https://example.invalid/private.pdf' }] } } },
    sync: { lastRunAt: '2026-08-17T00:00:00.000Z', lastSuccessAt: '2026-08-17T00:00:00.000Z', domains: { grades: { status: 'succeeded', completeness: 'complete', capturedAt: '2026-08-17T00:00:00.000Z' } } },
  }
}

test('user data projection prioritizes current records and hides transport fields', () => {
  const state = fixtureState()
  const overview = projectUserDataOverview(state, { now: Date.parse('2026-08-17T00:00:00.000Z'), snapshotRevision: 'r1' })
  assert.equal(overview.schema, 'theia-user-data-view/v1')
  assert.equal(overview.currentTerm.id, '2026-3')
  assert.equal(overview.attentionItems[0].id, 'task-1')
  assert.ok(overview.sections.some((section) => section.domain === 'grades' && section.count === 2))
  assert.doesNotMatch(JSON.stringify(overview), /studentInternalId|sourceUrl|rawHtml|rawJson/)
  assert.ok(overview.sections.some((section) => section.domain === 'courses'))
  assert.ok(overview.sections.some((section) => section.domain === 'emails'))
  assert.equal(overview.extraDomains.find((domain) => domain.domain === 'grade-details').label, '成绩明细')
})

test('records are bounded, searchable, and current-term first', () => {
  const state = fixtureState()
  const first = projectUserDataRecords(state, 'grades', { limit: 1, scope: 'all' })
  assert.equal(first.total, 2)
  assert.equal(first.items.length, 1)
  assert.equal(first.items[0].id, 'grade-1')
  assert.equal(first.items[0].label, '高等数学')
  assert.equal(first.items[0].sourceUrl, undefined)
  assert.equal(first.items[0].raw, undefined)
  assert.equal(first.items[0].studentInternalId, undefined)
  assert.equal(first.hasMore, true)
  const second = projectUserDataRecords(state, 'grades', { limit: 1, scope: 'all', cursor: first.nextCursor })
  assert.equal(second.items[0].id, 'grade-2')
  assert.equal(projectUserDataRecords(state, 'grades', { query: '大学物理', scope: 'all' }).total, 1)
})

test('extra domains retain readable labels without exposing internal field names', () => {
  const summary = projectUserDataDomainSummary(fixtureState(), 'grade-details', { now: Date.parse('2026-08-17T01:00:00.000Z') })
  assert.equal(summary.label, '成绩明细')
  const records = projectUserDataRecords(fixtureState(), 'grade-details', { scope: 'all' })
  const detail = records.items.find((item) => item.recordKind === 'record')
  assert.equal(detail.attributes[0].label, '状态')
  assert.doesNotMatch(JSON.stringify(records), /studentInternalId|hidden/)
  assert.doesNotMatch(JSON.stringify(records), /rawHtml/)
  const attachment = records.items.find((item) => item.recordKind === 'attachment')
  assert.equal(attachment.attachment.filename, '成绩明细附件.pdf')
  assert.equal(attachment.attachment.cached, true)
  assert.equal(attachment.attachment.bytes, 4096)
  assert.equal(attachment.sourceUrl, undefined)
  assert.equal(summary.count, 2)
})

test('extra record type filtering is applied before pagination', () => {
  const state = fixtureState()
  state.academicExtras.domains['grade-details'].records.push(
    { id: 'detail-2', title: '另一条', recordType: 'status-row', recordTypeLabel: '状态行', fields: [{ name: 'status', label: '状态', value: '正常' }] },
    { id: 'detail-3', title: '第三条', recordType: 'detail-row', recordTypeLabel: '详情行', fields: [{ name: 'status', label: '状态', value: '正常' }] },
  )
  const page = projectUserDataRecords(state, 'grade-details', { recordType: 'status-row', limit: 1, scope: 'all' })
  assert.equal(page.total, 1)
  assert.equal(page.items.length, 1)
  assert.equal(page.items[0].recordType, 'status-row')
})

test('user projection marks explicit pending work overdue and sorts numeric term values', () => {
  const state = fixtureState()
  state.terms = [
    { id: '2026-3', label: '低', year: 2026, term: '3' },
    { id: '2026-16', label: '高', year: 2026, term: '16' },
  ]
  state.assignments = [{ id: 'late', courseName: '高等数学', title: '逾期任务', dueAt: '2026-08-01T10:00:00.000Z', status: 'pending' }]
  const records = projectUserDataRecords(state, 'assignments', { scope: 'all', now: Date.parse('2026-08-17T00:00:00.000Z') })
  assert.equal(records.items[0].status, 'overdue')
  assert.equal(records.items[0].statusLabel, '已逾期')
  assert.equal(projectUserDataOverview(state).currentTerm.id, '2026-16')
})

test('overview stays bounded when a collection contains a very large history', () => {
  const state = fixtureState()
  state.notices = Array.from({ length: 20_000 }, (_value, index) => ({
    id: `notice-${index}`,
    title: `通知 ${index}`,
    publishedAt: '2026-08-17T00:00:00.000Z',
  }))
  state.sync.lastError = "错误 ".repeat(100_000)
  const overview = projectUserDataOverview(state, { now: Date.parse('2026-08-17T01:00:00.000Z') })
  assert.ok(Buffer.byteLength(JSON.stringify(overview), 'utf8') < 65_536)
  assert.equal(overview.sync.lastError.length, 500)
  const page = projectUserDataRecords(state, 'notices', { scope: 'all', limit: 1_000 })
  assert.equal(page.items.length, 100)
  assert.equal(page.total, 20_000)
  assert.equal(page.hasMore, true)
})

test('renderer snapshot strips large renderer-only collections but keeps counts and mail metadata', () => {
  const state = fixtureState()
  state.academicExtras.domains['course-selection'] = {
    label: '选课目标',
    records: [{ id: 'selection-1', courseName: '高等数学', componentScore: 92 }],
    attachments: [],
  }
  state.dataCatalog = { collections: { schoolSchedule: { records: { term: { rows: [1, 2] } } } } }
  state.emails = [{ id: 'mail-1', subject: '主题', body: '正文', bodyHtml: '<p>正文</p>', bodyHtmlVersion: 4 }]
  const rendered = projectRendererSnapshot(state)
  assert.deepEqual(rendered.academicExtras.domains['course-selection'].records, [])
  assert.equal(rendered.academicExtras.domains['course-selection'].recordCount, 1)
  assert.equal(rendered.academicExtras.domains['grade-details'].records.length, 1)
  assert.equal(rendered.academicExtras.domains['grade-details'].recordCount, 1)
  assert.deepEqual(rendered.dataCatalog.collections.schoolSchedule.records, {})
  assert.equal(rendered.dataCatalog.collections.schoolSchedule.recordCount, 1)
  assert.equal(rendered.emails[0].body, null)
  assert.equal(rendered.emails[0].bodyHtml, null)
  assert.equal(state.emails[0].body, '正文')
})

test('renderer snapshot keeps the current free-classroom result for the tool view', () => {
  const state = fixtureState()
  state.academicExtras.domains['free-classroom'] = {
    label: '空闲教室',
    capturedAt: '2026-09-02T08:08:50.346Z',
    completeness: 'complete',
    records: [{ id: 'room-1', classroom: 'D-404' }],
    attachments: [],
  }
  const rendered = projectRendererSnapshot(state)
  assert.equal(rendered.academicExtras.domains['free-classroom'].recordCount, 1)
  assert.equal(rendered.academicExtras.domains['free-classroom'].records[0].classroom, 'D-404')
  assert.equal(rendered.academicExtras.domains['free-classroom'].capturedAt, '2026-09-02T08:08:50.346Z')
})

test('local API exposes bounded user views without removing compatibility snapshot', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-user-view-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    await store.update((state) => ({ ...state, ...fixtureState() }))
    const api = await startLocalApi({ store, root, preferredPort: 19875, renderTableImage: async (html) => Buffer.from(`mock-png:${html.length}:${html.slice(0, 80)}`) })
    try {
      const overview = await authedFetch(api, `${api.baseUrl}/v1/overview`).then((response) => response.json())
      const summary = await authedFetch(api, `${api.baseUrl}/v1/domain-summary/grades`).then((response) => response.json())
      const page = await authedFetch(api, `${api.baseUrl}/v1/records/grades?scope=all&limit=1`).then((response) => response.json())
      const snapshot = await authedFetch(api, `${api.baseUrl}/v1/snapshot`).then((response) => response.json())
      assert.equal(overview.view, 'overview')
      assert.equal(summary.domain, 'grades')
      assert.equal(typeof summary.snapshotRevision, 'string')
      assert.equal(page.items.length, 1)
      assert.equal(page.hasMore, true)
      assert.equal(snapshot.courses[0].title, '高等数学')

      const tableImage = await authedFetch(api, `${api.baseUrl}/v1/table-image?domain=grade-details`).then(async (response) => {
        const type = response.headers.get('content-type')
        const buffer = await response.arrayBuffer()
        return { type, size: buffer.byteLength, ok: response.ok }
      })
      assert.equal(tableImage.ok, true)
      assert.equal(tableImage.type, 'image/png')
      assert.ok(tableImage.size > 0)
      assert.match(Buffer.from(await authedFetch(api, `${api.baseUrl}/v1/table-image?domain=nonexistent`).then((r) => r.arrayBuffer())).toString('utf8'), /table_image_unavailable/)

      const unknownImage = await authedFetch(api, `${api.baseUrl}/v1/table-image`).then((r) => ({ ok: r.ok, status: r.status }))
      assert.equal(unknownImage.ok, false)
      assert.equal(unknownImage.status, 404)
    } finally {
      await api.close()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
