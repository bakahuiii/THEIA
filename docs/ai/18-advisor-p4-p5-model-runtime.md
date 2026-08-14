# Advisor P4-P5 模型运行时与按需上下文

本文记录 THEIA 已落地的 P4 模型顾问首发范围，以及 P5 通知/邮件本地投影和词法索引的当前边界。P0 的原子快照、数据质量、证据与 claim 合同见 [16-advisor-p0-foundation.md](16-advisor-p0-foundation.md)；P1-P3 的确定性工作台见 [17-advisor-p1-p3-local-workbench.md](17-advisor-p1-p3-local-workbench.md)；完整历史方案见 [THEIA AI 顾问接入与实施方案](../../../../THEIA_AI_ADVISOR_IMPLEMENTATION_PLAN.md)。

> 2026-08-14 更新：本文件中“本轮没有实现”的历史首发描述已不再代表当前实现。加密持久线程、流式预览、受限只读工具循环，以及 Anthropic/Gemini/Ollama 协议适配已落地；A/B/C 的准确边界、sidecar 合同和验收矩阵以 [A/B/C 顾问、Agent 与 Sidecar](20-a-b-c-advisor-agent-sidecar.md) 为准。原课程后台队列仍暂停，且与顾问 Agent 隔离。

## 1. 当前结论

P4 首发已经把真正的模型调用接入顾问页，但模型仍只是受约束的解释层：

- `ContextBuilder` 按意图和字段白名单从一次冻结的 `CampusStore.snapshotWithRevision()` 构建最小上下文；
- `DisclosurePlan` 在发送前显示模型服务、模型、数据范围、记录数、快照和预计输入量；
- 敏感实体使用短期、逐实体 consent，授权绑定请求、线程、服务身份、用途、实体摘要和上下文摘要；
- `AdvisorRuntime` 管理 prepare/send、内存线程、并发限制、取消、超时、输入/输出预算和一次受限格式修复；
- OpenAI-compatible `ProviderAdapter` 复用现有 `ModelService` 的服务身份、Key 和传输安全边界；
- 模型只能返回严格的 `theia-advisor-model-narrative/v1`，再由 `CitationVerifier` 对请求时冻结的 claim/action/低信任引用 catalog 验证；
- fast/deep/coursework 路由已成为显式设置，顾问意图不会再无条件共用一个模型；
- 顾问工作台已提供今日、学业、选课、通知、邮件和综合六种意图、线程切换、披露确认、回答证据和取消生成。

P5 当前已实现通知/邮件的本地安全投影、通知信号提取、逐封邮件正文授权和纯内存词法索引。它不是邮箱自动代理，也没有获得联网读取、改变已读状态、下载附件、发信或执行学校操作的权限。

模型自由叙述从来不是事实来源。只有本地 `fact/computed` claim、Evidence 和确定性结果可以承载本地事实、数字、日期和风险。请求级冻结的通知/邮件 `untrusted reference` 可以被模型引用，以说明“所选原文写了什么”并建议人工核对，但这种引用绝不把校园文本升级成本地事实、学校确认事实或 Evidence。

本轮**没有**实现：

- 持久或加密的 `AdvisorStore`；线程在应用进程退出后不保留；
- 有界工具循环、Agent Provider、多代理或模型工具调用；
- 模型触发登录、同步、抢课、填答、发信、提交、文件访问或任意 URL；
- 流式模型输出；OpenAI-compatible v1 适配器也不宣称 JSON Schema、tools 或 token usage 能力；
- 受摘要和预算约束的持久多轮上下文；旧轮次原文不会重新发送给模型；
- 自动联网补取邮件正文、改变 unread、自动下载或解析附件正文；
- `course` 意图自动注入 P3 当前候选、排名或决策；P3+ 专用选课交互尚未接线；
- embedding、向量数据库或持久检索索引；
- P6 作业后台队列、去重、恢复和完成通知。

## 2. 端到端数据流

```text
用户选择意图、问题和可选通知/邮件
        |
        v
AdvisorRuntime.prepare()
  - 冻结一次 VersionedSnapshot
  - 固定 evaluatedAt、模型和 service identity
  - 生成当前 overview，使用其中已有的 claim、risk 和 urgent item
  - 不接入 P3 当前选课决策（courseDecisions: null）
  - 投影所选通知/邮件
  - ContextBuilder 生成最小上下文草案
        |
        v
DisclosurePlan + ConsentChallenge
  - renderer 只展示安全摘要
  - 用户显式选择“允许并发送”
        |
        v
AdvisorRuntime.send()
  - 复核 prepared TTL、线程、并发和 snapshot revision
  - 以可信主进程时钟签发短期 consent
  - 重建并冻结 Context + RequestCatalog
        |
        v
OpenAICompatibleProvider
  - system prompt + 单个结构化上下文
  - 90 秒总期限、累计输入和输出预算
        |
        v
CitationVerifier
  - 严格 JSON/schema/字段/数量上限
  - claim/action/低信任引用和关键数字核对
  - 失败时最多一次受限格式修复
        |
        v
theia-advisor-answer/v1
  - 主进程补齐 request/thread/revision/model/usage
  - renderer 展示本地 claim、证据、解释和不确定项
```

