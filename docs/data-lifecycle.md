# THEIA 数据生命周期

## 1. 目标和范围

THEIA 将多种校园来源变成一个可离线读取、可追溯、可恢复的本机快照。数据生命周期的设计目标并非“尽可能抓取原始页面”，而是让以下消费者围绕同一个、结构稳定的事实来源工作：桌面界面、CLI、loopback API、显式导出、课程任务工作区以及 AI 顾问。

这篇文档说明数据从读取、规范化、合并、持久化、发布、导出到恢复的完整路径。关于每个字段和类型，请看 [数据模型参考](reference/data-model.md)；关于使用这些数据给 AI，请看 [AI 数据导出契约](reference/ai-export-contract.md)。

## 2. 数据根目录

默认数据根为当前 Windows 用户的 `%APPDATA%\THEIA`。开发、测试或隔离运行可设置 `THEIA_DATA_ROOT` 覆盖该位置。旧的 `%APPDATA%\BUCT` 目录仅用于读取历史兼容数据，不能作为新的常规写入目标。

一个典型数据根包含：

```text
%APPDATA%\THEIA\
  data\
    manifest.json                    当前分片清单，主事实入口
    manifest.json.bak                上一份可回退清单
    objects\
      state\...
      academic\...
      coursework\...
      communication\...
      catalog\...
  buct-data.json                     旧版迁移来源，不是当前主存储
  buct-data.json.bak                 旧版恢复来源
  theia-feed.json                    从最新快照原子派生的兼容 Feed
  api-runtime.json                   运行时 loopback API 地址，仅应用在运行时存在
  auth-diagnostics.ndjson            脱敏认证诊断信息
  academic-calendar\
    manifest.json                    官方校历资产与本地分析摘要
    assets\                          校历图像和 PDF 资产
  course-work\<assignment-id>\      单个已准备任务的受控工作区
  course-selection\records.json     目标/审计 journal，不属于 CampusState 主分片
  session\                           Electron 浏览器会话，绝不读取或导出
```

路径的具体位置、存在性和文件数量会随数据量变化。外部程序不应扫描目录猜测结构，也不应编辑上述文件；正常读取应优先用运行中的 loopback API，其次使用显式导出或 `theia-feed.json`。

## 3. 规范化的校园快照

`CampusState` 是当前业务快照，schema 为 `theia-campus-data/v1`。顶层由 `core/schema.mjs` 的 `emptyState()` 定义，并由 `normalizeState()` 在加载、同步和写入时统一修正：

```text
meta:       schema, appVersion, createdAt, updatedAt
academic:   profile, terms, courses, schedule, exams, grades,
            selectedCourses, academicProgress
coursework: assignments, workspaces
communication: notices, emails
local archive: dataCatalog
runtime record: sync
preferences: settings
```

规范化的含义包括：数组缺失时变为空数组；资料库按各自规则裁剪非法或过大的值；课程类别从成绩与课程来源中协调；课表颜色在同一学期内稳定分配；邮箱记录上限为 500；同步配置和邮箱轮询间隔被限制到安全区间。它不意味着所有字段都有值：来源未提供、未同步或无法可靠解析的数据必须保持 `null`、空集合或明确错误状态，而不是凭空补全。

## 4. 采集、解析与合并

### 4.1 会话来源

学校页面通过 Electron 的持久 session 使用统一认证 Cookie；`SessionClient` 负责安全请求、字符编码、登录页识别和错误归类。教务 API 凭据与统一认证会话分离，API cookie jar 仅存在内存，不能镜像进 Electron 的统一认证浏览器 session。API 未启用或未配置时使用浏览器通道；已启用 API 后的本次 API 故障会返回错误并保留既有本地数据，不在该轮同步中静默切换浏览器通道。邮箱使用独立的加密凭据和 IMAP 通道；模型服务也使用独立 API Key。

### 4.2 Adapter 与 parser

