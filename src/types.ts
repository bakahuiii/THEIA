export type SourceName = "jwglxt" | "theol";

export interface SourceStatus {
  connected: boolean;
  checkedAt?: string;
  authRequired?: boolean;
  error?: string;
  url?: string;
  errors?: string[];
}

export interface Profile {
  name?: string | null;
  studentId?: string | null;
  gpa?: number | null;
  /** Optional, user-editable major keywords used by local calendar matching. */
  academicTrack?: string | string[] | null;
  academicClass?: string | null;
}

export interface Course {
  id: string;
  code?: string | null;
  termId?: string | null;
  termIds?: string[];
  title: string;
  teacher?: string | null;
  credits?: number | null;
  category?: string | null;
  location?: string | null;
  classId?: string | null;
  description?: string | null;
  source: SourceName;
  sourceUrl?: string | null;
  resourceLinks?: Array<{ title: string; url: string }>;
  assignmentLinks?: Array<{ title: string; url: string }>;
  capturedAt?: string;
}

export interface ScheduleItem {
  id: string;
  termId?: string | null;
  courseId?: string | null;
  title: string;
  teacher?: string | null;
  room?: string | null;
  weekday?: number | null;
  period?: string | null;
  weeks?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  color?: string | null;
  sourceUrl?: string | null;
}

export interface Exam {
  id: string;
  termId?: string | null;
  courseName: string;
  examType?: string | null;
  examTime?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  location?: string | null;
  campus?: string | null;
  seat?: string | null;
  mode?: string | null;
  remark?: string | null;
  sourceUrl?: string | null;
}

export interface Grade {
  id: string;
  termId?: string | null;
  courseName: string;
  courseCode?: string | null;
  nature?: string | null;
  category?: string | null;
  remark?: string | null;
  status?: string | null;
  gpaIncluded?: boolean | null;
  credits?: number | null;
  score?: string | null;
  point?: number | null;
  teacher?: string | null;
  assessment?: string | null;
  sourceUrl?: string | null;
}

export interface SelectedCourse {
  id: string;
  termId?: string | null;
  courseId?: string | null;
  courseCode?: string | null;
  classId?: string | null;
  title: string;
  teacher?: string | null;
  credits?: number | null;
  category?: string | null;
  location?: string | null;
  time?: string | null;
  capacity?: number | null;
  enrolled?: number | null;
  waiting?: string | null;
  sourceUrl?: string | null;
}

export interface AcademicRequirement {
  id: string;
  title: string;
  required: number;
  earned?: number | null;
  remaining?: number | null;
  status?: string | null;
  /** The parent relation is supplied by JWGLXT: `or` means this node is an alternative branch. */
  relation?: "and" | "or" | null;
  parentId?: string | null;
  children?: AcademicRequirement[];
  courses?: AcademicRequirementCourse[];
  sourceUrl?: string | null;
}

export interface AcademicRequirementCourse {
  id: string;
  studyStatus?: string | null;
  academicYear?: string | null;
  term?: string | null;
  courseCode?: string | null;
  title: string;
  hours?: string | null;
  nature?: string | null;
  credits?: number | null;
  category?: string | null;
  bestScore?: string | null;
  point?: number | null;
  score?: string | null;
  makeupScore?: string | null;
  retakeScore?: string | null;
  recommendedYear?: string | null;
  recommendedTerm?: string | null;
}

export interface AcademicProgress {
  gpa?: number | null;
  program?: string | null;
  courseCounts?: {
    planned: {
      total: number;
      passed: number;
      failed: number;
      notTaken: number;
      studying: number;
    };
    outsidePlan: { passed: number; failed: number };
  } | null;
  /** Flat list retained for exports and compatibility with earlier snapshots. */
  categories: AcademicRequirement[];
  /** Hierarchical degree requirements from the academic-progress page. */
  roots?: AcademicRequirement[];
  sourceUrl?: string | null;
  capturedAt?: string | null;
}

