import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { collectionCsv, counts, toTheiaFeed, toIcs } from './schema.mjs'
import {
  cachedFitnessResult,
  fitnessCacheSummary,
  cachedSchoolScheduleResult,
  schoolScheduleCacheSummary,
  cachedMotionVenueCatalog,
  cachedMotionVenueStatus,
  cachedMotionVenueStatuses,
  motionVenueCacheSummary,
} from './data-catalog.mjs'
import { buildAcademicAnalysis } from './academic-model.mjs'
import { JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES } from './jwglxt-extra.mjs'
import { projectUserDataDomainSummary, projectUserDataOverview, projectUserDataRecords } from './user-data-view.mjs'
import { PUBLIC_DATA_DOMAINS, projectTheiaDataDomain, toTheiaDataOutput } from './data-output-contract.mjs'

const COLLECTIONS = new Set(['terms', 'courses', 'schedule', 'exams', 'grades', 'selectedCourses', 'assignments', 'workspaces', 'notices', 'emails', 'academicExtras'])
const COLLECTION_ALIASES = new Map([['selected-courses', 'selectedCourses'], ['academic-extras', 'academicExtras']])
const ACADEMIC_EXTRA_DOMAIN_SET = new Set(JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES)

function allowedOrigin(origin) {
  if (!origin) return null
  // The packaged renderer never reads this API over HTTP (it uses IPC and a
  // dedicated asset protocol), so the literal null origin of file:// pages is
  // deliberately NOT allowed: any local file:// page would otherwise read all
  // student data through CORS. Only known local web origins and theia: pass.
  try {
    const url = new URL(origin)
    if (url.protocol === 'theia:') return origin
    if ((url.hostname === '127.0.0.1' || url.hostname === 'localhost') && ['http:', 'https:'].includes(url.protocol)) return origin
  } catch { /* no CORS for invalid origins */ }
  return null
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u

// Accept the token via the Authorization: Bearer header (preferred) or the
// ?token= query parameter (convenient for curl and simple LAN clients).
function requestToken(request, url) {
  const header = String(request.headers.authorization || '')
  const bearer = header.match(/^Bearer\s+([A-Za-z0-9_-]+)$/u)
  if (bearer?.[1]) return bearer[1]
  const query = url?.searchParams?.get('token')
  return typeof query === 'string' && query ? query : null
}

function tokensEqual(expected, provided) {
  if (!TOKEN_PATTERN.test(String(expected || '')) || typeof provided !== 'string' || !provided) return false
  const left = Buffer.from(String(expected))
  const right = Buffer.from(provided)
  return left.length === right.length && timingSafeEqual(left, right)
}

function send(response, status, body, contentType = 'application/json; charset=utf-8', origin = null, method = 'GET') {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)
  const headers = {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin
    headers.Vary = 'Origin'
  }
  response.writeHead(status, headers)
  response.end(method === 'HEAD' ? undefined : payload)
}

async function readJsonBody(request, maximumBytes = 16_000) {
  const chunks = []
  let total = 0
  for await (const chunk of request) {
    total += Buffer.byteLength(chunk)
    if (total > maximumBytes) throw Object.assign(new Error('request_too_large'), { code: 'request_too_large' })
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    throw Object.assign(new Error('invalid_json'), { code: 'invalid_json' })
  }
}

function filtered(items, url) {
  const since = url.searchParams.get('since')
  if (!since) return items
  const threshold = new Date(since).getTime()
  if (!Number.isFinite(threshold)) return items
  return items.filter((item) => new Date(item.capturedAt || item.updatedAt || item.publishedAt || item.startAt || 0).getTime() >= threshold)
}

function collectionResponse(state, collection, url) {
  const items = filtered(state[collection] || [], url)
  return {
    schema: state.schema,
    collection,
    updatedAt: state.updatedAt,
    total: state[collection]?.length || 0,
    items,
  }
}

function academicExtraColumns(records) {
  const columns = []
  const seen = new Set()
  for (const record of records) {
    const fields = Array.isArray(record?.fields) && record.fields.length
      ? record.fields
      : Object.entries(record || {}).map(([name, value]) => ({ name, label: name, value }))
    for (const field of fields) {
      const key = String(field?.name || '').trim()
      if (!key || seen.has(key) || ['id', 'source', 'sourceUrl', 'routeCode', 'capturedAt'].includes(key)) continue
      seen.add(key)
      columns.push({ key, label: String(field?.label || key).slice(0, 160) })
      if (columns.length >= 32) return columns
    }
  }
  return columns
}

