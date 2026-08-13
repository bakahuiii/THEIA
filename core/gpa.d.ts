interface GradeRecord {
  id?: string | null;
  termId?: string | null;
  courseId?: string | null;
  courseCode?: string | null;
  code?: string | null;
  score?: string | number | null;
  point?: string | number | null;
  credits?: number | null;
  remark?: string | null;
  status?: string | null;
  category?: string | null;
  nature?: string | null;
  courseCategory?: string | null;
  courseName?: string | null;
}

export interface GpaResult {
  gpa: number | null;
  credits: number;
  included: number;
}

export interface GpaTrendPoint {
  id: string;
  label: string;
  gpa: number | null;
  credits: number;
  included: number;
  cumulativeGpa?: number | null;
  cumulativeCredits?: number;
  cumulativeIncluded?: number;
}

export interface EarnedCreditResult {
  credits: number;
  courses: number;
}

export interface GpaTrend {
  semesters: GpaTrendPoint[];
  academicYears: GpaTrendPoint[];
}

export function scoreToPoint(value: unknown): number | null;
export function isGpaEligible(grade: GradeRecord): boolean;
export function isPassedGrade(grade: GradeRecord): boolean;
export function gradePoint(grade: GradeRecord): number | null;
export function computeEarnedCredits(grades: GradeRecord[]): EarnedCreditResult;
export function computeGpa(grades: GradeRecord[]): GpaResult;
export function formatGpa(value: unknown): string;
export function computeGpaTrend(
  grades: GradeRecord[],
  terms?: Array<{ id: string; label: string }>,
): GpaTrend;
