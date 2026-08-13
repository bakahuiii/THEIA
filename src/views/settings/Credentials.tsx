import { AlertCircle, KeyRound, Save, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { bridge } from "../../bridge";
import { SecretInput } from "../../components/SecretInput";
import type { CredentialStatus } from "../../types";

type CredentialFormProps = {
  status: CredentialStatus;
  onStatus: (status: CredentialStatus) => void;
  onSaved?: () => void;
  onMessage: (message: string) => void;
  className?: string;
};

export function CredentialForm({ status, onStatus, onSaved, onMessage, className }: CredentialFormProps) {
  const [username, setUsername] = useState(status.username || "");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => setUsername(status.username || ""), [status.username]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const next = await bridge.saveCredentials({ username, password });
      onStatus(next);
      setPassword("");
      onSaved?.();
      onMessage("凭据已由当前 Windows 账户加密保存，正在连接学校统一身份认证。");
      await bridge.login();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={["credential-form", className].filter(Boolean).join(" ")} onSubmit={(event) => void submit(event)}>
      <label>
        <span>账号</span>
        <input name="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="统一身份认证账号" disabled={saving} />
      </label>
      <SecretInput
        label={<span>密码</span>}
        visibilityLabel="统一身份认证密码"
        name="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder={status.saved ? "••••••••" : "统一身份认证密码"}
        saved={status.saved}
        onRevealSaved={() => bridge.readSavedSecret("unified-password")}
        onRevealError={onMessage}
        disabled={saving}
      />
      {status.error && <p className="credential-error"><AlertCircle size={15} /> {status.error}</p>}
      <div className="credential-security"><ShieldCheck size={16} /><span>凭据由当前 Windows 账户加密保存，不会进入导出、本地 API 或日志。</span></div>
      <button className="primary-button" type="submit" disabled={saving || !status.encryptionAvailable || !username.trim() || !password}>
        <Save size={16} /> {saving ? "正在保存" : status.saved ? "更新并登录" : "保存并登录"}
      </button>
    </form>
  );
}

export function CredentialSetupModal({ status, onStatus, onClose, onMessage }: CredentialFormProps & { onClose: () => void }) {
  const modalRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = modalRef.current;
    if (!element) return;
    element.querySelector<HTMLElement>("button:not([disabled]), input:not([disabled])")?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const all = Array.from(element.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])"));
      if (!all.length) return;
      const [first, last] = [all[0], all[all.length - 1]];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="credential-modal" role="dialog" aria-modal="true" aria-labelledby="credential-title" ref={modalRef}>
        <header>
          <div className="settings-icon"><KeyRound size={21} /></div>
          <div><h2 id="credential-title">统一身份认证</h2><p>用于连接北化在线THEOL和支持统一认证的校园页面。</p></div>
          <button className="icon-button" data-tooltip="稍后设置" aria-label="稍后设置" onClick={onClose}><X size={18} /></button>
        </header>
        <CredentialForm status={status} onStatus={onStatus} onSaved={onClose} onMessage={onMessage} />
        <button className="modal-later" onClick={onClose}>稍后设置</button>
      </section>
    </div>
  );
}
