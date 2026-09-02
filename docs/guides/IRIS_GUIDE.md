# Iris 使用指南

Iris 是 THEIA 内置的本机 QQ companion。它把 THEIA 的只读校园数据摘要、Codex/Claude/Hermes 任务通知以及可选的 HYPERION、SELENE 接口接到一个可信的 QQ 私聊中。

## 开始使用

1. 打开 THEIA 设置中的 **Iris companion**。
2. 填入 QQ Bot 的 App ID 和 AppSecret；Owner OpenID 可以留空，留空时 Iris 会把第一个私聊用户绑定为 owner。
3. 点击“保存凭据”，再点击“启动”。凭据使用 Windows 安全存储加密，THEIA 不会在界面或日志中显示 Secret。
4. 用绑定的 QQ 账号给 Iris 发“帮助”，查看当前可用指令。

首次安装不会自动连接 QQ。完成配置并启动后，Iris 会记住启用状态；在 THEIA 退出时会一并停止，下一次启动会按设置恢复。

## 默认显示

默认帮助菜单只显示 THEIA 只读指令，每行一个命令；同一行中的 `/` 表示可用缩写：

- `theia status/状态/s`：查看桌面端、本机接口、同步、数据域质量和学业概况。
- `theia today/今天/今日/now`：查看今天的课程、考试和作业截止事项。
- `theia agent/顾问/问问/a <问题>`：直接续接 THEIA 当前页面的 Agent 对话。
- `theia motion/运动/场馆/m <项目>`：查询今天指定运动项目的场馆状态表，例如 `theia motion 羽毛球`。场馆状态每次查询都会实时刷新。
- `theia classroom/教室/空闲/room <节次>`：按当前周次、星期和指定节次实时查询空闲教室图片，例如 `theia classroom 3-5` 或 `theia classroom 10`。带节次的请求不会使用未筛选的 180 条缓存总表。

Codex、Claude、Hermes、HYPERION 和 SELENE 默认不出现在帮助菜单中，但接口保持可用。需要让它们出现在 QQ 帮助里时，在“帮助菜单显示”页勾选对应 provider；只有想暂时停用某个接口时，才在“集成”页关闭它。

## Iris 控制面板

Iris 运行后会启动本机控制面板，默认地址为：

`http://127.0.0.1:38641`（若端口被占用，Iris 会自动选择其他本机端口）

THEIA 的 Iris 设置卡片会显示当前控制面板地址。控制面板可以：

- 开关 THEIA、Codex 和 Claude Desktop 等 provider；
- 选择哪些 provider 出现在 QQ 的“帮助”菜单；
- 编辑命令说明、自定义缩写和任务确认消息；
- 设置 Codex 工作区、桌面 IPC、Claude Desktop 路径和通知模板；
- 查看 QQ、THEIA、Codex、Claude 和 owner 绑定状态；
- 查看 Iris 日志尾部并发送测试通知。

控制面板只监听 `127.0.0.1`，不会作为公网服务开放。

## 数据边界

- THEIA 查询通过现有的本机只读 loopback API 获取，不读取 THEIA 的 Cookie、密码、原始网页、附件或内部数据库。
- QQ 消息只发送安全摘要；培养计划只发送元数据，不发送 PDF 正文、本地路径或附件。
- Iris 的 QQ Secret 存放在 THEIA 用户目录的加密信封中，不写入普通设置、状态返回值或日志。
- 其他 provider 只有在你主动使用或在控制面板中显示后才会出现在工作流中。
- Iris 不会自动提交选课、作业、在线测试或其他学校事务。

## 常见问题

### 点击启动后仍未运行

确认已经保存 QQ App ID 和 AppSecret，并检查 Windows 账户是否支持安全存储。若 QQ 凭据有效但网关仍未连接，打开控制面板查看最近日志。

### THEIA 显示离线

先启动 THEIA 桌面端并等待本机数据接口就绪，再在 QQ 中重试 `theia status`。Iris 只读取正在运行的 THEIA，不会代替 THEIA 登录或同步。

### 控制面板打不开

确认 Iris 正在运行，然后从 THEIA 设置中的 Iris 卡片点击“打开控制面板”。内置 Iris 默认使用 `38641`，并与外部 Iris 的 `38640` 分离；端口被占用时会自动选择其他本机端口。

### 想恢复默认帮助菜单

在控制面板的“指令”页恢复对应命令的推荐内容，并在“帮助菜单显示”页只保留 THEIA。隐藏 provider 只影响帮助菜单，不会删除已保存的接口配置。
