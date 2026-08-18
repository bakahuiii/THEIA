import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ADVISOR_PROMPT_CACHE_MIN_TOKENS,
  ADVISOR_STATIC_SYSTEM_PROMPT,
  createAdvisorFullAccessTools,
  createAdvisorReadOnlyTools,
  createAdvisorPromptCachePrefix,
  estimateAdvisorPromptTokens,
  parseAdvisorAgentTurn,
  resolveAdvisorOutputTokens,
  runReadOnlyAdvisorAgent,
} from '../core/advisor/index.mjs'
import { normalizeAdvisorToolArgs } from '../core/advisor/read-only-tools.mjs'
import { createAdvisorLazyWorkspace } from '../core/advisor/lazy-workspace.mjs'
import { advisorOverviewFromVersionedSnapshot } from '../electron/advisor-overview-service.mjs'
import { versionedState } from './fixtures/advisor-fixtures.mjs'

function tools() {
  return createAdvisorReadOnlyTools({
    snapshotRevision: 'agent-revision-001',
    dataQuality: { schema: 'quality', domains: {} },
    claims: [{ id: 'claim-gpa', displayText: 'GPA is locally computed', evidenceRefs: ['evidence-gpa'] }],
    urgentItems: [{ id: 'deadline-1', domain: 'assignments', title: 'Submit work' }],
    risks: [{ id: 'risk-1', domain: 'academic-progress', title: 'Need review' }],
  })
}

function modelText() { return '这是模型原样返回的回答。' }

test('the cacheable advisor prefix never contains raw profile data', () => {
  const prefix = createAdvisorPromptCachePrefix({
    name: '测试同学', studentId: '2024000000', major: '材料科学与工程', gpa: 3.8,
  })
  assert.ok(estimateAdvisorPromptTokens(ADVISOR_STATIC_SYSTEM_PROMPT) > ADVISOR_PROMPT_CACHE_MIN_TOKENS)
  assert.equal(prefix, ADVISOR_STATIC_SYSTEM_PROMPT)
  assert.doesNotMatch(prefix, /测试同学|2024000000|材料科学与工程|3\.8/u)
})

test('advisor prompts make profile lookup and artifact completion an ordered model workflow', async () => {
  assert.match(ADVISOR_STATIC_SYSTEM_PROMPT, /第一项相关工具调用必须是合法协议对象.*tool 为 search_campus_records.*args 为 \{"domain":"profile"\}/u)
  assert.match(ADVISOR_STATIC_SYSTEM_PROMPT, /必须用已声明的文件工具真实写入/u)
  assert.match(ADVISOR_STATIC_SYSTEM_PROMPT, /不能因为查完资料就提前结束/u)

  const writes = []
  const requests = []
  const fullTools = createAdvisorFullAccessTools({
    tools: {
      ...tools(),
      search_campus_records() {
        return {
          schema: 'theia-advisor-tool-result/v1', name: 'search_campus_records', snapshotRevision: 'agent-revision-001',
          data: { domain: 'profile', items: [{ name: '测试同学', major: '材料科学与工程' }] },
        }
      },
    },
    snapshotRevision: 'agent-revision-001',
    permissionMode: 'full-access',
    operations: {
      async writeFile(args) {
        writes.push(args)
        return { path: args.path, bytesWritten: Buffer.byteLength(args.content, 'utf8') }
      },
    },
  })
  const replies = [
    JSON.stringify({ schema: 'theia-advisor-tool-call/v1', tool: 'search_campus_records', args: { domain: 'profile', limit: 1 } }),
    JSON.stringify({ schema: 'theia-advisor-tool-call/v1', tool: 'write_file', args: { path: 'H:\\agent-output\\index.html', content: '<h1>测试同学</h1>', createDirectories: true } }),
    '网页已写入 H:\\agent-output\\index.html。',
  ]
  const result = await runReadOnlyAdvisorAgent({
    model: 'agent-model',
    tools: fullTools,
    permissionMode: 'full-access',
    messages: [{ role: 'user', content: '帮我写一个简单的个人博客，包含我的个人信息。' }],
    provider: {
      async generateStream(request) {
        requests.push(structuredClone(request))
        return { text: replies.shift() }
      },
    },
  })

  assert.deepEqual(result.calls.map((call) => call.name), ['search_campus_records', 'write_file'])
  assert.equal(writes[0].path, 'H:\\agent-output\\index.html')
  assert.equal(writes[0].createDirectories, true)
  assert.match(requests[1].messages.at(-1).content, /theia-advisor-tool-observation/u)
  assert.match(requests[2].messages.at(-1).content, /write_file/u)
  assert.match(result.text, /已写入/u)
})

