import type { Dispatch, ReactNode, SetStateAction } from "react";
import { AlertTriangle, CheckCircle2, Info, Plus, Trash2 } from "lucide-react";
import {
  COMP_AWARDS,
  COMP_LEVELS,
  PAPER_KINDS,
  SRTP_LEVELS,
  STATUS_LABELS,
  type Competition,
  type CompetitionAward,
  type CompetitionLevel,
  type Lecture,
  type OtherRecord,
  type Paper,
  type PaperKind,
  type PaperRank,
  type Patent,
  type PlatformState,
  type Role,
  type Science,
  type SimpleRecord,
  type Srtp,
  type SrtpLevel,
  type Startup,
  type Status,
  competitionScore,
  fmt,
  lectureScore,
  newCompetition,
  newLecture,
  newOther,
  newPaper,
  newPatent,
  newScience,
  newSimple,
  newSrtp,
  newStartup,
  numberValue,
  paperScore,
  patentScore,
  recognized,
  scienceScore,
  srtpScore,
  startupScore,
} from "./innovation-calc-model";

export type UpdateRecords = <T extends { id: string }>(
  setter: Dispatch<SetStateAction<T[]>>,
  id: string,
  patch: Partial<T>,
) => void;

export function StatusSelect({
  value,
  onChange,
  label,
}: {
  value: Status;
  onChange: (value: Status) => void;
  label: string;
}) {
  return (
    <select
      className={`innovation-status-select ${value}`}
      value={value}
      onChange={(event) => onChange(event.target.value as Status)}
      aria-label={label}
    >
      {Object.entries(STATUS_LABELS).map(([key, text]) => (
        <option key={key} value={key}>{text}</option>
      ))}
    </select>
  );
}

export function RequirementBadge({
  label,
  value,
  pending,
  threshold,
}: {
  label: string;
  value: number;
  pending: number;
  threshold: number;
}) {
  const state = value >= threshold ? "met" : value + pending >= threshold ? "pending" : "unmet";
  return (
    <div className={`innovation-req-badge ${state}`}>
      <span>
        {state === "met" ? <CheckCircle2 size={14} /> : state === "pending" ? <Info size={14} /> : <AlertTriangle size={14} />}
      </span>
      <strong>{label} ≥ {fmt(threshold)}</strong>
      <small>{fmt(value)} 已认定{pending > 0 ? ` · ${fmt(pending)} 待认定` : ""}</small>
    </div>
  );
}

const PRACTICE_SECTION_INDEX: Record<string, string> = {
  "讲座、职业认证与自主创业": "02",
  "创新平台": "03",
  "学科竞赛": "04",
  "大学生创新创业训练计划": "05",
  "科技成果、专利与论文": "06",
  "教务处认定的其他项目": "07",
};

export function SectionHeading({
  index,
  title,
  description,
  total,
  action,
}: {
  index: string;
  title: string;
  description: string;
  total?: string;
  action?: ReactNode;
}) {
  const displayIndex = PRACTICE_SECTION_INDEX[title] ?? index;
  return (
    <div className="innovation-section-heading">
      <div>
        <span className="innovation-section-index">{displayIndex}</span>
        <div>
          <h3 className="warning-section-title">{title}</h3>
          <p className="warning-section-desc">{description}</p>
        </div>
      </div>
      {action ?? (total ? <strong className="innovation-section-total">{total}</strong> : null)}
    </div>
  );
}

export function ModuleHeading({
  id,
  title,
  description,
  value,
}: {
  id: string;
  title: string;
  description: string;
  value: string;
}) {
  const mark = title.startsWith("课程") ? "课" : "实";
  return (
    <div className="innovation-module-heading">
      <div className="innovation-module-heading-copy">
        <span className="innovation-module-mark" aria-hidden="true">{mark}</span>
        <div>
          <span className="innovation-module-eyebrow">学分记录分区</span>
          <h3 id={id}>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
      <div className="innovation-module-total"><span>已认定</span><strong>{value}</strong></div>
    </div>
  );
}

