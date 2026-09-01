# MOTION 场馆状态

## 这项功能是什么

THEIA 在“学习工具”中新增了“场馆状态”标签页，用于读取北京化工大学 MOTION 公开场馆页面的目录和时间段状态。入口是：

`https://motion.buct.edu.cn/changguanyuyue1/xzxq.php`

当前实测页面可以匿名读取，但“无需登录”只代表本次访问结果，不代表学校网站未来不会调整认证策略。

## 用户能做什么

打开“学习工具 -> 场馆状态”后，可以：

1. 刷新公开场馆目录，按校区、项目和场馆筛选。
2. 读取详情页公开的日期和场馆组选择。
3. 查看某个日期/场馆组的时间段、场地名称和状态标签。
4. 在结果顶部查看最近查询时间、请求耗时、状态单元总数和状态分布。
5. 使用本地缓存恢复最近一次成功查询；网络短暂失败时不会把已有结果替换成空白。

状态标签会保留学校页面的原文，并归一化为 `available`（可预约）、`occupied`（已占用/已预约）、`closed`（闭馆）、`expired`（已过期）、`selected`（已选定）或 `unknown`（未知）。

## 不能做什么

这项功能是严格只读的：

- 只发匿名 `GET` 请求，不提交表单，不点击预约按钮。
- 不创建、修改、取消、确认或支付预约。
- 不调用 `create.php`、`create_cl.php` 或篮球 `detailBB.php` 的预约提交流程。
- 不读取或复用账号密码、Cookie、浏览器登录状态或预约人信息。
- 不保存原始 HTML、动态 slot ID、手机号、预约表单值或学校侧个人数据。

页面上的“查询状态”只读取公开详情页。预约最终是否成功、场馆规则和学校认定仍以学校原站为准。

## 实现链路

```text
学习工具/场馆状态
  -> typed bridge
  -> preload + IPC（白名单、参数校验）
  -> core/adapters/motion.mjs
  -> dataCatalog.collections.venueReservations
  -> renderer snapshot / loopback API
```

适配器从 `xzxq.php` 开始，只跟随 MOTION 白名单中的目录和详情页面：

| 页面 | 用途 |
| --- | --- |
| `xzxq.php` | 校区选择页 |
| `jinri_cpxq.php`、`jinri_dxq.php`、`jinri_cl.php` | 校区/项目/场馆目录 |
| `detail.php`、`detail_cl.php`、`detailBB.php` | 日期、场馆组和时间/状态表 |

日期和场馆组先从详情页实际公开的下拉选项中选择，再构造参数化 `GET`。URL、方法、重定向和登录页都会在主进程侧校验；渲染器不能传入任意网站地址。

## 本地缓存与 API

缓存集合是 `dataCatalog.collections.venueReservations`，包括：

- `campuses`：校区及其场馆 ID；
- `venues`：项目、场馆显示名和白名单详情 URL；
- `statuses`：按 `detailUrl + date + venue` 键控的最近状态结果；
- `lastRefreshedAt`、`source`、`parserVersion`：来源和新鲜度元数据。

桌面客户端运行时，本地 API 提供只读端点：

```text
GET /v1/venue-catalog
GET /v1/venue-status?detailUrl=<详情页>&date=YYYY-MM-DD&venue=<场馆组>
GET /v1/venue-statuses?activity=<项目>&date=YYYY-MM-DD
GET /v1/motion-table-image?activity=<项目>&date=YYYY-MM-DD&title=...
```

`/v1/venue-catalog` 与 `/v1/venue-status` 只返回本地缓存投影。`/v1/venue-status` 没有匹配缓存时返回 HTTP 200 且 `item: null`，不会为了填充结果而替客户端发起任意网络请求。

`/v1/venue-statuses` 与 `/v1/motion-table-image` 则**每次请求都实时拉取**公开页面（场馆状态变化最快），失败时才回退缓存。API 仍只绑定 `127.0.0.1`，方法限制为 `GET`、`HEAD` 和受限 `OPTIONS`。

## 查询耗时

耗时是客户端墙钟时间，包含网络等待、响应体读取和 HTML/表格归一化，不是学校服务器纯处理时间，也不是 SLA。MOTION 页面、网络出口和学校负载会变化，因此本指南不固定发布某次现场抓取的毫秒数；需要诊断时以当前界面显示的请求耗时和活动记录为准。

## 验证方式

生产仓库当前覆盖以下检查：

```powershell
node --test --test-concurrency=4 tests/motion-adapter.test.mjs tests/motion-data-catalog.test.mjs tests/ipc-security.test.mjs tests/data-output-contract.test.mjs
npm run lint
npm run build
```

测试会验证 MOTION URL 白名单、GET-only 边界、日期/场馆组校验、缓存键控、异常记录过滤、本地 API 响应和 IPC schema。构建和 lint 不能替代真实学校网络读取；需要更新目录时应在桌面客户端点击“刷新场馆目录”。

## 相关代码

| 文件 | 作用 |
| --- | --- |
| `core/adapters/motion.mjs` | MOTION 目录发现、公开状态读取、状态归一化和计时 |
| `core/data-catalog.mjs` | 场馆目录/状态缓存与本地投影 |
| `core/local-api.mjs` | `/v1/venue-catalog`、`/v1/venue-status` |
| `electron/ipc-security.mjs`、`electron/ipc-registration.mjs` | IPC 白名单和参数 schema |
| `electron/preload.cjs`、`src/bridge.ts`、`src/types.ts` | 桌面桥接和 renderer 类型契约 |
| `src/views/ToolsView.tsx`、`src/views/tools/VenueStatusView.tsx` | “学习工具”标签页和查询界面 |
| `src/styles.css` | 与现有学习工具一致的卡片、表格和响应式布局 |
