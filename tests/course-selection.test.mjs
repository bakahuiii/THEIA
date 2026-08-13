import test from 'node:test'
import assert from 'node:assert/strict'
import { CourseSelectionService } from '../core/course-selection.mjs'
import { cacheSchoolScheduleResult, cachedSchoolScheduleResult, emptyDataCatalog } from '../core/data-catalog.mjs'
import { AuthRequiredError } from '../core/source-client.mjs'

test('course selection discovers a Zhengfang block and submits through the shared form client', async () => {
  const forms = []
  let successfulSyncs = 0
  const index = `
    <input id="xnm" name="xnm" value="2026">
    <input id="xqm" name="xqm" value="3">
    <input type="hidden" name="njdm_id" value="2026">
    <input type="hidden" name="xkxnm" value="2027">
    <input type="hidden" name="xkxqm" value="3">
    <input type="hidden" name="zyh_id" value="CHEM">
    <input type="hidden" name="bklx_id" value="undergraduate">
    <input type="hidden" name="xqh_id" value="main">
    <input type="hidden" name="rwlx" value="normal">
    <a role="tab" onclick="loadBlock('TJK', 'block-1')">General elective</a>
  `
  const client = {
    async page(url) { return { url, text: index } },
    async form(url, values) {
      forms.push({ url, values })
      if (url.includes('cxZzxkYzbDisplay')) return '<input type="hidden" name="kkbk" value="all">'
      if (url.includes('cxZzxkYzbPartDisplay')) return JSON.stringify({ tmpList: [{ kch_id: 'COURSE-1', kcmc: 'Organic chemistry', xf: '3' }] })
      if (url.includes('cxJxbWithKch')) return JSON.stringify([{ jxb_id: 'CLASS-1', jxbmc: 'Organic chemistry 01', do_jxb_id: 'OP-1', kcmc: 'Organic chemistry', jsxx: '1001/Teacher/', jxbrl: '50', yxzrs: '49', sksj: 'Mon 1-2', jxdd: 'A-203' }])
      if (url.includes('xkBcZyZzxkYzb')) return JSON.stringify({ flag: '1', msg: 'Selection successful' })
      throw new Error(`Unexpected form URL: ${url}`)
    },
  }
  const service = new CourseSelectionService({
    client,
    getState: () => ({ terms: [{ id: '2026-3', year: 2026, term: '3', label: '2026-2027' }] }),
    onSuccess: async () => { successfulSyncs += 1 },
  })

  const portal = await service.discover()
  assert.equal(portal.available, true)
  assert.equal(portal.term.id, '2027-3')
  assert.deepEqual(portal.blocks, [{ id: 'block-1', categoryCode: 'TJK', title: 'General elective' }])

  const catalog = await service.candidates('block-1', null, { page: 3, pageSize: 48 })
  assert.equal(catalog.candidates.length, 1)
  assert.equal(catalog.page, 3)
  assert.equal(catalog.pageSize, 48)
  assert.equal(catalog.candidates[0].classId, 'CLASS-1')
  assert.equal(catalog.candidates[0].className, 'Organic chemistry 01')
  assert.equal(catalog.candidates[0].operationId, 'OP-1')
  assert.equal(catalog.candidates[0].remainingSeats, 1)
  assert.equal(forms.find((item) => item.url.includes('cxZzxkYzbPartDisplay')).values.xkxnm, '2027')
  assert.equal(forms.find((item) => item.url.includes('cxZzxkYzbPartDisplay')).values.xkxqm, '3')
  assert.equal(forms.find((item) => item.url.includes('cxZzxkYzbPartDisplay')).values.kspage, '3')
  assert.equal(forms.find((item) => item.url.includes('cxZzxkYzbPartDisplay')).values.jspage, '48')

  service.start({ candidate: catalog.candidates[0], intervalMs: 1000, maxAttempts: 1 })
  await new Promise((resolve) => setTimeout(resolve, 30))
  const job = service.snapshot().active
  assert.equal(job.status, 'selected')
  assert.equal(job.attempts.length, 1)
  assert.equal(job.attempts[0].success, true)
  assert.equal(successfulSyncs, 1)
  const request = forms.find((item) => item.url.includes('xkBcZyZzxkYzb'))
  assert.deepEqual(request.values, {
    jxb_ids: 'OP-1', kch_id: 'COURSE-1', qz: '0', xkxnm: '2027', xkxqm: '3',
    njdm_id: '2026', zyh_id: 'CHEM', kklxdm: 'TJK', xkkz_id: 'block-1', rwlx: 'normal',
  })
})

