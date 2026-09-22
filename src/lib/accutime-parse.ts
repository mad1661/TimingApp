import type { RunRow } from "./db";
import { RACE_CLASSES } from "./schedule-classes";

/**
 * AccuTime native session files → structures the CompuLink exporters and the
 * PDFs can use. An AccuTime session covers ONE class and ships as a set:
 *
 *   race.qly    — plain CSV qualifying list, one row per qualifier, already in
 *                 qualifying order (best first)
 *   race.dat    — "Standard Jet DB" (MS Access) with a `Logging` table: one row
 *                 per car per pass — qualifying sessions (RaceType 0) and
 *                 elimination rounds (RaceType 1) — with lanes, winner flags,
 *                 dial-ins, splits and real timestamps (parsed server-side by
 *                 accutime-dat.ts; this file is client-safe)
 *   Class.ini   — class code ([Menu] 11), series name ([Reports] 7), race date
 *                 ([Race Date] 0 = yyyymmddhhmmss), session count ([Round Number])
 *   race.acc    — password-encrypted zip of the set (not readable)
 *   Drivers.dbf — Jet DB driver directory (optional)
 *
 * Verified against a real US 131 Funny Car session (2026-09-18) whose
 * CompuLink C2EDAT.TXT conversion was available as ground truth.
 */

// ——— race.qly ———

export interface QlyEntry {
  /** 1-based file order — the qualifying position. */
  position: number;
  driver: string;
  car: string;
  /** Raw reaction time, tree-inclusive (0.434 on a pro tree = .034). */
  rt: number | null;
  et: number | null;
  mph: number | null;
  /** Session the best run came from (col 4), when present. */
  bestSession: number | null;
  /** Total sessions (col 5), when present. */
  totalSessions: number | null;
}

/** Split one CSV line honoring double-quoted fields (the .qly quotes text cols). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function qlyNum(s: string | undefined): number | null {
  const n = parseFloat((s || "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Parse a .qly qualifying list. Columns (0-based) in the AccuTime export:
 * 11 = driver full name, 12 = car number, 15 = RT (raw), 16 = ET, 17 = MPH;
 * 4 = session of best run, 5 = total sessions. Rows are already in
 * qualifying order, best first.
 */
export function parseQly(text: string): QlyEntry[] {
  const entries: QlyEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\u001a/g, "").trim();
    if (!line) continue;
    const f = splitCsvLine(line);
    if (f.length < 18) continue;
    const driver = (f[11] || "").trim();
    const car = (f[12] || "").trim();
    if (!driver && !car) continue;
    entries.push({
      position: entries.length + 1,
      driver,
      car,
      rt: qlyNum(f[15]),
      et: qlyNum(f[16]),
      mph: qlyNum(f[17]),
      bestSession: qlyNum(f[4]) !== null ? Math.round(qlyNum(f[4])!) : null,
      totalSessions: qlyNum(f[5]) !== null ? Math.round(qlyNum(f[5])!) : null,
    });
  }
  return entries;
}

/** A .qly is 18+ comma fields with quoted driver/car columns — cheap sniff. */
export function looksLikeQly(text: string): boolean {
  const first = text.split(/\r?\n/).find((l) => l.trim());
  if (!first) return false;
  const f = splitCsvLine(first.trim());
  return f.length >= 18 && !!(f[11] || "").trim();
}

// ——— Class.ini ———

export interface ClassIniMeta {
  /** [Menu] 11 — the class code the timing system was set to (FC, TF, SS…). */
  classCode: string;
  /** [Reports] 7 — series / event name. */
  seriesName: string;
  /** [Race Date] 0 as an ISO date (yyyy-mm-dd), when present. */
  raceDate: string;
  /** [Round Number] 0 — how many qualifying sessions were configured. */
  sessions: number | null;
}

export function parseClassIni(text: string): ClassIniMeta {
  let section = "";
  const values: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) {
      section = sec[1].toLowerCase();
      continue;
    }
    const kv = line.match(/^([^=]+)=(.*)$/);
    if (kv) values[`${section}|${kv[1].trim()}`] = kv[2].trim();
  }
  const rawDate = values["race date|0"] || "";
  const dm = rawDate.match(/^(\d{4})(\d{2})(\d{2})/);
  const sessions = parseInt(values["round number|0"] || "", 10);
  return {
    classCode: (values["menu|11"] || "").toUpperCase(),
    seriesName: values["reports|7"] || "",
    raceDate: dm ? `${dm[1]}-${dm[2]}-${dm[3]}` : "",
    sessions: Number.isFinite(sessions) && sessions > 0 ? sessions : null,
  };
}

/** "FC" → "FUNNY CAR" via the schedule class table; unknown codes echo back. */
export function classNameFromCode(code: string): string {
  const c = (code || "").trim().toUpperCase();
  const hit = RACE_CLASSES.find((rc) => rc.code.toUpperCase() === c);
  return hit ? hit.name.toUpperCase() : c;
}

export function fieldSizeForClassName(name: string): number | null {
  const n = (name || "").trim().toUpperCase();
  const hit = RACE_CLASSES.find((rc) => rc.name.toUpperCase() === n);
  return hit?.fieldSize ?? null;
}

