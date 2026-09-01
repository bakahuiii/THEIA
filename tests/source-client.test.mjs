import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeSourceBuffer, detectSourceEncoding, SessionClient } from '../core/source-client.mjs'

test('source client detects and decodes GBK from the HTML charset declaration', () => {
  const bytes = Buffer.concat([
    Buffer.from('<html><head><meta http-equiv="Content-Type" content="text/html; charset=gb2312"></head><body>'),
    Buffer.from([0xbf, 0xce, 0xb3, 0xcc]),
    Buffer.from('</body></html>'),
  ])
  assert.equal(detectSourceEncoding(bytes, 'text/html'), 'gbk')
  assert.match(decodeSourceBuffer(bytes, 'text/html'), /课程/u)
})

test('source client lets a legacy HTML charset override an incorrect UTF-8 header', () => {
  const bytes = Buffer.concat([
    Buffer.from('<meta charset="gbk"><body>'),
    Buffer.from([0xd6, 0xd0, 0xce, 0xc4]),
    Buffer.from('</body>'),
  ])
  assert.equal(detectSourceEncoding(bytes, 'text/html; charset=utf-8'), 'gbk')
  assert.match(decodeSourceBuffer(bytes, 'text/html; charset=utf-8'), /中文/u)
})

test('session client falls back to the request URL when Electron returns an empty response URL', async () => {
  const client = new SessionClient(
    { cookies: { get: async () => [] } },
    { requestSession: { fetch: async () => new Response('<html><body>ok</body></html>', { status: 200 }) } },
  )

  const result = await client.request('https://jwglxt.buct.edu.cn/jwglxt/xtgl/index_initMenu.html', {}, { source: 'test' })
  assert.equal(result.url, 'https://jwglxt.buct.edu.cn/jwglxt/xtgl/index_initMenu.html')
})

test('session client uses Electron follow redirects without copying Cookie headers', async () => {
  let observed
  class Session {
    constructor() {
      this.cookies = { get: async () => [{ name: 'JSESSIONID', value: 'scoped-session' }] }
    }

    async fetch(url, init) {
      observed = { url: String(url), redirect: init.redirect, cookie: new Headers(init.headers).get('Cookie') }
      return new Response('<html><body>ok</body></html>', { status: 200 })
    }
  }
  const session = new Session()
  const client = new SessionClient(session)

  await client.request('https://jwglxt.buct.edu.cn/jwglxt/xtgl/index_initMenu.html', {}, { source: 'test' })
  assert.deepEqual(observed, {
    url: 'https://jwglxt.buct.edu.cn/jwglxt/xtgl/index_initMenu.html',
    redirect: 'follow',
    cookie: null,
  })
})

test('session client retries transient GET failures but never retries a POST', async () => {
  let getCalls = 0
  const client = new SessionClient(
    { cookies: { get: async () => [] } },
    {
      requestSession: {
        fetch: async (_url, init) => {
          if (init.method === 'POST') return new Response('down', { status: 503 })
          getCalls += 1
          return getCalls < 3 ? new Response('busy', { status: 503 }) : new Response('ok', { status: 200 })
        },
      },
    },
  )

  const result = await client.request('https://jwglxt.buct.edu.cn/jwglxt/retry', {}, { source: 'retry-test' })
  assert.equal(result.text, 'ok')
  assert.equal(getCalls, 3)
  await assert.rejects(
    client.request('https://jwglxt.buct.edu.cn/jwglxt/retry', { method: 'POST', body: 'x' }, { source: 'retry-test' }),
    /503/,
  )
  assert.equal(getCalls, 3)
})

test('session client retries Electron cancelled redirects for idempotent GET requests', async () => {
  let calls = 0
  const client = new SessionClient(
    { cookies: { get: async () => [] } },
    {
      requestSession: {
        fetch: async () => {
          calls += 1
          if (calls < 2) throw new Error('Redirect was cancelled')
          return new Response('recovered', { status: 200 })
        },
      },
    },
  )

  const result = await client.request('https://jwglxt.buct.edu.cn/jwglxt/retry-redirect', {}, { source: 'retry-test' })
  assert.equal(result.text, 'recovered')
  assert.equal(calls, 2)
})

