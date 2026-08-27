# THEIA 代码审查与修复 — 交接报告

> 日期：2026-08-26
> 范围：全量通读 + 缺陷修复 + 回归测试。与 Codex（正在修复抢课）的工作边界已在第 6 节明确。

---

## 1. 我做了什么（已完成）

### 1.1 全量代码通读
- 亲自通读：`main.mjs`(5408行)、`sync-service.mjs`(1414)、`read-only-agent.mjs`(1296)、`advisor-runtime.mjs`(1293)、`model-service.mjs`(1085)、`course-selection.mjs`(1013)、`course-work.mjs`(536)、`lazy-workspace.mjs`(1121)、`store.mjs`、`schema.mjs`、`local-api.mjs`、`source-client.mjs`、`webmail-service.mjs`(595)、`imap-mail-service.mjs`(443)、`theia-mcp.mjs`(828)、`gpa.mjs`、`user-data-view.ts`、`useTheiaApp.ts`(937)、`bridge.ts`、`App.tsx`、`preload.cjs`、`ipc-security.mjs`、`ipc-registration.mjs` 等。
- 派 4 个并行子代理覆盖剩余：electron 全部 20 文件、core 全部 31 小文件、src 全部视图/hooks/layout、cli/scripts/integration/tests 抽样。
- 产出：**`FULL-REVIEW-FINDINGS.md`**（F1–F36 完整缺陷清单 + 冲突边界 + 修复顺序）。

### 1.2 已修复并验证（13 项有效修复）

| # | 文件 | 修复内容 | 回归测试 |
|---|---|---|---|
| F2 | `core/data-catalog.mjs` | `cachedMotionVenueStatuses` null 崩溃 → `/v1/venue-statuses` 挂起 | ✅ 新增 |
| F4 | `src/bridge.ts` | Web 模式 `window.open` 接受 `javascript:` URL | 桥测试 |
| F5 | `core/advisor/full-access-tools.mjs` | permissionMode 默认 `full-access`(fail-open) → `read-only` | ✅ 权限测试 |
| F10 | `electron/{mail,academic-api,credential}-vault.mjs` + `iris-companion.mjs` | 4 个 vault 写队列缺 `.catch()` → 一次失败永久毒化后续保存 | vault 测试 |
| F11 | `electron/iris-companion.mjs` | spawn `error` 后 `child` 未清 → 误报 running、无法重启 | iris 测试 |
| F12 | `electron/advisor-overview-service.mjs` | 证据 map 键 `candidate.id` vs 查找 `normalizeText(id)` 不匹配 | overview 测试 |
| F13 | `core/schema.mjs` | 富邮件黑名单可被 HTML 实体编码绕过 → 加 `decodeHtmlEntities` 复检 | store 测试 |
| F14 | `core/schema.mjs` | ICS 未转义 `\r` → 行注入 | store 测试 |
| F15 | `core/schema.mjs` | CSV 公式前缀 `=+@-` + `\r` 未防护 | store 测试 |
| F16/F17 | `src/user-data-view.ts` | attentionItems 中 exam 用 assignments 域投影（状态错） + 缺失状态标签 | ✅ 本地 API 测试 |
| F6 | `core/store.mjs` | `writeAtomic` 先 `rm` 再 `rename`（Windows 丢数据）→ 先原子 rename，失败才回退 | store 测试 |
| F7 | `core/store.mjs` | `save()` 不重读磁盘合并（跨进程丢更新）→ 锁内重读，磁盘最新优先 | store 测试 |
| F8 | `core/sync-service.mjs` | `flushQueuedSync` 在 `startSync` 同步 throw 时 Promise 永不 settle → 挂死 | sync 测试 |
| F18 | `src/layout/TitleBar.tsx` | `toggleMaximize` 状态可能与主进程反转 → 查询权威值 | — |
| F19 | `core/academic-api-client.mjs` | 非 binary 响应无大小上限（内存无界）→ 16MB 上限 | adapter 测试 |
| F20 | `core/settings-transaction.mjs` | 回滚不还原 localApi 端口 → 存储与活进程分离 | settings 测试 |
| F21 | `core/adapters/theol.mjs` | mobile 回退清空全部错误 → 只移除被覆盖课程的失败 | ✅ adapters 测试 |
| F23 | `cli/theia-cli.mjs` | 数据损坏时 `doctor` 无法运行 → doctor 单独容错加载 | ✅ cli 测试 |
| F26 | `electron/ultra-mode/orchestrator.mjs` | sub-agent token 重复计数 → total 用 provider 精确值 | ultra 测试 |
| F27 | `src/App.tsx` | ErrorBoundary 未绑视图 key（崩溃残留）→ `key={view}` | — |
| F28 | `src/App.tsx` | `onRefreshResources`/`onDownloadResource` 未处理拒绝 → async try/catch | — |

