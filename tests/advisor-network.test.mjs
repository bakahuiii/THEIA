import test from 'node:test'
import assert from 'node:assert/strict'
import { executeAdvisorNetworkRequest } from '../electron/advisor-network.mjs'

test('full-access network requests use a pinned public HTTPS endpoint without credentials or redirects', async () => {
  const requests = []
  let closed = false
  const result = await executeAdvisorNetworkRequest({
    url: 'https://public.example.test/api',
    method: 'POST',
    headers: { Accept: 'application/json', Authorization: 'Bearer user-provided-token' },
    body: '{"query":"test"}',
  }, {
    endpointFactory: async (origin) => {
      assert.equal(origin, 'https://public.example.test')
      return { dispatcher: { pinned: true }, close: async () => { closed = true } }
    },
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options })
      return new Response('{"ok":true}', {
        status: 201,
        headers: { 'content-type': 'application/json', location: 'https://other.example.test' },
      })
    },
  })

  assert.equal(requests.length, 1)
  assert.equal(requests[0].options.redirect, 'manual')
  assert.deepEqual(requests[0].options.dispatcher, { pinned: true })
  assert.equal(result.status, 201)
  assert.equal(result.body, '{"ok":true}')
  assert.equal(result.redirected, false)
  assert.equal(closed, true)
})

test('full-access network requests reject loopback, plain HTTP, and browser credential headers', async () => {
  await assert.rejects(
    executeAdvisorNetworkRequest({ url: 'http://public.example.test' }),
    /public HTTPS URL/u,
  )
  await assert.rejects(
    executeAdvisorNetworkRequest({ url: 'https://localhost/private' }),
    /loopback/u,
  )
  await assert.rejects(
    executeAdvisorNetworkRequest({ url: 'https://public.example.test', headers: { Cookie: 'sid=private' } }),
    /restricted header/u,
  )
})
