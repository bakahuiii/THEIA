# 作业、模型与抢课

## 课程作业工作区

`core/course-work.mjs` 在数据根 `course-work/<assignment-id>/` 建受控工作区，包含 manifest、题目、附件、导入答案和模型结果。路径/文件名必须用服务内安全函数生成，不能信任远端文件名或 renderer 路径。

THEOL 页面解析在 `core/parsers/theol-work.mjs`。`CourseWorkService` 负责准备、导入、保存；主进程把文件附加到内置提交页或填入在线测试。最终提交永远留给用户。

## 模型服务

- `electron/model-vault.mjs`：加密 API key。
- `electron/model-service.mjs`：OpenAI-compatible `/models`、chat completion、答案 JSON 提取、作业/笔记/论文生成。
- 附件文字由 `core/attachment-reader.mjs` 提取；单附件和总上下文都有上限，防止模型上下文膨胀。

配置由 `settings.modelBaseUrl/modelName/modelModels` 承载，key 不在 settings。模型返回的测试答案先经既有格式验证，才允许填入页面。

这里的 `ModelService` 是既有作业/笔记/论文工作流及 OpenAI-compatible transport，不是顾问编排器。P0 Advisor overview 完全离线且不调用它。未来的 `AdvisorRuntime` 还必须独立实现请求时快照与 claim catalog 冻结、最小披露与敏感域 consent、严格 narrative schema、引用验证、取消/预算和受控工具循环；不能通过给 `ModelService` 增加一个 prompt 就视为完成。

当前 P0 也不表示 P1 Advisor UI 或培养方案、GPA、学分缺口、选课沙盘等复杂规则已经完成。已实现范围见 `16-advisor-p0-foundation.md`。

## 抢课

`core/course-selection.mjs` 通过主进程提供的隔离教务 API session 发现批次、读取候选，并按用户保存的目标节制重试。使用抢课前必须启用教务 API 并保存独立凭据；该 session 不复用统一认证 Cookie。读取操作遇到会话失效时可重新登录，选课 POST 不得自动重放。完整传输与哨兵恢复规则见 `15-course-selection-api.md`。

改抢课前读对应测试：避免快速重试、重复提交、错学期和绕过用户停止。选课状态必须可停止、可见、可解释。
