import type { AccuTimeSession } from "./accutime";
import type { EdataTechCard } from "./edata-export";

/**
 * NHRA points scoring for AccuTime sessions, ported from Mark's points-calc
 * playground (markdawson-playground.web.app/points-calc) so the numbers match
 * that app exactly — don't tune these tables here without changing them there.
 *
 * Scope: Alcohol and below. Pro categories (TF, FC, PS, PSM, …) are skipped
 * for points on purpose — their QDAT/EDAT/PDF exports still build.
 *
 * This module is pure (type-only imports) so the client can rebuild the
 * points files after deductions without another server round-trip.
 */

export interface PointsBracket {
  minSize: number;
  maxSize: number;
  /** Round number → points for LOSING that round. */
  rounds: Record<number, number>;
  runnerUp: number;
  winner: number;
}

// Default NHRA sportsman structure by field size (points-calc
// DEFAULT_POINTS_STRUCTURE).
export const DEFAULT_POINTS_BRACKETS: PointsBracket[] = [
  { minSize: 1, maxSize: 4, rounds: { 1: 33 }, runnerUp: 64, winner: 85 },
  { minSize: 5, maxSize: 8, rounds: { 1: 32, 2: 43 }, runnerUp: 64, winner: 85 },
  { minSize: 9, maxSize: 16, rounds: { 1: 31, 2: 42, 3: 53 }, runnerUp: 64, winner: 85 },
  { minSize: 17, maxSize: 32, rounds: { 1: 30, 2: 41, 3: 52, 4: 63 }, runnerUp: 74, winner: 95 },
  { minSize: 33, maxSize: 64, rounds: { 1: 30, 2: 40, 3: 51, 4: 62, 5: 73 }, runnerUp: 84, winner: 105 },
  { minSize: 65, maxSize: 128, rounds: { 1: 30, 2: 40, 3: 50, 4: 61, 5: 72, 6: 83 }, runnerUp: 94, winner: 105 },
  { minSize: 129, maxSize: 999, rounds: { 1: 30, 2: 40, 3: 50, 4: 60, 5: 71, 6: 82, 7: 93 }, runnerUp: 104, winner: 115 },
];

// Top Alcohol (TAD/TAFC) fixed brackets — the sportsman table NEVER applies
// to alcohol (points-calc ALCOHOL_POINTS_BRACKETS).
export const ALCOHOL_POINTS_BRACKETS: PointsBracket[] = [
  { minSize: 1, maxSize: 4, rounds: { 1: 40 }, runnerUp: 80, winner: 100 },
  { minSize: 5, maxSize: 8, rounds: { 1: 40, 2: 60 }, runnerUp: 80, winner: 100 },
  { minSize: 9, maxSize: 16, rounds: { 1: 20, 2: 40, 3: 60 }, runnerUp: 80, winner: 100 },
];

/** TAD/TAFC qualifying POSITION points (17th and beyond score 0). */
export function getAlcoholQualifyingPoints(position: number): number {
  if (position === 1) return 8;
  if (position === 2) return 7;
  if (position === 3) return 6;
  if (position === 4) return 5;
  if (position <= 6) return 4;
  if (position <= 8) return 3;
  if (position <= 12) return 2;
  if (position <= 16) return 1;
  return 0;
}

/** Every alcohol racer with a qualifying entry also earns attempt points. */
export const ALCOHOL_ATTEMPT_POINTS = 10;

const ALCOHOL_CLASS_CODES = new Set(["TAD", "TAFC"]);

