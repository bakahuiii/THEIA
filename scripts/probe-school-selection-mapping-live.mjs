import { app, safeStorage, session } from 'electron'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import * as cheerio from 'cheerio'
import { AcademicApiClient } from '../core/academic-api-client.mjs'
import { AcademicApiVault } from '../electron/academic-api-vault.mjs'
import { SessionClient } from '../core/source-client.mjs'

const BASE = 'https://jwglxt.buct.edu.cn/jwglxt/'
const userData = resolve(process.env.APPDATA || '.', 'THEIA')
const outDir = resolve(process.env.THEIA_MAPPING_PROBE_DIR || resolve(process.cwd(), '.tmp-school-mapping-probe'))
const code = String(process.env.THEIA_HIDDEN_COURSE_CODE || 'PSE30200T').trim()
const classId = String(process.env.THEIA_HIDDEN_CLASS_ID || '54F89D71FC0F85EEE063B99AC3798EE2').trim()
const rowId = String(process.env.THEIA_HIDDEN_ROW_ID || '671').trim()

app.setPath('userData', userData)
app.setPath('sessionData', resolve(userData, 'session'))

const urls = {
  scheduleIndex: new URL('design/viewFunc_cxDesignFuncPageIndex.html?gnmkdm=N219933', BASE).toString(),
  scheduleData: new URL('design/funcData_cxFuncDataList.html?func_widget_guid=5920CCA8B9E61FBAE0530100007F0493', BASE).toString(),
  selectionIndex: new URL('xsxk/zzxkyzb_cxZzxkYzbIndex.html?gnmkdm=N253512&layout=default', BASE).toString(),
  selectionDisplay: new URL('xsxk/zzxkyzb_cxZzxkYzbDisplay.html?gnmkdm=N253512', BASE).toString(),
  selectionCatalog: new URL('xsxk/zzxkyzb_cxZzxkYzbPartDisplay.html?gnmkdm=N253512', BASE).toString(),
  selectionClasses: new URL('xsxk/zzxkyzbjk_cxJxbWithKchZzxkYzb.html?gnmkdm=N253512', BASE).toString(),
  courseDetail: new URL('xkgl/common_cxKcxxModel.html?gnmkdm=N253512', BASE).toString(),
  classDetail: new URL('xkgl/common_cxJxbrsmxIndex.html', BASE).toString(),
  classNote: new URL('xsxk/tjxkyzb_cxXkbzMsg.html', BASE).toString(),
  classMaterial: new URL('xsxk/tjxkyzb_cxJcxxList.html', BASE).toString(),
}

