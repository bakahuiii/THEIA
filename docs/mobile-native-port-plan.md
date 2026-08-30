# THEIA 原生移动 App 移植方案

> 目标：把 THEIA（本地优先 Windows 校园工作台）移植为原生移动 App，覆盖尽可能多的桌面功能。
> 状态：方案定稿，待实施。平台首选 Android（国内分发与校园场景），iOS 作为后续。
> 原则：本地优先、无云服务器、凭据不出设备、与桌面端数据可迁移/可互导。

---

## 1. 目标与约束

### 1.1 目标
- 在手机 / 平板上提供与桌面端**尽可能一致**的校园体验：课表、成绩、考试、学业进度、抢课、作业、邮箱、通知、空闲教室、场馆状态。
- 桌面端已有的 **React + Vite 前端**尽量复用，避免重写全部 UI。
- 数据**本地优先**：离线可用，校园数据缓存在设备上；不做云端托管。
- 真实校园登录（CAS / 教务 API / 邮箱 IMAP）必须可用。

### 1.2 硬约束
- **不用 PWA**：用户明确要求原生安装包（可离线、可访问系统能力、可后台）。
- **无自动更新服务**：与桌面端一致，更新走应用市场 / 手动安装包，不内置更新服务器。
- **凭据安全**：密码 / Cookie / API Key 只能存在于设备受保护存储（Keystore / Keychain），不落入普通数据、日志或导出。
- **不做"代理"**：不把校园账号密码转发到任何第三方服务器。

### 1.3 平台优先级
| 阶段 | 平台 | 理由 |
| --- | --- | --- |
| P0 | Android 8+ | 分发容易（APK）、学生用户多、原生 WebView 可控 |
| P1 | iOS | 需要 Apple 开发者账号 / TestFlight，作为后续 |

---

## 2. 现有桌面架构速览（移植基础）

```
┌────────────────────────────────────────────────┐
│ 渲染进程（React + Vite，src/）                    │
│  视图、状态（useTheiaApp）、类型、bridge API      │
└──────────────┬─────────────────────────────────┘
               │ window.theia（preload 桥）
┌──────────────▼─────────────────────────────────┐
│ Electron 主进程（electron/main.mjs，~5900 行）  │
│  CampusStore（分片本地存储）                     │
│  CredentialVault / AcademicApiVault / MailVault │
│  SessionClient（渲染式校园浏览器会话）            │
│  SyncService（jwglxt / theol / 多域）            │
│  CourseWorkService / CourseSelectionService     │
│  MailService（IMAP）/ WebmailService            │
│  AdvisorRuntime（顾问 Agent）                    │
│  Local API（127.0.0.1 只读 loopback）            │
│  IrisCompanion（QQ 伴侣，桌面专属）              │
└────────────────────────────────────────────────┘
```

**可复用层**：
- `src/`（视图 + hooks + types + bridge 契约）→ 移动端 WebView 直接复用。
- `core/`（纯 Node 逻辑：store、解析、同步、数据域）→ 大部分可移植到 Capacitor 插件或 JS 运行时。
- `integration/`（theia-client / mcp）→ 桌面专属，不移植。

**不可复用 / 需替换层**：
- Electron 专属：`BrowserWindow`、`session`、`safeStorage`、`dialog`、`shell`、`Notification`、`protocol`。
- 渲染式校园登录（隐藏 BrowserWindow 模拟页面）→ 移动端改为 **API 优先 + 受限 WebView 登录**。

---

## 3. 技术选型：Capacitor + 原生插件

### 3.1 为什么是 Capacitor
- **前端零重写**：`src/` 的 React 应用在 Android WebView 里直接跑，视图、交互、类型全部保留。
- **单代码库**：UI 与业务逻辑共享，桌面/移动差异通过一层"平台适配"隔离。
- **原生能力**：通过 Capacitor 插件（文件、网络、存储、通知、后台任务）补足 Electron 的能力。
- **成熟生态**：`@capacitor/android`、`@capacitor/ios`、`@capacitor/filesystem`、`@capacitor/network`、`@capacitor/app`、`@capacitor/clipboard`。

