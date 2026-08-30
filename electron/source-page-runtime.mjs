import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { JWGLXT_URLS } from '../core/adapters/jwglxt.mjs'

/**
 * Owns rendered campus page I/O. The main process supplies the guarded window
 * primitives and mutable browser slots; this module keeps page queues,
 * navigation fallbacks, form submission, and capture bookkeeping together.
 */
export function createSourcePageRuntime({
  BrowserWindow,
  sourceFromUrl,
  permittedSourceUrl,
  sourceWindowOptions,
  guardSourceWindow,
  loadSourceWindowUrl,
  closeWindowAndWait,
  syncPageQueue,
  fitnessPageQueue,
  getSyncPageWindow,
  setSyncPageWindow,
  getFitnessPageWindow,
  setFitnessPageWindow,
  pageCaptureOutput = null,
  pageCaptureLog = [],
  diagnosticUrl = (url) => url,
  diagnosticError = (error) => String(error?.message || error),
  writeDiagnostic = async () => {},
} = {}) {
  let pageCaptureIndex = 0

  async function captureRenderedPage(url, text) {
    if (!pageCaptureOutput) return
    const parsed = new URL(url)
    const label = `${String(++pageCaptureIndex).padStart(2, '0')}-${parsed.hostname}${parsed.pathname}`
      .replace(/[^a-zA-Z0-9.-]+/g, '_')
      .replace(/^_+|_+$/g, '')
    await mkdir(pageCaptureOutput, { recursive: true })
    const file = resolve(pageCaptureOutput, `${label || 'page'}.html`)
    await writeFile(file, text, 'utf8')
    pageCaptureLog.push({
      index: pageCaptureIndex,
      url: `${parsed.origin}${parsed.pathname}`,
      bytes: Buffer.byteLength(String(text || '')),
      file,
    })
  }

  async function fetchRenderedPageInWindow(window, target) {
    const payload = JSON.stringify({ url: target })
    const result = await Promise.race([
      window.webContents.executeJavaScript(`(async ({ url }) => {
        const response = await fetch(url, { credentials: 'include' })
        return { url: response.url, status: response.status, text: await response.text() }
      })(${payload})`),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Rendered page fetch timed out')), 30_000)),
    ])
    if (Number(result?.status || 0) < 200 || Number(result?.status || 0) >= 300) {
      throw new Error(`Rendered page fetch failed (${result?.status || 0})`)
    }
    const text = String(result?.text || '')
    if (!text) throw new Error('Rendered page fetch returned an empty document')
    return { url: result?.url || target, text }
  }

  function raceRenderedOperation(operation, timeoutMs, message) {
    let timer
    return Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ]).finally(() => {
      if (timer) clearTimeout(timer)
    })
  }

  async function loadWithBackgroundBrowser(url, {
    signal = null,
    currentWindow,
    setCurrentWindow,
    title,
    allowTheol = false,
    upgradeTyglRedirects = false,
  } = {}) {
    const target = permittedSourceUrl(url)
    if (!allowTheol && sourceFromUrl(target) === 'theol') {
      throw new Error('The fitness browser cannot navigate to the course platform')
    }
    let window = currentWindow()
    if (!window || window.isDestroyed()) {
      window = new BrowserWindow(sourceWindowOptions({ title, width: 1, height: 1, show: false }))
      guardSourceWindow(window, { upgradeTyglRedirects })
      setCurrentWindow(window)
      window.on('closed', () => {
        if (currentWindow() === window) setCurrentWindow(null)
      })
    }
    if (upgradeTyglRedirects) window.__theiaUpgradeTyglRedirects = true
    let timeout
    let rejectAborted
    const cancelNavigation = () => {
      try { window?.webContents.stop() } catch { /* the window may already be closing */ }
      rejectAborted?.(new Error('Background page navigation aborted'))
    }
    if (signal?.aborted) throw new Error('Background page navigation aborted')
    const theolLease = sourceFromUrl(target) === 'theol'
    if (theolLease) window.__theiaTheolLease = true
    signal?.addEventListener?.('abort', cancelNavigation, { once: true })
    try {
      try {
        await Promise.race([
          loadSourceWindowUrl(window, target, { signal }),
          new Promise((_, reject) => { rejectAborted = reject }),
          new Promise((_, reject) => {
            timeout = setTimeout(() => {
              try { window.webContents.stop() } catch { /* the window may already be closing */ }
              reject(new Error('Background page navigation timed out'))
            }, 45_000)
          }),
        ])
      } finally {
        if (timeout) clearTimeout(timeout)
      }
      if (signal?.aborted) throw new Error('Background page navigation aborted')
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 600))
      if (signal?.aborted) throw new Error('Background page navigation aborted')
      const text = await window.webContents.executeJavaScript('document.documentElement?.outerHTML || ""')
      const finalUrl = permittedSourceUrl(window.webContents.getURL() || target)
      await captureRenderedPage(finalUrl, text)
      return { url: finalUrl, text }
    } catch (error) {
      // Some Zhengfang pages keep a subresource open indefinitely. The DOM
      // document itself is still available through the authenticated renderer,
      // so fetch the same page from that context before discarding the window.
      const canUseRenderedFetch = !signal?.aborted
        && !window.isDestroyed()
        && /timed out|ERR_(?:ABORTED|FAILED|CONNECTION_RESET)|failed to load/iu.test(diagnosticError(error))
      if (canUseRenderedFetch) {
        try {
          const fallback = await fetchRenderedPageInWindow(window, target)
          const finalUrl = permittedSourceUrl(fallback.url || target)
          await captureRenderedPage(finalUrl, fallback.text)
          void writeDiagnostic('source.rendered_fetch_fallback', {
            source: sourceFromUrl(target),
            url: diagnosticUrl(target),
            reason: diagnosticError(error),
          })
          return fallback
        } catch (fallbackError) {
          void writeDiagnostic('source.rendered_fetch_fallback_failed', {
            source: sourceFromUrl(target),
            url: diagnosticUrl(target),
            error: diagnosticError(fallbackError),
          })
        }
      }
      // A timed-out or failed navigation can leave a hidden BrowserWindow with
      // a broken renderer. Reusing it causes every later sync to fail in the
      // same way, so discard it and let the next request create a clean window.
      if (currentWindow() === window) setCurrentWindow(null)
      await closeWindowAndWait(window)
      void writeDiagnostic('source.background_window_reset', {
        source: sourceFromUrl(target),
        url: diagnosticUrl(target),
        error: diagnosticError(error),
      })
      throw error
    } finally {
      signal?.removeEventListener?.('abort', cancelNavigation)
      if (theolLease && !window.isDestroyed()) window.__theiaTheolLease = false
    }
  }

  function loadWithSchoolBrowser(url, options = {}) {
    return loadWithBackgroundBrowser(url, {
      ...options,
      currentWindow: getSyncPageWindow,
      setCurrentWindow: setSyncPageWindow,
      title: 'THEIA background sync',
      allowTheol: true,
    })
  }

  function loadWithFitnessBrowser(url, options = {}) {
    return loadWithBackgroundBrowser(url, {
      ...options,
      currentWindow: getFitnessPageWindow,
      setCurrentWindow: setFitnessPageWindow,
      title: 'THEIA fitness sync',
      upgradeTyglRedirects: true,
    })
  }

  function loadSchoolPage(url, options = {}) {
    const priority = typeof options === 'number' ? options : Number(options?.priority) || 0
    const signal = typeof options === 'object' ? options?.signal || null : null
    return syncPageQueue.enqueue(() => loadWithSchoolBrowser(url, { signal }), { priority })
  }

  function loadFitnessBrowserPage(url, options = {}) {
    const priority = typeof options === 'number' ? options : Number(options?.priority) || 0
    const signal = typeof options === 'object' ? options?.signal || null : null
    return fitnessPageQueue.enqueue(() => loadWithFitnessBrowser(url, { signal }), { priority })
  }

  async function loadFitnessPageWithSchoolBrowser({ year } = {}) {
    const home = await loadWithFitnessBrowser('https://tygl.buct.edu.cn/')
    const window = getFitnessPageWindow()
    if (!window || window.isDestroyed()) throw new Error('Fitness browser is unavailable')
    const clickResult = await window.webContents.executeJavaScript(`(() => {
      const text = (element) => String(element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim()
      // The health cloud exposes this as a nested anchor. Clicking its parent
      // changes no location, so prefer the actual link before generic controls.
      const candidates = [...document.querySelectorAll('a[href], button, [role="button"], [onclick], li, div')]
        .filter((element) => element.offsetParent !== null && /体质测试|体测成绩|体质健康/.test(text(element)))
        .sort((left, right) =>
          Number(right.tagName === 'A') - Number(left.tagName === 'A')
          || text(left).length - text(right).length,
        )
      const target = candidates[0]
      if (!target) return { clicked: null }
      const label = text(target)
      const href = target.tagName === 'A' ? target.getAttribute('href') : null
      if (href && !/^javascript:/i.test(href)) return { clicked: label, href }
      target.click()
      return { clicked: label, href: null }
    })()`).catch(() => ({ clicked: null }))

    if (clickResult.href) {
      await loadWithFitnessBrowser(new URL(clickResult.href, home.url).toString())
    } else {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 900))
    }
    const yearLinks = await window.webContents.executeJavaScript(`(() => {
      const rank = (value) => {
        const match = String(value || '').match(/(20\d{2})(?:\D+(\d+))?/)
        return match ? Number(match[1]) * 100 + Number(match[2] || 0) : -1
      }
      return [...document.querySelectorAll('a[href]')]
        .map((anchor) => {
          const href = anchor.getAttribute('href') || ''
          const yearKey = new URL(href, location.href).searchParams.get('year')
          return { label: String(anchor.textContent || '').trim(), href, yearKey }
        })
        .filter((entry) => /20\d{2}/.test(entry.label) && /title=stu_ht_score/.test(entry.href) && entry.yearKey)
        .sort((left, right) => rank(right.label) - rank(left.label))
        .slice(0, 12)
    })()`).catch(() => [])

    const availableYears = yearLinks.map(({ label, yearKey }) => ({ label, yearKey }))
    const requestedYear = /^20\d{2}-20\d{2}_\d+$/.test(String(year || '')) ? String(year) : null
    const candidateYears = requestedYear
      ? yearLinks.filter((entry) => entry.yearKey === requestedYear)
      : yearLinks
    let linkedYear = null
    let selectedYearKey = null
    for (const yearLink of candidateYears) {
      await loadWithFitnessBrowser(new URL(yearLink.href, window.webContents.getURL() || home.url).toString())
      const measurementCount = await window.webContents.executeJavaScript(`(() => {
        const numeric = (value) => /\d/.test(String(value || '').replace(/20\d{2}/g, ''))
        for (const row of document.querySelectorAll('tr')) {
          const cells = [...row.querySelectorAll(':scope > td')].map((cell) => String(cell.textContent || '').trim())
          for (const [label, result] of [[cells[0], cells[1]], [cells[4], cells[5]]]) {
            if (/肺活量|50\s*米|坐立.*前屈|立定|引体|仰卧|1000\s*米|800\s*米/.test(label || '') && numeric(result)) return 1
          }
        }
        return 0
      })()`).catch(() => 0)
      linkedYear = yearLink.label || null
      selectedYearKey = yearLink.yearKey || null
      if (measurementCount) break
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_100))
    const text = await window.webContents.executeJavaScript('document.documentElement?.outerHTML || ""')
    const url = window.webContents.getURL() || home.url
    await captureRenderedPage(url, text)
    await writeDiagnostic('fitness.page_interacted', {
      url: diagnosticUrl(url),
      clicked: clickResult.clicked || null,
      selectedYear: linkedYear || null,
      bytes: Buffer.byteLength(text),
    })
    return { url, text, availableYears, yearKey: selectedYearKey }
  }

  function loadFitnessPage(options) {
    return fitnessPageQueue.enqueue(() => loadFitnessPageWithSchoolBrowser(options), { priority: 2 })
  }

  async function submitWithSchoolBrowser(rawUrl, values, { referer } = {}) {
    const url = permittedSourceUrl(rawUrl)
    if (referer) await loadWithSchoolBrowser(permittedSourceUrl(referer))
    const window = getSyncPageWindow()
    if (!window || window.isDestroyed()) throw new Error('Background school browser is unavailable')
    const payload = JSON.stringify({ url, values: values || {} })
    let result
    try {
      result = await raceRenderedOperation(window.webContents.executeJavaScript(`(async ({ url, values }) => {
        const response = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: new URLSearchParams(values).toString(),
        })
        return { url: response.url, status: response.status, text: await response.text() }
      })(${payload})`), 45_000, 'Rendered form request timed out')
    } catch (error) {
      if (getSyncPageWindow() === window) setSyncPageWindow(null)
      await closeWindowAndWait(window)
      void writeDiagnostic('source.background_form_window_reset', {
        source: sourceFromUrl(url),
        url: diagnosticUrl(url),
        error: diagnosticError(error),
      })
      throw error
    }
    await captureRenderedPage(result.url || url, result.text || '')
    return result
  }

  async function submitWithFitnessBrowser(rawUrl, values, { referer } = {}) {
    const url = permittedSourceUrl(rawUrl)
    if (sourceFromUrl(url) === 'theol') throw new Error('The fitness browser cannot submit to the course platform')
    if (referer) await loadWithFitnessBrowser(permittedSourceUrl(referer))
    const window = getFitnessPageWindow()
    if (!window || window.isDestroyed()) throw new Error('Fitness browser is unavailable')
    const payload = JSON.stringify({ url, values: values || {} })
    const result = await window.webContents.executeJavaScript(`(async ({ url, values }) => {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: new URLSearchParams(values).toString(),
      })
      return { url: response.url, status: response.status, text: await response.text() }
    })(${payload})`)
    await captureRenderedPage(result.url || url, result.text || '')
    return result
  }

  function submitSchoolForm(url, values, options) {
    return syncPageQueue.enqueue(() => submitWithSchoolBrowser(url, values, options), { priority: 0 })
  }

  async function loadBinaryWithSchoolBrowser(rawUrl, {
    signal = null,
    timeoutMs = 25_000,
    method = 'GET',
    headers = {},
    body,
    referer = null,
  } = {}) {
    return syncPageQueue.enqueue(async () => {
      const url = permittedSourceUrl(rawUrl)
      if (signal?.aborted) throw new Error('Background binary navigation aborted')
      let window = getSyncPageWindow()
      if (!window || window.isDestroyed()) {
        await loadWithSchoolBrowser(JWGLXT_URLS.home, { signal })
        window = getSyncPageWindow()
      }
      if (!window || window.isDestroyed()) throw new Error('Background school browser is unavailable')
      const requestMethod = String(method || 'GET').toUpperCase()
      const requestHeaders = { ...(headers || {}) }
      let requestReferer = referer ? String(referer) : ''
      for (const [name, value] of Object.entries(requestHeaders)) {
        if (String(name).toLowerCase() !== 'referer') continue
        if (!requestReferer) requestReferer = String(value || '')
        delete requestHeaders[name]
      }
      const payload = JSON.stringify({
        url,
        timeoutMs: Math.max(1_000, Number(timeoutMs) || 25_000),
        method: requestMethod,
        headers: requestHeaders,
        body: body === undefined ? null : String(body),
        referer: requestReferer || null,
      })
      let timeout
      const result = await Promise.race([
        window.webContents.executeJavaScript(`(async ({ url, timeoutMs, method, headers, body, referer }) => {
        const abortController = new AbortController()
        const timeout = setTimeout(() => abortController.abort(), timeoutMs)
        const request = { method, credentials: 'include', headers: headers || {} }
        if (referer) request.referrer = referer
        if (body !== null && !['GET', 'HEAD'].includes(method)) request.body = body
        request.signal = abortController.signal
        try {
          const response = await fetch(url, request)
          const buffer = new Uint8Array(await response.arrayBuffer())
          let binary = ''
          const chunkSize = 0x8000
          for (let index = 0; index < buffer.length; index += chunkSize) {
            binary += String.fromCharCode(...buffer.subarray(index, Math.min(index + chunkSize, buffer.length)))
          }
          const contentType = response.headers.get('content-type') || ''
          const text = /html|text\\//i.test(contentType) && buffer.length <= 1024 * 1024
            ? new TextDecoder().decode(buffer)
            : ''
          return { url: response.url, status: response.status, contentType, base64: btoa(binary), text }
        } finally {
          clearTimeout(timeout)
        }
      })(${payload})`),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Background binary request timed out')), Math.max(1_000, Number(timeoutMs) || 25_000) + 1_000)
        }),
      ]).finally(() => clearTimeout(timeout))
      return {
        url: result?.url || url,
        status: Number(result?.status || 0),
        headers: new Headers({ 'content-type': String(result?.contentType || '') }),
        text: String(result?.text || ''),
        buffer: Buffer.from(String(result?.base64 || ''), 'base64'),
      }
    }, { priority: 0 })
  }

  function submitFitnessForm(url, values, options = {}) {
    const priority = Number(options?.priority) || 0
    return fitnessPageQueue.enqueue(() => submitWithFitnessBrowser(url, values, options), { priority })
  }

  return {
    loadWithBackgroundBrowser,
    loadWithSchoolBrowser,
    loadWithFitnessBrowser,
    loadSchoolPage,
    loadFitnessBrowserPage,
    loadFitnessPageWithSchoolBrowser,
    loadFitnessPage,
    submitWithSchoolBrowser,
    submitWithFitnessBrowser,
    submitSchoolForm,
    loadBinaryWithSchoolBrowser,
    submitFitnessForm,
  }
}
