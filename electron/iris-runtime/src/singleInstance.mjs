import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const ownerFile = 'owner.json'
const incompleteLockGraceMs = 5_000

function validOwner(value) {
  const pid = Number(value?.pid)
  const token = typeof value?.token === 'string' ? value.token : ''
  return Number.isSafeInteger(pid) && pid > 0 && token ? { pid, token } : null
}

function runningProcess(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

async function readOwner(lockPath) {
  try {
    return validOwner(JSON.parse(await readFile(join(lockPath, ownerFile), 'utf8')))
  } catch {
    return null
  }
}

// The lock directory's mtime is only refreshed on mkdir and does not change
// while the owner runs. The owner.json file mtime IS refreshed by every
// heartbeat, so it is the reliable freshness signal for a live lock.
async function ownerFileAgeMs(lockPath, now) {
  try {
    const info = await stat(join(lockPath, ownerFile))
    return Math.max(0, now - info.mtimeMs)
  } catch {
    return null
  }
}

/**
 * Acquires an exclusive local Iris daemon lock. The directory itself is the
 * atomic lock primitive, avoiding a write window in a regular lock file.
 *
 * The returned handle has a `touch()` method that the owner must call
 * periodically (a heartbeat). A lock whose owner.json has not been refreshed
 * within staleLockAgeMs is considered stale and may be reclaimed even if the
 * recorded PID still appears alive (the PID may have been reused by an
 * unrelated process after the original Iris instance exited).
 */
export async function acquireIrisInstance({
  lockPath,
  pid = process.pid,
  now = () => Date.now(),
  isProcessRunning = runningProcess,
  staleLockAgeMs = 60_000,
} = {}) {
  if (!lockPath) throw new Error('Iris instance lock path is required')
  const token = randomUUID()
  const ownerPayload = () => JSON.stringify({ pid, token, startedAt: new Date(now()).toISOString() })

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(lockPath)
      await writeFile(join(lockPath, ownerFile), ownerPayload(), { encoding: 'utf8', mode: 0o600 })
      let released = false
      return {
        acquired: true,
        token,
        async touch() {
          if (released) return
          const current = await readOwner(lockPath)
          if (current?.pid === pid && current.token === token) {
            await writeFile(join(lockPath, ownerFile), ownerPayload(), { encoding: 'utf8', mode: 0o600 }).catch(() => undefined)
          }
        },
        async release() {
          if (released) return
          released = true
          const current = await readOwner(lockPath)
          if (current?.pid === pid && current.token === token) await rm(lockPath, { recursive: true, force: true })
        },
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }

    const owner = await readOwner(lockPath)
    if (owner && isProcessRunning(owner.pid)) {
      // A live lock must have a recent heartbeat. If the owner.json was
      // refreshed recently, the lock is genuinely held by a running instance.
      // If the owner.json is old even though the PID appears alive, the PID
      // was likely reused after the original instance exited — treat as stale.
      const ageMs = await ownerFileAgeMs(lockPath, now())
      if (ageMs !== null && ageMs < staleLockAgeMs) return { acquired: false, holderPid: owner.pid }
      // Fall through to reclaim the stale lock below.
    }

    const dirAgeMs = await stat(lockPath).then((info) => Math.max(0, now() - info.mtimeMs)).catch(() => 0)
    if (!owner && dirAgeMs < incompleteLockGraceMs) return { acquired: false, holderPid: null }
    await rm(lockPath, { recursive: true, force: true })
  }

  return { acquired: false, holderPid: null }
}
