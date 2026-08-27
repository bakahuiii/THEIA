import { sanitizeDiagnosticValue, stableId } from './util.mjs'
import { createRequire } from 'node:module'
import { categoryLabelOf, courseCodeOf, preferredCourseCategory } from './course-category.mjs'
import { emptyDataCatalog, normalizeDataCatalog } from './data-catalog.mjs'
import { normalizeAcademicProgress } from './academic-progress.mjs'
import { normalizeModelServiceBaseUrl } from './model-url-policy.mjs'
import { normalizeDomainProvenanceMap } from './domain-provenance.mjs'
import { emptyAcademicExtras, JWGLXT_IGNORED_EXTRA_DOMAIN_NAMES, normalizeAcademicExtras } from './jwglxt-extra.mjs'
import { normalizeAcademicPlanDocument } from './academic-plan-document.mjs'

export const DATA_SCHEMA = 'theia-campus-data/v1'
export const THEIA_FEED_SCHEMA = 'theia-campus-feed/v1'
const require = createRequire(import.meta.url)
export const APP_VERSION = String(require('../package.json').version || '0.0.0')
const RICH_MAIL_VERSION = 4
const UNSAFE_RICH_MAIL_MARKUP = /<(?:script|iframe|frame|object|embed|form|input|button|select|textarea|video|audio|source|link|meta|base|svg|math|img)\b|(?:\bon[a-z][\w:-]*\s*=|\b(?:src|srcset|poster)\s*=|url\s*\(|@import\b|javascript:|data:text\/html)/iu

// Entity-encoded schemes/attributes (e.g. jav&#x61;script:, on\u0065rror=) are
// decoded by the renderer before they can take effect, so the schema gate must
// re-check the decoded form instead of trusting the literal markup.
function decodeHtmlEntities(value) {
  return String(value || '').replace(/&#x([0-9a-f]+);|&#(\d+);|&(amp|lt|gt|quot|apos|nbsp);/giu, (match, hex, dec, named) => {
    let codePoint
    if (hex !== undefined) codePoint = Number.parseInt(hex, 16)
    else if (dec !== undefined) codePoint = Number.parseInt(dec, 10)
    if (Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      return String.fromCodePoint(codePoint)
    }
    const namedMap = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
    return namedMap[named] ?? match
  })
}

