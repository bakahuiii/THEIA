function itemId(item) {
  return typeof item?.id === 'string' ? item.id : ''
}

function urgencyBand(item) {
  return typeof item?.score?.components?.urgency === 'string'
    ? item.score.components.urgency
    : 'unknown'
}

const ADVISOR_DOMAIN_LABELS = Object.freeze({
  profile: '个人信息',
  terms: '学期',
  courses: '课程',
  academic: '学业基础',
  schedule: '课表',
  grades: '成绩',
  exams: '考试',
  'selected-courses': '已选课程',
  'academic-progress': '学业进度',
  assignments: '作业与测试',
  workspaces: '课程工作区',
  coursework: '课程任务',
  notices: '通知',
  mailbox: '校园邮箱',
  fitness: '体测',
  'school-schedule': '全校课表',
  'academic-calendar': '校历',
  'local-data-catalog': '本地资料',
})

const ADVISOR_CONFIDENCE_LABELS = Object.freeze({
  high: '高',
  medium: '中',
  low: '低',
  unknown: '未知',
})

const ADVISOR_AGENDA_DOMAIN_KEYS = Object.freeze([
  'academic-progress',
  'academic-calendar',
  'assignments',
  'exams',
  'grades',
])

function isConfirmedAgendaDomain(quality) {
  return Boolean(
    quality
    && !quality.provenanceInferred
    && quality.availability !== 'unknown'
    && quality.availability !== 'absent'
    && quality.freshness === 'fresh'
    && quality.completeness === 'complete'
    && quality.lastAttempt?.status === 'succeeded'
    && quality.lastAttempt?.retainedPrevious !== true,
  )
}

export function isAdvisorAgendaEmptyConfirmed(dataQuality) {
  const domains = dataQuality?.domains
  return Boolean(domains)
    && ADVISOR_AGENDA_DOMAIN_KEYS.every((domain) => isConfirmedAgendaDomain(domains[domain]))
}

export function advisorDomainLabel(domain) {
  const normalized = String(domain || '')
  return ADVISOR_DOMAIN_LABELS[normalized] || normalized.replaceAll('-', ' ') || '未知数据域'
}

export function advisorConfidenceLabel(confidence) {
  return ADVISOR_CONFIDENCE_LABELS[String(confidence || '')] || '未知'
}

export function advisorRequirementSourceLabel(source, requirementSource) {
  if (source === 'categories') return '扁平列表回退'
  if (source !== 'roots') return '结构未知'
  const normalized = String(requirementSource || '').toLowerCase()
  if (normalized.endsWith('inferred-tree')) return '推断树结构'
  if (normalized.includes('api') && (normalized.includes('detail') || normalized.includes('tree'))) {
    return '教务 API 树结构'
  }
  if (normalized.endsWith('dom-tree') || normalized.endsWith('embedded-tree')) {
    return '官方页面树结构'
  }
  return '树结构（来源未确认）'
}

export function isCurrentAdvisorScenarioResponse(response, requestedRevision) {
  return Boolean(
    requestedRevision
    && response
    && typeof response.snapshotRevision === 'string'
    && response.snapshotRevision === requestedRevision,
  )
}

export function advisorDismissKey(snapshotRevision, item) {
  return `dismiss:${String(snapshotRevision || '')}:${itemId(item)}`
}

export function advisorSnoozeKey(snapshotRevision, item) {
  return `snooze:${String(snapshotRevision || '')}:${itemId(item)}:${urgencyBand(item)}`
}

export function hideAdvisorItem(hidden, snapshotRevision, item, mode) {
  const next = new Set(hidden instanceof Set ? hidden : [])
  if (!itemId(item)) return next
  if (mode === 'dismiss' && item?.severity !== 'urgent') {
    next.add(advisorDismissKey(snapshotRevision, item))
  } else if (mode === 'snooze') {
    next.add(advisorSnoozeKey(snapshotRevision, item))
  }
  return next
}

export function isAdvisorItemHidden(hidden, snapshotRevision, item) {
  if (!(hidden instanceof Set) || !itemId(item)) return false
  return hidden.has(advisorDismissKey(snapshotRevision, item))
    || hidden.has(advisorSnoozeKey(snapshotRevision, item))
}

export function visibleAdvisorItems(items, hidden, snapshotRevision, limit = Number.POSITIVE_INFINITY) {
  const maximum = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : Number.POSITIVE_INFINITY
  return (Array.isArray(items) ? items : [])
    .filter((item) => !isAdvisorItemHidden(hidden, snapshotRevision, item))
    .slice(0, maximum)
}
