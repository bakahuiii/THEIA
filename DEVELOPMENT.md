# THEIA 开发入口

本文档只提供稳定的开发入口。当前版本以 `package.json` 为准；架构、接口和测试覆盖面以 `docs/` 与当前实现为准，不在这里复制易漂移的文件数量、用例数量、IPC 数量或构建体积。

## 环境与命令

- Windows；Node.js `>=22.12.0`；npm `>=10.0.0`。
- `npm run dev`：启动 Electron 桌面开发模式。
- `npm run dev:web`：仅预览前端；不具备真实凭据、校园会话、文件和主进程能力。
- `npm test`、`npm run lint`、`npm run typecheck`：快速质量检查；`npm run check` 会按顺序执行这三项。
- `npm run build`：生成校园网格并执行 TypeScript/Vite 构建。
- `npm run clean:generated`：删除可重建的构建输出、缓存和根目录临时探测产物，不触碰依赖、参考资料或本机数据。
- `npm run dist:unpacked`、`npm run dist:source`、`npm run dist:installer`、`npm run smoke:packaged`：Windows 打包、源码归档与产物烟雾测试；正式安装器流程会同时生成同版本源码包。

完整操作顺序见 [运行、测试与发布](docs/development/operations-and-testing.md)，扩展规范见 [开发者指南](docs/development/developer-guide.md)。开放协作阶段的提交、审查和交接规则见 [贡献与提交](CONTRIBUTING.md) 与 [开发者手册](docs/development/developer-handbook.md)。

## 运行时结构

```text
React renderer
  -> typed preload / IPC
  -> Electron main process
  -> core adapters and services
  -> CampusStore
  -> immutable fragments + data/manifest.json
  -> renderer snapshot / loopback API / exports
```

- `src/`：界面、renderer 状态和 typed bridge。
- `electron/`：主进程、preload、加密 vault、文件选择器、校园会话和模型调用。
- `core/`：可由 Node 测试的解析、同步、存储、导出和业务服务。
- `integration/`：通用本机只读 Feed 客户端和 schema。
- `tests/`：Node 测试套件；不要在文档中固定用例数量。

模块所有权与完整目录说明见 [系统架构](docs/development/architecture.md) 和 [数据所有权矩阵](docs/development/data-ownership-matrix.md)。

## 认证与数据通道

THEIA 有两条隔离的教务数据通道：

1. 统一身份认证浏览器通道：复用 Electron 的 `persist:theia` 校园 SSO 会话，用于课程平台和浏览器支持的校园页面。
2. 可选教务 API 通道：使用独立加密保存的教务账号密码和仅驻内存的 cookie jar。

API 未启用或未配置凭据时使用浏览器通道。API 已启用且配置凭据后优先使用 API；API 失败的来源域会尝试一次浏览器 SSO 回退，成功的 API 域继续保留。浏览器认证也失败时报告认证错误，不会静默吞掉失败或用空结果覆盖已有本地数据。两套 cookie 不得混用。

抢课读取与提交使用隔离的教务 API 会话，要求显式启用 API 并保存凭据。只对用户明确保存的目标执行请求；读取操作可在会话失效后重新登录，选课 POST 不得自动重放。

详见 [认证与同步](docs/ai/07-auth-and-sync.md)、[教务来源](docs/ai/08-academic-sources.md) 和 [抢课 API](docs/ai/15-course-selection-api.md)。

## 数据与凭据

- 当前主存储是数据根下的 `data/manifest.json` 与不可变分片。
- `buct-data.json` 和 `.bak` 仅是保留的旧版迁移/恢复来源，不是当前写入目标。
- `theia-feed.json` 是从快照生成的兼容读取视图，不是数据库。
- 默认数据根是 `%APPDATA%\THEIA`；开发隔离可设置 `THEIA_DATA_ROOT`。
- 统一认证、教务 API、邮箱和模型凭据分别由 Electron `safeStorage` / Windows DPAPI 保护。
- 密码、Cookie、授权码、API Key、浏览器 session 和可重放选课字段不得进入 `CampusState`、Feed、导出、loopback API 或普通日志。

持久化、迁移和导出细节见 [数据生命周期](docs/development/data-lifecycle.md) 与 [数据模型](docs/reference/data-model.md)。

## 改动要求

跨进程能力必须同时检查：

1. 核心 service/parser 与数据所有权；
2. Electron handler；
3. preload bridge；
4. `src/types.ts` 类型；
5. `src/bridge.ts` 的受限 Web fallback；
6. renderer 调用与错误状态；
7. 对应测试和文档。

不要将真实账号、Cookie、邮件、抓取响应、完整个人快照或任务附件写入仓库。学校网络和本机路径必须经过主进程白名单或受控选择器，不能新增通用 shell、任意 URL 或任意文件读取 IPC。

## 发布判断

### 发布包体约束

所有 Windows 发布包都遵循 `package.json` 中的构建配置：仅保留 `zh-CN` Electron 语言包，排除第三方 `.map` 调试映射；仅在 React/Vite 渲染层使用的 `react`、`react-dom`、`lucide-react`、`radix-ui`、`class-variance-authority`、`clsx` 与 `tailwind-merge` 必须保持在 `devDependencies`，不得重新进入桌面运行时依赖。新增主进程、preload 或 `core/` 运行时依赖时，再按实际引用将其列入 `dependencies`。

构建成功不等于发布完成。发布前至少完成测试、lint、build、安装器与源码包生成和打包版 smoke，并核对版本、图标、启动、preload、本机 API、旧数据读取以及两类产物未混入开发缓存或真实用户数据。源码包使用显式白名单并包含 `SOURCE-MANIFEST.json`；实际产物名称、大小和 SHA-256 应从本次构建结果读取，不沿用旧文档数字。