export interface Assignment {
  id: string;
  kind?: "assignment" | "online-test" | string;
  courseId?: string | null;
  courseName?: string | null;
  title: string;
  dueAt?: string | null;
  score?: number | null;
  status: "pending" | "submitted" | "unknown" | string;
  sourceUrl?: string | null;
  courseSourceUrl?: string | null;
}

export interface CourseWorkspace {
  id: string;
  assignmentId: string;
  courseName?: string | null;
  title: string;
  kind: "assignment" | "online-test" | string;
  dueAt?: string | null;
  sourceUrl?: string | null;
  state: "prepared" | "answer-ready" | string;
  directory?: string | null;
  manifestPath?: string | null;
  taskPath?: string | null;
  answerKeyPath?: string | null;
  submissionPath?: string | null;
  attachmentCount?: number;
  questionCount?: number;
  preparedAt?: string | null;
  updatedAt?: string | null;
  lastError?: string | null;
  lastTestFill?: {
    at?: string;
    applied?: number[];
    failed?: Array<{ question: number; reason: string }>;
    total?: number;
  } | null;
  notesPath?: string | null;
  notesPdfPath?: string | null;
  paperPath?: string | null;
  paperPdfPath?: string | null;
  modelAnswerPath?: string | null;
  modelAnswerPdfPath?: string | null;
  modelName?: string | null;
  modelProcessedAt?: string | null;
}

export interface Notice {
  id: string;
  title: string;
  summary?: string | null;
  publishedAt?: string | null;
  source: SourceName;
  sourceUrl?: string | null;
}

export interface EmailMessage {
  id: string;
  uid?: number;
  subject: string;
  from: string;
  fromAddress?: string | null;
  receivedAt: string;
  snippet?: string | null;
  body?: string | null;
  bodyHtml?: string | null;
  bodyHtmlVersion?: number | null;
  unread?: boolean;
  attachments?: Array<{ index?: number; filename: string; contentType?: string | null; size: number }>;
  source: 'imap' | 'webmail';
  remoteMarker?: string | null;
  capturedAt?: string;
}

export interface CampusState {
  schema: string;
  appVersion: string;
  createdAt: string;
  updatedAt: string;
  profile: Profile | null;
  terms: Array<{ id: string; year: number; term: string; label: string }>;
  courses: Course[];
  schedule: ScheduleItem[];
  exams: Exam[];
  grades: Grade[];
  selectedCourses: SelectedCourse[];
  academicProgress: AcademicProgress | null;
  assignments: Assignment[];
  workspaces: CourseWorkspace[];
  notices: Notice[];
  emails: EmailMessage[];
  dataCatalog: LocalDataCatalog;
  sync: {
    lastStartedAt: string | null;
    lastCompletedAt: string | null;
    lastRunAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
    runId: string | null;
    sources: Partial<Record<SourceName, SourceStatus>>;
    domains: Record<string, {
      schema: "theia-domain-provenance/v1";
      runId: string | null;
      source: string[];
      attempted: boolean;
      succeeded: boolean;
      attemptedAt: string | null;
      completedAt: string | null;
      status: "never" | "not-attempted" | "succeeded" | "failed" | "auth-required";
      capturedAt: string | null;
      sourceSucceededAt: string | null;
      emptyConfirmed: boolean;
      contentEmptyConfirmed: boolean;
      retainedPrevious: boolean;
      completeness: "complete" | "partial" | "unknown";
      parserVersion: string | null;
      errorCode: string | null;
      successfulTermIds?: string[];
      failedTermIds?: string[];
      outcomes?: Record<string, {
        schema: "theia-domain-outcome/v1";
        runId: string | null;
        source: string[];
        attempted: boolean;
        succeeded: boolean;
        attemptedAt: string | null;
        completedAt: string | null;
        status: "never" | "not-attempted" | "succeeded" | "failed" | "auth-required";
        capturedAt: string | null;
        sourceSucceededAt: string | null;
        emptyConfirmed: boolean;
        contentEmptyConfirmed: boolean;
        retainedPrevious: boolean;
        completeness: "complete" | "partial" | "unknown";
        parserVersion: string | null;
        errorCode: string | null;
        successfulTermIds?: string[];
        failedTermIds?: string[];
      }>;
    }>;
  };
  settings: {
    apiPort: number;
    syncIntervalMinutes: number;
    autoSync: boolean;
    openOriginalInApp: boolean;
    academicAuthMode: "unified" | "api";
    academicApiEnabled: boolean;
    mail: {
      enabled: boolean;
      pollIntervalMinutes: number;
    };
    modelBaseUrl: string;
    modelName: string;
    modelModels: string[];
  };
}

