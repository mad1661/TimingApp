import { unzipSync } from "fflate";
import MDBReader from "mdb-reader";
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

export interface AccuTimeSession {
  classCode: string;
  className: string;
  /** YYYY-MM-DD */
  raceDate: string | null;
  seriesName: string | null;
  treeBase: number;
  qualifying: AccuTimeQualifier[];
  qualSessions: number;
  /** All elimination passes, EDAT/RunRow-shaped (lane order preserved). */
  runs: Omit<RunRow, "id" | "created_at">[];
  elimRounds: AccuTimeElimRound[];
  lowEt: { et: number; car: string; name: string } | null;
  topSpeed: { mph: number; car: string; name: string } | null;
  /** Entry records from Drivers.dbf, in the tech-card shape. */
  drivers: EdataTechCard[];
  warnings: string[];
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

/** Minimal CSV splitter for the .qly rows (quoted fields, no embedded commas seen). */
function splitCsv(line: string): string[] {
  return line.split(",").map((f) => f.trim().replace(/^"(.*)"$/, "$1"));
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
  for (const v of values("race date")) {
    const m = v.match(/^(\d{4})(\d{2})(\d{2})/);
    if (m) {
      raceDate = `${m[1]}-${m[2]}-${m[3]}`;
      break;
    }
  }

  // [Reports] holds the series title among numeric knobs.
  const seriesName = values("reports").find((v) => /[A-Za-z].*\s/.test(v)) || null;

  const roundNumber = num(values("round number")[0] ?? null);

  return { classCode, raceDate, seriesName, roundNumber };
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

function readLogging(data: Uint8Array): LogRow[] {
  const reader = new MDBReader(toBuffer(data));
  const names = reader.getTableNames();
  const tableName = names.find((n) => n.toLowerCase() === "logging") || names[0];
  if (!tableName) return [];
  const rows = reader.getTable(tableName).getData();
  return rows.map((r) => ({
    runNumber: num(r["RunNumber"]) ?? 0,
    roundNumber: num(r["RoundNumber"]) ?? 0,
    winner: r["WinnerFlag"] === true || r["WinnerFlag"] === 1,
    lane: str(r["Lane"]).toUpperCase(),
    car: str(r["CarNumber"]),
    // Despite the column name, AccuTime puts the whole driver name here.
    name: str(r["LastName"]),
    dial: posOrNull(num(r["DialIn"])),
    rtRaw: posOrNull(num(r["ReactionTime"])),
    ft60: posOrNull(num(r["ft60"])),
    ft330: posOrNull(num(r["ft330"])),
    et660: posOrNull(num(r["et18"])),
    mph660: posOrNull(num(r["mph18"])),
    et1000: posOrNull(num(r["et1000"])),
    mph1000: posOrNull(num(r["mph1000"])),
    et1320: posOrNull(num(r["et14"])),
    mph1320: posOrNull(num(r["mph14"])),
    margin: posOrNull(num(r["Margin"])),
    ts: r["TimeStamp"] instanceof Date ? (r["TimeStamp"] as Date) : null,
  }));
}

function posOrNull(n: number | null): number | null {
  return n !== null && n > 0 ? n : null;
}

function isByeRow(r: LogRow): boolean {
  return /^BYE$/i.test(r.car) || (!r.car && !r.name);
}

// ——— Drivers table ———

function readDrivers(data: Uint8Array, classCode: string, className: string): EdataTechCard[] {
  const reader = new MDBReader(toBuffer(data));
  const names = reader.getTableNames();
  const tableName = names.find((n) => n.toLowerCase() === "drivers") || names[0];
  if (!tableName) return [];
  const rows = reader.getTable(tableName).getData();
  return rows
    .map((d) => {
      const make = str(d["MakeOfCar"]);
      // MakeOfCar carries the two-digit body year; a non-numeric value is a
      // real make and belongs in front of the model.
      const yearish = /^\d{2,4}$/.test(make);
      return {
        car_number: str(d["CarNumber"]),
        first_name: str(d["FirstName"]),
        last_name: str(d["LastName"]),
        city: str(d["City"]),
        state: str(d["State"]),
        category: str(d["IndexClass"]) || classCode,
        class_name: className,
        engine_make: str(d["EngineMake"]),
        body_type: [yearish ? "" : make, str(d["ModelOfCar"])].filter(Boolean).join(" "),
        body_year: yearish ? make : "",
        cu_cc: str(d["CuIn"]),
        member_number: str(d["Membership"]),
        hp: str(d["AdvertisedHP"]),
        factored_hp: str(d["FactoredHP"]),
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

/**
 * Split each round's passes into qualifying sessions and the elimination
 * round. Multiple date clusters per round: the last is the elim round. A
 * single cluster everywhere: the ladder test decides whether the file holds
 * eliminations or only qualifying.
 */
function splitQualElim(
  passesByRound: Map<number, Pass[]>,
  warnings: string[],
): { qual: Map<number, Pass[][]>; elim: Map<number, Pass[]> } {
  const qual = new Map<number, Pass[][]>();
  const elim = new Map<number, Pass[]>();

  const roundNumbers = [...passesByRound.keys()].sort((a, b) => a - b);
  if (roundNumbers.length === 0) return { qual, elim };
  const anyMultiCluster = roundNumbers.some((rn) => {
    const dates = new Set(passesByRound.get(rn)!.map((p) => dateKey(p.ts)));
    return dates.size > 1;
  });

  if (anyMultiCluster) {
    for (const rn of roundNumbers) {
      const passes = passesByRound.get(rn)!;
      const clusters = new Map<string, Pass[]>();
      for (const p of passes) {
        const k = dateKey(p.ts);
        const list = clusters.get(k);
        if (list) list.push(p);
        else clusters.set(k, [p]);
      }
      const dates = [...clusters.keys()].sort();
      if (dates.length === 1) {
        // Every other round split by date but this one didn't — say so
        // rather than silently guessing which side it belongs to.
        warnings.push(
          `Round ${rn}: qualifying and eliminations could not be separated by date — treated as the elimination round. Check the output.`,
        );
        elim.set(rn, clusters.get(dates[0])!);
        continue;
      }
      elim.set(rn, clusters.get(dates[dates.length - 1])!);
      qual.set(
        rn,
        dates.slice(0, -1).map((d) => clusters.get(d)!),
      );
    }
    return { qual, elim };
  }

  // Single cluster per round: eliminations look like a ladder (round N+1's
  // cars are round N's winners); qualifying doesn't (everyone runs again).
  let ladderLike = roundNumbers.length > 1;
  for (let i = 1; i < roundNumbers.length && ladderLike; i++) {
    const prev = passesByRound.get(roundNumbers[i - 1])!;
    const next = passesByRound.get(roundNumbers[i])!;
    const winners = new Set(
      prev.flatMap((p) => p.rows.filter((r) => r.winner && !isByeRow(r)).map((r) => r.car)),
    );
    const cars = next.flatMap((p) => p.rows.filter((r) => !isByeRow(r)).map((r) => r.car));
    const fromWinners = cars.filter((c) => winners.has(c)).length;
    if (cars.length > 0 && fromWinners / cars.length < 0.8) ladderLike = false;
  }
  if (roundNumbers.length === 1) {
    // One lone round: a full field with byes reads as eliminations underway;
    // there is no second round to test against, so say what was assumed.
    warnings.push(
      "Only one round in the session and no date split — treated as an elimination round in progress.",
    );
    ladderLike = true;
  }

  if (ladderLike) {
    for (const rn of roundNumbers) elim.set(rn, passesByRound.get(rn)!);
  } else {
    warnings.push(
      "The session's rounds re-run the same cars (no elimination ladder) — treated as qualifying sessions only; no EDAT rounds.",
    );
    for (const rn of roundNumbers) qual.set(rn, [passesByRound.get(rn)!]);
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
  const base = name.split(/[\\/]/).pop() || name;
  let stem = base.replace(/\.[^.]+$/, "").toLowerCase();
  stem = stem.replace(/(^|[-_ .])class(?=[-_ .]|$)/g, "$1");
  return stem.replace(/^[-_ .]+|[-_ .]+$/g, "");
}

const GENERIC_STEMS = new Set(["", "race", "drivers", "driver"]);

function isIdentifying(stem: string): boolean {
  return !GENERIC_STEMS.has(stem);
}

function isDatFile(f: PackFile): boolean {
  return /\.dat$/i.test(f.name) && isJetDb(f.data);
}
function isQlyFile(f: PackFile): boolean {
  return /\.qly$/i.test(f.name);
}
function isIniFile(f: PackFile): boolean {
  return /\.ini$/i.test(f.name);
}
function isDbfFile(f: PackFile): boolean {
  return /\.dbf$/i.test(f.name) || /drivers/i.test(f.name.split(/[\\/]/).pop() || "");
}

/** The class codes a Drivers db mentions (IndexClass) — a pairing signal. */
function dbfClassCodes(data: Uint8Array): Set<string> {
  const out = new Set<string>();
  try {
    const reader = new MDBReader(toBuffer(data));
    const names = reader.getTableNames();
    const tableName = names.find((n) => n.toLowerCase() === "drivers") || names[0];
    if (!tableName) return out;
    for (const row of reader.getTable(tableName).getData()) {
      const c = String(row["IndexClass"] ?? "").trim().toUpperCase();
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
    const norm = f.name.replace(/\\/g, "/");
    const dir = norm.includes("/") ? norm.slice(0, norm.lastIndexOf("/")) : "";
    const list = byDir.get(dir);
    if (list) list.push(f);
    else byDir.set(dir, [f]);
  }
  const groups: SessionGroup[] = [];
  for (const [dir, bucket] of byDir) {
    const label = dir ? `${baseLabel} · ${dir}` : baseLabel;
    groups.push(...splitBucket(bucket, label, topWarnings));
  }
  return groups;
}

function splitBucket(bucket: PackFile[], label: string, topWarnings: string[]): SessionGroup[] {
  const dats = bucket.filter(isDatFile);
  const qlys = bucket.filter((f) => isQlyFile(f) && !isDatFile(f));
  const inis = bucket.filter((f) => isIniFile(f) && !isDatFile(f) && !isQlyFile(f));
  const dbfs = bucket.filter((f) => isDbfFile(f) && !isDatFile(f) && !isQlyFile(f) && !isIniFile(f));

  // One class at most — the whole bucket is one session, exactly as before.
  if (dats.length <= 1 && qlys.length <= 1 && inis.length <= 1 && dbfs.length <= 1) {
    return [{ label, files: bucket }];
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
  }));
}

// ——— Compulink QDAT/EDAT text ingest (path B) ———
//
// Tracks that already hold Compulink text can skip the AccuTime conversion:
// dropping C#QDAT.TXT + C#EDAT.TXT builds the same package (PDFs, points,
// re-emitted QDAT/EDAT) through the same session pipeline.

function compulinkKind(f: PackFile): "qdat" | "edat" | null {
  if (!/\.txt$/i.test(f.name)) return null;
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
      if (!isJetDb(dbf.data)) continue;
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

export function parseAccuTimePack(
  inputFiles: PackFile[],
  opts: AccuTimeParseOptions = {},
): { sessions: AccuTimeSession[]; warnings: string[] } {
  const topWarnings: string[] = [];

  // Expand .acc / .zip archives; members keep the archive name as a path
  // prefix so the folder-based session grouping sees each zip as a folder.
  const all: PackFile[] = [];
  for (const f of inputFiles) {
    if (isZip(f.data)) {
      if (isEncryptedZip(f.data)) {
        // AccuTime's .acc uses a password only its own software knows, so it
        // can't be opened here — the loose files carry the same data.
        topWarnings.push(
          `${f.name}: this .acc archive is password-protected and can't be opened. Export/unzip it in AccuTime and upload the .dat, .qly, Class.ini and Drivers.dbf files instead.`,
        );
        continue;
      }
      try {
        const members = unzipSync(f.data);
        for (const [name, data] of Object.entries(members)) {
          if (!name.endsWith("/")) all.push({ name: `${f.name}/${name}`, data });
        }
      } catch {
        topWarnings.push(`${f.name}: could not be read as a zip archive — skipped.`);
      }
    } else {
      all.push(f);
    }
  }

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
      sharedDbfs = accuFiles.filter((f) => isDbfFile(f) && !isIniFile(f));
      accuFiles = [];
    }
    compulinkSessions.push(...buildCompulinkSessions(compulinkFiles, iniMeta, sharedDbfs, opts, topWarnings));
  }

  const groups: SessionGroup[] = accuFiles.length
    ? splitLooseSessions(accuFiles, topWarnings, "uploaded files")
    : [];

  const sessions: AccuTimeSession[] = [...compulinkSessions];

  for (const group of groups) {
    const warnings: string[] = [];
    const find = (re: RegExp) => group.files.find((f) => re.test(f.name));
    const datFile = group.files.find(isDatFile);
    const qlyFile = find(/\.qly$/i);
    const iniFile = find(/class\.ini$/i) || find(/\.ini$/i);
    const dbfFile = group.files.find(
      (f) => isDbfFile(f) && !isDatFile(f) && !isQlyFile(f) && !isIniFile(f),
    );

    if (!datFile && !qlyFile) {
      topWarnings.push(
        `${group.label}: no AccuTime .dat or .qly found — nothing to read.`,
      );
      continue;
    }

    const ini = iniFile
      ? parseClassIni(latin1(iniFile.data))
      : { classCode: "", raceDate: null, seriesName: null, roundNumber: null };
    if (!iniFile) warnings.push("No Class.ini — the race date is unknown.");

    // Class.ini's own code wins; the user's pick fills in only when the ini
    // gave nothing. Never "X" — that's the schedule's Secure placeholder, and
    // falling back to it printed X/SECURE on every export of a classless
    // session.
    const classCode = ini.classCode || (opts.classCode || "").trim().toUpperCase();
    const className = classCode ? CLASS_NAME_BY_CODE.get(classCode) || classCode : "UNKNOWN";
    if (!classCode) {
      warnings.push(
        `${group.label}: no class code found — Class.ini normally carries it in the [Menu] section (FC, TF, PS, …). Pick the class on the page and rebuild, or add Class.ini to the upload.`,
      );
    }

    // Drivers.dbf: the session's own entry records.
    let drivers: EdataTechCard[] = [];
    if (dbfFile && isJetDb(dbfFile.data)) {
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
    const qlyLines = qlyFile
      ? latin1(qlyFile.data)
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
      : [];
    const qlyRows = qlyLines.map(splitCsv).filter((f) => f.length >= 18 && (f[12] || f[11]));
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
    const qualSessions = Math.max(0, ...[...qual.values()].map((clusters) => clusters.length));

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
      qualSessions,
      runs,
      elimRounds,
      lowEt,
      topSpeed,
      drivers,
      warnings,
    });
  }

  if (sessions.length === 0) {
    topWarnings.push(
      "No AccuTime sessions found — upload the .dat / .qly / Class.ini / Drivers.dbf files from the session folder (the .acc archive is password-locked and can't be read).",
    );
  }

  return { sessions, warnings: topWarnings };
}
