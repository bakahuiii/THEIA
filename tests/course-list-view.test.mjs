import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const coursesViewSource = await readFile(
  new URL('../src/views/CoursesView.tsx', import.meta.url),
  'utf8',
)
const appSharedSource = await readFile(
  new URL('../src/ui/app-shared.tsx', import.meta.url),
  'utf8',
)
const userFacingCopyFiles = [
  '../src/layout/WorkspaceChrome.tsx',
  '../src/hooks/useTheiaApp.ts',
  '../src/views/CampusPortalView.tsx',
  '../src/views/CommunicationsView.tsx',
  '../src/ui/navigation.ts',
  '../src/views/DashboardView.tsx',
  '../src/views/CoursesView.tsx',
  '../src/views/SettingsView.tsx',
  '../src/views/settings/Credentials.tsx',
  '../core/adapters/theol.mjs',
  '../core/course-work.mjs',
  '../core/advisor/risk-engine.mjs',
  '../core/ai-export.mjs',
]

test('course page limits categories and cards to THEOL courses', () => {
  assert.match(
    coursesViewSource,
    /const theolCourses = useMemo\(\s*\(\) => courses\.filter\(\(course\) => course\.source === "theol"\),\s*\[courses\],\s*\);/s,
  )
  assert.match(
    coursesViewSource,
    /const categories = useMemo\(\s*\(\) => \[\.\.\.new Set\(\s*theolCourses\s*\.map/s,
  )
  assert.match(
    coursesViewSource,
    /const values = useMemo\(\s*\(\) => theolCourses\s*\.map/s,
  )
  assert.match(coursesViewSource, /连接北化在线THEOL并同步后即可查看/)
})

test('THEOL source label uses the user-facing platform name', () => {
  assert.match(
    appSharedSource,
    /source === "jwglxt" \? "教务系统" : "北化在线THEOL"/,
  )
})

test('application-owned THEOL copy uses the 北化在线THEOL name', async () => {
  const sources = await Promise.all(
    userFacingCopyFiles.map((file) => readFile(new URL(file, import.meta.url), 'utf8')),
  )
  const copy = sources.join('\n')

  assert.doesNotMatch(copy, /课程平台|Course platform|course-platform/)
  assert.match(copy, /北化在线THEOL/)
})
