# THEIA 文档中心

THEIA 是面向北京化工大学学习生活的 Windows 本地优先桌面客户端。它把教务、北化在线THEOL、邮箱、体测、校历和个人学习工具汇集为可离线读取的本机数据集，并在明确的安全边界内提供同步、工作区、模型辅助和只读本地接口。

本文档中心面向三类读者：日常使用者、维护或扩展 THEIA 的开发者，以及读取 THEIA 数据的本地程序或 AI。文档描述的是当前仓库所实现的行为；设计中的能力会明确标为“规划”或“待实现”，不能据此假定它已经可用。当前版本已经提供“导出给 AI”的多文件离线包；它与完整 JSON、THEIA Data Feed 和运行中的本机 API 是不同的读取面。

## 从这里开始

| 你想完成的事 | 推荐阅读 | 说明 |
| --- | --- | --- |
| 第一次认识 THEIA | [新生第一次用 THEIA](guides/FRESHMAN_START.md) | 看懂统一身份认证、教务和北化在线THEOL，再按事情找到正确入口。 |
| 登录、同步、查看校园信息 | [用户指南](guides/USER_GUIDE.md) | 桌面客户端的日常流程、功能边界和排障入口。 |
| 查询 MOTION 场馆状态 | [MOTION 场馆状态](guides/MOTION_VENUE_STATUS.md) | “学习工具”中的公开场馆查询、只读边界、本地 API 和耗时基准。 |
| 理解整个产品如何工作 | [系统架构](architecture.md) | 进程、模块、信任边界与核心服务的鸟瞰图。 |
| 维护或扩展代码 | [开发者指南](developer-guide.md) | 环境、目录、改动路径、质量门槛和扩展原则。 |
| 理解本地数据如何产生、保存和恢复 | [数据生命周期](data-lifecycle.md) | 同步、规范化、分片存储、Feed、导出和迁移。 |
| 需要按代码入口排查“抓取--存储”链路 | [数据抓取--数据存储操作手册](data-capture-storage-handbook.md) | 当前实现的触发条件、扩展域、空数据语义、来源页认证、分片提交和手工验收。 |
| 快速审查每个数据的来源、持久化和读取面 | [数据所有权矩阵](data-ownership-matrix.md) | 用一张矩阵检查集合所有权、敏感边界和失败语义。 |
| 对接本机 HTTP 接口、CLI 或 Electron bridge | [接口与 IPC 参考](reference/api-and-ipc.md) | 当前可调用的接口、响应包装、限制和兼容规则。 |
| 读取全部状态与每个集合的结构 | [数据模型参考](reference/data-model.md) | `CampusState`、集合、来源标记与字段语义。 |
| 为外部 AI 消费 THEIA 数据 | [AI 数据导出契约](reference/ai-export-contract.md) | 已实现 AI 包的选择方式、严格文件结构、校验与隐私边界。 |
| 理解确定性顾问底座与当前模型 Agent | [当前 Agent 说明](ai/20-a-b-c-advisor-agent-sidecar.md) | 冻结快照、惰性只读工具、Responses 流式传输与通知/邮件安全边界；P0-P3 历史设计见专题文档。 |
| 测试、调试、打包或运维 | [运行、测试与发布](operations-and-testing.md) | 本地运行、验证顺序、诊断文件、打包与恢复。 |

## 文档层次

```text
docs/
  README.md                         本文档中心与阅读路线
  guides/FRESHMAN_START.md          新生快速开始
  guides/USER_GUIDE.md               用户手册
  guides/MOTION_VENUE_STATUS.md     MOTION 场馆状态查询说明
  architecture.md                   系统架构和模块边界
  developer-guide.md                开发者入门和扩展约定
  data-lifecycle.md                 数据采集、持久化、导出和恢复
  data-capture-storage-handbook.md  抓取入口、解析、存储和生命周期操作手册
  data-ownership-matrix.md          数据来源、持久化与接口边界矩阵
  operations-and-testing.md         运行、测试、诊断、打包与发布
  reference/
    api-and-ipc.md                  HTTP API、CLI、Electron Bridge
    data-model.md                   CampusState 与持久化数据模型
    ai-export-contract.md           AI 消费数据的严格契约
  ai/                               按主题组织的开发索引
```

`docs/ai/` 不是用户手册，也不是公开 API 规范。它按主题汇总工程约束、模块所有权和变更时需要同步更新的文档，供维护者快速定位相关实现。

