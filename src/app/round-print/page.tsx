"use client";

import { useCallback, useEffect, useState } from "react";
import { useLiveData } from "@/components/LiveDataProvider";
import RoundPrintCard from "@/components/RoundPrintCard";
import type { RoundPrintPayload } from "@/app/api/round-print/route";

interface EventOption {
  event_code: string;
  event_name: string;
  season: string;
}

interface FiltersResp {
  categories: string[];
  rounds: string[];
  events?: EventOption[];
}

const ALL_ROUNDS = "__ALL__";

async function fetchOne(eventCode: string, season: string, round: string, category: string): Promise<RoundPrintPayload> {
  const params = new URLSearchParams({ event_code: eventCode, season, round });
  if (category) params.set("category", category);
  const res = await fetch(`/api/round-print?${params}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function RoundPrintPage() {
  const live = useLiveData();
  const [events, setEvents] = useState<EventOption[]>([]);
  const [eventCode, setEventCode] = useState("");
  const [season, setSeason] = useState("");

  const [categories, setCategories] = useState<string[]>([]);
  const [rounds, setRounds] = useState<string[]>([]);
  const [category, setCategory] = useState<string>("");
  const [round, setRound] = useState<string>("");
  const [sections, setSections] = useState<RoundPrintPayload[]>([]);
  const [loading, setLoading] = useState(false);
  const [filtersLoading, setFiltersLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ec = live.config?.eventCode || "";
    const s = live.config?.season || "";
    if (ec && s && (eventCode !== ec || season !== s)) {
      setEventCode(ec);
      setSeason(s);
    }
  }, [live.config?.eventCode, live.config?.season, eventCode, season]);

  const loadFilters = useCallback(async () => {
    setFiltersLoading(true);
    try {
      const qs = eventCode && season
        ? `event_code=${encodeURIComponent(eventCode)}&season=${encodeURIComponent(season)}&limit=1`
        : "limit=1";
      const res = await fetch(`/api/runs?${qs}`);
      const json = (await res.json()) as { filters?: FiltersResp };
      setEvents(json.filters?.events || []);
      setCategories(json.filters?.categories || []);
      setRounds(json.filters?.rounds || []);
    } catch (err) {
      console.error(err);
    } finally {
      setFiltersLoading(false);
    }
  }, [eventCode, season]);

  useEffect(() => {
    loadFilters();
  }, [loadFilters]);

  useEffect(() => {
    let cancelled = false;
    if (!eventCode || !season || !round) { setSections([]); return; }

    async function load() {
      setLoading(true);
      setError(null);
      try {
        if (round === ALL_ROUNDS) {
          const targetCategories = category ? [category] : categories;
          const requests: Promise<RoundPrintPayload>[] = [];
          for (const r of rounds) {
            for (const c of targetCategories) {
              requests.push(fetchOne(eventCode, season, r, c));
            }
          }
          const results = await Promise.all(requests);
          if (!cancelled) setSections(results.filter((p) => p.pairs.length > 0));
        } else {
          const payload = await fetchOne(eventCode, season, round, category);
          if (!cancelled) setSections(payload.pairs.length > 0 ? [payload] : []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load");
          setSections([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [eventCode, season, round, category, rounds, categories]);

  function handlePrint() {
    window.print();
  }

  function handleEventChange(value: string) {
    if (!value) { setEventCode(""); setSeason(""); return; }
    const [ec, s] = value.split("|");
    setEventCode(ec);
    setSeason(s);
    setRound("");
    setCategory("");
    setSections([]);
  }

  const eventValue = eventCode && season ? `${eventCode}|${season}` : "";
  const totalCars = sections.reduce((sum, s) => sum + s.car_count, 0);
  const totalPairs = sections.reduce((sum, s) => sum + s.pair_count, 0);

  return (
    <div className="max-w-[1200px] mx-auto">
      <div className="print:hidden">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-white mb-2">Round Log Print</h1>
          <p className="text-gray-400">
            Generate a CompuLink StarTrak style log for a single round, a whole class, or every class.
          </p>
        </div>

        <div className="bg-nhra-card border border-nhra-border rounded-xl p-5 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <label className="block text-xs uppercase text-gray-500 mb-1">Event</label>
              <select
                value={eventValue}
                onChange={(e) => handleEventChange(e.target.value)}
                className="w-full px-3 py-2 bg-nhra-darker border border-nhra-border rounded-lg text-white text-sm focus:outline-none focus:border-nhra-accent"
              >
                <option value="">Select an event…</option>
                {events.map((ev) => (
                  <option key={`${ev.event_code}|${ev.season}`} value={`${ev.event_code}|${ev.season}`}>
                    {ev.event_name} ({ev.season})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs uppercase text-gray-500 mb-1">Round</label>
              <select
                value={round}
                onChange={(e) => setRound(e.target.value)}
                disabled={!eventCode || rounds.length === 0}
                className="w-full px-3 py-2 bg-nhra-darker border border-nhra-border rounded-lg text-white text-sm focus:outline-none focus:border-nhra-accent disabled:opacity-50"
              >
                <option value="">Select a round…</option>
                <option value={ALL_ROUNDS}>All rounds (final results)</option>
                {rounds.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs uppercase text-gray-500 mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={!eventCode || categories.length === 0}
                className="w-full px-3 py-2 bg-nhra-darker border border-nhra-border rounded-lg text-white text-sm focus:outline-none focus:border-nhra-accent disabled:opacity-50"
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 mt-4">
            <button
              onClick={handlePrint}
              disabled={sections.length === 0}
              className="px-4 py-2 bg-nhra-red text-white rounded-lg font-semibold hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Print
            </button>
            {filtersLoading && <span className="text-gray-500 text-xs">Loading filters…</span>}
            {loading && <span className="text-gray-500 text-xs">Loading…</span>}
            {error && <span className="text-red-400 text-xs">{error}</span>}
            {sections.length > 0 && !loading && (
              <span className="text-gray-400 text-xs">
                {sections.length} section(s) &middot; {totalCars} run(s) &middot; {totalPairs} pair(s)
              </span>
            )}
          </div>
        </div>
      </div>

      {sections.map((section, idx) => {
        const label = (section.category || "ALL CLASSES").toUpperCase();
        return (
          <div
            key={`${section.round}-${section.category ?? "all"}-${idx}`}
            className="bg-white text-black rounded-lg overflow-x-auto print:bg-white print:overflow-visible print:rounded-none mb-6 round-print-section"
            style={{ breakBefore: idx === 0 ? "auto" : "page", pageBreakBefore: idx === 0 ? "auto" : "always" }}
          >
            <RoundPrintCard data={section} categoryLabel={label} />
          </div>
        );
      })}

      {sections.length === 0 && !loading && round && eventCode && (
        <div className="print:hidden bg-nhra-card border border-nhra-border rounded-xl p-8 text-center text-gray-500">
          No runs for that selection.
        </div>
      )}

      {!round && eventCode && !loading && (
        <div className="print:hidden bg-nhra-card border border-nhra-border rounded-xl p-8 text-center text-gray-500">
          Pick a round (or &ldquo;All rounds&rdquo;) to preview the printout.
        </div>
      )}

      {!eventCode && !filtersLoading && (
        <div className="print:hidden bg-nhra-card border border-nhra-border rounded-xl p-8 text-center text-gray-500">
          Pick an event to begin.
        </div>
      )}
    </div>
  );
}
