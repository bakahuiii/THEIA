import type { AcademicCalendar } from "../types";

const TERM_CODES = ["3", "12", "16"];

function localDay(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function currentAcademicVacation(calendar?: AcademicCalendar | null, now = new Date()) {
  const day = localDay(now);
  return calendar?.vacations.find((vacation) => vacation.startDate <= day && day <= vacation.endDate) || null;
}

export function currentAcademicWeek(calendar?: AcademicCalendar | null, now = new Date()) {
  if (!calendar?.schoolYear) return null;
  const day = localDay(now);
  const index = calendar.semesters.findIndex((semester) => semester.startDate <= day && day <= semester.endDate);
  if (index < 0) return null;
  const semester = calendar.semesters[index];
  const start = new Date(`${semester.startDate}T00:00:00`).getTime();
  const week = Math.min(semester.weeks, Math.max(1, Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - start) / 604800000) + 1));
  return { key: `${calendar.schoolYear}:${index}`, termId: `${calendar.schoolYear.slice(0, 4)}-${TERM_CODES[index] || ""}`, week, of: semester.weeks, label: semester.label };
}

export function occursInWeek(weeks: string | null | undefined, week: number) {
  if (!weeks) return true;
  const match = weeks.match(/(\d+)-(\d+)/) || weeks.match(/(\d+)/);
  if (!match) return true;
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : start;
  return week >= start && week <= end;
}
