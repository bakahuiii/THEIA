import { performance } from 'node:perf_hooks'
import * as cheerio from 'cheerio'

export const MOTION_BASE_URL = 'https://motion.buct.edu.cn/changguanyuyue1/'
export const MOTION_ENTRY_URL = `${MOTION_BASE_URL}xzxq.php`
export const MOTION_PARSER_VERSION = 'motion-venue/v1'

const ALLOWED_PATHS = new Set([
  '/changguanyuyue1/xzxq.php',
  '/changguanyuyue1/jinri_cpxq.php',
  '/changguanyuyue1/jinri_dxq.php',
  '/changguanyuyue1/jinri_cl.php',
  '/changguanyuyue1/detail.php',
  '/changguanyuyue1/detailBB.php',
  '/changguanyuyue1/detail_cl.php',
])
const LISTING_PATHS = new Set([
  '/changguanyuyue1/xzxq.php',
  '/changguanyuyue1/jinri_cpxq.php',
  '/changguanyuyue1/jinri_dxq.php',
  '/changguanyuyue1/jinri_cl.php',
])
const DETAIL_PATH = /\/detail(?:BB|_cl)?\.php$/u
const ALLOWED_QUERY_KEYS = new Set(['XQ', 'xq', 'xm', 'd', 'c'])
const LOGIN_MARKER = /(?:统一认证|登录|登陆|用户名|口令|密码|captcha|验证码|username|password)/iu
const SENSITIVE_LABEL = /(?:姓名|学号|手机号|手机号码|手机|电话|身份证|联系人|预约人|申请人|用户名|账号|email|e-mail|phone|mobile|student|user(?:name)?|idcard)/iu
const DATE_VALUE = /^\d{4}-\d{2}-\d{2}$/u
const TIME_RANGE = /^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/u

const text = (value) => String(value ?? '').replace(/\s+/gu, ' ').trim()
const unique = (values) => [...new Set(values.filter(Boolean))]
const elapsedMs = (startedAt, now) => Math.round(Math.max(0, now() - startedAt) * 1000) / 1000

