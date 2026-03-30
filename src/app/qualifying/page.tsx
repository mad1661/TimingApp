"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useLiveData } from "@/components/LiveDataProvider";

interface EventOption {
  event_code: string;
  event_name: string;
  season: string;
}

interface QualifyingEntry {
  position: number;
  name: string;
  car_number: string;
  category: string;
  et: number;
  mph: number | null;
  rt: number | null;
  dial_in: number | null;
  diff: number | null;
  round: string;
  timestamp: string;
  membership?: string;
}

const MODES = [
  { id: "quickest_et", label: "Quickest to Slowest", description: "Fastest ET wins" },
  { id: "closest_index_no_breakout", label: "Closest to Index (No Breakout)", description: "Closest to dial without going under" },
  { id: "closest_index_breakout_ok", label: "Closest to Index (Breakout OK)", description: "Closest to dial, going under is fine" },
  { id: "best_rt", label: "Best Reaction Time", description: "Lowest RT wins" },
  { id: "comp_eliminator", label: "Competition Eliminator", description: "Furthest under class index = #1. No breakout. First to post = tiebreaker." },
  { id: "stock_super_stock", label: "Stock / Super Stock", description: "Furthest under class index = #1. First to post = tiebreaker." },
];

export default function QualifyingPage() {
  const live = useLiveData();
  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedEvent, setSelectedEvent] = useState("");
  const [selectedEventName, setSelectedEventName] = useState("");
  const [selectedSeason, setSelectedSeason] = useState("");
  const [filtersLoading, setFiltersLoading] = useState(true);

  const [availableRounds, setAvailableRounds] = useState<string[]>([]);
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);

  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedRounds, setSelectedRounds] = useState<Set<string>>(new Set());
  const [selectedMode, setSelectedMode] = useState("quickest_et");
  const [tiebreaker, setTiebreaker] = useState<"mph" | "first_run">("mph");

  // Saved mode assignments per class
  const [classMode, setClassMode] = useState<Record<string, string>>({});
  const [savedTiebreaker, setSavedTiebreaker] = useState<"mph" | "first_run">("mph");
  const [configLoaded, setConfigLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  // Class index table for comp/stock modes
  const [classIndexes, setClassIndexes] = useState<Record<string, number>>({});
  const [classIndexDraft, setClassIndexDraft] = useState<Record<string, string>>({});
  const [showIndexEditor, setShowIndexEditor] = useState(false);
  const [savingIndexes, setSavingIndexes] = useState(false);
  const [classDesignations, setClassDesignations] = useState<string[]>([]);
  const [newClassDesig, setNewClassDesig] = useState("");

  const [results, setResults] = useState<QualifyingEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [copied, setCopied] = useState(false);

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
          setAvailableRounds(data.filters.rounds || []);
          setAvailableCategories(data.filters.categories || []);
        }
      })
      .catch(console.error)
      .finally(() => setFiltersLoading(false));
  }, [live.config?.eventCode, live.config?.season, live.config?.eventName]);

  // Load qualifying config and class indexes when event changes
  const loadConfig = useCallback(async (ec: string, s: string) => {
    try {
      const [configRes, indexRes] = await Promise.all([
        fetch(`/api/stats?type=qualifying-config&event_code=${encodeURIComponent(ec)}&season=${encodeURIComponent(s)}`),
        fetch(`/api/stats?type=class-indexes&event_code=${encodeURIComponent(ec)}&season=${encodeURIComponent(s)}`),
      ]);
      const configData = await configRes.json();
      if (configData.config) {
        setClassMode(configData.config.classMode || {});
        setSavedTiebreaker(configData.config.tiebreaker || "mph");
        setTiebreaker(configData.config.tiebreaker || "mph");
      }
      const indexData = await indexRes.json();
      const idxs = indexData.indexes || {};
      setClassIndexes(idxs);
      const draft: Record<string, string> = {};
      for (const [k, v] of Object.entries(idxs)) draft[k] = String(v);
      setClassIndexDraft(draft);
      setConfigLoaded(true);
    } catch (err) {
      console.error(err);
      setConfigLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (selectedEvent && selectedSeason) {
      loadConfig(selectedEvent, selectedSeason);
    }
  }, [selectedEvent, selectedSeason, loadConfig]);

  // When category changes, apply saved mode and load class designations
  useEffect(() => {
    if (selectedCategory && classMode[selectedCategory]) {
      setSelectedMode(classMode[selectedCategory]);
    }
    if (selectedCategory && selectedEvent && selectedSeason) {
      fetch(`/api/stats?type=class-designations&event_code=${encodeURIComponent(selectedEvent)}&season=${encodeURIComponent(selectedSeason)}&category=${encodeURIComponent(selectedCategory)}`)
        .then((r) => r.json())
        .then((data) => setClassDesignations(data.designations || []))
        .catch(console.error);
    }
  }, [selectedCategory, classMode, selectedEvent, selectedSeason]);

  async function loadFiltersForEvent(ec: string, s: string) {
    try {
      const res = await fetch(`/api/runs?event_code=${encodeURIComponent(ec)}&season=${encodeURIComponent(s)}&limit=1`);
      const data = await res.json();
      if (data.filters) {
        setAvailableRounds(data.filters.rounds || []);
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
      setSelectedCategory("");
      setResults([]);
      setSearched(false);
      setConfigLoaded(false);
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

  async function saveConfig() {
    if (!selectedEvent || !selectedSeason) return;
    setSaving(true);
    try {
      // Save current mode for the selected category
      const updated = { ...classMode };
      if (selectedCategory) {
        updated[selectedCategory] = selectedMode;
      }
      await fetch("/api/stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "save-qualifying-config",
          event_code: selectedEvent,
          season: selectedSeason,
          classMode: updated,
          tiebreaker,
        }),
      });
      setClassMode(updated);
      setSavedTiebreaker(tiebreaker);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function saveClassIndexes() {
    if (!selectedEvent || !selectedSeason) return;
    setSavingIndexes(true);
    try {
      const indexes: Record<string, number> = {};
      for (const [k, v] of Object.entries(classIndexDraft)) {
        const num = parseFloat(v);
        if (!isNaN(num) && num > 0) indexes[k] = num;
      }
      await fetch("/api/stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "save-class-indexes",
          event_code: selectedEvent,
          season: selectedSeason,
          indexes,
        }),
      });
      setClassIndexes(indexes);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingIndexes(false);
    }
  }

  function addClassDesignation() {
    const d = newClassDesig.trim();
    if (d && !classDesignations.includes(d)) {
      setClassDesignations((prev) => [...prev, d].sort());
    }
    setNewClassDesig("");
  }

  async function search() {
    if (!selectedEvent || !selectedSeason || !selectedCategory || selectedRounds.size === 0) return;
    setLoading(true);
    try {
      const rounds = Array.from(selectedRounds).join(",");
      const res = await fetch(
        `/api/stats?type=qualifying&event_code=${encodeURIComponent(selectedEvent)}&season=${encodeURIComponent(selectedSeason)}&category=${encodeURIComponent(selectedCategory)}&rounds=${encodeURIComponent(rounds)}&mode=${encodeURIComponent(selectedMode)}&tiebreaker=${encodeURIComponent(tiebreaker)}`
      );
      const data = await res.json();
      setResults(data.results || []);
      setSearched(true);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const modeInfo = MODES.find((m) => m.id === selectedMode);
  const isIndexMode = selectedMode === "closest_index_no_breakout" || selectedMode === "closest_index_breakout_ok" || selectedMode === "comp_eliminator" || selectedMode === "stock_super_stock";
  const showDial = isIndexMode;
  const showDiff = isIndexMode;
  const showMph = selectedMode === "quickest_et" || selectedMode === "comp_eliminator" || selectedMode === "stock_super_stock";
  const showRt = selectedMode === "best_rt";
  const dialLabel = selectedMode === "comp_eliminator" || selectedMode === "stock_super_stock" ? "Index" : "Dial";

  function roundLabel(round: string) {
    if (round === "F" || round.toLowerCase() === "final") return "Final";
    if (round.startsWith("C")) return `Class Round ${round.slice(1)}`;
    if (round.startsWith("R")) return `Round ${round.slice(1)}`;
    if (round.startsWith("E")) return `Round ${round.slice(1)}`;
    if (round.startsWith("T")) return `Time Trial ${round.slice(1)}`;
    if (round.startsWith("Q")) return `Qualifying ${round.slice(1)}`;
    return round;
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Qualifying</h1>
        <p className="text-gray-400">Generate qualifying order for any class using different qualifying methods</p>
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

      {/* Category Selector */}
      {availableCategories.length > 0 && (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-6 mb-6">
          <label className="block text-sm text-gray-400 mb-2">Class</label>
          <select
            value={selectedCategory}
            onChange={(e) => { setSelectedCategory(e.target.value); setResults([]); setSearched(false); }}
            className="w-full px-4 py-3 bg-nhra-darker border border-nhra-border rounded-lg text-white text-base focus:outline-none focus:border-nhra-accent"
            aria-label="Select Class"
          >
            <option value="">Select Class</option>
            {availableCategories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
                {classMode[cat] ? ` (${MODES.find((m) => m.id === classMode[cat])?.label || classMode[cat]})` : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Round Selection */}
      {availableRounds.length > 0 && (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-white">Rounds to Count</h2>
            <div className="flex gap-2">
              <button onClick={() => setSelectedRounds(new Set(availableRounds))} className="text-xs text-nhra-accent hover:text-white transition-colors">
                Select All
              </button>
              <span className="text-gray-600">|</span>
              <button onClick={() => setSelectedRounds(new Set())} className="text-xs text-gray-400 hover:text-white transition-colors">
                Clear
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-500 mb-3">If multiple rounds are selected, each racer&apos;s best run across those rounds is used</p>
          <div className="flex flex-wrap gap-3">
            {availableRounds.map((round) => (
              <button
                key={round}
                onClick={() => toggleRound(round)}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                  selectedRounds.has(round)
                    ? "bg-purple-600/20 border-purple-500/50 text-purple-400"
                    : "bg-nhra-darker border-nhra-border text-gray-400 hover:text-white hover:border-nhra-accent/30"
                }`}
              >
                {selectedRounds.has(round) && (
                  <svg className="w-4 h-4 inline mr-1.5 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {roundLabel(round)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Qualifying Mode */}
      <div className="bg-nhra-card border border-nhra-border rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-white">Qualifying Mode</h2>
          {selectedCategory && configLoaded && (
            <button
              onClick={saveConfig}
              disabled={saving}
              className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-medium hover:bg-purple-700 transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {saving ? (
                <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
              Save for {selectedCategory}
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {MODES.map((mode) => (
            <button
              key={mode.id}
              onClick={() => setSelectedMode(mode.id)}
              className={`px-4 py-3 rounded-lg text-left border transition-all ${
                selectedMode === mode.id
                  ? "bg-purple-600/20 border-purple-500/50"
                  : "bg-nhra-darker border-nhra-border hover:border-nhra-accent/30"
              }`}
            >
              <div className={`text-sm font-bold ${selectedMode === mode.id ? "text-purple-400" : "text-gray-300"}`}>
                {mode.label}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{mode.description}</div>
            </button>
          ))}
        </div>

        {/* Tiebreaker for Quickest ET */}
        {selectedMode === "quickest_et" && (
          <div className="mt-4 pt-4 border-t border-nhra-border">
            <label className="block text-sm text-gray-400 mb-2">Tiebreaker (same ET)</label>
            <div className="flex gap-3">
              <button
                onClick={() => setTiebreaker("mph")}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                  tiebreaker === "mph"
                    ? "bg-purple-600/20 border-purple-500/50 text-purple-400"
                    : "bg-nhra-darker border-nhra-border text-gray-400 hover:text-white"
                }`}
              >
                Higher MPH
              </button>
              <button
                onClick={() => setTiebreaker("first_run")}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                  tiebreaker === "first_run"
                    ? "bg-purple-600/20 border-purple-500/50 text-purple-400"
                    : "bg-nhra-darker border-nhra-border text-gray-400 hover:text-white"
                }`}
              >
                Who Ran First
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Class Index Editor - shown for comp/stock modes */}
      {(selectedMode === "comp_eliminator" || selectedMode === "stock_super_stock") && selectedCategory && (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-white">NHRA Class Indexes</h2>
              <p className="text-xs text-gray-500 mt-0.5">Published class indexes for {selectedCategory}. These determine qualifying order.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowIndexEditor(!showIndexEditor)}
                className="px-3 py-1.5 bg-nhra-darker border border-nhra-border text-gray-300 rounded-lg text-xs font-medium hover:text-white transition-colors"
              >
                {showIndexEditor ? "Hide Editor" : "Edit Indexes"}
              </button>
              {showIndexEditor && (
                <button
                  onClick={saveClassIndexes}
                  disabled={savingIndexes}
                  className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-medium hover:bg-purple-700 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  {savingIndexes ? (
                    <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  Save Indexes
                </button>
              )}
            </div>
          </div>

          {/* Summary of current indexes */}
          {!showIndexEditor && classDesignations.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {classDesignations.map((d) => (
                <span key={d} className={`px-2.5 py-1 rounded text-xs font-mono ${
                  classIndexes[d] ? "bg-purple-500/15 text-purple-400" : "bg-red-500/15 text-red-400"
                }`}>
                  {d}: {classIndexes[d] ? classIndexes[d].toFixed(2) : "missing"}
                </span>
              ))}
              {classDesignations.filter((d) => !classIndexes[d]).length > 0 && (
                <p className="w-full text-xs text-red-400 mt-2">
                  Some classes are missing indexes. Click &quot;Edit Indexes&quot; to add them.
                </p>
              )}
            </div>
          )}

          {/* Editor */}
          {showIndexEditor && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {classDesignations.map((d) => (
                  <div key={d} className="flex items-center gap-2">
                    <label className="text-xs text-gray-400 font-mono w-16 shrink-0">{d}</label>
                    <input
                      type="number"
                      step="0.01"
                      value={classIndexDraft[d] || ""}
                      onChange={(e) => setClassIndexDraft((prev) => ({ ...prev, [d]: e.target.value }))}
                      placeholder="Index"
                      className="w-full px-2 py-1.5 bg-nhra-darker border border-nhra-border rounded text-white text-sm font-mono focus:outline-none focus:border-purple-500"
                    />
                  </div>
                ))}
              </div>

              {/* Add new class designation */}
              <div className="flex items-center gap-2 pt-2 border-t border-nhra-border">
                <input
                  type="text"
                  value={newClassDesig}
                  onChange={(e) => setNewClassDesig(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addClassDesignation()}
                  placeholder="Add class (e.g. FS/D)"
                  className="px-2 py-1.5 bg-nhra-darker border border-nhra-border rounded text-white text-sm font-mono focus:outline-none focus:border-purple-500 w-40"
                />
                <button
                  onClick={addClassDesignation}
                  className="px-3 py-1.5 bg-nhra-darker border border-nhra-border text-gray-300 rounded text-xs font-medium hover:text-white transition-colors"
                >
                  Add
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Search Button */}
      <button
        onClick={search}
        disabled={loading || !selectedEvent || !selectedCategory || selectedRounds.size === 0}
        className="w-full mb-8 px-6 py-4 bg-purple-600 text-white rounded-xl font-bold text-base hover:bg-purple-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-3"
      >
        {loading ? (
          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
          </svg>
        )}
        Generate Qualifying Order
      </button>

      {/* Results */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {searched && !loading && results.length === 0 && (
        <div className="bg-nhra-card border-2 border-gray-600/30 rounded-xl px-6 py-10 text-center">
          <p className="text-gray-400 font-bold text-lg mb-1">No Qualifying Results</p>
          <p className="text-gray-500 text-sm">No valid runs found for the selected class and rounds</p>
        </div>
      )}

      {searched && !loading && results.length > 0 && (
        <>
          {/* Publication Table */}
          <div className="bg-nhra-card border border-nhra-border rounded-xl overflow-hidden mb-6">
            <div className="px-6 py-4 bg-nhra-darker border-b border-nhra-border flex items-center justify-between">
              <div>
                <h3 className="text-white font-bold text-lg">
                  {selectedCategory} Qualifying - {selectedEventName || selectedEvent}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">{modeInfo?.label}{tiebreaker === "first_run" && selectedMode === "quickest_et" ? " (First Run tiebreaker)" : ""}</p>
              </div>
              <button
                onClick={() => {
                  const eventLabel = selectedEventName || selectedEvent;
                  const pad = (s: string, len: number) => s + " ".repeat(Math.max(0, len - s.length));
                  const header = `${selectedCategory} Qualifying - ${eventLabel}`;
                  const modeLabel = modeInfo?.label || selectedMode;
                  const subheader = `Mode: ${modeLabel}`;

                  let colHeader = `${pad("#", 5)}${pad("Racer", 24)}${pad("Car #", 10)}`;
                  if (showRt) {
                    colHeader += `${pad("RT", 10)}`;
                  } else {
                    colHeader += `${pad("ET", 10)}`;
                    if (showMph) colHeader += `${pad("MPH", 10)}`;
                    if (showDial) colHeader += `${pad(dialLabel, 10)}${pad("Diff", 10)}`;
                  }
                  colHeader += "Membership";

                  const rows = results.map((r) => {
                    let row = `${pad(String(r.position), 5)}${pad(r.name, 24)}${pad("#" + r.car_number, 10)}`;
                    if (showRt) {
                      row += `${pad(r.rt != null ? r.rt.toFixed(4) : "-", 10)}`;
                    } else {
                      row += `${pad(r.et.toFixed(3), 10)}`;
                      if (showMph) row += `${pad(r.mph != null ? r.mph.toFixed(2) : "-", 10)}`;
                      if (showDial) {
                        row += `${pad(r.dial_in != null ? r.dial_in.toFixed(3) : "-", 10)}`;
                        row += `${pad(r.diff != null ? (r.diff >= 0 ? "+" : "") + r.diff.toFixed(4) : "-", 10)}`;
                      }
                    }
                    row += r.membership || "\u2014";
                    return row;
                  });
                  const text = `${header}\n${subheader}\n\n${colHeader}\n${rows.join("\n")}`;
                  navigator.clipboard.writeText(text);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors flex items-center gap-2 shrink-0"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                </svg>
                {copied ? "Copied!" : "Copy for Publication"}
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-nhra-border text-gray-400 text-xs font-bold uppercase tracking-wider">
                    <th className="px-4 py-3 text-center w-12">#</th>
                    <th className="px-4 py-3 text-left">Racer</th>
                    <th className="px-4 py-3 text-left">Car #</th>
                    {showRt ? (
                      <th className="px-4 py-3 text-right">RT</th>
                    ) : (
                      <th className="px-4 py-3 text-right">ET</th>
                    )}
                    {showMph && <th className="px-4 py-3 text-right">MPH</th>}
                    {showDial && <th className="px-4 py-3 text-right">{dialLabel}</th>}
                    {showDiff && <th className="px-4 py-3 text-right">Diff</th>}
                    <th className="px-4 py-3 text-left">Round</th>
                    <th className="px-4 py-3 text-left">Member</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.car_number} className={`border-b border-nhra-border/30 ${r.position <= 3 ? "bg-purple-500/5" : ""}`}>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-bold ${
                          r.position === 1 ? "bg-yellow-500/20 text-yellow-400" :
                          r.position === 2 ? "bg-gray-400/20 text-gray-300" :
                          r.position === 3 ? "bg-orange-600/20 text-orange-400" :
                          "text-gray-500"
                        }`}>
                          {r.position}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/racer/${encodeURIComponent(r.name)}`}
                          className="text-white font-semibold hover:text-nhra-accent transition-colors"
                        >
                          {r.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-nhra-accent font-bold">#{r.car_number}</td>
                      {showRt ? (
                        <td className="px-4 py-3 text-right font-mono text-white">
                          {r.rt != null ? r.rt.toFixed(4) : "-"}
                        </td>
                      ) : (
                        <td className="px-4 py-3 text-right font-mono text-white">{r.et.toFixed(3)}</td>
                      )}
                      {showMph && (
                        <td className="px-4 py-3 text-right font-mono text-gray-300">
                          {r.mph != null ? r.mph.toFixed(2) : "-"}
                        </td>
                      )}
                      {showDial && (
                        <td className="px-4 py-3 text-right font-mono text-gray-400">
                          {r.dial_in != null ? r.dial_in.toFixed(3) : "-"}
                        </td>
                      )}
                      {showDiff && (
                        <td className={`px-4 py-3 text-right font-mono ${
                          r.diff != null && r.diff < 0 ? "text-red-400" : "text-gray-400"
                        }`}>
                          {r.diff != null ? (r.diff >= 0 ? "+" : "") + r.diff.toFixed(4) : "-"}
                        </td>
                      )}
                      <td className="px-4 py-3 text-gray-400 text-xs">{roundLabel(r.round)}</td>
                      <td className="px-4 py-3 text-gray-500">{r.membership || "\u2014"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Summary */}
          <div className="bg-purple-500/10 border-2 border-purple-500/40 rounded-xl px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 bg-purple-500 rounded-full" />
              <span className="text-purple-400 font-bold text-lg">
                {results.length} Racer{results.length !== 1 && "s"} Qualified
              </span>
            </div>
            <span className="text-gray-400 text-sm">{selectedCategory}</span>
          </div>
        </>
      )}

      {!searched && !loading && (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-12 text-center text-gray-500">
          Select an event, class, rounds, and qualifying mode, then generate the qualifying order
        </div>
      )}
    </div>
  );
}
