import {
  allowedFields,
  argCount,
  idArg,
  numberValue,
  objectValue,
  stringValue,
  fail,
} from './ipc-validation-primitives.mjs'

function advisorAcademicScenario(channel, args) {
  argCount(channel, args, 1)
  objectValue(channel, args[0], 'academic scenario')
  allowedFields(channel, args[0], ['snapshotRevision', 'additionalRequiredCredits', 'alternativeSelections'])
  stringValue(channel, args[0].snapshotRevision, 'snapshotRevision', 128)
  if (args[0].additionalRequiredCredits !== undefined) {
    numberValue(channel, args[0].additionalRequiredCredits, 'additionalRequiredCredits')
    if (args[0].additionalRequiredCredits < 0 || args[0].additionalRequiredCredits > 500) {
      fail(channel, 'additionalRequiredCredits is outside the supported range')
    }
  }
  if (args[0].alternativeSelections !== undefined) {
    objectValue(channel, args[0].alternativeSelections, 'alternativeSelections')
    const entries = Object.entries(args[0].alternativeSelections)
    if (entries.length > 128) fail(channel, 'alternativeSelections has too many entries')
    for (const [nodeId, selectedId] of entries) {
      stringValue(channel, nodeId, 'alternative node id', 512)
      stringValue(channel, selectedId, 'selected alternative id', 512)
      if (!/^ar1:requirement:[a-f0-9]{20}$/.test(nodeId)
        || !/^ar1:requirement:[a-f0-9]{20}$/.test(selectedId)) {
        fail(channel, 'alternative selections require opaque requirement references')
      }
    }
  }
}

function advisorActionRequest(channel, args) {
  argCount(channel, args, 1)
  objectValue(channel, args[0], 'advisor action request')
  allowedFields(channel, args[0], ['snapshotRevision', 'actionId'])
  stringValue(channel, args[0].snapshotRevision, 'snapshotRevision', 128)
  stringValue(channel, args[0].actionId, 'actionId', 256)
}

function advisorPrepareRequest(channel, args) {
  argCount(channel, args, 1)
  objectValue(channel, args[0], 'advisor prepare request')
  allowedFields(channel, args[0], ['threadId', 'question'])
  stringValue(channel, args[0].threadId, 'threadId', 128)
  stringValue(channel, args[0].question, 'question', 4_000)
}

function advisorSendRequest(channel, args) {
  argCount(channel, args, 1)
  objectValue(channel, args[0], 'advisor send request')
  allowedFields(channel, args[0], ['requestId', 'threadId', 'question'])
  stringValue(channel, args[0].requestId, 'requestId', 128, { optional: true })
  stringValue(channel, args[0].threadId, 'threadId', 128, { optional: true })
  stringValue(channel, args[0].question, 'question', 4_000, { optional: true })
  if (!args[0].requestId && !(args[0].threadId && args[0].question)) {
    fail(channel, 'requestId or threadId and question are required')
  }
}

function advisorCancelRequest(channel, args) {
  argCount(channel, args, 1)
  objectValue(channel, args[0], 'advisor cancel request')
  allowedFields(channel, args[0], ['requestId', 'threadId'])
  stringValue(channel, args[0].requestId, 'requestId', 128, { optional: true })
  stringValue(channel, args[0].threadId, 'threadId', 128, { optional: true })
  if (!args[0].requestId && !args[0].threadId) fail(channel, 'requestId or threadId is required')
}

const ADVISOR_CANDIDATE_FIELDS = Object.freeze([
  'id', 'courseId', 'courseCode', 'title', 'credits', 'category', 'categoryCode',
  'blockTitle', 'nature', 'termId', 'time', 'weekday', 'period', 'weeks', 'sessions',
  'requirementNodeId', 'requirementNodeIds', 'officialRequirementId',
  'officialRequirementIds', 'requirementCourseId', 'requirementCourseIds',
])
const ADVISOR_CANDIDATE_TEXT_FIELDS = Object.freeze([
  'courseId', 'courseCode', 'category', 'categoryCode', 'blockTitle', 'nature',
  'termId', 'requirementNodeId', 'officialRequirementId', 'requirementCourseId',
])
const ADVISOR_CANDIDATE_ID_ARRAY_FIELDS = Object.freeze([
  'requirementNodeIds', 'officialRequirementIds', 'requirementCourseIds',
])
const ADVISOR_SESSION_FIELDS = Object.freeze([
  'weekday', 'day', 'period', 'periods', 'weeks',
])
const MAX_ADVISOR_SESSION_ITEMS = 64
const MAX_ADVISOR_SESSION_VALUE_ITEMS = 64
const MAX_ADVISOR_ID_ARRAY_ITEMS = 128

function advisorScheduleAtom(channel, value, label) {
  if (typeof value === 'number') {
    numberValue(channel, value, label)
    return
  }
  stringValue(channel, value, label, 256)
}

