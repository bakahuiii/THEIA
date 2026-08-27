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
const COURSE_URL = new URL('xsxk/zzxkyzb_cxZzxkYzbPartDisplay.html?gnmkdm=N253512', BASE).toString()
const CLASS_URL = new URL('xsxk/zzxkyzbjk_cxJxbWithKchZzxkYzb.html?gnmkdm=N253512', BASE).toString()
const COURSE_DETAIL_URL = new URL('xkgl/common_cxKcxxModel.html?gnmkdm=N253512', BASE).toString()
const CLASS_DETAIL_URL = new URL('xkgl/common_cxJxbrsmxIndex.html', BASE).toString()
const COURSE_CODE = String(process.env.THEIA_HIDDEN_COURSE_CODE || 'PSE30200T').trim()
const TARGET_CLASS = String(process.env.THEIA_HIDDEN_CLASS_ID || '54F89D71FC0F85EEE063B99AC3798EE2').trim()
const TARGET_GRADE = String(process.env.THEIA_HIDDEN_GRADE || '2025').trim()
const TARGET_CLASS_CODE = String(process.env.THEIA_HIDDEN_CLASS_CODE || '02022509').trim()
const output = resolve(process.env.THEIA_COURSE_SELECTION_VARIANTS_OUTPUT || resolve(process.env.APPDATA || '.', 'THEIA', 'course-selection', 'variants-probe.ndjson'))
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
    if (!name) return
    const type = String(field.attr('type') || '').toLowerCase()
    if (['checkbox', 'radio'].includes(type) && !field.is(':checked')) return
    values[name] = String(field.attr('value') ?? field.val() ?? '')
  })
  return values
}

function parsePayload(body) {
  try { return JSON.parse(String(body || '')) } catch { return null }
}

function rowsOf(payload) {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  for (const key of ['tmpList', 'items', 'rows', 'data', 'result']) {
    if (Array.isArray(payload[key])) return payload[key]
  }
  return []
}

function safeValue(key, value) {
  if (['xkkz_xh', 'jxb_ids', 'jcxx_id'].includes(key)) return value ? '[present]' : value
  return value
}

function requestSummary(values) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, safeValue(key, value)]))
}

function matchingRows(rows) {
  return rows
    .filter((row) => String(row?.jxb_id || '') === TARGET_CLASS || String(row?.jxbmc || '').includes('科技写作与报告'))
    .slice(0, 20)
    .map((row) => ({
      kch: row?.kch || null,
      kch_id: row?.kch_id || null,
      jxb_id: row?.jxb_id || null,
      jxbmc: row?.jxbmc || null,
      do_jxb_id: row?.do_jxb_id ? '[present]' : row?.do_jxb_id || null,
    }))
}

