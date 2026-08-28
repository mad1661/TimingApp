/**
 * ET Finals Points D1 — team points for the Summit Racing Series E.T. Finals
 * and the Summit JDRL / Jr Street Division Championship.
 *
 * Scoring: every points-eligible racer earns 1 point for their track team for
 * each round they win in the MAIN race. A racer stops earning the moment they
 * take their first main-race loss — winning the buy-back round puts them back
 * on the track for round 2, but never back on the points board.
 *
 * Teams are scored in two divisions (big cars / juniors) and the overall
 * standing is the two combined. Every big-car roster entry earns; on the junior
 * roster only points rows 1-10 earn, rows 11+ are entries only.
 *
 * Pure module — no firebase-admin import, safe to pull types from a client
 * component.
 */

import type { RunRow } from "./db";

// --------------- Types ---------------

/** Which points board a class feeds: the big cars or the juniors. */
export type EtDivision = "big" | "jr";

/**
 * What a class in the timing system is:
 *  - "main"    the main race — round wins here score
 *  - "buyback" the second-chance race for first-round losers — never scores
 *  - "ignore"  not part of the team points chase at all (test sessions, etc.)
 */
export type EtCategoryRole = "main" | "buyback" | "ignore";

export interface EtRosterEntry {
  division: EtDivision;
  /** Slot (Summit sheet) or Roster Row (junior sheet). */
  slot: number;
  /** "Team Points - Super ET", "Floater", "Team Points", "Non-Points", ... */
  roster_role: string;
  /** False only for junior roster rows 11+, which enter but never score. */
  points_eligible: boolean;
  /** Roster category as written: "Super ET", "Pro ET", "15-18", "Jr Street". */
  category: string;
  /** Vehicle number without the track code ("1", "31", "71"). */
  vehicle_number: string;
  track_code: string;
  /** Number as displayed on the car: vehicle number + track code ("1LV"). */
  car_number: string;
  /** As written on the roster, usually "LAST, FIRST". */
  name: string;
  city: string;
  state: string;
  member_number: string;
  license_number: string;
  phone: string;
  email: string;
}

export interface EtFinalsRoster {
  /** Firestore doc id: `${season}_${track_code}`. */
  id?: string;
  track_code: string;
  track_name: string;
  team_name: string;
  captain: string;
  captain_phone: string;
  captain_email: string;
  event_name: string;
  season: string;
  entries: EtRosterEntry[];
  source_file: string;
  uploaded_at: string;
  /** Sheets the parser read, and which board each was taken as. Diagnostic. */
  sheets_used?: string[];
  /** Every sheet in the uploaded workbook, for when none looked like a roster. */
  sheets_seen?: string[];
}

export interface EtFinalsConfig {
  /** Timing-system category -> main / buyback / ignore. */
  categoryRoles: Record<string, EtCategoryRole>;
  /** Timing-system category -> big cars or juniors. */
  categoryDivision: Record<string, EtDivision>;
  /**
   * Rounds inside a main category that are really the buy-back, for tracks that
   * run the second chance as an extra round of the same class instead of as its
   * own class. Category -> round codes ("E2"). Usually empty.
   */
  buybackRounds: Record<string, string[]>;
  /** Points awarded per main-race round win. Defaults to 1. */
  pointsPerRoundWin: number;
  /**
   * Hand-assigned matches for racers the automatic matching can't place —
   * a nickname in the timing system, a married name, a car running a number
   * nobody's roster claims. Maps a timing-system racer identity
   * (`${category}|${carKey || nameKey}`) to a roster entry key
   * (`${trackCode}|${division}|${slot}`). Beats every automatic route.
   */
  manualMatches: Record<string, string>;
  /**
   * Hand-set points eligibility, keyed by roster entry key
   * (`${trackCode}|${division}|${slot}`). Overrides what the roster sheet said,
   * for the cases the sheet gets wrong — a junior filed in a points row who
   * shouldn't be scoring, or the reverse. `false` = earns nothing.
   */
  eligibilityOverrides: Record<string, boolean>;
  /**
   * Whether a car that lost and won the buy-back keeps earning points on its
   * later main-race wins. The buy-back round itself NEVER awards a point either
   * way — this only decides what happens after it. Default false: a bought-back
   * car races on but its points stay frozen until the next event.
   */
  buybackEarnsPoints: boolean;
  /**
   * Only passes on or after this date (YYYY-MM-DD) earn points. The practice
   * days before race day often run through the timing system labelled E1 —
   * indistinguishable from the real eliminations by round name — so the date
   * is what keeps them off the board. Null/empty: every day counts.
   */
  scoreFromDate: string | null;
  /**
   * Days (YYYY-MM-DD) whose passes never earn points — the practice days,
   * picked by hand. An exclusion list on purpose: a day nobody has ruled on
   * (race morning) counts by default.
   */
  excludedDates: string[];
  /**
   * Hand adjustments to a team's totals (track code -> points added, may be
   * negative), for when the board is known to be off. Applied on top of the
   * computed points and always shown as an adjustment, never silently.
   */
  pointsAdjustments: Record<string, EtPointsAdjustment>;
}

export interface EtPointsAdjustment {
  big: number;
  jr: number;
  note: string;
}

export function emptyEtFinalsConfig(): EtFinalsConfig {
  return {
    categoryRoles: {},
    categoryDivision: {},
    buybackRounds: {},
    pointsPerRoundWin: 1,
    manualMatches: {},
    eligibilityOverrides: {},
    buybackEarnsPoints: false,
    scoreFromDate: null,
    excludedDates: [],
    pointsAdjustments: {},
  };
}

export type EtRacerStatus =
  | "not_entered"  // on the roster, never appeared in a scoring class
  | "racing"       // still alive, still earning
  | "eliminated"   // took a loss; points are frozen
  | "winner";      // won the final

export interface EtRoundResult {
  round: string;
  category: string;
  outcome: "win" | "loss" | "pending";
  /** False for rounds excluded from scoring (buy-back rounds). */
  scored: boolean;
  points: number;
  /** Car number exactly as the timing system recorded this pass. */
  car_number: string;
  timestamp: string | null;
  /** Handle for correcting this pass via /api/edit-run (fix a wrong car #). */
  dedup_key: string | null;
  /**
   * Thrown out by hand (a rerun is coming, or the pass just doesn't count).
   * Shown in the log but affects nothing: no points, and a thrown-out loss
   * doesn't end anyone's points run.
   */
  ignored: boolean;
}

