import { resolve } from 'node:path'
import { CampusStore } from '../../core/store.mjs'
import { saveModelConfigTransaction } from '../../electron/model-config-transaction.mjs'
import { ModelVault } from '../../electron/model-vault.mjs'

const root = resolve(process.argv[2] || '')
if (!process.argv[2]) process.exit(2)
const crashMode = process.argv[3] || 'after-vault'

const storage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value, 'utf8'),
  decryptString: (value) => Buffer.from(value).toString('utf8'),
}
const store = new CampusStore(root)
await store.load()
const vault = new ModelVault(root, storage)
const transactionVault = new Proxy(vault, {
  get(target, property) {
    if (property === 'save' && crashMode === 'after-vault') {
      return async (...args) => {
        await target.save(...args)
        process.exit(73)
      }
    }
    const value = Reflect.get(target, property, target)
    return typeof value === 'function' ? value.bind(target) : value
  },
})
const transactionStore = new Proxy(store, {
  get(target, property) {
    if (property === 'update' && crashMode === 'after-settings') {
      return async (...args) => {
        const snapshot = await target.update(...args)
        process.exit(74)
        return snapshot
      }
    }
    const value = Reflect.get(target, property, target)
    return typeof value === 'function' ? value.bind(target) : value
  },
})

await saveModelConfigTransaction({
  store: transactionStore,
  vault: transactionVault,
  baseUrl: 'https://new.example/v1',
  modelName: 'new-model',
  models: ['new-model'],
  apiKey: 'NEW-KEY',
})
process.exit(3)
