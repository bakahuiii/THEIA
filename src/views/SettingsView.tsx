import { BrainCircuit, CircleHelp, Database, Palette, RefreshCw, Server, X } from "lucide-react";
import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";
import type {
  AcademicApiCredentialStatus,
  ActivityLogEntry,
  AuthStatus,
  CampusState,
  CredentialStatus,
  MailCredentialStatus,
  ModelStatus,
} from "../types";
import { AboutSettings } from "./settings/AboutSettings";
import { AdvancedModelSettings } from "./settings/AdvancedModelSettings";
import { AppearanceSettings } from "./settings/AppearanceSettings";
import { DataSettings, type DataExportFormat } from "./settings/DataSettings";
import { IrisCompanionSettings } from "./settings/IrisCompanionSettings";
import { McpIntegrationSettings } from "./settings/McpIntegrationSettings";
import { SyncSettings } from "./settings/SyncSettings";
import { SYNC_ERROR_LABELS, syncRecord, type SyncDataDefinition } from "./settings/SyncSettingsModel";

export type SettingsSection = "appearance" | "sync" | "data" | "interfaces" | "model" | "about";

const SETTINGS_NAV = [
  { id: "appearance", label: "外观", icon: Palette },
  { id: "sync", label: "同步", icon: RefreshCw },
  { id: "data", label: "数据", icon: Database },
  { id: "interfaces", label: "接口", icon: Server },
  { id: "model", label: "模型服务", icon: BrainCircuit },
] as const;

type SettingsViewProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSection?: SettingsSection;
  state: CampusState;
  apiBase: string;
  auth: AuthStatus;
  credentials: CredentialStatus;
  academicApiCredentials: AcademicApiCredentialStatus;
  mailCredentials: MailCredentialStatus;
  modelStatus: ModelStatus;
  syncing: boolean;
  syncProgress: string | null;
  onSync: () => void;
  activityLog: ActivityLogEntry[];
  activityLoading: boolean;
  onRefreshActivity: () => void;
  onAuthChange: (status: AuthStatus) => void;
  onCredentialChange: (status: CredentialStatus) => void;
  onAcademicApiCredentialChange: (status: AcademicApiCredentialStatus) => void;
  onMailCredentialChange: (status: MailCredentialStatus) => void;
  onModelStatus: (status: ModelStatus) => void;
  onMessage: (message: string) => void;
};

