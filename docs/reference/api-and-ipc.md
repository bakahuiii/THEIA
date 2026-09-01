# THEIA API 与 Electron IPC 参考

> 适用范围：当前 THEIA 桌面客户端、`theia-campus-data/v1`、`theia-campus-feed/v1`。
> 本文依据 `core/local-api.mjs`、`electron/preload.cjs`、`electron/main.mjs` 与 `src/types.ts` 的实现编写；AI 导出段落以同版本 `theia-ai-context/v1` 导出契约为准。

## 1. 先选对接口

THEIA 有两种不同边界，不能互相替代：

| 使用者 | 首选接口 | 目的 | 是否可写 |
| --- | --- | --- | --- |
| 同一台机器上的外部程序、脚本或本地 AI | Loopback HTTP API | 按集合读取或读取完整状态 | 否 |
| Electron renderer | `window.theia` / `window.buct` | 受限桌面能力 | 部分方法会写入或触发网络操作 |

`window.buct` 仅是历史兼容别名，和 `window.theia` 指向同一受限 bridge；新代码必须使用 `window.theia`。不要把 IPC channel 当作对外稳定 API，也不要在 renderer 中导入 Node、读取数据目录或直接请求学校页面。

## 2. Loopback HTTP API

### 2.1 发现运行地址

桌面客户端启动时会启动服务，服务只监听 `127.0.0.1`。首选端口来自 `settings.apiPort`，默认值为 `8765`；若端口已占用，会依次尝试后续九个端口，仍失败时交给操作系统分配空闲端口。实际地址写入数据根目录的 `api-runtime.json`：

```json
{
  "pid": 12345,
  "host": "127.0.0.1",
  "port": 8765,
  "baseUrl": "http://127.0.0.1:8765",
  "token": "pA3v...（每次启动重新生成的 32 字节 base64url）",
  "startedAt": "2026-08-12T02:30:00.000Z"
}
```

数据根默认是 `%APPDATA%\\THEIA`。`THEIA_DATA_ROOT` 可覆盖它；若当前目录不存在而旧 `%APPDATA%\\BUCT` 存在，则读取旧目录以兼容迁移。`api-runtime.json` 仅表示一次正在运行的服务；服务正常关闭且文件仍对应本次实例时会删除它。读取失败、PID 已退出或连接失败时，调用方应将其视为“THEIA 未运行”，而不是自行启动一个公网服务。

最小发现代码可直接复用 [`integration/theia-client.mjs`](../../integration/theia-client.mjs)：

```js
import { fetchTheiaFeed } from '../../integration/theia-client.mjs'

const feed = await fetchTheiaFeed({ timeoutMs: 5_000 })
```

### 2.2 协议、安全和通用规则

- 数据读取端点接受 `GET` 和 `HEAD`；CORS 预检使用 `OPTIONS`；`POST` 仅用于 `/v1/sync` 和 `/v1/agent/chat`。其他写入请求返回 `405` 和 `{"error":"read_only_api"}`，未知路径仍返回 `404`。
- 服务自 0.6.0 起要求**每实例令牌**：每次请求必须携带 `Authorization: Bearer <token>` 或 `?token=<token>`（令牌在 `api-runtime.json` 的 `token` 字段，每次启动重新生成），否则返回 `401` / `unauthorized`。`theia-client.mjs` 的 `discoverTheiaRuntime` / `fetchTheiaFeed` 会自动附加令牌。
- 安全边界是 loopback 绑定 + 令牌。因此**不得**反向代理、端口转发、绑定 `0.0.0.0`、暴露公网，或把返回内容上传到第三方。
- 请求的 `Host` 必须精确为运行时元数据中的 `127.0.0.1:<port>`，否则返回 `421` / `host_not_allowed`。`OPTIONS` 只允许 `theia:`、`http(s)://127.0.0.1` 与 `http(s)://localhost` 的 `Origin`。没有匹配来源时返回 `403` / `origin_not_allowed`。**`null` Origin（任意 `file://` 页面）一律拒绝**；带非白名单 `Origin` 的真实请求（含 `POST /v1/agent/chat`）同样返回 `403`（CSRF 防护）。普通无 `Origin` 的本机脚本请求仍需携带令牌。
- 响应带 `Cache-Control: no-store`、`X-Content-Type-Options: nosniff`；JSON 默认是 `application/json; charset=utf-8`。
- `HEAD` 与等价 `GET` 使用相同状态码和头部，但无 body。不要把 `Content-Length` 为非零误判为有 `HEAD` body。
- 所有时间字段是 ISO-8601 UTC 字符串；数据值可能为 `null`、缺失或空数组。空不等于“学校系统明确没有该项”，也可能代表未同步、无权限或解析失败。
- 服务器当前不实现 `ETag`、`Last-Modified`、分页 token 或 HTTP `304`。调用方可用 `updatedAt`、`capturedAt`、`parserVersion` 与 record ID 自行做缓存。

