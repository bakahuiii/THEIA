import { createHash } from 'node:crypto'
import { canonicalDomainId } from './domain-provenance.mjs'
import { AI_EXPORT_SCHEMA } from './ai-export-contract.mjs'

export function iso(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString()
}

export function compactTimestamp(value) {
  const date = new Date(value)
  const part = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}${part(date.getMonth() + 1)}${part(date.getDate())}-${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}`
}

export function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

export function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizedKey(value) {
  return String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase()
}

export function isSensitiveKey(value) {
  const key = normalizedKey(value)
  return [
    'password', 'passcode', 'apikey', 'authorization', 'cookie', 'session',
    'sessionid', 'jsessionid', 'token', 'secret', 'credential', 'privatekey',
    'accesskey', 'protocolpassword',
  ].some((needle) => key === needle || key.includes(needle))
}

export function isLocalPathKey(value) {
  const key = normalizedKey(value)
  return key === 'directory' || key.endsWith('directory') || key === 'path' || key.endsWith('path')
}

export function isErrorKey(value) {
  const key = normalizedKey(value)
  return key === 'error' || key.endsWith('error') || key === 'errors'
}

export function isSourceKey(value) {
  const key = normalizedKey(value)
  return key === 'source' || key.startsWith('source')
}

export function redactedUrl(value) {
  const raw = text(value)
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    url.username = ''
    url.password = ''
    // URLs are provenance, not a request recipe. Dropping every query avoids
    // future endpoints accidentally adding a sensitive, unknown key.
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

export function safeText(value) {
  const raw = text(value)
  if (!raw) return null
  return raw
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => redactedUrl(url) || '[redacted-url]')
    // Do not mistake the trailing "s://" in an already-sanitized https URL
    // for a Windows drive prefix.
    .replace(/(?<![a-z0-9+.-])[a-z]:[\\/][^\r\n"']+/gi, '[local-path]')
    .replace(/\\\\[^\s"']+/g, '[local-path]')
    .replace(/\/(?:Users|home|tmp|var|private)(?:\/[^\s"']*)?/g, '[local-path]')
    .replace(/\bauthorization\s*[:=]\s*(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, 'authorization=[redacted]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, '$1 [redacted]')
    .replace(/\b(password|passcode|token|cookie|authorization|api[_-]?key|secret|session(?:id)?|jsessionid)\s*[=:]\s*[^\s,;]+/gi, '$1=[redacted]')
}

export function sanitizedSource(value) {
  const raw = text(value)
  if (!raw) return null
  // Source labels such as "jwglxt" and "imap" are useful provenance. Only
  // URL-shaped values need URL credential/query/fragment normalization.
  return /^[a-z][a-z\d+.-]*:/i.test(raw) || raw.startsWith('//')
    ? redactedUrl(raw)
    : safeText(raw)
}

export function sanitizedSources(values) {
  const input = Array.isArray(values) ? values : [values]
  return [...new Set(input.map(sanitizedSource).filter((value) => typeof value === 'string' && value.trim()))]
}

/**
 * Remove values which could re-authenticate a school or model service. The
 * campus data itself remains intact; this is deliberately not a redaction of
 * grades, mail bodies, names, student IDs, or other advisor-relevant data.
 */
export function sanitizeForAiExport(value) {
  if (value === null || value === undefined) return value ?? null
  if (Array.isArray(value)) return value.map((item) => sanitizeForAiExport(item))
  if (typeof value === 'string') return safeText(value) ?? ''
  if (typeof value !== 'object') return value

  const result = {}
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (isSensitiveKey(entryKey) || isLocalPathKey(entryKey)) continue
    if (isErrorKey(entryKey)) {
      result[entryKey] = Array.isArray(entryValue)
        ? entryValue.map(safeErrorText).filter(Boolean)
        : safeErrorText(entryValue)
      continue
    }
    if (/url$/i.test(entryKey)) {
      result[entryKey] = redactedUrl(entryValue)
      continue
    }
    if (entryKey === 'sources' && Array.isArray(entryValue)) {
      result[entryKey] = sanitizedSources(entryValue)
      continue
    }
    if (isSourceKey(entryKey)) {
      result[entryKey] = typeof entryValue === 'string'
        ? sanitizedSource(entryValue)
        : sanitizeForAiExport(entryValue)
      continue
    }
    result[entryKey] = sanitizeForAiExport(entryValue)
  }
  return result
}

export function recordCount(value) {
  if (Array.isArray(value)) return value.length
  if (value && typeof value === 'object') {
    if (Array.isArray(value.items)) return value.items.length
    if (Array.isArray(value.records)) return value.records.length
    return Object.keys(value).length
  }
  return value == null ? 0 : 1
}

export function sourcesFrom(items, fallback = []) {
  const sources = new Set(sanitizedSources(fallback))
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (!value || typeof value !== 'object') return
    if (typeof value.source === 'string' && value.source.trim()) {
      const source = sanitizedSource(value.source)
      if (source) sources.add(source)
    }
    for (const child of Object.values(value)) visit(child)
  }
  visit(items)
  return [...sources].sort((left, right) => left.localeCompare(right))
}

export function safeErrorText(value) {
  return safeText(value)?.slice(0, 1_000) ?? null
}

export function collectionAvailability(value, { updatedAt = null, complete = null, warning = null, records: explicitRecords = null } = {}) {
  const records = Number.isFinite(explicitRecords) ? Math.max(0, explicitRecords) : recordCount(value)
  return {
    records,
    updatedAt: updatedAt && Number.isFinite(Date.parse(updatedAt)) ? updatedAt : null,
    state: records ? (complete === false ? 'partial' : 'available') : 'empty',
    ...(warning ? { warning } : {}),
  }
}

export function domainProvenance(state, domain) {
  const key = canonicalDomainId(domain)
  const record = state?.sync?.domains?.[key]
  return record && typeof record === 'object' ? record : null
}

export function domainUpdatedAt(state, domain) {
  const provenance = domainProvenance(state, domain)
  return provenance?.capturedAt || provenance?.sourceSucceededAt || null
}

export function domainCompleteness(state, domain, fallback) {
  const provenance = domainProvenance(state, domain)
  if (!provenance) return 'partial'
  if (provenance.completeness === 'complete') {
    if (provenance.contentEmptyConfirmed === true || provenance.emptyConfirmed === true) {
      return fallback === 'empty' ? 'empty' : 'partial'
    }
    return fallback === 'available' ? 'available' : 'partial'
  }
  if (provenance.completeness === 'partial') return 'partial'
  return 'partial'
}

export function domainAvailability(state, domain, value, options = {}) {
  const availability = collectionAvailability(value, options)
  return { ...availability, state: domainCompleteness(state, domain, availability.state) }
}

export function dataEnvelope(dataset, data, options) {
  const clean = sanitizeForAiExport(data)
  return {
    schema: AI_EXPORT_SCHEMA,
    dataset,
    generatedAt: options.generatedAt,
    updatedAt: options.updatedAt || null,
    recordCount: options.recordCount ?? recordCount(clean),
    sources: sanitizedSources(options.sources || []),
    completeness: options.completeness || 'available',
    ...(options.note ? { note: options.note } : {}),
    data: clean,
  }
}

export function workspaceSummary(workspace) {
  if (!workspace || typeof workspace !== 'object') return null
  return {
    id: workspace.id || null,
    assignmentId: workspace.assignmentId || null,
    courseName: workspace.courseName || null,
    title: workspace.title || null,
    kind: workspace.kind || null,
    dueAt: workspace.dueAt || null,
    sourceUrl: redactedUrl(workspace.sourceUrl),
    state: workspace.state || null,
    attachmentCount: Number(workspace.attachmentCount) || 0,
    questionCount: Number(workspace.questionCount) || 0,
    preparedAt: workspace.preparedAt || null,
    updatedAt: workspace.updatedAt || null,
    lastError: safeErrorText(workspace.lastError),
    lastTestFill: workspace.lastTestFill || null,
    hasAnswerKey: Boolean(workspace.answerKeyPath),
    hasSubmission: Boolean(workspace.submissionPath),
    hasNotes: Boolean(workspace.notesPath),
    hasPaper: Boolean(workspace.paperPath),
    hasModelAnswer: Boolean(workspace.modelAnswerPath),
    modelName: workspace.modelName || null,
    modelProcessedAt: workspace.modelProcessedAt || null,
  }
}

export function textFromHtml(html) {
  return String(html || '')
    .replace(/<\s*(script|style|iframe|object|embed|svg)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

export function mailboxMessageSummary(message) {
  if (!message || typeof message !== 'object') return null
  return {
    id: message.id || null,
    subject: message.subject || '',
    from: message.from || '',
    fromAddress: message.fromAddress || null,
    receivedAt: message.receivedAt || null,
    snippet: message.snippet || null,
    // Preserve readable content without sending rich HTML that can contain
    // remote tracking markup, unsafe links, or renderer-only decorations.
    // Cached plain text may quote a one-time URL. Preserve the readable body
    // while applying the same URL/path/secret cleanup as other free text.
    body: safeText(message.body || textFromHtml(message.bodyHtml)) || null,
    unread: message.unread === true,
    attachments: (Array.isArray(message.attachments) ? message.attachments : []).map((attachment, index) => ({
      index: Number.isInteger(attachment?.index) ? attachment.index : index,
      filename: attachment?.filename || null,
      contentType: attachment?.contentType || null,
      size: Number.isFinite(Number(attachment?.size)) ? Number(attachment.size) : 0,
    })),
    source: sanitizedSource(message.source) || null,
    capturedAt: message.capturedAt || null,
  }
}

export function courseSelectionTargetSummary(target) {
  if (!target || typeof target !== 'object') return null
  const title = typeof target.title === 'string' ? target.title.trim() : ''
  if (!title) return null
  return {
    id: target.id || null,
    termId: target.termId || null,
    classId: target.classId || null,
    courseCode: target.courseCode || null,
    title,
    className: target.className || null,
    teacher: target.teacher || null,
    time: target.time || null,
    location: target.location || null,
    credits: Number.isFinite(Number(target.credits)) ? Number(target.credits) : null,
    chosenAt: target.chosenAt || null,
  }
}

export function courseSelectionSummary(record) {
  if (!record || typeof record !== 'object') return { targets: [], sentinel: null, history: [], updatedAt: null }
  const sentinel = record.sentinel && typeof record.sentinel === 'object'
    ? {
        enabled: record.sentinel.enabled === true,
        startAt: record.sentinel.startAt || null,
        endAt: record.sentinel.endAt || null,
        intervalMs: Number.isFinite(Number(record.sentinel.intervalMs)) ? Number(record.sentinel.intervalMs) : null,
        concurrency: Number.isFinite(Number(record.sentinel.concurrency)) ? Number(record.sentinel.concurrency) : null,
        completedTargetIds: Array.isArray(record.sentinel.completedTargetIds) ? record.sentinel.completedTargetIds.map(String) : [],
      }
    : null
  return {
    targets: (Array.isArray(record.targets) ? record.targets : []).map(courseSelectionTargetSummary).filter(Boolean),
    sentinel,
    history: (Array.isArray(record.history) ? record.history : []).map((entry) => ({
      kind: entry?.kind || 'job',
      at: entry?.at || null,
      jobId: entry?.jobId || null,
      status: entry?.status || null,
      candidate: courseSelectionTargetSummary(entry?.candidate),
      attempts: Number.isFinite(Number(entry?.attempts)) ? Number(entry.attempts) : 0,
      lastMessage: safeErrorText(entry?.lastMessage),
    })),
    updatedAt: record.updatedAt || null,
  }
}

export function syncSummary(sync) {
  const sourceRecords = Object.entries(sync?.sources || {}).map(([name, value]) => [name, {
    ...(value && typeof value === 'object' ? value : {}),
    ...(value?.url ? { url: redactedUrl(value.url) } : {}),
    ...(value?.error ? { error: safeErrorText(value.error) } : {}),
    ...(Array.isArray(value?.errors) ? { errors: value.errors.map(safeErrorText).filter(Boolean) } : {}),
  }])
  return sanitizeForAiExport({
    lastStartedAt: sync?.lastStartedAt || null,
    lastCompletedAt: sync?.lastCompletedAt || null,
    lastRunAt: sync?.lastRunAt || sync?.lastCompletedAt || null,
    lastSuccessAt: sync?.lastSuccessAt || null,
    runId: sync?.runId || null,
    lastError: safeErrorText(sync?.lastError),
    sources: Object.fromEntries(sourceRecords),
    domains: sync?.domains || {},
  })
}

export function catalogMetadata(catalog) {
  const collections = catalog?.collections || {}
  const schoolSchedule = collections.schoolSchedule || {}
  const fitness = collections.fitness || {}
  const calendar = collections.academicCalendar || {}
  return {
    schema: catalog?.schema || null,
    updatedAt: catalog?.updatedAt || null,
    collections: {
      fitness: {
        source: fitness.source || null,
        parserVersion: fitness.parserVersion || null,
        lastRefreshedAt: fitness.lastRefreshedAt || null,
        availableYears: fitness.availableYears || [],
        cachedYears: Object.keys(fitness.records || {}).sort().reverse(),
      },
      schoolSchedule: {
        source: schoolSchedule.source || null,
        parserVersion: schoolSchedule.parserVersion || null,
        lastRefreshedAt: schoolSchedule.lastRefreshedAt || null,
        records: Object.values(schoolSchedule.records || {}).map((record) => ({
          id: record?.id || null,
          scope: record?.scope || null,
          capturedAt: record?.capturedAt || null,
          total: Number(record?.total) || 0,
          count: Array.isArray(record?.items) ? record.items.length : 0,
          complete: record?.complete === true,
          source: record?.source || null,
          parserVersion: record?.parserVersion || null,
        })),
      },
      academicCalendar: {
        source: calendar.source || null,
        parserVersion: calendar.parserVersion || null,
        lastRefreshedAt: calendar.lastRefreshedAt || null,
        assets: calendar.assets || {},
        calendarError: calendar.calendarError || null,
        analysisError: calendar.analysisError || null,
      },
    },
  }
}

export function sourceProvenance(state, availability) {
  const syncSources = state?.sync?.sources || {}
  return {
    schema: 'theia-data-provenance/v1',
    sourcePriority: [
      {
        source: 'academic-api',
        scope: '教务系统学业、课表、考试、成绩与培养方案',
        rule: '启用且可用时优先。未启用或未配置时使用统一身份认证浏览器通道；已启用 API 的本次失败会保留现有本地数据并报告错误。',
      },
      {
        source: 'jwglxt',
        scope: '教务系统前端数据',
        rule: '统一身份认证会话中的学校官方页面采集。',
      },
      {
        source: 'theol',
        scope: '北化在线THEOL作业、在线测试与课程通知',
        rule: '北化在线THEOL同步；过期作业会由应用层过滤。',
      },
      {
        source: 'imap',
        scope: '校园邮箱邮件元数据与按需读取的正文',
        rule: '通过用户配置的邮箱协议凭据本地拉取。',
      },
      {
        source: 'tygl',
        scope: '体质测试历史记录',
        rule: '仅保留已明确获取或用户导入的年度记录。',
      },
      {
        source: 'academic-calendar',
        scope: '校历、教学进度表和工作周历',
        rule: '校教务处公开文件下载后，以本地 OCR 和规则解析。',
      },
      {
        source: 'local-computed',
        scope: 'GPA 趋势、可用性摘要及导出清单',
        rule: '由已导出原始规范化数据计算，不能替代学校原始记录。',
      },
    ],
    synchronization: syncSummary({ ...state?.sync, sources: syncSources }),
    availability,
    interpretationRules: [
      '缺失、空数组和 null 不等于否定事实；它们通常表示尚未同步、权限不足、源站未提供或该数据不适用。',
      '优先使用每个文件的 updatedAt 和 manifest 的 exportedAt 判断新鲜度；不同来源可以有不同更新时间。',
      '判断校园数据是否已成功更新时优先使用 synchronization.lastSuccessAt；lastRunAt 只表示最近一次同步尝试已经结束。',
      'academic-progress.json 的 roots 是培养方案树；relation=and 表示同时满足，relation=or 表示任选或替代分支。',
      'grades.json 的 calculatedGpa 是 THEIA 依据本地规则重新计算的辅助值；学校显示 GPA 以 academic-progress.json 的 gpa 为准。',
      'course-selection.json 记录用户意图和已脱敏的运行历史，不代表已成功选上课程。',
    ],
  }
}
