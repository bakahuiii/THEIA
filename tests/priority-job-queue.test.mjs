import test from 'node:test'
import assert from 'node:assert/strict'
import { createPriorityJobQueue } from '../electron/priority-job-queue.mjs'

test('priority queue preserves FIFO order within a priority', async () => {
  const queue = createPriorityJobQueue()
  const started = []
  const first = queue.enqueue(async () => {
    started.push('first')
    await Promise.resolve()
    return 'first-result'
  }, { priority: 0 })
  const low = queue.enqueue(() => {
    started.push('low')
    return 'low-result'
  }, { priority: 0 })
  const high = queue.enqueue(() => {
    started.push('high')
    return 'high-result'
  }, { priority: 10 })

  assert.deepEqual(await Promise.all([first, low, high]), ['first-result', 'low-result', 'high-result'])
  assert.deepEqual(started, ['first', 'high', 'low'])
  assert.equal(queue.pendingCount, 0)
  assert.equal(queue.running, false)
})

test('a synchronous job failure does not wedge the queue', async () => {
  const queue = createPriorityJobQueue()
  await assert.rejects(queue.enqueue(() => { throw new Error('boom') }), /boom/)
  assert.equal(await queue.enqueue(() => 'recovered'), 'recovered')
  assert.equal(queue.running, false)
})

test('pending jobs can be cancelled without cancelling the active job', async () => {
  const queue = createPriorityJobQueue()
  let release
  const active = queue.enqueue(() => new Promise((resolve) => { release = resolve }))
  const pending = queue.enqueue(() => 'should-not-run')
  const error = new Error('logout')
  assert.equal(queue.cancelPending(error), 1)
  await assert.rejects(pending, /logout/)
  release('active-result')
  assert.equal(await active, 'active-result')
})
