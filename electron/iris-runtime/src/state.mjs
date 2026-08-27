import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findCodexContinuation, forgetCodexContinuations, normalizeCodexContinuations, normalizeCodexTaskName, rememberCodexContinuation } from './codexContinuations.mjs'

const irisDirectory = resolve(process.env.IRIS_HOME || resolve(dirname(fileURLToPath(import.meta.url)), '..'))
const statePath = resolve(irisDirectory, '.iris-state.json')
let stateWriteQueue = Promise.resolve()

function validTarget(value) {
  if (!value || typeof value !== 'object') return null
  if (value.scope !== 'c2c' || typeof value.targetId !== 'string' || !value.targetId.trim()) return null
  return { scope: 'c2c', targetId: value.targetId.trim() }
}

function validCodexSessionId(value) {
  const id = typeof value === 'string' ? value.trim() : ''
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : ''
}

function pendingCodexContinuation(value) {
  const sessionId = validCodexSessionId(value?.sessionId)
  if (!sessionId) return null
  const workspaceName = typeof value?.workspaceName === 'string' ? value.workspaceName.trim().toLowerCase().slice(0, 64) : ''
  const taskName = normalizeCodexTaskName(value?.taskName)
  return {
    sessionId,
    ...(workspaceName ? { workspaceName } : {}),
    ...(taskName ? { taskName } : {}),
  }
}

export function normalizePendingNotifications(value) {
  return (Array.isArray(value) ? value : []).flatMap((item) => {
    const id = typeof item?.id === 'string' ? item.id.trim().slice(0, 120) : ''
    const text = typeof item?.text === 'string' ? item.text.trim().slice(0, 3_800) : ''
    const createdAt = typeof item?.createdAt === 'string' ? item.createdAt : new Date().toISOString()
    const codexContinuation = pendingCodexContinuation(item?.codexContinuation)
    return id && text ? [{ id, text, createdAt, ...(codexContinuation ? { codexContinuation } : {}) }] : []
  }).slice(-32)
}

function normalizedState(value) {
  return {
    ownerOpenid: typeof value?.ownerOpenid === 'string' ? value.ownerOpenid.trim().slice(0, 256) : '',
    replyTarget: validTarget(value?.replyTarget),
    pendingNotifications: normalizePendingNotifications(value?.pendingNotifications),
    codexSessionId: validCodexSessionId(value?.codexSessionId),
    claudeSessionId: validCodexSessionId(value?.claudeSessionId),
    hermesSessionId: typeof value?.hermesSessionId === 'string' ? value.hermesSessionId.trim().slice(0, 64) : '',
    codexContinuations: normalizeCodexContinuations(value?.codexContinuations),
    updatedAt: typeof value?.updatedAt === 'string' ? value.updatedAt : null,
  }
}

async function writeState(value) {
  await mkdir(dirname(statePath), { recursive: true })
  const next = JSON.stringify({
    version: 3,
    ...normalizedState(value),
    updatedAt: new Date().toISOString(),
  })
  const temporary = `${statePath}.${process.pid}.tmp`
  await writeFile(temporary, next, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, statePath)
}

async function readState() {
  try {
    return normalizedState(JSON.parse(await readFile(statePath, 'utf8')))
  } catch (error) {
    if (error?.code === 'ENOENT') return normalizedState(null)
    return normalizedState(null)
  }
}

function mutateState(mutator) {
  const write = stateWriteQueue.then(async () => {
    const current = await readState()
    const next = await mutator(current)
    await writeState(next)
    return normalizedState(next)
  })
  stateWriteQueue = write.catch(() => undefined)
  return write
}

export async function loadIrisState() {
  await stateWriteQueue
  return readState()
}

export async function saveTrustedTarget({ ownerOpenid, replyTarget }) {
  const target = validTarget(replyTarget)
  if (!ownerOpenid || !target) throw new Error('Trusted reply target is incomplete')
  await mutateState((current) => ({ ...current, ownerOpenid: String(ownerOpenid), replyTarget: target }))
}

export async function saveCodexSession(codexSessionId) {
  const id = validCodexSessionId(codexSessionId)
  if (!id) throw new Error('Codex session id is invalid')
  await mutateState((current) => ({ ...current, codexSessionId: id }))
}

export async function saveClaudeSession(claudeSessionId) {
  const id = validCodexSessionId(claudeSessionId)
  if (!id) throw new Error('Claude Code session id is invalid')
  await mutateState((current) => ({ ...current, claudeSessionId: id }))
}

export async function saveHermesSession(hermesSessionId) {
  const id = typeof hermesSessionId === 'string' ? hermesSessionId.trim().slice(0, 64) : ''
  if (!id) throw new Error('Hermes session id is invalid')
  await mutateState((current) => ({ ...current, hermesSessionId: id }))
}

export async function queueNotification(text, { codexContinuation } = {}) {
  const value = typeof text === 'string' ? text.trim().slice(0, 3_800) : ''
  if (!value) throw new Error('Notification text is empty')
  const continuation = pendingCodexContinuation(codexContinuation)
  const notification = {
    id: `notice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    text: value,
    createdAt: new Date().toISOString(),
    ...(continuation ? { codexContinuation: continuation } : {}),
  }
  await mutateState((current) => ({ ...current, pendingNotifications: [...current.pendingNotifications, notification] }))
  return notification
}

export async function removePendingNotification(id) {
  await mutateState((current) => ({ ...current, pendingNotifications: current.pendingNotifications.filter((item) => item.id !== id) }))
}

/** Records the opaque QQ quote anchor for a completed local Codex turn. */
export async function saveCodexContinuation(continuation) {
  await mutateState((current) => ({
    ...current,
    codexContinuations: rememberCodexContinuation(current.codexContinuations, continuation),
  }))
}

export async function loadCodexContinuation(reference) {
  const current = await loadIrisState()
  return findCodexContinuation(current.codexContinuations, reference)
}

export async function removeCodexContinuationsByCompletedAt(completedAtValues) {
  await mutateState((current) => ({
    ...current,
    codexContinuations: forgetCodexContinuations(current.codexContinuations, completedAtValues),
  }))
}

export { statePath }
