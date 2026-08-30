function authEndpointPath(rawUrl) {
  try {
    return new URL(String(rawUrl || '')).pathname
  } catch {
    return ''
  }
}

function isAuthEndpointUrl(rawUrl) {
  return /\/cas\/(?:username-password\/login|info-query|api\/reset\/rules|captcha)(?:[/?#]|$)/i.test(authEndpointPath(rawUrl))
}

function authResponseSummary(payload) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : null
  const typed = (value) => {
    if (typeof value === 'string') return value.slice(0, 80)
    if (value === null || value === undefined) return null
    return typeof value
  }
  return {
    dataKeys: data ? Object.keys(data).slice(0, 32) : [],
    flowKeyPresent: Boolean(data?.flowKey),
    servicePresent: data?.service !== undefined && data?.service !== null,
    serviceType: data?.service === undefined || data?.service === null ? null : typeof data.service,
    mfaType: typed(data?.mfa),
    captchaType: typed(data?.captcha),
  }
}

export async function installAuthDebuggerDiagnostics(actor, { isCurrentAuthActor, writeDiagnostic, diagnosticError }) {
  const window = actor?.window
  if (!isCurrentAuthActor(actor, window)) return
  if (actor.authDebuggerPromise) return actor.authDebuggerPromise
  actor.authDebuggerPromise = (async () => {
    const debuggerApi = window.webContents?.debugger
    if (!debuggerApi) return
    try {
      if (!debuggerApi.isAttached()) debuggerApi.attach('1.3')
      const requests = actor.authDebuggerRequests
      const current = () => isCurrentAuthActor(actor, window)
      const responseFor = (requestId) => requests.get(String(requestId)) || null
      const parsePayload = (body) => {
        try {
          const parsed = JSON.parse(String(body || ''))
          if (typeof parsed === 'string') return parsePayload(parsed)
          return parsed && typeof parsed === 'object' ? parsed : null
        } catch { return null }
      }
      debuggerApi.on('message', async (_event, method, params) => {
        if (!current()) return
        if (method === 'Network.requestWillBeSent') {
          const request = params?.request
          const url = String(request?.url || '')
          if (!isAuthEndpointUrl(url)) return
          const requestHeaders = request?.headers && typeof request.headers === 'object' ? request.headers : {}
          const xRequestedWith = Object.keys(requestHeaders).find((key) => key.toLowerCase() === 'x-requested-with')
          const postData = String(request?.postData || '')
          let parsedPostData = null
          try { parsedPostData = JSON.parse(postData) } catch { /* form body is intentionally not retained */ }
          const body = parsedPostData && typeof parsedPostData === 'object' ? parsedPostData : null
          const keys = body ? Object.keys(body).slice(0, 32) : []
          const passwordValue = typeof body?.password === 'string' ? body.password : ''
          const flowKeyValue = typeof body?.flowKey === 'string' ? body.flowKey : ''
          requests.set(String(params.requestId), {
            url: authEndpointPath(url),
            status: null,
            method: String(request?.method || 'GET').toUpperCase(),
            bodyKeys: keys,
            bodyLength: postData.length || 0,
            passwordLength: passwordValue.length || 0,
            flowKeyPresent: Boolean(flowKeyValue),
            flowKeyLength: flowKeyValue.length || 0,
            xRequestedWith: Boolean(xRequestedWith),
          })
          void writeDiagnostic('auth.endpoint_request', {
            source: actor.source,
            url: authEndpointPath(url),
            method: String(request?.method || 'GET').toUpperCase(),
            bodyKeys: keys,
            bodyLength: postData.length || 0,
            passwordLength: passwordValue.length || 0,
            flowKeyPresent: Boolean(flowKeyValue),
            flowKeyLength: flowKeyValue.length || 0,
            xRequestedWith: Boolean(xRequestedWith),
          })
          return
        }
        if (method === 'Network.responseReceived') {
          const response = params?.response
          const url = String(response?.url || '')
          if (!isAuthEndpointUrl(url)) return
          requests.set(String(params.requestId), {
            ...(requests.get(String(params.requestId)) || {}),
            url: authEndpointPath(url),
            status: Number(response?.status) || null,
          })
          return
        }
        if (method === 'Network.loadingFailed') {
          const request = responseFor(params?.requestId)
          if (!request) return
          requests.delete(String(params.requestId))
          void writeDiagnostic('auth.endpoint_request_failed', {
            source: actor.source,
            url: request.url,
            status: request.status,
            method: request.method || null,
            bodyKeys: request.bodyKeys || [],
            bodyLength: request.bodyLength || 0,
            passwordLength: request.passwordLength || 0,
            flowKeyPresent: request.flowKeyPresent === true,
            flowKeyLength: request.flowKeyLength || 0,
            xRequestedWith: request.xRequestedWith === true,
            error: String(params?.errorText || 'network failure').slice(0, 240),
          })
          return
        }
        if (method !== 'Network.loadingFinished') return
        const requestId = String(params?.requestId || '')
        const request = responseFor(requestId)
        if (!request) return
        requests.delete(requestId)
        let payload = null
        try {
          const body = await debuggerApi.sendCommand('Network.getResponseBody', { requestId })
          payload = parsePayload(body?.body)
        } catch {
          // The body may be evicted before DevTools asks for it. The status
          // event below remains useful and never exposes request contents.
        }
        void writeDiagnostic('auth.endpoint_response', {
          source: actor.source,
          url: request.url,
          status: request.status,
          method: request.method || null,
          bodyKeys: request.bodyKeys || [],
          bodyLength: request.bodyLength || 0,
          passwordLength: request.passwordLength || 0,
          flowKeyPresent: request.flowKeyPresent === true,
          flowKeyLength: request.flowKeyLength || 0,
          xRequestedWith: request.xRequestedWith === true,
          code: payload?.code ?? null,
          msg: typeof payload?.msg === 'string' ? payload.msg.slice(0, 240) : null,
          ...authResponseSummary(payload),
        })
      })
      await debuggerApi.sendCommand('Network.enable')
      actor.authDebuggerAttached = true
      void writeDiagnostic('auth.network_probe_ready', { source: actor.source })
    } catch (error) {
      actor.authDebuggerPromise = null
      if (current()) void writeDiagnostic('auth.network_probe_failed', { source: actor.source, error: diagnosticError(error) })
    }
  })()
  return actor.authDebuggerPromise
}

export async function installAuthNetworkDiagnostics(actor, { isCurrentAuthActor, writeDiagnostic, diagnosticError }) {
  const window = actor?.window
  if (!isCurrentAuthActor(actor, window)) return
  try {
    // The CAS page performs its login through the top-level jQuery instance,
    // while the username/password form lives in an iframe. Wrap only the
    // response callbacks and retain status/code/message; never persist the
    // request body or any credential-bearing headers.
    await window.webContents.executeJavaScript(`(() => {
      if (window.__theiaAuthAjaxProbe === true) return 'already-installed'
      const ajax = window.jQuery?.ajax
      if (typeof ajax !== 'function') return 'jquery-pending'
      const pathOf = (value) => {
        try {
          const url = new URL(String(value || ''), location.href)
          return url.pathname
        } catch { return '[invalid-url]' }
      }
      const shouldProbe = (value) => /\\/(?:username-password\\/login|info-query|api\\/reset\\/rules|captcha)(?:[/?#]|$)/i.test(pathOf(value))
      const report = (kind, url, data = {}) => {
        try {
          const payload = data?.payload && typeof data.payload === 'object' ? data.payload : null
          const responseData = payload?.data && typeof payload.data === 'object' ? payload.data : null
          const typed = (value) => {
            if (typeof value === 'string') return value.slice(0, 80)
            if (value === null || value === undefined) return null
            return typeof value
          }
          const record = {
            kind,
            url: pathOf(url),
            status: Number.isFinite(data?.status) ? data.status : null,
            code: payload && Object.hasOwn(payload, 'code') ? payload.code : null,
            msg: typeof payload?.msg === 'string' ? payload.msg.slice(0, 240) : null,
            dataKeys: responseData ? Object.keys(responseData).slice(0, 32) : [],
            flowKeyPresent: Boolean(responseData?.flowKey),
            servicePresent: responseData?.service !== undefined && responseData?.service !== null,
            serviceType: responseData?.service === undefined || responseData?.service === null ? null : typeof responseData.service,
            mfaType: typed(responseData?.mfa),
            captchaType: typed(responseData?.captcha),
          }
          console.info('__THEIA_AUTH_RESPONSE__' + JSON.stringify(record))
        } catch {}
      }
      window.jQuery.ajax = function patchedAuthAjax(options, ...rest) {
        const request = options && typeof options === 'object' ? { ...options } : options
        const requestUrl = typeof request === 'string' ? request : request?.url
        if (!shouldProbe(requestUrl) || !request || typeof request !== 'object') return ajax.call(this, options, ...rest)
        const success = request.success
        const error = request.error
        request.success = function patchedAuthSuccess(payload, ...args) {
          report('success', requestUrl, { payload })
          return typeof success === 'function' ? success.call(this, payload, ...args) : undefined
        }
        request.error = function patchedAuthError(xhr, ...args) {
          report('error', requestUrl, { status: Number(xhr?.status) || null })
          return typeof error === 'function' ? error.call(this, xhr, ...args) : undefined
        }
        return ajax.call(this, request, ...rest)
      }
      window.__theiaAuthAjaxProbe = true
      return 'installed'
    })()`)
  } catch (error) {
    if (isCurrentAuthActor(actor, window)) {
      void writeDiagnostic('auth.network_probe_failed', { source: actor.source, error: diagnosticError(error) })
    }
  }
}
