import test from 'node:test'
import assert from 'node:assert/strict'
import { describeJwSchedulePayload, isStandardCourseCode, parseJwAcademicProgress, parseJwAcademicStatus, parseJwExams, parseJwGrades, parseJwNotices, parseJwQueryForm, parseJwSchedule, parseJwSelectedCourses, parseJwStudentIdentity, parseJwHomepage } from '../core/parsers/jwglxt.mjs'
import { parseTheolAssignments, parseTheolCourse, parseTheolCourseResources, parseTheolHome } from '../core/parsers/theol.mjs'
import { JWGLXT_URLS } from '../core/adapters/jwglxt.mjs'
import { THEOL_URLS } from '../core/adapters/theol.mjs'
import { parseAcademicTerm } from '../core/util.mjs'

const term = { id: '2026-3', year: 2026, term: '3', label: '2026-2027 第一学期' }

test('JWGLXT homepage parses menus and term metadata', () => {
  const html = `<html><body><span id="yhm">张三</span><select id="xnm"><option value="2026" selected>2026-2027</option></select><select id="xqm"><option value="3" selected>第一学期</option></select><a onclick="clickMenu('N2151','/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html','个人课表')">课表</a><div>通知公告</div></body></html>`
  const result = parseJwHomepage(html, 'https://jwglxt.buct.edu.cn/jwglxt/xtgl/index_initMenu.html')
  assert.equal(result.loggedIn, true)
  assert.equal(result.term.id, '2026-3')
  assert.equal(result.menus[0].label, '个人课表')
})

test('JWGLXT uses its registered unified-authentication callback', () => {
  const login = new URL(JWGLXT_URLS.login)
  assert.equal(login.hostname, 'experimental-auth-endpoint.buct.edu.cn')
  assert.equal(login.searchParams.get('service'), 'https://jwglxt.buct.edu.cn/sso/jziotlogin')
  assert.match(login.searchParams.get('timestamp') || '', /^\d+$/)
})

test('THEOL keeps its registered SSO callback entry', () => {
  assert.equal(THEOL_URLS.login, 'https://course.buct.edu.cn/meol/homepage/common/sso_login.jsp')
})

test('JWGLXT central-auth and local login pages are never treated as signed in', () => {
  const central = parseJwHomepage('<iframe src="normal/login-normal.html"></iframe>', 'https://experimental-auth-endpoint.buct.edu.cn/?service=https%3A%2F%2Fjwglxt.buct.edu.cn%2Fsso%2Fjziotlogin')
  const local = parseJwHomepage('<form action="/jwglxt/xtgl/login_slogin.html"><input id="yhm"><input id="mm"><button id="dl">登录</button></form>', 'https://jwglxt.buct.edu.cn/jwglxt/xtgl/login_slogin.html')
  assert.equal(central.loggedIn, false)
  assert.equal(local.loggedIn, false)
})

test('JWGLXT homepage reads the active term from hidden fields', () => {
  const html = '<input type="hidden" id="sessionUserKey" value="2024TEST01"><input type="hidden" id="xnm" name="xnm" value="2025"><input type="hidden" id="xqm" name="xqm" value="16"><a href="/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html">Schedule</a>'
  const result = parseJwHomepage(html, 'https://jwglxt.buct.edu.cn/jwglxt/xtgl/index_initMenu.html')
  assert.equal(result.term.id, '2025-16')
  assert.equal(result.profile.studentId, '2024TEST01')
  assert.equal(result.term.label, '2025-2026 第三学期')
})

test('academic term labels discard the Zhengfang display number before appending the semester name', () => {
  const term = parseAcademicTerm('2026', '3', '2026-2027 1')
  assert.deepEqual(term, { id: '2026-3', year: 2026, term: '3', label: '2026-2027 第一学期' })
})

