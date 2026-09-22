import type { RunRow } from "./db";
import { RACE_CLASSES } from "./schedule-classes";
import { groupRunsByTimestamp, parseTsToDate } from "./timestamp-utils";

/**
 * Builder for CompuLink StarTrak "EData" elimination files (C##EDAT.TXT) — the
 * inverse of edata-parse.ts. Turns the app's stored elimination runs into the
 * text format RACEDATA disks carry, one file per class:
 *
 *   Compulink StarTrak TOP SPORTSMAN Elimination Results
 *   ROUND 1
 *   6,0,TS,0,M. Chitty,,,,  .061,6.52, 6.526,212.77
 *   77,0,TS,0,R. Mendenhall,,,,  .019,6.90, 6.949,196.51
 *   ...
 *   FINALS
 *   ...
 *   End of File
 *
 * Twelve comma-separated fields: car number, member number, class code,
 * qualifying position, driver ("F. Last"), city/state, vehicle, engine, RT,
 * dial-in, ET, MPH. City/vehicle/engine aren't on RunRow, so they export
 * blank — the readers we feed (racedata-zip-to-pdf) don't need them.
 *
 * Pair ordering: left lane first, then right, matching how the getresults →
 * EDAT conversions have been produced (a red-lighting left-lane car stays on
 * the first line even though it lost). Rows without lane data (EData-imported
 * rounds) fall back to winner-first, which is CompuLink's own convention. A
 * bye is the lone racer's line followed by a `SINGLE,...` marker.
 *
 * Only rounds the data actually has are written: `E<n>` becomes `ROUND n` and
 * `F` becomes `FINALS`. No rounds or pairings are invented.
 */

export interface EdataExportFile {
  /** CompuLink-style name: C1EDAT.TXT, C2EDAT.TXT, … */
  filename: string;
  category: string;
  classCode: string;
  /** Round codes present, in written order (E1, E2, …, F). */
  rounds: string[];
  pairs: number;
  runs: number;
  content: string;
}

export interface EdataExportResult {
  files: EdataExportFile[];
  warnings: string[];
}

const EOL = "\r\n";

function isElimRound(round: string | null | undefined): boolean {
  return !!round && (/^E\d+$/.test(round) || round === "F");
}

