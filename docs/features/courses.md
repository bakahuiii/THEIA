# 课程

## 页面目标

课程页展示 THEOL 当前可见的课程清单，帮助用户查课程信息、看资源和打开原始来源。

## 主要内容

- 按学期、课程类别和搜索词筛选课程。
- 课程卡片里展示课程号、标题、教师、学分、类别和来源学期。
- 课程资料弹窗，集中看课程信息、教学材料和资源链接。
- 资源刷新和资源下载。
- 打开课程原始来源链接。

## 数据来源

- state.courses
- state.schedule
- state.selectedCourses
- state.grades
- terms
- THEOL 当前可见课程列表

## 边界

- 这里只展示 THEOL 已发现的课程，不代表所有学期的历史课程都完整。
- 资源刷新和下载都只是读取或缓存本机内容，不会改学校端数据。
- 找不到课程时，页面会说明是搜索条件不匹配还是还没同步到课程。

## 相关文件

- src/views/CoursesView.tsx
- src/ui/app-shared.tsx
- src/types.ts

## 细节

### 筛选顺序

- 先做文本搜索，再做课程类别过滤，再按学期过滤。
- 搜索词同时匹配课程名、课程号和教师。
- 课程卡片展示的是 THEOL 可见的当前课程，不是教务全量历史。

### 课程资料

- 课程资料弹窗优先展示教学材料，其次是课程信息和资源链接。
- 如果课程里有已知的教学大纲、日历或简介链接，会优先列出来。
- 资料可刷新；刷新失败只提示错误，不会影响卡片本身。

### 资源下载

- 资源下载和打开原始来源都通过桥接层完成。
- 下载时会显示下载中状态，结束后才切回可操作。
- 课程信息为空时，会回退到“教师信息待同步”之类的占位文案。

### 兼容性

- THEOL 只提供当前活跃课程，学期由系统里发现的学期补全。
- 如果一个课程同时在多个学期出现，页面会把可关联的学期一起列出来。

## 代码级细节

- CoursesView 先用 normalizeCourseValue、termRank 和 relatedTerms 生成每门课可关联的学期集合，再统一做搜索和类别过滤。
- 组件状态包括 termId、categoryFilter、selectedCourseId、refreshingCourseId、resourceError、downloadingResourceId 和 previewMaterialId。
- selectedCourse 通过 selectedCourseId 从 theolCourses 里回查；弹窗里的 previewLinks、otherLinks 和 courseInfoEntries 都是在这个对象上继续拆。
- refreshResources 和 downloadResource 都是 async 包装，先改本地状态，再调用 onRefreshResources / onDownloadResource，失败时只写 resourceError。
- 课程资料里如果某个链接有 contentPreview，会走预览；否则 onOpenSource 直接打开原始 URL。
- 课程卡片本身只展示摘要，真正的资源列表、预览和下载都在 Dialog 里完成。