### 2.3 端点总表

| 请求 | 成功响应 | 说明 |
| --- | --- | --- |
| `GET /v1/health` | `{ ok, schema, updatedAt, counts }` | 存活检查与主要集合计数。 |
| `GET /v1/collections` | `{ schema, updatedAt, collections[] }` | 支持的集合名、端点和总数。 |
| `GET /v1/profile` | `{ schema, updatedAt, item }` | 学生 profile，`item` 可为 `null`。 |
| `GET /v1/sync` | `{ schema, updatedAt, item }` | 同步运行时间、来源状态和最近错误。 |
| `POST /v1/sync` | `theia-sync-response/v1` | 按明确的数据域调用 THEIA 本地同步器；不经过模型或 Advisor。 |
| `GET /v1/overview` | 本地数据概览投影 | 数据域摘要、可用性和当前 snapshot revision。 |
| `GET /v1/domain-summary/:domain` | 数据域摘要 | 返回一个数据域的状态、更新时间和记录数。 |
| `GET /v1/records/:domain` | 数据域记录投影 | 支持 `q`、`termId`、`status`、`scope`、`limit`、`cursor`、`recordType`。 |
| `GET /v1/snapshot` | 完整 `CampusState` | 当前标准化持久化状态，最完整的机器可读读取接口。 |
| `GET /v1/data-output` | 脱敏数据 Feed | 可用重复的 `domain` 参数限制输出域。 |
| `GET /v1/data-output/:domain` | 单个脱敏数据域 | 只允许公开数据域。 |
| `GET /v1/feed`、`/v1/theia` | `theia-campus-feed/v1` | 面向日历 / 任务 / 外部集成的归一化 feed。两个路径等价。 |
| `GET /v1/data-manifest` | 存储摘要 | 分片 manifest 的元数据和 fragment 名称，不提供任意文件读取。 |
| `GET /v1/data-catalog` | `theia-local-data/v1` | 体测、全校课表缓存、校历分析等本地资料目录。 |
| `GET /v1/academic-plan-document` | `theia-academic-plan-document-response/v1` | 当前专业匹配的培养方案文档解析结果。 |
| `GET /v1/academic-extras` | 教务扩展数据摘要 | 返回扩展域及附件摘要。 |
| `GET /v1/academic-extras/:domain` | `theia-jwglxt-extra-table/v1` | 单个教务扩展域的列、记录、完整性和查询统计。 |
| `GET /v1/academic-calendar` | 资源服务快照 | 官方校历资产元数据、结构化校历与 PDF 分析；`root` 是本机路径信息。 |
| `GET /v1/academic-calendar/calendar` | JPEG | 当前官方校历图片；缺失时 `404` / `academic_calendar_asset_missing`。 |
| `GET /v1/academic-calendar/teaching-schedule` | PDF | 当前教学进程表 PDF。 |
| `GET /v1/academic-calendar/weekly-calendar` | PDF | 当前校历周历 PDF。 |
| `GET /v1/fitness?year=YYYY-YYYY_N` | `{ schema, updatedAt, summary, item }` | 仅读本地体测缓存；无相应缓存时 `item: null`。 |
| `GET /v1/school-schedule?...` | `{ schema, updatedAt, summary, item }` | 仅读本地全校排课缓存，详见下文。 |
| `GET /v1/venue-catalog` | `{ schema, updatedAt, item }` | 仅读本地 MOTION 公开校区、项目和场馆目录。 |
| `GET /v1/venue-status?detailUrl=...&date=...&venue=...` | `{ schema, updatedAt, summary, item }` | 仅读本地 MOTION 状态缓存；没有匹配的日期/场馆组时 `item: null`。 |
| `GET /v1/venue-statuses?activity=...&date=...` | `{ schema, updatedAt, summary, item }` | 实时读取 MOTION 场馆状态；每次请求都重新拉取公开页面，失败时回退缓存。 |
| `GET /v1/motion-table-image?activity=...&date=...&title=...` | `image/png` | 场馆状态表图片；每次实时拉取并渲染，失败用缓存。 |
| `GET /v1/free-classroom-image?periods=...&weekdays=...&weeks=...&termId=...&title=...` | `image/png` | 空闲教室图片；有缓存则用缓存，无缓存才实时查询教务系统。 |
| `GET /v1/table-image?domain=...&title=...&limit=...` | `image/png` | 教务资料表格图片（如 `free-classroom`）。 |
| `GET /v1/academic-progress` | `{ schema, updatedAt, notModified, item }` | 培养方案 / 学分进度树。 |
| `GET /v1/academic-analysis` | `theia-academic-analysis-response/v1` | 从当前快照计算的学业分析和 snapshot revision。 |
| `GET /v1/calendar.ics` | `text/calendar` | 考试和作业截止日的 ICS。 |
| `GET /v1/{collection}` | 集合包装对象 | 支持的 `collection` 见 2.4。 |
| `GET /v1/{collection}.csv` | `text/csv` | 当前集合的扁平 CSV 导出。 |
| `POST /v1/agent/chat` | `theia-agent-chat/v1` | 向已运行的本地顾问发送问题；不执行学校侧写入。 |

