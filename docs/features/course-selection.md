# 抢课

## 页面目标

抢课页把“想选哪门课”拆成三个部分：先发现可选教学班，再保存目标，最后在用户明确启动的时间窗口里执行有限尝试。

## 主要内容

- 发现抢课入口和全校教学班。
- 从全校课表里搜索并筛选候选课。
- 保存或移除目标教学班。
- 配置哨兵和执行参数。
- 开始和停止有限次数的抢课任务。
- 实时日志，显示当前任务进度。

## 数据来源

- courseSelectionPortal
- courseSelectionCandidates
- courseSelectionCatalogPage
- courseSelectionSnapshot
- schoolSchedule
- academicCalendarAnalysis
- 当前顾问快照 revision

## 边界

- 必须由用户手动开始和停止。
- 只在用户设定的窗口里跑有限尝试。
- 不会自动替用户做学校侧最终决定。
- 目标会保存在本机，方便下次继续，不是云端队列。

## 相关文件

- src/views/CourseSelectionView.tsx
- src/views/course-selection/CandidateCatalog.tsx
- src/views/course-selection/SchoolSchedulePanel.tsx
- src/views/course-selection/selection-helpers.ts

## 细节

### 从发现到执行

- 先用“发现”找出可抢课入口和当前可见的全校教学班。
- 再从课表面里筛选、搜索并保存目标。
- 目标一旦保存到本机，后续就能复用，不必每次都重选。

### 目标队列

- 目标列表里的每门课会单独执行，不会混成一个笼统任务。
- 列表里会显示课程名、教学班和当前状态。
- 移除目标只影响本机队列，不会改学校端数据。

### 哨兵和执行窗口

- 哨兵配置保存 startAt、endAt、intervalMs、concurrency 和完成目标集合。
- 开始按钮会把当前目标、时间窗口和尝试上限一起送进执行器。
- 停止按钮会终止正在跑的任务，不会继续偷偷尝试。

### 日志和空态

- 实时日志负责告诉你当前任务跑到哪一步。
- 没有目标时，页面会提示先从全校课表加入抢课目标。
- 如果只剩空列表，不代表功能坏了，通常只是还没保存目标。

## 代码级细节

- CourseSelectionView 直接接收 portal、candidates、candidateCatalogPage、snapshot、schoolSchedule、academicCalendarAnalysis 和一组回调，页面本身不做桥接调用。
- 组件状态拆成 startAt、endAt、intervalMs、maxAttempts、concurrency、schoolTarget 和 currentJob 相关显示；persistedSchoolTargets 由 snapshot.targets 或 snapshot.target 汇总出来。
- sentinel 取 snapshot.sentinel 或默认对象，里面保存 enabled、startAt、endAt、intervalMs、concurrency 和 completedTargetIds。
- persistSelectionWindow 会把本地 startAt / endAt / intervalMs / concurrency 重新写回哨兵配置，自动选择窗口也会复用这条路径。
- onDiscover、onLoadCandidates、onSearchSchoolSchedule、onSaveSchoolTarget、onRemoveSchoolTarget、onSetSentinel、onStart 和 onStop 是页面外部真正负责副作用的入口。
- taskLogs 把当前活动任务整理成能显示的日志行，activeJob 则决定按钮是否禁用和“停止任务”是否可见。
