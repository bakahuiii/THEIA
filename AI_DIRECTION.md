# THEIA AI 方向

> 规划文档，2026-08 · 基于现有 TheiaBridge API 与 CampusState 数据模型。未标为“已有”的内容均为规划。

---

## 规划架构

不是一套 AI，是两套目的不同的 AI：

| | 作业线 | 顾问线 |
|---|---|---|
| 目标 | 帮我完成课程任务 | 帮我做学业决策 |
| 目标触发方式 | 自动（监听新作业） | 计算层自动 + AI 叙述按需 |
| 输出 | 答案 / PDF / 笔记 | 优先级列表 + 自然语言解释 |
| 边界 | 不自动提交 | 不预测不确定的事 |

---

## 本地资料库

`CampusState` 与 `CampusStore` 是界面、CLI、本地 API 和未来 AI 顾问共享的业务事实来源。课程、成绩、考试、作业和通知保留在各自的顶层集合与分片中；`CampusState.dataCatalog` 只保存体测、全校课表、官方校历等需要按来源和作用域归档的专项资料。归档记录包含来源、作用范围、采集时间、解析版本、刷新状态和规范化数据；原始网页、Cookie、密码及会话令牌不进入资料库。

首个专项归档集合是健康云体测：一次导入会尝试读取全部可发现年度并缓存成功结果，之后按年份本地切换；缓存缺失或用户主动更新时才重新访问学校平台。对外提供 `GET /v1/data-catalog` 与 `GET /v1/fitness?year=YYYY-YYYY_N`，并包含在 `theia-feed` 的 `localData` 中。

后续专项归档可沿用 `dataCatalog` 的来源追踪、离线读取和刷新语义；已有顶层业务集合继续由各自 adapter/service 与 CampusStore 分片管理，不为统一形式而重复搬入 `dataCatalog`。

---

## 线一：全自动作业流水线（规划）

### 目标状态

应用在后台运行，新作业出现后用户不需要做任何事，处理完成后收到一条通知，打开检查后手动提交。

### 数据流

```
onSnapshot → assignments 变化检测
  ↓
过滤：status === 'pending' + 无 answer-ready 的 workspace
  ↓
加入 AutoQueue（去重，避免重复处理同一作业）
  ↓
prepareCourseWork(id)          ← 下载题目，建立 workspace
  ↓
buildContext(id, campusState)  ← 见"上下文模型"
  ↓
processCourseWorkWithModel(id) ← 注入上下文后调用模型
  ↓
if kind === 'online-test'  → applyTestAnswers(id)
if kind === 'assignment'   → renderAnswerPdf(id)
  ↓
系统通知：「XX课·作业已处理完成，请审核后手动提交」
```

### 上下文模型

每次调用 `processCourseWorkWithModel` 前，从 `CampusState` 提取以下信息注入 prompt：

**课程上下文**
- 课程名、类别（必修 / 选修）、学分、教师
- 该课历史成绩（`grades.filter(courseName)`）→ 判断答题风格和难度期望

**学业上下文**
- 当前三种 GPA 值（全程 / 最高 / 正考）
- 专业和年级 → 影响论述格式要求
- 用户学业目标（保研 / 就业 / 出国 / 考研）→ 影响笔记和论文风格

**任务上下文**
- `assignment.kind`：online-test 用答案格式，assignment 用完整论述格式
- `workspace.taskPath`：题目文件路径（已有，直接传）
- 截止时间距今天数 → 影响优先级提示

### 目标自动化边界

下表描述完成自动编排后的边界，不表示当前已经存在后台队列或无人值守执行。

| 操作 | 自动 | 说明 |
|---|---|---|
| 建立工作区 | ✓ | 本地操作，可回滚 |
| AI 处理 | ✓ | 可无监督运行 |
| 填入测试答案 | ✓（可关闭） | 幂等，可人工覆盖 |
| 渲染 PDF | ✓ | 可无监督运行 |
| 提交至平台 | ✗ | 必须人工审核后手动提交 |
| 生成笔记 / 论文 | 按需 | 非所有作业都需要，手动触发 |

