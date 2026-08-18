import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { CourseWorkQueue } from '../core/course-work-queue.mjs'

test('course-work queue deduplicates active jobs and persists terminal state', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-course-work-queue-'))
  try {
    const calls = []
    const queue = new CourseWorkQueue({ root, processor: async ({ job }) => { calls.push(job.id); return { status: 'done', message: 'ok' } } })
    await queue.load()
    const first = await queue.enqueue({ assignmentId: 'assignment-1', operation: 'model' })
    const duplicate = await queue.enqueue({ assignmentId: 'assignment-1', operation: 'model' })
    assert.equal(duplicate.deduplicated, true)
    await queue.waitForIdle()
    assert.equal(calls.length, 1)
    assert.equal(queue.snapshot().jobs[0].status, 'succeeded')
    const persisted = JSON.parse(await readFile(resolve(root, 'course-work', 'queue.json'), 'utf8'))
    assert.equal(persisted.jobs[0].status, 'succeeded')
    assert.equal(persisted.jobs[0].id, first.job.id)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('course-work queue requeues interrupted jobs and retries retryable failures', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-course-work-queue-recover-'))
  try {
    await writeFile(resolve(root, 'placeholder'), '')
    const queueDir = resolve(root, 'course-work')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(queueDir, { recursive: true })
    await writeFile(resolve(queueDir, 'queue.json'), JSON.stringify({
      schema: 'theia-course-work-queue/v1', enabled: true, updatedAt: new Date().toISOString(),
      jobs: [{ id: 'recover-1', assignmentId: 'assignment-2', operation: 'prepare', status: 'running', attempts: 0, maxAttempts: 2 }],
    }))
    let attempts = 0
    const queue = new CourseWorkQueue({
      root,
      processor: async () => { attempts += 1; if (attempts === 1) { const error = new Error('temporary'); error.retryable = true; throw error } return { status: 'ok' } },
      defaultMaxAttempts: 2,
    })
    await queue.load()
    await queue.waitForIdle()
    assert.equal(attempts, 2)
    assert.equal(queue.snapshot().jobs[0].status, 'succeeded')
  } finally { await rm(root, { recursive: true, force: true }) }
})
