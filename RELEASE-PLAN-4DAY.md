# THEIA 四天冲刺发布计划

> 目标：**4 天内修复已知缺陷、补齐关键功能并发布桌面版 v0.6.0 + 一版手机版（原生 Android 包）**。
> 依据：对 THEIA 代码库的完整审查（本轮对话产出） + 现有规划文档（`AI_DIRECTION.md`、`docs/README.md`）。
> 强度：持续高强度工作；本计划按"必须 / 应该 / 可以"分级，保证 4 天内产出可发布版本。
> 原则：**本地优先、无服务器** → 不做任何云同步/自动更新/远程下发；升级靠发布新包人工安装。

---

## 0. 交付目标

| 交付物 | 说明 | 验收标准 |
|---|---|---|
| 桌面版 v0.6.0 | 修复审查发现的高危/中危缺陷，补充回归测试 | `npm test` 全绿、`npm run build` 通过、smoke 通过 |
| 手机版（原生包） | **Capacitor 原生壳 + 现有 React 视图**，覆盖**只读数据浏览**，产出可安装 APK | APK 可安装启动；导入快照/LAN 桥可用；3 个核心视图数据正确 |
| 发布包 | Windows 安装包 + 源码归档 + 校验和 + 发行说明 + 手机 APK | 与 v0.5.0 相同发布规范；手机版随附 APK + 说明 |

> **更新机制决策**：THEIA 本地优先且无服务器，**不实现自动更新**。桌面版沿用"发行说明 + 人工下载安装"，手机版沿用"APK 人工安装"（Android 侧载）。这是产品取舍而非遗漏，文档与发布说明中明示。

---

## 1. 缺陷修复清单（来自代码审查，按严重度）

> 每项含：文件:行号、现象、修复方向。**P0 必须在第 1 天完成**。

### 🔴 严重（P0，第 1 天）

| # | 位置 | 缺陷 | 修复方向 |
|---|---|---|---|
| B1 | `core/data-catalog.mjs:689,695` | `cachedMotionVenueStatuses` 中 `motionVenueText(...).toLocaleLowerCase()` 对 null 崩溃 → `/v1/venue-statuses` 挂起无响应 | `String(motionVenueText(...) ?? '')` 或可选链 |
| B2 | `core/local-api.mjs:24-35,147-232` | 本地 API **无认证**；`Origin: null` 被回显为 `Access-Control-Allow-Origin: null`，任何本地 `file://` 页面可读走全部学生数据 | 去掉 `"null"` 来源授权；引入每实例令牌（token 写入 `api-runtime.json`，请求须携带）；真实请求也校验 Origin；CSRF 防护 `POST /v1/agent/chat` |
| B3 | `src/bridge.ts:325-328` | Web 模式 `window.open(url,...)` 不校验 scheme，校园数据里的 `javascript:` URL 可在空窗口执行（继承来源） | 打开前加 `if (!/^https?:\/\//iu.test(url)) return false`；桌面端同样在 IPC 层兜底 |

### 🟠 中高（P0，第 1 天）

| # | 位置 | 缺陷 | 修复方向 |
|---|---|---|---|
| B4 | `src/views/settings/*` + `SettingsView.tsx:207,685` | 活动日志 `raw` 未脱敏直接显示，含 `Authorization: Bearer …`、`Set-Cookie: JSESSIONID=…` | 展示前应用 `sanitizeDiagnosticText` 或过滤敏感字段 |
| B5 | `core/source-client.mjs:69-80,164` | `Secure` cookie 值经显式 `Cookie` 头在明文 HTTP 上发送（校园旧端点） | 对 `http:` 目标跳过带 `secure:true` 的 cookie；或仅在校内网允许时启用 |
| B6 | `core/sync-service.mjs:738-760` | `flushQueuedSync` 在 `startSync()` **同步 throw** 时，`run` 未赋值，已出队的 Promise 永不 settle → 调用方挂死 | 出队后先 `try`，失败即 `reject`；`startSync` 重叠源路径改为返回 rejected Promise（第 494-496 行） |
| B7 | `core/advisor/full-access-tools.mjs:72` | `createAdvisorFullAccessTools` 默认 `permissionMode='full-access'`（fail-open） | 默认改为 `'read-only'`；运行时已显式传值，但缺省必须 fail-closed |
| B8 | `core/store.mjs:73-80` | `writeAtomic` 先 `rm` 再 `rename`：Windows 上 rename 失败即丢 manifest；崩溃窗口丢数据；无 fsync | 去掉 `rm` 直接 `rename`（POSIX 原子覆盖）+ 写临时文件后 fsync |
| B9 | `core/store.mjs:440-447` | `save()` 不重读磁盘直接写内存快照 → 跨进程丢失更新（`update`/`replace` 都有合并，唯独 `save` 没有） | `save` 改为在锁内重读 `loadSharded()` 并 `mergeConcurrentReplacement` |

