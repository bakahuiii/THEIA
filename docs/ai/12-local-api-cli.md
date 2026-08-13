# 本地 API、CLI 与导出

## 安全边界

`core/local-api.mjs` 只绑定 `127.0.0.1`，并且只读。不得增加公网监听、写入端点、代理转发或宽松的 CORS。

当前端口记录在 `api-runtime.json`。默认端口是 `8765`；如果被占用，会在一个很小的本地端口范围内回退。

## API 契约

```text
GET /v1/health
GET /v1/data-manifest
GET /v1/collections
GET /v1/profile
GET /v1/sync
GET /v1/feed
GET /v1/data-catalog
GET /v1/fitness?year=2025-2026_1
GET /v1/school-schedule?termId=2025-3&keyword=MAT13904T
GET /v1/academic-progress
GET /v1/{terms|courses|schedule|exams|grades|selected-courses|assignments|workspaces|notices|emails}
GET /v1/{collection}.csv
GET /v1/calendar.ics
```

`/v1/data-manifest` 只公开存储布局元数据和分片名称，不提供任意文件读取。集合端点可以接受 `?since=<ISO timestamp>`。

使用 `/v1/feed` 获取规范化的完整数据视图，使用集合端点选择性读取，使用 `/v1/school-schedule` 查询本地学期缓存。它们均返回规范化数据，不得暴露凭据、原始页面、会话状态或私有二进制附件。

## CLI

```text
theia status [--json]
theia export --format json|ndjson|theia|ics|csv --collection grades --output FILE
theia export --format ai --output DIRECTORY
theia work list|show|import ...
theia serve [--port 8765]
theia api
theia doctor
```

CLI 与桌面应用读取同一个分片式 `CampusStore`，绝不能自行实现另一套文件解析器，也不能直接写入 `data/`。

`export --format ai` 会在指定父目录下新建 `THEIA-AI-EXPORT-YYYYMMDD-HHmmss/` 子目录。它与桌面端“导出供 AI 使用”命令共用 `core/ai-export.mjs` 构建器，包含 SHA-256 清单，且绝不会覆盖既有数据包。修改其 Schema、文件清单或净化规则前，请先阅读[《AI 导出契约》](../reference/ai-export-contract.md)。

对于用户明确发起的外部 AI 任务，应优先使用该数据包，而不是原始 Feed 或直接读取分片。数据包向模型提供 `AI_CONTEXT.md`、`DATA_DICTIONARY.md`、来源与可用性说明，并移除路径和凭据。它仍然是静态且涉及隐私的快照：必须先校验 `manifest.json`，不得据此推断学校系统实时状态，也不得尝试访问 URL、会话或附件。

该数据包不是 THEIA 进程内顾问的运行时输入。确定性概览直接从 `CampusStore` 读取一次 `snapshotWithRevision()`，不发起回环请求，也不经由导出往返。未来的远程模型请求必须使用范围更窄、受用户授权约束的 `ContextBuilder`，不得静默复用完整导出包。

## AI 消费者规则

以下规则适用于 THEIA 主进程之外的程序：

1. THEIA 运行时，优先使用回环 API。
2. 否则读取原子生成的兼容性导出 `theia-feed.json`。
3. 磁盘级工具必须使用 `data/manifest.json`，并在读取前校验每个被引用分片的摘要。
4. 来源 URL、采集时间、解析器版本和刷新状态属于来源证据，不是可以忽略的展示噪声。
5. 不得根据数据文件推断凭据是否可用。

这些规则不适用于 `core/advisor/`。如果内部顾问通过回环 API 或 Feed 读取数据，会丢失状态、修订号和数据域摘要之间的原子关系。
