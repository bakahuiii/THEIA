# 手机版增量技术交接：对齐 THEIA v0.7.0

> 本文给下一次手机版开发对话使用。它不是 Android 项目的完整设计文档，只说明相对于当前 `H:\work\THEIA-basic` 的增量改造目标、已有能力、数据合同和验收边界。

## 0. 先读结论

桌面端本轮完成的是 THEOL 课程资料、作业和在线测试的确定性抓取与本地归档。手机版要做的是把同一套业务语义落到 Android 原生网络和本地缓存上，不是把桌面 Electron 代码搬进 WebView，也不是把桌面 API 暴露给手机。

必须保持：

- 独立 Android 应用，不依赖桌面 THEIA 进程；
- Android 原生 HTTP/浏览器认证链路；
- CAS、JWGLXT、THEOL Cookie 分域保存；
- 文档、作业、测试全部只读抓取；
- 本地缓存优先，网络失败保留旧数据；
- 不调用模型完成课程抓取；
- 不执行作业、测试或选课的最终提交；
- 不改变现有 Android 包名和升级存储标识。

## 1. 两个工作区和基线

### 1.1 桌面参考实现

```text
H:\work\THEIA
```

本轮有关的参考文件：

```text
core/adapters/theol.mjs
core/parsers/theol.mjs
core/parsers/theol-mobile.mjs
core/parsers/theol-work.mjs
core/theol-course-archive-store.mjs
core/sync-assignment-runtime.mjs
core/sync-helpers.mjs
electron/sync-orchestrator.mjs
core/local-api.mjs
tests/adapters.test.mjs
tests/theol-course-archive.test.mjs
tests/course-work.test.mjs
tests/sync-state.test.mjs
```

### 1.2 当前 Android 工作区

```text
H:\work\THEIA-basic
```

当前已经存在：

```text
core/adapters/theol-basic.mjs
core/parsers/theol-basic.mjs
core/auth-recovery.mjs
src/app.js
src/mobile/cas-auth.mjs
src/mobile/native-fetch.mjs
src/mobile/attachment-store.mjs
android/app/src/main/java/io/github/bakahuiii/theia/basic/CasAuthPlugin.java
tests/basic-data-paths.test.mjs
```

当前 Android 基线事实：

- Capacitor Android，最低 Android 10/API 29；
- package/application ID：`io.github.bakahuiii.theia.basic`；
- 当前 Gradle `versionName "1.0.5"`、`versionCode 6`；
- `theia-basic.session.v1`、`theia-basic.attachments.v1` 等存储键已经存在；
- `CasAuthPlugin` 使用 Android WebView 完成 CAS/THEOL 登录，并使用 Android Keystore 保护保存的校园会话；
- Android 预览浏览器不能替代原生 CAS 登录；
- `native-fetch.mjs` 负责 CapacitorHttp 的重定向、二进制 Base64、响应头和取消语义。

不要因为桌面候选版本是 `0.7.0` 就修改 Android 的 package ID、application ID、已有 IndexedDB 名称、Keystore alias 或 session storage key。这些是升级兼容边界。

## 2. 为什么不能直接复用桌面 `/v1/sync`

桌面本机 API 的合同是：

```text
监听：127.0.0.1
认证：每次桌面进程启动生成的 runtime token
同步：POST /v1/sync
读取：GET /v1/courses、GET /v1/assignments 等
```

Android 手机上的 `127.0.0.1` 是手机自身，不是 Windows 电脑。当前桌面 API 也明确禁止局域网暴露、端口转发和公网代理。因此本增量工作不得：

- 在桌面 API 上改监听地址为 `0.0.0.0`；
- 从手机扫描或猜测 Windows 端口；
- 把桌面 token 复制到 Android；
- 把学校 Cookie、密码或原始 HTML 通过局域网转发；
- 以 `/v1/agent/chat` 作为移动端抓取代理。

手机版应在自己的 Android 原生会话中直接读取 THEOL，并把结果写入自己的本地缓存。未来若确实要做“手机配对桌面”，必须另立一个经过明确认证、加密传输和用户授权的配对协议，不属于本次增量。

## 3. 桌面 v0.7.0 的数据合同

### 3.1 THEOL 课程

