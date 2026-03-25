"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { StatCard, HighlightCard } from "@/components/StatsCards";
import TimeslipCard from "@/components/TimeslipCard";
import type { TimeslipRun } from "@/components/TimeslipCard";
import { useLiveData } from "@/components/LiveDataProvider";

interface RunRow {
  name: string | null;
  ft1320: number | null;
  mph_1320: number | null;
  rt: number | null;
  ft60: number | null;
  ft330: number | null;
  ft660: number | null;
  mph_660: number | null;
  ft1000: number | null;
  mph_1000: number | null;
  mov: number | null;
  is_winner: number;
  is_dq: number;
  result: string | null;
  category: string | null;
  event_name: string | null;
  event_code: string | null;
  season: string | null;
  round: string | null;
  car_number: string | null;
  timestamp: string | null;
  class_index: string | null;
  lane: string | null;
  dial_in: number | null;
}

function ResultBadgeDark({ run }: { run: { is_winner: number; result?: string | null } }) {
  const r = run.result?.trim().toUpperCase();
  if (r === "W" || (!r && run.is_winner)) return <span className="inline-block px-2 py-0.5 bg-green-500/20 text-green-400 text-xs font-medium rounded">W</span>;
  if (r === "R") return <span className="inline-block px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs font-medium rounded">R</span>;
  if (r === "3") return <span className="inline-block px-2 py-0.5 bg-gray-500/20 text-gray-400 text-xs font-medium rounded">3</span>;
  if (r === "4") return <span className="inline-block px-2 py-0.5 bg-gray-500/20 text-gray-400 text-xs font-medium rounded">4</span>;
  return <span className="text-gray-500 text-xs">-</span>;
}

interface DashboardStats {
  totalRuns: number;
  uniqueRacers: number;
  totalEvents: number;
  seasons: number;
  bestET: RunRow | null;
  bestRT: RunRow | null;
  fastestSpeed: RunRow | null;
  recentRuns: RunRow[];
}

function toTimeslipRun(r: RunRow): TimeslipRun {
  return {
    timestamp: r.timestamp,
    round: r.round,
    car_number: r.car_number,
    name: r.name,
    class_index: r.class_index,
    rt: r.rt,
    ft60: r.ft60,
    ft330: r.ft330 ?? null,
    ft660: r.ft660 ?? null,
    mph_660: r.mph_660 ?? null,
    ft1000: r.ft1000 ?? null,
    mph_1000: r.mph_1000 ?? null,
    ft1320: r.ft1320,
    mph_1320: r.mph_1320,
    mov: r.mov ?? null,
    is_winner: r.is_winner ?? 0,
    is_dq: r.is_dq ?? 0,
    result: r.result ?? null,
    category: r.category,
    lane: r.lane,
    dial_in: r.dial_in,
    event_name: r.event_name,
    event_code: r.event_code ?? null,
    season: r.season ?? null,
  };
}

