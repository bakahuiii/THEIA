import { useState } from "react";
import { Activity, AlertTriangle, CalendarDays, Lightbulb, Star } from "lucide-react";
import { AcademicCalendar } from "./tools/AcademicCalendar";
import { FitnessCalc } from "./tools/FitnessCalc";
import { WarningCalc } from "./tools/WarningCalc";
import { InnovationCalc } from "./tools/InnovationCalc";
import { SecondClassCalc } from "./tools/SecondClassCalc";
import type { LocalDataCatalog } from "../types";

type Tab = "fitness" | "calendar" | "warning" | "innovation" | "second";

const TABS: Array<{ id: Tab; label: string; icon: typeof Activity }> = [
  { id: "calendar", label: "校历", icon: CalendarDays },
  { id: "fitness", label: "体测评分", icon: Activity },
  { id: "warning", label: "学业预警", icon: AlertTriangle },
  { id: "innovation", label: "创新学分", icon: Lightbulb },
  { id: "second", label: "第二课堂", icon: Star },
];

export function ToolsView({ dataCatalog, apiBase, calendarAssetUrls }: { dataCatalog: LocalDataCatalog; apiBase: string; calendarAssetUrls?: Partial<Record<"calendar" | "teachingSchedule" | "weeklyCalendar", string>> }) {
  const [tab, setTab] = useState<Tab>("calendar");
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
        {tab === "calendar" && <AcademicCalendar dataCatalog={dataCatalog} apiBase={apiBase} assetUrls={calendarAssetUrls} />}
        {tab === "warning" && <WarningCalc />}
        {tab === "innovation" && <InnovationCalc />}
        {tab === "second" && <SecondClassCalc />}
      </div>
    </div>
  );
}
