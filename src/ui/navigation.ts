import {
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Crosshair,
  GraduationCap,
  LayoutDashboard,
  Sparkles,
  Map as MapIcon,
  Settings,
  Wrench,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react";
import type { ViewId } from "./app-shared";

export const navItems: Array<{ id: ViewId; label: string; icon: LucideIcon }> =
  [
    { id: "dashboard", label: "概览", icon: LayoutDashboard },
    { id: "advisor", label: "学业顾问", icon: Sparkles },
    { id: "schedule", label: "课表", icon: CalendarDays },
    { id: "exams", label: "考试", icon: ClipboardCheck },
    { id: "grades", label: "成绩", icon: BarChart3 },
    { id: "progress", label: "学业", icon: GraduationCap },
    { id: "courses", label: "课程", icon: BookOpen },
    { id: "selection", label: "抢课", icon: Crosshair },
    { id: "assignments", label: "作业", icon: CheckCircle2 },
    { id: "notices", label: "通知与邮箱", icon: MessagesSquare },
    { id: "tools", label: "学习工具", icon: Wrench },
    { id: "map", label: "校园地图", icon: MapIcon },
    { id: "settings", label: "设置与接入", icon: Settings },
  ];

export const navGroups: Array<{ label: string; items: ViewId[] }> = [
  { label: "WORKSPACE", items: ["dashboard", "advisor", "schedule", "assignments"] },
  { label: "ACADEMIC", items: ["exams", "grades", "progress", "courses"] },
  {
    label: "TOOLS",
    items: ["selection", "notices", "tools", "map", "settings"],
  },
];

export const viewTitles: Record<ViewId, { title: string; subtitle: string }> = {
  dashboard: {
    title: "校园概览",
    subtitle: "课表、考试和待办集中在一个本地视图",
  },
  advisor: {
    title: "学业顾问",
    subtitle: "基于本地快照、固定规则与可追溯证据的决策工作台",
  },
  schedule: { title: "本周课表", subtitle: "按照星期和节次查看当前学期课程" },
  map: { title: "校园地图", subtitle: "昌平校区 · 教学地点定位" },
  exams: { title: "考试安排", subtitle: "考试时间、地点、校区和座号" },
  grades: { title: "成绩", subtitle: "课程成绩、学分和绩点汇总" },
  progress: {
    title: "学业进度",
    subtitle: "培养方案学分、课程完成情况与已选课",
  },
  courses: { title: "我的课程", subtitle: "北化在线THEOL课程与教师信息" },
  selection: {
    title: "抢课",
    subtitle: "检索全校教学班，并按你的时间和目标教学班执行",
  },
  assignments: { title: "作业与测试", subtitle: "按截止时间追踪课程任务" },
  notices: {
    title: "通知与邮箱",
    subtitle: "校园邮箱、教务系统与北化在线THEOL动态集中查看",
  },
  mailbox: {
    title: "通知与邮箱",
    subtitle: "校园邮箱、教务系统与北化在线THEOL动态集中查看",
  },
  tools: { title: "学习工具", subtitle: "体测评分、学业预警、创新学分、第二课堂积分计算器" },
  settings: { title: "设置与接入", subtitle: "同步、导出和 THEIA 数据接口" },
};
