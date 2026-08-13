# 教务系统与 API 优先策略

## 两条数据通道

1. 浏览器统一认证：`JwglxtAdapter` 使用 Electron session，适用于没有 API 凭据的用户。
2. 教务 API：`AcademicApiFirstAdapter` 使用教务独立账号密码与 `AcademicApiClient`。

API 启用且已保存凭据时，教务数据优先使用 API；API 未启用或未配置凭据时使用浏览器通道。已启用 API 的本次请求失败时保留旧数据并报告错误，不在同一轮同步中静默切换通道。THEOL 仍独立同步。

## 关键文件

- `core/academic-api-client.mjs`：教务登录、RSA 密码加密、cookie jar、API 请求和结构化错误。
- `core/academic-api-adapter.mjs`：API 调度、失败保留与诊断。
- `electron/academic-api-vault.mjs`：独立加密凭据。
- `core/adapters/jwglxt.mjs`：官方页面与学期扩散策略。
- `core/parsers/jwglxt.mjs`：HTML/JSON 到规范化数据。

## 学期策略

课表从当前活跃学年向入学年份扩散；入学年份由学号前四位推断。不要抓取入学前年份，也不要用固定“九学期上限”。学期代码通常 `3`、`12`、`16`，UI 只展示可见范围。

## 修改保护

- 官方培养方案存在时，API 的空 `academicProgress` 不能替换它。
- API/网页暂时失败时，保留已有成绩、课表、学业树。
- 考试按时间近到远；成绩备注原样保留并以语义色区分。
