import { Info } from "lucide-react";
import { RULE_GROUPS } from "./innovation-calc-model";

export function RulesView() {
  return (
    <section className="warning-section innovation-rules-section">
      <div className="innovation-section-heading">
        <div>
          <h3 className="warning-section-title">创新创业教育学分规则与分值</h3>
          <p className="warning-section-desc">根据《北京化工大学本科生手册》（2023 版）第 30–36 页整理。正式认定、适用年级和学院执行细则优先。</p>
        </div>
        <span className="innovation-rule-version">2017 级起施行</span>
      </div>
      <div className="innovation-rules-table-wrap">
        <table className="innovation-rules-table">
          <thead><tr><th>项目</th><th>条件 / 认定材料</th><th>学分值或处理</th></tr></thead>
          <tbody>
            {RULE_GROUPS.flatMap((group) => [{ type: "group" as const, group }, ...group.rows.map((row) => ({ type: "row" as const, row }))]).map((item, index) => item.type === "group"
              ? <tr className="innovation-rules-group" key={`group-${index}`}><th colSpan={3}><strong>{item.group.title}</strong><span>{item.group.cap}</span></th></tr>
              : <tr key={`row-${index}`}><td>{item.row[0]}</td><td>{item.row[1]}</td><td className="innovation-rule-score">{item.row[2]}</td></tr>)}
          </tbody>
        </table>
      </div>
      <div className="innovation-process">
        <div className="innovation-process-heading"><Info size={15} /><strong>认定流程与边界</strong></div>
        <div className="innovation-process-grid">
          <div><b>申请时间</b><span>每年秋季开学后 3 周内可申请一次；毕业资格审查前可申请最后一次。</span></div>
          <div><b>审核链路</b><span>班主任/辅导员初审，学院审核并公示，录入教务系统，材料由学院教务办公室存档。</span></div>
          <div><b>不能替代</b><span>证书、签到、论文或项目结题材料只是证明，不等于已经获得实践学分。</span></div>
          <div><b>重复认定</b><span>同一事项不能在不同项目中重复认定；竞赛和大创跨级别按手册规则取最高级别。</span></div>
        </div>
      </div>
      <p className="innovation-table-note"><Info size={13} />本页面是本地估算器，不读取学校正式认定结果，也不会代替申请、公示或教务系统入账。</p>
    </section>
  );
}
