const SEMESTER_LABELS: Record<string, string> = {
  "1": "第一学期",
  "2": "第二学期",
  "3": "第一学期",
  "12": "第二学期",
  "16": "第三学期",
};

/** Converts Zhengfang storage IDs into labels suitable for a user interface. */
export function formatAcademicTermId(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return "未记录学期";
  if (raw === "all") return "全部学期";

  const full = raw.match(/^(\d{4})-(\d+)$/);
  if (full) {
    const [, yearText, code] = full;
    const year = Number(yearText);
    const semester = SEMESTER_LABELS[code] || `第${code}学期`;
    return Number.isInteger(year) ? `${year}-${year + 1} ${semester}` : semester;
  }

  return SEMESTER_LABELS[raw] || `第${raw}学期`;
}
