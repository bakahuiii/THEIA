# THEIA 数据模型与持久化参考

> 适用 schema：`theia-campus-data/v1`、`theia-sharded-store/v1`、`theia-state-fragment/v1`、`theia-local-data/v1`。  
> 本文描述当前 `core/schema.mjs`、`core/store.mjs`、`core/data-catalog.mjs` 和 `src/types.ts` 的实现，不把学校原始页面、浏览器 session 或 vault 当作业务数据模型的一部分。

## 1. 数据事实来源与边界

THEIA 是本地优先应用。`CampusStore` 持有的 `CampusState` 是 renderer、CLI、loopback API、`theia-feed` 和 AI 安全导出的共同业务事实来源。UI 临时状态、Electron Cookie、登录窗 DOM、原始 HTML、模型 API key 和下载中的附件不属于它。

```text
学校页面 / 教务 API / THEOL / IMAP / TYGL / 官方校历
  -> source adapter 或专用 service
  -> 规范化、限长、校验和合并
  -> CampusState
  -> CampusStore 分片持久化
  -> snapshot / feed / CLI / loopback API / AI export package
```

这张边界图有两个结论：

1. **`CampusState` 是“已规范化的用户数据”，不是抓包归档。** 字段可缺失、可为 `null`，且不保证保存学校页面的每个原始列。
2. **外部消费者必须读公开数据接口，不得绕过 store 扫描 Electron session 或 vault。** 直接访问那些目录既不稳定，也会越过隐私设计。

## 2. 标准值约定

除非某个字段段落另有说明，以下约定适用于所有 JSON：

| 约定 | 含义 |
| --- | --- |
| 时间 | ISO-8601 UTC 字符串，例如 `2026-08-12T02:30:00.000Z`；绝不把显示用的中文时间当作机器时间。 |
| 日期 | `YYYY-MM-DD`，例如 `2026-09-01`。 |
| ID | 字符串，稳定性只在同一来源 / 同一数据模型范围内保证；不要从展示标题重新构造。 |
| 可选字段 | 可完全缺失或出现为 `null`；消费方必须同时兼容。 |
| 数组 | 未知、无数据、被过滤或尚未同步时通常是 `[]`；数组为空不能单独推导“学校不存在记录”。 |
| 数值 | 可能为 `number`、`null`，少数学校原始成绩保留为文本，如 `score: "优秀"`。 |
| URL | `sourceUrl` 是来源证据 / 供用户打开的链接，不是供 AI 或脚本自动抓取的授权。 |
| provenance | `source`、`capturedAt`、`parserVersion`、`refreshState`、`complete`、`sync.sources` 都是业务可信度的一部分。 |

### 2.1 未知、空值与冲突

不要把下列状态混为一谈：

| 表现 | 可安全得出的结论 | 不可得出的结论 |
| --- | --- | --- |
| `profile: null` | 尚未得到可用 profile | 用户一定未注册或没有学号。 |
| `grades: []` | 当前持久化状态没有成绩记录 | 用户从未有成绩。 |
| `sync.sources.jwglxt.connected: false` | 本次 / 最近状态中来源未连接 | 本地旧数据失效。 |
| `lastError` 非空 | 最近同步部分失败或有来源报错 | 所有集合均不可信。 |
| `fitness.records[year].refreshState: "empty"` | 已对该体测年度得到无测量值的规范化结果 | 用户绝对未参加体测。 |
| `schoolSchedule.complete !== true` | 缓存不可作为完整课程目录 | 学校没有其他课程。 |

同步服务按来源逐项提交，且失败时保留已有有效数据。故最好的 AI 表述不是“没有”，而是“当前本地同步快照未包含 / 数据来源在某时间状态为……”。

## 3. `CampusState` 顶层 schema

