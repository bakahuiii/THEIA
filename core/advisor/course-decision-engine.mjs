import {
  compareCanonicalText,
  normalizeText,
  shortDigest,
  uniqueSorted,
} from './canonical.mjs'
import { isPassedGrade } from '../gpa.mjs'

export const COURSE_DECISION_SCHEMA = 'theia-advisor-course-decisions/v1'
export const COURSE_DECISION_RULES_VERSION = 'theia-advisor-course-decision-rules/v1'
export const COURSE_DECISION_SCORE_FORMULA_VERSION = 'theia-advisor-course-decision-score/v2'
export const COURSE_DECISION_PROPOSAL_KINDS = Object.freeze([
  'save-target',
  'view-details',
  'open-confirmation',
])

export const COURSE_DECISION_SCORE_TABLE = Object.freeze({
  requirementMatch: Object.freeze({
    'official-link': 40,
    'course-code': 36,
    category: 24,
    'name-match': 12,
    unknown: 0,
  }),
  scheduleConflict: Object.freeze({ clear: 25, conflict: 0, unknown: 0 }),
  historyEvidence: Object.freeze({
    'confirmed-no-attempt': 10,
    'previous-attempt': 4,
    'already-completed': 0,
    'currently-selected': 0,
    unknown: 0,
  }),
  dataQuality: Object.freeze({ complete: 10, partial: 6, unknown: 0 }),
  requirementGap: Object.freeze({
    // Points per missing credit in the matched training-plan node,
    // capped so a single gap cannot dominate the whole ranking.
    perCredit: 3,
    cap: 30,
  }),
})

const COMPLETENESS_VALUES = new Set(['complete', 'partial', 'unknown'])
const MATCH_PRIORITY = Object.freeze({
  'official-link': 0,
  'course-code': 1,
  category: 2,
  'name-match': 3,
  unknown: 4,
})
const MATCH_CONFIDENCE = Object.freeze({
  'official-link': 'high',
  'course-code': 'high',
  category: 'medium',
  'name-match': 'low',
  unknown: 'low',
})
const MATCH_BASIS_LABELS = Object.freeze({
  'official-link': '培养方案直接关联',
  'course-code': '课程号匹配',
  category: '课程类别匹配',
  'name-match': '课程名称匹配',
  unknown: '未知依据',
})
const MATCH_CONFIDENCE_LABELS = Object.freeze({
  high: '高',
  medium: '中',
  low: '低',
  unknown: '未知',
})
const DUPLICATE_PRIORITY = Object.freeze({
  'already-completed': 0,
  'currently-selected': 1,
  'previous-attempt': 2,
  none: 3,
  unknown: 4,
})
const PROPOSAL_PRIORITY = Object.freeze(Object.fromEntries(
  COURSE_DECISION_PROPOSAL_KINDS.map((kind, index) => [kind, index]),
))

function array(value) {
  return Array.isArray(value) ? value : []
}

function text(value) {
  return normalizeText(value, { trim: true })
}

function codeKey(value) {
  return text(value).replace(/\s+/g, '').toUpperCase()
}

