import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const componentFiles = {
  quality: '../src/components/advisor/DataQualityBar.tsx',
  topAction: '../src/components/advisor/TopAction.tsx',
  riskList: '../src/components/advisor/RiskList.tsx',
  evidence: '../src/components/advisor/EvidenceDrawer.tsx',
  view: '../src/views/AdvisorView.tsx',
}

const sources = Object.fromEntries(await Promise.all(
  Object.entries(componentFiles).map(async ([key, file]) => [
    key,
    await readFile(new URL(file, import.meta.url), 'utf8'),
  ]),
))

const workbenchSource = await readFile(
  new URL('../src/components/advisor/AdvisorWorkbench.tsx', import.meta.url),
  'utf8',
)
const advisorMessageSource = await readFile(
  new URL('../src/components/advisor/AdvisorMessage.tsx', import.meta.url),
  'utf8',
)

test('advisor primitives consume the existing overview contracts without defining shadow data models', () => {
  assert.match(sources.quality, /AdvisorDomainQuality[\s\S]*AdvisorOverview/)
  assert.match(sources.topAction, /AdvisorUrgentItem/)
  assert.match(sources.riskList, /AdvisorRisk, AdvisorUrgentItem/)
  assert.match(sources.evidence, /AdvisorEvidence/)
  for (const source of Object.values(sources)) {
    assert.doesNotMatch(source, /interface Advisor(?:Overview|Evidence|UrgentItem|DomainQuality)\s*\{/)
  }
})

test('data quality states are visible text and use a palette separate from risk severity', () => {
  for (const label of [
    '可用性未知',
    '新鲜度未知',
    '完整性未知',
    '数据部分完整',
    '数据已过期',
    '最近读取失败',
    '需要重新登录',
  ]) assert.match(sources.quality, new RegExp(label))

  assert.match(sources.quality, /data-quality-state=/)
  assert.match(sources.quality, /fuchsia-[0-9]/)
  assert.doesNotMatch(sources.quality, /SEVERITY|severity\.classes/)
  assert.match(sources.topAction, /border-red-[0-9]/)
  assert.match(sources.riskList, /border-amber-[0-9]/)
})

test('empty states fail closed when data is unknown, partial, or failed', () => {
  assert.match(sources.quality, /不能把空集合解释为没有记录/)
  assert.match(sources.topAction, /当前本地快照未能确认今日行动/)
  assert.match(sources.topAction, /未知、部分或失败的来源不能解释为没有事项/)
  assert.match(sources.riskList, /当前本地快照未能确认行动列表/)
  assert.match(sources.riskList, /未知、部分或读取失败的来源不能解释为没有事项/)
  assert.match(sources.topAction, /emptyState = "unconfirmed"/)
  assert.match(sources.riskList, /emptyState = "unconfirmed"/)
  assert.match(sources.view, /overview\.urgentItems\.length === 0/)
  assert.match(sources.view, /isAdvisorAgendaEmptyConfirmed\(overview\.dataQuality\)/)
  assert.doesNotMatch(sources.view, /Object\.values\(overview\?\.dataQuality\.domains/)
})

test('session-hidden actions have a distinct empty state and never claim that risk is absent', () => {
  assert.match(sources.view, /overview\.urgentItems\.length > 0/)
  assert.match(sources.view, /actions\.length === 0/)
  assert.match(sources.view, /\? "hidden-all"/)
  assert.match(sources.view, /emptyState=\{agendaEmptyState\}/)
  for (const source of [sources.topAction, sources.riskList]) {
    assert.match(source, /"confirmed" \| "unconfirmed" \| "hidden-all"/)
    assert.match(source, /本次会话的行动已全部隐藏/)
    assert.match(source, /原始快照仍包含行动/)
    assert.match(source, /这不表示当前没有风险/)
  }
})

test('advisor actions are fixed local callbacks and never turn generated text into links', () => {
  for (const source of [sources.topAction, sources.riskList]) {
    assert.match(source, /resync: \{ label: "重新同步"/)
    assert.match(source, /reauthenticate: \{ label: "前往登录"/)
    assert.match(source, /"open-source-detail": \{ label: "打开来源详情"/)
    assert.match(source, /onClick=\{\(\) => onAction\(item\)\}/)
    assert.doesNotMatch(source, /href=|<a\b|window\.open|sourceUrl/)
  }
})

test('top action and Top 7 list expose evidence and session display controls', () => {
  assert.match(sources.topAction, /首要行动 · Top 1/)
  assert.match(sources.topAction, /为什么排第一/)
  assert.match(sources.topAction, /onShowEvidence\(item\.evidenceRefs, item\)/)
  assert.match(sources.topAction, /onSnooze\(item\)/)
  assert.match(sources.topAction, /onDismiss\(item\)/)
  assert.match(sources.riskList, /maxItems = 7/)
  assert.match(sources.riskList, /items\.slice\(0, Math\.max\(0, maxItems\)\)/)
  assert.match(sources.riskList, /onShowEvidence\(item\.evidenceRefs, item\)/)
  assert.match(sources.topAction, /item\.severity !== "urgent"/)
  assert.match(sources.riskList, /item\.severity !== "urgent"/)
})

test('evidence drawer renders only safe evidence metadata and provides an accessible close command', () => {
  for (const label of ['已披露字段', '来源：', '捕获时间未知', '证据质量']) {
    assert.match(sources.evidence, new RegExp(label))
  }
  assert.match(sources.evidence, /UNSAFE_FIELD_PATTERN/)
  assert.match(sources.evidence, /path\|url\|uri\|token\|cookie\|secret\|password/)
  assert.match(sources.evidence, /showCloseButton=\{false\}/)
  assert.match(sources.evidence, /aria-label="关闭证据详情"/)
  assert.doesNotMatch(
    sources.evidence,
    /entry\.(?:entityId|snapshotRevision|domainDigest|evidenceDigest)|href=|<a\b|window\.open|sourceUrl/,
  )
})

test('all primitives reserve responsive width and wrap long user-facing text', () => {
  for (const source of Object.values(sources)) {
    assert.match(source, /min-w-0/)
    assert.match(source, /break-words|overflow-wrap:anywhere/)
  }
  assert.match(sources.quality, /grid-cols-1[\s\S]*sm:grid-cols-2[\s\S]*xl:grid-cols-3/)
  assert.match(sources.riskList, /grid-cols-\[2rem_minmax\(0,1fr\)\]/)
  assert.match(sources.evidence, /w-\[min\(100vw,34rem\)\]/)
})

test('loading, retry, and long safe errors have explicit stable states', () => {
  for (const source of Object.values(sources)) {
    assert.match(source, /loading/)
  }
  assert.match(sources.quality, /onRetry/)
  assert.match(sources.topAction, /safeErrorMessage\(error\)/)
  assert.match(sources.riskList, /safeErrorMessage\(error\)/)
  assert.match(sources.evidence, /当前本地证据读取失败/)
})

test('advisor what-if UI rejects stale revisions and shares the IPC credit limit', () => {
  const revisionReset = sources.view.match(
    /useEffect\(\(\) => \{\s*scenarioRequestSequence\.current \+= 1;[\s\S]*?\}, \[overviewRevision\]\);/,
  )?.[0]
  assert.ok(revisionReset, 'snapshot revision reset must remain an isolated effect')
  assert.match(revisionReset, /setEvidenceSelection\(null\)/)
  assert.match(revisionReset, /setAlternativeSelections\(\{\}\)/)

  assert.match(sources.view, /scenarioRequestSequence/)
  assert.match(sources.view, /snapshotRevision: requestRevision/)
  assert.match(sources.view, /isCurrentAdvisorScenarioResponse\(result, requestRevision\)/)
  assert.match(sources.view, /requestSequence !== scenarioRequestSequence\.current/)
  assert.match(sources.view, /scenarioState\.revision === overviewRevision/)
  assert.match(sources.view, /parsed > 500/)
  assert.match(sources.view, /max="500"/)
})

test('advisor view displays localized confidence, evidence domains, and requirement provenance', () => {
  assert.match(sources.view, /advisorConfidenceLabel\(entry\.confidence\)/)
  assert.match(sources.view, /advisorDomainLabel\(domain\.domain\)/)
  assert.match(sources.view, /advisorRequirementSourceLabel/)
  assert.doesNotMatch(sources.view, /置信度 \{entry\.confidence\}|\? "官方树结构"/)
})

test('model generation closes the disclosure dialog before waiting so cancellation stays reachable', () => {
  const sendFlow = workbenchSource.match(/const send = async \(\) => \{[\s\S]*?\n  \};/)?.[0]
  assert.ok(sendFlow, 'advisor model send flow must remain explicit')
  assert.match(sendFlow, /const currentRequest = prepared;/)
  assert.match(sendFlow, /setSendingRequestId\(currentRequest\.requestId\);[\s\S]*setPrepared\(null\);[\s\S]*await bridge\.sendAdvisorRequest/)
  assert.match(workbenchSource, /active=\{Boolean\(sendingRequestId \|\| current\?\.activeRequestId\)\}/)
  assert.match(workbenchSource, /onCancel=\{\(\) => void cancel\(\)\}/)
})

test('advisor errors normalize wrapped IPC and legacy read-only validation messages', () => {
  assert.match(workbenchSource, /Error invoking remote method/)
  assert.match(workbenchSource, /AdvisorRuntimeError/)
  assert.match(workbenchSource, /Read-only Agent output \(\?:validation failed\|did not pass evidence and format verification\)/)
  assert.match(workbenchSource, /模型回答未通过顾问证据校验。THEIA 已保留本地分析/)
})

test('hidden notice or mail selections cannot cross into another advisor intent', () => {
  const intentFlow = workbenchSource.match(/const changeIntent = \(nextIntent: AdvisorIntent\) => \{[\s\S]*?\n  \};/)?.[0]
  assert.ok(intentFlow, 'advisor intent changes must explicitly clear hidden entity selections')
  assert.match(intentFlow, /nextIntent !== "notice"[\s\S]*setSelectedNoticeId\(""\)/)
  assert.match(intentFlow, /nextIntent !== "mail"[\s\S]*setSelectedMailId\(""\)[\s\S]*setIncludeMailBody\(false\)/)

  const prepareFlow = workbenchSource.match(/const prepare = async \(\) => \{[\s\S]*?\n  \};/)?.[0]
  assert.ok(prepareFlow, 'advisor prepare flow must remain explicit')
  assert.match(prepareFlow, /intent === "notice" && selectedNoticeId/)
  assert.match(prepareFlow, /intent === "mail" && selectedMailId/)
  assert.match(prepareFlow, /intent === "mail" && selectedMailId && includeMailBody/)
  assert.match(workbenchSource, /onIntentChange=\{changeIntent\}/)
})

test('every model statement based on an untrusted notice or mail stays visibly marked', () => {
  assert.match(advisorMessageSource, /block\.referenceIds\.length > 0/)
  assert.match(advisorMessageSource, /item\.basedOnReferenceIds\?\.length/)
  assert.match(advisorMessageSource, /所选通知或邮件内容，未作为校务事实核验/)
  assert.match(advisorMessageSource, /建议基于所选通知或邮件内容，未作为校务事实核验/)
})
