# THEIA

> THEIA v0.6.0 是面向北京化工大学学生的本地优先 Windows 校园工作台。

> **文档说明：** 目前 README 和部分配套文档仍在整理中，内容不算完整；正式版发布前请以实际功能和发行说明为准。

THEIA 把教务系统、北化在线 THEOL、校园邮箱和本地学习工具放到同一个桌面应用中。它负责读取、整理、计算、提醒和准备操作；学校系统中的最终提交、选课决定和成绩认定仍由用户确认。

[下载 Windows x64 v0.6.0](https://github.com/bakahuiii/THEIA/releases/tag/v0.6.0) · [用户指南](docs/guides/USER_GUIDE.md) · [发行说明](docs/releases/v0.6.0.md)

## 你可以用它做什么

- **校园概览**：在一个本地视图中查看今天的课表、下一场考试、待办作业、成绩和通知。
- **课表与考试**：按学期、周次和范围查看课表；查看考试时间、地点、校区和座号；调用教务系统原生流程导出课表 PDF。
- **成绩与学业**：查看成绩明细、已获学分和 GPA 趋势；页面同时保留学校 GPA，并展示按本地规则计算的辅助 GPA。学业页展示培养方案、课程完成情况、学分缺口和已选课程。
- **我的课程与作业**：同步 THEOL 课程、作业和在线测试，准备本地工作区、答案草稿和测试答案；最终内容由用户在学校页面核对并提交。
- **学业顾问 Agent**：针对当前问题按需读取本地校园数据，给出带证据的回答、风险提示和下一步行动。没有配置模型服务时，页面会明确提示 Agent 不可用并引导前往设置。
- **课程与抢课**：读取教学班和全校课表，保存明确选择的目标，并在用户启动的时间窗口内执行有限尝试。不会自动退课、评教或提交其它学校业务。
- **通知与邮箱**：集中查看教务通知、THEOL 通知和校园邮箱；邮件正文按需读取，附件仍由用户决定是否打开。
- **学习工具**：校历与教学进程、官方培养计划、空闲教室、体测评分、MOTION 场馆状态、学业预警、创新学分、第二课堂和昌平校区地图。
- **Iris（QQ 伴侣）**：可选的本地 QQ 桌面伴侣，用文字或图片回答教室空闲、场馆状态等校园查询，并支持 Codex / Claude Code 等桌面 Agent 桥接。
- **外观**：主题、缩放、3D 背景、动效、色板和渐变映射都可以在“设置与接入”中调整并保存在本机。

启动时会出现 THEIA 品牌加载画面，随后自动切换为主界面；校历、培养计划等离线资产在后台刷新，不阻塞窗口出现。

## 第一次使用

THEIA 的完整功能需要桌面客户端。纯浏览器预览只用于查看前端，不能提供学校认证、Windows 加密存储、文件选择、内置浏览器或本地模型密钥能力。

1. 从 [v0.6.0 Release](https://github.com/bakahuiii/THEIA/releases/tag/v0.6.0) 下载并安装 Windows x64 安装包。
2. 启动后在“统一身份认证”中保存学校账号。CAS 登录后，THEIA 会分别检查教务系统（JWGLXT）和北化在线 THEOL 的会话，顶部会独立显示两个来源的状态；一个来源失败不会把另一个来源的成功结果清空。
3. 点击同步。首次同步后，课表、考试、成绩、学业进度、课程、作业和通知会按来源逐步出现；短暂的单域失败会保留上一次有效的本地结果。
4. 如果要使用“学业顾问”，打开“设置与接入 -> 模型服务”，选择协议、填写服务地址、API Key 和模型 ID，先检测连接再保存。支持 OpenAI Responses、Anthropic Messages、Gemini GenerateContent 和 Ollama Chat。
5. 如果要使用教务 API 优先同步，在“设置与接入 -> 数据”单独保存教务系统 API 凭据并启用。它与 CAS 浏览器会话隔离；抢课读取使用已认证的教务网页会话，以保留正方选课页所需的页面上下文。

### 两套认证不要混用

- **统一身份认证（CAS）**：用于教务页面、北化在线 THEOL 和其它支持统一认证的校园页面。
- **教务系统 API 凭据**：可选，用于 API 优先同步；不是 CAS 浏览器密码的替代品。
- **校园邮箱凭据**：可选，在邮箱设置中单独保存，使用 IMAP 收信。

所有来源都会独立显示连接状态。THEIA 不会把 API Cookie 复制到 CAS 会话，也不会在认证失败时用空结果覆盖本地数据。

## 学业顾问 Agent

学业顾问是内置的有界 Agent，不是把整份校园数据库直接上传给模型。

- 模型先收到问题、当前快照版本和工具边界，再按需读取课程、课表、考试、成绩、学业进度、作业、通知、邮箱、体测等数据。
- 默认权限为 **只读（受控 Agent）**，只允许声明过的校园工具和本地分析；不会获得通用 Shell、任意网页或文件系统权限。
- 用户可以显式切换到 **完全访问**。此模式允许 Agent 读写本地文件、执行命令、发起 HTTP(S) 请求和打开网页，后果由本机用户负责。
- 预算档位为 `High`、`XHigh`、`Max` 和实验性的 `Ultra`。档位控制探索步数、输出长度和超时，不代表模型一定会使用所有预算。
- Agent 只在用户发送问题后发起模型请求；工具调用、回答和使用量会在会话中显示并保存在本机。

模型服务未配置、API Key 无法由当前 Windows 账户解密或流式接口不可用时，Agent 会停止并显示可操作的错误，不会生成伪造的本地答案。

## 数据与隐私

- 默认数据目录为 `%APPDATA%\THEIA`；可使用 `THEIA_DATA_ROOT` 指定隔离目录。
- 账号密码、校园 API 凭据、邮箱密码和模型 API Key 使用 Electron `safeStorage` / Windows DPAPI 加密保存。
- 凭据、Cookie、浏览器存储、认证页面、绝对路径和运行期缓存不会进入普通校园快照、AI 导出、本地回环 API 或诊断日志。
- 模型请求只包含用户当前问题和 Agent 实际读取到的最小数据切片。THEIA 不创建云端账号，也不会把学校密码、Cookie 或已认证页面发送给模型服务。
- “导出给 AI”是用户主动生成的静态阅读包，不是实时校园会话，也不能导回或写入学校系统。它仍可能包含成绩、课程、邮件等敏感学业信息，请只交给你信任的模型服务。

## 本地 API 与外部 Agent

桌面客户端运行时会启动只绑定 `127.0.0.1` 的只读回环服务。实际端口写入数据目录中的 `api-runtime.json`，不要把默认端口硬编码到客户端中。

常用端点包括：

```text
GET /v1/health
GET /v1/feed
GET /v1/snapshot
GET /v1/terms
GET /v1/schedule
GET /v1/exams
GET /v1/grades
GET /v1/academic-progress
GET /v1/selected-courses
GET /v1/assignments
GET /v1/notices
GET /v1/emails
GET /v1/calendar.ics
GET /v1/venue-catalog
GET /v1/venue-status?detailUrl=<详情页>&date=YYYY-MM-DD&venue=<场馆组>
GET /v1/venue-statuses?activity=<项目>&date=YYYY-MM-DD
GET /v1/motion-table-image?activity=<项目>&date=YYYY-MM-DD
GET /v1/free-classroom-image?periods=<节次>&weekdays=<星期>&termId=<学期ID>
GET /v1/table-image?domain=<域>&title=<标题>&limit=<行数>
GET /v1/school-schedule?keyword=<课程>&termId=<学期ID>&page=<页>&pageSize=<每页数>
```

仓库还提供标准 MCP stdio 桥接 [integration/theia-mcp.mjs](integration/theia-mcp.mjs)。它复用 Agent 的脱敏和工具白名单，只暴露当前快照的只读投影，不暴露凭据、Cookie、浏览器会话、任意网络或学校侧写入。完整配置见[本地数据接口](integration/README.md)。

## 从源码运行

需要 Node.js `22.12+` 和 npm `10+`。

```powershell
git clone https://github.com/bakahuiii/THEIA.git
cd THEIA
npm install

# Electron 桌面开发模式
npm run dev

# 仅启动浏览器预览
npm run dev:web
```

常用验证和打包命令：

```powershell
npm test                         # node --test --test-concurrency=4
npm run lint
npm run build
npm run smoke:packaged
npm run dist:installer          # Windows x64 安装包 + 源码归档
npm run dist:source
```

测试故意限制为 4 个并发 worker，避免 Windows 本地环境因无限并发卡死。真实校园登录、真实模型服务请求和桌面人工验收不能由离线测试替代。

命令行导出示例：

```powershell
npm run cli -- status
npm run cli -- doctor
npm run cli -- export --format theia --output .\theia-feed.json
npm run cli -- export --format json --output .\theia-snapshot.json
npm run cli -- export --format ai --output .\theia-ai-exports
npm run cli -- export --format ics --output .\theia-calendar.ics
npm run cli -- export --format csv --collection grades --output .\grades.csv
npm run cli -- work list
npm run cli -- work show <assignment-id>
```

## 文档

- [用户指南](docs/guides/USER_GUIDE.md)：按登录、同步、页面和排障顺序说明桌面端用法。
- [MOTION 场馆状态](docs/guides/MOTION_VENUE_STATUS.md)：场馆状态查询的用户用法、只读边界、API 和耗时基准。
- [文档总索引](docs/README.md)：用户、开发、数据和运维文档入口。
- [系统架构](docs/architecture.md)：进程、模块、信任边界和主要数据流。
- [API 与 IPC 参考](docs/reference/api-and-ipc.md)：桌面桥接和本地接口契约。
- [开发指南](docs/developer-guide.md) 与 [开发工作流](DEVELOPMENT.md)：源码组织、验证和发布流程。
- [发行兼容与恢复](docs/ai/22-distribution-compatibility-and-recovery.md)：安装包、认证恢复和诊断边界。
- [安全策略](SECURITY.md)：安全问题请不要通过公开 Issue 披露。

## 发布说明

v0.6.0 的 Windows 安装包当前未配置可公开验证的 Authenticode 证书，Windows 可能显示未知发布者或 SmartScreen 提示。安装前请核对 Release 页面提供的 SHA-256；安装包、源码归档和 blockmap 的校验值记录在 [v0.6.0 发行说明](docs/releases/v0.6.0.md) 中。

## 许可

THEIA 代码和文档以 [MIT License](LICENSE) 发布。许可不授予北京化工大学、学校平台或其商标的任何权利，也不覆盖用户本地数据、认证凭据、课程材料、邮件或学校服务内容。使用者应遵守学校服务规则与课程要求。
