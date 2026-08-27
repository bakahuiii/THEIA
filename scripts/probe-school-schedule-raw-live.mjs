import { app, safeStorage, session } from 'electron'
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AcademicApiClient } from '../core/academic-api-client.mjs'
import { AcademicApiVault } from '../electron/academic-api-vault.mjs'
import { SessionClient } from '../core/source-client.mjs'

const BASE = 'https://jwglxt.buct.edu.cn/jwglxt/'
const INDEX_URL = new URL('design/viewFunc_cxDesignFuncPageIndex.html?gnmkdm=N219933', BASE).toString()
const DATA_URL = new URL('design/funcData_cxFuncDataList.html?func_widget_guid=5920CCA8B9E61FBAE0530100007F0493', BASE).toString()
const userData = resolve(process.env.APPDATA || '.', 'THEIA')
app.setPath('userData', userData)
app.setPath('sessionData', resolve(userData, 'session'))

function emit(value) {
  const line = `${JSON.stringify({ at: new Date().toISOString(), ...value })}\n`
  process.stdout.write(line)
  try { appendFileSync(process.env.THEIA_PROBE_OUTPUT || resolve(process.cwd(), '.tmp-school-raw-probe.ndjson'), line, 'utf8') } catch { /* stdout remains the fallback */ }
}

async function run() {
  const browserSession = session.fromPartition('persist:theia')
  const browserUrl = `${BASE}`
  let client
  if (process.env.THEIA_PROBE_USE_BROWSER === '1') {
    client = new SessionClient(browserSession, { timeoutMs: 30_000 })
  } else {
    const vault = new AcademicApiVault(userData, safeStorage)
    const credentials = await vault.readCredentials()
    if (!credentials) throw new Error('No saved academic API credentials')
    const api = new AcademicApiClient(credentials)
    await api.login()
    for (const cookie of await browserSession.cookies.get({ url: browserUrl })) {
      if (api.cookies.has(cookie.name)) await browserSession.cookies.remove(browserUrl, cookie.name).catch(() => undefined)
    }
    for (const [name, value] of api.cookies.entries()) {
      await browserSession.cookies.set({ url: browserUrl, name, value, path: '/', secure: true, httpOnly: true })
    }
    client = new SessionClient(browserSession, { timeoutMs: 30_000 })
  }
  const page = await client.page(INDEX_URL, { source: 'raw school schedule probe' })
  emit({ type: 'page', url: page.url, bytes: String(page.text || '').length })
  let totalCount = null
  for (let currentPage = 1; currentPage <= 20; currentPage += 1) {
    const payload = await client.form(DATA_URL, {
      xnm: '2026', xqm: '3', _search: 'false', nd: String(Date.now()),
      'queryModel.showCount': '500', 'queryModel.currentPage': String(currentPage),
      'queryModel.sortName': '', 'queryModel.sortOrder': 'asc', time: '0',
    }, { source: 'raw school schedule probe', referer: page.url })
    let parsed
    try { parsed = JSON.parse(payload) } catch { parsed = null }
    const rows = Array.isArray(parsed) ? parsed : parsed?.items || parsed?.rows || parsed?.data || parsed?.result?.items || []
    totalCount = Number(parsed?.totalCount) || totalCount
    emit({ type: 'response', page: currentPage, bytes: String(payload || '').length, topKeys: parsed && typeof parsed === 'object' ? Object.keys(parsed) : [], rowCount: rows.length, totalCount })
    for (const [index, row] of rows.entries()) {
      const text = JSON.stringify(row)
      if (/PSE30200T|科技写作与报告|54F89D71FC0F85EEE063B99AC3798EE2/u.test(text)) emit({ type: 'match', page: currentPage, index, row })
    }
    if (!rows.length || (totalCount && currentPage * 500 >= totalCount)) break
  }
}

app.on('ready', () => {
  void run().catch((error) => { emit({ type: 'error', name: error?.name || 'Error', message: error?.message || String(error), code: error?.code || null }); process.exitCode = 1 }).finally(() => app.exit(process.exitCode || 0))
})
