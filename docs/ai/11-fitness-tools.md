# 体测与学习工具

## 体测导入

入口为 `theia:get-fitness-score`。主进程先从 `dataCatalog` 返回命中年份；缺失或用户 force 时使用学校 Chromium session 访问健康云，再由 `TyglAdapter` 解析。

健康云“体质测试”年份常在下拉项中出现（如 `2026(1)`）。主进程读取全部可发现年份、规范为 `YYYY-YYYY_N` 并一次写入归档；之后 UI 切换年份必须本地秒切换。

`TyglAdapter` 解析两种表格布局，并从资料区域补齐性别、年级、身高、体重。字段为 `vitality`、`run50`、`flex`、`jump`、`strength`、`endureSecs`、`heightCm`、`weightKg`、`gender`、`academicGrade`、`gradeGroup`。

## UI 工具

- `FitnessCalc.tsx`：读取归档并允许计算用局部输入；导入原始结果不能直接篡改。
- `InnovationCalc.tsx`：创新创业教育学分缺口估算与 2023 手册规则参考。课程 2 + 实践 2 + 合计 4 的门槛、实践项目分值、项目状态和潜在分值都只存在 renderer 当前会话；页面不声称学校正式认定，也不替代教务系统入账。
- `SecondClassCalc.tsx`：第二课堂维度积分。
- `WarningCalc.tsx`：学业预警计算。

新工具要保存历史则走 `dataCatalog`；单次计算与表单状态留 renderer。parser/归档每种输入布局都需测试，不只测最终 UI。