### 3.2 备选与否决
| 方案 | 结论 | 理由 |
| --- | --- | --- |
| **Capacitor** | ✅ 采用 | 前端复用最大化，覆盖需求 |
| React Native | ❌ | 前端要重写，DOM/CSS 不兼容 |
| Flutter | ❌ | 全量重写，周期过长 |
| 纯 Web + TWA | ❌ | 不是原生包，能力受限 |
| Electron（Android 不支持） | ❌ | 平台不可行 |

### 3.3 架构分层

```
┌───────────────────────────────────────────────┐
│ 移动 UI（复用 src/，Capacitor WebView）        │
│  platformAdapter：window.theia 相同契约        │
├───────────────────────────────────────────────┤
│ Capacitor 插件层（原生）                       │
│  TheiaData（分片存储 + 加密）                  │
│  TheiaSession（校园 Cookie / 会话）            │
│  TheiaNetwork（带 UA / 回环的校园请求）        │
│  TheiaLogin（受限 WebView CAS 登录）           │
│  TheiaBackground（后台同步 / 通知）            │
│  TheiaVault（Keystore 安全存储）               │
├───────────────────────────────────────────────┤
│ 业务逻辑（复用 core/，JS 运行时）              │
│  store / sync / parser / advisor / local-api  │
└───────────────────────────────────────────────┘
```

**关键决策**：把 Electron 主进程的职责拆成两类——
- 纯 JS 逻辑（store、解析、同步、数据域、advisor）→ 放进 Capacitor WebView 的 **service worker / 内嵌 JS 运行时**（复用 `core/`）。
- 系统能力（存储、网络、加密、通知、WebView 登录）→ 写**原生 Capacitor 插件**，暴露与 `window.theia` 一致的方法名。

这样 `useTheiaApp` 的 `bridge.getSnapshot()`、`bridge.syncNow()` 等调用几乎不用改。

---

## 4. 能力映射：桌面主进程 → 移动插件

| 桌面能力 | 移动替代 | 难度 |
| --- | --- | --- |
| `CampusStore`（分片 JSON） | Capacitor Filesystem 插件 + 内嵌 JS store | 低 |
| `CredentialVault`（safeStorage/DPAPI） | Android Keystore / iOS Keychain 插件 | 中 |
| `SessionClient`（渲染式 Cookie 会话） | `TheiaSession`：WebView cookie + 受限页面登录 | 高 |
| `SyncService`（jwglxt API 优先） | 复用 `core/` 的 API 客户端 + `TheiaNetwork` | 中 |
| `CourseSelectionService`（选课） | 复用 `core/course-selection.mjs` | 中 |
| `MailService`（IMAP） | 复用 `core/imap`（Node 兼容层或原生 IMAP 插件） | 中 |
| `AdvisorRuntime`（Agent） | 复用 `core/advisor` + 模型 HTTP | 中 |
| `Local API`（127.0.0.1 loopback） | 移动端内嵌，仅同 App 内脚本用 | 低 |
| 隐藏 BrowserWindow 登录 | 受限 `InAppBrowser` / 原生 WebView 登录 | 高 |
| 桌面通知 | Capacitor Local Notifications | 低 |
| 文件选择 / 导出 | Capacitor Filesystem / Share | 低 |
| 后台同步 | Capacitor Background Task / WorkManager | 中 |
| 地图（校园导航） | 复用 `src/map` + 网格数据 | 低（数据已在） |
| Iris（QQ 伴侣） | ❌ 桌面专属，不移植 | — |

---

## 5. 数据层设计

### 5.1 本地存储
- 沿用桌面 `CampusStore` 的**分片 JSON 结构**（`schema: theia-sharded-store/v1`），写入 App 私有目录。
- 用 Capacitor Filesystem 插件读写；每写一次按"分片文件"落盘，避免整库重写。
- 同步、课表、成绩等缓存在设备本地，**离线可看**。