test('session client mirrors browser cookies into an isolated request session', async () => {
  const copied = []
  const browserCookie = {
    name: 'JSESSIONID',
    value: 'session-value',
    domain: 'course.buct.edu.cn',
    path: '/meol',
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
  }
  const client = new SessionClient(
    { cookies: { get: async () => [browserCookie] } },
    {
      requestSession: {
        cookies: { set: async (cookie) => { copied.push(cookie) } },
        fetch: async () => new Response('<html><body>ok</body></html>', { status: 200 }),
      },
    },
  )

  await client.request('https://course.buct.edu.cn/meol/index.do', {}, { source: 'test' })
  assert.deepEqual(copied, [{
    url: 'https://course.buct.edu.cn/meol',
    name: 'JSESSIONID',
    value: 'session-value',
    domain: 'course.buct.edu.cn',
    path: '/meol',
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
  }])
})

test('session client reuses a Secure campus session for an official HTTP endpoint', async () => {
  const copied = []
  let observed
  const cookieUrls = []
  const browserCookie = {
    name: 'JSESSIONID',
    value: 'sensitive-session',
    domain: 'course.buct.edu.cn',
    path: '/meol',
    secure: true,
    httpOnly: true,
  }
  const client = new SessionClient(
    {
      cookies: {
        get: async ({ url }) => {
          cookieUrls.push(url)
          return url.startsWith('https://') ? [browserCookie] : []
        },
      },
    },
    {
      requestSession: {
        cookies: { set: async (cookie) => { copied.push(cookie) } },
        fetch: async (url, init) => {
          observed = { url: String(url), headers: new Headers(init.headers), credentials: init.credentials }
          return new Response('{"status":[-2]}', { status: 200 })
        },
      },
    },
  )

  await client.request('http://course.buct.edu.cn/mobile/stuUnDoTaskList.do', {}, { source: 'legacy mobile endpoint' })
  assert.equal(copied.length, 1)
  assert.equal(observed.headers.get('Cookie'), 'JSESSIONID=sensitive-session')
  assert.equal(observed.credentials, 'include')
  assert.deepEqual(cookieUrls, [
    'http://course.buct.edu.cn/mobile/stuUnDoTaskList.do',
    'https://course.buct.edu.cn/mobile/stuUnDoTaskList.do',
  ])
})

test('HTTP pages and forms use the direct campus session path instead of a rendered browser loader', async () => {
  let pageCalls = 0
  let formCalls = 0
  const fetches = []
  const client = new SessionClient(
    { cookies: { get: async () => [] } },
    {
      pageLoader: async (url) => { pageCalls += 1; return { url, text: '' } },
      formLoader: async (url) => { formCalls += 1; return { url, status: 200, text: '{}' } },
      requestSession: {
        fetch: async (url, init) => {
          fetches.push({ url: String(url), method: init.method || 'GET' })
          return new Response('{}', { status: 200 })
        },
      },
    },
  )

  await client.page('http://course.buct.edu.cn/mobile/stuUnDoTaskList.do', { source: 'legacy mobile endpoint' })
  await client.form('http://course.buct.edu.cn/mobile/homeworkView.do', {}, { source: 'legacy mobile endpoint' })
  assert.equal(pageCalls, 0)
  assert.equal(formCalls, 0)
  assert.deepEqual(fetches, [
    { url: 'http://course.buct.edu.cn/mobile/stuUnDoTaskList.do', method: 'GET' },
    { url: 'http://course.buct.edu.cn/mobile/homeworkView.do', method: 'POST' },
  ])
})

