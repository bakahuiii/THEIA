import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { request as httpRequest } from 'node:http'
import { emptyState } from '../core/schema.mjs'
import { startLocalApi } from '../core/local-api.mjs'

function rawHttpRequest({ port, path = '/', method = 'GET', headers = {}, body = null }) {
  return new Promise((resolveRequest, rejectRequest) => {
    const request = httpRequest({ hostname: '127.0.0.1', port, path, method, headers }, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolveRequest({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    request.on('error', rejectRequest)
    if (body) request.write(body)
    request.end()
  })
}

function makeStore() {
  const state = emptyState()
  state.courses = [{ id: 'c1', title: '离散数学' }]
  return {
    snapshot: () => state,
    storageSummary: () => ({ schema: 'theia-sharded-store/v1', revision: 'revision-1' }),
  }
}

async function withApi(run) {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-local-api-security-'))
  let api
  try {
    api = await startLocalApi({ store: makeStore(), root, preferredPort: 0, publishRuntime: true })
    await run(api)
  } finally {
    await api?.close()
    await rm(root, { recursive: true, force: true })
  }
}

test('local API rejects every read without a token (401)', async () => {
  await withApi(async (api) => {
    for (const path of ['/v1/health', '/v1/snapshot', '/v1/feed', '/v1/collections', '/v1/profile', '/v1/data-manifest']) {
      const response = await fetch(`${api.baseUrl}${path}`)
      assert.equal(response.status, 401, path)
      assert.deepEqual(await response.json(), { error: 'unauthorized' }, path)
    }
  })
})

test('local API rejects a wrong token and requires a minimum token length', async () => {
  await withApi(async (api) => {
    const wrong = await fetch(`${api.baseUrl}/v1/health`, { headers: { Authorization: `Bearer ${'x'.repeat(40)}` } })
    assert.equal(wrong.status, 401)
    const short = await fetch(`${api.baseUrl}/v1/health`, { headers: { Authorization: 'Bearer abc' } })
    assert.equal(short.status, 401)
    const headerlessQuery = await fetch(`${api.baseUrl}/v1/health?token=${api.token}`)
    assert.equal(headerlessQuery.status, 200)
  })
})

test('local API accepts the per-instance token via Authorization header or query', async () => {
  await withApi(async (api) => {
    assert.match(api.token, /^[A-Za-z0-9_-]{16,128}$/u)
    const header = await fetch(`${api.baseUrl}/v1/health`, { headers: { Authorization: `Bearer ${api.token}` } })
    assert.equal(header.status, 200)
    assert.equal((await header.json()).ok, true)
    const query = await fetch(`${api.baseUrl}/v1/health?token=${api.token}`)
    assert.equal(query.status, 200)
  })
})

test('local API rejects the null (file://) origin even with a valid token', async () => {
  await withApi(async (api) => {
    const actual = await rawHttpRequest({
      port: api.port,
      path: '/v1/snapshot',
      headers: { Host: `127.0.0.1:${api.port}`, Origin: 'null', Authorization: `Bearer ${api.token}` },
    })
    assert.equal(actual.status, 403)
    assert.deepEqual(JSON.parse(actual.body), { error: 'origin_not_allowed' })

    const preflight = await rawHttpRequest({
      port: api.port,
      path: '/v1/snapshot',
      method: 'OPTIONS',
      headers: { Host: `127.0.0.1:${api.port}`, Origin: 'null' },
    })
    assert.equal(preflight.status, 403)
    assert.deepEqual(JSON.parse(preflight.body), { error: 'origin_not_allowed' })
  })
})

test('local API rejects a hostile cross-site Origin on real requests (CSRF)', async () => {
  await withApi(async (api) => {
    const response = await rawHttpRequest({
      port: api.port,
      path: '/v1/agent/chat',
      method: 'POST',
      headers: {
        Host: `127.0.0.1:${api.port}`,
        Origin: 'http://attacker.example',
        Authorization: `Bearer ${api.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: 'wipe my data' }),
    })
    assert.equal(response.status, 403)
    assert.deepEqual(JSON.parse(response.body), { error: 'origin_not_allowed' })

    const preflight = await rawHttpRequest({
      port: api.port,
      path: '/v1/agent/chat',
      method: 'OPTIONS',
      headers: {
        Host: `127.0.0.1:${api.port}`,
        Origin: 'http://attacker.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    })
    assert.equal(preflight.status, 403)
  })
})

test('local API allows a loopback web origin and echoes it back on preflight', async () => {
  await withApi(async (api) => {
    const preflight = await rawHttpRequest({
      port: api.port,
      path: '/v1/snapshot',
      method: 'OPTIONS',
      headers: {
        Host: `127.0.0.1:${api.port}`,
        Origin: 'http://127.0.0.1:5174',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization,accept',
      },
    })
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers?.['access-control-allow-origin'] || null, 'http://127.0.0.1:5174')
    assert.match(String(preflight.headers?.['access-control-allow-headers'] || ''), /authorization/iu)

    const actual = await rawHttpRequest({
      port: api.port,
      path: '/v1/health',
      headers: { Host: `127.0.0.1:${api.port}`, Origin: 'http://localhost:5174', Authorization: `Bearer ${api.token}` },
    })
    assert.equal(actual.status, 200)
    assert.equal(actual.headers?.['access-control-allow-origin'] || null, 'http://localhost:5174')
  })
})

test('local API rejects a foreign Host header before any auth is attempted', async () => {
  await withApi(async (api) => {
    const response = await rawHttpRequest({
      port: api.port,
      path: '/v1/snapshot',
      headers: { Host: `attacker.example:${api.port}`, Origin: 'http://attacker.example', Authorization: `Bearer ${api.token}` },
    })
    assert.equal(response.status, 421)
    assert.deepEqual(JSON.parse(response.body), { error: 'host_not_allowed' })
  })
})

test('local API keeps the agent chat endpoint token-gated and method-restricted', async () => {
  await withApi(async (api) => {
    const noToken = await fetch(`${api.baseUrl}/v1/agent/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hi' }) })
    assert.equal(noToken.status, 401)

    const emptyMessage = await fetch(`${api.baseUrl}/v1/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.token}` },
      body: JSON.stringify({ message: '' }),
    })
    assert.equal(emptyMessage.status, 400)
    assert.deepEqual(await emptyMessage.json(), { error: 'question_required' })

    const put = await fetch(`${api.baseUrl}/v1/snapshot`, { method: 'PUT', headers: { Authorization: `Bearer ${api.token}` } })
    assert.equal(put.status, 405)
  })
})

test('local API writes the token into api-runtime.json and regenerates it per instance', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-local-api-token-'))
  let first
  let second
  try {
    first = await startLocalApi({ store: makeStore(), root, preferredPort: 0, publishRuntime: true })
    const runtimeFile = JSON.parse(await readFile(resolve(root, 'api-runtime.json'), 'utf8'))
    assert.equal(runtimeFile.token, first.token)
    assert.equal(runtimeFile.baseUrl, first.baseUrl)
    assert.equal(runtimeFile.host, '127.0.0.1')

    second = await startLocalApi({ store: makeStore(), root, preferredPort: 0, publishRuntime: true })
    assert.notEqual(first.token, second.token, 'tokens must be unique per instance')
    assert.notEqual(first.port, second.port)
    const runtimeFile2 = JSON.parse(await readFile(resolve(root, 'api-runtime.json'), 'utf8'))
    assert.equal(runtimeFile2.token, second.token)
  } finally {
    await first?.close()
    await second?.close()
    await rm(root, { recursive: true, force: true })
  }
})