function isCalendarDate(value) {
  if (!DATE_VALUE.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function publicVenueValue(value) {
  const normalized = text(value)
  return Boolean(normalized) && normalized.length <= 120 && !/[\u0000-\u001f<>]/u.test(normalized)
}

export function isAllowedMotionUrl(value) {
  let url
  try { url = new URL(String(value), MOTION_BASE_URL) } catch { return false }
  if (url.origin !== new URL(MOTION_BASE_URL).origin || !ALLOWED_PATHS.has(url.pathname)) return false
  const seen = new Set()
  for (const [key, value] of url.searchParams.entries()) {
    if (seen.has(key) || !ALLOWED_QUERY_KEYS.has(key) || !value || value.length > 120) return false
    seen.add(key)
    if ((key === 'XQ' || key === 'xq') && !/^[01]$/u.test(value)) return false
    if (key === 'd' && !isCalendarDate(value)) return false
    if (key === 'c' && !publicVenueValue(value)) return false
  }
  return true
}

function canonicalUrl(value) {
  if (!isAllowedMotionUrl(value)) return null
  const url = new URL(String(value), MOTION_BASE_URL)
  url.hash = ''
  return url.toString()
}

function campusFromUrl(url, fallback = null) {
  const value = url.searchParams.get('XQ') || url.searchParams.get('xq')
  if (value === '0') return { id: 'changping', label: '昌平校区' }
  if (value === '1') return { id: 'east', label: '东校区' }
  return fallback
}

function campusFromLabel(value, fallback = null) {
  const normalized = text(value)
  if (/昌平/u.test(normalized)) return { id: 'changping', label: '昌平校区' }
  if (/东校区/u.test(normalized)) return { id: 'east', label: '东校区' }
  return fallback
}

function pageKind(pathname) {
  if (pathname.endsWith('/xzxq.php')) return 'campus-selector'
  if (pathname.endsWith('/jinri_cpxq.php') || pathname.endsWith('/jinri_dxq.php')) return 'campus-catalog'
  if (pathname.endsWith('/jinri_cl.php')) return 'morning-catalog'
  return 'venue-detail'
}

function sanitize(value, { sensitive = false } = {}) {
  let normalized = text(value)
  if (!normalized) return null
  if (sensitive || SENSITIVE_LABEL.test(normalized)) return '[redacted]'
  normalized = normalized
    .replace(/\b(?:1[3-9]\d{9}|0\d{2,3}[- ]?\d{7,8})\b/gu, '[redacted-phone]')
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/gu, '[redacted-email]')
    .replace(/\b\d{8,18}[0-9Xx]?\b/gu, '[redacted-id]')
  return normalized.slice(0, 500)
}

function statusState(value) {
  const normalized = text(value)
  if (!normalized) return 'unknown'
  if (/(?:可预约|可用|空闲)/u.test(normalized)) return 'available'
  if (/(?:已预约|已占用|上课|占用|已满)/u.test(normalized)) return 'occupied'
  if (/(?:闭馆|停用|不可用)/u.test(normalized)) return 'closed'
  if (/已过期/u.test(normalized)) return 'expired'
  if (/选定/u.test(normalized)) return 'selected'
  return 'unknown'
}

function countValues(values) {
  return Object.fromEntries([...values.reduce((counts, value) => {
    counts.set(value, (counts.get(value) || 0) + 1)
    return counts
  }, new Map()).entries()].sort(([left], [right]) => left.localeCompare(right)))
}

function selectedOptions($, name) {
  const select = $(`select[name="${name}"]`).first()
  if (!select.length) return { selected: null, values: [] }
  const options = select.find('option').toArray().map((node) => {
    const option = $(node)
    const value = sanitize(option.attr('value') || option.text())
    return { value, selected: option.attr('selected') !== undefined || option.is(':selected') }
  }).filter((option) => option.value && option.value !== '[redacted]')
  return {
    selected: options.find((option) => option.selected)?.value || options[0]?.value || null,
    values: unique(options.map((option) => option.value)),
  }
}

function extractAvailability($) {
  return $('table').toArray().map((node, index) => {
    const table = $(node)
    const headerRows = table.find('thead th, thead td').toArray()
    const fallbackRow = table.children('tr').first().length
      ? table.children('tr').first()
      : table.children('tbody').first().children('tr').first()
    const headers = (headerRows.length ? headerRows : fallbackRow.find('th,td').toArray())
      .map((header) => sanitize($(header).text()))
      .filter(Boolean)
    const slots = table.find('tbody tr, tr').toArray().map((row) => {
      const cells = $(row).find('th,td').toArray()
      const time = sanitize($(cells[0]).text())
      if (!time || !TIME_RANGE.test(time)) return null
      const courts = cells.slice(1).map((cell, cellIndex) => {
        const court = headers[cellIndex + 1] || `court-${cellIndex + 1}`
        if (SENSITIVE_LABEL.test(court)) return null
        const status = sanitize($(cell).text())
        if (!status || status === '[redacted]') return null
        return { court, status, state: statusState(status) }
      }).filter(Boolean)
      return courts.length ? { time, courts } : null
    }).filter(Boolean)
    if (!slots.length) return null
    const cells = slots.flatMap((slot) => slot.courts)
    return {
      index,
      headers: [headers[0] || '时间\\场地', ...headers.slice(1).filter((header) => !SENSITIVE_LABEL.test(header))],
      slots,
      summary: {
        timeSlots: slots.length,
        courtStatusCells: cells.length,
        byLabel: countValues(cells.map((cell) => cell.status)),
        byState: countValues(cells.map((cell) => cell.state)),
      },
    }
  }).filter(Boolean)
}

function pageSummary($) {
  const availability = extractAvailability($)
  const cells = availability.flatMap((table) => table.slots.flatMap((slot) => slot.courts))
  return {
    timeSlots: availability.reduce((total, table) => total + table.summary.timeSlots, 0),
    courtStatusCells: cells.length,
    byLabel: countValues(cells.map((cell) => cell.status)),
    byState: countValues(cells.map((cell) => cell.state)),
  }
}

function discoveredLinks($, pageUrl, fallbackCampus) {
  const links = []
  $('a[href]').each((_, node) => {
    let candidate
    try { candidate = canonicalUrl(new URL($(node).attr('href'), pageUrl).toString()) } catch { candidate = null }
    if (!candidate) return
    const parsed = new URL(candidate)
    const allowed = pageUrl.endsWith('/xzxq.php')
      ? parsed.pathname.endsWith('/jinri_cpxq.php') || parsed.pathname.endsWith('/jinri_dxq.php')
      : LISTING_PATHS.has(new URL(pageUrl).pathname)
        ? DETAIL_PATH.test(parsed.pathname) || parsed.pathname.endsWith('/jinri_cl.php')
        : false
    if (!allowed) return
    links.push({
      url: candidate,
      label: sanitize($(node).text() || $(node).attr('title')),
      campus: campusFromLabel($(node).text(), fallbackCampus),
    })
  })
  return links
}

async function requestPage(fetchImpl, url) {
  const response = await fetchImpl(url, {
    method: 'GET',
    redirect: 'manual',
    headers: { accept: 'text/html,application/xhtml+xml' },
  })
  const status = Number(response.status) || 0
  const contentType = response.headers?.get?.('content-type') || null
  const body = await response.text()
  if (!response.ok || status < 200 || status >= 300) throw new Error(`MOTION HTTP ${status || 'unknown'}`)
  const finalUrl = canonicalUrl(response.url || url)
  if (!finalUrl) throw new Error('MOTION response escaped the allowlist')
  return { body, status, contentType, finalUrl }
}

function selection(name, requested, available) {
  const value = requested === null || requested === undefined ? available.selected : sanitize(requested)
  if (!value) throw new Error(`MOTION public ${name} selection is unavailable`)
  if (name === 'date' && !isCalendarDate(value)) throw new TypeError('MOTION date must use YYYY-MM-DD')
  if (name === 'venue' && !publicVenueValue(value)) throw new TypeError('MOTION venue must be a public selector value')
  if (available.values.length && !available.values.includes(value)) {
    throw new RangeError(`MOTION ${name} is not exposed by the public page`)
  }
  return value
}

export class MotionVenueAdapter {
  constructor({ fetchImpl = globalThis.fetch, now = () => performance.now() } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('MotionVenueAdapter requires fetchImpl')
    if (typeof now !== 'function') throw new TypeError('MotionVenueAdapter requires now')
    this.fetchImpl = fetchImpl
    this.now = now
  }

  async status() {
    const checkedAt = new Date().toISOString()
    try {
      const page = await requestPage(this.fetchImpl, MOTION_ENTRY_URL)
      return { connected: true, checkedAt, url: page.finalUrl, accessMode: 'public-anonymous-get' }
    } catch (error) {
      return { connected: false, checkedAt, accessMode: 'public-anonymous-get', error: String(error?.message || error).slice(0, 300) }
    }
  }

  async discover() {
    const queue = [{ url: MOTION_ENTRY_URL, campus: null }]
    const seen = new Set()
    const pages = []
    const links = []
    const errors = []
    while (queue.length) {
      const current = queue.shift()
      if (seen.has(current.url)) continue
      seen.add(current.url)
      try {
        const response = await requestPage(this.fetchImpl, current.url)
        const $ = cheerio.load(response.body)
        const parsedUrl = new URL(response.finalUrl)
        const campus = campusFromUrl(parsedUrl, current.campus)
        const loginPage = LOGIN_MARKER.test(`${$('title').first().text()} ${$('body').text().slice(0, 2000)}`)
        if (loginPage) throw new Error('MOTION page resembled a login page')
        pages.push({ kind: pageKind(parsedUrl.pathname), url: response.finalUrl, status: response.status })
        for (const link of discoveredLinks($, response.finalUrl, campus)) {
          links.push({ ...link, sourceUrl: response.finalUrl })
          if (!seen.has(link.url)) queue.push({ url: link.url, campus: link.campus || campus })
        }
      } catch (error) {
        errors.push({ url: current.url, message: String(error?.message || error).slice(0, 300) })
      }
    }
    const venues = [...new Map(links.filter((link) => DETAIL_PATH.test(new URL(link.url).pathname)).map((link) => {
      const parsed = new URL(link.url)
      const campus = link.campus || campusFromUrl(parsed, { id: 'unknown', label: '未标注校区' })
      const activity = sanitize(parsed.searchParams.get('xm') || link.label) || '未命名项目'
      return [link.url, {
        id: `motion-venue-${Buffer.from(`${campus.id}|${activity}|${link.url}`).toString('base64url').slice(0, 20)}`,
        campusId: campus.id,
        campusLabel: campus.label,
        activity,
        label: link.label || activity,
        detailUrl: link.url,
      }]
    })).values()]
    const campuses = [...new Map(venues.map((venue) => [venue.campusId, { id: venue.campusId, label: venue.campusLabel }])).values()]
      .map((campus) => ({ ...campus, venueIds: venues.filter((venue) => venue.campusId === campus.id).map((venue) => venue.id) }))
    return {
      schema: 'theia-motion-venue-catalog/v1',
      parserVersion: MOTION_PARSER_VERSION,
      capturedAt: new Date().toISOString(),
      source: { platform: 'MOTION', accessMode: 'public-anonymous-get', entryUrl: MOTION_ENTRY_URL, method: 'GET' },
      safety: { onlyRead: true, requestedMethods: ['GET'], submittedForms: 0, executedBookingActions: 0, credentialsOrCookiesSupplied: false, rawBodyPersisted: false },
      counts: {
        pages: pages.length,
        successfulPages: pages.filter((page) => page.status >= 200 && page.status < 300).length,
        venues: venues.length,
        campuses: campuses.length,
        errors: errors.length,
      },
      campuses,
      venues,
      pages: pages.map(({ kind, url, status }) => ({ kind, url, status })),
      errors,
    }
  }

  async queryStatus({ detailUrl, date = null, venue = null } = {}) {
    const sourceUrl = canonicalUrl(detailUrl)
    if (!sourceUrl || !DETAIL_PATH.test(new URL(sourceUrl).pathname)) {
      throw new Error('MOTION detailUrl must be an allowlisted public detail page')
    }
    const queryStartedAt = this.now()
    const initialStartedAt = this.now()
    const initial = await requestPage(this.fetchImpl, sourceUrl)
    const initialRequestMs = elapsedMs(initialStartedAt, this.now)
    const initial$ = cheerio.load(initial.body)
    if (LOGIN_MARKER.test(`${initial$('title').first().text()} ${initial$('body').text().slice(0, 2000)}`)) {
      throw new Error('MOTION detail page resembled a login page')
    }
    const availableDate = selectedOptions(initial$, 'd')
    const availableVenue = selectedOptions(initial$, 'c')
    const requestedDate = selection('date', date, availableDate)
    const requestedVenue = selection('venue', venue, availableVenue)
    const target = new URL(initial.finalUrl || sourceUrl)
    target.searchParams.set('d', requestedDate)
    target.searchParams.set('c', requestedVenue)
    const queryUrl = canonicalUrl(target.toString())
    if (!queryUrl) throw new Error('MOTION selected detail URL failed allowlist validation')
    const reusedInitial = availableDate.selected === requestedDate && availableVenue.selected === requestedVenue
    const selectedStartedAt = reusedInitial ? null : this.now()
    const selected = reusedInitial ? initial : await requestPage(this.fetchImpl, queryUrl)
    const selectedRequestMs = selectedStartedAt === null ? null : elapsedMs(selectedStartedAt, this.now)
    const $ = cheerio.load(selected.body)
    if (LOGIN_MARKER.test(`${$('title').first().text()} ${$('body').text().slice(0, 2000)}`)) {
      throw new Error('MOTION selected detail page resembled a login page')
    }
    const selectedDate = selectedOptions($, 'd')
    const selectedVenue = selectedOptions($, 'c')
    if (selectedDate.selected !== requestedDate || selectedVenue.selected !== requestedVenue) {
      throw new Error('MOTION page did not acknowledge the requested date or venue')
    }
    const availability = extractAvailability($)
    const summary = pageSummary($)
    const parsedUrl = new URL(selected.finalUrl || queryUrl)
    return {
      schema: 'theia-motion-venue-status/v1',
      parserVersion: MOTION_PARSER_VERSION,
      capturedAt: new Date().toISOString(),
      source: { platform: 'MOTION', accessMode: 'public-anonymous-get', url: selected.finalUrl || queryUrl, queryUrl, method: 'GET', contentType: selected.contentType || null },
      query: {
        activity: sanitize(parsedUrl.searchParams.get('xm')),
        campus: campusFromUrl(parsedUrl),
        detailUrl: sourceUrl,
        date: selectedDate.selected,
        venue: selectedVenue.selected,
        availableDates: availableDate.values,
        availableVenues: availableVenue.values,
      },
      availability: { tables: availability, summary },
      safety: { onlyRead: true, requestedMethods: ['GET'], requestedPageCount: reusedInitial ? 1 : 2, submittedForms: 0, executedBookingActions: 0, credentialsOrCookiesSupplied: false, rawBodyPersisted: false },
      timing: { totalMs: elapsedMs(queryStartedAt, this.now), initialRequestMs, selectedRequestMs, selectedPageFetched: !reusedInitial },
    }
  }
}