## 事实来源与版本原则

当文档、界面和实现不一致时，以当前实现和测试为准，并在同一变更中修正文档。特别是以下文件具有最高的结构性事实优先级：

- `core/schema.mjs`：规范化状态、Feed、CSV、ICS 的实际序列化规则。
- `core/store.mjs`：分片存储的格式、校验和回退策略。
- `core/local-api.mjs`：loopback HTTP API 的真实路由和访问限制。
- `cli/theia-cli.mjs`：CLI 的实际命令、参数和输出。
- `src/types.ts`：渲染器使用的状态和 `TheiaBridge` 类型契约。
- `electron/preload.cjs` 与 `electron/main.mjs`：可从渲染器调用的 IPC 面及其权限边界。
- `integration/theia-campus-feed-v1.schema.json`：`theia-campus-feed/v1` 的机器可校验最小结构。

数据协议使用显式 schema 字符串，而不是仅依赖文件名。消费者必须检查 schema 后再处理数据，并应容忍未知的附加字段。当前重要协议包括：

- `theia-campus-data/v1`：完整规范化 `CampusState`。
- `theia-campus-feed/v1`：面向事件、任务和学业上下文的派生 Feed。
- `theia-local-data/v1`：本地资料库 `dataCatalog`。
- `theia-sharded-store/v1`：磁盘分片清单。
- `theia-state-fragment/v1`：不可变状态片段。
- `theia-course-work/v1`：一个已准备课程任务的工作区清单。
- `theia-ai-context/v1`：面向 AI 的净化、多文件、可校验离线上下文包。
- `theia-ai-export-manifest/v1`：AI 包的文件清单、SHA-256 校验和隐私声明。
- `theia-domain-provenance/v1`：逐领域来源尝试、内容结论、完整性与水位。
- `theia-advisor-overview/v1`：由一次冻结快照与显式评估上下文生成的无模型顾问概览。

## 核心承诺

1. **本地优先。** 规范化校园数据写入当前 Windows 用户的数据目录；THEIA 不要求自建云账户或远程数据库。
2. **凭据隔离。** 学校密码、邮箱授权码、模型 API Key、Cookie 和浏览器会话不进入 `CampusState`、导出、Feed、日志或 loopback API。
3. **可追溯。** 同步集合尽量保留来源 URL、采集时间、解析版本、刷新状态和错误摘要，帮助使用者与 AI 判断数据新鲜度。
4. **人工把关。** THEIA 可以准备作业、让模型生成草稿、写入在线测试页面或打开提交页，但不点击学校系统的最终提交按钮。
5. **只读集成。** HTTP API 只监听 `127.0.0.1`，只允许 `GET`、`HEAD` 和受限的 `OPTIONS`；CLI、外部工具和 AI 不能借此写入用户状态。
6. **失败保留旧值。** 单一来源认证失败、网络故障或解析故障时，不应用空结果覆盖已有有效数据。
7. **明确 AI 边界。** AI 导出覆盖所有适合解释用户状态的规范化业务领域，但不复制凭据、会话、原始附件、模型输出文件或绝对路径；它是静态快照，不是学校操作授权。

## 快速术语

| 术语 | 含义 |
| --- | --- |
| 校园快照 / `CampusState` | 应用当前完整的、已规范化的用户业务数据。 |
| 同步 | 使用已认证校园会话或经授权的独立 API，读取并规范化校方数据的过程。 |
| Feed | 从完整快照派生的便于本地工具与 AI 消费的数据视图，不是主存储。 |
| 工作区 | 某一作业或在线测试的本地受控目录，含题目、附件、清单、答案模板和生成结果。 |
| 资料库 / `dataCatalog` | 体测、全校课表、校历分析等具有来源和版本信息的本地归档集合。 |
| loopback API | 仅本机可访问的 `127.0.0.1` 只读 HTTP 服务。 |
| 统一认证 | Electron 持久会话中复用的校园 SSO 登录状态。 |

## 使用本套文档的边界

本文档不会记录真实账号、密码、Cookie、模型 Key、未脱敏学校响应或个人样本数据。示例使用占位值；复制命令时请只在自己受控的本机环境中填入自己的信息。数据导出是高敏感操作：导出文件中仍可能包含学号、成绩、邮件正文、作业任务和文件路径，即使它不含凭据，也应按个人隐私资料处理。
