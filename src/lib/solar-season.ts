export type SolarSeason = "spring" | "summer" | "autumn" | "winter";

type Boundary = "spring" | "summer" | "autumn" | "winter";

// The standard Chinese solar-term day formula for 1901-2100. This client only
// needs the four seasonal "Li" terms, so a local calendar calculation is both
// more reliable than a network lookup and considerably smaller than a full
// astronomical ephemeris. Boundaries are interpreted in China Standard Time.
const TERM_CONSTANTS: Record<20 | 21, Record<Boundary, number>> = {
  20: { spring: 4.6295, summer: 5.52, autumn: 7.5, winter: 7.438 },
  21: { spring: 3.87, summer: 5.52, autumn: 7.5, winter: 7.438 },
};

const TERM_MONTH: Record<Boundary, number> = {
  spring: 2,
  summer: 5,
  autumn: 8,
  winter: 11,
};

export function solarSeason(date = new Date()): SolarSeason {
  const china = chinaDateParts(date);
  const boundary = currentYearBoundaries(china.year);
  const value = china.month * 100 + china.day;
  if (value >= boundary.winter) return "winter";
  if (value >= boundary.autumn) return "autumn";
  if (value >= boundary.summer) return "summer";
  if (value >= boundary.spring) return "spring";
  return "winter";
}

export function currentYearBoundaries(year: number) {
  return {
    spring: TERM_MONTH.spring * 100 + solarTermDay(year, "spring"),
    summer: TERM_MONTH.summer * 100 + solarTermDay(year, "summer"),
    autumn: TERM_MONTH.autumn * 100 + solarTermDay(year, "autumn"),
    winter: TERM_MONTH.winter * 100 + solarTermDay(year, "winter"),
  };
}

export function solarTermDay(year: number, boundary: Boundary) {
  const century = year >= 2001 ? 21 : 20;
  const normalizedYear = ((year % 100) + 100) % 100;
  const constant = TERM_CONSTANTS[century][boundary];
  return Math.floor(normalizedYear * 0.2422 + constant) - Math.floor((normalizedYear - 1) / 4);
}

function chinaDateParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const values = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<"year" | "month" | "day", number>;
  return values;
}
