import test from 'node:test'
import assert from 'node:assert/strict'
import { academicPlanAssetBaseUrl, academicPlanAssetUrl, calendarAssetUrl, parseCalendarAssetUrl } from '../electron/calendar-asset-protocol.mjs'

test('calendar protocol exposes fixed calendar assets and validated cultivation-plan PDFs', () => {
  assert.equal(calendarAssetUrl('calendar'), 'theia-calendar://local/calendar')
  assert.equal(calendarAssetUrl('teachingSchedule'), 'theia-calendar://local/teaching-schedule')
  assert.equal(calendarAssetUrl('weeklyCalendar'), 'theia-calendar://local/weekly-calendar')
  assert.deepEqual(parseCalendarAssetUrl(calendarAssetUrl('calendar')), { key: 'calendar', mediaType: 'image/jpeg' })
  assert.deepEqual(parseCalendarAssetUrl(calendarAssetUrl('teachingSchedule')), { key: 'teachingSchedule', mediaType: 'application/pdf' })
  assert.deepEqual(parseCalendarAssetUrl(`${calendarAssetUrl('teachingSchedule')}#page=1&view=FitH&toolbar=0`), { key: 'teachingSchedule', mediaType: 'application/pdf' })
  assert.equal(academicPlanAssetBaseUrl(), 'theia-calendar://local/academic-plan/')
  assert.equal(academicPlanAssetUrl('plan_1'), 'theia-calendar://local/academic-plan/plan_1')
  assert.deepEqual(parseCalendarAssetUrl(`${academicPlanAssetUrl('plan_1')}#page=1&view=FitH&toolbar=0`), { key: 'academicPlan', attachmentId: 'plan_1', mediaType: 'application/pdf' })
  assert.throws(() => calendarAssetUrl('unknown'), /Unknown academic calendar asset/)
  assert.throws(() => academicPlanAssetUrl('../plan'), /Invalid academic plan attachment/)
})

test('calendar protocol rejects traversal, URL decorations, alternate authority, and unknown keys', () => {
  for (const url of [
    'theia-calendar://local/../calendar',
    'theia-calendar://local/%2e%2e/calendar',
    'theia-calendar://local/%2e%2e%2fcalendar',
    'theia-calendar://local/calendar?path=C:/secret',
    'theia-calendar://local/calendar#fragment',
    'theia-calendar://local/teaching-schedule#download=1',
    'theia-calendar://local/teaching-schedule#page=1&page=2',
    'theia-calendar://local/teaching-schedule#page=0',
    'theia-calendar://local/teaching-schedule#page=1%0Atoolbar=1',
    'theia-calendar://local:99/calendar',
    'theia-calendar://user@local/calendar',
    'theia-calendar://evil/calendar',
    'theia-calendar://local/CALENDAR',
    'theia-calendar://local/unknown',
    'theia-calendar://local/academic-plan',
    'theia-calendar://local/academic-plan/../secret',
    'theia-calendar://local/academic-plan/plan?path=C:/secret',
    'theia-calendar://local/academic-plan/plan#download=1',
    'file:///C:/secret.pdf',
  ]) assert.equal(parseCalendarAssetUrl(url), null, url)
})
