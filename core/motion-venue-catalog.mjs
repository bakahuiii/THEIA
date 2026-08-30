export const MOTION_VENUE_PARSER_VERSION = 'motion-venue/v1'
export const MOTION_VENUE_LIMIT = 500
export const MOTION_STATUS_CELL_LIMIT = 20_000
export const MOTION_BASE_URL = 'https://motion.buct.edu.cn/changguanyuyue1/'

function normalizeMotionIso(value) {
  const time = new Date(value || '').getTime()
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}


export function motionVenueText(value, maximum = 240) {
  return value === null || value === undefined ? null : String(value).replace(/\s+/gu, ' ').trim().slice(0, maximum) || null
}

export function motionCampus(value) {
  if (!value || typeof value !== 'object') return null
  const id = ['changping', 'east', 'unknown'].includes(String(value.id)) ? String(value.id) : null
  const label = motionVenueText(value.label, 80)
  return id && label ? { id, label } : null
}

export function normalizeMotionVenue(value) {
  if (!value || typeof value !== 'object') return null
  const id = motionVenueText(value.id, 160)
  const detailUrl = motionVenueText(value.detailUrl, 800)
  const campus = motionCampus({ id: value.campusId, label: value.campusLabel })
  const activity = motionVenueText(value.activity, 120)
  if (!id || !detailUrl || !campus || !activity) return null
  return {
    id,
    campusId: campus.id,
    campusLabel: campus.label,
    activity,
    label: motionVenueText(value.label, 120) || activity,
    detailUrl,
  }
}

export function normalizeMotionStatus(value) {
  if (!value || typeof value !== 'object') return null
  const query = value.query && typeof value.query === 'object' ? value.query : {}
  const detailUrl = motionVenueText(query.detailUrl, 800)
  const date = motionVenueText(query.date, 32)
  const venue = motionVenueText(query.venue, 120)
  if (!detailUrl || !date || !venue) return null
  const tables = (Array.isArray(value.availability?.tables) ? value.availability.tables : [])
    .slice(0, 200)
    .map((table, index) => {
      const slots = (Array.isArray(table?.slots) ? table.slots : []).slice(0, 500).map((slot) => {
        const time = motionVenueText(slot?.time, 40)
        const courts = (Array.isArray(slot?.courts) ? slot.courts : []).slice(0, MOTION_STATUS_CELL_LIMIT).map((cell) => {
          const court = motionVenueText(cell?.court, 120)
          const status = motionVenueText(cell?.status, 500)
          const state = ['available', 'occupied', 'closed', 'expired', 'selected', 'unknown'].includes(cell?.state) ? cell.state : 'unknown'
          return court && status ? { court, status, state } : null
        }).filter(Boolean)
        return time && courts.length ? { time, courts } : null
      }).filter(Boolean)
      if (!slots.length) return null
      const rawHeaders = (Array.isArray(table?.headers) ? table.headers : [])
        .map((header) => motionVenueText(header, 120))
        .filter(Boolean)
      const slotTimes = new Set(slots.map((slot) => slot.time))
      const slotStatuses = new Set(slots.flatMap((slot) => slot.courts.map((cell) => cell.status)))
      const firstHeader = rawHeaders[0] && !slotTimes.has(rawHeaders[0]) && !slotStatuses.has(rawHeaders[0])
        ? rawHeaders[0]
        : '时间\\场地'
      const courtHeaders = [...new Set(slots.flatMap((slot) => slot.courts.map((cell) => cell.court)))]
      return {
        index: Number.isInteger(table?.index) ? table.index : index,
        headers: [firstHeader, ...(courtHeaders.length ? courtHeaders : rawHeaders.slice(1).filter((header) => !slotTimes.has(header) && !slotStatuses.has(header)))].slice(0, 500),
        slots,
        summary: table.summary && typeof table.summary === 'object' ? table.summary : null,
      }
    }).filter(Boolean)
  return {
    schema: 'theia-motion-venue-status/v1',
    parserVersion: MOTION_VENUE_PARSER_VERSION,
    capturedAt: normalizeMotionIso(value.capturedAt),
    source: {
      platform: 'MOTION',
      accessMode: 'public-anonymous-get',
      url: motionVenueText(value.source?.url, 800),
      queryUrl: motionVenueText(value.source?.queryUrl, 800),
      method: 'GET',
    },
    query: {
      activity: motionVenueText(query.activity, 120),
      campus: motionCampus(query.campus),
      detailUrl,
      date,
      venue,
      availableDates: (Array.isArray(query.availableDates) ? query.availableDates : []).map((item) => motionVenueText(item, 32)).filter(Boolean).slice(0, 100),
      availableVenues: (Array.isArray(query.availableVenues) ? query.availableVenues : []).map((item) => motionVenueText(item, 120)).filter(Boolean).slice(0, MOTION_VENUE_LIMIT),
    },
    availability: {
      tables,
      summary: value.availability?.summary && typeof value.availability.summary === 'object' ? value.availability.summary : null,
    },
    safety: {
      onlyRead: true,
      requestedMethods: ['GET'],
      requestedPageCount: value.safety?.requestedPageCount === 2 ? 2 : 1,
      submittedForms: 0,
      executedBookingActions: 0,
      credentialsOrCookiesSupplied: false,
      rawBodyPersisted: false,
    },
    timing: {
      totalMs: Number.isFinite(value.timing?.totalMs) ? Math.max(0, Number(value.timing.totalMs)) : null,
      initialRequestMs: Number.isFinite(value.timing?.initialRequestMs) ? Math.max(0, Number(value.timing.initialRequestMs)) : null,
      selectedRequestMs: Number.isFinite(value.timing?.selectedRequestMs) ? Math.max(0, Number(value.timing.selectedRequestMs)) : null,
      selectedPageFetched: value.timing?.selectedPageFetched === true,
    },
  }
}

export function motionStatusKey(query) {
  return [query?.detailUrl, query?.date, query?.venue].map((value) => encodeURIComponent(String(value || ''))).join('|')
}
