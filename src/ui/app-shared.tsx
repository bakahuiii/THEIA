/* eslint-disable react-refresh/only-export-components */
import { ExternalLink, Wifi, WifiOff, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { bridge } from "../bridge";
import type { Assignment, AuthStatus, CampusState, SourceName } from "../types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type ViewId =
  | "dashboard"
  | "schedule"
  | "map"
  | "exams"
  | "grades"
  | "progress"
  | "courses"
  | "selection"
  | "assignments"
  | "notices"
  | "mailbox"
  | "tools"
  | "settings";
export type Term = { id: string; label: string };

export function formatDate(value?: string | null, withTime = true) {
  if (!value) return "待公布";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(
    "zh-CN",
    withTime
      ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
      : { year: "numeric", month: "short", day: "numeric" },
  ).format(date);
}

export function relativeTime(value?: string | null, now = Date.now()) {
  if (!value) return "尚未同步";
  const delta = new Date(value).getTime() - now;
  if (!Number.isFinite(delta)) return value;
  const abs = Math.abs(delta);
  if (abs < 60_000) return "刚刚";
  if (abs < 3_600_000)
    return `${Math.round(abs / 60_000)} 分钟${delta < 0 ? "前" : "后"}`;
  if (abs < 86_400_000)
    return `${Math.round(abs / 3_600_000)} 小时${delta < 0 ? "前" : "后"}`;
  return `${Math.round(abs / 86_400_000)} 天${delta < 0 ? "前" : "后"}`;
}

export function isExpiredAssignment(item: Assignment) {
  if (item.status === "submitted" || !item.dueAt) return false;
  const dueAt = new Date(item.dueAt).getTime();
  return Number.isFinite(dueAt) && dueAt <= Date.now();
}

export function sourceLabel(source: SourceName) {
  return source === "jwglxt" ? "教务系统" : "北化在线THEOL";
}

export function remarkTone(value?: string | null) {
  const text = String(value || "");
  if (/缺考|不合格|不及格|未通过|挂科|违纪|作弊/.test(text)) return "danger";
  if (/不统计|免体|免训|合格|通过/.test(text)) return "info";
  if (/补考|缓考|重修/.test(text)) return "attention";
  return "neutral";
}

export type ScoreTone = "low" | "excellent" | "neutral";
export type GpaTone = "warning" | "excellent" | "neutral";

export function scoreTone(value?: string | number | null): ScoreTone {
  const text = String(value ?? "").trim();
  const normalized = text.toUpperCase();
  if (/缺考|不合格|不及格|未通过|挂科|违纪|作弊/.test(text) || normalized === "U" || normalized === "F") {
    return "low";
  }
  if (/优秀/.test(text) || normalized === "A" || normalized === "A+") {
    return "excellent";
  }

  const match = text.match(/-?\d+(?:\.\d+)?/);
  const score = match ? Number(match[0]) : Number.NaN;
  if (!Number.isFinite(score)) return "neutral";
  if (score < 60) return "low";
  if (score > 90) return "excellent";
  return "neutral";
}

export function gpaTone(value?: string | number | null): GpaTone {
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) return "neutral";
  if (parsed < 2) return "warning";
  if (parsed >= 4) return "excellent";
  return "neutral";
}

export function formatGradePoint(value?: string | number | null) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return "--";
  }
  const parsed =
    typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed.toFixed(2) : String(value);
}

