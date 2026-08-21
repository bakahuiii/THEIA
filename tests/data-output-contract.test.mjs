import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyState } from '../core/schema.mjs'
import { DATA_OUTPUT_SCHEMA, PUBLIC_DATA_DOMAINS, projectTheiaDataDomain, toTheiaDataOutput } from '../core/data-output-contract.mjs'
import { cacheMotionVenueCatalog, cacheMotionVenueStatus } from '../core/data-catalog.mjs'
import { startLocalApi } from '../core/local-api.mjs'

test('public data output has one stable shape and excludes unsupported domains', () => {
  const state = emptyState()
  state.profile = { id: 'profile-1', name: '张三', password: 'must-not-leak', sourceUrl: 'https://private.invalid' }
  state.courses = [{ id: 'course-1', title: '数据结构', rawHtml: '<script>bad</script>' }]
  state.academicExtras.domains['academic-warning'] = { records: [{ id: 'warning-1' }] }

  const output = toTheiaDataOutput(state, { snapshotRevision: 'r1', domains: ['profile', 'courses', 'academic-warning'] })
  assert.equal(output.schema, DATA_OUTPUT_SCHEMA)
  assert.deepEqual(Object.keys(output.domains), ['profile', 'courses'])
  assert.equal(output.domains.profile.data.password, undefined)
  assert.equal(output.domains.profile.data.sourceUrl, undefined)
  assert.equal(output.domains.courses.data[0].rawHtml, undefined)
  assert.equal(output.domains.courses.recordCount, 1)
})

test('public data output exposes plan and catalog as domains without local paths', () => {
  const state = emptyState()
  state.academicPlanDocument = {
    schema: 'theia-academic-plan-document/v1',
    sourceFilename: 'plan.pdf',
    pages: [{ number: 1, text: '培养方案' }],
    parsedAt: '2026-08-18T00:00:00.000Z',
  }
  state.dataCatalog.collections.academicCalendar = {
    updatedAt: '2026-08-18T00:00:00.000Z',
    assets: { calendar: { filename: 'calendar.jpg', root: 'H:\\secret' } },
    calendar: { schoolYear: '2026-2027' },
  }
  const plan = projectTheiaDataDomain(state, 'academic-plan', { snapshotRevision: 'r2' })
  const calendar = projectTheiaDataDomain(state, 'academic-calendar', { snapshotRevision: 'r2' })
  assert.equal(plan.data.document.sourceFilename, 'plan.pdf')
  assert.equal(calendar.data.assets.calendar.root, undefined)
  assert.ok(PUBLIC_DATA_DOMAINS.includes('academic-plan'))
  assert.ok(!PUBLIC_DATA_DOMAINS.includes('academic-warning'))
  assert.ok(!PUBLIC_DATA_DOMAINS.includes('thesis'))
})

test('local API serves the versioned public data output without transport fields', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theia-data-output-'))
  const state = emptyState()
  state.courses = [{ id: 'course-1', title: '离散数学', sourceUrl: 'https://private.invalid' }]
  const store = {
    snapshot: () => state,
    snapshotWithRevision: () => ({ state, revision: 'revision-1' }),
    storageSummary: () => ({ schema: 'theia-sharded-store/v1', revision: 'revision-1' }),
  }
  const api = await startLocalApi({ store, root, preferredPort: 0, publishRuntime: false })
  try {
    const response = await fetch(`${api.baseUrl}/v1/data-output/courses`)
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.schema, 'theia-data-domain-output/v1')
    assert.equal(body.snapshotRevision, 'revision-1')
    assert.equal(body.data[0].sourceUrl, undefined)
    assert.equal((await fetch(`${api.baseUrl}/v1/data-output/academic-warning`)).status, 404)
  } finally {
    await api.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('local API exposes cached MOTION venue catalog and status as read-only projections', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theia-motion-api-'))
  const detailUrl = 'https://motion.buct.edu.cn/changguanyuyue1/detail.php?xm=%E7%BE%BD%E6%AF%9B%E7%90%83&xq=0'
  const capturedAt = '2026-08-19T08:00:00.000Z'
  const status = {
    query: {
      activity: '羽毛球',
      campus: { id: 'changping', label: '昌平校区' },
      detailUrl,
      date: '2026-08-19',
      venue: '体育馆比赛馆',
      availableDates: ['2026-08-19', '2026-08-20'],
      availableVenues: ['体育馆比赛馆'],
    },
    availability: {
      tables: [{ index: 0, headers: ['时间\\场地', '羽01'], slots: [{ time: '09:00-10:00', courts: [{ court: '羽01', status: '可预约', state: 'available' }] }] }],
      summary: { timeSlots: 1, courtStatusCells: 1, byState: { available: 1 } },
    },
    safety: { onlyRead: true, requestedMethods: ['GET'], submittedForms: 0, executedBookingActions: 0, credentialsOrCookiesSupplied: false, rawBodyPersisted: false },
    timing: { totalMs: 12.5 },
    capturedAt,
  }
  let api
  try {
    const state = emptyState()
    state.dataCatalog = cacheMotionVenueCatalog(state.dataCatalog, {
      campuses: [{ id: 'changping', label: '昌平校区' }],
      venues: [{ id: 'venue-1', campusId: 'changping', campusLabel: '昌平校区', activity: '羽毛球', label: '体育馆比赛馆', detailUrl }],
    }, capturedAt)
    state.dataCatalog = cacheMotionVenueStatus(state.dataCatalog, status, capturedAt)
    const store = {
      snapshot: () => state,
      storageSummary: () => ({ schema: 'theia-sharded-store/v1' }),
    }
    api = await startLocalApi({ store, root, preferredPort: 0, publishRuntime: false })

    const catalogResponse = await fetch(`${api.baseUrl}/v1/venue-catalog`)
    const catalogBody = await catalogResponse.json()
    assert.equal(catalogResponse.status, 200)
    assert.equal(catalogBody.item.venues[0].detailUrl, detailUrl)
    assert.equal(catalogBody.item.campuses[0].venueIds[0], 'venue-1')

    const statusResponse = await fetch(`${api.baseUrl}/v1/venue-status?detailUrl=${encodeURIComponent(detailUrl)}&date=2026-08-19&venue=${encodeURIComponent('体育馆比赛馆')}`)
    const statusBody = await statusResponse.json()
    assert.equal(statusResponse.status, 200)
    assert.equal(statusBody.item.fromCache, true)
    assert.equal(statusBody.item.availability.summary.byState.available, 1)

    const missingBody = await fetch(`${api.baseUrl}/v1/venue-status?detailUrl=${encodeURIComponent(detailUrl)}&date=2026-08-20&venue=${encodeURIComponent('体育馆比赛馆')}`).then((response) => response.json())
    assert.equal(missingBody.item, null)
  } finally {
    await api?.close()
    await rm(root, { recursive: true, force: true })
  }
})