export function CourseSection({
  credits,
  status,
  onCredits,
  onStatus,
  recognized: recognizedCredits,
}: {
  credits: string;
  status: Status;
  onCredits: (value: string) => void;
  onStatus: (value: Status) => void;
  recognized: number;
}) {
  return (
    <section className="warning-section innovation-section">
      <SectionHeading index="01" title="创新创业类课程" description="只填 IEE 开头且类别为“创新创业类”的已修课程学分，普通课程不要放进来。" total={`${fmt(recognizedCredits)} / 2 学分`} />
      <div className="innovation-course-fields">
        <label className="fitness-field">
          <span className="fitness-field-label">课程学分</span>
          <div className="fitness-field-input">
            <input type="number" value={credits} onChange={(event) => onCredits(event.target.value)} placeholder="例如 2" min="0" step="0.5" aria-label="创新创业类课程学分" />
            <span className="fitness-field-unit">学分</span>
          </div>
        </label>
        <label className="innovation-field"><span>课程状态</span><StatusSelect value={status} onChange={onStatus} label="创新创业类课程状态" /></label>
      </div>
      <p className="innovation-field-note"><Info size={13} />网络课程也必须是学校认定的平台课程；最终以教务系统课程代码、类别和成绩记录为准。</p>
    </section>
  );
}

function StaticRecord({ title, detail, value, status, onStatus }: { title: string; detail: string; value: string; status: Status; onStatus: (value: Status) => void }) {
  return <div className="innovation-static-record"><div><strong>{title}</strong><small>{detail}</small></div><b>{value}</b><StatusSelect value={status} onChange={onStatus} label={`${title}状态`} /></div>;
}

export function PlatformSection({ platform, setPlatform }: { platform: PlatformState; setPlatform: Dispatch<SetStateAction<PlatformState>> }) {
  const total = (platform.mentor === "recognized" ? 0.2 : 0) + (platform.cross === "recognized" ? 0.5 : 0);
  return <section className="warning-section innovation-section"><SectionHeading index="03" title="创新平台" description="平台项目不按“参加过”自动计分，必须有规定记录并完成审核。" total={`${fmt(total)} 学分`} /><div className="innovation-static-records"><StaticRecord title="本科生导师制" detail="互选、按学期提交成长报告并考核合格" value="0.2" status={platform.mentor} onStatus={(value) => setPlatform((previous) => ({ ...previous, mentor: value }))} /><StaticRecord title="学科交叉班" detail="进入交叉班、参加活动并保留活动记录，指导教师审核合格" value="0.5" status={platform.cross} onStatus={(value) => setPlatform((previous) => ({ ...previous, cross: value }))} /></div></section>;
}

function Entry({ title, score, onTitle, onDelete, children }: { title: string; score: number; onTitle: (value: string) => void; onDelete: () => void; children: ReactNode }) {
  return <div className="innovation-entry"><div className="innovation-entry-top"><input value={title} onChange={(event) => onTitle(event.target.value)} placeholder="项目名称（可选）" aria-label="项目名称" /><span className="innovation-entry-score">{fmt(score)} 学分</span><button type="button" className="innovation-icon-button" onClick={onDelete} title="删除记录" aria-label="删除记录"><Trash2 size={14} /></button></div><div className="innovation-entry-fields">{children}</div></div>;
}

function EntryField({ label, children }: { label: string; children: ReactNode }) {
  return <label><span>{label}</span>{children}</label>;
}

function AddButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button type="button" className="innovation-add-button" onClick={onClick}><Plus size={14} />{children}</button>;
}

