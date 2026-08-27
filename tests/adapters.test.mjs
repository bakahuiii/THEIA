import test from 'node:test'
import assert from 'node:assert/strict'
import { JwglxtAdapter } from '../core/adapters/jwglxt.mjs'
import { TheolAdapter, THEOL_URLS } from '../core/adapters/theol.mjs'
import { TyglAdapter, upgradeTyglRedirectUrl } from '../core/adapters/tygl.mjs'
import { isStandardCourseCode } from '../core/parsers/jwglxt.mjs'

test('THEOL probes the authenticated personal homepage instead of the public index', async () => {
  const requested = []
  const adapter = new TheolAdapter({
    async page(url) {
      requested.push(url)
      return {
        url,
        text: '<a href="/meol/homepage/course/course_index.jsp?courseId=101">Course One</a>',
      }
    },
  })

  const status = await adapter.status()
  assert.equal(status.connected, true)
  assert.equal(requested[0], 'https://course.buct.edu.cn/meol/personal.do')
  assert.equal(THEOL_URLS.personal, requested[0])
})

test('THEOL fast sync returns home courses and notices without claiming assignments', async () => {
  const home = '<a href="/meol/homepage/course/course_index.jsp?courseId=101">Course One</a><a href="/meol/notice/view.jsp?id=notice-1">通知</a>'
  const requested = []
  const adapter = new TheolAdapter({
    async page(url) {
      requested.push(url)
      if (url === THEOL_URLS.personal) return { url, text: home }
      return { url, text: '<main>Course details</main>' }
    },
  })

  const result = await adapter.sync()
  assert.deepEqual(result.courses.map((item) => item.id), ['101'])
  assert.equal(result.courses[0].source, 'theol')
  assert.equal(result.notices.length, 1)
  assert.equal(result.notices[0].source, 'theol')
  assert.equal(result.assignments, undefined)
  assert.equal(result.domainOutcomes.assignments.status, 'not-attempted')
  assert.equal(result.domainOutcomes.assignments.attempted, false)
  assert.deepEqual(requested, [THEOL_URLS.personal])
})

test('THEOL course details are opt-in and resource capture is course-scoped', async () => {
  const courseUrl = 'https://course.buct.edu.cn/meol/homepage/course/course_index.jsp?courseId=101'
  const resourceUrl = 'https://course.buct.edu.cn/meol/homepage/course/courseResource_stu.jsp?folderid=0&lid=101'
  const requested = []
  const adapter = new TheolAdapter({
    async page(url) {
      requested.push(url)
      if (url === THEOL_URLS.personal) return { url, text: `<a href="${courseUrl}">Course One</a>` }
      if (url === courseUrl) return { url, text: '<input name="lid" value="101"><div>课程资源数：1</div><a href="/meol/common/script/courseResource.jsp?folderid=0&lid=101">课程资源</a>' }
      return { url: resourceUrl, text: '<a href="/meol/common/script/download.jsp?fileId=9">教学大纲.pdf</a>' }
    },
  })

  const fast = await adapter.sync()
  assert.deepEqual(requested, [THEOL_URLS.personal])
  const detailed = await adapter.sync({ domains: ['course-details'] })
  assert.equal(detailed.courses[0].courseInfo.resourceCount, 1)
  const resources = await adapter.syncCourseResources(detailed.courses[0])
  assert.equal(resources.resources.length, 1)
  assert.equal(resources.resources[0].courseId, '101')
  void fast
})

test('THEOL detail capture rejects pages without course identity evidence', async () => {
  const adapter = new TheolAdapter({
    async page(url) {
      return { url, text: '<main>课程简介</main>' }
    },
  })
  const result = await adapter.syncCourseDetails([
    { id: '101', title: 'Course One', source: 'theol', sourceUrl: 'https://course.buct.edu.cn/meol/course/index.jsp' },
  ])
  assert.deepEqual(result.courses, [])
  assert.equal(result.errors.length, 1)
})

test('THEOL detail failures retain the complete personal roster', async () => {
  const first = 'https://course.buct.edu.cn/meol/homepage/course/course_index.jsp?courseId=101'
  const second = 'https://course.buct.edu.cn/meol/homepage/course/course_index.jsp?courseId=102'
  const adapter = new TheolAdapter({
    async page(url) {
      if (url === THEOL_URLS.personal) return { url, text: `<a href="${first}">Course One</a><a href="${second}">Course Two</a>` }
      if (url === first) return { url, text: '<input name="lid" value="101"><a href="/meol/common/script/courseResource.jsp?folderid=0&lid=101">课程资源</a>' }
      throw new Error('detail unavailable')
    },
  })
  const result = await adapter.sync({ domains: ['courses', 'course-details'] })
  assert.deepEqual(result.courses.map((item) => item.id), ['101', '102'])
  assert.equal(result.domainOutcomes['course-details'].completeness, 'partial')
})