---

## 线二：顾问 AI（P0-P3 与惰性 Agent 已有）

### 架构：计算层 + AI 叙述层

顾问功能分两层，职责不同：

**计算层（纯逻辑，不需要 AI）**

当前确定性层已实现逐领域 DataQuality、EvidenceRegistry、typed LocalClaim、数据质量风险、作业/考试时间记录风险、确定性 Agenda、培养方案/GPA 分析、纯算术 What-if、只读选课决策与离线 `advisor:get-overview`。它不会调用模型或学校网络。学业 GPA/学分页面统一使用 `theia-academic-analysis/v1` 派生模型；体测窗口、第二课堂和创新学分仍只有在来源、规则版本和失败语义明确后才能接入：

从 `CampusState` 实时推断：
- 升级线缺口：已获必修学分 vs 各年级门槛
- GPA 风险：当前最高 GPA vs 2.00 学位线、距预警阈值
- 体测窗口：当前教学周 vs 第 5–12 周开放窗口
- 作业紧迫度：`dueAt` 距今天数，按红 / 黄 / 绿分级
- 考试倒计时：`exams.startAt` 最近 N 场
- 第二课堂缺口：各维度（道德 / 学术 / 体育 / 美育 / 劳动）距满分距离
- 创新学分缺口：距 4 分门槛，课程学分 vs 实践学分各几分

输出：`RiskSignal[]`（学业风险）+ `UrgentItem[]`（近期截止），按优先级排序。
每次打开应用实时重算，不缓存。

**AI 叙述层（按需，用户主动触发，当前实现）**

用户点击"解释"或"今天该做什么"时，AI 拿计算层输出生成自然语言：
- 解释为什么这件事最重要
- 数字的含义（"差 0.13 绩点" → "下学期两门课拿 C 就触发无学位警告"）
- 当下具体可执行的一步建议

当前模型首包只包含用户问题、快照 revision 和受限对话导航提示；模型通过惰性数据工具按需读取数据质量、校园记录、规范学业分析、截止事项和单封邮件正文，并可在任务需要时调用已声明的同步、公开 HTTPS、校园页面、THEIA 设置和已保存目标选课操作。工具结果绑定同一快照并保留不可信文本边界，流式回答按原文保存，不再使用旧的最终回答 JSON 校验或预投影 ContextBuilder。

### 顾问不做什么

- 不预测"你会不会毕业"（推断可以，预测不做）
- 不主动弹窗打扰（只在用户打开对应视图时展示）
- 不评价用户的学习习惯或决策

---

## 目标模型分配

现有设置项：`settings.modelBaseUrl`、`settings.modelName`、`settings.modelModels`。

| 用途 | 模型选择 | 原因 |
|---|---|---|
| 作业处理 | 最强可用模型 | 重型任务，输出质量优先 |
| PDF 渲染 / 答案填写 | 同上 | 已在处理流程中 |
| 顾问叙述 | 较小 / 较快模型 | 轻型任务，短输出，响应速度优先 |

当前没有按角色路由模型，现有流程只使用显式保存的 `modelName`；不得从 `modelModels` 数组顺序推断“重型/快速”角色。未来若需要分工，应增加明确的 `role -> modelId` 配置并逐项探测能力。

---

## 与现有 API 的对照

| 需要实现的方向 | 已有 | 需新增 |
|---|---|---|
| 作业自动队列 | `onSnapshot`、`prepareCourseWork`、`processCourseWorkWithModel`、`applyTestAnswers`、`renderAnswerPdf` | AutoQueue 状态机 + 用户设置开关 |
| 上下文注入 | `workspace.taskPath` 传给模型 | `buildContext(id, campusState)` 提取函数 |
| 风险计算 | P0 DataQuality、Evidence、作业/考试时间风险与 Agenda；`AcademicProgress.roots`、`Grade[]` 可作为后续输入 | 培养方案、GPA、体测窗口等复杂规则 |
| 顾问叙述 | `summarizeNotices` 可参考调用模式 | `explainRisks(context)` 新接口 |
| 用户通知 | 无 | Electron `Notification` API |
