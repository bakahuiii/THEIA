# 贡献与提交

感谢维护 THEIA。本文只约定源码仓库的工作区卫生、检查顺序和改动边界；功能行为以当前源码、测试和 `docs/` 为准。

## 开始前

- 使用 Windows、Node.js `>=22.12.0` 和 npm `>=10.0.0`。
- 在独立的数据目录运行桌面模式，例如设置 `THEIA_DATA_ROOT`，不要让调试数据进入真实 `%APPDATA%\THEIA`。
- 使用 `npm install` 安装锁定的依赖。不要提交 `node_modules/`、构建输出、抓取结果、完整个人快照或任何凭据。

## 提交前检查

日常改动运行：

```powershell
npm run check
```

需要确认前端产物时再运行：

```powershell
npm run build
```

构建、测试或现场探测后，可以清除可重建输出：

```powershell
npm run clean:generated
```

这个命令只处理 `dist/`、`release-bin/`、TypeScript 增量缓存、覆盖率/测试输出和根目录 `.tmp-*` 临时项；它不会删除 `node_modules/`、`.references/`、`local-docs/` 或本机数据目录。

## 改动边界

- 保持现有模块所有权：`src/` 负责 renderer，`electron/` 负责桌面特权边界，`core/` 负责可测试业务核心，`integration/` 保持只读接入。
- 跨进程改动同时检查类型、preload、handler、fallback、renderer、测试和对应文档。
- 不把账号、密码、Cookie、API Key、邮件正文、认证页面或真实校园响应写入源码、fixture、日志和提交。
- 选课、作业提交和其他学校侧不可逆操作仍必须保留用户确认边界。
- 变更保持聚焦，避免把无关格式化、生成物或个人环境文件混入同一提交。

提交前检查 `git status` 和 `git diff --check`，确认只包含本次改动。

## 开放协作约定

从下一个版本开始，THEIA 将由更多有提交权限的开发者共同维护。任何人都可以 Fork 项目并提交 Pull Request；只有被邀请的 GitHub 协作者或团队成员才能直接 push、commit 或发布 Release。提交权限意味着可以推进工作，不意味着可以跳过测试、审查、隐私检查或用户确认边界。每个提交作者都应说明改了什么、验证了什么，以及哪些真实桌面、校园来源、模型服务或设备验证没有做。

默认建议使用独立分支和 Pull Request，保持 `main` 可构建、可解释、可回滚。即使仓库允许直接 push，也应把它限制为紧急修复、文档小修或发布流程要求的明确场景；半成品、真实数据和未验证的学校侧自动化不得直接进入 `main`。

分支名可按意图命名：`feature/<name>`、`fix/<name>`、`docs/<name>`、`refactor/<name>`、`security/<name>` 或 `release/<version>`。提交信息使用清晰的动作前缀，例如 `feat:`、`fix:`、`docs:`、`test:`、`refactor:` 和 `security:`。一个功能跨越 `core`、`electron`、`src`、`tests` 和 `docs` 仍可以是一个完整提交，不要为了文件数量拆成互相失效的半提交。

涉及数据、凭据、认证、Electron IPC、本机 API、Agent、邮箱、导出、选课、作业或其它学校侧操作的改动，合并前必须检查 [开发者手册](docs/development/developer-handbook.md) 中对应章节，并在 PR 中写出失败语义和安全边界。出现高风险问题时，先阻止合并并给出可复现的影响说明，不以“之后再补测试”作为默认处理方式。

THEIA 不再依赖单一作者的口头知识。关键判断应进入代码、测试、文档或 PR：代码保留校验和边界，测试保留回归和禁止项，文档保留当前契约，PR 保留本次决策和未验证范围。无人明确负责的模块，先阅读它的测试、数据所有权和最近变更，再做最小范围修改。

完整的目录地图、跨进程改动路径、数据恢复、顾问 Agent、发布和交接清单见 [THEIA 开发者手册](docs/development/developer-handbook.md)。