顶层必须可识别为 `theia-campus-data/v1`。`normalizeState()` 会强制重写未知 schema、补默认字段、将错误的集合变成空数组、为没有颜色的课表项分配稳定颜色、标准化 `dataCatalog`，并把邮件数组裁剪到 500 条有效对象。它不是严格 JSON Schema 校验器，外部导入方不能据此假定任意未知字段会被永久保留。

```json
{
  "schema": "theia-campus-data/v1",
  "appVersion": "0.4.2",
  "createdAt": "2026-08-01T08:00:00.000Z",
  "updatedAt": "2026-08-12T02:30:00.000Z",
  "profile": null,
  "terms": [],
  "courses": [],
  "schedule": [],
  "exams": [],
  "grades": [],
  "selectedCourses": [],
  "academicProgress": null,
  "assignments": [],
  "workspaces": [],
  "notices": [],
  "emails": [],
  "dataCatalog": {},
  "sync": {},
  "settings": {}
}
```

顶层字段的责任如下：

| 字段 | 类型 | 责任 | 主要来源 |
| --- | --- | --- | --- |
| `schema` | 固定字符串 | 数据兼容性标签 | core schema。 |
| `appVersion` | string | 写入此 state 的应用版本标识 | core schema。 |
| `createdAt` / `updatedAt` | ISO 时间 | store 创建时间与最近一次持久化变更时间 | CampusStore。 |
| `profile` | `Profile \| null` | 学生基本资料与可选学业轨道关键词 | JWGLXT。 |
| `terms` | `Term[]` | 已发现的学期 | JWGLXT。 |
| `courses` | `Course[]` | 课程目录 / 北化在线THEOL课程的归一化集合 | JWGLXT、THEOL。 |
| `schedule` | `ScheduleItem[]` | 学生个人课表 | JWGLXT。 |
| `exams` | `Exam[]` | 考试安排 | JWGLXT。 |
| `grades` | `Grade[]` | 成绩记录 | JWGLXT。 |
| `selectedCourses` | `SelectedCourse[]` | 已选课程 | JWGLXT。 |
| `academicProgress` | `AcademicProgress \| null` | 培养方案、学分及要求树 | JWGLXT 浏览器通道或教务 API 通道。 |
| `assignments` | `Assignment[]` | 作业与在线测试摘要 | THEOL。 |
| `workspaces` | `CourseWorkspace[]` | 受控本地作业工作包元数据 | 本地 CourseWorkService。 |
| `notices` | `Notice[]` | 教务 / 北化在线THEOL通知摘要 | JWGLXT、THEOL。 |
| `emails` | `EmailMessage[]` | 邮件元数据和按需缓存正文 | IMAP / webmail。 |
| `dataCatalog` | `LocalDataCatalog` | 可离线复用的带来源本地资料 | TYGL、全校课表、官方校历。 |
| `sync` | `SyncState` | 同步水位、错误、来源连接状态 | SyncService。 |
| `settings` | `Settings` | 非秘密应用设置 | renderer / main process。 |

### 3.1 Profile、学期与课程

```json
{
  "profile": {
    "name": "张三",
    "studentId": "2025XXXXXXXX",
    "gpa": 3.62,
    "academicTrack": ["材料", "高分子"],
    "academicClass": "材料2501"
  },
  "terms": [
    { "id": "2025-3", "year": 2025, "term": "3", "label": "2025-2026学年第一学期" }
  ],
  "courses": [
    {
      "id": "course:example",
      "code": "MAT13904T",
      "termId": "2025-3",
      "termIds": ["2025-3"],
      "title": "高等数学",
      "teacher": "教师姓名",
      "credits": 4,
      "category": "必修",
      "location": null,
      "classId": null,
      "description": null,
      "source": "jwglxt",
      "sourceUrl": "https://jwglxt.buct.edu.cn/...",
      "resourceLinks": [],
      "assignmentLinks": [],
      "capturedAt": "2026-08-12T02:30:00.000Z"
    }
  ]
}
```

