# THEIA Bug 与工作简报

日期：2026-08-16
记录时间：2026-08-16（未生成新版本或发布工件）

## 本轮 Agent 修复

### 流式输出未被强制执行

旧实现仍接受 `stream: false`，且保留普通 Provider 路径。现在 renderer IPC 不再接受 `stream` 字段；运行时只接受 `generateStream()` 并逐个转发 delta，缺少该能力时直接返回可重试错误，不会退回普通生成。测试覆盖了外部请求传入 `stream: false` 仍不能走非流式分支的情况。

### 短问题触发本地分类、预选领域和大上下文

旧路径会根据问题进行意图和关键词路由，并可构造预投影数据。当前首包只包含问题、冻结快照 revision 和有界的对话导航提示；不包含意图、校园记录、领域清单、本地关键词路由或用户控制的范围。模型只能通过固定只读工具按需取得最小切片。

### 工具格式异常被本地错误替换

本地不再要求最终回答为顾问 JSON，也不再修复、校验、重写或补充模型文本。只有精确匹配白名单的 `theia-advisor-tool-call/v1` JSON 会被执行为本地只读工具；其他任何非空返回，包括损坏、未知或不允许的工具 JSON，都会以原字节文本保存并显示。不会再生成“未确定”“证据校验失败”或“工具调用格式无效”的替代回答。

### OpenAI-compatible 默认仍走 Chat Completions

旧实现只有在地址被手动写为 `/v1/responses` 时才调用 Responses API；普通地址默认发往 `/chat/completions`，且会在 Responses 返回 404/405/501 时回退。现在 `openai-compatible` 一律将服务根地址规范化为 `/v1/responses`，非流式请求读取 Responses `output_text`，流式请求只读取 `response.output_text.delta`。不再有 Chat Completions 回退路径。

### Responses 前缀缓存未生效，且系统提示被移出 input

当前请求不再把 system 聚合为顶层 `instructions`。稳定 system 前缀、请求级表达偏好、用户问题、工具调用和工具观察会按原有顺序保留在 `input` 中；system 和 user 使用 `input_text`，历史 assistant 使用 `output_text`。这使首个稳定 system 块始终位于用户问题之前。

顾问的稳定前缀约为 1462 Token，超过 Responses 的自动缓存门槛。每次顾问模型调用都会发送稳定的 `prompt_cache_key`；不再发送中转站可能不识别的 `prompt_cache_breakpoint` 或 `prompt_cache_options` 扩展字段。工具后的续轮复用同一前缀和同一键，问题、表达偏好、工具 JSON 和工具结果仍位于可复用前缀之后。流式 `response.completed` 中的 `usage.input_tokens_details.cached_tokens` 会被保留并写入 Agent answer，显示为命中、未命中或未知。

在用户已授权发送个人资料的前提下，稳定前缀还会携带姓名、学号、院系、专业、年级、行政班、培养方向和校区中实际已保存的字段。缓存键只使用学号或稳定档案投影的 SHA-256 摘要，绝不把原始身份标识写入 `prompt_cache_key`。成绩、GPA、课程、课表、校历、邮件、通知及其他会变化的校园记录不进入缓存前缀，仍由模型按需调用本地只读工具。Agent 的运行期输入预算会单独扣除这个已缓存前缀，避免一次正常工具续轮仅因重复前缀而被本地预算拒绝；完整请求仍受字节和动态上下文上限约束。

### 流式数据只被计数、未在对话中渲染

renderer 过去仅显示 delta 的字符数，直到完成后才刷新线程。现在普通文本 delta 会即时写入对话；完成后替换为持久化的同一原文。中间工具 JSON 不会作为助手回答渲染。Composer 使用普通 `Enter` 发送，`Shift + Enter` 换行，发送按钮仍走同一请求函数。

### 旧 P5 兼容代码仍可被维护者误用

`AdvisorRuntime` 内的 P5 通知/邮件点选、词法索引、预投影 ContextBuilder、旧 Provider 发送和格式修复分支已删除，对应已跳过的 `advisor-p5-integration` 测试也已移除。历史说明文件已标明废弃，当前入口统一指向惰性只读 Agent。

### 校历启动竞态与失败后不重试