async function run() {
  const vault = new AcademicApiVault(userData, safeStorage)
  const credentials = await vault.readCredentials()
  if (!credentials) throw new Error('No saved academic API credentials')
  const api = new AcademicApiClient(credentials)
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
  const index = await client.page(INDEX_URL, { source: 'course selection variants probe' })
  const $index = cheerio.load(index.text)
  const blocks = []
  $index('a[role="tab"],a[onclick*="xkkz_id"]').each((_index, node) => {
    const args = [...String($index(node).attr('onclick') || '').matchAll(/["']([^"']+)["']/g)].map((match) => match[1])
    if (args[1]) blocks.push({ categoryCode: args[0], id: args[1], gradeId: args[2] || '', majorId: args[3] || '', controlSequence: args[4] || '' })
  })
  await report({ type: 'portal', blocks, courseCode: COURSE_CODE, targetClass: TARGET_CLASS })

  for (const block of blocks) {
    const displayBody = await client.form(DISPLAY_URL, {
      xkkz_id: block.id, kklxdm: block.categoryCode, xszxzt: '0',
      njdm_id: block.gradeId, zyh_id: block.majorId, kspage: '0', jspage: '0',
    }, { source: 'course selection variants display', referer: index.url })
    const display = readFields(displayBody)
    const base = { ...display, xkkz_id: block.id, kklxdm: block.categoryCode, xkkz_xh: block.controlSequence, kch_id: COURSE_CODE }
    for (const [label, endpoint, values] of [
      ['course-detail', COURSE_DETAIL_URL, { kch_id: COURSE_CODE }],
      ['class-detail', CLASS_DETAIL_URL, { kch_id: COURSE_CODE, jxb_id: TARGET_CLASS, xnm: display.xkxnm || '2026', xqm: display.xkxqm || '3' }],
    ]) {
      const body = await client.form(endpoint, values, { source: `course selection variants ${label}`, referer: index.url })
      await report({ type: 'detail', block, label, request: values, bytes: String(body || '').length, fields: readFields(body), bodyPreview: String(body || '').slice(0, 1800) })
    }
    const catalogProbeValues = {
      ...display,
      xkkz_id: block.id,
      kklxdm: block.categoryCode,
      xkkz_xh: block.controlSequence,
      kspage: '1',
      jspage: '100',
    }
    const catalogProbeBody = await client.form(COURSE_URL, catalogProbeValues, { source: 'course selection variants known catalog', referer: index.url })
    const catalogProbe = parsePayload(catalogProbeBody)
    const knownCourse = rowsOf(catalogProbe)[0]
    await report({
      type: 'known-course', block, request: requestSummary(catalogProbeValues),
      rowCount: rowsOf(catalogProbe).length,
      sample: knownCourse ? { kch: knownCourse.kch || null, kch_id: knownCourse.kch_id || null, kcmc: knownCourse.kcmc || null } : null,
    })
    if (knownCourse?.kch_id) {
      const knownClassValues = { ...display, xkkz_id: block.id, kklxdm: block.categoryCode, xkkz_xh: block.controlSequence, kch_id: knownCourse.kch_id, 'filter_list[0]': knownCourse.kch || knownCourse.kch_id }
      const knownClassBody = await client.form(CLASS_URL, knownClassValues, { source: 'course selection variants known class', referer: index.url })
      const knownClassPayload = parsePayload(knownClassBody)
      const knownRows = rowsOf(knownClassPayload)
      await report({ type: 'known-class', block, request: requestSummary(knownClassValues), rowCount: knownRows.length, sample: knownRows.slice(0, 3).map((row) => ({ kch: row?.kch || null, kch_id: row?.kch_id || null, jxb_id: row?.jxb_id || null, do_jxb_id: row?.do_jxb_id ? '[present]' : row?.do_jxb_id || null })) })
    }
    const variants = [
      ['class-official-no-xkkz-field', { ...display, xkkz_id: block.id, kklxdm: block.categoryCode, 'filter_list[0]': COURSE_CODE }],
      ['class-official-empty-xkkz-field', { ...display, xkkz_id: block.id, kklxdm: block.categoryCode, xkkz_xh: '', 'filter_list[0]': COURSE_CODE }],
      ['class-display', { ...base, 'filter_list[0]': COURSE_CODE }],
      ['class-page-fields', { ...base, 'filter_list[0]': COURSE_CODE, xkxnm: display.xkxnm || '2026', xkxqm: display.xkxqm || '3' }],
      ['class-no-student-scope', { ...base, 'filter_list[0]': COURSE_CODE, njdm_id: '', zyh_id: '', bh_id: '', jg_id: '', jg_id_1: '', njdm_id_1: '', zyh_id_1: '' }],
      ['class-wildcard-student-scope', { ...base, 'filter_list[0]': COURSE_CODE, njdm_id: 'w', zyh_id: 'w', bh_id: 'w', jg_id: 'w', jg_id_1: 'w', njdm_id_1: 'w', zyh_id_1: 'w' }],
      ['class-no-filter', { ...base }],
      ['class-target-id', { ...base, 'filter_list[0]': COURSE_CODE, jxb_id: TARGET_CLASS }],
      ['class-target-as-course', { ...base, 'filter_list[0]': COURSE_CODE, kch_id: TARGET_CLASS }],
      ['class-target-grade', { ...base, 'filter_list[0]': COURSE_CODE, njdm_id: TARGET_GRADE, njdm_id_1: TARGET_GRADE, bh_id: TARGET_CLASS_CODE }],
      ['class-target-grade-no-class', { ...base, 'filter_list[0]': COURSE_CODE, njdm_id: TARGET_GRADE, njdm_id_1: TARGET_GRADE, bh_id: '' }],
      ['class-target-grade-major-scope', { ...base, 'filter_list[0]': COURSE_CODE, njdm_id: TARGET_GRADE, njdm_id_1: TARGET_GRADE, bh_id: TARGET_CLASS_CODE, zyh_id: '0202', zyh_id_1: '0202' }],
      ['catalog-no-student-scope', { ...base, filterKey: 'all', 'filter_list[0]': COURSE_CODE, njdm_id: '', zyh_id: '', bh_id: '', jg_id: '', jg_id_1: '', njdm_id_1: '', zyh_id_1: '', kspage: '1', jspage: '100' }],
      ['catalog-wildcard-student-scope', { ...base, filterKey: 'all', 'filter_list[0]': COURSE_CODE, njdm_id: 'w', zyh_id: 'w', bh_id: 'w', jg_id: 'w', jg_id_1: 'w', njdm_id_1: 'w', zyh_id_1: 'w', kspage: '1', jspage: '100' }],
      ['catalog-official-no-xkkz-field', { ...display, xkkz_id: block.id, kklxdm: block.categoryCode, filterKey: 'all', 'filter_list[0]': COURSE_CODE, kspage: '1', jspage: '100' }],
      ['catalog-official-empty-xkkz-field', { ...display, xkkz_id: block.id, kklxdm: block.categoryCode, xkkz_xh: '', filterKey: 'all', 'filter_list[0]': COURSE_CODE, kspage: '1', jspage: '100' }],
    ]
    for (const [label, values] of variants) {
      const endpoint = label.startsWith('catalog') ? COURSE_URL : CLASS_URL
      const body = await client.form(endpoint, values, { source: `course selection variants ${label}`, referer: index.url })
      const payload = parsePayload(body)
      const rows = rowsOf(payload)
      await report({
        type: 'variant', block, label, endpoint: endpoint === CLASS_URL ? 'classes' : 'catalog',
        request: requestSummary(values), payloadKind: Array.isArray(payload) ? 'array' : typeof payload,
        signal: payload?.flag ?? payload?.success ?? payload?.status ?? null,
        message: payload?.msg ?? payload?.message ?? null,
        rowCount: rows.length, matches: matchingRows(rows), bodyPreview: String(body || '').slice(0, 800),
      })
    }
  }
}

app.on('ready', () => {
  void run().catch(async (error) => {
    await report({ type: 'error', name: error?.name || 'Error', message: error?.message || String(error), code: error?.code || null })
    process.exitCode = 1
  }).finally(() => app.exit(process.exitCode || 0))
})
