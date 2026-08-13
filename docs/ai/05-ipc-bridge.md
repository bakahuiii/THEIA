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
- Advisor：`theia:advisor:get-overview` 仅返回主进程从一次原子快照和一次时钟采样生成的确定性 overview；它不调用模型，也不触发同步。

主进程是所有特权动作唯一位置。URL 经过 `permittedSourceUrl()`；附件与路径用受控 picker 或既有 workspace 记录；不暴露通用 shell、filesystem、session 或 arbitrary URL IPC。

## Advisor overview 边界

- renderer 不自行拼接 `CampusState`、revision 或当前时间来重算 overview。
- overview 及其 `dataQuality` 的 `snapshotRevision`、`evaluatedAt`、`timeZone`、`rulesVersion` 必须完全一致。
- renderer 收到新四元实例键时整体替换旧 overview；稳定 claim ID 只表示同一规则下的 claim 身份，不允许据此跨实例合并 `value`、`displayText`、`confidence` 或 `caveats`。
- 当前 handler 是只读 P0 能力。未来的模型请求、流式事件、取消和授权需要独立的 `AdvisorRuntime` 协议，不能复用现有 overview handler 暗中发起网络调用。
