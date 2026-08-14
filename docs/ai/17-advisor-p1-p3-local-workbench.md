# Advisor P1-P3 本地决策工作台

本文记录 P0 可信底座之上已经落地的 P1-P3 无模型能力、保守降级规则、安全动作边界和验收方法。P0 的快照、数据质量、证据与 claim 合同见 [16-advisor-p0-foundation.md](16-advisor-p0-foundation.md)；后来落地的 P4-P5 模型运行时见 [18-advisor-p4-p5-model-runtime.md](18-advisor-p4-p5-model-runtime.md)；完整路线和历史决策见 [THEIA AI 顾问接入与实施方案](../../../../THEIA_AI_ADVISOR_IMPLEMENTATION_PLAN.md)。

## 1. 当前结论

P1-P3 已将 THEIA 从只返回底层 `overview` 的可信底座扩展为可直接使用的本地决策工作台：

- P1 在概览显示 Top 1，在顾问页显示 Top 7、排序理由、数据质量和证据；
- P2 在顾问页解释培养方案、GPA 来源、学分缺口、失败课程关联、版本化升级线和纯算术 What-if；
- P3 在选课候选列表中显示本地匹配、冲突、重复修读、历史记录和稳定排名；
- 所有结论都由本地确定性代码生成，不需要模型、模型 Key 或外部 AI 网络；
- 顾问读取 `CampusStore.snapshotWithRevision()` 的冻结快照，不读取 loopback、Feed 或 AI 导出包，也不写回 `CampusState`；
- 顾问不会调用学校选课 POST，不会自动抢课、填答、发信或最终提交。

P1-P3 本身仍然是无模型能力：模型未配置、断网或 P4 请求失败时，这些本地结论照常可用。P4 后来已在其上接入 `ContextBuilder`、授权披露、`AdvisorRuntime`、Provider、严格 narrative/`CitationVerifier`、内存线程、取消和并发预算，但没有改变 P1-P3 的计算来源。

仍未实现的是持久加密 `AdvisorStore`、受约束的多轮摘要、有界只读工具循环、Agent Provider、多代理、自动工具调用和流式输出。现有 `electron/model-service.mjs` 只提供模型传输；完整顾问请求生命周期由独立 `electron/advisor-runtime.mjs` 管理。

## 2. 统一数据流

```text
CampusStore.snapshotWithRevision() 一次冻结
        |
        +--> DataQuality + EvidenceRegistry
        |          |
        |          +--> RiskEngine --> AgendaEngine --> Top 1 / Top 7
        |          |
        |          +--> AcademicEngine --> 培养方案 / GPA / 缺口 / What-if
        |          |
        |          +--> CourseDecisionEngine --> 匹配 / 冲突 / 重复 / 排名
        |
        +--> snapshotRevision 绑定 UI、What-if 和安全动作
```

三个阶段共用以下不变量：

1. 业务事实、revision、领域 digest 和 provenance 来自同一个 committed view。
2. `availability`、`freshness`、`completeness`、`lastAttempt` 和 `retainedPrevious` 分开解释。
3. `unknown` 不能转换成零、空集合、无冲突、无重复或已完成。
4. 数字、日期、风险等级和排序由本地规则生成；UI 不从自然语言反推关键值。
5. evidence 和 claim 必须属于当前 revision，引用必须闭合。
6. renderer 只持有显示所需的窄化结果，不持有顾问动作的原始学校实体 ID、URL 或任意执行负载。
7. 公开 provenance 通过逐字段 DTO 白名单投影：任意 URL、查询参数、本机路径和 token 不进入 renderer，`runId`、`parserVersion`、`errorCode` 的原始值被清除并只保留 `null` 合同占位；`availability`、`freshness`、`completeness`、`retainedPrevious`、记录数和经过校验的时间字段继续保留。合同必需的 digest/revision 可进入结构化响应做一致性校验，但不会在证据抽屉中展示。

## 3. P1：今日行动

