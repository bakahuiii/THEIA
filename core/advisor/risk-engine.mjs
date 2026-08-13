import { canonicalDigest, compareCanonicalText, normalizeText, parseCampusInstant, shortDigest, uniqueSorted } from './canonical.mjs'
import { normalizeAdvisorOptions, normalizeVersionedSnapshot } from './contracts.mjs'

const CRITICAL_DATA_DOMAINS = new Set(['academic-progress', 'assignments', 'exams', 'grades'])

function riskId(kind, entityId, rulesVersion) {
  return `risk:${kind}:${shortDigest({ kind, entityId: normalizeText(entityId), rulesVersion }, 16)}`
}

const LOCAL_CLAIM_SCHEMA = 'theia-advisor-local-claim/v1'

function claimId({ kind, subject, predicate, domainDigest, evidenceDigest = null, fields, rulesVersion }) {
  return `claim1:${kind}:${shortDigest({
    schema: LOCAL_CLAIM_SCHEMA,
    kind,
    subject,
    predicate,
    domainDigest,
    ...(evidenceDigest ? { evidenceDigest } : {}),
    fields,
    rulesVersion,
  }, 20)}`
}

function localClaim({ kind = 'fact', subject, predicate, value, displayText, evidenceRefs, confidence, caveats = [], rulesVersion, domainDigest, evidenceDigest = null, fields }) {
  const normalizedSubject = normalizeText(subject, { trim: true })
  const normalizedDisplayText = normalizeText(displayText, { trim: true })
  const normalizedEvidenceRefs = uniqueSorted(evidenceRefs)
  const normalizedCaveats = uniqueSorted(caveats)
  return Object.freeze({
    id: claimId({
      kind,
      subject: normalizedSubject,
      predicate,
      domainDigest,
      evidenceDigest,
      fields: uniqueSorted(fields),
      rulesVersion,
    }),
    kind,
    subject: normalizedSubject,
    predicate,
    value,
    displayText: normalizedDisplayText,
    evidenceRefs: normalizedEvidenceRefs,
    confidence,
    caveats: normalizedCaveats,
    rulesVersion,
  })
}

function claimConfidence(quality) {
  if (!quality || quality.provenanceInferred) return 'unknown'
  if (quality.lastAttempt?.status === 'failed' || quality.lastAttempt?.status === 'auth-required') {
    return quality.lastAttempt.retainedPrevious && quality.availability === 'available' ? 'low' : 'unknown'
  }
  if (quality.freshness === 'fresh' && quality.completeness === 'complete') return 'high'
  if (quality.freshness === 'fresh' || quality.availability === 'available') return 'medium'
  return 'unknown'
}

function qualitySummary(quality) {
  return {
    availability: quality?.availability || 'unknown',
    freshness: quality?.freshness || 'unknown',
    completeness: quality?.completeness || 'unknown',
    lastAttemptStatus: quality?.lastAttempt?.status || 'never',
  }
}

function registerDomainEvidence(registry, quality) {
  const fields = [
    'availability',
    'freshness',
    'completeness',
    'recordCount',
    'contentEmptyConfirmed',
    'lastAttempt.status',
    'lastAttempt.emptyConfirmed',
    'lastAttempt.retainedPrevious',
    'lastAttempt.errorCode',
  ]
  const qualityEvidenceDigest = canonicalDigest({
    domain: quality.domain,
    availability: quality.availability,
    freshness: quality.freshness,
    completeness: quality.completeness,
    capturedAt: quality.capturedAt,
    sourceSucceededAt: quality.sourceSucceededAt,
    source: quality.source,
    parserVersion: quality.parserVersion,
    recordCount: quality.recordCount,
    contentEmptyConfirmed: quality.contentEmptyConfirmed,
    contentDigest: quality.contentDigest,
    lastAttempt: quality.lastAttempt,
    provenanceInferred: quality.provenanceInferred,
  })
  const evidence = registry.register({
    dataset: 'sync-domain',
    domain: quality.domain,
    entityId: quality.domain,
    fields,
    capturedAt: quality.capturedAt,
    source: quality.source[0] || null,
    label: `${quality.domain} data quality`,
    evidenceDigest: qualityEvidenceDigest,
  })
  registry.disclose(evidence.id, fields)
  return evidence
}