test('course selection uses the supplied academic API client instead of the browser client', async () => {
  let browserCalls = 0
  let apiCalls = 0
  const apiClient = {
    async page(url) {
      apiCalls += 1
      return {
        url,
        text: '<input type="hidden" name="xnm" value="2026"><input type="hidden" name="xqm" value="3"><input type="hidden" name="xkxnm" value="2026"><input type="hidden" name="xkxqm" value="3"><a role="tab" onclick="loadBlock(\'TJK\', \'block-1\')">General elective</a>',
      }
    },
  }
  const service = new CourseSelectionService({
    client: { async page() { browserCalls += 1; throw new Error('browser client must not be used') } },
    courseSelectionClientFactory: async () => apiClient,
    getState: () => ({ terms: [{ id: '2026-3', year: 2026, term: '3' }] }),
  })

  const portal = await service.discover()
  assert.equal(portal.available, true)
  assert.equal(apiCalls, 1)
  assert.equal(browserCalls, 0)
})

test('course selection treats a successful status with a failure message as a failed attempt', async () => {
  let successfulSyncs = 0
  const index = `
    <input type="hidden" name="xkxnm" value="2027">
    <input type="hidden" name="xkxqm" value="3">
    <a role="tab" onclick="loadBlock('TJK', 'block-1')">General elective</a>
  `
  const client = {
    async page(url) { return { url, text: index } },
    async form(url) {
      if (url.includes('xkBcZyZzxkYzb')) return JSON.stringify({ status: 200, msg: '选课失败：容量已满' })
      throw new Error(`Unexpected form URL: ${url}`)
    },
  }
  let resolveFinished
  const finished = new Promise((resolve) => { resolveFinished = resolve })
  const service = new CourseSelectionService({
    client,
    getState: () => ({ terms: [{ id: '2026-3', year: 2026, term: '3' }] }),
    onSuccess: async () => { successfulSyncs += 1 },
    onChange: (snapshot) => {
      if (snapshot.active?.status === 'exhausted') resolveFinished(snapshot.active)
    },
  })

  service.start({
    candidate: { courseId: 'COURSE-1', operationId: 'OP-1', categoryCode: 'TJK', blockId: 'block-1' },
    intervalMs: 1_000,
    maxAttempts: 2,
  })
  const job = await Promise.race([
    finished,
    new Promise((_, reject) => setTimeout(() => reject(new Error('course-selection failure test timed out')), 3_000)),
  ])
  assert.equal(job.status, 'exhausted')
  assert.equal(job.attempts.length, 2)
  assert.equal(job.attempts.every((attempt) => attempt.success === false), true)
  assert.equal(successfulSyncs, 0)
})

test('course selection resolves an exact teaching class and never substitutes the first candidate', async () => {
  const service = new CourseSelectionService({
    client: {},
    getState: () => ({ terms: [{ id: '2026-3', year: 2026, term: '3' }] }),
  })
  service.discover = async () => ({
    sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/xsxk/',
    available: true,
    blocks: [{ id: 'block-1', categoryCode: 'TJK', title: 'General elective' }],
  })
  service.candidates = async () => ({
    total: 2,
    candidates: [
      { id: 'candidate-1', classId: 'CLASS-1', className: 'Teaching class 01', operationId: 'OP-1', teacher: 'Teacher Li', time: 'Mon 1-2', location: 'A-101' },
      { id: 'candidate-2', classId: 'CLASS-2', className: 'Teaching class 02', operationId: 'OP-2', teacher: 'Teacher Wang', time: 'Tue 3-4', location: 'A-102' },
    ],
  })

  const byId = await service.findCandidate({ courseCode: 'CHE10001T', title: 'Chemistry', classId: 'CLASS-2', className: 'Teaching class 02' })
  assert.equal(byId.operationId, 'OP-2')

  const legacy = await service.findCandidate({ courseCode: 'CHE10001T', title: 'Chemistry', className: 'CLASS-2' })
  assert.equal(legacy.operationId, 'OP-2')

  const byName = await service.findCandidate({ courseCode: 'CHE10001T', title: 'Chemistry', className: 'Teaching class 01' })
  assert.equal(byName.operationId, 'OP-1')

  await assert.rejects(
    service.findCandidate({ courseCode: 'CHE10001T', title: 'Chemistry', classId: 'MISSING', className: 'Missing class' }),
    /CLASS_NOT_FOUND.*requestedClass=MISSING/,
  )
})

