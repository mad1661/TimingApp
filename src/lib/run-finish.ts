/** Finish ET / MPH helpers. 1/8-mile passes store the finish at 660', not 1320'. */

export function hasFinishEt(run: { ft1320?: number | null; ft660?: number | null }): boolean {
  return (run.ft1320 != null && run.ft1320 > 0) || (run.ft660 != null && run.ft660 > 0);
}

export function isEighthMileRun(run: { ft1320?: number | null; ft660?: number | null }): boolean {
  return (run.ft660 != null && run.ft660 > 0) && !(run.ft1320 != null && run.ft1320 > 0);
}

export function isEighthMileGroup(runs: { ft1320?: number | null; ft660?: number | null }[]): boolean {
  const finished = runs.filter(hasFinishEt);
  return finished.length > 0 && finished.every(isEighthMileRun);
}

export function finishEt(run: { ft1320?: number | null; ft660?: number | null }): number | null {
  if (run.ft1320 != null && run.ft1320 > 0) return run.ft1320;
  if (run.ft660 != null && run.ft660 > 0) return run.ft660;
  return run.ft1320 ?? run.ft660 ?? null;
}

export function finishMph(run: { mph_1320?: number | null; mph_660?: number | null }): number | null {
  if (run.mph_1320 != null && run.mph_1320 > 0) return run.mph_1320;
  if (run.mph_660 != null && run.mph_660 > 0) return run.mph_660;
  return run.mph_1320 ?? run.mph_660 ?? null;
}

/** Same person in a pair: car number first (names are often blank on 1/8-mile), then name. */
export function isSameRacer(
  a: { name?: string | null; car_number?: string | null },
  b: { name?: string | null; car_number?: string | null },
): boolean {
  const aCar = (a.car_number || "").trim();
  const bCar = (b.car_number || "").trim();
  if (aCar && bCar && aCar.toLowerCase() === bCar.toLowerCase()) return true;
  const aName = (a.name || "").trim();
  const bName = (b.name || "").trim();
  if (aName && bName && aName.toLowerCase() === bName.toLowerCase()) return true;
  return false;
}

export function normalizeRacerSearch(q: string): string {
  return q.trim().replace(/^#/, "").trim().toLowerCase();
}
