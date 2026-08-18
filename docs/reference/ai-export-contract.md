# THEIA AI 全量导出契约

> 导出格式：`theia-ai-context/v1`  
> manifest schema：`theia-ai-export-manifest/v1`  
> 数据文件 schema：`theia-ai-context/v1`  
> 本文是随“导出给 AI”功能一起交付的严格文件契约。它不同于通用 JSON、CSV、ICS 与 `theia-campus-feed/v1`：目标是让经过用户明确授权的 AI 在不接触凭据、Cookie、浏览器会话、原始附件或本机路径的前提下，取得理解该用户学业状态所需的完整、可验证、可解释数据包。

## 1. 目的、授权与非目标

### 1.1 它解决什么问题

用户在桌面设置页点击“导出给 AI”，或在 CLI 明确提供父目录后，会生成一个自包含目录。核心构造器按领域拆分 JSON，并提供供人和模型优先阅读的 `AI_CONTEXT.md` 与 `DATA_DICTIONARY.md`。AI 读完说明文件和 manifest 后，应能知道：

- 用户资料、已发现学期、课程、个人课表、考试、成绩、培养方案和已选课程；
- 当前 / 历史作业、工作包安全元数据、课程与教务通知；
- 已缓存邮件的可导出文本与附件描述；
- 官方校历的结构化内容与解析状态；
- 已缓存体测、全校课表、抢课目标 / 状态和本地资料目录；
- 每份数据的可用性、更新时间、记录数、来源、解析版本、覆盖 / 完整性状态和 SHA-256 摘要；
- 数据仍未知、未同步、读取失败或不可完整断言的地方。

它**不**承诺为 AI 制造学校服务器的实时全量镜像，不替代备份，亦不授予 AI 任何读写学校系统、本机目录或账户的能力。

### 1.2 用户授权边界

这是高敏感导出。用户选择导出目录本身，是授权将该目录的内容交给其选定 AI / 本地工具的动作。THEIA 不会自动上传，也不会自行调用模型服务。导出完成后，用户仍负责确认目标 AI 的数据处理条款、网络位置、保留时长和共享范围。

建议展示层在导出前明确说明至少包含姓名 / 学号、成绩、作业、邮件与体测等个人信息；但应用代码不得通过说明文本暗示 AI 可读取任何未列在包内的本机文件。

### 1.3 明确非目标

- 不是可反向写回 `CampusStore` 的导入格式。
- 不是 browser session、学校原始网页或网络抓包导出。
- 不是课程作业附件、PDF、Word、图片、压缩包或用户生成答案的文件归档。
- 不是导出日志、诊断、模型设置、任意绝对路径或系统账户名的工具。
- 不是实时同步 API；数据时间以 manifest / 文件 provenance 为准。

## 2. 触发方式和生成目录

### 2.1 已实现的调用面

导出的目标调用链是沿用受限的 `theia:export-data`，而不是开放新的写 HTTP API：

```text
Settings 导出入口
  -> bridge.exportData('ai')
  -> preload: ipcRenderer.invoke('theia:export-data', { format: 'ai' })
  -> main process: 用户选择父目录、建立导出目录、写入文件
```

`core/ai-export.mjs` 的 `createAiExportBundle()` 与 `writeAiExport()` 是唯一的包构造和写入实现。它已接入桌面设置页、preload、`TheiaBridge` 类型、Electron 主进程和 CLI；它们共享同一份净化、目录命名和完整性逻辑。浏览器预览中的 bridge 会拒绝文件导出，因为浏览器模式没有用户目录选择能力。

CLI 用法：

```powershell
theia export --format ai --output "D:\\Exports"
```

`--output` 是**父目录**，不是最终数据包目录或单一 JSON 文件；省略它或传入 `-` 会被 CLI 拒绝。桌面 UI 打开目录选择器后也将该目录作为父目录。`writeAiExport()` 必要时创建父目录，并在其中写入新的包目录；不覆盖旧导出。

### 2.2 目录名称

在选定父目录下生成：

```text
THEIA-AI-EXPORT-YYYYMMDD-HHmmss/
```

