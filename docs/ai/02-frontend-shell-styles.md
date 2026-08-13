# 前端外壳与样式

## 装配点

- `src/App.tsx`：全部页面、设置抽屉、凭据初始化弹窗的唯一装配点。
- `src/layout/TitleBar.tsx`：自定义标题栏与窗口按钮。
- `src/layout/AppSidebar.tsx`：导航、折叠侧栏和同步摘要。
- `src/layout/WorkspaceChrome.tsx`：顶部栏、搜索、消息条、命令面板和页面滚动容器。
- `src/styles.css`：全局 token、组件样式、页面覆盖；当前是历史累积文件。

## 样式规则

1. 优先用 `--background`、`--foreground`、`--card`、`--secondary`、`--border`、`--primary`、`--muted-foreground` 等语义 token。
2. 可见面板允许背景透出：用 `color-mix(..., transparent)`，但文字、边框、操作控件必须保持对比度。
3. 延续现有圆角与节奏：普通工具面板约 8-14px；不要把页面区块再套装饰卡片。
4. 按钮优先 Lucide 图标；icon-only 操作要有 `title` 或 tooltip。
5. 课表、地图工具、固定网格要有稳定尺寸，hover 不得推动布局。

## CSS 现实情况

`styles.css` 有多轮历史覆盖。新增局部样式应在相关末尾段落添加并使用页面前缀；修改前用 `rg` 查找同一选择器的后续覆盖。不要假设文件开头 token 是最终生效值。

主题由 `useAppearance` 的 `.dark` 和 `usePersonalization` 的 CSS custom properties 共同控制。写浅/深色专用色前先检查两种模式，文字绝不能融入背景。

## 新页面清单

1. 在 `src/ui/app-shared.tsx` 的 `ViewId` 增加 id。
2. 在 `src/ui/navigation.ts` 增加导航、分组与标题。
3. 建 `src/views/<Name>View.tsx`，数据通过 props 传入。
4. 在 `App.tsx` 装配 view。
5. 在 `styles.css` 添加带页面前缀样式，并验证桌面与窄窗口。

