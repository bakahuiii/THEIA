import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyState } from '../core/schema.mjs'
import {
  failAcademicCalendarCatalog,
  failFitnessCatalog,
  failSchoolScheduleCatalog,
  loadAcademicCalendarCatalog,
  updateAcademicCalendarCatalog,
  updateFitnessCatalog,
  updateSchoolScheduleCatalog,
} from '../core/catalog-provenance.mjs'
import { computeDomainDigests } from '../core/domain-provenance.mjs'

const AT = '2026-08-13T01:00:00.000Z'
const DONE = '2026-08-13T01:00:01.000Z'

function calendarManifest(overrides = {}) {
  return {
    updatedAt: DONE,
    assets: {
      calendar: { filename: 'calendar_current.jpg', fetchedAt: DONE },
      teachingSchedule: { filename: 'teaching_schedule_current.pdf', fetchedAt: DONE },
      weeklyCalendar: { filename: 'weekly_calendar_current.pdf', fetchedAt: DONE },
    },
    calendar: { schoolYear: '2026-2027', semesters: [{ label: '第一学期', startDate: '2026-09-01', endDate: '2027-01-17', weeks: 20 }] },
    analysis: { parserVersion: 'fixture/v1' },
    calendarError: null,
    analysisError: null,
    ...overrides,
  }
}

test('local academic-calendar load preserves a null remote watermark', () => {
  const state = loadAcademicCalendarCatalog(emptyState(), { manifest: calendarManifest({ updatedAt: null, assets: {}, calendar: null, analysis: null }), runId: 'calendar-load' })
  assert.equal(state.dataCatalog.collections.academicCalendar.lastRefreshedAt, null)
  assert.equal(state.sync.domains['academic-calendar'].status, 'not-attempted')
  assert.equal(state.sync.domains['academic-calendar'].capturedAt, null)
  assert.equal(state.sync.domains['academic-calendar'].completeness, 'unknown')
})

test('an empty local academic-calendar manifest does not erase prior catalog content', () => {
  const previous = updateAcademicCalendarCatalog(emptyState(), {
    manifest: calendarManifest(), runId: 'calendar-existing', attemptedAt: AT, completedAt: DONE,
  })
  const state = loadAcademicCalendarCatalog(previous, {
    manifest: calendarManifest({ updatedAt: null, assets: {}, calendar: null, analysis: null }), runId: 'calendar-load-empty',
  })
  assert.equal(state.dataCatalog.collections.academicCalendar.calendar.schoolYear, '2026-2027')
  assert.equal(state.sync.domains['academic-calendar'].runId, 'calendar-existing')
})

test('startup calendar loading cannot retain complete provenance for different mirrored content', () => {
  const previous = updateAcademicCalendarCatalog(emptyState(), {
    manifest: calendarManifest({
      updatedAt: '2026-08-10T01:00:00.000Z',
      calendar: { schoolYear: '2025-2026', semesters: [] },
    }),
    runId: 'calendar-existing',
    attemptedAt: '2026-08-10T00:59:59.000Z',
    completedAt: '2026-08-10T01:00:00.000Z',
  })
  const state = loadAcademicCalendarCatalog(previous, {
    manifest: calendarManifest({
      calendar: { schoolYear: '2026-2027', semesters: [] },
      analysis: null,
      analysisError: 'analysis failed',
    }),
    runId: 'calendar-startup-load',
  })

  assert.equal(state.dataCatalog.collections.academicCalendar.calendar.schoolYear, '2026-2027')
  assert.equal(state.sync.domains['academic-calendar'].runId, 'calendar-startup-load')
  assert.equal(state.sync.domains['academic-calendar'].status, 'not-attempted')
  assert.equal(state.sync.domains['academic-calendar'].capturedAt, null)
  assert.equal(state.sync.domains['academic-calendar'].completeness, 'unknown')
})

test('academic-calendar refresh commits data and complete provenance together', () => {
  const state = updateAcademicCalendarCatalog(emptyState(), { manifest: calendarManifest(), runId: 'calendar-refresh', attemptedAt: AT, completedAt: DONE })
  assert.equal(state.dataCatalog.collections.academicCalendar.lastRefreshedAt, DONE)
  assert.equal(state.sync.domains['academic-calendar'].completeness, 'complete')
  assert.equal(state.sync.domains['academic-calendar'].capturedAt, DONE)
  assert.equal(state.sync.domains['local-data-catalog'].completeness, 'unknown')
})

