import { useState } from "react";

type ActivityItem = {
  id: string; label: string; category: "course" | "practice";
  credits: number; note?: string;
};

const PRACTICE_OPTIONS: ActivityItem[] = [
  { id: "mentor", label: "本科生导师制", category: "practice", credits: 1 },
  { id: "comp_nat", label: "学科竞赛（国家级奖）", category: "practice", credits: 2 },
  { id: "comp_prov", label: "学科竞赛（省部级奖）", category: "practice", credits: 1.5 },
  { id: "comp_school", label: "学科竞赛（校级奖）", category: "practice", credits: 1 },
  { id: "sci_prize", label: "科技成果获奖", category: "practice", credits: 1 },
  { id: "patent", label: "申请专利（发明专利授权）", category: "practice", credits: 2 },
  { id: "patent2", label: "申请专利（实用新型/外观设计）", category: "practice", credits: 1 },
  { id: "paper_ei", label: "发表论文（EI/SCI）", category: "practice", credits: 2 },
  { id: "paper_core", label: "发表论文（核心期刊）", category: "practice", credits: 1.5 },
  { id: "paper_other", label: "发表论文（其他公开刊物）", category: "practice", credits: 1 },
  { id: "lecture", label: "学术讲座或报告（备案）", category: "practice", credits: 0.5, note: "每次" },
  { id: "cert", label: "职业认证（国家级）", category: "practice", credits: 2 },
  { id: "cert2", label: "职业认证（其他）", category: "practice", credits: 1 },
  { id: "startup", label: "自主创业（备案）", category: "practice", credits: 2 },
  { id: "cross", label: "学科交叉班", category: "practice", credits: 1 },
  { id: "srtp_nat", label: "大创项目（国家级结题）", category: "practice", credits: 2 },
  { id: "srtp_prov", label: "大创项目（省级结题）", category: "practice", credits: 1.5 },
  { id: "srtp_school", label: "大创项目（校级结题）", category: "practice", credits: 1 },
];

export function InnovationCalc() {
  const [courseCredits, setCourseCredits] = useState("");
  const [selected, setSelected] = useState<Record<string, number>>({});

  const toggle = (id: string, base: number) => {
    setSelected(prev => {
      const next = { ...prev };
      if (next[id] !== undefined) { delete next[id]; } else { next[id] = base; }
      return next;
    });
  };
  const setCount = (id: string, base: number, n: number) => {
    setSelected(prev => ({ ...prev, [id]: base * Math.max(0, n) }));
  };

  const courseNum = parseFloat(courseCredits) || 0;
  const practiceTotal = Object.entries(selected).reduce((sum, [, v]) => sum + v, 0);
  const total = courseNum + practiceTotal;
  const courseMet = courseNum >= 2;
  const practiceMet = practiceTotal >= 2;
  const totalMet = total >= 4;

  return (
    <div className="innovation-calc">
      <section className="warning-section">
        <h3 className="warning-section-title">毕业要求</h3>
        <div className="innovation-req-row">
          <div className={`innovation-req-badge ${courseMet ? "met" : "unmet"}`}>
            课程学分 ≥ 2<br/><span>已填 {courseNum.toFixed(1)}</span>
          </div>
          <div className={`innovation-req-badge ${practiceMet ? "met" : "unmet"}`}>
            实践学分 ≥ 2<br/><span>已计 {practiceTotal.toFixed(1)}</span>
          </div>
          <div className={`innovation-req-badge ${totalMet ? "met" : "unmet"} total`}>
            合计 ≥ 4<br/><span>{total.toFixed(1)} 学分</span>
          </div>
        </div>
      </section>

      <section className="warning-section">
        <h3 className="warning-section-title">创新创业类课程学分</h3>
        <label className="fitness-field">
          <span className="fitness-field-label">已修课程学分</span>
          <div className="fitness-field-input">
            <input type="number" value={courseCredits}
              onChange={e => setCourseCredits(e.target.value)}
              placeholder="2" step="0.5" min="0" />
            <span className="fitness-field-unit">学分</span>
          </div>
        </label>
      </section>

      <section className="warning-section">
        <h3 className="warning-section-title">创新创业实践学分</h3>
        <p className="warning-section-desc">选择已获认定的实践项目（每年秋季开学后 3 周内认定）</p>
        <div className="innovation-options">
          {PRACTICE_OPTIONS.map(opt => {
            const countable = opt.note === "每次";
            const isSelected = selected[opt.id] !== undefined;
            const count = isSelected ? Math.round(selected[opt.id] / opt.credits) : 0;
            return (
              <div key={opt.id} className={`innovation-option ${isSelected ? "selected" : ""}`}>
                <button type="button" className="innovation-option-btn"
                  onClick={() => toggle(opt.id, opt.credits)}>
                  <span className="innovation-option-check">{isSelected ? "✓" : ""}</span>
                  <span className="innovation-option-label">{opt.label}</span>
                  <span className="innovation-option-credits">+{opt.credits} 学分{opt.note ? `/${opt.note}` : ""}</span>
                </button>
                {countable && isSelected && (
                  <div className="innovation-count-row">
                    <button type="button" onClick={() => setCount(opt.id, opt.credits, count - 1)}>−</button>
                    <span>{count} 次</span>
                    <button type="button" onClick={() => setCount(opt.id, opt.credits, count + 1)}>+</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="innovation-practice-total">
          实践学分合计：<strong>{practiceTotal.toFixed(1)}</strong> 学分
        </div>
      </section>
    </div>
  );
}
