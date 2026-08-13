# THEIA API 与 Electron IPC 参考

> 适用版本：`theia-campus-data/v1`、`theia-campus-feed/v1`。  
> 本文依据 `core/local-api.mjs`、`cli/theia-cli.mjs`、`electron/preload.cjs`、`electron/main.mjs` 与 `src/types.ts` 的实现编写；AI 导出段落以同版本 `theia-ai-context/v1` 导出契约为准。

## 1. 先选对接口

THEIA 有三种不同边界，不能互相替代：

| 使用者 | 首选接口 | 目的 | 是否可写 |
| --- | --- | --- | --- |
| 同一台机器上的外部程序、脚本或本地 AI | Loopback HTTP API | 按集合读取或读取完整状态 | 否 |
| 命令行、备份脚本 | `theia` CLI | 离线读取、导出、工作包导入 | 仅 `work import` 会写入受控工作包 |
| Electron renderer | `window.theia` / `window.buct` | 受限桌面能力 | 部分方法会写入或触发网络操作 |

`window.buct` 仅是历史兼容别名，和 `window.theia` 指向同一受限 bridge；新代码必须使用 `window.theia`。不要把 IPC channel 当作对外稳定 API，也不要在 renderer 中导入 Node、读取数据目录或直接请求学校页面。

## 2. Loopback HTTP API

### 2.1 发现运行地址

桌面客户端启动时，或运行 `theia serve` 时，服务只监听 `127.0.0.1`。首选端口来自 `settings.apiPort`，默认值为 `8765`；若端口已占用，依次尝试首选端口加 `1` 到加 `9`。实际地址写入数据根目录的 `api-runtime.json`：

```json
{
  "pid": 12345,
  "host": "127.0.0.1",
  "port": 8765,
  "baseUrl": "http://127.0.0.1:8765",
  "startedAt": "2026-08-12T02:30:00.000Z"
}
```

数据根默认是 `%APPDATA%\\THEIA`。`THEIA_DATA_ROOT` 可覆盖它；若当前目录不存在而旧 `%APPDATA%\\BUCT` 存在，则读取旧目录以兼容迁移。`api-runtime.json` 仅表示一次正在运行的服务，服务正常关闭时会删除它。读取失败、PID 已退出或连接失败时，调用方应将其视为“THEIA 未运行”，而不是自行启动一个公网服务。

最小发现代码可直接复用 [`integration/theia-client.mjs`](../../integration/theia-client.mjs)：

```js
import { fetchTheiaFeed } from './integration/theia-client.mjs'

const feed = await fetchTheiaFeed({ timeoutMs: 5_000 })
```

### 2.2 协议、安全和通用规则

- 仅接受 `GET`、`HEAD` 和受限来源的 CORS 预检 `OPTIONS`。其他方法返回 `405` 和 `{"error":"read_only_api"}`。
- 服务没有 token，也没有远程认证；安全边界是 loopback 绑定。因此**不得**反向代理、端口转发、绑定 `0.0.0.0`、暴露公网，或把返回内容上传到第三方。
- `OPTIONS` 只允许 `theia:`、`http(s)://127.0.0.1` 与 `http(s)://localhost` 的 `Origin`。没有匹配来源时返回 `403` / `origin_not_allowed`。普通无 `Origin` 的本机脚本请求仍可读取数据。
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
| `GET /v1/snapshot` | 完整 `CampusState` | 当前标准化持久化状态，最完整的机器可读读取接口。 |
| `GET /v1/feed`、`/v1/theia` | `theia-campus-feed/v1` | 面向日历 / 任务 / 外部集成的归一化 feed。两个路径等价。 |
| `GET /v1/data-manifest` | 存储摘要 | 分片 manifest 的元数据和 fragment 名称，不提供任意文件读取。 |
| `GET /v1/data-catalog` | `theia-local-data/v1` | 体测、全校课表缓存、校历分析等本地资料目录。 |
| `GET /v1/academic-calendar` | 资源服务快照 | 官方校历资产元数据、结构化校历与 PDF 分析；`root` 是本机路径信息。 |
| `GET /v1/academic-calendar/calendar` | JPEG | 当前官方校历图片；缺失时 `404` / `academic_calendar_asset_missing`。 |
| `GET /v1/academic-calendar/teaching-schedule` | PDF | 当前教学进程表 PDF。 |
| `GET /v1/academic-calendar/weekly-calendar` | PDF | 当前校历周历 PDF。 |
| `GET /v1/fitness?year=YYYY-YYYY_N` | `{ schema, updatedAt, summary, item }` | 仅读本地体测缓存；无相应缓存时 `item: null`。 |
| `GET /v1/school-schedule?...` | `{ schema, updatedAt, summary, item }` | 仅读本地全校排课缓存，详见下文。 |
| `GET /v1/academic-progress` | `{ schema, updatedAt, notModified, item }` | 培养方案 / 学分进度树。 |
| `GET /v1/calendar.ics` | `text/calendar` | 考试和作业截止日的 ICS。 |
| `GET /v1/{collection}` | 集合包装对象 | 支持的 `collection` 见 2.4。 |
| `GET /v1/{collection}.csv` | `text/csv` | 当前集合的扁平 CSV 导出。 |

