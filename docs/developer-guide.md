# THEIA 开发者指南

## 1. 本文适用范围

本文面向维护 THEIA 源码、修复缺陷、添加数据来源、扩展桌面功能、增加本地接口或改进测试的开发者。它不是用户操作说明；普通使用者请阅读 [用户指南](guides/USER_GUIDE.md)。在做跨进程、数据模型、存储或认证变更前，同时阅读：

- [系统架构](architecture.md)
- [数据生命周期](data-lifecycle.md)
- [接口与 IPC 参考](reference/api-and-ipc.md)
- `docs/ai/00-project-rules.md`
- 与当前模块最接近的 `docs/ai/` 专题页

THEIA 的复杂度来自多个相互依赖的约束：校园站点并不稳定、用户数据必须可恢复、Electron 权限需要收口、外部 AI 不能拿到秘密、同步失败不能清空历史。局部代码“跑通”不代表功能完成；需要从来源、模型、存储、接口、界面和测试全链路验证。

## 2. 环境与基本命令

### 2.1 前置条件

- Windows 开发环境；
- Node.js `>=22.12.0`；
- npm `>=10.0.0`；
- Electron 43、React 19、TypeScript 5、Vite 7 由项目依赖锁定；
- 校历图片 OCR 使用随应用打包的 Tesseract.js、WASM core 与离线简体中文模型；用户机器不需要安装 Python，运行时也不得从 CDN 下载语言数据；
- 使用自己的隔离数据根进行开发，避免调试误触真实用户数据。

安装依赖：

```powershell
Set-Location <THEIA 源码目录>
npm install
```

建议在开发/测试时指定临时数据根：

```powershell
$env:THEIA_DATA_ROOT = 'H:\temp\theia-dev-data'
npm run dev
```

不要将真实密码、API Key、Cookie、完整个人快照或含个人数据的抓取结果提交到仓库、fixture、日志或文档。

### 2.2 常用命令

```powershell
npm run dev                 # Electron + Vite 开发启动
npm run dev:web             # 仅浏览器预览；受限的非桌面 fallback
npm test                    # Node:test 全部测试
npm run lint                # ESLint
npm run build               # TypeScript 构建 + Vite 打包
npm run cli -- status --json
npm run cli -- doctor
npm run cli -- export --format theia --output .\theia-feed.json
npm run cli -- export --format ai --output .\test-output
```

`npm run dev` 会处理本项目已知的旧开发进程，避免端口连续增长。不要为了解决局部启动问题而杀掉宽泛的所有 `node` 或 `electron` 进程。构建 Windows 安装包属于更高成本、会产生大量输出的操作，仅在明确需要时执行，见 [运行、测试与发布](operations-and-testing.md)。

## 3. 目录地图

```text
THEIA/
  src/                         React renderer
    App.tsx                    页面装配
    hooks/useTheiaApp.ts       渲染器运行时协调和订阅
    bridge.ts                  desktop/web bridge 选择与 fallback
    types.ts                   CampusState 与 TheiaBridge 类型契约
    views/                     业务页面
    views/settings/            设置子页面
    views/tools/               本地计算工具
    layout/                    标题栏、侧栏、工作区框架
    components/                复用组件和 UI primitives
    lib/                       renderer 侧纯逻辑
  electron/                    Electron main/preload 和加密服务
    main.mjs                   生命周期、IPC、特权编排
    preload.cjs                窄化 contextBridge
    *-vault.mjs                凭据与 API Key 的 safeStorage vault
    model-service.mjs          OpenAI-compatible 模型调用
  core/                        纯 Node 业务核心
    adapters/                  校园来源读取
    parsers/                   HTML/JSON 规范化
    schema.mjs                 状态、Feed、CSV、ICS
    store.mjs                  不可变分片持久化
    sync-service.mjs           同步编排
    local-api.mjs              loopback 只读 HTTP 服务
    course-work.mjs            作业工作区
    course-selection*.mjs      选课服务与审计 journal
    data-catalog.mjs           本地资料库
  cli/theia-cli.mjs            同一 Store 的本地命令行入口
  integration/                 供本地外部程序使用的 client 与 Feed schema
  tests/                       Node:test 测试套件
  scripts/                     开发、打包和烟雾测试辅助脚本
  docs/                        人类与机器可读文档
```

构建输出、测试启动档案、爬取结果和参考材料不是源代码：`dist/`、`build/`、`release-bin/`、`.api-crawl*/`、`.references/`、`.preview-*` 等目录不能作为生产逻辑依赖，也不应该被随手编辑来修复问题。

## 4. 修改前先定位所有权

开始任何功能前，先回答五个问题：