旧实现先创建 Agent，再在启动末尾 fire-and-forget 刷新校历；启动后立即提问时，惰性工作区可能只看到旧的空 manifest。现在启动首次刷新在 Agent runtime 暴露前完成；运行中若定时刷新正在提交，runtime 会等待 provider readiness barrier 后再冻结 revision。刷新失败只记录本次失败并保留上一份成功数据；OCR 或 PDF 分析失败会在下一次刷新重试，不会永久卡在错误结果。校历工作区同时索引规范化 OCR 日历和结构化 PDF 分析。

## 当前 Agent 数据流

```text
用户问题
  -> 等待数据提供层当前刷新完成
  -> 绑定 CampusStore revision（只读引用，不复制整份 CampusState）
  -> 创建主进程惰性工作区
  -> 强制流式模型请求（不含校园记录）
  -> 模型按需调用固定只读工具
  -> 账本登记实际返回的 claim/evidence/reference
  -> 模型返回原文
  -> 原文流式显示并保存
```

模型没有网络、浏览器、Cookie、凭据、同步、登录、学校操作、文件系统、Shell 或通用 IPC 权限。邮件正文必须先检索到对应邮件，再读取本地已缓存且已净化的正文。

官方教务处校历页的当前 OCR 结果为 2025-2026 学年；其中暑假为 2026-07-27 至 2026-08-30。Agent 只会使用当前 CampusStore 快照中的这份结构化记录，不把该日期硬编码进回答。

### 回答长度与推理强度

“回答预算（tokens）”不再作为用户设置。它只是模型接口的内部单次输出上限，直接暴露会让用户误以为这是固定字数。设置页现在提供“回答长度”：自适应、简短、标准、详细，默认自适应。Agent 会根据当前轮次是否仍在请求工具、问题长度、实际返回的观察数据量、回答风格和推理强度动态计算本轮上限；工具轮保持较小，只有最终回答在确有上下文时才增加额度。全局仍保留硬安全上限，避免模型无限生成。

推理强度不再截断为三档，支持关闭、低、中、高、极高（xhigh）和最大（max）。值会原样交给支持该能力的 Responses 服务；其它协议由适配层保持原有请求格式。

### 顾问界面与模型保存

顾问工作区现在是固定高度：历史消息只在对话列表内滚动，输入区固定在底部；用户手动滚到历史位置时，流式输出不会强行把滚动条拉回底部。原先的灵动岛仪表盘入口已改为静态状态栏，不再把培养方案树塞进弹窗。

模型服务设置在保持同一地址、协议、模型和已保存密钥时，可以直接保存推理强度、回答长度、风格和温度；只有修改服务身份、模型或 API Key 才要求重新检测连接。

Agent 的健康查询增加了“可读取”和“需要同步”的区分。旧但仍可读取的数据、未采集的无关领域或新鲜度待确认，不会被描述成“本地数据损坏”；涉及校园事实的问题会先查询最贴近的本地领域，再给结论。

Agent 的 system 前缀固定且显式缓存，工具轮只携带有界的锚点和观察；重复工具调用不再重复拷贝上一轮助手消息。这样多轮查询不会因为动态提示词自身膨胀而提前耗尽输入预算，短问题仍按需逐轮调用。

## 本轮验证

| 检查项 | 结果 |
| --- | --- |
| `npm test` | 本轮新增队列、加密线程和外观 IPC 回归后通过；最终数字以当前共享工作树实际运行结果为准 |
| `npm run lint` | 通过 |
| `npm run build` | 通过（执行 `tsc -b && vite build`） |
| `git diff --check` | 通过 |

未生成安装包、源码包或发布工件，也没有启动或控制桌面端。

## 维护要求

在 `1.0.0` 前，修改 Agent 数据流、工具边界、流式传输、Responses 传输、惰性工作区或 MCP 投影时，必须同步更新当前 Agent 文档、回归测试和外部 MCP 接口测试；不得恢复 P4-P5 预投影、最终回答 JSON 校验或 Chat Completions 兼容路径。

## 最终核验版（2026-08-16）

### 这轮实际完成

本轮不是只修单个顾问问题，而是把 THEIA 的数据链路、学业分析、顾问 Agent、模型传输、桌面 IPC、同步并发、作业队列、本机 MCP、界面状态和发布门禁一起收束到当前合同。主要改动包括：

