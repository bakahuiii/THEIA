# 认证、会话与同步

## 统一认证会话

`electron/main.mjs` 使用持久 Electron partition `persist:theia`。用户在统一认证窗口登录后，`SessionClient` 将学校域 Cookie 镜像到请求 session，让 HTTP 抓取与内置浏览器复用同一会话。

认证状态不能只看 URL：通过已认证页面检查。登录页、CAS 页面和教务本地登录页都必须判为未认证。启动时可用保存的统一认证凭据自动填充；Cookie 不得序列化到 store。

## 来源职责

- JWGLXT：课表、成绩、考试、选课、学业、通知、课程信息。
- 北化在线THEOL：课程、作业、在线测试、通知；过期作业要过滤。
- TYGL：体测；仅用户导入/刷新时抓取。
- IMAP：校园邮件。

## 同步实现

- `core/source-client.mjs`：`SessionClient`，封装 page/form/cookie mirror，抛出 `AuthRequiredError`。
- `core/adapters/jwglxt.mjs`、`theol.mjs`：来源访问与解析调度。
- `core/sync-service.mjs`：并发协调、去重、旧数据保护、进度推送、自动同步定时器。
- `electron/main.mjs`：对必须 Chromium 渲染的页面提供队列化 page/form loader。

## 同步顺序与并发边界

- 教务首页和课表索引建立必要上下文后，课表、考试、成绩、学业进度等高优先领域可按适配器策略并发读取；依赖前序结果的领域仍按依赖顺序执行。
- 北化在线THEOL首页与教务主同步并行启动，但所有 THEOL 操作都经过同一独占队列，避免 THEOL 页面请求互相重叠。
- 主同步完成、持久化并发布快照后，`SyncService` 才静默调度北化在线THEOL逐课程 `Course task` 扫描。该扫描不占用主同步的可见进度，并在 THEOL 独占队列与 `syncAssignments()` 的逐课程循环中严格串行；新一轮主同步会取消尚未开始或仍在执行的旧扫描结果。

## 逐领域结果合同

同步必须把业务内容和对应 `sync.domains` provenance 放进同一次 store 提交。每轮在开始时为尚未执行的来源领域记录 `not-attempted`，随后按来源记录 attempted/succeeded/status、completeness、capturedAt、sourceSucceededAt、emptyConfirmed、retainedPrevious 和安全错误码。

这些字段彼此不可互相推导：有记录不代表完整或新鲜；最近失败不代表旧内容消失；最近一次尝试的 `emptyConfirmed` 也不等于当前保留内容的 `contentEmptyConfirmed`。失败保留旧内容时保留上一次成功水位，并把最新失败如实留在 `lastAttempt`。

多来源及派生领域不得在中间提交中被乐观标为 complete。派生领域以全部必要子域中最弱的 completeness 和最老的有效水位为准；缺少必要 provenance 时保持 unknown。

## 调试

看 `%APPDATA%/THEIA/auth-diagnostics.ndjson` 和设置中的活动日志。日志应足以判断来源、阶段、HTTP 状态、耗时、认证状态；补日志时只能加安全元数据。
