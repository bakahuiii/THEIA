import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  installTheiaMcpClients,
  upsertClaudeMcpConfig,
  upsertCodexMcpConfig,
} from '../electron/mcp-client-setup.mjs'

test('MCP config upserts replace only THEIA while retaining other Codex and Claude Code entries', async (context) => {
  const home = await mkdtemp(join(tmpdir(), 'theia-mcp-setup-'))
  context.after(() => rm(home, { recursive: true, force: true }))
  const pluginPath = join(home, 'theia-buct-advisor', 'scripts', 'lite-mcp.mjs')
  const codexPath = join(home, '.codex', 'config.toml')
  const claudePath = join(home, '.claude.json')
  await mkdir(join(home, '.codex'), { recursive: true })
  await mkdir(join(home, 'theia-buct-advisor', 'scripts'), { recursive: true })
  await writeFile(pluginPath, '#!/usr/bin/env node\n')
  await writeFile(codexPath, [
    'model = "gpt-5"',
    '',
    '[mcp_servers.theia]',
    'command = "node"',
    'args = ["H:\\\\work\\\\THEIA\\\\integration\\\\theia-mcp.mjs"]',
    '',
    '[mcp_servers.other]',
    'command = "other-mcp"',
    '',
  ].join('\n'))
  await writeFile(claudePath, `${JSON.stringify({
    unrelated: { keep: true },
    mcpServers: {
      'infinite-canvas': { command: 'canvas-mcp' },
      theia: { command: 'node', args: ['H:\\work\\THEIA\\integration\\theia-mcp.mjs'] },
    },
  }, null, 2)}\n`)

  const result = await installTheiaMcpClients({
    homeDirectory: home,
    codexHome: null,
    pluginPath,
    checkCommand: async () => false,
  })
  assert.deepEqual(result.clients.map((item) => item.status), ['updated', 'updated'])
  assert.equal(result.clients.every((item) => item.backupCreated), true)
  assert.equal(JSON.stringify(result).includes(home), false)

  const codex = await readFile(codexPath, 'utf8')
  assert.match(codex, /\[mcp_servers\.other\]/)
  assert.match(codex, /theia-buct-advisor/)
  assert.doesNotMatch(codex, /integration\\\\theia-mcp\.mjs/)
  const claude = JSON.parse(await readFile(claudePath, 'utf8'))
  assert.equal(claude.unrelated.keep, true)
  assert.deepEqual(claude.mcpServers['infinite-canvas'], { command: 'canvas-mcp' })
  assert.deepEqual(claude.mcpServers.theia, { command: 'node', args: [pluginPath] })
  await stat(`${codexPath}.theia-mcp.bak`)
  await stat(`${claudePath}.theia-mcp.bak`)

  const repeated = await installTheiaMcpClients({
    homeDirectory: home,
    codexHome: null,
    pluginPath,
    checkCommand: async () => false,
  })
  assert.deepEqual(repeated.clients.map((item) => item.status), ['already-configured', 'already-configured'])
})

test('MCP config helpers retain syntax and reject malformed Claude Code JSON without overwriting it', () => {
  const codex = upsertCodexMcpConfig('[mcp_servers.other]\ncommand = "other"\n', 'H:\\plugin\\lite-mcp.mjs')
  assert.equal(codex.changed, true)
  assert.match(codex.content, /\[mcp_servers\.other\]/)
  assert.match(codex.content, /\[mcp_servers\.theia\]/)
  const claude = upsertClaudeMcpConfig('{"mcpServers":{"other":{"command":"other"}}}', 'H:\\plugin\\lite-mcp.mjs')
  assert.equal(claude.changed, true)
  assert.deepEqual(JSON.parse(claude.content).mcpServers.other, { command: 'other' })
  assert.throws(() => upsertClaudeMcpConfig('{ malformed', 'H:\\plugin\\lite-mcp.mjs'), /有效 JSON/)
})

test('standard user Codex config wins over an optional CODEX_HOME config', async (context) => {
  const home = await mkdtemp(join(tmpdir(), 'theia-mcp-home-priority-'))
  context.after(() => rm(home, { recursive: true, force: true }))
  const pluginPath = join(home, 'theia-buct-advisor', 'scripts', 'lite-mcp.mjs')
  const standardConfig = join(home, '.codex', 'config.toml')
  const configuredHome = join(home, 'custom-codex-home')
  const configuredConfig = join(configuredHome, 'config.toml')
  await mkdir(join(home, '.codex'), { recursive: true })
  await mkdir(join(home, 'theia-buct-advisor', 'scripts'), { recursive: true })
  await mkdir(configuredHome, { recursive: true })
  await writeFile(pluginPath, '#!/usr/bin/env node\n')
  await writeFile(standardConfig, '[mcp_servers.other]\ncommand = "standard"\n')
  await writeFile(configuredConfig, '[mcp_servers.other]\ncommand = "configured"\n')

  const result = await installTheiaMcpClients({
    homeDirectory: home,
    codexHome: configuredHome,
    pluginPath,
    checkCommand: async () => false,
  })
  assert.equal(result.clients.find((item) => item.client === 'codex')?.status, 'updated')
  assert.match(await readFile(standardConfig, 'utf8'), /mcp_servers\.theia/)
  assert.doesNotMatch(await readFile(configuredConfig, 'utf8'), /mcp_servers\.theia/)
})
