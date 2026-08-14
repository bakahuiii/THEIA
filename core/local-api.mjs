import { createServer } from 'node:http'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { collectionCsv, counts, toTheiaFeed, toIcs } from './schema.mjs'
import { cachedFitnessResult, fitnessCacheSummary, cachedSchoolScheduleResult, schoolScheduleCacheSummary } from './data-catalog.mjs'

const COLLECTIONS = new Set(['terms', 'courses', 'schedule', 'exams', 'grades', 'selectedCourses', 'assignments', 'workspaces', 'notices', 'emails'])
const COLLECTION_ALIASES = new Map([['selected-courses', 'selectedCourses']])

function allowedOrigin(origin) {
  if (!origin) return null
  // Packaged file:// renderers send the literal null origin. Echo only that
  // exact value; this server remains loopback-only and read-only.
  if (String(origin).toLowerCase() === 'null') return 'null'
  try {
    const url = new URL(origin)
    if (url.protocol === 'theia:' || url.protocol === 'theia:') return origin
    if ((url.hostname === '127.0.0.1' || url.hostname === 'localhost') && ['http:', 'https:'].includes(url.protocol)) return origin
  } catch { /* no CORS for invalid origins */ }
  return null
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

function unchangedSince(value, url) {
  const since = url.searchParams.get('since')
  if (!since) return false
  const threshold = new Date(since).getTime()
  const updatedAt = new Date(value || 0).getTime()
  return Number.isFinite(threshold) && Number.isFinite(updatedAt) && updatedAt < threshold
}

export async function startLocalApi({ store, root, preferredPort = 8765, academicCalendarAssetsService = null, publishRuntime = true }) {
  const server = createServer(async (request, response) => {
    const expectedHost = `127.0.0.1:${port}`
    if (String(request.headers.host || '').toLowerCase() !== expectedHost) {
      return send(response, 421, { error: 'host_not_allowed' }, undefined, null, request.method || 'GET')
    }
    const origin = allowedOrigin(request.headers.origin)
    if (request.method === 'OPTIONS') {
      if (!origin) return send(response, 403, { error: 'origin_not_allowed' }, undefined, null, request.method)
      response.writeHead(204, {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
        'Access-Control-Allow-Headers': 'Accept,Content-Type',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      })
      return response.end()
    }
    if (!['GET', 'HEAD'].includes(request.method || '')) return send(response, 405, { error: 'read_only_api' }, undefined, origin, request.method)
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    const state = store.snapshot()
    const method = request.method || 'GET'
    if (url.pathname === '/v1/health') return send(response, 200, { ok: true, schema: state.schema, updatedAt: state.updatedAt, counts: counts(state) }, undefined, origin, method)
    if (url.pathname === '/v1/collections') return send(response, 200, {
      schema: state.schema,
      updatedAt: state.updatedAt,
      collections: [...COLLECTIONS].map((name) => ({ name, endpoint: `/v1/${name === 'selectedCourses' ? 'selected-courses' : name}`, count: state[name]?.length || 0 })),
    }, undefined, origin, method)
    if (url.pathname === '/v1/profile') return send(response, 200, { schema: state.schema, updatedAt: state.updatedAt, item: state.profile }, undefined, origin, method)
    if (url.pathname === '/v1/sync') return send(response, 200, { schema: state.schema, updatedAt: state.updatedAt, item: state.sync }, undefined, origin, method)
    if (url.pathname === '/v1/snapshot') return send(response, 200, state, undefined, origin, method)
    if (url.pathname === '/v1/data-manifest') return send(response, 200, store.storageSummary(), undefined, origin, method)
    if (url.pathname === '/v1/data-catalog') return send(response, 200, state.dataCatalog, undefined, origin, method)
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
    if (url.pathname === '/v1/feed' || url.pathname === '/v1/theia') return send(response, 200, toTheiaFeed(state), undefined, origin, method)
    if (url.pathname === '/v1/calendar.ics') return send(response, 200, toIcs(state), 'text/calendar; charset=utf-8', origin, method)
    if (url.pathname === '/v1/academic-progress') {
      const item = unchangedSince(state.academicProgress?.capturedAt || state.updatedAt, url) ? null : state.academicProgress
      return send(response, 200, { schema: state.schema, updatedAt: state.updatedAt, notModified: item === null && Boolean(state.academicProgress), item }, undefined, origin, method)
    }
    const csvMatch = url.pathname.match(/^\/v1\/(terms|courses|schedule|exams|grades|selected-courses|selectedCourses|assignments|workspaces|notices|emails)\.csv$/)
    const collectionPath = csvMatch?.[1] || url.pathname.match(/^\/v1\/(terms|courses|schedule|exams|grades|selected-courses|selectedCourses|assignments|workspaces|notices|emails)$/)?.[1]
    const collection = COLLECTION_ALIASES.get(collectionPath) || collectionPath
    if (collection && COLLECTIONS.has(collection)) {
      if (csvMatch) return send(response, 200, collectionCsv({ ...state, [collection]: filtered(state[collection] || [], url) }, collection), 'text/csv; charset=utf-8', origin, method)
      return send(response, 200, collectionResponse(state, collection, url), undefined, origin, method)
    }
    return send(response, 404, { error: 'not_found' }, undefined, origin, method)
  })

  let port = Number(preferredPort) || 8765
  for (let offset = 0; offset < 10; offset += 1) {
    try {
      await new Promise((resolveListen, reject) => {
        const onError = (error) => { server.off('listening', onListen); reject(error) }
        const onListen = () => { server.off('error', onError); resolveListen() }
        server.once('error', onError)
        server.once('listening', onListen)
        server.listen(port + offset, '127.0.0.1')
      })
      port += offset
      break
    } catch (error) {
      if (error?.code !== 'EADDRINUSE' || offset === 9) throw error
    }
  }
  const runtimePath = resolve(root, 'api-runtime.json')
  const runtime = { pid: process.pid, host: '127.0.0.1', port, baseUrl: `http://127.0.0.1:${port}`, startedAt: new Date().toISOString() }
  const publishRuntimeMetadata = () => writeFile(runtimePath, JSON.stringify(runtime, null, 2) + '\n', 'utf8')
  if (publishRuntime) await publishRuntimeMetadata()
  let closePromise = null
  return {
    server,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
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
