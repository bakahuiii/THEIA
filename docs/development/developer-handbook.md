# THEIA 开发者手册

本文面向需要独立定位、修改、测试和交接 THEIA 的开发者。它补充而不替代专题文档：接口字段以源码、测试和 [API/IPC 参考](../reference/api-and-ipc.md) 为准；持久化细节以 [数据生命周期](data-lifecycle.md) 和 [数据模型](../reference/data-model.md) 为准；顾问 Agent 以 [Agent 侧车说明](../ai/20-a-b-c-advisor-agent-sidecar.md) 为准。

THEIA 正在进入更开放的共享维护阶段。本文不是要求每个人记住所有历史，而是让一个不了解背景的新开发者知道：代码在哪里、谁拥有数据、哪些失败不能被隐藏、哪些能力不能随意开放，以及完成一项改动需要留下什么证据。

## 0. 核心心智模型

THEIA 可以被理解为四个连续阶段：

~~~text
官方来源 / 用户本地输入
        |
        v
来源客户端 -> parser / adapter -> 规范化业务模型
                                  |
                                  v
                         CampusStore / provenance
                                  |
           +--------------------+--------------------+
           |                    |                    |
           v                    v                    v
       renderer             loopback API          export / MCP / Agent
~~~

最重要的约束是：

1. **来源不等于事实。** 原始页面需要经过来源识别、解析、规范化和完整性判断。
2. **空不等于没有。** 空数组可能表示首次启动、确认空、失败后的 fallback 或解析没有得到内容。
3. **当前快照不等于实时学校状态。** 本地结果必须带时间、来源和质量语义。
4. **界面不拥有业务数据。** renderer 展示快照并发起明确动作，不能自行抓取或另建业务缓存。
5. **Agent 不拥有权限。** Agent 只能使用主进程提供的显式工具；工具返回的数据还要经过投影、引用和审计。
6. **构建成功不等于发布完成。** 发布还包括实际产物、用户数据升级、桌面运行和隐私检查。

## 1. 第一次上手

### 1.1 环境

- Windows；
- Node.js `>=22.12.0`；
- npm `>=10.0.0`；
- 依赖版本以 `package-lock.json` 和 `package.json` 为准；
- 校历 OCR 使用随应用打包的 Tesseract.js、WASM core 和离线简体中文模型，不依赖系统 Python 或运行时 CDN 下载。

安装依赖：

~~~powershell
Set-Location <THEIA 源码目录>
npm install
~~~

开发时使用独立数据根：

~~~powershell
$env:THEIA_DATA_ROOT = 'H:/temp/theia-dev-data'
npm run dev
~~~

`THEIA_DATA_ROOT` 是隔离边界。不要把真实 `%APPDATA%/THEIA`、浏览器 Cookie、已有认证资料或完整个人快照复制进测试目录。

### 1.2 当前命令

| 命令 | 用途 | 限制或副作用 |
| --- | --- | --- |
| `npm run dev` | Electron + Vite 桌面开发模式 | 才能真实覆盖主进程、preload、vault、文件选择器和本机 API |
| `npm run dev:web` | 浏览器前端预览 | 不等价于 Electron，不提供真实登录、安全存储、文件选择器或主进程能力 |
| `npm test` | Node 原生测试套件 | 使用项目当前的并发设置 |
| `npm run lint` | ESLint | 静态质量检查 |
| `npm run typecheck` | TypeScript project build 检查 | 不产生发布文件 |
| `npm run check` | 按顺序运行 test、lint、typecheck | 日常提交的快速门槛 |
| `npm run build` | 生成校园网格并执行 TypeScript/Vite 构建 | 产生 `dist/` 和增量构建文件 |
| `npm run clean:generated` | 清理可重建输出和根目录 `.tmp-*` | 不处理 `node_modules/`、`.references/`、`local-docs/` 或用户数据 |
| `npm run benchmark:advisor` | 顾问本地合成数据性能基线 | 不连接学校或模型服务 |
| `npm run visual:advisor` | 顾问界面视觉检查辅助 | 只在需要验证顾问 UI 时使用 |
| `npm run dist:unpacked` | Windows 未安装目录包 | 会写入 `release-bin/` |
| `npm run dist:source` | 白名单源码 ZIP | 会写入源码归档 |
| `npm run smoke:packaged` | 已打包桌面程序 smoke | 需要先生成 `THEIA.exe` |
| `npm run dist:installer` | 正式安装器发布流程 | 会检查干净工作树并执行远程发布相关操作，禁止随意运行 |

