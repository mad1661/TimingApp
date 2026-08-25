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
}

export function emptyEtFinalsConfig(): EtFinalsConfig {
  return { categoryRoles: {}, categoryDivision: {}, buybackRounds: {}, pointsPerRoundWin: 1 };
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
  matchedBy: "car" | "name" | "member" | null;
  rounds: EtRoundResult[];
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
  byCategory: EtCategoryPoints[];
  racers: EtRacerPoints[];
}

/** A racer seen in a scoring class that no roster entry claims. */
export interface EtUnmatchedRacer {
  name: string;
  car_number: string;
  category: string;
  division: EtDivision;
  roundsWon: number;
  reason: "no_roster_entry" | "ambiguous";
}

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
}

// --------------- Normalization + matching keys ---------------

const NAME_SUFFIXES = new Set(["JR", "SR", "II", "III", "IV", "V"]);

/** "1LV" / "1-LV" / " 1 lv " all collapse to "1LV". */
export function normalizeCarKey(v: string | null | undefined): string {
  return (v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Order-independent name key. Rosters write "LAST, FIRST" while the timing
 * system may show either order, so tokens are sorted rather than positional.
 * Nicknames in quotes and generational suffixes are dropped.
 */
export function normalizeNameKey(raw: string | null | undefined): string {
  const cleaned = (raw || "")
    .toUpperCase()
    .replace(/"[^"]*"/g, " ")
    .replace(/'[^']*'/g, " ")
    .replace(/[^A-Z\s]/g, " ");
  const tokens = cleaned
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !NAME_SUFFIXES.has(t));
  if (tokens.length === 0) return "";
  return tokens.sort().join(" ");
}

const JR_HINT = /\b(JR|JUNIOR|JDRL|JR\.?\s*DRAGSTER|JR\.?\s*STREET)\b/;
const BUYBACK_HINT = /\b(BUY\s*-?\s*BACK|BUYBACK|B\/?B|SECOND\s*CHANCE|2ND\s*CHANCE)\b/;

export function guessCategoryDivision(category: string): EtDivision {
  return JR_HINT.test((category || "").toUpperCase()) ? "jr" : "big";
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
 * eligibility, because the points land on the team either way. A key that spans
 * teams is genuinely ambiguous and is left unmatched instead of guessed.
 */
function resolveBucket(b: Bucket | undefined): RosterIndexEntry | "ambiguous" | null {
  if (!b || b.matches.length === 0) return null;
  if (b.matches.length === 1) return b.matches[0];
  const first = b.matches[0];
  const uniform = b.matches.every(
    (m) =>
      m.roster.track_code === first.roster.track_code &&
      m.entry.points_eligible === first.entry.points_eligible,
  );
  return uniform ? first : "ambiguous";
}

interface RunnerAggregate {
  name: string;
  car_number: string;
  category: string;
  division: EtDivision;
  runs: RunRow[];
}

export function computeEtFinalsStandings(
  runs: RunRow[],
  rosters: EtFinalsRoster[],
  config: EtFinalsConfig,
  /** Optional car number -> member number map, from tech cards. */
  memberByCar?: Map<string, string>,
): EtFinalsStandings {
  const pointsPerWin = config.pointsPerRoundWin > 0 ? config.pointsPerRoundWin : 1;

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

  for (const roster of rosters) {
    for (const entry of roster.entries) {
      const ref: RosterIndexEntry = { entry, roster };
      const car = normalizeCarKey(entry.car_number);
      if (car) {
        addToBucket(byCar, `${entry.division}|${car}`, ref);
        addToBucket(byCarAnyDivision, car, ref);
      }
      const nameKey = normalizeNameKey(entry.name);
      if (nameKey) {
        addToBucket(byName, `${entry.division}|${nameKey}`, ref);
        addToBucket(byNameAnyDivision, nameKey, ref);
      }
      const member = (entry.member_number || "").trim();
      if (member) addToBucket(byMember, member, ref);
    }
  }

  // ── Group scoring runs by racer ───────────────────────────────────────────
  const mainCats = new Set(categories.filter((c) => c.role === "main").map((c) => c.category));
  const runners = new Map<string, RunnerAggregate>();

  for (const run of runs) {
    const cat = (run.category || "").trim();
    if (!cat || !mainCats.has(cat)) continue;
    if (!isScoringRound(run.round)) continue;
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
          category: cat,
          division: divisionFor(cat),
          runs: [],
        }),
      );
    }
    if (!agg.name && run.name) agg.name = run.name.trim();
    agg.runs.push(run);
  }

  // Winners per category+round, and per timestamp pairing, so an undecided pass
  // in a round that is still running reads as pending rather than as a loss.
  const roundHasWinner = new Set<string>();
  const pairHasWinner = new Set<string>();
  for (const run of runs) {
    if (!isWin(run)) continue;
    const cat = (run.category || "").trim();
    if (!cat || !isScoringRound(run.round)) continue;
    roundHasWinner.add(`${cat}|${run.round}`);
    if (run.timestamp) pairHasWinner.add(`${cat}|${run.round}|${run.timestamp}`);
  }

  // ── Score each racer ──────────────────────────────────────────────────────
  interface Scored {
    ref: RosterIndexEntry;
    matchedBy: "car" | "name" | "member";
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
    // after winning the buy-back — is raced but not scored.
    let stopped = false;
    let points = 0;
    let roundsWon = 0;
    let eliminatedIn: string | null = null;
    let wonFinal = false;
    let racedAfterElimination = false;
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

      const scoresHere = !isBuyback && !stopped && outcome === "win";
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
      });

      if (!isBuyback && !stopped && outcome === "loss") {
        stopped = true;
        eliminatedIn = run.round || null;
      }
    }

    // Match to a roster entry: member number (via tech cards) first, then the
    // car number, then the name.
    const carKey = normalizeCarKey(agg.car_number);
    const nameKey = normalizeNameKey(agg.name);
    let ref: RosterIndexEntry | "ambiguous" | null = null;
    let matchedBy: "car" | "name" | "member" = "car";

    const member = memberByCar?.get(`${agg.category}|${carKey}`) || memberByCar?.get(carKey);
    if (member) {
      const r = resolveBucket(byMember.get(member.trim()));
      if (r && r !== "ambiguous") {
        ref = r;
        matchedBy = "member";
      }
    }
    if (!ref) {
      const r =
        resolveBucket(byCar.get(`${agg.division}|${carKey}`)) ??
        resolveBucket(byCarAnyDivision.get(carKey));
      if (r) {
        ref = r;
        matchedBy = "car";
      }
    }
    if (!ref || ref === "ambiguous") {
      const r =
        resolveBucket(byName.get(`${agg.division}|${nameKey}`)) ??
        resolveBucket(byNameAnyDivision.get(nameKey));
      if (r && r !== "ambiguous") {
        ref = r;
        matchedBy = "name";
      } else if (r === "ambiguous" && !ref) {
        ref = "ambiguous";
      }
    }

    if (!ref || ref === "ambiguous") {
      unmatched.push({
        name: agg.name,
        car_number: agg.car_number,
        category: agg.category,
        division: agg.division,
        roundsWon,
        reason: ref === "ambiguous" ? "ambiguous" : "no_roster_entry",
      });
      continue;
    }

    scored.push({
      ref,
      matchedBy,
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

  const entryKey = (roster: EtFinalsRoster, entry: EtRosterEntry) =>
    `${roster.track_code}|${entry.division}|${entry.slot}|${normalizeCarKey(entry.car_number)}`;

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
      jrPointsEntries: roster.entries.filter((e) => e.division === "jr" && e.points_eligible).length,
      racersScoring: 0,
      racersStillAlive: 0,
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
        points_eligible: entry.points_eligible,
        points: 0,
        roundsWon: 0,
        status: "not_entered",
        eliminatedIn: null,
        racedAfterElimination: false,
        matchedBy: null,
        rounds: [],
      };
      racerByKey.set(racer.key, racer);
      team.racers.push(racer);
    }
  }

  const catTotals = new Map<string, Map<string, EtCategoryPoints>>();

  for (const s of scored) {
    const team = teams.get(s.ref.roster.track_code);
    if (!team) continue;
    const key = entryKey(s.ref.roster, s.ref.entry);
    const racer = racerByKey.get(key);
    if (!racer) continue;

    // Only eligible racers put points on the board; ineligible junior entries
    // still get their rounds recorded so the team page shows they raced.
    const award = s.ref.entry.points_eligible ? s.points : 0;

    racer.run_car_number = racer.run_car_number || s.agg.car_number;
    racer.matchedBy = racer.matchedBy || s.matchedBy;
    if (!racer.categories.includes(s.agg.category)) racer.categories.push(s.agg.category);
    racer.points += award;
    racer.roundsWon += s.roundsWon;
    racer.rounds.push(...s.rounds);
    // A racer doubled up in two main classes gets one row, so fold the two
    // outcomes together rather than letting whichever landed last win: a final
    // win outranks being alive, which outranks being out.
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
        .filter((r) => r.category && mainCats.has(r.category.trim()) && isScoringRound(r.round))
        .map((r) => (r.round || "").trim().toUpperCase()),
    ),
  ).sort((a, b) => elimRoundOrder(a) - elimRoundOrder(b));

  unmatched.sort(
    (a, b) => b.roundsWon - a.roundsWon || a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  );

  return {
    teams: standings,
    unmatched,
    categories,
    totals: {
      bigPoints: standings.reduce((s, t) => s + t.bigPoints, 0),
      jrPoints: standings.reduce((s, t) => s + t.jrPoints, 0),
      totalPoints: standings.reduce((s, t) => s + t.totalPoints, 0),
    },
    roundsScored,
  };
}
