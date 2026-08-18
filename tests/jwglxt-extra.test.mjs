import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFreeClassroomQuery, buildWeeklyScheduleQuery, JwglxtAdapter } from '../core/adapters/jwglxt.mjs'
import {
  JWGLXT_EXTRA_DOMAINS,
  JWGLXT_EXTRA_DOMAIN_NAMES,
  JWGLXT_IGNORED_EXTRA_DOMAIN_NAMES,
  JWGLXT_REMOVED_EXTRA_DOMAIN_NAMES,
  normalizeAcademicExtras,
  normalizeJwglxtExtraDomain,
  parseJwglxtExtraJson,
  parseJwglxtExtraPage,
} from '../core/jwglxt-extra.mjs'
import { domainHasData, domainRecordCount } from '../core/domain-provenance.mjs'
import { mergeAcademicExtraDomain } from '../core/sync-merge.mjs'

test('JWGLXT extra parser keeps identifiers as text and coerces only known numeric fields', () => {
  const parsed = parseJwglxtExtraPage(`
    <html><head><title>成绩明细</title></head><body>
      <table><thead><tr><th>学号</th><th>课程名称</th><th>学分</th><th>成绩</th></tr></thead>
      <tbody><tr><td>00123</td><td>数据结构</td><td>3</td><td>91</td></tr></tbody></table>
      <a href="/jwglxt/download/score.pdf">成绩附件</a>
    </body></html>
  `, {
    domain: 'grade-details',
    routeCode: 'N305007',
    sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/cjcx/detail.html',
    capturedAt: '2026-08-16T00:00:00.000Z',
  })
  assert.equal(parsed.records.length, 1)
  assert.equal(parsed.records[0].fields[0].value, '00123')
  assert.equal(parsed.records[0].credits, 3)
  assert.equal(parsed.records[0].score, 91)
  assert.equal(parsed.attachments.length, 1)
  assert.equal(Object.hasOwn(parsed, 'html'), false)
})

test('academic-warning and thesis are not readable sync domains', async () => {
  const calls = []
  const client = {
    async page(url) {
      const target = String(url)
      calls.push(['page', target])
      if (target.includes('/xtgl/')) return { url: target, text: '<input id="xh" value="2024TEST01">' }
      return {
        url: target,
        text: '<form id="searchForm"><input name="xh_id" value="2024TEST01"><input name="xxdm" value="10001"></form><table><tr><th>预警类型</th></tr><tr><td colspan="1">请选择筛选条件!</td></tr></table>',
      }
    },
    async form(url, values) {
      calls.push(['form', String(url), values])
      return JSON.stringify({ items: [{ warning_type: '学业预警', status: '已处理' }] })
    },
  }
  const adapter = new JwglxtAdapter(client)
  await assert.rejects(adapter.sync({ domains: ['academic-warning'] }), /Unsupported JWGLXT sync domain/u)
  await assert.rejects(adapter.sync({ domains: ['thesis'] }), /Unsupported JWGLXT sync domain/u)
  assert.deepEqual(calls, [])
  assert.deepEqual(JWGLXT_IGNORED_EXTRA_DOMAIN_NAMES, ['academic-warning', 'thesis'])
})

test('academic-plan jqGrid rows are not persisted beside the official PDF', () => {
  const parsed = parseJwglxtExtraPage(`
    <div class="ui-jqgrid">
      <table class="ui-jqgrid-htable"><tr><th>专业</th><th>操作</th><th>状态</th><th>备注</th></tr></table>
      <table class="ui-jqgrid-btable"><tbody>
        <tr class="jqgfirstrow"><td></td><td></td><td></td></tr>
        <tr>
          <td title="高分子材料与工程">高分子材料与工程</td>
          <td><button>志愿</button><table class="dropdown"><tr><th>专业方向代码</th><td>0401</td></tr></table></td>
          <td>有效</td>
          <td>保留字段</td>
        </tr>
      </tbody></table>
      <table class="ui-pg-table"><tr><td>状态</td><td>专业</td><td>收起</td></tr></table>
      <table class="right_table_head"><tr><td>志愿</td><td>专业</td></tr></table>
    </div>
  `, {
    domain: 'academic-plan',
    routeCode: 'N153540',
    sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/jxzxjhgl/jxzxjhck_cxJxzxjhckIndex.html',
  })
  assert.deepEqual(parsed.records, [])
})

