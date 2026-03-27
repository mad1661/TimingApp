"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLiveData } from "@/components/LiveDataProvider";

interface EventOption {
  event_code: string;
  event_name: string;
  season: string;
}

interface PackageEntry {
  name: string;
  car_number: string;
  category: string;
  round: string;
  rt: number;
  ft1320: number;
  dial_in: number;
  diff: number;
  package: number;
  timestamp: string;
}

export default function BestLosingPackagePage() {
  const live = useLiveData();
  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedEvent, setSelectedEvent] = useState("");
  const [selectedEventName, setSelectedEventName] = useState("");
  const [selectedSeason, setSelectedSeason] = useState("");
  const [filtersLoading, setFiltersLoading] = useState(true);

  // Available rounds and categories from the event
  const [availableRounds, setAvailableRounds] = useState<string[]>([]);
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);

  // Selected rounds and categories (checkmarks)
  const [selectedRounds, setSelectedRounds] = useState<Set<string>>(new Set());
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());

  const [results, setResults] = useState<Record<string, PackageEntry[]>>({});
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [winnersCopied, setWinnersCopied] = useState(false);

  // Load events on mount
  useEffect(() => {
    const ec = live.config?.eventCode || "";
    const s = live.config?.season || "";
    if (ec && s) {
      setSelectedEvent(ec);
      setSelectedEventName(live.config?.eventName || "");
      setSelectedSeason(s);
    }
    const qs = ec && s ? `event_code=${encodeURIComponent(ec)}&season=${encodeURIComponent(s)}&limit=1` : "limit=1";
    fetch(`/api/runs?${qs}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.filters) {
          setEvents(data.filters.events || []);
          // Filter to only elimination rounds
          const rounds: string[] = (data.filters.rounds || []).filter((r: string) =>
            r.startsWith("E") || r === "F" || r.toLowerCase() === "final"
          );
          setAvailableRounds(rounds);
          setAvailableCategories(data.filters.categories || []);
        }
      })
      .catch(console.error)
      .finally(() => setFiltersLoading(false));
  }, [live.config?.eventCode, live.config?.season]);

  // Reload rounds/categories when event changes
  async function loadFiltersForEvent(ec: string, s: string) {
    try {
      const res = await fetch(`/api/runs?event_code=${encodeURIComponent(ec)}&season=${encodeURIComponent(s)}&limit=1`);
      const data = await res.json();
      if (data.filters) {
        const rounds: string[] = (data.filters.rounds || []).filter((r: string) =>
          r.startsWith("E") || r === "F" || r.toLowerCase() === "final"
        );
        setAvailableRounds(rounds);
        setAvailableCategories(data.filters.categories || []);
      }
    } catch (err) {
      console.error(err);
    }
  }

  function handleEventChange(value: string) {
    const event = events.find((e) => `${e.event_code}|${e.season}` === value);
    if (event) {
      setSelectedEvent(event.event_code);
      setSelectedEventName(event.event_name);
      setSelectedSeason(event.season);
      setSelectedRounds(new Set());
      setSelectedCategories(new Set());
      setResults({});
      setSearched(false);
      loadFiltersForEvent(event.event_code, event.season);
    }
  }

  function toggleRound(round: string) {
    setSelectedRounds((prev) => {
      const next = new Set(prev);
      if (next.has(round)) next.delete(round);
      else next.add(round);
      return next;
    });
  }

  function toggleCategory(cat: string) {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  function selectAllRounds() {
    setSelectedRounds(new Set(availableRounds));
  }

  function clearAllRounds() {
    setSelectedRounds(new Set());
  }

  function selectAllCategories() {
    setSelectedCategories(new Set(availableCategories));
  }

  function clearAllCategories() {
    setSelectedCategories(new Set());
  }

  async function search() {
    if (!selectedEvent || !selectedSeason || selectedRounds.size === 0 || selectedCategories.size === 0) return;
    setLoading(true);
    try {
      const rounds = Array.from(selectedRounds).join(",");
      const categories = Array.from(selectedCategories).join(",");
      const res = await fetch(
        `/api/stats?type=best-losing-package&event_code=${encodeURIComponent(selectedEvent)}&season=${encodeURIComponent(selectedSeason)}&rounds=${encodeURIComponent(rounds)}&categories=${encodeURIComponent(categories)}`
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

  const hasSelections = selectedRounds.size > 0 && selectedCategories.size > 0;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Best Losing Package</h1>
        <p className="text-gray-400">
          Find the losers with the best combined reaction time and closeness to dial-in across elimination rounds
        </p>
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

      {/* Round Selection */}
      {availableRounds.length > 0 && (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-white">Elimination Rounds</h2>
            <div className="flex gap-2">
              <button onClick={selectAllRounds} className="text-xs text-nhra-accent hover:text-white transition-colors">
                Select All
              </button>
              <span className="text-gray-600">|</span>
              <button onClick={clearAllRounds} className="text-xs text-gray-400 hover:text-white transition-colors">
                Clear
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {availableRounds.map((round) => (
              <button
                key={round}
                onClick={() => toggleRound(round)}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                  selectedRounds.has(round)
                    ? "bg-nhra-red/20 border-nhra-red/50 text-nhra-red"
                    : "bg-nhra-darker border-nhra-border text-gray-400 hover:text-white hover:border-nhra-accent/30"
                }`}
              >
                {selectedRounds.has(round) && (
                  <svg className="w-4 h-4 inline mr-1.5 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {round === "F" ? "Final" : round.replace("E", "Round ")}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Category Selection */}
      {availableCategories.length > 0 && (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-white">Classes</h2>
            <div className="flex gap-2">
              <button onClick={selectAllCategories} className="text-xs text-nhra-accent hover:text-white transition-colors">
                Select All
              </button>
              <span className="text-gray-600">|</span>
              <button onClick={clearAllCategories} className="text-xs text-gray-400 hover:text-white transition-colors">
                Clear
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {availableCategories.map((cat) => (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                  selectedCategories.has(cat)
                    ? "bg-nhra-red/20 border-nhra-red/50 text-nhra-red"
                    : "bg-nhra-darker border-nhra-border text-gray-400 hover:text-white hover:border-nhra-accent/30"
                }`}
              >
                {selectedCategories.has(cat) && (
                  <svg className="w-4 h-4 inline mr-1.5 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {cat}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search Button */}
      <button
        onClick={search}
        disabled={loading || !hasSelections || !selectedEvent}
        className="w-full mb-8 px-6 py-4 bg-nhra-red text-white rounded-xl font-bold text-base hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-3"
      >
        {loading ? (
          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
          </svg>
        )}
        Find Best Losing Packages
      </button>

      {/* Results */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-10 h-10 border-4 border-nhra-red border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Winners - #1 BLP from each category */}
      {searched && !loading && Object.keys(results).length > 0 && (() => {
        const blpWinners = Object.entries(results)
          .filter(([, entries]) => entries.length > 0)
          .map(([, entries]) => entries[0]);
        if (blpWinners.length === 0) return null;
        return (
          <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden mb-8">
            <div className="px-6 py-4 bg-nhra-darker border-b border-nhra-border flex items-center justify-between">
              <h3 className="text-white font-bold text-lg">Winners and Info</h3>
              <button
                onClick={() => {
                  const eventLabel = selectedEventName || selectedEvent;
                  const roundsList = Array.from(selectedRounds).sort().map((r) => r === "F" ? "Final" : r.replace("E", "Round ")).join(", ");
                  const header = `Best Losing Package Winners\n${eventLabel} ${selectedSeason}\nRounds: ${roundsList}\n`;
                  const divider = "—".repeat(40);
                  const rows = blpWinners.map((w) =>
                    `${w.category}\n  ${w.name}  |  Car #${w.car_number}  |  Package: ${w.package.toFixed(4)}\n  RT: ${w.rt.toFixed(4)}  |  ET: ${w.ft1320.toFixed(3)}  |  Dial: ${w.dial_in.toFixed(2)}`
                  );
                  const text = `${header}\n${divider}\n\n${rows.join("\n\n")}\n\n${divider}\nPackage = RT + (ET - Dial)`;
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

            <div className="hidden sm:grid grid-cols-12 gap-2 px-6 py-3 border-b border-nhra-border text-xs text-gray-500 font-medium uppercase tracking-wider">
              <div className="col-span-3">Category</div>
              <div className="col-span-3">Name</div>
              <div className="col-span-2">Car #</div>
              <div className="col-span-2">Membership #</div>
              <div className="col-span-2 text-right">Package</div>
            </div>

            <div className="divide-y divide-nhra-border">
              {blpWinners.map((w) => (
                <div key={w.category} className="px-6 py-3">
                  <div className="hidden sm:grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-3 text-white font-medium">{w.category}</div>
                    <div className="col-span-3">
                      <Link
                        href={`/racer/${encodeURIComponent(w.name)}`}
                        className="text-white font-semibold hover:text-nhra-accent transition-colors"
                      >
                        {w.name}
                      </Link>
                    </div>
                    <div className="col-span-2 text-nhra-accent font-bold">#{w.car_number}</div>
                    <div className="col-span-2 text-gray-500">—</div>
                    <div className="col-span-2 text-right font-mono text-white font-bold">
                      {w.package.toFixed(4)}
                    </div>
                  </div>
                  <div className="sm:hidden">
                    <p className="text-white font-medium">{w.category}</p>
                    <p className="text-sm text-gray-300">{w.name} &middot; #{w.car_number} &middot; Pkg: {w.package.toFixed(4)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {searched && !loading && Object.keys(results).length === 0 && (
        <div className="bg-nhra-card border-2 border-gray-600/30 rounded-xl px-6 py-10 text-center">
          <p className="text-gray-400 font-bold text-lg mb-1">No Losing Package Results</p>
          <p className="text-gray-500 text-sm">
            No losing runs with valid RT, ET, and dial-in found for the selected rounds and classes.
            Heads-up classes (Top Fuel, Funny Car, etc.) typically don&apos;t have dial-ins.
          </p>
        </div>
      )}

      {searched && !loading && Object.keys(results).length > 0 && (
        <div className="space-y-6">
          {Object.entries(results).map(([category, entries]) => (
            <div key={category} className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden">
              <div className="px-6 py-4 bg-nhra-darker border-b border-nhra-border flex items-center justify-between">
                <h3 className="text-white font-bold text-lg">{category}</h3>
                <span className="px-3 py-1 bg-nhra-red/20 text-nhra-red text-xs font-bold rounded-full">
                  Top {entries.length}
                </span>
              </div>

              {/* Header */}
              <div className="hidden sm:grid grid-cols-12 gap-2 px-6 py-3 border-b border-nhra-border text-xs text-gray-500 font-medium uppercase tracking-wider">
                <div className="col-span-1">#</div>
                <div className="col-span-3">Racer</div>
                <div className="col-span-1 text-right">Round</div>
                <div className="col-span-2 text-right">RT</div>
                <div className="col-span-1 text-right">ET</div>
                <div className="col-span-1 text-right">Dial</div>
                <div className="col-span-1 text-right">Diff</div>
                <div className="col-span-2 text-right">Package</div>
              </div>

              <div className="divide-y divide-nhra-border">
                {entries.map((entry, idx) => (
                  <div
                    key={`${entry.name}-${entry.round}-${entry.timestamp}`}
                    className={`px-6 py-4 ${idx === 0 ? "bg-yellow-500/5" : ""}`}
                  >
                    {/* Desktop */}
                    <div className="hidden sm:grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-1">
                        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-bold ${
                          idx === 0 ? "bg-yellow-500/20 text-yellow-400" :
                          idx === 1 ? "bg-gray-400/20 text-gray-300" :
                          idx === 2 ? "bg-orange-600/20 text-orange-400" :
                          "bg-nhra-darker text-gray-500"
                        }`}>
                          {idx + 1}
                        </span>
                      </div>
                      <div className="col-span-3 min-w-0">
                        <Link
                          href={`/racer/${encodeURIComponent(entry.name)}`}
                          className="text-white font-semibold hover:text-nhra-accent transition-colors truncate block"
                        >
                          {entry.name}
                        </Link>
                        <p className="text-xs text-nhra-accent font-bold">#{entry.car_number}</p>
                      </div>
                      <div className="col-span-1 text-right text-gray-400 text-sm">
                        {entry.round === "F" ? "Final" : entry.round.replace("E", "R")}
                      </div>
                      <div className="col-span-2 text-right text-white font-mono text-sm">
                        {entry.rt.toFixed(4)}
                      </div>
                      <div className="col-span-1 text-right text-gray-300 font-mono text-sm">
                        {entry.ft1320.toFixed(3)}
                      </div>
                      <div className="col-span-1 text-right text-gray-400 font-mono text-sm">
                        {entry.dial_in.toFixed(3)}
                      </div>
                      <div className="col-span-1 text-right text-gray-400 font-mono text-sm">
                        +{entry.diff.toFixed(4)}
                      </div>
                      <div className="col-span-2 text-right">
                        <span className={`inline-block px-3 py-1 rounded-lg font-bold font-mono text-sm ${
                          idx === 0 ? "bg-yellow-500/15 text-yellow-400" : "bg-nhra-darker text-white"
                        }`}>
                          {entry.package.toFixed(4)}
                        </span>
                      </div>
                    </div>

                    {/* Mobile */}
                    <div className="sm:hidden">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-bold ${
                            idx === 0 ? "bg-yellow-500/20 text-yellow-400" :
                            idx === 1 ? "bg-gray-400/20 text-gray-300" :
                            idx === 2 ? "bg-orange-600/20 text-orange-400" :
                            "bg-nhra-darker text-gray-500"
                          }`}>
                            {idx + 1}
                          </span>
                          <div>
                            <Link
                              href={`/racer/${encodeURIComponent(entry.name)}`}
                              className="text-white font-semibold hover:text-nhra-accent transition-colors"
                            >
                              {entry.name}
                            </Link>
                            <p className="text-xs text-nhra-accent font-bold">#{entry.car_number}</p>
                          </div>
                        </div>
                        <span className={`px-3 py-1 rounded-lg font-bold font-mono text-sm ${
                          idx === 0 ? "bg-yellow-500/15 text-yellow-400" : "bg-nhra-darker text-white"
                        }`}>
                          {entry.package.toFixed(4)}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-xs ml-10">
                        <div>
                          <span className="text-gray-500">RT</span>
                          <p className="text-white font-mono">{entry.rt.toFixed(4)}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">ET</span>
                          <p className="text-gray-300 font-mono">{entry.ft1320.toFixed(3)}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Dial</span>
                          <p className="text-gray-400 font-mono">{entry.dial_in.toFixed(3)}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Round</span>
                          <p className="text-gray-400">{entry.round === "F" ? "Final" : entry.round.replace("E", "R")}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Legend */}
          <div className="bg-nhra-card border border-nhra-border rounded-xl p-5">
            <h4 className="text-sm font-bold text-gray-400 mb-3 uppercase tracking-wider">How Package is Calculated</h4>
            <div className="text-sm text-gray-500 space-y-1">
              <p><span className="text-white font-mono">Package</span> = Reaction Time + (ET - Dial-In)</p>
              <p>Lower is better. A perfect package would be 0.000 RT with ET exactly on the dial.</p>
              <p>Breakouts (ET faster than dial-in) are excluded.</p>
            </div>
          </div>
        </div>
      )}

      {!searched && !loading && (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-12 text-center text-gray-500">
          Select an event, pick elimination rounds and classes, then search to find the best losing packages
        </div>
      )}
    </div>
  );
}