// ——— race.dat Logging rows (produced by accutime-dat.ts, consumed here) ———

/** One `Logging` row from race.dat, JSON-safe (timestamp as ISO string). */
export interface AccutimeRun {
  runNumber: number;
  roundNumber: number;
  /** 0 = qualifying session, 1 = eliminations. */
  raceType: number;
  /** 0 = pro tree (0.4 base); anything else is treated as a 0.5 full tree. */
  treeType: number;
  winner: boolean;
  lane: string;
  carNumber: string;
  name: string;
  dialIn: number | null;
  /** Raw tree-inclusive reaction time (0.4237 on a pro tree = .024). */
  rtRaw: number | null;
  ft60: number | null;
  ft330: number | null;
  et18: number | null;
  mph18: number | null;
  et1000: number | null;
  mph1000: number | null;
  et14: number | null;
  mph14: number | null;
  /** ISO timestamp of the pair (both cars in a pair share it). */
  timestamp: string;
}

export type AccutimeFinish = "quarter" | "thousand" | "eighth";

/**
 * Which distance is the finish line for this class: quarter when any pass has
 * 1320 data, the 1000' cone when any pass has it (nitro), else the eighth.
 */
export function detectFinish(runs: AccutimeRun[]): AccutimeFinish {
  if (runs.some((r) => (r.et14 ?? 0) > 0 || (r.mph14 ?? 0) > 0)) return "quarter";
  if (runs.some((r) => (r.et1000 ?? 0) > 0 || (r.mph1000 ?? 0) > 0)) return "thousand";
  return "eighth";
}

function fmt2(n: number): string {
  return String(n).padStart(2, "0");
}

/** ISO → the app's timestamp format ("9/21/2026 11:36:58 AM"), wall-clock. */
function isoToAppTimestamp(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return iso;
  const [, y, mo, d, hh, mm, ss] = m;
  let hour = parseInt(hh, 10);
  const ap = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  return `${parseInt(mo, 10)}/${parseInt(d, 10)}/${y} ${hour}:${fmt2(parseInt(mm, 10))}:${fmt2(parseInt(ss, 10))} ${ap}`;
}

export interface RunRowMappingOptions {
  /** Class name for the category field (e.g. "FUNNY CAR"). */
  category: string;
  /**
   * Tree base subtracted from the raw RT (AccuTime logs tree-inclusive RTs;
   * CompuLink prints from green). 0.4 pro tree, 0.5 full tree, 0 to keep raw.
   */
  treeBase: number;
  /** Car number → qualifying position (from the .qly), stamped on elim rows. */
  qualPosByCar?: Map<string, number>;
}

export function defaultTreeBase(runs: AccutimeRun[]): number {
  const withTree = runs.filter((r) => (r.rtRaw ?? 0) > 0);
  if (withTree.length === 0) return 0.4;
  return withTree.every((r) => r.treeType === 0) ? 0.4 : 0.5;
}

function adjRt(rtRaw: number | null, treeBase: number): number | null {
  if (rtRaw === null || rtRaw <= 0) return null;
  return Math.round((rtRaw - treeBase) * 10000) / 10000;
}

/**
 * Map AccuTime Logging rows to the app's RunRow shape (in-memory only — these
 * feed buildEdataExport / buildQdatExport, they are never stored). Qualifying
 * sessions become Q1…Qn, elimination rounds E1…En, and the last elimination
 * round becomes F when it holds a single pairing. BYE lane rows are dropped —
 * the lone real car in the pairing is what marks the bye (SINGLE) downstream.
 * The finish-line ET/MPH goes into ft1320/mph_1320 (or ft660 for a genuine
 * eighth-mile class), which is where every downstream consumer looks for it.
 */
