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

const appSource = await readFile(
  new URL('../src/App.tsx', import.meta.url),
  'utf8',
)
const settingsViewSource = await readFile(
  new URL('../src/views/SettingsView.tsx', import.meta.url),
  'utf8',
)

const workbenchSource = await readFile(
  new URL('../src/components/advisor/AdvisorWorkbench.tsx', import.meta.url),
  'utf8',
)
const advisorMessageSource = await readFile(
  new URL('../src/components/advisor/AdvisorMessage.tsx', import.meta.url),
  'utf8',
)
const composerSource = await readFile(
  new URL('../src/components/advisor/AdvisorComposer.tsx', import.meta.url),
  'utf8',
)
const workbenchV2Source = await readFile(
  new URL('../src/components/advisor/AdvisorWorkbench.v2.tsx', import.meta.url),
  'utf8',
)
const composerV2Source = await readFile(
  new URL('../src/components/advisor/AdvisorComposer.v2.tsx', import.meta.url),
  'utf8',
)
const messageV2Source = await readFile(
  new URL('../src/components/advisor/AdvisorMessage.v2.tsx', import.meta.url),
  'utf8',
)
const markdownSource = await readFile(
  new URL('../src/components/advisor/AdvisorMarkdown.tsx', import.meta.url),
  'utf8',
)
const advancedModelSettingsSource = await readFile(
  new URL('../src/views/settings/AdvancedModelSettings.tsx', import.meta.url),
  'utf8',
)
const workbenchV2Styles = await readFile(
  new URL('../src/components/advisor/AdvisorWorkbench.v2.css', import.meta.url),
  'utf8',
)
const diagnosticsSource = await readFile(
  new URL('../src/components/advisor/DataQualityDiagnostics.tsx', import.meta.url),
  'utf8',
)
const stylesSource = await readFile(
  new URL('../src/styles.css', import.meta.url),
  'utf8',
)
const sharedSource = await readFile(
  new URL('../src/ui/app-shared.tsx', import.meta.url),
  'utf8',
)
const workspaceChromeSource = await readFile(
  new URL('../src/layout/WorkspaceChrome.tsx', import.meta.url),
  'utf8',
)
const gradesSource = await readFile(
  new URL('../src/views/GradesView.tsx', import.meta.url),
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
  assert.match(sources.view, /advisorDomainLabel\(diagnosticSelection\.domain\)/)
  assert.match(sources.view, /advisorRequirementSourceLabel/)
  assert.doesNotMatch(sources.view, /置信度 \{entry\.confidence\}|\? "官方树结构"/)
})