日常行为变更的推荐顺序：

~~~powershell
npm run check
npm run build
git diff --check
~~~

涉及 Electron、认证、导出、学校侧操作或打包的改动，还要做对应的桌面 smoke 和失败路径验证。浏览器预览能打开、TypeScript 能编译或单个 HTTP 请求返回 200，都不能单独证明功能完成。

## 2. 运行时架构

### 2.1 Renderer：`src/`

Renderer 是 React 19 + TypeScript + Vite 应用，负责页面、布局、短生命周期 UI 状态和用户交互。它只能通过 `window.theia` 调用已声明的方法和订阅事件，不能直接访问：

- Node.js `fs`、子进程或任意本机目录；
- Electron session、Cookie、safeStorage 或凭据 vault；
- 校园站点、邮箱、模型服务或任意网络；
- `core/` 的 store 实例和实际数据文件。

浏览器预览通过 `src/bridge.ts` 的 fallback 工作。fallback 让纯前端页面可以预览，不是模拟桌面权限。桌面专属动作应返回明确的不支持错误，不得返回看似成功的假数据。

### 2.2 Main + preload：`electron/`

主进程是权限和生命周期边界，负责：

- BrowserWindow、应用启动与退出；
- trusted IPC sender 和参数校验；
- `persist:theia`、`persist:theia-mail` 等隔离的浏览器会话；
- Electron `safeStorage` / Windows DPAPI 凭据保存；
- 文件选择器、受控外部页面打开和本机 API 生命周期；
- 模型服务、顾问 Agent、同步编排和最终副作用。

`electron/preload.cjs` 只暴露窄化 API。`electron/ipc-registration.mjs` 按功能注册 handlers；`electron/main.mjs` 和各 runtime module 负责组装服务。新增能力必须先说明它为什么需要主进程、输入如何校验、结果如何脱敏、失败如何序列化。

### 2.3 Core：`core/`

Core 是 ESM 业务模块，尽量不依赖 Electron，因此可以直接由 Node 测试。它负责：

- 来源响应解析和规范化；
- 数据同步和失败合并；
- `CampusState` schema、存储和迁移；
- provenance、freshness、完整性和派生分析；
- loopback API、Feed、CSV/ICS 和 AI 投影；
- 作业工作区、资料目录和选课 journal。

Core 可以接收由主进程创建的受控 client，但不应自己读取 Electron vault、浏览器 session 或 renderer 状态。

### 2.4 一个典型调用

以刷新课表为例，完整链路应是：

~~~text
ScheduleView / hook
  -> window.theia.syncNow()
  -> src/bridge.ts
  -> preload 的受限 IPC 包装
  -> main 的 sync handler
  -> SyncOrchestrator / SyncService
  -> JWGLXT adapter + parser
  -> sync merge / CampusStore
  -> 新 revision 和 sync progress
  -> renderer 订阅新 snapshot
~~~

parser 不能直接更新界面，界面不能直接读取来源响应，handler 不能跳过 core 的规范化。若某一步失败，结果应沿链路传递可解释的失败信息，并保留旧的确认数据。

### 2.5 启动顺序

主进程启动大致包括：

1. 解析应用根目录、数据根和运行时环境；
2. 初始化 `CampusStore`，验证主/备份清单和分片；
3. 恢复中断同步标记，必要时安全修复；
4. 创建附件、资料目录、校历和选课 journal 等服务；
5. 创建认证、来源、同步、顾问、邮箱、模型和本机 API runtime；
6. 注册 IPC 和本地协议；
7. 创建 BrowserWindow、加载 renderer、发送首个可用快照；
8. 后台刷新不阻塞首屏的静态资料，例如校历资产。

具体编排分散在 `electron/main.mjs`、`electron/service-foundation.mjs`、`electron/service-domain-runtime.mjs` 和 `electron/service-integration-runtime.mjs`。修改启动过程时同时考虑退出、重启、已有数据和多个并发窗口。

## 3. 代码地图

### 3.1 Renderer

| 路径 | 作用 |
| --- | --- |
| `src/App.tsx` | 页面装配和主界面入口 |
| `src/hooks/useTheiaApp.ts` | 初始快照、订阅、同步和运行时状态协调 |
| `src/bridge.ts` | 桌面 bridge 与 web fallback 的统一调用面 |
| `src/types.ts` | `CampusState`、bridge 方法和共享类型 |
| `src/layout/` | 标题栏、侧栏和工作区框架 |
| `src/views/` | 业务页面和设置页面 |
| `src/components/` | 复用视图、表格、弹窗和顾问工作台 |
| `src/lib/` | renderer 侧纯逻辑和格式化 |
| `src/styles.css` | 全局 token、布局和视觉系统 |
| `src/map/` | 地图、楼层和路径逻辑 |

