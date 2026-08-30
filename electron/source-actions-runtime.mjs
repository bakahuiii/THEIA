import { open, rm, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { MAX_ATTACHMENT_RESPONSE_BYTES } from '../core/source-client.mjs'
import { JWGLXT_URLS } from '../core/adapters/jwglxt.mjs'
import { parseJwHomepage } from '../core/parsers/jwglxt.mjs'
import { htmlLooksLikeLogin } from '../core/util.mjs'

const SCHEDULE_PDF_POLICY_URL = new URL('kbdy/bjkbdy_cxXnxqsfkz.html?gnmkdm=N2151', JWGLXT_URLS.base).toString()
const SCHEDULE_PDF_URL = new URL('kbcx/xskbcx_cxXsShcPdf.html?doType=table', JWGLXT_URLS.base).toString()

function schedulePdfSemesterNumber(termCode, label = '') {
  const knownCode = { 3: '1', 12: '2', 16: '3' }[String(termCode)]
  if (knownCode) return knownCode
  return String(label).match(/(?:第|\b)\s*([1-3])\s*(?:学期|semester)?/iu)?.[1] || String(termCode)
}

export function buildSchedulePdfRequestValues({ values = {}, labels = {} } = {}) {
  const xnm = String(values.xnm || '').trim()
  const xqm = String(values.xqm || '').trim()
  if (!xnm || !xqm) throw new Error('课表页面未提供当前学期，无法输出 PDF')
  const yearNumber = Number(xnm)
  const yearLabel = String(labels.xnm || values.xnmc || '').trim()
    || (Number.isInteger(yearNumber) ? `${xnm}-${yearNumber + 1}` : xnm)
  const semesterLabel = String(labels.xqm || values.xqmmc || '').trim()
  return {
    xm: '导出',
    xnm,
    xqm,
    xnmc: yearLabel,
    xqmmc: schedulePdfSemesterNumber(xqm, semesterLabel),
    jgmc: String(values.jgmc || 'undefined'),
    xxdm: String(values.xxdm || ''),
    'xszd.sj': 'true',
    'xszd.cd': 'true',
    'xszd.js': 'true',
    'xszd.jszc': 'false',
    'xszd.jxb': 'true',
    'xszd.xkbz': 'true',
    'xszd.kcxszc': 'true',
    'xszd.zhxs': 'true',
    'xszd.zxs': 'true',
    'xszd.khfs': 'true',
    'xszd.xf': 'true',
    'xszd.skfsmc': 'false',
    kzlx: 'dy',
  }
}

/**
 * Owns user-facing campus source windows and source-bound actions. Browser
 * session and service getters keep this module independent from startup order.
 */
export function createSourceActionsRuntime({
  BrowserWindow,
  permittedSourceUrl,
  sourceFromUrl,
  sourceWindowOptions,
  guardSourceWindow,
  closeWindowAndWait,
  openTheolInteractiveWindow,
  parseJwHomepage: parseJwHomepageOverride = parseJwHomepage,
  htmlLooksLikeLogin: htmlLooksLikeLoginOverride = htmlLooksLikeLogin,
  getSyncService,
  getFitnessRuntime,
  getCredentialVault,
  getSessionClient,
  getAcademicSessionClient,
  getAuthEpoch,
  openLoginWindow,
  verifiedStatus,
  verifiedSessions,
  rememberVerifiedSession,
  assertAuthEpoch,
  diagnosticUrl,
  diagnosticError,
  writeDiagnostic,
  getDocumentsDirectory,
}) {
  const parseHomepage = parseJwHomepageOverride
  const looksLikeLogin = htmlLooksLikeLoginOverride
async function loadSourceWindowUrl(window, target, { signal = null } = {}) {
  let navigationTarget = target
  for (let upgrades = 0; ; upgrades += 1) {
    window.__theiaPendingNavigationUpgrade = null
    try {
      await window.loadURL(navigationTarget)
      return
    } catch (error) {
      const upgradedTarget = window.__theiaPendingNavigationUpgrade
      window.__theiaPendingNavigationUpgrade = null
      if (signal?.aborted || !upgradedTarget || upgrades >= 3) throw error
      navigationTarget = upgradedTarget
    }
  }
}

async function createSourceWindow(rawUrl, title = '学校原站', { pauseAssignments = false, show = false } = {}) {
  const url = permittedSourceUrl(rawUrl)
  const source = sourceFromUrl(url)
  if (source === 'theol') return openTheolInteractiveWindow(url, title)
  const window = new BrowserWindow(sourceWindowOptions({ title, show }))
  guardSourceWindow(window, { source, pauseAssignments, upgradeTyglRedirects: source === 'tygl' })
  try {
    await loadSourceWindowUrl(window, url)
    return window
  } catch (error) {
    if (!window.isDestroyed()) window.close()
    throw error
  }
}

async function inspectLoadedSourcePage(window, source, fallbackUrl) {
  if (!window || window.isDestroyed()) return { authenticated: false, url: fallbackUrl, html: '' }
  const finalUrl = permittedSourceUrl(window.webContents.getURL() || fallbackUrl)
  const html = await window.webContents.executeJavaScript('document.documentElement?.outerHTML || ""')
  const loginUrl = /experimental-auth-endpoint|(?:^|\/)login(?:[._/?#]|$)|login_slogin/i.test(finalUrl)
  // Parsing the homepage is useful evidence for JWGLXT, but detail pages do
  // not contain the homepage menu/profile markers. Treat a non-login page on
  // the expected campus host as authenticated after the explicit login checks.
  const page = source === 'jwglxt' ? parseHomepage(html, finalUrl) : null
  const loginMarkup = source === 'jwglxt' && page?.loggedIn
    ? false
    : looksLikeLogin(html, finalUrl)
  const expectedHost = source === 'jwglxt'
    ? 'jwglxt.buct.edu.cn'
    : source === 'tygl'
      ? 'tygl.buct.edu.cn'
      : new URL(fallbackUrl).hostname
  const sameCampusHost = new URL(finalUrl).hostname === expectedHost
  return {
    authenticated: sameCampusHost && !loginUrl && !loginMarkup,
    url: finalUrl,
    html,
    parserLoggedIn: Boolean(page?.loggedIn),
  }
}

async function openAuthenticatedSourceWindow(rawUrl, title = '学校原站', { pauseAssignments = false, verified = false } = {}) {
  const url = permittedSourceUrl(rawUrl)
  const source = sourceFromUrl(url)
  if (!source || source === 'theol') return createSourceWindow(url, title, { pauseAssignments })
  if (verified) {
    // Authentication actors can resolve as soon as CAS has rendered an
    // authenticated frame, while the next navigation is still racing cookie
    // propagation. Keep the first user-visible page behind the same DOM proof
    // used by the normal path; otherwise the first click can show CAS even
    // though the actor just reported success.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const window = await createSourceWindow(url, title, { pauseAssignments, show: false })
      try {
        const state = await inspectLoadedSourcePage(window, source, url)
        if (state.authenticated) {
          return window
        }
        await closeWindowAndWait(window)
      } catch (error) {
        await closeWindowAndWait(window)
        throw error
      }
      if (attempt < 2) await new Promise((resolveDelay) => setTimeout(resolveDelay, 250))
    }
    return null
  }
  const window = await createSourceWindow(url, title, { pauseAssignments, show: false })
  try {
    const state = await inspectLoadedSourcePage(window, source, url)
    if (!state.authenticated) {
      void writeDiagnostic('source.page_requires_auth', {
        source,
        requestedUrl: diagnosticUrl(url),
        finalUrl: diagnosticUrl(state.url),
        parserLoggedIn: state.parserLoggedIn,
      })
      await closeWindowAndWait(window)
      return null
    }
    return window
  } catch (error) {
    await closeWindowAndWait(window)
    throw error
  }
}

async function readSchedulePdfContext(window) {
  return window.webContents.executeJavaScript(`(() => {
    const wanted = new Set(['xnm', 'xqm', 'xnmc', 'xqmmc', 'jgmc', 'xxdm'])
    const values = {}
    const labels = {}
    const requestValues = {}
    const setRequestValue = (name, value) => {
      requestValues[name] = value === undefined || value === null ? '' : value
    }
    const form = document.querySelector('#ajaxForm')
    const controls = [...(form || document).querySelectorAll('input[name], select[name], textarea[name]')]
    for (const control of controls) {
      const name = String(control.name || '')
      if (!wanted.has(name) || control.disabled) continue
      if ((control.type === 'checkbox' || control.type === 'radio') && !control.checked) continue
      if (control.tagName === 'SELECT') {
        const option = control.selectedOptions?.[0]
        values[name] = String(option?.value ?? '')
        labels[name] = String(option?.textContent || '').replace(/\\s+/g, ' ').trim()
      } else {
        values[name] = String(control.value ?? '')
      }
    }
    const xsxx = globalThis.xsxx && typeof globalThis.xsxx === 'object' ? globalThis.xsxx : null
    const xszd = globalThis.xszd && typeof globalThis.xszd === 'object' ? globalThis.xszd : null
    if (xsxx) {
      for (const [name, key] of [
        ['xnm', 'XNM'], ['xqm', 'XQM'], ['xnmc', 'XNMC'], ['xqmmc', 'XQMMC'],
        ['jgmc', 'JGMC'], ['xm', 'XM'], ['xxdm', 'XXDM'],
      ]) setRequestValue(name, xsxx[key])
      for (const [name, key] of [
        ['modelList[0].xnm', 'XNM'], ['modelList[0].xqm', 'XQM'],
        ['modelList[0].xnmc', 'XNMC'], ['modelList[0].xqmmc', 'XQMMC'],
        ['modelList[0].xh_id', 'XH_ID'], ['modelList[0].xh', 'XH'],
        ['modelList[0].xm', 'XM'], ['modelList[0].bjmc', 'BJMC'],
      ]) setRequestValue(name, xsxx[key])
    }
    const displayFields = [
      'sj', 'cd', 'js', 'jszc', 'jxb', 'jxbzc', 'xkrs', 'xkbz', 'kcxszc',
      'zhxs', 'zxs', 'khfs', 'ksfs', 'xf', 'skfsmc', 'kch', 'zfj', 'cxbj',
      'kcxz', 'kcbj', 'kczxs', 'bklxdjmc', 'zyhxkcbj', 'cdlbmc', 'ktmc',
      'qqqh', 'skpthyh',
    ]
    if (xszd) for (const name of displayFields) setRequestValue('xszd.' + name, xszd[name])
    for (const name of ['xsdm', 'kclbdm', 'kclxdm']) {
      setRequestValue(name, document.getElementById(name)?.value || '')
      setRequestValue('modelList[0].' + name, document.getElementById(name)?.value || '')
    }
    setRequestValue('kzlx', 'dy')
    const currentUrl = String(location.href || '')
    return {
      values,
      labels,
      requestValues,
      ready: Boolean(values.xnm && values.xqm && xsxx?.XNM && xsxx?.XQM && xsxx?.XNMC && xsxx?.XQMMC && xszd),
      loggedIn: !/experimental-auth-endpoint|(?:^|\\/)login(?:[._/?#]|$)/i.test(location.hostname + location.pathname),
      url: currentUrl,
    }
  })()`)
}

async function waitForSchedulePdfContext(window, timeoutMs = 12_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (window.isDestroyed()) throw new Error('课表原站窗口已关闭')
    try {
      const state = await readSchedulePdfContext(window)
      if (state.ready) return state
      if (!state.loggedIn) throw new Error('教务系统会话已失效，请重新认证')
    } catch (error) {
      if (String(error?.message || error).includes('会话已失效')) throw error
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 400))
  }
  throw new Error('课表页面加载超时，未读取到当前学期')
}

async function openSchedulePdf(expectedEpoch = getAuthEpoch()) {
  const epoch = expectedEpoch
  assertAuthEpoch(epoch)
  let status = await verifiedStatus('jwglxt')
  assertAuthEpoch(epoch)
  if (!status) {
    status = await getSyncService().jwglxt.status()
    assertAuthEpoch(epoch)
  }
  if (!status.connected) {
    const credentials = await getCredentialVault().status().catch(() => ({ saved: false }))
    if (credentials?.saved) {
      await openLoginWindow({ background: true, sources: ['jwglxt'], expectedEpoch: epoch, requireBrowser: true, skipSync: true })
    } else await openLoginWindow({ sources: ['jwglxt'], expectedEpoch: epoch })
    assertAuthEpoch(epoch)
    throw new Error('教务系统会话未连接，请完成认证后重试')
  }
  if (!verifiedSessions.jwglxt) {
    await rememberVerifiedSession('jwglxt', status.url || JWGLXT_URLS.schedule, epoch)
    assertAuthEpoch(epoch)
  }
  assertAuthEpoch(epoch)
  let window = null
  try {
    window = await openAuthenticatedSourceWindow(JWGLXT_URLS.schedule, 'THEIA · 教务系统课表')
    if (!window) {
      verifiedSessions.jwglxt = null
      const credentials = await getCredentialVault().status().catch(() => ({ saved: false }))
      if (credentials?.saved) {
        const actors = await openLoginWindow({ background: true, sources: ['jwglxt'], expectedEpoch: epoch, requireBrowser: true, skipSync: true })
        assertAuthEpoch(epoch)
        const actor = actors?.find?.((candidate) => candidate?.source === 'jwglxt')
        if (actor?.lifecycle) await actor.lifecycle
        assertAuthEpoch(epoch)
        if (actor?.authenticated) {
          window = await openAuthenticatedSourceWindow(JWGLXT_URLS.schedule, 'THEIA · 教务系统课表', { verified: true })
          assertAuthEpoch(epoch)
        }
      } else await openLoginWindow({ sources: ['jwglxt'], expectedEpoch: epoch })
    }
    if (!window) {
      assertAuthEpoch(epoch)
      throw new Error('教务系统浏览器会话未连接，请完成认证后重试')
    }
    assertAuthEpoch(epoch)
    const pageUrl = permittedSourceUrl(window.webContents.getURL() || JWGLXT_URLS.schedule)
    await writeDiagnostic('schedule.pdf_page_opened', { url: diagnosticUrl(pageUrl) })
    const context = await waitForSchedulePdfContext(window)
    assertAuthEpoch(epoch)
    const values = context.requestValues || buildSchedulePdfRequestValues(context)
    const body = new URLSearchParams(values).toString()
    await writeDiagnostic('schedule.pdf_request_started', {
      url: diagnosticUrl(SCHEDULE_PDF_URL),
      xnm: values.xnm,
      xqm: values.xqm,
    })
    const academicClient = getAcademicSessionClient?.() || getSessionClient()
    const policyResult = await academicClient.form(SCHEDULE_PDF_POLICY_URL, values, {
      source: '教务系统课表 PDF 权限',
      referer: pageUrl,
    })
    const policyText = String(policyResult || '').trim()
    if (/^"?true"?$/iu.test(policyText)) {
      throw new Error('教务系统未开放当前学期课表 PDF 导出')
    }
    if (!/^"?false"?$/iu.test(policyText)) {
      throw new Error(`教务系统课表 PDF 权限检查返回异常：${policyText.slice(0, 80)}`)
    }
    assertAuthEpoch(epoch)
    const downloaded = await academicClient.binary(SCHEDULE_PDF_URL, {
      source: '教务系统课表 PDF',
      maxBytes: MAX_ATTACHMENT_RESPONSE_BYTES,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body,
      referer: pageUrl,
    })
    assertAuthEpoch(epoch)
    const bytes = downloaded.buffer
    await writeDiagnostic('schedule.pdf_response_received', {
      url: diagnosticUrl(downloaded.url || SCHEDULE_PDF_URL),
      status: Number(downloaded.status || 200),
      contentType: downloaded.headers?.get?.('content-type') || '',
      bytes: bytes.length,
      prefixHex: bytes.subarray(0, 16).toString('hex'),
    })
    if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('教务系统课表返回的不是有效 PDF')
    const outputDirectory = resolve(getDocumentsDirectory(), 'THEIA', '课表')
    await mkdir(outputDirectory, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '')
    const outputPath = resolve(outputDirectory, `THEIA-课表-${timestamp}.pdf`)
    await writeDiagnostic('schedule.pdf_download_started', { path: outputPath, url: diagnosticUrl(downloaded.url || SCHEDULE_PDF_URL) })
    await writeFile(outputPath, bytes)
    const result = { filePath: outputPath, bytes: bytes.length, url: downloaded.url }
    const file = await open(result.filePath, 'r')
    try {
      const header = Buffer.alloc(5)
      const { bytesRead } = await file.read(header, 0, header.length, 0)
      if (bytesRead !== header.length || !header.equals(Buffer.from('%PDF-'))) {
        await rm(result.filePath, { force: true })
        throw new Error('教务系统课表返回的不是有效 PDF')
      }
    } finally {
      await file.close()
    }
    await writeDiagnostic('schedule.pdf_download_completed', { path: result.filePath, bytes: result.bytes })
    return { canceled: false, ...result }
  } catch (error) {
    const url = window && !window.isDestroyed()
      ? window.webContents.getURL() || JWGLXT_URLS.schedule
      : JWGLXT_URLS.schedule
    await writeDiagnostic('schedule.pdf_download_failed', { error: diagnosticError(error), url: diagnosticUrl(url) })
    throw error
  } finally {
    if (window) await closeWindowAndWait(window)
  }
}

async function openCourseWorkWindow(entry, expectedEpoch = getAuthEpoch(), assertCurrentSnapshot = null) {
  const source = 'theol'
  const { assignment } = entry
  const epoch = expectedEpoch
  assertAuthEpoch(epoch)
  const assertSnapshot = typeof assertCurrentSnapshot === 'function' ? assertCurrentSnapshot : () => {}
  assertSnapshot()
  const resumeWhileOpening = getSyncService().pauseAssignmentScan()
  try {
    await getSyncService().waitForAssignmentScan()
    assertAuthEpoch(epoch)
    assertSnapshot()
    let status = await verifiedStatus(source)
    assertAuthEpoch(epoch)
    assertSnapshot()
    if (!status) {
      status = await getSyncService().runTheolExclusive(() => {
        assertAuthEpoch(epoch)
        assertSnapshot()
        return getSyncService().theol.status()
      })
      assertAuthEpoch(epoch)
      assertSnapshot()
    }
    if (!status.connected) {
      resumeWhileOpening({ schedule: false })
      assertAuthEpoch(epoch)
      assertSnapshot()
      await openLoginWindow({ sources: [source], expectedEpoch: epoch })
      assertAuthEpoch(epoch)
      assertSnapshot()
      throw new Error('北化在线THEOL会话已失效，请完成登录后重试')
    }
    if (!verifiedSessions[source]) {
      await rememberVerifiedSession(source, status.url || entry.courseSourceUrl, epoch)
      assertAuthEpoch(epoch)
      assertSnapshot()
    }
    assertAuthEpoch(epoch)
    assertSnapshot()
    const window = await openTheolInteractiveWindow(
      entry.assignmentSourceUrl,
      `${assignment.kind === 'online-test' ? '在线测试' : '课程作业'} · ${assignment.title}`,
      {
        navigationUrls: [entry.courseSourceUrl, entry.assignmentSourceUrl],
        navigationChecks: [
          { type: 'course', courseId: assignment.courseId },
          {
            type: 'task',
            courseId: assignment.courseId,
            kind: entry.kind,
            uniqueTaskId: entry.uniqueTaskId,
          },
        ],
        interactionKey: `task:${entry.uniqueTaskId}:${entry.courseSourceUrl}`,
        assertCurrentSnapshot: assertSnapshot,
      },
    )
    assertAuthEpoch(epoch)
    assertSnapshot()
    resumeWhileOpening({ schedule: false })
    return window
  } catch (error) {
    resumeWhileOpening({ schedule: false })
    throw error
  }
}

async function attachFileToSourceWindow(window, filePath) {
  const count = await window.webContents.executeJavaScript(`document.querySelectorAll('input[type="file"]').length`)
  if (!count) return { attached: false, message: '当前页面没有可识别的文件上传控件，请在内置浏览器中手动选择文件' }
  try {
    window.webContents.debugger.attach('1.3')
    const document = await window.webContents.debugger.sendCommand('DOM.getDocument', { depth: 1 })
    const node = await window.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: document.root.nodeId, selector: 'input[type="file"]' })
    if (!node.nodeId) return { attached: false, message: '未找到可用的文件上传控件，请在内置浏览器中手动选择文件' }
    await window.webContents.debugger.sendCommand('DOM.setFileInputFiles', { files: [filePath], nodeId: node.nodeId })
    return { attached: true, message: '文件已放入北化在线THEOL页面，请核对后自行点击提交' }
  } catch (error) {
    return { attached: false, message: `自动放入文件失败：${diagnosticError(error)}` }
  } finally {
    if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach()
  }
}