未知路径返回 `404` 与 `{"error":"not_found"}`。错误 body 仅用于分支判断，不应将其解析为完整诊断；认证、网络和解析细节在 `sync` 与本地安全诊断中出现。

#### 直接同步

`POST /v1/sync` 是课程资料、作业和测试的确定性同步入口。它只能接收明确的 `domains` 数组，当前 THEOL 相关域包括 `theol-courses`、`theol-course-details`、`theol-notices` 和 `assignments`；作业域会按课程串行扫描列表、抓到一门先提交一门，并保留截止时间过滤。该入口不会自动归档每项任务的详情和附件；本地工作包由用户在具体任务上明确触发。该入口直接进入 THEIA 主进程的同步编排器，不创建顾问线程、不调用模型接口，也不控制浏览器或桌面窗口。

```json
{
  "domains": ["theol-course-details", "assignments"]
}
```

缺少 `domains` 返回 `400` / `domains_required`；域名格式错误返回 `400` / `domains_invalid`；同步器未就绪返回 `503` / `sync_unavailable`。外部工具需要抓取课程资料时必须使用此入口，不应把抓取问题发送到 `/v1/agent/chat`。

### 2.4 集合端点

以下路径可读取集合：

```text
/v1/terms
/v1/courses
/v1/schedule
/v1/exams
/v1/grades
/v1/selected-courses       # 推荐拼写
/v1/selectedCourses        # 已实现兼容别名
/v1/assignments
/v1/workspaces
/v1/notices
/v1/emails
```

成功响应的固定外层结构如下。`total` 是**未过滤前**的集合总数，`items.length` 才是本次返回数量：