### 5.2 加密与凭据
- 桌面 `safeStorage` → 移动端用 **Android Keystore / iOS Keychain** 的插件。
- 密码、校园 API 凭据、邮箱凭据、模型 API Key 全部走安全存储，不进普通文件、日志、导出。
- Cookie：存 App 私有目录，供会话插件使用；**不写入任何导出/日志**。

### 5.3 数据迁移 / 互导
- 桌面端可"导出 AI 数据包"（已有 `theia-feed.json` / `writeAiExport`）。
- 移动端提供"导入数据包"：解析并写入本地分片 store，让用户在换设备时保留课表/成绩。
- 不做自动云同步（无服务器约束）。

### 5.4 同步策略
- 复用 `core/sync-service.mjs` 的多域同步（jwglxt / theol / 多域）。
- 前台手动同步为主；后台同步用 WorkManager 定时（可选，避免频繁电耗）。
- 断网时回退到本地缓存，恢复网络后按需刷新。

---

## 6. 认证设计（最关键风险）

### 6.1 桌面现状
- CAS 统一认证通过**隐藏 BrowserWindow 渲染页面**，SM2 加密提交，维护共享 Cookie。
- 教务 API 优先通道用独立凭据（`xkkz_xh` 等）。
- 邮箱用 IMAP + 密码。

### 6.2 移动方案
1. **API 优先**（主路径）：
   - 复用 `core/academic-api-client.mjs`：用学号+密码调教务 API（jwglxt 的 API 通道）。
   - 需要处理 `xkkz_xh`、Cookie jar、`do_jxb_id` 等细节（桌面已实现，直接复用）。
2. **受限 WebView 登录**（备用）：
   - 打开一个**不暴露地址栏/不导航到任意网址**的原生 WebView 加载 CAS 登录页。
   - 用户在校园页登录后，拦截并保存 Cookie 到 `TheiaSession`，然后关闭 WebView。
   - WebView 只能访问白名单域（`buct.edu.cn` 及其子域），禁止下载、禁止打开任意 URL、禁止脚本注入外部内容。
3. **邮箱**：复用 IMAP（`core/imap-mail-service` 的协议逻辑），凭据走 Keystore。
4. **会话恢复**：凭据存在安全存储 → 启动时静默尝试 API 登录；失败才要求重新登录（与桌面行为一致）。

### 6.3 安全边界
- 不把 Cookie/密码写入日志、诊断文件、AI 导出、普通数据快照。
- WebView 登录只允许 HTTPS + 白名单域名。
- 模型 API Key 只存安全存储。

---

## 7. 功能优先级矩阵

### P0（MVP，第一版必须有）
- [ ] 本地 store 读写（分片 JSON）
- [ ] 登录（API 优先 + 受限 WebView 回退）
- [ ] 课表（按周/学期查看）
- [ ] 成绩 + GPA
- [ ] 考试安排
- [ ] 学业进度（培养方案学分）
- [ ] 通知（教务 + THEOL）
- [ ] 同步（手动 + 后台可选）
- [ ] 导出/导入数据包

### P1（第二版）
- [ ] 作业与测试（THEOL）
- [ ] 抢课（目标、哨兵、时间窗）
- [ ] 邮箱（IMAP 收发/附件）
- [ ] 空闲教室 / 场馆状态
- [ ] 校历与教学进程
- [ ] 模型接入 + 顾问 Agent（轻量）

### P2（后续）
- [ ] 校园地图（复用现有网格/导航数据）
- [ ] 本地 API 脚本能力
- [ ] 多账号 / 多学期管理
- [ ] iOS 适配

### 明确不做
- Iris QQ 伴侣、MCP 桥接、Electron 桌面专属窗口管理、Windows 通知中心深度集成。

---

## 8. 项目结构（建议）

