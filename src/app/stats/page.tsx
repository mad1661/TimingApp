"use client";

import { useEffect, useState } from "react";
import { ChartContainer, CategoryBarChart, RTvsETScatter } from "@/components/Charts";
import { useLiveData } from "@/components/LiveDataProvider";

interface CategoryStat {
  category: string;
  count: number;
  bestET: number | null;
  avgRT: number | null;
  bestSpeed: number | null;
}

interface RunData {
  rt: number | null;
  ft1320: number | null;
  mph_1320: number | null;
  category: string | null;
  name: string | null;
}

export default function StatsPage() {
  const live = useLiveData();
  const [categoryStats, setCategoryStats] = useState<CategoryStat[]>([]);
  const [allRuns, setAllRuns] = useState<RunData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const eventCode = live.config?.eventCode;
    const season = live.config?.season;
    const eventQS = eventCode
      ? `&event_code=${encodeURIComponent(eventCode)}&season=${encodeURIComponent(season || "")}`
      : "";

    Promise.all([
      fetch(`/api/stats?type=categories${eventQS}`).then((r) => r.json()),
      fetch(`/api/runs?limit=1000&sort_by=timestamp&sort_dir=DESC${eventQS}`).then((r) => r.json()),
    ])
      .then(([catData, runsData]) => {
        setCategoryStats(catData.categories || []);
        setAllRuns(runsData.runs || []);
      })
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

  const scatterData = allRuns
    .filter((r) => r.rt && r.rt > 0 && r.rt < 2 && r.ft1320 && r.ft1320 > 0)
    .map((r) => ({ x: r.rt!, y: r.ft1320!, name: r.name || "" }));

  const etDistribution: Record<string, number> = {};
  allRuns.forEach((r) => {
    if (r.ft1320 && r.ft1320 > 0) {
      const bucket = Math.floor(r.ft1320).toString() + "s";
      etDistribution[bucket] = (etDistribution[bucket] || 0) + 1;
    }
  });
  const etDistData = Object.entries(etDistribution)
    .map(([category, count]) => ({ category, count, bestET: null, avgRT: null, bestSpeed: null }))
    .sort((a, b) => parseFloat(a.category) - parseFloat(b.category));

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Statistics</h1>
        <p className="text-gray-400">Performance analytics across all imported data</p>
      </div>

      {categoryStats.length === 0 ? (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-12 text-center text-gray-500">
          No data available. Import some runs first.
        </div>
      ) : (
        <>
          {/* Category Overview Table */}
          <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden mb-8">
            <div className="p-5 border-b border-nhra-border">
              <h2 className="text-lg font-semibold text-white">Category Overview</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-nhra-border text-gray-400 text-xs uppercase tracking-wider">
                    <th className="text-left p-3 pl-5">Category</th>
                    <th className="text-right p-3">Runs</th>
                    <th className="text-right p-3">Best ET</th>
                    <th className="text-right p-3">Avg RT</th>
                    <th className="text-right p-3 pr-5">Top Speed</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryStats.map((cat) => (
                    <tr key={cat.category} className="border-b border-nhra-border/50 hover:bg-nhra-border/20">
                      <td className="p-3 pl-5 text-white font-medium">{cat.category}</td>
                      <td className="p-3 text-right text-gray-300">{cat.count}</td>
                      <td className="p-3 text-right font-mono text-white">{cat.bestET?.toFixed(3) ?? "-"}</td>
                      <td className="p-3 text-right font-mono text-gray-300">{cat.avgRT?.toFixed(3) ?? "-"}</td>
                      <td className="p-3 text-right font-mono text-gray-300 pr-5">{cat.bestSpeed?.toFixed(2) ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <ChartContainer title="Best ET by Category" height={350}>
              <CategoryBarChart data={categoryStats} dataKey="bestET" label="Best ET (sec)" color="#C8102E" />
            </ChartContainer>

            <ChartContainer title="Average Reaction Time by Category" height={350}>
              <CategoryBarChart data={categoryStats} dataKey="avgRT" label="Avg RT (sec)" color="#003DA5" />
            </ChartContainer>

            <ChartContainer title="Top Speed by Category" height={350}>
              <CategoryBarChart data={categoryStats} dataKey="bestSpeed" label="Top Speed (mph)" color="#22c55e" />
            </ChartContainer>

            <ChartContainer title="ET Distribution" height={350}>
              <CategoryBarChart data={etDistData} dataKey="count" label="Run Count" color="#eab308" />
            </ChartContainer>
          </div>

          {/* Scatter Plot */}
          {scatterData.length > 0 && (
            <ChartContainer title="Reaction Time vs ET (1320ft)" height={400}>
              <RTvsETScatter data={scatterData} />
            </ChartContainer>
          )}
        </>
      )}
    </div>
  );
}
