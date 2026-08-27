# THEIA 续作交接报告 — 2026-08-27

> 日期：2026-08-27（承接 2026-08-26 交接报告的"继续干"）
> 本次完成：**B2/F3 本地 API 令牌认证（最高优先级项）** + 全量回归验证 + 修复 advisor-ui 测试误报。

---

## 1. 本次完成（B2 / F3 —— 本地 API 令牌认证，Day 1 遗留的最高优先级）

### 1.1 core/local-api.mjs
- 每实例生成 32 字节 base64url 令牌（`randomBytes`），写入 `api-runtime.json`（`token` 字段），每次启动重新生成，返回值新增 `token`。
- **每个请求必须携带令牌**：`Authorization: Bearer <token>` 或 `?token=<token>`；缺失/错误返回 `401 { error: 'unauthorized' }`。比较用 `timingSafeEqual`。
- **去掉 `Origin: null` 授权**：任意本地 `file://` 页面的 null Origin 一律 `403 origin_not_allowed`（此前会被回显为 ACAO 从而读走全部学生数据）。
- **真实请求 CSRF 防护**：带非白名单 `Origin` 的真实请求（含 `POST /v1/agent/chat`）在触达数据前返回 `403`；`OPTIONS` 预检只允许 `theia:`、`http(s)://127.0.0.1:*`、`http(s)://localhost:*`，且 `Access-Control-Allow-Headers` 加入 `Authorization`。
- 无 Origin 的本机脚本请求仍可访问，但同样必须带令牌。

### 1.2 集成消费者（已同步）
- `integration/theia-client.mjs`：新增 `discoverTheiaRuntime()`（返回 `{ baseUrl, token }`，校验令牌存在）；`discoverTheiaApi()` 保持兼容；`fetchTheiaFeed()` 自动附加 Bearer 令牌。
- `integration/theia-mcp.mjs`：`createTheiaSnapshotProvider` 新增 `token`（含 `THEIA_MCP_API_TOKEN` 环境变量）；自动发现时从 runtime 文件取令牌；`fetchJson` 有令牌时附加 Authorization 头。显式 `THEIA_MCP_API_URL` 时不会误触发 runtime 发现（兼容既有 MCP 测试）。
- `cli/theia-cli.mjs`：无需改动（`theia serve` 发布含令牌的 runtime 文件；`theia api` 打印完整 runtime 含令牌）。

### 1.3 回归测试（新增 + 更新）
- **新增 `tests/local-api-security.test.mjs`（9 用例全绿）**：无令牌 401、错令牌 401、Bearer/query 通过、null Origin 403（真实请求 + 预检）、跨站 Origin CSRF 403（含 POST /v1/agent/chat）、回环 Origin 204/200 + ACAO 回显、Host 伪造 421、agent chat 令牌门禁 + 405、runtime 文件含令牌 + 每实例唯一。
- 更新 5 个既有测试文件的 `startLocalApi` 调用（统一加 `Authorization: Bearer <api.token>`）：`store-and-api`、`data-output-contract`、`user-data-view`、`academic-plan-document`、`runtime-lifecycle`；其中 `store-and-api` 的 Origin 断言从"null 放行 200"改为"null 拒绝 403"。
- `tests/theia-client.test.mjs`：fixture 补 token 字段 + 新增"令牌缺失报错"用例。
- **`tests/advisor-ui.test.mjs:347` 误报修复**：原正则 `/.topbar-sync-banners*{[sS]*?position:s*absolute/` 会跨规则匹配到文件后部的 `.map-positioning-status { position: absolute }`（新加的校园地图样式），与 banner 无关。改为 `[^}]*` 限定在同一规则体内。**确认 HEAD 版本 banner 块本就无 position:absolute，非样式回归**。

### 1.4 文档
- `docs/ai/12-local-api-cli.md`、`docs/reference/api-and-ipc.md`、`docs/ai/22-distribution-compatibility-and-recovery.md`、`integration/README.md`：更新令牌要求、null Origin 拒绝、`THEIA_MCP_API_TOKEN` 说明。

---

## 2. 验证状态（全绿）

- **全量 `npm test`：874/874 通过（0 失败）** ✅（上日 1836/1838 的 2 个失败均已解决：advisor-ui 误报已修；course-selection 测试已随 Codex 实现同步）
- **`npx tsc -b`：通过** ✅
- **实机验证 `theia serve`**：runtime 文件含 43 字符令牌；无令牌 401、错令牌 401、Bearer/query 令牌 200、feed 200、null Origin 403 ✅

---

## 3. 剩余待办（沿四天计划）

- **Day 1 剩余**：F25 只读 Agent 工具边界（`agent-permissions.mjs`，需产品决策：收窄 or 明示）——仍未处理。
- **Day 2**：S1/S2 main.mjs 结构拆分（5408 行）；F3 作业自动流水线触发（`onSnapshot` → 检测新作业 → 自动入队 + 用户开关）。
- **Day 3**：手机版（Capacitor 原生壳 + mobileBridge + **LAN 桥令牌复用 B2**——前置条件本次已就绪）+ 响应式布局；桌面端"显示令牌供手机输入"的 UI 待做。
- **Day 4**：发布（build/smoke/0.6.0 文档/安装包/APK）。

---

## 4. 与 Codex 的边界（保持，勿越界）

**Codex 正在改（本次不碰）：**
- `core/course-selection.mjs`（8/27 01:42 仍在改）、`tests/course-selection.test.mjs`（01:41）、`course-selection-journal.mjs`、`ipc-registration.mjs`、`CourseSelectionView.tsx`、`docs/ai/15-course-selection-api.md`

**本次我改过、Codex 可能也在碰的文件（改前必须重新 diff）：**
- 无交集（本次改动均在 local-api / integration / 相关测试 / 文档，与抢课域分离）

---

## 5. 本次改动的文件清单（供 review/commit 参考）

```
core/local-api.mjs                        B2/F3 令牌认证 + Origin 收紧 + CSRF
integration/theia-client.mjs              令牌发现 + fetchTheiaFeed 自动附加
integration/theia-mcp.mjs                令牌参数 + 自动发现携带
tests/local-api-security.test.mjs        新增 9 用例安全回归
tests/store-and-api.test.mjs             令牌化 + Origin 断言更新
tests/data-output-contract.test.mjs      令牌化
tests/user-data-view.test.mjs            令牌化
tests/academic-plan-document.test.mjs    令牌化
tests/runtime-lifecycle.test.mjs         令牌化
tests/theia-client.test.mjs              token fixture + 令牌缺失用例
tests/advisor-ui.test.mjs                 正则误报修复（[^}]* 限域）
docs/ai/12-local-api-cli.md              安全边界更新
docs/reference/api-and-ipc.md            令牌 + null Origin 拒绝
docs/ai/22-distribution-compatibility-and-recovery.md  0.6.0 令牌说明
integration/README.md                    THEIA_MCP_API_TOKEN
HANDOVER-REPORT-20260827.md              本文件
```

> 提醒：本地 API 令牌是手机版 LAN 桥的安全基础，本次已落地；Day 3 可直接复用（手机端从桌面 UI/导入页获取 baseUrl + token）。
