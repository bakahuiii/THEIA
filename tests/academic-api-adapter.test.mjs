import test from 'node:test'
import assert from 'node:assert/strict'
import { AcademicApiFirstAdapter } from '../core/academic-api-adapter.mjs'
import { AcademicApiClient, AcademicApiError } from '../core/academic-api-client.mjs'
import { sourceDomainOutcome } from '../core/domain-provenance.mjs'

function redirectResponse(location) {
  return {
    ok: false,
    status: 302,
    url: '',
    headers: new Headers({ Location: location }),
    async arrayBuffer() { return new ArrayBuffer(0) },
  }
}

test('academic API rejects off-campus URLs and redirects before sending credentials again', async () => {
  const calls = []
  const client = new AcademicApiClient({
    username: '2024000000',
    password: 'secret',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), cookie: new Headers(init.headers).get('Cookie') })
      return redirectResponse('https://example.com/collect')
    },
  })
  client.cookies.set('JSESSIONID', 'private-session')

  await assert.rejects(client.request('https://example.com/start'), /拒绝访问非校园网地址/)
  assert.equal(calls.length, 0)
  await assert.rejects(client.request('https://course.buct.edu.cn/meol/start'), /拒绝访问非校园网地址/)
  assert.equal(calls.length, 0)
  await assert.rejects(client.request('https://jwglxt.buct.edu.cn/jwglxt/start'), /拒绝重定向到非校园网地址/)
  assert.deepEqual(calls, [{ url: 'https://jwglxt.buct.edu.cn/jwglxt/start', cookie: 'JSESSIONID=private-session' }])
})

test('academic API changes redirected POST requests to GET without retaining their body', async () => {
  const calls = []
  const client = new AcademicApiClient({
    username: '2024000000',
    password: 'secret',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init.method, body: init.body, contentType: new Headers(init.headers).get('Content-Type') })
      if (calls.length === 1) return redirectResponse('/jwglxt/next')
      return {
        ok: true,
        status: 200,
        url: String(url),
        headers: new Headers(),
        async arrayBuffer() { return new TextEncoder().encode('ok').buffer },
      }
    },
  })

  await client.request('https://jwglxt.buct.edu.cn/jwglxt/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'secret=one',
  })
  assert.deepEqual(calls, [
    { url: 'https://jwglxt.buct.edu.cn/jwglxt/start', method: 'POST', body: 'secret=one', contentType: 'application/x-www-form-urlencoded' },
    { url: 'https://jwglxt.buct.edu.cn/jwglxt/next', method: 'GET', body: undefined, contentType: null },
  ])
})

test('academic API reads requirement rows with its own authenticated cookie jar', async () => {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body || null })
    const body = init.method === 'POST'
      ? JSON.stringify([{ KCH: 'MAT14000G', KCMC: 'Mathematics', XDZT: '3' }])
      : '"Foundation&nbsp; \u8981\u6c42\u5b66\u5206: 10 \u83b7\u5f97\u5b66\u5206: 4 \u672a\u83b7\u5f97\u5b66\u5206: 6 <span id=\'showKcnode-1\'></span><input id="xh_id" value="2024000000">'
    return {
      ok: true,
      status: 200,
      url: String(url),
      headers: new Headers(),
      async arrayBuffer() { return new TextEncoder().encode(body).buffer },
    }
  }
  const client = new AcademicApiClient({ username: '2024000000', password: 'secret', fetchImpl })
  const result = await client.academicProgressDetails()
  assert.equal(result.sid, '2024000000')
  assert.equal(result.details[0].id, 'node-1')
  assert.equal(result.details[0].courses[0].KCH, 'MAT14000G')
  assert.deepEqual(calls.map((call) => call.method), ['GET', 'POST'])
  assert.equal(new URLSearchParams(calls[1].body).get('xh_id'), '2024000000')
})