其中时间戳来自生成时刻，使用文件系统安全的本地格式。若极端情况下名称冲突，实现必须创建不覆盖已有用户目录的唯一同类名称，不能删除、清空或覆盖旧导出。

示例：

```text
D:\Exports\THEIA-AI-EXPORT-20260812-103000\
```

根目录中的所有引用使用相对文件名，不用绝对路径。外部消费者可以复制整个目录、计算摘要并在另一个本机位置读取，无需知道原数据根或 Windows 用户名。

## 3. 目录清单

一个有效的 `theia-ai-context/v1` 导出必须包含以下文件。文件均为 UTF-8 JSON 或 UTF-8 Markdown；换行使用 LF。不会因某集合为空而省略其文件。当前实现固定输出 16 个 JSON 数据集、2 个 Markdown 说明文件和 `manifest.json`，共 19 个文件。

```text
THEIA-AI-EXPORT-YYYYMMDD-HHmmss/
  manifest.json
  AI_CONTEXT.md
  DATA_DICTIONARY.md
  profile.json
  academic.json
  sync.json
  schedule.json
  grades.json
  academic-progress.json
  exams.json
  coursework.json
  notices.json
  mailbox.json
  calendar.json
  fitness.json
  school-schedule.json
  course-selection.json
  local-data-catalog.json
  provenance.json
```

| 文件 | 领域 | 正文级 schema / 类型 | 必需数据 |
| --- | --- | --- | --- |
| `manifest.json` | 包级完整性 | `theia-ai-export-manifest/v1` | 文件清单、摘要、总状态、排除项。 |
| `AI_CONTEXT.md` | AI 阅读入口 | Markdown | 使用顺序、已知限制、当前数据状态、安全行为。 |
| `DATA_DICTIONARY.md` | 字段词典 | Markdown | 共享 envelope、文件 payload、关联关系和空值语义。 |
| `profile.json` | 用户资料 | `theia-ai-context/v1` envelope | profile 或 `null`。 |
| `academic.json` | 学期、课程与已选课程 | envelope | `terms`、`courses`、`selectedCourses`。 |
| `sync.json` | 同步状态 | envelope | 同步时间、run、来源连接 / 错误。 |
| `schedule.json` | 个人课表 | envelope | `ScheduleItem[]`。 |
| `grades.json` | 成绩 | envelope | `{ grades, calculatedGpa, calculatedTrend, schoolReportedGpa }`。 |
| `academic-progress.json` | 培养方案 | envelope | `AcademicProgress \| null`。 |
| `exams.json` | 考试 | envelope | `Exam[]`。 |
| `coursework.json` | 作业与工作包 | envelope | `Assignment[]`、净化后的 workspace 摘要。 |
| `notices.json` | 通知 | envelope | `Notice[]`。 |
| `mailbox.json` | 邮箱 | envelope | 净化后的邮件记录，可含已缓存正文和附件元数据。 |
| `calendar.json` | 官方校历 | envelope | 结构化校历、资产元数据、PDF 分析 / 错误。 |
| `fitness.json` | 体测 | envelope | 体测年份、记录、刷新状态。 |
| `school-schedule.json` | 全校课表缓存 | envelope | 每 term 的本地缓存记录和 `complete`。 |
| `course-selection.json` | 抢课记录 | envelope | 目标、sentinel、已净化历史 / 当前状态。 |
| `local-data-catalog.json` | 本地资料目录 | envelope | 安全、无重复二进制的 catalog 摘要。 |
| `provenance.json` | 来源 / 覆盖图 | envelope | 每领域来源、采集 / 解析 / 完整性说明。 |

`local-data-catalog.json` 与 `fitness.json`、`school-schedule.json`、`calendar.json` 有意存在摘要重叠：前者帮助 AI 看整体来源目录，后者给各领域提供明确、无需解引用的内容。它们必须由同一 snapshot 生成，不能混用不同同步时刻的数据。

## 4. 统一 JSON envelope

除 `manifest.json` 外，16 个数据 JSON 文件使用当前实现的同一顶层 envelope 形状：

```json
{
  "schema": "theia-ai-context/v1",
  "dataset": "grades",
  "generatedAt": "2026-08-12T02:30:00.000Z",
  "updatedAt": "2026-08-12T02:29:58.000Z",
  "recordCount": 42,
  "sources": ["jwglxt"],
  "completeness": "available",
  "data": []
}
```