function nameKey(value) {
  return text(value)
    .toLocaleLowerCase('en-US')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function completeness(value, fallback = 'unknown') {
  return COMPLETENESS_VALUES.has(value) ? value : fallback
}

function weakestCompleteness(values) {
  const normalized = values.map((value) => completeness(value))
  if (normalized.includes('unknown')) return 'unknown'
  if (normalized.includes('partial')) return 'partial'
  return 'complete'
}

function requirementId(node, path) {
  return text(node?.id) || `requirement:${shortDigest({ path, title: text(node?.title) }, 20)}`
}

function creditNumber(value, fallback) {
  const number = finiteNumber(value)
  return number !== null && number >= 0 ? number : fallback
}

function flattenRequirements(academicProgress) {
  const roots = array(academicProgress?.roots)
  const categories = array(academicProgress?.categories)
  const source = roots.length ? roots : categories
  const result = []
  const visited = new Set()

  function visit(node, path) {
    if (!node || typeof node !== 'object' || visited.has(node)) return
    visited.add(node)
    const id = requirementId(node, path)
    const nested = node?.credits && typeof node.credits === 'object' ? node.credits : {}
    result.push({
      id,
      path: [...path],
      label: text(node.title) || '未命名培养方案节点',
      node,
      courses: array(node.courses),
      required: creditNumber(node.required ?? nested.required, null),
      earned: creditNumber(node.earned ?? nested.earned, null),
      remaining: creditNumber(node.remaining ?? nested.remaining, null),
    })
    array(node.children).forEach((child, index) => visit(child, [...path, index]))
  }

  source.forEach((node, index) => visit(node, [index]))
  return {
    nodes: result,
    completeness: roots.length ? 'complete' : categories.length ? 'partial' : 'unknown',
  }
}

function explicitRequirementIds(candidate) {
  return new Set([
    candidate?.requirementNodeId,
    candidate?.officialRequirementId,
    ...array(candidate?.requirementNodeIds),
    ...array(candidate?.officialRequirementIds),
  ].map((item) => text(item)).filter(Boolean))
}

function explicitRequirementCourseIds(candidate) {
  return new Set([
    candidate?.requirementCourseId,
    ...array(candidate?.requirementCourseIds),
  ].map((item) => text(item)).filter(Boolean))
}

function categoryKeys(candidate) {
  return new Set([
    candidate?.category,
    candidate?.nature,
    candidate?.blockTitle,
    candidate?.categoryLabel,
    candidate?.categoryCode,
  ].map((item) => nameKey(item)).filter(Boolean))
}

function matchRequirement(candidate, requirement) {
  const nodeIds = explicitRequirementIds(candidate)
  const courseIds = explicitRequirementCourseIds(candidate)
  if (nodeIds.has(requirement.id)
    || requirement.courses.some((course) => courseIds.has(text(course?.id)))) {
    return 'official-link'
  }

  const candidateCode = codeKey(candidate?.courseCode || candidate?.courseId)
  if (candidateCode && requirement.courses.some((course) => (
    codeKey(course?.courseCode || course?.courseId) === candidateCode
  ))) return 'course-code'

  const candidateCategories = categoryKeys(candidate)
  const requirementCategories = new Set([
    requirement.label,
    ...requirement.courses.flatMap((course) => [course?.category, course?.nature]),
  ].map((item) => nameKey(item)).filter(Boolean))
  if ([...candidateCategories].some((value) => requirementCategories.has(value))) return 'category'

  const candidateName = nameKey(candidate?.title)
  if (candidateName && requirement.courses.some((course) => nameKey(course?.title) === candidateName)) {
    return 'name-match'
  }
  return null
}

function requirementMatches(candidate, requirementNodes) {
  const matches = requirementNodes
    .map((requirement) => {
      const basis = matchRequirement(candidate, requirement)
      return basis ? {
        nodeId: requirement.id,
        nodePath: [...requirement.path],
        label: requirement.label,
        basis,
        confidence: MATCH_CONFIDENCE[basis],
      } : null
    })
    .filter(Boolean)
    .sort((left, right) => (
      MATCH_PRIORITY[left.basis] - MATCH_PRIORITY[right.basis]
      || compareCanonicalText(left.nodeId, right.nodeId)
    ))
  return matches.length ? matches : [{
    nodeId: null,
    nodePath: null,
    label: '未确认培养方案匹配',
    basis: 'unknown',
    confidence: 'low',
  }]
}

function recordMatch(candidate, record) {
  const candidateCode = codeKey(candidate?.courseCode || candidate?.courseId)
  const recordCode = codeKey(record?.courseCode || record?.courseId || record?.code)
  if (candidateCode && recordCode && candidateCode === recordCode) return 'course-code'
  const candidateName = nameKey(candidate?.title)
  const recordName = nameKey(record?.title || record?.courseName)
  return candidateName && recordName && candidateName === recordName ? 'name-match' : null
}

function studyStatus(status) {
  const value = text(status)
  if (!value || /未修|未通过|不及格|fail/i.test(value)) return null
  if (/已修|已通过|通过|完成|合格|passed|completed/i.test(value)) return 'already-completed'
  if (/在读|修读中|正在|studying|in.?progress/i.test(value)) return 'currently-selected'
  return null
}

function historicalSummary(candidate, grades) {
  const matched = array(grades).filter((grade) => recordMatch(candidate, grade))
  const points = matched.map((grade) => finiteNumber(grade?.point)).filter((point) => point !== null)
  const meanPoint = points.length
    ? Number((points.reduce((sum, point) => sum + point, 0) / points.length).toFixed(2))
    : null
  const note = !matched.length
    ? '本地成绩记录中未发现该课程的历史尝试。'
    : points.length
      ? `发现 ${matched.length} 次历史成绩记录，其中 ${points.length} 次含数值绩点，平均绩点 ${meanPoint.toFixed(2)}。`
      : `发现 ${matched.length} 次历史成绩记录，但没有可计算的数值绩点。`
  return {
    attempts: matched.length,
    numericCount: points.length,
    meanPoint,
    note,
    matched,
  }
}

function duplicateAnalysis(candidate, {
  grades,
  selectedCourses,
  schedule,
  requirements,
  historyKnown,
  scheduleRecordsCurrent,
  selectedCourseRecordsCurrent,
}) {
  const matches = []
  for (const requirement of requirements) {
    for (const course of requirement.courses) {
      if (!recordMatch(candidate, course)) continue
      const kind = studyStatus(course?.studyStatus)
      if (kind) matches.push({
        kind,
        existingId: text(course?.id) || requirement.id,
        basis: recordMatch(candidate, course),
        evidence: {
          dataset: 'academic-progress',
          domain: 'academic-progress',
          entityId: text(course?.id) || requirement.id,
          fields: ['id', 'courseCode', 'courseId', 'title', 'studyStatus'],
        },
        reason: kind === 'already-completed'
          ? `培养方案记录显示“${text(course?.title) || text(candidate?.title)}”已修。`
          : `培养方案记录显示“${text(course?.title) || text(candidate?.title)}”正在修读。`,
      })
    }
  }
  for (const grade of array(grades)) {
    const basis = recordMatch(candidate, grade)
    if (!basis) continue
    const passed = isPassedGrade(grade)
    matches.push({
      kind: passed === true ? 'already-completed' : 'previous-attempt',
      existingId: text(grade?.id) || `grade:${shortDigest(grade, 16)}`,
      basis,
      evidence: {
        dataset: 'grades',
        domain: 'grades',
        entityId: text(grade?.id) || `grade:${shortDigest(grade, 16)}`,
        fields: ['id', 'courseCode', 'courseId', 'courseName', 'score', 'point', 'status'],
      },
      reason: passed === true
        ? `成绩记录显示“${text(grade?.courseName) || text(candidate?.title)}”已通过。`
        : `成绩记录显示“${text(grade?.courseName) || text(candidate?.title)}”曾修读，当前不能确认已通过。`,
    })
  }
  for (const selected of selectedCourseRecordsCurrent ? array(selectedCourses) : []) {
    const basis = recordMatch(candidate, selected)
    if (!basis) continue
    matches.push({
      kind: 'currently-selected',
      existingId: text(selected?.id) || `selected:${shortDigest(selected, 16)}`,
      basis,
      evidence: {
        dataset: 'selected-courses',
        domain: 'selected-courses',
        entityId: text(selected?.id) || `selected:${shortDigest(selected, 16)}`,
        fields: ['id', 'courseCode', 'courseId', 'title', 'termId'],
      },
      reason: `已选课程中已有“${text(selected?.title) || text(candidate?.title)}”。`,
    })
  }
  for (const item of scheduleRecordsCurrent ? array(schedule) : []) {
    const basis = recordMatch(candidate, item)
    if (!basis) continue
    matches.push({
      kind: 'currently-selected',
      existingId: text(item?.id) || `schedule:${shortDigest(item, 16)}`,
      basis,
      evidence: {
        dataset: 'schedule',
        domain: 'schedule',
        entityId: text(item?.id) || `schedule:${shortDigest(item, 16)}`,
        fields: ['id', 'courseCode', 'courseId', 'title', 'termId'],
      },
      reason: `当前课表中已有“${text(item?.title) || text(candidate?.title)}”。`,
    })
  }
  matches.sort((left, right) => (
    DUPLICATE_PRIORITY[left.kind] - DUPLICATE_PRIORITY[right.kind]
    || compareCanonicalText(left.existingId, right.existingId)
  ))
  const deduplicated = []
  const seen = new Set()
  for (const match of matches) {
    const key = `${match.kind}\u0000${match.existingId}`
    if (!seen.has(key)) {
      seen.add(key)
      deduplicated.push(match)
    }
  }
  return {
    status: deduplicated[0]?.kind || (historyKnown ? 'none' : 'unknown'),
    matches: deduplicated,
  }
}

const WEEKDAY_TEXT = Object.freeze([
  [/(?:星期|周)一|\bmon(?:day)?\b/iu, 1],
  [/(?:星期|周)二|\btue(?:sday)?\b/iu, 2],
  [/(?:星期|周)三|\bwed(?:nesday)?\b/iu, 3],
  [/(?:星期|周)四|\bthu(?:rsday)?\b/iu, 4],
  [/(?:星期|周)五|\bfri(?:day)?\b/iu, 5],
  [/(?:星期|周)六|\bsat(?:urday)?\b/iu, 6],
  [/(?:星期|周)[日天]|\bsun(?:day)?\b/iu, 7],
])

function weekday(value) {
  const numeric = finiteNumber(value)
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 7) return numeric
  const source = text(value)
  for (const [pattern, day] of WEEKDAY_TEXT) {
    if (pattern.test(source)) return day
  }
  return null
}