// Held off for now per Mark: no points for the pro categories — their
// QDAT/EDAT/PDF exports still build.
//
// When pro scoring gets built, use the NHRA Mission Foods system (source:
// nhra.com/how-points-are-earned/nhra-mission-foods-drag-racing-series-points),
// which differs from the sportsman tables above in every part:
//   Regular season — rounds W 100 / RU 80 / R3 60 / R2 40 / R1 20;
//   participation 10 (one valid qual attempt: stage under power + take the
//   Tree); qual position 1st 8, 2nd 7, 3rd 6, 4th 5, 5-6th 4, 7-8th 3,
//   9-12th 2, 13-16th 1; per-session ET bonus 3/2/1 (none if the session is
//   incomplete).
//   Indy (U.S. Nationals) — W 150 / RU 120 / R3 90 / R2 60 / R1 30;
//   participation 15; qual 10 down to 3; session bonus 4/3/2/1.
//   Countdown — regular scale except Pomona 2 uses the Indy scale; the
//   post-Indy reset seeds 1st 2100, 2nd 2080, then −10 per spot (10th 2000,
//   11th+ keep stepping −10).
export const PRO_CLASS_CODES = new Set(["TF", "FC", "PS", "PSM", "TFM", "MMPS", "PM"]);

function bracketFor(table: PointsBracket[], fieldSize: number): PointsBracket {
  for (const b of table) if (fieldSize >= b.minSize && fieldSize <= b.maxSize) return b;
  return table[table.length - 1];
}

/** Last number in a division string ("NED — Division 1" → "1"), like points-calc. */
export function extractDivisionNumber(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const matches = String(value).match(/\d+/g);
  if (!matches || matches.length === 0) return "";
  return matches[matches.length - 1];
}

export interface AccuPointsRow {
  car_number: string;
  member_number: string;
  name: string;
  division: string;
  points: number;
  status: string;
  isWinner: boolean;
  isRunnerUp: boolean;
}

export interface AccuPointsCategory {
  category: string;
  classCode: string;
  /** Compulink points-file name aligned with the C# EDAT/QDAT prefix: C1ADP.TXT. */
  filename: string;
  alcohol: boolean;
  fieldSize: number;
  rows: AccuPointsRow[];
}

export interface AccuPointsSkipped {
  category: string;
  classCode: string;
  reason: "pro" | "no_elims";
}

type CardFor = (car: string | null, name: string | null) => EdataTechCard | null;

/**
 * Score one AccuTime session, mirroring points-calc's calculateCategoryResults:
 * winner / runner-up from the final, loser-of-round points from the bracket for
 * the field size, alcohol qualifying position + attempt points from the
 * session's own qualifying order, and the optional incomplete-race guarantee.
 */