test('read-only prompt tells the model to provide content instead of attempting local writes', async () => {
  const requests = []
  await runReadOnlyAdvisorAgent({
    model: 'agent-model', tools: tools(), messages: [{ role: 'user', content: '请保存这个网页。' }],
    provider: {
      async generateStream(request) {
        requests.push(structuredClone(request))
        return { text: '当前为只读模式，下面给出可复制内容。' }
      },
    },
  })
  const prompt = requests[0].messages.slice(0, 2).map((message) => message.content).join('\n')
  assert.match(prompt, /只读/u)
  assert.match(prompt, /不得调用 .*write_file/u)
  assert.match(prompt, /可直接复制/u)
})

test('adaptive response length is small for a short first turn and grows only after evidence arrives', () => {
  const shortQuestion = [{
    role: 'user',
    content: JSON.stringify({ schema: 'theia-advisor-agent-session/v1', question: '你好' }),
  }]
  const longQuestion = [{
    role: 'user',
    content: JSON.stringify({
      schema: 'theia-advisor-agent-session/v1',
      question: '请结合我的课程完成情况、成绩趋势、下学期培养方案和时间冲突，给出选课优先级、风险和具体安排。'.repeat(3),
    }),
  }]
  const withEvidence = [...shortQuestion, {
    role: 'user',
    content: JSON.stringify({
      schema: 'theia-advisor-tool-observation/v1',
      result: { claims: Array.from({ length: 6 }, (_, index) => ({ id: `claim-${index}`, displayText: '课程与学业记录' })) },
    }),
  }]
  const short = resolveAdvisorOutputTokens({ transcript: shortQuestion })
  const long = resolveAdvisorOutputTokens({ transcript: longQuestion })
  const final = resolveAdvisorOutputTokens({ transcript: withEvidence })
  assert.ok(short < 720)
  assert.ok(long > short)
  assert.ok(final > short)
  assert.ok(final <= 1_800)
})

test('agent executes only valid tool calls and classifies invalid protocol separately', () => {
  assert.deepEqual(parseAdvisorAgentTurn(JSON.stringify({
    schema: 'theia-advisor-tool-call/v1',
    tool: 'find_claims',
    args: { query: 'GPA', path: 'C:\\should-not-be-forwarded' },
    reasoning: 'provider metadata is not a capability',
  })), { kind: 'tool', tool: 'find_claims', args: { query: 'GPA' } })
  const toolJson = JSON.stringify({
    schema: 'theia-advisor-tool-call/v1', tool: 'find_claims', args: { query: 'GPA' },
  })
  assert.deepEqual(parseAdvisorAgentTurn(`${toolJson}我先帮你读取一下。`), {
    kind: 'tool', tool: 'find_claims', args: { query: 'GPA' },
  })
  assert.deepEqual(parseAdvisorAgentTurn(`${toolJson}${toolJson}`).kind, 'tool')
  assert.deepEqual(parseAdvisorAgentTurn(modelText()), { kind: 'final', text: modelText() })
  const invalidTool = JSON.stringify({
    schema: 'theia-advisor-tool-call/v1', tool: 'open_url', args: {},
  })
  assert.equal(parseAdvisorAgentTurn(invalidTool).kind, 'invalid-tool')
  const fenced = 'Here is the result:\n```json\n{"schema":"theia-advisor-tool-call/v1"}\n```'
  assert.deepEqual(parseAdvisorAgentTurn(fenced), { kind: 'final', text: fenced })
  assert.deepEqual(parseAdvisorAgentTurn(`先说明一下：${toolJson}查询后我会整理结果。`), {
    kind: 'tool', tool: 'find_claims', args: { query: 'GPA' },
  })
  const fencedTool = `先说明一下：\`\`\`json\n${toolJson}\n\`\`\``
  assert.deepEqual(parseAdvisorAgentTurn(fencedTool), {
    kind: 'final', text: fencedTool,
  })
})

