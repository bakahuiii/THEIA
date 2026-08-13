import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { modelServiceIdentity } from '../core/model-url-policy.mjs'

export const MODEL_CONFIG_TRANSACTION_SCHEMA = 'theia-model-config-transaction/v1'
const MAX_JOURNAL_BYTES = 64 * 1024

function modelSettings(settings) {
  return {
    modelBaseUrl: typeof settings?.modelBaseUrl === 'string' ? settings.modelBaseUrl : '',
    modelName: typeof settings?.modelName === 'string' ? settings.modelName : '',
    modelModels: Array.isArray(settings?.modelModels)
      ? settings.modelModels.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 300)
      : [],
  }
}

function journalPayload(previousSettings, previousVault) {
  return {
    schema: MODEL_CONFIG_TRANSACTION_SCHEMA,
    createdAt: new Date().toISOString(),
    previousSettings: modelSettings(previousSettings),
    previousVault,
  }
}

function journalDigest(payload) {
  return createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex')
}

function checkedJournal(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Model configuration recovery journal is invalid')
  const { digest, ...payload } = value
  if (payload.schema !== MODEL_CONFIG_TRANSACTION_SCHEMA || !/^[a-f0-9]{64}$/.test(String(digest || ''))) {
    throw new Error('Model configuration recovery journal is invalid')
  }
  if (journalDigest(payload) !== digest) throw new Error('Model configuration recovery journal failed its integrity check')
  if (typeof payload.createdAt !== 'string' || !Number.isFinite(Date.parse(payload.createdAt))) {
    throw new Error('Model configuration recovery journal has an invalid timestamp')
  }
  if (payload.previousVault !== null && typeof payload.previousVault !== 'string') {
    throw new Error('Model configuration recovery journal has an invalid vault snapshot')
  }
  if (typeof payload.previousVault === 'string' && Buffer.byteLength(payload.previousVault, 'utf8') > MAX_JOURNAL_BYTES) {
    throw new Error('Model configuration recovery journal vault snapshot is too large')
  }
  const settings = payload.previousSettings
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)
    || typeof settings.modelBaseUrl !== 'string'
    || typeof settings.modelName !== 'string'
    || !Array.isArray(settings.modelModels)
    || settings.modelModels.some((item) => typeof item !== 'string')) {
    throw new Error('Model configuration recovery journal has invalid settings')
  }
  return { ...payload, previousSettings: modelSettings(settings) }
}

async function writeJournal(file, previousSettings, previousVault) {
  if (!file || typeof file !== 'string') throw new Error('Model configuration transaction journal is unavailable')
  if (existsSync(file)) throw new Error('A model configuration recovery is still pending')
  const payload = journalPayload(previousSettings, previousVault)
  const serialized = `${JSON.stringify({ ...payload, digest: journalDigest(payload) }, null, 2)}\n`
  if (Buffer.byteLength(serialized, 'utf8') > MAX_JOURNAL_BYTES) throw new Error('Model configuration recovery journal is too large')
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  let handle
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(serialized, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await rename(temporary, file)
  } catch (error) {
    await handle?.close().catch(() => {})
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

async function readJournal(file) {
  if (!file || typeof file !== 'string' || !existsSync(file)) return null
  const raw = await readFile(file, 'utf8')
  if (Buffer.byteLength(raw, 'utf8') > MAX_JOURNAL_BYTES) throw new Error('Model configuration recovery journal is too large')
  try {
    return checkedJournal(JSON.parse(raw))
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Model configuration recovery journal is not valid JSON')
    throw error
  }
}

async function restoreSettings(store, previousSettings) {
  return store.update((state) => ({
    ...state,
    settings: { ...state.settings, ...modelSettings(previousSettings) },
  }))
}

async function recoverModelConfigTransactionUnlocked({
  store,
  vault,
  publishSnapshot = () => {},
} = {}) {
  const recovery = await readJournal(vault?.transactionFile)
  if (!recovery) return { recovered: false, snapshot: null }

  // The journal remains until both sides have been restored. Every step is
  // idempotent, so another interruption is recovered by the next startup.
  const snapshot = await restoreSettings(store, recovery.previousSettings)
  await vault.restoreFile(recovery.previousVault)
  await rm(vault.transactionFile, { force: true })
  publishSnapshot(snapshot)
  return { recovered: true, snapshot }
}

function runConfigTransaction(vault, operation) {
  if (!vault || typeof vault.runConfigTransaction !== 'function') {
    throw new Error('Model configuration transaction queue is unavailable')
  }
  return vault.runConfigTransaction(operation)
}

export function recoverModelConfigTransaction(options = {}) {
  return runConfigTransaction(options.vault, () => recoverModelConfigTransactionUnlocked(options))
}

async function saveModelConfigTransactionUnlocked({
  store,
  vault,
  baseUrl,
  modelName,
  models,
  apiKey = '',
  publishSnapshot = () => {},
}) {
  await recoverModelConfigTransactionUnlocked({ store, vault, publishSnapshot })
  const previousSettings = modelSettings(store.snapshot().settings)
  const previousVault = await vault.snapshotFile()
  await writeJournal(vault.transactionFile, previousSettings, previousVault)
  let vaultMayHaveChanged = false
  let settingsMayHaveChanged = false
  try {
    if (apiKey) {
      vaultMayHaveChanged = true
      await vault.save(apiKey, baseUrl)
    }
    const status = await vault.status({ allowPendingTransaction: true })
    const expectedIdentity = modelServiceIdentity(baseUrl)
    if (!status.saved || !status.bound || status.serviceIdentity !== expectedIdentity) {
      throw new Error('Enter a model API key for this exact service address before saving it')
    }
    settingsMayHaveChanged = true
    const snapshot = await store.update((state) => ({
      ...state,
      settings: {
        ...state.settings,
        modelBaseUrl: expectedIdentity,
        modelName,
        modelModels: [...models],
      },
    }))
    publishSnapshot(snapshot)
    await rm(vault.transactionFile, { force: true })
    return snapshot
  } catch (error) {
    const rollbackErrors = []
    if (settingsMayHaveChanged) {
      try {
        const rolledBack = await restoreSettings(store, previousSettings)
        publishSnapshot(rolledBack)
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }
    if (vaultMayHaveChanged) {
      try {
        await vault.restoreFile(previousVault)
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError)
      }
    }
    if (!rollbackErrors.length) {
      await rm(vault.transactionFile, { force: true }).catch((rollbackError) => rollbackErrors.push(rollbackError))
    }
    if (rollbackErrors.length) {
      throw new AggregateError([error, ...rollbackErrors], 'Model configuration failed and rollback was incomplete')
    }
    throw error
  }
}

export function saveModelConfigTransaction(options = {}) {
  return runConfigTransaction(options.vault, () => saveModelConfigTransactionUnlocked(options))
}