function academicExtraTableResponse(state, domain, url) {
  if (!ACADEMIC_EXTRA_DOMAIN_SET.has(domain)) return null
  const source = state.academicExtras?.domains?.[domain] || null
  const allItems = Array.isArray(source?.records) ? source.records : []
  const query = String(url.searchParams.get('q') || '').trim().toLocaleLowerCase()
  const matched = query
    ? allItems.filter((record) => JSON.stringify(record).toLocaleLowerCase().includes(query))
    : allItems
  const items = filtered(matched, url)
  const requestedLimit = Number(url.searchParams.get('limit'))
  const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(1_000, requestedLimit)) : 1_000
  return {
    schema: 'theia-jwglxt-extra-table/v1',
    domain,
    label: source?.label || domain,
    updatedAt: state.updatedAt,
    capturedAt: source?.capturedAt || null,
    sourceUrl: source?.sourceUrl || null,
    completeness: source?.completeness || 'unknown',
    queryStats: source?.queryStats || { attempted: 0, succeeded: 0, failed: 0, capped: false },
    columns: academicExtraColumns(items),
    total: items.length,
    items: items.slice(0, limit),
  }
}

function unchangedSince(value, url) {
  const since = url.searchParams.get('since')
  if (!since) return false
  const threshold = new Date(since).getTime()
  const updatedAt = new Date(value || 0).getTime()
  return Number.isFinite(threshold) && Number.isFinite(updatedAt) && updatedAt < threshold
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderTimestamp(now = new Date()) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    timeZone: 'Asia/Shanghai',
  }).formatToParts(now)
  const get = (type) => parts.find((part) => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`
}

const MOTION_STATE_LABELS = Object.freeze({
  available: '可预约',
  occupied: '已占用',
  closed: '闭馆',
  expired: '已过期',
  selected: '已选定',
  unknown: '未知',
})

function motionStateLabel(value) {
  return MOTION_STATE_LABELS[value] || String(value || '未知')
}

function motionStateClass(value) {
  if (value === 'available') return 'available'
  if (value === 'occupied') return 'occupied'
  if (value === 'closed' || value === 'expired') return 'closed'
  return 'unknown'
}

function renderMotionVenueTableHtml(statuses, { title = '', date = '' } = {}) {
  const heading = title || '场馆状态表'
  const subtitle = []
  if (date) subtitle.push(`日期：${escapeHtml(date)}`)
  const venues = statuses.map((status) => {
    const query = status?.query || {}
    const tables = Array.isArray(status?.availability?.tables) ? status.availability.tables : []
    return { status, query, tables }
  }).filter((item) => item.tables.length)
  const sections = venues.map(({ status, query, tables }) => {
    const caption = [query?.campus?.label, query?.venue, query?.activity].filter(Boolean).join(' · ') || '场馆'
    const blocks = tables.map((table) => {
      const headers = Array.isArray(table.headers) ? table.headers : []
      const timeHeader = headers[0] || '时间\\场地'
      // 过滤敏感列：同步过滤表头和数据列，避免只删表头不删数据
      const allowedIndices = []
      const courtHeaders = []
      for (let i = 1; i < headers.length; i += 1) {
        if (!SENSITIVE_COURT_HEADER.test(String(headers[i]))) {
          allowedIndices.push(i)
          courtHeaders.push(headers[i])
        }
      }
      const rows = (Array.isArray(table.slots) ? table.slots : []).map((slot) => {
        const time = escapeHtml(String(slot?.time || ''))
        const allCourts = Array.isArray(slot?.courts) ? slot.courts : []
        const courts = allowedIndices.map((index, displayIndex) => {
          const cell = allCourts[index]
          const label = courtHeaders[displayIndex] || `场地${displayIndex + 1}`
          const stateClass = motionStateClass(cell?.state)
          const statusText = escapeHtml(String(cell?.status ?? motionStateLabel(cell?.state)))
          return `<td><span class="cell ${stateClass}"><b>${escapeHtml(String(label))}</b><small>${statusText}</small></span></td>`
        }).join('')
        return `<tr><th>${time}</th>${courts}</tr>`
      }).join('')
      const headerCells = courtHeaders.map((header) => `<th>${escapeHtml(String(header))}</th>`).join('')
      return `<table class="motion"><thead><tr><th>${escapeHtml(timeHeader)}</th>${headerCells}</tr></thead><tbody>${rows}</tbody></table>`
    }).join('')
    return `<div class="motion-section"><div class="motion-caption">${escapeHtml(caption)}</div>${blocks}</div>`
  }).join('')
  if (statuses.length > 1) subtitle.push(`共 ${statuses.length} 个场馆`)
  const dataCapturedAt = statuses.reduce((latest, item) => {
    const ts = item?.capturedAt || item?.cachedAt || null
    return ts && (!latest || ts > latest) ? ts : latest
  }, null)
  return `
    <div class="title">${escapeHtml(heading)}</div>
    <div class="subtitle">${subtitle.join(' · ') || escapeHtml('实时场馆状态')}</div>
    ${sections}
    <div class="count">数据时间：${escapeHtml(formatCapturedAt(dataCapturedAt) || renderTimestamp())}</div>
  `
}

const SENSITIVE_COURT_HEADER = /(?:姓名|学号|手机|电话|身份证|联系人|预约人|申请人|用户名|账号|密码|email)/iu

function renderFreeClassroomImageHtml(records, { title = '空闲教室', building = '', periods = '', capturedAt = null } = {}) {
  // Each cached record is one free classroom. Extract the building name and
  // classroom name; group by building so the reply distinguishes 一教/二教.
  const rows = records.map((record) => ({
    classroom: String(cellValue(record, ['classroom', 'cdmc', 'cdbh', 'room']) || ''),
    building: String(cellValue(record, ['jxlmc', 'building', 'lh', '教学楼']) || ''),
    seats: String(cellValue(record, ['capacity', 'zws', 'qszws']) || ''),
  })).filter((row) => row.classroom)
  if (building) {
    // Allow filtering by a short label such as "1", "2", "一教", "二教".
    const needle = String(building).toLocaleLowerCase().replace(/\s+/g, '')
    if (needle) {
      const filtered = rows.filter((row) => {
        const b = String(row.building).toLocaleLowerCase().replace(/\s+/g, '')
        return b.includes(needle) || needle.includes(b) || /一教|第一教学/u.test(needle) && /一教|第一教学/u.test(b) || /二教|第二教学/u.test(needle) && /二教|第二教学/u.test(b)
      })
      if (filtered.length) return renderRoomGrouping(filtered, { title, building, periods, capturedAt })
    }
  }
  if (!rows.length) return null
  return renderRoomGrouping(rows, { title, building, periods, capturedAt })
}

function formatCapturedAt(value) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return renderTimestamp(d)
}

function renderRoomGrouping(rows, { title = '空闲教室', building = '', periods = '', capturedAt = null }) {
  const byBuilding = new Map()
  for (const row of rows) {
    const key = row.building || '未标注教学楼'
    if (!byBuilding.has(key)) byBuilding.set(key, [])
    byBuilding.get(key).push(row)
  }
  // 阶梯教室（教室名含“阶”，如 A阶101）排在所有普通教室（A101）前面；
  // 每组内部按教室名升序排列（A101 A102 … A201）。
  const roomRank = (name) => {
    const text = String(name || '')
    // 允许“阶”等中文字符夹在字母和数字之间：A阶101 -> prefix=A, number=101
    const match = text.match(/^([A-Za-z\u3400-\u9fff]*?)(\d+)/u)
    const prefix = match?.[1] || ''
    const number = match?.[2] ? Number(match[2]) : Number.MAX_SAFE_INTEGER
    const isStaircase = /阶/u.test(text)
    return {
      staircase: isStaircase ? 0 : 1,
      prefix,
      number,
      text,
    }
  }
  const compareRooms = (left, right) => {
    const a = roomRank(left.classroom)
    const b = roomRank(right.classroom)
    if (a.staircase !== b.staircase) return a.staircase - b.staircase
    const prefixCompare = a.prefix.localeCompare(b.prefix, 'en', { sensitivity: 'base' })
    if (prefixCompare !== 0) return prefixCompare
    if (a.number !== b.number) return a.number - b.number
    return a.text.localeCompare(b.text, 'zh-CN')
  }
  const periodLabel = periods
    ? ` · 节次：${periods.split(',').map((item) => escapeHtml(item.trim())).filter(Boolean).join('、')}`
    : ''
  const sections = [...byBuilding.entries()].map(([buildingName, rooms]) => {
    const sorted = [...rooms].sort(compareRooms)
    const cells = sorted.map((room) => `<div class="room-card"><b>${escapeHtml(room.classroom)}</b>${room.seats ? `<small>${escapeHtml(room.seats)}座</small>` : ''}</div>`).join('')
    return `<div class="room-section"><div class="room-caption">${escapeHtml(buildingName)} · ${rooms.length} 间</div><div class="room-grid">${cells}</div></div>`
  }).join('')
  return `
    <div class="title">${escapeHtml(title)}</div>
    <div class="subtitle">共 ${rows.length} 间空闲教室${periodLabel}</div>
    ${sections}
    <div class="count">数据时间：${escapeHtml(formatCapturedAt(capturedAt) || renderTimestamp())}</div>
  `
}

function cellValue(record, names) {
  for (const name of names) {
    const direct = record?.[name]
    if (direct !== undefined && direct !== null && String(direct).trim() !== '') return String(direct)
    const entry = Array.isArray(record?.fields)
      ? record.fields.find((item) => String(item?.name || '') === name || String(item?.label || '') === name)
      : null
    if (entry?.value !== undefined && entry.value !== null && String(entry.value).trim() !== '') return String(entry.value)
  }
  return null
}

function renderFreeClassroomTableHtml(state, { domain = 'free-classroom', title = '', limit = 50 } = {}) {
  const source = state.academicExtras?.domains?.[domain] || null
  const records = Array.isArray(source?.records) ? source.records : []
  if (!records.length) return null
  const selected = records.slice(0, limit)
  const heading = title || source?.label || '空闲教室'
  const rows = selected.map((record) => [
    cellValue(record, ['classroom', 'cdmc', 'cdbh', 'room']),
    cellValue(record, ['jxlmc', 'building', 'lh', '教学楼']),
    cellValue(record, ['campus', 'xqmc', 'xiaoqu']),
    cellValue(record, ['classroomType', 'cdlbmc', 'cdlb_id']),
    cellValue(record, ['capacity', 'zws', 'qszws']),
  ])
  const body = rows.map((cells) => `<tr>${cells.map((cell) => `<td>${escapeHtml(cell ?? '—')}</td>`).join('')}</tr>`).join('')
  return `
    <div class="title">${escapeHtml(heading)}</div>
    <div class="subtitle">查询时间：${escapeHtml(source?.capturedAt || '未知')} · 共 ${records.length} 条空闲教室</div>
    <table>
      <thead><tr><th>教室</th><th>教学楼</th><th>校区</th><th>类别</th><th>座位</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
    ${records.length > selected.length ? `<div class="count">仅显示前 ${selected.length} 条，共 ${records.length} 条</div>` : ''}
    <div class="count">数据时间：${escapeHtml(formatCapturedAt(source?.capturedAt) || renderTimestamp())}</div>
  `
}

export async function startLocalApi({ store, root, preferredPort = 8765, academicCalendarAssetsService = null, getAdvisorRuntime = () => null, publishRuntime = true, renderTableImage = null, fetchMotionVenueStatuses = null, queryFreeClassrooms = null }) {
  const token = randomBytes(32).toString('base64url')
  const server = createServer(async (request, response) => {
    try {
      const method = request.method || 'GET'
    const expectedHost = `127.0.0.1:${port}`
    if (String(request.headers.host || '').toLowerCase() !== expectedHost) {
      return send(response, 421, { error: 'host_not_allowed' }, undefined, null, method)
    }
    let url
    try {
      url = new URL(request.url || '/', 'http://127.0.0.1')
    } catch {
      return send(response, 400, { error: 'invalid_url' }, undefined, null, method)
    }
    const origin = allowedOrigin(request.headers.origin)
    if (request.method === 'OPTIONS') {
      if (!origin) return send(response, 403, { error: 'origin_not_allowed' }, undefined, null, method)
      response.writeHead(204, {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Accept,Content-Type,Authorization',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      })
      return response.end()
    }
    if (!['GET', 'HEAD', 'POST'].includes(method)) return send(response, 405, { error: 'read_only_api' }, undefined, origin, method)
    // CSRF: a real browser request with a foreign Origin must be rejected even
    // before touching data, so a malicious web page can never drive POSTs.
    if (request.headers.origin && !origin) return send(response, 403, { error: 'origin_not_allowed' }, undefined, null, method)
    // Every read requires the per-instance token (Authorization: Bearer or ?token=).
    if (!tokensEqual(token, requestToken(request, url))) return send(response, 401, { error: 'unauthorized' }, undefined, origin, method)
    const state = store.snapshot()
    if (method === 'POST' && url.pathname === '/v1/agent/chat') {
      let body
      try {
        body = await readJsonBody(request)
      } catch (error) {
        return send(response, 400, { error: error?.code || 'invalid_json' }, undefined, origin, method)
      }
      const message = String(body.message || '').normalize('NFC').trim().slice(0, 4_000)
      const requestedThreadId = String(body.threadId || '').trim().slice(0, 128)
      if (!message) return send(response, 400, { error: 'question_required' }, undefined, origin, method)
      const runtime = getAdvisorRuntime?.()
      if (!runtime || typeof runtime.send !== 'function') return send(response, 503, { error: 'agent_unavailable' }, undefined, origin, method)
      try {
        let threadId = requestedThreadId
        if (!threadId && typeof runtime.listThreads === 'function') threadId = runtime.listThreads()[0]?.id || ''
        if (!threadId && typeof runtime.createThread === 'function') threadId = runtime.createThread()?.id || ''
        if (!threadId) return send(response, 503, { error: 'agent_thread_unavailable' }, undefined, origin, method)
        const answer = await runtime.send({ threadId, question: message })
        return send(response, 200, {
          schema: 'theia-agent-chat/v1',
          threadId: answer.threadId || threadId,
          answer: String(answer.displayText || answer.rawText || '').slice(0, 32_000),
          snapshotRevision: answer.snapshotRevision || null,
        }, undefined, origin, method)
      } catch (error) {
        const status = ['thread-not-found', 'question-required'].includes(error?.code) ? 400 : ['thread-busy', 'runtime-busy'].includes(error?.code) ? 409 : 503
        return send(response, status, { error: error?.code || 'agent_failed' }, undefined, origin, method)
      }
    }
    if (method === 'POST') return send(response, 405, { error: 'read_only_api' }, undefined, origin, method)
    if (url.pathname === '/v1/health') return send(response, 200, { ok: true, schema: state.schema, updatedAt: state.updatedAt, counts: counts(state) }, undefined, origin, method)
    if (url.pathname === '/v1/collections') return send(response, 200, {
      schema: state.schema,
      updatedAt: state.updatedAt,
      collections: [...COLLECTIONS].map((name) => ({ name, endpoint: `/v1/${name === 'selectedCourses' ? 'selected-courses' : name === 'academicExtras' ? 'academic-extras' : name}`, count: name === 'academicExtras' ? Object.values(state[name]?.domains || {}).reduce((total, domain) => total + (domain.records?.length || 0), 0) : state[name]?.length || 0 })),
    }, undefined, origin, method)
    if (url.pathname === '/v1/profile') return send(response, 200, { schema: state.schema, updatedAt: state.updatedAt, item: state.profile }, undefined, origin, method)
    if (url.pathname === '/v1/sync') return send(response, 200, { schema: state.schema, updatedAt: state.updatedAt, item: state.sync }, undefined, origin, method)
    if (url.pathname === '/v1/overview') {
      const versioned = store.snapshotWithRevision ? store.snapshotWithRevision() : { state, revision: null }
      return send(response, 200, projectUserDataOverview(versioned.state || state, { snapshotRevision: versioned.revision || null }), undefined, origin, method)
    }
    const domainSummaryMatch = url.pathname.match(/^\/v1\/domain-summary\/([^/]+)$/u)
    if (domainSummaryMatch) {
      let domain
      try { domain = decodeURIComponent(domainSummaryMatch[1]) } catch { return send(response, 400, { error: 'domain_invalid' }, undefined, origin, method) }
      const versioned = store.snapshotWithRevision ? store.snapshotWithRevision() : { state, revision: null }
      const summary = projectUserDataDomainSummary(versioned.state || state, domain)
      return summary
        ? send(response, 200, { ...summary, snapshotRevision: versioned.revision || null }, undefined, origin, method)
        : send(response, 404, { error: 'domain_not_found' }, undefined, origin, method)
    }
    const userRecordsMatch = url.pathname.match(/^\/v1\/records\/([^/]+)$/u)
    if (userRecordsMatch) {
      let domain
      try { domain = decodeURIComponent(userRecordsMatch[1]) } catch { return send(response, 400, { error: 'domain_invalid' }, undefined, origin, method) }
      const versioned = store.snapshotWithRevision ? store.snapshotWithRevision() : { state, revision: null }
      const records = projectUserDataRecords(versioned.state || state, domain, {
        query: url.searchParams.get('q') || '',
        termId: url.searchParams.get('termId') || null,
        status: url.searchParams.get('status') || null,
        scope: url.searchParams.get('scope') === 'all' ? 'all' : 'current',
        limit: url.searchParams.get('limit') || undefined,
        cursor: url.searchParams.get('cursor') || '0',
        recordType: url.searchParams.get('recordType') || null,
      })
      if (!records) return send(response, 404, { error: 'domain_not_found' }, undefined, origin, method)
      return send(response, 200, { ...records, snapshotRevision: versioned.revision || null }, undefined, origin, method)
    }
    if (url.pathname === '/v1/snapshot') return send(response, 200, state, undefined, origin, method)
    if (url.pathname === '/v1/data-manifest') return send(response, 200, store.storageSummary(), undefined, origin, method)
    if (url.pathname === '/v1/data-output') {
      const versioned = store.snapshotWithRevision ? store.snapshotWithRevision() : { state, revision: null }
      const requested = url.searchParams.getAll('domain')
      return send(response, 200, toTheiaDataOutput(versioned.state || state, {
        snapshotRevision: versioned.revision || null,
        domains: requested.length ? requested : null,
      }), undefined, origin, method)
    }
    const dataOutputMatch = url.pathname.match(/^\/v1\/data-output\/([^/]+)$/u)
    if (dataOutputMatch) {
      let domain
      try { domain = decodeURIComponent(dataOutputMatch[1]) } catch { return send(response, 400, { error: 'domain_invalid' }, undefined, origin, method) }
      if (!PUBLIC_DATA_DOMAINS.includes(domain)) return send(response, 404, { error: 'domain_not_found' }, undefined, origin, method)
      const versioned = store.snapshotWithRevision ? store.snapshotWithRevision() : { state, revision: null }
      return send(response, 200, projectTheiaDataDomain(versioned.state || state, domain, {
        snapshotRevision: versioned.revision || null,
      }), undefined, origin, method)
    }
    if (url.pathname === '/v1/data-catalog') return send(response, 200, state.dataCatalog, undefined, origin, method)
    if (url.pathname === '/v1/academic-plan-document') return send(response, 200, {
      schema: 'theia-academic-plan-document-response/v1',
      updatedAt: state.updatedAt,
      item: state.academicPlanDocument,
    }, undefined, origin, method)
    if (url.pathname === '/v1/academic-extras') return send(response, 200, { schema: state.schema, updatedAt: state.updatedAt, item: state.academicExtras }, undefined, origin, method)
    const academicExtraMatch = url.pathname.match(/^\/v1\/academic-extras\/([^/]+)$/u)
    if (academicExtraMatch) {
      let domain
      try { domain = decodeURIComponent(academicExtraMatch[1]) } catch { return send(response, 400, { error: 'academic_extra_domain_invalid' }, undefined, origin, method) }
      const table = academicExtraTableResponse(state, domain, url)
      return table
        ? send(response, 200, table, undefined, origin, method)
        : send(response, 404, { error: 'academic_extra_domain_not_found' }, undefined, origin, method)
    }
    if (url.pathname === '/v1/table-image' && typeof renderTableImage === 'function') {
      const title = String(url.searchParams.get('title') || '').slice(0, 200)
      const domain = String(url.searchParams.get('domain') || '').slice(0, 80)
      const rawLimit = url.searchParams.get('limit')
      const limit = rawLimit !== null && Number.isInteger(Number(rawLimit)) ? Math.max(1, Math.min(200, Number(rawLimit))) : 50
      const html = renderFreeClassroomTableHtml(state, { domain, title, limit })
      if (!html) return send(response, 404, { error: 'table_image_unavailable' }, undefined, origin, method)
      try {
        const png = await renderTableImage(html)
        return send(response, 200, png, 'image/png', origin, method)
      } catch (error) {
        return send(response, 500, { error: 'table_image_render_failed' }, undefined, origin, method)
      }
    }
    if (url.pathname === '/v1/motion-table-image' && typeof renderTableImage === 'function') {
      const activity = String(url.searchParams.get('activity') || '').slice(0, 120)
      const date = String(url.searchParams.get('date') || '').slice(0, 32)
      const title = String(url.searchParams.get('title') || '').slice(0, 200) || `${activity || '场馆'}状态表`
      // 场馆状态变化最快，每次用户查询都实时拉取，失败才用缓存。
      let statuses = []
      if (typeof fetchMotionVenueStatuses === 'function') {
        try {
          const live = await fetchMotionVenueStatuses({ activity, date })
          statuses = Array.isArray(live?.item) ? live.item : []
        } catch { /* fall through to cache */ }
      }
      if (!statuses.length) {
        statuses = cachedMotionVenueStatuses(state.dataCatalog, { activity, date })
      }
      if (!statuses.length) return send(response, 404, { error: 'table_image_unavailable' }, undefined, origin, method)
      const html = renderMotionVenueTableHtml(statuses, { title, date })
      try {
        const png = await renderTableImage(html)
        return send(response, 200, png, 'image/png', origin, method)
      } catch (error) {
        return send(response, 500, { error: 'table_image_render_failed' }, undefined, origin, method)
      }
    }
    if (url.pathname === '/v1/free-classroom-image' && typeof renderTableImage === 'function') {
      const building = String(url.searchParams.get('building') || '').slice(0, 80)
      const periods = String(url.searchParams.get('periods') || '').slice(0, 60)
      const weekdays = String(url.searchParams.get('weekdays') || '').slice(0, 60)
      const weeks = String(url.searchParams.get('weeks') || '').slice(0, 60)
      const termId = String(url.searchParams.get('termId') || '').slice(0, 64)
      const title = String(url.searchParams.get('title') || '').slice(0, 200) || '空闲教室'
      // 教室每天基本不变，有缓存就用缓存，没有才实时查询
      const source = state.academicExtras?.domains?.['free-classroom'] || null
      let records = Array.isArray(source?.records) ? source.records : []
      let capturedAt = source?.capturedAt || null
      if (!records.length && typeof queryFreeClassrooms === 'function') {
        try {
          const fresh = await queryFreeClassrooms({ building, periods, weekdays, weeks, termId })
          records = Array.isArray(fresh?.records) ? fresh.records : []
          capturedAt = fresh?.capturedAt || capturedAt
        } catch { /* keep empty */ }
      }
      if (!records.length) return send(response, 404, { error: 'table_image_unavailable' }, undefined, origin, method)
      try {
        const html = renderFreeClassroomImageHtml(records, { title, building, periods, capturedAt })
        const png = await renderTableImage(html)
        return send(response, 200, png, 'image/png', origin, method)
      } catch (error) {
        return send(response, 500, { error: 'table_image_render_failed' }, undefined, origin, method)
      }
    }
    if (url.pathname === '/v1/academic-calendar') {
      return send(response, 200, academicCalendarAssetsService?.snapshot() || {
        schema: 'theia-academic-calendar-assets/v1', updatedAt: null, assets: {}, root: null,
      }, undefined, origin, method)
    }
    const assetKey = new Map([
      ['/v1/academic-calendar/calendar', 'calendar'],
      ['/v1/academic-calendar/teaching-schedule', 'teachingSchedule'],
      ['/v1/academic-calendar/weekly-calendar', 'weeklyCalendar'],
    ]).get(url.pathname)
    if (assetKey) {
      const path = academicCalendarAssetsService?.pathFor(assetKey)
      try {
        const content = path ? await readFile(path) : null
        if (!content) return send(response, 404, { error: 'academic_calendar_asset_missing' }, undefined, origin, method)
        return send(response, 200, content, assetKey === 'calendar' ? 'image/jpeg' : 'application/pdf', origin, method)
      } catch {
        return send(response, 404, { error: 'academic_calendar_asset_missing' }, undefined, origin, method)
      }
    }
    if (url.pathname === '/v1/fitness') {
      const year = url.searchParams.get('year')
      return send(response, 200, {
        schema: state.dataCatalog?.schema || 'theia-local-data/v1',
        updatedAt: state.dataCatalog?.updatedAt || null,
        summary: fitnessCacheSummary(state.dataCatalog),
        item: cachedFitnessResult(state.dataCatalog, year),
      }, undefined, origin, method)
    }
    if (url.pathname === '/v1/school-schedule') {
      const scope = {
        termId: url.searchParams.get('termId'),
        keyword: url.searchParams.get('keyword'),
        teacher: url.searchParams.get('teacher'),
        department: url.searchParams.get('department'),
        category: url.searchParams.get('category'),
        nature: url.searchParams.get('nature'),
        format: url.searchParams.get('format'),
        affiliation: url.searchParams.get('affiliation'),
      }
      return send(response, 200, {
        schema: state.dataCatalog?.schema || 'theia-local-data/v1',
        updatedAt: state.dataCatalog?.updatedAt || null,
        summary: schoolScheduleCacheSummary(state.dataCatalog),
        item: cachedSchoolScheduleResult(state.dataCatalog, scope.termId ? scope : null),
      }, undefined, origin, method)
    }
    if (url.pathname === '/v1/venue-catalog') {
      return send(response, 200, {
        schema: state.dataCatalog?.schema || 'theia-local-data/v1',
        updatedAt: state.dataCatalog?.updatedAt || null,
        item: cachedMotionVenueCatalog(state.dataCatalog),
      }, undefined, origin, method)
    }
    if (url.pathname === '/v1/venue-status') {
      const detailUrl = url.searchParams.get('detailUrl') || null
      const date = url.searchParams.get('date') || null
      const venue = url.searchParams.get('venue') || null
      return send(response, 200, {
        schema: state.dataCatalog?.schema || 'theia-local-data/v1',
        updatedAt: state.dataCatalog?.updatedAt || null,
        summary: motionVenueCacheSummary(state.dataCatalog),
        item: cachedMotionVenueStatus(state.dataCatalog, { detailUrl, date, venue }),
      }, undefined, origin, method)
    }
    if (url.pathname === '/v1/venue-statuses') {
      const activity = url.searchParams.get('activity') || null
      const date = url.searchParams.get('date') || null
      // Motion venue availability is short-lived data. It must always be read
      // live from the campus source rather than served from a local cache, so
      // an on-demand query (Iris "theia motion", the desktop tool) always
      // reflects the current reservation state.
      if (typeof fetchMotionVenueStatuses === 'function') {
        try {
          const live = await fetchMotionVenueStatuses({ activity, date })
          const items = Array.isArray(live?.item) ? live.item : []
          return send(response, 200, {
            schema: state.dataCatalog?.schema || 'theia-local-data/v1',
            updatedAt: live?.updatedAt || state.updatedAt,
            summary: live?.summary || motionVenueCacheSummary(state.dataCatalog),
            item: items,
            live: true,
          }, undefined, origin, method)
        } catch {
          // A live read failure must not fabricate data. Fall through to the
          // cached view (which may be empty) so the caller can report the
          // failure honestly.
        }
      }
      return send(response, 200, {
        schema: state.dataCatalog?.schema || 'theia-local-data/v1',
        updatedAt: state.dataCatalog?.updatedAt || null,
        summary: motionVenueCacheSummary(state.dataCatalog),
        item: cachedMotionVenueStatuses(state.dataCatalog, { activity, date }),
        live: false,
      }, undefined, origin, method)
    }
    if (url.pathname === '/v1/feed' || url.pathname === '/v1/theia') return send(response, 200, toTheiaFeed(state), undefined, origin, method)
    if (url.pathname === '/v1/calendar.ics') return send(response, 200, toIcs(state), 'text/calendar; charset=utf-8', origin, method)
    if (url.pathname === '/v1/academic-progress') {
      const item = unchangedSince(state.academicProgress?.capturedAt || state.updatedAt, url) ? null : state.academicProgress
      return send(response, 200, { schema: state.schema, updatedAt: state.updatedAt, notModified: item === null && Boolean(state.academicProgress), item }, undefined, origin, method)
    }
    if (url.pathname === '/v1/academic-analysis') {
      const versioned = store.snapshotWithRevision ? store.snapshotWithRevision() : { state, revision: null }
      const analysisState = versioned.state || state
      const item = unchangedSince(analysisState.updatedAt, url) ? null : buildAcademicAnalysis({
        grades: analysisState.grades,
        courses: analysisState.courses,
        progress: analysisState.academicProgress,
        evaluatedAt: analysisState.updatedAt,
      })
      return send(response, 200, {
        schema: 'theia-academic-analysis-response/v1',
        updatedAt: analysisState.updatedAt,
        snapshotRevision: versioned.revision || null,
        notModified: item === null,
        item,
      }, undefined, origin, method)
    }
    const csvMatch = url.pathname.match(/^\/v1\/(terms|courses|schedule|exams|grades|selected-courses|selectedCourses|assignments|workspaces|notices|emails)\.csv$/)
    const collectionPath = csvMatch?.[1] || url.pathname.match(/^\/v1\/(terms|courses|schedule|exams|grades|selected-courses|selectedCourses|assignments|workspaces|notices|emails)$/)?.[1]
    const collection = COLLECTION_ALIASES.get(collectionPath) || collectionPath
    if (collection && COLLECTIONS.has(collection)) {
      if (csvMatch) return send(response, 200, collectionCsv({ ...state, [collection]: filtered(state[collection] || [], url) }, collection), 'text/csv; charset=utf-8', origin, method)
      return send(response, 200, collectionResponse(state, collection, url), undefined, origin, method)
    }
    return send(response, 404, { error: 'not_found' }, undefined, origin, method)
  } catch (error) {
    if (!response.headersSent) {
      send(response, 500, { error: 'internal_error' }, undefined, null, 'GET')
    }
  }
})

  const requestedPort = Number(preferredPort) || 8765
  const candidates = [...Array.from({ length: 10 }, (_value, offset) => requestedPort + offset), 0]
  let port = requestedPort
  for (const [index, candidate] of candidates.entries()) {
    try {
      await new Promise((resolveListen, reject) => {
        const onError = (error) => { server.off('listening', onListen); reject(error) }
        const onListen = () => { server.off('error', onError); resolveListen() }
        server.once('error', onError)
        server.once('listening', onListen)
        server.listen(candidate, '127.0.0.1')
      })
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Local API did not expose a TCP port')
      port = address.port
      break
    } catch (error) {
      const retryable = error?.code === 'EADDRINUSE' || error?.code === 'EACCES'
      if (!retryable || index === candidates.length - 1) throw error
    }
  }
  const runtimePath = resolve(root, 'api-runtime.json')
  const runtime = { pid: process.pid, host: '127.0.0.1', port, baseUrl: `http://127.0.0.1:${port}`, token, startedAt: new Date().toISOString() }
  const publishRuntimeMetadata = () => writeFile(runtimePath, JSON.stringify(runtime, null, 2) + '\n', 'utf8')
  if (publishRuntime) await publishRuntimeMetadata()
  let closePromise = null
  return {
    server,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    token,
    runtime,
    publishRuntime: publishRuntimeMetadata,
    close: () => {
      if (closePromise) return closePromise
      closePromise = (async () => {
        await new Promise((resolveClose, rejectClose) => {
          const timeout = setTimeout(() => {
            server.closeAllConnections?.()
            resolveClose()
          }, 2_000)
          timeout.unref?.()
          server.close((error) => {
            clearTimeout(timeout)
            if (error) rejectClose(error)
            else resolveClose()
          })
          server.closeIdleConnections?.()
        })
        try {
          const current = JSON.parse(await readFile(runtimePath, 'utf8'))
          if (current.pid === runtime.pid && current.startedAt === runtime.startedAt && current.port === runtime.port) {
            await rm(runtimePath, { force: true })
          }
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error
        }
      })()
      return closePromise
    },
  }
}