function advisorScheduleValue(channel, value, label, { optional = false, scalarOnly = false } = {}) {
  if (optional && (value === undefined || value === null)) return
  if (!Array.isArray(value)) {
    advisorScheduleAtom(channel, value, label)
    return
  }
  if (scalarOnly) fail(channel, `${label} must be a finite number or short text`)
  if (value.length > MAX_ADVISOR_SESSION_VALUE_ITEMS) {
    fail(channel, `${label} has too many items`)
  }
  for (const item of value) advisorScheduleAtom(channel, item, `${label} item`)
}

function advisorIdArray(channel, value, label) {
  if (value === undefined || value === null) return
  if (!Array.isArray(value) || value.length > MAX_ADVISOR_ID_ARRAY_ITEMS) {
    fail(channel, `${label} must be an array with at most ${MAX_ADVISOR_ID_ARRAY_ITEMS} items`)
  }
  for (const item of value) stringValue(channel, item, `${label} item`, 512)
}

function advisorSessions(channel, value) {
  if (value === undefined || value === null) return
  if (!Array.isArray(value) || value.length > MAX_ADVISOR_SESSION_ITEMS) {
    fail(channel, `candidate sessions must be an array with at most ${MAX_ADVISOR_SESSION_ITEMS} items`)
  }
  for (const session of value) {
    objectValue(channel, session, 'candidate session')
    allowedFields(channel, session, ADVISOR_SESSION_FIELDS)
    advisorScheduleValue(channel, session.weekday, 'candidate session weekday', { optional: true, scalarOnly: true })
    advisorScheduleValue(channel, session.day, 'candidate session day', { optional: true, scalarOnly: true })
    advisorScheduleValue(channel, session.period, 'candidate session period', { optional: true })
    advisorScheduleValue(channel, session.periods, 'candidate session periods', { optional: true })
    advisorScheduleValue(channel, session.weeks, 'candidate session weeks', { optional: true })
  }
}

function advisorCourseDecisions(channel, args) {
  argCount(channel, args, 1)
  objectValue(channel, args[0], 'course decision request')
  allowedFields(channel, args[0], ['snapshotRevision', 'candidates', 'schoolScheduleComplete', 'completeness'])
  stringValue(channel, args[0].snapshotRevision, 'snapshotRevision', 128)
  if (!Array.isArray(args[0].candidates) || args[0].candidates.length > 500) {
    fail(channel, 'candidates must be an array with at most 500 items')
  }
  for (const candidate of args[0].candidates) {
    objectValue(channel, candidate, 'course candidate')
    allowedFields(channel, candidate, ADVISOR_CANDIDATE_FIELDS)
    stringValue(channel, candidate.id, 'candidate id', 512)
    stringValue(channel, candidate.title, 'candidate title', 2_000)
    if (candidate.credits !== undefined && candidate.credits !== null) numberValue(channel, candidate.credits, 'candidate credits')
    for (const field of ADVISOR_CANDIDATE_TEXT_FIELDS) {
      stringValue(channel, candidate[field], `candidate ${field}`, 512, { optional: true })
    }
    stringValue(channel, candidate.time, 'candidate time', 2_000, { optional: true })
    advisorScheduleValue(channel, candidate.weekday, 'candidate weekday', { optional: true, scalarOnly: true })
    advisorScheduleValue(channel, candidate.period, 'candidate period', { optional: true })
    advisorScheduleValue(channel, candidate.weeks, 'candidate weeks', { optional: true })
    advisorSessions(channel, candidate.sessions)
    for (const field of ADVISOR_CANDIDATE_ID_ARRAY_FIELDS) {
      advisorIdArray(channel, candidate[field], `candidate ${field}`)
    }
  }
  if (args[0].schoolScheduleComplete !== undefined && typeof args[0].schoolScheduleComplete !== 'boolean') {
    fail(channel, 'schoolScheduleComplete must be boolean')
  }
  if (args[0].completeness !== undefined) {
    objectValue(channel, args[0].completeness, 'completeness')
    allowedFields(channel, args[0].completeness, ['academicProgress', 'schedule', 'grades', 'selectedCourses'])
    for (const value of Object.values(args[0].completeness)) {
      if (!['complete', 'partial', 'unknown'].includes(value)) fail(channel, 'completeness value is invalid')
    }
  }
}

export const ADVISOR_IPC_SCHEMAS = new Map([
  ['theia:advisor:academic-what-if', advisorAcademicScenario],
  ['theia:advisor:course-decisions', advisorCourseDecisions],
  ['theia:advisor:execute-action', advisorActionRequest],
  ['theia:advisor:prepare', advisorPrepareRequest],
  ['theia:advisor:send', advisorSendRequest],
  ['theia:advisor:cancel', advisorCancelRequest],
  ['theia:advisor:delete-thread', idArg],
])
