# THEIA 系统架构

## 1. 系统定位

THEIA 是一个 Windows Electron 桌面程序，服务于北京化工大学学生的日常数据整理和学习任务处理。它不是网页抓取脚本的集合，也不是将校园数据上传到第三方的 SaaS：核心设计是让校园来源的数据经本地规范化后，成为界面、CLI、loopback API、导出文件和 AI 能力共用的事实来源。

系统由四类边界清晰的部分组成：React 渲染器、Electron 主进程与预加载桥、纯 Node 业务核心，以及外部校园/邮箱/模型服务。只有主进程和核心可以访问网络、受保护的本机数据目录与加密凭据；渲染器只拿到窄化的 `window.theia` API。

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Renderer: React + TypeScript + Vite                                  │
│ App / hooks / views / layouts / styles                               │
│ 负责展示、用户交互、短生命周期 UI 状态                               │
└───────────────────────┬─────────────────────────────────────────────┘
                        │ typed bridge calls and push events
┌───────────────────────▼─────────────────────────────────────────────┐
│ Electron preload + main                                              │
│ contextBridge / IPC validation / BrowserWindow / secure vaults       │
│ 负责权限、SSO 浏览器会话、文件选择、模型调用、最终副作用             │
└───────────────────────┬─────────────────────────────────────────────┘
                        │ calls services with normalized inputs
┌───────────────────────▼─────────────────────────────────────────────┐
│ Core: ESM business modules                                           │
│ adapters / parsers / SyncService / CampusStore / local API / export  │
│ 负责抓取、解析、归并、持久化、读取接口和可测试业务逻辑               │
└─────────────┬───────────────────────────────┬───────────────────────┘
              │                               │
      ┌───────▼────────┐              ┌───────▼──────────────────┐
      │ Campus sources │              │ Local consumers          │
      │ JWGLXT/THEOL   │              │ desktop UI / CLI / HTTP  │
      │ TYGL/IMAP      │              │ exports / offline tools  │
      └────────────────┘              └──────────────────────────┘