`Profile` 的 `academicTrack` 可以是一个字符串、字符串数组或 `null`。它是用户可编辑的校历培养方案匹配关键词，不应被误读为学校对专业的唯一正式名称。

`Term` 的固定形状是 `{ id, year, term, label }`。`termId` 通常如 `2025-3`、`2025-12`、`2025-16`，但 AI 不应硬编码“3 一定是秋季、12 一定是春季”的学校业务解释；以 `label` 和官方校历为准。

`Course.source` 目前使用 `jwglxt` 或 `theol`。同一课程号在不同来源 / 学期可有不同对象；关联时优先用显式 `courseId`、`code`、`termId`，名称匹配只能作为带不确定性说明的补充。

### 3.2 课表、考试、成绩与已选课程

```json
{
  "schedule": [
    {
      "id": "schedule:example",
      "termId": "2025-3",
      "courseId": "course:example",
      "title": "高等数学",
      "teacher": "教师姓名",
      "room": "A101",
      "weekday": 1,
      "period": "1-2",
      "weeks": "1-16周",
      "startAt": "2025-09-01T00:00:00.000Z",
      "endAt": "2025-09-01T01:40:00.000Z",
      "color": "#1296b6",
      "sourceUrl": "https://jwglxt.buct.edu.cn/..."
    }
  ],
  "exams": [
    {
      "id": "exam:example",
      "termId": "2025-3",
      "courseName": "高等数学",
      "examType": "期末考试",
      "examTime": "2026-01-10 09:00",
      "startAt": "2026-01-10T01:00:00.000Z",
      "endAt": "2026-01-10T03:00:00.000Z",
      "location": "A101",
      "campus": "昌平校区",
      "seat": "15",
      "mode": null,
      "remark": null,
      "sourceUrl": "https://jwglxt.buct.edu.cn/..."
    }
  ],
  "grades": [
    {
      "id": "grade:example",
      "termId": "2025-3",
      "courseName": "高等数学",
      "courseCode": "MAT13904T",
      "nature": "必修",
      "category": "专业基础课",
      "remark": null,
      "status": "正常",
      "gpaIncluded": true,
      "credits": 4,
      "score": "92",
      "point": 4,
      "teacher": "教师姓名",
      "assessment": "正常考试",
      "sourceUrl": "https://jwglxt.buct.edu.cn/..."
    }
  ],
  "selectedCourses": [
    {
      "id": "selected:example",
      "termId": "2025-3",
      "courseId": "course:example",
      "courseCode": "MAT13904T",
      "classId": "class:example",
      "title": "高等数学",
      "teacher": "教师姓名",
      "credits": 4,
      "category": "必修",
      "location": "A101",
      "time": "周一 1-2 节",
      "capacity": 100,
      "enrolled": 96,
      "waiting": null,
      "sourceUrl": "https://jwglxt.buct.edu.cn/..."
    }
  ]
}
```

`ScheduleItem` 的 `weekday`、`period`、`weeks` 是学校课表展示语义，可能有值而精确 `startAt` / `endAt` 缺失。反过来，`startAt` 存在也不能只依其推断长期重复规则。`color` 是 UI 视觉身份，不是课程分类，也不应进入学业建议逻辑。

`Exam.examTime` 是源端原始 / 显示时间文本，`startAt` / `endAt` 是已解析时间；两者冲突时，应优先保留并报告，不能擅自覆盖。`Grade.score` 是文本以保留“优秀”“缓考”等原义；计算时优先使用明示的 `point`、`credits`、`gpaIncluded`，没有这些字段则不能装作可精确重算 GPA。

### 3.3 学业进度和培养方案树

