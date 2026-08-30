import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  CircleHelp,
  Database,
  FileSearch,
  GraduationCap,
  Sigma,
  RefreshCw,
} from "lucide-react";
import type {
  AdvisorAcademicFailure,
  AdvisorAcademicRequirementNode,
  AdvisorAcademicScenarioResult,
  AdvisorDomainQuality,
  AdvisorOverview,
  AdvisorUrgentItem,
} from "../../types";
import { DataQualityBar } from "./DataQualityBar";
import { RiskList } from "./RiskList";
import { TopAction } from "./TopAction";
import {
  advisorConfidenceLabel,
  advisorRequirementSourceLabel,
} from "../../hooks/advisor-presentation.mjs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

type EmptyState = "confirmed" | "unconfirmed" | "hidden-all";

const QUALITY_LABELS = {
  complete: "完整",
  partial: "部分完整",
  unknown: "未知",
} as const;

const GPA_SOURCE_LABELS = {
  academicProgress: "学校学业进度",
  profile: "学校档案",
  local: "本地辅助计算",
} as const;

export type AdvisorInsightsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  overview: AdvisorOverview | null;
  actions: AdvisorUrgentItem[];
  loading: boolean;
  error: string | null;
  emptyState: EmptyState;
  pendingActionId: string | null;
  onRetry: () => void;
  onAction: (item: AdvisorUrgentItem) => void;
  onSnooze: (item: AdvisorUrgentItem) => void;
  onDismiss: (item: AdvisorUrgentItem) => void;
  onSelectDomain: (quality: AdvisorDomainQuality) => void;
  onEvidence: (title: string, references: string[]) => void;
  additionalCredits: string;
  onAdditionalCreditsChange: (value: string) => void;
  alternatives: AdvisorAcademicRequirementNode[];
  alternativeSelections: Record<string, string>;
  onAlternativeChange: (nodeId: string, value: string) => void;
  onRunWhatIf: () => void;
  scenario: AdvisorAcademicScenarioResult | null;
  scenarioLoading: boolean;
  scenarioError: string | null;
};