模型永远不会直接读取 `CampusStore`、loopback API、Feed、AI 导出包、浏览器 session、Cookie、凭据或本机文件。Provider 也不决定发送哪些字段；披露选择只属于 `ContextBuilder` 和 `AdvisorRuntime`。

## 3. P4 请求生命周期

### 3.1 Prepare：先冻结，再展示

`AdvisorRuntime.prepare()` 执行以下检查：

1. 线程必须存在且当前没有活动请求；问题必须为非空的有界文本。
2. 从 `CampusStore.snapshotWithRevision()` 深拷贝一次版本快照。
3. 从该快照读取模型设置，按意图选择模型，并解析规范化 service identity。
4. 使用同一个 `preparedAt` 生成本地 overview；模型不能改变本地 claim、风险或排序。
5. 只按当前选择投影通知/邮件；空选择不会回退成“发送全部”。
6. 生成 `DisclosurePlan`、`ConsentChallenge` 和五分钟有效的 prepared request。
7. 同一线程较早但尚未发送的 prepared request 会被新请求替换。

prepare 阶段不调用模型。若模型设置不完整、服务身份无效、实体已从快照消失或邮件正文没有本地缓存，流程在出站前失败关闭。

### 3.2 Send：授权和快照二次闭合

`AdvisorRuntime.send()` 只接受 `{ requestId, approved: true }`。发送前必须同时满足：

- prepared request 仍在五分钟有效期内；
- 对应线程存在且不忙；
- 全局活动顾问请求少于两个；
- 当前 `CampusStore` revision 仍等于 prepare 时 revision；
- 敏感 scope 的 consent 完整且处于有效期；
- 实际 Provider messages 仍在累计输入预算内。

consent 由主进程在 send 时用同一个可信时刻生成并立即核验，不接受 renderer 提供的时间。授权精确绑定：

```text
serviceIdentity + purpose + requestId + threadId
+ domains + entityDigests + contextDigest + grantedAt/expiresAt
```

模型等待期间如果 CampusStore 出现新 revision，当前回答不会被重绑定到新数据；主进程在回答中标记 `stale=true` 并提示该回答只对应请求时快照。

### 3.3 线程、并发、取消和预算

当前线程只保存在 `AdvisorRuntime` 内存中：

- 最多 20 个线程；
- 每个线程最多保留 40 条界面消息；
- 同一线程同一时间只允许一个活动请求；
- 整个运行时最多并发两个模型请求；
- 默认总期限 90 秒；
- 每轮最多两次模型调用，即首次调用加至多一次格式修复；
- 累计 Provider 输入上限 256,000 字节，输出上限 1,000,000 字节；
- 模型输出 token 请求上限为 2,000；本地 catalog 最多 32 个 claim、回答最多 8 条 recommendation。

取消通过 `AbortController` 传到 Provider。Runtime 不会把“Provider 自己 settle”当作释放请求的前提：每次调用都让 Provider Promise 与 AbortSignal 强制竞速。即使第三方 Provider 完全忽略 Abort 并永不 resolve/reject，用户取消或总期限到达也会立即让 Runtime 失败关闭并释放活动请求；稍后返回的文本仍不能进入校验、线程或 UI。用户取消返回 `cancelled`，总期限触发返回可重试的 `timeout`，两者不会混为同一个错误。应用退出会取消全部活动请求并清除 prepared request。

内存线程当前只服务界面展示。第二轮请求只发送本轮 system prompt 和本轮冻结上下文，不会把旧问题、旧回答原文或本地线程对象再次出站。因此目前是安全降级的“多轮界面”，不是已经完成的持久多轮摘要。

## 4. ContextBuilder 与披露合同

### 4.1 意图范围

首发意图和默认领域如下：

