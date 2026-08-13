import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { computeGpa, computeGpaTrend } from './gpa.mjs'
import { canonicalDomainId } from './domain-provenance.mjs'

export const AI_EXPORT_SCHEMA = 'theia-ai-context/v1'
export const AI_EXPORT_MANIFEST_SCHEMA = 'theia-ai-export-manifest/v1'

function iso(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString()
}

function compactTimestamp(value) {
  const date = new Date(value)
  const part = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}${part(date.getMonth() + 1)}${part(date.getDate())}-${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}`
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizedKey(value) {
  return String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function isSensitiveKey(value) {
  const key = normalizedKey(value)
  return [
    'password', 'passcode', 'apikey', 'authorization', 'cookie', 'session',
    'sessionid', 'jsessionid', 'token', 'secret', 'credential', 'privatekey',
    'accesskey', 'protocolpassword',
  ].some((needle) => key === needle || key.includes(needle))
}

function isLocalPathKey(value) {
  const key = normalizedKey(value)
  return key === 'directory' || key.endsWith('directory') || key === 'path' || key.endsWith('path')
}

function isErrorKey(value) {
  const key = normalizedKey(value)
  return key === 'error' || key.endsWith('error') || key === 'errors'
}

function isSourceKey(value) {
  const key = normalizedKey(value)
  return key === 'source' || key.startsWith('source')
}

function redactedUrl(value) {
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

function safeText(value) {
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

function sanitizedSource(value) {
  const raw = text(value)
  if (!raw) return null
  // Source labels such as "jwglxt" and "imap" are useful provenance. Only
  // URL-shaped values need URL credential/query/fragment normalization.
  return /^[a-z][a-z\d+.-]*:/i.test(raw) || raw.startsWith('//')
    ? redactedUrl(raw)
    : safeText(raw)
}

function sanitizedSources(values) {
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

function recordCount(value) {
  if (Array.isArray(value)) return value.length
  if (value && typeof value === 'object') {
    if (Array.isArray(value.items)) return value.items.length
    if (Array.isArray(value.records)) return value.records.length
    return Object.keys(value).length
  }
  return value == null ? 0 : 1
}

function sourcesFrom(items, fallback = []) {
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

function safeErrorText(value) {
  return safeText(value)?.slice(0, 1_000) ?? null
}

function collectionAvailability(value, { updatedAt = null, complete = null, warning = null, records: explicitRecords = null } = {}) {
  const records = Number.isFinite(explicitRecords) ? Math.max(0, explicitRecords) : recordCount(value)
  return {
    records,
    updatedAt: updatedAt && Number.isFinite(Date.parse(updatedAt)) ? updatedAt : null,
    state: records ? (complete === false ? 'partial' : 'available') : 'empty',
    ...(warning ? { warning } : {}),
  }
}

function domainProvenance(state, domain) {
  const key = canonicalDomainId(domain)
  const record = state?.sync?.domains?.[key]
  return record && typeof record === 'object' ? record : null
}

function domainUpdatedAt(state, domain) {
  const provenance = domainProvenance(state, domain)
  return provenance?.capturedAt || provenance?.sourceSucceededAt || null
}

function domainCompleteness(state, domain, fallback) {
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

function domainAvailability(state, domain, value, options = {}) {
  const availability = collectionAvailability(value, options)
  return { ...availability, state: domainCompleteness(state, domain, availability.state) }
}

function dataEnvelope(dataset, data, options) {
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

function workspaceSummary(workspace) {
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

function textFromHtml(html) {
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

function mailboxMessageSummary(message) {
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

function courseSelectionTargetSummary(target) {
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

function courseSelectionSummary(record) {
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

function syncSummary(sync) {
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

function catalogMetadata(catalog) {
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

function sourceProvenance(state, availability) {
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

function aiContextMarkdown({ generatedAt, appVersion, availability, manifestName }) {
  const availabilityRows = Object.entries(availability)
    .map(([name, value]) => `| \`${name}\` | ${value.state} | ${value.records} | ${value.updatedAt || 'unknown'} |`)
    .join('\n')
  return `# THEIA AI Context Export\n\n` +
    `This directory is an offline, structured snapshot exported by THEIA. It is intended for an AI academic advisor, not for browser automation or platform submission. Read \`${manifestName}\` first, verify every listed SHA-256 digest, then read only the files relevant to the question.\n\n` +
    `- Contract: \`${AI_EXPORT_SCHEMA}\`\n` +
    `- Exported at: \`${generatedAt}\`\n` +
    `- Producer: THEIA \`${appVersion || 'unknown'}\`\n` +
    `- Time zone for user-facing interpretation: \`Asia/Shanghai\`\n\n` +
    `## Reading Order\n\n` +
    `1. \`manifest.json\`: integrity, file inventory, source freshness, and excluded sensitive data.\n` +
    `2. \`DATA_DICTIONARY.md\`: dataset fields, relationships, and null semantics.\n` +
    `3. \`profile.json\`, \`academic.json\`, \`academic-progress.json\`, and \`grades.json\`: identity context, courses, degree requirements, grades, and GPA summaries.\n` +
    `4. \`calendar.json\`, \`schedule.json\`, \`exams.json\`, and \`coursework.json\`: time-sensitive study planning.\n` +
    `5. \`notices.json\`, \`mailbox.json\`, \`fitness.json\`, \`school-schedule.json\`, and \`course-selection.json\` only when relevant.\n` +
    `6. \`provenance.json\` when judging conflicts, missing data, or freshness.\n\n` +
    `Every JSON dataset uses the same envelope: \`schema\`, \`dataset\`, \`generatedAt\`, \`updatedAt\`, \`recordCount\`, \`sources\`, \`completeness\`, and \`data\`. Treat \`data\` as the payload. A null field means the source did not provide a usable value.\n\n` +
    `## Academic Semantics\n\n` +
    `- Term IDs conventionally use \`YYYY-3\`, \`YYYY-12\`, and \`YYYY-16\` for first, second, and third terms. Read the term label in \`academic.json\` rather than assuming the label.\n` +
    `- \`academic-progress.json.data.roots\` is the authoritative hierarchy for plan interpretation. A node with \`relation: "or"\` is an alternative branch; do not sum every alternative as though all are required.\n` +
    `- \`grades.json\` preserves school grades. \`calculatedGpa\` is a reproducible helper calculation, while \`academic-progress.json.data.gpa\` is the GPA reported by the school. Explain any discrepancy rather than silently choosing one.\n` +
    `- Course-work records describe preparation and local result state. They do not grant permission to submit work or fill tests automatically.\n\n` +
    `## Safety Boundary\n\n` +
    `This export intentionally excludes passwords, cookies, session identifiers, API keys, client authorization passwords, browser storage, raw login pages, and local absolute file paths. It may contain personal academic data and mail content. Do not expose it outside the user's chosen model service, infer credentials, attempt school-platform actions, or treat a dated snapshot as live enrollment authority.\n\n` +
    `## Dataset Availability\n\n| Dataset | State | Records | Latest data time |\n| --- | --- | ---: | --- |\n${availabilityRows}\n`
}