### 🟡 中（P0/P1，第 1-2 天）

| # | 位置 | 缺陷 | 修复方向 |
|---|---|---|---|
| B10 | `core/schema.mjs:16,165-171` | 富邮件 HTML 黑名单正则可被实体编码绕过（如 `jav&#x61;script:`） | 渲染器 CSP 已兜底，但 schema 层应加实体解码后复检或改用白名单净化 |
| B11 | `core/schema.mjs:505-507` | `icsEscape` 未转义 `\r` → ICS 行注入 | 转义 `\r` 和 `\r\n` |
| B12 | `core/schema.mjs:494-497` | CSV 未转义 `=`/`+`/`-`/`@` 前缀 → 电子表格公式注入 | 公式前缀前加 `'` 或引号包裹 |
| B13 | `core/util.mjs:167-173` + `adapters/jwglxt.mjs:92` | `htmlLooksLikeLogin` 启发式脆弱（二维码/令牌登录页可能漏判）；`UNIFIED_AUTH` 是占位 URL | 登录检测增加"存在认证 iframe/表单 action 指向统一认证域"；核对生产 CAS 真实 URL |
| B14 | `core/sync-service.mjs:1120-1151,1278-1286` | `retryAssignments` 的 `await` 间隙可被 `flushAssignmentScan` 抢占，覆盖 `assignmentActive`/`AbortController` → 两个扫描并发提交 | 用 generation/owner 令牌校验后再赋值；或统一走队列 |
| B15 | `core/sync-service.mjs:986-990,1055-1058` | `commitQueue` 串行链：前一个 commit 抛错则后一个来源数据被丢弃，`onSourceSettled` 不触发 | commit 链每个来源独立 `catch` 并继续；失败来源单独记错误 |
| B16 | `core/advisor/full-access-tools.mjs:90-93` | `open_campus_source` 输入未校验 URL scheme（只读模式也可调用） | 输入层 `new URL(url)` 且仅允许 http/https |
| B17 | `src/App.tsx:136` | 单一 `ErrorBoundary` 未绑定视图 key：A 视图崩溃后切到 B 仍显示错误 | `key={app.view}` 或逐视图边界 |

### 🔵 中低（P1，第 2 天）

| # | 位置 | 缺陷 | 修复方向 |
|---|---|---|---|
| B18 | `src/App.tsx:205-207` | `onRefreshResources`/`onDownloadResource` 直接返回 Promise 给 onClick，未处理错误 → 未捕获拒绝 | 包一层 `void fn().catch(...)` 或走 hook 统一错误 |
| B19 | `SettingsView.tsx:352-364` | `sync.lastError` 原始显示，未脱敏 | 复用 `sanitizeSyncFailure` |
| B20 | `core/advisor/agent-permissions.mjs:9-15` | 只读模式仍暴露 `network_request`/`update_theia_settings`/`control_course_selection` 等副作用工具 | 确认产品意图：若只读应只留校园只读工具；否则在 UI 明示 |
| B21 | `src/hooks/useTheiaApp.ts:790` | `term.id.split("-")[0]` 未保护，`term.id` 为空则渲染白屏 | `String(term.id || '').split("-")` |
| B22 | `core/advisor/full-access-tools.mjs:109-128` + `electron/main.mjs:225-229` | Agent 文件工具无 `..`/越界限制（全访问模式，防御深度） | `agentPath` 加 `resolve` 后规范化；至少拒绝明显越界 |
| B23 | `src/hooks/useTheiaApp.ts:717` | `setSchoolScheduleRefreshFailed(Boolean(schoolSchedule))` 用过期闭包值 | 用更新器回调或最新引用 |

---

## 2. 结构待办（S）

> 不阻塞发布，但为手机版和后续开发铺路。第 2-3 天穿插做，只做低成本高收益项。

