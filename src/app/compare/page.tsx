"use client";

import { useEffect, useState } from "react";
import { ChartContainer, MultiLineChart } from "@/components/Charts";

interface RunRow {
  timestamp: string | null;
  rt: number | null;
  ft1320: number | null;
  mph_1320: number | null;
  is_winner: number;
  category: string | null;
  round: string | null;
}

interface RacerData {
  name: string;
  runs: RunRow[];
}

const COLORS = ["#C8102E", "#003DA5", "#22c55e", "#eab308", "#f97316"];

export default function ComparePage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedRacers, setSelectedRacers] = useState<string[]>([]);
  const [racerData, setRacerData] = useState<RacerData[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (searchTerm.length < 2) { setSuggestions([]); return; }
    const timer = setTimeout(() => {
      fetch(`/api/stats?type=racers&search=${encodeURIComponent(searchTerm)}`)
        .then((r) => r.json())
        .then((data) => setSuggestions((data.racers || []).filter((n: string) => !selectedRacers.includes(n))))
        .catch(console.error);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm, selectedRacers]);

  async function addRacer(name: string) {
    if (selectedRacers.includes(name)) return;
    setSelectedRacers([...selectedRacers, name]);
    setSearchTerm("");
    setSuggestions([]);
    setLoading(true);

    try {
      const res = await fetch(`/api/stats?type=racer&name=${encodeURIComponent(name)}`);
      const data = await res.json();
      setRacerData((prev) => [...prev, { name, runs: data.runs || [] }]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function removeRacer(name: string) {
    setSelectedRacers(selectedRacers.filter((n) => n !== name));
    setRacerData(racerData.filter((d) => d.name !== name));
  }

  function getStats(runs: RunRow[]) {
    const validETs = runs.filter((r) => r.ft1320 && r.ft1320 > 0);
    const validRTs = runs.filter((r) => r.rt && r.rt > 0);
    const wins = runs.filter((r) => r.is_winner);
    return {
      totalRuns: runs.length,
      wins: wins.length,
      winPct: runs.length > 0 ? ((wins.length / runs.length) * 100).toFixed(1) : "0",
      bestET: validETs.length > 0 ? Math.min(...validETs.map((r) => r.ft1320!)).toFixed(3) : "-",
      avgET: validETs.length > 0 ? (validETs.reduce((s, r) => s + r.ft1320!, 0) / validETs.length).toFixed(3) : "-",
      bestRT: validRTs.length > 0 ? Math.min(...validRTs.map((r) => r.rt!)).toFixed(3) : "-",
      avgRT: validRTs.length > 0 ? (validRTs.reduce((s, r) => s + r.rt!, 0) / validRTs.length).toFixed(3) : "-",
      topSpeed: runs.filter((r) => r.mph_1320 && r.mph_1320 > 0).length > 0
        ? Math.max(...runs.filter((r) => r.mph_1320! > 0).map((r) => r.mph_1320!)).toFixed(2) : "-",
    };
  }

  const etChartData: { label: string; [key: string]: string | number | null }[] = [];
  if (racerData.length > 0) {
    const maxLen = Math.max(...racerData.map((d) => d.runs.filter((r) => r.ft1320 && r.ft1320 > 0).length));
    for (let i = 0; i < Math.min(maxLen, 50); i++) {
      const point: { label: string; [key: string]: string | number | null } = { label: `#${i + 1}` };
      racerData.forEach((rd) => {
        const validRuns = rd.runs.filter((r) => r.ft1320 && r.ft1320 > 0).sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));
        point[rd.name] = validRuns[i]?.ft1320 ?? null;
      });
      etChartData.push(point);
    }
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Compare Racers</h1>
        <p className="text-gray-400">Side-by-side performance comparison</p>
      </div>

      {/* Racer Selector */}
      <div className="bg-nhra-card border border-nhra-border rounded-xl p-5 mb-6">
        <div className="relative max-w-md mb-4">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search and add racers..."
            className="w-full px-4 py-2.5 bg-nhra-darker border border-nhra-border rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-nhra-accent"
          />
          {suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-nhra-dark border border-nhra-border rounded-lg shadow-xl z-10 max-h-60 overflow-y-auto">
              {suggestions.map((name) => (
                <button key={name} onClick={() => addRacer(name)} className="w-full text-left px-4 py-2.5 text-sm text-gray-300 hover:bg-nhra-card hover:text-white transition-colors">
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedRacers.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {selectedRacers.map((name, i) => (
              <div key={name} className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium text-white" style={{ backgroundColor: `${COLORS[i % COLORS.length]}30`, border: `1px solid ${COLORS[i % COLORS.length]}50` }}>
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                {name}
                <button onClick={() => removeRacer(name)} className="ml-1 text-gray-400 hover:text-white">&times;</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {loading && (
        <div className="flex justify-center py-8">
          <div className="w-8 h-8 border-4 border-nhra-red border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {racerData.length > 0 && (
        <>
          {/* Comparison Table */}
          <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden mb-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-nhra-border text-gray-400 text-xs uppercase tracking-wider">
                    <th className="text-left p-3 pl-5">Stat</th>
                    {racerData.map((rd, i) => (
                      <th key={rd.name} className="text-right p-3" style={{ color: COLORS[i % COLORS.length] }}>{rd.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: "Total Runs", key: "totalRuns" },
                    { label: "Wins", key: "wins" },
                    { label: "Win %", key: "winPct" },
                    { label: "Best ET", key: "bestET" },
                    { label: "Avg ET", key: "avgET" },
                    { label: "Best RT", key: "bestRT" },
                    { label: "Avg RT", key: "avgRT" },
                    { label: "Top Speed", key: "topSpeed" },
                  ].map((row) => (
                    <tr key={row.key} className="border-b border-nhra-border/50">
                      <td className="p-3 pl-5 text-gray-400 font-medium">{row.label}</td>
                      {racerData.map((rd) => {
                        const stats = getStats(rd.runs);
                        return (
                          <td key={rd.name} className="p-3 text-right font-mono text-white">
                            {String((stats as Record<string, string | number>)[row.key])}{row.key === "winPct" ? "%" : row.key === "topSpeed" && String((stats as Record<string, string | number>)[row.key]) !== "-" ? " mph" : ""}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ET Overlay Chart */}
          {etChartData.length > 0 && (
            <ChartContainer title="ET Comparison (1320ft)" height={350}>
              <MultiLineChart
                data={etChartData}
                lines={racerData.map((rd, i) => ({ key: rd.name, label: rd.name, color: COLORS[i % COLORS.length] }))}
              />
            </ChartContainer>
          )}
        </>
      )}

      {racerData.length === 0 && !loading && (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-12 text-center text-gray-500">
          Search and add racers above to compare their performance
        </div>
      )}
    </div>
  );
}
