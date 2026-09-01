import type {
  AcademicApiCredentialStatus,
  ActivityLogEntry,
  AuthStatus,
  CampusState,
  CredentialStatus,
  CourseWorkQueueJob,
  CourseWorkQueueSnapshot,
  EmailMessage,
  FitnessScoreResult,
  FreeClassroomQuery,
  IrisCompanionStatus,
  MailCredentialStatus,
  ModelStatus,
  MotionVenueCatalog,
  MotionVenueStatus,
  SavedSecretKind,
  SchoolScheduleItem,
  SchoolScheduleQuery,
  SchoolScheduleResult,
  SyncRetryDomain,
  UserDataDomainSummary,
  UserDataOverview,
  UserDataRecordsOptions,
  UserDataRecordsPage,
} from "../types";
import type {
  AdvisorActionRequest,
  AdvisorActionResult,
  AdvisorAnswer,
  AdvisorAcademicScenarioResult,
  AdvisorCompleteness,
  AdvisorCourseDecisionResult,
  AdvisorOverview,
  AdvisorPreparedRequest,
  AdvisorStreamEvent,
  AdvisorThread,
} from "./advisor";
import type {
  AcademicCalendarAssetsSnapshot,
  CourseSelectionBlock,
  CourseSelectionCandidate,
  CourseSelectionCatalogPage,
  CourseSelectionPortal,
  CourseSelectionSentinel,
  CourseSelectionSnapshot,
  CourseSelectionTarget,
} from "./course-selection";

