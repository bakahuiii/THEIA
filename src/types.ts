import type {
  AcademicCalendar,
  AcademicCalendarPdfAnalysis,
} from "./types/course-selection";

export * from "./types/course-selection";

export type SourceName = "jwglxt" | "theol";

export interface SourceStatus {
  connected: boolean;
  checkedAt?: string;
  /** A shared CAS session is being checked against this source. */
  authPending?: boolean;
  /** No authoritative probe has completed yet. */
  unchecked?: boolean;
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
  courseInfo?: Record<string, string | number | null> | null;
  teachingMaterials?: TeachingMaterial[];
  courseResources?: CourseResource[];
  courseResourcesCapturedAt?: string | null;
  courseResourcesScan?: CourseResourceScan | null;
  capturedAt?: string;
}

export interface TeachingMaterial {
  id: string;
  courseId: string;
  title: string;
  url: string;
  kind?: "page" | "file" | string;
  capturedAt?: string;
  contentPreview?: string | null;
  fetchedAt?: string | null;
  fetchStatus?: "succeeded" | "failed" | string;
  fetchError?: string | null;
  materialType?: "introduction" | "syllabus" | "calendar" | string;
  localPath?: string | null;
  localStatus?: "saved" | "stale" | "failed" | string;
  localBytes?: number | null;
  localSha256?: string | null;
  localCapturedAt?: string | null;
  localError?: string | null;
  localAttachments?: Array<{
    title: string;
    url: string;
    localPath?: string | null;
    localStatus?: string;
    localBytes?: number | null;
    localSha256?: string | null;
    localError?: string | null;
  }>;
}

export interface CourseResource {
  id: string;
  courseId: string;
  title: string;
  url: string;
  kind?: "file" | "folder" | "page" | string;
  fileName?: string | null;
  sourceKey?: string;
  parentFolderId?: string | null;
  capturedAt?: string;
  cachedAt?: string | null;
  cachedBytes?: number | null;
  cachedFileName?: string | null;
}

