import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { MailVault } from '../electron/mail-vault.mjs'

const storage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`encrypted:${value}`),
  decryptString: (value) => value.toString().replace(/^encrypted:/, ''),
}

test('mail vault stores credentials only in a DPAPI-style encrypted envelope', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-mail-vault-'))
  try {
    const vault = new MailVault(root, storage)
    await vault.save({ username: 'student@mail.buct.edu.cn', password: 'mail-secret' })
    const raw = await readFile(resolve(root, 'mail-credentials.v1.dpapi.json'), 'utf8')
    assert.match(raw, /theia-mail-credentials\/v1/)
    assert.doesNotMatch(raw, /mail-secret/)
    assert.deepEqual(await vault.readCredentials(), {
      username: 'student@mail.buct.edu.cn', password: 'mail-secret', protocolPassword: '', updatedAt: (await vault.status()).updatedAt,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('mail vault reports decryption failure without deleting the envelope', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-mail-vault-decrypt-'))
  try {
    const file = resolve(root, 'mail-credentials.v1.dpapi.json')
    const vault = new MailVault(root, storage)
    await vault.save({ username: 'student@mail.buct.edu.cn', password: 'mail-secret' })
    const before = await readFile(file)
    const unreadable = new MailVault(root, {
      isEncryptionAvailable: () => true,
      decryptString() { throw new Error('test decrypt failure') },
    })

    await assert.rejects(unreadable.readCredentials(), /无法解密/)
    const status = await unreadable.status()
    assert.equal(status.saved, true)
    assert.match(status.error, /无法解密/)
    assert.deepEqual(await readFile(file), before)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('mail vault clear() is serialized after a queued save and cannot be undone by it', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-mail-vault-clear-'))
  try {
    const vault = new MailVault(root, storage)
    // Interleave: start save(), then clear() before the queued write finishes.
    const savePending = vault.save({ username: 'student@mail.buct.edu.cn', password: 'queued-secret' })
    const clear = await vault.clear()
    await savePending
    assert.equal(clear.saved, false)
    // The save must not resurrect the credentials after clear() returned.
    assert.deepEqual(await vault.readCredentials(), null)
    assert.equal((await vault.status()).saved, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

