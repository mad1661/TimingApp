"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { StatCard } from "@/components/StatsCards";
import { ChartContainer, PerformanceLineChart } from "@/components/Charts";
import { classifyCategory, formatLabel, relevantMetrics, type RaceFormat } from "@/lib/categories";
import { useLiveData } from "@/components/LiveDataProvider";

interface TechCard {
  car_number: string;
  first_name: string;
  last_name: string;
  city: string;
  state: string;
  zip: string;
  occupation: string;
  license_number: string;
  home_division: string;
  owner: string;
  crew_chief: string;
  category: string;
  class_name: string;
  engine_make: string;
  engine_year: string;
  body_type: string;
  body_year: string;
  cu_cc: string;
  hp: string;
  factored_hp: string;
  member_number: string;
  member_expiry: string;
  bio_lines: string[];
  event_name?: string;
}

interface Opponent {
  name: string | null;
  car_number: string | null;
  rt: number | null;
  ft1320: number | null;
  mph_1320: number | null;
  is_winner: number;
  result?: string | null;
  lane: string | null;
  dial_in: number | null;
}

interface RunRow {
  timestamp: string | null;
  round: string | null;
  car_number: string | null;
  class_index: string | null;
  rt: number | null;
  ft60: number | null;
  ft1320: number | null;
  mph_1320: number | null;
  is_winner: number;
  result?: string | null;
  category: string | null;
  lane: string | null;
  dial_in: number | null;
  event_name: string | null;
  season: string | null;
  mov: number | null;
  opponents?: Opponent[];
}