| 意图 | 默认领域 | 可选实体 |
| --- | --- | --- |
| `daily` | 作业、考试 | 无 |
| `risk` | 学业进度、成绩、profile 数据质量 | 合同预留：身份投影；首发 UI/Runtime 未接 |
| `course` | 学业进度、课程、成绩、课表、已选课程和 `course-selection` 数据质量 | 无 |
| `notice` | 通知 | 用户点选的通知 |
| `mail` | 邮箱 | 用户点选的邮件元数据、逐封正文；附件文本为未接线的合同预留 |
| `general` | 本地关键词最多选择两个领域 | 通知、邮件、正文；体测、身份、附件文本为首发未接线的合同预留 |

`general` 由本地确定性关键词规则选择最多两个领域；没有命中时保守回退到作业和考试。分类只决定可披露范围，不让模型自由扫描整个快照。

ContextBuilder 保留 `fitness`、`identity` 和 `attachment-text` 的敏感 scope 合同，但首发顾问 UI 与 Runtime 没有构造这些实体的入口。Runtime 当前只从冻结快照构造用户所选通知、邮件元数据和已授权邮件正文；附件只披露安全元数据，不披露附件文本。

当前 `course` 只是首发路由和领域披露范围，不等于 P3 决策接线。`AdvisorRuntime` 当前向 ContextBuilder 传入 `courseDecisions: null`，所以模型上下文中的 `deterministicResults.courseDecisions` 明确为空；它不会自动取得选课页的当前候选、排名、用户选择或 proposal。把 P3 当前交互安全地冻结并附加到模型请求属于尚未实现的 P3+ 专用交互。

### 4.2 字段白名单和冻结 catalog

ContextBuilder 只投影以下模型可见结构：

- 当前问题和意图；
- 涉及领域的 DataQuality；
- 受数量上限约束的本地 urgent items、risks，以及调用方显式提供的 course decisions；当前 Runtime 未提供 course decisions；
- 与这些结果闭合的 LocalClaim 和 Evidence；
- 当前 intent 允许且与本轮实体、风险或 proposal 绑定的 action；
- 用户明确选择的安全实体投影；
- truncation 和 DisclosurePlan。

URL、查询参数、本机路径、凭据、Cookie、session、原始学校实体 ID、operation 参数和附件二进制不属于该合同。catalog 在请求时冻结并带 digest；响应只能解析到这个 catalog，不能解析到之后的 overview。

### 4.3 敏感 scope

当前敏感 scope 为：

- `mail-body`；
- `fitness`；
- `identity`；
- `attachment-text`。

敏感实体的摘要基于实际安全投影生成。实体内容、服务身份、上下文或线程任一变化，旧授权都不能复用。授权只覆盖当前请求，不成为导出包、未来线程或其他模型服务的长期授权。

## 5. Provider 与模型路由

### 5.1 OpenAI-compatible 首发适配器

`OpenAICompatibleProvider` 通过现有 `ModelService.request()` 发送非流式 Chat Completions 请求，继续继承：

- 精确 service identity 与 Key 绑定；
- URL、重定向、请求/响应体和 Abort 边界；
- 主进程持有 Key，renderer 不接触凭据；
- 对取消、超时、429、5xx、未配置和未知 Provider 错误的安全中文归一化。

首发 capability 明确为 `streaming=false`、`jsonSchema=false`、`usage=false`、`tools=false`。`responseSchema` 目前是 THEIA 内部验证意图，不代表第三方 endpoint 原生支持 JSON Schema。运行时始终执行本地 JSON 和引用校验。

### 5.2 显式路由

设置中支持四个模型槽位：

- `advisorFastModel`：今日、选课、通知等较轻顾问请求；
- `advisorDeepModel`：学业风险、邮件和综合问题；
- `courseworkModel`：既有作业工作流；
- `fallbackModel`：角色模型缺失时的统一回退。

若角色模型未配置，按 fallback 和既有 `modelName` 保守回退；最终仍没有合法模型时，prepare 在本机失败，不会发送不完整请求。文档不写死任何第三方模型 ID、价格、账户能力或可用特性。

## 6. Narrative 和 CitationVerifier

模型必须返回单个裸 JSON 对象：

```text
theia-advisor-model-narrative/v1
  blocks[]                 claimIds + optional referenceIds + explanation
  recommendations[]       text + basedOnClaimIds + optional basedOnReferenceIds
  uncertainties[]
  questionsForUser[]
  suggestedActionIds[]
```

主进程拒绝：

- 代码围栏、非完整 JSON、重复 JSON key、缺字段、未知字段和超限数组/文本；
- 未在请求 catalog 中的 claim/action/reference ID、重复引用和未闭合 evidence；
- URL、路径、凭据样式、活动 HTML、协议相对 Markdown 链接、控制字符和 bidi/invisible 字符；
- 没有精确 local claim 或低信任 reference 支撑的关键数字，包含全角、科学计数法和常见中文数值写法；
- 模型叙述中的开除、退学、处分、毕业资格、录取或学位授予等高风险学校最终决定断言；这类句子即使附带 claim ID 也不由模型输出；
- 与当前 intent 实体、风险或 proposal 无关的 action。