test('THEOL resource sync follows the frameset mainFrame and nested folders', async () => {
  const course = { id: '17010', title: '课程资源测试', source: 'theol', sourceUrl: 'https://course.buct.edu.cn/meol/homepage/course/course_index.jsp?courseId=17010', resourceLinks: [{ title: '课程资源', url: 'https://course.buct.edu.cn/meol/common/script/courseResource.jsp?folderid=0&lid=17010' }] }
  const requested = []
  const adapter = new TheolAdapter({
    async page(url) {
      requested.push(url)
      if (url.includes('courseResource.jsp')) return { url, text: '<frameset><frame name="mainFrame" src="listview.jsp?groupid=4&lid=17010&folderid=0"></frameset>' }
      if (url.includes('folderid=0')) return { url, text: '<a href="listview.jsp?acttype=enter&folderid=73222&lid=17010">教学大纲</a>' }
      return { url, text: '<a href="download_preview.jsp?fileid=9&resid=10&lid=17010">教学大纲.pdf</a>' }
    },
  })
  const result = await adapter.syncCourseResources(course)
  assert.deepEqual(requested, [
    course.resourceLinks[0].url,
    'https://course.buct.edu.cn/meol/common/script/listview.jsp?groupid=4&lid=17010&folderid=0',
    'https://course.buct.edu.cn/meol/common/script/listview.jsp?acttype=enter&folderid=73222&lid=17010',
  ])
  assert.deepEqual(result.resources.map((item) => item.kind), ['folder', 'file'])
  assert.equal(result.errors.length, 0)
})

test('THEOL resource sync follows a buildless course column iframe', async () => {
  const course = {
    id: '17010', title: '栏目资源测试', source: 'theol',
    sourceUrl: 'https://course.buct.edu.cn/meol/homepage/course/course_index.jsp?courseId=17010',
    resourceLinks: [{ title: '课程资源', url: 'https://course.buct.edu.cn/meol/buildless/colUrlStuView.do?columnId=153116' }],
  }
  const requested = []
  const adapter = new TheolAdapter({
    async page(url) {
      requested.push(url)
      if (url.includes('colUrlStuView.do')) {
        return { url, text: '<iframe name="resInfo" src="/meol/buildless/resFolderViewList.do?folderid=73259&lid=17010&columnId=153116"></iframe>' }
      }
      return { url, text: '<h1>1科技论文写作-前言</h1><h2>文件名:1科技论文写作-前言.ppt</h2><iframe src="/meol/common/script/preview/preview.jsp?fileid=376372"></iframe>' }
    },
  })
  const result = await adapter.syncCourseResources(course)
  assert.deepEqual(requested, [
    course.resourceLinks[0].url,
    'https://course.buct.edu.cn/meol/buildless/resFolderViewList.do?folderid=73259&lid=17010&columnId=153116',
  ])
  assert.equal(result.resources.length, 1)
  assert.equal(result.resources[0].title, '1科技论文写作-前言.ppt')
  assert.equal(result.errors.length, 0)
})

test('THEOL assignment sync keeps each course and task list strictly serial', async () => {
  const courses = [
    { id: '101', title: 'Course One', source: 'theol', sourceUrl: 'https://course.buct.edu.cn/meol/course?courseId=101' },
    { id: '202', title: 'Course Two', source: 'theol', sourceUrl: 'https://course.buct.edu.cn/meol/course?courseId=202' },
    { id: 'jw', title: 'Academic course', source: 'jwglxt', sourceUrl: 'https://jwglxt.buct.edu.cn/course' },
  ]
  const requested = []
  let active = 0
  let maxActive = 0
  const adapter = new TheolAdapter({
    async page(url) {
      active += 1
      maxActive = Math.max(maxActive, active)
      requested.push(url)
      await new Promise((resolve) => setTimeout(resolve, 2))
      active -= 1
      if (url.includes('courseId=101')) {
        return { url, text: '<script>const courseId=101</script><a href="/meol/transfer?columnId=1">课程作业</a>' }
      }
      if (url.includes('courseId=202')) {
        return { url, text: '<input name="lid" value="202"><a href="/meol/transfer?columnId=2">在线测试</a>' }
      }
      const firstCourse = url.includes('columnId=1')
      const id = firstCourse ? '101' : '202'
      return {
        url: firstCourse
          ? 'https://course.buct.edu.cn/meol/common/hw/student/hwtask.jsp'
          : 'https://course.buct.edu.cn/meol/common/question/test/student/list.jsp?cateId=202',
        text: firstCourse
          ? `<table><tr><td><a href="hwtask.view.jsp?hwtid=${id}">${id} 作业</a></td><td>2099-08-20 23:59</td><td>未提交</td></tr></table>`
          : `<table><tr><td>${id} 测试</td><td>2099-08-01 08:00</td><td>2099-08-20 23:59</td><td><a href="stu_qtest_navigate.jsp?testId=${id}">查看结果</a></td></tr></table>`,
      }
    },
  })

  const result = await adapter.syncAssignments(courses)
  assert.equal(maxActive, 1)
  assert.deepEqual(requested, [
    courses[0].sourceUrl,
    'https://course.buct.edu.cn/meol/transfer?columnId=1',
    courses[1].sourceUrl,
    'https://course.buct.edu.cn/meol/transfer?columnId=2',
  ])
  assert.equal(result.assignments.length, 2)
  assert.deepEqual(result.assignments.map((item) => item.courseSourceUrl), courses.slice(0, 2).map((course) => course.sourceUrl))
  assert.deepEqual(result.assignments.map((item) => item.kind), ['assignment', 'online-test'])
  assert.deepEqual(result.successfulCourseIds, ['101', '202'])
  assert.deepEqual(result.failedCourseIds, [])
  assert.equal(result.domainOutcomes.assignments.completeness, 'complete')
})

