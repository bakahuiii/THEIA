import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const view = await readFile(new URL('../src/views/ScheduleView.tsx', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/styles/visual-refinement-motion.css', import.meta.url), 'utf8')

test('schedule period labels render the time supplied by the academic calendar', () => {
  assert.match(view, /calendar\?\.periodTimes\?\.find\(\(item\) => item\.period === period\)/u)
  assert.match(view, /className="schedule-period-time"/u)
  assert.match(view, /aria-label=\{`/u)
  assert.match(view, /periodTimeLabel\(calendar, period\)/u)
})

test('schedule period labels reserve enough width for the two-line label', () => {
  assert.match(styles, /grid-template-columns:\s*96px repeat\(7, minmax\(146px, 1fr\)\)/u)
  assert.match(styles, /\.schedule-period-time\s*\{[^}]*white-space:\s*nowrap/u)
})

test('overlapping schedule items prioritize taught courses over marked self-study entries', () => {
  assert.match(view, /function isSelfStudyScheduleItem\(item: ScheduleItem\)/u)
  assert.match(view, /items: \[\.\.\.slot\.items\]\.sort\(/u)
  assert.match(view, /Number\(isSelfStudyScheduleItem\(left\)\)\s*-\s*Number\(isSelfStudyScheduleItem\(right\)\)/u)
})

test('schedule day headers show dates for the selected week instead of course counts', () => {
  assert.match(view, /function scheduleDayDates\(/u)
  assert.match(view, /return DAY_LABELS\.map/u)
  assert.match(view, /dayDates\?\.\[index\] \|\| "日期待定"/u)
  assert.doesNotMatch(view, /dayCourseCounts|门课程/u)
  assert.match(styles, /font-variant-numeric:\s*tabular-nums/u)
})
