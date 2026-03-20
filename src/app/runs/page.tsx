"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useLiveData } from "@/components/LiveDataProvider";

interface RunRow {
  id?: string;
  timestamp: string | null;
  round: string | null;
  qual_pos: number | null;
  car_number: string | null;
  name: string | null;
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
  mov: number | null;
  is_winner: number;
  is_dq: number;
  category: string | null;
  lane: string | null;
  dial_in: number | null;
}

interface Filters {
  categories: string[];
  seasons: string[];
  rounds: string[];
  classes: string[];
  events: { event_code: string; event_name: string; season: string }[];
}

const PAGE_SIZE = 50;

export default function RunsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-500">Loading...</div>}>
      <RunsPageInner />
    </Suspense>
  );
}

function RunsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const live = useLiveData();

  const [runs, setRuns] = useState<RunRow[]>([]);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<Filters | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);

  const [nameFilter, setNameFilter] = useState(searchParams.get("name") || "");
  const [categoryFilter, setCategoryFilter] = useState(searchParams.get("category") || "");
  const [seasonFilter, setSeasonFilter] = useState(searchParams.get("season") || "");
  const [roundFilter, setRoundFilter] = useState(searchParams.get("round") || "");
  const [classFilter, setClassFilter] = useState(searchParams.get("class_index") || "");
  const [sortBy, setSortBy] = useState("timestamp");
  const [sortDir, setSortDir] = useState<"ASC" | "DESC">("DESC");

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (nameFilter) params.set("name", nameFilter);
    if (categoryFilter) params.set("category", categoryFilter);
    if (seasonFilter) params.set("season", seasonFilter);
    if (roundFilter) params.set("round", roundFilter);
    if (classFilter) params.set("class_index", classFilter);
    if (live.config?.eventCode) params.set("event_code", live.config.eventCode);
    if (live.config?.season) params.set("season", live.config.season);
    params.set("limit", PAGE_SIZE.toString());
    params.set("offset", (page * PAGE_SIZE).toString());
    params.set("sort_by", sortBy);
    params.set("sort_dir", sortDir);

    try {
      const res = await fetch(`/api/runs?${params}`);
      const data = await res.json();
      setRuns(data.runs || []);
      setTotal(data.total || 0);
      if (data.filters) setFilters(data.filters);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [nameFilter, categoryFilter, seasonFilter, roundFilter, classFilter, page, sortBy, sortDir, live.config?.eventCode, live.config?.season]);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  function handleSort(col: string) {
    if (sortBy === col) {
      setSortDir(sortDir === "ASC" ? "DESC" : "ASC");
    } else {
      setSortBy(col);
      setSortDir("DESC");
    }
    setPage(0);
  }

  function handleExportCsv() {
    const headers = ["Timestamp", "Round", "QualPos", "CarNumber", "Name", "Class", "RT", "60ft", "330ft", "660ft", "660mph", "1000ft", "1000mph", "1320ft", "1320mph", "MOV", "Winner", "Category", "Lane", "DialIn"];
    const csvRows = [headers.join(",")];
    for (const r of runs) {
      csvRows.push([
        r.timestamp, r.round, r.qual_pos, r.car_number, `"${r.name || ""}"`, r.class_index,
        r.rt, r.ft60, r.ft330, r.ft660, r.mph_660, r.ft1000, r.mph_1000, r.ft1320, r.mph_1320,
        r.mov, r.is_winner ? "W" : "", r.category, r.lane, r.dial_in,
      ].join(","));
    }
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "timindata_export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const SortHeader = ({ col, label, align = "left" }: { col: string; label: string; align?: string }) => (
    <th
      onClick={() => handleSort(col)}
      className={`p-3 cursor-pointer hover:text-white transition-colors whitespace-nowrap ${align === "right" ? "text-right" : "text-left"} ${sortBy === col ? "text-nhra-accent" : ""}`}
    >
      {label}
      {sortBy === col && <span className="ml-1">{sortDir === "ASC" ? "\u2191" : "\u2193"}</span>}
    </th>
  );

  return (
    <div className="max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Runs</h1>
          <p className="text-gray-400">{total.toLocaleString()} total runs</p>
        </div>
        <button
          onClick={handleExportCsv}
          disabled={runs.length === 0}
          className="px-4 py-2 bg-nhra-card border border-nhra-border text-gray-300 rounded-lg text-sm hover:text-white hover:border-gray-500 transition-colors disabled:opacity-50"
        >
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="bg-nhra-card border border-nhra-border rounded-xl p-4 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <input
            type="text"
            value={nameFilter}
            onChange={(e) => { setNameFilter(e.target.value); setPage(0); }}
            placeholder="Search racer..."
            className="px-3 py-2 bg-nhra-darker border border-nhra-border rounded-lg text-white text-sm placeholder-gray-600 focus:outline-none focus:border-nhra-accent"
          />
          <select
            value={categoryFilter}
            onChange={(e) => { setCategoryFilter(e.target.value); setPage(0); }}
            className="px-3 py-2 bg-nhra-darker border border-nhra-border rounded-lg text-white text-sm focus:outline-none focus:border-nhra-accent"
          >
            <option value="">All Categories</option>
            {filters?.categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            value={seasonFilter}
            onChange={(e) => { setSeasonFilter(e.target.value); setPage(0); }}
            className="px-3 py-2 bg-nhra-darker border border-nhra-border rounded-lg text-white text-sm focus:outline-none focus:border-nhra-accent"
          >
            <option value="">All Seasons</option>
            {filters?.seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={roundFilter}
            onChange={(e) => { setRoundFilter(e.target.value); setPage(0); }}
            className="px-3 py-2 bg-nhra-darker border border-nhra-border rounded-lg text-white text-sm focus:outline-none focus:border-nhra-accent"
          >
            <option value="">All Rounds</option>
            {filters?.rounds.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select
            value={classFilter}
            onChange={(e) => { setClassFilter(e.target.value); setPage(0); }}
            className="px-3 py-2 bg-nhra-darker border border-nhra-border rounded-lg text-white text-sm focus:outline-none focus:border-nhra-accent"
          >
            <option value="">All Classes</option>
            {filters?.classes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-nhra-border text-gray-400 text-xs uppercase tracking-wider">
                <SortHeader col="name" label="Racer" />
                <SortHeader col="category" label="Category" />
                <SortHeader col="round" label="Rnd" />
                <SortHeader col="class_index" label="Class" />
                <SortHeader col="rt" label="RT" align="right" />
                <SortHeader col="ft60" label="60ft" align="right" />
                <SortHeader col="ft330" label="330ft" align="right" />
                <SortHeader col="ft660" label="660ft" align="right" />
                <SortHeader col="mph_660" label="660mph" align="right" />
                <SortHeader col="ft1320" label="ET" align="right" />
                <SortHeader col="mph_1320" label="MPH" align="right" />
                <th className="p-3 text-center">W</th>
                <SortHeader col="dial_in" label="Dial" align="right" />
                <SortHeader col="lane" label="Ln" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={14} className="p-8 text-center text-gray-500">Loading...</td></tr>
              ) : runs.length === 0 ? (
                <tr><td colSpan={14} className="p-8 text-center text-gray-500">No runs found</td></tr>
              ) : (() => {
                const rows: React.ReactNode[] = [];
                let pairIdx = 0;

                for (let i = 0; i < runs.length; i++) {
                  const run = runs[i];
                  const prevTs = i > 0 ? runs[i - 1].timestamp : null;
                  const nextTs = i < runs.length - 1 ? runs[i + 1]?.timestamp : null;
                  const isFirstInPair = run.timestamp !== prevTs;
                  const isLastInPair = run.timestamp !== nextTs;
                  const isInPair = run.timestamp === prevTs || run.timestamp === nextTs;

                  if (isFirstInPair && isInPair) pairIdx++;
                  const pairBg = isInPair && pairIdx % 2 === 0 ? "bg-nhra-border/10" : "";
                  const borderClass = isLastInPair ? "border-b-2 border-nhra-border" : "border-b border-nhra-border/30";

                  rows.push(
                    <tr key={run.id || i} className={`${borderClass} hover:bg-nhra-border/20 transition-colors ${pairBg}`}>
                      <td className="p-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {isInPair && (
                            <span className={`w-1 h-6 rounded-full shrink-0 ${run.is_winner ? "bg-green-500" : "bg-gray-700"}`} />
                          )}
                          <div>
                            <Link href={`/racer/${encodeURIComponent(run.name || "")}`} className="text-white hover:text-nhra-accent font-medium">
                              {run.name}
                            </Link>
                            <span className="text-nhra-accent font-bold text-sm ml-2">#{run.car_number}</span>
                          </div>
                        </div>
                      </td>
                      <td className="p-3 text-gray-300 whitespace-nowrap text-xs">{run.category}</td>
                      <td className="p-3 text-gray-300">{run.round}</td>
                      <td className="p-3 text-gray-400">{run.class_index}</td>
                      <td className="p-3 text-right font-mono text-gray-300">{run.rt?.toFixed(3) ?? "-"}</td>
                      <td className="p-3 text-right font-mono text-gray-400">{run.ft60?.toFixed(3) ?? "-"}</td>
                      <td className="p-3 text-right font-mono text-gray-400">{run.ft330?.toFixed(3) ?? "-"}</td>
                      <td className="p-3 text-right font-mono text-gray-400">{run.ft660?.toFixed(3) ?? "-"}</td>
                      <td className="p-3 text-right font-mono text-gray-400">{run.mph_660?.toFixed(2) ?? "-"}</td>
                      <td className="p-3 text-right font-mono text-white font-medium">{run.ft1320?.toFixed(3) ?? "-"}</td>
                      <td className="p-3 text-right font-mono text-gray-300">{run.mph_1320?.toFixed(2) ?? "-"}</td>
                      <td className="p-3 text-center">
                        {run.is_winner ? <span className="text-green-400 font-bold text-xs">W</span> : <span className="text-gray-600">-</span>}
                      </td>
                      <td className="p-3 text-right font-mono text-gray-400">{run.dial_in?.toFixed(2) ?? "-"}</td>
                      <td className="p-3 text-gray-400">{run.lane}</td>
                    </tr>
                  );
                }
                return rows;
              })()}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between p-4 border-t border-nhra-border">
            <p className="text-sm text-gray-400">
              Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </p>
            <div className="flex gap-2">
              <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="px-3 py-1.5 bg-nhra-darker border border-nhra-border rounded text-sm text-gray-300 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed">Prev</button>
              <span className="px-3 py-1.5 text-sm text-gray-400">Page {page + 1} of {totalPages}</span>
              <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} className="px-3 py-1.5 bg-nhra-darker border border-nhra-border rounded text-sm text-gray-300 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
