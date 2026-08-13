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
    assert.equal(JSON.stringify(saved).includes('must-not-persist'), false)
    assert.equal(JSON.stringify(saved).includes('OP-1'), false)

    const restored = new CourseSelectionJournal(root)
    await restored.load()
    assert.equal(restored.snapshot().target?.location, 'A-203')
    assert.equal(restored.snapshot().history[0]?.status, 'stopped')
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
