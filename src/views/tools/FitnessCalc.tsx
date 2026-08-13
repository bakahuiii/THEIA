import { useCallback, useEffect, useState } from "react";
import { bridge } from "../../bridge";
import type { FitnessScoreResult, LocalDataCatalog } from "../../types";

type Grade = "12" | "34";
type Gender = "male" | "female";
type FitnessYear = NonNullable<FitnessScoreResult["availableYears"]>[number];

const SCORE_LEVELS = [100,95,90,85,80,78,76,74,72,70,68,66,64,62,60,50,40,30,20,10] as const;

// BMI
function scoreBmi(bmi: number, gender: Gender): number {
  const normalMin = gender === "male" ? 17.9 : 17.2;
  if (bmi >= normalMin && bmi <= 23.9) return 100;
  if (bmi >= 28) return 60;
  return 80;
}

// High-is-better lookup
function lookupHigh(value: number, thresholds: number[]): number {
  for (let i = 0; i < SCORE_LEVELS.length; i++) {
    if (value >= thresholds[i]) return SCORE_LEVELS[i];
  }
  return SCORE_LEVELS[SCORE_LEVELS.length - 1];
}

// Low-is-better lookup
function lookupLow(value: number, thresholds: number[]): number {
  for (let i = 0; i < SCORE_LEVELS.length; i++) {
    if (value <= thresholds[i]) return SCORE_LEVELS[i];
  }
  return SCORE_LEVELS[SCORE_LEVELS.length - 1];
}

// 肺活量 mL [100,95,...,10]
const VITAL_M12 = [5040,4920,4800,4550,4300,4180,4060,3940,3820,3700,3580,3460,3340,3220,3100,2940,2780,2620,2460,2300];
const VITAL_F12 = [3400,3350,3300,3150,3000,2900,2800,2700,2600,2500,2400,2300,2200,2100,2000,1960,1920,1880,1840,1800];
const VITAL_M34 = [5140,5020,4900,4650,4400,4280,4160,4040,3920,3800,3680,3560,3440,3320,3200,3030,2860,2690,2520,2350];
const VITAL_F34 = [3450,3400,3350,3200,3050,2950,2850,2750,2650,2550,2450,2350,2250,2150,2050,2010,1970,1930,1890,1850];

// 50m run seconds [100,95,...,10]
const RUN50_M12 = [6.7,6.8,6.9,7.0,7.1,7.3,7.5,7.7,7.9,8.1,8.3,8.5,8.7,8.9,9.1,9.3,9.5,9.7,9.9,10.1];
const RUN50_F12 = [7.5,7.6,7.7,8.0,8.3,8.5,8.7,8.9,9.1,9.3,9.5,9.7,9.9,10.1,10.3,10.5,10.7,10.9,11.1,11.3];
const RUN50_M34 = [6.6,6.7,6.8,6.9,7.0,7.2,7.4,7.6,7.8,8.0,8.2,8.4,8.6,8.8,9.0,9.2,9.4,9.6,9.8,10.0];
const RUN50_F34 = [7.4,7.5,7.6,7.9,8.2,8.4,8.6,8.8,9.0,9.2,9.4,9.6,9.8,10.0,10.2,10.4,10.6,10.8,11.0,11.2];

// 坐位体前屈 cm
const FLEX_M12 = [24.9,23.1,21.3,19.5,17.7,16.3,14.9,13.5,12.1,10.7,9.3,7.9,6.5,5.1,3.7,2.7,1.7,0.7,-0.3,-1.3];
const FLEX_F12 = [25.8,24.0,22.2,20.6,19.0,17.7,16.4,15.1,13.8,12.5,11.2,9.9,8.6,7.3,6.0,5.2,4.4,3.6,2.8,2.0];
const FLEX_M34 = [25.1,23.3,21.5,19.9,18.2,16.8,15.4,14.0,12.6,11.2,9.8,8.4,7.0,5.6,4.2,3.2,2.2,1.2,0.2,-0.8];
const FLEX_F34 = [26.3,24.4,22.4,21.0,19.5,18.2,16.9,15.6,14.3,13.0,11.7,10.4,9.1,7.8,6.5,5.7,4.9,4.1,3.3,2.5];

