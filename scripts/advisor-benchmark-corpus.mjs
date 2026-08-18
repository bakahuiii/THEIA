import { emptyState, normalizeState } from '../core/schema.mjs'
import { computeDomainDigests } from '../core/domain-provenance.mjs'

export const ADVISOR_BENCHMARK_CORPUS = Object.freeze({
  schema: 'theia-advisor-benchmark-corpus/v1',
  version: '2026-08-16.v1',
  seed: 20260816,
  sizes: Object.freeze({
    courses: 2_000,
    grades: 10_000,
    schedule: 10_000,
    notices: 5_000,
  }),
  capturedAt: '2026-08-15T04:00:00.000Z',
})

function pad(value, width) {
  return String(value).padStart(width, '0')
}

function course(index) {
  const code = `BENCH${pad(index + 1, 4)}`
  return {
    id: `bench-course-${index + 1}`,
    courseCode: code,
    title: `评测课程 ${pad(index + 1, 4)}`,
    credits: index % 5 === 0 ? 3 : 2,
    category: index % 3 === 0 ? '专业必修' : '专业选修',
    nature: index % 3 === 0 ? '必修' : '选修',
    termId: `202${20 + (index % 6)}-${(index % 2) + 1}`,
  }
}

function grade(index, courses) {
  const source = courses[index % courses.length]
  const score = 60 + ((index * 17) % 41)
  return {
    id: `bench-grade-${index + 1}`,
    courseCode: source.courseCode,
    courseName: source.title,
    credits: source.credits,
    score: String(score),
    point: score >= 90 ? 4 : score >= 85 ? 3.7 : score >= 82 ? 3.3 : score >= 78 ? 3 : score >= 75 ? 2.7 : score >= 72 ? 2.3 : score >= 68 ? 2 : score >= 64 ? 1.5 : score >= 60 ? 1 : 0,
    termId: source.termId,
    passed: score >= 60,
  }
}

function scheduleItem(index, courses) {
  const source = courses[index % courses.length]
  return {
    id: `bench-schedule-${index + 1}`,
    courseId: source.id,
    courseCode: source.courseCode,
    title: source.title,
    weekday: (index % 7) + 1,
    period: `${(index % 10) + 1}-${(index % 10) + 2}节`,
    weeks: `${(index % 18) + 1}-${(index % 18) + 2}周`,
    room: `评测楼 ${String.fromCharCode(65 + (index % 6))}${100 + (index % 80)}`,
    termId: source.termId,
  }
}

function notice(index) {
  const hour = String(index % 24).padStart(2, '0')
  return {
    id: `bench-notice-${index + 1}`,
    title: `评测通知 ${pad(index + 1, 4)}`,
    summary: `这是用于本地顾问 overview 性能评测的通知摘要 ${index + 1}。`,
    publishedAt: `2026-08-${String((index % 15) + 1).padStart(2, '0')}T${hour}:00:00.000Z`,
    source: 'benchmark',
  }
}

function domainOutcome(capturedAt, source = ['benchmark']) {
  return {
    runId: 'advisor-benchmark-run-v1',
    source,
    attempted: true,
    succeeded: true,
    attemptedAt: capturedAt,
    completedAt: capturedAt,
    status: 'succeeded',
    capturedAt,
    sourceSucceededAt: capturedAt,
    emptyConfirmed: false,
    contentEmptyConfirmed: false,
    retainedPrevious: false,
    completeness: 'complete',
    parserVersion: 'advisor-benchmark/v1',
    errorCode: null,
  }
}

export function createAdvisorBenchmarkSnapshot({ seed = ADVISOR_BENCHMARK_CORPUS.seed } = {}) {
  const sizes = ADVISOR_BENCHMARK_CORPUS.sizes
  const state = emptyState()
  const courses = Array.from({ length: sizes.courses }, (_, index) => course(index))
  const capturedAt = ADVISOR_BENCHMARK_CORPUS.capturedAt
  state.createdAt = capturedAt
  state.updatedAt = capturedAt
  state.profile = {
    name: '评测用户',
    studentId: `BENCH${seed}`,
    major: '材料科学与工程',
    grade: '2024级',
  }
  state.terms = ['2024-1', '2024-2', '2025-1', '2025-2', '2026-1'].map((id) => ({ id, name: id }))
  state.courses = courses
  state.grades = Array.from({ length: sizes.grades }, (_, index) => grade(index, courses))
  state.schedule = Array.from({ length: sizes.schedule }, (_, index) => scheduleItem(index, courses))
  state.notices = Array.from({ length: sizes.notices }, (_, index) => notice(index))
  state.academicProgress = {
    program: '评测培养方案',
    categories: [],
    roots: Array.from({ length: 100 }, (_, index) => ({
      id: `bench-requirement-${index + 1}`,
      title: `评测要求 ${pad(index + 1, 3)}`,
      relation: 'and',
      required: 20,
      earned: index % 20,
      remaining: 20 - (index % 20),
      courses: [],
      children: [],
    })),
  }
  state.sync = {
    ...state.sync,
    runId: 'advisor-benchmark-run-v1',
    lastStartedAt: capturedAt,
    lastCompletedAt: capturedAt,
    lastRunAt: capturedAt,
    lastSuccessAt: capturedAt,
    domains: Object.fromEntries([
      'profile', 'terms', 'courses', 'schedule', 'grades', 'academic-progress', 'notices',
    ].map((domain) => [domain, domainOutcome(capturedAt)])),
  }
  const normalized = normalizeState(state)
  return Object.freeze({
    state: normalized,
    revision: `advisor-benchmark-${ADVISOR_BENCHMARK_CORPUS.version}-${seed}`,
    committedAt: capturedAt,
    domainDigests: computeDomainDigests(normalized),
  })
}
