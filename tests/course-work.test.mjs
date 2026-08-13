import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { CourseWorkService } from '../core/course-work.mjs'
import { parseTheolWorkPage } from '../core/parsers/theol-work.mjs'
import { CampusStore } from '../core/store.mjs'

const courseUrl = (courseId) => `https://course.buct.edu.cn/meol/homepage/course/course_index.jsp?courseId=${courseId}`
const homeworkUrl = (taskId) => `https://course.buct.edu.cn/meol/common/hw/student/hwtask.view.jsp?hwtid=${taskId}`
const testUrl = (taskId) => `https://course.buct.edu.cn/meol/common/question/test/student/stu_qtest_navigate.jsp?testId=${taskId}`

test('THEOL work parser extracts downloadable material and test questions', () => {
  const parsed = parseTheolWorkPage(`
    <h1>第一单元测试</h1><p>请完成以下练习。</p>
    <a href="/meol/download/unit-one.pdf">下载题目附件</a>
    <div class="question"><p>1. 水的化学式是？</p><label><input type="radio" name="q1" value="A">A. H2O</label><label><input type="radio" name="q1" value="B">B. CO2</label></div>
    <div class="question"><p>2. 简述理由。</p><textarea name="q2"></textarea></div>
  `, { baseUrl: 'https://course.buct.edu.cn/meol/test/detail.jsp?id=1', kind: 'online-test' })
  assert.equal(parsed.attachments[0].url, 'https://course.buct.edu.cn/meol/download/unit-one.pdf')
  assert.equal(parsed.questions.length, 2)
  assert.equal(parsed.questions[0].choices[0].value, 'A')
  assert.equal(parsed.questions[1].type, 'text')
})

