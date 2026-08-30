export type AdvisorAvailability = "available" | "empty-confirmed" | "absent" | "unknown";
export type AdvisorFreshness = "fresh" | "stale" | "unknown";
export type AdvisorCompleteness = "complete" | "partial" | "unknown";

export interface AdvisorSourceAttempt {
  source: string[];
  attemptedAt: string | null;
  completedAt: string | null;
  capturedAt: string | null;
  sourceSucceededAt: string | null;
  status: "never" | "not-attempted" | "succeeded" | "failed" | "auth-required";
  completeness: AdvisorCompleteness;
  retainedPrevious: boolean;
  errorCode: string | null;
  parserVersion: string | null;
  receivedRecordCount: number | null;
  previousRecordCount: number | null;
  successfulTermIds: string[];
  failedTermIds: string[];
}

export interface AdvisorDomainQuality {
  domain: string;
  availability: AdvisorAvailability;
  freshness: AdvisorFreshness;
  completeness: AdvisorCompleteness;
  contentEmptyConfirmed: boolean;
  capturedAt: string | null;
  sourceSucceededAt: string | null;
  source: string[];
  parserVersion: string | null;
  recordCount: number;
  contentDigest: string;
  sourceAttempts: AdvisorSourceAttempt[];
  derivedFrom: string[];
  lastAttempt: {
    runId: string | null;
    attemptedAt: string | null;
    completedAt: string | null;
    status: "never" | "not-attempted" | "succeeded" | "failed" | "auth-required";
    emptyConfirmed: boolean;
    retainedPrevious: boolean;
    errorCode: string | null;
  };
  provenanceInferred: boolean;
}

export interface AdvisorQualitySummary {
  availability: AdvisorAvailability;
  freshness: AdvisorFreshness;
  completeness: AdvisorCompleteness;
  lastAttemptStatus: "never" | "not-attempted" | "succeeded" | "failed" | "auth-required";
}

export interface AdvisorEvidence {
  id: string;
  origin?: "request-input";
  dataset: string;
  domain: string;
  entityId: string;
  fields: string[];
  capturedAt: string | null;
  source: string | null;
  snapshotRevision: string;
  domainDigest: string;
  evidenceDigest: string;
  requestDigest?: string;
  availability: AdvisorAvailability;
  freshness: AdvisorFreshness;
  completeness: AdvisorCompleteness;
  label: string | null;
  disclosedFields: string[];
}

export interface AdvisorClaim {
  id: string;
  kind: string;
  subject: string;
  predicate: string;
  value: { type: string; value: string | boolean; unit?: string; timeZone?: string };
  displayText: string;
  evidenceRefs: string[];
  confidence: "high" | "medium" | "low" | "unknown";
  caveats: string[];
  rulesVersion: string;
}

export interface AdvisorRisk {
  id: string;
  kind: string;
  entityId: string;
  domain: string;
  severity: "urgent" | "attention" | "info";
  title: string;
  why: string[];
  evidenceRefs: string[];
  claimIds: string[];
  dueAt: string | null;
  deadlineBand: string;
  actionable: boolean;
  suggestedAction: string;
  actionKind: string;
  impactClass: string;
  delayCostClass: string;
  quality: AdvisorQualitySummary;
  rulesVersion: string;
}

export interface AdvisorUrgentItem {
  id: string;
  kind: string;
  domain?: string | null;
  entityId: string;
  title: string;
  dueAt: string | null;
  severity: "urgent" | "attention" | "info";
  score: {
    urgency: number;
    impact: number;
    delayCost: number;
    confidence: number;
    total: number;
    formulaVersion: string;
    components: Record<string, string>;
  };
  reasons: string[];
  evidenceRefs: string[];
  claimIds: string[];
  quality: AdvisorQualitySummary;
  suggestedAction: string;
  actionKind: string;
  rulesVersion: string;
}

export interface AdvisorActionRequest {
  snapshotRevision: string;
  actionId: string;
}

export type AdvisorActionResult =
  | { ok: true; snapshotRevision: string; actionId: string }
  | {
      ok: false;
      actionId?: string;
      error: { code: string; message: string; retryable: boolean };
    };