test('THEOL assignment sync removes tasks whose real due time has passed', async () => {
  const course = {
    id: '101', title: 'Course One', source: 'theol',
    sourceUrl: 'https://course.buct.edu.cn/meol/homepage/course/course_index.jsp?courseId=101',
  }
  const adapter = new TheolAdapter({
    async page(url) {
      if (url === course.sourceUrl) {
        return {
          url,
          text: '<input name="lid" value="101"><a href="/meol/common/hw/student/hwtask.jsp">课程作业</a>',
        }
      }
      return {
        url: 'https://course.buct.edu.cn/meol/common/hw/student/hwtask.jsp?cateId=101',
        text: '<table><tr><td><a href="hwtask.view.jsp?hwtid=9000">Historical task</a></td><td>2021-07-16 23:59</td><td>未提交</td></tr></table>',
      }
    },
  })

  const result = await adapter.syncAssignments([course])
  assert.deepEqual(result.assignments, [])
  assert.equal(result.domainOutcomes.assignments.emptyConfirmed, true)
  assert.equal(result.domainOutcomes.assignments.completeness, 'complete')
})

test('THEOL falls back to the mobile pending-task feed after a course-page failure', async () => {
  const course = {
    id: '101', title: 'Course One', source: 'theol',
    sourceUrl: 'https://course.buct.edu.cn/meol/homepage/course/course_index.jsp?courseId=101',
  }
  const requested = []
  const adapter = new TheolAdapter({
    async page() { throw new Error('course page layout changed') },
    async json(url) {
      requested.push(url)
      return {
        status: 1,
        // The API also returns a sessionid. Do not include it in the fixture:
        // the parser must not expose or persist it.
        datas: [{
          courseId: 101,
          courseName: 'Course One',
          reminderListHomework: [{
            id: 9001, title: 'Future homework', publishStatus: true,
            deadline: '2099-08-20 23:59:00',
          }],
          reminderListTest: [{
            id: 9002, title: 'Future test', publishStatus: true,
            expiredTime: '2099-08-21 23:59:00', examType: 1,
          }],
          reminderListExpired: [{
            id: 9003, title: 'Expired homework', publishStatus: true,
            deadline: '2021-07-16 23:59:00',
          }],
        }],
      }
    },
  })

  const result = await adapter.syncAssignments([course])
  assert.deepEqual(requested, [THEOL_URLS.mobileUndoneTasks])
  assert.deepEqual(result.assignments.map((item) => [item.kind, item.title]), [
    ['assignment', 'Future homework'],
    ['online-test', 'Future test'],
  ])
  assert.ok(result.assignments.every((item) => item.courseSourceUrl === course.sourceUrl))
  assert.ok(result.assignments.every((item) => item.sourceUrl.startsWith('https://course.buct.edu.cn/meol/')))
  assert.deepEqual(result.successfulCourseIds, ['101'])
  assert.deepEqual(result.failedCourseIds, [])
  assert.equal(result.source.mobileFallback.status, 'used')
  assert.equal(result.source.mobileFallback.added, 2)
  assert.equal(result.domainOutcomes.assignments.completeness, 'complete')
})

test('THEOL assignment sync rejects a course page whose identity does not match the requested course', async () => {
  const course = {
    id: '101', title: 'Course One', source: 'theol',
    sourceUrl: 'https://course.buct.edu.cn/meol/homepage/course/course_index.jsp?courseId=101',
  }
  const adapter = new TheolAdapter({
    async page(url) {
      return {
        url,
        text: '<input name="lid" value="202"><a href="/meol/common/hw/student/hwtask.jsp">课程作业</a>',
      }
    },
  })

  const result = await adapter.syncAssignments([course])
  assert.deepEqual(result.assignments, [])
  assert.deepEqual(result.successfulCourseIds, [])
  assert.deepEqual(result.failedCourseIds, ['101'])
  assert.equal(result.domainOutcomes.assignments.completeness, 'partial')
  assert.equal(result.domainOutcomes.assignments.emptyConfirmed, false)
  assert.match(result.errors[0], /different course context/)
})

