export interface CourseSelectionBlock {
  id: string;
  categoryCode: string;
  title: string;
  gradeId?: string | null;
  majorId?: string | null;
  controlSequence?: string | null;
}

export interface CourseSelectionCandidate {
  id: string;
  courseId: string;
  classId?: string | null;
  className?: string | null;
  /** Number of linked teaching classes returned by Zhengfang. */
  jxbzls?: string | null;
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
  /** Internal Zhengfang flags used to reproduce the official submit request. */
  selectionContext?: {
    kcmc?: string | null;
    rwlx?: string | null;
    rlkz?: string | null;
    cdrlkz?: string | null;
    rlzlkz?: string | null;
    xxkbj?: string | null;
    cxbj?: string | null;
    qz?: string | null;
    jcxx_id?: string | null;
    xklc?: string | null;
    xkly?: string | null;
    kklxdm?: string | null;
  };
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
  selectionOpen?: boolean;
  selectionState?: "open" | "closed" | "unknown" | string;
  selectionFlags?: Record<string, boolean | null>;
  message?: string | null;
}

export interface CourseSelectionCatalogPage {
  page: number;
  pageSize: number;
  total: number;
  message?: string | null;
  responseSignal?: string | null;
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
  history?: CourseSelectionHistoryEntry[];
  updatedAt: string;
  target?: CourseSelectionTarget | null;
  targets?: CourseSelectionTarget[];
  sentinel?: CourseSelectionSentinel;
  recordUpdatedAt?: string | null;
}

export interface CourseSelectionHistoryEntry {
  kind: 'job';
  at: string;
  jobId: string | null;
  status: string | null;
  candidate: CourseSelectionTarget;
  attempts: number;
  lastMessage: string | null;
  logs: Array<{
    at: string;
    level: 'info' | 'warning' | 'success' | 'error' | 'stopped' | string;
    message: string;
  }>;
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

export interface AcademicPeriodTime {
  period: number;
  startTime: string;
  endTime: string;
}

export interface AcademicCalendar {
  schema: string;
  schoolYear: string | null;
  parsedAt: string | null;
  semesters: Array<{ label: string; startDate: string; endDate: string; weeks: number }>;
  vacations: Array<{ label: string; startDate: string; endDate: string }>;
  specialDates: Array<{ label: string; date: string }>;
  periodTimes: AcademicPeriodTime[];
  currentWeek?: { schoolYear: string | null; semesterIndex: number; semesterLabel: string; termId: string | null; week: number; of: number; date: string } | null;
}

export interface CourseSelectionTarget {
  id?: string | null;
  termId?: string | null;
  classId?: string | null;
  /** Internal kch_id from the school-wide schedule, kept separate from courseCode. */
  courseId?: string | null;
  /** Selection-module code (for example 01/10/11) when supplied by the source. */
  categoryCode?: string | null;
  /** Zhengfang teaching-class composition mode. */
  jxbzls?: string | null;
  /** Non-secret flags needed to reproduce the current selection context. */
  selectionContext?: {
    kcmc?: string | null;
    rwlx?: string | null;
    rlkz?: string | null;
    cdrlkz?: string | null;
    rlzlkz?: string | null;
    xxkbj?: string | null;
    cxbj?: string | null;
    qz?: string | null;
    jcxx_id?: string | null;
    xklc?: string | null;
    xkly?: string | null;
    kklxdm?: string | null;
  } | null;
  courseCode?: string | null;
  title: string;
  className?: string | null;
  teacher?: string | null;
  time?: string | null;
  location?: string | null;
  credits?: number | null;
  chosenAt?: string | null;
}
