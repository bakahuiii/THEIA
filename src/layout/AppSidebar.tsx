import { Database, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { useMemo } from "react";
import { navGroups, navItems } from "../ui/navigation";
import { SyncChip, type ViewId } from "../ui/app-shared";
import type { CampusState } from "../types";

type AppSidebarProps = {
  state: CampusState;
  apiBase: string;
  syncing: boolean;
  syncFreshness: {
    kind: "syncing" | "failed" | "idle" | "ready";
    label: string;
    detail: string;
  };
  view: ViewId;
  settingsOpen: boolean;
  open: boolean;
  collapsed: boolean;
  onNavigate: (view: ViewId) => void;
  onClose: () => void;
  onToggleCollapsed: () => void;
  onOpenSettings: () => void;
  mark: string;
};

function apiHostLabel(baseUrl: string) {
  if (!baseUrl) return "未启动";
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export function AppSidebar({
  state,
  apiBase,
  syncing,
  syncFreshness,
  view,
  settingsOpen,
  open,
  collapsed,
  onNavigate,
  onClose,
  onToggleCollapsed,
  onOpenSettings,
  mark,
}: AppSidebarProps) {
  const unfinishedAssignments = useMemo(
    () => state.assignments.filter((item) => item.status !== "submitted").length,
    [state.assignments],
  );
  return (
    <>
      <aside
        className={["sidebar", open ? "open" : "", collapsed ? "collapsed" : ""]
          .filter(Boolean)
        .join(" ")}
      >
        <div className="sidebar-status-dock">
          <SyncChip state={state} syncing={syncing} status={syncFreshness} />
          <span>{syncFreshness.detail}</span>
        </div>
        <div className="brand">
          <div className="brand-mark">
            <img src={mark} alt="THEIA" />
          </div>
          <div className="brand-wordmark">
            <strong>THEIA</strong>
            <span>Θεία</span>
          </div>
          <button
            type="button"
            className="sidebar-collapse"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
            title={collapsed ? "展开侧边栏" : "收起侧边栏"}
          >
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
          <button
            className="sidebar-close"
            onClick={onClose}
            aria-label="关闭导航"
          >
            <X size={20} />
          </button>
        </div>
        <nav className="sidebar-nav grouped-nav">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <span className="nav-group-label">{group.label}</span>
              {group.items.map((id) => {
                const item = navItems.find((entry) => entry.id === id);
                if (!item) return null;
                const Icon = item.icon;
                const isSettings = id === "settings";
                return (
                  <button
                    key={id}
                    className={
                      isSettings
                        ? settingsOpen
                          ? "active"
                          : ""
                        : view === id
                          ? "active"
                          : ""
                    }
                    onClick={() =>
                      isSettings ? onOpenSettings() : onNavigate(id)
                    }
                    aria-label={item.label}
                    title={item.label}
                  >
                    <Icon size={19} />
                    <span>{item.label}</span>
                    {id === "assignments" && unfinishedAssignments > 0 && (
                      <em>{unfinishedAssignments}</em>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sync-summary">
            <div>
              <span
                className={`sync-light ${syncFreshness.kind === "failed" ? "error" : ""}`}
              />
              <strong>{syncFreshness.label}</strong>
            </div>
            <span>{syncFreshness.detail}</span>
          </div>
          <button
            onClick={onOpenSettings}
            aria-label="本地 API 设置"
            title="本地 API 设置"
          >
            <Database size={17} />
            <span className="sidebar-api-label">
              本地 API <span className="api-port">{apiHostLabel(apiBase)}</span>
            </span>
          </button>
        </div>
      </aside>
      {open && (
        <button
          className="sidebar-scrim"
          onClick={onClose}
          aria-label="关闭导航"
        />
      )}
    </>
  );
}
