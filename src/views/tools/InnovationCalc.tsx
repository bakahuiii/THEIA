import { useMemo, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { AlertTriangle, BookOpen, Calculator, CheckCircle2, Info, Plus, RotateCcw, Table2, Trash2 } from "lucide-react";

type ViewKey = "estimate" | "rules";
type Status = "none" | "pending" | "recognized";
type CompetitionLevel = "national" | "provincial" | "school" | "college";
type CompetitionAward = "first" | "second" | "third" | "participation";
type SrtpLevel = "national" | "beijing" | "school" | "college";
type Role = "leader" | "member";
type PaperKind = "sci" | "ei" | "noncore" | "conference";
type PaperRank = "first" | "advisor-second" | "other";

type Competition = { id: string; title: string; level: CompetitionLevel; award: CompetitionAward; team: boolean; rank: string; status: Status };
type Srtp = { id: string; title: string; level: SrtpLevel; role: Role; status: Status };
type Science = { id: string; title: string; level: "national" | "provincial" | "other"; credits: string; status: Status };
type Patent = { id: string; title: string; rank: string; status: Status };
type Paper = { id: string; title: string; kind: PaperKind; rank: PaperRank; status: Status };
type Lecture = { id: string; title: string; count: string; status: Status };
type SimpleRecord = { id: string; title: string; status: Status };
type Startup = { id: string; title: string; role: "legal" | "shareholder"; rank: string; status: Status };
type OtherRecord = { id: string; title: string; credits: string; status: Status };
type PlatformState = { mentor: Status; cross: Status };

const STATUS_LABELS: Record<Status, string> = { none: "未录入", pending: "待认定", recognized: "已认定" };
const COMP_LEVELS: Record<CompetitionLevel, string> = { national: "国家级", provincial: "省部级", school: "校级", college: "院级" };
const COMP_AWARDS: Record<CompetitionAward, string> = { first: "一等奖及以上", second: "二等奖", third: "三等奖", participation: "完整参加未获奖" };
const COMP_SCORES: Record<CompetitionLevel, Partial<Record<CompetitionAward, number>>> = {
  national: { first: 5, second: 4, third: 3 },
  provincial: { first: 4, second: 3, third: 2, participation: 1.5 },
  school: { first: 3, second: 2, third: 1, participation: 0.5 },
  college: { first: 1, second: 0.5, third: 0.5, participation: 0.2 },
};
const SRTP_LEVELS: Record<SrtpLevel, string> = { national: "国家级", beijing: "北京市级", school: "校级", college: "院级" };
const SRTP_SCORES: Record<SrtpLevel, Record<Role, number>> = {
  national: { leader: 5, member: 4 }, beijing: { leader: 4, member: 3 }, school: { leader: 3, member: 2 }, college: { leader: 2, member: 1 },
};
const PAPER_KINDS: Record<PaperKind, string> = { sci: "SCI / SSCI / CSSCI", ei: "EI / ISTP / 中文核心", noncore: "非核心正式刊物", conference: "正式会议论文集" };
const PAPER_SCORES: Record<PaperKind, { top: number; other: number }> = {
  sci: { top: 6, other: 2 }, ei: { top: 4, other: 1 }, noncore: { top: 2, other: 0.5 }, conference: { top: 1, other: 0.5 },
};

let idSequence = 0;
const makeId = (prefix: string) => `${prefix}-${Date.now()}-${idSequence += 1}`;
const numberValue = (value: string): number => { const parsed = Number(value); return value.trim() && Number.isFinite(parsed) ? Math.max(0, parsed) : 0; };
const integerValue = (value: string): number => Math.floor(numberValue(value));
const fmt = (value: number): string => Number.isInteger(value) ? String(value) : value.toFixed(1);
const recognized = (status: Status, value: number): number => status === "recognized" ? value : 0;

const newCompetition = (): Competition => ({ id: makeId("competition"), title: "", level: "national", award: "first", team: false, rank: "", status: "none" });
const newSrtp = (): Srtp => ({ id: makeId("srtp"), title: "", level: "national", role: "leader", status: "none" });
const newScience = (): Science => ({ id: makeId("science"), title: "", level: "national", credits: "", status: "none" });
const newPatent = (): Patent => ({ id: makeId("patent"), title: "", rank: "1", status: "none" });
const newPaper = (): Paper => ({ id: makeId("paper"), title: "", kind: "sci", rank: "first", status: "none" });
const newLecture = (): Lecture => ({ id: makeId("lecture"), title: "", count: "1", status: "none" });
const newSimple = (prefix: string): SimpleRecord => ({ id: makeId(prefix), title: "", status: "none" });
const newStartup = (): Startup => ({ id: makeId("startup"), title: "", role: "legal", rank: "1", status: "none" });
const newOther = (): OtherRecord => ({ id: makeId("other"), title: "", credits: "", status: "none" });

const competitionBase = (entry: Competition): number => COMP_SCORES[entry.level][entry.award] ?? 0;
const competitionValue = (entry: Competition): number => {
  const base = competitionBase(entry);
  if (entry.level === "national" && entry.award === "participation") return 0;
  if (!base || !entry.team) return base;
  const rank = integerValue(entry.rank);
  if (!rank) return base;
  return rank <= 3 ? base : Math.max(1, base - rank + 3);
};
const competitionScore = (entry: Competition): number => recognized(entry.status, competitionValue(entry));
const srtpScore = (entry: Srtp): number => recognized(entry.status, SRTP_SCORES[entry.level][entry.role]);
const scienceValue = (entry: Science): number => entry.level === "national" ? 8 : entry.level === "provincial" ? 6 : numberValue(entry.credits);
const scienceScore = (entry: Science): number => recognized(entry.status, scienceValue(entry));
const patentValue = (entry: Patent): number => { const rank = integerValue(entry.rank); return rank ? rank <= 2 ? 4 : Math.max(1, 6 - rank) : 0; };
const patentScore = (entry: Patent): number => recognized(entry.status, patentValue(entry));
const paperValue = (entry: Paper): number => entry.rank === "other" ? PAPER_SCORES[entry.kind].other : PAPER_SCORES[entry.kind].top;
const paperScore = (entry: Paper): number => recognized(entry.status, paperValue(entry));
const lectureValue = (entry: Lecture): number => numberValue(entry.count) * 0.1;
const lectureScore = (entry: Lecture): number => recognized(entry.status, lectureValue(entry));
const startupValue = (entry: Startup): number => entry.role === "legal" ? 6 : Math.max(1, 5 - integerValue(entry.rank));
const startupScore = (entry: Startup): number => recognized(entry.status, startupValue(entry));

type TitledStatusRecord = { id: string; title: string; status: Status };
const distinctTotals = <T extends TitledStatusRecord>(entries: T[], value: (entry: T) => number): { recognized: number; pending: number } => {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const key = entry.title.trim().toLocaleLowerCase() || entry.id;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  let recognizedTotal = 0;
  let pendingTotal = 0;
  for (const group of groups.values()) {
    const recognizedEntries = group.filter((entry) => entry.status === "recognized");
    const pendingEntries = group.filter((entry) => entry.status === "pending");
    recognizedTotal += Math.max(0, ...recognizedEntries.map(value));
    if (recognizedEntries.length === 0) pendingTotal += Math.max(0, ...pendingEntries.map(value));
  }
  return { recognized: recognizedTotal, pending: pendingTotal };
};

const RULE_GROUPS = [
  { title: "创新创业类课程", cap: "毕业至少 2 学分", rows: [
    ["课程范围", "代码以 IEE 开头、类别为“创新创业类”的学校课程或学校认定网络课程", "毕业前修满至少 2 学分"],
    ["重复计算", "课程学分只计入课程部分，不与实践项目重复计算", "以教务系统认定为准"],
  ] },
  { title: "创新平台", cap: "实践项目", rows: [
    ["本科生导师制", "完成互选、按学期提交成长报告并考核合格", "0.2 学分"],
    ["学科交叉班", "进入交叉班并参加活动，有活动记录或证明、指导教师审核合格", "0.5 学分"],
  ] },
  { title: "学科竞赛", cap: "同一竞赛只取最高奖", rows: [
    ["国家级", "一等奖及以上 / 二等奖 / 三等奖", "5 / 4 / 3 学分"],
    ["省部级", "一等奖及以上 / 二等奖 / 三等奖 / 完整参加未获奖", "4 / 3 / 2 / 1.5 学分"],
    ["校级", "一等奖及以上 / 二等奖 / 三等奖 / 完整参加未获奖", "3 / 2 / 1 / 0.5 学分"],
    ["院级", "一等奖及以上 / 低于一等奖 / 完整参加未获奖", "1 / 0.5 / 0.2 学分"],
    ["团队项目", "前三名按最高分，之后排名依次递减 1 分，最低 1 分；校级团队按手册备注核定", "学院审核"],
  ] },
  { title: "大学生创新创业训练计划", cap: "须结题合格且总结报告不少于 5000 字", rows: [
    ["国家级", "负责人 / 成员", "5 / 4 学分"], ["北京市级", "负责人 / 成员", "4 / 3 学分"], ["校级", "负责人 / 成员", "3 / 2 学分"], ["院级", "负责人 / 成员", "2 / 1 学分"],
    ["重复计算", "同一题目不同级别立项只按最高级别认定", "不叠加"],
  ] },
  { title: "科技成果、专利与论文", cap: "第一署名/权利人和证明材料必须符合要求", rows: [
    ["科技获奖", "国家级科技成果一至三等奖；省部级科技成果一至三等奖", "8 / 6 学分"],
    ["其他科研获奖", "报教务处进行学分认定", "不预设分值"],
    ["专利 / 软件著作权", "第一专利权人/著作权人为北化，取得申请号或授权材料", "前两名 4 分；之后递减 1 分，最低 1 分"],
    ["SCI / SSCI / CSSCI", "署名北化；第一作者或导师第一、学生第二得最高分", "6 分；其他排名 2 分"],
    ["EI / ISTP / 中文核心", "署名北化；第一作者或导师第一、学生第二得最高分", "4 分；其他排名 1 分"],
    ["非核心正式刊物", "署名北化并正式出版", "2 分；其他排名 0.5 分"],
    ["正式会议论文集", "署名北化并被论文集收录", "1 分；其他排名 0.5 分"],
  ] },
  { title: "其他项目", cap: "均需材料和正式认定", rows: [
    ["学术讲座或报告", "刷卡签到并提交心得；由教务处、学工办、北区办或学院等举办单位认定", "0.1 分/次"],
    ["职业认证", "参加培训并取得国家认证部门颁发的证书，提交证书复印件", "1 学分"],
    ["自主创业", "在校期间开展创业实践并注册公司", "法定代表人 6；其他股东 4 分起依次递减"],
    ["其他项目", "未列入前述项目，报教务处认定", "由教务处核定"],
  ] },
] as const;

function StatusSelect({ value, onChange, label }: { value: Status; onChange: (value: Status) => void; label: string }) {
  return <select className={`innovation-status-select ${value}`} value={value} onChange={(event) => onChange(event.target.value as Status)} aria-label={label}>{Object.entries(STATUS_LABELS).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select>;
}

function RequirementBadge({ label, value, pending, threshold }: { label: string; value: number; pending: number; threshold: number }) {
  const state = value >= threshold ? "met" : value + pending >= threshold ? "pending" : "unmet";
  return <div className={`innovation-req-badge ${state}`}><span>{state === "met" ? <CheckCircle2 size={14} /> : state === "pending" ? <Info size={14} /> : <AlertTriangle size={14} />}</span><strong>{label} ≥ {fmt(threshold)}</strong><small>{fmt(value)} 已认定{pending > 0 ? ` · ${fmt(pending)} 待认定` : ""}</small></div>;
}

export function InnovationCalc() {
  const [view, setView] = useState<ViewKey>("estimate");
  const [courseCredits, setCourseCredits] = useState("");
  const [courseStatus, setCourseStatus] = useState<Status>("none");
  const [platform, setPlatform] = useState<PlatformState>({ mentor: "none", cross: "none" });
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [srtp, setSrtp] = useState<Srtp[]>([]);
  const [science, setScience] = useState<Science[]>([]);
  const [patents, setPatents] = useState<Patent[]>([]);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [certifications, setCertifications] = useState<SimpleRecord[]>([]);
  const [startups, setStartups] = useState<Startup[]>([]);
  const [other, setOther] = useState<OtherRecord[]>([]);

  const summary = useMemo(() => {
    const course = numberValue(courseCredits);
    const distinct = [
      distinctTotals(competitions, competitionValue),
      distinctTotals(srtp, (item) => SRTP_SCORES[item.level][item.role]),
      distinctTotals(science, scienceValue),
      distinctTotals(patents, patentValue),
      distinctTotals(papers, paperValue),
      distinctTotals(lectures, lectureValue),
      distinctTotals(certifications, () => 1),
      distinctTotals(startups, startupValue),
      distinctTotals(other, (item) => numberValue(item.credits)),
    ];
    const practiceValues = [platform.mentor === "recognized" ? 0.2 : 0, platform.cross === "recognized" ? 0.5 : 0, ...distinct.map((item) => item.recognized)];
    const pendingValues = [platform.mentor === "pending" ? 0.2 : 0, platform.cross === "pending" ? 0.5 : 0, ...distinct.map((item) => item.pending)];
    const recognizedCourse = recognized(courseStatus, course);
    const pendingCourse = courseStatus === "pending" ? course : 0;
    return { recognizedCourse, pendingCourse, recognizedPractice: practiceValues.reduce((sum, value) => sum + value, 0), pendingPractice: pendingValues.reduce((sum, value) => sum + value, 0) };
  }, [courseCredits, courseStatus, platform, competitions, srtp, science, patents, papers, lectures, certifications, startups, other]);

  const total = summary.recognizedCourse + summary.recognizedPractice;
  const potential = total + summary.pendingCourse + summary.pendingPractice;
  const update = <T extends { id: string }>(setter: Dispatch<SetStateAction<T[]>>, id: string, patch: Partial<T>) => setter((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  const reset = () => { setCourseCredits(""); setCourseStatus("none"); setPlatform({ mentor: "none", cross: "none" }); setCompetitions([]); setSrtp([]); setScience([]); setPatents([]); setPapers([]); setLectures([]); setCertifications([]); setStartups([]); setOther([]); };

  return <div className="innovation-calc">
    <section className="innovation-hero"><div><div className="innovation-kicker"><BookOpen size={14} />本科生手册 2023 版规则参考</div><h2>创新创业教育学分</h2><p>把课程学分、实践项目、证明材料和正式认定分开记录，避免把“参加过”误当成“教务已入账”。</p></div><div className="innovation-hero-actions"><button type="button" className="innovation-reset" onClick={reset} title="清空当前估算" aria-label="清空当前估算"><RotateCcw size={14} />清空</button><div className="innovation-hero-total"><span>毕业要求</span><strong>4</strong><small>课程 2 · 实践 2</small></div></div></section>
    <div className="innovation-view-tabs" role="tablist" aria-label="创新创业学分工具"><button type="button" className={view === "estimate" ? "active" : ""} role="tab" aria-selected={view === "estimate"} onClick={() => setView("estimate")}><Calculator size={15} />缺口估算</button><button type="button" className={view === "rules" ? "active" : ""} role="tab" aria-selected={view === "rules"} onClick={() => setView("rules")}><Table2 size={15} />规则与分值</button></div>
    {view === "rules" ? <RulesView /> : <>
      <section className="innovation-summary-grid" aria-label="创新创业学分汇总"><RequirementBadge label="创新创业类课程" value={summary.recognizedCourse} pending={summary.pendingCourse} threshold={2} /><RequirementBadge label="创新创业实践" value={summary.recognizedPractice} pending={summary.pendingPractice} threshold={2} /><RequirementBadge label="创新创业教育合计" value={total} pending={potential - total} threshold={4} /></section>
      <section className="innovation-notice"><Info size={16} /><div><strong>先看“已认定”，再看“待认定”</strong><span>只有“已认定 / 已入账”才计入已获得学分。待认定项目只作为潜在分值展示，不能证明毕业条件已经满足。</span></div></section>
      <section className="innovation-module innovation-course-module" aria-labelledby="innovation-course-module-title">
        <ModuleHeading id="innovation-course-module-title" title="课程模块" description="只记录创新创业类课程学分；课程门槛与实践门槛分开判断。" value={`${fmt(summary.recognizedCourse)} / 2 学分`} />
        <CourseSection credits={courseCredits} status={courseStatus} onCredits={setCourseCredits} onStatus={setCourseStatus} recognized={summary.recognizedCourse} />
      </section>
      <section className="innovation-module innovation-practice-module" aria-labelledby="innovation-practice-module-title">
        <ModuleHeading id="innovation-practice-module-title" title="实践模块" description="讲座、认证等需要材料或签到的实践项目放在前面，再记录平台、竞赛和科研成果。" value={`${fmt(summary.recognizedPractice)} / 2 学分`} />
        <OtherSection lectures={lectures} setLectures={setLectures} update={update} certifications={certifications} setCertifications={setCertifications} startups={startups} setStartups={setStartups} updateStartup={update} />
        <PlatformSection platform={platform} setPlatform={setPlatform} />
        <CompetitionSection items={competitions} setItems={setCompetitions} update={update} />
        <SrtpSection items={srtp} setItems={setSrtp} update={update} />
        <ScienceSection science={science} setScience={setScience} update={update} patents={patents} setPatents={setPatents} papers={papers} setPapers={setPapers} />
        <SimpleOtherSection items={other} setItems={setOther} update={update} />
      </section>
      <section className="innovation-total-panel"><div><span>已认定实践学分</span><strong>{fmt(summary.recognizedPractice)}</strong><small>待认定潜在实践学分：{fmt(summary.pendingPractice)}</small></div><div><span>已认定创新创业教育合计</span><strong>{fmt(total)} / 4</strong><small>{total >= 4 ? "合计门槛已满足" : `还差 ${fmt(Math.max(0, 4 - total))} 学分`}</small></div></section>
    </>}
  </div>;
}

const PRACTICE_SECTION_INDEX: Record<string, string> = {
  "讲座、职业认证与自主创业": "02",
  "创新平台": "03",
  "学科竞赛": "04",
  "大学生创新创业训练计划": "05",
  "科技成果、专利与论文": "06",
  "教务处认定的其他项目": "07",
};

function SectionHeading({ index, title, description, total, action }: { index: string; title: string; description: string; total?: string; action?: ReactNode }) {
  const displayIndex = PRACTICE_SECTION_INDEX[title] ?? index;
  return <div className="innovation-section-heading"><div><span className="innovation-section-index">{displayIndex}</span><div><h3 className="warning-section-title">{title}</h3><p className="warning-section-desc">{description}</p></div></div>{action ?? total ? action ?? <strong className="innovation-section-total">{total}</strong> : null}</div>;
}

function ModuleHeading({ id, title, description, value }: { id: string; title: string; description: string; value: string }) {
  const mark = title.startsWith("课程") ? "课" : "实";
  return <div className="innovation-module-heading"><div className="innovation-module-heading-copy"><span className="innovation-module-mark" aria-hidden="true">{mark}</span><div><span className="innovation-module-eyebrow">学分记录分区</span><h3 id={id}>{title}</h3><p>{description}</p></div></div><div className="innovation-module-total"><span>已认定</span><strong>{value}</strong></div></div>;
}

function CourseSection({ credits, status, onCredits, onStatus, recognized }: { credits: string; status: Status; onCredits: (value: string) => void; onStatus: (value: Status) => void; recognized: number }) {
  return <section className="warning-section innovation-section"><SectionHeading index="01" title="创新创业类课程" description="只填 IEE 开头且类别为“创新创业类”的已修课程学分，普通课程不要放进来。" total={`${fmt(recognized)} / 2 学分`} /><div className="innovation-course-fields"><label className="fitness-field"><span className="fitness-field-label">课程学分</span><div className="fitness-field-input"><input type="number" value={credits} onChange={(event) => onCredits(event.target.value)} placeholder="例如 2" min="0" step="0.5" aria-label="创新创业类课程学分" /><span className="fitness-field-unit">学分</span></div></label><label className="innovation-field"><span>课程状态</span><StatusSelect value={status} onChange={onStatus} label="创新创业类课程状态" /></label></div><p className="innovation-field-note"><Info size={13} />网络课程也必须是学校认定的平台课程；最终以教务系统课程代码、类别和成绩记录为准。</p></section>;
}

function StaticRecord({ title, detail, value, status, onStatus }: { title: string; detail: string; value: string; status: Status; onStatus: (value: Status) => void }) {
  return <div className="innovation-static-record"><div><strong>{title}</strong><small>{detail}</small></div><b>{value}</b><StatusSelect value={status} onChange={onStatus} label={`${title}状态`} /></div>;
}

function PlatformSection({ platform, setPlatform }: { platform: PlatformState; setPlatform: Dispatch<SetStateAction<PlatformState>> }) {
  const total = (platform.mentor === "recognized" ? 0.2 : 0) + (platform.cross === "recognized" ? 0.5 : 0);
  return <section className="warning-section innovation-section"><SectionHeading index="03" title="创新平台" description="平台项目不按“参加过”自动计分，必须有规定记录并完成审核。" total={`${fmt(total)} 学分`} /><div className="innovation-static-records"><StaticRecord title="本科生导师制" detail="互选、按学期提交成长报告并考核合格" value="0.2" status={platform.mentor} onStatus={(value) => setPlatform((previous) => ({ ...previous, mentor: value }))} /><StaticRecord title="学科交叉班" detail="进入交叉班、参加活动并保留活动记录，指导教师审核合格" value="0.5" status={platform.cross} onStatus={(value) => setPlatform((previous) => ({ ...previous, cross: value }))} /></div></section>;
}

function Entry({ title, score, onTitle, onDelete, children }: { title: string; score: number; onTitle: (value: string) => void; onDelete: () => void; children: ReactNode }) {
  return <div className="innovation-entry"><div className="innovation-entry-top"><input value={title} onChange={(event) => onTitle(event.target.value)} placeholder="项目名称（可选）" aria-label="项目名称" /><span className="innovation-entry-score">{fmt(score)} 学分</span><button type="button" className="innovation-icon-button" onClick={onDelete} title="删除记录" aria-label="删除记录"><Trash2 size={14} /></button></div><div className="innovation-entry-fields">{children}</div></div>;
}

function EntryField({ label, children }: { label: string; children: ReactNode }) { return <label><span>{label}</span>{children}</label>; }

function AddButton({ children, onClick }: { children: ReactNode; onClick: () => void }) { return <button type="button" className="innovation-add-button" onClick={onClick}><Plus size={14} />{children}</button>; }

function CompetitionSection({ items, setItems, update }: { items: Competition[]; setItems: Dispatch<SetStateAction<Competition[]>>; update: <T extends { id: string }>(setter: Dispatch<SetStateAction<T[]>>, id: string, patch: Partial<T>) => void }) {
  return <section className="warning-section innovation-section"><SectionHeading index="03" title="学科竞赛" description="竞赛项目以学校当年认定名单为准；同一竞赛多个奖项只取最高奖，不重复累加。" action={<AddButton onClick={() => setItems((previous) => [...previous, newCompetition()])}>添加竞赛</AddButton>} /><div className="innovation-entry-list">{items.length === 0 && <div className="innovation-empty">还没有竞赛记录。添加后选择级别、奖项、团队排名和认定状态。</div>}{items.map((entry) => <Entry key={entry.id} title={entry.title} score={competitionScore(entry)} onTitle={(title) => update(setItems, entry.id, { title })} onDelete={() => setItems((previous) => previous.filter((item) => item.id !== entry.id))}><EntryField label="竞赛级别"><select value={entry.level} onChange={(event) => update(setItems, entry.id, { level: event.target.value as CompetitionLevel })}>{Object.entries(COMP_LEVELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></EntryField><EntryField label="获奖情况"><select value={entry.award} onChange={(event) => update(setItems, entry.id, { award: event.target.value as CompetitionAward })}>{Object.entries(COMP_AWARDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></EntryField><EntryField label="团队项目"><input type="checkbox" checked={entry.team} onChange={(event) => update(setItems, entry.id, { team: event.target.checked })} /></EntryField>{entry.team && <EntryField label="团队排名"><input type="number" value={entry.rank} onChange={(event) => update(setItems, entry.id, { rank: event.target.value })} min="1" step="1" placeholder="必填" /></EntryField>}<EntryField label="认定状态"><StatusSelect value={entry.status} onChange={(status) => update(setItems, entry.id, { status })} label="竞赛认定状态" /></EntryField></Entry>)}</div></section>;
}

function SrtpSection({ items, setItems, update }: { items: Srtp[]; setItems: Dispatch<SetStateAction<Srtp[]>>; update: <T extends { id: string }>(setter: Dispatch<SetStateAction<T[]>>, id: string, patch: Partial<T>) => void }) {
  return <section className="warning-section innovation-section"><SectionHeading index="04" title="大学生创新创业训练计划" description="必须结题合格并提交不少于 5000 字总结报告；同一题目只按最高级别认定。" action={<AddButton onClick={() => setItems((previous) => [...previous, newSrtp()])}>添加大创项目</AddButton>} /><div className="innovation-entry-list">{items.length === 0 && <div className="innovation-empty">还没有大创项目记录。</div>}{items.map((entry) => <Entry key={entry.id} title={entry.title} score={srtpScore(entry)} onTitle={(title) => update(setItems, entry.id, { title })} onDelete={() => setItems((previous) => previous.filter((item) => item.id !== entry.id))}><EntryField label="项目级别"><select value={entry.level} onChange={(event) => update(setItems, entry.id, { level: event.target.value as SrtpLevel })}>{Object.entries(SRTP_LEVELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></EntryField><EntryField label="项目角色"><select value={entry.role} onChange={(event) => update(setItems, entry.id, { role: event.target.value as Role })}><option value="leader">负责人</option><option value="member">成员</option></select></EntryField><EntryField label="认定状态"><StatusSelect value={entry.status} onChange={(status) => update(setItems, entry.id, { status })} label="大创项目认定状态" /></EntryField></Entry>)}</div></section>;
}

function ScienceSection({ science, setScience, update, patents, setPatents, papers, setPapers }: { science: Science[]; setScience: Dispatch<SetStateAction<Science[]>>; update: <T extends { id: string }>(setter: Dispatch<SetStateAction<T[]>>, id: string, patch: Partial<T>) => void; patents: Patent[]; setPatents: Dispatch<SetStateAction<Patent[]>>; papers: Paper[]; setPapers: Dispatch<SetStateAction<Paper[]>> }) {
  return <section className="warning-section innovation-section"><SectionHeading index="05" title="科技成果、专利与论文" description="成果的署名单位、排名、申请号/出版证明和正式认定必须分别核对。" /><Subsection title="科技成果获奖" detail="国家级 8 学分、省部级 6 学分；其他类别由教务处另行认定" action={<AddButton onClick={() => setScience((previous) => [...previous, newScience()])}>添加成果</AddButton>}><div className="innovation-entry-list">{science.map((entry) => <Entry key={entry.id} title={entry.title} score={scienceScore(entry)} onTitle={(title) => update(setScience, entry.id, { title })} onDelete={() => setScience((previous) => previous.filter((item) => item.id !== entry.id))}><EntryField label="成果级别"><select value={entry.level} onChange={(event) => update(setScience, entry.id, { level: event.target.value as Science["level"] })}><option value="national">国家级</option><option value="provincial">省部级</option><option value="other">其他（教务处认定）</option></select></EntryField>{entry.level === "other" && <EntryField label="教务处核定学分"><input type="number" value={entry.credits} onChange={(event) => update(setScience, entry.id, { credits: event.target.value })} min="0" step="0.1" placeholder="待核定" /></EntryField>}<EntryField label="认定状态"><StatusSelect value={entry.status} onChange={(status) => update(setScience, entry.id, { status })} label="科技成果认定状态" /></EntryField></Entry>)}</div></Subsection><Subsection title="专利 / 软件著作权" detail="第一专利权人/著作权人为北化；同一事项不可重复认定" action={<AddButton onClick={() => setPatents((previous) => [...previous, newPatent()])}>添加专利</AddButton>}><div className="innovation-entry-list">{patents.map((entry) => <Entry key={entry.id} title={entry.title} score={patentScore(entry)} onTitle={(title) => update(setPatents, entry.id, { title })} onDelete={() => setPatents((previous) => previous.filter((item) => item.id !== entry.id))}><EntryField label="本人排名"><input type="number" value={entry.rank} onChange={(event) => update(setPatents, entry.id, { rank: event.target.value })} min="1" step="1" /></EntryField><EntryField label="认定状态"><StatusSelect value={entry.status} onChange={(status) => update(setPatents, entry.id, { status })} label="专利认定状态" /></EntryField></Entry>)}</div></Subsection><Subsection title="发表论文" detail="第一署名单位为北化；导师第一、学生第二按手册计最高分" action={<AddButton onClick={() => setPapers((previous) => [...previous, newPaper()])}>添加论文</AddButton>}><div className="innovation-entry-list">{papers.map((entry) => <Entry key={entry.id} title={entry.title} score={paperScore(entry)} onTitle={(title) => update(setPapers, entry.id, { title })} onDelete={() => setPapers((previous) => previous.filter((item) => item.id !== entry.id))}><EntryField label="刊物类型"><select value={entry.kind} onChange={(event) => update(setPapers, entry.id, { kind: event.target.value as PaperKind })}>{Object.entries(PAPER_KINDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></EntryField><EntryField label="作者排名"><select value={entry.rank} onChange={(event) => update(setPapers, entry.id, { rank: event.target.value as PaperRank })}><option value="first">第一作者</option><option value="advisor-second">导师第一、学生第二</option><option value="other">其他排名</option></select></EntryField><EntryField label="认定状态"><StatusSelect value={entry.status} onChange={(status) => update(setPapers, entry.id, { status })} label="论文认定状态" /></EntryField></Entry>)}</div></Subsection></section>;
}

function Subsection({ title, detail, action, children }: { title: string; detail: string; action: ReactNode; children: ReactNode }) { return <div className="innovation-subsection"><div className="innovation-subheading"><div><strong>{title}</strong><small>{detail}</small></div>{action}</div>{children}</div>; }

function OtherSection({ lectures, setLectures, update, certifications, setCertifications, startups, setStartups, updateStartup }: { lectures: Lecture[]; setLectures: Dispatch<SetStateAction<Lecture[]>>; update: <T extends { id: string }>(setter: Dispatch<SetStateAction<T[]>>, id: string, patch: Partial<T>) => void; certifications: SimpleRecord[]; setCertifications: Dispatch<SetStateAction<SimpleRecord[]>>; startups: Startup[]; setStartups: Dispatch<SetStateAction<Startup[]>>; updateStartup: <T extends { id: string }>(setter: Dispatch<SetStateAction<T[]>>, id: string, patch: Partial<T>) => void }) {
  return <section className="warning-section innovation-section"><SectionHeading index="06" title="讲座、职业认证与自主创业" description="这些项目同样需要签到、心得、证书、公司注册或学校认定材料。" /><Subsection title="学术讲座或报告" detail="刷卡签到并提交心得；每次 0.1 学分，由举办单位认定" action={<AddButton onClick={() => setLectures((previous) => [...previous, newLecture()])}>添加讲座</AddButton>}><div className="innovation-entry-list">{lectures.map((entry) => <Entry key={entry.id} title={entry.title} score={lectureScore(entry)} onTitle={(title) => update(setLectures, entry.id, { title })} onDelete={() => setLectures((previous) => previous.filter((item) => item.id !== entry.id))}><EntryField label="次数"><input type="number" value={entry.count} onChange={(event) => update(setLectures, entry.id, { count: event.target.value })} min="1" step="1" /></EntryField><EntryField label="认定状态"><StatusSelect value={entry.status} onChange={(status) => update(setLectures, entry.id, { status })} label="讲座认定状态" /></EntryField></Entry>)}</div></Subsection><Subsection title="职业认证" detail="国家认证部门颁发的证书，手册表值 1 学分" action={<AddButton onClick={() => setCertifications((previous) => [...previous, newSimple("certification")])}>添加认证</AddButton>}><div className="innovation-entry-list">{certifications.map((entry) => <Entry key={entry.id} title={entry.title} score={recognized(entry.status, 1)} onTitle={(title) => update(setCertifications, entry.id, { title })} onDelete={() => setCertifications((previous) => previous.filter((item) => item.id !== entry.id))}><EntryField label="认定状态"><StatusSelect value={entry.status} onChange={(status) => update(setCertifications, entry.id, { status })} label="职业认证状态" /></EntryField></Entry>)}</div></Subsection><Subsection title="自主创业" detail="注册公司；法定代表人 6 学分，其他股东按排名从 4 学分起递减" action={<AddButton onClick={() => setStartups((previous) => [...previous, newStartup()])}>添加创业记录</AddButton>}><div className="innovation-entry-list">{startups.map((entry) => <Entry key={entry.id} title={entry.title} score={startupScore(entry)} onTitle={(title) => updateStartup(setStartups, entry.id, { title })} onDelete={() => setStartups((previous) => previous.filter((item) => item.id !== entry.id))}><EntryField label="身份"><select value={entry.role} onChange={(event) => updateStartup(setStartups, entry.id, { role: event.target.value as Startup["role"] })}><option value="legal">法定代表人</option><option value="shareholder">其他股东</option></select></EntryField>{entry.role === "shareholder" && <EntryField label="股东排名"><input type="number" value={entry.rank} onChange={(event) => updateStartup(setStartups, entry.id, { rank: event.target.value })} min="1" step="1" /></EntryField>}<EntryField label="认定状态"><StatusSelect value={entry.status} onChange={(status) => updateStartup(setStartups, entry.id, { status })} label="自主创业认定状态" /></EntryField></Entry>)}</div></Subsection></section>;
}

function SimpleOtherSection({ items, setItems, update }: { items: OtherRecord[]; setItems: Dispatch<SetStateAction<OtherRecord[]>>; update: <T extends { id: string }>(setter: Dispatch<SetStateAction<T[]>>, id: string, patch: Partial<T>) => void }) {
  return <section className="warning-section innovation-section"><SectionHeading index="07" title="教务处认定的其他项目" description="只填写已经给出正式核定学分的项目；没有核定结果时不要自行估分。" action={<AddButton onClick={() => setItems((previous) => [...previous, newOther()])}>添加其他项目</AddButton>} /><div className="innovation-entry-list">{items.length === 0 && <div className="innovation-empty">没有其他项目记录。</div>}{items.map((entry) => <Entry key={entry.id} title={entry.title} score={recognized(entry.status, numberValue(entry.credits))} onTitle={(title) => update(setItems, entry.id, { title })} onDelete={() => setItems((previous) => previous.filter((item) => item.id !== entry.id))}><EntryField label="教务处核定学分"><input type="number" value={entry.credits} onChange={(event) => update(setItems, entry.id, { credits: event.target.value })} min="0" step="0.1" placeholder="例如 0.5" /></EntryField><EntryField label="认定状态"><StatusSelect value={entry.status} onChange={(status) => update(setItems, entry.id, { status })} label="其他项目认定状态" /></EntryField></Entry>)}</div></section>;
}

function RulesView() {
  return <section className="warning-section innovation-rules-section"><div className="innovation-section-heading"><div><h3 className="warning-section-title">创新创业教育学分规则与分值</h3><p className="warning-section-desc">根据《北京化工大学本科生手册》（2023 版）第 30–36 页整理。正式认定、适用年级和学院执行细则优先。</p></div><span className="innovation-rule-version">2017 级起施行</span></div><div className="innovation-rules-table-wrap"><table className="innovation-rules-table"><thead><tr><th>项目</th><th>条件 / 认定材料</th><th>学分值或处理</th></tr></thead><tbody>{RULE_GROUPS.flatMap((group) => [{ type: "group" as const, group }, ...group.rows.map((row) => ({ type: "row" as const, row }))]).map((item, index) => item.type === "group" ? <tr className="innovation-rules-group" key={`group-${index}`}><th colSpan={3}><strong>{item.group.title}</strong><span>{item.group.cap}</span></th></tr> : <tr key={`row-${index}`}><td>{item.row[0]}</td><td>{item.row[1]}</td><td className="innovation-rule-score">{item.row[2]}</td></tr>)}</tbody></table></div><div className="innovation-process"><div className="innovation-process-heading"><Info size={15} /><strong>认定流程与边界</strong></div><div className="innovation-process-grid"><div><b>申请时间</b><span>每年秋季开学后 3 周内可申请一次；毕业资格审查前可申请最后一次。</span></div><div><b>审核链路</b><span>班主任/辅导员初审，学院审核并公示，录入教务系统，材料由学院教务办公室存档。</span></div><div><b>不能替代</b><span>证书、签到、论文或项目结题材料只是证明，不等于已经获得实践学分。</span></div><div><b>重复认定</b><span>同一事项不能在不同项目中重复认定；竞赛和大创跨级别按手册规则取最高级别。</span></div></div></div><p className="innovation-table-note"><Info size={13} />本页面是本地估算器，不读取学校正式认定结果，也不会代替申请、公示或教务系统入账。</p></section>;
}