```

## 2. 进程与信任边界

### 2.1 渲染器

目录：`src/`

渲染器运行 React 19 界面，主要由 `src/App.tsx` 装配视图，`src/hooks/useTheiaApp.ts` 管理状态加载、订阅和用户动作。它可以调用 `src/bridge.ts` 中的 `TheiaBridge`，但不应直接：

- 读取 `%APPDATA%`、工作区、校历文件或任何任意磁盘路径；
- 用 `fetch` 直接抓学校系统页面、注入 Cookie 或解析校方 HTML；
- 获取密码、邮箱授权码、模型 API Key 或 Chromium session；
- 自行写入 `CampusState`、`theia-feed.json` 或分片存储；
- 使用通用 shell、任意 URL 打开或任意文件系统 IPC。

在浏览器预览模式下，`src/bridge.ts` 提供 demo/空状态 fallback，以保持组件可开发；敏感或写入性的桌面能力必须明确提示“仅桌面客户端可用”。这个 fallback 不能演变成另一个数据存储或抓取实现。

### 2.2 Preload 与 IPC

目录：`electron/preload.cjs`、`electron/main.mjs`、`src/types.ts`

Electron 使用 `contextIsolation: true`、`nodeIntegration: false` 和 renderer sandbox。preload 通过 `contextBridge.exposeInMainWorld('theia', api)` 暴露经过枚举的函数，同时保留 `window.buct` 作为历史兼容别名。`src/types.ts` 内的 `TheiaBridge` 是 TypeScript 一侧的统一契约。

IPC 负责把少量明确业务动作传给主进程，例如：读快照、登录、同步、准备作业工作区、刷新邮箱、导出、更新允许的设置、选课任务控制和外观偏好。主进程必须再次规范化 renderer 传入的数据，不将 renderer 传来的路径、URL、标识符或选项直接当作可信输入。

### 2.3 主进程

目录：`electron/`

主进程是特权操作唯一入口：

- 创建和维护主窗口、登录窗口、提交/查看窗口及相应的 Chromium session；
- 保存学校认证、教务 API、邮箱与模型服务凭据至 Electron `safeStorage` / Windows DPAPI；
- 调度 `SyncService`、`CourseWorkService`、`ModelService`、邮箱服务、校历资产服务和课程选择服务；
- 启动和停止 loopback API；
- 通过 `sendSnapshot()`、认证状态与同步进度事件把只读状态推回渲染器；
- 限制校方来源 URL、文件 picker 和最终提交动作。

主进程并不拥有另一套业务事实模型。它应调用 `core/` 服务，再通过 `CampusStore` 读写规范化状态。

### 2.4 Core 业务层

目录：`core/`

核心模块使用原生 ESM，尽量不依赖 Electron API，便于用 Node 的测试运行器直接验证。职责划分如下：


| 模块或模块组        | 负责什么                                   | 不应负责什么                     |
| ------------------- | ------------------------------------------ | -------------------------------- |
| `adapters/`         | 调用某个校园来源并协调该来源的解析         | 渲染器状态、直接落盘、界面文案。 |
| `parsers/`          | 将 HTML/JSON 转为稳定的普通对象            | 网络重试、凭据、UI。             |
| `source-client.mjs` | 已认证请求、字符集、登录页识别和安全错误   | 业务集合的持久化。               |
| `sync-service.mjs`  | 多来源同步、去重、进度、失败保留旧数据     | 页面渲染、任意直接文件写。       |
| `schema.mjs`        | 默认值、迁移规范化、Feed、CSV、ICS         | 访问学校网络或浏览器 session。   |
| `store.mjs`         | 不可变分片、清单、摘要、恢复、订阅         | 解析校方页面或掌管凭据。         |
| `domain-provenance.mjs` | 来源 outcome、领域水位、派生领域与内容摘要 | 根据展示数组猜测同步成功。       |
| `advisor/`          | 无模型 DataQuality、Evidence、LocalClaim、Risk 与 Agenda | 网络、磁盘、Electron 或模型调用。 |
| `local-api.mjs`     | 只读 loopback 路由和响应包装               | 写接口、公共监听或远程转发。     |
| `course-work.mjs`   | 受控作业工作区、附件、答案导入与结果元数据 | 最终提交学校页面。               |
| `data-catalog.mjs`  | 非标准/历史资料的规则化归档                | 在 renderer 内缓存同类数据。     |

## 3. 来源和数据所有权

一个集合只能有一个清晰的归并权威，避免两个来源互相用空数组覆盖：


| 来源                | 主集合                                                     | 特性                                                                                                                                                 |
| ------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| JWGLXT 教务         | 个人资料、学期、课程、课表、成绩、考试、已选课程、学业进度，以及按需读取的 5 个只读扩展域 | 默认经统一认证浏览器通道获取；启用且配置了独立教务 API 时优先用 API。API 或浏览器读取失败时，结果先归一化再按域回退，空值不能覆盖有效本地数据。扩展域覆盖当前专业的一份培养计划 PDF、毕业审核、成绩明细、考试附加和空闲教室；学业预警与毕业设计不进入数据层，档案与事务、按周课表、教务全校课表等重复页面也不进入 `academicExtras`。默认不加入快速同步。 |
| 北化在线THEOL       | 课程、作业、在线测试、通知                                 | 已过期任务从可处理流程中过滤；保留来源 URL。                                                                                                         |
| TYGL 健康云         | `dataCatalog.collections.fitness`                          | 体测年度一次归档，后续年份切换应走本地缓存。                                                                                                         |
| IMAP 校园邮箱       | `emails`                                                   | 初始轮询仅取元数据；正文与附件按需读取。                                                                                                             |
| 教务处官方校历      | `dataCatalog.collections.academicCalendar`                 | 二进制资产独立保管，安全结构化摘要进入资料库。                                                                                                       |
| 选课 API / 教务会话 | 选课候选、短生命周期作业与审计 journal                     | 选择请求受用户明确目标约束，不能自动重放 POST。                                                                                                      |

某个来源暂时认证失效、返回结构变化或网络不可达时，`SyncService` 把安全摘要写入 `sync.sources` 和活动日志，但必须保留先前已验证的数据集合。把“未同步”当成“没有课程/成绩/作业”会造成严重的错误建议和误导性导出。

## 4. 核心数据流

```text
校园页面 / API / IMAP
  -> SessionClient 或独立受控 client
  -> adapter
  -> parser + normalization
  -> SyncService partial result
  -> mergeSyncResult / CampusStore.update or replace
  -> immutable fragments + data/manifest.json
  -> CampusStore subscribers
  -> atomic theia-feed.json
  -> renderer snapshot / local API / CLI / explicit export / AI package