修改页面时先找到已有数据来源和 bridge 方法，再决定是否需要新契约。不要在 view 中添加第二份校园数据解析器。

### 3.2 Core

| 路径 | 作用 |
| --- | --- |
| `core/schema.mjs` | `emptyState`、`normalizeState`、状态默认值和旧形状迁移 |
| `core/store.mjs` | manifest、不可变分片、原子写入、备份和恢复 |
| `core/sync-service.mjs` | 来源同步、域结果和合并入口 |
| `core/sync-merge.mjs` | 失败、确认空、旧值保留和来源状态合并 |
| `core/sync-helpers.mjs` | outcome、错误和来源状态辅助逻辑 |
| `core/domain-provenance.mjs` | 集合水位、来源、完整性和 digest |
| `core/adapters/` | JWGLXT、THEOL 及其它来源的访问实现 |
| `core/parsers/` | HTML、JSON、PDF 或来源特定结构解析 |
| `core/local-api.mjs` | loopback HTTP server 和路由契约 |
| `core/data-output-contract.mjs` | renderer/API/导出可见字段的投影 |
| `core/ai-export*.mjs` | AI 离线导出、manifest、哈希和敏感字段剔除 |
| `core/course-work*.mjs` | 作业工作区、工作包和本地队列 |
| `core/course-selection*.mjs` | 选课目标、窗口、服务、journal 和学校请求 |
| `core/data-catalog.mjs` | 体测、校历、全校课表、公开场馆等资料库 |
| `core/advisor/` | Agent 工具边界、惰性工作区、引用和确定性分析 |

### 3.3 Electron

| 路径/前缀 | 作用 |
| --- | --- |
| `electron/main.mjs` | 应用生命周期、窗口、协议和顶层组装 |
| `electron/preload.cjs` | renderer 可见的 context bridge |
| `electron/ipc-registration.mjs` | 各业务 handler 注册 |
| `electron/ipc-security*.mjs` | trusted sender、参数和安全验证 |
| `electron/*-vault.mjs` | 凭据、邮箱、模型和教务 API 秘密存储 |
| `electron/auth-*.mjs` | 认证 actor、登录窗口、状态和恢复 |
| `electron/sync-*.mjs` | 同步 IPC、编排和进度事件 |
| `electron/advisor-*.mjs` | 顾问线程、请求准备、流式回答和动作服务 |
| `electron/model-*.mjs` | 模型配置、协议、URL、网络和请求上限 |
| `electron/source-*.mjs` | 校园来源页面/窗口和受控打开 |
| `electron/local-api-handlers.mjs` | loopback API 的 Electron 侧 handler |
| `electron/iris-*.mjs` | 可选的本地 QQ 伴侣 |
| `electron/github-update-runtime.mjs` | 打包版更新检查和下载提供方 |

## 4. 数据模型、存储与恢复

### 4.1 `CampusState` 不是原始数据库

`CampusState` 是规范化、可投影的本机业务快照。常见领域包括：

~~~text
profile
terms
courses
schedule
exams
grades
selectedCourses
academicProgress
academicExtras
academicPlanDocument
assignments
workspaces
notices
emails
dataCatalog
sync
settings
~~~

具体字段以 `core/schema.mjs`、`src/types.ts` 和 [数据模型参考](../reference/data-model.md) 为准。新增字段时必须有默认值，并能从旧快照安全加载。学校来源数据应尽可能保留 `source`、`capturedAt`、`updatedAt`、`complete`、`parserVersion` 或等价的 provenance 证据。

### 4.2 当前分片存储

`CampusStore` 将状态拆为可验证的片段，并以 `data/manifest.json` 描述 schema、片段引用、digest 和版本。典型片段包括：

~~~text
state/meta
state/profile
state/settings
state/sync
academic/terms
academic/courses
academic/schedule
academic/exams
academic/grades
academic/selected-courses
academic/progress
academic/extras
academic/plan-document
coursework/assignments
coursework/workspaces
communication/notices
communication/emails
catalog/index
catalog/school-schedule/<term-id>
~~~

分片的价值是让局部更新、digest、备份和恢复有边界。业务模块不得直接拼接分片路径或直接改 JSON；应使用 store 的规范接口，让写入具备锁、临时文件、原子替换、备份和规范化。