| # | 位置 | 问题 | 低成本动作 |
|---|---|---|---|
| S1 | `electron/main.mjs`（5408 行） | 巨型文件：认证、同步、浏览器、IPC、诊断全在模块级 `let` 上 | 至少抽出：`auth-manager`（actor/epoch）、`source-windows`（guardSourceWindow 家族）、`diagnostic-modes`（smoke/inspect/live-capture 分支） |
| S2 | `main.mjs:98-108,5327-5399` | 4 个环境变量诊断模式各开一条启动链 | 收敛为单一 `runMode` 配置对象 |
| S3 | `core/sync-service.mjs` 1414 行 / `read-only-agent.mjs` 1296 行 | 过大 | 本轮只做注释性分节 + 抽出纯函数；不重构 |
| S4 | `src/hooks/useTheiaApp.ts` ~90 属性 + 未 memo | 全量重渲染 | 只对最热回调 `useCallback`；拆 hook 放到下个版本 |
| S5 | `tests/` | 无针对竞态（B6/B14/B15）、store 锁、advisor 边界的测试 | 为 B1/B6/B8/B14 补回归测试（第 1-2 天随修复一起） |
| S6 | `package.json` | ~~自动更新~~ → **已决策：不做**（本地优先、无服务器，人工安装是既定模式） | 发布说明与用户指南明示升级方式；不引入 electron-updater |
| S7 | `schema.mjs:305-310` | `modelRouting` 配置是"死配置"（未生效） | 本轮：UI 明确标注"预留"；实现放 v0.7 |

---

## 3. 功能完善清单（按发布优先级）

### 3.1 发布前必须（随缺陷一起）
- **F1** 手机版数据桥（见第 4 节，核心新功能）
- **F2** 本地 API 令牌认证（= B2，同时也是手机 LAN 桥的安全基础）

### 3.2 应该做（时间允许）
- **F3** 作业自动流水线触发：`onSnapshot` → 检测新 pending 作业 → 自动入队 `CourseWorkQueue`（已有队列、去重、重试、崩溃恢复；**只缺触发器和用户开关**）——这是 `AI_DIRECTION.md` 线一的最大缺口
- **F4** 主动提醒：作业截止（红/黄/绿分级已有基础）、考试倒计时、体测窗口（第 5–12 周）系统通知
- **F5** 邮件正文级搜索（现在只按发件人/主题/摘要过滤）

### 3.3 可以后置（v0.7+）
- 第二课堂 / 创新学分数据源接入（来源、规则版本未定义）
- 模型按角色路由真正生效（`modelRouting`）
- 学业预警主动风险信号（距 2.00 学位线）
- 一键备份/恢复 UI
- Iris（QQ 机器人）真机打磨与用户文档
- macOS / iOS 评估（Android 先行；iOS 需证书与签名链，单独评估）
- ~~自动更新~~（已决策：不做，见第 0 节）

---

## 4. 手机版（Capacitor 原生包）方案

### 4.1 技术选型：Capacitor

**为什么是 Capacitor 而不是 PWA 或 React Native：**

| 方案 | 对现有代码的改动 | 4 天可行性 | 产出物 |
|---|---|---|---|
| **Capacitor**（推荐） | 零 UI 改动，只加一个原生壳层和移动桥 | ✅ | 可安装 APK，原生文件/网络 API |
| PWA | 只需加 manifest + SW，但无原生能力 | ✅ | 浏览器安装，不可上架应用商店 |
| React Native / Flutter | 全部 UI 重写 | ❌ 4 天不可能 | 原生包，但来不及 |

**Capacitor 的工作方式**：现有 `src/` 是标准 Vite React 应用，构建后产出 `dist/`。Capacitor 把 `dist/` 加载到原生 WebView 中，通过 Capacitor 插件桥提供文件系统、网络请求等原生能力。**现有 React 代码一行都不需要改**，只需要：

1. 新增 `mobile/` 目录（Capacitor 原生项目配置）
2. 实现 `mobileBridge.ts`（替换 `webBridge` 的数据来源）
3. 响应式 CSS（让桌面视图在手机上可用）

### 4.2 数据来源（双通道）

| 通道 | 原理 | 适合场景 | 安全 |
|---|---|---|---|
| **A. 导入文件**（先做，必须） | 手机版打开桌面导出的 `theia-feed.json` 或 AI 导出包 → 解析到 IndexedDB → 离线浏览 | 首次使用、无局域网时 | 零风险，纯本地 |
| **B. LAN 实时桥**（增强，B2 令牌复用的产物） | 桌面 `local-api` 绑定 LAN IP + 令牌 → 手机通过局域网实时读取 | 在家/办公室同一局域网 | 令牌 + 默认关闭 + 首次桌面端确认；**LAN 模式与 B2 令牌认证共用一套实现** |