```
theia-mobile/                     # 新仓库或目录（与桌面 THEIA 分离构建）
├── app/                          # Capacitor 应用
│   ├── android/                  # Capacitor Android 工程
│   ├── ios/                      #（后续）
│   └── package.json
├── src/                          # 从桌面 THEIA 复用（视图/hooks/类型/bridge）
├── core/                         # 从桌面 THEIA 复用（store/sync/parser/advisor）
├── plugins/
│   ├── theia-storage/            # 分片 store 读写 + 加密
│   ├── theia-vault/              # Keystore/Keychain
│   ├── theia-session/            # Cookie 会话 + 受限 WebView 登录
│   ├── theia-network/            # 校园网络（UA/重定向/重试）
│   └── theia-background/         # 后台同步/通知
├── docs/
└── scripts/                      # 构建/同步/打包脚本
```

**复用方式**：`src/` 和 `core/` 以子模块或构建拷贝方式引入，保留 git 历史；移动端不修改桌面源文件（只加 `platformAdapter`）。

---

## 9. 分阶段实施计划

### 阶段 0：技术验证（半天~1 天）
- 搭 Capacitor 空工程，跑通 React 前端 + WebView。
- 验证 `window.theia` 桥接契约（先 mock 数据）。
- 验证 store 分片 JSON 在 Capacitor Filesystem 的读写。
- 产出一个可运行的"壳 + mock 数据"APK。

### 阶段 1：数据层 + 登录（2~3 天）
- 移植 `core/store.mjs` 到移动存储插件。
- `TheiaVault`（Keystore）保存凭据。
- 登录：先做 API 优先通道，再补受限 WebView CAS。
- 手动同步拿到课表/成绩/考试/通知。

### 阶段 2：P0 功能 UI 适配（2~3 天）
- 把 `src/` 视图按移动端屏幕适配（触控、窄屏、下拉刷新）。
- 课表/成绩/考试/学业/通知页上线。
- 导出/导入数据包。

### 阶段 3：P1 功能（2~3 天）
- THEOL 作业、抢课、邮箱、空闲教室、场馆。
- 后台同步（WorkManager）+ 本地通知。

### 阶段 4：打磨与发布（1~2 天）
- 离线体验、错误恢复、性能（WebView 启动、大列表）。
- 图标/启动页/深色模式。
- 打 APK，测试真机；可选上架（应用市场/侧载）。

> 总计约 2 周内的增量交付；每天可交付可运行增量。

---

## 10. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 校园登录在移动端被风控 | API 优先通道；WebView 用真实 UA；降级为浏览器手动完成登录 |
| WebView 性能（大列表/地图） | 虚拟列表、懒加载、图片压缩；地图数据已是网格化 |
| IMAP 在移动端后台受限 | 前台刷新为主；附件按需下载 |
| 校园接口变更 | 桌面 `core/` 已集中解析，移动端复用同一份逻辑，单点维护 |
| 凭据泄露 | Keystore/Keychain + 白名单 WebView + 不落日志 |
| 分片 store 兼容 | 与桌面共用 `schema`，数据包可互导 |

---

## 11. 验收标准（MVP）
- [ ] 全新手机安装 APK，无需电脑即可完成登录并看到课表/成绩。
- [ ] 离线（飞行模式）仍可查看最近同步的课表、成绩、考试。
- [ ] 校园 API 登录与受限 WebView CAS 登录至少一条路径可用。
- [ ] 凭据保存在系统安全存储，导出/日志中无明文。
- [ ] 与桌面端通过数据包可互导。
- [ ] 手动同步 + 可选后台同步正常。

---

## 12. 下一步（明天开工顺序）
1. 新建 `theia-mobile/` 工程，`npm create @capacitor/app` + 引入桌面 `src/`。
2. 实现 `platformAdapter`（bridge 契约）与 mock 数据，跑通壳 APK。
3. 移植 `core/store` → Capacitor Filesystem 插件。
4. 移植登录（API 优先）→ 同步 → 课表页。

---

*本文档基于桌面 THEIA 当前代码结构（store 分片、API 优先同步、CAS 会话、多域同步、Advisor）制定；实施时以实际代码为准逐步校准。*
