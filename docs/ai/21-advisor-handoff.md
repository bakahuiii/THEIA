# THEIA AI 顾问交接说明

更新日期：2026-08-14。此文件供下一位维护者或新的 Codex 对话直接接手，不替代专题设计文档。

## 当前状态

P0-P5 的顾问基础能力、用户可控数据范围、流式输出、多协议模型和只读工具 Agent 已在当前工作树实现。还没有完成真实用户配置 Provider 的端到端人工验收，且没有获得打包、提交、推送或发布授权。

工作树本来就包含大量未提交改动和新增文件。后续只能增量修改，绝不能以 `git reset`、`git checkout --` 或删除未跟踪文件来清理工作树。

用户明确暂停课程平台的后台 Course task / P6 课程队列：不得继续实现，也不得将它和顾问 Agent 合并。

## 最近紧急修复

曾报错：`IPC theia:advisor:prepare: unknown field readableDomains`。

根因是 renderer 已传递 `readableDomains` 和 `agent`，主进程 `advisorPrepareRequest()` 的字段白名单没有同步。已在 [ipc-security.mjs](../../electron/ipc-security.mjs) 修复，并在 [ipc-security.test.mjs](../../tests/ipc-security.test.mjs) 添加回归。

- `theia:advisor:prepare` 允许可选 `agent` 布尔值与 `readableDomains` 数组。
- 只允许 12 个既定只读领域：`assignments`、`exams`、`grades`、`academic-progress`、`courses`、`schedule`、`selected-courses`、`course-selection`、`profile`、`notices`、`mailbox`、`fitness`。
- 数组最多 12 项。未知领域、非数组、非字符串项和伪造布尔值均在 IPC 分发前失败关闭。

修复已通过：`npm test`（599/599）、`npm run lint`、`npx tsc -b --pretty false`、`npm run build`、`git diff --check`。改动位于 Electron 主进程，人工复验前必须完全退出并重新启动 THEIA；热更新无法加载新白名单。

## 已实现路径

### A：内嵌顾问

- UI：`src/views/AdvisorView.tsx`、`src/components/advisor/AdvisorWorkbench.tsx`。
- 用户可输入问题、选择意图/通知/邮件，并在“本次可读取数据”显式多选领域；未选择时按意图保守默认，已选择时只投影明确选择的领域。
- `prepare` 冻结 `CampusStore.snapshotWithRevision()`，生成最小上下文和披露计划；`send` 前再次校验快照和短时同意。
- 流式内容只是临时预览。只有最终结构化回答通过引用校验才会持久化。
- 线程由独立 `AdvisorStore` 加密保存，不进入 `CampusState`、日志、loopback API 或 AI 导出包；历史原文不会自动在下一轮外发。

### B：只读工具 Agent

- UI 以 `agent: true` 选择本轮 Agent。
- 只能调用固定的本地只读工具，输入仅来自已经披露且冻结的顾问投影。
- 最多 6 步，同一工具最多 2 次，继续受 90 秒、输入/输出预算和 `CitationVerifier` 约束。
- 没有网络、浏览器会话、文件、Shell、凭据、同步、登录、IPC 代理、课程写入或校园提交权限。
- 关键实现：`core/advisor/read-only-agent.mjs`、`core/advisor/read-only-tools.mjs`。

### C：导出 / Sidecar

- 使用用户显式操作生成的 `theia-ai-context/v1` 导出。
- Sidecar 只能处理用户手动交付的导出目录，先校验 `manifest.json`、文件白名单、字节数和 SHA-256。
- Sidecar 不得读取 THEIA 数据目录、AdvisorStore、凭据、浏览器 profile 或运行中 IPC，也不得回调或写入 THEIA。
- 导出不是后台同步授权，也不等于用户批准 Sidecar 将数据继续发送给其他模型。

## 不能突破的边界

