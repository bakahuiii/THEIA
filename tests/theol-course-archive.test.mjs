import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'
import { TheolAdapter } from '../core/adapters/theol.mjs'
import { TheolCourseArchiveStore } from '../core/theol-course-archive-store.mjs'
import { parseTheolAssignments, parseTheolCourse } from '../core/parsers/theol.mjs'
import { parseTheolAttachmentLinks } from '../core/parsers/theol-archive.mjs'
import { mergeSingleSourceCollection } from '../core/sync-merge.mjs'

const courseUrl = 'https://course.buct.edu.cn/meol/homepage/course/course_index.jsp?courseId=101'
const introUrl = 'https://course.buct.edu.cn/meol/intro.jsp?lid=101'
const syllabusUrl = 'https://course.buct.edu.cn/meol/syllabus.jsp?lid=101'
const calendarUrl = 'https://course.buct.edu.cn/meol/calendar.jsp?lid=101'
const homeworkUrl = 'https://course.buct.edu.cn/meol/common/hw/student/hwtask.view.jsp?hwtid=9001'
const testUrl = 'https://course.buct.edu.cn/meol/common/question/test/student/stu_qtest_navigate.jsp?testId=9002'

test('THEOL course parser keeps only introduction, syllabus, and calendar', () => {
  const parsed = parseTheolCourse(`
    <input name="lid" value="101">
    <a href="${introUrl}">课程简介</a>
    <a href="${syllabusUrl}">教学大纲</a>
    <a href="${calendarUrl}">教学日历</a>
    <a href="/meol/video.jsp?lid=101">课程视频</a>
    <a href="/meol/common/script/courseResource.jsp?lid=101">课程资源</a>
  `, { course: { id: '101', title: '归档测试', source: 'theol' }, sourceUrl: courseUrl })

  assert.deepEqual(parsed.teachingMaterials.map((item) => item.materialType), ['introduction', 'syllabus', 'calendar'])
  assert.deepEqual(parsed.resourceLinks.map((item) => item.title), ['课程简介', '教学大纲', '教学日历'])
  assert.equal(parsed.resourceLinks.some((item) => /视频|资源/.test(item.title)), false)
})

