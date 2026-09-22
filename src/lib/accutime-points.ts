import type { AccuTimeSession } from "./accutime";
import type { EdataTechCard } from "./edata-export";

/**
 * NHRA points scoring for AccuTime sessions.
 *
 * Sportsman and Alcohol tables are ported from Mark's points-calc playground
 * (markdawson-playground.web.app/points-calc) so the numbers match that app
 * exactly — don't tune those tables here without changing them there.
 *
 * Pro categories (TF, FC, PS, PSM, …) score the NHRA Mission Foods national
 * event structure (see the pro section below) — round results, qualifying
 * position, participation and per-session low-ET bonuses, on the regular or
 * Indy scale.
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

// ——— Pro (NHRA Mission Foods) national-event points ———
//
// Source: nhra.com/how-points-are-earned/nhra-mission-foods-drag-racing-series-points.
// Two value sets exist: the regular scale (every event except Indy, and every
// Countdown event except Pomona 2) and the Indy scale (the U.S. Nationals and
// Pomona 2, the final Countdown race). The event-scale picker on /edata
// selects which one an export uses; Countdown itself scores the regular
// values, only its Pomona 2 finale steps up to Indy's.
export const PRO_CLASS_CODES = new Set(["TF", "FC", "PS", "PSM", "TFM", "MMPS", "PM"]);

export type ProEventScale = "regular" | "indy" | "countdown" | "countdown_finale";

export interface ProScaleValues {
  /** Which value set applies ("regular" or "indy"). */
  values: "regular" | "indy";
  winner: number;
  runnerUp: number;
  /** Loser of round n (from round 1); the final's loser is the runner-up. */
  roundLoser: Record<number, number>;
  /** Points for the one required valid qualifying attempt. */
  participation: number;
  /** Per-session low-ET bonus, quickest first (3/2/1 or 4/3/2/1 at Indy). */
  sessionBonus: number[];
}

export const PRO_SCALE_REGULAR: ProScaleValues = {
  values: "regular",
  winner: 100,
  runnerUp: 80,
  roundLoser: { 1: 20, 2: 40, 3: 60 },
  participation: 10,
  sessionBonus: [3, 2, 1],
};

export const PRO_SCALE_INDY: ProScaleValues = {
  values: "indy",
  winner: 150,
  runnerUp: 120,
  roundLoser: { 1: 30, 2: 60, 3: 90 },
  participation: 15,
  sessionBonus: [4, 3, 2, 1],
};

/** The /edata event-scale picker options, in display order. */
export const PRO_EVENT_SCALES: { value: ProEventScale; label: string }[] = [
  { value: "regular", label: "Regular season" },
  { value: "indy", label: "U.S. Nationals (Indy scale)" },
  { value: "countdown", label: "Countdown (regular values)" },
  { value: "countdown_finale", label: "Countdown finale — Pomona 2 (Indy scale)" },
];

export function proScaleLabel(scale: ProEventScale): string {
  return PRO_EVENT_SCALES.find((s) => s.value === scale)?.label || scale;
}

export function proScaleValues(scale: ProEventScale): ProScaleValues {
  return scale === "indy" || scale === "countdown_finale" ? PRO_SCALE_INDY : PRO_SCALE_REGULAR;
}

/**
 * Pro qualifying POSITION points. The regular ladder is the same shape as the
 * alcohol one (8/7/6/5, 4 for 5-6th, 3 for 7-8th, 2 for 9-12th, 1 for
 * 13-16th); Indy's is exactly that plus 2 at every position (10 down to 3).
 * 17th and beyond score 0.
 */
export function getProQualifyingPoints(position: number, scale: ProScaleValues): number {
  const base = getAlcoholQualifyingPoints(position);
  if (base === 0) return 0;
  return scale.values === "indy" ? base + 2 : base;
}

/**
 * Post-Indy Countdown reset seed for a championship position: 1st 2100,
 * 2nd 2080, then −10 per spot (10th 2000, 11th 1990, …). This is a
 * season-standings adjustment, NOT event points — it must never land in a
 * per-event A16DP file, which always carries the points earned at that event.
 */
