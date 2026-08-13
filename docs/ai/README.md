# THEIA 专题开发索引

本索引按常见维护任务连接相关模块文档；用户操作请参阅 [用户指南](../guides/USER_GUIDE.md)。

## 快速路由

| 任务 | 先读 |
| --- | --- |
| 新增或改造页面 | `02-frontend-shell-styles.md`、`03-frontend-views.md` |
| 设置、主题、背景、侧栏、窗口 | `02-frontend-shell-styles.md`、`04-settings-personalization.md` |
| 新增桌面能力 | `05-ipc-bridge.md`，再读对应服务文档 |
| 顾问 P0、数据质量、证据与本地 overview | `16-advisor-p0-foundation.md`，再读 `01-runtime-data-flow.md`、`06-storage-schema.md` |
| 外部本地工具、AI 数据包与离线导出 | `12-local-api-cli.md`、`../reference/ai-export-contract.md` |
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

Loopback API、CLI 和导出是面向本机工具的通用读取面。不要把外部工具的配置、密钥或状态迁入 THEIA 数据目录。

`core/advisor/` 当前是无模型、确定性的 P0 底座，不等于完整 Advisor 产品。现有 `ModelService` 也不等于未来负责冻结请求、授权披露和响应校验的 `AdvisorRuntime`；具体完成范围与未实现项见 `16-advisor-p0-foundation.md`。

## 维护要求

改动模块的职责、IPC、状态字段、数据来源、视觉约束或验证方式时，必须在同一个变更中更新本目录对应文档；新增横切功能时更新本索引的路由表。