export interface AuthStatus {
  jwglxt: SourceStatus;
  theol: SourceStatus;
}

export interface CredentialStatus {
  saved: boolean;
  username?: string;
  updatedAt?: string;
  encryptionAvailable: boolean;
  error?: string;
}

export interface AcademicApiCredentialStatus extends CredentialStatus {
  enabled: boolean;
}

export interface MailCredentialStatus extends CredentialStatus {
  passwordSaved?: boolean;
  protocolPasswordSaved?: boolean;
}

export type SavedSecretKind =
  | "unified-password"
  | "academic-api-password"
  | "mail-password"
  | "mail-protocol-password";

export type SyncRetryDomain =
  | "profile"
  | "terms"
  | "schedule"
  | "exams"
  | "grades"
  | "selected-courses"
  | "academic-progress"
  | "jwglxt-courses"
  | "jwglxt-notices"
  | "theol-courses"
  | "assignments"
  | "theol-notices"
  | "mailbox"
  | "academic-calendar"
  | "fitness"
  | "school-schedule";

export interface ModelStatus {
  configured: boolean;
  baseUrl: string;
  model: string;
  apiKeySaved: boolean;
  encryptionAvailable: boolean;
  updatedAt?: string;
  error?: string;
  warning?: string;
  requiresApiKeyReentry?: boolean;
  models?: string[];
  serviceIdentity?: string;
}

export interface ActivityLogEntry {
  at: string;
  event: string;
  detail?: string | null;
  raw: string;
}

export type AdvisorAvailability = "available" | "empty-confirmed" | "absent" | "unknown";
export type AdvisorFreshness = "fresh" | "stale" | "unknown";
export type AdvisorCompleteness = "complete" | "partial" | "unknown";

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
  dataset: string;
  domain: string;
  entityId: string;
  fields: string[];
  capturedAt: string | null;
  source: string | null;
  snapshotRevision: string;
  domainDigest: string;
  evidenceDigest: string;
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
}

export interface CourseSelectionBlock {
  id: string;
  categoryCode: string;
  title: string;
}

export interface CourseSelectionCandidate {
  id: string;
  courseId: string;
  classId?: string | null;
  className?: string | null;
  operationId: string;
  title: string;
  courseCode?: string | null;
  teacher?: string | null;
  credits?: number | null;
  location?: string | null;
  time?: string | null;
  capacity?: number | null;
  enrolled?: number | null;
  remainingSeats?: number | null;
  categoryCode: string;
  blockId: string;
  blockTitle?: string | null;
  termId?: string | null;
  sourceUrl?: string | null;
}

export interface CourseSelectionPortal {
  sourceUrl: string;
  term: { id: string; year: number; term: string; label: string };
  blocks: CourseSelectionBlock[];
  available: boolean;
  message?: string | null;
}

export interface CourseSelectionCatalogPage {
  page: number;
  pageSize: number;
  total: number;
}