export default function RacerPage() {
  const params = useParams();
  const live = useLiveData();
  const name = decodeURIComponent(params.name as string);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [techCards, setTechCards] = useState<TechCard[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ec = live.config?.eventCode;
    const s = live.config?.season;

    const fetchRuns = ec && s
      ? fetch(`/api/stats?type=racer&name=${encodeURIComponent(name)}&event_code=${encodeURIComponent(ec)}&season=${encodeURIComponent(s)}`)
          .then((r) => r.json())
          .then((data) => setRuns(data.runs || []))
          .catch(console.error)
      : Promise.resolve();

    const nameParts = name.split(" ");
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";
    const fetchTechCards = firstName && lastName
      ? fetch(`/api/tech-cards?first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName)}`)
          .then((r) => r.json())
          .then((data) => setTechCards(data.results || []))
          .catch(console.error)
      : Promise.resolve();

    Promise.all([fetchRuns, fetchTechCards]).finally(() => setLoading(false));
  }, [name, live.config?.eventCode, live.config?.season]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-12 h-12 border-4 border-nhra-red border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const validETs = runs.filter((r) => r.ft1320 && r.ft1320 > 0);
  const validRTs = runs.filter((r) => r.rt && r.rt > 0);
  const wins = runs.filter((r) => r.is_winner);
  const categories = [...new Set(runs.map((r) => r.category).filter(Boolean))];
  const seasons = [...new Set(runs.map((r) => r.season).filter(Boolean))].sort().reverse();

  const bestET = validETs.length > 0 ? Math.min(...validETs.map((r) => r.ft1320!)) : null;
  const avgET = validETs.length > 0 ? validETs.reduce((s, r) => s + r.ft1320!, 0) / validETs.length : null;
  const bestRT = validRTs.length > 0 ? Math.min(...validRTs.map((r) => r.rt!)) : null;
  const avgRT = validRTs.length > 0 ? validRTs.reduce((s, r) => s + r.rt!, 0) / validRTs.length : null;
  const bestSpeed = runs.filter((r) => r.mph_1320 && r.mph_1320 > 0).length > 0
    ? Math.max(...runs.filter((r) => r.mph_1320! > 0).map((r) => r.mph_1320!)) : null;

  // Consistency: standard deviation of ETs
  const etStdDev = validETs.length > 1 && avgET
    ? Math.sqrt(validETs.reduce((sum, r) => sum + Math.pow(r.ft1320! - avgET, 2), 0) / (validETs.length - 1))
    : null;

  // Dial-in accuracy: avg difference between ET and dial-in
  const dialRuns = runs.filter((r) => r.ft1320 && r.ft1320 > 0 && r.dial_in && r.dial_in > 0);
  const avgDialDiff = dialRuns.length > 0
    ? dialRuns.reduce((s, r) => s + Math.abs(r.ft1320! - r.dial_in!), 0) / dialRuns.length
    : null;
  const breakoutCount = dialRuns.filter((r) => r.ft1320! < r.dial_in!).length;

  // Head-to-head record against opponents
  const h2hMap = new Map<string, { wins: number; losses: number }>();
  runs.forEach((r) => {
    r.opponents?.forEach((opp) => {
      if (!opp.name) return;
      const rec = h2hMap.get(opp.name) || { wins: 0, losses: 0 };
      if (r.is_winner) rec.wins++;
      else rec.losses++;
      h2hMap.set(opp.name, rec);
    });
  });
  const h2hRecords = Array.from(h2hMap.entries())
    .map(([oppName, record]) => ({ oppName, ...record, total: record.wins + record.losses }))
    .filter((r) => r.total >= 2)
    .sort((a, b) => b.total - a.total);

  const etTrend = validETs
    .sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""))
    .map((r, i) => ({ label: `#${i + 1}`, value: r.ft1320! }));

  const rtTrend = validRTs
    .sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""))
    .map((r, i) => ({ label: `#${i + 1}`, value: r.rt! }));

  // "What They Normally Run" - median/typical values
  const sortedETs = validETs.map((r) => r.ft1320!).sort((a, b) => a - b);
  const medianET = sortedETs.length > 0
    ? sortedETs.length % 2 === 0
      ? (sortedETs[sortedETs.length / 2 - 1] + sortedETs[sortedETs.length / 2]) / 2
      : sortedETs[Math.floor(sortedETs.length / 2)]
    : null;

  const valid60 = runs.filter((r) => r.ft60 && r.ft60 > 0);
  const avg60 = valid60.length > 0 ? valid60.reduce((s, r) => s + r.ft60!, 0) / valid60.length : null;
  const median60 = (() => {
    const sorted = valid60.map((r) => r.ft60!).sort((a, b) => a - b);
    if (sorted.length === 0) return null;
    return sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];
  })();

  const validSpeeds = runs.filter((r) => r.mph_1320 && r.mph_1320 > 0);
  const avgSpeed = validSpeeds.length > 0 ? validSpeeds.reduce((s, r) => s + r.mph_1320!, 0) / validSpeeds.length : null;

  // Classify primary category
  const primaryCategory = categories[0] || "";
  const raceFormat: RaceFormat = classifyCategory(primaryCategory);
  const metrics = relevantMetrics(raceFormat);

  // Pass-by-pass deltas - sorted chronologically
  const sortedRuns = [...runs].sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));
  const runDeltas = sortedRuns.map((run, i) => {
    if (i === 0 || !run.ft1320 || run.ft1320 <= 0) return { run, etDelta: null, rtDelta: null };
    const prev = sortedRuns[i - 1];
    const etDelta = prev.ft1320 && prev.ft1320 > 0 ? run.ft1320 - prev.ft1320 : null;
    const rtDelta = run.rt && run.rt > 0 && prev.rt && prev.rt > 0 ? run.rt - prev.rt : null;
    return { run, etDelta, rtDelta };
  });

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">{name}</h1>
        <p className="text-gray-400">
          {runs.length} runs across {seasons.length} season{seasons.length !== 1 ? "s" : ""}
          {categories.length > 0 && ` | ${categories.join(", ")}`}
        </p>
      </div>

      {/* Tech Card Info */}
      {techCards.length > 0 && (
        <div className="mb-8 space-y-4">
          {techCards.map((tc, i) => (
            <div key={i} className="bg-nhra-card border border-nhra-border rounded-xl p-5">
              <div className="flex items-center gap-3 mb-4">
                <h3 className="text-lg font-semibold text-white">Tech Card</h3>
                <span className="text-nhra-accent font-bold text-sm">#{tc.car_number}</span>
                <span className="text-gray-400 text-sm">{tc.category}{tc.class_name ? ` - ${tc.class_name}` : ""}</span>
                {tc.member_number && (
                  <span className="ml-auto text-xs text-gray-500 bg-nhra-darker px-2 py-1 rounded">Member #{tc.member_number}</span>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                {(tc.city || tc.state) && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Location</p>
                    <p className="text-gray-300">{[tc.city, tc.state].filter(Boolean).join(", ")}</p>
                  </div>
                )}
                {tc.engine_make && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Engine</p>
                    <p className="text-gray-300">{tc.engine_make}{tc.engine_year ? ` (${tc.engine_year})` : ""}</p>
                  </div>
                )}
                {tc.body_type && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Body</p>
                    <p className="text-gray-300">{tc.body_type}{tc.body_year ? ` (${tc.body_year})` : ""}</p>
                  </div>
                )}
                {tc.hp && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Horsepower</p>
                    <p className="text-gray-300">{tc.hp}{tc.factored_hp ? ` (factored: ${tc.factored_hp})` : ""}</p>
                  </div>
                )}
                {tc.cu_cc && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase">CU/CC</p>
                    <p className="text-gray-300">{tc.cu_cc}</p>
                  </div>
                )}
                {tc.owner && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Owner</p>
                    <p className="text-gray-300">{tc.owner}</p>
                  </div>
                )}
                {tc.crew_chief && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Crew Chief</p>
                    <p className="text-gray-300">{tc.crew_chief}</p>
                  </div>
                )}
                {tc.home_division && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Home Division</p>
                    <p className="text-gray-300">{tc.home_division}</p>
                  </div>
                )}
                {tc.license_number && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase">License #</p>
                    <p className="text-gray-300">{tc.license_number}</p>
                  </div>
                )}
              </div>
              {tc.bio_lines && tc.bio_lines.length > 0 && (
                <div className="mt-4 pt-4 border-t border-nhra-border/50">
                  <p className="text-xs text-gray-500 uppercase mb-2">Bio</p>
                  <div className="text-sm text-gray-400 space-y-1">
                    {tc.bio_lines.map((line, li) => (
                      <p key={li}>{line}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {runs.length === 0 && techCards.length === 0 && (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-12 text-center text-gray-500">
          No runs found for this racer.
        </div>
      )}

      {runs.length > 0 && (
        <>
          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4 mb-8">
            <StatCard label="Total Runs" value={runs.length} />
            <StatCard label="Wins" value={wins.length} sub={`${((wins.length / runs.length) * 100).toFixed(0)}% win rate`} />
            <StatCard label="Best ET" value={bestET?.toFixed(3) ?? "-"} />
            <StatCard label="Avg ET" value={avgET?.toFixed(3) ?? "-"} />
            <StatCard label="Best RT" value={bestRT?.toFixed(3) ?? "-"} />
            <StatCard label="Avg RT" value={avgRT?.toFixed(3) ?? "-"} />
            <StatCard label="Consistency" value={etStdDev ? `\u00b1${etStdDev.toFixed(3)}` : "-"} sub="ET std dev" />
            <StatCard label="Top Speed" value={bestSpeed ? `${bestSpeed.toFixed(2)}` : "-"} sub="mph" />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {etTrend.length > 2 && (
              <ChartContainer title="ET Trend (1320ft)" height={280}>
                <PerformanceLineChart data={etTrend} color="#C8102E" yLabel="ET (sec)" />
              </ChartContainer>
            )}
            {rtTrend.length > 2 && (
              <ChartContainer title="Reaction Time Trend" height={280}>
                <PerformanceLineChart data={rtTrend} color="#22c55e" yLabel="RT (sec)" />
              </ChartContainer>
            )}
          </div>

          {/* What They Normally Run + Class Insights */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <div className="bg-nhra-card border border-nhra-border rounded-xl p-5">
              <h3 className="text-lg font-semibold text-white mb-4">What They Normally Run</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-nhra-darker rounded-lg p-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Typical ET</p>
                  <p className="text-2xl font-black text-white font-mono">{medianET?.toFixed(3) ?? "-"}</p>
                  <p className="text-xs text-gray-600 mt-1">avg {avgET?.toFixed(3) ?? "-"}</p>
                </div>
                <div className="bg-nhra-darker rounded-lg p-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Typical 60&apos;</p>
                  <p className="text-2xl font-black text-white font-mono">{median60?.toFixed(3) ?? "-"}</p>
                  <p className="text-xs text-gray-600 mt-1">avg {avg60?.toFixed(3) ?? "-"}</p>
                </div>
                <div className="bg-nhra-darker rounded-lg p-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Typical Speed</p>
                  <p className="text-2xl font-black text-white font-mono">{avgSpeed?.toFixed(2) ?? "-"}</p>
                  <p className="text-xs text-gray-600 mt-1">mph</p>
                </div>
                <div className="bg-nhra-darker rounded-lg p-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Typical RT</p>
                  <p className="text-2xl font-black text-white font-mono">{avgRT?.toFixed(3) ?? "-"}</p>
                  <p className="text-xs text-gray-600 mt-1">best {bestRT?.toFixed(3) ?? "-"}</p>
                </div>
              </div>
              {etStdDev != null && (
                <div className="mt-4 pt-4 border-t border-nhra-border/50">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">ET Range</span>
                    <span className="font-mono text-white">
                      {(medianET! - etStdDev).toFixed(3)} &mdash; {(medianET! + etStdDev).toFixed(3)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">Based on &plusmn;1 std dev from median</p>
                </div>
              )}
            </div>

            {raceFormat !== "unknown" && (
              <div className="bg-nhra-card border border-nhra-border rounded-xl p-5">
                <div className="flex items-center gap-3 mb-4">
                  <h3 className="text-lg font-semibold text-white">Class Insights</h3>
                  <span className="px-2.5 py-1 bg-nhra-red/20 text-nhra-red text-xs font-bold rounded-lg">{formatLabel(raceFormat)}</span>
                </div>
                <p className="text-sm text-gray-400 mb-4">
                  {raceFormat === "bracket" && "Bracket racing rewards consistent ETs and sharp reaction times. Dial-in accuracy and avoiding breakouts are critical."}
                  {raceFormat === "heads_up" && "Heads-up racing is all about raw performance. ET and speed are the key metrics."}
                  {raceFormat === "index" && "Index racing requires running close to class index without breaking out. Consistency matters more than speed."}
                  {raceFormat === "handicap" && "Handicap racing combines reaction time with dial-in accuracy. Breakouts are losses regardless of who crosses first."}
                </p>
                <div className="space-y-3">
                  <p className="text-xs text-gray-500 uppercase tracking-wider">Key Metrics for {formatLabel(raceFormat)}</p>
                  <div className="flex flex-wrap gap-2">
                    {metrics.map((m) => (
                      <span key={m} className="px-3 py-1.5 bg-nhra-darker text-gray-300 text-xs rounded-lg">{m}</span>
                    ))}
                  </div>
                </div>
                {raceFormat === "bracket" || raceFormat === "handicap" || raceFormat === "index" ? (
                  <div className="mt-4 pt-4 border-t border-nhra-border/50 grid grid-cols-3 gap-3">
                    <div>
                      <p className="text-xs text-gray-500 uppercase">Breakout Rate</p>
                      <p className="text-lg font-bold text-white font-mono">{dialRuns.length > 0 ? `${((breakoutCount / dialRuns.length) * 100).toFixed(0)}%` : "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase">Avg Dial Diff</p>
                      <p className="text-lg font-bold text-white font-mono">{avgDialDiff != null ? `${avgDialDiff.toFixed(4)}s` : "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase">Win Rate</p>
                      <p className="text-lg font-bold text-white font-mono">{runs.length > 0 ? `${((wins.length / runs.length) * 100).toFixed(0)}%` : "-"}</p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 pt-4 border-t border-nhra-border/50 grid grid-cols-3 gap-3">
                    <div>
                      <p className="text-xs text-gray-500 uppercase">Best ET</p>
                      <p className="text-lg font-bold text-white font-mono">{bestET?.toFixed(3) ?? "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase">Top Speed</p>
                      <p className="text-lg font-bold text-white font-mono">{bestSpeed?.toFixed(2) ?? "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase">Win Rate</p>
                      <p className="text-lg font-bold text-white font-mono">{runs.length > 0 ? `${((wins.length / runs.length) * 100).toFixed(0)}%` : "-"}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Dial-In Accuracy & Head-to-Head */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            {/* Dial-In Accuracy */}
            {dialRuns.length > 0 && (
              <div className="bg-nhra-card border border-nhra-border rounded-xl p-5">
                <h3 className="text-lg font-semibold text-white mb-4">Dial-In Accuracy</h3>
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Avg Diff from Dial</p>
                    <p className="text-xl font-bold text-white font-mono">{avgDialDiff != null ? `${avgDialDiff.toFixed(4)}s` : "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Breakouts</p>
                    <p className="text-xl font-bold text-red-400 font-mono">{breakoutCount}</p>
                    <p className="text-xs text-gray-600">{((breakoutCount / dialRuns.length) * 100).toFixed(0)}% of dial runs</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Dial Runs</p>
                    <p className="text-xl font-bold text-gray-300 font-mono">{dialRuns.length}</p>
                  </div>
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {dialRuns.slice(0, 15).map((r, i) => {
                    const diff = r.ft1320! - r.dial_in!;
                    const isBreakout = diff < 0;
                    return (
                      <div key={i} className="flex items-center justify-between text-xs py-1 px-2 rounded hover:bg-nhra-border/20">
                        <span className="text-gray-400">{r.round} &bull; {r.timestamp?.split(" ")[0]}</span>
                        <div className="flex items-center gap-3 font-mono">
                          <span className="text-gray-500">Dial {r.dial_in?.toFixed(2)}</span>
                          <span className="text-white">{r.ft1320?.toFixed(3)}</span>
                          <span className={`font-medium ${isBreakout ? "text-red-400" : diff < 0.02 ? "text-green-400" : "text-gray-400"}`}>
                            {diff >= 0 ? "+" : ""}{diff.toFixed(4)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Head-to-Head Records */}
            {h2hRecords.length > 0 && (
              <div className="bg-nhra-card border border-nhra-border rounded-xl p-5">
                <h3 className="text-lg font-semibold text-white mb-4">Head-to-Head</h3>
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {h2hRecords.map((rec) => {
                    const winPct = (rec.wins / rec.total) * 100;
                    return (
                      <div key={rec.oppName} className="flex items-center justify-between py-2 px-3 rounded hover:bg-nhra-border/20">
                        <Link
                          href={`/racer/${encodeURIComponent(rec.oppName)}`}
                          className="text-white hover:text-nhra-accent text-sm font-medium truncate max-w-[160px]"
                        >
                          {rec.oppName}
                        </Link>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1.5 text-xs font-mono">
                            <span className="text-green-400 font-bold">{rec.wins}W</span>
                            <span className="text-gray-600">-</span>
                            <span className="text-red-400">{rec.losses}L</span>
                          </div>
                          <div className="w-20 h-2 bg-red-500/30 rounded-full overflow-hidden">
                            <div className="h-full bg-green-500 rounded-full" style={{ width: `${winPct}%` }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Run History Table */}
          <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden">
            <div className="p-5 border-b border-nhra-border">
              <h2 className="text-lg font-semibold text-white">Run History</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-nhra-border text-gray-400 text-xs uppercase tracking-wider">
                    <th className="text-left p-3 pl-5">Date</th>
                    <th className="text-left p-3">Event</th>
                    <th className="text-left p-3">Category</th>
                    <th className="text-left p-3">Round</th>
                    <th className="text-right p-3">RT</th>
                    <th className="text-right p-3">ET</th>
                    <th className="text-right p-3 w-16">Delta</th>
                    <th className="text-right p-3">MPH</th>
                    <th className="text-center p-3">Result</th>
                    <th className="text-right p-3">Dial</th>
                    <th className="text-left p-3 pr-5">Opponents</th>
                  </tr>
                </thead>
                <tbody>
                  {runDeltas.map(({ run, etDelta }, i) => {
                    const opp = run.opponents?.[0];
                    const isSlower = etDelta != null && etDelta > 0.01;
                    const isFaster = etDelta != null && etDelta < -0.01;
                    const isOff = run.ft1320 && medianET && Math.abs(run.ft1320 - medianET) > (etStdDev || 0.1);
                    return (
                      <tr key={i} className={`border-b border-nhra-border/50 hover:bg-nhra-border/20 ${isOff ? "bg-yellow-500/5" : ""}`}>
                        <td className="p-3 pl-5 text-gray-300 whitespace-nowrap">{run.timestamp?.split(" ")[0] ?? "-"}</td>
                        <td className="p-3 text-white whitespace-nowrap">{run.event_name || "-"}</td>
                        <td className="p-3 text-gray-300 text-xs">{run.category}</td>
                        <td className="p-3 text-gray-300">{run.round}</td>
                        <td className="p-3 text-right font-mono text-gray-300">{run.rt?.toFixed(3) ?? "-"}</td>
                        <td className="p-3 text-right font-mono text-white font-medium">{run.ft1320?.toFixed(3) ?? "-"}</td>
                        <td className="p-3 text-right font-mono text-xs">
                          {etDelta != null ? (
                            <span className={isFaster ? "text-green-400" : isSlower ? "text-red-400" : "text-gray-500"}>
                              {etDelta >= 0 ? "+" : ""}{etDelta.toFixed(3)}
                            </span>
                          ) : (
                            <span className="text-gray-700">&mdash;</span>
                          )}
                        </td>
                        <td className="p-3 text-right font-mono text-gray-300">{run.mph_1320?.toFixed(2) ?? "-"}</td>
                        <td className="p-3 text-center">
                          {(() => {
                            const res = run.result?.trim().toUpperCase();
                            if (res === "W" || (!res && run.is_winner)) return <span className="text-green-400 font-bold text-xs">W</span>;
                            if (res === "R") return <span className="text-blue-400 font-bold text-xs">R</span>;
                            if (res === "3") return <span className="text-gray-400 font-bold text-xs">3</span>;
                            if (res === "4") return <span className="text-gray-500 font-bold text-xs">4</span>;
                            return <span className="text-gray-600">L</span>;
                          })()}
                        </td>
                        <td className="p-3 text-right font-mono text-gray-400">{run.dial_in?.toFixed(2) ?? "-"}</td>
                        <td className="p-3 pr-5 whitespace-nowrap">
                          {run.opponents && run.opponents.length > 0 ? (
                            <div className="space-y-0.5">
                              {run.opponents.map((opp, oi) => (
                                <div key={oi}>
                                  <Link
                                    href={`/racer/${encodeURIComponent(opp.name || "")}`}
                                    className="text-gray-300 hover:text-nhra-accent text-xs"
                                  >
                                    {opp.name}
                                  </Link>
                                  <span className="text-gray-600 text-xs ml-1.5">
                                    {opp.ft1320?.toFixed(3) ?? "-"}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-gray-600 text-xs">Solo / BYE</span>
                          )}
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