function integerRange(start, end, maximum) {
  const first = Math.trunc(Number(start))
  const last = Math.trunc(Number(end ?? start))
  if (!Number.isFinite(first) || !Number.isFinite(last)
    || first < 1 || last < first || last > maximum) return null
  return Array.from({ length: last - first + 1 }, (_, index) => first + index)
}

function periods(value, { allowBare = false } = {}) {
  if (Array.isArray(value)) {
    const normalized = value.map((item) => Math.trunc(Number(item)))
    return normalized.length && normalized.every((item) => item >= 1 && item <= 20)
      ? [...new Set(normalized)]
      : null
  }
  const source = text(value)
  let match = source.match(/(?:第\s*)?(\d{1,2})(?:\s*[-~至—–－]\s*(\d{1,2}))?\s*节/u)
  if (!match && allowBare) match = source.match(/(?:^|[^\d])(\d{1,2})(?:\s*[-~至—–－]\s*(\d{1,2}))?(?:[^\d]|$)/u)
  return match ? integerRange(match[1], match[2], 20) : null
}

function weeks(value, { allowBare = false } = {}) {
  if (Array.isArray(value)) {
    const normalized = value.map((item) => Math.trunc(Number(item)))
    return normalized.length && normalized.every((item) => item >= 1 && item <= 60)
      ? new Set(normalized)
      : null
  }
  const source = text(value)
  if (!source) return null
  const values = new Set()
  const pattern = /((?:第\s*)?\d{1,2}(?:\s*[-~至—–－]\s*\d{1,2})?(?:\s*[,，、]\s*\d{1,2}(?:\s*[-~至—–－]\s*\d{1,2})?)*)\s*周/gu
  for (const match of source.matchAll(pattern)) {
    const segments = match[1].replace(/第\s*/gu, '').split(/[,，、]/u)
    for (const segment of segments) {
      const bounds = segment.trim().split(/[-~至—–－]/u)
      for (const value of integerRange(bounds[0], bounds[1], 60) || []) values.add(value)
    }
  }
  if (!values.size && allowBare && /^(?:第\s*)?\d{1,2}(?:\s*[-~至—–－]\s*\d{1,2})?(?:\s*[,，、]\s*\d{1,2}(?:\s*[-~至—–－]\s*\d{1,2})?)*$/u.test(source)) {
    const segments = source.replace(/第\s*/gu, '').split(/[,，、]/u)
    for (const segment of segments) {
      const bounds = segment.trim().split(/[-~至—–－]/u)
      for (const item of integerRange(bounds[0], bounds[1], 60) || []) values.add(item)
    }
  }
  if (!values.size) return null
  const parity = /单周/u.test(source) ? 1 : /双周/u.test(source) ? 0 : null
  return new Set([...values].filter((value) => parity === null || value % 2 === parity))
}

