import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ADVISOR_AGENT_TOOL_NAMES,
  ADVISOR_FULL_ACCESS_TOOL_NAMES,
  ADVISOR_READ_ONLY_TOOL_NAMES,
  advisorPermissionCapabilities,
  createAdvisorFullAccessTools,
  createAdvisorReadOnlyTools,
  normalizeAdvisorPermissionMode,
  parseAdvisorAgentTurn,
  runReadOnlyAdvisorAgent,
} from '../core/advisor/index.mjs'

const REVISION = 'permission-revision-001'

function readOnlyTools() {
  return createAdvisorReadOnlyTools({
    snapshotRevision: REVISION,
    dataQuality: { schema: 'quality', domains: {} },
    claims: [],
    urgentItems: [],
    risks: [],
  })
}

test('permission mode defaults to controlled read-only while full access adds general local tools', () => {
  assert.equal(normalizeAdvisorPermissionMode(undefined), 'read-only')
  assert.equal(normalizeAdvisorPermissionMode('unexpected'), 'read-only')
  assert.equal(normalizeAdvisorPermissionMode('full-access'), 'full-access')
  assert.ok(advisorPermissionCapabilities('read-only').includes('campus-data:read'))
  assert.ok(advisorPermissionCapabilities('read-only').includes('settings:write'))
  assert.ok(advisorPermissionCapabilities('full-access').includes('network:public-http'))
  assert.ok(advisorPermissionCapabilities('full-access').includes('filesystem:write'))
  assert.ok(ADVISOR_AGENT_TOOL_NAMES.includes('network_request'))
  assert.equal(ADVISOR_READ_ONLY_TOOL_NAMES.includes('network_request'), true)
  assert.equal(ADVISOR_READ_ONLY_TOOL_NAMES.includes('read_file'), false)
  assert.ok(ADVISOR_FULL_ACCESS_TOOL_NAMES.includes('read_file'))
})

test('the agent executes a typed full-access tool only in an explicitly full session', async () => {
  const writes = []
  const fullTools = createAdvisorFullAccessTools({
    tools: readOnlyTools(),
    snapshotRevision: REVISION,
    operations: {
      async updateSettings({ settings }) {
        writes.push(settings)
        return { updated: true, autoSync: settings.autoSync }
      },
    },
  })
  const toolCall = JSON.stringify({
    schema: 'theia-advisor-tool-call/v1',
    tool: 'update_theia_settings',
    args: { settings: { autoSync: true, modelBaseUrl: 'https://ignored.example' } },
  })
  const replies = [toolCall, '已开启自动同步。']
  const result = await runReadOnlyAdvisorAgent({
    model: 'permission-test-model',
    tools: fullTools,
    permissionMode: 'full-access',
    messages: [{ role: 'user', content: '开启自动同步。' }],
    provider: { async generateStream() { return { text: replies.shift() } } },
  })

  assert.deepEqual(result.calls.map((call) => call.name), ['update_theia_settings'])
  assert.deepEqual(writes, [{ autoSync: true }])
  assert.equal(result.text, '已开启自动同步。')
})

test('a general filesystem protocol call requires full access', () => {
  const protocol = JSON.stringify({
    schema: 'theia-advisor-tool-call/v1', tool: 'read_file', args: { path: 'C:\\example.txt' },
  })
  assert.equal(parseAdvisorAgentTurn(protocol).kind, 'invalid-tool')
  assert.equal(parseAdvisorAgentTurn(protocol, { toolNames: ADVISOR_AGENT_TOOL_NAMES }).kind, 'tool')
})

test('full access exposes typed filesystem, command, and web host operations', async () => {
  const received = []
  const fullTools = createAdvisorFullAccessTools({
    tools: readOnlyTools(),
    snapshotRevision: REVISION,
    permissionMode: 'full-access',
    operations: {
      async writeFile(args) {
        received.push(args)
        return { path: args.path, bytesWritten: Buffer.byteLength(args.content, 'utf8') }
      },
    },
  })
  const replies = [JSON.stringify({
    schema: 'theia-advisor-tool-call/v1',
    tool: 'write_file',
    args: { path: 'C:\\Users\\student\\Desktop\\index.html', content: '<h1>Profile</h1>', createDirectories: true },
  }), '页面已经写入桌面。']
  const result = await runReadOnlyAdvisorAgent({
    model: 'permission-test-model',
    tools: fullTools,
    permissionMode: 'full-access',
    messages: [{ role: 'user', content: '创建网页。' }],
    provider: { async generateStream() { return { text: replies.shift() } } },
  })
  assert.deepEqual(received, [{
    path: 'C:\\Users\\student\\Desktop\\index.html',
    content: '<h1>Profile</h1>',
    encoding: undefined,
    createDirectories: true,
    signal: undefined,
  }])
  assert.deepEqual(result.calls.map((call) => call.name), ['write_file'])
})
