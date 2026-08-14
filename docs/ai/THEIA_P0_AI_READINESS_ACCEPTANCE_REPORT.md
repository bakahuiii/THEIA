# THEIA P0 模型接入前验收报告

> 验收日期：2026-08-13（Asia/Shanghai）
> 项目：`H:\work\THEIA`
> 范围：P0 本地可信底座与模型接入安全前置
> 最终状态：**P0 本地代码与离线产物通过，可以开始 P1；尚不可宣称完整 AI 顾问可用**

## 1. 最终判断

本轮没有发现未解决的 P0 blocker 或 high finding。代码、离线测试、生产构建、Windows 解包产物、packaged smoke 和 ASAR 内容审计全部通过，因此 P0 可信底座正式放行。

这项放行只回答一个问题：THEIA 是否已经具备在模型接入前不能后补的安全与证据地基。答案是“是”。它不表示以下能力已经实现：

- P1 的 Dashboard Top 1、AdvisorView Top 7、证据抽屉和 snooze；
- `AdvisorRuntime`、`ProviderAdapter`、`ContextBuilder`、`DisclosurePlan`；
- 严格模型 narrative schema、`CitationVerifier`、请求级 claim/action/evidence allowlist；
- 顾问线程、敏感领域 consent、只读工具循环和流式响应；
- 培养方案、GPA、选课复杂规则或作业 AutoQueue；
- 真实模型、学校系统或真实数据根上的在线验收。

现有 `ModelService` 是 OpenAI-compatible 传输与既有作业内容生成器，**不等于**未来的 `AdvisorRuntime`。在 ContextBuilder、DisclosurePlan 和 CitationVerifier 完成前，不得把通用顾问模型直接接到完整 `CampusState`。

## 2. P0 已验收能力

| 领域 | 已验收合同 | 状态 |
|---|---|---|
| 原子快照 | `CampusStore.snapshotWithRevision()` 同时绑定 state、revision、committedAt、domainDigests | 通过 |
| 数据质量 | availability、freshness、completeness、lastAttempt 正交表达；legacy 不伪造水位 | 通过 |
| 证据链 | opaque evidence ID、纯业务 domainDigest、独立 evidenceDigest、披露字段与引用闭包校验 | 通过 |
| 本地判断 | typed LocalClaim、有限 RiskEngine、确定性 Agenda、固定 now/timezone/rulesVersion | 通过 |
| 离线入口 | `advisor:get-overview` 只读，一次原子快照和一次时钟采样 | 通过 |
| Renderer/IPC | trusted main-frame sender、全通道 runtime schema、生产 CSP | 通过 |
| Settings 隐私 | 显式白名单、类型/长度/范围约束，未知字段和旧秘密字段不持久化 | 通过 |
| 模型网络 | 公网 HTTPS、显式 loopback HTTP 例外、全 DNS 结果审计、地址固定、禁止重定向 | 通过 |
| 资源控制 | 请求 2 MiB、模型列表响应 2 MiB、完成响应 8 MiB；超时、取消、dispatcher 清理 | 通过 |
| Key 与配置 | DPAPI、精确 service identity、显式 probe ticket、串行 crash-safe journal 与启动恢复 | 通过 |
| 迁移 | legacy state、vault、pending journal 按 cohort 迁移；已有 current cohort 时整组拒绝混迁 | 通过 |
| AI 导出 | `theia-ai-context/v1` 领域覆盖、净化与 manifest SHA-256；不以全局时间伪造领域新鲜度 | 通过 |
| 打包 | 凭据提取器、运行态 secrets、数据库、日志和 journal 不进入应用包 | 通过 |

## 3. 最终强制门禁

以下结果均来自最后一次代码修复后的工作树或由该工作树重新生成的产物：

| 门禁 | 结果 | 证据 |
|---|---|---|
| P0 定向测试 | 通过 | 77/77；0 fail、0 skipped、0 todo |
| `npm test` | 通过 | 279/279；0 fail、0 skipped、0 todo |
| `npm run lint` | 通过 | ESLint exit 0 |
| `npm run build` | 通过 | TypeScript 与 Vite exit 0；1838 modules transformed |
| `npm run dist:unpacked` | 通过 | Electron Builder 26.15.3，Electron 43.2.0，Windows x64 解包产物重建成功 |
| `npm run smoke:packaged` | 通过 | 隔离临时数据根；bridge 方法完整；overview revision 闭合；PDF 15554 bytes；本地 OCR runtime 正常；0 preload errors |
| ASAR 内容审计 | 通过 | 8176 个文件；82 个 THEIA 自有文件；禁止运行态文件、现场标记和私钥标记均 0 命中 |
| 直接网络依赖 | 通过 | 源码与 ASAR 内均为 `undici@7.29.0`；smoke 的 `process.versions.undici=7.28.0` 是 Electron 内置版本，不是 `model-service.mjs` 导入的直接依赖 |

生产构建保留一条非阻断提示：主 JavaScript chunk 约 617.02 kB，超过 Vite 500 kB 建议阈值。这是性能债，不是 P0 安全或正确性失败。

packaged smoke 还保留一条 Electron API 弃用提醒：旧式 `console-message` 回调参数未来会移除。当前行为有效，不影响 P0；升级 Electron 前应迁移到事件参数对象。

## 4. 本轮发现并修复的问题