test('data quality diagnostics expose the retained snapshot and failed source scope without leaking runtime secrets', () => {
  assert.match(sources.view, /<DataQualityDiagnostics/)
  assert.match(sources.view, /onSelectDomain=\{openDataDiagnostics\}/)
  assert.match(sources.view, /const openDataDiagnostics = \(quality: AdvisorDomainQuality\) => \{[\s\S]*setInsightsOpen\(false\)/)
  assert.match(sources.view, /const restoreInsights = \(\) => \{[\s\S]*setInsightsOpen\(true\)/)
  assert.match(sources.view, /查看来源证据与数据质量/)
  assert.match(sources.view, /showEvidence\("学校 GPA 来源差异", gpa\.discrepancy\.evidenceRefs\)/)
  assert.match(sources.quality, /点击查看原因与保留数据/)
  for (const label of [
    '为什么会出现这个状态',
    '当前正在使用的本地数据',
    '最近一次来源读取',
    '同步前本地数据',
    '本次可确认返回',
    '未完成范围',
  ]) assert.match(diagnosticsSource, new RegExp(label))
  assert.match(diagnosticsSource, /retainedPrevious/)
  assert.match(diagnosticsSource, /successfulTermIds/)
  assert.match(diagnosticsSource, /failedTermIds/)
  assert.doesNotMatch(diagnosticsSource, /cookie|password|credential|session|rawHtml/i)
})

test('model generation starts the lazy run directly and cancellation stays reachable', () => {
  const sendFlow = workbenchV2Source.match(/const send = async \(\) => \{[\s\S]*?\n  \};/)?.[0]
  assert.ok(sendFlow, 'advisor model send flow must remain explicit')
  assert.doesNotMatch(sendFlow, /await bridge\.prepareAdvisorRequest/)
  assert.match(sendFlow, /await bridge\.sendAdvisorRequest\(\{[\s\S]*threadId: targetThread\.id[\s\S]*question: submittedQuestion[\s\S]*\}\)/)
  assert.doesNotMatch(workbenchV2Source, /DisclosureDialog|setPrepared|readableDomains|selectedMailId|selectedNoticeId/)
  assert.match(workbenchV2Source, /bridge\.onAdvisorStream/)
  assert.match(workbenchV2Source, /event\.threadId !== activeThreadRef\.current/)
  assert.match(workbenchV2Source, /activeRequestRef\.current/)
  assert.match(workbenchV2Source, /optimisticMessage\(submittedQuestion\)/)
  assert.match(workbenchV2Source, /messages: \[\.\.\.thread\.messages, pendingMessage\]/)
  assert.match(sendFlow, /messages: \[\.\.\.thread\.messages, pendingMessage\][\s\S]*setQuestion\(""\)[\s\S]*await bridge\.sendAdvisorRequest/)
  assert.match(workbenchV2Source, /active=\{busy\}/)
  assert.match(workbenchV2Source, /onCancel=\{\(\) => void cancel\(\)\}/)
})

test('advisor keeps stable legacy imports while exposing the Codex-like v2 workbench', () => {
  assert.match(workbenchSource, /export \{ AdvisorWorkbench \} from ['"]\.\/AdvisorWorkbench\.v2['"]/)
  assert.match(composerSource, /export \{ AdvisorComposer \} from ['"]\.\/AdvisorComposer\.v2['"]/)
  assert.match(advisorMessageSource, /export \{ AdvisorMessage \} from ['"]\.\/AdvisorMessage\.v2['"]/)
  assert.match(workbenchV2Source, /THEIA Agent/)
  assert.match(workbenchV2Source, /advisor-v2-conversation/)
  assert.match(workbenchV2Source, /conversationRef/)
  assert.match(workbenchV2Source, /onScroll=\{\(event\) =>/)
  assert.match(workbenchV2Styles, /\.advisor-workbench-v2[\s\S]*?min-height:/)
  assert.match(workbenchV2Styles, /\.advisor-v2-conversation[\s\S]*?overflow-y: auto/)
  assert.match(messageV2Source, /answer\?\.rawText/)
  assert.doesNotMatch(messageV2Source, /isAccessPrompt|未确定：|需要确认：/)

  assert.match(workbenchV2Source, /advisor-v2-sidebar/)
  assert.match(workbenchV2Source, /advisor-v2-thread-list/)
  assert.match(workbenchV2Source, /createAdvisorThread/)
  assert.match(workbenchV2Source, /deleteAdvisorThread/)
  assert.match(workbenchV2Source, /event\.tool\?\.type === "start"[\s\S]*?setStreamText\(\{ requestId: "", text: "" \}\)/)
  assert.match(workbenchV2Source, /visibleStreamDelta/)
  assert.match(workbenchV2Source, /streamGateRef\.current = \{ mode: "undecided", buffered: "" \}/)
  assert.match(composerV2Source, /function nonNegativeCount[\s\S]*?characterCount\.toLocaleString\(\)/)
  assert.match(workbenchV2Source, /onOpenInsights/)
  assert.match(workbenchV2Source, /advisor-v2-conversation/)
  assert.match(workbenchV2Source, /onScroll=\{\(event\) =>/)
  assert.match(composerV2Source, /Enter/)
  assert.match(composerV2Source, /Shift \+ Enter/)
  assert.match(composerV2Source, /advisor-v2-settings/)
  assert.match(messageV2Source, /answer\?\.rawText/)
  assert.match(workbenchV2Styles, /\.advisor-workbench-v2[\s\S]*grid-template-columns/)
  assert.match(workbenchV2Styles, /\.advisor-v2-conversation[\s\S]*overflow-y: auto/)
  assert.match(workbenchV2Styles, /\.advisor-v2-composer[\s\S]*border-radius/)
  assert.match(sources.view, /onOpenInsights=\{\(\) => setInsightsOpen\(true\)\}/)
  assert.doesNotMatch(sources.view, /advisor-static-status/)
})

test('advisor workbench consumes outer appearance tokens without owning appearance state', () => {
  for (const token of [
    '--theia-background-workspace-opacity',
    '--theia-background-sidebar-opacity',
    '--theia-background-topbar-opacity',
    '--theia-background-surface-opacity',
    '--theia-background-surface-strong-opacity',
    '--theia-background-control-opacity',
    '--theia-background-glass-blur',
  ]) assert.match(workbenchV2Styles, new RegExp(token.replaceAll('-', '\\-')))
  assert.match(workbenchV2Styles, /\.advisor-workbench-v2[\s\S]*background: var\(--advisor-surface\)/)
  assert.match(workbenchV2Styles, /\.advisor-v2-sidebar[\s\S]*background: var\(--advisor-sidebar-bg\)/)
  assert.match(workbenchV2Styles, /\.advisor-v2-composer[\s\S]*background: var\(--advisor-card-strong\)/)
  assert.doesNotMatch(workbenchV2Source, /usePersonalization|setAppearance|updateAppearance|dataset\.(?:themePreset|appBackground)/)
})

test('advisor workbench keeps the conversation and composer visible when optional rows are absent', () => {
  assert.match(workbenchV2Styles, /\.advisor-v2-main\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;/)
  assert.match(workbenchV2Styles, /\.advisor-v2-conversation\s*\{[\s\S]*?flex:\s*1 1 auto;/)
})

test('advisor workbench does not reintroduce an opaque second theme in the global stylesheet', () => {
  assert.doesNotMatch(stylesSource, /\.advisor-workbench-v2\s*\{[\s\S]*94%/)
  assert.doesNotMatch(stylesSource, /\.advisor-v2-(?:sidebar|header|conversation|composer)[^{]*\{[\s\S]*9[6-9]%/)
  assert.match(workbenchV2Styles, /--advisor-surface:[\s\S]*var\(--theia-background-workspace-opacity\)/)
  assert.match(workbenchV2Styles, /--advisor-sidebar-bg:[\s\S]*var\(--theia-background-sidebar-opacity\)/)
})

test('model settings make Agent permission and saved-key recovery actionable', () => {
  assert.match(advancedModelSettingsSource, /status\.requiresApiKeyReentry/)
  assert.match(advancedModelSettingsSource, /请重新输入并保存 API Key 后再发起模型请求/)
  assert.match(advancedModelSettingsSource, /Agent 权限/)
  assert.match(advancedModelSettingsSource, /permissionMode: "read-only"/)
  assert.match(advancedModelSettingsSource, /<option value="read-only">只读（受控 Agent）<\/option>/)
  assert.match(advancedModelSettingsSource, /<option value="full-access">完全访问<\/option>/)
  assert.match(advancedModelSettingsSource, /max="2"/)
  assert.doesNotMatch(advancedModelSettingsSource, /Agent 预算档位/)
})

test('advisor errors normalize wrapped IPC without replacing model output validation with local text', () => {
  assert.match(workbenchV2Source, /Error invoking remote method/)
  assert.match(workbenchV2Source, /AdvisorRuntimeError/)
  assert.doesNotMatch(workbenchV2Source, /模型回答未通过顾问证据校验|未生成替代回答|evidence_verification_failed|model-output-invalid/)
})

test('sync status stays inside the topbar and cannot reflow the advisor workbench', () => {
  const headerStart = workspaceChromeSource.indexOf('<header className="topbar">')
  const bannerStart = workspaceChromeSource.indexOf('topbar-sync-banner')
  const loginBannerStart = workspaceChromeSource.indexOf('topbar-login-banner')
  const headerEnd = workspaceChromeSource.indexOf('</header>', bannerStart)
  assert.ok(headerStart >= 0 && bannerStart > headerStart && headerEnd > bannerStart)
  assert.ok(loginBannerStart > headerStart && loginBannerStart < headerEnd)
  assert.match(stylesSource, /\.topbar-sync-banner\s*\{[\s\S]*?flex:\s*0 1 clamp\([\s\S]*?margin:\s*0[\s\S]*?pointer-events:\s*none/)
  assert.doesNotMatch(stylesSource, /\.topbar-sync-banner\s*\{[\s\S]*?position:\s*absolute/)
  assert.match(stylesSource, /@media \(max-width: 720px\)\s*\{[\s\S]*?\.topbar-sync-banner\s*\{\s*display:\s*none;/)
})

test('login continuation stays in the topbar instead of pushing the workbench down', () => {
  assert.match(workspaceChromeSource, /!syncing && !authVerificationPending[\s\S]*!allSourcesConnected[\s\S]*topbar-login-banner[\s\S]*onClick=\{onRequestLogin\}/)
  assert.doesNotMatch(workspaceChromeSource.slice(workspaceChromeSource.indexOf('</header>')), /className="login-banner"/)
  assert.match(stylesSource, /\.topbar-login-banner\s*\{[\s\S]*?flex:\s*0 1 clamp\([\s\S]*?margin:\s*0[\s\S]*?max-width:/)
  assert.match(stylesSource, /@media \(max-width: 720px\)\s*\{[\s\S]*?\.topbar-login-banner\s*\{\s*display:\s*none;/)
})

test('topbar login copy explains the shared CAS session and keeps both sources explicit', () => {
  assert.match(workspaceChromeSource, /sourceEntries = \[/)
  assert.match(workspaceChromeSource, /connectedSources = sourceEntries/)
  assert.match(workspaceChromeSource, /missingSources = sourceEntries/)
  assert.match(workspaceChromeSource, /!hasSession \|\| !allSourcesConnected/)
  assert.match(workspaceChromeSource, /<StatusDot source="theol" status=\{auth\.theol\} \/>/)
  assert.match(workspaceChromeSource, /校园数据源未完全连接/)
  assert.match(workspaceChromeSource, /一次统一身份认证即可连接教务系统和北化在线THEOL/)
  assert.match(workspaceChromeSource, /已连接；\$\{missingLabel \|\| "其余来源"\}暂未连接/)
  assert.match(workspaceChromeSource, /后台恢复未完成；可以继续查看本机已有数据/)
  assert.match(sharedSource, /status\?\.authPending \|\| status\?\.unchecked/)
  assert.match(sharedSource, /正在确认统一身份认证会话/)
  assert.match(stylesSource, /\.source-status\.pending\s*\{[\s\S]*color: var\(--muted-foreground\)/)
})

test('advisor stream keeps tool protocol out of visible text and exposes tool events', () => {
  assert.match(workbenchV2Source, /theia-advisor-tool-call\/v1/)
  assert.match(workbenchV2Source, /visibleStreamDelta/)
  assert.match(workbenchV2Source, /event\.tool\?\.type === "start"/)
  assert.match(workbenchV2Source, /setToolSteps/)
  assert.match(messageV2Source, /visibleAnswerText\(answer\?\.displayText \|\| answer\?\.rawText\)/)
  assert.match(messageV2Source, /本次请求正在读取本地信息，但没有生成可展示的回答，请重试。/)
  assert.match(messageV2Source, /function finiteTokenCount\(value: unknown\)/)
  assert.match(messageV2Source, /写入 \$\{cacheWriteInputTokens\.toLocaleString\(\)\} tokens/)
  assert.doesNotMatch(messageV2Source, /usage\.cacheWriteInputTokens\.toLocaleString\(\)/)
})

test('advisor messages render model markdown in saved and live conversations', () => {
  assert.match(markdownSource, /from "marked"/)
  assert.match(markdownSource, /gfm: true/)
  assert.match(markdownSource, /case "heading"/)
  assert.match(markdownSource, /case "code"/)
  assert.match(markdownSource, /case "table"/)
  assert.match(markdownSource, /case "html":\s+return null/)
  assert.ok(markdownSource.includes("https?:\\/\\/|mailto:"))
  assert.match(messageV2Source, /<AdvisorMarkdown source={visibleText}/)
  assert.match(workbenchV2Source, /<AdvisorMarkdown source={streamText\.text} live \/>/)
  assert.match(workbenchV2Styles, /\.advisor-v2-message-markdown[\s\S]*\.advisor-v2-message-markdown pre/)
})

test('the composer has no manual data disclosure controls', () => {
  for (const source of [workbenchV2Source, composerV2Source]) {
    assert.doesNotMatch(source, /readableDomains|selectedNoticeId|selectedMailId|includeMailBody|只读工具 Agent|本次可读取数据/)
  }
  assert.doesNotMatch(composerSource, /checkbox|<select/)
  assert.doesNotMatch(workbenchV2Source, /AdvisorIntent|setIntent|onIntentChange/)
  assert.doesNotMatch(composerV2Source, /INTENTS|advisor-intent-picker|顾问问题类型/)
  assert.match(composerV2Source, /完全访问已启用/)
  assert.match(composerV2Source, /实时生成中 · \$\{characterCount\.toLocaleString\(\)\}/)
  assert.match(composerV2Source, /停止生成/)
  assert.match(composerV2Source, /event\.key === "Enter"[\s\S]*!event\.shiftKey/)
  assert.match(composerV2Source, /Enter 发送，Shift \+ Enter 换行/)
  assert.doesNotMatch(composerV2Source, /Ctrl \+ Enter/)
})

test('advisor messages render only the model text without local answer decoration', () => {
  assert.match(messageV2Source, /<AdvisorMarkdown source=\{visibleText\} \/>/)
  assert.doesNotMatch(messageV2Source, /查看证据|所选通知或邮件内容|建议基于/)
  assert.match(workbenchV2Source, /streamText/)
  assert.match(workbenchV2Source, /showLiveStream/)
})

test('agent unavailable state explains setup, avoids empty-task creation, and links directly to model settings', () => {
  assert.match(appSource, /modelStatus=\{app\.modelStatus\}/)
  assert.match(appSource, /setSettingsSection\("model"\)/)
  assert.match(sources.view, /modelStatus: ModelStatus/)
  assert.match(sources.view, /onOpenSettings: \(\) => void/)
  assert.match(sources.view, /onOpenSettings=\{onOpenSettings\}/)
  assert.match(workbenchV2Source, /function advisorAvailability\(modelStatus: ModelStatus\)/)
  assert.match(workbenchV2Source, /Agent 需要桌面客户端/)
  assert.match(workbenchV2Source, /还没有连接模型服务/)
  assert.match(workbenchV2Source, /需要重新保存 API Key/)
  assert.match(workbenchV2Source, /Ollama 还没有可用密钥/)
  assert.match(workbenchV2Source, /需要密钥的服务还要保存 API Key/)
  assert.match(workbenchV2Source, /下方学业概览仍可查看，请稍后重试/)
  assert.match(workbenchV2Source, /!existing\.length && !modelStatus\.configured/)
  assert.match(workbenchV2Source, /disabled=\{!isDesktop \|\| busy \|\| !modelStatus\.configured\}/)
  assert.match(workbenchV2Source, /disabledReason=\{composerDisabledReason\}/)
  assert.match(composerV2Source, /disabledReason\?: string/)
  assert.match(composerV2Source, /disabledReason \|\| statusText\(/)
  assert.match(settingsViewSource, /initialSection\?: SettingsSection/)
  assert.match(settingsViewSource, /if \(open\) setActiveSection\(initialSection\)/)
})

test('grades prefer the school GPA and label the computed fallback clearly', () => {
  assert.match(appSource, /<GradesView[\s\S]*progress=\{state\.academicProgress\}/)
  assert.match(gradesSource, /progress\?: AcademicProgress \| null/)
  assert.match(gradesSource, /officialGpa = academicAnalysis\.gpa\.officialValue/)
  assert.match(gradesSource, /const displayedGpa = officialGpa \?\? computedGpa/)
  assert.match(gradesSource, /学校记录/)
  assert.match(gradesSource, /按成绩计算（学校记录暂缺）/)
  assert.match(gradesSource, /本学期 GPA（按成绩）/)
})

test('model settings describe Ultra as bounded experimental multi-agent work', () => {
  assert.match(advancedModelSettingsSource, /Ultra · 多智能体（实验性，有上限）/)
  assert.match(advancedModelSettingsSource, /仍受步数、调用次数和时间上限保护/)
  assert.doesNotMatch(advancedModelSettingsSource, /Ultra[^\n]*无限制/)
})
