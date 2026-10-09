import type { RunRow } from "./db";
import { RACE_CLASSES } from "./schedule-classes";
import { groupRunsByTimestamp, parseTsToDate } from "./timestamp-utils";
import { finishEt, finishMph } from "./run-finish";
import { assignCompulinkClassNumbers } from "./accutime-points";

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
 * from the tech cards already in the store (whatever /tech-cards, the
 * backfill, or the import control on /dataout saved), matched per class by car
 * number first and driver name second. Every stored card is readable: cards
 * whose event_name matches the runs' event (or is blank) are trusted fully,
 * while a card tagged with a different event string — the /tech-cards page
 * and the backfill scrape tag with their own source's naming, which rarely
 * equals the getresults one — still applies, but only where the driver name
 * doesn't contradict it, so a reused car number from another event can't put
 * the wrong person on a row. A run with no card exports those fields blank.
 *
 * Pair ordering: winner first, the way the Compulink tower files list every
 * pair (the MI1 2026 C16EDAT puts a right-lane winner above the left-lane car
 * that red-lit). The lane only orders a pair with no winner marked. A bye is
 * the lone racer's line followed by a `SINGLE,...` marker; the empty-lane row
 * getresults stores beside it (a blank car at Compulink events, a literal
 * `BYE` car at Portatree ones) is not a racer and is never written.
 *
 * Only rounds the data actually has are written: `E<n>` becomes `ROUND n` and
 * `F` becomes `FINALS`. No rounds or pairings are invented.
 *
 * Portatree towers write the same files in their own dialect — `Portatree`
 * headers, unpadded times truncated (not rounded) to three decimals, `0.000`
 * for a missing time, a blank qualifying position, a `SINGLE` marker without
 * the `0`, and the final headed `ROUND n` — so every builder takes the event's
 * timing system (detectTimingSystem reads it off the stored rows).
 */

/** The tower software that wrote the event's files. */
export type TimingSystem = "compulink" | "portatree";

/**
 * Which tower an event ran on, from the shape of its getresults rows:
 * Portatree byes come through as a literal `BYE` car and Portatree leaves the
 * Q Pos column empty (null) where Compulink writes 0.
 */
export function detectTimingSystem(runs: { car_number: string | null; qual_pos: number | null }[]): TimingSystem {
  if (runs.length === 0) return "compulink";
  if (runs.some((r) => (r.car_number || "").trim().toUpperCase() === "BYE")) return "portatree";
  const unpositioned = runs.filter((r) => r.qual_pos === null || r.qual_pos === undefined).length;
  return unpositioned * 2 > runs.length ? "portatree" : "compulink";
}

export function timingHeader(timing: TimingSystem): string {
  return timing === "portatree" ? "Portatree" : "Compulink StarTrak";
}

/**
 * An EDAT / QDAT file as the tower writes it to disk: Compulink fills the
 * last 128-byte record with DOS Ctrl-Zs, Portatree writes the text alone.
 */
export function racedataFileText(content: string, timing: TimingSystem): string {
  if (timing === "portatree") return content;
  const pad = (128 - (content.length % 128)) % 128;
  return content + "\x1a".repeat(pad);
}

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
  /** Horsepower figures — QDAT prints them; EDAT doesn't. */
  hp?: string;
  factored_hp?: string;
  /** Home division ("NED — Division 1") — stored tech cards carry it; points files print the number. */
  home_division?: string;
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

export interface DataOutExportOptions {
  /**
   * Class number per normalized category for the C#… filenames, so a class's
   * EDAT and QDAT share one number even when only one of the two has data.
   * Defaults to each class's Compulink number (Factory Stock Showdown 16,
   * Stock 13, …) over the file's own categories.
   */
  classNumbers?: Map<string, number>;
  /**
   * EDAT only: pairings the source already settled, per normalized category
   * (AccuTime's own passes, winner-first) — written as given instead of
   * re-paired from the timestamps, so the text matches the PDF pair for pair.
   */
  rounds?: Map<string, ElimRound[]>;
  /**
   * How each class (normalized category name) ranks a qualifying pass — the
   * event's own qualifying setup. A class not listed reads its rule off the
   * dial-in column of its passes.
   */
  qualRules?: Record<string, QualRule>;
  /**
   * The second half of the "no reaction time" warning — where the missing RT
   * has to be fixed depends on where the runs came from.
   */
  missingRtFix?: string;
  /** The tower dialect to write. Defaults to Compulink. */
  timing?: TimingSystem;
  /**
   * EDAT only: each class's qualifying sheet position per car (normalized
   * category → car → position), printed where getresults left the row's Q Pos
   * at 0 — the tower prints the position off its own qualifying sheet.
   */
  qualPositions?: Map<string, Map<string, number>>;
}

const EOL = "\r\n";

function isElimRound(round: string | null | undefined): boolean {
  return !!round && (/^E\d+$/.test(round) || round === "F");
}

/**
 * A pass that counts toward the qualifying sheet: the Q sessions, QC, and C1 —
 * the first round of Stock / Super Stock class eliminations at nationals, which
 * the tower ranks as a qualifying session (its later C rounds it doesn't).
 */
