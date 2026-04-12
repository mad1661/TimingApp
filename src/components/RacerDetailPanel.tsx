"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
  ft330: number | null;
  ft660: number | null;
  mph_660: number | null;
  ft1000: number | null;
  mph_1000: number | null;
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

interface Props {
  name: string;
  compact?: boolean;
  onRacerClick?: (name: string) => void;
  initialCategory?: string;
}

export default function RacerDetailPanel({ name, compact = false, onRacerClick, initialCategory }: Props) {
  const live = useLiveData();
  const [allRuns, setAllRuns] = useState<RunRow[]>([]);
  const [techCards, setTechCards] = useState<TechCard[]>([]);
  const [allCrossEventRuns, setAllCrossEventRuns] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [otherEventsOpen, setOtherEventsOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(initialCategory || null);
  const [filterInitialized, setFilterInitialized] = useState(false);

  useEffect(() => {
    setLoading(true);
    const ec = live.config?.eventCode;
    const s = live.config?.season;

    const fetchRuns = ec && s
      ? fetch(`/api/stats?type=racer&name=${encodeURIComponent(name)}&event_code=${encodeURIComponent(ec)}&season=${encodeURIComponent(s)}`)
          .then((r) => r.json())
          .then((data) => setAllRuns(data.runs || []))
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

    const fetchCrossEvent = fetch(
      `/api/stats?type=racer-all-events&name=${encodeURIComponent(name)}${ec ? `&exclude_event_code=${encodeURIComponent(ec)}` : ""}${s ? `&exclude_season=${encodeURIComponent(s)}` : ""}`
    )
      .then((r) => r.json())
      .then((data) => setAllCrossEventRuns(data.runs || []))
      .catch(console.error);

    Promise.all([fetchRuns, fetchTechCards, fetchCrossEvent]).finally(() => setLoading(false));
  }, [name, live.config?.eventCode, live.config?.season]);

  // All categories this racer has competed in (current event + cross-event)
  const allCategories = [...new Set([...allRuns, ...allCrossEventRuns].map(r => r.category).filter(Boolean) as string[])].sort();

  // Auto-set default filter category to the primary (most recent or most-run) category
  // in the current event, but only once after loading.
  useEffect(() => {
    if (loading || filterInitialized) return;
    if (initialCategory) {
      setCategoryFilter(initialCategory);
    } else if (allRuns.length > 0) {
      // Most common category in current event runs
      const counts = new Map<string, number>();
      for (const r of allRuns) {
        if (r.category) counts.set(r.category, (counts.get(r.category) || 0) + 1);
      }
      let best: string | null = null;
      let bestCount = 0;
      for (const [cat, n] of counts) {
        if (n > bestCount) { best = cat; bestCount = n; }
      }
      setCategoryFilter(best);
    }
    setFilterInitialized(true);
  }, [loading, filterInitialized, initialCategory, allRuns]);

  // Apply the category filter
  const runs = categoryFilter ? allRuns.filter(r => r.category === categoryFilter) : allRuns;
  const crossEventRuns = categoryFilter ? allCrossEventRuns.filter(r => r.category === categoryFilter) : allCrossEventRuns;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-10 h-10 border-4 border-nhra-red border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const validETs = runs.filter((r) => r.ft1320 && r.ft1320 > 0);
  const validRTs = runs.filter((r) => r.rt && r.rt > 0);
  const elimRuns = runs.filter((r) => r.round && /^[ERCF]/i.test(r.round));
  const wins = elimRuns.filter((r) => r.is_winner);
  const categories = [...new Set(runs.map((r) => r.category).filter(Boolean))];
  const seasons = [...new Set(runs.map((r) => r.season).filter(Boolean))].sort().reverse();

  // Season averages: combine current event + cross-event runs for the active season
  const activeSeason = live.config?.season || "";
  const seasonRuns = activeSeason
    ? [...runs, ...crossEventRuns].filter((r) => r.season === activeSeason)
    : [];
  const seasonValidETs = seasonRuns.filter((r) => r.ft1320 && r.ft1320 > 0);
  const seasonValidRTs = seasonRuns.filter((r) => r.rt && r.rt > 0);
  const seasonValid60 = seasonRuns.filter((r) => r.ft60 && r.ft60 > 0);
  const seasonValidSpeeds = seasonRuns.filter((r) => r.mph_1320 && r.mph_1320 > 0);
  const seasonElimRuns = seasonRuns.filter((r) => r.round && /^[ERCF]/i.test(r.round));
  const seasonWins = seasonElimRuns.filter((r) => r.is_winner);
  const seasonBestET = seasonValidETs.length > 0 ? Math.min(...seasonValidETs.map((r) => r.ft1320!)) : null;
  const seasonAvgET = seasonValidETs.length > 0 ? seasonValidETs.reduce((s, r) => s + r.ft1320!, 0) / seasonValidETs.length : null;
  const seasonBestRT = seasonValidRTs.length > 0 ? Math.min(...seasonValidRTs.map((r) => r.rt!)) : null;
  const seasonAvgRT = seasonValidRTs.length > 0 ? seasonValidRTs.reduce((s, r) => s + r.rt!, 0) / seasonValidRTs.length : null;
  const seasonAvg60 = seasonValid60.length > 0 ? seasonValid60.reduce((s, r) => s + r.ft60!, 0) / seasonValid60.length : null;
  const seasonAvgSpeed = seasonValidSpeeds.length > 0 ? seasonValidSpeeds.reduce((s, r) => s + r.mph_1320!, 0) / seasonValidSpeeds.length : null;
  const seasonBestSpeed = seasonValidSpeeds.length > 0 ? Math.max(...seasonValidSpeeds.map((r) => r.mph_1320!)) : null;
  const seasonEtStdDev = seasonValidETs.length > 1 && seasonAvgET
    ? Math.sqrt(seasonValidETs.reduce((sum, r) => sum + Math.pow(r.ft1320! - seasonAvgET, 2), 0) / (seasonValidETs.length - 1))
    : null;
  const seasonEventCount = new Set(seasonRuns.map((r) => `${r.event_name || ""}|${r.season || ""}`)).size;

  const bestET = validETs.length > 0 ? Math.min(...validETs.map((r) => r.ft1320!)) : null;
  const avgET = validETs.length > 0 ? validETs.reduce((s, r) => s + r.ft1320!, 0) / validETs.length : null;
  const bestRT = validRTs.length > 0 ? Math.min(...validRTs.map((r) => r.rt!)) : null;
  const avgRT = validRTs.length > 0 ? validRTs.reduce((s, r) => s + r.rt!, 0) / validRTs.length : null;
  const bestSpeed = runs.filter((r) => r.mph_1320 && r.mph_1320 > 0).length > 0
    ? Math.max(...runs.filter((r) => r.mph_1320! > 0).map((r) => r.mph_1320!)) : null;

  const etStdDev = validETs.length > 1 && avgET
    ? Math.sqrt(validETs.reduce((sum, r) => sum + Math.pow(r.ft1320! - avgET, 2), 0) / (validETs.length - 1))
    : null;

  const dialRuns = runs.filter((r) => r.ft1320 && r.ft1320 > 0 && r.dial_in && r.dial_in > 0);
  const avgDialDiff = dialRuns.length > 0
    ? dialRuns.reduce((s, r) => s + Math.abs(r.ft1320! - r.dial_in!), 0) / dialRuns.length
    : null;
  const breakoutCount = dialRuns.filter((r) => r.ft1320! < r.dial_in!).length;

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

  const primaryCategory = categories[0] || "";
  const raceFormat: RaceFormat = classifyCategory(primaryCategory);

  const sortedRuns = [...runs].sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));
  const runDeltas = sortedRuns.map((run, i) => {
    if (i === 0 || !run.ft1320 || run.ft1320 <= 0) return { run, etDelta: null };
    const prev = sortedRuns[i - 1];
    const etDelta = prev.ft1320 && prev.ft1320 > 0 ? run.ft1320 - prev.ft1320 : null;
    return { run, etDelta };
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        {onRacerClick ? (
          <button onClick={() => onRacerClick(name)} className="text-2xl font-bold text-white hover:text-nhra-accent transition-colors text-left">
            {name}
          </button>
        ) : (
          <Link href={`/racer/${encodeURIComponent(name)}`} className="text-2xl font-bold text-white hover:text-nhra-accent transition-colors">
            {name}
          </Link>
        )}
        <p className="text-sm text-gray-400">
          {runs.length} runs{seasons.length > 0 && ` | ${seasons.join(", ")}`}
          {categoryFilter && ` | ${categoryFilter}`}
        </p>
      </div>

      {/* Category filter — shows only if racer has multiple classes */}
      {allCategories.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500 uppercase tracking-wider">Class:</span>
          <button
            onClick={() => setCategoryFilter(null)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors border ${
              categoryFilter === null
                ? "bg-nhra-red/20 border-nhra-red/50 text-nhra-red"
                : "bg-nhra-darker border-nhra-border text-gray-400 hover:text-white"
            }`}
          >
            All ({allCategories.length})
          </button>
          {allCategories.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors border ${
                categoryFilter === cat
                  ? "bg-nhra-red/20 border-nhra-red/50 text-nhra-red"
                  : "bg-nhra-darker border-nhra-border text-gray-400 hover:text-white"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Tech Card */}
      {techCards.length > 0 && (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-semibold text-white">Tech Card</span>
            <span className="text-nhra-accent font-bold text-xs">#{techCards[0].car_number}</span>
            <span className="text-gray-400 text-xs">{techCards[0].category}</span>
            {techCards[0].member_number && (
              <span className="ml-auto text-xs text-gray-500">#{techCards[0].member_number}</span>
            )}
          </div>
          <div className={`grid ${compact ? "grid-cols-2" : "grid-cols-2 md:grid-cols-3"} gap-3 text-xs`}>
            {(techCards[0].city || techCards[0].state) && (
              <div><p className="text-gray-500 uppercase">Location</p><p className="text-gray-300">{[techCards[0].city, techCards[0].state].filter(Boolean).join(", ")}</p></div>
            )}
            {techCards[0].engine_make && (
              <div><p className="text-gray-500 uppercase">Engine</p><p className="text-gray-300">{techCards[0].engine_make}</p></div>
            )}
            {techCards[0].body_type && (
              <div><p className="text-gray-500 uppercase">Body</p><p className="text-gray-300">{techCards[0].body_type}</p></div>
            )}
            {techCards[0].hp && (
              <div><p className="text-gray-500 uppercase">HP</p><p className="text-gray-300">{techCards[0].hp}</p></div>
            )}
            {techCards[0].owner && (
              <div><p className="text-gray-500 uppercase">Owner</p><p className="text-gray-300">{techCards[0].owner}</p></div>
            )}
            {techCards[0].crew_chief && (
              <div><p className="text-gray-500 uppercase">Crew Chief</p><p className="text-gray-300">{techCards[0].crew_chief}</p></div>
            )}
          </div>
        </div>
      )}

      {runs.length === 0 && techCards.length === 0 && (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-8 text-center text-gray-500">
          No runs found for this racer.
        </div>
      )}

      {runs.length > 0 && (
        <>
          {/* Stats */}
          <div className={`grid ${compact ? "grid-cols-2" : "grid-cols-2 md:grid-cols-4"} gap-3`}>
            <div className="bg-nhra-card border border-nhra-border rounded-lg p-3">
              <p className="text-xs text-gray-400 uppercase">Runs</p>
              <p className="text-xl font-bold text-white">{runs.length}</p>
            </div>
            <div className="bg-nhra-card border border-nhra-border rounded-lg p-3">
              <p className="text-xs text-gray-400 uppercase">Wins</p>
              <p className="text-xl font-bold text-white">{wins.length} <span className="text-sm text-gray-500">({elimRuns.length > 0 ? ((wins.length / elimRuns.length) * 100).toFixed(0) : 0}%)</span></p>
            </div>
            <div className="bg-nhra-card border border-nhra-border rounded-lg p-3">
              <p className="text-xs text-gray-400 uppercase">Best ET</p>
              <p className="text-xl font-bold text-white font-mono">{bestET?.toFixed(3) ?? "-"}</p>
            </div>
            <div className="bg-nhra-card border border-nhra-border rounded-lg p-3">
              <p className="text-xs text-gray-400 uppercase">Best RT</p>
              <p className="text-xl font-bold text-white font-mono">{bestRT?.toFixed(3) ?? "-"}</p>
            </div>
            <div className="bg-nhra-card border border-nhra-border rounded-lg p-3">
              <p className="text-xs text-gray-400 uppercase">Avg ET</p>
              <p className="text-xl font-bold text-white font-mono">{avgET?.toFixed(3) ?? "-"}</p>
            </div>
            <div className="bg-nhra-card border border-nhra-border rounded-lg p-3">
              <p className="text-xs text-gray-400 uppercase">Avg RT</p>
              <p className="text-xl font-bold text-white font-mono">{avgRT?.toFixed(3) ?? "-"}</p>
            </div>
            <div className="bg-nhra-card border border-nhra-border rounded-lg p-3">
              <p className="text-xs text-gray-400 uppercase">Consistency</p>
              <p className="text-xl font-bold text-white font-mono">{etStdDev ? `\u00b1${etStdDev.toFixed(3)}` : "-"}</p>
            </div>
            <div className="bg-nhra-card border border-nhra-border rounded-lg p-3">
              <p className="text-xs text-gray-400 uppercase">Top Speed</p>
              <p className="text-xl font-bold text-white font-mono">{bestSpeed?.toFixed(2) ?? "-"}</p>
            </div>
          </div>

          {/* What They Normally Run */}
          <div className="bg-nhra-card border border-nhra-border rounded-xl p-4">
            <h3 className="text-sm font-semibold text-white mb-3">What They Normally Run</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-nhra-darker rounded-lg p-3">
                <p className="text-xs text-gray-500 uppercase">Typical ET</p>
                <p className="text-xl font-black text-white font-mono">{medianET?.toFixed(3) ?? "-"}</p>
              </div>
              <div className="bg-nhra-darker rounded-lg p-3">
                <p className="text-xs text-gray-500 uppercase">Typical 60&apos;</p>
                <p className="text-xl font-black text-white font-mono">{median60?.toFixed(3) ?? "-"}</p>
              </div>
              <div className="bg-nhra-darker rounded-lg p-3">
                <p className="text-xs text-gray-500 uppercase">Typical Speed</p>
                <p className="text-xl font-black text-white font-mono">{avgSpeed?.toFixed(2) ?? "-"}</p>
              </div>
              <div className="bg-nhra-darker rounded-lg p-3">
                <p className="text-xs text-gray-500 uppercase">Typical RT</p>
                <p className="text-xl font-black text-white font-mono">{avgRT?.toFixed(3) ?? "-"}</p>
              </div>
            </div>
            {etStdDev != null && medianET != null && (
              <p className="mt-2 text-xs text-gray-500">ET range: <span className="font-mono text-gray-400">{(medianET - etStdDev).toFixed(3)} &mdash; {(medianET + etStdDev).toFixed(3)}</span></p>
            )}
          </div>

          {/* Season Averages — combines all events in the active season */}
          {activeSeason && seasonRuns.length > runs.length && (
            <div className="bg-nhra-card border border-nhra-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-white">{activeSeason} Season Averages</h3>
                <span className="text-xs text-gray-500">{seasonRuns.length} runs | {seasonEventCount} events</span>
              </div>
              <div className={`grid ${compact ? "grid-cols-2" : "grid-cols-2 md:grid-cols-4"} gap-3`}>
                <div className="bg-nhra-darker rounded-lg p-3">
                  <p className="text-xs text-gray-500 uppercase">Avg ET</p>
                  <p className="text-lg font-bold text-white font-mono">{seasonAvgET?.toFixed(3) ?? "-"}</p>
                  <p className="text-[10px] text-gray-600">best {seasonBestET?.toFixed(3) ?? "-"}</p>
                </div>
                <div className="bg-nhra-darker rounded-lg p-3">
                  <p className="text-xs text-gray-500 uppercase">Avg RT</p>
                  <p className="text-lg font-bold text-white font-mono">{seasonAvgRT?.toFixed(3) ?? "-"}</p>
                  <p className="text-[10px] text-gray-600">best {seasonBestRT?.toFixed(3) ?? "-"}</p>
                </div>
                <div className="bg-nhra-darker rounded-lg p-3">
                  <p className="text-xs text-gray-500 uppercase">Avg 60&apos;</p>
                  <p className="text-lg font-bold text-white font-mono">{seasonAvg60?.toFixed(3) ?? "-"}</p>
                </div>
                <div className="bg-nhra-darker rounded-lg p-3">
                  <p className="text-xs text-gray-500 uppercase">Avg MPH</p>
                  <p className="text-lg font-bold text-white font-mono">{seasonAvgSpeed?.toFixed(2) ?? "-"}</p>
                  <p className="text-[10px] text-gray-600">top {seasonBestSpeed?.toFixed(2) ?? "-"}</p>
                </div>
                <div className="bg-nhra-darker rounded-lg p-3">
                  <p className="text-xs text-gray-500 uppercase">Wins</p>
                  <p className="text-lg font-bold text-white">{seasonWins.length} <span className="text-xs text-gray-500">({seasonElimRuns.length > 0 ? ((seasonWins.length / seasonElimRuns.length) * 100).toFixed(0) : 0}%)</span></p>
                </div>
                <div className="bg-nhra-darker rounded-lg p-3">
                  <p className="text-xs text-gray-500 uppercase">Elim Runs</p>
                  <p className="text-lg font-bold text-white">{seasonElimRuns.length}</p>
                </div>
                <div className="bg-nhra-darker rounded-lg p-3">
                  <p className="text-xs text-gray-500 uppercase">Consistency</p>
                  <p className="text-lg font-bold text-white font-mono">{seasonEtStdDev ? `\u00b1${seasonEtStdDev.toFixed(3)}` : "-"}</p>
                </div>
                <div className="bg-nhra-darker rounded-lg p-3">
                  <p className="text-xs text-gray-500 uppercase">Total Runs</p>
                  <p className="text-lg font-bold text-white">{seasonRuns.length}</p>
                </div>
              </div>
            </div>
          )}

          {/* Dial-In Accuracy */}
          {dialRuns.length > 0 && (
            <div className="bg-nhra-card border border-nhra-border rounded-xl p-4">
              <h3 className="text-sm font-semibold text-white mb-3">Dial-In Accuracy</h3>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-xs text-gray-500">Avg Diff</p>
                  <p className="text-lg font-bold text-white font-mono">{avgDialDiff?.toFixed(4) ?? "-"}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Breakouts</p>
                  <p className="text-lg font-bold text-red-400 font-mono">{breakoutCount}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Dial Runs</p>
                  <p className="text-lg font-bold text-gray-300 font-mono">{dialRuns.length}</p>
                </div>
              </div>
            </div>
          )}

          {/* Charts */}
          {etTrend.length > 2 && (
            <ChartContainer title="ET Trend" height={200}>
              <PerformanceLineChart data={etTrend} color="#C8102E" yLabel="ET (sec)" />
            </ChartContainer>
          )}
          {rtTrend.length > 2 && (
            <ChartContainer title="RT Trend" height={200}>
              <PerformanceLineChart data={rtTrend} color="#22c55e" yLabel="RT (sec)" />
            </ChartContainer>
          )}

          {/* Head-to-Head */}
          {h2hRecords.length > 0 && (
            <div className="bg-nhra-card border border-nhra-border rounded-xl p-4">
              <h3 className="text-sm font-semibold text-white mb-3">Head-to-Head</h3>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {h2hRecords.slice(0, 10).map((rec) => {
                  const winPct = (rec.wins / rec.total) * 100;
                  return (
                    <div key={rec.oppName} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-nhra-border/20">
                      <button onClick={() => onRacerClick?.(rec.oppName)} className="text-white hover:text-nhra-accent text-xs font-medium truncate max-w-[120px] text-left">
                        {rec.oppName}
                      </button>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono"><span className="text-green-400">{rec.wins}W</span>-<span className="text-red-400">{rec.losses}L</span></span>
                        <div className="w-16 h-1.5 bg-red-500/30 rounded-full overflow-hidden">
                          <div className="h-full bg-green-500 rounded-full" style={{ width: `${winPct}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Run History */}
          <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden">
            <div className="p-4 border-b border-nhra-border">
              <h3 className="text-sm font-semibold text-white">Run History</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-nhra-border text-gray-400 uppercase tracking-wider">
                    <th className="text-left p-2 pl-4">Rnd</th>
                    <th className="text-right p-2">RT</th>
                    <th className="text-right p-2">60&apos;</th>
                    <th className="text-right p-2">330&apos;</th>
                    <th className="text-right p-2">660&apos;</th>
                    <th className="text-right p-2">660 MPH</th>
                    <th className="text-right p-2">1000&apos;</th>
                    <th className="text-right p-2">1320&apos;</th>
                    <th className="text-right p-2">MPH</th>
                    <th className="text-right p-2">Dial</th>
                    <th className="text-center p-2">W/L</th>
                    <th className="text-left p-2 pr-4">Opp</th>
                  </tr>
                </thead>
                <tbody>
                  {runDeltas.map(({ run, etDelta }, i) => (
                    <tr key={i} className="border-b border-nhra-border/30 hover:bg-nhra-border/20">
                      <td className="p-2 pl-4 text-gray-300 whitespace-nowrap">{run.round}</td>
                      <td className="p-2 text-right font-mono text-gray-300">{run.rt?.toFixed(3) ?? "-"}</td>
                      <td className="p-2 text-right font-mono text-gray-300">{run.ft60?.toFixed(3) ?? "-"}</td>
                      <td className="p-2 text-right font-mono text-gray-300">{run.ft330?.toFixed(3) ?? "-"}</td>
                      <td className="p-2 text-right font-mono text-gray-300">{run.ft660?.toFixed(3) ?? "-"}</td>
                      <td className="p-2 text-right font-mono text-gray-400">{run.mph_660?.toFixed(2) ?? "-"}</td>
                      <td className="p-2 text-right font-mono text-gray-300">{run.ft1000?.toFixed(3) ?? "-"}</td>
                      <td className="p-2 text-right font-mono text-white font-medium">{run.ft1320?.toFixed(3) ?? "-"}</td>
                      <td className="p-2 text-right font-mono text-gray-300">{run.mph_1320?.toFixed(2) ?? "-"}</td>
                      <td className="p-2 text-right font-mono text-gray-400">{run.dial_in?.toFixed(2) ?? "-"}</td>
                      <td className="p-2 text-center">
                        {run.is_winner ? <span className="text-green-400 font-bold">W</span> : <span className="text-gray-600">L</span>}
                      </td>
                      <td className="p-2 pr-4 truncate max-w-[100px]">
                        {run.opponents?.[0]?.name ? (
                          <button onClick={() => onRacerClick?.(run.opponents![0].name!)} className="text-gray-400 hover:text-nhra-accent text-left truncate">
                            {run.opponents[0].name}
                          </button>
                        ) : (
                          <span className="text-gray-600">BYE</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Other Events (cross-event lookup) */}
      {crossEventRuns.length > 0 && (() => {
        const groupedByEvent = new Map<string, RunRow[]>();
        for (const r of crossEventRuns) {
          const key = r.event_name || r.season || "Unknown Event";
          const arr = groupedByEvent.get(key) || [];
          arr.push(r);
          groupedByEvent.set(key, arr);
        }

        return (
          <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden">
            <button
              onClick={() => setOtherEventsOpen(!otherEventsOpen)}
              className="w-full p-4 flex items-center justify-between hover:bg-nhra-border/20 transition-colors"
            >
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-white">Other Events</h3>
                <span className="text-xs text-gray-500">{crossEventRuns.length} runs across {groupedByEvent.size} events</span>
              </div>
              <span className="text-gray-400 text-xs">{otherEventsOpen ? "\u25B2" : "\u25BC"}</span>
            </button>
            {otherEventsOpen && (
              <div className="border-t border-nhra-border">
                {Array.from(groupedByEvent.entries()).map(([eventName, evRuns]) => {
                  const evValidETs = evRuns.filter((r) => r.ft1320 && r.ft1320 > 0);
                  const evValidRTs = evRuns.filter((r) => r.rt && r.rt > 0);
                  const evElimRuns = evRuns.filter((r) => r.round && /^[ERCF]/i.test(r.round));
                  const evWins = evElimRuns.filter((r) => r.is_winner);
                  const evBestET = evValidETs.length > 0 ? Math.min(...evValidETs.map((r) => r.ft1320!)) : null;
                  const evBestRT = evValidRTs.length > 0 ? Math.min(...evValidRTs.map((r) => r.rt!)) : null;

                  return (
                    <div key={eventName} className="border-b border-nhra-border/30 last:border-b-0">
                      <div className="p-4">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-sm font-semibold text-white">{eventName}</h4>
                          <span className="text-xs text-gray-500">{evRuns[0]?.season}</span>
                        </div>
                        <div className={`grid ${compact ? "grid-cols-2" : "grid-cols-2 md:grid-cols-4"} gap-2 mb-3`}>
                          <div className="bg-nhra-darker rounded-lg p-2">
                            <p className="text-[10px] text-gray-500 uppercase">Runs</p>
                            <p className="text-sm font-bold text-white">{evRuns.length}</p>
                          </div>
                          <div className="bg-nhra-darker rounded-lg p-2">
                            <p className="text-[10px] text-gray-500 uppercase">Best ET</p>
                            <p className="text-sm font-bold text-white font-mono">{evBestET?.toFixed(3) ?? "-"}</p>
                          </div>
                          <div className="bg-nhra-darker rounded-lg p-2">
                            <p className="text-[10px] text-gray-500 uppercase">Best RT</p>
                            <p className="text-sm font-bold text-white font-mono">{evBestRT?.toFixed(3) ?? "-"}</p>
                          </div>
                          <div className="bg-nhra-darker rounded-lg p-2">
                            <p className="text-[10px] text-gray-500 uppercase">Wins</p>
                            <p className="text-sm font-bold text-white">{evWins.length}</p>
                          </div>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-nhra-border text-gray-400 uppercase tracking-wider">
                                <th className="text-left p-1.5 pl-2">Rnd</th>
                                <th className="text-right p-1.5">RT</th>
                                <th className="text-right p-1.5">60&apos;</th>
                                <th className="text-right p-1.5">330&apos;</th>
                                <th className="text-right p-1.5">660&apos;</th>
                                <th className="text-right p-1.5">660 MPH</th>
                                <th className="text-right p-1.5">1000&apos;</th>
                                <th className="text-right p-1.5">1320&apos;</th>
                                <th className="text-right p-1.5">MPH</th>
                                <th className="text-center p-1.5">W/L</th>
                              </tr>
                            </thead>
                            <tbody>
                              {evRuns.map((run, i) => (
                                <tr key={i} className="border-b border-nhra-border/20 hover:bg-nhra-border/20">
                                  <td className="p-1.5 pl-2 text-gray-300 whitespace-nowrap">{run.round}</td>
                                  <td className="p-1.5 text-right font-mono text-gray-300">{run.rt?.toFixed(3) ?? "-"}</td>
                                  <td className="p-1.5 text-right font-mono text-gray-300">{run.ft60?.toFixed(3) ?? "-"}</td>
                                  <td className="p-1.5 text-right font-mono text-gray-300">{run.ft330?.toFixed(3) ?? "-"}</td>
                                  <td className="p-1.5 text-right font-mono text-gray-300">{run.ft660?.toFixed(3) ?? "-"}</td>
                                  <td className="p-1.5 text-right font-mono text-gray-400">{run.mph_660?.toFixed(2) ?? "-"}</td>
                                  <td className="p-1.5 text-right font-mono text-gray-300">{run.ft1000?.toFixed(3) ?? "-"}</td>
                                  <td className="p-1.5 text-right font-mono text-white font-medium">{run.ft1320?.toFixed(3) ?? "-"}</td>
                                  <td className="p-1.5 text-right font-mono text-gray-300">{run.mph_1320?.toFixed(2) ?? "-"}</td>
                                  <td className="p-1.5 text-center">
                                    {run.is_winner ? <span className="text-green-400 font-bold">W</span> : <span className="text-gray-600">L</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
