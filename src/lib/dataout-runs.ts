import type { RunRow } from "./db";
import { eventWindow, inEventWindow, raceDayOf } from "./race-day";

/**
 * Which of an event's stored runs belong in its Compulink package. Nothing is
 * moved or deleted — passes that belong to another race are only left out of
 * the export, and each kind of leave-out is named in a warning.
 *
 *   1. The event's date window (race-day.ts): getresults has filed a whole
 *      other national under a divisional (D7 2026 event 74 holds the 04/09–
 *      04/12 Winternationals).
 *   2. A class whose round 1 was run twice — the same car racing E1 on two
 *      different days — holds two races: a doubleheader's other race filed
 *      under this event (D2 2026 LO2-4 holds the Friday junior race next to
 *      Sunday's). The race that starts on or after the event's start date is
 *      the event's own; the other race's passes are left out.
 *   3. An elimination pass dated before its class's round 1 belongs to the
 *      race before (D1 2026 event 15 holds race 4's Stock final from 07/24).
 */

export interface DataOutRunSelection {
  runs: RunRow[];
  warnings: string[];
  /** Passes left out, by reason. */
  dropped: { outsideWindow: number; otherRace: number; beforeRoundOne: number };
}

function norm(s: string | null | undefined): string {
  return (s || "").trim().toUpperCase().replace(/\s+/g, " ");
}

function roundNumber(round: string | null | undefined): number | null {
  const r = norm(round);
  if (r === "F") return 100;
  const m = r.match(/^E(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

/** "2026-04-09" → "04/09". */
function shortDay(day: string): string {
  return day.length === 10 ? `${day.slice(5, 7)}/${day.slice(8, 10)}` : day;
}

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) || 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [v, c] of counts) {
    if (c > n) {
      best = v;
      n = c;
    }
  }
  return best;
}

export function selectDataOutRuns(
  runs: RunRow[],
  opts: { startDate?: string | null } = {},
): DataOutRunSelection {
  const warnings: string[] = [];
  const dropped = { outsideWindow: 0, otherRace: 0, beforeRoundOne: 0 };

  // ——— 1. The event's date window ———
  const startDate = (opts.startDate || "").trim() || mostCommon(runs.map((r) => (r.start_date || "").trim()));
  const window = eventWindow(startDate);
  let kept = runs;
  if (window) {
    const outside = new Map<string, number>();
    kept = runs.filter((r) => {
      if (inEventWindow(r, window)) return true;
      const day = raceDayOf(r);
      outside.set(day, (outside.get(day) || 0) + 1);
      return false;
    });
    dropped.outsideWindow = runs.length - kept.length;
    if (dropped.outsideWindow) {
      const days = [...outside.entries()].sort(([a], [b]) => a.localeCompare(b));
      warnings.push(
        `${dropped.outsideWindow} pass${dropped.outsideWindow === 1 ? "" : "es"} dated outside the event (${shortDay(window.from)}–${shortDay(window.to)}) left out: ${days
          .map(([d, n]) => `${shortDay(d)} (${n})`)
          .join(", ")}.`,
      );
    }
  }
  const start = raceDayOfStart(startDate);

  // ——— 2 + 3. Per class: the event's own race, and passes before its round 1 ———
  const byCategory = new Map<string, RunRow[]>();
  for (const r of kept) {
    const key = norm(r.category);
    const list = byCategory.get(key);
    if (list) list.push(r);
    else byCategory.set(key, [r]);
  }
  const leaveOut = new Set<RunRow>();
  for (const catRuns of byCategory.values()) {
    const category = (catRuns[0].category || "").trim();
    const elim = catRuns.filter((r) => roundNumber(r.round) !== null);
    const roundOne = elim.filter((r) => roundNumber(r.round) === 1 && (r.car_number || "").trim());
    if (roundOne.length === 0) continue;

    // Round-1 days in order; a day re-racing a car the current race already
    // ran in round 1 starts a new race.
    const days = [...new Set(roundOne.map((r) => raceDayOf(r)).filter(Boolean))].sort();
    const starts: string[] = [];
    let raced = new Set<string>();
    for (const day of days) {
      const cars = new Set(roundOne.filter((r) => raceDayOf(r) === day).map((r) => norm(r.car_number)));
      if (starts.length === 0 || [...cars].some((c) => raced.has(c))) {
        starts.push(day);
        raced = new Set();
      }
      for (const c of cars) raced.add(c);
    }

    let raceStart = starts[0] || "";
    let raceEnd = "";
    if (starts.length > 1) {
      // The event's own race starts on or after its start date and is the
      // full one — a stray pair logged as round 1 a day early is not a race.
      const size = (i: number) =>
        elim.filter((r) => {
          const d = raceDayOf(r);
          return d >= starts[i] && (i + 1 >= starts.length || d < starts[i + 1]);
        }).length;
      const onOrAfter = starts.map((d, i) => i).filter((i) => !start || starts[i] >= start);
      const candidates = onOrAfter.length ? onOrAfter : starts.map((_, i) => i);
      const pick = candidates.reduce((a, b) => (size(b) > size(a) ? b : a));
      raceStart = starts[pick];
      raceEnd = starts[pick + 1] || "";
      const others = starts.filter((_, i) => i !== pick);
      const inOther = (day: string) => day < raceStart || (!!raceEnd && day >= raceEnd);
      const lastOtherElim = elim
        .map((e) => raceDayOf(e))
        .filter((d) => d && inOther(d))
        .sort()
        .pop();
      let n = 0;
      for (const r of catRuns) {
        const day = raceDayOf(r);
        if (!day || !inOther(day)) continue;
        // Qualifying for the event's own race can run on the other race's last
        // day; only elimination passes, and anything before the other race
        // finished, go with it.
        if (roundNumber(r.round) !== null || (lastOtherElim && day < lastOtherElim)) {
          leaveOut.add(r);
          n++;
        }
      }
      dropped.otherRace += n;
      if (n) {
        warnings.push(
          `${category}: round 1 is also logged on ${others.map(shortDay).join(" and ")} with cars that raced it again on ${shortDay(raceStart)} — another race's ${n} pass${n === 1 ? " is" : "es are"} left out.`,
        );
      }
    }

    // Elimination passes dated before the race's round 1.
    const early = elim.filter((r) => {
      const day = raceDayOf(r);
      return !leaveOut.has(r) && day && raceStart && day < raceStart && (roundNumber(r.round) ?? 0) > 1;
    });
    if (early.length) {
      for (const r of early) leaveOut.add(r);
      dropped.beforeRoundOne += early.length;
      const rounds = [...new Set(early.map((r) => norm(r.round)))].join(", ");
      warnings.push(
        `${category}: ${early.length} ${rounds} pass${early.length === 1 ? "" : "es"} dated ${[...new Set(early.map((r) => shortDay(raceDayOf(r))))].join(", ")}, before round 1 (${shortDay(raceStart)}) — from an earlier race, left out.`,
      );
    }
  }

  return { runs: leaveOut.size ? kept.filter((r) => !leaveOut.has(r)) : kept, warnings, dropped };
}

/** The event start as "YYYY-MM-DD" for comparing with race days. */
function raceDayOfStart(startDate: string | null): string {
  return startDate ? raceDayOf({ timestamp: null, start_date: startDate }) : "";
}