课程记录的关键字段：

```js
{
  id: "101",
  title: "课程名称",
  teacher: "教师",
  source: "theol",
  sourceUrl: "https://course.buct.edu.cn/meol/homepage/course/course_index.jsp?courseId=101",
  courseInfo: { department, enrolled, resourceCount, videoCount, noticeCount, assignmentCount },
  teachingMaterials: [/* introduction / syllabus / calendar */],
  assignmentLinks: [/* 仅导航证据，不是任务详情 */],
  capturedAt: "ISO-8601"
}
```

课程资料只暴露三种 `materialType`：`introduction`、`syllabus`、`calendar`。视频、普通资源树和其他栏目不能作为手机版课程资料主集合。

### 3.2 课程资料

```js
{
  id: "stable material id",
  courseId: "101",
  title: "教学大纲",
  url: "https://course.buct.edu.cn/meol/...",
  materialType: "syllabus",
  kind: "page",
  capturedAt: "ISO-8601",
  localPath: "desktop only, never expose on Android",
  localStatus: "saved | partial | failed | stale",
  localBytes: 1234,
  localSha256: "sha256",
  localAttachments: [],
  localFrames: [],
  contentPreview: "短预览"
}
```

Android 不应把 Windows 绝对路径塞入自己的状态。建议使用以下平台中立字段：

```js
{
  localStatus: "saved | partial | failed | stale",
  localBytes: 1234,
  localSha256: "sha256",
  localFileName: "教学大纲.html",
  localRef: "opaque IndexedDB key"
}
```

`localRef` 只在 Android 内部使用，UI 通过缓存服务打开，不显示数据库 key、文件系统路径或 Cookie 信息。

### 3.3 作业和在线测试

```js
{
  id: "stable assignment id",
  kind: "assignment | online-test",
  courseId: "101",
  courseName: "课程名称",
  courseSourceUrl: "course entry",
  title: "第一次作业",
  dueAt: "ISO-8601 or null",
  score: 92,
  status: "pending | submitted | unknown",
  source: "theol",
  sourceUrl: "unique task detail URL",
  capturedAt: "ISO-8601",
  localRef: "opaque local archive key",
  localStatus: "saved | partial | failed | stale",
  localAttachments: [],
  localQuestionCount: 0,
  localInstructions: "bounded text preview"
}
```

`assignments` 是“当前应处理的任务”，不是 THEOL 的完整历史表。截止时间已经过去的记录默认不进入当前集合；没有可解析截止时间的记录不能被随意当作已过期。

### 3.4 任务详情和附件

任务详情归档至少需要：

- UTF-8 HTML 或纯文本正文；
- 文档附件的标题、来源 URL、文件名、扩展名、MIME、字节数和 SHA-256；
- 在线测试的题号、题型、题干和选项；
- 附件下载失败的局部状态；
- 不下载视频、音频、图片。

文档白名单与桌面保持一致：

```text
pdf doc docx ppt pptx xls xlsx txt md csv rtf odt ods odp
```

无扩展名链接不能直接假设为文档。需要结合 URL、标题、响应 `Content-Type` 和 `Content-Disposition` 判断；HTML 错误页伪装成附件时必须拒绝保存。

## 4. 当前 Android 与桌面合同的差距

这些是下一次对话的实际增量缺口，不要重新设计已经存在的登录和基础教务模块。

### 4.1 课程资料尚未对齐

当前 `H:\work\THEIA-basic\core\parsers\theol-basic.mjs` 的 `parseTheolCourse()` 主要返回作业入口和少量课程统计，没有桌面端的：

- 课程介绍、大纲、日历分类；
- 三类资料的详情预取；
- UTF-8 归档 HTML；
- UEditor iframe 父页面内容恢复；
- 资料内嵌文档链接扫描和下载；
- 本地资料状态。

增量任务是扩展现有 parser/adapter，而不是复制桌面的全部课程资源树。

### 4.2 当前移动端只缓存培养计划 PDF

`src/mobile/attachment-store.mjs` 当前的存储模型以 PDF 为中心，并使用 `theia-basic.attachments.v1`。课程资料和任务附件需要一个独立命名空间，避免把不同域的文件互相覆盖。