export interface AdvisorAcademicAnalysis {
  schema: string;
  snapshotRevision: string;
  evaluatedAt: string;
  timeZone: string;
  rulesVersion: string;
  analysis: {
    requirements: {
      source: "roots" | "categories" | "none" | string;
      requirementSource?: string | null;
      completeness: AdvisorCompleteness;
      program?: string | null;
      summary: {
        required: string | null;
        earned: string | null;
        remaining: string | null;
        remainingSource: string;
        evidenceRefs: string[];
        claimId: string | null;
      };
      roots: AdvisorAcademicRequirementNode[];
      nodes: AdvisorAcademicRequirementNode[];
      issues: string[];
    };
    gpa: {
      selectedSource: "academicProgress" | "profile" | "local" | null;
      selected: AdvisorAcademicGpaSource | null;
      sources: Partial<Record<"academicProgress" | "profile" | "local", AdvisorAcademicGpaSource>>;
      discrepancy: {
        state: "present" | "absent" | "unknown";
        difference: string | null;
        evidenceRefs: string[];
        claimId: string | null;
      };
      localBoundary: {
        value: string | null;
        includedCredits: string | null;
        includedCourses: number;
        completeness: AdvisorCompleteness;
        exclusions: Record<
          | "explicitly-excluded"
          | "policy-excluded"
          | "non-numeric-mark"
          | "missing-or-invalid-credits"
          | "missing-point-or-numeric-score",
          number
        >;
        evidenceRefs: string[];
        claimId: string | null;
      };
      issues: string[];
    };
    upgrade: AdvisorAcademicUpgrade;
    failures: AdvisorAcademicFailure[];
    scenario: AdvisorAcademicScenario | null;
  };
  claims: AdvisorClaim[];
  risks: AdvisorRisk[];
  evidence: AdvisorEvidence[];
}

export interface AdvisorAcademicUpgradeRule {
  schema: string;
  id: string;
  rulesVersion: string;
  sourceKind: "official" | "configuration";
  sourceLabel: string;
  thresholdCredits: string;
  requirementIds: string[];
  earnedCredits: string | null;
}

export interface AdvisorAcademicUpgrade {
  status: "not-configured" | "unknown" | "known";
  rule: AdvisorAcademicUpgradeRule | null;
  threshold: string | null;
  earned: string | null;
  distance: string | null;
  remaining?: string | null;
  arithmeticAtOrAbove?: boolean;
  evidenceRefs: string[];
  claimIds: string[];
  issues: string[];
}

export interface AdvisorAcademicGpaSource {
  value: string;
  evidenceRefs: string[];
  claimId: string;
  confidence: "high" | "medium" | "low" | "unknown";
}

export interface AdvisorAcademicRequirementNode {
  id: string;
  title: string;
  parentId?: string | null;
  relation: "and" | "or";
  completeness: AdvisorCompleteness;
  credits: {
    required: string | null;
    earned: string | null;
    remaining: string | null;
    remainingSource: string;
    evidenceRefs: string[];
    claimIds: Record<string, string>;
  };
  alternatives: Array<{
    id: string;
    title: string;
    remaining: string | null;
    completeness: AdvisorCompleteness;
  }>;
  selectionStatus: string;
  selectedAlternativeId: string | null;
  issues: string[];
  children: AdvisorAcademicRequirementNode[];
  evidenceRefs: string[];
}

export interface AdvisorAcademicFailure {
  id: string;
  courseCode: string | null;
  title: string | null;
  relationStatus: "known" | "unknown";
  matchBasis: string;
  requirementIds: string[];
  candidateRequirementIds: string[];
  recordedCredits: string | null;
  evidenceRefs: string[];
  claimIds: string[];
  caveats: string[];
}

export interface AdvisorAcademicScenario {
  scenario: true;
  status: "known" | "unknown";
  additionalRequiredCredits: string | null;
  alternativeSelections: Record<string, string>;
  baseRemaining: string | null;
  remaining: string | null;
  evidenceRefs: string[];
  claimId: string | null;
  issues: string[];
}

export type AdvisorAcademicScenarioResult = AdvisorAcademicAnalysis;

export interface AdvisorCourseDecision {
  id: string;
  candidateId: string;
  rank: number;
  requirementMatches: Array<{ nodeId: string | null; label: string; basis: string; confidence: "high" | "medium" | "low" }>;
  scheduleStatus: "clear" | "conflict" | "unknown";
  scheduleConflicts: Array<{ existingId: string; reason: string }>;
  duplicateStatus: string;
  duplicateMatches: Array<{ kind: string; existingId: string; basis: string; reason: string }>;
  historicalSummary: { attempts: number; numericCount: number; meanPoint: number | null; note: string };
  completeness: AdvisorCompleteness;
  score: number | null;
  scoreBreakdown: Record<string, number | string | null>;
  reasons: string[];
  rulesVersion: string;
}

