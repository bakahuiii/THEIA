import test from 'node:test'
import assert from 'node:assert/strict'
import {
  THEIA_MCP_PROTOCOL_VERSION,
  THEIA_MCP_TOOLS,
  createStdioMessageHandler,
  createTheiaMcpServer,
  createTheiaSnapshotProvider,
} from '../integration/theia-mcp.mjs'
import { FIXED_NOW, CURRENT_CAPTURE, domainOutcome, versionedState } from './fixtures/advisor-fixtures.mjs'

function response(body) {
  return { ok: true, status: 200, async json() { return structuredClone(body) } }
}

function fixtureSnapshot() {
  return versionedState({
    schema: 'theia-campus-data/v1',
    profile: { name: 'Test student', studentId: '20260001', major: 'Computer Science' },
    assignments: [{ id: 'assignment-1', title: 'Local assignment', courseName: 'Algorithms', dueAt: '2026-08-14T05:00:00.000Z', status: 'pending', capturedAt: CURRENT_CAPTURE }],
    emails: [{ id: 'mail-1', subject: 'Campus notice', from: 'notice@example.test', receivedAt: CURRENT_CAPTURE, snippet: 'Read this locally', body: 'Untrusted campus message body.' }],
    notices: [{ id: 'notice-1', title: 'Campus notice', summary: 'A local notice', publishedAt: CURRENT_CAPTURE, source: 'theol' }],
    grades: [
      { id: 'grade-failed', courseCode: 'MAT100', courseName: '数学', termId: '2025-3', credits: 3, score: 55, point: 0 },
      { id: 'grade-pass', courseCode: 'MAT100', courseName: '数学', termId: '2025-12', credits: 3, score: 90, point: 4 },
    ],
    academicProgress: {
      roots: [{ id: 'root', title: '专业必修', required: 3, earned: 3, courses: [{ id: 'req', courseCode: 'MAT100', title: '数学', credits: 3 }] }],
      categories: [],
    },
  }, {
    assignments: domainOutcome({ source: ['theol'] }),
    emails: domainOutcome({ source: ['imap'] }),
    notices: domainOutcome({ source: ['theol'] }),
    grades: domainOutcome({ emptyConfirmed: true }),
    exams: domainOutcome({ emptyConfirmed: true }),
    'academic-progress': domainOutcome({ emptyConfirmed: true }),
  })
}

test('THEIA snapshot provider pairs the current snapshot with a stable manifest revision', async () => {
  const snapshot = fixtureSnapshot().state
  const calls = []
  const provider = createTheiaSnapshotProvider({
    baseUrl: 'http://127.0.0.1:8766',
    fetchImpl: async (url, init) => {
      assert.equal(init.redirect, 'error')
      calls.push(String(url))
      if (calls.length === 1 || calls.length === 3) return response({ schema: 'theia-sharded-store/v1', revision: 'revision-current', updatedAt: CURRENT_CAPTURE })
      return response(snapshot)
    },
  })
  const result = await provider()
  assert.equal(result.revision, 'revision-current')
  assert.equal(result.state.schema, 'theia-campus-data/v1')
  assert.equal(calls.length, 3)
  assert.ok(calls.every((url) => url.startsWith('http://127.0.0.1:8766/')))
})

test('THEIA snapshot provider fails closed when a concurrent commit changes revision', async () => {
  const snapshot = fixtureSnapshot().state
  let count = 0
  const provider = createTheiaSnapshotProvider({
    baseUrl: 'http://127.0.0.1:8766',
    retries: 0,
    fetchImpl: async () => {
      count += 1
      if (count === 2) return response(snapshot)
      return response({ schema: 'theia-sharded-store/v1', revision: count === 1 ? 'revision-a' : 'revision-b' })
    },
  })
  await assert.rejects(provider(), /changed while it was being read/u)
})

test('THEIA snapshot provider bounds local API responses before parsing JSON', async () => {
  let cancelled = false
  const provider = createTheiaSnapshotProvider({
    baseUrl: 'http://127.0.0.1:8766',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => String(17 * 1024 * 1024) },
      body: { cancel: () => { cancelled = true; return Promise.resolve() } },
    }),
  })
  await assert.rejects(provider(), /response is too large/u)
  assert.equal(cancelled, true)
})

