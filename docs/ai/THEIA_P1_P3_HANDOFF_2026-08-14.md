# THEIA P1-P3 最终交接与验收记录

记录时间：2026-08-14 08:45（Asia/Shanghai）
项目目录：`H:\work\THEIA`

## 最终结论

P1-P3 的无模型本地确定性顾问已经完成实现、安全闭合、完整自动化门禁和隔离视觉验收，可以作为 P4 模型顾问的可信输入层。当前工作树仍未提交；本轮没有接入 AI 模型，没有上传校园数据，没有增加学校写权限，没有读取真实 `%APPDATA%\THEIA`，也没有提交、推送、打包或发布。

## 已完成能力

### P1：本地行动顾问

- 概览页显示 Top 1，顾问页显示 Top 7、确定性排序理由、数据质量和证据抽屉。
- 支持当前 renderer 会话内“稍后提醒”和“暂时隐藏”，不写入 `CampusState`；全部隐藏时显示独立状态，不误报“没有风险”。
- 固定动作使用代码白名单。作业来源动作从 renderer 只提交 `{ snapshotRevision, actionId }`，主进程重算并解析内部目标。
- 作业来源动作在等待 assignment scan、代理 ready、登录/状态检查、每次导航、页面身份校验和返回成功前持续复核 revision，快照变化即失败关闭。
- overview revision 变化会立即关闭旧证据抽屉；并发 overview 请求只有最新一次能更新数据、错误和 loading。
- 风险文案中的数据域、严重度和截止时间分段已中文化，未知枚举使用保守中文兜底。

### P2：本地学业分析

- 培养方案 AND/OR 树、保守 categories fallback、GPA 多来源、来源差异、学分缺口、失败课程关联、版本化升级线和纯算术 What-if 已接入顾问页。
- GPA 学校来源合法范围为 `0..4.33`；明确失败记录按 0 绩点进入本地 GPA 分母但不计入已获得学分，重修按稳定课程身份去重，结果显示四位小数。
- 培养方案、课程、规则和相关 entity 均通过与 `snapshotRevision`、规则版本及数字路径绑定的 `ar1:*` opaque ref 公开，renderer 不接收原始学业节点 ID。
- What-if 只接受当前 catalog 内直接、唯一的父子 opaque 配对；伪造、过期、歧义和非父子引用全部失败关闭。
- What-if 请求绑定 revision 且采用 latest-request-wins，旧请求的成功、失败和 `finally` 都不能覆盖新状态。

### P3：只读选课决策

- 候选课程的培养方案匹配、课表冲突、重复修读、历史修读摘要、稳定排名、理由和证据已接入选课候选页。
- 候选输入使用递归白名单；URL、`operationId`、Cookie、凭据和任意执行负载不会进入摘要、披露或响应。
- 排名只做本地计算，不保存目标、不开始抢课、不提交选课、不调用学校写接口。
- 候选列表请求和 P3 决策请求分别采用 latest-request-wins；只有最后一次请求可更新候选、分页/input key、决策、错误和 loading。
- 中等桌面宽度的全校课表筛选器改为四列，选课排名区域不再造成页面横向溢出；移动端顶栏不再把标题挤成单字列。

## 最终安全硬化

1. 培养方案、课程和规则引用全部 revision-bound opaque 化，What-if 只在主进程当前 catalog 内反解。
2. public provenance 改为逐字段 DTO 白名单：任意 URL、查询参数、本机路径和 token 不进入 renderer，`runId`、`parserVersion`、`errorCode` 的原始值被清除并只留 `null` 合同占位；保留 availability、freshness、completeness、retainedPrevious、记录数和安全时间字段，结构合同需要的 digest/revision 不在证据抽屉展示。
3. 作业来源动作在异步等待、登录和导航链的关键边界持续复核 revision，关闭 TOCTOU 窗口。
4. 快照变化立即关闭旧证据抽屉；overview、What-if、候选列表和 P3 决策都拒绝过期请求写回 UI。
5. evidence、claim、risk、action 及 P2/P3 嵌套引用全部校验同一 revision 并闭合。

## 完整门禁

以下命令在最终工作树中顺序执行并通过：

```powershell
npm test
npm run lint
npm run build
git diff --check
```

结果：

