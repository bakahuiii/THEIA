import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'

const require = createRequire(import.meta.url)
const DAY_MS = 86_400_000
const REGION_SCALE = 4
const REGION_PADDING = 16
const PERIOD_TIME_THRESHOLD = 160
const PERIOD_TIME_REFERENCE = { width: 2428, height: 1280 }

const CALENDAR_REGIONS = [
  { key: 'semester-1', kind: 'semester', label: '第一学期', x: 0.525, y: 0.073, width: 0.215, height: 0.04, pageSegMode: '11' },
  // The current right-hand calendar heading shares its crop with a dense grid;
  // sparse-text mode preserves both dates where single-line mode drops them.
  { key: 'semester-2', kind: 'semester', label: '第二学期', x: 0.775, y: 0.073, width: 0.22, height: 0.04, pageSegMode: '11' },
  { key: 'semester-3', kind: 'semester', label: '第三学期', x: 0.775, y: 0.59, width: 0.22, height: 0.04, pageSegMode: '7' },
  { key: 'winter-vacation', kind: 'vacation', label: '寒假', specialDateLabel: '春节', x: 0.525, y: 0.817, width: 0.22, height: 0.055, pageSegMode: '11' },
  // The pale date line loses digits during thresholding on the current scan.
  { key: 'summer-vacation', kind: 'vacation', label: '暑假', x: 0.775, y: 0.817, width: 0.22, height: 0.055, pageSegMode: '7', preprocess: 'grayscale', scale: 6, padding: 24 },
]

const REGION_BY_KEY = new Map(CALENDAR_REGIONS.map((region) => [region.key, region]))
const PERIOD_TIME_ROWS = [
  [229, 277], [294, 340], [420, 466], [547, 593], [610, 656], [673, 721],
  [738, 784], [865, 911], [927, 975], [991, 1039], [1055, 1103], [1118, 1166],
].map(([top, bottom], index) => ({
  period: index + 1,
  full: { x: 330 / PERIOD_TIME_REFERENCE.width, y: top / PERIOD_TIME_REFERENCE.height, width: 210 / PERIOD_TIME_REFERENCE.width, height: (bottom - top) / PERIOD_TIME_REFERENCE.height },
  start: { x: 335 / PERIOD_TIME_REFERENCE.width, y: top / PERIOD_TIME_REFERENCE.height, width: 90 / PERIOD_TIME_REFERENCE.width, height: (bottom - top) / PERIOD_TIME_REFERENCE.height },
  end: { x: 435 / PERIOD_TIME_REFERENCE.width, y: top / PERIOD_TIME_REFERENCE.height, width: 100 / PERIOD_TIME_REFERENCE.width, height: (bottom - top) / PERIOD_TIME_REFERENCE.height },
  alternateStart: { x: 320 / PERIOD_TIME_REFERENCE.width, y: top / PERIOD_TIME_REFERENCE.height, width: 110 / PERIOD_TIME_REFERENCE.width, height: (bottom - top) / PERIOD_TIME_REFERENCE.height },
  alternateEnd: { x: 420 / PERIOD_TIME_REFERENCE.width, y: top / PERIOD_TIME_REFERENCE.height, width: 130 / PERIOD_TIME_REFERENCE.width, height: (bottom - top) / PERIOD_TIME_REFERENCE.height },
}))