1. **数据从哪里来？** 是 JWGLXT、THEOL、TYGL、IMAP、官方校历、用户本地输入还是派生计算？
2. **谁拥有它？** 哪个 adapter/service 是唯一归并权威？不同来源冲突时谁优先？
3. **它会持久化吗？** 若会，`CampusState`、`schema`、`store` 分片和迁移如何变化？
4. **谁能读取它？** 只给 UI、也给 CLI/API/Feed，还是给明确的 AI 包？是否需要去敏或另建视图？
5. **失败时意味着什么？** 无记录、未同步、权限不足、认证失效、网络失败和解析失败如何区分？

如果这些答案还不清楚，不要先改 UI。THEIA 的前端只是共同状态的一个消费者；在 renderer 私自缓存业务数据会让同步、导出与 AI 包彼此失真。

## 5. 跨层功能的标准路径

### 5.1 新增或修改一个校园数据集合

1. 在 `core/parsers/` 将来源响应转换为稳定、可测试的普通对象。
2. 在对应 `core/adapters/` 或 service 中处理网络、来源 URL、认证错误与保守的回退策略。
3. 在 `core/schema.mjs` 增加默认值和 `normalizeState()` 中的迁移/约束逻辑。
4. 在 `core/store.mjs` 为持久集合声明明确片段；避免让小更新重写无关的大集合。
5. 选择是否进入 Feed、loopback API、CLI/CSV/ICS 或资料库；不要默认全暴露。
6. 若 renderer 需要操作，通过 `TheiaBridge`、preload、主进程 handler 和 `src/bridge.ts` fallback 一起暴露。
7. 更新视图/Hook，确保从 snapshot 消费，而非二次抓取或直接写文件。
8. 添加 parser、adapter、store/reload、API/导出和隐私边界测试。
9. 更新 [数据模型](reference/data-model.md)、[数据生命周期](data-lifecycle.md) 与相应 `docs/ai/` 页面。

### 5.2 新增 IPC

调用链严格为：

```text
view or hook
  -> src/bridge.ts
  -> src/types.ts (TheiaBridge)
  -> electron/preload.cjs
  -> electron/main.mjs ipcMain handler
  -> core service / vault / controlled Electron capability
```

一个“只改 preload 或只改 handler”的 IPC 不完整。每个 handler 都要：校验和规范化参数、限制路径/URL/枚举、处理失败、必要时发布新 snapshot，并保证浏览器 fallback 不会伪造特权成功。通用“执行命令”“读取任意文件”“打开任意 URL”型 IPC 禁止添加。

### 5.3 新增设置

设置是 `CampusState.settings` 中的不秘密偏好，不是 vault。新增设置时：

- 给 `emptyState()` 默认值；
- 在 `normalizeState()` 限制类型和范围；
- 在 `theia:update-settings` 内白名单化接收；
- 在 `TheiaBridge`、preload、bridge fallback 和 settings view 贯通；
- 评估它是否影响自动同步、邮箱轮询、API 生命周期或敏感行为；
- 不将密码、token、模型 Key、邮箱授权码放入 settings。

### 5.4 新增本地 API 或导出字段

先明确数据是否应该离开应用边界。若答案是肯定的：

- API 只能在 `core/local-api.mjs` 提供 `GET/HEAD`，保持 `127.0.0.1` 绑定和受限 CORS；
- 定义响应 schema、版本、时间、空结果和错误语义；
- 不能暴露原始 HTML、cookies、vault 内容、会话状态、任意文件或可重放操作字段；
- 最好增加集合 endpoint，而不是让调用者解析主存储文件；
- 同步更新 `integration/`、接口文档和测试；
- 对 AI 所需的完整输出，使用明确版本的专用数据包，而不是随意添加隐式敏感字段。

## 6. 认证、来源与网络安全

统一认证由 Electron 的 `persist:theia` session 维护。身份状态必须通过已认证页面判断，不能因为 URL 看起来像校园域名就视为登录成功。学校站点、CAS 页和教务的本地登录页都可能处于未认证状态。

教务 API 账号和统一认证浏览器通道各自独立：API 未启用或尚无独立凭据时，适配器使用浏览器通道；API 失败的来源域会在同一轮同步中尝试一次浏览器 SSO 回退，成功的 API 域继续保留。浏览器认证也失败时报告认证错误，不会静默吞掉失败或用空结果覆盖本地数据。API cookie jar 不得写入磁盘或镜像到 `persist:theia`。课程选择的 POST 尤其不可因会话过期而自动重放。

URL 必须由主进程白名单逻辑控制。诊断可记录来源名、主机/路径、阶段、HTTP 状态和简短错误，但不能记录 query、Cookie、密码、邮件正文、附件文本或 API Key。