function isQualRound(round: string | null | undefined): boolean {
  return !!round && /^(Q\d*|QC|C1)$/i.test(round.trim());
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

export function isRunWinner(run: RunRow): boolean {
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

/** " 1.293", "  .031", " -.028" — no leading 0 before the dot when |RT| < 1, the sign against the digits. */
export function fmtRt(rt: number | null): string {
  if (rt === null || !Number.isFinite(rt)) return "";
  const abs = Math.abs(rt);
  let s = abs.toFixed(3);
  if (s.startsWith("0.")) s = s.slice(1);
  return ((rt < 0 && s !== ".000" ? "-" : "") + s).padStart(6);
}

/** " 4.853" — three decimals, right-aligned to six characters. */
export function fmtEt(et: number | null): string {
  if (et === null || !Number.isFinite(et)) return "";
  return et.toFixed(3).padStart(6);
}

/** "138.28", " 80.83" — two decimals, right-aligned to six characters. */
export function fmtMph(mph: number | null): string {
  if (mph === null || !Number.isFinite(mph)) return "";
  return mph.toFixed(2).padStart(6);
}

/**
 * Portatree cuts its 4-decimal readings down to the printed precision instead
 * of rounding them (0.11881 prints 0.118, a -0.02348 red light -0.024), and
 * getresults sometimes carries the raw reading.
 */
export function truncFixed(v: number, decimals: number): string {
  const scale = 10 ** decimals;
  const cut = Math.floor(v * scale + 1e-6) / scale;
  return (cut === 0 ? 0 : cut).toFixed(decimals);
}

/** Toward zero instead of down — how Portatree cuts the ET-minus-index difference. */
function truncTowardZero(v: number, decimals: number): string {
  const scale = 10 ** decimals;
  const cut = Math.floor(Math.abs(v) * scale + 1e-6) / scale;
  return (v < 0 && cut > 0 ? "-" : "") + cut.toFixed(decimals);
}

function fmtDial(dial: number | null): string {
  if (dial === null || !Number.isFinite(dial) || dial < 0) return "";
  return dial.toFixed(2);
}

/**
 * getresults' stand-ins for a time it never received — 99.999 for the ET and
 * 1.00 for the MPH on a Compulink grid — print as no time. (Portatree's own
 * 64.999 / 0.69 are what its tower writes, so those pass through.)
 */
function realEt(et: number | null | undefined): number | null {
  return et === null || et === undefined || et >= 99.99 ? null : et;
}

function realMph(mph: number | null | undefined): number | null {
  return mph === null || mph === undefined || mph === 1 ? null : mph;
}

/** A dial-in getresults truncated to a lone digit (a 10.00 shown as "1") isn't one. */
function realDial(dial: number | null | undefined): number | null {
  return dial === null || dial === undefined || dial < 2 ? null : dial;
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
export function cityState(tc: EdataTechCard): string {
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

// Makes a tech card's body text often starts with — the tower's body field is
// the model alone ("'06 Cobalt", not "'06 Chevy Cobalt").
const BODY_MAKES = new Set([
  "CHEVY", "CHEVROLET", "CHEVRLOET", "CHEV", "FORD", "DODGE", "PONTIAC", "PLYMOUTH", "OLDSMOBILE", "OLDS", "BUICK",
  "MERCURY", "AMC", "CHRYSLER", "CADILLAC", "LINCOLN", "GMC", "TOYOTA", "NISSAN", "DATSUN", "MAZDA", "SUBARU", "VW",
  "VOLKSWAGEN", "STUDEBAKER", "WILLYS", "JEEP", "HYUNDAI", "MITSUBISHI",
]);

/** Drop a leading make — except where it is the model's own name (Chevy II) or all there is. */
function modelOnly(words: string[]): string[] {
  if (words.length < 2 || !BODY_MAKES.has(words[0].toUpperCase())) return words;
  if (/^(II|2|LL|11)$/i.test(words[1])) return words;
  return words.slice(1);
}

/**
 * "'08 Cobalt" — apostrophe-year plus the normalized model. Cards arrive
 * with the year in every position: its own column, "'63 Nova",
 * "2025 Chevy Camaro" or "Camaro 2016" — all read as the same thing.
 */
export function bodyString(tc: EdataTechCard): string {
  let words = (tc.body_type || "").trim().split(/\s+/).filter(Boolean);
  // Some entries already carry the year in the body ("'63 Nova").
  if (words.length && /^'\d{2}$/.test(words[0])) {
    return csvSafe([words[0], ...modelOnly(words.slice(1)).map(bodyWord)].join(" "));
  }
  let digits = (tc.body_year || "").replace(/\D/g, "");
  // A four-digit year leading or trailing the body text is the year, not a model.
  if (words.length > 1 && /^(19|20)\d{2}$/.test(words[0])) {
    digits = digits || words[0];
    words = words.slice(1);
  } else if (words.length > 1 && /^(19|20)\d{2}$/.test(words[words.length - 1])) {
    digits = digits || words[words.length - 1];
    words = words.slice(0, -1);
  }
  const body = modelOnly(words).map(bodyWord).join(" ");
  const year = digits ? `'${digits.slice(-2).padStart(2, "0")}` : "";
  return csvSafe([year, body].filter(Boolean).join(" "));
}

const ENGINE_MAKE_FIXES: Record<string, string> = {
  CHEVY: "CHEV",
  CHEVROLET: "CHEV",
  CHEVRLOET: "CHEV",
};

/** "CHEV  665" — make (CompuLink short form) + two spaces + cubic inches. */
export function engineString(tc: EdataTechCard): string {
  let make = csvSafe(tc.engine_make || "").toUpperCase();
  make = ENGINE_MAKE_FIXES[make] || make;
  const cid = ((tc.cu_cc || "").match(/\d+/) || [""])[0];
  if (make && cid) return `${make.padEnd(4)}  ${cid}`;
  return csvSafe(make || cid);
}

/** "Troy Coughlin Jr" — the tower writes the suffix without its period. */
export function fullName(tc: EdataTechCard): string {
  return csvSafe(`${tc.first_name || ""} ${tc.last_name || ""}`).replace(/\b(Jr|Sr)\./gi, "$1");
}

/** "1969" — QDAT prints the four-digit year; tech cards often carry two. */
export function bodyYearFull(tc: EdataTechCard | null): string {
  if (!tc) return "";
  const digits = (tc.body_year || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 4) return digits;
  const two = digits.slice(-2);
  return `${parseInt(two, 10) < 50 ? "20" : "19"}${two}`;
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
  // "UNK", not "X" — X is the schedule's Secure placeholder code and reads as
  // a real class downstream.
  return { code: initials || "UNK", order: RACE_CLASSES.length };
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

/** A card plus whether its event tag matches (or doesn't contradict) the runs'. */
interface TechCand {
  tc: EdataTechCard;
  local: boolean;
}

export interface CategoryTechIndex {
  byCar: Map<string, TechCand>;
  byName: Map<string, TechCand>;
  /** "D WILKERSON" (first initial + last) — for abbreviated timing names. */
  byInitial: Map<string, TechCand | null>;
  /** The class code the tech cards agree on, when they agree on exactly one. */
  code: string | null;
}

/** classInfo for callers outside this module (AccuTime export, QDAT). */
export function classCodeForCategory(category: string): { code: string; order: number } {
  return classInfo(category, []);
}

/** Compulink C# per normalized category, for categories already in class order. */
function compulinkNumbers(
  categories: { category: string; code: string }[],
  presets?: Map<string, number>,
): Map<string, number> {
  const nums = assignCompulinkClassNumbers(
    categories.map((c) => ({ className: c.category, classCode: c.code, preset: presets?.get(norm(c.category)) })),
  );
  return new Map(categories.map((c, i) => [norm(c.category), nums[i]]));
}

/**
 * Category-scoped tech-card index for callers that match things other than
 * RunRows (the QDAT builder, the AccuTime PDFs). Same matching the EDAT
 * export uses: cards filtered to the class, current-event cards outranking
 * other-event ones.
 */
export function buildTechIndex(
  category: string,
  classCode: string,
  cards: EdataTechCard[],
  isLocal: (tc: EdataTechCard) => boolean,
): CategoryTechIndex {
  return indexTechCards(
    cards
      .filter((tc) => techCardMatchesCategory(tc, category, classCode))
      .map((tc) => ({ tc, local: isLocal(tc) })),
  );
}

/** Current-event cards outrank other-event ones; fuller records win ties. */
function bestCand(cands: TechCand[]): TechCand {
  const pool = cands.some((c) => c.local) ? cands.filter((c) => c.local) : cands;
  return pool.reduce((a, b) => (tcScore(b.tc) > tcScore(a.tc) ? b : a));
}

/**
 * Like bestCand, but for name-derived keys where two DIFFERENT people can
 * collide (father/son sharing an initial + last name): if the preferred pool
 * still holds more than one distinct name, match nobody rather than guess.
 */
function uniqueCand(cands: TechCand[]): TechCand | null {
  const pool = cands.some((c) => c.local) ? cands.filter((c) => c.local) : cands;
  const names = new Set(pool.map((c) => norm(`${c.tc.first_name || ""} ${c.tc.last_name || ""}`)));
  if (names.size > 1) return null;
  return pool.reduce((a, b) => (tcScore(b.tc) > tcScore(a.tc) ? b : a));
}

function indexTechCards(cands: TechCand[]): CategoryTechIndex {
  const carCands = new Map<string, TechCand[]>();
  const nameCands = new Map<string, TechCand[]>();
  const initialCands = new Map<string, TechCand[]>();
  const add = (map: Map<string, TechCand[]>, key: string, c: TechCand) => {
    const list = map.get(key);
    if (list) list.push(c);
    else map.set(key, [c]);
  };
  for (const c of cands) {
    const car = norm(c.tc.car_number);
    if (car) add(carCands, car, c);
    const name = norm(`${c.tc.first_name || ""} ${c.tc.last_name || ""}`);
    if (name) add(nameCands, name, c);
    const initialKey = initialLastKey(name);
    if (initialKey) add(initialCands, initialKey, c);
  }

  const byCar = new Map<string, TechCand>();
  for (const [k, list] of carCands) byCar.set(k, bestCand(list));
  const byName = new Map<string, TechCand>();
  for (const [k, list] of nameCands) byName.set(k, bestCand(list));
  const byInitial = new Map<string, TechCand | null>();
  for (const [k, list] of initialCands) byInitial.set(k, uniqueCand(list));

  // Class-code consensus, from current-event cards when there are any.
  const codePool = cands.some((c) => c.local) ? cands.filter((c) => c.local) : cands;
  const codes = new Set(
    codePool.map((c) => norm(c.tc.category)).filter((code) => /^[A-Z0-9]{1,6}$/.test(code)),
  );

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

/**
 * Whether a timing-side driver name could be this card's racer. True when
 * either side has no usable name; otherwise the first initial + last name must
 * agree (which also accepts the timing system's abbreviated "D. Wilkerson").
 */
function namesCompatible(name: string | null, tc: EdataTechCard): boolean {
  const runKey = initialLastKey(name);
  if (!runKey) return true;
  const tcKey = initialLastKey(`${tc.first_name || ""} ${tc.last_name || ""}`);
  return !tcKey || tcKey === runKey;
}

/**
 * Category is already scoped by the index; within it, car number is the
 * strongest join, exact name next, and the timing system's abbreviated
 * "D. Wilkerson" style last (only when it singles out one card). A card
 * tagged with a different event only joins by car number when the driver
 * name doesn't contradict it — car numbers get reused across events.
 */
export function findTechCard(
  carNumber: string | null,
  name: string | null,
  index: CategoryTechIndex,
): EdataTechCard | null {
  const byCar = index.byCar.get(norm(carNumber));
  if (byCar && (byCar.local || namesCompatible(name, byCar.tc))) return byCar.tc;
  const byName = index.byName.get(norm(name));
  if (byName) return byName.tc;
  const key = initialLastKey(name);
  const byInitial = key ? index.byInitial.get(key) : null;
  return byInitial ? byInitial.tc : null;
}

function techCardForRun(run: RunRow, index: CategoryTechIndex): EdataTechCard | null {
  return findTechCard(run.car_number, run.name, index);
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

interface LineContext {
  classCode: string;
  quarterMile: boolean;
  timing: TimingSystem;
  /** The class's qualifying-sheet positions by car, for rows getresults left at 0. */
  positions?: Map<string, number>;
  /**
   * A Super class, whose sheet is the round-1 winners: a round-1 row's own Q
   * Pos comes from time trials getresults happened to code Q1, so round 1
   * prints the sheet position (0 for a round-1 loser); later rounds carry the
   * round-2 ladder itself.
   */
  sheetPositionsOnly?: boolean;
  /** The one dial-in the whole field runs (Super Comp 8.90), filled where a row shows none. */
  sharedIndex: number | null;
}

/** The racer's qualifying position: getresults' Q Pos, else their line on the class's qualifying sheet. */
function linePosition(run: RunRow, ctx: LineContext): number | null {
  const ownPos = run.qual_pos !== null && run.qual_pos !== undefined && run.qual_pos > 0;
  if (ownPos && !(ctx.sheetPositionsOnly && run.round === "E1")) return run.qual_pos;
  return ctx.positions?.get(norm(run.car_number)) ?? null;
}

function runLine(run: RunRow, tc: EdataTechCard | null, ctx: LineContext): string {
  const et = realEt(ctx.quarterMile ? run.ft1320 : run.ft660);
  const mph = realMph(ctx.quarterMile ? run.mph_1320 : run.mph_660);
  const dial = realDial(run.dial_in) ?? (run.dial_in === null || run.dial_in === undefined ? ctx.sharedIndex : null);
  const pos = linePosition(run, ctx);
  const portatree = ctx.timing === "portatree";
  let times: string[];
  if (portatree) {
    // A finished pass with no reaction time is Portatree's -0.500 (left before
    // the tree); nothing at all is 0.000 across the board.
    const finished = et !== null && et > 0 && et < 64;
    const rt = run.rt !== null && run.rt !== undefined ? truncFixed(run.rt, 3) : finished ? "-0.500" : "0.000";
    times = [rt, fmtDial(dial), truncFixed(et ?? 0, 3), truncFixed(mph ?? 0, 2)];
  } else {
    times = [fmtRt(run.rt), fmtDial(dial), fmtEt(et), fmtMph(mph)];
  }
  const fields = [
    csvSafe(run.car_number || ""),
    csvSafe(run.member_number || "") || (tc ? csvSafe(tc.member_number || "") : "") || "0",
    // A Portatree tower leaves the class blank where its entry has none.
    classDesignation(run) || (portatree ? "" : ctx.classCode),
    pos !== null ? String(pos) : portatree ? "" : "0",
    (tc ? fullName(tc) : "") || csvSafe(run.name || ""),
    tc ? cityState(tc) : "",
    tc ? bodyString(tc) : "",
    tc ? engineString(tc) : "",
    ...times,
  ];
  return fields.join(",");
}

function singleMarker(run: RunRow, tc: EdataTechCard | null, timing: TimingSystem): string {
  const member =
    csvSafe(run.member_number || "") || (tc ? csvSafe(tc.member_number || "") : "") || "0";
  return timing === "portatree" ? `SINGLE,${member},,,,,,,,,,` : `SINGLE,${member},,0,,,,,,,,`;
}

/** The single dial-in a class's whole field runs on (an index class like Super Comp), or null. */
function sharedFieldIndex(catRuns: RunRow[]): number | null {
  const dials = new Set<number>();
  let n = 0;
  for (const r of catRuns) {
    if (!isElimRound(r.round)) continue;
    const d = realDial(r.dial_in);
    if (d === null) continue;
    dials.add(Math.round(d * 100));
    n++;
  }
  return dials.size === 1 && n >= 4 ? [...dials][0] / 100 : null;
}

function tsMillis(ts: string | null | undefined): number {
  if (!ts) return 0;
  const d = parseTsToDate(ts);
  return d ? d.getTime() : 0;
}

// ——— Passes getresults moved to another round ———

// A car can't make two passes this close together (db.ts's same-pass window).
const RELABEL_WINDOW_MS = 10_000;

function sameReading(a: number | null | undefined, b: number | null | undefined, tol: number): boolean | null {
  const ha = a !== null && a !== undefined && a !== 0;
  const hb = b !== null && b !== undefined && b !== 0;
  if (!ha && !hb) return null;
  if (ha !== hb) return false;
  return Math.abs((a as number) - (b as number)) <= tol;
}

/** The same recorded pass: every reading either copy has, the other has too, and they agree. */
function sameRecordedPass(a: RunRow, b: RunRow): boolean {
  let agreed = 0;
  for (const same of [
    sameReading(a.rt, b.rt, 0.0015),
    sameReading(a.ft60, b.ft60, 0.0015),
    sameReading(finishEt(a), finishEt(b), 0.0015),
    sameReading(finishMph(a), finishMph(b), 0.015),
  ]) {
    if (same === false) return false;
    if (same) agreed++;
  }
  return agreed > 0;
}

/** Which copy of a relabeled pass is current: a manual fix, else the latest write. */
function copyRank(r: RunRow): [number, string] {
  return [(r._edited ? 2 : 0) + (r.manual_entry ? 1 : 0), r.created_at || ""];
}

export interface SupersededCopy {
  run: RunRow;
  /** The copy that replaced it, under the round getresults shows now. */
  by: RunRow;
}

/**
 * getresults moves passes between rounds after showing them — at MI1 2026 two
 * Factory Stock Showdown Q2 pairs first appeared as E1, and GM1's Q1 started
 * life as T1 — and the store keeps both copies, because the round is part of a
 * row's identity. A copy is the same car in the same class, a few seconds
 * apart under another round, with the same times; the latest write is the
 * tower's correction, so every older copy is superseded. Copies whose times
 * differ are separate passes — getresults has stamped two real passes with
 * one clock time (RN1 2026 Super Gas) — and both stay.
 */
export function findSupersededCopies(runs: RunRow[]): {
  runs: RunRow[];
  superseded: SupersededCopy[];
} {
  const byCar = new Map<string, { run: RunRow; t: number }[]>();
  for (const run of runs) {
    const car = norm(run.car_number);
    const t = tsMillis(run.timestamp);
    if (!car || car === "BYE" || !t || !run.round) continue;
    const key = `${car}|${norm(run.category)}`;
    const list = byCar.get(key);
    if (list) list.push({ run, t });
    else byCar.set(key, [{ run, t }]);
  }

  const superseded = new Map<RunRow, RunRow>();
  for (const list of byCar.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.t - b.t);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length && list[j].t - list[i].t <= RELABEL_WINDOW_MS; j++) {
        const a = list[i].run;
        const b = list[j].run;
        if (norm(a.round) === norm(b.round) || !sameRecordedPass(a, b)) continue;
        const [ra, ca] = copyRank(a);
        const [rb, cb] = copyRank(b);
        const aWins = ra !== rb ? ra > rb : ca > cb;
        const bWins = ra !== rb ? rb > ra : cb > ca;
        if (aWins) superseded.set(b, a);
        else if (bWins) superseded.set(a, b);
      }
    }
  }
  if (superseded.size === 0) return { runs, superseded: [] };

  // Point every stale copy at the copy that survives (a pass moved twice).
  const current = (r: RunRow): RunRow => {
    let c = r;
    for (let hops = 0; superseded.has(c) && hops < 10; hops++) c = superseded.get(c)!;
    return c;
  };
  return {
    runs: runs.filter((r) => !superseded.has(r)),
    superseded: [...superseded.keys()].map((run) => ({ run, by: current(run) })),
  };
}

function carList(cars: string[]): string {
  const shown = cars.slice(0, 8).join(", ");
  return cars.length > 8 ? `${shown} and ${cars.length - 8} more` : shown;
}

/**
 * "FACTORY STOCK SHOWDOWN: getresults moved 4 runs from E1 to Q2 (cars 402,
 * 3397, B346, 3279) — the old E1 copies are left out of the EDAT." One line
 * per class and move.
 */
function supersededWarnings(copies: SupersededCopy[], file: "EDAT" | "QDAT"): string[] {
  const byMove = new Map<string, { category: string; from: string; to: string; cars: string[] }>();
  for (const { run, by } of copies) {
    const category = (run.category || "").trim();
    const from = norm(run.round);
    const to = norm(by.round);
    const key = `${norm(category)}|${from}|${to}`;
    const move = byMove.get(key) || { category, from, to, cars: [] };
    move.cars.push((run.car_number || "").trim());
    byMove.set(key, move);
  }
  return [...byMove.values()].map(({ category, from, to, cars }) => {
    const one = cars.length === 1;
    return `${category}: getresults moved ${cars.length} run${one ? "" : "s"} from ${from} to ${to} (car${
      one ? "" : "s"
    } ${carList(cars)}) — the old ${from} cop${one ? "y is" : "ies are"} left out of the ${file}.`;
  });
}

/** A car can race once per elimination round; a second pairing means the round on file is wrong somewhere. */
function repeatedCarWarnings(category: string, rounds: ElimRound[]): string[] {
  const out: string[] = [];
  for (const rd of rounds) {
    const pairsByCar = new Map<string, number>();
    for (const pair of rd.pairs) {
      for (const car of new Set(pair.runs.map((r) => norm(r.car_number)))) {
        if (car && car !== "BYE") pairsByCar.set(car, (pairsByCar.get(car) || 0) + 1);
      }
    }
    const repeated = [...pairsByCar.entries()].filter(([, n]) => n > 1).map(([car]) => car);
    if (repeated.length) {
      const one = repeated.length === 1;
      out.push(
        `${category} ${rd.label}: car${one ? "" : "s"} ${carList(repeated)} ${
          one ? "is" : "are"
        } in more than one pairing — check the round before printing.`,
      );
    }
  }
  return out;
}

/**
 * Every stored card is usable — the /tech-cards page and the backfill tag
 * cards with their own source's event naming, which rarely equals the
 * getresults string, so an exact-match filter would throw away cards that
 * were imported precisely for this event. Cards whose tag matches (or is
 * blank) are "local" and outrank the rest; other-event cards fill gaps under
 * the name-compatibility guard in findTechCard.
 */
export function localCardTest(runs: RunRow[]): (tc: EdataTechCard) => boolean {
  const eventNames = new Set(runs.map((r) => norm(r.event_name)).filter(Boolean));
  return (tc) => {
    const tag = norm(tc.event_name);
    return !tag || eventNames.size === 0 || eventNames.has(tag);
  };
}

/**
 * Whether a class's finish line is the quarter or the eighth, by majority: an
 * eighth-mile class can carry a stray 1320 reading or two (a junk 0 or 29.463
 * on getresults), and one of those must not blank every ET in the class.
 */
export function isQuarterMileClass(catRuns: RunRow[]): boolean {
  let quarter = 0;
  let eighth = 0;
  for (const r of catRuns) {
    if (r.ft1320 !== null && r.ft1320 !== undefined && r.ft1320 > 0) quarter++;
    else if (r.ft660 !== null && r.ft660 !== undefined && r.ft660 > 0) eighth++;
  }
  return quarter >= eighth;
}

/**
 * The empty lane beside a bye — a blank car at Compulink events, a literal
 * `BYE` car at Portatree ones — whatever junk text rides in its name field.
 */
function isEmptyLane(run: RunRow): boolean {
  const car = norm(run.car_number);
  return !car || car === "BYE";
}

export interface ElimPair {
  /** Winner first; lane order when no winner is marked. */
  runs: RunRow[];
  /** A bye — one racer, written with a SINGLE marker. */
  single: boolean;
}

export interface ElimRound {
  /** App round code: E1, E2, …, F. */
  round: string;
  /** Compulink heading: ROUND 1, …, FINALS. */
  label: string;
  /** The final: coded F, or the last round on file with one pairing after a two-pairing round. */
  isFinal: boolean;
  pairs: ElimPair[];
}

/**
 * One category's elimination rounds as pairings, in run order — the shared
 * shape behind the EDAT text and the Final Round Results PDF. Pairs come from
 * the timestamp grouping; a timing-system reset (same car twice in one pair)
 * keeps the row with the most recorded data. Rows within a pair are winner
 * first, CompuLink's own ordering; the lane only orders a pair with no
 * winner marked. Pass the class's qualifying rows too: an elimination row
 * that getresults has since moved to a qualifying round is left out
 * (findSupersededCopies).
 *
 * getresults never codes a final `F` — a 16-car pro field ends at E4, a
 * 32-car sportsman field at E5 — so the final is recognised by shape: the
 * last round on file has exactly one pairing, and the cars that won through
 * the round before it are the two finalists (or that round had two pairings,
 * or a two-car class raced only the final). A lone pairing that the earlier
 * winners don't fill (a round still running) stays a numbered round rather
 * than being called the final early.
 */
export function elimRoundsForCategory(
  catRuns: RunRow[],
  category: string,
  warnings: string[] = [],
  opts: { timing?: TimingSystem } = {},
): ElimRound[] {
  const elimRuns = collapseCopiedPasses(
    findSupersededCopies(catRuns).runs.filter((r) => isElimRound(r.round) && !isEmptyLane(r)),
    category,
    warnings,
  );
  const roundCodes = [...new Set(elimRuns.map((r) => r.round as string))].sort(
    (a, b) => roundOrder(a) - roundOrder(b),
  );

  const rounds = roundCodes.map((round) => {
    const roundRuns = elimRuns.filter((r) => r.round === round);
    const groups = [...groupRunsByTimestamp(roundRuns).entries()].sort(
      (a, b) => tsMillis(a[0]) - tsMillis(b[0]),
    );

    const pairs: ElimPair[] = [];
    for (const [, groupRuns] of groups) {
      const byCar = new Map<string, RunRow>();
      for (const r of groupRuns) {
        const key = norm(r.car_number);
        const existing = byCar.get(key);
        if (!existing || dataScore(r) > dataScore(existing)) byCar.set(key, r);
      }
      const pairRuns = [...byCar.values()];

      pairRuns.sort((a, b) => {
        const won = (isRunWinner(b) ? 1 : 0) - (isRunWinner(a) ? 1 : 0);
        if (won !== 0) return won;
        const la = laneOrder(a.lane);
        const lb = laneOrder(b.lane);
        return la !== null && lb !== null ? la - lb : 0;
      });

      if (pairRuns.length > 2) {
        warnings.push(
          `${category} ${round}: ${pairRuns.length} cars share one pairing (4-wide?) — written as consecutive lines.`,
        );
      }

      pairs.push({ runs: pairRuns, single: pairRuns.length === 1 });
    }

    return { round, label: roundLabel(round), isFinal: round === "F", pairs };
  });

  const last = rounds[rounds.length - 1];
  if (last && !last.isFinal && isFinalShape(rounds, new Set(catRuns.filter((r) => !isEmptyLane(r)).map((r) => norm(r.car_number))).size)) {
    last.isFinal = true;
    last.label = "FINALS";
  }
  // Portatree heads every round, the final included, "ROUND n".
  if (opts.timing === "portatree") {
    let n = 0;
    for (const rd of rounds) {
      const m = rd.round.match(/^E(\d+)$/);
      n = m ? parseInt(m[1], 10) : n + 1;
      rd.label = `ROUND ${n}`;
    }
  }

  return rounds;
}

function isFinalShape(rounds: ElimRound[], fieldSize: number): boolean {
  const last = rounds[rounds.length - 1];
  if (!last || last.pairs.length !== 1 || last.pairs[0].runs.length !== 2) return false;
  const prev = rounds[rounds.length - 2];
  if (!prev) return fieldSize <= 2;
  if (prev.pairs.length === 2) return true;
  const finalists = new Set(last.pairs[0].runs.map((r) => norm(r.car_number)));
  const advanced = prev.pairs.flatMap((p) => p.runs.filter(isRunWinner).map((r) => norm(r.car_number)));
  return advanced.length > 0 && advanced.length <= 2 && advanced.every((c) => finalists.has(c));
}

/**
 * The same recorded pass stored twice in one round under two clock times —
 * the second copy stamped onto another pairing's time, so that pairing reads
 * as four cars (LO1-7 2026 Super Comp round 3) — or an empty copy of a car
 * that already has its row in the round (LO4-1 2026 Stock round 3, where the
 * stray copy clusters with the next pair and shifts every pairing after it).
 * A car races once a round: the fuller row stays, then the one in the less
 * crowded pairing, then the earlier time.
 */
function collapseCopiedPasses(elimRuns: RunRow[], category: string, warnings: string[]): RunRow[] {
  const drop = new Set<RunRow>();
  const byRound = new Map<string, RunRow[]>();
  for (const r of elimRuns) {
    const list = byRound.get(r.round as string);
    if (list) list.push(r);
    else byRound.set(r.round as string, [r]);
  }
  for (const [round, roundRuns] of byRound) {
    const groups = groupRunsByTimestamp(roundRuns);
    const groupOf = new Map<RunRow, RunRow[]>();
    for (const g of groups.values()) for (const r of g) groupOf.set(r, g);
    const byCar = new Map<string, RunRow[]>();
    for (const r of roundRuns) {
      const key = norm(r.car_number);
      const list = byCar.get(key);
      if (list) list.push(r);
      else byCar.set(key, [r]);
    }
    for (const [car, copies] of byCar) {
      if (copies.length < 2) continue;
      for (let i = 0; i < copies.length; i++) {
        for (let j = i + 1; j < copies.length; j++) {
          const a = copies[i];
          const b = copies[j];
          if (drop.has(a) || drop.has(b) || groupOf.get(a) === groupOf.get(b)) continue;
          const da = dataScore(a);
          const db = dataScore(b);
          if (!sameRecordedPass(a, b) && da > 0 && db > 0) continue;
          const sa = new Set(groupOf.get(a)!.map((r) => norm(r.car_number))).size;
          const sb = new Set(groupOf.get(b)!.map((r) => norm(r.car_number))).size;
          const loser =
            da !== db ? (da < db ? a : b) : sa !== sb ? (sa > sb ? a : b) : tsMillis(a.timestamp) > tsMillis(b.timestamp) ? a : b;
          drop.add(loser);
          warnings.push(
            `${category} ${round}: car ${car} is stored twice with the same times (${a.timestamp} and ${b.timestamp}) — the copy at ${loser.timestamp} is left out.`,
          );
        }
      }
    }
  }
  return drop.size ? elimRuns.filter((r) => !drop.has(r)) : elimRuns;
}

/**
 * Build one EDAT file per category from the given runs, merging entry-record
 * fields (member number, full name, city, body, engine) in from the tech
 * cards. Only elimination rounds are written, but pass the event's other runs
 * too: that's how an elimination row getresults has since moved to a
 * qualifying round is recognised and left out (findSupersededCopies). Tech
 * cards for other events are filtered out by event_name.
 */
export function buildEdataExport(
  runs: RunRow[],
  techCards: EdataTechCard[] = [],
  opts: DataOutExportOptions = {},
): EdataExportResult {
  const warnings: string[] = [];
  const { runs: current, superseded } = findSupersededCopies(runs);
  warnings.push(...supersededWarnings(superseded.filter((c) => isElimRound(c.run.round)), "EDAT"));

  const byCategory = new Map<string, RunRow[]>();
  for (const run of current) {
    if (!isElimRound(run.round)) continue;
    const cat = (run.category || "").trim();
    if (!cat) continue;
    const list = byCategory.get(cat);
    if (list) list.push(run);
    else byCategory.set(cat, [run]);
  }

  const isLocal = localCardTest(runs);

  // Known classes in RACE_CLASSES order (pros first), anything else
  // alphabetically after them.
  const categories = [...byCategory.entries()]
    .map(([category, catRuns]) => ({ category, catRuns, ...classInfo(category, catRuns) }))
    .sort((a, b) => a.order - b.order || a.category.localeCompare(b.category));
  const ownNumbers = compulinkNumbers(categories);

  const files: EdataExportFile[] = [];

  categories.forEach(({ category, catRuns, code: fallbackCode }) => {
    const techIndex = indexTechCards(
      techCards
        .filter((tc) => techCardMatchesCategory(tc, category, fallbackCode))
        .map((tc) => ({ tc, local: isLocal(tc) })),
    );
    // The entry system's own abbreviation beats our name-table guess.
    const code = techIndex.code || fallbackCode;

    const timing = opts.timing || "compulink";
    const quarterMile = isQuarterMileClass(catRuns);
    const supplied = opts.rounds?.get(norm(category));
    const rounds = supplied?.length ? supplied : elimRoundsForCategory(catRuns, category, warnings, { timing });
    warnings.push(...repeatedCarWarnings(category, rounds));
    const positions = opts.qualPositions?.get(norm(category));
    const ctx: LineContext = {
      classCode: code,
      quarterMile,
      timing,
      positions,
      sheetPositionsOnly: !!positions && qualStyleFor(category, code) === "super",
      sharedIndex: sharedFieldIndex(catRuns),
    };

    const lines: string[] = [`${timingHeader(timing)} ${category.toUpperCase()} Elimination Results`];
    let pairs = 0;
    let runCount = 0;
    let enriched = 0;
    const noRt: string[] = [];

    for (const rd of rounds) {
      lines.push(rd.label);
      for (const pair of rd.pairs) {
        for (const r of pair.runs) {
          const tc = techCardForRun(r, techIndex);
          if (tc) enriched++;
          lines.push(runLine(r, tc, ctx));
          // A completed pass always has a reaction time; a blank one is a
          // hole in the stored row (or on getresults) and prints as a blank
          // on the sheet, so it's called out here rather than found in print.
          const finished = (quarterMile ? r.ft1320 : r.ft660) != null;
          if (finished && (r.rt === null || r.rt === undefined)) {
            noRt.push(`${rd.label.toLowerCase()} #${(r.car_number || "").trim() || "?"}${r.name ? ` ${r.name}` : ""}`);
          }
        }
        if (pair.single) {
          lines.push(singleMarker(pair.runs[0], techCardForRun(pair.runs[0], techIndex), timing));
        }
        pairs++;
        runCount += pair.runs.length;
      }
    }

    lines.push("End of File");

    if (noRt.length) {
      const fix =
        opts.missingRtFix || "the RT is missing from the stored row. Check it on getresults and fix the row before printing.";
      warnings.push(`${category}: no reaction time on file for ${noRt.join(", ")} — the pass has an ET, so ${fix}`);
    }

    files.push({
      filename: `C${opts.classNumbers?.get(norm(category)) ?? ownNumbers.get(norm(category))}EDAT.TXT`,
      category,
      classCode: code,
      rounds: rounds.map((r) => r.round),
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

// ——— QDAT: the qualifying sibling of EDAT ———

/**
 * One qualifier for a C##QDAT.TXT file, already enriched. Thirteen fields:
 *
 *   1308,342370,E/SA,'69 Camaro,1969,CHEV  396,350,330,Ralph Porpora,New Windsor NY,10.589,11.70,-1.111
 *
 * car, member, class/index designation, body, body year, engine, HP, factored
 * HP, driver, city+state, then three columns that depend on how the class
 * qualifies (QualStyle): best ET, index, ET-minus-index for an index class;
 * best ET, that pass's MPH and the best MPH for a heads-up class; the best
 * reaction time, a blank index and the reaction time again for a class that
 * qualifies on the tree.
 */
export interface QdatEntry {
  car: string;
  member: string;
  classOrIndex: string;
  body: string;
  bodyYear: string;
  engine: string;
  hp: string;
  factoredHp: string;
  name: string;
  cityState: string;
  et: number | null;
  index: number | null;
  /** Best MPH over the racer's qualifying passes. */
  mph: number | null;
  /** MPH of the pass the line prints (heads-up classes print it beside the best MPH). */
  passMph?: number | null;
  /** Reaction time of the pass the line prints (classes that qualify on the tree). */
  rt?: number | null;
}

/**
 * How a class's qualifying sheet is laid out and ranked:
 *   - index: furthest under the car's index (Stock, Super Stock, Comp);
 *   - super: Super Comp / Gas / Street — the round-1 winners' passes, closest
 *     over the index, which is the round-2 ladder (no Low ET line);
 *   - headsup: quickest ET (pros, alcohol, Top Dragster / Sportsman);
 *   - rt: best reaction time (juniors, Sportsman Motorcycle).
 */
export type QualStyle = "index" | "super" | "headsup" | "rt";

export interface QdatFileOptions {
  timing?: TimingSystem;
  /** Defaults to index when the entries carry an index, heads-up otherwise. */
  style?: QualStyle;
  /** Portatree only: a class its tower doesn't fully know prints 0,0 in the heads-up columns. */
  zeroColumns?: boolean;
}

/**
 * A Portatree tower subtracts the index from its own 4-decimal ET and cuts the
 * result to three decimals. getresults mostly carries the ET already cut, so
 * the dropped half-thousandth can't be recovered: the cut ET's difference is
 * the nearer guess (the tower's readings step by 0.0005, and the dropped digit
 * is a 0 a little more often than a 5).
 */
function portatreeDiff(et: number, index: number): string {
  return truncTowardZero(Math.round((et - index) * 1e6) / 1e6, 3);
}

/** "0.019", "-0.009" — a reaction time with its leading zero, as the qualifying sheet prints it. */
function fmtQualRt(rt: number): string {
  return (rt < 0 && Math.abs(rt) >= 0.0005 ? "-" : "") + Math.abs(rt).toFixed(3);
}

export function buildQdatFile(
  category: string,
  entries: QdatEntry[],
  lowEt: { et: number; car: string; name: string } | null,
  topSpeed: { mph: number; car: string; name: string } | null,
  opts: QdatFileOptions = {},
): string {
  const timing = opts.timing || "compulink";
  const portatree = timing === "portatree";
  const style: QualStyle = opts.style || (entries.some((e) => e.index !== null) ? "index" : "headsup");
  const fmtTime = (v: number) => (portatree ? truncFixed(v, 3) : v.toFixed(3));
  const headCar = (car: string) => (portatree ? csvSafe(car).padStart(5) : csvSafe(car));
  const lines: string[] = [`${timingHeader(timing)} ${category.toUpperCase()} Qualifying for ${entries.length} entries`];
  if (lowEt && style !== "super") {
    const v = style === "rt" && !portatree ? fmtQualRt(lowEt.et) : lowEt.et.toFixed(3);
    lines.push(`Low ET ${v} ${headCar(lowEt.car)} ${csvSafe(lowEt.name)}`);
  }
  if (topSpeed) lines.push(`Top Speed ${topSpeed.mph.toFixed(2)} ${headCar(topSpeed.car)} ${csvSafe(topSpeed.name)}`);

  for (const e of entries) {
    let tail: string[];
    if (style === "rt" && !portatree) {
      const rt = e.rt ?? null;
      tail = rt !== null ? [fmtQualRt(rt), "    ", fmtQualRt(rt)] : ["", "    ", ""];
    } else if (style === "index" || style === "super") {
      const et = e.et !== null ? fmtTime(e.et) : "";
      const diff = e.et !== null && e.index !== null ? (portatree ? portatreeDiff(e.et, e.index) : (e.et - e.index).toFixed(3)) : "";
      tail = [style === "super" && !portatree ? et.padStart(6) : et, e.index !== null ? e.index.toFixed(2) : "", diff];
    } else if (portatree) {
      const et = e.et !== null ? fmtTime(e.et) : "";
      const passMph = e.passMph ?? e.mph;
      if (opts.zeroColumns) tail = [et, "0", "0"];
      else if (style === "rt") tail = [et, passMph !== null ? passMph.toFixed(2) : "", e.rt != null ? truncFixed(e.rt, 3) : ""];
      else tail = [et, passMph !== null ? passMph.toFixed(2) : "", et];
    } else {
      const passMph = e.passMph ?? e.mph;
      tail = [
        e.et !== null ? e.et.toFixed(3) : "",
        passMph !== null ? passMph.toFixed(2) : "",
        e.mph !== null ? e.mph.toFixed(2) : "",
      ];
    }
    lines.push(
      [
        csvSafe(e.car),
        csvSafe(e.member) || "0",
        csvSafe(e.classOrIndex),
        csvSafe(e.body),
        csvSafe(e.bodyYear),
        // "CHEV  665" keeps its two spaces, as the golden files (and EDAT) print it.
        e.engine.replace(/,/g, " ").trim(),
        csvSafe(e.hp) || (portatree ? "0" : ""),
        csvSafe(e.factoredHp) || (portatree ? "0" : ""),
        csvSafe(e.name),
        csvSafe(e.cityState),
        ...tail,
      ].join(","),
    );
  }

  lines.push("End of File");
  return lines.join(EOL) + EOL;
}

// ——— QDAT from stored runs: qualifying order off getresults ———

/**
 * The qualifying file built from the app's own stored runs, the way
 * buildEdataExport builds EDAT. The sheet's ORDER is the racer's qualifying
 * position as getresults shows it: every grid row carries a "Q Pos" column
 * (`qual_pos`), and the one on a racer's most recent pass — the elimination
 * rows carry the final ladder position — is the number the timing system
 * settled on. A racer with no position on any pass is written after the
 * ladder, ranked by the class rule, and said so.
 *
 * What the sheet holds depends on how the class qualifies (qualStyleFor —
 * the class decides, not the dial-in column, which getresults fills in on
 * Top Dragster qualifying passes too):
 *
 *   - Stock, Super Stock, Comp: furthest under the car's index, over the Q
 *     sessions plus the QC and C (class elimination) rounds the tower counts;
 *     a pass getresults shows without a dial-in is measured against the
 *     car's index from its other qualifying passes;
 *   - Super Comp / Gas / Street don't qualify: the tower's sheet is the
 *     round-1 winners ranked closest over the index, which ladders round 2;
 *   - pros, alcohol, Top Dragster / Sportsman and other heads-up classes:
 *     quickest ET, with that pass's MPH and the best MPH beside it;
 *   - juniors and Sportsman Motorcycle: best reaction time, printed in the
 *     ET column.
 *
 * The event's own qualifying setup (qualifying_config) still overrides the
 * rule for any class but the Super classes.
 */

export interface QdatExportFile {
  /** C1QDAT.TXT, C2QDAT.TXT, … — the same class number as the class's EDAT. */
  filename: string;
  category: string;
  classCode: string;
  /** Qualifying rounds present (Q1, Q2, …), in run order. */
  rounds: string[];
  /** Qualifiers written. */
  entries: number;
  /** Entries placed by a getresults qualifying position; the rest follow, ranked by the class rule. */
  positioned: number;
  /** The rule the class ranks by — the event's qualifying setup, else the class's own. */
  rule: QualRule;
  /** How the sheet is laid out (which columns, which passes). */
  style: QualStyle;
  /** True when getresults placed nobody, so the whole order was computed by the rule from the passes. */
  computedOrder: boolean;
  /** How many of the qualifiers found a tech card to fill the entry fields. */
  enriched: number;
  content: string;
  /** The written entries, in sheet order — the qualifying PDF is drawn from these. */
  qualifiers: QdatEntry[];
  /**
   * Each qualifier's qualifying position, parallel to `qualifiers`: the
   * tower's own number where an elimination row carries it, else the line.
   */
  positions: number[];
  lowEt: { et: number; car: string; name: string } | null;
  topSpeed: { mph: number; car: string; name: string } | null;
  /** Whether the class qualifies against an index (Index / Ov-Un columns on the sheet). */
  hasIndex: boolean;
}

export interface QdatExportResult {
  files: QdatExportFile[];
  warnings: string[];
}

interface QualifierAgg {
  car: string;
  /** Most recent pass — its name / class designation / member number are the current ones. */
  latest: RunRow;
  /** The passes the sheet ranks: qualifying rounds, or the round-1 pass for a Super class. */
  qualPasses: RunRow[];
  /** The Q Pos on the racer's most recent pass that carries one. */
  lastPos: number | null;
  lastPosTs: number;
  lastPosSeq: number;
  /** The Q Pos on the racer's most recent elimination pass — the tower's final ladder number. */
  elimPos: number | null;
}

interface SheetRow {
  entry: QdatEntry;
  pos: number | null;
  key: [number, number];
  runOrder: number;
  order: number;
}

/**
 * The sheet order once eliminations are on file. The elimination rows carry
 * the tower's own qualifying rank, so those racers are pinned to it; every
 * other qualifier (a non-qualifier, a racer who never came back) is ranked by
 * the class rule into the gaps the pinned numbers leave, but only where its
 * pass fits between its neighbours. One whose pass would beat a pinned racer
 * the tower ranked ahead of it wasn't counted there (a DQ getresults never
 * shows) and goes to the bottom, as the tower lists its DQs.
 */
function pinnedSheetOrder(rows: SheetRow[], byRule: (a: SheetRow, b: SheetRow) => number): SheetRow[] {
  const pinned = new Map<number, SheetRow>();
  const free: SheetRow[] = [];
  for (const r of [...rows].sort((a, b) => (a.pos ?? WORST) - (b.pos ?? WORST) || byRule(a, b))) {
    if (r.pos !== null && !pinned.has(r.pos)) pinned.set(r.pos, r);
    else free.push(r);
  }
  free.sort(byRule);
  const placed = new Set<SheetRow>();
  const out: SheetRow[] = [];
  const last = Math.max(0, ...pinned.keys());
  let prev: SheetRow | null = null;
  for (let p = 1; p <= last; p++) {
    const at = pinned.get(p);
    if (at) {
      out.push(at);
      prev = at;
      continue;
    }
    let next: SheetRow | null = null;
    for (let q = p + 1; q <= last && !next; q++) next = pinned.get(q) || null;
    const fit = free.find(
      (f) => !placed.has(f) && (!prev || compareKeys(f.key, prev.key) >= 0) && (!next || compareKeys(f.key, next.key) <= 0),
    );
    if (fit) {
      placed.add(fit);
      out.push(fit);
      prev = fit;
    }
  }
  const tail = free.filter((f) => !placed.has(f));
  const after = tail.filter((f) => !prev || compareKeys(f.key, prev.key) >= 0);
  const contradicted = tail.filter((f) => prev && compareKeys(f.key, prev.key) < 0);
  return [...out, ...after, ...contradicted];
}

function qualRoundOrder(round: string): number {
  const r = round.trim().toUpperCase();
  const m = r.match(/^Q(\d*)$/);
  if (m) return m[1] ? parseInt(m[1], 10) : 0;
  if (r === "QC") return 50;
  const c = r.match(/^C(\d+)$/);
  if (c) return 100 + parseInt(c[1], 10);
  const e = r.match(/^E(\d+)$/);
  return e ? 200 + parseInt(e[1], 10) : 999;
}

/**
 * A qualifying ET: a real finish, not a no-time stand-in (getresults' 99.999,
 * Portatree's 64.999). The class's own finish line, as the EDAT reads it — an
 * eighth-mile pass can carry a stray 1320 reading (BM1 2026 Outlaw Street).
 */
function passEt(run: RunRow, quarterMile: boolean): number | null {
  const et = quarterMile ? run.ft1320 : run.ft660;
  return et !== null && et !== undefined && et > 0 && et < 64.99 ? et : null;
}

function passMph(run: RunRow, quarterMile: boolean): number | null {
  const mph = realMph(quarterMile ? run.mph_1320 : run.mph_660);
  return mph !== null && mph > 0 ? mph : null;
}

function passIndex(run: RunRow): number | null {
  return realDial(run.dial_in);
}

/**
 * How a class ranks its qualifying passes:
 *   - lowest: quickest ET (heads-up);
 *   - closest_over: closest to the index without going under — breakouts
 *     rank after every clean pass (Super Comp / Gas / Street);
 *   - closest_any: closest to the index either side (breakout OK);
 *   - furthest_under: most under the class index (Stock, Super Stock, Comp);
 *   - best_rt: quickest reaction time.
 */
export type QualRule = "lowest" | "closest_over" | "closest_any" | "furthest_under" | "best_rt";

export const QUAL_RULE_LABEL: Record<QualRule, string> = {
  lowest: "quickest ET",
  closest_over: "closest to index, no breakout",
  closest_any: "closest to index, breakout OK",
  furthest_under: "furthest under index",
  best_rt: "best reaction time",
};

/** The app's qualifying-mode ids (qualifying_config.classMode) mapped onto the sheet rules. */
export function qualRuleFromMode(mode: string | null | undefined): QualRule | null {
  switch ((mode || "").trim()) {
    case "quickest_et":
      return "lowest";
    case "closest_index_no_breakout":
      return "closest_over";
    case "closest_index_breakout_ok":
      return "closest_any";
    case "comp_eliminator":
    case "stock_super_stock":
      return "furthest_under";
    case "best_rt":
      return "best_rt";
    default:
      return null;
  }
}

const HEADS_UP_CODES = new Set(["TF", "FC", "PS", "PSM", "PM", "TAD", "TAFC", "TD", "TS", "FSS"]);

/**
 * How a class qualifies, from the class itself; null for a class the tables
 * don't know (its rule is then read off the dial-in column).
 */
export function qualStyleFor(category: string, code: string): QualStyle | null {
  const name = norm(category);
  const c = norm(code);
  if (/^SUPER (COMP|GAS|STREET)$/.test(name)) return "super";
  if (/^(COMP|COMPETITION) ELIMINATOR$|^SUPER STOCK$|^(JEGS )?STOCK( ELIM(INATOR)?)?$/.test(name)) return "index";
  if (/\bJRS?\b|JUNIOR|JDRL|SPORTSMAN MOTORCYCLE|^ET MOTORCYCLE$/.test(name)) return "rt";
  if (HEADS_UP_CODES.has(c)) return "headsup";
  if (
    /^(TOP (FUEL|DRAGSTER|SPORTSMAN|ALCOHOL (DRAGSTER|FUNNY CAR))|FUNNY CAR|PRO (STOCK|MOD)|PRO STOCK MOTORCYCLE|FACTORY STOCK SHOWDOWN)$/.test(
      name,
    )
  ) {
    return "headsup";
  }
  return null;
}

function ruleForStyle(style: QualStyle): QualRule {
  switch (style) {
    case "index":
      return "furthest_under";
    case "super":
      return "closest_over";
    case "rt":
      return "best_rt";
    default:
      return "lowest";
  }
}

function styleForRule(rule: QualRule, hasIndex: boolean): QualStyle {
  if (rule === "best_rt") return "rt";
  if (rule === "lowest") return "headsup";
  return hasIndex ? "index" : "headsup";
}

/**
 * A class the tables don't know: its rule off the dial-in column of its
 * qualifying passes. Only a field that runs an index on (nearly) every pass
 * qualifies against one — the national specials (Outlaw Street, the
 * snowmobiles) show a dial-in on some sessions and still qualify heads-up.
 */
function qualRuleFor(qualPasses: RunRow[]): QualRule {
  const timed = qualPasses.filter((p) => passEt(p, true) !== null || passEt(p, false) !== null);
  const dialed = timed.map(passIndex).filter((v): v is number => v !== null);
  if (dialed.length === 0 || dialed.length < timed.length * 0.9) return "lowest";
  return new Set(dialed).size === 1 ? "closest_over" : "furthest_under";
}

const WORST = Number.POSITIVE_INFINITY;

/**
 * Sort key for a pass under a rule — lower is better, compared element by
 * element. `index` is the index the pass is measured against (its own dial-in,
 * else the car's). A pass the rule can't judge (no index on an index rule, no
 * RT on best_rt) sorts after every pass it can, then by ET, so it still lands
 * somewhere sensible instead of vanishing.
 */
function qualSortKey(p: RunRow, rule: QualRule, quarterMile: boolean, index: number | null): [number, number] {
  // Thousandths, as the tower compares: 9.479 - 10.25 and 9.579 - 10.35 are
  // the same 0.771 under, and the pass run first ranks ahead (the caller's
  // run-order tiebreak). A heads-up tie goes to the higher MPH.
  const k = (v: number) => Math.round(v * 1000) / 1000;
  const et = passEt(p, quarterMile);
  if (rule === "best_rt") {
    const rt = p.rt !== null && p.rt !== undefined ? p.rt : null;
    if (rt === null) return [WORST, et ?? WORST];
    // A red light ranks after every green light, the least red first.
    return rt < 0 ? [100 + k(Math.abs(rt)), 0] : [k(rt), 0];
  }
  if (et === null) return [WORST, WORST];
  if (rule === "lowest") return [k(et), -(passMph(p, quarterMile) ?? 0)];
  if (index === null) return [WORST, et];
  const margin = k(et - index);
  if (rule === "furthest_under") return [margin, 0];
  if (rule === "closest_any") return [Math.abs(margin), 0];
  // closest_over: every clean pass before every breakout, the nearest first on each side.
  return margin >= 0 ? [margin, 0] : [1000 + Math.abs(margin), 0];
}

function compareKeys(a: [number, number], b: [number, number]): number {
  return a[0] - b[0] || a[1] - b[1];
}

function bestQualPass(passes: RunRow[], rule: QualRule, quarterMile: boolean, carIndex: number | null): RunRow | null {
  const judged = passes.filter((p) =>
    rule === "best_rt" ? p.rt !== null && p.rt !== undefined : passEt(p, quarterMile) !== null,
  );
  if (judged.length === 0) return null;
  const key = (p: RunRow) => qualSortKey(p, rule, quarterMile, passIndex(p) ?? carIndex);
  return judged.reduce((a, b) => (compareKeys(key(b), key(a)) < 0 ? b : a));
}

/** A class designation as the timing system prints it ("E/SA", "TF", "SC") — not a dial-in or a blank. */
function classDesignation(run: RunRow): string {
  const v = (run.class_index || "").trim();
  if (!v || /^[\d.]+$/.test(v)) return "";
  return v;
}

/** The car's index for the sheet: the latest dial-in on its qualifying passes. */
function carIndexFrom(passes: RunRow[]): number | null {
  for (let i = passes.length - 1; i >= 0; i--) {
    const d = passIndex(passes[i]);
    if (d !== null) return d;
  }
  return null;
}

/**
 * Build one QDAT file per category from the event's stored runs. Written for
 * every class with qualifying passes (Q sessions, QC, C rounds), and for the
 * Super classes once round 1 has a winner; a racer's position is the Q Pos on
 * their most recent pass of any round, so an event whose eliminations are on
 * file gets the final ladder order.
 */
export function buildQdatExport(
  runs: RunRow[],
  techCards: EdataTechCard[] = [],
  opts: DataOutExportOptions = {},
): QdatExportResult {
  const warnings: string[] = [];
  const timing = opts.timing || "compulink";
  const { runs: current, superseded } = findSupersededCopies(runs);
  warnings.push(...supersededWarnings(superseded.filter((c) => isQualRound(c.run.round)), "QDAT"));

  const byCategory = new Map<string, RunRow[]>();
  for (const run of current) {
    const cat = (run.category || "").trim();
    if (!cat || isEmptyLane(run)) continue;
    const list = byCategory.get(cat);
    if (list) list.push(run);
    else byCategory.set(cat, [run]);
  }

  const isLocal = localCardTest(runs);

  const categories = [...byCategory.entries()]
    .map(([category, catRuns]) => ({ category, catRuns, ...classInfo(category, catRuns) }))
    .map((c) => ({ ...c, classStyle: qualStyleFor(c.category, c.code) }))
    .filter(({ catRuns, classStyle }) =>
      classStyle === "super"
        ? catRuns.some((r) => r.round === "E1" && isRunWinner(r))
        : catRuns.some((r) => isQualRound(r.round)),
    )
    .sort((a, b) => a.order - b.order || a.category.localeCompare(b.category));
  const ownNumbers = compulinkNumbers(categories);

  const files: QdatExportFile[] = [];

  categories.forEach(({ category, catRuns, code: fallbackCode, classStyle }) => {
    const techIndex = indexTechCards(
      techCards
        .filter((tc) => techCardMatchesCategory(tc, category, fallbackCode))
        .map((tc) => ({ tc, local: isLocal(tc) })),
    );
    const code = techIndex.code || fallbackCode;
    const quarterMile = isQuarterMileClass(catRuns);
    const superClass = classStyle === "super";
    const counts = (r: RunRow) => (superClass ? r.round === "E1" && isRunWinner(r) : isQualRound(r.round));

    // One aggregate per racer — car number first, name for the rare bare row.
    const racers = new Map<string, QualifierAgg>();
    // Oldest first, so "latest" and "last position" fall out of a forward walk.
    const ordered = [...catRuns].sort(
      (a, b) =>
        tsMillis(a.timestamp) - tsMillis(b.timestamp) || (a._scrape_seq ?? 0) - (b._scrape_seq ?? 0),
    );
    ordered.forEach((run, seq) => {
      const key = norm(run.car_number) || (norm(run.name) ? `NAME:${norm(run.name)}` : "");
      if (!key) return;
      let agg = racers.get(key);
      if (!agg) {
        agg = {
          car: (run.car_number || "").trim(),
          latest: run,
          qualPasses: [],
          lastPos: null,
          lastPosTs: 0,
          lastPosSeq: -1,
          elimPos: null,
        };
        racers.set(key, agg);
      }
      agg.latest = run;
      if (counts(run)) agg.qualPasses.push(run);
      if (run.qual_pos !== null && run.qual_pos !== undefined && run.qual_pos > 0) {
        const ts = tsMillis(run.timestamp);
        if (ts > agg.lastPosTs || (ts === agg.lastPosTs && seq > agg.lastPosSeq)) {
          agg.lastPos = run.qual_pos;
          agg.lastPosTs = ts;
          agg.lastPosSeq = seq;
        }
        // A Super class's ladder starts at round 2 (its round-1 rows only carry
        // whatever getresults ranked time trials by).
        if (isElimRound(run.round) && !(superClass && run.round === "E1")) agg.elimPos = run.qual_pos;
      }
    });

    // Only racers who made a qualifying pass belong on the qualifying sheet —
    // an elimination-only car (an alternate, a stale roster row) does not, nor
    // a car number no row ever names or classes (a number the tower's entry
    // list doesn't hold, so its sheet doesn't either).
    const known = new Set(
      catRuns.filter((r) => (r.name || "").trim() || classDesignation(r)).map((r) => norm(r.car_number)),
    );
    const qualifiers = [...racers.values()].filter((a) => a.qualPasses.length > 0 && (!a.car || known.has(norm(a.car))));
    const allQualPasses = qualifiers.flatMap((a) => a.qualPasses);
    const elimLadder = qualifiers.some((a) => a.elimPos !== null);
    const hasIndex = allQualPasses.some((p) => passIndex(p) !== null);
    // A Portatree tower ranks its junior classes by ET and prints 0,0 beside it.
    const portatreeJunior = timing === "portatree" && classStyle === "rt" && !/MOTORCYCLE/.test(norm(category));
    const configured = superClass ? undefined : opts.qualRules?.[norm(category)];
    const rule: QualRule =
      configured || (portatreeJunior ? "lowest" : classStyle ? ruleForStyle(classStyle) : qualRuleFor(allQualPasses));
    const style: QualStyle = superClass
      ? "super"
      : configured || !classStyle || portatreeJunior
        ? styleForRule(rule, hasIndex)
        : classStyle;

    // An index belongs to the class designation (every B/SA car runs 11.25,
    // every SG car 9.90), so a car getresults shows no dial-in for takes its
    // designation's.
    const designationIndex = new Map<string, number>();
    if (style === "index" || style === "super") {
      const seen = new Map<string, Map<number, number>>();
      for (const p of allQualPasses) {
        const d = classDesignation(p);
        const i = passIndex(p);
        if (!d || i === null) continue;
        const counts = seen.get(d) || new Map<number, number>();
        counts.set(i, (counts.get(i) || 0) + 1);
        seen.set(d, counts);
      }
      for (const [d, counts] of seen) {
        designationIndex.set(d, [...counts.entries()].reduce((a, b) => (b[1] > a[1] ? b : a))[0]);
      }
    }

    let enriched = 0;
    const rows = qualifiers.map((agg, order) => {
      const tc = findTechCard(agg.car || null, agg.latest.name, techIndex);
      if (tc) enriched++;
      const carIndex = carIndexFrom(agg.qualPasses) ?? designationIndex.get(classDesignation(agg.latest)) ?? null;
      const best = bestQualPass(agg.qualPasses, rule, quarterMile, carIndex);
      const index = best ? (passIndex(best) ?? carIndex) : null;
      const key: [number, number] = best ? qualSortKey(best, rule, quarterMile, index) : [WORST, WORST];
      const mph = agg.qualPasses
        .map((p) => passMph(p, quarterMile))
        .reduce<number | null>((a, m) => (m !== null && (a === null || m > a) ? m : a), null);
      const entry: QdatEntry = {
        car: agg.car,
        member: csvSafe(agg.latest.member_number || "") || (tc ? csvSafe(tc.member_number || "") : ""),
        classOrIndex: classDesignation(agg.latest) || (tc ? tc.category || "" : "") || code,
        body: tc ? bodyString(tc) : "",
        bodyYear: bodyYearFull(tc),
        engine: tc ? engineString(tc) : "",
        hp: tc?.hp || "",
        factoredHp: tc?.factored_hp || "",
        name: (tc ? fullName(tc) : "") || csvSafe(agg.latest.name || ""),
        cityState: tc ? cityState(tc) : "",
        et: best ? passEt(best, quarterMile) : null,
        index: style === "index" || style === "super" ? index : null,
        mph,
        passMph: best ? passMph(best, quarterMile) : null,
        rt: best && best.rt !== null && best.rt !== undefined ? best.rt : null,
      };
      const runOrder = best ? tsMillis(best.timestamp) : WORST;
      const row: SheetRow = { entry, pos: elimLadder ? agg.elimPos : agg.lastPos, key, runOrder, order };
      return row;
    });

    // Once eliminations are on file their rows carry the tower's final ladder
    // (pinnedSheetOrder). Before that: the positions getresults shows on the
    // latest passes, then anyone it never placed — ranked by the class rule
    // from their own passes; when getresults placed nobody (the Q Pos column
    // never populated) that rule orders the whole sheet. Equal passes keep the
    // order they were run in, as the tower lists them.
    const byRule = (a: SheetRow, b: SheetRow) => compareKeys(a.key, b.key) || a.runOrder - b.runOrder || a.order - b.order;
    // A Q Pos column that repeats a position isn't a ladder (BM1 2026's pro
    // classes after Q4); before eliminations the class rule orders the sheet.
    const shownPos = rows.map((r) => r.pos).filter((p): p is number => p !== null);
    const brokenLadder = !elimLadder && new Set(shownPos).size < shownPos.length;
    if (elimLadder) {
      rows.splice(0, rows.length, ...pinnedSheetOrder(rows, byRule));
    } else if (brokenLadder) {
      rows.sort(byRule);
    } else {
      rows.sort((a, b) => {
        if (a.pos !== null && b.pos !== null && a.pos !== b.pos) return a.pos - b.pos;
        if (a.pos !== null && b.pos === null) return -1;
        if (a.pos === null && b.pos !== null) return 1;
        return byRule(a, b);
      });
    }

    const positioned = rows.filter((r) => r.pos !== null).length;
    const computedOrder = (positioned === 0 || brokenLadder) && rows.length > 0;
    if (brokenLadder) {
      warnings.push(
        `${category}: getresults repeats qualifying positions — the order is computed from the passes (${QUAL_RULE_LABEL[rule]}).`,
      );
    } else if (computedOrder && !superClass) {
      warnings.push(
        `${category}: getresults shows no qualifying positions — the order is computed from the passes (${QUAL_RULE_LABEL[rule]}).`,
      );
    } else if (!computedOrder && positioned < rows.length) {
      warnings.push(
        `${category}: ${rows.length - positioned} qualifier${rows.length - positioned === 1 ? "" : "s"} with no position on getresults — written after the ladder, ranked by ${QUAL_RULE_LABEL[rule]}.`,
      );
    }
    const posCounts = new Map<number, string[]>();
    for (const r of rows) {
      if (r.pos === null) continue;
      const list = posCounts.get(r.pos);
      if (list) list.push(r.entry.car || r.entry.name);
      else posCounts.set(r.pos, [r.entry.car || r.entry.name]);
    }
    for (const [pos, cars] of posCounts) {
      if (cars.length > 1) {
        warnings.push(`${category}: position ${pos} is shown for ${cars.join(" and ")} — check the ladder on getresults.`);
      }
    }

    // Low ET is the number one qualifier's line (its reaction time on a sheet
    // ranked by the tree); Top Speed the best MPH of any pass the sheet ranks.
    const sheet = rows.map((r) => r.entry);
    const first = sheet[0];
    const firstValue = first ? (style === "rt" ? first.rt ?? null : first.et) : null;
    const lowEt = first && firstValue !== null && firstValue !== undefined ? { et: firstValue, car: first.car, name: first.name } : null;
    let topSpeed: { mph: number; car: string; name: string } | null = null;
    for (const agg of qualifiers) {
      const row = sheet.find((e) => e.car === agg.car && e.name);
      const name = row?.name || csvSafe(agg.latest.name || "");
      for (const p of agg.qualPasses) {
        const mph = passMph(p, quarterMile);
        if (mph !== null && (!topSpeed || mph > topSpeed.mph)) topSpeed = { mph, car: agg.car, name };
      }
    }

    const roundCodes = [...new Set(allQualPasses.map((r) => (r.round || "").trim()))].sort(
      (a, b) => qualRoundOrder(a) - qualRoundOrder(b),
    );

    files.push({
      filename: `C${opts.classNumbers?.get(norm(category)) ?? ownNumbers.get(norm(category))}QDAT.TXT`,
      category,
      classCode: code,
      rounds: roundCodes,
      entries: rows.length,
      positioned,
      rule,
      style,
      computedOrder,
      enriched,
      content: buildQdatFile(category, sheet, lowEt, topSpeed, {
        timing,
        style,
        zeroColumns: timing === "portatree" && style === "headsup" && (portatreeJunior || !qualStyleFor(category, code)),
      }),
      qualifiers: sheet,
      positions: rows.map((r, i) => (elimLadder && r.pos !== null ? r.pos : i + 1)),
      lowEt,
      topSpeed,
      hasIndex: style === "index" || style === "super",
    });
  });

  if (files.length === 0) {
    warnings.push("No qualifying rounds (Q1, Q2, …) on file for this event yet.");
  }

  return { files, warnings };
}

// ——— Data Out: EDAT + QDAT together, one class number per class ———

export interface DataOutExportResult {
  edat: EdataExportFile[];
  qdat: QdatExportFile[];
  warnings: string[];
}

export interface DataOutTextOptions extends Pick<DataOutExportOptions, "qualRules" | "timing"> {
  /** C# the user pinned per normalized category — the tower's slot for a class it numbers its own way. */
  classNumberPresets?: Map<string, number>;
}

/**
 * The full Compulink text set for an event from its stored runs: EDAT for
 * every class with eliminations, QDAT for every class with a qualifying sheet,
 * and the SAME C# number for both files of a class — a number the user pinned,
 * else the class's Compulink number (Factory Stock Showdown 16, as the tower's
 * own pack names it), with the classes that have none taking the lowest
 * numbers left free across the union of the two — so C16EDAT.TXT and
 * C16QDAT.TXT are always the same class even mid-event, when some classes have
 * only qualified. QDAT is built first: its sheet positions are the qualifying
 * positions the EDAT prints where getresults left a row at 0.
 */
export function buildDataOutExport(
  runs: RunRow[],
  techCards: EdataTechCard[] = [],
  opts: DataOutTextOptions = {},
): DataOutExportResult {
  const byCategory = new Map<string, RunRow[]>();
  for (const run of findSupersededCopies(runs).runs) {
    if (!isElimRound(run.round) && !isQualRound(run.round)) continue;
    const cat = (run.category || "").trim();
    if (!cat) continue;
    const list = byCategory.get(cat);
    if (list) list.push(run);
    else byCategory.set(cat, [run]);
  }
  const ordered = [...byCategory.entries()]
    .map(([category, catRuns]) => ({ category, ...classInfo(category, catRuns) }))
    .sort((a, b) => a.order - b.order || a.category.localeCompare(b.category));
  const classNumbers = compulinkNumbers(ordered, opts.classNumberPresets);

  const qdat = buildQdatExport(runs, techCards, { classNumbers, qualRules: opts.qualRules, timing: opts.timing });
  const qualPositions = new Map<string, Map<string, number>>();
  for (const f of qdat.files) {
    const byCar = new Map<string, number>();
    f.qualifiers.forEach((q, i) => {
      if (q.car) byCar.set(norm(q.car), f.positions[i]);
    });
    qualPositions.set(norm(f.category), byCar);
  }
  const edat = buildEdataExport(runs, techCards, { classNumbers, timing: opts.timing, qualPositions });

  const warnings: string[] = [];
  if (edat.files.length === 0 && qdat.files.length === 0) {
    warnings.push("No qualifying or elimination rounds on file for this event yet.");
  } else {
    warnings.push(...edat.warnings, ...qdat.warnings);
  }
  return { edat: edat.files, qdat: qdat.files, warnings };
}
