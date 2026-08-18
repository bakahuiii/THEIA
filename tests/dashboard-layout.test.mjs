import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const dashboardSource = await readFile(
  new URL('../src/views/DashboardView.tsx', import.meta.url),
  'utf8',
)

test('dashboard course metric counts only deduplicated academic-system courses', () => {
  assert.match(dashboardSource, /\.filter\(\(course\) => course\.source === "jwglxt"\)/)
  assert.match(dashboardSource, /identities\.add\(code \? `code:/)
  assert.match(dashboardSource, /<strong>\{academicCourseCount\}<\/strong>/)
})
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')

test('overview orders schedule, assignments, and the next exam as the desktop primary row', () => {
  const schedule = dashboardSource.indexOf('dashboard-schedule-panel')
  const assignments = dashboardSource.indexOf('dashboard-assignments-panel')
  const exam = dashboardSource.indexOf('dashboard-exam-panel')

  assert.ok(schedule >= 0, 'schedule panel needs an explicit overview placement class')
  assert.ok(assignments > schedule, 'assignments should follow schedule in reading order')
  assert.ok(exam > assignments, 'the next exam should follow assignments in reading order')
})

test('overview stacks schedule and assignments beside the unchanged right rail', () => {
  assert.match(
    styles,
    /\.view-dashboard \.dashboard-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\) minmax\(280px, \.85fr\);/s,
  )
  assert.match(
    styles,
    /\.view-dashboard \.dashboard-schedule-panel\s*\{[^}]*grid-column:\s*1 \/ 3;[^}]*grid-row:\s*4;/s,
  )
  assert.match(
    styles,
    /\.view-dashboard \.dashboard-assignments-panel\s*\{[^}]*grid-column:\s*1 \/ 3;[^}]*grid-row:\s*5;/s,
  )
  assert.match(
    styles,
    /\.view-dashboard \.dashboard-exam-panel\s*\{[^}]*grid-column:\s*3;[^}]*grid-row:\s*4;/s,
  )
  assert.match(
    styles,
    /\.view-dashboard \.dashboard-notices-panel\s*\{[^}]*grid-column:\s*3;[^}]*grid-row:\s*5;/s,
  )
  assert.match(
    styles,
    /\.view-dashboard \.dashboard-assignments-panel \.task-actions\s*\{[^}]*grid-column:\s*2 \/ -1;[^}]*justify-content:\s*flex-start;/s,
  )
  assert.match(
    styles,
    /@media \(max-width: 920px\)[\s\S]*?\.view-dashboard \.workspace\s*\{[^}]*overflow-y:\s*auto;/,
  )
  assert.match(
    styles,
    /@media \(max-width: 920px\)[\s\S]*?\.view-dashboard \.dashboard-grid\s*\{[^}]*height:\s*auto;[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*grid-template-rows:\s*none;/,
  )
  assert.match(
    styles,
    /@media \(max-width: 920px\)[\s\S]*?\.view-dashboard \.dashboard-grid > \.panel\s*\{[^}]*grid-column:\s*auto;[^}]*grid-row:\s*auto;/,
  )
})

test('overview assignment links use the application error-handling action', () => {
  assert.match(dashboardSource, /onOpenSource: \(assignmentId: string\) => void/)
  assert.match(dashboardSource, /<AssignmentRow[^>]*onOpenSource=\{onOpenSource\}/s)
})

test('overview uses Shanghai calendar semantics and bounded, newest-first previews', () => {
  assert.match(dashboardSource, /currentShanghaiWeekday\(\)/)
  assert.match(dashboardSource, /currentAcademicVacation\(calendar\)/)
  assert.match(dashboardSource, /当前不在教学周/)
  assert.match(dashboardSource, /const pendingPreview = pending\.slice\(0, DASHBOARD_PREVIEW_LIMIT\)/)
  assert.match(dashboardSource, /const notices = \[\.\.\.state\.notices\]\.sort\(/)
  assert.match(dashboardSource, /const noticePreview = notices\.slice\(0, DASHBOARD_PREVIEW_LIMIT\)/)
  assert.match(dashboardSource, /pendingPreview\.map\(/)
  assert.match(dashboardSource, /noticePreview\.map\(/)
})