export function scoreAccuTimeSession(
  session: AccuTimeSession,
  cardFor: CardFor,
  opts: { incompleteRace?: boolean } = {},
): AccuPointsRow[] {
  const isAlcohol = ALCOHOL_CLASS_CODES.has(session.classCode);

  // Round numbers: E3 → 3; the final ("F") took over its own E-number, so it
  // continues from the previous round.
  const roundNums: number[] = [];
  session.elimRounds.forEach((rd, i) => {
    const m = rd.round.match(/^E(\d+)$/);
    roundNums.push(m ? parseInt(m[1], 10) : i > 0 ? roundNums[i - 1] + 1 : 1);
  });
  const finalRoundNum = roundNums[roundNums.length - 1] ?? 0;

  interface Racer {
    car: string;
    name: string;
    member: string;
    wins: number[];
    losses: number[];
  }
  const racers = new Map<string, Racer>();
  const racer = (car: string | null, name: string | null, member: string | null): Racer => {
    const key = (car || name || "?").trim().toUpperCase();
    let r = racers.get(key);
    if (!r) racers.set(key, (r = { car: (car || "").trim(), name: name || "", member: "", wins: [], losses: [] }));
    if (!r.name && name) r.name = name;
    if (!r.member && member) r.member = String(member);
    return r;
  };

  session.elimRounds.forEach((rd, i) => {
    const rn = roundNums[i];
    for (const pair of rd.pairs) {
      for (const run of pair.runs) {
        const r = racer(run.car_number, run.name, run.member_number ?? null);
        if (run.is_winner) r.wins.push(rn);
        else r.losses.push(rn);
      }
    }
  });

  const fieldSize = racers.size;
  const bracket = bracketFor(isAlcohol ? ALCOHOL_POINTS_BRACKETS : DEFAULT_POINTS_BRACKETS, fieldSize);

  let winnerKey: string | null = null;
  let runnerUpKey: string | null = null;
  for (const [key, r] of racers) {
    if (r.wins.includes(finalRoundNum)) winnerKey = key;
    if (r.losses.includes(finalRoundNum)) runnerUpKey = key;
  }

  // Alcohol qualifying entries by car number for the bonus lookup.
  const qualByCar = new Map<string, { pos: number; name: string }>();
  if (isAlcohol) {
    for (const q of session.qualifying) {
      const key = q.car_number.trim().toUpperCase();
      if (key && !qualByCar.has(key)) qualByCar.set(key, { pos: q.pos, name: q.name });
    }
  }
  const matchedQualCars = new Set<string>();

  const rows: AccuPointsRow[] = [];

  for (const [key, r] of racers) {
    const isWinner = key === winnerKey;
    const isRunnerUp = key === runnerUpKey;

    let points = 10;
    let status = "No Show / Non-Qualifier";

    if (isWinner) {
      points = bracket.winner;
      status = "Winner";
    } else if (isRunnerUp) {
      points = bracket.runnerUp;
      status = "Runner-Up";
    } else if (r.losses.length > 0) {
      const lostRound = r.losses[r.losses.length - 1];
      points = bracket.rounds[lostRound] || 10;
      status = `Lost Round ${lostRound}`;
    } else if (r.wins.length > 0) {
      if (opts.incompleteRace) {
        // They won their last round: guarantee the next round's loss points.
        const nextRound = r.wins[r.wins.length - 1] + 1;
        points = bracket.rounds[nextRound] || bracket.runnerUp || 10;
        status = `Incomplete - Guaranteed R${nextRound} Loss Points`;
      } else {
        points = 10;
        status = "Participated";
      }
    } else {
      points = 10;
      status = "Participated";
    }

    if (isAlcohol) {
      const q = qualByCar.get(key);
      if (q) {
        matchedQualCars.add(key);
        const qPts = getAlcoholQualifyingPoints(q.pos);
        points += qPts + ALCOHOL_ATTEMPT_POINTS;
        status += ` (Q#${q.pos} +${qPts}, +${ALCOHOL_ATTEMPT_POINTS})`;
      }
    }

    const tc = cardFor(r.car || null, r.name || null);
    rows.push({
      car_number: r.car,
      member_number: r.member || tc?.member_number || "",
      name: r.name || (tc ? `${tc.first_name} ${tc.last_name}`.trim() : ""),
      division: extractDivisionNumber(tc?.home_division),
      points,
      status,
      isWinner,
      isRunnerUp,
    });
  }

  // Alcohol racers who qualified but never appear on the ladder still earn
  // their qualifying position points + attempt points.
  if (isAlcohol) {
    for (const [key, q] of qualByCar) {
      if (matchedQualCars.has(key)) continue;
      const car = key === "?" ? "" : key;
      const tc = cardFor(car || null, q.name || null);
      const qPts = getAlcoholQualifyingPoints(q.pos);
      rows.push({
        car_number: car,
        member_number: tc?.member_number || "",
        name: q.name || (tc ? `${tc.first_name} ${tc.last_name}`.trim() : ""),
        division: extractDivisionNumber(tc?.home_division),
        points: ALCOHOL_ATTEMPT_POINTS + qPts,
        status: `Qualified #${q.pos} - Did Not Race`,
        isWinner: false,
        isRunnerUp: false,
      });
    }
  }

  rows.sort((a, b) => b.points - a.points);
  return rows;
}

// ——— Deductions (oil-downs and other penalties) ———

export const DEDUCTION_REASONS = ["Oil down", "Failure to report", "Unsportsmanlike", "Other"] as const;

export interface PointsDeduction {
  category: string;
  car_number: string;
  name: string;
  reason: string;
  note: string;
  /** Points removed (positive number). */
  points: number;
}

export function deductionsFor(
  deductions: PointsDeduction[],
  category: string,
  car: string,
): number {
  const key = car.trim().toUpperCase();
  return deductions
    .filter((d) => d.category === category && d.car_number.trim().toUpperCase() === key)
    .reduce((n, d) => n + d.points, 0);
}