function dataDictionaryMarkdown() {
  return `# THEIA AI Export Data Dictionary\n\n` +
    `All JSON datasets use the \`${AI_EXPORT_SCHEMA}\` envelope. The actual payload is always in \`data\`; \`recordCount\` counts the primary collection and can be zero even when metadata is present.\n\n` +
    `## Shared Envelope\n\n` +
    `| Field | Meaning |\n| --- | --- |\n| \`schema\` | Always \`${AI_EXPORT_SCHEMA}\`. |\n| \`dataset\` | Stable dataset identifier matching the file domain. |\n| \`generatedAt\` | UTC instant at which the whole package was built. |\n| \`updatedAt\` | Latest known source timestamp for this dataset, or \`null\`. |\n| \`recordCount\` | Count of primary records represented by \`data\`. |\n| \`sources\` | Source identifiers or source URLs after credential-safe normalization. |\n| \`completeness\` | \`available\`, \`partial\`, or \`empty\`; never assume \`empty\` means the school has no such data. |\n| \`data\` | Dataset payload. |\n\n` +
    `## Academic Files\n\n` +
    `| File | Payload | Important fields and relationships |\n| --- | --- | --- |\n| \`profile.json\` | Profile or \`null\` | \`studentId\`, \`academicClass\`, and \`academicTrack\` help interpret calendar teaching-schedule matching. |\n| \`academic.json\` | \`terms\`, \`courses\`, \`selectedCourses\` | \`term.id\` links schedule, grades, exams, and selections. Course codes are normalized when available. |\n| \`schedule.json\` | ScheduleItem[] | \`termId\`, \`courseId\`, \`weekday\`, \`period\`, \`weeks\`, \`startAt\`, and \`endAt\` may coexist; do not invent missing dates from weekly text. |\n| \`grades.json\` | \`grades\`, \`calculatedGpa\`, \`calculatedTrend\`, \`schoolReportedGpa\` | Grade \`termId\`, \`courseCode\`, \`score\`, \`credits\`, and \`point\` support explanation. School GPA and locally calculated GPA are intentionally separate. |\n| \`academic-progress.json\` | AcademicProgress or \`null\` | \`roots\` is a requirement tree. \`relation: and\` means requirements combine; \`relation: or\` means alternative paths. A course may appear under one branch without making every sibling mandatory. |\n| \`exams.json\` | Exam[] | Prefer \`startAt\`/\`endAt\`; otherwise retain \`examTime\` as source text. \`remark\` may state special handling such as absence or exemption. |\n\n` +
    `## Work, Communication, and Local Records\n\n` +
    `| File | Payload | Important fields and limits |\n| --- | --- | --- |\n| \`coursework.json\` | \`assignments\`, sanitized \`workspaces\` | Assignment \`dueAt\` and \`status\` are time-sensitive. Workspace booleans indicate local artifacts exist but no path or artifact content is exported. |\n| \`notices.json\` | Notice[] | \`publishedAt\`, \`summary\`, \`source\`, and credential-safe \`sourceUrl\`. |\n| \`mailbox.json\` | MailMessage[] | Includes already-local text body or text extracted from cached HTML. It excludes IMAP UID, remote marker, rich HTML, and attachment binary content. Attachments are metadata only. |\n| \`fitness.json\` | \`availableYears\`, \`records\` | Records are keyed by fitness \`yearKey\`; \`refreshState: empty\` means the selected archive year had no measurements. |\n| \`calendar.json\` | Official calendar metadata, structured calendar, and PDF analysis | \`calendar.semesters\`, \`vacations\`, \`specialDates\`, and analysis fields are local rule/OCR output. Confirm anomalies against source freshness and parser errors. |\n| \`school-schedule.json\` | Locally cached school-wide schedule records | A record has \`scope\`, \`items\`, \`total\`, and \`complete\`. Only \`complete: true\` represents a verified full term scan. |\n| \`course-selection.json\` | Saved targets, sentinel settings, and safe history | This is intent and observed lifecycle history, not enrollment proof or a request credential. |\n| \`sync.json\` | Sync state | \`lastSuccessAt\` is the latest fully successful refresh; \`lastRunAt\` is only the latest completed attempt. Status text is sanitized. |\n| \`local-data-catalog.json\` | Cache metadata summary | Points to available local domains without exporting binary assets. |\n| \`provenance.json\` | Source rules and availability | Resolve source precedence and partial-data caveats here. |\n\n` +
    `## Time and Missing Data\n\n` +
    `Timestamps are ISO-8601 UTC unless a source field explicitly carries an unparsed human-readable time string. Interpret user-facing calendars in \`Asia/Shanghai\`. Do not convert \`null\`, an empty array, or a failed source status into a claim that an event, requirement, grade, or email does not exist. State the snapshot timestamp and uncertainty in any consequential recommendation.\n`
}

function asJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

/**
 * Build an immutable file map for an AI-facing export. This pure function is
 * shared by Electron, CLI, and tests so the privacy boundary is consistent.
 */
export function createAiExportBundle({ state, courseSelection = null, appVersion = null, generatedAt = new Date() } = {}) {
  const exportedAt = iso(generatedAt)
  const snapshot = state && typeof state === 'object' ? state : {}
  const catalog = snapshot.dataCatalog || {}
  const catalogCollections = catalog.collections || {}
  const fitness = catalogCollections.fitness || {}
  const schoolSchedule = catalogCollections.schoolSchedule || {}
  const academicCalendar = catalogCollections.academicCalendar || {}
  const workspaces = (Array.isArray(snapshot.workspaces) ? snapshot.workspaces : []).map(workspaceSummary).filter(Boolean)
  const grades = Array.isArray(snapshot.grades) ? snapshot.grades : []
  const gpaTrend = computeGpaTrend(grades, Array.isArray(snapshot.terms) ? snapshot.terms : [])
  const mailbox = (Array.isArray(snapshot.emails) ? snapshot.emails : []).map(mailboxMessageSummary).filter(Boolean)
  const courseSelectionSummaryValue = courseSelectionSummary(courseSelection)
  const availability = {
    profile: domainAvailability(snapshot, 'profile', snapshot.profile, { updatedAt: domainUpdatedAt(snapshot, 'profile'), records: snapshot.profile ? 1 : 0 }),
    academic: domainAvailability(snapshot, 'academic', { terms: snapshot.terms || [], courses: snapshot.courses || [], selectedCourses: snapshot.selectedCourses || [] }, {
      updatedAt: domainUpdatedAt(snapshot, 'academic'),
      records: (snapshot.terms?.length || 0) + (snapshot.courses?.length || 0) + (snapshot.selectedCourses?.length || 0),
    }),
    schedule: domainAvailability(snapshot, 'schedule', snapshot.schedule || [], { updatedAt: domainUpdatedAt(snapshot, 'schedule') }),
    grades: domainAvailability(snapshot, 'grades', grades, { updatedAt: domainUpdatedAt(snapshot, 'grades') }),
    academicProgress: domainAvailability(snapshot, 'academic-progress', snapshot.academicProgress, { updatedAt: domainUpdatedAt(snapshot, 'academic-progress'), records: snapshot.academicProgress ? 1 : 0 }),
    exams: domainAvailability(snapshot, 'exams', snapshot.exams || [], { updatedAt: domainUpdatedAt(snapshot, 'exams') }),
    coursework: domainAvailability(snapshot, 'coursework', snapshot.assignments || [], {
      updatedAt: domainUpdatedAt(snapshot, 'coursework'),
      records: (snapshot.assignments?.length || 0) + workspaces.length,
    }),
    notices: domainAvailability(snapshot, 'notices', snapshot.notices || [], { updatedAt: domainUpdatedAt(snapshot, 'notices') }),
    mailbox: domainAvailability(snapshot, 'mailbox', mailbox, { updatedAt: domainUpdatedAt(snapshot, 'mailbox') }),
    fitness: domainAvailability(snapshot, 'fitness', fitness.records || {}, { updatedAt: domainUpdatedAt(snapshot, 'fitness'), records: Object.keys(fitness.records || {}).length }),
    schoolSchedule: domainAvailability(snapshot, 'school-schedule', schoolSchedule.records || {}, {
      updatedAt: domainUpdatedAt(snapshot, 'school-schedule'),
      records: Object.keys(schoolSchedule.records || {}).length,
      complete: Object.values(schoolSchedule.records || {}).every((record) => record?.complete === true),
    }),
    calendar: domainAvailability(snapshot, 'academic-calendar', academicCalendar.calendar || academicCalendar.analysis || null, { updatedAt: domainUpdatedAt(snapshot, 'academic-calendar'), records: academicCalendar.calendar || academicCalendar.analysis ? 1 : 0 }),
    courseSelection: collectionAvailability(courseSelectionSummaryValue.targets, {
      updatedAt: courseSelectionSummaryValue.updatedAt || null,
      records: courseSelectionSummaryValue.targets.length + courseSelectionSummaryValue.history.length,
    }),
  }

  const dataFiles = new Map([
    ['profile.json', dataEnvelope('profile', snapshot.profile || null, {
      generatedAt: exportedAt,
      updatedAt: availability.profile.updatedAt,
      sources: sourcesFrom(snapshot.profile, ['jwglxt']),
      completeness: domainCompleteness(snapshot, 'profile', availability.profile.state),
      recordCount: snapshot.profile ? 1 : 0,
      note: 'Basic student profile retained because it helps connect degree-plan and calendar context.',
    })],
    ['academic.json', dataEnvelope('academic', {
      terms: snapshot.terms || [],
      courses: snapshot.courses || [],
      selectedCourses: snapshot.selectedCourses || [],
    }, {
      generatedAt: exportedAt,
      updatedAt: availability.academic.updatedAt,
      sources: sourcesFrom([snapshot.courses || [], snapshot.selectedCourses || []], ['jwglxt']),
      completeness: domainCompleteness(snapshot, 'academic', availability.academic.state),
      recordCount: (snapshot.terms?.length || 0) + (snapshot.courses?.length || 0) + (snapshot.selectedCourses?.length || 0),
    })],
    ['schedule.json', dataEnvelope('schedule', snapshot.schedule || [], {
      generatedAt: exportedAt,
      updatedAt: availability.schedule.updatedAt,
      sources: sourcesFrom(snapshot.schedule || [], ['jwglxt']),
      completeness: domainCompleteness(snapshot, 'schedule', availability.schedule.state),
    })],
    ['grades.json', dataEnvelope('grades', {
      grades,
      calculatedGpa: computeGpa(grades),
      calculatedTrend: gpaTrend,
      schoolReportedGpa: snapshot.academicProgress?.gpa ?? snapshot.profile?.gpa ?? null,
    }, {
      generatedAt: exportedAt,
      updatedAt: availability.grades.updatedAt,
      sources: sourcesFrom(grades, ['jwglxt']),
      completeness: domainCompleteness(snapshot, 'grades', availability.grades.state),
      recordCount: grades.length,
      note: 'calculatedGpa and calculatedTrend are local helper calculations; preserve schoolReportedGpa as a separate value.',
    })],
    ['academic-progress.json', dataEnvelope('academic-progress', snapshot.academicProgress || null, {
      generatedAt: exportedAt,
      updatedAt: availability.academicProgress.updatedAt,
      sources: ['academic-api', 'jwglxt'],
      completeness: domainCompleteness(snapshot, 'academic-progress', availability.academicProgress.state),
      recordCount: snapshot.academicProgress ? 1 : 0,
      note: 'roots is a hierarchical degree-plan tree. relation=and means all branches are required; relation=or means alternatives.',
    })],
    ['exams.json', dataEnvelope('exams', snapshot.exams || [], {
      generatedAt: exportedAt,
      updatedAt: availability.exams.updatedAt,
      sources: sourcesFrom(snapshot.exams || [], ['jwglxt']),
      completeness: domainCompleteness(snapshot, 'exams', availability.exams.state),
    })],
    ['coursework.json', dataEnvelope('coursework', {
      assignments: snapshot.assignments || [],
      workspaces,
    }, {
      generatedAt: exportedAt,
      updatedAt: availability.coursework.updatedAt,
      sources: sourcesFrom(snapshot.assignments || [], ['theol']),
      completeness: domainCompleteness(snapshot, 'coursework', availability.coursework.state),
      recordCount: (snapshot.assignments?.length || 0) + workspaces.length,
      note: 'Workspace file locations and generated attachment contents are intentionally omitted; boolean flags describe their local availability.',
    })],
    ['notices.json', dataEnvelope('notices', snapshot.notices || [], {
      generatedAt: exportedAt,
      updatedAt: availability.notices.updatedAt,
      sources: sourcesFrom(snapshot.notices || [], ['jwglxt', 'theol']),
      completeness: domainCompleteness(snapshot, 'notices', availability.notices.state),
    })],
    ['mailbox.json', dataEnvelope('mailbox', mailbox, {
      generatedAt: exportedAt,
      updatedAt: availability.mailbox.updatedAt,
      sources: sourcesFrom(mailbox, ['imap']),
      completeness: domainCompleteness(snapshot, 'mailbox', availability.mailbox.state),
      note: 'Mail bodies and attachment metadata can be present; attachment files themselves are never copied into this export.',
    })],
    ['fitness.json', dataEnvelope('fitness', {
      availableYears: fitness.availableYears || [],
      records: fitness.records || {},
    }, {
      generatedAt: exportedAt,
      updatedAt: availability.fitness.updatedAt,
      sources: sourcesFrom(fitness.records || {}, ['tygl']),
      completeness: domainCompleteness(snapshot, 'fitness', availability.fitness.state),
      recordCount: Object.keys(fitness.records || {}).length,
    })],
    ['school-schedule.json', dataEnvelope('school-schedule', schoolSchedule.records || {}, {
      generatedAt: exportedAt,
      updatedAt: availability.schoolSchedule.updatedAt,
      sources: sourcesFrom(schoolSchedule.records || {}, ['jwglxt']),
      completeness: domainCompleteness(snapshot, 'school-schedule', availability.schoolSchedule.state),
      recordCount: Object.keys(schoolSchedule.records || {}).length,
      note: 'Each cached record may contain a complete locally searchable term catalogue; record.complete identifies verified full scans.',
    })],
    ['calendar.json', dataEnvelope('academic-calendar', academicCalendar, {
      generatedAt: exportedAt,
      updatedAt: availability.calendar.updatedAt,
      sources: sourcesFrom(academicCalendar, ['academic-calendar']),
      completeness: domainCompleteness(snapshot, 'academic-calendar', availability.calendar.state),
      recordCount: academicCalendar.calendar ? 1 : 0,
      note: 'Calendar and PDF analysis are local rule/OCR results from official public calendar assets.',
    })],
    ['course-selection.json', dataEnvelope('course-selection', courseSelectionSummaryValue, {
      generatedAt: exportedAt,
      updatedAt: courseSelectionSummaryValue.updatedAt || null,
      sources: ['local-user-input'],
      completeness: availability.courseSelection.state,
      recordCount: courseSelectionSummaryValue.targets.length + courseSelectionSummaryValue.history.length,
      note: 'Targets are saved user intent. A target or sentinel history does not prove enrollment success.',
    })],
    ['sync.json', dataEnvelope('synchronization', syncSummary(snapshot.sync), {
      generatedAt: exportedAt,
      updatedAt: snapshot.sync?.lastRunAt || snapshot.sync?.lastCompletedAt || snapshot.sync?.lastSuccessAt || snapshot.updatedAt,
      sources: Object.keys(snapshot.sync?.sources || {}),
      completeness: (snapshot.sync?.lastRunAt || snapshot.sync?.lastCompletedAt) ? 'available' : 'partial',
      recordCount: Object.keys(snapshot.sync?.sources || {}).length,
    })],
    ['local-data-catalog.json', dataEnvelope('local-data-catalog', catalogMetadata(catalog), {
      generatedAt: exportedAt,
      updatedAt: domainUpdatedAt(snapshot, 'local-data-catalog'),
      sources: sourcesFrom(catalogMetadata(catalog), ['local-computed']),
      completeness: domainCompleteness(snapshot, 'local-data-catalog', collectionAvailability(catalogMetadata(catalog)).state),
    })],
    ['provenance.json', dataEnvelope('provenance', sourceProvenance(snapshot, availability), {
      generatedAt: exportedAt,
      updatedAt: snapshot.updatedAt || null,
      sources: ['local-computed'],
      completeness: 'available',
    })],
  ])

  const serialized = new Map()
  for (const [path, value] of dataFiles) serialized.set(path, asJson(value))

  const manifestName = 'manifest.json'
  const contextName = 'AI_CONTEXT.md'
  const dictionaryName = 'DATA_DICTIONARY.md'
  const context = aiContextMarkdown({ generatedAt: exportedAt, appVersion: appVersion || snapshot.appVersion || null, availability, manifestName })
  serialized.set(contextName, context)
  serialized.set(dictionaryName, dataDictionaryMarkdown())

  const files = [...serialized.entries()].map(([path, content]) => {
    const parsed = path.endsWith('.json') ? JSON.parse(content) : null
    return {
      path,
      mediaType: path.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'application/json; charset=utf-8',
      bytes: Buffer.byteLength(content),
      sha256: sha256(content),
      dataset: parsed?.dataset || 'ai-context',
      recordCount: parsed?.recordCount ?? null,
      updatedAt: parsed?.updatedAt ?? exportedAt,
      sources: parsed?.sources ?? [],
    }
  })
  const manifest = {
    schema: AI_EXPORT_MANIFEST_SCHEMA,
    exportSchema: AI_EXPORT_SCHEMA,
    exportedAt,
    timeZone: 'Asia/Shanghai',
    producer: {
      name: 'THEIA',
      version: appVersion || snapshot.appVersion || null,
      stateSchema: snapshot.schema || null,
      stateUpdatedAt: snapshot.updatedAt || null,
    },
    layout: 'multi-file-json-with-markdown-context',
    files,
    availability,
    privacy: {
      contains: [
        'personal academic records',
        'course schedule and examination arrangements',
        'academic-plan requirements',
        '北化在线THEOL assignments and notices',
        'mail metadata and any locally loaded mail bodies',
        'fitness and academic-calendar records when available',
      ],
      excluded: [
        'passwords and client authorization passwords',
        'cookies, JSESSIONID values, and browser session storage',
        'model API keys and academic API credentials',
        'raw authentication pages and login HTML',
        'local absolute file paths and attachment binary files',
      ],
      handling: 'Keep this directory local or transfer it only to a model service explicitly chosen by the user.',
    },
    integrity: {
      algorithm: 'SHA-256',
      instruction: 'Verify every manifest.files[].sha256 against the UTF-8 file before using the snapshot.',
    },
  }
  serialized.set(manifestName, asJson(manifest))

  return {
    schema: AI_EXPORT_SCHEMA,
    exportedAt,
    directoryName: `THEIA-AI-EXPORT-${compactTimestamp(exportedAt)}`,
    files: serialized,
    manifest,
  }
}

