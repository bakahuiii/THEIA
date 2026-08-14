# THEIA

THEIA 是面向北京化工大学校园服务的本地优先 Windows 桌面工作台。

## 主要能力

- 使用学校统一身份认证浏览器会话访问北化在线 THEOL 和其他校园网页。启用 API 优先级后，也可使用独立加密凭据建立隔离的正方教务 API 会话。
- 将课表、课程、已选课程、考试、成绩、官方学业进度、通知、作业和在线测试读取为本地规范化快照。
- 即使北化在线 THEOL 仍显示已截止作业，也会在本地将其过滤。
- 高优先级教务域可以并发读取，北化在线 THEOL 首页读取可与教务同步并行；主同步完成后，每门课程的 `Course task` 扫描才通过严格串行队列静默执行。
- 通过隔离的正方教务 API 会话提供选课队列。它只操作用户明确选择的目标，并且绝不会在会话过期后自动重放选课 `POST`。
- 提供昌平校区高清地图，并对齐校园图层与卫星底图。
- 为作业生成本地工作区，其中包含题目、附件、解析后的在线测试题目、`manifest.json` 和模板。
- 调用用户自行配置的 OpenAI 兼容模型服务处理已准备的工作区。
- 普通作业生成本地 `model-answer.md`；在线测试经校验后生成 `answers.json`。
- 在 THEIA 内置浏览器中打开学校原页面，用于上传文件或填写测试答案。THEIA 永远不会点击学校页面上的最终提交按钮。

## 模型服务与隐私

在“设置”中填写服务地址与 API 密钥。THEIA 会检查兼容的 `/v1/models` 端点、列出可用模型并选择合适的文本模型；对于不提供模型列表的中转服务，仍可手动填写模型 ID。THEIA 使用 OpenAI 兼容的 Chat Completions 端点：

```text
POST {服务地址}/chat/completions
Authorization: Bearer {API 密钥}
```

服务地址和模型名称保存在 THEIA 设置中。API 密钥由 Electron `safeStorage` / Windows DPAPI 单独加密，绝不会进入校园数据、导出、回环 API、任务清单或诊断日志。模型请求只由 Electron 主进程发起，渲染进程无法取得 API 密钥。

模型只会收到已准备的本地任务上下文。THEIA 不会把学校密码、Cookie、浏览器存储或已认证页面发送给模型服务。

## 顾问能力现状

THEIA 已具备不依赖模型的确定性顾问底座。`getAdvisorOverview` 从一次原子的 `CampusStore.snapshotWithRevision()` 读取数据，在本地计算各数据域质量、证据引用、类型化结论、数据质量风险、作业与考试时间记录以及稳定议程。该路径不访问学校、不请求模型、不读取浏览器会话，也不写入状态，因此可在离线和未配置 API 密钥时运行。

在此底座上，P1-P3 已提供本地议程、学业分析和选课决策工作台；P4-P5 首发已把受约束的模型解释接入顾问页。`AdvisorRuntime` 只在用户明确发起并确认披露后发送按意图裁剪的最小上下文，回答必须通过严格叙述 schema，以及请求时冻结的 claim、action 和低信任通知/邮件引用目录校验。模型不能直接读取 `CampusStore`、Feed、回环 API、浏览器会话或本机文件。

当前首发仍不是自由 Agent：没有持久会话或持久多轮摘要，没有工具循环、Agent Provider、多代理、流式输出、embedding 或持久 RAG，也没有任何模型登录、同步、抢课、填答、发信、提交或文件访问权限。`course` 意图尚未接入 P3 当前候选/决策的专用交互，邮件也不会被顾问自动联网读取或改变已读状态。准确边界见 [P4-P5 模型运行时说明](docs/ai/18-advisor-p4-p5-model-runtime.md)。

## 作业流程

