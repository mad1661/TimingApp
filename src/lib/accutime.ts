import { unzipSync } from "fflate";
import MDBReader from "mdb-reader";
import Papa from "papaparse";
import type { RunRow } from "./db";
import type { EdataTechCard } from "./edata-export";
import { parseEdataFile } from "./edata-parse";
import { RACE_CLASSES } from "./schedule-classes";

/**
 * Parser for AccuTime's native session files, so the timing computer's own
 * output can feed the Compulink exports without going through getresults:
 *
 *   race.qly    — CSV, the computed qualifying order (one row per qualifier,
 *                 best RT/ET/MPH and which session the best came from)
 *   race.dat    — a Jet ("Standard Jet DB" / MS Access) database with one
 *                 table, Logging: every pass, two rows per pairing
 *   Class.ini   — session config: class code, race date, series name
 *   Drivers.dbf — despite the extension, another Jet DB (table Drivers): the
 *                 entry records — member number, city/state, car, engine
 *   race.acc    — a plain zip archiving all of the above
 *
 * Findings from the sample session (GM1 Funny Car), which drive the parsing:
 *
 * - Logging's RoundNumber counts qualifying sessions AND elimination rounds
 *   on the same counter: Q1 and E1 both say RoundNumber 1. What separates
 *   them is the calendar day — qualifying ran 9/18-9/19, eliminations 9/21.
 *   So passes are clustered per round by date, the LAST cluster of each round
 *   is the elimination round, and everything earlier is qualifying. When a
 *   round has only one cluster the split is decided by the ladder test (in
 *   eliminations, round N+1's cars are round N's winners; in qualifying
 *   everyone runs every session). A day that held both qualifying and elims
 *   for the same round number would defeat the date split — surfaced as a
 *   warning, not guessed at.
 *
 * - ReactionTime is raw from the tree: 0.4959 on a 0.4 pro tree is a .096
 *   light, 0.3950 is a -.005 red. The base (0.4 pro / 0.5 full) isn't stated
 *   anywhere in the files, so it's inferred from where the session's RTs
 *   cluster and reported in the warnings.
 *
 * - et18/mph18 are the 660-ft numbers, et1000/mph1000 the 1000-ft,
 *   et14/mph14 the quarter. Nitro classes run to 1000 ft, so the class's
 *   finish line is wherever the deepest non-zero times are; a car that shut
 *   off early has zeros past its last beam, which is why the finish distance
 *   is chosen per class, not per run.
 *
 * - A bye is a literal row with car number "BYE" and zeroed timing.
 *
 * - Drivers.dbf's MakeOfCar holds the two-digit BODY YEAR ("24"), and
 *   ModelOfCar the model ("Mustang") — the year lands in body_year and the
 *   model in body_type.
 *
 * AccuTime's unlocked text export (Mike Rice's 2026 national-event dumps)
 * carries the same tables as CSV, one folder per class:
 *
 *   20260918084551dat.txt — the Logging table, header row, same column names
 *                           (times truncated to 2 decimals)
 *   20260918084551qly.txt — the .qly, unchanged
 *   Driversdbf.txt        — the Drivers table, header row; quoted fields can
 *                           hold line breaks, so it needs a real CSV parser
 *
 * The 14-digit stem is AccuTime's race stamp — the same value Class.ini keeps
 * under [Race Date] — and there is no Class.ini, so a session without one
 * takes its class from the folder name ("Funny Car" → FC) and its race date
 * from the stamp. Every class of one event shares the stamp, which is also
 * how two events in one drop are told apart.
 *
 * Splitting qualifying from eliminations can't rely on the calendar day
 * alone: alcohol and sportsman classes often run Q1 and E1 on the same day
 * under the same RoundNumber, and a round stopped by curfew finishes the next
 * day. Each round's passes are therefore cut into time segments, the last
 * segment is the elimination round when the ladder holds (its cars are the
 * previous round's winners), parts of a split round are pulled back in, and
 * whatever is left is qualifying.
 */

export interface AccuTimeQualifier {
  pos: number;
  car_number: string;
  name: string;
  /** Tree-adjusted reaction time of the best pass. */
  rt: number | null;
  et: number | null;
  mph: number | null;
  /** Which qualifying session the best ET came from (1-based), when stated. */
  bestSession: number | null;
}

export interface AccuTimePair {
  /** Rows winner-first (explicit WinnerFlag), for the finals/round PDFs. */
  runs: Omit<RunRow, "id" | "created_at">[];
  single: boolean;
}

export interface AccuTimeElimRound {
  /** App round code: E1, E2, …, F. */
  round: string;
  /** Compulink heading: ROUND 1, …, FINALS. */
  label: string;
  pairs: AccuTimePair[];
}

/**
 * One qualifying session's passes, best finish-line ET per car — the source
 * for the pro per-session low-ET bonus. Only race.dat's Logging clusters can
 * supply this; Compulink QDAT text carries best-of-event only, so sessions
 * built from it leave qualSessionPasses empty (bonuses are then skipped, never
 * invented).
 */
export interface AccuTimeQualSessionData {
  /** 1-based session order across the event (Q1, Q2, …). */
  session: number;
  passes: { car_number: string; name: string; et: number | null }[];
}

export interface AccuTimeSession {
  classCode: string;
  className: string;
  /** YYYY-MM-DD */
  raceDate: string | null;
  seriesName: string | null;
  treeBase: number;
  qualifying: AccuTimeQualifier[];
  qualSessions: number;
  /** Per-session qualifying passes (empty when the source has best-only data). */
  qualSessionPasses: AccuTimeQualSessionData[];
  /** All elimination passes, EDAT/RunRow-shaped (lane order preserved). */
  runs: Omit<RunRow, "id" | "created_at">[];
  elimRounds: AccuTimeElimRound[];
  lowEt: { et: number; car: string; name: string } | null;
  topSpeed: { mph: number; car: string; name: string } | null;
  /** Entry records from Drivers.dbf, in the tech-card shape. */
  drivers: EdataTechCard[];
  warnings: string[];
  /**
   * AccuTime's race stamp (YYYYMMDDHHMMSS) from Class.ini [Race Date] or the
   * text export's file names — shared by every class of one event.
   */
  raceId?: string | null;
  /** The folder holding the class folders in a nested drop (the event), "" when the drop had none. */
  eventFolder?: string;
}

export interface AccuTimeParseOptions {
  eventCode?: string;
  eventName?: string;
  season?: string;
  /** Fallback class code (user-picked on the page) for sessions whose Class.ini gave none. */
  classCode?: string;
}

interface PackFile {
  name: string;
  data: Uint8Array;
}

// ——— small utilities ———

function toBuffer(data: Uint8Array): Buffer {
  return Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

function latin1(data: Uint8Array): string {
  return toBuffer(data).toString("latin1");
}

function baseName(name: string): string {
  return name.split(/[\\/]/).pop() || name;
}

function dirName(name: string): string {
  const norm = name.replace(/\\/g, "/");
  return norm.includes("/") ? norm.slice(0, norm.lastIndexOf("/")) : "";
}

/** Folder or archive name without the archive extension: "FC.zip" → "FC". */
function folderLabel(path: string): string {
  return baseName(path).replace(/\.(zip|acc)$/i, "").trim();
}

/** macOS / Windows clutter that rides along in zips and folder drops. */
function isJunkPath(name: string): boolean {
  const norm = name.replace(/\\/g, "/");
  const base = baseName(norm);
  return (
    /(^|\/)__MACOSX\//i.test(norm) ||
    base.startsWith("._") ||
    /^(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(base)
  );
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

function isJetDb(data: Uint8Array): boolean {
  return latin1(data.slice(4, 19)).startsWith("Standard Jet DB");
}

function isZip(data: Uint8Array): boolean {
  return data.length > 3 && data[0] === 0x50 && data[1] === 0x4b;
}

/** Local-file-header general-purpose bit 0 set ⇒ traditional PKZIP encryption. */
function isEncryptedZip(data: Uint8Array): boolean {
  if (data.length < 8) return false;
  if (!(data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04)) return false;
  const flags = data[6] | (data[7] << 8);
  return (flags & 0x1) === 1;
}

function lockedArchiveWarning(name: string): string {
  const what = /\.acc$/i.test(name)
    ? "this .acc archive is password-locked by AccuTime"
    : "this archive is password-protected";
  return `${name}: ${what} and can't be opened. Upload AccuTime's unlocked text export instead (…dat.txt / …qly.txt / Driversdbf.txt, one folder per class — a zip of the whole event is fine), or the loose .dat / .qly / Class.ini / Drivers.dbf files.`;
}

// ——— AccuTime's unlocked text export: the Logging / Drivers tables as CSV ———

/** Lower-cased column names from a CSV header row. */
function csvHeaderNames(data: Uint8Array): Set<string> {
  const head = latin1(data.subarray(0, 4096)).replace(/^\uFEFF/, "");
  const first = head.split(/\r?\n/, 1)[0] || "";
  return new Set(first.split(",").map((f) => f.trim().replace(/^"(.*)"$/, "$1").toLowerCase()));
}

function isLoggingCsv(data: Uint8Array): boolean {
  if (isJetDb(data)) return false;
  const h = csvHeaderNames(data);
  return h.has("runnumber") && h.has("roundnumber") && h.has("carnumber") && h.has("reactiontime");
}

function isDriversCsv(data: Uint8Array): boolean {
  if (isJetDb(data)) return false;
  const h = csvHeaderNames(data);
  return h.has("carnumber") && h.has("firstname") && h.has("lastname") && !h.has("runnumber");
}

/** Header-row CSV → records keyed by lower-cased column name. */
function readCsvRecords(data: Uint8Array): Record<string, string>[] {
  const text = latin1(data).replace(/^\uFEFF/, "").replace(/\x1a+\s*$/, "");
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  return parsed.data.filter((row) => row && Object.values(row).some((v) => str(v)));
}

/** mdb-reader rows with the same lower-cased keys the CSV path uses. */
function readJetTable(data: Uint8Array, wanted: string): Record<string, unknown>[] {
  const reader = new MDBReader(toBuffer(data));
  const names = reader.getTableNames();
  const tableName = names.find((n) => n.toLowerCase() === wanted) || names[0];
  if (!tableName) return [];
  return reader.getTable(tableName).getData().map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) out[k.toLowerCase()] = v;
    return out;
  });
}

