const PACIFIC = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });

/** The Pacific calendar day (YYYY-MM-DD) of an ISO timestamp. */
export const pacificDay = (iso: string): string => PACIFIC.format(new Date(iso));

/** "12.34" or 12.34 to 1234; blank or junk is 0. */
export const cents = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

/** Split [from, to] (ISO dates, inclusive) into chunks of at most `days` days. */
export function chunks(from: string, to: string, days: number): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  const day = 86_400_000;
  for (let s = Date.parse(from); s <= Date.parse(to); s += days * day) {
    out.push({ from: new Date(s).toISOString().slice(0, 10), to: new Date(Math.min(s + (days - 1) * day, Date.parse(to))).toISOString().slice(0, 10) });
  }
  return out;
}
