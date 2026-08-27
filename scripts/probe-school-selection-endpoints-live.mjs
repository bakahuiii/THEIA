import { app, safeStorage, session } from 'electron'
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import * as cheerio from 'cheerio'
import { AcademicApiClient } from '../core/academic-api-client.mjs'
import { AcademicApiVault } from '../electron/academic-api-vault.mjs'
import { SessionClient } from '../core/source-client.mjs'

const BASE = 'https://jwglxt.buct.edu.cn/jwglxt/'
const userData = resolve(process.env.APPDATA || '.', 'THEIA')
const output = resolve(process.env.THEIA_ENDPOINT_PROBE_OUTPUT || resolve(process.cwd(), '.tmp-school-selection-endpoints-live.ndjson'))
const detailDir = resolve(process.env.THEIA_ENDPOINT_PROBE_DIR || resolve(process.cwd(), '.tmp-school-selection-endpoints'))
const courseCode = String(process.env.THEIA_HIDDEN_COURSE_CODE || 'PSE30200T').trim()
const courseId = String(process.env.THEIA_HIDDEN_COURSE_ID || courseCode).trim()
const classId = String(process.env.THEIA_HIDDEN_CLASS_ID || '54F89D71FC0F85EEE063B99AC3798EE2').trim()
const rowId = String(process.env.THEIA_HIDDEN_ROW_ID || '671').trim()

app.setPath('userData', userData)
app.setPath('sessionData', resolve(userData, 'session'))

const urls = {
  selectionIndex: new URL('xsxk/zzxkyzb_cxZzxkYzbIndex.html?gnmkdm=N253512&layout=default', BASE).toString(),
  selectionDisplay: new URL('xsxk/zzxkyzb_cxZzxkYzbDisplay.html?gnmkdm=N253512', BASE).toString(),
  classJk: new URL('xsxk/zzxkyzbjk_cxJxbWithKchZzxkYzb.html?gnmkdm=N253512', BASE).toString(),
  // These are the endpoints used by the current BUCT page. Avoid probing
  // guessed legacy paths: some reverse proxies leave them hanging instead
  // of returning a 404.
  classInfoLegacy: new URL('xsxk/zzxkyzb_xkZyDisplayZzxkYzbZjxb.html?gnmkdm=N253512', BASE).toString(),
  titleLegacy: new URL('xsxk/zzxkyzb_cxXkTitleMsg.html?gnmkdm=N253512', BASE).toString(),
  classDetail: new URL('xkgl/common_cxJxbrsmxIndex.html', BASE).toString(),
  scheduleScript: new URL('js/dynamic/N219933-cx-min.js?ver=20170713', BASE).toString(),
}

function emit(value) {
  const line = `${JSON.stringify({ at: new Date().toISOString(), ...value })}\n`
  process.stdout.write(line)
  void mkdir(dirname(output), { recursive: true }).then(() => appendFile(output, line, 'utf8'))
}

async function save(name, body) {
  const path = resolve(detailDir, name)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, String(body ?? ''), 'utf8')
  emit({ type: 'saved', name, bytes: String(body ?? '').length })
}

function parseFields(html) {
  const $ = cheerio.load(String(html || ''))
  const fields = {}
  $('input,select,textarea').each((_index, node) => {
    const element = $(node)
    const name = element.attr('name') || element.attr('id')
    if (name) fields[name] = String(element.attr('value') ?? element.val() ?? '')
  })
  return fields
}

function parseJson(body) {
  try { return JSON.parse(String(body || '')) } catch { return null }
}

function rowsOf(payload) {
  if (Array.isArray(payload)) return payload
  for (const key of ['tmpList', 'items', 'rows', 'data', 'result']) {
    if (Array.isArray(payload?.[key])) return payload[key]
  }
  return []
}

