# Advisor P0 可信底座

本文是 P0 的实现合同和边界清单。它描述 P1-P3 本地工作台与当前 Agent 共同依赖的确定性可信底座。P1-P3 完成范围见 [17-advisor-p1-p3-local-workbench.md](17-advisor-p1-p3-local-workbench.md)，Agent 当前实现见 [20-a-b-c-advisor-agent-sidecar.md](20-a-b-c-advisor-agent-sidecar.md)。未来改动若改变快照、数据质量、证据、claim 或 overview 语义，必须同时更新本文和对应测试。

## 1. 当前结论

P0 已提供一条本地、只读、可重复验证的顾问底座：从同一个已提交的 `CampusStore` 版本生成 DataQuality、Evidence、LocalClaim、Risk 和 UrgentItem，再通过受信任的 IPC 返回一个自洽 overview。该路径不访问学校网络、不调用模型、不读取浏览器 session、不写 CampusState。

P0 本身不是完整 AI 顾问；P1-P3 与当前 Agent 均建立在本合同之上，不能反过来弱化下列 P0 边界。阶段关系如下：

| P0 已实现 | 后续阶段当前状态 |
| --- | --- |
| 原子 `snapshotWithRevision()` 和逐域 content digest | Agent 由独立 `AdvisorRuntime` 冻结请求并复核 revision |
| 逐来源/逐领域 provenance 与 DataQuality | Agent 通过惰性只读工具按需取得最小数据切片 |
| 证据注册、披露字段和闭合引用 | Agent 使用动态披露账本、固定工具协议和 `CitationVerifier` 的目录/不可信引用校验；最终普通文本不再被改写成 narrative JSON |
| 本地 typed claims、有限风险规则和稳定 agenda | 模型只能解释工具实际返回的本地条目 |
| 只读 `advisor:get-overview` 主进程服务 | Agent 已接入 Provider、流式转发、加密线程、取消、并发和预算 |
| trusted main-frame IPC、安全窗口边界和离线 packaged smoke | 加密 `AdvisorStore` 已启用；跨 revision 摘要、密钥轮换和旧 evidence 生命周期仍未实现 |

现有 `electron/model-service.mjs` 继续负责 OpenAI-compatible 模型探测和传输，以及作业、笔记、论文等既有工作流。P4 新增的 `electron/advisor-runtime.mjs` 在其外层负责冻结顾问快照、控制披露、校验 claim 引用和管理请求生命周期，因此 **ModelService 仍不等于 AdvisorRuntime**。

当前风险引擎已由 P1-P3 扩展到今日行动、培养方案、GPA/学分缺口和选课沙盘；这些上层能力的状态与验收必须以 `17-advisor-p1-p3-local-workbench.md` 和对应测试为准，不能只凭 P0 测试推断。P0 仍只证明快照、质量、证据、claim、overview 和安全前置合同。

## 2. 唯一的进程内数据流

```text
CampusStore active manifest
        |
        | snapshotWithRevision() exactly once
        v
VersionedSnapshot { state, revision, committedAt, domainDigests }
        |
        | clock() exactly once, timeZone=Asia/Shanghai
        v
DataQuality -> EvidenceRegistry -> RiskEngine -> AgendaEngine
        |                                  |
        +------------ LocalClaim ----------+
                           |
                           v
assertAdvisorOverview() -> trusted read-only IPC -> renderer
```

`electron/advisor-overview-service.mjs` 必须在进程内直接读取 `CampusStore.snapshotWithRevision()`。它不得：

- 请求 `127.0.0.1` loopback API；
- 读取 `theia-feed.json`；
- 创建或再读取 `theia-ai-context/v1` 导出包；
- 为生成 overview 发起模型或学校网络请求；
- 把计算结果写回 CampusState。

Loopback API、Feed、CLI 和 AI export 都是外部本机消费者的读取面。把进程内 Advisor 绕到这些读取面，会丢失或弱化 state、manifest revision、committedAt 与 domain digest 的原子关系，也会把静态导出合同误当作在线顾问的最小披露合同。

## 3. 原子快照和 overview 实例

### 3.1 VersionedSnapshot

```ts
interface VersionedSnapshot {
  state: CampusState;
  revision: string;
  committedAt: string | null;
  domainDigests: Record<AdvisorDomain, Sha256Hex>;
}
```

四部分必须来自同一个 committed view。禁止先调用 `snapshot()`，再从 manifest 或 `storageSummary()` 补 revision；两次读取之间可能发生提交，使内容和 revision 指向不同版本。

`snapshotRevision` 表示整轮一致性边界；`domainDigest` 表示某个领域内容的稳定摘要。无关领域写入可改变整库 revision，但不能伪造另一个领域的内容变化或采集水位。

### 3.2 四元实例键

一个 Advisor overview 的实例键是：

```text
{ snapshotRevision, evaluatedAt, timeZone, rulesVersion }
```

- `snapshotRevision` 固定业务快照。
- `evaluatedAt` 固定倒计时、分段和其他时间相关计算的求值时刻。
- `timeZone` 固定校园日期解释；当前为 `Asia/Shanghai`。
- `rulesVersion` 固定规则、ID 和排序语义。