async function fillTestInSourceWindow(window, answerKey) {
  const payload = JSON.stringify(JSON.stringify(answerKey))
  return window.webContents.executeJavaScript(`(() => {
    const answerKey = JSON.parse(${payload})
    const visible = (node) => Boolean(node) && node.getClientRects().length > 0 && !node.disabled
    const controls = [...document.querySelectorAll('input[type="radio"], input[type="checkbox"], textarea, select')].filter(visible)
    const groups = []
    const byKey = new Map()
    for (const control of controls) {
      const type = String(control.type || control.tagName).toLowerCase()
      const name = control.name || ('field-' + groups.length)
      const key = ['radio', 'checkbox'].includes(type) ? type + ':' + name : 'field:' + name + ':' + groups.length
      if (!byKey.has(key)) {
        const group = { type, controls: [] }
        byKey.set(key, group)
        groups.push(group)
      }
      byKey.get(key).controls.push(control)
    }
    const labelFor = (control) => {
      const byId = control.id ? document.querySelector('label[for="' + CSS.escape(control.id) + '"]') : null
      return String(byId?.innerText || control.closest('label')?.innerText || control.parentElement?.innerText || '').replace(/\\s+/g, ' ').trim()
    }
    const matches = (control, wanted) => {
      const value = String(control.value || '')
      const label = labelFor(control)
      const target = String(wanted).trim()
      if (!target) return false
      return value === target || label === target || label.startsWith(target + '.') || label.startsWith(target + '、') || label.includes(target)
    }
    const applied = []
    const failed = []
    for (const entry of answerKey.answers) {
      const group = groups[Number(entry.question) - 1]
      if (!group) { failed.push({ question: entry.question, reason: '未找到题目控件' }); continue }
      const wanted = Array.isArray(entry.answer) ? entry.answer : [entry.answer]
      if (group.type === 'radio' || group.type === 'checkbox') {
        let matched = 0
        for (const control of group.controls) {
          const next = wanted.some((value) => matches(control, value))
          if (group.type === 'checkbox') control.checked = next
          else if (next) control.checked = true
          if (next) matched += 1
          control.dispatchEvent(new Event('input', { bubbles: true }))
          control.dispatchEvent(new Event('change', { bubbles: true }))
        }
        if (matched) applied.push(entry.question)
        else failed.push({ question: entry.question, reason: '答案与页面选项不匹配' })
      } else if (group.type === 'select-one' || group.type === 'select-multiple' || group.controls[0]?.tagName === 'SELECT') {
        const select = group.controls[0]
        let matched = false
        for (const option of select.options) {
          const next = wanted.some((value) => String(option.value) === String(value) || String(option.text).trim() === String(value).trim())
          if (next) { option.selected = true; matched = true }
        }
        select.dispatchEvent(new Event('change', { bubbles: true }))
        if (matched) applied.push(entry.question)
        else failed.push({ question: entry.question, reason: '答案与下拉选项不匹配' })
      } else {
        group.controls[0].value = wanted.join('\n')
        group.controls[0].dispatchEvent(new Event('input', { bubbles: true }))
        group.controls[0].dispatchEvent(new Event('change', { bubbles: true }))
        applied.push(entry.question)
      }
    }
    return { applied, failed, total: answerKey.answers.length }
  })()`)
}