test('THEOL assignment sync rejects mismatched task-list URL or DOM identity without merging that course', async (t) => {
  const course = {
    id: '101', title: 'Course One', source: 'theol',
    sourceUrl: 'https://course.buct.edu.cn/meol/homepage/course/course_index.jsp?courseId=101',
  }
  const scenarios = [
    {
      name: 'final URL',
      result: {
        url: 'https://course.buct.edu.cn/meol/common/hw/student/hwtask.jsp?cateId=202',
        text: '<table><tr><td><a href="hwtask.view.jsp?hwtid=9002">Wrong course task</a></td><td>2099-08-20 23:59</td><td>未提交</td></tr></table>',
      },
    },
    {
      name: 'DOM identity',
      result: {
        url: 'https://course.buct.edu.cn/meol/common/hw/student/hwtask.jsp',
        text: '<input name="lid" value="202"><table><tr><td><a href="hwtask.view.jsp?hwtid=9002">Wrong course task</a></td><td>2099-08-20 23:59</td><td>未提交</td></tr></table>',
      },
    },
  ]

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const adapter = new TheolAdapter({
        async page(url) {
          if (url === course.sourceUrl) {
            return {
              url,
              text: '<script>const courseId=101</script><a href="/meol/common/hw/student/hwtask.jsp?list=first">课程作业</a><a href="/meol/common/hw/student/hwtask.jsp?list=second">补充作业</a>',
            }
          }
          if (url.includes('list=first')) {
            return {
              url: 'https://course.buct.edu.cn/meol/common/hw/student/hwtask.jsp',
              text: '<table><tr><td><a href="hwtask.view.jsp?hwtid=9001">Valid historical task</a></td><td>2099-08-19 23:59</td><td>未提交</td></tr></table>',
            }
          }
          return scenario.result
        },
      })

      const result = await adapter.syncAssignments([course])
      assert.deepEqual(result.assignments, [])
      assert.equal(result.domainOutcomes.assignments.completeness, 'partial')
      assert.equal(result.domainOutcomes.assignments.emptyConfirmed, false)
      assert.equal(result.errors.length, 1)
      assert.match(result.errors[0], /different course task context/)
    })
  }
})

test('health cloud parses the paired metric and result table', async () => {
  const page = `
    <table><tr><td>性别</td><td>男</td><td>年级</td><td>大二</td><td>身高</td><td>1.75米</td><td>体重</td><td>66.7千克</td></tr></table>
    <table><tr><td>测试年度</td><td>2025</td></tr></table>
    <table>
      <tr><td>项目</td><td>成绩</td><td>得分</td><td>等级</td><td>项目</td><td>成绩</td><td>得分</td><td>等级</td></tr>
      <tr><td>身体机能(肺活量)</td><td>4100</td><td>80</td><td>良好</td><td>引体向上</td><td>12</td><td>75</td><td>及格</td></tr>
      <tr><td>50米跑</td><td>7.4</td><td>90</td><td>优秀</td><td>1000米跑</td><td>4.30分</td><td>80</td><td>良好</td></tr>
      <tr><td>坐立体前屈</td><td>16</td><td>85</td><td>良好</td><td>立定跳远</td><td>230</td><td>80</td><td>良好</td></tr>
    </table>`
  const adapter = new TyglAdapter({
    async page(url) { return { url, text: '<main>健康云</main>'.padEnd(300, ' ') } },
  }, {
    fitnessPageLoader: async () => ({ url: 'https://tygl.buct.edu.cn/main.php?module=stu&title=stu_ht_score&year=2025-2026_1', text: page }),
  })

  const score = await adapter.fetchScore()
  assert.deepEqual(score, {
    vitality: 4100,
    run50: 7.4,
    flex: 16,
    jump: 230,
    strength: 12,
    endureSecs: 270,
    gender: 'male',
    year: '2025',
    academicGrade: '大二',
    gradeGroup: '12',
    heightCm: 175,
    weightKg: 66.7,
    yearKey: null,
    availableYears: [],
  })
})

test('health cloud upgrades only its own insecure authentication callback', () => {
  assert.equal(
    upgradeTyglRedirectUrl('http://tygl.buct.edu.cn/?ticket=opaque#result'),
    'https://tygl.buct.edu.cn/?ticket=opaque#result',
  )
  for (const url of [
    'https://tygl.buct.edu.cn/',
    'http://course.buct.edu.cn/',
    'http://tygl.buct.edu.cn:8080/',
    'http://user@tygl.buct.edu.cn/',
    'not a URL',
  ]) assert.equal(upgradeTyglRedirectUrl(url), null, url)
})

