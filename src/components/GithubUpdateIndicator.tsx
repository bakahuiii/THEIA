import { AlertCircle, CheckCircle2, Download, RefreshCw } from "lucide-react";
import type { GithubUpdateStatus } from "../types";

function progressPercent(status: GithubUpdateStatus) {
  const value = Number(status.progress?.percent);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  if (value < 1024) return `${Math.round(value)} B`;
  const units = ["KB", "MB", "GB"];
  let amount = value;
  let unit = "B";
  for (const nextUnit of units) {
    amount /= 1024;
    unit = nextUnit;
    if (amount < 1024 || nextUnit === units.at(-1)) break;
  }
  return `${amount.toFixed(amount >= 10 ? 0 : 1)} ${unit}`;
}

function formatSpeed(value: number) {
  return `${formatBytes(value)}/s`;
}

function statusCopy(status: GithubUpdateStatus) {
  switch (status.state) {
    case "checking":
      return { title: "正在检查更新", detail: "正在连接 COS 更新服务" };
    case "available":
      return {
        title: "发现新版本",
        detail: `v${status.availableVersion || "未知版本"}，准备开始下载`,
      };
    case "downloading":
      return {
        title: "正在下载更新",
        detail: `v${status.availableVersion || "未知版本"}`,
      };
    case "downloaded":
      return {
        title: "更新已下载",
        detail: `v${status.availableVersion || "未知版本"}，退出应用后自动安装`,
      };
    case "error":
      return {
        title: "自动更新失败",
        detail: status.error || "稍后可在关于页面重试",
      };
    default:
      return null;
  }
}

export function GithubUpdateIndicator({ status }: { status: GithubUpdateStatus }) {
  if (!status.supported) return null;
  const copy = statusCopy(status);
  if (!copy) return null;

  const downloading = status.state === "downloading";
  const progress = progressPercent(status);
  const Icon = status.state === "downloaded"
    ? CheckCircle2
    : status.state === "error"
      ? AlertCircle
      : status.state === "downloading" || status.state === "available"
        ? Download
        : RefreshCw;

  return (
    <aside
      className={`github-update-indicator is-${status.state}`}
      role="status"
      aria-live="polite"
      aria-label={copy.title}
    >
      <div className="github-update-indicator-icon" aria-hidden="true">
        <Icon size={18} className={status.state === "checking" || status.state === "downloading" ? "spinning" : undefined} />
      </div>
      <div className="github-update-indicator-body">
        <div className="github-update-indicator-heading">
          <strong>{copy.title}</strong>
          {status.availableVersion && <span>v{status.availableVersion}</span>}
        </div>
        <p>{copy.detail}</p>
        {(status.state === "checking" || status.state === "available" || downloading) && (
          <div
            className={`github-update-progress ${downloading ? "" : "is-indeterminate"}`}
            role="progressbar"
            aria-label="更新下载进度"
            aria-valuenow={downloading ? Math.round(progress) : undefined}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <i style={downloading ? { width: `${progress}%` } : undefined} />
          </div>
        )}
        {downloading && (
          <div className="github-update-indicator-meta">
            <span>{formatBytes(status.progress?.transferredBytes || 0)} / {formatBytes(status.progress?.totalBytes || 0)}</span>
            <span>{formatSpeed(status.progress?.bytesPerSecond || 0)}</span>
            <strong>{Math.round(progress)}%</strong>
          </div>
        )}
      </div>
    </aside>
  );
}