### 1.3 补的回归测试
- `tests/gpa.test.mjs`：D/D+ 通过、D- 不识别、F/U 失败
- `tests/motion-data-catalog.test.mjs`：`cachedMotionVenueStatuses` 空 activity 不崩溃（新增 2 个用例）
- `tests/source-client.test.mjs`：恢复原 secure cookie 测试（见 1.4）
- `tests/adapters.test.mjs`、`tests/store-and-api.test.mjs` 等既有测试全过

### 1.4 已回滚 / 撤销的修改（重要！）

| 项 | 原因 | 当前状态 |
|---|---|---|
| **F9 secure cookie 过滤** | 我一度在 `source-client.mjs` 过滤 `secure:true` cookie 防明文泄漏，但 **THEOL mobile 端点 `http://course.buct.edu.cn/mobile/stuUnDoTaskList.do` 依赖 HTTPS 建立的 secure 会话 cookie**，过滤会直接破坏移动端回退登录。**已完全回滚**代码 + 测试 | 恢复原行为 |
| **F1 gpa D- 修复** | 子代理误报：声称 `LETTER_POINTS` 含 `D-`=1.33，**实际代码里没有 D-**（只有 D=1、D+=1.33）。我的"修复"反而让 `isPassedGrade('D-')=true` 但 `gradePoint` 为 null，破坏一致性。**已回滚**，并补测试明确 D- 不识别 | 恢复原行为 |

---

## 2. 验证状态

- `npx tsc -b`（TS 构建）：**通过** ✅（修复过 F28 引入的 2 个类型错误）
- 我改动的相关测试（gpa/data-catalog/store/source-client/sync/settings/advisor/iris/user-data/adapters/runtime）：**全过** ✅
- 全量 `npm test`：**1836/1838 通过**，2 个失败与我无关：
  - `advisor-ui.test.mjs:339` — 断言 `styles.css` 的 `.topbar-sync-banner` 不含 `position:absolute`，但当前 styles.css（被改过）含该样式
  - `course-selection.test.mjs:335` — Codex 正在改 course-selection.mjs，测试未同步

---

## 3. 还有哪些已知 bug 没修（按优先级）

### 中优先级（建议尽快）
| # | 位置 | 问题 |
|---|---|---|
| F25 | `core/advisor/agent-permissions.mjs:9-15` | "只读"模式仍暴露 `network_request`/`update_theia_settings`/`control_course_selection` 副作用工具（需产品决策：收窄 or 明示） |
| F13b | `core/schema.mjs:16` | 黑名单复检只覆盖实体编码，`\u006f` JS 转义形式未覆盖（渲染器 CSP 兜底，风险低） |
| F24 | `scripts/fix-theia-startup.bat:49-53` | 删 `.write.lock` 前仅 kill THEIA.exe，可能漏辅助进程 |

### 低优先级 / 防御深度
| # | 位置 | 问题 |
|---|---|---|
| F22 | `core/academic-api-adapter.mjs:184-189` | status() 仅凭配置报 connected，无真实探测（**有意设计**，避免 API/浏览器会话互相驱逐——不改） |
| F31 | `core/advisor/full-access-tools.mjs` | Agent 文件工具无 `..` 越界限制（全访问模式，防御深度） |
| F32 | `src/views/ScheduleView.tsx:497` | 颜色 fallback（**非 bug**：后端已赋值 `item.color`，前端只是兜底） |
| F33-F36 | scripts/integration 小项 | benchmark 复用可变对象、Windows pid 检测、styles.css.bak 清理、model-network-policy close 挂起 |