test('course work resolves one legacy THEOL course and enters course context before task details', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-work-entry-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    await store.update((state) => ({
      ...state,
      courses: [{ id: 'legacy-course', title: 'Legacy course', source: 'theol', sourceUrl: courseUrl('legacy-course') }],
      assignments: [{
        id: 'assignment-entry-001', courseId: 'legacy-course', title: 'Legacy task', kind: 'assignment',
        dueAt: new Date(Date.now() + 86_400_000).toISOString(), status: 'pending',
        source: 'theol', sourceUrl: homeworkUrl('9001'),
      }],
    }))
    const requested = []
    const service = new CourseWorkService({
      root,
      store,
      client: {
        async page(url) {
          requested.push(url)
          return { url, text: '<h1>Legacy task</h1><p>Complete it.</p>' }
        },
        async binary() { return { buffer: Buffer.alloc(0) } },
      },
    })

    assert.deepEqual(service.assignmentEntry('assignment-entry-001'), {
      assignment: store.snapshot().assignments[0],
      courseSourceUrl: courseUrl('legacy-course'),
      assignmentSourceUrl: homeworkUrl('9001'),
      kind: 'assignment',
      uniqueTaskId: 'assignment:9001',
    })
    await service.prepare('assignment-entry-001')
    assert.deepEqual(requested, [courseUrl('legacy-course'), homeworkUrl('9001')])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('assignment entry permits read-only opening of submitted tasks but keeps automation current-only', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-work-readonly-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    await store.update((state) => ({
      ...state,
      assignments: [{
        id: 'assignment-submitted-001', courseId: '101', title: 'Submitted task', kind: 'assignment',
        status: 'submitted', source: 'theol', courseSourceUrl: courseUrl('101'), sourceUrl: homeworkUrl('9002'),
      }],
    }))
    const service = new CourseWorkService({ root, store })

    assert.equal(
      service.assignmentEntry('assignment-submitted-001', { requireCurrent: false }).uniqueTaskId,
      'assignment:9002',
    )
    assert.throws(() => service.assignmentEntry('assignment-submitted-001'), /已截止或已提交/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('course work stops before parsing when THEOL redirects to another course or task', async (t) => {
  const scenarios = [
    {
      name: 'wrong course context',
      page(url, call) {
        return call === 1
          ? { url: courseUrl('202'), text: '<input name="lid" value="202">' }
          : { url, text: '<h1>should not be reached</h1>' }
      },
      error: /其他课程/,
      expectedCalls: 1,
    },
    {
      name: 'wrong task detail',
      page(url, call) {
        return call === 1
          ? { url: courseUrl('101'), text: '<input name="lid" value="101">' }
          : { url: homeworkUrl('9999'), text: '<input name="lid" value="101"><h1>Wrong task</h1>' }
      },
      error: /其他任务/,
      expectedCalls: 2,
    },
    {
      name: 'wrong course on task detail',
      page(url, call) {
        return call === 1
          ? { url: courseUrl('101'), text: '<input name="lid" value="101">' }
          : { url, text: '<input name="lid" value="202"><h1>Wrong course task</h1>' }
      },
      error: /其他课程/,
      expectedCalls: 2,
    },
  ]

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const root = await mkdtemp(resolve(tmpdir(), 'theia-work-redirect-'))
      try {
        const store = new CampusStore(root)
        await store.load()
        await store.update((state) => ({
          ...state,
          assignments: [{
            id: 'assignment-redirect-001', courseId: '101', title: 'Expected task', kind: 'assignment',
            dueAt: new Date(Date.now() + 86_400_000).toISOString(), status: 'pending', source: 'theol',
            courseSourceUrl: courseUrl('101'), sourceUrl: homeworkUrl('9003'),
          }],
        }))
        let calls = 0
        const service = new CourseWorkService({
          root,
          store,
          client: {
            async page(url) { calls += 1; return scenario.page(url, calls) },
            async binary() { return { buffer: Buffer.alloc(0) } },
          },
        })

        await assert.rejects(service.prepare('assignment-redirect-001'), scenario.error)
        assert.equal(calls, scenario.expectedCalls)
        assert.deepEqual(store.snapshot().workspaces, [])
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })
  }
})

test('course work rejects ambiguous context and non-unique task pages before network access', async () => {
  const cases = [
    {
      name: 'missing course entry',
      courses: [],
      assignment: { courseId: 'missing', sourceUrl: homeworkUrl('9101') },
      error: /缺少课程入口/,
    },
    {
      name: 'ambiguous legacy course entry',
      courses: [
        { id: 'duplicate', source: 'theol', sourceUrl: courseUrl('duplicate') },
        { id: 'duplicate', source: 'theol', sourceUrl: courseUrl('duplicate') },
      ],
      assignment: { courseId: 'duplicate', sourceUrl: homeworkUrl('9102') },
      error: /多个课程入口/,
    },
    {
      name: 'homework list page',
      courses: [],
      assignment: { courseId: 'list', courseSourceUrl: courseUrl('list'), sourceUrl: 'https://course.buct.edu.cn/meol/common/hw/student/hwtask.jsp' },
      error: /不是唯一任务详情页/,
    },
    {
      name: 'test list page',
      courses: [],
      assignment: { courseId: 'list', courseSourceUrl: courseUrl('list'), kind: 'online-test', sourceUrl: 'https://course.buct.edu.cn/meol/common/question/test/student/list.jsp?testId=9103' },
      error: /不是唯一任务详情页/,
    },
    {
      name: 'missing unique task id',
      courses: [],
      assignment: { courseId: 'missing-id', courseSourceUrl: courseUrl('missing-id'), sourceUrl: 'https://course.buct.edu.cn/meol/common/hw/student/hwtask.view.jsp' },
      error: /缺少唯一任务标识/,
    },
    {
      name: 'duplicate unique task id parameter',
      courses: [],
      assignment: { courseId: 'duplicate-id', courseSourceUrl: courseUrl('duplicate-id'), sourceUrl: `${homeworkUrl('9104')}&hwtid=` },
      error: /缺少唯一任务标识/,
    },
    {
      name: 'task kind mismatch',
      courses: [],
      assignment: { courseId: 'kind', courseSourceUrl: courseUrl('kind'), kind: 'online-test', sourceUrl: homeworkUrl('9105') },
      error: /任务类型与详情入口不一致/,
    },
  ]

  for (const scenario of cases) {
    const root = await mkdtemp(resolve(tmpdir(), 'theia-work-reject-'))
    try {
      const store = new CampusStore(root)
      await store.load()
      await store.update((state) => ({
        ...state,
        courses: scenario.courses,
        assignments: [{
          id: 'assignment-reject-001', title: scenario.name, kind: 'assignment',
          dueAt: new Date(Date.now() + 86_400_000).toISOString(), status: 'pending', source: 'theol',
          ...scenario.assignment,
        }],
      }))
      let requestCount = 0
      const service = new CourseWorkService({
        root,
        store,
        client: {
          async page(url) { requestCount += 1; return { url, text: '' } },
          async binary() { return { buffer: Buffer.alloc(0) } },
        },
      })

      assert.throws(() => service.assignmentEntry('assignment-reject-001'), scenario.error, scenario.name)
      await assert.rejects(service.prepare('assignment-reject-001'), scenario.error, scenario.name)
      assert.equal(requestCount, 0, scenario.name)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
})

test('course work service saves a local work package and accepts a test answer key', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-work-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    await store.update((state) => ({
      ...state,
      assignments: [{
        id: 'assignment-test-001', title: '单元测试', courseName: '化学基础', kind: 'online-test',
        dueAt: new Date(Date.now() + 86_400_000).toISOString(), status: 'pending',
        courseId: '101', courseSourceUrl: courseUrl('101'), sourceUrl: testUrl('1'), source: 'theol',
      }],
    }))
    const requested = []
    const client = {
      async page(url) {
        requested.push(url)
        return { url, text: '<h1>单元测试</h1><p>选择正确答案。</p><a href="/meol/download/test.pdf">下载附件</a><div class="question"><p>1. 选择 H2O</p><label><input type="radio" name="q1" value="A">A. H2O</label></div>' }
      },
      async binary() { return { buffer: Buffer.from('attachment') } },
    }
    const service = new CourseWorkService({ root, store, client })
    const prepared = await service.prepare('assignment-test-001')
    assert.deepEqual(requested, [courseUrl('101'), testUrl('1')])
    assert.equal(prepared.workspace.questionCount, 1)
    assert.equal(prepared.workspace.attachmentCount, 1)
    assert.equal(prepared.snapshot.sync.domains.workspaces.completeness, 'complete')
    assert.equal(prepared.snapshot.sync.domains.workspaces.status, 'succeeded')
    assert.equal(prepared.snapshot.sync.domains.coursework.completeness, 'unknown')
    assert.deepEqual(prepared.snapshot.sync.domains.coursework.derivedFrom, ['assignments', 'workspaces'])
    assert.equal(prepared.snapshot.sync.domains.coursework.emptyConfirmed, false)
    assert.match(await readFile(prepared.workspace.taskPath, 'utf8'), /单元测试/)
    assert.deepEqual(JSON.parse(await readFile(resolve(prepared.workspace.directory, 'answers.template.json'), 'utf8')).answers, [{ question: 1, answer: '' }])

    const answerSource = resolve(root, 'answers.json')
    await writeFile(answerSource, JSON.stringify({ answers: [{ question: 1, answer: 'A' }] }), 'utf8')
    const imported = await service.importFile('assignment-test-001', answerSource, 'answer-key')
    assert.equal(imported.snapshot.workspaces[0].state, 'answer-ready')
    assert.deepEqual(await service.answerKey('assignment-test-001'), { schema: 'theia-test-answer-key/v1', answers: [{ question: 1, answer: 'A' }] })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('course work service preserves attachments whose filenames collide on Windows', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-work-collisions-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    await store.update((state) => ({
      ...state,
      assignments: [{
        id: 'assignment-collision-001', title: '附件重名', courseName: '测试课程', kind: 'assignment',
        dueAt: new Date(Date.now() + 86_400_000).toISOString(), status: 'pending',
        courseId: '102', courseSourceUrl: courseUrl('102'), sourceUrl: homeworkUrl('2'), source: 'theol',
      }],
    }))
    let download = 0
    const service = new CourseWorkService({
      root,
      store,
      client: {
        async page(url) {
          return { url, text: '<h1>附件重名</h1><a href="/meol/download/report.pdf">附件一</a><a href="/meol/download/REPORT.pdf">附件二</a>' }
        },
        async binary() {
          download += 1
          return { buffer: Buffer.from(`attachment-${download}`) }
        },
      },
    })

    const prepared = await service.prepare('assignment-collision-001')
    const manifest = JSON.parse(await readFile(prepared.workspace.manifestPath, 'utf8'))
    assert.deepEqual(manifest.attachments.map((item) => item.file), ['report.pdf', 'REPORT-2.pdf'])
    assert.equal(await readFile(resolve(prepared.workspace.directory, 'report.pdf'), 'utf8'), 'attachment-1')
    assert.equal(await readFile(resolve(prepared.workspace.directory, 'REPORT-2.pdf'), 'utf8'), 'attachment-2')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('course work service keeps hostile attachment filenames inside the workspace', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-work-attachment-paths-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    await store.update((state) => ({
      ...state,
      assignments: [{
        id: 'assignment-attachment-path-001', title: '附件路径', courseName: '测试课程', kind: 'assignment',
        dueAt: new Date(Date.now() + 86_400_000).toISOString(), status: 'pending',
        courseId: '103', courseSourceUrl: courseUrl('103'), sourceUrl: homeworkUrl('5'), source: 'theol',
      }],
    }))
    const service = new CourseWorkService({
      root,
      store,
      client: {
        async page(url) {
          return { url, text: '<a href="/meol/download?id=1&filename=report.exe%5C..%5Coutside.txt">恶意附件</a>' }
        },
        async binary() { return { buffer: Buffer.from('inside') } },
      },
    })

    const prepared = await service.prepare('assignment-attachment-path-001')
    const manifest = JSON.parse(await readFile(prepared.workspace.manifestPath, 'utf8'))
    assert.equal(manifest.attachments.length, 1)
    assert.equal(manifest.attachments[0].downloaded, true)
    assert.equal(manifest.attachments[0].file.includes('\\'), false)
    assert.equal(manifest.attachments[0].file.includes('/'), false)
    assert.equal(await readFile(resolve(prepared.workspace.directory, manifest.attachments[0].file), 'utf8'), 'inside')
    await assert.rejects(readFile(resolve(root, 'course-work', 'outside.txt'), 'utf8'), /ENOENT/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('course work service rejects tampered workspace file paths outside the assignment directory', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-work-paths-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    await store.update((state) => ({
      ...state,
      assignments: [{
        id: 'assignment-paths-001', title: '路径校验', courseName: '测试课程', kind: 'online-test',
        dueAt: new Date(Date.now() + 86_400_000).toISOString(), status: 'pending',
        courseId: '104', courseSourceUrl: courseUrl('104'), sourceUrl: testUrl('3'), source: 'theol',
      }],
    }))
    const service = new CourseWorkService({
      root,
      store,
      client: {
        async page(url) {
          return { url, text: '<h1>路径校验</h1><div class="question"><textarea name="q1"></textarea></div>' }
        },
        async binary() { return { buffer: Buffer.alloc(0) } },
      },
    })
    await service.prepare('assignment-paths-001')
    const outside = resolve(root, 'outside.json')
    await writeFile(outside, JSON.stringify({ answers: [{ question: 1, answer: 'secret' }] }), 'utf8')
    await store.update((state) => ({
      ...state,
      workspaces: state.workspaces.map((workspace) => ({
        ...workspace,
        answerKeyPath: outside,
        taskPath: resolve(root, 'outside.md'),
      })),
    }))

    assert.throws(() => service.validatedWorkspace('assignment-paths-001'), /工作区文件路径无效/)
    await assert.rejects(service.answerKey('assignment-paths-001'), /工作区文件路径无效/)
    await assert.rejects(service.readWorkspaceManifest('assignment-paths-001'), /工作区文件路径无效/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('preparing a workspace drops previously tampered optional paths', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-work-repair-'))
  try {
    const store = new CampusStore(root)
    await store.load()
    await store.update((state) => ({
      ...state,
      assignments: [{
        id: 'assignment-repair-001', title: '修复路径', courseName: '测试课程', kind: 'assignment',
        dueAt: new Date(Date.now() + 86_400_000).toISOString(), status: 'pending',
        courseId: '105', courseSourceUrl: courseUrl('105'), sourceUrl: homeworkUrl('4'), source: 'theol',
      }],
      workspaces: [{
        assignmentId: 'assignment-repair-001',
        directory: resolve(root, 'course-work', 'assignment-repair-001'),
        manifestPath: resolve(root, 'course-work', 'assignment-repair-001', 'manifest.json'),
        taskPath: resolve(root, 'course-work', 'assignment-repair-001', 'task.md'),
        notesPath: resolve(root, 'private.md'),
        modelAnswerPdfPath: resolve(root, 'private.pdf'),
      }],
    }))
    const service = new CourseWorkService({
      root,
      store,
      client: {
        async page(url) { return { url, text: '<h1>修复路径</h1><p>请完成。</p>' } },
        async binary() { return { buffer: Buffer.alloc(0) } },
      },
    })

    const prepared = await service.prepare('assignment-repair-001')
    assert.equal(prepared.workspace.notesPath, undefined)
    assert.equal(prepared.workspace.modelAnswerPdfPath, undefined)
    assert.doesNotThrow(() => service.validatedWorkspace('assignment-repair-001'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