来源 adapter 发起受控读取，再把响应交给 parser 变成普通 JavaScript 数据。parser 不写文件、不控制 UI、不保存秘密。常见链路如下：

| 数据 | 主要 adapter/parser | 规范化产物 |
| --- | --- | --- |
| 教务个人信息、学期、成绩、考试、课表、已选课程 | `adapters/jwglxt.mjs`、`parsers/jwglxt.mjs` | `profile`、`terms`、`grades`、`exams`、`schedule`、`selectedCourses` 等。 |
| 培养方案和进度 | JWGLXT / academic API + `academic-progress.mjs` | `academicProgress` 及其树结构。 |
| 北化在线THEOL课程、作业、通知、在线测试 | `adapters/theol.mjs`、`parsers/theol.mjs`、`parsers/theol-work.mjs` | `courses`、`assignments`、`notices`、工作区内容。 |
| 体测 | `adapters/tygl.mjs` + `data-catalog.mjs` | `dataCatalog.collections.fitness`。 |
| 校历 | `academic-calendar-assets.mjs`、`academic-calendar-*.mjs` | `dataCatalog.collections.academicCalendar` 与单独资产目录。 |
| 邮箱 | `imap-mail-service.mjs` | `emails`，正文/附件按需获取。 |
| 全校开课课表 | `course-selection.mjs` + `data-catalog.mjs` | `dataCatalog.collections.schoolSchedule`。 |

### 4.3 同步合并规则

`SyncService` 以一次同步为单位维护安全的来源状态，并将局部结果经 `mergeSyncResult()` 合并进当前快照。合并是选择性的：只有来源明确返回的字段才覆盖当前值；某来源故障、认证要求或解析失败时，已有有效集合保持不变。同步的错误字符串应是便于诊断的脱敏摘要，不能带入 URL 查询参数、Cookie、原始页面或密码。

这条规则对于数据导出极其重要：一个集合为空并不总是说明“用户没有这类数据”，它还可能说明尚未同步、来源不可用、账号没有权限或数据尚未被解析。AI 和外部消费者应优先检查 `sync.domains.<domain>` 的领域级 outcome，再结合 `sync.lastSuccessAt`、`sync.lastRunAt`、`sync.sources`、集合的 `capturedAt`/`updatedAt` 与相关刷新状态做结论。旧快照没有 `sync.domains` 时领域 provenance 一律为 unknown，不得用顶层 `updatedAt` 补写。

每个主同步领域记录本轮 `attempted`、`succeeded`、`emptyConfirmed`、`contentEmptyConfirmed`、`retainedPrevious`、`capturedAt`、`sourceSucceededAt`、`attemptedAt`、`completedAt`、`status`、`errorCode`、`completeness`、`parserVersion`、`source` 与 `runId`。`emptyConfirmed` 只属于最近尝试；`contentEmptyConfirmed` 属于当前保留内容。一次失败不能冒充新的空确认，也不会抹掉先前成功确认的空内容结论。多来源领域还保留按来源拆分的 `outcomes`。`CampusStore.snapshotWithRevision()` 将同一已提交视图中的 `{ state, revision, committedAt, domainDigests }` 一次返回；领域 digest 绑定业务内容，因此只修改设置不会让无关学业证据失效。

三个聚合领域由必要子域派生：`academic <- terms,courses,selected-courses`，`coursework <- assignments,workspaces`，`local-data-catalog <- fitness,school-schedule,academic-calendar`。派生完整性取最弱必要依赖；只有全部必要依赖都有合法水位时，`capturedAt`/`sourceSucceededAt` 才取其中最早值，否则为 `null`。因此一个来源的中间提交、一个缺失水位或一个未知子域都不能把聚合结果抬高为完整实时数据。

## 5. 分片存储与完整性

### 5.1 为什么使用分片

