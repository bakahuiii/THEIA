import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const sidebar = await readFile(new URL('../src/layout/AppSidebar.tsx', import.meta.url), 'utf8')
const navigation = await readFile(new URL('../src/ui/navigation.ts', import.meta.url), 'utf8')

test('assignment badge matches the visible pending assignment list', () => {
  assert.match(sidebar, /import \{ isExpiredAssignment, SyncChip, type ViewId \} from "\.\.\/ui\/app-shared"/u)
  assert.match(sidebar, /state\.assignments\.filter\(\(item\) => item\.status !== "submitted" && !isExpiredAssignment\(item\)\)\.length/u)
})

test('assignment navigation is labeled as assignments and tests', () => {
  assert.match(navigation, /\{ id: "assignments", label: "作业与测试", icon: CheckCircle2 \}/u)
})