/**
 * The CSV export's wall-clock stamps ("9/18/2026 13:07:55", 24-hour; an
 * AM/PM suffix is honoured if one appears) as a UTC Date — the same
 * convention mdb-reader uses for Jet's local times, so fmtTimestamp and the
 * date keys read both sources alike.
 */
function parseAccuTimeStamp(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = str(v);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!m) return null;
  let hour = parseInt(m[4], 10);
  const ap = (m[7] || "").toUpperCase();
  if (ap === "PM" && hour < 12) hour += 12;
  if (ap === "AM" && hour === 12) hour = 0;
  const d = new Date(Date.UTC(+m[3], +m[1] - 1, +m[2], hour, +m[5], +(m[6] || 0)));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** AccuTime's race stamp (YYYYMMDDHHMMSS) at the start of a name or value, when it is a real date. */
function raceStampOf(s: string): string | null {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{6})/);
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (y < 2000 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return m[0];
}

function stampDate(stamp: string): string {
  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
}

/** The .qly's rows (no header): f[4] best session, f[11] name, f[12] car, f[15..17] RT / ET / MPH. */
function readQlyRows(data: Uint8Array): string[][] {
  const text = latin1(data).replace(/^\uFEFF/, "").replace(/\x1a+\s*$/, "");
  return Papa.parse<string[]>(text, { skipEmptyLines: true })
    .data.map((row) => row.map((f) => str(f)))
    .filter((f) => f.length >= 18 && !!(f[12] || f[11]));
}

// Code → name lookup for the class picker and Class.ini resolution. Racing
// classes only: RACE_CLASSES also holds schedule placeholders ("Secure" is
// code "X", plus Track Prep etc.), and mapping through those turned an
// unknown-class fallback into SECURE/X on every export.
const CLASS_NAME_BY_CODE = new Map<string, string>();
for (const c of RACE_CLASSES) {
  if (!c.isRacing) continue;
  const code = c.code.trim().toUpperCase();
  if (code && !CLASS_NAME_BY_CODE.has(code)) CLASS_NAME_BY_CODE.set(code, c.name.toUpperCase());
}

// ——— Class.ini ———

interface ClassIniInfo {
  classCode: string;
  raceDate: string | null;
  seriesName: string | null;
  roundNumber: number | null;
  /** The full [Race Date] stamp (YYYYMMDDHHMMSS) — AccuTime's id for the race. */
  raceId: string | null;
}

export function parseClassIni(text: string): ClassIniInfo {
  const sections = new Map<string, string[]>();
  let cur: string[] | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) {
      cur = [];
      sections.set(sec[1].trim().toLowerCase(), cur);
      continue;
    }
    if (cur) cur.push(line);
  }
  const values = (name: string): string[] =>
    (sections.get(name) || []).map((l) => l.replace(/^[^=]*=/, "").trim());

  // The class code is the one [Menu] value that's letters, not a number
  // (sample: "[Menu] 11=FC"). AccuTime variants may file it elsewhere, so
  // aliased sections are tried next, then an explicit Class= key anywhere.
  const NOT_A_CODE = new Set(["YES", "NO", "ON", "OFF", "TRUE", "FALSE", "NONE"]);
  const looksLikeCode = (v: string) =>
    /^[A-Z][A-Z0-9/]{0,5}$/.test(v) && !/^\d+$/.test(v) && !NOT_A_CODE.has(v);
  let classCode = "";
  for (const sec of ["menu", "class", "classes", "class menu"]) {
    classCode =
      values(sec)
        .map((v) => v.toUpperCase())
        .find(looksLikeCode) || "";
    if (classCode) break;
  }
  if (!classCode) {
    outer: for (const lines of sections.values()) {
      for (const l of lines) {
        const m = l.match(/^(?:class\s*code|class)\s*=\s*(.+)$/i);
        const v = m ? m[1].trim().toUpperCase() : "";
        if (v && looksLikeCode(v)) {
          classCode = v;
          break outer;
        }
      }
    }
  }

  // [Race Date] 0=20260918084551
  let raceDate: string | null = null;
  let raceId: string | null = null;
  for (const v of values("race date")) {
    const m = v.match(/^(\d{4})(\d{2})(\d{2})/);
    if (m) {
      raceDate = `${m[1]}-${m[2]}-${m[3]}`;
      raceId = raceStampOf(v);
      break;
    }
  }

  // [Reports] holds the series title among numeric knobs.
  const seriesName = values("reports").find((v) => /[A-Za-z].*\s/.test(v)) || null;

  const roundNumber = num(values("round number")[0] ?? null);

  return { classCode, raceDate, seriesName, roundNumber, raceId };
}

// ——— Class from a folder name (no Class.ini in the text export) ———

// Names as they appear on folders: every racing class's own name, sponsor
// prefixes dropped, plus the short forms people actually type.
const CLASS_CODE_BY_FOLDER = new Map<string, string>();
const normClassWords = (s: string): string =>
  s
    .toUpperCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(NHRA|JEGS)\s+/, "");
for (const c of RACE_CLASSES) {
  if (!c.isRacing || !c.code) continue;
  const key = normClassWords(c.name);
  if (key && !CLASS_CODE_BY_FOLDER.has(key)) CLASS_CODE_BY_FOLDER.set(key, c.code.trim().toUpperCase());
}
for (const [alias, code] of [
  ["STOCK", "STK"],
  ["COMP", "COMP"],
  ["COMP ELIMINATOR", "COMP"],
  ["COMPETITION", "COMP"],
  ["PRO STOCK BIKE", "PSM"],
  ["PRO STOCK MOTORCYCLES", "PSM"],
  ["TOP ALCOHOL FC", "TAFC"],
  ["TA FC", "TAFC"],
  ["TA/FC", "TAFC"],
  ["TA D", "TAD"],
  ["TA/D", "TAD"],
  ["FACTORY STOCK", "FSS"],
  ["PRO MODIFIED", "PM"],
  ["JR DRAGSTERS", "JR"],
  ["JUNIOR DRAGSTER", "JR"],
] as const) {
  CLASS_CODE_BY_FOLDER.set(alias, code);
}

/**
 * Class code named by a folder (or file stem): "Funny Car" → FC, "Stock" →
 * STK, "Comp Eliminator" → COMP, a bare code ("TAFC"), or a code in brackets
 * ("Funny Car (FC)"). "" when the name isn't a class.
 */
function classCodeFromName(name: string): string {
  const words = normClassWords(folderLabel(name));
  if (!words) return "";
  const byName = CLASS_CODE_BY_FOLDER.get(words);
  if (byName) return byName;
  const bare = words.replace(/\s+/g, "");
  if (CLASS_NAME_BY_CODE.has(bare)) return bare;
  const bracketed = words.match(/[([]\s*([A-Z/]{1,6})\s*[)\]]/);
  if (bracketed && CLASS_NAME_BY_CODE.has(bracketed[1])) return bracketed[1];
  return "";
}

// ——— Logging table ———

interface LogRow {
  runNumber: number;
  roundNumber: number;
  winner: boolean;
  lane: string;
  car: string;
  name: string;
  dial: number | null;
  rtRaw: number | null;
  ft60: number | null;
  ft330: number | null;
  et660: number | null;
  mph660: number | null;
  et1000: number | null;
  mph1000: number | null;
  et1320: number | null;
  mph1320: number | null;
  margin: number | null;
  ts: Date | null;
}

/** Logging rows from the Jet race.dat or the text export's …dat.txt CSV. */
function readLogging(data: Uint8Array): LogRow[] {
  const records: Record<string, unknown>[] = isLoggingCsv(data) ? readCsvRecords(data) : readJetTable(data, "logging");
  return records.map((r) => {
    const flag = r["winnerflag"];
    return {
      runNumber: num(r["runnumber"]) ?? 0,
      roundNumber: num(r["roundnumber"]) ?? 0,
      winner: flag === true || flag === 1 || /^(1|-1|true|yes)$/i.test(str(flag)),
      lane: str(r["lane"]).toUpperCase(),
      car: str(r["carnumber"]),
      // Despite the column name, AccuTime puts the whole driver name here.
      name: str(r["lastname"]),
      dial: posOrNull(num(r["dialin"])),
      rtRaw: posOrNull(num(r["reactiontime"])),
      ft60: posOrNull(num(r["ft60"])),
      ft330: posOrNull(num(r["ft330"])),
      et660: posOrNull(num(r["et18"])),
      mph660: posOrNull(num(r["mph18"])),
      et1000: posOrNull(num(r["et1000"])),
      mph1000: posOrNull(num(r["mph1000"])),
      et1320: posOrNull(num(r["et14"])),
      mph1320: posOrNull(num(r["mph14"])),
      margin: posOrNull(num(r["margin"])),
      ts: parseAccuTimeStamp(r["timestamp"]),
    };
  });
}