test('health cloud returns a readable year without measurements as an empty result', async () => {
  const availableYears = [
    { yearKey: '2026-2027_1', label: '2026年(1)' },
    { yearKey: '2025-2026_1', label: '2025年(1)' },
  ]
  const adapter = new TyglAdapter({
    async page(url) { return { url, text: '<main>健康云</main>'.padEnd(300, ' ') } },
  }, {
    fitnessPageLoader: async () => ({
      url: 'https://tygl.buct.edu.cn/main.php?module=stu&title=stu_ht_score&year=2026-2027_1',
      text: '<main><h1>2026年体测成绩</h1><p>暂无数据</p></main>',
      yearKey: '2026-2027_1',
      availableYears,
    }),
  })

  const score = await adapter.fetchScore({ year: '2026-2027_1' })
  assert.equal(score.yearKey, '2026-2027_1')
  assert.deepEqual(score.availableYears, availableYears)
  for (const field of ['vitality', 'run50', 'flex', 'jump', 'strength', 'endureSecs']) {
    assert.equal(score[field], null, field)
  }
})

test('JWGLXT queries current-term schedule, grades and exams through their student endpoints', async () => {
  const forms = []
  const requestPhases = []
  const primaryStarted = new Set()
  const secondaryStarted = new Set()
  const home = '<input id="xh" name="xh" value="2024TEST01"><input id="xnm" name="xnm" value="2025"><input id="xqm" name="xqm" value="16"><a href="/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html">Schedule</a>'
  const academicProgress = '<div id="alertBox"><a name="showGpa">GPA</a> 1.78</div><p class="title1" id="progress" yqzdxf="10" yxxf="4">Foundation \u8981\u6c42\u5b66\u5206:10</p>'
  const schedule = '<form id="ajaxForm"><select name="xnm"><option value="2026" selected>2026-2027</option></select><select name="xqm"><option value="3" selected>1</option></select></form>'
  const grades = '<form id="searchForm"><input name="sxxdm" value="10010"><select name="xnm"><option value="2025" selected>2025-2026</option></select><select name="xqm"><option value="16" selected>3</option></select><select name="kcbjdm"><option value="" selected>All</option></select></form>'
  const exams = '<form id="searchForm"><select name="cx_xnm"><option value="2025" selected>2025-2026</option></select><select name="cx_xqm"><option value="16" selected>3</option></select></form>'
  const phaseFor = (url) => {
    if (url.includes('/index_cxDbsy')) return 'notices'
    if (url.includes('/kbcx/')) return 'schedule'
    if (url.includes('/kwgl/')) return 'exams'
    if (url.includes('/cjcx/')) return 'grades'
    if (url.includes('/xsxy/')) return 'academic-progress'
    if (url.includes('/xsxxxggl/')) return 'selected-courses'
    if (url.includes('/xtgl/')) return 'home'
    return 'unknown'
  }
  const observeOverlap = async (url) => {
    const phase = phaseFor(url)
    const primaryEntry = url.includes('xskbcx_cxXsgrkb') || ['exams', 'grades', 'academic-progress'].includes(phase)
    const secondaryEntry = ['selected-courses', 'notices'].includes(phase)
    const started = primaryEntry ? primaryStarted : secondaryEntry ? secondaryStarted : null
    if (!started || started.has(phase)) return
    started.add(phase)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(started.size, primaryEntry ? 4 : 2, `${phase} did not overlap its priority batch`)
  }
  const client = {
    async page(url) {
      requestPhases.push(phaseFor(url))
      await observeOverlap(url)
      if (url.includes('/xtgl/')) return { url, text: home }
      if (url.includes('/xsxy/')) return { url, text: academicProgress }
      if (url.includes('/kbcx/')) return { url, text: schedule }
      if (url.includes('/cjcx/')) return { url, text: grades }
      return { url, text: exams }
    },
    async form(url, values) {
      requestPhases.push(phaseFor(url))
      await observeOverlap(url)
      forms.push({ url, values })
      if (url.includes('/kbcx/')) return JSON.stringify({ kbList: [{ kcmc: 'Math', kch: 'MAT14000G', xqj: '1', jcs: '1-2' }] })
      if (url.includes('/cjcx/')) return JSON.stringify({ items: [{ kcmc: 'Chemistry', kch: 'CHM14000G', cj: '90' }] })
      if (url.includes('/xsxxxggl/')) return JSON.stringify({ items: [{ kcmc: 'Selected physics', kch: 'PHY14000G', jxb_id: 'class-1', xf: '2' }] })
      if (url.includes('/index_cxDbsy')) return JSON.stringify({ items: [{ xxid: 'notice-1', bt: 'Academic notice', cjsj: '2026-08-07 10:00' }] })
      return JSON.stringify({ items: [{ kcmc: 'Physics', kch: 'PHY14000G', kssj: '2026-08-08 09:00' }] })
    },
  }

  const result = await new JwglxtAdapter(client).sync()
  // After补全，terms 按 year desc, term desc 排序，最新的在前
  assert.equal(result.terms.length, 9)
  assert.ok(result.terms.find(t => t.id === '2025-16'))
  assert.ok(result.terms.find(t => t.id === '2025-12'))
  assert.ok(result.terms.find(t => t.id === '2024-3'))
  assert.ok(result.terms.find(t => t.id === '2024-12'))
  assert.ok(result.terms.find(t => t.id === '2024-16'))
  // Multi-term sync reads every academic term from the student's admission
  // year through the active year, not only the currently selected term.
  assert.equal(result.schedule.length, 9)
  assert.equal(result.grades.length, 1)
  assert.ok(result.exams.length >= 1)
  assert.ok(result.courses.length >= 1)
  assert.ok(result.courses.every((course) => isStandardCourseCode(course.code)))
  assert.equal(new Set(result.courses.map((course) => course.code)).size, result.courses.length)
  assert.equal(result.profile.gpa, 1.78)
  assert.equal(result.academicProgress.categories.length, 1)
  assert.equal(result.domainOutcomes['academic-progress'].completeness, 'partial')
  assert.equal(result.domainOutcomes['academic-progress'].errorCode, 'requirement_tree_inferred')
  assert.ok(result.selectedCourses.length >= 1)
  assert.equal(result.notices[0].title, 'Academic notice')
  assert.match(forms[0].url, /xskbcx_cxXsgrkb\.html$/)
  assert.ok(['2025','2026'].includes(forms[0].values.xnm))
  assert.match(forms.find(f => f.url.includes('cjcx_cxXsgrcj')).url, /cjcx_cxXsgrcj\.html\?doType=query&gnmkdm=N305005$/)
  assert.ok(forms.some(f => f.url.includes('kscx_cxXsksxxIndex')))
  assert.ok(forms.some(f => f.url.includes('xsxxwh_cxXsxkxx')))
  assert.deepEqual(primaryStarted, new Set(['schedule', 'exams', 'grades', 'academic-progress']))
  assert.deepEqual(secondaryStarted, new Set(['selected-courses', 'notices']))
  const firstSecondary = requestPhases.findIndex((phase) => ['selected-courses', 'notices'].includes(phase))
  assert.ok(firstSecondary > requestPhases.findLastIndex((phase) => ['schedule', 'exams', 'grades', 'academic-progress'].includes(phase)))
})

