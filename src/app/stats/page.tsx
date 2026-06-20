"use client";

import { useEffect, useState } from "react";
import { ChartContainer, HorizontalBarChart } from "@/components/Charts";
import { useLiveData } from "@/components/LiveDataProvider";
import { classifyCategory } from "@/lib/categories";

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
  if (v === null || v === undefined) return "—";
  return v.toFixed(decimals);
}
function pct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return (v * 100).toFixed(1) + "%";
}

// The Super classes run a fixed index rather than a dial-in.
function superIndex(category: string): string | null {
  const c = category.toUpperCase();
  if (/\bSC\b|SUPER\s*COMP/.test(c)) return "8.90";
  if (/\bSG\b|SUPER\s*GAS/.test(c)) return "9.90";
  if (/\bSST\b|\bSS\b.*STREET|SUPER\s*STREET/.test(c)) return "10.90";
  return null;
}

function formatBadge(category: string): { label: string; cls: string } {
  const f = classifyCategory(category);
  const idx = superIndex(category);
  if (idx) return { label: `Index ${idx}`, cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" };
  switch (f) {
    case "index": return { label: "Index", cls: "bg-amber-500/15 text-amber-300 border-amber-500/30" };
    case "handicap": return { label: "Handicap", cls: "bg-blue-500/15 text-blue-300 border-blue-500/30" };
    case "bracket": return { label: "Bracket", cls: "bg-purple-500/15 text-purple-300 border-purple-500/30" };
    default: return { label: "Dial-in", cls: "bg-gray-500/15 text-gray-300 border-gray-500/30" };
  }
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
    fetch(`/api/stats?type=detailed_categories${eventQS}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => setStats(data.categories || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [live.config?.eventCode, live.config?.season, live.dataVersion]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-12 h-12 border-4 border-nhra-red border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const headsUp = stats.filter((s): s is HeadsUpStat => s.type === "headsup").sort((a, b) => (a.bestET ?? 1e9) - (b.bestET ?? 1e9));
  const bracket = stats.filter((s): s is BracketStat => s.type === "bracket").sort((a, b) => (a.avgPackage ?? 1e9) - (b.avgPackage ?? 1e9));

  const headsUpChartData = headsUp.map((s) => ({ category: s.category, bestET: s.bestET, bestSpeed: s.bestSpeed, best60ft: s.best60ft }));
  const bracketChartData = bracket.map((s) => ({
    category: s.category,
    avgPackage: s.avgPackage,
    avgRT: s.avgRT,
    breakoutRate: s.breakoutRate !== null ? +(s.breakoutRate * 100).toFixed(1) : null,
  }));

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-white mb-1 sm:mb-2">Statistics</h1>
        <p className="text-sm text-gray-400">Performance broken down by what each class actually races for.</p>
      </div>

      {stats.length === 0 ? (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-12 text-center text-gray-500">
          No data available. Import some runs first.
        </div>
      ) : (
        <>
          {/* ── HEADS-UP / PRO ── */}
          {headsUp.length > 0 && (
            <section className="mb-12">
              <SectionHeader color="bg-nhra-red" title="Heads-Up / Pro" count={headsUp.length}
                blurb="Run flat-out, no dial-in — the quicker car wins. What matters: elapsed time (ET) and top speed, the 60-ft launch and the down-track incrementals (330/660/1000), plus reaction time off the pro tree." />

              <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden mb-6">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm whitespace-nowrap">
                    <thead>
                      <tr className="border-b border-nhra-border text-gray-400 text-xs uppercase tracking-wider">
                        <Th className="text-left pl-5">Class</Th><Th>Runs</Th>
                        <Th title="Quickest elapsed time (1320 ft)">Best ET</Th>
                        <Th title="Fastest trap speed">Top Speed</Th>
                        <Th title="Quickest launch — first 60 feet">Best 60ft</Th>
                        <Th>330</Th><Th>660</Th><Th title="Speed at half-track">660 MPH</Th><Th>1000</Th>
                        <Th title="Quickest reaction time">Best RT</Th><Th title="Average reaction time" className="pr-5">Avg RT</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {headsUp.map((c) => (
                        <tr key={c.category} className="border-b border-nhra-border/50 hover:bg-nhra-border/20">
                          <td className="p-3 pl-5 text-white font-medium">{c.category}</td>
                          <Td>{c.count}</Td>
                          <Td className="text-white font-semibold">{fmt(c.bestET)}</Td>
                          <Td className="text-white">{fmt(c.bestSpeed, 2)}</Td>
                          <Td>{fmt(c.best60ft)}</Td><Td>{fmt(c.best330)}</Td><Td>{fmt(c.best660)}</Td>
                          <Td>{fmt(c.best660mph, 2)}</Td><Td>{fmt(c.best1000)}</Td>
                          <Td className="text-green-400">{fmt(c.bestRT)}</Td>
                          <Td className="text-gray-400 pr-5">{fmt(c.avgRT)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <ChartContainer title="Best ET" subtitle="Quickest run per class — lower is better (green = quickest)">
                  <HorizontalBarChart data={headsUpChartData} dataKey="bestET" color="#C8102E" unit="s" decimals={3} best="min" />
                </ChartContainer>
                <ChartContainer title="Top Speed" subtitle="Fastest trap speed per class — higher is better (green = fastest)">
                  <HorizontalBarChart data={headsUpChartData} dataKey="bestSpeed" color="#0ea5e9" unit=" mph" decimals={2} best="max" />
                </ChartContainer>
              </div>
            </section>
          )}

          {/* ── BRACKET / INDEX / SUPER ── */}
          {bracket.length > 0 && (
            <section className="mb-12">
              <SectionHeader color="bg-blue-500" title="Bracket, Index & Super" count={bracket.length}
                blurb="These run to a number — your own dial-in (bracket / Top Dragster / Top Sportsman) or a fixed class index (Super Comp 8.90, Super Gas 9.90, Super Street 10.90). Running quicker than that number is a breakout (a loss). What matters: the package (reaction time + how close you ran to your number), reaction time, dial-in accuracy, ET consistency, and staying off the breakout." />

              <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden mb-6">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm whitespace-nowrap">
                    <thead>
                      <tr className="border-b border-nhra-border text-gray-400 text-xs uppercase tracking-wider">
                        <Th className="text-left pl-5">Class</Th><Th>Runs</Th>
                        <Th title="Reaction time + how far over the dial/index. Lower is a tighter race.">Avg Pkg</Th>
                        <Th title="Best (lowest) package run">Best Pkg</Th>
                        <Th>Avg RT</Th><Th>Best RT</Th>
                        <Th title="Average ET minus dial-in — how far off the number, on average">Avg Dial Dev</Th>
                        <Th title="ET standard deviation — lower means a more consistent car">ET Consistency</Th>
                        <Th title="Share of runs quicker than the dial/index (a breakout = loss)">Breakout %</Th>
                        <Th title="Win rate in eliminations">Win %</Th>
                        <Th>W</Th><Th className="pr-5">L</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {bracket.map((c) => {
                        const badge = formatBadge(c.category);
                        const games = c.winCount + c.lossCount;
                        const winRate = games > 0 ? c.winCount / games : null;
                        return (
                          <tr key={c.category} className="border-b border-nhra-border/50 hover:bg-nhra-border/20">
                            <td className="p-3 pl-5">
                              <div className="flex items-center gap-2">
                                <span className="text-white font-medium">{c.category}</span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${badge.cls}`}>{badge.label}</span>
                              </div>
                            </td>
                            <Td>{c.count}</Td>
                            <Td className="text-white font-semibold">{fmt(c.avgPackage)}</Td>
                            <Td className="text-green-400">{fmt(c.bestPackage)}</Td>
                            <Td>{fmt(c.avgRT)}</Td>
                            <Td className="text-green-400">{fmt(c.bestRT)}</Td>
                            <Td>{fmt(c.avgDialDeviation)}</Td>
                            <Td className="text-gray-400">{fmt(c.etStdDev)}</Td>
                            <Td className={c.breakoutRate !== null && c.breakoutRate > 0.3 ? "text-red-400" : "text-gray-300"}>{pct(c.breakoutRate)}</Td>
                            <Td className={winRate !== null && winRate >= 0.5 ? "text-green-400" : "text-gray-300"}>{pct(winRate)}</Td>
                            <Td className="text-green-400">{c.winCount}</Td>
                            <Td className="text-red-400 pr-5">{c.lossCount}</Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <ChartContainer title="Avg Package" subtitle="Reaction + closeness to the number — lower is better (green = best)">
                  <HorizontalBarChart data={bracketChartData} dataKey="avgPackage" color="#003DA5" unit="s" decimals={3} best="min" />
                </ChartContainer>
                <ChartContainer title="Avg Reaction Time" subtitle="Lower is quicker on the tree (green = best)">
                  <HorizontalBarChart data={bracketChartData} dataKey="avgRT" color="#8b5cf6" unit="s" decimals={3} best="min" />
                </ChartContainer>
                <ChartContainer title="Breakout Rate" subtitle="Share of runs under the dial/index — lower is better (green = best)">
                  <HorizontalBarChart data={bracketChartData} dataKey="breakoutRate" color="#ef4444" unit="%" decimals={1} best="min" />
                </ChartContainer>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function SectionHeader({ color, title, count, blurb }: { color: string; title: string; count: number; blurb: string }) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-3 mb-2">
        <div className={`w-1 h-7 ${color} rounded-full`} />
        <h2 className="text-xl sm:text-2xl font-bold text-white">{title}</h2>
        <span className="text-xs text-gray-500 bg-nhra-darker px-2 py-1 rounded-full">{count} {count === 1 ? "class" : "classes"}</span>
      </div>
      <p className="text-sm text-gray-400 leading-relaxed max-w-4xl">{blurb}</p>
    </div>
  );
}

function Th({ children, className = "", title }: { children: React.ReactNode; className?: string; title?: string }) {
  return <th title={title} className={`p-3 text-right font-medium ${title ? "cursor-help" : ""} ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`p-3 text-right font-mono text-gray-300 ${className}`}>{children}</td>;
}