test('THEOL archive saves course materials and current task details locally', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-theol-archive-'))
  try {
    const archiveStore = new TheolCourseArchiveStore(root)
    const pages = new Map([
      [courseUrl, `<input name="lid" value="101"><a href="${introUrl}">课程简介</a><a href="${syllabusUrl}">教学大纲</a><a href="${calendarUrl}">教学日历</a><a href="/meol/common/hw/student/hwtask.jsp?lid=101">课程作业</a><a href="/meol/common/question/test/student/list.jsp?cateId=101">在线测试</a>`],
      [introUrl, `<input name="lid" value="101"><h1>课程简介</h1><a href="/meol/download/intro.pdf">课程介绍文档</a><iframe src="/meol/common/ueditor/content.html?name=741"></iframe>`],
      ['https://course.buct.edu.cn/meol/common/ueditor/content.html?name=741', '<html><head><meta charset="gbk"></head><body><p>课程介绍正文</p></body></html>'],
      [syllabusUrl, `<input name="lid" value="101"><h1>教学大纲</h1>`],
      [calendarUrl, `<input name="lid" value="101"><h1>教学日历</h1>`],
      ['https://course.buct.edu.cn/meol/common/hw/student/hwtask.jsp?lid=101', `<input name="lid" value="101"><table><tr><td><a href="${homeworkUrl}">第一次作业</a></td><td>2099-12-31 23:59</td><td>未提交</td></tr></table>`],
      ['https://course.buct.edu.cn/meol/common/question/test/student/list.jsp?cateId=101', `<input name="cateId" value="101"><table><tr><td>第一次测试</td><td>发布</td><td>2099-12-31 23:59</td><td><a href="${testUrl}">进入测试</a></td></tr></table>`],
      [homeworkUrl, `<input name="lid" value="101"><h1>第一次作业</h1><p>请提交报告。</p><a href="/meol/download/report.docx">作业文档</a><a href="/meol/media/demo.mp4">视频说明</a>`],
      [testUrl, `<input name="lid" value="101"><h1>第一次测试</h1><div class="question"><p>1. 选择 A</p><label><input type="radio" name="q1" value="A">A</label></div><a href="/meol/download/test.pdf">测试文档</a><a href="/meol/media/diagram.png">图片说明</a>`],
    ])
    const binaries = new Map([
      ['https://course.buct.edu.cn/meol/download/intro.pdf', Buffer.from('%PDF intro')],
      ['https://course.buct.edu.cn/meol/download/report.docx', Buffer.from('DOCX report')],
      ['https://course.buct.edu.cn/meol/download/test.pdf', Buffer.from('%PDF test')],
    ])
    const adapter = new TheolAdapter({
      async page(url) {
        if (!pages.has(url)) throw new Error(`missing fixture ${url}`)
        return { url, text: pages.get(url) }
      },
      async binary(url) {
        const buffer = binaries.get(url)
        if (!buffer) throw new Error(`unexpected binary ${url}`)
        return { url, buffer, headers: { get: () => '' } }
      },
    }, { archiveStore })
    const course = { id: '101', title: '归档测试', source: 'theol', sourceUrl: courseUrl }

    const details = await adapter.syncCourseDetails([course])
    assert.equal(details.errors.length, 0)
    assert.equal(details.courses[0].teachingMaterials.length, 3)
    assert.ok(details.courses[0].teachingMaterials.every((item) => item.localPath && item.localStatus === 'saved'))
    const introHtml = await readFile(details.courses[0].teachingMaterials[0].localPath, 'utf8')
    assert.match(introHtml, /\.pdf/)
    assert.doesNotMatch(introHtml, /\/meol\/download\/intro\.pdf/)
    assert.doesNotMatch(introHtml, /common\/ueditor\/content\.html/)
    const introFrame = details.courses[0].teachingMaterials[0].localFrames?.[0]
    assert.ok(introFrame?.localPath)
    assert.match(await readFile(introFrame.localPath, 'utf8'), /课程介绍正文/u)

    const tasks = await adapter.syncAssignments([course])
    assert.equal(tasks.errors.length, 0)
    assert.deepEqual(tasks.assignments.map((item) => item.kind), ['assignment', 'online-test'])
    assert.ok(tasks.assignments.every((item) => item.localPath && item.localStatus === 'saved'))
    assert.deepEqual(tasks.assignments.map((item) => item.localAttachments.length), [1, 1])
    assert.ok(tasks.assignments.every((item) => item.localAttachments[0].localSha256))
    assert.equal(tasks.assignments[0].localAttachments.some((item) => /mp4|png/.test(item.url)), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('THEOL list-only assignment scans do not fetch task details or attachments', async () => {
  const course = { id: '101', title: '列表模式', source: 'theol', sourceUrl: courseUrl }
  const requested = []
  const courseResults = []
  const adapter = new TheolAdapter({
    async page(url) {
      requested.push(url)
      if (url === courseUrl) {
        return { url, text: '<input name="lid" value="101"><a href="/meol/common/hw/student/hwtask.jsp">课程作业</a>' }
      }
      return {
        url: 'https://course.buct.edu.cn/meol/common/hw/student/hwtask.jsp?lid=101',
        text: `<input name="lid" value="101"><table><tr><td><a href="${homeworkUrl}">第一次作业</a></td><td>2099-12-31 23:59</td><td>未提交</td></tr></table>`,
      }
    },
    async binary() { throw new Error('list-only scan must not download attachments') },
  }, { archiveStore: { savePage: async () => { throw new Error('list-only scan must not archive pages') } } })

  const result = await adapter.syncAssignments([course], {
    archive: false,
    onCourseResult: (value) => { courseResults.push(value) },
  })
  assert.deepEqual(requested, [courseUrl, 'https://course.buct.edu.cn/meol/common/hw/student/hwtask.jsp?lid=101'])
  assert.deepEqual(courseResults.map((item) => ({ courseId: item.courseId, complete: item.complete })), [
    { courseId: '101', complete: true },
  ])
  assert.equal(result.source.captureMode, 'list-only')
  assert.equal(result.assignments[0].localPath, undefined)
})

test('THEOL assignment parser accepts blended homework and test result pages', () => {
  const course = { id: '101', title: '归档测试', sourceUrl: courseUrl }
  const parsed = parseTheolAssignments(`
    <table>
      <tr><td>混合式作业</td><td>2099-12-31 23:59</td><td><a href="/meol/jpk/course/hwtask_blended.jsp?hwtid=9003">查看</a></td></tr>
      <tr><td>已完成测试</td><td></td><td><a href="/meol/common/question/test/student/stu_qtest_result.jsp?testId=9004">查看结果</a></td></tr>
    </table>
  `, { course, sourceUrl: courseUrl })
  assert.deepEqual(parsed.map((item) => [item.kind, item.sourceUrl]), [
    ['assignment', 'https://course.buct.edu.cn/meol/jpk/course/hwtask_blended.jsp?hwtid=9003'],
    ['online-test', 'https://course.buct.edu.cn/meol/common/question/test/student/stu_qtest_result.jsp?testId=9004'],
  ])
})

test('THEOL attachment parser excludes image, video, and audio links', () => {
  const attachments = parseTheolAttachmentLinks(`
    <a href="/a.pdf">PDF</a><a href="/b.docx">文档</a>
    <a href="/c.png">图片</a><a href="/d.mp4">视频</a><a href="/e.mp3">音频</a>
  `, { baseUrl: 'https://course.buct.edu.cn/meol/task.jsp' })
  assert.deepEqual(attachments.map((item) => item.url), [
    'https://course.buct.edu.cn/a.pdf',
    'https://course.buct.edu.cn/b.docx',
  ])
})

test('THEOL attachment parser scans document links inside UEditor content fields', () => {
  const attachments = parseTheolAttachmentLinks(`
    <input name="741_content" value="&lt;p&gt;&lt;a href=&quot;/meol/download/guide.pdf&quot;&gt;课程讲义&lt;/a&gt;&lt;/p&gt;">
    <a href="file:///E:/AppData/Local/youdao/dict/index.html">词典跳转</a>
  `, { baseUrl: 'https://course.buct.edu.cn/meol/intro.jsp?lid=101' })
  assert.deepEqual(attachments, [{
    title: '课程讲义',
    url: 'https://course.buct.edu.cn/meol/download/guide.pdf',
  }])
})

test('THEOL stale local artifact survives a failed refresh with explicit stale status', () => {
  const previous = [{ id: 'material-1', localPath: 'C:\\data\\material.html', localStatus: 'saved', localBytes: 4 }]
  const fresh = [{ id: 'material-1', localStatus: 'failed', localError: '网络失败' }]
  const merged = mergeSingleSourceCollection(previous, fresh, { succeeded: true, completeness: 'partial' })
  assert.equal(merged[0].localPath, previous[0].localPath)
  assert.equal(merged[0].localStatus, 'stale')
  assert.equal(merged[0].localError, '网络失败')
})

test('THEOL archive repair fixes UTF-8 pages with stale GBK declarations', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-theol-archive-repair-'))
  try {
    const archiveStore = new TheolCourseArchiveStore(root)
    const legacyPath = archiveStore.pagePath({
      parentId: '101',
      id: 'intro',
      title: '课程介绍',
    })
    await mkdir(resolve(root, 'theol', 'course-materials', '101'), { recursive: true })
    await writeFile(legacyPath, Buffer.from('<html><head><meta http-equiv="Content-Type" content="text/html; Charset=gbk"></head><body>课程介绍正文</body></html>', 'utf8'))

    const result = await archiveStore.repairLegacyArchives()
    assert.deepEqual(result.errors, [])
    assert.equal(result.scanned, 1)
    assert.equal(result.repaired, 1)
    const repaired = await readFile(legacyPath, 'utf8')
    assert.match(repaired, /charset=utf-8/iu)
    assert.match(repaired, /课程介绍正文/u)

    const secondRun = await archiveStore.repairLegacyArchives()
    assert.equal(secondRun.repaired, 0)
    assert.equal(secondRun.unchanged, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('THEOL assignment scan does not silently cap the course roster at 60', async () => {
  const courses = Array.from({ length: 61 }, (_item, index) => ({
    id: String(10_000 + index),
    title: `课程 ${index + 1}`,
    source: 'theol',
    sourceUrl: `https://course.buct.edu.cn/meol/homepage/course/course_index.jsp?courseId=${10_000 + index}`,
  }))
  const adapter = new TheolAdapter({
    async page(url) {
      const course = courses.find((item) => item.sourceUrl === url)
      if (course) return { url, text: `<input name="lid" value="${course.id}">` }
      return { url, text: '' }
    },
  })
  const result = await adapter.syncAssignments(courses)
  assert.equal(result.successfulCourseIds.length, 61)
  assert.equal(result.failedCourseIds.length, 0)
})