test('session client uses a supplied browser page loader for rendered HTML', async () => {
  const client = new SessionClient(
    { cookies: { get: async () => [] } },
    {
      pageLoader: async (url) => ({ url: `${url}?rendered=1`, text: '<html><body>ready</body></html>' }),
      requestSession: { fetch: async () => { throw new Error('page loader should be used') } },
    },
  )

  const page = await client.page('https://course.buct.edu.cn/meol/personal.do', { source: 'test' })
  assert.equal(page.url, 'https://course.buct.edu.cn/meol/personal.do?rendered=1')
  assert.equal(page.text, '<html><body>ready</body></html>')
})

test('session client classifies THEOL timeout permission pages as authentication failures', async () => {
  const client = new SessionClient(
    { cookies: { get: async () => [] } },
    {
      pageLoader: async (url) => ({
        url,
        text: '<html><body>您没有权限访问本页面！可能的原因为登录时间超时，请重新登录！</body></html>',
      }),
      requestSession: { fetch: async () => { throw new Error('page loader should be used') } },
    },
  )

  await assert.rejects(
    client.page('https://course.buct.edu.cn/meol/common/hw/student/hwtask.view.jsp?hwtid=1', { source: 'THEOL 作业' }),
    (error) => error?.name === 'AuthRequiredError' && error?.source === 'THEOL 作业',
  )
})

test('session client passes an external abort signal to the browser page loader', async () => {
  const controller = new AbortController()
  let received
  const client = new SessionClient(
    { cookies: { get: async () => [] } },
    {
      pageLoader: async (url, options) => {
        received = { url, options }
        return { url, text: '<html><body>ready</body></html>' }
      },
      requestSession: { fetch: async () => { throw new Error('page loader should be used') } },
    },
  )

  await client.page('https://course.buct.edu.cn/meol/personal.do', {
    source: 'test page',
    signal: controller.signal,
  })
  assert.equal(received.url, 'https://course.buct.edu.cn/meol/personal.do')
  assert.equal(received.options.source, 'test page')
  assert.equal(received.options.signal, controller.signal)
})

test('session client does not invoke the browser page loader for an already aborted signal', async () => {
  const controller = new AbortController()
  controller.abort()
  let calls = 0
  const client = new SessionClient(
    { cookies: { get: async () => [] } },
    {
      pageLoader: async (url) => {
        calls += 1
        return { url, text: '<html><body>unexpected</body></html>' }
      },
    },
  )

  await assert.rejects(
    client.page('https://course.buct.edu.cn/meol/personal.do', {
      source: 'test page',
      signal: controller.signal,
    }),
    (error) => error?.code === 'ABORT_ERR',
  )
  assert.equal(calls, 0)
})

test('session client classifies external cancellation of a direct request as ABORT_ERR', async () => {
  const controller = new AbortController()
  let observeFetchStart
  const fetchStarted = new Promise((resolveStarted) => { observeFetchStart = resolveStarted })
  const client = new SessionClient(
    { cookies: { get: async () => [] } },
    {
      requestSession: {
        fetch: async (_url, init) => new Promise((resolve, reject) => {
          const abort = () => reject(new DOMException('The operation was aborted', 'AbortError'))
          if (init.signal.aborted) return abort()
          init.signal.addEventListener('abort', abort, { once: true })
          observeFetchStart()
        }),
      },
    },
  )

  const pending = client.request(
    'https://course.buct.edu.cn/meol/personal.do',
    {},
    { source: 'test direct request', signal: controller.signal },
  )
  await fetchStarted
  controller.abort()
  await assert.rejects(pending, (error) => {
    assert.equal(error?.name, 'SourceRequestError')
    assert.equal(error?.code, 'ABORT_ERR')
    return true
  })
})

