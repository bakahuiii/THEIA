# 项目规则

## 技术栈

- 渲染进程：React 19、TypeScript、Vite 和 shadcn/Radix。
- 桌面运行时：启用 `contextIsolation` 的 Electron。
- 业务逻辑：`core/` 中的 ESM 模块，由 `node --test` 直接覆盖。
- 数据根目录：`%APPDATA%/THEIA`，仅使用 `THEIA_DATA_ROOT` 覆盖。

## 修改规则

1. 改变行为前，先查找对应适配器、Schema、存储、Bridge、界面和测试。
2. 跨进程功能必须同时更新 IPC 处理器、Preload 桥接、TypeScript 桥接类型、网页预览回退和界面。
3. 数据必须先在核心层规范化，再持久化。页面不得解析来源 HTML，也不得持有凭据。
4. 修改解析器、凭据、持久化、数据导出、选课或提交行为时，必须补充测试。
5. 狭窄功能改动不得大范围重做 `src/styles.css`。

## 持久化与隐私

- 主持久化存储是 `data/manifest.json`，由不可变且带校验的分片支撑。修改前先读[《运行时数据流》](01-runtime-data-flow.md)和[《存储 Schema》](06-storage-schema.md)。
- `buct-data.json` 和 `buct-data.json.bak` 只是旧版迁移快照，不是当前写入目标。
- 浏览器 Cookie 保留在 `session/`，绝不能进入状态、分片、Feed、日志或文档。
- 凭据保险库使用 Electron 安全存储。不得把明文密码或 API 密钥写入数据文件。
- `auth-diagnostics.ndjson` 只记录安全元数据，绝不能记录 Cookie、密码、邮件正文、附件内容或模型密钥。

## 验证

```powershell
npm test
npm run build
npm run lint
npm run cli -- status --json
```

除非用户明确要求，否则不要打包。迁移期间必须保留用户数据和旧版快照。
