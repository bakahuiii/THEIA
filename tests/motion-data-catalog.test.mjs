import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cacheMotionVenueCatalog,
  cacheMotionVenueStatus,
  cachedMotionVenueCatalog,
  cachedMotionVenueStatus,
  cachedMotionVenueStatuses,
  emptyDataCatalog,
  motionVenueCacheSummary,
  normalizeDataCatalog,
} from '../core/data-catalog.mjs'

const detailUrl = 'https://motion.buct.edu.cn/changguanyuyue1/detail.php?xm=x&xq=0'
const catalog = {
  capturedAt: '2026-08-19T00:00:00.000Z',
  campuses: [{ id: 'changping', label: '昌平校区' }],
  venues: [{ id: 'venue-1', campusId: 'changping', campusLabel: '昌平校区', activity: '羽毛球', label: '羽毛球', detailUrl }],
}
const status = {
  schema: 'theia-motion-venue-status/v1',
  capturedAt: '2026-08-19T00:01:00.000Z',
  source: { url: detailUrl, queryUrl: detailUrl, method: 'GET' },
  query: {
    activity: '羽毛球', campus: { id: 'changping', label: '昌平校区' }, detailUrl,
    date: '2026-08-19', venue: '体育馆羽毛球馆', availableDates: ['2026-08-19'], availableVenues: ['体育馆羽毛球馆'],
  },
  availability: {
    tables: [{ index: 0, headers: ['时间\\场地', '羽01', '09:00-10:00', '闭馆'], slots: [{ time: '09:00-10:00', courts: [{ court: '羽01', status: '可预约', state: 'available' }] }] }],
    summary: { timeSlots: 1, courtStatusCells: 1, byState: { available: 1 } },
  },
  safety: { requestedPageCount: 1 },
  timing: { totalMs: 120.5 },
}

test('MOTION catalog cache retains catalog and keyed status records', () => {
  let value = emptyDataCatalog()
  value = cacheMotionVenueCatalog(value, catalog)
  value = cacheMotionVenueStatus(value, status)
  const normalized = normalizeDataCatalog(value)
  assert.equal(normalized.collections.venueReservations.venues.length, 1)
  assert.deepEqual(normalized.collections.venueReservations.campuses[0].venueIds, ['venue-1'])
  const cached = cachedMotionVenueStatus(normalized, status.query)
  assert.equal(cached.fromCache, true)
  assert.equal(cached.query.date, '2026-08-19')
  assert.equal(cached.availability.tables[0].slots[0].courts[0].state, 'available')
  assert.deepEqual(cached.availability.tables[0].headers, ['时间\\场地', '羽01'])
  assert.equal(cachedMotionVenueCatalog(normalized).venues[0].detailUrl, detailUrl)
  assert.deepEqual(motionVenueCacheSummary(normalized), {
    source: 'https://motion.buct.edu.cn/changguanyuyue1/',
    parserVersion: 'motion-venue/v1',
    lastRefreshedAt: '2026-08-19T00:01:00.000Z',
    campuses: 1,
    venues: 1,
    statuses: 1,
  })
})

test('MOTION cache drops malformed venue records and keeps read-only fields', () => {
  const normalized = normalizeDataCatalog({ collections: { venueReservations: {
    campuses: [{ id: 'changping', label: '昌平校区' }],
    venues: [catalog.venues[0], { id: 'bad', campusId: 'changping', campusLabel: '昌平校区' }],
    statuses: {},
  } } })
  assert.equal(normalized.collections.venueReservations.venues.length, 1)
  assert.equal(normalized.collections.venueReservations.venues[0].detailUrl, detailUrl)
  assert.equal(normalized.collections.venueReservations.venues[0].password, undefined)
})

test('cachedMotionVenueStatuses tolerates a missing activity filter and missing result activity', () => {
  // Regression: both null paths used to call .toLocaleLowerCase() on null and
  // crash the /v1/venue-statuses endpoint whenever activity was omitted.
  let value = emptyDataCatalog()
  value = cacheMotionVenueCatalog(value, catalog)
  value = cacheMotionVenueStatus(value, status)
  const normalized = normalizeDataCatalog(value)

  const noFilter = cachedMotionVenueStatuses(normalized, {})
  assert.equal(noFilter.length, 1)

  const onlyDate = cachedMotionVenueStatuses(normalized, { date: '2026-08-19' })
  assert.equal(onlyDate.length, 1)

  // A stored status whose own query.activity is missing must not throw either.
  const bareStatus = {
    ...status,
    query: { ...status.query, activity: null },
  }
  let bare = emptyDataCatalog()
  bare = cacheMotionVenueCatalog(bare, catalog)
  bare = cacheMotionVenueStatus(bare, bareStatus)
  assert.equal(cachedMotionVenueStatuses(normalizeDataCatalog(bare), {}).length, 1)
})
