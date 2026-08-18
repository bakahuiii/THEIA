# THEIA 内嵌顾问与本地 Agent

更新日期：2026-08-17。

THEIA 的内嵌顾问只有一条模型路径：有界的本地 Agent。用户只需要提出问题；模型/Agent 自行判断是否需要查询数据，不勾选数据域、不挑选通知/邮件、不手动附加正文，也没有普通模型和 Agent 之间的模式开关。问题本身不足以判断目标时，Agent 应先给出基于现有事实的初步建议，再提出一个会实质改变结论的最小澄清问题；不能只回一个空泛的“你想怎么样”。选课与学业规划问题优先读取学业进度和课程/课表分析，再给出可执行的优先级与权衡。

## 请求生命周期

```text
用户问题
  -> 主进程冻结 CampusStore revision
  -> 计算本地 overview 与惰性数据工作区
  -> 向模型发送问题与可调用工具边界
  -> 模型按需请求有限工具
  -> 主进程投影并登记实际返回的证据
  -> 每轮流式闸门吞掉内部 tool-call JSON，只转发最终普通文本
  -> 原样保存模型回答到加密线程
```

初始 `theia-advisor-agent-session/v1` 不包含成绩、课程、课表、作业、通知、邮件、正文、体测数值或学业树。它发送问题、运行时上下文、数据目录和快照 revision；当前不会从问题文字生成 `intent` 或 `focusDomains`（`focusDomains` 固定为空），具体事实仍必须通过工具读取。新配置默认是 `read-only`（受控 Agent），保留既有的校园 typed tools；用户可显式切换到 `full-access`，该会话额外携带建议输出目录并投影通用本地工具。模型在当前工具范围内自行决定是否查询、查询哪个领域或执行用户要求的实际产物；涉及“我的/个人信息/个人博客/个人主页/简历”时运行时会先读取 `profile`。Ultra 也复用同一套当前会话工具，不会因 full-access 被降级为只读。

## 数据工作区

`core/advisor/lazy-workspace.mjs` 仅在 Electron 主进程创建。它从同一个冻结快照构造白名单投影，且从不暴露原始对象、文件路径、Cookie、凭据、会话、HTML、附件二进制或来源 URL。

可查询的校园领域为：学籍档案（可含姓名、学号、院系、专业、年级、班级）、作业与测试、考试、成绩、学业进度、课程、课表、已选课程、通知、邮箱、体测、校历、全校课表缓存和抢课目标缓存。通知和邮件保持 `untrusted`；邮箱正文只能在已检索到该封邮件后由 `read_message` 单独读取，且需已经在本地缓存。

固定工具：

| 工具 | 返回内容 |
| --- | --- |
| `get_data_health` | 所请求领域的质量目录与可引用的质量事实 |
| `search_campus_records` | 一个领域内至多 12 条白名单记录 |
| `search_local_facts` | 本地确定性分析已生成的 claim |
| `list_deadlines` | 作业与考试的确定性紧急项 |
| `inspect_academic_progress` | 培养方案、缺口、GPA、风险的分析切片 |
| `inspect_course_analysis` | 课表、课程、已选课程相关风险 |
| `read_message` | 已发现邮件的净化正文 |

标准 Agent 每个工具最多四次，整次默认最多 15 个步骤；顾问档位可将总步数提高到 30、50 或 100。预算由顾问档位控制，默认输入 50,000 tokens、输出 8,000 tokens。每轮必须使用 Provider 的流式接口，缺少流式能力时本轮失败而不会退回普通生成。Responses 的 `error`、`response.failed` 和 `response.incomplete` 事件会终止本轮并取消 reader；最终事件中的 input/output/cache usage 会保留到回答和诊断中，不能用占位值推断缓存命中。主进程不会根据中文问题做 intent 路由或 fast/deep/coursework 角色选择；模型按设置中的模型优先级运行，具体查询领域由 Agent 自行决定。

Ultra 仅在 `ultra` 档位和复杂问题下启用。它使用仓库内的 `electron/ultra-mode/`，通过同一 `generateStream({ model, messages, maxTokens, ... }, { signal, onEvent })` 契约运行分解、子 Agent 和汇总；子 Agent 显式收到当前问题、缓存键、取消信号和 revision-bound projected tools。任务图在运行前拒绝重复 ID、未知/循环依赖、未知工具和超限任务；失败任务只返回净化后的错误，已完成回合的 usage/cache 统计仍会保留。

## 证据闭合

工作区维护一个本轮证据账本。工具返回本地记录时，主进程生成对应的 claim/evidence；返回通知或邮件时，登记不可信 reference。普通模型文本按原文保存和显示；若模型主动返回 `theia-advisor-model-narrative/v1`，主进程只接受引用当前账本中存在且数字一致的 claim/reference，并把验证后的 blocks/recommendations 渲染为可读文本；伪造引用不会进入线程。

模型只有在需要读取本地数据或执行已授权操作时才返回精确的 `theia-advisor-tool-call/v1` JSON；否则直接返回自然语言。解析器容忍模型在开头工具 JSON 后附带解释，但只执行完整白名单对象；普通话术中的 JSON 不会触发工具。普通文本仅保留一个很短的协议判别窗口，随后逐 delta 转发；内部 tool-call JSON 不进入 renderer。未知工具或越界参数不会获得本地能力，重复调用会获得一次内部纠正，仍不生成本地替代回答。

## 能力边界

`read-only` 保留已声明的 `sync_campus_data`、公开 HTTPS `network_request`、校园页面打开、THEIA 设置更新和已保存目标选课控制工具，但没有通用 `filesystem`、Shell 或任意网页能力。`full-access` 额外投影 `read_file`、`write_file`、`list_directory`、`create_directory`、`delete_path`、`run_command`、`web_request` 和 `open_webpage`；本机用户承担这些操作的后果。两种模式都不暴露保存的 `credentials`/Cookie、浏览器会话、API Key、原始 IPC 或未声明的学校侧提交能力。

用户的“发送”操作只启动本地 Agent 运行，不是数据访问确认，也不会把全量校园数据库打包到初始 prompt。外部模型仅能收到它在当前问题中实际请求到的受限切片。线程历史默认只压缩为最多两条、1.2 KB 的导航提示，不把完整历史 transcript 自动并入下一次模型请求；工具续轮使用精简系统上下文，当前事实仍必须重新从本地工具读取。

## 维护入口

- 主进程运行时：[advisor-runtime.mjs](../../electron/advisor-runtime.mjs)
- Ultra 编排器：[orchestrator.mjs](../../electron/ultra-mode/orchestrator.mjs)
- Ultra 适配器：[adapter.mjs](../../electron/ultra-mode/adapter.mjs)
- 惰性工作区：[lazy-workspace.mjs](../../core/advisor/lazy-workspace.mjs)
- Agent 协议：[read-only-agent.mjs](../../core/advisor/read-only-agent.mjs)
- 引用验证：[citation-verifier.mjs](../../core/advisor/citation-verifier.mjs)
- 前端工作台：[AdvisorWorkbench.tsx](../../src/components/advisor/AdvisorWorkbench.tsx)
- 关键测试：[advisor-runtime.test.mjs](../../tests/advisor-runtime.test.mjs)
- Ultra 与流式失败回归：[advisor-ultra.test.mjs](../../tests/advisor-ultra.test.mjs)、[model-service.test.mjs](../../tests/model-service.test.mjs)