test('record searches accept compatible domain aliases without widening the allowed argument set', () => {
  assert.deepEqual(normalizeAdvisorToolArgs('search_campus_records', {
    topic: 'selected-courses', limit: 100, trace: 'provider metadata',
  }), { domain: 'selected-courses', limit: 100 })
  assert.deepEqual(normalizeAdvisorToolArgs('search_campus_records', {
    type: 'selected_courses', limit: 2, rationale: 'provider metadata',
  }), { domain: 'selected-courses', limit: 2 })
  assert.deepEqual(normalizeAdvisorToolArgs('search_campus_records', {
    category: 'academic progress', limit: 2,
  }), { domain: 'academic-progress', limit: 2 })
  assert.deepEqual(normalizeAdvisorToolArgs('search_campus_records', {
    domain: 'grades', topic: 'selected-courses', limit: 1,
  }), { domain: 'grades', limit: 1 })
})

test('personal blog requests do not prefetch the local profile before generation', async () => {
  const profileCalls = []
  const events = []
  const profileTools = {
    ...tools(),
    search_campus_records(args) {
      profileCalls.push(args)
      return {
        schema: 'theia-advisor-tool-result/v1',
        name: 'search_campus_records',
        snapshotRevision: 'agent-revision-001',
        data: { domain: 'profile', items: [{ name: '测试同学', major: '材料科学与工程' }] },
      }
    },
  }
  const requests = []
  const result = await runReadOnlyAdvisorAgent({
    model: 'agent-model',
    tools: profileTools,
    messages: [{ role: 'user', content: '帮我写一个简单的网页，类似个人博客，包含一定我的个人信息。' }],
    provider: {
      async generateStream(request) {
        requests.push(request)
        return { text: '我会依据已读取的个人资料组织页面内容。' }
      },
    },
    onEvent: (event) => events.push(event),
  })
  assert.deepEqual(profileCalls, [])
  assert.deepEqual(result.calls, [])
  assert.doesNotMatch(JSON.stringify(requests[0].messages), /theia-advisor-tool-observation/u)
  assert.deepEqual(events.map((event) => event.type), ['delta'])
})

test('the model can choose the profile tool for a personal blog request', async () => {
  const profileCalls = []
  const toolCall = JSON.stringify({ schema: 'theia-advisor-tool-call/v1', tool: 'search_campus_records', args: { domain: 'profile', limit: 1 } })
  const requests = []
  const result = await runReadOnlyAdvisorAgent({
    model: 'agent-model',
    tools: {
      ...tools(),
      search_campus_records(args) {
        profileCalls.push(args)
        return {
          schema: 'theia-advisor-tool-result/v1', name: 'search_campus_records', snapshotRevision: 'agent-revision-001',
          data: { domain: 'profile', items: [{ name: '测试同学' }] },
        }
      },
    },
    messages: [{ role: 'user', content: '帮我写一个简单的个人博客，使用我的个人信息。' }],
    provider: {
      async generateStream(request) {
        requests.push(structuredClone(request))
        return { text: requests.length === 1 ? toolCall : '已根据查询到的资料完成页面。' }
      },
    },
  })
  assert.deepEqual(profileCalls, [{ domain: 'profile', limit: 1 }])
  assert.equal(result.calls[0].name, 'search_campus_records')
  assert.doesNotMatch(requests[0].messages.at(-1).content, /theia-advisor-tool-observation/u)
  assert.match(requests[1].messages.at(-1).content, /theia-advisor-tool-observation/u)
})

test('read-only agent streams ordinary long text before the terminal model result', async () => {
  const text = '这是持续生成的普通回答。'.repeat(80)
  const events = []
  const result = await runReadOnlyAdvisorAgent({
    model: 'agent-model',
    tools: tools(),
    messages: [{ role: 'user', content: '写一段较长的说明。' }],
    provider: {
      async generateStream(_request, { onEvent } = {}) {
        for (let index = 0; index < text.length; index += 80) onEvent?.({ type: 'delta', delta: text.slice(index, index + 80) })
        return { text }
      },
    },
    onEvent: (event) => events.push(event),
  })
  const deltas = events.filter((event) => event.type === 'delta').map((event) => event.delta)
  assert.ok(deltas.length > 1)
  assert.equal(deltas.join(''), text)
  assert.equal(result.text, text)
})

