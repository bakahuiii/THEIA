import { useEffect, useMemo, useRef, useState } from "react";
import { bridge } from "../bridge";
import { AdvisorInsightsDialog } from "../components/advisor/AdvisorInsightsDialog";
import { DataQualityDiagnostics } from "../components/advisor/DataQualityDiagnostics";
import { EvidenceDrawer } from "../components/advisor/EvidenceDrawer";
import { AdvisorWorkbench } from "../components/advisor/AdvisorWorkbench";
import {
  advisorDomainLabel,
  isAdvisorAgendaEmptyConfirmed,
  isCurrentAdvisorScenarioResponse,
} from "../hooks/advisor-presentation.mjs";
import type {
  AdvisorAcademicScenarioResult,
  AdvisorDomainQuality,
  AdvisorEvidence,
  AdvisorOverview,
  AdvisorUrgentItem,
  ModelStatus,
} from "../types";

type AdvisorViewProps = {
  overview: AdvisorOverview | null;
  actions: AdvisorUrgentItem[];
  modelStatus: ModelStatus;
  loading: boolean;
  error: string | null;
  pendingActionId: string | null;
  onRetry: () => void;
  onAction: (item: AdvisorUrgentItem) => void;
  onSnooze: (item: AdvisorUrgentItem) => void;
  onDismiss: (item: AdvisorUrgentItem) => void;
  onOpenSettings: () => void;
};

type EvidenceSelection = {
  title: string;
  entries: AdvisorEvidence[];
};

type ScenarioUiState = {
  revision: string | null;
  result: AdvisorAcademicScenarioResult | null;
  loading: boolean;
  error: string | null;
};

function evidenceFor(source: { evidence: AdvisorEvidence[] } | null, references: string[]) {
  if (!source || references.length === 0) return [];
  const wanted = new Set(references);
  return source.evidence.filter((entry) => wanted.has(entry.id));
}

