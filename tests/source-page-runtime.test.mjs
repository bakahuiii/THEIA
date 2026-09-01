import test from 'node:test'
import assert from 'node:assert/strict'
import { createSourcePageRuntime } from '../electron/source-page-runtime.mjs'
import { permittedSourceUrl } from '../core/source-url-policy.mjs'

test('rendered binary loader preserves POST body, headers, and referer', async () => {
  const url = 'https://jwglxt.buct.edu.cn/jwglxt/kbcx/xskbcx_cxXsShcPdf.html?doType=table'
  const referer = 'https://jwglxt.buct.edu.cn/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html'
  const expectedBytes = Buffer.from('%PDF-browser-post')
  let fetchCall = null
  const window = {
    isDestroyed: () => false,
    webContents: {
      executeJavaScript: async (script) => Function('fetch', `return (${script})`)(async (requestUrl, options) => {
        fetchCall = { requestUrl, options }
        return {
          url: requestUrl,
          status: 200,
          headers: { get: () => 'application/pdf' },
          arrayBuffer: async () => expectedBytes,
        }
      }),
    },
  }
  const runtime = createSourcePageRuntime({
    permittedSourceUrl,
    syncPageQueue: { enqueue: (job) => job() },
    getSyncPageWindow: () => window,
  })

  const result = await runtime.loadBinaryWithSchoolBrowser(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: referer,
    },
    body: 'xnm=2026&xqm=3',
    referer,
  })

  assert.equal(result.buffer.toString(), expectedBytes.toString())
  assert.equal(fetchCall.requestUrl, url)
  assert.equal(fetchCall.options.method, 'POST')
  assert.equal(fetchCall.options.body, 'xnm=2026&xqm=3')
  assert.equal(fetchCall.options.referrer, referer)
  assert.equal(fetchCall.options.headers.Referer, undefined)
  assert.equal(fetchCall.options.headers['X-Requested-With'], 'XMLHttpRequest')
})

test('rendered page fallback decodes legacy HTML bytes before returning to the source client', async () => {
  const url = 'https://course.buct.edu.cn/meol/course_column_preview_transfer.jsp?columnId=16710'
  const payload = Buffer.concat([
    Buffer.from('<html><head><meta charset="gbk"></head><body>'),
    Buffer.from([0xbf, 0xce, 0xb3, 0xcc]),
    Buffer.from('</body></html>'),
  ])
  const window = {
    isDestroyed: () => false,
    webContents: {
      getURL: () => url,
      stop: () => {},
      executeJavaScript: async (script) => {
        if (script.includes('document.documentElement')) return '<html><body>renderer fallback</body></html>'
        return Function('fetch', `return (${script})`)(async () => ({
          url,
          status: 200,
          headers: { get: () => 'text/html' },
          arrayBuffer: async () => payload,
        }))
      },
    },
  }
  const runtime = createSourcePageRuntime({
    permittedSourceUrl,
    sourceFromUrl: () => 'theol',
    syncPageQueue: { enqueue: (job) => job() },
    getSyncPageWindow: () => window,
    setSyncPageWindow: () => {},
    loadSourceWindowUrl: async () => { throw new Error('Background page navigation timed out') },
    closeWindowAndWait: async () => {},
  })

  const result = await runtime.loadWithSchoolBrowser(url)
  assert.match(result.text, /课程/u)
  assert.doesNotMatch(result.text, /�/u)
})

test('successful THEOL navigation re-reads raw bytes before returning HTML', async () => {
  const url = 'https://course.buct.edu.cn/meol/course_summary.jsp?courseId=13509'
  const payload = Buffer.concat([
    Buffer.from('<html><head><meta charset="gb2312"></head><body>'),
    Buffer.from([0xbf, 0xce, 0xb3, 0xcc]),
    Buffer.from('</body></html>'),
  ])
  const window = {
    isDestroyed: () => false,
    webContents: {
      getURL: () => url,
      stop: () => {},
      executeJavaScript: async (script) => Function('fetch', `return (${script})`)(async () => ({
        url,
        status: 200,
        headers: { get: () => 'text/html; charset=utf-8' },
        arrayBuffer: async () => payload,
      })),
    },
  }
  const runtime = createSourcePageRuntime({
    permittedSourceUrl,
    sourceFromUrl: () => 'theol',
    syncPageQueue: { enqueue: (job) => job() },
    getSyncPageWindow: () => window,
    setSyncPageWindow: () => {},
    loadSourceWindowUrl: async () => {},
    closeWindowAndWait: async () => {},
  })

  const result = await runtime.loadWithSchoolBrowser(url)
  assert.match(result.text, /课程/u)
  assert.doesNotMatch(result.text, /�/u)
})
