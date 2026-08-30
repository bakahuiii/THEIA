import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export function createWindowRuntime({
  app,
  BrowserWindow,
  shell,
  root,
  APP_ICON,
  getMainWindow,
  setMainWindow,
  getSplashWindow,
  setSplashWindow,
  getMainEntryUrl,
  setMainEntryUrl,
  getViteServer,
  setViteServer,
  getSyncPageWindow,
  getFitnessPageWindow,
  onMainWindowClosed = () => {},
  mainRendererCsp,
  isPermittedAppNavigation,
  isPermittedSourceUrl,
  permittedExternalUrl,
  writeDiagnostic,
  diagnosticUrl,
  diagnosticError,
  broadcastAuthStatus,
  renderMarkdownToPdf,
  probeAcademicCalendarOcrRuntime,
  finishSmoke,
  smokeFile,
  preloadErrors,
}) {
  const state = {
    get mainWindow() { return getMainWindow() },
    set mainWindow(value) { setMainWindow(value) },
    get splashWindow() { return getSplashWindow() },
    set splashWindow(value) { setSplashWindow(value) },
    get mainEntryUrl() { return getMainEntryUrl() },
    set mainEntryUrl(value) { setMainEntryUrl(value) },
    get viteServer() { return getViteServer() },
    set viteServer(value) { setViteServer(value) },
    get syncPageWindow() { return getSyncPageWindow() },
    get fitnessPageWindow() { return getFitnessPageWindow() },
  }

  async function createSplashWindow() {
    const splashImage = `data:image/jpeg;base64,${(await readFile(resolve(import.meta.dirname, 'assets/theia-splash-library.jpg'))).toString('base64')}`
    const html = `<!DOCTYPE html>
  <html lang="zh-CN">
  <head><meta charset="utf-8"><title>THEIA 正在启动</title>
  <style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:100%;height:100%;background:#131920;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;overflow:hidden;user-select:none}
  .splash{position:relative;width:100%;height:100%;overflow:hidden;background:#131920}
  .splash-image{position:absolute;inset:0;width:100%;height:100%;display:block;object-fit:cover;object-position:center}
  .splash-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(9,16,30,.04) 45%,rgba(9,16,30,.66) 100%);pointer-events:none}
  .status-line{position:absolute;left:18px;right:18px;bottom:16px;display:flex;align-items:center;gap:9px;width:max-content;max-width:calc(100% - 36px);padding:8px 11px;border:1px solid rgba(255,255,255,.24);border-radius:999px;background:rgba(8,14,26,.48);box-shadow:0 8px 22px rgba(4,9,18,.22);backdrop-filter:blur(8px);color:rgba(255,255,255,.92);font-size:12px;line-height:1.2}
  .status{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-shadow:0 1px 3px rgba(0,0,0,.5)}
  .spinner{flex:0 0 auto;width:13px;height:13px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  </style></head>
  <body>
  <main class="splash">
    <img class="splash-image" src="${splashImage}" alt="北化图书馆" draggable="false">
    <div class="splash-shade"></div>
    <div class="status-line"><span class="spinner" aria-hidden="true"></span><span class="status">正在启动 THEIA…</span></div>
  </main>
  </body></html>`
    const splash = new BrowserWindow({
      width: 460,
      height: 340,
      frame: false,
      resizable: false,
      show: false,
      backgroundColor: '#131920',
      icon: APP_ICON,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    splash.setMenu(null)
    splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    splash.once('ready-to-show', () => { if (!splash.isDestroyed()) splash.show() })
    return splash
  }
  
  async function createMainWindow() {
    const window = new BrowserWindow({
      title: 'THEIA',
      width: 1480,
      height: 920,
      minWidth: 1120,
      minHeight: 720,
      frame: false,
      autoHideMenuBar: true,
      icon: APP_ICON,
      // Hide until first paint so the splash stays visible and no dark flash
      // appears. ready-to-show shows the window after the renderer renders its
      // first frame (the loading screen or main UI), and also closes the splash.
      show: false,
      backgroundColor: '#131920',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: resolve(import.meta.dirname, 'preload.cjs'),
      },
    })
    state.mainWindow = window
    window.once('ready-to-show', () => {
      if (state.splashWindow && !state.splashWindow.isDestroyed()) state.splashWindow.close()
      state.splashWindow = null
      if (!window.isDestroyed()) window.show()
    })
    state.mainEntryUrl = app.isPackaged
      ? pathToFileURL(resolve(root, 'dist/index.html')).toString()
      : state.viteServer.resolvedUrls?.local?.[0] || 'http://127.0.0.1:5174/'
    const rendererSession = window.webContents.session
    const mainWebContentsId = window.webContents.id
    rendererSession.webRequest.onHeadersReceived((details, callback) => {
      const responseHeaders = { ...(details.responseHeaders || {}) }
      const requestUrl = String(details.url || '')
      if (details.webContentsId === mainWebContentsId && isPermittedAppNavigation(requestUrl, state.mainEntryUrl)) {
        for (const name of Object.keys(responseHeaders)) {
          if (name.toLowerCase() === 'content-security-policy') delete responseHeaders[name]
        }
        responseHeaders['Content-Security-Policy'] = [mainRendererCsp(!app.isPackaged)]
      }
      callback({ responseHeaders })
    })
    const preventUnsafeMainNavigation = (event, legacyUrl) => {
      if (event.isMainFrame === false) return
      const target = event.url || legacyUrl
      if (isPermittedAppNavigation(target, state.mainEntryUrl)) return
      event.preventDefault()
      void writeDiagnostic('renderer.navigation_blocked', { url: diagnosticUrl(target) })
    }
    window.webContents.on('will-navigate', preventUnsafeMainNavigation)
    window.webContents.on('will-redirect', preventUnsafeMainNavigation)
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (isPermittedSourceUrl(url)) {
        void writeDiagnostic('renderer.campus_popup_blocked', { url: diagnosticUrl(url) })
        return { action: 'deny' }
      }
      try {
        const target = permittedExternalUrl(url)
        void shell.openExternal(target).catch((error) => {
          void writeDiagnostic('renderer.external_open_failed', { url: diagnosticUrl(target), error: diagnosticError(error) })
        })
      } catch {
        void writeDiagnostic('renderer.popup_blocked', { url: diagnosticUrl(url) })
      }
      return { action: 'deny' }
    })
    window.on('closed', () => {
      if (state.mainWindow !== window) return
      state.mainWindow = null
      if (state.syncPageWindow && !state.syncPageWindow.isDestroyed()) state.syncPageWindow.close()
      if (state.fitnessPageWindow && !state.fitnessPageWindow.isDestroyed()) state.fitnessPageWindow.close()
      onMainWindowClosed()
    })
    window.on('focus', () => { void broadcastAuthStatus() })
    window.webContents.on('preload-error', (_event, preloadPath, error) => {
      const detail = { preloadPath, message: error?.stack || error?.message || String(error) }
      preloadErrors.push(detail)
      console.error('[THEIA] preload failed', detail)
    })
    window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      if (level < 2) return
      void writeDiagnostic('renderer.console', {
        level,
        message: String(message || '').slice(0, 2_000),
        line: Number(line) || null,
        source: String(sourceId || '').slice(0, 500),
      })
    })
    window.webContents.on('render-process-gone', (_event, details) => {
      void writeDiagnostic('renderer.process_gone', {
        reason: details?.reason || 'unknown',
        exitCode: Number.isFinite(details?.exitCode) ? details.exitCode : null,
      })
    })
    window.webContents.once('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      void finishSmoke({ ok: false, stage: 'load', errorCode, errorDescription, validatedURL })
    })
    window.webContents.once('did-finish-load', async () => {
      if (!smokeFile) return
      try {
        const bridge = await window.webContents.executeJavaScript(`(() => {
          const api = window.theia || window.buct
          const requiredMethods = [
            'getSnapshot', 'getAdvisorOverview', 'getAuthStatus', 'login', 'logout', 'syncNow', 'retrySyncDomain',
            'getAdvisorAcademicWhatIf', 'getAdvisorCourseDecisions', 'executeAdvisorAction',
            'listAdvisorThreads', 'createAdvisorThread', 'prepareAdvisorRequest', 'sendAdvisorRequest',
            'cancelAdvisorRequest', 'deleteAdvisorThread', 'onAdvisorStream',
            'getCourseSelection', 'discoverCourseSelection', 'getCourseSelectionCandidates', 'getCachedSchoolSchedule',
            'saveCourseSelectionTarget', 'removeCourseSelectionTarget', 'setCourseSelectionSentinel', 'startCourseSelection', 'stopCourseSelection',
            'openSource', 'openAcademicAttachment', 'openSchedulePdf', 'openScheduleDirectory', 'refreshCourseResources', 'downloadCourseResource', 'exportData', 'getApiStatus', 'updateSettings',
            'getCredentialStatus', 'saveCredentials', 'clearCredentials',
            'getAcademicApiCredentialStatus', 'saveAcademicApiCredentials', 'clearAcademicApiCredentials',
            'getMailCredentialStatus', 'saveMailCredentials', 'clearMailCredentials', 'refreshMailbox',
            'openMailbox', 'readMailboxMessage', 'downloadMailboxAttachment',
            'prepareCourseWork', 'openCourseWork', 'importCourseWorkFile',
            'openSubmission', 'applyTestAnswers', 'getModelStatus', 'saveModelConfig',
            'clearModelApiKey', 'validateModelConnection', 'discoverModels', 'processCourseWorkWithModel',
            'chooseAppBackground', 'onSnapshot', 'onAuthStatus'
          ]
          return {
            type: typeof api,
            methods: requiredMethods.filter((method) => typeof api?.[method] === 'function'),
            requiredMethods,
          }
        })()`)
        const calls = await window.webContents.executeJavaScript(`Promise.all([
          (window.theia || window.buct).getSnapshot(),
          (window.theia || window.buct).getAdvisorOverview(),
          (async () => {
            const api = window.theia || window.buct
            const thread = await api.createAdvisorThread()
            const threads = await api.listAdvisorThreads()
            return { id: thread.id, listed: threads.some((item) => item.id === thread.id) }
          })(),
          (window.theia || window.buct).getAuthStatus(),
          (window.theia || window.buct).getApiStatus(),
          (window.theia || window.buct).getCredentialStatus(),
          (window.theia || window.buct).getAcademicApiCredentialStatus(),
          (window.theia || window.buct).getModelStatus(),
          (window.theia || window.buct).getCourseSelection()
        ]).then(([snapshot, advisorOverview, advisorThread, authStatus, apiStatus, credentialStatus, academicApiCredentialStatus, modelStatus, courseSelection]) => ({
          snapshotSchema: snapshot.schema,
          advisorOverview: {
            schema: advisorOverview.schema,
            snapshotRevision: advisorOverview.snapshotRevision,
            dataQualityRevision: advisorOverview.dataQuality?.snapshotRevision,
          },
          advisorThread,
          collections: ['courses', 'schedule', 'exams', 'grades', 'selectedCourses', 'assignments', 'workspaces', 'notices']
            .filter((name) => Array.isArray(snapshot[name])),
          hasAcademicProgress: snapshot.academicProgress === null || typeof snapshot.academicProgress === 'object',
          authSources: Object.keys(authStatus).sort(),
          apiStatus,
          credentialStatus,
          academicApiCredentialStatus,
          modelStatus,
          courseSelection,
        }))`)
        const smokePdf = await renderMarkdownToPdf('# Packaged smoke\n\n**ok**')
        const pdfBytes = smokePdf.length
        const pdfHeader = smokePdf.subarray(0, 4).toString('ascii')
        const ocrRuntimeOk = await probeAcademicCalendarOcrRuntime()
        const ok = bridge.type === 'object'
          && bridge.methods.length === bridge.requiredMethods.length
          && calls.snapshotSchema === 'theia-campus-data/v1'
          && calls.collections.length === 8
          && calls.hasAcademicProgress
          && calls.advisorOverview.schema === 'theia-advisor-overview/v1'
          && typeof calls.advisorOverview.snapshotRevision === 'string'
          && calls.advisorOverview.snapshotRevision.length > 0
          && calls.advisorOverview.dataQualityRevision === calls.advisorOverview.snapshotRevision
          && typeof calls.advisorThread.id === 'string'
          && calls.advisorThread.id.length > 0
          && calls.advisorThread.listed === true
          && calls.authSources.includes('jwglxt')
          && calls.authSources.includes('theol')
          && calls.apiStatus.host === '127.0.0.1'
          && typeof calls.credentialStatus.saved === 'boolean'
          && typeof calls.academicApiCredentialStatus.saved === 'boolean'
          && calls.academicApiCredentialStatus.enabled === false
          && typeof calls.modelStatus.configured === 'boolean'
          && (calls.courseSelection.active === null || typeof calls.courseSelection.active === 'object')
          && pdfHeader === '%PDF'
          && pdfBytes > 1_000
          && ocrRuntimeOk
          && preloadErrors.length === 0
        await finishSmoke({ ok, stage: 'renderer', bridge, calls, pdfBytes, ocrRuntimeOk })
      } catch (error) {
        await finishSmoke({ ok: false, stage: 'renderer', error: error?.stack || error?.message || String(error) })
      }
    })
    await window.loadURL(state.mainEntryUrl)
    if (!smokeFile && !window.isDestroyed() && !window.isVisible()) {
      if (state.splashWindow && !state.splashWindow.isDestroyed()) state.splashWindow.close()
      state.splashWindow = null
      window.show()
    }
  }
  
  return { createSplashWindow, createMainWindow }
}