test('course selection accepts a course-only target only when one candidate is unambiguous', async () => {
  const service = new CourseSelectionService({
    client: {},
    getState: () => ({ terms: [{ id: '2026-3', year: 2026, term: '3' }] }),
  })
  service.discover = async () => ({
    sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/xsxk/',
    available: true,
    blocks: [{ id: 'block-1', categoryCode: 'TJK', title: 'General elective' }],
  })
  service.candidates = async () => ({ total: 1, candidates: [{ id: 'candidate-1', classId: 'CLASS-1', operationId: 'OP-1' }] })

  const matched = await service.findCandidate({ courseCode: 'CHE10001T', title: 'Chemistry' })
  assert.equal(matched.operationId, 'OP-1')
})

test('school-wide schedule search uses the N219933 design endpoint and stores normalized results', async () => {
  const forms = []
  let cached = null
  const service = new CourseSelectionService({
    client: {
      async page(url) { return { url, text: '<input id="xh" value="2024TEST01">' } },
      async form(url, values) {
        forms.push({ url, values })
        return JSON.stringify({ totalCount: 1, items: [{ kcmc: '高等数学 A', kch: 'MAT13904T', JXB_ID: 'JXB-01', JXBMC: '高分子 01', HBXX: '高材 2401、高材 2402', jxbzc: '备用教学班组成', rkjs: '李老师', sksj: '星期一第1-2节', jxdd: '第一教学楼 203', xf: '5.5', KCXZMC: '公共基础必修', KCLBMC: '素质教育课程', KKBMMC: '数理学院', kkzt: '开课' }] })
      },
    },
    getState: () => ({ terms: [{ id: '2026-3', year: 2026, term: '3', label: '2026-2027 第一学期' }] }),
    onSchoolSchedule: async (result) => { cached = result },
  })

  const result = await service.schoolSchedule({
    termId: '2026-3',
    keyword: '高等数学',
    teacher: '李老师',
    category: '素质教育课程',
    page: 1,
    pageSize: 48,
  })
  assert.equal(result.total, 1)
  assert.equal(result.page, 1)
  assert.equal(result.pageSize, 1)
  assert.equal(result.complete, true)
  assert.equal(result.fromCache, false)
  assert.match(result.capturedAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(result.items[0].courseCode, 'MAT13904T')
  assert.equal(result.items[0].classId, 'JXB-01')
  assert.equal(result.items[0].className, '高分子 01')
  assert.equal(result.items[0].combinedClassInfo, '高材 2401、高材 2402')
  assert.equal(result.items[0].location, '第一教学楼 203')
  assert.equal(result.items[0].nature, '公共基础必修')
  assert.equal(result.items[0].category, '素质教育课程')
  assert.equal(result.items[0].department, '数理学院')
  assert.equal(cached.items[0].department, '数理学院')
  assert.equal(cached.items[0].combinedClassInfo, '高材 2401、高材 2402')
  const request = forms[0]
  assert.match(request.url, /funcData_cxFuncDataList\.html/)
  assert.equal(request.values.xnm, '2026')
  assert.equal(request.values.xqm, '3')
  assert.equal(request.values._search, 'false')
  assert.match(request.values.nd, /^\d+$/)
  assert.equal(request.values['queryModel.showCount'], '500')
  assert.equal(request.values['queryModel.currentPage'], '1')
  assert.equal(request.values['queryModel.sortOrder'], 'asc')
  assert.equal(request.values.time, '0')
})

test('school-wide schedule falls back to the isolated academic API session when browser SSO is absent', async () => {
  let loginCalls = 0
  const forms = []
  const apiClient = {
    async login() { loginCalls += 1 },
    async page(url) { return { url, text: '<input id="xh" value="2024TEST01">' } },
    async form(url, values) {
      forms.push({ url, values })
      return JSON.stringify({ total: 1, items: [{ kcmc: 'Materials science', kch: 'MSE10000T', jxbmc: '01' }] })
    },
  }
  const service = new CourseSelectionService({
    client: { async page(url) { throw new AuthRequiredError('School-wide schedule', url) } },
    academicClientFactory: async () => apiClient,
    getState: () => ({ terms: [{ id: '2026-3', year: 2026, term: '3' }] }),
  })

  const result = await service.schoolSchedule({ termId: '2026-3', keyword: 'Materials' })
  assert.equal(loginCalls, 1)
  assert.equal(result.items[0].courseCode, 'MSE10000T')
  assert.equal(forms.length, 1)
  assert.equal(forms[0].values.kc, undefined)
})

test('school-wide schedule returns a complete local catalog without another request', async () => {
  const dataCatalog = cacheSchoolScheduleResult(emptyDataCatalog(), {
    scope: { termId: '2026-3', keyword: 'Calculus' },
    total: 13,
    complete: true,
    items: Array.from({ length: 13 }, (_, index) => ({
      title: `Calculus ${index + 1}`,
      courseCode: `MAT${index + 1}`,
    })),
  })
  const service = new CourseSelectionService({
    client: {
      async page() { throw new Error('cached query should not access the network') },
    },
    getState: () => ({
      dataCatalog,
      terms: [{ id: '2026-3', year: 2026, term: '3' }],
    }),
  })

  const result = await service.schoolSchedule({ termId: '2026-3', keyword: 'Calculus', page: 2, pageSize: 12 })
  assert.equal(result.page, 1)
  assert.equal(result.complete, true)
  assert.equal(result.fromCache, true)
  assert.match(result.capturedAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(result.total, 13)
  assert.equal(result.items.length, 13)
  assert.equal(result.items[12].title, 'Calculus 13')
})

test('school-wide schedule reads Zhengfang queryModel pages once and filters the complete term locally', async () => {
  let forms = 0
  let dataCatalog = emptyDataCatalog()
  const rows = Array.from({ length: 1001 }, (_, index) => ({
    kcmc: index === 1000 ? 'Advanced calculus' : `Course ${index + 1}`,
    kch: `C${String(index + 1).padStart(4, '0')}`,
    jxbmc: `Class ${index + 1}`,
    rkjs: index === 1000 ? 'Teacher Wang' : 'Teacher Li',
  }))
  const service = new CourseSelectionService({
    client: {
      async page(url) { return { url, text: '<input id="xh" value="2024TEST01">' } },
      async form(_url, values) {
        forms += 1
        const page = Number(values['queryModel.currentPage'])
        return JSON.stringify({ totalCount: rows.length, items: rows.slice((page - 1) * 500, page * 500) })
      },
    },
    getState: () => ({ dataCatalog, terms: [{ id: '2026-3', year: 2026, term: '3' }] }),
    onSchoolSchedule: async (result) => { dataCatalog = cacheSchoolScheduleResult(dataCatalog, result) },
  })

  const result = await service.schoolSchedule({ termId: '2026-3', keyword: 'Advanced', page: 1, pageSize: 24 })
  assert.equal(forms, 3)
  assert.equal(result.total, 1)
  assert.equal(result.items[0].courseCode, 'C1001')

  const secondResult = await service.schoolSchedule({ termId: '2026-3', teacher: 'Teacher Li', page: 2, pageSize: 96 })
  assert.equal(forms, 3)
  assert.equal(secondResult.total, 1000)
  assert.equal(secondResult.items.length, 1000)
  assert.equal(secondResult.items[0].courseCode, 'C0001')
})

test('school-wide schedule applies course affiliation after a fresh read and from the complete cache', async () => {
  let forms = 0
  let dataCatalog = emptyDataCatalog()
  const service = new CourseSelectionService({
    client: {
      async page(url) { return { url, text: '<input id="xh" value="2024TEST01">' } },
      async form() {
        forms += 1
        return JSON.stringify({
          totalCount: 2,
          items: [
            { kcmc: 'Core course', kch: 'CORE-1', kcgs: 'Core' },
            { kcmc: 'Elective course', kch: 'ELEC-1', kcgs: 'Elective' },
          ],
        })
      },
    },
    getState: () => ({ dataCatalog, terms: [{ id: '2026-3', year: 2026, term: '3' }] }),
    onSchoolSchedule: async (result) => { dataCatalog = cacheSchoolScheduleResult(dataCatalog, result) },
  })

  const fresh = await service.schoolSchedule({ termId: '2026-3', affiliation: 'Core' })
  assert.equal(forms, 1)
  assert.equal(fresh.fromCache, false)
  assert.deepEqual(fresh.items.map((item) => item.courseCode), ['CORE-1'])

  const cached = await service.schoolSchedule({ termId: '2026-3', affiliation: 'Elective' })
  assert.equal(forms, 1)
  assert.equal(cached.fromCache, true)
  assert.deepEqual(cached.items.map((item) => item.courseCode), ['ELEC-1'])
})

test('school-wide schedule force refresh bypasses a complete cache and returns fresh metadata', async () => {
  let forms = 0
  let dataCatalog = cacheSchoolScheduleResult(emptyDataCatalog(), {
    scope: { termId: '2026-3' },
    total: 1,
    complete: true,
    items: [{ title: 'Old catalog', courseCode: 'OLD-1' }],
  }, '2026-01-01T00:00:00.000Z')
  const service = new CourseSelectionService({
    client: {
      async page(url) { return { url, text: '<input id="xh" value="2024TEST01">' } },
      async form() {
        forms += 1
        return JSON.stringify({ totalCount: 1, items: [{ kcmc: 'Fresh catalog', kch: 'NEW-1' }] })
      },
    },
    getState: () => ({ dataCatalog, terms: [{ id: '2026-3', year: 2026, term: '3' }] }),
    onSchoolSchedule: async (result) => { dataCatalog = cacheSchoolScheduleResult(dataCatalog, result) },
  })

  const result = await service.schoolSchedule({ termId: '2026-3', forceRefresh: true })
  assert.equal(forms, 1)
  assert.equal(result.items[0].courseCode, 'NEW-1')
  assert.equal(result.complete, true)
  assert.equal(result.fromCache, false)
  assert.notEqual(result.capturedAt, '2026-01-01T00:00:00.000Z')
})

test('school-wide schedule force refresh throws and leaves the previous cache intact on failure', async () => {
  const dataCatalog = cacheSchoolScheduleResult(emptyDataCatalog(), {
    scope: { termId: '2026-3' },
    total: 1,
    complete: true,
    items: [{ title: 'Retained catalog', courseCode: 'KEEP-1' }],
  }, '2026-01-01T00:00:00.000Z')
  let pageCalls = 0
  const service = new CourseSelectionService({
    client: {
      async page() {
        pageCalls += 1
        throw new Error('refresh failed')
      },
    },
    getState: () => ({ dataCatalog, terms: [{ id: '2026-3', year: 2026, term: '3' }] }),
  })

  await assert.rejects(service.schoolSchedule({ termId: '2026-3', forceRefresh: true }), /refresh failed/)
  const retained = cachedSchoolScheduleResult(dataCatalog, { termId: '2026-3' })
  assert.equal(pageCalls, 1)
  assert.equal(retained.items[0].courseCode, 'KEEP-1')
  assert.equal(retained.capturedAt, '2026-01-01T00:00:00.000Z')
  assert.equal(retained.fromCache, true)
})

test('school-wide schedule keeps classes whose only visible difference is their combined-class information', async () => {
  const service = new CourseSelectionService({
    client: {
      async page(url) { return { url, text: '<input id="xh" value="2024TEST01">' } },
      async form() {
        return JSON.stringify({
          totalCount: 2,
          items: [
            { kcmc: 'Polymer physics', kch: 'MAT20001T', jxb_id: 'SHARED-ID', jxbmc: 'Teaching class 01', hbxx: 'Class 2401', rkjs: 'Teacher Li', sksj: 'Mon 1-2' },
            { kcmc: 'Polymer physics', kch: 'MAT20001T', jxb_id: 'SHARED-ID', jxbmc: 'Teaching class 01', hbxx: 'Class 2402', rkjs: 'Teacher Li', sksj: 'Mon 1-2' },
          ],
        })
      },
    },
    getState: () => ({ terms: [{ id: '2026-3', year: 2026, term: '3' }] }),
  })

  const result = await service.schoolSchedule({ termId: '2026-3' })
  assert.equal(result.total, 2)
  assert.deepEqual(result.items.map((item) => item.combinedClassInfo), ['Class 2401', 'Class 2402'])
  assert.equal(new Set(result.items.map((item) => item.id)).size, 2)
})

test('school-wide schedule reads Zhengfang jxbzc as combined-class information', async () => {
  const service = new CourseSelectionService({
    client: {
      async page(url) { return { url, text: '<input id="xh" value="2024TEST01">' } },
      async form() { return JSON.stringify({ totalCount: 1, items: [{ kcmc: 'Physics', kch: 'PHY-1', jxbzc: '材料A2413;材料A2414' }] }) },
    },
    getState: () => ({ terms: [{ id: '2026-3', year: 2026, term: '3' }] }),
  })

  const result = await service.schoolSchedule({ termId: '2026-3' })
  assert.equal(result.items[0].combinedClassInfo, '材料A2413;材料A2414')
})

test('school-wide schedule preserves numeric Zhengfang teaching-class compositions', async () => {
  const service = new CourseSelectionService({
    client: {
      async page(url) { return { url, text: '<input id="xh" value="2024TEST01">' } },
      async form() { return JSON.stringify({ totalCount: 1, items: [{ kcmc: 'Physics', kch: 'PHY-1', jxbzc: '2401;2402' }] }) },
    },
    getState: () => ({ terms: [{ id: '2026-3', year: 2026, term: '3' }] }),
  })

  const result = await service.schoolSchedule({ termId: '2026-3' })
  assert.equal(result.items[0].combinedClassInfo, '2401;2402')
})

test('school-wide schedule falls back from blank hbxx to jxbzc composition', async () => {
  const service = new CourseSelectionService({
    client: {
      async page(url) { return { url, text: '<input id="xh" value="2024TEST01">' } },
      async form() { return JSON.stringify({ totalCount: 1, items: [{ kcmc: 'Physics', kch: 'PHY-1', HBXX: '   ', jxbzc: '材料A2413;材料A2414' }] }) },
    },
    getState: () => ({ terms: [{ id: '2026-3', year: 2026, term: '3' }] }),
  })

  const result = await service.schoolSchedule({ termId: '2026-3' })
  assert.equal(result.items[0].combinedClassInfo, '材料A2413;材料A2414')
})

test('school-wide schedule rejects a short response without a trustworthy total', async () => {
  let cached = 0
  const service = new CourseSelectionService({
    client: {
      async page(url) { return { url, text: '<input id="xh" value="2024TEST01">' } },
      async form() { return JSON.stringify({ items: [{ kcmc: 'Only a page', kch: 'ONLY-1' }] }) },
    },
    getState: () => ({ terms: [{ id: '2026-3', year: 2026, term: '3' }] }),
    onSchoolSchedule: async () => { cached += 1 },
  })

  await assert.rejects(
    service.schoolSchedule({ termId: '2026-3' }),
    /SCHOOL_SCHEDULE_INCOMPLETE read=1 normalized=1 reported=unknown/,
  )
  assert.equal(cached, 0)
})

test('school-wide schedule reports a contradictory server total without exposing row contents', async () => {
  const service = new CourseSelectionService({
    client: {
      async page(url) { return { url, text: '<input id="xh" value="2024TEST01">' } },
      async form() {
        return JSON.stringify({
          totalCount: 1,
          items: [{ kcmc: 'First private title' }, { kcmc: 'Second private title' }],
        })
      },
    },
    getState: () => ({ terms: [{ id: '2026-3', year: 2026, term: '3' }] }),
  })

  await assert.rejects(
    service.schoolSchedule({ termId: '2026-3' }),
    (error) => {
      assert.equal(error.code, 'SCHOOL_SCHEDULE_INCOMPLETE')
      assert.equal(error.message, 'SCHOOL_SCHEDULE_INCOMPLETE read=2 normalized=2 reported=1')
      assert.doesNotMatch(error.message, /private title/)
      return true
    },
  )
})

test('school-wide schedule force refresh rejects a partial read and preserves a complete cache', async () => {
  let dataCatalog = cacheSchoolScheduleResult(emptyDataCatalog(), {
    scope: { termId: '2026-3' },
    total: 1,
    complete: true,
    items: [{ title: 'Retained catalog', courseCode: 'KEEP-1' }],
  }, '2026-01-01T00:00:00.000Z')
  let cacheWrites = 0
  const service = new CourseSelectionService({
    client: {
      async page(url) { return { url, text: '<input id="xh" value="2024TEST01">' } },
      async form() {
        return JSON.stringify({
          totalCount: 2,
          items: [{ kcmc: 'Only normalized row', kch: 'PARTIAL-1' }, { kch: 'MISSING-TITLE' }],
        })
      },
    },
    getState: () => ({ dataCatalog, terms: [{ id: '2026-3', year: 2026, term: '3' }] }),
    onSchoolSchedule: async (result) => {
      cacheWrites += 1
      dataCatalog = cacheSchoolScheduleResult(dataCatalog, result)
    },
  })

  await assert.rejects(
    service.schoolSchedule({ termId: '2026-3', forceRefresh: true }),
    /SCHOOL_SCHEDULE_INCOMPLETE read=2 normalized=1 reported=2/,
  )
  const retained = cachedSchoolScheduleResult(dataCatalog, { termId: '2026-3' })
  assert.equal(cacheWrites, 0)
  assert.equal(retained.items[0].courseCode, 'KEEP-1')
  assert.equal(retained.capturedAt, '2026-01-01T00:00:00.000Z')
})
