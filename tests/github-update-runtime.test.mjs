import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { createGithubUpdateRuntime } from '../electron/github-update-runtime.mjs'

function createFakeUpdater() {
  const updater = new EventEmitter()
  let checkCalls = 0
  let quitCalls = 0
  updater.checkForUpdates = async () => {
    checkCalls += 1
    updater.emit('checking-for-update')
    updater.emit('update-available', {
      version: '0.6.1',
      releaseName: 'THEIA v0.6.1',
      releaseDate: '2026-09-01T00:00:00.000Z',
    })
    updater.emit('download-progress', {
      percent: 42.5,
      transferred: 42,
      total: 100,
      bytesPerSecond: 1234,
    })
    updater.emit('update-downloaded', {
      version: '0.6.1',
      releaseName: 'THEIA v0.6.1',
      releaseDate: '2026-09-01T00:00:00.000Z',
    })
    return { updateInfo: { version: '0.6.1' } }
  }
  updater.quitAndInstall = () => { quitCalls += 1 }
  return { updater, getCheckCalls: () => checkCalls, getQuitCalls: () => quitCalls }
}

test('GitHub updater publishes available, downloading, downloaded and install states', async () => {
  const { updater, getCheckCalls, getQuitCalls } = createFakeUpdater()
  const statuses = []
  const runtime = createGithubUpdateRuntime({
    autoUpdater: updater,
    currentVersion: '0.6.0',
    enabled: true,
    platform: 'win32',
    sendStatus: (status) => statuses.push(status),
  })

  assert.equal(statuses[0].state, 'idle')
  assert.equal(statuses[0].supported, true)

  await runtime.checkForUpdates()

  assert.equal(getCheckCalls(), 1)
  assert.equal(statuses.some((status) => status.state === 'checking'), true)
  assert.equal(statuses.some((status) => status.state === 'available'), true)
  assert.equal(statuses.some((status) => status.state === 'downloading'), true)
  assert.equal(statuses.at(-1).state, 'downloaded')
  assert.equal(statuses.at(-1).availableVersion, '0.6.1')
  assert.equal(statuses.at(-1).progress, null)

  await runtime.installUpdate()
  assert.equal(getQuitCalls(), 1)
})

test('GitHub updater stays unsupported outside packaged Windows builds', async () => {
  const statuses = []
  const runtime = createGithubUpdateRuntime({
    autoUpdater: null,
    currentVersion: '0.6.0',
    enabled: false,
    platform: 'linux',
    sendStatus: (status) => statuses.push(status),
  })

  assert.equal(statuses[0].state, 'unsupported')
  assert.equal(runtime.getStatus().state, 'unsupported')
  await runtime.checkForUpdates()
  assert.equal(runtime.getStatus().state, 'unsupported')
})
