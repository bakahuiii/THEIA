import { useState } from "react";

type DimKey = "moral" | "academic" | "sports" | "arts" | "labor";

const DIMS: Array<{ key: DimKey; label: string; max: number; color: string }> = [
  { key: "moral", label: "道德与思想素质", max: 180, color: "dim-moral" },
  { key: "academic", label: "学术与科技创新", max: 120, color: "dim-academic" },
  { key: "sports", label: "体育与身心健康", max: 100, color: "dim-sports" },
  { key: "arts", label: "美学与人文素养", max: 100, color: "dim-arts" },
  { key: "labor", label: "劳动与社会实践", max: 100, color: "dim-labor" },
];

export function SecondClassCalc() {
  const [scores, setScores] = useState<Record<DimKey, string>>({
    moral: "", academic: "", sports: "", arts: "", labor: "",
  });

  const set = (k: DimKey) => (v: string) => setScores(p => ({ ...p, [k]: v }));

  const nums = Object.fromEntries(
    DIMS.map(d => [d.key, Math.min(d.max, Math.max(0, parseFloat(scores[d.key] as string) || 0))])
  ) as Record<DimKey, number>;

  const total = Object.values(nums).reduce((a, b) => a + b, 0);
  const percent60 = (v: number, dim: DimKey) => {
    const max = DIMS.find(d => d.key === dim)!.max;
    return v >= max * 0.6;
  };

  // scholarship weights
  const scholarScore = (academic: number, second: number) =>
    academic * 0.7 + (second / 600) * 100 * 0.3;

  const [academic, setAcademic] = useState("");
  const academicNum = parseFloat(academic) || 0;
  const totalBelow60 = DIMS.some(d => !percent60(nums[d.key], d.key));

  return (
    <div className="second-class-calc">
      <section className="warning-section">
        <h3 className="warning-section-title">五维度评分</h3>
        <p className="warning-section-desc">满分 600 分，各维度上限不同</p>
        <div className="second-class-dims">
          {DIMS.map(dim => {
            const val = nums[dim.key];
            const pct = val / dim.max * 100;
            const below60 = !percent60(val, dim.key);
            return (
              <div key={dim.key} className={`second-class-dim ${dim.color}`}>
                <div className="second-class-dim-header">
                  <span className="second-class-dim-label">{dim.label}</span>
                  <span className="second-class-dim-max">上限 {dim.max}</span>
                </div>
                <div className="second-class-dim-input">
                  <input type="number" value={scores[dim.key]}
                    onChange={e => set(dim.key)(e.target.value)}
                    placeholder="0" min="0" max={dim.max} />
                  <span>/ {dim.max}</span>
                </div>
                <div className="second-class-bar">
                  <div className="second-class-bar-fill" style={{ width: `${pct}%` }} />
                  <div className="second-class-bar-60" />
                </div>
                {below60 && parseFloat(scores[dim.key]) > 0 && (
                  <span className="second-class-warn">低于 60% — 不计入奖学金评定</span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="warning-section">
        <div className="second-class-total-row">
          <span>第二课堂成绩合计</span>
          <strong className="second-class-total">{total} <small>/ 600</small></strong>
        </div>
        {totalBelow60 && (
          <div className="warning-alert danger">
            存在维度得分低于该维度满分 60%，该学期成绩<strong>不参与奖学金评定</strong>
          </div>
        )}
      </section>

      <section className="warning-section">
        <h3 className="warning-section-title">奖学金成绩估算</h3>
        <p className="warning-section-desc">
          人民奖学金 = 学习成绩 × 70% + 第二课堂成绩（换算百分制）× 30%
        </p>
        <label className="fitness-field">
          <span className="fitness-field-label">学习成绩（百分制）</span>
          <div className="fitness-field-input">
            <input type="number" value={academic} onChange={e => setAcademic(e.target.value)}
              placeholder="85" min="0" max="100" />
            <span className="fitness-field-unit">分</span>
          </div>
        </label>
        {academic && !totalBelow60 && (
          <div className="second-class-scholar-result">
            <span>奖学金综合成绩</span>
            <strong>{scholarScore(academicNum, total).toFixed(2)} 分</strong>
          </div>
        )}
        {totalBelow60 && academic && (
          <div className="warning-alert danger">
            第二课堂成绩不满足条件，本学期不参与奖学金评定
          </div>
        )}
        <div className="warning-note" style={{marginTop: 12}}>
          推免总成绩 = 学业成绩 × 80% + 第二课堂成绩 × 20%
        </div>
      </section>
    </div>
  );
}
