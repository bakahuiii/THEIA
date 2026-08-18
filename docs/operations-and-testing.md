# THEIA 运行、测试与发布

## 1. 运行目标

THEIA 的运行质量不仅是“窗口打开了”。一个可交付的本地桌面版本至少应能：加载或恢复本地快照、在无需联网时显示已有数据、正确隔离凭据、在用户授权后建立校园会话、以受控频率同步、保持 loopback API 只读且本机可见、导出结构正确的数据，并在失败时不毁坏既有数据。

本章为开发、测试、诊断和发行提供操作顺序。用户日常故障先看 [用户指南](guides/USER_GUIDE.md)；模块结构看 [系统架构](architecture.md)。

## 2. 本地运行模式

### 2.1 桌面开发模式

```powershell
Set-Location <THEIA 源码目录>
$env:THEIA_DATA_ROOT = '<独立的测试数据目录>'
npm run dev
```

桌面模式包含 Electron 主进程、preload、受限浏览器会话、加密 vault、文件对话框、模型 Key、作业提交辅助与 loopback API。大部分校园认证和本机能力只能在这个模式真实验证。

### 2.2 浏览器预览模式

```powershell
npm run dev:web
```

浏览器预览适合检查 React 布局、状态 fallback 和纯前端行为。它不是 Electron 的等价物：没有真实安全存储、SSO 浏览器会话、用户数据根、文件对话框、主进程模型调用或有意义的本机 API 生命周期。不要把浏览器预览的成功作为登录、导出、IPC 或凭据功能已通过的证据。

### 2.3 CLI 与本机数据根

CLI 和桌面应用读取同一 `CampusStore`。在进行任何可能读取私有状态的调试前，先确认使用的是隔离数据根：

```powershell
$env:THEIA_DATA_ROOT = 'H:\temp\theia-dev-data'
npm run cli -- status --json
npm run cli -- doctor
```

`status` 输出数据根、存储摘要、最后同步、计数和来源状态；`doctor` 用于提示尚未首次同步、协议异常或未连接来源。它们不应输出密码、Cookie 或模型 Key。

`THEIA_DATA_ROOT` 是隔离边界：指定后，应用不得读取或迁移真实 `%APPDATA%\BUCT`。只有使用默认 `%APPDATA%\THEIA` 时，才会在目标文件缺失的前提下复制选定的 legacy 文件，并保留原目录。

## 3. 标准验证门槛

每次涉及代码行为的变更，至少运行：

```powershell
npm test
npm run lint
npm run build
```

顾问性能基线使用固定、脱敏的 `theia-advisor-benchmark-corpus/v1`，通过 `npm run benchmark:advisor` 运行。默认规模为 2,000 门课程、10,000 条成绩、10,000 条课表项和 5,000 条通知；报告同时给出 overview 冷运行（复制快照后求值）和热运行（同一已提交快照重复求值）的 p50/p95、峰值额外 RSS、Node/平台信息及四种 Provider 的协议兼容矩阵。脚本只使用本地合成数据，不连接学校或模型服务；报告中的门槛是待目标机器复测的发布指标，不是自动生成的发布承诺。

这三项分别覆盖纯核心/服务行为、静态质量和 TypeScript/Vite 构建。完成后按改动风险增加验证：

| 改动范围 | 额外验证 |
| --- | --- |
| 数据模型、存储、导出、API | `npm run cli -- status --json`，并用隔离数据根检查 JSON/Feed/CSV/ICS 的 schema、字段和敏感字段缺失；涉及 AI 包时运行 `node --test --test-concurrency=4 tests/ai-export.test.mjs` 和 CLI AI 导出。 |
| Electron IPC 或桌面菜单 | 桌面模式中实际调用一次，检查 renderer 没有 preload error、错误反馈清晰。 |
| 登录、同步、来源 adapter | 用受控测试账号或 fake client 验证认证失效、部分来源失败与旧数据保留；不在日志中复制秘密。 |
| 作业/模型 | 准备测试工作区，验证上下文限制、输出文件、答案 JSON 校验与人工最终提交边界。 |
| P0 顾问底座 | 固定 `now`、时区和 `rulesVersion`；验证 legacy/空/失败/auth-required/保留旧值、四元实例一致、引用闭合及跨评估动态值不 merge。 |
| 邮箱 | 验证元数据上限、按需正文/附件、HTML 消毒、无正文泄露到日志。 |
| 选课 | 验证明确目标、停止、限速、会话失效不自动重放 POST、journal 不含操作字段。 |
| 外观/节气 | 运行相关纯函数测试，并在桌面和窄屏检查首次初始化后的表现。 |
| 打包/安装 | 见第 8 节；必须验证实际安装产物。 |

