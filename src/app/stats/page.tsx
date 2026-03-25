"use client";

import { useEffect, useState } from "react";
import { ChartContainer, CategoryBarChart } from "@/components/Charts";
import { useLiveData } from "@/components/LiveDataProvider";

interface HeadsUpStat {
  category: string;
  type: "headsup";
  count: number;
  bestET: number | null;
  bestSpeed: number | null;
  best60ft: number | null;
  best330: number | null;
  best660: number | null;
  best660mph: number | null;
  best1000: number | null;
  avgRT: number | null;
  bestRT: number | null;
}

interface BracketStat {
  category: string;
  type: "bracket";
  count: number;
  avgRT: number | null;
  bestRT: number | null;
  avgPackage: number | null;
  bestPackage: number | null;
  avgDialDeviation: number | null;
  etStdDev: number | null;
  breakoutRate: number | null;
  breakoutCount: number;
  winCount: number;
  lossCount: number;
  bestET: number | null;
  bestSpeed: number | null;
}

type DetailedStat = HeadsUpStat | BracketStat;

function fmt(v: number | null | undefined, decimals = 3): string {
  if (v === null || v === undefined) return "-";
  return v.toFixed(decimals);
}

function pct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "-";
  return (v * 100).toFixed(1) + "%";
}

export default function StatsPage() {
  const live = useLiveData();
  const [stats, setStats] = useState<DetailedStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const eventCode = live.config?.eventCode;
    const season = live.config?.season;
    const eventQS = eventCode
      ? `&event_code=${encodeURIComponent(eventCode)}&season=${encodeURIComponent(season || "")}`
      : "";

    fetch(`/api/stats?type=detailed_categories${eventQS}`)
      .then((r) => r.json())
      .then((data) => setStats(data.categories || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [live.config?.eventCode, live.config?.season]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-12 h-12 border-4 border-nhra-red border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const headsUp = stats.filter((s): s is HeadsUpStat => s.type === "headsup");
  const bracket = stats.filter((s): s is BracketStat => s.type === "bracket");

  // Chart data for heads-up
  const headsUpChartData = headsUp.map((s) => ({
    category: s.category,
    bestET: s.bestET,
    bestSpeed: s.bestSpeed,
    avgRT: s.avgRT,
    count: s.count,
  }));

  // Chart data for bracket
  const bracketChartData = bracket.map((s) => ({
    category: s.category,
    avgPackage: s.avgPackage,
    avgRT: s.avgRT,
    breakoutRate: s.breakoutRate !== null ? +(s.breakoutRate * 100).toFixed(1) : null,
    count: s.count,
    bestET: null,
    bestSpeed: null,
  }));

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Statistics</h1>
        <p className="text-gray-400">Performance analytics by category</p>
      </div>

      {stats.length === 0 ? (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-12 text-center text-gray-500">
          No data available. Import some runs first.
        </div>
      ) : (
        <>
          {/* ── HEADS-UP / PRO SECTION ── */}
          {headsUp.length > 0 && (
            <section className="mb-12">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-1 h-8 bg-nhra-red rounded-full" />
                <h2 className="text-2xl font-bold text-white">Performance Classes</h2>
                <span className="text-xs text-gray-500 bg-nhra-darker px-2 py-1 rounded-full">{headsUp.length} categories</span>
              </div>

              {/* Table */}
              <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden mb-6">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-nhra-border text-gray-400 text-xs uppercase tracking-wider">
                        <th className="text-left p-3 pl-5">Category</th>
                        <th className="text-right p-3">Runs</th>
                        <th className="text-right p-3">Best ET</th>
                        <th className="text-right p-3">Top Speed</th>
                        <th className="text-right p-3">Best 60ft</th>
                        <th className="text-right p-3">Best 330</th>
                        <th className="text-right p-3">Best 660</th>
                        <th className="text-right p-3">660 MPH</th>
                        <th className="text-right p-3">Best 1000</th>
                        <th className="text-right p-3">Best RT</th>
                        <th className="text-right p-3 pr-5">Avg RT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {headsUp.map((cat) => (
                        <tr key={cat.category} className="border-b border-nhra-border/50 hover:bg-nhra-border/20">
                          <td className="p-3 pl-5 text-white font-medium">{cat.category}</td>
                          <td className="p-3 text-right text-gray-300">{cat.count}</td>
                          <td className="p-3 text-right font-mono text-white font-semibold">{fmt(cat.bestET)}</td>
                          <td className="p-3 text-right font-mono text-white">{fmt(cat.bestSpeed, 2)}</td>
                          <td className="p-3 text-right font-mono text-gray-300">{fmt(cat.best60ft)}</td>
                          <td className="p-3 text-right font-mono text-gray-300">{fmt(cat.best330)}</td>
                          <td className="p-3 text-right font-mono text-gray-300">{fmt(cat.best660)}</td>
                          <td className="p-3 text-right font-mono text-gray-300">{fmt(cat.best660mph, 2)}</td>
                          <td className="p-3 text-right font-mono text-gray-300">{fmt(cat.best1000)}</td>
                          <td className="p-3 text-right font-mono text-green-400">{fmt(cat.bestRT)}</td>
                          <td className="p-3 text-right font-mono text-gray-400 pr-5">{fmt(cat.avgRT)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <ChartContainer title="Best ET by Category" height={300}>
                  <CategoryBarChart data={headsUpChartData} dataKey="bestET" label="Best ET (sec)" color="#C8102E" />
                </ChartContainer>
                <ChartContainer title="Top Speed by Category" height={300}>
                  <CategoryBarChart data={headsUpChartData} dataKey="bestSpeed" label="Top Speed (mph)" color="#22c55e" />
                </ChartContainer>
              </div>
            </section>
          )}

          {/* ── BRACKET / SPORTSMAN SECTION ── */}
          {bracket.length > 0 && (
            <section className="mb-12">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-1 h-8 bg-blue-500 rounded-full" />
                <h2 className="text-2xl font-bold text-white">Bracket / Sportsman Classes</h2>
                <span className="text-xs text-gray-500 bg-nhra-darker px-2 py-1 rounded-full">{bracket.length} categories</span>
              </div>

              {/* Table */}
              <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden mb-6">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-nhra-border text-gray-400 text-xs uppercase tracking-wider">
                        <th className="text-left p-3 pl-5">Category</th>
                        <th className="text-right p-3">Runs</th>
                        <th className="text-right p-3">Avg Pkg</th>
                        <th className="text-right p-3">Best Pkg</th>
                        <th className="text-right p-3">Avg RT</th>
                        <th className="text-right p-3">Best RT</th>
                        <th className="text-right p-3">Avg Dial Dev</th>
                        <th className="text-right p-3">ET Std Dev</th>
                        <th className="text-right p-3">Breakout %</th>
                        <th className="text-right p-3">W</th>
                        <th className="text-right p-3 pr-5">L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bracket.map((cat) => (
                        <tr key={cat.category} className="border-b border-nhra-border/50 hover:bg-nhra-border/20">
                          <td className="p-3 pl-5 text-white font-medium">{cat.category}</td>
                          <td className="p-3 text-right text-gray-300">{cat.count}</td>
                          <td className="p-3 text-right font-mono text-white font-semibold">{fmt(cat.avgPackage)}</td>
                          <td className="p-3 text-right font-mono text-green-400">{fmt(cat.bestPackage)}</td>
                          <td className="p-3 text-right font-mono text-gray-300">{fmt(cat.avgRT)}</td>
                          <td className="p-3 text-right font-mono text-green-400">{fmt(cat.bestRT)}</td>
                          <td className="p-3 text-right font-mono text-gray-300">{fmt(cat.avgDialDeviation)}</td>
                          <td className="p-3 text-right font-mono text-gray-400">{fmt(cat.etStdDev)}</td>
                          <td className={`p-3 text-right font-mono ${cat.breakoutRate !== null && cat.breakoutRate > 0.3 ? "text-red-400" : "text-gray-300"}`}>
                            {pct(cat.breakoutRate)}
                          </td>
                          <td className="p-3 text-right text-green-400">{cat.winCount}</td>
                          <td className="p-3 text-right text-red-400 pr-5">{cat.lossCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <ChartContainer title="Avg Package by Category" height={300}>
                  <CategoryBarChart data={bracketChartData} dataKey="avgPackage" label="Avg Package (sec)" color="#003DA5" />
                </ChartContainer>
                <ChartContainer title="Avg Reaction Time by Category" height={300}>
                  <CategoryBarChart data={bracketChartData} dataKey="avgRT" label="Avg RT (sec)" color="#8b5cf6" />
                </ChartContainer>
                <ChartContainer title="Breakout Rate by Category" height={300}>
                  <CategoryBarChart data={bracketChartData} dataKey="breakoutRate" label="Breakout %" color="#ef4444" />
                </ChartContainer>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
