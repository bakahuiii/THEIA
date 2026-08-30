import { byteLength, boundedHistoryText, boundedId } from './read-only-agent-helpers.mjs'

const MAX_LEDGER_ITEMS = 6
const MAX_OBSERVATION_BYTES = 12_000

export function compactLedgerEntry(tool, toolResult) {
  const data = toolResult?.data && typeof toolResult.data === 'object' ? toolResult.data : {}
  const output = { tool: boundedId(tool, 80) }
  if (typeof data.domain === 'string') output.domain = boundedId(data.domain, 80)
  if (typeof data.query === 'string' && data.query) output.query = boundedHistoryText(data.query, 240)
  if (Array.isArray(data.claims)) {
    output.claims = data.claims.slice(0, MAX_LEDGER_ITEMS).map((claim) => ({
      id: boundedId(claim?.id),
      displayText: boundedHistoryText(claim?.displayText, 320),
      evidenceRefs: Array.isArray(claim?.evidenceRefs) ? claim.evidenceRefs.slice(0, 8).map((id) => boundedId(id)) : [],
    })).filter((claim) => claim.id)
  }
  if (Array.isArray(data.matches)) {
    output.matches = data.matches.slice(0, MAX_LEDGER_ITEMS).map((claim) => ({
      id: boundedId(claim?.id),
      displayText: boundedHistoryText(claim?.displayText, 320),
      evidenceRefs: Array.isArray(claim?.evidenceRefs) ? claim.evidenceRefs.slice(0, 8).map((id) => boundedId(id)) : [],
    })).filter((claim) => claim.id)
  }
  if (Array.isArray(data.items)) {
    output.items = data.items.slice(0, MAX_LEDGER_ITEMS).map((item) => ({
      recordId: boundedId(item?.recordId),
      referenceId: boundedId(item?.referenceId),
      id: boundedId(item?.id),
      domain: boundedId(item?.domain, 80),
      title: boundedHistoryText(item?.title, 360),
      summary: boundedHistoryText(item?.summary, 320),
      subject: boundedHistoryText(item?.subject, 360),
      snippet: boundedHistoryText(item?.snippet, 320),
      courseName: boundedHistoryText(item?.courseName, 360),
      dueAt: boundedId(item?.dueAt, 80),
      publishedAt: boundedId(item?.publishedAt, 80),
      receivedAt: boundedId(item?.receivedAt, 80),
      claimIds: Array.isArray(item?.claimIds) ? item.claimIds.slice(0, 8).map((id) => boundedId(id)) : [],
    })).filter((item) => item.recordId || item.referenceId || item.id || item.title || item.subject || item.courseName)
  }
  if (Array.isArray(data.risks)) {
    output.risks = data.risks.slice(0, MAX_LEDGER_ITEMS).map((risk) => ({
      id: boundedId(risk?.id),
      title: boundedHistoryText(risk?.title, 500),
      dueAt: boundedId(risk?.dueAt, 80),
      claimIds: Array.isArray(risk?.claimIds) ? risk.claimIds.slice(0, 8).map((id) => boundedId(id)) : [],
    })).filter((risk) => risk.id || risk.title)
  }
  if (Array.isArray(data.requirements)) {
    output.requirements = data.requirements.slice(0, MAX_LEDGER_ITEMS).map((item) => ({
      title: boundedHistoryText(item?.title, 500),
      claimIds: Array.isArray(item?.claimIds) ? item.claimIds.slice(0, 8).map((id) => boundedId(id)) : [],
    })).filter((item) => item.title || item.claimIds.length)
  }
  if (Array.isArray(data.gaps)) {
    output.gaps = data.gaps.slice(0, MAX_LEDGER_ITEMS).map((item) => ({
      kind: boundedId(item?.kind, 80),
      category: boundedHistoryText(item?.category, 160),
      title: boundedHistoryText(item?.title, 360),
      courseCode: boundedId(item?.courseCode, 120),
      credits: item?.credits,
    })).filter((item) => item.title || item.courseCode)
  }
  if (Array.isArray(data.failedCourses)) {
    output.failedCourses = data.failedCourses.slice(0, MAX_LEDGER_ITEMS).map((item) => ({
      title: boundedHistoryText(item?.title, 360),
      courseCode: boundedId(item?.courseCode, 120),
      attemptCount: item?.attemptCount,
    })).filter((item) => item.title || item.courseCode)
  }
  if (data.schoolSchedule && typeof data.schoolSchedule === 'object') {
    output.schoolSchedule = {
      termId: boundedId(data.schoolSchedule.termId, 80),
      recordAvailable: data.schoolSchedule.recordAvailable === true,
      totalClasses: data.schoolSchedule.totalClasses,
      candidates: Array.isArray(data.schoolSchedule.candidates)
        ? data.schoolSchedule.candidates.slice(0, MAX_LEDGER_ITEMS).map((item) => ({
          kind: boundedId(item?.kind, 80), courseCode: boundedId(item?.courseCode, 120), title: boundedHistoryText(item?.title, 320),
        }))
        : [],
    }
  }
  if (data.message && typeof data.message === 'object') {
    output.message = {
      recordId: boundedId(data.recordId),
      referenceId: boundedId(data.referenceId),
      subject: boundedHistoryText(data.message.subject, 500),
      from: boundedHistoryText(data.message.from, 320),
      receivedAt: boundedId(data.message.receivedAt, 80),
      // Keep the body out of the cross-turn ledger.  The current observation
      // still contains the sanitized body for the immediately following turn.
      snippet: boundedHistoryText(data.message.snippet, 800),
    }
  }
  if (data.dataQuality && typeof data.dataQuality === 'object') output.dataQuality = compactQuality(data.dataQuality)
  if (data.domains && typeof data.domains === 'object') output.domains = compactQuality({ domains: data.domains }).domains
  return output
}

