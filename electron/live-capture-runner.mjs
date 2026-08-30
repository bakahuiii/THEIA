import { AcademicApiClient } from '../core/academic-api-client.mjs'
import { mkdir } from 'node:fs/promises'
import { JwglxtAdapter } from '../core/adapters/jwglxt.mjs'
import { compareLiveCaptureResults, createLiveCaptureAttachmentStore, liveCaptureResultCounts, writeLiveCaptureJson } from './live-capture-report.mjs'

export function createLiveCaptureRunner({
  output,
  pageCaptureLog = [],
  schoolSession,
  academicApiVault,
  academicSessionClient,
  getSchoolProxyReady = () => Promise.resolve(),
  openLoginWindow,
  waitForAuthentication,
  closeAuthenticationActors,
  verifiedStatus,
  diagnosticUrl = (url) => url,
  diagnosticError = (error) => String(error?.message || error),
  writeDiagnostic = async () => {},
  getAuthEpoch = () => 0,
} = {}) {
  async function run() {
    if (!output) throw new Error('live capture output is not configured')
    await mkdir(output, { recursive: true })
    const startedAt = new Date().toISOString()
    const runStartedMs = Date.now()
    const diagnostics = { browser: [], api: [] }
    const diagnosticFor = (channel) => (event, fields = {}) => {
      const safe = { event, ...fields }
      if (safe.error) safe.error = diagnosticError(safe.error)
      if (safe.url) safe.url = diagnosticUrl(safe.url)
      if (safe.referer) safe.referer = diagnosticUrl(safe.referer)
      diagnostics[channel].push(safe)
      void writeDiagnostic(`live_capture.${channel}.${event}`, safe)
    }

    await getSchoolProxyReady().catch(() => undefined)
    const authStartedMs = Date.now()
    let authStatus = null
    let authError = null
    let apiBootstrapClient = null
    try {
      const actors = await openLoginWindow({
        background: true,
        sources: ['jwglxt'],
        expectedEpoch: getAuthEpoch(),
        requireBrowser: true,
        skipSync: true,
      })
      authStatus = await waitForAuthentication(actors, 25_000)
    } catch (error) {
      authError = diagnosticError(error)
      // The real CAS page may require an interactive anti-bot slider. Do not
      // synthesize or bypass that challenge. Use a separately authorized API
      // account only to seed a temporary browser cookie jar for this capture.
      await closeAuthenticationActors('live capture auth fallback')
      try {
        const credentialStatus = await academicApiVault.status()
        if (!credentialStatus.saved || credentialStatus.error) throw error
        const credentials = await academicApiVault.readCredentials()
        apiBootstrapClient = new AcademicApiClient({ ...credentials, onDiagnostic: diagnosticFor('api') })
        await apiBootstrapClient.login()
        const apiCookieNames = [...apiBootstrapClient.cookies.keys()]
        const browserCookieUrl = 'https://jwglxt.buct.edu.cn/jwglxt/'
        const existingBrowserCookies = await schoolSession.cookies.get({ url: browserCookieUrl })
        for (const cookie of existingBrowserCookies) {
          if (cookie.name === 'JSESSIONID' || apiCookieNames.includes(cookie.name)) {
            await schoolSession.cookies.remove(browserCookieUrl, cookie.name).catch(() => undefined)
          }
        }
        for (const [name, value] of apiBootstrapClient.cookies.entries()) {
          await schoolSession.cookies.set({
            url: browserCookieUrl,
            name,
            value,
            path: '/',
            secure: true,
            httpOnly: true,
          })
        }
        void writeDiagnostic('live_capture.api_cookie_bridge', {
          names: apiCookieNames,
          browserCookiesAfterSet: (await schoolSession.cookies.get({ url: browserCookieUrl })).map((cookie) => cookie.name),
        })
        const browserStatus = await new JwglxtAdapter(academicSessionClient, {
          onDiagnostic: diagnosticFor('browser'),
        }).status()
        if (!browserStatus.connected) {
          void writeDiagnostic('live_capture.api_cookie_bridge_failed', {
            status: { connected: browserStatus.connected, error: browserStatus.error || null, url: browserStatus.url || null },
          })
          throw new Error(browserStatus.error || 'API 会话未能在页面上下文中建立')
        }
        authStatus = {
          ...browserStatus,
          mode: 'direct-api-cookie-bridge-for-rendered-capture',
          fallbackFrom: authError,
        }
        authError = null
      } catch (fallbackError) {
        authError = diagnosticError(fallbackError)
        await writeLiveCaptureJson(output, 'auth-error.json', {
          error: authError,
          fallbackFrom: diagnosticError(error),
          elapsedMs: Date.now() - authStartedMs,
          status: await verifiedStatus('jwglxt').catch(() => null),
        })
        throw fallbackError
      }
    }

    const browserAttachmentStore = createLiveCaptureAttachmentStore(output, 'browser')
    const apiAttachmentStore = createLiveCaptureAttachmentStore(output, 'api')
    let browserCapture = null
    let apiCapture = null
    let apiError = null
    try {
      const browserAdapter = new JwglxtAdapter(academicSessionClient, {
        attachmentStore: browserAttachmentStore,
        onDiagnostic: diagnosticFor('browser'),
      })
      const browserStartedAt = new Date().toISOString()
      const browserStartedMs = Date.now()
      const browserResult = await browserAdapter.sync({ includeAcademicExtras: true })
      browserCapture = {
        mode: 'authenticated-browser-session-rendered',
        startedAt: browserStartedAt,
        completedAt: new Date().toISOString(),
        elapsedMs: Date.now() - browserStartedMs,
        auth: authStatus,
        counts: liveCaptureResultCounts(browserResult),
        result: browserResult,
      }
      await writeLiveCaptureJson(output, 'browser-result.json', browserCapture)
    } catch (error) {
      const message = diagnosticError(error)
      await writeLiveCaptureJson(output, 'browser-error.json', { error: message })
      throw error
    }

    try {
      const credentialStatus = await academicApiVault.status()
      if (!credentialStatus.saved || credentialStatus.error) {
        apiError = credentialStatus.error || 'saved API credentials are unavailable'
      } else {
        const credentials = await academicApiVault.readCredentials()
        const apiClient = apiBootstrapClient || new AcademicApiClient({ ...credentials, onDiagnostic: diagnosticFor('api') })
        const apiAdapter = new JwglxtAdapter(apiClient, {
          academicProgressSource: 'api',
          attachmentStore: apiAttachmentStore,
          scheduleEndpoints: ['kbcx/xskbcx_cxXsKb.html?gnmkdm=N2151', 'kbcx/xskbcx_cxXsgrkb.html'],
          onDiagnostic: diagnosticFor('api'),
        })
        const apiStartedAt = new Date().toISOString()
        const apiStartedMs = Date.now()
        if (!apiBootstrapClient) await apiClient.login()
        const apiResult = await apiAdapter.sync({ includeAcademicExtras: true })
        apiCapture = {
          mode: 'direct-api-client',
          startedAt: apiStartedAt,
          completedAt: new Date().toISOString(),
          elapsedMs: Date.now() - apiStartedMs,
          counts: liveCaptureResultCounts(apiResult),
          result: apiResult,
        }
        await writeLiveCaptureJson(output, 'api-result.json', apiCapture)
      }
    } catch (error) {
      apiError = diagnosticError(error)
      await writeLiveCaptureJson(output, 'api-error.json', { error: apiError })
    }

    const comparison = compareLiveCaptureResults(browserCapture, apiCapture)
    await writeLiveCaptureJson(output, 'comparison.json', comparison)
    await writeLiveCaptureJson(output, 'browser-request-log.json', pageCaptureLog)
    await writeLiveCaptureJson(output, 'diagnostics.json', diagnostics)
    await writeLiveCaptureJson(output, 'run-meta.json', {
      schema: 'theia-live-capture/v2',
      startedAt,
      completedAt: new Date().toISOString(),
      elapsedMs: Date.now() - runStartedMs,
      output,
      browser: {
        mode: browserCapture?.mode || null,
        elapsedMs: browserCapture?.elapsedMs || null,
        requestCount: pageCaptureLog.length,
        error: browserCapture ? null : authError,
      },
      api: {
        mode: apiCapture?.mode || null,
        elapsedMs: apiCapture?.elapsedMs || null,
        error: apiError,
      },
      auth: {
        verified: Boolean(authStatus?.connected),
        elapsedMs: Date.now() - authStartedMs,
      },
    })
    return { output, browser: browserCapture?.counts || null, api: apiCapture?.counts || null, apiError }
  }

  return { run }
}