function parseStructuredSession(value) {
  const day = weekday(value?.weekday ?? value?.day)
  const periodSet = periods(value?.period ?? value?.periods, { allowBare: true })
  if (!day || !periodSet?.length) return null
  return {
    weekday: day,
    periods: new Set(periodSet),
    weeks: weeks(value?.weeks, { allowBare: true }),
  }
}

function parseRawSession(value) {
  const source = text(value)
  const day = weekday(source)
  const periodSet = periods(source, { allowBare: true })
  if (!day || !periodSet?.length) return null
  return { weekday: day, periods: new Set(periodSet), weeks: weeks(source) }
}

function sessions(record) {
  if (Array.isArray(record?.sessions)) {
    const parsed = record.sessions.map((item) => parseStructuredSession(item)).filter(Boolean)
    return { values: parsed, invalid: parsed.length !== record.sessions.length || !parsed.length }
  }
  if (record?.weekday != null || record?.period != null || record?.weeks != null) {
    const parsed = parseStructuredSession(record)
    return { values: parsed ? [parsed] : [], invalid: !parsed }
  }
  const source = text(record?.time)
  if (!source) return { values: [], invalid: true }
  const pieces = source.split(/[;；\n]+/u).map((item) => item.trim()).filter(Boolean)
  const parsed = pieces.map((item) => parseRawSession(item)).filter(Boolean)
  return { values: parsed, invalid: parsed.length !== pieces.length || !parsed.length }
}

