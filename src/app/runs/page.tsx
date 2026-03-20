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
  _dedup_key?: string;
}

interface Filters {
  categories: string[];
  seasons: string[];
  rounds: string[];
  classes: string[];
  events: { event_code: string; event_name: string; season: string }[];
}

const PAGE_SIZE = 50;

function fmtRunTime(ts: string | null): string {
  if (!ts) return "-";
  const parts = ts.split(" ");
  const timePart = parts[1];
  const ampm = parts[2] || "";
  if (!timePart) return ts;
  const [hh, mm, ss] = timePart.split(":");
  let h = parseInt(hh, 10);
  const suffix = ampm || (h >= 12 ? "PM" : "AM");
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${mm}:${ss} ${suffix}`;
}

export default function RunsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-500">Loading...</div>}>
      <RunsPageInner />
    </Suspense>
  );
}

function IgnoreConfirmModal({ run, onConfirm, onCancel }: { run: RunRow; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-nhra-dark border border-nhra-border rounded-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-white">Ignore Test Run?</h2>
        </div>
        <div className="bg-nhra-darker rounded-lg p-4 mb-5 space-y-1">
          <p className="text-white font-medium">{run.name} <span className="text-nhra-accent font-bold">#{run.car_number}</span></p>
          <p className="text-gray-400 text-sm">{run.category} &middot; {run.round}</p>
          {run.ft1320 != null && <p className="text-gray-400 text-sm">ET: {run.ft1320.toFixed(3)} &middot; MPH: {run.mph_1320?.toFixed(2) ?? "-"}</p>}
          <p className="text-gray-500 text-xs mt-1">{run.timestamp}</p>
        </div>
        <p className="text-gray-400 text-sm mb-5">
          This run will be hidden from results and schedule calculations. You can restore it later.
        </p>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 bg-nhra-darker border border-nhra-border text-gray-300 rounded-lg text-sm hover:text-white transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} className="px-4 py-2 bg-yellow-600 text-white rounded-lg text-sm font-medium hover:bg-yellow-700 transition-colors">
            Yes, Ignore Run
          </button>
        </div>
      </div>
    </div>
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

  const [ignoredKeys, setIgnoredKeys] = useState<Set<string>>(new Set());
  const [showIgnored, setShowIgnored] = useState(false);
  const [confirmRun, setConfirmRun] = useState<RunRow | null>(null);
  const [ignoreLoading, setIgnoreLoading] = useState<string | null>(null);

  const eventCode = live.config?.eventCode || "";
  const season = live.config?.season || "";

  const loadIgnoredKeys = useCallback(async () => {
    if (!eventCode || !season) return;
    try {
      const res = await fetch(`/api/ignore-run?event_code=${encodeURIComponent(eventCode)}&season=${encodeURIComponent(season)}`);
      const data = await res.json();
      setIgnoredKeys(new Set(data.keys || []));
    } catch (err) {
      console.error("Failed to load ignored keys:", err);
    }
  }, [eventCode, season]);

  useEffect(() => { loadIgnoredKeys(); }, [loadIgnoredKeys]);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (nameFilter) params.set("name", nameFilter);
    if (categoryFilter) params.set("category", categoryFilter);
    if (seasonFilter) params.set("season", seasonFilter);
    if (roundFilter) params.set("round", roundFilter);
    if (classFilter) params.set("class_index", classFilter);
    if (eventCode) params.set("event_code", eventCode);
    if (season) params.set("season", season);
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
  }, [nameFilter, categoryFilter, seasonFilter, roundFilter, classFilter, page, sortBy, sortDir, eventCode, season]);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  async function handleIgnore(run: RunRow) {
    const key = run._dedup_key;
    if (!key || !eventCode || !season) return;
    setIgnoreLoading(key);
    try {
      await fetch("/api/ignore-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_code: eventCode, season, dedup_key: key }),
      });
      setIgnoredKeys((prev) => new Set([...prev, key]));
    } catch (err) {
      console.error(err);
    }
    setIgnoreLoading(null);
    setConfirmRun(null);
  }

  async function handleRestore(run: RunRow) {
    const key = run._dedup_key;
    if (!key || !eventCode || !season) return;
    setIgnoreLoading(key);
    try {
      await fetch("/api/ignore-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_code: eventCode, season, dedup_key: key, action: "restore" }),
      });
      setIgnoredKeys((prev) => { const next = new Set(prev); next.delete(key); return next; });
    } catch (err) {
      console.error(err);
    }
    setIgnoreLoading(null);
  }

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
    const exportRuns = runs.filter((r) => !r._dedup_key || !ignoredKeys.has(r._dedup_key));
    const headers = ["Timestamp", "Round", "QualPos", "CarNumber", "Name", "Class", "RT", "60ft", "330ft", "660ft", "660mph", "1000ft", "1000mph", "1320ft", "1320mph", "MOV", "Winner", "Category", "Lane", "DialIn"];
    const csvRows = [headers.join(",")];
    for (const r of exportRuns) {
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

  const displayRuns = showIgnored
    ? runs
    : runs.filter((r) => !r._dedup_key || !ignoredKeys.has(r._dedup_key));
  const ignoredOnPage = runs.filter((r) => r._dedup_key && ignoredKeys.has(r._dedup_key)).length;
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
          <p className="text-gray-400">{total.toLocaleString()} total runs{ignoredKeys.size > 0 && <span className="text-yellow-500 ml-2">({ignoredKeys.size} ignored)</span>}</p>
        </div>
        <div className="flex items-center gap-3">
          {ignoredKeys.size > 0 && (
            <button
              onClick={() => setShowIgnored(!showIgnored)}
              className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${showIgnored ? "bg-yellow-500/20 border-yellow-500/50 text-yellow-400" : "bg-nhra-darker border-nhra-border text-gray-500 hover:text-white"}`}
            >
              {showIgnored ? "Showing Ignored" : "Show Ignored"} ({ignoredKeys.size})
            </button>
          )}
          <button
            onClick={handleExportCsv}
            disabled={runs.length === 0}
            className="px-4 py-2 bg-nhra-card border border-nhra-border text-gray-300 rounded-lg text-sm hover:text-white hover:border-gray-500 transition-colors disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
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
                <SortHeader col="timestamp" label="Time" />
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
                <th className="p-3 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={16} className="p-8 text-center text-gray-500">Loading...</td></tr>
              ) : displayRuns.length === 0 ? (
                <tr><td colSpan={16} className="p-8 text-center text-gray-500">No runs found</td></tr>
              ) : (() => {
                const rows: React.ReactNode[] = [];
                let pairIdx = 0;

                for (let i = 0; i < displayRuns.length; i++) {
                  const run = displayRuns[i];
                  const isIgnored = !!(run._dedup_key && ignoredKeys.has(run._dedup_key));
                  const prevTs = i > 0 ? displayRuns[i - 1].timestamp : null;
                  const nextTs = i < displayRuns.length - 1 ? displayRuns[i + 1]?.timestamp : null;
                  const isFirstInPair = run.timestamp !== prevTs;
                  const isLastInPair = run.timestamp !== nextTs;
                  const isInPair = run.timestamp === prevTs || run.timestamp === nextTs;

                  if (isFirstInPair && isInPair) pairIdx++;
                  const pairBg = isInPair && pairIdx % 2 === 0 ? "bg-nhra-border/10" : "";
                  const borderClass = isLastInPair ? "border-b-2 border-nhra-border" : "border-b border-nhra-border/30";
                  const ignoredStyle = isIgnored ? "opacity-40 line-through" : "";

                  rows.push(
                    <tr key={run.id || `${run._dedup_key || i}`} className={`${borderClass} hover:bg-nhra-border/20 transition-colors ${pairBg} ${isIgnored ? "bg-yellow-900/10" : ""}`}>
                      <td className={`p-3 whitespace-nowrap font-mono text-xs text-gray-500 ${ignoredStyle}`}>
                        {isFirstInPair ? fmtRunTime(run.timestamp) : ""}
                      </td>
                      <td className={`p-3 whitespace-nowrap ${ignoredStyle}`}>
                        <div className="flex items-center gap-2">
                          {isInPair && (
                            <span className={`w-1 h-6 rounded-full shrink-0 ${run.is_winner ? "bg-green-500" : "bg-gray-700"}`} />
                          )}
                          <div>
                            {run.name ? (
                              <Link href={`/racer/${encodeURIComponent(run.name)}`} className="text-white hover:text-nhra-accent font-medium">
                                {run.name}
                              </Link>
                            ) : (
                              <span className="text-gray-500 italic text-xs">No Name</span>
                            )}
                            <span className="text-nhra-accent font-bold text-sm ml-2">#{run.car_number}</span>
                            {isIgnored && <span className="ml-2 text-yellow-500 text-xs font-medium no-underline" style={{ textDecoration: "none" }}>IGNORED</span>}
                          </div>
                        </div>
                      </td>
                      <td className={`p-3 text-gray-300 whitespace-nowrap text-xs ${ignoredStyle}`}>{run.category}</td>
                      <td className={`p-3 text-gray-300 ${ignoredStyle}`}>{run.round}</td>
                      <td className={`p-3 text-gray-400 ${ignoredStyle}`}>{run.class_index}</td>
                      <td className={`p-3 text-right font-mono text-gray-300 ${ignoredStyle}`}>{run.rt?.toFixed(3) ?? "-"}</td>
                      <td className={`p-3 text-right font-mono text-gray-400 ${ignoredStyle}`}>{run.ft60?.toFixed(3) ?? "-"}</td>
                      <td className={`p-3 text-right font-mono text-gray-400 ${ignoredStyle}`}>{run.ft330?.toFixed(3) ?? "-"}</td>
                      <td className={`p-3 text-right font-mono text-gray-400 ${ignoredStyle}`}>{run.ft660?.toFixed(3) ?? "-"}</td>
                      <td className={`p-3 text-right font-mono text-gray-400 ${ignoredStyle}`}>{run.mph_660?.toFixed(2) ?? "-"}</td>
                      <td className={`p-3 text-right font-mono text-white font-medium ${ignoredStyle}`}>{run.ft1320?.toFixed(3) ?? "-"}</td>
                      <td className={`p-3 text-right font-mono text-gray-300 ${ignoredStyle}`}>{run.mph_1320?.toFixed(2) ?? "-"}</td>
                      <td className={`p-3 text-center ${ignoredStyle}`}>
                        {run.is_winner ? <span className="text-green-400 font-bold text-xs">W</span> : <span className="text-gray-600">-</span>}
                      </td>
                      <td className={`p-3 text-right font-mono text-gray-400 ${ignoredStyle}`}>{run.dial_in?.toFixed(2) ?? "-"}</td>
                      <td className={`p-3 text-gray-400 ${ignoredStyle}`}>{run.lane}</td>
                      <td className="p-3 text-center whitespace-nowrap">
                        {isIgnored ? (
                          <button
                            onClick={() => handleRestore(run)}
                            disabled={ignoreLoading === run._dedup_key}
                            className="px-2 py-1 bg-yellow-600/20 border border-yellow-600/40 text-yellow-400 rounded text-xs font-medium hover:bg-yellow-600/30 hover:text-yellow-300 transition-colors disabled:opacity-50"
                          >
                            {ignoreLoading === run._dedup_key ? "..." : "Restore"}
                          </button>
                        ) : run._dedup_key ? (
                          <button
                            onClick={() => setConfirmRun(run)}
                            disabled={ignoreLoading === run._dedup_key}
                            className="text-gray-600 hover:text-yellow-500 transition-colors disabled:opacity-50"
                            title="Ignore test run"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L6.99 7.05m3.888 2.828L14.12 14.12m0 0l2.829 2.829M6.99 7.05L3 3m3.99 4.05l14.01 14.01" />
                            </svg>
                          </button>
                        ) : null}
                      </td>
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

      {confirmRun && (
        <IgnoreConfirmModal
          run={confirmRun}
          onConfirm={() => handleIgnore(confirmRun)}
          onCancel={() => setConfirmRun(null)}
        />
      )}
    </div>
  );
}