```

关键点：

1. `CampusState` 是桌面 UI、CLI、loopback API 和 AI 顾问共用的业务事实来源；AI 包在此快照上额外施加净化、领域拆分和文件级完整性校验。
2. 原始 HTML、Cookie、密码、授权码、模型 Key 和浏览器 session 从该管线剔除。
3. 持久化先落分片与清单；Feed 是派生兼容导出，不能被反向编辑当作数据库。
4. 普通界面读取可用 `store.snapshot()`；顾问必须一次读取 `store.snapshotWithRevision()`，使 `state`、`revision`、`committedAt` 与 `domainDigests` 来自同一已提交 manifest。消费者不能依靠修改返回引用改变应用状态。
5. 每次成功落盘会让 store 订阅者收到新快照；主进程负责广播给 UI。

领域证据随同业务内容在同一次 `CampusStore.update()` 中提交。`emptyConfirmed` 只描述最近一次成功且完整的尝试是否为空；`contentEmptyConfirmed` 描述当前保留内容是否已有成功来源确认过为空。因此，确认空之后刷新失败可以同时是 `status: failed`、`emptyConfirmed: false`、`contentEmptyConfirmed: true`。`academic`、`coursework` 与 `local-data-catalog` 是派生领域：完整性取所有必要依赖的最弱值，水位仅在每个必要依赖都有合法时间时取其中最早值，否则为 `null`。

关于存储和导出细节见 [数据生命周期](data-lifecycle.md)，关于每个字段见 [数据模型参考](reference/data-model.md)。

## 5. 同步生命周期

应用启动先加载本地快照和持久化服务；校历首次刷新在顾问 runtime 和主窗口暴露前完成，失败时保留上一份成功资产并记录可见诊断。之后 UI 读取认证状态、API 地址、加密凭据状态、模型状态、选课状态与本地缓存。该首轮运行时探测完成后，渲染器发送 `theia:initialization-complete` 事件。~~外观层用它决定“北化风情”应按当前节气切换哪个内置湖景~~，不把网络探测结果混入业务数据。

用户手动触发同步或启用后台同步后，`SyncService`：

1. 生成本次同步标识和开始时间；
2. 按适配器策略并发读取教务高优先领域，同时让北化在线THEOL首页与教务主同步并行启动；
3. 为每个可见阶段推送 `sync-progress`；
4. 每个已完成来源单独提交，确保慢来源不会遮住已刷新课表；
5. 把连接状态、认证要求和可安全显示的错误摘要写回 `sync.sources`；
6. 出现认证要求时触发统一认证恢复路径；
7. 持久化、更新 Feed 并对外发布主同步的新 snapshot；
8. 主同步完成后静默调度北化在线THEOL逐课程 `Course task` 扫描；它与其他 THEOL 操作共用独占队列，并在适配器内部逐课程严格串行，不延长主同步的可见完成阶段。

后台自动同步最短五分钟，避免无节制地请求学校系统。它只在桌面应用运行时生效，不是云端定时任务。

## 6. 顾问底座与作业模型工作流

`core/advisor/` 是不调用模型的确定性底座；`electron/advisor-overview-service.mjs` 从一次冻结快照和一次显式时钟采样生成 `theia-advisor-overview/v1`。一个 overview 实例由 `{snapshotRevision, evaluatedAt, timeZone, rulesVersion}` 共同界定，消费者必须整体替换实例，不能按稳定 claim ID 把不同评估时刻的倒计时值拼在一起。

`electron/model-service.mjs` 仍是作业/摘要生成路径，不与顾问混用。当前顾问由 `electron/advisor-runtime.mjs` 装配：它绑定一次版本化快照，创建有界惰性工作区，强制模型走流式 Agent 工具，并在每轮按需读取或执行已声明的能力。工具结果、邮箱正文和本机文档均经过独立的来源/不可信文本投影；默认权限是 `read-only`，用户可显式切换到 `full-access`。即使在 full-access 下也不等于原始文件系统、保存凭据、Cookie、Shell 或通用 IPC。同步、公开 HTTPS、校园页面、THEIA 设置和已保存目标选课操作只有对应 typed tool 存在时才可用。历史 P4/P5 文档保留作设计记录，当前入口以 `docs/ai/20-a-b-c-advisor-agent-sidecar.md`、`core/advisor/lazy-workspace.mjs` 和 `core/advisor/read-only-agent.mjs` 为准。

JWGLXT 的扩展页面通过 `academicExtras` 进入同一 `CampusState`，但只在用户明确刷新某个扩展域（或显式请求完整扩展刷新）时读取；流程页只解析已显示的申请/审核状态，永远不提交、确认、上传、删除或调用其它学校侧写入动作。顾问使用 `snapshotWithRevision({ clone: false })` 绑定一次已提交的版本化快照，并在惰性工具调用时按域、按记录生成有界投影，不再为整份 `CampusState` 创建额外深冻结副本；这样保持 revision 一致性的同时减少大数据集的复制和首轮延迟。

课程任务处理由受控工作区串联：

```text
已同步 assignment
  -> 用户选择“准备工作区”
  -> 获取任务页、下载附件、抽取可读文字
  -> course-work/<assignment-id>/manifest.json + task.md + templates
  -> 可选：模型服务生成 Markdown 或 answers.json
  -> 用户查看文件 / 在内置浏览器填写
  -> 用户在校方页面执行最终提交