function intersects(left, right) {
  return [...left].some((value) => right.has(value))
}

function sameTerm(candidate, existing) {
  const candidateTerm = text(candidate?.termId)
  const existingTerm = text(existing?.termId)
  return !candidateTerm || !existingTerm || candidateTerm === existingTerm
}

function conflictReason(existing, session) {
  const periodText = [...session.periods].sort((a, b) => a - b).join(',')
  const weekText = [...session.weeks].sort((a, b) => a - b).join(',')
  return `与“${text(existing?.title) || '已有课程'}”在星期${session.weekday}第${periodText}节、第${weekText}周重叠。`
}

function scheduleAnalysis(candidate, schedule, schoolScheduleComplete) {
  const candidateSessions = sessions(candidate)
  const conflicts = new Map()
  let uncertain = candidateSessions.invalid

  for (const existing of array(schedule)) {
    if (!sameTerm(candidate, existing)) continue
    const existingSessions = sessions(existing)
    if (existingSessions.invalid) uncertain = true
    for (const candidateSession of candidateSessions.values) {
      for (const existingSession of existingSessions.values) {
        if (candidateSession.weekday !== existingSession.weekday
          || !intersects(candidateSession.periods, existingSession.periods)) continue
        if (!candidateSession.weeks || !existingSession.weeks) {
          uncertain = true
          continue
        }
        if (!intersects(candidateSession.weeks, existingSession.weeks)) continue
        const id = text(existing?.id) || `schedule:${shortDigest(existing, 16)}`
        conflicts.set(id, {
          existingId: id,
          reason: conflictReason(existing, {
            weekday: candidateSession.weekday,
            periods: new Set([...candidateSession.periods].filter((value) => existingSession.periods.has(value))),
            weeks: new Set([...candidateSession.weeks].filter((value) => existingSession.weeks.has(value))),
          }),
        })
      }
    }
  }

  const values = [...conflicts.values()].sort((left, right) => compareCanonicalText(left.existingId, right.existingId))
  const status = schoolScheduleComplete === true
    ? values.length ? 'conflict' : uncertain ? 'unknown' : 'clear'
    : 'unknown'
  return { status, conflicts: values, uncertain }
}

function effectiveCreditsScore(candidate, bestBasis, duplicateStatus) {
  if (['already-completed', 'currently-selected'].includes(duplicateStatus)) return 0
  const credits = finiteNumber(candidate?.credits)
  if (credits === null || credits <= 0 || bestBasis === 'unknown') return 0
  const factor = bestBasis === 'category' ? 0.75 : bestBasis === 'name-match' ? 0.4 : 1
  return Math.max(0, Math.min(15, Math.round(credits * 3 * factor)))
}