### 4.3 修改 schema 的步骤

1. 在 `emptyState()` 添加安全默认值。
2. 在 `normalizeState()` 处理旧形状、类型、数量和字符串长度上限。
3. 决定它属于哪个分片；新增分片要考虑旧版本缺少该分片的情况。
4. 检查 `CampusStore` 的 `stateFragments()`、`mergeFragments()`、必需/可选片段和动态片段逻辑。
5. 检查完整快照、renderer snapshot、Feed、API、CSV/ICS、AI export 是否应该看到该字段。
6. 为旧快照、非法输入、崩溃恢复、更新后 reload 添加测试。
7. 只在实际不再兼容时升级 schema 标识；否则优先提供向后兼容 normalize。
8. 不在迁移时删除 `buct-data.json`、`.bak`、旧片段、校历资产、工作区或 journal。

### 4.4 失败同步的正确语义

同步合并时要区分：

| 状态 | 是否替换旧集合 | 可对用户表达 |
| --- | --- | --- |
| 成功且有内容 | 是 | 来源已更新，当前有内容 |
| 成功且 provenance 完整地确认空 | 是 | 来源确认当前为空 |
| 部分成功 | 仅替换成功域 | 某些域已更新，其它域保留上次有效内容 |
| 网络/认证/解析失败 | 否 | 本次未更新，继续使用上次有效内容 |
| 首次同步失败 | 否 | 尚无可用本地数据，不能说学校没有数据 |
| 旧快照无水位 | 不改成 fresh | freshness/completeness 为 unknown |

尤其不能用顶层 `updatedAt` 推导某个域最近成功时间，也不能用记录自己的时间代替本轮来源 outcome。顾问、API 和 UI 都必须消费同一套质量语义。

## 5. 来源适配器与认证

### 5.1 来源职责

新增来源时明确四层职责：

~~~text
controlled client / session
  -> adapter: 请求顺序、认证、来源级回退、错误分类
  -> parser: 结构解析和字段转换
  -> sync merge: provenance、旧值保留、snapshot revision
~~~

parser 应尽量是纯的、低副作用的，可用 fixture 直接测试。adapter 负责来源变化，但不应把 raw HTML 透传给 UI。同步服务负责一个来源失败时不破坏其它来源的结果。

### 5.2 认证通道隔离

THEIA 至少存在两类教务通道：

1. 统一身份认证浏览器通道，使用 Electron 的校园 SSO session；
2. 可选的教务 API 通道，使用独立加密凭据和仅驻内存 cookie jar。

两者不能混用 Cookie，也不能把 API cookie jar 写入磁盘或复制进浏览器 session。API 优先和浏览器回退的规则必须保持来源域级别：一个域失败不应把其它已经成功的域标成失败；主页认证失败尚未真正请求下游域时，不能把每个下游域都报告成独立失败。

登录成功必须依据已认证页面的实际状态判断，不能只看 URL、HTTP 200 或页面标题。认证诊断可以记录脱敏 host/path、阶段、状态码和错误码，但不能记录 query、Cookie、密码、页面正文、邮件内容或 API Key。

### 5.3 官方来源和公开来源

校园请求只能访问官方 `*.buct.edu.cn` 服务，并经过现有 URL policy。MOTION 场馆目录/状态是公开、只读的 GET 集成：不能附带个人凭据、Cookie、预约表单值或动态写入字段。新增公开来源也必须明确 anonymous/public、GET-only 和缓存 provenance。

### 5.4 PDF、OCR 与离线资源

校历、培养计划等文档存在二进制、PDF 文本、OCR、结构化分析和缓存多个层次。不要把 OCR 结果当成官方结构化事实；保留资产来源、采集时间、解析器版本、完整性和错误状态。打包后 OCR 依赖应用内的 Tesseract.js、WASM core 和随包简体中文模型，不应依赖系统 Python 或运行时 CDN 下载。

## 6. 跨进程功能开发

### 6.1 先设计契约

新增功能前写出最小契约：

- 输入有哪些字段，哪些是枚举、数量、长度、URL 或路径；
- 主进程如何校验和规范化；
- 结果是数据、状态、事件还是错误；
- 是否会触发 snapshot revision、持久化或外部副作用；
- web fallback 如何表现；
- 失败是否可重试，是否会重放学校侧请求；
- 需要向 renderer/API/Agent 暴露哪些最小字段。

### 6.2 同步更新的文件面

一个典型 Electron 能力至少需要检查：

