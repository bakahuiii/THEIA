import { constants, createPublicKey, publicEncrypt } from 'node:crypto'
import iconv from 'iconv-lite'
import { parseJwAcademicProgress } from './parsers/jwglxt.mjs'
import { mergeAcademicProgressDetails } from './academic-progress.mjs'
import { permittedAcademicApiUrl } from './source-url-policy.mjs'
import { htmlLooksLikeLogin } from './util.mjs'

const BASE = 'https://jwglxt.buct.edu.cn/jwglxt/'
const LOGIN = new URL('xtgl/login_slogin.html', BASE).toString()
const PUBLIC_KEY = new URL('xtgl/login_getPublicKey.html', BASE).toString()
const ACADEMIC_PROGRESS = new URL('xsxy/xsxyqk_cxXsxyqkIndex.html?gnmkdm=N105515&layout=default', BASE).toString()
export const ACADEMIC_PROGRESS_DETAILS = new URL('xsxy/xsxyqk_cxJxzxjhxfyqKcxx.html?gnmkdm=N105515', BASE).toString()
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'

export class AcademicApiError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AcademicApiError'
    this.code = code
  }
}

function decode(buffer, contentType) {
  const charset = String(contentType || '').match(/charset\s*=\s*['"]?([^;"']+)/i)?.[1]?.toLowerCase()
  return charset && !['utf-8', 'utf8'].includes(charset)
    ? iconv.decode(buffer, charset)
    : new TextDecoder().decode(buffer)
}

function cookieNameValue(value) {
  const first = String(value || '').split(';', 1)[0]
  const separator = first.indexOf('=')
  return separator > 0 ? [first.slice(0, separator).trim(), first.slice(separator + 1).trim()] : null
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url')
}

