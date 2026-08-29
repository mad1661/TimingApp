"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveData } from "@/components/LiveDataProvider";
import {
  elimRoundOrder,
  inDayWindow,
  isByeMarker,
  isScoringRound,
  normalizeCarKey,
  normalizeNameKey,
  runDateKey,
  TEAM_MATCH_PREFIX,
} from "@/lib/et-finals";
import { finishEt } from "@/lib/run-finish";
import type {
  EtCategoryRole,
  EtDivision,
  EtFinalsConfig,
  EtFinalsStandings,
  EtRacerPoints,
  EtRoundResult,
  EtTeamStanding,
} from "@/lib/et-finals";

interface TrackName {
  track_name: string;
  team_name: string;
}

type StandingsResponse = EtFinalsStandings & {
  config: EtFinalsConfig;
  rosterCount: number;
  trackNames: Record<string, TrackName>;
  trackCodes: { code: string; hasRoster: boolean; techCardCount: number }[];
  classesFromDefaults: string[];
};

interface SavedSetup {
  id: string;
  name: string;
  season: string;
  source_event_code: string;
  saved_at: string;
  config: EtFinalsConfig;
}

interface RosterSummary {
  id: string;
  track_code: string;
  track_name: string;
  team_name: string;
  captain: string;
  season: string;
  event_name: string;
  source_file: string;
  uploaded_at: string;
  bigEntries: number;
  jrEntries: number;
  jrPointsEntries: number;
}

type ViewMode = "combined" | "big" | "jr";