```

模型服务只在 Electron 主进程中调用 OpenAI-compatible `/v1/models` 与 `/v1/responses`。它读取已准备的任务内容、题目和受限长度的附件文本，不接触学校密码、Cookie、浏览器存储或认证页面。在线测试答案在写入页面前经过现有答案结构验证。模型输出是待审核结果，不是学校提交行为的授权。

## 7. 本机接口与外部消费者

当桌面应用运行时，`core/local-api.mjs` 在 `127.0.0.1` 默认端口 `8765`（端口占用时在小范围内回退）监听。实际地址写入数据根的 `api-runtime.json`。它只接受读取方法，且 CORS 仅回显受限的本机/`theia:` origin。

可选输出层从同一 `CampusStore` 快照生成：

- 界面“完整 JSON”和 CLI `export --format json`：完整 `CampusState`；
- 界面 “THEIA Data Feed”、CLI `--format theia`、`/v1/feed`：`theia-campus-feed/v1`；
- 界面“导出给 AI”和 CLI `--format ai`：`theia-ai-context/v1` 多文件快照，额外提供字段词典、SHA-256 manifest 与路径/凭据净化；
- `--format ics` 与 `/v1/calendar.ics`：考试与作业日历；
- `--format csv` 和集合 CSV endpoint：扁平集合表；
- `GET /v1/academic-analysis`：从同一冻结快照生成的 `theia-academic-analysis/v1` 学业分析 DTO，区分成绩尝试、代表课程、官方/计算 GPA、一次性学分结算和 `and/or` 要求；
- `GET /v1/snapshot`：运行时完整快照。

这些输出的安全性来自于状态模型不含凭据，而不是因为数据本身不敏感。个人资料、成绩、邮件正文、任务题目、来源 URL 和本机工作区路径仍可能是高度私密的数据。

## 8. 安全模型

### 被允许的数据

- 规范化后的课程、课表、考试、成绩、培养方案、已选课程、作业、通知；
- 邮箱元数据与按需缓存的正文；
- 用户主动保存的工作区元数据和输出路径；
- 资料库中可追溯的体测、校历和全校课表缓存；
- 设置中不属于秘密的信息，例如同步间隔、端口、模型服务 URL 和模型名称。

### 永远禁止进入 CampusState、Feed、API 和导出的数据

- 统一认证、教务 API、邮箱和模型服务的密码、授权码、API Key；
- Cookie、session token、localStorage、浏览器用户数据目录；
- 校方原始 HTML、原始 API 响应、认证页面和可重放请求参数；
- 用于重放选课 POST 的 `operationId` 等敏感操作字段；
- 未受控的任意本机文件内容和二进制邮箱附件。

### 最终操作的边界

THEIA 能辅助进入学校页面、附加文件、填充经过验证的答案或执行明确启动的选课任务。对课程作业和在线测试，用户仍必须审阅并亲自在原系统完成最终提交。新增自动化不得绕过该人为确认边界。

## 9. 关键扩展原则

新增一个数据来源或功能，不是只加一个界面：它必须定义来源所有权、输入规范化、持久化位置、导出可见性、来源/时间/错误的可追溯字段、安全边界、IPC/CLI/API 暴露与对应测试。推荐的完整路径是：

1. 在 `core/` 定义解析/服务与失败语义；
2. 在 `core/schema.mjs` 定义默认值和规范化；
3. 在 `core/store.mjs` 加入合适的分片映射；
4. 决定是否进入 Feed、loopback API、CSV/ICS 或已净化的专用 AI 包；
5. 通过主进程 IPC 和 typed bridge 暴露最小必要动作；
6. 在 renderer 中实现界面，而不复制业务状态；
7. 添加 parser、store、接口及安全测试；
8. 更新本目录文档与 `docs/ai/` 中最靠近的专门文档。