function unsafeRichMailMarkup(value) {
  const html = String(value || '')
  if (UNSAFE_RICH_MAIL_MARKUP.test(html)) return true
  // Limit the decoded re-check to attribute/entity-bearing fragments so a
  // large legitimately-encoded message body is not double-scanned in full.
  if (/&(?:#x?[0-9a-f]+|(?:amp|lt|gt|quot|apos|nbsp));/iu.test(html)) {
    return UNSAFE_RICH_MAIL_MARKUP.test(decodeHtmlEntities(html))
  }
  return false
}

function plainTextFromMailHtml(value) {
  return String(value || '')
    .replace(/<\s*(script|style|iframe|frame|object|embed|form|input|button|select|textarea|video|audio|source|link|meta|base|svg|math|img)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/giu, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 500_000) || null
}

// Adjacent colours are intentionally far apart. Colours are assigned per term
// and stored on schedule entries so changing the displayed week never changes
// a course's visual identity.
const SCHEDULE_ACCENTS = [
  '#1296b6', '#d4674e', '#725dc4', '#409d6a', '#bd8526', '#396eb8',
  '#bc4f83', '#547f3d', '#9a5eae', '#b56630', '#217b82', '#c04755',
  '#5573a4', '#808a2f', '#9a633d', '#4f7393', '#9c436f', '#327f56',
  '#856036', '#5254a2', '#a74832', '#277f9e', '#765b79', '#597341',
]

export function emptyState() {
  const now = new Date().toISOString()
  return {
    schema: DATA_SCHEMA,
    appVersion: APP_VERSION,
    createdAt: now,
    updatedAt: now,
    profile: null,
    terms: [],
    courses: [],
    schedule: [],
    exams: [],
    grades: [],
    selectedCourses: [],
    academicProgress: null,
    // Structured, read-only JWGLXT pages outside the fast-path datasets. The
    // adapter never stores raw HTML or request payloads here.
    academicExtras: emptyAcademicExtras(),
    // The current-major cultivation plan is an extracted local PDF document.
    // It is isolated from academicExtras so its page text cannot be mistaken
    // for scraped table rows or sent through the public feed by accident.
    academicPlanDocument: null,
    assignments: [],
    workspaces: [],
    notices: [],
    emails: [],
    dataCatalog: emptyDataCatalog(),
    sync: {
      lastStartedAt: null,
      lastCompletedAt: null,
      lastRunAt: null,
      lastSuccessAt: null,
      lastError: null,
      sources: {},
      domains: {},
      runId: null,
    },
    settings: {
      apiPort: 8765,
      syncIntervalMinutes: 30,
      autoSync: false,
      openOriginalInApp: true,
      academicAuthMode: 'api',
      academicApiEnabled: false,
      mail: {
        enabled: false,
        pollIntervalMinutes: 5,
      },
      modelBaseUrl: '',
      modelProvider: 'openai-compatible',
      modelName: '',
      modelModels: [],
      modelRouting: {
        advisorFastModel: null,
        advisorDeepModel: null,
        courseworkModel: null,
        fallbackModel: null,
      },
      advisorConfig: {
        budgetLevel: 'high',
        permissionMode: 'read-only',
        reasoningEffort: 'medium',
        responseStyle: 'balanced',
        responseLength: 'adaptive',
        temperature: 1,
      },
    },
  }
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : []
}

function recordsOrEmpty(value) {
  return arrayOrEmpty(value).filter((item) => item && typeof item === 'object' && !Array.isArray(item))
}

function normalizeStoredDomainProvenance(value) {
  const domains = normalizeDomainProvenanceMap(value)
  for (const domain of JWGLXT_IGNORED_EXTRA_DOMAIN_NAMES) delete domains[domain]
  return domains
}

const SYNC_PAYLOAD_STATE_FIELDS = Object.freeze([
  'profile', 'terms', 'courses', 'schedule', 'exams', 'grades', 'selectedCourses',
  'academicProgress', 'academicExtras', 'academicPlanDocument', 'assignments', 'workspaces', 'notices',
  'emails', 'dataCatalog',
])

// All adapter results, including API-to-browser fallback results, cross this
// boundary before merging. It keeps source-specific omissions as omissions,
// while any supplied payload is projected through the same state contract used
// for disk recovery and local API reads.
export function normalizeSyncPayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  const source = input
  const stateInput = {}
  for (const field of SYNC_PAYLOAD_STATE_FIELDS) {
    if (Object.hasOwn(source, field) && source[field] !== undefined) stateInput[field] = source[field]
  }
  const normalizedState = normalizeState(stateInput)
  const normalized = { ...source }
  for (const field of SYNC_PAYLOAD_STATE_FIELDS) {
    if (Object.hasOwn(stateInput, field)) normalized[field] = normalizedState[field]
  }
  if (source.domainOutcomes && typeof source.domainOutcomes === 'object' && !Array.isArray(source.domainOutcomes)) {
    normalized.domainOutcomes = Object.fromEntries(Object.entries(source.domainOutcomes)
      .filter(([domain]) => !JWGLXT_IGNORED_EXTRA_DOMAIN_NAMES.includes(domain)))
  }
  return normalized
}

function normalizeEmail(item) {
  if (!item || typeof item !== 'object') return null
  const normalized = { ...item }
  if (!String(normalized.body || '').trim() && typeof item.bodyHtml === 'string') {
    const recoveredBody = plainTextFromMailHtml(item.bodyHtml)
    if (recoveredBody) normalized.body = recoveredBody
  }
  const bodyHtml = typeof item.bodyHtml === 'string' && item.bodyHtml.trim() ? item.bodyHtml : null
  // Rich mail is rendered only after the IMAP sanitizer has stamped version 4.
  // Older snapshots can contain raw HTML (including remote images); retaining it
  // in any state/API projection would bypass the renderer's version check.
  if (item.bodyHtmlVersion !== RICH_MAIL_VERSION || !bodyHtml || unsafeRichMailMarkup(bodyHtml)) {
    normalized.bodyHtml = null
    normalized.bodyHtmlVersion = null
  } else {
    normalized.bodyHtml = bodyHtml
    normalized.bodyHtmlVersion = RICH_MAIL_VERSION
  }
  return normalized
}