## 7. 数据与迁移纪律

`CampusStore` 是持久化业务数据的唯一所有者。不得从 feature 中直接写入 `data/`、`buct-data.json`、`theia-feed.json` 或工作区之外的任意用户目录。应使用 `store.update()` 进行针对性状态变更，或使用 `store.replace()` 写入完整已规范化结果。

修改 schema 时必须考虑：

- 新字段加载旧快照时的默认值；
- 非法/过大/旧形状值的规范化；
- 分片清单如何兼容缺少的新片段；
- 是否进入 Feed、API 和导出；
- 失败同步是否保持旧集合；
- 旧 `buct-data.json` 和 `.bak` 是否仍可作为迁移来源；
- 不能在迁移完成后自动删除用户旧数据。

新增大量或有范围边界的数据，优先使用专门的 `dataCatalog` 集合和分片策略，而不是把原始响应塞进顶层状态。

## 8. 前端开发约定

THEIA 是高频使用的校园工作台。界面优先稳定、紧凑、可扫描；业务工具不能被营销式 hero、过量嵌套卡片或只为了装饰的图形干扰。沿用已有组件、颜色 token、Radix/shadcn primitive 和 Lucide 图标。

前端修改要注意：

- `src/hooks/useTheiaApp.ts` 在首帧先加载缓存快照，网络运行时状态随后获取；不要引入会阻塞首屏的远程请求。
- 异步动作应有明确 loading、失败与成功反馈；长操作不能制造可重复提交。
- 稳定尺寸用于工具栏、网格、日历和侧栏，避免内容变化导致布局跳动。
- 使用图标按钮承载熟悉的单一动作，并提供 `aria-label` / tooltip；命令性操作可用图标加文本。
- 新 UI 不能绕过用户确认边界，例如直接最终提交作业或不可逆执行操作。
- 外观偏好属于 renderer/local preference 层；它与校园业务 `CampusState.settings` 的职责不同，不应混入凭据或同步逻辑。

## 9. 测试策略

测试按风险分层：

| 变更类型 | 最低覆盖 |
| --- | --- |
| HTML/JSON parser | fixture 输入、正常/异常结构、字段规范化。 |
| adapter/认证 | fake client、认证失效、来源错误、旧数据保留。 |
| schema/store | 默认值、迁移、分片 reload、digest/备份回退。 |
| API/CLI/export | schema、状态码、`since`、CSV/ICS、敏感字段缺失。 |
| vault/秘密 | 加密可用与不可用、绝不落入 state/日志。 |
| 邮箱/附件 | 元数据限制、按需加载、HTML 消毒。 |
| 选课/提交 | 用户目标约束、停止、限速、不可自动重放、审计剔除敏感字段。 |
| 模型 | 请求格式、超时、输出验证、只使用工作区上下文。 |
| UI 外观/日期规则 | 纯函数单测和关键状态转换。 |

所有测试使用 fake client、fixture 或临时数据根，不访问真实账号、不依赖现存 Cookie、也不读取个人目录。测试通过不替代真实用户流程的人工审阅，但没有针对性测试也不能把高风险变更视为完成。

推荐验证顺序：

```powershell
npm test
npm run lint
npm run build
npm run cli -- status --json
```

如果改动了 Electron UI、login、文件导出、打包行为或校方交互，在上述基础上执行相应的人工 smoke 检查；不要只因 web preview 能显示就判定桌面能力正常。

## 10. 文档更新是交付的一部分

以下变更必须同步文档：

| 变化 | 至少更新 |
| --- | --- |
| 公开状态字段、协议或导出 | `reference/data-model.md`、`reference/ai-export-contract.md`、schema/测试。 |
| HTTP/CLI/IPC | `reference/api-and-ipc.md`、`integration/README.md`、测试。 |
| 存储、迁移、恢复 | `data-lifecycle.md`、`docs/ai/06-storage-schema.md`。 |
| 认证或数据来源 | `architecture.md`、`docs/ai/07-auth-and-sync.md`、`08-academic-sources.md`。 |
| 作业/模型/提交边界 | `guides/USER_GUIDE.md`、`docs/ai/09-coursework-model-selection.md`。 |
| 新页面、设置或工具 | 用户指南、`docs/ai/03-frontend-views.md`、`04-settings-personalization.md`。 |
| 测试、发布或排障 | `operations-and-testing.md`、`docs/ai/13-testing-release.md`。 |

当无法确认实现已经存在时，文档应明确标注“规划”“待实现”或“仅设计契约”，不能把方向文档写成已发布功能。对外数据/AI 说明尤其如此。
