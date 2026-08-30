# 课表

## 页面目标

课表页负责把当前学期的课按周次和节次排开，方便快速查看今天、某一周或整个学期的安排。

## 主要内容

- 学期筛选，用来切换不同学期的课表。
- 周视图和全局视图切换。
- 今天按钮，回到校历认定的当前周次和今天的课程。
- 悬浮详情，点击某个时间块后展开课程明细。
- 未排定项，兼容旧快照里缺少节次或学期标记的课程。
- 导出课表 PDF，沿用教务系统的导出流程。

## 数据来源

- state.schedule
- terms
- academicCalendar
- 校历里的当前教学周和假期信息

## 边界

- 课表只读，不负责改课或调课。
- 旧快照里没有 termId 的课仍要显示，不能误判为消失。
- 假期里今天没有课，不应被写成“课表为空”。

## 相关文件

- src/views/ScheduleView.tsx
- src/ui/calendar.ts
- src/ui/app-shared.tsx

## 细节

### 筛选顺序

- 先按学期筛选，再按周视图或全局视图过滤，最后按星期和节次分组。
- 今天按钮会跟随校历中的当前学期和当前周次。
- 周次切换时，弹窗和当前选择会一起同步。

### 交互细节

- 点击课程块会在鼠标附近打开浮层，展示同一时间段的多门课程。
- 浮层支持拖动；按 Escape、点击空白或窗口变化都会关闭。
- 无法解析节次的课程会列到未排定区域，避免直接丢失。

### 兼容性

- 老快照里缺 termId 的课程仍然保留。
- 校历假期时显示假期提示，不把今天误写成“课表为空”。
- 导出 PDF 只是输出当前课表视图，不会改学校数据。

## 代码级细节

- ScheduleView 依赖 firstScheduledTermId、parsePeriodRange 和 clampPopoverPosition 三个小函数来做默认学期、节次解析和浮层定位。
- 组件状态包括 termFilter、weekMode、weekNum、calendarKey、todayNotice、popover 和 draggingPopover；popoverRef 与 popoverDragRef 分别保存浮层 DOM 和拖动起点。
- currentWeek 通过 currentAcademicWeek(calendar) 计算，useEffect 会在当前周变化时自动同步学期和周次。
- showToday 会先看 currentAcademicVacation，再看 currentWeek，最后才把 termFilter、weekMode 和 weekNum 改到今天。
- 课程浮层在 pointerdown、keydown Escape 和 resize 时关闭；拖动过程中用 popoverDragRef 记录 pointerId、offsetX 和 offsetY。
- 课程列表按 weekMode、termFilter 和 occursInWeek 过滤，未能解析节次的条目会落到 unscheduledItems。
