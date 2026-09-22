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
 *   6,248262,TS,0,Michael Chitty,Ames IA,'08 Chevy Cobalt,CHEV  665,  .061,6.52, 6.526,212.77
 *   77,0,TS,0,Ray Mendenhall,,,,  .019,6.90, 6.949,196.51
 *   ...
 *   FINALS
 *   ...
 *   End of File
 *
 * Twelve comma-separated fields: car number, member number, class code,
 * qualifying position, driver (full name, never "F. Last"), city + 2-letter
 * state, body ('YY Make Model), engine (MAKE  CID), RT, dial-in, ET, MPH.
 *
 * The timing data carries none of member/city/body/engine, so those merge in
 * from the event's tech cards, matched per class by car number first and
 * driver name second. A run with no tech card exports those fields blank.
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

/** The tech-card fields the export reads (TechCardEntry satisfies this). */
export interface EdataTechCard {
  car_number: string;
  first_name: string;
  last_name: string;
  city: string;
  state: string;
  /** Class abbreviation as entered: TS, SS, SC, … */
  category: string;
  class_name: string;
  engine_make: string;
  body_type: string;
  body_year: string;
  /** Cubic inches / cc as entered ("665", "665 CI", …). */
  cu_cc: string;
  member_number: string;
  event_name?: string;
}

export interface EdataExportFile {
  /** CompuLink-style name: C1EDAT.TXT, C2EDAT.TXT, … */
  filename: string;
  category: string;
  classCode: string;
  /** Round codes present, in written order (E1, E2, …, F). */
  rounds: string[];
  pairs: number;
  runs: number;
  /** How many of the file's runs found a tech card to fill the entry fields. */
  enriched: number;
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

/** The format has no quoting, so a comma in any field would shear the line. */
function csvSafe(v: string): string {
  return v.replace(/,/g, " ").replace(/\s+/g, " ").trim();
}

function norm(s: string | null | undefined): string {
  return (s || "").trim().toUpperCase().replace(/\s+/g, " ");
}

// ——— Tech-card field formatting (the CompuLink entry-record shapes) ———

/** "Ames IA" — city plus 2-letter state. */
function cityState(tc: EdataTechCard): string {
  const city = csvSafe(tc.city || "");
  const st = csvSafe(tc.state || "").toUpperCase();
  return [city, st].filter(Boolean).join(" ");
}

// Long forms and recurring typos → the short forms the CompuLink files use.
const BODY_WORD_FIXES: Record<string, string> = {
  CHEVROLET: "Chevy",
  CHEVRLOET: "Chevy",
  CHEV: "Chevy",
  CHEVY: "Chevy",
  CAMARO: "Camaro",
  CAMERO: "Camaro",
  CAMAERO: "Camaro",
};

function bodyWord(w: string): string {
  const fixed = BODY_WORD_FIXES[w.toUpperCase()];
  if (fixed) return fixed;
  // Tech cards often arrive ALL CAPS; title-case real words but leave short
  // model codes (SS, GTO, Z28) alone.
  if (/^[A-Z]{4,}$/.test(w)) return w.charAt(0) + w.slice(1).toLowerCase();
  return w;
}

/** "'08 Chevy Cobalt" — apostrophe-year plus normalized make/model. */
function bodyString(tc: EdataTechCard): string {
  const body = (tc.body_type || "").trim().split(/\s+/).filter(Boolean).map(bodyWord).join(" ");
  // Some entries already carry the year in the body ("'63 Nova").
  if (/^'\d{2}\b/.test(body)) return csvSafe(body);
  const digits = (tc.body_year || "").replace(/\D/g, "");
  const year = digits ? `'${digits.slice(-2).padStart(2, "0")}` : "";
  return csvSafe([year, body].filter(Boolean).join(" "));
}

const ENGINE_MAKE_FIXES: Record<string, string> = {
  CHEVY: "CHEV",
  CHEVROLET: "CHEV",
  CHEVRLOET: "CHEV",
};

/** "CHEV  665" — make (CompuLink short form) + two spaces + cubic inches. */
function engineString(tc: EdataTechCard): string {
  let make = csvSafe(tc.engine_make || "").toUpperCase();
  make = ENGINE_MAKE_FIXES[make] || make;
  const cid = ((tc.cu_cc || "").match(/\d+/) || [""])[0];
  if (make && cid) return `${make.padEnd(4)}  ${cid}`;
  return csvSafe(make || cid);
}

function fullName(tc: EdataTechCard): string {
  return csvSafe(`${tc.first_name || ""} ${tc.last_name || ""}`);
}

// ——— Class codes and category ordering ———

const CLASS_BY_NAME = new Map<string, { code: string; order: number }>();
RACE_CLASSES.forEach((c, i) => {
  const key = c.name.trim().toUpperCase();
  if (c.code && !CLASS_BY_NAME.has(key)) CLASS_BY_NAME.set(key, { code: c.code, order: i });
});

function classInfo(category: string, runs: RunRow[]): { code: string; order: number } {
  const known = CLASS_BY_NAME.get(norm(category));
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
  const initials = norm(category)
    .split(" ")
    .map((w) => w.charAt(0))
    .join("")
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4);
  return { code: initials || "X", order: RACE_CLASSES.length };
}

// ——— Tech card ↔ run matching (same shape as the no-shows cross-reference:
// class first, then car number, with driver name as the fallback) ———

function techCardMatchesCategory(tc: EdataTechCard, category: string, code: string): boolean {
  const catNorm = norm(category);
  const className = norm(tc.class_name);
  if (className && className === catNorm) return true;
  const tcCode = norm(tc.category);
  if (tcCode && (tcCode === catNorm || tcCode === code)) return true;
  return false;
}

/** How complete an entry record is — the fuller card wins a duplicate key. */
function tcScore(tc: EdataTechCard): number {
  let s = 0;
  for (const v of [tc.member_number, tc.city, tc.state, tc.body_type, tc.engine_make, tc.cu_cc]) {
    if ((v || "").trim()) s++;
  }
  return s;
}

interface CategoryTechIndex {
  byCar: Map<string, EdataTechCard>;
  byName: Map<string, EdataTechCard>;
  /** "D WILKERSON" (first initial + last) — for abbreviated timing names. */
  byInitial: Map<string, EdataTechCard | null>;
  /** The class code the tech cards agree on, when they agree on exactly one. */
  code: string | null;
}

function indexTechCards(cards: EdataTechCard[]): CategoryTechIndex {
  const byCar = new Map<string, EdataTechCard>();
  const byName = new Map<string, EdataTechCard>();
  const byInitial = new Map<string, EdataTechCard | null>();
  const codes = new Set<string>();
  for (const tc of cards) {
    const car = norm(tc.car_number);
    if (car) {
      const prev = byCar.get(car);
      if (!prev || tcScore(tc) > tcScore(prev)) byCar.set(car, tc);
    }
    const name = norm(`${tc.first_name || ""} ${tc.last_name || ""}`);
    if (name) {
      const prev = byName.get(name);
      if (!prev || tcScore(tc) > tcScore(prev)) byName.set(name, tc);
    }
    const initialKey = initialLastKey(`${tc.first_name || ""} ${tc.last_name || ""}`);
    if (initialKey) {
      // Two different people can share an initial + last name (father/son) —
      // an ambiguous key matches nobody rather than guessing.
      const prev = byInitial.get(initialKey);
      if (prev === undefined) byInitial.set(initialKey, tc);
      else if (prev && norm(`${prev.first_name} ${prev.last_name}`) !== name) byInitial.set(initialKey, null);
    }
    const code = norm(tc.category);
    if (/^[A-Z0-9]{1,6}$/.test(code)) codes.add(code);
  }
  return { byCar, byName, byInitial, code: codes.size === 1 ? [...codes][0] : null };
}

/** "Daniel Wilkerson" or "D. WIlkerson" → "D WILKERSON"; null when unusable. */
function initialLastKey(name: string | null): string | null {
  const n = norm(name).replace(/\./g, "");
  const parts = n.split(" ").filter(Boolean);
  if (parts.length < 2) return null;
  const initial = parts[0].charAt(0);
  const last = parts[parts.length - 1];
  if (!initial || !last) return null;
  return `${initial} ${last}`;
}

function techCardForRun(run: RunRow, index: CategoryTechIndex): EdataTechCard | null {
  // Category is already scoped by the caller; within it, car number is the
  // strongest join, exact name next, and the timing system's abbreviated
  // "D. Wilkerson" style last (only when it singles out one card).
  const byCar = index.byCar.get(norm(run.car_number));
  if (byCar) return byCar;
  const byName = index.byName.get(norm(run.name));
  if (byName) return byName;
  const key = initialLastKey(run.name);
  return (key && index.byInitial.get(key)) || null;
}

// ——— Line assembly ———

/** More recorded timing data wins when collapsing timing-system resets. */
function dataScore(r: RunRow): number {
  let s = 0;
  for (const v of [r.rt, r.ft60, r.ft330, r.ft660, r.mph_660, r.ft1000, r.mph_1000, r.ft1320, r.mph_1320]) {
    if (v !== null && v !== undefined) s++;
  }
  return s;
}

function runLine(
  run: RunRow,
  tc: EdataTechCard | null,
  classCode: string,
  quarterMile: boolean,
): string {
  const et = quarterMile ? run.ft1320 : run.ft660;
  const mph = quarterMile ? run.mph_1320 : run.mph_660;
  const fields = [
    csvSafe(run.car_number || ""),
    csvSafe(run.member_number || "") || (tc ? csvSafe(tc.member_number || "") : "") || "0",
    classCode,
    run.qual_pos !== null && run.qual_pos !== undefined ? String(run.qual_pos) : "0",
    (tc ? fullName(tc) : "") || csvSafe(run.name || ""),
    tc ? cityState(tc) : "",
    tc ? bodyString(tc) : "",
    tc ? engineString(tc) : "",
    fmtRt(run.rt),
    fmtDial(run.dial_in),
    fmtEt(et ?? null),
    fmtMph(mph ?? null),
  ];
  return fields.join(",");
}

function singleMarker(run: RunRow, tc: EdataTechCard | null): string {
  const member =
    csvSafe(run.member_number || "") || (tc ? csvSafe(tc.member_number || "") : "") || "0";
  return `SINGLE,${member},,0,,,,,,,,`;
}

function tsMillis(ts: string): number {
  const d = parseTsToDate(ts);
  return d ? d.getTime() : 0;
}

/**
 * Build one EDAT file per category from the given elimination runs, merging
 * entry-record fields (member number, full name, city, body, engine) in from
 * the tech cards. Rounds that aren't eliminations (Q, T, …) are ignored, so
 * passing a full event's runs is fine; tech cards for other events are
 * filtered out by event_name.
 */
export function buildEdataExport(
  runs: RunRow[],
  techCards: EdataTechCard[] = [],
): EdataExportResult {
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

  // Tech cards scoped to this event: cards tagged with another event's name
  // are someone else's entries.
  const eventNames = new Set(runs.map((r) => norm(r.event_name)).filter(Boolean));
  const eventCards = techCards.filter(
    (tc) => !norm(tc.event_name) || eventNames.size === 0 || eventNames.has(norm(tc.event_name)),
  );

  // Stable class numbering: known classes in RACE_CLASSES order (pros first),
  // anything else alphabetically after them.
  const categories = [...byCategory.entries()]
    .map(([category, catRuns]) => ({ category, catRuns, ...classInfo(category, catRuns) }))
    .sort((a, b) => a.order - b.order || a.category.localeCompare(b.category));

  const files: EdataExportFile[] = [];

  categories.forEach(({ category, catRuns, code: fallbackCode }, catIndex) => {
    const techIndex = indexTechCards(
      eventCards.filter((tc) => techCardMatchesCategory(tc, category, fallbackCode)),
    );
    // The entry system's own abbreviation beats our name-table guess.
    const code = techIndex.code || fallbackCode;

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
    let enriched = 0;

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
          const key = norm(r.car_number);
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

        for (const r of pairRuns) {
          const tc = techCardForRun(r, techIndex);
          if (tc) enriched++;
          lines.push(runLine(r, tc, code, quarterMile));
        }
        if (pairRuns.length === 1) {
          lines.push(singleMarker(pairRuns[0], techCardForRun(pairRuns[0], techIndex)));
        }

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
      enriched,
      content: lines.join(EOL) + EOL,
    });
  });

  if (files.length === 0) {
    warnings.push("No elimination rounds (E1, E2, …, F) on file for this event yet.");
  }

  return { files, warnings };
}
