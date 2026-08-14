import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PRELOAD = join(ROOT, 'scripts', 'visual-advisor-preload.cjs')
const SCRIPT = fileURLToPath(import.meta.url)
const IS_WORKER = process.env.THEIA_VISUAL_WORKER === '1'
const VIEWPORTS = [
  { id: 'desktop-1440x900', width: 1440, height: 900 },
  { id: 'desktop-1280x720', width: 1280, height: 720 },
  { id: 'mobile-390x844', width: 390, height: 844 },
]
const RUN_STAMP = process.env.THEIA_VISUAL_RUN_STAMP || new Date().toISOString().replace(/[:.]/g, '-')
const OUTPUT = join(ROOT, 'test-results', 'advisor-visual', RUN_STAMP)
let tempRoot = null
const rendererErrors = []
const consoleEntries = []
const externalRequests = []
const navigationBlocks = []
const pageFailures = []
const bridgeDiagnostics = []
const advisorThreads = new Map()
const advisorPrepared = new Map()
const advisorActive = new Map()
let advisorSequence = 0
let vite = null
let fixture = null
let origin = process.env.THEIA_VISUAL_ORIGIN || null
let app = null
let BrowserWindow = null
let ipcMain = null
let electronSession = null

function keepElectronAliveBetweenViewports() {}

function stage(label) {
  process.stdout.write(`[visual:advisor] ${label}\n`)
}