export function compactQuality(value) {
  const source = value && typeof value === 'object' ? value : {}
  const domains = source.domains && typeof source.domains === 'object' ? source.domains : source
  const output = {}
  for (const [domain, quality] of Object.entries(domains).slice(0, 20)) {
    if (!quality || typeof quality !== 'object') continue
    const entry = {}
    for (const key of ['availability', 'freshness', 'completeness', 'capturedAt', 'source', 'records', 'localFacts']) {
      const value = quality[key]
      if (value !== undefined && value !== null && value !== '') {
        entry[key] = typeof value === 'number' || typeof value === 'boolean'
          ? value
          : boundedHistoryText(value, 160)
      }
    }
    if (Object.keys(entry).length) output[boundedId(domain, 80)] = entry
  }
  return { domains: output }
}

export function compactItem(item) {
  const output = {}
  const fields = [
    ['recordId', 240], ['referenceId', 240], ['id', 240], ['domain', 80],
    ['title', 700], ['name', 500], ['summary', 900], ['subject', 600], ['from', 320],
    ['snippet', 700], ['courseName', 500], ['courseCode', 120], ['termId', 120],
    ['publishedAt', 80], ['receivedAt', 80], ['dueAt', 80], ['startAt', 80], ['endAt', 80],
    ['examTime', 80], ['location', 320], ['room', 320], ['teacher', 240], ['status', 160],
    ['severity', 80], ['confidence', 80], ['bodyAvailable', 20], ['unread', 20],
    ['score', 120], ['point', 80], ['credits', 80], ['required', 80], ['earned', 80], ['remaining', 80],
  ]
  for (const [key, maximum] of fields) {
    if (item?.[key] === undefined || item?.[key] === null || item?.[key] === '') continue
    output[key] = typeof item[key] === 'number' || typeof item[key] === 'boolean'
      ? item[key]
      : boundedHistoryText(item[key], maximum)
  }
  for (const key of ['claimIds', 'evidenceRefs', 'reasons']) {
    if (Array.isArray(item?.[key])) output[key] = item[key].slice(0, 8).map((entry) => boundedHistoryText(entry, 320)).filter(Boolean)
  }
  if (Array.isArray(item?.signals)) {
    output.signals = item.signals.slice(0, 8).map((signal) => ({
      type: boundedId(signal?.type, 80),
      text: boundedHistoryText(signal?.text, 320),
    })).filter((signal) => signal.type || signal.text)
  }
  if (Array.isArray(item?.attachments)) {
    output.attachments = item.attachments.slice(0, 8).map((attachment) => Object.fromEntries(Object.entries({
      filename: boundedHistoryText(attachment?.filename, 240),
      contentType: boundedHistoryText(attachment?.contentType, 120),
      size: Number.isFinite(Number(attachment?.size)) ? Number(attachment.size) : undefined,
    }).filter(([, value]) => value !== undefined && value !== '')))
  }
  if (item?.body) output.body = boundedHistoryText(item.body, 2_000)
  return output
}