test('session client uses a browser form loader for authenticated POST requests', async () => {
  const calls = []
  const client = new SessionClient(
    { cookies: { get: async () => [] } },
    {
      formLoader: async (url, values, options) => {
        calls.push({ url, values, options })
        return { url, status: 200, text: '{"items":[{"id":"1"}]}' }
      },
      requestSession: { fetch: async () => { throw new Error('form loader should be used') } },
    },
  )

  const body = await client.form('https://jwglxt.buct.edu.cn/jwglxt/cjcx/query', { xnm: '2025' }, { source: 'test', referer: 'https://jwglxt.buct.edu.cn/jwglxt/cjcx/index' })
  assert.equal(body, '{"items":[{"id":"1"}]}')
  assert.deepEqual(calls, [{
    url: 'https://jwglxt.buct.edu.cn/jwglxt/cjcx/query',
    values: { xnm: '2025' },
    options: {
      referer: 'https://jwglxt.buct.edu.cn/jwglxt/cjcx/index',
      signal: null,
      source: 'test',
    },
  }])
})

test('session client direct forms retain the XMLHttpRequest header used by JWGLXT', async () => {
  let submitted
  const client = new SessionClient(
    { cookies: { get: async () => [{ name: 'JSESSIONID', value: 'academic-session' }] } },
    {
      requestSession: {
        fetch: async (url, init) => {
          submitted = { url: String(url), headers: new Headers(init.headers), body: init.body }
          return new Response('{"items":[]}', { status: 200 })
        },
      },
    },
  )

  await client.form(
    'https://jwglxt.buct.edu.cn/jwglxt/query',
    { xnm: '2026' },
    { source: 'test', referer: 'https://jwglxt.buct.edu.cn/jwglxt/index' },
  )
  assert.equal(submitted.headers.get('X-Requested-With'), 'XMLHttpRequest')
  assert.equal(submitted.headers.get('Referer'), 'https://jwglxt.buct.edu.cn/jwglxt/index')
  assert.equal(submitted.headers.get('Cookie'), 'JSESSIONID=academic-session')
  assert.equal(submitted.body, 'xnm=2026')
})

test('session client stops oversized attachment responses before returning a buffer', async () => {
  const client = new SessionClient(
    { cookies: { get: async () => [] } },
    { requestSession: { fetch: async () => new Response(Buffer.from('123456')) } },
  )

  await assert.rejects(
    client.binary('https://course.buct.edu.cn/meol/download/large.bin', { source: 'test attachment', maxBytes: 5 }),
    /超过 1 MB 限制/,
  )
})

test('session client can read HTTPS attachments through a rendered binary loader', async () => {
  const calls = []
  const client = new SessionClient(
    { cookies: { get: async () => [] } },
    {
      binaryLoader: async (url, options) => {
        calls.push({
          url,
          signal: Boolean(options.signal),
          method: options.method,
          headers: options.headers,
          body: options.body,
          referer: options.referer,
        })
        return { url, status: 200, buffer: Buffer.from('%PDF-rendered') }
      },
      requestSession: { fetch: async () => { throw new Error('direct fetch should not run') } },
    },
  )

  const result = await client.binary('https://jwglxt.buct.edu.cn/jwglxt/plan.pdf', {
    method: 'POST',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    body: 'xnm=2026&xqm=3',
    referer: 'https://jwglxt.buct.edu.cn/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html',
  })
  assert.equal(result.buffer.toString(), '%PDF-rendered')
  assert.deepEqual(calls, [{
    url: 'https://jwglxt.buct.edu.cn/jwglxt/plan.pdf',
    signal: true,
    method: 'POST',
    headers: {
      'referer': 'https://jwglxt.buct.edu.cn/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html',
      'x-requested-with': 'XMLHttpRequest',
    },
    body: 'xnm=2026&xqm=3',
    referer: 'https://jwglxt.buct.edu.cn/jwglxt/kbcx/xskbcx_cxXskbcxIndex.html',
  }])
})

test('session client rejects non-campus attachment URLs before reading cookies or fetching', async () => {
  let cookieReads = 0
  let fetches = 0
  const client = new SessionClient(
    { cookies: { get: async () => { cookieReads += 1; return [] } } },
    { requestSession: { fetch: async () => { fetches += 1; return new Response('unexpected') } } },
  )

  await assert.rejects(
    client.binary('https://example.com/private.bin'),
    /拒绝访问非校园网地址/,
  )
  assert.equal(cookieReads, 0)
  assert.equal(fetches, 0)
})

