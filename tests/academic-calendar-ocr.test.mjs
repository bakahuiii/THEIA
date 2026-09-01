import test from 'node:test'
import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { defaultOcrRuntime, parseAcademicCalendarOcrItems, parseAcademicCalendarOcrRegions, parseAcademicCalendarPeriodTimes, probeAcademicCalendarOcrRuntime, runAcademicCalendarOcr } from '../core/academic-calendar-ocr.mjs'

const require = createRequire(import.meta.url)
const jpeg = require('jpeg-js')

test('academic-calendar OCR items retain semester, vacation, and special-date semantics', () => {
  const parsed = parseAcademicCalendarOcrItems([
    { x: 100, y: 100, text: '2025-2026' },
    { x: 100, y: 200, text: '第一学期 2025年9月1日-2026年1月18日' },
    { x: 3300, y: 200, text: '2026年3月2日-7月12日' },
    { x: 100, y: 700, text: '寒假 2026年1月19日-3月1日' },
    { x: 100, y: 800, text: '校庆日 2026年5月28日' },
  ])

  assert.equal(parsed.schoolYear, '2025-2026')
  assert.deepEqual(parsed.semesters.map((item) => ({ label: item.label, startDate: item.startDate, endDate: item.endDate })), [
    { label: '第一学期', startDate: '2025-09-01', endDate: '2026-01-18' },
    { label: '第二学期', startDate: '2026-03-02', endDate: '2026-07-12' },
  ])
  assert.deepEqual(parsed.vacations[0], { label: '寒假', startDate: '2026-01-19', endDate: '2026-03-01' })
  assert.deepEqual(parsed.specialDates[0], { label: '校庆日', date: '2026-05-28' })
})

test('academic-calendar OCR regions tolerate joined year digits and infer a missing winter-vacation line', () => {
  const parsed = parseAcademicCalendarOcrRegions([
    { key: 'period-times', text: '1 08 : 00 ~ 08 : 45\\n2 08:50-09:35' },
    { key: 'semester-1', text: '第 一 孙 期 “202> 年 9 月 1 日 ~ 一 2026 年 1 月 18 日 )' },
    { key: 'semester-2', text: '第 一 子 期 (2026 卅 3 月 2 日 ~ 一 2026 平 7 月 5 月 )' },
    { key: 'semester-3', text: '宇 三 工 一 | C2026 一 月 6 1 月 2 巳 “' },
    { key: 'winter-vacation', text: '叔 : 匹 s LU 丨 王 刀 士 3 E 一 3 月 工 月\n\n作 日\n\n2026 半 2 月 17 日' },
    { key: 'summer-vacation', text: '春 假 : 2026 华 7 月 27 门 一 8 月 30 【' },
  ])

  assert.equal(parsed.schoolYear, '2025-2026')
  assert.deepEqual(parsed.semesters.map(({ label, startDate, endDate }) => ({ label, startDate, endDate })), [
    { label: '第一学期', startDate: '2025-09-01', endDate: '2026-01-18' },
    { label: '第二学期', startDate: '2026-03-02', endDate: '2026-07-05' },
    { label: '第三学期', startDate: '2026-07-06', endDate: '2026-07-26' },
  ])
  assert.deepEqual(parsed.vacations, [
    { label: '寒假', startDate: '2026-01-19', endDate: '2026-03-01' },
    { label: '暑假', startDate: '2026-07-27', endDate: '2026-08-30' },
  ])
  assert.deepEqual(parsed.specialDates, [{ label: '春节', date: '2026-02-17' }])
  assert.deepEqual(parsed.periodTimes, [
    { period: 1, startTime: '08:00', endTime: '08:45' },
    { period: 2, startTime: '08:50', endTime: '09:35' },
  ])
})

test('academic-calendar period-time parser accepts OCR punctuation and full-width digits', () => {
  assert.deepEqual(parseAcademicCalendarPeriodTimes('０８：００～０８：４５\\n13 . 30 至 14 . 15'), [
    { period: 1, startTime: '08:00', endTime: '08:45' },
    { period: 2, startTime: '13:30', endTime: '14:15' },
  ])
})

test('default academic-calendar OCR uses bundled local worker, core, and Chinese data', async () => {
  const runtime = defaultOcrRuntime()
  assert.equal(runtime.language.code, 'chi_sim')
  assert.equal(runtime.language.gzip, true)
  await Promise.all([
    access(runtime.workerPath),
    access(runtime.corePath),
    access(`${runtime.language.langPath}/chi_sim.traineddata.gz`),
  ])
})

test('academic-calendar OCR uses sparse-text mode for the second-semester heading', async () => {
  const modes = []
  const regionText = [
    '第一学期 2026年8月31日~2027年1月17日',
    '第二学期 2027年3月1日~2027年7月11日',
    '',
    '寒假 2027年1月18日~2027年2月28日',
    '暑假 2027年7月26日~2027年9月5日',
  ]
  const image = jpeg.encode({ width: 2, height: 2, data: Buffer.alloc(16, 255) }, 90).data
  const parsed = await runAcademicCalendarOcr(image, {
    createWorkerImpl: async () => ({
      recognize: async (_input, parameters) => {
        modes.push(String(parameters?.tessedit_pageseg_mode || 'full'))
        return { data: { text: regionText[modes.length - 1] || '' } }
      },
      terminate: async () => {},
    }),
  })

  assert.deepEqual(modes, ['11', '11', '7', '11', '7'])
  assert.deepEqual(parsed.semesters.slice(0, 2).map(({ label, startDate, endDate }) => ({ label, startDate, endDate })), [
    { label: '第一学期', startDate: '2026-08-31', endDate: '2027-01-17' },
    { label: '第二学期', startDate: '2027-03-01', endDate: '2027-07-11' },
  ])
})

test('default academic-calendar OCR worker initializes and recognizes without Python or network', { timeout: 60_000 }, async () => {
  assert.equal(await probeAcademicCalendarOcrRuntime(), true)
})
