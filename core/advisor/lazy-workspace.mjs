import { canonicalDigest, canonicalJson, compareCanonicalText, parseCampusInstant } from './canonical.mjs'
import { freezeRequestCatalog } from './citation-verifier.mjs'
import { htmlToSafeText, projectAttachmentMetadata } from './notice-mail-context.mjs'
import { sanitizeAdvisorUntrustedText } from './redaction.mjs'
import { buildAcademicAnalysis } from '../academic-model.mjs'
import { JWGLXT_ACTIVE_EXTRA_DOMAIN_NAMES, JWGLXT_EXTRA_DOMAINS } from '../jwglxt-extra.mjs'

const TOOL_RESULT_SCHEMA = 'theia-advisor-tool-result/v1'
const UNTRUSTED_REFERENCE_SCHEMA = 'theia-advisor-untrusted-reference/v1'
const SAFE_RECORD_SCHEMA = 'theia-advisor-selected-entity/v1'
const MAX_TOOL_RESULTS = 12
const MAX_MESSAGE_BODY_CHARS = 8_000

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

const FORBIDDEN_FIELD = /(?:^|-)(password|secret|token|cookie|session|authorization|credential|api-key|url|uri|path|html|binary|content|attachment-content)(?:-|$)/u
const GENERIC_FIELDS = Object.freeze([
  'title', 'name', 'label', 'courseName', 'courseCode', 'code', 'termId', 'term', 'teacher',
  'credits', 'category', 'nature', 'location', 'room', 'time', 'weekday', 'period', 'weeks',
  'startAt', 'endAt', 'dueAt', 'examTime', 'examType', 'score', 'point', 'status', 'remark',
  'assessment', 'seat', 'campus', 'mode', 'capacity', 'enrolled', 'waiting', 'kind', 'state',
])

function text(value, maximum = 1_000) {
  // Untrusted campus text (mail bodies, notices, remarks) must pass the full
  // advisor redaction policy — not just URL stripping — so paths, credentials,
  // cookies and API-key shaped strings cannot reach the model observation.
  return sanitizeAdvisorUntrustedText(value, { maxLength: maximum }) || null
}

function instant(value) {
  return parseCampusInstant(value)?.iso || null
}

function finite(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function controlled(value, fallback = null) {
  const result = String(value ?? '').normalize('NFC').trim().toLowerCase()
  return /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(result) ? result : fallback
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined && entry !== ''))
}

function normalizedFieldName(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replace(/_/gu, '-')
    .toLowerCase()
}

function safeTree(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return null
  if (typeof value === 'string') return text(value, 500)
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 16).map((entry) => safeTree(entry, depth + 1)).filter((entry) => entry !== null)
  if (!value || typeof value !== 'object') return null
  const output = {}
  for (const [key, entry] of Object.entries(value).slice(0, 32)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(key) || FORBIDDEN_FIELD.test(normalizedFieldName(key))) continue
    const projected = safeTree(entry, depth + 1)
    if (projected !== null && !(Array.isArray(projected) && projected.length === 0)) output[key] = projected
  }
  return Object.keys(output).length ? output : null
}

function shallowRecord(raw, fields = GENERIC_FIELDS) {
  const output = {}
  for (const key of fields) {
    const value = raw?.[key]
    if (value === null || value === undefined || value === '') continue
    if (key.endsWith('At') || key === 'examTime') {
      output[key] = instant(value) || text(value, 120)
      continue
    }
    if (typeof value === 'number') {
      if (Number.isFinite(value)) output[key] = value
      continue
    }
    if (typeof value === 'boolean') {
      output[key] = value
      continue
    }
    output[key] = text(value, 500)
  }
  return compactObject(output)
}

function projectProfile(profile) {
  if (!profile || typeof profile !== 'object') return null
  const track = Array.isArray(profile.academicTrack)
    ? profile.academicTrack.map((entry) => text(entry, 160)).filter(Boolean).slice(0, 8)
    : text(profile.academicTrack, 160)
  return compactObject({
    name: text(profile.name, 120),
    studentId: text(profile.studentId, 120),
    department: text(profile.department || profile.college || profile.faculty, 160),
    major: text(profile.major || profile.programme || profile.program, 160),
    grade: text(profile.grade || profile.academicGrade || profile.entryYear || profile.admissionYear, 80),
    academicTrack: Array.isArray(track) ? (track.length ? track : null) : track,
    academicClass: text(profile.academicClass, 160),
    campus: text(profile.campus, 120),
    gpa: finite(profile.gpa),
  })
}

