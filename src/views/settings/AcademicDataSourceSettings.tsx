import { AlertCircle, KeyRound, Save, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { bridge } from "../../bridge";
import { SecretInput } from "../../components/SecretInput";
import type { AcademicApiCredentialStatus, CampusState } from "../../types";

export function AcademicDataSourceSettings({ state, status, onStatus, onMessage }: {
  state: CampusState;
  status: AcademicApiCredentialStatus;
  onStatus: (status: AcademicApiCredentialStatus) => void;
  onMessage: (message: string) => void;
}) {
  const [username, setUsername] = useState(status.username || "");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const apiEnabled = state.settings.academicApiEnabled;

  useEffect(() => setUsername(status.username || ""), [status.username]);

  const setApiEnabled = async (enabled: boolean) => {
    try {
      await bridge.updateSettings({ academicApiEnabled: enabled });
      onMessage(enabled ? "教务 API 已启用：同步会优先使用 API；本次 API 失败时会保留已有本地数据并报告错误。" : "教务 API 已停用：同步将使用统一身份认证页面；选课读取仍会使用已认证的教务浏览器会话。");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      onStatus(await bridge.saveAcademicApiCredentials({ username, password }));
      setPassword("");
      onMessage("教务系统 API 凭据已由当前 Windows 账户加密保存。");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    try {
      onStatus(await bridge.clearAcademicApiCredentials());
      setUsername("");
      onMessage("已删除保存的教务系统 API 凭据。");
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="data-connection-card academic-source-section">
      <div className="data-connection-card-header">
        <div className="settings-icon amber"><KeyRound size={20} /></div>
        <div><h2>教务系统 API</h2><p>使用独立教务凭据优先同步。未启用或未配置凭据时，同步使用统一身份认证页面；选课读取始终使用已认证的教务浏览器会话。</p></div>
      </div>
      <form className="credential-form data-connection-form" onSubmit={(event) => void save(event)}>
        <div className="data-connection-status"><ShieldCheck size={15} /> {apiEnabled ? "教务 API 已启用" : "教务同步使用统一身份认证页面"}</div>
        <label className="setting-row data-api-toggle">
          <span><strong>启用教务 API</strong><small>同步时优先使用 API；本轮 API 失败会保留旧数据并报告错误，不会静默切换通道。选课读取不依赖此项。</small></span>
          <input type="checkbox" checked={apiEnabled} onChange={(event) => void setApiEnabled(event.target.checked)} />
          <i aria-hidden="true" />
        </label>
        <label>
          <span>账号</span>
          <input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder={status.saved ? status.username || "已保存账号" : "教务系统学号"} disabled={saving} />
        </label>
        <SecretInput
          label={<span>密码</span>}
          visibilityLabel="教务系统密码"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={status.saved ? "••••••••" : "教务系统密码"}
          saved={status.saved}
          onRevealSaved={() => bridge.readSavedSecret("academic-api-password")}
          onRevealError={onMessage}
          disabled={saving}
        />
        {status.error && <p className="credential-error"><AlertCircle size={15} /> {status.error}</p>}
        <div className="credential-security"><ShieldCheck size={16} /><span>此账号独立于统一身份认证，使用当前 Windows 账户加密保存，不会进入导出、本地 API 或日志。</span></div>
        <div className="button-row">
          <button className="primary-button" type="submit" disabled={saving || !status.encryptionAvailable || !username.trim() || !password}><Save size={16} /> {saving ? "正在保存" : status.saved ? "更新 API 凭据" : "保存 API 凭据"}</button>
          {status.saved && <button className="danger-button" type="button" onClick={() => void clear()}><Trash2 size={16} /> 删除凭据</button>}
        </div>
      </form>
    </section>
  );
}