未知路径返回 `404` 与 `{"error":"not_found"}`。错误 body 仅用于分支判断，不应将其解析为完整诊断；认证、网络和解析细节在 `sync` 与本地安全诊断中出现。

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

可加 `?since=<ISO-8601>`。当前实现依次读取每条记录的 `capturedAt`、`updatedAt`、`publishedAt`、`startAt`，只返回其时间不早于阈值的记录；无法解析的 `since` 被忽略。它是便捷筛选，不是严格变更日志：一些历史记录没有上述字段，故增量消费者仍应以完整快照、稳定 ID 和自己的同步水位做最终判断。CSV 端点使用同一筛选规则。

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
| “离线使用” | CLI JSON / AI 导出包 | Loopback 服务只在进程存活时可用。 |

`theia-campus-feed/v1` 不是 `CampusState` 的无损镜像。它将可带日期的课表、考试、作业写成 `events`，将作业写成 `tasks`，并将学业数据置于 `academic`，本地资料和邮件置于 `localData`。`source.account` 是对学号计算的稳定 ID，而非原学号的替代事实来源；profile 仍可能有原始 `studentId`。其 JSON Schema 位于 [`integration/theia-campus-feed-v1.schema.json`](../../integration/theia-campus-feed-v1.schema.json)。

## 3. CLI 参考

CLI 与桌面端读同一个 `CampusStore`，数据根发现规则与 2.1 相同。它不会另建解析器或直接手写 `data/` 分片。

```text
theia status [--json]
theia export --format json|ndjson|theia|ics|csv [--collection grades] [--output FILE]
theia export --format ai --output DIRECTORY
theia work list
theia work show <assignment-id>
theia work import <assignment-id> --file FILE [--kind answer|answer-key]
theia serve [--port 8765]
theia api
theia doctor
```

| 命令 | 输出 / 行为 | 约束 |
| --- | --- | --- |
| `status` | 根目录、存储摘要、schema、最后同步、集合计数与来源状态 | `--json` 只是取消格式化，不改变 schema。 |
| `export --format json` | 完整 `CampusState` | 与 `/v1/snapshot` 同类数据，不含 vault、cookie 与 session。 |
| `export --format ndjson` | 每行 `{ schema, collection, item }` | 当前只写 terms、courses、schedule、exams、grades、assignments、workspaces、notices；不等于全状态。 |
| `export --format theia` | `theia-campus-feed/v1` | 与 `/v1/feed` 同一转换函数。 |
| `export --format ics` | ICS 文本 | 仅考试、作业且仅可解析日期。 |
| `export --format csv` | 选定集合 CSV | 默认 `grades`；列不固定。 |
| `export --format ai` | 用户明确授权的 AI 上下文目录包 | `--output` 必须是父目录；详见 3.1。 |
| `work list` | `theia-course-work-list/v1` | 只列本地 assignment 与 workspace 元数据。 |
| `work show` | workspace 与可读取的 manifest | 需要已在桌面端准备工作包。 |
| `work import` | 把用户明确指定的文件导入受控工作包 | `kind` 只允许 `answer` 或 `answer-key`。 |
| `serve` | 启动 loopback API，前台保持运行 | 不会对公网暴露。 |
| `api` | 当前 `api-runtime.json`，或 `{ running:false, dataRoot }` | 不探测远程服务。 |
| `doctor` | `{ ok, problems, counts }` | 发现问题时进程退出码为 `1`。 |

