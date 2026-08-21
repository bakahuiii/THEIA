import { useMemo, useState } from "react";
import { AlertTriangle, BookOpen, Calculator, CheckCircle2, Info, Table2 } from "lucide-react";

type DimKey = "moral" | "academic" | "sports" | "arts" | "labor";
type SectionKey = "basic" | "extension";
type ViewKey = "calculator" | "rules";

type Dimension = {
  key: DimKey;
  axis: string;
  label: string;
  shortLabel: string;
  max: number;
  color: string;
  summary: string;
};

type RuleRow = {
  dimension: DimKey;
  section: SectionKey;
  item: string;
  score: string;
  note?: string;
};

const DIMS: Dimension[] = [
  { key: "moral", axis: "德", label: "道德与思想素质", shortLabel: "思想品德", max: 180, color: "dim-moral", summary: "政治素养、德育活动、青年大学习、行为规范与荣誉" },
  { key: "academic", axis: "智", label: "学术与科技创新", shortLabel: "学术创新", max: 120, color: "dim-academic", summary: "竞赛、大创、学术活动、讲座、学习表现与成果" },
  { key: "sports", axis: "体", label: "体育与身心健康", shortLabel: "体育健康", max: 100, color: "dim-sports", summary: "体育竞赛、心理活动、奔跑在北化、体测与健身认定" },
  { key: "arts", axis: "美", label: "美学与人文素养", shortLabel: "美育人文", max: 100, color: "dim-arts", summary: "美育活动、讲座、艺术慕课、比赛、展演与作品" },
  { key: "labor", axis: "劳", label: "劳动与社会实践", shortLabel: "劳育实践", max: 100, color: "dim-labor", summary: "劳动、志愿、社会实践、宿舍卫生、荣誉与作品" },
];

const SECTION_META: Record<SectionKey, { label: string; ratio: string; description: string }> = {
  basic: { label: "基础评定", ratio: "80%", description: "每个维度总上限的 80%，以学期过程活动为主" },
  extension: { label: "拓展评定", ratio: "20%", description: "每个维度总上限的 20%，以竞赛、荣誉和成果为主" },
};