test('read-only agent keeps streaming ordinary HTML and CSS instead of treating braces as a tool call', async () => {
  const text = '<style>body { color: #123; margin: 0; }</style><main>个人博客内容</main>\n'.repeat(40)
  const events = []
  await runReadOnlyAdvisorAgent({
    model: 'agent-model',
    tools: tools(),
    messages: [{ role: 'user', content: '输出网页代码。' }],
    provider: {
      async generateStream(_request, { onEvent } = {}) {
        for (let index = 0; index < text.length; index += 17) onEvent?.({ type: 'delta', delta: text.slice(index, index + 17) })
        return { text }
      },
    },
    onEvent: (event) => events.push(event),
  })
  const deltas = events.filter((event) => event.type === 'delta').map((event) => event.delta)
  assert.ok(deltas.length > 1)
  assert.equal(deltas.join(''), text)
})

test('read-only agent executes a leading tool call even when the model appends commentary', async () => {
  const toolCall = JSON.stringify({
    schema: 'theia-advisor-tool-call/v1', tool: 'find_claims', args: { query: 'GPA' },
  })
  const replies = [`${toolCall}我先帮你读取一下。`, modelText()]
  const result = await runReadOnlyAdvisorAgent({
    model: 'agent-model', tools: tools(), messages: [{ role: 'user', content: 'Check my GPA.' }],
    provider: {
      async generateStream() {
        return { text: replies.shift() }
      },
    },
  })
  assert.equal(result.text, modelText())
  assert.deepEqual(result.calls.map((call) => call.name), ['find_claims'])
})

test('read-only agent executes projected tools then returns raw final text without ambient capability', async () => {
  const requests = []
  const replies = [
    JSON.stringify({
      schema: 'theia-advisor-tool-call/v1',
      tool: 'find_claims',
      args: { query: 'GPA', unrelated: true },
      trace: { provider: 'fixture' },
    }),
    modelText(),
  ]
  const result = await runReadOnlyAdvisorAgent({
    model: 'agent-model', tools: tools(), messages: [{ role: 'user', content: 'Check my GPA.' }],
    provider: {
      async generateStream(request) {
        requests.push(structuredClone(request))
        return { text: replies.shift() }
      },
    },
  })
  assert.equal(result.text, modelText())
  assert.equal(result.modelCalls, 2)
  assert.deepEqual(result.calls.map((call) => call.name), ['find_claims'])
  assert.deepEqual(result.calls[0].args, { query: 'GPA' })
  assert.equal(requests[1].messages.at(-1).role, 'user')
  assert.match(requests[1].messages.at(-1).content, /claim-gpa/)
  assert.doesNotMatch(requests[1].messages.at(-1).content, /Return the next JSON object/u)
  assert.match(requests[1].messages.at(-1).content, /自然、温和的中文/u)
  assert.ok(requests.every((request) => request.promptCacheKey === 'theia-advisor-agent-v1'))
  assert.ok(requests.every((request) => request.messages.every((message) => ['system', 'user', 'assistant'].includes(message.role))))
})

test('read-only agent gives a provisional course plan instead of an empty clarification', async () => {
  const toolCall = JSON.stringify({
    schema: 'theia-advisor-tool-call/v1',
    tool: 'inspect_academic_progress',
    args: {},
  })
  const replies = [toolCall, '先优先补齐培养方案中的必修和学分缺口，再用余量安排选修；拿到候选课程、时间冲突和目标学分后，我可以进一步排序。']
  const result = await runReadOnlyAdvisorAgent({
    model: 'agent-model', tools: tools(), messages: [{ role: 'user', content: '下学期怎么选课比较好？' }],
    provider: { async generateStream() { return { text: replies.shift() } } },
  })
  assert.deepEqual(result.calls.map((call) => call.name), ['inspect_academic_progress'])
  assert.match(result.text, /优先|必修|学分/u)
  assert.doesNotMatch(result.text, /你想怎么样/u)
})

test('read-only agent treats vacation questions as academic-calendar lookups', async () => {
  const toolCall = JSON.stringify({
    schema: 'theia-advisor-tool-call/v1',
    tool: 'search_campus_records',
    args: { domain: 'academic-calendar', query: '暑假', limit: 3 },
  })
  const replies = [toolCall, '本校历记录显示暑假至 8 月 30 日结束。']
  const calendarTools = {
    ...tools(),
    search_campus_records(args) {
      return {
        schema: 'theia-advisor-tool-result/v1',
        name: 'search_campus_records',
        snapshotRevision: 'agent-revision-001',
        data: { domain: args.domain, query: args.query, claims: [] },
      }
    },
  }
  const result = await runReadOnlyAdvisorAgent({
    model: 'agent-model', tools: calendarTools, messages: [{ role: 'user', content: '暑假什么时候结束啊？' }],
    provider: { async generateStream() { return { text: replies.shift() } } },
  })
  assert.deepEqual(result.calls.map((call) => call.name), ['search_campus_records'])
  assert.equal(result.calls[0].args.domain, 'academic-calendar')
  assert.match(result.text, /暑假|8 月 30 日/u)
})