function projectAssignment(item) {
  return compactObject({
    title: text(item?.title, 500),
    courseName: text(item?.courseName, 320),
    kind: text(item?.kind, 80),
    dueAt: instant(item?.dueAt),
    score: finite(item?.score),
    status: text(item?.status, 80),
  })
}

function projectExam(item) {
  return compactObject({
    courseName: text(item?.courseName, 500),
    termId: text(item?.termId, 120),
    examType: text(item?.examType, 120),
    startAt: instant(item?.startAt || item?.examTime),
    endAt: instant(item?.endAt),
    location: text(item?.location, 320),
    campus: text(item?.campus, 160),
    seat: text(item?.seat, 160),
    mode: text(item?.mode, 120),
    remark: text(item?.remark, 500),
  })
}

function projectGrade(item) {
  return compactObject({
    courseName: text(item?.courseName, 500),
    courseCode: text(item?.courseCode, 120),
    termId: text(item?.termId, 120),
    credits: finite(item?.credits),
    score: text(item?.score, 120),
    point: finite(item?.point),
    status: text(item?.status, 120),
    nature: text(item?.nature, 160),
    category: text(item?.category, 160),
    remark: text(item?.remark, 500),
    gpaIncluded: typeof item?.gpaIncluded === 'boolean' ? item.gpaIncluded : null,
  })
}

function projectCourse(item) {
  return compactObject({
    title: text(item?.title, 500),
    courseCode: text(item?.courseCode || item?.code, 120),
    termId: text(item?.termId, 120),
    teacher: text(item?.teacher, 160),
    credits: finite(item?.credits),
    category: text(item?.category, 160),
    location: text(item?.location, 320),
    time: text(item?.time, 320),
    capacity: finite(item?.capacity),
    enrolled: finite(item?.enrolled),
    waiting: text(item?.waiting, 120),
  })
}

function projectSchedule(item) {
  return compactObject({
    title: text(item?.title, 500),
    termId: text(item?.termId, 120),
    teacher: text(item?.teacher, 160),
    room: text(item?.room, 320),
    weekday: finite(item?.weekday),
    period: text(item?.period, 120),
    weeks: text(item?.weeks, 320),
    startAt: instant(item?.startAt),
    endAt: instant(item?.endAt),
  })
}

function projectNotice(item) {
  return compactObject({
    title: text(item?.title, 500),
    summary: text(item?.summary, 4_000),
    publishedAt: instant(item?.publishedAt),
    source: controlled(item?.source),
  })
}

function projectMailbox(item, { body = false } = {}) {
  // The plain-text body also flows through the full advisor redaction policy:
  // HTML-to-text strips markup, and the redaction pass removes paths,
  // credentials, cookies and API-key shaped strings from the observation.
  const rawBody = body
    ? sanitizeAdvisorUntrustedText(
        item?.bodyHtml
          ? htmlToSafeText(item.bodyHtml, { maxChars: MAX_MESSAGE_BODY_CHARS })
          : String(item?.body ?? ''),
        { maxLength: MAX_MESSAGE_BODY_CHARS },
      ) || null
    : null
  return compactObject({
    subject: text(item?.subject, 500),
    from: text(item?.from, 320),
    receivedAt: instant(item?.receivedAt),
    snippet: text(item?.snippet, 1_200),
    unread: typeof item?.unread === 'boolean' ? item.unread : null,
    attachments: projectAttachmentMetadata(item?.attachments),
    ...(body ? { body: rawBody } : {}),
  })
}

function projectFitness(record) {
  return safeTree(record?.normalized ?? record)
}

