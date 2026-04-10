"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useLiveData } from "@/components/LiveDataProvider";
import RacerDetailPanel from "@/components/RacerDetailPanel";

interface RacerSuggestion {
  name: string;
  car_number: string;
  category: string;
}

interface RacerSlot {
  query: string;
  suggestions: RacerSuggestion[];
  showSuggestions: boolean;
  selectedName: string | null;
}

const emptySlot = (): RacerSlot => ({
  query: "",
  suggestions: [],
  showSuggestions: false,
  selectedName: null,
});

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

  useEffect(() => {
    const timers = slots.map((slot, idx) =>
      setTimeout(() => {
        if (!slot.selectedName || slot.query !== slot.selectedName) {
          searchRacers(slot.query, idx);
        }
      }, 300)
    );
    return () => timers.forEach(clearTimeout);
  }, [slots.map(s => s.query).join("|"), searchRacers]);

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

  function selectRacer(idx: number, name: string) {
    justSelectedRefs.current[idx] = true;
    updateSlot(idx, { query: name, selectedName: name, showSuggestions: false });
  }

  function addSlot() {
    if (slots.length >= 4) return;
    justSelectedRefs.current.push(false);
    setSlots(prev => [...prev, emptySlot()]);
  }

  function removeSlot(idx: number) {
    if (slots.length <= 1) {
      updateSlot(idx, { query: "", selectedName: null, suggestions: [], showSuggestions: false });
      return;
    }
    justSelectedRefs.current.splice(idx, 1);
    setSlots(prev => prev.filter((_, i) => i !== idx));
  }

  function startNew() {
    justSelectedRefs.current = [false];
    setSlots([emptySlot()]);
  }

  function addRacerByName(name: string) {
    // If already shown, don't duplicate
    if (slots.some(s => s.selectedName === name)) return;
    // Find an empty slot first
    const emptyIdx = slots.findIndex(s => !s.selectedName);
    if (emptyIdx >= 0) {
      justSelectedRefs.current[emptyIdx] = true;
      updateSlot(emptyIdx, { query: name, selectedName: name, showSuggestions: false });
      return;
    }
    // Add a new slot if under 4
    if (slots.length < 4) {
      justSelectedRefs.current.push(true);
      setSlots(prev => [...prev, { query: name, selectedName: name, suggestions: [], showSuggestions: false }]);
    }
  }

  const selectedCount = slots.filter(s => s.selectedName).length;

  return (
    <div className="max-w-[1800px] mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Racer Profile</h1>
          <p className="text-gray-400">Look up and compare up to 4 racers side by side</p>
        </div>
        {selectedCount > 0 && (
          <button
            onClick={startNew}
            className="px-4 py-2.5 bg-nhra-darker border border-nhra-border text-gray-400 rounded-lg text-sm font-medium hover:text-white hover:border-gray-500 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v12m6-6H6" />
            </svg>
            Start New
          </button>
        )}
      </div>

      {/* Search bar area */}
      <div className="bg-nhra-card border border-nhra-border rounded-xl p-4 mb-6">
        <div className="flex flex-wrap items-end gap-3">
          {slots.map((slot, idx) => (
            <div key={idx} className="flex-1 min-w-[200px] max-w-[350px]">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-500">Racer {idx + 1}</span>
                {(slots.length > 1 || slot.selectedName) && (
                  <button onClick={() => removeSlot(idx)} className="text-gray-600 hover:text-red-400 transition-colors" title="Clear">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              <div ref={el => { searchRefs.current[idx] = el; }} className="relative">
                <input
                  type="text"
                  autoComplete="off"
                  value={slot.query}
                  onChange={(e) => updateSlot(idx, { query: e.target.value, selectedName: null })}
                  onFocus={() => { if (slot.suggestions.length > 0 && !slot.selectedName) updateSlot(idx, { showSuggestions: true }); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && slot.suggestions.length > 0) {
                      e.preventDefault();
                      selectRacer(idx, slot.suggestions[0].name);
                    }
                  }}
                  placeholder="Name or car #..."
                  className={`w-full px-3 py-2.5 bg-nhra-darker border rounded-lg text-white text-sm placeholder-gray-600 focus:outline-none focus:border-nhra-accent ${
                    slot.selectedName ? "border-green-500/50" : "border-nhra-border"
                  }`}
                />
                {slot.showSuggestions && slot.suggestions.length > 0 && (
                  <div className="absolute z-50 w-full mt-1 bg-nhra-dark border border-nhra-border rounded-lg shadow-xl max-h-60 overflow-y-auto">
                    {slot.suggestions.map((s, i) => (
                      <button
                        key={`${s.name}-${s.car_number}-${i}`}
                        onClick={() => selectRacer(idx, s.name)}
                        className="w-full px-3 py-2.5 text-left hover:bg-nhra-card transition-colors flex items-center justify-between border-b border-nhra-border/30 last:border-0"
                      >
                        <div>
                          <span className="text-white text-sm font-medium">{s.name}</span>
                          {s.car_number && <span className="text-nhra-accent text-xs ml-2 font-bold">#{s.car_number}</span>}
                        </div>
                        {s.category && <span className="text-gray-500 text-xs">{s.category}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {slots.length < 4 && (
            <button
              onClick={addSlot}
              className="px-4 py-2.5 border-2 border-dashed border-nhra-border rounded-lg text-gray-500 hover:text-white hover:border-nhra-accent/30 transition-colors text-sm font-medium flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v12m6-6H6" />
              </svg>
              Add Racer
            </button>
          )}
        </div>
      </div>

      {/* Racer detail panels side by side */}
      {selectedCount > 0 && (
        <div className={`grid gap-6 ${
          selectedCount === 1 ? "grid-cols-1 max-w-4xl" :
          selectedCount === 2 ? "grid-cols-1 lg:grid-cols-2" :
          selectedCount === 3 ? "grid-cols-1 lg:grid-cols-3" :
          "grid-cols-1 lg:grid-cols-2 xl:grid-cols-4"
        }`}>
          {slots.filter(s => s.selectedName).map((slot) => (
            <div key={slot.selectedName} className="min-w-0">
              <RacerDetailPanel name={slot.selectedName!} compact={selectedCount > 1} onRacerClick={addRacerByName} />
            </div>
          ))}
        </div>
      )}

      {selectedCount === 0 && (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-12 text-center text-gray-500">
          Search for a racer above to see their full profile with stats, charts, and run history
        </div>
      )}
    </div>
  );
}