export interface TheiaBridge {
  getSnapshot(): Promise<CampusState>;
  getRendererSnapshot(): Promise<CampusState>;
  getUserDataOverview(): Promise<UserDataOverview>;
  getUserDataDomainSummary(domain: string): Promise<UserDataDomainSummary | null>;
  getUserDataRecords(domain: string, options?: UserDataRecordsOptions): Promise<UserDataRecordsPage>;
  getAdvisorOverview(): Promise<AdvisorOverview>;
  getAdvisorAcademicWhatIf(scenario: {
    snapshotRevision: string;
    additionalRequiredCredits?: number;
    alternativeSelections?: Record<string, string>;
  }): Promise<AdvisorAcademicScenarioResult>;
  getAdvisorCourseDecisions(request: {
    snapshotRevision: string;
    candidates: Array<Record<string, unknown>>;
    schoolScheduleComplete?: boolean;
    completeness?: Partial<Record<"academicProgress" | "schedule" | "grades" | "selectedCourses", AdvisorCompleteness>>;
  }): Promise<AdvisorCourseDecisionResult>;
  executeAdvisorAction(request: AdvisorActionRequest): Promise<AdvisorActionResult>;
  listAdvisorThreads(): Promise<AdvisorThread[]>;
  createAdvisorThread(): Promise<AdvisorThread>;
  prepareAdvisorRequest(request: { threadId: string; question: string }): Promise<AdvisorPreparedRequest>;
  sendAdvisorRequest(request: { requestId?: string; threadId?: string; question?: string }): Promise<AdvisorAnswer>;
  cancelAdvisorRequest(request: { requestId?: string; threadId?: string }): Promise<{ cancelled: boolean; requestId: string | null }>;
  deleteAdvisorThread(threadId: string): Promise<{ deleted: boolean; threadId: string }>;
  onAdvisorStream(callback: (event: AdvisorStreamEvent) => void): () => void;
  getActivityLog(): Promise<ActivityLogEntry[]>;
  getIrisStatus(): Promise<IrisCompanionStatus>;
  getUpdateStatus(): Promise<GithubUpdateStatus>;
  checkForUpdates(): Promise<GithubUpdateStatus>;
  installUpdate(): Promise<GithubUpdateStatus>;
  openIrisControlPanel(): Promise<{ opened: boolean; url?: string }>;
  saveIrisSettings(settings: { enabled?: boolean; visibleProviders?: string[]; providers?: Record<string, boolean> }): Promise<IrisCompanionStatus>;
  saveIrisCredentials(credentials: { appId: string; appSecret: string; ownerOpenid?: string }): Promise<{ saved: boolean; encryptionAvailable: boolean }>;
  clearIrisCredentials(): Promise<{ saved: boolean; encryptionAvailable: boolean }>;
  startIris(): Promise<IrisCompanionStatus>;
  stopIris(): Promise<IrisCompanionStatus>;
  restartIris(): Promise<IrisCompanionStatus>;
  getAuthStatus(): Promise<AuthStatus>;
  getCredentialStatus(): Promise<CredentialStatus>;
  getAcademicApiCredentialStatus(): Promise<AcademicApiCredentialStatus>;
  getMailCredentialStatus(): Promise<MailCredentialStatus>;
  readSavedSecret(kind: SavedSecretKind): Promise<string | null>;
  saveCredentials(credentials: { username: string; password: string }): Promise<CredentialStatus>;
  saveAcademicApiCredentials(credentials: { username: string; password: string }): Promise<AcademicApiCredentialStatus>;
  clearCredentials(): Promise<CredentialStatus>;
  clearAcademicApiCredentials(): Promise<AcademicApiCredentialStatus>;
  saveMailCredentials(credentials: { username: string; password: string; protocolPassword?: string }): Promise<MailCredentialStatus>;
  clearMailCredentials(): Promise<MailCredentialStatus>;
  refreshMailbox(): Promise<CampusState>;
  openMailbox(): Promise<boolean>;
  readMailboxMessage(id: string, options?: { refresh?: boolean }): Promise<EmailMessage>;
  downloadMailboxAttachment(id: string, index: number): Promise<{ canceled: boolean; filePath?: string; filename?: string }>;
  login(): Promise<void>;
  logout(): Promise<AuthStatus>;
  syncNow(): Promise<CampusState>;
  retrySyncDomain(domain: SyncRetryDomain): Promise<CampusState>;
  queryFreeClassrooms(query: FreeClassroomQuery): Promise<CampusState>;
  getCourseSelection(): Promise<CourseSelectionSnapshot>;
  discoverCourseSelection(): Promise<CourseSelectionPortal>;
  getCourseSelectionCandidates(
    blockId: string,
    target?: SchoolScheduleItem | null,
    options?: Partial<CourseSelectionCatalogPage>,
  ): Promise<{
    portal: CourseSelectionPortal;
    block: CourseSelectionBlock;
    candidates: CourseSelectionCandidate[];
  } & CourseSelectionCatalogPage>;
  searchSchoolSchedule(query: SchoolScheduleQuery): Promise<SchoolScheduleResult>;
  getCachedSchoolSchedule(scope?: Partial<SchoolScheduleQuery> | null): Promise<SchoolScheduleResult | null>;
  getMotionVenueCatalog(): Promise<MotionVenueCatalog>;
  refreshMotionVenueCatalog(): Promise<MotionVenueCatalog>;
  queryMotionVenueStatus(query: { detailUrl: string; date?: string | null; venue?: string | null }): Promise<MotionVenueStatus>;
  saveCourseSelectionTarget(target: CourseSelectionTarget | null): Promise<CourseSelectionSnapshot>;
  removeCourseSelectionTarget(id: string): Promise<CourseSelectionSnapshot>;
  setCourseSelectionSentinel(config: Partial<CourseSelectionSentinel>): Promise<CourseSelectionSnapshot>;
  startCourseSelection(options: {
    candidate?: CourseSelectionCandidate | null;
    targets?: CourseSelectionTarget[];
    startAt?: string | null;
    endAt?: string | null;
    intervalMs?: number;
    maxAttempts?: number;
    concurrency?: number;
    sentinel?: boolean;
  }): Promise<CourseSelectionSnapshot>;
  stopCourseSelection(): Promise<CourseSelectionSnapshot>;
  getAcademicCalendarAssets(): Promise<AcademicCalendarAssetsSnapshot>;
  refreshAcademicCalendarAssets(options?: { force?: boolean }): Promise<AcademicCalendarAssetsSnapshot>;
  openSource(url: string): Promise<boolean>;
  refreshCourseResources(courseId: string): Promise<CampusState>;
  downloadCourseResource(courseId: string, resourceId: string): Promise<{ cached: boolean; bytes?: number; filename?: string; opened?: boolean; snapshot?: CampusState }>;
  openAcademicAttachment(domain: string, attachmentId: string): Promise<{ cached: boolean }>;
  openAssignmentSource(assignmentId: string): Promise<boolean>;
  openCourseMaterial(courseId: string, materialId: string): Promise<boolean>;
  openSchedulePdf(): Promise<{ canceled: boolean; filePath?: string; bytes?: number }>;
  openScheduleDirectory(): Promise<{ opened: boolean; path: string }>;
  getCourseWorkQueue(): Promise<CourseWorkQueueSnapshot>;
  setCourseWorkQueueEnabled(enabled: boolean): Promise<CourseWorkQueueSnapshot>;
  enqueueCourseWork(request: {
    assignmentId: string;
    operation: "prepare" | "model" | "notes" | "paper";
    options?: { title?: string; wordCount?: number };
    dedupeKey?: string;
    maxAttempts?: number;
  }): Promise<{ deduplicated: boolean; job: CourseWorkQueueJob; snapshot: CourseWorkQueueSnapshot }>;
  cancelCourseWorkJob(jobId: string): Promise<CourseWorkQueueSnapshot>;
  prepareCourseWork(assignmentId: string): Promise<CampusState>;
  openCourseWork(assignmentId: string): Promise<boolean>;
  importCourseWorkFile(assignmentId: string, kind: "answer" | "answer-key"): Promise<{ canceled: boolean; snapshot: CampusState; path?: string }>;
  openSubmission(assignmentId: string): Promise<{ canceled: boolean; snapshot: CampusState; attached: boolean; message?: string }>;
  applyTestAnswers(assignmentId: string): Promise<{ snapshot: CampusState; applied: number[]; failed: Array<{ question: number; reason: string }>; total: number }>;
  getModelStatus(): Promise<ModelStatus>;
  saveModelConfig(config: {
    baseUrl: string;
    provider?: "openai-compatible" | "anthropic-messages" | "gemini-generate-content" | "ollama-chat";
    model: string;
    apiKey?: string;
    probeId: string;
    allowManualModel?: boolean;
    modelRouting?: CampusState["settings"]["modelRouting"];
    advisorConfig?: CampusState["settings"]["advisorConfig"];
  }): Promise<ModelStatus>;
  clearModelApiKey(): Promise<ModelStatus>;
  cancelModelRequests(): Promise<{ cancelled: number }>;
  validateModelConnection(): Promise<{ ok: boolean }>;
  discoverModels(config: {
    baseUrl: string;
    provider?: "openai-compatible" | "anthropic-messages" | "gemini-generate-content" | "ollama-chat";
    apiKey?: string;
  }): Promise<{ models: string[]; selectedModel: string | null; probeId: string; warning?: string }>;
  processCourseWorkWithModel(assignmentId: string): Promise<CampusState>;
  renderAnswerPdf(assignmentId: string): Promise<{ snapshot: CampusState; pdfPath: string }>;
  openAnswerPdf(assignmentId: string): Promise<boolean>;
  summarizeNotices(): Promise<{ filePath: string; content: string }>;
  generateNotes(assignmentId: string, options?: { title?: string }): Promise<CampusState>;
  generatePaper(assignmentId: string, options?: { title?: string; wordCount?: number }): Promise<CampusState>;
  renderMdFile(assignmentId: string, fileKey: string): Promise<{ snapshot: CampusState; pdfPath: string }>;
  exportData(format: "json" | "theia" | "ics" | "csv" | "ai", collection?: string): Promise<{ canceled: boolean; filePath?: string; files?: number }>;
  openDataDirectory(): Promise<{ opened: boolean; path: string }>;
  installMcpClients(): Promise<{
    schema: "theia-mcp-client-setup/v1";
    server: "theia";
    pluginAvailable: boolean;
    clients: Array<{
      client: "codex" | "claude-code";
      status: "installed" | "updated" | "already-configured" | "not-found" | "plugin-missing" | "failed";
      changed: boolean;
      backupCreated: boolean;
    }>;
  }>;
  getApiStatus(): Promise<ApiStatus>;
  getFitnessScore(year?: string, options?: { refresh?: boolean }): Promise<FitnessScoreResult>;
  updateSettings(settings: Partial<CampusState["settings"]>): Promise<CampusState>;
  onSyncProgress(cb: (p: { stage: string; status: string; label?: string; error?: string; scope?: "domain" }) => void): () => void;
  onSnapshot(callback: (state: CampusState) => void): () => void;
  onAuthStatus(callback: (status: AuthStatus) => void): () => void;
  onUpdateStatus(callback: (status: GithubUpdateStatus) => void): () => void;
  onCourseSelection(callback: (snapshot: CourseSelectionSnapshot) => void): () => void;
  onCourseWorkQueue(callback: (snapshot: CourseWorkQueueSnapshot) => void): () => void;
  onNewMail(callback: (mail: EmailMessage) => void): () => void;
  windowMinimize?: () => Promise<void>;
  windowMaximize?: () => Promise<void>;
  windowClose?: () => Promise<void>;
  windowIsMaximized?: () => Promise<boolean>;
  zoomGet?: () => Promise<{ level: number; percent: number }>;
  zoomSet?: (percent: number) => void;
  setAppearanceMode?: (mode: "light" | "dark" | "system") => void;
  chooseAppBackground?: () => Promise<{ canceled: boolean; url?: string; name?: string }>;
  getAppearancePresets?: () => Promise<{ exists: boolean; updatedAt: string | null; presets: unknown[] }>;
  saveAppearancePresets?: (presets: unknown[]) => Promise<{ updatedAt: string; presets: unknown[] }>;
  onAppearanceMode?: (callback: (mode: "light" | "dark" | "system") => void) => () => void;
}

