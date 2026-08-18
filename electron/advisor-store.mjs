import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export const ADVISOR_STORE_SCHEMA = 'theia-advisor-store/v2'
export const LEGACY_ADVISOR_STORE_SCHEMA = 'theia-advisor-store/v1'
export const ADVISOR_STORE_KEY_VERSION = 1
const ADVISOR_STORE_PROTECTION = 'safeStorage-aes-256-gcm'
const MASTER_KEY_BYTES = 32
const RECORD_NONCE_BYTES = 12

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function base64(value) {
  return Buffer.from(value).toString('base64')
}

function fromBase64(value) {
  if (typeof value !== 'string' || !value || !/^[a-zA-Z0-9+/]+={0,2}$/u.test(value)) throw new Error('invalid-base64')
  const decoded = Buffer.from(value, 'base64')
  if (!decoded.length || decoded.toString('base64') !== value) throw new Error('invalid-base64')
  return decoded
}

function recordAad(threadId) {
  return `${ADVISOR_STORE_SCHEMA}:${threadId}`
}

function validThread(value) {
  return value && typeof value === 'object' && typeof value.id === 'string'
    && typeof value.createdAt === 'string' && typeof value.updatedAt === 'string'
    && Array.isArray(value.messages) && value.messages.length <= 40
}