~~~text
core service/parser
  -> electron handler / runtime
  -> electron/preload.cjs
  -> src/types.ts
  -> src/bridge.ts desktop + web fallback
  -> renderer view/hook
  -> tests
  -> relevant docs
~~~

只改其中一个文件通常会产生“桌面能调用但类型不对”“web 预览假成功”“IPC 未校验”“UI 没有错误状态”等不完整结果。

### 6.3 参数验证清单

主进程和 API 边界至少检查：

- 参数是否是预期 primitive/object，拒绝数组冒充对象；
- 字符串长度、集合数量、嵌套深度和请求体大小；
- ID、域名、路径、日期、枚举和布尔值；
- URL 是否通过来源或模型 URL policy；
- 文件路径是否由用户选择器或明确目录 policy 产生；
- 调用方 sender 是否是可信的 THEIA 主窗口；
- 本次动作是否需要用户确认或显式 ticket；
- 错误返回是否去掉原始响应、秘密和绝对路径。

禁止新增下面这种泛化入口：

~~~text
run(command)
read(path)
fetch(url)
sendToSchool(payload)
~~~

必须拆成业务语义明确、范围固定、可审计的能力。

## 7. 本机 API、Feed、导出和 MCP

### 7.1 loopback API

本机 API 由 `core/local-api.mjs` 提供，桌面启动时写出当前数据根的 `api-runtime.json`。消费者必须读取该文件发现本次运行的 `baseUrl`、端口和令牌；默认端口不是稳定身份，令牌也不能硬编码。

API 的基本不变量：

- 只监听 `127.0.0.1`；
- 请求需要运行时令牌和精确的 `Host: 127.0.0.1:<port>`；
- 读取集合使用受控 GET/HEAD；
- `POST /v1/sync` 只接受明确的数据域并调用本地同步器；
- `POST /v1/agent/chat` 只调用已配置的本地顾问；
- 课程抓取不经过模型接口；
- 未知路由、错误方法、错误 Host、错误令牌和超大请求应明确失败；
- 响应不能包含密码、Cookie、API Key、浏览器 session、原始认证 HTML、绝对路径或可重放学校请求字段。

完整 endpoint 和响应 envelope 见 [API/IPC 参考](../reference/api-and-ipc.md)，不要在本手册中复制每个字段。

### 7.2 Feed 和导出

Feed、完整 JSON、CSV、ICS 和 AI 包是不同的投影：

- Feed 适合本机工具获得综合上下文，不是数据库；
- 完整 JSON 最接近业务快照，可能包含敏感个人业务数据，但不应包含秘密；
- CSV 是扁平交换视图，不是嵌套状态的无损备份；
- ICS 只表达适合日历的事件，不是完整课表和成绩备份；
- AI 包是经过净化的静态阅读包，不是实时会话，也不能写回学校系统。

修改字段时不要默认把它加入所有投影。逐个评估 privacy、体积、稳定性、来源证据和消费者预期。AI 包还必须维护 manifest 文件数量、UTF-8 字节数和 SHA-256，临时目录完成后再原子改名，不能覆盖旧导出。

### 7.3 MCP

`integration/theia-mcp.mjs` 和 `integration/theia-client.mjs` 是本机外部工具的只读入口。MCP 只提供受限的数据健康、记录搜索、截止事项、学业分析、课程分析、单封邮件正文和用户明确放入资料目录的文档读取。

新增 MCP 工具前问三个问题：

1. 该信息是否已经有明确 API/Feed/AI 投影，而不是直接读内部文件？
2. 是否会泄露比任务所需更多的个人数据或邮件内容？
3. 是否会让外部工具触发学校侧写入、任意网络或任意本机文件操作？

任何一个问题回答不清楚，都先不要加工具。

## 8. 顾问 Agent

THEIA Advisor 是用户触发的 bounded academic Agent，不是让模型获得整个桌面权限。它的基本流程是：

~~~text
用户问题
  -> 主进程冻结 snapshot revision
  -> 生成 overview 和惰性数据工作区
  -> 模型收到问题、revision 和工具边界
  -> 模型按需请求白名单工具
  -> 主进程投影数据并登记 evidence/claim/reference
  -> 流式闸门只把最终普通文本传给 renderer
  -> 回答和 usage 按线程保存
~~~

标准 Agent 初始 prompt 不应包含全量成绩、课程、课表、作业、通知、邮件或体测。模型需要事实时，通过工具读取有限切片；邮件正文必须先检索到对应邮件，再按需读取。Agent 不得接收浏览器 Cookie、解密凭据、API Key、任意文件系统或未声明的校园写入权限。