export interface CourseSelectionJob {
  id: string;
  candidate: CourseSelectionCandidate | null;
  target?: CourseSelectionTarget | null;
  startAt: string;
  endAt?: string | null;
  intervalMs: number;
  maxAttempts: number;
  status:
    | "scheduled"
    | "running"
    | "selected"
    | "stopped"
    | "exhausted"
    | string;
  attempts: Array<{
    number: number;
    at: string;
    success: boolean;
    message: string;
  }>;
  startedAt?: string | null;
  completedAt?: string | null;
  lastMessage?: string | null;
  logs?: Array<{
    at: string;
    level: 'info' | 'warning' | 'success' | 'error' | 'stopped' | string;
    message: string;
  }>;
}

export interface CourseSelectionSnapshot {
  active: CourseSelectionJob | null;
  jobs?: CourseSelectionJob[];
  updatedAt: string;
  target?: CourseSelectionTarget | null;
  targets?: CourseSelectionTarget[];
  sentinel?: CourseSelectionSentinel;
  recordUpdatedAt?: string | null;
}

export interface CourseSelectionSentinel {
  enabled: boolean;
  startAt: string | null;
  endAt: string | null;
  intervalMs: number;
  concurrency: number;
  completedTargetIds: string[];
}

export interface AcademicCalendarAssetsSnapshot {
  schema: string;
  updatedAt: string | null;
  root: string;
  assets: Record<string, {
    filename: string;
    sourceUrl: string | null;
    fetchedAt: string | null;
    nextRefreshAfter: string | null;
    bytes: number;
  }>;
  calendar: AcademicCalendar | null;
  calendarError?: string | null;
  analysis?: AcademicCalendarPdfAnalysis | null;
  analysisError?: string | null;
}

export interface AcademicCalendarPdfAnalysis {
  schema: string;
  parserVersion: string;
  updatedAt: string;
  weeklyCalendar: Record<string, unknown> | null;
  teachingSchedule: Record<string, unknown> | null;
}

export interface AcademicCalendar {
  schema: string;
  schoolYear: string | null;
  parsedAt: string | null;
  semesters: Array<{ label: string; startDate: string; endDate: string; weeks: number }>;
  vacations: Array<{ label: string; startDate: string; endDate: string }>;
  specialDates: Array<{ label: string; date: string }>;
  currentWeek?: { schoolYear: string | null; semesterIndex: number; semesterLabel: string; termId: string | null; week: number; of: number; date: string } | null;
}

export interface CourseSelectionTarget {
  id?: string | null;
  termId?: string | null;
  classId?: string | null;
  courseCode?: string | null;
  title: string;
  className?: string | null;
  teacher?: string | null;
  time?: string | null;
  location?: string | null;
  credits?: number | null;
  chosenAt?: string | null;
}

export interface SchoolScheduleQuery {
  termId: string;
  forceRefresh?: boolean;
  keyword?: string | null;
  teacher?: string | null;
  department?: string | null;
  category?: string | null;
  nature?: string | null;
  format?: string | null;
  affiliation?: string | null;
  page?: number | null;
  pageSize?: number | null;
}

export interface SchoolScheduleItem {
  id: string;
  termId: string;
  classId?: string | null;
  courseCode?: string | null;
  title: string;
  className?: string | null;
  combinedClassInfo?: string | null;
  teacher?: string | null;
  time?: string | null;
  location?: string | null;
  credits?: number | null;
  nature?: string | null;
  category?: string | null;
  department?: string | null;
  status?: string | null;
  affiliation?: string | null;
  sourceUrl?: string | null;
}

export interface SchoolScheduleResult {
  id?: string;
  scope: SchoolScheduleQuery;
  capturedAt?: string | null;
  fromCache?: boolean;
  sourceUrl?: string | null;
  parserVersion?: string | null;
  complete?: boolean;
  total: number;
  page?: number;
  pageSize?: number;
  items: SchoolScheduleItem[];
}