把一个巨大的用户快照每次整体重写会导致小设置改动也触碰成绩历史和课表，并增加文件损坏的风险。`CampusStore` 因此将状态拆成不可变片段，每个片段的 `value` 使用 SHA-256 摘要标识，清单只引用已存在且已校验的片段。

```json
{
  "schema": "theia-state-fragment/v1",
  "kind": "academic/grades",
  "digest": "sha256-of-value-json",
  "writtenAt": "2026-08-12T00:00:00.000Z",
  "value": []
}
```

`data/manifest.json` 的 schema 是 `theia-sharded-store/v1`，包含 revision、时间和片段引用。当前映射覆盖：

| 分片前缀 | 主要状态 |
| --- | --- |
| `state/meta` | app 版本、创建时间、更新时间。 |
| `state/profile`、`state/settings`、`state/sync` | 用户资料、非秘密设置、同步元数据。 |
| `academic/*` | 学期、课程、课表、考试、成绩、已选课程、进度。 |
| `coursework/*` | 作业与工作区记录。 |
| `communication/*` | 通知、邮件。 |
| `catalog/index` | 大多数资料库内容。 |
| `catalog/school-schedule/<term>` | 每个完整学期的全校课表缓存，独立分片。 |

### 5.2 原子写入与回退

保存时遵循以下顺序：

1. 对每个新值计算摘要；未变化的值复用旧不可变对象。
2. 将新片段先写入临时文件，再 rename 到引用路径。
3. 仅当所有被新清单引用的片段都存在后，写入新 `manifest.json`。
4. 替换清单前保留上一个版本为 `manifest.json.bak`。
5. 完成后由 store 发布深拷贝快照，Feed 写入以相同快照顺序排队。

加载时，THEIA 先验证主清单与备份清单的 schema 和完整结构，再以较新的有效清单为基准，逐个片段校验 kind 和 digest。基准清单中的某个片段损坏时，可只从另一份清单恢复该片段，其余仍使用较新的有效片段；混合恢复会在写锁内固化成新的自洽 revision/manifest，并保留最后可恢复 backup，之后 `snapshotWithRevision()` 只暴露该已提交视图。若任一必需片段在两份清单中都无法恢复，加载会明确失败并保持两份原清单不变，不会用空状态覆盖现有数据。只有在没有分片存储时，才尝试从 `buct-data.json` 或其备份进行一次迁移；迁移也不会删除旧文件。

### 5.3 外部读取的优先级

外部工具的推荐顺序为：

1. THEIA 正在运行：使用 loopback API，因为它直接从当前 `CampusStore` 快照读取。
2. 应用未运行但需要常用摘要：读取 `theia-feed.json`，它是原子替换的派生文件。
3. 用户主动导出了一个 JSON / Feed：读取该明确的单文件快照，并先验证 schema。
4. 仅用于维护/取证的低层工具：读取 `data/manifest.json`，验证每一片段的 digest 后重建状态。

直接读取 `session/`、猜测对象路径、编辑清单或以 `theia-feed.json` 作为写入数据库均不受支持。

## 6. 资料库和长生命周期数据

`dataCatalog` 的 schema 是 `theia-local-data/v1`。它存放不适合混进短周期同步集合、但对离线分析与 AI 导出有价值的本地资料：

| 集合 | 记录粒度 | 关键可追溯字段 | 特别规则 |
| --- | --- | --- | --- |
| `fitness` | 一个体测年份 | source、parserVersion、capturedAt、refreshState、yearKey | 切换年份从缓存读取；只有缺失或用户强制刷新才访问学校。 |
| `schoolSchedule` | 一个完整学期的全校课表 | scope、capturedAt、complete、total、parserVersion | 搜索/分类在本地完整集合内进行，不能把十条服务器分页响应当成完整缓存。 |
| `academicCalendar` | 一组官方资产及结构化分析 | source、assets、lastRefreshedAt、calendar、analysis、错误字段 | PDF 二进制和原始文字不进 Feed；安全的结构化摘要可镜像入资料库。 |

