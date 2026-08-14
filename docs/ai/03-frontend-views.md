# 前端页面地图

## 学业数据页面

| View | 文件 | 输入与特殊规则 |
| --- | --- | --- |
| 概览 | `DashboardView.tsx` | 聚合课表、考试、任务、通知；各块独立可滚动。 |
| 课表 | `ScheduleView.tsx` | 按节次和星期定位，不能把当天课程简单堆叠；课程色在同一学期稳定。 |
| 考试 | `ExamsView.tsx` | 可仅看未来考试；按时间近到远。 |
| 成绩 | `GradesView.tsx` | 用 `gpa.mjs`；GPA 按四位小数合同显示；图表有阶段/累计切换。 |
| 学业 | `AcademicProgressView.tsx` | 官方培养方案优先，缺失时按成绩降级分组；树形缩进比卡片更重要。 |
| 课程 | `CoursesView.tsx` | 仅展示北化在线THEOL课程；使用规范类别和 code，不显示内部十六进制 id；显示来源学年学期。 |
| 顾问 | `AdvisorView.tsx` | P1-P2 无模型工作台：Top 7、数据质量、证据、培养方案、GPA 与 What-if；合同见 `17-advisor-p1-p3-local-workbench.md`。 |

## 工具与服务页面

| View | 文件 | 说明 |
| --- | --- | --- |
| 校园地图 | `CampusMapView.tsx` | 保存底图、缩放、平移；图层坐标必须对齐。 |
| 抢课 | `CourseSelectionView.tsx` | 展示/控制 `CourseSelectionService` 状态，并显示隔离的 P3 本地只读候选排名；排名不得触发选课执行。 |
| 作业、通知 | `AssignmentsView.tsx` | THEOL 只负责作业/测试；过期任务过滤。 |
| 邮箱 | `MailboxView.tsx` | IMAP 本地缓存；HTML 在 CSP iframe 内显示。 |
| 工具 | `ToolsView.tsx` 和 `views/tools/` | 不建立另一套业务数据源。 |
| 校园服务 | `CampusPortalView.tsx` | 外部服务入口，经主进程白名单打开。 |

## 交互边界

- view 不直接调 `ipcRenderer`、`fetch`、filesystem 或本地数据根。
- 业务动作由 `useTheiaApp` 传入回调；局部显示状态留在 view。
- 弹窗用 `components/ui/dialog.tsx`。详情长内容必须明确唯一滚动面。
