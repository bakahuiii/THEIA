import { useMemo, useState } from "react";
import { BookOpen, Calculator, Info, RotateCcw, Table2 } from "lucide-react";
import {
  SRTP_SCORES,
  type Competition,
  type Lecture,
  type OtherRecord,
  type Paper,
  type Patent,
  type PlatformState,
  type Science,
  type SimpleRecord,
  type Srtp,
  type Startup,
  type Status,
  type ViewKey,
  competitionValue,
  distinctTotals,
  fmt,
  lectureValue,
  numberValue,
  paperValue,
  patentValue,
  recognized,
  scienceValue,
  startupValue,
} from "./innovation-calc-model";
import {
  CompetitionSection,
  CourseSection,
  ModuleHeading,
  OtherSection,
  PlatformSection,
  RequirementBadge,
  ScienceSection,
  SimpleOtherSection,
  SrtpSection,
  type UpdateRecords,
} from "./innovation-calc-sections";
import { RulesView } from "./innovation-calc-rules";

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
    return {
      recognizedCourse,
      pendingCourse,
      recognizedPractice: practiceValues.reduce((sum, value) => sum + value, 0),
      pendingPractice: pendingValues.reduce((sum, value) => sum + value, 0),
    };
  }, [courseCredits, courseStatus, platform, competitions, srtp, science, patents, papers, lectures, certifications, startups, other]);

  const total = summary.recognizedCourse + summary.recognizedPractice;
  const potential = total + summary.pendingCourse + summary.pendingPractice;
  const update: UpdateRecords = (setter, id, patch) => setter((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  const reset = () => {
    setCourseCredits("");
    setCourseStatus("none");
    setPlatform({ mentor: "none", cross: "none" });
    setCompetitions([]);
    setSrtp([]);
    setScience([]);
    setPatents([]);
    setPapers([]);
    setLectures([]);
    setCertifications([]);
    setStartups([]);
    setOther([]);
  };

  return <div className="innovation-calc">
    <section className="innovation-hero"><div><div className="innovation-kicker"><BookOpen size={14} />本科生手册 2023 版规则参考</div><h2>创新创业教育学分</h2><p>把课程学分、实践项目、证明材料和正式认定分开记录，避免把“参加过”误当成“教务已入账”。</p></div><div className="innovation-hero-actions"><button type="button" className="innovation-reset" onClick={reset} title="清空当前估算" aria-label="清空当前估算"><RotateCcw size={14} />清空</button><div className="innovation-hero-total"><span>毕业要求</span><strong>4</strong><small>课程 2 · 实践 2</small></div></div></section>
    <div className="innovation-view-tabs" role="tablist" aria-label="创新创业学分工具"><button type="button" className={view === "estimate" ? "active" : ""} role="tab" aria-selected={view === "estimate"} onClick={() => setView("estimate")}><Calculator size={15} />缺口估算</button><button type="button" className={view === "rules" ? "active" : ""} role="tab" aria-selected={view === "rules"} onClick={() => setView("rules")}><Table2 size={15} />规则与分值</button></div>
    {view === "rules" ? <RulesView /> : <>
      <section className="innovation-summary-grid" aria-label="创新创业学分汇总"><RequirementBadge label="创新创业类课程" value={summary.recognizedCourse} pending={summary.pendingCourse} threshold={2} /><RequirementBadge label="创新创业实践" value={summary.recognizedPractice} pending={summary.pendingPractice} threshold={2} /><RequirementBadge label="创新创业教育合计" value={total} pending={potential - total} threshold={4} /></section>
      <section className="innovation-notice"><Info size={16} /><div><strong>先看“已认定”，再看“待认定”</strong><span>只有“已认定 / 已入账”才计入已获得学分。待认定项目只作为潜在分值展示，不能证明毕业条件已经满足。</span></div></section>
      <section className="innovation-module innovation-course-module" aria-labelledby="innovation-course-module-title"><ModuleHeading id="innovation-course-module-title" title="课程模块" description="只记录创新创业类课程学分；课程门槛与实践门槛分开判断。" value={`${fmt(summary.recognizedCourse)} / 2 学分`} /><CourseSection credits={courseCredits} status={courseStatus} onCredits={setCourseCredits} onStatus={setCourseStatus} recognized={summary.recognizedCourse} /></section>
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
