import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { academicCalendarWeek, nextAcademicCalendarBoundary, normalizeAcademicCalendar } from './academic-calendar.mjs'
import { PARSER_VERSION, academicTrackContextKey, analyzeAcademicCalendarPdfs } from './academic-calendar-pdf-analysis.mjs'
import { runAcademicCalendarOcr } from './academic-calendar-ocr.mjs'

const BASE_URL = 'https://jiaowuchu.buct.edu.cn'
const CALENDAR_PAGE = `${BASE_URL}/2019/1125/c3201a46856/page.htm`
const PDF_PAGES = {
  teachingSchedule: `${BASE_URL}/2019/1125/c3207a46873/page.htm`,
  weeklyCalendar: `${BASE_URL}/2019/1125/c3199a46850/page.htm`,
}
const FILES = {
  calendar: 'calendar_current.jpg',
  teachingSchedule: 'teaching_schedule_current.pdf',
  weeklyCalendar: 'weekly_calendar_current.pdf',
}
const SCHEMA = 'theia-academic-calendar-assets/v1'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137 Safari/537.36'
const PROBE_AHEAD_MS = 14 * 24 * 60 * 60 * 1000
const PROBE_INTERVAL_MS = 6 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 30_000

function isoDate(value = new Date()) { return new Date(value).toISOString() }

function nextSeptember() {
  const now = new Date()
  const year = now.getMonth() < 8 ? now.getFullYear() : now.getFullYear() + 1
  return new Date(Date.UTC(year, 8, 1)).toISOString()
}

function emptyManifest() {
  return { schema: SCHEMA, updatedAt: null, assets: {}, calendar: null, calendarError: null, analysis: null, analysisError: null }
}

function refreshDateForDocuments(calendar) {
  const boundary = nextAcademicCalendarBoundary(calendar)
  return boundary ? `${boundary}T00:00:00.000Z` : nextSeptember()
}

function isCurrent(entry, file, now = Date.now()) {
  return Boolean(entry?.fetchedAt && entry?.nextRefreshAfter && new Date(entry.nextRefreshAfter).getTime() > now && file)
}

function shouldProbe(entry, file, now) {
  if (!isCurrent(entry, file, now)) return true
  const refreshAt = new Date(entry.nextRefreshAfter).getTime()
  if (refreshAt - now > PROBE_AHEAD_MS) return false
  const nextProbeAt = new Date(entry.nextProbeAfter || 0).getTime()
  return !Number.isFinite(nextProbeAt) || nextProbeAt <= now
}

function probeMetadata(now) {
  return { lastCheckedAt: isoDate(now), nextProbeAfter: isoDate(now + PROBE_INTERVAL_MS) }
}

function sourceUrlFromCalendarPage(html) {
  const match = String(html || '').match(/\/_upload\/article\/images\/[0-9a-f/]+\/[0-9a-f-]+\.jpg/i)
  if (!match) throw new Error('Academic calendar page did not contain a full-resolution image link')
  return `${BASE_URL}${match[0].replace(/\.jpg$/i, '_d.jpg')}`
}

function sourceUrlFromPdfPage(html) {
  const match = String(html || '').match(/\/_upload\/article\/files\/[0-9a-f/]+\/[0-9a-f-]+\.pdf/i)
  if (!match) throw new Error('Academic calendar page did not contain a PDF link')
  return `${BASE_URL}${match[0]}`
}

