# THEIA 本地数据接口

THEIA 为本机集成提供只读回环 API。它绝不会暴露学校密码、Cookie、认证页面、学校原始 HTML 或模型 API 密钥。

桌面客户端运行时，可以从 THEIA 数据目录读取 `api-runtime.json`，也可以调用 `theia-client.mjs` 中的 `discoverTheiaApi()`。服务只绑定 `127.0.0.1`。

```js
import { fetchTheiaFeed } from './integration/theia-client.mjs'

const feed = await fetchTheiaFeed()
```

规范化校园 Feed 位于 `GET /v1/feed`，使用 `theia-campus-feed/v1` Schema。`GET /v1/snapshot` 提供完整本地状态，但排除凭据与浏览器会话。

只读 API 表面有意保持精简和稳定：

- `GET /v1/health`、`/v1/profile`、`/v1/sync` 和 `/v1/collections`
- `GET /v1/terms`、`/v1/courses`、`/v1/schedule`、`/v1/exams`、`/v1/grades`、`/v1/selected-courses`、`/v1/assignments`、`/v1/workspaces`、`/v1/notices` 和 `/v1/emails`
- `GET /v1/academic-progress`、`/v1/fitness?year=...`、`/v1/school-schedule?termId=...&keyword=...` 和 `/v1/data-catalog`
- 用于互操作导出的 `GET /v1/{collection}.csv` 和 `/v1/calendar.ics`

集合响应包含 `schema`、`collection`、`updatedAt`、`total` 和 `items`。在集合端点或对应 CSV 地址后添加 `?since=<ISO-8601>`，可只接收在该时间点及之后发生变化的记录。如果学业进度快照早于请求时间，`academic-progress?since=...` 会返回 `notModified: true`，且不返回项目。

完整的接口、安全边界和数据结构分别见[《API 与 IPC 参考》](../docs/reference/api-and-ipc.md)、[《数据模型参考》](../docs/reference/data-model.md)和[《本地 API、CLI 与导出》](../docs/ai/12-local-api-cli.md)。