async function writeAtomic(path, contents) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  let handle
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await rename(temporary, path)
  } catch (error) {
    await handle?.close().catch(() => {})
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

// Advisor history must never join CampusState or a data-export package.
export class AdvisorStore {
  constructor({ root, storage, onDiagnostic = () => {} }) {
    this.file = resolve(root, 'advisor', 'threads.v1.dpapi.json')
    this.storage = storage
    this.onDiagnostic = onDiagnostic
    this.writeQueue = Promise.resolve()
    this.masterKey = null
  }

  available() {
    return Boolean(this.storage?.isEncryptionAvailable?.())
  }

  async load() {
    if (!existsSync(this.file)) return []
    if (!this.available()) {
      this.onDiagnostic('advisor.store_unavailable', { reason: 'encryption-unavailable' })
      return []
    }
    try {
      const envelope = JSON.parse(await readFile(this.file, 'utf8'))
      if (envelope?.schema === LEGACY_ADVISOR_STORE_SCHEMA) {
        const threads = this.loadLegacyRecords(envelope)
        if (threads.length) {
          try {
            await this.persist(threads)
          } catch (error) {
            this.onDiagnostic('advisor.store_migration_failed', { reason: error instanceof Error ? error.message : String(error) })
          }
        }
        return threads
      }
      if (envelope?.schema !== ADVISOR_STORE_SCHEMA || envelope.protection !== ADVISOR_STORE_PROTECTION
        || (envelope.keyVersion !== undefined && envelope.keyVersion !== ADVISOR_STORE_KEY_VERSION)
        || !Array.isArray(envelope.records)) {
        throw new Error('invalid-envelope')
      }
      this.masterKey = this.decryptMasterKey(envelope)
      const threads = []
      for (const record of envelope.records.slice(0, 100)) {
        try {
          const thread = this.decryptRecord(record)
          if (validThread(thread)) threads.push(thread)
        } catch { this.onDiagnostic('advisor.store_record_unreadable', {}) }
      }
      return threads
    } catch (error) {
      this.onDiagnostic('advisor.store_load_failed', { reason: error instanceof Error ? error.message : String(error) })
      return []
    }
  }

  persist(threads) {
    if (!this.available()) return Promise.resolve(false)
    const snapshot = Array.isArray(threads) ? structuredClone(threads).filter(validThread).slice(0, 100) : []
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      const masterKey = await this.ensureMasterKey()
      const records = snapshot.map((thread) => {
        return this.encryptRecord(thread, masterKey)
      })
      const masterKeyCiphertext = this.storage.encryptString(masterKey.toString('base64')).toString('base64')
      await writeAtomic(this.file, `${JSON.stringify({
          schema: ADVISOR_STORE_SCHEMA,
          protection: ADVISOR_STORE_PROTECTION,
          keyVersion: ADVISOR_STORE_KEY_VERSION,
          masterKeyCiphertext,
        masterKeyDigest: digest(masterKeyCiphertext),
        records,
      })}\n`)
      return true
    })
    return this.writeQueue
  }

  /** Re-encrypts every readable thread under a fresh DPAPI-wrapped key. */
  async rotateKey({ reason = 'manual' } = {}) {
    if (!this.available()) {
      this.onDiagnostic('advisor.store_key_rotation_skipped', { reason: 'encryption-unavailable' })
      return { rotated: false, records: 0 }
    }
    await this.flush()
    const threads = await this.load()
    this.masterKey = randomBytes(MASTER_KEY_BYTES)
    await this.persist(threads)
    await this.flush()
    this.onDiagnostic('advisor.store_key_rotated', { reason: String(reason).slice(0, 80), records: threads.length })
    return { rotated: true, records: threads.length }
  }

  loadLegacyRecords(envelope) {
    if (!Array.isArray(envelope.records)) throw new Error('invalid-envelope')
    const threads = []
    for (const record of envelope.records.slice(0, 100)) {
      if (!record || typeof record.ciphertext !== 'string' || record.ciphertextDigest !== digest(record.ciphertext)) continue
      try {
        const plain = this.storage.decryptString(Buffer.from(record.ciphertext, 'base64'))
        const thread = JSON.parse(plain)
        if (validThread(thread)) threads.push(thread)
      } catch { this.onDiagnostic('advisor.store_record_unreadable', {}) }
    }
    return threads
  }

  decryptMasterKey(envelope) {
    if (typeof envelope.masterKeyCiphertext !== 'string' || envelope.masterKeyDigest !== digest(envelope.masterKeyCiphertext)) {
      throw new Error('invalid-master-key')
    }
    const plaintext = this.storage.decryptString(fromBase64(envelope.masterKeyCiphertext))
    const key = fromBase64(plaintext)
    if (key.length !== MASTER_KEY_BYTES) throw new Error('invalid-master-key-length')
    return key
  }

  async ensureMasterKey() {
    if (this.masterKey) return this.masterKey
    if (existsSync(this.file)) {
      try {
        const envelope = JSON.parse(await readFile(this.file, 'utf8'))
        if (envelope?.schema === ADVISOR_STORE_SCHEMA) this.masterKey = this.decryptMasterKey(envelope)
      } catch {
        // A damaged or legacy envelope gets a fresh key. Existing readable
        // legacy records are migrated by load() before they are overwritten.
      }
    }
    this.masterKey ||= randomBytes(MASTER_KEY_BYTES)
    return this.masterKey
  }

  encryptRecord(thread, masterKey) {
    const nonce = randomBytes(RECORD_NONCE_BYTES)
    const aad = recordAad(thread.id)
    const cipher = createCipheriv('aes-256-gcm', masterKey, nonce)
    cipher.setAAD(Buffer.from(aad, 'utf8'))
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(thread), 'utf8'), cipher.final()])
    const authTag = cipher.getAuthTag()
    const encoded = {
      id: thread.id,
      aad,
      nonce: base64(nonce),
      ciphertext: base64(ciphertext),
      authTag: base64(authTag),
    }
    encoded.recordDigest = digest(JSON.stringify(encoded))
    return encoded
  }

  decryptRecord(record) {
    if (!record || typeof record.id !== 'string' || record.aad !== recordAad(record.id)) throw new Error('invalid-record-aad')
    if (typeof record.recordDigest !== 'string' || record.recordDigest !== digest(JSON.stringify({
      id: record.id,
      aad: record.aad,
      nonce: record.nonce,
      ciphertext: record.ciphertext,
      authTag: record.authTag,
    }))) throw new Error('invalid-record-digest')
    const nonce = fromBase64(record.nonce)
    const ciphertext = fromBase64(record.ciphertext)
    const authTag = fromBase64(record.authTag)
    if (nonce.length !== RECORD_NONCE_BYTES || authTag.length !== 16) throw new Error('invalid-record-parameters')
    const decipher = createDecipheriv('aes-256-gcm', this.masterKey, nonce)
    decipher.setAAD(Buffer.from(record.aad, 'utf8'))
    decipher.setAuthTag(authTag)
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
    const thread = JSON.parse(plain)
    if (thread?.id !== record.id) throw new Error('record-id-mismatch')
    return thread
  }

  async clear() {
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => rm(this.file, { force: true }))
    await this.writeQueue
  }

  async flush() {
    await this.writeQueue.catch(() => undefined)
  }
}
