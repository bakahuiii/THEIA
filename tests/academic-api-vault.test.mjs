import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { AcademicApiVault } from '../electron/academic-api-vault.mjs'

const storage = {
  isEncryptionAvailable: () => true,
  encryptString(value) { return Buffer.from(value, 'utf8').map((byte) => byte ^ 0xa5) },
  decryptString(value) { return value.map((byte) => byte ^ 0xa5).toString('utf8') },
}

test('academic API vault is separate and encrypted', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-academic-api-'))
  try {
    const vault = new AcademicApiVault(root, storage)
    const saved = await vault.save({ username: '20260001', password: 'direct-password' })
    assert.equal(saved.saved, true)
    const raw = await readFile(resolve(root, 'academic-api-credentials.v1.dpapi.json'), 'utf8')
    assert.doesNotMatch(raw, /20260001|direct-password/)
    assert.deepEqual(await vault.readCredentials().then(({ username, password }) => ({ username, password })), { username: '20260001', password: 'direct-password' })
    assert.equal((await vault.clear()).saved, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('academic API vault reports decryption failure without deleting the envelope', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-academic-api-decrypt-'))
  try {
    const file = resolve(root, 'academic-api-credentials.v1.dpapi.json')
    const vault = new AcademicApiVault(root, storage)
    await vault.save({ username: '20260001', password: 'direct-password' })
    const before = await readFile(file)
    const unreadable = new AcademicApiVault(root, {
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