export function SettingsView({
  open,
  onOpenChange,
  initialSection = "appearance",
  state,
  apiBase,
  credentials,
  academicApiCredentials,
  mailCredentials,
  modelStatus,
  syncing,
  syncProgress,
  onSync,
  activityLog,
  activityLoading,
  onRefreshActivity,
  onCredentialChange,
  onAcademicApiCredentialChange,
  onMailCredentialChange,
  onModelStatus,
  onMessage,
}: SettingsViewProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>("appearance");
  const [saving, setSaving] = useState(false);
  const [retryingDomain, setRetryingDomain] = useState<SyncDataDefinition["id"] | null>(null);
  const origin = apiBase || "桌面客户端启动后可用";

  useEffect(() => {
    if (open) setActiveSection(initialSection);
  }, [initialSection, open]);

  const update = async (settings: Partial<CampusState["settings"]>) => {
    setSaving(true);
    try {
      await bridge.updateSettings(settings);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "设置保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  const exportFile = async (format: DataExportFormat, collection?: string) => {
    try {
      const result = await bridge.exportData(format, collection);
      if (result.canceled) return;
      if (format === "ai") {
        onMessage(`AI 数据包已导出至 ${result.filePath || "所选目录"}（${result.files || 0} 个已校验文件）。`);
        return;
      }
      onMessage(`数据已导出至 ${result.filePath || "所选位置"}。`);
    } catch (error) {
      onMessage(error instanceof Error ? `导出失败：${error.message}` : "导出失败。");
    }
  };

  const retryDomain = async (definition: SyncDataDefinition) => {
    if (syncing || retryingDomain) return;
    setRetryingDomain(definition.id);
    try {
      const snapshot = await bridge.retrySyncDomain(definition.id);
      const record = syncRecord(snapshot, definition);
      if (record?.status === "failed" || record?.status === "auth-required") {
        const reason = record.errorCode ? SYNC_ERROR_LABELS[record.errorCode] || record.errorCode : "请求失败";
        throw new Error(reason);
      }
      const partial = record && (
        record.completeness !== "complete" ||
        record.retainedPrevious ||
        Boolean(record.errorCode)
      );
      onMessage(partial ? `${definition.label}部分获取成功，详情已更新。` : `${definition.label}已重新获取。`);
    } catch (error) {
      onMessage(error instanceof Error ? `${definition.label}获取失败：${error.message}` : `${definition.label}获取失败。`);
    } finally {
      setRetryingDomain(null);
    }
  };

  const sectionTitle = activeSection === "appearance"
    ? "外观"
    : activeSection === "sync"
      ? "同步"
      : activeSection === "data"
        ? "数据"
        : activeSection === "interfaces"
          ? "接口"
          : activeSection === "model"
            ? "模型服务"
            : "关于 THEIA";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="settings-dialog" showCloseButton={false}>
        <aside className="settings-modal-nav" aria-label="设置分类">
          <div className="settings-modal-brand"><span>Θεία</span><strong>THEIA</strong><small>Preferences</small></div>
          <nav>
            {SETTINGS_NAV.map(({ id, label, icon: Icon }) => (
              <button type="button" key={id} className={activeSection === id ? "active" : ""} onClick={() => setActiveSection(id)} aria-current={activeSection === id ? "page" : undefined}>
                <Icon size={17} /><span>{label}</span>
              </button>
            ))}
          </nav>
          <div className="settings-nav-bottom">
            <button type="button" className={activeSection === "about" ? "active" : ""} onClick={() => setActiveSection("about")} aria-current={activeSection === "about" ? "page" : undefined}>
              <CircleHelp size={17} /><span>关于</span>
            </button>
          </div>
        </aside>

        <div className="settings-dialog-main">
          <header className="settings-dialog-header">
            <div><DialogTitle>{sectionTitle}</DialogTitle><DialogDescription>THEIA 的本机偏好与校园数据连接。</DialogDescription></div>
            <button type="button" className="settings-dialog-close" onClick={() => onOpenChange(false)} aria-label="关闭设置" title="关闭"><X size={18} /></button>
          </header>
          <div className="settings-dialog-scroll">
            {activeSection === "appearance" && <AppearanceSettings onMessage={onMessage} />}
            {activeSection === "sync" && (
              <SyncSettings
                state={state}
                saving={saving}
                syncing={syncing}
                syncProgress={syncProgress}
                retryingDomain={retryingDomain}
                onUpdate={(settings) => { void update(settings); }}
                onSync={onSync}
                onRetry={(definition) => { void retryDomain(definition); }}
              />
            )}
            {activeSection === "data" && (
              <DataSettings
                state={state}
                credentials={credentials}
                academicApiCredentials={academicApiCredentials}
                mailCredentials={mailCredentials}
                activityLog={activityLog}
                activityLoading={activityLoading}
                onRefreshActivity={onRefreshActivity}
                onCredentialChange={onCredentialChange}
                onAcademicApiCredentialChange={onAcademicApiCredentialChange}
                onMailCredentialChange={onMailCredentialChange}
                onMessage={onMessage}
                onExport={(format, collection) => { void exportFile(format, collection); }}
                onOpenDataDirectory={() => { void bridge.openDataDirectory().catch((error) => onMessage(error instanceof Error ? `无法打开数据目录：${error.message}` : "无法打开数据目录。")); }}
              />
            )}
            {activeSection === "interfaces" && (
              <>
                <section className="settings-section data-connections-section">
                  <div className="settings-title"><div className="settings-icon teal"><Server size={20} /></div><div><h2>接口</h2><p>管理 THEIA 本地只读 API、MCP 和 Iris 等本机集成。</p></div></div>
                </section>
                <section className="settings-section">
                  <div className="settings-title"><div className="settings-icon amber"><Server size={20} /></div><div><h2>THEIA 本地接口</h2><p>只读服务仅监听本机回环地址。</p></div></div>
                  <div className="api-endpoint"><code>{origin}</code><button className="icon-button" data-tooltip="复制接口地址" aria-label="复制接口地址" disabled={!apiBase} onClick={() => void navigator.clipboard.writeText(origin)}><Database size={17} /></button></div>
                  <div className="endpoint-list">
                    <code>GET /v1/snapshot</code><span>完整规范化数据</span>
                    <code>GET /v1/feed</code><span>校园事件与任务 Feed</span>
                    <code>GET /v1/academic-progress</code><span>培养方案和学分进度</span>
                    <code>GET /v1/selected-courses</code><span>当前学期已选课程</span>
                    <code>GET /v1/calendar.ics</code><span>考试与作业日历</span>
                    <code>GET /v1/venue-statuses</code><span>运动场馆实时状态（每次实时拉取）</span>
                    <code>GET /v1/motion-table-image</code><span>运动场馆状态表图片（PNG）</span>
                    <code>GET /v1/free-classroom-image</code><span>空闲教室图片（有缓存则用缓存）</span>
                    <code>GET /v1/table-image</code><span>教务表格图片（PNG）</span>
                  </div>
                </section>
                <McpIntegrationSettings onMessage={onMessage} />
                <IrisCompanionSettings onMessage={onMessage} />
              </>
            )}
            {activeSection === "model" && <AdvancedModelSettings state={state} status={modelStatus} onStatus={onModelStatus} onMessage={onMessage} />}
            {activeSection === "about" && <AboutSettings state={state} apiBase={apiBase} />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
