"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import TimeslipCard from "@/components/TimeslipCard";
import type { TimeslipRun } from "@/components/TimeslipCard";
import { useLiveData } from "@/components/LiveDataProvider";

interface OpponentData {
  name: string | null;
  car_number: string | null;
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
  result?: string | null;
  lane: string | null;
  dial_in: number | null;
}

interface RunRow extends TimeslipRun {
  id?: string;
  opponents?: OpponentData[];
}

interface RacerSuggestion {
  name: string;
  car_number: string;
}

export default function TimeslipPage() {
  const live = useLiveData();
  const [search, setSearch] = useState("");
  const [searchMode, setSearchMode] = useState<"name" | "car">("car");
  const [suggestions, setSuggestions] = useState<RacerSuggestion[]>([]);
  const [selectedRacer, setSelectedRacer] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [selectedRun, setSelectedRun] = useState<RunRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const justSelectedRef = useRef(false);

  const eventQS = live.config?.eventCode
    ? `&event_code=${encodeURIComponent(live.config.eventCode)}&season=${encodeURIComponent(live.config.season || "")}`
    : "";

  const searchRacers = useCallback(async (q: string) => {
    if (justSelectedRef.current) { justSelectedRef.current = false; return; }
    if (q.length < 1) { setSuggestions([]); return; }
    if (!eventQS) { return; } // Wait for event context before searching
    try {
      const res = await fetch(`/api/stats?type=racers&search=${encodeURIComponent(q)}${eventQS}`);
      const data = await res.json();
      if (data.racerDetails) {
        setSuggestions(data.racerDetails);
      } else {
        setSuggestions((data.racers || []).map((n: string) => ({ name: n, car_number: "" })));
      }
      setShowSuggestions(true);
    } catch { setSuggestions([]); }
  }, [eventQS]);

  useEffect(() => {
    const timer = setTimeout(() => searchRacers(search), 300);
    return () => clearTimeout(timer);
  }, [search, searchRacers]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function loadRacerRuns(name: string, displayText?: string) {
    justSelectedRef.current = true;
    setSelectedRacer(name);
    setSearch(displayText || name);
    setShowSuggestions(false);
    setLoading(true);
    setSelectedRun(null);
    try {
      const res = await fetch(`/api/stats?type=racer&name=${encodeURIComponent(name)}${eventQS}`);
      const data = await res.json();
      setRuns(data.runs || []);
    } catch { setRuns([]); }
    setLoading(false);
  }

  async function loadCarNumberRuns(carNumber: string) {
    justSelectedRef.current = true;
    setSelectedRacer(`#${carNumber}`);
    setSearch(carNumber);
    setShowSuggestions(false);
    setLoading(true);
    setSelectedRun(null);
    try {
      const res = await fetch(`/api/stats?type=car_runs&car_number=${encodeURIComponent(carNumber)}${eventQS}`);
      const data = await res.json();
      setRuns(data.runs || []);
    } catch { setRuns([]); }
    setLoading(false);
  }

  function handlePrint() {
    window.print();
  }

  function buildAllRunners(run: RunRow): TimeslipRun[] {
    const runners: TimeslipRun[] = [run];
    for (const opp of run.opponents || []) {
      runners.push({
        timestamp: run.timestamp,
        round: run.round,
        car_number: opp.car_number,
        name: opp.name,
        class_index: run.class_index,
        rt: opp.rt,
        ft60: opp.ft60,
        ft330: opp.ft330,
        ft660: opp.ft660,
        mph_660: opp.mph_660,
        ft1000: opp.ft1000,
        mph_1000: opp.mph_1000,
        ft1320: opp.ft1320,
        mph_1320: opp.mph_1320,
        mov: opp.mov,
        is_winner: opp.is_winner,
        is_dq: opp.is_dq,
        result: opp.result ?? null,
        category: run.category,
        lane: opp.lane,
        dial_in: opp.dial_in,
        event_name: run.event_name,
        event_code: run.event_code,
        season: run.season,
      });
    }
    // Sort by lane: L first, R last, or numerically
    return runners.sort((a, b) => {
      const la = a.lane || "";
      const lb = b.lane || "";
      if (la === "L") return -1;
      if (lb === "L") return 1;
      if (la === "R") return 1;
      if (lb === "R") return -1;
      return la.localeCompare(lb);
    });
  }

  const filteredSuggestions = suggestions;

  // Get unique car numbers for the "show all" options in car mode
  const uniqueCarNumbers = searchMode === "car"
    ? [...new Set(filteredSuggestions.map((s) => s.car_number).filter(Boolean))]
    : [];

  return (
    <div className="max-w-6xl mx-auto">
      {/* Screen-only header and controls */}
      <div className="print:hidden">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Timeslip</h1>
          <p className="text-gray-400">Search by racer name or car number to view and print timeslips</p>
        </div>

        {/* Search */}
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-5 mb-6">
          <div className="flex gap-3 mb-3">
            <button
              onClick={() => { setSearchMode("name"); setSearch(""); setSuggestions([]); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${searchMode === "name" ? "bg-nhra-red text-white" : "bg-nhra-darker text-gray-400 hover:text-white border border-nhra-border"}`}
            >
              Search by Name
            </button>
            <button
              onClick={() => { setSearchMode("car"); setSearch(""); setSuggestions([]); }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${searchMode === "car" ? "bg-nhra-red text-white" : "bg-nhra-darker text-gray-400 hover:text-white border border-nhra-border"}`}
            >
              Search by Car #
            </button>
          </div>
          <div ref={searchRef} className="relative">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => filteredSuggestions.length > 0 && setShowSuggestions(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && search.trim()) {
                  if (searchMode === "car") {
                    loadCarNumberRuns(search.trim());
                  } else {
                    // In name mode, select first suggestion or search directly
                    if (filteredSuggestions.length > 0) {
                      loadRacerRuns(filteredSuggestions[0].name);
                    }
                  }
                }
              }}
              placeholder={searchMode === "name" ? "Type racer name..." : "Type car number (press Enter to search)..."}
              className="w-full px-4 py-3 bg-nhra-darker border border-nhra-border rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-nhra-accent text-lg"
            />
            {showSuggestions && filteredSuggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-nhra-card border border-nhra-border rounded-lg shadow-xl z-20 max-h-64 overflow-y-auto">
                {searchMode === "car" && uniqueCarNumbers.map((cn) => {
                  const driversForCar = filteredSuggestions.filter((s) => s.car_number === cn);
                  return (
                    <div key={`car-group-${cn}`}>
                      <button
                        onClick={() => loadCarNumberRuns(cn)}
                        className="w-full text-left px-4 py-3 text-white hover:bg-nhra-red/20 transition-colors text-sm border-b border-nhra-border/30 flex justify-between items-center bg-nhra-darker/50"
                      >
                        <span className="font-bold">#{cn}</span>
                        <span className="text-gray-400 text-xs">All runs ({driversForCar.length} {driversForCar.length === 1 ? "driver" : "drivers"})</span>
                      </button>
                      {driversForCar.length > 1 && driversForCar.map((s) => (
                        <button
                          key={`${s.name}-${s.car_number}`}
                          onClick={() => loadRacerRuns(s.name, `#${s.car_number} — ${s.name}`)}
                          className="w-full text-left px-4 py-3 pl-8 text-white hover:bg-nhra-border/30 transition-colors text-sm border-b border-nhra-border/30 last:border-0 flex justify-between items-center"
                        >
                          <span className="text-gray-300">{s.name}</span>
                        </button>
                      ))}
                    </div>
                  );
                })}
                {searchMode === "name" && filteredSuggestions.map((s) => (
                  <button
                    key={`${s.name}-${s.car_number}`}
                    onClick={() => loadRacerRuns(s.name)}
                    className="w-full text-left px-4 py-3 text-white hover:bg-nhra-border/30 transition-colors text-sm border-b border-nhra-border/30 last:border-0 flex justify-between items-center"
                  >
                    <span className="font-medium">{s.name}</span>
                    {s.car_number && <span className="text-gray-500 text-xs">#{s.car_number}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Run selector */}
        {selectedRacer && (
          <div className="bg-nhra-card border border-nhra-border rounded-xl p-5 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">
                {selectedRacer} &mdash; {runs.length} runs
              </h2>
              {!selectedRacer?.startsWith("#") && (
                <Link
                  href={`/racer/${encodeURIComponent(selectedRacer)}`}
                  className="text-xs text-nhra-accent hover:underline"
                >
                  View full profile
                </Link>
              )}
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-8 h-8 border-3 border-nhra-red border-t-transparent rounded-full animate-spin" />
              </div>
            ) : runs.length === 0 ? (
              <p className="text-gray-500 text-center py-6">No runs found</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-nhra-border text-gray-400 text-xs uppercase tracking-wider">
                      <th className="p-2"></th>
                      <th className="text-left p-2">Date</th>
                      {selectedRacer?.startsWith("#") && <th className="text-left p-2">Racer</th>}
                      <th className="text-left p-2">Cat</th>
                      <th className="text-left p-2">Rnd</th>
                      <th className="text-right p-2">RT</th>
                      <th className="text-right p-2">ET</th>
                      <th className="text-right p-2">MPH</th>
                      <th className="text-center p-2">W</th>
                      <th className="text-left p-2">Opponents</th>
                      <th className="text-right p-2">Event</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((run, i) => (
                      <tr
                        key={run.id || i}
                        onClick={() => setSelectedRun(run)}
                        className={`border-b border-nhra-border/50 cursor-pointer transition-colors ${
                          selectedRun?.id === run.id
                            ? "bg-nhra-red/10 border-l-2 border-l-nhra-red"
                            : "hover:bg-nhra-border/20"
                        }`}
                      >
                        <td className="p-2">
                          <button className="text-xs text-nhra-accent hover:underline">Select</button>
                        </td>
                        <td className="p-2 text-gray-300 whitespace-nowrap text-xs">{run.timestamp?.split(" ")[0] ?? "-"}</td>
                        {selectedRacer?.startsWith("#") && <td className="p-2 text-white text-xs whitespace-nowrap">{run.name || "-"}</td>}
                        <td className="p-2 text-gray-300 text-xs">{run.category}</td>
                        <td className="p-2 text-gray-300">{run.round}</td>
                        <td className="p-2 text-right font-mono text-gray-300">{run.rt?.toFixed(3) ?? "-"}</td>
                        <td className="p-2 text-right font-mono text-white font-medium">{run.ft1320?.toFixed(3) ?? "-"}</td>
                        <td className="p-2 text-right font-mono text-gray-300">{run.mph_1320?.toFixed(2) ?? "-"}</td>
                        <td className="p-2 text-center">
                          {(() => {
                            const r = run.result?.trim().toUpperCase();
                            if (r === "W" || (!r && run.is_winner)) return <span className="text-green-400 font-bold text-xs">W</span>;
                            if (r === "R") return <span className="text-blue-400 font-bold text-xs">R</span>;
                            if (r === "3") return <span className="text-gray-400 font-bold text-xs">3</span>;
                            if (r === "4") return <span className="text-gray-500 font-bold text-xs">4</span>;
                            return <span className="text-gray-600">-</span>;
                          })()}
                        </td>
                        <td className="p-2 text-gray-400 text-xs whitespace-nowrap">
                          {run.opponents && run.opponents.length > 0 ? (
                            run.opponents.map((opp, oi) => (
                              <span key={oi}>
                                {oi > 0 && <span className="text-gray-600">, </span>}
                                {opp.name ? (
                                  <Link href={`/racer/${encodeURIComponent(opp.name)}`} className="hover:text-nhra-accent transition-colors">
                                    {opp.name}
                                  </Link>
                                ) : "—"}
                              </span>
                            ))
                          ) : "—"}
                        </td>
                        <td className="p-2 text-white whitespace-nowrap text-xs text-right">{run.event_name || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Print button */}
        {selectedRun && (
          <div className="flex items-center gap-4 mb-6">
            <button
              onClick={handlePrint}
              className="px-6 py-3 bg-nhra-red text-white rounded-lg font-semibold hover:bg-red-700 transition-colors flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Print Timeslip
            </button>
            <span className="text-sm text-gray-500">
              {selectedRun.name} vs {selectedRun.opponents?.map((o) => o.name).filter(Boolean).join(", ") || "Bye"} &mdash; {selectedRun.round} &mdash; {selectedRun.timestamp?.split(" ")[0]}
            </span>
          </div>
        )}
      </div>

      {/* Timeslip Preview / Print Area */}
      {selectedRun && (
        <div className="flex justify-center print:block">
          <TimeslipCard runners={buildAllRunners(selectedRun)} />
        </div>
      )}

      {/* Empty state */}
      {!selectedRacer && !loading && (
        <div className="print:hidden bg-nhra-card border border-nhra-border rounded-xl p-12 text-center">
          <svg className="w-16 h-16 mx-auto text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-gray-400 text-lg">Search for a racer to generate their timeslip</p>
          <p className="text-gray-600 text-sm mt-2">Search by name or car number, then select a run to view side-by-side</p>
        </div>
      )}
    </div>
  );
}
