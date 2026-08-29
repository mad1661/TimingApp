"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Public, read-only team points board — standings only.
 *
 * Shared with teams and the tower, so it deliberately carries nothing but the
 * standings: no per-team driver breakdown, no unmatched list, no setup, no
 * corrections. Lives under /share so AppShell drops the navbar and event
 * banner, and it needs no credentials (the ET Finals API is read-only).
 */
interface ShareTeam {
  track_code: string;
  team_name: string;
  bigPoints: number;
  jrPoints: number;
  totalPoints: number;
  rank: number;
  bigAdjustment: number;
  jrAdjustment: number;
}

interface ShareData {
  teams: ShareTeam[];
  totals: { bigPoints: number; jrPoints: number; totalPoints: number };
  roundsScored: string[];
}

function PointsBoard() {
  const params = useSearchParams();
  const eventCode = params.get("event") || params.get("event_code") || "";
  const season = params.get("season") || "";
  const title = params.get("title") || "";
  const view = (params.get("view") || "combined") as "combined" | "big" | "jr";

  const [data, setData] = useState<ShareData | null>(null);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    if (!eventCode || !season) return;
    try {
      const res = await fetch(
        `/api/et-finals?event_code=${encodeURIComponent(eventCode)}&season=${encodeURIComponent(season)}`,
        { cache: "no-store" },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Couldn't load the points");
      setData(body as ShareData);
      setUpdated(new Date());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the points");
    }
  }, [eventCode, season]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  if (!eventCode || !season) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <h1 className="text-2xl font-bold text-white mb-2">Team Points</h1>
        <p className="text-gray-400">
          This link needs an event — add <code className="text-gray-300">?event=CODE&amp;season=YEAR</code> to the
          address.
        </p>
      </div>
    );
  }

  const pointsOf = (t: ShareTeam) =>
    view === "big" ? t.bigPoints : view === "jr" ? t.jrPoints : t.totalPoints;
  const teams = [...(data?.teams || [])].sort(
    (a, b) => pointsOf(b) - pointsOf(a) || a.team_name.localeCompare(b.team_name),
  );

  return (
    <div className="min-h-screen px-4 py-8 sm:px-8">
      <div className="max-w-3xl mx-auto">
        <header className="mb-6 text-center">
          <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
            {title || "Summit E.T. Finals — Team Points"}
          </h1>
          <p className="text-sm text-gray-400 mt-2">
            {eventCode} · {season}
            {data?.roundsScored?.length ? ` · Rounds scored: ${data.roundsScored.join(", ")}` : ""}
            {view === "big" ? " · Big Cars" : view === "jr" ? " · Jrs" : ""}
          </p>
        </header>

        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/40 text-red-400 rounded-xl px-4 py-3 text-sm text-center">
            {error}
          </div>
        )}

        {!data && !error ? (
          <div className="flex justify-center py-16">
            <div className="w-10 h-10 border-4 border-nhra-red border-t-transparent rounded-full animate-spin" />
          </div>
        ) : teams.length === 0 ? (
          <p className="text-center text-gray-500 py-16">No points yet.</p>
        ) : (
          <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden">
            <table className="w-full">
              <thead className="bg-nhra-darker text-gray-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-3 font-medium w-14">#</th>
                  <th className="text-left px-4 py-3 font-medium">Team</th>
                  {view !== "jr" && <th className="text-right px-4 py-3 font-medium">Big Cars</th>}
                  {view !== "big" && <th className="text-right px-4 py-3 font-medium">Jrs</th>}
                  <th className="text-right px-4 py-3 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((t, i) => (
                  <tr key={t.track_code} className="border-t border-nhra-border/60">
                    <td className="px-4 py-3 text-gray-500 font-bold text-lg">{i + 1}</td>
                    <td className="px-4 py-3">
                      <div className="text-white font-semibold text-lg">{t.team_name}</div>
                      <div className="text-xs text-gray-500">{t.track_code}</div>
                    </td>
                    {view !== "jr" && (
                      <td className="px-4 py-3 text-right text-white font-semibold">{t.bigPoints}</td>
                    )}
                    {view !== "big" && (
                      <td className="px-4 py-3 text-right text-white font-semibold">{t.jrPoints}</td>
                    )}
                    <td className="px-4 py-3 text-right text-2xl font-bold text-nhra-red">{pointsOf(t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-center text-xs text-gray-600 mt-6">
          {updated ? `Updated ${updated.toLocaleTimeString()} · refreshes every minute` : ""}
        </p>
      </div>
    </div>
  );
}

export default function SharePointsPage() {
  return (
    <Suspense fallback={null}>
      <PointsBoard />
    </Suspense>
  );
}