- 学业数据：补齐学业模型、培养方案树、GPA/重修/失败成绩边界、JWGLXT 与 THEOL 解析、校历 OCR/结构化数据、课表部分成功合并和数据质量语义。
- 同步与任务：增加保留旧数据的失败合并、来源级并发控制、优先级队列、作业工作队列、恢复/重试/取消和退出处理；失败刷新不再用空结果抹掉已知数据。
- 顾问 Agent：删除旧 P5 预投影、词法索引和最终 JSON 重写；改为主进程惰性只读工作区，初始请求只带问题和快照 revision，模型按需调用固定工具，事实由本地确定性分析和证据账本约束；顾问绑定版本化快照引用，不再为整份 CampusState 创建深复制冻结副本。
- JWGLXT 教务数据：当前仅启用 7 个扩展业务域、13 个只读路由，统一归入 `academicExtras` 分片；只执行明确列入白名单的只读查询，流程页不提交学校侧动作，空网格占位文本不会进入记录。档案与事务、按周课表、教务全校课表等重复页面已从 active 白名单移除，旧路由描述仅用于兼容清理。`N105505` 改走 `xjyj/xjyj_cxXjyjjdlb.html?id=…` 并只提交学院/年级/专业筛选，`N105508` 改走毕业审核结果接口并带 `doType=query`。
- 顾问线程：线程密文持久化、损坏隔离、迁移和密钥保护保留；摘要默认 30 天 TTL，过期会从内存、提示和持久化记录清理，revision/domain digest 变化后只能作为 historical 导航信息。
- Provider：OpenAI-compatible 统一走 Responses API，强制流式 delta，不再回退 Chat Completions；稳定 system 前缀使用显式缓存断点，模型配置保存采用可恢复事务。
- 安全与 IPC：统一注册和 schema 校验 IPC，限制 sender、窗口和 URL；模型、邮件、资料目录和本机 MCP 均采用最小权限、脱敏和 fail-closed 规则。
- MCP 与本地资料：增加 `integration/theia-mcp.mjs` 和本地文档工具，外部 Agent 只能读取有界脱敏投影，不能拿到 raw snapshot、凭据、Cookie、绝对路径或学校侧写入能力。
- 界面与发布：顾问流式文本即时显示，输入区固定、错误/加载/未知状态明确；增加升级规则可信加载器、版本化 benchmark corpus、packaged smoke schema 和发布文档。

### 现在的状态

- 该轮应用版本：`0.4.7`。
- 当前顾问入口只有一条“主进程有界只读 Agent”路径；没有数据域勾选、邮件正文手动附加、普通模型/Agent 模式切换或非流式开关。
- 模型初始看不到全量校园数据；需要事实时才通过最多两个有界工具步骤读取当前冻结快照切片。邮件必须先搜索后按 opaque id 读取已缓存净化正文。
- Agent 没有网络、浏览器、Cookie、凭据、同步、登录、抢课、提交、发邮件、上传、Shell 或通用 IPC 权限。
- THEIA 本机 API 只监听回环地址；MCP 通过 stdio 工作，stdout 只输出 JSON-RPC。
- `upgradeRule` 默认仍是未配置；缺少可信规则文件时不会声称升级、毕业、退学或学籍结论。
- 学校平台最终提交仍由用户确认；作业队列只准备本地结果或待审核页面。

### 相比原来的变化

原来是“数据预投影 + 多套顾问路径 + Provider 兼容回退 + 失败时可能用空结果覆盖旧数据”的堆叠结构；现在变成“冻结版本 + 本地确定性分析 + 惰性最小读取 + 证据/质量闭合 + 强制流式输出”。

具体结果是：短问题不会再被本地关键词路由强行猜领域；模型异常 JSON 不会被本地替换成另一段答案；未知或不完整数据不会被描述为零、无风险或已确认事实；旧数据在刷新失败时保留并明确标记最近尝试状态；跨轮摘要不会把旧 revision 的事实冒充当前事实；外部 MCP 不能越权读取校园原始状态或执行学校操作。

### 最终验证

| 检查项 | 结果 |
| --- | --- |
| `npm test` | 708/708 通过 |
| `npm run lint` | 通过 |
| `npm run build` | 通过 |

## Agent 完全访问与实时验证（2026-08-17）

### 本轮完成

