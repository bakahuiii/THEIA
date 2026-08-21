import { normalizeAcademicCalendar } from './academic-calendar.mjs'

export const LOCAL_DATA_SCHEMA = 'theia-local-data/v1'
export const FITNESS_PARSER_VERSION = 'tygl-fitness/v1'
export const SCHOOL_SCHEDULE_PARSER_VERSION = 'jwglxt-school-schedule/v8'
export const ACADEMIC_CALENDAR_ASSETS_PARSER_VERSION = 'academic-calendar-assets/v1'
export const MOTION_VENUE_PARSER_VERSION = 'motion-venue/v1'

const FITNESS_YEAR = /^20\d{2}-20\d{2}_\d+$/
const TERM_ID = /^20\d{2}-(?:3|12|16)$/
const FITNESS_FIELDS = [
  'vitality', 'run50', 'flex', 'jump', 'strength', 'endureSecs', 'heightCm', 'weightKg',
]
const SCHOOL_SCHEDULE_ITEM_LIMIT = 10_000
const MOTION_VENUE_LIMIT = 500
const MOTION_STATUS_CELL_LIMIT = 20_000
const MOTION_BASE_URL = 'https://motion.buct.edu.cn/changguanyuyue1/'

function iso(value) {
  const time = new Date(value || '').getTime()
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

function finite(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function yearEntry(value) {
  if (!value || typeof value !== 'object') return null
  const yearKey = String(value.yearKey || '').trim()
  if (!FITNESS_YEAR.test(yearKey)) return null
  const label = String(value.label || yearKey).trim().slice(0, 80)
  return { yearKey, label: label || yearKey }
}

function catalogText(value, max = 160) {
  return value === null || value === undefined ? null : String(value).trim().slice(0, max) || null
}

function caseInsensitiveFields(value) {
  const fields = new Map()
  for (const [key, fieldValue] of Object.entries(value && typeof value === 'object' ? value : {})) {
    const normalizedKey = key.toLocaleLowerCase()
    if (!fields.has(normalizedKey)) fields.set(normalizedKey, fieldValue)
  }
  return fields
}

function firstField(fields, ...names) {
  for (const name of names) {
    const value = fields.get(String(name).toLocaleLowerCase())
    if (value !== undefined && value !== null && value !== '') return value
  }
  return null
}

function combinedClassInfoOf(fields) {
  const explicit = firstField(fields, 'combinedClassInfo', 'hbxx', 'classComposition')
  const normalizedExplicit = catalogText(explicit, 500)
  if (normalizedExplicit) return normalizedExplicit
  return catalogText(firstField(fields, 'jxbzc', 'teachingClassComposition', 'classCompositionText'), 500)
}

function catalogAnalysis(value) {
  if (!value || typeof value !== 'object') return null
  try {
    const copy = structuredClone(value)
    const serialized = JSON.stringify(copy)
    return serialized.length <= 2_000_000 ? JSON.parse(serialized) : null
  } catch {
    return null
  }
}

function schoolScheduleScope(value) {
  const source = value && typeof value === 'object' ? value : {}
  const termId = String(source.termId || '').trim()
  if (!TERM_ID.test(termId)) return null
  return {
    termId,
    keyword: catalogText(source.keyword, 120),
    teacher: catalogText(source.teacher, 80),
    department: catalogText(source.department, 120),
    category: catalogText(source.category, 80),
    nature: catalogText(source.nature, 80),
    format: catalogText(source.format, 80),
    affiliation: catalogText(source.affiliation, 80),
  }
}

function schoolScheduleKey(scope) {
  return [scope.termId, scope.keyword, scope.teacher, scope.department, scope.category, scope.nature, scope.format, scope.affiliation]
    .map((value) => encodeURIComponent(value || ''))
    .join('|')
}

function motionVenueText(value, maximum = 240) {
  return value === null || value === undefined ? null : String(value).replace(/\s+/gu, ' ').trim().slice(0, maximum) || null
}

function motionCampus(value) {
  if (!value || typeof value !== 'object') return null
  const id = ['changping', 'east', 'unknown'].includes(String(value.id)) ? String(value.id) : null
  const label = motionVenueText(value.label, 80)
  return id && label ? { id, label } : null
}

function motionVenue(value) {
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

function motionStatus(value) {
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
    capturedAt: iso(value.capturedAt),
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

function motionStatusKey(query) {
  return [query?.detailUrl, query?.date, query?.venue].map((value) => encodeURIComponent(String(value || ''))).join('|')
}

// A term is the cache boundary. Search conditions are deliberately not part of
// the stored data set: after a term has been read once, the search form,
// category selector and pagination must all work against that local set.
function schoolScheduleCacheScope(scope) {
  return {
    termId: scope.termId,
    keyword: null,
    teacher: null,
    department: null,
    category: null,
    nature: null,
    format: null,
    affiliation: null,
  }
}

function includesQuery(value, query) {
  if (!query) return true
  return String(value || '').toLocaleLowerCase().includes(String(query).toLocaleLowerCase())
}

function matchesSchoolSchedule(item, scope) {
  if (!includesQuery([item.title, item.courseCode, item.className, item.combinedClassInfo].filter(Boolean).join(' '), scope.keyword)) return false
  if (!includesQuery(item.teacher, scope.teacher)) return false
  if (!includesQuery(item.department, scope.department)) return false
  if (!includesQuery([item.category, item.nature].filter(Boolean).join(' '), scope.category)) return false
  if (!includesQuery(item.nature, scope.nature)) return false
  if (!includesQuery(item.affiliation, scope.affiliation)) return false
  if (!includesQuery([item.title, item.className].filter(Boolean).join(' '), scope.format)) return false
  return true
}

function schoolScheduleItem(value, index, scope) {
  if (!value || typeof value !== 'object') return null
  const fields = caseInsensitiveFields(value)
  const title = catalogText(firstField(fields, 'title', 'courseName', 'kcmc'))
  if (!title) return null
  return {
    id: catalogText(firstField(fields, 'id'), 240) || `school-schedule:${scope.termId}:${index}:${title}`,
    termId: scope.termId,
    classId: catalogText(firstField(fields, 'classId', 'jxb_id'), 160),
    courseCode: catalogText(firstField(fields, 'courseCode', 'kch'), 80),
    title,
    className: catalogText(firstField(fields, 'className', 'jxbmc')),
    combinedClassInfo: combinedClassInfoOf(fields),
    teacher: catalogText(firstField(fields, 'teacher', 'rkjs')),
    time: catalogText(firstField(fields, 'time', 'sksj'), 500),
    location: catalogText(firstField(fields, 'location', 'jxdd'), 240),
    credits: finite(firstField(fields, 'credits', 'xf')),
    nature: catalogText(firstField(fields, 'nature', 'kcxz', 'kcxzmc')),
    category: catalogText(firstField(fields, 'category', 'kclb', 'kclbmc')),
    department: catalogText(firstField(fields, 'department', 'kkxy', 'kkbmmc')),
    status: catalogText(firstField(fields, 'status', 'kkzt')),
    affiliation: catalogText(firstField(fields, 'affiliation', 'courseAffiliation', 'kcgs', 'kcgsmc')),
    sourceUrl: catalogText(firstField(fields, 'sourceUrl'), 800),
  }
}

export function emptyDataCatalog() {
  return {
    schema: LOCAL_DATA_SCHEMA,
    updatedAt: null,
    collections: {
      fitness: {
        source: 'https://tygl.buct.edu.cn/',
        parserVersion: FITNESS_PARSER_VERSION,
        lastRefreshedAt: null,
        availableYears: [],
        records: {},
      },
      schoolSchedule: {
        source: 'https://jwglxt.buct.edu.cn/jwglxt/',
        parserVersion: SCHOOL_SCHEDULE_PARSER_VERSION,
        lastRefreshedAt: null,
        records: {},
      },
      academicCalendar: {
        source: 'https://jiaowuchu.buct.edu.cn/',
        parserVersion: ACADEMIC_CALENDAR_ASSETS_PARSER_VERSION,
        lastRefreshedAt: null,
        assets: {},
        calendar: null,
        calendarError: null,
        analysis: null,
        analysisError: null,
      },
      venueReservations: {
        source: MOTION_BASE_URL,
        parserVersion: MOTION_VENUE_PARSER_VERSION,
        lastRefreshedAt: null,
        campuses: [],
        venues: [],
        statuses: {},
      },
    },
  }
}

export function normalizeFitnessResult(value, fallbackYearKey = null) {
  const source = value && typeof value === 'object' ? value : {}
  const result = {}
  for (const field of FITNESS_FIELDS) result[field] = finite(source[field])
  result.gender = source.gender === 'male' || source.gender === 'female' ? source.gender : null
  result.year = source.year === null || source.year === undefined ? null : String(source.year).trim().slice(0, 80)
  result.academicGrade = source.academicGrade === null || source.academicGrade === undefined
    ? null
    : String(source.academicGrade).trim().slice(0, 80)
  result.gradeGroup = source.gradeGroup === '12' || source.gradeGroup === '34' ? source.gradeGroup : null
  result.yearKey = FITNESS_YEAR.test(String(source.yearKey || ''))
    ? String(source.yearKey)
    : FITNESS_YEAR.test(String(fallbackYearKey || '')) ? String(fallbackYearKey) : null
  return result
}

export function normalizeDataCatalog(value) {
  const base = emptyDataCatalog()
  const source = value && typeof value === 'object' ? value : {}
  const fitnessSource = source.collections?.fitness
  const schoolScheduleSource = source.collections?.schoolSchedule
  const academicCalendarSource = source.collections?.academicCalendar
  const venueSource = source.collections?.venueReservations

  const availableYears = [...new Map(
    (Array.isArray(fitnessSource?.availableYears) ? fitnessSource.availableYears : [])
      .map(yearEntry)
      .filter(Boolean)
      .map((entry) => [entry.yearKey, entry]),
  ).values()]
  const records = {}
  for (const [key, entry] of Object.entries(fitnessSource?.records || {})) {
    if (!FITNESS_YEAR.test(key) || !entry || typeof entry !== 'object') continue
    const normalized = normalizeFitnessResult(entry.normalized, key)
    if (!normalized.yearKey) continue
    records[key] = {
      id: `fitness:${key}`,
      scope: { yearKey: key },
      capturedAt: iso(entry.capturedAt),
      source: 'https://tygl.buct.edu.cn/',
      parserVersion: String(entry.parserVersion || FITNESS_PARSER_VERSION),
      refreshState: entry.refreshState === 'empty' ? 'empty' : 'ready',
      normalized,
    }
  }

  const schoolScheduleRecords = {}
  for (const [key, entry] of Object.entries(schoolScheduleSource?.records || {})) {
    if (!entry || typeof entry !== 'object') continue
    // Older parsers may contain incomplete pages or omit fields required by
    // the current UI. Only the exact version can answer a local query safely.
    if (String(entry.parserVersion || '') !== SCHOOL_SCHEDULE_PARSER_VERSION) continue
    const scope = schoolScheduleScope(entry.scope)
    if (!scope) continue
    const items = (Array.isArray(entry.items) ? entry.items : [])
      .map((item, index) => schoolScheduleItem(item, index, scope))
      .filter(Boolean)
      .slice(0, SCHOOL_SCHEDULE_ITEM_LIMIT)
    schoolScheduleRecords[schoolScheduleKey(scope)] = {
      id: `school-schedule:${schoolScheduleKey(scope)}`,
      scope,
      capturedAt: iso(entry.capturedAt),
      source: 'https://jwglxt.buct.edu.cn/jwglxt/',
      parserVersion: String(entry.parserVersion || SCHOOL_SCHEDULE_PARSER_VERSION),
      total: Math.max(items.length, Math.min(100000, Number(entry.total) || 0)),
      complete: entry.complete === true,
      items,
    }
  }

  const academicCalendarAssets = {}
  for (const [key, entry] of Object.entries(academicCalendarSource?.assets || {})) {
    if (!['calendar', 'teachingSchedule', 'weeklyCalendar'].includes(key) || !entry || typeof entry !== 'object') continue
    const filename = catalogText(entry.filename, 160)
    if (!filename) continue
    academicCalendarAssets[key] = {
      filename,
      sourceUrl: catalogText(entry.sourceUrl, 800),
      fetchedAt: iso(entry.fetchedAt),
      nextRefreshAfter: iso(entry.nextRefreshAfter),
      bytes: Math.max(0, Math.min(500_000_000, Number(entry.bytes) || 0)),
    }
  }

  const venueCampuses = [...new Map(
    (Array.isArray(venueSource?.campuses) ? venueSource.campuses : [])
      .map(motionCampus)
      .filter(Boolean)
      .map((campus) => [campus.id, { ...campus, venueIds: [] }]),
  ).values()]
  const venueList = (Array.isArray(venueSource?.venues) ? venueSource.venues : [])
    .map(motionVenue)
    .filter(Boolean)
    .slice(0, MOTION_VENUE_LIMIT)
  const campusById = new Map(venueCampuses.map((campus) => [campus.id, campus]))
  for (const venue of venueList) {
    const campus = campusById.get(venue.campusId)
    if (campus && !campus.venueIds.includes(venue.id)) campus.venueIds.push(venue.id)
  }
  const venueStatuses = {}
  for (const entry of Object.values(venueSource?.statuses || {})) {
    const normalized = motionStatus(entry?.result || entry)
    if (!normalized) continue
    const key = motionStatusKey(normalized.query)
    venueStatuses[key] = {
      id: `motion-status:${key}`,
      scope: { detailUrl: normalized.query.detailUrl, date: normalized.query.date, venue: normalized.query.venue },
      capturedAt: normalized.capturedAt,
      source: MOTION_BASE_URL,
      parserVersion: MOTION_VENUE_PARSER_VERSION,
      result: normalized,
    }
  }

  return {
    schema: LOCAL_DATA_SCHEMA,
    updatedAt: iso(source.updatedAt),
    collections: {
      fitness: {
        source: 'https://tygl.buct.edu.cn/',
        parserVersion: FITNESS_PARSER_VERSION,
        lastRefreshedAt: iso(fitnessSource?.lastRefreshedAt),
        availableYears,
        records,
      },
      schoolSchedule: {
        source: 'https://jwglxt.buct.edu.cn/jwglxt/',
        parserVersion: SCHOOL_SCHEDULE_PARSER_VERSION,
        lastRefreshedAt: iso(schoolScheduleSource?.lastRefreshedAt),
        records: schoolScheduleRecords,
      },
      academicCalendar: {
        source: 'https://jiaowuchu.buct.edu.cn/',
        parserVersion: ACADEMIC_CALENDAR_ASSETS_PARSER_VERSION,
        lastRefreshedAt: iso(academicCalendarSource?.lastRefreshedAt),
        assets: academicCalendarAssets,
        calendar: academicCalendarSource?.calendar ? normalizeAcademicCalendar(academicCalendarSource.calendar) : null,
        calendarError: catalogText(academicCalendarSource?.calendarError, 300),
        analysis: catalogAnalysis(academicCalendarSource?.analysis),
        analysisError: catalogText(academicCalendarSource?.analysisError, 300),
      },
      venueReservations: {
        source: MOTION_BASE_URL,
        parserVersion: MOTION_VENUE_PARSER_VERSION,
        lastRefreshedAt: iso(venueSource?.lastRefreshedAt),
        campuses: venueCampuses,
        venues: venueList,
        statuses: venueStatuses,
      },
    },
  }
}

export function cacheAcademicCalendarAssets(catalog, manifest) {
  const next = normalizeDataCatalog(catalog)
  const assets = manifest?.assets && typeof manifest.assets === 'object' ? manifest.assets : {}
  const lastRefreshedAt = iso(manifest?.updatedAt)
  next.collections.academicCalendar = {
    source: 'https://jiaowuchu.buct.edu.cn/',
    parserVersion: ACADEMIC_CALENDAR_ASSETS_PARSER_VERSION,
    // Loading an empty or legacy local manifest is not a remote refresh.
    // Preserve an unknown watermark instead of manufacturing current time.
    lastRefreshedAt,
    assets,
    calendar: manifest?.calendar ? normalizeAcademicCalendar(manifest.calendar) : null,
    calendarError: catalogText(manifest?.calendarError, 300),
    analysis: catalogAnalysis(manifest?.analysis),
    analysisError: catalogText(manifest?.analysisError, 300),
  }
  next.updatedAt = lastRefreshedAt || next.updatedAt
  return normalizeDataCatalog(next)
}

function hasMeasurements(result) {
  return FITNESS_FIELDS.slice(0, 6).some((field) => result[field] !== null)
}

export function cacheFitnessResults(catalog, values, capturedAt = new Date().toISOString(), { markRefreshed = true } = {}) {
  const next = normalizeDataCatalog(catalog)
  const fitness = next.collections.fitness
  const incoming = Array.isArray(values) ? values : [values]
  const years = new Map(fitness.availableYears.map((entry) => [entry.yearKey, entry]))

  for (const value of incoming) {
    if (!value || typeof value !== 'object') continue
    for (const entry of Array.isArray(value.availableYears) ? value.availableYears : []) {
      const parsed = yearEntry(entry)
      if (parsed) years.set(parsed.yearKey, parsed)
    }
    const normalized = normalizeFitnessResult(value)
    if (!normalized.yearKey) continue
    if (!years.has(normalized.yearKey)) years.set(normalized.yearKey, { yearKey: normalized.yearKey, label: normalized.yearKey })
    fitness.records[normalized.yearKey] = {
      id: `fitness:${normalized.yearKey}`,
      scope: { yearKey: normalized.yearKey },
      capturedAt,
      source: 'https://tygl.buct.edu.cn/',
      parserVersion: FITNESS_PARSER_VERSION,
      refreshState: hasMeasurements(normalized) ? 'ready' : 'empty',
      normalized,
    }
  }

  fitness.availableYears = [...years.values()].sort((left, right) => right.yearKey.localeCompare(left.yearKey))
  if (markRefreshed) fitness.lastRefreshedAt = capturedAt
  next.updatedAt = capturedAt
  return next
}

export function cachedFitnessResult(catalog, requestedYear) {
  const fitness = normalizeDataCatalog(catalog).collections.fitness
  const requested = FITNESS_YEAR.test(String(requestedYear || '')) ? String(requestedYear) : null
  const candidates = requested
    ? [requested]
    : fitness.availableYears.map((entry) => entry.yearKey)
  for (const yearKey of candidates) {
    const record = fitness.records[yearKey]
    if (!record) continue
    return {
      ...record.normalized,
      yearKey,
      availableYears: fitness.availableYears,
      cachedAt: record.capturedAt,
      refreshState: record.refreshState,
    }
  }
  return null
}

export function fitnessCacheSummary(catalog) {
  const fitness = normalizeDataCatalog(catalog).collections.fitness
  return {
    source: fitness.source,
    parserVersion: fitness.parserVersion,
    lastRefreshedAt: fitness.lastRefreshedAt,
    availableYears: fitness.availableYears,
    cachedYears: Object.keys(fitness.records).sort().reverse(),
  }
}

export function cacheSchoolScheduleResult(catalog, value, capturedAt = value?.capturedAt || new Date().toISOString()) {
  const next = normalizeDataCatalog(catalog)
  const requestedScope = schoolScheduleScope(value?.scope)
  if (!requestedScope) return next
  const scope = schoolScheduleCacheScope(requestedScope)
  const key = schoolScheduleKey(scope)
  const normalizedCapturedAt = iso(capturedAt) || new Date().toISOString()
  const items = (Array.isArray(value?.items) ? value.items : [])
    .map((item, index) => schoolScheduleItem(item, index, scope))
    .filter(Boolean)
    .slice(0, SCHOOL_SCHEDULE_ITEM_LIMIT)
  next.collections.schoolSchedule.records[key] = {
    id: `school-schedule:${key}`,
    scope,
    capturedAt: normalizedCapturedAt,
    source: 'https://jwglxt.buct.edu.cn/jwglxt/',
    parserVersion: SCHOOL_SCHEDULE_PARSER_VERSION,
    total: Math.max(items.length, Math.min(100000, Number(value?.total) || 0)),
    // Only the crawler can assert completion. A short server page (the bug
    // this replaces returned 10 rows) must never become a durable full cache.
    complete: value?.complete === true,
    items,
  }
  const records = Object.entries(next.collections.schoolSchedule.records)
    .sort(([, left], [, right]) => String(right.capturedAt || '').localeCompare(String(left.capturedAt || '')))
    .slice(0, 80)
  next.collections.schoolSchedule.records = Object.fromEntries(records)
  next.collections.schoolSchedule.lastRefreshedAt = normalizedCapturedAt
  next.updatedAt = normalizedCapturedAt
  return next
}

export function cachedSchoolScheduleResult(catalog, scope) {
  const schedule = normalizeDataCatalog(catalog).collections.schoolSchedule
  const normalizedScope = schoolScheduleScope(scope)
  const toResult = (record) => {
    if (!record) return null
    const items = normalizedScope
      ? record.items.filter((item) => matchesSchoolSchedule(item, normalizedScope))
      : record.items
    // A completed term is one local catalogue. Never reintroduce server-style
    // pagination here: renderer filtering and sort work over the whole term.
    return {
      ...record,
      scope: normalizedScope || record.scope,
      page: 1,
      pageSize: items.length,
      total: items.length,
      items,
      fromCache: true,
    }
  }
  if (normalizedScope) return toResult(schedule.records[schoolScheduleKey(schoolScheduleCacheScope(normalizedScope))])
  return toResult(Object.values(schedule.records)
    .sort((left, right) => String(right.capturedAt || '').localeCompare(String(left.capturedAt || '')))[0] || null
  )
}

export function schoolScheduleCacheSummary(catalog) {
  const schedule = normalizeDataCatalog(catalog).collections.schoolSchedule
  return {
    source: schedule.source,
    parserVersion: schedule.parserVersion,
    lastRefreshedAt: schedule.lastRefreshedAt,
    records: Object.values(schedule.records)
      .sort((left, right) => String(right.capturedAt || '').localeCompare(String(left.capturedAt || '')))
      .map((record) => ({ id: record.id, scope: record.scope, capturedAt: record.capturedAt, total: record.total, count: record.items.length, complete: record.complete === true })),
  }
}

export function cacheMotionVenueCatalog(catalog, value, capturedAt = value?.capturedAt || new Date().toISOString()) {
  const next = normalizeDataCatalog(catalog)
  const source = value && typeof value === 'object' ? value : {}
  const campuses = [...new Map(
    (Array.isArray(source.campuses) ? source.campuses : []).map(motionCampus).filter(Boolean).map((campus) => [campus.id, { ...campus, venueIds: [] }]),
  ).values()]
  const venues = (Array.isArray(source.venues) ? source.venues : []).map(motionVenue).filter(Boolean).slice(0, MOTION_VENUE_LIMIT)
  const campusById = new Map(campuses.map((campus) => [campus.id, campus]))
  for (const venue of venues) {
    const campus = campusById.get(venue.campusId)
    if (campus && !campus.venueIds.includes(venue.id)) campus.venueIds.push(venue.id)
  }
  const timestamp = iso(capturedAt) || new Date().toISOString()
  next.collections.venueReservations = {
    ...next.collections.venueReservations,
    source: MOTION_BASE_URL,
    parserVersion: MOTION_VENUE_PARSER_VERSION,
    lastRefreshedAt: timestamp,
    campuses,
    venues,
  }
  next.updatedAt = timestamp
  return next
}

export function cacheMotionVenueStatus(catalog, value, capturedAt = value?.capturedAt || new Date().toISOString()) {
  const next = normalizeDataCatalog(catalog)
  const result = motionStatus(value)
  if (!result) return next
  const timestamp = iso(capturedAt) || result.capturedAt || new Date().toISOString()
  const key = motionStatusKey(result.query)
  next.collections.venueReservations.statuses[key] = {
    id: `motion-status:${key}`,
    scope: { detailUrl: result.query.detailUrl, date: result.query.date, venue: result.query.venue },
    capturedAt: timestamp,
    source: MOTION_BASE_URL,
    parserVersion: MOTION_VENUE_PARSER_VERSION,
    result: { ...result, capturedAt: timestamp },
  }
  const statuses = Object.entries(next.collections.venueReservations.statuses)
    .sort(([, left], [, right]) => String(right.capturedAt || '').localeCompare(String(left.capturedAt || '')))
    .slice(0, MOTION_VENUE_LIMIT)
  next.collections.venueReservations.statuses = Object.fromEntries(statuses)
  next.collections.venueReservations.lastRefreshedAt = timestamp
  next.updatedAt = timestamp
  return next
}

export function cachedMotionVenueCatalog(catalog) {
  const source = normalizeDataCatalog(catalog).collections.venueReservations
  return {
    source: source.source,
    parserVersion: source.parserVersion,
    lastRefreshedAt: source.lastRefreshedAt,
    campuses: source.campuses,
    venues: source.venues,
  }
}

export function cachedMotionVenueStatus(catalog, query = {}) {
  const source = normalizeDataCatalog(catalog).collections.venueReservations
  const detailUrl = motionVenueText(query.detailUrl, 800)
  const date = motionVenueText(query.date, 32)
  const venue = motionVenueText(query.venue, 120)
  const key = detailUrl && date && venue ? motionStatusKey({ detailUrl, date, venue }) : null
  const record = key ? source.statuses[key] : Object.values(source.statuses)[0]
  return record ? { ...record.result, cachedAt: record.capturedAt, fromCache: true } : null
}

export function motionVenueCacheSummary(catalog) {
  const source = normalizeDataCatalog(catalog).collections.venueReservations
  return {
    source: source.source,
    parserVersion: source.parserVersion,
    lastRefreshedAt: source.lastRefreshedAt,
    campuses: source.campuses.length,
    venues: source.venues.length,
    statuses: Object.keys(source.statuses).length,
  }
}