### 4.1 固定字段

| 字段 | 规则 |
| --- | --- |
| `schema` | 必须精确等于 `theia-ai-context/v1`。 |
| `dataset` | 领域名，例如 `grades`、`academic-progress`。 |
| `generatedAt` | 整包生成时的 ISO UTC 时间；所有 JSON 文件必须相同。 |
| `updatedAt` | 此领域的最新已知时间；不等于导出时刻，可能为 `null`。 |
| `recordCount` | 领域的主要业务记录数；对象型 payload 可含更多元数据。 |
| `sources` | 去重后的来源标签，或经 HTTP(S) origin/path 规范化的来源 URL。 |
| `completeness` | 当前为 `available`、`empty` 或 `partial`；与 manifest `availability` 一起判断数据覆盖。 |
| `data` | 与文件领域对应的对象、数组或 `null`；不因空值改变文件形状。 |

`completeness` 与 manifest `availability` 当前使用下列有限值：

| 值 | 含义 | AI 正确行为 |
| --- | --- | --- |
| `available` | 有可消费的规范化数据或领域元数据。 | 结合 payload、来源和时间回答；不要把聚合对象的 `records` 当成各子数组的总行数。 |
| `empty` | 领域 provenance 完整、`contentEmptyConfirmed=true`，且当前记录数确实为 0。 | 说“最近成功证据确认当前保留快照为空”；若最近尝试失败，仍须说明该失败。不要推断现实世界永久不存在。 |
| `partial` | 覆盖不完整或无法证明完整；也用于缺少 provenance/completeness unknown 的旧快照，无论当前记录数是 0 还是大于 0。 | 在结论中保留范围限定，不把记录存在等同于完整，也不把空集合当作确认空。 |

映射是保守的：缺少领域 provenance 或 `completeness=unknown` -> `partial`；`completeness=partial` -> `partial`；`completeness=complete` 且记录数大于 0 -> `available`；`completeness=complete`、`contentEmptyConfirmed=true` 且记录数为 0 -> `empty`。若 provenance 与 payload 自相矛盾（例如“确认空”但仍有记录），也降级为 `partial`。这里的导出枚举不同于 Advisor 的 `complete|partial|unknown`，消费者不能混用。

当前 envelope 不另设 `reason` 或 `capturedAt` 字段。`recordCount` 是非负整数；`updatedAt` 只能来自该领域 provenance 的 `capturedAt`/`sourceSucceededAt`，未知时为 `null`。同步失败、来源状态和领域可用性须与 `sync.json`、`provenance.json` 和 manifest 的 `availability` 合并解释。

### 4.2 文件级数据形状

| `dataset` | `data` 的严格形状 |
| --- | --- |
| `profile` | `Profile \| null`。 |
| `synchronization` | `{ lastStartedAt, lastCompletedAt, lastRunAt, lastSuccessAt, runId, lastError, sources }`；`lastSuccessAt` 表示最近一次整轮成功，`lastRunAt` 只表示最近尝试结束；错误文字和来源 URL 已净化。 |
| `academic` | `{ terms, courses, selectedCourses }`。 |
| `schedule`、`exams`、`notices` | 对应领域数组。 |
| `academic-progress` | `AcademicProgress \| null`。 |
| `coursework` | `{ assignments: Assignment[], workspaces: AiWorkspace[] }`。 |
| `mailbox` | 面向 AI 的邮件摘要数组，而非原始 `EmailMessage[]`。 |
| `academic-calendar` | `dataCatalog.collections.academicCalendar` 的净化结果。 |
| `fitness` | `{ availableYears, records }`。 |
| `school-schedule` | `schoolSchedule.records` 对象。 |
| `course-selection` | `{ targets, sentinel, history, updatedAt }`。 |
| `local-data-catalog` | `AiDataCatalogSummary`。 |
| `provenance` | `AiProvenance`。 |

基本实体字段、关联关系与空值语义见 [数据模型与持久化参考](data-model.md)。下面只定义为了 AI 安全与文件可移植性而发生的净化转换。

## 5. 安全净化转换