function creditText(value: string | null | undefined) {
  if (value === null || value === undefined || value === "") return "--";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return String(value);
  return parsed.toFixed(4).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function EmptyAcademicValue({ children }: { children: string }) {
  return <span className="mt-2 block break-words text-xs leading-5 text-[var(--muted-foreground)] [overflow-wrap:anywhere]">{children}</span>;
}

function RequirementTree({
  nodes,
  onEvidence,
}: {
  nodes: AdvisorAcademicRequirementNode[];
  onEvidence: (title: string, references: string[]) => void;
}) {
  if (!nodes.length) return <EmptyAcademicValue>当前本地快照没有可确认的培养方案树。</EmptyAcademicValue>;
  const renderNode = (node: AdvisorAcademicRequirementNode, depth: number) => (
    <li key={node.id} className="min-w-0">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-[var(--line)] py-3 last:border-b-0" style={{ paddingLeft: `${Math.min(depth, 4) * 14}px` }}>
        <div className="min-w-0">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <strong className="break-words text-sm text-[var(--ink)] [overflow-wrap:anywhere]">{node.title}</strong>
            {node.relation === "or" && <span className="rounded-sm border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200">可选分支</span>}
            <span className="rounded-sm border border-[var(--line)] px-1.5 py-0.5 text-[10px] text-[var(--muted-foreground)]">{QUALITY_LABELS[node.completeness]}</span>
          </span>
          <span className="mt-1.5 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--muted-foreground)]">
            <span>要求 {creditText(node.credits.required)}</span><span>已获 {creditText(node.credits.earned)}</span><span>尚缺 {creditText(node.credits.remaining)}</span>
          </span>
          {node.issues.length > 0 && <span className="mt-1.5 block break-words text-[10px] text-amber-700 dark:text-amber-300 [overflow-wrap:anywhere]">此节点含未确认字段或未选择的替代分支。</span>}
        </div>
        {node.credits.evidenceRefs.length > 0 && <button type="button" className="grid size-8 place-items-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--canvas)] hover:text-[var(--ink)]" onClick={() => onEvidence(node.title, node.credits.evidenceRefs)} title="查看证据" aria-label={`查看培养方案证据：${node.title}`}><FileSearch className="size-4" aria-hidden="true" /></button>}
      </div>
      {node.children.length > 0 && <ol>{node.children.map((child) => renderNode(child, depth + 1))}</ol>}
    </li>
  );
  return <ol className="mt-2 min-w-0">{nodes.map((node) => renderNode(node, 0))}</ol>;
}

function FailureList({ failures, onEvidence }: { failures: AdvisorAcademicFailure[]; onEvidence: (title: string, references: string[]) => void }) {
  if (!failures.length) return <EmptyAcademicValue>当前规则没有从已加载成绩中识别出不及格或缺考记录。</EmptyAcademicValue>;
  return <ul className="mt-3 grid min-w-0 gap-2">{failures.map((failure) => (
    <li key={failure.id} className="min-w-0 rounded-md border border-[var(--line)] bg-[var(--canvas)] p-3">
      <div className="flex min-w-0 items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-700 dark:text-red-300" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <strong className="block break-words text-sm text-[var(--ink)] [overflow-wrap:anywhere]">{failure.title || "未命名课程"}</strong>
          <span className="mt-1 block break-words text-[11px] text-[var(--muted-foreground)] [overflow-wrap:anywhere]">{[failure.courseCode, failure.recordedCredits ? `${creditText(failure.recordedCredits)} 学分` : null].filter(Boolean).join(" · ") || "课程号与学分未确认"}</span>
          <span className="mt-1.5 block text-[11px] text-[var(--muted-foreground)]">{failure.relationStatus === "known" ? `已通过${failure.matchBasis === "course-code" ? "课程号" : "明确关系"}关联培养方案节点` : "对培养方案的具体影响仍为未知"}</span>
        </span>
        {failure.evidenceRefs.length > 0 && <button type="button" className="grid size-8 shrink-0 place-items-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--paper)] hover:text-[var(--ink)]" onClick={() => onEvidence(failure.title || "课程记录", failure.evidenceRefs)} title="查看证据" aria-label={`查看课程证据：${failure.title || "未命名课程"}`}><FileSearch className="size-4" aria-hidden="true" /></button>}
      </div>
    </li>
  ))}</ul>;
}

function UpgradeStatus({ upgrade, onEvidence }: { upgrade: AdvisorOverview["academic"]["analysis"]["upgrade"] | undefined; onEvidence: (title: string, references: string[]) => void }) {
  if (!upgrade || upgrade.status === "not-configured") return <div className="mt-3 flex min-w-0 items-start gap-3 rounded-md border border-dashed border-[var(--line-strong)] p-3"><CircleHelp className="mt-0.5 size-4 shrink-0 text-[var(--muted-foreground)]" aria-hidden="true" /><span className="min-w-0"><strong className="block text-xs text-[var(--ink)]">升级线尚未配置</strong><span className="mt-1 block break-words text-[11px] leading-5 text-[var(--muted-foreground)] [overflow-wrap:anywhere]">当前没有经过版本化确认的门槛与计入范围，THEIA 不会凭空生成升级、毕业或学籍结论。</span></span></div>;
  const known = upgrade.status === "known";
  return <div className="mt-3 min-w-0 rounded-md border border-[var(--line)] bg-[var(--canvas)] p-3">
    <div className="flex min-w-0 items-start justify-between gap-3"><span className="min-w-0"><strong className="block break-words text-xs text-[var(--ink)] [overflow-wrap:anywhere]">{upgrade.rule?.sourceLabel || "当前规则配置"}</strong><span className="mt-1 block text-[11px] text-[var(--muted-foreground)]">门槛 {creditText(upgrade.threshold)} 学分 · 已计入 {creditText(upgrade.earned)} 学分</span>{upgrade.rule?.rulesVersion && <span className="mt-1 block break-words text-[10px] text-[var(--muted-foreground)] [overflow-wrap:anywhere]">规则版本：{upgrade.rule.rulesVersion}</span>}</span><span className="shrink-0 rounded-sm border border-[var(--line)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--muted-foreground)]">{known ? `算术差 ${creditText(upgrade.distance)}` : "无法判断"}</span></div>
    <p className="mt-2 break-words text-[10px] leading-4 text-[var(--muted-foreground)] [overflow-wrap:anywhere]">这只是版本化规则下的算术核对，不是升级、毕业或学籍结论。</p>
    {upgrade.evidenceRefs.length > 0 && <button type="button" className="mt-2 inline-flex min-h-7 items-center gap-1.5 rounded-md border border-[var(--line-strong)] px-2 text-[10px] font-semibold text-[var(--ink)]" onClick={() => onEvidence("升级线规则证据", upgrade.evidenceRefs)}><FileSearch className="size-3.5" aria-hidden="true" />查看证据</button>}
  </div>;
}

export function AdvisorInsightsDialog({
  open,
  onOpenChange,
  overview,
  actions,
  loading,
  error,
  emptyState,
  pendingActionId,
  onRetry,
  onAction,
  onSnooze,
  onDismiss,
  onSelectDomain,
  onEvidence,
  additionalCredits,
  onAdditionalCreditsChange,
  alternatives,
  alternativeSelections,
  onAlternativeChange,
  onRunWhatIf,
  scenario,
  scenarioLoading,
  scenarioError,
}: AdvisorInsightsDialogProps) {
  const academic = overview?.academic.analysis;
  const gpa = academic?.gpa;
  const gpaEntries = Object.entries(gpa?.sources || {}) as Array<[keyof typeof GPA_SOURCE_LABELS, NonNullable<typeof gpa>["sources"][keyof NonNullable<typeof gpa>["sources"]]]>;
  const scenarioResult = scenario?.analysis.scenario;
  const showEvidence = (title: string, references: string[]) => onEvidence(title, references);

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="advisor-insights-dialog max-h-[min(52rem,88vh)] max-w-[min(88rem,calc(100vw-2rem))] overflow-hidden p-0" overlayClassName="advisor-insights-overlay">
      <DialogHeader className="advisor-insights-heading"><span className="advisor-insights-heading-mark" aria-hidden="true"><Database className="size-5" /></span><span className="min-w-0"><DialogTitle>学业仪表盘</DialogTitle><DialogDescription>本地快照、培养方案和情景演算集中在此处。</DialogDescription></span></DialogHeader>
      <div className="advisor-insights-scroll min-w-0 overflow-y-auto px-5 pb-6 sm:px-6">
        <div className="advisor-quality"><DataQualityBar dataQuality={overview?.dataQuality || null} loading={loading && !overview} error={error} onRetry={onRetry} onSelectDomain={onSelectDomain} /></div>
        <div className="advisor-action-grid grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)]">
          <TopAction item={actions[0] || null} loading={loading && !overview} error={error} emptyState={emptyState} actionPending={pendingActionId === actions[0]?.id} onRetry={onRetry} onAction={onAction} onShowEvidence={(references, item) => showEvidence(item.title, references)} onSnooze={onSnooze} onDismiss={onDismiss} />
          <RiskList items={actions.slice(1)} loading={loading && !overview} error={error} emptyState={emptyState} maxItems={6} startRank={2} pendingActionId={pendingActionId} onRetry={onRetry} onAction={(item) => onAction(item as AdvisorUrgentItem)} onShowEvidence={(references, item) => showEvidence(item.title, references)} onSnooze={(item) => onSnooze(item as AdvisorUrgentItem)} onDismiss={(item) => onDismiss(item as AdvisorUrgentItem)} />
        </div>
        <section className="advisor-summary-grid grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4" aria-label="学业概要">
          <button type="button" className="min-w-0 rounded-md border border-[var(--line)] bg-[var(--paper)] p-3 text-left" onClick={() => showEvidence("GPA 证据", gpa?.selected?.evidenceRefs || [])}><span className="text-[10px] font-semibold text-[var(--muted-foreground)]">GPA</span><strong className="mt-1 block break-words text-xl tabular-nums text-[var(--ink)] [overflow-wrap:anywhere]">{gpa?.selected?.value || "--"}<small className="ml-1 text-xs font-normal text-[var(--muted-foreground)]">/4.33</small></strong><span className="mt-1 block text-[10px] text-[var(--muted-foreground)]">{gpa?.selectedSource ? GPA_SOURCE_LABELS[gpa.selectedSource] : "来源未知"}</span></button>
          <button type="button" className="min-w-0 rounded-md border border-[var(--line)] bg-[var(--paper)] p-3 text-left" onClick={() => showEvidence("培养方案已获学分", academic?.requirements.summary.evidenceRefs || [])}><span className="text-[10px] font-semibold text-[var(--muted-foreground)]">培养方案已获</span><strong className="mt-1 block text-xl tabular-nums text-[var(--ink)]">{creditText(academic?.requirements.summary.earned)}</strong><span className="mt-1 block text-[10px] text-[var(--muted-foreground)]">学分</span></button>
          <button type="button" className="min-w-0 rounded-md border border-[var(--line)] bg-[var(--paper)] p-3 text-left" onClick={() => showEvidence("培养方案学分缺口", academic?.requirements.summary.evidenceRefs || [])}><span className="text-[10px] font-semibold text-[var(--muted-foreground)]">尚缺</span><strong className="mt-1 block text-xl tabular-nums text-[var(--ink)]">{creditText(academic?.requirements.summary.remaining)}</strong><span className="mt-1 block text-[10px] text-[var(--muted-foreground)]">学分 · {QUALITY_LABELS[academic?.requirements.completeness || "unknown"]}</span></button>
          <div className="min-w-0 rounded-md border border-[var(--line)] bg-[var(--paper)] p-3"><span className="text-[10px] font-semibold text-[var(--muted-foreground)]">需核对课程</span><strong className="mt-1 block text-xl tabular-nums text-[var(--ink)]">{academic?.failures.length ?? "--"}</strong><span className="mt-1 block text-[10px] text-[var(--muted-foreground)]">不及格、缺考或未通过记录</span></div>
        </section>
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,.85fr)]">
          <section className="advisor-panel min-w-0 rounded-md border border-[var(--line)] bg-[var(--paper)] p-4"><header className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] pb-3"><span className="min-w-0"><span className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]"><GraduationCap className="size-4" aria-hidden="true" />培养方案</span><span className="mt-1 block break-words text-[11px] text-[var(--muted-foreground)] [overflow-wrap:anywhere]">{academic?.requirements.program || "专业名称未记录"} · {advisorRequirementSourceLabel(academic?.requirements.source, academic?.requirements.requirementSource)}</span></span><span className="rounded-sm border border-[var(--line)] px-2 py-1 text-[10px] font-semibold text-[var(--muted-foreground)]">{QUALITY_LABELS[academic?.requirements.completeness || "unknown"]}</span></header><RequirementTree nodes={academic?.requirements.roots || []} onEvidence={showEvidence} /></section>
          <div className="grid min-w-0 content-start gap-4">
            <section className="advisor-panel min-w-0 rounded-md border border-[var(--line)] bg-[var(--paper)] p-4"><header className="flex items-center gap-2 border-b border-[var(--line)] pb-3 text-sm font-semibold text-[var(--ink)]"><Sigma className="size-4" aria-hidden="true" />GPA 口径</header>{gpaEntries.length ? <ul className="mt-3 grid gap-2">{gpaEntries.map(([source, entry]) => entry && <li key={source} className="flex min-w-0 items-center justify-between gap-3 rounded-md bg-[var(--canvas)] px-3 py-2"><span className="min-w-0"><strong className="block break-words text-xs text-[var(--ink)] [overflow-wrap:anywhere]">{GPA_SOURCE_LABELS[source]}</strong><span className="text-[10px] text-[var(--muted-foreground)]">置信度 {advisorConfidenceLabel(entry.confidence)}</span></span><button type="button" className="shrink-0 text-right" onClick={() => showEvidence(`${GPA_SOURCE_LABELS[source]} GPA`, entry.evidenceRefs)}><strong className="block text-sm tabular-nums text-[var(--ink)]">{entry.value}</strong><span className="text-[10px] text-[var(--muted-foreground)]">/4.33</span></button></li>)}</ul> : <EmptyAcademicValue>学校记录和本地成绩均不足以计算 GPA。</EmptyAcademicValue>}{gpa?.discrepancy.state === "present" && <button type="button" className="mt-3 block w-full rounded-md border border-amber-200 bg-amber-50 p-2.5 text-left text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" onClick={() => showEvidence("学校 GPA 来源差异", gpa.discrepancy.evidenceRefs)}><span className="block">两个学校来源相差 {gpa.discrepancy.difference}。THEIA 不推断哪个来源最终有效。</span><span className="mt-1 block text-[10px] font-semibold">查看来源证据与数据质量</span></button>}{gpa?.localBoundary && <p className="mt-3 break-words text-[10px] leading-4 text-[var(--muted-foreground)] [overflow-wrap:anywhere]">本地辅助口径计入 {gpa.localBoundary.includedCourses} 门、{creditText(gpa.localBoundary.includedCredits)} 学分；仅用于核对，不替代学校 GPA。</p>}</section>
            <section className="advisor-panel min-w-0 rounded-md border border-[var(--line)] bg-[var(--paper)] p-4"><header className="flex items-center gap-2 border-b border-[var(--line)] pb-3 text-sm font-semibold text-[var(--ink)]"><GraduationCap className="size-4" aria-hidden="true" />升级线核对</header><UpgradeStatus upgrade={academic?.upgrade} onEvidence={showEvidence} /></section>
            <section className="advisor-panel min-w-0 rounded-md border border-[var(--line)] bg-[var(--paper)] p-4"><header className="flex items-center gap-2 border-b border-[var(--line)] pb-3 text-sm font-semibold text-[var(--ink)]"><AlertTriangle className="size-4" aria-hidden="true" />课程风险关联</header><FailureList failures={academic?.failures || []} onEvidence={showEvidence} /></section>
          </div>
        </div>
        <section className="advisor-panel advisor-what-if min-w-0 rounded-md border border-[var(--line)] bg-[var(--paper)] p-4"><header className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] pb-3"><span className="min-w-0"><span className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]"><Calculator className="size-4" aria-hidden="true" />What-if 纯算术情景</span><span className="mt-1 block break-words text-[11px] text-[var(--muted-foreground)] [overflow-wrap:anywhere]">只计算假设下的学分缺口，不预测成绩，不写回校园数据，也不保证学校最终认可。</span></span><span className="rounded-sm border border-violet-200 bg-violet-50 px-2 py-1 text-[10px] font-semibold text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100">仅本地演算</span></header>
          <div className="mt-4 grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(14rem,.65fr)_minmax(0,1.35fr)_auto]"><label className="grid min-w-0 gap-1.5 text-xs font-semibold text-[var(--ink)]">假设再获得必修学分<input type="number" min="0" max="500" step="0.5" value={additionalCredits} onChange={(event) => onAdditionalCreditsChange(event.target.value)} className="h-10 min-w-0 rounded-md border border-[var(--line-strong)] bg-[var(--canvas)] px-3 text-sm font-normal tabular-nums outline-none focus:border-[var(--teal)] focus:ring-2 focus:ring-[var(--teal)]/20" /></label><div className="grid min-w-0 gap-2">{alternatives.length ? alternatives.map((node) => <label key={node.id} className="grid min-w-0 gap-1.5 text-xs font-semibold text-[var(--ink)]">{node.title}的替代分支<select value={alternativeSelections[node.id] || ""} onChange={(event) => onAlternativeChange(node.id, event.target.value)} className="h-10 min-w-0 rounded-md border border-[var(--line-strong)] bg-[var(--canvas)] px-3 text-sm font-normal outline-none focus:border-[var(--teal)] focus:ring-2 focus:ring-[var(--teal)]/20"><option value="">暂不选择</option>{node.alternatives.map((alternative) => <option key={alternative.id} value={alternative.id}>{alternative.title}</option>)}</select></label>) : <span className="self-end rounded-md border border-dashed border-[var(--line-strong)] p-3 text-xs text-[var(--muted-foreground)]">当前培养方案没有可选择的 OR 分支。</span>}</div><button type="button" className="inline-flex min-h-10 self-end items-center justify-center gap-2 rounded-md bg-[var(--teal)] px-4 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-wait disabled:opacity-60 md:col-span-2 xl:col-span-1" onClick={onRunWhatIf} disabled={scenarioLoading}>{scenarioLoading ? <RefreshCw className="size-4 animate-spin" aria-hidden="true" /> : <Calculator className="size-4" aria-hidden="true" />}{scenarioLoading ? "正在计算" : "计算情景"}</button></div>
          {scenarioError && <p className="mt-3 break-words rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100 [overflow-wrap:anywhere]" role="alert">{scenarioError}</p>}{scenarioResult && <div className="mt-4 flex min-w-0 flex-wrap items-center gap-4 rounded-md border border-[var(--line)] bg-[var(--canvas)] p-4" role="status">{scenarioResult.status === "known" ? <CheckCircle2 className="size-5 shrink-0 text-emerald-700" aria-hidden="true" /> : <CircleHelp className="size-5 shrink-0 text-amber-700" aria-hidden="true" />}<span className="min-w-48 flex-1"><strong className="block text-sm text-[var(--ink)]">{scenarioResult.status === "known" ? `情景下尚缺 ${creditText(scenarioResult.remaining)} 学分` : "当前数据不足以计算该情景"}</strong><span className="mt-1 block break-words text-[11px] text-[var(--muted-foreground)] [overflow-wrap:anywhere]">{scenarioResult.status === "known" ? `基础缺口 ${creditText(scenarioResult.baseRemaining)} 学分；假设增加 ${creditText(scenarioResult.additionalRequiredCredits)} 学分。` : "未知不会被替换为零；请检查培养方案完整性或分支选择。"}</span></span>{scenarioResult.evidenceRefs.length > 0 && <button type="button" className="inline-flex min-h-9 items-center gap-2 rounded-md border border-[var(--line-strong)] px-3 text-xs font-semibold text-[var(--ink)]" onClick={() => showEvidence("What-if 情景证据", scenarioResult.evidenceRefs)}><FileSearch className="size-4" aria-hidden="true" />查看证据</button>}</div>}
        </section>
      </div>
    </DialogContent>
  </Dialog>;
}
