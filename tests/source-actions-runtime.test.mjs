import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { permittedSourceUrl } from '../core/source-url-policy.mjs'
import { createSourceActionsRuntime, buildSchedulePdfRequestValues } from '../electron/source-actions-runtime.mjs'

test('schedule PDF requests use the rendered page semester and official export fields', () => {
  const values = buildSchedulePdfRequestValues({
    values: { xnm: '2026', xqm: '16', jgmc: '', xxdm: '10010' },
    labels: { xnm: '2026-2027', xqm: '第三学期' },
  })

  assert.deepEqual(values, {
    xm: '导出',
    xnm: '2026',
    xqm: '16',
    xnmc: '2026-2027',
    xqmmc: '3',
    jgmc: 'undefined',
    xxdm: '10010',
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
  })
})

test('schedule PDF requests fail early when the page has no selected term', () => {
  assert.throws(
    () => buildSchedulePdfRequestValues({ values: { xnm: '2026' } }),
    /未提供当前学期/u,
  )
})

test('openSchedulePdf uses the official POST flow and closes its hidden source window', async () => {
  const outputRoot = await mkdtemp(resolve(tmpdir(), 'theia-schedule-pdf-'))
  const formCalls = []
  const binaryCalls = []
  const academicClient = {
    form: async (url, values, options) => { formCalls.push({ url, values, options }); return '"false"' },
    binary: async (url, options) => {
      binaryCalls.push({ url, options })
      return { url, buffer: Buffer.from('%PDF-test') }
    },
  }
  let closed = false
  const scheduleUrl = 'https://jwglxt.buct.edu.cn/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default'
  const window = {
    webContents: {
      getURL: () => scheduleUrl,
      executeJavaScript: async (script) => {
        if (script.includes('document.documentElement')) return '<span id="yhm">student</span>'
        if (script.includes("const wanted = new Set")) {
          return {
            values: { xnm: '2026', xqm: '3' },
            labels: { xnm: '2026-2027', xqm: '第一学期' },
            requestValues: { xnm: '2026', xqm: '3', xnmc: '2026-2027', xqmmc: '1', jgmc: '化学学院', xm: '测试用户', 'modelList[0].xh': 'test' },
            ready: true,
            loggedIn: true,
          }
        }
        throw new Error('unexpected script')
      },
    },
    loadURL: async () => {},
    isDestroyed: () => closed,
  }
  class BrowserWindow {
    constructor() { return window }
  }
  const runtime = createSourceActionsRuntime({
    BrowserWindow,
    permittedSourceUrl,
    sourceFromUrl: () => 'jwglxt',
    sourceWindowOptions: () => ({}),
    guardSourceWindow: () => {},
    closeWindowAndWait: async () => { closed = true },
    openTheolInteractiveWindow: async () => {},
    parseJwHomepage: () => ({ loggedIn: true }),
    htmlLooksLikeLogin: () => false,
    getSyncService: () => ({ jwglxt: { status: async () => ({ connected: true }) } }),
    getFitnessRuntime: () => ({}),
    getCredentialVault: () => ({ status: async () => ({ saved: false }) }),
    getSessionClient: () => ({
      form: async () => { throw new Error('schedule PDF should use academic session client') },
      binary: async () => { throw new Error('schedule PDF should use academic session client') },
    }),
    getAcademicSessionClient: () => academicClient,
    getAuthEpoch: () => 1,
    openLoginWindow: async () => {},
    verifiedStatus: async () => ({ connected: true }),
    verifiedSessions: { jwglxt: true },
    rememberVerifiedSession: async () => {},
    assertAuthEpoch: () => {},
    diagnosticUrl: (url) => url,
    diagnosticError: (error) => String(error?.message || error),
    writeDiagnostic: async () => {},
    getDocumentsDirectory: () => outputRoot,
  })

  try {
    const result = await runtime.openSchedulePdf(1)
    assert.match(result.filePath, /THEIA-课表-.*\.pdf$/u)
    assert.equal((await readFile(result.filePath)).toString(), '%PDF-test')
    assert.equal(formCalls.length, 1)
    assert.match(formCalls[0].url, /kbdy\/bjkbdy_cxXnxqsfkz\.html/u)
    assert.equal(formCalls[0].values.xnm, '2026')
    assert.equal(formCalls[0].values.xqm, '3')
    assert.equal(formCalls[0].values['modelList[0].xh'], 'test')
    assert.equal(binaryCalls.length, 1)
    assert.equal(binaryCalls[0].options.method, 'POST')
    assert.match(binaryCalls[0].options.body, /xnm=2026/u)
    assert.match(binaryCalls[0].options.body, /xqm=3/u)
    assert.equal(closed, true)
  } finally {
    await rm(outputRoot, { recursive: true, force: true })
  }
})

