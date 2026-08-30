export type ViewKey = "estimate" | "rules";
export type Status = "none" | "pending" | "recognized";
export type CompetitionLevel = "national" | "provincial" | "school" | "college";
export type CompetitionAward = "first" | "second" | "third" | "participation";
export type SrtpLevel = "national" | "beijing" | "school" | "college";
export type Role = "leader" | "member";
export type PaperKind = "sci" | "ei" | "noncore" | "conference";
export type PaperRank = "first" | "advisor-second" | "other";

export type Competition = {
  id: string;
  title: string;
  level: CompetitionLevel;
  award: CompetitionAward;
  team: boolean;
  rank: string;
  status: Status;
};
export type Srtp = { id: string; title: string; level: SrtpLevel; role: Role; status: Status };
export type Science = { id: string; title: string; level: "national" | "provincial" | "other"; credits: string; status: Status };
export type Patent = { id: string; title: string; rank: string; status: Status };
export type Paper = { id: string; title: string; kind: PaperKind; rank: PaperRank; status: Status };
export type Lecture = { id: string; title: string; count: string; status: Status };
export type SimpleRecord = { id: string; title: string; status: Status };
export type Startup = { id: string; title: string; role: "legal" | "shareholder"; rank: string; status: Status };
export type OtherRecord = { id: string; title: string; credits: string; status: Status };
export type PlatformState = { mentor: Status; cross: Status };

export const STATUS_LABELS: Record<Status, string> = { none: "未录入", pending: "待认定", recognized: "已认定" };
export const COMP_LEVELS: Record<CompetitionLevel, string> = { national: "国家级", provincial: "省部级", school: "校级", college: "院级" };
export const COMP_AWARDS: Record<CompetitionAward, string> = { first: "一等奖及以上", second: "二等奖", third: "三等奖", participation: "完整参加未获奖" };
export const COMP_SCORES: Record<CompetitionLevel, Partial<Record<CompetitionAward, number>>> = {
  national: { first: 5, second: 4, third: 3 },
  provincial: { first: 4, second: 3, third: 2, participation: 1.5 },
  school: { first: 3, second: 2, third: 1, participation: 0.5 },
  college: { first: 1, second: 0.5, third: 0.5, participation: 0.2 },
};
export const SRTP_LEVELS: Record<SrtpLevel, string> = { national: "国家级", beijing: "北京市级", school: "校级", college: "院级" };
export const SRTP_SCORES: Record<SrtpLevel, Record<Role, number>> = {
  national: { leader: 5, member: 4 },
  beijing: { leader: 4, member: 3 },
  school: { leader: 3, member: 2 },
  college: { leader: 2, member: 1 },
};
export const PAPER_KINDS: Record<PaperKind, string> = { sci: "SCI / SSCI / CSSCI", ei: "EI / ISTP / 中文核心", noncore: "非核心正式刊物", conference: "正式会议论文集" };
export const PAPER_SCORES: Record<PaperKind, { top: number; other: number }> = {
  sci: { top: 6, other: 2 },
  ei: { top: 4, other: 1 },
  noncore: { top: 2, other: 0.5 },
  conference: { top: 1, other: 0.5 },
};

let idSequence = 0;
const makeId = (prefix: string) => `${prefix}-${Date.now()}-${idSequence += 1}`;
export const numberValue = (value: string): number => {
  const parsed = Number(value);
  return value.trim() && Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};
export const integerValue = (value: string): number => Math.floor(numberValue(value));
export const fmt = (value: number): string => Number.isInteger(value) ? String(value) : value.toFixed(1);
export const recognized = (status: Status, value: number): number => status === "recognized" ? value : 0;

export const newCompetition = (): Competition => ({ id: makeId("competition"), title: "", level: "national", award: "first", team: false, rank: "", status: "none" });
export const newSrtp = (): Srtp => ({ id: makeId("srtp"), title: "", level: "national", role: "leader", status: "none" });
export const newScience = (): Science => ({ id: makeId("science"), title: "", level: "national", credits: "", status: "none" });
export const newPatent = (): Patent => ({ id: makeId("patent"), title: "", rank: "1", status: "none" });
export const newPaper = (): Paper => ({ id: makeId("paper"), title: "", kind: "sci", rank: "first", status: "none" });
export const newLecture = (): Lecture => ({ id: makeId("lecture"), title: "", count: "1", status: "none" });
export const newSimple = (prefix: string): SimpleRecord => ({ id: makeId(prefix), title: "", status: "none" });
export const newStartup = (): Startup => ({ id: makeId("startup"), title: "", role: "legal", rank: "1", status: "none" });
export const newOther = (): OtherRecord => ({ id: makeId("other"), title: "", credits: "", status: "none" });

const competitionBase = (entry: Competition): number => COMP_SCORES[entry.level][entry.award] ?? 0;
export const competitionValue = (entry: Competition): number => {
  const base = competitionBase(entry);
  if (entry.level === "national" && entry.award === "participation") return 0;
  if (!base || !entry.team) return base;
  const rank = integerValue(entry.rank);
  if (!rank) return base;
  return rank <= 3 ? base : Math.max(1, base - rank + 3);
};
export const competitionScore = (entry: Competition): number => recognized(entry.status, competitionValue(entry));
export const srtpScore = (entry: Srtp): number => recognized(entry.status, SRTP_SCORES[entry.level][entry.role]);
export const scienceValue = (entry: Science): number => entry.level === "national" ? 8 : entry.level === "provincial" ? 6 : numberValue(entry.credits);
export const scienceScore = (entry: Science): number => recognized(entry.status, scienceValue(entry));
export const patentValue = (entry: Patent): number => {
  const rank = integerValue(entry.rank);
  return rank ? rank <= 2 ? 4 : Math.max(1, 6 - rank) : 0;
};
export const patentScore = (entry: Patent): number => recognized(entry.status, patentValue(entry));
export const paperValue = (entry: Paper): number => entry.rank === "other" ? PAPER_SCORES[entry.kind].other : PAPER_SCORES[entry.kind].top;
export const paperScore = (entry: Paper): number => recognized(entry.status, paperValue(entry));
export const lectureValue = (entry: Lecture): number => numberValue(entry.count) * 0.1;
export const lectureScore = (entry: Lecture): number => recognized(entry.status, lectureValue(entry));
export const startupValue = (entry: Startup): number => entry.role === "legal" ? 6 : Math.max(1, 5 - integerValue(entry.rank));
export const startupScore = (entry: Startup): number => recognized(entry.status, startupValue(entry));

type TitledStatusRecord = { id: string; title: string; status: Status };
export const distinctTotals = <T extends TitledStatusRecord>(entries: T[], value: (entry: T) => number): { recognized: number; pending: number } => {
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

export const RULE_GROUPS = [
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