建议新增：

```text
IndexedDB database: theia-basic.theol-archive.v1
object stores:
  pages       key: kind + parentId + recordId
  attachments key: kind + parentId + attachmentKey
  manifests   key: kind + parentId
```

每个二进制附件最多 32 MiB；每个 HTML 页面最多 16 MiB。保存顺序为：下载 -> 校验 -> 写临时内存记录 -> 完成后提交 metadata 和 bytes。不能先写“已保存”再异步补字节。

### 4.3 当前移动端作业扫描有硬上限

当前 `TheolBasicAdapter` 使用 `THEOL_COURSE_SCAN_LIMIT = 18`、有限任务入口和 28 秒总超时。桌面端本轮已经验证课程数量不能被静默限制为 60；手机版也不能把 18 门当成“全部课程”。

移动端可保留有界并发和总超时以保护手机，但必须：

- 在结果中明确 `scannedCourses`、`skippedCourses`、`timedOutCourses`；
- 不把被硬截断的结果标记为 `complete`；
- 默认继续扫描完整课程名单，或者提供明确的“分批继续”游标；
- 失败/超时课程不清空其旧任务；
- UI 展示 `partial`，不能只显示“没有作业”。

### 4.4 当前移动端没有任务详情归档

当前移动端作业页面主要读取任务摘要并渲染列表。需要在用户打开任务或启用任务详情同步时：

1. 校验任务详情 URL 的 `hwtid`/`testId`；
2. 校验详情页面属于预期课程；
3. 读取正文和文档链接；
4. 下载白名单附件；
5. 保存本地 manifest；
6. 将任务行的 `localStatus` 和附件数量更新到状态；
7. 点击本地资料时从 IndexedDB 打开，不重新请求原站。

### 4.5 移动端 fallback 需要课程白名单

THEOL 移动待办接口是全局任务 feed。解析 `courseItem` 时必须先从当前 `home.courses` 建立课程 ID 白名单：

```js
const course = byCourse.get(courseId)
if (!course) continue
```

未知课程不能用 `courseId` 自动合成一个课程记录后导入。这个约束已经在桌面端回归测试中覆盖，手机版必须同步覆盖。

### 4.6 当前移动端并发和桌面端顺序不是同一合同

桌面端为保护 THEOL 独占会话采用逐课程、逐入口的串行扫描。Android 可以采用最多 3-4 门课程的有界并发，但必须确保：

- 同一个 Cookie jar 的请求不会造成登录状态互相覆盖；
- 每个任务保留自己的课程和任务身份校验；
- 一个请求失败不会取消已经成功保存的其他课程；
- 取消和超时不会把旧任务误删；
- 最终 provenance 明确标记 `partial`。

## 5. 推荐增量实施顺序

### 增量 1：先建立 Android 领域模型和白名单

修改范围：

```text
H:\work\THEIA-basic\core\parsers\theol-basic.mjs
H:\work\THEIA-basic\core\adapters\theol-basic.mjs
H:\work\THEIA-basic\src\app.js
```

要求：

- 引入 `teachingMaterials` 的三类模型；
- 保持现有 `courses`、`assignments`、`notices` 顶层结构；
- 移动任务 feed 做当前课程白名单过滤；
- 保留 `dueAt`、`kind`、`status` 和唯一来源 URL；
- 不改 CAS 登录流程；
- 不把未知/过期任务显示成当前待办。

完成标准：parser 夹具覆盖未来作业、过期作业、在线测试、未知课程和 malformed task。

### 增量 2：增加 THEOL 本地归档服务

建议新增：

```text
H:\work\THEIA-basic\src\mobile\theol-archive-store.mjs
H:\work\THEIA-basic\src\mobile\theol-archive-parser.mjs
```

可复用桌面语义，但不要复制桌面绝对路径 API：

- `savePage({ kind, parentId, recordId, title, html })`；
- `saveAttachment({ kind, parentId, recordId, attachment, bytes, contentType })`；
- `findPage(ref)`；
- `findAttachment(ref)`；
- `readManifest(kind, parentId)`；
- `validateBytes()`；
- `openLocal(ref)`。

归档 HTML 必须经过：

