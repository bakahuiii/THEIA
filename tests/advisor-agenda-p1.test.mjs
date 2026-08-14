import test from 'node:test'
import assert from 'node:assert/strict'
import { createAdvisorOverview } from '../core/advisor/index.mjs'
import { CURRENT_CAPTURE, domainOutcome, versionedState } from './fixtures/advisor-fixtures.mjs'

const OPTIONS = {
  now: '2026-08-13T00:00:00.000Z',
  timeZone: 'Asia/Shanghai',
  rulesVersion: 'theia-advisor-rules/v1',
}

test('official calendar selection windows join the same deterministic agenda and evidence chain', () => {
  const versioned = versionedState({
    dataCatalog: {
      collections: {
        academicCalendar: {
          lastRefreshedAt: CURRENT_CAPTURE,
          analysis: {
            weeklyCalendar: {
              source: { assetKey: 'weeklyCalendar', parsedAt: CURRENT_CAPTURE },
              courseSelectionWindows: [{
                id: 'window-1',
                summary: '学生网上正选下学期课程',
                dateText: '8月14日～8月16日',
                startAt: '2026-08-14T00:00',
                endAt: '2026-08-16T23:59',
              }],
            },
          },
        },
      },
    },
  }, {
    'academic-calendar': domainOutcome({ source: ['official-calendar'] }),
    assignments: domainOutcome({ emptyConfirmed: true }),
    exams: domainOutcome({ emptyConfirmed: true }),
    grades: domainOutcome({ emptyConfirmed: true }),
    'academic-progress': domainOutcome({ emptyConfirmed: true }),
  })
  const overview = createAdvisorOverview(versioned, OPTIONS)
  const window = overview.urgentItems.find((entry) => entry.kind === 'window')

  assert.ok(window)
  assert.equal(window.actionKind, 'review-course-selection-window')
  assert.equal(window.score.components.impact, 'official-window')
  assert.equal(window.evidenceRefs.every((id) => overview.evidence.some((entry) => entry.id === id)), true)
  assert.equal(window.claimIds.every((id) => overview.claims.some((entry) => entry.id === id)), true)
})

test('invalid and expired calendar windows never become agenda deadlines', () => {
  const versioned = versionedState({
    dataCatalog: { collections: { academicCalendar: { analysis: { weeklyCalendar: {
      courseSelectionWindows: [
        { id: 'invalid', summary: '选课', startAt: '待定', endAt: '待定' },
        { id: 'past', summary: '选课', startAt: '2026-08-01T00:00', endAt: '2026-08-02T23:59' },
      ],
    } } } } },
  }, { 'academic-calendar': domainOutcome() })
  const overview = createAdvisorOverview(versioned, OPTIONS)
  assert.equal(overview.urgentItems.some((entry) => entry.kind === 'window'), false)
})