function posOrNull(n: number | null): number | null {
  return n !== null && n > 0 ? n : null;
}

// LEFT / RIGHT are AccuTime's placeholder car numbers for a lane with no
// entry assigned (test and single passes).
function isByeRow(r: LogRow): boolean {
  return /^BYE$/i.test(r.car) || (/^(LEFT|RIGHT)$/i.test(r.car) && !r.name) || (!r.car && !r.name);
}

// ——— Drivers table ———

/** Entry records from the Jet Drivers.dbf or the text export's Driversdbf.txt CSV. */
function readDrivers(data: Uint8Array, classCode: string, className: string): EdataTechCard[] {
  const records: Record<string, unknown>[] = isDriversCsv(data) ? readCsvRecords(data) : readJetTable(data, "drivers");
  return records
    .map((d) => {
      const make = str(d["makeofcar"]);
      // MakeOfCar carries the two-digit body year; a non-numeric value is a
      // real make and belongs in front of the model.
      const yearish = /^\d{2,4}$/.test(make);
      return {
        car_number: str(d["carnumber"]),
        first_name: str(d["firstname"]),
        last_name: str(d["lastname"]),
        city: str(d["city"]),
        state: str(d["state"]),
        category: str(d["indexclass"]) || classCode,
        class_name: className,
        engine_make: str(d["enginemake"]),
        body_type: [yearish ? "" : make, str(d["modelofcar"])].filter(Boolean).join(" "),
        body_year: yearish ? make : "",
        cu_cc: str(d["cuin"]),
        member_number: str(d["membership"]),
        hp: str(d["advertisedhp"]),
        factored_hp: str(d["factoredhp"]),
        event_name: "", // session-local: always trusted
      } as EdataTechCard;
    })
    .filter((tc) => tc.car_number || (tc.first_name && tc.last_name));
}

// ——— The session assembly ———

/** RTs cluster just above the tree base; red lights dip just below it. */
function inferTreeBase(rts: number[], warnings: string[]): number {
  const proish = rts.filter((r) => r >= 0.37 && r < 0.5).length;
  const fullish = rts.filter((r) => r >= 0.5 && r < 0.63).length;
  const base = proish >= fullish ? 0.4 : 0.5;
  if (rts.length > 0) {
    warnings.push(
      `Reaction times converted from AccuTime's raw tree values using a ${base.toFixed(1)}s ${
        base === 0.4 ? "pro" : "full"
      } tree base (inferred from the session's RT spread).`,
    );
  }
  return base;
}

function fmtTimestamp(d: Date): string {
  // Jet stores local wall-clock time; mdb-reader surfaces it as if UTC, so
  // read it back with the UTC getters to recover the literal clock time.
  let hour = d.getUTCHours();
  const ampm = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()} ${hour}:${p(
    d.getUTCMinutes(),
  )}:${p(d.getUTCSeconds())} ${ampm}`;
}

function dateKey(d: Date | null): string {
  if (!d) return "?";
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

interface Pass {
  rows: LogRow[];
  ts: Date | null;
}

/** Group Logging rows into passes (the two cars that ran together). */
function buildPasses(rows: LogRow[]): Map<number, Pass[]> {
  const byRound = new Map<number, Map<string, Pass>>();
  for (const row of rows) {
    let round = byRound.get(row.roundNumber);
    if (!round) byRound.set(row.roundNumber, (round = new Map()));
    // RunNumbers restart between the qualifying and elimination sequences, so
    // the date is part of the pairing key.
    const key = `${row.runNumber}|${dateKey(row.ts)}`;
    let pass = round.get(key);
    if (!pass) round.set(key, (pass = { rows: [], ts: row.ts }));
    pass.rows.push(row);
    if (!pass.ts && row.ts) pass.ts = row.ts;
  }
  const out = new Map<number, Pass[]>();
  for (const [rn, passes] of byRound) {
    out.set(
      rn,
      [...passes.values()].sort((a, b) => (a.ts?.getTime() ?? 0) - (b.ts?.getTime() ?? 0)),
    );
  }
  return out;
}

// A class's session runs pair after pair a few minutes apart; an hour's
// silence means it stopped (end of session, weather, curfew).
const SEGMENT_GAP_MS = 60 * 60 * 1000;
// The whole pair coming back after a break is the field's next go, not a re-run.
const RERUN_GAP_MS = 15 * 60 * 1000;
// Share of a round's cars that must be the previous round's winners for the
// ladder to hold — under 1 so an alternate filling a broken winner's spot
// doesn't break it.
const LADDER_SHARE = 0.8;

/** A stretch of one round's passes the class ran without stopping. */
interface Segment {
  passes: Pass[];
  cars: Set<string>;
  /** Pair winners, plus the lone car of a single (a bye run advances). */
  winners: Set<string>;
  start: number;
  end: number;
}

function carKey(r: LogRow): string {
  return r.car.trim().toUpperCase();
}

function emptySegment(): Segment {
  return { passes: [], cars: new Set(), winners: new Set(), start: NaN, end: NaN };
}

function addToSegment(seg: Segment, p: Pass): void {
  seg.passes.push(p);
  const real = p.rows.filter((r) => !isByeRow(r));
  for (const r of real) {
    seg.cars.add(carKey(r));
    if (r.winner || real.length === 1) seg.winners.add(carKey(r));
  }
  const t = p.ts ? p.ts.getTime() : NaN;
  if (Number.isFinite(t)) {
    if (!(seg.start <= t)) seg.start = t;
    if (!(seg.end >= t)) seg.end = t;
  }
}

function joinSegments(a: Segment, b: Segment): Segment {
  const out = emptySegment();
  for (const p of [...a.passes, ...b.passes]) addToSegment(out, p);
  return out;
}

function unionSegments(segs: Segment[]): Segment {
  return segs.reduce((acc, s) => joinSegments(acc, s), emptySegment());
}

/** Fraction of `cars` found in `pool` (0 for an empty set). */
function shareIn(cars: Set<string>, pool: Set<string>): number {
  if (cars.size === 0) return 0;
  let n = 0;
  for (const c of cars) if (pool.has(c)) n++;
  return n / cars.size;
}

function disjoint(a: Set<string>, b: Set<string>): boolean {
  for (const c of a) if (b.has(c)) return false;
  return true;
}

/**
 * One round's passes (time-sorted) cut wherever the class stopped: a new day,
 * a gap over an hour, or a pair whose cars both already ran in this stretch
 * coming back after a break. Passes with no real car (both lanes BYE or
 * placeholders) are dropped — there is nothing in them to place.
 */
function segmentRound(passes: Pass[]): Segment[] {
  const segs: Segment[] = [];
  let cur: Segment | null = null;
  for (const p of passes) {
    const cars = p.rows.filter((r) => !isByeRow(r)).map(carKey);
    if (cars.length === 0) continue;
    const t = p.ts ? p.ts.getTime() : NaN;
    let split = false;
    if (cur && Number.isFinite(t) && Number.isFinite(cur.end)) {
      const gap = t - cur.end;
      const seg: Segment = cur;
      split =
        dateKey(p.ts) !== dateKey(new Date(cur.end)) ||
        gap > SEGMENT_GAP_MS ||
        (gap > RERUN_GAP_MS && cars.every((c) => seg.cars.has(c)));
    }
    if (!cur || split) {
      cur = emptySegment();
      segs.push(cur);
    }
    addToSegment(cur, p);
  }
  return segs;
}

/** Qualifying stretches of one round: consecutive ones with no car in common are one session that was interrupted. */
function qualSessionsOf(segs: Segment[]): Pass[][] {
  const out: Segment[] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && disjoint(last.cars, s.cars)) out[out.length - 1] = joinSegments(last, s);
    else out.push(s);
  }
  return out.map((s) => s.passes);
}

/**
 * Split each round's passes into qualifying sessions and the elimination
 * round. AccuTime numbers qualifying sessions and elimination rounds on one
 * counter (Q1 and E1 are both RoundNumber 1), so per round:
 *
 * - the passes are cut into segments (segmentRound) — this is what separates
 *   Q1 from E1 when both ran the same day;
 * - the LAST segment is the elimination round when the ladder holds: for
 *   round 1 it re-fields cars that already ran (qualifying came first) or its
 *   winners make up round 2; after that its cars must be the previous elim
 *   round's winners and it must come later;
 * - earlier segments that share no car with it and fit the same ladder are
 *   the rest of a round stopped and finished later (curfew, rain), so they
 *   join it;
 * - everything else is qualifying.
 */
function splitQualElim(
  passesByRound: Map<number, Pass[]>,
  warnings: string[],
): { qual: Map<number, Pass[][]>; elim: Map<number, Pass[]> } {
  const qual = new Map<number, Pass[][]>();
  const elim = new Map<number, Pass[]>();

  const segsByRound = new Map<number, Segment[]>();
  for (const rn of [...passesByRound.keys()].sort((a, b) => a - b)) {
    const segs = segmentRound(passesByRound.get(rn)!);
    if (segs.length) segsByRound.set(rn, segs);
  }
  const rounds = [...segsByRound.keys()];
  if (rounds.length === 0) return { qual, elim };

  let prev: Segment | null = null;
  let prevRn = NaN;
  rounds.forEach((rn, i) => {
    const segs = segsByRound.get(rn)!;
    const cand = segs[segs.length - 1];
    // The next round's passes after this candidate — where its winners turn up.
    const nextRound = segsByRound.get(rn + 1) || [];
    const nextCars = unionSegments(nextRound.filter((s) => s.start > cand.start)).cars;

    let isElim = false;
    if (!prev) {
      if (i === 0) {
        const earlier = segs.slice(0, -1);
        const refields = earlier.some((s) => !disjoint(s.cars, cand.cars));
        const laddersOn = nextCars.size > 0 && shareIn(nextCars, cand.winners) >= LADDER_SHARE;
        if (earlier.length > 0 || rounds.length > 1) {
          isElim = refields || laddersOn;
        } else {
          // One lone stretch: a field with byes reads as eliminations underway;
          // there is nothing to test it against, so say what was assumed.
          warnings.push(
            "Only one round in the session and no qualifying before it — treated as an elimination round in progress.",
          );
          isElim = true;
        }
      }
    } else {
      // The ladder runs round after round: no skipped numbers.
      const follows = rn === prevRn + 1 && cand.start > prev.start;
      isElim = follows && shareIn(cand.cars, prev.winners) >= LADDER_SHARE;
      if (!isElim && follows && cand.start > prev.end) {
        warnings.push(
          `Round ${rn}: the last passes don't follow the elimination ladder (cars that lost or never ran the previous round are in them) — left out of the eliminations. Check the output.`,
        );
      }
    }

    if (!isElim) {
      qual.set(rn, qualSessionsOf(segs));
      return;
    }

    let round = cand;
    let j = segs.length - 2;
    for (; j >= 0; j--) {
      const s = segs[j];
      if (!disjoint(s.cars, round.cars)) break;
      const fits = prev
        ? s.start > prev.start && shareIn(s.cars, prev.winners) >= LADDER_SHARE
        : s.winners.size > 0 && shareIn(s.winners, nextCars) >= LADDER_SHARE;
      if (!fits) break;
      round = joinSegments(s, round);
    }
    elim.set(rn, round.passes);
    if (j >= 0) qual.set(rn, qualSessionsOf(segs.slice(0, j + 1)));
    prev = round;
    prevRn = rn;
  });

  if (elim.size === 0 && rounds.length > 1) {
    warnings.push(
      "The session's rounds re-run the same cars (no elimination ladder) — treated as qualifying sessions only; no EDAT rounds.",
    );
  }
  return { qual, elim };
}

