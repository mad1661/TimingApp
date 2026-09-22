import { unzipSync } from "fflate";
import MDBReader from "mdb-reader";
import type { RunRow } from "./db";
import type { EdataTechCard } from "./edata-export";
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

const CLASS_NAME_BY_CODE = new Map<string, string>();
for (const c of RACE_CLASSES) {
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

  // The class code is the one [Menu] value that's letters, not a number.
  const classCode =
    values("menu")
      .map((v) => v.toUpperCase())
      .find((v) => /^[A-Z][A-Z0-9/]{0,5}$/.test(v) && !/^\d+$/.test(v)) || "";

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

export function parseAccuTimePack(
  inputFiles: PackFile[],
  opts: AccuTimeParseOptions = {},
): { sessions: AccuTimeSession[]; warnings: string[] } {
  const topWarnings: string[] = [];

  // Expand .acc / .zip archives; each archive is its own session group, and
  // any loose files form one more.
  const groups: { label: string; files: PackFile[] }[] = [];
  const loose: PackFile[] = [];
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
        const files = Object.entries(members)
          .filter(([name]) => !name.endsWith("/"))
          .map(([name, data]) => ({ name, data }));
        groups.push({ label: f.name, files });
      } catch {
        topWarnings.push(`${f.name}: could not be read as a zip archive — skipped.`);
      }
    } else {
      loose.push(f);
    }
  }
  if (loose.length) groups.push({ label: "uploaded files", files: loose });

  const sessions: AccuTimeSession[] = [];

  for (const group of groups) {
    const warnings: string[] = [];
    const find = (re: RegExp) => group.files.find((f) => re.test(f.name));
    const datFile = group.files.find((f) => /\.dat$/i.test(f.name) && isJetDb(f.data));
    const qlyFile = find(/\.qly$/i);
    const iniFile = find(/class\.ini$/i) || find(/\.ini$/i);
    const dbfFile = group.files.find(
      (f) => /\.dbf$/i.test(f.name) || /drivers/i.test(f.name),
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
    if (!iniFile) warnings.push("No Class.ini — class code and race date are unknown; set the class by hand if it reads wrong.");

    const classCode = ini.classCode || "X";
    const className = CLASS_NAME_BY_CODE.get(classCode) || classCode;

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
    topWarnings.push("No AccuTime sessions found — upload the .acc archive or the .dat/.qly/Class.ini files.");
  }

  return { sessions, warnings: topWarnings };
}