```json
{
  "academicProgress": {
    "gpa": 3.62,
    "program": "材料科学与工程",
    "courseCounts": {
      "planned": { "total": 50, "passed": 28, "failed": 0, "notTaken": 18, "studying": 4 },
      "outsidePlan": { "passed": 1, "failed": 0 }
    },
    "categories": [],
    "roots": [
      {
        "id": "requirement:root",
        "title": "通识教育",
        "required": 20,
        "earned": 12,
        "remaining": 8,
        "status": "未完成",
        "relation": "and",
        "parentId": null,
        "children": [],
        "courses": [],
        "sourceUrl": "https://jwglxt.buct.edu.cn/..."
      }
    ],
    "sourceUrl": "https://jwglxt.buct.edu.cn/...",
    "capturedAt": "2026-08-12T02:30:00.000Z"
  }
}
```

`categories` 是保留给旧导出 / 兼容的扁平要求列表；`roots` 才是优先使用的层级培养方案树。每个 `AcademicRequirement` 可以有：

- `id`、`title`、`required`：必需；
- `earned`、`remaining`、`status`、`sourceUrl`：可选；
- `relation: "and" | "or" | null`：父节点关系。`or` 意味着替代分支，不能把所有子节点的必需学分简单相加；
- `parentId`、递归 `children[]`；
- `courses[]`：附属的 `AcademicRequirementCourse`，其中可含 `studyStatus`、`courseCode`、`title`、`credits`、`bestScore`、`point`、`score`、补考 / 重修分数及推荐学年学期。

教务 API 有时只能提供 GPA、统计或扁平叶子，而没有官方渲染树。同步合并逻辑会保留本地已有的、层级更完整的官方树。因此一个 API 的空 / 较弱 `academicProgress` 不应覆盖该树，AI 也不应把 `categories` 的每一项视为独立且可累加的毕业条件。

### 3.4 作业、工作包与通知

```json
{
  "assignments": [
    {
      "id": "assignment:example",
      "kind": "assignment",
      "courseId": "course:example",
      "courseName": "高等数学",
      "title": "作业一",
      "dueAt": "2026-08-20T15:00:00.000Z",
      "score": null,
      "status": "pending",
      "sourceUrl": "https://theol.buct.edu.cn/..."
    }
  ],
  "workspaces": [
    {
      "id": "workspace:example",
      "assignmentId": "assignment:example",
      "courseName": "高等数学",
      "title": "作业一",
      "kind": "assignment",
      "dueAt": "2026-08-20T15:00:00.000Z",
      "state": "answer-ready",
      "directory": "C:\\Users\\...\\course-work\\assignment-example",
      "manifestPath": "C:\\Users\\...\\manifest.json",
      "taskPath": "C:\\Users\\...\\task.md",
      "attachmentCount": 1,
      "questionCount": 0,
      "preparedAt": "2026-08-12T02:30:00.000Z",
      "updatedAt": "2026-08-12T02:35:00.000Z",
      "lastError": null,
      "modelName": "example-model",
      "modelProcessedAt": "2026-08-12T02:35:00.000Z"
    }
  ],
  "notices": [
    {
      "id": "notice:example",
      "title": "课程通知",
      "summary": "请按时完成作业。",
      "publishedAt": "2026-08-12T01:00:00.000Z",
      "source": "theol",
      "sourceUrl": "https://theol.buct.edu.cn/..."
    }
  ]
}
```

`Assignment.kind` 通常是 `assignment` 或 `online-test`，但类型允许未来扩展字符串；`status` 也允许未来状态，不能只按三种文字枚举写死。已逾期但源端仍显示的任务可能被同步流程过滤，所以该数组是“THEIA 当前应处理的标准化任务”，不是北化在线THEOL未过滤历史清单。

`CourseWorkspace` 是**元数据**，其 `directory`、`taskPath`、`submissionPath`、`notesPath`、`paperPath`、`modelAnswerPath` 等是本机绝对路径，可能过期、被用户移动，且可能揭示用户名和文件结构。它们不授权外部程序读取文件。AI 包会将它转换为可解释的净化工作包摘要：保留任务关联、状态、数量、时间、经净化的错误和本地产物存在标记，但排除路径、原始附件与任意本机文件内容。完整 JSON 和 Feed 仍按各自的序列化规则处理原始状态。