// ——— Session grouping: one drop can hold many classes ———

/**
 * Identifying stem of a filename: basename without extension, lowercased, with
 * the generic "class" word stripped so "FC-Class.ini" and "FC.dat" agree on
 * "fc". AccuTime's default names ("race.dat", "Class.ini", "Drivers.dbf")
 * reduce to generic stems that identify nothing.
 */
function stemOf(name: string): string {
  let stem = baseName(name).toLowerCase();
  // The text export glues the table kind onto the race stamp:
  // 20260918084551dat.txt / 20260918084551qly.txt / Driversdbf.txt.
  const glued = stem.match(/^(.*?)\.?(dat|qly|dbf|ini)\.(txt|csv)$/);
  stem = glued ? glued[1] : stem.replace(/\.[^.]+$/, "");
  stem = stem.replace(/(^|[-_ .])class(?=[-_ .]|$)/g, "$1");
  return stem.replace(/^[-_ .]+|[-_ .]+$/g, "");
}

const GENERIC_STEMS = new Set(["", "race", "drivers", "driver"]);

function isIdentifying(stem: string): boolean {
  return !GENERIC_STEMS.has(stem);
}

type AccuFileKind = "dat" | "qly" | "ini" | "dbf" | "other";

const kindCache = new WeakMap<PackFile, AccuFileKind>();

/**
 * What an AccuTime file is, by content where the name can't be trusted:
 * the Jet databases and the text export's CSV tables carry their own
 * signatures; the .qly and Class.ini go by name (Classini.txt being the text
 * export's spelling).
 */
function accuKind(f: PackFile): AccuFileKind {
  const cached = kindCache.get(f);
  if (cached) return cached;
  const base = baseName(f.name);
  let kind: AccuFileKind = "other";
  if (isJetDb(f.data)) {
    if (/\.dat$/i.test(base)) kind = "dat";
    else if (/\.dbf$/i.test(base) || /drivers/i.test(base)) kind = "dbf";
  } else if (isLoggingCsv(f.data)) {
    kind = "dat";
  } else if (isDriversCsv(f.data)) {
    kind = "dbf";
  } else if (/\.qly$/i.test(base) || /qly\.(txt|csv)$/i.test(base)) {
    kind = "qly";
  } else if (/\.ini$/i.test(base) || /^class\.?ini\.txt$/i.test(base)) {
    kind = "ini";
  } else if (/\.dbf$/i.test(base)) {
    kind = "dbf";
  }
  kindCache.set(f, kind);
  return kind;
}

function isDatFile(f: PackFile): boolean {
  return accuKind(f) === "dat";
}
function isQlyFile(f: PackFile): boolean {
  return accuKind(f) === "qly";
}
function isIniFile(f: PackFile): boolean {
  return accuKind(f) === "ini";
}
function isDbfFile(f: PackFile): boolean {
  return accuKind(f) === "dbf";
}

/** The class codes a Drivers db mentions (IndexClass) — a pairing signal. */
function dbfClassCodes(data: Uint8Array): Set<string> {
  const out = new Set<string>();
  try {
    const records: Record<string, unknown>[] = isDriversCsv(data) ? readCsvRecords(data) : readJetTable(data, "drivers");
    for (const row of records) {
      const c = str(row["indexclass"]).toUpperCase();
      if (c) out.add(c);
    }
  } catch {
    // unreadable db — no signal
  }
  return out;
}

interface SessionGroup {
  label: string;
  files: PackFile[];
  /** Folder the files sat in ("" for loose files). */
  dir: string;
  /** What the folder or file stem calls the class, for a session with no Class.ini. */
  classHint: string;
  /** The folder holding this class's folder — the event, in a nested drop. */
  eventDir: string;
}

/**
 * Split a pile of loose files into per-class session groups. Pairing order:
 * shared directory (folder drops and zip members carry relative paths), then
 * matching basename stem ("FC.dat" + "FC.qly" + "FC-Class.ini", or a shared
 * race-id like "20260918084551"), then each Class.ini's own class code against
 * the driver db, then the only-one-left rule. Files that still can't be
 * placed are reported in the warnings — never silently dropped — and every
 * session that did resolve is still exported.
 */
function splitLooseSessions(
  files: PackFile[],
  topWarnings: string[],
  baseLabel: string,
): SessionGroup[] {
  const byDir = new Map<string, PackFile[]>();
  for (const f of files) {
    const dir = dirName(f.name);
    const list = byDir.get(dir);
    if (list) list.push(f);
    else byDir.set(dir, [f]);
  }
  const groups: SessionGroup[] = [];
  for (const [dir, bucket] of byDir) {
    const label = dir ? `${baseLabel} · ${dir}` : baseLabel;
    groups.push(...splitBucket(bucket, label, dir, topWarnings));
  }
  return groups;
}

function splitBucket(bucket: PackFile[], label: string, dir: string, topWarnings: string[]): SessionGroup[] {
  const dats = bucket.filter(isDatFile);
  const qlys = bucket.filter(isQlyFile);
  const inis = bucket.filter(isIniFile);
  const dbfs = bucket.filter(isDbfFile);

  // One class at most — the whole bucket is one session, exactly as before.
  if (dats.length <= 1 && qlys.length <= 1 && inis.length <= 1 && dbfs.length <= 1) {
    return [{ label, files: bucket, dir, classHint: folderLabel(dir), eventDir: dirName(dir) }];
  }

  interface Sess {
    stem: string;
    files: PackFile[];
    hasQly: boolean;
    hasIni: boolean;
    dbfCodes: Set<string> | null;
    dbf: PackFile | null;
  }
  const sessions: Sess[] = [];
  const unmatched: PackFile[] = [];

  // Anchors: every .dat starts a session.
  for (const dat of dats) sessions.push({ stem: stemOf(dat.name), files: [dat], hasQly: false, hasIni: false, dbfCodes: null, dbf: null });

  // .qly: stem match first, then the only-one-left rule; a leftover with an
  // identifying stem is a qualifying-only session of its own.
  const pendingQlys: PackFile[] = [];
  for (const qly of qlys) {
    const stem = stemOf(qly.name);
    const match = isIdentifying(stem) ? sessions.find((s) => s.stem === stem && !s.hasQly) : null;
    if (match) {
      match.files.push(qly);
      match.hasQly = true;
    } else {
      pendingQlys.push(qly);
    }
  }
  if (pendingQlys.length === 1) {
    const without = sessions.filter((s) => !s.hasQly);
    if (without.length === 1) {
      without[0].files.push(pendingQlys[0]);
      without[0].hasQly = true;
      pendingQlys.length = 0;
    }
  }
  for (const qly of pendingQlys.slice()) {
    const stem = stemOf(qly.name);
    if (isIdentifying(stem) || sessions.length === 0) {
      sessions.push({ stem, files: [qly], hasQly: true, hasIni: false, dbfCodes: null, dbf: null });
      pendingQlys.splice(pendingQlys.indexOf(qly), 1);
    }
  }
  unmatched.push(...pendingQlys);

  // Driver DBs: a stem match claims one session; a lone generic Drivers.dbf is
  // the shared entry database and joins every session.
  const looseDbfs: PackFile[] = [];
  for (const dbf of dbfs) {
    const stem = stemOf(dbf.name);
    const match = isIdentifying(stem) ? sessions.find((s) => s.stem === stem && !s.dbf) : null;
    if (match) {
      match.files.push(dbf);
      match.dbf = dbf;
    } else {
      looseDbfs.push(dbf);
    }
  }
  if (looseDbfs.length === 1) {
    for (const s of sessions) {
      if (!s.dbf) {
        s.files.push(looseDbfs[0]);
        s.dbf = looseDbfs[0];
      }
    }
  } else {
    unmatched.push(...looseDbfs);
  }

  // Class.ini files: stem match first, then the ini's own class code against
  // the session's driver-db classes, then the only-one-left rule.
  const pendingInis: PackFile[] = [];
  for (const ini of inis) {
    const stem = stemOf(ini.name);
    const match = isIdentifying(stem) ? sessions.find((s) => s.stem === stem && !s.hasIni) : null;
    if (match) {
      match.files.push(ini);
      match.hasIni = true;
    } else {
      pendingInis.push(ini);
    }
  }
  for (const ini of pendingInis.slice()) {
    const code = parseClassIni(latin1(ini.data)).classCode;
    if (!code) continue;
    const candidates = sessions.filter((s) => {
      if (s.hasIni || !s.dbf) return false;
      if (!s.dbfCodes) s.dbfCodes = dbfClassCodes(s.dbf.data);
      return s.dbfCodes.has(code);
    });
    if (candidates.length === 1) {
      candidates[0].files.push(ini);
      candidates[0].hasIni = true;
      pendingInis.splice(pendingInis.indexOf(ini), 1);
    }
  }
  if (pendingInis.length === 1) {
    const without = sessions.filter((s) => !s.hasIni);
    if (without.length === 1) {
      without[0].files.push(pendingInis[0]);
      without[0].hasIni = true;
      pendingInis.length = 0;
    }
  }
  unmatched.push(...pendingInis);

  if (unmatched.length > 0) {
    topWarnings.push(
      `${label}: could not tell which class these belong to — ${unmatched
        .map((f) => f.name)
        .join(", ")}. Group each class's files in their own folder or give them matching names (FC.dat + FC.qly + FC-Class.ini) and re-drop.`,
    );
  }

  return sessions.map((s) => ({
    label: isIdentifying(s.stem) ? `${label} · ${s.stem.toUpperCase()}` : label,
    files: s.files,
    dir,
    classHint: isIdentifying(s.stem) ? s.stem : folderLabel(dir),
    // Several classes in one folder: that folder is their event.
    eventDir: dir,
  }));
}