外层 overview 与内层 `dataQuality` 的这四个值必须完全相同；claims、risks 和 urgentItems 的 `rulesVersion` 也必须等于外层值。`assertAdvisorOverview()` 对这些关系以及所有引用闭包做强校验。

renderer 或其他消费者收到任一键变化时，必须**整体替换** overview。禁止按 claim ID、risk ID 或 action ID 把两个实例拼接；尤其禁止保留旧实例的 `value`、`displayText`、`confidence`、`caveats`、score 或倒计时。

## 4. DataQuality 是多轴状态

数据质量不是一个“好/坏”枚举。一个领域可以同时有旧内容、完整性已知、最近刷新失败并且已过期。当前合同将以下轴正交保存：

| 轴 | 值 | 含义 |
| --- | --- | --- |
| `availability` | `available` / `empty-confirmed` / `absent` / `unknown` | 当前快照是否有内容，以及空值能否被解释 |
| `freshness` | `fresh` / `stale` / `unknown` | 相对 `evaluatedAt` 和逐域策略的水位状态 |
| `completeness` | `complete` / `partial` / `unknown` | 来源是否证明必要范围完整 |
| `lastAttempt.status` | `never` / `not-attempted` / `succeeded` / `failed` / `auth-required` | 最近一次来源尝试的结果 |
| `lastAttempt.retainedPrevious` | boolean | 最近失败/未完成后是否保留较早内容 |
| `provenanceInferred` | boolean | 是否因旧快照缺 provenance 而只能保守解释 |

必须遵守以下推论：

- `available` 不推出 fresh，也不推出 complete。
- `fresh` 不推出 complete；来源只返回部分记录时仍是 partial。
- `failed`/`auth-required` 不推出 absent；旧内容可以保留。
- 空数组/空对象不推出 `empty-confirmed`。
- 旧快照有记录但无逐域 provenance 时，availability 可为 available，freshness 和 completeness 仍必须 unknown。
- 全局 `snapshot.updatedAt`、记录展示时间或其他领域的成功时间不能替代当前领域水位。

### 4.1 两种 empty confirmation

`contentEmptyConfirmed` 与最近一次尝试结果正交：

- `contentEmptyConfirmed=true`：当前保留的内容状态曾由一次完整、成功的来源读取证明为空。
- `lastAttempt.emptyConfirmed=true`：仅表示最近一次尝试成功、完整并且读到空集合。

因此，先成功确认空集合、后一次刷新失败时，合法状态是：

```text
availability=empty-confirmed
contentEmptyConfirmed=true
lastAttempt.status=failed
lastAttempt.emptyConfirmed=false
```

这种组合不能被压扁为“没有数据”或“刷新成功”。失败尝试保留真实失败状态，当前内容则继续保留上一次可证明的空结论及成功水位。

### 4.2 派生领域

P0 定义三个派生领域：

```text
academic           <- terms + courses + selected-courses
coursework         <- assignments + workspaces
local-data-catalog <- fitness + school-schedule + academic-calendar
```

派生领域必须以所有必要子域为准：

- completeness 取最弱值：任一 unknown 则 unknown，否则任一 partial 则 partial，只有全部 complete 才 complete；
- `capturedAt` 和 `sourceSucceededAt` 取最老的必要子域有效水位；
- 任一必要子域缺少有效水位时，派生水位为 null，而不是选取其余子域的较新时间；
- 多来源同步的中间提交不得把尚未完成的聚合领域标为 complete；
- 最近状态和错误必须保留最弱依赖的失败或认证需求，不能被另一个成功来源掩盖。

这样 `coursework` 不会因为 workspace 刚保存而让旧 assignments 看起来刚刷新，`local-data-catalog` 也不会因一个资料库更新而高估另外两个资料库。

## 5. Evidence 和 LocalClaim

### 5.1 Evidence

EvidenceRegistry 只允许注册受控 dataset、领域、实体、字段集合、采集水位和摘要。每条 evidence：

- 绑定 `snapshotRevision` 和对应 `domainDigest`；`domainDigest` 必须等于同一 VersionedSnapshot 中该领域的纯业务内容摘要，禁止用 provenance、DataQuality 或其他派生摘要覆盖；
- 另有必填的 `evidenceDigest` 描述本条证据的解释内容。普通实体证据由受控 dataset/domain/entity/fields 描述生成；`sync-domain` 质量证据将 availability、freshness、completeness、采集水位、来源、解析器、最近尝试和业务 `contentDigest` 一起纳入该摘要；
- 用不暴露原始实体 ID 的 opaque ID；
- 显式记录允许字段与本轮实际披露字段；
- 不接受不存在、revision 不符、未注册或未披露的字段引用；
- 不把 source URL、查询参数、Cookie、token、API key、浏览器 session 或任意本机路径当作证据输出。