async function nextDestination(root, requested) {
  let candidate = resolve(root, requested)
  let index = 2
  while (existsSync(candidate)) {
    candidate = resolve(root, `${requested}-${String(index).padStart(2, '0')}`)
    index += 1
  }
  return candidate
}

/** Write the complete package atomically into a fresh child directory. */
export async function writeAiExport({ destinationRoot, ...options } = {}) {
  if (!destinationRoot) throw new Error('An AI export destination directory is required')
  const bundle = createAiExportBundle(options)
  const parent = resolve(destinationRoot)
  await mkdir(parent, { recursive: true })
  const destination = await nextDestination(parent, bundle.directoryName)
  const temporary = resolve(parent, `.${bundle.directoryName}-${randomUUID()}.partial`)
  try {
    await mkdir(temporary, { recursive: true })
    for (const [relativePath, content] of bundle.files) {
      const target = resolve(temporary, relativePath)
      const offset = relative(temporary, target)
      if (!offset || offset.startsWith('..') || isAbsolute(offset)) throw new Error(`Invalid AI export path: ${relativePath}`)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, content, 'utf8')
    }
    await rename(temporary, destination)
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(() => {})
    throw error
  }
  return {
    directory: destination,
    manifest: bundle.manifest,
    files: bundle.manifest.files.length,
  }
}