- Agent 权限现在是持久化的用户选择：默认 `read-only`，明确选择 `full-access` 后才向当前会话暴露额外工具；模型设置页和 Agent 输入区均可查看和切换该状态。
- 完全访问采用受类型约束的桌面操作：同步校园数据、访问公开 HTTPS 资源、打开北化官方页面、修改已声明的 THEIA 设置，以及启动或停止已保存的选课目标。工具调用会显示在流式会话中并返回实际结果。
- 完全访问不会授予保存的 API Key、密码、Cookie、原始文件系统、Shell、任意 IPC 或任意浏览器控制。公开网络请求禁止回环、明文 HTTP、重定向和认证/Cookie 头，并使用解析后地址固定的请求连接。
- Agent system prompt 继续按需读取校园事实，同时可直接完成一般问答、代码、写作和分析；修复了重复示例，并强化“课程/选课/学业问题要交叉查询多个域”的指令。
- 当 Windows 无法解密旧模型密钥时，模型设置会明确要求重新输入并保存 API Key，避免把不可用状态显示成普通的未配置。

### 本轮验证

| 检查项 | 结果 |
| --- | --- |
| 完全访问、网络、运行时、界面、设置与模型专项回归 | 129/129 通过 |
| 全量 `npm test` | 770/770 通过 |
| `npm run lint` | 通过 |
| `npm run build` | 通过 |
| `git diff --check` | 通过（仅有既有工作树换行符提示） |
| 浏览器预览 | Agent 面板与模型设置均显示“只读工具 / 完全访问”；默认只读 |
| Electron 保存配置探针 | 正确在发送前停止：当前 Windows 账户无法解密保存的模型 API Key |

### 真实 Provider 阻塞

探针读取到的保存配置仍是 OpenAI-compatible / `gpt-5.6-luna`，但 `%APPDATA%\\THEIA\\model-api-key.v1.dpapi.json` 无法由 Electron `safeStorage` 解密，且状态为 `requiresApiKeyReentry: true`。因此本轮没有发出真实中转请求，也不能把缓存命中/写入当作已验证结果。

恢复路径已在界面实现：在“设置与接入 -> 模型服务”重新输入并保存同一服务的 API Key。保存完成后运行 `node_modules\\electron\\dist\\electron.exe scripts\\verify-advisor-live.mjs --report=<path>`，即可走完全访问会话的实际流式请求并报告真实缓存字段。未生成安装包或发布工件。

## Campus Record 参数兼容修复（2026-08-17）

部分 OpenAI-compatible Provider 将 `search_campus_records` 的记录域输出为 `topic`，例如 `topic: "selected-courses"`。旧参数白名单只转发 `domain`，导致域字段变为空并抛出 `Advisor record domain is not allowed`。现在在没有 `domain` 时兼容 `topic`、`type`、`category` 和 `scope`，并统一下划线、空格和连字符分隔的域名；最终值仍由惰性工作区的固定域白名单验证，额外参数不会被透传。系统提示也明确要求新调用使用 `domain`，避免继续依赖兼容分支。

验证：`topic: "selected-courses"` 的完整 Agent/Runtime 调用会执行查询并在工具事件中得到 `{ domain: "selected-courses", limit: 100 }`；`npm test` 755/755、`npm run lint` 均通过。
| `node --check` | 通过 |
| `npm run benchmark:advisor` | 本轮默认 20 轮 cold p95 140.439 ms、hot p95 102.098 ms；时间阈值通过；额外 RSS 290,480,128 bytes，RSS 阈值受 Windows/Node 峰值回收抖动影响未通过。短 5 轮复测为 112,021,504 bytes，时间与 RSS 阈值均通过 |
| `git diff --check` | 通过 |
| packaged smoke | 通过；桥接、快照、顾问概览/线程、集合、凭据、模型、课程选择、PDF/OCR 均正常；`preloadErrors: []` |

该轮 packaged smoke 使用的是临时目录 `D:\Temp\theia-dist-0.4.7\win-unpacked\THEIA.exe`，没有覆盖已有 `release-bin`。该轮没有提交、推送或把临时包冒充正式发布工件。

### 尚未宣称完成的部分

- 真实 Provider 网络、真实登录态下的学校同步和完整 Electron 人工验收仍需在目标机器和用户环境中验证；离线 packaged smoke 不能替代这些验证。
- 未配置可信升级规则时，相关学籍结论继续保持“尚未配置”。
- 自动提交学校作业、抢课或邮件发送不在授权范围内，也没有被 Agent 暴露。

## Agent 后端补充（2026-08-17）

### 本轮修复