- 全量测试：`494/494` 通过。
- opaque/provenance 定向测试：`87/87` 通过。
- 前端竞态定向测试：`18/18` 通过。
- ESLint：通过。
- TypeScript 与 Vite 生产构建：通过；只有既有的 `>500 kB` chunk 警告。
- `git diff --check`：通过；只有 Git 的 LF/CRLF 转换提示，没有空白错误。

定向测试只说明重点合同覆盖，不替代 `494/494` 全量门禁。

## 隔离视觉验收

最终报告由 `npm run visual:advisor` 在本地 `test-results/advisor-visual/` 下生成，不作为源代码提交的一部分。

- `1440x900`、`1280x720`、`390x844` 三个视口。
- 每个视口覆盖顾问、证据抽屉、What-if、选课排名四个场景，共 `12/12` 通过。
- complete、partial、stale、failed-retained 四类质量态均被 fixture 覆盖。
- document、body 和 workspace 页面横向溢出为 0；非空 `shellOverflow` 只是被 `.app-shell` 裁剪的缩放背景装饰层诊断。
- 三个视口均完成 `3 candidates -> 3 decisions`，证据 Portal 均被正确识别。
- fixture digest 未变化；renderer error、console warning/error、外部请求、导航阻断和页面加载失败均为 0。
- 运行未读取真实 AppData，禁止学校网络，报告落盘后对应临时存储已删除。

该报告只证明上述四个场景和四类质量态，不能外推为所有 loading/error/confirmed-empty/unknown/长文本组合或 packaged smoke 已完成。本轮没有打包或发布。

## P4 前的非阻断边界

- `save-target`、`view-details`、`open-confirmation` 目前只是非执行 proposal 数据，renderer 不执行它们。
- production `upgradeRule` 默认是 `null`，因此 UI 正确显示“尚未配置”；在没有可信规则来源和版本前不能宣称升级、毕业、退学或学籍结论。
- P4 接模型前，应把 `projectAdvisorOverview()` 顶层、claims、risks 和 urgentItems 从对象展开改为完全逐字段 DTO，防止未来新增字段意外穿透。当前敏感子对象已显式投影并通过测试，因此这是纵深防御，不推翻 P1-P3 验收。
- 尚无专门工具验证规划中的 corpus 数量和 overview 性能 p95/RSS 门槛，文档中的数字仍是未来发布目标，不是本轮实测。

## 继续工作的安全边界

- P4 必须复用冻结快照、DataQuality、typed claim、EvidenceRegistry 和动作白名单，不得让模型自由读取 `CampusState`、session、vault 或本机文件。
- 不因接入模型而上传未经用户明确授权的校园数据，不增加学校写权限，不允许模型生成可直接执行的 URL、学校原始 ID 或工具参数。
- 不改变现有 JWGLXT/THEOL 并行与串行同步语义。
- 不清理未跟踪文件，不回退用户已有修改。
- 未经明确要求，不提交、推送、打包或发布。

## 主要实现与验收入口

- `H:\work\THEIA\core\advisor\academic-engine.mjs`
- `H:\work\THEIA\core\advisor\course-decision-engine.mjs`
- `H:\work\THEIA\core\advisor\risk-engine.mjs`
- `H:\work\THEIA\electron\advisor-overview-service.mjs`
- `H:\work\THEIA\electron\advisor-academic-references.mjs`
- `H:\work\THEIA\electron\advisor-action-service.mjs`
- `H:\work\THEIA\src\views\AdvisorView.tsx`
- `H:\work\THEIA\src\views\CourseSelectionView.tsx`
- `H:\work\THEIA\src\components\advisor\`
- `H:\work\THEIA\scripts\visual-advisor.mjs`
- `H:\work\THEIA\scripts\visual-advisor-preload.cjs`
- `H:\work\THEIA\tests\fixtures\advisor-visual-fixture.mjs`
- `H:\work\THEIA\tests\advisor-academic-references.test.mjs`
- `H:\work\THEIA\tests\advisor-service-p2-p3.test.mjs`
- `H:\work\THEIA\tests\course-selection-advisor-ui.test.mjs`

停止点：P1-P3 已验收完成，代码和文档均已保存；下一阶段是 P4 模型顾问，不是继续补 P1-P3 基础能力。
