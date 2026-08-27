import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CourseSelectionJournal } from '../core/course-selection-journal.mjs'

test('course selection journal persists only a safe target and lifecycle summary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theia-course-selection-'))
  try {
    const journal = new CourseSelectionJournal(root)
    await journal.load()
    await journal.setTarget({
      id: 'schedule-1', termId: '2026-3', courseCode: 'MAT13904T', title: 'Calculus',
      classId: 'CLASS-01', className: 'Calculus 01', teacher: 'Teacher Li', time: 'Mon 1-2', location: 'A-203',
      operationId: 'must-not-persist', cookie: 'must-not-persist', password: 'must-not-persist',
    })
    await journal.recordJob({
      active: {
        id: 'job-1', status: 'stopped', candidate: { title: 'Calculus', courseCode: 'MAT13904T', operationId: 'OP-1' },
        attempts: [{ message: 'No seats' }], completedAt: '2026-08-12T00:00:00.000Z', lastMessage: 'No seats',
      },
    })
    const saved = JSON.parse(await readFile(join(root, 'course-selection', 'records.json'), 'utf8'))
    assert.equal(saved.target.title, 'Calculus')
    assert.equal(saved.target.classId, 'CLASS-01')
    assert.equal(saved.target.className, 'Calculus 01')
    assert.equal(saved.history[0].candidate.courseCode, 'MAT13904T')
    assert.match(saved.history[0].logs[0].message, /^HISTORY SUMMARY \| No seats$/)
    assert.equal(JSON.stringify(saved).includes('must-not-persist'), false)
    assert.equal(JSON.stringify(saved).includes('OP-1'), false)

    await journal.recordJob({
      active: {
        id: 'job-2', status: 'exhausted', target: {
          id: 'schedule-1', termId: '2026-3', courseCode: 'MAT13904T', title: 'Calculus',
          classId: 'CLASS-01', className: 'Calculus 01', operationId: 'must-not-persist',
        },
        attempts: [{ message: 'CLASS_NOT_FOUND' }], completedAt: '2026-08-12T00:01:00.000Z', lastMessage: 'CLASS_NOT_FOUND',
        logs: [{ at: '2026-08-12T00:00:00.000Z', level: 'info', message: 'CATALOG RESULT | signal=0 | token=must-not-persist | xkkz_xh=secret | jxb_ids=operation | jcxx_id=detail | {"xkkz_xh":"secret-json"}' }],
      },
    })
    const planned = JSON.parse(await readFile(join(root, 'course-selection', 'records.json'), 'utf8'))
    assert.equal(planned.history.at(-1).candidate.title, 'Calculus')
    assert.equal(planned.history.at(-1).candidate.classId, 'CLASS-01')
    assert.equal(planned.history.at(-1).lastMessage, 'CLASS_NOT_FOUND')
    assert.equal(planned.history.at(-1).logs[0].message.includes('token=[redacted]'), true)
    assert.equal(planned.history.at(-1).logs[0].message.includes('xkkz_xh=[redacted]'), true)
    assert.equal(planned.history.at(-1).logs[0].message.includes('jxb_ids=[redacted]'), true)
    assert.equal(planned.history.at(-1).logs[0].message.includes('jcxx_id=[redacted]'), true)
    assert.equal(JSON.stringify(planned).includes('must-not-persist'), false)
    assert.equal(JSON.stringify(planned).includes('secret-json'), false)

    const restored = new CourseSelectionJournal(root)
    await restored.load()
    assert.equal(restored.snapshot().target?.location, 'A-203')
    assert.equal(restored.snapshot().history[0]?.status, 'stopped')
    assert.equal(restored.snapshot().history.at(-1).logs[0].message.includes('token=[redacted]'), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('course selection journal appends independent targets and migrates a legacy target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theia-course-selection-queue-'))
  try {
    const journal = new CourseSelectionJournal(root)
    await journal.load()
    await journal.addTarget({ id: 'one', termId: '2026-3', courseCode: 'MAT1', title: 'Calculus' })
    await journal.addTarget({ id: 'two', termId: '2026-3', courseCode: 'PHY1', title: 'Physics' })
    await journal.addTarget({ id: 'one', termId: '2026-3', courseCode: 'MAT1', title: 'Calculus (updated)' })
    assert.deepEqual(journal.snapshot().targets.map((target) => target.id), ['two', 'one'])
    await journal.removeTarget('two')
    assert.equal(journal.snapshot().targets.length, 1)
    assert.equal(journal.snapshot().target?.title, 'Calculus (updated)')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('course selection journal keeps school-wide lookup identity without persisting submit tokens', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theia-course-selection-context-'))
  try {
    const journal = new CourseSelectionJournal(root)
    await journal.load()
    await journal.setTarget({
      id: 'school-row-671', termId: '2026-3', courseId: 'OPAQUE-KCH', courseCode: 'PSE30200T',
      categoryCode: '01', jxbzls: '1', classId: 'SCHOOL-JXB', title: '科技写作与报告',
      selectionContext: {
        rwlx: '1', rlkz: '0', xklc: '1', xkly: '1', kklxdm: '01',
        jcxx_id: 'detail-671', xkkz_xh: 'must-not-persist', token: 'must-not-persist',
      },
      operationId: 'must-not-persist', password: 'must-not-persist',
    })
    const saved = JSON.parse(await readFile(join(root, 'course-selection', 'records.json'), 'utf8'))
    assert.equal(saved.target.courseId, 'OPAQUE-KCH')
    assert.equal(saved.target.categoryCode, '01')
    assert.equal(saved.target.jxbzls, '1')
    assert.deepEqual(saved.target.selectionContext, {
      rwlx: '1', rlkz: '0', xklc: '1', xkly: '1', kklxdm: '01', jcxx_id: 'detail-671',
    })
    assert.equal(JSON.stringify(saved).includes('must-not-persist'), false)
    const restored = new CourseSelectionJournal(root)
    await restored.load()
    assert.equal(restored.snapshot().target?.courseId, 'OPAQUE-KCH')
    assert.equal(restored.snapshot().target?.classId, 'SCHOOL-JXB')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('disabling the sentinel preserves the saved selection window', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theia-course-selection-window-'))
  try {
    const journal = new CourseSelectionJournal(root)
    await journal.load()
    await journal.setSentinel({
      enabled: false,
      startAt: '2026-08-24T00:00:00.000Z',
      endAt: '2026-08-28T23:59:00.000Z',
      intervalMs: 2_000,
      concurrency: 2,
    })
    assert.equal(journal.snapshot().sentinel.enabled, false)
    assert.equal(journal.snapshot().sentinel.startAt, '2026-08-24T00:00:00.000Z')
    assert.equal(journal.snapshot().sentinel.endAt, '2026-08-28T23:59:00.000Z')
    await journal.setSentinel({ enabled: true })
    assert.equal(journal.snapshot().sentinel.enabled, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