### 5.1 绝对禁止出现的内容

下列内容由当前专用摘要和键名/URL 净化逻辑排除，不能作为可重放的凭据或本机文件载体出现：

- 学校账户密码、教务 API 密码、邮箱密码、IMAP / SMTP 授权码；
- 模型 API key、Bearer token、OAuth token、cookie 值、CSRF token；
- Chromium / Electron session、Local Storage、缓存、webview 数据、浏览器配置；
- 任意绝对本机路径、用户名、home 目录、盘符或环境变量值；
- 原始附件二进制、附件全文、PDF / Office 内容、压缩包内容、课件图片；
- `auth-diagnostics.ndjson`、原始 HTML、URL query 里的敏感参数；
- 未脱敏的工作区 manifest、`task.md`、`answers.json`、模型答案、笔记、论文、提交文件。

这一排除列表优先于“全量”二字。全量意为“所有适合 AI 理解用户状态的**规范化业务领域**”，不意为“所有硬盘字节”。所有字符串字段都会经过统一的 URL query、常见绝对路径、`token=value` 和 Bearer 模式净化；这不是完整的通用 DLP 引擎，因此新增来源仍必须在进入状态前完成字段级净化并加回归测试。

### 5.2 路径和 URL

任何 `CourseWorkspace` 的 `directory`、`manifestPath`、`taskPath`、`answerKeyPath`、`submissionPath`、`notesPath`、`notesPdfPath`、`paperPath`、`paperPdfPath`、`modelAnswerPath`、`modelAnswerPdfPath` 一律删除。导出中只保留如下 workspace 摘要：

```json
{
  "id": "assignment:example",
  "assignmentId": "assignment:example",
  "courseName": "高等数学",
  "title": "作业一",
  "kind": "assignment",
  "dueAt": "2026-08-20T15:00:00.000Z",
  "state": "model-ready",
  "attachmentCount": 1,
  "questionCount": 0,
  "preparedAt": "2026-08-12T02:30:00.000Z",
  "updatedAt": "2026-08-12T02:35:00.000Z",
  "lastError": null,
  "modelName": "example-model",
  "modelProcessedAt": "2026-08-12T02:35:00.000Z",
  "lastTestFill": null,
  "hasAnswerKey": false,
  "hasSubmission": false,
  "hasNotes": true,
  "hasPaper": false,
  "hasModelAnswer": true
}
```

`sourceUrl` 和 URL 形式的 `source` / envelope `sources[]` 只保留 HTTP(S) URL 的 origin + pathname；必须丢弃 fragment、username / password 和全部 query parameter。非 URL 的来源标签（例如 `jwglxt`、`imap`）保持原样，避免意外携带短期 token。例如：

```text
https://jwglxt.buct.edu.cn/jwglxt/cjcx/cjcx_cxDgXscj.html?token=secret
-> https://jwglxt.buct.edu.cn/jwglxt/cjcx/cjcx_cxDgXscj.html
```

若 URL 不能解析为 `http` / `https`，则写为 `null`，不得原样兜底。

### 5.3 邮件和附件

当前实现不会直接导出原始 `EmailMessage`。它保留 `id`、主题、发件人、接收时间、摘要、已缓存的纯文本正文、未读标记、来源和附件元数据；删除 IMAP `uid`、`remoteMarker`、富 HTML 以及附件二进制。若只有缓存 HTML，则会移除标签、脚本、样式、iframe、object、embed 和 SVG 后提取可读文本。它不会为了导出再读取 IMAP、session 或本机附件。邮件正文和附件名仍可能高度敏感，AI 应优先概述而非逐字复述。

### 5.4 配置和日志

`settings`、appearance preset、后台端口、模型 base URL / model 列表、vault 状态、诊断日志、浏览器状态都不属于 AI 数据包。`sync.json` 只保留业务同步状态，`sync.sources.*.url` 去除 username、password、query 和 fragment，`lastError`、来源 `error` 与 `errors[]` 经过安全文本净化后保留摘要。错误净化会处理 URL、常见本机路径和典型 `token=value` 类片段，但不能把任意自由文本当作完整 DLP 引擎。

## 6. `manifest.json`：完整性和内容声明

