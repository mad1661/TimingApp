"use client";

import { useEffect, useState } from "react";
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
  const base = "inline-flex min-w-[1.75rem] justify-center px-2 py-0.5 text-xs font-bold rounded-md ring-1 ring-inset";
  if (r === "W" || (!r && run.is_winner)) return <span className={`${base} bg-green-500/15 text-green-400 ring-green-500/30`}>W</span>;
  if (r === "R") return <span className={`${base} bg-blue-500/15 text-blue-400 ring-blue-500/30`}>R</span>;
  if (r === "3") return <span className={`${base} bg-gray-500/15 text-gray-400 ring-gray-500/25`}>3</span>;
  if (r === "4") return <span className={`${base} bg-gray-500/15 text-gray-400 ring-gray-500/25`}>4</span>;
  return <span className="text-gray-500 text-xs">-</span>;
}

function Icon({ d }: { d: string }) {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={d} />
    </svg>
  );
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

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [latestPair, setLatestPair] = useState<RunRow[]>([]);

  useEffect(() => {
    const eventCode = live.config?.eventCode;
    const season = live.config?.season;
    // Tie a unique token to dataVersion so the URL changes on every refresh,
    // forcing the browser past any cached response from a previous tick.
    const bust = `_v=${live.dataVersion}`;
    const qs = eventCode
      ? `type=dashboard&event_code=${encodeURIComponent(eventCode)}&season=${encodeURIComponent(season || "")}&${bust}`
      : `type=dashboard&${bust}`;

    fetch(`/api/stats?${qs}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (data && typeof data.totalRuns === "number") {
          setStats(data);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));

    if (eventCode) {
      fetch(`/api/stats?type=latest&event_code=${encodeURIComponent(eventCode)}&season=${encodeURIComponent(season || "")}&${bust}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((data) => { if (data?.pair) setLatestPair(data.pair); })
        .catch(console.error);
    }
  }, [live.dataVersion, live.totalNewRuns, live.config?.eventCode, live.config?.season]);

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
      <div className="mb-7 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-1">Dashboard</h1>
          <p className="text-gray-400">NHRA drag racing timing data at a glance</p>
        </div>

        {/* Search */}
        <div className="relative w-full md:max-w-md">
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
            className="w-full pl-12 pr-16 py-3 bg-nhra-card border border-nhra-border rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-nhra-accent transition-colors"
          />
          <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-nhra-border bg-nhra-darker px-1.5 py-0.5 font-sans text-[0.65rem] font-semibold text-gray-500">
            Enter
          </kbd>
        </div>
      </div>

      {empty ? (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-12 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-nhra-darker ring-1 ring-inset ring-nhra-border">
            <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4">
            <StatCard
              label="Total Runs"
              value={(stats!.totalRuns ?? 0).toLocaleString()}
              color="white"
              icon={<Icon d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />}
            />
            <StatCard
              label="Unique Racers"
              value={(stats!.uniqueRacers ?? 0).toLocaleString()}
              color="white"
              icon={<Icon d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />}
            />
            <StatCard
              label="Events"
              value={(stats!.totalEvents ?? 0).toLocaleString()}
              color="white"
              icon={<Icon d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />}
            />
            <StatCard
              label="Seasons"
              value={(stats!.seasons ?? 0).toLocaleString()}
              color="white"
              icon={<Icon d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />}
            />
          </div>

          {/* Highlights */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4 mb-10">
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
                accentColor="#3b82f6"
              />
            )}
          </div>

          {/* Last Run Completed - Timeslip */}
          {latestRunners.length > 0 && (
            <div className="mb-10">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-4">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-400" />
                </span>
                <h2 className="text-xl font-bold text-white">Last Run Completed</h2>
                <span className="rounded-md border border-nhra-border bg-nhra-card px-2 py-0.5 text-xs font-medium text-gray-400">
                  {latestRunners[0].category} &mdash; Round {latestRunners[0].round}
                  {latestRunners.length > 2 && " \u2022 4-Wide"}
                </span>
              </div>
              <div className="relative overflow-hidden rounded-2xl border border-nhra-border bg-nhra-darker px-3 py-6 sm:px-6 sm:py-8">
                <div
                  className="pointer-events-none absolute inset-0 opacity-60 light:opacity-40"
                  style={{
                    backgroundImage:
                      "radial-gradient(600px 240px at 50% 0%, rgb(90 169 255 / 0.10), transparent 70%), repeating-linear-gradient(90deg, rgb(148 163 184 / 0.05) 0 1px, transparent 1px 48px)",
                  }}
                />
                <div className="relative flex justify-center overflow-x-auto [&_.timeslip-card]:shadow-[0_24px_60px_-24px_rgb(0_0_0_/_0.9)] light:[&_.timeslip-card]:shadow-[0_18px_40px_-24px_rgb(15_23_42_/_0.35)]">
                  <TimeslipCard runners={latestRunners} />
                </div>
              </div>
            </div>
          )}

          {/* Recent Runs */}
          <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-nhra-border flex items-center justify-between">
              <h2 className="text-xl font-bold text-white">Recent Runs</h2>
              <Link href="/runs" className="inline-flex items-center gap-1 text-sm font-medium text-nhra-accent hover:underline">
                View all
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-nhra-border text-gray-400 text-[0.7rem] uppercase tracking-[0.1em]">
                    <th className="text-left font-semibold p-3 pl-5">Racer</th>
                    <th className="text-left font-semibold p-3">Category</th>
                    <th className="text-left font-semibold p-3">Round</th>
                    <th className="text-right font-semibold p-3">RT</th>
                    <th className="text-right font-semibold p-3">ET</th>
                    <th className="text-right font-semibold p-3">MPH</th>
                    <th className="text-center font-semibold p-3 pr-5">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {stats!.recentRuns.map((run, i) => {
                    const res = run.result?.trim().toUpperCase();
                    const rowBg = (res === "W" || (!res && run.is_winner)) ? "bg-green-500/10" : res === "R" ? "bg-blue-500/10" : "";
                    return (
                    <tr key={i} className={`border-b border-nhra-border/50 last:border-0 hover:bg-nhra-border/20 transition-colors ${rowBg}`}>
                      <td className="p-3 pl-5 whitespace-nowrap">
                        <Link href={`/racer/${encodeURIComponent(run.name || "")}`} className="text-white hover:text-nhra-accent font-medium">
                          {run.name}
                        </Link>
                        <span className="text-nhra-accent font-bold text-sm ml-2">#{run.car_number}</span>
                      </td>
                      <td className="p-3 text-gray-300 text-xs font-medium tracking-wide">{run.category}</td>
                      <td className="p-3 text-gray-300">{run.round}</td>
                      <td className="p-3 text-right text-gray-300 font-mono">{run.rt?.toFixed(3) ?? "-"}</td>
                      <td className="p-3 text-right text-white font-mono font-semibold">{run.ft1320?.toFixed(3) ?? "-"}</td>
                      <td className="p-3 text-right text-gray-300 font-mono">{run.mph_1320?.toFixed(2) ?? "-"}</td>
                      <td className="p-3 text-center pr-5">
                        <ResultBadgeDark run={run} />
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