test('JWGLXT schedule sync prioritizes the selected term and ignores years before admission', async () => {
  const scheduleYears = ['2034', '2033', '2027', '2026', '2025', '2024', '2023', '2022']
    .map((year) => `<option value="${year}"${year === '2026' ? ' selected' : ''}>${year}-${Number(year) + 1}</option>`)
    .join('')
  const scheduleIndex = `<form id="ajaxForm"><select name="xnm">${scheduleYears}</select><select name="xqm"><option value="3" selected>1</option><option value="16">3</option></select></form>`
  const submittedScheduleTerms = []
  const client = {
    async page(url) {
      if (url.includes('/xtgl/')) return { url, text: '<input id="xh" value="2024TEST01"><input id="xnm" value="2025"><input id="xqm" value="16"><a href="/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html">课表</a>' }
      if (url.includes('/kbcx/')) return { url, text: scheduleIndex }
      if (url.includes('/xsxy/')) return { url, text: '<div></div>' }
      return { url, text: '<form id="searchForm"></form>' }
    },
    async form(url, values) {
      if (url.includes('/kbcx/')) {
        submittedScheduleTerms.push(`${values.xnm}-${values.xqm}`)
        return values.xnm === '2026' && values.xqm === '3'
          ? JSON.stringify({ kbList: [{ kcmc: 'Current course', kch: 'CUR001', xqj: '1', jcs: '1-2' }] })
          : JSON.stringify({ kbList: [] })
      }
      return JSON.stringify({ items: [] })
    },
  }

  const result = await new JwglxtAdapter(client).sync()
  assert.equal(submittedScheduleTerms[0], '2026-3')
  assert.ok(!submittedScheduleTerms.some((term) => term.startsWith('2034-')))
  assert.ok(!submittedScheduleTerms.some((term) => term.startsWith('2023-') || term.startsWith('2022-')))
  assert.equal(result.schedule.length, 1)
  assert.equal(result.source.diagnostics.scheduleFetch[0].termId, '2026-3')
  assert.equal(result.errors.length, 0)
})