// 立定跳远 cm
const JUMP_M12 = [273,268,263,256,248,244,240,236,232,228,224,220,216,212,208,203,198,193,188,183];
const JUMP_F12 = [207,201,195,188,181,178,175,172,169,166,163,160,157,154,151,146,141,136,131,126];
const JUMP_M34 = [275,270,265,258,250,246,242,238,234,230,226,222,218,214,210,205,200,195,190,185];
const JUMP_F34 = [208,202,196,189,182,179,176,173,170,167,164,161,158,155,152,147,142,137,132,127];

// 引体向上(男)/仰卧起坐(女) 次
const PULL_M12 = [19,18,17,16,15,14,14,13,13,12,12,11,11,10,10,9,8,7,6,5];
const PULL_M34 = [20,19,18,17,16,15,15,14,14,13,13,12,12,11,11,10,9,8,7,6];
const SITUP_F12 = [56,54,52,49,46,44,42,40,38,36,34,32,30,28,26,24,22,20,18,16];
const SITUP_F34 = [57,55,53,50,47,45,43,41,39,37,35,33,31,29,27,25,23,21,19,17];

// 1000m/800m 耐力跑 in seconds
const ENDURE_M12 = [197,202,207,214,222,227,232,237,242,247,252,257,262,267,272,292,312,332,352,372];
const ENDURE_F12 = [198,204,210,217,224,229,234,239,244,249,254,259,264,269,274,284,294,304,314,324];
const ENDURE_M34 = [195,200,205,212,220,225,230,235,240,245,250,255,260,265,270,285,310,330,350,370];
const ENDURE_F34 = [196,202,208,215,222,227,232,237,242,247,252,257,262,267,272,282,292,302,312,322];

// 加分表 bonus for pullup/situp (≥N reps beyond 100pt mark → bonus)
// Table shows absolute thresholds for bonus points
// Male pullup: 100pt mark = 19(12) / 20(34); bonus if > that
const PULLUP_BONUS_M12 = [10,9,8,7,6,5,4,3,2,1]; // reps needed beyond 19 for +10,+9,...,+1
const PULLUP_BONUS_M34 = [10,9,8,7,6,5,4,3,2,1]; // reps needed beyond 20
// Female situp: 100pt mark = 56(12) / 57(34)
const SITUP_BONUS_F12 = [13,12,11,10,9,8,7,6,4,2]; // extra beyond 56
const SITUP_BONUS_F34 = [13,12,11,10,9,8,7,6,4,2]; // extra beyond 57
// 1000m bonus: seconds FASTER than 100pt mark
const ENDURE_BONUS_M12 = [35,32,29,26,23,20,16,12,8,4];
const ENDURE_BONUS_M34 = [35,32,29,26,23,20,16,12,8,4];
const ENDURE_BONUS_F12 = [50,45,40,35,30,25,20,15,10,5];
const ENDURE_BONUS_F34 = [50,45,40,35,30,25,20,15,10,5];

function calcBonus(value: number, baseline: number, bonusThresholds: number[], isLower: boolean): number {
  // isLower=true means lower value is better (running)
  for (let i = 0; i < bonusThresholds.length; i++) {
    if (isLower ? (baseline - value >= bonusThresholds[i]) : (value - baseline >= bonusThresholds[i])) {
      return 10 - i;
    }
  }
  return 0;
}

function gradeLabel(total: number) {
  if (total >= 90) return { label: "优秀", tone: "excellent" };
  if (total >= 80) return { label: "良好", tone: "good" };
  if (total >= 60) return { label: "及格", tone: "pass" };
  return { label: "不及格", tone: "fail" };
}

type Inputs = {
  gender: Gender; grade: Grade;
  height: string; weight: string;
  vitality: string; run50: string;
  flex: string; jump: string;
  strength: string;
  endureMin: string; endureSec: string;
};

const WEIGHTS = { bmi: 0.15, vital: 0.15, run50: 0.20, flex: 0.10, jump: 0.10, strength: 0.10, endure: 0.20 };

