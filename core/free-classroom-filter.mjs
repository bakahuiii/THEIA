function normalizedRoomKey(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\s\-—–－_·.]+/gu, '')
}

function roomValues(record, keys) {
  const direct = keys.map((key) => record?.[key])
  const fields = Array.isArray(record?.fields)
    ? record.fields
      .filter((field) => keys.includes(String(field?.name || ''))
        || keys.some((key) => String(field?.label || '').includes(key))
        || /教室|场地|地点/u.test(String(field?.label || '')))
      .map((field) => field?.value)
    : []
  return [...direct, ...fields]
    .filter((value) => value !== undefined && value !== null && String(value).trim())
    .map((value) => normalizedRoomKey(value))
    .filter(Boolean)
}

function weekdayNumber(value) {
  const numeric = Number(value)
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 7) return numeric
  const match = String(value ?? '').match(/(?:周|星期)\s*([一二三四五六日天])/u)
  return match ? ({ 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 })[match[1]] : null
}

function periodNumbers(value) {
  if (Array.isArray(value)) return [...new Set(value.flatMap((item) => periodNumbers(item)))]
  const text = String(value ?? '').trim()
  if (!text) return []
  const compact = text.replace(/\D/gu, '')
  if (!/[-~至到]/u.test(text) && /^(?:\d{2}){2,}$/u.test(compact)) {
    const pairs = compact.match(/\d{2}/g)?.map(Number).filter((item) => item >= 1 && item <= 32) || []
    if (pairs.length) return pairs
  }
  const periods = []
  for (const match of text.matchAll(/(\d+)(?:\s*[-~至到]\s*(\d+))?/gu)) {
    const start = Number(match[1])
    const end = Number(match[2] || match[1])
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue
    const low = Math.max(1, Math.min(start, end))
    const high = Math.min(32, Math.max(start, end))
    for (let period = low; period <= high; period += 1) periods.push(period)
  }
  return [...new Set(periods)]
}

function scheduleOccursInWeek(value, week) {
  if (Array.isArray(value)) return value.some((item) => Number(item) === week)
  const text = String(value ?? '').replace(/\s+/gu, '').replace(/[～—–－]/gu, '-')
  const matches = [...text.matchAll(/(\d+)(?:[-~至到](\d+))?/gu)]
  if (!matches.length) return false
  return matches.some((match, index) => {
    const start = Number(match[1])
    const end = Number(match[2] || match[1])
    if (!Number.isFinite(start) || !Number.isFinite(end) || week < start || week > end) return false
    const nextStart = matches[index + 1]?.index ?? text.length
    const suffix = text.slice((match.index || 0) + match[0].length, nextStart)
    const odd = /单|奇/u.test(suffix)
    const even = /双|偶/u.test(suffix)
    return odd !== even ? (odd ? week % 2 === 1 : week % 2 === 0) : true
  })
}

function scheduleOverlapsQuery(item, query) {
  const termId = String(query?.termId || query?.term?.id || '').trim()
  if (!termId || String(item?.termId || '').trim() !== termId) return false
  const weekdays = new Set((Array.isArray(query?.weekdays) ? query.weekdays : []).map(Number).filter((day) => day >= 1 && day <= 7))
  const periods = new Set((Array.isArray(query?.periods) ? query.periods : []).map(Number).filter((period) => period >= 1 && period <= 32))
  const weeks = (Array.isArray(query?.weeks) ? query.weeks : []).map(Number).filter((week) => Number.isInteger(week) && week >= 1)
  const weekday = weekdayNumber(item?.weekday)
  const itemPeriods = periodNumbers(item?.period)
  if (!weekdays.size || !periods.size || !weeks.length || !weekdays.has(weekday) || !itemPeriods.some((period) => periods.has(period))) return false
  return weeks.some((week) => scheduleOccursInWeek(item?.weeks, week))
}

// The endpoint should already apply the time filters. This local check is a
// conservative backstop for deployments that return the full classroom list.
export function filterOccupiedFreeClassrooms(records, schedule, query) {
  const candidates = Array.isArray(records) ? records : []
  const occupied = (Array.isArray(schedule) ? schedule : [])
    .filter((item) => scheduleOverlapsQuery(item, query))
    .flatMap((item) => roomValues(item, ['room', 'location', 'classroom', 'place']))
  if (!occupied.length) return { records: candidates, excludedCount: 0 }
  const occupiedKeys = new Set(occupied)
  const filtered = candidates.filter((record) => {
    const keys = roomValues(record, ['classroom', 'classroom2', 'room', 'location', 'cdmc', 'cdbh'])
    return !keys.some((key) => occupiedKeys.has(key))
  })
  return { records: filtered, excludedCount: candidates.length - filtered.length }
}