第一次最终 packaged smoke 虽返回 exit 0，但退出期间记录了两次未捕获的 `Object has been destroyed`。根因是 CSP 响应回调在主窗口销毁后再次读取 `window.webContents.id`。

修复包括：

1. 创建窗口时冻结 `mainWebContentsId`，异步回调不再解引用已销毁窗口；
2. packaged smoke 捕获子进程 stdout/stderr；
3. 发现 THEIA 的 `uncaught exception` 或 `unhandled rejection` 时，即使进程 exit 0 也强制判失败；
4. 加入静态回归断言；
5. 重新构建并再次运行 packaged smoke，未再出现该异常。

这说明最终门禁确实审计了运行行为，而不是只接受脚本退出码。

## 5. 模型网络对抗复审

复审全程只使用本机 loopback 和注入式 resolver，没有访问外网、学校系统或真实模型。

- `tests/model-service.test.mjs`：25/25 通过；
- 真实 Undici dispatcher 固定到已审核 loopback 地址并保留 Host；
- 真实 302 被 `redirect: error` 拒绝，第二个 loopback 服务命中 0 次；
- mixed public/private、IPv4-mapped 与特殊用途地址集合整体拒绝；
- 挂起 resolver 在外部取消后约 0.40 ms 返回，且没有创建 dispatcher；
- 成功、HTTP 503 和响应中途取消路径均关闭或销毁 dispatcher；
- 响应中途取消后约 2.90 ms 拒绝，服务端 socket 释放；
- Undici 7.29.0 源码确认 pinned lookup 仍以原 URL hostname 作为 TLS `servername`。

网络复审结论：**未发现可复现的 SSRF 主路径绕过或 P0 阻断项。**

## 6. 真实数据只读核验

本轮没有启动 THEIA 的真实配置迁移，没有真实同步，也没有写入 `C:\Users\Administrator\AppData\Roaming\THEIA`。

只读核验结果：

- manifest schema 为 `theia-sharded-store/v1`；
- 当前 revision 为 `0e56f082-5e2a-4d29-929e-1d4b036a5c70`；
- manifest 引用 17 个分片；
- 使用项目相同的 UTF-8 JSON 与 value SHA-256 规则复核，17/17 完整性通过；
- 当前 `state/sync`、`buct-data.json` 和 backup 均没有新版 `sync.domains`；
- 两份 legacy snapshot 的顶层与 settings 中均未发现旧明文秘密字段。

因此，真实数据是**完整的旧 provenance 快照**，不是损坏数据；但它尚未建立新版逐领域水位。新版必须将相关 freshness/completeness 保守显示为 unknown，不能从全局 `updatedAt` 或业务记录时间反推“刚同步、完整、现实为空”。

## 7. 产物

| 产物 | 大小 | SHA-256 |
|---|---:|---|
| `H:\work\THEIA\release-bin\win-unpacked\THEIA.exe` | 225729024 bytes | `F3FC3F406E1236C71383A0EA4B64ECC75AF538D6DEA30C9D9C4FD1C0DB3AD3DE` |
| `H:\work\THEIA\release-bin\win-unpacked\resources\app.asar` | 238445459 bytes | `9A8975506D3F1C805675B6959F0C5A91BC957B249B32286DCB8C12EEEEF00DF7` |

根目录方案与本报告的 SHA-256 在报告完成写入后另行计算并记录于 `H:\THEIA_P0_SHA256SUMS.txt`；报告不能可靠地内嵌自身最终哈希。

## 8. 残余风险与后续测试债

以下均已记录，但按当前代码路径和动态验证结果不构成 P0 阻断：

1. 自定义 resolver 若忽略取消并永久不结束，调用方可以竞速退出，但无法终止 resolver 内部工作；
2. `endpoint.close()` 没有独立 deadline；取消路径强制 destroy，常规路径依赖 Undici 正常 close；
3. pinned public hostname 的 TLS/SNI 只做了源码核对，未做本地动态证书集成试验；
4. 15 秒/90 秒定时器自身、悬挂 headers/body 和迟到 resolver rejection 尚无可控时钟矩阵；
5. save/clear 的双向交错、journal 全崩溃点矩阵和恢复过程中再次崩溃尚未穷举；
6. legacy cohort 复制中途 I/O 失败和 partial-tree 故障尚未注入；
7. Vite 大 chunk 与 Electron `console-message` 弃用提醒需要后续维护。

这些条目应进入后续纵深加固，不得被描述为“零风险”，但不需要阻止 P1 开始。

## 9. 唯一后续动作

今天到此为止，不再进行真实模型接入、学校同步或现场迁移。

休息后，唯一需要由用户主动完成的动作是：**使用这版 THEIA 明确触发一次新版同步，并刷新需要纳入顾问的数据源。** 这会让真实数据建立 `sync.domains` 领域水位。同步后先核对数据质量状态，再进入 P1；本轮不代为执行。

## 10. 签字

- 代码冻结：2026-08-13 06:47（Asia/Shanghai）
- 强制门禁：通过
- 网络复审：通过，无 P0 blocker/high finding
- 打包内容与哈希：通过
- 真实数据：17/17 分片完整；新版领域水位尚未建立
- 放行判断：**P0 通过，可以开始 P1；尚不可直接宣称完整 AI 顾问可用**
