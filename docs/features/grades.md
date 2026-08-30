# 成绩

## 页面目标

成绩页负责把学校记录、辅助计算和趋势图放在一起。页面里学校成绩优先，THEIA 的计算只作为辅助口径。

## 主要内容

- GPA 趋势图，可在阶段和累计之间切换。
- 学期筛选。
- 总 GPA、当前学期 GPA、已获得学分和成绩记录数。
- 成绩明细表。
- 成绩详情面板，按需查看更细的数据。
- 重新获取成绩明细的入口。

## 数据来源

- state.grades
- state.academicProgress
- state.profile.gpa
- grade-details 扩展域
- buildAcademicAnalysis、computeGpaTrend、computeGpa、computeEarnedCredits

## 边界

- 学校记录优先于本地计算。
- 本地计算是辅助结果，不替代学校正式成绩。
- 如果没有可计算 GPA 的成绩，页面会直接给空状态，不硬算。

## 相关文件

- src/views/GradesView.tsx
- src/views/grades/GradeDetailsPanel.tsx
- src/core/academic-model.mjs
- src/core/gpa.mjs

## 细节

### GPA 口径

- 学校记录优先，只有没有学校 GPA 时才显示本地计算值。
- 总 GPA 会把“学校记录”和“按成绩计算”分开说明，不混为一个数字。
- 本学期 GPA 只在选中学期时显示。

### 趋势图

- 趋势图可在阶段和累计之间切换。
- 切换后会重新绘制，而不是只改标签。
- 如果当前没有可计算 GPA 的成绩，图表会直接给空状态，不伪造点位。

### 明细和刷新

- 成绩详情域是单独刷新项，刷新失败不会抹掉已有成绩。
- 成绩记录会先做学期过滤，再统计学分和条数。
- 成绩明细里的状态和色阶来自统一的 GPA、成绩和备注口径。

### 排障重点

- 如果总 GPA 和趋势看起来不一致，先看是不是学校记录优先覆盖了本地计算。
- 如果明细比预期少，先确认学期筛选是不是开着。

## 代码级细节

- GpaTrendChart 用 metric 在 period 和 cumulative 之间切换，animationVersion 递增后会强制 svg 重新绘制。
- trend 来自 computeGpaTrend(grades, terms)，points 再被映射成 plottedGpa 和 plottedCredits。
- GradesView 先用 buildAcademicAnalysis 构造 academicAnalysis，再从 progress / gpa 里决定 officialGpa、computedGpa 和 displayedGpa 的优先级。
- termFilter 只影响 filtered、earnedCredits 和 termGpa，不影响总 GPA 和趋势图。
- GradeDetailsPanel 的刷新开关由 gradeDetailsRefreshing 控制，回调是 onRefreshGradeDetails。
- isGpaEligible、computeGpa、computeEarnedCredits 和 formatGpa 都来自 core/gpa.mjs，页面本身只负责展示和切换口径。
