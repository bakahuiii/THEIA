const SEMESTER_CODES = ['3', '12', '16']

function dateOnly(value) {
  const text = String(value || '').trim()
  return /^20\d{2}-\d{2}-\d{2}$/.test(text) && Number.isFinite(new Date(`${text}T00:00:00`).getTime()) ? text : null
}

function text(value, max = 100) {
  return String(value || '').trim().replace(/[（(：:，,]+$/, '').trim().slice(0, max) || null
}

function clockTime(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/u)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function normalizePeriodTimes(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      const period = Number(item?.period)
      const startTime = clockTime(item?.startTime)
      const endTime = clockTime(item?.endTime)
      if (!Number.isInteger(period) || period < 1 || period > 16 || !startTime || !endTime || startTime >= endTime) return null
      return { period, startTime, endTime }
    })
    .filter(Boolean)
    .sort((left, right) => left.period - right.period)
    .filter((item, index, items) => index === 0 || item.period !== items[index - 1].period)
}

export function normalizeAcademicCalendar(value) {
  const source = value && typeof value === 'object' ? value : {}
  const schoolYear = /^20\d{2}-20\d{2}$/.test(String(source.schoolYear || '')) ? String(source.schoolYear) : null
  const semesters = (Array.isArray(source.semesters) ? source.semesters : [])
    .map((item, index) => {
      const startDate = dateOnly(item?.startDate)
      const endDate = dateOnly(item?.endDate)
      if (!startDate || !endDate || startDate > endDate) return null
      const weeks = Math.max(1, Math.min(32, Number(item?.weeks) || Math.ceil((new Date(`${endDate}T00:00:00`).getTime() - new Date(`${startDate}T00:00:00`).getTime() + 86_400_000) / 604_800_000)))
      return { label: text(item?.label) || `第${['一', '二', '三'][index] || index + 1}学期`, startDate, endDate, weeks }
    })
    .filter(Boolean)
    .sort((left, right) => left.startDate.localeCompare(right.startDate))
  const vacations = (Array.isArray(source.vacations) ? source.vacations : [])
    .map((item) => {
      const startDate = dateOnly(item?.startDate)
      const endDate = dateOnly(item?.endDate)
      return startDate && endDate && startDate <= endDate ? { label: text(item?.label) || '假期', startDate, endDate } : null
    }).filter(Boolean)
  const specialDates = (Array.isArray(source.specialDates) ? source.specialDates : [])
    .map((item) => ({ label: text(item?.label) || '特殊日期', date: dateOnly(item?.date) }))
    .filter((item) => item.date)
  return {
    schema: 'theia-academic-calendar/v1',
    schoolYear,
    parsedAt: typeof source.parsedAt === 'string' ? source.parsedAt : null,
    semesters,
    vacations,
    specialDates,
    periodTimes: normalizePeriodTimes(source.periodTimes),
  }
}

export function academicCalendarWeek(calendar, value = new Date()) {
  const normalized = normalizeAcademicCalendar(calendar)
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const localDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, '0')}-${String(localDate.getDate()).padStart(2, '0')}`
  const semesterIndex = normalized.semesters.findIndex((item) => item.startDate <= day && day <= item.endDate)
  if (semesterIndex < 0) return null
  const semester = normalized.semesters[semesterIndex]
  const start = new Date(`${semester.startDate}T00:00:00`).getTime()
  const week = Math.min(semester.weeks, Math.max(1, Math.floor((localDate.getTime() - start) / 604_800_000) + 1))
  const year = Number.parseInt(String(normalized.schoolYear || '').slice(0, 4), 10)
  return {
    schoolYear: normalized.schoolYear,
    semesterIndex: semesterIndex + 1,
    semesterLabel: semester.label,
    termId: Number.isFinite(year) ? `${year}-${SEMESTER_CODES[semesterIndex] || ''}` : null,
    week,
    of: semester.weeks,
    date: day,
  }
}

export function nextAcademicCalendarBoundary(calendar, value = new Date()) {
  const normalized = normalizeAcademicCalendar(calendar)
  const now = value instanceof Date ? value : new Date(value)
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return normalized.semesters.find((item) => item.startDate > today)?.startDate || null
}
