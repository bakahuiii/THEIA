import test from 'node:test'
import assert from 'node:assert/strict'
import { AuthRequiredError } from '../core/source-client.mjs'
import { runTheolInteraction } from '../core/sync-assignment-runtime.mjs'

test('THEOL interaction releases its exclusive queue while recovering authentication', async () => {
  let pauseDepth = 0
  let attempts = 0
  let recoveries = 0
  const events = []
  const context = {
    pauseAssignmentScan() {
      pauseDepth += 1
      events.push('pause')
      let resumed = false
      return () => {
        if (resumed) return
        resumed = true
        pauseDepth -= 1
        events.push('resume')
      }
    },
    runTheolExclusive(operation) {
      events.push('exclusive')
      return operation()
    },
  }

  const result = await runTheolInteraction.call(context, async () => {
    attempts += 1
    if (attempts === 1) throw new AuthRequiredError('THEOL 作业', 'https://course.buct.edu.cn/meol/task')
    return 'prepared'
  }, {
    onAuthRequired: async () => {
      recoveries += 1
      assert.equal(pauseDepth, 0)
    },
  })

  assert.equal(result, 'prepared')
  assert.equal(attempts, 2)
  assert.equal(recoveries, 1)
  assert.equal(pauseDepth, 0)
  assert.deepEqual(events, ['pause', 'exclusive', 'resume', 'pause', 'exclusive', 'resume'])
})

test('THEOL interaction does not retry authentication failures without a recovery callback', async () => {
  let attempts = 0
  const context = {
    pauseAssignmentScan: () => () => {},
    runTheolExclusive: (operation) => operation(),
  }

  await assert.rejects(
    runTheolInteraction.call(context, async () => {
      attempts += 1
      throw new AuthRequiredError('THEOL 作业', 'https://course.buct.edu.cn/meol/task')
    }),
    { name: 'AuthRequiredError' },
  )
  assert.equal(attempts, 1)
})