1. 同步北化在线 THEOL，然后打开“作业与测试”。
2. 选择“准备工作区”，保存本地任务包。
3. 选择“使用模型”，生成答案草稿或完整的答案 JSON 文件。
4. 在“打开工作区”中检查文件。
5. 在线测试请选择“写入测试页面”，在内置浏览器中核对后自行在学校页面提交。
6. 普通作业请选择要上传的文件，在内置浏览器中核对后自行在学校页面提交。

## 从源码运行

需要 Node.js 22.12+ 和 npm 10+。

```powershell
npm install
npm run dev
```

纯浏览器预览有意限制功能：学校认证、加密凭据存储、文件选择、本地模型密钥和内置来源浏览器操作都必须使用已安装的 Electron 桌面客户端。

## 命令行与本地数据 API

THEIA 为同一台电脑上的脚本和工具提供通用的只读本地数据接口。

```powershell
npm run cli -- status
npm run cli -- export --format theia --output .\theia-feed.json
npm run cli -- export --format json --output .\theia-snapshot.json
npm run cli -- export --format ai --output .\theia-ai-exports
npm run cli -- export --format ics --output .\theia-calendar.ics
npm run cli -- export --format csv --collection grades --output .\grades.csv
npm run cli -- work list
npm run cli -- work show <assignment-id>
npm run cli -- doctor
```

`export --format ai` 会在所选父目录内新建 `THEIA-AI-EXPORT-YYYYMMDD-HHmmss` 目录，其中包含 16 份规范化数据域 JSON、`AI_CONTEXT.md`、`DATA_DICTIONARY.md` 和 `manifest.json`；清单为其余 18 个文件记录 SHA-256 摘要。该数据包是由用户主动导出的静态 AI 阅读快照，不是学校系统的实时会话，也不能用于导入或写入。它会排除凭据、Cookie、浏览器状态、绝对路径、原始附件和工作区输出，但仍可能包含敏感的学业与邮件数据。请只保存在本机，或仅交给你明确信任的模型服务。准确结构和校验规则见[《AI 导出契约》](docs/reference/ai-export-contract.md)。

桌面端“设置”提供单独加密的教务 API 凭据槽和明确的数据源选择器。启用 API 优先且已保存凭据时，THEIA 使用隔离的教务 API 适配器；未启用或未配置时，使用统一身份认证浏览器路径。如果已启用的 API 请求失败，THEIA 会保留现有本地快照并报告来源错误，不会在同一次同步中静默切换路径。

直接 API 会话必须与 `persist:theia` 隔离，因为北化可能在第二次登录时使先前的教务会话失效。API Cookie 不得复制到统一身份认证浏览器会话。

桌面客户端运行时，回环服务只绑定 `127.0.0.1`。默认端口为 `8765`，实际端口记录在 `api-runtime.json`：

```text
GET /v1/health
GET /v1/snapshot
GET /v1/feed
GET /v1/terms
GET /v1/courses
GET /v1/schedule
GET /v1/exams
GET /v1/grades
GET /v1/academic-progress
GET /v1/selected-courses
GET /v1/assignments
GET /v1/workspaces
GET /v1/notices
GET /v1/calendar.ics
```

`/v1/feed` 使用 `theia-campus-feed/v1` Schema；可复用的本地客户端和 Schema 见[《本地集成接口》](integration/README.md)。

## 数据边界

- 数据默认位于 `%APPDATA%\THEIA`；`THEIA_DATA_ROOT` 可指定隔离目录。使用默认目录启动时，仅当 THEIA 对应文件不存在，才可能从 `%APPDATA%\BUCT` 复制特定旧版文件，旧目录会被保留。
- `auth-diagnostics.ndjson` 只记录认证阶段、脱敏后的主机和路径以及错误摘要，不包含密码、API 密钥、Cookie 或 URL 查询参数。
- 统一身份认证、教务 API、邮箱和模型服务凭据分别使用 DPAPI 加密，并从业务快照、导出和本地 API 响应中排除。
- 只有用户明确选择教学班并启动有限任务后才会选课。THEIA 不会自动退课、评教或提交申请。