export interface ApiEndpointDescriptor {
  method: "GET" | "POST";
  path: string;
  category: "runtime" | "data" | "academic" | "public" | "asset" | "agent";
  label: string;
  description: string;
}

export interface ApiMcpToolDescriptor {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
}

export interface ApiStatus {
  baseUrl: string;
  host: string;
  port: number;
  apiEndpoints?: ApiEndpointDescriptor[];
  mcp?: {
    name: string;
    version: string;
    protocolVersion: string;
    schema: string;
    tools: ApiMcpToolDescriptor[];
  };
  academicCalendarAssets?: Partial<Record<"calendar" | "teachingSchedule" | "weeklyCalendar", string>>;
  academicPlanAssetBaseUrl?: string;
}

export interface GithubUpdateProgress {
  percent: number;
  transferredBytes: number;
  totalBytes: number;
  bytesPerSecond: number;
}

export interface GithubUpdateStatus {
  supported: boolean;
  state: "unsupported" | "idle" | "checking" | "available" | "downloading" | "downloaded" | "not-available" | "error";
  currentVersion: string;
  availableVersion: string | null;
  releaseName: string | null;
  releaseDate: string | null;
  lastCheckedAt: string | null;
  progress: GithubUpdateProgress | null;
  error: string | null;
}

declare global {
  interface Window {
    theia?: TheiaBridge;
    buct?: TheiaBridge;
  }
}