### 3.1 风险与行动来源

P1 将以下本地风险放进同一 Agenda：

- 数据读取失败、需要重新登录、数据过期、部分完整或完整性未知；
- THEOL 作业截止时间与无法解析的截止时间；
- 考试倒计时与无法解析的考试时间；
- 官方校历中可确认的选课时间窗口；
- P2 产生且满足确定性门槛的学分缺口行动。

缺失或不可解析的时间保持 `unknown`，不会被猜成今天、零天或已过期。来源失败后保留的旧记录仍显示为旧数据，并保留最近失败状态；空集合只有在来源成功且明确确认空时才能显示为“没有事项”。

### 3.2 稳定排序

`AgendaEngine` 使用版本化分量表计算：

| 分量 | 最大值 | 依据 |
| --- | ---: | --- |
| 紧迫度 | 40 | 逾期、0-6 小时、6-24 小时、24-72 小时、3-7 天、7 天以上或未知 |
| 影响 | 30 | 考试、作业截止、阻断性数据修复、官方窗口、学业缺口或普通提醒 |
| 延误成本 | 15 | 不可恢复窗口、人工恢复、可恢复刷新或仅供参考 |
| 证据置信度 | 15 | 新鲜完整成功、新鲜但部分、旧证据、失败后保留、已验证失败或未知 |

同分时依次按有效截止时间、稳定类型顺序和 canonical action ID 排序。action ID 不依赖 renderer 数组顺序，排序理由和四个分量直接显示，便于复算。

### 3.3 UI 与会话级展示状态

- Dashboard 显示当前第一项行动和进入顾问页的固定入口。
- `AdvisorView` 显示最多七项可见行动、风险列表、数据质量条和证据抽屉。
- loading、error、confirmed empty 与 unconfirmed empty 分开呈现。
- “今日行动为空”只核对会实际生成 Agenda 的作业、考试、成绩、学业进度与校历领域；邮箱、体测等无关领域未知不会阻止空状态，但任一相关领域缺失、过期、部分、失败保留或来源推断时仍保持未确认。
- stale、partial、failed 和 unknown 使用可见文字，不只依赖颜色或 tooltip。
- `dismiss` 只允许非紧急项，按 `{snapshotRevision, actionId}` 在当前 renderer 会话隐藏。
- `snooze` 按 `{snapshotRevision, actionId, urgencyBand}` 在当前会话隐藏；revision 或紧迫度分段变化后重新出现。
- 两种状态都不修改风险基础分、不写入 `CampusState`，也不形成持久用户偏好。

### 3.4 固定本地动作

当前动作是代码白名单中的固定命令，不是模型 proposal：

| 动作 | 行为 |
| --- | --- |
| `reauthenticate` | 进入现有登录流程 |
| `resync` | 对支持的领域单独重试，否则进入现有完整同步流程 |
| `review-assignment` | 打开作业页 |
| `prepare-exam` | 打开考试页 |
| `review-academic-gap` | 打开学业进度页 |
| `review-course-selection-window` | 打开选课沙盘 |
| `open-source-detail` | 仅在明确白名单内打开固定来源详情 |

THEOL 作业的“打开来源详情”使用更窄的主进程授权链：

```text
renderer: { snapshotRevision, actionId }
    -> IPC schema 拒绝 assignmentId / URL / 额外字段
    -> 主进程一次冻结 CampusStore 快照并校验 revision
    -> 用该快照重算 overview，按 actionId 查找动作
    -> 仅允许 assignment + assignments + open-source-detail
    -> 主进程用 opaque entity ID 唯一反解原始 THEOL assignmentId
    -> 等待 assignment scan、代理 ready、登录/状态检查时持续复核 revision
    -> 每次 loadURL 前后、页面身份校验后及返回成功前再次复核 revision
    -> 全部检查通过后调用既有 assignmentEntry / openCourseWorkWindow
```

