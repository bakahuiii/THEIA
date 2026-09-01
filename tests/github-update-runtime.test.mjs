import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { configureCosUpdateProvider, createGithubUpdateRuntime, THEIA_COS_UPDATE_URL } from '../electron/github-update-runtime.mjs'

test('COS update provider uses the public stable directory', () => {
  let feed = null
  const configured = configureCosUpdateProvider({
    setFeedURL: (value) => { feed = value },
  })

  assert.equal(configured, true)
  assert.deepEqual(feed, { provider: 'generic', url: THEIA_COS_UPDATE_URL })
})

function createFakeUpdater() {
  const updater = new EventEmitter()
  let checkCalls = 0
  let downloadCalls = 0
  let quitCalls = 0
  updater.checkForUpdates = async () => {
    checkCalls += 1
    updater.emit('checking-for-update')
    updater.emit('update-available', {
      version: '0.6.1',
      releaseName: 'THEIA v0.6.1',
      releaseDate: '2026-09-01T00:00:00.000Z',
      files: [{ url: 'THEIA-0.6.1-x64-win.exe', size: 250000000 }],
    })
    return { updateInfo: { version: '0.6.1' } }
  }
  updater.downloadUpdate = async () => {
    downloadCalls += 1
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
      files: [{ url: 'THEIA-0.6.1-x64-win.exe', size: 250000000 }],
    })
  }
  updater.quitAndInstall = () => { quitCalls += 1 }
  return {
    updater,
    getCheckCalls: () => checkCalls,
    getDownloadCalls: () => downloadCalls,
    getQuitCalls: () => quitCalls,
  }
}

test('GitHub updater waits for an explicit download and reports the installer size', async () => {
  const { updater, getCheckCalls, getDownloadCalls, getQuitCalls } = createFakeUpdater()
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
  assert.equal(updater.autoDownload, false)

  await runtime.checkForUpdates()

  assert.equal(getCheckCalls(), 1)
  assert.equal(statuses.some((status) => status.state === 'checking'), true)
  assert.equal(statuses.some((status) => status.state === 'available'), true)
  assert.equal(runtime.getStatus().state, 'available')
  assert.equal(runtime.getStatus().updateSizeBytes, 250000000)
  assert.equal(getDownloadCalls(), 0)

  await runtime.downloadUpdate()

  assert.equal(getDownloadCalls(), 1)
  assert.equal(statuses.some((status) => status.state === 'downloading'), true)
  assert.equal(statuses.at(-1).state, 'downloaded')
  assert.equal(statuses.at(-1).availableVersion, '0.6.1')
  assert.equal(statuses.at(-1).progress, null)
  assert.equal(statuses.at(-1).updateSizeBytes, 250000000)

  await runtime.installUpdate()
  assert.equal(getQuitCalls(), 1)
})

test('GitHub updater persists and filters a skipped version', async () => {
  const { updater } = createFakeUpdater()
  let skippedVersion = null
  const statuses = []
  const runtime = createGithubUpdateRuntime({
    autoUpdater: updater,
    currentVersion: '0.6.0',
    enabled: true,
    platform: 'win32',
    getSkippedVersion: () => skippedVersion,
    setSkippedVersion: async (version) => { skippedVersion = version },
    sendStatus: (status) => statuses.push(status),
  })

  await runtime.checkForUpdates()
  assert.equal(runtime.getStatus().state, 'available')

  await runtime.skipUpdateVersion()
  assert.equal(skippedVersion, '0.6.1')
  assert.equal(runtime.getStatus().state, 'idle')
  assert.equal(runtime.getStatus().availableVersion, null)

  await runtime.checkForUpdates()
  assert.equal(runtime.getStatus().state, 'idle')
  assert.equal(statuses.at(-1).availableVersion, null)
})

test('GitHub updater treats a missing latest.yml release asset as not available', async () => {
  const updater = new EventEmitter()
  updater.checkForUpdates = async () => {
    updater.emit('checking-for-update')
    throw new Error('Cannot find latest.yml in the latest release artifacts (https://github.com/bakahuiii/THEIA/releases/download/v0.6.1/latest.yml): HttpError 404')
  }
  const statuses = []
  const runtime = createGithubUpdateRuntime({
    autoUpdater: updater,
    currentVersion: '0.6.1',
    enabled: true,
    platform: 'win32',
    sendStatus: (status) => statuses.push(status),
  })

  await runtime.checkForUpdates()

  assert.equal(statuses.at(-1).state, 'not-available')
  assert.equal(statuses.at(-1).error, null)
})

test('GitHub updater keeps missing metadata as an error when the release is newer', async () => {
  const updater = new EventEmitter()
  updater.checkForUpdates = async () => {
    updater.emit('checking-for-update')
    throw new Error('Cannot find latest.yml in the latest release artifacts (https://github.com/bakahuiii/THEIA/releases/download/v0.6.1/latest.yml): HttpError 404')
  }
  const statuses = []
  const runtime = createGithubUpdateRuntime({
    autoUpdater: updater,
    currentVersion: '0.6.0',
    enabled: true,
    platform: 'win32',
    sendStatus: (status) => statuses.push(status),
  })

  await runtime.checkForUpdates()

  assert.equal(statuses.at(-1).state, 'error')
  assert.match(statuses.at(-1).error, /Cannot find latest\.yml/)
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
