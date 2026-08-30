# 作业

## 页面目标

作业页负责把 THEOL 的作业和在线测试整理成本地工作包，帮助用户在提交前准备内容，但不替用户完成最终提交。

## 主要内容

- 待完成、已提交、全部三种视图。
- 自动隐藏过期任务。
- 为单个任务准备工作包。
- 打开工作区，查看本地任务材料。
- 导入答案 JSON。
- 把测试答案写入学校页面。
- 生成答案、笔记或论文草稿。
- 把草稿渲染成 PDF，再打开查看。
- 打开原题或原站，回到学校页面核对和提交。

## 数据来源

- state.assignments
- state.workspaces
- 当前工作中的 assignmentId
- 模型服务是否已配置

## 边界

- THEIA 不会自动替用户按下最终提交按钮。
- 模型相关按钮只在模型服务可用时启用。
- 这个页面强调的是准备和编辑，不是代提交。

## 相关文件

- src/views/AssignmentsView.tsx
- src/components/AssignmentRow.tsx
- src/views/CommunicationsView.tsx

## 细节

### 视图模式

- 待完成、已提交和全部三种模式互相切换。
- 每次切换模式都会回到第一页，避免页码越界。
- 过期任务会被隐藏，不会出现在列表里干扰当前处理。

### 工作包和动作

- 准备工作包会把题目、附件和模板拉到本地工作区。
- 打开工作区后可以继续查看本机材料。
- 导入答案 JSON、写入测试页、选择文件提交、打开原题或原站都在行内按钮上。

### 模型辅助

- 生成答案、笔记和论文只在模型服务可用时启用。
- 渲染 PDF 会把本地草稿变成可检查的文件。
- 打开 PDF 只是查看渲染结果，不会替你提交学校页面。

### 排障观察点

- 任务行上的 working 状态表示当前任务正在处理。
- 48 小时内到期的未提交任务会被标成更紧急。
- 工作区里的问答数和附件数只是在告诉你本地材料是否完整。

## 代码级细节

- AssignmentsView 自己只管 mode、page 和 workspaceByAssignment 三个状态；真正的任务行由 AssignmentRow 渲染。
- 列表先用 isExpiredAssignment 过滤，再按 mode 选择待完成、已提交或全部，最后按 dueAt 排序。
- LIST_PAGE_SIZE 固定为 50，pageCount 变化时会自动把页码拉回合法范围。
- AssignmentRow 根据 item.kind 判断是不是在线测试，再决定显示“导入答案 JSON”“写入测试页”还是“选择文件并提交”。
- 工作区相关按钮依赖 workspace 是否存在；模型相关按钮还要看 modelConfigured 和 working 状态。
- NoticesView 和作业列表共用同一个文件，通知页在这里是通过 selected Notice、分页和弹窗完成的。
