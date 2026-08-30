import { AlertCircle, RefreshCw } from "lucide-react";
import type { CampusState, SyncRetryDomain } from "../../types";
import { formatDateTime, Toggle } from "../../ui/app-shared";
import { formatAcademicTermId } from "../../ui/term-label";
import { SYNC_DATA_GROUPS, SYNC_ERROR_LABELS, syncRecord, type SyncDataDefinition } from "./SyncSettingsModel";

type SyncTone = "success" | "partial" | "failed" | "pending";

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

export type SyncSettingsProps = {
  state: CampusState;
  saving: boolean;
  syncing: boolean;
  syncProgress: string | null;
  retryingDomain: SyncRetryDomain | null;
  onUpdate: (settings: Partial<CampusState["settings"]>) => void;
  onSync: () => void;
  onRetry: (definition: SyncDataDefinition) => void;
};

export function SyncSettings({
  state,
  saving,
  syncing,
  syncProgress,
  retryingDomain,
  onUpdate,
  onSync,
  onRetry,
}: SyncSettingsProps) {
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

  return (
    <section className="settings-section">
      <div className="settings-title">
        <div className="settings-icon teal"><RefreshCw size={20} /></div>
        <div>
          <h2>同步</h2>
          <p>学校页面仅在同步时读取，数据默认只保留在本机。</p>
        </div>
      </div>
      <Toggle
        checked={state.settings.autoSync}
        onChange={(value) => onUpdate({ autoSync: value })}
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
          onChange={(event) => onUpdate({ syncIntervalMinutes: Number(event.target.value) })}
        />
        <em>分钟</em>
      </label>
      <div className="button-row">
        <button
          className="primary-button"
          onClick={onSync}
          disabled={syncing || retryingDomain !== null}
        >
          <RefreshCw size={16} className={syncing ? "spinning" : ""} />
          {syncing ? syncProgress || "同步中" : "立即全量同步"}
        </button>
      </div>
      {(state.sync.lastRunAt || state.sync.lastCompletedAt) && (
        <div className="sync-log-panel">
          <div className="sync-log-header">
            <strong>上次同步尝试</strong>
            <span>{formatDateTime(state.sync.lastRunAt || state.sync.lastCompletedAt)}</span>
          </div>
          {fetchLog.length > 0 && (
            <div className="fetch-log-grid">
              {fetchLog.map((entry) => (
                <div key={entry.termId} className={["fetch-log-row", entry.count > 0 ? "ok" : entry.error ? "err" : "empty"].join(" ")}>
                  <span>{formatAcademicTermId(entry.termId)}</span>
                  <strong>{entry.count > 0 ? entry.count + " 节课" : entry.error ? "请求失败" : "空（服务端无数据）"}</strong>
                  {entry.error && <small>{entry.error}</small>}
                </div>
              ))}
            </div>
          )}
          {otherErrors.length > 0 && (
            <div className="sync-errors">
              {otherErrors.map((error, index) => (
                <div key={index} className="sync-error-row"><AlertCircle size={13} /><small>{error}</small></div>
              ))}
            </div>
          )}
          {!fetchLog.length && !otherErrors.length && (
            <div className="sync-log-ok">{syncing ? "正在同步；这里显示的是上次完成结果" : "同步正常，无报错"}</div>
          )}
          <div className="sync-data-summary">
            <span>课表 <strong>{state.schedule.length}</strong> 条</span>
            <span>考试 <strong>{state.exams.length}</strong> 条</span>
            <span>成绩 <strong>{state.grades.length}</strong> 条</span>
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
              <header><strong>{group.label}</strong><small>{group.detail}</small></header>
              <div className="sync-domain-list">
                {group.items.map((definition) => {
                  const result = syncDataResult(state, definition, syncing);
                  const retrying = retryingDomain === definition.id;
                  return (
                    <div className={`sync-domain-row ${retrying ? "pending" : result.tone}`} key={definition.id}>
                      <span className="sync-domain-indicator" aria-hidden="true" />
                      <strong>{definition.label}</strong>
                      <span className="sync-domain-state">{retrying ? "获取中" : result.label}</span>
                      <small title={retrying ? `正在单独获取${definition.label}` : result.detail}>{retrying ? `正在单独获取${definition.label}` : result.detail}</small>
                      <button
                        type="button"
                        className="sync-domain-retry"
                        aria-label={`重新获取${definition.label}`}
                        title={`重新获取${definition.label}`}
                        disabled={syncing || retryingDomain !== null}
                        onClick={() => onRetry(definition)}
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
  );
}
