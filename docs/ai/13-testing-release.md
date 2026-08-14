# 测试、调试与发布

## 测试分层

- `tests/parsers.test.mjs`：教务与 THEOL 解析。
- `tests/adapters.test.mjs`：来源访问/同步结果。
- `tests/store-and-api.test.mjs`：持久化、同步保护、local API。
- `tests/*vault*.test.mjs`：凭据加密边界。
- `tests/imap-mail-service.test.mjs`：邮箱元数据、HTML 消毒、正文和附件按需加载。
- `tests/ai-export.test.mjs`：AI 数据包清单、完整性摘要、冲突安全写入和敏感信息净化。
- `tests/advisor-core.test.mjs`：DataQuality 正交状态、证据闭包、claim 身份、确定性风险和 agenda。
- `tests/advisor-overview-ipc.test.mjs`：一次原子快照、一次时钟采样和 overview 四元上下文。
- `tests/advisor-agenda-p1.test.mjs`、`tests/advisor-presentation.test.mjs`、`tests/advisor-ui.test.mjs`：P1 排序、会话级隐藏和顾问 UI。
- `tests/advisor-academic.test.mjs`、`tests/gpa.test.mjs`：P2 培养方案、GPA、缺口、升级线与 What-if。
- `tests/advisor-course-decision.test.mjs`、`tests/course-selection-advisor-ui.test.mjs`：P3 选课匹配、冲突、重复修读、排名和 UI 隔离。
- `tests/advisor-action-service.test.mjs`、`tests/advisor-action-wiring.test.mjs`：顾问固定动作的 revision、allowlist 与私有实体反解。
- `tests/advisor-context-builder.test.mjs`：P4 最小字段投影、披露计划、逐实体 consent、请求 catalog 和输入预算。
- `tests/advisor-narrative-contract.test.mjs`：严格 narrative、claim/action/低信任引用校验、关键数字与高风险学校决定阻断。
- `tests/advisor-provider.test.mjs`、`tests/advisor-runtime.test.mjs`：Provider 路由、错误归一化、快照冻结、并发、格式修复、预算，以及 Provider 忽略 Abort 或永不 settle 时的取消/期限竞速。
- `tests/advisor-notice-mail.test.mjs`：P5 通知/邮件净化、显式选择、逐封正文授权和附件隔离。
- `tests/advisor-lexical-index.test.mjs`、`tests/advisor-p5-integration.test.mjs`：纯内存词法索引、隐私 scope、请求级低信任引用和索引不得扩大 Provider 披露。
- `tests/catalog-provenance.test.mjs`：体测、全校课表、校历的内容/provenance 原子更新及失败保留。
- 专题测试：GPA、课程分类、体测归档、抢课、作业、模型、主题映射。

改 parser、schema、认证、邮件、导出或服务行为时，必须补/改对应测试。所有测试用 fake client 或 fixture；不访问真实账户、不依赖本机 cookie。

Advisor P0 的回归门包括：旧快照不得被称为 fresh/complete；失败后保留内容和水位；确认空与最新失败可同时表达；派生域不得高估完整性/水位；overview 的所有引用闭合且四元上下文一致；同一 claim ID 在不同 `evaluatedAt` 下允许动态值变化，消费者必须整体替换实例。

P1-P3 的无模型规则与 UI 门禁见 [17-advisor-p1-p3-local-workbench.md](17-advisor-p1-p3-local-workbench.md)。P4-P5 首发现在还必须通过 ContextBuilder 最小披露、敏感域 consent、严格 `theia-advisor-model-narrative/v1`、冻结 catalog 引用、Provider 错误与永不 settle、协议相对 URL 净化、通知/邮件显式选择以及本地索引不扩大披露等回归；完整入口和未实现边界见 [18-advisor-p4-p5-model-runtime.md](18-advisor-p4-p5-model-runtime.md)。工具循环不是本次首发能力，当前门禁验证的是不存在模型工具执行权或学校写权限，不能把 `suggestedActionIds` 当作 ToolCall。

## 运行前检查

```powershell
npm test
npm run build
npm run lint
git diff --check
```

`npm run dev` 会自动定位并停止此前属于 THEIA 的 Vite/Electron dev 进程，避免端口递增和启动提示音。不要手动杀宽泛的全部 node/electron 进程。

## 打包

仅用户要求时运行：

```powershell
npm run dist:unpacked
npm run dist:installer
npm run smoke:packaged
```

打包后验证应用图标、安装后 EXE 图标、启动、主状态迁移、无开发端 URL 依赖。未验证前不宣称发布完成。