export interface FitnessScoreResult {
  vitality?: number | null;
  run50?: number | null;
  flex?: number | null;
  jump?: number | null;
  strength?: number | null;
  endureSecs?: number | null;
  gender?: 'male' | 'female' | null;
  year?: string | null;
  yearKey?: string | null;
  availableYears?: Array<{ yearKey: string; label: string }>;
  academicGrade?: string | null;
  gradeGroup?: '12' | '34' | null;
  heightCm?: number | null;
  weightKg?: number | null;
  /** Local-cache metadata. A cached record is returned without opening the school site. */
  cachedAt?: string | null;
  refreshState?: 'ready' | 'empty' | null;
}

export interface FitnessDataRecord {
  id: string;
  scope: { yearKey: string };
  capturedAt: string | null;
  source: string;
  parserVersion: string;
  refreshState: 'ready' | 'empty';
  normalized: Omit<FitnessScoreResult, 'availableYears' | 'cachedAt' | 'refreshState'>;
}

export interface LocalDataCatalog {
  schema: 'theia-local-data/v1' | string;
  updatedAt: string | null;
  collections: {
    fitness: {
      source: string;
      parserVersion: string;
      lastRefreshedAt: string | null;
      availableYears: Array<{ yearKey: string; label: string }>;
      records: Record<string, FitnessDataRecord>;
    };
    schoolSchedule: {
      source: string;
      parserVersion: string;
      lastRefreshedAt: string | null;
      records: Record<string, SchoolScheduleResult>;
    };
    academicCalendar: {
      source: string;
      parserVersion: string;
      lastRefreshedAt: string | null;
      assets: Record<string, {
        filename: string;
        sourceUrl: string | null;
        fetchedAt: string | null;
        nextRefreshAfter: string | null;
        bytes: number;
      }>;
      calendar: AcademicCalendar | null;
      calendarError: string | null;
      analysis: AcademicCalendarPdfAnalysis | null;
      analysisError: string | null;
    };
  };
}

