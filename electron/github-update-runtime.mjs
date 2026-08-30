const UPDATE_STATES = Object.freeze({
  unsupported: 'unsupported',
  idle: 'idle',
  checking: 'checking',
  available: 'available',
  downloading: 'downloading',
  downloaded: 'downloaded',
  notAvailable: 'not-available',
  error: 'error',
})

function cloneStatus(status) {
  return structuredClone(status)
}

function normalizeVersion(value) {
  const text = String(value ?? '').trim()
  return text || 'unknown'
}

function normalizeProgress(progress) {
  if (!progress || typeof progress !== 'object') return null
  return {
    percent: Number.isFinite(Number(progress.percent)) ? Number(progress.percent) : 0,
    transferredBytes: Number.isFinite(Number(progress.transferred)) ? Number(progress.transferred) : 0,
    totalBytes: Number.isFinite(Number(progress.total)) ? Number(progress.total) : 0,
    bytesPerSecond: Number.isFinite(Number(progress.bytesPerSecond)) ? Number(progress.bytesPerSecond) : 0,
  }
}

function normalizeError(error) {
  if (error instanceof Error) return error.message || error.name || '更新检查失败'
  return String(error || '更新检查失败')
}

function readReleaseDate(info) {
  const value = info?.releaseDate || info?.releaseDateString || null
  return typeof value === 'string' && value.trim() ? value : null
}

export function createGithubUpdateRuntime({
  autoUpdater,
  currentVersion,
  enabled = true,
  platform = process.platform,
  sendStatus = () => {},
  now = () => new Date().toISOString(),
} = {}) {
  const updater = autoUpdater && typeof autoUpdater.on === 'function' ? autoUpdater : null
  const supported = Boolean(enabled && updater && platform === 'win32')

  const baseStatus = {
    supported,
    state: supported ? UPDATE_STATES.idle : UPDATE_STATES.unsupported,
    currentVersion: normalizeVersion(currentVersion),
    availableVersion: null,
    releaseName: null,
    releaseDate: null,
    lastCheckedAt: null,
    progress: null,
    error: null,
  }

  let status = cloneStatus(baseStatus)
  let checking = false
  let disposed = false

  const publish = (next) => {
    status = {
      ...status,
      ...next,
    }
    const snapshot = cloneStatus(status)
    sendStatus(snapshot)
    return snapshot
  }

  const onCheckingForUpdate = () => {
    checking = true
    publish({
      state: UPDATE_STATES.checking,
      lastCheckedAt: now(),
      error: null,
      progress: null,
    })
  }

  const onUpdateAvailable = (info) => {
    publish({
      state: UPDATE_STATES.available,
      availableVersion: normalizeVersion(info?.version),
      releaseName: typeof info?.releaseName === 'string' && info.releaseName.trim() ? info.releaseName : null,
      releaseDate: readReleaseDate(info),
      error: null,
      progress: null,
    })
  }

  const onUpdateNotAvailable = () => {
    checking = false
    publish({
      state: UPDATE_STATES.notAvailable,
      availableVersion: null,
      releaseName: null,
      releaseDate: null,
      progress: null,
      error: null,
    })
  }

  const onDownloadProgress = (progress) => {
    publish({
      state: UPDATE_STATES.downloading,
      progress: normalizeProgress(progress),
      error: null,
    })
  }

  const onUpdateDownloaded = (info) => {
    checking = false
    publish({
      state: UPDATE_STATES.downloaded,
      availableVersion: normalizeVersion(info?.version || status.availableVersion),
      releaseName: typeof info?.releaseName === 'string' && info.releaseName.trim() ? info.releaseName : status.releaseName,
      releaseDate: readReleaseDate(info) || status.releaseDate,
      progress: null,
      error: null,
    })
  }

  const onError = (error) => {
    checking = false
    publish({
      state: UPDATE_STATES.error,
      error: normalizeError(error),
      progress: null,
    })
  }

  if (updater) {
    updater.autoDownload = true
    updater.autoInstallOnAppQuit = true
    updater.on('checking-for-update', onCheckingForUpdate)
    updater.on('update-available', onUpdateAvailable)
    updater.on('update-not-available', onUpdateNotAvailable)
    updater.on('download-progress', onDownloadProgress)
    updater.on('update-downloaded', onUpdateDownloaded)
    updater.on('error', onError)
  }

  publish(status)

  return {
    getStatus: () => cloneStatus(status),
    async checkForUpdates() {
      if (!supported || !updater) return cloneStatus(status)
      if (checking || status.state === UPDATE_STATES.downloading) return cloneStatus(status)
      try {
        onCheckingForUpdate()
        await updater.checkForUpdates()
      } catch (error) {
        onError(error)
      }
      return cloneStatus(status)
    },
    async installUpdate() {
      if (!supported || !updater) return cloneStatus(status)
      if (status.state !== UPDATE_STATES.downloaded) return cloneStatus(status)
      try {
        updater.quitAndInstall(false, true)
      } catch (error) {
        onError(error)
      }
      return cloneStatus(status)
    },
    dispose() {
      if (disposed || !updater) return
      disposed = true
      updater.removeListener('checking-for-update', onCheckingForUpdate)
      updater.removeListener('update-available', onUpdateAvailable)
      updater.removeListener('update-not-available', onUpdateNotAvailable)
      updater.removeListener('download-progress', onDownloadProgress)
      updater.removeListener('update-downloaded', onUpdateDownloaded)
      updater.removeListener('error', onError)
    },
  }
}

export { UPDATE_STATES as GITHUB_UPDATE_STATES }
