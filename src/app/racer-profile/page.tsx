"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useLiveData } from "@/components/LiveDataProvider";

interface TechCardResult {
  car_number: string;
  first_name: string;
  last_name: string;
  category: string;
  class_name: string;
  member_number: string;
  city: string;
  state: string;
  engine_make: string;
  body_type: string;
  hp: string;
  owner: string;
  crew_chief: string;
}

interface RacerSuggestion {
  name: string;
  car_number: string;
  category: string;
}

export default function RacerProfilePage() {
  const live = useLiveData();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<RacerSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [results, setResults] = useState<TechCardResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const justSelectedRef = useRef(false);

  const eventQS = live.config?.eventCode
    ? `&event_code=${encodeURIComponent(live.config.eventCode)}&season=${encodeURIComponent(live.config.season || "")}`
    : "";

  const searchRacers = useCallback(async (q: string) => {
    if (justSelectedRef.current) { justSelectedRef.current = false; return; }
    if (q.length < 1) { setSuggestions([]); return; }
    if (!eventQS) return;
    try {
      const res = await fetch(`/api/stats?type=racers&search=${encodeURIComponent(q)}${eventQS}`);
      const data = await res.json();
      if (data.racerDetails) {
        setSuggestions(data.racerDetails);
      } else {
        setSuggestions((data.racers || []).map((n: string) => ({ name: n, car_number: "", category: "" })));
      }
      setShowSuggestions(true);
    } catch { setSuggestions([]); }
  }, [eventQS]);

  useEffect(() => {
    const timer = setTimeout(() => searchRacers(query), 300);
    return () => clearTimeout(timer);
  }, [query, searchRacers]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleSearch(nameOverride?: string) {
    const q = nameOverride || query.trim();
    if (!q) return;
    justSelectedRef.current = true;
    setQuery(q);
    setShowSuggestions(false);
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(`/api/tech-cards?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(data.results || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  function selectSuggestion(name: string) {
    handleSearch(name);
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Racer Profile</h1>
        <p className="text-gray-400">Search for a racer by name, car number, or category</p>
      </div>

      <div className="bg-nhra-card border border-nhra-border rounded-xl p-6 mb-6">
        <div className="flex gap-3" ref={searchRef}>
          <div className="flex-1 relative">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSearch(); } }}
              placeholder="Search by name, car number, or category..."
              className="w-full px-4 py-3 bg-nhra-darker border border-nhra-border rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-nhra-accent"
            />
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute z-50 w-full mt-1 bg-nhra-dark border border-nhra-border rounded-lg shadow-xl max-h-72 overflow-y-auto">
                {suggestions.map((s, i) => (
                  <button
                    key={`${s.name}-${s.car_number}-${i}`}
                    onClick={() => selectSuggestion(s.name)}
                    className="w-full px-4 py-3 text-left hover:bg-nhra-card transition-colors flex items-center justify-between border-b border-nhra-border/30 last:border-0"
                  >
                    <div>
                      <span className="text-white font-medium">{s.name}</span>
                      {s.car_number && (
                        <span className="text-nhra-accent text-sm ml-2 font-bold">#{s.car_number}</span>
                      )}
                    </div>
                    {s.category && (
                      <span className="text-gray-500 text-xs">{s.category}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => handleSearch()}
            disabled={loading}
            className="px-6 py-3 bg-nhra-red hover:bg-nhra-red/80 text-white font-bold rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="w-10 h-10 border-4 border-nhra-red border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && searched && results.length === 0 && (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-12 text-center text-gray-500">
          No racers found matching &quot;{query}&quot;
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="space-y-4">
          {results.map((r, i) => (
            <Link
              key={i}
              href={`/racer/${encodeURIComponent(`${r.first_name} ${r.last_name}`)}`}
              className="block bg-nhra-card border border-nhra-border rounded-xl p-5 hover:border-nhra-accent/50 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-bold text-white">{r.first_name} {r.last_name}</h3>
                  <div className="flex items-center gap-3 mt-1 text-sm text-gray-400">
                    <span className="text-nhra-accent font-bold">#{r.car_number}</span>
                    <span>{r.category}</span>
                    {r.class_name && <span className="text-gray-500">{r.class_name}</span>}
                  </div>
                </div>
                {r.member_number && (
                  <span className="text-xs text-gray-500 bg-nhra-darker px-2 py-1 rounded">Member #{r.member_number}</span>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-xs text-gray-500">
                {r.city && r.state && <span>{r.city}, {r.state}</span>}
                {r.engine_make && <span>Engine: {r.engine_make}</span>}
                {r.body_type && <span>Body: {r.body_type}</span>}
                {r.hp && <span>{r.hp} HP</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