export interface TheiaBridge {
  getSnapshot(): Promise<CampusState>;
  getAdvisorOverview(): Promise<AdvisorOverview>;
  getActivityLog(): Promise<ActivityLogEntry[]>;
  getAuthStatus(): Promise<AuthStatus>;
  getCredentialStatus(): Promise<CredentialStatus>;
  getAcademicApiCredentialStatus(): Promise<AcademicApiCredentialStatus>;
  getMailCredentialStatus(): Promise<MailCredentialStatus>;
  readSavedSecret(kind: SavedSecretKind): Promise<string | null>;
  saveCredentials(credentials: {
    username: string;
    password: string;
  }): Promise<CredentialStatus>;
  saveAcademicApiCredentials(credentials: {
    username: string;
    password: string;
  }): Promise<AcademicApiCredentialStatus>;
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
  getCourseSelection(): Promise<CourseSelectionSnapshot>;
  discoverCourseSelection(): Promise<CourseSelectionPortal>;
  getCourseSelectionCandidates(
    blockId: string,
    target?: Pick<SchoolScheduleItem, 'courseCode' | 'title'> | null,
    options?: Partial<CourseSelectionCatalogPage>,
  ): Promise<{
    portal: CourseSelectionPortal;
    block: CourseSelectionBlock;
    candidates: CourseSelectionCandidate[];
  } & CourseSelectionCatalogPage>;
  searchSchoolSchedule(query: SchoolScheduleQuery): Promise<SchoolScheduleResult>;
  getCachedSchoolSchedule(scope?: Partial<SchoolScheduleQuery> | null): Promise<SchoolScheduleResult | null>;
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
  openAssignmentSource(assignmentId: string): Promise<boolean>;
  openSchedulePdf(): Promise<{
    canceled: boolean;
    filePath?: string;
    bytes?: number;
  }>;
  prepareCourseWork(assignmentId: string): Promise<CampusState>;
  openCourseWork(assignmentId: string): Promise<boolean>;
  importCourseWorkFile(
    assignmentId: string,
    kind: "answer" | "answer-key",
  ): Promise<{ canceled: boolean; snapshot: CampusState; path?: string }>;
  openSubmission(
    assignmentId: string,
  ): Promise<{
    canceled: boolean;
    snapshot: CampusState;
    attached: boolean;
    message?: string;
  }>;
  applyTestAnswers(
    assignmentId: string,
  ): Promise<{
    snapshot: CampusState;
    applied: number[];
    failed: Array<{ question: number; reason: string }>;
    total: number;
  }>;
  getModelStatus(): Promise<ModelStatus>;
  saveModelConfig(config: {
    baseUrl: string;
    model: string;
    apiKey?: string;
    probeId: string;
    allowManualModel?: boolean;
  }): Promise<ModelStatus>;
  clearModelApiKey(): Promise<ModelStatus>;
  cancelModelRequests(): Promise<{ cancelled: number }>;
  validateModelConnection(): Promise<{ ok: boolean }>;
  discoverModels(config: {
    baseUrl: string;
    apiKey?: string;
  }): Promise<{ models: string[]; selectedModel: string | null; probeId: string; warning?: string }>;
  processCourseWorkWithModel(assignmentId: string): Promise<CampusState>;
  renderAnswerPdf(
    assignmentId: string,
  ): Promise<{ snapshot: CampusState; pdfPath: string }>;
  openAnswerPdf(assignmentId: string): Promise<boolean>;
  summarizeNotices(): Promise<{ filePath: string; content: string }>;
  generateNotes(
    assignmentId: string,
    options?: { title?: string },
  ): Promise<CampusState>;
  generatePaper(
    assignmentId: string,
    options?: { title?: string; wordCount?: number },
  ): Promise<CampusState>;
  renderMdFile(
    assignmentId: string,
    fileKey: string,
  ): Promise<{ snapshot: CampusState; pdfPath: string }>;
  exportData(
    format: "json" | "theia" | "ics" | "csv" | "ai",
    collection?: string,
  ): Promise<{ canceled: boolean; filePath?: string; files?: number }>;
  openDataDirectory(): Promise<{ opened: boolean; path: string }>;
  getApiStatus(): Promise<{
    baseUrl: string;
    host: string;
    port: number;
    academicCalendarAssets?: Partial<Record<"calendar" | "teachingSchedule" | "weeklyCalendar", string>>;
  }>;
  getFitnessScore(year?: string, options?: { refresh?: boolean }): Promise<FitnessScoreResult>;
  updateSettings(
    settings: Partial<CampusState["settings"]>,
  ): Promise<CampusState>;
  onSyncProgress(
    cb: (p: {
      stage: string;
      status: string;
      label?: string;
      error?: string;
      scope?: "domain";
    }) => void,
  ): () => void;
  onSnapshot(callback: (state: CampusState) => void): () => void;
  onAuthStatus(callback: (status: AuthStatus) => void): () => void;
  onCourseSelection(
    callback: (snapshot: CourseSelectionSnapshot) => void,
  ): () => void;
  onNewMail(callback: (mail: EmailMessage) => void): () => void;
  windowMinimize?: () => Promise<void>;
  windowMaximize?: () => Promise<void>;
  windowClose?: () => Promise<void>;
  windowIsMaximized?: () => Promise<boolean>;
  zoomGet?: () => Promise<{ level: number; percent: number }>;
  zoomSet?: (percent: number) => void;
  setAppearanceMode?: (mode: 'light' | 'dark' | 'system') => void;
  chooseAppBackground?: () => Promise<{
    canceled: boolean;
    url?: string;
    name?: string;
  }>;
  getAppearancePresets?: () => Promise<{
    exists: boolean;
    updatedAt: string | null;
    presets: unknown[];
  }>;
  saveAppearancePresets?: (presets: unknown[]) => Promise<{
    updatedAt: string;
    presets: unknown[];
  }>;
  onAppearanceMode?: (callback: (mode: 'light' | 'dark' | 'system') => void) => () => void;
}

declare global {
  interface Window {
    theia?: TheiaBridge;
    buct?: TheiaBridge;
  }
}
