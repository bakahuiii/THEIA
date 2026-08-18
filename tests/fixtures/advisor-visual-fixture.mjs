import { normalizeState } from '../../core/schema.mjs'
import { computeDomainDigests } from '../../core/domain-provenance.mjs'
import { canonicalDigest } from '../../core/advisor/index.mjs'
import {
  advisorAcademicWhatIfFromStore,
  advisorCourseDecisionsFromStore,
  advisorOverviewFromStore,
} from '../../electron/advisor-overview-service.mjs'

export const ADVISOR_VISUAL_NOW = '2026-08-14T01:00:00.000Z'
const FRESH_CAPTURE = '2026-08-14T00:40:00.000Z'
const STALE_CAPTURE = '2026-08-12T00:00:00.000Z'
const REVISION = 'advisor-visual-fixture-r1'

function outcome(overrides = {}) {
  return {
    runId: 'advisor-visual-run',
    source: ['fixture'],
    attempted: true,
    succeeded: true,
    attemptedAt: FRESH_CAPTURE,
    completedAt: FRESH_CAPTURE,
    status: 'succeeded',
    capturedAt: FRESH_CAPTURE,
    sourceSucceededAt: FRESH_CAPTURE,
    emptyConfirmed: false,
    contentEmptyConfirmed: false,
    retainedPrevious: false,
    completeness: 'complete',
    parserVersion: 'advisor-visual-fixture/v1',
    errorCode: null,
    ...overrides,
  }
}

function emptyOutcome(overrides = {}) {
  return outcome({ emptyConfirmed: true, contentEmptyConfirmed: true, ...overrides })
}

function requirement(id, title, fields = {}) {
  return { id, title, relation: 'and', children: [], courses: [], ...fields }
}

function createState() {
  const core = requirement('plan-core', '公共基础与专业核心', {
    required: 72,
    earned: 62,
    remaining: 10,
    courses: [
      { id: 'plan-data', courseCode: 'VIS201', title: '数据结构', credits: 3, studyStatus: '未修', category: '专业必修' },
      { id: 'plan-thermo', courseCode: 'VIS301', title: '化工热力学', credits: 3, studyStatus: '未通过', category: '专业必修' },
    ],
  })
  const direction = requirement('plan-direction', '专业方向模块', {
    children: [
      requirement('plan-direction-a', '智能系统方向', { relation: 'or', required: 8, earned: 3, remaining: 5 }),
      requirement('plan-direction-b', '绿色化工方向', { relation: 'or', required: 8, earned: 5, remaining: 3 }),
    ],
  })
  const practice = requirement('plan-practice', '实践与创新', {
    required: 10,
    earned: 7,
    remaining: 3,
  })
  const planRoot = requirement('plan-root', '2024级匿名示例培养方案', {
    required: 90,
    earned: 69,
    remaining: 21,
    children: [core, direction, practice],
  })

  const state = normalizeState({
    createdAt: FRESH_CAPTURE,
    updatedAt: FRESH_CAPTURE,
    profile: { name: '匿名同学', studentId: '2024000000', major: '示例专业', gpa: 3.06 },
    terms: [{ id: '2026-3', label: '2026-2027学年第一学期' }],
    courses: [
      { id: 'course-data', title: '数据结构', courseCode: 'VIS201', teacher: '示例教师', termId: '2026-3' },
      { id: 'course-thermo', title: '化工热力学', courseCode: 'VIS301', teacher: '示例教师', termId: '2026-3' },
    ],
    schedule: [
      { id: 'schedule-existing', courseId: 'VIS100', courseCode: 'VIS100', title: '工程数学', termId: '2026-3', weekday: 2, period: '3-4', weeks: '1-16周', location: '匿名教学楼 101' },
    ],
    exams: [],
    grades: [
      { id: 'grade-pass-1', courseCode: 'VIS101', courseName: '高等数学', credits: 5.5, score: 82, point: 3.2, termId: '2025-12' },
      { id: 'grade-pass-2', courseCode: 'VIS102', courseName: '大学物理', credits: 4, score: 88, point: 3.8, termId: '2025-12' },
      { id: 'grade-fail', courseCode: 'VIS301', courseName: '化工热力学', credits: 3, score: '不合格', point: 0, termId: '2026-3' },
    ],
    selectedCourses: [{ id: 'selected-repeat', courseCode: 'VIS202', title: '算法设计', termId: '2026-3' }],
    academicProgress: {
      program: '2024级匿名示例培养方案',
      gpa: 3.12,
      requirementSource: 'api-tree-detail',
      roots: [planRoot],
      categories: [core, direction, practice],
      capturedAt: FRESH_CAPTURE,
    },
    assignments: [
      { id: 'assignment-soon', title: '证据链设计报告：需要说明每个结论如何回到原始数据并处理异常长文本', courseName: '数据结构', dueAt: '2026-08-14T05:00:00.000Z', status: 'pending', capturedAt: STALE_CAPTURE },
      { id: 'assignment-later', title: '本地顾问原型复盘', courseName: '工程导论', dueAt: '2026-08-16T04:00:00.000Z', status: 'pending', capturedAt: STALE_CAPTURE },
    ],
    workspaces: [],
    notices: [{ id: 'notice-stale', title: '匿名学院选课说明', publishedAt: STALE_CAPTURE, capturedAt: STALE_CAPTURE }],
    emails: [],
    sync: {
      runId: 'advisor-visual-run',
      lastStartedAt: FRESH_CAPTURE,
      lastCompletedAt: FRESH_CAPTURE,
      lastRunAt: FRESH_CAPTURE,
      lastSuccessAt: FRESH_CAPTURE,
      lastError: null,
      sources: {},
      domains: {
        profile: outcome({ source: ['jwglxt'] }),
        terms: outcome({ source: ['jwglxt'] }),
        courses: outcome({ source: ['theol'] }),
        academic: outcome({ source: ['jwglxt'] }),
        schedule: outcome({ source: ['jwglxt'] }),
        grades: outcome({ source: ['jwglxt'], completeness: 'partial' }),
        exams: emptyOutcome({ source: ['jwglxt'] }),
        'selected-courses': outcome({ source: ['jwglxt'] }),
        'academic-progress': outcome({ source: ['jwglxt'] }),
        assignments: outcome({ source: ['theol'], succeeded: false, status: 'failed', capturedAt: STALE_CAPTURE, sourceSucceededAt: STALE_CAPTURE, retainedPrevious: true, errorCode: 'fixture-timeout', previousRecordCount: 2, receivedRecordCount: 0, failedTermIds: ['2026-3'] }),
        workspaces: emptyOutcome({ source: ['local'] }),
        coursework: outcome({ source: ['local'], completeness: 'partial' }),
        notices: outcome({ source: ['jwglxt', 'theol'], capturedAt: STALE_CAPTURE, sourceSucceededAt: STALE_CAPTURE }),
        mailbox: emptyOutcome({ source: ['imap'] }),
        fitness: emptyOutcome({ source: ['local'] }),
        'school-schedule': emptyOutcome({ source: ['jwglxt'] }),
        'academic-calendar': emptyOutcome({ source: ['official-calendar'] }),
        'local-data-catalog': outcome({ source: ['local'] }),
      },
    },
  })
  return state
}

