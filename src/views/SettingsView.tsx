import {
  AlertCircle,
  BrainCircuit,
  CalendarPlus,
  CircleHelp,
  Clock3,
  Database,
  Download,
  FileJson,
  FolderOpen,
  KeyRound,
  Palette,
  RefreshCw,
  Server,
  TableProperties,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";
import { formatActivityLog, formatDateTime, Toggle } from "../ui/app-shared";
import type {
  AcademicApiCredentialStatus,
  ActivityLogEntry,
  AuthStatus,
  CampusState,
  CredentialStatus,
  ModelStatus,
  MailCredentialStatus,
  SyncRetryDomain,
} from "../types";
import { AcademicDataSourceSettings } from "./settings/AcademicDataSourceSettings";
import { AboutSettings } from "./settings/AboutSettings";
import { AdvancedModelSettings } from "./settings/AdvancedModelSettings";
import { AppearanceSettings } from "./settings/AppearanceSettings";
import { CredentialForm } from "./settings/Credentials";
import { MailboxSettings } from "./settings/MailboxSettings";
import { McpIntegrationSettings } from "./settings/McpIntegrationSettings";
import { IrisCompanionSettings } from "./settings/IrisCompanionSettings";
import { formatAcademicTermId } from "../ui/term-label";
export type SettingsSection =
  | "appearance"
  | "sync"
  | "data"
  | "interfaces"
  | "model"
  | "about";

const SETTINGS_NAV = [
  { id: "appearance", label: "外观", icon: Palette },
  { id: "sync", label: "同步", icon: RefreshCw },
  { id: "data", label: "数据", icon: Database },
  { id: "interfaces", label: "接口", icon: Server },
  { id: "model", label: "模型服务", icon: BrainCircuit },
] as const;

type SyncDomainAggregate = CampusState["sync"]["domains"][string];
type SyncDomainOutcome = NonNullable<SyncDomainAggregate["outcomes"]>[string];
type SyncDomainRecord = SyncDomainAggregate | SyncDomainOutcome;
type SyncTone = "success" | "partial" | "failed" | "pending";

type SyncDataDefinition = {
  id: SyncRetryDomain;
  label: string;
  domain: string;
  source?: "jwglxt" | "theol";
  unit?: string;
  mainSync?: boolean;
  deferred?: boolean;
  count: (state: CampusState) => number;
};

const SYNC_DATA_GROUPS: Array<{
  id: string;
  label: string;
  detail: string;
  items: SyncDataDefinition[];
}> = [
  {
    id: "jwglxt",
    label: "教务系统",
    detail: "课表、考试、成绩及学业数据",
    items: [
      { id: "profile", label: "个人信息", domain: "profile", source: "jwglxt", unit: "份", mainSync: true, count: (state) => Number(Boolean(state.profile)) },
      { id: "terms", label: "学期", domain: "terms", source: "jwglxt", unit: "个", mainSync: true, count: (state) => state.terms.length },
      { id: "schedule", label: "课表", domain: "schedule", source: "jwglxt", mainSync: true, count: (state) => state.schedule.length },
      { id: "exams", label: "考试", domain: "exams", source: "jwglxt", mainSync: true, count: (state) => state.exams.length },
      { id: "grades", label: "成绩", domain: "grades", source: "jwglxt", mainSync: true, count: (state) => state.grades.length },
      { id: "selected-courses", label: "已选课程", domain: "selected-courses", source: "jwglxt", unit: "门", mainSync: true, count: (state) => state.selectedCourses.length },
      { id: "academic-progress", label: "学业进度", domain: "academic-progress", source: "jwglxt", unit: "份", mainSync: true, count: (state) => Number(Boolean(state.academicProgress)) },
      { id: "jwglxt-courses", label: "教务课程信息", domain: "courses", source: "jwglxt", unit: "门", mainSync: true, count: (state) => state.courses.filter((course) => course.source === "jwglxt").length },
      { id: "jwglxt-notices", label: "教务通知", domain: "notices", source: "jwglxt", mainSync: true, count: (state) => state.notices.filter((notice) => notice.source === "jwglxt").length },
    ],
  },
  {
    id: "theol",
    label: "北化在线THEOL",
    detail: "北化在线THEOL严格串行读取",
    items: [
      { id: "theol-courses", label: "THEOL 课程", domain: "courses", source: "theol", unit: "门", mainSync: true, count: (state) => state.courses.filter((course) => course.source === "theol").length },
      { id: "theol-course-details", label: "THEOL 课程资料", domain: "course-details", source: "theol", unit: "门", mainSync: false, count: (state) => state.courses.filter((course) => course.source === "theol" && (course.courseInfo || course.teachingMaterials?.length || course.resourceLinks?.length)).length },
      { id: "assignments", label: "作业与测试", domain: "assignments", source: "theol", mainSync: true, deferred: true, count: (state) => state.assignments.length },
      { id: "theol-notices", label: "THEOL 通知", domain: "notices", source: "theol", mainSync: true, count: (state) => state.notices.filter((notice) => notice.source === "theol").length },
    ],
  },
  {
    id: "independent",
    label: "独立数据",
    detail: "按各自功能单独刷新",
    items: [
      { id: "mailbox", label: "校园邮箱", domain: "mailbox", unit: "封", count: (state) => state.emails.length },
      { id: "academic-calendar", label: "校历", domain: "academic-calendar", unit: "份", count: (state) => Number(Boolean(state.dataCatalog.collections.academicCalendar.calendar || state.dataCatalog.collections.academicCalendar.analysis)) },
      { id: "fitness", label: "体测成绩", domain: "fitness", unit: "个年度", count: (state) => Object.keys(state.dataCatalog.collections.fitness.records).length },
    ],
  },
];

const SYNC_ERROR_LABELS: Record<string, string> = {
  auth_required: "需要重新登录",
  requirement_tree_missing: "培养方案树缺失",
  requirement_tree_inferred: "已恢复培养方案结构，层级来自页面顺序推断",
  partial_requirement_details: "培养方案节点明细仅部分获取成功",
  summary_only: "仅获取到汇总数据",
  partial_assignment_scan: "部分课程作业读取失败",
  partial_source_errors: "来源返回了部分错误",
  unconfirmed_empty_result: "空结果尚未确认",
  multiple_source_errors: "多个来源读取失败",
  multiple_dependency_errors: "多个依赖数据不完整",
};

function syncRecord(
  state: CampusState,
  definition: SyncDataDefinition,
): SyncDomainRecord | undefined {
  const domain = state.sync.domains[definition.domain];
  return definition.source ? domain?.outcomes?.[definition.source] : domain;
}

function syncDataResult(
  state: CampusState,
  definition: SyncDataDefinition,
  syncing: boolean,
) {
  const record = syncRecord(state, definition);
  const count = definition.count(state);
  const countText = `${count} ${definition.unit || "条"}`;
  const currentRunPending = Boolean(
    syncing &&
      definition.mainSync &&
      state.sync.runId &&
      record?.runId !== state.sync.runId,
  );
  const notAttempted =
    currentRunPending ||
    !record ||
    !record.attempted ||
    record.status === "never" ||
    record.status === "not-attempted";

  if (notAttempted) {
    const detail = definition.deferred
      ? `${count ? `本机已有 ${countText}；` : ""}主同步完成后静默获取`
      : `${syncing && definition.mainSync ? "等待本轮获取" : "尚未开始"}${count ? `；本机已有 ${countText}` : ""}`;
    return { tone: "pending" as SyncTone, label: "未开始", detail };
  }

  if (record.status === "failed" || record.status === "auth-required") {
    const reason = record.status === "auth-required"
      ? "需要重新登录"
      : record.errorCode
        ? SYNC_ERROR_LABELS[record.errorCode] || `错误码：${record.errorCode}`
        : "请求失败";
    return {
      tone: "failed" as SyncTone,
      label: record.status === "auth-required" ? "认证失败" : "失败",
      detail: `${reason}${count ? `；本机保留 ${countText}` : ""}`,
    };
  }

  const successfulTerms = record.successfulTermIds?.length || 0;
  const failedTerms = record.failedTermIds?.length || 0;
  const partial =
    record.completeness !== "complete" ||
    record.retainedPrevious ||
    Boolean(record.errorCode) ||
    failedTerms > 0;
  if (partial) {
    const details = [
      count ? `已获取 ${countText}` : "已获取部分数据",
      successfulTerms || failedTerms ? `学期成功 ${successfulTerms} / 失败 ${failedTerms}` : null,
      record.errorCode ? SYNC_ERROR_LABELS[record.errorCode] || `错误码：${record.errorCode}` : null,
      record.retainedPrevious ? "同时保留了旧数据" : null,
    ].filter(Boolean);
    return { tone: "partial" as SyncTone, label: "部分成功", detail: details.join("；") };
  }

  return {
    tone: "success" as SyncTone,
    label: "成功",
    detail: record.emptyConfirmed ? "已确认无数据" : `已获取 ${countText}`,
  };
}

function activityLogTone(entry: ActivityLogEntry) {
  let record: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(entry.raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      record = parsed as Record<string, unknown>;
    }
  } catch {
    // The main process only returns valid NDJSON; keep malformed fallback rows neutral.
  }
  const signals = [
    entry.event,
    record.level,
    record.severity,
    record.status,
    record.message,
  ].filter((value): value is string => typeof value === "string").join(" ");
  const hasSignal = (keywords: string) =>
    new RegExp(`(?:^|[._\\s-])(?:${keywords})(?:$|[._\\s-])`, "i").test(signals);
  const numericLevel = typeof record.level === "number" ? record.level : null;
  const numericStatus = typeof record.status === "number" ? record.status : null;
  if (
    Boolean(record.error) ||
    numericLevel !== null && numericLevel >= 3 ||
    numericStatus !== null && numericStatus >= 400 ||
    hasSignal("error|failed|failure|fatal|exception|denied|blocked")
  ) return "error";
  if (
    Boolean(record.warning) ||
    numericLevel === 2 ||
    numericStatus !== null && numericStatus >= 300 ||
    hasSignal("warn|warning|wrn|retry|partial|incomplete|auth_required")
  ) return "warning";
  return "success";
}

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
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("appearance");
  const [saving, setSaving] = useState(false);
  const [retryingDomain, setRetryingDomain] = useState<SyncRetryDomain | null>(null);
  const origin = apiBase || "桌面客户端启动后可用";

  useEffect(() => {
    if (open) setActiveSection(initialSection);
  }, [initialSection, open]);

  const update = async (settings: Partial<CampusState["settings"]>) => {
    setSaving(true);
    try {
      await bridge.updateSettings(settings);
    } catch (error) {
      onMessage(
        error instanceof Error ? error.message : "设置保存失败，请重试"
      );
    } finally {
      setSaving(false);
    }
  };
  const exportFile = async (
    format: "json" | "theia" | "ics" | "csv" | "ai",
    collection?: string,
  ) => {
    try {
      const result = await bridge.exportData(format, collection);
      if (result.canceled) return;
      if (format === "ai") {
        onMessage(
          `AI 数据包已导出至 ${result.filePath || "所选目录"}（${result.files || 0} 个已校验文件）。`,
        );
        return;
      }
      onMessage(`数据已导出至 ${result.filePath || "所选位置"}。`);
    } catch (error) {
      onMessage(error instanceof Error ? `导出失败：${error.message}` : "导出失败。");
    }
  };
  const openDataDirectory = async () => {
    try {
      await bridge.openDataDirectory();
    } catch (error) {
      onMessage(error instanceof Error ? `无法打开数据目录：${error.message}` : "无法打开数据目录。");
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
  const rawSyncError = state.sync.lastError || "";
  const logMatch = rawSyncError.match(/\[schedule-fetch-log\] (\[.*\])/);
  const fetchLog: Array<{ termId: string; count: number; error?: string }> =
    logMatch
      ? (() => {
          try {
            return JSON.parse(logMatch[1]);
          } catch {
            return [];
          }
        })()
      : [];
  const otherErrors = rawSyncError
    .split("; ")
    .filter((entry) => !entry.startsWith("[schedule-fetch-log]"))
    .filter(Boolean);
  const sectionTitle =
    activeSection === "appearance"
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
          <div className="settings-modal-brand">
            <span>Θεία</span>
            <strong>THEIA</strong>
            <small>Preferences</small>
          </div>
          <nav>
            {SETTINGS_NAV.map(({ id, label, icon: Icon }) => (
              <button
                type="button"
                key={id}
                className={activeSection === id ? "active" : ""}
                onClick={() => setActiveSection(id)}
                aria-current={activeSection === id ? "page" : undefined}
              >
                <Icon size={17} />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <div className="settings-nav-bottom">
            <button
              type="button"
              className={activeSection === "about" ? "active" : ""}
              onClick={() => setActiveSection("about")}
              aria-current={activeSection === "about" ? "page" : undefined}
            >
              <CircleHelp size={17} />
              <span>关于</span>
            </button>
          </div>
        </aside>

        <div className="settings-dialog-main">
          <header className="settings-dialog-header">
            <div>
              <DialogTitle>{sectionTitle}</DialogTitle>
              <DialogDescription>
                THEIA 的本机偏好与校园数据连接。
              </DialogDescription>
            </div>
            <button
              type="button"
              className="settings-dialog-close"
              onClick={() => onOpenChange(false)}
              aria-label="关闭设置"
              title="关闭"
            >
              <X size={18} />
            </button>
          </header>

          <div className="settings-dialog-scroll">
            {activeSection === "appearance" && (
              <AppearanceSettings onMessage={onMessage} />
            )}

            {activeSection === "sync" && (
              <section className="settings-section">
                <div className="settings-title">
                  <div className="settings-icon teal">
                    <RefreshCw size={20} />
                  </div>
                  <div>
                    <h2>同步</h2>
                    <p>学校页面仅在同步时读取，数据默认只保留在本机。</p>
                  </div>
                </div>
                <Toggle
                  checked={state.settings.autoSync}
                  onChange={(value) => void update({ autoSync: value })}
                  label="后台定时同步"
                  detail="桌面客户端运行时按照指定间隔刷新"
                />
                <label className="numeric-setting">
                  <span>
                    <strong>同步间隔</strong>
                    <small>最短 5 分钟，避免频繁请求学校系统。</small>
                  </span>
                  <input
                    type="number"
                    min="5"
                    max="1440"
                    value={state.settings.syncIntervalMinutes}
                    disabled={saving}
                    onChange={(event) =>
                      void update({
                        syncIntervalMinutes: Number(event.target.value),
                      })
                    }
                  />
                  <em>分钟</em>
                </label>
                <div className="button-row">
                  <button
                    className="primary-button"
                    onClick={onSync}
                    disabled={syncing || retryingDomain !== null}
                  >
                    <RefreshCw
                      size={16}
                      className={syncing ? "spinning" : ""}
                    />
                    {syncing ? syncProgress || "同步中" : "立即全量同步"}
                  </button>
                </div>
                {(state.sync.lastRunAt || state.sync.lastCompletedAt) && (
                  <div className="sync-log-panel">
                    <div className="sync-log-header">
                      <strong>上次同步尝试</strong>
                      <span>
                        {formatDateTime(state.sync.lastRunAt || state.sync.lastCompletedAt)}
                      </span>
                    </div>
                    {fetchLog.length > 0 && (
                      <div className="fetch-log-grid">
                        {fetchLog.map((entry) => (
                          <div
                            key={entry.termId}
                            className={[
                              "fetch-log-row",
                              entry.count > 0
                                ? "ok"
                                : entry.error
                                  ? "err"
                                  : "empty",
                            ].join(" ")}
                          >
                            <span>{formatAcademicTermId(entry.termId)}</span>
                            <strong>
                              {entry.count > 0
                                ? entry.count + " 节课"
                                : entry.error
                                  ? "请求失败"
                                  : "空（服务端无数据）"}
                            </strong>
                            {entry.error && <small>{entry.error}</small>}
                          </div>
                        ))}
                      </div>
                    )}
                    {otherErrors.length > 0 && (
                      <div className="sync-errors">
                        {otherErrors.map((error, index) => (
                          <div key={index} className="sync-error-row">
                            <AlertCircle size={13} />
                            <small>{error}</small>
                          </div>
                        ))}
                      </div>
                    )}
                    {!fetchLog.length && !otherErrors.length && (
                      <div className="sync-log-ok">
                        {syncing
                          ? "正在同步；这里显示的是上次完成结果"
                          : "同步正常，无报错"}
                      </div>
                    )}
                    <div className="sync-data-summary">
                      <span>
                        课表 <strong>{state.schedule.length}</strong> 条
                      </span>
                      <span>
                        考试 <strong>{state.exams.length}</strong> 条
                      </span>
                      <span>
                        成绩 <strong>{state.grades.length}</strong> 条
                      </span>
                    </div>
                  </div>
                )}
                <div className="sync-domain-overview" aria-label="同步数据明细">
                  <div className="sync-domain-overview-header">
                    <div>
                      <strong>{syncing ? "本轮同步进度" : "数据获取明细"}</strong>
                      <small>
                        {syncing
                          ? "状态会随教务系统与北化在线THEOL的返回实时更新"
                          : state.sync.lastRunAt || state.sync.lastCompletedAt
                            ? `最近主同步：${formatDateTime(state.sync.lastRunAt || state.sync.lastCompletedAt)}`
                            : "尚未进行主同步"}
                      </small>
                    </div>
                    <div className="sync-domain-legend" aria-label="状态图例">
                      <span className="success">成功</span>
                      <span className="partial">部分成功</span>
                      <span className="failed">失败</span>
                      <span className="pending">按需 / 未开始</span>
                    </div>
                  </div>
                  <div className="sync-domain-groups">
                    {SYNC_DATA_GROUPS.map((group) => (
                      <section className="sync-domain-group" key={group.id}>
                        <header>
                          <strong>{group.label}</strong>
                          <small>{group.detail}</small>
                        </header>
                        <div className="sync-domain-list">
                          {group.items.map((definition) => {
                            const result = syncDataResult(state, definition, syncing);
                            const retrying = retryingDomain === definition.id;
                            return (
                              <div className={`sync-domain-row ${retrying ? "pending" : result.tone}`} key={definition.id}>
                                <span className="sync-domain-indicator" aria-hidden="true" />
                                <strong>{definition.label}</strong>
                                <span className="sync-domain-state">{retrying ? "获取中" : result.label}</span>
                                <small title={retrying ? `正在单独获取${definition.label}` : result.detail}>
                                  {retrying ? `正在单独获取${definition.label}` : result.detail}
                                </small>
                                <button
                                  type="button"
                                  className="sync-domain-retry"
                                  aria-label={`重新获取${definition.label}`}
                                  title={`重新获取${definition.label}`}
                                  disabled={syncing || retryingDomain !== null}
                                  onClick={() => void retryDomain(definition)}
                                >
                                  <RefreshCw size={13} className={retrying ? "spinning" : ""} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {activeSection === "data" && (
              <>
                <section className="settings-section data-connections-section">
                  <div className="settings-title">
                    <div className="settings-icon teal"><Database size={20} /></div>
                    <div>
                      <h2>数据</h2>
                      <p>管理校园数据来源、认证凭据、邮箱、日志和本地导出。</p>
                    </div>
                  </div>
                  <div className="data-connections-grid">
                    <section className="data-connection-card unified-auth-card">
                      <div className="data-connection-card-header">
                        <div className="settings-icon blue"><KeyRound size={20} /></div>
                        <div>
                          <h2>统一身份认证</h2>
                          <p>用于北化在线THEOL及教务页面会话。</p>
                        </div>
                      </div>
                      <CredentialForm
                        className="data-connection-form"
                        status={credentials}
                        onStatus={onCredentialChange}
                        onMessage={onMessage}
                      />
                    </section>
                    <AcademicDataSourceSettings
                      state={state}
                      status={academicApiCredentials}
                      onStatus={onAcademicApiCredentialChange}
                      onMessage={onMessage}
                    />
                  </div>
                </section>
                <MailboxSettings
                  state={state}
                  status={mailCredentials}
                  onStatus={onMailCredentialChange}
                  onMessage={onMessage}
                />
                <section className="settings-section activity-log-section">
                  <div className="settings-title">
                    <div className="settings-icon teal">
                      <Clock3 size={20} />
                    </div>
                    <div>
                      <h2>日志</h2>
                      <p>
                        原样显示本机 auth-diagnostics.ndjson；写入前已移除账号、密码、Cookie 和 API Key。
                      </p>
                    </div>
                    <button
                      className="icon-button"
                      data-tooltip="刷新活动记录"
                      aria-label="刷新活动记录"
                      onClick={onRefreshActivity}
                      disabled={activityLoading}
                    >
                      <RefreshCw
                        size={16}
                        className={activityLoading ? "spinning" : ""}
                      />
                    </button>
                  </div>
                  {activityLog.length ? (
                    <div className="activity-log-list">
                      {activityLog.slice(0, 80).map((entry, index) => (
                        <div
                          className={`activity-log-row ${activityLogTone(entry)}`}
                          key={entry.at + "-" + entry.event + "-" + index}
                        >
                          <code>{formatActivityLog(entry.raw)}</code>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="sync-log-ok">
                      {activityLoading ? "正在读取日志" : "暂无日志"}
                    </div>
                  )}
                </section>

                <section className="settings-section">
                  <div className="settings-title">
                    <div className="settings-icon red">
                      <Download size={20} />
                    </div>
                    <div>
                      <h2>导出</h2>
                      <p>可由其他本地工具离线导入。</p>
                    </div>
                    <button
                      className="secondary-button export-open-directory"
                      onClick={() => void openDataDirectory()}
                    >
                      <FolderOpen size={16} />
                      打开本地数据目录
                    </button>
                  </div>
                  <div className="export-grid">
                    <button onClick={() => void exportFile("ai")}>
                      <BrainCircuit size={19} />
                      <span>
                        <strong>导出给 AI</strong>
                        <small>阅读指南、字段词典与 SHA-256 完整性清单</small>
                      </span>
                    </button>
                    <button onClick={() => void exportFile("json")}>
                      <FileJson size={19} />
                      <span>
                        <strong>完整 JSON</strong>
                        <small>备份全部本地数据</small>
                      </span>
                    </button>
                    <button onClick={() => void exportFile("theia")}>
                      <Database size={19} />
                      <span>
                        <strong>THEIA Data Feed</strong>
                        <small>事件、任务和学业数据</small>
                      </span>
                    </button>
                    <button onClick={() => void exportFile("ics")}>
                      <CalendarPlus size={19} />
                      <span>
                        <strong>日历 ICS</strong>
                        <small>考试与作业截止时间</small>
                      </span>
                    </button>
                    <button onClick={() => void exportFile("csv", "grades")}>
                      <TableProperties size={19} />
                      <span>
                        <strong>成绩 CSV</strong>
                        <small>适合表格与统计工具</small>
                      </span>
                    </button>
                  </div>
                </section>
              </>
            )}

            {activeSection === "interfaces" && (
              <>
                <section className="settings-section data-connections-section">
                  <div className="settings-title">
                    <div className="settings-icon teal"><Server size={20} /></div>
                    <div>
                      <h2>接口</h2>
                      <p>管理 THEIA 本地只读 API、MCP 和 Iris 等本机集成。</p>
                    </div>
                  </div>
                </section>

                <section className="settings-section">
                  <div className="settings-title">
                    <div className="settings-icon amber">
                      <Server size={20} />
                    </div>
                    <div>
                      <h2>THEIA 本地接口</h2>
                      <p>只读服务仅监听本机回环地址。</p>
                    </div>
                  </div>
                  <div className="api-endpoint">
                    <code>{origin}</code>
                    <button
                      className="icon-button"
                      data-tooltip="复制接口地址"
                      aria-label="复制接口地址"
                      disabled={!apiBase}
                      onClick={() => void navigator.clipboard.writeText(origin)}
                    >
                      <Database size={17} />
                    </button>
                  </div>
                  <div className="endpoint-list">
                    <code>GET /v1/snapshot</code>
                    <span>完整规范化数据</span>
                    <code>GET /v1/feed</code>
                    <span>校园事件与任务 Feed</span>
                    <code>GET /v1/academic-progress</code>
                    <span>培养方案和学分进度</span>
                    <code>GET /v1/selected-courses</code>
                    <span>当前学期已选课程</span>
                    <code>GET /v1/calendar.ics</code>
                    <span>考试与作业日历</span>
                    <code>GET /v1/venue-statuses</code>
                    <span>运动场馆实时状态（每次实时拉取）</span>
                    <code>GET /v1/motion-table-image</code>
                    <span>运动场馆状态表图片（PNG）</span>
                    <code>GET /v1/free-classroom-image</code>
                    <span>空闲教室图片（有缓存则用缓存）</span>
                    <code>GET /v1/table-image</code>
                    <span>教务表格图片（PNG）</span>
                  </div>
                </section>

                <McpIntegrationSettings onMessage={onMessage} />
                <IrisCompanionSettings onMessage={onMessage} />
              </>
            )}

            {activeSection === "model" && (
              <AdvancedModelSettings
                state={state}
                status={modelStatus}
                onStatus={onModelStatus}
                onMessage={onMessage}
              />
            )}
            {activeSection === "about" && (
              <AboutSettings state={state} apiBase={apiBase} />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
