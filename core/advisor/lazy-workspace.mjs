import { canonicalDigest, canonicalJson, compareCanonicalText, parseCampusInstant } from './canonical.mjs'
import { freezeRequestCatalog } from './citation-verifier.mjs'
import { buildAcademicAnalysis } from '../academic-model.mjs'
import { JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES, JWGLXT_EXTRA_DOMAINS } from '../jwglxt-extra.mjs'
import { createAcademicWorkspaceProjection } from './lazy-workspace-academic.mjs'
import {
  compactObject,
  controlled,
  finite,
  instant,
  projectAcademicCalendar,
  projectAcademicExtra,
  projectAssignment,
  projectCourse,
  projectExam,
  projectFitness,
  projectGrade,
  projectMailbox,
  projectNotice,
  projectProfile,
  projectSchedule,
  safeTree,
  text,
} from './lazy-workspace-projections.mjs'

const TOOL_RESULT_SCHEMA = 'theia-advisor-tool-result/v1'
const UNTRUSTED_REFERENCE_SCHEMA = 'theia-advisor-untrusted-reference/v1'
const SAFE_RECORD_SCHEMA = 'theia-advisor-selected-entity/v1'
const MAX_TOOL_RESULTS = 12

export const ADVISOR_LAZY_TOOL_NAMES = Object.freeze([
  'get_data_health',
  'search_campus_records',
  'search_local_facts',
  'list_deadlines',
  'inspect_academic_progress',
  'inspect_course_analysis',
  'read_message',
])

const DOMAIN_LABELS = Object.freeze({
  profile: '学籍档案',
  assignments: '作业与测试',
  exams: '考试',
  grades: '成绩',
  'academic-progress': '学业进度',
  courses: '课程',
  schedule: '课表',
  'selected-courses': '已选课程',
  notices: '校园通知',
  mailbox: '校园邮箱',
  fitness: '体测',
  'academic-calendar': '校历',
  'school-schedule': '全校课表',
  'course-selection': '抢课目标',
  ...Object.fromEntries(JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES.map((domain) => [domain, JWGLXT_EXTRA_DOMAINS[domain]?.label || domain])),
})


function sourceEntries(state) {
  const catalog = state?.dataCatalog?.collections || {}
  const fitness = Object.values(catalog.fitness?.records || {}).map((entry) => ({ raw: entry, project: projectFitness }))
  const calendarRecord = projectAcademicCalendar(catalog.academicCalendar)
  const calendar = calendarRecord ? [{ raw: catalog.academicCalendar, project: projectAcademicCalendar }] : []
  const schoolSchedule = Object.values(catalog.schoolSchedule?.records || {}).map((entry) => ({ raw: entry, project: safeTree }))
  const selection = catalog.courseSelection ? [{ raw: catalog.courseSelection, project: safeTree }] : []
  const academicExtras = Object.fromEntries(Object.entries(state?.academicExtras?.domains || {}).map(([domain, collection]) => [
    domain,
    [
      ...(Array.isArray(collection?.records) ? collection.records : []).map((raw) => ({ raw, project: (value) => projectAcademicExtra(value, domain) })),
      ...(Array.isArray(collection?.messages) && collection.messages.length ? [{
        raw: { id: `${domain}:messages`, title: collection.label, messages: collection.messages },
        project: (value) => projectAcademicExtra(value, domain),
      }] : []),
    ],
  ]))
  return {
    profile: state?.profile ? [{ raw: state.profile, project: projectProfile }] : [],
    assignments: (Array.isArray(state?.assignments) ? state.assignments : []).map((raw) => ({ raw, project: projectAssignment })),
    exams: (Array.isArray(state?.exams) ? state.exams : []).map((raw) => ({ raw, project: projectExam })),
    grades: (Array.isArray(state?.grades) ? state.grades : []).map((raw) => ({ raw, project: projectGrade })),
    courses: (Array.isArray(state?.courses) ? state.courses : []).map((raw) => ({ raw, project: projectCourse })),
    schedule: (Array.isArray(state?.schedule) ? state.schedule : []).map((raw) => ({ raw, project: projectSchedule })),
    'selected-courses': (Array.isArray(state?.selectedCourses) ? state.selectedCourses : []).map((raw) => ({ raw, project: projectCourse })),
    notices: (Array.isArray(state?.notices) ? state.notices : []).map((raw) => ({ raw, project: projectNotice })),
    mailbox: (Array.isArray(state?.emails) ? state.emails : []).map((raw) => ({ raw, project: projectMailbox })),
    fitness,
    'academic-calendar': calendar,
    'school-schedule': schoolSchedule,
    'course-selection': selection,
    ...academicExtras,
  }
}

