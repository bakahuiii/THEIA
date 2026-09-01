# THEIA 专题开发索引

本索引按常见维护任务连接相关模块文档；用户操作请参阅 [用户指南](../guides/USER_GUIDE.md)。

## 快速路由

| 任务 | 先读 |
| --- | --- |
| 新增或改造页面 | `02-frontend-shell-styles.md`、`03-frontend-views.md` |
| 设置、主题、背景、侧栏、窗口 | `02-frontend-shell-styles.md`、`04-settings-personalization.md` |
| 新增桌面能力 | `05-ipc-bridge.md`，再读对应服务文档 |
| 顾问 P0、数据质量、证据与本地 overview | `16-advisor-p0-foundation.md`，再读 `01-runtime-data-flow.md`、`06-storage-schema.md` |
| 顾问 P1-P3、今日行动、学业分析与选课沙盘 | `17-advisor-p1-p3-local-workbench.md`，前置合同见 `16-advisor-p0-foundation.md` |
| 顾问 Agent、流式模型运行时、通知与邮件按需读取 | `20-a-b-c-advisor-agent-sidecar.md`，前置本地合同见 `16-advisor-p0-foundation.md`、`17-advisor-p1-p3-local-workbench.md` |
| 顾问 Agent、惰性工具、流式模型运行时与多协议模型 | `20-a-b-c-advisor-agent-sidecar.md` |
| 外部本地工具、MCP 与 AI 数据包 | `../reference/api-and-ipc.md`、`../../integration/README.md`、`../reference/ai-export-contract.md` |
| 登录、Cookie、抓取、同步 | `07-auth-and-sync.md`、`08-academic-sources.md` |
| 作业、在线测试、模型 | `09-coursework-model-selection.md` |
| 抢课、全校课表、哨兵 | `15-course-selection-api.md`，再读 `09-coursework-model-selection.md` 的人工确认边界 |
| 邮箱 | `10-mailbox.md` |
| 体测、学习工具 | `11-fitness-tools.md` |
| 测试、发布、排障 | `13-testing-release.md` |

## 不可突破的约束

- THEIA 是 Windows 本地优先 Electron 客户端；不增加云端账户、遥测或第三方后端。
- 凭据只能由 Electron `safeStorage` 管理；不得进入 `CampusState`、日志、导出、错误消息或测试夹具。
- 学校网络访问只允许已验证的官方域名；外部 URL 必须经过主进程白名单检查。
- `CampusState` 是业务事实来源，但不同消费者使用不同读取面：进程内 Advisor 必须从 `CampusStore.snapshotWithRevision()` 取得原子版本快照；外部工具才使用 loopback API、Feed 或用户明确导出的 `theia-ai-context/v1` 数据包。
- 学校表单提交、作业提交和在线测试最终提交必须保留用户确认。

## 读代码的顺序

1. `src/App.tsx` 决定页面装配。
2. `src/hooks/useTheiaApp.ts` 管理 renderer 状态和大部分用户动作。
3. `src/types.ts` 是 renderer/main 契约。
4. `src/bridge.ts`、`electron/preload.cjs`、`electron/main.mjs` 是 IPC 链。
5. `core/` 是可测试业务逻辑；优先把解析和状态转换写在这里。

Loopback API、MCP 和导出是面向本机工具的读取面。不要把外部工具的配置、密钥或状态迁入 THEIA 数据目录。

`core/advisor/` 同时包含 P0-P3 的确定性数据质量、证据、今日行动、学业分析和选课决策，以及 Agent 的惰性工作区、工具合同、模型叙述和引用校验。`electron/advisor-runtime.mjs` 负责冻结请求、强制流式 Provider 调用、动态账本和响应校验；既有 `ModelService` 只提供模型传输能力，不能单独视为顾问运行时。当前 Agent 说明见 `20-a-b-c-advisor-agent-sidecar.md`。

## 维护要求

改动模块的职责、IPC、状态字段、数据来源、视觉约束或验证方式时，必须在同一个变更中更新本目录对应文档；新增横切功能时更新本索引的路由表。
