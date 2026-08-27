import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeIrisSettings, renderCommandHelp, COMMAND_DEFINITIONS, COMMAND_ALIAS_RULES } from '../electron/iris-runtime/src/settings.mjs'
import { createCommandRouter } from '../electron/iris-runtime/src/commands.mjs'
import { IrisCompanion } from '../electron/iris-companion.mjs'

test('内置 Iris 默认只启用并显示 THEIA provider', () => {
  const settings = normalizeIrisSettings(null)
  assert.equal(settings.providers.theia, true)
  assert.equal(settings.providers.codex, true)
  assert.equal(settings.providers.hermes, true)
  assert.equal(settings.providers.claudeDesktop, true)
  assert.deepEqual(settings.visibleProviders, ['theia'])
  const help = renderCommandHelp(null, { visibleProviders: settings.visibleProviders })
  assert.match(help, /theia <二级指令>/)
  assert.doesNotMatch(help, /hyperion <二级指令>/)
  assert.doesNotMatch(help, /codex <要做的事>/)
  assert.equal(COMMAND_DEFINITIONS.some((item) => item.id === 'codex-task'), true)
  // All THEIA sub-commands (status/today/agent/motion/classroom) must be
  // registered so "帮助" and the control-panel command picker can show them.
  for (const id of ['theia-status', 'theia-today', 'theia-agent', 'theia-motion', 'theia-classroom']) {
    assert.equal(COMMAND_DEFINITIONS.some((item) => item.id === id), true, `missing definition: ${id}`)
    assert.equal(COMMAND_ALIAS_RULES[id] !== undefined, true, `missing alias rules: ${id}`)
  }
  assert.match(help, /theia classroom/)
  assert.match(help, /theia motion/)
})

test('内置 Iris 使用独立于外部 Iris 的控制台端口', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theia-iris-port-test-'))
  try {
    const companion = new IrisCompanion({ root, runtimeRoot: join(root, 'runtime') })
    assert.equal((await companion.status()).controlUrl, 'http://127.0.0.1:38641')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('隐藏 provider 仍可执行但不出现在帮助', async () => {
  let codexCalled = false
  let hyperionCalled = false
  const router = createCommandRouter({ summary: async () => { hyperionCalled = true; return {} } }, {
    settings: () => normalizeIrisSettings(null),
    theia: null,
    codex: { status: async () => { codexCalled = true; return { sessions: [], activeJobs: [] } } },
  })
  assert.doesNotMatch(await router('帮助'), /codex <要做的事>/)
  assert.doesNotMatch(await router('帮助'), /hyperion <二级指令>/)
  await router('codex status')
  await router('hyperion summary')
  assert.equal(codexCalled, true)
  assert.equal(hyperionCalled, true)
})

test('Iris QQ Secret 只写入加密信封且状态不回显 Secret', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theia-iris-test-'))
  const storage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, 'utf8'),
    decryptString: (value) => Buffer.from(value).toString('utf8'),
  }
  try {
    const companion = new IrisCompanion({ root, runtimeRoot: join(root, 'runtime'), storage })
    await companion.writeSettings({ visibleProviders: ['theia'] })
    await writeFile(join(root, 'iris', '.iris-settings.json'), JSON.stringify({ providers: { codex: false }, visibleProviders: ['theia'] }))
    await companion.writeSettings({ visibleProviders: ['theia'] })
    assert.equal((await companion.status()).providers.codex, false)
    await companion.saveCredentials({ appId: 'app-id', appSecret: 'super-secret', ownerOpenid: 'owner' })
    const envelope = await readFile(join(root, 'iris-credentials.v1.dpapi.json'), 'utf8')
    assert.doesNotMatch(envelope, /super-secret/)
    const status = await companion.status()
    assert.equal(status.configured, true)
    assert.equal(Object.hasOwn(status, 'appSecret'), false)
    await companion.clearCredentials()
    assert.equal((await companion.status()).configured, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