新资料库集合至少需要稳定 ID、来源、作用域、采集时间、解析版本、刷新状态和规范化值。不能塞入 cookie、token、未限定体积的原始页面、任意二进制附件或凭据。

## 7. 课程任务工作区

用户对作业点击“准备工作区”后，`CourseWorkService` 在 `course-work/<assignment-id>/` 创建受控目录。这个目录的每个路径都由服务依据经过校验的任务 ID 和安全文件名生成，不能信任远端附件名或 renderer 传入的路径。

通常包含：

```text
course-work/<assignment-id>/
  manifest.json                 theia-course-work/v1，任务和附件清单
  task.md                       题目、课程、截止时间、附件链接与抽取文字
  answers.template.json         在线测试的答案模板（仅有题目时）
  answers.json                  已导入或模型生成的规范化答案（如适用）
  model-answer.md               模型生成的作业草稿（如适用）
  submission-<safe-name>.*      用户导入的待提交文件（如适用）
  <downloaded attachments>      已下载的受控附件
```

工作区元数据会回写到 `CampusState.workspaces`，包括任务 ID、状态、文件路径、准备/更新时间、附件/题目数量、模型结果和写入测试的审计。它可被导出而不是对外自动上传。模型读取该工作区时受上下文长度限制，最终提交仍由用户完成。

## 8. Feed、显式导出与 API

### 8.1 完整 JSON

界面“完整 JSON”与 CLI `theia export --format json` 序列化当前完整 `CampusState`。这是最接近本机业务快照的单文件导出，可用于个人备份、严谨的数据分析或 AI 读取，但它可能包含个人资料、成绩、邮件正文、作业详情、来源 URL 和本机路径。它不包含秘密凭据和浏览器会话。

### 8.2 THEIA Feed

`toTheiaFeed()` 从状态生成 `theia-campus-feed/v1`：

- `events` 将课表、考试和作业变成按时间组织的事件；
- `tasks` 提取作业与关联工作区的状态；
- `academic` 放入学期、课程、课表、成绩、考试、进度、作业、工作区和通知；
- `localData` 放入资料库和邮件消息；
- `source.account` 对学号做稳定 ID 处理，不把它当作认证信息。

Feed 便于本地工具快速获得综合上下文，但它仍是完整状态的派生视图。新增字段时要同时评估 Feed 的隐私、体积和稳定性；不是所有内部状态都应该自动进入 Feed。

### 8.3 互操作格式

- ICS：考试与作业截止时间，适合日历应用；不是完整课表/成绩备份。
- CSV：一个扁平集合；当前字段表头按对象键收集，嵌套对象不应被当作通用结构化交换格式。
- NDJSON：当前仅 CLI 选项，按集合逐条输出一行包装；适合流式处理，但不是界面导出选项。
- loopback API：分集合按需读取、可用 `?since=<ISO-8601>` 获取时间筛选结果，适合正在运行时的集成。

精确接口、响应包装、CORS 和命令见 [接口与 IPC 参考](reference/api-and-ipc.md)。

### 8.4 AI 上下文包

设置页的“导出给 AI”以及 CLI 的 `theia export --format ai --output DIRECTORY` 会把当前同一份 `CampusStore` 快照写入一个新的 `THEIA-AI-EXPORT-YYYYMMDD-HHmmss/` 子目录。它固定包含 `manifest.json`、`AI_CONTEXT.md`、`DATA_DICTIONARY.md` 与各个业务领域的 JSON 文件；即使某个集合为空，对应文件也会保留，避免消费者把“文件不存在”误读成“不适用”。