export function parseExamTime(
  startAt: string | null | undefined,
  examTime: string | null | undefined,
) {
  if (startAt) {
    const timestamp = new Date(startAt).getTime();
    if (!Number.isNaN(timestamp)) return timestamp;
  }
  const match = examTime?.match(/(\d{4}-\d{2}-\d{2})/);
  if (!match) return 0;
  const timestamp = new Date(match[1]).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function matchTerm(
  itemTermId: string | null | undefined,
  filter: string,
) {
  if (!filter) return true;
  if (!itemTermId) return false;
  return filter.includes("-")
    ? itemTermId === filter
    : itemTermId.startsWith(`${filter}-`);
}

export function localDateTimeValue(value?: string | null) {
  const date = value ? new Date(value) : new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function EmptyState({
  icon: Icon,
  title,
  detail,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
}) {
  return (
    <div className="empty-state">
      <Icon size={24} />
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

export function StatusDot({
  source,
  status,
}: {
  source: SourceName;
  status: AuthStatus[SourceName];
}) {
  const connected = status?.connected;
  const Icon = connected ? Wifi : WifiOff;
  return (
    <span
      className={`source-status ${connected ? "connected" : "offline"}`}
      title={
        status?.error ||
        `${sourceLabel(source)}${connected ? "已连接" : "未连接"}`
      }
    >
      <Icon size={14} /> {sourceLabel(source)}
    </span>
  );
}

export function SourceButton({
  url,
  children,
}: {
  url?: string | null;
  children?: ReactNode;
}) {
  if (!url) return null;
  return (
    <button
      className="task-command"
      onClick={() => void bridge.openSource(url)}
    >
      <ExternalLink size={15} /> {children}
    </button>
  );
}

export function SyncChip({
  state,
  syncing,
  status,
}: {
  state: CampusState;
  syncing: boolean;
  status?: {
    kind: "syncing" | "failed" | "idle" | "ready";
    label: string;
    detail: string;
  };
}) {
  const statusKind = status?.kind || (syncing
    ? "syncing"
    : state.sync.lastError
      ? "failed"
      : "ready");
  const failed = statusKind === "failed";
  const activelySyncing = statusKind === "syncing";
  const label = status?.label || (syncing
    ? "同步中"
    : failed
      ? "部分异常"
      : state.sync.lastSuccessAt
        ? "本地数据就绪"
        : "等待同步");
  const detail = status?.detail || (state.sync.lastSuccessAt
    ? `更新于 ${relativeTime(state.sync.lastSuccessAt)}`
    : "尚无成功同步");
  return (
    <span
      className={`sync-chip ${activelySyncing ? "syncing" : failed ? "failed" : "ready"}`}
      title={status?.detail || state.sync.lastError || detail}
    >
      <span className="sync-chip-dot" />
      <span>{label}</span>
    </span>
  );
}

export function TermSelector({
  terms,
  value,
  onChange,
}: {
  terms: Term[];
  value: string;
  onChange: (value: string) => void;
}) {
  if (!terms.length) return null;
  const years = [...new Set(terms.map((term) => term.id.split("-")[0]))].sort(
    (left, right) => Number(right) - Number(left),
  );
  const [year = "", selectedTerm = ""] = value.split("-");
  const availableTerms = year
    ? terms
        .filter((term) => term.id.startsWith(`${year}-`))
        .map((term) => ({ code: term.id.split("-")[1], label: term.label }))
    : [];
  return (
    <div className="term-selector-group">
      <Select
        value={year || "__all__"}
        onValueChange={(nextYear) =>
          onChange(nextYear === "__all__" ? "" : nextYear)
        }
      >
        <SelectTrigger className="term-selector-trigger" size="sm">
          <SelectValue placeholder="全部年份" />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectItem value="__all__">全部年份</SelectItem>
        {years.map((item) => (
          <SelectItem key={item} value={item}>
            {item}-{Number(item) + 1}
          </SelectItem>
        ))}
        </SelectContent>
      </Select>
      {year && availableTerms.length > 0 && (
        <Select
          value={selectedTerm || "__all__"}
          onValueChange={(nextTerm) =>
            onChange(nextTerm === "__all__" ? year : year + "-" + nextTerm)
          }
        >
          <SelectTrigger className="term-selector-trigger" size="sm">
            <SelectValue placeholder="全部学期" />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="__all__">全部学期</SelectItem>
          {availableTerms.map((term) => (
            <SelectItem key={term.code} value={term.code}>
              {term.label}
            </SelectItem>
          ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  detail,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  detail: string;
}) {
  return (
    <label className="setting-row">
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i aria-hidden="true" />
    </label>
  );
}
