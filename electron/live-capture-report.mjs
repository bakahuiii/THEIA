import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES } from '../core/jwglxt-extra.mjs'

const LIVE_CAPTURE_FIELDS = Object.freeze({
  profile: 'profile',
  terms: 'terms',
  courses: 'courses',
  schedule: 'schedule',
  grades: 'grades',
  exams: 'exams',
  'selected-courses': 'selectedCourses',
  'academic-progress': 'academicProgress',
  notices: 'notices',
  ...Object.fromEntries(JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES.map((domain) => [domain, 'academicExtras'])),
})

function liveCaptureCount(value) {
  if (Array.isArray(value)) return value.length
  if (!value || typeof value !== 'object') return 0
  if (Array.isArray(value.records)) return value.records.length
  if (Array.isArray(value.items)) return value.items.length
  if (Array.isArray(value.categories)) return value.categories.length
  if (Array.isArray(value.roots)) return value.roots.length
  return Object.keys(value).length
}

function liveCaptureFieldPaths(value, prefix = '', output = new Set(), depth = 0) {
  if (value === null || value === undefined || depth > 7) return output
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 100)) liveCaptureFieldPaths(item, `${prefix}[]`, output, depth + 1)
    return output
  }
  if (typeof value !== 'object') return output
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    output.add(path)
    liveCaptureFieldPaths(child, path, output, depth + 1)
  }
  return output
}

function liveCaptureDigest(value) {
  try {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex')
  } catch {
    return null
  }
}

export function liveCaptureResultCounts(result) {
  const extras = result?.academicExtras?.domains || {}
  const academicProgress = result?.academicProgress
  return {
    profileFields: result?.profile && typeof result.profile === 'object' ? Object.keys(result.profile).length : 0,
    terms: Array.isArray(result?.terms) ? result.terms.length : 0,
    courses: Array.isArray(result?.courses) ? result.courses.length : 0,
    schedule: Array.isArray(result?.schedule) ? result.schedule.length : 0,
    grades: Array.isArray(result?.grades) ? result.grades.length : 0,
    exams: Array.isArray(result?.exams) ? result.exams.length : 0,
    selectedCourses: Array.isArray(result?.selectedCourses) ? result.selectedCourses.length : 0,
    notices: Array.isArray(result?.notices) ? result.notices.length : 0,
    academicProgressCategories: Array.isArray(academicProgress?.categories) ? academicProgress.categories.length : 0,
    academicProgressRoots: Array.isArray(academicProgress?.roots) ? academicProgress.roots.length : 0,
    academicExtras: Object.fromEntries(Object.entries(extras).map(([domain, value]) => [domain, {
      records: Array.isArray(value?.records) ? value.records.length : 0,
      attachments: Array.isArray(value?.attachments) ? value.attachments.length : 0,
      completeness: value?.completeness || 'unknown',
      queryStats: value?.queryStats || null,
    }])),
    domainOutcomes: result?.domainOutcomes || {},
    errors: Array.isArray(result?.errors) ? result.errors : [],
  }
}

function liveCaptureDomainSummary(result, domain) {
  const field = LIVE_CAPTURE_FIELDS[domain]
  const outcome = result?.domainOutcomes?.[domain] || null
  const value = field === 'academicExtras' ? result?.academicExtras?.domains?.[domain] : result?.[field]
  const fields = [...liveCaptureFieldPaths(value)].sort()
  return {
    outcome,
    count: liveCaptureCount(value),
    fields,
    digest: liveCaptureDigest(value),
    hasPayload: value !== undefined,
  }
}

export function compareLiveCaptureResults(browser, api) {
  const domains = [...new Set([
    ...Object.keys(browser?.result?.domainOutcomes || {}),
    ...Object.keys(api?.result?.domainOutcomes || {}),
    ...Object.keys(LIVE_CAPTURE_FIELDS),
  ])].sort()
  const entries = Object.fromEntries(domains.map((domain) => {
    const browserSummary = liveCaptureDomainSummary(browser?.result, domain)
    const apiSummary = liveCaptureDomainSummary(api?.result, domain)
    const browserFields = new Set(browserSummary.fields)
    const apiFields = new Set(apiSummary.fields)
    return [domain, {
      browser: browserSummary,
      api: apiSummary,
      differences: {
        countDelta: browserSummary.count - apiSummary.count,
        browserOnlyFields: browserSummary.fields.filter((field) => !apiFields.has(field)),
        apiOnlyFields: apiSummary.fields.filter((field) => !browserFields.has(field)),
        digestEqual: Boolean(browserSummary.digest && apiSummary.digest && browserSummary.digest === apiSummary.digest),
      },
    }]
  }))
  return {
    schema: 'theia-live-capture-comparison/v2',
    capturedAt: new Date().toISOString(),
    domains: entries,
    totals: {
      browserErrors: browser?.result?.errors?.length || 0,
      apiErrors: api?.result?.errors?.length || 0,
      browserSucceeded: Object.values(browser?.result?.domainOutcomes || {}).filter((item) => item?.succeeded === true).length,
      apiSucceeded: Object.values(api?.result?.domainOutcomes || {}).filter((item) => item?.succeeded === true).length,
    },
  }
}

export function createLiveCaptureAttachmentStore(root, label) {
  return {
    async find() { return null },
    async save({ id, extension = 'bin', buffer }) {
      const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '')
      const digest = createHash('sha256').update(bytes).digest('hex')
      const filename = `${String(id || 'attachment').replace(/[^a-zA-Z0-9._-]+/g, '_')}.${String(extension || 'bin').replace(/[^a-zA-Z0-9._-]+/g, '_')}`
      const directory = resolve(root, 'attachments', label)
      await mkdir(directory, { recursive: true })
      const file = resolve(directory, filename)
      await writeFile(file, bytes)
      return { id, bytes: bytes.length, sha256: digest, filename, path: file }
    },
  }
}

export async function writeLiveCaptureJson(root, name, value) {
  await mkdir(root, { recursive: true })
  await writeFile(resolve(root, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