test('JWGLXT retries an unpositioned schedule payload through the configured API endpoint', async () => {
  const calls = []
  const client = {
    async page(url) {
      if (url.includes('/xtgl/')) return { url, text: '<input id="xh" value="2024TEST01"><input id="xnm" value="2026"><input id="xqm" value="3">' }
      return { url, text: '<form id="ajaxForm"><select name="xnm"><option value="2026" selected>2026-2027</option></select><select name="xqm"><option value="3" selected>1</option></select></form>' }
    },
    async form(url) {
      calls.push(url)
      if (url.includes('xskbcx_cxXsKb.html')) return JSON.stringify({ kbList: [{ kcmc: 'API schedule', kch_id: 'MAT14000G', xqj: '2', jc: '0304' }] })
      return JSON.stringify({ kbList: [{ kcmc: 'Unpositioned list', kch: 'MAT14000G' }] })
    },
  }

  const result = await new JwglxtAdapter(client, {
    scheduleEndpoints: ['kbcx/xskbcx_cxXsgrkb.html', 'kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151'],
  }).sync({ domains: ['schedule'] })
  assert.ok(result.schedule.length >= 1)
  assert.equal(result.schedule[0].period, '3-4')
  assert.equal(result.domainOutcomes.schedule.completeness, 'complete')
  assert.ok(calls.some((url) => url.includes('xskbcx_cxXsKb.html')))
})

test('JWGLXT never treats a fallback empty schedule as confirmation after an unpositioned response', async () => {
  const client = {
    async page(url) {
      if (url.includes('/xtgl/')) return { url, text: '<input id="xh" value="2026TEST01"><input id="xnm" value="2026"><input id="xqm" value="3">' }
      return { url, text: '<form id="ajaxForm"><select name="xnm"><option value="2026" selected>2026-2027</option></select><select name="xqm"><option value="3" selected>1</option></select></form>' }
    },
    async form(url) {
      return url.includes('xskbcx_cxXsKb.html')
        ? JSON.stringify({ kbList: [] })
        : JSON.stringify({ kbList: [{ kcmc: 'Unpositioned list', kch: 'MAT14000G' }] })
    },
  }

  const result = await new JwglxtAdapter(client, {
    scheduleEndpoints: ['kbcx/xskbcx_cxXsgrkb.html', 'kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151'],
  }).sync({ domains: ['schedule'] })
  assert.equal(result.schedule, undefined)
  assert.equal(result.domainOutcomes.schedule.errorCode, 'schedule_read_failed')
  assert.ok(result.source.diagnostics.scheduleFetch.every((entry) => entry.unpositioned))
})

test('JWGLXT rejects course-list rows that cannot be placed on a timetable', async () => {
  const client = {
    async page(url) {
      if (url.includes('/xtgl/')) {
        return { url, text: '<input id="xh" value="2024TEST01"><input id="xnm" value="2025"><input id="xqm" value="3">' }
      }
      return {
        url,
        text: '<form id="ajaxForm"><select name="xnm"><option value="2025" selected>2025-2026</option></select><select name="xqm"><option value="3" selected>1</option></select></form>',
      }
    },
    async form() {
      return JSON.stringify({ kbList: [{ kcmc: 'Course list item', kch: 'MAT14000G' }] })
    },
  }

  const result = await new JwglxtAdapter(client).sync({ domains: ['schedule'] })
  assert.equal(result.schedule, undefined)
  assert.equal(result.domainOutcomes.schedule.succeeded, false)
  assert.equal(result.domainOutcomes.schedule.errorCode, 'schedule_read_failed')
  assert.deepEqual(result.errors, [])
  assert.equal(result.source.diagnostics.scheduleFetch[0].unpositioned, true)
  assert.equal(result.source.diagnostics.scheduleFetch[0].returnedCount, 1)
})

test('JWGLXT keeps a partial timetable successful when another term returns an unpositioned course list', async () => {
  const client = {
    async page(url) {
      if (url.includes('/xtgl/')) {
        return { url, text: '<input id="xh" value="2024TEST01"><input id="xnm" value="2025"><input id="xqm" value="3">' }
      }
      return {
        url,
        text: '<form id="ajaxForm"><select name="xnm"><option value="2025" selected>2025-2026</option><option value="2024">2024-2025</option></select><select name="xqm"><option value="3" selected>1</option></select></form>',
      }
    },
    async form(_url, values) {
      if (values.xnm === '2024') return JSON.stringify({ kbList: [{ kcmc: 'Course list item', kch: 'MAT14000G' }] })
      return JSON.stringify({ kbList: [{ kcmc: 'Positioned course', kch: 'MAT14000G', xqj: '2', jcs: '3-4' }] })
    },
  }

  const result = await new JwglxtAdapter(client).sync({ domains: ['schedule'] })
  assert.equal(result.schedule.length, 3)
  assert.equal(result.domainOutcomes.schedule.succeeded, true)
  assert.equal(result.domainOutcomes.schedule.completeness, 'partial')
  assert.equal(result.domainOutcomes.schedule.errorCode, 'partial_schedule_read')
  assert.deepEqual(
    [...result.domainOutcomes.schedule.failedTermIds].sort(),
    ['2024-3', '2024-12', '2024-16'].sort(),
  )
  assert.deepEqual(result.errors, [])
})

