"use client";

import { useCallback, useEffect, useState } from "react";

// Hide the share page from any in-app linking. The page also lives outside the
// AppShell (no navbar, no event banner, no LiveDataProvider config), so a
// visitor here has no in-page link back to the rest of the app.

interface ScheduleEntry {
  category: string;
  round: string;
  firstTimestamp: string;
  lastTimestamp: string;
  totalRuns: number;
  pairCount: number;
  durationMinutes: number;
}

interface PublicEvent {
  event_code: string;
  event_name: string;
  season: string;
  start_date: string;
  event_type: string;
}

interface PublicResp {
  event: PublicEvent;
  schedule: ScheduleEntry[];
  rounds: string[];
  categories: string[];
  inserted: number;
  scrapeError: string | null;
  fetchedAt: string;
  error?: string;
}

function parseTs(ts: string): Date | null {
  try {
    const parts = ts.split(" ");
    const [month, day, year] = (parts[0] || "").split("/");
    const [hh, mm, ss] = (parts[1] || "").split(":");
    const ampm = parts[2]?.toUpperCase();
    let h = parseInt(hh || "0", 10);
    if (ampm === "PM" && h !== 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    return new Date(parseInt(year || "0"), parseInt(month || "1") - 1, parseInt(day || "1"), h, parseInt(mm || "0"), parseInt(ss || "0"));
  } catch { return null; }
}

function fmtTime(ts: string): string {
  const d = parseTs(ts);
  if (!d) return ts;
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function fmtDateLabel(ts: string): string {
  const d = parseTs(ts);
  if (!d) return ts;
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" });
}

function fmtDuration(min: number): string {
  if (min <= 0) return "<1m";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function roundLabel(r: string): string {
  if (!r) return r;
  if (r.startsWith("Q")) return `Q-${r.slice(1)}`;
  if (r.startsWith("E")) return `R-${r.slice(1)}`;
  if (r.startsWith("T")) return r.toUpperCase();
  if (r === "F" || r.toLowerCase() === "final") return "Final";
  return r;
}

function dayKey(ts: string): string {
  const d = parseTs(ts);
  if (!d) return ts.split(" ")[0] || ts;
  return d.toISOString().slice(0, 10);
}

export default function SharePage() {
  const [data, setData] = useState<PublicResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/public-fetch", { method: "POST" });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as PublicResp;
      setData(json);
      if (json.scrapeError) setError(json.scrapeError);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { refresh(true); }, [refresh]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-nhra-darker text-white">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-nhra-red border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading schedule…</p>
        </div>
      </div>
    );
  }

  const event = data?.event;
  const sched = data?.schedule ?? [];

  // Group by day and then by category, sorted by first run time per session.
  const byDay = new Map<string, ScheduleEntry[]>();
  for (const s of sched) {
    const k = dayKey(s.firstTimestamp);
    const arr = byDay.get(k) ?? [];
    arr.push(s);
    byDay.set(k, arr);
  }
  const days = Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b));
  for (const [, arr] of days) {
    arr.sort((a, b) => {
      const da = parseTs(a.firstTimestamp);
      const db = parseTs(b.firstTimestamp);
      return (da?.getTime() ?? 0) - (db?.getTime() ?? 0);
    });
  }

  return (
    <div className="min-h-screen bg-nhra-darker text-white">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <p className="text-xs uppercase tracking-widest text-gray-500 mb-1">Live schedule</p>
            <h1 className="text-2xl font-bold">{event?.event_name || "Event"}</h1>
            <p className="text-xs text-gray-400 mt-1">
              {event?.season ? `${event.season} season` : ""}
              {data?.fetchedAt && (
                <> &middot; updated {new Date(data.fetchedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</>
              )}
            </p>
          </div>
          <button
            onClick={() => refresh()}
            disabled={refreshing}
            className="px-4 py-2 bg-nhra-red text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
          >
            <svg className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded-lg p-3 text-sm mb-4">
            {error}
          </div>
        )}

        {days.length === 0 ? (
          <div className="bg-nhra-card border border-nhra-border rounded-xl p-8 text-center text-gray-500">
            No runs recorded yet for this event.
          </div>
        ) : (
          days.map(([day, entries]) => (
            <div key={day} className="mb-6">
              <h2 className="text-base font-bold text-white mb-3">{fmtDateLabel(entries[0].firstTimestamp)}</h2>
              <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-nhra-border text-xs uppercase tracking-wider text-gray-400">
                      <th className="text-left p-3">Start</th>
                      <th className="text-left p-3">End</th>
                      <th className="text-left p-3">Category</th>
                      <th className="text-left p-3">Round</th>
                      <th className="text-right p-3">Cars</th>
                      <th className="text-right p-3">Pairs</th>
                      <th className="text-right p-3">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((s, i) => (
                      <tr key={`${s.category}-${s.round}-${i}`} className="border-b border-nhra-border/50 last:border-0">
                        <td className="p-3 font-mono text-gray-300 whitespace-nowrap">{fmtTime(s.firstTimestamp)}</td>
                        <td className="p-3 font-mono text-gray-400 whitespace-nowrap">{fmtTime(s.lastTimestamp)}</td>
                        <td className="p-3 text-white whitespace-nowrap">{s.category}</td>
                        <td className="p-3 text-gray-300 whitespace-nowrap">{roundLabel(s.round)}</td>
                        <td className="p-3 text-right font-mono text-white">{s.totalRuns}</td>
                        <td className="p-3 text-right font-mono text-gray-400">{s.pairCount}</td>
                        <td className="p-3 text-right font-mono text-gray-400 whitespace-nowrap">{fmtDuration(s.durationMinutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}

        <div className="text-center text-xs text-gray-600 mt-8">
          {data?.fetchedAt && <>Last refreshed {new Date(data.fetchedAt).toLocaleString()}</>}
        </div>
      </div>
    </div>
  );
}
