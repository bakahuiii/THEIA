import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const view = await readFile(new URL('../src/views/tools/AcademicCalendar.tsx', import.meta.url), 'utf8')
const styles = await readFile(new URL('../src/styles/tools-shell.css', import.meta.url), 'utf8')

test('academic calendar opens the image through the in-app preview dialog', () => {
  assert.doesNotMatch(view, /target="_blank"/u)
  assert.match(view, /查看\$\{title\}大图/u)
  assert.match(view, /setPreview\(\{ title, url, kind: isPdf \? "pdf" : "image" \}\)/u)
  assert.match(view, /preview\.kind === "image" \? \(/u)
  assert.match(view, /className="academic-calendar-image-reader"/u)
})

test('academic calendar clears a stale catalog OCR error after a successful manifest load', () => {
  assert.match(view, /const calendarError = manifest \? manifest\.calendarError : catalog\?\.calendarError \|\| null;/u)
  assert.doesNotMatch(view, /const calendarError = manifest\?\.calendarError \|\| catalog\?\.calendarError/u)
})

test('academic calendar image preview keeps the wide source image contained', () => {
  assert.match(styles, /\.academic-calendar-image-dialog\s*\{[^}]*aspect-ratio:\s*1\.897\s*\/\s*1/u)
  assert.match(styles, /\.academic-calendar-image-reader\s*\{[^}]*overflow:\s*auto/u)
  assert.match(styles, /\.academic-calendar-image-reader img\s*\{[^}]*max-width:\s*100%[^}]*max-height:\s*100%/u)
})
