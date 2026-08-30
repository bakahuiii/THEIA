import { Braces, Database, Download, ExternalLink, HeartHandshake, RefreshCw, RotateCw, ShieldCheck, Smartphone } from "lucide-react";
import { bridge } from "../../bridge";
import { useGithubUpdateStatus } from "../../hooks/useGithubUpdateStatus";
import theiaMark from "../../assets/theia-mark.png";
import type { CampusState, GithubUpdateStatus } from "../../types";

const ANDROID_PROJECT_URL = "https://github.com/bakahuiii/THEIA-Android";

function formatUpdateTime(value: string | null) {
  if (!value) return "尚未检查";
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? value : time.toLocaleString("zh-CN", { hour12: false });
}

function describeUpdate(status: GithubUpdateStatus) {
  if (!status.supported) return "仅正式 Windows 安装包支持 GitHub 自动更新。";
  if (status.state === "checking") return "正在检查 GitHub Release。";
  if (status.state === "available") {
    return "发现新版本 " + (status.availableVersion || "未知版本") + "，正在下载。";
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

export function AboutSettings({
  state,
  apiBase,
}: {
  state: CampusState;
  apiBase: string;
}) {
  const updateStatus = useGithubUpdateStatus(state.appVersion || "web");

  const checking = updateStatus.state === "checking" || updateStatus.state === "downloading";
  const downloading = updateStatus.state === "downloading";
  const updatePercent = Number.isFinite(updateStatus.progress?.percent)
    ? Math.max(0, Math.min(100, updateStatus.progress?.percent || 0))
    : 0;
  const canInstall = updateStatus.supported && updateStatus.state === "downloaded";
  const primaryLabel = canInstall ? "重启并安装更新" : checking ? "检查中" : "检查更新";

  const runUpdateAction = async () => {
    if (canInstall) {
      await bridge.installUpdate();
      return;
    }
    if (updateStatus.supported) {
      await bridge.checkForUpdates();
    }
  };

  return (
    <section className="settings-section about-settings">
      <div className="about-hero">
        <div className="about-mark">
          <img src={theiaMark} alt="THEIA" />
        </div>
        <div>
          <span>Θεία</span>
          <h2>THEIA</h2>
          <p>为北化学生准备的本地优先校园工作台。</p>
        </div>
      </div>

      <div className="about-facts">
        <div>
          <ShieldCheck size={17} />
          <span>
            <strong>本机优先</strong>
            <small>账号凭据由当前 Windows 账户保护。</small>
          </span>
        </div>
        <div>
          <Database size={17} />
          <span>
            <strong>本地数据接口</strong>
            <small>{apiBase || "127.0.0.1:" + state.settings.apiPort}</small>
          </span>
        </div>
        <div>
          <Braces size={17} />
          <span>
            <strong>数据格式</strong>
            <small>{state.schema}</small>
          </span>
        </div>
        <div>
          <HeartHandshake size={17} />
          <span>
            <strong>版本</strong>
            <small>THEIA {state.appVersion || "0.6.3"}</small>
          </span>
        </div>
      </div>

      <div className="about-update">
        <div className="about-update-copy">
          <strong>GitHub 自动更新</strong>
          <small>{describeUpdate(updateStatus)}</small>
          <span>当前版本：THEIA {updateStatus.currentVersion}</span>
          <span>上次检查：{formatUpdateTime(updateStatus.lastCheckedAt)}</span>
          {(updateStatus.state === "checking" || updateStatus.state === "available" || downloading) && (
            <div className={`about-update-progress ${downloading ? "" : "is-indeterminate"}`}>
              <div className="about-update-progress-label">
                <span>{downloading ? "下载进度" : "更新准备"}</span>
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
            disabled={!updateStatus.supported || checking}
          >
            {canInstall ? <Download size={16} /> : checking ? <RefreshCw size={16} className="spinning" /> : <RotateCw size={16} />}
            {primaryLabel}
          </button>
        </div>
      </div>

      <section className="about-android" aria-labelledby="about-android-title">
        <div className="about-android-icon" aria-hidden="true">
          <Smartphone size={19} />
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
          <ExternalLink size={15} />
          查看 Android 项目
        </a>
      </section>

      <div className="about-footer">
        <span>THEIA Campus Client</span>
        <small>
          {state.profile?.studentId
            ? "已为 " + state.profile.studentId + " 准备本地工作区"
            : "等待统一身份认证连接校园平台"}
        </small>
      </div>
    </section>
  );
}
