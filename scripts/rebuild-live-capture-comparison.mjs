import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(process.argv[2] || '')
if (!root || root === resolve('.')) throw new Error('usage: node scripts/rebuild-live-capture-comparison.mjs <capture-directory>')

const browser = JSON.parse(await readFile(resolve(root, 'browser-result.json'), 'utf8'))
const api = JSON.parse(await readFile(resolve(root, 'api-result.json'), 'utf8'))
const fields = {
  profile: 'profile',
  terms: 'terms',
  courses: 'courses',
  schedule: 'schedule',
  grades: 'grades',
  exams: 'exams',
  'selected-courses': 'selectedCourses',
  'academic-progress': 'academicProgress',
  notices: 'notices',
}
for (const domain of Object.keys(browser.result?.academicExtras?.domains || {})) fields[domain] = 'academicExtras'
for (const domain of Object.keys(api.result?.academicExtras?.domains || {})) fields[domain] = 'academicExtras'

function count(value) {
  if (Array.isArray(value)) return value.length
  if (!value || typeof value !== 'object') return 0
  if (Array.isArray(value.records)) return value.records.length
  if (Array.isArray(value.items)) return value.items.length
  if (Array.isArray(value.categories)) return value.categories.length
  if (Array.isArray(value.roots)) return value.roots.length
  return Object.keys(value).length
}

function paths(value, prefix = '', output = new Set(), depth = 0) {
  if (value === null || value === undefined || depth > 7) return output
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 100)) paths(item, `${prefix}[]`, output, depth + 1)
    return output
  }
  if (typeof value !== 'object') return output
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    output.add(path)
    paths(child, path, output, depth + 1)
  }
  return output
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

// Transport provenance is intentionally retained in the raw digest, but it
// should not make otherwise identical records look different across the two
// clients. The school also regenerates PDF metadata (timestamps and IDs) per
// request, so comparison needs a stable content view as well.
const NON_CONTENT_KEYS = new Set([
  'attachments',
  'capturedAt',
  'filters',
  'messages',
  'queryStats',
  'source',
  'sourceUrl',
])
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !NON_CONTENT_KEYS.has(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  )
}

function contentDigest(value) {
  return digest(canonicalize(value))
}

function summary(capture, domain) {
  const field = fields[domain]
  const value = field === 'academicExtras'
    ? capture?.result?.academicExtras?.domains?.[domain]
    : capture?.result?.[field]
  const outcome = capture?.result?.domainOutcomes?.[domain] || null
  return {
    outcome,
    count: count(value),
    fields: [...paths(value)].sort(),
    digest: digest(value),
    contentDigest: contentDigest(value),
    hasPayload: value !== undefined,
  }
}

const domains = [...new Set([
  ...Object.keys(browser.result?.domainOutcomes || {}),
  ...Object.keys(api.result?.domainOutcomes || {}),
  ...Object.keys(fields),
])].sort()
const entries = Object.fromEntries(domains.map((domain) => {
  const browserSummary = summary(browser, domain)
  const apiSummary = summary(api, domain)
  const browserFields = new Set(browserSummary.fields)
  const apiFields = new Set(apiSummary.fields)
  return [domain, {
    browser: browserSummary,
    api: apiSummary,
    differences: {
      countDelta: browserSummary.count - apiSummary.count,
      browserOnlyFields: browserSummary.fields.filter((field) => !apiFields.has(field)),
      apiOnlyFields: apiSummary.fields.filter((field) => !browserFields.has(field)),
      digestEqual: browserSummary.digest === apiSummary.digest,
      contentDigestEqual: browserSummary.contentDigest === apiSummary.contentDigest,
    },
  }]
}))

const comparison = {
  schema: 'theia-live-capture-comparison/v2',
  capturedAt: new Date().toISOString(),
  sourceRuns: {
    browser: { mode: browser.mode, startedAt: browser.startedAt, completedAt: browser.completedAt, elapsedMs: browser.elapsedMs },
    api: { mode: api.mode, startedAt: api.startedAt, completedAt: api.completedAt, elapsedMs: api.elapsedMs },
  },
  domains: entries,
  totals: {
    browserErrors: browser.result?.errors?.length || 0,
    apiErrors: api.result?.errors?.length || 0,
    browserSucceeded: Object.values(browser.result?.domainOutcomes || {}).filter((item) => item?.succeeded === true).length,
    apiSucceeded: Object.values(api.result?.domainOutcomes || {}).filter((item) => item?.succeeded === true).length,
  },
}
await writeFile(resolve(root, 'comparison.json'), `${JSON.stringify(comparison, null, 2)}\n`, 'utf8')
process.stdout.write(JSON.stringify({ root, domains: domains.length, browserElapsedMs: browser.elapsedMs, apiElapsedMs: api.elapsedMs }, null, 2))
