import { app, safeStorage, session } from 'electron'
import { appendFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import * as cheerio from 'cheerio'
import { AcademicApiClient } from '../core/academic-api-client.mjs'
import { AcademicApiVault } from '../electron/academic-api-vault.mjs'
import { SessionClient } from '../core/source-client.mjs'

const BASE = 'https://jwglxt.buct.edu.cn/jwglxt/'
const INDEX_URL = new URL('xsxk/zzxkyzb_cxZzxkYzbIndex.html?gnmkdm=N253512&layout=default', BASE).toString()
const DISPLAY_URL = new URL('xsxk/zzxkyzb_cxZzxkYzbDisplay.html?gnmkdm=N253512', BASE).toString()
const CLASS_URL = new URL('xsxk/zzxkyzbjk_cxJxbWithKchZzxkYzb.html?gnmkdm=N253512', BASE).toString()
const COURSE_CODE = String(process.env.THEIA_HIDDEN_COURSE_CODE || 'PSE30200T').trim()
const TARGET_CLASS = String(process.env.THEIA_HIDDEN_CLASS_ID || '54F89D71FC0F85EEE063B99AC3798EE2').trim()
const output = resolve(process.env.THEIA_HIDDEN_PROBE_OUTPUT || resolve(process.env.APPDATA || '.', 'THEIA', 'course-selection', 'hidden-probe.ndjson'))
const userData = resolve(process.env.APPDATA || '.', 'THEIA')
app.setPath('userData', userData)
app.setPath('sessionData', resolve(userData, 'session'))

async function report(value) {
  const line = `${JSON.stringify({ at: new Date().toISOString(), ...value })}\n`
  await mkdir(resolve(output, '..'), { recursive: true })
  await appendFile(output, line, 'utf8')
  process.stdout.write(line)
}

function readFields(html) {
  const $ = cheerio.load(html)
  const values = {}
  $('input,select,textarea').each((_index, node) => {
    const field = $(node)
    const name = field.attr('name') || field.attr('id')
    if (name) values[name] = String(field.attr('value') ?? field.val() ?? '')
  })
  return values
}

async function run() {
  const diagnostics = []
  const onDiagnostic = (event, fields) => diagnostics.push({ event, ...fields })
  const vault = new AcademicApiVault(userData, safeStorage)
  const credentials = await vault.readCredentials()
  if (!credentials) throw new Error('No saved academic API credentials')
  const api = new AcademicApiClient({ ...credentials, onDiagnostic })
  await api.login()
  const browserSession = session.fromPartition('persist:theia')
  const browserUrl = 'https://jwglxt.buct.edu.cn/jwglxt/'
  const existing = await browserSession.cookies.get({ url: browserUrl })
  for (const cookie of existing) {
    if (api.cookies.has(cookie.name)) await browserSession.cookies.remove(browserUrl, cookie.name).catch(() => undefined)
  }
  for (const [name, value] of api.cookies.entries()) {
    await browserSession.cookies.set({ url: browserUrl, name, value, path: '/', secure: true, httpOnly: true })
  }
  const client = new SessionClient(browserSession, { timeoutMs: 30_000 })
  const index = await client.page(INDEX_URL, { source: 'hidden-course probe' })
  const $index = cheerio.load(index.text)
  const blocks = []
  $index('a[role="tab"],a[onclick*="xkkz_id"]').each((_index, node) => {
    const args = [...String($index(node).attr('onclick') || '').matchAll(/["']([^"']+)["']/g)].map((match) => match[1])
    if (args[1]) blocks.push({ categoryCode: args[0], id: args[1], gradeId: args[2] || '', majorId: args[3] || '' })
  })
  await report({ type: 'portal', blocks, courseCode: COURSE_CODE, targetClass: TARGET_CLASS })
  for (const block of blocks) {
    const displayBody = await client.form(DISPLAY_URL, {
      xkkz_id: block.id, kklxdm: block.categoryCode, xszxzt: '0',
      njdm_id: block.gradeId, zyh_id: block.majorId, kspage: '0', jspage: '0',
    }, { source: 'hidden-course display', referer: index.url })
    const display = readFields(displayBody)
    const values = {
      ...display,
      xkkz_id: block.id,
      kklxdm: block.categoryCode,
      kch_id: COURSE_CODE,
      filterKey: 'all',
      'filter_list[0]': COURSE_CODE,
    }
    const body = await client.form(CLASS_URL, values, { source: 'hidden-course classes', referer: index.url })
    let payload
    try { payload = JSON.parse(body) } catch { payload = null }
    const rows = Array.isArray(payload) ? payload : payload?.items || payload?.rows || payload?.data || []
    await report({
      type: 'class-result', block, requestKeys: Object.keys(values).sort(),
      payloadKind: Array.isArray(payload) ? 'array' : typeof payload,
      rowCount: Array.isArray(rows) ? rows.length : 0,
      rows: Array.isArray(rows) ? rows.filter((row) => String(row?.jxb_id || row?.classId || '') === TARGET_CLASS || String(row?.jxbmc || '').includes('科技写作与报告')).slice(0, 20) : [],
      bodyPreview: String(body || '').slice(0, 2000),
    })
  }
}

app.on('ready', () => {
  void run().catch(async (error) => {
    await report({ type: 'error', name: error?.name || 'Error', message: error?.message || String(error) })
    process.exitCode = 1
  }).finally(() => app.exit(process.exitCode || 0))
})