function safeBody(body) {
  return String(body || '').replace(/(JSESSIONID|token|cookie|authorization|password|passwd|pwd|xkkz_xh|jxb_ids|jcxx_id)(?:["']?)\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;}"']+)/gi, '$1=[redacted]').replace(/\s+/g, ' ').slice(0, 1200)
}

function requestSummary(values) {
  return Object.fromEntries(Object.entries(values || {}).map(([key, value]) => [key, ['xkkz_xh', 'jxb_ids', 'jcxx_id'].includes(key) ? (value ? '[present]' : '') : value]))
}

function blockList(html) {
  const $ = cheerio.load(String(html || ''))
  const blocks = []
  $('a[role="tab"],a[onclick*="xkkz_id"]').each((_index, node) => {
    const args = [...String($(node).attr('onclick') || '').matchAll(/["']([^"']+)["']/g)].map((match) => match[1])
    if (args[1]) blocks.push({ categoryCode: args[0], id: args[1], gradeId: args[2] || '', majorId: args[3] || '', controlSequence: args[4] || '' })
  })
  return blocks
}

async function run() {
  const vault = new AcademicApiVault(userData, safeStorage)
  const credentials = await vault.readCredentials()
  if (!credentials) throw new Error('No saved academic API credentials')
  const api = new AcademicApiClient(credentials)
  await api.login()
  const browserSession = session.fromPartition('persist:theia')
  for (const cookie of await browserSession.cookies.get({ url: BASE })) {
    if (api.cookies.has(cookie.name)) await browserSession.cookies.remove(BASE, cookie.name).catch(() => undefined)
  }
  for (const [name, value] of api.cookies.entries()) {
    await browserSession.cookies.set({ url: BASE, name, value, path: '/', secure: true, httpOnly: true })
  }
  const client = new SessionClient(browserSession, { timeoutMs: 30_000 })
  const index = await client.page(urls.selectionIndex, { source: 'school selection endpoint probe' })
  await save('selection-index.html', index.text)
  const blocks = blockList(index.text)
  emit({ type: 'portal', blocks: blocks.map(({ controlSequence, ...block }) => ({ ...block, controlSequence: controlSequence ? '[present]' : '' })), courseCode, courseId, classId, rowId })
  const targetBlock = blocks.find((block) => block.categoryCode === '01') || blocks[0]
  if (!targetBlock) throw new Error('No course-selection block found')
  const displayText = await client.form(urls.selectionDisplay, {
    xkkz_id: targetBlock.id,
    kklxdm: targetBlock.categoryCode,
    xszxzt: '1',
    njdm_id: targetBlock.gradeId,
    zyh_id: targetBlock.majorId,
    kspage: '0',
    jspage: '0',
  }, { source: 'school selection endpoint probe display', referer: index.url })
  await save('display.html', displayText)
  const display = parseFields(displayText)
  emit({ type: 'display', block: targetBlock.categoryCode, fields: Object.fromEntries(Object.entries(display).filter(([key]) => !['xkkz_xh'].includes(key))), bytes: displayText.length })
  const base = {
    ...display,
    xkkz_id: targetBlock.id,
    kklxdm: targetBlock.categoryCode,
    xkkz_xh: targetBlock.controlSequence,
    xkxnm: display.xkxnm || '2026',
    xkxqm: display.xkxqm || '3',
    kch_id: courseId,
    'filter_list[0]': courseCode,
  }
  const classQueries = [
    ['target-full', { ...base }],
    ['target-current-scope', { ...base, njdm_id: display.njdm_id || targetBlock.gradeId, bh_id: display.bh_id || '' }],
    ['target-school-row', { ...base, jxb_id: classId, row_id: rowId }],
    ['target-without-filter', { ...base, 'filter_list[0]': '' }],
  ]
  for (const [label, values] of classQueries) {
    for (const [endpointLabel, endpoint] of [['jk', urls.classJk]]) {
      const body = await client.form(endpoint, values, { source: `school selection endpoint probe ${label} ${endpointLabel}`, referer: index.url })
      const payload = parseJson(body)
      const rows = rowsOf(payload)
      emit({ type: 'class', label, endpoint: endpointLabel, request: requestSummary(values), bytes: String(body || '').length, payloadKind: Array.isArray(payload) ? 'array' : typeof payload, rowCount: rows.length, rows: rows.slice(0, 5).map((row) => ({ kch: row?.kch, kch_id: row?.kch_id, jxb_id: row?.jxb_id, jxbmc: row?.jxbmc, do_jxb_id: row?.do_jxb_id ? '[present]' : row?.do_jxb_id || null })), body: safeBody(body) })
    }
  }
  const infoQueries = [
    ['target-class', { xkxnm: base.xkxnm, xkxqm: base.xkxqm, xkly: display.xkly || '0', jxb_id: classId, jxbzls: '1', rlzlkz: display.rlzlkz || '0', rwlx: display.rwlx || '1', syqz: '100', zyfx_id: display.zyfx_id || 'wfx', bh_id: display.bh_id || '', zyh_id: display.zyh_id || '', njdm_id: display.njdm_id || '', kklxdm: targetBlock.categoryCode, xh_id: display.xh_id || display.xh || '' }],
    ['target-operation', { ...base, jxb_id: classId, jxb_ids: classId, jxbzls: '1' }],
  ]
  for (const [label, values] of infoQueries) {
    for (const [endpointLabel, endpoint] of [['class-info', urls.classInfoLegacy], ['title', urls.titleLegacy], ['detail', urls.classDetail]]) {
      const body = await client.form(endpoint, values, { source: `school selection endpoint probe ${label} ${endpointLabel}`, referer: index.url })
      const payload = parseJson(body)
      const rows = rowsOf(payload)
      await save(`${label}-${endpointLabel}.html`, body)
      emit({ type: 'detail', label, endpoint: endpointLabel, request: requestSummary(values), bytes: String(body || '').length, payloadKind: Array.isArray(payload) ? 'array' : typeof payload, rowCount: rows.length, rows: rows.slice(0, 5).map((row) => ({ jxb_id: row?.jxb_id, do_jxb_id: row?.do_jxb_id ? '[present]' : row?.do_jxb_id || null, kch_id: row?.kch_id })), fields: parseFields(body), body: safeBody(body) })
    }
  }
  const script = await client.page(urls.scheduleScript, { source: 'school schedule endpoint probe script' })
  await save('school-schedule-script.js', script.text)
  emit({ type: 'script', url: script.url, bytes: script.text.length, body: safeBody(script.text) })
}

app.on('ready', () => {
  void run()
    .catch((error) => { emit({ type: 'error', name: error?.name || 'Error', code: error?.code || null, message: error?.message || String(error) }); process.exitCode = 1 })
    .finally(() => app.exit(process.exitCode || 0))
})