1. 模型不是事实来源。课程、GPA、风险、DataQuality、Evidence 和 Agenda 必须先在本地确定性计算；模型只能解释并提出可验证建议。
2. 模型只能看到 `ContextBuilder` 白名单投影，不能读取 `CampusStore`、源页面、Cookie、密码、绝对路径、原始 HTML 或附件二进制。
3. 每次出站都需要当前请求的披露确认；实时预览只影响输出显示，绝不能决定可读取数据范围。
4. 通知、邮件、附件和校园网页文本均为不可信输入，不能改变系统提示、开启工具、提升权限或成为本地事实。
5. 最终输出必须符合 `theia-advisor-model-narrative/v1` 并通过 `CitationVerifier` 的 claim / evidence / reference 闭合校验；失败即关闭，不能保存或作为正式答案显示。
6. 不得新增 filesystem、任意 URL、network、browser session、credentials、sync、login、submit、shell 或通用 IPC 能力。

## 模型协议

| 协议 | 请求接口 | 流式格式 |
| --- | --- | --- |
| `openai-compatible` | Chat Completions | SSE |
| `anthropic-messages` | Messages | SSE |
| `gemini-generate-content` | GenerateContent | SSE |
| `ollama-chat` | `/api/chat` | NDJSON |

协议必须由用户显式选择，不能根据模型名称猜测。Ollama 未配置 Key 时仅允许字面量 loopback 地址；远程服务仍受 HTTPS、地址、DNS 固定、重定向、超时、响应大小和取消策略约束。主进程持有 API Key，renderer 不读取凭据。

## 下一次对话的建议顺序

1. 完全重启 THEIA。选择成绩、考试等多项“本次可读取数据”后执行准备，确认不再出现 `unknown field readableDomains`，且披露弹窗与勾选范围一致。
2. 分别验证普通顾问、流式预览和只读 Agent；检查取消、超时、未配置模型、无效模型输出和快照变更后的失败提示。
3. 选择一封已缓存邮件，分别验证仅元数据和本次正文授权；未选择的通知/邮件不得因检索或 Agent 而外发。
4. 用真实且用户有权使用的 Provider 做端到端验收：最终回答必须有引用、无链接/路径/密钥泄漏、无未引用数字，且只有通过校验的回答进入线程。
5. 人工验收完成并取得用户明确授权前，不打包、不提交、不推送、不发布。

## 必读文档与测试

| 主题 | 文档 | 优先测试 |
| --- | --- | --- |
| P0 质量、证据、风险与动作 | [16-advisor-p0-foundation.md](16-advisor-p0-foundation.md) | `tests/advisor-core.test.mjs` |
| P1-P3 本地工作台与学业能力 | [17-advisor-p1-p3-local-workbench.md](17-advisor-p1-p3-local-workbench.md) | `tests/advisor-academic.test.mjs`、`tests/advisor-course-decision.test.mjs` |
| P4-P5 顾问运行时、通知与邮件 | [18-advisor-p4-p5-model-runtime.md](18-advisor-p4-p5-model-runtime.md) | `tests/advisor-runtime.test.mjs`、`tests/advisor-notice-mail.test.mjs` |
| 用户数据范围、线程、流式与只读 Agent | [19-p6-data-flow-and-open-agent.md](19-p6-data-flow-and-open-agent.md) | `tests/advisor-p6-foundation.test.mjs`、`tests/advisor-read-only-agent.test.mjs` |
| A/B/C、Sidecar 与多协议 | [20-a-b-c-advisor-agent-sidecar.md](20-a-b-c-advisor-agent-sidecar.md) | `tests/advisor-provider.test.mjs`、`tests/ipc-security.test.mjs` |
| IPC 边界 | [05-ipc-bridge.md](05-ipc-bridge.md) | `tests/ipc-security.test.mjs` |

完整回归顺序：`npm test`、`npm run lint`、`npx tsc -b --pretty false`、`npm run build`、`git diff --check`。

全量测试不能代替真实 Provider 和桌面人工验证；这两项仍是当前版本最重要的未完成验收。
