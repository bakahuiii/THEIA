import { KeyRound, PanelTop, Play, RefreshCw, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { bridge } from "../../bridge";
import type { IrisCompanionStatus } from "../../types";

export function IrisCompanionSettings({ onMessage }: { onMessage: (message: string) => void }) {
  const [status, setStatus] = useState<IrisCompanionStatus | null>(null);
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [ownerOpenid, setOwnerOpenid] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      setStatus(await bridge.getIrisStatus());
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "无法读取 Iris 状态");
    }
  };

  useEffect(() => {
    void bridge.getIrisStatus().then(setStatus).catch((error) => {
      onMessage(error instanceof Error ? error.message : "无法读取 Iris 状态");
    });
  }, [onMessage]);

  const run = async (action: () => Promise<IrisCompanionStatus>, message: string) => {
    setBusy(true);
    try {
      setStatus(await action());
      onMessage(message);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Iris 操作未完成");
    } finally {
      setBusy(false);
    }
  };

  const saveCredentials = async () => {
    setBusy(true);
    try {
      await bridge.saveIrisCredentials({ appId, appSecret, ownerOpenid });
      setAppSecret("");
      onMessage("QQ Bot 凭据已安全保存");
      await refresh();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "QQ Bot 凭据保存失败");
    } finally {
      setBusy(false);
    }
  };

  const openControlPanel = async () => {
    setBusy(true);
    try {
      await bridge.openIrisControlPanel();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Iris 控制面板未就绪");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section">
      <div className="settings-title">
        <div className="settings-icon teal"><KeyRound size={20} /></div>
        <div>
          <h2>Iris companion</h2>
          <p>内置 QQ 校园助手。默认只显示 THEIA 只读能力，其他 provider 可在 Iris 控制面板中显示或关闭。</p>
        </div>
        <button className="icon-button" data-tooltip="刷新 Iris 状态" aria-label="刷新 Iris 状态" onClick={() => void refresh()} disabled={busy}>
          <RefreshCw size={16} className={busy ? "spinning" : ""} />
        </button>
      </div>
      <div className="settings-inline-status">
        <span>{status?.running ? "运行中" : "未运行"}</span>
        <span>{status?.configured ? "凭据已配置" : "尚未配置 QQ 凭据"}</span>
        <span>可见：{(status?.visibleProviders || ["theia"]).map((provider) => provider === "theia" ? "THEIA" : provider).join("、")}</span>
        {status?.controlUrl ? <span>控制面板：{status.controlUrl}</span> : null}
      </div>
      <div className="settings-actions">
        <button className="secondary-button" onClick={() => void openControlPanel()} disabled={busy || !status?.running}>
          <PanelTop size={16} />打开控制面板
        </button>
      </div>
      <div className="settings-form-grid">
        <label>QQ App ID<input value={appId} onChange={(event) => setAppId(event.target.value)} placeholder="QQ Bot App ID" autoComplete="off" /></label>
        <label>QQ AppSecret<input type="password" value={appSecret} onChange={(event) => setAppSecret(event.target.value)} placeholder="只在提交时发送" autoComplete="new-password" /></label>
        <label>Owner OpenID（可选）<input value={ownerOpenid} onChange={(event) => setOwnerOpenid(event.target.value)} placeholder="留空则绑定首个私聊用户" autoComplete="off" /></label>
      </div>
      <div className="settings-actions">
        <button className="secondary-button" onClick={() => void saveCredentials()} disabled={busy || !appId.trim() || !appSecret}>
          <KeyRound size={16} />保存凭据
        </button>
        {status?.running ? (
          <button className="secondary-button" onClick={() => void run(() => bridge.stopIris(), "Iris 已停止")} disabled={busy}><Square size={16} />停止</button>
        ) : (
          <button className="secondary-button" onClick={() => void run(() => bridge.startIris(), "Iris 已启动")} disabled={busy || !status?.configured}><Play size={16} />启动</button>
        )}
        <button className="secondary-button" onClick={() => void run(() => bridge.restartIris(), "Iris 已重启")} disabled={busy || !status?.configured}><RefreshCw size={16} />重启</button>
      </div>
      {status?.lastError ? <p className="settings-help-text">{status.lastError}</p> : null}
    </section>
  );
}
