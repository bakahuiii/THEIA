import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { acquireIrisInstance } from '../electron/iris-runtime/src/singleInstance.mjs'

function runningProcessStub(pid) {
  return pid === 1001
}

async function seededLock(root) {
  const lockPath = resolve(root, '.iris-instance')
  await mkdir(lockPath, { recursive: true })
  await writeFile(resolve(lockPath, 'owner.json'), JSON.stringify({ pid: 1001, token: 'stale-token' }), { encoding: 'utf8' })
  return lockPath
}

test('acquireIrisInstance reclaims a lock whose owner PID was reused by another process', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-iris-single-'))
  try {
    const lockPath = await seededLock(root)
    // The lock is old (owner PID 1001 still "alive", but it is a reused PID),
    // so a fresh acquisition must reclaim it instead of reporting a holder.
    const result = await acquireIrisInstance({
      lockPath,
      pid: 999,
      now: () => Date.now() + 120_000,
      isProcessRunning: runningProcessStub,
      staleLockAgeMs: 60_000,
    })
    assert.equal(result.acquired, true)
    // Owner json was replaced by the new owner before release.
    const owner = JSON.parse(await readFile(resolve(lockPath, 'owner.json'), 'utf8'))
    assert.equal(owner.pid, 999)
    await result.release()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('acquireIrisInstance honors a fresh live lock held by a real running instance', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'theia-iris-single-'))
  try {
    const lockPath = await seededLock(root)
    const result = await acquireIrisInstance({
      lockPath,
      pid: 999,
      now: () => Date.now() + 1_000, // fresh lock (age ~1s)
      isProcessRunning: runningProcessStub,
      staleLockAgeMs: 60_000,
    })
    assert.equal(result.acquired, false)
    assert.equal(result.holderPid, 1001)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