### 3.5 邮箱

`EmailMessage` 的最小识别字段为 `id`、`subject`、`from`、`receivedAt`、`source`。可选字段包括 `uid`、`fromAddress`、`snippet`、`body`、`bodyHtml`、`bodyHtmlVersion`、`unread`、`attachments`、`remoteMarker`、`capturedAt`。

邮件元数据最多持久化 500 条。正文和附件是按需读取：`body` / `bodyHtml` 的缺失不代表邮件没有正文，只代表尚未读取或没有可安全缓存的正文。`attachments[]` 只包含 `index`、`filename`、`contentType`、`size` 等描述，二进制不会进入 `CampusState`。

邮件正文、发件人和附件名通常是高度敏感个人数据。完整 JSON 和 Feed 仍可能包含已缓存的邮件正文；AI 包也可能包含已经本地缓存的正文，或从已缓存 HTML 转出的纯文本，以及附件元数据。AI 包不会重新连接邮箱、复制附件二进制、保留 IMAP `uid`、`remoteMarker` 或富 HTML。用户必须在导出前自行决定是否交给外部服务；无论何种导出，邮件内容都不得进入日志、错误提示、测试夹具或自动上传的分析服务。

### 3.6 同步状态与非秘密设置

```json
{
  "sync": {
    "lastStartedAt": "2026-08-12T02:20:00.000Z",
    "lastCompletedAt": "2026-08-12T02:30:00.000Z",
    "lastRunAt": "2026-08-12T02:30:00.000Z",
    "lastSuccessAt": "2026-08-12T02:10:00.000Z",
    "lastError": null,
    "runId": "uuid",
    "sources": {
      "jwglxt": {
        "connected": true,
        "checkedAt": "2026-08-12T02:30:00.000Z",
        "authRequired": false,
        "error": null,
        "url": "https://jwglxt.buct.edu.cn/...",
        "errors": []
      }
    },
    "domains": {
      "grades": {
        "schema": "theia-domain-provenance/v1",
        "attempted": true,
        "succeeded": false,
        "emptyConfirmed": false,
        "contentEmptyConfirmed": false,
        "retainedPrevious": true,
        "capturedAt": "2026-08-12T01:40:00.000Z",
        "sourceSucceededAt": "2026-08-12T01:40:00.000Z",
        "attemptedAt": "2026-08-12T02:20:00.000Z",
        "completedAt": "2026-08-12T02:30:00.000Z",
        "status": "failed",
        "errorCode": "grades_read_failed",
        "completeness": "partial",
        "parserVersion": "jwglxt-adapter/1",
        "source": ["jwglxt"],
        "runId": "uuid"
      }
    }
  },
  "settings": {
    "apiPort": 8765,
    "syncIntervalMinutes": 30,
    "autoSync": false,
    "openOriginalInApp": true,
    "academicAuthMode": "api",
    "academicApiEnabled": false,
    "mail": { "enabled": false, "pollIntervalMinutes": 5 },
    "modelBaseUrl": "https://example.invalid/v1",
    "modelName": "example-model",
    "modelModels": ["example-model"]
  }
}
```

`SourceStatus.connected`、`authRequired`、`error` 和 `checkedAt` 是最近检查结果，不是永久账户状态。`sync.lastRunAt` 表示最近一次同步尝试结束，失败也会更新；`sync.lastSuccessAt` 只在整轮同步没有错误时更新。可信结论应优先读取 `sync.domains`。`emptyConfirmed` 仅描述最近一次成功且完整的尝试，`contentEmptyConfirmed` 描述当前保留内容是否已有成功来源确认空；因此确认空后刷新失败可以是 `status: "failed"`、`emptyConfirmed: false`、`contentEmptyConfirmed: true`。失败并保留非空旧值通过 `retainedPrevious` 表达。旧快照缺少该映射时领域 freshness/completeness 均为 unknown，不能从顶层 `updatedAt` 推断。`sync.lastCompletedAt` 是为旧消费者保留的兼容字段。