function emit(value) {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...value })}\n`)
}

async function save(name, text) {
  const path = resolve(outDir, name)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, String(text ?? ''), 'utf8')
  emit({ type: 'saved', name, bytes: String(text ?? '').length })
}

function parseFields(text) {
  const $ = cheerio.load(String(text || ''))
  const fields = {}
  $('input,select,textarea').each((_i, node) => {
    const el = $(node)
    const name = el.attr('name') || el.attr('id')
    if (name) fields[name] = String(el.attr('value') ?? el.val() ?? '')
  })
  return fields
}

function parseJson(text) {
  try { return JSON.parse(String(text || '')) } catch { return null }
}

function rowsOf(payload) {
  if (Array.isArray(payload)) return payload
  for (const key of ['tmpList', 'items', 'rows', 'data', 'result']) {
    if (Array.isArray(payload?.[key])) return payload[key]
  }
  return []
}

function redact(value) {
  const text = String(value ?? '')
  return text.length > 16 ? `${text.slice(0, 6)}...[${text.length}]` : text
}

async function run() {
  const vault = new AcademicApiVault(userData, safeStorage)
  const credentials = await vault.readCredentials()
  if (!credentials) throw new Error('No saved academic API credentials')
  const api = new AcademicApiClient(credentials)
  await api.login()
  const browserSession = session.fromPartition('persist:theia')
  const browserUrl = `${BASE}`
  for (const cookie of await browserSession.cookies.get({ url: browserUrl })) {
    if (api.cookies.has(cookie.name)) await browserSession.cookies.remove(browserUrl, cookie.name).catch(() => undefined)
  }
  for (const [name, value] of api.cookies.entries()) {
    await browserSession.cookies.set({ url: browserUrl, name, value, path: '/', secure: true, httpOnly: true })
  }
  const client = new SessionClient(browserSession, { timeoutMs: 30_000 })
  const schedulePage = await client.page(urls.scheduleIndex, { source: 'mapping probe schedule index' })
  await save('school-schedule-index.html', schedulePage.text)
  const schedulePayload = parseJson(await client.form(urls.scheduleData, {
    xnm: '2026', xqm: '3', _search: 'false', nd: String(Date.now()),
    'queryModel.showCount': '500', 'queryModel.currentPage': '1',
    'queryModel.sortName': '', 'queryModel.sortOrder': 'asc', time: '0',
  }, { source: 'mapping probe schedule data', referer: schedulePage.url }))
  const scheduleRows = rowsOf(schedulePayload)
  const targetRows = scheduleRows.filter((row) => String(row?.row_id ?? '') === rowId || String(row?.jxb_id ?? '') === classId || String(row?.kch ?? '') === code)
  emit({ type: 'schedule-target', count: targetRows.length, rows: targetRows.slice(0, 20) })

  const selectionPage = await client.page(urls.selectionIndex, { source: 'mapping probe selection index' })
  await save('selection-index.html', selectionPage.text)
  const $ = cheerio.load(selectionPage.text)
  const blocks = []
  $('a[role="tab"],a[onclick*="xkkz_id"]').each((_i, node) => {
    const args = [...String($(node).attr('onclick') || '').matchAll(/["']([^"']+)["']/g)].map((m) => m[1])
    if (args[1]) blocks.push({ categoryCode: args[0], id: args[1], gradeId: args[2] || '', majorId: args[3] || '', controlSequence: args[4] || '' })
  })
  emit({ type: 'blocks', blocks: blocks.map((block) => ({ ...block, controlSequence: redact(block.controlSequence) })) })

  for (const block of blocks) {
    const displayText = await client.form(urls.selectionDisplay, {
      xkkz_id: block.id, kklxdm: block.categoryCode, xszxzt: '1',
      njdm_id: block.gradeId, zyh_id: block.majorId, kspage: '0', jspage: '0',
    }, { source: 'mapping probe selection display', referer: selectionPage.url })
    const display = parseFields(displayText)
    await save(`display-${block.categoryCode}.html`, displayText)
    emit({ type: 'display', block: block.categoryCode, fields: display, bytes: displayText.length })

    const base = {
      ...display,
      xkkz_id: block.id,
      kklxdm: block.categoryCode,
      xkkz_xh: block.controlSequence,
      xkxnm: display.xkxnm || '2026',
      xkxqm: display.xkxqm || '3',
    }
    const catalogVariants = [
      ['reference', { ...base, 'filter_list[0]': code, kspage: '1', jspage: '10' }],
      ['reference-no-token', { ...display, xkkz_id: block.id, kklxdm: block.categoryCode, 'filter_list[0]': code, kspage: '1', jspage: '10' }],
      ['no-filter', { ...base, kspage: '1', jspage: '100' }],
      ['row-id', { ...base, 'filter_list[0]': rowId, kspage: '1', jspage: '100' }],
      ['class-id', { ...base, 'filter_list[0]': classId, kspage: '1', jspage: '100' }],
    ]
    for (const [label, values] of catalogVariants) {
      const body = await client.form(urls.selectionCatalog, values, { source: `mapping probe catalog ${label}`, referer: selectionPage.url })
      const payload = parseJson(body)
      const rows = rowsOf(payload)
      emit({ type: 'catalog', block: block.categoryCode, label, request: Object.fromEntries(Object.entries(values).filter(([key]) => ['xkkz_id', 'kklxdm', 'xkkz_xh', 'xkxnm', 'xkxqm', 'kspage', 'jspage', 'filter_list[0]'].includes(key)).map(([key, value]) => [key, key === 'xkkz_xh' ? redact(value) : value])), bytes: body.length, kind: Array.isArray(payload) ? 'array' : typeof payload, flag: payload?.flag ?? null, count: rows.length, rows: rows.slice(0, 5).map((row) => ({ kch: row?.kch, kch_id: row?.kch_id, kcmc: row?.kcmc, jxb_id: row?.jxb_id })) })
    }

    const detailVariants = [
      ['course-detail-post-code', urls.courseDetail, { kch_id: code }],
      ['course-detail-get-code', `${urls.courseDetail}&kch_id=${encodeURIComponent(code)}`, null],
      ['class-detail-post-visible', urls.classDetail, { kch_id: code, jxb_id: classId, xnm: '2026', xqm: '3' }],
      ['class-note', urls.classNote, { jxb_id: classId }],
      ['class-material', urls.classMaterial, { jxb_id: classId }],
    ]
    for (const [label, url, values] of detailVariants) {
      const body = values === null
        ? await client.page(url, { source: `mapping probe ${label}` }).then((page) => page.text)
        : await client.form(url, values, { source: `mapping probe ${label}`, referer: selectionPage.url })
      await save(`detail-${block.categoryCode}-${label}.html`, body)
      emit({ type: 'detail', block: block.categoryCode, label, url: url.replace(/\?.*$/, ''), request: values, bytes: body.length, fields: parseFields(body), bodyHead: body.slice(0, 300).replace(/\s+/g, ' ') })
    }
  }
}

app.on('ready', () => {
  void run()
    .catch((error) => { emit({ type: 'error', name: error?.name || 'Error', code: error?.code || null, message: error?.message || String(error) }); process.exitCode = 1 })
    .finally(() => app.exit(process.exitCode || 0))
})
