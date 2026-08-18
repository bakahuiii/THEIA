import type { AcademicCalendar } from "../types";

const TERM_CODES = ["3", "12", "16"];
const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: SHANGHAI_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function localDay(now = new Date()) {
  const parts = Object.fromEntries(
    SHANGHAI_DATE_FORMATTER.formatToParts(now)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function currentShanghaiWeekday(now = new Date()) {
  const weekday = new Date(`${localDay(now)}T00:00:00Z`).getUTCDay();
  return weekday || 7;
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
  const start = Date.parse(`${semester.startDate}T00:00:00Z`);
  const target = Date.parse(`${day}T00:00:00Z`);
  const week = Math.min(semester.weeks, Math.max(1, Math.floor((target - start) / 604800000) + 1));
  return { key: `${calendar.schoolYear}:${index}`, termId: `${calendar.schoolYear.slice(0, 4)}-${TERM_CODES[index] || ""}`, week, of: semester.weeks, label: semester.label };
}

export function occursInWeek(weeks: string | null | undefined, week: number) {
  if (!weeks || !Number.isInteger(week) || week < 1) return true;

  // Zhengfang emits several inconsistent forms for a split teaching period.
  // In particular, parentheses are sometimes left open:
  // "1-3周(单,4-6周双,7-9周(单".  Treat every numeric segment as its
  // own rule. A parity flag must only apply until the next segment, never to
  // the whole source string.
  const text = String(weeks)
    .replace(/\s+/g, "")
    .replace(/[～—–－]/g, "-");
  const matches = [...text.matchAll(/(\d+)(?:[-~至到](\d+))?/g)];
  if (!matches.length) return true;

  return matches.some((match, index) => {
    const start = Number(match[1]);
    const end = Number(match[2] || match[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || week < start || week > end) {
      return false;
    }
    // Zhengfang may concatenate segments such as "1-3周(单,4-6周双".
    // Look only at this segment's suffix so the next segment's parity does
    // not leak into the current one.
    const nextStart = matches[index + 1]?.index ?? text.length;
    const suffix = text.slice((match.index || 0) + match[0].length, nextStart);
    const odd = /单|奇/.test(suffix);
    const even = /双|偶/.test(suffix);
    // "单双周" is used by some timetable exports to mean every week.
    if (odd !== even) return odd ? week % 2 === 1 : week % 2 === 0;
    return true;
  });
}