派生领域及其必要依赖为 `academic <- terms,courses,selected-courses`、`coursework <- assignments,workspaces`、`local-data-catalog <- fitness,school-schedule,academic-calendar`。派生 `completeness` 取最弱必要依赖；`capturedAt`/`sourceSucceededAt` 只有在全部必要依赖都有合法时间时才取最早值，否则为 `null`。任何缺失、未尝试或未知依赖都不能被一个成功子域掩盖。

`settings` 不含任何 password、mail protocol password、cookie、API key 或 token。模型服务 base URL / model name 也不应被混淆为“模型可用证明”。AI 包不把 settings 当作用户学业事实导出；完整 JSON 的字段范围仍以 `CampusState` 为准。

## 4. `LocalDataCatalog`：可离线资料的证据模型

fitness、schoolSchedule 与 academicCalendar 不只保留 catalog 元数据，也在同一个 `CampusStore.update()` 中写入正式的 `sync.domains` provenance。启动时加载已有本地校历只会标为 `not-attempted`，不会冒充一次远端刷新；刷新失败保留既有内容、水位和已确认空结论。三者共同派生 `local-data-catalog` 领域。

`dataCatalog.schema` 固定为 `theia-local-data/v1`。它不是杂项 JSON 桶，而是带来源、范围、采集时间、解析版本和刷新状态的可复用资料目录。当前有三类集合：

```json
{
  "schema": "theia-local-data/v1",
  "updatedAt": "2026-08-12T02:30:00.000Z",
  "collections": {
    "fitness": {},
    "schoolSchedule": {},
    "academicCalendar": {}
  }
}
```

### 4.1 体测 `fitness`

`fitness` 固定带 `source`（体测系统 URL）、`parserVersion`、`lastRefreshedAt`、`availableYears[]` 和按年度键控的 `records`。键必须形如 `YYYY-YYYY_N`，例如 `2025-2026_1`。

每条 `FitnessDataRecord`：

```json
{
  "id": "fitness:2025-2026_1",
  "scope": { "yearKey": "2025-2026_1" },
  "capturedAt": "2026-08-12T02:30:00.000Z",
  "source": "https://tygl.buct.edu.cn/",
  "parserVersion": "tygl-fitness/v1",
  "refreshState": "ready",
  "normalized": {
    "vitality": 80,
    "run50": 8.2,
    "flex": 12.3,
    "jump": 180,
    "strength": 20,
    "endureSecs": 230,
    "heightCm": 170,
    "weightKg": 60,
    "gender": "male",
    "year": "2025-2026",
    "yearKey": "2025-2026_1",
    "academicGrade": "大一",
    "gradeGroup": "12"
  }
}
```

每个测量字段都可能为 `null`。`refreshState` 只有 `ready` / `empty`；它表示本次规范化缓存结果，而不是医学或学籍结论。将体测数据用于建议时，应引用 `capturedAt` 和 `yearKey`，而非将旧年度误当成当前状态。

### 4.2 全校课表 `schoolSchedule`

`schoolSchedule.records` 是按检索范围编码的对象，但真正缓存边界是完整学期。每条记录含：

```json
{
  "id": "school-schedule:...",
  "scope": { "termId": "2025-3", "keyword": null, "teacher": null },
  "capturedAt": "2026-08-12T02:30:00.000Z",
  "source": "https://jwglxt.buct.edu.cn/jwglxt/",
  "parserVersion": "jwglxt-school-schedule/v8",
  "total": 1200,
  "complete": true,
  "items": []
}
```

每个 item 至少有 `id`、`termId`、`title`，可含内部匹配用的 `classId`、`courseCode`、`className`（教学班名称）、`combinedClassInfo`（合班信息）、`teacher`、`time`、`location`、`credits`、`nature`、`category`、`department`、`status`、`affiliation`、`sourceUrl`。每个 `termId` 的 item 总数上限为 10,000，目录最多保留最近 80 个记录。`complete` 不为 `true` 时，不能给用户列出“所有可选课”或断言缺课。

