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
