/**
 * Shared timestamp utilities for grouping nearby timestamps.
 * Safe to use in both server and client components (no firebase imports).
 */

export function parseTsToDate(ts: string): Date | null {
  try {
    const parts = ts.split(" ");
    const datePart = parts[0];
    const timePart = parts[1];
    const ampm = parts[2]?.toUpperCase();
    const [month, day, year] = datePart.split("/");
    const [hh, mm, ss] = timePart.split(":");
    let hour = parseInt(hh, 10);

    if (ampm === "PM" && hour !== 12) hour += 12;
    else if (ampm === "AM" && hour === 12) hour = 0;

    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      hour,
      parseInt(mm),
      parseInt(ss || "0")
    );
  } catch {
    return null;
  }
}

/**
 * Group nearby timestamps together (for 4-wide racing where lanes 1&2 and 3&4
 * may have slightly different timestamps). Returns a Map from each raw timestamp
 * to a canonical "group" timestamp. Timestamps within `toleranceSec` seconds
 * of each other are merged into one group.
 */
const QUAD_TS_TOLERANCE_SEC = 10;

export function buildTimestampGroups(timestamps: string[], toleranceSec: number = QUAD_TS_TOLERANCE_SEC): Map<string, string> {
  const mapping = new Map<string, string>();
  if (timestamps.length === 0) return mapping;

  const unique = [...new Set(timestamps)];
  const withDates = unique
    .map((ts) => ({ ts, date: parseTsToDate(ts) }))
    .sort((a, b) => {
      if (a.date && b.date) return a.date.getTime() - b.date.getTime();
      return a.ts.localeCompare(b.ts);
    });

  let groupLeader = withDates[0].ts;
  let groupDate = withDates[0].date;
  mapping.set(withDates[0].ts, groupLeader);

  for (let i = 1; i < withDates.length; i++) {
    const { ts, date } = withDates[i];
    if (groupDate && date && Math.abs(date.getTime() - groupDate.getTime()) / 1000 <= toleranceSec) {
      mapping.set(ts, groupLeader);
    } else {
      groupLeader = ts;
      groupDate = date;
      mapping.set(ts, groupLeader);
    }
  }

  return mapping;
}

/**
 * Group runs by canonical timestamp. Returns a Map from canonical timestamp to runs.
 */
export function groupRunsByTimestamp<T extends { timestamp: string | null }>(runs: T[]): Map<string, T[]> {
  const timestamps = runs.map((r) => r.timestamp).filter(Boolean) as string[];
  const tsGroups = buildTimestampGroups(timestamps);

  const grouped = new Map<string, T[]>();
  for (const run of runs) {
    const ts = run.timestamp || "unknown";
    const canonical = tsGroups.get(ts) || ts;
    const arr = grouped.get(canonical) || [];
    arr.push(run);
    grouped.set(canonical, arr);
  }
  return grouped;
}
