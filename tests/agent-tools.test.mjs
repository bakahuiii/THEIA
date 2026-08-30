import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AGENT_COMMAND_OUTPUT_LIMIT,
  agentEncoding,
  agentPath,
  agentWebUrl,
  createAgentTools,
  executeAgentWebRequest,
  listAgentDirectory,
  readAgentFile,
  runAgentCommand,
  writeAgentFile,
} from '../electron/agent-tools.mjs'

async function withTempDirectory(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'theia-agent-tools-'))
  try {
    return await callback(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('agent file operations preserve encoding, offsets, and directory metadata', async () => {
  await withTempDirectory(async (directory) => {
    const nested = join(directory, 'nested', 'note.txt')
    const written = await writeAgentFile({ path: nested, content: 'alpha\n中文', createDirectories: true })
    assert.equal(written.bytesWritten, Buffer.byteLength('alpha\n中文'))

    const selected = await readAgentFile({ path: nested, offset: 6, length: Buffer.byteLength('中文') })
    assert.equal(selected.content, '中文')
    assert.equal(selected.truncated, false)

    const listed = await listAgentDirectory({ path: directory, recursive: true })
    assert.deepEqual(
      listed.entries.map(({ relativePath, type }) => ({ relativePath, type })),
      [
        { relativePath: 'nested', type: 'directory' },
        { relativePath: 'nested\\note.txt', type: 'file' },
      ],
    )
  })
})

test('agent tools keep validation and output limits at the module boundary', async () => {
  assert.equal(agentPath('  ./electron  ').endsWith('electron'), true)
  assert.equal(agentEncoding('utf-8'), 'utf8')
  assert.equal(agentEncoding('base64'), 'base64')
  assert.equal(agentWebUrl('https://example.com/path').protocol, 'https:')
  assert.throws(() => agentPath(''), /Agent path is invalid/)
  assert.throws(() => agentEncoding('utf16'), /Agent file encoding must be utf8 or base64/)
  assert.throws(() => agentWebUrl('file:///tmp/test'), /Agent web tools require an HTTP\(S\) URL/)

  const command = process.platform === 'win32'
    ? `Write-Output ('x' * ${AGENT_COMMAND_OUTPUT_LIMIT + 1})`
    : `printf '%*s' ${AGENT_COMMAND_OUTPUT_LIMIT + 1} '' | tr ' ' x`
  const result = await runAgentCommand({ command, timeoutMs: 10_000 })
  assert.equal(result.exitCode, 0)
  assert.equal(Buffer.byteLength(result.stdout), AGENT_COMMAND_OUTPUT_LIMIT)
  assert.equal(result.outputTruncated, true)
})

test('agent web request and webpage opener use the injected adapter', async () => {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'text/plain; charset=utf-8')
    response.end(`${request.method}:${request.url}`)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    const url = `http://127.0.0.1:${address.port}/health`
    const result = await executeAgentWebRequest({ url })
    assert.equal(result.status, 200)
    assert.equal(result.body, 'GET:/health')

    const opened = []
    const tools = createAgentTools({ openExternal: async (value) => opened.push(value) })
    assert.deepEqual(await tools.openWebpage({ url: 'https://example.com/' }), { opened: true, url: 'https://example.com/' })
    assert.deepEqual(opened, ['https://example.com/'])
    await assert.rejects(() => createAgentTools().openWebpage({ url: 'https://example.com/' }), /Agent webpage opener is unavailable/)
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

test('agent file write result is readable by the real filesystem', async () => {
  await withTempDirectory(async (directory) => {
    const target = join(directory, 'result.txt')
    await writeAgentFile({ path: target, content: 'ready' })
    assert.equal(await readFile(target, 'utf8'), 'ready')
  })
})