export function accutimeRunsToRunRows(runs: AccutimeRun[], opts: RunRowMappingOptions): RunRow[] {
  const finish = detectFinish(runs);
  const rows: RunRow[] = [];

  for (const r of runs) {
    const car = (r.carNumber || "").trim();
    if (!car || car.toUpperCase() === "BYE") continue;

    const round = r.raceType === 1 ? `E${r.roundNumber}` : `Q${r.roundNumber}`;
    const et14 = (r.et14 ?? 0) > 0 ? r.et14 : null;
    const mph14 = (r.mph14 ?? 0) > 0 ? r.mph14 : null;
    const et1000 = (r.et1000 ?? 0) > 0 ? r.et1000 : null;
    const mph1000 = (r.mph1000 ?? 0) > 0 ? r.mph1000 : null;
    const et18 = (r.et18 ?? 0) > 0 ? r.et18 : null;
    const mph18 = (r.mph18 ?? 0) > 0 ? r.mph18 : null;

    let ft1320: number | null = null;
    let mph1320: number | null = null;
    let ft660 = et18;
    let mph660 = mph18;
    if (finish === "quarter") {
      ft1320 = et14;
      mph1320 = mph14;
    } else if (finish === "thousand") {
      // Nitro classes finish at the 1000' cone; the app (and the EDAT format)
      // put the finish ET/MPH in the ET columns, so map it there.
      ft1320 = et1000;
      mph1320 = mph1000;
    } else {
      ft660 = et18;
      mph660 = mph18;
    }

    rows.push({
      timestamp: isoToAppTimestamp(r.timestamp),
      round,
      qual_pos: opts.qualPosByCar?.get(car.toUpperCase()) ?? null,
      car_number: car,
      name: (r.name || "").trim() || null,
      member_number: null,
      class_index: null,
      rt: adjRt(r.rtRaw, opts.treeBase),
      ft60: (r.ft60 ?? 0) > 0 ? r.ft60 : null,
      ft330: (r.ft330 ?? 0) > 0 ? r.ft330 : null,
      ft660,
      mph_660: mph660,
      ft1000: et1000,
      mph_1000: mph1000,
      ft1320,
      mph_1320: mph1320,
      mov: null,
      is_winner: r.winner ? 1 : 0,
      is_dq: 0,
      result: r.winner ? "W" : "L",
      place: null,
      category: opts.category,
      lane: (r.lane || "").trim() || null,
      dial_in: (r.dialIn ?? 0) > 0 ? r.dialIn : null,
      event_code: null,
      event_name: null,
      event_type: null,
      season: null,
      start_date: null,
    });
  }

  // The last elimination round is the final when a single pairing ran it.
  const elimRounds = [...new Set(rows.filter((row) => /^E\d+$/.test(row.round!)).map((row) => row.round!))];
  if (elimRounds.length > 1) {
    const last = elimRounds.sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10))[elimRounds.length - 1];
    const lastRows = rows.filter((row) => row.round === last);
    const pairings = new Set(lastRows.map((row) => row.timestamp));
    if (pairings.size === 1) {
      for (const row of lastRows) row.round = "F";
    }
  }

  return rows;
}

/**
 * Per-car index/dial from the qualifying sessions in the .dat (latest session
 * wins) — this is what fills the QDAT Index column for dial/index classes.
 */
export function indexByCarFromQualRuns(runs: AccutimeRun[]): Map<string, number> {
  const out = new Map<string, number>();
  const qual = runs
    .filter((r) => r.raceType === 0 && (r.dialIn ?? 0) > 0 && (r.carNumber || "").trim())
    .sort((a, b) => b.roundNumber - a.roundNumber);
  for (const r of qual) {
    const key = r.carNumber.trim().toUpperCase();
    if (!out.has(key)) out.set(key, r.dialIn!);
  }
  return out;
}

/**
 * Qualifying list derived from the .dat sessions — the fallback when no .qly
 * was uploaded. Best ET per car across Q sessions, ordered by furthest under
 * the index when the class has dials, else quickest ET (MPH tiebreak).
 */
export function qualifyingFromDatRuns(runs: AccutimeRun[]): QlyEntry[] {
  const qual = runs.filter(
    (r) => r.raceType === 0 && (r.carNumber || "").trim() && (r.carNumber || "").trim().toUpperCase() !== "BYE",
  );
  const finish = detectFinish(qual);
  const idx = indexByCarFromQualRuns(runs);
  const sessions = new Set(qual.map((r) => r.roundNumber));

  interface Best {
    car: string;
    driver: string;
    rt: number | null;
    et: number | null;
    mph: number | null;
    session: number;
  }
  const bestByCar = new Map<string, Best>();
  for (const r of qual) {
    const key = r.carNumber.trim().toUpperCase();
    const et =
      finish === "quarter" ? r.et14 : finish === "thousand" ? r.et1000 : r.et18;
    const mph =
      finish === "quarter" ? r.mph14 : finish === "thousand" ? r.mph1000 : r.mph18;
    const cand: Best = {
      car: r.carNumber.trim(),
      driver: (r.name || "").trim(),
      rt: r.rtRaw,
      et: (et ?? 0) > 0 ? et : null,
      mph: (mph ?? 0) > 0 ? mph : null,
      session: r.roundNumber,
    };
    const prev = bestByCar.get(key);
    if (!prev) {
      bestByCar.set(key, cand);
      continue;
    }
    const better =
      cand.et !== null &&
      (prev.et === null || cand.et < prev.et || (cand.et === prev.et && (cand.mph ?? 0) > (prev.mph ?? 0)));
    if (better) bestByCar.set(key, cand);
  }

  const list = [...bestByCar.entries()].sort(([keyA, a], [keyB, b]) => {
    const ia = idx.get(keyA) ?? null;
    const ib = idx.get(keyB) ?? null;
    const ovA = a.et !== null ? a.et - (ia ?? 0) : Infinity;
    const ovB = b.et !== null ? b.et - (ib ?? 0) : Infinity;
    if (ovA !== ovB) return ovA - ovB;
    return (b.mph ?? 0) - (a.mph ?? 0);
  });

  return list.map(([, b], i) => ({
    position: i + 1,
    driver: b.driver,
    car: b.car,
    rt: b.rt,
    et: b.et,
    mph: b.mph,
    bestSession: b.session,
    totalSessions: sessions.size || null,
  }));
}
