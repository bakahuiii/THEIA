import test from 'node:test'
import assert from 'node:assert/strict'
import { AuthRequiredError } from '../core/source-client.mjs'
import { createFitnessRuntime, isAuthenticationFailure, requestedFitnessYear } from '../electron/fitness-runtime.mjs'

test('fitness runtime validates archive keys and authentication failures independently', () => {
  assert.equal(requestedFitnessYear('2025-2026_1'), '2025-2026_1')
  assert.equal(requestedFitnessYear('2025'), null)
  assert.equal(isAuthenticationFailure(new AuthRequiredError('体测', 'https://tygl.buct.edu.cn/')), true)
  assert.equal(isAuthenticationFailure(new Error('network timeout')), false)
})

test('fitness runtime recognizes a live health-cloud page without opening a login window', async () => {
  const calls = []
  const runtime = createFitnessRuntime({
    schoolSession: {},
    loadFitnessBrowserPage: async (url) => {
      calls.push(url)
      return { url: 'https://tygl.buct.edu.cn/main.php?title=stu_ht_score', text: '<html>成绩</html>' }
    },
    loadFitnessPage: async () => ({ text: '' }),
    submitFitnessForm: async () => ({ text: '' }),
    openLoginWindow: async () => { throw new Error('login should not be needed') },
    assertAuthEpoch: () => {},
  })

  assert.equal(await runtime.fitnessSessionReady(), true)
  assert.equal(await runtime.ensureFitnessSession(), true)
  assert.deepEqual(calls, [
    'https://tygl.buct.edu.cn/',
    'https://tygl.buct.edu.cn/',
  ])
})
