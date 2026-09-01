# 设置与接入

## 页面目标

设置与接入页负责管理 THEIA 的本机偏好、同步、数据、接口、模型服务和版本信息。

## 外观

- 主题模式，支持跟随系统、浅色和深色。
- 一体化外观预设。
- 背景图片和渐变映射。
- 3D 墨景参数。
- 动效和外观细节调节。

## 同步

- 设置自动同步间隔。
- 立即全量同步。
- 单个数据域失败后可单独重试。
- 查看同步日志和最近结果。

## 数据

- 统一身份认证。
- 教务系统 API 凭据。
- 校园邮箱凭据。
- 活动日志。
- 导出给 AI、完整 JSON、THEIA Data Feed、ICS 和成绩 CSV。
- 打开本地数据目录。

## 接口

- 本地 API，绑定 127.0.0.1；数据端点只读，顾问对话端点仅调用本地顾问。
- MCP 接口桥接。
- Iris QQ 伴侣。
- 接口地址可以复制出来给本机工具使用。

## 模型服务

- 支持 OpenAI 兼容、Anthropic、Gemini 和 Ollama。
- 可以配置 base URL、API Key、模型名和路由。
- 支持模型发现和自动推荐。
- 只在你明确检测或发送时发起连接。

## 关于

- 显示当前版本、数据 schema 和本机数据接口。
- GitHub 自动更新只对正式 Windows 安装包生效。
- 发现新版本后可以下载并重启安装。
- 提供 THEIA-Android 项目介绍和 GitHub 仓库入口。

## 边界

- 凭据只保存在本机。
- 这里展示的接口和导出都是只读或本地导出，不是学校侧写入入口。
- 自动更新要看安装包类型，不是所有运行方式都支持。

## 相关文件

- src/views/SettingsView.tsx
- src/views/settings/AppearanceSettings.tsx
- src/views/settings/SyncSettings.tsx
- src/views/settings/DataSettings.tsx
- src/views/settings/AdvancedModelSettings.tsx
- src/views/settings/IrisCompanionSettings.tsx
- src/views/settings/McpIntegrationSettings.tsx
- src/views/settings/AboutSettings.tsx
- electron/github-update-runtime.mjs
- electron/local-api-handlers.mjs
- electron/iris-ipc.mjs
- src/bridge.ts

## 细节

### 外观区

- 主题模式支持跟随系统、浅色和深色。
- 一体化外观会处理预设、背景图、渐变映射和 3D 墨景参数。
- 3D 参数改动后会立即作用到当前外观，不需要等重启。

### 同步区

- 自动同步间隔可调。
- 立即全量同步会把主同步任务跑一遍。
- 教务、THEOL 和独立数据会分组显示，便于知道卡在哪里。
- 单个域失败后可以单独重试，不需要再把全量同步跑一遍。

### 数据区

- 统一身份认证、教务系统 API 和校园邮箱是分开的连接面。
- 活动日志原样显示本机 auth-diagnostics.ndjson，但已经去掉账号、密码、Cookie 和 API Key。
- 导出支持 AI、完整 JSON、THEIA Data Feed、ICS 和成绩 CSV。
- 打开本地数据目录方便人工检查缓存和导出结果。

### 接口区

- 本地 API 只绑定 127.0.0.1；数据端点只读，顾问对话端点仅调用本地顾问。
- MCP 一键添加的是本机只读 THEIA MCP。
- Iris 里默认只显示 THEIA 只读能力，其他 provider 由控制面板决定可见性。

### 模型服务区

- 支持 OpenAI 兼容、Anthropic、Gemini 和 Ollama。
- 可以配置 base URL、API Key、模型名和路由。
- 支持模型发现和自动推荐。
- 顾问预算档位是 High、XHigh、Max 和 Ultra，分别控制探索深度和输出上限。
- 温度滑块单独控制创造性。

### 关于区和自动更新

- 关于页显示当前版本、schema 和本机数据接口。
- GitHub 自动更新只对正式 Windows 安装包生效。
- 能安装时按钮会切成“重启并安装更新”，检查中则显示进度状态。
- 这部分不会替你改学校侧数据，只处理本机安装包。
- 关于页展示独立的 THEIA-Android 客户端：支持 Android 10+，提供只读校园数据视图，并通过外部链接打开其 GitHub 仓库。

## 代码级细节

- SettingsView 本身只负责分区切换、保存状态和桥接入口；真正的页面内容分别交给 AppearanceSettings、SyncSettings、DataSettings、AdvancedModelSettings、McpIntegrationSettings、IrisCompanionSettings 和 AboutSettings。
- update 会调用 bridge.updateSettings；exportFile 会调用 bridge.exportData；retryDomain 会调用 bridge.retrySyncDomain。
- DataSettings 里活动日志会先走 activityLogTone 再统一渲染，导出部分则通过 onExport 把格式和 collection 交给上层。
- AppearanceSettings 里的 applyPreset、applyVisualPreset、setAppBackground、setGradientMap、updateSceneTuning 和 resetSceneTuning 分别对应主题、背景、渐变和 3D 墨景。
- AdvancedModelSettings 里的状态包括 provider、baseUrl、apiKey、modelRouting、models、advisorConfig 和 discoveryError；模型发现走 bridge.discoverModels，保存时把这些字段一起提交。
- AboutSettings 通过 bridge.getUpdateStatus、bridge.checkForUpdates 和 bridge.installUpdate 管理 GitHub 自动更新，只有进入 downloaded 状态时才允许安装。
- McpIntegrationSettings 用 bridge.installMcpClients 一键添加本机只读 MCP；IrisCompanionSettings 则通过 bridge.getIrisStatus、bridge.saveIrisCredentials、bridge.startIris、bridge.stopIris、bridge.restartIris 和 bridge.openIrisControlPanel 管理 QQ 伴侣。
