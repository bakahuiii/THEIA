import test from 'node:test'
import assert from 'node:assert/strict'
import { MotionVenueAdapter, MOTION_ENTRY_URL, isAllowedMotionUrl } from '../core/adapters/motion.mjs'

const detailBase = 'https://motion.buct.edu.cn/changguanyuyue1/detail.php?xm=%E7%BE%BD%E6%AF%9B%E7%90%83&xq=0'

function detailPage(url) {
  const parsed = new URL(url)
  const date = parsed.searchParams.get('d') || '2026-08-19'
  const venue = parsed.searchParams.get('c') || '体育馆羽毛球馆'
  return `<!doctype html><title>MOTION 场馆</title><body>
    <select name="d"><option value="2026-08-19"${date === '2026-08-19' ? ' selected' : ''}>2026-08-19</option><option value="2026-08-20"${date === '2026-08-20' ? ' selected' : ''}>2026-08-20</option></select>
    <select name="c"><option value="体育馆羽毛球馆"${venue === '体育馆羽毛球馆' ? ' selected' : ''}>体育馆羽毛球馆</option><option value="体育馆比赛馆"${venue === '体育馆比赛馆' ? ' selected' : ''}>体育馆比赛馆</option></select>
    <table><thead><tr><th>时间</th></tr></thead><thead><tr><th>羽01</th><th>羽02</th></tr></thead><tbody>
      <tr><td>09:00-10:00</td><td>可预约</td><td>闭馆</td></tr>
      <tr><td>10:00-11:00</td><td>已占用</td><td>已过期</td></tr>
    </tbody></table>
  </body>`
}

function fixtureFetch(calls) {
  return async (url, options) => {
    calls.push({ url, options })
    const parsed = new URL(url)
    let body = '<title>MOTION</title><body></body>'
    if (parsed.pathname.endsWith('/xzxq.php')) body = '<title>选择校区</title><a href="jinri_cpxq.php?XQ=0">昌平校区</a>'
    if (parsed.pathname.endsWith('/jinri_cpxq.php')) body = `<title>昌平校区</title><a href="${detailBase}">羽毛球</a>`
    if (parsed.pathname.endsWith('/detail.php')) body = detailPage(url)
    return { status: 200, ok: true, url, headers: { get: () => 'text/html; charset=utf-8' }, text: async () => body }
  }
}

test('MOTION adapter discovers public venues and queries status with GET only', async () => {
  const calls = []
  const adapter = new MotionVenueAdapter({ fetchImpl: fixtureFetch(calls), now: (() => { let value = 0; return () => { value += 7; return value } })() })
  const catalog = await adapter.discover()
  assert.equal(catalog.counts.pages, 3)
  assert.equal(catalog.counts.venues, 1)
  assert.equal(catalog.errors.length, 0)
  const status = await adapter.queryStatus({ detailUrl: detailBase, date: '2026-08-20', venue: '体育馆比赛馆' })
  assert.equal(status.query.date, '2026-08-20')
  assert.equal(status.query.venue, '体育馆比赛馆')
  assert.equal(status.availability.summary.courtStatusCells, 4)
  assert.deepEqual(status.availability.tables[0].headers, ['时间', '羽01', '羽02'])
  assert.ok(!status.availability.tables[0].headers.includes('09:00-10:00'))
  assert.ok(!status.availability.tables[0].headers.includes('闭馆'))
  assert.deepEqual(status.availability.summary.byState, { available: 1, closed: 1, expired: 1, occupied: 1 })
  assert.equal(status.safety.requestedPageCount, 2)
  assert.ok(calls.every(({ options }) => options.method === 'GET'))
  assert.ok(calls.every(({ options }) => !options.body && !options.credentials))
})

test('MOTION URL and selector validation rejects mutations and hidden values', async () => {
  assert.equal(isAllowedMotionUrl(MOTION_ENTRY_URL), true)
  assert.equal(isAllowedMotionUrl('https://motion.buct.edu.cn/changguanyuyue1/BB.php'), false)
  assert.equal(isAllowedMotionUrl(`${detailBase}&token=secret`), false)
  const adapter = new MotionVenueAdapter({ fetchImpl: fixtureFetch([]) })
  await assert.rejects(
    adapter.queryStatus({ detailUrl: detailBase, date: '2026-02-31' }),
    /YYYY-MM-DD/,
  )
  await assert.rejects(
    adapter.queryStatus({ detailUrl: detailBase, venue: '不存在的场馆' }),
    /not exposed/,
  )
})