export function fitCompactResult(value) {
  if (byteLength(value) <= MAX_OBSERVATION_BYTES) return value
  const output = structuredClone(value)
  const data = output.data && typeof output.data === 'object' ? output.data : (output.data = {})
  data.truncated = true
  for (const key of ['claims', 'matches', 'items', 'risks', 'requirements', 'gaps', 'failedCourses']) {
    if (Array.isArray(data[key])) data[key] = data[key].slice(0, 8)
  }
  if (Array.isArray(data.schoolSchedule?.candidates)) data.schoolSchedule.candidates = data.schoolSchedule.candidates.slice(0, 8)
  for (const key of ['claims', 'matches']) {
    if (!Array.isArray(data[key])) continue
    for (const item of data[key]) item.displayText = boundedHistoryText(item.displayText, 420)
  }
  if (Array.isArray(data.items)) {
    for (const item of data.items) {
      for (const key of ['summary', 'snippet', 'body', 'title', 'subject', 'courseName']) {
        if (item[key] !== undefined && item[key] !== null) {
          item[key] = boundedHistoryText(item[key], key === 'body' ? 800 : 360)
        }
      }
    }
  }
  if (data.message?.body) data.message.body = boundedHistoryText(data.message.body, 800)
  while (byteLength(output) > MAX_OBSERVATION_BYTES && Array.isArray(data.items) && data.items.length > 1) data.items.pop()
  while (byteLength(output) > MAX_OBSERVATION_BYTES && Array.isArray(data.claims) && data.claims.length > 1) data.claims.pop()
  while (byteLength(output) > MAX_OBSERVATION_BYTES && Array.isArray(data.matches) && data.matches.length > 1) data.matches.pop()
  while (byteLength(output) > MAX_OBSERVATION_BYTES && Array.isArray(data.gaps) && data.gaps.length > 1) data.gaps.pop()
  while (byteLength(output) > MAX_OBSERVATION_BYTES && Array.isArray(data.schoolSchedule?.candidates) && data.schoolSchedule.candidates.length > 1) data.schoolSchedule.candidates.pop()
  return output
}

