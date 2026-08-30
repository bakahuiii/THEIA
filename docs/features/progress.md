# 学业进度

## 页面目标

学业进度页负责把培养方案、课程完成情况、已选课和成绩放在同一棵树里，帮助用户判断还缺什么、哪条路径已经走完。

## 主要内容

- 培养方案树，按层级展示要求和子要求。
- 完成度进度条，展示已经完成的学分比例。
- 可选分支，标出满足其中一条路径即可的要求。
- 课程明细表，展开后看每门课的状态和成绩。
- 既有成绩归类视图，帮助把已修课程按性质归组。
- 已选课程与在读课程的关联展示。

## 数据来源

- state.academicProgress
- state.grades
- state.selectedCourses
- buildAcademicAnalysis
- 教务系统学业情况查询结果

## 边界

- 这里显示的是本地解释结果，不是学校官方判定页本身。
- 任何完成度变化都应该跟随新的同步结果刷新。
- 空状态不等于没有培养方案，只可能是数据还没拿到。

## 相关文件

- src/views/AcademicProgressView.tsx
- src/core/academic-model.mjs
- src/core/gpa.mjs

## 细节

### 树结构

- 每个要求节点都能展开或收起。
- 叶子节点显示课程明细，非叶子节点显示子要求和可选分支。
- 每层都会显示已完成学分、目标学分和完成比例。

### 和成绩的关系

- 成绩分组会按课程性质和类别重新归类，帮助理解“修过哪些课”。
- 未通过课程不会被算进已获得学分。
- 已选课程、成绩和培养方案一起用来判断进度。

### 使用时的观察点

- 可选分支提示的是“满足其中一条路径即可”，不是所有分支都必须完成。
- 课程明细表对照学校学业情况查询口径展示。
- 空状态通常意味着同步不到培养方案或学业进度，而不是学业真的为零。

### 排障

- 如果某个要求看起来过少或过多，先看它的子节点和课程明细。
- 如果学分不对，通常要回头看成绩和学业进度的同步结果。

## 代码级细节

- AcademicProgressView 里最核心的状态是 termFilter、expandedRequirements 和 useEffect / useCallback 组合出的展开控制。
- requirementTone、courseStatusTone 和 isFailedGrade 分别负责要求节点、课程状态和成绩是否失败的色阶判断。
- 官方培养方案通过 academicAnalysis.requirements 进来；如果 grades 足够完整，gradeRequirementGroups 会把成绩重新组织成一个替代树。
- RequirementNode 递归渲染子要求和课程明细，expanded 由 isExpanded(requirement) 计算，toggleRequirement 只改当前节点的展开布尔值。
- 课程明细表直接从 requirement.courses 输出，状态、年学期、课程号、课程名、学分、成绩和补考/重修列都在同一行里展开。
- useMemo 里构造的 roots 和 academicAnalysis 决定整棵树的入口，不会在渲染时临时改写数据。