function requirementGapScore(matches, requirementsById) {
  const best = matches[0]
  if (!best?.nodeId) return 0
  const requirement = requirementsById.get(best.nodeId)
  const remaining = finiteNumber(requirement?.remaining)
  if (remaining === null || remaining <= 0) return 0
  const { perCredit, cap } = COURSE_DECISION_SCORE_TABLE.requirementGap
  return Math.max(0, Math.min(cap, Math.round(remaining * perCredit)))
}

function dataQualityScore(value) {
  return COURSE_DECISION_SCORE_TABLE.dataQuality[completeness(value)]
}

function historyClass(duplicateStatus, history, historyCompleteness) {
  if (duplicateStatus === 'already-completed') return 'already-completed'
  if (duplicateStatus === 'currently-selected') return 'currently-selected'
  if (history.attempts) return 'previous-attempt'
  return historyCompleteness === 'complete' ? 'confirmed-no-attempt' : 'unknown'
}

function scoreDecision({ candidate, matches, scheduleResult, duplicate, history, completenessAxes, requirementsById }) {
  const bestBasis = matches[0]?.basis || 'unknown'
  const excluded = ['already-completed', 'currently-selected'].includes(duplicate.status)
  const historyKey = historyClass(duplicate.status, history, completenessAxes.history)
  const overallCompleteness = weakestCompleteness(Object.values(completenessAxes))
  const gap = requirementGapScore(matches, requirementsById)
  const components = excluded ? {
    requirementMatch: 0,
    scheduleConflict: 0,
    effectiveCredits: 0,
    historyEvidence: 0,
    dataQuality: 0,
    requirementGap: 0,
  } : {
    requirementMatch: COURSE_DECISION_SCORE_TABLE.requirementMatch[bestBasis],
    scheduleConflict: COURSE_DECISION_SCORE_TABLE.scheduleConflict[scheduleResult.status],
    effectiveCredits: effectiveCreditsScore(candidate, bestBasis, duplicate.status),
    historyEvidence: COURSE_DECISION_SCORE_TABLE.historyEvidence[historyKey],
    dataQuality: dataQualityScore(overallCompleteness),
    requirementGap: gap,
  }
  const total = Object.values(components).reduce((sum, value) => sum + value, 0)
  const noEvidence = bestBasis === 'unknown'
    && scheduleResult.status === 'unknown'
    && historyKey === 'unknown'
    && finiteNumber(candidate?.credits) === null
    && overallCompleteness === 'unknown'
    && gap === 0
  const unranked = excluded || noEvidence
  return {
    score: unranked ? null : total,
    scoreBreakdown: {
      ...components,
      total: unranked ? null : total,
      formulaVersion: COURSE_DECISION_SCORE_FORMULA_VERSION,
    },
    completeness: overallCompleteness,
  }
}

function decisionReasons({ candidate, matches, scheduleResult, schoolScheduleComplete, duplicate, history, score, requirementsById }) {
  const reasons = []
  const best = matches[0]
  if (best?.basis === 'unknown') reasons.push('当前本地数据不能确认该课程对应的培养方案节点。')
  else reasons.push(`培养方案匹配依据为${MATCH_BASIS_LABELS[best.basis] || '未知依据'}，置信度为${MATCH_CONFIDENCE_LABELS[best.confidence] || '未知'}。`)

  if (best?.nodeId) {
    const requirement = requirementsById.get(best.nodeId)
    const remaining = finiteNumber(requirement?.remaining)
    const required = finiteNumber(requirement?.required)
    if (remaining !== null && remaining > 0) {
      reasons.push(`培养方案节点“${requirement?.label || '未命名节点'}”仍缺 ${remaining} 学分，该课程用于补足该缺口。`)
    } else if (remaining === 0) {
      reasons.push('该课程对应的培养方案节点学分缺口已补足，当前仅作普通参考。')
    } else if (required !== null && remaining === null) {
      reasons.push(`培养方案节点“${requirement?.label || '未命名节点'}”要求 ${required} 学分，但缺口学分未知。`)
    }
  }

  if (schoolScheduleComplete !== true) {
    reasons.push(scheduleResult.conflicts.length
      ? `现有记录已发现 ${scheduleResult.conflicts.length} 项时间重叠，但课表完整性未确认，冲突范围仍为未知。`
      : '课表完整性未确认，不能声称该课程没有时间冲突。')
  } else if (scheduleResult.status === 'conflict') {
    reasons.push(`已确认 ${scheduleResult.conflicts.length} 项课表时间冲突。`)
  } else if (scheduleResult.status === 'clear') {
    reasons.push('在已确认完整且可解析的当前课表中未发现时间重叠。')
  } else {
    reasons.push('候选课或已有课表的周次/节次不足，冲突状态未知。')
  }

  if (duplicate.status === 'already-completed') reasons.push('该课程已有通过或已修记录，不进入普通候选排名。')
  else if (duplicate.status === 'currently-selected') reasons.push('该课程已在已选课程或当前课表中，不进入普通候选排名。')
  else if (duplicate.status === 'previous-attempt') reasons.push('该课程存在历史修读记录，尚未确认已通过。')
  else if (duplicate.status === 'unknown') reasons.push('重复课程检查所需的成绩或已选课程数据不完整。')
  else reasons.push('在注入的完整成绩与已选课程记录中未发现重复课程。')

  reasons.push(history.note)
  const credits = finiteNumber(candidate?.credits)
  if (credits === null) reasons.push('候选课学分未知，未计入有效学分分量。')
  else if (score.scoreBreakdown.effectiveCredits > 0) reasons.push(`候选课记录为 ${credits} 学分，并按匹配置信度计入有效学分分量。`)
  return uniqueSorted(reasons)
}

