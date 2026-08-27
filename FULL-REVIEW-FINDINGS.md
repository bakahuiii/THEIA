# THEIA 全量代码审查 — 缺陷清单与修复边界

> 2026-08-26 完成对仓库的**全量通读**（core/、electron/、src/、integration/、cli/、scripts/、tests/）。
> 本清单汇总所有已确认缺陷（含多轮子代理独立审查 + 人工验证），并标注**冲突边界**（Codex 正在修复抢课部分，相关文件不碰）。

---

## 0. 冲突边界（最重要）

**Codex 正在修复抢课，以下文件本次一律不修改：**

| 文件 | 说明 |
|---|---|
| `core/course-selection.mjs` | 抢课核心（22:57 最新修改） |
| `core/course-selection-journal.mjs` | 抢课记录（17:33） |
| `electron/ipc-registration.mjs` | 抢课 IPC（18:04） |
| `src/views/CourseSelectionView.tsx` | 抢课 UI（18:16） |
| `tests/course-selection*.test.mjs` | 抢课测试 |
| `docs/ai/15-course-selection-api.md` | 抢课文档 |

**以下文件 Codex 最近动过，修改前必须重新 diff 确认：** `core/data-catalog.mjs`(22:40)、`electron/main.mjs`(22:07)、`core/source-client.mjs`(21:22)、`src/types.ts`(22:53)、`src/hooks/useTheiaApp.ts`(17:31)。

**其余文件（8/22 或更早，与抢课无交集）可安全修复。**

---

## 1. 严重（High）— 数据正确性 / 崩溃 / 安全

| # | 位置 | 缺陷 | 修复 | 冲突 |
|---|---|---|---|---|
| F1 | `core/gpa.mjs:129` | `isPassedGrade` 字母正则 `/^(?:A[+-]?|B[+-]?|C[+-]?|D[+]?)$/` **漏了 `D-`**，而 `LETTER_POINTS` 定义 `D-`=1.33。带 `D-` 成绩（无显式 point）被判未通过 → 已获学分、GPA 计算错误 | 正则改为 `D[+-]?` | ✅ 安全 |
| F2 | `core/data-catalog.mjs:689,695` | `cachedMotionVenueStatuses` 对 null `activity` 调 `.toLocaleLowerCase()` 崩溃 → `/v1/venue-statuses` 挂起 | `String(motionVenueText(...) ?? '')` | ⚠️ 22:40 被改，修前重读 |
| F3 | `core/local-api.mjs:24-35,147-232` | 本地 API 无认证；`Origin: null` 被回显 ACAO，本地 `file://` 页可读走全部数据；`POST /v1/agent/chat` CSRF | 令牌 + 去 `"null"` 授权 + 真实请求校验 Origin | ✅ 安全 |
| F4 | `src/bridge.ts:325-328` | Web 模式 `window.open(url)` 不校验 scheme，`javascript:` 可执行 | `if (!/^https?:\/\//iu.test(url)) return false` | ✅ 安全 |
| F5 | `core/advisor/full-access-tools.mjs:72` | `createAdvisorFullAccessTools` 默认 `permissionMode='full-access'`（fail-open） | 默认改 `'read-only'` | ✅ 安全 |

## 2. 中高（Medium-High）— 竞态 / 数据丢失 / 泄漏

