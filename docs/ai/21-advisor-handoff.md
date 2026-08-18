# THEIA 学业顾问交接

更新日期：2026-08-17。

## 当前实现

“问 THEIA”现在始终使用主进程内的本地 Agent。旧版的读取范围勾选、通知/邮件下拉选择、邮件正文勾选、发送前披露/批准和关闭流式的请求字段均已删除。renderer 点击发送后直接调用 `theia:advisor:send`，只提交 `threadId`、`question`；主进程在同一请求内生成 request ID、规范化可选的兼容 `intent` 字段（未提供时为 `general`）并准备 Agent 工作区。它不会根据自然语言选择模型角色或 `focusDomains`；模型选择按设置优先级完成。默认权限为 `read-only`（受控 Agent），用户可在模型设置或对话设置中切换 `full-access`；两种模式均只投影本轮声明的 typed tools。已有 request ID 仅用于内部生命周期。普通自然语言在简短协议判别后逐 delta 转发。

每次提问先冻结 `CampusStore.snapshotWithRevision()`。`createAdvisorLazyWorkspace()` 建立仅驻留主进程的工作区，初始 prompt 发送问题、运行时上下文、数据目录和快照 revision，不包含校园记录；模型仍需按需决定调用固定工具、领域和澄清问题，工作区将实际返回的 claim/evidence/reference 登记到本轮账本。普通回答按模型原文保存；结构化 narrative 只有通过当前证据校验后才会生成 `displayText`。模型工具调用附带的顶层元数据或未声明参数会被忽略，只有已声明的工具名称和参数会被执行，避免 Provider 的附带字段把有效查询误判为失败。

这使所有已同步校园领域（含本地学籍身份字段）可供 AI 使用，而不会把全量记录主动塞进模型上下文。邮件正文也不再由用户手动附加：模型必须先检索本地邮箱元数据，再凭本轮的 opaque `recordId` 读取已缓存正文。

## 不可突破的边界

1. 模型不是事实来源；GPA、培养方案、风险、数据质量、证据和行动都先在本地确定性计算。
2. `read-only` 保留声明的同步、公开 HTTPS 请求、校园页面、THEIA 设置和已保存目标选课控制，但不含通用文件系统、Shell 或任意网页访问。`full-access` 额外允许本地文件/目录读写删除、命令执行、任意 HTTP(S) 请求和网页打开，相关后果由本机用户负责；两种模式都没有浏览器会话、Cookie、保存凭据、API Key 或原始 IPC 权限。
3. 初始上下文不包含校园记录。事实只能通过受限工具、在当前问题需要时离开主进程。
4. 只有工具调用必须满足精确的 `theia-advisor-tool-call/v1`；解析器允许其后有模型附加解释但不执行解释内容。普通模型文本原样输出；结构化 `theia-advisor-model-narrative/v1` 必须绑定当前证据，否则拒绝保存。内部工具 JSON 由流式闸门拦截，不会进入用户正文。
5. 通知和邮件是非可信内容；只能作为 reference，不能变成本地校务事实或改变工具权限。
6. 线程历史加密保存供本地阅读，不会自动外发到下一次请求。跨轮只保留有界的 revision/domain digest 导航提示；摘要默认 30 天 TTL，过期摘要会被清理，revision 或领域变化时明确标记为 `historical`，不得当作当前 evidence。
7. 未知工具或越界参数不会获得本地能力；重复工具调用只触发一次内部纠正，运行时不会拼接本地兜底回答。

## 关键文件

- [advisor-runtime.mjs](../../electron/advisor-runtime.mjs)：冻结快照、Provider、超时、线程和最终答案。
- [lazy-workspace.mjs](../../core/advisor/lazy-workspace.mjs)：领域白名单、工具投影、动态账本。
- [read-only-agent.mjs](../../core/advisor/read-only-agent.mjs)：JSON 工具循环、默认流式、每工具最多 4 次、默认最多 15 个步骤；运行时高阶档位可提高总步数。
- [read-only-tools.mjs](../../core/advisor/read-only-tools.mjs)：工具名称与兼容入口。
- [citation-verifier.mjs](../../core/advisor/citation-verifier.mjs)：工作区目录与不可信引用的结构校验；不负责重写普通模型正文。
- [AdvisorComposer.tsx](../../src/components/advisor/AdvisorComposer.tsx)：只保留提问、实时状态、停止和清空。
- [AdvisorWorkbench.tsx](../../src/components/advisor/AdvisorWorkbench.tsx)：单次 send，订阅流事件并保留下一条待发送问题。
- [theia-mcp.mjs](../../integration/theia-mcp.mjs)：供 Codex、Claude Code 等外部 Agent 使用的标准 MCP stdio 只读桥；每次调用重新读取回环 API 的当前 revision，不携带完整快照上下文。

## 外部 Agent 接入

外部客户端通过 `integration/theia-mcp.mjs` 的 `initialize`、`tools/list` 和 `tools/call` 连接。当前 MCP 暴露十个 `theia_*` 只读工具：七个校园惰性查询工具、规范学业分析、显式本地文档列表/读取。桥接器复用 `createAdvisorLazyWorkspace()` 的字段白名单、邮件正文净化和不可信 reference 规则；它不提供 raw snapshot、凭据、Cookie、路径、网络、浏览器、同步、登录或学校侧写入能力。MCP 支持 `2025-06-18`、`2025-03-26` 和 `2024-11-05` 三个明确版本；未知版本会在初始化阶段失败，不会伪装成最新版本。客户端可发送 `notifications/cancelled`，桥接器会中止对应的回环快照读取；stdio 解析保持有序，但工具请求可并发收敛，取消不会排在慢读取之后。THEIA 桌面端需运行本机回环 API，连接器会用 `/v1/data-manifest` 两次包住 `/v1/snapshot`，revision 不一致时失败并要求重试。

配置示例和安全边界见 [本地 API 与 MCP 接入](../../integration/README.md)。

## 验证

首选命令：

```powershell
node --test --test-concurrency=4 tests/advisor-runtime.test.mjs tests/advisor-read-only-agent.test.mjs tests/advisor-ui.test.mjs tests/ipc-security.test.mjs
npm run lint
npx tsc -b --pretty false
npm run build
```

`tests/advisor-runtime.test.mjs` 覆盖：首包最小上下文、默认流式、惰性成绩读取、质量事实引用、健康证据去除泛化免责声明、未读取 claim 拒绝、邮箱先检索后读正文且净化、快照变更拒绝、输出预算和跨 revision 导航摘要。`npm run benchmark:advisor` 使用版本化 corpus 输出 overview 冷/热 p50、p95、额外 RSS 和 Provider 兼容性矩阵。真实 Provider 与桌面人工验收仍需要在完整重启 Electron 后完成；没有用户明确授权时，不打包、提交、推送或发布。