const RULE_ROWS: RuleRow[] = [
  { dimension: "moral", section: "basic", item: "班级民主评议", score: "35 / 25 分", note: "按评议等级计一档，不叠加" },
  { dimension: "moral", section: "basic", item: "宏德讲坛、院周、主题党团日等德育活动", score: "10 分/次", note: "基础上限 50 分" },
  { dimension: "moral", section: "basic", item: "青年大学习", score: "35 分满分；缺勤 -3 分/次", note: "扣完为止" },
  { dimension: "moral", section: "basic", item: "学生行为准则", score: "40 分满分；违规 -20 分/次", note: "严重餐饮浪费、吸烟、垃圾分类、大功率电器、实验室安全等" },
  { dimension: "moral", section: "basic", item: "纪律处分扣分", score: "警告 -80；严重警告 -100；记过 -120；留校察看 -144", note: "扣完为止" },
  { dimension: "moral", section: "extension", item: "德育荣誉、先进榜样、主题宣讲团", score: "国家 30；省部 24；地市 20；校级 16；院级 5 分/项", note: "同类只取最高；集体按半数；上限 30 分" },
  { dimension: "moral", section: "extension", item: "学生组织、社团、班级服务", score: "优秀 20；称职 10 分", note: "各项不累加；上限 20 分" },
  { dimension: "moral", section: "extension", item: "拾金不昧、义务献血、见义勇为、应急事件贡献", score: "20 分/项" },
  { dimension: "moral", section: "extension", item: "公开刊物或校级以上媒体发表德育文章/作品", score: "10 分/项" },

  { dimension: "academic", section: "basic", item: "学术科技/创新创业竞赛完赛作品，萌芽杯或大创结题，创业实训", score: "25 分/项", note: "基础评定上限 96 分" },
  { dimension: "academic", section: "basic", item: "学术科技、创新创业相关活动", score: "15 分/次", note: "上限 30 分" },
  { dimension: "academic", section: "basic", item: "学术科技、创新创业专题讲座/报告", score: "6 分/次", note: "上限 24 分" },
  { dimension: "academic", section: "basic", item: "学习活动与自主学习", score: "30 分满分；无故缺课 -5 分/学时", note: "扣完为止" },
  { dimension: "academic", section: "extension", item: "学科竞赛：国家级", score: "一等奖 15；二等奖 12；三等奖 9；优秀奖 7 分", note: "特等奖按一等奖；同一作品取最高；集体按半数" },
  { dimension: "academic", section: "extension", item: "学科竞赛：省级", score: "一等奖 12；二等奖 9；三等奖 7；优秀奖 5 分" },
  { dimension: "academic", section: "extension", item: "学科竞赛：市级", score: "一等奖 9；二等奖 7；三等奖 5；优秀奖 3 分" },
  { dimension: "academic", section: "extension", item: "学科竞赛：校级", score: "一等奖 7；二等奖 5；三等奖 3；优秀奖 2 分" },
  { dimension: "academic", section: "extension", item: "学科竞赛：院级", score: "一等奖 5；二等奖 3；三等奖 2；优秀奖 1 分" },
  { dimension: "academic", section: "extension", item: "挑战杯、互联网+等全国性重大赛事认定奖项", score: "本节满分 24 分", note: "须经教务处认定" },
  { dimension: "academic", section: "extension", item: "大学生创新创业训练计划", score: "按对应竞赛等级一等奖计分", note: "集体按半数；上限 20 分" },
  { dimension: "academic", section: "extension", item: "教务处认定的论文、专利等学术成果", score: "20 分/项" },

  { dimension: "sports", section: "basic", item: "体育类竞赛：组织者或运动员", score: "10 分/次", note: "上限 20 分" },
  { dimension: "sports", section: "basic", item: "体育类竞赛：观众", score: "2 分/次", note: "与上项合计上限 20 分" },
  { dimension: "sports", section: "basic", item: "体育或心理健康类活动", score: "10 分/次", note: "上限 20 分" },
  { dimension: "sports", section: "basic", item: "奔跑在北化", score: "完成学期打卡计划 30 分" },
  { dimension: "sports", section: "basic", item: "国家学生体质健康测试", score: "合格或免测 20；不合格 0 分" },
  { dimension: "sports", section: "extension", item: "体育竞赛：国际级", score: "一等奖 20；二等奖 18；三等奖 16；优秀奖 14 分", note: "集体按半数；拓展上限 20 分" },
  { dimension: "sports", section: "extension", item: "体育竞赛：国家级", score: "一等奖 16；二等奖 14；三等奖 12；优秀奖 10 分" },
  { dimension: "sports", section: "extension", item: "体育竞赛：省级", score: "一等奖 12；二等奖 10；三等奖 8；优秀奖 6 分" },
  { dimension: "sports", section: "extension", item: "体育竞赛：市级", score: "一等奖 10；二等奖 8；三等奖 6；优秀奖 4 分" },
  { dimension: "sports", section: "extension", item: "体育竞赛：校级", score: "一等奖 8；二等奖 6；三等奖 4；优秀奖 2 分" },
  { dimension: "sports", section: "extension", item: "体育竞赛：院级", score: "一等奖 6；二等奖 4；三等奖 2；优秀奖 1 分" },
  { dimension: "sports", section: "extension", item: "班级民主健身认定", score: "15 / 10 分", note: "按认定等级计一档" },
  { dimension: "sports", section: "extension", item: "公开刊物或校级以上媒体发表体育/心理文章或作品", score: "10 分/项" },

  { dimension: "arts", section: "basic", item: "美育活动：演员、展览作者、参赛者", score: "10 分/次", note: "基础上限 30 分" },
  { dimension: "arts", section: "basic", item: "美育活动：观众等参与者", score: "5 分/次", note: "与上项合计上限 30 分" },
  { dimension: "arts", section: "basic", item: "美育专题讲座/报告（含课程理论教学）", score: "10 分/次", note: "上限 30 分" },
  { dimension: "arts", section: "basic", item: "艺术类慕课：音乐、美术、书法、舞蹈、戏剧等", score: "5 分/学时", note: "上限 30 分" },
  { dimension: "arts", section: "extension", item: "美育比赛：国际/国家级", score: "一等奖 20；二等奖 18；三等奖 16；优秀奖 13 分", note: "特等奖按一等奖；集体按半数" },
  { dimension: "arts", section: "extension", item: "美育比赛：省部级", score: "一等奖 18；二等奖 16；三等奖 13；优秀奖 10 分" },
  { dimension: "arts", section: "extension", item: "美育比赛：市级", score: "一等奖 16；二等奖 13；三等奖 10；优秀奖 8 分" },
  { dimension: "arts", section: "extension", item: "美育比赛：校级", score: "一等奖 13；二等奖 10；三等奖 8；优秀奖 5 分" },
  { dimension: "arts", section: "extension", item: "美育比赛：院级", score: "一等奖 10；二等奖 8；三等奖 5；优秀奖 3 分" },
  { dimension: "arts", section: "extension", item: "个人艺术作品展览或个人公演", score: "20 分/项", note: "须经相关部门认定" },
  { dimension: "arts", section: "extension", item: "美育场馆或基地展览、实践活动", score: "4 分/次", note: "上限 20 分" },
  { dimension: "arts", section: "extension", item: "公开刊物或校级以上媒体发表美育文章/作品", score: "10 分/项" },

  { dimension: "labor", section: "basic", item: "劳动实践（含劳育课程实践）", score: "每学期满 10 小时计 20 分；不足 10 小时 0 分" },
  { dimension: "labor", section: "basic", item: "志愿服务", score: "每学期满 10 小时计 20 分；不足 10 小时 0 分" },
  { dimension: "labor", section: "basic", item: "寒暑期社会实践", score: "完成任务并提交实践报告 15 分" },
  { dimension: "labor", section: "basic", item: "劳动实践类讲座/报告（含课程理论教学）", score: "5 分/次", note: "上限 15 分" },
  { dimension: "labor", section: "basic", item: "宿舍卫生：优（90 分以上）", score: "20 分/人" },
  { dimension: "labor", section: "basic", item: "宿舍卫生：良（80–90 分）", score: "16 分/人" },
  { dimension: "labor", section: "basic", item: "宿舍卫生：中（70–80 分）", score: "12 分/人" },
  { dimension: "labor", section: "basic", item: "宿舍卫生：合格（60–70 分）", score: "10 分/人" },
  { dimension: "labor", section: "basic", item: "宿舍卫生：不合格（60 分以下）", score: "0 分/人" },
  { dimension: "labor", section: "extension", item: "志愿服务/劳动实践荣誉", score: "国家 10；省部 8；地市 6；校级 4；院级 2 分", note: "只取最高项；上限 10 分" },
  { dimension: "labor", section: "extension", item: "社会实践荣誉", score: "国家 10；省部 8；地市 6；校级 4；院级 2 分", note: "只取最高项；集体成员按相应分数；上限 10 分" },
  { dimension: "labor", section: "extension", item: "宿舍荣誉：市级及以上、校级、院级", score: "5 / 3 / 2 分/人", note: "只取最高项；上限 5 分" },
  { dimension: "labor", section: "extension", item: "超额志愿服务时长", score: "超过 10 小时部分 0.5 分/小时", note: "上限 5 分" },
  { dimension: "labor", section: "extension", item: "超额劳动实践时长", score: "超过 10 小时部分 0.5 分/小时", note: "上限 5 分" },
  { dimension: "labor", section: "extension", item: "公开刊物或校级以上媒体发表劳动实践文章/作品", score: "10 分/项" },
];