除 AI 导出外，`--output -` 或省略 `--output` 时写入标准输出；指定文件时 CLI 会创建其父目录。AI 导出要求一个实际父目录，省略 `--output` 或传入 `-` 会报错，成功时 stdout 为 `{ ok, schema, directory, files, exportedAt }` JSON。对于包含个人数据的文件，调用方必须选择用户已授权的本机目录，不能默认发送到日志、共享盘或云同步目录。

### 3.1 AI 全量导出

AI 导出已经以 `theia-ai-context/v1` 多文件目录包接入 CLI 与 desktop：

```powershell
theia export --format ai --output "D:\\Exports"
```

其中 `--output` 是用户选择的父目录。CLI 会在其中生成时间戳命名的 `THEIA-AI-EXPORT-YYYYMMDD-HHmmss/`，不会把 AI 包伪装成单个 JSON 文件或覆盖现有包。桌面端的“导出给 AI”按钮同样先打开目录选择器，再由主进程写入包。完整 schema、文件清单、完整性检查和敏感字段排除见 [AI 全量导出契约](ai-export-contract.md)。

## 4. Electron bridge 与 IPC

### 4.1 调用链和边界

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

### 4.2 Bridge 方法

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

### 4.3 主进程推送事件

| Renderer 订阅 | IPC event | Payload | 何时发生 |
| --- | --- | --- | --- |
| `onSnapshot(callback)` | `theia:snapshot` | 完整 `CampusState` | Store 有持久化变更后。 |
| `onSyncProgress(callback)` | `theia:sync-progress` | `{ stage, status, label?, error? }` | 登录、JWGLXT / THEOL 同步等进度变化。 |
| `onAuthStatus(callback)` | `theia:auth-status` | `AuthStatus` | 认证状态刷新、登出后。 |
| `onCourseSelection(callback)` | `theia:course-selection` | `CourseSelectionSnapshot` | 目标、sentinel 或任务状态更新。 |
| `onNewMail(callback)` | `theia:new-mail` | `EmailMessage` | 初始快照之后有新邮件。 |
| `onAppearanceMode(callback)` | `theia:appearance:mode` | `'light' | 'dark' | 'system'` | renderer 请求外观模式切换时。 |

订阅函数都返回取消函数。组件卸载时必须调用它，避免重复监听和旧闭包更新 UI。

### 4.4 关键输入约束

这些不是建议，而是调用方必须尊重的已实现边界：

- `updateSettings` 只接受已列入 `CampusState.settings` 的有限字段；端口会夹在 `1024..65535`，同步周期夹在 `5..1440` 分钟，邮件轮询周期夹在 `1..60` 分钟。
- `retrySyncDomain` 只接受 `SyncRetryDomain` 固定枚举；IPC runtime schema 会拒绝 URL、本机路径、空值和未知域。
- `saveModelConfig` 仅允许 HTTP / HTTPS base URL，URL 和 model 名有长度上限；key 不回写到 settings。
- `importCourseWorkFile` 的 `kind` 只允许 `answer` 或 `answer-key`；在线测试填答前会检查 assignment 类型。
- `renderMdFile` 只允许 `modelAnswerPath`、`notesPath`、`paperPath` 三个文件键，防止 renderer 请求任意文件。
- `openSource`、附件下载、背景图和作业文件均由主进程的受控检查与 file dialog 执行，不能将任意本机路径或任意外站 URL 当作可信输入。

## 5. AI / 集成消费的最低安全规则

1. 先读取 `/v1/health` 和 `/v1/sync`，再决定数据是否足以回答；优先用 `lastSuccessAt` 判断数据最后成功更新的时间，用 `lastRunAt` 判断最近尝试。没有成功时间、来源未连接或 `lastError` 非空时必须说明不确定性。
2. 将 `sourceUrl`、`capturedAt`、`parserVersion`、`complete` 和 `refreshState` 视为数据事实的一部分，而不是可丢弃的展示字段。
3. 只读公开的 snapshot / feed / AI 导出包；绝不读取 `session/`、vault、`auth-diagnostics.ndjson`、浏览器缓存、原始网页或工作区附件来“补全”数据。
4. 不因为某集合为空就断言用户没有对应记录；先区分“未同步”“来源失败”“缓存为空”和“明确的空结果”。
5. 任何会影响学校系统的动作，包括重新认证、刷新、抢课、填答、打开提交页，必须通过受限 bridge 且在用户明确授权范围内进行；HTTP API 始终只读。
