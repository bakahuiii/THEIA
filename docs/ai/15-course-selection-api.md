# 抢课 API 与目标记录

## 传输

`CourseSelectionService` 的选课批次、候选班、全校课表和选课 POST 均使用 `courseSelectionClientFactory`。THEIA 主进程将它绑定为 `courseSelectionApiSession()`，从加密保存的教务 API 账号密码创建 `AcademicApiClient`。

- API 客户端的 cookie jar 只存在内存，不写入磁盘。
- 学校请求保持直连，不走 `127.0.0.1:7897` 或其他系统代理。
- 不使用 Electron 统一认证会话、不镜像其 Cookie。
- 读取批次时遇到 API 会话失效（`code === 1006`）可以重新登录一次。选课 POST 绝不自动重放，防止重复提交。

如果 API 未启用或没有保存凭据，必须显示明确配置错误。不能静默回退到浏览器模拟提交。

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
