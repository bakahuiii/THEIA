import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('settings marks a clean-looking log as an earlier result while synchronization is running', async () => {
  const source = await readFile(new URL('../src/views/settings/SyncSettings.tsx', import.meta.url), 'utf8')

  assert.match(
    source,
    /\{syncing\s*\?\s*"正在同步；这里显示的是上次完成结果"\s*:\s*"同步正常，无报错"\}/,
  )
})

test('renderer reconciles a missed sync terminal event from persisted timestamps', async () => {
  const source = await readFile(new URL('../src/hooks/useTheiaApp.ts', import.meta.url), 'utf8')

  assert.match(source, /function syncSnapshotIsPending\(/)
  assert.match(source, /syncSnapshotIsPending\(snapshot\.sync\)/)
  assert.match(source, /if \(credentials\.saved\) \{\s*setSyncing\(true\);\s*setSyncProgress\("正在恢复学校统一身份认证会话"\);\s*setMsg\(null\);\s*\}/s)
  assert.match(source, /setSyncing\(false\)/)
  assert.match(source, /lastCompletedAt\)/)
})

test('settings exposes detailed domain outcomes, native logs, and the data directory action', async () => {
  const [syncSource, modelSource, dataSource, viewSource] = await Promise.all([
    readFile(new URL('../src/views/settings/SyncSettings.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/settings/SyncSettingsModel.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/settings/DataSettings.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/SettingsView.tsx', import.meta.url), 'utf8'),
  ])
  const source = `${syncSource}\n${modelSource}\n${dataSource}\n${viewSource}`

  for (const label of [
    '课表', '考试', '成绩', '学业进度', '已选课程',
    'THEOL 课程', '作业与测试', 'THEOL 通知', '校园邮箱',
  ]) assert.match(source, new RegExp(label))
  for (const state of ['成功', '部分成功', '失败', '未开始']) assert.match(source, new RegExp(state))
  assert.doesNotMatch(source, /onDemand: true/)
  assert.doesNotMatch(source, /不会随主同步读取/)
  assert.doesNotMatch(source, /培养执行计划/)
  assert.doesNotMatch(source, /全校课表/)
  assert.match(source, /entry\.raw/)
  assert.doesNotMatch(source, /activityEventLabel/)
  assert.match(source, /<h2>日志<\/h2>/)
  assert.match(source, /bridge\.openDataDirectory\(\)/)
  assert.match(source, /打开本地数据目录/)
  assert.match(source, /bridge\.retrySyncDomain\(definition\.id\)/)
  assert.match(source, /aria-label=\{`重新获取\$\{definition\.label\}`\}/)
})