function projectAcademicCalendar(calendarCollection) {
  const collection = calendarCollection && typeof calendarCollection === 'object' ? calendarCollection : {}
  const calendar = collection.calendar && typeof collection.calendar === 'object' ? collection.calendar : null
  const analysis = collection.analysis && typeof collection.analysis === 'object' ? collection.analysis : null
  if (!calendar && !analysis) return null
  // Keep the normalized OCR calendar and the structured PDF analysis in one
  // lazy record. This preserves the one-domain/one-record inventory while
  // allowing questions about vacation dates, weekly milestones, and course
  // selection windows to use the same current snapshot.
  return safeTree({ ...(calendar ? { calendar } : {}), ...(analysis ? { analysis } : {}) })
}

function projectAcademicExtra(item, domain = null) {
  if (!item || typeof item !== 'object') return null
  const sensitiveProfileField = (field) => domain === 'profile-extra'
    && /监护|身份证|证件|电话|手机|地址|银行卡|password|secret|token|cookie|session|authorization|credential|phone|mobile|address|idnumber|guardian/iu.test(
      `${String(field?.label || '')} ${String(field?.name || '')}`,
    )
  const fields = Array.isArray(item.fields)
    ? item.fields.filter((field) => !sensitiveProfileField(field)).map((field) => compactObject({
      name: controlled(field?.name),
      label: text(field?.label, 160),
      value: typeof field?.value === 'number' ? finite(field.value) : text(field?.value, 800),
    })).filter((field) => field.label && field.value !== null && field.value !== undefined).slice(0, 32)
    : []
  return compactObject({
    title: text(item.title, 320),
    courseName: text(item.courseName, 320),
    courseCode: text(item.courseCode, 120),
    className: text(item.className, 240),
    classComposition: text(item.classComposition, 320),
    teacher: text(item.teacher, 200),
    affiliation: text(item.affiliation, 200),
    courseFlag: text(item.courseFlag, 160),
    degreeCourse: text(item.degreeCourse, 80),
    importanceCoefficient: finite(item.importanceCoefficient),
    hours: finite(item.hours),
    term: text(item.term, 120),
    academicYear: text(item.academicYear, 120),
    majorCode: text(item.majorCode, 120),
    track: text(item.track, 240),
    planCapacity: finite(item.planCapacity),
    minimumGraduationCredits: finite(item.minimumGraduationCredits),
    nonTuitionCredits: finite(item.nonTuitionCredits),
    secondClassCredits: finite(item.secondClassCredits),
    minorCredits: finite(item.minorCredits),
    secondMajorCredits: finite(item.secondMajorCredits),
    secondDegreeCredits: finite(item.secondDegreeCredits),
    degreeAwarded: text(item.degreeAwarded, 160),
    appliedAt: instant(item.appliedAt),
    finalReviewedAt: instant(item.finalReviewedAt),
    finalReviewer: text(item.finalReviewer, 160),
    status: text(item.status, 160),
    warningType: text(item.warningType, 200),
    triggeredTerm: text(item.triggeredTerm, 120),
    reason: text(item.reason, 600),
    processingStatus: text(item.processingStatus, 160),
    reviewStatus: text(item.reviewStatus, 160),
    auditConclusion: text(item.auditConclusion, 400),
    graduationEligibility: text(item.graduationEligibility, 160),
    degreeEligibility: text(item.degreeEligibility, 160),
    missingItems: text(item.missingItems, 800),
    regularScore: finite(item.regularScore),
    midtermScore: finite(item.midtermScore),
    finalScore: finite(item.finalScore),
    assessmentDetails: text(item.assessmentDetails, 800),
    composition: text(item.composition, 600),
    examTime: instant(item.examTime),
    location: text(item.location || item.classroom, 240),
    campus: text(item.campus, 120),
    building: text(item.building, 160),
    capacity: finite(item.capacity),
    date: instant(item.date) || text(item.date, 120),
    periods: text(item.periods, 160),
    thesisTitle: text(item.thesisTitle, 400),
    taskBook: text(item.taskBook, 400),
    openingReport: text(item.openingReport, 400),
    midtermReport: text(item.midtermReport, 400),
    reviewMaterials: text(item.reviewMaterials, 400),
    defenseMaterials: text(item.defenseMaterials, 400),
    thesisScore: finite(item.thesisScore),
    keywords: text(item.keywords, 400),
    message: text(item.message, 800),
    messages: Array.isArray(item.messages) ? item.messages.map((value) => text(value, 600)).filter(Boolean).slice(0, 8) : null,
    fields: fields.length ? fields : null,
  })
}

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