test('empty academic-plan jqGrid and pager controls do not become synthetic records', () => {
  const parsed = parseJwglxtExtraPage(`
    <form id="searchForm"><input name="zyh_id" value="" /></form>
    <div class="ui-jqgrid">
      <table class="ui-jqgrid-htable"><tr><th>专业</th><th>状态</th></tr></table>
      <table class="ui-jqgrid-btable"><tbody>
        <tr class="jqgfirstrow"><td></td><td></td></tr>
        <tr><td colspan="2">没有符合条件记录</td></tr>
      </tbody></table>
      <table class="ui-pg-table"><tr><td>状态</td><td>专业</td><td>收起</td></tr></table>
    </div>
  `, {
    domain: 'academic-plan',
    routeCode: 'N109310',
    sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/dlflgl/flzyqr_cxFlzyqrIndex.html',
  })
  assert.equal(parsed.records.length, 0)
  assert.equal(parsed.completeness, 'partial')
})

test('ignored and duplicate extra domains are removed during snapshot normalization', () => {
  const normalized = normalizeAcademicExtras({ domains: {
    'school-schedule': { records: [{ id: 'legacy', title: '旧全校课表' }] },
    'academic-warning': { records: [{ id: 'warning', title: '学业预警' }] },
    thesis: { records: [{ id: 'thesis', title: '毕设' }] },
  } })
  assert.deepEqual(Object.keys(normalized.domains), [])
  assert.ok(JWGLXT_EXTRA_DOMAIN_NAMES.includes('jwglxt-school-schedule'))
  assert.ok(JWGLXT_REMOVED_EXTRA_DOMAIN_NAMES.includes('jwglxt-school-schedule'))
})

test('legacy query source URLs migrate to the rendered JWGLXT page route', () => {
  const normalized = normalizeJwglxtExtraDomain({
    routeCodes: ['N219933'],
    sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/design/funcData_cxFuncDataList.html?func_widget_guid=old-cache',
  }, 'jwglxt-school-schedule')
  assert.equal(
    normalized.sourceUrl,
    'https://jwglxt.buct.edu.cn/jwglxt/design/viewFunc_cxDesignFuncPageIndex.html?gnmkdm=N219933&layout=default',
  )
})

test('source URL normalization preserves other valid routes, detail pages, and hosts', () => {
  const multiRoute = normalizeJwglxtExtraDomain({
    routeCodes: ['N153540'],
    sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/dlflgl/flzyqr_cxFlzyqrIndex.html?gnmkdm=N109310&layout=default',
  }, 'academic-plan')
  assert.match(multiRoute.sourceUrl, /jxzxjhgl\/jxzxjhck_cxJxzxjhckIndex\.html/u)

  const detail = normalizeJwglxtExtraDomain({
    routeCodes: ['N153540'],
    sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/jxzxjhgl/plan-detail.html?id=42',
  }, 'academic-plan')
  assert.equal(detail.sourceUrl, 'https://jwglxt.buct.edu.cn/jwglxt/jxzxjhgl/plan-detail.html?id=42')

  const otherHost = normalizeJwglxtExtraDomain({
    routeCodes: ['N219933'],
    sourceUrl: 'https://staging.example.test/jwglxt/design/funcData_cxFuncDataList.html?func_widget_guid=old-cache',
  }, 'jwglxt-school-schedule')
  assert.equal(otherHost.sourceUrl, 'https://staging.example.test/jwglxt/design/funcData_cxFuncDataList.html?func_widget_guid=old-cache')
})

test('normalizing an old cultivation-plan snapshot discards every non-PDF record', () => {
  const normalized = normalizeAcademicExtras({ domains: {
    'academic-plan': {
      records: [
        { id: 'toolbar', title: '志愿', fields: [
          { name: 'choice', label: '志愿', value: '志愿' },
          { name: 'status', label: '状态', value: '状态' },
          { name: 'major', label: '专业', value: '专业' },
        ] },
        { id: 'real', title: '高分子材料与工程', fields: [
          { name: 'major', label: '专业', value: '高分子材料与工程' },
          { name: 'status', label: '状态', value: '有效' },
        ] },
      ],
    },
  } })
  assert.deepEqual(normalized.domains['academic-plan'].records, [])
})