export interface AdvisorCourseDecisionResult {
  schema: string;
  snapshotRevision: string;
  rulesVersion: string;
  decisions: AdvisorCourseDecision[];
  proposals: Array<{
    id: string;
    kind: "save-target" | "view-details" | "open-confirmation";
    candidateId: string;
    decisionId: string;
    requiresUserConfirmation: boolean;
    label: string;
  }>;
}

export interface AdvisorOverview {
  schema: "theia-advisor-overview/v1" | string;
  snapshotRevision: string;
  evaluatedAt: string;
  timeZone: "Asia/Shanghai" | string;
  rulesVersion: string;
  dataQuality: {
    schema: "theia-advisor-data-quality/v1" | string;
    snapshotRevision: string;
    snapshotAt: string | null;
    evaluatedAt: string;
    timeZone: string;
    rulesVersion: string;
    domains: Record<string, AdvisorDomainQuality>;
    warnings: string[];
  };
  risks: AdvisorRisk[];
  urgentItems: AdvisorUrgentItem[];
  evidence: AdvisorEvidence[];
  claims: AdvisorClaim[];
  academic: AdvisorAcademicAnalysis;
}

export type AdvisorIntent = "daily" | "risk" | "course" | "assignment" | "notice" | "mail" | "general";

export interface AdvisorDisclosurePlan {
  schema: "theia-advisor-disclosure/v1";
  providerProfileId: string;
  serviceIdentity: string;
  modelId: string;
  intent: AdvisorIntent;
  scopes: string[];
  recordCounts: Record<string, number>;
  containsMailBody: boolean;
  containsProfileIdentity: boolean;
  containsFitness: boolean;
  containsAttachmentText: boolean;
  estimatedInputUnits: number;
  snapshotRevision: string;
  contextDigest: string;
}

export interface AdvisorPreparedRequest {
  schema: "theia-advisor-prepared-request/v1";
  requestId: string;
  threadId: string;
  expiresAt: string;
  disclosure: AdvisorDisclosurePlan;
  agent: boolean;
}

export interface AdvisorStreamEvent {
  schema: "theia-advisor-stream-event/v1";
  requestId: string;
  threadId: string;
  snapshotRevision: string;
  delta?: string;
  tool?: {
    type: "start" | "result" | "error";
    name: string;
    step?: number;
    args?: unknown;
    summary?: {
      itemCount?: number;
      matchCount?: number;
      claimCount?: number;
      riskCount?: number;
      requirementCount?: number;
      domain?: string;
      query?: string;
      hasMessage?: boolean;
      truncated?: boolean;
    };
    error?: string;
  };
  model?: {
    type: "start" | "completed" | "failover";
    modelId: string;
    fromModelId?: string;
    usage?: {
      inputTokens?: number | null;
      outputTokens?: number | null;
      cachedInputTokens?: number | null;
      cacheWriteInputTokens?: number | null;
      cacheStatus?: "hit" | "miss" | "write" | "unknown" | null;
    } | null;
  };
}

export interface AdvisorAnswer {
  schema: "theia-advisor-answer/v1";
  requestId: string;
  threadId: string;
  intent: AdvisorIntent;
  snapshotRevision: string;
  rawText: string;
  displayText?: string;
  narrative?: {
    schema: string;
    catalogDigest: string;
    blockCount: number;
    recommendationCount: number;
  };
  model: { serviceIdentity: string; modelId: string } | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number | null;
    cacheWriteInputTokens: number | null;
    cacheStatus: "hit" | "miss" | "write" | "unknown";
    estimated: boolean;
    inputBytes: number;
    outputBytes: number;
  };
}

export type AdvisorThreadMessage =
  | { id: string; role: "user"; at: string; text: string }
  | { id: string; role: "assistant"; at: string; response: AdvisorAnswer };

export interface AdvisorThread {
  schema: "theia-advisor-thread/v1";
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  activeRequestId: string | null;
  messages: AdvisorThreadMessage[];
}