function compareDecisions(left, right) {
  const leftScore = left.score ?? Number.NEGATIVE_INFINITY
  const rightScore = right.score ?? Number.NEGATIVE_INFINITY
  if (leftScore !== rightScore) return rightScore - leftScore
  return compareCanonicalText(left.candidateId, right.candidateId)
}

function proposalsFor(decision, rulesVersion) {
  return COURSE_DECISION_PROPOSAL_KINDS.map((kind) => Object.freeze({
    id: `proposal:${kind}:${shortDigest({ candidateId: decision.candidateId, kind, rulesVersion }, 20)}`,
    kind,
    candidateId: decision.candidateId,
    decisionId: decision.id,
    requiresUserConfirmation: kind === 'open-confirmation',
    label: kind === 'save-target'
      ? '保存为选课目标'
      : kind === 'view-details'
        ? '查看课程详情'
        : '进入人工确认界面',
  }))
}

function publicRecordRef(kind, rawId, rulesVersion) {
  const recordKind = text(kind)
  const entityId = text(rawId)
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(recordKind) || !entityId) {
    throw new TypeError('Public course-decision record references require a controlled kind and entity ID')
  }
  return `record-ref:${recordKind}:${shortDigest({
    kind: recordKind,
    rawId: entityId,
    rulesVersion,
  }, 20)}`
}