test('academic-calendar parser errors cannot be complete', () => {
  const state = updateAcademicCalendarCatalog(emptyState(), {
    manifest: calendarManifest({ calendarError: 'OCR failed' }), runId: 'calendar-partial', attemptedAt: AT, completedAt: DONE,
  })
  assert.equal(state.sync.domains['academic-calendar'].completeness, 'partial')
  assert.equal(state.sync.domains['academic-calendar'].outcomes['academic-calendar'].errorCode, 'academic_calendar_parse_failed')
})

test('fitness is complete only when every declared year was read', () => {
  const first = {
    yearKey: '2025-2026_1', vitality: 4000,
    availableYears: [{ yearKey: '2025-2026_1' }, { yearKey: '2024-2025_1' }],
  }
  const partial = updateFitnessCatalog(emptyState(), {
    results: [first], failures: [{ yearKey: '2024-2025_1', status: 'auth-required', errorCode: 'fitness_auth_required' }],
    runId: 'fitness-partial', attemptedAt: AT, completedAt: DONE,
  })
  assert.equal(partial.sync.domains.fitness.status, 'auth-required')
  assert.equal(partial.sync.domains.fitness.completeness, 'partial')
  assert.equal(partial.dataCatalog.collections.fitness.records['2025-2026_1'].capturedAt, DONE)
  assert.equal(partial.dataCatalog.collections.fitness.lastRefreshedAt, null)

  const complete = updateFitnessCatalog(emptyState(), {
    results: [first, { yearKey: '2024-2025_1', availableYears: first.availableYears }], failures: [],
    runId: 'fitness-complete', attemptedAt: AT, completedAt: DONE,
  })
  assert.equal(complete.sync.domains.fitness.status, 'succeeded')
  assert.equal(complete.sync.domains.fitness.completeness, 'complete')
  assert.equal(complete.sync.domains.fitness.emptyConfirmed, false)
})

test('a successfully read empty fitness year is confirmed empty without failing the domain', () => {
  const emptyYear = {
    yearKey: '2026-2027_1',
    availableYears: [{ yearKey: '2026-2027_1', label: '2026年(1)' }],
    vitality: null,
    run50: null,
    flex: null,
    jump: null,
    strength: null,
    endureSecs: null,
  }
  const state = updateFitnessCatalog(emptyState(), {
    results: [emptyYear],
    failures: [],
    runId: 'fitness-confirmed-empty',
    attemptedAt: AT,
    completedAt: DONE,
  })

  assert.equal(state.sync.domains.fitness.status, 'succeeded')
  assert.equal(state.sync.domains.fitness.completeness, 'complete')
  assert.equal(state.sync.domains.fitness.emptyConfirmed, true)
  assert.equal(state.sync.domains.fitness.outcomes['fitness:2026-2027_1'].emptyConfirmed, true)
  assert.equal(state.dataCatalog.collections.fitness.records['2026-2027_1'].refreshState, 'empty')
})

test('partial and all-failed fitness runs do not manufacture an aggregate success watermark', () => {
  const availableYears = [{ yearKey: '2025-2026_1' }, { yearKey: '2024-2025_1' }]
  let state = updateFitnessCatalog(emptyState(), {
    results: [
      { yearKey: '2025-2026_1', vitality: 4000, availableYears },
      { yearKey: '2024-2025_1', vitality: 3900, availableYears },
    ],
    runId: 'fitness-complete', attemptedAt: AT, completedAt: AT, capturedAt: AT,
  })
  assert.equal(state.dataCatalog.collections.fitness.lastRefreshedAt, AT)

  state = updateFitnessCatalog(state, {
    results: [{ yearKey: '2025-2026_1', vitality: 4100, availableYears }],
    failures: [{ yearKey: '2024-2025_1', status: 'failed', errorCode: 'fitness_year_read_failed' }],
    runId: 'fitness-partial', attemptedAt: DONE, completedAt: DONE, capturedAt: DONE,
  })
  assert.equal(state.dataCatalog.collections.fitness.lastRefreshedAt, AT)
  assert.equal(state.dataCatalog.collections.fitness.records['2025-2026_1'].capturedAt, DONE)
  assert.equal(state.sync.domains.fitness.status, 'failed')
  assert.equal(state.sync.domains.fitness.completeness, 'partial')

  const catalogBeforeFailure = structuredClone(state.dataCatalog)
  const digestsBeforeFailure = computeDomainDigests(state)
  state = updateFitnessCatalog(state, {
    results: [],
    failures: [{ yearKey: '2025-2026_1', status: 'failed', errorCode: 'fitness_year_read_failed' }],
    runId: 'fitness-all-failed',
    attemptedAt: '2026-08-13T02:00:00.000Z',
    completedAt: '2026-08-13T02:00:01.000Z',
    capturedAt: '2026-08-13T02:00:01.000Z',
  })
  assert.equal(state.dataCatalog.collections.fitness.lastRefreshedAt, AT)
  assert.equal(state.dataCatalog.collections.fitness.records['2025-2026_1'].capturedAt, DONE)
  assert.deepEqual(state.dataCatalog, catalogBeforeFailure)
  assert.equal(computeDomainDigests(state).fitness, digestsBeforeFailure.fitness)
  assert.equal(computeDomainDigests(state)['local-data-catalog'], digestsBeforeFailure['local-data-catalog'])
  assert.equal(state.sync.domains.fitness.status, 'failed')
  assert.equal(state.sync.domains.fitness.retainedPrevious, true)
})