overview 输出前必须闭合全部引用：claim 的 `evidenceRefs` 必须存在；risk/urgent item 的 `evidenceRefs` 和 `claimIds` 必须存在；每条输出 evidence 至少披露一个已注册字段。`assertAdvisorOverview()` 还必须确认每条 evidence 的领域存在、`domainDigest === dataQuality.domains[domain].contentDigest`，并确认 `domainDigest` 与 `evidenceDigest` 都是合法 SHA-256。

`theia-advisor-overview/v1` 当前没有持久化缓存或对外公开交换合同，因此 P0 在 v1 内加入必填 `evidenceDigest`。未来若 overview 开始持久化或成为外部 API，再增加必填字段必须升级 schema 或提供显式迁移。

### 5.2 Claim 身份合同

当前 `claim1` ID 的 hash 输入精确包含：

```text
schema
kind
subject
predicate
domainDigest
evidenceDigest（仅当 claim 依赖质量/解释摘要时）
fields
rulesVersion
```

ID 不包含：

```text
evaluatedAt
value
displayText
confidence
caveats
evidenceRefs
```

这样，同一快照和规则下的 computed claim 可在不同 `evaluatedAt` 保持 ID 稳定，而倒计时 `value` 随时间正确变化。这个稳定性只用于识别同一类本地 claim，**不代表动态字段可以跨 overview 实例复用或 merge**。

关键事实、时间、数字、severity 和确定性计算应由本地 claim 承载。未来模型只能引用已披露 claim，不能创建或改写 fact/computed claim，也不能让 UI 从自由文本反向提取关键数字。

## 6. P4 模型请求的冻结规则

当前 Agent 按下列规则让每个模型请求形成自己的不可变请求上下文：

1. `AdvisorRuntime` 调用一次 `snapshotWithRevision()`，采样一次 `evaluatedAt`。
2. 本地引擎从该四元实例生成 DataQuality、Evidence、claim 和 action catalog。
3. Agent 启动时不会预披露 catalog 条目；模型只能通过固定只读工具按需取得允许的切片。
4. runtime 为本轮工具结果建立动态 claim/evidence/reference 账本；工具协议和不可信引用仍由 `CitationVerifier` 做边界校验。
5. 模型最终普通文本按原字节保存和流式显示，不再经过本地 narrative schema、引用补写或事实重写。
6. 即使等待期间 CampusStore 已提交新 revision，也不得把响应中的旧 ID 解析到“当前”catalog，或用当前值替换请求时值。
7. 若产品选择拒绝过期回答，应把它标为 revision conflict 并重新发起一轮明确请求；不得静默重绑定。

这条规则同时保护一致性和隐私：模型只能引用它实际看到且当时获准披露的事实。`snapshotRevision` 相同但 `evaluatedAt` 不同也属于不同 overview 实例，不能共用动态值。

## 7. 当前 P0 的安全边界

- overview 是离线纯计算；模型不可用、未配置 Key 或学校网络断开时仍可生成。
- IPC 只接受受信任主 frame；renderer 不获得通用 filesystem、session、shell 或任意 URL 能力。
- 生产窗口使用受限 CSP，并拒绝非许可导航、popup 和新窗口。
- ModelService 的请求/响应大小、取消、重定向和 service identity/key 边界属于模型 transport 安全前置，但不会自动提供顾问级授权和引用保证。
- AI export 仍是用户主动创建的静态、隐私敏感数据包；其存在不构成持续 consent，也不能作为当前或未来 AdvisorRuntime 的默认上下文。
- P0 不暴露写工具，不会登录、同步、抢课、填答、发信或提交。

## 8. 扩展时的验收清单

修改 P0 合同时至少验证：

1. 一次 overview 只读取一次 `snapshotWithRevision()`、采样一次 clock。
2. versioned snapshot 的 state/revision/digests 来自同一 manifest committed view。
3. 数据与 provenance 在同一次 store 更新中提交；失败不清空旧内容或成功水位。
4. `availability`、`freshness`、`completeness`、`lastAttempt` 和 `contentEmptyConfirmed` 未被互相推导。
5. 派生领域使用最弱完整性和最老必要水位。
6. 旧快照和缺 provenance 数据不被描述为实时、完整或已确认空。
7. overview 四元实例键内外一致，所有 evidence/claim 引用闭合；每条 evidence 的 `domainDigest` 等于对应领域业务 `contentDigest`，独立 `evidenceDigest` 存在且合法。
8. 同一 claim ID 跨时间的动态值变化有测试，消费端整体替换 overview。
9. 所有 P0 测试和 packaged smoke 使用 fixture，保持离线，不访问真实学校账户或模型。
10. 不把 ModelService、AI export 或 overview IPC 单独描述为完整模型顾问；Agent 状态必须以独立 `AdvisorRuntime` 和 [Agent 实施说明](20-a-b-c-advisor-agent-sidecar.md)为准。

相关实现与测试入口：

- `core/advisor/`
- `core/domain-provenance.mjs`
- `core/catalog-provenance.mjs`
- `core/store.mjs`
- `electron/advisor-overview-service.mjs`
- `tests/advisor-core.test.mjs`
- `tests/advisor-overview-ipc.test.mjs`
- `tests/catalog-provenance.test.mjs`
- `tests/store-and-api.test.mjs`
