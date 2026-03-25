"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLiveData } from "@/components/LiveDataProvider";

interface EventOption {
  event_code: string;
  event_name: string;
  season: string;
}

interface PerfectRTEntry {
  name: string;
  car_number: string;
  category: string;
  round: string;
  rt: number;
  ft1320: number | null;
  is_winner: number;
  timestamp: string;
}

export default function PerfectRTPage() {
  const live = useLiveData();
  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedEvent, setSelectedEvent] = useState("");
  const [selectedSeason, setSelectedSeason] = useState("");
  const [filtersLoading, setFiltersLoading] = useState(true);

  const [results, setResults] = useState<Record<string, PerfectRTEntry[]>>({});
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const ec = live.config?.eventCode || "";
    const s = live.config?.season || "";
    if (ec && s) {
      setSelectedEvent(ec);
      setSelectedSeason(s);
    }
    const qs = ec && s ? `event_code=${encodeURIComponent(ec)}&season=${encodeURIComponent(s)}&limit=1` : "limit=1";
    fetch(`/api/runs?${qs}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.filters) {
          setEvents(data.filters.events || []);
        }
      })
      .catch(console.error)
      .finally(() => setFiltersLoading(false));
  }, [live.config?.eventCode, live.config?.season]);

  function handleEventChange(value: string) {
    const event = events.find((e) => `${e.event_code}|${e.season}` === value);
    if (event) {
      setSelectedEvent(event.event_code);
      setSelectedSeason(event.season);
      setResults({});
      setSearched(false);
    }
  }

  async function search() {
    if (!selectedEvent || !selectedSeason) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/stats?type=perfect-rt&event_code=${encodeURIComponent(selectedEvent)}&season=${encodeURIComponent(selectedSeason)}`
      );
      const data = await res.json();
      setResults(data.results || {});
      setSearched(true);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const totalCount = Object.values(results).reduce((sum, arr) => sum + arr.length, 0);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Perfect Reaction Time</h1>
        <p className="text-gray-400">Racers who hit a perfect 0.000 RT in elimination rounds</p>
      </div>

      {/* Event Selector */}
      <div className="bg-nhra-card border border-nhra-border rounded-xl p-6 mb-6">
        <label className="block text-sm text-gray-400 mb-2">Event</label>
        <select
          value={selectedEvent ? `${selectedEvent}|${selectedSeason}` : ""}
          onChange={(e) => handleEventChange(e.target.value)}
          className="w-full px-4 py-3 bg-nhra-darker border border-nhra-border rounded-lg text-white text-base focus:outline-none focus:border-nhra-accent"
          disabled={filtersLoading}
          aria-label="Select Event"
        >
          <option value="">Select Event</option>
          {events.map((e) => (
            <option key={`${e.event_code}|${e.season}`} value={`${e.event_code}|${e.season}`}>
              {e.event_name} ({e.season})
            </option>
          ))}
        </select>
      </div>

      {/* Search Button */}
      <button
        onClick={search}
        disabled={loading || !selectedEvent}
        className="w-full mb-8 px-6 py-4 bg-green-600 text-white rounded-xl font-bold text-base hover:bg-green-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-3"
      >
        {loading ? (
          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        )}
        Find Perfect Lights
      </button>

      {/* Results */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {searched && !loading && totalCount === 0 && (
        <div className="bg-nhra-card border-2 border-gray-600/30 rounded-xl px-6 py-10 text-center">
          <p className="text-gray-400 font-bold text-lg mb-1">No Perfect Lights</p>
          <p className="text-gray-500 text-sm">Nobody hit a 0.000 RT in eliminations at this event</p>
        </div>
      )}

      {searched && !loading && totalCount > 0 && (
        <div className="space-y-6">
          <div className="bg-green-500/10 border-2 border-green-500/40 rounded-xl px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 bg-green-500 rounded-full" />
              <span className="text-green-400 font-bold text-lg">
                {totalCount} Perfect Light{totalCount !== 1 && "s"}
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
                <span className="px-2.5 py-0.5 bg-green-500/20 text-green-400 text-xs font-bold rounded-full">
                  {entries.length}
                </span>
              </div>
              <div className="divide-y divide-nhra-border">
                {entries.map((entry, idx) => (
                  <div key={`${entry.name}-${entry.round}-${entry.timestamp}-${idx}`} className="px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-2.5 h-2.5 bg-green-500 rounded-full shrink-0" />
                      <div className="min-w-0">
                        <Link
                          href={`/racer/${encodeURIComponent(entry.name)}`}
                          className="text-white font-semibold hover:text-nhra-accent transition-colors truncate block"
                        >
                          {entry.name}
                        </Link>
                        <p className="text-xs text-nhra-accent font-bold">#{entry.car_number}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 shrink-0 ml-4">
                      <div className="text-right">
                        <span className="inline-block px-3 py-1 bg-green-500/15 text-green-400 text-sm font-bold font-mono rounded-lg">
                          0.000
                        </span>
                        <p className="text-xs text-gray-500 mt-1">
                          {entry.round === "F" ? "Final" : entry.round.replace("E", "Round ")}
                        </p>
                      </div>
                      {entry.ft1320 && entry.ft1320 > 0 && (
                        <div className="text-right">
                          <p className="text-sm text-gray-300 font-mono">{entry.ft1320.toFixed(3)}</p>
                          <p className="text-xs text-gray-500">ET</p>
                        </div>
                      )}
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
          Select an event and search to find perfect reaction times in eliminations
        </div>
      )}
    </div>
  );
}
