# IPC 与 Bridge 契约

## 链路

```text
view/hook -> src/bridge.ts -> electron/preload.cjs
          -> electron/main.mjs ipcMain.handle -> core/electron service
```

`src/types.ts` 的 `TheiaBridge` 是唯一类型契约。`bridge.ts` 在非 Electron 预览中提供安全 fallback：读操作可返回 demo/空状态，写入或敏感动作必须报“仅桌面客户端可用”。

## 新 IPC 的必做步骤

1. 在 `TheiaBridge` 添加参数和返回类型。
2. 在 `electron/preload.cjs` 暴露严格参数的 `ipcRenderer.invoke` 包装。
3. 在 `electron/main.mjs` 加 handler，并规范化所有 renderer 输入。
4. 在 `src/bridge.ts` 加同签名 fallback。
5. 在 hook/view 接入；主进程数据变化后调用 `sendSnapshot()`。

## 现有 handler 族

- 状态/认证：snapshot、activity log、credential status、login/logout、sync。
- 学业/体测：API credentials、fitness、schedule PDF。
- 邮箱：凭据、刷新、打开、读邮件、下载附件。
- 作业/模型：workspace、答案导入、提交窗口、模型发现/验证/生成/PDF。
- 抢课：discover、candidates、start、stop、snapshot。
- 窗口/外观：窗口控制、缩放、背景文件、settings。
- 数据：本地 API 状态、导出。
- Advisor：`theia:advisor:get-overview`、`academic-what-if`、`course-decisions` 和 `execute-action` 承载 P0-P3 本地确定性能力；`list-threads`、`create-thread`、`prepare`、`send`、`cancel` 和 `delete-thread` 承载 P4 模型请求生命周期。模型 IPC 不复用本地动作 IPC，也不获得任意执行负载。

主进程是所有特权动作唯一位置。URL 经过 `permittedSourceUrl()`；附件与路径用受控 picker 或既有 workspace 记录；不暴露通用 shell、filesystem、session 或 arbitrary URL IPC。

## Advisor 边界

- renderer 不自行拼接 `CampusState`、revision 或当前时间来重算 overview。
- overview 及其 `dataQuality` 的 `snapshotRevision`、`evaluatedAt`、`timeZone`、`rulesVersion` 必须完全一致。
- renderer 收到新四元实例键时整体替换旧 overview；稳定 claim ID 只表示同一规则下的 claim 身份，不允许据此跨实例合并 `value`、`displayText`、`confidence` 或 `caveats`。
- What-if 和 course decisions 各自从一次冻结快照计算；renderer 不能把数据质量从 unknown/partial 升级为 complete，也不能接收并复用过期 revision 的响应。
- `advisor:execute-action` 的 renderer 参数不得增加原始 assignment ID、URL 或任意 payload；原始 THEOL assignment ID 只能在主进程从当前冻结快照私下唯一反解。
- Agent 请求由独立 `AdvisorRuntime` 的单次 send 协议处理：renderer 直接提交 `threadId` 与 `question`，主进程在同一请求内部生成 request ID、冻结快照并建立惰性工作区。renderer 不能提交意图、数据域、邮件选择、授权或关闭流式的字段；已有 request ID 仅用于内部生命周期。
- Provider 支持流式时，每次模型调用都会逐 delta 转发。模型仅能调用固定只读工具，且没有任意 URL、filesystem、session、学校请求代理或执行权；`suggestedActionIds` 不是执行授权。

完整合同见 [16-advisor-p0-foundation.md](16-advisor-p0-foundation.md)、[17-advisor-p1-p3-local-workbench.md](17-advisor-p1-p3-local-workbench.md) 和 [20-a-b-c-advisor-agent-sidecar.md](20-a-b-c-advisor-agent-sidecar.md)。
