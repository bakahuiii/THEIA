import test from 'node:test'
import assert from 'node:assert/strict'
import { createAuthActorManager } from '../electron/auth-actor-manager.mjs'

test('auth actor manager deduplicates sources and serializes lifecycles', async () => {
  let epoch = 1
  const order = []
  const manager = createAuthActorManager({
    sources: ['jwglxt', 'theol'],
    getEpoch: () => epoch,
    run: async (actor) => {
      order.push(`start:${actor.source}`)
      actor.resolveOpened()
      await new Promise((resolve) => setTimeout(resolve, 5))
      order.push(`end:${actor.source}`)
      actor.resolveClosed()
    },
  })
  const first = manager.create('jwglxt', { background: true })
  const duplicate = manager.create('jwglxt', { background: false })
  assert.equal(first, duplicate)
  const second = manager.create('theol', { background: true })
  await Promise.all([first.opened, second.opened])
  await Promise.all([first.lifecycle, second.lifecycle])
  assert.deepEqual(order, ['start:jwglxt', 'end:jwglxt', 'start:theol', 'end:theol'])
  assert.equal(manager.pendingSources.size, 0)
  assert.equal(manager.values().length, 0)
  epoch += 1
  assert.equal(manager.isCurrent(first), false)
})

test('auth actor manager invalidation resolves waiting callers and removes pending opens', async () => {
  let epoch = 1
  let runStarted
  const started = new Promise((resolve) => { runStarted = resolve })
  const manager = createAuthActorManager({
    sources: ['jwglxt'],
    getEpoch: () => epoch,
    run: async () => {
      runStarted()
      await new Promise((resolve) => setTimeout(resolve, 20))
    },
  })
  const pending = [{ source: 'jwglxt', url: 'https://example.test' }]
  const actor = manager.create('jwglxt')
  await started
  manager.invalidate(actor, { reason: 'logout', pendingSourceOpens: pending })
  assert.equal(actor.invalidated, true)
  assert.deepEqual(pending, [])
  await actor.lifecycle
  assert.equal(manager.get('jwglxt'), null)
})
