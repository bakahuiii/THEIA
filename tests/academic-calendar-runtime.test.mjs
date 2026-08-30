import test from 'node:test'
import assert from 'node:assert/strict'
import { createAcademicCalendarRuntime } from '../electron/academic-calendar-runtime.mjs'

function createStore() {
  let state = {
    settings: { academicApiEnabled: false },
    academicExtras: { domains: {} },
    dataCatalog: {},
  }
  return {
    snapshot: () => state,
    update: async (mutator) => {
      state = mutator(state)
      return state
    },
  }
}

test('academic calendar runtime serializes refreshes and commits the provenance catalog', async () => {
  const store = createStore()
  const diagnostics = []
  const sent = []
  let refreshCalls = 0
  const service = {
    needsRefresh: () => true,
    refresh: async () => {
      refreshCalls += 1
      await new Promise((resolve) => setTimeout(resolve, 10))
      return {
        calendar: { schoolYear: '2026-2027', semesters: [] },
        assets: { calendar: { filename: 'calendar_current.jpg' } },
      }
    },
    snapshot: () => ({ calendar: null, assets: {} }),
  }
  const runtime = createAcademicCalendarRuntime({
    store,
    academicAttachmentStore: {},
    academicCalendarAssetsService: service,
    writeDiagnostic: async (event, fields) => diagnostics.push({ event, fields }),
    sendSnapshot: () => sent.push(true),
  })

  await Promise.all([
    runtime.refreshAcademicCalendarAssets({ trigger: 'test-1' }),
    runtime.refreshAcademicCalendarAssets({ trigger: 'test-2' }),
  ])

  assert.equal(refreshCalls, 1)
  assert.equal(sent.length, 1)
  assert.equal(store.snapshot().dataCatalog.collections.academicCalendar.calendar.schoolYear, '2026-2027')
  assert.deepEqual(diagnostics.map(({ event }) => event), ['academic_calendar.refresh_finished'])
  assert.equal(runtime.refreshInFlight, null)
})

test('academic calendar runtime preserves the last catalog after a failed refresh', async () => {
  const store = createStore()
  const service = {
    needsRefresh: () => true,
    refresh: async () => { throw new Error('OCR unavailable') },
    snapshot: () => ({ calendar: null, assets: {} }),
  }
  const runtime = createAcademicCalendarRuntime({ store, academicCalendarAssetsService: service })

  await assert.rejects(runtime.refreshAcademicCalendarAssets({ force: true }), /OCR unavailable/)
  const outcome = store.snapshot().sync.domains['academic-calendar']
  assert.equal(outcome.status, 'failed')
  assert.equal(outcome.errorCode, 'academic_calendar_refresh_failed')
})