function encryptPassword(password, modulus, exponent) {
  const key = createPublicKey({
    key: { kty: 'RSA', n: base64Url(Buffer.from(modulus, 'base64')), e: base64Url(Buffer.from(exponent, 'base64')) },
    format: 'jwk',
  })
  return publicEncrypt({ key, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(String(password))).toString('base64')
}

function parseNumber(value) {
  const match = String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : null
}

function textFromHtml(value) {
  return String(value ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function hasRequirementTree(progress) {
  return Array.isArray(progress?.roots) && progress.roots.length > 0
}

function embeddedPlanMarkupVariants(html) {
  const source = String(html || '')
  const decodeEscapes = (value) => String(value || '')
    .replace(/\\u003c/gi, '<')
    .replace(/\\u003e/gi, '>')
    .replace(/\\u0022/gi, '"')
    .replace(/\\u0027/gi, "'")
    .replace(/\\(["'\\/])/g, '$1')
    .replace(/\\r\\n|\\n|\\r/g, '\n')
    .replace(/&quot;/gi, '"')
  const values = new Set([source, decodeEscapes(source)])
  // The DOM parser deliberately treats markup inside <script> as text. Pull
  // script payloads out first, then decode their JavaScript string escapes so
  // Cheerio can see the embedded <li> topology as ordinary markup.
  for (const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const script = match[1]
    values.add(script)
    values.add(decodeEscapes(script))
  }
  return [...values]
}

export function academicPlanNodes(html, sourceUrl) {
  // N105515 embeds the authoritative <li> requirement tree in JavaScript on
  // some Zhengfang releases. Decode the escaped markup before falling back to
  // its flat strings; the <li> attributes carry the actual parent and OR/AND
  // edges and must never be reconstructed from node order.
  const summary = parseJwAcademicProgress(html, { sourceUrl })
  let progress = summary
  if (!hasRequirementTree(progress)) {
    for (const markup of embeddedPlanMarkupVariants(html).slice(1)) {
      const parsed = parseJwAcademicProgress(markup, { sourceUrl })
      if (!hasRequirementTree(parsed)) continue
      // The script payload contains the authoritative tree, while GPA and
      // course totals remain in the surrounding page. Keep both halves.
      progress = mergeAcademicProgressDetails(summary, parsed)
      break
    }
  }
  const byId = new Map((progress.categories || []).map((node) => [String(node.id), node]))
  const pattern = /"([^"\r\n]+?)&nbsp;[\s\S]*?\u8981\u6c42\u5b66\u5206[\s\S]*?:\s*([\d.]+|&nbsp;)[\s\S]*?\u83b7\u5f97\u5b66\u5206[\s\S]*?:\s*([\d.]+|&nbsp;)[\s\S]*?\u672a\u83b7\u5f97\u5b66\u5206[\s\S]*?:\s*([\d.]+|&nbsp;)[\s\S]*?<span\s+id=['"]showKc([^'"]+)['"]><\/span>/g
  for (const match of String(html || '').matchAll(pattern)) {
    const title = textFromHtml(match[1])
    const id = String(match[5] || '').trim()
    if (!title || !id || byId.has(id)) continue
    byId.set(id, {
      id,
      title,
      required: parseNumber(match[2]),
      earned: parseNumber(match[3]),
      remaining: parseNumber(match[4]),
    })
  }
  // Some Zhengfang releases embed ids in JavaScript rather than direct DOM
  // attributes. Keep those ids in the fetch list even when that release does
  // not expose enough markup to reconstruct a tree.
  for (const match of String(html || '').matchAll(/xfyqjd_id\s*[=:'"]+\s*['"]?([A-Z0-9_-]{6,})/gi)) {
    const id = String(match[1]).trim()
    if (!byId.has(id)) byId.set(id, { id, title: `Requirement ${id}`, required: null, earned: null, remaining: null })
  }
  return { nodes: [...byId.values()], progress }
}

export function sidFromAcademicPage(html) {
  return String(html || '').match(/<input[^>]+id=['"]xh_id['"][^>]+value=['"]([^'"]+)/i)?.[1]?.trim() || null
}

export async function readAcademicProgressDetails(client, {
  page = null,
  username = null,
  concurrency = 4,
} = {}) {
  const overview = page || await client.page(ACADEMIC_PROGRESS, { source: 'Academic degree requirements' })
  const { nodes, progress } = academicPlanNodes(overview.text, overview.url)
  const sid = sidFromAcademicPage(overview.text) || String(username || '').trim() || null
  const details = []
  const errors = []
  let cursor = 0
  const worker = async () => {
    while (cursor < nodes.length) {
      const node = nodes[cursor]
      cursor += 1
      try {
        const text = await client.form(ACADEMIC_PROGRESS_DETAILS, {
          xfyqjd_id: node.id,
          ...(sid ? { xh_id: sid } : {}),
        }, {
          source: 'Academic degree requirement detail',
          referer: overview.url,
        })
        const parsed = JSON.parse(text)
        const courses = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.data) ? parsed.data : []
        details.push({ ...node, courses })
      } catch (error) {
        errors.push({ id: node.id, error: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  const workerCount = Math.max(1, Math.min(8, Number(concurrency) || 1, nodes.length || 1))
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return { sid, progress, details, errors, sourceUrl: overview.url, nodeCount: nodes.length }
}

export class AcademicApiClient {
  constructor({ username, password, fetchImpl = fetch, timeoutMs = 20_000 }) {
    this.username = String(username || '').trim()
    this.password = String(password || '')
    this.fetch = fetchImpl
    this.timeoutMs = timeoutMs
    this.cookies = new Map()
  }

  cookieHeader() { return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ') }

  absorbCookies(headers) {
    const values = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : headers.get('set-cookie') ? [headers.get('set-cookie')] : []
    values.forEach((value) => {
      const parsed = cookieNameValue(value)
      if (parsed) this.cookies.set(parsed[0], parsed[1])
    })
  }

  async request(url, init = {}, redirects = 0) {
    if (redirects > 5) throw new AcademicApiError(999, '教务 API 重定向过多')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      let target
      try { target = permittedAcademicApiUrl(url) } catch {
        throw new AcademicApiError(999, '教务 API 拒绝访问非校园网地址')
      }
      const headers = new Headers(init.headers || {})
      headers.set('User-Agent', USER_AGENT)
      headers.set('Accept-Language', 'zh-CN,zh;q=0.9')
      if (this.cookies.size && !headers.has('Cookie')) headers.set('Cookie', this.cookieHeader())
      const response = await this.fetch(target, { ...init, headers, redirect: 'manual', signal: controller.signal })
      this.absorbCookies(response.headers)
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location')
        if (!location) throw new AcademicApiError(999, '教务 API 返回了无目标的重定向')
        let nextUrl
        try { nextUrl = permittedAcademicApiUrl(new URL(location, target).toString()) } catch {
          throw new AcademicApiError(999, '教务 API 拒绝重定向到非校园网地址')
        }
        const method = String(init.method || 'GET').toUpperCase()
        const switchToGet = response.status === 303 || ([301, 302].includes(response.status) && method === 'POST')
        const nextInit = { ...init }
        if (switchToGet) {
          nextInit.method = 'GET'
          delete nextInit.body
          const nextHeaders = new Headers(nextInit.headers || {})
          nextHeaders.delete('Content-Type')
          nextHeaders.delete('Content-Length')
          nextInit.headers = nextHeaders
        }
        return this.request(nextUrl, nextInit, redirects + 1)
      }
      const buffer = Buffer.from(await response.arrayBuffer())
      const text = decode(buffer, response.headers.get('content-type'))
      if (!response.ok) throw new AcademicApiError(response.status === 503 ? 2333 : 999, `教务 API 请求失败 (${response.status})`)
      let finalUrl
      try { finalUrl = permittedAcademicApiUrl(response.url || target) } catch {
        throw new AcademicApiError(999, '教务 API 返回了非校园网地址')
      }
      return { text, url: finalUrl }
    } catch (error) {
      if (error instanceof AcademicApiError) throw error
      if (error?.name === 'AbortError') throw new AcademicApiError(1003, '教务 API 请求超时')
      throw new AcademicApiError(999, `教务 API 网络错误：${error instanceof Error ? error.message : String(error)}`)
    } finally { clearTimeout(timer) }
  }

  async login() {
    if (!this.username || !this.password) throw new AcademicApiError(1002, '未配置教务 API 账号或密码')
    const loginPage = await this.request(LOGIN)
    if (/id=["']yzm["']|name=["']yzm["']/i.test(loginPage.text)) throw new AcademicApiError(1001, '教务 API 当前要求验证码，本轮已停止；请改用统一身份认证浏览器通道或稍后重试')
    const csrf = loginPage.text.match(/id=["']csrftoken["'][^>]*value=["']([^"']+)/i)?.[1]
      || loginPage.text.match(/name=["']csrftoken["'][^>]*value=["']([^"']+)/i)?.[1]
    if (!csrf) throw new AcademicApiError(999, '教务 API 登录页缺少安全令牌')
    let publicKey
    try { publicKey = JSON.parse((await this.request(PUBLIC_KEY)).text) } catch { throw new AcademicApiError(999, '教务 API 公钥读取失败') }
    if (!publicKey?.modulus || !publicKey?.exponent) throw new AcademicApiError(999, '教务 API 未返回有效公钥')
    const body = new URLSearchParams({ csrftoken: csrf, yhm: this.username, mm: encryptPassword(this.password, publicKey.modulus, publicKey.exponent) }).toString()
    const result = await this.request(LOGIN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Referer: LOGIN }, body })
    const tip = result.text.match(/<p[^>]+id=["']tips["'][^>]*>([\s\S]*?)<\/p>/i)?.[1]?.replace(/<[^>]+>/g, ' ').trim()
    if (tip) throw new AcademicApiError(/用户名或密码/.test(tip) ? 1002 : 998, tip)
    return this.page(new URL('xtgl/index_initMenu.html', BASE).toString(), { source: '教务 API' })
  }

  async page(url, { source = '教务 API' } = {}) {
    const result = await this.request(url)
    if (htmlLooksLikeLogin(result.text, result.url)) throw new AcademicApiError(1006, `${source} 会话已失效`)
    return result
  }

  async form(url, values, { source = '教务 API', referer = url } = {}) {
    const result = await this.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Referer: referer, 'X-Requested-With': 'XMLHttpRequest' },
      body: new URLSearchParams(values || {}).toString(),
    })
    if (htmlLooksLikeLogin(result.text, result.url)) throw new AcademicApiError(1006, `${source} 会话已失效`)
    return result.text
  }

  // The overview page contains requirement identifiers. Fetching their rows
  // through this same cookie jar avoids invalidating the browser SSO session.
  async academicProgressDetails() {
    return readAcademicProgressDetails(this, { username: this.username })
  }
}

export { BASE as ACADEMIC_API_BASE }
