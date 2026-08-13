# 设置、主题与个性化

## 设置结构

`SettingsView.tsx` 是总弹窗。内容拆在 `src/views/settings/`：

- `Credentials.tsx`：统一认证凭据。
- `AcademicDataSourceSettings.tsx`：教务 API 账号、密码和启用开关。
- `MailboxSettings.tsx`：邮箱账号、密码/客户端授权码与轮询。
- `AdvancedModelSettings.tsx`：OpenAI 兼容服务地址、key、模型发现与验证。
- `AppearanceSettings.tsx`：模式、预设、背景、双色映射、动效、保存预设。
- `AboutSettings.tsx`：图标、版本、应用信息。

凭据输入必须显示黑点；设置页面不可读取或回显实际密码。

## 外观状态

- `useAppearance.ts` 管理 `light` / `dark` / `system`，存储 key 为 `theia-appearance-v1`。
- `usePersonalization.ts` 管理背景、opacity、blur、motion、渐变映射和自定义预设，存储 key 为 `theia-personalization-v1`。
- `lib/appearance-presets.ts` 定义内置预设；`lib/gradient-map.ts` 负责从两端色推导可读 UI token。
- `GradientMapFilter.tsx` 是背景双色映射层，不直接把用户原色强塞到全部 UI token。

## 新预设规则

预设必须同时定义背景映射和界面 token，且浅/深模式都可读。用户修改后可以保存为新预设，不能覆盖内置预设。不要在名称或 UI 文案引用外部产品品牌。

背景文件通过主进程 `theia-background://local/<filename>` 协议提供。renderer 不得获得任意文件路径，背景图不进入状态 JSON。