function opaqueAcademicId(revision, value) {
  return value ? `academic:${canonicalDigest({ revision, value }).slice(0, 20)}` : null
}

function projectAcademicLedger(node, revision, depth = 0) {
  if (!node || depth > 4) return null
  return compactObject({
    id: opaqueAcademicId(revision, node.id),
    title: text(node.title, 320),
    relation: node.relation,
    treatment: node.treatment,
    required: finite(node.required),
    earned: finite(node.earned),
    remaining: finite(node.remaining),
    confidence: controlled(node.confidence, 'unknown'),
    status: controlled(node.status, 'unknown'),
    allocations: Array.isArray(node.allocations) ? node.allocations.slice(0, 24).map((allocation) => compactObject({
      requirementCourseId: opaqueAcademicId(revision, allocation.requirementCourseId),
      courseCode: text(allocation.courseCode, 120),
      title: text(allocation.title, 320),
      requiredCredits: finite(allocation.requiredCredits),
      studyStatus: text(allocation.studyStatus, 80),
      score: text(allocation.score, 80),
      recommendedYear: text(allocation.recommendedYear, 40),
      recommendedTerm: text(allocation.recommendedTerm, 40),
      courseKey: opaqueAcademicId(revision, allocation.courseKey),
      basis: controlled(allocation.basis, 'unknown'),
      status: controlled(allocation.status, 'unknown'),
      credits: finite(allocation.credits),
      treatment: controlled(allocation.treatment, 'unknown'),
    })) : [],
    children: Array.isArray(node.children)
      ? node.children.slice(0, 16).map((child) => projectAcademicLedger(child, revision, depth + 1)).filter(Boolean)
      : [],
    alternatives: Array.isArray(node.alternatives)
      ? node.alternatives.slice(0, 16).map((child) => projectAcademicLedger(child, revision, depth + 1)).filter(Boolean)
      : [],
  })
}

function projectAcademicAnalysis(analysis, revision, maximum = MAX_TOOL_RESULTS) {
  return {
    schema: analysis.schema,
    evaluatedAt: analysis.evaluatedAt,
    gpa: analysis.gpa,
    coverage: analysis.coverage,
    creditLedger: {
      earnedCredits: analysis.creditLedger.earnedCredits,
      earnedCourses: analysis.creditLedger.earnedCourses,
      attemptedCourses: analysis.creditLedger.attemptedCourses,
      unknownAttempts: analysis.creditLedger.unknownAttempts,
      unknownCredits: analysis.creditLedger.unknownCredits,
    },
    courses: analysis.courses.slice(0, Math.min(24, Math.max(maximum, 6))).map((course) => ({
      courseKey: opaqueAcademicId(revision, course.courseKey),
      courseCode: course.courseCode,
      courseName: course.courseName,
      attemptCount: course.attemptCount,
      isRetake: course.isRetake,
      status: course.status,
      earnedCredits: course.earnedCredits,
      representativeAttemptId: opaqueAcademicId(revision, course.representativeAttemptId),
      gpaAttemptId: opaqueAcademicId(revision, course.gpaAttemptId),
      creditAttemptId: opaqueAcademicId(revision, course.creditAttemptId),
    })),
    requirementRoots: analysis.creditLedger.requirementRoots.slice(0, 12)
      .map((node) => projectAcademicLedger(node, revision)).filter(Boolean),
  }
}

function normalizedCourseCode(value) {
  const normalized = String(value ?? '').normalize('NFC').trim()
  return normalized ? normalized.replace(/\s+/gu, '').toLocaleUpperCase() : ''
}

function normalizedCourseTitle(value) {
  return String(value ?? '').normalize('NFC').trim().replace(/\s+/gu, '').toLocaleLowerCase()
}

function termRank(value) {
  const match = String(value || '').match(/^(\d{4})-(\d+)$/u)
  return match ? Number(match[1]) * 100 + Number(match[2]) : Number.NEGATIVE_INFINITY
}