async function openSourceWindow(rawUrl, { title = '学校原站', expectedEpoch = getAuthEpoch() } = {}) {
  const epoch = expectedEpoch
  assertAuthEpoch(epoch)
  const url = permittedSourceUrl(rawUrl)
  const source = sourceFromUrl(url)
  const resumeAssignments = source === 'theol' ? getSyncService().pauseAssignmentScan() : null
  if (source) {
    try {
      if (source === 'theol') {
        await getSyncService().waitForAssignmentScan()
        assertAuthEpoch(epoch)
      }
      let status
      if (source === 'tygl') {
        status = { connected: await getFitnessRuntime().fitnessSessionReady() }
        assertAuthEpoch(epoch)
      } else {
        status = await verifiedStatus(source)
        assertAuthEpoch(epoch)
        if (!status) {
          status = source === 'theol'
            ? await getSyncService().runTheolExclusive(() => {
              assertAuthEpoch(epoch)
              return getSyncService().theol.status()
            })
            : await getSyncService()[source].status()
          assertAuthEpoch(epoch)
        }
      }
      // Once this exact browser session has been verified, open the requested
      // page directly. The previous path loaded a second hidden BrowserWindow
      // and inspected its DOM before showing it, so every click paid the full
      // navigation cost twice from the user's perspective. A changed or
      // unknown cookie still takes the guarded hidden probe below.
      if (source !== 'theol' && status?.connected && verifiedSessions[source]) {
        await createSourceWindow(url, title, { pauseAssignments: false })
        assertAuthEpoch(epoch)
        resumeAssignments?.({ schedule: false })
        return true
      }
      // A configured academic API authenticates its own cookie jar and cannot
      // prove that an Electron source window is authenticated. Probe the
      // actual page in the shared browser partition before showing it when no
      // browser session has been verified yet. This also recovers a healthy
      // browser session that was not remembered yet.
      if (source !== 'theol') {
        const opened = await openAuthenticatedSourceWindow(url, title, { pauseAssignments: false })
        assertAuthEpoch(epoch)
        if (opened) {
          if (!verifiedSessions[source]) {
            await rememberVerifiedSession(source, opened.webContents.getURL() || status.url || url, epoch)
            assertAuthEpoch(epoch)
          }
          resumeAssignments?.({ schedule: false })
          return true
        }
      }
      if (!status.connected || source !== 'theol') {
        const credentials = await getCredentialVault().status().catch(() => ({ saved: false }))
        const actors = await openLoginWindow({
          background: Boolean(credentials?.saved),
          sources: [source],
          expectedEpoch: epoch,
          requireBrowser: source === 'jwglxt',
          skipSync: true,
        })
        assertAuthEpoch(epoch)

        // A source-page request is a foreground user action. When a saved
        // password exists, keep the login actor hidden and wait for its full
        // lifecycle before opening the requested page. The old code returned
        // as soon as the hidden login window was created, which made the
        // caller race the redirect and left the user staring at a login page
        // even though authentication completed moments later.
        if (credentials?.saved) {
          const actor = actors?.find?.((candidate) => candidate?.source === source)
          if (actor?.lifecycle) await actor.lifecycle
          assertAuthEpoch(epoch)
          if (!actor?.authenticated) {
            resumeAssignments?.({ schedule: false })
            throw new Error(`${source === 'jwglxt' ? '教务系统' : '学校平台'}自动认证未完成，请在认证窗口中完成验证后重试`)
          }
          const opened = await openAuthenticatedSourceWindow(url, title, { pauseAssignments: false, verified: true })
          assertAuthEpoch(epoch)
          resumeAssignments?.({ schedule: false })
          if (!opened) {
            verifiedSessions[source] = null
            throw new Error(`${source === 'jwglxt' ? '教务系统' : '学校平台'}认证已完成，但来源页面仍要求登录，请刷新后重试`)
          }
          return true
        }

        resumeAssignments?.({ schedule: false })
        return true
      }
      if (!verifiedSessions[source]) {
        await rememberVerifiedSession(source, status.url || url, epoch)
        assertAuthEpoch(epoch)
      }
    } catch (error) {
      resumeAssignments?.({ schedule: false })
      throw error
    }
  }
  try {
    assertAuthEpoch(epoch)
    await createSourceWindow(url, title, { pauseAssignments: source === 'theol' })
    assertAuthEpoch(epoch)
    resumeAssignments?.({ schedule: false })
  } catch (error) {
    resumeAssignments?.({ schedule: false })
    throw error
  }
  return true
}

  return {
    loadSourceWindowUrl,
    createSourceWindow,
    inspectLoadedSourcePage,
    openAuthenticatedSourceWindow,
    waitForSchedulePdfContext,
    openSchedulePdf,
    openCourseWorkWindow,
    attachFileToSourceWindow,
    fillTestInSourceWindow,
    openSourceWindow,
  }
}