function downloadCsv(filename: string, header: string[], rows: string[][]) {
  const escape = (v: string): string => {
    if (v == null) return "";
    if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };
  const lines = [header.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const ROLE_LABELS: Record<EtCategoryRole, string> = {
  main: "Main Race",
  buyback: "Buy-Back",
  ignore: "Not Scored",
};

const ROLE_STYLES: Record<EtCategoryRole, string> = {
  main: "bg-green-500/20 text-green-400 border-green-500/40",
  buyback: "bg-yellow-500/20 text-yellow-500 border-yellow-500/40",
  ignore: "bg-gray-600/20 text-gray-400 border-gray-600/40",
};

function StatusBadge({ racer }: { racer: EtRacerPoints }) {
  if (!racer.points_eligible) {
    return (
      <span className="px-2 py-0.5 rounded text-xs font-semibold bg-gray-600/20 text-gray-400 border border-gray-600/40">
        No Points
      </span>
    );
  }
  const map: Record<EtRacerPoints["status"], { label: string; cls: string }> = {
    winner: { label: "Winner", cls: "bg-nhra-red/20 text-red-400 border-nhra-red/40" },
    racing: { label: "Alive", cls: "bg-green-500/20 text-green-400 border-green-500/40" },
    eliminated: {
      // Still on track after buying back in, but frozen on the points board.
      label: racer.racedAfterElimination
        ? `Bought Back${racer.eliminatedIn ? ` · Out ${racer.eliminatedIn}` : ""}`
        : racer.eliminatedIn
          ? `Out ${racer.eliminatedIn}`
          : "Out",
      cls: racer.racedAfterElimination
        ? "bg-yellow-500/20 text-yellow-500 border-yellow-500/40"
        : "bg-orange-500/20 text-orange-400 border-orange-500/40",
    },
    not_entered: { label: "Not Entered", cls: "bg-gray-600/20 text-gray-500 border-gray-600/40" },
  };
  const s = map[racer.status];
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold border ${s.cls}`}>{s.label}</span>
  );
}

/**
 * A racer's passes in order with a running points tally — how a wrong car
 * number shows itself (a round win the tally says can't be theirs) — plus an
 * inline fix that corrects the pass in the timing data itself.
 */
function RoundsDetail({
  rounds,
  assigning,
  onFixCarNumber,
  onToggleIgnored,
}: {
  rounds: EtRoundResult[];
  assigning: string | null;
  onFixCarNumber: (dedupKey: string, carNumber: string) => void;
  onToggleIgnored: (dedupKey: string, ignore: boolean) => void;
}) {
  const [editKey, setEditKey] = useState<string | null>(null);
  const [carValue, setCarValue] = useState("");

  const sorted = [...rounds].sort(
    (a, b) => a.category.localeCompare(b.category) || elimRoundOrder(a.round) - elimRoundOrder(b.round),
  );
  let running = 0;

  if (sorted.length === 0) {
    return <p className="px-6 py-3 text-xs text-gray-600">No passes recorded yet.</p>;
  }

  return (
    <table className="w-full text-xs">
      <thead className="text-gray-600 uppercase tracking-wider">
        <tr>
          <th className="text-left pl-10 pr-2 py-1 font-medium">Round</th>
          <th className="text-left px-2 py-1 font-medium">Class</th>
          <th className="text-left px-2 py-1 font-medium">Result</th>
          <th className="text-right px-2 py-1 font-medium">Pts</th>
          <th className="text-right px-2 py-1 font-medium">Running Total</th>
          <th className="text-left px-2 py-1 font-medium">Car # on this pass</th>
          <th className="text-left px-2 py-1 font-medium">Time</th>
          <th className="text-right px-4 py-1 font-medium">Corrections</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((rd, i) => {
          running += rd.points;
          const editing = editKey !== null && editKey === rd.dedup_key;
          const busy = assigning !== null && assigning === rd.dedup_key;
          const dim = rd.ignored ? "opacity-50 line-through" : "";
          return (
            <tr key={rd.dedup_key || i} className="border-t border-nhra-border/30">
              <td className={`pl-10 pr-2 py-1 text-gray-300 font-semibold ${dim}`}>{rd.round}</td>
              <td className={`px-2 py-1 text-gray-500 ${dim}`}>{rd.category}</td>
              <td className="px-2 py-1">
                {rd.ignored ? (
                  <span className="text-gray-500 font-semibold no-underline">
                    thrown out{rd.outcome !== "pending" ? ` (was ${rd.outcome === "win" ? "W" : "L"})` : ""}
                  </span>
                ) : rd.outcome === "win" ? (
                  <span className={rd.scored ? "text-green-400 font-bold" : "text-yellow-500 font-bold"}>
                    W{rd.scored ? "" : " (no pts)"}
                  </span>
                ) : rd.outcome === "loss" ? (
                  <span className="text-red-400">L</span>
                ) : (
                  <span className="text-gray-500">—</span>
                )}
              </td>
              <td className={`px-2 py-1 text-right text-gray-300 ${dim}`}>{rd.points || ""}</td>
              <td className="px-2 py-1 text-right font-bold text-white">{running}</td>
              <td className={`px-2 py-1 text-gray-400 font-mono ${dim}`}>{rd.car_number || "—"}</td>
              <td className={`px-2 py-1 text-gray-600 whitespace-nowrap ${dim}`}>
                {rd.timestamp ? rd.timestamp.split(" ").slice(1).join(" ") : "—"}
              </td>
              <td className="px-4 py-1 text-right whitespace-nowrap">
                {editing ? (
                  <span className="inline-flex items-center gap-1">
                    <input
                      value={carValue}
                      onChange={(e) => setCarValue(e.target.value.toUpperCase())}
                      placeholder="correct #"
                      autoFocus
                      className="w-20 px-1.5 py-0.5 bg-nhra-darker border border-nhra-border rounded text-xs text-white"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && carValue.trim() && rd.dedup_key) {
                          onFixCarNumber(rd.dedup_key, carValue.trim());
                          setEditKey(null);
                        }
                        if (e.key === "Escape") setEditKey(null);
                      }}
                    />
                    <button
                      disabled={!carValue.trim() || busy}
                      onClick={() => {
                        if (rd.dedup_key) onFixCarNumber(rd.dedup_key, carValue.trim());
                        setEditKey(null);
                      }}
                      className="px-1.5 py-0.5 rounded bg-nhra-red text-white font-semibold disabled:opacity-40"
                    >
                      Save
                    </button>
                    <button onClick={() => setEditKey(null)} className="px-1 py-0.5 text-gray-500 hover:text-white">
                      ✕
                    </button>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-3">
                    <button
                      disabled={!rd.dedup_key || busy}
                      onClick={() => {
                        setEditKey(rd.dedup_key);
                        setCarValue(rd.car_number);
                      }}
                      title="Correct the car number recorded on this pass — the pass moves to whoever really made it"
                      className="text-nhra-accent hover:underline disabled:opacity-40"
                    >
                      {busy ? "Working…" : "Fix car #"}
                    </button>
                    <button
                      disabled={!rd.dedup_key || busy}
                      onClick={() => rd.dedup_key && onToggleIgnored(rd.dedup_key, !rd.ignored)}
                      title={
                        rd.ignored
                          ? "Make this pass count again"
                          : "Throw this pass out (rerun) — it scores nothing and a loss here doesn't end anyone's points"
                      }
                      className={`hover:underline disabled:opacity-40 ${rd.ignored ? "text-green-400" : "text-gray-500 hover:text-red-400"}`}
                    >
                      {rd.ignored ? "Count again" : "Throw out"}
                    </button>
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The timing-system cars combined onto one roster row, each movable. */
function MatchedFromList({
  racer,
  rosterOptions,
  teamOptions,
  assigning,
  onAssign,
}: {
  racer: EtRacerPoints;
  rosterOptions: StandingsResponse["rosterOptions"];
  teamOptions: { code: string; label: string }[];
  assigning: string | null;
  onAssign: (identity: string, target: string) => void;
}) {
  if (racer.matched_from.length === 0) return null;
  return (
    <div className="pl-10 pr-4 pb-2 space-y-1">
      {racer.matched_from.map((m) => (
        <div key={m.identity} className="flex items-center gap-2 flex-wrap text-xs text-gray-400">
          <span>
            {racer.matched_from.length > 1 ? "Combined: " : "Matched: "}
            <span className="text-gray-300 font-mono">{m.car_number || "—"}</span>
            {m.name ? <span className="text-gray-300"> {m.name}</span> : null}
            {m.member_number ? <span className="text-gray-600"> · member #{m.member_number}</span> : null}
            <span className="text-gray-600"> · {m.category} · via {m.matchedBy === "manual" ? "pin" : m.matchedBy}</span>
          </span>
          <select
            value=""
            disabled={assigning === m.identity}
            onChange={(e) => e.target.value && onAssign(m.identity, e.target.value)}
            className="px-1.5 py-0.5 bg-nhra-darker border border-nhra-border rounded text-xs text-gray-300 disabled:opacity-40"
          >
            <option value="">{assigning === m.identity ? "Moving…" : "Move to…"}</option>
            <optgroup label="Teams (no roster row needed)">
              {teamOptions.map((t) => (
                <option key={`team-${t.code}`} value={`${TEAM_MATCH_PREFIX}${t.code}`}>
                  {t.label} ({t.code})
                </option>
              ))}
            </optgroup>
            <optgroup label="Roster entries">
              {rosterOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.team} · {o.label}
                  {o.eligible ? "" : " (no points)"}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
      ))}
    </div>
  );
}

function RacerTable({
  racers,
  emptyText,
  assigning,
  overrideFor,
  onToggleEligibility,
  onFixCarNumber,
  onToggleIgnored,
  rosterOptions,
  teamOptions,
  onAssign,
}: {
  racers: EtRacerPoints[];
  emptyText: string;
  assigning: string | null;
  overrideFor: (key: string) => boolean | undefined;
  onToggleEligibility: (key: string, next: boolean) => void;
  onFixCarNumber: (dedupKey: string, carNumber: string) => void;
  onToggleIgnored: (dedupKey: string, ignore: boolean) => void;
  rosterOptions: StandingsResponse["rosterOptions"];
  teamOptions: { code: string; label: string }[];
  onAssign: (identity: string, target: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (racers.length === 0) {
    return <p className="px-4 py-4 text-xs text-gray-600">{emptyText}</p>;
  }
  // One roster entry can hold a row per class, so rows key on entry + class.
  const rowKey = (r: EtRacerPoints) => `${r.key}|${r.categories[0] || ""}`;
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-gray-500 uppercase tracking-wider">
          <tr>
            <th className="w-8 py-2" />
            <th className="text-left px-2 py-2 font-medium">Car #</th>
            <th className="text-left px-2 py-2 font-medium">Driver</th>
            <th className="text-left px-2 py-2 font-medium">Board</th>
            <th className="text-left px-2 py-2 font-medium">Class</th>
            <th className="text-right px-2 py-2 font-medium">Rounds Won</th>
            <th className="text-right px-2 py-2 font-medium">Points</th>
            <th className="text-right px-2 py-2 font-medium">Matched</th>
            <th className="text-right px-2 py-2 font-medium">Status</th>
            <th className="text-right px-4 py-2 font-medium">Earns</th>
          </tr>
        </thead>
        <tbody>
          {racers.map((r) => (
            <Fragment key={rowKey(r)}>
              <tr
                className="border-t border-nhra-border/40 cursor-pointer hover:bg-nhra-darker/40"
                onClick={() => toggle(rowKey(r))}
              >
                <td className="pl-4 py-1.5 text-gray-600 text-[11px]">
                  {r.rounds.length > 0 ? (open.has(rowKey(r)) ? "▾" : "▸") : ""}
                </td>
                <td className="px-2 py-1.5 text-gray-400">
                  {r.run_car_number || r.roster_car_number || "—"}
                  {r.run_car_number &&
                    r.roster_car_number &&
                    r.run_car_number.replace(/[^0-9A-Za-z]/g, "").toUpperCase() !==
                      r.roster_car_number.replace(/[^0-9A-Za-z]/g, "").toUpperCase() && (
                      <span
                        className="ml-1 text-yellow-600"
                        title={`Roster says ${r.roster_car_number} — scoring follows the timing system`}
                      >
                        ({r.roster_car_number})
                      </span>
                    )}
                </td>
                <td className="px-2 py-1.5 text-white">
                  {r.name}
                  {r.matched_from.length > 1 && (
                    <span
                      className="ml-1.5 text-[11px] text-yellow-600"
                      title="Runs from more than one car number were combined onto this entry — expand to see and move them"
                    >
                      ({r.matched_from.length} combined)
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-gray-400">{r.division === "jr" ? "Jrs" : "Big Cars"}</td>
                <td className="px-2 py-1.5 text-gray-400">{r.categories.join(", ") || r.roster_category || "—"}</td>
                <td className="px-2 py-1.5 text-right text-gray-300">{r.roundsWon}</td>
                <td className="px-2 py-1.5 text-right font-bold text-white">{r.points}</td>
                <td className="px-2 py-1.5 text-right text-gray-500">
                  {r.matchedBy === "manual" ? (
                    "pinned"
                  ) : r.source === "tech_card" ? (
                    <span
                      className="text-yellow-600"
                      title="Not on any roster — placed on this team by their tech card's team code"
                    >
                      tech card
                    </span>
                  ) : r.matchedBy === "member" ? (
                    "member #"
                  ) : r.matchedBy === "car" ? (
                    "car #"
                  ) : r.matchedBy === "name" ? (
                    "name"
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <StatusBadge racer={r} />
                </td>
                <td className="px-4 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                  <button
                    disabled={assigning === r.key}
                    onClick={() => onToggleEligibility(r.key, !r.points_eligible)}
                    title={
                      r.points_eligible
                        ? "Mark this racer a non-points earner"
                        : "Let this racer earn points again"
                    }
                    className={`px-2 py-0.5 rounded border text-xs font-semibold transition-colors disabled:opacity-40 ${
                      r.points_eligible
                        ? "bg-green-500/15 text-green-400 border-green-500/30 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/40"
                        : "bg-gray-600/20 text-gray-400 border-gray-600/40 hover:bg-green-500/20 hover:text-green-400 hover:border-green-500/40"
                    }`}
                  >
                    {overrideFor(r.key) !== undefined ? "★ " : ""}
                    {r.points_eligible ? "Yes" : "No"}
                  </button>
                </td>
              </tr>
              {open.has(rowKey(r)) && r.rounds.length > 0 && (
                <tr className="bg-nhra-darker/40">
                  <td colSpan={10} className="py-1">
                    <MatchedFromList
                      racer={r}
                      rosterOptions={rosterOptions}
                      teamOptions={teamOptions}
                      assigning={assigning}
                      onAssign={onAssign}
                    />
                    <RoundsDetail
                      rounds={r.rounds}
                      assigning={assigning}
                      onFixCarNumber={onFixCarNumber}
                      onToggleIgnored={onToggleIgnored}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One team's tab: points summary up top, then the roster split into who is
 * gaining points right now, who isn't (out, bought back, or a non-points
 * entry), and who hasn't made a pass yet.
 */
/**
 * Minimal team-vs-team pairing plan. Greedy: always pair one car from each of
 * the two biggest remaining groups — a classic result that yields the minimum
 * possible number of same-team pairs (forced only when one team outnumbers
 * everyone else combined). The bye, when the field is odd, goes to the largest
 * group, which never increases forced pairs.
 */
function buildPairingPlan(groups: { label: string; count: number }[]): {
  cross: Map<string, number>;
  internal: Map<string, number>;
  bye: string | null;
  totalPairs: number;
  forcedPairs: number;
} {
  const work = groups.filter((g) => g.count > 0).map((g) => ({ ...g }));
  const cross = new Map<string, number>();
  const internal = new Map<string, number>();
  // The bye is decided by reaction time and bye history before this runs (see
  // chooseBye), so the odd car is already out of these counts. Any leftover
  // odd number here means a group could not be paired at all.
  const bye: string | null = null;

  let totalPairs = 0;
  for (;;) {
    work.sort((a, b) => b.count - a.count);
    const alive = work.filter((g) => g.count > 0);
    if (alive.length === 0) break;
    if (alive.length === 1) {
      // One team left with everyone else exhausted — forced in-team pairs.
      const g = alive[0];
      const pairs = Math.floor(g.count / 2);
      if (pairs > 0) internal.set(g.label, (internal.get(g.label) || 0) + pairs);
      totalPairs += pairs;
      break;
    }
    // Pair the two biggest against each other, one pair at a time (optimal,
    // and fast enough at field sizes). Key is order-normalized so "A vs B"
    // and "B vs A" tally as one matchup.
    const [a, b] = alive;
    const key = [a.label, b.label].sort().join("|");
    cross.set(key, (cross.get(key) || 0) + 1);
    a.count--;
    b.count--;
    totalPairs++;
  }

  const forcedPairs = Array.from(internal.values()).reduce((s, n) => s + n, 0);
  return { cross, internal, bye, totalPairs, forcedPairs };
}

/**
 * Best pairings for the next round of a class: counts the cars still standing
 * on each team and lays out how many of each team should run each other so
 * team-vs-team matchups are the theoretical minimum — forced only when one
 * team outnumbers everyone else combined.
 */
function PairingHelper({
  data,
  eventCode,
  season,
}: {
  data: StandingsResponse | null;
  eventCode: string;
  season: string;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [classRuns, setClassRuns] = useState<ReviewRun[]>([]);

  const mainCats = useMemo(
    () => (data?.categories || []).filter((c) => c.role === "main"),
    [data],
  );
  const activeCat = mainCats.find((c) => c.category === category) || mainCats[0];

  // Reaction times and bye history live in the run data, not the standings.
  useEffect(() => {
    if (!open || !eventCode || !season || !activeCat) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/runs?event_code=${encodeURIComponent(eventCode)}&season=${encodeURIComponent(season)}&category=${encodeURIComponent(activeCat.category)}&limit=2000&sort_by=timestamp&sort_dir=ASC`,
          { cache: "no-store" },
        );
        const body = await res.json();
        if (!cancelled) setClassRuns(body.runs || []);
      } catch {
        if (!cancelled) setClassRuns([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, eventCode, season, activeCat, data]);

  // Per car: byes already taken, and the reaction time from their latest pass.
  const carFacts = useMemo(() => {
    const facts = new Map<string, { byes: number; rt: number | null; rtRound: string; name: string; car: string }>();
    const byTs = new Map<string, ReviewRun[]>();
    for (const r of classRuns) {
      const key = r.timestamp || "";
      const arr = byTs.get(key) || [];
      arr.push(r);
      byTs.set(key, arr);
    }
    const ordered = [...classRuns].sort((a, b) =>
      elimRoundOrder((a.round || "").trim()) - elimRoundOrder((b.round || "").trim()),
    );
    for (const r of ordered) {
      if (isByeMarker(r)) continue;
      const carKey = normalizeCarKey(r.car_number);
      if (!carKey) continue;
      const f = facts.get(carKey) || { byes: 0, rt: null, rtRound: "", name: "", car: "" };
      f.car = (r.car_number || "").trim() || f.car;
      if (r.name) f.name = r.name;
      // A bye: the pass either sits alone at its timestamp or is paired with a
      // BYE placeholder lane.
      const group = byTs.get(r.timestamp || "") || [];
      const others = group.filter((g) => g !== r);
      if (isScoringRound(r.round) && (others.length === 0 || others.every(isByeMarker))) f.byes++;
      // Latest round wins for the reaction time (walk is in round order).
      if (r.rt != null) {
        f.rt = r.rt;
        f.rtRound = (r.round || "").trim();
      }
      facts.set(carKey, f);
    }
    return facts;
  }, [classRuns]);

  const groups = useMemo(() => {
    if (!data || !activeCat) return [];
    const byTeam = new Map<string, number>();
    // Cars that can no longer earn — bought back in, or a non-points entry —
    // aren't "team" cars for pairing purposes: put them in one shared pool the
    // plan can spend freely as opponents, soaking up pairings that would
    // otherwise force teammates together.
    let freeCars = 0;
    for (const t of data.teams) {
      let earning = 0;
      for (const r of t.racers) {
        if (!r.categories.includes(activeCat.category)) continue;
        if (r.status === "racing" && r.points_eligible) earning++;
        else if (r.status === "racing" && !r.points_eligible) freeCars++;
        else if (r.status === "eliminated" && r.racedAfterElimination) freeCars++;
      }
      if (earning > 0) byTeam.set(t.team_name, earning);
    }
    // Unmatched cars are still in the round draw — count them as their own
    // group so the plan reflects the real field.
    const unmatchedAlive = data.unmatched.filter(
      (u) =>
        u.category === activeCat.category &&
        !u.rounds.some((rd) => !rd.ignored && rd.outcome === "loss"),
    ).length;
    if (unmatchedAlive > 0) byTeam.set("(unassigned)", unmatchedAlive);
    if (freeCars > 0) byTeam.set("(buy-backs / non-points)", freeCars);
    return Array.from(byTeam.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }, [data, activeCat]);

  // Everyone still in, with their bye history and reaction time.
  const candidates = useMemo(() => {
    if (!data || !activeCat) return [];
    const out: ByeCandidate[] = [];
    const add = (car: string, name: string, team: string) => {
      const carKey = normalizeCarKey(car);
      const f = carFacts.get(carKey);
      out.push({
        carKey,
        car: car || "—",
        name: name || f?.name || "",
        team,
        rt: f?.rt ?? null,
        byes: f?.byes ?? 0,
        rtRound: f?.rtRound || "",
      });
    };
    for (const t of data.teams) {
      for (const r of t.racers) {
        if (r.status !== "racing" || !r.categories.includes(activeCat.category)) continue;
        // Only the points-earning field takes byes. Buy-back cars and
        // non-points entries are the free opponents that can run anyone, which
        // is worth more than a bye — and they're counted in their own pool, so
        // handing one the bye would also decrement the wrong group.
        if (!r.points_eligible) continue;
        add(r.run_car_number || r.roster_car_number, r.name, t.team_name);
      }
    }
    for (const u of data.unmatched) {
      if (u.category !== activeCat.category) continue;
      if (u.rounds.some((rd) => !rd.ignored && rd.outcome === "loss")) continue;
      add(u.car_number, u.name, "(unassigned)");
    }
    return out;
  }, [data, activeCat, carFacts]);

  const totalCars = groups.reduce((s, g) => s + g.count, 0);
  const order = useMemo(() => byeOrder(candidates), [candidates]);
  // Odd field: the bye goes to the top of the bye order, and that car leaves
  // the pairing pool before teams are matched up.
  const byeRacer = totalCars % 2 === 1 ? order[0] ?? null : null;
  const everyoneHadBye = candidates.length > 0 && candidates.every((c) => c.byes > 0);

  const pairingGroups = useMemo(() => {
    if (!byeRacer) return groups;
    return groups.map((g) => (g.label === byeRacer.team ? { ...g, count: g.count - 1 } : g));
  }, [groups, byeRacer]);

  const plan = useMemo(() => buildPairingPlan(pairingGroups), [pairingGroups]);

  return (
    <div className="mt-8 bg-nhra-card border border-nhra-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-nhra-darker/50"
      >
        <div>
          <h2 className="text-white font-bold">Pairing Helper</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Best pairings for the next round — out of what&apos;s left, how many of each team should run each other so
            teammates meet as little as possible, plus who is owed the bye on reaction time. Buy-back cars and
            non-points entries count as their own group: they can&apos;t earn, so they&apos;re free opponents.
          </p>
        </div>
        <span className="text-gray-400 text-sm">{open ? "Hide" : "Open"}</span>
      </button>

      {open && (
        <div className="border-t border-nhra-border">
          <div className="px-6 py-3 flex items-center gap-3 flex-wrap bg-nhra-darker/40">
            <label className="text-xs text-gray-400">
              Class
              <select
                value={activeCat?.category || ""}
                onChange={(e) => setCategory(e.target.value)}
                className="ml-2 px-2 py-1.5 bg-nhra-darker border border-nhra-border rounded text-xs text-white"
              >
                {mainCats.map((c) => (
                  <option key={c.category} value={c.category}>
                    {c.category}
                  </option>
                ))}
              </select>
            </label>
            {totalCars > 0 && (
              <span className="text-xs text-gray-400">
                {totalCars} car{totalCars === 1 ? "" : "s"} still in · {plan.totalPairs} pair
                {plan.totalPairs === 1 ? "" : "s"} ·{" "}
                {plan.forcedPairs === 0 ? (
                  <span className="text-green-400 font-semibold">no team-vs-team needed</span>
                ) : (
                  <span className="text-yellow-500 font-semibold">
                    {plan.forcedPairs} team-vs-team pair{plan.forcedPairs === 1 ? "" : "s"} unavoidable
                  </span>
                )}
              </span>
            )}
          </div>

          {totalCars === 0 ? (
            <p className="px-6 py-6 text-sm text-gray-500">Nobody still standing in this class.</p>
          ) : (
            <>
              <div className="px-6 py-3 border-b border-nhra-border/60">
                {byeRacer ? (
                  <>
                    <span className="text-white text-sm font-semibold">
                      Bye goes to {byeRacer.car}
                      {byeRacer.name ? ` — ${byeRacer.name}` : ""}{" "}
                      <span className="text-gray-400 font-normal">({byeRacer.team})</span>
                    </span>
                    <span className="block text-xs text-gray-500 mt-0.5">
                      Odd field, so one car sits out.{" "}
                      {byeRacer.rt != null
                        ? `Best reaction time among those owed a bye: ${byeRacer.rt.toFixed(3)}${byeRacer.rtRound ? ` (${byeRacer.rtRound})` : ""}.`
                        : "No reaction time on file for this car yet."}{" "}
                      {everyoneHadBye
                        ? "Every car in the class has had a bye, so the order is back to pure reaction time."
                        : "Cars that already had a bye drop behind those that haven't."}{" "}
                      Buy-back and non-points cars don&apos;t take byes — they can run anyone, so they&apos;re more
                      use as opponents.
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-gray-400">
                    Even field — no bye this round. The order below is who would get it.
                  </span>
                )}
                {order.length > 0 && (
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-gray-500 uppercase tracking-wider">
                        <tr>
                          <th className="text-left pr-3 py-1 font-medium">Bye order</th>
                          <th className="text-left px-2 py-1 font-medium">Car</th>
                          <th className="text-left px-2 py-1 font-medium">Driver</th>
                          <th className="text-left px-2 py-1 font-medium">Team</th>
                          <th className="text-right px-2 py-1 font-medium">Reaction</th>
                          <th className="text-right px-2 py-1 font-medium">Byes had</th>
                        </tr>
                      </thead>
                      <tbody>
                        {order.slice(0, 8).map((c, i) => (
                          <tr
                            key={c.carKey || c.car}
                            className={`border-t border-nhra-border/40 ${i === 0 && byeRacer ? "bg-green-500/10" : ""}`}
                          >
                            <td className="pr-3 py-1 text-gray-500 font-semibold">{i + 1}</td>
                            <td className="px-2 py-1 font-mono text-white">{c.car}</td>
                            <td className="px-2 py-1 text-gray-300">{c.name || "—"}</td>
                            <td className="px-2 py-1 text-gray-400">{c.team}</td>
                            <td className="px-2 py-1 text-right font-mono text-gray-300">
                              {c.rt != null ? c.rt.toFixed(3) : "—"}
                              {c.rtRound && <span className="text-gray-600"> {c.rtRound}</span>}
                            </td>
                            <td className={`px-2 py-1 text-right font-semibold ${c.byes > 0 ? "text-yellow-500" : "text-gray-500"}`}>
                              {c.byes}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            <div className="px-6 py-4 grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Still In, By Team</h3>
                <table className="w-full text-xs">
                  <tbody>
                    {groups.map((g) => (
                      <tr key={g.label} className="border-t border-nhra-border/40">
                        <td className="py-1.5 text-white">{g.label}</td>
                        <td className="py-1.5 text-right font-bold text-gray-300">{g.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                  Run These Against Each Other
                </h3>
                <table className="w-full text-xs">
                  <tbody>
                    {Array.from(plan.cross.entries())
                      .sort((a, b) => b[1] - a[1])
                      .map(([key, n]) => {
                        const [a, b] = key.split("|");
                        return (
                          <tr key={key} className="border-t border-nhra-border/40">
                            <td className="py-1.5 text-gray-300">
                              {a} <span className="text-gray-600">vs</span> {b}
                            </td>
                            <td className="py-1.5 text-right font-bold text-white">
                              {n} pair{n === 1 ? "" : "s"}
                            </td>
                          </tr>
                        );
                      })}
                    {Array.from(plan.internal.entries()).map(([team, n]) => (
                      <tr key={`int-${team}`} className="border-t border-nhra-border/40">
                        <td className="py-1.5 text-yellow-500">
                          {team} <span className="text-gray-600">vs</span> {team}{" "}
                          <span className="text-gray-600">(unavoidable — they outnumber everyone else)</span>
                        </td>
                        <td className="py-1.5 text-right font-bold text-yellow-500">
                          {n} pair{n === 1 ? "" : "s"}
                        </td>
                      </tr>
                    ))}
                    {byeRacer && (
                      <tr className="border-t border-nhra-border/40">
                        <td className="py-1.5 text-gray-400">
                          {byeRacer.car} — bye <span className="text-gray-600">({byeRacer.team})</span>
                        </td>
                        <td className="py-1.5 text-right text-gray-400">1 car</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** A car still in the class, with what the bye order needs to know. */
interface ByeCandidate {
  carKey: string;
  car: string;
  name: string;
  team: string;
  /** Reaction time from their latest completed pass, lower is better. */
  rt: number | null;
  /** Byes already taken in this class. */
  byes: number;
  /** Round their reaction time came from. */
  rtRound: string;
}

/**
 * Bye order: fewest byes taken first, then best (lowest) reaction time. A car
 * that has already had a bye drops behind everyone who hasn't; once every car
 * in the class has had one, the whole field is level again and it reverts to
 * pure reaction time — which is the rule the division runs.
 */
function byeOrder(candidates: ByeCandidate[]): ByeCandidate[] {
  return [...candidates].sort(
    (a, b) =>
      a.byes - b.byes ||
      (a.rt ?? Number.POSITIVE_INFINITY) - (b.rt ?? Number.POSITIVE_INFINITY) ||
      a.car.localeCompare(b.car),
  );
}

interface ReviewRun {
  timestamp: string | null;
  round: string | null;
  car_number: string | null;
  name: string | null;
  member_number?: string | null;
  rt: number | null;
  ft660: number | null;
  ft1320: number | null;
  dial_in: number | null;
  result: string | null;
  is_winner: number;
  is_dq: number;
  lane: string | null;
  category: string | null;
  _dedup_key?: string;
}

/**
 * Pull up one class and one round and look at every pass in it, pairs kept
 * together — with the same correction tools as the racer drill-downs, plus
 * which team each pass is crediting. The fastest way to spot a wrong car
 * number in the round that just ran.
 */
function RoundReview({
  eventCode,
  season,
  data,
  assigning,
  onFixCarNumber,
  onToggleIgnored,
}: {
  eventCode: string;
  season: string;
  data: StandingsResponse | null;
  assigning: string | null;
  onFixCarNumber: (dedupKey: string, carNumber: string) => void;
  onToggleIgnored: (dedupKey: string, ignore: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [round, setRound] = useState("");
  const [runs, setRuns] = useState<ReviewRun[]>([]);
  const [ignoredKeys, setIgnoredKeys] = useState<Set<string>>(new Set());
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [carValue, setCarValue] = useState("");

  // Classes worth reviewing: everything scored, buy-backs included.
  const reviewCats = useMemo(
    () => (data?.categories || []).filter((c) => c.role !== "ignore"),
    [data],
  );
  const activeCat = reviewCats.find((c) => c.category === category) || reviewCats[0];
  const rounds = useMemo(
    () => (activeCat?.rounds || []).filter((r) => /^(E\d+|F|FINAL)$/i.test(r.trim())),
    [activeCat],
  );
  const activeRound = rounds.includes(round) ? round : rounds[rounds.length - 1] || "";

  // Which team every timing identity is crediting, from the standings.
  const creditedTo = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of data?.teams || []) {
      for (const r of t.racers) {
        for (const m of r.matched_from) map.set(m.identity, t.team_name);
      }
    }
    for (const u of data?.unmatched || []) map.set(u.identity, "");
    return map;
  }, [data]);

  useEffect(() => {
    if (!open || !eventCode || !season || !activeCat || !activeRound) return;
    let cancelled = false;
    (async () => {
      setLoadingRuns(true);
      try {
        const [runsRes, ignRes] = await Promise.all([
          fetch(
            `/api/runs?event_code=${encodeURIComponent(eventCode)}&season=${encodeURIComponent(season)}&category=${encodeURIComponent(activeCat.category)}&round=${encodeURIComponent(activeRound)}&limit=500&sort_by=timestamp&sort_dir=ASC`,
            { cache: "no-store" },
          ),
          fetch(
            `/api/ignore-run?event_code=${encodeURIComponent(eventCode)}&season=${encodeURIComponent(season)}`,
            { cache: "no-store" },
          ),
        ]);
        const runsBody = await runsRes.json();
        const ignBody = await ignRes.json();
        if (!cancelled) {
          setRuns(runsBody.runs || []);
          setIgnoredKeys(new Set(ignBody.keys || []));
        }
      } catch {
        if (!cancelled) setRuns([]);
      } finally {
        if (!cancelled) setLoadingRuns(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `data` is a dependency on purpose: a fix or throw-out reloads the
    // standings, and this list must follow it.
  }, [open, eventCode, season, activeCat, activeRound, data]);

  // Alternate the background per timestamp group so pairs read as pairs.
  let lastTs: string | null = null;
  let stripe = false;

  return (
    <div className="mt-8 bg-nhra-card border border-nhra-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-nhra-darker/50"
      >
        <div>
          <h2 className="text-white font-bold">Round Review</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Pull up a class and a round, pass by pass — fix a wrong car number or throw out a rerun right here
          </p>
        </div>
        <span className="text-gray-400 text-sm">{open ? "Hide" : "Open"}</span>
      </button>

      {open && (
        <div className="border-t border-nhra-border">
          <div className="px-6 py-3 flex items-center gap-3 flex-wrap bg-nhra-darker/40">
            <label className="text-xs text-gray-400">
              Class
              <select
                value={activeCat?.category || ""}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setRound("");
                }}
                className="ml-2 px-2 py-1.5 bg-nhra-darker border border-nhra-border rounded text-xs text-white"
              >
                {reviewCats.map((c) => (
                  <option key={c.category} value={c.category}>
                    {c.category}
                    {c.role === "buyback" ? " (buy-back)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-gray-400">
              Round
              <select
                value={activeRound}
                onChange={(e) => setRound(e.target.value)}
                className="ml-2 px-2 py-1.5 bg-nhra-darker border border-nhra-border rounded text-xs text-white"
              >
                {rounds.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            {loadingRuns && <span className="text-xs text-gray-500">Loading…</span>}
          </div>

          {runs.length === 0 && !loadingRuns ? (
            <p className="px-6 py-6 text-sm text-gray-500">
              No elimination passes recorded in this class/round yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-gray-500 uppercase tracking-wider bg-nhra-darker">
                  <tr>
                    <th className="text-left px-6 py-2 font-medium">Time</th>
                    <th className="text-left px-2 py-2 font-medium">Lane</th>
                    <th className="text-left px-2 py-2 font-medium">Car #</th>
                    <th className="text-left px-2 py-2 font-medium">Driver</th>
                    <th className="text-left px-2 py-2 font-medium">Member #</th>
                    <th className="text-right px-2 py-2 font-medium">RT</th>
                    <th className="text-right px-2 py-2 font-medium">Dial</th>
                    <th className="text-right px-2 py-2 font-medium">ET</th>
                    <th className="text-center px-2 py-2 font-medium">Result</th>
                    <th className="text-left px-2 py-2 font-medium">Credits</th>
                    <th className="text-right px-6 py-2 font-medium">Corrections</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r, i) => {
                    if (r.timestamp !== lastTs) {
                      stripe = !stripe;
                      lastTs = r.timestamp;
                    }
                    const key = r._dedup_key || "";
                    const ignored = !!key && ignoredKeys.has(key);
                    const bye = isByeMarker(r);
                    const scoreFrom = (data?.config.scoreFromDate || "").trim();
                    const dk = runDateKey(r.timestamp);
                    const preDate =
                      (!!scoreFrom && dk < scoreFrom) ||
                      (data?.config.excludedDates || []).includes(dk) ||
                      !inDayWindow(r.timestamp, data?.config.dayWindows);
                    const ident = `${(r.category || "").trim()}|${normalizeCarKey(r.car_number) || normalizeNameKey(r.name)}`;
                    const credited = bye ? null : creditedTo.get(ident);
                    const res = (r.result || "").trim().toUpperCase();
                    const win = res === "W" || (!res && r.is_winner === 1);
                    const dim = ignored ? "opacity-50 line-through" : "";
                    const editing = editKey !== null && editKey === key;
                    const busy = assigning !== null && assigning === key;
                    return (
                      <tr key={key || i} className={`border-t border-nhra-border/40 ${stripe ? "bg-nhra-darker/30" : ""}`}>
                        <td className={`px-6 py-1.5 text-gray-500 whitespace-nowrap ${dim}`}>
                          {r.timestamp ? r.timestamp.split(" ").slice(1).join(" ") : "—"}
                        </td>
                        <td className={`px-2 py-1.5 text-gray-500 ${dim}`}>{r.lane || "—"}</td>
                        <td className={`px-2 py-1.5 font-mono text-white ${dim}`}>{r.car_number || "—"}</td>
                        <td className={`px-2 py-1.5 ${bye ? "text-gray-600 italic" : "text-gray-300"} ${dim}`}>
                          {bye ? "bye (placeholder)" : r.name || "—"}
                        </td>
                        <td className={`px-2 py-1.5 text-gray-500 ${dim}`}>{r.member_number || "—"}</td>
                        <td className={`px-2 py-1.5 text-right font-mono text-gray-400 ${dim}`}>
                          {r.rt?.toFixed(3) ?? "—"}
                        </td>
                        <td className={`px-2 py-1.5 text-right font-mono text-gray-500 ${dim}`}>
                          {r.dial_in?.toFixed(2) ?? "—"}
                        </td>
                        <td className={`px-2 py-1.5 text-right font-mono text-gray-300 ${dim}`}>
                          {finishEt(r)?.toFixed(3) ?? "—"}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          {ignored ? (
                            <span className="text-gray-500 font-semibold">out</span>
                          ) : win ? (
                            <span className="text-green-400 font-bold">W</span>
                          ) : res ? (
                            <span className="text-red-400">{res}</span>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                        <td className={`px-2 py-1.5 ${dim}`}>
                          {bye ? (
                            <span className="text-gray-600">—</span>
                          ) : preDate ? (
                            <span className="text-gray-600" title="Outside the days & hours that count for points — earns nothing">
                              not counted
                            </span>
                          ) : credited ? (
                            <span className="text-gray-300">{credited}</span>
                          ) : credited === "" ? (
                            <span className="text-yellow-500">unmatched</span>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                        <td className="px-6 py-1.5 text-right whitespace-nowrap">
                          {bye ? null : editing ? (
                            <span className="inline-flex items-center gap-1">
                              <input
                                value={carValue}
                                onChange={(e) => setCarValue(e.target.value.toUpperCase())}
                                autoFocus
                                placeholder="correct #"
                                className="w-20 px-1.5 py-0.5 bg-nhra-darker border border-nhra-border rounded text-xs text-white"
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && carValue.trim() && key) {
                                    onFixCarNumber(key, carValue.trim());
                                    setEditKey(null);
                                  }
                                  if (e.key === "Escape") setEditKey(null);
                                }}
                              />
                              <button
                                disabled={!carValue.trim() || busy}
                                onClick={() => {
                                  if (key) onFixCarNumber(key, carValue.trim());
                                  setEditKey(null);
                                }}
                                className="px-1.5 py-0.5 rounded bg-nhra-red text-white font-semibold disabled:opacity-40"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditKey(null)}
                                className="px-1 py-0.5 text-gray-500 hover:text-white"
                              >
                                ✕
                              </button>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-3">
                              <button
                                disabled={!key || busy}
                                onClick={() => {
                                  setEditKey(key);
                                  setCarValue((r.car_number || "").toUpperCase());
                                }}
                                className="text-nhra-accent hover:underline disabled:opacity-40"
                              >
                                {busy ? "Working…" : "Fix car #"}
                              </button>
                              <button
                                disabled={!key || busy}
                                onClick={() => key && onToggleIgnored(key, !ignored)}
                                className={`hover:underline disabled:opacity-40 ${ignored ? "text-green-400" : "text-gray-500 hover:text-red-400"}`}
                              >
                                {ignored ? "Count again" : "Throw out"}
                              </button>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface RacerTableHandlers {
  assigning: string | null;
  overrideFor: (key: string) => boolean | undefined;
  onToggleEligibility: (key: string, next: boolean) => void;
  onFixCarNumber: (dedupKey: string, carNumber: string) => void;
  onToggleIgnored: (dedupKey: string, ignore: boolean) => void;
  rosterOptions: StandingsResponse["rosterOptions"];
  teamOptions: { code: string; label: string }[];
  onAssign: (identity: string, target: string) => void;
}

function TeamPanel({
  team,
  rank,
  view,
  onAdjustPoints,
  ...handlers
}: {
  team: EtTeamStanding;
  rank: number;
  view: ViewMode;
  onAdjustPoints: (trackCode: string, big: number, jr: number, note: string) => void;
} & RacerTableHandlers) {
  const hasAdjustment = team.bigAdjustment !== 0 || team.jrAdjustment !== 0 || !!team.adjustmentNote;
  const [showAdjust, setShowAdjust] = useState(hasAdjustment);
  const [adjBig, setAdjBig] = useState(String(team.bigAdjustment || 0));
  const [adjJr, setAdjJr] = useState(String(team.jrAdjustment || 0));
  const [adjNote, setAdjNote] = useState(team.adjustmentNote || "");
  const adjBusy = handlers.assigning === `adjust-${team.track_code}`;
  const racers = team.racers.filter((r) => (view === "combined" ? true : r.division === view));
  const earning = racers.filter((r) => r.points_eligible && (r.status === "racing" || r.status === "winner"));
  const notEarning = racers.filter(
    (r) => r.status !== "not_entered" && !(r.points_eligible && (r.status === "racing" || r.status === "winner")),
  );
  const notEntered = racers.filter((r) => r.status === "not_entered");

  return (
    <div className="space-y-4">
      <div className="bg-nhra-card border border-nhra-border rounded-xl px-5 py-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-white font-bold text-lg">
              <span className="text-gray-500 mr-2">#{rank}</span>
              {team.team_name}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              {team.track_code}
              {team.captain ? ` · Captain ${team.captain}` : ""}
              {!team.hasRoster && <span className="ml-2 text-yellow-600">· no roster — tech cards only</span>}
            </div>
          </div>
          <div className="flex gap-6 text-right">
            <div>
              <div className="text-xs uppercase tracking-wider text-gray-500">Big Cars</div>
              <div className="text-xl font-bold text-white">{team.bigPoints}</div>
              {team.bigAdjustment !== 0 && (
                <div className="text-[11px] text-yellow-500">
                  incl. {team.bigAdjustment > 0 ? "+" : ""}
                  {team.bigAdjustment} adj
                </div>
              )}
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-gray-500">Jrs</div>
              <div className="text-xl font-bold text-white">{team.jrPoints}</div>
              {team.jrAdjustment !== 0 && (
                <div className="text-[11px] text-yellow-500">
                  incl. {team.jrAdjustment > 0 ? "+" : ""}
                  {team.jrAdjustment} adj
                </div>
              )}
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-gray-500">Total</div>
              <div className="text-xl font-bold text-nhra-red">{team.totalPoints}</div>
            </div>
            <button
              onClick={() => setShowAdjust((v) => !v)}
              className="self-start text-xs text-gray-500 hover:text-white underline decoration-dotted underline-offset-2"
            >
              {showAdjust ? "hide" : "Adjust points"}
            </button>
          </div>
        </div>
        {showAdjust && (
          <div className="mt-3 pt-3 border-t border-nhra-border/60 flex items-end gap-3 flex-wrap">
            <label className="text-xs text-gray-400">
              Big Cars +/−
              <input
                type="number"
                value={adjBig}
                onChange={(e) => setAdjBig(e.target.value)}
                className="block mt-1 w-20 px-2 py-1 bg-nhra-darker border border-nhra-border rounded text-xs text-white"
              />
            </label>
            <label className="text-xs text-gray-400">
              Jrs +/−
              <input
                type="number"
                value={adjJr}
                onChange={(e) => setAdjJr(e.target.value)}
                className="block mt-1 w-20 px-2 py-1 bg-nhra-darker border border-nhra-border rounded text-xs text-white"
              />
            </label>
            <label className="text-xs text-gray-400 flex-1 min-w-[12rem]">
              Why (shows on the board and the print)
              <input
                value={adjNote}
                onChange={(e) => setAdjNote(e.target.value)}
                placeholder="e.g. round win missed by the timing system"
                className="block mt-1 w-full px-2 py-1 bg-nhra-darker border border-nhra-border rounded text-xs text-white placeholder-gray-600"
              />
            </label>
            <button
              disabled={adjBusy}
              onClick={() =>
                onAdjustPoints(
                  team.track_code,
                  parseInt(adjBig, 10) || 0,
                  parseInt(adjJr, 10) || 0,
                  adjNote,
                )
              }
              className="px-3 py-1.5 bg-nhra-red text-white rounded-lg text-xs font-semibold hover:bg-red-600 disabled:opacity-40"
            >
              {adjBusy ? "Saving…" : "Apply Adjustment"}
            </button>
            {hasAdjustment && (
              <button
                disabled={adjBusy}
                onClick={() => {
                  setAdjBig("0");
                  setAdjJr("0");
                  setAdjNote("");
                  onAdjustPoints(team.track_code, 0, 0, "");
                }}
                className="px-3 py-1.5 bg-nhra-darker border border-nhra-border text-gray-300 rounded-lg text-xs hover:text-white disabled:opacity-40"
              >
                Clear
              </button>
            )}
            {team.adjustmentNote && (
              <span className="w-full text-xs text-yellow-500">Note: {team.adjustmentNote}</span>
            )}
          </div>
        )}
        {team.byCategory.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {team.byCategory.map((c) => (
              <span
                key={c.category}
                className="px-2.5 py-1 rounded-full text-xs font-semibold bg-nhra-darker border border-nhra-border text-gray-300"
              >
                {c.category}
                <span className="ml-1.5 text-nhra-red font-bold">{c.points}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="bg-nhra-card border border-green-500/30 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 bg-green-500/10 border-b border-green-500/30">
          <span className="text-green-400 font-bold text-sm">Gaining Points</span>
          <span className="ml-2 text-xs text-gray-400">
            {earning.length} racer{earning.length === 1 ? "" : "s"} — still in, every round win adds to the board
          </span>
        </div>
        <RacerTable racers={earning} emptyText="Nobody on this team is gaining points right now." {...handlers} />
      </div>

      <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 bg-nhra-darker border-b border-nhra-border">
          <span className="text-gray-300 font-bold text-sm">Not Gaining Points</span>
          <span className="ml-2 text-xs text-gray-500">
            {notEarning.length} racer{notEarning.length === 1 ? "" : "s"} — out, bought back, or a non-points entry
            (points already earned still count)
          </span>
        </div>
        <RacerTable racers={notEarning} emptyText="Nobody here yet." {...handlers} />
      </div>

      {notEntered.length > 0 && (
        <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-nhra-darker border-b border-nhra-border">
            <span className="text-gray-400 font-bold text-sm">No Passes Yet</span>
            <span className="ml-2 text-xs text-gray-600">
              {notEntered.length} roster entr{notEntered.length === 1 ? "y" : "ies"} without a run in a scoring class
            </span>
          </div>
          <RacerTable racers={notEntered} emptyText="" {...handlers} />
        </div>
      )}
    </div>
  );
}

export default function EtFinalsPage() {
  const live = useLiveData();
  const eventCode = live.config?.eventCode || "";
  const season = live.config?.season || "";
  const eventName = live.config?.eventName || "";
  const dataSource = live.config?.dataSource ?? "scraper";

  const [data, setData] = useState<StandingsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [view, setView] = useState<ViewMode>("combined");
  // "all" = the standings table; a track code = that team's tab.
  const [teamTab, setTeamTab] = useState<string>("all");

  const [showSetup, setShowSetup] = useState(false);
  const [showTracks, setShowTracks] = useState(false);
  const [draftTracks, setDraftTracks] = useState<Record<string, TrackName> | null>(null);
  const [savingTracks, setSavingTracks] = useState(false);
  const [showRosters, setShowRosters] = useState(false);
  const [draftConfig, setDraftConfig] = useState<EtFinalsConfig | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);

  const [showTechCards, setShowTechCards] = useState(false);
  const [techUploading, setTechUploading] = useState(false);
  const [techMsg, setTechMsg] = useState("");
  const techRef = useRef<HTMLInputElement>(null);

  const [showEdata, setShowEdata] = useState(false);
  const [edataUploading, setEdataUploading] = useState(false);
  const [edataMsg, setEdataMsg] = useState("");
  const [edataDate, setEdataDate] = useState("");
  const edataRef = useRef<HTMLInputElement>(null);

  const [setups, setSetups] = useState<SavedSetup[]>([]);
  const [showSetups, setShowSetups] = useState(false);
  const [setupName, setSetupName] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupMsg, setSetupMsg] = useState("");

  const [rosters, setRosters] = useState<RosterSummary[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [overrideTrackCode, setOverrideTrackCode] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const loadStandings = useCallback(async () => {
    if (!eventCode || !season) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/et-finals?event_code=${encodeURIComponent(eventCode)}&season=${encodeURIComponent(season)}`,
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to load standings");
      setData(body as StandingsResponse);
      // Drafts survive reloads on purpose: live polling refreshes the data
      // every interval, and clearing here would throw away half-made day
      // picks or class changes mid-click. Save paths clear their own drafts.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load standings");
    } finally {
      setLoading(false);
    }
  }, [eventCode, season]);

  const loadRosters = useCallback(async () => {
    try {
      const res = await fetch("/api/et-finals/rosters");
      const body = await res.json();
      if (res.ok) setRosters(body.rosters || []);
    } catch {
      /* the rosters panel is informational; a failure here shouldn't blank the page */
    }
  }, []);

  const loadSetups = useCallback(async () => {
    try {
      const res = await fetch("/api/et-finals/setups");
      const body = await res.json();
      if (res.ok) setSetups(body.setups || []);
    } catch {
      /* informational — a failure here shouldn't blank the page */
    }
  }, []);

  useEffect(() => {
    loadStandings();
    loadRosters();
    loadSetups();
  }, [loadStandings, loadRosters, loadSetups, live.dataVersion]);

  useEffect(() => {
    const start = live.config?.startDate;
    if (start) setEdataDate((prev) => prev || start.slice(0, 10));
  }, [live.config?.startDate]);

  // The saved config only records classes the user has actually ruled on;
  // everything else shows its auto-guess until they do.
  const effectiveConfig: EtFinalsConfig | null = draftConfig ?? data?.config ?? null;

  const setRole = (category: string, role: EtCategoryRole) => {
    const base = draftConfig ?? data?.config;
    if (!base) return;
    setDraftConfig({ ...base, categoryRoles: { ...base.categoryRoles, [category]: role } });
  };

  const setDivision = (category: string, division: EtDivision) => {
    const base = draftConfig ?? data?.config;
    if (!base) return;
    setDraftConfig({ ...base, categoryDivision: { ...base.categoryDivision, [category]: division } });
  };

  const setBuybackRounds = (category: string, raw: string) => {
    const base = draftConfig ?? data?.config;
    if (!base) return;
    const rounds = raw
      .split(/[,\s]+/)
      .map((r) => r.trim().toUpperCase())
      .filter(Boolean);
    const next = { ...base.buybackRounds };
    if (rounds.length) next[category] = rounds;
    else delete next[category];
    setDraftConfig({ ...base, buybackRounds: next });
  };

  // Hand-pin a timing-system racer onto a roster entry. Saved straight away
  // rather than batched with the class setup — it's a one-off correction and
  // waiting on a Save button would strand the fix.
  async function assignRacer(identity: string, entryKey: string) {
    const base = draftConfig ?? data?.config;
    if (!base || !eventCode || !season) return;
    const manualMatches = { ...(base.manualMatches || {}) };
    if (entryKey) manualMatches[identity] = entryKey;
    else delete manualMatches[identity];
    const next = { ...base, manualMatches };
    setDraftConfig(next);
    setAssigning(identity);
    try {
      const res = await fetch("/api/et-finals/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_code: eventCode, season, config: next }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to save");
      }
      setDraftConfig(null);
      await loadStandings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign racer");
    } finally {
      setAssigning(null);
    }
  }

  // Save the whole team-points setup — class roles and boards, buy-back rule,
  // day picks, adjustments, pins, eligibility overrides — under a name, so it
  // can be brought back after a purge, a re-created event or a changed event
  // code. Class setup is MATERIALIZED: every class is written with the role
  // and board actually in effect on screen, whether it was hand-set,
  // remembered from the season, or auto-guessed — so a restore reproduces
  // exactly what was showing, not just the hand-ruled subset.
  async function saveSetup() {
    const cfg = draftConfig ?? data?.config;
    if (!cfg) return;
    const effectiveRoles = Object.fromEntries(
      (data?.categories || []).map((c) => [c.category, cfg.categoryRoles[c.category] ?? c.role]),
    );
    const effectiveDivisions = Object.fromEntries(
      (data?.categories || []).map((c) => [
        c.category,
        cfg.categoryDivision[c.category] ?? c.division,
      ]),
    );
    const snapshot: EtFinalsConfig = {
      ...cfg,
      categoryRoles: { ...cfg.categoryRoles, ...effectiveRoles },
      categoryDivision: { ...cfg.categoryDivision, ...effectiveDivisions },
    };
    const name = setupName.trim() || `${season} ET Finals`;
    setSetupBusy(true);
    setSetupMsg("");
    try {
      const res = await fetch("/api/et-finals/setups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, season, event_code: eventCode, config: snapshot }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to save settings");
      setSetupMsg(`Saved as "${name}".`);
      setSetupName("");
      await loadSetups();
    } catch (err) {
      setSetupMsg(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSetupBusy(false);
    }
  }

  // Stamp a saved setup onto the current event.
  async function applySetup(s: SavedSetup) {
    if (!eventCode || !season) return;
    if (
      !confirm(
        `Load "${s.name}" onto this event?\n\nThis replaces the current class setup, buy-back rule, manual pins and eligibility overrides.`,
      )
    )
      return;
    setSetupBusy(true);
    setSetupMsg("");
    try {
      const res = await fetch("/api/et-finals/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_code: eventCode, season, config: s.config }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to load settings");
      setSetupMsg(`Loaded "${s.name}" onto ${eventName || eventCode}.`);
      setDraftConfig(null);
      await loadStandings();
    } catch (err) {
      setSetupMsg(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setSetupBusy(false);
    }
  }

  async function removeSetup(s: SavedSetup) {
    if (!confirm(`Delete the saved settings "${s.name}"?`)) return;
    await fetch(`/api/et-finals/setups?id=${encodeURIComponent(s.id)}`, { method: "DELETE" });
    await loadSetups();
  }

  // Correct the car number recorded on one pass. Goes through /api/edit-run,
  // which marks the row edited so a re-scrape can't put the wrong number back.
  // The pass then regroups under whoever really made it — including a racer on
  // another team when the timing crew typed someone else's number.
  async function fixCarNumber(dedupKey: string, carNumber: string) {
    if (!eventCode || !season || !carNumber.trim()) return;
    setAssigning(dedupKey);
    try {
      const res = await fetch("/api/edit-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_code: eventCode,
          season,
          dedup_key: dedupKey,
          updates: { car_number: carNumber.trim() },
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to fix the car number");
      }
      await loadStandings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fix the car number");
    } finally {
      setAssigning(null);
    }
  }

  // Hand-adjust a team's totals for when the board is known to be off.
  async function adjustTeamPoints(trackCode: string, big: number, jr: number, note: string) {
    const base = draftConfig ?? data?.config;
    if (!base) return;
    const next = { ...(base.pointsAdjustments || {}) };
    if (!big && !jr && !note.trim()) delete next[trackCode];
    else next[trackCode] = { big, jr, note: note.trim() };
    await savePointsRule({ pointsAdjustments: next }, `adjust-${trackCode}`);
  }

  // Throw a pass out (rerun — it doesn't count) or make it count again.
  async function toggleRunIgnored(dedupKey: string, ignore: boolean) {
    if (!eventCode || !season) return;
    setAssigning(dedupKey);
    try {
      const res = await fetch("/api/ignore-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_code: eventCode,
          season,
          dedup_key: dedupKey,
          ...(ignore ? {} : { action: "restore" }),
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to update the pass");
      }
      await loadStandings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update the pass");
    } finally {
      setAssigning(null);
    }
  }

  // Whether buy-back winners keep earning points afterwards. Saved immediately
  // — it's a race-day rules call, not part of the class mapping batch.
  async function setBuybackEarns(earns: boolean) {
    await savePointsRule({ buybackEarnsPoints: earns }, "buyback-policy");
  }

  // Choose whether a day's passes count for points. Toggles are local and
  // instant — nothing saves until "Save Days" — so the boxes can't flicker
  // against in-flight reloads. Exclusions are stored by date, so a day nobody
  // has ruled on (race morning) counts by default. Toggling folds the older
  // from-date rule into explicit exclusions, making the boxes the single
  // source of truth.
  function setDayCounts(date: string, counts: boolean) {
    const base = draftConfig ?? data?.config;
    if (!base) return;
    const excluded = new Set(base.excludedDates || []);
    const from = (base.scoreFromDate || "").trim();
    if (from) for (const d of data?.runDates || []) if (d < from) excluded.add(d);
    if (counts) excluded.delete(date);
    else excluded.add(date);
    setDraftConfig({
      ...base,
      excludedDates: Array.from(excluded).sort(),
      scoreFromDate: null,
    });
  }

  // Counting hours for one day. Saves itself — a time typed and walked away
  // from used to sit in an unsaved draft and quietly do nothing.
  function setDayWindow(date: string, field: "from" | "to", value: string, commit = false) {
    const base = draftConfig ?? data?.config;
    if (!base) return;
    const windows = { ...(base.dayWindows || {}) };
    const cur = { ...(windows[date] || {}) };
    if (value) cur[field] = value;
    else delete cur[field];
    if (!cur.from && !cur.to) delete windows[date];
    else windows[date] = cur;
    if (commit) savePointsRule({ dayWindows: windows }, `window-${date}`);
    else setDraftConfig({ ...base, dayWindows: windows });
  }

  // Lock out everything already run: every pass on file right now is thrown
  // out, so only passes recorded from here on count. No clock or date
  // reasoning — the surest way to draw a line under a session that has
  // already happened (a race that ran past midnight, a test session).
  async function lockRunsSoFar() {
    if (!eventCode || !season) return;
    if (
      !confirm(
        "Lock out every run recorded so far?\n\nEverything already on file stops counting for team points — only passes that arrive from now on will score. Individual passes can still be put back one at a time in Round Review.",
      )
    )
      return;
    setAssigning("lock-so-far");
    try {
      const res = await fetch(
        `/api/runs?event_code=${encodeURIComponent(eventCode)}&season=${encodeURIComponent(season)}&limit=5000&sort_by=timestamp&sort_dir=ASC`,
        { cache: "no-store" },
      );
      const body = await res.json();
      const keys = (body.runs || [])
        .map((r: { _dedup_key?: string }) => r._dedup_key)
        .filter(Boolean);
      if (keys.length === 0) throw new Error("No runs on file to lock out.");
      const lockRes = await fetch("/api/ignore-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_code: eventCode, season, dedup_keys: keys }),
      });
      if (!lockRes.ok) {
        const b = await lockRes.json();
        throw new Error(b.error || "Failed to lock the runs out");
      }
      setError("");
      await loadStandings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to lock the runs out");
    } finally {
      setAssigning(null);
    }
  }

  // Do the day choices on screen differ from what's saved?
  const daysDirty = useMemo(() => {
    if (!draftConfig || !data) return false;
    const saved = data.config;
    return (
      JSON.stringify([...(draftConfig.excludedDates || [])].sort()) !==
        JSON.stringify([...(saved.excludedDates || [])].sort()) ||
      (draftConfig.scoreFromDate || null) !== (saved.scoreFromDate || null) ||
      JSON.stringify(draftConfig.dayWindows || {}) !== JSON.stringify(saved.dayWindows || {})
    );
  }, [draftConfig, data]);

  async function savePointsRule(patch: Partial<EtFinalsConfig>, busyKey: string) {
    const base = draftConfig ?? data?.config;
    if (!base || !eventCode || !season) return;
    const next = { ...base, ...patch };
    setDraftConfig(next);
    setAssigning(busyKey);
    try {
      const res = await fetch("/api/et-finals/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_code: eventCode, season, config: next }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to save");
      }
      setDraftConfig(null);
      await loadStandings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the points rule");
    } finally {
      setAssigning(null);
    }
  }

  // Force a racer's points eligibility on or off, for when the roster sheet
  // has it wrong. Saved immediately, like a pin.
  async function setEligibility(entryKey: string, eligible: boolean | null) {
    const base = draftConfig ?? data?.config;
    if (!base || !eventCode || !season) return;
    const overrides = { ...(base.eligibilityOverrides || {}) };
    if (eligible === null) delete overrides[entryKey];
    else overrides[entryKey] = eligible;
    const next = { ...base, eligibilityOverrides: overrides };
    setDraftConfig(next);
    setAssigning(entryKey);
    try {
      const res = await fetch("/api/et-finals/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_code: eventCode, season, config: next }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to save");
      }
      setDraftConfig(null);
      await loadStandings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change eligibility");
    } finally {
      setAssigning(null);
    }
  }

  async function handleTechCardUpload(files: File[]) {
    const valid = files.filter((f) => ["xlsx", "xls", "csv"].includes(f.name.split(".").pop()?.toLowerCase() || ""));
    if (valid.length === 0) {
      setTechMsg("Tech card exports are .xlsx / .xls / .csv.");
      return;
    }
    setTechUploading(true);
    setTechMsg("");
    const lines: string[] = [];
    for (const file of valid) {
      const form = new FormData();
      form.append("file", file);
      if (eventName) form.append("event_name", eventName);
      try {
        const res = await fetch("/api/tech-cards", { method: "POST", body: form });
        const body = await res.json();
        if (!res.ok) lines.push(`${file.name}: ${body.error || "failed"}`);
        else lines.push(`${file.name}: ${body.saved} saved, ${body.skipped} skipped of ${body.total}`);
      } catch {
        lines.push(`${file.name}: network error`);
      }
    }
    setTechMsg(lines.join("\n"));
    setTechUploading(false);
    if (techRef.current) techRef.current.value = "";
    // Tech cards change who matches to which team, so recompute.
    await loadStandings();
  }

  async function handleEdataUpload(files: File[]) {
    const valid = files.filter((f) => /\.(txt|dat)$/i.test(f.name));
    if (valid.length === 0) {
      setEdataMsg("EData files are .TXT (C11EDAT.TXT, C12EDAT.TXT, …).");
      return;
    }
    if (!eventCode || !season) {
      setEdataMsg("Load an event first.");
      return;
    }
    setEdataUploading(true);
    setEdataMsg("");
    try {
      const form = new FormData();
      for (const f of valid) form.append("files", f);
      form.append("event_code", eventCode);
      form.append("season", season);
      if (edataDate) form.append("race_date", edataDate);
      if (eventName) form.append("event_name", eventName);
      if (live.config?.eventType) form.append("event_type", live.config.eventType);
      const res = await fetch("/api/edata", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Upload failed");
      setEdataMsg(
        [
          `${body.totalInserted} run${body.totalInserted === 1 ? "" : "s"} imported from ${body.files} file${body.files === 1 ? "" : "s"}.`,
          ...(body.perFile || []).map(
            (f: { name: string; category: string; rounds: string[]; parsed: number; inserted: number; error?: string }) =>
              f.error
                ? `  ${f.name}: ${f.error}`
                : `  ${f.name} — ${f.category || "?"} · ${f.rounds.join(" ") || "no rounds"} · ${f.inserted} new of ${f.parsed}`,
          ),
          ...(body.perFile || []).flatMap((f: { warnings: string[] }) => (f.warnings || []).map((w) => `  ! ${w}`)),
        ].join("\n"),
      );
    } catch (err) {
      setEdataMsg(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setEdataUploading(false);
      if (edataRef.current) edataRef.current.value = "";
    }
    await loadStandings();
  }

  function setTrackField(code: string, field: keyof TrackName, value: string) {
    const base = draftTracks ?? data?.trackNames ?? {};
    const existing = base[code] || { track_name: "", team_name: "" };
    setDraftTracks({ ...base, [code]: { ...existing, [field]: value } });
  }

  async function saveTrackNames() {
    if (!draftTracks || !season) return;
    setSavingTracks(true);
    try {
      const res = await fetch("/api/et-finals/tracks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ season, tracks: draftTracks }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to save");
      }
      setDraftTracks(null);
      await loadStandings();
      await loadRosters();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save track names");
    } finally {
      setSavingTracks(false);
    }
  }

  async function recodeRoster(id: string, current: string) {
    const next = prompt(
      `Track code for this roster.\n\nIts racers' car numbers move with it, so use the code the tech cards and the timing system show (e.g. "ND" for Numidia).`,
      current,
    );
    if (!next || next.trim().toUpperCase() === current.toUpperCase()) return;
    try {
      const res = await fetch("/api/et-finals/rosters", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, track_code: next.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to change the track code");
      await loadRosters();
      await loadStandings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change the track code");
    }
  }

  async function saveConfig() {
    if (!draftConfig || !eventCode || !season) return;
    setSavingConfig(true);
    try {
      const res = await fetch("/api/et-finals/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_code: eventCode, season, config: draftConfig }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to save");
      }
      setDraftConfig(null);
      await loadStandings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save class setup");
    } finally {
      setSavingConfig(false);
    }
  }

  async function handleUpload(files: File[]) {
    const valid = files.filter((f) =>
      ["xlsx", "xls", "numbers"].includes(f.name.split(".").pop()?.toLowerCase() || ""),
    );
    if (valid.length === 0) {
      setUploadMsg("Upload rosters as .xlsx, .xls or Apple .numbers files.");
      return;
    }
    setUploading(true);
    setUploadMsg("");
    const results: string[] = [];
    for (const file of valid) {
      const form = new FormData();
      form.append("file", file);
      if (season) form.append("season", season);
      // Only safe to apply when uploading one file: it names one team.
      if (valid.length === 1 && overrideTrackCode.trim()) form.append("track_code", overrideTrackCode.trim());
      try {
        const res = await fetch("/api/et-finals/rosters", { method: "POST", body: form });
        const body = await res.json();
        if (!res.ok) results.push(`${file.name}: ${body.error || "failed"}`);
        else
          results.push(
            `${body.team_name || body.track_code} (${body.track_code}): ${body.bigEntries} big cars, ${body.jrPointsEntries} of ${body.jrEntries} jrs scoring`,
          );
      } catch {
        results.push(`${file.name}: network error`);
      }
    }
    setUploadMsg(results.join("\n"));
    setUploading(false);
    setOverrideTrackCode("");
    await loadRosters();
    await loadStandings();
  }

  async function deleteRoster(id: string, label: string) {
    if (!confirm(`Remove the roster for ${label}? Its racers stop scoring until it is uploaded again.`)) return;
    await fetch(`/api/et-finals/rosters?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadRosters();
    await loadStandings();
  }

  // Marks a racer whose eligibility was set by hand rather than read off the
  // roster, so an override is never invisible.
  const overrideFor = (key: string): boolean | undefined =>
    (draftConfig ?? data?.config)?.eligibilityOverrides?.[key];

  const sortedTeams = useMemo(() => {
    if (!data) return [];
    const pointsOf = (t: EtTeamStanding) =>
      view === "big" ? t.bigPoints : view === "jr" ? t.jrPoints : t.totalPoints;
    return [...data.teams].sort((a, b) => pointsOf(b) - pointsOf(a) || a.team_name.localeCompare(b.team_name));
  }, [data, view]);

  // The selected team tab, or null for the standings table. A stale tab (its
  // roster was just deleted) falls back to the table rather than a blank page.
  const activeTeam = useMemo(
    () => (teamTab === "all" ? null : sortedTeams.find((t) => t.track_code === teamTab) ?? null),
    [teamTab, sortedTeams],
  );

  const techPlaced = useMemo(
    () => (data?.teams || []).reduce((n, t) => n + t.racersFromTechCards, 0),
    [data],
  );
  const jrTechPlaced = useMemo(
    () =>
      (data?.teams || []).reduce(
        (n, t) =>
          n + t.racers.filter((r) => r.source === "tech_card" && r.division === "jr").length,
        0,
      ),
    [data],
  );

  // Every team a racer can be hand-placed onto: teams on the board plus codes
  // known only from tech cards or the track directory.
  const teamOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const t of data?.teams || []) seen.set(t.track_code, t.team_name);
    for (const tc of data?.trackCodes || []) {
      if (!seen.has(tc.code)) {
        const named = (data?.trackNames || {})[tc.code];
        seen.set(tc.code, named?.team_name || named?.track_name || tc.code);
      }
    }
    return Array.from(seen.entries())
      .map(([code, label]) => ({ code, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [data]);

  const [unmatchedOpen, setUnmatchedOpen] = useState<Set<string>>(new Set());

  const mainCategories = useMemo(
    () => (data?.categories || []).filter((c) => c.role === "main"),
    [data],
  );
  const buybackCategories = useMemo(
    () => (data?.categories || []).filter((c) => c.role === "buyback"),
    [data],
  );

  // What goes on the published points sheet. The per-team earner lists spell
  // out every car a team has in the race, which isn't always wanted in
  // something being sent out, so each part can be left off.
  const [pubEarners, setPubEarners] = useState(true);
  const [pubCarCounts, setPubCarCounts] = useState(false);
  // Car numbers never appear on a published sheet — it is read by name.

  // A public, standings-only link for teams and the tower. Read-only and
  // credential-free; deliberately carries no per-team breakdown.
  const [copiedLink, setCopiedLink] = useState(false);
  async function copyShareLink() {
    if (!eventCode || !season) return;
    // Short form: /p/EVENT-SEASON[-big|-jr]. The board refreshes at whatever
    // interval this event polls at, so the shared page stays in step with the
    // data behind it (10 minutes when polling is off).
    const refresh = live.config?.intervalSeconds || 0;
    const url = `${window.location.origin}/p/${encodeURIComponent(eventCode)}-${encodeURIComponent(season)}${
      view !== "combined" ? `-${view}` : ""
    }${refresh > 0 ? `?refresh=${refresh}` : ""}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      window.open(url, "_blank");
    }
  }

  // Plain-text copy of the publication for pasting into an email — the same
  // content as the print, formatted to survive email clients unmangled.
  const [copiedPub, setCopiedPub] = useState(false);
  async function copyPublication() {
    if (!data) return;
    const teams = [...data.teams].sort(
      (a, b) => b.totalPoints - a.totalPoints || a.team_name.localeCompare(b.team_name),
    );
    const dateStr = new Date().toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const lines: string[] = [];
    lines.push("SUMMIT E.T. FINALS — TEAM POINTS");
    lines.push(
      [eventName || eventCode, season, dateStr].filter(Boolean).join(" · ") +
        (data.roundsScored.length ? ` · Rounds scored: ${data.roundsScored.join(", ")}` : ""),
    );
    if (effectiveConfig?.buybackEarnsPoints) lines.push("Buy-back winners keep earning points");
    if ((effectiveConfig?.excludedDates || []).length)
      lines.push(`Days not counted: ${(effectiveConfig?.excludedDates || []).join(", ")}`);
    if (Object.keys(effectiveConfig?.dayWindows || {}).length)
      lines.push(
        `Counted hours: ${Object.entries(effectiveConfig?.dayWindows || {})
          .map(([d, w]) => `${d} ${w.from || "start"}–${w.to || "end"}`)
          .join("; ")}`,
      );
    lines.push("");
    lines.push("STANDINGS");
    teams.forEach((t, i) => {
      const cars = t.racers.filter((r) => r.status === "racing").length;
      lines.push(
        `${i + 1}. ${t.team_name}${t.track_code ? ` (${t.track_code})` : ""} — Big Cars ${t.bigPoints}, Jrs ${t.jrPoints}, Total ${t.totalPoints}${
          pubCarCounts ? `, ${cars} still in` : ""
        }`,
      );
    });
    const adjusted = teams.filter((t) => t.bigAdjustment !== 0 || t.jrAdjustment !== 0);
    if (adjusted.length) {
      lines.push("");
      lines.push(
        "Hand adjustments included: " +
          adjusted
            .map(
              (t) =>
                `${t.team_name} ${[
                  t.bigAdjustment ? `big ${t.bigAdjustment > 0 ? "+" : ""}${t.bigAdjustment}` : "",
                  t.jrAdjustment ? `jrs ${t.jrAdjustment > 0 ? "+" : ""}${t.jrAdjustment}` : "",
                ]
                  .filter(Boolean)
                  .join(", ")}${t.adjustmentNote ? ` (${t.adjustmentNote})` : ""}`,
            )
            .join("; "),
      );
    }
    if (!pubEarners) {
      try {
        await navigator.clipboard.writeText(lines.join("\n"));
        setCopiedPub(true);
        setTimeout(() => setCopiedPub(false), 2500);
      } catch {
        setError("Couldn't reach the clipboard — use Print for Publication instead.");
      }
      return;
    }

    lines.push("");
    lines.push("POINT EARNERS BY TEAM");
    for (const t of teams) {
      const earners = t.racers.filter((r) => r.points > 0);
      if (earners.length === 0) continue;
      lines.push("");
      lines.push(`${t.team_name}${t.track_code ? ` (${t.track_code})` : ""} — ${t.totalPoints} point${t.totalPoints === 1 ? "" : "s"}`);
      for (const r of earners) {
        lines.push(
          `  ${r.name} — ${r.division === "jr" ? "Jr" : "Big Car"}, ${r.categories.join(", ") || r.roster_category || "?"} — ${r.roundsWon} round${r.roundsWon === 1 ? "" : "s"}, ${r.points} pt${r.points === 1 ? "" : "s"}`,
        );
      }
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopiedPub(true);
      setTimeout(() => setCopiedPub(false), 2500);
    } catch {
      setError("Couldn't reach the clipboard — use Print for Publication instead.");
    }
  }

  // Publication print: standings plus each team's point earners, black on
  // white, opened in its own window so the print carries none of the app UI.
  function printPublication() {
    if (!data) return;
    const esc = (v: string | null | undefined): string =>
      String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const dateStr = new Date().toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const teams = [...data.teams].sort((a, b) => b.totalPoints - a.totalPoints || a.team_name.localeCompare(b.team_name));

    const standingsRows = teams
      .map(
        (t, i) => `<tr>
          <td class="c">${i + 1}</td>
          <td>${esc(t.team_name)}${t.track_code ? ` <span class="dim">(${esc(t.track_code)})</span>` : ""}</td>
          <td class="r">${t.bigPoints}</td>
          <td class="r">${t.jrPoints}</td>
          <td class="r total">${t.totalPoints}</td>
          ${pubCarCounts ? `<td class="r">${t.racers.filter((r) => r.status === "racing").length}</td>` : ""}
        </tr>`,
      )
      .join("");

    const adjustedTeams = teams.filter((t) => t.bigAdjustment !== 0 || t.jrAdjustment !== 0);
    const adjustmentsNote = adjustedTeams.length
      ? `<p class="sub">Hand adjustments included: ${adjustedTeams
          .map(
            (t) =>
              `${esc(t.team_name)} ${[
                t.bigAdjustment ? `big ${t.bigAdjustment > 0 ? "+" : ""}${t.bigAdjustment}` : "",
                t.jrAdjustment ? `jrs ${t.jrAdjustment > 0 ? "+" : ""}${t.jrAdjustment}` : "",
              ]
                .filter(Boolean)
                .join(", ")}${t.adjustmentNote ? ` (${esc(t.adjustmentNote)})` : ""}`,
          )
          .join("; ")}</p>`
      : "";

    const teamBlocks = teams
      .map((t) => {
        const earners = t.racers.filter((r) => r.points > 0);
        if (earners.length === 0) return "";
        const rows = earners
          .map(
            (r) => `<tr>
              <td>${esc(r.name)}</td>
              <td>${r.division === "jr" ? "Jr" : "Big Car"}</td>
              <td>${esc(r.categories.join(", ") || r.roster_category)}</td>
              <td class="r">${r.roundsWon}</td>
              <td class="r total">${r.points}</td>
            </tr>`,
          )
          .join("");
        return `<div class="team">
          <h3>${esc(t.team_name)}${t.track_code ? ` (${esc(t.track_code)})` : ""} — ${t.totalPoints} point${t.totalPoints === 1 ? "" : "s"}</h3>
          <table>
            <thead><tr><th>Driver</th><th>Board</th><th>Class</th><th class="r">Rounds Won</th><th class="r">Points</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
      })
      .join("");

    const html = `<!DOCTYPE html><html><head><title>Team Points — ${esc(eventName || eventCode)}</title>
      <style>
        body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; margin: 24px; }
        h1 { font-size: 20px; margin: 0 0 2px; }
        h2 { font-size: 14px; margin: 18px 0 6px; text-transform: uppercase; letter-spacing: 0.05em; }
        h3 { font-size: 12px; margin: 14px 0 4px; }
        .sub { color: #444; font-size: 11px; margin-bottom: 14px; }
        table { border-collapse: collapse; width: 100%; font-size: 11px; }
        th, td { border: 1px solid #999; padding: 3px 6px; text-align: left; }
        th { background: #eee; text-transform: uppercase; font-size: 9px; letter-spacing: 0.04em; }
        td.r, th.r { text-align: right; }
        td.c { text-align: center; }
        td.total { font-weight: bold; }
        .dim { color: #666; }
        .team { break-inside: avoid; page-break-inside: avoid; }
        @media print { body { margin: 0.4in; } }
      </style></head><body>
      <h1>Summit E.T. Finals — Team Points</h1>
      <div class="sub">${esc(eventName || eventCode)} · ${esc(season)} · ${esc(dateStr)}${
        data.roundsScored.length ? ` · Rounds scored: ${esc(data.roundsScored.join(", "))}` : ""
      }${effectiveConfig?.buybackEarnsPoints ? " · Buy-back winners keep earning points" : ""}${
        effectiveConfig?.scoreFromDate ? ` · Points from ${esc(effectiveConfig.scoreFromDate)}` : ""
      }${
        (effectiveConfig?.excludedDates || []).length
          ? ` · Days not counted: ${esc((effectiveConfig?.excludedDates || []).join(", "))}`
          : ""
      }${
        Object.keys(effectiveConfig?.dayWindows || {}).length
          ? ` · Counted hours: ${esc(
              Object.entries(effectiveConfig?.dayWindows || {})
                .map(([d, w]) => `${d} ${w.from || "start"}–${w.to || "end"}`)
                .join("; "),
            )}`
          : ""
      }</div>
      <h2>Standings</h2>
      <table>
        <thead><tr><th class="c">Place</th><th>Team</th><th class="r">Big Cars</th><th class="r">Jrs</th><th class="r">Total</th>${
          pubCarCounts ? '<th class="r">Still In</th>' : ""
        }</tr></thead>
        <tbody>${standingsRows}</tbody>
      </table>
      ${adjustmentsNote}
      ${pubEarners ? `<h2>Point Earners by Team</h2>${teamBlocks || '<p class="sub">No points scored yet.</p>'}` : ""}
      <script>window.onload = () => window.print();</script>
      </body></html>`;

    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    w.document.write(html);
    w.document.close();
  }

  function exportStandings() {
    if (!data) return;
    downloadCsv(
      `et-finals-points-d1-${eventCode}-${season}.csv`,
      ["Rank", "Team", "Track Code", "Big Cars", "Jrs", "Total"],
      sortedTeams.map((t, i) => [
        String(i + 1),
        t.team_name,
        t.track_code,
        String(t.bigPoints),
        String(t.jrPoints),
        String(t.totalPoints),
      ]),
    );
  }

  function exportRacers() {
    if (!data) return;
    downloadCsv(
      `et-finals-points-d1-racers-${eventCode}-${season}.csv`,
      ["Team", "Track Code", "Division", "Roster Class", "Car #", "Driver", "Points", "Rounds Won", "Status", "Out In", "Eligible", "Source"],
      data.teams.flatMap((t) =>
        t.racers.map((r) => [
          t.team_name,
          t.track_code,
          r.division === "jr" ? "Jrs" : "Big Cars",
          r.roster_category,
          r.run_car_number || r.roster_car_number,
          r.name,
          String(r.points),
          String(r.roundsWon),
          r.status,
          r.eliminatedIn || "",
          r.points_eligible ? "Yes" : "No",
          r.source === "tech_card" ? "Tech card" : "Roster",
        ]),
      ),
    );
  }

  if (!eventCode || !season) {
    return (
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2">ET Finals Points D1</h1>
        <p className="text-gray-400 mb-6">Team points for the Summit E.T. Finals and JDRL / Jr Street championship.</p>
        <div className="bg-nhra-card border border-nhra-border rounded-xl px-6 py-10 text-center">
          <p className="text-gray-400">Load an event first — set it up on the Dashboard, then come back.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto pb-16">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-white mb-1">ET Finals Points D1</h1>
          <p className="text-gray-400">
            {eventName || eventCode} · 1 point per main-race round win, per points-earning racer
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadStandings}
            disabled={loading}
            className="px-4 py-2 bg-nhra-red text-white rounded-lg text-sm font-semibold hover:bg-red-600 disabled:opacity-40"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <label
            className="flex items-center gap-2 px-3 py-2 bg-nhra-darker border border-nhra-border rounded-lg text-xs text-gray-400 cursor-pointer select-none"
            title="Off: the sheet is standings only, which doesn't spell out how many cars each team has in the race"
          >
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-red-600"
              checked={pubEarners}
              onChange={(e) => setPubEarners(e.target.checked)}
            />
            List drivers
          </label>
          <label
            className="flex items-center gap-2 px-3 py-2 bg-nhra-darker border border-nhra-border rounded-lg text-xs text-gray-400 cursor-pointer select-none"
            title="Adds a 'Still In' column showing how many cars each team has left"
          >
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-red-600"
              checked={pubCarCounts}
              onChange={(e) => setPubCarCounts(e.target.checked)}
            />
            Cars still in
          </label>
          <button
            onClick={printPublication}
            disabled={!data}
            className="px-4 py-2 bg-nhra-darker border border-nhra-border text-gray-300 rounded-lg text-sm hover:text-white disabled:opacity-40"
          >
            Print for Publication
          </button>
          <button
            onClick={copyShareLink}
            disabled={!eventCode}
            title="A public, read-only page with just the standings — no team breakdowns"
            className={`px-4 py-2 rounded-lg text-sm disabled:opacity-40 border ${
              copiedLink
                ? "bg-green-500/15 border-green-500/40 text-green-400"
                : "bg-nhra-darker border-nhra-border text-gray-300 hover:text-white"
            }`}
          >
            {copiedLink ? "Link copied" : "Share Points Link"}
          </button>
          <button
            onClick={copyPublication}
            disabled={!data}
            className={`px-4 py-2 rounded-lg text-sm disabled:opacity-40 border ${
              copiedPub
                ? "bg-green-500/15 border-green-500/40 text-green-400"
                : "bg-nhra-darker border-nhra-border text-gray-300 hover:text-white"
            }`}
          >
            {copiedPub ? "Copied — paste into an email" : "Copy for Email"}
          </button>
          <button
            onClick={exportStandings}
            disabled={!data}
            className="px-4 py-2 bg-nhra-darker border border-nhra-border text-gray-300 rounded-lg text-sm hover:text-white disabled:opacity-40"
          >
            Export Standings
          </button>
          <button
            onClick={exportRacers}
            disabled={!data}
            className="px-4 py-2 bg-nhra-darker border border-nhra-border text-gray-300 rounded-lg text-sm hover:text-white disabled:opacity-40"
          >
            Export Racers
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 bg-red-500/10 border border-red-500/40 text-red-400 rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* ── Totals ─────────────────────────────────────────────────────── */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          {[
            { label: "Big Cars", value: data.totals.bigPoints, accent: "text-white" },
            { label: "Jrs", value: data.totals.jrPoints, accent: "text-white" },
            { label: "Combined", value: data.totals.totalPoints, accent: "text-nhra-red" },
            {
              label: "Teams",
              value: data.teams.length,
              accent: "text-white",
            },
          ].map((s) => (
            <div key={s.label} className="bg-nhra-card border border-nhra-border rounded-xl px-4 py-3">
              <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">{s.label}</div>
              <div className={`text-2xl font-bold ${s.accent}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Setup warnings ─────────────────────────────────────────────── */}
      {data && techPlaced > 0 && (
        <div className="mb-6 bg-nhra-card border border-nhra-border rounded-xl px-4 py-3 text-sm">
          <span className="text-white font-semibold">{techPlaced}</span>
          <span className="text-gray-400">
            {" "}
            racer{techPlaced === 1 ? "" : "s"} placed on a team by the track code in their car number
            (or their tech card), with no roster entry claiming them. They earn like anyone else —
            the roster only marks who does <em>not</em> earn, which is junior roster rows 11 and up.
            Use the <span className="text-gray-300">Earns</span> toggle in the team drill-down for
            any that shouldn&apos;t be scoring.
          </span>
        </div>
      )}
      {data && data.rosterCount === 0 && (
        <div className="mb-6 bg-yellow-500/10 border border-yellow-500/40 text-yellow-500 rounded-xl px-4 py-3 text-sm">
          No team rosters uploaded yet. Nothing can score until at least one roster is loaded — open{" "}
          <button onClick={() => setShowRosters(true)} className="underline font-semibold">
            Team Rosters
          </button>{" "}
          below.
        </div>
      )}
      {data && data.rosterCount > 0 && mainCategories.length === 0 && (
        <div className="mb-6 bg-yellow-500/10 border border-yellow-500/40 text-yellow-500 rounded-xl px-4 py-3 text-sm">
          No classes are marked as the main race, so nothing is scoring. Set them in{" "}
          <button onClick={() => setShowSetup(true)} className="underline font-semibold">
            Class Setup
          </button>
          .
        </div>
      )}

      {/* ── Track names ────────────────────────────────────────────────── */}
      <div className="bg-nhra-card border border-nhra-border rounded-xl mb-6 overflow-hidden">
        <button
          onClick={() => setShowTracks((v) => !v)}
          className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-nhra-darker/50"
        >
          <div>
            <h2 className="text-white font-bold">Track Names</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {(data?.trackCodes || []).length} team code
              {(data?.trackCodes || []).length === 1 ? "" : "s"} in play ·{" "}
              {Object.keys(data?.trackNames || {}).length} named
            </p>
          </div>
          <span className="text-gray-400 text-sm">{showTracks ? "Hide" : "Edit"}</span>
        </button>

        {showTracks && (
          <div className="border-t border-nhra-border">
            <div className="px-6 py-3 bg-nhra-darker/50 text-xs text-gray-400 leading-relaxed">
              Name the track behind each team code. Roster templates often arrive with the track
              name blank and a tech card only ever gives the bare code, so what a team shows up as
              on the board is set here — it flows through the standings, the drill-downs and the
              exports. Leave both boxes empty to fall back to whatever the roster said.
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-nhra-darker text-gray-400 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-6 py-2 font-medium w-20">Code</th>
                    <th className="text-left px-3 py-2 font-medium">Track Name</th>
                    <th className="text-left px-3 py-2 font-medium">Team Name (optional)</th>
                    <th className="text-right px-6 py-2 font-medium">Seen In</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.trackCodes || []).map((tc) => {
                    const v = (draftTracks ?? data?.trackNames ?? {})[tc.code] || {
                      track_name: "",
                      team_name: "",
                    };
                    return (
                      <tr key={tc.code} className="border-t border-nhra-border/60">
                        <td className="px-6 py-2 font-bold text-white">{tc.code}</td>
                        <td className="px-3 py-2">
                          <input
                            value={v.track_name}
                            onChange={(e) => setTrackField(tc.code, "track_name", e.target.value)}
                            placeholder="e.g. Numidia Dragway"
                            className="w-full px-2 py-1 bg-nhra-darker border border-nhra-border rounded text-xs text-white placeholder-gray-600"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            value={v.team_name}
                            onChange={(e) => setTrackField(tc.code, "team_name", e.target.value)}
                            placeholder="defaults to the track name"
                            className="w-full px-2 py-1 bg-nhra-darker border border-nhra-border rounded text-xs text-white placeholder-gray-600"
                          />
                        </td>
                        <td className="px-6 py-2 text-right text-xs text-gray-500">
                          {tc.hasRoster ? "roster" : ""}
                          {tc.hasRoster && tc.techCardCount ? " · " : ""}
                          {tc.techCardCount ? `${tc.techCardCount} tech cards` : ""}
                          {!tc.hasRoster && !tc.techCardCount ? "—" : ""}
                        </td>
                      </tr>
                    );
                  })}
                  {(data?.trackCodes || []).length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                        No team codes yet — upload a roster or some tech cards.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-3 border-t border-nhra-border flex items-center justify-between gap-3">
              <p className="text-xs text-gray-500">
                {draftTracks ? "Unsaved changes" : "A code with no name shows whatever its roster said."}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setDraftTracks(null)}
                  disabled={!draftTracks || savingTracks}
                  className="px-4 py-2 bg-nhra-darker border border-nhra-border text-gray-300 rounded-lg text-sm hover:text-white disabled:opacity-30"
                >
                  Discard
                </button>
                <button
                  onClick={saveTrackNames}
                  disabled={!draftTracks || savingTracks}
                  className="px-4 py-2 bg-nhra-red text-white rounded-lg text-sm font-semibold hover:bg-red-600 disabled:opacity-30"
                >
                  {savingTracks ? "Saving…" : "Save Track Names"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Class setup ────────────────────────────────────────────────── */}
      <div className="bg-nhra-card border border-nhra-border rounded-xl mb-6 overflow-hidden">
        <button
          onClick={() => setShowSetup((v) => !v)}
          className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-nhra-darker/50"
        >
          <div>
            <h2 className="text-white font-bold">Class Setup</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {mainCategories.length} main race · {buybackCategories.length} buy-back ·{" "}
              {(data?.categories.length || 0) - mainCategories.length - buybackCategories.length} not scored
            </p>
          </div>
          <span className="text-gray-400 text-sm">{showSetup ? "Hide" : "Edit"}</span>
        </button>

        {showSetup && (
          <div className="border-t border-nhra-border">
            <div className="px-6 py-3 bg-nhra-darker/50 text-xs text-gray-400 leading-relaxed">
              Mark every class the timing system is running. <strong className="text-green-400">Main Race</strong> wins
              score. <strong className="text-yellow-500">Buy-Back</strong> classes never score — a racer who lost round 1
              can win their way back onto the track but not back onto the points board. If a class isn&apos;t part of the
              team chase at all, mark it <strong className="text-gray-300">Not Scored</strong>. Buy-back classes are
              optional; leave them out when the event doesn&apos;t run one.
              <br />
              Saved against this event and remembered by class name for the rest of the season, so the next race opens
              already set — anything carried over is marked <em>(remembered)</em> and can still be changed here without
              affecting the race it came from.
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-nhra-darker text-gray-400 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-6 py-2 font-medium">Class</th>
                    <th className="text-left px-3 py-2 font-medium">Role</th>
                    <th className="text-left px-3 py-2 font-medium">Points Board</th>
                    <th className="text-left px-3 py-2 font-medium">Buy-back rounds</th>
                    <th className="text-right px-6 py-2 font-medium">Runs</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.categories || []).map((c) => {
                    const role = effectiveConfig?.categoryRoles[c.category] ?? c.role;
                    const division = effectiveConfig?.categoryDivision[c.category] ?? c.division;
                    const buyback = (effectiveConfig?.buybackRounds[c.category] || []).join(" ");
                    return (
                      <tr key={c.category} className="border-t border-nhra-border/60">
                        <td className="px-6 py-2">
                          <div className="text-white font-medium">{c.category}</div>
                          <div className="text-xs text-gray-500">
                            {c.rounds.join(" · ") || "no rounds yet"}
                            {!effectiveConfig?.categoryRoles[c.category] ? (
                              <span className="ml-2 text-gray-600">(auto)</span>
                            ) : (data?.classesFromDefaults || []).includes(c.category) ? (
                              <span
                                className="ml-2 text-gray-500"
                                title="Carried over from how this class was set at an earlier race this season"
                              >
                                (remembered)
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            {(["main", "buyback", "ignore"] as EtCategoryRole[]).map((r) => (
                              <button
                                key={r}
                                onClick={() => setRole(c.category, r)}
                                className={`px-2 py-1 rounded text-xs font-semibold border transition-colors ${
                                  role === r
                                    ? ROLE_STYLES[r]
                                    : "bg-nhra-darker border-nhra-border text-gray-500 hover:text-gray-300"
                                }`}
                              >
                                {ROLE_LABELS[r]}
                              </button>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            {(["big", "jr"] as EtDivision[]).map((d) => (
                              <button
                                key={d}
                                onClick={() => setDivision(c.category, d)}
                                className={`px-2 py-1 rounded text-xs font-semibold border transition-colors ${
                                  division === d
                                    ? "bg-nhra-red/20 text-red-400 border-nhra-red/40"
                                    : "bg-nhra-darker border-nhra-border text-gray-500 hover:text-gray-300"
                                }`}
                              >
                                {d === "big" ? "Big Cars" : "Jrs"}
                              </button>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            defaultValue={buyback}
                            onBlur={(e) => setBuybackRounds(c.category, e.target.value)}
                            placeholder="e.g. E2"
                            disabled={role !== "main"}
                            className="w-24 px-2 py-1 bg-nhra-darker border border-nhra-border rounded text-xs text-white placeholder-gray-600 disabled:opacity-30"
                          />
                        </td>
                        <td className="px-6 py-2 text-right text-gray-400">{c.runCount}</td>
                      </tr>
                    );
                  })}
                  {(data?.categories.length || 0) === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                        No runs loaded for this event yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-3 border-t border-nhra-border flex items-center justify-between gap-3">
              <p className="text-xs text-gray-500">
                {draftConfig
                  ? "Unsaved changes"
                  : "Saved per event, and remembered by class name for the rest of the season — the next race starts already set."}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setDraftConfig(null)}
                  disabled={!draftConfig || savingConfig}
                  className="px-4 py-2 bg-nhra-darker border border-nhra-border text-gray-300 rounded-lg text-sm hover:text-white disabled:opacity-30"
                >
                  Discard
                </button>
                <button
                  onClick={saveConfig}
                  disabled={!draftConfig || savingConfig}
                  className="px-4 py-2 bg-nhra-red text-white rounded-lg text-sm font-semibold hover:bg-red-600 disabled:opacity-30"
                >
                  {savingConfig ? "Saving…" : "Save Class Setup"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Saved settings ─────────────────────────────────────────────── */}
      <div className="bg-nhra-card border border-nhra-border rounded-xl mb-6 overflow-hidden">
        <button
          onClick={() => setShowSetups((v) => !v)}
          className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-nhra-darker/50"
        >
          <div>
            <h2 className="text-white font-bold">Saved Settings</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {setups.length === 0
                ? "Name and save the whole points setup so a reload can't lose it"
                : `${setups.length} saved — load one to restore the points setup after a reload`}
            </p>
          </div>
          <span className="text-gray-400 text-sm">{showSetups ? "Hide" : "Open"}</span>
        </button>

        {showSetups && (
          <div className="border-t border-nhra-border p-6 space-y-4">
            <p className="text-xs text-gray-400 leading-relaxed">
              Saves everything the points chase is configured with — every class&apos;s role and board exactly as
              shown in Class Setup (hand-set, remembered or auto-guessed alike), the buy-back rule, the days that
              count, points adjustments, manual pins and per-racer eligibility — under one name. If the event ever has
              to be reloaded or re-created, load the name back and the setup is exactly as it was. Rosters, tech cards
              and track names are stored separately and survive on their own.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                value={setupName}
                onChange={(e) => setSetupName(e.target.value)}
                placeholder={`e.g. ${season || "2026"} ET Finals`}
                className="flex-1 min-w-[14rem] px-3 py-2 bg-nhra-darker border border-nhra-border rounded-lg text-sm text-white placeholder-gray-600"
              />
              <button
                onClick={saveSetup}
                disabled={setupBusy || !data}
                className="px-4 py-2 bg-nhra-red text-white rounded-lg text-sm font-semibold hover:bg-red-600 disabled:opacity-40"
              >
                {setupBusy ? "Working…" : "Save Current Settings"}
              </button>
            </div>
            {setupMsg && (
              <p className="text-xs text-gray-300 bg-nhra-darker border border-nhra-border rounded-lg px-3 py-2">
                {setupMsg}
              </p>
            )}
            {setups.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-gray-400 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="text-left py-2 font-medium">Name</th>
                      <th className="text-left py-2 font-medium">Season</th>
                      <th className="text-left py-2 font-medium">Buy-Backs Earn</th>
                      <th className="text-right py-2 font-medium">Classes</th>
                      <th className="text-right py-2 font-medium">Saved</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {setups.map((s) => (
                      <tr key={s.id} className="border-t border-nhra-border/60">
                        <td className="py-2 text-white font-medium">{s.name}</td>
                        <td className="py-2 text-gray-400">{s.season || "—"}</td>
                        <td className="py-2 text-gray-400">{s.config.buybackEarnsPoints ? "Yes" : "No"}</td>
                        <td className="py-2 text-right text-gray-300">
                          {Object.keys(s.config.categoryRoles || {}).length}
                        </td>
                        <td className="py-2 text-right text-gray-400 text-xs whitespace-nowrap">
                          {s.saved_at ? new Date(s.saved_at).toLocaleString() : "—"}
                        </td>
                        <td className="py-2 text-right whitespace-nowrap">
                          <button
                            onClick={() => applySetup(s)}
                            disabled={setupBusy}
                            className="text-xs text-nhra-accent hover:underline disabled:opacity-40"
                          >
                            Load
                          </button>
                          <button
                            onClick={() => removeSetup(s)}
                            disabled={setupBusy}
                            className="ml-3 text-xs text-gray-500 hover:text-red-400 disabled:opacity-40"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Rosters ────────────────────────────────────────────────────── */}
      <div className="bg-nhra-card border border-nhra-border rounded-xl mb-6 overflow-hidden">
        <button
          onClick={() => setShowRosters((v) => !v)}
          className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-nhra-darker/50"
        >
          <div>
            <h2 className="text-white font-bold">Team Rosters</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {rosters.length} uploaded ·{" "}
              {rosters.reduce((s, r) => s + r.bigEntries, 0)} big cars ·{" "}
              {rosters.reduce((s, r) => s + r.jrPointsEntries, 0)} scoring jrs
            </p>
          </div>
          <span className="text-gray-400 text-sm">{showRosters ? "Hide" : "Manage"}</span>
        </button>

        {showRosters && (
          <div className="border-t border-nhra-border p-6 space-y-4">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                handleUpload(Array.from(e.dataTransfer.files));
              }}
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-xl px-6 py-8 text-center cursor-pointer transition-colors ${
                dragOver ? "border-nhra-red bg-nhra-red/5" : "border-nhra-border hover:border-gray-600"
              }`}
            >
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".xlsx,.xls,.numbers"
                className="hidden"
                onChange={(e) => handleUpload(Array.from(e.target.files || []))}
              />
              <p className="text-white font-medium mb-1">
                {uploading ? "Uploading…" : "Drop team roster files here"}
              </p>
              <p className="text-xs text-gray-500">
                One file per track (e.g. LV.xlsx, Numidia.xlsx, NED.numbers) — .xlsx, .xls and Apple .numbers all work,
                and several files can be dropped at once. Re-uploading a track replaces its roster.
              </p>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <label className="text-xs text-gray-400">
                Track code override
                <input
                  value={overrideTrackCode}
                  onChange={(e) => setOverrideTrackCode(e.target.value.toUpperCase())}
                  placeholder="e.g. NU"
                  maxLength={6}
                  className="ml-2 w-24 px-2 py-1 bg-nhra-darker border border-nhra-border rounded text-xs text-white placeholder-gray-600"
                />
              </label>
              <span className="text-xs text-gray-600">
                For a roster submitted with the track-code cell left blank. Applies to a single-file upload.
              </span>
            </div>

            {uploadMsg && (
              <pre className="text-xs text-gray-300 bg-nhra-darker border border-nhra-border rounded-lg p-3 whitespace-pre-wrap">
                {uploadMsg}
              </pre>
            )}

            {rosters.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-gray-400 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="text-left py-2 font-medium">Team</th>
                      <th className="text-left py-2 font-medium">Code</th>
                      <th className="text-left py-2 font-medium">Captain</th>
                      <th className="text-right py-2 font-medium">Big Cars</th>
                      <th className="text-right py-2 font-medium">Jrs (scoring)</th>
                      <th className="text-right py-2 font-medium">Season</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {rosters.map((r) => (
                      <tr key={r.id} className="border-t border-nhra-border/60">
                        <td className="py-2 text-white">{r.team_name || r.track_name}</td>
                        <td className="py-2">
                          <button
                            onClick={() => recodeRoster(r.id, r.track_code)}
                            title="Change this roster's track code"
                            className="text-gray-400 hover:text-white underline decoration-dotted underline-offset-2"
                          >
                            {r.track_code}
                          </button>
                        </td>
                        <td className="py-2 text-gray-400">{r.captain || "—"}</td>
                        <td className="py-2 text-right text-gray-300">{r.bigEntries}</td>
                        <td className="py-2 text-right text-gray-300">
                          {r.jrPointsEntries}
                          <span className="text-gray-600"> / {r.jrEntries}</span>
                        </td>
                        <td className="py-2 text-right text-gray-400">{r.season}</td>
                        <td className="py-2 text-right">
                          <button
                            onClick={() => deleteRoster(r.id, r.team_name || r.track_code)}
                            className="text-xs text-gray-500 hover:text-red-400"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Tech cards ─────────────────────────────────────────────────── */}
      <div className="bg-nhra-card border border-nhra-border rounded-xl mb-6 overflow-hidden">
        <button
          onClick={() => setShowTechCards((v) => !v)}
          className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-nhra-darker/50"
        >
          <div>
            <h2 className="text-white font-bold">Tech Cards</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {techPlaced > 0
                ? `${techPlaced} racer${techPlaced === 1 ? "" : "s"} placed on a team from their tech card`
                : "Member numbers and team codes — how racers in the timing system are identified"}
            </p>
          </div>
          <span className="text-gray-400 text-sm">{showTechCards ? "Hide" : "Upload"}</span>
        </button>

        {showTechCards && (
          <div className="border-t border-nhra-border p-6 space-y-4">
            <p className="text-xs text-gray-400 leading-relaxed">
              Upload the divisional E.T. export (<code className="text-gray-300">TCET_*.xlsx</code>) or a racefiles
              Compulink file. The member number is what ties a racer to their roster entry however their car is numbered
              in the timing system, and the <code className="text-gray-300">trackteam</code> column places anyone no
              roster claims onto a team.
            </p>
            <div
              onClick={() => techRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleTechCardUpload(Array.from(e.dataTransfer.files));
              }}
              className="border-2 border-dashed border-nhra-border rounded-xl px-6 py-8 text-center cursor-pointer hover:border-gray-600"
            >
              <input
                ref={techRef}
                type="file"
                multiple
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => handleTechCardUpload(Array.from(e.target.files || []))}
              />
              <p className="text-white font-medium mb-1">
                {techUploading ? "Uploading…" : "Drop tech card exports here"}
              </p>
              <p className="text-xs text-gray-500">Re-uploading updates the racers already on file.</p>
            </div>
            {techMsg && (
              <pre className="text-xs text-gray-300 bg-nhra-darker border border-nhra-border rounded-lg p-3 whitespace-pre-wrap">
                {techMsg}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* ── EData ──────────────────────────────────────────────────────── */}
      <div className="bg-nhra-card border border-nhra-border rounded-xl mb-6 overflow-hidden">
        <button
          onClick={() => setShowEdata((v) => !v)}
          className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-nhra-darker/50"
        >
          <div>
            <h2 className="text-white font-bold">EData Import</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {dataSource === "edata"
                ? "EData is the active source — getresults polling is off"
                : "Load rounds from the timing system's own files when getresults is down"}
            </p>
          </div>
          <span className="text-gray-400 text-sm">{showEdata ? "Hide" : "Open"}</span>
        </button>

        {showEdata && (
          <div className="border-t border-nhra-border p-6 space-y-4">
            <div
              className={`rounded-lg px-4 py-3 border flex items-start justify-between gap-4 flex-wrap ${
                dataSource === "edata"
                  ? "bg-green-500/10 border-green-500/40"
                  : "bg-yellow-500/10 border-yellow-500/40"
              }`}
            >
              <p className={`text-xs ${dataSource === "edata" ? "text-green-400" : "text-yellow-500"}`}>
                {dataSource === "edata"
                  ? "Nothing is fetched from getresults or the API — the rounds you import here can't be overwritten."
                  : "Polling is on, so a later fetch can overwrite imported rounds. Switch to EData to stop that."}
              </p>
              <button
                onClick={() => live.setDataSource(dataSource === "edata" ? "scraper" : "edata")}
                disabled={!live.config}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40 ${
                  dataSource === "edata"
                    ? "bg-nhra-darker border border-nhra-border text-gray-300 hover:text-white"
                    : "bg-nhra-red text-white hover:bg-red-600"
                }`}
              >
                {dataSource === "edata" ? "Back to getresults" : "Use EData only"}
              </button>
            </div>

            <label className="text-xs text-gray-400 block">
              Race date (orders the imported rounds)
              <input
                type="date"
                value={edataDate}
                onChange={(e) => setEdataDate(e.target.value)}
                className="ml-2 px-2 py-1 bg-nhra-darker border border-nhra-border rounded text-xs text-white"
              />
            </label>

            <div
              onClick={() => edataRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleEdataUpload(Array.from(e.dataTransfer.files));
              }}
              className="border-2 border-dashed border-nhra-border rounded-xl px-6 py-8 text-center cursor-pointer hover:border-gray-600"
            >
              <input
                ref={edataRef}
                type="file"
                multiple
                accept=".txt,.TXT,.dat,.DAT"
                className="hidden"
                onChange={(e) => handleEdataUpload(Array.from(e.target.files || []))}
              />
              <p className="text-white font-medium mb-1">
                {edataUploading ? "Importing…" : "Drop EData files here"}
              </p>
              <p className="text-xs text-gray-500">
                C11EDAT.TXT, C12EDAT.TXT, … — all classes at once. Re-importing updates rather than duplicates.
              </p>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">
              EData records finish order but no clock times, so each pass gets a synthetic timestamp from its round and
              position in the file. Runs order and pair correctly; the times on time-of-day views are sequence markers,
              not when the cars ran.
            </p>
            {edataMsg && (
              <pre className="text-xs text-gray-300 bg-nhra-darker border border-nhra-border rounded-lg p-3 whitespace-pre-wrap">
                {edataMsg}
              </pre>
            )}
          </div>
        )}
      </div>

      {/* ── Points ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h2 className="text-xl font-bold text-white">Points</h2>
        <div className="flex gap-1">
          {([
            ["combined", "Combined"],
            ["big", "Big Cars"],
            ["jr", "Jrs"],
          ] as [ViewMode, string][]).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setView(m)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                view === m
                  ? "bg-nhra-red text-white border-nhra-red"
                  : "bg-nhra-darker border-nhra-border text-gray-400 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Race-day rules — they live on the board, not in setup */}
      {data && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <label className="flex items-start gap-3 bg-nhra-card border border-nhra-border rounded-xl px-4 py-3 cursor-pointer select-none">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-red-600"
              checked={effectiveConfig?.buybackEarnsPoints === true}
              disabled={assigning === "buyback-policy"}
              onChange={(e) => setBuybackEarns(e.target.checked)}
            />
            <span>
              <span className="text-white text-sm font-semibold">
                Buy-back winners keep earning points
                {assigning === "buyback-policy" && <span className="ml-2 text-xs text-gray-500">saving…</span>}
              </span>
              <span className="block text-xs text-gray-500 mt-0.5 leading-relaxed">
                The buy-back round itself never scores a point either way. Unchecked, a car that loses and buys back
                keeps racing but earns nothing more for the rest of this event. Checked, its later main-race round wins
                count again.
              </span>
            </span>
          </label>
          <div className="bg-nhra-card border border-nhra-border rounded-xl px-4 py-3">
            <span className="text-white text-sm font-semibold">Days &amp; hours that count for points</span>
            <span className="block text-xs text-gray-500 mt-0.5 mb-2 leading-relaxed">
              Practice days run through the timing system labelled E1, exactly like the real race — turn them off and
              nothing from those days earns. A race running past midnight spills into the next date: set counting
              hours (from / until) on a day to keep those small-hours passes out. Pick, then hit Save. A new day
              counts automatically.
            </span>
            <div className="space-y-1.5">
              {(data.runDates || []).map((d) => {
                const from = (effectiveConfig?.scoreFromDate || "").trim();
                const counts =
                  !(effectiveConfig?.excludedDates || []).includes(d) && (!from || d >= from);
                const w = (effectiveConfig?.dayWindows || {})[d] || {};
                const [y, m, day] = d.split("-");
                const label = new Date(
                  parseInt(y, 10),
                  parseInt(m, 10) - 1,
                  parseInt(day, 10),
                ).toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" });
                return (
                  <div key={d} className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      disabled={savingConfig}
                      onClick={() => setDayCounts(d, !counts)}
                      title={counts ? "Counting — click to exclude this day" : "Excluded — click to count this day"}
                      className={`px-3 py-1.5 rounded-lg border select-none text-xs font-semibold transition-colors disabled:opacity-40 min-w-[7.5rem] text-left ${
                        counts
                          ? "bg-green-500/10 border-green-500/40 text-green-400"
                          : "bg-nhra-darker border-nhra-border text-gray-500 line-through"
                      }`}
                    >
                      {counts ? "✓ " : "✕ "}
                      {label}
                    </button>
                    {counts && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                        from
                        <input
                          type="time"
                          value={w.from || ""}
                          disabled={savingConfig || assigning === `window-${d}`}
                          onChange={(e) => setDayWindow(d, "from", e.target.value)}
                          onBlur={(e) => setDayWindow(d, "from", e.target.value, true)}
                          className="px-1.5 py-1 bg-nhra-darker border border-nhra-border rounded text-xs text-white"
                        />
                        until
                        <input
                          type="time"
                          value={w.to || ""}
                          disabled={savingConfig || assigning === `window-${d}`}
                          onChange={(e) => setDayWindow(d, "to", e.target.value)}
                          onBlur={(e) => setDayWindow(d, "to", e.target.value, true)}
                          className="px-1.5 py-1 bg-nhra-darker border border-nhra-border rounded text-xs text-white"
                        />
                        {(w.from || w.to) && (
                          <span className="text-yellow-500">
                            only {w.from || "start"}–{w.to || "end"} counts
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                );
              })}
              {(data.runDates || []).length === 0 && (
                <span className="text-xs text-gray-600">No runs on file yet.</span>
              )}
              {daysDirty && (
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={saveConfig}
                    disabled={savingConfig}
                    className="px-4 py-2 bg-nhra-red text-white rounded-lg text-sm font-bold hover:bg-red-600 disabled:opacity-40 animate-pulse"
                  >
                    {savingConfig ? "Saving…" : "⚠ Save Days — not saved yet"}
                  </button>
                  <button
                    onClick={() => setDraftConfig(null)}
                    disabled={savingConfig}
                    className="px-3 py-1.5 bg-nhra-darker border border-nhra-border text-gray-300 rounded-lg text-xs hover:text-white disabled:opacity-40"
                  >
                    Discard
                  </button>
                </div>
              )}
              <div className="pt-2 mt-1 border-t border-nhra-border/60">
                <button
                  onClick={lockRunsSoFar}
                  disabled={assigning === "lock-so-far"}
                  className="px-3 py-1.5 bg-nhra-darker border border-yellow-500/40 text-yellow-500 rounded-lg text-xs font-semibold hover:bg-yellow-500/10 disabled:opacity-40"
                >
                  {assigning === "lock-so-far" ? "Locking…" : "Lock out everything run so far"}
                </button>
                <span className="block text-xs text-gray-500 mt-1 leading-relaxed">
                  Draws a line under what has already happened: every pass on file right now stops counting, and only
                  passes recorded from here on score. Use it when a session shouldn&apos;t count at all and the clock
                  can&apos;t tell them apart — a race that ran past midnight into today&apos;s date, say. Individual
                  passes can be put back one at a time in Round Review.
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Team tabs */}
      {sortedTeams.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          <button
            onClick={() => setTeamTab("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
              teamTab === "all"
                ? "bg-white/10 text-white border-gray-400"
                : "bg-nhra-darker border-nhra-border text-gray-400 hover:text-white"
            }`}
          >
            Standings
          </button>
          {sortedTeams.map((team) => (
            <button
              key={team.track_code}
              onClick={() => setTeamTab(team.track_code)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                teamTab === team.track_code
                  ? "bg-white/10 text-white border-gray-400"
                  : "bg-nhra-darker border-nhra-border text-gray-400 hover:text-white"
              }`}
            >
              {team.team_name}
              <span className="ml-1.5 text-nhra-red font-bold">
                {view === "big" ? team.bigPoints : view === "jr" ? team.jrPoints : team.totalPoints}
              </span>
            </button>
          ))}
        </div>
      )}

      {loading && !data ? (
        <div className="flex justify-center py-12">
          <div className="w-10 h-10 border-4 border-nhra-red border-t-transparent rounded-full animate-spin" />
        </div>
      ) : sortedTeams.length === 0 ? (
        <div className="bg-nhra-card border border-nhra-border rounded-xl px-6 py-10 text-center text-gray-500">
          No teams to show yet.
        </div>
      ) : activeTeam ? (
        <TeamPanel
          key={activeTeam.track_code}
          team={activeTeam}
          rank={sortedTeams.indexOf(activeTeam) + 1}
          view={view}
          assigning={assigning}
          overrideFor={overrideFor}
          onToggleEligibility={(key, next) => setEligibility(key, next)}
          onFixCarNumber={fixCarNumber}
          onToggleIgnored={toggleRunIgnored}
          rosterOptions={data?.rosterOptions || []}
          teamOptions={teamOptions}
          onAssign={assignRacer}
          onAdjustPoints={adjustTeamPoints}
        />
      ) : (
        <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-nhra-darker text-gray-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-3 font-medium w-12">#</th>
                  <th className="text-left px-4 py-3 font-medium">Team</th>
                  <th className="text-right px-4 py-3 font-medium">Big Cars</th>
                  <th className="text-right px-4 py-3 font-medium">Jrs</th>
                  <th className="text-right px-4 py-3 font-medium">Total</th>
                  <th className="text-right px-4 py-3 font-medium">Earning</th>
                  <th className="text-right px-4 py-3 font-medium">Alive</th>
                </tr>
              </thead>
              <tbody>
                {sortedTeams.map((team, i) => (
                  <tr
                    key={team.track_code}
                    onClick={() => setTeamTab(team.track_code)}
                    className="border-t border-nhra-border/60 hover:bg-nhra-darker/40 cursor-pointer"
                  >
                    <td className="px-4 py-3 text-gray-500 font-semibold">{i + 1}</td>
                    <td className="px-4 py-3">
                      <div className="text-white font-semibold">{team.team_name}</div>
                      <div className="text-xs text-gray-500">
                        {team.track_code}
                        {team.captain ? ` · ${team.captain}` : ""}
                        {!team.hasRoster && (
                          <span
                            className="ml-2 text-yellow-600"
                            title="No roster uploaded for this team — its racers are placed from their tech cards"
                          >
                            · tech cards only
                          </span>
                        )}
                      </div>
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-semibold ${
                        view === "jr" ? "text-gray-600" : "text-white"
                      }`}
                    >
                      {team.bigPoints}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-semibold ${
                        view === "big" ? "text-gray-600" : "text-white"
                      }`}
                    >
                      {team.jrPoints}
                    </td>
                    <td className="px-4 py-3 text-right text-lg font-bold text-nhra-red">
                      {team.totalPoints}
                      {(team.bigAdjustment !== 0 || team.jrAdjustment !== 0) && (
                        <span
                          className="ml-1 text-[11px] text-yellow-500 font-semibold align-top"
                          title={`Includes a hand adjustment (${[
                            team.bigAdjustment ? `big ${team.bigAdjustment > 0 ? "+" : ""}${team.bigAdjustment}` : "",
                            team.jrAdjustment ? `jrs ${team.jrAdjustment > 0 ? "+" : ""}${team.jrAdjustment}` : "",
                          ]
                            .filter(Boolean)
                            .join(", ")})${team.adjustmentNote ? ` — ${team.adjustmentNote}` : ""}`}
                        >
                          adj
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-green-400">
                      {team.racers.filter((r) => r.points_eligible && (r.status === "racing" || r.status === "winner")).length}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400">{team.racersStillAlive}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t border-nhra-border text-xs text-gray-500">
            Click a team — or its tab above — for the full roster split into who&apos;s gaining points and who isn&apos;t.
          </div>
        </div>
      )}

      {/* ── Points outlook ─────────────────────────────────────────────── */}
      {!activeTeam && sortedTeams.length > 1 && data && (
        <div className="mt-4 bg-nhra-card border border-nhra-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-nhra-border">
            <h3 className="text-white font-bold text-sm">Points Outlook</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              What each team can still add if every alive racer wins out — who&apos;s mathematically out of the next
              spot, and whose spot can still be taken. Rounds left are estimated from cars still standing (each round
              halves the field), so treat &quot;can still reach&quot; as generous and &quot;out&quot; as certain.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-nhra-darker text-gray-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2 font-medium w-10">#</th>
                  <th className="text-left px-2 py-2 font-medium">Team</th>
                  <th className="text-right px-2 py-2 font-medium">Points</th>
                  <th className="text-right px-2 py-2 font-medium">Max Possible</th>
                  <th className="text-left px-4 py-2 font-medium">Next Spot Up</th>
                  <th className="text-left px-4 py-2 font-medium">Current Spot</th>
                </tr>
              </thead>
              <tbody>
                {[...data.teams]
                  .sort((a, b) => a.rank - b.rank || b.totalPoints - a.totalPoints)
                  .map((t) => (
                    <tr key={t.track_code} className="border-t border-nhra-border/50">
                      <td className="px-4 py-2 text-gray-500 font-semibold">{t.rank}</td>
                      <td className="px-2 py-2 text-white font-medium">{t.team_name}</td>
                      <td className="px-2 py-2 text-right font-bold text-white">{t.totalPoints}</td>
                      <td className="px-2 py-2 text-right text-gray-300">
                        {t.maxPossibleTotal}
                        {t.maxRemainingPoints > 0 && (
                          <span className="text-gray-500"> (+{t.maxRemainingPoints})</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {t.canCatchNextSpot === null ? (
                          <span className="text-gray-500">— leading</span>
                        ) : t.canCatchNextSpot ? (
                          <span className="text-green-400">
                            can still reach it
                            {t.nextSpotPoints !== null && (
                              <span className="text-gray-500"> · {t.nextSpotPoints - t.totalPoints} back</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-red-400 font-semibold">mathematically out</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {t.spotLocked ? (
                          <span className="text-green-400 font-semibold">locked — nobody below can reach it</span>
                        ) : (
                          <span className="text-yellow-500">
                            can still be taken by {t.atRiskFrom.slice(0, 4).join(", ")}
                            {t.atRiskFrom.length > 4 ? ` +${t.atRiskFrom.length - 4} more` : ""}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Pairing helper ─────────────────────────────────────────────── */}
      <PairingHelper data={data} eventCode={eventCode} season={season} />

      {/* ── Round review ───────────────────────────────────────────────── */}
      <RoundReview
        eventCode={eventCode}
        season={season}
        data={data}
        assigning={assigning}
        onFixCarNumber={fixCarNumber}
        onToggleIgnored={toggleRunIgnored}
      />

      {/* ── Unmatched ──────────────────────────────────────────────────── */}
      {data && data.unmatched.length > 0 && (
        <div className="mt-8 bg-nhra-card border border-yellow-500/30 rounded-xl overflow-hidden">
          <div className="px-6 py-3 bg-yellow-500/10 border-b border-yellow-500/30">
            <h2 className="text-yellow-500 font-bold">
              {data.unmatched.length} racer{data.unmatched.length === 1 ? "" : "s"} not on any roster
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              These ran in a main-race class but no roster claims them, so their round wins aren&apos;t scoring for
              anyone. Pick their roster entry — or put them straight on a team when no roster row exists (how Jr
              Dragsters with a blank team code get placed) — and the points land retroactively. Click a row to see
              their passes and fix a wrong car number.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-gray-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="w-8 py-2" />
                  <th className="text-left px-2 py-2 font-medium">Car #</th>
                  <th className="text-left px-3 py-2 font-medium">Driver</th>
                  <th className="text-left px-3 py-2 font-medium">Class</th>
                  <th className="text-left px-3 py-2 font-medium">Tech Card Team</th>
                  <th className="text-right px-3 py-2 font-medium">Rounds Won</th>
                  <th className="text-left px-3 py-2 font-medium">Assign To</th>
                  <th className="text-right px-6 py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {data.unmatched.map((u, i) => (
                  <Fragment key={`${u.identity}|${i}`}>
                    <tr
                      className="border-t border-nhra-border/60 cursor-pointer hover:bg-nhra-darker/40"
                      onClick={() =>
                        setUnmatchedOpen((prev) => {
                          const next = new Set(prev);
                          if (next.has(u.identity)) next.delete(u.identity);
                          else next.add(u.identity);
                          return next;
                        })
                      }
                    >
                      <td className="pl-4 py-2 text-gray-600 text-[11px]">
                        {u.rounds.length > 0 ? (unmatchedOpen.has(u.identity) ? "▾" : "▸") : ""}
                      </td>
                      <td className="px-2 py-2 text-gray-300">{u.car_number || "—"}</td>
                      <td className="px-3 py-2 text-white">
                        {u.name || "—"}
                        {u.memberNumber && (
                          <span className="block text-[11px] text-gray-500">member #{u.memberNumber}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-400">{u.category}</td>
                      <td className="px-3 py-2 text-gray-400">
                        {u.techTeam ? (
                          <span title={u.memberNumber ? `Member #${u.memberNumber}` : undefined}>
                            {u.techTeam}
                          </span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-300">{u.roundsWon}</td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <select
                          value=""
                          disabled={assigning === u.identity}
                          onChange={(e) => assignRacer(u.identity, e.target.value)}
                          className="max-w-[22rem] px-2 py-1 bg-nhra-darker border border-nhra-border rounded text-xs text-white disabled:opacity-40"
                        >
                          <option value="">
                            {assigning === u.identity ? "Assigning…" : "Pick a roster entry or team…"}
                          </option>
                          <optgroup label="Put on a team (no roster row needed)">
                            {teamOptions
                              .sort((a, b) =>
                                u.techTeam
                                  ? Number(b.code === u.techTeam) - Number(a.code === u.techTeam)
                                  : a.label.localeCompare(b.label),
                              )
                              .map((t) => (
                                <option key={`team-${t.code}`} value={`${TEAM_MATCH_PREFIX}${t.code}`}>
                                  {t.label} ({t.code})
                                </option>
                              ))}
                          </optgroup>
                          <optgroup label="Roster entries">
                            {(data.rosterOptions || [])
                              .filter((o) => o.division === u.division)
                              // Their tech card's team first — that is almost
                              // always the roster they belong on.
                              .sort((a, b) =>
                                u.techTeam
                                  ? Number(b.trackCode === u.techTeam) - Number(a.trackCode === u.techTeam)
                                  : 0,
                              )
                              .map((o) => (
                                <option key={o.key} value={o.key}>
                                  {o.team} · {o.label}
                                  {o.eligible ? "" : " (no points)"}
                                </option>
                              ))}
                          </optgroup>
                          {/* A class guessed onto the wrong board would otherwise
                              hide the right roster rows entirely. */}
                          <optgroup label={u.division === "jr" ? "Big-car roster entries" : "Jr roster entries"}>
                            {(data.rosterOptions || [])
                              .filter((o) => o.division !== u.division)
                              .sort((a, b) =>
                                u.techTeam
                                  ? Number(b.trackCode === u.techTeam) - Number(a.trackCode === u.techTeam)
                                  : 0,
                              )
                              .map((o) => (
                                <option key={o.key} value={o.key}>
                                  {o.team} · {o.label}
                                  {o.eligible ? "" : " (no points)"}
                                </option>
                              ))}
                          </optgroup>
                        </select>
                      </td>
                      <td className="px-6 py-2 text-right text-gray-500 text-xs">
                        {u.reason === "ambiguous" ? "Matches more than one team" : "No roster entry"}
                      </td>
                    </tr>
                    {unmatchedOpen.has(u.identity) && u.rounds.length > 0 && (
                      <tr className="bg-nhra-darker/40">
                        <td colSpan={8} className="py-1">
                          <RoundsDetail
                            rounds={u.rounds}
                            assigning={assigning}
                            onFixCarNumber={fixCarNumber}
                            onToggleIgnored={toggleRunIgnored}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