function dataQualityReasons(quality) {
  const reasons = []
  if (quality.lastAttempt.status === 'auth-required') reasons.push('最近一次读取需要重新登录')
  else if (quality.lastAttempt.status === 'failed') reasons.push('最近一次读取失败')
  if (quality.lastAttempt.retainedPrevious) reasons.push('失败后保留了较早的本地数据')
  if (quality.freshness === 'stale') reasons.push('已有数据超过当前领域的新鲜度阈值')
  if (quality.completeness === 'partial') reasons.push('来源只确认了部分数据')
  if (quality.completeness === 'unknown') reasons.push('来源没有提供可验证的完整性结论')
  if (quality.availability === 'unknown') reasons.push('当前空值不能解释为已确认没有记录')
  if (quality.provenanceInferred) reasons.push('该快照早于逐领域证据合同，时效与完整性均未知')
  return uniqueSorted(reasons)
}

function dataQualityRisk(quality, registry, rulesVersion) {
  const why = dataQualityReasons(quality)
  if (!why.length) return null
  const critical = CRITICAL_DATA_DOMAINS.has(quality.domain)
  const hardFailure = ['failed', 'auth-required'].includes(quality.lastAttempt.status)
  if (!critical && !hardFailure && quality.freshness !== 'stale' && quality.completeness !== 'partial') return null
  const evidence = registerDomainEvidence(registry, quality)
  const severity = critical && hardFailure ? 'urgent' : (quality.freshness === 'stale' || quality.completeness === 'partial' || critical ? 'attention' : 'info')
  const suggestedAction = quality.lastAttempt.status === 'auth-required'
    ? '重新登录对应校园来源后再同步'
    : '重新同步并检查该领域的数据状态'
  const claim = localClaim({
    subject: quality.domain,
    predicate: 'data-quality-severity',
    value: { type: 'severity', value: severity },
    displayText: `${quality.domain} 数据可信度：${severity}`,
    evidenceRefs: [evidence.id],
    confidence: quality.provenanceInferred ? 'high' : 'high',
    caveats: why,
    rulesVersion,
    domainDigest: evidence.domainDigest,
    evidenceDigest: evidence.evidenceDigest,
    fields: evidence.fields,
  })
  return {
    risk: Object.freeze({
      id: riskId('data-quality', quality.domain, rulesVersion),
      kind: 'data-quality',
      entityId: `domain:${quality.domain}`,
      domain: quality.domain,
      severity,
      title: `${quality.domain} 数据暂不能作为完整实时依据`,
      why,
      evidenceRefs: [evidence.id],
      claimIds: [claim.id],
      dueAt: null,
      deadlineBand: 'unknown',
      actionable: true,
      suggestedAction,
      actionKind: quality.lastAttempt.status === 'auth-required' ? 'reauthenticate' : 'resync',
      impactClass: critical ? 'blocking-data-repair' : 'reminder',
      delayCostClass: 'recoverable-refresh',
      quality: qualitySummary(quality),
      rulesVersion,
    }),
    claims: [claim],
  }
}

function deadlineBand(deltaMilliseconds) {
  if (deltaMilliseconds < 0) return 'overdue'
  if (deltaMilliseconds < 24 * 60 * 60 * 1000) return 'critical'
  if (deltaMilliseconds < 72 * 60 * 60 * 1000) return 'soon'
  return 'normal'
}

function deadlineSeverity(band) {
  if (band === 'overdue' || band === 'critical') return 'urgent'
  if (band === 'soon') return 'attention'
  return 'info'
}

function timeValidityCaveat(quality, label) {
  if (quality?.provenanceInferred) return `${label}仅来自旧版快照记录，当前有效性未知`
  if (quality?.freshness === 'unknown') return `${label}缺少可验证的采集水位，当前有效性未知`
  if (quality?.completeness === 'unknown') return `${label}来自完整性未知的数据，当前有效性未知`
  if (quality?.completeness === 'partial') return `${label}来自部分读取结果，当前有效性需要人工确认`
  if (quality?.lastAttempt?.status === 'failed') return `${label}在最近一次同步失败后未获重新确认，当前有效性未知`
  if (quality?.lastAttempt?.status === 'auth-required') return `${label}在最近一次同步要求重新登录后未获重新确认，当前有效性未知`
  return null
}