| # | 位置 | 缺陷 | 修复 | 冲突 |
|---|---|---|---|---|
| F6 | `core/store.mjs:73-80` | `writeAtomic` 先 `rm` 再 `rename`：Windows rename 失败即丢 manifest；崩溃窗口丢数据；无 fsync | 去掉 `rm` 直接 `rename` + fsync | ✅ 安全 |
| F7 | `core/store.mjs:440-447` | `save()` 不重读磁盘合并，跨进程丢失更新 | 锁内重读 + mergeConcurrentReplacement | ✅ 安全 |
| F8 | `core/sync-service.mjs:738-760` | `flushQueuedSync` 在 `startSync` 同步 throw 时 Promise 永不 settle → 挂死 | try/reject | ⚠️ 8/22 改过，修前重读 |
| F9 | `core/source-client.mjs:69-80,164` | ~~`Secure` cookie 经显式 Cookie 头在明文 HTTP 发送~~ → **已决策：保留原行为**。THEOL mobile 回退端点（`http://course.buct.edu.cn/mobile/stuUnDoTaskList.do`）依赖 HTTPS 建立的 secure 会话 cookie，过滤会直接破坏登录。URL 策略已严格限定 `*.buct.edu.cn`，泄漏面受控 | 不修改（2026-08-26 尝试修复后回滚） | ⚠️ 21:22 被改，修前重读 |
| F10 | `electron/mail-vault.mjs:64` + `electron/academic-api-vault.mjs:57` | 写队列链缺 `.catch(()=>{})`，一次写失败**永久毒化**后续所有保存 | 链式 `.catch(() => {})` | ✅ 安全 |
| F11 | `electron/iris-companion.mjs:280` | spawn `'error'` 后 `this.child` 未清，`status()` 误报 running:true、无法重启 | error 时清 child | ✅ 安全 |
| F12 | `electron/advisor-overview-service.mjs:329` | 课程选择证据 map 用 raw `candidate.id` 键（:287），查找用 `specification.entityId`（`entity:<digest>` 形式，:271）→ **永远不匹配**，候选输入证据被丢弃 | 键统一为 entityId | ✅ 安全 |

## 3. 中（Medium）

| # | 位置 | 缺陷 | 修复 | 冲突 |
|---|---|---|---|---|
| F13 | `core/schema.mjs:16,165-171` | 富邮件 HTML 黑名单可被实体编码绕过 | 实体解码后复检 / 白名单 | ✅ 安全 |
| F14 | `core/schema.mjs:505-507` | `icsEscape` 未转义 `\r` → ICS 行注入 | 转义 `\r` | ✅ 安全 |
| F15 | `core/schema.mjs:494-497` | CSV 未转义 `=`/`+`/`-`/`@` 前缀 → 公式注入 | 前缀加 `'` | ✅ 安全 |
| F16 | `src/user-data-view.ts:214-215` | attentionItems 中 **exam 项用 domain `"assignments"` 投影** → 状态标签错误（exam 被判成 pending 而非 upcoming） | `.map((item) => projectRecord(item, "exams", now))` | ✅ 安全 |
| F17 | `src/user-data-view.ts:129-134` | `statusLabel` 缺 `auth-required`/`failed`/`confirmed-empty`/`not-read` 标签 | 补条目 | ✅ 安全 |
| F18 | `src/layout/TitleBar.tsx:21-24` | `toggleMaximize` 无条件翻转状态，可能与主进程 toggle 反转 | 调 `windowIsMaximized()` 取权威值 | ✅ 安全 |
| F19 | `core/academic-api-client.mjs:322-324` | 非 binary 响应 `Buffer.from(await response.arrayBuffer())` **无大小上限**（内存无界） | 加 bounded 读取 | ✅ 安全 |
| F20 | `core/settings-transaction.mjs:80-101` | rollback 无法撤销已重启的 local-api 新端口 → 存储 apiPort 与活进程分离 | 记录原端口并在回滚时还原 | ✅ 安全 |
| F21 | `core/adapters/theol.mjs:428-429` | mobile 回退成功**清空先前所有错误/failedCourseIds** → 部分扫描误报 complete | 合并而非覆盖 | ⚠️ 8/22 改过 |
| F22 | `core/academic-api-adapter.mjs:184-189` | `status()` 仅凭配置报 connected，无真实探测 | 加轻量探测 | ✅ 安全 |
| F23 | `cli/theia-cli.mjs:118` | 数据损坏时 `doctor` 命令无法运行（loadRuntime 先抛） | doctor 分支延迟 load / 容错 | ✅ 安全 |
| F24 | `scripts/fix-theia-startup.bat:49-53` | 删 `.write.lock` 前仅 kill THEIA.exe，可能漏辅助进程 | 更彻底进程检查 | ✅ 安全 |
| F25 | `core/advisor/agent-permissions.mjs:9-15` | 只读模式仍暴露 `network_request`/`update_theia_settings`/`control_course_selection` 副作用工具 | 确认产品意图后收窄 | ✅ 安全（需决策） |
| F26 | `electron/ultra-mode/orchestrator.mjs:353-356,464-482` | 子代理输出 token 跨累加器重复计数 | 统一累加 | ✅ 安全 |
| F27 | `src/App.tsx:136` | 单一 ErrorBoundary 未绑定视图 key：崩溃后切视图仍显示错误 | `key={app.view}` | ✅ 安全 |

