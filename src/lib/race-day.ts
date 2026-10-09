/**
 * Race-day helpers, shared by the per-day reports (Best Losing Package,
 * Perfect RT, Dead On) and the pages that pick a day.
 * Safe to use in both server and client components (no firebase imports).
 *
 * One event's stored runs can span several unrelated days: getresults lists a
 * track's previous weekend under the new event's date dropdown, and a midweek
 * evening session runs under the same E1/E2 labels as the real eliminations.
 * The round name alone can't tell those apart; the day can.
 */
import { parseTsToDate } from "./timestamp-utils";

/**
 * A pass marked AM before this hour belongs to the race day that started the
 * evening before. A session that runs past midnight carries its last pairs onto
 * the next date (tagRunTimestamps marks them AM), and they are still that
 * night's round. Only an explicit AM counts, so an untagged "1:30" is never
 * pulled back a day.
 */
const RACE_DAY_ROLLOVER_HOUR = 6;

interface Dated {
  timestamp?: string | null;
  start_date?: string | null;
}

function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "M/D/YYYY", "M/D/YY", "YYYYMMDD" or "YYYY-MM-DD" -> "YYYY-MM-DD", else "". */
function dayFromDateText(text: string | null | undefined): string {
  const t = (text || "").trim();
  const iso = t.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const mdy = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (mdy) {
    const year = mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3];
    return `${year}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  }
  return "";
}

/**
 * The race day a pass belongs to, "YYYY-MM-DD", or "" when nothing on the row
 * dates it. The timestamp's own date wins; a row whose timestamp carries no
 * date takes the start date its scrape or import stamped on it (getresults'
 * event start, the EData race date, the CSV upload's start date).
 */
export function raceDayOf(run: Dated): string {
  const ts = (run.timestamp || "").trim();
  const when = parseTsToDate(ts);
  if (when) {
    if (/AM$/i.test(ts) && when.getHours() < RACE_DAY_ROLLOVER_HOUR) {
      when.setDate(when.getDate() - 1);
    }
    return isoDay(when);
  }
  return dayFromDateText(ts.split(/\s+/)[0]) || dayFromDateText(run.start_date);
}

/**
 * The days an event's passes can fall on, from its start date: the test day
 * before through EVENT_DAYS_AFTER_START days after (a Wednesday-to-Monday
 * national, or a weekend pushed a day by rain). getresults has no end date, so
 * the span is the longest event plus a rain day. Inclusive "YYYY-MM-DD" bounds;
 * null when the start date can't be read (then nothing can be judged).
 */
export const EVENT_DAYS_BEFORE_START = 1;
export const EVENT_DAYS_AFTER_START = 5;

export interface EventWindow {
  from: string;
  to: string;
}

function shiftDay(day: string, days: number): string {
  const [y, m, d] = day.split("-").map((n) => parseInt(n, 10));
  return isoDay(new Date(y, m - 1, d + days));
}

export function eventWindow(startDate: string | null | undefined): EventWindow | null {
  const start = dayFromDateText(startDate);
  if (!start) return null;
  return { from: shiftDay(start, -EVENT_DAYS_BEFORE_START), to: shiftDay(start, EVENT_DAYS_AFTER_START) };
}

/** Whether a pass can belong to the event; an undated pass is never ruled out. */
export function inEventWindow(run: Dated, window: EventWindow | null): boolean {
  if (!window) return true;
  const day = raceDayOf(run);
  return !day || (day >= window.from && day <= window.to);
}

/** Every race day in `runs`, oldest first, with how many passes each holds. */
export function raceDaysOf(runs: Dated[]): { day: string; runs: number }[] {
  const counts = new Map<string, number>();
  for (const r of runs) {
    const day = raceDayOf(r);
    if (day) counts.set(day, (counts.get(day) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, n]) => ({ day, runs: n }));
}

/**
 * Resolve a report's `race_day` parameter against the passes it could show.
 * "all" = no day filter (null); a "YYYY-MM-DD" passes through; anything else —
 * the default — is the most recent race day among `candidates`, so a report
 * opens on the latest session of the rounds and classes picked rather than on
 * a day they never ran.
 */
export function resolveRaceDay(param: string | null | undefined, candidates: Dated[]): string | null {
  const p = (param || "").trim().toLowerCase();
  if (p === "all") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return p;
  let latest = "";
  for (const r of candidates) {
    const day = raceDayOf(r);
    if (day > latest) latest = day;
  }
  return latest || null;
}

/** "10/08/2026 11:24:14 AM" -> "Thu, 10/8, 11:24 AM" ("" when unreadable). */
export function formatPassTime(timestamp: string | null | undefined): string {
  const when = parseTsToDate(timestamp || "");
  if (!when) return "";
  return when.toLocaleString("en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "2026-10-08" -> "Thu, Oct 8". */
export function formatRaceDay(day: string): string {
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return day;
  const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