function assignmentRisks(state, quality, registry, { now, timeZone, rulesVersion }) {
  const risks = []
  const claims = []
  const nowMilliseconds = Date.parse(now)
  for (const assignment of Array.isArray(state.assignments) ? state.assignments : []) {
    if (!assignment || typeof assignment !== 'object') continue
    if (normalizeText(assignment.status, { trim: true }).toLowerCase() === 'submitted') continue
    const entityId = assignment.id || shortDigest({ courseId: assignment.courseId, title: assignment.title }, 20)
    const subject = `assignment:${shortDigest(entityId, 16)}`
    const fields = ['title', 'courseName', 'dueAt', 'status', 'capturedAt']
    const evidence = registry.register({
      dataset: 'assignments',
      domain: 'assignments',
      entityId,
      fields,
      capturedAt: assignment.capturedAt,
      source: assignment.source,
      label: assignment.title || '课程作业',
    })
    registry.disclose(evidence.id, fields)
    const parsedDueAt = parseCampusInstant(assignment.dueAt, { timeZone })
    if (!parsedDueAt) {
      const claim = localClaim({
        subject,
        predicate: 'deadline-known',
        value: { type: 'boolean', value: false },
        displayText: `${assignment.title || '课程作业'}的截止时间尚未确认`,
        evidenceRefs: [evidence.id],
        confidence: 'high',
        caveats: ['不会按列表位置或文本顺序猜测截止时间'],
        rulesVersion,
        domainDigest: quality.contentDigest,
        fields: evidence.fields,
      })
      claims.push(claim)
      risks.push(Object.freeze({
        id: riskId('assignment-deadline-unknown', entityId, rulesVersion),
        kind: 'assignment',
        entityId: subject,
        domain: 'assignments',
        severity: 'attention',
        title: `${assignment.title || '课程作业'}的截止时间未能确认`,
        why: ['来源记录没有可解析的截止时间'],
        evidenceRefs: [evidence.id],
        claimIds: [claim.id],
        dueAt: null,
        deadlineBand: 'unknown',
        actionable: true,
        suggestedAction: '打开北化在线THEOL来源详情并人工确认截止时间',
        actionKind: 'open-source-detail',
        impactClass: 'deadline-assignment',
        delayCostClass: 'information-only',
        quality: qualitySummary(quality),
        rulesVersion,
      }))
      continue
    }

    const delta = parsedDueAt.milliseconds - nowMilliseconds
    const band = deadlineBand(delta)
    const minutesRemaining = Math.floor(delta / 60_000)
    const caveats = []
    const validityCaveat = timeValidityCaveat(quality, '截止时间')
    if (validityCaveat) caveats.push(validityCaveat)
    if (quality.freshness === 'stale') caveats.push('截止时间来自已过新鲜度阈值的本地数据')
    if (quality.lastAttempt.status === 'failed') caveats.push('最近一次任务同步失败')
    if (quality.lastAttempt.status === 'auth-required') caveats.push('最近一次任务同步需要重新登录')
    const deadlineClaim = localClaim({
      subject,
      predicate: 'due-at',
      value: { type: 'instant', value: parsedDueAt.iso, timeZone },
      displayText: validityCaveat
        ? `记录显示 ${assignment.title || '课程作业'}截止于 ${parsedDueAt.iso}，当前有效性未知`
        : `${assignment.title || '课程作业'}截止于 ${parsedDueAt.iso}`,
      evidenceRefs: [evidence.id],
      confidence: claimConfidence(quality),
      caveats,
      rulesVersion,
      domainDigest: quality.contentDigest,
      fields: ['dueAt'],
    })
    const countdownClaim = localClaim({
      kind: 'computed',
      subject,
      predicate: 'minutes-remaining',
      value: { type: 'duration', value: String(minutesRemaining), unit: 'minute' },
      displayText: validityCaveat
        ? (band === 'overdue' ? `按旧记录计算已超过截止时间 ${Math.abs(minutesRemaining)} 分钟，当前有效性未知` : `按旧记录计算距截止时间 ${minutesRemaining} 分钟，当前有效性未知`)
        : (band === 'overdue' ? `已超过记录中的截止时间 ${Math.abs(minutesRemaining)} 分钟` : `距记录中的截止时间 ${minutesRemaining} 分钟`),
      evidenceRefs: [evidence.id],
      confidence: claimConfidence(quality),
      caveats,
      rulesVersion,
      domainDigest: quality.contentDigest,
      fields: ['dueAt'],
    })
    claims.push(deadlineClaim, countdownClaim)
    risks.push(Object.freeze({
      id: riskId('assignment-deadline', entityId, rulesVersion),
      kind: 'assignment',
      entityId: subject,
      domain: 'assignments',
      severity: validityCaveat ? 'attention' : deadlineSeverity(band),
      title: validityCaveat
        ? `${assignment.title || '课程作业'}有一条未经当前同步确认的截止记录`
        : band === 'overdue' ? `${assignment.title || '课程作业'}已超过记录中的截止时间` : `${assignment.title || '课程作业'}临近截止`,
      why: uniqueSorted([
        band === 'overdue'
          ? '记录中的截止时间已经过去，当前是否仍可提交需要人工确认'
          : validityCaveat ? `按记录计算截止时间处于 ${band} 分段` : `截止时间处于 ${band} 分段`,
        ...caveats,
      ]),
      evidenceRefs: [evidence.id],
      claimIds: [deadlineClaim.id, countdownClaim.id],
      dueAt: parsedDueAt.iso,
      deadlineBand: validityCaveat ? 'unknown' : band,
      actionable: true,
      suggestedAction: validityCaveat ? '打开北化在线THEOL来源详情并确认截止记录仍然有效' : '打开课程任务并确认完成与提交状态',
      actionKind: validityCaveat ? 'open-source-detail' : 'review-assignment',
      impactClass: 'deadline-assignment',
      delayCostClass: validityCaveat ? 'information-only' : band === 'overdue' ? 'manual-recovery' : 'irrecoverable-window',
      quality: qualitySummary(quality),
      rulesVersion,
    }))
  }
  return { risks, claims }
}