test('openSchedulePdf waits for background browser authentication before retrying', async () => {
  const outputRoot = await mkdtemp(resolve(tmpdir(), 'theia-schedule-pdf-auth-'))
  const scheduleUrl = 'https://jwglxt.buct.edu.cn/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151&layout=default'
  const loginUrl = 'https://jwglxt.buct.edu.cn/jwglxt/xtgl/login_slogin.html'
  const windows = []
  let authenticated = false
  let authCalls = 0
  const makeWindow = (signedIn) => {
    const state = { closed: false }
    const next = {
      webContents: {
        getURL: () => signedIn ? scheduleUrl : loginUrl,
        executeJavaScript: async (script) => {
          if (script.includes('document.documentElement')) return signedIn ? '<span id="yhm">student</span>' : '<h5>用户登录</h5>'
          if (script.includes("const wanted = new Set")) {
            return { values: { xnm: '2026', xqm: '3' }, labels: { xnm: '2026-2027', xqm: '第一学期' }, ready: true, loggedIn: true }
          }
          throw new Error('unexpected script')
        },
      },
      loadURL: async () => {},
      isDestroyed: () => state.closed,
    }
    windows.push({ next, state })
    return next
  }
  class BrowserWindow {
    constructor() { return makeWindow(authenticated) }
  }
  const runtime = createSourceActionsRuntime({
    BrowserWindow,
    permittedSourceUrl,
    sourceFromUrl: () => 'jwglxt',
    sourceWindowOptions: () => ({}),
    guardSourceWindow: () => {},
    closeWindowAndWait: async (next) => { windows.find((item) => item.next === next).state.closed = true },
    openTheolInteractiveWindow: async () => {},
    parseJwHomepage: (_html, url) => ({ loggedIn: url !== loginUrl }),
    htmlLooksLikeLogin: (_html, url) => url === loginUrl,
    getSyncService: () => ({ jwglxt: { status: async () => ({ connected: true }) } }),
    getFitnessRuntime: () => ({}),
    getCredentialVault: () => ({ status: async () => ({ saved: true }) }),
    getSessionClient: () => ({
      form: async () => '',
      binary: async (url) => ({ url, buffer: Buffer.from('%PDF-auth-retry') }),
    }),
    getAcademicSessionClient: () => ({
      form: async () => '"false"',
      binary: async (url) => ({ url, buffer: Buffer.from('%PDF-auth-retry') }),
    }),
    getAuthEpoch: () => 1,
    openLoginWindow: async () => {
      authCalls += 1
      authenticated = true
      return [{ source: 'jwglxt', authenticated: true, lifecycle: Promise.resolve() }]
    },
    verifiedStatus: async () => ({ connected: true }),
    verifiedSessions: { jwglxt: { cookieValue: 'current' } },
    rememberVerifiedSession: async () => {},
    assertAuthEpoch: () => {},
    diagnosticUrl: (url) => url,
    diagnosticError: (error) => String(error?.message || error),
    writeDiagnostic: async () => {},
    getDocumentsDirectory: () => outputRoot,
  })

  try {
    const result = await runtime.openSchedulePdf(1)
    assert.equal((await readFile(result.filePath)).toString(), '%PDF-auth-retry')
    assert.equal(authCalls, 1)
    assert.equal(windows.length, 2)
    assert.equal(windows.every(({ state }) => state.closed), true)
  } finally {
    await rm(outputRoot, { recursive: true, force: true })
  }
})