test('JWGLXT JSON envelopes map terse columns without losing identifier text', () => {
  const parsed = parseJwglxtExtraJson({
    totalResult: '1',
    items: [{ kch: '001', kcmc: '有机化学', xf: '2.0', xnm: '2024', xqm: '12', jxb_id: '0007' }],
  }, { domain: 'grade-details', routeCode: 'N305007', sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/query' })
  assert.equal(parsed.records.length, 1)
  assert.equal(parsed.records[0].courseCode, '001')
  assert.equal(parsed.records[0].credits, 2)
  assert.equal(parsed.records[0].academicYear, '2024')
  assert.equal(parsed.records[0].term, '12')
  assert.equal(parsed.records[0].classInternalId, '0007')

  const empty = parseJwglxtExtraJson({ totalResult: 0, items: [] }, {
    domain: 'grade-details', routeCode: 'N305007', sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/query',
  })
  assert.equal(empty.records.length, 0)
  assert.equal(empty.completeness, 'complete')
})

test('real JWGLXT grade columns become readable Chinese fields and drop grid metadata', () => {
  const parsed = parseJwglxtExtraJson({
    totalResult: '109',
    items: [{
      kch: 'CHM32200T', kcmc: '分析化学', xf: '2.0', kkbmmc: '化学学院',
      xnmmc: '2024-2025', xqmmc: '2', xmblmc: '期末(60%)', xmcj: '88',
      zpcj: '84', date: '二○二六年八月十六日', year: '2026', row_id: '1',
      queryModel: { currentPage: 1 },
    }],
  }, { domain: 'grade-details', routeCode: 'N305007', sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/query' })
  const record = parsed.records[0]
  assert.equal(record.academicYearLabel, '2024-2025')
  assert.equal(record.termLabel, '2')
  assert.equal(record.assessmentItem, '期末(60%)')
  assert.equal(record.componentScore, 88)
  assert.equal(record.overallScore, 84)
  assert.equal(record.department, '化学学院')
  assert.equal(record.fields.some((field) => /^(date|year|row_id|queryModel|xnmmc|xqmmc|xmblmc|xmcj)$/u.test(field.label)), false)
  assert.deepEqual(
    record.fields.filter((field) => ['学年', '学期', '成绩组成', '分项成绩', '总评成绩', '开课学院'].includes(field.label)).map((field) => field.label),
    ['开课学院', '学年', '学期', '成绩组成', '分项成绩', '总评成绩'],
  )
})

test('JWGLXT extra inventory covers the remaining read-only and status menu routes', () => {
  const expected = new Set([
    'N100801', 'N100802', 'N100808', 'N102020', 'N1053', 'N1056', 'N105505', 'N105508',
    'N106005', 'N106204', 'N151530', 'N151540', 'N151550', 'N153540',
    'N2154', 'N2155', 'N219933', 'N2511', 'N253512', 'N305007', 'N305516', 'N306115',
    'N306512', 'N307010', 'N352510', 'N358163', 'N358187', 'N401605', 'N532530', 'N532540',
    'N532560', 'N532566',
  ])
  const actual = new Set(Object.values(JWGLXT_EXTRA_DOMAINS)
    .flatMap((descriptor) => descriptor.routes.map((route) => route.code)))
  for (const code of expected) assert.ok(actual.has(code), `missing ${code}`)
})

test('JWGLXT status pages retain bounded user-visible messages without raw HTML', () => {
  const parsed = parseJwglxtExtraPage(`
    <div class="alert alert-warning">补考确认未开放，请联系管理员！</div>
    <script>window.secret = 'do-not-save'</script>
  `, {
    domain: 'exam-extra', routeCode: 'N352510', sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/bkgl/bkmdwh_cxBkmdIndex.html',
  })
  assert.deepEqual(parsed.messages, ['补考确认未开放，请联系管理员！'])
  assert.equal(Object.hasOwn(parsed, 'html'), false)
})

test('N100801 form-control-static fields are captured while keeping leading zeros', () => {
  const parsed = parseJwglxtExtraPage(`
    <form id="ajaxForm">
      <div class="form-group"><label>学号</label><div><p class="form-control-static">00123</p></div></div>
      <div class="form-group"><label>姓名</label><div><p class="form-control-static">张三</p></div></div>
      <div class="form-group"><label>联系电话</label><div><p class="form-control-static">13800000000</p></div></div>
    </form>
  `, {
    domain: 'profile-extra', routeCode: 'N100801', sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/profile',
  })
  assert.equal(parsed.records[0].studentId, '00123')
  assert.equal(parsed.records[0].phone, '13800000000')
  assert.equal(parsed.records[0].fields.length, 3)
})

test('N2154/N2155 query builders reproduce the portal bitmasks', () => {
  assert.deepEqual(buildWeeklyScheduleQuery({ term: { year: 2026, term: '3' }, formValues: { radio1: '1', zs: '7' }, studentId: '00123' }), {
    xnm: '2026', xqm: '3', zs: '7', radio1: '1', kblx: '1', doType: 'app', xh: '00123',
  })
  assert.deepEqual(buildFreeClassroomQuery({
    term: { year: 2026, term: '3' }, formValues: { xqh_id: '2' }, weeks: [1, 3], weekdays: [2, 5], periods: [1, 4],
  }), {
    xnm: '2026', xqm: '3', xqh_id: '2', lh: '', cdlb_id: '', cdejlb_id: '', qszws: '', jszws: '', cdmc: '', jyfs: '0',
    zcd: 5, xqj: '2,5', jcd: 9,
  })
})

test('N2155 requests the complete bounded classroom result instead of the portal default ten rows', async () => {
  const calls = []
  const client = {
    async page(url) {
      const target = String(url)
      if (target.includes('/xtgl/')) return { url: target, text: '<input id="xh" value="2024020417"><a href="/cdjy/cdjy_cxKxcdlb.html">空闲教室</a>' }
      return {
        url: target,
        text: '<form id="searchForm"><input name="xnm" value="2026"><input name="xqm" value="3"><input name="xqh_id" value="2"></form>',
      }
    },
    async form(url, values) {
      calls.push([String(url), values])
      return JSON.stringify({ items: Array.from({ length: 25 }, (_item, index) => ({ cdbh: `A-${index + 1}`, cdmc: `教室${index + 1}`, xqmc: '北区' })) })
    },
  }
  const result = await new JwglxtAdapter(client).sync({ domains: ['free-classroom'] })
  const domain = result.academicExtras.domains['free-classroom']
  const query = calls.find(([url]) => url.includes('cdjy_cxKxcdlb.html?doType=query'))
  assert.ok(query)
  assert.equal(query[1]['queryModel.showCount'], '5000')
  assert.equal(domain.records.length, 25)
  assert.equal(domain.queryStats.capped, false)
})

test('N2155 applies user-selected week, weekday, period and classroom filters', async () => {
  const calls = []
  const client = {
    async page(url) {
      const target = String(url)
      if (target.includes('/xtgl/')) return { url: target, text: '<input id="xh" value="2024020417"><a href="/cdjy/cdjy_cxKxcdlb.html">空闲教室</a>' }
      return { url: target, text: '<form id="searchForm"><input name="xnm" value="2026"><input name="xqm" value="3"><input name="xqh_id" value="1"></form>' }
    },
    async form(url, values) {
      calls.push([String(url), values])
      return JSON.stringify({ items: [{ cdbh: 'A-101', cdmc: '教室101', xqmc: '北区' }] })
    },
  }
  await new JwglxtAdapter(client).sync({
    domains: ['free-classroom'],
    freeClassroom: { weeks: [4], weekdays: [2, 6], periods: [3, 4], campus: '2', building: '主楼', classroomType: '普通', minSeats: 20, maxSeats: 80 },
  })
  const query = calls.find(([url]) => url.includes('cdjy_cxKxcdlb.html?doType=query'))
  assert.ok(query)
  assert.equal(query[1].zcd, 8)
  assert.equal(query[1].xqj, '2,6')
  assert.equal(query[1].jcd, 12)
  assert.equal(query[1].xqh_id, '2')
  assert.equal(query[1].lh, '主楼')
  assert.equal(query[1].cdlb_id, '普通')
  assert.equal(query[1].qszws, '20')
  assert.equal(query[1].jszws, '80')
})

test('partial academic-extra refresh retains previous records', () => {
  const previous = { routeCodes: ['N305007'], records: [{ id: 'old', title: '旧成绩' }], attachments: [], completeness: 'complete' }
  const merged = mergeAcademicExtraDomain(previous, { routeCodes: ['N305007'], records: [], attachments: [], completeness: 'partial' }, {
    succeeded: true, completeness: 'partial', emptyConfirmed: false,
  })
  assert.deepEqual(merged.records, previous.records)
  assert.equal(merged.completeness, 'partial')
})

test('cultivation-plan merge retains a verified PDF on an ambiguous refresh and replaces it only with one new PDF', () => {
  const previous = {
    attachments: [{ id: 'previous-pdf', label: '旧培养计划.pdf', type: 'pdf', sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/old.pdf', cached: true }],
    records: [{ id: 'legacy-row' }],
    completeness: 'complete',
  }
  const retained = mergeAcademicExtraDomain(previous, { records: [{ id: 'unverified-row' }], attachments: [], completeness: 'partial' }, {
    succeeded: true, completeness: 'partial', emptyConfirmed: false,
  }, 'academic-plan')
  assert.deepEqual(retained.records, [])
  assert.deepEqual(retained.attachments.map((item) => item.id), ['previous-pdf'])

  const replaced = mergeAcademicExtraDomain(previous, {
    records: [{ id: 'new-row' }],
    attachments: [{ id: 'current-pdf', label: '当前培养计划.pdf', type: 'pdf', sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/current.pdf', cached: true }],
    completeness: 'partial',
  }, { succeeded: true, completeness: 'partial', emptyConfirmed: false }, 'academic-plan')
  assert.deepEqual(replaced.records, [])
  assert.deepEqual(replaced.attachments.map((item) => item.id), ['current-pdf'])
})

test('confirmed empty academic-extra refresh clears old records while an unconfirmed empty refresh retains them', () => {
  const previous = { routeCodes: ['N219933'], records: [{ id: 'old', title: '旧全校课表' }], attachments: [], completeness: 'complete' }
  const confirmedEmpty = mergeAcademicExtraDomain(previous, {
    routeCodes: ['N219933'], records: [], attachments: [], completeness: 'complete',
  }, { succeeded: true, completeness: 'complete', emptyConfirmed: true })
  assert.deepEqual(confirmedEmpty.records, [])
  assert.equal(confirmedEmpty.completeness, 'complete')

  const unconfirmedEmpty = mergeAcademicExtraDomain(previous, {
    routeCodes: ['N219933'], records: [], attachments: [], completeness: 'partial',
  }, { succeeded: true, completeness: 'partial', emptyConfirmed: false })
  assert.deepEqual(unconfirmedEmpty.records, previous.records)
  assert.equal(unconfirmedEmpty.completeness, 'partial')
})

test('dynamic N305007 queries use the complete selected-term table and bounded fallback details', async () => {
  const calls = []
  const homepage = '<a href="/cjcx/cjcx_cxDgXsxmcj.html">成绩</a><input id="xh" value="2024020417">'
  const pageHtml = '<form id="searchForm"><select name="xnm"><option value="2026" selected>2026</option></select><select name="xqm"><option value="3" selected>1</option></select></form>'
  const client = {
    async page(url) {
      const target = String(url)
      calls.push(['page', target])
      if (target.includes('/xtgl/')) return { url: target, text: homepage }
      if (target.includes('N305007')) return { url: target, text: pageHtml }
      throw new Error(`unexpected page ${target}`)
    },
    async form(url, values) {
      const target = String(url)
      calls.push(['form', target, values])
      if (target.includes('cxXsKcList')) {
        return JSON.stringify({ items: Array.from({ length: 20 }, (_item, index) => ({
          xnm: '2026', xqm: '3', xh_id: '00123', kch_id: `K${index}`, jxb_id: `J${index}`, kcmc: `课程${index}`,
        })) })
      }
      return JSON.stringify({ items: [] })
    },
  }
  const result = await new JwglxtAdapter(client).sync({ domains: ['grade-details'] })
  const domain = result.academicExtras.domains['grade-details']
  assert.equal(domain.records.length, 20)
  assert.equal(domain.queryStats.attempted, 22)
  assert.equal(domain.queryStats.capped, false)
  assert.equal(calls.filter(([kind]) => kind === 'form').length, 22)
})

test('N305007 sends the rendered page year and semester before the discovered global term', async () => {
  const calls = []
  const client = {
    async page(url) {
      const target = String(url)
      if (target.includes('/xtgl/')) return { url: target, text: '<a href="/cjcx/cjcx_cxDgXsxmcj.html">成绩</a>' }
      return {
        url: target,
        text: '<form id="searchForm"><select name="xnm"><option value="2026">2026</option><option value="2025" selected>2025</option></select><select name="xqm"><option value="3">1</option><option value="12" selected>2</option></select></form>',
      }
    },
    async form(url, values) {
      calls.push([String(url), values])
      return JSON.stringify({ items: [] })
    },
  }
  await new JwglxtAdapter(client).sync({ domains: ['grade-details'] })
  const main = calls.find(([url]) => url.includes('cjcx_cxXsKcList'))
  assert.ok(main)
  assert.equal(main[1].xnm, '2025')
  assert.equal(main[1].xqm, '12')
  assert.equal(main[1]['queryModel.showCount'], '5000')
})

test('N305007 reads the aggregate selected-term score table without duplicate per-course requests', async () => {
  const calls = []
  const client = {
    async page(url) {
      const target = String(url)
      if (target.includes('/xtgl/')) return { url: target, text: '<a href="/cjcx/cjcx_cxDgXsxmcj.html">成绩</a>' }
      return {
        url: target,
        text: '<form id="searchForm"><select name="xnm"><option value="2024" selected>2024-2025</option></select><select name="xqm"><option value="12" selected>2</option></select></form>',
      }
    },
    async form(url, values) {
      const target = String(url)
      calls.push([target, values])
      if (target.includes('cxXsKcList')) return JSON.stringify({ items: [{ xnm: '2024', xqm: '12', jxb_id: 'J-1', kcmc: '分析化学' }] })
      if (target.includes('cxXsKccjList')) return JSON.stringify({ items: [{ xnm: '2024', xqm: '12', jxb_id: 'J-1', kcmc: '分析化学', xmblmc: '期末(60%)', xmcj: '88' }] })
      throw new Error(`unexpected fallback query: ${target}`)
    },
  }
  const result = await new JwglxtAdapter(client).sync({ domains: ['grade-details'] })
  assert.equal(calls.length, 2)
  assert.equal(calls.some(([url]) => url.includes('cxXsXmcjList')), false)
  assert.ok(result.academicExtras.domains['grade-details'].records.some((record) => record.componentScore === 88))
})

test('N153540 identifies one current-major PDF without persisting plan rows', async () => {
  const calls = []
  const planPage = '<form id="jxzxjhxxwh_cxJxzxjhxxwhIndex"><input name="jg_id" value="02"><input name="nj_cx" value="2024"><input name="dl" value="专业"><input name="zyh_id_cx" value="0202"></form>'
  const detailPage = '<table><thead><tr><th>课程名称</th><th>状态</th></tr></thead><tbody><tr><td>数据结构</td><td>有效</td></tr></tbody></table>'
  const client = {
    async page(url) {
      const target = String(url)
      calls.push(['page', target])
      if (target.includes('/xtgl/')) return { url: target, text: '<a href="/kbcx/xskbcx_cxXskbcxIndex.html">课表</a><a href="/jxzxjhgl/jxzxjhck_cxJxzxjhckIndex.html">培养计划</a>' }
      if (target.includes('jxzxjhck_cxJxzxjhckIndex')) return { url: target, text: planPage }
      return { url: target, text: detailPage }
    },
    async form(url, values) {
      const target = String(url)
      calls.push(['form', target, values])
      if (target.includes('jxzxjhck_cxJxzxjhckIndex')) {
        return JSON.stringify({ items: [
          { jxzxjhxx_id: 'PLAN-1', njdm: '2024', zyh: '0202', zymc: '高分子材料与工程', jhrs: '10', kcs: '20', zdxf: '171' },
          { jxzxjhxx_id: 'PLAN-2', njdm: '2024', zyh: '0203', zymc: '材料科学与工程', jhrs: '12', kcs: '21', zdxf: '175' },
        ] })
      }
      return JSON.stringify({ items: [] })
    },
  }
  const result = await new JwglxtAdapter(client).sync({ domains: ['academic-plan'] })
  const domain = result.academicExtras.domains['academic-plan']
  const main = calls.find(([kind, url]) => kind === 'form' && url.includes('jxzxjhck_cxJxzxjhckIndex'))
  assert.ok(main)
  assert.equal(main[2].jg_id, '02')
  assert.equal(main[2].njdm_id, '2024')
  assert.equal(main[2].zyh_id, '0202')
  assert.equal(main[2]['queryModel.showCount'], '5000')
  assert.deepEqual(domain.records, [])
  assert.ok(calls.some(([kind, url]) => kind === 'page' && url.includes('jxzxjhxxwh_cxDyJxzxjhxx.html?jxzxjhxx_id=PLAN-1&gnmkdm=N153540')))
  assert.equal(calls.some(([kind, url]) => kind === 'page' && url.includes('jxzxjhxxwh_cxDyJxzxjhxx.html?jxzxjhxx_id=PLAN-2&gnmkdm=N153540')), false)
  assert.equal(calls.some(([, url]) => /jxzxjhkcxx|jxzxjhxdyq|cxBjxx|cxZyfxxx/u.test(url)), false)
})

test('N153540 uses the authenticated browser schedule identity when the plan selector is unselected', async () => {
  const previewUrl = 'https://jwglxt.buct.edu.cn/jwglxt/jxzxjhgl/jxzxjhxxwh_cxDyJxzxjhxx.html?jxzxjhxx_id=PLAN-1&gnmkdm=N153540'
  const calls = []
  const planPage = '<form id="jxzxjhxxwh_cxJxzxjhxxwhIndex"><input name="jg_id" value="02"><select name="nj_cx"><option value="2024" selected>2024</option></select><select name="zyh_id_cx"><option value="">全部</option></select></form>'
  const client = {
    async page(url) {
      const target = String(url)
      calls.push(['page', target])
      if (target.includes('/xtgl/')) return { url: target, text: '<input id="xh" value="2024020417"><a href="/kbcx/xskbcx_cxXskbcxIndex.html">课表</a>' }
      if (target.includes('xskbcx_cxXskbcxIndex')) return { url: target, text: '<form id="ajaxForm"><input name="xnm" value="2026"><input name="xqm" value="3"></form>' }
      if (target.includes('jxzxjhck_cxJxzxjhckIndex')) return { url: target, text: planPage }
      return { url: target, text: '<table><tr><th>项目</th></tr><tr><td>有效</td></tr></table>' }
    },
    async form(url, values) {
      const target = String(url)
      calls.push(['form', target, values])
      if (target.includes('xskbcx_cxXsgrkb')) return JSON.stringify({
        xsxx: { ZYH_ID: '0202', ZYMC: '高分子材料与工程', NJDM_ID: '2024', BJMC: '高材2407' },
        kbList: [],
      })
      if (target.includes('jxzxjhck_cxJxzxjhckIndex')) return JSON.stringify({ items: [
        { jxzxjhxx_id: 'PLAN-1', njdm: '2024', zyh: '0202', zymc: '高分子材料与工程' },
        { jxzxjhxx_id: 'PLAN-2', njdm: '2024', zyh: '0203', zymc: '材料科学与工程' },
      ] })
      return JSON.stringify({ items: [] })
    },
    async binary(url) {
      return { url: previewUrl, status: 200, headers: new Headers({ 'content-type': 'application/pdf' }), buffer: Buffer.from('%PDF-1.7\\nbrowser') }
    },
  }
  const result = await new JwglxtAdapter(client, {
    attachmentStore: {
      async find() { return null },
      async save({ buffer }) { return { cached: true, bytes: buffer.length, filename: 'plan.pdf', sha256: 'a'.repeat(64) } },
    },
  }).sync({ domains: ['academic-plan'] })
  const domain = result.academicExtras.domains['academic-plan']
  const identityQuery = calls.find(([kind, url]) => kind === 'form' && url.includes('xskbcx_cxXsgrkb'))
  const planQuery = calls.find(([kind, url]) => kind === 'form' && url.includes('jxzxjhck_cxJxzxjhckIndex'))
  assert.ok(identityQuery)
  assert.equal(planQuery[2].zyh_id, '')
  assert.equal(calls.some(([kind, url]) => kind === 'form' && url.includes('jxzxjhxx_cxDyJxzxjhxx.html')), false)
  assert.equal(domain.attachments[0].sourceUrl, previewUrl)
  assert.equal(calls.some(([kind, url]) => kind === 'page' && url.includes('jxzxjhxx_cxDyJxzxjhxx.html?jxzxjhxx_id=PLAN-2&gnmkdm=N153540')), false)
  assert.equal(domain.attachments[0].cached, true)
  assert.equal(domain.records.length, 0)
})

test('N153540 stores the authenticated preview PDF as an attachment instead of parsing binary bytes as records', async () => {
  const previewUrl = 'https://jwglxt.buct.edu.cn/jwglxt/jxzxjhgl/jxzxjhxxwh_cxDyJxzxjhxx.html?jxzxjhxx_id=PLAN-1&gnmkdm=N153540'
  const client = {
    async page(url) {
      const target = String(url)
      if (target.includes('/xtgl/')) return { url: target, text: '<input id="xh" value="2024020417"><a href="/jxzxjhgl/jxzxjhck_cxJxzxjhckIndex.html">培养计划</a>' }
      if (target.includes('jxzxjhck_cxJxzxjhckIndex')) return { url: target, text: '<form id="jxzxjhxxwh_cxJxzxjhxxwhIndex"><input name="jg_id" value="02"><input name="nj_cx" value="2024"><input name="dl" value="专业"><input name="zyh_id_cx" value="0202"></form>' }
      if (target.includes('cxDyJxzxjhxx')) return {
        url: previewUrl,
        text: '%PDF-1.7\u0000binary',
        headers: { get: (name) => String(name).toLowerCase() === 'content-type' ? 'application/pdf' : '' },
      }
      return { url: target, text: '<table><tr><th>项目</th></tr><tr><td>有效</td></tr></table>' }
    },
    async form(url) {
      const target = String(url)
      if (target.includes('jxzxjhck_cxJxzxjhckIndex')) return JSON.stringify({ items: [{ jxzxjhxx_id: 'PLAN-1', njdm: '2024', zyh: '0202', zymc: '高分子材料与工程' }] })
      return JSON.stringify({ items: [] })
    },
  }
  const result = await new JwglxtAdapter(client).sync({ domains: ['academic-plan'] })
  const domain = result.academicExtras.domains['academic-plan']
  assert.ok(domain.attachments.some((item) => item.type === 'pdf' && item.sourceUrl === previewUrl))
  assert.equal(domain.records.some((record) => String(record.title || '').includes('%PDF')), false)
  const pdfOnlyDomain = { ...domain, records: [] }
  const pdfOnlyState = { academicExtras: { domains: { 'academic-plan': pdfOnlyDomain } } }
  assert.equal(domainRecordCount(pdfOnlyState, 'academic-plan'), domain.attachments.length)
  assert.ok(domain.attachments.length > 0)
  assert.equal(domainHasData(pdfOnlyState, 'academic-plan'), true)
  assert.equal(result.domainOutcomes['academic-plan'].emptyConfirmed, false)
})

test('N105508 sends doType=query to the graduation audit result endpoint', async () => {
  const calls = []
  const client = {
    async page(url) {
      const target = String(url)
      calls.push(['page', target])
      if (target.includes('/xtgl/')) return { url: target, text: '<input id="xh" value="2024020417"><a href="/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html">课表</a>' }
      return { url: target, text: '<form id="searchForm"><input name="byhcsfsjkz" value="0"><select name="bynd"><option value="2026" selected>2026</option></select></form>' }
    },
    async form(url, values) {
      calls.push(['form', String(url), values])
      return JSON.stringify({ items: [{ graduation_eligibility: '符合' }] })
    },
  }
  const result = await new JwglxtAdapter(client).sync({ domains: ['graduation-audit'] })
  const query = calls.find(([kind, url]) => kind === 'form' && url.includes('bysh_cxByshjgHcIndex.html'))
  assert.ok(query)
  assert.equal(query[1], 'https://jwglxt.buct.edu.cn/jwglxt/bygl/bysh_cxByshjgHcIndex.html')
  assert.deepEqual(query[2], { bynd: '2026', doType: 'query' })
  assert.equal(result.academicExtras.domains['graduation-audit'].records[0].graduationEligibility, '符合')
})

test('removed N219933 school-schedule domain is rejected by the active adapter', async () => {
  const calls = []
  const client = {
    async page(url) {
      const target = String(url)
      calls.push(['page', target])
      if (target.includes('/xtgl/')) return { url: target, text: '<input id="xh" value="2024020417"><a href="/jwglxt/kbcx/xskbcx_cxXsgrkb.html">课表</a>' }
      return {
        url: target,
        text: '<form id="queryForm"><select name="xnm"><option value="2026" selected>2026</option></select><select name="xqm"><option value="3" selected>1</option></select></form><table data-func_widget_guid="LIVE-GUID-219933-20260816"></table>',
      }
    },
    async form(url, values) {
      calls.push(['form', String(url), values])
      return JSON.stringify({ items: [{ kch: '001', kcmc: '全校课程' }] })
    },
  }
  await assert.rejects(
    new JwglxtAdapter(client).sync({ domains: ['jwglxt-school-schedule'] }),
    /Unsupported JWGLXT sync domain/u,
  )
  assert.deepEqual(calls, [])
})