// ——— Compulink QDAT/EDAT text ingest (path B) ———
//
// Tracks that already hold Compulink text can skip the AccuTime conversion:
// dropping C#QDAT.TXT + C#EDAT.TXT builds the same package (PDFs, points,
// re-emitted QDAT/EDAT) through the same session pipeline.

function compulinkKind(f: PackFile): "qdat" | "edat" | null {
  if (!/\.txt$/i.test(f.name)) return null;
  if (accuKind(f) !== "other") return null;
  const head = latin1(f.data.slice(0, 300));
  if (/^Compulink\s+StarTrak\s+.+\s+Qualifying\s+for\s+\d+/im.test(head)) return "qdat";
  if (/^Compulink\s+StarTrak\s+.+\s+Elimination\s+Results/im.test(head)) return "edat";
  const base = f.name.split(/[\\/]/).pop() || f.name;
  if (/QDAT/i.test(base)) return "qdat";
  if (/EDAT/i.test(base)) return "edat";
  return null;
}

interface QdatParseEntry {
  car: string;
  member: string;
  cls: string;
  body: string;
  bodyYear: string;
  engine: string;
  hp: string;
  factoredHp: string;
  name: string;
  cityState: string;
  et: number | null;
}

function parseQdatText(text: string): {
  className: string;
  entries: QdatParseEntry[];
  lowEt: { et: number; car: string; name: string } | null;
  topSpeed: { mph: number; car: string; name: string } | null;
} {
  const lines = text.replace(/\x1a+/g, "").split(/\r?\n/);
  let className = "";
  let lowEt: { et: number; car: string; name: string } | null = null;
  let topSpeed: { mph: number; car: string; name: string } | null = null;
  const entries: QdatParseEntry[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^End of File$/i.test(line)) continue;
    const h = line.match(/^Compulink\s+StarTrak\s+(.+?)\s+Qualifying\s+for\s+\d+/i);
    if (h) {
      className = h[1].trim();
      continue;
    }
    const low = line.match(/^Low\s+ET\s+([\d.]+)\s+(\S+)\s+(.*)$/i);
    if (low) {
      lowEt = { et: parseFloat(low[1]), car: low[2], name: low[3].trim() };
      continue;
    }
    const top = line.match(/^Top\s+Speed\s+([\d.]+)\s+(\S+)\s+(.*)$/i);
    if (top) {
      topSpeed = { mph: parseFloat(top[1]), car: top[2], name: top[3].trim() };
      continue;
    }
    const f = line.split(",");
    if (f.length < 11) continue;
    entries.push({
      car: str(f[0]),
      member: str(f[1]) === "0" ? "" : str(f[1]),
      cls: str(f[2]),
      body: str(f[3]),
      bodyYear: str(f[4]),
      engine: str(f[5]),
      hp: str(f[6]),
      factoredHp: str(f[7]),
      name: str(f[8]),
      cityState: str(f[9]),
      et: posOrNull(num(f[10])),
    });
  }
  return { className, entries, lowEt, topSpeed };
}

function splitCityState(s: string): { city: string; state: string } {
  const m = s.trim().match(/^(.*?)\s+([A-Z]{2})$/i);
  return m ? { city: m[1], state: m[2].toUpperCase() } : { city: s.trim(), state: "" };
}

function splitPersonName(s: string): { first: string; last: string } {
  const words = s.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return { first: "", last: words[0] || "" };
  return { first: words.slice(0, -1).join(" "), last: words[words.length - 1] };
}