function domainForEvidence(claim, evidenceById) {
  const domains = new Set((claim?.evidenceRefs || []).map((id) => evidenceById.get(id)?.domain).filter(Boolean))
  return domains.size === 1 ? [...domains][0] : null
}

function qualityFor(overview, domain) {
  const quality = overview?.dataQuality?.domains?.[domain] || {}
  return {
    availability: controlled(quality.availability, 'unknown'),
    freshness: controlled(quality.freshness, 'unknown'),
    completeness: controlled(quality.completeness, 'unknown'),
    capturedAt: instant(quality.capturedAt),
    source: controlled(Array.isArray(quality.source) ? quality.source[0] : quality.source),
    domainDigest: /^[a-f0-9]{64}$/iu.test(quality.contentDigest || '')
      ? quality.contentDigest.toLowerCase()
      : canonicalDigest({ domain, availability: quality.availability || 'unknown', revision: overview.snapshotRevision }),
  }
}

function recordIdentity(domain, raw, index, record) {
  return canonicalDigest({ domain, sourceId: String(raw?.id ?? raw?.yearKey ?? index), index, record }).slice(0, 24)
}

function displayRecord(domain, record) {
  const label = DOMAIN_LABELS[domain] || domain
  const fields = Object.entries(record).flatMap(([key, value]) => {
    if (Array.isArray(value)) return value.length ? [`${key}：${value.map((entry) => typeof entry === 'object' ? canonicalJson(entry) : entry).join('；')}`] : []
    if (value && typeof value === 'object') return [`${key}：${canonicalJson(value)}`]
    return value === null || value === undefined || value === '' ? [] : [`${key}：${value}`]
  })
  return text(`${label}记录：${fields.join('；')}`, 1_800) || `${label}记录已读取。`
}

function untrustedReference({ snapshotRevision, scope, domain, record }) {
  const sourceText = canonicalJson(record)
  const entityDigest = canonicalDigest({ schema: SAFE_RECORD_SCHEMA, scope, domain, record })
  return {
    schema: UNTRUSTED_REFERENCE_SCHEMA,
    id: `entity:${entityDigest.slice(0, 20)}`,
    entityDigest,
    contentDigest: canonicalDigest({ entityDigest, scope, domain, sourceText }),
    scope,
    domain,
    trust: 'untrusted',
    snapshotRevision,
    sourceText,
  }
}

function visibleRisk(risk) {
  return compactObject({
    id: risk.id,
    domain: risk.domain,
    severity: risk.severity,
    title: risk.title,
    dueAt: risk.dueAt,
    reasons: Array.isArray(risk.why) ? risk.why.slice(0, 4) : [],
    claimIds: Array.isArray(risk.claimIds) ? risk.claimIds.slice(0, 8) : [],
    confidence: risk.confidence,
  })
}

function limit(value, fallback = 6) {
  const number = Math.trunc(Number(value))
  return Number.isFinite(number) ? Math.max(1, Math.min(MAX_TOOL_RESULTS, number)) : fallback
}

function offset(value) {
  const number = Math.trunc(Number(value))
  return Number.isFinite(number) ? Math.max(0, Math.min(1_000, number)) : 0
}

