"use client";

import { useEffect, useState } from "react";
import BracketView from "@/components/BracketView";
import { useLiveData } from "@/components/LiveDataProvider";

interface EventOption {
  event_code: string;
  event_name: string;
  season: string;
}

interface RunRow {
  timestamp: string | null;
  round: string | null;
  name: string | null;
  car_number: string | null;
  rt: number | null;
  ft1320: number | null;
  mph_1320: number | null;
  is_winner: number;
  lane: string | null;
  dial_in: number | null;
  mov: number | null;
  category: string | null;
}

export default function BracketsPage() {
  const live = useLiveData();
  const [events, setEvents] = useState<EventOption[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedEvent, setSelectedEvent] = useState("");
  const [selectedSeason, setSelectedSeason] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [filtersLoading, setFiltersLoading] = useState(true);

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
          setCategories(data.filters.categories || []);
        }
      })
      .catch(console.error)
      .finally(() => setFiltersLoading(false));
  }, [live.config?.eventCode, live.config?.season]);

  async function loadBrackets() {
    if (!selectedEvent || !selectedSeason || !selectedCategory) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/stats?type=brackets&event_code=${encodeURIComponent(selectedEvent)}&season=${encodeURIComponent(selectedSeason)}&category=${encodeURIComponent(selectedCategory)}`);
      const data = await res.json();
      setRuns(data.runs || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function handleEventChange(value: string) {
    const event = events.find((e) => `${e.event_code}|${e.season}` === value);
    if (event) {
      setSelectedEvent(event.event_code);
      setSelectedSeason(event.season);
    }
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Elimination Brackets</h1>
        <p className="text-gray-400">View matchups and results from elimination rounds</p>
      </div>

      <div className="bg-nhra-card border border-nhra-border rounded-xl p-5 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Event</label>
            <select
              value={selectedEvent ? `${selectedEvent}|${selectedSeason}` : ""}
              onChange={(e) => handleEventChange(e.target.value)}
              className="w-full px-4 py-2.5 bg-nhra-darker border border-nhra-border rounded-lg text-white focus:outline-none focus:border-nhra-accent"
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
          <div>
            <label className="block text-sm text-gray-400 mb-1">Category</label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full px-4 py-2.5 bg-nhra-darker border border-nhra-border rounded-lg text-white focus:outline-none focus:border-nhra-accent"
              disabled={filtersLoading}
              aria-label="Select Category"
            >
              <option value="">Select Category</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={loadBrackets}
              disabled={loading || !selectedEvent || !selectedCategory}
              className="w-full px-6 py-2.5 bg-nhra-red text-white rounded-lg font-medium hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              Load Brackets
            </button>
          </div>
        </div>
      </div>

      {runs.length > 0 ? (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-5">
          <BracketView runs={runs} />
        </div>
      ) : !loading ? (
        <div className="bg-nhra-card border border-nhra-border rounded-xl p-12 text-center text-gray-500">
          Select an event and category to view elimination brackets
        </div>
      ) : null}
    </div>
  );
}