## 4. 中低（Medium-Low）

| # | 位置 | 缺陷 | 修复 | 冲突 |
|---|---|---|---|---|
| F28 | `src/App.tsx:205-207` | 直接返回 Promise 给 onClick，未处理错误 | `void fn().catch()` | ✅ 安全 |
| F29 | `src/hooks/useTheiaApp.ts:790` | `term.id.split("-")[0]` 未保护 → 白屏 | `String(term.id || '')` | ⚠️ 17:31 被改 |
| F30 | `src/hooks/useTheiaApp.ts:717` | `setSchoolScheduleRefreshFailed(Boolean(schoolSchedule))` 用过期闭包 | 更新器回调 | ⚠️ 17:31 被改 |
| F31 | `core/advisor/full-access-tools.mjs:109-128` | Agent 文件工具无 `..`/越界限制（防御深度） | agentPath 规范化 | ✅ 安全 |
| F32 | `src/views/ScheduleView.tsx:497` | 所有课程槽同一颜色（COURSE_ACCENTS 未用）——**需确认后端 `item.color` 是否已赋值** | 用后端 color 或按标题哈希索引 | ✅ 安全 |
| F33 | `scripts/benchmark-advisor.mjs:110` | 热基准复用同一可变对象，可能污染 | 每次克隆 | ✅ 安全 |
| F34 | `integration/theia-client.mjs:14` | `process.kill(pid,0)` 在 Windows 上 EPERM 误报 | 容错 | ✅ 安全 |
| F35 | `src/styles.css.bak` | 仓库里 73KB 的备份文件 | 删除（确认无用后） | ✅ 安全 |
| F36 | `electron/model-network-policy.mjs` | `close()` 无 force 时可能挂起 | 超时兜底 | ✅ 安全 |

---

## 5. 修复执行顺序（不碰抢课域）

```
第 1 批（纯数据正确性/崩溃，低风险，立即做）：
  F1 gpa D- 漏判（最高价值）
  F2 data-catalog null 崩溃（修前重读当前文件）
  F16/F17 user-data-view 投影 bug
  F10 mail/academic vault 写队列毒化
  F11 iris spawn error
  F12 advisor-overview evidence 键不匹配
  F5 full-access fail-open 默认
  F4 bridge window.open scheme

第 2 批（注入/安全）：
  F13/F14/F15 schema 注入类
  F19 academic-api 无界读取
  F9 secure cookie（修前重读 source-client）
  F3 local-api 令牌（较大，单独做）

第 3 批（数据一致性/竞态）：
  F6/F7 store writeAtomic + save()
  F8 sync flushQueuedSync（修前重读）
  F20 settings-transaction rollback

第 4 批（前端健壮性）：
  F27 ErrorBoundary key、F28、F18 TitleBar
  F32 ScheduleView 颜色（需确认后端）

第 5 批（确认/收尾）：
  F25 只读工具边界（需产品决策）
  F23 CLI doctor、F24 bat、F33/F34/F35/F36
```

每个修复完成后运行对应测试：`node --test --test-concurrency=4 tests/<相关>.test.mjs`，最后全量 `npm test`。

---

## 6. 已确认良好的设计（保持，勿动）

- IPC 参数 schema 校验（`ipc-security.mjs`）、URL 策略（`source-url-policy.mjs`）、CSP（`renderer-security.mjs`）
- 分片存储 + SHA-256 校验 + 双 manifest 回退（`store.mjs`）
- 富邮件 HTML 净化器（`imap-mail-service.mjs sanitizeHtml`）+ 渲染 iframe CSP/sandbox
- MCP 只读桥（`theia-mcp.mjs`）的参数校验、请求大小限制、snapshot 一致性双读
- Agent 工具输入边界（`full-access-tools` + `read-only-tools`）、邮件正文授权（messageGrants）、不可信文本脱敏
- 抢课服务的并发槽、PORTAL_NOT_OPEN 退避、sentinel 窗口（Codex 正在优化的部分）
