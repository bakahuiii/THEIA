import { execFile } from 'node:child_process'
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

export const THEIA_MCP_CLIENT_SCHEMA = 'theia-mcp-client-setup/v1'
export const THEIA_MCP_SERVER_NAME = 'theia'

function isRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function unique(paths) {
  return [...new Set(paths.filter(Boolean).map((path) => resolve(path)))]
}

function commandAvailable(command) {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which'
  return new Promise((resolveAvailable) => {
    execFile(locator, [command], { windowsHide: true, timeout: 2_000 }, (error) => resolveAvailable(!error))
  })
}

async function selectedConfig({ candidates, command, checkCommand = commandAvailable }) {
  for (const candidate of candidates) {
    if (await exists(candidate.path)) return candidate.path
  }
  for (const candidate of candidates) {
    if (candidate.marker && await exists(candidate.marker)) return candidate.path
  }
  return await checkCommand(command) ? candidates[0]?.path || null : null
}

function mcpDefinition(scriptPath) {
  return { command: 'node', args: [scriptPath] }
}

function codexMcpBlock(scriptPath, eol) {
  return `[mcp_servers.${THEIA_MCP_SERVER_NAME}]${eol}`
    + `command = ${JSON.stringify('node')}${eol}`
    + `args = ${JSON.stringify([scriptPath])}${eol}${eol}`
}

export function upsertCodexMcpConfig(source, scriptPath) {
  const input = typeof source === 'string' ? source : ''
  const eol = input.includes('\r\n') ? '\r\n' : '\n'
  const block = codexMcpBlock(scriptPath, eol)
  const header = new RegExp(`^\\[mcp_servers\\.${THEIA_MCP_SERVER_NAME}\\]\\s*$`, 'm').exec(input)
  if (!header || header.index === undefined) {
    const prefix = input.trimEnd()
    return {
      changed: true,
      content: `${prefix ? `${prefix}${eol}${eol}` : ''}${block}`,
    }
  }
  const start = header.index
  const afterHeader = start + header[0].length
  const nextHeader = /^\[/m.exec(input.slice(afterHeader))
  const end = nextHeader ? afterHeader + nextHeader.index : input.length
  if (input.slice(start, end).trim() === block.trim()) return { changed: false, content: input }
  return {
    changed: true,
    content: `${input.slice(0, start)}${block}${input.slice(end)}`,
  }
}

export function upsertClaudeMcpConfig(source, scriptPath) {
  const input = typeof source === 'string' && source.trim() ? source : '{}'
  let parsed
  try {
    parsed = JSON.parse(input)
  } catch {
    throw new Error('Claude Code 配置不是有效 JSON，未做修改')
  }
  if (!isRecord(parsed)) throw new Error('Claude Code 配置根节点无效，未做修改')
  const servers = isRecord(parsed.mcpServers) ? parsed.mcpServers : {}
  const nextServer = mcpDefinition(scriptPath)
  if (sameJson(servers[THEIA_MCP_SERVER_NAME], nextServer)) return { changed: false, content: source || '{}\n' }
  return {
    changed: true,
    content: `${JSON.stringify({ ...parsed, mcpServers: { ...servers, [THEIA_MCP_SERVER_NAME]: nextServer } }, null, 2)}\n`,
  }
}

async function writeWithBackup(path, content) {
  const alreadyExists = await exists(path)
  await mkdir(dirname(path), { recursive: true })
  const backup = `${path}.theia-mcp.bak`
  if (alreadyExists) await copyFile(path, backup)
  const temporary = `${path}.theia-mcp-${randomUUID()}.tmp`
  try {
    await writeFile(temporary, content, 'utf8')
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
  return { backupCreated: alreadyExists }
}

async function updateClient({ client, path, scriptPath, updater }) {
  if (!path) return { client, status: 'not-found', changed: false, backupCreated: false }
  try {
    const source = await readFile(path, 'utf8').catch((error) => error?.code === 'ENOENT' ? '' : Promise.reject(error))
    const next = updater(source, scriptPath)
    if (!next.changed) return { client, status: 'already-configured', changed: false, backupCreated: false }
    const written = await writeWithBackup(path, next.content)
    return { client, status: source ? 'updated' : 'installed', changed: true, ...written }
  } catch {
    return { client, status: 'failed', changed: false, backupCreated: false }
  }
}

/**
 * Add or update the THEIA stdio server in the current user's Codex and
 * Claude Code configuration. Results deliberately omit configuration paths
 * and contents so the renderer cannot inspect unrelated local setup.
 */
export async function installTheiaMcpClients({
  homeDirectory,
  codexHome = process.env.CODEX_HOME || null,
  pluginPath,
  checkCommand = commandAvailable,
} = {}) {
  const home = typeof homeDirectory === 'string' && homeDirectory.trim() ? resolve(homeDirectory) : null
  const scriptPath = typeof pluginPath === 'string' && pluginPath.trim() ? resolve(pluginPath) : null
  if (!home || !scriptPath || !(await exists(scriptPath))) {
    return {
      schema: THEIA_MCP_CLIENT_SCHEMA,
      server: THEIA_MCP_SERVER_NAME,
      pluginAvailable: false,
      clients: [
        { client: 'codex', status: 'plugin-missing', changed: false, backupCreated: false },
        { client: 'claude-code', status: 'plugin-missing', changed: false, backupCreated: false },
      ],
    }
  }

  const defaultCodexPath = resolve(home, '.codex', 'config.toml')
  const configuredCodexPath = codexHome ? resolve(codexHome, 'config.toml') : null
  const codexPaths = unique([defaultCodexPath, configuredCodexPath])
  const claudePath = resolve(home, '.claude.json')
  const [codexPath, claudeConfig] = await Promise.all([
    selectedConfig({
      candidates: codexPaths.map((path) => ({ path, marker: dirname(path) })),
      command: 'codex',
      checkCommand,
    }),
    selectedConfig({
      candidates: [{ path: claudePath, marker: resolve(home, '.claude') }],
      command: 'claude',
      checkCommand,
    }),
  ])
  const [codex, claude] = await Promise.all([
    updateClient({ client: 'codex', path: codexPath, scriptPath, updater: upsertCodexMcpConfig }),
    updateClient({ client: 'claude-code', path: claudeConfig, scriptPath, updater: upsertClaudeMcpConfig }),
  ])
  return {
    schema: THEIA_MCP_CLIENT_SCHEMA,
    server: THEIA_MCP_SERVER_NAME,
    pluginAvailable: true,
    clients: [codex, claude],
  }
}