/** One timing-system identity that landed on a roster row — the handle for
 *  seeing what was combined and for moving it somewhere else. */
export interface EtMatchedIdentity {
  /** `${category}|${carKey || nameKey}` — pass to manualMatches to move it. */
  identity: string;
  category: string;
  car_number: string;
  name: string;
  member_number: string;
  matchedBy: "car" | "name" | "member" | "manual";
  points: number;
  roundsWon: number;
}

export interface EtRacerPoints {
  /** Roster identity: `${track_code}|${division}|${slot}`. */
  key: string;
  name: string;
  roster_car_number: string;
  /** Car number as it actually appears in the timing system, when matched. */
  run_car_number: string;
  track_code: string;
  team_name: string;
  division: EtDivision;
  roster_category: string;
  /** Timing-system categories this racer scored in. */
  categories: string[];
  points_eligible: boolean;
  points: number;
  roundsWon: number;
  status: EtRacerStatus;
  /** Round the racer took their first main-race loss in, if any. */
  eliminatedIn: string | null;
  /**
   * True when the racer kept winning main-race rounds after their points were
   * frozen — i.e. they bought back in. Explains a car still on track with a
   * flat points total.
   */
  racedAfterElimination: boolean;
  matchedBy: "car" | "name" | "member" | "manual" | null;
  /**
   * "roster" = claimed by a submitted roster entry. "tech_card" = no roster
   * claimed them, so they were placed on the team their tech card names.
   */
  source: "roster" | "tech_card";
  rounds: EtRoundResult[];
  /**
   * Every timing-system identity combined onto this row. More than one means
   * runs from two car numbers / spellings were folded together here — each can
   * be moved to a different roster spot or team if the combination is wrong.
   */
  matched_from: EtMatchedIdentity[];
}

export interface EtCategoryPoints {
  category: string;
  division: EtDivision;
  points: number;
}

export interface EtTeamStanding {
  track_code: string;
  track_name: string;
  team_name: string;
  captain: string;
  bigPoints: number;
  jrPoints: number;
  totalPoints: number;
  /** Overall placing, 1-based, ties share a position. */
  rank: number;
  bigEntries: number;
  jrEntries: number;
  jrPointsEntries: number;
  racersScoring: number;
  racersStillAlive: number;
  /** Racers on this team from their tech card rather than a roster entry. */
  racersFromTechCards: number;
  /** False when no roster has been uploaded for this team at all. */
  hasRoster: boolean;
  /** Hand adjustment included in bigPoints (0 when none). */
  bigAdjustment: number;
  /** Hand adjustment included in jrPoints (0 when none). */
  jrAdjustment: number;
  adjustmentNote: string;
  byCategory: EtCategoryPoints[];
  racers: EtRacerPoints[];
}

/** A racer seen in a scoring class that no roster entry claims. */
export interface EtUnmatchedRacer {
  /** Stable handle for this racer, to hand back as a manual match. */
  identity: string;
  name: string;
  car_number: string;
  category: string;
  division: EtDivision;
  roundsWon: number;
  reason: "no_roster_entry" | "ambiguous";
  /** Track code from the racer's tech card, when one was found. A suggestion
   *  for the picker — the roster still decides where the points land. */
  techTeam: string;
  /** Member number from the tech card, to identify them when pinning. */
  memberNumber: string;
  /** Their passes so far, for the drill-down and for fixing a wrong car #. */
  rounds: EtRoundResult[];
}

/**
 * Manual-match target that puts a racer straight onto a team with no roster
 * row — the route for Jr Dragsters whose tech cards carry no team code and
 * whose personal numbers appear on no roster sheet. Value: `TEAM|{trackCode}`.
 */
export const TEAM_MATCH_PREFIX = "TEAM|";

export interface EtFinalsStandings {
  teams: EtTeamStanding[];
  unmatched: EtUnmatchedRacer[];
  /** Every category present in the runs, with the role actually applied. */
  categories: {
    category: string;
    role: EtCategoryRole;
    division: EtDivision;
    runCount: number;
    rounds: string[];
    configured: boolean;
  }[];
  totals: { bigPoints: number; jrPoints: number; totalPoints: number };
  /** Main-race rounds that have run, in order, for the progress readout. */
  roundsScored: string[];
  /** Every day (YYYY-MM-DD) with runs on file, for the days-that-count picker. */
  runDates: string[];
  /** Every roster entry, for the manual-assignment picker on the page. */
  rosterOptions: {
    key: string;
    label: string;
    team: string;
    trackCode: string;
    division: EtDivision;
    rosterCarNumber: string;
    eligible: boolean;
  }[];
}

// --------------- Normalization + matching keys ---------------

const NAME_SUFFIXES = new Set(["JR", "SR", "II", "III", "IV", "V"]);