## 开源许可

THEIA 的源代码以 [MIT License](LICENSE) 发布。该许可只适用于本仓库的代码和文档，不授予北京化工大学、学校平台或其商标的任何权利，也不覆盖用户本地数据、认证凭据、课程材料、邮件或学校服务内容。使用者应自行遵守学校的服务规则与课程要求。

安全问题请不要通过公开 Issue 披露，处理方式见 [SECURITY.md](SECURITY.md)。Windows 安装包的可信代码签名是独立于 MIT 许可的发布流程；未签名构建可能触发 SmartScreen，详见 [发行兼容与恢复](docs/ai/22-distribution-compatibility-and-recovery.md)。

## 文档导航

### 使用与产品

- [文档总索引](docs/README.md)：按用户、开发、数据和运维主题查找文档。
- [用户指南](docs/guides/USER_GUIDE.md)：桌面端完整操作说明。
- [新生快速开始](docs/guides/FRESHMAN_START.md)：首次使用与基础同步。
- [产品方向](PRODUCT_DIRECTION.md)：产品边界和近期方向。
- [AI 方向](AI_DIRECTION.md)：AI 顾问的目标、阶段和原则。
- [待办事项](TODO.md)：尚未完成的工作与优先级。

### 架构、数据与开发

- [系统架构](docs/architecture.md)：进程、模块、信任边界和主要数据流。
- [数据生命周期](docs/data-lifecycle.md)：采集、规范化、存储、导出和清理规则。
- [数据归属矩阵](docs/data-ownership-matrix.md)：各数据域的来源、所有者与消费者。
- [数据模型参考](docs/reference/data-model.md)：状态、实体和字段契约。
- [API 与 IPC 参考](docs/reference/api-and-ipc.md)：桌面桥接与本地接口。
- [AI 导出契约](docs/reference/ai-export-contract.md)：AI 数据包结构、脱敏和完整性校验。
- [开发指南](docs/developer-guide.md)：开发环境、代码组织和改动流程。
- [开发工作流](DEVELOPMENT.md)：仓库级开发、验证与提交约定。
- [运维与测试](docs/operations-and-testing.md)：诊断、测试、构建和发布检查。
- [本地集成接口](integration/README.md)：回环 API 与集成客户端用法。

### 专题开发文档

- [专题开发索引](docs/ai/README.md)：按任务路由到相应专题。
- [项目规则](docs/ai/00-project-rules.md)
- [运行时数据流](docs/ai/01-runtime-data-flow.md)
- [前端外壳与样式](docs/ai/02-frontend-shell-styles.md)
- [前端页面](docs/ai/03-frontend-views.md)
- [设置与个性化](docs/ai/04-settings-personalization.md)
- [IPC 与 Bridge 契约](docs/ai/05-ipc-bridge.md)
- [存储 Schema](docs/ai/06-storage-schema.md)
- [认证与同步](docs/ai/07-auth-and-sync.md)
- [教务数据来源](docs/ai/08-academic-sources.md)
- [作业、模型与抢课](docs/ai/09-coursework-model-selection.md)
- [邮箱](docs/ai/10-mailbox.md)
- [体测与工具](docs/ai/11-fitness-tools.md)
- [本地 API、CLI 与导出](docs/ai/12-local-api-cli.md)
- [测试与发布](docs/ai/13-testing-release.md)
- [代码索引](docs/ai/14-code-map.md)
- [选课 API](docs/ai/15-course-selection-api.md)
- [顾问 P0 可信底座](docs/ai/16-advisor-p0-foundation.md)
- [顾问 P1-P3 本地工作台](docs/ai/17-advisor-p1-p3-local-workbench.md)
- [顾问 P4-P5 模型运行时](docs/ai/18-advisor-p4-p5-model-runtime.md)

## 验证与打包

```powershell
npm test
npm run lint
npm run build
npm run dist:installer
```