manifest 的最小形状如下：

```json
{
  "schema": "theia-ai-export-manifest/v1",
  "exportSchema": "theia-ai-context/v1",
  "producer": {
    "name": "THEIA",
    "version": "0.5.0"
  },
  "exportedAt": "2026-08-12T02:30:00.000Z",
  "timeZone": "Asia/Shanghai",
  "files": [
    {
      "path": "grades.json",
      "dataset": "grades",
      "mediaType": "application/json; charset=utf-8",
      "bytes": 12345,
      "sha256": "lowercase-64-hex",
      "recordCount": 42,
      "updatedAt": "2026-08-12T02:29:58.000Z",
      "sources": ["jwglxt"]
    }
  ],
  "layout": "multi-file-json-with-markdown-context",
  "availability": {
    "grades": { "records": 42, "updatedAt": "2026-08-12T02:29:58.000Z", "state": "available" }
  },
  "privacy": {
    "contains": ["personal academic records"],
    "excluded": ["passwords and client authorization passwords"],
    "handling": "Keep this directory local or transfer it only to a model service explicitly chosen by the user."
  },
  "integrity": {
    "algorithm": "SHA-256",
    "instruction": "Verify every manifest.files[].sha256 against the UTF-8 file before using the snapshot."
  }
}
```

### 6.1 Manifest 字段规则

- `schema` 和 `exportSchema` 必须精确匹配本契约。
- `producer.version` 使用实际打包时的应用版本；不得伪装成数据 schema 版本。
- `exportedAt` 必须与每个 envelope 的 `generatedAt` 完全相同。
- `layout` 当前固定为 `multi-file-json-with-markdown-context`。
- `files` 列出 18 个**非 manifest**文件：16 个数据 JSON、`AI_CONTEXT.md` 和 `DATA_DICTIONARY.md`。`manifest.json` 不列入自身，避免无法稳定计算的自引用哈希。`path` 不得含 `/`、`\\` 或 `..`。
- 每个 `sha256` 计算对应文件写入后的 UTF-8 字节；算法只接受小写 64 位十六进制。
- `recordCount` 是该文件代表的主要业务记录数：例如 grades 数量、coursework 的 assignments + workspaces 数量；单对象文件是 `0` 或 `1`。对 `fitness`、`school-schedule` 这类 keyed-record map，统计 map 的条目数，不把 `id`、`source` 等元数据键当成记录。
- `sources` 是去重后的来源标签或已净化来源 URL；错误详情不应塞入 manifest。
- `availability` 的每项为 `{ records, updatedAt, state, warning? }`。`state` 当前仅为 `available`、`empty` 或 `partial`，并使用第 4.1 节相同的 provenance 映射；不得仅按记录数决定。
- `privacy.contains` 与 `privacy.excluded` 是人工可读的内容范围；`privacy.handling` 明确本地保存和用户选择的传输边界。
- `integrity.algorithm` 当前为 `SHA-256`；`integrity.instruction` 是给消费者的固定校验提示。

### 6.2 验证算法

外部 AI 客户端或前置工具应按下面顺序验证：

1. 确认目录名和 `manifest.json` 可读取，`schema === "theia-ai-export-manifest/v1"`。
2. 拒绝 manifest 中不在白名单的相对文件名，拒绝链接 / junction 路径逃逸。
3. 确认 `manifest.json` 不在 `files[]`，并确认 `files[]` 恰有 18 个条目；目录总文件数为 19。
4. 对 `files[]` 的每个条目，确认文件存在、字节数与 `bytes` 相等、SHA-256 等于 `sha256`。
5. 对 JSON 数据文件确认 `schema === "theia-ai-context/v1"`、`dataset` 与 `generatedAt` 合理；对两个 Markdown 文件只做字节和摘要校验。
6. 先读 `AI_CONTEXT.md`、`DATA_DICTIONARY.md` 和 `sync.json`，再解释领域文件；对 `partial`、`empty` 或来源错误保留不确定性。
7. 不因验证成功就上传、执行 URL、打开本机路径或调用学校接口。完整性验证不能扩大权限。