async function startVite() {
  const port = 20_000 + (process.pid % 20_000)
  const child = spawn('node', [
    join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
    '--host', '127.0.0.1',
    '--port', String(port),
    '--strictPort',
  ], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let logs = ''
  child.stdout.on('data', (chunk) => { logs += chunk.toString() })
  child.stderr.on('data', (chunk) => { logs += chunk.toString() })
  const url = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Vite 提前退出 (${child.exitCode})\n${logs}`)
    const ready = await new Promise((resolveReady) => {
      const socket = connect({ host: '127.0.0.1', port })
      const timeout = setTimeout(() => {
        socket.destroy()
        resolveReady(false)
      }, 500)
      socket.once('connect', () => {
        clearTimeout(timeout)
        socket.destroy()
        resolveReady(true)
      })
      socket.once('error', () => {
        clearTimeout(timeout)
        resolveReady(false)
      })
    })
    if (ready) return { child, url, logs: () => logs }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  child.kill()
  throw new Error(`Vite 启动超时\n${logs}`)
}

async function stopVite(server) {
  if (!server?.child || server.child.exitCode !== null) return
  await new Promise((resolveStop) => {
    const timeout = setTimeout(() => {
      server.child.kill()
      resolveStop()
    }, 3_000)
    server.child.once('exit', () => {
      clearTimeout(timeout)
      resolveStop()
    })
    server.child.kill()
  })
}

async function initializeElectron() {
  const electron = await import('electron')
  app = electron.app
  BrowserWindow = electron.BrowserWindow
  ipcMain = electron.ipcMain
  electronSession = electron.session
  tempRoot = process.env.THEIA_VISUAL_TEMP_ROOT || await mkdtemp(join(tmpdir(), 'theia-advisor-visual-'))
  app.setPath('userData', join(tempRoot, 'userData'))
  app.setPath('sessionData', join(tempRoot, 'sessionData'))
  app.commandLine.appendSwitch('force-device-scale-factor', '1')
  app.commandLine.appendSwitch('disable-background-networking')
  app.commandLine.appendSwitch('disable-component-update')
  app.commandLine.appendSwitch('disable-sync')
  app.commandLine.appendSwitch('no-pings')
  app.on('window-all-closed', keepElectronAliveBetweenViewports)
}

function clone(value) {
  return structuredClone(value)
}

function advisorId(prefix) {
  advisorSequence += 1
  return `${prefix}-visual-${advisorSequence}`
}

function resetAdvisorFixture() {
  advisorThreads.clear()
  advisorPrepared.clear()
  advisorActive.clear()
  advisorSequence = 0
}

function publicAdvisorThread(thread) {
  return clone(thread)
}

function visualAdvisorAnswer(prepared) {
  const claim = fixture.overview.claims[0]
  const evidenceIds = new Set(claim?.evidenceRefs || [])
  const evidence = fixture.overview.evidence.filter((entry) => evidenceIds.has(entry.id))
  const claimIds = claim ? [claim.id] : []
  const explanation = '这段模型文字只解释本地结论；关键事实、等级和证据仍由 THEIA 在本机渲染。'
  return {
    schema: 'theia-advisor-answer/v1',
    requestId: prepared.requestId,
    threadId: prepared.threadId,
    intent: prepared.intent,
    snapshotRevision: fixture.versioned.revision,
    stale: false,
    narrative: {
      schema: 'theia-advisor-model-narrative/v1',
      blocks: claim ? [{ claimIds, referenceIds: [], explanation }] : [],
      recommendations: claim ? [{
        text: '先查看本地证据，再安排当前最重要的一步。',
        basedOnClaimIds: claimIds,
        basedOnReferenceIds: [],
      }] : [],
      uncertainties: [],
      questionsForUser: [],
      suggestedActionIds: [],
    },
    claims: claim ? [clone(claim)] : [],
    evidence: clone(evidence),
    untrustedReferences: [],
    recommendations: claim ? [{
      id: advisorId('recommendation'),
      text: '先查看本地证据，再安排当前最重要的一步。',
      basedOnClaimIds: claimIds,
      basedOnReferenceIds: [],
      caveats: [],
    }] : [],
    nextActions: [],
    uncertainties: [],
    questionsForUser: [],
    model: { serviceIdentity: 'https://models.fixture.invalid/v1', modelId: 'visual-advisor-model' },
    usage: { inputBytes: 4096, outputBytes: 512 },
  }
}

function registerBridge() {
  const handle = (name, callback) => ipcMain.handle(`theia-visual:${name}`, callback)
  handle('get-snapshot', () => clone(fixture.state))
  handle('get-advisor-overview', () => clone(fixture.overview))
  handle('get-advisor-academic-what-if', (_event, request) => {
    if (request?.snapshotRevision !== fixture.versioned.revision) throw new Error('视觉夹具快照已过期')
    return clone(fixture.academicWhatIf(request))
  })
  handle('get-advisor-course-decisions', (_event, request) => {
    const diagnostic = {
      channel: 'get-advisor-course-decisions',
      revisionMatches: request?.snapshotRevision === fixture.versioned.revision,
      candidateCount: Array.isArray(request?.candidates) ? request.candidates.length : -1,
    }
    try {
      if (!diagnostic.revisionMatches) throw new Error('视觉夹具快照已过期')
      const result = fixture.courseDecisions(request)
      diagnostic.decisionCount = result.decisions.length
      diagnostic.ok = true
      bridgeDiagnostics.push(diagnostic)
      return clone(result)
    } catch (error) {
      diagnostic.ok = false
      diagnostic.errorCode = error?.code || error?.name || 'unknown'
      bridgeDiagnostics.push(diagnostic)
      throw error
    }
  })
  handle('list-advisor-threads', () => [...advisorThreads.values()]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map(publicAdvisorThread))
  handle('create-advisor-thread', () => {
    const now = fixture.now
    const thread = {
      schema: 'theia-advisor-thread/v1',
      id: advisorId('thread'),
      title: '新顾问对话',
      createdAt: now,
      updatedAt: now,
      activeRequestId: null,
      messages: [],
    }
    advisorThreads.set(thread.id, thread)
    return publicAdvisorThread(thread)
  })
  handle('prepare-advisor-request', (_event, request) => {
    const thread = advisorThreads.get(request?.threadId)
    if (!thread) throw new Error('视觉夹具顾问线程不存在')
    const requestId = advisorId('request')
    const prepared = {
      schema: 'theia-advisor-prepared-request/v1',
      requestId,
      threadId: thread.id,
      intent: request?.intent || 'general',
      question: String(request?.question || '').slice(0, 4_000),
      expiresAt: '2026-08-14T01:05:00.000Z',
      disclosure: {
        schema: 'theia-advisor-disclosure/v1',
        providerProfileId: 'default',
        serviceIdentity: 'https://models.fixture.invalid/v1',
        modelId: 'visual-advisor-model',
        intent: request?.intent || 'general',
        scopes: request?.intent === 'daily' ? ['assignments', 'exams'] : [],
        recordCounts: request?.intent === 'daily' ? { assignments: fixture.state.assignments.length, exams: fixture.state.exams.length } : {},
        containsMailBody: false,
        containsProfileIdentity: false,
        containsFitness: false,
        containsAttachmentText: false,
        estimatedInputUnits: 6,
        snapshotRevision: fixture.versioned.revision,
        contextDigest: 'a'.repeat(64),
      },
      consentChallenge: {
        schema: 'theia-advisor-consent-challenge/v1',
        requestId,
        threadId: thread.id,
        serviceIdentity: 'https://models.fixture.invalid/v1',
        purpose: 'visual-advisor-fixture',
        intent: request?.intent || 'general',
        domains: request?.intent === 'daily' ? ['assignments', 'exams'] : [],
        entityDigests: [],
        contextDigest: 'a'.repeat(64),
        requiredScopes: [],
      },
    }
    advisorPrepared.set(requestId, prepared)
    return clone(prepared)
  })
  handle('send-advisor-request', async (_event, request) => {
    const prepared = advisorPrepared.get(request?.requestId)
    if (!prepared || request?.approved !== true) throw new Error('视觉夹具披露计划无效')
    const thread = advisorThreads.get(prepared.threadId)
    if (!thread) throw new Error('视觉夹具顾问线程不存在')
    advisorPrepared.delete(prepared.requestId)
    const active = { cancelled: false }
    advisorActive.set(prepared.requestId, active)
    thread.activeRequestId = prepared.requestId
    thread.title = prepared.question.slice(0, 40) || thread.title
    thread.messages.push({ id: advisorId('message'), role: 'user', at: fixture.now, text: prepared.question })
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_200))
    thread.activeRequestId = null
    advisorActive.delete(prepared.requestId)
    if (active.cancelled) return null
    const response = visualAdvisorAnswer(prepared)
    thread.messages.push({ id: advisorId('message'), role: 'assistant', at: fixture.now, response })
    thread.updatedAt = fixture.now
    return clone(response)
  })
  handle('cancel-advisor-request', (_event, request) => {
    const active = advisorActive.get(request?.requestId)
    if (!active) return { cancelled: false, requestId: request?.requestId || null }
    active.cancelled = true
    const prepared = [...advisorThreads.values()].find((thread) => thread.activeRequestId === request.requestId)
    if (prepared) prepared.activeRequestId = null
    return { cancelled: true, requestId: request.requestId }
  })
  handle('delete-advisor-thread', (_event, threadId) => ({ deleted: advisorThreads.delete(threadId), threadId }))
  handle('get-activity-log', () => [])
  handle('get-auth-status', () => ({ jwglxt: { connected: true }, theol: { connected: true } }))
  handle('get-credential-status', () => ({ saved: true, encryptionAvailable: true }))
  handle('get-academic-api-credential-status', () => ({ saved: true, encryptionAvailable: true, enabled: true }))
  handle('get-mail-credential-status', () => ({ saved: true, encryptionAvailable: true }))
  handle('get-course-selection', () => clone(fixture.courseSelection))
  handle('discover-course-selection', () => clone(fixture.portal))
  handle('get-course-selection-candidates', (_event, blockId, _target, options = {}) => {
    const block = fixture.portal.blocks.find((entry) => entry.id === blockId)
    if (!block) throw new Error('视觉夹具中没有该选课模块')
    return clone({
      portal: fixture.portal,
      block,
      candidates: fixture.candidates,
      page: options.page || fixture.catalogPage.page,
      pageSize: options.pageSize || fixture.catalogPage.pageSize,
      total: fixture.catalogPage.total,
    })
  })
  handle('get-cached-school-schedule', () => null)
  handle('get-academic-calendar-assets', () => ({ schema: 'theia-academic-calendar-assets/v1', updatedAt: null, root: '', assets: {}, calendar: null, analysis: null }))
  handle('get-model-status', () => ({ configured: false, baseUrl: '', model: '', apiKeySaved: false, encryptionAvailable: true }))
  handle('get-api-status', () => ({ baseUrl: '', host: '127.0.0.1', port: 0, academicCalendarAssets: {} }))
  handle('get-appearance-presets', () => ({ exists: true, updatedAt: null, presets: [] }))
  ipcMain.on('theia-visual:renderer-error', (_event, detail) => rendererErrors.push(detail))
}

function isAllowedRequest(url) {
  if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('devtools:')) return true
  try {
    const parsed = new URL(url)
    const allowedOrigin = new URL(origin)
    return ['http:', 'ws:'].includes(parsed.protocol)
      && parsed.hostname === allowedOrigin.hostname
      && parsed.port === allowedOrigin.port
  } catch {
    return false
  }
}

function attachIsolation(targetSession) {
  targetSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const allowed = isAllowedRequest(details.url)
    if (!allowed) externalRequests.push({ url: details.url, resourceType: details.resourceType })
    callback({ cancel: !allowed })
  })
  targetSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
}

async function evalIn(window, source) {
  return window.webContents.executeJavaScript(`(async () => { ${source} })()`, true)
}

async function waitFor(window, predicate, label, timeout = 15_000) {
  const result = await evalIn(window, `
    const end = Date.now() + ${timeout};
    while (Date.now() < end) {
      if (${predicate}) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(${JSON.stringify(`等待超时：${label}`)});
  `)
  return result
}

async function settle(window) {
  await evalIn(window, `
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return true;
  `)
  window.webContents.invalidate()
  await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  await evalIn(window, `
    await new Promise((resolve) => requestAnimationFrame(resolve));
    return true;
  `)
}

async function clickByAria(window, label) {
  await evalIn(window, `
    const node = document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)});
    if (!node) throw new Error(${JSON.stringify(`未找到控件：${label}`)});
    node.click();
    return true;
  `)
}

async function clickByText(window, text, selector = 'button') {
  await evalIn(window, `
    const node = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((entry) => entry.textContent.includes(${JSON.stringify(text)}));
    if (!node) throw new Error(${JSON.stringify(`未找到文字控件：${text}`)});
    node.click();
    return true;
  `)
}

async function auditPage(window, expectedText) {
  return evalIn(window, `
    const root = document.documentElement;
    const body = document.body;
    const shell = document.querySelector('.app-shell');
    const workspace = document.querySelector('.workspace');
    const content = document.querySelector('.content-area');
    const contentText = (content?.innerText || '').trim();
    const bodyText = (body.innerText || '').trim();
    const expectedTextRects = [];
    const textWalker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    while (textWalker.nextNode()) {
      const node = textWalker.currentNode;
      if (!(node.textContent || '').includes(${JSON.stringify(expectedText)})) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      const style = getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      expectedTextRects.push(...range.getClientRects());
    }
    const expectedInViewport = expectedTextRects.some((bounds) => (
      bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.top < innerHeight
        && bounds.right > 0 && bounds.left < innerWidth
    ));
    const overflowingElements = [...document.querySelectorAll('body *')]
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: typeof element.className === 'string' ? element.className.slice(0, 160) : '',
          left: Math.round(bounds.left),
          right: Math.round(bounds.right),
          width: Math.round(bounds.width),
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        };
      })
      .filter((entry) => entry.width > 0 && (entry.left < -1 || entry.right > innerWidth + 1 || entry.scrollWidth > entry.clientWidth + 1))
      .slice(0, 40);
    const overflow = [
      ['document', root.scrollWidth, root.clientWidth],
      ['body', body.scrollWidth, body.clientWidth],
      ['workspace', workspace?.scrollWidth || 0, workspace?.clientWidth || 0],
    ].filter(([, scrollWidth, clientWidth]) => scrollWidth > clientWidth + 1);
    const shellOverflow = shell && shell.scrollWidth > shell.clientWidth + 1
      ? ['app-shell', shell.scrollWidth, shell.clientWidth]
      : null;
    const viewport = { width: innerWidth, height: innerHeight };
    return {
      viewport,
      textLength: contentText.length,
      contentTextLength: contentText.length,
      bodyTextLength: bodyText.length,
      expectedText: ${JSON.stringify(expectedText)},
      expectedVisible: bodyText.includes(${JSON.stringify(expectedText)}),
      expectedInViewport,
      contentExpectedVisible: contentText.includes(${JSON.stringify(expectedText)}),
      overflow,
      shellOverflow,
      overflowingElements: overflow.length ? overflowingElements : [],
      readyState: document.readyState,
    };
  `)
}

function pixelAudit(image, viewport) {
  const bitmap = image.toBitmap()
  const sampleStep = Math.max(4, Math.floor((viewport.width * viewport.height) / 20_000))
  const colors = new Set()
  let nonWhite = 0
  let sampled = 0
  for (let index = 0; index < viewport.width * viewport.height; index += sampleStep) {
    const offset = index * 4
    const blue = bitmap[offset]
    const green = bitmap[offset + 1]
    const red = bitmap[offset + 2]
    const alpha = bitmap[offset + 3]
    sampled += 1
    if (alpha > 0 && (red < 248 || green < 248 || blue < 248)) nonWhite += 1
    if (colors.size < 4096) colors.add(`${red >> 4}:${green >> 4}:${blue >> 4}:${alpha >> 6}`)
  }
  const size = image.getSize()
  return {
    width: size.width,
    height: size.height,
    bytes: image.toPNG().length,
    sampled,
    uniqueQuantizedColors: colors.size,
    nonWhiteRatio: sampled ? nonWhite / sampled : 0,
    ok: size.width === viewport.width && size.height === viewport.height && colors.size > 8 && nonWhite / sampled > 0.02,
  }
}

async function screenshot(window, viewport, name, expectedText) {
  await settle(window)
  const dom = await auditPage(window, expectedText)
  const image = await window.webContents.capturePage()
  const pixels = pixelAudit(image, viewport)
  const path = join(OUTPUT, `${viewport.id}-${name}.png`)
  await writeFile(path, image.toPNG())
  return {
    name,
    path: relative(ROOT, path).replaceAll('\\', '/'),
    dom,
    pixels,
    ok: dom.expectedVisible && dom.expectedInViewport && dom.textLength > 100 && dom.overflow.length === 0 && pixels.ok,
  }
}

async function createVisualWindow(viewport, partition) {
  const window = new BrowserWindow({
    width: viewport.width,
    height: viewport.height,
    useContentSize: true,
    show: false,
    frame: false,
    backgroundColor: '#f4f6f7',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      session: partition,
      spellcheck: false,
      devTools: false,
    },
  })
  window.webContents.on('console-message', (details) => {
    if (details.level === 'warning' || details.level === 'error') {
      consoleEntries.push({ viewport: viewport.id, level: details.level, message: details.message, source: details.sourceId, line: details.lineNumber })
    }
  })
  window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (code !== -3) pageFailures.push({ viewport: viewport.id, code, description, url, isMainFrame })
  })
  window.webContents.on('render-process-gone', (_event, details) => pageFailures.push({ viewport: viewport.id, kind: 'render-process-gone', details }))
  window.webContents.setWindowOpenHandler(({ url }) => {
    navigationBlocks.push({ viewport: viewport.id, kind: 'popup', url })
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== `${origin}/` && url !== origin) {
      event.preventDefault()
      navigationBlocks.push({ viewport: viewport.id, kind: 'navigate', url })
    }
  })
  await window.loadURL(`${origin}/`)
  await waitFor(window, `document.querySelector('.app-shell') && document.querySelector('[aria-label="学业顾问"]')`, '应用初始化')
  await evalIn(window, `
    localStorage.setItem('theia-appearance-v1', 'light');
    localStorage.setItem('theia-sidebar-collapsed-v1', 'false');
    localStorage.setItem('theia-personalization-v1', JSON.stringify({ preset: 'classic', background: 'none' }));
    const style = document.createElement('style');
    style.id = 'advisor-visual-no-motion';
    style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
    document.head.append(style);
    return true;
  `)
  await window.webContents.reload()
  await waitFor(window, `document.querySelector('.app-shell') && document.querySelector('[aria-label="学业顾问"]')`, '稳定主题重载')
  await evalIn(window, `
    if (!document.getElementById('advisor-visual-no-motion')) {
      const style = document.createElement('style');
      style.id = 'advisor-visual-no-motion';
      style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}';
      document.head.append(style);
    }
    return true;
  `)
  return window
}

async function runViewport(viewport, index) {
  resetAdvisorFixture()
  const partition = electronSession.fromPartition(`advisor-visual-${RUN_STAMP}-${index}`, { cache: false })
  await partition.clearStorageData()
  await partition.clearCache()
  attachIsolation(partition)
  const window = await createVisualWindow(viewport, partition)
  const scenarios = []
  try {
    await clickByAria(window, '学业顾问')
    await waitFor(window, `document.body.innerText.includes('本地确定性顾问') && document.querySelector('[data-quality-state="stale"]') && document.querySelector('[data-quality-state="partial"]') && document.querySelector('[data-quality-state="failed"]')`, '顾问及质量状态')
    scenarios.push(await screenshot(window, viewport, 'advisor', '本地确定性顾问'))

    await clickByText(window, '查看证据')
    await waitFor(window, `document.querySelector('[aria-label="关闭证据详情"]') && document.body.innerText.includes('条证据')`, '证据抽屉')
    scenarios.push(await screenshot(window, viewport, 'advisor-evidence', '条证据'))
    await clickByAria(window, '关闭证据详情')

    await evalIn(window, `
      document.getElementById('advisor-model-title')?.closest('section')?.scrollIntoView({ block: 'start' });
      return true;
    `)

    await evalIn(window, `
      const input = document.querySelector('textarea[placeholder="问 THEIA"]');
      if (!input) throw new Error('未找到顾问输入框');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(input, '今天应该先处理什么？');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    `)
    await clickByText(window, '检查并发送')
    await waitFor(window, `document.body.innerText.includes('发送前确认')`, '披露确认')
    scenarios.push(await screenshot(window, viewport, 'advisor-disclosure', '发送前确认'))
    await clickByText(window, '允许并发送')
    await waitFor(window, `document.body.innerText.includes('取消生成')`, '顾问生成中')
    scenarios.push(await screenshot(window, viewport, 'advisor-generating', '取消生成'))
    await clickByText(window, '取消生成')
    await waitFor(window, `!document.body.innerText.includes('取消生成')`, '顾问取消完成')

    await evalIn(window, `
      const input = document.querySelector('textarea[placeholder="问 THEIA"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(input, '请解释当前最重要的本地结论。');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    `)
    await clickByText(window, '检查并发送')
    await waitFor(window, `document.body.innerText.includes('发送前确认')`, '第二次披露确认')
    await clickByText(window, '允许并发送')
    await waitFor(window, `document.body.innerText.includes('关键事实、等级和证据仍由 THEIA 在本机渲染')`, '已验证回答')
    await evalIn(window, `
      const node = [...document.querySelectorAll('p')]
        .find((element) => element.innerText.includes('关键事实、等级和证据仍由 THEIA 在本机渲染'));
      node?.scrollIntoView({ block: 'center' });
      return true;
    `)
    scenarios.push(await screenshot(window, viewport, 'advisor-answer', '关键事实'))

    await evalIn(window, `
      const input = document.querySelector('input[type="number"][max="500"]');
      if (!input) throw new Error('未找到 What-if 学分输入');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, '2');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const select = input.closest('section')?.querySelector('select');
      if (select && select.options.length > 1) {
        const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        selectSetter.call(select, select.options[1].value);
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    `)
    await clickByText(window, '计算情景')
    await waitFor(window, `(() => {
      const section = document.querySelector('input[type="number"][max="500"]')?.closest('section');
      const result = section?.querySelector('[role="status"], [role="alert"]');
      return Boolean(result && (result.innerText.includes('情景下尚缺') || result.innerText.includes('当前数据不足以计算该情景')));
    })()`, 'What-if 结果')
    await evalIn(window, `
      const section = document.querySelector('input[type="number"][max="500"]')?.closest('section');
      section?.querySelector('[role="status"], [role="alert"]')?.scrollIntoView({ block: 'center' });
      return true;
    `)
    scenarios.push(await screenshot(window, viewport, 'advisor-what-if', '情景'))

    await clickByAria(window, '抢课')
    await waitFor(window, `document.body.innerText.includes('抢课计划')`, '抢课页面')
    await clickByText(window, '读取选课批次')
    await waitFor(window, `[...document.querySelectorAll('button')].some((button) => button.textContent.includes('读取教学班') && !button.disabled)`, '可用的选课批次')
    await clickByText(window, '读取教学班')
    try {
      await waitFor(window, `document.body.innerText.includes('本页只读排名') && /#[0-9]+/.test(document.body.innerText)`, '只读课程排名')
    } catch (error) {
      const image = await window.webContents.capturePage()
      await writeFile(join(OUTPUT, `${viewport.id}-course-ranking-debug.png`), image.toPNG())
      const state = await evalIn(window, `({
        hasCandidates: document.body.innerText.includes('门课程'),
        loading: document.body.innerText.includes('正在计算本页排名'),
        failed: document.body.innerText.includes('排名不可用'),
        sourceOrder: document.body.innerText.includes('按原顺序显示'),
        ranked: document.body.innerText.includes('本页只读排名'),
        text: document.body.innerText.slice(0, 6000),
      })`)
      bridgeDiagnostics.push({ channel: 'course-ranking-ui', ...state })
      throw error
    }
    await evalIn(window, `
      const rankStatus = [...document.querySelectorAll('span')]
        .find((element) => element.innerText.includes('本页只读排名'));
      rankStatus?.scrollIntoView({ block: 'center', inline: 'nearest' });
      return true;
    `)
    scenarios.push(await screenshot(window, viewport, 'course-ranking', '本页只读排名'))
  } finally {
    window.destroy()
  }
  return { viewport, scenarios, ok: scenarios.length === 7 && scenarios.every((scenario) => scenario.ok) }
}

