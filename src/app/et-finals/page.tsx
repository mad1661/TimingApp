"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveData } from "@/components/LiveDataProvider";
import type {
  EtCategoryRole,
  EtDivision,
  EtFinalsConfig,
  EtFinalsStandings,
  EtRacerPoints,
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

export default function EtFinalsPage() {
  const live = useLiveData();
  const eventCode = live.config?.eventCode || "";
  const season = live.config?.season || "";
  const eventName = live.config?.eventName || "";

  const [data, setData] = useState<StandingsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [view, setView] = useState<ViewMode>("combined");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [showSetup, setShowSetup] = useState(false);
  const [showTracks, setShowTracks] = useState(false);
  const [draftTracks, setDraftTracks] = useState<Record<string, TrackName> | null>(null);
  const [savingTracks, setSavingTracks] = useState(false);
  const [showRosters, setShowRosters] = useState(false);
  const [draftConfig, setDraftConfig] = useState<EtFinalsConfig | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);

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

  useEffect(() => {
    loadStandings();
    loadRosters();
  }, [loadStandings, loadRosters, live.dataVersion]);

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
    const valid = files.filter((f) => ["xlsx", "xls"].includes(f.name.split(".").pop()?.toLowerCase() || ""));
    if (valid.length === 0) {
      setUploadMsg("Upload the combined roster template as .xlsx (Numbers files must be exported to Excel first).");
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

  const mainCategories = useMemo(
    () => (data?.categories || []).filter((c) => c.role === "main"),
    [data],
  );
  const buybackCategories = useMemo(
    () => (data?.categories || []).filter((c) => c.role === "buyback"),
    [data],
  );

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
      ["Team", "Track Code", "Division", "Roster Class", "Car #", "Driver", "Points", "Rounds Won", "Status", "Out In", "Eligible"],
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
            { label: "Teams", value: data.teams.length, accent: "text-white" },
          ].map((s) => (
            <div key={s.label} className="bg-nhra-card border border-nhra-border rounded-xl px-4 py-3">
              <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">{s.label}</div>
              <div className={`text-2xl font-bold ${s.accent}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Setup warnings ─────────────────────────────────────────────── */}
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
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => handleUpload(Array.from(e.target.files || []))}
              />
              <p className="text-white font-medium mb-1">
                {uploading ? "Uploading…" : "Drop combined roster workbooks here"}
              </p>
              <p className="text-xs text-gray-500">
                One .xlsx per track — the template with the Summit ET Roster and JDRL / Jr Street sheets. Re-uploading a
                track replaces its roster.
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

      {/* ── Standings ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h2 className="text-xl font-bold text-white">Standings</h2>
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

      {loading && !data ? (
        <div className="flex justify-center py-12">
          <div className="w-10 h-10 border-4 border-nhra-red border-t-transparent rounded-full animate-spin" />
        </div>
      ) : sortedTeams.length === 0 ? (
        <div className="bg-nhra-card border border-nhra-border rounded-xl px-6 py-10 text-center text-gray-500">
          No teams to show yet.
        </div>
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
                  <th className="text-right px-4 py-3 font-medium">Alive</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {sortedTeams.map((team, i) => {
                  const open = expanded.has(team.track_code);
                  return (
                    <Fragment key={team.track_code}>
                      <tr
                        onClick={() =>
                          setExpanded((prev) => {
                            const next = new Set(prev);
                            if (next.has(team.track_code)) next.delete(team.track_code);
                            else next.add(team.track_code);
                            return next;
                          })
                        }
                        className="border-t border-nhra-border/60 hover:bg-nhra-darker/40 cursor-pointer"
                      >
                        <td className="px-4 py-3 text-gray-500 font-semibold">{i + 1}</td>
                        <td className="px-4 py-3">
                          <div className="text-white font-semibold">{team.team_name}</div>
                          <div className="text-[11px] text-gray-500">
                            {team.track_code}
                            {team.captain ? ` · ${team.captain}` : ""}
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
                        <td className="px-4 py-3 text-right text-gray-400">{team.racersStillAlive}</td>
                        <td className="px-4 py-3 text-right text-gray-500 text-xs">{open ? "▲" : "▼"}</td>
                      </tr>
                      {open && (
                        <tr className="bg-nhra-darker/30">
                          <td colSpan={7} className="px-4 py-4">
                            {team.byCategory.length > 0 && (
                              <div className="flex flex-wrap gap-2 mb-3">
                                {team.byCategory.map((c) => (
                                  <span
                                    key={c.category}
                                    className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-nhra-card border border-nhra-border text-gray-300"
                                  >
                                    {c.category}
                                    <span className="ml-1.5 text-nhra-red font-bold">{c.points}</span>
                                  </span>
                                ))}
                              </div>
                            )}
                            <table className="w-full text-xs">
                              <thead className="text-gray-500 uppercase tracking-wider">
                                <tr>
                                  <th className="text-left py-1.5 font-medium">Car #</th>
                                  <th className="text-left py-1.5 font-medium">Driver</th>
                                  <th className="text-left py-1.5 font-medium">Board</th>
                                  <th className="text-left py-1.5 font-medium">Class</th>
                                  <th className="text-right py-1.5 font-medium">Rounds Won</th>
                                  <th className="text-right py-1.5 font-medium">Points</th>
                                  <th className="text-right py-1.5 font-medium">Matched</th>
                                  <th className="text-right py-1.5 font-medium">Status</th>
                                  <th className="text-right py-1.5 font-medium">Earns</th>
                                </tr>
                              </thead>
                              <tbody>
                                {team.racers.map((r) => (
                                  <tr key={r.key} className="border-t border-nhra-border/40">
                                    <td className="py-1.5 text-gray-400">
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
                                    <td className="py-1.5 text-white">{r.name}</td>
                                    <td className="py-1.5 text-gray-400">{r.division === "jr" ? "Jrs" : "Big Cars"}</td>
                                    <td className="py-1.5 text-gray-400">
                                      {r.categories.join(", ") || r.roster_category || "—"}
                                    </td>
                                    <td className="py-1.5 text-right text-gray-300">{r.roundsWon}</td>
                                    <td className="py-1.5 text-right font-bold text-white">{r.points}</td>
                                    <td className="py-1.5 text-right text-gray-500">
                                      {r.matchedBy === "manual"
                                        ? "pinned"
                                        : r.matchedBy === "member"
                                          ? "member #"
                                          : r.matchedBy === "car"
                                            ? "car #"
                                            : r.matchedBy === "name"
                                              ? "name"
                                              : "—"}
                                    </td>
                                    <td className="py-1.5 text-right">
                                      <StatusBadge racer={r} />
                                    </td>
                                    <td className="py-1.5 text-right">
                                      <button
                                        disabled={assigning === r.key}
                                        onClick={() => setEligibility(r.key, !r.points_eligible)}
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
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
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
              anyone. Pick their roster entry below and the points land retroactively — the pick sticks for the rest of
              the event.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-gray-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-6 py-2 font-medium">Car #</th>
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
                  <tr key={`${u.identity}|${i}`} className="border-t border-nhra-border/60">
                    <td className="px-6 py-2 text-gray-300">{u.car_number || "—"}</td>
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
                    <td className="px-3 py-2">
                      <select
                        value=""
                        disabled={assigning === u.identity}
                        onChange={(e) => assignRacer(u.identity, e.target.value)}
                        className="max-w-[22rem] px-2 py-1 bg-nhra-darker border border-nhra-border rounded text-xs text-white disabled:opacity-40"
                      >
                        <option value="">
                          {assigning === u.identity ? "Assigning…" : "Pick a roster entry…"}
                        </option>
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
                      </select>
                    </td>
                    <td className="px-6 py-2 text-right text-gray-500 text-xs">
                      {u.reason === "ambiguous" ? "Matches more than one team" : "No roster entry"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