test('health tool distinguishes readable stale data from missing data', () => {
  const versioned = versionedState({
    grades: [{ id: 'grade-1', courseName: '材料化学', score: '91', credits: 3 }],
  }, {
    grades: {
      status: 'succeeded', succeeded: true, attempted: true, completeness: 'complete',
      capturedAt: '2026-08-01T00:00:00.000Z', sourceSucceededAt: '2026-08-01T00:00:00.000Z',
    },
  })
  const overview = advisorOverviewFromVersionedSnapshot(versioned, { clock: () => '2026-08-16T00:00:00.000Z' })
  const workspace = createAdvisorLazyWorkspace({ overview, state: versioned.state, snapshotRevision: versioned.revision })
  const result = workspace.tools.get_data_health({ domains: ['grades'] })
  assert.equal(result.data.domains.grades.readable, true)
  assert.equal(result.data.domains.grades.status, 'readable')
  assert.equal(result.data.domains.grades.needsRefresh, true)
  assert.match(result.data.summary.statement, /不表示本地数据损坏/u)
})

test('lazy workspace searches the normalized calendar record, not only the agent prompt contract', () => {
  const versioned = versionedState({
    dataCatalog: {
      collections: {
        academicCalendar: {
          calendar: {
            schoolYear: '2025-2026',
            semesters: [{ label: '第一学期', startDate: '2025-09-01', endDate: '2026-01-18', weeks: 20 }],
            vacations: [{ label: '暑假', startDate: '2026-07-27', endDate: '2026-08-30' }],
          },
          analysis: { weeklyCalendar: { entries: [{ summary: '暑假结束，秋季学期报到', startDate: '2026-08-30' }] } },
        },
      },
    },
  }, { 'academic-calendar': { status: 'succeeded', succeeded: true, attempted: true, completeness: 'complete', capturedAt: '2026-08-12T00:00:00.000Z', sourceSucceededAt: '2026-08-12T00:00:00.000Z' } })
  const overview = advisorOverviewFromVersionedSnapshot(versioned, { clock: () => '2026-08-13T00:00:00.000Z' })
  const workspace = createAdvisorLazyWorkspace({ overview, state: versioned.state, snapshotRevision: versioned.revision })
  const result = workspace.tools.search_campus_records({ domain: 'academic-calendar', query: '暑假', limit: 3 })
  assert.equal(result.data.claims.length, 1)
  assert.match(result.data.claims[0].displayText, /暑假/u)
  assert.match(result.data.claims[0].displayText, /2026-08-30/u)
})

test('lazy workspace rejects academic-warning because the ignored domain is not exposed', () => {
  const versioned = versionedState({
    academicExtras: {
      schema: 'theia-jwglxt-extras/v1',
      domains: {
        'academic-warning': { label: '学业预警', routeCodes: ['N105505'], records: [], messages: [] },
      },
    },
  })
  const overview = advisorOverviewFromVersionedSnapshot(versioned, { clock: () => '2026-08-16T00:00:00.000Z' })
  const workspace = createAdvisorLazyWorkspace({ overview, state: versioned.state, snapshotRevision: versioned.revision })
  assert.equal(workspace.inventory['academic-warning'], undefined)
  assert.throws(
    () => workspace.tools.search_campus_records({ domain: 'academic-warning' }),
    /Advisor record domain is not allowed/u,
  )
})