test('school schedule requires complete true and confirms empty only for a complete zero result', () => {
  const partial = updateSchoolScheduleCatalog(emptyState(), {
    result: { scope: { termId: '2026-3' }, complete: false, total: 1, items: [{ title: '高等数学' }], capturedAt: DONE },
    runId: 'schedule-partial', attemptedAt: AT, completedAt: DONE,
  })
  assert.equal(partial.sync.domains['school-schedule'].completeness, 'partial')
  assert.equal(partial.sync.domains['school-schedule'].emptyConfirmed, false)

  const empty = updateSchoolScheduleCatalog(emptyState(), {
    result: { scope: { termId: '2026-3' }, complete: true, total: 0, items: [], capturedAt: DONE },
    runId: 'schedule-empty', attemptedAt: AT, completedAt: DONE,
  })
  assert.equal(empty.sync.domains['school-schedule'].completeness, 'complete')
  assert.equal(empty.sync.domains['school-schedule'].emptyConfirmed, true)
  assert.equal(empty.sync.domains['school-schedule'].contentEmptyConfirmed, true)
})

test('catalog failures preserve old content and classify authentication failures', () => {
  let state = updateSchoolScheduleCatalog(emptyState(), {
    result: { scope: { termId: '2026-3' }, complete: true, total: 1, items: [{ title: '高等数学' }], capturedAt: AT },
    runId: 'schedule-ok', attemptedAt: AT, completedAt: AT,
  })
  state = failSchoolScheduleCatalog(state, { runId: 'schedule-fail', attemptedAt: DONE, completedAt: DONE, status: 'auth-required', errorCode: 'school_schedule_auth_required' })
  assert.equal(state.sync.domains['school-schedule'].retainedPrevious, true)
  assert.equal(state.sync.domains['school-schedule'].status, 'auth-required')
  assert.equal(state.sync.domains['school-schedule'].capturedAt, AT)

  const calendar = failAcademicCalendarCatalog(emptyState(), { runId: 'calendar-fail', attemptedAt: AT, completedAt: DONE, errorCode: 'calendar_read_failed' })
  const fitness = failFitnessCatalog(emptyState(), { runId: 'fitness-fail', attemptedAt: AT, completedAt: DONE, errorCode: 'fitness_read_failed' })
  assert.equal(calendar.sync.domains['academic-calendar'].completeness, 'unknown')
  assert.equal(fitness.sync.domains.fitness.retainedPrevious, false)
})

test('a whole-fitness refresh failure preserves the last successful aggregate watermark', () => {
  let state = updateFitnessCatalog(emptyState(), {
    results: [{ yearKey: '2025-2026_1', vitality: 4000, availableYears: [{ yearKey: '2025-2026_1' }] }],
    runId: 'fitness-ok', attemptedAt: AT, completedAt: AT, capturedAt: AT,
  })
  state = failFitnessCatalog(state, {
    runId: 'fitness-fail', attemptedAt: DONE, completedAt: DONE, errorCode: 'fitness_read_failed',
  })
  assert.equal(state.sync.domains.fitness.status, 'failed')
  assert.equal(state.sync.domains.fitness.retainedPrevious, true)
  assert.equal(state.sync.domains.fitness.capturedAt, AT)
  assert.equal(state.sync.domains.fitness.sourceSucceededAt, AT)
})

test('a failure after confirmed empty preserves the content conclusion but not attempt success', () => {
  let state = updateSchoolScheduleCatalog(emptyState(), {
    result: { scope: { termId: '2026-3' }, complete: true, total: 0, items: [], capturedAt: AT },
    runId: 'schedule-empty', attemptedAt: AT, completedAt: AT,
  })
  state = failSchoolScheduleCatalog(state, {
    runId: 'schedule-failed-after-empty', attemptedAt: DONE, completedAt: DONE, errorCode: 'school_schedule_read_failed',
  })
  assert.equal(state.sync.domains['school-schedule'].status, 'failed')
  assert.equal(state.sync.domains['school-schedule'].emptyConfirmed, false)
  assert.equal(state.sync.domains['school-schedule'].contentEmptyConfirmed, true)
})
