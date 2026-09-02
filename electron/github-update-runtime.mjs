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

export const THEIA_COS_UPDATE_URL = 'https://theia-1314083262.cos.ap-beijing.myqcloud.com/stable/'
export const THEIA_GITHUB_UPDATE_PROVIDER = Object.freeze({
  provider: 'github',
  owner: 'bakahuiii',
  repo: 'THEIA',
})

export function configureCosUpdateProvider(autoUpdater) {
  if (!autoUpdater || typeof autoUpdater.setFeedURL !== 'function') return false
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: THEIA_COS_UPDATE_URL,
    // Tencent COS accepts single byte ranges but does not return the
    // multipart/byteranges response expected by electron-updater.
    useMultipleRangeRequest: false,
  })
  return true
}

export function configureGithubUpdateProvider(autoUpdater) {
  if (!autoUpdater || typeof autoUpdater.setFeedURL !== 'function') return false
  autoUpdater.setFeedURL(THEIA_GITHUB_UPDATE_PROVIDER)
  return true
}

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

function comparableVersion(value) {
  return String(value ?? '').trim().replace(/^v/iu, '')
}

function releaseVersionFromMetadataError(error) {
  const text = normalizeError(error)
  return text.match(/\/download\/v?([^/\s]+)\/latest(?:-[a-z]+)?\.yml\b/iu)?.[1] || null
}

function isMissingLatestMetadataError(error, currentVersion) {
  const text = normalizeError(error).toLowerCase()
  const missing = (
    /cannot find latest(?:-[a-z]+)?\.yml in the latest release artifacts/i.test(text)
    || (/latest(?:-[a-z]+)?\.yml/i.test(text) && /\b404\b/.test(text))
  )
  if (!missing) return false
  const releaseVersion = releaseVersionFromMetadataError(error)
  return Boolean(
    releaseVersion
    && comparableVersion(releaseVersion) === comparableVersion(currentVersion),
  )
}

function readReleaseDate(info) {
  const value = info?.releaseDate || info?.releaseDateString || null
  return typeof value === 'string' && value.trim() ? value : null
}

function readUpdateSize(info) {
  const files = Array.isArray(info?.files) ? info.files : []
  const installer = files.find((file) => /\.exe$/i.test(String(file?.url || file?.path || '')))
  const candidate = installer || files[0]
  const size = Number(candidate?.size)
  return Number.isFinite(size) && size > 0 ? Math.round(size) : null
}

function normalizedSkippedVersion(value) {
  const version = comparableVersion(value)
  return version || null
}

export function createGithubUpdateRuntime({
  autoUpdater,
  currentVersion,
  enabled = true,
  platform = process.platform,
  sendStatus = () => {},
  now = () => new Date().toISOString(),
  getSkippedVersion = () => null,
  setSkippedVersion = async () => {},
  fallbackUpdateProvider = null,
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
    updateSizeBytes: null,
    error: null,
  }

  let status = cloneStatus(baseStatus)
  let checking = false
  let downloading = false
  let disposed = false

  async function checkFallbackProvider() {
    if (typeof fallbackUpdateProvider !== 'function') return false
    let configured = false
    try {
      configured = await fallbackUpdateProvider()
    } catch (error) {
      onError(error)
      return true
    }
    if (!configured) return false
    try {
      await updater.checkForUpdates()
    } catch (error) {
      onError(error)
    }
    return true
  }

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
    downloading = false
    publish({
      state: UPDATE_STATES.checking,
      availableVersion: null,
      releaseName: null,
      releaseDate: null,
      lastCheckedAt: now(),
      error: null,
      progress: null,
      updateSizeBytes: null,
    })
  }

  const onUpdateAvailable = (info) => {
    const availableVersion = normalizeVersion(info?.version)
    if (normalizedSkippedVersion(getSkippedVersion()) === comparableVersion(availableVersion)) {
      checking = false
      downloading = false
      publish({
        state: UPDATE_STATES.idle,
        availableVersion: null,
        releaseName: null,
        releaseDate: null,
        progress: null,
        updateSizeBytes: null,
        error: null,
      })
      return
    }
    checking = false
    publish({
      state: UPDATE_STATES.available,
      availableVersion,
      releaseName: typeof info?.releaseName === 'string' && info.releaseName.trim() ? info.releaseName : null,
      releaseDate: readReleaseDate(info),
      error: null,
      progress: null,
      updateSizeBytes: readUpdateSize(info),
    })
  }

  const onUpdateNotAvailable = () => {
    checking = false
    downloading = false
    publish({
      state: UPDATE_STATES.notAvailable,
      availableVersion: null,
      releaseName: null,
      releaseDate: null,
      progress: null,
      updateSizeBytes: null,
      error: null,
    })
  }

  const onDownloadProgress = (progress) => {
    const normalized = normalizeProgress(progress)
    publish({
      state: UPDATE_STATES.downloading,
      progress: normalized,
      updateSizeBytes: normalized?.totalBytes > 0 ? normalized.totalBytes : status.updateSizeBytes,
      error: null,
    })
  }

  const onUpdateDownloaded = (info) => {
    checking = false
    downloading = false
    publish({
      state: UPDATE_STATES.downloaded,
      availableVersion: normalizeVersion(info?.version || status.availableVersion),
      releaseName: typeof info?.releaseName === 'string' && info.releaseName.trim() ? info.releaseName : status.releaseName,
      releaseDate: readReleaseDate(info) || status.releaseDate,
      progress: null,
      updateSizeBytes: readUpdateSize(info) || status.updateSizeBytes,
      error: null,
    })
  }

  const onError = (error) => {
    checking = false
    downloading = false
    if (isMissingLatestMetadataError(error, currentVersion)) {
      onUpdateNotAvailable()
      return
    }
    publish({
      state: UPDATE_STATES.error,
      error: normalizeError(error),
      progress: null,
    })
  }

  if (updater) {
    updater.autoDownload = false
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
      if (checking || downloading) return cloneStatus(status)
      try {
        onCheckingForUpdate()
        const result = await updater.checkForUpdates()
        if (result?.isUpdateAvailable === false || status.state === UPDATE_STATES.notAvailable) {
          await checkFallbackProvider()
        }
      } catch (error) {
        if (!(await checkFallbackProvider())) onError(error)
      }
      return cloneStatus(status)
    },
    async downloadUpdate() {
      if (!supported || !updater) return cloneStatus(status)
      if (status.state !== UPDATE_STATES.available || downloading) return cloneStatus(status)
      downloading = true
      publish({
        state: UPDATE_STATES.downloading,
        progress: {
          percent: 0,
          transferredBytes: 0,
          totalBytes: status.updateSizeBytes || 0,
          bytesPerSecond: 0,
        },
        error: null,
      })
      try {
        await updater.downloadUpdate()
      } catch (error) {
        onError(error)
      }
      return cloneStatus(status)
    },
    async skipUpdateVersion() {
      if (!supported || !updater || status.state !== UPDATE_STATES.available || !status.availableVersion) {
        return cloneStatus(status)
      }
      const version = status.availableVersion
      try {
        await setSkippedVersion(version)
        checking = false
        downloading = false
        publish({
          state: UPDATE_STATES.idle,
          availableVersion: null,
          releaseName: null,
          releaseDate: null,
          progress: null,
          updateSizeBytes: null,
          error: null,
        })
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