原始 `assignmentId` 不进入 renderer 顾问链；过期 revision、伪造动作、越权动作、目标不唯一或内部执行失败都以结构化错误失败关闭。普通作业页已有的来源入口不受这条顾问专用链影响。

### 3.5 证据抽屉

证据抽屉显示安全标签、校园来源、捕获时间、可见字段和数据质量。公开 DTO 已先移除任意 URL、查询参数、本机路径、token、Cookie、密码、credential、session、原始学校实体 ID 和 operation 字段，并把 `runId`、`parserVersion`、`errorCode` 的原始值清成 `null`；抽屉再隐藏仅供结构校验的 digest/revision。证据 ID 只用于当前本地合同闭包，不作为可执行目标。overview revision 一旦变化，旧抽屉会立即关闭，不能继续展示上一快照的证据。

## 4. P2：本地学业分析

### 4.1 培养方案 AND/OR

培养方案优先使用 `academicProgress.roots`；只有 roots 不存在时才回退到 `categories`。回退列表始终最多为 `partial`，多个扁平类别不会被直接累加。

树计算规则如下：

- AND 子节点相加；
- 同级多个 OR 子节点必须由用户显式选择一个分支，未选或选中不存在的分支时保持 unknown/partial；
- 官方 `remaining` 优先，其次才用 `required - earned`，最后才从可确认的子节点汇总；
- 缺失学分字段不转换成零；循环、过深树和无效分支选择都会产生 issue 并保守降级；
- 推断树、扁平列表和来源未知的树不会显示为官方树结构。

一个培养方案缺口只有同时满足以下条件才成为可执行 Agenda 项：来源为可识别的官方树，学业进度领域有数据、fresh、complete、最近读取成功、未保留旧值，并且缺口可由闭合证据计算。stale、freshness unknown、partial、failed、auth-required 或 retained previous 都只能显示带 caveat 的局部算术结果，不能声称是完整缺口。

renderer 不接收培养方案、课程或规则的原始 ID。主进程按 `snapshotRevision + rulesVersion + 数字节点路径 + rawId` 建立当前快照专用 catalog，并只公开 `ar1:requirement:*`、`ar1:course:*` 和 `ar1:entity:*` 引用。同一 raw ID 出现在多条路径时仍可按路径区分；不带路径的歧义引用、伪造引用和旧 revision 引用全部失败关闭。What-if 的替代分支只接受当前 catalog 中直接且唯一的父子 opaque 配对，非父子或不存在的组合不会被猜测。

### 4.2 GPA 多来源

GPA 同时保留三个来源：

1. 学校学业进度 GPA；
2. 学校档案 GPA；
3. 本地成绩辅助计算。

显示值按以上顺序选择，但所有可用来源及其 evidence 都保留。两个学校来源同时存在且不同，会生成确定性的 discrepancy；它只说明页面记录不一致，不推断哪个最终有效。

本地 GPA 的边界是：

- 只计入学分为正、未显式排除且属于 GPA 口径的课程；
- 两级计分、素质教育、体育等固定排除项不进入分母；
- 不合格、缺考、挂科等明确失败记录按 0 绩点进入 GPA 口径；
- `point: null`、空字符串或无效值不会被转换为 0；有可解析数值成绩时才按固定北化分段换算绩点；
- 重修按稳定课程身份取最佳一次；有课程号时按课程号去重，没有课程号时不会只凭课程名猜测重修关系；
- 分子和分母使用同一批去重后的 GPA 课程，结果以四位小数显示；
- 本地值只用于核对，不替代学校 GPA。

学业页中的培养方案已获学分来自培养方案证据，不应与“本地 GPA 分母学分”混为一个口径。

### 4.3 失败课程、升级线与 What-if

失败课程只有通过显式培养方案节点 ID 或课程号关联时，才声明对具体节点的影响为 known；仅课程名称相同只作为候选关联，不能升级成官方关系。

