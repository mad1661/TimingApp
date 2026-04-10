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

interface RacerSlot {
  query: string;
  suggestions: RacerSuggestion[];
  showSuggestions: boolean;
  results: TechCardResult[];
  loading: boolean;
  searched: boolean;
}

const emptySlot = (): RacerSlot => ({
  query: "",
  suggestions: [],
  showSuggestions: false,
  results: [],
  loading: false,
  searched: false,
});

const FIELD_LABELS: { key: keyof TechCardResult; label: string }[] = [
  { key: "car_number", label: "Car Number" },
  { key: "category", label: "Category" },
  { key: "class_name", label: "Class" },
  { key: "member_number", label: "Member #" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "engine_make", label: "Engine" },
  { key: "body_type", label: "Body" },
  { key: "hp", label: "HP" },
  { key: "owner", label: "Owner" },
  { key: "crew_chief", label: "Crew Chief" },
];

export default function RacerProfilePage() {
  const live = useLiveData();
  const [slots, setSlots] = useState<RacerSlot[]>([emptySlot()]);
  const searchRefs = useRef<(HTMLDivElement | null)[]>([]);
  const justSelectedRefs = useRef<boolean[]>([false]);

  const eventQS = live.config?.eventCode
    ? `&event_code=${encodeURIComponent(live.config.eventCode)}&season=${encodeURIComponent(live.config.season || "")}`
    : "";

  function updateSlot(idx: number, updates: Partial<RacerSlot>) {
    setSlots(prev => prev.map((s, i) => i === idx ? { ...s, ...updates } : s));
  }

  const searchRacers = useCallback(async (q: string, idx: number) => {
    if (justSelectedRefs.current[idx]) { justSelectedRefs.current[idx] = false; return; }
    if (q.length < 1) { updateSlot(idx, { suggestions: [], showSuggestions: false }); return; }
    if (!eventQS) return;
    try {
      const res = await fetch(`/api/stats?type=racers&search=${encodeURIComponent(q)}${eventQS}`);
      const data = await res.json();
      let sugs: RacerSuggestion[];
      if (data.racerDetails) {
        sugs = data.racerDetails;
      } else {
        sugs = (data.racers || []).map((n: string) => ({ name: n, car_number: "", category: "" }));
      }
      updateSlot(idx, { suggestions: sugs, showSuggestions: true });
    } catch {
      updateSlot(idx, { suggestions: [] });
    }
  }, [eventQS]);

  // Debounced search for each slot
  useEffect(() => {
    const timers = slots.map((slot, idx) => {
      return setTimeout(() => searchRacers(slot.query, idx), 300);
    });
    return () => timers.forEach(clearTimeout);
  }, [slots.map(s => s.query).join("|"), searchRacers]);

  // Click outside to close suggestions
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      setSlots(prev => prev.map((s, i) => {
        if (s.showSuggestions && searchRefs.current[i] && !searchRefs.current[i]!.contains(e.target as Node)) {
          return { ...s, showSuggestions: false };
        }
        return s;
      }));
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function doSearch(idx: number, nameOverride?: string) {
    const q = nameOverride || slots[idx].query.trim();
    if (!q) return;
    justSelectedRefs.current[idx] = true;
    updateSlot(idx, { query: q, showSuggestions: false, loading: true, searched: true });
    try {
      const res = await fetch(`/api/tech-cards?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      updateSlot(idx, { results: data.results || [], loading: false });
    } catch {
      updateSlot(idx, { results: [], loading: false });
    }
  }

  function addSlot() {
    if (slots.length >= 4) return;
    justSelectedRefs.current.push(false);
    setSlots(prev => [...prev, emptySlot()]);
  }

  function removeSlot(idx: number) {
    if (slots.length <= 1) return;
    justSelectedRefs.current.splice(idx, 1);
    setSlots(prev => prev.filter((_, i) => i !== idx));
  }

  // Collect loaded racers for side-by-side comparison
  const loadedRacers = slots
    .map((s, i) => ({ slot: s, idx: i }))
    .filter(({ slot }) => slot.searched && !slot.loading && slot.results.length > 0);

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Racer Profile</h1>
        <p className="text-gray-400">Compare up to 4 racers side by side</p>
      </div>

      {/* Search slots */}
      <div className={`grid gap-4 mb-6 ${slots.length === 1 ? "grid-cols-1" : slots.length === 2 ? "grid-cols-1 md:grid-cols-2" : slots.length === 3 ? "grid-cols-1 md:grid-cols-3" : "grid-cols-1 md:grid-cols-2 xl:grid-cols-4"}`}>
        {slots.map((slot, idx) => (
          <div key={idx} className="bg-nhra-card border border-nhra-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-500 uppercase tracking-wider">Racer {idx + 1}</span>
              {slots.length > 1 && (
                <button
                  onClick={() => removeSlot(idx)}
                  className="text-gray-600 hover:text-red-400 transition-colors"
                  title="Remove"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            <div ref={el => { searchRefs.current[idx] = el; }} className="relative">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={slot.query}
                  onChange={(e) => updateSlot(idx, { query: e.target.value })}
                  onFocus={() => { if (slot.suggestions.length > 0) updateSlot(idx, { showSuggestions: true }); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); doSearch(idx); } }}
                  placeholder="Name or car #..."
                  className="flex-1 px-3 py-2.5 bg-nhra-darker border border-nhra-border rounded-lg text-white text-sm placeholder-gray-600 focus:outline-none focus:border-nhra-accent"
                />
                <button
                  onClick={() => doSearch(idx)}
                  disabled={slot.loading}
                  className="px-4 py-2.5 bg-nhra-red hover:bg-nhra-red/80 text-white font-bold rounded-lg text-sm transition-colors disabled:opacity-50"
                >
                  {slot.loading ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  )}
                </button>
              </div>
              {slot.showSuggestions && slot.suggestions.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-nhra-dark border border-nhra-border rounded-lg shadow-xl max-h-60 overflow-y-auto">
                  {slot.suggestions.map((s, i) => (
                    <button
                      key={`${s.name}-${s.car_number}-${i}`}
                      onClick={() => doSearch(idx, s.name)}
                      className="w-full px-3 py-2.5 text-left hover:bg-nhra-card transition-colors flex items-center justify-between border-b border-nhra-border/30 last:border-0"
                    >
                      <div>
                        <span className="text-white text-sm font-medium">{s.name}</span>
                        {s.car_number && (
                          <span className="text-nhra-accent text-xs ml-2 font-bold">#{s.car_number}</span>
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
            {/* Inline result preview */}
            {slot.searched && !slot.loading && slot.results.length > 0 && (
              <div className="mt-3 pt-3 border-t border-nhra-border/50">
                <Link
                  href={`/racer/${encodeURIComponent(`${slot.results[0].first_name} ${slot.results[0].last_name}`)}`}
                  className="text-white font-bold hover:text-nhra-accent transition-colors"
                >
                  {slot.results[0].first_name} {slot.results[0].last_name}
                </Link>
                <p className="text-nhra-accent text-xs font-bold">#{slot.results[0].car_number}</p>
                <p className="text-gray-500 text-xs">{slot.results[0].category}</p>
              </div>
            )}
            {slot.searched && !slot.loading && slot.results.length === 0 && (
              <p className="mt-3 text-xs text-gray-600">No results</p>
            )}
          </div>
        ))}

        {/* Add racer button */}
        {slots.length < 4 && (
          <button
            onClick={addSlot}
            className="bg-nhra-card border-2 border-dashed border-nhra-border rounded-xl p-4 flex flex-col items-center justify-center gap-2 text-gray-500 hover:text-white hover:border-nhra-accent/30 transition-colors min-h-[120px]"
          >
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v12m6-6H6" />
            </svg>
            <span className="text-sm font-medium">Add Racer</span>
          </button>
        )}
      </div>

      {/* Side-by-side comparison table */}
      {loadedRacers.length > 1 && (
        <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden mb-6">
          <div className="px-6 py-4 bg-nhra-darker border-b border-nhra-border">
            <h2 className="text-white font-bold text-lg">Side-by-Side Comparison</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-nhra-border text-gray-400 text-xs uppercase tracking-wider">
                  <th className="px-6 py-3 text-left w-32"></th>
                  {loadedRacers.map(({ slot }) => (
                    <th key={slot.results[0].car_number + slot.results[0].last_name} className="px-6 py-3 text-left">
                      <Link
                        href={`/racer/${encodeURIComponent(`${slot.results[0].first_name} ${slot.results[0].last_name}`)}`}
                        className="text-white font-bold text-base normal-case hover:text-nhra-accent transition-colors"
                      >
                        {slot.results[0].first_name} {slot.results[0].last_name}
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FIELD_LABELS.map(({ key, label }) => {
                  const hasAny = loadedRacers.some(({ slot }) => slot.results[0][key]);
                  if (!hasAny) return null;
                  return (
                    <tr key={key} className="border-b border-nhra-border/30">
                      <td className="px-6 py-3 text-gray-500 font-medium whitespace-nowrap">{label}</td>
                      {loadedRacers.map(({ slot }) => (
                        <td key={slot.results[0].car_number + slot.results[0].last_name + key} className="px-6 py-3 text-white font-mono">
                          {key === "car_number" ? `#${slot.results[0][key]}` : slot.results[0][key] || "\u2014"}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Single racer full cards (when only 1 loaded) */}
      {loadedRacers.length === 1 && (
        <div className="space-y-4">
          {loadedRacers[0].slot.results.map((r, i) => (
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
