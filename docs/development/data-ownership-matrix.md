# THEIA 数据所有权与接口矩阵

## 为什么需要这张矩阵

THEIA 的功能跨越校园来源、Electron 特权能力、纯业务核心、持久化状态、界面、HTTP API、工作区和 AI 消费。只看文件目录很容易把“谁读取到数据”误当成“谁拥有数据”。本矩阵把每类数据的来源、归并权、持久化位置、公开读取面、敏感边界和失败语义放在一起，供开发者、AI 集成方和审查者快速判断。

本文件描述当前架构，不替代源码。字段细节在 [数据模型参考](../reference/data-model.md)，调用方式在 [接口与 IPC 参考](../reference/api-and-ipc.md)，完整生命周期在 [数据生命周期](data-lifecycle.md)。

## 顶层状态矩阵

| 领域 / `CampusState` 字段 | 主要来源与归并权威 | 典型核心模块 | 持久化分片 | 当前读取面 | AI 解读注意事项 |
| --- | --- | --- | --- | --- | --- |
| `profile` | JWGLXT / 教务 API；同步合并 | `adapters/jwglxt.mjs`、`academic-api-adapter.mjs` | `state/profile` | snapshot、Feed、`/v1/profile` | 可含姓名、学号、专业；属于敏感个人数据，学号不是凭据。已启用 API 的本轮失败保留旧值。 |
| `terms` | JWGLXT | `parsers/jwglxt.mjs` | `academic/terms` | snapshot、Feed、`/v1/terms`、CSV | 是学期归属依据；没有学期不应猜测当前学期。 |
| `courses` | JWGLXT 与 THEOL 按职责合并；类别可由成绩协调 | adapters/parsers、`course-category.mjs` | `academic/courses` | snapshot、Feed、`/v1/courses`、CSV | 同名课程未必同一记录；优先用稳定 ID/course code/term。 |
| `schedule` | JWGLXT 个人课表 | `parsers/jwglxt.mjs` | `academic/schedule` | snapshot、Feed、`/v1/schedule`、CSV | `startAt` 缺失时不能做精确日历推断；颜色仅是显示辅助。 |
| `exams` | JWGLXT | `parsers/jwglxt.mjs` | `academic/exams` | snapshot、Feed、`/v1/exams`、CSV、ICS | `examTime` 与 `startAt` 都可能存在；地点/座号敏感。 |
| `grades` | JWGLXT / 教务 API | parser、adapter、`gpa.mjs` | `academic/grades` | snapshot、Feed、`/v1/grades`、CSV | 成绩为空不代表没有成绩，先检查同步时间和来源错误。 |
| `selectedCourses` | JWGLXT | `parsers/jwglxt.mjs` | `academic/selected-courses` | snapshot、Feed、`/v1/selected-courses`、CSV | 反映当前同步快照，不表示选课事务正在执行。 |
| `academicProgress` | 官方培养方案优先；教务 API 可补充 | `academic-progress.mjs` | `academic/progress` | snapshot、Feed、`/v1/academic-progress` | 根树有 `and/or` 关系；不能把一条替代分支当作所有要求都必须满足。 |
| `assignments` | 北化在线THEOL | `adapters/theol.mjs`、`parsers/theol.mjs` | `coursework/assignments` | snapshot、Feed、`/v1/assignments`、CSV、ICS | `pending` 是处理候选，不等于已经提交或允许自动提交。 |
| `workspaces` | `CourseWorkService` | `course-work.mjs` | `coursework/workspaces` | snapshot、Feed、`/v1/workspaces`、CSV | 路径指向本机资料，存在不等于模型输出或学校提交已验证。 |
| `notices` | JWGLXT/THEOL | adapters/parsers | `communication/notices` | snapshot、Feed、`/v1/notices`、CSV | `publishedAt` 是时间证据；标题/摘要可能不完整。 |
| `emails` | IMAP | `imap-mail-service.mjs` | `communication/emails` | snapshot、Feed、`/v1/emails`、CSV | 正文可能按需缓存；邮件高度敏感，不应默认发送给第三方 AI。 |
| `dataCatalog` | 专项本地归档服务 | `data-catalog.mjs`、calendar/fitness/selection services | `catalog/index` + school schedule fragments | snapshot、Feed、`/v1/data-catalog`、专用 endpoint | 必须读取 `source`、`parserVersion`、`capturedAt`、`complete`、`refreshState`。 |
| `sync` | `SyncService` | `sync-service.mjs` | `state/sync` | snapshot、`/v1/sync` | 不是业务事实；用于判定新鲜度、来源可用性和不确定性。 |
| `settings` | 用户明确配置，主进程白名单写入 | schema、main IPC | `state/settings` | snapshot、完整 JSON | 只应含非秘密偏好；模型 Key/密码绝不在此处。 |

