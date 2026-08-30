import {
  cachedMotionVenueCatalog,
  cacheMotionVenueStatus,
  motionVenueCacheSummary,
} from '../core/data-catalog.mjs'

function parseIds(value) {
  return String(value || '')
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item >= 1)
}

function validSeats(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : undefined
}

function newestTerm(terms) {
  return [...terms].sort((left, right) => {
    const leftYear = Number(left?.year) || 0
    const rightYear = Number(right?.year) || 0
    if (leftYear !== rightYear) return rightYear - leftYear
    const termRank = (value) => ({ '3': 1, '12': 2, '16': 3 })[
      String(value?.term || value?.id || '').split('-').pop()
    ] || 0
    return termRank(right) - termRank(left)
  })[0] || null
}

export function createLocalApiHandlers({
  store,
  syncService,
  motionVenueAdapter,
  getAuthEpoch,
  waitForSchoolProxy,
  assertAuthEpoch,
  sendSnapshot,
  writeDiagnostic,
  diagnosticError = (error) => error?.message || String(error),
}) {
  const queryFreeClassrooms = async (query = {}) => {
    const snapshot = store.snapshot()
    const term = snapshot.terms.find((item) => item?.id === query?.termId) || newestTerm(snapshot.terms)
    if (!term) throw new Error('请选择有效的教务学期')
    const epoch = getAuthEpoch()
    await waitForSchoolProxy()
    assertAuthEpoch(epoch)
    const weeks = parseIds(query.weeks)
    const weekdays = parseIds(query.weekdays)
    const periods = parseIds(query.periods)
    const minSeats = validSeats(query.minSeats)
    const maxSeats = validSeats(query.maxSeats)
    const result = await syncService.syncNow({
      sources: ['jwglxt'],
      domains: ['free-classroom'],
      freeClassroom: {
        term,
        ...(weeks.length ? { weeks } : {}),
        ...(weekdays.length ? { weekdays } : {}),
        ...(periods.length ? { periods } : {}),
        ...(query.campus ? { campus: String(query.campus).slice(0, 80) } : {}),
        ...(query.building ? { building: String(query.building).slice(0, 80) } : {}),
        ...(query.classroomType ? { classroomType: String(query.classroomType).slice(0, 80) } : {}),
        ...(minSeats !== undefined ? { minSeats } : {}),
        ...(maxSeats !== undefined ? { maxSeats } : {}),
      },
      foreground: true,
    })
    assertAuthEpoch(epoch)
    const domain = result.academicExtras?.domains?.['free-classroom'] || {}
    return { records: domain.records || [], capturedAt: domain.capturedAt || null }
  }

  const fetchMotionVenueStatuses = async ({ activity, date } = {}) => {
    const catalog = cachedMotionVenueCatalog(store.snapshot().dataCatalog)
    const requested = String(activity || '').trim().slice(0, 120).toLocaleLowerCase()
    const venues = Array.isArray(catalog?.venues) ? catalog.venues : []
    const matched = requested
      ? venues.filter((venue) => `${venue.activity || ''} ${venue.label || ''}`.toLocaleLowerCase().includes(requested))
      : venues
    // Each detail URL already selects a concrete venue. Limit concurrency so a
    // status refresh remains responsive when the catalog contains many venues.
    const targets = matched.slice(0, 12).filter((venue) => Boolean(venue?.detailUrl))
    const results = []
    const latestByResult = []
    let cursor = 0
    const workers = Array.from({ length: Math.min(3, Math.max(1, targets.length)) }, async () => {
      while (cursor < targets.length) {
        const index = cursor
        cursor += 1
        const venue = targets[index]
        try {
          const result = await motionVenueAdapter.queryStatus({ detailUrl: venue.detailUrl, date: date || null })
          results[index] = { ...result, fromCache: false }
          latestByResult[index] = result.capturedAt || null
        } catch (error) {
          void writeDiagnostic('motion.venue_status_live_failed', {
            venue: venue.label || null,
            error: diagnosticError(error),
          })
        }
      }
    })
    await Promise.all(workers)
    const items = results.filter(Boolean)
    if (items.length) {
      await store.update((state) => {
        let next = state
        for (const status of items) {
          next = { ...next, dataCatalog: cacheMotionVenueStatus(next.dataCatalog, status, status.capturedAt) }
        }
        return next
      })
    }
    sendSnapshot()
    const latestCapturedAt = latestByResult.filter(Boolean).sort().at(-1) || null
    return {
      item: items,
      updatedAt: latestCapturedAt || new Date().toISOString(),
      summary: motionVenueCacheSummary(store.snapshot().dataCatalog),
    }
  }

  return { queryFreeClassrooms, fetchMotionVenueStatuses }
}
