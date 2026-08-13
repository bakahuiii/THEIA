import {
  ArrowUpRight,
  BookOpen,
  CreditCard,
  Dumbbell,
  GraduationCap,
  HeartPulse,
  KeyRound,
  Library,
  Mail,
  Network,
  type LucideIcon,
} from "lucide-react";
import { bridge } from "../bridge";

type ServiceEntry = {
  id: string;
  name: string;
  desc: string;
  url: string;
  tag: string;
};

const SERVICES: ServiceEntry[] = [
  {
    id: "ibuct",
    name: "i北化",
    desc: "学校统一门户，公告、一站式服务入口",
    url: "https://i.buct.edu.cn",
    tag: "门户",
  },
  {
    id: "jwglxt",
    name: "教务系统",
    desc: "选课、成绩查询、培养方案、考试安排",
    url: "https://jwglxt.buct.edu.cn/jwglxt/xtgl/index_initMenu.html",
    tag: "教务",
  },
  {
    id: "theol",
    name: "北化在线THEOL",
    desc: "网络教学平台，作业、通知、课程资料",
    url: "https://course.buct.edu.cn/meol/welcomepage/student/index.jsp",
    tag: "教学",
  },
  {
    id: "tygl",
    name: "体测成绩",
    desc: "国家学生体质健康标准测试成绩查询",
    url: "https://tygl.buct.edu.cn/",
    tag: "体育",
  },
  {
    id: "second",
    name: "第二课堂成绩单",
    desc: "查看五维度成绩、活动记录与认定",
    url: "https://2ndclass.buct.edu.cn/",
    tag: "第二课堂",
  },
  {
    id: "lib",
    name: "图书馆",
    desc: "图书馆资源、座位预约、检索系统",
    url: "https://lib.buct.edu.cn",
    tag: "图书馆",
  },
  {
    id: "mail",
    name: "学生邮箱",
    desc: "北化学生 @mail.buct.edu.cn 邮箱",
    url: "https://mail.buct.edu.cn",
    tag: "邮箱",
  },
  {
    id: "cas",
    name: "统一身份认证",
    desc: "修改密码、管理绑定信息",
    url: "https://cas.buct.edu.cn",
    tag: "账号",
  },
  {
    id: "health",
    name: "校医院预约",
    desc: "校医院门诊预约、就诊记录",
    url: "https://yywx.buct.edu.cn",
    tag: "校医院",
  },
  {
    id: "card",
    name: "校园卡自助服务",
    desc: "校园卡充值、消费查询、挂失",
    url: "https://card.buct.edu.cn",
    tag: "校园卡",
  },
  {
    id: "net",
    name: "网络服务",
    desc: "校园网账号、上网认证、流量查询",
    url: "https://net.buct.edu.cn",
    tag: "网络",
  },
  {
    id: "sport",
    name: "体育场馆预约",
    desc: "羽毛球、篮球、游泳馆等场地预约",
    url: "https://sports.buct.edu.cn",
    tag: "体育",
  },
  {
    id: "graduate",
    name: "研究生招生",
    desc: "保研、考研信息与推免系统",
    url: "https://yz.buct.edu.cn",
    tag: "升学",
  },
];

const TAG_COLORS: Record<string, string> = {
  "门户": "portal-tag-auth",
  "教务": "portal-tag-academic",
  "教学": "portal-tag-course",
  "第二课堂": "portal-tag-second",
  "图书馆": "portal-tag-library",
  "邮箱": "portal-tag-mail",
  "账号": "portal-tag-auth",
  "校医院": "portal-tag-medical",
  "校园卡": "portal-tag-card",
  "网络": "portal-tag-net",
  "体育": "portal-tag-sports",
  "升学": "portal-tag-grad",
};

const SERVICE_ICONS: Record<string, LucideIcon> = {
  ibuct: BookOpen,
  jwglxt: GraduationCap,
  theol: BookOpen,
  tygl: Dumbbell,
  second: GraduationCap,
  lib: Library,
  mail: Mail,
  cas: KeyRound,
  health: HeartPulse,
  card: CreditCard,
  net: Network,
  sport: Dumbbell,
  graduate: GraduationCap,
};

export function CampusPortalView() {
  return (
    <div className="portal-view">
      <div className="portal-grid">
        {SERVICES.map(svc => (
          <button key={svc.id} type="button" className="portal-card" onClick={() => void bridge.openSource(svc.url)}>
            <div className="portal-card-header">
              <span className="portal-card-icon" aria-hidden="true">
                {(() => {
                  const Icon = SERVICE_ICONS[svc.id] || BookOpen;
                  return <Icon size={17} strokeWidth={1.75} />;
                })()}
              </span>
              <span className={`portal-tag ${TAG_COLORS[svc.tag] ?? "portal-tag-academic"}`}>
                {svc.tag}
              </span>
            </div>
            <span className="portal-card-name">{svc.name}</span>
            <p className="portal-card-desc">{svc.desc}</p>
            <span className="portal-card-url">
              <span>在应用内打开</span>
              <ArrowUpRight size={14} strokeWidth={1.75} />
            </span>
          </button>
        ))}
      </div>
      <p className="portal-note">链接在应用内嵌窗口打开，自动复用统一身份认证会话。部分子站需校园网或 VPN。</p>
    </div>
  );
}