test('JWGLXT grades retry concrete terms when the all-term endpoint rejects blank selectors', async () => {
  const gradeRequests = []
  const client = {
    async page(url) {
      if (url.includes('/xtgl/')) return { url, text: '<input id="xh" value="2024TEST01"><input id="xnm" value="2025"><input id="xqm" value="16"><a href="/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html">Schedule</a>' }
      if (url.includes('/kbcx/')) return { url, text: '<form id="ajaxForm"><select name="xnm"><option value="2025" selected>2025-2026</option><option value="2024">2024-2025</option></select><select name="xqm"><option value="16" selected>3</option></select></form>' }
      if (url.includes('/cjcx/')) return { url, text: '<form id="searchForm"><input name="sxxdm" value="10010"><input name="kcbjdm" value=""><select name="xnm"><option value="2025" selected>2025-2026</option><option value="2024">2024-2025</option></select><select name="xqm"><option value="16" selected>3</option></select></form>' }
      return { url, text: '<form id="searchForm"></form>' }
    },
    async form(url, values) {
      if (!url.includes('/cjcx/')) return JSON.stringify({ items: [] })
      gradeRequests.push({ url, values })
      if (!values.xnm && !values.xqm) throw new Error('all-term selector is not supported')
      return JSON.stringify({ aaData: [{ kcmc: `Grade ${values.xnm}`, kch_id: 'MAT14000G', xf: '4', cj: '91', jd: '4' }] })
    },
  }

  const result = await new JwglxtAdapter(client).sync({ domains: ['grades'] })
  assert.equal(result.domainOutcomes.grades.succeeded, true)
  assert.equal(result.grades.length, 2)
  assert.ok(gradeRequests.every(({ url }) => [
    'cjcx_cxXsgrcj.html?doType=query&gnmkdm=N305005',
    'cjcx_cxDgXscj.html?doType=query&gnmkdm=N305005',
  ].some((suffix) => url.endsWith(suffix))))
})

test('JWGLXT accepts deeply nested grade payloads and explicit empty responses', async () => {
  const client = {
    async page(url) {
      if (url.includes('/xtgl/')) return { url, text: '<span id="yhm">Student</span><select id="xnm"><option value="2025" selected>2025-2026</option></select><select id="xqm"><option value="16" selected>Third</option></select>' }
      if (url.includes('/cjcx/')) return { url, text: '<form id="searchForm"><input name="sxxdm" value="10010"></form>' }
      return { url, text: '<form></form>' }
    },
    async form(url, values) {
      if (!values.xnm && !values.xqm) return JSON.stringify({ success: true, data: { result: { aaData: [{ kcmc: 'Nested', kch_id: 'MAT14000G', xf: '2', cj: '90', jd: '4' }] } } })
      return JSON.stringify({ success: true, data: { total: 0, rows: [] } })
    },
  }
  const result = await new JwglxtAdapter(client).sync({ domains: ['grades'] })
  assert.equal(result.domainOutcomes.grades.succeeded, true)
  assert.equal(result.grades.length, 1)
})

test('JWGLXT academic-progress retry does not request schedule, exams, grades, or selected courses', async () => {
  const requests = []
  const client = {
    async page(url) {
      requests.push(url)
      if (url.includes('/xtgl/')) {
        return { url, text: '<input id="xh" value="2024TEST01"><input id="xnm" value="2026"><input id="xqm" value="3">' }
      }
      if (url.includes('/xsxy/')) {
        return {
          url,
          text: '<div id="alertBox"><a name="showGpa">GPA</a> 1.78</div><ul class="treeview"><li><div class="title" xfyqjd_id="plan"><p class="title1" yqzdxf="4" yxxf="4">培养方案</p></div><div class="more_con"><table><tbody><tr><td><div title="已修"></div></td><td>2024-2025</td><td>1</td><td>MAT13904T</td><td></td><td>高等数学 A</td><td></td><td>必修</td><td>4</td><td>公共基础</td><td>95</td><td>4.33</td></tr></tbody></table></div></li></ul>',
        }
      }
      throw new Error(`unexpected request ${url}`)
    },
    async form(url) { throw new Error(`unexpected form request ${url}`) },
  }

  const result = await new JwglxtAdapter(client).sync({ domains: ['academic-progress'] })
  assert.equal(result.academicProgress.gpa, 1.78)
  assert.deepEqual(Object.keys(result.domainOutcomes), ['academic-progress'])
  assert.equal(requests.length, 2)
  assert.ok(requests.every((url) => url.includes('/xtgl/') || url.includes('/xsxy/')))
})