### 4.3 官方校历 `academicCalendar`

该集合持有官方来源的元数据、结构化校历和可编辑 PDF 分析，而不是文件二进制：

- `assets`: `calendar`、`teachingSchedule`、`weeklyCalendar` 的 `filename`、`sourceUrl`、`fetchedAt`、`nextRefreshAfter`、`bytes`；
- `calendar`: `theia-academic-calendar/v1`，包含 `schoolYear`、`parsedAt`、`semesters[]`、`vacations[]`、`specialDates[]`；
- `analysis`: `theia-academic-calendar-analysis/v1` 的结构化 `weeklyCalendar` 和 `teachingSchedule` 分析；
- `calendarError` / `analysisError`: 最近日志安全摘要，最多 300 个字符。

`calendar.semesters[]` 需要 `label`、`startDate`、`endDate`、`weeks`；`vacations[]` 需要 `label`、开始和结束日期；`specialDates[]` 需要 `label`、日期。PDF 二进制位于数据根相邻的资产目录；AI 包只保留解析后的结构化内容和资产元数据，不能把原 PDF 当作普通 JSON 字段塞入 prompt。

## 5. 物理存储：分片、manifest 与恢复

默认数据根内容概览：

```text
%APPDATA%/THEIA/
  data/
    manifest.json
    manifest.json.bak
    objects/<kind>/<sha256>.json
  buct-data.json              # 仅旧版迁移输入
  buct-data.json.bak          # 仅旧版迁移恢复
  theia-feed.json             # 派生兼容导出
  api-runtime.json            # 进程运行时临时信息
  course-work/                # 受控作业工作包；不是通用数据接口
  course-selection/records.json
  academic-calendar/          # 官方二进制资产及其 manifest
  session/                    # Electron session；绝不可读取或导出
```

### 5.1 Manifest 与不可变 fragment

主 manifest 形状：

```json
{
  "schema": "theia-sharded-store/v1",
  "revision": "uuid",
  "createdAt": "2026-08-01T08:00:00.000Z",
  "updatedAt": "2026-08-12T02:30:00.000Z",
  "fragments": {
    "academic/grades": {
      "path": "objects/academic/grades/<sha256>.json",
      "digest": "sha256-of-value-json"
    }
  },
  "legacy": { "path": "buct-data.json", "retainedForMigration": true }
}
```

每个 fragment：

```json
{
  "schema": "theia-state-fragment/v1",
  "kind": "academic/grades",
  "digest": "sha256-of-value-json",
  "writtenAt": "2026-08-12T02:30:00.000Z",
  "value": []
}
```

目前 fragment 名到 `CampusState` 的映射如下：

| Fragment kind | 状态字段 |
| --- | --- |
| `state/meta` | `appVersion`、`createdAt`、`updatedAt` |
| `state/profile` | `profile` |
| `state/settings` | `settings` |
| `state/sync` | `sync` |
| `academic/terms` | `terms` |
| `academic/courses` | `courses` |
| `academic/schedule` | `schedule` |
| `academic/exams` | `exams` |
| `academic/grades` | `grades` |
| `academic/selected-courses` | `selectedCourses` |
| `academic/progress` | `academicProgress` |
| `coursework/assignments` | `assignments` |
| `coursework/workspaces` | `workspaces` |
| `communication/notices` | `notices` |
| `communication/emails` | `emails` |
| `catalog/index` | `dataCatalog`，但去除全校课表 records |
| `catalog/school-schedule/<term>` | 每个全校课表缓存记录 |