## 资料库矩阵

| `dataCatalog` 集合 | 作用域 | 读写规则 | 必须保留的证据字段 | 不应包含 |
| --- | --- | --- | --- | --- |
| `collections.fitness` | 一个体测学年 `YYYY-YYYY_N` | 首次发现可归档多年度；按年切换仅读缓存；缺失或 `refresh` 时才访问学校 | `id`、`scope.yearKey`、`capturedAt`、`source`、`parserVersion`、`refreshState`、`normalized` | 原始页面、登录信息、无限制历史响应。 |
| `collections.schoolSchedule` | 一个完整教务学期 | 搜索、排序、分页在本地完整集合上进行；只在采集完成时设置 `complete: true` | `scope`、`capturedAt`、`total`、`complete`、`source`、`parserVersion`、items | 不完整服务器分页被伪装成完整课程表。 |
| `collections.academicCalendar` | 当前官方校历资产和结构化分析 | 二进制文件在 `academic-calendar/assets`；资料库仅镜像安全结构化摘要 | `assets`、`lastRefreshedAt`、`calendar`、`analysis`、错误字段、版本 | PDF 原文文本、无边界的 OCR 输出、秘密或 session。 |
| `collections.venueReservations` | MOTION 公开校区、项目、场馆和状态查询 | 只允许白名单匿名 `GET`；目录与状态成功后写入本地缓存，状态按 `detailUrl + date + venue` 键控 | `source`、`parserVersion`、`lastRefreshedAt`、目录记录、状态 `capturedAt`/`safety`/`timing` | 预约人信息、Cookie、原始 HTML、动态 slot ID、预约表单值或任何写入动作。 |

## 进程边界矩阵

| 层 | 可以做 | 不可以做 | 典型验证 |
| --- | --- | --- | --- |
| React renderer | 展示 snapshot、局部交互、订阅事件、调用 typed bridge | 直接 filesystem、学校抓取、持有 secret、直接写 store | web fallback、组件行为、订阅释放。 |
| `src/bridge.ts` | 选择桌面 bridge 或受限 web fallback | 伪造特权操作成功、另建持久状态 | desktop/web 方法签名一致。 |
| preload | 暴露枚举过的 IPC 包装 | 暴露 `ipcRenderer`、Electron session、shell、通用文件访问 | `contextIsolation` 下只存在 `window.theia`。 |
| Electron main | vault、登录窗口、文件 picker、受控 IPC、服务编排 | 将秘密推给 renderer/日志、信任原始 renderer 输入 | IPC 参数验证、vault/导出安全测试。 |
| `core/` | 解析、规范化、同步、持久化、读 API、受控工作区 | 直接渲染 UI、绕过 store、自动最终提交 | Node:test 的 service/parser/store/API 测试。 |
| 本机 API / MCP | 从当前 store 读取受控投影，API 可调用本地顾问对话 | 公开监听、直接编辑分片、越过 vault 读取 secret、学校侧写入 | schema、状态码、令牌、CORS 和导出检查。 |

## 公开读取面矩阵