安全回归包含容易绕过表面检查的原句，例如错误中文数值“GPA 是一点七四”和无本地事实支撑的“你已被学校开除”；它们都必须在主进程拒绝，不能只靠 prompt 提醒模型自律。

模型文本不能创建新的 fact/computed claim。主进程先展示本地 `claim.displayText`，模型只负责解释和建议。引用通知/邮件时，block 或 recommendation 必须只引用当前请求 catalog 中的 `referenceIds`，不能在同一项中把低信任引用和 local claim 混成一个事实来源。首次输出失败时，runtime 只发送一次受限修复请求；修复上下文只包含错误类别、允许的 claim/action/reference ID 和截断后的无效输出。第二次仍失败则返回 `model-output-invalid`，本地 P0-P3 结果继续可用。

## 7. P5 通知与邮件

### 7.1 只处理显式选择

通知与邮件都由用户在顾问工作台点选。未点选时 P5 上下文为空，不会为了“帮助回答”自动扩大成全部通知或整个收件箱。切换离开“通知”意图会清空隐藏的通知选择；切换离开“邮件”意图会清空邮件选择和“包含正文”状态。prepare 也只在当前 intent 精确匹配时附带对应 ID，避免不可见旧选择跨意图出站。所选 ID 必须在 prepare 时冻结快照中唯一存在，否则失败关闭。

所有校园文本都标记为 `untrusted`。净化会移除或失活：

- `script`、`style`、`iframe`、`svg`、`object`、表单等活动 HTML；
- HTTP、file、javascript、data、mailto、`//host/path` 协议相对 URL，以及这些地址作为目标的 Markdown 链接；
- C0/C1 控制字符、不可见字符和双向文本控制符；
- 本机路径、token、Cookie、Authorization、API Key 和密码样式文本。

净化只让文本变成惰性纯文本，不把校园内容升级成可信指令。system prompt 明确把通知、邮件、作业和附件视为不可信数据。

每个被披露的通知、邮件元数据或获准正文还会生成请求级冻结的 `theia-advisor-untrusted-reference/v1`：它绑定当前 snapshot revision、scope、实体摘要和净化后内容摘要，只在本轮 RequestCatalog 中有效。模型可以用 `referenceIds` / `basedOnReferenceIds` 引用它，回答保留低信任标记；若模型输出不确定项，只允许固定的“未验证来源，需人工核验”和“上下文已截断”提示，不能借此夹带原文。它不是 LocalClaim，不拥有 Evidence，也绝不代表 THEIA 或学校确认了原文中的陈述。

### 7.2 通知投影

通知上下文只包含安全标题、摘要、发布时间、规范化来源、实体摘要、截断状态，以及本地确定性提取的：

- 明确时间信号；
- 与已知课程的匹配信号；
- 复核、报名、提交等动作词信号。

这些信号是只读提示，不是学校事实的新 claim，也不是可执行命令。临时 suggestion 最多表达“查看所选通知/邮件”或“建议创建提醒”，其 `effect` 为 `none`；当前模型没有执行提醒、发信或学校动作的权限。

### 7.3 邮件元数据与正文

默认邮件投影只包含：主题、发件人、接收时间、snippet、实体摘要和附件元数据。附件元数据仅允许 index、叶文件名、MIME 类型和大小；内容、二进制、路径、URL 和下载参数全部隔离。

邮件正文需要同时满足：

1. 用户已经点选该邮件；
2. 用户勾选“包含正文（仅本次授权）”；
3. 正文已经存在于当前本地快照；
4. `mailBodyEntityDigest()` 能绑定邮件身份和实际安全纯文本；
5. send 时 consent 精确包含该正文 entity digest 和本轮 context digest。

正文未在本机缓存时，顾问不会调用 IMAP/webmail 补取，而是提示先在邮箱中打开该邮件后重试。顾问路径不调用 `readMailboxMessage()`，不改变 unread，不下载附件，也不写邮箱状态。

### 7.4 纯内存词法索引

`LexicalIndex` 是 P5 的本地检索基础组件，并已接入 `AdvisorRuntime` 的 prepare 阶段。Runtime 按 `sourceDigest` 增量替换当前快照中的通知白名单文本和邮件元数据，再用本轮问题做内部候选检索。当前特征包括：