test('lazy course analysis joins requirement gaps, failed attempts, and the selected school term', () => {
  const versioned = versionedState({
    grades: [
      { id: 'failed-math', courseCode: 'MAT200', courseName: '高等数学', termId: '2025-3', credits: 3, score: 55 },
      { id: 'passed-other', courseCode: 'PHY200', courseName: '普通物理', termId: '2025-3', credits: 2, score: 80 },
    ],
    academicProgress: {
      roots: [{
        id: 'plan', title: '培养方案', required: 10, earned: 2, remaining: 8, relation: 'and',
        children: [
          {
            id: 'public', title: '公共基础必修', required: 5, earned: 0, remaining: 5, relation: 'and',
            courses: [{ id: 'math', courseCode: 'MAT200', title: '高等数学', credits: 3, studyStatus: '未通过' }],
          },
          {
            id: 'major', title: '专业必修', required: 3, earned: 0, remaining: 3, relation: 'and',
            courses: [{ id: 'chem', courseCode: 'CHE200', title: '专业化学', credits: 3, studyStatus: '未修' }],
          },
        ],
      }],
    },
    dataCatalog: {
      collections: {
        schoolSchedule: {
          records: {
            current: {
              scope: { termId: '2026-3' },
              items: [
                { id: 'math-class', courseCode: 'MAT200', title: '高等数学', classId: 'M-1', credits: 3, nature: '公共基础必修', time: '周一' },
                { id: 'chem-class', courseCode: 'CHE200', title: '专业化学', classId: 'C-1', credits: 3, nature: '专业必修', time: '周二' },
                { id: 'elective-class', courseCode: 'ELE200', title: '通识选修', classId: 'E-1', credits: 2, nature: '公共基础选修', time: '周三' },
              ],
            },
          },
        },
      },
    },
  })
  const overview = advisorOverviewFromVersionedSnapshot(versioned, { clock: () => '2026-08-16T00:00:00.000Z' })
  const workspace = createAdvisorLazyWorkspace({ overview, state: versioned.state, snapshotRevision: versioned.revision })
  const result = workspace.tools.inspect_course_analysis({ termId: '2026-3', limit: 8 }).data
  assert.equal(result.requirementSummary.root.remaining, 8)
  assert.ok(result.requirementSummary.categories.some((item) => item.title === '公共基础必修' && item.remaining === 5))
  assert.ok(result.requirementSummary.categories.some((item) => item.title === '专业必修' && item.remaining === 3))
  assert.ok(result.gaps.some((item) => item.kind === 'must-retake' && item.courseCode === 'MAT200'))
  assert.ok(result.gaps.some((item) => item.kind === 'required-unfinished' && item.courseCode === 'CHE200'))
  assert.ok(result.failedCourses.some((item) => item.courseCode === 'MAT200'))
  assert.equal(result.schoolSchedule.termId, '2026-3')
  assert.equal(result.schoolSchedule.recordAvailable, true)
  assert.ok(result.schoolSchedule.candidates.some((item) => item.kind === 'must-retake' && item.courseCode === 'MAT200'))
  assert.ok(result.schoolSchedule.candidates.some((item) => item.kind === 'required-unfinished' && item.courseCode === 'CHE200'))
  assert.ok(result.schoolSchedule.candidates.some((item) => item.kind === 'optional' && item.courseCode === 'ELE200'))
})

test('lazy workspace removes camel-case sensitive fields from safe catalog records', () => {
  const versioned = versionedState({
    dataCatalog: {
      collections: {
        schoolSchedule: {
          records: {
            'schedule-1': {
              courseName: '材料化学',
              apiKey: 'API_SECRET',
              sourceUrl: 'https://private.invalid/source',
              filePath: 'C:\\private\\source.json',
              safeValue: '保留的公开字段',
            },
          },
        },
      },
    },
  })
  const overview = advisorOverviewFromVersionedSnapshot(versioned, { clock: () => '2026-08-16T00:00:00.000Z' })
  const workspace = createAdvisorLazyWorkspace({ overview, state: versioned.state, snapshotRevision: versioned.revision })
  const result = workspace.tools.search_campus_records({ domain: 'school-schedule' })
  const text = JSON.stringify(result)
  assert.match(text, /材料化学|safeValue/u)
  assert.doesNotMatch(text, /API_SECRET|private\.invalid|private\\source\.json|apiKey|sourceUrl|filePath/u)
})

test('lazy workspace requires a mailbox search before reading a message body', () => {
  const versioned = versionedState({
    emails: [{ id: 'mail-1', subject: '本地通知', body: '正文机密', receivedAt: '2026-08-15T00:00:00.000Z' }],
  })
  const overview = advisorOverviewFromVersionedSnapshot(versioned, { clock: () => '2026-08-16T00:00:00.000Z' })
  const searchWorkspace = createAdvisorLazyWorkspace({ overview, state: versioned.state, snapshotRevision: versioned.revision })
  const search = searchWorkspace.tools.search_campus_records({ domain: 'mailbox' })
  const recordId = search.data.items[0].recordId
  const freshWorkspace = createAdvisorLazyWorkspace({ overview, state: versioned.state, snapshotRevision: versioned.revision })
  assert.throws(() => freshWorkspace.tools.read_message({ recordId }), /selected by search/u)
  assert.equal(searchWorkspace.tools.read_message({ recordId }).data.message.body, '正文机密')
})

