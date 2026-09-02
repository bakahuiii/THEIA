import { AlertCircle, Braces, CheckCircle2, CircleHelp, Database, Download, ExternalLink, Github, Hash, HeartHandshake, LoaderCircle, Mail, MessagesSquare, RotateCw, ShieldCheck, Smartphone } from "lucide-react";
import { bridge } from "../../bridge";
import { useGithubUpdateStatus } from "../../hooks/useGithubUpdateStatus";
import authorAvatar from "../../assets/bakahuiii-avatar.jpg";
import theiaMark from "../../assets/theia-mark.png";
import type { ApiStatus, CampusState, GithubUpdateStatus } from "../../types";

const PROJECT_URL = "https://github.com/bakahuiii/THEIA";
const ANDROID_PROJECT_URL = "https://github.com/bakahuiii/THEIA-Android";
const RELEASES_URL = `${PROJECT_URL}/releases`;

function formatUpdateTime(value: string | null) {
  if (!value) return "尚未检查";
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? value : time.toLocaleString("zh-CN", { hour12: false });
}

function formatUpdateBytes(value: number) {
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

function describeUpdate(status: GithubUpdateStatus) {
  if (!status.supported) return "仅正式 Windows 安装包支持 COS / GitHub 自动更新。";
  if (status.state === "checking") return "正在检查 COS / GitHub 更新服务。";
  if (status.state === "available") {
    return "发现新版本 " + (status.availableVersion || "未知版本") + "，准备下载。";
  }
  if (status.state === "downloading") {
    const percent = Number.isFinite(status.progress?.percent) ? Math.max(0, Math.min(100, status.progress?.percent || 0)) : 0;
    return "正在下载更新 " + Math.round(percent) + "%。";
  }
  if (status.state === "downloaded") {
    return "更新 " + (status.availableVersion || "") + " 已下载，重启即可安装。";
  }
  if (status.state === "error") return "检查更新失败：" + (status.error || "未知错误");
  if (status.state === "not-available") return "当前已是最新版本 " + status.currentVersion + "。";
  return "当前版本 " + status.currentVersion;
}

function updateTone(status: GithubUpdateStatus) {
  if (!status.supported) return "unsupported";
  if (status.state === "error") return "error";
  if (status.state === "downloaded") return "ready";
  if (status.state === "checking" || status.state === "available" || status.state === "downloading") return "progress";
  if (status.state === "not-available") return "current";
  return "idle";
}

export function AboutSettings({
  state,
  apiBase,
  apiStatus,
}: {
  state: CampusState;
  apiBase: string;
  apiStatus: ApiStatus;
}) {
  const updateStatus = useGithubUpdateStatus(state.appVersion || "web");

  const apiOnline = Boolean(apiStatus.baseUrl && apiStatus.host && apiStatus.port > 0);
  const updateAvailable = updateStatus.state === "available";
  const updateInProgress = updateStatus.state === "checking" || updateStatus.state === "downloading";
  const updateProgressVisible = updateInProgress || updateAvailable;
  const downloading = updateStatus.state === "downloading";
  const updatePercent = Number.isFinite(updateStatus.progress?.percent)
    ? Math.max(0, Math.min(100, updateStatus.progress?.percent || 0))
    : 0;
  const updateSize = updateStatus.updateSizeBytes || updateStatus.progress?.totalBytes || 0;
  const canInstall = updateStatus.supported && updateStatus.state === "downloaded";
  const primaryLabel = !updateStatus.supported
    ? "仅安装包可用"
    : canInstall
      ? "重启并安装更新"
      : updateStatus.state === "checking"
        ? "检查中"
        : updateAvailable
          ? "更新"
          : downloading
            ? "下载中"
            : "检查更新";
  const UpdateIcon = !updateStatus.supported
    ? CircleHelp
    : updateStatus.state === "error"
      ? AlertCircle
      : canInstall
        ? CheckCircle2
        : updateStatus.state === "checking"
          ? LoaderCircle
          : updateStatus.state === "available" || downloading
            ? Download
            : RotateCw;
  const ActionIcon = !updateStatus.supported
    ? CircleHelp
    : canInstall
      ? Download
      : updateInProgress
        ? UpdateIcon
        : RotateCw;

  const runUpdateAction = async () => {
    if (!updateStatus.supported || updateInProgress) return;
    if (canInstall) {
      await bridge.installUpdate();
      return;
    }
    if (updateAvailable) {
      await bridge.downloadUpdate();
      return;
    }
    if (updateStatus.supported) {
      await bridge.checkForUpdates();
    }
  };

  return (
    <section className="settings-section about-settings">
      <div className="about-brand-row">
        <div className="about-hero">
          <div className="about-mark">
            <img src={theiaMark} alt="THEIA" />
          </div>
          <div>
            <span>Θεία</span>
            <h2>THEIA</h2>
          </div>
        </div>

        <section className="about-me" aria-labelledby="about-me-title">
          <div className="about-me-avatar-shell">
            <img className="about-me-avatar" src={authorAvatar} alt="头像" />
          </div>
          <div className="about-me-copy">
            <div className="about-me-heading">
              <h3 id="about-me-title">关于我</h3>
            </div>
            <div className="about-me-contacts" aria-label="联系方式">
              <a href="mailto:1411575779@qq.com"><Mail size={13} aria-hidden="true" />1411575779@qq.com</a>
              <span><Hash size={13} aria-hidden="true" />QQ 1411575779</span>
              <span><MessagesSquare size={13} aria-hidden="true" />微信 bakahui0225</span>
            </div>
          </div>
        </section>
      </div>

      <div className="about-facts">
        <div className="about-fact about-fact-security">
          <ShieldCheck size={17} aria-hidden="true" />
          <span>
            <strong>本机优先</strong>
            <small>账号凭据由当前 Windows 账户保护。</small>
          </span>
        </div>
        <div className={`about-fact about-fact-api ${apiOnline ? "is-online" : "is-offline"}`}>
          {apiOnline ? <CheckCircle2 size={17} aria-hidden="true" /> : <Database size={17} aria-hidden="true" />}
          <span>
            <strong>本地数据接口</strong>
            <small>{apiStatus.baseUrl || apiBase || "尚未启动"}</small>
          </span>
        </div>
        <div className="about-fact about-fact-format">
          <Braces size={17} aria-hidden="true" />
          <span>
            <strong>数据格式</strong>
            <small>{state.schema}{apiStatus.mcp?.schema ? ` · MCP ${apiStatus.mcp.schema}` : ""}</small>
          </span>
        </div>
        <div className="about-fact about-fact-version">
          <HeartHandshake size={17} aria-hidden="true" />
          <span>
            <strong>版本</strong>
            <small>THEIA {state.appVersion || "开发版本"}</small>
          </span>
        </div>
      </div>

      <div className={`about-update is-${updateTone(updateStatus)}`}>
        <div className="about-update-icon" aria-hidden="true">
          <UpdateIcon size={17} className={updateInProgress ? "spinning" : undefined} />
        </div>
        <div className="about-update-copy">
          <strong>COS / GitHub 自动更新</strong>
          <small>{describeUpdate(updateStatus)}</small>
          <span>当前版本：THEIA {updateStatus.currentVersion || state.appVersion || "开发版本"}</span>
          <span>上次检查：{formatUpdateTime(updateStatus.lastCheckedAt)}</span>
            {updateProgressVisible && (
            <div className={`about-update-progress ${downloading ? "" : "is-indeterminate"}`}>
              <div className="about-update-progress-label">
                <span>{downloading ? "下载进度" : updateStatus.state === "available" ? "准备下载" : "检查进度"}</span>
                {updateSize > 0 && <span>文件大小：{formatUpdateBytes(updateSize)}</span>}
                <strong>{downloading ? `${Math.round(updatePercent)}%` : "进行中"}</strong>
              </div>
              <div
                className="about-update-progress-track"
                role="progressbar"
                aria-label="更新下载进度"
                aria-valuenow={downloading ? Math.round(updatePercent) : undefined}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <i style={downloading ? { width: `${updatePercent}%` } : undefined} />
              </div>
            </div>
          )}
        </div>
        <div className="about-update-actions">
          <button
            type="button"
            className={canInstall ? "primary-button" : "secondary-button"}
            onClick={() => void runUpdateAction()}
            disabled={!updateStatus.supported || updateInProgress}
          >
            <ActionIcon size={16} className={updateInProgress ? "spinning" : undefined} aria-hidden="true" />
            {primaryLabel}
          </button>
        </div>
      </div>

      <section className="about-android" aria-labelledby="about-android-title">
        <div className="about-android-icon" aria-hidden="true">
          <Smartphone size={19} aria-hidden="true" />
        </div>
        <div className="about-android-copy">
          <div className="about-android-heading">
            <strong id="about-android-title">THEIA-Android</strong>
            <span>Android 10+</span>
          </div>
          <p>独立的 Capacitor Android 客户端，提供课表、成绩、考试、作业、学业进度、地图和公开场馆查询。</p>
          <small>只读校园数据，不执行选课、申请、上传、预约等学校侧操作。</small>
        </div>
        <a
          className="secondary-button about-android-link"
          href={ANDROID_PROJECT_URL}
          target="_blank"
          rel="noreferrer"
          title="打开 THEIA-Android 项目"
        >
          <ExternalLink size={15} aria-hidden="true" />
          查看 Android 项目
        </a>
      </section>

      <div className="about-boundary">
        <ShieldCheck size={16} aria-hidden="true" />
        <span><strong>本地数据边界</strong><small>校园数据、凭据和模型配置由本机能力管理；公开 API 和 MCP 只提供脱敏、只读数据，不包含密码、Cookie、令牌或任意学校侧写入。</small></span>
      </div>

      <div className="about-links" aria-label="项目链接">
        <a href={PROJECT_URL} target="_blank" rel="noreferrer"><Github size={15} aria-hidden="true" />GitHub 源码</a>
        <a href={RELEASES_URL} target="_blank" rel="noreferrer"><Download size={15} aria-hidden="true" />发行版本</a>
        <span>MIT License</span>
      </div>

      <div className="about-footer">
        <span>THEIA CAMPUS CLIENT</span>
        <small>
          {state.profile?.studentId
            ? "已为 " + state.profile.studentId + " 准备本地工作区"
            : "等待统一身份认证连接校园平台"}
        </small>
      </div>
    </section>
  );
}
