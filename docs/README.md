# THEIA 文档中心

THEIA 是面向北京化工大学学生的本地优先 Windows 校园工作台。本文档中心按读者和稳定程度组织，当前行为以源码和测试为准。

完整的综合使用说明请先阅读根目录的 [README.md](../README.md)。

## 从这里开始

| 你想完成的事 | 推荐阅读 |
| --- | --- |
| 登录、同步和日常操作 | [用户指南](guides/USER_GUIDE.md) |
| 按页面查功能 | [功能文档](features/README.md) 与 [功能总览](features/overview.md) |
| 查询 MOTION 场馆状态 | [MOTION 场馆状态](guides/MOTION_VENUE_STATUS.md) |
| 使用 Iris QQ 伴侣 | [Iris 使用指南](guides/IRIS_GUIDE.md) |
| 理解进程、权限和数据流 | [系统架构](development/architecture.md) |
| 修改代码 | [开发者指南](development/developer-guide.md) |
| 理解数据如何采集、保存和恢复 | [数据生命周期](development/data-lifecycle.md) |
| 排查启动和数据问题 | [启动排障](development/troubleshooting.md) |
| 对接本机 API、MCP 或 Electron bridge | [API 与 IPC 参考](reference/api-and-ipc.md) 与 [本地 MCP 接入](../integration/README.md) |
| 读取字段和持久化结构 | [数据模型参考](reference/data-model.md) |
| 读取 AI 离线导出包 | [AI 导出契约](reference/ai-export-contract.md) |
| 理解顾问 Agent 的当前实现 | [顾问 Agent 工程说明](ai/20-a-b-c-advisor-agent-sidecar.md) |
| 测试、打包和发布 | [运行、测试与发布](development/operations-and-testing.md) |
| 阅读当前桌面候选版本更新 | [v0.7.1 更新说明](releases/v0.7.1.md) |
| 推进 Android 手机版增量对齐 | [手机版增量技术交接](development/mobile-increment-v0.7.0.md) |
| 查阅旧评审和实测记录 | [文档归档](archive/README.md) |

## 文档结构

```text
docs/
  README.md                         文档入口
  guides/                           用户操作与外部集成
  features/                         按页面拆分的功能说明
  reference/                        稳定的接口、数据和导出契约
  development/                      架构、开发、数据、运维与排障
  ai/                               当前仍在维护的 Agent 工程专题
  releases/                         按版本保留的发布历史
  archive/                          日期化评审、实测和工作记录
```

`local-docs/` 是本机资料目录，不属于公开文档入口。放入其中的文件只在本机按需读取，不会自动进入 Agent 上下文，也不应提交到 Git。

## 事实优先级

当文档、界面和实现不一致时，按以下顺序核对：

1. 当前源码和自动化测试；
2. 稳定契约：`core/schema.mjs`、`core/store.mjs`、`core/local-api.mjs`、`src/types.ts`、`electron/preload.cjs` 和 `electron/main.mjs`；
3. 本目录下的现行文档；
4. `archive/` 中的历史记录只作为当时证据，不能作为当前行为依据。

## 共同边界

- 校园凭据、Cookie、模型 Key、浏览器会话和原始认证页面不进入普通快照、导出、MCP 或本机 API。
- 本机 API 只绑定 `127.0.0.1`；数据读取端点只读，`POST /v1/sync` 直接调用明确数据域的本地同步器，`POST /v1/agent/chat` 只调用已配置的顾问对话；课程抓取不经过模型。
- Electron renderer 只能通过受限 bridge 使用主进程能力，不能直接访问磁盘、凭据、校园页面或任意网络。
- 选课、作业、在线测试和其他学校系统不可逆操作仍需用户确认。
- 空结果不能脱离来源状态解释为“学校没有数据”；应同时检查同步结果、完整性和最近成功时间。
