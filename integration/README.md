# THEIA 本地数据接口

THEIA 为本机集成提供只读回环 API。它绝不会暴露学校密码、Cookie、认证页面、学校原始 HTML 或模型 API 密钥。

桌面客户端运行时，可以从 THEIA 数据目录读取 `api-runtime.json`，也可以调用 `theia-client.mjs` 中的 `discoverTheiaApi()`。服务只绑定 `127.0.0.1`。

```js
import { fetchTheiaFeed } from './integration/theia-client.mjs'

const feed = await fetchTheiaFeed()
```

## Codex / Claude Code 的只读 Agent 接入

THEIA 还提供标准 MCP stdio 服务器 `theia-mcp.mjs`。它不把完整快照放进外部 Agent 上下文，而是每次工具调用重新读取回环 API 的当前快照和 revision，再复用桌面 Agent 的有界、脱敏投影。

服务器只提供以下只读工具：数据健康、校园记录搜索、本地事实搜索、截止事项、学业进度、规范学业分析、课程分析、单封邮件正文，以及显式放入本机资料目录的文档列表/读取。不会暴露 raw snapshot、凭据、Cookie、认证会话、绝对路径、网络/浏览器操作或任何学校侧写入动作；通知、邮件正文和本机文档均按不可信文本处理。

THEIA 项目下的 `local-docs/` 是本机资料目录。它不进入安装包或源代码压缩包，目录内容不提交 Git；工具只有在 Agent 明确调用 `theia_list_local_documents` 后才会返回 opaque `documentId`，再按需读取有限字符。默认支持 PDF、Markdown、HTML、TXT、JSON、CSV、XML、DOCX、PPTX、XLSX 文本提取；可以用 `THEIA_LOCAL_DOCS` 指向其他本机目录。HTML 会先变成无活动标签的纯文本，符号链接、路径穿越和超大文件会被拒绝。

Codex 配置（`config.toml`）：

```toml
[mcp_servers.theia]
command = "node"
args = ["H:\\work\\THEIA\\integration\\theia-mcp.mjs"]
```

Claude Code 配置：

```powershell
claude mcp add --scope user theia -- node H:\work\THEIA\integration\theia-mcp.mjs
```

THEIA 桌面客户端需要正在运行并启用本机 API（默认绑定 `127.0.0.1`）。自动发现会同时校验 `api-runtime.json` 的回环地址、端口、启动时间和仍存活的桌面进程；连接器也支持 `THEIA_MCP_API_URL=http://127.0.0.1:<port>` 覆盖 runtime 自动发现，但该值必须是本机回环 HTTP 地址。客户端通过 MCP 的 `initialize`、`tools/list` 和 `tools/call` 完成握手和调用，服务器支持 `2025-06-18`、`2025-03-26`、`2024-11-05`，明确不支持的版本会拒绝初始化。长时间读取可用 `notifications/cancelled` 取消；stdio 解析保持顺序，同时允许取消通知打断正在等待回环 API 的工具请求。日志只写 stderr，stdout 保持纯 JSON-RPC。

轻量插件项目位于 `H:\work\theia-buct-advisor`。它优先动态转发到本文件对应的 canonical MCP；找不到完整 THEIA 时才使用显式导入的快照 fallback：

```powershell
node H:\work\theia-buct-advisor\scripts\import-snapshot.mjs C:\path\to\snapshot.json
```

fallback 只接受 `theia-campus-data/v1`，输出会标记 `mode: "lite-fallback"`，不声称完成登录或同步。插件的 `SYNC_POLICY.md` 和 `theia-data-flow.lock.json` 是强制同步门禁：修改 schema、数据质量、脱敏、顾问投影或 MCP 工具后，必须更新锁文件并重新跑插件与 THEIA 测试。

修改客户端 MCP 配置后请重启 Codex 或 Claude Code；THEIA 的 API 端口是动态发现的，不要把当前 `8765/8766` 端口写死到客户端配置中。

THEIA 桌面端也可以在“设置 -> 数据与接口 -> Codex 与 Claude Code”点击“一键添加 MCP”。它会优先更新当前 Windows 用户的标准 Codex 配置和 Claude Code 用户配置，只改名为 `theia` 的服务器项，并在改写已有配置前创建同目录备份。未检测到客户端或轻量插件目录时不会写入配置。

规范化校园 Feed 位于 `GET /v1/feed`，使用 `theia-campus-feed/v1` Schema。`GET /v1/snapshot` 提供完整本地状态，但排除凭据与浏览器会话。

只读 API 表面有意保持精简和稳定：

- `GET /v1/health`、`/v1/profile`、`/v1/sync` 和 `/v1/collections`
- `GET /v1/terms`、`/v1/courses`、`/v1/schedule`、`/v1/exams`、`/v1/grades`、`/v1/selected-courses`、`/v1/assignments`、`/v1/workspaces`、`/v1/notices` 和 `/v1/emails`
- `GET /v1/academic-progress`、`/v1/academic-analysis`、`/v1/fitness?year=...`、`/v1/school-schedule?termId=...&keyword=...`、`/v1/venue-catalog`、`/v1/venue-status?...` 和 `/v1/data-catalog`
- `GET /v1/academic-extras/{domain}` 返回单个 JWGLXT 扩展域的表格响应（列定义、完整性、查询统计和记录）；可追加 `?q=关键词&limit=...&since=...`。`/v1/academic-extras` 仍保留为兼容的全域元数据入口。
- 用于互操作导出的 `GET /v1/{collection}.csv` 和 `/v1/calendar.ics`

集合响应包含 `schema`、`collection`、`updatedAt`、`total` 和 `items`。在集合端点或对应 CSV 地址后添加 `?since=<ISO-8601>`，可只接收在该时间点及之后发生变化的记录。如果学业进度快照早于请求时间，`academic-progress?since=...` 会返回 `notModified: true`，且不返回项目。

完整的接口、安全边界和数据结构分别见[《API 与 IPC 参考》](../docs/reference/api-and-ipc.md)、[《数据模型参考》](../docs/reference/data-model.md)和[《本地 API、CLI 与导出》](../docs/ai/12-local-api-cli.md)。
