import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const FORMAT = 'theia-credentials/v1'
const LEGACY_FORMAT = 'buct-credentials/v1'

export class CredentialVault {
  constructor(root, storage) {
    this.file = resolve(root, 'credentials.v1.dpapi.json')
    this.storage = storage
    this.writeQueue = Promise.resolve()
  }

  encryptionAvailable() {
    return Boolean(this.storage?.isEncryptionAvailable?.())
  }

  async readEnvelope() {
    if (!existsSync(this.file)) return null
    try {
      const envelope = JSON.parse(await readFile(this.file, 'utf8'))
      // Accept both current and legacy format identifiers
      if ((envelope?.format !== FORMAT && envelope?.format !== LEGACY_FORMAT) || typeof envelope.ciphertext !== 'string') return null
      return envelope
    } catch {
      return null
    }
  }

  async readCredentials() {
    const envelope = await this.readEnvelope()
    if (!envelope) return null
    if (!this.encryptionAvailable()) throw new Error('当前系统无法解密已保存的统一身份认证账号')
    try {
      const plaintext = this.storage.decryptString(Buffer.from(envelope.ciphertext, 'base64'))
      const credentials = JSON.parse(plaintext)
      if (typeof credentials?.username !== 'string' || typeof credentials?.password !== 'string') return null
      return { username: credentials.username, password: credentials.password, updatedAt: envelope.updatedAt }
    } catch {
      throw new Error('已保存的统一身份认证账号无法解密，请在设置中清除后重新保存')
    }
  }

  async status() {
    const envelope = await this.readEnvelope()
    if (!envelope) return { saved: false, encryptionAvailable: this.encryptionAvailable() }
    try {
      const credentials = await this.readCredentials()
      if (!credentials) return { saved: false, encryptionAvailable: this.encryptionAvailable() }
      return {
        saved: true,
        username: credentials.username,
        updatedAt: credentials.updatedAt,
        encryptionAvailable: true,
      }
    } catch (error) {
      return {
        saved: true,
        encryptionAvailable: this.encryptionAvailable(),
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async save({ username, password }) {
    const normalizedUsername = String(username || '').trim()
    const normalizedPassword = String(password || '')
    if (!normalizedUsername || normalizedUsername.length > 128) throw new Error('请输入有效的统一身份认证学号或工号')
    if (!normalizedPassword || normalizedPassword.length > 512) throw new Error('请输入有效的统一身份认证密码')
    if (!this.encryptionAvailable()) throw new Error('当前 Windows 账户不支持安全存储，THEIA 不会以明文保存密码')

    const updatedAt = new Date().toISOString()
    const ciphertext = this.storage.encryptString(JSON.stringify({ username: normalizedUsername, password: normalizedPassword }))
    const content = JSON.stringify({ format: FORMAT, protection: 'electron-safeStorage', updatedAt, ciphertext: ciphertext.toString('base64') }, null, 2) + '\n'
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.file), { recursive: true })
      const temp = `${this.file}.tmp`
      await writeFile(temp, content, { encoding: 'utf8', mode: 0o600 })
      await rm(this.file, { force: true })
      await rename(temp, this.file)
    })
    await this.writeQueue
    return { saved: true, username: normalizedUsername, updatedAt, encryptionAvailable: true }
  }

  async clear() {
    await rm(this.file, { force: true })
    return { saved: false, encryptionAvailable: this.encryptionAvailable() }
  }
}