const emptyScores = (): Record<DimKey, Record<SectionKey, string>> => ({
  moral: { basic: "", extension: "" },
  academic: { basic: "", extension: "" },
  sports: { basic: "", extension: "" },
  arts: { basic: "", extension: "" },
  labor: { basic: "", extension: "" },
});

const numberValue = (value: string, max: number): number => {
  if (value.trim() === "") return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(max, Math.max(0, parsed));
};

const formatScore = (value: number): string => Number.isInteger(value) ? String(value) : value.toFixed(1);

export function SecondClassCalc() {
  const [view, setView] = useState<ViewKey>("calculator");
  const [ruleDimension, setRuleDimension] = useState<DimKey>("moral");
  const [scores, setScores] = useState<Record<DimKey, Record<SectionKey, string>>>(emptyScores);
  const [academic, setAcademic] = useState("");

  const values = useMemo(() => Object.fromEntries(DIMS.map((dimension) => {
    const basicMax = dimension.max * 0.8;
    const extensionMax = dimension.max * 0.2;
    const basic = numberValue(scores[dimension.key].basic, basicMax);
    const extension = numberValue(scores[dimension.key].extension, extensionMax);
    return [dimension.key, { basic, extension, total: basic + extension, basicMax, extensionMax }];
  })) as Record<DimKey, { basic: number; extension: number; total: number; basicMax: number; extensionMax: number }>, [scores]);

  const total = DIMS.reduce((sum, dimension) => sum + values[dimension.key].total, 0);
  const basicTotal = DIMS.reduce((sum, dimension) => sum + values[dimension.key].basic, 0);
  const extensionTotal = DIMS.reduce((sum, dimension) => sum + values[dimension.key].extension, 0);
  const hasScoreInput = DIMS.some((dimension) => scores[dimension.key].basic.trim() !== "" || scores[dimension.key].extension.trim() !== "");
  const allDimensionsEntered = DIMS.every((dimension) => scores[dimension.key].basic.trim() !== "" && scores[dimension.key].extension.trim() !== "");
  const totalThreshold = 600 * 0.6;
  const scholarshipEligible = allDimensionsEntered && total >= totalThreshold;
  const academicNum = Number(academic);
  const hasAcademicInput = academic.trim() !== "" && Number.isFinite(academicNum);
  const secondAsPercentage = total / 600 * 100;
  const scholarshipScore = academicNum * 0.7 + secondAsPercentage * 0.3;
  const recommendationScore = academicNum * 0.8 + secondAsPercentage * 0.2;
  const selectedDimension = DIMS.find((dimension) => dimension.key === ruleDimension) ?? DIMS[0];
  const selectedRules = RULE_ROWS.filter((row) => row.dimension === selectedDimension.key);

  const setScore = (dimension: DimKey, section: SectionKey, value: string) => {
    setScores((previous) => ({
      ...previous,
      [dimension]: { ...previous[dimension], [section]: value },
    }));
  };

  return (
    <div className="second-class-calc">
      <section className="second-class-hero">
        <div className="second-class-hero-copy">
          <div className="second-class-kicker"><BookOpen size={14} />本科生手册规则参考</div>
          <h2>第二课堂估算器</h2>
          <p>按学期记录五个维度的基础评定和拓展评定。这里是本地估算与规则查询，不是学校正式成绩单。</p>
        </div>
        <div className="second-class-hero-total"><span>总分上限</span><strong>600</strong><small>基础 480 · 拓展 120</small></div>
      </section>

      <div className="second-class-view-tabs" role="tablist" aria-label="第二课堂工具">
        <button type="button" className={view === "calculator" ? "active" : ""} role="tab" aria-selected={view === "calculator"} onClick={() => setView("calculator")}><Calculator size={15} />分数估算</button>
        <button type="button" className={view === "rules" ? "active" : ""} role="tab" aria-selected={view === "rules"} onClick={() => setView("rules")}><Table2 size={15} />详细分值表</button>
      </div>

      {view === "calculator" ? (
        <>
          <section className="second-class-summary-grid" aria-label="第二课堂汇总">
            <div><span>当前录入</span><strong>{hasScoreInput ? `${formatScore(total)} / 600` : "未录入"}</strong><small>{hasScoreInput ? `${allDimensionsEntered ? "完整录入" : "部分录入"} · 基础 ${formatScore(basicTotal)} · 拓展 ${formatScore(extensionTotal)}` : "空白不代表 0 分"}</small></div>
            <div><span>奖学金门槛</span><strong>{allDimensionsEntered ? `${formatScore(totalThreshold)} 分` : hasScoreInput ? "待补全" : "待录入"}</strong><small>完整录入后按总成绩的 60% 判断</small></div>
            <div><span>美育 / 劳育</span><strong>单独认定</strong><small>不能用第二课堂分数自行换算学分</small></div>
          </section>

          <section className="second-class-notice"><Info size={16} /><div><strong>先分清两个层级</strong><span>基础评定占本维度上限的 80%，拓展评定占 20%。每个输入框只填该层级的分数；分值依据见“详细分值表”。</span></div></section>

          <section className="warning-section">
            <div className="second-class-section-heading"><div><h3 className="warning-section-title">五维度评分</h3><p className="warning-section-desc">每个维度单独封顶，空白状态保持“未录入”。</p></div><span className="second-class-rule-tag">2023 手册规则</span></div>
            <div className="second-class-dims">
              {DIMS.map((dimension) => {
                const value = values[dimension.key];
                const percentage = value.total / dimension.max * 100;
                const hasDimensionInput = scores[dimension.key].basic.trim() !== "" || scores[dimension.key].extension.trim() !== "";
                return (
                  <article key={dimension.key} className={`second-class-dim ${dimension.color}`}>
                    <div className="second-class-dim-header"><div><span className="second-class-dim-label">{dimension.label}</span><small>{dimension.summary}</small></div><span className="second-class-dim-max">上限 {dimension.max}</span></div>
                    <div className="second-class-score-inputs">
                      {(["basic", "extension"] as SectionKey[]).map((section) => {
                        const max = section === "basic" ? value.basicMax : value.extensionMax;
                        return <label key={section}><span>{SECTION_META[section].label}</span><div><input type="number" value={scores[dimension.key][section]} onChange={(event) => setScore(dimension.key, section, event.target.value)} placeholder="未录入" min="0" max={max} step="0.1" aria-label={`${dimension.label}${SECTION_META[section].label}`} /><em>/ {formatScore(max)}</em></div></label>;
                      })}
                    </div>
                    <div className="second-class-bar" aria-label={`${dimension.label} ${formatScore(value.total)} 分，共 ${dimension.max} 分`}><div className="second-class-bar-fill" style={{ width: `${Math.min(100, percentage)}%` }} /></div>
                    <div className="second-class-dim-footer"><span>合计 {hasDimensionInput ? `${formatScore(value.total)} / ${dimension.max}` : "未录入"}</span><span>{hasDimensionInput ? `${Math.round(percentage)}%` : "-"}</span></div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="warning-section">
            <div className="second-class-total-row"><div><span>第二课堂成绩合计</span><small>{hasScoreInput ? `基础 ${formatScore(basicTotal)} / 480 · 拓展 ${formatScore(extensionTotal)} / 120` : "输入任意维度后开始估算"}</small></div><strong className="second-class-total">{hasScoreInput ? formatScore(total) : "--"} <small>/ 600</small></strong></div>
            {hasScoreInput && <div className={`second-class-threshold ${!allDimensionsEntered ? "pending" : scholarshipEligible ? "ok" : "danger"}`}><span>{!allDimensionsEntered ? <Info size={15} /> : scholarshipEligible ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}</span><div><strong>{!allDimensionsEntered ? "第二课堂数据尚未录入完整" : scholarshipEligible ? "已达到人民奖学金第二课堂门槛" : "尚未达到人民奖学金第二课堂门槛"}</strong><small>{!allDimensionsEntered ? "请补齐五个维度的基础和拓展分数，再判断 360 分门槛。空白维度不等于 0 分。" : "手册条件：该学期第二课堂总成绩达到 600 分的 60%，即 360 分。最终资格还要看学习成绩、宿舍卫生和纪律处分。"}</small></div></div>}
          </section>

          <section className="warning-section">
            <div className="second-class-section-heading"><div><h3 className="warning-section-title">奖学金与推免估算</h3><p className="warning-section-desc">仅按已录入的第二课堂总分换算百分制；不代表学院或学校最终评审结果。</p></div><span className="second-class-rule-tag">手工估算</span></div>
            <label className="fitness-field"><span className="fitness-field-label">学习成绩（百分制）</span><div className="fitness-field-input"><input type="number" value={academic} onChange={(event) => setAcademic(event.target.value)} placeholder="例如 85" min="0" max="100" step="0.01" /><span className="fitness-field-unit">分</span></div></label>
            <div className="second-class-formula-grid"><div><span>人民奖学金综合成绩</span><strong>{hasAcademicInput && allDimensionsEntered ? `${scholarshipScore.toFixed(2)} 分` : "待补齐数据"}</strong><small>学习成绩 × 70% + 第二课堂百分制 × 30%</small></div><div><span>推免总成绩参考</span><strong>{hasAcademicInput && allDimensionsEntered ? `${recommendationScore.toFixed(2)} 分` : "待补齐数据"}</strong><small>学业成绩 × 80% + 第二课堂百分制 × 20%</small></div></div>
            {hasAcademicInput && !allDimensionsEntered && <div className="second-class-inline-note"><Info size={14} />请补齐五个维度的基础和拓展分数，再计算综合成绩。</div>}
          </section>
        </>
      ) : (
        <section className="warning-section second-class-rules-section">
          <div className="second-class-section-heading"><div><h3 className="warning-section-title">第二课堂各项目详细分值</h3><p className="warning-section-desc">先选择德、智、体、美、劳中的一个维度；基础评定在上，拓展评定在下，项目分值和认定说明逐项展开。</p></div><span className="second-class-rule-count">{selectedRules.length} 项规则</span></div>
          <div className="second-class-dimension-tabs" role="tablist" aria-label="第二课堂五个维度">
            {DIMS.map((dimension) => {
              const count = RULE_ROWS.filter((row) => row.dimension === dimension.key).length;
              return <button key={dimension.key} type="button" className={`second-class-dimension-tab ${dimension.color} ${ruleDimension === dimension.key ? "active" : ""}`} role="tab" aria-selected={ruleDimension === dimension.key} aria-controls={`second-class-rules-panel-${dimension.key}`} onClick={() => setRuleDimension(dimension.key)}><strong>{dimension.axis}</strong><span>{dimension.shortLabel}</span><small>{dimension.max} 分 · {count} 项</small></button>;
            })}
          </div>
          <div id={`second-class-rules-panel-${selectedDimension.key}`} className={`second-class-rules-panel ${selectedDimension.color}`} role="tabpanel" aria-label={`${selectedDimension.label}详细分值`}>
            <div className="second-class-rules-panel-header"><div className="second-class-rules-panel-title"><span className={`second-class-rule-dot ${selectedDimension.color}`} /><div><span>当前维度</span><h4>{selectedDimension.label}</h4><p>{selectedDimension.summary}</p></div></div><div className="second-class-rules-panel-total"><span>维度上限</span><strong>{selectedDimension.max}</strong><small>基础 {formatScore(selectedDimension.max * 0.8)} · 拓展 {formatScore(selectedDimension.max * 0.2)}</small></div></div>
            <div className="second-class-rule-groups">
              {(["basic", "extension"] as SectionKey[]).map((section) => {
                const sectionRules = selectedRules.filter((row) => row.section === section);
                const sectionMax = selectedDimension.max * (section === "basic" ? 0.8 : 0.2);
                return <section key={section} className={`second-class-rule-group ${section}`}>
                  <div className="second-class-rule-group-header"><div><span className={`second-class-section-badge ${section}`}>{SECTION_META[section].label}</span><h4>{SECTION_META[section].description}</h4></div><span>{sectionRules.length} 项 · 上限 {formatScore(sectionMax)} 分</span></div>
                  <div className="second-class-rule-card-list">
                    {sectionRules.map((row, index) => <article key={`${row.dimension}-${row.section}-${index}`} className="second-class-rule-card"><div className="second-class-rule-card-main"><strong>{row.item}</strong><span className="second-class-rule-score">{row.score}</span></div><div className="second-class-rule-detail"><Info size={13} /><span><b>认定说明</b>{row.note ?? "具体叠加、重复认定和材料要求以当学期学院公示为准。"}</span></div></article>)}
                  </div>
                </section>;
              })}
            </div>
          </div>
          <div className="second-class-table-note"><Info size={14} /><span>表内分值按 2023 版本科生手册整理；最终以当学期学院公示、审核结果和学校系统录入为准。</span></div>
        </section>
      )}
    </div>
  );
}