每次写入先写临时文件、原子 rename fragment，全部 fragment 存在后才原子更新 manifest；写新 manifest 前备份旧 manifest。读取时先验证主、备份 manifest 的 schema 和完整结构，再以较新的有效清单为基准，逐个验证 fragment schema、`kind` 和 `digest`。某个引用无效时可只从另一份清单恢复对应 fragment，并为恢复后的组合写出新清单；若某个必需 fragment 在两份清单中都不可恢复，则停止加载并保持原 manifest 不变，不会静默生成空数据。只有在分片存储不存在时，才读取旧 `buct-data.json` / `.bak` 并重建新分片。

### 5.2 外部读取的正确方式

按优先级：

1. THEIA 运行时：读 loopback `/v1/snapshot` 或更小的集合端点。
2. 离线集成：用 CLI 输出；供 AI 解释时使用 `theia export --format ai --output DIRECTORY` 写出的版本化数据包。
3. 仅用于恢复 / 管理工具：读取 manifest，拒绝包含 `..` 的 fragment 路径，验证每个 fragment 的 JSON、kind 和 SHA-256，再合并。

不要直接编辑 `data/`、`theia-feed.json` 或旧 `buct-data.json`。`theia-feed.json` 是从最新快照原子替换的派生兼容文件，不是数据库；AI 包也是一次性只读快照，不能把它当作唯一来源或回写格式。

## 6. 来源归属和合并规则

| 数据 | 规范来源 | 失败时行为 |
| --- | --- | --- |
| profile、terms、schedule、exams、grades、selectedCourses、academicProgress | JWGLXT 浏览器通道；启用且配置后由教务 API 通道优先读取 | 保留旧有效集合；已启用 API 的本轮失败不静默切换通道，更弱 API 结果不能抹掉完整培养方案树。 |
| courses、assignments、THEOL notices | THEOL，课程可与 JWGLXT 课程合并 | 保留其他来源课程与旧有效项。 |
| emails | IMAP / webmail service | 正文按需，附件不写进 state。 |
| fitness | TYGL，用户触发刷新后本地缓存 | 已缓存年度继续可读。 |
| school schedule | JWGLXT 全校课表爬取缓存 | 不把短服务端页伪装为完整结果。 |
| academic calendar | 官方教务处资产 + 本地 PDF 结构化分析 | 解析失败时保留最近成功分析。 |
| workspaces | 本地 CourseWorkService | 路径失效不抹掉任务历史。 |

新数据加入共享数据层前，必须回答：谁是唯一 merge authority？它是否需写入 fragment？是否进入 snapshot、feed、API、AI 导出或只留本地受控目录？缺失、失败和旧数据如何表达？没有这些答案的新字段不能直接散落在 renderer state。

## 7. 面向 AI 的使用规则

进程内无模型顾问使用 `VersionedSnapshot = { state, revision, committedAt, domainDigests }`，并生成由 `{snapshotRevision,evaluatedAt,timeZone,rulesVersion}` 界定的完整 overview 实例。claim ID 标识逻辑 claim，可以在不同 `evaluatedAt` 下保持稳定，而倒计时等 `value` 会变化；消费者必须整体替换 overview，禁止按 claim ID 跨实例合并动态字段。

1. 先读 `sync`、document `updatedAt` 与 provenance，再解释学业数据；不要把缓存时代替实时学校状态。
2. 有 `roots` 时以层级培养方案为主；尊重 `relation: "or"`。
3. 计划、成绩、体测、邮件和课程名可识别个人，输出时最小化复述，不把整份数据转发给未获授权的服务。
4. 工作包路径、source URL 和附件名仅作定位 / 证据；不执行、不抓取、不读取任意路径。
5. 不能从空字段推断失败、违纪、挂科、缺课或毕业结论。必要时说明数据覆盖范围和未知项。

AI 专用的全量、文件化快照已由 [AI 数据导出契约](ai-export-contract.md) 定义。AI 消费者应使用该包中的 manifest、数据字典和领域文件，而不是将完整 JSON、Feed 或底层分片误认为同样具备路径净化和文件级完整性校验。
