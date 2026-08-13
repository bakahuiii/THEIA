import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { modelServiceIdentity, modelServiceOrigin } from '../core/model-url-policy.mjs'

const FORMAT = 'theia-model-key/v3'
const LEGACY_FORMATS = new Set(['theia-model-key/v1', 'theia-model-key/v2'])

async function writeAtomic(path, payload, label) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.${label}.tmp`
  let handle
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(payload, 'utf8')
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

export class ModelVault {
  constructor(root, storage) {
    this.file = resolve(root, 'model-api-key.v1.dpapi.json')
    this.transactionFile = resolve(root, 'model-config-transaction.v1.json')
    this.storage = storage
    this.writeQueue = Promise.resolve()
    this.configTransactionQueue = Promise.resolve()
  }

  encryptionAvailable() {
    return Boolean(this.storage?.isEncryptionAvailable?.())
  }

  runConfigTransaction(operation) {
    if (typeof operation !== 'function') throw new TypeError('Model configuration transaction must be a function')
    const pending = this.configTransactionQueue.catch(() => {}).then(operation)
    this.configTransactionQueue = pending
    return pending
  }

  async readEnvelope() {
    if (!existsSync(this.file)) return null
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8'))
      return (value?.format === FORMAT || LEGACY_FORMATS.has(value?.format)) && typeof value.ciphertext === 'string' ? value : null
    } catch {
      return null
    }
  }

  async readBinding({ allowPendingTransaction = false } = {}) {
    if (!allowPendingTransaction && existsSync(this.transactionFile)) {
      throw new Error('Model configuration recovery is pending; restart THEIA before using the saved API key')
    }
    const envelope = await this.readEnvelope()
    if (!envelope) return null
    if (LEGACY_FORMATS.has(envelope.format)) {
      throw new Error('Re-enter the saved model API key to bind it to this exact service address')
    }
    if (!this.encryptionAvailable()) throw new Error('Current Windows account cannot decrypt the saved model API key')
    try {
      const value = JSON.parse(this.storage.decryptString(Buffer.from(envelope.ciphertext, 'base64')))
      const apiKey = typeof value?.apiKey === 'string' ? value.apiKey : ''
      if (!apiKey || apiKey.length > 2048) return null
      const serviceIdentity = modelServiceIdentity(value.serviceIdentity)
      if (serviceIdentity !== value.serviceIdentity) return null
      return { apiKey, serviceIdentity, origin: modelServiceOrigin(serviceIdentity), updatedAt: envelope.updatedAt }
    } catch {
      throw new Error('The saved model API key cannot be decrypted. Clear it and save a new key.')
    }
  }

  async readApiKey(baseUrl) {
    const binding = await this.readBinding()
    if (!binding) return null
    const requestedIdentity = modelServiceIdentity(baseUrl)
    if (binding.serviceIdentity !== requestedIdentity) {
      throw new Error('The saved model API key is bound to a different service address or base path. Enter a new key for this configuration.')
    }
    return binding.apiKey
  }

  async status({ allowPendingTransaction = false } = {}) {
    if (!allowPendingTransaction && existsSync(this.transactionFile)) {
      return {
        saved: existsSync(this.file),
        bound: false,
        recoveryPending: true,
        encryptionAvailable: this.encryptionAvailable(),
        error: 'Model configuration recovery is pending; restart THEIA before using the saved API key',
      }
    }
    const envelope = await this.readEnvelope()
    if (!envelope) return { saved: false, encryptionAvailable: this.encryptionAvailable() }
    if (LEGACY_FORMATS.has(envelope.format)) {
      return {
        saved: true,
        bound: false,
        requiresReentry: true,
        legacyFormat: envelope.format,
        encryptionAvailable: this.encryptionAvailable(),
        updatedAt: envelope.updatedAt,
      }
    }
    try {
      const binding = await this.readBinding({ allowPendingTransaction })
      return {
        saved: Boolean(binding?.apiKey),
        bound: Boolean(binding?.serviceIdentity),
        serviceIdentity: binding?.serviceIdentity,
        origin: binding?.origin,
        encryptionAvailable: this.encryptionAvailable(),
        updatedAt: envelope.updatedAt,
      }
    } catch (error) {
      return { saved: true, bound: false, encryptionAvailable: this.encryptionAvailable(), error: error instanceof Error ? error.message : String(error) }
    }
  }

  async save(apiKey, baseUrl) {
    const normalized = String(apiKey || '').trim()
    if (!normalized || normalized.length > 2048) throw new Error('Enter a valid model API key')
    if (!this.encryptionAvailable()) throw new Error('THEIA will not store a model API key without Windows encryption support')
    const serviceIdentity = modelServiceIdentity(baseUrl)
    const updatedAt = new Date().toISOString()
    const ciphertext = this.storage.encryptString(JSON.stringify({ apiKey: normalized, serviceIdentity }))
    const payload = JSON.stringify({ format: FORMAT, updatedAt, ciphertext: ciphertext.toString('base64') }) + '\n'
    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(async () => {
        await writeAtomic(this.file, payload, 'save')
      })
    await this.writeQueue
    return this.status({ allowPendingTransaction: true })
  }

  async snapshotFile() {
    await this.writeQueue.catch(() => {})
    if (!existsSync(this.file)) return null
    return readFile(this.file, 'utf8')
  }

  async restoreFile(snapshot) {
    if (snapshot !== null && typeof snapshot !== 'string') throw new Error('Invalid model vault snapshot')
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      if (snapshot === null) {
        await rm(this.file, { force: true })
        return
      }
      await writeAtomic(this.file, snapshot, 'restore')
    })
    await this.writeQueue
    return this.status({ allowPendingTransaction: true })
  }

  async clear() {
    return this.runConfigTransaction(async () => {
      this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
        await rm(this.transactionFile, { force: true })
        await rm(this.file, { force: true })
      })
      await this.writeQueue
      return this.status()
    })
  }
}
