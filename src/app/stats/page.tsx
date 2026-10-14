"use client";

import { useEffect, useState } from "react";
import { ChartContainer, HorizontalBarChart } from "@/components/Charts";
import { useLiveData } from "@/components/LiveDataProvider";
import { classifyCategory } from "@/lib/categories";
import PageHeader from "@/components/ui/PageHeader";
import EmptyState, { EmptyIcon, EMPTY_ICONS } from "@/components/ui/EmptyState";
import { Skeleton, SkeletonRows } from "@/components/ui/Skeleton";

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
  if (idx) return { label: `Index ${idx}`, cls: "bg-amber-500/10 text-amber-300 border-amber-500/25" };
  switch (f) {
    case "index": return { label: "Index", cls: "bg-amber-500/10 text-amber-300 border-amber-500/25" };
    case "handicap": return { label: "Handicap", cls: "bg-blue-500/10 text-blue-300 border-blue-500/25" };
    case "bracket": return { label: "Bracket", cls: "bg-purple-500/10 text-purple-300 border-purple-500/25" };
    default: return { label: "Dial-in", cls: "bg-gray-500/10 text-gray-300 border-gray-500/25" };
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
      <div className="max-w-7xl mx-auto" aria-busy="true">
        <span className="sr-only">Loading statistics...</span>
        <PageHeader title="Statistics" description="Performance broken down by what each class actually races for." />
        <Skeleton className="mb-2 h-5 w-48" />
        <Skeleton className="mb-5 h-3.5 w-full max-w-2xl" />
        <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden mb-4">
          <table className="data-table">
            <tbody>
              <SkeletonRows rows={4} columns={11} />
            </tbody>
          </table>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[0, 1].map((i) => (
            <div key={i} className="bg-nhra-card border border-nhra-border rounded-xl p-4 sm:p-5">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="mt-2 h-3 w-56" />
              <div className="mt-5 space-y-3">
                <Skeleton className="h-5 w-4/5" />
                <Skeleton className="h-5 w-3/5" />
                <Skeleton className="h-5 w-2/3" />
              </div>
            </div>
          ))}
        </div>
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
      <PageHeader title="Statistics" description="Performance broken down by what each class actually races for." />

      {stats.length === 0 ? (
        <EmptyState
          icon={<EmptyIcon d={EMPTY_ICONS.chart} />}
          title="No data available"
          description="Import some runs first — every class gets its own breakdown here."
        />
      ) : (
        <>
          {/* ── HEADS-UP / PRO ── */}
          {headsUp.length > 0 && (
            <section className="mb-10">
              <SectionHeader color="bg-nhra-red" title="Heads-Up / Pro" count={headsUp.length}
                blurb="Run flat-out, no dial-in — the quicker car wins. What matters: elapsed time (ET) and top speed, the 60-ft launch and the down-track incrementals (330/660/1000), plus reaction time off the pro tree." />

              <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden mb-4">
                <div className="overflow-x-auto">
                  <table className="data-table whitespace-nowrap">
                    <thead>
                      <tr>
                        <Th align="left">Class</Th><Th>Runs</Th>
                        <Th title="Quickest elapsed time (1320 ft)">Best ET</Th>
                        <Th title="Fastest trap speed">Top Speed</Th>
                        <Th title="Quickest launch — first 60 feet">Best 60ft</Th>
                        <Th>330</Th><Th>660</Th><Th title="Speed at half-track">660 MPH</Th><Th>1000</Th>
                        <Th title="Quickest reaction time">Best RT</Th><Th title="Average reaction time">Avg RT</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {headsUp.map((c) => (
                        <tr key={c.category}>
                          <td className="text-white font-medium">{c.category}</td>
                          <Td>{c.count}</Td>
                          <Td className="text-white font-semibold">{fmt(c.bestET)}</Td>
                          <Td className="text-white">{fmt(c.bestSpeed, 2)}</Td>
                          <Td>{fmt(c.best60ft)}</Td><Td>{fmt(c.best330)}</Td><Td>{fmt(c.best660)}</Td>
                          <Td>{fmt(c.best660mph, 2)}</Td><Td>{fmt(c.best1000)}</Td>
                          <Td className="text-green-400">{fmt(c.bestRT)}</Td>
                          <Td className="text-gray-400">{fmt(c.avgRT)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
            <section className="mb-10">
              <SectionHeader color="bg-blue-500" title="Bracket, Index & Super" count={bracket.length}
                blurb="These run to a number — your own dial-in (bracket / Top Dragster / Top Sportsman) or a fixed class index (Super Comp 8.90, Super Gas 9.90, Super Street 10.90). Running quicker than that number is a breakout (a loss). What matters: the package (reaction time + how close you ran to your number), reaction time, dial-in accuracy, ET consistency, and staying off the breakout." />

              <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden mb-4">
                <div className="overflow-x-auto">
                  <table className="data-table whitespace-nowrap">
                    <thead>
                      <tr>
                        <Th align="left">Class</Th><Th>Runs</Th>
                        <Th title="Reaction time + how far over the dial/index. Lower is a tighter race.">Avg Pkg</Th>
                        <Th title="Best (lowest) package run">Best Pkg</Th>
                        <Th>Avg RT</Th><Th>Best RT</Th>
                        <Th title="Average ET minus dial-in — how far off the number, on average">Avg Dial Dev</Th>
                        <Th title="ET standard deviation — lower means a more consistent car">ET Consistency</Th>
                        <Th title="Share of runs quicker than the dial/index (a breakout = loss)">Breakout %</Th>
                        <Th title="Win rate in eliminations">Win %</Th>
                        <Th>W</Th><Th>L</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {bracket.map((c) => {
                        const badge = formatBadge(c.category);
                        const games = c.winCount + c.lossCount;
                        const winRate = games > 0 ? c.winCount / games : null;
                        return (
                          <tr key={c.category}>
                            <td>
                              <div className="flex items-center gap-2">
                                <span className="text-white font-medium">{c.category}</span>
                                <span className={`rounded-full border px-1.5 py-0.5 text-[0.68rem] font-medium ${badge.cls}`}>{badge.label}</span>
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
                            <Td className="text-red-400">{c.lossCount}</Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
    <div className="mb-4">
      <div className="flex items-center gap-2.5 mb-1.5">
        <span className={`h-2 w-2 rounded-full ${color}`} />
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        <span className="chip">{count} {count === 1 ? "class" : "classes"}</span>
      </div>
      <p className="text-sm text-gray-400 leading-relaxed max-w-4xl">{blurb}</p>
    </div>
  );
}

function Th({ children, className = "", title, align = "right" }: { children: React.ReactNode; className?: string; title?: string; align?: "left" | "right" }) {
  return <th title={title} className={`${align === "left" ? "text-left" : "text-right"} ${title ? "cursor-help" : ""} ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`text-right font-mono text-gray-300 ${className}`}>{children}</td>;
}