不要因为只改了文档或 CSS 就默认跳过事实检查；若变更会影响出包资源、构建类型或运行时路径，仍应至少构建。

## 4. 测试结构

测试位于 `tests/`，由 Node 原生测试运行器执行。主要覆盖如下：

| 测试族 | 覆盖重点 |
| --- | --- |
| `parsers.test.mjs` | 教务、北化在线THEOL页面的结构解析和数据规范化。 |
| `adapters.test.mjs`、`academic-api-adapter.test.mjs` | 来源读取、API 优先、未配置时的浏览器路径、API 失败时的旧数据保护。 |
| `store-and-api.test.mjs` | 分片持久化、旧数据保护、loopback API、Feed 与本地 client。 |
| `data-catalog.test.mjs` | 体测、全校课表与校历资料库的归档语义。 |
| `academic-calendar-*.test.mjs` | 校历/PDF 分析和周次计算。 |
| `credential-vault.test.mjs`、`mail-vault.test.mjs`、`academic-api-vault.test.mjs` | 凭据加密边界。 |
| `imap-mail-service.test.mjs`、`webmail-service.test.mjs` | 邮件元数据、消毒、正文与附件按需处理。 |
| `course-work.test.mjs`、`model-service.test.mjs` | 工作区、模型请求和答案验证。 |
| `course-selection*.test.mjs` | 选课请求、目标记录、敏感字段剔除与重载。 |
| `gpa.test.mjs`、`course-category.test.mjs`、`academic-progress.test.mjs` | 学业推导函数。 |
| `background-palette.test.mjs`、`gradient-map.test.mjs`、`solar-season.test.mjs` | 外观、色板和节气规则。 |
| `ai-export.test.mjs` | AI 包文件清单、SHA-256、冲突安全写入、URL/凭据/路径净化与邮件纯文本转换。 |
| `sync-state.test.mjs`、`catalog-provenance.test.mjs` | 来源 outcome、确认空与保留内容正交、派生域、资料库原子 provenance 与水位。 |
| `advisor-core.test.mjs`、`advisor-overview-ipc.test.mjs` | 固定时间的 DataQuality/Evidence/Claim/Risk/Agenda、引用闭合、原子 overview。 |
| `ipc-security.test.mjs`、`renderer-security.test.mjs` | trusted main-frame sender、runtime schema、CSP 与窗口安全边界。 |
| `model-service.test.mjs` | 模型服务身份绑定、显式探测票据、配置事务、取消、禁止重定向及请求/响应上限。 |

新增能力应靠近其逻辑添加测试，不要只把所有新断言挤进一个不相关的端到端文件。对于带隐私风险的数据，额外增加“禁止出现”的断言，例如导出、日志、journal 或 API 响应中不出现 token、password、cookie、API key、原始 HTML 或可重放字段。

## 5. 诊断与故障分类

### 5.1 首先区分的状态

排查时不要把所有“没有数据显示”看作同一种问题。至少区分：

| 现象 | 可能含义 | 首选检查 |
| --- | --- | --- |
| 应用无数据但没有错误 | 首次启动、错误数据根、尚未同步、已有快照为空 | `theia status --json`、设置中的上次同步。 |
| 一个来源没更新，其他来源正常 | 局部来源失败，旧数据应还在 | `sync.sources`、活动日志、认证状态。 |
| 登录窗口反复出现 | 会话无效、统一认证未完成、校方页识别异常 | 脱敏 `auth-diagnostics.ndjson`、主进程安全日志。 |
| API/CLI 读取失败 | 应用未运行、端口变化、数据根不一致 | `theia api`、`api-runtime.json`、`THEIA_DATA_ROOT`。 |
| 导出内容旧 | 最近同步失败、未完成同步或读取了不同数据根 | `updatedAt`、`sync.lastSuccessAt`、`sync.lastRunAt`、导出路径。 |
| 数据被错误清空 | 不应发生；可能存在合并/迁移缺陷 | 立即保留目录、检查 manifest / `.bak`，不要反复启动覆盖证据。 |