test('THEIA MCP negotiates protocol and exposes only bounded read-only tools', async () => {
  const server = createTheiaMcpServer({ getSnapshot: async () => fixtureSnapshot(), now: () => FIXED_NOW })
  const initialize = await server.dispatch({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: THEIA_MCP_PROTOCOL_VERSION, clientInfo: { name: 'test-client' } },
  })
  assert.equal(initialize.result.protocolVersion, THEIA_MCP_PROTOCOL_VERSION)
  assert.deepEqual(initialize.result.capabilities, { tools: { listChanged: false } })
  assert.equal(initialize.result.serverInfo.name, 'theia')
  assert.equal(server.isInitialized(), false)
  assert.equal((await server.dispatch({ jsonrpc: '2.0', id: 9, method: 'tools/list', params: {} })).error.code, -32002)
  await server.dispatch({ jsonrpc: '2.0', method: 'notifications/initialized' })
  assert.equal(server.isInitialized(), true)

  const listed = await server.dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  assert.deepEqual(listed.result.tools.map((tool) => tool.name), THEIA_MCP_TOOLS.map((tool) => tool.name))
  assert.ok(listed.result.tools.every((tool) => tool.annotations.readOnlyHint === true))
  assert.ok(listed.result.tools.every((tool) => !JSON.stringify(tool).match(/password|cookie|credential|browser|write/iu)))

  const searched = await server.dispatch({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'theia_search_campus_records', arguments: { domain: 'assignments', query: 'local' } },
  })
  assert.equal(searched.result.isError, false)
  assert.equal(searched.result.structuredContent.schema, 'theia-mcp/v1')
  assert.equal(searched.result.structuredContent.snapshotRevision, 'fixture-revision-1')
  assert.equal(searched.result.structuredContent.data.domain, 'assignments')
  assert.doesNotMatch(searched.result.content[0].text, /bodyHtml|manifestPath|sourceUrl/iu)

  const invalid = await server.dispatch({
    jsonrpc: '2.0', id: 4, method: 'tools/call',
    params: { name: 'theia_search_campus_records', arguments: { domain: 'assignments', unknown: 'reject-me' } },
  })
  assert.equal(invalid.result.isError, true)
  assert.match(invalid.result.content[0].text, /Unknown tool argument/iu)

  const unknownMethod = await server.dispatch({ jsonrpc: '2.0', id: 5, method: 'resources/list', params: {} })
  assert.equal(unknownMethod.error.code, -32601)
})

test('THEIA MCP rejects an unknown protocol version without advancing lifecycle', async () => {
  const server = createTheiaMcpServer({ getSnapshot: async () => fixtureSnapshot(), now: () => FIXED_NOW })
  const unsupported = await server.dispatch({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2099-01-01' },
  })
  assert.equal(unsupported.error.code, -32602)
  assert.match(unsupported.error.message, /not supported/u)
  assert.equal(server.isInitialized(), false)
  const supported = await server.dispatch({
    jsonrpc: '2.0', id: 2, method: 'initialize',
    params: { protocolVersion: THEIA_MCP_PROTOCOL_VERSION },
  })
  assert.equal(supported.result.protocolVersion, THEIA_MCP_PROTOCOL_VERSION)
})

test('THEIA MCP reads one bounded mailbox body only after a search result', async () => {
  const server = createTheiaMcpServer({ getSnapshot: async () => fixtureSnapshot(), now: () => FIXED_NOW })
  await server.dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } })
  await server.dispatch({ jsonrpc: '2.0', method: 'notifications/initialized' })
  const unauthorized = await server.dispatch({
    jsonrpc: '2.0', id: 8, method: 'tools/call',
    params: { name: 'theia_read_message', arguments: { recordId: 'record:mailbox:forged' } },
  })
  assert.equal(unauthorized.result.isError, true)
  assert.match(unauthorized.result.content[0].text, /selected by search/u)
  const searched = await server.dispatch({
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'theia_search_campus_records', arguments: { domain: 'mailbox' } },
  })
  const item = searched.result.structuredContent.data.items[0]
  assert.equal(item.bodyAvailable, true)
  const read = await server.dispatch({
    jsonrpc: '2.0', id: 3, method: 'tools/call',
    params: { name: 'theia_read_message', arguments: { recordId: item.recordId } },
  })
  assert.equal(read.result.isError, false)
  assert.equal(read.result.structuredContent.data.message.body, 'Untrusted campus message body.')
  assert.doesNotMatch(read.result.content[0].text, /bodyHtml|attachmentContent|path/iu)
})

