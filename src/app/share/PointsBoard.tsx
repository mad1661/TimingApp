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

export interface PointsBoardProps {
  eventCode: string;
  season: string;
  view?: "combined" | "big" | "jr";
  title?: string;
  /** How often to re-read the standings. Defaults to 10 minutes. */
  refreshSeconds?: number;
}

const DEFAULT_REFRESH_SECONDS = 600;

function Board({
  eventCode,
  season,
  view = "combined",
  title = "",
  refreshSeconds,
}: PointsBoardProps) {
  const every = Math.max(15, refreshSeconds || DEFAULT_REFRESH_SECONDS);
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
    const t = setInterval(load, every * 1000);
    return () => clearInterval(t);
  }, [load, every]);

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
    <div className="min-h-screen px-3 py-6 sm:px-8 sm:py-8">
      <div className="max-w-3xl mx-auto">
        <header className="mb-4 sm:mb-6 text-center">
          <h1 className="text-xl sm:text-3xl md:text-4xl font-bold text-white tracking-tight text-balance">
            {title || "Summit E.T. Finals — Team Points"}
          </h1>
          <p className="text-xs sm:text-sm text-gray-400 mt-1.5 sm:mt-2">
            {eventCode} · {season}
            {view === "big" ? " · Big Cars" : view === "jr" ? " · Jrs" : ""}
            {data?.roundsScored?.length ? (
              <span className="block sm:inline">
                <span className="hidden sm:inline"> · </span>
                Rounds scored: {data.roundsScored.join(", ")}
              </span>
            ) : null}
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
          // A row per team rather than a table: five columns of numbers don't
          // survive a phone, and this reads the same on a phone, a laptop or a
          // screen in the tower.
          <ol className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden divide-y divide-nhra-border/60">
            {teams.map((t, i) => (
              <li key={t.track_code} className="flex items-center gap-3 px-3 py-3 sm:px-5 sm:py-4">
                <span className="w-7 shrink-0 text-center text-base sm:text-lg font-bold text-gray-500">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-white font-semibold text-base sm:text-xl leading-tight">
                    {t.team_name}
                  </span>
                  {view === "combined" && (
                    <span className="block text-xs sm:text-sm text-gray-500 mt-0.5">
                      Big Cars {t.bigPoints} · Jrs {t.jrPoints}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-3xl sm:text-4xl font-bold text-nhra-red tabular-nums leading-none">
                  {pointsOf(t)}
                </span>
              </li>
            ))}
          </ol>
        )}

        <p className="text-center text-xs text-gray-600 mt-4 sm:mt-6">
          {updated
            ? `Updated ${updated.toLocaleTimeString()} · refreshes every ${
                every % 60 === 0 ? `${every / 60} min` : `${every} sec`
              }`
            : ""}
        </p>
      </div>
    </div>
  );
}

export default function PointsBoard(props: PointsBoardProps) {
  return (
    <Suspense fallback={null}>
      <Board {...props} />
    </Suspense>
  );
}

/** Query-string form: /share/team-points?event=CODE&season=YEAR[&view=][&title=] */
export function PointsBoardFromQuery() {
  const params = useSearchParams();
  return (
    <Suspense fallback={null}>
      <Board
        eventCode={params.get("event") || params.get("event_code") || ""}
        season={params.get("season") || ""}
        view={(params.get("view") || "combined") as "combined" | "big" | "jr"}
        title={params.get("title") || ""}
        refreshSeconds={Number(params.get("refresh")) || undefined}
      />
    </Suspense>
  );
}
