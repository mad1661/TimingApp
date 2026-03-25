"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useLiveData } from "@/components/LiveDataProvider";

interface RacerResult {
  name: string;
  car_number: string;
}

interface RunRow {
  timestamp: string | null;
  round: string | null;
  car_number: string | null;
  name: string | null;
  class_index: string | null;
  rt: number | null;
  ft60: number | null;
  ft1320: number | null;
  mph_1320: number | null;
  is_winner: number;
  category: string | null;
  lane: string | null;
  dial_in: number | null;
}

type SearchMode = "number" | "name";

export default function SearchPage() {
  const live = useLiveData();
  const [mode, setMode] = useState<SearchMode>("number");
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState<RacerResult[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [totalRuns, setTotalRuns] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const dropdownRef = useRef<HTMLDivElement>(null);

  const eventCode = live.config?.eventCode || "";
  const season = live.config?.season || "";

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const doSearch = useCallback((term: string) => {
    if (!eventCode || !season || term.length < 1) {
      setSuggestions([]);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/stats?type=racers&search=${encodeURIComponent(term)}&event_code=${encodeURIComponent(eventCode)}&season=${encodeURIComponent(season)}`
        );
        const data = await res.json();
        setSuggestions(data.racerDetails || []);
        setShowDropdown(true);
      } catch (err) {
        console.error(err);
      }
    }, 300);
  }, [eventCode, season]);

  function handleInputChange(value: string) {
    setSearch(value);
    setRuns([]);
    setSelectedLabel("");
    if (value.length >= 1) {
      doSearch(value);
    } else {
      setSuggestions([]);
      setShowDropdown(false);
    }
  }

  async function loadRunsByNumber(carNumber: string) {
    if (!eventCode || !season) return;
    setLoading(true);
    setSelectedLabel(`#${carNumber}`);
    try {
      const res = await fetch(
        `/api/runs?car_number=${encodeURIComponent(carNumber)}&event_code=${encodeURIComponent(eventCode)}&season=${encodeURIComponent(season)}&limit=500&sort_by=timestamp&sort_dir=DESC`
      );
      const data = await res.json();
      setRuns(data.runs || []);
      setTotalRuns(data.total || 0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function loadRunsByName(name: string) {
    if (!eventCode || !season) return;
    setLoading(true);
    setSelectedLabel(name);
    try {
      const res = await fetch(
        `/api/stats?type=racer&name=${encodeURIComponent(name)}&event_code=${encodeURIComponent(eventCode)}&season=${encodeURIComponent(season)}`
      );
      const data = await res.json();
      setRuns(data.runs || []);
      setTotalRuns(data.totalRuns || 0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function selectSuggestion(item: RacerResult, byNumber: boolean) {
    setShowDropdown(false);
    if (byNumber) {
      setSearch(item.car_number);
      loadRunsByNumber(item.car_number);
    } else {
      setSearch(item.name);
      loadRunsByName(item.name);
    }
  }

  // Group suggestions by car_number for "number" mode
  const numberGroups = new Map<string, RacerResult[]>();
  for (const s of suggestions) {
    if (!s.car_number) continue;
    const arr = numberGroups.get(s.car_number) || [];
    arr.push(s);
    numberGroups.set(s.car_number, arr);
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Search</h1>
        <p className="text-gray-400">Find racers by car number or name</p>
      </div>

      {/* Mode Toggle */}
      <div className="bg-nhra-card border border-nhra-border rounded-xl p-4 mb-6">
        <div className="flex gap-3 mb-4">
          <button
            onClick={() => { setMode("number"); setSearch(""); setSuggestions([]); setRuns([]); setSelectedLabel(""); }}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors border ${
              mode === "number"
                ? "bg-nhra-red/20 border-nhra-red/50 text-nhra-red"
                : "bg-nhra-darker border-nhra-border text-gray-500 hover:text-gray-300"
            }`}
          >
            By Number
          </button>
          <button
            onClick={() => { setMode("name"); setSearch(""); setSuggestions([]); setRuns([]); setSelectedLabel(""); }}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors border ${
              mode === "name"
                ? "bg-nhra-red/20 border-nhra-red/50 text-nhra-red"
                : "bg-nhra-darker border-nhra-border text-gray-500 hover:text-gray-300"
            }`}
          >
            By Name
          </button>
        </div>

        {/* Search Input */}
        <div className="relative" ref={dropdownRef}>
          <input
            type="text"
            value={search}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder={mode === "number" ? "Enter car number..." : "Enter racer name..."}
            className="w-full px-4 py-3 bg-nhra-darker border border-nhra-border rounded-lg text-white text-base placeholder-gray-600 focus:outline-none focus:border-nhra-accent"
          />

          {/* Dropdown */}
          {showDropdown && suggestions.length > 0 && (
            <div className="absolute z-20 w-full mt-1 bg-nhra-dark border border-nhra-border rounded-lg shadow-xl max-h-80 overflow-y-auto">
              {mode === "number" ? (
                // Number mode: group by car number, show "All runs for #X" + individual names
                Array.from(numberGroups.entries())
                  .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
                  .map(([num, racers]) => (
                  <div key={num}>
                    <button
                      onClick={() => { setShowDropdown(false); setSearch(num); loadRunsByNumber(num); }}
                      className="w-full px-4 py-3 text-left hover:bg-nhra-card transition-colors border-b border-nhra-border/30 flex items-center gap-3"
                    >
                      <span className="text-nhra-accent font-bold text-base">#{num}</span>
                      <span className="text-gray-400 text-sm">All runs ({racers.length} racer{racers.length !== 1 ? "s" : ""})</span>
                    </button>
                    {racers.map((r) => (
                      <button
                        key={`${r.car_number}-${r.name}`}
                        onClick={() => selectSuggestion(r, false)}
                        className="w-full px-4 py-2.5 pl-10 text-left hover:bg-nhra-card transition-colors border-b border-nhra-border/20 flex items-center gap-3"
                      >
                        <span className="text-nhra-accent font-bold text-sm">#{r.car_number}</span>
                        <span className="text-white text-sm">{r.name}</span>
                      </button>
                    ))}
                  </div>
                ))
              ) : (
                // Name mode: flat list with number and name
                suggestions.map((r) => (
                  <button
                    key={`${r.car_number}-${r.name}`}
                    onClick={() => selectSuggestion(r, false)}
                    className="w-full px-4 py-3 text-left hover:bg-nhra-card transition-colors border-b border-nhra-border/20 flex items-center gap-3"
                  >
                    <span className="text-nhra-accent font-bold text-sm">#{r.car_number}</span>
                    <span className="text-white">{r.name}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-10 h-10 border-4 border-nhra-red border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && selectedLabel && runs.length === 0 && (
        <div className="bg-nhra-card border-2 border-gray-600/30 rounded-xl px-6 py-10 text-center">
          <p className="text-gray-400 font-bold text-lg mb-1">No Runs Found</p>
          <p className="text-gray-500 text-sm">No runs found for {selectedLabel}</p>
        </div>
      )}

      {!loading && runs.length > 0 && (
        <div>
          <div className="bg-nhra-card border border-nhra-border rounded-xl px-6 py-4 mb-4 flex items-center justify-between">
            <span className="text-white font-bold text-lg">{selectedLabel}</span>
            <span className="text-gray-400 text-sm">{totalRuns} run{totalRuns !== 1 ? "s" : ""}</span>
          </div>

          <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-nhra-border text-gray-400 text-xs uppercase tracking-wider">
                    <th className="text-left p-3 pl-5">Time</th>
                    <th className="text-left p-3">Racer</th>
                    <th className="text-left p-3">Category</th>
                    <th className="text-left p-3">Round</th>
                    <th className="text-right p-3">RT</th>
                    <th className="text-right p-3">60ft</th>
                    <th className="text-right p-3">ET</th>
                    <th className="text-right p-3">MPH</th>
                    <th className="text-center p-3">W</th>
                    <th className="text-right p-3 pr-5">Dial</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run, i) => (
                    <tr key={i} className="border-b border-nhra-border/50 hover:bg-nhra-border/20">
                      <td className="p-3 pl-5 text-gray-500 whitespace-nowrap font-mono text-xs">{run.timestamp?.split(" ").slice(1).join(" ") || "-"}</td>
                      <td className="p-3 whitespace-nowrap">
                        {run.name ? (
                          <Link href={`/racer/${encodeURIComponent(run.name)}`} className="text-white hover:text-nhra-accent font-medium">
                            {run.name}
                          </Link>
                        ) : (
                          <span className="text-gray-500 italic">No Name</span>
                        )}
                        <span className="text-nhra-accent font-bold text-sm ml-2">#{run.car_number}</span>
                      </td>
                      <td className="p-3 text-gray-300 text-xs">{run.category}</td>
                      <td className="p-3 text-gray-300">{run.round}</td>
                      <td className="p-3 text-right font-mono text-gray-300">{run.rt?.toFixed(3) ?? "-"}</td>
                      <td className="p-3 text-right font-mono text-gray-400">{run.ft60?.toFixed(3) ?? "-"}</td>
                      <td className="p-3 text-right font-mono text-white font-medium">{run.ft1320?.toFixed(3) ?? "-"}</td>
                      <td className="p-3 text-right font-mono text-gray-300">{run.mph_1320?.toFixed(2) ?? "-"}</td>
                      <td className="p-3 text-center">
                        {run.is_winner ? <span className="text-green-400 font-bold text-xs">W</span> : <span className="text-gray-600">-</span>}
                      </td>
                      <td className="p-3 text-right font-mono text-gray-400 pr-5">{run.dial_in?.toFixed(2) ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {!selectedLabel && !loading && (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-12 text-center text-gray-500">
          Search by car number or racer name to view runs
        </div>
      )}
    </div>
  );
}