升级线默认显示“尚未配置”。只有注入包含 `rulesVersion`、来源标签和阈值的版本化规则后，才显示门槛、计入学分和算术距离；范围重叠、节点缺失或已获学分未知时返回 unknown。即使规则完整，结果也只是一项算术核对，不是升级、毕业、退学或学籍结论。

What-if 当前只允许：

- 假设再获得 `0..500` 范围内的必修学分；
- 选择一个当前培养方案中的 OR 替代分支；
- 将二者组合成一次纯算术情景。

情景不写回 CampusState，输出带 `scenario=true`。renderer 将请求绑定当前 `snapshotRevision`，并用递增 sequence 保证只有最新请求可以更新结果、错误和 loading；即使旧请求更晚成功、失败或进入 `finally`，也不能污染当前状态。响应 revision 不相同时直接丢弃；无有效操作、分支不存在、基础缺口未知或证据不足时强制返回 unknown。

## 5. P3：选课决策沙盘

### 5.1 候选输入与冻结边界

选课页只将当前页候选的安全投影发送给主进程顾问服务；URL、`operationId`、Cookie、凭据和任意执行负载不属于排名合同。主进程再冻结一次 CampusStore revision，并从同一快照读取培养方案、当前课表、成绩和已选课程。求值时钟由主进程采样且支持在测试中注入，stale 判定不依赖测试机器的实际日期。

候选课程不是 CampusStore 事实，因此不会伪装成校园数据域的 evidence。服务为本次白名单投影建立独立的请求输入证据：

- `origin=request-input`、`domain=request-input`、`dataset=course-selection-candidates`；
- 标签明确显示“本次请求中的候选课程（非 CampusStore 数据）”；
- `requestDigest` 和 `evidenceDigest` 只覆盖排序后的白名单候选字段，并绑定本轮 `snapshotRevision`；
- URL、`operationId` 等执行字段不进入摘要、披露或响应；
- 它是瞬时请求输入，不是持久校园事实，因此 `freshness=unknown`、`completeness=partial`，不能独立证明学校侧当前状态。

主进程把 `provenanceInferred`、availability、freshness、completeness、lastAttempt 和 retainedPrevious 折叠为用于 P3 的有效完整性。缺 provenance、不可用、freshness unknown 或最近尝试未成功时为 unknown；stale 最多为 partial；failed/auth-required 只有在明确 retained previous 且仍有旧内容时最多为 partial，否则为 unknown。renderer 可以继续向更弱方向降级，但不能把主进程的 unknown/partial 升级为 complete。候选排序响应绑定 `snapshotRevision` 和稳定规则版本；候选列表请求和 P3 决策请求分别采用 latest-request-wins，只有最后一次请求能更新候选、分页/input key、决策、错误和 loading。旧请求无论晚成功、晚失败还是晚结束都不能覆盖当前页；当前请求失败时保留学校返回的原顺序。

### 5.2 匹配、冲突和重复修读

培养方案匹配按以下优先级和置信度排序：

| 匹配依据 | 置信度 |
| --- | --- |
| 官方节点或课程关联 | 高 |
| 课程号相同 | 高 |
| 类别/性质相同 | 中 |
| 课程名相同 | 低 |
| 无可确认匹配 | 低，并明确 unknown |

课表冲突要求候选和已有课程都能解析星期、节次和周次，并且当前课表质量足以支持完整结论。只要课表 stale、failed、auth-required、retained previous、freshness unknown、completeness unknown/partial，或任一必要时间字段无法解析，“未发现冲突”都必须降级为 unknown。已经发现的重叠可以显示，但不能借此声称冲突集合完整。

重复修读综合培养方案课程状态、成绩、已选课程和当前课表：

- 已通过或已修记录标为 `already-completed`；
- 已选课程或当前课表已有记录标为 `currently-selected`；
- 有历史修读但不能确认通过时标为 `previous-attempt`；
- 必要历史来源不完整时，不把“未找到”解释为 `none`。

