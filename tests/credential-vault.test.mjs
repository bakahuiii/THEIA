import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { CredentialVault } from '../electron/credential-vault.mjs'

const storage = {
  isEncryptionAvailable: () => true,
  encryptString(value) { return Buffer.from(value, 'utf8').map((byte) => byte ^ 0xa5) },
  decryptString(value) { return value.map((byte) => byte ^ 0xa5).toString('utf8') },
}

test('credential vault persists only encrypted credential payloads', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-credentials-'))
  try {
    const vault = new CredentialVault(root, storage)
    const saved = await vault.save({ username: '20260001', password: 'not-a-real-password' })
    assert.equal(saved.saved, true)
    assert.equal(saved.username, '20260001')

    const raw = await readFile(resolve(root, 'credentials.v1.dpapi.json'), 'utf8')
    assert.doesNotMatch(raw, /20260001|not-a-real-password/)

    const credentials = await vault.readCredentials()
    assert.deepEqual({ username: credentials.username, password: credentials.password }, { username: '20260001', password: 'not-a-real-password' })
    assert.deepEqual(await vault.clear(), { saved: false, encryptionAvailable: true })
    assert.equal((await vault.status()).saved, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('credential vault refuses plaintext fallback when encryption is unavailable', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-credentials-unavailable-'))
  try {
    const vault = new CredentialVault(root, { isEncryptionAvailable: () => false })
    await assert.rejects(vault.save({ username: '20260001', password: 'secret' }), /不会以明文保存密码/)
    assert.deepEqual(await vault.status(), { saved: false, encryptionAvailable: false })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('credential vault preserves its encrypted file when decryption fails', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-credentials-decrypt-'))
  try {
    const file = resolve(root, 'credentials.v1.dpapi.json')
    const vault = new CredentialVault(root, storage)
    await vault.save({ username: '20260001', password: 'not-a-real-password' })
    const before = await readFile(file)

    const unreadable = new CredentialVault(root, {
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