test('JWGLXT schedule parser accepts BUCT direct API period fields', () => {
  const result = parseJwSchedule(JSON.stringify({
    kbList: [{ kcmc: '材料科学基础', kch_id: 'MAT14000G', xqj: '周三', jc: '0304', zcd: '1-16周' }],
  }), { term, sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/kbcx/xskbcx_cxXsKb.html' })
  assert.equal(result.length, 1)
  assert.equal(result[0].weekday, 3)
  assert.equal(result[0].period, '3-4')
})

test('JWGLXT schedule parser accepts the direct API course envelope', () => {
  const result = parseJwSchedule(JSON.stringify({ code: 1000, data: { courses: [{
    course_id: 'MAT13904T', title: '高等数学A（I）', teacher: '杨卫星', weekday: 1,
    sessions: '4-5节', weeks: '5-18周', place: '一教B阶-301',
  }] } }), { term, sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/kbcx/xskbcx_cxXsKb.html' })
  assert.equal(result.length, 1)
  assert.equal(result[0].weekday, 1)
  assert.equal(result[0].period, '4-5节')
  assert.equal(result[0].room, '一教B阶-301')
  assert.equal(isStandardCourseCode(result[0].courseCode), true)
})

test('JWGLXT schedule payload exposes the authenticated student major identity', () => {
  const result = parseJwStudentIdentity(JSON.stringify({
    xsxx: { ZYH_ID: '0202', ZYMC: '高分子材料与工程', NJDM_ID: '2024', BJMC: '高材2407' },
    kbList: [],
  }))
  assert.deepEqual(result, {
    majorId: '0202',
    majorName: '高分子材料与工程',
    grade: '2024',
    className: '高材2407',
  })
})

test('JWGLXT schedule diagnostics expose shape but no row values', () => {
  const diagnostic = describeJwSchedulePayload(JSON.stringify({ data: { courses: [{
    course_id: 'MAT13904T', title: '高等数学A（I）', weekday: 1, sessions: '4-5节', place: '一教B阶-301',
  }] } }))
  assert.equal(diagnostic.recordCount, 1)
  assert.equal(diagnostic.presence.weekday, true)
  assert.equal(diagnostic.presence.sessions, true)
  assert.equal(diagnostic.presence.place, true)
  assert.deepEqual(Object.keys(diagnostic), ['recordCount', 'fieldNames', 'presence'])
  assert.equal(diagnostic.fieldNames.includes('title'), true)
  assert.equal(JSON.stringify(diagnostic).includes('高等数学'), false)
})

test('JWGLXT query form preserves default hidden fields and selected term', () => {
  const html = '<form id="searchForm" action="/jwglxt/cjcx/cjcx_cxXsgrcj.html"><input type="hidden" name="sxxdm" value="10010"><input type="hidden" name="jsxx" value="xs"><select name="xnm"><option value="2025" selected>2025-2026</option></select><select name="xqm"><option value="16" selected>3</option></select></form>'
  const result = parseJwQueryForm(html, 'https://jwglxt.buct.edu.cn/jwglxt/cjcx/cjcx_cxDgXscj.html', '#searchForm')
  assert.equal(result.action, 'https://jwglxt.buct.edu.cn/jwglxt/cjcx/cjcx_cxXsgrcj.html')
  assert.equal(result.values.sxxdm, '10010')
  assert.equal(result.term.id, '2025-16')
})

test('JWGLXT academic status uses the portal GPA rather than calculated grade rows', () => {
  const html = '<a class="clj" name="showGpa">Average credit grade point</a> (GPA): <font color="red">1.78</font>'
  const result = parseJwAcademicStatus(html, 'https://jwglxt.buct.edu.cn/jwglxt/xsxy/xsxyqk_cxXsxyqkIndex.html')
  assert.equal(result.gpa, 1.78)
})

test('JWGLXT academic progress parses official course counts and credit categories', () => {
  const html = `
    <div id="alertBox">
      <a name="showGpa">\u5e73\u5747\u5b66\u5206\u7ee9\u70b9</a> (GPA): <font>1.78</font>
      \u8ba1\u5212\u603b\u8bfe\u7a0b 160 \u95e8 \u901a\u8fc7 31 \u95e8\uff0c\u672a\u901a\u8fc7 4 \u95e8\uff1b\u672a\u4fee 125 \u95e8\uff0c\u5728\u8bfb 0 \u95e8\uff1b\u8ba1\u5212\u5916\uff1a\u901a\u8fc7 2 \u95e8\uff0c\u672a\u901a\u8fc7 1 \u95e8
    </div>
    <div><p class="title1" id="category-a" yqzdxf="66.5" yxxf="40">\u516c\u5171\u57fa\u7840\u5fc5\u4fee \u8981\u6c42\u5b66\u5206:66.5 \u83b7\u5f97\u5b66\u5206:40</p><i id="xfztcategory-a" title="\u5b66\u5206\u672a\u6ee1"></i></div>
  `
  const result = parseJwAcademicProgress(html, { sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/xsxy' })
  assert.equal(result.gpa, 1.78)
  assert.deepEqual(result.courseCounts, {
    planned: { total: 160, passed: 31, failed: 4, notTaken: 125, studying: 0 },
    outsidePlan: { passed: 2, failed: 1 },
  })
  assert.deepEqual(result.categories[0], {
    id: 'category-a', title: '\u516c\u5171\u57fa\u7840\u5fc5\u4fee', required: 66.5, earned: 40, remaining: 26.5,
    status: '\u5b66\u5206\u672a\u6ee1', sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/xsxy', capturedAt: result.capturedAt,
  })
})

test('JWGLXT academic progress retains the degree-requirement hierarchy and choice branches', () => {
  const html = `
    <ul class="treeview">
      <li xfyqjd_id="programme"><div class="title" xfyqjd_id="programme"><p class="title1">2024 测试材料工程</p></div><ul>
        <li fxfyqjd_id="programme" xfyqzjdgx="1"><div class="title" xfyqjd_id="major"><p class="title1" yqzdxf="8" yxxf="4">专业要求 \" + \" 要求学分:8</p><i id="xfztmajor" title="学分未满"></i></div><ul>
          <li fxfyqjd_id="major" xfyqzjdgx="0" 或者=""><div class="title" xfyqjd_id="engineering"><p class="title1" yqzdxf="4" yxxf="4">工程模块 要求学分:4</p></div></li>
          <li fxfyqjd_id="major" xfyqzjdgx="0" 或者=""><div class="title" xfyqjd_id="innovation"><p class="title1" yqzdxf="4" yxxf="0">创新模块 要求学分:4</p></div></li>
        </ul></li>
      </ul></li>
    </ul>`
  const result = parseJwAcademicProgress(html)
  assert.equal(result.program, '2024 测试材料工程')
  assert.equal(result.roots.length, 1)
  assert.equal(result.roots[0].id, 'major')
  assert.equal(result.roots[0].title, '专业要求')
  assert.equal(result.roots[0].children.length, 2)
  assert.equal(result.roots[0].children[0].parentId, 'major')
  assert.equal(result.roots[0].children[0].relation, 'or')
  assert.equal(result.roots[0].children[1].relation, 'or')
})

test('JWGLXT academic progress exposes course rows under their requirement', () => {
  const html = `<ul class="treeview"><li xfyqjd_id="programme"><div class="title"><p class="title1">培养方案</p></div><ul><li fxfyqjd_id="programme"><div class="title" xfyqjd_id="foundation"><p class="title1" yqzdxf="4" yxxf="4">公共基础 要求学分:4</p></div><div class="more_con"><table><tbody><tr><td><div title="已修"></div></td><td>2024-2025</td><td>1</td><td>MAT13904T</td><td></td><td>高等数学 A</td><td>讲课(5.0)</td><td>必修</td><td>4</td><td>公共基础</td><td>95</td><td>4.33</td><td>95</td><td></td><td></td><td>2024-2025</td><td>1</td><td>1</td></tr></tbody></table></div></li></ul></li></ul>`
  const result = parseJwAcademicProgress(html)
  const course = result.roots[0].courses[0]
  assert.equal(course.studyStatus, '已修')
  assert.equal(course.courseCode, 'MAT13904T')
  assert.equal(course.title, '高等数学 A')
  assert.equal(course.credits, 4)
  assert.equal(course.point, 4.33)
  assert.equal(course.recommendedYear, '2024-2025')
})

test('JWGLXT selected courses and academic notices normalize JSON data grids', () => {
  const selected = parseJwSelectedCourses(JSON.stringify({ items: [{ kch: 'CHM100', jxb_id: 'class-1', kcmc: '\u5316\u5b66\u539f\u7406', jsxm: '\u5f20\u8001\u5e08', xf: '3.5', kclbmc: '\u5fc5\u4fee', jxdd: '\u7b2c\u4e00\u6559\u5b66\u697c 203', sksj: '\u5468\u4e00 1-2', jxbrs: '90', yxzrs: '89' }] }), { term, sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/xsxxxggl' })
  assert.equal(selected.length, 1)
  assert.equal(selected[0].credits, 3.5)
  assert.equal(selected[0].location, '\u7b2c\u4e00\u6559\u5b66\u697c 203')

  const notices = parseJwNotices(JSON.stringify({ items: [{ xxid: 'notice-1', bt: '\u8003\u8bd5\u5b89\u6392', xxnr: '\u8bf7\u53ca\u65f6\u67e5\u770b', cjsj: '2026-08-07 10:00', url: '/jwglxt/xtgl/message.html?id=1' }] }), { sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/xtgl/index_cxDbsy.html' })
  assert.equal(notices[0].title, '\u8003\u8bd5\u5b89\u6392')
  assert.equal(notices[0].sourceUrl, 'https://jwglxt.buct.edu.cn/jwglxt/xtgl/message.html?id=1')
  assert.ok(notices[0].publishedAt)
})

test('JWGLXT JSON responses normalize schedule, grades and exams', () => {
  const schedule = parseJwSchedule(JSON.stringify({ items: [{ kcmc: '高等数学', kch_id: 'M001', xqj: '1', jcs: '1-2', zcd: '1-16周', cdmc: 'A-203', xm: '李老师' }] }), { term, sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/kbcx' })
  assert.equal(schedule.length, 1)
  assert.equal(schedule[0].weekday, 1)
  assert.equal(schedule[0].room, 'A-203')

  const grades = parseJwGrades(JSON.stringify({ items: [{ kcmc: '线性代数', kch_id: 'M002', xf: '3', cj: '92', jd: '4.2', kcxzmc: '必修' }] }), { term, sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/cjcx' })
  assert.equal(grades[0].score, '92')
  assert.equal(grades[0].credits, 3)

  const exams = parseJwExams(JSON.stringify({ items: [{ kcmc: '大学物理', kch_id: 'P001', kssj: '2026-12-20 09:00', cdmc: '主教 105', zwh: '07' }] }), { term, sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/kwgl' })
  assert.equal(exams[0].location, '主教 105')
  assert.equal(exams[0].seat, '07')
})

test('JWGLXT grade parser accepts DataTables and nested Zhengfang envelopes', () => {
  const body = JSON.stringify({ data: { aaData: [{ kcmc: 'Nested grade', kch_id: 'MAT14000G', xf: '4', cj: '91', jd: '4' }] } })
  const grades = parseJwGrades(body, { term, sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/cjcx' })
  assert.equal(grades.length, 1)
  assert.equal(grades[0].courseCode, 'MAT14000G')
  assert.equal(grades[0].score, '91')
})

test('JWGLXT grade parser accepts the direct zfn_api course envelope', () => {
  const body = JSON.stringify({ code: 1000, data: { courses: [{
    course_id: 'ART14000G', title: 'Course from direct API', credit: '2', grade: 'A',
    grade_point: '4', nature: 'Elective', teacher: 'Teacher', grade_nature: 'Normal',
  }] } })
  const grades = parseJwGrades(body, { term, sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/cjcx' })
  assert.equal(grades.length, 1)
  assert.equal(grades[0].courseCode, 'ART14000G')
  assert.equal(grades[0].courseName, 'Course from direct API')
  assert.equal(grades[0].credits, 2)
  assert.equal(grades[0].score, 'A')
  assert.equal(grades[0].point, 4)
})

test('JWGLXT keeps official course codes and hides internal hexadecimal IDs', () => {
  assert.equal(isStandardCourseCode('ART14000G'), true)
  assert.equal(isStandardCourseCode('BFEAF00325ADCB5CE053B39AC3798BC8'), false)

  const grades = parseJwGrades(JSON.stringify({ items: [
    { kcmc: '电影艺术与欣赏', kch: 'ART14000G', kch_id: 'BFEAF00325ADCB5CE053B39AC3798BC8', cj: '90' },
    { kcmc: '内部课程', kch_id: 'BFEAF00325ADCB5CE053B39AC3798BC8', cj: '80' },
  ] }), { term, sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/cjcx' })
  assert.equal(grades[0].courseCode, 'ART14000G')
  assert.equal(grades[1].courseCode, null)
})

test('JWGLXT schedule accepts the portal kbList response shape', () => {
  const schedule = parseJwSchedule(JSON.stringify({ kbList: [{ kcmc: 'Physics', kch: 'P001', xqj: '2', jcs: '3-4', zcd: '1-16', cdmc: 'B-101', xm: 'Teacher' }] }), { term, sourceUrl: 'https://jwglxt.buct.edu.cn/jwglxt/kbcx' })
  assert.equal(schedule.length, 1)
  assert.equal(schedule[0].title, 'Physics')
})

test('THEOL home, course links and assignments normalize', () => {
  const home = parseTheolHome('<body><a href="/meol/homepage/course/course_index.jsp?courseId=123">程序设计基础</a><span>退出</span></body>', 'https://course.buct.edu.cn/meol/index.do')
  assert.equal(home.loggedIn, true)
  assert.equal(home.courses[0].id, '123')
  const course = parseTheolCourse('<div class="course-intro">程序设计课程介绍</div><a href="/meol/common/hw/student/hwtask.jsp">课程作业</a><a href="/meol/res/file.jsp">课程资源</a>', { course: home.courses[0], sourceUrl: 'https://course.buct.edu.cn/meol/jpk/course/layout/newpage/index.jsp?courseId=123' })
  assert.equal(course.resourceLinks.length, 1)
  assert.equal(course.assignmentLinks.length, 1)
  const assignments = parseTheolAssignments('<table><tr><td><a href="/meol/common/hw/student/hwtask.view.jsp?hwtid=9">第三章练习</a></td><td>截止：2026-08-10 23:59</td><td>未提交</td></tr></table>', { course, sourceUrl: 'https://course.buct.edu.cn/meol/common/hw/student/hwtask.jsp' })
  assert.equal(assignments[0].title, '第三章练习')
  assert.equal(assignments[0].status, 'pending')
  assert.ok(assignments[0].dueAt)
  assert.equal(assignments[0].courseSourceUrl, course.sourceUrl)
})

test('THEOL course details and resources normalize teaching materials', () => {
  const course = { id: '123', title: '程序设计基础', source: 'theol' }
  const detail = parseTheolCourse(`
    <div class="course-intro">课程简介</div>
    <div>课程所属院系：信息科学与技术学院</div><div>课程资源数：2</div>
    <a href="/meol/common/script/courseResource.jsp?folderid=0&lid=123">课程资源</a>
    <a href="/meol/jpk/course/course_column_preview_transfer.jsp?columnId=11&courseId=123" title="基本信息">基本信息</a>
    <a href="/meol/jpk/course/course_column_preview_transfer.jsp?columnId=12&courseId=123">教学大纲</a>
    <a href="/meol/jpk/course/course_column_preview_transfer.jsp?columnId=13&courseId=123">教学日历</a>
  `, { course, sourceUrl: 'https://course.buct.edu.cn/meol/homepage/course/course_index.jsp?courseId=123' })
  assert.equal(detail.description, '课程简介')
  assert.equal(detail.courseInfo.department, '信息科学与技术学院')
  assert.equal(detail.courseInfo.resourceCount, 2)
  assert.equal(detail.teachingMaterials.length, 3)
  assert.equal(detail.courseResources, undefined)

  const resources = parseTheolCourseResources(`
    <a href="/meol/common/script/download.jsp?fileId=9">教学大纲.pdf</a>
    <a href="/meol/common/script/courseResource.jsp?folderid=4&lid=123">第一章资料</a>
  `, { courseId: '123', sourceUrl: 'https://course.buct.edu.cn/meol/common/script/courseResource.jsp?folderid=0&lid=123' })
  assert.equal(resources.length, 2)
  assert.equal(resources[0].courseId, '123')
  assert.equal(resources[1].kind, 'folder')
  assert.equal(resources[0].sourceKey, '123:file:fileid=9')
})

test('THEOL resource identity ignores session parameters and title changes', () => {
  const first = parseTheolCourseResources(
    '<a href="/meol/common/script/preview.jsp?fileid=9&lid=123&sid=old">旧标题.pdf</a>',
    { courseId: '123', sourceUrl: 'https://course.buct.edu.cn/meol/listview.jsp?folderid=4&lid=123' },
  )
  const refreshed = parseTheolCourseResources(
    '<a href="/meol/common/script/preview.jsp?lid=123&fileid=9&sid=new">新标题.pdf</a>',
    { courseId: '123', sourceUrl: 'https://course.buct.edu.cn/meol/listview.jsp?folderid=4&lid=123' },
  )
  assert.equal(first[0].sourceKey, refreshed[0].sourceKey)
  assert.equal(first[0].id, refreshed[0].id)
})

test('THEOL resource parser keeps real folders and preview/download files only', () => {
  const resources = parseTheolCourseResources(`
    <table>
      <tr><td><a href="listview.jsp?acttype=enter&folderid=73222&lid=17010">课程大纲</a></td></tr>
      <tr><td><a href="/meol/common/script/preview/download_preview.jsp?fileid=2287712&resid=508135&lid=17010">教学日历</a></td></tr>
      <tr><td><a href="listview.jsp?groupid=4&lid=17010&folderid=0###" title="查看目录属性" onclick="MM_goToURL('self','attribute_folder.jsp?lid=17010&folderid=73222')"></a></td></tr>
    </table>
  `, { courseId: '17010', sourceUrl: 'https://course.buct.edu.cn/meol/common/script/listview.jsp?lid=17010&folderid=0' })
  assert.deepEqual(resources.map((item) => item.kind), ['folder', 'file'])
  assert.equal(resources[1].url.includes('fileid=2287712'), true)
})

test('THEOL buildless resource pages expose iframe preview files with their filename', () => {
  const resources = parseTheolCourseResources(`
    <div id="dowload-preview">
      <div class="h1-title"><h1>1科技论文写作-前言</h1><h2>文件名:1科技论文写作-前言.ppt <span>(1.2M)</span></h2></div>
      <iframe id="ifm" src="/meol/common/script/preview/preview.jsp?fileid=376372"></iframe>
    </div>
  `, {
    courseId: '17010',
    sourceUrl: 'https://course.buct.edu.cn/meol/buildless/resFolderViewList.do?folderid=73259&lid=17010&columnId=153116',
  })
  assert.equal(resources.length, 1)
  assert.equal(resources[0].kind, 'file')
  assert.equal(resources[0].title, '1科技论文写作-前言.ppt')
  assert.equal(resources[0].fileName, '1科技论文写作-前言.ppt')
  assert.match(resources[0].url, /preview\.jsp\?fileid=376372$/)
})

test('THEOL resource parser tolerates malformed percent-encoding in file paths', () => {
  const resources = parseTheolCourseResources(
    '<a href="/meol/common/script/preview.jsp?fileid=44">坏%标题.pdf</a>',
    { courseId: '17010', sourceUrl: 'https://course.buct.edu.cn/meol/listview.jsp?folderid=4&lid=17010' },
  )
  assert.equal(resources.length, 1)
  assert.equal(resources[0].title, '坏%标题.pdf')
})

test('THEOL assignments accept only unique detail endpoints and reject list navigation', () => {
  const course = { id: '34841', title: '社会主义道路探索史', sourceUrl: 'https://course.buct.edu.cn/meol/homepage/course/course_index.jsp?courseId=34841' }
  const homework = parseTheolAssignments(`
    <table>
      <tr><th><a href="?s_order=title&s_sort=0">标题</a></th><th>截止时间</th><th>提交作业</th></tr>
      <tr><td><a href="hwtask.view.jsp?hwtid=73852">期末考核方案</a></td><td>2025年12月19日 23:59:00</td><td>未提交</td></tr>
    </table>
    <a href="hwtask.jsp?s_page=last">尾页</a>
  `, { course, sourceUrl: 'https://course.buct.edu.cn/meol/common/hw/student/hwtask.jsp' })

  assert.equal(homework.length, 1)
  assert.equal(homework[0].kind, 'assignment')
  assert.equal(homework[0].title, '期末考核方案')
  assert.equal(homework[0].sourceUrl, 'https://course.buct.edu.cn/meol/common/hw/student/hwtask.view.jsp?hwtid=73852')
  assert.equal(homework[0].courseSourceUrl, course.sourceUrl)
  assert.ok(homework[0].dueAt)

  const rejected = parseTheolAssignments(`
    <ul>
      <li><a href="detail.jsp?id=9">旧详情形状</a> 作业</li>
      <li><a href="hwtask.stat.jsp?hwtid=9">统计信息</a> 作业</li>
      <li><a href="hwtask.view.jsp?hwtid=not-numeric">无效作业 ID</a></li>
      <li><a href="stu_qtest_pre.jsp?testId=10">开始测试</a></li>
      <li><a href="list.jsp?sortColumn=title&cateId=34841">测试标题</a></li>
    </ul>
  `, { course, sourceUrl: 'https://course.buct.edu.cn/meol/common/hw/student/hwtask.jsp' })
  assert.deepEqual(rejected, [])
})

test('THEOL online tests use the row title and unique test result endpoint', () => {
  const course = { id: '30175', title: '大学英语1', sourceUrl: 'https://course.buct.edu.cn/meol/homepage/course/course_index.jsp?courseId=30175' }
  const assignments = parseTheolAssignments(`
    <table>
      <tr><th><a href="list.jsp?sortColumn=title&cateId=30175">测试标题</a></th><th>开始时间</th><th>截止时间</th><th>查看结果</th></tr>
      <tr><td><img src="test.png" title="试题型">Unit8-test</td><td>2026-08-01 07:34:00</td><td>2026-08-29 23:59:00</td><td><a href="stu_qtest_navigate.jsp?testId=98857726"><img alt="查看结果"></a></td></tr>
    </table>
  `, { course, sourceUrl: 'https://course.buct.edu.cn/meol/common/question/test/student/list.jsp?cateId=30175' })

  assert.equal(assignments.length, 1)
  assert.equal(assignments[0].kind, 'online-test')
  assert.equal(assignments[0].title, 'Unit8-test')
  assert.equal(assignments[0].sourceUrl, 'https://course.buct.edu.cn/meol/common/question/test/student/stu_qtest_navigate.jsp?testId=98857726')
  assert.equal(assignments[0].courseSourceUrl, course.sourceUrl)
  assert.ok(assignments[0].dueAt)
})

test('THEOL error page is not treated as an authenticated session', () => {
  const result = parseTheolHome('<html><head><title>错误！</title></head><body>null！</body></html>', 'https://course.buct.edu.cn/meol/personal.do')
  assert.equal(result.loggedIn, false)
})

test('THEOL public homepage login form is not treated as authenticated', () => {
  const html = '<a href="/meol/homepage/course/course_index.jsp?courseId=public">公开课程</a><form action="/meol/loginCheck.do"><input type="password" name="IPT_LOGINPASSWORD"></form>'
  const result = parseTheolHome(html, 'https://course.buct.edu.cn/meol/index.do')
  assert.equal(result.loggedIn, false)
})

test('THEOL parser ignores malformed course links', () => {
  const html = '<span>退出</span><a href="http://[invalid]/?courseId=broken">异常课程</a><a href="/meol/homepage/course/course_index.jsp?courseId=valid">有效课程</a>'
  const result = parseTheolHome(html, 'https://course.buct.edu.cn/meol/index.do')
  assert.equal(result.loggedIn, true)
  assert.deepEqual(result.courses.map((course) => course.id), ['valid'])
})

test('THEOL authenticated dashboard parses onclick course links', () => {
  const html = `<div>登录时间：2026-08-07 05:18</div><form action="/meol/loginCheck.do"><input type="password"></form><ul><li><p class="title"><a href="###" onclick="window.open('./homepage/course/course_index.jsp?courseId=26234','manage_course')" title="实验室与化工安全">实验室与化工安全</a></p><p class="coursenum" title="MSE47001T">课程编号：MSE47001T</p><p class="realname">主讲教师：<span class="realname">常银成</span></p></li></ul>`
  const result = parseTheolHome(html, 'https://course.buct.edu.cn/meol/personal.do')
  assert.equal(result.loggedIn, true)
  assert.deepEqual(result.courses[0], {
    id: '26234', code: 'MSE47001T', title: '实验室与化工安全', teacher: '常银成', source: 'theol',
    sourceUrl: 'https://course.buct.edu.cn/meol/homepage/course/course_index.jsp?courseId=26234',
  })
})

test('THEOL dedicated course list parses alternate IDs and ignores list controls', () => {
  const html = `<table><tr>
    <td><a href="###" onclick="window.open('../homepage/course/course_index.jsp?courseid=303','manage_course')">课程丙</a></td>
    <td><a href="blen.student.lesson.list.jsp?ACTION=LESSUP&lid=303" title="上移"></a></td>
    <td><a href="blen.student.lesson.list.jsp?ACTION=LESSDOWN&lid=303" title="下移"></a></td>
  </tr><tr><td><a href="../enter_course.jsp?lid=404&t=info">课程丁</a></td></tr></table>`
  const result = parseTheolHome(html, 'https://course.buct.edu.cn/meol/lesson/blen.student.lesson.list.jsp')
  assert.equal(result.loggedIn, true)
  assert.deepEqual(result.courses.map((course) => course.id), ['303', '404'])
  assert.equal(result.courses[0].sourceUrl, 'https://course.buct.edu.cn/meol/homepage/course/course_index.jsp?courseId=303')
})