### 8.1 Advisor 改动检查

- 是否固定并传递 `snapshotRevision`、`evaluatedAt`、时区和规则版本？
- 工具是否有参数白名单、次数上限、结果大小上限和取消路径？
- 失败是否被如实返回，还是生成了本地伪答案？
- 证据、claim、reference 是否闭合，数字是否与当前 revision 一致？
- 同一 claim ID 在不同评估实例中是否被错误合并？
- 普通文本和内部 tool-call JSON 是否被正确分流？
- provider 的流式错误、incomplete、取消和 usage 是否被保留？
- full-access 是否真的由用户显式开启，并且没有改变 read-only 会话的安全语义？

Advisor 单测集中在 `tests/advisor-*.test.mjs`、`tests/agent-tools.test.mjs`、`tests/model-service.test.mjs` 和 `tests/ai-export.test.mjs` 附近。涉及高风险学校决定时，优先验证阻断条件、引用和用户确认，而不是只看模型回答文字。

## 9. 高风险学校侧操作

### 9.1 选课

选课的读取、目标配置、控制任务和学校 POST 必须分开理解：

- 读取可以使用认证恢复和页面探测；
- 目标只能来自用户明确选择并保存的目标；
- 控制任务必须有开始/停止、窗口、限速和 journal；
- 选课 POST 不能因为超时或认证失败自动重放；
- journal 和日志不能保存完整可重放的敏感操作字段；
- 诊断失败时不能为了确认而重新提交学校请求。

相关实现位于 `core/course-selection*.mjs`、`electron/ipc-registration.mjs` 和对应 `tests/course-selection*.test.mjs`。任何修改都要同时阅读 [选课接口专题](../ai/15-course-selection-api.md)。

### 9.2 作业和在线测试

作业工作区可以读取任务、准备本地工作包、生成草稿或把经过校验的答案写入内置浏览器题目，但最终提交必须由用户逐题核对并在学校页面完成。不要把“答案已生成”“题目已填入”“本地文件已存在”表述成“学校已提交”。

### 9.3 邮箱和附件

邮箱是高度敏感来源。列表元数据、正文和附件应分级读取；HTML 必须消毒；附件应按需读取并受大小、路径和类型限制。日志只记录操作阶段和错误摘要，不记录正文、附件内容、完整 URL query 或授权码。

## 10. 前端和视觉改动

THEIA 是高频校园工作台，界面首先应让人扫描、比较和重复操作。前端改动遵循：

- 首屏先使用本地缓存快照，后台获取运行时状态；
- 所有异步动作都有 loading、失败、成功和取消/停止语义；
- 工具栏、日历、网格和表格使用稳定尺寸，避免内容变化造成跳动；
- 熟悉动作使用 Lucide 图标并提供 `aria-label`/tooltip；
- 不为局部功能添加营销式 hero、大面积装饰、嵌套卡片或与内容无关的视觉噪音；
- 保持现有颜色 token、组件和布局密度；
- 窄屏、桌面、启动中、无数据、部分数据和错误状态都要检查；
- 业务事实、来源质量和用户可执行动作不能被装饰文字遮蔽。

纯视觉变化也要确认不会改变点击区域、可访问名称、首屏初始化、动态布局或打包资源。若新增图片或字体，检查它是否会被 `scripts/package-source.mjs`、electron-builder 和 CSP 正确处理。

## 11. 测试与验证矩阵

### 11.1 标准门槛

代码行为变更的标准命令：

~~~powershell
npm run check
npm run build
git diff --check
~~~

需要交互时可以缩小到相关测试文件；测试必须使用 fake client、fixture 或临时数据根，不访问真实账号、不依赖现存 Cookie、不读取个人目录。

### 11.2 测试族索引

