import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const PROVIDERS = Object.freeze(['theia', 'hyperion', 'selene', 'codex', 'hermes', 'claude'])
const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  visibleProviders: ['theia'],
  providers: {
    theia: true,
    hyperion: true,
    selene: true,
    codex: true,
    hermes: true,
    claudeDesktop: true,
  },
  // The standalone Iris daemon owns 38640. Keep THEIA's embedded companion
  // on a separate default port so opening its panel cannot attach to it.
  guiPort: 38641,
})

const INHERITED_ENV_KEYS = Object.freeze([
  'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'PATH', 'PATHEXT',
  'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'ComSpec', 'ProgramFiles',
  'ProgramW6432', 'ProgramData', 'PROCESSOR_ARCHITECTURE', 'PROCESSOR_ARCHITEW6432',
  'IRIS_CODEX_HOME', 'IRIS_CODEX_ENTRY', 'IRIS_CODEX_WORKSPACE', 'IRIS_CODEX_WORKSPACE_MAP',
  'IRIS_CODEX_DESKTOP_STATE', 'IRIS_CODEX_IPC_PIPE', 'IRIS_CODEX_DESKTOP_HOST_ID',
  'IRIS_CODEX_DESKTOP_PERMISSIONS', 'IRIS_CODEX_DESKTOP_APPROVAL_POLICY',
  'IRIS_CLAUDE_DESKTOP_HOME', 'IRIS_CLAUDE_WORKSPACE', 'HYPERION_API', 'SELENE_API',
])

function providerList(value, fallback = DEFAULT_SETTINGS.visibleProviders) {
  const source = Array.isArray(value) ? value : fallback
  const result = []
  for (const item of source) {
    const id = String(item ?? '').trim().toLowerCase()
    if (!PROVIDERS.includes(id) || result.includes(id)) continue
    result.push(id)
  }
  return result.length ? result : [...fallback]
}

function normalizedSettings(value) {
  const visibleProviders = providerList(value?.visibleProviders)
  return {
    enabled: value?.enabled === true,
    visibleProviders,
    providers: {
      theia: value?.providers?.theia !== false,
      hyperion: value?.providers?.hyperion !== false,
      selene: value?.providers?.selene !== false,
      codex: value?.providers?.codex !== false,
      hermes: value?.providers?.hermes !== false,
      claudeDesktop: value?.providers?.claudeDesktop !== false && value?.providers?.claude !== false,
    },
    guiPort: Number.isInteger(Number(value?.guiPort)) && Number(value.guiPort) >= 1024 && Number(value.guiPort) <= 65535
      ? Number(value.guiPort)
      : DEFAULT_SETTINGS.guiPort,
  }
}

function safeText(value, maximum) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, maximum)
}

function validSecret(value, maximum) {
  const text = String(value ?? '')
  return text.length > 0 && text.length <= maximum ? text : ''
}

async function portAvailable(port) {
  const server = createServer()
  return new Promise((resolvePort) => {
    const finish = (available) => {
      server.removeAllListeners()
      try { server.close() } catch { /* not listening */ }
      resolvePort(available)
    }
    server.once('error', () => finish(false))
    server.listen(port, '127.0.0.1', () => finish(true))
  })
}

async function chooseControlPort(preferred) {
  // 38640 is reserved by the standalone Iris installation. Treat an older
  // embedded configuration that still points there as a legacy value.
  const candidate = preferred === 38640 ? DEFAULT_SETTINGS.guiPort : preferred
  if (await portAvailable(candidate)) return candidate
  const server = createServer()
  return new Promise((resolvePort, rejectPort) => {
    server.once('error', rejectPort)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => error ? rejectPort(error) : resolvePort(port || preferred))
    })
  })
}

