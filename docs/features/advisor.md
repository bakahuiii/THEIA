# 学业顾问

## 页面目标

学业顾问不是普通问答框，而是一个带证据的本地分析工作台。它基于当前快照、数据质量和显式模型服务，给出建议、风险提示和下一步动作。

## 主要内容

- 顾问工作台，展示当前模型状态和入口。
- 见解弹窗，汇总当前快照下最重要的行动。
- 证据抽屉，把建议对应到具体数据来源。
- 数据质量诊断，解释为什么某个领域可信或不可信。
- 情景分析，允许在当前快照上做假设推演。
- 对单条建议进行执行、稍后处理或忽略。

## 数据来源

- advisorOverview
- advisorUrgentActions
- modelStatus
- 当前快照 revision
- 证据列表和各领域质量摘要
- 用户在情景分析里输入的假设学分和替代选择

## 边界

- 默认是受限 Agent 模式：可以使用已声明的同步、公开读取、设置更新和目标选课控制工具，但不提供通用文件系统或任意命令能力。
- 没有配置模型服务时，页面会明确提示不可用。
- 情景结果只对当前快照有效，快照变了就要重算。
- 这里不直接替用户执行学校侧写入，只做读取、解释和受限动作。

## 相关文件

- src/views/AdvisorView.tsx
- src/components/advisor/AdvisorWorkbench.tsx
- src/components/advisor/AdvisorInsightsDialog.tsx
- src/components/advisor/EvidenceDrawer.tsx
- src/components/advisor/DataQualityDiagnostics.tsx
- src/hooks/advisor-presentation.mjs

## 细节

### 进入和刷新

- 新快照到来时，证据选择、诊断选择和情景分析状态都会回到当前 revision。
- 这样不会把旧快照里的结果错误地挂到新数据上。
- 如果当前没有可用于情景计算的快照，页面会直接给出提示。

### 证据怎么用

- 见解弹窗和情景结果都能打开证据抽屉。
- 证据抽屉优先展示情景结果里的证据；如果情景结果不够完整，就回退到概览证据。
- 诊断面板只看当前域的质量和证据，不会拿别的域来凑解释。

### 情景分析

- 假设学分必须是 0 到 500 之间的数字。
- 替代选择按 nodeId 记录，清空输入会把当前选择删掉。
- 当前 revision 变化后，旧结果会被丢弃，必须重新计算。

### 操作边界

- 可执行动作只来自当前快照里显式允许的 urgent item。
- 处理中动作会用 pendingActionId 标记，避免重复触发。
- 模型服务不可用时，页面仍能看概览，但不会伪造推理结果。

## 代码级细节

- AdvisorView 的核心状态是 insightsOpen、evidenceSelection、diagnosticSelection、restoreInsightsAfterSheet、additionalCredits、alternativeSelections 和 scenarioState。
- useEffect 会在 overviewRevision 变化时清空 evidence、diagnostic 和 scenario 状态，防止旧快照污染新结果。
- showEvidence 会先走 evidenceFor，在 overview.evidence 和 scenario.evidence 之间选择更完整的一组证据，再决定是否关闭 insights 面板。
- openDataDiagnostics 只设置 diagnosticSelection，真正的证据抽屉由 DataQualityDiagnostics 继续打开。
- runWhatIf 会校验 additionalCredits 在 0 到 500 之间，调用 bridge.getAdvisorAcademicWhatIf，并用 isCurrentAdvisorScenarioResponse 判断返回结果是否还对应当前快照。
- 弹窗层级是 AdvisorWorkbench -> AdvisorInsightsDialog -> DataQualityDiagnostics / EvidenceDrawer，三个面板共享同一份概览快照。