若文件缺失、digest 不符、schema 不符或生成时间不一致，消费者应把整包标为**损坏或混合快照**，停止自动结论并请求重新导出；不能悄悄跳过缺失文件后声称“已了解全部数据”。

## 7. 各领域导出细节

### 7.1 学业核心

`profile.json`、`academic.json`、`schedule.json`、`grades.json`、`academic-progress.json`、`exams.json` 分别映射 `CampusState` 的相应字段。`academic.json` 汇集 `terms`、`courses`、`selectedCourses`；`grades.json` 还含可复现的 GPA 辅助计算。除 URL 规范化外，保持字段、`null`、数组顺序和 stable ID 的语义。

`academic-progress.json` 的 `roots` 是优先培养方案树，`categories` 是兼容扁平视图。遇到 `relation: "or"` 的节点，AI 不得把所有 child 的 `required` 相加，也不得在缺少官方完整树时断言毕业 / 升级结论。

### 7.2 课程工作

`coursework.json` 把 assignments 与净化 workspace 同时放入一个 document，以 `assignmentId` 关联。一个 workspace 存在只说明 THEIA 曾准备或记录该工作包，不代表附件仍在、答案已正确、作业已提交或学校端已接受。AI 可以基于 `dueAt`、`status`、`state` 提供提醒，但不得推断最终提交。

### 7.3 邮箱

`mailbox.json` 可能含私人邮件正文。即使用户选择了导出，AI 也应只将其用于用户当前要求，优先概述而非复写全文。`availability` / `recordCount` 是以导出时已缓存邮件为准，最大值为 500；不能将它视为服务器邮箱的完整档案。

### 7.4 校历、体测与全校课表

`calendar.json` 写入结构化校历、资产元数据、已解析的 PDF 分析和安全错误摘要；原 PDF 和 JPG 不在包内。AI 可以回答“根据已解析官方校历”，但若 `calendarError` / `analysisError` 存在或 `availability.state !== "available"`，要说明可能缺少最新文件。

`fitness.json` 提供每年度结构化记录和 `refreshState`。它是历史体测缓存，使用时必须说明年度。

`school-schedule.json` 包含每个缓存 term 的 course items、`capturedAt`、`parserVersion` 与 `complete`。只有 `complete === true` 才能支持“这个 term 的全量本地排课缓存”之类的表述；否则只能称“已缓存的匹配 / 部分条目”。

这三个文件以及 `local-data-catalog.json` 的 envelope 都读取正式 `sync.domains` provenance。`local-data-catalog` 由 fitness、school-schedule、academic-calendar 派生，完整性取最弱必要子域，水位取全部必要子域中最早的合法水位；任一必要子域缺证据时为 `partial` 且 `updatedAt: null`。它不能固定写成 `available`，也不能用 `dataCatalog.updatedAt` 冒充来源水位。

### 7.5 抢课与资料目录

`course-selection.json` 是从本地 course selection journal 与运行态 snapshot 生成的安全记录：目标、sentinel 配置、当前 / 历史 job 的 ID、状态、次数、最后安全消息和时间。它不含操作 token、浏览器 URL query、完整日志或任何能重放选课请求的字段。

`local-data-catalog.json` 是无二进制、无绝对路径的目录摘要，帮助 AI 知道哪些本地资料已缓存、何时刷新、来自何处。对应详情已经按领域写入另三个 JSON；AI 不应靠该文件反序列化隐藏的 store fragments。

`provenance.json` 包含来源优先级、同步安全摘要、各领域 availability 和解释规则。它是内容解释层，不可与 manifest 的 digest 混淆：manifest 检查文件字节；provenance 解释业务证据。

## 8. `AI_CONTEXT.md` 的最低内容

### 8.1 `AI_CONTEXT.md`

当前生成的 `AI_CONTEXT.md` 使用英文，以便外部模型稳定消费；它表达的语义如下：

1. 这是用户明确导出的本地快照，含个人数据，不能转发或用于训练 / 其他任务；
2. 先验证 `manifest.json`，再读 `sync.json` 和 `provenance.json`；
3. `generatedAt`、`updatedAt`、manifest `availability`、`complete` 的含义；
4. `null`、空数组、来源失败和未同步不代表现实世界中的否定事实；
5. 培养方案 `or` 分支、成绩文本、历史体测和不完整全校课表的解释边界；
6. 绝对禁止尝试读取 / 请求的内容：本机路径、附件、浏览器 session、Cookie、密码、token、原始网页和学校 URL；
7. 不能做自动选课、提交、填答、发送邮件或调用外部接口；只能分析、解释、整理和提出需用户确认的建议。