旧/失败保留的课表记录可以提示“可能存在冲突”，但 `scheduleStatus` 仍为 unknown，也不会获得 clear 加分。旧/失败保留的已选课程记录不能独立断言候选 `currently-selected`；当前性无法证明时必须降级为 unknown。

历史摘要只统计本地匹配记录和其中可用的数值绩点，不预测未来成绩，也不推断课程难度。

### 5.3 稳定排名与只读隔离

分数由培养方案匹配、课表冲突、有效学分、历史证据和数据质量五部分组成，并携带 `score formula version`。已完成或当前已选课程不参与普通排名；所有信号都 unknown 且候选学分也未知时，score 为 `null`，不会制造零分排名。其余候选按总分降序，再按 canonical candidate ID 稳定打破平局。

每项决策显示排名、分数、匹配依据、冲突状态、重复状态、理由和证据。当前候选页虽与既有抢课界面同屏，但权限完全分离：

- `core/advisor/course-decision-engine.mjs` 是纯本地计算，不含 `fetch` 或学校 POST；
- 排名 effect 不能保存目标、启动任务或调用选课执行服务；
- `save-target`、`view-details`、`open-confirmation` 只是非执行 proposal 数据，不会自动执行；
- 真正保存目标、进入确认或开始抢课仍必须经过现有用户操作和原有业务服务。

## 6. IPC 与实现落点

当前已实现的顾问 IPC：

| IPC | 输入 | 作用 |
| --- | --- | --- |
| `theia:advisor:get-overview` | 无 | 返回 P1 overview 与 P2 academic analysis |
| `theia:advisor:academic-what-if` | `{ snapshotRevision, additionalRequiredCredits?, alternativeSelections? }` | 基于一次冻结快照和当前 opaque catalog 计算 P2 情景 |
| `theia:advisor:course-decisions` | `{ snapshotRevision, candidates }`，候选为当前页安全投影 | 基于一次冻结快照计算 P3 决策 |
| `theia:advisor:execute-action` | `{ snapshotRevision, actionId }` | 仅执行主进程重新验证后的 P1 白名单动作 |

主要实现：

- `core/advisor/agenda-engine.mjs`
- `core/advisor/risk-engine.mjs`
- `core/advisor/academic-engine.mjs`
- `core/advisor/course-decision-engine.mjs`
- `core/advisor/overview.mjs`
- `core/gpa.mjs`
- `electron/advisor-overview-service.mjs`
- `electron/advisor-action-service.mjs`
- `src/views/AdvisorView.tsx`
- `src/views/CourseSelectionView.tsx`
- `src/components/advisor/`
- `src/hooks/advisor-presentation.mjs`

不要把这些 IPC 扩展成任意 URL、任意 entity payload、通用 shell、文件系统或学校请求代理。P4 应新增独立的模型请求合同，而不是把自由文本或模型工具塞进 `execute-action`。

## 7. 测试与验收

### 7.1 回归入口

| 范围 | 主要测试 |
| --- | --- |
| P1 排序与 UI | `tests/advisor-agenda-p1.test.mjs`、`tests/advisor-presentation.test.mjs`、`tests/advisor-ui.test.mjs`、`tests/dashboard-layout.test.mjs` |
| P1 动作安全 | `tests/advisor-action-service.test.mjs`、`tests/advisor-action-wiring.test.mjs`、`tests/ipc-security.test.mjs` |
| P2 学业规则 | `tests/advisor-academic.test.mjs`、`tests/gpa.test.mjs`、`tests/advisor-service-p2-p3.test.mjs` |
| P3 决策引擎与 UI | `tests/advisor-course-decision.test.mjs`、`tests/course-selection-advisor-ui.test.mjs`、`tests/advisor-service-p2-p3.test.mjs` |
| P0/P1-P3 总合同 | `tests/advisor-core.test.mjs`、`tests/advisor-overview-ipc.test.mjs`、`tests/packaging-config.test.mjs` |