export default function Dashboard() {
  const live = useLiveData();
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [latestPair, setLatestPair] = useState<RunRow[]>([]);

  useEffect(() => {
    const eventCode = live.config?.eventCode;
    const season = live.config?.season;
    const qs = eventCode
      ? `type=dashboard&event_code=${encodeURIComponent(eventCode)}&season=${encodeURIComponent(season || "")}`
      : "type=dashboard";

    fetch(`/api/stats?${qs}`)
      .then((r) => r.json())
      .then((data) => {
        if (data && typeof data.totalRuns === "number") {
          setStats(data);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));

    if (eventCode) {
      fetch(`/api/stats?type=latest&event_code=${encodeURIComponent(eventCode)}&season=${encodeURIComponent(season || "")}`)
        .then((r) => r.json())
        .then((data) => { if (data?.pair) setLatestPair(data.pair); })
        .catch(console.error);
    }
  }, [live.totalNewRuns, live.config?.eventCode, live.config?.season]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-nhra-red border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  const empty = !stats || !stats.totalRuns;

  // Build timeslip runners from latest group (2-wide or 4-wide)
  const latestRunners: TimeslipRun[] = latestPair.length > 0
    ? [...latestPair]
        .sort((a, b) => {
          // Sort by lane: L before R, or numerically (1,2,3,4)
          const la = a.lane || "";
          const lb = b.lane || "";
          if (la === "L") return -1;
          if (lb === "L") return 1;
          if (la === "R") return 1;
          if (lb === "R") return -1;
          return la.localeCompare(lb);
        })
        .map(toTimeslipRun)
    : [];

  return (
    <div className="max-w-7xl mx-auto">
      {/* Event Banner */}
      {live.config && (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-nhra-red/20 flex items-center justify-center">
                <svg className="w-6 h-6 text-nhra-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">{live.config.eventName}</h2>
                <p className="text-sm text-gray-400">
                  {live.config.season} Season
                  {live.config.dateFilter ? " \u2022 Filtered to one day" : " \u2022 All days"}
                  {live.config.intervalSeconds > 0 ? ` \u2022 Auto every ${live.config.intervalSeconds}s` : " \u2022 Manual refresh"}
                </p>
              </div>
              <button
                onClick={() => router.push("/setup")}
                className="ml-2 px-3 py-1.5 bg-nhra-darker border border-nhra-border text-gray-400 rounded-lg text-xs font-medium hover:text-white hover:border-gray-500 transition-colors flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
                Switch Event
              </button>
            </div>
            <div className="flex items-center gap-3">
              {live.isActive && live.config.intervalSeconds > 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 border border-green-500/20 rounded-lg">
                  <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                  <span className="text-xs text-green-400 font-medium">AUTO</span>
                </div>
              )}
              <button
                onClick={() => live.fetchNow()}
                disabled={live.isFetching}
                className="px-4 py-2 bg-nhra-red/20 border border-nhra-red/30 text-nhra-red rounded-lg text-sm font-medium hover:bg-nhra-red/30 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {live.isFetching ? (
                  <div className="w-3.5 h-3.5 border-2 border-nhra-red border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
                {live.isFetching ? "Fetching..." : "Refresh Data"}
              </button>
            </div>
          </div>
          {(live.lastFetch || live.lastError) && (
            <div className="mt-3 pt-3 border-t border-nhra-border/50 flex items-center justify-between text-xs">
              {live.lastFetch && (
                <p className="text-gray-500">
                  Last fetch: {live.lastFetch.toLocaleTimeString()}
                  {live.lastResult && (
                    <span className="ml-2">
                      {live.lastResult.totalParsed} parsed
                      {live.lastResult.inserted > 0 && <span className="text-green-400 ml-1">+{live.lastResult.inserted} new</span>}
                    </span>
                  )}
                </p>
              )}
              {live.lastError && <p className="text-red-400">{live.lastError}</p>}
              {live.totalNewRuns > 0 && (
                <p className="text-green-400 font-medium">{live.totalNewRuns} new runs this session</p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Dashboard</h1>
        <p className="text-gray-400">NHRA drag racing timing data at a glance</p>
      </div>

      {/* Search */}
      <div className="mb-8">
        <div className="relative max-w-xl">
          <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search racers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && searchQuery.trim()) {
                window.location.href = `/runs?name=${encodeURIComponent(searchQuery.trim())}`;
              }
            }}
            className="w-full pl-12 pr-4 py-3 bg-nhra-card border border-nhra-border rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-nhra-accent transition-colors"
          />
        </div>
      </div>

      {empty ? (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-12 text-center">
          <svg className="w-16 h-16 text-gray-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h2 className="text-xl font-semibold text-white mb-2">Waiting for data...</h2>
          <p className="text-gray-400 mb-2">The live feed is running. Data will appear here as runs come in.</p>
          {live.isFetching && (
            <div className="flex items-center justify-center gap-2 mt-4 text-nhra-accent">
              <div className="w-4 h-4 border-2 border-nhra-accent border-t-transparent rounded-full animate-spin" />
              <span className="text-sm">Fetching data now...</span>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatCard label="Total Runs" value={(stats!.totalRuns ?? 0).toLocaleString()} />
            <StatCard label="Unique Racers" value={(stats!.uniqueRacers ?? 0).toLocaleString()} />
            <StatCard label="Events" value={(stats!.totalEvents ?? 0).toLocaleString()} />
            <StatCard label="Seasons" value={(stats!.seasons ?? 0).toLocaleString()} />
          </div>

          {/* Highlights */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            {stats!.bestET && (
              <HighlightCard
                title="Fastest ET"
                value={`${stats!.bestET.ft1320?.toFixed(3)}s`}
                racerName={stats!.bestET.name || "Unknown"}
                category={stats!.bestET.category || ""}
                event={stats!.bestET.event_name || undefined}
                accentColor="#C8102E"
              />
            )}
            {stats!.bestRT && (
              <HighlightCard
                title="Best Reaction Time"
                value={`${stats!.bestRT.rt?.toFixed(3)}s`}
                racerName={stats!.bestRT.name || "Unknown"}
                category={stats!.bestRT.category || ""}
                event={stats!.bestRT.event_name || undefined}
                accentColor="#22c55e"
              />
            )}
            {stats!.fastestSpeed && (
              <HighlightCard
                title="Fastest Speed"
                value={`${stats!.fastestSpeed.mph_1320?.toFixed(2)} mph`}
                racerName={stats!.fastestSpeed.name || "Unknown"}
                category={stats!.fastestSpeed.category || ""}
                event={stats!.fastestSpeed.event_name || undefined}
                accentColor="#003DA5"
              />
            )}
          </div>

          {/* Last Run Completed - Timeslip */}
          {latestRunners.length > 0 && (
            <div className="mb-8">
              <div className="flex items-center gap-3 mb-4">
                <span className="w-2.5 h-2.5 bg-green-400 rounded-full animate-pulse" />
                <h2 className="text-lg font-semibold text-white">Last Run Completed</h2>
                <span className="text-xs text-gray-500">
                  {latestRunners[0].category} &mdash; Round {latestRunners[0].round}
                  {latestRunners.length > 2 && " \u2022 4-Wide"}
                </span>
              </div>
              <div className="flex justify-center overflow-x-auto">
                <TimeslipCard runners={latestRunners} />
              </div>
            </div>
          )}

          {/* Recent Runs */}
          <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden">
            <div className="p-5 border-b border-nhra-border flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Recent Runs</h2>
              <Link href="/runs" className="text-sm text-nhra-accent hover:underline">View all</Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-nhra-border text-gray-400 text-xs uppercase tracking-wider">
                    <th className="text-left p-3 pl-5">Racer</th>
                    <th className="text-left p-3">Category</th>
                    <th className="text-left p-3">Round</th>
                    <th className="text-right p-3">RT</th>
                    <th className="text-right p-3">ET</th>
                    <th className="text-right p-3">MPH</th>
                    <th className="text-center p-3 pr-5">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {stats!.recentRuns.map((run, i) => (
                    <tr key={i} className="border-b border-nhra-border/50 hover:bg-nhra-border/20 transition-colors">
                      <td className="p-3 pl-5">
                        <Link href={`/racer/${encodeURIComponent(run.name || "")}`} className="text-white hover:text-nhra-accent font-medium">
                          {run.name}
                        </Link>
                        <span className="text-nhra-accent font-bold text-sm ml-2">#{run.car_number}</span>
                      </td>
                      <td className="p-3 text-gray-300">{run.category}</td>
                      <td className="p-3 text-gray-300">{run.round}</td>
                      <td className="p-3 text-right text-gray-300">{run.rt?.toFixed(3) ?? "-"}</td>
                      <td className="p-3 text-right text-white font-mono">{run.ft1320?.toFixed(3) ?? "-"}</td>
                      <td className="p-3 text-right text-gray-300">{run.mph_1320?.toFixed(2) ?? "-"}</td>
                      <td className="p-3 text-center pr-5">
                        <ResultBadgeDark run={run} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