function calcScores(inputs: Inputs) {
  const { gender, grade } = inputs;
  const h = parseFloat(inputs.height) / 100;
  const w = parseFloat(inputs.weight);
  const bmi = h > 0 && w > 0 ? w / (h * h) : NaN;

  const vital = parseFloat(inputs.vitality);
  const run50 = parseFloat(inputs.run50);
  const flex = parseFloat(inputs.flex);
  const jump = parseFloat(inputs.jump);
  const strength = parseFloat(inputs.strength);
  const endureSecs = (parseFloat(inputs.endureMin) || 0) * 60 + (parseFloat(inputs.endureSec) || 0);

  const isM12 = gender === "male" && grade === "12";
  const isM34 = gender === "male" && grade === "34";
  const isF12 = gender === "female" && grade === "12";

  const sBmi = isNaN(bmi) ? null : scoreBmi(bmi, gender);
  const sVital = isNaN(vital) ? null : lookupHigh(vital, isM12 ? VITAL_M12 : isM34 ? VITAL_M34 : isF12 ? VITAL_F12 : VITAL_F34);
  const sRun50 = isNaN(run50) ? null : lookupLow(run50, isM12 ? RUN50_M12 : isM34 ? RUN50_M34 : isF12 ? RUN50_F12 : RUN50_F34);
  const sFlex = isNaN(flex) ? null : lookupHigh(flex, isM12 ? FLEX_M12 : isM34 ? FLEX_M34 : isF12 ? FLEX_F12 : FLEX_F34);
  const sJump = isNaN(jump) ? null : lookupHigh(jump, isM12 ? JUMP_M12 : isM34 ? JUMP_M34 : isF12 ? JUMP_F12 : JUMP_F34);
  const sStrength = isNaN(strength) ? null : (
    gender === "male"
      ? lookupHigh(strength, grade === "12" ? PULL_M12 : PULL_M34)
      : lookupHigh(strength, grade === "12" ? SITUP_F12 : SITUP_F34)
  );
  const sEndure = endureSecs === 0 ? null : lookupLow(endureSecs, isM12 ? ENDURE_M12 : isM34 ? ENDURE_M34 : isF12 ? ENDURE_F12 : ENDURE_F34);

  const allScores = [sBmi, sVital, sRun50, sFlex, sJump, sStrength, sEndure];
  const allPresent = allScores.every(s => s !== null);
  const standard = allPresent
    ? (sBmi! * WEIGHTS.bmi + sVital! * WEIGHTS.vital + sRun50! * WEIGHTS.run50 +
       sFlex! * WEIGHTS.flex + sJump! * WEIGHTS.jump + sStrength! * WEIGHTS.strength + sEndure! * WEIGHTS.endure)
    : null;

  let bonus = 0;
  if (allPresent && standard !== null) {
    if (gender === "male") {
      const pullBaseline = grade === "12" ? 19 : 20;
      const endureBaseline = grade === "12" ? ENDURE_M12[0] : ENDURE_M34[0];
      bonus += calcBonus(
        strength,
        pullBaseline,
        grade === "12" ? PULLUP_BONUS_M12 : PULLUP_BONUS_M34,
        false,
      );
      bonus += calcBonus(
        endureSecs,
        endureBaseline,
        grade === "12" ? ENDURE_BONUS_M12 : ENDURE_BONUS_M34,
        true,
      );
    } else {
      const situpBaseline = grade === "12" ? 56 : 57;
      const endureBaseline = grade === "12" ? ENDURE_F12[0] : ENDURE_F34[0];
      bonus += calcBonus(
        strength,
        situpBaseline,
        grade === "12" ? SITUP_BONUS_F12 : SITUP_BONUS_F34,
        false,
      );
      bonus += calcBonus(
        endureSecs,
        endureBaseline,
        grade === "12" ? ENDURE_BONUS_F12 : ENDURE_BONUS_F34,
        true,
      );
    }
    bonus = Math.min(bonus, 20);
  }

  return { sBmi, sVital, sRun50, sFlex, sJump, sStrength, sEndure, standard, bonus, bmi };
}

function ScoreTag({ score }: { score: number | null }) {
  if (score === null) return <span className="fitness-score-tag na">—</span>;
  const tone = score >= 90 ? "excellent" : score >= 80 ? "good" : score >= 60 ? "pass" : "fail";
  return <span className={`fitness-score-tag ${tone}`}>{score}</span>;
}

function Field({ label, unit, value, onChange, placeholder, readOnly = false }: {
  label: string; unit: string; value: string;
  onChange: (v: string) => void; placeholder?: string; readOnly?: boolean;
}) {
  return (
    <label className="fitness-field">
      <span className="fitness-field-label">{label}</span>
      <div className="fitness-field-input">
        <input type="number" value={value} onChange={e => onChange(e.target.value)} readOnly={readOnly}
          placeholder={placeholder || "—"} step="any" />
        <span className="fitness-field-unit">{unit}</span>
      </div>
    </label>
  );
}