export function createCourseDecisions(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('course decision input must be an object')
  }
  const candidates = array(input.candidates)
  const ids = candidates.map((candidate) => text(candidate?.id))
  if (ids.some((id) => !id)) throw new TypeError('every course candidate must have a non-empty id')
  if (new Set(ids).size !== ids.length) throw new TypeError('course candidate ids must be unique')
  const rulesVersion = text(options.rulesVersion) || COURSE_DECISION_RULES_VERSION
  const requirementData = flattenRequirements(input.academicProgress)
  const requirementsById = new Map(requirementData.nodes.map((node) => [node.id, node]))
  const declaredSchoolScheduleComplete = Object.hasOwn(input, 'schoolScheduleComplete')
    ? input.schoolScheduleComplete === true
    : input.schoolSchedule?.complete === true
  const injectedCompleteness = input.completeness && typeof input.completeness === 'object'
    ? input.completeness
    : {}
  const schoolScheduleComplete = declaredSchoolScheduleComplete
    && Array.isArray(input.schedule)
    && !['partial', 'unknown'].includes(injectedCompleteness.schedule)
  const requirementCompleteness = weakestCompleteness([
    requirementData.completeness,
    completeness(injectedCompleteness.academicProgress, requirementData.completeness),
  ])
  const gradesKnown = Array.isArray(input.grades)
  const selectedKnown = Array.isArray(input.selectedCourses)
  const gradeCompleteness = completeness(injectedCompleteness.grades, gradesKnown ? 'complete' : 'unknown')
  const selectedCompleteness = completeness(injectedCompleteness.selectedCourses, selectedKnown ? 'complete' : 'unknown')
  const historyCompleteness = weakestCompleteness([gradeCompleteness, selectedCompleteness])
  const currentRecords = input.currentRecords && typeof input.currentRecords === 'object'
    ? input.currentRecords
    : {}
  const scheduleRecordsCurrent = Object.hasOwn(currentRecords, 'schedule')
    ? currentRecords.schedule === true
    : Array.isArray(input.schedule) && completeness(injectedCompleteness.schedule, 'complete') !== 'unknown'
  const selectedCourseRecordsCurrent = Object.hasOwn(currentRecords, 'selectedCourses')
    ? currentRecords.selectedCourses === true
    : selectedKnown && selectedCompleteness !== 'unknown'

  const decisions = candidates.map((candidate) => {
    const candidateId = text(candidate.id)
    const matches = requirementMatches(candidate, requirementData.nodes)
    const scheduleResult = scheduleAnalysis(candidate, input.schedule, schoolScheduleComplete)
    const history = historicalSummary(candidate, input.grades)
    const duplicate = duplicateAnalysis(candidate, {
      grades: input.grades,
      selectedCourses: input.selectedCourses,
      schedule: input.schedule,
      requirements: requirementData.nodes,
      historyKnown: historyCompleteness === 'complete',
      scheduleRecordsCurrent,
      selectedCourseRecordsCurrent,
    })
    const completenessAxes = {
      requirement: requirementCompleteness,
      schedule: scheduleResult.status === 'unknown' ? 'unknown' : 'complete',
      history: historyCompleteness,
    }
    const score = scoreDecision({
      candidate,
      matches,
      scheduleResult,
      duplicate,
      history,
      completenessAxes,
      requirementsById,
    })
    const id = `course-decision:${shortDigest({ candidateId, rulesVersion }, 20)}`
    const publicScheduleConflicts = scheduleResult.conflicts.map((conflict) => Object.freeze({
      ...conflict,
      existingId: publicRecordRef('schedule', conflict.existingId, rulesVersion),
    }))
    const publicDuplicateMatches = duplicate.matches.map(({ evidence, ...match }) => Object.freeze({
      ...match,
      existingId: publicRecordRef(evidence.dataset, match.existingId, rulesVersion),
    }))
    return Object.freeze({
      id,
      candidateId,
      requirementMatches: matches.map(({ nodePath, ...match }) => Object.freeze({
        ...match,
        nodeId: typeof options.requirementRefFactory === 'function' && match.nodeId
          ? options.requirementRefFactory({ rawId: match.nodeId, path: nodePath })
          : match.nodeId,
      })),
      scheduleStatus: scheduleResult.status,
      scheduleConflicts: publicScheduleConflicts,
      duplicateStatus: duplicate.status,
      duplicateMatches: publicDuplicateMatches,
      historicalSummary: {
        attempts: history.attempts,
        numericCount: history.numericCount,
        meanPoint: history.meanPoint,
        note: history.note,
      },
      completeness: score.completeness,
      score: score.score,
      scoreBreakdown: score.scoreBreakdown,
      reasons: decisionReasons({
        candidate,
        matches,
        scheduleResult,
        schoolScheduleComplete,
        duplicate,
        history,
        score,
        requirementsById,
      }),
      rulesVersion,
    })
  }).sort(compareDecisions).map((decision, index) => Object.freeze({ ...decision, rank: index + 1 }))

  const rankByCandidate = new Map(decisions.map((decision, index) => [decision.candidateId, index]))
  const proposals = decisions
    .flatMap((decision) => proposalsFor(decision, rulesVersion))
    .sort((left, right) => {
      const rank = rankByCandidate.get(left.candidateId) - rankByCandidate.get(right.candidateId)
      return rank || PROPOSAL_PRIORITY[left.kind] - PROPOSAL_PRIORITY[right.kind]
        || compareCanonicalText(left.id, right.id)
    })

  return Object.freeze({
    schema: COURSE_DECISION_SCHEMA,
    rulesVersion,
    decisions,
    proposals,
  })
}
