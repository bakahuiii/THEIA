function mergeById(...collections) {
  const map = new Map()
  for (const item of collections.flat()) {
    if (!item?.id) continue
    map.set(item.id, { ...(map.get(item.id) || {}), ...item })
  }
  return [...map.values()]
}

function mergePartialCollection(current, fresh) {
  return mergeById(current, fresh)
}

export function mergeSingleSourceCollection(current, fresh, outcome) {
  if (fresh === undefined) return current
  if (outcome && !outcome.succeeded) return current
  if (!Array.isArray(fresh)) return current
  if (fresh.length === 0 && current.length > 0 && outcome && !outcome.emptyConfirmed) {
    return current
  }
  if (outcome?.succeeded && outcome.completeness !== 'complete') {
    return mergePartialCollection(current, fresh)
  }
  return fresh
}

export function mergeTermCollection(current, fresh, outcome) {
  if (fresh === undefined) return current
  if (outcome && !outcome.succeeded) return current
  if (!Array.isArray(fresh)) return current
  if (!outcome || outcome.completeness === 'complete') return fresh

  const successfulTermIds = new Set(outcome.successfulTermIds || [])
  if (!successfulTermIds.size) return mergePartialCollection(current, fresh)
  const retained = current.filter((item) => !successfulTermIds.has(item?.termId))
  return mergeById(retained, fresh)
}

function isPositionedScheduleRecord(item) {
  const weekday = Number(item?.weekday)
  return Number.isInteger(weekday)
    && weekday >= 1
    && weekday <= 7
    && Boolean(String(item?.period || '').trim())
}

export function mergeScheduleCollection(current, fresh, outcome) {
  // Course-list rows without placement data are not a timetable. Preserve a
  // known positioned schedule while exposing the partial source outcome.
  if (Array.isArray(fresh) && fresh.length && current.some(isPositionedScheduleRecord)
    && !fresh.some(isPositionedScheduleRecord)) return current
  return mergeTermCollection(current, fresh, outcome)
}

export function mergeObjectValue(current, fresh, outcome) {
  if (fresh === undefined) return current
  if (outcome && !outcome.succeeded) return current
  if (fresh === null) {
    return outcome?.completeness === 'complete' && outcome.contentEmptyConfirmed ? null : current
  }
  if (!fresh || typeof fresh !== 'object' || Array.isArray(fresh)) return current
  if (outcome?.completeness !== 'complete' && current && typeof current === 'object') {
    return { ...current, ...fresh }
  }
  return fresh
}

export function mergeAcademicExtraDomain(current, fresh, outcome, domain = '') {
  if (!fresh || typeof fresh !== 'object') return current
  if (outcome && !outcome.succeeded) return current
  const normalizedCurrent = current && typeof current === 'object'
    ? normalizeJwglxtExtraDomain(current, domain)
    : null
  const normalizedFresh = normalizeJwglxtExtraDomain(fresh, domain)
  if (domain === 'academic-plan') {
    // A plan is one verified current-major PDF, not a collection to union.
    // A partial response without a replacement must retain the previous local
    // file; once a new PDF exists it atomically replaces the old descriptor.
    if (!normalizedFresh.attachments.length && normalizedCurrent?.attachments.length && outcome?.completeness !== 'complete') {
      return normalizeJwglxtExtraDomain({
        ...normalizedCurrent,
        ...normalizedFresh,
        attachments: normalizedCurrent.attachments,
        records: [],
        completeness: 'partial',
      }, domain)
    }
    return normalizedFresh
  }
  if (!normalizedCurrent || outcome?.completeness === 'complete') return normalizedFresh
  // Dynamic JWGLXT pages can return one route/detail fragment at a time. Keep
  // the last complete records while replacing refreshed IDs; an empty partial
  // response must never erase a usable academic cache.
  const records = mergeById(
    Array.isArray(normalizedCurrent.records) ? normalizedCurrent.records : [],
    Array.isArray(normalizedFresh.records) ? normalizedFresh.records : [],
  )
  const attachments = mergeById(
    Array.isArray(normalizedCurrent.attachments) ? normalizedCurrent.attachments : [],
    Array.isArray(normalizedFresh.attachments) ? normalizedFresh.attachments : [],
  )
  return {
    ...normalizedCurrent,
    ...normalizedFresh,
    completeness: 'partial',
    records,
    attachments,
    routeCodes: [...new Set([...(normalizedCurrent.routeCodes || []), ...(normalizedFresh.routeCodes || [])])],
    filters: [...new Set([...(normalizedCurrent.filters || []), ...(normalizedFresh.filters || [])])],
    messages: [...new Set([...(normalizedCurrent.messages || []), ...(normalizedFresh.messages || [])])],
    queryStats: normalizedFresh.queryStats || normalizedCurrent.queryStats,
  }
}

export { mergeById }
import { normalizeJwglxtExtraDomain } from './jwglxt-extra.mjs'