### 结构性（长期）
- S1 `main.mjs` 5408 行拆分（auth/source-windows/diagnostic-modes）
- S2 4 个诊断模式环境变量收敛
- S4 `useTheiaApp` 90+ 属性 hook 拆分
- S5 为竞态补测试（F8 已补，B14/B15 未补）
- S7 `modelRouting` 是死配置（UI 有、未生效）

---

## 4. 待办（按四天计划）

- [ ] **Day 1 剩余**：确认上述中优先级（F25 需产品决策）
- [ ] **Day 2**：S1/S2 结构拆分、F3 作业自动流水线触发（`onSnapshot` → 检测新作业 → 入队 + 用户开关）
- [ ] **Day 3**：手机版（Capacitor 原生壳 + mobileBridge + LAN 桥令牌复用 B2）+ **B2 本地 API 令牌认证**（F3，手机 LAN 桥安全前提，未做！）
- [ ] **Day 4**：发布（build/smoke/0.6.0 文档/安装包/APK）

---

## 5. 重要提醒（新发现，未处理）

1. **B2 / 本地 API 令牌认证（F3）完全没做** —— 这是手机版 LAN 桥的前置安全条件，且当前 `Origin: null` 授予任意本地 file:// 页面全量读取。**优先级最高。**
2. **全量测试的 2 个失败**：styles.css 回归 + course-selection 测试不同步，发布前必须处理（前者可能是 Codex 改动引入的样式回归，需要确认）。
3. **未提交改动很多**（git status 约 40 个文件 modified），包含 Codex 的抢课改动和我的修复。发布前需要一起 review + commit，注意**不要用 `git add .` 一次性提交**，按模块分开提交。

---

## 6. 与 Codex 的边界（勿越界）

**Codex 正在改（本次不碰）：**
- `core/course-selection.mjs`（22:57 最新）
- `core/course-selection-journal.mjs`（17:33）
- `electron/ipc-registration.mjs`（18:04）
- `src/views/CourseSelectionView.tsx`（18:16）
- `tests/course-selection*.test.mjs`、`docs/ai/15-course-selection-api.md`

**我改过但 Codex 可能也在碰的文件（改前必须重新 diff）：**
- `core/data-catalog.mjs`（22:40 被改，我修了 F2）
- `electron/main.mjs`（22:07 被改，我没动）
- `core/source-client.mjs`（21:22 被改，我改了又回滚了 F9，当前等于原状）
- `src/types.ts`（22:53 被改，我没动）
- `src/hooks/useTheiaApp.ts`（17:31 被改，我没动）

---

## 7. 我改过的文件清单（供 review/commit 参考）

```
core/gpa.mjs                        （F1 回滚后 = 原状）
core/data-catalog.mjs               F2
core/schema.mjs                     F13/F14/F15
core/store.mjs                      F6/F7
core/sync-service.mjs               F8
core/settings-transaction.mjs       F20
core/academic-api-client.mjs        F19
core/advisor/full-access-tools.mjs  F5
core/adapters/theol.mjs             F21
electron/mail-vault.mjs             F10
electron/academic-api-vault.mjs     F10
electron/credential-vault.mjs       F10
electron/iris-companion.mjs         F10/F11
electron/advisor-overview-service.mjs  F12
electron/ultra-mode/orchestrator.mjs   F26
cli/theia-cli.mjs                   F23
src/bridge.ts                       F4
src/user-data-view.ts               F16/F17
src/layout/TitleBar.tsx             F18
src/App.tsx                         F27/F28
tests/gpa.test.mjs                  回归测试
tests/motion-data-catalog.test.mjs  回归测试（F2）
tests/source-client.test.mjs        F9 回滚后 = 原状
FULL-REVIEW-FINDINGS.md             审查清单
RELEASE-PLAN-4DAY.md                四天计划
HANDOVER-REPORT-20260826.md         本文件
```