async function runElectronWorker() {
  if (!origin) throw new Error('视觉验收 worker 缺少本地页面 origin')
  await initializeElectron()
  stage('creating output directory')
  await mkdir(OUTPUT, { recursive: true })
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('视觉夹具禁止网络请求') }
  try {
    stage('loading isolated fixture')
    const module = await import('../tests/fixtures/advisor-visual-fixture.mjs')
    fixture = module.createAdvisorVisualFixture()
  } finally {
    globalThis.fetch = originalFetch
  }
  registerBridge()
  stage('waiting for Electron ready')
  await app.whenReady()
  stage(`using Vite at ${origin}`)

  const viewports = []
  for (const [index, viewport] of VIEWPORTS.entries()) {
    stage(`running ${viewport.id}`)
    viewports.push(await runViewport(viewport, index))
  }
  const digestAfter = fixture.getDigest()
  const qualityCoverage = {
    complete: Object.values(fixture.overview.dataQuality.domains).some((entry) => entry.completeness === 'complete' && entry.freshness === 'fresh' && entry.lastAttempt.status === 'succeeded'),
    partial: Object.values(fixture.overview.dataQuality.domains).some((entry) => entry.completeness === 'partial'),
    stale: Object.values(fixture.overview.dataQuality.domains).some((entry) => entry.freshness === 'stale'),
    failedRetained: Object.values(fixture.overview.dataQuality.domains).some((entry) => entry.lastAttempt.status === 'failed' && entry.lastAttempt.retainedPrevious),
  }
  const report = {
    schema: 'theia-advisor-visual-report/v1',
    generatedAt: new Date().toISOString(),
    commit: process.env.GITHUB_SHA || null,
    outputDirectory: relative(ROOT, OUTPUT).replaceAll('\\', '/'),
    isolation: {
      tempRoot,
      userData: app.getPath('userData'),
      sessionData: app.getPath('sessionData'),
      realAppDataRead: false,
      schoolNetworkAllowed: false,
      temporaryStorageRemovedAfterReport: true,
    },
    fixture: {
      revision: fixture.versioned.revision,
      initialDigest: fixture.initialDigest,
      finalDigest: digestAfter,
      unchanged: fixture.initialDigest === digestAfter,
    },
    qualityCoverage,
    viewports,
    diagnostics: { rendererErrors, consoleEntries, externalRequests, navigationBlocks, pageFailures, bridgeDiagnostics },
  }
  report.ok = viewports.every((entry) => entry.ok)
    && Object.values(qualityCoverage).every(Boolean)
    && report.fixture.unchanged
    && rendererErrors.length === 0
    && consoleEntries.length === 0
    && externalRequests.length === 0
    && navigationBlocks.length === 0
    && pageFailures.length === 0
  await writeFile(join(OUTPUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ ok: report.ok, output: report.outputDirectory, screenshots: viewports.reduce((sum, entry) => sum + entry.scenarios.length, 0) })}\n`)
  return report.ok
}

async function runNodeOrchestrator() {
  stage('starting isolated Vite server')
  vite = await startVite()
  stage(`Vite ready at ${vite.url}`)
  tempRoot = await mkdtemp(join(tmpdir(), 'theia-advisor-visual-'))
  const electronPath = join(ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')
  const child = spawn(electronPath, [SCRIPT], {
    cwd: ROOT,
    env: {
      ...process.env,
      THEIA_VISUAL_WORKER: '1',
      THEIA_VISUAL_ORIGIN: vite.url,
      THEIA_VISUAL_RUN_STAMP: RUN_STAMP,
      THEIA_VISUAL_TEMP_ROOT: tempRoot,
    },
    stdio: 'inherit',
    windowsHide: true,
  })
  const exitCode = await new Promise((resolveExit, reject) => {
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('视觉验收 Electron worker 总时限 90 秒已到'))
    }, 90_000)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      resolveExit(code ?? 1)
    })
  })
  if (exitCode !== 0) process.exitCode = exitCode
}

async function writeFatalReport(error) {
  await mkdir(OUTPUT, { recursive: true })
  await writeFile(join(OUTPUT, 'report.json'), `${JSON.stringify({
    schema: 'theia-advisor-visual-report/v1',
    generatedAt: new Date().toISOString(),
    ok: false,
    fatalError: error instanceof Error ? error.stack || error.message : String(error),
    diagnostics: { rendererErrors, consoleEntries, externalRequests, navigationBlocks, pageFailures, bridgeDiagnostics },
  }, null, 2)}\n`, 'utf8')
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
  process.exitCode = 1
}

if (IS_WORKER) {
  void (async () => {
    let exitCode = 0
    try {
      const ok = await runElectronWorker()
      if (!ok) exitCode = 1
    } catch (error) {
      exitCode = 1
      await writeFatalReport(error)
    } finally {
      if (app) {
        app.removeListener('window-all-closed', keepElectronAliveBetweenViewports)
        app.exit(exitCode)
      } else {
        process.exitCode = exitCode
      }
    }
  })()
} else {
  try {
    await runNodeOrchestrator()
  } catch (error) {
    await writeFatalReport(error)
  } finally {
    try {
      await stopVite(vite)
    } finally {
      if (tempRoot) await rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    }
  }
}
