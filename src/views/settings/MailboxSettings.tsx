import { AlertCircle, ExternalLink, Inbox, KeyRound, RefreshCw, Save, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { bridge } from "../../bridge";
import { SecretInput } from "../../components/SecretInput";
import type { CampusState, MailCredentialStatus } from "../../types";
import { Toggle } from "../../ui/app-shared";

export function MailboxSettings({ state, status, onStatus, onMessage }: {
  state: CampusState;
  status: MailCredentialStatus;
  onStatus: (status: MailCredentialStatus) => void;
  onMessage: (message: string) => void;
}) {
  const config = state.settings.mail;
  const [username, setUsername] = useState(status.username || "");
  const [password, setPassword] = useState("");
  const [protocolPassword, setProtocolPassword] = useState("");
  const [pollInterval, setPollInterval] = useState(String(config.pollIntervalMinutes));
  const [saving, setSaving] = useState(false);
  useEffect(() => setUsername(status.username || ""), [status.username]);
  useEffect(() => setPollInterval(String(config.pollIntervalMinutes)), [config.pollIntervalMinutes]);

  const saveConfig = async (enabled = config.enabled) => bridge.updateSettings({ mail: { enabled, pollIntervalMinutes: Number(pollInterval) } });
  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true);
    try {
      await saveConfig();
      onStatus(await bridge.saveMailCredentials({ username, password, protocolPassword }));
      setPassword(""); setProtocolPassword("");
      onMessage("已启用 IMAP 协议收信。邮件列表和正文将直接从客户端协议读取。");
    } catch (error) { onMessage(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  };
  const toggle = async (enabled: boolean) => {
    try { await saveConfig(enabled); onMessage(enabled ? "后台 IMAP 收信已启用。" : "后台收信已暂停。"); }
    catch (error) { onMessage(error instanceof Error ? error.message : String(error)); }
  };
  const refresh = async () => {
    setSaving(true);
    try { await bridge.refreshMailbox(); onMessage("已通过 IMAP 协议刷新收件箱。"); }
    catch (error) { onMessage(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
  };
  const openMailbox = async () => {
    try { await bridge.openMailbox(); onMessage("已打开网页邮箱。可在网页邮箱设置中启用客户端收信或生成客户端授权密码。"); }
    catch (error) { onMessage(error instanceof Error ? error.message : String(error)); }
  };

  return (
    <section className="settings-section mailbox-settings-section">
      <div className="settings-title">
        <div className="settings-icon blue"><Inbox size={20} /></div>
        <div><h2>校园邮箱</h2><p>通过 IMAP 直接收取收件箱。网页邮箱仅用于首次启用客户端协议或生成授权密码。</p></div>
      </div>
      <Toggle checked={config.enabled} onChange={(enabled) => void toggle(enabled)} label="后台收信" detail="按设定间隔同步收件箱；列表快速同步，正文只在打开邮件时读取。" />
      <form className="credential-form mailbox-credential-form" onSubmit={(event) => void save(event)}>
        <label><span>邮箱账号</span><input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="name@buct.edu.cn" disabled={saving} /></label>
        <SecretInput label={<span>邮箱密码</span>} visibilityLabel="邮箱密码" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={status.passwordSaved ? "••••••••" : "邮箱登录密码"} saved={status.passwordSaved} onRevealSaved={() => bridge.readSavedSecret("mail-password")} onRevealError={onMessage} disabled={saving} />
        <SecretInput label={<span><strong>客户端授权密码</strong><small>可选。若学校邮箱拒绝登录密码，请在网页邮箱设置中生成后填写；填入后优先使用。</small></span>} visibilityLabel="客户端授权密码" autoComplete="off" value={protocolPassword} onChange={(event) => setProtocolPassword(event.target.value)} placeholder={status.protocolPasswordSaved ? "••••••••" : "客户端授权密码"} saved={status.protocolPasswordSaved} onRevealSaved={() => bridge.readSavedSecret("mail-protocol-password")} onRevealError={onMessage} disabled={saving} />
        <label className="numeric-setting"><span><strong>检查间隔</strong><small>后台检查频率，最短 1 分钟。</small></span><input type="number" min="1" max="60" value={pollInterval} onChange={(event) => setPollInterval(event.target.value)} disabled={saving} /><em>分钟</em></label>
        {status.error && <p className="credential-error"><AlertCircle size={15} /> {status.error}</p>}
        <div className="credential-security"><ShieldCheck size={16} /><span>邮箱密码和客户端授权密码均由当前 Windows 账户加密保存，不会写入导出、本地 API 或诊断日志。</span></div>
        <div className="button-row">
          <button className="primary-button" type="submit" disabled={saving || !status.encryptionAvailable || !username.trim() || !(password || protocolPassword || status.saved)}><Save size={16} /> {saving ? "正在保存" : status.saved ? "更新邮箱凭据" : "保存邮箱凭据"}</button>
          <button className="secondary-button" type="button" onClick={() => void openMailbox()} disabled={saving}><ExternalLink size={16} /> 打开网页邮箱</button>
          {status.saved && <button className="secondary-button" type="button" onClick={() => void refresh()} disabled={saving}><RefreshCw size={16} /> 立即收信</button>}
          {status.protocolPasswordSaved && <span className="credential-security"><KeyRound size={15} /> 已保存客户端授权密码</span>}
          {status.saved && <button className="danger-button" type="button" onClick={() => void bridge.clearMailCredentials().then(onStatus)} disabled={saving}><Trash2 size={16} /> 删除邮箱凭据</button>}
        </div>
      </form>
    </section>
  );
}