2026-08-14 最终状态：完整门禁已从当前共享工作树顺序重跑并通过。全量测试 `494/494`；opaque/provenance 定向测试 `87/87`；前端竞态定向测试 `18/18`。ESLint、TypeScript/Vite 生产构建和 `git diff --check` 均通过；build 只有既有的 `>500 kB` chunk 警告。定向数字用于说明重点合同覆盖，不替代全量门禁：

```powershell
npm test
npm run lint
npm run build
git diff --check
```

本轮不打包、不发布。若以后进入发布候选，还必须使用隔离临时数据根完成 packaged smoke，不能读取或覆盖真实 `%APPDATA%\THEIA`。

### 7.2 隔离视觉验收

运行入口为 `npm run visual:advisor`，最终报告在本地 `test-results/advisor-visual/` 下生成，不作为源代码提交的一部分。报告明确证明：

- `1440 x 900`、`1280 x 720`、`390 x 844` 三个视口；
- 每个视口覆盖顾问、证据抽屉、What-if、选课排名四个场景，共 `12/12` 通过；
- fixture 覆盖 complete、partial、stale、failed-retained，三个视口均为 `3 candidates -> 3 decisions`；
- document、body 和 workspace 的页面横向溢出为 0；非空 `shellOverflow` 只记录被 `.app-shell` 裁剪的缩放背景装饰层，不属于页面布局失败；
- fixture digest 未变化；renderer error、console warning/error、外部请求、导航阻断和页面加载失败均为 0；
- 未读取真实 AppData、禁止学校网络，报告落盘后对应临时存储已删除。

该报告没有单独证明 loading、error、confirmed-empty、unknown、模型断网或所有长文本组合；这些状态仍由单元/组件回归覆盖，并在未来发布候选的更广视觉与 packaged smoke 中继续检查。本轮不打包、不发布。

### 7.3 安全复核

本轮最终审计已确认：

1. Advisor 计算路径没有模型 HTTP 请求、学校 POST、自动抢课或写 CampusState。
2. renderer 顾问动作没有发送原始 assignment ID、URL 或任意 payload。
3. P3 候选安全投影不包含 `operationId`、source URL、凭据或 session；候选 evidence 明确标成 request input，不伪装成 CampusStore provenance。
4. 所有 `unknown`、partial、stale、failed 和 retained previous 路径均保守降级。
5. evidence/claim/risk/action 的引用属于同一 revision，嵌套引用也闭合。
6. 可见状态、数据域、置信度和错误信息均为中文，且不会泄露本机路径或 provider body。
7. 培养方案、课程和规则引用均为 revision-bound opaque ref；What-if 对伪造、过期、歧义和非父子组合失败关闭。
8. 公开 provenance 使用逐字段 allowlist；作业动作持续复核 revision，overview/What-if/候选/P3 决策仅允许最新请求更新 UI。

## 8. 与 P4-P5 的边界

P4 已按下列路径接入模型顾问：

```text
冻结本地快照
  -> 本地确定性 claims/actions
  -> 按问题与 consent 生成最小 DisclosurePlan
  -> ProviderAdapter 调用模型
  -> 严格解析模型 narrative
  -> 针对请求时冻结的 allowlist 验证引用
  -> UI 只渲染通过验证的叙述和本地关键值
```

`AdvisorRuntime`、授权披露、模型叙述校验和请求级冻结 catalog 已完成首发接线。现有 `ModelService` 仍不能直接绕过该链连接顾问页；模型也不能生成 URL、原始学校 ID、任意工具参数或执行学校操作。

`projectAdvisorOverview()` 的顶层、claims、risks 和 urgentItems 已改为逐字段 DTO；P4 ContextBuilder 还会再次执行模型专用白名单投影。P1-P3 的固定本地动作与 P4 模型建议继续分离：前者只能通过原有主进程重验链执行，后者目前不构成工具调用或执行授权。P4-P5 的准确边界见 [模型运行时与按需上下文](18-advisor-p4-p5-model-runtime.md)。