```json
{
  "schema": "theia-campus-data/v1",
  "collection": "grades",
  "updatedAt": "2026-08-12T02:30:00.000Z",
  "total": 42,
  "items": [
    {
      "id": "grade:example",
      "termId": "2025-3",
      "courseName": "高等数学",
      "score": "92",
      "point": 4.0
    }
  ]
}
```

可加 `?since=<ISO-8601>`。当前实现依次读取每条记录的 `capturedAt`、`updatedAt`、`publishedAt`、`startAt`，只返回其时间不早于阈值的记录；无法解析的 `since` 被忽略。它是便捷筛选，不是严格变更日志：一些历史记录没有上述字段，故增量消费者仍应以完整快照、稳定 ID 和自己的同步水位做最终判断。CSV 端点使用同一筛选规则。`academic-extras/:domain` 还支持 `q` 和 `limit`。

### 2.5 专用读取语义

#### 学业进度

`/v1/academic-progress?since=<ISO>` 与普通集合不同：若 `academicProgress.capturedAt`（无此字段时使用 state 的 `updatedAt`）早于阈值，会返回 HTTP 200：

```json
{
  "schema": "theia-campus-data/v1",
  "updatedAt": "2026-08-12T02:30:00.000Z",
  "notModified": true,
  "item": null
}
```

它不是 HTTP 缓存语义，也不表示不存在进度。应保留上一份已验证的进度树。

#### 全校课表缓存

`/v1/school-schedule` 可接受 `termId`、`keyword`、`teacher`、`department`、`category`、`nature`、`format`、`affiliation`。其中 `termId` 需要形如 `2025-3`、`2025-12` 或 `2025-16`。响应中的 `summary` 描述所有本地缓存记录，`item` 是与请求匹配的一个本地 term 记录或 `null`。

该端点绝不因一次读取而重新抓取学校系统，也不恢复服务端分页。缓存以“一个学期的完整本地集合”为单位；`item.items` 是在本地对完整 term 集合筛选后的结果。`item.complete === true` 仅能由完整爬取流程断言；`false` 或缺失时，AI 必须声明数据可能不完整，不能据此说“没有这门课”。

#### MOTION 场馆缓存

`/v1/venue-catalog` 返回 `dataCatalog.collections.venueReservations` 的目录投影。`/v1/venue-status` 使用 `detailUrl`、`date` 和 `venue` 对最近成功状态做精确键控；它不会因为 API 查询而重新请求学校页面。

`/v1/venue-statuses` 与 `/v1/motion-table-image` 则**每次请求都实时拉取**公开页面（场馆状态变化最快，不以缓存代替实时），失败时才回退缓存。MOTION 适配器只使用匿名 `GET` 和白名单页面，不读取 Cookie，不提交预约表单；完整边界与查询规则见 [MOTION 场馆状态](../guides/MOTION_VENUE_STATUS.md)。

#### 空闲教室图片

`/v1/free-classroom-image` 把空闲教室渲染为 `image/png`，支持 `periods`（如 `3,4`，对应节次位掩码）、`weekdays`、`weeks`、`termId` 和 `title`。教室每天基本不变，因此**有本地缓存时直接使用缓存**，没有缓存才实时查询教务系统。图片内按教学楼分组，阶梯教室（教室名含“阶”）排在普通教室之前，组内按教室名升序；底部标注数据读取时间。

#### Agent 对话

`POST /v1/agent/chat` 只用于已运行的本地顾问对话，不写入学校系统。课程资料、作业和测试的抓取必须使用上面的 `POST /v1/sync`，不要通过顾问对话转发。请求必须使用 JSON body：

```json
{
  "message": "我本周有哪些截止事项？",
  "threadId": "可选的已有线程 ID"
}
```

请求 body 最大 16 KiB；`message` 会做 NFC 规范化、去除首尾空白并限制为 4,000 个字符，`threadId` 最多 128 个字符。缺少问题返回 `400` / `question_required`；顾问未就绪返回 `503` / `agent_unavailable`；线程忙返回 `409` / `thread-busy` 或 `runtime-busy`。成功响应包含 `schema`、`threadId`、`answer` 和 `snapshotRevision`。它不会把全量快照自动放入初始请求，顾问仍按自己的受限工具边界按需读取数据。

