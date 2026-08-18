import { useState } from "react";
import { Activity, AlertTriangle, CalendarDays, FileText, Lightbulb, Search, Star } from "lucide-react";
import { AcademicCalendar } from "./tools/AcademicCalendar";
import { AcademicPlanView } from "./tools/AcademicPlanView";
import { FreeClassroomView } from "./tools/FreeClassroomView";
import { FitnessCalc } from "./tools/FitnessCalc";
import { WarningCalc } from "./tools/WarningCalc";
import { InnovationCalc } from "./tools/InnovationCalc";
import { SecondClassCalc } from "./tools/SecondClassCalc";
import type { CampusState, LocalDataCatalog, SyncRetryDomain } from "../types";

type Tab = "documents" | "free-classroom" | "fitness" | "warning" | "innovation" | "second";

const TABS: Array<{ id: Tab; label: string; icon: typeof Activity }> = [
  { id: "documents", label: "文档", icon: FileText },
  { id: "free-classroom", label: "空闲教室", icon: Search },
  { id: "fitness", label: "体测评分", icon: Activity },
  { id: "warning", label: "学业预警", icon: AlertTriangle },
  { id: "innovation", label: "创新学分", icon: Lightbulb },
  { id: "second", label: "第二课堂", icon: Star },
];

export function ToolsView({
  state,
  dataCatalog,
  apiBase,
  terms,
  calendarAssetUrls,
  academicPlanAssetBaseUrl,
  refreshingDomain,
  onRefreshDomain,
  onOpenSource,
  onOpenAttachment,
}: {
  state: CampusState;
  dataCatalog: LocalDataCatalog;
  apiBase: string;
  terms: Array<{ id: string; label: string }>;
  calendarAssetUrls?: Partial<Record<"calendar" | "teachingSchedule" | "weeklyCalendar", string>>;
  academicPlanAssetBaseUrl?: string;
  refreshingDomain: SyncRetryDomain | null;
  onRefreshDomain: (domain: SyncRetryDomain) => void;
  onOpenSource: (url: string) => void;
  onOpenAttachment: (domain: string, attachmentId: string) => Promise<{ cached: boolean }>;
}) {
  const [tab, setTab] = useState<Tab>("documents");
  const [documentTab, setDocumentTab] = useState<"calendar" | "plan">("calendar");
  return (
    <div className="tools-view">
      <div className="tools-tab-bar" role="tablist" aria-label="学习工具">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            type="button"
            key={id}
            className={`tools-tab ${tab === id ? "active" : ""}`}
            onClick={() => setTab(id)}
            role="tab"
            aria-selected={tab === id}
          >
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="tools-content">
        {tab === "fitness" && <FitnessCalc dataCatalog={dataCatalog} />}
        {tab === "documents" && (
          <div className="tools-document-view">
            <div className="tools-subtab-bar" role="tablist" aria-label="文档">
              <button type="button" className={documentTab === "calendar" ? "active" : ""} role="tab" aria-selected={documentTab === "calendar"} onClick={() => setDocumentTab("calendar")}><CalendarDays size={14} />校历</button>
              <button type="button" className={documentTab === "plan" ? "active" : ""} role="tab" aria-selected={documentTab === "plan"} onClick={() => setDocumentTab("plan")}><FileText size={14} />培养计划</button>
            </div>
            {documentTab === "calendar" && <AcademicCalendar dataCatalog={dataCatalog} apiBase={apiBase} assetUrls={calendarAssetUrls} />}
            {documentTab === "plan" && <AcademicPlanView state={state} refreshing={refreshingDomain === "academic-plan"} onRefresh={() => onRefreshDomain("academic-plan")} onOpenSource={onOpenSource} onOpenAttachment={onOpenAttachment} assetBaseUrl={academicPlanAssetBaseUrl} />}
          </div>
        )}
        {tab === "free-classroom" && <FreeClassroomView state={state} terms={terms} onOpenSource={onOpenSource} />}
        {tab === "warning" && <WarningCalc />}
        {tab === "innovation" && <InnovationCalc />}
        {tab === "second" && <SecondClassCalc />}
      </div>
    </div>
  );
}