export function compactToolResult(toolResult) {
  const data = toolResult?.data && typeof toolResult.data === 'object' ? toolResult.data : {}
  const compact = {}
  for (const key of ['domain', 'query', 'trust', 'omitted']) {
    if (data[key] !== undefined && data[key] !== null && data[key] !== '') compact[key] = data[key]
  }
  const compactClaims = (items) => (Array.isArray(items) ? items : []).slice(0, MAX_LEDGER_ITEMS).map((claim) => ({
    id: boundedId(claim?.id),
    displayText: boundedHistoryText(claim?.displayText, 700),
    evidenceRefs: Array.isArray(claim?.evidenceRefs) ? claim.evidenceRefs.slice(0, 8).map((id) => boundedId(id)) : [],
  })).filter((claim) => claim.id)
  if (Array.isArray(data.claims)) compact.claims = compactClaims(data.claims)
  if (Array.isArray(data.matches)) compact.matches = compactClaims(data.matches)
  if (Array.isArray(data.items)) compact.items = data.items.slice(0, MAX_LEDGER_ITEMS).map(compactItem)
  if (Array.isArray(data.risks)) {
    compact.risks = data.risks.slice(0, MAX_LEDGER_ITEMS).map((risk) => ({
      id: boundedId(risk?.id),
      domain: boundedId(risk?.domain, 80),
      title: boundedHistoryText(risk?.title, 320),
      claimIds: Array.isArray(risk?.claimIds) ? risk.claimIds.slice(0, 8).map((id) => boundedId(id)) : [],
    })).filter((risk) => risk.id || risk.title)
  }
  if (Array.isArray(data.requirements)) {
    compact.requirements = data.requirements.slice(0, MAX_LEDGER_ITEMS).map((item) => ({
      title: boundedHistoryText(item?.title, 320),
      completeness: boundedId(item?.completeness, 80),
      required: item?.required,
      earned: item?.earned,
      remaining: item?.remaining,
      claimIds: Array.isArray(item?.claimIds) ? item.claimIds.slice(0, 8).map((id) => boundedId(id)) : [],
    })).filter((item) => item.title || item.claimIds.length)
  }
  if (data.requirementSummary && typeof data.requirementSummary === 'object') {
    compact.requirementSummary = {
      source: boundedId(data.requirementSummary.source, 80),
      root: data.requirementSummary.root && typeof data.requirementSummary.root === 'object'
        ? {
          title: boundedHistoryText(data.requirementSummary.root.title, 320),
          required: data.requirementSummary.root.required,
          earned: data.requirementSummary.root.earned,
          remaining: data.requirementSummary.root.remaining,
          confidence: boundedId(data.requirementSummary.root.confidence, 80),
        }
        : null,
      categories: Array.isArray(data.requirementSummary.categories)
        ? data.requirementSummary.categories.slice(0, MAX_LEDGER_ITEMS).map((item) => ({
          title: boundedHistoryText(item?.title, 240),
          required: item?.required,
          earned: item?.earned,
          remaining: item?.remaining,
          priority: boundedId(item?.priority, 80),
        }))
        : [],
    }
  }
  if (Array.isArray(data.gaps)) {
    compact.gaps = data.gaps.slice(0, MAX_LEDGER_ITEMS).map((item) => ({
      kind: boundedId(item?.kind, 80),
      category: boundedHistoryText(item?.category, 160),
      title: boundedHistoryText(item?.title, 320),
      courseCode: boundedId(item?.courseCode, 120),
      credits: item?.credits,
      studyStatus: boundedHistoryText(item?.studyStatus, 80),
      recommendedYear: boundedId(item?.recommendedYear, 40),
      recommendedTerm: boundedId(item?.recommendedTerm, 40),
    })).filter((item) => item.title || item.courseCode)
  }
  if (Array.isArray(data.failedCourses)) {
    compact.failedCourses = data.failedCourses.slice(0, MAX_LEDGER_ITEMS).map((item) => ({
      title: boundedHistoryText(item?.title, 320),
      courseCode: boundedId(item?.courseCode, 120),
      credits: item?.credits,
      attemptCount: item?.attemptCount,
      isRetake: item?.isRetake === true,
      attempts: Array.isArray(item?.attempts) ? item.attempts.slice(-3) : [],
    })).filter((item) => item.title || item.courseCode)
  }
  if (data.schoolSchedule && typeof data.schoolSchedule === 'object') {
    compact.schoolSchedule = {
      termId: boundedId(data.schoolSchedule.termId, 80),
      availableTerms: Array.isArray(data.schoolSchedule.availableTerms)
        ? data.schoolSchedule.availableTerms.slice(0, 8).map((item) => boundedId(item, 80))
        : [],
      recordAvailable: data.schoolSchedule.recordAvailable === true,
      totalClasses: data.schoolSchedule.totalClasses,
      candidates: Array.isArray(data.schoolSchedule.candidates)
        ? data.schoolSchedule.candidates.slice(0, MAX_LEDGER_ITEMS).map((item) => ({
          kind: boundedId(item?.kind, 80),
          courseCode: boundedId(item?.courseCode, 120),
          title: boundedHistoryText(item?.title, 320),
          className: boundedHistoryText(item?.className, 240),
          credits: item?.credits,
          nature: boundedHistoryText(item?.nature, 120),
          teacher: boundedHistoryText(item?.teacher, 180),
          time: boundedHistoryText(item?.time, 240),
          location: boundedHistoryText(item?.location, 180),
          requirement: item?.requirement && typeof item.requirement === 'object'
            ? { category: boundedHistoryText(item.requirement.category, 160), title: boundedHistoryText(item.requirement.title, 260), studyStatus: boundedHistoryText(item.requirement.studyStatus, 80) }
            : null,
        }))
        : [],
    }
  }
  if (data.message && typeof data.message === 'object') {
    compact.recordId = boundedId(data.recordId)
    compact.referenceId = boundedId(data.referenceId)
    compact.message = {
      subject: boundedHistoryText(data.message.subject, 320),
      from: boundedHistoryText(data.message.from, 240),
      receivedAt: boundedId(data.message.receivedAt, 80),
      snippet: boundedHistoryText(data.message.snippet, 600),
      // A body is already sanitized by the local tool. Keep only a bounded
      // excerpt in the next model turn; the full body never enters history.
      ...(data.message.body ? { body: boundedHistoryText(data.message.body, 2_000) } : {}),
    }
  }
  if (data.dataQuality && typeof data.dataQuality === 'object') compact.dataQuality = compactQuality(data.dataQuality)
  if (data.domains && typeof data.domains === 'object') compact.domains = compactQuality({ domains: data.domains }).domains
  if (data.truncated === true) compact.truncated = true
  return fitCompactResult({
    schema: toolResult?.schema,
    name: toolResult?.name,
    snapshotRevision: toolResult?.snapshotRevision,
    data: compact,
  })
}