export interface CourseResourceScan {
  rootUrl?: string | null;
  visitedFolders?: string[];
  failedFolders?: string[];
  truncated?: boolean;
  resourceLimitReached?: boolean;
  folderLimit?: number;
  resourceLimit?: number;
  complete?: boolean;
  capturedAt?: string | null;
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

export type AcademicOutcome = "passed" | "failed" | "in-progress" | "unknown";
export type AcademicCreditTreatment =
  | "normal"
  | "substitution"
  | "exemption"
  | "overage"
  | "unknown";

export interface GradeAttempt {
  schema: "theia-grade-attempt/v1";
  id: string;
  courseKey: string;
  courseCode?: string | null;
  courseName?: string | null;
  termId?: string | null;
  attemptIndex: number;
  outcome: AcademicOutcome;
  score?: string | null;
  point?: number | null;
  credits?: number | null;
  gpaIncluded: boolean;
  gpaEligibility?: string | null;
  creditIncluded?: boolean | null;
  sourceUrl?: string | null;
}

export interface AcademicCourseAnalysis {
  schema: "theia-course-analysis/v1";
  courseKey: string;
  courseCode?: string | null;
  courseName?: string | null;
  attempts: GradeAttempt[];
  attemptCount: number;
  isRetake: boolean;
  status: AcademicOutcome;
  representativeAttemptId?: string | null;
  gpaAttemptId?: string | null;
  creditAttemptId?: string | null;
  earnedCredits?: number | null;
}

export interface AcademicRequirementLedger {
  id: string;
  parentId?: string | null;
  title: string;
  relation?: "and" | "or" | null;
  treatment: AcademicCreditTreatment;
  required?: number | null;
  earned?: number | null;
  remaining?: number | null;
  confidence: "official" | "derived" | "unknown";
  status: "complete" | "incomplete" | "unknown";
  allocations: Array<{
    requirementCourseId: string;
    courseKey?: string | null;
    basis: "course-code" | "unique-title" | "unmatched" | "unknown";
    status: "earned" | "not-earned" | "unknown";
    credits?: number | null;
    treatment: AcademicCreditTreatment;
  }>;
  alternatives: AcademicRequirementLedger[];
  children: AcademicRequirementLedger[];
}

export interface AcademicAnalysis {
  schema: "theia-academic-analysis/v1";
  evaluatedAt?: string | null;
  gpa: {
    value?: number | null;
    officialValue?: number | null;
    computedValue?: number | null;
    source: "official" | "computed" | "unknown";
    credits: number;
    includedCourses: number;
  };
  gradeAttempts: GradeAttempt[];
  courses: AcademicCourseAnalysis[];
  requirements: {
    source: "official-tree" | "flat" | "missing";
    roots: AcademicRequirementLedger[];
    nodeCount: number;
  };
  creditLedger: {
    earnedCredits: number;
    earnedCourses: number;
    attemptedCourses: number;
    unknownAttempts: number;
    unknownCredits: number;
    requirementRoots: AcademicRequirementLedger[];
  };
  coverage: {
    grades: "complete" | "partial" | "missing";
    requirements: "complete" | "partial" | "missing";
  };
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
  localPath?: string | null;
  localStatus?: "saved" | "stale" | "failed" | string;
  localBytes?: number | null;
  localSha256?: string | null;
  localCapturedAt?: string | null;
  localError?: string | null;
  localAttachments?: Array<{
    title: string;
    url: string;
    localPath?: string | null;
    localStatus?: string;
    localBytes?: number | null;
    localSha256?: string | null;
    localError?: string | null;
  }>;
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

export type CourseWorkQueueJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface CourseWorkQueueJob {
  id: string;
  dedupeKey: string;
  assignmentId: string;
  operation: "prepare" | "model" | "notes" | "paper" | string;
  options?: { title?: string | null; wordCount?: number };
  status: CourseWorkQueueJobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  lastError?: string | null;
  result?: { status?: string | null; message?: string | null } | null;
}

export interface CourseWorkQueueSnapshot {
  schema: "theia-course-work-queue/v1";
  enabled: boolean;
  updatedAt: string;
  jobs: CourseWorkQueueJob[];
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

export interface AcademicExtraRecord {
  id: string;
  title?: string | null;
  fields?: Array<{ name?: string | null; label: string; value: string | number }>;
  [key: string]: unknown;
}

export interface AcademicExtraDomain {
  label: string;
  routeCodes: string[];
  sourceUrl?: string | null;
  capturedAt?: string | null;
  completeness: "complete" | "partial" | "unknown";
  queryStats: {
    attempted: number;
    succeeded: number;
    failed: number;
    capped: boolean;
  };
  messages?: string[];
  filters: string[];
  options?: Record<string, Array<{ value: string | null; label: string | null }>>;
  attachments: Array<{
    id: string | null;
    label: string | null;
    type: string | null;
    sourceUrl: string | null;
    cached?: boolean;
    bytes?: number | null;
    sha256?: string | null;
    filename?: string | null;
  }>;
  records: AcademicExtraRecord[];
  /** Present only in the bounded renderer snapshot; canonical storage keeps the records. */
  recordCount?: number;
}

export interface AcademicExtras {
  schema: string;
  capturedAt: string | null;
  parserVersion: string;
  domains: Record<string, AcademicExtraDomain>;
}

export interface AcademicPlanDocument {
  schema: "theia-academic-plan-document/v1";
  parserVersion: string;
  sourceAttachmentId: string;
  sourceSha256: string;
  sourceBytes: number;
  sourceFilename: string | null;
  pageCount: number;
  pages: Array<{ number: number; text: string }>;
  title: string | null;
  durationYears: number | null;
  minimumGraduationCredits: number | null;
  textDigest: string;
  parsedAt: string;
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
  academicExtras?: AcademicExtras;
  academicPlanDocument?: AcademicPlanDocument | null;
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
    modelProvider: "openai-compatible" | "anthropic-messages" | "gemini-generate-content" | "ollama-chat";
    modelName: string;
    modelModels: string[];
    modelRouting: {
      advisorFastModel: string | null;
      advisorDeepModel: string | null;
      courseworkModel: string | null;
      fallbackModel: string | null;
    };
    advisorConfig: {
      reasoningEffort: "none" | "low" | "medium" | "high" | "xhigh" | "max";
      responseStyle: "direct" | "balanced" | "detailed";
      responseLength: "adaptive" | "short" | "standard" | "detailed";
      temperature: number;
      budgetLevel: "high" | "xhigh" | "max" | "ultra";
      permissionMode: "read-only" | "full-access";
    };
  };
}

/**
 * Bounded, user-facing projections of the local campus state. These DTOs are
 * deliberately separate from CampusState: raw transport fields and large
 * historical collections must never be required by a renderer page.
 */
export interface UserDataDomainScope {
  id: string;
  label: string;
  count: number;
}

export interface UserDataDomainSummary {
  schema: "theia-user-data-view/v1";
  domain: string;
  label: string;
  count: number;
  scopes: UserDataDomainScope[];
  completeness: "complete" | "partial" | "unknown" | string;
  status: string;
  statusLabel: string;
  capturedAt: string | null;
  stale: boolean;
  primaryAction: "refresh" | "open";
  retainedPrevious: boolean;
  errorCode: string | null;
  snapshotRevision?: string | null;
}

export interface UserDataRecordAttribute {
  key: string;
  label: string;
  value: unknown;
}

export interface UserDataRecord {
  id: string;
  label: string;
  scopeLabel: string;
  status: string;
  statusLabel: string;
  completeness: string;
  capturedAt: string | null;
  sourcePlatform: string;
  attributes?: UserDataRecordAttribute[];
  domain?: string;
  recordKind?: "record" | "attachment" | string;
  recordType?: string;
  recordTypeLabel?: string;
  attachment?: {
    type: string;
    filename: string;
    bytes: number | null;
    sha256: string | null;
    cached: boolean;
  };
}

export interface UserDataRecordsPage {
  schema: "theia-user-data-view/v1";
  domain: string;
  label: string;
  scope: "current" | "all" | string;
  total: number;
  items: UserDataRecord[];
  nextCursor: string | null;
  hasMore: boolean;
  snapshotRevision?: string | null;
}

export interface UserDataOverview {
  schema: "theia-user-data-view/v1";
  view: "overview";
  snapshotRevision: string | null;
  generatedAt: string;
  currentTerm: { id: string; label: string } | null;
  attentionItems: UserDataRecord[];
  sections: UserDataDomainSummary[];
  extraDomains: UserDataDomainSummary[];
  sync: {
    lastRunAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
  };
}

export interface UserDataRecordsOptions {
  query?: string;
  termId?: string | null;
  status?: string | null;
  scope?: "current" | "all";
  limit?: number;
  cursor?: string;
  recordType?: string | null;
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
  | "theol-course-details"
  | "theol-course-resources"
  | "assignments"
  | "theol-notices"
  | "mailbox"
  | "academic-calendar"
  | "fitness"
  | "school-schedule"
  | "academic-extras"
  | "academic-plan"
  | "graduation-audit"
  | "grade-details"
  | "exam-extra"
  | "free-classroom";

export interface ModelStatus {
  configured: boolean;
  baseUrl: string;
  provider?: "openai-compatible" | "anthropic-messages" | "gemini-generate-content" | "ollama-chat";
  model: string;
  apiKeySaved: boolean;
  encryptionAvailable: boolean;
  updatedAt?: string;
  error?: string;
  warning?: string;
  requiresApiKeyReentry?: boolean;
  models?: string[];
  serviceIdentity?: string;
  modelRouting?: CampusState["settings"]["modelRouting"];
  advisorConfig?: CampusState["settings"]["advisorConfig"];
}

export interface ActivityLogEntry {
  at: string;
  event: string;
  detail?: string | null;
  raw: string;
}

export type * from "./types/advisor";

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

export interface FreeClassroomQuery {
  termId: string;
  date?: string;
  weeks: number[];
  weekdays: number[];
  periods: number[];
  campus?: string;
  building?: string;
  classroomType?: string;
  minSeats?: number;
  maxSeats?: number;
}

export interface SchoolScheduleItem {
  id: string;
  termId: string;
  classId?: string | null;
  /** Internal kch_id used by the course-selection class lookup. */
  courseId?: string | null;
  /** Present only when the source explicitly supplied a submit operation id. */
  operationId?: string | null;
  categoryCode?: string | null;
  jxbzls?: string | null;
  selectionContext?: {
    rwlx?: string | null;
    rlkz?: string | null;
    cdrlkz?: string | null;
    rlzlkz?: string | null;
    xxkbj?: string | null;
    cxbj?: string | null;
    qz?: string | null;
    jcxx_id?: string | null;
  } | null;
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

export interface MotionVenueRecord {
  id: string;
  campusId: string;
  campusLabel: string;
  activity: string;
  label: string;
  detailUrl: string;
}

export interface MotionVenueCatalog {
  source: string;
  parserVersion: string;
  lastRefreshedAt: string | null;
  campuses: Array<{ id: string; label: string; venueIds: string[] }>;
  venues: MotionVenueRecord[];
}

export interface MotionVenueStatus {
  schema: string;
  parserVersion?: string;
  capturedAt?: string | null;
  source?: Record<string, unknown>;
  query: {
    activity?: string | null;
    campus?: { id: string; label: string } | null;
    detailUrl: string;
    date: string;
    venue: string;
    availableDates: string[];
    availableVenues: string[];
  };
  availability: {
    tables: Array<{
      index: number;
      headers: string[];
      slots: Array<{ time: string; courts: Array<{ court: string; status: string; state: string }> }>;
      summary?: Record<string, unknown> | null;
    }>;
    summary?: Record<string, unknown> | null;
  };
  safety: Record<string, unknown>;
  timing?: Record<string, unknown>;
  cachedAt?: string | null;
  fromCache?: boolean;
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
      /** Present only in the bounded renderer snapshot. */
      recordCount?: number;
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
    venueReservations: MotionVenueCatalog & {
      statuses: Record<string, { id: string; scope: { detailUrl: string; date: string; venue: string }; capturedAt: string | null; source: string; parserVersion: string; result: MotionVenueStatus }>;
    };
  };
}

export interface IrisCompanionStatus {
  schema: "theia-iris-companion/v1";
  enabled: boolean;
  configured: boolean;
  encryptionAvailable: boolean;
  running: boolean;
  pid: number | null;
  startedAt: string | null;
  lastExit: { code: number | null; signal: string | null; at: string } | null;
  lastError: string | null;
  visibleProviders: string[];
  controlUrl?: string;
  providers: Record<string, boolean>;
}

export type * from "./types/bridge";
