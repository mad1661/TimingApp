"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLiveData } from "@/components/LiveDataProvider";

interface DeadOnEntry {
  name: string;
  car_number: string;
  category: string;
  round: string;
  rt: number | null;
  ft1320: number;
  dial_in: number;
  is_winner: number;
  timestamp: string;
}

export default function DeadOnPage() {
  const live = useLiveData();
  const selectedEvent = live.config?.eventCode || "";
  const selectedEventName = live.config?.eventName || "";
  const selectedSeason = live.config?.season || "";

  const [results, setResults] = useState<Record<string, DeadOnEntry[]>>({});
  const [membership, setMembership] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [winnersCopied, setWinnersCopied] = useState(false);


  async function search() {
    if (!selectedEvent || !selectedSeason) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/stats?type=dead-on&event_code=${encodeURIComponent(selectedEvent)}&season=${encodeURIComponent(selectedSeason)}`
      );
      const data = await res.json();
      setResults(data.results || {});
      setMembership(data.membership || {});
      setSearched(true);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const totalCount = Object.values(results).reduce((sum, arr) => sum + arr.length, 0);

  const roundLabel = (round: string) =>
    round === "F" || round.toUpperCase() === "FINAL" ? "Final" : round.replace(/^E/, "Round ");

  // Build the publication list — every dead on run, ordered by category (alphabetical)
  // then by round/time within each category. Shows all cars, including multiple per class.
  const deadOnRows = Object.entries(results)
    .filter(([, entries]) => entries.length > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([, entries]) => entries);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Dead On</h1>
        <p className="text-gray-400">Racers who ran exactly on their dial-in in elimination rounds</p>
      </div>

      {/* Search Button */}
      <button
        onClick={search}
        disabled={loading || !selectedEvent}
        className="w-full mb-8 px-6 py-4 bg-blue-600 text-white rounded-xl font-bold text-base hover:bg-blue-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-3"
      >
        {loading ? (
          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        )}
        Find Dead On Runs
      </button>

      {/* Results */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {searched && !loading && totalCount === 0 && (
        <div className="bg-nhra-card border-2 border-gray-600/30 rounded-xl px-6 py-10 text-center">
          <p className="text-gray-400 font-bold text-lg mb-1">No Dead On Runs</p>
          <p className="text-gray-500 text-sm">Nobody ran exactly on their dial-in in eliminations at this event</p>
        </div>
      )}

      {/* Publication List - all dead on runs */}
      {searched && !loading && deadOnRows.length > 0 && (
        <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden mb-8">
          <div className="px-6 py-4 bg-nhra-darker border-b border-nhra-border flex items-center justify-between">
            <h3 className="text-white font-bold text-lg">Dead On - {selectedEventName || selectedEvent}</h3>
            <button
              onClick={() => {
                const eventLabel = selectedEventName || selectedEvent;
                const pad = (s: string, len: number) => s + " ".repeat(Math.max(0, len - s.length));
                const header = `Dead On - ${eventLabel}`;
                const colHeader = `${pad("Racer", 24)}${pad("Category", 22)}${pad("Car Number", 14)}${pad("Round", 10)}${pad("ET", 12)}${pad("Dial-In", 12)}Membership`;
                const rows = deadOnRows.map((w) =>
                  `${pad(w.name, 24)}${pad(w.category, 22)}${pad("#" + w.car_number, 14)}${pad(roundLabel(w.round), 10)}${pad(w.ft1320.toFixed(3), 12)}${pad(w.dial_in.toFixed(3), 12)}${membership[w.name] || "\u2014"}`
                );
                const text = `${header}\n${colHeader}\n${rows.join("\n")}`;
                navigator.clipboard.writeText(text);
                setWinnersCopied(true);
                setTimeout(() => setWinnersCopied(false), 2000);
              }}
              className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
              </svg>
              {winnersCopied ? "Copied!" : "Copy for Publication"}
            </button>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-nhra-border text-gray-400 text-xs font-bold uppercase tracking-wider">
                <th className="px-6 py-3 text-left">Racer</th>
                <th className="px-4 py-3 text-left">Category</th>
                <th className="px-4 py-3 text-left">Car Number</th>
                <th className="px-4 py-3 text-left">Round</th>
                <th className="px-4 py-3 text-left">ET</th>
                <th className="px-4 py-3 text-left">Dial-In</th>
                <th className="px-4 py-3 text-left">Membership</th>
              </tr>
            </thead>
            <tbody>
              {deadOnRows.map((w, idx) => (
                <tr key={`${w.category}-${w.name}-${w.round}-${w.timestamp}-${idx}`} className="border-b border-nhra-border/30">
                  <td className="px-6 py-3">
                    <Link
                      href={`/racer/${encodeURIComponent(w.name)}`}
                      className="text-white font-semibold hover:text-nhra-accent transition-colors"
                    >
                      {w.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-white">{w.category}</td>
                  <td className="px-4 py-3 text-white">#{w.car_number}</td>
                  <td className="px-4 py-3 text-white">{roundLabel(w.round)}</td>
                  <td className="px-4 py-3 text-white font-mono">{w.ft1320.toFixed(3)}</td>
                  <td className="px-4 py-3 text-white font-mono">{w.dial_in.toFixed(3)}</td>
                  <td className="px-4 py-3 text-gray-400">{membership[w.name] || "\u2014"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {searched && !loading && totalCount > 0 && (
        <div className="space-y-6">
          <div className="bg-blue-500/10 border-2 border-blue-500/40 rounded-xl px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 bg-blue-500 rounded-full" />
              <span className="text-blue-400 font-bold text-lg">
                {totalCount} Dead On Run{totalCount !== 1 && "s"}
              </span>
            </div>
            <span className="text-gray-400 text-sm">
              across {Object.keys(results).length} class{Object.keys(results).length !== 1 ? "es" : ""}
            </span>
          </div>

          {Object.entries(results)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([category, entries]) => (
            <div key={category} className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden">
              <div className="px-6 py-3 bg-nhra-darker border-b border-nhra-border flex items-center justify-between">
                <h3 className="text-white font-bold">{category}</h3>
                <span className="px-2.5 py-0.5 bg-blue-500/20 text-blue-400 text-xs font-bold rounded-full">
                  {entries.length}
                </span>
              </div>
              <div className="divide-y divide-nhra-border">
                {entries.map((entry, idx) => (
                  <div key={`${entry.name}-${entry.round}-${entry.timestamp}-${idx}`} className="px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-2.5 h-2.5 bg-blue-500 rounded-full shrink-0" />
                      <div className="min-w-0">
                        <Link
                          href={`/racer/${encodeURIComponent(entry.name)}`}
                          className="text-white font-semibold hover:text-nhra-accent transition-colors truncate block"
                        >
                          {entry.name}
                        </Link>
                        <div className="flex items-center gap-2">
                          <p className="text-xs text-nhra-accent font-bold">#{entry.car_number}</p>
                          {membership[entry.name] && (
                            <p className="text-xs text-gray-500">Member: {membership[entry.name]}</p>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0 ml-4">
                      <div className="text-right">
                        <div className="flex items-center gap-2">
                          <span className="inline-block px-3 py-1 bg-blue-500/15 text-blue-400 text-sm font-bold font-mono rounded-lg">
                            {entry.ft1320.toFixed(3)}
                          </span>
                          <span className="text-gray-500 text-xs">=</span>
                          <span className="text-gray-400 text-sm font-mono">
                            {entry.dial_in.toFixed(3)}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          {roundLabel(entry.round)}
                          {entry.rt != null && entry.rt > 0 && (
                            <span className="ml-2 text-gray-400">RT {entry.rt.toFixed(3)}</span>
                          )}
                        </p>
                      </div>
                      <span className={`inline-block px-2 py-0.5 text-xs font-bold rounded ${
                        entry.is_winner === 1
                          ? "bg-green-500/15 text-green-400"
                          : "bg-red-500/15 text-red-400"
                      }`}>
                        {entry.is_winner === 1 ? "WIN" : "LOSS"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!searched && !loading && (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-12 text-center text-gray-500">
          Select an event and search to find dead on runs in eliminations
        </div>
      )}
    </div>
  );
}