| 面 | 生命周期 | 数据范围 | 适合 | 不适合 |
| --- | --- | --- | --- | --- |
| `window.theia` | 仅 Electron renderer | 受限业务操作与完整 UI 快照 | 内建 UI | 外部脚本、远程程序、绕过用户动作。 |
| loopback `/v1/*` | 应用运行时 | snapshot、Feed、集合、校历资产 | 同机工具、按需 AI 分析 | 离线长期保存、写操作、远程代理。 |
| 桌面 JSON 导出 | 用户明确操作 | 完整 `CampusState` | 个人备份、严格离线处理 | 无说明直接交给第三方。 |
| 桌面 Feed 导出 | 用户明确操作 | `theia-campus-feed/v1` | 日历/任务/本机集成 | 无损备份或所有二进制资产。 |
| 桌面 AI 导出 | 用户明确操作 | `theia-ai-context/v1` 多文件目录 | 经用户授权的 AI 学业解释、可校验离线阅读 | 实时学校状态、回写、附件归档或自动化操作。 |
| 桌面 ICS/CSV 导出 | 用户明确操作 | 特定互操作视图 | 日历、表格处理 | 完整层级语义、培养方案树。 |
| 分片磁盘存储 | 持久化状态 | 全部状态分片 | 恢复、低层维护 | 常规应用集成、手工编辑。 |
| 课程工作区 | 用户显式准备后 | 单任务题目、附件、模型结果 | 作业审核、受控模型输入 | 全局用户画像、自动最终提交。 |

## 失败、空值与结论矩阵

| 观察到的状态 | 可作出的结论 | 不可作出的结论 | 后续动作 |
| --- | --- | --- | --- |
| `sync.lastRunAt` 为 `null` | 当前状态可能从未完成过首轮同步尝试 | 用户没有任何课程/成绩/考试 | 提示同步或检查认证。 |
| `sync.lastSuccessAt` 为 `null` | 尚无整轮同步成功的记录 | 本机已有数据一定无效，或学校没有对应数据 | 结合来源时间说明不确定性，并提示重新同步。 |
| `sync.sources.<name>.authRequired === true` | 该来源需要登录 | 该来源没有数据 | 保留旧集合并请求用户恢复会话。 |
| `sync.sources.<name>.connected === false` 有 error | 最近读取失败 | 历史数据失效或用户确实没有记录 | 用旧数据标注陈旧性，避免确定性建议。 |
| collection 空数组 | 当前快照没有该集合中的项 | 校方明确返回无此类记录 | 与时间、来源状态、解析规则一起判断。 |
| `sync.domains.<d>.emptyConfirmed === true` | 最近一次成功且完整的尝试确认返回空 | 后续失败仍算成功，或现实世界永久为空 | 同时查看最近 attempt 和内容结论。 |
| `status: failed`、`emptyConfirmed: false`、`contentEmptyConfirmed: true` | 最近刷新失败，但当前保留内容此前已被成功确认空 | 本次失败重新确认了空值 | 显示旧空结论及本次失败，必要时刷新。 |
| `sync.domains.<d>` 缺失或 completeness unknown | 该领域证据合同未知，包括旧快照里的非空记录 | 记录存在即代表完整、空数组即代表确认空 | 保守降级，并在用户主动新版同步后建立水位。 |
| `fitness.refreshState === 'empty'` | 已发现该年度但未解析到测量项目 | 用户从未参加体测 | 保留年度与捕获时间。 |
| school schedule `complete !== true` | 缓存可能不完整 | 某门课不存在 | 显示不完整性并避免否定结论。 |
| workspace `state: 'model-ready'` | 本机有模型结果 | 用户已审阅/上传/提交 | 明确人工审核与最终提交仍未完成。 |
| assignment `status: 'submitted'` | 来源在同步时标记为已提交 | 所有附件/成绩均已验证 | 不再创建自动处理任务，仍保留来源证据。 |

## 变更审查清单

新增或改动任何集合前，审查者应能回答：

1. 新数据的唯一来源和合并权威是什么？
2. 原始输入在哪里被规范化？失败输入如何不覆盖旧值？
3. 分片与迁移策略是什么？是否有 digest/reload 测试？
4. 哪些读取面需要它，哪些读取面不应包含它？
5. 是否携带来源、时间、版本、作用域和刷新状态？
6. 是否可能包含密码、Cookie、token、原始页面、可重放操作或不受限二进制？
7. 用户能否理解这项数据会被导出或发送给模型？
8. 测试是否覆盖成功、空、失败、认证失效、旧值保留和敏感字段剔除？

只有上述问题有明确答案，新数据才适合进入 THEIA 的共享数据层。