export function createAdvisorVisualFixture() {
  const state = createState()
  const versioned = {
    state,
    revision: REVISION,
    committedAt: FRESH_CAPTURE,
    domainDigests: computeDomainDigests(state),
  }
  const store = { snapshotWithRevision: () => structuredClone(versioned) }
  const clock = () => ADVISOR_VISUAL_NOW
  const overview = advisorOverviewFromStore(store, {
    clock,
    upgradeRule: {
      id: 'visual-upgrade-line',
      rulesVersion: 'advisor-visual-rule/v1',
      sourceKind: 'configuration',
      thresholdCredits: 66,
      requirementIds: ['plan-core'],
    },
  })
  const portal = {
    sourceUrl: 'https://fixture.invalid/course-selection',
    term: { id: '2026-3', year: 2026, term: '3', label: '2026-2027学年第一学期' },
    blocks: [{ id: 'visual-elective', categoryCode: 'ZX', title: '专业选修课' }],
    available: true,
    message: null,
  }
  const candidates = [
    { id: 'candidate-best', courseId: 'VIS201', courseCode: 'VIS201', classId: 'class-1', className: '匿名班级 1', operationId: 'fixture-op-1', title: '数据结构', teacher: '示例教师甲', credits: 3, location: '匿名教学楼 201', time: '星期一第1-2节 1-16周', weekday: 1, period: '1-2', weeks: '1-16周', capacity: 80, enrolled: 61, remainingSeats: 19, categoryCode: 'ZX', blockId: 'visual-elective', blockTitle: '专业选修课', termId: '2026-3' },
    { id: 'candidate-duplicate', courseId: 'VIS202', courseCode: 'VIS202', classId: 'class-2', className: '匿名班级 2', operationId: 'fixture-op-2', title: '算法设计', teacher: '示例教师乙', credits: 2, location: '匿名教学楼 202', time: '星期三第5-6节 1-16周', weekday: 3, period: '5-6', weeks: '1-16周', capacity: 60, enrolled: 60, remainingSeats: 0, categoryCode: 'ZX', blockId: 'visual-elective', blockTitle: '专业选修课', termId: '2026-3' },
    { id: 'candidate-conflict', courseId: 'VIS203', courseCode: 'VIS203', classId: 'class-3', className: '匿名班级 3', operationId: 'fixture-op-3', title: '工程伦理与决策', teacher: '示例教师丙', credits: 2, location: '匿名教学楼 203', time: '星期二第3-4节 1-16周', weekday: 2, period: '3-4', weeks: '1-16周', capacity: 100, enrolled: 83, remainingSeats: 17, categoryCode: 'ZX', blockId: 'visual-elective', blockTitle: '专业选修课', termId: '2026-3' },
  ]
  const initialDigest = canonicalDigest(versioned)
  return {
    now: ADVISOR_VISUAL_NOW,
    state,
    versioned,
    store,
    overview,
    portal,
    courseSelection: { active: null, jobs: [], updatedAt: FRESH_CAPTURE, targets: [] },
    candidates,
    catalogPage: { page: 1, pageSize: 24, total: candidates.length },
    initialDigest,
    getDigest: () => canonicalDigest(versioned),
    academicWhatIf: (request) => advisorAcademicWhatIfFromStore(store, request, { clock }),
    courseDecisions: (request) => advisorCourseDecisionsFromStore(store, request, { clock }),
  }
}
