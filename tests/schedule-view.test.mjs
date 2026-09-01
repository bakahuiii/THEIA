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
