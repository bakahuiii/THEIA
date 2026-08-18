import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/ui/calendar.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const module = { exports: {} }
new Function('exports', 'module', compiled)(module.exports, module)
const {
  currentAcademicVacation,
  currentAcademicWeek,
  currentShanghaiWeekday,
  occursInWeek,
} = module.exports

test('week visibility evaluates every Zhengfang range and its local parity marker', () => {
  const pattern = '1-3周(单,4-6周双,7-9周(单,10-12周双'
  for (const week of [1, 3, 4, 6, 7, 9, 10, 12]) assert.equal(occursInWeek(pattern, week), true, `week ${week}`)
  for (const week of [2, 5, 8, 11, 13]) assert.equal(occursInWeek(pattern, week), false, `week ${week}`)
})

test('week visibility keeps progressing through malformed separators and unclosed parity groups', () => {
  const pattern = '1—3周（单、4～6周（双、7-9周(单、10至12周双'
  for (const week of [1, 3, 4, 6, 7, 9, 10, 12]) assert.equal(occursInWeek(pattern, week), true, `week ${week}`)
  for (const week of [2, 5, 8, 11, 13]) assert.equal(occursInWeek(pattern, week), false, `week ${week}`)
  assert.equal(occursInWeek('1-17单双周', 2), true)
})

test('week visibility still supports disjoint individual weeks', () => {
  for (const week of [2, 4, 6]) assert.equal(occursInWeek('2,4,6周', week), true)
  assert.equal(occursInWeek('2,4,6周', 3), false)
})

test('calendar uses Asia/Shanghai for day and teaching-week boundaries', () => {
  const calendar = {
    schoolYear: '2026-2027',
    semesters: [{ label: '秋季学期', startDate: '2026-08-17', endDate: '2026-12-31', weeks: 20 }],
    vacations: [],
    specialDates: [],
  }
  const afterShanghaiMidnight = new Date('2026-08-24T16:30:00.000Z')

  assert.equal(currentShanghaiWeekday(afterShanghaiMidnight), 2)
  assert.equal(currentAcademicWeek(calendar, afterShanghaiMidnight)?.week, 2)
})

test('calendar distinguishes a Shanghai vacation from an academic-week gap', () => {
  const calendar = {
    schoolYear: '2026-2027',
    semesters: [{ label: '秋季学期', startDate: '2026-08-17', endDate: '2026-12-31', weeks: 20 }],
    vacations: [{ label: '国庆假期', startDate: '2026-10-01', endDate: '2026-10-07' }],
    specialDates: [],
  }

  const vacation = currentAcademicVacation(calendar, new Date('2026-10-01T00:30:00.000Z'))
  assert.equal(vacation?.label, '国庆假期')
  assert.equal(currentAcademicWeek(calendar, new Date('2027-01-01T00:30:00.000Z')), null)
})
