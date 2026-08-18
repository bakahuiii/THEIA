import { Braces, Database, HeartHandshake, ShieldCheck } from "lucide-react";
import theiaMark from "../../assets/theia-mark.png";
import type { CampusState } from "../../types";

export function AboutSettings({
  state,
  apiBase,
}: {
  state: CampusState;
  apiBase: string;
}) {
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
            <small>THEIA {state.appVersion || "0.5.0"}</small>
          </span>
        </div>
      </div>

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