export function CompetitionSection({ items, setItems, update }: { items: Competition[]; setItems: Dispatch<SetStateAction<Competition[]>>; update: UpdateRecords }) {
  return <section className="warning-section innovation-section"><SectionHeading index="03" title="学科竞赛" description="竞赛项目以学校当年认定名单为准；同一竞赛多个奖项只取最高奖，不重复累加。" action={<AddButton onClick={() => setItems((previous) => [...previous, newCompetition()])}>添加竞赛</AddButton>} /><div className="innovation-entry-list">{items.length === 0 && <div className="innovation-empty">还没有竞赛记录。添加后选择级别、奖项、团队排名和认定状态。</div>}{items.map((entry) => <Entry key={entry.id} title={entry.title} score={competitionScore(entry)} onTitle={(title) => update(setItems, entry.id, { title })} onDelete={() => setItems((previous) => previous.filter((item) => item.id !== entry.id))}><EntryField label="竞赛级别"><select value={entry.level} onChange={(event) => update(setItems, entry.id, { level: event.target.value as CompetitionLevel })}>{Object.entries(COMP_LEVELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></EntryField><EntryField label="获奖情况"><select value={entry.award} onChange={(event) => update(setItems, entry.id, { award: event.target.value as CompetitionAward })}>{Object.entries(COMP_AWARDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></EntryField><EntryField label="团队项目"><input type="checkbox" checked={entry.team} onChange={(event) => update(setItems, entry.id, { team: event.target.checked })} /></EntryField>{entry.team && <EntryField label="团队排名"><input type="number" value={entry.rank} onChange={(event) => update(setItems, entry.id, { rank: event.target.value })} min="1" step="1" placeholder="必填" /></EntryField>}<EntryField label="认定状态"><StatusSelect value={entry.status} onChange={(status) => update(setItems, entry.id, { status })} label="竞赛认定状态" /></EntryField></Entry>)}</div></section>;
}

export function SrtpSection({ items, setItems, update }: { items: Srtp[]; setItems: Dispatch<SetStateAction<Srtp[]>>; update: UpdateRecords }) {
  return <section className="warning-section innovation-section"><SectionHeading index="04" title="大学生创新创业训练计划" description="必须结题合格并提交不少于 5000 字总结报告；同一题目只按最高级别认定。" action={<AddButton onClick={() => setItems((previous) => [...previous, newSrtp()])}>添加大创项目</AddButton>} /><div className="innovation-entry-list">{items.length === 0 && <div className="innovation-empty">还没有大创项目记录。</div>}{items.map((entry) => <Entry key={entry.id} title={entry.title} score={srtpScore(entry)} onTitle={(title) => update(setItems, entry.id, { title })} onDelete={() => setItems((previous) => previous.filter((item) => item.id !== entry.id))}><EntryField label="项目级别"><select value={entry.level} onChange={(event) => update(setItems, entry.id, { level: event.target.value as SrtpLevel })}>{Object.entries(SRTP_LEVELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></EntryField><EntryField label="项目角色"><select value={entry.role} onChange={(event) => update(setItems, entry.id, { role: event.target.value as Role })}><option value="leader">负责人</option><option value="member">成员</option></select></EntryField><EntryField label="认定状态"><StatusSelect value={entry.status} onChange={(status) => update(setItems, entry.id, { status })} label="大创项目认定状态" /></EntryField></Entry>)}</div></section>;
}

export function ScienceSection({ science, setScience, update, patents, setPatents, papers, setPapers }: { science: Science[]; setScience: Dispatch<SetStateAction<Science[]>>; update: UpdateRecords; patents: Patent[]; setPatents: Dispatch<SetStateAction<Patent[]>>; papers: Paper[]; setPapers: Dispatch<SetStateAction<Paper[]>> }) {
  return <section className="warning-section innovation-section"><SectionHeading index="05" title="科技成果、专利与论文" description="成果的署名单位、排名、申请号/出版证明和正式认定必须分别核对。" /><Subsection title="科技成果获奖" detail="国家级 8 学分、省部级 6 学分；其他类别由教务处另行认定" action={<AddButton onClick={() => setScience((previous) => [...previous, newScience()])}>添加成果</AddButton>}><div className="innovation-entry-list">{science.map((entry) => <Entry key={entry.id} title={entry.title} score={scienceScore(entry)} onTitle={(title) => update(setScience, entry.id, { title })} onDelete={() => setScience((previous) => previous.filter((item) => item.id !== entry.id))}><EntryField label="成果级别"><select value={entry.level} onChange={(event) => update(setScience, entry.id, { level: event.target.value as Science["level"] })}><option value="national">国家级</option><option value="provincial">省部级</option><option value="other">其他（教务处认定）</option></select></EntryField>{entry.level === "other" && <EntryField label="教务处核定学分"><input type="number" value={entry.credits} onChange={(event) => update(setScience, entry.id, { credits: event.target.value })} min="0" step="0.1" placeholder="待核定" /></EntryField>}<EntryField label="认定状态"><StatusSelect value={entry.status} onChange={(status) => update(setScience, entry.id, { status })} label="科技成果认定状态" /></EntryField></Entry>)}</div></Subsection><Subsection title="专利 / 软件著作权" detail="第一专利权人/著作权人为北化；同一事项不可重复认定" action={<AddButton onClick={() => setPatents((previous) => [...previous, newPatent()])}>添加专利</AddButton>}><div className="innovation-entry-list">{patents.map((entry) => <Entry key={entry.id} title={entry.title} score={patentScore(entry)} onTitle={(title) => update(setPatents, entry.id, { title })} onDelete={() => setPatents((previous) => previous.filter((item) => item.id !== entry.id))}><EntryField label="本人排名"><input type="number" value={entry.rank} onChange={(event) => update(setPatents, entry.id, { rank: event.target.value })} min="1" step="1" /></EntryField><EntryField label="认定状态"><StatusSelect value={entry.status} onChange={(status) => update(setPatents, entry.id, { status })} label="专利认定状态" /></EntryField></Entry>)}</div></Subsection><Subsection title="发表论文" detail="第一署名单位为北化；导师第一、学生第二按手册计最高分" action={<AddButton onClick={() => setPapers((previous) => [...previous, newPaper()])}>添加论文</AddButton>}><div className="innovation-entry-list">{papers.map((entry) => <Entry key={entry.id} title={entry.title} score={paperScore(entry)} onTitle={(title) => update(setPapers, entry.id, { title })} onDelete={() => setPapers((previous) => previous.filter((item) => item.id !== entry.id))}><EntryField label="刊物类型"><select value={entry.kind} onChange={(event) => update(setPapers, entry.id, { kind: event.target.value as PaperKind })}>{Object.entries(PAPER_KINDS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></EntryField><EntryField label="作者排名"><select value={entry.rank} onChange={(event) => update(setPapers, entry.id, { rank: event.target.value as PaperRank })}><option value="first">第一作者</option><option value="advisor-second">导师第一、学生第二</option><option value="other">其他排名</option></select></EntryField><EntryField label="认定状态"><StatusSelect value={entry.status} onChange={(status) => update(setPapers, entry.id, { status })} label="论文认定状态" /></EntryField></Entry>)}</div></Subsection></section>;
}

function Subsection({ title, detail, action, children }: { title: string; detail: string; action: ReactNode; children: ReactNode }) {
  return <div className="innovation-subsection"><div className="innovation-subheading"><div><strong>{title}</strong><small>{detail}</small></div>{action}</div>{children}</div>;
}

export function OtherSection({ lectures, setLectures, update, certifications, setCertifications, startups, setStartups, updateStartup }: { lectures: Lecture[]; setLectures: Dispatch<SetStateAction<Lecture[]>>; update: UpdateRecords; certifications: SimpleRecord[]; setCertifications: Dispatch<SetStateAction<SimpleRecord[]>>; startups: Startup[]; setStartups: Dispatch<SetStateAction<Startup[]>>; updateStartup: UpdateRecords }) {
  return <section className="warning-section innovation-section"><SectionHeading index="06" title="讲座、职业认证与自主创业" description="这些项目同样需要签到、心得、证书、公司注册或学校认定材料。" /><Subsection title="学术讲座或报告" detail="刷卡签到并提交心得；每次 0.1 学分，由举办单位认定" action={<AddButton onClick={() => setLectures((previous) => [...previous, newLecture()])}>添加讲座</AddButton>}><div className="innovation-entry-list">{lectures.map((entry) => <Entry key={entry.id} title={entry.title} score={lectureScore(entry)} onTitle={(title) => update(setLectures, entry.id, { title })} onDelete={() => setLectures((previous) => previous.filter((item) => item.id !== entry.id))}><EntryField label="次数"><input type="number" value={entry.count} onChange={(event) => update(setLectures, entry.id, { count: event.target.value })} min="1" step="1" /></EntryField><EntryField label="认定状态"><StatusSelect value={entry.status} onChange={(status) => update(setLectures, entry.id, { status })} label="讲座认定状态" /></EntryField></Entry>)}</div></Subsection><Subsection title="职业认证" detail="国家认证部门颁发的证书，手册表值 1 学分" action={<AddButton onClick={() => setCertifications((previous) => [...previous, newSimple("certification")])}>添加认证</AddButton>}><div className="innovation-entry-list">{certifications.map((entry) => <Entry key={entry.id} title={entry.title} score={recognized(entry.status, 1)} onTitle={(title) => update(setCertifications, entry.id, { title })} onDelete={() => setCertifications((previous) => previous.filter((item) => item.id !== entry.id))}><EntryField label="认定状态"><StatusSelect value={entry.status} onChange={onStatus => update(setCertifications, entry.id, { status: onStatus })} label="职业认证状态" /></EntryField></Entry>)}</div></Subsection><Subsection title="自主创业" detail="注册公司；法定代表人 6 学分，其他股东按排名从 4 学分起递减" action={<AddButton onClick={() => setStartups((previous) => [...previous, newStartup()])}>添加创业记录</AddButton>}><div className="innovation-entry-list">{startups.map((entry) => <Entry key={entry.id} title={entry.title} score={startupScore(entry)} onTitle={(title) => updateStartup(setStartups, entry.id, { title })} onDelete={() => setStartups((previous) => previous.filter((item) => item.id !== entry.id))}><EntryField label="身份"><select value={entry.role} onChange={(event) => updateStartup(setStartups, entry.id, { role: event.target.value as Startup["role"] })}><option value="legal">法定代表人</option><option value="shareholder">其他股东</option></select></EntryField>{entry.role === "shareholder" && <EntryField label="股东排名"><input type="number" value={entry.rank} onChange={(event) => updateStartup(setStartups, entry.id, { rank: event.target.value })} min="1" step="1" /></EntryField>}<EntryField label="认定状态"><StatusSelect value={entry.status} onChange={(status) => updateStartup(setStartups, entry.id, { status })} label="自主创业认定状态" /></EntryField></Entry>)}</div></Subsection></section>;
}

export function SimpleOtherSection({ items, setItems, update }: { items: OtherRecord[]; setItems: Dispatch<SetStateAction<OtherRecord[]>>; update: UpdateRecords }) {
  return <section className="warning-section innovation-section"><SectionHeading index="07" title="教务处认定的其他项目" description="只填写已经给出正式核定学分的项目；没有核定结果时不要自行估分。" action={<AddButton onClick={() => setItems((previous) => [...previous, newOther()])}>添加其他项目</AddButton>} /><div className="innovation-entry-list">{items.length === 0 && <div className="innovation-empty">没有其他项目记录。</div>}{items.map((entry) => <Entry key={entry.id} title={entry.title} score={recognized(entry.status, numberValue(entry.credits))} onTitle={(title) => update(setItems, entry.id, { title })} onDelete={() => setItems((previous) => previous.filter((item) => item.id !== entry.id))}><EntryField label="教务处核定学分"><input type="number" value={entry.credits} onChange={(event) => update(setItems, entry.id, { credits: event.target.value })} min="0" step="0.1" placeholder="例如 0.5" /></EntryField><EntryField label="认定状态"><StatusSelect value={entry.status} onChange={(status) => update(setItems, entry.id, { status })} label="其他项目认定状态" /></EntryField></Entry>)}</div></section>;
}
