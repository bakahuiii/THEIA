import { useState } from "react";

// 升级标准：获得必修课总学分的比例
const PROMOTE_RULES = [
  { from: 1, to: 2, label: "一→二年级", ratio: 2/3, desc: "一年级必修课总学分的 2/3" },
  { from: 2, to: 3, label: "二→三年级", ratio: 3/4, desc: "一、二年级必修课总学分的 3/4" },
  { from: 3, to: 4, label: "三→四年级", ratio: 3/4, desc: "培养方案总学分的 3/4" },
];

export function WarningCalc() {
  const [gpa, setGpa] = useState("");
  const [year, setYear] = useState<1|2|3>(1);
  const [totalRequired, setTotalRequired] = useState("");
  const [earned, setEarned] = useState("");

  const gpaNum = parseFloat(gpa);
  const totalNum = parseFloat(totalRequired);
  const earnedNum = parseFloat(earned);

  const gpaWarning = !isNaN(gpaNum) && gpaNum > 0 && gpaNum < 2.00;
  const gpaOk = !isNaN(gpaNum) && gpaNum >= 2.00;

  const rule = PROMOTE_RULES[year - 1];
  const needed = !isNaN(totalNum) ? totalNum * rule.ratio : null;
  const hasEnough = needed !== null && !isNaN(earnedNum) ? earnedNum >= needed : null;

  const failThird = !isNaN(totalNum) && !isNaN(earnedNum) && year === 1
    ? earnedNum < totalNum / 3
    : null;

  return (
    <div className="warning-calc">
      <section className="warning-section">
        <h3 className="warning-section-title">GPA 预警</h3>
        <p className="warning-section-desc">最高平均学分绩点（GPA）低于 2.00 将被标注"无学位警示"</p>
        <label className="fitness-field">
          <span className="fitness-field-label">当前 GPA</span>
          <div className="fitness-field-input">
            <input type="number" value={gpa} onChange={e => setGpa(e.target.value)}
              placeholder="3.00" step="0.01" min="0" max="5" />
          </div>
        </label>
        {gpaWarning && (
          <div className="warning-alert danger">
            GPA {gpaNum.toFixed(2)} &lt; 2.00 — 存在<strong>无学位警示</strong>风险
          </div>
        )}
        {gpaOk && (
          <div className="warning-alert ok">GPA {gpaNum.toFixed(2)} ≥ 2.00，暂无学位警示</div>
        )}
      </section>

      <section className="warning-section">
        <h3 className="warning-section-title">升级达标判断</h3>
        <p className="warning-section-desc">每学年结束后评估是否满足升入下一年级的学分要求</p>
        <div className="warning-year-toggle">
          {([1,2,3] as const).map(y => (
            <button type="button" key={y} className={year === y ? "active" : ""}
              onClick={() => setYear(y)}>
              {PROMOTE_RULES[y-1].label}
            </button>
          ))}
        </div>
        <p className="warning-rule-desc">需获得{rule.desc}</p>
        <div className="fitness-inputs-grid">
          <label className="fitness-field">
            <span className="fitness-field-label">必修课总学分</span>
            <div className="fitness-field-input">
              <input type="number" value={totalRequired} onChange={e => setTotalRequired(e.target.value)}
                placeholder="60" step="0.5" />
              <span className="fitness-field-unit">学分</span>
            </div>
          </label>
          <label className="fitness-field">
            <span className="fitness-field-label">已获得学分</span>
            <div className="fitness-field-input">
              <input type="number" value={earned} onChange={e => setEarned(e.target.value)}
                placeholder="45" step="0.5" />
              <span className="fitness-field-unit">学分</span>
            </div>
          </label>
        </div>
        {needed !== null && !isNaN(earnedNum) && (
          <div className={`warning-alert ${hasEnough ? "ok" : "danger"}`}>
            {hasEnough
              ? `已获 ${earnedNum} 学分 ≥ 所需 ${needed.toFixed(1)} 学分 — 满足升级要求`
              : `已获 ${earnedNum} 学分 < 所需 ${needed.toFixed(1)} 学分 — 差 ${(needed - earnedNum).toFixed(1)} 学分，存在退学警示风险`
            }
          </div>
        )}
        {failThird === true && (
          <div className="warning-alert danger">
            已获学分不足一年级必修课总学分的 1/3，达到<strong>退学</strong>标准
          </div>
        )}
      </section>

      <section className="warning-section">
        <h3 className="warning-section-title">退学条件说明</h3>
        <ul className="warning-list">
          <li>一年级结束时，获得的必修课学分 &lt; 总学分 1/3</li>
          <li>连续 2 次或累计 3 次无法按期升级</li>
          <li>毕业学期不及格必修课 ≥ 10 学分且门次 ≥ 3</li>
        </ul>
        <p className="warning-note">警示一般在秋季学期开学一个月内完成</p>
      </section>
    </div>
  );
}
