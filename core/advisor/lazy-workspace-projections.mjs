import { parseCampusInstant } from './canonical.mjs'
import { htmlToSafeText, projectAttachmentMetadata } from './notice-mail-context.mjs'
import { sanitizeAdvisorUntrustedText } from './redaction.mjs'

export const MAX_MESSAGE_BODY_CHARS = 8_000


const FORBIDDEN_FIELD = /(?:^|-)(password|secret|token|cookie|session|authorization|credential|api-key|url|uri|path|html|binary|content|attachment-content)(?:-|$)/u
const GENERIC_FIELDS = Object.freeze([
  'title', 'name', 'label', 'courseName', 'courseCode', 'code', 'termId', 'term', 'teacher',
  'credits', 'category', 'nature', 'location', 'room', 'time', 'weekday', 'period', 'weeks',
  'startAt', 'endAt', 'dueAt', 'examTime', 'examType', 'score', 'point', 'status', 'remark',
  'assessment', 'seat', 'campus', 'mode', 'capacity', 'enrolled', 'waiting', 'kind', 'state',
])

export function text(value, maximum = 1_000) {
  // Untrusted campus text (mail bodies, notices, remarks) must pass the full
  // advisor redaction policy — not just URL stripping — so paths, credentials,
  // cookies and API-key shaped strings cannot reach the model observation.
  return sanitizeAdvisorUntrustedText(value, { maxLength: maximum }) || null
}

export function instant(value) {
  return parseCampusInstant(value)?.iso || null
}

export function finite(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function controlled(value, fallback = null) {
  const result = String(value ?? '').normalize('NFC').trim().toLowerCase()
  return /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(result) ? result : fallback
}

export function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined && entry !== ''))
}

export function normalizedFieldName(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replace(/_/gu, '-')
    .toLowerCase()
}

export function safeTree(value, depth = 0) {
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

export function shallowRecord(raw, fields = GENERIC_FIELDS) {
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

export function projectProfile(profile) {
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

export function projectAssignment(item) {
  return compactObject({
    title: text(item?.title, 500),
    courseName: text(item?.courseName, 320),
    kind: text(item?.kind, 80),
    dueAt: instant(item?.dueAt),
    score: finite(item?.score),
    status: text(item?.status, 80),
  })
}

export function projectExam(item) {
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

export function projectGrade(item) {
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

export function projectCourse(item) {
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

export function projectSchedule(item) {
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

export function projectNotice(item) {
  return compactObject({
    title: text(item?.title, 500),
    summary: text(item?.summary, 4_000),
    publishedAt: instant(item?.publishedAt),
    source: controlled(item?.source),
  })
}

export function projectMailbox(item, { body = false } = {}) {
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

export function projectFitness(record) {
  return safeTree(record?.normalized ?? record)
}

export function projectAcademicCalendar(calendarCollection) {
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

export function projectAcademicExtra(item, domain = null) {
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