#### CSV 与 ICS

CSV 的列来自当前项目的对象键并排除 `raw`，因此列集会随记录字段变化，不能当作固定 schema。嵌套值会按 JavaScript 字符串化，而不是展开为关系表。需要严格字段、关联关系或嵌套培养方案时，请用 JSON API。

ICS 只包含可解析日期的考试和作业；缺少日期的数据被省略。它不等价于完整课表、学业进度或全量导出。

### 2.6 Feed 与 snapshot 的取舍

| 需求 | 使用 | 原因 |
| --- | --- | --- |
| “现在有哪些截止事项、考试和日程” | `/v1/feed` | 已整理 `events` 与 `tasks`。 |
| “AI 必须了解所有持久化用户数据” | `/v1/snapshot` 或 AI 导出包 | snapshot 有 state 全部集合；AI 包有文件级说明、摘要和完整性信息。 |
| “只更新成绩” | `/v1/grades` | 小体积、外层有集合和更新时间。 |
| “校历 PDF / 原图” | 相应 `/v1/academic-calendar/*` | 二进制资产不在普通 JSON feed 中。 |
| “离线使用” | 桌面设置中的导出功能 | Loopback 服务只在进程存活时可用；AI 导出包的文件契约见专门文档。 |

`theia-campus-feed/v1` 不是 `CampusState` 的无损镜像。它将可带日期的课表、考试、作业写成 `events`，将作业写成 `tasks`，并将学业数据置于 `academic`，本地资料和邮件置于 `localData`。`source.account` 是对学号计算的稳定 ID，而非原学号的替代事实来源；profile 仍可能有原始 `studentId`。其 JSON Schema 位于 [`integration/theia-campus-feed-v1.schema.json`](../../integration/theia-campus-feed-v1.schema.json)。

## 3. Electron bridge 与 IPC

### 3.1 调用链和边界

```text
React view / hook
  -> src/bridge.ts (类型化 web fallback)
  -> window.theia (preload contextBridge)
  -> ipcRenderer.invoke / send
  -> electron/main.mjs ipcMain handler
  -> core service / CampusStore / Electron capability
```

Electron 窗口使用 `contextIsolation: true`、`nodeIntegration: false` 和 `sandbox: true`。preload 只显式暴露以下白名单方法，不暴露通用 filesystem、shell、Electron session、cookie 或任意 URL loader。所有 `theia:*` handler 都经统一包装校验：调用者必须是当前主窗口的 main frame、URL 必须精确等于当前 renderer entry，channel 必须注册 runtime schema，参数还受序列化字节、嵌套深度、数组项、对象键与字符串长度上限约束。主进程是唯一可持有 vault、文件选择器、认证 session 和学校网络访问的位置。

所有 `invoke` 方法均返回 Promise。Electron handler 失败时 Promise reject，renderer 应展示无敏感细节的错误，并在需要时重新读取 snapshot；不得把异常对象、凭据输入值或邮件正文拼到 telemetry / 日志中。

浏览器预览中 `src/bridge.ts` 提供受限 fallback：可读操作返回 demo 或空状态，只有外观的本地临时操作可用；认证、凭据、文件、模型、学校网络和导出会报“仅桌面客户端可用”。不能把 web fallback 的成功空结果误当成桌面功能已执行。

### 3.2 Bridge 方法

下表的“方法名”是 renderer 可调用的 `window.theia.<method>`；括号中是对应 IPC channel。参数和返回类型以 [`src/types.ts`](../../src/types.ts) 的 `TheiaBridge` 为准。

