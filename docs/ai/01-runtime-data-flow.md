# 运行时数据流

修改数据源适配器、持久化数据、本地 API 或本地数据集成前，请先阅读本文。

## 数据归属

```text
学校服务 / IMAP / 本地工具
  -> 核心适配器或服务
  -> CampusStore.update() 或 .replace()
  -> 不可变分片 + 清单
  -> CampusStore 快照订阅者
  +-> snapshotWithRevision() -> 进程内确定性顾问概览 -> 受信任 IPC
  +-> 原子写入 theia-feed.json -> 渲染进程快照、回环 API、CLI、外部本地消费者
```

- 渲染进程不读取磁盘文件，也不解析学校页面。
- `CampusStore` 是持久化业务数据的唯一所有者。
- 凭据、Cookie、API 密钥、原始 HTML 和浏览器会话绝不属于 `CampusState` 或任何分片。
- 临时界面状态保留在 React Hook 中；持久化状态必须归入 `core/schema.mjs` 和 `CampusStore`。

## 运行时边界

| 层级 | 负责内容 | 禁止事项 |
| --- | --- | --- |
| 渲染进程 | 展示、局部交互状态 | 访问磁盘、直接抓取 HTTP、持有凭据 |
| Preload / IPC | 范围有限的类型化命令 | 暴露 Electron 或会话内部能力 |
| 核心适配器 | 按来源获取并规范化数据 | 保存界面专用状态或绕过持久化层 |
| 核心服务 | 合并、重试、来源归属 | 直接修改渲染进程状态 |
| `CampusStore` | 规范化快照与持久写入 | 访问网络 |
| 本地 API / CLI | 只读外部数据契约 | 提供写接口或绑定公网地址 |
| 核心顾问 | 单个版本化快照、数据质量、证据、本地结论、风险和议程 | 请求网络或模型、读取回环接口、写入存储 |

## 写入规则

1. 输入必须先规范化，再进入 `CampusStore`。
2. 局部状态变更使用 `store.update()`；完整同步状态使用 `store.replace()`。
3. 功能模块不得直接写入 `buct-data.json`、`data/` 或 `theia-feed.json`。
4. 成功的存储操作先更新分片式主存储，再按相同快照顺序排队写入 Feed。
5. 数据源失败时保留旧数据。API 或 SSO 刷新失败不得清空先前有效的集合。
6. 数据和对应数据域来源必须在同一次 `store.update()` / `replace()` 事务中持久化。绝不能依据全局 `snapshot.updatedAt` 推进某个数据域的水位时间。

## 进程内顾问读取

确定性顾问是内部消费者，不是外部集成。`electron/advisor-overview-service.mjs` 只调用一次 `CampusStore.snapshotWithRevision()`，只采样一次评估时钟，并在进程内构建自洽的完整概览。它不得调用回环 API、读取 `theia-feed.json`，也不得构建或读取 AI 导出包。

概览实例由 `{snapshotRevision, evaluatedAt, timeZone, rulesVersion}` 标识。任意成员变化时，消费者都必须整体替换实例；不得依据稳定的结论 ID 合并不同评估产生的动态值。完整不变量见[《顾问 P0 可信底座》](16-advisor-p0-foundation.md)。

## 数据源归属

- JWGLXT 负责教务资料、学期、成绩、考试、已选课程、学业进度和个人课表。
- 北化在线 THEOL 负责源自 THEOL 的课程、作业和通知。
- IMAP 负责邮件元数据和按需缓存的正文。
- `dataCatalog` 负责带来源标记的本地档案，例如体测数据和全校课表缓存。
- 校历服务负责 `%APPDATA%/THEIA/academic-calendar/manifest.json` 中的官方二进制资产和可编辑 PDF 分析；`cacheAcademicCalendarAssets()` 会把安全的结构化摘要镜像到 `dataCatalog.academicCalendar`。
- 每个集合只能有一个合并权威。不得让无关适配器用空结果替换该集合。

## Feed 契约

`theia-feed.json` 是原子生成的兼容性导出，是派生数据，不是真相来源。

- `events` 是面向日历的规范化视图。
- `tasks` 是作业与工作区视图。
- `academic` 包含教务集合。
- `localData` 包含 `dataCatalog` 和邮件元数据。

THEIA 运行时，外部 AI 应优先读取回环 API；THEIA 未运行时，可读取 Feed。两者均为只读。

上述外部消费者规则不适用于进程内顾问。未来 `AdvisorRuntime` 发起模型请求时，必须在该请求的整个生命周期内冻结版本化快照及实际披露的结论目录。

## 新增数据

每新增一个持久化集合，都必须完成以下工作：

1. 在 `core/schema.mjs` 中加入规范化默认值和迁移处理。
2. 在 `core/store.mjs` 中加入分片映射。
3. 明确它应进入 Feed、本地 API 端点、CSV / NDJSON 导出，还是完全不对外提供。
4. 添加规范化、存储与重载、公开输出测试。
5. 更新 `docs/ai/` 下对应的专题文档。

未来 AI 功能需要的数据不得只放入渲染进程缓存。

## 校历 PDF

`core/academic-calendar-pdf-analysis.mjs` 利用文本层在本地解析官方周历和教学安排 PDF。它不使用模型，也不存储 PDF 原始文本。

- `weeklyCalendar.entries` 是扁平数组：官方表格中的一行对应一个可编辑事件对象。无法确定的日期保留为 `null`，同时保留 `dateText`。
- `teachingSchedule.rows` 保留每个年级专业行。仅当学号年份与有充分依据的专业关键词同时匹配时，才设置 `match.selected`；只有年级匹配的结果必须明确标示。
- 只能把所选行实际出现的字母标记复制到 `markerNotes`，不得附上完整的 A-T 图例。
- 任一 PDF 变化、解析器版本变化或本地学业方向上下文变化时，都要重新解析。解析失败时保留上次成功结果。
- `weeklyCalendar.courseSelectionWindows` 只能从选课事件推导，排除“论文题目补选”。选课界面可以应用尚未结束且时间最近的窗口；即使哨兵已停用，`CourseSelectionJournal` 仍须保留用户手动修改的起止时间。
- 教学安排解析器明确支持官方文档简称 `高材 -> 材料` 和 `功材 -> 材料`。上下文中必须保留学生原始专业方向，并在 `match.basis` 记录所用别名；不得静默把个人资料改写成表格简称。