### 5.2 可读取的诊断资料

- 设置中的活动记录：本地操作、同步请求和安全错误摘要；
- `%APPDATA%\THEIA\auth-diagnostics.ndjson`：认证阶段、脱敏 host/path、错误摘要；
- `data/manifest.json` 和 `manifest.json.bak`：存储结构/恢复状态；
- `api-runtime.json`：应用运行时的本机 API 地址；
- `npm run cli -- status --json` 和 `doctor`：状态摘要；
- 开发模式 stdout/stderr：启动、构建和主进程安全错误。

这些文件不应成为收集个人数据的借口。任何要分享给他人或附到 issue 的日志必须检查并移除姓名、学号、邮件内容、课程任务、路径、URL query、Cookie、密码与 API Key。

### 5.3 存储恢复原则

`CampusStore` 会验证主、备份清单，并按分片择优恢复；只有分片存储不存在时才尝试 legacy 快照。若某个必需分片在两份清单中都损坏，加载会停止并保留原清单。人工排查时：

1. 先停止会继续写入的应用实例；
2. 复制受影响数据根到单独的只读备份位置；
3. 检查主/备份 manifest 是否存在、schema 是否匹配、引用片段是否可读；
4. 使用隔离副本验证恢复，而不是在唯一原始目录上反复改名或删除；
5. 仅在确认恢复成功且用户明确要求时，进行后续清理。

不要删除 `buct-data.json`、`.bak`、对象片段、校历资产或工作区来“让程序重新生成”。这可能使本来可恢复的用户历史丢失。

旧的真实 `%APPDATA%\THEIA` 快照可能没有 `sync.domains`。这是兼容输入，不是可自动推断的证据：应用必须把相关 provenance/freshness/completeness 显示为 unknown，不能用当前时间或顶层 `updatedAt` 回填。只有用户以后主动执行一次新版同步及对应资料刷新，真实数据根才会形成新的领域水位；离线测试不能替代这一步。

## 6. 本机 API 与导出验证

运行中的桌面客户端会写出 `api-runtime.json`。可通过 CLI 或该文件发现地址；不要假定总是 `8765`，端口占用时会在受限范围内回退。

基本检查示例：

```powershell
npm run cli -- api
Invoke-WebRequest http://127.0.0.1:8765/v1/health | Select-Object -Expand Content
Invoke-WebRequest http://127.0.0.1:8765/v1/feed | Select-Object -Expand Content
```

实际端口必须来自运行时元数据。验证 HTTP 接口时检查：

- 只在 `127.0.0.1` 监听；
- 非 `GET`/`HEAD` 方法返回只读拒绝；
- 未知路由返回明确 `not_found`；
- collection 包装包含 schema、collection、updatedAt、total、items；
- `?since=` 对集合与学业进度按既有规则工作；
- 任何响应中没有秘密字段；
- 运行时关闭后 `api-runtime.json` 被移除。

显式导出应在临时目录测试，并检查：完整 JSON 为 `theia-campus-data/v1`，Feed 为 `theia-campus-feed/v1`，ICS 可被日历解析，CSV 没有未转义的逗号/换行破坏行结构。AI 导出必须通过 `npm run cli -- export --format ai --output .\\test-output` 实测：它应创建新的时间戳子目录，`manifest.json` 应为 `theia-ai-export-manifest/v1`，并且每个 `manifest.files[]` 所列文件的 UTF-8 SHA-256 与字节数均匹配；导出内容不得出现 fixture 中注入的 secret、查询参数、绝对路径或附件二进制。精确验收规则见 [AI 数据导出契约](reference/ai-export-contract.md)。

## 7. 开发数据卫生

### 必须避免