1. 解码为正确 Unicode；
2. 统一写入 `<meta charset="utf-8">`；
3. 删除会重新访问学校页面的脚本；
4. 恢复 UEditor 父页面 `_content`；
5. 将已下载的文档 URL 改写成应用内部引用；
6. 保存后再将 `localStatus` 设为 `saved`。

### 增量 3：补任务详情同步

在现有 `loadTheolData()` 之上增加独立动作，不要让打开作业列表必然下载所有附件：

```text
读取任务列表：轻量，更新 assignments
打开单个任务：读取详情并归档正文/附件
用户点击“同步任务资料”：对当前任务逐个归档
```

所有详情读取都要传递 Android `AbortSignal`，并有单任务超时。失败时保留旧本地归档并显示 `stale`，新任务没有旧归档时显示 `failed`。

### 增量 4：加入课程资料入口

当前移动端 `renderCourses()` 是教务课程库，THEOL 课程数据在 `state.theolData.courses`。不要仅按课程名称粗暴覆盖教务课程。建议：

- 保留教务课程库作为主课程集合；
- 对存在 THEOL `courseId` 的课程增加“课程资料”入口；
- 无法可靠匹配时显示独立的 THEOL 课程资料列表；
- 资料详情中只显示介绍、大纲、日历；
- 点击已有本地资料直接从 archive store 打开；
- 没有本地资料时才读取来源页并在成功后归档；
- 不显示视频下载入口。

### 增量 5：补完整性和离线状态

移动端状态至少要区分：

```text
not-loaded
syncing
succeeded + complete
succeeded + partial
empty-confirmed
failed + retained-previous
auth-required
```

空数组只在完整扫描并明确确认为空时显示为“当前没有作业”。网络失败、认证过期、扫描超时或课程被截断时，必须显示错误/部分结果，并保留原有任务。

## 6. 认证、编码和网络要求

### 6.1 认证

- 继续使用 `CasAuthPlugin` 的原生 WebView 登录；
- CAS、JWGLXT、THEOL 使用独立 Cookie jar；
- 每次同步前从原生 CookieManager 刷新会话，避免内存 Cookie 覆盖新会话；
- Android API 模式没有 THEOL Cookie 时，不能把 JWGLXT 已连接误判成 THEOL 已连接；
- 密码只在学校认证页面使用，不写入普通状态、IndexedDB 或日志；
- 会话保存继续使用 Keystore 加密，不新增明文 fallback。

### 6.2 编码

THEOL 历史页面可能出现 GBK 声明、UTF-8 实际字节或二进制错误页。移动端要在 `native-fetch`/页面 client 边界统一处理：

- 先读取响应原始字节；
- 依据明确的 BOM、Content-Type charset、HTML meta 和已验证来源规则解码；
- 归档再统一写 UTF-8；
- `Content-Type: text/html` 的错误页不能作为 PDF/DOC 附件保存；
- 二进制附件不能先转成普通字符串再存储。

### 6.3 请求与重定向

- 只访问已允许的 BUCT THEOL/CAS/JWGLXT host；
- 每次重定向重新检查最终 host 和课程/任务身份；
- `native-fetch.mjs` 的 `disableRedirects` 语义不能被删掉；
- 使用 `CapacitorHttp` 传输二进制时保留真实 bytes，不把 Base64 文本当作页面正文；
- 请求取消后不能把任务写成成功。

## 7. 手机版 UI 增量合同

### 作业页

保留已有“待完成 / 已提交 / 全部”筛选。新增：

- 任务类型：作业或测试；
- 截止时间未知时显示“截止时间待定”；
- 本地正文/附件数量；
- 本地状态：已保存、部分保存、失败、旧版本；
- “打开本地资料”优先于重新请求原站；
- “刷新作业与测试”只刷新任务域。

不要在作业页自动显示“准备答案”或自动提交动作。模型若未来存在，仍只能处理已缓存的本地工作包。

### 课程资料页

每门 THEOL 课程最多显示：

```text
课程介绍 | 教学大纲 | 教学日历
```

每个资料项应有：

- 本地状态；
- 文档数量；
- 最近抓取时间；
- 打开本地文件/页面按钮；
- 单独重试按钮；
- 页面读取失败时的明确错误。