function query(value) {
  return text(value, 240)?.toLocaleLowerCase() || ''
}

function matches(record, needle) {
  return !needle || canonicalJson(record).toLocaleLowerCase().includes(needle)
}

function queryParts(needle) {
  const normalized = String(needle || '').toLocaleLowerCase().trim()
  if (!normalized) return []
  const words = normalized.match(/[a-z0-9][a-z0-9._-]{1,63}/giu) || []
  const han = normalized.match(/[\u3400-\u9fff]/gu) || []
  const bigrams = han.length > 1
    ? han.slice(0, 64).flatMap((character, index) => index < han.length - 1 ? [`${character}${han[index + 1]}`] : [])
    : []
  const stopWords = new Set(['我的', '一下', '如何', '怎么', '怎样', '什么', '哪些', '可以', '请问', '现在', '是否', '有关', '情况'])
  return [...new Set([...words, ...bigrams].filter((part) => !stopWords.has(part)))].slice(0, 24)
}

function recordScore(domain, entry, needle) {
  if (!needle) return 0
  const record = entry.record || {}
  const serialized = canonicalJson(record).toLocaleLowerCase()
  const parts = queryParts(needle)
  const fullMatch = serialized.includes(needle)
  const matchedParts = parts.filter((part) => serialized.includes(part))
  if (!fullMatch && !matchedParts.length) return -1
  const weightedFields = domain === 'mailbox'
    ? ['subject', 'snippet', 'from', 'receivedAt']
    : domain === 'notices'
      ? ['title', 'summary', 'publishedAt']
      : ['courseName', 'title', 'courseCode', 'name', 'termId', 'status']
  let score = fullMatch ? (serialized.indexOf(needle) === 0 ? 20 : 10) : 0
  score += matchedParts.length * 6
  for (const [index, key] of weightedFields.entries()) {
    const value = String(record[key] ?? '').toLocaleLowerCase()
    if (!value) continue
    if (fullMatch && value.includes(needle)) score += 80 - index * 8
    for (const part of parts) if (value.includes(part)) score += 8 - Math.min(index, 5)
  }
  return score
}

function rankedRecords(entries, domain, needle) {
  return entries
    .map((entry, index) => ({
      entry,
      index,
      score: recordScore(domain, entry, needle),
      instant: parseCampusInstant(entry.record?.receivedAt || entry.record?.publishedAt || entry.record?.dueAt || entry.record?.startAt)?.iso || '',
    }))
    .filter((item) => item.score >= 0)
    .sort((left, right) => right.score - left.score
      || (needle ? 0 : right.instant.localeCompare(left.instant))
      || left.index - right.index)
    .map((item) => item.entry)
}