test('read-only agent fails closed when a selected tool throws', async () => {
  const toolCall = JSON.stringify({ schema: 'theia-advisor-tool-call/v1', tool: 'get_data_health', args: {} })
  await assert.rejects(runReadOnlyAdvisorAgent({
    model: 'agent-model',
    tools: { get_data_health() { throw new Error('fixture tool failure') } },
    messages: [{ role: 'user', content: '检查数据。' }],
    provider: { async generateStream() { return { text: toolCall } } },
  }), (error) => error?.code === 'agent-tool-failed' && !JSON.stringify(error).includes(toolCall))
})

test('read-only agent gives the model a bounded correction when it repeats a tool call', async () => {
  const reply = JSON.stringify({ schema: 'theia-advisor-tool-call/v1', tool: 'get_data_health', args: {} })
  const requests = []
  const replies = [reply, reply, '本地数据已经读取好了，接下来可以直接查看结果。']
  const result = await runReadOnlyAdvisorAgent({
    model: 'agent-model', tools: tools(), messages: [{ role: 'user', content: '检查。' }],
    provider: {
      async generateStream(request) {
        requests.push(structuredClone(request))
        return { text: replies.shift() }
      },
    },
  })
  assert.equal(result.text, '本地数据已经读取好了，接下来可以直接查看结果。')
  assert.equal(result.modelCalls, 3)
  assert.equal(result.calls.length, 1)
  assert.match(requests[2].messages.at(-1).content, /不能再次调用/u)
  assert.doesNotMatch(result.text, /theia-advisor-tool-call|search_campus_records|\{"schema"/u)
})

test('read-only agent requires the provider streaming method', async () => {
  const requests = []
  const events = []
  await runReadOnlyAdvisorAgent({
    model: 'agent-model', tools: tools(), messages: [{ role: 'user', content: 'Check.' }],
    provider: {
      async generate() { throw new Error('non-streaming provider path must not run') },
      async generateStream(request, { onEvent } = {}) {
        requests.push(structuredClone(request))
        onEvent?.({ type: 'delta', delta: '{' })
        return { text: modelText() }
      },
    },
    onEvent: (event) => events.push(event),
  })
  assert.equal(requests.length, 1)
  assert.deepEqual(events, [{ type: 'delta', delta: modelText() }])
})

test('read-only agent executes prose-prefixed tool calls without exposing protocol JSON', async () => {
  const toolReply = `我先检查当前本地快照。${JSON.stringify({
    schema: 'theia-advisor-tool-call/v1',
    tool: 'get_data_health',
    args: {},
  })}查询后我会整理结果。`
  const events = []
  const replies = [toolReply, '第一段', '第二段。']
  const result = await runReadOnlyAdvisorAgent({
    model: 'agent-model', tools: tools(), messages: [{ role: 'user', content: '检查。' }],
    provider: {
      async generateStream(request, { onEvent } = {}) {
        const reply = replies.shift()
        if (reply === toolReply) {
          for (const delta of [reply.slice(0, 9), reply.slice(9, 41), reply.slice(41)]) onEvent?.({ type: 'delta', delta })
        } else {
          onEvent?.({ type: 'delta', delta: reply })
        }
        return { text: reply }
      },
    },
    onEvent: (event) => events.push(event),
  })
  assert.equal(result.text, '第一段')
  assert.deepEqual(events, [
    { type: 'tool-start', tool: 'get_data_health', args: {}, step: 1 },
    { type: 'tool-result', tool: 'get_data_health', step: 1, resultSummary: { hasDataQuality: true } },
    { type: 'delta', delta: '第一段' },
  ])
})

test('read-only agent fails before sending data when streaming is unavailable', async () => {
  let calls = 0
  await assert.rejects(runReadOnlyAdvisorAgent({
    model: 'agent-model', tools: tools(), messages: [{ role: 'user', content: 'Check.' }],
    provider: { async generate() { calls += 1; return { text: modelText() } } },
  }), (error) => error.code === 'agent-streaming-unavailable')
  assert.equal(calls, 0)
})

test('read-only agent preserves health data while replacing the full session with a small anchor', async () => {
  const requests = []
  const replies = [
    JSON.stringify({ schema: 'theia-advisor-tool-call/v1', tool: 'get_data_health', args: {} }),
    modelText(),
  ]
  const session = {
    schema: 'theia-advisor-agent-session/v1',
    intent: 'risk',
    question: '检查成绩数据是否完整。',
    snapshotRevision: 'agent-revision-001',
    currentDate: '2026-08-17', currentTime: '14:00:00', currentInstant: '2026-08-17T06:00:00.000Z', timeZone: 'Asia/Shanghai',
    focusDomains: ['grades'],
    queryHints: ['成绩'],
    dataInventory: { grades: { records: 100, localFacts: 100 }, mailbox: { records: 200, localFacts: 0 } },
    academicContext: { latestKnownTermId: '2026-3', schoolScheduleTermIds: ['2026-3'], terms: [{ id: '2026-3', label: '2026-2027 第一学期' }] },
  }
  await runReadOnlyAdvisorAgent({
    model: 'agent-model', tools: tools(), messages: [{ role: 'user', content: JSON.stringify(session) }],
    provider: {
      async generateStream(request) {
        requests.push(structuredClone(request))
        return { text: replies.shift() }
      },
    },
  })
  assert.match(requests[1].messages[2].content, /theia-advisor-agent-anchor\/v1/)
  assert.match(requests[1].messages[2].content, /dataInventory/)
  assert.match(requests[1].messages[2].content, /academicContext/)
  assert.match(requests[1].messages[2].content, /2026-08-17/)
  assert.match(requests[1].messages[1].content, /继续作为 THEIA/u)
  assert.equal(requests[1].messages[0].content, requests[0].messages[0].content)
  assert.match(requests[1].messages.at(-1).content, /dataQuality/)
})

test('read-only agent rejects a repeated tool loop without local semantic text', async () => {
  const reply = JSON.stringify({ schema: 'theia-advisor-tool-call/v1', tool: 'get_data_health', args: {} })
  await assert.rejects(runReadOnlyAdvisorAgent({
    model: 'agent-model', tools: tools(), messages: [{ role: 'user', content: 'Check.' }],
    provider: { async generateStream() { return { text: reply } } },
  }), (error) => error?.code === 'agent-tool-loop'
    && !JSON.stringify(error).includes('本地数据检查已完成'))
})

test('read-only agent rejects malformed model output instead of persisting protocol JSON', async () => {
  const invalid = '{"schema":"theia-advisor-tool-call/v1","tool":"open_url"}'
  await assert.rejects(runReadOnlyAdvisorAgent({
    model: 'agent-model', tools: tools(), messages: [{ role: 'user', content: 'Check.' }],
    provider: { async generateStream() { return { text: invalid } } },
  }), (error) => error?.code === 'agent-tool-invalid')
})

test('read-only agent compacts tool history while retaining prior evidence ids', async () => {
  const requests = []
  const replies = [
    JSON.stringify({ schema: 'theia-advisor-tool-call/v1', tool: 'find_claims', args: { query: 'GPA' } }),
    JSON.stringify({ schema: 'theia-advisor-tool-call/v1', tool: 'get_data_health', args: {} }),
    JSON.stringify({ schema: 'theia-advisor-tool-call/v1', tool: 'inspect_academic_progress', args: {} }),
    modelText(),
  ]
  const result = await runReadOnlyAdvisorAgent({
    model: 'agent-model', tools: tools(), messages: [{ role: 'user', content: '需要综合判断。' }],
    budget: { maxSteps: 3, maxInputTokens: 3_000 },
    provider: {
      async generateStream(request) {
        requests.push(structuredClone(request))
        return { text: replies.shift() }
      },
    },
  })

  assert.equal(result.modelCalls, 4)
  assert.ok(requests.every((request) => request.messages.length <= 5))
  const repeatedCachePrefixBytes = Buffer.byteLength(requests[0].messages[0].content, 'utf8') * result.modelCalls
  assert.ok(result.inputBytes < repeatedCachePrefixBytes + 8_000)
  assert.match(requests.at(-1).messages.at(-1).content, /claim-gpa/)
})

test('read-only agent stops before sending a context that exceeds its token budget', async () => {
  let calls = 0
  await assert.rejects(runReadOnlyAdvisorAgent({
    model: 'agent-model', tools: tools(), messages: [{ role: 'user', content: '检查。' }],
    budget: { maxInputTokens: 8 },
    provider: {
      async generateStream() {
        calls += 1
        return { text: modelText() }
      },
    },
  }), /input .*budget exhausted/u)
  assert.equal(calls, 0)
})