/** "1LV" / "1-LV" / " 1 lv " all collapse to "1LV". */
export function normalizeCarKey(v: string | null | undefined): string {
  return (v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Split a name into comparable tokens. Rosters write "LAST, FIRST" while the
 * timing system and the tech cards may show either order, so callers sort
 * rather than rely on position. Dropped along the way: nicknames in quotes or
 * parentheses, generational suffixes, and lone initials — all of which appear
 * in one source and not the other for the same racer.
 */
function nameTokens(raw: string | null | undefined): string[] {
  const cleaned = (raw || "")
    .toUpperCase()
    .replace(/"[^"]*"/g, " ")
    .replace(/'[^']*'/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^A-Z\s]/g, " ");
  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !NAME_SUFFIXES.has(t))
    .filter((t) => t.length > 1);
}

/**
 * Order-independent name key: tokens sorted and de-duplicated. The de-dup
 * matters because the tech-card export sometimes repeats a name part across
 * its first- and last-name cells.
 */
export function normalizeNameKey(raw: string | null | undefined): string {
  const tokens = nameTokens(raw);
  if (tokens.length === 0) return "";
  return Array.from(new Set(tokens)).sort().join(" ");
}

/**
 * Looser key: longest token (nearly always the surname) plus the first letter
 * of each other token. Catches "Bob Smith" against "Robert Smith" only when the
 * initial survives, so it is a last-resort route and used only when it lands on
 * exactly one racer.
 */
export function looseNameKey(raw: string | null | undefined): string {
  const tokens = nameTokens(raw);
  if (tokens.length < 2) return "";
  const surname = tokens.reduce((a, b) => (b.length > a.length ? b : a));
  const initials = tokens
    .filter((t) => t !== surname)
    .map((t) => t[0])
    .sort()
    .join("");
  return initials ? `${surname}|${initials}` : "";
}

// "JS" is how the Compulink exports abbreviate Jr Street; "JRS" is how the
// bracket-finals timing classes write it ("10-12 JRS BRACKET FINALS").
const JR_HINT = /\b(JRS?|JUNIOR|JDRL|JR\.?\s*DRAGSTER|JR\.?\s*STREET|JS)\b/;
// A junior age group leading the class name ("6-9 …", "10-12 …", "15-17 …").
const JR_AGE_BRACKET = /^\s*\d{1,2}\s*-\s*\d{1,2}\b/;
const BUYBACK_HINT = /\b(BUY\s*-?\s*BACK|BUYBACK|B\/?B|SECOND\s*CHANCE|2ND\s*CHANCE)\b/;

export function guessCategoryDivision(category: string): EtDivision {
  const c = (category || "").toUpperCase();
  return JR_HINT.test(c) || JR_AGE_BRACKET.test(c) ? "jr" : "big";
}

/**
 * A "BYE" lane is the timing system's placeholder telling the real car in the
 * pair it ran alone — it is not a racer and must never match, score, or sit in
 * the unmatched list waiting to be assigned.
 */
export function isByeMarker(run: {
  car_number?: string | null;
  name?: string | null;
}): boolean {
  const car = (run.car_number || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (car === "BYE" || car === "BYERUN") return true;
  if (car) return false;
  const name = (run.name || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
  return name === "BYE" || name === "BYERUN";
}

export function guessCategoryRole(category: string): EtCategoryRole {
  return BUYBACK_HINT.test((category || "").toUpperCase()) ? "buyback" : "main";
}

// --------------- Round helpers ---------------

/** E1 before E2 before ... before F. Non-elimination rounds sort last. */
export function elimRoundOrder(round: string): number {
  const r = (round || "").trim().toUpperCase();
  if (r === "F" || r === "FINAL") return 9000;
  const m = r.match(/^E(\d+)$/);
  if (m) return parseInt(m[1], 10);
  return 99999;
}

export function isScoringRound(round: string | null | undefined): boolean {
  const r = (round || "").trim().toUpperCase();
  return r === "F" || r === "FINAL" || /^E\d+$/.test(r);
}

/** "8/28/2026 2:17:35 PM" -> "2026-08-28", or "" when unparseable. */
export function runDateKey(timestamp: string | null | undefined): string {
  const part = (timestamp || "").trim().split(/\s+/)[0] || "";
  const m = part.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return "";
  const p = (n: string) => n.padStart(2, "0");
  return `${m[3]}-${p(m[1])}-${p(m[2])}`;
}

function isWin(run: RunRow): boolean {
  if (run.is_dq === 1) return false;
  const r = (run.result || "").trim().toUpperCase();
  if (r === "W") return true;
  if (r) return false;
  return run.is_winner === 1;
}

function isDecidedLoss(run: RunRow): boolean {
  if (run.is_dq === 1) return true;
  const r = (run.result || "").trim().toUpperCase();
  return r !== "" && r !== "W";
}

// --------------- Points engine ---------------

interface RosterIndexEntry {
  entry: EtRosterEntry;
  roster: EtFinalsRoster;
  /** Roster eligibility after any hand-set override is applied. */
  eligible: boolean;
}

interface Bucket {
  matches: RosterIndexEntry[];
}

function addToBucket(map: Map<string, Bucket>, key: string, val: RosterIndexEntry): void {
  if (!key) return;
  let b = map.get(key);
  if (!b) map.set(key, (b = { matches: [] }));
  b.matches.push(val);
}

/**
 * Resolve a bucket to a single roster entry. Several roster rows can share a
 * key legitimately — one racer entered in two Summit categories, say — and that
 * is fine as long as they all belong to the same team with the same
 * eligibility, because the points land on the team either way.
 *
 * A key that spans teams is genuinely ambiguous. `teamHint` (the track code on
 * the racer's tech card) narrows it when exactly one candidate is on that team;
 * with no hint, or a hint that doesn't single one out, the racer is left
 * unmatched for a human to pin rather than guessed at.
 */
function resolveBucket(
  b: Bucket | undefined,
  teamHint?: string,
): RosterIndexEntry | "ambiguous" | null {
  if (!b || b.matches.length === 0) return null;
  if (b.matches.length === 1) return b.matches[0];
  const first = b.matches[0];
  const uniform = b.matches.every(
    (m) =>
      m.roster.track_code === first.roster.track_code &&
      m.eligible === first.eligible,
  );
  if (uniform) return first;
  if (teamHint) {
    const onHinted = b.matches.filter(
      (m) => m.roster.track_code.toUpperCase() === teamHint.toUpperCase(),
    );
    if (onHinted.length === 1) return onHinted[0];
    if (onHinted.length > 1) {
      const h = onHinted[0];
      if (onHinted.every((m) => m.eligible === h.eligible)) return h;
    }
  }
  return "ambiguous";
}

interface RunnerAggregate {
  name: string;
  car_number: string;
  /** NHRA member number when the timing data carries one (EData always, the
   *  API and some getresults grids). The strongest identity there is. */
  member_number: string;
  category: string;
  division: EtDivision;
  /** Car number if the timing system gave one, else the normalized name. */
  identity: string;
  runs: RunRow[];
}

/**
 * The parts of a tech card this engine uses. Tech cards are the bridge between
 * a roster and the timing system: they carry the member number (the only truly
 * stable identity), the personal car number a racer may run instead of their
 * roster-assigned one, and the track team they entered under.
 */
export interface EtTechCardRef {
  memberNumber: string;
  /** Track code, uppercased. A hint only — the roster decides team membership. */
  trackTeam: string;
  carKey: string;
  nameKey: string;
  looseKey: string;
}

/**
 * Index tech cards by each handle the timing system might show. A handle
 * claimed by two different member numbers is dropped rather than guessed —
 * personal car numbers do repeat across the division.
 */
function indexTechCards(cards: EtTechCardRef[]): {
  byCar: Map<string, EtTechCardRef>;
  byName: Map<string, EtTechCardRef>;
  byLoose: Map<string, EtTechCardRef>;
  byMember: Map<string, EtTechCardRef>;
} {
  const build = (keyOf: (c: EtTechCardRef) => string): Map<string, EtTechCardRef> => {
    const map = new Map<string, EtTechCardRef>();
    const conflicted = new Set<string>();
    for (const card of cards) {
      const key = keyOf(card);
      if (!key) continue;
      const existing = map.get(key);
      if (existing && existing.memberNumber !== card.memberNumber) conflicted.add(key);
      else if (!existing) map.set(key, card);
    }
    for (const key of conflicted) map.delete(key);
    return map;
  };
  return {
    byCar: build((c) => c.carKey),
    byName: build((c) => c.nameKey),
    byLoose: build((c) => c.looseKey),
    byMember: build((c) => c.memberNumber),
  };
}

export function computeEtFinalsStandings(
  runs: RunRow[],
  rosters: EtFinalsRoster[],
  config: EtFinalsConfig,
  /** Tech cards, when any have been loaded. Optional — matching degrades to
   *  name and car number without them. */
  techCards: EtTechCardRef[] = [],
  /** Track directory, for naming a team the tech cards bring in with no
   *  roster of its own. */
  trackNames: Record<string, { track_name: string; team_name: string }> = {},
  /** Dedup keys of passes thrown out by hand (reruns). Kept in the pass log
   *  but excluded from points, eliminations and winner inference. */
  ignoredKeys: Set<string> = new Set(),
): EtFinalsStandings {
  const pointsPerWin = config.pointsPerRoundWin > 0 ? config.pointsPerRoundWin : 1;
  const buybackEarns = config.buybackEarnsPoints === true;
  const isIgnored = (run: RunRow): boolean =>
    !!run._dedup_key && ignoredKeys.has(run._dedup_key);
  // Passes on excluded days (or before the points-start date) never enter the
  // chase at all — the practice days run through the timing system under the
  // same E-round labels as the real race, so the day is the only thing
  // separating them.
  const scoreFrom = (config.scoreFromDate || "").trim();
  const excludedDays = new Set((config.excludedDates || []).map((d) => d.trim()).filter(Boolean));
  const inScoringWindow = (run: RunRow): boolean => {
    if (!scoreFrom && excludedDays.size === 0) return true;
    const key = runDateKey(run.timestamp);
    if (excludedDays.size > 0 && key && excludedDays.has(key)) return false;
    if (scoreFrom && (key === "" || key < scoreFrom)) return false;
    return true;
  };

  // ── Category roles ────────────────────────────────────────────────────────
  const catStats = new Map<string, { runCount: number; rounds: Set<string> }>();
  for (const run of runs) {
    const cat = (run.category || "").trim();
    if (!cat) continue;
    let s = catStats.get(cat);
    if (!s) catStats.set(cat, (s = { runCount: 0, rounds: new Set() }));
    s.runCount++;
    if (run.round) s.rounds.add(run.round);
  }

  const roleFor = (cat: string): EtCategoryRole => config.categoryRoles[cat] ?? guessCategoryRole(cat);
  const divisionFor = (cat: string): EtDivision =>
    config.categoryDivision[cat] ?? guessCategoryDivision(cat);

  const categories = Array.from(catStats.entries())
    .map(([category, s]) => ({
      category,
      role: roleFor(category),
      division: divisionFor(category),
      runCount: s.runCount,
      rounds: Array.from(s.rounds).sort((a, b) => elimRoundOrder(a) - elimRoundOrder(b)),
      configured: config.categoryRoles[category] !== undefined,
    }))
    .sort((a, b) => a.category.localeCompare(b.category));

  // ── Roster index ──────────────────────────────────────────────────────────
  // Keys are scoped by division first (a junior "1LV" and a Super ET "1LV" are
  // different cars), with an unscoped bucket as a fallback for when a class was
  // filed under the wrong division.
  const byCar = new Map<string, Bucket>();
  const byCarAnyDivision = new Map<string, Bucket>();
  const byName = new Map<string, Bucket>();
  const byNameAnyDivision = new Map<string, Bucket>();
  const byMember = new Map<string, Bucket>();
  const byLoose = new Map<string, Bucket>();
  const byLooseAnyDivision = new Map<string, Bucket>();
  // Roster entry key: track + board + slot. Deliberately free of the car
  // number, so correcting a roster's number doesn't orphan a manual pin.
  const manualEntries = new Map<string, RosterIndexEntry>();
  const entryKeys = new Map<EtRosterEntry, string>();

  const tech = indexTechCards(techCards);

  // Roster entry -> its stable key, so eligibility overrides and manual pins
  // can be looked up by the same handle everywhere below.
  const keyForEntry = new Map<EtRosterEntry, string>();
  const isEligible = (entry: EtRosterEntry): boolean =>
    config.eligibilityOverrides?.[keyForEntry.get(entry) || ""] ?? entry.points_eligible;

  for (const roster of rosters) {
    for (const entry of roster.entries) {
      let key = `${roster.track_code}|${entry.division}|${entry.slot}`;
      // A sheet with duplicate slot numbers would otherwise collapse two
      // racers onto one row; suffix the later ones in sheet order.
      for (let n = 2; manualEntries.has(key); n++) {
        key = `${roster.track_code}|${entry.division}|${entry.slot}#${n}`;
      }
      const ref: RosterIndexEntry = {
        entry,
        roster,
        eligible: config.eligibilityOverrides?.[key] ?? entry.points_eligible,
      };
      manualEntries.set(key, ref);
      entryKeys.set(entry, key);
      keyForEntry.set(entry, key);

      const member = (entry.member_number || "").trim();
      if (member) addToBucket(byMember, member, ref);

      // Car numbers this entry could appear under: the roster-assigned one,
      // plus the personal number on their tech card. Racers are told to display
      // the roster number, but the timing system frequently carries whichever
      // one they registered with, so index both.
      const cars = new Set<string>();
      const rosterCar = normalizeCarKey(entry.car_number);
      if (rosterCar) cars.add(rosterCar);
      const card = member ? tech.byMember.get(member) : undefined;
      if (card?.carKey) cars.add(card.carKey);
      for (const car of cars) {
        addToBucket(byCar, `${entry.division}|${car}`, ref);
        addToBucket(byCarAnyDivision, car, ref);
      }

      // Names: the roster spelling plus the tech-card spelling, which is often
      // the one the timing system echoes.
      const nameKeys = new Set([normalizeNameKey(entry.name), card?.nameKey || ""]);
      for (const nameKey of nameKeys) {
        if (!nameKey) continue;
        addToBucket(byName, `${entry.division}|${nameKey}`, ref);
        addToBucket(byNameAnyDivision, nameKey, ref);
      }
      const looseKeys = new Set([looseNameKey(entry.name), card?.looseKey || ""]);
      for (const looseKey of looseKeys) {
        if (!looseKey) continue;
        addToBucket(byLoose, `${entry.division}|${looseKey}`, ref);
        addToBucket(byLooseAnyDivision, looseKey, ref);
      }
    }
  }

  // ── Group scoring runs by racer ───────────────────────────────────────────
  const mainCats = new Set(categories.filter((c) => c.role === "main").map((c) => c.category));
  const runners = new Map<string, RunnerAggregate>();

  for (const run of runs) {
    const cat = (run.category || "").trim();
    if (!cat || !mainCats.has(cat)) continue;
    if (!isScoringRound(run.round)) continue;
    if (!inScoringWindow(run)) continue;
    if (isByeMarker(run)) continue;
    const car = normalizeCarKey(run.car_number);
    const nameKey = normalizeNameKey(run.name);
    const ident = car || nameKey;
    if (!ident) continue;
    const key = `${cat}|${ident}`;
    let agg = runners.get(key);
    if (!agg) {
      runners.set(
        key,
        (agg = {
          name: (run.name || "").trim(),
          car_number: (run.car_number || "").trim(),
          member_number: (run.member_number || "").trim(),
          category: cat,
          division: divisionFor(cat),
          identity: ident,
          runs: [],
        }),
      );
    }
    if (!agg.name && run.name) agg.name = run.name.trim();
    if (!agg.member_number && run.member_number) agg.member_number = run.member_number.trim();
    agg.runs.push(run);
  }

  // Winners per category+round, and per timestamp pairing, so an undecided pass
  // in a round that is still running reads as pending rather than as a loss.
  const roundHasWinner = new Set<string>();
  const pairHasWinner = new Set<string>();
  for (const run of runs) {
    if (!isWin(run) || isIgnored(run) || !inScoringWindow(run)) continue;
    const cat = (run.category || "").trim();
    if (!cat || !isScoringRound(run.round)) continue;
    roundHasWinner.add(`${cat}|${run.round}`);
    if (run.timestamp) pairHasWinner.add(`${cat}|${run.round}|${run.timestamp}`);
  }

  // ── Score each racer ──────────────────────────────────────────────────────
  /** A racer placed by their tech card's team code, with no roster entry. */
  interface TechPlacement {
    trackCode: string;
    division: EtDivision;
    key: string;
    name: string;
    carNumber: string;
    category: string;
    eligible: boolean;
  }

  interface Scored {
    ref: RosterIndexEntry | null;
    tech: TechPlacement | null;
    matchedBy: "car" | "name" | "member" | "manual";
    agg: RunnerAggregate;
    points: number;
    roundsWon: number;
    eliminatedIn: string | null;
    wonFinal: boolean;
    racedAfterElimination: boolean;
    rounds: EtRoundResult[];
  }

  const scored: Scored[] = [];
  const unmatched: EtUnmatchedRacer[] = [];

  for (const agg of runners.values()) {
    const buybackRounds = new Set(
      (config.buybackRounds[agg.category] || []).map((r) => r.trim().toUpperCase()),
    );

    const ordered = [...agg.runs].sort(
      (a, b) => elimRoundOrder(a.round || "") - elimRoundOrder(b.round || ""),
    );

    // Walk the racer's own rounds in order. Wins score until the first decided
    // loss; everything after that — including a run back in the main class
    // after winning the buy-back — is raced but, unless "buy-backs earn
    // points" is switched on for the event, not scored. The buy-back round
    // itself never scores in either mode.
    let stopped = false;
    let points = 0;
    let roundsWon = 0;
    let eliminatedIn: string | null = null;
    let wonFinal = false;
    let racedAfterElimination = false;
    let lastDecided: "win" | "loss" | null = null;
    let lastLossRound: string | null = null;
    const roundResults: EtRoundResult[] = [];

    for (const run of ordered) {
      const round = (run.round || "").trim().toUpperCase();
      const isBuyback = buybackRounds.has(round);
      let outcome: "win" | "loss" | "pending";
      if (isWin(run)) outcome = "win";
      else if (isDecidedLoss(run)) outcome = "loss";
      else if (run.timestamp && pairHasWinner.has(`${agg.category}|${run.round}|${run.timestamp}`))
        outcome = "loss";
      else if (roundHasWinner.has(`${agg.category}|${run.round}`) && run.ft1320 !== null)
        outcome = "loss";
      else outcome = "pending";

      // A thrown-out pass (rerun coming) stays in the log but changes nothing:
      // its win scores nothing and its loss doesn't end the points run.
      if (isIgnored(run)) {
        roundResults.push({
          round: run.round || "",
          category: agg.category,
          outcome,
          scored: false,
          points: 0,
          car_number: (run.car_number || "").trim(),
          timestamp: run.timestamp,
          dedup_key: run._dedup_key || null,
          ignored: true,
        });
        continue;
      }

      const scoresHere = !isBuyback && outcome === "win" && (!stopped || buybackEarns);
      if (scoresHere) {
        points += pointsPerWin;
        roundsWon++;
        if (round === "F" || round === "FINAL") wonFinal = true;
      } else if (stopped && !isBuyback && outcome === "win") {
        racedAfterElimination = true;
      }
      roundResults.push({
        round: run.round || "",
        category: agg.category,
        outcome,
        scored: scoresHere,
        points: scoresHere ? pointsPerWin : 0,
        car_number: (run.car_number || "").trim(),
        timestamp: run.timestamp,
        dedup_key: run._dedup_key || null,
        ignored: false,
      });

      if (!isBuyback && outcome !== "pending") {
        lastDecided = outcome;
        if (outcome === "loss") lastLossRound = run.round || null;
      }
      if (!isBuyback && !stopped && outcome === "loss") {
        stopped = true;
        eliminatedIn = run.round || null;
      }
    }

    // With buy-back earning on, a first loss doesn't freeze anything, so a car
    // that came back and is winning again reads as alive — it's "out" only when
    // its latest decided main-race run is a loss.
    if (buybackEarns) {
      eliminatedIn = lastDecided === "loss" ? lastLossRound : null;
      racedAfterElimination = false;
    }

    // Match to a roster entry. What the timing system shows is the truth, and
    // the number a racer actually runs often isn't the one the roster assigned
    // them — so the NAME leads, and the car number is only a fallback for a
    // racer whose name is spelled differently in the two places. Matching on
    // the car number first would be worse than useless: a stale roster number
    // that some other racer is now running would put that racer's round wins on
    // the wrong team's board. A manual pin set on the page beats all of it.
    const carKey = normalizeCarKey(agg.car_number);
    const nameKey = normalizeNameKey(agg.name);
    const looseKey = looseNameKey(agg.name);
    let ref: RosterIndexEntry | "ambiguous" | null = null;
    let matchedBy: "car" | "name" | "member" | "manual" = "name";
    let sawAmbiguous = false;

    const take = (
      r: RosterIndexEntry | "ambiguous" | null,
      by: "car" | "name" | "member" | "manual",
    ): boolean => {
      if (r === "ambiguous") {
        sawAmbiguous = true;
        return false;
      }
      if (!r) return false;
      ref = r;
      matchedBy = by;
      return true;
    };

    const manualTarget =
      config.manualMatches?.[`${agg.category}|${agg.identity}`] ??
      config.manualMatches?.[agg.identity];
    // A hand pick of a whole team (no roster row involved) — the way a Jr
    // Dragster with a blank tech-card team code and no roster number gets
    // placed. Beats every automatic route, like any other manual pin.
    let manualTeam: string | null = null;
    if (manualTarget?.startsWith(TEAM_MATCH_PREFIX)) {
      manualTeam = manualTarget.slice(TEAM_MATCH_PREFIX.length).trim().toUpperCase() || null;
    } else if (manualTarget) {
      take(manualEntries.get(manualTarget) ?? null, "manual");
    }

    // Find this racer's tech card from whatever the timing system shows. When
    // the timing data itself carries the member number that lookup is exact;
    // otherwise fall back to car/name. The card supplies the track team, which
    // breaks ties a name or car number alone can't.
    const card =
      (agg.member_number ? tech.byMember.get(agg.member_number) : undefined) ||
      tech.byCar.get(carKey) ||
      tech.byName.get(nameKey) ||
      tech.byLoose.get(looseKey) ||
      undefined;
    const teamHint = card?.trackTeam || "";

    // Two different people can share a name — the member number is what tells
    // them apart. When this racer's member number is known, a name or car
    // route may not land on a roster entry whose member number contradicts it;
    // an entry with no member number on file stays fair game. This also
    // resolves a same-name pair cleanly: the filter leaves only the entry that
    // really is this racer.
    const runMember = agg.member_number || card?.memberNumber || "";
    const memberConsistent = (b: Bucket | undefined): Bucket | undefined => {
      if (!b || !runMember) return b;
      const ok = b.matches.filter((m) => {
        const em = (m.entry.member_number || "").trim();
        return !em || em === runMember;
      });
      if (ok.length === b.matches.length) return b;
      return ok.length > 0 ? { matches: ok } : undefined;
    };

    // Member number straight off the timing data is the strongest automatic
    // route — it survives renumbered cars and re-spelled names alike.
    if (!ref && agg.member_number) {
      take(resolveBucket(byMember.get(agg.member_number), teamHint), "member");
    }
    if (!ref && card?.memberNumber) {
      take(resolveBucket(byMember.get(card.memberNumber), teamHint), "member");
    }
    if (!ref) {
      take(
        resolveBucket(memberConsistent(byName.get(`${agg.division}|${nameKey}`)), teamHint) ??
          resolveBucket(memberConsistent(byNameAnyDivision.get(nameKey)), teamHint),
        "name",
      );
    }
    if (!ref) {
      take(
        resolveBucket(memberConsistent(byCar.get(`${agg.division}|${carKey}`)), teamHint) ??
          resolveBucket(memberConsistent(byCarAnyDivision.get(carKey)), teamHint),
        "car",
      );
    }
    // Last resort: surname plus initials, for a racer the timing system lists
    // under a shortened or differently-spelled first name.
    if (!ref && looseKey) {
      take(
        resolveBucket(memberConsistent(byLoose.get(`${agg.division}|${looseKey}`)), teamHint) ??
          resolveBucket(memberConsistent(byLooseAnyDivision.get(looseKey)), teamHint),
        "name",
      );
    }

    // No roster claims them, but a human picked their team, or their tech card
    // names one — put them on it rather than leaving their round wins scoring
    // for nobody. The roster still wins wherever it has an entry; a manual team
    // pick beats even that being absent.
    let techPlacement: TechPlacement | null = null;
    if (manualTeam) {
      ref = null; // a manual team pick overrides any automatic roster match
      const key = `TEAM|${manualTeam}|${agg.division}|${agg.identity}`;
      techPlacement = {
        trackCode: manualTeam,
        division: agg.division,
        key,
        name: agg.name,
        carNumber: agg.car_number,
        category: agg.category,
        // Deliberately placed by hand, so they earn unless switched off.
        eligible: config.eligibilityOverrides?.[key] ?? true,
      };
    } else if (!ref && teamHint) {
      techPlacement = {
        trackCode: teamHint,
        division: agg.division,
        key: `TECH|${teamHint}|${agg.division}|${agg.identity}`,
        name: agg.name,
        carNumber: agg.car_number,
        category: agg.category,
        // Every big-car entry earns. Juniors can't be assumed: only roster rows
        // 1-10 score, and without that roster there is no way to tell which
        // ten, so a junior placed this way starts as a non-earner and can be
        // switched on per racer.
        eligible:
          config.eligibilityOverrides?.[`TECH|${teamHint}|${agg.division}|${agg.identity}`] ??
          agg.division === "big",
      };
    }

    if (!ref && !techPlacement) {
      unmatched.push({
        identity: `${agg.category}|${agg.identity}`,
        name: agg.name,
        car_number: agg.car_number,
        category: agg.category,
        division: agg.division,
        roundsWon,
        reason: sawAmbiguous ? "ambiguous" : "no_roster_entry",
        techTeam: teamHint,
        memberNumber: agg.member_number || card?.memberNumber || "",
        rounds: roundResults,
      });
      continue;
    }

    scored.push({
      ref: ref as RosterIndexEntry | null,
      tech: techPlacement,
      matchedBy: manualTeam ? "manual" : techPlacement ? "member" : matchedBy,
      agg,
      points,
      roundsWon,
      eliminatedIn,
      wonFinal,
      racedAfterElimination,
      rounds: roundResults,
    });
  }

  // ── Roll up onto teams ────────────────────────────────────────────────────
  const teams = new Map<string, EtTeamStanding>();
  const racerByKey = new Map<string, EtRacerPoints>();

  const entryKey = (_roster: EtFinalsRoster, entry: EtRosterEntry) => entryKeys.get(entry) || "";

  for (const roster of rosters) {
    const team: EtTeamStanding = {
      track_code: roster.track_code,
      track_name: roster.track_name,
      team_name: roster.team_name || roster.track_name || roster.track_code,
      captain: roster.captain,
      bigPoints: 0,
      jrPoints: 0,
      totalPoints: 0,
      rank: 0,
      bigEntries: roster.entries.filter((e) => e.division === "big").length,
      jrEntries: roster.entries.filter((e) => e.division === "jr").length,
      jrPointsEntries: roster.entries.filter((e) => e.division === "jr" && isEligible(e)).length,
      racersScoring: 0,
      racersStillAlive: 0,
      racersFromTechCards: 0,
      hasRoster: true,
      bigAdjustment: 0,
      jrAdjustment: 0,
      adjustmentNote: "",
      byCategory: [],
      racers: [],
    };
    teams.set(roster.track_code, team);

    for (const entry of roster.entries) {
      const racer: EtRacerPoints = {
        key: entryKey(roster, entry),
        name: entry.name,
        roster_car_number: entry.car_number,
        run_car_number: "",
        track_code: roster.track_code,
        team_name: team.team_name,
        division: entry.division,
        roster_category: entry.category,
        categories: [],
        points_eligible: isEligible(entry),
        points: 0,
        roundsWon: 0,
        status: "not_entered",
        eliminatedIn: null,
        racedAfterElimination: false,
        matchedBy: null,
        source: "roster",
        rounds: [],
        matched_from: [],
      };
      racerByKey.set(racer.key, racer);
      team.racers.push(racer);
    }
  }

  const catTotals = new Map<string, Map<string, EtCategoryPoints>>();

  // A team the tech cards name but no roster covers still belongs on the board.
  const ensureTeam = (trackCode: string): EtTeamStanding => {
    let team = teams.get(trackCode);
    if (team) return team;
    const named = trackNames?.[trackCode];
    team = {
      track_code: trackCode,
      track_name: named?.track_name || trackCode,
      team_name: named?.team_name || named?.track_name || trackCode,
      captain: "",
      bigPoints: 0,
      jrPoints: 0,
      totalPoints: 0,
      rank: 0,
      bigEntries: 0,
      jrEntries: 0,
      jrPointsEntries: 0,
      racersScoring: 0,
      racersStillAlive: 0,
      racersFromTechCards: 0,
      hasRoster: false,
      bigAdjustment: 0,
      jrAdjustment: 0,
      adjustmentNote: "",
      byCategory: [],
      racers: [],
    };
    teams.set(trackCode, team);
    return team;
  };

  // One row per roster entry per CLASS: a racer doubled up in two classes gets
  // two separate entries, each with its own points, status and pass log. The
  // roster placeholder row is taken over by the first class seen; later
  // classes clone it. Two identities in the SAME class (a car renumbered
  // mid-event) still fold onto one row, with both visible in matched_from.
  const rowByEntryAndClass = new Map<string, EtRacerPoints>();

  for (const s of scored) {
    const trackCode = s.ref ? s.ref.roster.track_code : s.tech!.trackCode;
    const team = s.ref ? teams.get(trackCode) : ensureTeam(trackCode);
    if (!team) continue;

    const key = s.ref ? entryKey(s.ref.roster, s.ref.entry) : s.tech!.key;
    const classKey = `${key}|${s.agg.category}`;
    let racer = rowByEntryAndClass.get(classKey);

    if (!racer) {
      const placeholder = racerByKey.get(key);
      if (placeholder && placeholder.status === "not_entered" && placeholder.categories.length === 0) {
        // First class seen for this roster entry: take over its placeholder row.
        racer = placeholder;
      } else if (placeholder) {
        // Another class for the same racer: a separate entry, sharing the
        // eligibility key so the Earns toggle governs every class alike.
        racer = { ...placeholder, categories: [], points: 0, roundsWon: 0, status: "not_entered",
          eliminatedIn: null, racedAfterElimination: false, matchedBy: null,
          run_car_number: "", rounds: [], matched_from: [] };
        team.racers.push(racer);
      } else if (s.tech) {
        // First run seen for a tech-card- or hand-placed racer: give them a row.
        racer = {
          key,
          name: s.tech.name,
          roster_car_number: "",
          run_car_number: s.tech.carNumber,
          track_code: trackCode,
          team_name: team.team_name,
          division: s.tech.division,
          roster_category: s.tech.category,
          categories: [],
          points_eligible: s.tech.eligible,
          points: 0,
          roundsWon: 0,
          status: "not_entered",
          eliminatedIn: null,
          racedAfterElimination: false,
          matchedBy: null,
          source: "tech_card",
          rounds: [],
          matched_from: [],
        };
        racerByKey.set(key, racer);
        team.racers.push(racer);
        team.racersFromTechCards++;
        if (s.tech.division === "jr") {
          team.jrEntries++;
          if (s.tech.eligible) team.jrPointsEntries++;
        } else {
          team.bigEntries++;
        }
      }
      if (!racer) continue;
      rowByEntryAndClass.set(classKey, racer);
    }

    // Only eligible racers put points on the board; ineligible entries still
    // get their rounds recorded so the team page shows they raced.
    const award = racer.points_eligible ? s.points : 0;

    racer.run_car_number = racer.run_car_number || s.agg.car_number;
    racer.matchedBy = racer.matchedBy || s.matchedBy;
    if (!racer.categories.includes(s.agg.category)) racer.categories.push(s.agg.category);
    racer.points += award;
    racer.roundsWon += s.roundsWon;
    racer.rounds.push(...s.rounds);
    racer.matched_from.push({
      identity: `${s.agg.category}|${s.agg.identity}`,
      category: s.agg.category,
      car_number: s.agg.car_number,
      name: s.agg.name,
      member_number: s.agg.member_number,
      matchedBy: s.matchedBy,
      points: award,
      roundsWon: s.roundsWon,
    });
    // Two identities in one class fold together; a final win outranks being
    // alive, which outranks being out.
    if (s.eliminatedIn && !racer.eliminatedIn) racer.eliminatedIn = s.eliminatedIn;
    if (s.racedAfterElimination) racer.racedAfterElimination = true;
    const rank = (st: EtRacerStatus) =>
      st === "winner" ? 3 : st === "racing" ? 2 : st === "eliminated" ? 1 : 0;
    const incoming: EtRacerStatus = s.wonFinal ? "winner" : s.eliminatedIn ? "eliminated" : "racing";
    if (rank(incoming) > rank(racer.status)) racer.status = incoming;

    if (award > 0) {
      const div = s.agg.division;
      if (div === "jr") team.jrPoints += award;
      else team.bigPoints += award;

      let catMap = catTotals.get(team.track_code);
      if (!catMap) catTotals.set(team.track_code, (catMap = new Map()));
      const existing = catMap.get(s.agg.category);
      if (existing) existing.points += award;
      else catMap.set(s.agg.category, { category: s.agg.category, division: div, points: award });
    }
  }

  // Hand adjustments land on top of the computed points — and a team that has
  // an adjustment but no roster and no runs yet still belongs on the board.
  for (const [code, adj] of Object.entries(config.pointsAdjustments || {})) {
    const big = Number(adj?.big) || 0;
    const jr = Number(adj?.jr) || 0;
    if (big === 0 && jr === 0 && !(adj?.note || "").trim()) continue;
    const team = ensureTeam((code || "").trim().toUpperCase());
    team.bigAdjustment = big;
    team.jrAdjustment = jr;
    team.adjustmentNote = (adj?.note || "").trim();
    team.bigPoints += big;
    team.jrPoints += jr;
  }

  for (const team of teams.values()) {
    team.totalPoints = team.bigPoints + team.jrPoints;
    team.racersScoring = team.racers.filter((r) => r.points > 0).length;
    team.racersStillAlive = team.racers.filter((r) => r.status === "racing").length;
    team.byCategory = Array.from(catTotals.get(team.track_code)?.values() || []).sort(
      (a, b) => b.points - a.points || a.category.localeCompare(b.category),
    );
    team.racers.sort(
      (a, b) =>
        b.points - a.points ||
        a.division.localeCompare(b.division) ||
        a.name.localeCompare(b.name),
    );
  }

  const standings = Array.from(teams.values()).sort(
    (a, b) => b.totalPoints - a.totalPoints || a.team_name.localeCompare(b.team_name),
  );
  let rank = 0;
  let lastPoints: number | null = null;
  standings.forEach((t, i) => {
    if (lastPoints === null || t.totalPoints !== lastPoints) {
      rank = i + 1;
      lastPoints = t.totalPoints;
    }
    t.rank = rank;
  });

  const roundsScored = Array.from(
    new Set(
      runs
        .filter(
          (r) =>
            r.category &&
            mainCats.has(r.category.trim()) &&
            isScoringRound(r.round) &&
            inScoringWindow(r),
        )
        .map((r) => (r.round || "").trim().toUpperCase()),
    ),
  ).sort((a, b) => elimRoundOrder(a) - elimRoundOrder(b));

  unmatched.sort(
    (a, b) => b.roundsWon - a.roundsWon || a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  );

  const rosterOptions = rosters.flatMap((roster) =>
    roster.entries.map((entry) => ({
      key: entryKeys.get(entry) || "",
      label: `${entry.name}${entry.car_number ? ` (${entry.car_number})` : ""} — ${entry.category || "?"}`,
      team: roster.team_name || roster.track_name || roster.track_code,
      trackCode: roster.track_code,
      division: entry.division,
      rosterCarNumber: entry.car_number,
      eligible: isEligible(entry),
    })),
  );
  rosterOptions.sort(
    (a, b) => a.team.localeCompare(b.team) || a.division.localeCompare(b.division) || a.label.localeCompare(b.label),
  );

  const runDates = Array.from(
    new Set(runs.map((r) => runDateKey(r.timestamp)).filter(Boolean)),
  ).sort();

  return {
    teams: standings,
    unmatched,
    categories,
    rosterOptions,
    totals: {
      bigPoints: standings.reduce((s, t) => s + t.bigPoints, 0),
      jrPoints: standings.reduce((s, t) => s + t.jrPoints, 0),
      totalPoints: standings.reduce((s, t) => s + t.totalPoints, 0),
    },
    roundsScored,
    runDates,
  };
}