function dateOnly(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function numericTokens(value) {
  const runs = String(value || '').match(/\d+/g) || []
  return runs.flatMap((run) => {
    const yearAt = run.search(/20\d{2}/)
    if (yearAt < 0) return [run]
    const year = run.slice(yearAt, yearAt + 4)
    const suffix = run.slice(yearAt + 4)
    return suffix ? [year, suffix] : [year]
  })
}

function datesIn(value) {
  const values = numericTokens(value)
  let currentYear = null
  const dates = []
  for (let index = 0; index < values.length;) {
    const value = values[index]
    if (value.length === 4 && value.startsWith('20')) {
      currentYear = Number(value)
      const date = index + 2 < values.length ? dateOnly(currentYear, Number(values[index + 1]), Number(values[index + 2])) : null
      if (date) {
        dates.push(date)
        index += 3
        continue
      }
    } else if (currentYear !== null && index + 1 < values.length) {
      const month = Number(value)
      const day = Number(values[index + 1])
      let year = currentYear
      const previous = dates.at(-1)
      if (previous && `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` < previous.slice(5)) year += 1
      const date = dateOnly(year, month, day)
      if (date) {
        dates.push(date)
        currentYear = year
        index += 2
        continue
      }
    }
    index += 1
  }
  return dates
}

function repairedSemanticDates(value) {
  const values = numericTokens(value)
  const years = values.filter((token) => token.length === 4 && token.startsWith('20')).map(Number)
  const monthDays = values
    .filter((token) => !(token.length === 4 && token.startsWith('20')) && !/^20\d?$/u.test(token))
    .map(Number)
  if (years.length !== 1 || monthDays.length < 4) return []
  const [startMonth, startDay, endMonth, endDay] = monthDays
  const endYear = years[0]
  const startYear = startMonth > endMonth ? endYear - 1 : endYear
  const startDate = dateOnly(startYear, startMonth, startDay)
  const endDate = dateOnly(endYear, endMonth, endDay)
  return startDate && endDate && startDate <= endDate ? [startDate, endDate] : []
}

function schoolYearIn(value) {
  const match = String(value || '').match(/(?:^|\D)(20\d{2})\s*[-–—~～]\s*(20\d{2})(?:\D|$)/u)
  if (!match || Number(match[2]) !== Number(match[1]) + 1) return null
  return `${match[1]}-${match[2]}`
}

function inferredSchoolYear(semesters) {
  const first = semesters.find((semester) => semester.label.includes('第一')) || semesters[0]
  if (!first) return null
  const year = Number(first.startDate.slice(0, 4))
  const month = Number(first.startDate.slice(5, 7))
  const startYear = month >= 8 ? year : year - 1
  return `${startYear}-${startYear + 1}`
}

function labelIn(value) {
  const match = String(value || '').trim().match(/^([^\d：:，,\s]+)/u)
  return match ? match[1].replace(/[（(]+$/u, '') : '特殊日期'
}

function weeksBetween(startDate, endDate) {
  return Math.ceil((new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime()) / (7 * DAY_MS))
}

function shiftDate(value, days) {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function inferredWinterVacation(semesters) {
  const ordered = [...semesters].sort((left, right) => left.startDate.localeCompare(right.startDate))
  const first = ordered.find((semester) => semester.label.includes('第一')) || ordered[0]
  const second = ordered.find((semester) => semester.label.includes('第二')) || ordered[1]
  if (!first || !second || first.endDate >= second.startDate) return null
  const startDate = shiftDate(first.endDate, 1)
  const endDate = shiftDate(second.startDate, -1)
  const days = (new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime()) / DAY_MS + 1
  return days >= 7 && days <= 90 ? { label: '寒假', startDate, endDate } : null
}

function inferredThirdSemester(semesters, vacations) {
  if (semesters.some((semester) => semester.label.includes('第三'))) return null
  const ordered = [...semesters].sort((left, right) => left.startDate.localeCompare(right.startDate))
  const second = ordered.find((semester) => semester.label.includes('第二')) || ordered[1]
  const summer = vacations.find((vacation) => vacation.label === '暑假')
  if (!second || !summer || second.endDate >= summer.startDate) return null
  const startDate = shiftDate(second.endDate, 1)
  const endDate = shiftDate(summer.startDate, -1)
  const days = (new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime()) / DAY_MS + 1
  return days >= 7 && days <= 42 ? { label: '第三学期', startDate, endDate, weeks: weeksBetween(startDate, endDate) } : null
}

function uniqueBy(items, keyFor) {
  return [...new Map(items.map((item) => [keyFor(item), item])).values()]
}

function normalizedClock(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/u)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function parseAcademicCalendarPeriodTimes(value) {
  const normalized = String(value || '')
    .replace(/[０-９]/gu, (character) => String.fromCharCode(character.charCodeAt(0) - 0xff10 + 0x30))
    .replace(/[：﹕]/gu, ':')
    .replace(/[—–－〜～]/gu, '~')
  const times = []
  const pattern = /(\d{1,2})\s*[:.]\s*(\d{2})\s*(?:~|-|至|到)\s*(\d{1,2})\s*[:.]\s*(\d{2})/gu
  for (const match of normalized.matchAll(pattern)) {
    const startTime = normalizedClock(`${match[1]}:${match[2]}`)
    const endTime = normalizedClock(`${match[3]}:${match[4]}`)
    if (!startTime || !endTime || startTime >= endTime) continue
    times.push({ period: times.length + 1, startTime, endTime })
  }
  return times.slice(0, 16)
}

export function parseAcademicCalendarOcrItems(items) {
  let schoolYear = null
  const semesters = []
  const vacations = []
  const specialDates = []
  const periodTimes = []
  for (const item of Array.isArray(items) ? items : []) {
    const text = String(item?.text || '').trim()
    if (item?.key === 'period-times' || parseAcademicCalendarPeriodTimes(text).length >= 2) {
      periodTimes.push(...parseAcademicCalendarPeriodTimes(text))
    }
    schoolYear ||= schoolYearIn(text)
    if (!/20\d{2}/.test(text)) continue
    let dates = datesIn(text)
    const label = String(item?.label || '').trim() || labelIn(text)
    const kind = String(item?.kind || '')
    if (dates.length < 2 && item?.key === 'semester-1') {
      const repaired = repairedSemanticDates(text)
      if (repaired.length >= 2) dates = repaired
    }
    if (dates.length >= 2 && (kind === 'semester' || kind === 'vacation')) {
      const [startDate, endDate] = dates
      if (startDate <= endDate) {
        if (kind === 'semester') semesters.push({ label, startDate, endDate, weeks: weeksBetween(startDate, endDate) })
        else vacations.push({ label, startDate, endDate })
      }
      if (item?.specialDateLabel && dates[2]) specialDates.push({ label: String(item.specialDateLabel), date: dates[2] })
      continue
    }
    if (kind === 'vacation' && item?.specialDateLabel && dates.length === 1) {
      specialDates.push({ label: String(item.specialDateLabel), date: dates[0] })
      continue
    }
    if (kind === 'semester' || kind === 'vacation') continue
    if (kind === 'special-date' && dates[0]) {
      specialDates.push({ label, date: dates[0] })
      continue
    }
    if (dates.length === 2) {
      const [startDate, endDate] = dates
      if (startDate > endDate) continue
      if (label.includes('学期')) {
        semesters.push({ label, startDate, endDate, weeks: weeksBetween(startDate, endDate) })
      } else if (label.includes('假')) {
        vacations.push({ label, startDate, endDate })
      } else if (Number(item?.y) < 500) {
        const fallback = Number(item?.x) < 3000 ? '第一学期' : '第二学期'
        semesters.push({ label: fallback, startDate, endDate, weeks: weeksBetween(startDate, endDate) })
      } else {
        vacations.push({ label: Number(startDate.slice(5, 7)) <= 3 ? '寒假' : '暑假', startDate, endDate })
      }
    } else if (dates.length === 1) {
      specialDates.push({ label, date: dates[0] })
    }
  }

  let uniqueSemesters = uniqueBy(semesters, (semester) => `${semester.startDate}\0${semester.endDate}`)
    .sort((left, right) => left.startDate.localeCompare(right.startDate))
  let uniqueVacations = uniqueBy(vacations, (vacation) => vacation.label)
  const third = inferredThirdSemester(uniqueSemesters, uniqueVacations)
  if (third) uniqueSemesters = [...uniqueSemesters, third].sort((left, right) => left.startDate.localeCompare(right.startDate))
  const winter = inferredWinterVacation(uniqueSemesters)
  if (winter) uniqueVacations = [...uniqueVacations.filter((vacation) => vacation.label !== '寒假'), winter]

  return {
    schoolYear: schoolYear || inferredSchoolYear(uniqueSemesters),
    semesters: uniqueSemesters,
    vacations: uniqueVacations.sort((left, right) => left.startDate.localeCompare(right.startDate)),
    specialDates: uniqueBy(specialDates, (item) => `${item.label}\0${item.date}`).sort((left, right) => left.date.localeCompare(right.date)),
    periodTimes: uniqueBy(periodTimes, (item) => `${item.period}\0${item.startTime}\0${item.endTime}`).sort((left, right) => left.period - right.period).slice(0, 16),
  }
}

export function parseAcademicCalendarOcrRegions(regions) {
  return parseAcademicCalendarOcrItems((Array.isArray(regions) ? regions : []).map((result) => ({
    ...(REGION_BY_KEY.get(result?.key) || {}),
    ...result,
  })))
}

function linesFromBlocks(blocks) {
  const lines = []
  for (const block of Array.isArray(blocks) ? blocks : []) {
    for (const paragraph of Array.isArray(block?.paragraphs) ? block.paragraphs : []) {
      for (const line of Array.isArray(paragraph?.lines) ? paragraph.lines : []) {
        const text = String(line?.text || '').trim()
        if (!text) continue
        lines.push({ x: Number(line?.bbox?.x0) || 0, y: Number(line?.bbox?.y0) || 0, text })
      }
    }
  }
  return lines
}

function pixelRectangle(image, region) {
  const left = Math.max(0, Math.round(image.width * region.x))
  const top = Math.max(0, Math.round(image.height * region.y))
  const width = Math.max(1, Math.min(image.width - left, Math.round(image.width * region.width)))
  const height = Math.max(1, Math.min(image.height - top, Math.round(image.height * region.height)))
  return { left, top, width, height }
}

function luminanceAt(image, x, y) {
  const offset = (y * image.width + x) * 4
  return (77 * image.data[offset] + 150 * image.data[offset + 1] + 29 * image.data[offset + 2]) >> 8
}

function otsuThreshold(image, rectangle) {
  const histogram = new Uint32Array(256)
  for (let y = rectangle.top; y < rectangle.top + rectangle.height; y += 1) {
    for (let x = rectangle.left; x < rectangle.left + rectangle.width; x += 1) histogram[luminanceAt(image, x, y)] += 1
  }
  const total = rectangle.width * rectangle.height
  let sum = 0
  for (let value = 0; value < histogram.length; value += 1) sum += value * histogram[value]
  let backgroundWeight = 0
  let backgroundSum = 0
  let maximumVariance = -1
  let threshold = 127
  for (let value = 0; value < histogram.length; value += 1) {
    backgroundWeight += histogram[value]
    if (!backgroundWeight) continue
    const foregroundWeight = total - backgroundWeight
    if (!foregroundWeight) break
    backgroundSum += value * histogram[value]
    const backgroundMean = backgroundSum / backgroundWeight
    const foregroundMean = (sum - backgroundSum) / foregroundWeight
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2
    if (variance > maximumVariance) {
      maximumVariance = variance
      threshold = value
    }
  }
  return threshold
}

function preprocessedRegionBmp(image, region) {
  const rectangle = pixelRectangle(image, region)
  const threshold = region.preprocess === 'grayscale'
    ? null
    : Number.isFinite(region.threshold) ? region.threshold : otsuThreshold(image, rectangle)
  const scale = Number.isInteger(region.scale) && region.scale > 0 ? region.scale : REGION_SCALE
  const padding = Number.isInteger(region.padding) && region.padding >= 0 ? region.padding : REGION_PADDING
  const width = rectangle.width * scale + padding * 2
  const height = rectangle.height * scale + padding * 2
  const rowBytes = Math.ceil((width * 3) / 4) * 4
  const pixelBytes = rowBytes * height
  const bmp = Buffer.alloc(54 + pixelBytes, 255)
  bmp.write('BM', 0, 'ascii')
  bmp.writeUInt32LE(bmp.length, 2)
  bmp.writeUInt32LE(54, 10)
  bmp.writeUInt32LE(40, 14)
  bmp.writeInt32LE(width, 18)
  bmp.writeInt32LE(height, 22)
  bmp.writeUInt16LE(1, 26)
  bmp.writeUInt16LE(24, 28)
  bmp.writeUInt32LE(pixelBytes, 34)
  bmp.writeInt32LE(2835, 38)
  bmp.writeInt32LE(2835, 42)

  for (let sourceY = 0; sourceY < rectangle.height; sourceY += 1) {
    for (let sourceX = 0; sourceX < rectangle.width; sourceX += 1) {
      const luminance = luminanceAt(image, rectangle.left + sourceX, rectangle.top + sourceY)
      const value = threshold === null ? luminance : luminance <= threshold ? 0 : 255
      for (let scaleY = 0; scaleY < scale; scaleY += 1) {
        const targetY = padding + sourceY * scale + scaleY
        const bmpRow = height - 1 - targetY
        for (let scaleX = 0; scaleX < scale; scaleX += 1) {
          const targetX = padding + sourceX * scale + scaleX
          const offset = 54 + bmpRow * rowBytes + targetX * 3
          bmp[offset] = value
          bmp[offset + 1] = value
          bmp[offset + 2] = value
        }
      }
    }
  }
  return bmp
}

function normalizedNumericText(value) {
  return String(value || '')
    .replace(/[０-９]/gu, (character) => String.fromCharCode(character.charCodeAt(0) - 0xff10 + 0x30))
}

function clockFromDigits(value) {
  const digits = String(value || '')
  if (digits.length !== 4) return null
  const hour = Number(digits.slice(0, 2))
  const minute = Number(digits.slice(2))
  if (hour > 23 || minute > 59) return null
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function numericClockCandidates(value) {
  const normalized = normalizedNumericText(value)
  const candidates = new Map()
  const add = (time, score) => {
    if (!time) return
    candidates.set(time, Math.max(score, candidates.get(time) || 0))
  }
  for (const match of normalized.matchAll(/(\d{1,2})\s*[:：.]\s*(\d{1,2})/gu)) {
    const minute = match[2].length === 1 ? `${match[2]}0` : match[2]
    add(clockFromDigits(`${match[1].padStart(2, '0')}${minute}`), match[2].length === 1 ? 9 : 18)
  }
  const digits = (normalized.match(/\d/g) || []).join('')
  add(clockFromDigits(digits), 14)
  if (digits.length === 3) {
    add(clockFromDigits(`0${digits}`), 7)
    add(clockFromDigits(`${digits.slice(0, 2)}${digits.slice(2)}0`), 7)
  }
  if (digits.length > 4 && digits.length <= 6) {
    for (let index = 0; index < digits.length; index += 1) {
      add(clockFromDigits(digits.slice(0, index) + digits.slice(index + 1)), 6)
    }
    if (digits.length === 6) {
      for (let first = 0; first < digits.length; first += 1) {
        for (let second = first + 1; second < digits.length; second += 1) {
          add(clockFromDigits(digits.split('').filter((_digit, index) => index !== first && index !== second).join('')), 4)
        }
      }
    }
  }
  return [...candidates.entries()].map(([time, score]) => ({ time, score }))
}

function periodTimePairCandidates(value) {
  const normalized = normalizedNumericText(value).replace(/[—–－〜～]/gu, '~')
  const splitAt = normalized.indexOf('~')
  let leftText = ''
  let rightText = ''
  if (splitAt >= 0) {
    leftText = normalized.slice(0, splitAt)
    rightText = normalized.slice(splitAt + 1)
  } else {
    const hyphens = [...normalized.matchAll(/-/gu)].map((match) => match.index).filter((index) => Number.isInteger(index))
    const split = hyphens
      .map((index) => ({ index, left: (normalized.slice(0, index).match(/\d/g) || []).length, right: (normalized.slice(index + 1).match(/\d/g) || []).length }))
      .filter((item) => item.left >= 3 && item.right >= 3)
      .sort((a, b) => Math.abs(a.left - a.right) - Math.abs(b.left - b.right))[0]
    if (split) {
      leftText = normalized.slice(0, split.index)
      rightText = normalized.slice(split.index + 1)
    }
  }
  if (!leftText || !rightText) {
    const digits = (normalized.match(/\d/g) || []).join('')
    const splits = []
    for (let index = 4; index <= digits.length - 4; index += 1) {
      const left = numericClockCandidates(digits.slice(0, index))
      const right = numericClockCandidates(digits.slice(index))
      for (const start of left) for (const end of right) splits.push({ start, end, source: 'full' })
    }
    return splits
  }
  const pairs = []
  for (const start of numericClockCandidates(leftText)) {
    for (const end of numericClockCandidates(rightText)) pairs.push({ start, end, source: 'full' })
  }
  return pairs
}

function periodTimePairFromObservation(observation, referenceDuration = null) {
  const pairs = [
    ...periodTimePairCandidates(observation.full || ''),
    ...numericClockCandidates(observation.start || '').flatMap((start) => numericClockCandidates(observation.end || '').map((end) => ({ start, end, source: 'cells' }))),
  ]
  const fullDigits = (normalizedNumericText(observation.full || '').match(/\d/g) || []).join('')
  if (fullDigits.length >= 4) {
    pairs.push(...numericClockCandidates(fullDigits.slice(0, 4)).flatMap((start) => numericClockCandidates(observation.end || '').map((end) => ({ start, end, source: 'full-start-cell-end' }))))
    pairs.push(...numericClockCandidates(observation.start || '').flatMap((start) => numericClockCandidates(fullDigits.slice(-4)).map((end) => ({ start, end, source: 'cell-start-full-end' }))))
  }
  const validPairs = pairs
    .map((pair) => ({
      ...pair,
      duration: (Date.parse(`1970-01-01T${pair.end.time}:00Z`) - Date.parse(`1970-01-01T${pair.start.time}:00Z`)) / 60_000,
    }))
    .filter((pair) => pair.duration >= 20 && pair.duration <= 180)
  if (!validPairs.length) return null
  return validPairs.sort((left, right) => {
    const leftReference = referenceDuration === null ? 0 : Math.max(0, 24 - Math.abs(left.duration - referenceDuration) * 2)
    const rightReference = referenceDuration === null ? 0 : Math.max(0, 24 - Math.abs(right.duration - referenceDuration) * 2)
    const leftScore = left.start.score + left.end.score + leftReference + (left.source.startsWith('full') ? 3 : 0)
    const rightScore = right.start.score + right.end.score + rightReference + (right.source.startsWith('full') ? 3 : 0)
    return rightScore - leftScore
  })[0]
}

function median(values) {
  const ordered = values.filter(Number.isFinite).sort((left, right) => left - right)
  return ordered.length ? ordered[Math.floor(ordered.length / 2)] : null
}

async function recognizePeriodTimeRows(worker, image) {
  const observations = []
  const recognize = async (region, pageSegMode) => {
    const result = await worker.recognize(preprocessedRegionBmp(image, {
      ...region,
      preprocess: 'threshold',
      threshold: PERIOD_TIME_THRESHOLD,
      scale: 5,
      padding: 16,
    }), {
      tessedit_pageseg_mode: pageSegMode,
      tessedit_char_whitelist: '0123456789:.-~',
    }, { text: true })
    return String(result?.data?.text || '').trim()
  }
  for (const row of PERIOD_TIME_ROWS) {
    const observation = {
      period: row.period,
      full: await recognize(row.full, '7'),
      start: await recognize(row.start, '13'),
      end: await recognize(row.end, '13'),
    }
    observations.push(observation)
  }
  const provisional = observations.map((observation) => periodTimePairFromObservation(observation)).filter(Boolean)
  const referenceDuration = median(provisional.map((pair) => pair.duration))
  for (const [index, observation] of observations.entries()) {
    const pair = periodTimePairFromObservation(observation, referenceDuration)
    if (!pair || (referenceDuration !== null && Math.abs(pair.duration - referenceDuration) > 10)) {
      observation.start = await recognize(PERIOD_TIME_ROWS[index].alternateStart, '13')
      observation.end = await recognize(PERIOD_TIME_ROWS[index].alternateEnd, '13')
    }
  }
  return observations
    .map((observation) => {
      const pair = periodTimePairFromObservation(observation, referenceDuration)
      return pair ? { period: observation.period, startTime: pair.start.time, endTime: pair.end.time } : null
    })
    .filter(Boolean)
}

function decodeCalendarJpeg(image) {
  return require('jpeg-js').decode(image, {
    useTArray: true,
    formatAsRGBA: true,
    maxResolutionInMP: 40,
    maxMemoryUsageInMB: 256,
  })
}

export function defaultOcrRuntime() {
  const language = require('@tesseract.js-data/chi_sim')
  const unpacked = (value) => String(value).replace(/([\\/])app\.asar([\\/])/u, '$1app.asar.unpacked$2')
  return {
    language: { ...language, langPath: unpacked(language.langPath) },
    numericLanguage: { ...require('@tesseract.js-data/eng'), langPath: unpacked(require('@tesseract.js-data/eng').langPath) },
    workerPath: unpacked(require.resolve('tesseract.js/src/worker-script/node/index.js')),
    corePath: unpacked(dirname(require.resolve('tesseract.js-core/tesseract-core-lstm.wasm.js'))),
  }
}

export async function runAcademicCalendarOcr(imagePath, { createWorkerImpl, onRegionText = () => {} } = {}) {
  const { createWorker } = createWorkerImpl ? { createWorker: createWorkerImpl } : require('tesseract.js')
  const runtime = defaultOcrRuntime()
  const worker = await createWorker(runtime.language.code, 1, {
    workerPath: runtime.workerPath,
    corePath: runtime.corePath,
    langPath: runtime.language.langPath,
    gzip: runtime.language.gzip,
    cacheMethod: 'none',
    errorHandler: () => {},
  })
  try {
    let decoded = null
    try {
      const encoded = Buffer.isBuffer(imagePath) || imagePath instanceof Uint8Array ? Buffer.from(imagePath) : await readFile(imagePath)
      decoded = decodeCalendarJpeg(encoded)
    } catch { /* Runtime probe and legacy callers may provide a non-JPEG image. */ }

    let periodTimes = []
    if (decoded && decoded.width >= 100) {
      try {
        const numericWorker = await createWorker(runtime.numericLanguage.code, 1, {
          workerPath: runtime.workerPath,
          corePath: runtime.corePath,
          langPath: runtime.numericLanguage.langPath,
          gzip: runtime.numericLanguage.gzip,
          cacheMethod: 'none',
          errorHandler: () => {},
        })
        try {
          periodTimes = await recognizePeriodTimeRows(numericWorker, decoded)
          onRegionText({ key: 'period-times', text: periodTimes.map((item) => `${item.period} ${item.startTime}-${item.endTime}`).join('\n') })
        } finally {
          await numericWorker.terminate()
        }
      } catch { /* A missing numeric worker must not block calendar-date OCR. */ }
    }
    if (decoded) {
      const regions = []
      for (const region of CALENDAR_REGIONS) {
        const result = await worker.recognize(preprocessedRegionBmp(decoded, region), {
          tessedit_pageseg_mode: region.pageSegMode,
        }, { text: true })
        const text = String(result?.data?.text || '').trim()
        onRegionText({ key: region.key, text })
        regions.push({ key: region.key, text })
      }
      const parsed = parseAcademicCalendarOcrRegions(regions)
      parsed.periodTimes = periodTimes
      if (parsed.semesters.length >= 2) return parsed
    }

    const result = await worker.recognize(imagePath, {}, { text: true, blocks: true })
    let items = linesFromBlocks(result?.data?.blocks)
    if (!items.length && result?.data?.text) items = [{ x: 0, y: 0, text: result.data.text }]
    const parsed = parseAcademicCalendarOcrItems(items)
    if (periodTimes.length) parsed.periodTimes = periodTimes
    return parsed
  } finally {
    await worker.terminate()
  }
}

export async function probeAcademicCalendarOcrRuntime() {
  const width = 32
  const height = 32
  const rowBytes = Math.ceil((width * 3) / 4) * 4
  const pixelBytes = rowBytes * height
  const image = Buffer.alloc(54 + pixelBytes)
  image.write('BM', 0, 'ascii')
  image.writeUInt32LE(image.length, 2)
  image.writeUInt32LE(54, 10)
  image.writeUInt32LE(40, 14)
  image.writeInt32LE(width, 18)
  image.writeInt32LE(height, 22)
  image.writeUInt16LE(1, 26)
  image.writeUInt16LE(24, 28)
  image.writeUInt32LE(pixelBytes, 34)
  image.writeInt32LE(2835, 38)
  image.writeInt32LE(2835, 42)
  image.fill(255, 54)
  const result = await runAcademicCalendarOcr(image)
  return result?.schoolYear === null && Array.isArray(result?.semesters)
}