export class AcademicCalendarAssetsService {
  constructor({ root, fetchImpl = fetch, onDiagnostic = () => {}, ocrRunner = ({ imagePath }) => runAcademicCalendarOcr(imagePath), profileProvider = () => null, coursesProvider = () => [], academicTrackProvider = () => null }) {
    this.root = resolve(root, 'academic-calendar')
    this.assetsRoot = resolve(this.root, 'assets')
    this.manifestFile = resolve(this.root, 'manifest.json')
    this.fetch = fetchImpl
    this.onDiagnostic = onDiagnostic
    this.ocrRunner = ocrRunner
    this.profileProvider = profileProvider
    this.coursesProvider = coursesProvider
    this.academicTrackProvider = academicTrackProvider
    this.manifest = emptyManifest()
    this.refreshInFlight = null
  }

  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.manifestFile, 'utf8'))
      if (parsed?.schema === SCHEMA && parsed.assets && typeof parsed.assets === 'object') this.manifest = parsed
    } catch { /* First launch has no assets yet. */ }
    return this.snapshot()
  }

  snapshot() {
    const snapshot = structuredClone({ ...this.manifest, root: this.root })
    if (snapshot.calendar) snapshot.calendar.currentWeek = academicCalendarWeek(snapshot.calendar)
    return snapshot
  }

  pathFor(key) {
    const filename = FILES[key]
    return filename ? resolve(this.assetsRoot, filename) : null
  }

  needsRefresh({ force = false, now = Date.now() } = {}) {
    if (force) return true
    return Object.keys(FILES).some((key) => {
      const path = this.pathFor(key)
      return !existsSync(path) || shouldProbe(this.manifest.assets?.[key], true, now)
    })
  }

  async requestText(url) {
    const response = await this.fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'zh-CN,zh;q=0.9' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`Academic calendar request failed (${response.status})`)
    return response.text()
  }

  async download(url, destination, expected) {
    const response = await this.fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'zh-CN,zh;q=0.9' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`Academic calendar download failed (${response.status})`)
    const content = Buffer.from(await response.arrayBuffer())
    if (expected === 'pdf' && !content.subarray(0, 4).equals(Buffer.from('%PDF'))) throw new Error('Academic calendar PDF endpoint returned a non-PDF response')
    if (expected === 'image' && content.length < 1_024) throw new Error('Academic calendar image endpoint returned an unexpectedly small response')
    await mkdir(dirname(destination), { recursive: true })
    const temporary = `${destination}.${randomUUID()}.tmp`
    await writeFile(temporary, content)
    await rename(temporary, destination)
    return content.length
  }

  async persist() {
    await mkdir(this.root, { recursive: true })
    const temporary = `${this.manifestFile}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(this.manifest, null, 2)}\n`, 'utf8')
    await rename(temporary, this.manifestFile)
  }

  async refresh(options = {}) {
    if (this.refreshInFlight) return this.refreshInFlight
    this.refreshInFlight = this.refreshInternal(options).finally(() => { this.refreshInFlight = null })
    return this.refreshInFlight
  }

  async refreshInternal({ force = false } = {}) {
    const now = Date.now()
    const fetchOne = async (key, pageUrl, sourceFromPage, expected) => {
      const path = this.pathFor(key)
      let exists = false
      try { exists = (await stat(path)).isFile() } catch { /* Fetch missing file. */ }
      const previous = this.manifest.assets[key]
      if (!force && !shouldProbe(previous, exists, now)) return false
      this.onDiagnostic('academic_calendar.probe_started', { key, pageUrl, force })
      const page = await this.requestText(pageUrl)
      const sourceUrl = sourceFromPage(page)
      if (exists && previous?.sourceUrl === sourceUrl) {
        this.manifest.assets[key] = {
          ...previous,
          nextRefreshAfter: key === 'calendar' ? nextSeptember() : refreshDateForDocuments(this.manifest.calendar),
          ...probeMetadata(now),
        }
        this.onDiagnostic('academic_calendar.probe_unchanged', { key, sourceUrl })
        return false
      }
      this.onDiagnostic('academic_calendar.asset_started', { key, sourceUrl })
      const bytes = await this.download(sourceUrl, path, expected)
      this.manifest.assets[key] = {
        filename: FILES[key], sourceUrl, fetchedAt: isoDate(now), nextRefreshAfter: key === 'calendar' ? nextSeptember() : refreshDateForDocuments(this.manifest.calendar), bytes,
        ...probeMetadata(now),
      }
      this.onDiagnostic('academic_calendar.asset_finished', { key, bytes, sourceUrl })
      return true
    }
    const calendarChanged = await fetchOne('calendar', CALENDAR_PAGE, sourceUrlFromCalendarPage, 'image')
    // A changed image can leave the previous normalized calendar in place if
    // OCR failed. Retry that parse on the next refresh even when the source
    // URL is unchanged; otherwise one transient OCR failure would pin stale
    // vacation dates until the university publishes another image.
    if (calendarChanged || !this.manifest.calendar || this.manifest.calendarError || force) {
      try {
        this.onDiagnostic('academic_calendar.ocr_started', { key: 'calendar' })
        const calendar = normalizeAcademicCalendar(await this.ocrRunner({ imagePath: this.pathFor('calendar') }))
        if (!calendar.schoolYear || !calendar.semesters.length) throw new Error('Calendar OCR did not produce semester boundaries')
        calendar.parsedAt = isoDate()
        this.manifest.calendar = calendar
        this.manifest.calendarError = null
        this.onDiagnostic('academic_calendar.ocr_finished', { schoolYear: calendar.schoolYear, semesters: calendar.semesters.length })
      } catch (error) {
        this.manifest.calendarError = String(error?.message || error).slice(0, 300)
        this.onDiagnostic('academic_calendar.ocr_failed', { error: this.manifest.calendarError })
      }
    }
    const teachingChanged = await fetchOne('teachingSchedule', PDF_PAGES.teachingSchedule, sourceUrlFromPdfPage, 'pdf')
    const weeklyChanged = await fetchOne('weeklyCalendar', PDF_PAGES.weeklyCalendar, sourceUrlFromPdfPage, 'pdf')
    const analysisContext = {
      profile: this.profileProvider(),
      courses: this.coursesProvider(),
      academicTrack: this.academicTrackProvider(),
    }
    const shouldAnalyze = force || teachingChanged || weeklyChanged || !this.manifest.analysis
      || Boolean(this.manifest.analysisError)
      || this.manifest.analysis?.parserVersion !== PARSER_VERSION
      || this.manifest.analysis?.teachingSchedule?.match?.contextKey !== academicTrackContextKey(analysisContext)
    if (shouldAnalyze) {
      try {
        this.onDiagnostic('academic_calendar.pdf_analysis_started', { force, teachingChanged, weeklyChanged })
        const analysis = await analyzeAcademicCalendarPdfs({
          weeklyPath: this.pathFor('weeklyCalendar'),
          teachingPath: this.pathFor('teachingSchedule'),
          assets: this.manifest.assets,
          calendar: this.manifest.calendar,
          ...analysisContext,
        })
        this.manifest.analysis = analysis
        this.manifest.analysisError = null
        this.onDiagnostic('academic_calendar.pdf_analysis_finished', {
          weeklyEntries: analysis.weeklyCalendar?.entries?.length || 0,
          teachingRows: analysis.teachingSchedule?.rows?.length || 0,
          match: analysis.teachingSchedule?.match?.status || null,
        })
      } catch (error) {
        this.manifest.analysisError = String(error?.message || error).slice(0, 300)
        this.onDiagnostic('academic_calendar.pdf_analysis_failed', { error: this.manifest.analysisError })
      }
    }
    this.manifest.updatedAt = isoDate()
    await this.persist()
    return this.snapshot()
  }
}

export const ACADEMIC_CALENDAR_ASSET_FILES = FILES