export function countdownSeedPoints(position: number): number {
  if (position <= 1) return 2100;
  return 2080 - (position - 2) * 10;
}

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
  /** NHRA pro category (Mission Foods structure instead of the brackets). */
  pro: boolean;
  /** The event scale a pro category was scored on. */
  proScale?: ProEventScale;
  fieldSize: number;
  rows: AccuPointsRow[];
  /** Scoring caveats for this class (skipped session bonuses, heuristics, …). */
  notes: string[];
}

export interface AccuPointsSkipped {
  category: string;
  classCode: string;
  reason: "no_elims";
}

type CardFor = (car: string | null, name: string | null) => EdataTechCard | null;

/**
 * Score one AccuTime session.
 *
 * Sportsman/Alcohol mirrors points-calc's calculateCategoryResults: winner /
 * runner-up from the final, loser-of-round points from the bracket for the
 * field size, alcohol qualifying position + attempt points from the session's
 * own qualifying order, and the optional incomplete-race guarantee.
 *
 * Pro classes score the Mission Foods national-event structure on the picked
 * scale: round result (W/RU/round-loser), qualifying position points,
 * participation, and per-session low-ET bonuses when the upload carries
 * per-session passes. Caveats (skipped bonuses, the participation heuristic,
 * sessions treated as incomplete) come back in `notes`.
 */