export class IrisCompanion {
  constructor({ root, runtimeRoot, storage, processEnv = process.env } = {}) {
    this.root = resolve(root)
    this.runtimeRoot = resolve(runtimeRoot)
    this.irisRoot = resolve(this.root, 'iris')
    this.settingsFile = resolve(this.root, 'iris-companion-settings.v1.json')
    this.credentialsFile = resolve(this.root, 'iris-credentials.v1.dpapi.json')
    this.storage = storage
    this.processEnv = processEnv
    this.child = null
    this.startedAt = null
    this.lastExit = null
    this.lastError = ''
    this.controlPort = null
    this.writeQueue = Promise.resolve()
  }

  async readSettings() {
    let companion = {}
    let iris = {}
    try {
      companion = JSON.parse(await readFile(this.settingsFile, 'utf8'))
    } catch { /* first run */ }
    try {
      iris = JSON.parse(await readFile(resolve(this.irisRoot, '.iris-settings.json'), 'utf8'))
    } catch { /* control panel has not saved yet */ }
    return normalizedSettings({
      ...companion,
      ...iris,
      providers: { ...companion.providers, ...iris.providers },
    })
  }

  async writeSettings(value) {
    const current = await this.readSettings()
    const next = normalizedSettings({
      ...current,
      ...value,
      providers: { ...current.providers, ...value?.providers },
    })
    const content = `${JSON.stringify(next, null, 2)}\n`
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      await mkdir(dirname(this.settingsFile), { recursive: true })
      const temporary = `${this.settingsFile}.${process.pid}.tmp`
      await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 })
      await rm(this.settingsFile, { force: true })
      await rename(temporary, this.settingsFile)
      await mkdir(this.irisRoot, { recursive: true })
      let irisSettings = {}
      try { irisSettings = JSON.parse(await readFile(resolve(this.irisRoot, '.iris-settings.json'), 'utf8')) } catch { /* first run */ }
      const irisProviders = value?.providers
        ? { ...irisSettings.providers, ...value.providers }
        : (irisSettings.providers || next.providers)
      await writeFile(resolve(this.irisRoot, '.iris-settings.json'), `${JSON.stringify({
        ...irisSettings,
        providers: irisProviders,
        visibleProviders: next.visibleProviders,
        guiPort: next.guiPort,
      }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    })
    await this.writeQueue
    return next
  }

  encryptionAvailable() {
    return Boolean(this.storage?.isEncryptionAvailable?.())
  }

  async readCredentials() {
    if (!existsSync(this.credentialsFile)) return null
    try {
      const envelope = JSON.parse(await readFile(this.credentialsFile, 'utf8'))
      if (envelope?.format !== 'theia-iris-credentials/v1' || typeof envelope.ciphertext !== 'string') return null
      if (!this.encryptionAvailable()) return null
      const value = JSON.parse(this.storage.decryptString(Buffer.from(envelope.ciphertext, 'base64')))
      const appId = safeText(value?.appId, 128)
      const appSecret = validSecret(value?.appSecret, 512)
      const ownerOpenid = safeText(value?.ownerOpenid, 256)
      return appId && appSecret ? { appId, appSecret, ownerOpenid } : null
    } catch {
      return null
    }
  }

  async saveCredentials({ appId, appSecret, ownerOpenid = '' } = {}) {
    const normalizedAppId = safeText(appId, 128)
    const normalizedSecret = validSecret(appSecret, 512)
    if (!normalizedAppId || !normalizedSecret) throw new Error('请输入有效的 QQ App ID 和 AppSecret')
    if (!this.encryptionAvailable()) throw new Error('当前 Windows 账户不支持安全存储，THEIA 不会以明文保存 QQ Secret')
    const ciphertext = this.storage.encryptString(JSON.stringify({
      appId: normalizedAppId,
      appSecret: normalizedSecret,
      ownerOpenid: safeText(ownerOpenid, 256),
    }))
    const envelope = {
      format: 'theia-iris-credentials/v1',
      protection: 'electron-safeStorage',
      updatedAt: new Date().toISOString(),
      ciphertext: ciphertext.toString('base64'),
    }
    await mkdir(dirname(this.credentialsFile), { recursive: true })
    const temporary = `${this.credentialsFile}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rm(this.credentialsFile, { force: true })
    await rename(temporary, this.credentialsFile)
    return { saved: true, encryptionAvailable: true }
  }

  async clearCredentials() {
    await rm(this.credentialsFile, { force: true })
    return { saved: false, encryptionAvailable: this.encryptionAvailable() }
  }

  async status() {
    const settings = await this.readSettings()
    const credentials = await this.readCredentials()
    return {
      schema: 'theia-iris-companion/v1',
      enabled: settings.enabled,
      providers: settings.providers,
      visibleProviders: settings.visibleProviders,
      controlUrl: `http://127.0.0.1:${this.controlPort || settings.guiPort}`,
      configured: Boolean(credentials),
      encryptionAvailable: this.encryptionAvailable(),
      running: Boolean(this.child && !this.child.killed),
      pid: this.child?.pid ?? null,
      startedAt: this.startedAt,
      lastExit: this.lastExit,
      lastError: this.lastError || null,
    }
  }

  async start({ force = false } = {}) {
    if (this.child && !this.child.killed) return this.status()
    let settings = await this.readSettings()
    if (!settings.enabled && !force) return this.status()
    if (force && !settings.enabled) {
      settings = await this.writeSettings({ ...settings, enabled: true })
    }
    const credentials = await this.readCredentials()
    if (!credentials) {
      this.lastError = '未配置 QQ Bot 凭据'
      return this.status()
    }
    await mkdir(this.irisRoot, { recursive: true })
    const controlPort = await chooseControlPort(settings.guiPort)
    if (controlPort !== settings.guiPort) {
      settings = await this.writeSettings({ ...settings, guiPort: controlPort })
    } else {
      await this.writeSettings(settings)
    }
    const entry = resolve(this.runtimeRoot, 'src', 'index.mjs')
    const env = {
      ...Object.fromEntries(INHERITED_ENV_KEYS.filter((key) => this.processEnv[key] !== undefined).map((key) => [key, this.processEnv[key]])),
      IRIS_HOME: this.irisRoot,
      THEIA_DATA_ROOT: this.root,
      QQBOT_APP_ID: credentials.appId,
      QQBOT_APP_SECRET: credentials.appSecret,
      ...(credentials.ownerOpenid ? { QQBOT_OWNER_OPENID: credentials.ownerOpenid } : {}),
    }
    const child = spawn(process.execPath, [entry], {
      cwd: this.runtimeRoot,
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child
    this.startedAt = new Date().toISOString()
    this.lastExit = null
    this.lastError = ''
    const capture = (chunk) => {
      const text = safeText(chunk, 800)
      const control = text.match(/control GUI listening at http:\/\/127\.0\.0\.1:(\d+)/i)
      if (control) this.controlPort = Number(control[1])
      // The child process has access to credentials via environment variables.
      // Only keep an explicit control signal; never store arbitrary stdout/stderr
      // text that could contain secret values.
      if (control) this.lastError = ''
    }
    child.stdout?.on('data', capture)
    child.stderr?.on('data', capture)
    child.once('error', (error) => {
      this.lastError = safeText(error?.message, 800)
      this.lastExit = { code: null, signal: 'spawn-error', at: new Date().toISOString() }
      if (this.child === child) this.child = null
    })
    child.once('exit', (code, signal) => {
      this.lastExit = { code, signal, at: new Date().toISOString() }
      this.controlPort = null
      if (this.child === child) this.child = null
    })
    return this.status()
  }

  async stop({ disable = false } = {}) {
    if (disable) {
      const settings = await this.readSettings()
      if (settings.enabled) await this.writeSettings({ ...settings, enabled: false })
    }
    const child = this.child
    if (!child) return this.status()
    child.kill()
    await new Promise((resolvePromise) => {
      const timer = setTimeout(resolvePromise, 2_000)
      child.once('exit', () => { clearTimeout(timer); resolvePromise() })
    })
    if (this.child === child) this.child = null
    return this.status()
  }

  async restart() {
    await this.stop()
    return this.start({ force: true })
  }

  async shutdown() {
    await this.stop()
  }
}