function courseRequirementKind(allocation, path) {
  const pathText = path.join(' ')
  const optional = /选修|任选|素质拓展|通识/u.test(pathText)
  const studyStatus = String(allocation.studyStatus || '')
  if (allocation.status === 'not-earned' || /未通过|不及格|挂科|缺考/u.test(studyStatus)) return 'must-retake'
  if (allocation.status === 'earned') return 'already-earned'
  if (optional) return 'optional-unfinished'
  if (/未修/u.test(studyStatus) || allocation.status === 'unknown') return 'required-unfinished'
  return 'unknown'
}

function flattenAcademicRequirements(nodes, path = [], output = []) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node || typeof node !== 'object') continue
    const nextPath = [...path, text(node.title, 320) || '未命名要求']
    output.push({ node, path: nextPath })
    flattenAcademicRequirements(node.children, nextPath, output)
  }
  return output
}

function projectRequirementGap(allocation, path, revision) {
  const kind = courseRequirementKind(allocation, path)
  return compactObject({
    kind,
    category: text(path[1] || path[0], 160),
    path: path.slice(0, 5).map((item) => text(item, 160)).filter(Boolean),
    courseCode: text(allocation.courseCode, 120),
    title: text(allocation.title, 320),
    credits: finite(allocation.requiredCredits ?? allocation.credits),
    studyStatus: text(allocation.studyStatus, 80),
    score: text(allocation.score, 80),
    recommendedYear: text(allocation.recommendedYear, 40),
    recommendedTerm: text(allocation.recommendedTerm, 40),
    basis: controlled(allocation.basis, 'unknown'),
    courseKey: opaqueAcademicId(revision, allocation.courseKey),
  })
}

function scheduleKind(item, requirementsByCode, requirementsByTitle, hasRequirements) {
  const code = normalizedCourseCode(item?.courseCode || item?.code)
  const title = normalizedCourseTitle(item?.title || item?.courseName)
  const requirement = (code && requirementsByCode.get(code)) || (title && requirementsByTitle.get(title)) || null
  if (requirement) {
    return {
      kind: requirement.kind,
      requirement: compactObject({
        category: requirement.category,
        title: requirement.title,
        courseCode: requirement.courseCode,
        credits: requirement.credits,
        studyStatus: requirement.studyStatus,
      }),
    }
  }
  const elective = /选修|任选|素质|拓展|通识/u.test(`${item?.nature || ''} ${item?.category || ''} ${item?.affiliation || ''}`)
  return { kind: hasRequirements ? (elective ? 'optional' : 'unknown') : 'unknown', requirement: null }
}

function projectSchoolScheduleItem(item, classification) {
  return compactObject({
    kind: classification.kind,
    courseCode: text(item?.courseCode || item?.code, 120),
    title: text(item?.title || item?.courseName, 320),
    classId: text(item?.classId, 160),
    className: text(item?.className, 320),
    credits: finite(item?.credits),
    nature: text(item?.nature, 160),
    category: text(item?.category, 160),
    affiliation: text(item?.affiliation, 160),
    teacher: text(item?.teacher, 240),
    time: text(item?.time, 320),
    location: text(item?.location, 240),
    requirement: classification.requirement,
  })
}