function examRisks(state, quality, registry, { now, timeZone, rulesVersion }) {
  const risks = []
  const claims = []
  const nowMilliseconds = Date.parse(now)
  for (const exam of Array.isArray(state.exams) ? state.exams : []) {
    if (!exam || typeof exam !== 'object') continue
    const entityId = exam.id || shortDigest({ courseId: exam.courseId, courseName: exam.courseName, examTime: exam.examTime }, 20)
    const subject = `exam:${shortDigest(entityId, 16)}`
    const fields = ['courseName', 'examType', 'startAt', 'examTime', 'endAt', 'location', 'campus', 'capturedAt']
    const evidence = registry.register({
      dataset: 'exams',
      domain: 'exams',
      entityId,
      fields,
      capturedAt: exam.capturedAt,
      source: exam.source,
      label: exam.courseName || '考试',
    })
    registry.disclose(evidence.id, fields)
    const startAt = parseCampusInstant(exam.startAt, { timeZone })
    const examTime = parseCampusInstant(exam.examTime, { timeZone })
    const effective = startAt || examTime
    if (!effective) {
      const claim = localClaim({
        subject,
        predicate: 'start-time-known',
        value: { type: 'boolean', value: false },
        displayText: `${exam.courseName || '考试'}的开始时间尚未确认`,
        evidenceRefs: [evidence.id],
        confidence: 'high',
        caveats: ['不会使用字符串顺序猜测考试时间'],
        rulesVersion,
        domainDigest: quality.contentDigest,
        fields: ['startAt', 'examTime'],
      })
      claims.push(claim)
      risks.push(Object.freeze({
        id: riskId('exam-time-unknown', entityId, rulesVersion),
        kind: 'exam',
        entityId: subject,
        domain: 'exams',
        severity: 'attention',
        title: `${exam.courseName || '考试'}的时间未能确认`,
        why: ['startAt 与 examTime 均不可解析'],
        evidenceRefs: [evidence.id],
        claimIds: [claim.id],
        dueAt: null,
        deadlineBand: 'unknown',
        actionable: true,
        suggestedAction: '打开教务考试安排并人工确认时间',
        actionKind: 'open-source-detail',
        impactClass: 'exam',
        delayCostClass: 'information-only',
        quality: qualitySummary(quality),
        rulesVersion,
      }))
      continue
    }
    const delta = effective.milliseconds - nowMilliseconds
    if (delta < 0) continue
    const band = deadlineBand(delta)
    const caveats = []
    const validityCaveat = timeValidityCaveat(quality, '考试时间')
    if (validityCaveat) caveats.push(validityCaveat)
    if (startAt && examTime && Math.abs(startAt.milliseconds - examTime.milliseconds) > 60_000) {
      caveats.push('startAt 与 examTime 冲突，倒计时按 startAt 计算')
    }
    if (quality.freshness === 'stale') caveats.push('考试时间来自已过新鲜度阈值的本地数据')
    if (quality.lastAttempt.status === 'failed') caveats.push('最近一次考试安排同步失败')
    if (quality.lastAttempt.status === 'auth-required') caveats.push('最近一次考试安排同步需要重新登录')
    const minutesRemaining = Math.floor(delta / 60_000)
    const startClaim = localClaim({
      subject,
      predicate: 'start-at',
      value: { type: 'instant', value: effective.iso, timeZone },
      displayText: validityCaveat
        ? `记录显示 ${exam.courseName || '考试'}开始于 ${effective.iso}，当前有效性未知`
        : `${exam.courseName || '考试'}开始于 ${effective.iso}`,
      evidenceRefs: [evidence.id],
      confidence: claimConfidence(quality),
      caveats,
      rulesVersion,
      domainDigest: quality.contentDigest,
      fields: startAt ? ['startAt', ...(examTime ? ['examTime'] : [])] : ['examTime'],
    })
    const countdownClaim = localClaim({
      kind: 'computed',
      subject,
      predicate: 'minutes-until-start',
      value: { type: 'duration', value: String(minutesRemaining), unit: 'minute' },
      displayText: validityCaveat
        ? `按旧记录计算距 ${exam.courseName || '考试'}开始 ${minutesRemaining} 分钟，当前有效性未知`
        : `距 ${exam.courseName || '考试'}开始 ${minutesRemaining} 分钟`,
      evidenceRefs: [evidence.id],
      confidence: claimConfidence(quality),
      caveats,
      rulesVersion,
      domainDigest: quality.contentDigest,
      fields: startAt ? ['startAt'] : ['examTime'],
    })
    claims.push(startClaim, countdownClaim)
    risks.push(Object.freeze({
      id: riskId('exam-countdown', entityId, rulesVersion),
      kind: 'exam',
      entityId: subject,
      domain: 'exams',
      severity: validityCaveat ? 'attention' : deadlineSeverity(band),
      title: validityCaveat ? `${exam.courseName || '考试'}有一条未经当前同步确认的时间记录` : `${exam.courseName || '考试'}倒计时`,
      why: uniqueSorted([validityCaveat ? `按记录计算考试开始时间处于 ${band} 分段` : `考试开始时间处于 ${band} 分段`, ...caveats]),
      evidenceRefs: [evidence.id],
      claimIds: [startClaim.id, countdownClaim.id],
      dueAt: effective.iso,
      deadlineBand: validityCaveat ? 'unknown' : band,
      actionable: true,
      suggestedAction: validityCaveat ? '打开教务考试安排并确认该时间记录仍然有效' : '核对考试地点、时间并安排复习与出发',
      actionKind: validityCaveat ? 'open-source-detail' : 'prepare-exam',
      impactClass: 'exam',
      delayCostClass: validityCaveat ? 'information-only' : 'irrecoverable-window',
      quality: qualitySummary(quality),
      rulesVersion,
    }))
  }
  return { risks, claims }
}

export function evaluateRisks(versionedSnapshot, { dataQuality, evidenceRegistry, ...options }) {
  if (!dataQuality || !evidenceRegistry) throw new TypeError('dataQuality and evidenceRegistry are required')
  const versioned = normalizeVersionedSnapshot(versionedSnapshot)
  const normalizedOptions = normalizeAdvisorOptions(options)
  const risks = []
  const claims = []
  for (const quality of Object.values(dataQuality.domains || {})) {
    const result = dataQualityRisk(quality, evidenceRegistry, normalizedOptions.rulesVersion)
    if (result) {
      risks.push(result.risk)
      claims.push(...result.claims)
    }
  }
  const assignments = assignmentRisks(versioned.snapshot, dataQuality.domains?.assignments || {}, evidenceRegistry, normalizedOptions)
  const exams = examRisks(versioned.snapshot, dataQuality.domains?.exams || {}, evidenceRegistry, normalizedOptions)
  risks.push(...assignments.risks, ...exams.risks)
  claims.push(...assignments.claims, ...exams.claims)
  return {
    risks: risks.sort((left, right) => compareCanonicalText(left.id, right.id)),
    claims: claims.sort((left, right) => compareCanonicalText(left.id, right.id)),
  }
}