function roundOrder(round: string): number {
  if (round === "F") return 100;
  const m = round.match(/^E(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}

function roundLabel(round: string): string {
  if (round === "F") return "FINALS";
  const m = round.match(/^E(\d+)$/);
  return m ? `ROUND ${parseInt(m[1], 10)}` : round;
}

function isRunWinner(run: RunRow): boolean {
  const r = (run.result || "").trim().toUpperCase();
  return r === "W" || (!r && run.is_winner === 1);
}

function laneOrder(lane: string | null): number | null {
  const l = (lane || "").trim().toUpperCase();
  if (l === "L" || l === "L1" || l === "1") return 1;
  if (l === "R" || l === "L2" || l === "2") return 2;
  const n = parseInt(l, 10);
  return Number.isFinite(n) ? n : null;
}

/** " 1.293", "  .031", "- .028" — no leading 0 before the dot when |RT| < 1. */
function fmtRt(rt: number | null): string {
  if (rt === null || !Number.isFinite(rt)) return "";
  const abs = Math.abs(rt);
  let s = abs.toFixed(3);
  if (abs < 1) s = s.slice(1);
  return (rt < 0 ? "-" : " ") + s.padStart(5);
}

/** " 4.853" — three decimals, right-aligned to six characters. */
function fmtEt(et: number | null): string {
  if (et === null || !Number.isFinite(et)) return "";
  return et.toFixed(3).padStart(6);
}

/** "138.28", " 80.83" — two decimals, right-aligned to six characters. */
function fmtMph(mph: number | null): string {
  if (mph === null || !Number.isFinite(mph)) return "";
  return mph.toFixed(2).padStart(6);
}

function fmtDial(dial: number | null): string {
  if (dial === null || !Number.isFinite(dial) || dial < 0) return "";
  return dial.toFixed(2);
}

/** "Justin Ashley" → "J. Ashley"; already-short "J. Ashley" passes through. */
function shortName(name: string | null): string {
  const n = (name || "").trim().replace(/\s+/g, " ");
  if (!n) return "";
  const space = n.indexOf(" ");
  if (space === -1) return n;
  const initial = n.slice(0, space).replace(/\./g, "").charAt(0).toUpperCase();
  const rest = n.slice(space + 1);
  return initial ? `${initial}. ${rest}` : rest;
}

/** The format has no quoting, so a comma in any field would shear the line. */
function csvSafe(v: string): string {
  return v.replace(/,/g, " ").replace(/\s+/g, " ").trim();
}

const CLASS_BY_NAME = new Map<string, { code: string; order: number }>();
RACE_CLASSES.forEach((c, i) => {
  const key = c.name.trim().toUpperCase();
  if (c.code && !CLASS_BY_NAME.has(key)) CLASS_BY_NAME.set(key, { code: c.code, order: i });
});

function classInfo(category: string, runs: RunRow[]): { code: string; order: number } {
  const known = CLASS_BY_NAME.get(category.trim().toUpperCase());
  if (known) return known;
  // EData-imported rows carry the class code in class_index — reuse it when
  // every row agrees.
  const codes = new Set(
    runs
      .map((r) => (r.class_index || "").trim().toUpperCase())
      .filter((c) => /^[A-Z]{1,6}$/.test(c)),
  );
  if (codes.size === 1) return { code: [...codes][0], order: RACE_CLASSES.length };
  // Last resort: the category's initials.
  const initials = category
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .map((w) => w.charAt(0))
    .join("")
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4);
  return { code: initials || "X", order: RACE_CLASSES.length };
}

/** More recorded timing data wins when collapsing timing-system resets. */
function dataScore(r: RunRow): number {
  let s = 0;
  for (const v of [r.rt, r.ft60, r.ft330, r.ft660, r.mph_660, r.ft1000, r.mph_1000, r.ft1320, r.mph_1320]) {
    if (v !== null && v !== undefined) s++;
  }
  return s;
}

function runLine(run: RunRow, classCode: string, quarterMile: boolean): string {
  const et = quarterMile ? run.ft1320 : run.ft660;
  const mph = quarterMile ? run.mph_1320 : run.mph_660;
  const fields = [
    csvSafe(run.car_number || ""),
    csvSafe(run.member_number || "") || "0",
    classCode,
    run.qual_pos !== null && run.qual_pos !== undefined ? String(run.qual_pos) : "0",
    csvSafe(shortName(run.name)),
    "", // city/state — not stored on RunRow
    "", // vehicle
    "", // engine
    fmtRt(run.rt),
    fmtDial(run.dial_in),
    fmtEt(et ?? null),
    fmtMph(mph ?? null),
  ];
  return fields.join(",");
}

function singleMarker(run: RunRow): string {
  const member = csvSafe(run.member_number || "") || "0";
  return `SINGLE,${member},,0,,,,,,,,`;
}

function tsMillis(ts: string): number {
  const d = parseTsToDate(ts);
  return d ? d.getTime() : 0;
}

/**
 * Build one EDAT file per category from the given elimination runs. Rounds
 * that aren't eliminations (Q, T, …) are ignored, so passing a full event's
 * runs is fine.
 */
export function buildEdataExport(runs: RunRow[]): EdataExportResult {
  const warnings: string[] = [];

  const byCategory = new Map<string, RunRow[]>();
  for (const run of runs) {
    if (!isElimRound(run.round)) continue;
    const cat = (run.category || "").trim();
    if (!cat) continue;
    const list = byCategory.get(cat);
    if (list) list.push(run);
    else byCategory.set(cat, [run]);
  }

  // Stable class numbering: known classes in RACE_CLASSES order (pros first),
  // anything else alphabetically after them.
  const categories = [...byCategory.entries()]
    .map(([category, catRuns]) => ({ category, catRuns, ...classInfo(category, catRuns) }))
    .sort((a, b) => a.order - b.order || a.category.localeCompare(b.category));

  const files: EdataExportFile[] = [];

  categories.forEach(({ category, catRuns, code }, catIndex) => {
    // Whether this class's finish line is the quarter or the eighth: a class
    // with any 1320 data is quarter-mile; otherwise fall back to the 660.
    const quarterMile =
      catRuns.some((r) => r.ft1320 !== null || r.mph_1320 !== null) ||
      !catRuns.some((r) => r.ft660 !== null);

    const roundCodes = [...new Set(catRuns.map((r) => r.round as string))].sort(
      (a, b) => roundOrder(a) - roundOrder(b),
    );

    const lines: string[] = [`Compulink StarTrak ${category.toUpperCase()} Elimination Results`];
    let pairs = 0;
    let runCount = 0;

    for (const round of roundCodes) {
      const roundRuns = catRuns.filter((r) => r.round === round);
      const groups = [...groupRunsByTimestamp(roundRuns).entries()].sort(
        (a, b) => tsMillis(a[0]) - tsMillis(b[0]),
      );

      lines.push(roundLabel(round));

      for (const [, groupRuns] of groups) {
        // Collapse timing-system resets: same car twice in one pair keeps the
        // row with the most recorded data.
        const byCar = new Map<string, RunRow>();
        const anonymous: RunRow[] = [];
        for (const r of groupRuns) {
          const key = (r.car_number || "").trim().toUpperCase();
          if (!key) {
            anonymous.push(r);
            continue;
          }
          const existing = byCar.get(key);
          if (!existing || dataScore(r) > dataScore(existing)) byCar.set(key, r);
        }
        const pairRuns = [...byCar.values(), ...anonymous];

        // Left lane first when lanes are known; otherwise winner first
        // (CompuLink's own ordering, and what EData-imported rows preserve).
        pairRuns.sort((a, b) => {
          const la = laneOrder(a.lane);
          const lb = laneOrder(b.lane);
          if (la !== null && lb !== null && la !== lb) return la - lb;
          return (isRunWinner(b) ? 1 : 0) - (isRunWinner(a) ? 1 : 0);
        });

        if (pairRuns.length > 2) {
          warnings.push(
            `${category} ${round}: ${pairRuns.length} cars share one pairing (4-wide?) — written as consecutive lines.`,
          );
        }

        for (const r of pairRuns) lines.push(runLine(r, code, quarterMile));
        if (pairRuns.length === 1) lines.push(singleMarker(pairRuns[0]));

        pairs++;
        runCount += pairRuns.length;
      }
    }

    lines.push("End of File");

    files.push({
      filename: `C${catIndex + 1}EDAT.TXT`,
      category,
      classCode: code,
      rounds: roundCodes,
      pairs,
      runs: runCount,
      content: lines.join(EOL) + EOL,
    });
  });

  if (files.length === 0) {
    warnings.push("No elimination rounds (E1, E2, …, F) on file for this event yet.");
  }

  return { files, warnings };
}
