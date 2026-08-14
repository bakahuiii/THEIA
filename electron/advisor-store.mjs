import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export const ADVISOR_STORE_SCHEMA = 'theia-advisor-store/v1'

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
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
      if (envelope?.schema !== ADVISOR_STORE_SCHEMA || !Array.isArray(envelope.records)) throw new Error('invalid-envelope')
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
    } catch (error) {
      this.onDiagnostic('advisor.store_load_failed', { reason: error instanceof Error ? error.message : String(error) })
      return []
    }
  }

  persist(threads) {
    if (!this.available()) return Promise.resolve(false)
    const snapshot = Array.isArray(threads) ? structuredClone(threads).filter(validThread).slice(0, 100) : []
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      const records = snapshot.map((thread) => {
        const ciphertext = this.storage.encryptString(JSON.stringify(thread)).toString('base64')
        return { ciphertext, ciphertextDigest: digest(ciphertext) }
      })
      await writeAtomic(this.file, `${JSON.stringify({ schema: ADVISOR_STORE_SCHEMA, records })}\n`)
      return true
    })
    return this.writeQueue
  }

  async clear() {
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => rm(this.file, { force: true }))
    await this.writeQueue
  }
}