每个领域 JSON 都有 `theia-ai-context/v1` envelope，其中的 `generatedAt` 是整包构建时刻，`updatedAt` 是该领域已知的最新时间，`recordCount`、`sources` 和 `completeness` 描述覆盖程度。`sources` 保留来源标签，URL 形式的来源会裁剪为 HTTP(S) origin/path。`manifest.json` 的 `theia-ai-export-manifest/v1` 清单包含 18 个非 manifest 文件的 UTF-8 字节数和 SHA-256；物理目录总计 19 个文件。消费者必须在解释内容前校验。导出在临时子目录完成后再原子 rename，若已有同名目录会追加序号而绝不覆盖旧导出。

AI 包是净化后的解释视图，不是 `CampusState` 的字节级备份。它排除密码、授权码、Cookie、session、API Key、原始认证页面、绝对本机路径、附件二进制和工作区产物文件；但可能保留姓名、学号、成绩、作业、通知、邮件文本、附件名称、体测和校历等敏感个人业务数据。它不会在导出时重新同步、读取附件或上传任何内容。准确文件清单和字段转换以 [AI 数据导出契约](reference/ai-export-contract.md) 为准。

## 9. 隐私、保留和删除边界

### 9.1 绝不导出的秘密

密码、邮箱授权码、模型 API Key、Cookie、session storage、浏览器缓存、独立 API cookie jar、原始认证页面和可重放的选课操作字段必须留在受保护的运行时或加密 vault，不得进入：

- `CampusState`；
- 分片 value；
- `theia-feed.json`；
- UI/CLI 导出；
- `/v1/*` 响应；
- `auth-diagnostics.ndjson`、活动日志或测试 fixture。

### 9.2 仍属敏感个人数据的内容

即使未包含秘密，学号/姓名、成绩、GPA、选课、考试位置、邮箱发件人和正文、课程作业题目、学习计划、校历匹配信息、来源 URL、工作区路径和本地文件名也会揭示个人信息。导出前应让用户知道它将交给谁；导出到 AI 或第三方时应只给完成任务必要的数据，并妥善保管副本。

### 9.3 不擅自清理

数据迁移、修复或功能变更不得随意清理旧快照、旧 manifest、工作区、校历资产或 course-selection journal。真正的删除需要明确的用户面对策略、精确目标、可恢复性说明和验证；代码不能把“新格式已经写入”当作“旧数据可以删除”。

## 10. 面向 AI 的可靠性提示

AI 读取 THEIA 数据时应把每个时间戳和来源字段视为证据，而不是展示噪音：

1. 先检查顶层 schema；不匹配则拒绝推断。
2. 优先检查 `sync.domains`，再结合 `sync.lastSuccessAt`、`sync.lastRunAt` 和来源状态；不得用顶层 `updatedAt` 或记录时间补造领域水位。
3. 把 `null`、空数组、`refreshState: "empty"`、`emptyConfirmed`、`contentEmptyConfirmed` 与同步失败区分开；只有完整 provenance 的确认空可称为空结论。
4. 将 `sourceUrl`、`capturedAt`、`parserVersion`、`complete`、`lastError` 作为结论的置信依据。
5. 不把工作区路径、模型输出或旧缓存误认作学校系统已提交或已确认的事实。
6. 不产生涉及凭据、Cookie、越权抓取、自动提交或修改状态的操作指令。

进程内顾问从 `snapshotWithRevision()` 生成 overview，不走 loopback API 或 AI 导出。其一个评估实例由 `{snapshotRevision,evaluatedAt,timeZone,rulesVersion}` 定义，UI/消费者必须整体替换，不能按 claim ID 跨实例合并动态值。外部 AI 才使用用户明确生成的导出包。

AI 消费的安全说明和机器可读规则在 [AI 数据导出契约](reference/ai-export-contract.md) 中单独维护。使用 AI 包时，应先校验 manifest，再阅读 `AI_CONTEXT.md`、`DATA_DICTIONARY.md`、`sync.json` 与 `provenance.json`；不要把带日期的静态快照、空集合或本地工作区状态当作学校系统的实时确认。