export function scoreAccuTimeSession(
  session: AccuTimeSession,
  cardFor: CardFor,
  opts: { incompleteRace?: boolean; proScale?: ProEventScale } = {},
): { rows: AccuPointsRow[]; notes: string[] } {
  const isAlcohol = ALCOHOL_CLASS_CODES.has(session.classCode);
  const isPro = PRO_CLASS_CODES.has(session.classCode);
  const proValues = isPro ? proScaleValues(opts.proScale || "regular") : null;
  const notes: string[] = [];

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

  // Alcohol/pro qualifying entries by car number for the position points.
  const qualByCar = new Map<string, { pos: number; name: string }>();
  if (isAlcohol || isPro) {
    for (const q of session.qualifying) {
      const key = q.car_number.trim().toUpperCase();
      if (key && !qualByCar.has(key)) qualByCar.set(key, { pos: q.pos, name: q.name });
    }
  }
  const matchedQualCars = new Set<string>();

  // Pro per-session low-ET bonuses (3/2/1, Indy 4/3/2/1) — only from real
  // per-session passes; never derived from a best-of-event order.
  const sessionBonusByCar = new Map<string, number>();
  if (isPro && proValues) {
    const qualSessions = session.qualSessionPasses.filter((s) => s.passes.length > 0);
    if (qualSessions.length === 0) {
      notes.push(
        "Per-session low-ET bonuses not scored — the upload carries no per-session qualifying passes (Compulink QDAT is best-of-event only; upload the AccuTime race.dat for session bonuses).",
      );
    } else {
      const fieldRef = Math.max(session.qualifying.length, ...qualSessions.map((s) => s.passes.length));
      for (const s of qualSessions) {
        // NHRA awards no bonus for a session that can't be completed. The
        // timing rows don't say why a session ended, so the heuristic is:
        // fewer than half the field making a pass reads as an incomplete
        // session (in pro qualifying every entered car runs every session).
        if (s.passes.length * 2 < fieldRef) {
          notes.push(
            `Q${s.session} treated as incomplete (${s.passes.length} of ${fieldRef} cars made a pass) — no low-ET bonus for that session.`,
          );
          continue;
        }
        const ranked = s.passes
          .filter((p) => p.et !== null)
          .sort((a, b) => a.et! - b.et!)
          .slice(0, proValues.sessionBonus.length);
        ranked.forEach((p, i) => {
          const key = (p.car_number || p.name || "?").trim().toUpperCase();
          sessionBonusByCar.set(key, (sessionBonusByCar.get(key) || 0) + proValues.sessionBonus[i]);
        });
      }
    }
    notes.push(
      `Participation +${proValues.participation}: any recorded qualifying entry or elimination appearance counts as the one required valid attempt (the timing rows can't prove "staged under power and took the Tree").`,
    );
    if (opts.incompleteRace) {
      notes.push(
        "The incomplete-race guarantee is a sportsman/alcohol rule — NHRA publishes no pro equivalent, so it was not applied to this class.",
      );
    }
  }

  const rows: AccuPointsRow[] = [];

  for (const [key, r] of racers) {
    const isWinner = key === winnerKey;
    const isRunnerUp = key === runnerUpKey;

    let points = 10;
    let status = "No Show / Non-Qualifier";

    if (isPro && proValues) {
      // Round points by elimination result. Losers score by the round they
      // fell in (the table tops out at the third round — a 16-car pro field);
      // the final's loser is the runner-up.
      if (isWinner) {
        points = proValues.winner;
        status = "Winner";
      } else if (isRunnerUp) {
        points = proValues.runnerUp;
        status = "Runner-Up";
      } else if (r.losses.length > 0) {
        const lostRound = r.losses[r.losses.length - 1];
        points = proValues.roundLoser[Math.min(lostRound, 3)] ?? 0;
        status = `Lost Round ${lostRound}`;
      } else if (r.wins.length > 0) {
        // Won their last matchup but the race never finished. NHRA publishes
        // no pro incomplete-race guarantee, so no round points are invented —
        // the sportsman/alcohol toggle deliberately doesn't reach this branch.
        points = 0;
        status = `Race incomplete — won R${r.wins[r.wins.length - 1]}, no round points`;
      } else {
        points = 0;
        status = "Ran eliminations";
      }

      // Participation + qualifying position + session low-ET bonuses. An
      // elimination appearance counts as the required valid attempt even when
      // the qualifying sheet is missing.
      points += proValues.participation;
      const extras: string[] = [];
      const q = qualByCar.get(key);
      if (q) {
        matchedQualCars.add(key);
        const qPts = getProQualifyingPoints(q.pos, proValues);
        points += qPts;
        extras.push(`Q#${q.pos} +${qPts}`);
      }
      extras.push(`attempt +${proValues.participation}`);
      const bonus = sessionBonusByCar.get(key) || 0;
      if (bonus > 0) {
        points += bonus;
        extras.push(`session lows +${bonus}`);
      }
      status += ` (${extras.join(", ")})`;
    } else if (isWinner) {
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

  // Pro racers who attempted qualifying but never made the ladder: DNQs (17th
  // and beyond) earn participation only; a qualified no-show also keeps their
  // position points and any session bonuses.
  if (isPro && proValues) {
    for (const [key, q] of qualByCar) {
      if (matchedQualCars.has(key)) continue;
      const car = key === "?" ? "" : key;
      const tc = cardFor(car || null, q.name || null);
      const qPts = getProQualifyingPoints(q.pos, proValues);
      const bonus = sessionBonusByCar.get(key) || 0;
      const extras: string[] = [];
      if (qPts > 0) extras.push(`Q#${q.pos} +${qPts}`);
      extras.push(`attempt +${proValues.participation}`);
      if (bonus > 0) extras.push(`session lows +${bonus}`);
      rows.push({
        car_number: car,
        member_number: tc?.member_number || "",
        name: q.name || (tc ? `${tc.first_name} ${tc.last_name}`.trim() : ""),
        division: extractDivisionNumber(tc?.home_division),
        points: proValues.participation + qPts + bonus,
        status: `${qPts > 0 ? `Qualified #${q.pos} — Did Not Race` : `Non-Qualifier (#${q.pos})`} (${extras.join(", ")})`,
        isWinner: false,
        isRunnerUp: false,
      });
    }
    // Session-bonus earners absent from both the ladder and the qualifying
    // order (no .qly alongside race.dat): keep their attempt + bonus points
    // rather than dropping them.
    for (const [key, bonus] of sessionBonusByCar) {
      if (racers.has(key) || qualByCar.has(key) || matchedQualCars.has(key)) continue;
      const car = key === "?" ? "" : key;
      const named = session.qualSessionPasses
        .flatMap((s) => s.passes)
        .find((p) => (p.car_number || p.name || "?").trim().toUpperCase() === key);
      const tc = cardFor(car || null, named?.name || null);
      rows.push({
        car_number: named?.car_number || car,
        member_number: tc?.member_number || "",
        name: named?.name || (tc ? `${tc.first_name} ${tc.last_name}`.trim() : ""),
        division: extractDivisionNumber(tc?.home_division),
        points: proValues.participation + bonus,
        status: `Qualifying sessions only (attempt +${proValues.participation}, session lows +${bonus})`,
        isWinner: false,
        isRunnerUp: false,
      });
    }
  }

  rows.sort((a, b) => b.points - a.points);
  return { rows, notes };
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
