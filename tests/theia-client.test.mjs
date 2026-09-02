import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { discoverTheiaApi } from '../integration/theia-client.mjs'
import { createTheiaClient } from '../electron/iris-runtime/src/theia.mjs'

test('THEIA API discovery rejects stale or malformed runtime metadata', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'theia-client-runtime-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'api-runtime.json'), JSON.stringify({
    host: '127.0.0.1', port: 8765, pid: 999_999_999, token: 'A'.repeat(32), startedAt: new Date().toISOString(),
  }))
  await assert.rejects(discoverTheiaApi({ dataRoot: root }), /runtime is not running/u)

  await writeFile(join(root, 'api-runtime.json'), JSON.stringify({
    host: '127.0.0.1', port: 8765, pid: process.pid, token: 'A'.repeat(32), startedAt: 'invalid',
  }))
  await assert.rejects(discoverTheiaApi({ dataRoot: root }), /metadata is invalid/u)

test('THEIA API discovery requires a token in the runtime metadata', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'theia-client-token-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'api-runtime.json'), JSON.stringify({
    host: '127.0.0.1', port: 8765, pid: process.pid, startedAt: new Date().toISOString(),
  }))
  await assert.rejects(discoverTheiaApi({ dataRoot: root }), /token is missing/u)
})
})

test('内置 Iris 客户端按中国日期和校历计算当前空闲教室查询范围', async () => {
  const calls = []
  const client = createTheiaClient({
    baseUrl: 'http://127.0.0.1:8765',
    timeoutMs: 5_000,
    fetchImpl: async (url) => {
      calls.push(new URL(url).pathname + new URL(url).search)
      if (new URL(url).pathname === '/v1/academic-calendar') {
        return new Response(JSON.stringify({
          schema: 'theia-academic-calendar-assets/v1',
          calendar: {
            schoolYear: '2026-2027',
            semesters: [{ label: '第一学期', startDate: '2026-08-31', endDate: '2027-01-17', weeks: 20 }],
          },
          calendarError: null,
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response(Buffer.from('png'), { status: 200, headers: { 'content-type': 'image/png' } })
    },
  })

  const scope = await client.currentClassroomScope(new Date('2026-09-02T01:00:00.000Z'))
  assert.deepEqual(scope, {
    date: '2026-09-02', weekday: 3, weekdays: 3, week: 1, of: 20,
    termId: '2026-3', semesterIndex: 1, semesterLabel: '第一学期',
  })
  await client.classroomTableImage({ campus: '2', periods: '10', now: new Date('2026-09-02T01:00:00.000Z') })
  const query = new URL(`http://127.0.0.1${calls[2]}`)
  assert.equal(query.searchParams.get('periods'), '10')
  assert.equal(query.searchParams.get('weeks'), '1')
  assert.equal(query.searchParams.get('weekdays'), '3')
  assert.equal(query.searchParams.get('termId'), '2026-3')
  assert.equal(query.searchParams.get('campus'), '2')
})