export function AdvisorView({
  overview,
  actions,
  modelStatus,
  loading,
  error,
  pendingActionId,
  onRetry,
  onAction,
  onSnooze,
  onDismiss,
  onOpenSettings,
}: AdvisorViewProps) {
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [evidenceSelection, setEvidenceSelection] = useState<EvidenceSelection | null>(null);
  const [diagnosticSelection, setDiagnosticSelection] = useState<AdvisorDomainQuality | null>(null);
  const [restoreInsightsAfterSheet, setRestoreInsightsAfterSheet] = useState(false);
  const [additionalCredits, setAdditionalCredits] = useState("4");
  const [alternativeSelections, setAlternativeSelections] = useState<Record<string, string>>({});
  const [scenarioState, setScenarioState] = useState<ScenarioUiState>({
    revision: null,
    result: null,
    loading: false,
    error: null,
  });
  const scenarioRequestSequence = useRef(0);
  const overviewRevision = overview?.snapshotRevision || null;
  const scenario = scenarioState.revision === overviewRevision ? scenarioState.result : null;
  const scenarioLoading = scenarioState.revision === overviewRevision && scenarioState.loading;
  const scenarioError = scenarioState.revision === overviewRevision ? scenarioState.error : null;
  const academic = overview?.academic.analysis;
  const alternatives = useMemo(
    () => (academic?.requirements.nodes || []).filter((node) => node.alternatives.length > 1),
    [academic?.requirements.nodes],
  );
  const agendaEmptyConfirmed = overview !== null
    && overview.urgentItems.length === 0
    && isAdvisorAgendaEmptyConfirmed(overview.dataQuality);
  const agendaEmptyState = overview !== null
    && overview.urgentItems.length > 0
    && actions.length === 0
    ? "hidden-all"
    : agendaEmptyConfirmed
      ? "confirmed"
      : "unconfirmed";

  useEffect(() => {
    scenarioRequestSequence.current += 1;
    setEvidenceSelection(null);
    setDiagnosticSelection(null);
    setAlternativeSelections({});
    setScenarioState({
      revision: overviewRevision,
      result: null,
      loading: false,
      error: null,
    });
  }, [overviewRevision]);

  const showEvidence = (title: string, references: string[]) => {
    const overviewEntries = evidenceFor(overview, references);
    const scenarioEntries = evidenceFor(scenario, references);
    const entries = scenarioEntries.length === references.length && references.length > 0
      ? scenarioEntries
      : overviewEntries;
    setEvidenceSelection({ title, entries });
    if (insightsOpen) {
      setInsightsOpen(false);
      setRestoreInsightsAfterSheet(true);
    }
  };

  const openDataDiagnostics = (quality: AdvisorDomainQuality) => {
    setDiagnosticSelection(quality);
    setInsightsOpen(false);
    setRestoreInsightsAfterSheet(true);
  };

  const restoreInsights = () => {
    if (restoreInsightsAfterSheet) setInsightsOpen(true);
    setRestoreInsightsAfterSheet(false);
  };

  const runWhatIf = async () => {
    const requestRevision = overviewRevision;
    if (!requestRevision) {
      setScenarioState({ revision: null, result: null, loading: false, error: "当前没有可用于情景计算的快照。" });
      return;
    }
    const parsed = additionalCredits.trim() === "" ? undefined : Number(additionalCredits);
    if (parsed !== undefined && (!Number.isFinite(parsed) || parsed < 0 || parsed > 500)) {
      setScenarioState({ revision: requestRevision, result: null, loading: false, error: "假设学分必须是 0 到 500 之间的数字。" });
      return;
    }
    const requestSequence = ++scenarioRequestSequence.current;
    setScenarioState({ revision: requestRevision, result: null, loading: true, error: null });
    try {
      const result = await bridge.getAdvisorAcademicWhatIf({
        snapshotRevision: requestRevision,
        ...(parsed === undefined ? {} : { additionalRequiredCredits: parsed }),
        alternativeSelections,
      });
      if (requestSequence !== scenarioRequestSequence.current) return;
      if (!isCurrentAdvisorScenarioResponse(result, requestRevision)) {
        setScenarioState({
          revision: requestRevision,
          result: null,
          loading: false,
          error: "校园数据已更新，本次旧快照情景结果已丢弃。请重新计算。",
        });
        return;
      }
      setScenarioState({ revision: requestRevision, result, loading: false, error: null });
    } catch (caught) {
      if (requestSequence !== scenarioRequestSequence.current) return;
      setScenarioState({
        revision: requestRevision,
        result: null,
        loading: false,
        error: caught instanceof Error ? caught.message : "情景计算失败。",
      });
    }
  };

  return (
    <div className="advisor-view">
      <AdvisorWorkbench
        modelStatus={modelStatus}
        onOpenInsights={() => setInsightsOpen(true)}
        onOpenSettings={onOpenSettings}
      />

      <AdvisorInsightsDialog
        open={insightsOpen}
        onOpenChange={setInsightsOpen}
        overview={overview}
        actions={actions}
        loading={loading}
        error={error}
        emptyState={agendaEmptyState}
        pendingActionId={pendingActionId}
        onRetry={onRetry}
        onAction={onAction}
        onSnooze={onSnooze}
        onDismiss={onDismiss}
        onSelectDomain={openDataDiagnostics}
        onEvidence={showEvidence}
        additionalCredits={additionalCredits}
        onAdditionalCreditsChange={setAdditionalCredits}
        alternatives={alternatives}
        alternativeSelections={alternativeSelections}
        onAlternativeChange={(nodeId, value) => setAlternativeSelections((current) => {
          const next = { ...current };
          if (value) next[nodeId] = value;
          else delete next[nodeId];
          return next;
        })}
        onRunWhatIf={() => void runWhatIf()}
        scenario={scenario}
        scenarioLoading={scenarioLoading}
        scenarioError={scenarioError}
      />

      <DataQualityDiagnostics
        quality={diagnosticSelection}
        open={Boolean(diagnosticSelection)}
        onOpenChange={(open) => {
          if (!open) {
            setDiagnosticSelection(null);
            restoreInsights();
          }
        }}
        evidence={diagnosticSelection ? overview?.evidence.filter((entry) => entry.domain === diagnosticSelection.domain) || [] : []}
        onShowEvidence={() => {
          if (!diagnosticSelection) return;
          const entries = overview?.evidence.filter((entry) => entry.domain === diagnosticSelection.domain) || [];
          setDiagnosticSelection(null);
          setEvidenceSelection({ title: `${advisorDomainLabel(diagnosticSelection.domain)}数据证据`, entries });
        }}
        onRetry={onRetry}
      />

      <EvidenceDrawer
        open={Boolean(evidenceSelection)}
        onOpenChange={(open) => {
          if (!open) {
            setEvidenceSelection(null);
            restoreInsights();
          }
        }}
        evidence={evidenceSelection?.entries || []}
        title={evidenceSelection?.title || "证据详情"}
      />
    </div>
  );
}