- 使用真实 `AppData` 作为破坏性试验目标；
- 把真实截图、抓取响应、邮件、完整导出或任务附件提交到源代码；
- 将学校账号、密码、邮箱授权码或模型 Key 写进 `.env` 后再提交；
- 用外部代理、公共监听或反向隧道暴露 loopback API；
- 直接更改 `data/objects/`、`manifest.json` 或 `theia-feed.json` 来伪造测试状态；
- 为省事用真实学校账户跑测试套件。

### 推荐做法

- 使用 `THEIA_DATA_ROOT` 指向专用临时目录；
- 创建最小、脱敏、可复现的 fixture；
- 测试前后检查 `git status`，确认没有生成物或真实资料混入；
- 将临时导出放在项目外的明确临时目录；
- 用 fake client 模拟成功、认证失效、网络错误和不完整返回；
- 记录 schema、时间戳和来源状态，而不是复制原始响应。

## 8. 构建、打包与发行

常规发布前流程：

```powershell
npm test
npm run lint
npm run build
npm run dist:unpacked
npm run dist:source
npm run dist:installer
npm run smoke:packaged
```

P0 顾问底座的最小最终门槛依次为 `npm test`、`npm run lint`、`npm run build`、`npm run dist:unpacked`、`npm run smoke:packaged`。packaged smoke 必须使用隔离临时数据、保持学校与模型网络为零，并实际穿过 preload bridge 检查 advisor overview schema、snapshot revision 及 DataQuality revision 一致。`smoke:packaged` 只接受显式的 `THEIA.exe` 产物，等待子进程 `close`、拒绝超时/非零退出，并把未处理异常和拒绝写入作为失败；未先重新执行 `dist:unpacked` 的旧产物不能视为当前版本验收。

`dist:unpacked` 用于检查未安装产物；`dist:source` 通过白名单生成 `THEIA-<version>-source.zip`，其中包含源码、构建配置、锁文件、测试、文档、运行时视觉资产与逐文件 SHA-256 清单，不包含依赖、构建输出、凭据提取器、本机辅助脚本、缓存或现场数据；`dist:installer` 生成 x64 NSIS 安装器后会自动运行 `dist:source`；`smoke:packaged` 用于已打包应用的基本启动检查，并会实际加载离线校历 OCR worker、WASM core 与简体中文模型。打包前确认版本、图标、构建产物目录和现有用户数据策略。安装器配置为不在卸载时删除 app data，但发布验证仍要确认升级/卸载不会意外移除 `%APPDATA%\THEIA`。

打包通过后仍需做针对性的人工检查：

- 安装后的 EXE、开始菜单、桌面快捷方式与图标正确；
- 程序可启动且不依赖 Vite 开发地址；
- 校历 OCR 不依赖系统 Python 或运行时网络下载；
- 已有分片数据和 legacy 数据能被读取或迁移；
- Electron preload 正常，无安全降级；
- 本机 API 实际地址可发现且只监听回环；
- 打包产物不包含开发缓存、真实数据、密钥或调试资料；
- 源码 ZIP 的版本、顶层目录、`SOURCE-MANIFEST.json`、文件数量、逐文件大小与 SHA-256 均与实际内容一致；
- 用户关键流程（登录、离线读取、同步、导出、作业工作区）按发布范围验证。

未运行打包、未验证实际安装产物或未检查用户数据迁移时，不应宣称“发布已完成”。

## 9. 发布后与问题报告

发现生产问题时，先保护用户数据和隐私，再收集最小复现：

1. 记录 THEIA 版本、Windows 版本、是否桌面/浏览器预览、是否使用自定义数据根；
2. 描述可重复的动作、期望结果、实际结果和首次发生时间；
3. 附上经过脱敏的错误摘要或 `doctor` 输出；
4. 对数据异常只报告集合计数、schema、更新时间和来源状态，不上传完整快照；
5. 对认证/邮件/模型问题绝不附 Cookie、密码、授权码、完整 URL query 或 API Key；
6. 需要恢复时先保留原始数据根副本，避免“清空重装”破坏可诊断证据。

维护者修复后，应将回归案例加入对应的自动测试，并更新本章、接口文档或 AI 文档中受影响的行为说明。