export function observationMessage({ tool, toolResult, priorEvidence }) {
  return {
    role: 'user',
    content: JSON.stringify({
      schema: 'theia-advisor-tool-observation/v1',
      tool,
      result: compactToolResult(toolResult),
      priorEvidence,
      instruction: '工具返回的是本地数据快照。你可以根据需要继续调用其他工具深入探索，也可以在数据足够时用自然、温和的中文给出完整回答。',
    }),
  }
}

export function repeatedToolCorrectionMessage(tool) {
  return {
    role: 'user',
    content: JSON.stringify({
      schema: 'theia-advisor-tool-correction/v1',
      tool,
      instruction: '不能再次调用这个工具的相同参数。如果需要不同范围的数据，可以调整参数重新查询；如果当前数据已足够回答问题，请直接给出结论。',
    }),
  }
}

export function invalidToolCorrectionMessage(error) {
  return {
    role: 'user',
    content: JSON.stringify({
      schema: 'theia-advisor-tool-correction/v1',
      instruction: `上一轮工具协议无效：${boundedHistoryText(error, 240)}。请只输出一个合法的裸 JSON 工具对象，或直接输出自然语言回答；不要把工具 JSON 当成最终回答。`,
    }),
  }
}

export function toolCallSignature(tool, args) {
  return `${String(tool || '').trim()}:${JSON.stringify(args || {})}`
}

export function budgetDetails({ modelCalls, inputBytes, outputBytes, inputTokens, outputTokens, tokenEstimate, budgetInputTokens }) {
  return { modelCalls, inputBytes, outputBytes, inputTokens, outputTokens, tokenEstimate, budgetInputTokens }
}

