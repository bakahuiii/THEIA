import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const FORMAT = 'theia-mail-credentials/v1'

export class MailVault {
  constructor(root, storage) {
    this.file = resolve(root, 'mail-credentials.v1.dpapi.json')
    this.storage = storage
    this.writeQueue = Promise.resolve()
  }

  encryptionAvailable() { return Boolean(this.storage?.isEncryptionAvailable?.()) }

  async readEnvelope() {
    if (!existsSync(this.file)) return null
    try {
      const envelope = JSON.parse(await readFile(this.file, 'utf8'))
      return envelope?.format === FORMAT && typeof envelope.ciphertext === 'string' ? envelope : null
    } catch { return null }
  }

  async readCredentials() {
    const envelope = await this.readEnvelope()
    if (!envelope) return null
    if (!this.encryptionAvailable()) throw new Error('当前系统无法解密已保存的邮箱账号')
    try {
      const value = JSON.parse(this.storage.decryptString(Buffer.from(envelope.ciphertext, 'base64')))
      if (typeof value?.username !== 'string' || typeof value?.password !== 'string') throw new Error('invalid credential payload')
      return {
        username: value.username,
        password: value.password,
        protocolPassword: typeof value.protocolPassword === 'string' ? value.protocolPassword : '',
        updatedAt: envelope.updatedAt,
      }
    } catch { throw new Error('已保存的邮箱账号无法解密，请在设置中清除后重新保存') }
  }

  async status() {
    const envelope = await this.readEnvelope()
    if (!envelope) return { saved: false, encryptionAvailable: this.encryptionAvailable() }
    try {
      const credentials = await this.readCredentials()
      return credentials
        ? { saved: true, username: credentials.username, updatedAt: credentials.updatedAt, passwordSaved: Boolean(credentials.password), protocolPasswordSaved: Boolean(credentials.protocolPassword), encryptionAvailable: true }
        : { saved: false, encryptionAvailable: this.encryptionAvailable() }
    } catch (error) {
      return { saved: true, encryptionAvailable: this.encryptionAvailable(), error: error instanceof Error ? error.message : String(error) }
    }
  }

  async save({ username, password, protocolPassword }) {
    const normalizedUsername = String(username || '').trim()
    if (!normalizedUsername || normalizedUsername.length > 320) throw new Error('请输入有效的邮箱账号')
    if (!this.encryptionAvailable()) throw new Error('当前 Windows 账户不支持安全保存，THEIA 不会以明文保存邮箱密码')
    // Serialize the full read-merge-write with clear() so an in-flight save
    // can never resurrect credentials after a clear() reported success, and a
    // queued clear can never be undone by a later save. The writeQueue entry
    // is assigned before the first await so ordering is deterministic.
    const pending = this.writeQueue.catch(() => {}).then(async () => {
      const existing = await this.readCredentials()
      const normalizedPassword = String(password || existing?.password || '')
      const normalizedProtocolPassword = String(protocolPassword || existing?.protocolPassword || '')
      if ((!normalizedPassword && !normalizedProtocolPassword) || normalizedPassword.length > 512 || normalizedProtocolPassword.length > 512) throw new Error('请输入邮箱密码或客户端授权密码')
      const updatedAt = new Date().toISOString()
      const ciphertext = this.storage.encryptString(JSON.stringify({ username: normalizedUsername, password: normalizedPassword, protocolPassword: normalizedProtocolPassword }))
      const content = JSON.stringify({ format: FORMAT, protection: 'electron-safeStorage', updatedAt, ciphertext: ciphertext.toString('base64') }, null, 2) + '\n'
      await mkdir(dirname(this.file), { recursive: true })
      const temporary = `${this.file}.tmp`
      await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 })
      await rm(this.file, { force: true })
      await rename(temporary, this.file)
      return { saved: true, username: normalizedUsername, updatedAt, passwordSaved: Boolean(normalizedPassword), protocolPasswordSaved: Boolean(normalizedProtocolPassword), encryptionAvailable: true }
    })
    this.writeQueue = pending.catch(() => undefined)
    return pending
  }

  async clear() {
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      await rm(this.file, { force: true })
    })
    await this.writeQueue
    return { saved: false, encryptionAvailable: this.encryptionAvailable() }
  }
}