| 测试族 | 主要证明 |
| --- | --- |
| `parsers.test.mjs`、`academic-*.test.mjs` | 来源结构解析、学业模型、校历和时间规则 |
| `adapters.test.mjs`、`academic-api-adapter.test.mjs` | 来源访问、API 优先、浏览器回退和错误归因 |
| `sync-*.test.mjs`、`catalog-provenance.test.mjs` | 来源 outcome、旧值保留、确认空、资料库原子更新 |
| `store-and-api.test.mjs`、`data-output-contract.test.mjs` | 分片、快照、Feed、API 和投影 |
| `ai-export.test.mjs` | AI 包清单、哈希、冲突安全写入、URL/路径/秘密净化 |
| `ipc-security.test.mjs`、`renderer-security.test.mjs` | sender、CSP、窗口和 IPC 安全边界 |
| `*vault*.test.mjs`、`secret-input.test.mjs` | safeStorage 和敏感输入 |
| `imap-mail-service.test.mjs`、`webmail-service.test.mjs` | 邮件元数据、正文消毒和附件按需读取 |
| `course-selection*.test.mjs` | 选课目标、请求、停止、journal 和重载 |
| `course-work*.test.mjs`、`model-service.test.mjs` | 工作区、模型协议、取消和输出验证 |
| `advisor-*.test.mjs`、`agent-tools.test.mjs` | 顾问质量、证据、工具边界、流式和动作 |
| `local-api-security.test.mjs`、`runtime-api-status.test.mjs` | loopback、令牌、Host、运行时状态 |
| `packaging-config.test.mjs`、`dev-server-port.test.mjs` | 构建和开发服务器约束 |

### 11.3 必须做的禁止项测试

涉及个人数据或权限的变更，至少加入一条禁止出现的断言，例如：

- 导出中不存在 `password`、`cookie`、`apiKey`、session 和认证页面；
- 日志中不存在邮件正文、附件内容、完整 URL query 和绝对路径；
- Agent 初始 prompt 中不存在全量校园记录；
- loopback API 不接受外网 Host、错误令牌和未声明方法；
- renderer 看不到原始 `ipcRenderer`、session 或 vault；
- 选课失败后 journal 不含足以重放的 POST 字段；
- 失败同步不把已有集合替换为空数组。

## 12. 调试手册

### 12.1 先判断运行形态

报告问题时先写清楚是：

- `npm run dev` 的 Electron 桌面模式；
- `npm run dev:web` 的浏览器预览；
- 已安装/未安装的打包桌面程序；
- CLI、MCP 或 Iris 外部调用。

这些形态拥有的权限和生命周期不同。浏览器页面正常不代表 Electron 登录、vault、API、文件选择器或打包资源正常。

### 12.2 启动无数据

检查顺序：

1. 当前应用是否使用了预期的 `THEIA_DATA_ROOT`；
2. 是否加载了 `data/manifest.json`，以及是否存在 `.bak`；
3. 是否是旧 legacy 快照缺少新的 freshness/provenance 字段；
4. `sync.lastRunAt`、`sync.lastSuccessAt`、域状态和来源错误是什么；
5. `/v1/health` 是否来自同一个应用实例和数据根；
6. 是否把“首次尚未同步”误认为“学校没有数据”。

### 12.3 一个来源失败

先查看来源级 outcome，而不是只看总错误字符串。确认：

- 失败的是主页认证、具体域请求还是 parser；
- 其它来源/域是否已经成功；
- 旧数据是否仍然存在；
- 是否有确认空的充分 provenance；
- 是否在异步认证恢复期间观察到了中间状态。

认证恢复不能用一次诊断文本证明成功；要看实际认证页面、后续同步和最终快照。

### 12.4 本机 API 失败

通过当前数据根的 `api-runtime.json` 发现实际地址和令牌：

~~~powershell
$runtime = Get-Content "$env:THEIA_DATA_ROOT/api-runtime.json" | ConvertFrom-Json
$headers = @{ Authorization = "Bearer $($runtime.token)" }
Invoke-WebRequest "$($runtime.baseUrl)/v1/health" -Headers $headers | Select-Object -Expand Content
~~~

不要硬编码 `8765`，也不要把 runtime 文件复制到 issue。排查应用是否运行、数据根是否一致、端口是否回退、令牌是否来自当前实例、Host 是否精确匹配。退出后 runtime 文件应被清理。

### 12.5 存储恢复

数据异常时：

1. 先停止会继续写入的应用；
2. 复制整个数据根到单独位置；
3. 在副本上检查 manifest schema、片段引用和 digest；
4. 再检查备份清单和 legacy 输入；
5. 使用副本复现加载和迁移；
6. 未确认恢复前不删除任何原始文件。

不要手工修改 `data/objects/` 或删除 manifest 来让应用重建，这可能把可恢复证据变成不可恢复的丢失。

### 12.6 生成物污染

每次工作前后检查：

~~~powershell
git status --short --untracked-files=all
~~~

常见不应提交的生成物包括 `dist/`、`release-bin/`、`.tmp-*`、`.tsbuildinfo`、日志、SQLite、`api-runtime.json`、认证诊断和抓取结果。清理前先确认目标是本次工作产生的临时目录，不要对整个数据根、用户目录或 workspace 使用宽泛删除。