function buildCourseAnalysis({ analysis, state, revision, queryText, maximum, requestedTermId }) {
  const flattened = flattenAcademicRequirements(analysis.requirements.roots)
  const categories = flattened
    .filter(({ path }) => path.length === 2)
    .map(({ node, path }) => compactObject({
      title: text(node.title, 240),
      category: text(node.title, 240),
      required: finite(node.required),
      earned: finite(node.earned),
      remaining: finite(node.remaining),
      confidence: controlled(node.confidence, 'unknown'),
      status: controlled(node.status, 'unknown'),
      priority: /选修|任选/u.test(node.title || '') ? 'optional' : 'required',
    }))
    .filter((item) => item.remaining > 0 || matches(item, queryText))
    .sort((left, right) => (left.priority === 'required' ? -1 : 1) - (right.priority === 'required' ? -1 : 1)
      || Number(right.remaining || 0) - Number(left.remaining || 0))

  const gaps = []
  for (const { node, path } of flattened) {
    for (const allocation of Array.isArray(node.allocations) ? node.allocations : []) {
      if (allocation.status === 'earned') continue
      const gap = projectRequirementGap(allocation, path, revision)
      if (!gap.title && !gap.courseCode) continue
      if (matches(gap, queryText)) gaps.push(gap)
    }
  }
  const kindOrder = { 'must-retake': 0, 'required-unfinished': 1, 'optional-unfinished': 2, unknown: 3 }
  gaps.sort((left, right) => (kindOrder[left.kind] ?? 9) - (kindOrder[right.kind] ?? 9)
    || String(left.recommendedYear || '').localeCompare(String(right.recommendedYear || ''))
    || String(left.title || '').localeCompare(String(right.title || '')))

  const failedCourses = analysis.courses
    .filter((course) => course.status === 'failed')
    .map((course) => compactObject({
      courseCode: text(course.courseCode, 120),
      title: text(course.courseName, 320),
      credits: finite(course.attempts?.find((attempt) => attempt.credits != null)?.credits),
      attemptCount: course.attemptCount,
      isRetake: course.isRetake,
      attempts: (Array.isArray(course.attempts) ? course.attempts : []).slice(-4).map((attempt) => compactObject({
        termId: text(attempt.termId, 80), score: text(attempt.score, 80), outcome: controlled(attempt.outcome, 'unknown'),
      })),
    }))
    .filter((course) => matches(course, queryText))
    .slice(0, maximum)

  const requirementByCode = new Map()
  const requirementByTitle = new Map()
  for (const gap of gaps) {
    const map = gap.courseCode ? requirementByCode : requirementByTitle
    const key = gap.courseCode ? normalizedCourseCode(gap.courseCode) : normalizedCourseTitle(gap.title)
    if (key && !map.has(key)) map.set(key, gap)
  }
  const scheduleRecords = Object.values(state.dataCatalog?.collections?.schoolSchedule?.records || {})
  const usableRecords = scheduleRecords.filter((record) => Array.isArray(record?.items))
  const availableTerms = [...new Set(usableRecords.map((record) => String(record?.scope?.termId || '').trim()).filter(Boolean))]
  const termId = String(requestedTermId || '').trim() || [...availableTerms].sort((left, right) => termRank(right) - termRank(left))[0] || null
  const scheduleRecord = usableRecords.find((record) => String(record?.scope?.termId || '').trim() === termId)
  const scheduleItems = Array.isArray(scheduleRecord?.items) ? scheduleRecord.items : []
  const candidates = scheduleItems
    .map((item) => ({ item, classification: scheduleKind(item, requirementByCode, requirementByTitle, flattened.length > 0) }))
    .filter(({ item }) => !queryText || matches(item, queryText))
    .sort((left, right) => (kindOrder[left.classification.kind] ?? 4) - (kindOrder[right.classification.kind] ?? 4)
      || String(left.item?.courseCode || '').localeCompare(String(right.item?.courseCode || ''))
      || String(left.item?.classId || '').localeCompare(String(right.item?.classId || '')))
  const uniqueCourses = []
  const seenCourseKeys = new Set()
  for (const candidate of candidates) {
    const key = normalizedCourseCode(candidate.item?.courseCode || candidate.item?.code)
      || normalizedCourseTitle(candidate.item?.title || candidate.item?.courseName)
    if (!key || seenCourseKeys.has(key)) continue
    seenCourseKeys.add(key)
    uniqueCourses.push(candidate)
  }
  const projectedCandidates = uniqueCourses.slice(0, maximum)
    .map(({ item, classification }) => projectSchoolScheduleItem(item, classification))

  return {
    schema: 'theia-course-analysis/v1',
    query: queryText || null,
    requirementSummary: {
      source: analysis.requirements.source,
      root: analysis.requirements.roots[0]
        ? compactObject({
          title: text(analysis.requirements.roots[0].title, 240),
          required: finite(analysis.requirements.roots[0].required),
          earned: finite(analysis.requirements.roots[0].earned),
          remaining: finite(analysis.requirements.roots[0].remaining),
          confidence: controlled(analysis.requirements.roots[0].confidence, 'unknown'),
        })
        : null,
      categories: categories.slice(0, Math.max(maximum, 8)),
    },
    gaps: gaps.slice(0, maximum),
    failedCourses,
    schoolSchedule: {
      termId,
      availableTerms: availableTerms.slice(0, 12),
      recordAvailable: Boolean(scheduleRecord),
      totalClasses: scheduleItems.length,
      candidates: projectedCandidates,
    },
  }
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