长标题、中文文件名和窄屏布局不能互相遮挡；大表格和原始课件预览要有横向滚动或文件查看器边界。

## 8. 测试增量清单

在 `H:\work\THEIA-basic\tests` 增加或扩展测试：

### Parser

- THEOL 课程页只提取 introduction/syllabus/calendar；
- 移动接口未知课程不会进入 assignments；
- `reminderListExpired` 的过去任务被过滤；
- 作业和在线测试字段分别识别；
- 混合式作业和测试结果 URL 可识别；
- 缺失/重复/非数字任务 ID 被拒绝；
- UEditor `_content` 和 iframe 内容可恢复；
- 图片、视频、音频链接不进入文档附件列表。

### Adapter

- 课程数量超过 18 时不会静默标记 complete；
- 移动接口成功但返回未知课程时只保留当前课程；
- 移动接口失败后课程页 fallback 可用；
- 一门课程失败不会清除其他课程任务；
- 完整确认空结果才清除旧任务；
- 详情页课程或任务身份错配时不落盘；
- 任务附件失败会产生 partial/stale 而不是成功。

### Archive store

- HTML 以 UTF-8 保存并可读中文；
- PDF/DOCX/TXT 等文档能保存并可再次读出；
- HTML 错误页不能伪装成文档；
- 单文件超过 32 MiB 被拒绝；
- 附件名冲突不会互相覆盖；
- 数据库刷新失败不会破坏已有 manifest；
- Android 重启后 IndexedDB 仍能读取已缓存页面和附件。

### Native/auth

- CookieManager 中的 THEOL Cookie 能进入 THEOL client；
- JWGLXT Cookie 不会被当作 THEOL Cookie；
- 重定向到非允许 host 被拒绝；
- Base64 二进制响应还原为真实 PDF/DOCX bytes；
- AbortSignal 取消后不会写入成功状态。

## 9. 构建和真机验收

在 Android 工作区执行：

```powershell
cd H:\work\THEIA-basic
npm install
node --test --test-concurrency=4 tests/*.test.mjs
npm run build
npm run cap:sync
cd android
gradlew.bat assembleDebug
```

源码测试、Vite 构建和 Gradle 构建通过，只能证明静态和构建链路；不能替代真机验收。真机验收至少要覆盖：

1. Android 10+ 安装并启动；
2. CAS 登录成功；
3. JWGLXT 和 THEOL 会话分别确认；
4. 课程列表完整或明确标记 partial；
5. 作业和测试列表出现时能正确分类；
6. 一条任务详情正文能离线再次打开；
7. 一个 PDF/DOCX/TXT 附件能离线再次打开；
8. 图片/视频不会被下载；
9. 断网重启后旧数据仍可读；
10. 任何学校侧提交按钮仍由用户操作，应用没有自动提交。

没有真机或当前账号没有任务时，可以完成夹具验收，但不能报告“真实线上任务已经验证”。

## 10. 给下一次开发对话的执行指令

按以下顺序推进：

1. 先读取 `H:\work\THEIA-basic` 的当前源码和测试，不重建项目、不新建第三方依赖。
2. 先补 parser 和 adapter 的课程白名单、截止时间、三类课程资料模型。
3. 再实现 `theia-basic.theol-archive.v1` 的页面/附件/manifest 缓存。
4. 再接入任务详情和课程资料 UI，所有本地打开动作通过 archive store。
5. 再补 partial/failed/stale 状态和错误展示。
6. 每完成一个增量就运行对应定向测试，不要等到最后才发现基础合同偏离。
7. 最后运行完整 Android 测试、Vite 构建、Capacitor 同步和 Gradle 构建。
8. 报告时分开写“代码/夹具验证”和“真机/真实 THEOL 验证”，不要用前者替代后者。

绝对不要：

- 把桌面 `127.0.0.1` API 改成局域网服务；
- 通过模型调用完成课程抓取；
- 把 Cookie、密码或 token 写进普通 JSON/IndexedDB 日志；
- 为了兼容旧页面而下载视频、图片或音频；
- 把空列表直接展示成“学校没有作业”；
- 静默限制课程数量并把结果标记为 complete；
- 自动点击学校系统的最终提交按钮。