function splitBody(s: string): { type: string; year: string } {
  const m = s.trim().match(/^'(\d{2})\s+(.*)$/);
  return m ? { type: m[2], year: m[1] } : { type: s.trim(), year: "" };
}

function splitEngine(s: string): { make: string; cid: string } {
  const words = s.trim().split(/\s+/).filter(Boolean);
  const cid = words.length > 1 && /^\d+$/.test(words[words.length - 1]) ? words.pop()! : "";
  return { make: words.join(" "), cid };
}

/** Entry-record card synthesized from a Compulink text row (QDAT or EDAT). */
function compulinkCard(fields: {
  car: string;
  member: string;
  cls: string;
  name: string;
  cityState: string;
  body: string;
  engine: string;
  className: string;
  hp?: string;
  factoredHp?: string;
}): EdataTechCard {
  const { city, state } = splitCityState(fields.cityState);
  const { first, last } = splitPersonName(fields.name);
  const body = splitBody(fields.body);
  const engine = splitEngine(fields.engine);
  return {
    car_number: fields.car,
    first_name: first,
    last_name: last,
    city,
    state,
    category: fields.cls,
    class_name: fields.className,
    engine_make: engine.make,
    body_type: body.type,
    body_year: body.year,
    cu_cc: engine.cid,
    member_number: fields.member === "0" ? "" : fields.member,
    hp: fields.hp || "",
    factored_hp: fields.factoredHp || "",
    event_name: "", // session-local: always trusted
  };
}

function buildCompulinkSessions(
  files: PackFile[],
  iniMeta: ClassIniInfo | null,
  sharedDbfs: PackFile[],
  opts: AccuTimeParseOptions,
  topWarnings: string[],
): AccuTimeSession[] {
  // Pair QDAT + EDAT by the C# prefix, falling back to the header class name
  // for renamed files.
  const groups = new Map<string, { qdat: PackFile | null; edat: PackFile | null }>();
  const keyFor = (f: PackFile): string => {
    const base = f.name.split(/[\\/]/).pop() || f.name;
    const m = base.match(/^C(\d+)/i);
    if (m) return `#${parseInt(m[1], 10)}`;
    const head = latin1(f.data.slice(0, 300));
    const h = head.match(/^Compulink\s+StarTrak\s+(.+?)\s+(?:Qualifying\s+for|Elimination\s+Results)/im);
    return h ? h[1].trim().toUpperCase() : base.toUpperCase();
  };
  for (const f of files) {
    const kind = compulinkKind(f);
    if (!kind) continue;
    const key = keyFor(f);
    const g = groups.get(key) || { qdat: null, edat: null };
    if (kind === "qdat" && !g.qdat) g.qdat = f;
    else if (kind === "edat" && !g.edat) g.edat = f;
    else topWarnings.push(`${f.name}: another ${kind.toUpperCase()} for the same class was already read — skipped.`);
    groups.set(key, g);
  }

  const sessions: AccuTimeSession[] = [];

  for (const [, g] of groups) {
    const warnings: string[] = [];
    const label = g.edat?.name || g.qdat?.name || "?";

    // Eliminations through the existing EData parser (winner-first pairing,
    // SINGLE markers, synthetic timestamps).
    let runs: AccuTimeSession["runs"] = [];
    let roundsInOrder: string[] = [];
    let edatClassName = "";
    if (g.edat) {
      const parsed = parseEdataFile(latin1(g.edat.data), {
        eventCode: opts.eventCode || "",
        season: opts.season || (iniMeta?.raceDate ? iniMeta.raceDate.slice(0, 4) : ""),
        eventName: opts.eventName,
        raceDate: iniMeta?.raceDate || undefined,
        fileName: g.edat.name,
      });
      warnings.push(...parsed.warnings);
      edatClassName = parsed.category;
      runs = parsed.runs;
      roundsInOrder = parsed.rounds;
    } else {
      warnings.push(`${label}: QDAT with no matching EDAT — qualifying only, no elimination rounds or points.`);
    }

    const qdat = g.qdat ? parseQdatText(latin1(g.qdat.data)) : null;
    if (g.edat && !g.qdat) {
      warnings.push(`${label}: EDAT with no matching QDAT — no qualifying sheet (and no alcohol qualifying points).`);
    }

    const classNameRaw = (edatClassName || qdat?.className || "").trim().toUpperCase();

    // Class code: the header name decides first — in Super Stock / Stock /
    // Comp the rows' class column is each CAR's class (GT/HA, B/SA, I/SM),
    // not the eliminator. The row majority covers headerless files.
    let classCode = "";
    for (const [code, name] of CLASS_NAME_BY_CODE) {
      if (name === classNameRaw) {
        classCode = code;
        break;
      }
    }
    if (!classCode) {
      const codeCounts = new Map<string, number>();
      for (const r of runs) {
        const c = (r.class_index || "").trim().toUpperCase();
        if (c) codeCounts.set(c, (codeCounts.get(c) || 0) + 1);
      }
      for (const e of qdat?.entries || []) {
        const c = e.cls.trim().toUpperCase();
        if (c) codeCounts.set(c, (codeCounts.get(c) || 0) + 1);
      }
      classCode = [...codeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    }
    if (!classCode) classCode = (opts.classCode || "").trim().toUpperCase();
    const className = classNameRaw || (classCode ? CLASS_NAME_BY_CODE.get(classCode) || classCode : "UNKNOWN");
    if (!classCode) {
      warnings.push(`${label}: no class code in the file — pick the class on the page and rebuild.`);
    }

    // Elimination rounds: runs arrive winner-first per pair in file order.
    const elimRounds: AccuTimeElimRound[] = [];
    for (const roundCode of roundsInOrder) {
      const roundRuns = runs.filter((r) => r.round === roundCode);
      const pairs: AccuTimePair[] = [];
      for (let i = 0; i < roundRuns.length; ) {
        const r = roundRuns[i];
        const next = roundRuns[i + 1];
        if (r.is_winner && next && !next.is_winner) {
          pairs.push({ runs: [r, next], single: false });
          i += 2;
        } else {
          pairs.push({ runs: [r], single: true });
          i += 1;
        }
      }
      const m = roundCode.match(/^E(\d+)$/);
      if (pairs.length) {
        elimRounds.push({ round: roundCode, label: m ? `ROUND ${m[1]}` : "FINALS", pairs });
      }
    }

    // Qualifying order + entry cards from the text rows themselves, so the
    // package rebuilds even with no external tech cards on file.
    const qualifying: AccuTimeQualifier[] = (qdat?.entries || []).map((e, i) => ({
      pos: i + 1,
      car_number: e.car,
      name: e.name,
      rt: null,
      et: e.et,
      mph: null,
      bestSession: null,
    }));

    const drivers: EdataTechCard[] = [];
    const seenCards = new Set<string>();
    const addCard = (card: EdataTechCard) => {
      const key = `${card.car_number}|${card.last_name}`.toUpperCase();
      if (!card.car_number && !card.last_name) return;
      if (seenCards.has(key)) return;
      seenCards.add(key);
      drivers.push(card);
    };
    for (const e of qdat?.entries || []) {
      addCard(compulinkCard({ ...e, className }));
    }
    if (g.edat) {
      // EDAT rows carry city / body / engine the RunRow shape doesn't hold.
      for (const raw of latin1(g.edat.data).replace(/\x1a+/g, "").split(/\r?\n/)) {
        const f = raw.split(",");
        if (f.length < 12 || /^SINGLE$/i.test(f[0].trim())) continue;
        addCard(
          compulinkCard({
            car: str(f[0]),
            member: str(f[1]),
            cls: str(f[2]),
            name: str(f[4]),
            cityState: str(f[5]),
            body: str(f[6]),
            engine: str(f[7]),
            className,
          }),
        );
      }
    }
    for (const dbf of sharedDbfs) {
      if (!isJetDb(dbf.data) && !isDriversCsv(dbf.data)) continue;
      try {
        for (const card of readDrivers(dbf.data, classCode, className)) addCard(card);
      } catch {
        // unreadable shared driver db — text rows already cover the basics
      }
    }

    // Retag runs with the resolved class name so grouping downstream holds.
    for (const r of runs) r.category = className;

    const qualPassRuns = runs.filter((r) => r.ft1320 !== null);
    let lowEt = qdat?.lowEt || null;
    let topSpeed = qdat?.topSpeed || null;
    if (!lowEt) {
      for (const r of qualPassRuns) {
        if (r.ft1320 !== null && (!lowEt || r.ft1320 < lowEt.et))
          lowEt = { et: r.ft1320, car: r.car_number || "", name: r.name || "" };
      }
    }
    if (!topSpeed) {
      for (const r of qualPassRuns) {
        if (r.mph_1320 !== null && (!topSpeed || r.mph_1320 > topSpeed.mph))
          topSpeed = { mph: r.mph_1320, car: r.car_number || "", name: r.name || "" };
      }
    }

    sessions.push({
      classCode,
      className,
      raceDate: iniMeta?.raceDate || null,
      seriesName: iniMeta?.seriesName || null,
      treeBase: 0.5, // Compulink text carries tree-adjusted RTs already
      qualifying,
      qualSessions: qualifying.length ? 1 : 0,
      // QDAT holds the best-of-event order only — no per-session passes, so
      // pro session low-ET bonuses are skipped (and said so), never guessed.
      qualSessionPasses: [],
      runs,
      elimRounds,
      lowEt,
      topSpeed,
      drivers,
      warnings,
    });
  }

  return sessions;
}

/**
 * Unpack .zip / .acc archives (and zips inside them) into loose files whose
 * names keep the archive and folder path, so the folder-based grouping sees
 * each archive as a folder. OS clutter (__MACOSX, ._ files, .DS_Store) is
 * dropped on the way in.
 */
function expandArchives(files: PackFile[], topWarnings: string[], depth = 0): PackFile[] {
  const out: PackFile[] = [];
  for (const f of files) {
    if (isJunkPath(f.name)) continue;
    if (!isZip(f.data)) {
      out.push(f);
      continue;
    }
    if (isEncryptedZip(f.data)) {
      // AccuTime's .acc uses a password only its own software knows, so it
      // can't be opened here — the loose files carry the same data.
      topWarnings.push(lockedArchiveWarning(f.name));
      continue;
    }
    if (depth >= 4) {
      topWarnings.push(`${f.name}: archives nested this deep aren't opened — unzip it first.`);
      continue;
    }
    let members: Record<string, Uint8Array>;
    try {
      members = unzipSync(f.data, { filter: (m) => !m.name.endsWith("/") && !isJunkPath(m.name) });
    } catch {
      topWarnings.push(`${f.name}: could not be read as a zip archive — skipped.`);
      continue;
    }
    const inner = Object.entries(members).map(([name, data]) => ({ name: `${f.name}/${name}`, data }));
    out.push(...expandArchives(inner, topWarnings, depth + 1));
  }
  return out;
}

export function parseAccuTimePack(
  inputFiles: PackFile[],
  opts: AccuTimeParseOptions = {},
): { sessions: AccuTimeSession[]; warnings: string[] } {
  const topWarnings: string[] = [];
  const all = expandArchives(inputFiles, topWarnings);

  // Path B: Compulink QDAT/EDAT text builds sessions directly. A lone
  // Class.ini / Drivers.dbf dropped alongside belongs to those sessions
  // (series header, race date, entry records) when no AccuTime timing files
  // came with them.
  const compulinkSessions: AccuTimeSession[] = [];
  const compulinkFiles = all.filter((f) => compulinkKind(f) !== null);
  let accuFiles = all.filter((f) => compulinkKind(f) === null);
  if (compulinkFiles.length > 0) {
    const hasAccuTiming = accuFiles.some((f) => isDatFile(f) || isQlyFile(f));
    let iniMeta: ClassIniInfo | null = null;
    let sharedDbfs: PackFile[] = [];
    if (!hasAccuTiming) {
      const ini = accuFiles.find(isIniFile);
      if (ini) iniMeta = parseClassIni(latin1(ini.data));
      sharedDbfs = accuFiles.filter(isDbfFile);
      accuFiles = [];
    }
    const built = buildCompulinkSessions(compulinkFiles, iniMeta, sharedDbfs, opts, topWarnings);
    for (const s of built) s.raceId = iniMeta?.raceId || null;
    compulinkSessions.push(...built);
  }

  const groups: SessionGroup[] = accuFiles.length
    ? splitLooseSessions(accuFiles, topWarnings, "uploaded files")
    : [];

  const sessions: AccuTimeSession[] = [...compulinkSessions];
  // Class folders named for their class (no Class.ini), reported once below.
  const fromFolders: string[] = [];

  for (const group of groups) {
    const warnings: string[] = [];
    const datFile = group.files.find(isDatFile);
    const qlyFile = group.files.find(isQlyFile);
    const iniFiles = group.files.filter(isIniFile);
    const iniFile = iniFiles.find((f) => /class/i.test(baseName(f.name))) || iniFiles[0];
    const dbfFile = group.files.find(isDbfFile);

    if (!datFile && !qlyFile) {
      topWarnings.push(
        `${group.label}: no AccuTime timing file found (race .dat / …dat.txt or .qly / …qly.txt) — nothing to read.`,
      );
      continue;
    }

    // AccuTime's race stamp names the text export's files; Class.ini keeps it
    // under [Race Date].
    const fileStamp = [datFile, qlyFile].map((f) => (f ? raceStampOf(baseName(f.name)) : null)).find(Boolean) || null;
    let ini: ClassIniInfo;
    if (iniFile) {
      ini = parseClassIni(latin1(iniFile.data));
      if (!ini.raceId && fileStamp) ini.raceId = fileStamp;
      if (!ini.raceDate && fileStamp) ini.raceDate = stampDate(fileStamp);
    } else {
      // No Class.ini (the text export never has one): the class comes from
      // the folder name, the race date from the stamp. The series title has
      // no source here — the page's sheet header supplies it.
      const folderCode = classCodeFromName(group.classHint);
      ini = {
        classCode: folderCode,
        raceDate: fileStamp ? stampDate(fileStamp) : null,
        seriesName: null,
        roundNumber: null,
        raceId: fileStamp,
      };
      if (folderCode) fromFolders.push(`${group.classHint} → ${folderCode}`);
      if (!fileStamp) warnings.push("No Class.ini and no race stamp in the file names — the race date is unknown.");
    }

    // Class.ini's own code wins, then the class folder's name; the user's
    // pick fills in only when neither gave one. Never "X" — that's the
    // schedule's Secure placeholder, and falling back to it printed X/SECURE
    // on every export of a classless session.
    const classCode = ini.classCode || (opts.classCode || "").trim().toUpperCase();
    const className = classCode ? CLASS_NAME_BY_CODE.get(classCode) || classCode : "UNKNOWN";
    if (!classCode) {
      warnings.push(
        `${group.label}: no class code found — Class.ini normally carries it in the [Menu] section (FC, TF, PS, …), and the folder name "${group.classHint}" isn't a class name. Pick the class on the page and rebuild, name the folder after the class, or add Class.ini to the upload.`,
      );
    }

    // Drivers.dbf: the session's own entry records.
    let drivers: EdataTechCard[] = [];
    if (dbfFile) {
      try {
        drivers = readDrivers(dbfFile.data, classCode, className);
      } catch (err) {
        warnings.push(
          `${dbfFile.name}: unreadable driver database (${err instanceof Error ? err.message : err}) — entry fields come from tech cards only.`,
        );
      }
    }

    // Logging: every pass.
    let logRows: LogRow[] = [];
    if (datFile) {
      try {
        logRows = readLogging(datFile.data);
      } catch (err) {
        warnings.push(
          `${datFile.name}: unreadable session database (${err instanceof Error ? err.message : err}) — no elimination rounds.`,
        );
      }
    }

    // Tree base from every RT in the session (Logging + .qly).
    const qlyRows = qlyFile ? readQlyRows(qlyFile.data) : [];
    const allRts = [
      ...logRows.map((r) => r.rtRaw).filter((r): r is number => r !== null),
      ...qlyRows.map((f) => num(f[15])).filter((r): r is number => r !== null && r > 0),
    ];
    const treeBase = inferTreeBase(allRts, warnings);
    const adjRt = (raw: number | null): number | null =>
      raw === null ? null : Math.round((raw - treeBase) * 10000) / 10000;

    // Finish line for the class: the deepest distance with any recorded time.
    const finish: 1320 | 1000 | 660 = logRows.some((r) => r.et1320 !== null)
      ? 1320
      : logRows.some((r) => r.et1000 !== null)
        ? 1000
        : 660;
    const finishEt = (r: LogRow) =>
      finish === 1320 ? r.et1320 : finish === 1000 ? r.et1000 : r.et660;
    const finishMph = (r: LogRow) =>
      finish === 1320 ? r.mph1320 : finish === 1000 ? r.mph1000 : r.mph660;

    // Qualifying order from .qly (row order = position).
    const qualifying: AccuTimeQualifier[] = qlyRows.map((f, i) => ({
      pos: i + 1,
      car_number: str(f[12]),
      name: str(f[11]),
      rt: adjRt(posOrNull(num(f[15]))),
      et: posOrNull(num(f[16])),
      mph: posOrNull(num(f[17])),
      bestSession: posOrNull(num(f[4])),
    }));
    const seedByCar = new Map(qualifying.map((q) => [q.car_number.toUpperCase(), q.pos]));

    // Split the log into qualifying sessions and elimination rounds.
    const { qual, elim } = splitQualElim(buildPasses(logRows), warnings);

    // Low ET / Top Speed across all qualifying passes (fall back to the .qly).
    let lowEt: AccuTimeSession["lowEt"] = null;
    let topSpeed: AccuTimeSession["topSpeed"] = null;
    const qualPassRows = [...qual.values()].flat(2).flatMap((p) => p.rows).filter((r) => !isByeRow(r));
    for (const r of qualPassRows) {
      const et = finishEt(r);
      const mph = finishMph(r);
      if (et !== null && (!lowEt || et < lowEt.et)) lowEt = { et, car: r.car, name: r.name };
      if (mph !== null && (!topSpeed || mph > topSpeed.mph)) topSpeed = { mph, car: r.car, name: r.name };
    }
    // The text export truncates Logging times to two decimals while the .qly
    // keeps them whole: when the low-ET car's .qly best is that same pass,
    // print the full figure (3.8599 → 3.860, not the truncated 3.850).
    if (lowEt) {
      const low = lowEt;
      const q = qualifying.find((x) => x.car_number.toUpperCase() === low.car.toUpperCase());
      if (q && q.et !== null && q.et >= low.et - 1e-9 && q.et - low.et < 0.01) lowEt = { ...low, et: q.et };
    }
    if (!lowEt && qualifying.length && qualifying[0].et !== null) {
      const q = qualifying[0];
      lowEt = { et: q.et!, car: q.car_number, name: q.name };
    }
    if (!topSpeed) {
      const best = qualifying.reduce<AccuTimeQualifier | null>(
        (a, q) => (q.mph !== null && (!a || q.mph > (a.mph ?? 0)) ? q : a),
        null,
      );
      if (best && best.mph !== null) topSpeed = { mph: best.mph, car: best.car_number, name: best.name };
    }

    // Per-session qualifying passes for the pro low-ET bonus: rounds in
    // ascending order, each qualifying session within a round in turn, best
    // finish-line ET per car.
    const qualSessionPasses: AccuTimeQualSessionData[] = [];
    {
      let sessionNo = 0;
      for (const rn of [...qual.keys()].sort((a, b) => a - b)) {
        for (const session of qual.get(rn)!) {
          sessionNo++;
          const bestByCar = new Map<string, { car_number: string; name: string; et: number | null }>();
          for (const pass of session) {
            for (const row of pass.rows) {
              if (isByeRow(row)) continue;
              const et = finishEt(row);
              const key = row.car.toUpperCase();
              const cur = bestByCar.get(key);
              if (!cur || (et !== null && (cur.et === null || et < cur.et))) {
                bestByCar.set(key, { car_number: row.car, name: row.name, et });
              }
            }
          }
          if (bestByCar.size > 0) qualSessionPasses.push({ session: sessionNo, passes: [...bestByCar.values()] });
        }
      }
    }

    // Elimination rounds → RunRows. Lane order within a pair is preserved for
    // the EDAT text; the pairs also carry winner-first copies for the PDFs.
    const season = opts.season || (ini.raceDate ? ini.raceDate.slice(0, 4) : "");
    const elimRoundNumbers = [...elim.keys()].sort((a, b) => a - b);
    const runs: AccuTimeSession["runs"] = [];
    const elimRounds: AccuTimeElimRound[] = [];

    elimRoundNumbers.forEach((rn, i) => {
      const passes = elim.get(rn)!;
      const isLast = i === elimRoundNumbers.length - 1;
      const realPairs = passes
        .map((p) => p.rows.filter((r) => !isByeRow(r)))
        .filter((rows) => rows.length > 0);
      // The last elim round is the final when one pairing settles it.
      const roundCode = isLast && realPairs.length === 1 && elimRoundNumbers.length > 1 ? "F" : `E${rn}`;
      const label = roundCode === "F" ? "FINALS" : `ROUND ${rn}`;
      const pairs: AccuTimePair[] = [];

      for (const rows of realPairs) {
        const toRun = (r: LogRow): Omit<RunRow, "id" | "created_at"> => ({
          timestamp: r.ts ? fmtTimestamp(r.ts) : null,
          round: roundCode,
          qual_pos: seedByCar.get(r.car.toUpperCase()) ?? null,
          car_number: r.car || null,
          name: r.name || null,
          member_number: null,
          class_index: null,
          rt: adjRt(r.rtRaw),
          ft60: r.ft60,
          ft330: r.ft330,
          ft660: r.et660,
          mph_660: r.mph660,
          ft1000: r.et1000,
          mph_1000: r.mph1000,
          // The class's finish-line numbers ride in the 1320 slots so the
          // EDAT builder prints them as the ET/MPH whatever the distance.
          ft1320: finish === 660 ? null : finishEt(r),
          mph_1320: finish === 660 ? null : finishMph(r),
          mov: r.margin,
          is_winner: rows.length === 1 ? 1 : r.winner ? 1 : 0,
          is_dq: 0,
          result: rows.length === 1 ? "W" : r.winner ? "W" : "L",
          place: null,
          category: className,
          lane: r.lane || null,
          dial_in: r.dial,
          event_code: opts.eventCode || null,
          event_name: opts.eventName || null,
          event_type: null,
          season: season || null,
          start_date: ini.raceDate,
          _ts_exact: true,
        });

        const pairRuns = rows.map(toRun);
        runs.push(...pairRuns);
        // PDFs list winners first, as the sheet's own note says.
        const winnerFirst = [...pairRuns].sort(
          (a, b) => (b.is_winner ? 1 : 0) - (a.is_winner ? 1 : 0),
        );
        pairs.push({ runs: winnerFirst, single: rows.length === 1 });
      }

      if (pairs.length) elimRounds.push({ round: roundCode, label, pairs });
    });

    sessions.push({
      classCode,
      className,
      raceDate: ini.raceDate,
      seriesName: ini.seriesName,
      treeBase,
      qualifying,
      qualSessions: qualSessionPasses.length,
      qualSessionPasses,
      runs,
      elimRounds,
      lowEt,
      topSpeed,
      drivers,
      warnings,
      raceId: ini.raceId,
      eventFolder: group.eventDir,
    });
  }

  if (fromFolders.length > 0) {
    topWarnings.push(
      `No Class.ini in the drop — classes named from their folders (${[...new Set(fromFolders)].join(", ")}); race dates from AccuTime's file stamps.`,
    );
  }

  if (sessions.length === 0) {
    topWarnings.push(
      "No AccuTime sessions found — upload AccuTime's unlocked text export (…dat.txt / …qly.txt / Driversdbf.txt, one folder per class) or the .dat / .qly / Class.ini / Drivers.dbf files from the session folder; a zip of either works. The .acc archive is password-locked and can't be read.",
    );
  }

  return { sessions, warnings: topWarnings };
}

// ——— Class-pack accumulation (v1.44.0) ———
// Mark drops classes one at a time (FC now, TF an hour later), so the client
// keeps every parsed session locally and posts the saved set back with each
// new drop. These helpers are the server side of that: merge the fresh parse
// into the saved pack by class, and re-validate what the browser sent.

/** Merge key for the class pack: the class code when known, else the name. */
export function accuSessionKey(s: Pick<AccuTimeSession, "classCode" | "className">): string {
  return (s.classCode || s.className || "UNKNOWN").trim().toUpperCase();
}

// ——— Events in one drop (v1.47.0) ———
// Mike's text exports come as one zip per email, often two race weekends in
// it. Merging both into the class pack would let one event's Top Fuel replace
// the other's, so the drop is split by event and the page asks which to build.

export interface AccuEventSummary {
  /** Stable id for the pick: "race:<stamp>" or "folder:<path>". */
  key: string;
  /** The event folder's name, else the race date. */
  label: string;
  raceDate: string | null;
  classes: string[];
}

export interface AccuEventGroup extends AccuEventSummary {
  sessions: AccuTimeSession[];
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "";
}

function summarizeEvent(sessions: AccuTimeSession[]): AccuEventSummary {
  const stamps = [...new Set(sessions.map((s) => s.raceId).filter((x): x is string => !!x))].sort();
  const folder = mostCommon(sessions.map((s) => s.eventFolder || "").filter(Boolean));
  const raceDate = sessions.map((s) => s.raceDate).filter((x): x is string => !!x).sort()[0] || null;
  return {
    key: stamps[0] ? `race:${stamps[0]}` : folder ? `folder:${folder}` : "all",
    label: folderLabel(folder) || (raceDate ? `Race of ${raceDate}` : "This drop"),
    raceDate,
    classes: sessions.map((s) => s.className),
  };
}

/**
 * Freshly parsed sessions split by event: two sessions are one event when
 * they share AccuTime's race stamp or sit in the same event folder. Sessions
 * with neither (Compulink text, files with no stamp) go with every event.
 * A single group means there is nothing to choose.
 */
export function accuEventGroups(sessions: AccuTimeSession[]): AccuEventGroup[] {
  const parent = sessions.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const firstBy = new Map<string, number>();
  sessions.forEach((s, i) => {
    for (const k of [s.raceId ? `race:${s.raceId}` : "", s.eventFolder ? `folder:${s.eventFolder}` : ""]) {
      if (!k) continue;
      const j = firstBy.get(k);
      if (j === undefined) firstBy.set(k, i);
      else parent[root(i)] = root(j);
    }
  });
  const anchored = new Map<number, AccuTimeSession[]>();
  const floating: AccuTimeSession[] = [];
  sessions.forEach((s, i) => {
    if (!s.raceId && !s.eventFolder) {
      floating.push(s);
      return;
    }
    const r = root(i);
    const list = anchored.get(r);
    if (list) list.push(s);
    else anchored.set(r, [s]);
  });
  if (anchored.size <= 1) return [{ ...summarizeEvent(sessions), sessions }];
  return [...anchored.values()]
    .map((list) => ({ ...summarizeEvent(list), sessions: [...list, ...floating] }))
    .sort((a, b) => (a.raceDate || "").localeCompare(b.raceDate || "") || a.label.localeCompare(b.label));
}

/**
 * A drop from a different race than the classes already in the pack (both
 * carry AccuTime race stamps and none match) — merging would mix two events'
 * classes, so the caller asks first. Null when they agree or can't be told.
 */
export function accuPackConflict(
  prior: AccuTimeSession[],
  fresh: AccuTimeSession[],
): { pack: AccuEventSummary; drop: AccuEventSummary } | null {
  const priorIds = new Set(prior.map((s) => s.raceId).filter((x): x is string => !!x));
  const freshIds = fresh.map((s) => s.raceId).filter((x): x is string => !!x);
  if (priorIds.size === 0 || freshIds.length === 0) return null;
  if (freshIds.some((id) => priorIds.has(id))) return null;
  return { pack: summarizeEvent(prior), drop: summarizeEvent(fresh) };
}

export interface AccuMergeInfo {
  /** Class names newly added to the pack by this drop. */
  added: string[];
  /** Class names already in the pack that this drop replaced. */
  replaced: string[];
}

/**
 * Merge freshly parsed sessions into the accumulated pack: a class already in
 * the pack is replaced by its new drop (in place, keeping its position),
 * everything else is kept — so uploading class B never wipes class A.
 */
export function mergeAccuTimeSessions(
  prior: AccuTimeSession[],
  fresh: AccuTimeSession[],
): { sessions: AccuTimeSession[]; merge: AccuMergeInfo } {
  const out = [...prior];
  const added: string[] = [];
  const replaced: string[] = [];
  for (const s of fresh) {
    const key = accuSessionKey(s);
    const i = out.findIndex((p) => accuSessionKey(p) === key);
    if (i >= 0) {
      out[i] = s;
      if (!replaced.includes(s.className)) replaced.push(s.className);
    } else {
      out.push(s);
      added.push(s.className);
    }
  }
  return { sessions: out, merge: { added, replaced } };
}

/**
 * Re-validate sessions the browser stored and posted back. The shape is our
 * own (the server produced it), so this only guards against a corrupt or
 * hand-edited store: wrong-typed fields fall back to empty defaults and
 * non-session entries are dropped.
 */
export function sanitizeAccuSessions(raw: unknown): AccuTimeSession[] {
  if (!Array.isArray(raw)) return [];
  const out: AccuTimeSession[] = [];
  for (const v of raw) {
    if (!v || typeof v !== "object") continue;
    const s = v as Partial<AccuTimeSession>;
    if (typeof s.className !== "string" || !s.className) continue;
    out.push({
      classCode: typeof s.classCode === "string" ? s.classCode : "",
      className: s.className,
      raceDate: typeof s.raceDate === "string" ? s.raceDate : null,
      seriesName: typeof s.seriesName === "string" ? s.seriesName : null,
      treeBase: typeof s.treeBase === "number" ? s.treeBase : 0.5,
      qualifying: Array.isArray(s.qualifying) ? s.qualifying : [],
      qualSessions: typeof s.qualSessions === "number" ? s.qualSessions : 0,
      qualSessionPasses: Array.isArray(s.qualSessionPasses) ? s.qualSessionPasses : [],
      runs: Array.isArray(s.runs) ? s.runs : [],
      elimRounds: Array.isArray(s.elimRounds) ? s.elimRounds : [],
      lowEt: s.lowEt && typeof s.lowEt === "object" ? s.lowEt : null,
      topSpeed: s.topSpeed && typeof s.topSpeed === "object" ? s.topSpeed : null,
      drivers: Array.isArray(s.drivers) ? s.drivers : [],
      warnings: Array.isArray(s.warnings) ? s.warnings.filter((w): w is string => typeof w === "string") : [],
      raceId: typeof s.raceId === "string" && s.raceId ? s.raceId : null,
      eventFolder: typeof s.eventFolder === "string" ? s.eventFolder : "",
    });
  }
  return out;
}

/**
 * Fill the page's class pick into STORED sessions that parsed without a code.
 * A fresh parse applies the pick inside parseAccuTimePack, but a rebuild from
 * the saved pack never re-parses — and the pick has to reach the runs'
 * category too, because that's what groups the EDAT files and names the
 * class's PDF pages.
 */
export function applyAccuClassPick(sessions: AccuTimeSession[], classCode: string): AccuTimeSession[] {
  const code = (classCode || "").trim().toUpperCase();
  if (!code) return sessions;
  return sessions.map((s) => {
    if (s.classCode) return s;
    const className = CLASS_NAME_BY_CODE.get(code) || code;
    const oldName = s.className;
    return {
      ...s,
      classCode: code,
      className,
      runs: s.runs.map((r) => (r.category === oldName ? { ...r, category: className } : r)),
      drivers: s.drivers.map((d) => ({
        ...d,
        category: d.category || code,
        class_name: d.class_name === oldName ? className : d.class_name,
      })),
    };
  });
}