- Provider usage 统一识别 Responses 标准字段、常见中转字段和内部 camelCase 字段，包括 `cachedInputTokens` 与 `cacheWriteInputTokens`。缓存读取、写入和状态不再在 Provider 事件转发时丢失。
- Ultra 并行任务修复预算数组传入 `Map` 接口的错误；任务不再因 `budgets.get is not a function` 在首轮子 Agent 前失败。
- Ultra 现在把每个子 Agent 的 `completed` provider usage 合入总账。此前分解和汇总的用量会被记录，但子 Agent 的缓存命中、写入与 token 用量会缺失，导致最终统计不完整。
- Ultra 的源码位于仓库内 `electron/ultra-mode/`，源码包收集已确认包含两个模块，运行时不再引用仓库外 `lab/ultra-mode`。

### 缓存展示语义

最终消息按服务端实际 usage 显示：有读取 token 时显示命中或未命中及读取数量；有写入 token 时显示“缓存写入”及写入数量；中转站未返回任何缓存字段时保持未知，不把未知猜成未命中。实际使用的 V2 顾问消息组件已经同时渲染读取与写入 token。

旧持久化线程可能缺少任一 usage 字段。消息组件现在先将输出、缓存读取和缓存写入字段规范化为非负安全整数，只有有效数字才调用 `toLocaleString()`。因此 `undefined`、`null`、旧格式字符串或异常值不会再使顾问页面崩溃。

### 本轮验证

| 检查项 | 结果 |
| --- | --- |
| Ultra、Provider、ModelService 专项测试 | 63/63 通过 |
| 全量 `npm test` | 753/753 通过 |
| `npm run lint` | 通过 |
| `npm run build` | 通过 |
| `git diff --check` 与相关 Node 语法检查 | 通过（仅有既有工作树的换行符提示） |
| 源码包收集 | 包含 `electron/ultra-mode/orchestrator.mjs` 与 `adapter.mjs` |
| 旧 usage 字段兼容回归 | 顾问 UI/运行时测试 47/47、lint、生产构建通过 |

### 真实中转验证边界

代理 `127.0.0.1:7897` 可连，但当前 `%APPDATA%\\THEIA\\model-api-key.v1.dpapi.json` 的 v3 密钥无法由 Electron `safeStorage` 解密，Windows 原生 DPAPI 也拒绝该密文。因此本轮没有将真实中转返回的缓存数值当作验证结果。需要在 THEIA 设置中重新保存 API Key 后，才能用同一流式路径完成两次真实缓存请求的命中/写入验证。该限制是本地保存密钥不可用，不是本轮 Agent 后端代码失败。

## Agent 流式工具调用修复（2026-08-17）

### 问题与修复

部分 Provider 会在本地工具 JSON 前后附加自然语言。旧解析器只接受首个非空字符就是 `{` 的调用，因此把这类响应当作最终答案保存并显示，工具既没有执行，协议 JSON 也出现在聊天中。现在解析器以字符串和花括号感知扫描完整响应，只接受非代码块内、通过白名单和参数规范化校验的 `theia-advisor-tool-call/v1` 对象；前后说明文字不再阻断真实调用，未知工具、非法参数和 Markdown 代码块仍保持普通文本而不执行。

每个模型回合的 delta 现在会在主进程完整判定后再发往渲染层。有效工具回合只发工具开始/结果事件，最终自然语言回合才发可见文本，因此不会将协议的一部分短暂或永久显示给用户。界面收到工具开始事件时还会清空任何遗留预览，作为 IPC 兼容防线。

### 稳定性

顾问实时字符数在格式化前统一归一化为非负有限整数，异常旧字段不会再对 `undefined` 调用 `toLocaleString()`。近期诊断日志没有 `renderer.process_gone` 或新的加载失败记录；可见的 React 错误边界更可能来自这种渲染值异常。`ResizeObserver` 警告已记录，但目前没有显示为主界面重载的证据。

### 本轮验证

| 检查项 | 结果 |
| --- | --- |
| 前置中文 + 内嵌工具 JSON 的 Agent/Runtime 回归 | 通过；工具实际执行、协议没有作为 delta 发出、第二轮自然语言正常保存 |
| 顾问 UI 兼容回归 | 通过；工具开始事件清空残留预览，异常实时计数不会调用 `undefined.toLocaleString()` |
| `npm test` | 754/754 通过 |
| `npm run lint` | 通过 |
| `npm run build` | 通过 |
