import test from 'node:test'
import assert from 'node:assert/strict'
import { academicCalendarWeek, normalizeAcademicCalendar } from '../core/academic-calendar.mjs'

test('academic calendar maps a date to the official term and teaching week', () => {
  const calendar = normalizeAcademicCalendar({
    schoolYear: '2025-2026',
    periodTimes: [
      { period: 2, startTime: '8:50', endTime: '09:35' },
      { period: 1, startTime: '08:00', endTime: '08:45' },
      { period: 99, startTime: '10:00', endTime: '10:45' },
    ],
    semesters: [
      { label: '第一学期', startDate: '2025-09-01', endDate: '2026-01-18', weeks: 20 },
      { label: '第二学期', startDate: '2026-03-02', endDate: '2026-07-05', weeks: 18 },
    ],
  })
  assert.deepEqual(calendar.periodTimes, [
    { period: 1, startTime: '08:00', endTime: '08:45' },
    { period: 2, startTime: '08:50', endTime: '09:35' },
  ])
  assert.deepEqual(academicCalendarWeek(calendar, new Date('2025-09-01T12:00:00')), {
    schoolYear: '2025-2026', semesterIndex: 1, semesterLabel: '第一学期', termId: '2025-3', week: 1, of: 20, date: '2025-09-01',
  })
  assert.equal(academicCalendarWeek(calendar, new Date('2026-03-09T12:00:00')).week, 2)
  assert.equal(academicCalendarWeek(calendar, new Date('2026-02-01T12:00:00')), null)
})

test('academic calendar week uses China date around UTC midnight', () => {
  const calendar = {
    schoolYear: '2026-2027',
    semesters: [{ label: '第一学期', startDate: '2026-08-31', endDate: '2027-01-17', weeks: 20 }],
  }
  const beforeShanghaiMidnight = new Date('2026-09-01T15:59:59.000Z')
  const afterShanghaiMidnight = new Date('2026-09-01T16:00:00.000Z')
  assert.equal(academicCalendarWeek(calendar, beforeShanghaiMidnight)?.date, '2026-09-01')
  assert.equal(academicCalendarWeek(calendar, afterShanghaiMidnight)?.date, '2026-09-02')
})
