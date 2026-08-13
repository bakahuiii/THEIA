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
- `tests/catalog-provenance.test.mjs`：体测、全校课表、校历的内容/provenance 原子更新及失败保留。
- 专题测试：GPA、课程分类、体测归档、抢课、作业、模型、主题映射。

改 parser、schema、认证、邮件、导出或服务行为时，必须补/改对应测试。所有测试用 fake client 或 fixture；不访问真实账户、不依赖本机 cookie。

Advisor P0 的回归门包括：旧快照不得被称为 fresh/complete；失败后保留内容和水位；确认空与最新失败可同时表达；派生域不得高估完整性/水位；overview 的所有引用闭合且四元上下文一致；同一 claim ID 在不同 `evaluatedAt` 下允许动态值变化，消费者必须整体替换实例。

这些测试只证明无模型 P0 底座。没有 `AdvisorRuntime`、严格 `theia-advisor-model-narrative/v1` 校验、敏感域 consent、模型引用验证和工具循环测试时，不得把真实顾问模型接入或 P1 UI/复杂规则宣称为完成。

## 运行前检查

```powershell
npm test
npm run build
npm run lint
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
