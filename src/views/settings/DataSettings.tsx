import {
  BrainCircuit,
  CalendarPlus,
  Clock3,
  Database,
  Download,
  FileJson,
  FolderOpen,
  KeyRound,
  TableProperties,
  RefreshCw,
} from "lucide-react";
import type {
  AcademicApiCredentialStatus,
  ActivityLogEntry,
  CampusState,
  CredentialStatus,
  MailCredentialStatus,
} from "../../types";
import { formatActivityLog } from "../../ui/app-shared";
import { AcademicDataSourceSettings } from "./AcademicDataSourceSettings";
import { CredentialForm } from "./Credentials";
import { MailboxSettings } from "./MailboxSettings";

export type DataExportFormat = "json" | "theia" | "ics" | "csv" | "ai";

type DataSettingsProps = {
  state: CampusState;
  credentials: CredentialStatus;
  academicApiCredentials: AcademicApiCredentialStatus;
  mailCredentials: MailCredentialStatus;
  activityLog: ActivityLogEntry[];
  activityLoading: boolean;
  onRefreshActivity: () => void;
  onCredentialChange: (status: CredentialStatus) => void;
  onAcademicApiCredentialChange: (status: AcademicApiCredentialStatus) => void;
  onMailCredentialChange: (status: MailCredentialStatus) => void;
  onMessage: (message: string) => void;
  onExport: (format: DataExportFormat, collection?: string) => void;
  onOpenDataDirectory: () => void;
};

function activityLogTone(entry: ActivityLogEntry) {
  let record: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(entry.raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) record = parsed as Record<string, unknown>;
  } catch {
    // Keep malformed fallback rows neutral.
  }
  const signals = [entry.event, record.level, record.severity, record.status, record.message]
    .filter((value): value is string => typeof value === "string").join(" ");
  const hasSignal = (keywords: string) => new RegExp(`(?:^|[._\\s-])(?:${keywords})(?:$|[._\\s-])`, "i").test(signals);
  const numericLevel = typeof record.level === "number" ? record.level : null;
  const numericStatus = typeof record.status === "number" ? record.status : null;
  if (Boolean(record.error) || numericLevel !== null && numericLevel >= 3 || numericStatus !== null && numericStatus >= 400 || hasSignal("error|failed|failure|fatal|exception|denied|blocked")) return "error";
  if (Boolean(record.warning) || numericLevel === 2 || numericStatus !== null && numericStatus >= 300 || hasSignal("warn|warning|wrn|retry|partial|incomplete|auth_required")) return "warning";
  return "success";
}

export function DataSettings({
  state,
  credentials,
  academicApiCredentials,
  mailCredentials,
  activityLog,
  activityLoading,
  onRefreshActivity,
  onCredentialChange,
  onAcademicApiCredentialChange,
  onMailCredentialChange,
  onMessage,
  onExport,
  onOpenDataDirectory,
}: DataSettingsProps) {
  return (
    <>
      <section className="settings-section data-connections-section">
        <div className="settings-title">
          <div className="settings-icon teal"><Database size={20} /></div>
          <div><h2>数据</h2><p>管理校园数据来源、认证凭据、邮箱、日志和本地导出。</p></div>
        </div>
        <div className="data-connections-grid">
          <section className="data-connection-card unified-auth-card">
            <div className="data-connection-card-header">
              <div className="settings-icon blue"><KeyRound size={20} /></div>
              <div><h2>统一身份认证</h2><p>用于北化在线THEOL及教务页面会话。</p></div>
            </div>
            <CredentialForm className="data-connection-form" status={credentials} onStatus={onCredentialChange} onMessage={onMessage} />
          </section>
          <AcademicDataSourceSettings state={state} status={academicApiCredentials} onStatus={onAcademicApiCredentialChange} onMessage={onMessage} />
        </div>
      </section>
      <MailboxSettings state={state} status={mailCredentials} onStatus={onMailCredentialChange} onMessage={onMessage} />
      <section className="settings-section activity-log-section">
        <div className="settings-title">
          <div className="settings-icon teal"><Clock3 size={20} /></div>
          <div><h2>日志</h2><p>原样显示本机 auth-diagnostics.ndjson；写入前已移除账号、密码、Cookie 和 API Key。</p></div>
          <button className="icon-button" data-tooltip="刷新活动记录" aria-label="刷新活动记录" onClick={onRefreshActivity} disabled={activityLoading}>
            <RefreshCw size={16} className={activityLoading ? "spinning" : ""} />
          </button>
        </div>
        {activityLog.length ? (
          <div className="activity-log-list">
            {activityLog.slice(0, 80).map((entry, index) => (
              <div className={`activity-log-row ${activityLogTone(entry)}`} key={entry.at + "-" + entry.event + "-" + index}>
                <code>{formatActivityLog(entry.raw)}</code>
              </div>
            ))}
          </div>
        ) : (
          <div className="sync-log-ok">{activityLoading ? "正在读取日志" : "暂无日志"}</div>
        )}
      </section>
      <section className="settings-section">
        <div className="settings-title">
          <div className="settings-icon red"><Download size={20} /></div>
          <div><h2>导出</h2><p>可由其他本地工具离线导入。</p></div>
          <button className="secondary-button export-open-directory" onClick={onOpenDataDirectory}><FolderOpen size={16} />打开本地数据目录</button>
        </div>
        <div className="export-grid">
          <button onClick={() => onExport("ai")}><BrainCircuit size={19} /><span><strong>导出给 AI</strong><small>阅读指南、字段词典与 SHA-256 完整性清单</small></span></button>
          <button onClick={() => onExport("json")}><FileJson size={19} /><span><strong>完整 JSON</strong><small>备份全部本地数据</small></span></button>
          <button onClick={() => onExport("theia")}><Database size={19} /><span><strong>THEIA Data Feed</strong><small>事件、任务和学业数据</small></span></button>
          <button onClick={() => onExport("ics")}><CalendarPlus size={19} /><span><strong>日历 ICS</strong><small>考试与作业截止时间</small></span></button>
          <button onClick={() => onExport("csv", "grades")}><TableProperties size={19} /><span><strong>成绩 CSV</strong><small>适合表格与统计工具</small></span></button>
        </div>
      </section>
    </>
  );
}
