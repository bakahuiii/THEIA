import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createLocalDocumentsReader } from '../integration/local-docs.mjs'
import { createTheiaMcpServer } from '../integration/theia-mcp.mjs'

test('MCP local document tools do not require a campus API snapshot', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'theia-mcp-docs-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'reference.html'), '<h1>参考</h1><script>ignore()</script><p>正文</p>')
  const server = createTheiaMcpServer({
    getSnapshot: async () => { throw new Error('campus API must not be called') },
    localDocuments: createLocalDocumentsReader({ rootDir: root }),
  })
  await server.dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
  await server.dispatch({ jsonrpc: '2.0', method: 'notifications/initialized' })
  const listed = await server.dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'theia_list_local_documents', arguments: {} } })
  assert.equal(listed.result.isError, false)
  const item = listed.result.structuredContent.data.documents[0]
  const read = await server.dispatch({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'theia_read_local_document', arguments: { documentId: item.documentId } } })
  assert.equal(read.result.isError, false)
  assert.match(read.result.structuredContent.data.content, /参考/u)
  assert.match(read.result.structuredContent.data.content, /正文/u)
  assert.doesNotMatch(read.result.structuredContent.data.content, /script|ignore/u)
  assert.equal(read.result.structuredContent.snapshotRevision, null)
})