export function createAdvisorLazyWorkspace({ overview, state, snapshotRevision, allowedMessageIds = [] } = {}) {
  if (!overview || typeof overview !== 'object' || !state || typeof state !== 'object') {
    throw new TypeError('Lazy advisor workspace requires an overview and revision-bound state')
  }
  const revision = String(snapshotRevision || overview.snapshotRevision || '').trim()
  if (!revision || revision !== overview.snapshotRevision) throw new TypeError('Lazy advisor workspace revision is invalid')
  const rulesVersion = String(overview.rulesVersion || '').trim()
  const evaluatedAt = instant(overview.evaluatedAt)
  if (!rulesVersion || !evaluatedAt) throw new TypeError('Lazy advisor workspace identity is invalid')

  const allEvidence = new Map((Array.isArray(overview.evidence) ? overview.evidence : []).map((item) => [item.id, item]))
  const allClaims = new Map((Array.isArray(overview.claims) ? overview.claims : []).map((item) => [item.id, item]))
  const claimsByDomain = new Map()
  for (const claim of allClaims.values()) {
    const domain = domainForEvidence(claim, allEvidence)
    if (!domain) continue
    if (!claimsByDomain.has(domain)) claimsByDomain.set(domain, [])
    claimsByDomain.get(domain).push(claim)
  }
  for (const claims of claimsByDomain.values()) claims.sort((left, right) => compareCanonicalText(left.id, right.id))

  const rawEntries = sourceEntries(state)
  const academicAnalysis = buildAcademicAnalysis({
    grades: state.grades,
    courses: state.courses,
    progress: state.academicProgress,
    evaluatedAt,
  })
  const { buildCourseAnalysis, projectAcademicAnalysis } = createAcademicWorkspaceProjection({
    compactObject,
    controlled,
    finite,
    matches,
    maxToolResults: MAX_TOOL_RESULTS,
    text,
  })
  const recordsByDomain = new Map()
  const messageBodies = new Map()
  const messageGrants = new Set(Array.isArray(allowedMessageIds)
    ? allowedMessageIds.map((value) => String(value || '').trim()).filter(Boolean).slice(0, 64)
    : [])
  for (const [domain, entries] of Object.entries(rawEntries)) {
    const records = []
    for (const [index, entry] of entries.entries()) {
      const record = entry.project(entry.raw)
      if (!record || typeof record !== 'object' || Object.keys(record).length === 0) continue
      const id = `record:${domain}:${recordIdentity(domain, entry.raw, index, record)}`
      records.push({ id, domain, record, raw: entry.raw, index })
      if (domain === 'mailbox') messageBodies.set(id, entry.raw)
    }
    recordsByDomain.set(domain, records)
  }

  const disclosedClaims = new Map()
  const disclosedEvidence = new Map()
  const disclosedReferences = new Map()
  const generated = new Map()
  const generatedHealth = new Map()

  const registerClaim = (claim) => {
    if (!claim?.id || !allClaims.has(claim.id)) return
    disclosedClaims.set(claim.id, claim)
    for (const evidenceId of claim.evidenceRefs || []) {
      const evidence = allEvidence.get(evidenceId)
      if (evidence) disclosedEvidence.set(evidenceId, evidence)
    }
  }

  const generatedClaim = (entry) => {
    if (generated.has(entry.id)) return generated.get(entry.id)
    const quality = qualityFor(overview, entry.domain)
    const fieldNames = Object.keys(entry.record).filter((key) => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(key)).slice(0, 32)
    const entityId = `entity:${canonicalDigest({ domain: entry.domain, id: entry.id }).slice(0, 24)}`
    const evidence = {
      id: `evidence1:agent:${entry.domain}:${canonicalDigest({ revision, id: entry.id, fields: fieldNames }).slice(0, 24)}`,
      dataset: `agent-${entry.domain}`,
      domain: entry.domain,
      entityId,
      fields: fieldNames.length ? fieldNames : ['record'],
      disclosedFields: fieldNames.length ? fieldNames : ['record'],
      capturedAt: quality.capturedAt,
      source: quality.source,
      snapshotRevision: revision,
      domainDigest: quality.domainDigest,
      evidenceDigest: canonicalDigest({ revision, domain: entry.domain, id: entry.id, record: entry.record }),
      availability: quality.availability,
      freshness: quality.freshness,
      completeness: quality.completeness,
      label: `${DOMAIN_LABELS[entry.domain] || entry.domain} 本地记录`,
    }
    const claim = {
      id: `claim1:agent:${entry.domain}:${canonicalDigest({ revision, id: entry.id, evidence: evidence.id }).slice(0, 24)}`,
      kind: 'fact',
      subject: `record:${canonicalDigest({ domain: entry.domain, id: entry.id }).slice(0, 24)}`,
      predicate: 'local-record-read',
      value: { type: 'boolean', value: true },
      displayText: displayRecord(entry.domain, entry.record),
      evidenceRefs: [evidence.id],
      confidence: quality.availability === 'available' && quality.freshness === 'fresh' ? 'high' : 'medium',
      caveats: [],
      rulesVersion,
    }
    const pair = { claim, evidence }
    generated.set(entry.id, pair)
    return pair
  }

  const registerGenerated = (entry) => {
    const pair = generatedClaim(entry)
    disclosedClaims.set(pair.claim.id, pair.claim)
    disclosedEvidence.set(pair.evidence.id, pair.evidence)
    return pair.claim
  }

  const generatedHealthClaim = (domain) => {
    if (generatedHealth.has(domain)) return generatedHealth.get(domain)
    const quality = qualityFor(overview, domain)
    const details = inventory[domain]
    const entityId = `entity:${canonicalDigest({ revision, domain, kind: 'data-quality' }).slice(0, 24)}`
    const evidence = {
      id: `evidence1:agent:data-quality:${canonicalDigest({ revision, domain }).slice(0, 24)}`,
      dataset: 'agent-data-quality',
      domain,
      entityId,
      fields: ['availability', 'freshness', 'completeness', 'records', 'localFacts'],
      disclosedFields: ['availability', 'freshness', 'completeness', 'records', 'localFacts'],
      capturedAt: quality.capturedAt,
      source: quality.source,
      snapshotRevision: revision,
      domainDigest: quality.domainDigest,
      evidenceDigest: canonicalDigest({ revision, domain, details }),
      availability: quality.availability,
      freshness: quality.freshness,
      completeness: quality.completeness,
      label: `${DOMAIN_LABELS[domain] || domain}数据质量`,
    }
    const claim = {
      id: `claim1:agent:data-quality:${canonicalDigest({ revision, domain, evidence: evidence.id }).slice(0, 24)}`,
      kind: 'fact',
      subject: `domain:${domain}`,
      predicate: 'data-quality-read',
      value: { type: 'boolean', value: true },
      displayText: `${DOMAIN_LABELS[domain] || domain}数据状态：${quality.availability}；${quality.freshness}；${quality.completeness}。`,
      evidenceRefs: [evidence.id],
      confidence: quality.availability === 'available' && quality.freshness === 'fresh' && quality.completeness === 'complete'
        ? 'high'
        : 'medium',
      caveats: [],
      rulesVersion,
    }
    const pair = { claim, evidence }
    generatedHealth.set(domain, pair)
    return pair
  }

  const registerHealth = (domain) => {
    const pair = generatedHealthClaim(domain)
    disclosedClaims.set(pair.claim.id, pair.claim)
    disclosedEvidence.set(pair.evidence.id, pair.evidence)
    return pair.claim
  }

  const registerReference = (reference) => {
    disclosedReferences.set(reference.id, reference)
    return reference
  }

  const result = (name, data) => Object.freeze({
    schema: TOOL_RESULT_SCHEMA,
    name,
    snapshotRevision: revision,
    // Every value passed here is built by a bounded projection above. The
    // provider boundary serializes the result once; rebuilding the whole
    // object through canonical JSON on every tool call only doubled latency
    // and allocations without adding a capability or a trust boundary.
    data,
  })

  const inventory = Object.fromEntries(Object.keys(DOMAIN_LABELS).map((domain) => {
    const quality = qualityFor(overview, domain)
    const recordCount = recordsByDomain.get(domain)?.length || 0
    const factCount = claimsByDomain.get(domain)?.length || 0
    return [domain, {
      label: DOMAIN_LABELS[domain],
      availability: quality.availability,
      freshness: quality.freshness,
      completeness: quality.completeness,
      records: recordCount,
      localFacts: factCount,
    }]
  }))

  const healthDomains = (args = {}) => {
    if (args.domains === undefined) return Object.keys(inventory)
    if (!Array.isArray(args.domains) || args.domains.length > 12) throw new TypeError('Advisor health domains are invalid')
    const domains = [...new Set(args.domains.map((value) => controlled(value)).filter(Boolean))]
    if (domains.some((domain) => !Object.hasOwn(inventory, domain))) throw new TypeError('Advisor health domain is not allowed')
    return domains
  }

  const healthView = (domain) => {
    const entry = inventory[domain]
    const readable = entry.availability === 'available' || entry.availability === 'empty-confirmed'
    const needsRefresh = entry.freshness === 'stale'
      || entry.freshness === 'unknown'
      || entry.completeness === 'partial'
      || entry.completeness === 'unknown'
      || entry.availability === 'unknown'
      || entry.availability === 'absent'
    return {
      ...entry,
      // “可读取” and “需要同步” are intentionally separate. Old but
      // readable data must never be described to the user as corrupt.
      readable,
      status: readable ? 'readable' : 'not-captured',
      needsRefresh,
    }
  }

  const searchRecords = (args = {}) => {
    const domain = controlled(args.domain)
    if (!domain || !Object.hasOwn(DOMAIN_LABELS, domain)) throw new TypeError('Advisor record domain is not allowed')
    const needle = query(args.query)
    const ranked = rankedRecords(recordsByDomain.get(domain) || [], domain, needle)
    const start = offset(args.offset)
    const selected = ranked.slice(start, start + limit(args.limit))
    if (domain === 'notices' || domain === 'mailbox') {
      const scope = domain === 'notices' ? 'notices' : 'mailbox'
      const items = selected.map((entry) => {
        const reference = registerReference(untrustedReference({ snapshotRevision: revision, scope, domain, record: entry.record }))
        if (domain === 'mailbox' && (entry.raw?.body || entry.raw?.bodyHtml)) messageGrants.add(entry.id)
        return { recordId: entry.id, referenceId: reference.id, ...entry.record, bodyAvailable: domain === 'mailbox' ? Boolean(entry.raw?.body || entry.raw?.bodyHtml) : undefined }
      }).map(compactObject)
      return result('search_campus_records', { domain, query: needle || null, offset: start, trust: 'untrusted', items, omitted: Math.max(0, ranked.length - start - items.length) })
    }
    const claims = selected.map((entry) => registerGenerated(entry))
    return result('search_campus_records', {
      domain,
      query: needle || null,
      claims,
      offset: start,
      omitted: Math.max(0, ranked.length - start - claims.length),
    })
  }

  const searchFacts = (args = {}) => {
    const needle = query(args.query)
    const requestedDomain = args.domain === undefined ? null : controlled(args.domain)
    if (args.domain !== undefined && (!requestedDomain || !Object.hasOwn(DOMAIN_LABELS, requestedDomain))) {
      throw new TypeError('Advisor fact domain is not allowed')
    }
    const claims = [...allClaims.values()]
      .filter((claim) => !requestedDomain || domainForEvidence(claim, allEvidence) === requestedDomain)
      .filter((claim) => matches({ displayText: claim.displayText }, needle))
      .slice(0, limit(args.limit))
    claims.forEach(registerClaim)
    return result('search_local_facts', { domain: requestedDomain, query: needle || null, claims })
  }

  const deadlines = () => {
    const items = (Array.isArray(overview.urgentItems) ? overview.urgentItems : [])
      .filter((item) => item.domain === 'assignments' || item.domain === 'exams')
      .slice(0, MAX_TOOL_RESULTS)
    for (const item of items) for (const id of item.claimIds || []) registerClaim(allClaims.get(id))
    return result('list_deadlines', { items: items.map(visibleRisk) })
  }

  const academic = (args = {}) => {
    const needle = query(args.query)
    const maximum = limit(args.limit)
    const claims = (Array.isArray(overview.academic?.claims) ? overview.academic.claims : [])
      .concat((claimsByDomain.get('academic-progress') || []), (claimsByDomain.get('grades') || []))
      .filter((claim, index, values) => values.findIndex((entry) => entry.id === claim.id) === index)
      .filter((claim) => matches({ displayText: claim.displayText }, needle))
      .slice(0, maximum)
    claims.forEach(registerClaim)
    const risks = (Array.isArray(overview.academic?.risks) ? overview.academic.risks : [])
      .filter((risk) => matches(visibleRisk(risk), needle))
      .slice(0, maximum)
      .map(visibleRisk)
    for (const risk of risks) for (const id of risk.claimIds || []) registerClaim(allClaims.get(id))
    const requirements = Array.isArray(overview.academic?.analysis?.requirements?.nodes)
      ? overview.academic.analysis.requirements.nodes
        .filter((node) => matches({ title: text(node.title, 320) }, needle))
        .slice(0, maximum)
        .map((node) => compactObject({
        title: text(node.title, 320), relation: node.relation, completeness: node.completeness,
        required: finite(node.credits?.required), earned: finite(node.credits?.earned), remaining: finite(node.credits?.remaining),
        claimIds: Object.values(node.credits?.claimIds || {}).filter((id) => typeof id === 'string').slice(0, 6),
        }))
      : []
    for (const node of requirements) for (const id of node.claimIds || []) registerClaim(allClaims.get(id))
    return result('inspect_academic_progress', {
      query: needle || null,
      claims,
      risks,
      requirements,
      academicAnalysis: projectAcademicAnalysis(academicAnalysis, revision, maximum),
    })
  }

  const courseAnalysis = (args = {}) => {
    const needle = query(args.query)
    const maximum = limit(args.limit)
    const risks = (Array.isArray(overview.risks) ? overview.risks : [])
      .filter((item) => ['courses', 'schedule', 'selected-courses', 'course-selection'].includes(item.domain))
      .filter((item) => matches(visibleRisk(item), needle))
      .slice(0, maximum)
      .map(visibleRisk)
    for (const risk of risks) for (const id of risk.claimIds || []) registerClaim(allClaims.get(id))
    return result('inspect_course_analysis', {
      ...buildCourseAnalysis({
        analysis: academicAnalysis,
        state,
        revision,
        queryText: needle,
        maximum,
        requestedTermId: args.termId,
      }),
      risks,
    })
  }

  const readMessage = (args = {}) => {
    const recordId = String(args.recordId || '').trim()
    if (!messageGrants.has(recordId)) throw new TypeError('Mailbox message must be selected by search first')
    const raw = messageBodies.get(recordId)
    if (!raw) throw new TypeError('Mailbox message is not available in this revision-bound snapshot')
    const record = projectMailbox(raw, { body: true })
    if (!record.body) throw new TypeError('Mailbox message body is not available locally')
    const reference = registerReference(untrustedReference({ snapshotRevision: revision, scope: 'mail-body', domain: 'mailbox', record }))
    return result('read_message', { recordId, referenceId: reference.id, trust: 'untrusted', message: record })
  }

  const tools = Object.freeze({
    get_data_health(args = {}) {
      const domains = healthDomains(args)
      const claims = domains.map(registerHealth)
      const health = Object.fromEntries(domains.map((domain) => [domain, healthView(domain)]))
      const readableDomains = domains.filter((domain) => health[domain].readable)
      const needsRefreshDomains = domains.filter((domain) => health[domain].needsRefresh)
      return result('get_data_health', {
        summary: {
          readableDomains,
          needsRefreshDomains,
          statement: '可读取不等于最新；需要同步只表示新鲜度或完整性需要确认，不表示本地数据损坏。',
        },
        domains: health,
        claims,
      })
    },
    search_campus_records: searchRecords,
    search_local_facts: searchFacts,
    list_deadlines: deadlines,
    inspect_academic_progress: academic,
    inspect_course_analysis: courseAnalysis,
    read_message: readMessage,
  })

  return Object.freeze({
    inventory: Object.freeze(inventory),
    tools,
    catalog() {
      return freezeRequestCatalog({
        snapshotRevision: revision,
        evaluatedAt,
        rulesVersion,
        claims: [...disclosedClaims.values()],
        evidence: [...disclosedEvidence.values()],
        actions: [],
        untrustedReferences: [...disclosedReferences.values()],
      })
    },
  })
}
