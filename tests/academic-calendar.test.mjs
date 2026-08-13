import test from 'node:test'
import assert from 'node:assert/strict'
import { academicCalendarWeek, normalizeAcademicCalendar } from '../core/academic-calendar.mjs'

test('academic calendar maps a date to the official term and teaching week', () => {
  const calendar = normalizeAcademicCalendar({
    schoolYear: '2025-2026',
    semesters: [
      { label: '第一学期', startDate: '2025-09-01', endDate: '2026-01-18', weeks: 20 },
      { label: '第二学期', startDate: '2026-03-02', endDate: '2026-07-05', weeks: 18 },
    ],
  })
  assert.deepEqual(academicCalendarWeek(calendar, new Date('2025-09-01T12:00:00')), {
    schoolYear: '2025-2026', semesterIndex: 1, semesterLabel: '第一学期', termId: '2025-3', week: 1, of: 20, date: '2025-09-01',
  })
  assert.equal(academicCalendarWeek(calendar, new Date('2026-03-09T12:00:00')).week, 2)
  assert.equal(academicCalendarWeek(calendar, new Date('2026-02-01T12:00:00')), null)
})