test('session client validates every attachment redirect before issuing the next request', async () => {
  const fetches = []
  const client = new SessionClient(
    { cookies: { get: async ({ url }) => url.includes('course.buct.edu.cn') ? [{ name: 'SESSION', value: 'secret' }] : [] } },
    {
      requestSession: {
        fetch: async (url, init) => {
          fetches.push({ url: String(url), cookie: new Headers(init.headers).get('Cookie'), redirect: init.redirect })
          return new Response(null, { status: 302, headers: { Location: 'https://example.com/collect' } })
        },
      },
    },
  )

  await assert.rejects(
    client.binary('https://course.buct.edu.cn/meol/download/file.bin'),
    /拒绝重定向到非校园网地址/,
  )
  assert.deepEqual(fetches, [{
    url: 'https://course.buct.edu.cn/meol/download/file.bin',
    cookie: 'SESSION=secret',
    redirect: 'manual',
  }])
})

test('session client sends a form body for POST binary responses', async () => {
  let observed
  const client = new SessionClient(
    { cookies: { get: async () => [] } },
    {
      requestSession: {
        fetch: async (_url, init) => {
          observed = {
            method: init.method,
            body: init.body,
            contentType: new Headers(init.headers).get('Content-Type'),
            referer: new Headers(init.headers).get('Referer'),
          }
          return new Response(Buffer.from('%PDF-test'), {
            status: 200,
            headers: { 'Content-Type': 'application/pdf' },
          })
        },
      },
    },
  )

  const result = await client.binary('https://jwglxt.buct.edu.cn/jwglxt/export', {
    source: 'schedule PDF',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'xnm=2026&xqm=3',
    referer: 'https://jwglxt.buct.edu.cn/jwglxt/kbcx/schedule',
  })

  assert.equal(result.buffer.toString(), '%PDF-test')
  assert.deepEqual(observed, {
    method: 'POST',
    body: 'xnm=2026&xqm=3',
    contentType: 'application/x-www-form-urlencoded',
    referer: 'https://jwglxt.buct.edu.cn/jwglxt/kbcx/schedule',
  })
})

test('session client follows campus redirects and rebuilds cookies for each host', async () => {
  const fetches = []
  const client = new SessionClient(
    {
      cookies: {
        get: async ({ url }) => [{
          name: 'SESSION',
          value: new URL(url).hostname === 'course.buct.edu.cn' ? 'course-cookie' : 'files-cookie',
        }],
      },
    },
    {
      requestSession: {
        fetch: async (url, init) => {
          fetches.push({ url: String(url), cookie: new Headers(init.headers).get('Cookie') })
          if (fetches.length === 1) {
            return new Response(null, { status: 302, headers: { Location: 'https://files.buct.edu.cn/download/file.bin' } })
          }
          return new Response(Buffer.from('ok'), { status: 200 })
        },
      },
    },
  )

  const result = await client.binary('https://course.buct.edu.cn/meol/download/file.bin')
  assert.equal(result.buffer.toString(), 'ok')
  assert.deepEqual(fetches, [
    { url: 'https://course.buct.edu.cn/meol/download/file.bin', cookie: 'SESSION=course-cookie' },
    { url: 'https://files.buct.edu.cn/download/file.bin', cookie: 'SESSION=files-cookie' },
  ])
})

test('browser-backed page and form loaders cannot return an off-campus final URL', async () => {
  const client = new SessionClient(
    { cookies: { get: async () => [] } },
    {
      pageLoader: async () => ({ url: 'https://example.com/page', text: '<html>unexpected</html>' }),
      formLoader: async () => ({ url: 'https://example.com/result', status: 200, text: '{}' }),
    },
  )

  await assert.rejects(client.page('https://course.buct.edu.cn/meol/page'), /HTTPS.*buct\.edu\.cn/)
  await assert.rejects(client.form('https://course.buct.edu.cn/meol/form', {}, { referer: 'https://course.buct.edu.cn/meol/page' }), /HTTPS.*buct\.edu\.cn/)
})
