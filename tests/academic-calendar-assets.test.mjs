import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { AcademicCalendarAssetsService } from '../core/academic-calendar-assets.mjs'

const PAGES = {
  calendar: '<img src="/_upload/article/images/ab/cd/abc-def.jpg">',
  teaching: '<a href="/_upload/article/files/ab/cd/abc-def.pdf">教学进程表</a>',
  weekly: '<a href="/_upload/article/files/ef/01/ef0-123.pdf">周历</a>',
}

function responseFor(url, badPdf = false) {
  if (url.includes('/c3201a46856/')) return new Response(PAGES.calendar)
  if (url.includes('/c3207a46873/')) return new Response(PAGES.teaching)
  if (url.includes('/c3199a46850/')) return new Response(PAGES.weekly)
  if (url.endsWith('_d.jpg')) return new Response(Buffer.alloc(2048, 7))
  if (url.endsWith('.pdf')) return new Response(badPdf ? 'not a pdf' : Buffer.from('%PDF-1.7\nfixture'))
  return new Response('missing', { status: 404 })
}

test('academic calendar caches the three official assets until the refresh boundary', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-calendar-'))
  let calls = 0
  try {
    const service = new AcademicCalendarAssetsService({
      root,
      fetchImpl: async (url) => { calls += 1; return responseFor(String(url)) },
      ocrRunner: async () => ({
        schoolYear: '2025-2026',
        semesters: [{ label: '第一学期', startDate: '2025-09-01', endDate: '2026-01-18', weeks: 20 }],
        vacations: [], specialDates: [],
        periodTimes: [{ period: 1, startTime: '08:00', endTime: '08:45' }],
      }),
    })
    await service.load()
    const result = await service.refresh()
    assert.equal(calls, 6)
    assert.equal(Object.keys(result.assets).length, 3)
    assert.equal(result.assets.calendar.filename, 'calendar_current.jpg')
    assert.equal(result.calendar.schoolYear, '2025-2026')
    assert.equal(result.calendar.semesters[0].weeks, 20)
    assert.deepEqual(result.calendar.periodTimes, [{ period: 1, startTime: '08:00', endTime: '08:45' }])
    assert.equal(result.assets.teachingSchedule.filename, 'teaching_schedule_current.pdf')
    assert.match(await readFile(service.pathFor('teachingSchedule'), 'utf8'), /^%PDF/)
    await service.refresh()
    assert.equal(calls, 6)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('academic calendar refuses an HTML error page disguised as a PDF', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-calendar-invalid-'))
  try {
    const service = new AcademicCalendarAssetsService({
      root,
      fetchImpl: async (url) => responseFor(String(url), true),
      ocrRunner: async () => ({ schoolYear: '2025-2026', semesters: [{ label: '第一学期', startDate: '2025-09-01', endDate: '2026-01-18', weeks: 20 }] }),
    })
    await assert.rejects(service.refresh(), /non-PDF/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('academic calendar probes near expiry without downloading an unchanged official resource', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-calendar-probe-'))
  const requests = []
  try {
    const service = new AcademicCalendarAssetsService({
      root,
      fetchImpl: async (url) => { requests.push(String(url)); return responseFor(String(url)) },
      ocrRunner: async () => ({ schoolYear: '2026-2027', semesters: [{ label: '第一学期', startDate: '2026-09-01', endDate: '2027-01-17', weeks: 20 }] }),
    })
    await service.refresh()
    const before = requests.length
    service.manifest.assets.calendar.nextRefreshAfter = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    service.manifest.assets.calendar.nextProbeAfter = new Date(0).toISOString()
    service.manifest.assets.teachingSchedule.nextRefreshAfter = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
    service.manifest.assets.weeklyCalendar.nextRefreshAfter = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
    const fetchedAt = service.manifest.assets.calendar.fetchedAt
    await service.refresh()
    assert.equal(requests.length, before + 1)
    assert.match(requests.at(-1), /c3201a46856/)
    assert.equal(service.manifest.assets.calendar.fetchedAt, fetchedAt)
    assert.ok(new Date(service.manifest.assets.calendar.nextProbeAfter).getTime() > Date.now())
    await service.refresh()
    assert.equal(requests.length, before + 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('academic calendar replaces its local image and OCR record only after the official URL changes', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-calendar-changed-'))
  let changed = false
  let ocrCalls = 0
  try {
    const service = new AcademicCalendarAssetsService({
      root,
      fetchImpl: async (url) => {
        if (String(url).includes('/c3201a46856/')) {
          return new Response(changed
            ? '<img src="/_upload/article/images/aa/bb/beef-dead.jpg">'
            : PAGES.calendar)
        }
        return responseFor(String(url))
      },
      ocrRunner: async () => {
        ocrCalls += 1
        return { schoolYear: changed ? '2026-2027' : '2025-2026', semesters: [{ label: '第一学期', startDate: changed ? '2026-09-01' : '2025-09-01', endDate: changed ? '2027-01-17' : '2026-01-18', weeks: 20 }] }
      },
    })
    await service.refresh()
    const originalUrl = service.manifest.assets.calendar.sourceUrl
    service.manifest.assets.calendar.nextRefreshAfter = new Date(Date.now() - 1).toISOString()
    service.manifest.assets.teachingSchedule.nextRefreshAfter = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
    service.manifest.assets.weeklyCalendar.nextRefreshAfter = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
    changed = true
    await service.refresh()
    assert.notEqual(service.manifest.assets.calendar.sourceUrl, originalUrl)
    assert.match(service.manifest.assets.calendar.sourceUrl, /beef-dead_d\.jpg$/)
    assert.equal(service.manifest.calendar.schoolYear, '2026-2027')
    assert.equal(ocrCalls, 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('academic calendar retries a failed OCR parse without requiring a new source image', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-calendar-ocr-retry-'))
  let ocrCalls = 0
  try {
    const service = new AcademicCalendarAssetsService({
      root,
      fetchImpl: async (url) => responseFor(String(url)),
      ocrRunner: async () => {
        ocrCalls += 1
        if (ocrCalls === 1) throw new Error('transient OCR worker failure')
        return {
          schoolYear: '2025-2026',
          semesters: [{ label: '第一学期', startDate: '2025-09-01', endDate: '2026-01-18', weeks: 20 }],
          vacations: [{ label: '暑假', startDate: '2026-07-27', endDate: '2026-08-30' }],
        }
      },
    })
    await service.refresh()
    assert.equal(service.manifest.calendar, null)
    assert.match(service.manifest.calendarError, /transient OCR/u)
    await service.refresh()
    assert.equal(ocrCalls, 2)
    assert.equal(service.manifest.calendar.schoolYear, '2025-2026')
    assert.equal(service.manifest.calendarError, null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