### 4.3 手机版功能范围

| 能力 | 桌面 | 手机版 v1 |
|---|---|---|
| 概览（今日课表/考试/待办/通知） | ✅ | ✅ |
| 课表 + 周次切换 | ✅ | ✅ |
| 考试 | ✅ | ✅ |
| 成绩 + GPA | ✅ | ✅ |
| 学业进度（培养方案/学分） | ✅ | ✅ |
| 我的课程（查看） | ✅ | ✅（只读） |
| 作业/在线测试列表 | ✅ | ✅（只读，不能处理/提交） |
| 通知 | ✅ | ✅ |
| 邮件（列表 + 正文） | ✅ | ✅（列表 + 正文；附件标"请用桌面端打开"） |
| 校园地图 | ✅ | ✅ |
| 体测/校历 | ✅ | ✅ |
| 空闲教室等工具 | ✅ | ❌（v1 不做，视图依赖实时同步） |
| 选课/抢课 | ✅ | ❌（安全边界，必须桌面） |
| 学业顾问 Agent / 模型 | ✅ | ❌（v1 不做） |
| 设置/凭据/数据同步 | ✅ | ❌（仅数据源导入设置） |

### 4.4 手机版工程待办（第 3 天）

**前置条件**：B2（本地 API 令牌认证）必须在第 1 天完成，因为 LAN 模式的令牌复用其实现。

1. **Capacitor 项目初始化**（`npx cap init` + `npx cap add android`）
   - 在仓库根目录新建 `mobile/` 或直接在 `capacitor.config.ts` 配置
   - 构建命令：`npm run build` → `npx cap sync` → `npx cap open android`
   - ⚠️ 需要 Android Studio + SDK（`ANDROID_HOME`）；若环境未就绪，第 0 步先确认工具链

2. **`src/mobile/mobileBridge.ts`**：实现 `TheiaBridge` 接口
   - 导入模式（A）：`readFile` / 文件选择器 → 解析 JSON → 存入 `localStorage`/IndexedDB
   - LAN 模式（B）：`fetch(http://<desktop-ip>:<port>/v1/snapshot?token=...)`
   - 对桌面专属方法（prepareCourseWork、applyTestAnswers、login 等）抛"仅桌面端可用"
   - 订阅：`onSnapshot` 由 LAN 轮询或导入文件触发

3. **`src/mobile/useMobileDataSource.ts`**：启动时选择数据源
   - 首次：提示"导入 THEIA 数据包"或"连接桌面电脑"
   - 导入：调用 `Capacitor` 文件选择器（`@capacitor/filesystem` 或 `FilePicker` 插件）
   - LAN 发现：扫描局域网或手动输入 IP + 令牌（从桌面端展示）

4. **响应式布局**：现有视图是桌面布局，需做手机适配
   - **优先三个核心视图**：概览（DashboardView）、课表（ScheduleView）、成绩（GradesView）
   - 侧栏改为抽屉（已有 `sidebarOpen` 状态，手机上默认折叠）
   - 卡片单列、操作栏收窄、字体适配
   - 其余视图（考试/学业/课程/通知/邮件/地图）逐个按剩余时间接入

5. **`bridge-runtime.mjs` 扩展**：新增 `mobile` 运行时检测，加载 mobileBridge

6. **构建与验收**
   - `npm run build` → `npx cap copy` → `npx cap sync`
   - Android Studio 中构建 APK / AAB
   - 导入样例 `theia-feed.json` 在模拟器/真机验收

### 4.5 手机版风险与对策

| 风险 | 对策 |
|---|---|
| 视图依赖桌面专属 API（导出、同步、认证） | mobileBridge 对这些方法抛"仅桌面可用"（已有 webBridge 模式可参考） |
| 数据陈旧 | 导入快照显示导入时间戳；LAN 模式显示"已连接/最后更新" |
| LAN 模式安全 | 令牌 + 默认关闭 + 桌面端确认；不引入远程端口扫描 |
| Capacitor 工具链未就绪（Android Studio、JDK、SDK） | Day 3 前先确认环境；若不可行，降级为 PWA（仍可出 APK 但无原生文件 API） |
| 4 天内完成度 | **必须：Capacitor 壳 + 3 个核心视图（概览/课表/成绩）+ 导入模式**；其余视图按剩余时间逐个接入 |