test('THEIA MCP cancellation aborts an in-flight snapshot read', async () => {
  let begin
  let release
  const started = new Promise((resolve) => { begin = resolve })
  const blocked = new Promise((resolve) => { release = resolve })
  let observedSignal
  const server = createTheiaMcpServer({
    getSnapshot: async ({ signal } = {}) => {
      observedSignal = signal
      begin()
      await blocked
      return fixtureSnapshot()
    },
    now: () => FIXED_NOW,
  })
  await server.dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: THEIA_MCP_PROTOCOL_VERSION } })
  await server.dispatch({ jsonrpc: '2.0', method: 'notifications/initialized' })
  const pending = server.dispatch({
    jsonrpc: '2.0', id: 7, method: 'tools/call',
    params: { name: 'theia_get_data_health', arguments: {} },
  })
  await started
  await server.dispatch({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 7 } })
  assert.equal(observedSignal.aborted, true)
  release()
  const cancelled = await pending
  assert.equal(cancelled.result.isError, true)
  assert.match(cancelled.result.content[0].text, /cancelled/u)
})

test('THEIA MCP stdio keeps cancellation ahead of a slow tool response', async () => {
  let begin
  let release
  const started = new Promise((resolve) => { begin = resolve })
  const blocked = new Promise((resolve) => { release = resolve })
  let observedSignal
  const server = createTheiaMcpServer({
    getSnapshot: async ({ signal } = {}) => {
      observedSignal = signal
      begin()
      await blocked
      return fixtureSnapshot()
    },
    now: () => FIXED_NOW,
  })
  const output = []
  const handler = createStdioMessageHandler({ server, output: { write(value) { output.push(value) } } })
  await handler.onChunk(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: THEIA_MCP_PROTOCOL_VERSION } })}\n`)
  await handler.onChunk(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
  const callPromise = handler.onChunk(`${JSON.stringify({
    jsonrpc: '2.0', id: 8, method: 'tools/call',
    params: { name: 'theia_get_data_health', arguments: {} },
  })}\n`)
  await started
  await handler.onChunk(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 8 } })}\n`)
  assert.equal(observedSignal.aborted, true)
  release()
  await callPromise
  const responses = output.join('').trim().split('\n').map((line) => JSON.parse(line))
  const cancelled = responses.find((item) => item.id === 8)
  assert.equal(cancelled.result.isError, true)
  assert.match(cancelled.result.content[0].text, /cancelled/u)
})

test('THEIA MCP exposes the bounded academic-analysis DTO with opaque identifiers', async () => {
  const server = createTheiaMcpServer({ getSnapshot: async () => fixtureSnapshot(), now: () => FIXED_NOW })
  await server.dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: THEIA_MCP_PROTOCOL_VERSION } })
  await server.dispatch({ jsonrpc: '2.0', method: 'notifications/initialized' })
  const response = await server.dispatch({
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'theia_get_academic_analysis', arguments: {} },
  })
  const analysis = response.result.structuredContent.data
  assert.equal(response.result.isError, false)
  assert.equal(analysis.schema, 'theia-academic-analysis/v1')
  assert.equal(analysis.gpa.source, 'computed')
  assert.equal(analysis.creditLedger.earnedCredits, 3)
  assert.equal(analysis.courses[0].isRetake, true)
  assert.match(analysis.courses[0].courseKey, /^academic:[a-f0-9]{20}$/u)
  assert.doesNotMatch(response.result.content[0].text, /grade-failed|grade-pass/iu)
})

test('THEIA MCP stdio handler serializes JSON-RPC responses and keeps stdout clean', async () => {
  const server = createTheiaMcpServer({ getSnapshot: async () => fixtureSnapshot(), now: () => FIXED_NOW })
  const chunks = []
  const output = { write(value) { chunks.push(value) } }
  const handler = createStdioMessageHandler({ server, output })
  await handler.onChunk(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: THEIA_MCP_PROTOCOL_VERSION } })}\n`)
  await handler.onChunk(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
  await handler.onChunk(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`)
  const lines = chunks.join('').trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(lines.length, 2)
  assert.equal(lines[0].id, 1)
  assert.equal(lines[1].id, 2)
  assert.ok(lines.every((line) => line.jsonrpc === '2.0' && !line.error))
})