| 分组 | 方法 | 主要行为 |
| --- | --- | --- |
| 状态与认证 | `getSnapshot` (`theia:get-snapshot`), `getActivityLog`, `getAuthStatus`, `login`, `logout`, `syncNow`, `retrySyncDomain(domain)` (`theia:sync-domain`) | 读取标准化状态、打开统一认证、清会话、启动双源同步或重新获取一个固定数据域。 |
| 顾问底座 | `getAdvisorOverview` (`theia:advisor:get-overview`) | 无参数；从一次原子 `snapshotWithRevision()` 生成 `theia-advisor-overview/v1`。不联网、不读 session、不写 state、不调用模型。 |
| 凭据 | `getCredentialStatus`, `saveCredentials`, `clearCredentials`, `getAcademicApiCredentialStatus`, `saveAcademicApiCredentials`, `clearAcademicApiCredentials`, `getMailCredentialStatus`, `saveMailCredentials`, `clearMailCredentials` | 状态绝不返回明文 secret；保存仅由 Electron vault 完成。 |
| 邮箱 | `refreshMailbox`, `openMailbox`, `readMailboxMessage(id, options)`, `downloadMailboxAttachment(id, index)` | 邮件正文按需读；附件通过用户选定保存路径落盘。 |
| 抢课 | `getCourseSelection`, `discoverCourseSelection`, `getCourseSelectionCandidates`, `searchSchoolSchedule`, `getCachedSchoolSchedule`, `saveCourseSelectionTarget`, `removeCourseSelectionTarget`, `setCourseSelectionSentinel`, `startCourseSelection`, `stopCourseSelection` | 需要明确目标；最终学校表单行为有独立约束。 |
| 校历与体测 | `getAcademicCalendarAssets`, `refreshAcademicCalendarAssets({force})`, `openSource(url)`, `getFitnessScore(year, {refresh})`, `openSchedulePdf` | 受控本地资产、官方来源页或用户选定输出。 |
| 作业工作区 | `prepareCourseWork`, `openCourseWork`, `importCourseWorkFile`, `openSubmission`, `applyTestAnswers` | 只能引用由服务管理的 assignment / workspace；最终提交仍由用户完成。 |
| 模型 | `getModelStatus`, `saveModelConfig`, `clearModelApiKey`, `validateModelConnection`, `discoverModels`, `processCourseWorkWithModel`, `renderAnswerPdf`, `openAnswerPdf`, `summarizeNotices`, `generateNotes`, `generatePaper`, `renderMdFile` | API key 仅进入 `ModelVault`；模型调用在主进程。 |
| 导出与设置 | `exportData(format, collection)`, `getApiStatus`, `updateSettings(settings)` | 导出必须走文件选择器；设置只接受主进程白名单字段。 |
| 窗口与外观 | `windowMinimize`, `windowMaximize`, `windowClose`, `windowIsMaximized`, `zoomGet`, `zoomSet`, `setAppearanceMode`, `chooseAppBackground`, `getAppearancePresets`, `saveAppearancePresets` | 窗口控制和受控背景 / 预设存储。 |

`exportData` 支持 `json`、`theia`、`ics`、`csv` 和 `ai`。AI 格式使用目录选择对话框，并返回 `{ canceled, filePath?, files? }`；其他格式使用单文件保存对话框。具体输入、目录和排除项见 [AI 全量导出契约](ai-export-contract.md)。

`retrySyncDomain(domain)` 不是任意网络请求入口。`domain` 必须是 `SyncRetryDomain` 的固定枚举值；renderer 不能传 URL、路径、HTTP 方法或请求参数。对于教务系统与北化在线THEOL域，主进程把该枚举映射为一个固定来源和一个固定数据域；作业、邮箱、校历、体测与全校课表使用各自已有的受控刷新流程。单项重取只更新目标数据及其 provenance：不得清空或重写其他数据域，不得把其他域标记为本轮未开始，也不得改写最近一次主同步的 `runId`、全局成功时间或全局错误。目标域失败时继续保留其可用旧数据，并在目标域状态中记录本次失败。北化在线THEOL的所有单项请求仍进入同一个严格串行队列；教务系统与北化在线THEOL彼此可以并行。