---

## 5. 四天排期

### Day 1 —— 高危修复（P0）
- [ ] B1 数据目录 null 崩溃 + 回归测试
- [ ] B2 本地 API 令牌认证 + Origin 校验 + 去除 `"null"` 授权 + CSRF 修复
- [ ] B3 window.open scheme 校验
- [ ] B4 活动日志脱敏
- [ ] B5 Secure cookie 明文传输
- [ ] B6 flushQueuedSync 挂死 + 回归测试
- [ ] B7 Advisor 默认 fail-closed
- [ ] B8 writeAtomic 原子写入 + 回归测试
- [ ] B9 save() 并发合并
- [ ] B10-B12 schema 注入类（ICS/CSV/富邮件）复检与转义

### Day 2 —— 中危 + 结构 + 测试
- [ ] B13 登录检测增强（核对生产 CAS URL）
- [ ] B14/B15 同步并发护栏 + 回归测试
- [ ] B16/B20 工具输入校验与只读边界确认
- [ ] B17/B18/B21/B23 前端健壮性（ErrorBoundary、term.id、未处理拒绝）
- [ ] S1 main.mjs 拆出 2-3 个模块（auth-manager / source-windows / diagnostic-modes）
- [ ] S2 诊断模式收敛
- [ ] F3 作业自动流水线：检测新作业 → 自动入队 + 用户开关
- [ ] 全量 `npm test` + `npm run lint` 绿灯

### Day 3 —— 手机版（Capacitor 原生包）
- [ ] 工具链确认：Android Studio + SDK + JDK 就绪（`ANDROID_HOME`）
- [ ] Capacitor 初始化：`npx cap init` + `npx cap add android` + `capacitor.config.ts`
- [ ] F2/LAN 桥：local-api LAN 模式 + 令牌（复用 B2 实现）+ 桌面端确认 UI
- [ ] `mobileBridge.ts`：导入模式（A）+ LAN 模式（B）
- [ ] 响应式布局：概览 / 课表 / 成绩 三个核心视图优先
- [ ] 其余只读视图（考试/学业/作业/通知/邮件/地图）逐个接入
- [ ] 构建 APK：`npm run build` → `npx cap sync` → Android Studio 出包
- [ ] 模拟器/真机验收：导入样例包走通全部已接入视图

### Day 4 —— 发布
- [ ] 桌面版回归：build + smoke:packaged + 手工验收
- [ ] 手机版回归：导入样例包走通全部已接入视图；LAN 模式（若完成）验收
- [ ] 版本号 → 0.6.0；更新 `docs/releases/v0.6.0.md`
- [ ] 发布包：安装包 + 源码归档 + SHA-256 校验和 + blockmap + **手机版 APK**
- [ ] README / 用户指南补手机版章节（安装、导入、LAN 桥、**无自动更新的升级方式**）
- [ ] 已知限制声明（手机版只读、Agent 仅桌面、未签名说明、APK 侧载说明）

---

## 6. 发布检查清单（最终验收）

- [ ] `npm test`（4 worker）全绿
- [ ] `npm run lint` 无 error
- [ ] `npm run build` 通过
- [ ] `npm run smoke:packaged` 通过（含 bridge 方法完整性、快照 schema、advisor overview）
- [ ] 手机版：APK 可安装启动、导入快照可用、3 个核心视图数据正确
- [ ] 安全：本地 API 无令牌不可读；`Origin: null` 被拒绝；LAN 模式默认关闭
- [ ] 文档：发行说明 + 手机版指南 + 已知限制
- [ ] 发布物：安装包 / 源码归档 / 校验和 / 发行说明一致

---

## 7. 附：本轮审查的其他有价值产出（供后续版本）

- **架构优点**（保持）：IPC schema 校验、URL 策略、CSP、DPAPI 凭据隔离、分片存储校验回退、逐域 provenance、Agent 脱敏。
- **数据模型**：`CampusState` + 分片 store + Feed + AI 导出 + loopback API 是多消费面共用一个事实源，方向正确。
- **建议固化**：把"失败保留旧值、空结果不覆盖、凭据不进状态"三条写进 CONTRIBUTING，防止未来回归。
