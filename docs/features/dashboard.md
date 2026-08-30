# 概览

## 页面目标

概览页是 THEIA 的默认落点。它不负责修改数据，只负责把当前最重要的事情摆到最前面，让用户在最少的点击里进入下一步。

## 主要内容

- 顾问首要行动，直接给出当前最需要处理的一件事。
- 快速入口，直达课表、考试、成绩和校园地图。
- 关键计数，展示课程、待办、考试和成绩记录数量。
- 今日课表，按校历和当前周次过滤今天真正应该出现的课程。
- 待办作业，按截止时间排序，展示最近几项。
- 下一场考试，展示最早到来的考试安排。
- 最近通知，展示最新的教务和 THEOL 动态。

## 数据来源

- state.schedule
- state.assignments
- state.exams
- state.notices
- state.courses
- 校历数据，用来判断今天是不是教学周或假期
- 顾问的首要行动摘要，用来显示 Top 1 提示

## 边界

- 这里展示的是预览，不是编辑页。
- 空状态不等于没有数据，校历假期或同步未完成时要保留语义。
- 每个卡片的跳转都只去对应详情页，不做额外写入。

## 相关文件

- src/views/DashboardView.tsx
- src/ui/calendar.ts
- src/ui/app-shared.tsx
- src/views/AssignmentsView.tsx
- src/views/AdvisorView.tsx

## 细节

### 页面结构

- 顾问 Top 1 固定在最上方，只有当前有可用建议时才显示 severity 标签。
- 快速入口固定是课表、考试、成绩和校园地图，优先放最常用的跳转。
- 计数卡片只负责摘要和跳页，不承担筛选或编辑。

### 数据解释

- 今天课表要同时通过星期、校历假期、教学周和课程周次判断。
- 待办作业先排除已提交和过期项，再按截止时间排序。
- 下一场考试按真实开始时间排序，取第一个晚于当前时间的记录。
- 通知预览按发布时间倒序，最新内容先出现。

### 空状态

- 校历判断当前是假期时，会显示假期文案，不会把它写成“今天没有课程”。
- 如果当前不在教学周，会说明课表不会被解释为没有课程。
- 老快照里缺少一些字段时，页面会保守显示“待定”，不把缺字段当作无数据。

### 相关行为

- 每个卡片点击后只负责跳转到对应页面。
- 这一页不会修改任何业务数据，也不会写回学校系统。

## 代码级细节

- DashboardView 先用 useMemo 计算 academicCourseCount，再把 state.schedule、state.assignments、state.exams 和 state.notices 归成 today、pendingPreview、nextExam 和 noticePreview。
- today 的过滤依赖 currentShanghaiWeekday、currentAcademicWeek、currentAcademicVacation 和 occursInWeek，避免把假期或非教学周误显示成空课表。
- DashboardAdvisorTop 直接接收 advisorItem、advisorLoading 和 advisorError，并根据 item.severity 渲染紧急度标签。
- QuickActions 固定导航到 schedule、exams、grades 和 map，点击只调用 onNavigate。
- 课程行用 ScheduleRow 展示 period、teacher、room 和 weeks，显示的是已经准备好的本地状态，不会再查一次学校端。