`AdvisorOverview` 的一个实例由 `{snapshotRevision,evaluatedAt,timeZone,rulesVersion}` 共同标识，`dataQuality` 的四项必须与外层一致，所有 claims/risks/urgentItems 的 `rulesVersion` 也必须一致。renderer 收到新实例时必须整体替换；claim ID 可跨评估时间稳定，但其动态 `value`/`displayText` 不能按 ID merge。当前 loopback API 没有 advisor endpoint；主进程内 advisor 也不得通过未认证的 `/v1/snapshot` 取数。

### 3.3 主进程推送事件

| Renderer 订阅 | IPC event | Payload | 何时发生 |
| --- | --- | --- | --- |
| `onSnapshot(callback)` | `theia:snapshot` | 完整 `CampusState` | Store 有持久化变更后。 |
| `onSyncProgress(callback)` | `theia:sync-progress` | `{ stage, status, label?, error? }` | 登录、JWGLXT / THEOL 同步等进度变化。 |
| `onAuthStatus(callback)` | `theia:auth-status` | `AuthStatus` | 认证状态刷新、登出后。 |
| `onCourseSelection(callback)` | `theia:course-selection` | `CourseSelectionSnapshot` | 目标、sentinel 或任务状态更新。 |
| `onNewMail(callback)` | `theia:new-mail` | `EmailMessage` | 初始快照之后有新邮件。 |
| `onAppearanceMode(callback)` | `theia:appearance:mode` | `'light' | 'dark' | 'system'` | renderer 请求外观模式切换时。 |

订阅函数都返回取消函数。组件卸载时必须调用它，避免重复监听和旧闭包更新 UI。

### 3.4 关键输入约束

这些不是建议，而是调用方必须尊重的已实现边界：

- `updateSettings` 只接受已列入 `CampusState.settings` 的有限字段；端口会夹在 `1024..65535`，同步周期夹在 `5..1440` 分钟，邮件轮询周期夹在 `1..60` 分钟。
- `retrySyncDomain` 只接受 `SyncRetryDomain` 固定枚举；IPC runtime schema 会拒绝 URL、本机路径、空值和未知域。
- `saveModelConfig` 仅允许 HTTP / HTTPS base URL，URL 和 model 名有长度上限；key 不回写到 settings。
- `importCourseWorkFile` 的 `kind` 只允许 `answer` 或 `answer-key`；在线测试填答前会检查 assignment 类型。
- `renderMdFile` 只允许 `modelAnswerPath`、`notesPath`、`paperPath` 三个文件键，防止 renderer 请求任意文件。
- `openSource`、附件下载、背景图和作业文件均由主进程的受控检查与 file dialog 执行，不能将任意本机路径或任意外站 URL 当作可信输入。

## 4. AI / 集成消费的最低安全规则

1. 先读取 `/v1/health` 和 `/v1/sync`，再决定数据是否足以回答；优先用 `lastSuccessAt` 判断数据最后成功更新的时间，用 `lastRunAt` 判断最近尝试。没有成功时间、来源未连接或 `lastError` 非空时必须说明不确定性。
2. 将 `sourceUrl`、`capturedAt`、`parserVersion`、`complete` 和 `refreshState` 视为数据事实的一部分，而不是可丢弃的展示字段。
3. 只读取 API 暴露的投影，或通过桌面导出入口取得用户明确选择的 AI 数据包；绝不读取 `session/`、vault、`auth-diagnostics.ndjson`、浏览器缓存、原始网页或工作区附件来“补全”数据。
4. 不因为某集合为空就断言用户没有对应记录；先区分“未同步”“来源失败”“缓存为空”和“明确的空结果”。
5. 任何会影响学校系统的动作，包括重新认证、刷新、抢课、填答、打开提交页，必须通过受限 bridge 且在用户明确授权范围内进行；HTTP API 除调用本地顾问对话外不执行写入。
