# 抢课 API 与目标记录

## 传输

`CourseSelectionService` 的选课批次、候选班和选课 POST 使用已完成统一身份认证的 Electron 教务会话；全校课表优先使用同一会话，失效时才使用独立的教务 API 会话读取。这样选课请求能携带正方页面生成的完整上下文，而不会把 API 登录状态误当成浏览器选课状态。

- API 客户端的 cookie jar 只存在内存，不写入磁盘。
- 学校请求保持直连，不走 `127.0.0.1:7897` 或其他系统代理。
- 选课流程不镜像或持久化 Cookie；统一认证恢复只重新建立只读教务会话。
- 读取批次时遇到会话失效（`code === 1006`）可以重新完成一次认证。选课 POST 绝不自动重放，防止重复提交。

目标定位先使用正方目录的课程号/名称筛选；如果当前部署忽略筛选字段，会在每个已发布批次内按正方的 1-based 起止行范围（每页最多 100 行，例如 `kspage=1&jspage=100`、`101..200`）做有限的无筛选分页扫描，并只对本地匹配的课程读取教学班。扫描最多 50 页，遇到空页、短页或重复页即停止；全校课表中存在但选课目录未发布的课程不会被伪造为可选目标。

选课诊断写入 `auth-diagnostics.ndjson`，包括入口状态、目录请求/响应、教学班请求/响应、任务日志和提交结果。`xkkz_xh`、`jxb_ids`、`jcxx_id` 等重放敏感值只记录为 `[present]`，不会把令牌写入日志。

如果统一认证会话不可用，必须显示明确的认证错误；不能静默用独立 API 账号替代页面上下文来提交选课。

入口页的 `iskxk`、`isinxksj`、`isInylsj` 和 `xksjxskz` 是选课阶段门控。即使页面残留静态选课模块，只要正方返回阶段关闭或“当前不属于选课阶段”，THEIA 也不会继续请求课程目录，会记录 `PORTAL_NOT_OPEN` 并按较长间隔等待下一次只读探测。

## 目标审计

`设为目标` 通过 `theia:save-course-selection-target` 写入 `%APPDATA%\\THEIA\\course-selection\\records.json`。该文件由 `CourseSelectionJournal` 使用临时文件和 rename 替换，包含：

- 当前目标的课程、班级、教师、学期、时间、地点、学分与选定时间。
- 最多 160 条的任务状态摘要（任务 ID、尝试次数、结果）。

禁止写入密码、Cookie、登录令牌、原始 HTML、响应正文、`operationId` 或任何可用于重放选课请求的字段。普通任务重启后不恢复；已启用且仍处有效窗口的哨兵会恢复未完成目标。记录用于恢复安全目标、显示状态与审计。

## IPC 改动

`TheiaBridge` 、`electron/preload.cjs` 和 `src/bridge.ts` 必须同时包含 `saveCourseSelectionTarget(target)`。`getCourseSelection()` 与 `theia:course-selection` 事件均返回目标字段，以便渲染器重启后恢复显示。

## 测试

- `tests/course-selection.test.mjs`：验证选课 POST 负载，并确认配置 API factory 时不使用浏览器 client。
- `tests/course-selection-journal.test.mjs`：验证目标持久化、重载和敏感字段剔除。