export function FitnessCalc({ dataCatalog }: { dataCatalog: LocalDataCatalog }) {
  const [inputs, setInputs] = useState<Inputs>({
    gender: "male", grade: "12",
    height: "", weight: "",
    vitality: "", run50: "",
    flex: "", jump: "", strength: "",
    endureMin: "", endureSec: "",
  });
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [availableYears, setAvailableYears] = useState<FitnessYear[]>([]);
  const [selectedYear, setSelectedYear] = useState("");
  const [academicGrade, setAcademicGrade] = useState<string | null>(null);
  const [hasImportedScore, setHasImportedScore] = useState(false);

  const set = (k: keyof Inputs) => (v: string) => setInputs(p => ({ ...p, [k]: v }));

  const applyScore = useCallback((data: FitnessScoreResult) => {
    if (data.availableYears?.length) setAvailableYears(data.availableYears);
    if (data.yearKey) setSelectedYear(data.yearKey);
    if (data.academicGrade) setAcademicGrade(data.academicGrade);
    setHasImportedScore(true);
    setInputs(p => ({
      ...p,
      gender: data.gender === "male" || data.gender === "female" ? data.gender : p.gender,
      grade: data.gradeGroup === "12" || data.gradeGroup === "34" ? data.gradeGroup : p.grade,
      height: data.heightCm != null ? String(data.heightCm) : "",
      weight: data.weightKg != null ? String(data.weightKg) : "",
      vitality: data.vitality != null ? String(data.vitality) : "",
      run50: data.run50 != null ? String(data.run50) : "",
      flex: data.flex != null ? String(data.flex) : "",
      jump: data.jump != null ? String(data.jump) : "",
      strength: data.strength != null ? String(data.strength) : "",
      endureMin: data.endureSecs != null ? String(Math.floor(data.endureSecs / 60)) : "",
      endureSec: data.endureSecs != null ? String(data.endureSecs % 60) : "",
    }));
  }, []);

  useEffect(() => {
    const fitness = dataCatalog.collections?.fitness;
    if (!fitness?.availableYears?.length) return;
    const nextYear = selectedYear && fitness.records[selectedYear]
      ? selectedYear
      : fitness.availableYears.find((year) => fitness.records[year.yearKey])?.yearKey;
    if (!nextYear) return;
    const record = fitness.records[nextYear];
    applyScore({
      ...record.normalized,
      yearKey: nextYear,
      availableYears: fitness.availableYears,
      cachedAt: record.capturedAt,
      refreshState: record.refreshState,
    });
  }, [applyScore, dataCatalog, selectedYear]);

  async function handleImport(requestedYear = selectedYear, refresh = false) {
    setImporting(true);
    setImportError(null);
    try {
      const data: FitnessScoreResult = await bridge.getFitnessScore(requestedYear || undefined, { refresh });
      applyScore(data);
    } catch (e: unknown) {
      setImportError(e instanceof Error ? e.message : "导入失败");
    } finally {
      setImporting(false);
    }
  }
  const r = calcScores(inputs);
  const total = r.standard !== null ? Math.min(120, r.standard + r.bonus) : null;
  const grade = total !== null ? gradeLabel(total) : null;

  const isMale = inputs.gender === "male";
  const genderLabel = inputs.gender === "male" ? "男" : "女";
  const academicGradeLabel = academicGrade || (inputs.grade === "12" ? "大一 / 大二" : "大三 / 大四");
  const rows: Array<{ label: string; score: number | null; weight: string }> = [
    { label: "BMI 体重指数", score: r.sBmi, weight: "15%" },
    { label: "肺活量", score: r.sVital, weight: "15%" },
    { label: "50 米跑", score: r.sRun50, weight: "20%" },
    { label: "坐位体前屈", score: r.sFlex, weight: "10%" },
    { label: "立定跳远", score: r.sJump, weight: "10%" },
    { label: isMale ? "引体向上" : "1 分钟仰卧起坐", score: r.sStrength, weight: "10%" },
    { label: isMale ? "1000 米跑" : "800 米跑", score: r.sEndure, weight: "20%" },
  ];

  return (
    <div className="fitness-calc">
      <div className="fitness-import-row">
        <button type="button" className="fitness-import-btn" onClick={() => { void handleImport(undefined, hasImportedScore); }} disabled={importing}>
          {importing ? "正在建立本地档案…" : hasImportedScore ? "更新体测档案" : "导入体测档案"}
        </button>
        {importError && <span className="fitness-import-error">{importError}</span>}
      </div>
      <div className="fitness-meta">
        <div className="fitness-readonly-meta">
          <span className="fitness-toggle-label">性别</span>
          <strong>{genderLabel}</strong>
        </div>
        <div className="fitness-readonly-meta">
          <span className="fitness-toggle-label">年级</span>
          <strong>{academicGradeLabel}</strong>
        </div>
        <label className="fitness-year-picker">
          <span className="fitness-toggle-label">测试年份</span>
          <select
            value={selectedYear}
            disabled={importing || availableYears.length === 0}
            onChange={(event) => {
              const nextYear = event.target.value;
              setSelectedYear(nextYear);
              void handleImport(nextYear);
            }}
          >
            <option value="">自动选择最近有数据的年度</option>
            {availableYears.map((year) => <option key={year.yearKey} value={year.yearKey}>{year.label}</option>)}
          </select>
        </label>
        {availableYears.length === 0 && <span className="fitness-year-hint">首次导入后可离线秒切换历史测试年份</span>}
      </div>

      <div className="fitness-inputs-grid">
        <Field label="身高" unit="cm" value={inputs.height} onChange={set("height")} placeholder="170" readOnly={hasImportedScore} />
        <Field label="体重" unit="kg" value={inputs.weight} onChange={set("weight")} placeholder="65" readOnly={hasImportedScore} />
        {!isNaN(r.bmi) && <span className="fitness-bmi-hint">BMI = {r.bmi.toFixed(1)}</span>}
        <Field label="肺活量" unit="mL" value={inputs.vitality} onChange={set("vitality")} placeholder="4500" readOnly={hasImportedScore} />
        <Field label="50 米跑" unit="秒" value={inputs.run50} onChange={set("run50")} placeholder="7.5" readOnly={hasImportedScore} />
        <Field label="坐位体前屈" unit="cm" value={inputs.flex} onChange={set("flex")} placeholder="15" readOnly={hasImportedScore} />
        <Field label="立定跳远" unit="cm" value={inputs.jump} onChange={set("jump")} placeholder="240" readOnly={hasImportedScore} />
        <Field label={isMale ? "引体向上" : "1 分钟仰卧起坐"} unit="次"
          value={inputs.strength} onChange={set("strength")} placeholder={isMale ? "12" : "40"} readOnly={hasImportedScore} />
        <div className="fitness-endure-row">
          <span className="fitness-field-label">{isMale ? "1000 米跑" : "800 米跑"}</span>
          <div className="fitness-endure-inputs">
            <div className="fitness-field-input">
              <input type="number" value={inputs.endureMin} onChange={e => set("endureMin")(e.target.value)} placeholder="4" min="0" readOnly={hasImportedScore} />
              <span className="fitness-field-unit">分</span>
            </div>
            <div className="fitness-field-input">
              <input type="number" value={inputs.endureSec} onChange={e => set("endureSec")(e.target.value)} placeholder="30" min="0" max="59" readOnly={hasImportedScore} />
              <span className="fitness-field-unit">秒</span>
            </div>
          </div>
        </div>
      </div>

      <div className="fitness-result-panel">
        <div className="fitness-scores-table">
          {rows.map(row => (
            <div key={row.label} className="fitness-score-row">
              <span className="fitness-score-name">{row.label}</span>
              <span className="fitness-score-weight">{row.weight}</span>
              <ScoreTag score={row.score} />
            </div>
          ))}
        </div>
        {total !== null && (
          <div className={`fitness-total tone-${grade?.tone}`}>
            <div className="fitness-total-nums">
              <span className="fitness-total-score">{total.toFixed(1)}</span>
              <span className="fitness-total-detail">
                标准分 {r.standard!.toFixed(1)} + 附加分 {r.bonus}
              </span>
            </div>
            <span className="fitness-grade-badge">{grade?.label}</span>
          </div>
        )}
        {total === null && (
          <div className="fitness-total-empty">填写全部项目后显示总分</div>
        )}
      </div>
    </div>
  );
}
