"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveData } from "@/components/LiveDataProvider";
import { elimRoundOrder, TEAM_MATCH_PREFIX } from "@/lib/et-finals";
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
      <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-gray-600/20 text-gray-400 border border-gray-600/40">
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
    <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${s.cls}`}>{s.label}</span>
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
}: {
  rounds: EtRoundResult[];
  assigning: string | null;
  onFixCarNumber: (dedupKey: string, carNumber: string) => void;
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
    <table className="w-full text-[11px]">
      <thead className="text-gray-600 uppercase tracking-wider">
        <tr>
          <th className="text-left pl-10 pr-2 py-1 font-medium">Round</th>
          <th className="text-left px-2 py-1 font-medium">Class</th>
          <th className="text-left px-2 py-1 font-medium">Result</th>
          <th className="text-right px-2 py-1 font-medium">Pts</th>
          <th className="text-right px-2 py-1 font-medium">Running Total</th>
          <th className="text-left px-2 py-1 font-medium">Car # on this pass</th>
          <th className="text-left px-2 py-1 font-medium">Time</th>
          <th className="text-right px-4 py-1 font-medium">Wrong car #?</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((rd, i) => {
          running += rd.points;
          const editing = editKey !== null && editKey === rd.dedup_key;
          const busy = assigning !== null && assigning === rd.dedup_key;
          return (
            <tr key={rd.dedup_key || i} className="border-t border-nhra-border/30">
              <td className="pl-10 pr-2 py-1 text-gray-300 font-semibold">{rd.round}</td>
              <td className="px-2 py-1 text-gray-500">{rd.category}</td>
              <td className="px-2 py-1">
                {rd.outcome === "win" ? (
                  <span className={rd.scored ? "text-green-400 font-bold" : "text-yellow-500 font-bold"}>
                    W{rd.scored ? "" : " (no pts)"}
                  </span>
                ) : rd.outcome === "loss" ? (
                  <span className="text-red-400">L</span>
                ) : (
                  <span className="text-gray-500">—</span>
                )}
              </td>
              <td className="px-2 py-1 text-right text-gray-300">{rd.points || ""}</td>
              <td className="px-2 py-1 text-right font-bold text-white">{running}</td>
              <td className="px-2 py-1 text-gray-400 font-mono">{rd.car_number || "—"}</td>
              <td className="px-2 py-1 text-gray-600 whitespace-nowrap">
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
                      className="w-20 px-1.5 py-0.5 bg-nhra-darker border border-nhra-border rounded text-[11px] text-white"
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
                  <button
                    disabled={!rd.dedup_key || busy}
                    onClick={() => {
                      setEditKey(rd.dedup_key);
                      setCarValue(rd.car_number);
                    }}
                    title="Correct the car number recorded on this pass — the pass moves to whoever really made it"
                    className="text-nhra-accent hover:underline disabled:opacity-40"
                  >
                    {busy ? "Fixing…" : "Fix car #"}
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function RacerTable({
  racers,
  emptyText,
  assigning,
  overrideFor,
  onToggleEligibility,
  onFixCarNumber,
}: {
  racers: EtRacerPoints[];
  emptyText: string;
  assigning: string | null;
  overrideFor: (key: string) => boolean | undefined;
  onToggleEligibility: (key: string, next: boolean) => void;
  onFixCarNumber: (dedupKey: string, carNumber: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (racers.length === 0) {
    return <p className="px-4 py-4 text-xs text-gray-600">{emptyText}</p>;
  }
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
            <Fragment key={r.key}>
              <tr
                className="border-t border-nhra-border/40 cursor-pointer hover:bg-nhra-darker/40"
                onClick={() => toggle(r.key)}
              >
                <td className="pl-4 py-1.5 text-gray-600 text-[10px]">
                  {r.rounds.length > 0 ? (open.has(r.key) ? "▾" : "▸") : ""}
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
                <td className="px-2 py-1.5 text-white">{r.name}</td>
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
                    className={`px-2 py-0.5 rounded border text-[11px] font-semibold transition-colors disabled:opacity-40 ${
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
              {open.has(r.key) && r.rounds.length > 0 && (
                <tr className="bg-nhra-darker/40">
                  <td colSpan={10} className="py-1">
                    <RoundsDetail rounds={r.rounds} assigning={assigning} onFixCarNumber={onFixCarNumber} />
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
function TeamPanel({
  team,
  rank,
  view,
  assigning,
  overrideFor,
  onToggleEligibility,
  onFixCarNumber,
}: {
  team: EtTeamStanding;
  rank: number;
  view: ViewMode;
  assigning: string | null;
  overrideFor: (key: string) => boolean | undefined;
  onToggleEligibility: (key: string, next: boolean) => void;
  onFixCarNumber: (dedupKey: string, carNumber: string) => void;
}) {
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
              <div className="text-[11px] uppercase tracking-wider text-gray-500">Big Cars</div>
              <div className="text-xl font-bold text-white">{team.bigPoints}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-500">Jrs</div>
              <div className="text-xl font-bold text-white">{team.jrPoints}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-500">Total</div>
              <div className="text-xl font-bold text-nhra-red">{team.totalPoints}</div>
            </div>
          </div>
        </div>
        {team.byCategory.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {team.byCategory.map((c) => (
              <span
                key={c.category}
                className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-nhra-darker border border-nhra-border text-gray-300"
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
        <RacerTable
          racers={earning}
          emptyText="Nobody on this team is gaining points right now."
          assigning={assigning}
          overrideFor={overrideFor}
          onToggleEligibility={onToggleEligibility}
          onFixCarNumber={onFixCarNumber}
        />
      </div>

      <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 bg-nhra-darker border-b border-nhra-border">
          <span className="text-gray-300 font-bold text-sm">Not Gaining Points</span>
          <span className="ml-2 text-xs text-gray-500">
            {notEarning.length} racer{notEarning.length === 1 ? "" : "s"} — out, bought back, or a non-points entry
            (points already earned still count)
          </span>
        </div>
        <RacerTable
          racers={notEarning}
          emptyText="Nobody here yet."
          assigning={assigning}
          overrideFor={overrideFor}
          onToggleEligibility={onToggleEligibility}
          onFixCarNumber={onFixCarNumber}
        />
      </div>

      {notEntered.length > 0 && (
        <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-nhra-darker border-b border-nhra-border">
            <span className="text-gray-400 font-bold text-sm">No Passes Yet</span>
            <span className="ml-2 text-xs text-gray-600">
              {notEntered.length} roster entr{notEntered.length === 1 ? "y" : "ies"} without a run in a scoring class
            </span>
          </div>
          <RacerTable
            racers={notEntered}
            emptyText=""
            assigning={assigning}
            overrideFor={overrideFor}
            onToggleEligibility={onToggleEligibility}
            onFixCarNumber={onFixCarNumber}
          />
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
      setDraftConfig(null);
      setDraftTracks(null);
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
      await loadStandings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign racer");
    } finally {
      setAssigning(null);
    }
  }

  // Save the whole team-points setup — class roles and boards, buy-back rule,
  // pins, eligibility overrides — under a name, so it can be brought back after
  // a purge, a re-created event or a changed event code.
  async function saveSetup() {
    const cfg = draftConfig ?? data?.config;
    if (!cfg) return;
    const name = setupName.trim() || `${season} ET Finals`;
    setSetupBusy(true);
    setSetupMsg("");
    try {
      const res = await fetch("/api/et-finals/setups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, season, event_code: eventCode, config: cfg }),
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

  // Whether buy-back winners keep earning points afterwards. Saved immediately
  // — it's a race-day rules call, not part of the class mapping batch.
  async function setBuybackEarns(earns: boolean) {
    const base = draftConfig ?? data?.config;
    if (!base || !eventCode || !season) return;
    const next = { ...base, buybackEarnsPoints: earns };
    setDraftConfig(next);
    setAssigning("buyback-policy");
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
      await loadStandings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change the buy-back rule");
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
        </tr>`,
      )
      .join("");

    const teamBlocks = teams
      .map((t) => {
        const earners = t.racers.filter((r) => r.points > 0);
        if (earners.length === 0) return "";
        const rows = earners
          .map(
            (r) => `<tr>
              <td>${esc(r.run_car_number || r.roster_car_number)}</td>
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
            <thead><tr><th>Car #</th><th>Driver</th><th>Board</th><th>Class</th><th class="r">Rounds Won</th><th class="r">Points</th></tr></thead>
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
      }${effectiveConfig?.buybackEarnsPoints ? " · Buy-back winners keep earning points" : ""}</div>
      <h2>Standings</h2>
      <table>
        <thead><tr><th class="c">Place</th><th>Team</th><th class="r">Big Cars</th><th class="r">Jrs</th><th class="r">Total</th></tr></thead>
        <tbody>${standingsRows}</tbody>
      </table>
      <h2>Point Earners by Team</h2>
      ${teamBlocks || '<p class="sub">No points scored yet.</p>'}
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
          <button
            onClick={printPublication}
            disabled={!data}
            className="px-4 py-2 bg-nhra-darker border border-nhra-border text-gray-300 rounded-lg text-sm hover:text-white disabled:opacity-40"
          >
            Print for Publication
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
            racer{techPlaced === 1 ? "" : "s"} placed on a team by their tech card&apos;s team code,
            with no roster entry claiming them.
          </span>
          {jrTechPlaced > 0 && (
            <span className="text-gray-400">
              {" "}
              <span className="text-yellow-500 font-semibold">{jrTechPlaced}</span> of them{" "}
              {jrTechPlaced === 1 ? "is a junior and earns" : "are juniors and earn"} nothing yet —
              only roster rows 1-10 score and there&apos;s no roster here saying which ten, so switch
              them on individually with the <span className="text-gray-300">Earns</span> toggle in
              the team drill-down.
            </span>
          )}
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
                        <td className="px-6 py-2 text-right text-[11px] text-gray-500">
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
                          <div className="text-[11px] text-gray-500">
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
                                className={`px-2 py-1 rounded text-[11px] font-semibold border transition-colors ${
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
                                className={`px-2 py-1 rounded text-[11px] font-semibold border transition-colors ${
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
              Saves everything the points chase is configured with — class roles and boards, the buy-back rule, manual
              pins and per-racer eligibility — under one name. If the event ever has to be reloaded or re-created,
              load the name back and the setup is exactly as it was. Rosters, tech cards and track names are stored
              separately and survive on their own.
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
              <span className="text-[11px] text-gray-600">
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
            <p className="text-[11px] text-gray-500 leading-relaxed">
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

      {/* Buy-back rule — a race-day call, so it lives on the board, not in setup */}
      {data && (
        <label className="mb-4 flex items-start gap-3 bg-nhra-card border border-nhra-border rounded-xl px-4 py-3 cursor-pointer select-none">
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
          team={activeTeam}
          rank={sortedTeams.indexOf(activeTeam) + 1}
          view={view}
          assigning={assigning}
          overrideFor={overrideFor}
          onToggleEligibility={(key, next) => setEligibility(key, next)}
          onFixCarNumber={fixCarNumber}
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
                      <div className="text-[11px] text-gray-500">
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
                    <td className="px-4 py-3 text-right text-lg font-bold text-nhra-red">{team.totalPoints}</td>
                    <td className="px-4 py-3 text-right text-green-400">
                      {team.racers.filter((r) => r.points_eligible && (r.status === "racing" || r.status === "winner")).length}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400">{team.racersStillAlive}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t border-nhra-border text-[11px] text-gray-500">
            Click a team — or its tab above — for the full roster split into who&apos;s gaining points and who isn&apos;t.
          </div>
        </div>
      )}

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
                      <td className="pl-4 py-2 text-gray-600 text-[10px]">
                        {u.rounds.length > 0 ? (unmatchedOpen.has(u.identity) ? "▾" : "▸") : ""}
                      </td>
                      <td className="px-2 py-2 text-gray-300">{u.car_number || "—"}</td>
                      <td className="px-3 py-2 text-white">{u.name || "—"}</td>
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
                          <RoundsDetail rounds={u.rounds} assigning={assigning} onFixCarNumber={fixCarNumber} />
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
