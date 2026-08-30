# 学习工具

## 页面目标

学习工具页是一个聚合页，把校历、培养计划、空闲教室、体测、场馆状态和几个本地计算器放在同一处。

## 子功能

- 文档：校历和培养计划。
- 空闲教室：按节次和条件查空闲教室。
- 体测评分：读入体测结果或手工估算分数。
- 场馆状态：查看 MOTION 公开场馆状态。
- 学业预警：按 GPA 和学分估算升年级和预警提示。
- 创新学分：估算创新创业教育学分。
- 第二课堂：估算德智体美劳相关分值和门槛。

## 数据来源

- dataCatalog
- state
- 学年学期的校历分析
- 公开场馆数据
- 各类本地归档文档和图片

## 边界

- 体测、预警、创新学分和第二课堂都是估算或辅助工具，不是学校正式认定页。
- MOTION 只看公开场馆状态，不提供预约、取消或支付。
- 校历和培养计划属于文档浏览页，不会写学校端数据。

## 相关文件

- src/views/ToolsView.tsx
- src/views/tools/AcademicCalendar.tsx
- src/views/tools/AcademicPlanView.tsx
- src/views/tools/FreeClassroomView.tsx
- src/views/tools/FitnessCalc.tsx
- src/views/tools/VenueStatusView.tsx
- src/views/tools/WarningCalc.tsx
- src/views/tools/InnovationCalc.tsx
- src/views/tools/SecondClassCalc.tsx

## 细节

### 文档子页

- 校历和培养计划共用“文档”页签，再通过子页切换。
- 校历页偏向浏览，培养计划页偏向当前专业的 PDF 和附件。
- 这两页都是只读文档，不承担写入。

### 空闲教室

- 先选学期，再选节次和条件。
- 结果会按当前本地数据和学校页面推得的来源展示。
- 如果没有结果，通常是筛选条件太窄，而不是页面失效。

### 体测、预警、创新学分、第二课堂

- 这几项都属于本地估算或规则计算。
- 体测页可以读导入结果，也可以手工估算。
- 学业预警页只告诉你风险和升年级推断，不是学校正式判定。
- 创新学分和第二课堂都提供规则计算和门槛解释。

### 场馆状态

- 只看 MOTION 公开场馆数据。
- 不提供预约、取消或支付。
- 页面每次实时刷新后才会生成最新状态视图。

## 代码级细节

- ToolsView 先用 tab 控制主页签，再用 documentTab 控制“文档”内部的校历 / 培养计划切换。
- 学习工具里的各个页都是独立子组件：AcademicCalendar、AcademicPlanView、FreeClassroomView、FitnessCalc、VenueStatusView、WarningCalc、InnovationCalc、SecondClassCalc。
- 文档页会把 calendarAssetUrls 和 academicPlanAssetBaseUrl 透传下去，校历与培养计划可以独立刷新。
- AcademicPlanView 可以通过 refreshingDomain === "academic-plan" 来显示刷新中状态，onRefresh 会把 academic-plan 再拉一遍。
- 公开场馆状态页走 VenueStatusView，不承担预约逻辑；体测、预警、创新学分和第二课堂页都是本地估算器，结果不回写学校端。
- 这里没有统一的桥接写入入口，全部是读、算、看。