## 13. 打包、发布和升级

### 13.1 未安装构建

~~~powershell
npm run dist:unpacked
npm run smoke:packaged
~~~

`smoke:packaged` 使用临时数据根启动显式的 `THEIA.exe`，检查 renderer 阶段、离线 PDF/OCR runtime、本机 API runtime 清理和未处理异常。它不能证明真实账号登录、学校数据同步或模型 provider 正常。

### 13.2 源码归档

~~~powershell
npm run dist:source
~~~

源码归档由 `scripts/package-source.mjs` 的显式白名单生成，包含 `SOURCE-MANIFEST.json`、逐文件字节数和 SHA-256。它会排除 `node_modules`、构建输出、缓存、凭据提取器、本机现场数据和敏感后缀。新增公开源码目录或文档后，检查白名单和禁止路径是否仍符合预期。

### 13.3 正式发行

`npm run dist:installer` 的当前实现会：

1. 要求工作树干净并检查 GitHub 认证；
2. 构建 Windows x64 NSIS 安装器；
3. 检查 installer、blockmap 和 `latest.yml`；
4. 更新发行说明中的实际产物信息；
5. 生成并验证源码 ZIP；
6. 运行 packaged smoke；
7. 按配置发布 COS/GitHub、提交发行说明、推送分支、创建标签和上传 Release。

这是一项有外部副作用的操作。只有明确承担发布责任、确认版本和远程目标、确认工作树内容正确时才能运行。若只需要检查打包，使用 `dist:unpacked`、`dist:source` 和 `smoke:packaged`。

### 13.4 产物验收不变量

- 安装包不依赖 Vite 开发地址；
- Electron preload 和 CSP 没有安全降级；
- OCR 使用随包的离线资源；
- 已有分片和 legacy 数据可以读取或迁移；
- `THEIA_DATA_ROOT` 和用户默认数据策略没有被打包脚本覆盖；
- 卸载不会意外删除用户 app data；
- 源码包不包含个人资料、凭据、Cookie、日志或现场数据库；
- 版本、文件名、SHA-256 和发行说明来自本次实际产物。

## 14. 文档维护

文档是实现的一部分。以下变化必须同步相应文档：

| 变化 | 更新位置 |
| --- | --- |
| API、IPC、响应 envelope | `docs/reference/api-and-ipc.md`、`integration/README.md`、测试 |
| `CampusState`、分片、迁移 | `docs/reference/data-model.md`、`data-lifecycle.md`、测试 |
| 来源、认证、回退 | `architecture.md`、`docs/ai/07-auth-and-sync.md`、测试 |
| AI、模型、工具、引用 | `docs/ai/20-a-b-c-advisor-agent-sidecar.md`、AI 契约、测试 |
| 作业、在线测试、选课 | 用户指南、对应 feature/AI 专题、测试 |
| 新页面、设置、交互 | `docs/features/`、用户指南、前端专题 |
| 测试、发布、排障 | `operations-and-testing.md`、`troubleshooting.md` |
| 对开发者的共同规则 | `CONTRIBUTING.md`、本文 |

文档写作规则：

- 把当前实现、规划和已知限制分开；
- 命令以 `package.json` 和脚本实际行为为准；
- 不写固定测试数量、构建体积或易过期的文件统计，除非它们是本次发布产物证据；
- 不在示例中放真实凭据、完整个人数据、原始认证 URL 或本机绝对路径；
- 任何可能影响用户数据、隐私或学校侧操作的说明，都要写出失败和人工确认边界；
- 历史记录放 `docs/archive/`，不要拿它替代当前契约。

## 15. 交接清单

一项功能或修复完成时逐项确认：

- [ ] 我能用一句话说明用户问题和改动边界。
- [ ] 我找到了数据来源和唯一归并所有者。
- [ ] 我没有在 renderer、导出、日志、API 或 Agent 中泄露秘密。
- [ ] 我区分了失败、确认空、部分成功和旧值保留。
- [ ] 我同步检查了 core、Electron、preload、类型、bridge、UI、测试和文档。
- [ ] 我使用了隔离数据根和脱敏 fixture。
- [ ] 我运行了与风险匹配的测试，而不是只检查窗口能否打开。
- [ ] 我记录了没有做的真实桌面、来源、模型或设备验证。
- [ ] 我没有删除或覆盖用户旧数据、备份、工作区或历史导出。
- [ ] 我检查了 `git diff --check` 和完整 `git status`。
- [ ] 另一个不了解背景的开发者可以从 PR 和文档继续工作。