- 中文二元/三元片段与字母数字词项的确定性索引；
- 固定文档、词项、查询、结果和摘录预算；
- 结果按匹配词数、出现次数、捕获时间和稳定 ID 排序；
- privacy scope 默认只搜索 `public-academic`、`coursework` 和 `mail-metadata`；
- `mail-body`、`attachment-text` 片段必须带显式授权和匹配摘要；
- HTML、URL、路径、敏感值和二进制在入索引前失败关闭或净化；
- 索引只存在于内存，不写 CampusState，不是 embedding 或向量数据库。

词法候选只保存在 Runtime 的内部 prepared state，不进入 `builderInput`、DisclosurePlan、renderer 或 Provider。它不会自动扩大模型披露范围；首发顾问 UI 仍只把用户明确点选、经 `buildNoticeMailContext()` 投影的通知/邮件送入统一 ContextBuilder。索引不包含邮件正文或附件内容，也不是后台常驻、自动扫描全部邮箱或持久 RAG。

## 8. IPC、UI 和文件落点

当前模型顾问 IPC：

| IPC | 用途 |
| --- | --- |
| `theia:advisor:list-threads` | 列出当前进程内线程 |
| `theia:advisor:create-thread` | 新建内存线程 |
| `theia:advisor:prepare` | 冻结快照并返回披露计划 |
| `theia:advisor:send` | 用户确认后发送 prepared request |
| `theia:advisor:cancel` | 取消指定请求或线程当前请求 |
| `theia:advisor:delete-thread` | 删除线程并取消其活动请求 |

它们与 P0-P3 的 overview、What-if、选课决策和固定本地动作 IPC 分离。所有通道继续经过 trusted main-frame 和运行时 schema；没有新增通用 filesystem、shell、URL、session 或学校请求代理。

主要实现：

- `core/advisor/context-builder.mjs`
- `core/advisor/citation-verifier.mjs`
- `core/advisor/redaction.mjs`
- `core/advisor/notice-mail-context.mjs`
- `core/advisor/lexical-index.mjs`
- `electron/ai/provider.mjs`
- `electron/ai/openai-compatible.mjs`
- `electron/advisor-runtime.mjs`
- `electron/ipc-security.mjs`
- `electron/preload.cjs`
- `src/components/advisor/AdvisorWorkbench.tsx`
- `src/components/advisor/DisclosureDialog.tsx`
- `src/components/advisor/AdvisorComposer.tsx`
- `src/components/advisor/AdvisorMessage.tsx`

## 9. 回归与验收入口

| 范围 | 测试 |
| --- | --- |
| 最小上下文、consent、字段隔离 | `tests/advisor-context-builder.test.mjs` |
| 严格 narrative、引用和安全文本 | `tests/advisor-narrative-contract.test.mjs` |
| Provider、路由和错误归一化 | `tests/advisor-provider.test.mjs` |
| runtime 冻结、修复、并发、取消、超时和预算 | `tests/advisor-runtime.test.mjs` |
| 通知/邮件净化、正文授权和附件隔离 | `tests/advisor-notice-mail.test.mjs` |
| 词法索引、scope 和敏感授权 | `tests/advisor-lexical-index.test.mjs` |
| P5 Runtime 统一投影、内部候选检索和不扩大披露 | `tests/advisor-p5-integration.test.mjs` |
| IPC 与 renderer 工作台 | `tests/ipc-security.test.mjs`、`tests/advisor-ui.test.mjs` |

发布候选仍必须顺序通过：

```powershell
npm test
npm run lint
npm run build
git diff --check
```

还应在隔离临时数据根检查桌面和窄屏顾问工作台、披露弹窗、生成中取消、长文本、模型未配置、断网、timeout、invalid output、stale revision 和邮件正文未缓存状态。本说明不替代最终打包、packaged smoke 或真实 Provider 兼容性验证。

## 10. 后续边界

后续可以分别推进持久会话或有界只读工具 Agent，但两者都必须作为新的权限和状态面单独过门，不能因为 P4 首发已有 `AdvisorRuntime` 就默认获得。

持久会话至少需要：独立于 `CampusState` 的加密存储、每记录随机 nonce、AAD、损坏隔离、删除语义、密钥轮换、旧 evidence 生命周期和恢复测试。多轮摘要必须可丢弃，且受 revision/domain digest 和输入预算约束。

工具 Agent 至少需要：独立 ToolCall/ToolResult 合同、固定只读工具白名单、参数 schema、每轮步数和总预算、工具结果再净化、完整审计，以及模型永远无法触达登录、同步、抢课、填答、发信和最终提交。当前 `suggestedActionIds` 不是工具调用，也不构成执行授权。