`DATA_DICTIONARY.md` 是包内的字段词典；仓库级的 [数据模型与持久化参考](data-model.md) 提供完整的 `CampusState` 背景。两个 Markdown 文件都写入 manifest、计算 SHA-256，并被完整性检查覆盖；它们不是未校验的附录。

## 9. AI 的强制行为规范

读到本包的模型或代理应执行以下规则：

1. 先报告数据生成时间和同步健康度，再给结论。数据过期、来源失败或包不完整时，显式说明。
2. 仅根据包内数据回答。没有某项不应尝试上网、查询学校、猜测用户身份、解引用 URL 或读取相邻目录。
3. 尽量用汇总和最小必要个人信息，不在回答中不必要地复述学号、邮箱、完整成绩单、附件名或邮件正文。
4. 任何培养方案、成绩、进度、体测或选课建议必须区分“已知事实”“从字段可做的计算”和“需用户 / 学校确认的建议”。
5. 不作毕业保证、处分 / 健康判断、录取预测或确定性未来成绩预测。
6. 不输出 cookie、密码、token、API key、绝对路径、原始附件、未净化 HTML 或不存在于包内的内容。
7. 不执行外部动作。选课、提交、写入在线测试、邮件发送、模型调用、登录和刷新都需在 THEIA 受控界面内由用户重新授权。

## 10. 与其他导出格式的关系

| 格式 | 使用场景 | 为何不是 AI 包替代品 |
| --- | --- | --- |
| `json` / `/v1/snapshot` | 本地完整业务 state、程序集成 | 单文件，含 settings 和本机路径类元数据，缺少文件级完整性与 AI 指南。 |
| `theia` / `/v1/feed` | 日历、任务、通用外部集成 | 归一化 view，不是所有持久化领域的可解释档案。 |
| `ndjson` | 流式集合处理 | 当前不包含所有领域。 |
| `csv` | 表格 / 统计 | 扁平且列不稳定，不能表达递归培养方案和 provenance。 |
| `ics` | 日历应用 | 仅考试与作业的可解析日期。 |
| `ai` | 用户明确授权给 AI 的完整离线解释包 | 有严格包 / 文件 schema、完整性摘要、字段词典与敏感净化。 |

## 11. 实现与测试要求

每次修改 AI 导出，都必须同时验证：

```powershell
npm test
npm run lint
npm run build
npm run cli -- export --format ai --output .\test-output
```

至少增加 / 保持以下自动测试：

- 生成目录不覆盖已有导出，文件清单完整且名称固定；
- manifest 和每个 JSON envelope 的 schema、时间、一致性、record count、SHA-256 正确；manifest 只列出 18 个非自身文件；测试须从写出的目录重新计算每个 digest；
- 每一个规定文件即使对应集合为空也存在；
- CLI 与 desktop 导出使用相同 schema / 净化函数；
- fixture 中注入 password、cookie、token、API key、absolute path、附件正文、HTML、query secret 后，导出任意文件均不含它们；
- workspace 仅输出安全摘要，不输出本机路径或生成文件内容；
- source URL 去 query / fragment，且不接受非 HTTP(S) 兜底；
- mailbox HTML 不原样出现，附件二进制 / 文本不出现；
- school schedule 的 `complete`、来源失败和空 / 未同步 availability 保持可见；
- legacy 空/非空快照都在缺 provenance 时映射为 `partial`；catalog complete/partial、确认空后刷新失败继续保留空结论，以及 payload/provenance 矛盾时降级均有测试；
- manifest 被篡改、缺失文件或 digest 不同必须被任何消费方判为失败；如提供独立验证器，需覆盖这些损坏输入。

以上是交付质量线，不是“未来可以再补”的建议。对已有包的任何不兼容变更必须升级 schema 版本或同时提供迁移读取路径，不能静默更改同一个 `v1` 的字段含义。