// ——— Compulink class numbers (the C# file prefixes) ———
//
// From the golden RACEDATA sample's IDX table and points-calc's
// getCategoryNumber: each class has a fixed number that names its files
// (C10QDAT/C10EDAT/C10A16DP are all Super Street).
const CLASS_NUMBER_BY_CODE: Record<string, number> = {
  TF: 1, FC: 2, PS: 3, PSM: 4,
  JR: 5, TAD: 6, TAFC: 7,
  SC: 8, SG: 9, SST: 10, COMP: 11, SS: 12, STK: 13, TS: 14, TD: 15,
  SMC: 16, SPRO: 17, PROET: 21, SPTM: 25, ETM: 29,
};

const CLASS_NUMBER_BY_NAME: [RegExp, number][] = [
  [/SUPER\s*COMP/, 8],
  [/SUPER\s*GAS/, 9],
  [/SUPER\s*STREET/, 10],
  [/SUPER\s*STOCK/, 12],
  [/TOP\s*SPORTSMAN/, 14],
  [/TOP\s*DRAGSTER/, 15],
  [/COMP(ETITION)?/, 11],
  [/STOCK/, 13],
];

/** Fixed Compulink class number for a class, or null when it has none. */
export function compulinkClassNumber(className: string, classCode: string): number | null {
  const code = (classCode || "").trim().toUpperCase();
  if (code && CLASS_NUMBER_BY_CODE[code] !== undefined) return CLASS_NUMBER_BY_CODE[code];
  const name = (className || "").toUpperCase();
  for (const [re, n] of CLASS_NUMBER_BY_NAME) if (re.test(name)) return n;
  return null;
}

/**
 * The exact Compulink points-file string (points-calc format, golden-sample
 * layout): header + `Car#,Member#,Full Name,Division,Points,Deduction` rows +
 * End of File, CRLF line endings and a single DOS Ctrl-Z EOF marker. Points
 * are the earned (base) points; the deduction rides the sixth field as the
 * audit trail.
 */
export function buildPointsFileContent(
  category: string,
  rows: {
    car_number: string;
    member_number: string;
    name: string;
    division: string;
    points: number;
    deduction?: number;
  }[],
): string {
  const out: string[] = [`Compulink StarTrak EVENT Points for ${category || "CLASS"} w/REG code 1`];
  for (const r of rows) {
    out.push(
      [
        (r.car_number || "").toUpperCase(),
        r.member_number || "",
        r.name,
        r.division || "0",
        r.points,
        r.deduction || 0,
      ].join(","),
    );
  }
  out.push("End of File");
  return out.join("\r\n") + "\r\n" + "\x1a";
}

/** One class's row in the IDX table. */
export interface IdxEntry {
  num: number;
  classCode: string;
  winnerMember: string;
  winnerName: string;
  runnerUpName: string;
}

/**
 * The IDX##.TXT class table from the golden RACEDATA sample:
 * `num,code,index,record,winnerMember,Winner Name,RunnerUp Name,` per class.
 * Class index/record figures aren't in the timing data, so they print 0.
 */
export function buildIdxFile(entries: IdxEntry[]): string {
  const rows = [...entries].sort((a, b) => a.num - b.num);
  const out = rows.map((e) =>
    [e.num, e.classCode, 0, 0, e.winnerMember || "0", e.winnerName, e.runnerUpName, ""].join(","),
  );
  return out.join("\r\n") + "\r\n" + "\x1a";
}

/** Companion audit sheet listing every deduction applied to the points files. */
export function buildDeductionsSheet(deductions: PointsDeduction[]): string {
  const out: string[] = [
    "Points deductions applied",
    "CLASS,CAR,NAME,REASON,POINTS DEDUCTED",
  ];
  for (const d of deductions) {
    const reason = d.note ? `${d.reason} - ${d.note}` : d.reason;
    out.push([d.category, (d.car_number || "").toUpperCase(), d.name, reason, d.points].join(","));
  }
  return out.join("\r\n") + "\r\n";
}