function boundedInteger(value, fallback, minimum, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)))
}

function validTimestamp(value, fallback) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : fallback
}

function boundedString(value, fallback, maximumLength) {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim()
  return normalized.length <= maximumLength ? normalized : fallback
}

function reconcileCourseCategories(courses, grades) {
  const gradeCategories = new Map()
  for (const grade of grades) {
    const code = courseCodeOf(grade)
    const label = categoryLabelOf(grade)
    if (!code || !label) continue
    gradeCategories.set(
      code,
      preferredCourseCategory(gradeCategories.get(code), label, {
        replaceOnTie: Boolean(grade?.nature),
      }),
    )
  }
  return courses.map((course) => {
    if (!course || typeof course !== 'object') return course
    const gradeCategory = gradeCategories.get(courseCodeOf(course))
    const category = preferredCourseCategory(course.category, gradeCategory, {
      replaceOnTie: Boolean(gradeCategory),
    })
    return category === course.category ? course : { ...course, category }
  })
}

function storedModelBaseUrl(value) {
  try {
    return normalizeModelServiceBaseUrl(value)
  } catch {
    return ''
  }
}

function scheduleColorKey(item) {
  return [item?.courseId, item?.title].filter(Boolean).join('\u0000')
}

function assignScheduleColors(schedule) {
  const groups = new Map()
  for (const item of schedule) {
    if (!item || typeof item !== 'object') continue
    const termId = String(item.termId || '__legacy__')
    if (!groups.has(termId)) groups.set(termId, [])
    groups.get(termId).push(item)
  }
  return [...groups.values()].flatMap((items) => {
    const courseKeys = [...new Set(items.map(scheduleColorKey).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    const colors = new Map(courseKeys.map((key, index) => [key, SCHEDULE_ACCENTS[index % SCHEDULE_ACCENTS.length]]))
    return items.map((item) => item.color ? item : { ...item, color: colors.get(scheduleColorKey(item)) || SCHEDULE_ACCENTS[0] })
  })
}

export function normalizeState(input) {
  const base = emptyState()
  const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const grades = recordsOrEmpty(value.grades)
  const rawSync = value.sync && typeof value.sync === 'object' ? value.sync : {}
  const rawSettings = value.settings && typeof value.settings === 'object' ? value.settings : {}
  const lastCompletedAt = typeof rawSync.lastCompletedAt === 'string' ? rawSync.lastCompletedAt : null
  const hasLastRunAt = Object.prototype.hasOwnProperty.call(rawSync, 'lastRunAt')
  const hasLastSuccessAt = Object.prototype.hasOwnProperty.call(rawSync, 'lastSuccessAt')
  const lastRunAt = hasLastRunAt
    ? (typeof rawSync.lastRunAt === 'string' ? rawSync.lastRunAt : null)
    : lastCompletedAt
  const lastSuccessAt = hasLastSuccessAt
    ? (typeof rawSync.lastSuccessAt === 'string' ? rawSync.lastSuccessAt : null)
    : (!rawSync.lastError ? lastCompletedAt : null)
  return {
    schema: DATA_SCHEMA,
    appVersion: APP_VERSION,
    createdAt: validTimestamp(value.createdAt, base.createdAt),
    updatedAt: validTimestamp(value.updatedAt, base.updatedAt),
    profile: value.profile && typeof value.profile === 'object' ? value.profile : null,
    terms: recordsOrEmpty(value.terms),
    courses: reconcileCourseCategories(recordsOrEmpty(value.courses), grades),
    schedule: assignScheduleColors(recordsOrEmpty(value.schedule)),
    exams: recordsOrEmpty(value.exams),
    grades,
    selectedCourses: recordsOrEmpty(value.selectedCourses),
    academicProgress: normalizeAcademicProgress(value.academicProgress),
    academicExtras: normalizeAcademicExtras(value.academicExtras),
    academicPlanDocument: normalizeAcademicPlanDocument(value.academicPlanDocument),
    assignments: recordsOrEmpty(value.assignments),
    workspaces: recordsOrEmpty(value.workspaces),
    notices: recordsOrEmpty(value.notices),
    emails: recordsOrEmpty(value.emails).map(normalizeEmail).filter(Boolean).slice(0, 500),
    dataCatalog: normalizeDataCatalog(value.dataCatalog),
    sync: sanitizeDiagnosticValue({
      ...base.sync,
      ...rawSync,
      lastCompletedAt,
      lastRunAt,
      lastSuccessAt,
      domains: normalizeStoredDomainProvenance(rawSync.domains),
    }),
    settings: {
      apiPort: boundedInteger(rawSettings.apiPort, base.settings.apiPort, 1024, 65535),
      syncIntervalMinutes: boundedInteger(rawSettings.syncIntervalMinutes, base.settings.syncIntervalMinutes, 5, 1440),
      autoSync: typeof rawSettings.autoSync === 'boolean' ? rawSettings.autoSync : base.settings.autoSync,
      openOriginalInApp: typeof rawSettings.openOriginalInApp === 'boolean' ? rawSettings.openOriginalInApp : base.settings.openOriginalInApp,
      academicAuthMode: rawSettings.academicAuthMode === 'api' ? 'api' : 'unified',
      academicApiEnabled: rawSettings.academicApiEnabled === true,
      mail: {
        enabled: rawSettings.mail?.enabled === true,
        pollIntervalMinutes: boundedInteger(rawSettings.mail?.pollIntervalMinutes, base.settings.mail.pollIntervalMinutes, 1, 60),
      },
      modelBaseUrl: storedModelBaseUrl(rawSettings.modelBaseUrl),
      modelProvider: ['openai-compatible', 'anthropic-messages', 'gemini-generate-content', 'ollama-chat'].includes(rawSettings.modelProvider)
        ? rawSettings.modelProvider
        : 'openai-compatible',
      modelName: boundedString(rawSettings.modelName, base.settings.modelName, 300),
      modelModels: arrayOrEmpty(rawSettings.modelModels)
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item && item.length <= 300)
        .slice(0, 300),
      modelRouting: {
        advisorFastModel: boundedString(rawSettings.modelRouting?.advisorFastModel, '', 300) || null,
        advisorDeepModel: boundedString(rawSettings.modelRouting?.advisorDeepModel, '', 300) || null,
        courseworkModel: boundedString(rawSettings.modelRouting?.courseworkModel, '', 300) || null,
        fallbackModel: boundedString(rawSettings.modelRouting?.fallbackModel, '', 300) || null,
      },
      advisorConfig: {
        budgetLevel: ['high', 'xhigh', 'max', 'ultra'].includes(rawSettings.advisorConfig?.budgetLevel)
          ? rawSettings.advisorConfig.budgetLevel
          : 'high',
        permissionMode: ['read-only', 'full-access'].includes(rawSettings.advisorConfig?.permissionMode)
          ? rawSettings.advisorConfig.permissionMode
          : 'read-only',
        reasoningEffort: ['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(rawSettings.advisorConfig?.reasoningEffort)
          ? rawSettings.advisorConfig.reasoningEffort
          : 'medium',
        responseStyle: ['direct', 'balanced', 'detailed'].includes(rawSettings.advisorConfig?.responseStyle)
          ? rawSettings.advisorConfig.responseStyle
          : 'balanced',
        responseLength: ['adaptive', 'short', 'standard', 'detailed'].includes(rawSettings.advisorConfig?.responseLength)
          ? rawSettings.advisorConfig.responseLength
          : 'adaptive',
        temperature: typeof rawSettings.advisorConfig?.temperature === 'number' && Number.isFinite(rawSettings.advisorConfig.temperature)
          ? Math.max(0, Math.min(2, rawSettings.advisorConfig.temperature))
          : 1,
      },
    },
  }
}

export function counts(state) {
  return {
    courses: state.courses.length,
    schedule: state.schedule.length,
    exams: state.exams.length,
    grades: state.grades.length,
    selectedCourses: state.selectedCourses.length,
    assignments: state.assignments.length,
    notices: state.notices.length,
    emails: state.emails.length,
    academicExtras: Object.values(state.academicExtras?.domains || {}).reduce((total, domain) => total + (domain.records?.length || 0), 0),
  }
}

export function mergeSyncResult(state, result) {
  const next = normalizeState(state)
  for (const key of ['profile', 'terms', 'courses', 'schedule', 'exams', 'grades', 'selectedCourses', 'academicProgress', 'academicExtras', 'assignments', 'notices']) {
    if (result[key] === undefined) continue
    if (key === 'academicExtras') {
      next.academicExtras = {
        ...next.academicExtras,
        ...result.academicExtras,
        domains: {
          ...(next.academicExtras?.domains || {}),
          ...(result.academicExtras?.domains || {}),
        },
      }
    } else next[key] = result[key]
  }
  // API enrichment may be temporarily unavailable while the summary response
  // still contains the ordered Zhengfang requirements. Normalize after the
  // assignment above so a later sync cannot replace the displayed tree with
  // the raw flat list and make the academic view remount between structures.
  next.academicProgress = normalizeAcademicProgress(next.academicProgress)
  next.academicExtras = normalizeAcademicExtras(next.academicExtras)
  const completedAt = result.completed === true
    ? (result.completedAt || new Date().toISOString())
    : null
  next.sync = {
    ...next.sync,
    lastError: result.errors?.length ? result.errors.join('; ') : null,
    sources: result.sources || next.sync.sources,
    domains: result.domains ? normalizeDomainProvenanceMap(result.domains) : next.sync.domains,
    runId: result.runId || next.sync.runId,
    ...(completedAt ? {
      lastCompletedAt: completedAt,
      lastRunAt: completedAt,
      ...(!result.errors?.length ? { lastSuccessAt: completedAt } : {}),
    } : {}),
  }
  next.updatedAt = new Date().toISOString()
  return next
}

export function toTheiaFeed(state) {
  const generatedAt = new Date().toISOString()
  const workspaces = new Map((state.workspaces || []).map((item) => [item.assignmentId, item]))
  const events = []
  for (const item of state.schedule) {
    if (!item.title || !item.startAt) continue
    events.push({
      id: `theia:schedule:${item.id}`,
      version: 1,
      kind: 'calendar',
      source: 'theia',
      startAt: item.startAt,
      endAt: item.endAt,
      title: item.title,
      summary: [item.teacher, item.room, item.weeks].filter(Boolean).join(' · '),
      values: {
        weekday: item.weekday,
        period: item.period,
        courseId: item.courseId,
        termId: item.termId,
      },
      capturedAt: item.capturedAt || generatedAt,
      privacy: 'coarse',
      sourceUrl: item.sourceUrl,
    })
  }
  for (const item of state.exams) {
    const startAt = item.startAt || item.examTime || generatedAt
    events.push({
      id: `theia:exam:${item.id}`,
      version: 1,
      kind: 'calendar',
      source: 'theia',
      startAt,
      endAt: item.endAt,
      title: `${item.courseName || '考试'} · 考试`,
      summary: [item.location, item.campus, item.seat ? `座位 ${item.seat}` : ''].filter(Boolean).join(' · '),
      values: { courseId: item.courseId, termId: item.termId, examType: item.examType },
      capturedAt: item.capturedAt || generatedAt,
      privacy: 'coarse',
      sourceUrl: item.sourceUrl,
    })
  }
  for (const item of state.assignments) {
    events.push({
      id: `theia:assignment:${item.id}`,
      version: 1,
      kind: 'activity',
      source: 'theia',
      startAt: item.dueAt || generatedAt,
      title: item.title || '课程作业',
      summary: [item.courseName, item.status, item.score ? `得分 ${item.score}` : ''].filter(Boolean).join(' · '),
      values: { courseId: item.courseId, status: item.status, dueAt: item.dueAt },
      capturedAt: item.capturedAt || generatedAt,
      privacy: 'coarse',
      sourceUrl: item.sourceUrl,
    })
  }
  return {
    schema: THEIA_FEED_SCHEMA,
    generatedAt,
    producer: { name: 'THEIA', version: APP_VERSION, layout: 'normalized-campus-v1' },
    source: { account: state.profile?.studentId ? stableId(state.profile.studentId) : null },
    profile: state.profile,
    events,
    tasks: state.assignments.map((item) => ({
      id: item.id,
      title: item.title,
      dueAt: item.dueAt,
      status: item.status,
      courseName: item.courseName,
      sourceUrl: item.sourceUrl,
      work: workspaces.has(item.id) ? {
        state: workspaces.get(item.id).state,
        preparedAt: workspaces.get(item.id).preparedAt,
        updatedAt: workspaces.get(item.id).updatedAt,
        manifestPath: workspaces.get(item.id).manifestPath,
        taskPath: workspaces.get(item.id).taskPath,
        answerKeyPath: workspaces.get(item.id).answerKeyPath,
        submissionPath: workspaces.get(item.id).submissionPath,
        questionCount: workspaces.get(item.id).questionCount || 0,
      } : null,
    })),
    academic: {
      terms: state.terms,
      courses: state.courses,
      schedule: state.schedule,
      grades: state.grades,
      selectedCourses: state.selectedCourses,
      academicProgress: state.academicProgress,
      academicExtras: state.academicExtras,
      exams: state.exams,
      assignments: state.assignments,
      workspaces: state.workspaces || [],
      notices: state.notices,
    },
    // Source-tagged local records are deliberately separate from the academic
    // feed. Advisor features can consume them without re-scraping a platform.
    localData: {
      ...state.dataCatalog,
      mail: { messages: state.emails },
    },
  }
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value)
  // Neutralize spreadsheet formula injection prefixes and keep carriage
  // returns inside a quoted cell so the row structure cannot be broken.
  const guarded = /^[=+\-@]/u.test(text) ? `'${text}` : text
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

export function collectionCsv(state, collection) {
  const items = Array.isArray(state[collection]) ? state[collection] : []
  const keys = [...new Set(items.flatMap((item) => Object.keys(item || {})))].filter((key) => key !== 'raw')
  return [keys.map(csvEscape).join(','), ...items.map((item) => keys.map((key) => csvEscape(item?.[key])).join(','))].join('\r\n') + '\r\n'
}

function icsEscape(value) {
  return String(value ?? '').replace(/[\\;,\n\r]/g, (match) => ({ '\\': '\\\\', ';': '\\;', ',': '\\,', '\n': '\\n', '\r': '\\r' }[match]))
}

function icsDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

export function toIcs(state) {
  const now = new Date().toISOString()
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//THEIA//Campus Client//CN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:THEIA 校园日历']
  for (const item of [...state.exams, ...state.assignments]) {
    const start = icsDate(item.startAt || item.examTime || item.dueAt)
    if (!start) continue
    const end = icsDate(item.endAt || new Date(new Date(item.startAt || item.examTime || item.dueAt).getTime() + 60 * 60 * 1000).toISOString())
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${icsEscape(`theia-${item.id}`)}`)
    lines.push(`DTSTAMP:${icsDate(now)}`)
    lines.push(`DTSTART:${start}`)
    if (end) lines.push(`DTEND:${end}`)
    lines.push(`SUMMARY:${icsEscape(item.courseName ? `${item.courseName} · ${item.title || (item.examType ? '考试' : '事项')}` : item.title || 'THEIA事项')}`)
    lines.push(`DESCRIPTION:${icsEscape([item.location, item.campus, item.status, item.sourceUrl].filter(Boolean).join(' · '))}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}