test('academic API recovers parent and choice edges from escaped N105515 tree markup', async () => {
  const tree = '<ul><li><div class="title" xfyqjd_id="root"><p class="title1" yqzdxf="100" yxxf="10">Program</p></div><ul><li fxfyqjd_id="root" xfyqzjdgx="1"><div class="title" xfyqjd_id="foundation"><p class="title1" yqzdxf="60" yxxf="20">Foundation</p></div><ul><li fxfyqjd_id="foundation" xfyqzjdgx="0"><div class="title" xfyqjd_id="history"><p class="title1" yqzdxf="1" yxxf="0">History route</p></div></li><li fxfyqjd_id="foundation" xfyqzjdgx="0"><div class="title" xfyqjd_id="free"><p class="title1" yqzdxf="1" yxxf="0">Free elective</p></div></li></ul></li></ul></li></ul>'
  const escapedTree = tree.replace(/"/g, '\\"')
  const fetchImpl = async (_url, init = {}) => {
    const body = init.method === 'POST' ? JSON.stringify([]) : `<div id="alertBox">计划总课程 42 门 通过 30 门 未通过 2 门 未修 8 门 在读 2 门 计划外 通过 3 门 未通过 1 门</div><a name="showGpa">GPA</a><span>3.21</span><script>const plan = "${escapedTree}"</script><input id="xh_id" value="2024000000">`
    return {
      ok: true,
      status: 200,
      url: 'https://jwglxt.buct.edu.cn/jwglxt/xsxy/xsxyqk_cxXsxyqkIndex.html',
      headers: new Headers(),
      async arrayBuffer() { return new TextEncoder().encode(body).buffer },
    }
  }
  const client = new AcademicApiClient({ username: '2024000000', password: 'secret', fetchImpl })
  const result = await client.academicProgressDetails()
  const foundation = result.progress.roots[0].children[0]

  assert.equal(foundation.title, 'Foundation')
  assert.deepEqual(foundation.children.map((node) => node.title), ['History route', 'Free elective'])
  assert.deepEqual(foundation.children.map((node) => node.relation), ['or', 'or'])
  assert.equal(result.progress.gpa, 3.21)
  assert.deepEqual(result.progress.courseCounts, {
    planned: { total: 42, passed: 30, failed: 2, notTaken: 8, studying: 2 },
    outsidePlan: { passed: 3, failed: 1 },
  })
})

test('academic API mode does not poll the browser session it displaces', async () => {
  let browserStatusCalls = 0
  const adapter = new AcademicApiFirstAdapter({
    browserAdapter: {
      async status() { browserStatusCalls += 1; return { connected: false } },
      async sync() { return {} },
    },
    credentialVault: { async readCredentials() { return { username: '2024000000', password: 'secret' } } },
    isEnabled: () => true,
  })

  const status = await adapter.status()
  assert.equal(status.connected, true)
  assert.equal(status.mode, 'api')
  assert.equal(browserStatusCalls, 0)
})

test('academic adapter forwards a scoped progress request without running other domains', async () => {
  let receivedOptions = null
  let detailsCalls = 0
  const adapter = new AcademicApiFirstAdapter({
    browserAdapter: { onProgress: null, async status() { return { connected: false } } },
    credentialVault: { async readCredentials() { return { username: '2024000000', password: 'secret' } } },
    isEnabled: () => true,
    clientFactory: () => ({
      async login() {},
      async academicProgressDetails() { detailsCalls += 1; return { progress: { categories: [] }, details: [], errors: [] } },
    }),
    adapterFactory: () => ({
      async sync(options) {
        receivedOptions = options
        return {
          academicProgress: { gpa: 1.78, roots: [{ id: 'plan', children: [], courses: [{ id: 'course' }] }], requirementSource: 'api-tree-detail' },
          domainOutcomes: {
            'academic-progress': sourceDomainOutcome({
              source: 'jwglxt', attempted: true, succeeded: true, status: 'succeeded',
              capturedAt: '2026-08-14T01:00:00.000Z', completeness: 'complete', parserVersion: 'jwglxt-adapter/1',
            }),
          },
          source: { connected: true },
          errors: [],
        }
      },
    }),
  })

  const result = await adapter.sync({ domains: ['academic-progress'] })
  assert.deepEqual(receivedOptions, { domains: ['academic-progress'] })
  assert.equal(detailsCalls, 0)
  assert.deepEqual(Object.keys(result.domainOutcomes), ['academic-progress'])
})

test('academic API failure preserves local data without evicting browser SSO again', async () => {
  let browserCalls = 0
  const browserAdapter = {
    onProgress: null,
    async status() { return { connected: true } },
    async sync() {
      browserCalls += 1
      return { source: { connected: true }, errors: [], schedule: [{ id: 'browser-schedule' }] }
    },
  }
  const adapter = new AcademicApiFirstAdapter({
    browserAdapter,
    credentialVault: { async readCredentials() { return { username: '2024000000', password: 'secret' } } },
    isEnabled: () => true,
    clientFactory: () => ({ async login() { throw new AcademicApiError(2333, '系统维护') } }),
  })
  const result = await adapter.sync()
  assert.equal(browserCalls, 0)
  assert.equal(result.source.connected, false)
  assert.deepEqual(result.source.api, { enabled: true, used: false, fallback: false, code: 2333 })
})

test('academic API preserves partial session errors alongside failed domain outcomes', async () => {
  const diagnostics = []
  const partialSessionError = 'Schedule \u4f1a\u8bdd\u5df2\u5931\u6548'
  const adapter = new AcademicApiFirstAdapter({
    browserAdapter: { onProgress: null, async status() { return { connected: true } } },
    credentialVault: { async readCredentials() { return { username: '2024000000', password: 'secret' } } },
    isEnabled: () => true,
    clientFactory: () => ({ async login() {} }),
    adapterFactory: () => ({
      async sync() {
        return {
          academicProgress: { requirementSource: 'api-tree-detail', roots: [] },
          domainOutcomes: {
            schedule: {
              attempted: true,
              succeeded: false,
              status: 'failed',
              completeness: 'unknown',
              errorCode: 'schedule_read_failed',
            },
          },
          errors: [partialSessionError],
          source: { connected: true, errors: [partialSessionError] },
        }
      },
    }),
    onDiagnostic: (event, fields) => diagnostics.push({ event, fields }),
  })

  const result = await adapter.sync()
  assert.deepEqual(result.errors, [partialSessionError])
  assert.deepEqual(result.source.errors, [partialSessionError])
  assert.deepEqual(result.source.diagnostics.partialSessionErrors, [partialSessionError])
  assert.equal(result.domainOutcomes.schedule.status, 'failed')
  assert.deepEqual(
    diagnostics.find((entry) => entry.event === 'academic_api.partial_session_errors')?.fields,
    { count: 1 },
  )
})

test('academic API enriches its GPA summary with same-session degree-plan details', async () => {
  let browserCalls = 0
  const apiProgress = {
    gpa: 2.75,
    courseCounts: { planned: { total: 160, passed: 31, failed: 4, notTaken: 125, studying: 0 }, outsidePlan: { passed: 0, failed: 0 } },
    categories: [],
  }
  const adapter = new AcademicApiFirstAdapter({
    browserAdapter: {
      onProgress: null,
      async status() { return { connected: true } },
      async fetchAcademicProgress() { browserCalls += 1 },
    },
    credentialVault: { async readCredentials() { return { username: '2024000000', password: 'secret' } } },
    isEnabled: () => true,
    clientFactory: () => ({
      async login() {},
      async academicProgressDetails() {
        return {
          sourceUrl: 'https://jwglxt.buct.edu.cn/plan',
          errors: [],
          progress: {
            program: 'Materials Engineering',
            categories: [
              { id: 'foundation', title: 'Foundation', required: 60, earned: 30, remaining: 30, children: [{ id: 'mathematics' }] },
              { id: 'mathematics', title: 'Mathematics', required: 4, earned: 0, remaining: 4, parentId: 'foundation', children: [] },
            ],
            roots: [{ id: 'foundation', title: 'Foundation', required: 60, earned: 30, remaining: 30, children: [{ id: 'mathematics' }] }],
          },
          details: [{
            id: 'mathematics', title: 'Mathematics', required: 4, earned: 0, remaining: 4,
            courses: [{ KCH: 'MAT14000G', KCMC: 'Mathematics', XDZT: '3', XF: '4', KCXZMC: 'Required', KCLBMC: 'Foundation', XNM: '2024', XQM: '3', JYXDXNM: '2024', JYXDXQM: '3' }],
          }],
        }
      },
    }),
    adapterFactory: () => ({
      async sync() {
        return {
          academicProgress: apiProgress,
          domainOutcomes: {
            'academic-progress': {
              source: ['jwglxt'],
              attempted: true,
              succeeded: true,
              status: 'succeeded',
              capturedAt: '2026-08-13T01:00:00.000Z',
              completeness: 'partial',
              parserVersion: 'jwglxt-adapter/1',
              errorCode: 'summary_only',
            },
          },
          source: { connected: true },
          errors: [],
        }
      },
    }),
  })

  const result = await adapter.sync()
  assert.equal(browserCalls, 0)
  assert.equal(result.academicProgress.gpa, 2.75)
  assert.equal(result.academicProgress.roots[0].children[0].courses[0].studyStatus, '在读')
  assert.equal(result.academicProgress.roots[0].children[0].courses[0].courseCode, 'MAT14000G')
  assert.equal(result.academicProgress.roots[0].children[0].courses[0].recommendedYear, '2024')
  assert.equal(result.academicProgress.requirementSource, 'api-tree-detail')
  assert.equal(result.source.api.academicProgress, 'api-detail')
  assert.equal(result.domainOutcomes['academic-progress'].succeeded, true)
  assert.equal(result.domainOutcomes['academic-progress'].completeness, 'complete')
  assert.equal(result.domainOutcomes['academic-progress'].errorCode, null)
  assert.deepEqual(result.domainOutcomes['academic-progress'].source, ['jwglxt'])
  assert.equal(result.domainOutcomes['academic-progress'].parserVersion, 'jwglxt-adapter/1')
  assert.equal(result.domainOutcomes['academic-progress'].capturedAt, '2026-08-13T01:00:00.000Z')
})

test('academic API tree detail retains planned courses beneath their official parent requirements', async () => {
  const adapter = new AcademicApiFirstAdapter({
    browserAdapter: { onProgress: null, async status() { return { connected: true } } },
    credentialVault: { async readCredentials() { return { username: '2024000000', password: 'secret' } } },
    isEnabled: () => true,
    clientFactory: () => ({
      async login() {},
      async academicProgressDetails() {
        return {
          sourceUrl: 'https://jwglxt.buct.edu.cn/plan',
          errors: [],
          progress: {
            categories: [
              { id: 'major', title: 'Major requirements', required: 40, earned: 10, remaining: 30, children: [{ id: 'electives' }] },
              { id: 'electives', title: 'Professional electives', required: 8, earned: 0, remaining: 8, parentId: 'major', relation: 'or', children: [] },
            ],
            roots: [{ id: 'major', title: 'Major requirements', required: 40, earned: 10, remaining: 30, children: [{ id: 'electives' }] }],
          },
          details: [{ id: 'electives', courses: [
            { KCH: 'POL14000G', KCMC: 'Planned course', XDZT: 1, XF: '2' },
            { KCH: 'POL14001G', KCMC: 'Current course', XDZT: 3, XF: '2', XNM: '2026', XQM: '3' },
            { KCH: 'POL14002G', KCMC: 'Failed course', XDZT: 2, XF: '2' },
            { KCH: 'POL14003G', KCMC: 'Passed course', XDZT: 4, XF: '2' },
          ] }],
        }
      },
    }),
    adapterFactory: () => ({ async sync() { return { academicProgress: { gpa: 2.5 }, source: { connected: true }, errors: [] } } }),
  })

  const result = await adapter.sync()
  const root = result.academicProgress.roots[0]
  assert.equal(root.title, 'Major requirements')
  assert.equal(root.children[0].title, 'Professional electives')
  assert.equal(root.children[0].relation, 'or')
  assert.equal(root.children[0].courses[0].studyStatus, '未修')
  assert.deepEqual(root.children[0].courses.map((course) => course.studyStatus), ['未修', '在读', '未通过', '已修'])
})

test('academic API makes direct course rows a sibling branch of official requirements', async () => {
  const adapter = new AcademicApiFirstAdapter({
    browserAdapter: { onProgress: null, async status() { return { connected: true } } },
    credentialVault: { async readCredentials() { return { username: '2024000000', password: 'secret' } } },
    isEnabled: () => true,
    clientFactory: () => ({
      async login() {},
      async academicProgressDetails() {
        return {
          sourceUrl: 'https://jwglxt.buct.edu.cn/plan',
          errors: [],
          progress: {
            categories: [
              { id: 'program', title: '培养方案', required: 160, earned: 40, children: [{ id: 'public-elective' }, { id: 'major-required' }] },
              { id: 'public-elective', title: '公共基础选修', required: 4, earned: 0, parentId: 'program', children: [{ id: 'history' }] },
              { id: 'history', title: '四史模块', required: 1, earned: 0, parentId: 'public-elective', children: [] },
              { id: 'major-required', title: '专业必修', required: 40, earned: 10, parentId: 'program', children: [{ id: 'innovation' }] },
              { id: 'innovation', title: '创新模块', required: 2, earned: 0, parentId: 'major-required', children: [] },
            ],
            roots: [{ id: 'program', title: '培养方案', required: 160, earned: 40, children: [{ id: 'public-elective' }, { id: 'major-required' }] }],
          },
          details: [
            { id: 'public-elective', courses: [{ KCH: 'PUB14000G', KCMC: 'Public elective', XDZT: 1, XF: '2' }] },
            { id: 'major-required', courses: [{ KCH: 'MAJ14000G', KCMC: 'Major course', XDZT: 1, XF: '4' }] },
          ],
        }
      },
    }),
    adapterFactory: () => ({ async sync() { return { academicProgress: { gpa: 2.5 }, source: { connected: true }, errors: [] } } }),
  })

  const result = await adapter.sync()
  const [publicElective, majorRequired] = result.academicProgress.roots[0].children
  assert.deepEqual(publicElective.children.map((entry) => entry.title), ['任意选修', '四史模块'])
  assert.deepEqual(majorRequired.children.map((entry) => entry.title), ['无方向', '创新模块'])
  assert.equal(publicElective.courses.length, 0)
  assert.equal(publicElective.children[0].courses[0].title, 'Public elective')
  assert.equal(majorRequired.children[0].courses[0].title, 'Major course')
  assert.doesNotThrow(() => JSON.stringify(result.academicProgress))
  assert.doesNotThrow(() => structuredClone(result.academicProgress))
})

test('academic API infers an AND/OR tree when Zhengfang only returns ordered sfmjd markers', async () => {
  const adapter = new AcademicApiFirstAdapter({
    browserAdapter: { onProgress: null, async status() { return { connected: true } } },
    credentialVault: { async readCredentials() { return { username: '2024000000', password: 'secret' } } },
    isEnabled: () => true,
    clientFactory: () => ({
      async login() {},
      async academicProgressDetails() {
        return {
          sourceUrl: 'https://jwglxt.buct.edu.cn/plan',
          errors: [],
          progress: {
            program: "sfmjd='0' > Materials Engineering",
            categories: [
              { id: 'core', title: "sfmjd='0' > Core requirements", required: 60, earned: 30, remaining: 30 },
              { id: 'simulation', title: "sfmjd='1' > Materials simulation", required: 4, earned: 0, remaining: 4 },
              { id: 'innovation', title: "sfmjd='0' > Innovation module", required: 2, earned: 0, remaining: 2 },
            ],
          },
          details: [{ id: 'simulation', courses: [{ KCH: 'MAT14000G', KCMC: 'Materials simulation', XDZT: 1, XF: '4' }] }],
        }
      },
    }),
    adapterFactory: () => ({ async sync() { return { academicProgress: { gpa: 2.5 }, source: { connected: true }, errors: [] } } }),
  })

  const result = await adapter.sync()
  const root = result.academicProgress.roots[0]
  assert.equal(result.academicProgress.requirementSource, 'api-inferred-tree')
  assert.equal(root.title, 'Materials Engineering')
  assert.equal(root.children.length, 2)
  assert.equal(root.children[0].title, 'Core requirements')
  assert.equal(root.children[0].children[0].title, 'Materials simulation')
  assert.equal(root.children[0].children[0].relation, 'or')
  assert.equal(root.children[0].children[0].courses[0].courseCode, 'MAT14000G')
})

test('academic API retains its summary when degree-plan enrichment is unavailable', async () => {
  const apiProgress = { gpa: 3.1, categories: [] }
  const adapter = new AcademicApiFirstAdapter({
    browserAdapter: {
      onProgress: null,
      async status() { return { connected: false } },
      async fetchAcademicProgress() { throw new Error('authentication required') },
    },
    credentialVault: { async readCredentials() { return { username: '2024000000', password: 'secret' } } },
    isEnabled: () => true,
    clientFactory: () => ({ async login() {} }),
    adapterFactory: () => ({
      async sync() {
        return {
          academicProgress: apiProgress,
          domainOutcomes: {
            'academic-progress': {
              attempted: true,
              succeeded: true,
              status: 'succeeded',
              completeness: 'partial',
              errorCode: 'summary_only',
            },
          },
          source: { connected: true },
          errors: [],
        }
      },
    }),
  })

  const result = await adapter.sync()
  assert.equal(result.academicProgress, apiProgress)
  assert.equal(result.source.api.academicProgress, 'summary-only')
  assert.equal(result.domainOutcomes['academic-progress'].completeness, 'partial')
  assert.equal(result.domainOutcomes['academic-progress'].errorCode, 'summary_only')
})

test('academic API keeps progress provenance partial when degree-plan details are empty', async () => {
  const adapter = new AcademicApiFirstAdapter({
    browserAdapter: { onProgress: null, async status() { return { connected: false } } },
    credentialVault: { async readCredentials() { return { username: '2024000000', password: 'secret' } } },
    isEnabled: () => true,
    clientFactory: () => ({
      async login() {},
      async academicProgressDetails() { return { progress: { categories: [], roots: [] }, details: [], errors: [] } },
    }),
    adapterFactory: () => ({
      async sync() {
        return {
          academicProgress: { gpa: 3.1, categories: [] },
          domainOutcomes: {
            'academic-progress': {
              attempted: true,
              succeeded: true,
              status: 'succeeded',
              completeness: 'partial',
              errorCode: 'summary_only',
            },
          },
          source: { connected: true },
          errors: [],
        }
      },
    }),
  })

  const result = await adapter.sync()
  assert.equal(result.domainOutcomes['academic-progress'].completeness, 'partial')
  assert.equal(result.domainOutcomes['academic-progress'].errorCode, 'summary_only')
  assert.equal(result.source.api.academicProgress, 'summary-only')
})
